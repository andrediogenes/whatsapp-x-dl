// Fila serial global: garante que só um download/envio roda por vez, evitando
// que múltiplos links em sequência disputem CPU/banda ou pisem em arquivos
// temporários uns dos outros. Suficiente pra um bot pessoal de uso único —
// não precisa de fila distribuída/persistente.
let tail: Promise<void> = Promise.resolve();

/** Enfileira uma tarefa assíncrona, que só roda depois que a anterior terminar. */
export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = tail.then(task, task);
  tail = result.then(
    () => undefined,
    () => undefined, // uma falha na tarefa não deve travar a fila pras próximas
  );
  return result;
}
