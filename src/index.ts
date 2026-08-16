import { startTelegram } from './platforms/telegram.js';
// WhatsApp continua disponível (funciona, mas self-chat tem sessão de
// criptografia instável demais pra testar com conforto) — trocamos pra
// Telegram por enquanto. Pra voltar: import { startWhatsApp } from
// './platforms/whatsapp.js' e chame no lugar de startTelegram().

try {
  process.loadEnvFile('.env');
} catch {
  // sem .env ainda — startTelegram() reclama de forma mais clara se faltar o token
}

try {
  startTelegram();
} catch (err) {
  console.error('Falha ao iniciar o bot:', err);
  process.exit(1);
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
