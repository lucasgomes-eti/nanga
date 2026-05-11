import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { AudioPlayerStatus } from '@discordjs/voice';
import { getEntry } from '../music/state.js';

export default {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pausa a musica atual. Use /play (sem URL) para retomar.'),

  async execute(interaction) {
    const entry = getEntry(interaction.guildId);
    if (!entry) {
      await interaction.reply({
        content: 'Nao estou tocando nada.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const status = entry.player.state.status;

    if (status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused) {
      await interaction.reply({
        content: 'Ja esta pausado. Use `/play` (sem URL) para retomar.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (status !== AudioPlayerStatus.Playing && status !== AudioPlayerStatus.Buffering) {
      await interaction.reply({
        content: 'Nao ha musica tocando para pausar.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    entry.player.pause();
    await interaction.reply('Pausado. Use `/play` (sem URL) para retomar.');
  },
};
