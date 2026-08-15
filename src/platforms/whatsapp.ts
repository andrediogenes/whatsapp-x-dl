import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { handleIncomingMessages } from '../handlers/message.js';

const AUTH_DIR = 'auth';

// O logger interno do Baileys é bem verboso; deixamos ele só em 'warn' e usamos
// console.log para os eventos de conexão que realmente importam acompanhar.
const logger = pino({ level: 'warn' });

export async function startWhatsApp(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('Escaneie o QR code no WhatsApp (Aparelhos conectados > Conectar aparelho):');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      console.log(`Conexão encerrada (código ${statusCode ?? 'desconhecido'}).`);

      if (loggedOut) {
        console.log('Sessão desconectada pelo WhatsApp. Apague a pasta auth/ e reinicie para gerar um novo QR code.');
      } else {
        console.log('Reconectando...');
        void startWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('Conectado ao WhatsApp.');
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    void handleIncomingMessages(sock, messages, type);
  });
}
