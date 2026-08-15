import {
  jidNormalizedUser,
  type WASocket,
  type WAMessage,
  type MessageUpsertType,
} from '@whiskeysockets/baileys';

// Depois que o bot manda "pong" num self-chat, o próprio Baileys dispara um
// messages.upsert para essa mensagem enviada (fromMe: true, mesmo JID do self-chat).
// Sem essa guarda, esse eco reentra no handler e vira um loop infinito de pong.
// Por isso registramos quando o bot mandou algo pra um JID e ignoramos qualquer
// "mensagem própria" que chegue logo em seguida nesse mesmo chat.
const lastBotSendAt = new Map<string, number>();
const ECHO_GUARD_MS = 4000;

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

/**
 * Fase 1: qualquer mensagem privada recebida gera um "pong" de volta.
 * Ainda sem roteamento por conteúdo — isso entra na fase 2 (detecção de link do X).
 */
export async function handleIncomingMessages(
  sock: WASocket,
  messages: WAMessage[],
  type: MessageUpsertType,
): Promise<void> {
  // 'notify' = mensagem chegando em tempo real. Outros tipos vêm de sincronização
  // de histórico (ex.: ao reconectar) e não devem gerar resposta.
  if (type !== 'notify') return;

  const ownJid = sock.user ? jidNormalizedUser(sock.user.id) : undefined;

  for (const msg of messages) {
    const remoteJid = msg.key.remoteJid;
    if (msg.messageStubType) continue; // evento de sistema (ex.: notificação de segurança), não é mensagem
    if (!hasRealContent(msg.message) || !remoteJid) continue;
    if (remoteJid === 'status@broadcast') continue;
    if (remoteJid.endsWith('@g.us')) continue; // ignora grupos — só conversa privada

    // Ignora mensagens enviadas pelo próprio bot, exceto no chat "Mensagem para você"
    // (mesmo JID do bot), que é como uma conta única costuma se auto-testar.
    const isFromMe = msg.key.fromMe === true;
    const isSelfChat = ownJid !== undefined && remoteJid === ownJid;
    if (isFromMe && !isSelfChat) continue;

    if (isSelfChat && isFromMe) {
      const lastSend = lastBotSendAt.get(remoteJid);
      if (lastSend !== undefined && Date.now() - lastSend < ECHO_GUARD_MS) continue; // provável eco do próprio pong
    }

    lastBotSendAt.set(remoteJid, Date.now());
    try {
      await sock.sendMessage(remoteJid, { text: 'pong' });
    } catch (err) {
      console.error(`Falha ao responder ${remoteJid}:`, err);
    }
  }
}
