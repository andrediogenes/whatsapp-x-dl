import { Bot, InputFile } from 'grammy';
import { extractTweetId } from '../utils/url.js';
import { prepareTweetVideo, NoVideoError } from '../services/twitter.js';
import { TimeoutError } from '../utils/process.js';
import { enqueue } from '../utils/queue.js';

// A API padrão de bots do Telegram (sem servidor local) limita uploads a 50MB;
// deixamos uma margem de segurança.
const MAX_INLINE_VIDEO_BYTES = 45 * 1024 * 1024;

interface ReplyCtx {
  reply: (text: string) => Promise<unknown>;
  replyWithVideo: (file: InputFile, opts: { caption: string }) => Promise<unknown>;
}

/**
 * Envia o vídeo do tweet pro chat. Se mesmo após comprimir o arquivo continuar
 * grande demais pro limite do Telegram, avisa em vez de tentar enviar (o Bot
 * API simplesmente rejeitaria o upload).
 */
async function sendTweetVideo(ctx: ReplyCtx, tweetId: string): Promise<void> {
  try {
    const video = await prepareTweetVideo(tweetId, MAX_INLINE_VIDEO_BYTES);
    try {
      if (video.size > MAX_INLINE_VIDEO_BYTES) {
        await ctx.reply(
          `ID: ${tweetId}\nArquivo grande demais pro Telegram mesmo após comprimir (${(video.size / 1024 / 1024).toFixed(1)} MB).`,
        );
        return;
      }
      await ctx.replyWithVideo(new InputFile(video.path), { caption: `ID: ${tweetId}` });
    } finally {
      await video.cleanup();
    }
  } catch (err) {
    if (err instanceof NoVideoError) {
      await ctx.reply(`ID: ${tweetId}\nEsse tweet não tem vídeo.`);
      return;
    }
    if (err instanceof TimeoutError) {
      await ctx.reply(`ID: ${tweetId}\nDemorou demais pra processar e foi cancelado. Tenta de novo mais tarde.`);
      return;
    }
    console.error(`Falha no download/envio do tweet ${tweetId}:`, err);
    await ctx.reply(`ID: ${tweetId}\nAlgo deu errado ao baixar esse vídeo. Tenta de novo em instantes.`);
  }
}

export function startTelegram(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN não configurado (crie um arquivo .env com essa variável)');
  }

  const bot = new Bot(token);

  bot.on('message:text', (ctx) => {
    // Enfileira e retorna na hora — assim o grammy segue processando outras
    // atualizações (e a próxima mensagem já entra na fila) em vez de travar
    // esperando o download atual terminar.
    void enqueue(async () => {
      const tweetId = await extractTweetId(ctx.message.text);
      if (!tweetId) return; // sem link do X reconhecível, ignora
      await sendTweetVideo(ctx, tweetId);
    }).catch((err) => console.error('Erro inesperado processando mensagem:', err));
  });

  bot.catch((err) => {
    console.error('Erro no bot do Telegram:', err);
  });

  void bot.start({
    onStart: () => console.log('Conectado ao Telegram.'),
  });
}
