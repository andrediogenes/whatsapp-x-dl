import { spawn } from 'node:child_process';

/** O comando externo (yt-dlp, ffmpeg) excedeu o tempo limite e foi encerrado. */
export class TimeoutError extends Error {}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Roda um comando externo capturando stdout/stderr, matando o processo se
 * passar de `timeoutMs`. Usado tanto pelo yt-dlp quanto pelo ffmpeg — os dois
 * podem travar (rede lenta, tweet problemático, etc.) e não devem prender a
 * fila indefinidamente.
 */
export function runCommand(command: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err); // ex.: comando não encontrado no PATH
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new TimeoutError(`${command} excedeu o tempo limite de ${Math.round(timeoutMs / 1000)}s`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}
