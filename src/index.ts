import { startTelegram } from './platforms/telegram.js';
import { cleanupOrphanedFiles } from './utils/tmp.js';

try {
  process.loadEnvFile('.env');
} catch {
  // sem .env ainda — startTelegram() reclama de forma mais clara se faltar o token
}

try {
  // Apaga qualquer arquivo órfão de uma execução anterior que caiu no meio de
  // um download, antes de começar a aceitar mensagens novas.
  await cleanupOrphanedFiles();
  startTelegram();
} catch (err) {
  console.error('Falha ao iniciar o bot:', err);
  process.exit(1);
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
