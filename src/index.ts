import { startWhatsApp } from './platforms/whatsapp.js';

startWhatsApp().catch((err) => {
  console.error('Falha ao iniciar o bot:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
