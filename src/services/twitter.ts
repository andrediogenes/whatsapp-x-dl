import { spawn } from 'node:child_process';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { compressVideo } from './media.js';

const TMP_DIR = 'tmp';

/** Tweet existe mas não tem vídeo/GIF pra baixar (ou não foi encontrado). */
export class NoVideoError extends Error {}

const NO_VIDEO_PATTERN = /no video could be found|no media found|unable to extract|no formats found/i;

/**
 * Baixa o vídeo/GIF de um tweet via yt-dlp para tmp/ e devolve o caminho local
 * do arquivo. Agnóstico de plataforma: só recebe o ID do tweet, não sabe nada
 * de WhatsApp/Telegram — pode ser reusado por qualquer adaptador de mensageria.
 */
export async function downloadTweetVideo(tweetId: string): Promise<string> {
  await mkdir(TMP_DIR, { recursive: true });

  const url = `https://x.com/i/status/${tweetId}`;
  const outputTemplate = path.join(TMP_DIR, `${randomUUID()}.%(ext)s`);

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      url,
      '-o', outputTemplate,
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--print', 'after_move:filepath',
    ]);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('error', reject); // ex.: yt-dlp não instalado / não encontrado no PATH

    proc.on('close', (code) => {
      if (code !== 0) {
        if (NO_VIDEO_PATTERN.test(stderr)) {
          reject(new NoVideoError(`Sem vídeo no tweet ${tweetId}`));
        } else {
          reject(new Error(`yt-dlp falhou (código ${code}): ${stderr.trim().slice(-500)}`));
        }
        return;
      }

      const filePath = stdout.trim().split('\n').filter(Boolean).pop();
      if (!filePath) {
        reject(new Error('yt-dlp não imprimiu o caminho do arquivo baixado'));
        return;
      }
      resolve(filePath);
    });
  });
}

/** Vídeo pronto pra ser enviado por qualquer adaptador de mensageria. */
export interface PreparedVideo {
  /** Caminho local do arquivo a enviar (original ou recomprimido, o que couber no limite). */
  path: string;
  /** Tamanho final em bytes do arquivo em `path`. */
  size: number;
  /** Apaga todos os arquivos temporários gerados (original + recomprimido, se houver). */
  cleanup: () => Promise<void>;
}

/**
 * Baixa o vídeo de um tweet e, se passar de `maxBytes`, tenta recomprimir via
 * ffmpeg numa única passada de melhor esforço. Agnóstico de plataforma: cada
 * adaptador de mensageria passa o próprio limite de tamanho e decide o que
 * fazer se, mesmo após comprimir, o arquivo continuar grande demais.
 */
export async function prepareTweetVideo(tweetId: string, maxBytes: number): Promise<PreparedVideo> {
  const downloadedPath = await downloadTweetVideo(tweetId);
  let sendPath = downloadedPath;
  let compressedPath: string | undefined;
  let { size } = await stat(sendPath);

  if (size > maxBytes) {
    try {
      compressedPath = await compressVideo(sendPath);
      const compressedStat = await stat(compressedPath);
      if (compressedStat.size < size) {
        sendPath = compressedPath;
        size = compressedStat.size;
      }
    } catch (err) {
      console.error(`Falha ao recomprimir vídeo do tweet ${tweetId}:`, err);
      // segue com o arquivo original; quem chamou decide o que fazer se ainda estiver grande
    }
  }

  return {
    path: sendPath,
    size,
    cleanup: async () => {
      await unlink(downloadedPath).catch(() => {});
      if (compressedPath) await unlink(compressedPath).catch(() => {});
    },
  };
}
