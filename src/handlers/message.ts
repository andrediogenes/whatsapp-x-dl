import { stat, unlink } from 'node:fs/promises';
import {
  jidNormalizedUser,
  type WASocket,
  type WAMessage,
  type MessageUpsertType,
} from '@whiskeysockets/baileys';
import { extractTweetId } from '../utils/url.js';
import { downloadTweetVideo, NoVideoError } from '../services/twitter.js';
import { compressVideo } from '../services/media.js';

// Acima disso o WhatsApp deixa de tratar o vídeo como mídia inline de forma
// confiável; nesse caso tentamos recomprimir e, se ainda assim não couber,
// mandamos como documento (limite bem maior, só perde a prévia inline).
const MAX_INLINE_VIDEO_BYTES = 16 * 1024 * 1024;

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
 * Baixa o vídeo do tweet, envia como mídia (com fallback pra documento se muito
 * grande) e limpa os arquivos temporários no final, dê certo ou não o envio.
 */
async function sendTweetVideo(
  sock: WASocket,
  remoteJid: string,
  tweetId: string,
): Promise<Awaited<ReturnType<WASocket['sendMessage']>>> {
  let downloadedPath: string | undefined;
  let compressedPath: string | undefined;

  try {
    downloadedPath = await downloadTweetVideo(tweetId);
    let sendPath = downloadedPath;
    let { size } = await stat(sendPath);

    if (size > MAX_INLINE_VIDEO_BYTES) {
      try {
        compressedPath = await compressVideo(sendPath);
        const compressedStat = await stat(compressedPath);
        if (compressedStat.size < size) {
          sendPath = compressedPath;
          size = compressedStat.size;
        }
      } catch (err) {
        console.error(`Falha ao recomprimir vídeo do tweet ${tweetId}:`, err);
        // segue com o arquivo original; se ainda estiver grande, cai no fallback de documento
      }
    }

    if (size > MAX_INLINE_VIDEO_BYTES) {
      return await sock.sendMessage(remoteJid, {
        document: { url: sendPath },
        mimetype: 'video/mp4',
        fileName: `${tweetId}.mp4`,
        caption: `ID: ${tweetId} (arquivo grande, enviado como documento)`,
      });
    }

    return await sock.sendMessage(remoteJid, { video: { url: sendPath }, caption: `ID: ${tweetId}` });
  } catch (err) {
    if (err instanceof NoVideoError) {
      return await sock.sendMessage(remoteJid, { text: `ID: ${tweetId}\nEsse tweet não tem vídeo.` });
    }
    console.error(`Falha no download/envio do tweet ${tweetId}:`, err);
    return await sock.sendMessage(remoteJid, { text: `ID: ${tweetId}\nFalha ao baixar/enviar o vídeo.` });
  } finally {
    if (downloadedPath) await unlink(downloadedPath).catch(() => {});
    if (compressedPath) await unlink(compressedPath).catch(() => {});
  }
}

/**
 * Fase 4: baixa o vídeo do tweet e envia de volta como mídia, com fallback pra
 * documento se passar do limite de tamanho, e limpa tmp/ depois. Mensagens sem
 * link reconhecível ficam em silêncio.
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

    try {
      const sent = await sendTweetVideo(sock, remoteJid, tweetId);
      if (sent?.key?.id) trackId(botSentMessageIds, sent.key.id);
    } catch (err) {
      console.error(`Falha ao responder ${remoteJid}:`, err);
    }
  }
}
