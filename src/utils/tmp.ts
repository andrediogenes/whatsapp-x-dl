import { mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

export const TMP_DIR = 'tmp';

/**
 * Apaga tudo que sobrou em tmp/ de uma execução anterior que travou/caiu no
 * meio de um download (o cleanup normal roda no `finally` de cada envio, mas
 * um crash do processo pula isso). Deve ser chamado uma vez no boot — nada
 * legítimo deveria estar em tmp/ nesse momento.
 */
export async function cleanupOrphanedFiles(): Promise<void> {
  await mkdir(TMP_DIR, { recursive: true });
  const entries = await readdir(TMP_DIR);
  await Promise.all(entries.map((entry) => unlink(path.join(TMP_DIR, entry)).catch(() => {})));
}
