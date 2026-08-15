import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  jidNormalizedUser,
  type WASocket,
  type WAMessage,
  type MessageUpsertType,
} from '@whiskeysockets/baileys';
import { extractTweetId } from '../utils/url.js';
import { downloadTweetVideo, NoVideoError } from '../services/twitter.js';

// Em self-chat (e especialmente via @lid), o WhatsApp costuma reentregar a mesma
// mensagem várias vezes até a decriptação vingar, e o próprio "pong" que o bot manda
// também ecoa de volta como mensagem "recebida" (fromMe: true, mesmo JID). Uma guarda
// por tempo não é confiável aqui porque os reenvios não têm intervalo fixo (já vimos
// retries chegarem com mais de 5s de diferença). Por isso rastreamos por ID:
// - handledMessageIds: mensagens às quais já respondemos, pra ignorar reentregas
// - botSentMessageIds: mensagens que o próprio bot mandou, pra reconhecer o próprio eco
const handledMessageIds = new Set<string>();
const botSentMessageIds = new Set<string>();
const MAX_TRACKED_IDS = 500;

function trackId(set: Set<string>, id: string): void {
  set.add(id);
  if (set.size > MAX_TRACKED_IDS) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
}

// Só reagimos a tipos de conteúdo que um humano de fato escreveu/enviou. Sem essa
// lista, mensagens de protocolo (sync de app state, notificação de histórico,
// recibo, reação, etc.) também têm `msg.message` preenchido e passariam pelo
// filtro como se fossem texto de verdade — foi isso que provavelmente disparou
// o primeiro "pong" sem nenhuma mensagem real ter sido enviada.
const REAL_CONTENT_KEYS = [
  'conversation',
  'extendedTextMessage',
  'imageMessage',
  'videoMessage',
  'documentMessage',
  'audioMessage',
  'stickerMessage',
  'contactMessage',
  'locationMessage',
] as const;

function hasRealContent(message: WAMessage['message']): boolean {
  if (!message) return false;
  return REAL_CONTENT_KEYS.some((key) => key in message);
}

function extractText(message: WAMessage['message']): string | undefined {
  if (!message) return undefined;
  return message.conversation ?? message.extendedTextMessage?.text ?? undefined;
}

/**
 * Fase 3: além de extrair o ID, baixa o vídeo/GIF do tweet via yt-dlp para tmp/
 * e informa o resultado. Mensagens sem link reconhecível ficam em silêncio.
 * Ainda sem enviar o arquivo como mídia nem limpar tmp/ — isso entra nas fases 4 e 5.
 */
export async function handleIncomingMessages(
  sock: WASocket,
  messages: WAMessage[],
  type: MessageUpsertType,
): Promise<void> {
  // 'notify' = mensagem chegando em tempo real. Outros tipos vêm de sincronização
  // de histórico (ex.: ao reconectar) e não devem gerar resposta.
  if (type !== 'notify') return;

  // A mesma conta é representada por dois JIDs diferentes dependendo do contexto:
  // o formato telefone (@s.whatsapp.net) e o formato LID (@lid, mais novo). Mensagens
  // de self-chat chegam no formato LID mesmo quando sock.user.id reporta o formato
  // telefone — por isso precisamos comparar contra os dois.
  const ownJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : undefined;
  const ownLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : undefined;

  for (const msg of messages) {
    const remoteJid = msg.key.remoteJid;
    const msgId = msg.key.id;
    const isFromMe = msg.key.fromMe === true;
    const isSelfChat = remoteJid !== undefined && (remoteJid === ownJid || remoteJid === ownLid);

    if (msg.messageStubType) continue; // evento de sistema (ex.: notificação de segurança), não é mensagem
    if (!hasRealContent(msg.message) || !remoteJid || !msgId) continue;
    if (remoteJid === 'status@broadcast') continue;
    if (remoteJid.endsWith('@g.us')) continue; // ignora grupos — só conversa privada
    if (botSentMessageIds.has(msgId)) continue; // é o eco de uma resposta que o próprio bot mandou
    if (handledMessageIds.has(msgId)) continue; // já respondemos a essa mensagem (reentrega do WhatsApp)

    // Ignora mensagens enviadas pelo próprio bot, exceto no chat "Mensagem para você"
    // (mesmo JID do bot), que é como uma conta única costuma se auto-testar.
    if (isFromMe && !isSelfChat) continue;

    const text = extractText(msg.message);
    const tweetId = text ? await extractTweetId(text) : undefined;
    if (!tweetId) continue; // sem link do X reconhecível, ignora

    trackId(handledMessageIds, msgId);

    let replyText: string;
    try {
      const filePath = await downloadTweetVideo(tweetId);
      const { size } = await stat(filePath);
      const sizeMB = (size / (1024 * 1024)).toFixed(1);
      replyText = `ID: ${tweetId}\nBaixado: ${path.basename(filePath)} (${sizeMB} MB)`;
    } catch (err) {
      if (err instanceof NoVideoError) {
        replyText = `ID: ${tweetId}\nEsse tweet não tem vídeo.`;
      } else {
        console.error(`Falha ao baixar tweet ${tweetId}:`, err);
        replyText = `ID: ${tweetId}\nFalha ao baixar o vídeo.`;
      }
    }

    try {
      const sent = await sock.sendMessage(remoteJid, { text: replyText });
      if (sent?.key?.id) trackId(botSentMessageIds, sent.key.id);
    } catch (err) {
      console.error(`Falha ao responder ${remoteJid}:`, err);
    }
  }
}
