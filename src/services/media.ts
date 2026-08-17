import { runCommand } from '../utils/process.js';

const COMPRESS_TIMEOUT_MS = 90_000;

/**
 * Recomprime um vídeo via ffmpeg (reduz resolução e bitrate) numa única passada
 * de "melhor esforço" — não garante atingir um tamanho exato, só tenta reduzir
 * o suficiente pra caber no limite de mídia inline da plataforma de destino.
 */
export async function compressVideo(inputPath: string): Promise<string> {
  const outputPath = inputPath.replace(/\.[^./]+$/, '') + '.compressed.mp4';

  const { code, stderr } = await runCommand('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vf', "scale='min(1280,iw)':-2",
    '-c:v', 'libx264',
    '-crf', '28',
    '-preset', 'veryfast',
    '-c:a', 'aac',
    '-b:a', '128k',
    outputPath,
  ], COMPRESS_TIMEOUT_MS);

  if (code !== 0) {
    throw new Error(`ffmpeg falhou (código ${code}): ${stderr.trim().slice(-500)}`);
  }
  return outputPath;
}
