import { startTelegram } from './platforms/telegram.js';

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
