import { SlashCommandBuilder, MessageFlags, PermissionsBitField } from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import youtubeDl from 'youtube-dl-exec';
import { getEntry, setEntry, clearEntry } from '../music/state.js';

export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Toca uma URL do YouTube. Sem URL, retoma uma musica pausada.')
    .addStringOption((o) =>
      o
        .setName('url')
        .setDescription('URL do video do YouTube (opcional — sem ela, retoma o que estava pausado)')
        .setRequired(false),
    ),

  async execute(interaction) {
    const url = interaction.options.getString('url');

    // Caso 1: sem URL — tenta retomar uma musica pausada
    if (!url) {
      const entry = getEntry(interaction.guildId);
      const status = entry?.player.state.status;
      if (
        entry &&
        (status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused)
      ) {
        entry.player.unpause();
        await interaction.reply('Retomado.');
        return;
      }
      await interaction.reply({
        content: 'Nada pausado para retomar. Passa uma URL: `/play url:<link>`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Caso 2: com URL — tocar nova musica. Precisa estar num canal de voz.
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply({
        content: 'Entra num canal de voz antes de usar /play.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Confere se o bot consegue entrar e falar
    const me = interaction.guild.members.me;
    const perms = voiceChannel.permissionsFor(me);
    if (
      !perms?.has(PermissionsBitField.Flags.Connect) ||
      !perms?.has(PermissionsBitField.Flags.Speak)
    ) {
      await interaction.reply({
        content: 'Nao tenho permissao para conectar ou falar nesse canal de voz.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    // 1) Metadata (titulo, duracao) - chamada leve
    let info;
    try {
      info = await youtubeDl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noPlaylist: true,
        skipDownload: true,
      });
    } catch (err) {
      console.error('yt-dlp metadata falhou:', err);
      await interaction.editReply(
        'Nao consegui obter o video (URL invalida, privado ou bloqueado?).',
      );
      return;
    }

    // 2) Se ja tinha algo tocando neste guild, derruba antes
    const existing = getEntry(interaction.guildId);
    if (existing) {
      try {
        existing.player.stop(true);
        existing.subprocess?.kill?.();
        existing.connection.destroy();
      } catch {
        /* ignore */
      }
      clearEntry(interaction.guildId);
    }

    // 3) Conecta no canal de voz
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch (err) {
      console.error('Falha ao entrar no canal de voz:', err);
      connection.destroy();
      await interaction.editReply('Nao consegui me conectar ao canal de voz.');
      return;
    }

    // 4) Inicia o stream via subprocess do yt-dlp (mais robusto que URL fetchada)
    const subprocess = youtubeDl.exec(
      url,
      {
        output: '-',
        format: 'bestaudio',
        quiet: true,
        noPlaylist: true,
      },
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );

    if (!subprocess.stdout) {
      connection.destroy();
      await interaction.editReply('Falha ao abrir o stream do yt-dlp.');
      return;
    }

    subprocess.catch?.((err) => {
      // execa rejeita o promise quando o processo morre com codigo != 0.
      // Se a gente matou via .kill() de proposito, ignoramos.
      if (err?.killed) return;
      console.error('yt-dlp subprocess error:', err.shortMessage || err.message || err);
    });

    const resource = createAudioResource(subprocess.stdout);
    const player = createAudioPlayer();

    setEntry(interaction.guildId, { connection, player, subprocess });

    player.on('error', (err) => {
      console.error('AudioPlayer error:', err);
    });

    // Quando a musica acaba, sai do canal e limpa o estado
    player.on(AudioPlayerStatus.Idle, () => {
      const current = getEntry(interaction.guildId);
      if (current?.player !== player) return; // ja foi substituido por outro /play
      try {
        subprocess.kill?.();
        connection.destroy();
      } catch {
        /* ignore */
      }
      clearEntry(interaction.guildId);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        // Voltou — provavelmente um move de canal
      } catch {
        // Nao reconectou — derruba tudo
        const current = getEntry(interaction.guildId);
        if (current?.connection === connection) {
          try {
            subprocess.kill?.();
            connection.destroy();
          } catch {
            /* ignore */
          }
          clearEntry(interaction.guildId);
        }
      }
    });

    connection.subscribe(player);
    player.play(resource);

    const minutes = Math.floor((info.duration ?? 0) / 60);
    const seconds = String((info.duration ?? 0) % 60).padStart(2, '0');
    await interaction.editReply(`Tocando: **${info.title}** (${minutes}:${seconds})`);
  },
};
