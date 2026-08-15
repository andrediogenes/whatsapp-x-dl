import {
  jidNormalizedUser,
  type WASocket,
  type WAMessage,
  type MessageUpsertType,
} from '@whiskeysockets/baileys';

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
    if (!msg.message || !remoteJid) continue; // sem conteúdo (reação, mensagem de protocolo, etc.)
    if (remoteJid === 'status@broadcast') continue;
    if (remoteJid.endsWith('@g.us')) continue; // ignora grupos — só conversa privada

    // Ignora mensagens enviadas pelo próprio bot, exceto no chat "Mensagem para você"
    // (mesmo JID do bot), que é como uma conta única costuma se auto-testar.
    const isFromMe = msg.key.fromMe === true;
    const isSelfChat = ownJid !== undefined && remoteJid === ownJid;
    if (isFromMe && !isSelfChat) continue;

    try {
      await sock.sendMessage(remoteJid, { text: 'pong' });
    } catch (err) {
      console.error(`Falha ao responder ${remoteJid}:`, err);
    }
  }
}
