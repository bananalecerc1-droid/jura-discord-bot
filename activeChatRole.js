const db = require('./db.js');
const GUILD_ID = '1374859719046463569';
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const { loadLocalXP } = require('./localTrust.js');
let state = {};
const pendingRoleOps = new Set();
async function loadState() {
  try { state = await db.getChatActivityAll(); }
  catch (err) { console.error('[ActiveChatRole] Turso load failed:', err.message); state = {}; }
}
function rememberMessage(guildId, userId) {
  state[guildId] ||= {};
  const timestamp = Date.now();
  state[guildId][userId] = timestamp;
  db.upsertChatActivity(guildId, userId, timestamp).catch(err => console.error('[ActiveChatRole] Turso save failed:', err.message));
}
function getSettings(getConfig) {
  const cfg = getConfig?.() || {};
  const value = cfg.activeChatRole || {};
  const inactivityDays = Math.min(365, Math.max(1, Number(value.inactivityDays) || 7));
  return {
    enabled: !!value.enabled,
    roleId: String(value.roleId || ''),
    inactivityDays,
    requiredXp: Math.min(1000000000, Math.max(0, Number(value.requiredXp) || 0)),
  };
}

function rememberMessage(guildId, userId) {
  if (!state[guildId]) state[guildId] = {};
  state[guildId][userId] = Date.now();
  scheduleFlush();
}

async function assignIfNeeded(member, role, reason) {
  if (!member || member.user?.bot || !role || member.roles.cache.has(role.id)) return false;
  const key = `${member.guild.id}:${member.id}`;
  if (pendingRoleOps.has(key)) return false;
  pendingRoleOps.add(key);
  try {
    await member.roles.add(role, reason);
    return true;
  } catch (err) {
    console.warn(`[ActiveChatRole] Could not assign to ${member.user?.tag || member.id}:`, err.message);
    return false;
  } finally {
    pendingRoleOps.delete(key);
  }
}

async function removeIfNeeded(member, role, reason) {
  if (!member || member.user?.bot || !role || !member.roles.cache.has(role.id)) return false;
  const key = `${member.guild.id}:${member.id}`;
  if (pendingRoleOps.has(key)) return false;
  pendingRoleOps.add(key);
  try {
    await member.roles.remove(role, reason);
    return true;
  } catch (err) {
    console.warn(`[ActiveChatRole] Could not remove from ${member.user?.tag || member.id}:`, err.message);
    return false;
  } finally {
    pendingRoleOps.delete(key);
  }
}

async function resolveRole(guild, roleId) {
  if (!guild || !roleId) return null;
  return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
}

async function sweepActiveChatRole(client, getConfig) {
  const settings = getSettings(getConfig);
  if (!settings.enabled || !settings.roleId) return { added: 0, removed: 0, skipped: 0 };
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return { added: 0, removed: 0, skipped: 0 };
  const role = await resolveRole(guild, settings.roleId);
  if (!role || role.managed) return { added: 0, removed: 0, skipped: 0 };
  const cutoff = Date.now() - settings.inactivityDays * 24 * 60 * 60 * 1000;
  const activity = state[GUILD_ID] || {};
  const xp = loadLocalXP();
  let added = 0;
  let removed = 0;
  let skipped = 0;

  await guild.members.fetch({ withPresences: false }).catch(() => null);
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    const lastMessage = Number(activity[member.id] || 0);
    const qualifies = lastMessage && lastMessage >= cutoff && Number(xp[member.id] || 0) >= settings.requiredXp;
    if (qualifies) {
      if (await assignIfNeeded(member, role, 'Active chat role sync')) added++;
    } else if (await removeIfNeeded(member, role, 'Member inactive in chat')) {
      removed++;
    } else {
      skipped++;
    }
  }
  return { added, removed, skipped };
}

async function syncActiveChatRole(client, getConfig, roleIdOverride = '') {
  const settings = getSettings(getConfig);
  const roleId = String(roleIdOverride || settings.roleId || '');
  if (!roleId) throw new Error('Select a role before syncing.');
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) throw new Error(`Dashboard guild ${GUILD_ID} is unavailable`);
  const role = await resolveRole(guild, roleId);
  if (!role) throw new Error('Selected role was not found in the Jura guild.');
  if (role.id === guild.id || role.managed) throw new Error('That role cannot be assigned automatically.');
  const me = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
  if (!me || role.position >= me.roles.highest.position) throw new Error('The bot role must be higher than the selected role.');

  const result = await sweepActiveChatRole(client, () => ({ activeChatRole: { ...settings, roleId } }));
  return { ok: true, role: role.name, ...result };
}

function startActiveChatRole(client, getConfig) {
  loadState().catch(() => {});
  client.on('messageCreate', (message) => {
    if (!message || message.author?.bot || !message.guild || message.guild.id !== GUILD_ID) return;
    const settings = getSettings(getConfig);
    if (!settings.enabled || !settings.roleId) return;
    rememberMessage(message.guild.id, message.author.id);
    const role = message.guild.roles.cache.get(settings.roleId);
    const xp = loadLocalXP();
    if (role && message.member && Number(xp[message.author.id] || 0) >= settings.requiredXp) assignIfNeeded(message.member, role, 'Recent chat activity').catch(() => {});
  });

  const timer = setInterval(() => sweepActiveChatRole(client, getConfig).catch(err => console.error('[ActiveChatRole] Sweep failed:', err.message)), SWEEP_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  setTimeout(() => sweepActiveChatRole(client, getConfig).catch(err => console.error('[ActiveChatRole] Initial sync failed:', err.message)), 15000).unref?.();
}

module.exports = { startActiveChatRole, syncActiveChatRole, getActiveChatRoleSettings: getSettings };
