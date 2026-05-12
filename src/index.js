import 'dotenv/config';
import {
  Client,
  Collection,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
} from 'discord.js';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initCookies } from './music/cookies.js';

initCookies();

const __dirname = dirname(fileURLToPath(import.meta.url));

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token) {
  console.error('DISCORD_TOKEN nao definido. Crie um arquivo .env (veja .env.example).');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.commands = new Collection();

// --- Carrega comandos da pasta src/commands ---
const commandsDir = join(__dirname, 'commands');
const commandPayloads = [];
for (const file of readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const mod = await import(pathToFileURL(join(commandsDir, file)).href);
  const command = mod.default;
  if (!command?.data || !command?.execute) {
    console.warn(`Comando ignorado (sem data/execute): ${file}`);
    continue;
  }
  client.commands.set(command.data.name, command);
  commandPayloads.push(command.data.toJSON());
}

// --- Registra slash commands ao iniciar ---
async function registerCommands() {
  if (!clientId) {
    console.warn('DISCORD_CLIENT_ID nao definido — pulando registro de slash commands.');
    return;
  }
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commandPayloads,
      });
      console.log(`Registrados ${commandPayloads.length} comandos no guild ${guildId}.`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commandPayloads });
      console.log(`Registrados ${commandPayloads.length} comandos globais.`);
    }
  } catch (err) {
    console.error('Falha ao registrar slash commands:', err);
  }
}

client.once('clientReady', async (c) => {
  console.log(`Conectado como ${c.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Erro no comando ${interaction.commandName}:`, err);
    const payload = { content: 'Deu erro ao executar o comando.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));

client.login(token);
