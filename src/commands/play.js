import { SlashCommandBuilder, MessageFlags, PermissionsBitField } from 'discord.js';
import { AudioPlayerStatus } from '@discordjs/voice';
import { getEntry, clearEntry } from '../music/state.js';
import { ensureSession, fetchTracks, playNow, formatDuration } from '../music/player.js';

export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Toca uma URL ou playlist do YouTube. Sem URL, retoma a pausada.')
    .addStringOption((o) =>
      o
        .setName('url')
        .setDescription('URL do YouTube (video ou playlist). Sem ela, retoma o que estava pausado.')
        .setRequired(false),
    ),

  async execute(interaction) {
    const url = interaction.options.getString('url');

    // Caso 1: sem URL — tenta retomar musica pausada
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

    // Caso 2: com URL — interrompe o que estiver tocando e toca o novo
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply({
        content: 'Entra num canal de voz antes de usar /play.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

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

    let result;
    try {
      result = await fetchTracks(url);
    } catch (err) {
      console.error('yt-dlp metadata falhou:', err);
      await interaction.editReply(
        'Nao consegui obter o video/playlist (URL invalida, privado ou bloqueado?).',
      );
      return;
    }

    if (result.tracks.length === 0) {
      await interaction.editReply('Playlist vazia ou sem videos acessiveis.');
      return;
    }

    // /play interrompe: derruba sessao existente para tocar do zero
    const existing = getEntry(interaction.guildId);
    if (existing) {
      try {
        existing.subprocess?.kill?.();
      } catch {
        /* ignore */
      }
      try {
        existing.connection.destroy();
      } catch {
        /* ignore */
      }
      clearEntry(interaction.guildId);
    }

    let entry;
    try {
      entry = await ensureSession(interaction.guildId, voiceChannel);
    } catch (err) {
      console.error('Falha ao entrar no canal de voz:', err);
      await interaction.editReply('Nao consegui me conectar ao canal de voz.');
      return;
    }

    const [first, ...rest] = result.tracks;
    entry.queue.push(...rest);
    playNow(interaction.guildId, first);

    if (result.isPlaylist) {
      const playlistName = result.playlistTitle ?? '(sem nome)';
      await interaction.editReply(
        `Tocando: **${first.title}** — ${rest.length} musica(s) enfileiradas da playlist "${playlistName}".`,
      );
    } else {
      const dur = formatDuration(first.duration);
      await interaction.editReply(`Tocando: **${first.title}**${dur ? ` (${dur})` : ''}`);
    }
  },
};
