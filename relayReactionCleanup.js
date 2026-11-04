'use strict';
const db = require('./db.js');
let state = { messages: {}, reactions: [] };
let flushTimer = null;
let loaded = false;
async function load() {
  try { state = await db.loadRelayState(); loaded = true; }
  catch (err) { console.error('[Relay reactions] Turso load failed:', err.message); throw err; }
}
function flush() {
  flushTimer = null;
  if (!loaded) return;
  db.saveRelayState(state).catch(err => console.error('[Relay reactions] Turso save failed:', err.message));
}
function saveSoon() { if (flushTimer) return; flushTimer = setTimeout(flush, 1000); if (typeof flushTimer.unref === 'function') flushTimer.unref(); }
function messageKey(message) { return `${message.guild?.id || ''}:${message.id}`; }
function registerRelayMessage(message) {
  if (!message?.guild || !message.id) return;
  state.messages[messageKey(message)] = { guildId: message.guild.id, channelId: message.channel.id, messageId: message.id };
  const keys = Object.keys(state.messages);
  if (keys.length > 5000) delete state.messages[keys[0]];
  saveSoon();
}
function reactionKey(r) { return r?.emoji?.identifier || r?.emoji?.id || r?.emoji?.name || ''; }
function attachRelayReactionCleanup(client) {
  load().catch(() => { setTimeout(() => load().catch(err => console.error('[Relay reactions] Retry load failed:', err.message)), 5000).unref?.(); });
  client.on('messageReactionAdd', (reaction, user) => {
    if (user?.bot || !reaction?.message?.guild) return;
    const key = messageKey(reaction.message); const emoji = reactionKey(reaction);
    if (!state.messages[key] || !emoji) return;
    state.reactions = state.reactions.filter(x => !(x.messageKey === key && x.userId === user.id && x.emoji === emoji));
    state.reactions.push({ messageKey: key, guildId: reaction.message.guild.id, channelId: reaction.message.channel.id, messageId: reaction.message.id, userId: user.id, emoji });
    saveSoon();
  });
  client.on('guildMemberRemove', async member => {
    if (!member?.id || !member.guild?.id) return;
    const leaving = state.reactions.filter(x => x.guildId === member.guild.id && x.userId === member.id);
    if (!leaving.length) return;
    for (const item of leaving) {
      try {
        const channel = member.guild.channels.cache.get(item.channelId) || await member.guild.channels.fetch(item.channelId).catch(() => null);
        const message = channel?.messages ? await channel.messages.fetch(item.messageId).catch(() => null) : null;
        if (!message) continue;
        const reaction = message.reactions.cache.find(r => reactionKey(r) === item.emoji);
        if (reaction) await reaction.users.remove(member.id).catch(() => {});
      } catch (err) { console.warn(`[Relay reactions] Cleanup failed for ${member.id}:`, err.message); }
    }
    state.reactions = state.reactions.filter(x => !(x.guildId === member.guild.id && x.userId === member.id));
    saveSoon();
    console.log(`[Relay reactions] Removed ${leaving.length} reaction(s) for departed member ${member.id}.`);
  });
}
module.exports = { attachRelayReactionCleanup, registerRelayMessage };
