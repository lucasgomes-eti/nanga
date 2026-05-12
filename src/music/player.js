// Logica de playback compartilhada por /play e /queue.
//
// - fetchTracks(url): chama yt-dlp para extrair video unico ou playlist.
// - ensureSession(guildId, voiceChannel): garante uma conexao de voz ativa.
//     Se ja existe, retorna a existente (mesmo canal de antes).
//     Se nao, joina o canal e monta connection + player + handlers.
// - playNow(guildId, track): inicia o stream da track passada (mata o anterior).
//
// O avanco automatico da fila acontece no handler de AudioPlayerStatus.Idle
// definido em ensureSession. Quando a fila esvazia, a conexao e destruida.

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  demuxProbe,
} from '@discordjs/voice';
import youtubeDl from 'youtube-dl-exec';
import { getEntry, setEntry, clearEntry } from './state.js';
import { withCookies } from './cookies.js';

/**
 * Extrai metadata "rasa" (titulo, url, duracao) de uma URL.
 * Pode retornar 1 track (video unico) ou varias (playlist).
 */
export async function fetchTracks(url) {
  const info = await youtubeDl(
    url,
    withCookies({
      dumpSingleJson: true,
      flatPlaylist: true,
      noWarnings: true,
      skipDownload: true,
    }),
  );

  const isPlaylist = info?._type === 'playlist' || Array.isArray(info?.entries);

  if (isPlaylist) {
    const tracks = (info.entries ?? [])
      .map((e) => {
        if (!e) return null;
        const trackUrl = e.url?.startsWith('http')
          ? e.url
          : e.id
            ? `https://www.youtube.com/watch?v=${e.id}`
            : null;
        if (!trackUrl) return null;
        return {
          title: e.title ?? '(sem titulo)',
          url: trackUrl,
          duration: e.duration ?? null,
        };
      })
      .filter(Boolean);

    return {
      tracks,
      isPlaylist: true,
      playlistTitle: info.title ?? null,
    };
  }

  return {
    tracks: [
      {
        title: info.title ?? '(sem titulo)',
        url,
        duration: info.duration ?? null,
      },
    ],
    isPlaylist: false,
    playlistTitle: null,
  };
}

/**
 * Garante uma sessao de voz ativa para o guild.
 * Se ja existe, retorna sem criar nada.
 */
export async function ensureSession(guildId, voiceChannel) {
  const existing = getEntry(guildId);
  if (existing) return existing;

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

  const player = createAudioPlayer();
  connection.subscribe(player);

  const entry = {
    connection,
    player,
    subprocess: null,
    current: null,
    queue: [],
  };
  setEntry(guildId, entry);

  player.on('error', (err) => {
    console.error('AudioPlayer error:', err);
  });

  // Avanca a fila quando a track atual termina (ou se yt-dlp falhar e o stream morrer).
  player.on(AudioPlayerStatus.Idle, () => {
    const current = getEntry(guildId);
    if (current?.player !== player) return;

    const next = current.queue.shift();
    if (!next) {
      try {
        current.subprocess?.kill?.();
      } catch {
        /* ignore */
      }
      try {
        connection.destroy();
      } catch {
        /* ignore */
      }
      clearEntry(guildId);
      return;
    }
    playNow(guildId, next);
  });

  // Auto-cleanup se a conexao cair sem reconectar.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // Reconectou (provavelmente um move) — segue a vida
    } catch {
      const current = getEntry(guildId);
      if (current?.connection !== connection) return; // ja foi substituido
      try {
        current.subprocess?.kill?.();
      } catch {
        /* ignore */
      }
      try {
        connection.destroy();
      } catch {
        /* ignore */
      }
      clearEntry(guildId);
    }
  });

  return entry;
}

/**
 * Inicia o stream da track na sessao atual, substituindo a track anterior.
 *
 * Estrategia: pedir pro yt-dlp preferir Opus em container webm. Aí o
 * demuxProbe consegue desmontar o webm e mandar pacotes Opus direto pro
 * Discord — pulando o FFmpeg, que e pesado em CPU constrained.
 *
 * Se o formato nao for reconhecivel (fallback m4a/AAC), o demuxProbe deixa
 * a stream cair no pipeline padrao, que passa por FFmpeg.
 */
export async function playNow(guildId, track) {
  const entry = getEntry(guildId);
  if (!entry) return;

  // Mata subprocess anterior, se houver
  try {
    entry.subprocess?.kill?.();
  } catch {
    /* ignore */
  }

  const subprocess = youtubeDl.exec(
    track.url,
    withCookies({
      output: '-',
      // Prefere webm/opus (formats 251/250/249). Se nao houver, cai em qualquer audio.
      format: 'bestaudio[acodec=opus]/bestaudio',
      quiet: true,
      noPlaylist: true,
    }),
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );

  subprocess.catch?.((err) => {
    if (err?.killed) return; // matamos de proposito
    console.error('yt-dlp subprocess error:', err.shortMessage || err.message || err);
  });

  entry.subprocess = subprocess;
  entry.current = track;

  let resource;
  try {
    const { stream, type } = await demuxProbe(subprocess.stdout);
    resource = createAudioResource(stream, { inputType: type });
  } catch (err) {
    console.error('demuxProbe falhou:', err);
    // Forca avanco para a proxima track via Idle handler
    try {
      subprocess.kill?.();
    } catch {
      /* ignore */
    }
    entry.player.stop(true);
    return;
  }

  entry.player.play(resource);
}

/**
 * Helper para mostrar duracao em mm:ss.
 */
export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${m}:${s}`;
}
