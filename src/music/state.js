// Estado de reproducao por guild (servidor). Mantemos referencia para
// connection + player + subprocess do yt-dlp para que /stop e o cleanup
// automatico no fim da musica saibam o que derrubar.

const state = new Map();

export function getEntry(guildId) {
  return state.get(guildId);
}

export function setEntry(guildId, entry) {
  state.set(guildId, entry);
}

export function clearEntry(guildId) {
  state.delete(guildId);
}
