import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Responde com pong e mostra a latencia.'),
  async execute(interaction) {
    const sent = await interaction.reply({ content: 'Pong!', withResponse: true });
    const reply = sent.resource?.message ?? (await interaction.fetchReply());
    const latency = reply.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(`Pong! Latencia: ${latency}ms`);
  },
};
