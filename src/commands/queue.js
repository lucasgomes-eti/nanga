import { SlashCommandBuilder, MessageFlags, PermissionsBitField } from 'discord.js';
import { getEntry } from '../music/state.js';
import { ensureSession, fetchTracks, playNow } from '../music/player.js';

export default {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Adiciona uma URL ou playlist do YouTube ao final da fila.')
    .addStringOption((o) =>
      o
        .setName('url')
        .setDescription('URL do YouTube (video ou playlist)')
        .setRequired(true),
    ),

  async execute(interaction) {
    const url = interaction.options.getString('url', true);
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

    const existing = getEntry(interaction.guildId);

    // Caso A: ja tem algo tocando — so anexa na fila, sem interromper
    if (existing) {
      existing.queue.push(...result.tracks);
      const total = existing.queue.length;
      if (result.isPlaylist) {
        const playlistName = result.playlistTitle ?? '(sem nome)';
        await interaction.editReply(
          `Adicionadas ${result.tracks.length} musicas da playlist "${playlistName}" a fila. (${total} na fila)`,
        );
      } else {
        await interaction.editReply(
          `Adicionado a fila: **${result.tracks[0].title}**. (${total} na fila)`,
        );
      }
      return;
    }

    // Caso B: nada tocando — para iniciar a fila precisa do usuario num canal de voz
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.editReply(
        'Nao estou tocando nada e voce nao esta num canal de voz — nao da pra comecar a fila do nada.',
      );
      return;
    }

    const me = interaction.guild.members.me;
    const perms = voiceChannel.permissionsFor(me);
    if (
      !perms?.has(PermissionsBitField.Flags.Connect) ||
      !perms?.has(PermissionsBitField.Flags.Speak)
    ) {
      await interaction.editReply('Nao tenho permissao para conectar ou falar nesse canal de voz.');
      return;
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
        `Iniciando: **${first.title}** — ${rest.length} musica(s) enfileiradas da playlist "${playlistName}".`,
      );
    } else {
      await interaction.editReply(`Iniciando: **${first.title}**`);
    }
  },
};
