import { spawn } from 'node:child_process';

/**
 * Recomprime um vídeo via ffmpeg (reduz resolução e bitrate) numa única passada
 * de "melhor esforço" — não garante atingir um tamanho exato, só tenta reduzir
 * o suficiente pra caber no limite de mídia inline do WhatsApp.
 */
export function compressVideo(inputPath: string): Promise<string> {
  const outputPath = inputPath.replace(/\.[^./]+$/, '') + '.compressed.mp4';

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vf', "scale='min(1280,iw)':-2",
      '-c:v', 'libx264',
      '-crf', '28',
      '-preset', 'veryfast',
      '-c:a', 'aac',
      '-b:a', '128k',
      outputPath,
    ]);

    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('error', reject); // ex.: ffmpeg não instalado / não encontrado no PATH
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg falhou (código ${code}): ${stderr.trim().slice(-500)}`));
        return;
      }
      resolve(outputPath);
    });
  });
}
