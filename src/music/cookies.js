// Carrega cookies do YouTube (Netscape format) a partir da env var
// YOUTUBE_COOKIES_B64 e expoe o caminho do arquivo temporario.
//
// Para gerar:
// 1. Em um navegador, faca login em uma CONTA DESCARTAVEL do Google
//    (NAO use sua conta principal — se algo der errado, e essa conta
//    que sofre).
// 2. Use uma extensao "Get cookies.txt LOCALLY" (ou similar) e exporte
//    os cookies de youtube.com no formato Netscape.
// 3. Base64-encode o arquivo:
//      Windows PowerShell:
//        [Convert]::ToBase64String([IO.File]::ReadAllBytes("cookies.txt")) | clip
//      Linux/macOS:
//        base64 -w0 cookies.txt | pbcopy   (ou xclip)
// 4. Cole o resultado na env var YOUTUBE_COOKIES_B64 no Railway.

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let cookiesPath = null;

export function initCookies() {
  const b64 = process.env.YOUTUBE_COOKIES_B64;
  if (!b64) {
    console.warn(
      'YOUTUBE_COOKIES_B64 nao definido — playback pode falhar com "Sign in to confirm you\'re not a bot".',
    );
    return null;
  }

  try {
    const content = Buffer.from(b64, 'base64').toString('utf8');
    const path = join(tmpdir(), 'youtube-cookies.txt');
    writeFileSync(path, content, { mode: 0o600 });
    cookiesPath = path;
    console.log(`Cookies do YouTube carregados em ${path}.`);
    return path;
  } catch (err) {
    console.error('Falha ao decodificar YOUTUBE_COOKIES_B64:', err);
    return null;
  }
}

export function getCookiesPath() {
  return cookiesPath;
}

/**
 * Envelopa opts do yt-dlp injetando o flag `cookies` se houver arquivo carregado.
 */
export function withCookies(opts) {
  if (!cookiesPath) return opts;
  return { ...opts, cookies: cookiesPath };
}
