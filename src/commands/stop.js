import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getEntry, clearEntry } from '../music/state.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Para a musica atual e sai do canal de voz.'),

  async execute(interaction) {
    const entry = getEntry(interaction.guildId);
    if (!entry) {
      await interaction.reply({
        content: 'Nao estou tocando nada agora.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      entry.player.stop(true);
    } catch {
      /* ignore */
    }
    try {
      entry.subprocess?.kill?.();
    } catch {
      /* ignore */
    }
    try {
      entry.connection.destroy();
    } catch {
      /* ignore */
    }

    clearEntry(interaction.guildId);

    await interaction.reply('Parado.');
  },
};
