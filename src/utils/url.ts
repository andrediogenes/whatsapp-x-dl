// Link direto: x.com ou twitter.com com /status/<id numérico>. Aceita qualquer coisa
// depois (query string tipo ?s=46, texto extra na mensagem etc.) já que \d+ para de
// casar no primeiro caractere não-numérico.
const TWEET_URL_REGEX = /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^/\s]+\/status\/(\d+)/i;

// t.co é o encurtador do próprio Twitter/X — a URL curta não contém o ID do tweet,
// só existe depois de seguir o redirect.
const T_CO_URL_REGEX = /https?:\/\/t\.co\/\w+/i;

/** Acha a primeira URL de tweet (direta ou t.co) dentro de um texto qualquer. */
export function findTwitterUrl(text: string): string | undefined {
  return text.match(TWEET_URL_REGEX)?.[0] ?? text.match(T_CO_URL_REGEX)?.[0];
}

/** Segue o redirect de uma URL curta (t.co) e devolve a URL final. */
async function resolveShortUrl(url: string): Promise<string> {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  return res.url;
}

/**
 * Extrai o ID numérico do tweet de um texto de mensagem, resolvendo link t.co
 * se necessário. Devolve undefined se não achar link do X/Twitter reconhecível.
 */
export async function extractTweetId(text: string): Promise<string | undefined> {
  const url = findTwitterUrl(text);
  if (!url) return undefined;

  const directMatch = url.match(TWEET_URL_REGEX);
  if (directMatch) return directMatch[1];

  // Só sobra o caso t.co daqui pra baixo — precisa resolver o redirect.
  try {
    const resolved = await resolveShortUrl(url);
    return resolved.match(TWEET_URL_REGEX)?.[1];
  } catch {
    return undefined;
  }
}
