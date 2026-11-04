const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { sendQuoteNow } = require('./src/features/autoQuote.js');
const { sendApplicationEmbed } = require('./src/features/staffApp.js');
const { sendStaffPanel } = require('./src/features/staffPanel.js');
const { resolveImgbbUrl } = require('./imageUtils.js');
const db = require('./db.js');
const backup = require('./backupSystem.js');
const { syncActiveChatRole } = require('./activeChatRole.js');

const CONFIG_FILE = path.join(__dirname, 'botConfig.json');
const TOKENS = new Set();
const DASHBOARD_GUILD_ID = '1374859719046463569';
function getDashboardGuild(discordClient) {
  return discordClient?.guilds?.cache?.get(DASHBOARD_GUILD_ID) || null;
}

// ── In-memory config cache (backed by Supabase) ───────────────────────────────
let configCache = null;

// Canonical list of every slash command currently registered by the bot
// (kept in sync with deploy-commands.js). loadConfig() uses this to
// auto-heal botConfig.json: newly added commands appear automatically,
// and commands that no longer exist are dropped — so the dashboard
// (command list + alias dropdown) never goes stale again.
const CANONICAL_COMMANDS = [
  'birthday', 'play', 'skip', 'stop', 'pause', 'resume', 'queue', 'nowplaying',
  'loop', 'sessions', 'volume',
  'warn', 'warnings', 'clearwarns', 'mute', 'unmute', 'kick', 'ban', 'unban', 'giverole', 'removerole', 'deletemsg',
  'ship', 'kiss', 'hug', 'slap', 'pat', 'cuddle', 'byte', 'lipkiss',
  'happy', 'angry', 'sad', 'cry', 'laugh', 'dance', 'wave', 'son',
  'numguess', 'trivia', 'blackjack', 'minesweeper', 'slots', 'cat', 'race',
  'rank', 'leaderboard', 'streak', 'setbg', 'resetbg', 'roulette', 'توقيف',
  'giveaway', 'سجن', 'فك_سجن', 'say', 'ticket',
  'userinfo', 'avatar', 'banner', 'close', 'rename',
  'nickname', 'resetstaffpoints',
];

function healConfig(cfg) {
  if (!cfg.commands) cfg.commands = {};
  if (!cfg.aliases || typeof cfg.aliases !== 'object' || Array.isArray(cfg.aliases)) {
    cfg.aliases = {};
  }
  let changed = false;

  // Built-in roulette stop shortcut; it is also visible/editable in Dashboard > Aliases.
  if (!Object.prototype.hasOwnProperty.call(cfg.aliases, '-توقيف')) {
    cfg.aliases['-توقيف'] = 'توقيف';
    changed = true;
  }
  // Built-in nickname shortcut; also visible/editable in Dashboard > Aliases.
  if (!Object.prototype.hasOwnProperty.call(cfg.aliases, '-نك')) {
    cfg.aliases['-نك'] = 'nickname';
    changed = true;
  }

  for (const name of CANONICAL_COMMANDS) {
    if (!cfg.commands[name]) {
      cfg.commands[name] = { enabled: true, allowedRoles: [], blockedRoles: [], allowedChannels: [] };
      changed = true;
    }
  }
  for (const name of Object.keys(cfg.commands)) {
    if (!CANONICAL_COMMANDS.includes(name)) {
      delete cfg.commands[name];
      changed = true;
    }
  }

  const rouletteDefaults = {
    allowedRoleId: '',
    startTime: 50,
    chooseTimeout: 30,
    timeBetweenRounds: 10,
    maxPlayers: 40,
    presentation: {
      embedTitle: '🎲 بدء لعبة الروليت',
      embedDescription: 'انضم إلى اللعبة بالضغط على الزر أدناه.\n\n**{count}/{max}** لاعبين انضموا',
      imageUrl: '',
      embedColor: '#5865F2',
      joinButtonLabel: 'انضم إلى اللعبة',
      joinButtonColor: 'Success',
      leaveButtonLabel: 'غادر اللعبة',
      leaveButtonColor: 'Danger',
      kickButtonColor: 'Secondary',
      actionButtonColor: 'Primary',
      paginationButtonColor: 'Primary',
    },
  };
  if (!cfg.roulette) {
    cfg.roulette = rouletteDefaults;
    changed = true;
  } else {
    for (const [key, value] of Object.entries(rouletteDefaults)) {
      if (cfg.roulette[key] === undefined) {
        cfg.roulette[key] = value;
        changed = true;
      }
    }
    if (!cfg.roulette.presentation) {
      cfg.roulette.presentation = { ...rouletteDefaults.presentation };
      changed = true;
    } else {
      for (const [key, value] of Object.entries(rouletteDefaults.presentation)) {
        if (cfg.roulette.presentation[key] === undefined) {
          cfg.roulette.presentation[key] = value;
          changed = true;
        }
      }
    }
  }

  const inviteDefaults = {
    enabled: false,
    guildId: DASHBOARD_GUILD_ID,
    channelId: '',
    panelMessageId: '',
    embedTitle: 'نظام الدعوات 💌',
    embedDescription: 'ادع أصدقاءك للسيرفر واحصل على رتب حصرية!\n\nاستخدم الأزرار بالأسفل لإدارة دعوتك',
    embedColor: '#2ecc71',
    imageUrl: '',
    buttonLabels: {
      link: '🔗 رابطك الخاص',
      mine: '📊 دعواتي',
      joiners: '👤 من دخل من رابطي',
      top: '🏆 توب الدعوات',
    },
    rewards: [
      { threshold: 15, roleId: '', label: 'برونزي' },
      { threshold: 30, roleId: '', label: 'فضي' },
      { threshold: 70, roleId: '', label: 'ذهبي' },
      { threshold: 100, roleId: '', label: 'ماسي' },
    ],
  };
  if (!cfg.inviteSystem) {
    cfg.inviteSystem = inviteDefaults;
    changed = true;
  } else {
    for (const [key, value] of Object.entries(inviteDefaults)) {
      if (cfg.inviteSystem[key] === undefined) {
        cfg.inviteSystem[key] = Array.isArray(value) ? value.map(x => ({ ...x })) : (value && typeof value === 'object' ? { ...value } : value);
        changed = true;
      }
    }
    cfg.inviteSystem.buttonLabels = { ...inviteDefaults.buttonLabels, ...(cfg.inviteSystem.buttonLabels || {}) };
    if (!Array.isArray(cfg.inviteSystem.rewards)) cfg.inviteSystem.rewards = inviteDefaults.rewards.map(x => ({ ...x }));
    if (cfg.inviteSystem.embedTitle === 'نظام الدعوات') {
      cfg.inviteSystem.embedTitle = inviteDefaults.embedTitle;
      changed = true;
    }
    if (cfg.inviteSystem.embedDescription === 'ادعُ أصدقاءك للسيرفر واحصل على رتب حصرية!\n\nاستخدم الأزرار بالأسفل لإدارة دعوتك.') {
      cfg.inviteSystem.embedDescription = inviteDefaults.embedDescription;
      changed = true;
    }
  }

  // ── Migrate legacy single-panel ticket config (cfg.ticket) → cfg.ticketPanels[] ──
  // Runs once: if an old single-panel config exists and no panels array has been
  // created yet, wrap the old config as the first panel so nothing is lost and
  // existing panel buttons already posted in Discord keep working (see the
  // legacy customId fallback in index.js's ticket_open_ handler).
  if (!Array.isArray(cfg.ticketPanels)) cfg.ticketPanels = [];
  if (cfg.ticket && Object.keys(cfg.ticket).length && cfg.ticketPanels.length === 0) {
    cfg.ticketPanels.push({
      id: 'legacy-' + Date.now().toString(36),
      name: 'Support',
      embedTitle: cfg.ticket.embedTitle || '',
      embedDescription: cfg.ticket.embedDescription || '',
      embedColor: cfg.ticket.embedColor || '#5865F2',
      embedImage: cfg.ticket.embedImage || '',
      buttons: (Array.isArray(cfg.ticket.buttons) && cfg.ticket.buttons.length)
        ? cfg.ticket.buttons
        : [{ label: cfg.ticket.buttonLabel || '🎫 فتح تكت', style: cfg.ticket.buttonColor || 'Primary', categoryId: cfg.ticket.categoryId || '', emoji: '' }],
      panelChannelId: cfg.ticket.panelChannelId || '',
      staffRoleId: cfg.ticket.staffRoleId || '',
      welcomeMessage: cfg.ticket.welcomeMessage || '',
    });
    changed = true;
  }

  if (changed) saveConfig(cfg);
  return cfg;
}

function loadConfig() {
  if (!configCache) {
    // Fallback: read from file synchronously until initWebConfig() is called
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
    catch { cfg = { commands: {}, aliases: {}, xp: {}, autoReplies: [] }; }
    configCache = cfg;
    healConfig(configCache);
  }
  return configCache;
}

function saveConfig(data) {
  configCache = data;
  // Persist to Supabase asynchronously
  db.saveBotConfig(data).catch(err => console.error('[saveConfig] Supabase error:', err.message));
}

/**
 * Load bot config from Supabase (with JSON file fallback/migration).
 * Must be called once at startup before startWebServer().
 */
async function initWebConfig() {
  try {
    let cfg = await db.loadBotConfig();

    // If Supabase has no config yet, migrate from JSON file
    if (!cfg || Object.keys(cfg).length === 0) {
      try {
        cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (cfg && Object.keys(cfg).length > 0) {
          await db.saveBotConfig(cfg);
          console.error('[config] ✅ Migrated botConfig.json → Supabase.');
        }
      } catch { /* no JSON file, start fresh */ }
    }

    if (!cfg || Object.keys(cfg).length === 0) {
      cfg = { commands: {}, aliases: {}, xp: {}, autoReplies: [] };
    }

    configCache = cfg;
    healConfig(configCache);
    console.error('[config] ✅ Bot config loaded from Turso.');
  } catch (err) {
    console.error('[config] Failed to load from Supabase, using file fallback:', err.message);
    try { configCache = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
    catch { configCache = { commands: {}, aliases: {}, xp: {}, autoReplies: [] }; }
    healConfig(configCache);
  }
}

function _memberHasServerTag(member, guildId) {
  const pg = member.user.primaryGuild;
  return pg !== null && pg !== undefined &&
         pg.identityGuildId === guildId &&
         pg.identityEnabled === true;
}

async function _syncServerTagRole(discordClient, st) {
  const guild = discordClient.guilds.cache.first();
  if (!guild) throw new Error('Bot is not in any guild');
  const role = guild.roles.cache.get(st.roleId);
  if (!role) throw new Error('Configured role not found');

  // Fetch ALL members with full user data
  await guild.members.fetch({ withPresences: false });

  let added = 0, removed = 0, skipped = 0;
  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;
    const hasTag  = _memberHasServerTag(member, guild.id);
    const hasRole = member.roles.cache.has(role.id);
    if (hasTag && !hasRole) {
      await member.roles.add(role).catch(() => {});
      added++;
    } else if (!hasTag && hasRole) {
      await member.roles.remove(role).catch(() => {});
      removed++;
    } else {
      skipped++;
    }
  }
  return { added, removed, skipped };
}

function startWebServer(discordClient) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // ── Restore dashboard-uploaded images from Turso on every startup ──────────
  // Railway (and most hosts) wipe the local filesystem on every redeploy/restart.
  // These images are persisted in the DB (see db.saveStaticAsset), so on boot we
  // write them back to disk here — this makes every image survive restarts.
  const STATIC_ASSET_FILES = [
    { key: 'welcome_bg',     dir: 'backgrounds', file: 'welcome_bg.png' },
    { key: 'rank_default',   dir: 'backgrounds', file: 'rank_default.png' },
    { key: 'leaderboard_bg', dir: 'backgrounds', file: 'leaderboard_bg.png' },
    { key: 'quote_bg',       dir: 'backgrounds', file: 'quote_bg.png' },
    { key: 'rules_banner',   dir: 'assets',      file: 'rules_banner.webp' },
  ];

  async function hydrateStaticAssets() {
    for (const a of STATIC_ASSET_FILES) {
      try {
        const buf = await db.getStaticAsset(a.key);
        if (!buf) continue;
        const dir = path.join(__dirname, a.dir);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, a.file), buf);
      } catch (err) {
        console.error(`[static asset restore] ${a.key}:`, err.message);
      }
    }
    console.log('[static assets] ✅ Restored dashboard images from Turso.');
  }
  hydrateStaticAssets();

  let _cfg = {};
  try { _cfg = require('./config.json'); } catch {}
  const DASH_PASSWORD = process.env.DASH_PASSWORD || _cfg.dashPassword || 'admin1234';

  function auth(req, res, next) {
    const t = req.headers['x-dash-token'];
    if (t && TOKENS.has(t)) return next();
    res.status(401).json({ error: 'Unauthorized' });
  }

  app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === DASH_PASSWORD) {
      const token = crypto.randomBytes(24).toString('hex');
      TOKENS.add(token);
      setTimeout(() => TOKENS.delete(token), 24 * 60 * 60 * 1000);
      return res.json({ token });
    }
    res.status(401).json({ error: 'Wrong password' });
  });

  app.get('/api/status', auth, (req, res) => {
    const online = discordClient && discordClient.isReady();
    res.json({ online, tag: discordClient?.user?.tag || null });
  });

  app.get('/api/config', auth, (req, res) => res.json(loadConfig()));
  app.post('/api/config', auth, async (req, res) => {
    try {
      const next = req.body || {};
      if (next.xp?.levelUpMessageImage) {
        next.xp.levelUpMessageImage = await resolveImgbbUrl(next.xp.levelUpMessageImage);
      }
      saveConfig(next);
      res.json({ ok: true, config: next });
    } catch (err) {
      console.error('[config/save]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/auto-role', auth, (req, res) => {
    const autoRole = loadConfig().autoRole || {};
    res.json({ enabled: !!autoRole.enabled, roleId: autoRole.roleId || '' });
  });

  app.post('/api/auto-role', auth, async (req, res) => {
    try {
      const guild = getDashboardGuild(discordClient);
      if (!guild) return res.status(404).json({ error: `Dashboard guild ${DASHBOARD_GUILD_ID} is unavailable` });
      const enabled = !!req.body?.enabled;
      const roleId = String(req.body?.roleId || '');
      if (enabled && !roleId) return res.status(400).json({ error: 'Select a role before enabling Auto Role.' });
      if (roleId) {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (!role) return res.status(400).json({ error: 'Selected role was not found in the Jura guild.' });
        if (role.id === guild.id || role.managed) return res.status(400).json({ error: 'That role cannot be assigned automatically.' });
      }
      const cfg = loadConfig();
      cfg.autoRole = { enabled, roleId };
      saveConfig(cfg);
      res.json({ ok: true, autoRole: cfg.autoRole });
    } catch (err) {
      console.error('[auto-role/save]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/auto-role/sync', auth, async (req, res) => {
    try {
      const guild = getDashboardGuild(discordClient);
      if (!guild) return res.status(404).json({ error: `Dashboard guild ${DASHBOARD_GUILD_ID} is unavailable` });
      const roleId = String(req.body?.roleId || loadConfig().autoRole?.roleId || '');
      if (!roleId) return res.status(400).json({ error: 'Select a role before syncing.' });
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role) return res.status(400).json({ error: 'Selected role was not found in the Jura guild.' });
      if (role.id === guild.id || role.managed) return res.status(400).json({ error: 'That role cannot be assigned.' });
      const me = guild.members.me || await guild.members.fetch(discordClient.user.id).catch(() => null);
      if (!me || role.position >= me.roles.highest.position) {
        return res.status(400).json({ error: 'The bot role must be higher than the selected role.' });
      }
      await guild.members.fetch({ withPresences: false });
      let added = 0;
      let skipped = 0;
      let failed = 0;
      for (const member of guild.members.cache.values()) {
        if (member.user.bot || member.roles.cache.has(role.id)) {
          skipped++;
          continue;
        }
        try {
          await member.roles.add(role, 'Manual Auto Role sync from dashboard');
          added++;
        } catch (err) {
          failed++;
          console.warn(`[AutoRole] Sync failed for ${member.user.tag}:`, err.message);
        }
      }
      res.json({ ok: true, role: role.name, added, skipped, failed, total: guild.memberCount });
    } catch (err) {
      console.error('[auto-role/sync]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/active-chat-role', auth, (req, res) => {
    const active = loadConfig().activeChatRole || {};
    res.json({ enabled: !!active.enabled, roleId: active.roleId || '', inactivityDays: Number(active.inactivityDays) || 7, requiredXp: Number(active.requiredXp) || 0 });
  });

  app.post('/api/active-chat-role', auth, async (req, res) => {
    try {
      const guild = getDashboardGuild(discordClient);
      if (!guild) return res.status(404).json({ error: `Dashboard guild ${DASHBOARD_GUILD_ID} is unavailable` });
      const enabled = !!req.body?.enabled;
      const roleId = String(req.body?.roleId || '');
      const inactivityDays = Math.min(365, Math.max(1, Number(req.body?.inactivityDays) || 7));
      const requiredXp = Math.min(1000000000, Math.max(0, Number(req.body?.requiredXp) || 0));
      if (enabled && !roleId) return res.status(400).json({ error: 'Select a role before enabling Active Chat Role.' });
      if (roleId) {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (!role) return res.status(400).json({ error: 'Selected role was not found in the Jura guild.' });
        if (role.id === guild.id || role.managed) return res.status(400).json({ error: 'That role cannot be assigned automatically.' });
        const me = guild.members.me || await guild.members.fetch(discordClient.user.id).catch(() => null);
        if (!me || role.position >= me.roles.highest.position) return res.status(400).json({ error: 'The bot role must be higher than the selected role.' });
      }
      const cfg = loadConfig();
      cfg.activeChatRole = { enabled, roleId, inactivityDays, requiredXp };
      saveConfig(cfg);
      res.json({ ok: true, activeChatRole: cfg.activeChatRole });
    } catch (err) {
      console.error('[active-chat-role/save]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/active-chat-role/sync', auth, async (req, res) => {
    try {
      const cfg = loadConfig();
      const roleId = String(req.body?.roleId || cfg.activeChatRole?.roleId || '');
      const result = await syncActiveChatRole(discordClient, () => loadConfig(), roleId);
      res.json(result);
    } catch (err) {
      console.error('[active-chat-role/sync]', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/invites/send-panel', auth, async (req, res) => {
    try {
      const guild = getDashboardGuild(discordClient);
      if (!guild) return res.status(404).json({ error: `Dashboard guild ${DASHBOARD_GUILD_ID} is unavailable` });
      const cfg = loadConfig();
      const inv = cfg.inviteSystem || {};
      const channelId = String(req.body?.channelId || inv.channelId || '');
      if (!channelId) return res.status(400).json({ error: 'Select an Invite System channel first.' });
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || typeof channel.send !== 'function') return res.status(404).json({ error: 'Invite channel not found or inaccessible.' });
      const parseColor = (value) => {
        const hex = String(value || '').replace('#', '');
        return /^[0-9a-f]{6}$/i.test(hex) ? parseInt(hex, 16) : 0x2ecc71;
      };
      const imageUrl = inv.imageUrl ? await resolveImgbbUrl(inv.imageUrl) : '';
      if (imageUrl && imageUrl !== inv.imageUrl) inv.imageUrl = imageUrl;
      const labels = inv.buttonLabels || {};
      const description = String(inv.embedDescription || '').slice(0, 4096);
      const embed = new EmbedBuilder()
        .setColor(parseColor(inv.embedColor))
        .setTitle(String(inv.embedTitle || 'نظام الدعوات').slice(0, 256))
        .setDescription(description.slice(0, 4096))
        .setFooter({ text: 'ادع أصدقاءك وشكرًا لدعوتك!' });
      if (imageUrl) embed.setImage(imageUrl);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('invite_link').setLabel(String(labels.link || '🔗 رابطك الخاص').slice(0, 80)).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('invite_mine').setLabel(String(labels.mine || '📊 دعواتي').slice(0, 80)).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('invite_joiners').setLabel(String(labels.joiners || '👤 من دخل من رابطي').slice(0, 80)).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('invite_top').setLabel(String(labels.top || '🏆 توب الدعوات').slice(0, 80)).setStyle(ButtonStyle.Danger),
      );
      const payload = { embeds: [embed], components: [row] };
      let msg = null;
      if (inv.panelMessageId && inv.channelId === channelId) {
        msg = await channel.messages.fetch(inv.panelMessageId).catch(() => null);
        if (msg) await msg.edit(payload).catch(() => { msg = null; });
      }
      if (!msg) msg = await channel.send(payload);
      cfg.inviteSystem = { ...inv, enabled: true, guildId: DASHBOARD_GUILD_ID, channelId, panelMessageId: msg.id, imageUrl };
      saveConfig(cfg);
      res.json({ ok: true, messageId: msg.id, channelId, imageUrl });
    } catch (err) {
      console.error('[invites/send-panel]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/xp/test', auth, async (req, res) => {
    try {
      const xpCfg = loadConfig().xp || {};
      if (!xpCfg.levelUpChannel) return res.status(400).json({ error: 'Select a level-up channel first.' });
      const channel = await discordClient.channels.fetch(xpCfg.levelUpChannel).catch(() => null);
      if (!channel || typeof channel.send !== 'function') return res.status(404).json({ error: 'Level-up channel not found or inaccessible.' });
      const userId = discordClient.user?.id;
      if (xpCfg.levelUpMessageImage) {
        const resolvedImage = await resolveImgbbUrl(xpCfg.levelUpMessageImage);
        if (resolvedImage !== xpCfg.levelUpMessageImage) {
          xpCfg.levelUpMessageImage = resolvedImage;
          const cfg = loadConfig();
          cfg.xp = { ...(cfg.xp || {}), levelUpMessageImage: resolvedImage };
          saveConfig(cfg);
        }
      }
      const text = String(xpCfg.levelUpMessage || '{user} وصلت للمستوى **{level}**!')
        .replaceAll('{user}', `<@${userId}>`)
        .replaceAll('{level}', '10');
      const allowedMentions = userId ? { users: [userId] } : { parse: [] };
      const payload = xpCfg.levelUpMessageFormat === 'embed'
        ? {
            embeds: [new EmbedBuilder().setColor(parseXpEmbedColor(xpCfg.levelUpMessageColor)).setDescription(text)],
            allowedMentions,
          }
        : { content: text, allowedMentions };
      if (xpCfg.levelUpMessageFormat === 'embed' && xpCfg.levelUpMessageImage) {
        payload.embeds[0].setImage(xpCfg.levelUpMessageImage);
      }
      await channel.send(payload);
      res.json({ ok: true, format: xpCfg.levelUpMessageFormat === 'embed' ? 'embed' : 'text' });
    } catch (err) {
      console.error('[xp/test]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  function parseXpEmbedColor(value) {
    const hex = String(value || '').replace('#', '');
    return /^[0-9a-f]{6}$/i.test(hex) ? parseInt(hex, 16) : 0x5865f2;
  }

  app.get('/api/roles', auth, async (req, res) => {
    try {
      const g = getDashboardGuild(discordClient);
      if (!g) return res.status(404).json({ error: `Dashboard guild ${DASHBOARD_GUILD_ID} is unavailable` });
      await g.roles.fetch();
      const all = [];
      g.roles.cache.filter(r => r.name !== '@everyone').forEach(r => {
        all.push({ id: r.id, name: r.name, guild: g.name, position: r.rawPosition, managed: !!r.managed });
      });
      res.json(all);
    } catch { res.json([]); }
  });

  app.get('/api/members', auth, async (req, res) => {
    try {
      const g = getDashboardGuild(discordClient);
      if (!g) return res.status(404).json({ error: `Dashboard guild ${DASHBOARD_GUILD_ID} is unavailable` });
      await g.members.fetch({ withPresences: false });
      const members = [];
      g.members.cache.filter(m => !m.user.bot).forEach(m => {
        members.push({
          id: m.id,
          username: m.user.username,
          displayName: m.displayName || m.user.username,
          guild: g.name,
        });
      });
      members.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
      res.json(members);
    } catch { res.json([]); }
  });
  app.get('/api/emojis', auth, async (req, res) => {
    try {
      const g = getDashboardGuild(discordClient);
      if (!g) return res.status(404).json({ error: `Dashboard guild ${DASHBOARD_GUILD_ID} is unavailable` });
      await g.emojis.fetch();
      const emojis = [];
      g.emojis.cache.forEach(e => {
        emojis.push({ id: e.id, name: e.name, animated: e.animated, url: e.imageURL({ size: 64 }), guild: g.name });
      });
      res.json(emojis);
    } catch { res.json([]); }
  });

  app.get('/api/channels', auth, async (req, res) => {
    try {
      const g = getDashboardGuild(discordClient);
      if (!g) return res.status(404).json({ error: `Dashboard guild ${DASHBOARD_GUILD_ID} is unavailable` });
      await g.channels.fetch();
      const all = [];
      g.channels.cache
        .filter(c => c.isTextBased() && !c.isThread())
        .forEach(c => all.push({ id: c.id, name: c.name, guild: g.name, position: c.rawPosition }));
      res.json(all);
    } catch { res.json([]); }
  });

  // Same as /api/channels but also includes forum channels (marked with type:'forum').
  // Used only by the Embed Manager, since sending an embed into a forum requires
  // creating a new post/thread rather than a plain channel.send().
  app.get('/api/channels-sendable', auth, async (req, res) => {
    try {
      const g = getDashboardGuild(discordClient);
      if (!g) return res.status(404).json({ error: `Dashboard guild ${DASHBOARD_GUILD_ID} is unavailable` });
      await g.channels.fetch();
      const all = [];
      g.channels.cache
        .filter(c => (c.isTextBased() && !c.isThread()) || c.type === ChannelType.GuildForum)
        .forEach(c => all.push({
          id: c.id,
          name: c.name,
          guild: g.name,
          position: c.rawPosition,
          type: c.type === ChannelType.GuildForum ? 'forum' : 'text',
        }));
      res.json(all);
    } catch { res.json([]); }
  });

  app.post('/api/autoreplies/add', auth, (req, res) => {
    const { trigger, response, matchType, caseSensitive, roleId, userId, deleteTrigger, responseType, imageUrl } = req.body;
    if (!trigger || (responseType === 'image' ? !imageUrl : !response)) return res.status(400).json({ error: 'Missing fields' });
    const cfg = loadConfig();
    if (!cfg.autoReplies) cfg.autoReplies = [];
    cfg.autoReplies.push({
      id: crypto.randomBytes(8).toString('hex'),
      trigger,
      response,
      matchType: matchType || 'contains',
      caseSensitive: !!caseSensitive,
      roleId: typeof roleId === 'string' ? roleId.trim() : '',
      userId: typeof userId === 'string' ? userId.trim() : '',
      deleteTrigger: deleteTrigger !== false,
      responseType: responseType === 'image' ? 'image' : 'text',
      imageUrl: typeof imageUrl === 'string' ? imageUrl.trim() : '',
      enabled: true,
    });
    saveConfig(cfg);
    res.json({ ok: true, autoReplies: cfg.autoReplies });
  });

  app.post('/api/autoreplies/update', auth, (req, res) => {
    const { id, ...fields } = req.body;
    const cfg = loadConfig();
    const idx = cfg.autoReplies?.findIndex(r => r.id === id);
    if (idx === -1 || idx === undefined) return res.status(404).json({ error: 'Not found' });
    cfg.autoReplies[idx] = { ...cfg.autoReplies[idx], ...fields };
    saveConfig(cfg);
    res.json({ ok: true });
  });

  app.post('/api/autoreplies/delete', auth, (req, res) => {
    const { id } = req.body;
    const cfg = loadConfig();
    cfg.autoReplies = (cfg.autoReplies || []).filter(r => r.id !== id);
    saveConfig(cfg);
    res.json({ ok: true });
  });

  // ── WELCOME CONFIG ──
  app.get('/api/welcome', auth, (req, res) => {
    const cfg = loadConfig();
    res.json(cfg.welcome || {});
  });

  app.post('/api/welcome', auth, (req, res) => {
    const cfg = loadConfig();
    cfg.welcome = { ...(cfg.welcome || {}), ...req.body };
    saveConfig(cfg);
    res.json({ ok: true });
  });

  app.post('/api/welcome/bg', auth, express.raw({ type: 'application/octet-stream', limit: '10mb' }), async (req, res) => {
    try {
      const BG_DIR = path.join(__dirname, 'backgrounds');
      if (!fs.existsSync(BG_DIR)) fs.mkdirSync(BG_DIR);
      const resized = await sharp(req.body).resize(900, 320, { fit: 'cover' }).png().toBuffer();
      fs.writeFileSync(path.join(BG_DIR, 'welcome_bg.png'), resized);
      await db.saveStaticAsset('welcome_bg', resized);
      res.json({ ok: true });
    } catch (err) {
      console.error('Welcome bg upload error:', err);
      res.status(500).json({ error: 'Failed to save image' });
    }
  });

  app.delete('/api/welcome/bg', auth, async (req, res) => {
    const p = path.join(__dirname, 'backgrounds', 'welcome_bg.png');
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (err) { console.error('[welcome/bg delete]', err.message); }
    try { await db.deleteStaticAsset('welcome_bg'); } catch (err) { console.error('[welcome/bg db delete]', err.message); }
    res.json({ ok: true });
  });

  // ── WELCOME TEST ──
  app.post('/api/welcome/test', auth, async (req, res) => {
    try {
      const cfg = loadConfig();
      const wc = cfg.welcome;
      if (!wc?.channelId) return res.status(400).json({ error: 'No welcome channel configured.' });
      const welcomeChan = discordClient.channels.cache.get(wc.channelId);
      if (!welcomeChan) return res.status(400).json({ error: 'Channel not found or bot has no access.' });

      // Use the bot's own user as a stand-in for the new member
      const botUser = discordClient.user;
      const guild = welcomeChan.guild;
      const memberCount = guild?.memberCount ?? '?';
      const avatarUrl = botUser.displayAvatarURL({ extension: 'png', size: 256 });
      const username = botUser.username;

      const msg = (wc.message || 'Welcome {user}!')
        .replace('{user}', `<@${botUser.id}>`)
        .replace('{server}', guild?.name ?? 'Server')
        .replace('{count}', memberCount);

      const wcColorHex = (wc.embedColor || '').replace('#', '');
      const wcColor = /^[0-9A-Fa-f]{6}$/.test(wcColorHex) ? parseInt(wcColorHex, 16) : 0x7c3aed;

      let payload = {};

      if (wc.sendCard !== false) {
        const { generateWelcomeCard } = require('./src/cards/welcomeCard.js');
        const { AttachmentBuilder } = require('discord.js');
        const buffer = await generateWelcomeCard({
          username,
          avatarUrl,
          memberCount,
          guildName: guild?.name ?? 'Server',
          welcomeCfg: wc,
        });
        const attachment = new AttachmentBuilder(buffer, { name: 'welcome.png' });

        if (wc.sendEmbed) {
          const embed = new EmbedBuilder()
            .setDescription(`🧪 **Test** — ${msg}`)
            .setImage('attachment://welcome.png')
            .setColor(wcColor);
          payload = { embeds: [embed], files: [attachment] };
        } else {
          payload = { content: `🧪 **Test** — ${msg}`, files: [attachment] };
        }
      } else {
        if (wc.sendEmbed) {
          const embed = new EmbedBuilder()
            .setDescription(`🧪 **Test** — ${msg}`)
            .setColor(wcColor)
            .setThumbnail(avatarUrl);
          payload = { embeds: [embed] };
        } else {
          payload = { content: `🧪 **Test** — ${msg}` };
        }
      }

      await welcomeChan.send(payload);

      const second = wc.secondMessage || {};
      if (second.enabled && second.channelId && second.channelId !== wc.channelId) {
        const secondChan = discordClient.channels.cache.get(second.channelId)
          || await discordClient.channels.fetch(second.channelId).catch(() => null);
        if (secondChan?.send) {
          const secondMsg = (second.message || 'Welcome {user}!')
            .replaceAll('{user}', `<@${botUser.id}>`)
            .replaceAll('{server}', guild?.name ?? 'Server')
            .replaceAll('{count}', String(memberCount));
          const secondPayload = {};
          if (second.sendEmbed) {
            const secondColorHex = String(second.embedColor || '#7c3aed').replace('#', '');
            const secondColor = /^[0-9A-Fa-f]{6}$/.test(secondColorHex) ? parseInt(secondColorHex, 16) : 0x7c3aed;
            secondPayload.embeds = [new EmbedBuilder().setDescription(`🧪 **Test** — ${secondMsg}`).setColor(secondColor)];
          } else {
            secondPayload.content = `🧪 **Test** — ${secondMsg}`;
          }
          await secondChan.send(secondPayload);
        }
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('[welcome/test]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/welcome_bg.png', auth, (req, res) => {
    const p = path.join(__dirname, 'backgrounds', 'welcome_bg.png');
    if (fs.existsSync(p)) return res.sendFile(p);
    res.status(404).end();
  });

  // ── BACKGROUNDS (rank default + leaderboard) ──
  function bgUploadRoute(filename, w, h) {
    app.post(`/api/backgrounds/${filename}`, auth, express.raw({ type: 'application/octet-stream', limit: '10mb' }), async (req, res) => {
      try {
        const BG_DIR2 = path.join(__dirname, 'backgrounds');
        if (!fs.existsSync(BG_DIR2)) fs.mkdirSync(BG_DIR2);
        const buf = await sharp(req.body).resize(w, h, { fit: 'cover' }).png().toBuffer();
        fs.writeFileSync(path.join(BG_DIR2, `${filename}.png`), buf);
        await db.saveStaticAsset(filename, buf);
        res.json({ ok: true });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });
    app.delete(`/api/backgrounds/${filename}`, auth, async (req, res) => {
      const p = path.join(__dirname, 'backgrounds', `${filename}.png`);
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (err) { console.error(`[bg delete ${filename}]`, err.message); }
      try { await db.deleteStaticAsset(filename); } catch (err) { console.error(`[bg db delete ${filename}]`, err.message); }
      res.json({ ok: true });
    });
    app.get(`/${filename}.png`, auth, (req, res) => {
      const p = path.join(__dirname, 'backgrounds', `${filename}.png`);
      if (fs.existsSync(p)) return res.sendFile(p);
      res.status(404).end();
    });
  }

  bgUploadRoute('rank_default', 800, 260);
  bgUploadRoute('leaderboard_bg', 780, 600);
  bgUploadRoute('quote_bg', 900, 420);

  // ── STREAK CONFIG ──
  app.get('/api/streak', auth, (req, res) => {
    const cfg = loadConfig();
    res.json(cfg.streak || {});
  });

  app.post('/api/streak', auth, (req, res) => {
    const cfg = loadConfig();
    const body = { ...req.body };
    if (body.notificationMode !== undefined &&
        body.notificationMode !== 'dm' &&
        body.notificationMode !== 'channel') {
      return res.status(400).json({ error: 'notificationMode must be dm or channel' });
    }
    const nextStreak = { ...(cfg.streak || {}), ...body };
    if (nextStreak.notificationMode === 'channel' && !nextStreak.channelId) {
      return res.status(400).json({ error: 'Select a streak channel before using chat notifications' });
    }
    cfg.streak = nextStreak;
    saveConfig(cfg);
    res.json({ ok: true });
  });

  // ── PROFILE CARD CONFIG ──
  app.get('/api/profile', auth, (req, res) => {
    const cfg = loadConfig();
    res.json(cfg.profile || {});
  });

  app.post('/api/profile', auth, (req, res) => {
    const cfg = loadConfig();
    cfg.profile = { ...(cfg.profile || {}), ...req.body };
    saveConfig(cfg);
    res.json({ ok: true });
  });

  // ── ALL SERVER CHANNELS (for channel browser page) ──
  app.get('/api/server-channels', auth, async (req, res) => {
    try {
      const out = [];
      for (const g of discordClient.guilds.cache.values()) {
        await g.channels.fetch();
        g.channels.cache.forEach(c => {
          if (!out.find(x => x.id === c.id))
            out.push({
              id:        c.id,
              name:      c.name,
              type:      c.type,
              position:  c.rawPosition ?? c.position ?? 0,
              parent_id: c.parentId || null,
              guild:     g.name,
            });
        });
      }
      res.json(out);
    } catch { res.json([]); }
  });

  // ── CATEGORIES ──
  app.get('/api/categories', auth, async (req, res) => {
    try {
      const g = getDashboardGuild(discordClient);
      if (!g) return res.status(404).json({ error: `Dashboard guild ${DASHBOARD_GUILD_ID} is unavailable` });
      await g.channels.fetch();
      const all = g.channels.cache
        .filter(c => c.type === ChannelType.GuildCategory)
        .map(c => ({ id: c.id, name: c.name, guild: g.name }));
      res.json(all);
    } catch { res.json([]); }
  });

  // ── CHANNELS PAGE: category hide/show toggle for @everyone ──
  app.get('/api/categories-visibility', auth, async (req, res) => {
    try {
      const guild = discordClient.guilds.cache.first();
      if (!guild) return res.json([]);
      await guild.channels.fetch();
      const everyoneId = guild.roles.everyone.id;
      const cats = guild.channels.cache
        .filter(c => c.type === ChannelType.GuildCategory)
        .map(c => {
          const ow = c.permissionOverwrites.cache.get(everyoneId);
          const hidden = ow ? ow.deny.has('ViewChannel') : false;
          return { id: c.id, name: c.name, hidden };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json(cats);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/categories-visibility/:id/toggle', auth, async (req, res) => {
    try {
      const guild = discordClient.guilds.cache.first();
      if (!guild) return res.status(400).json({ error: 'Bot is not in any guild.' });
      await guild.channels.fetch();
      const category = guild.channels.cache.get(req.params.id);
      if (!category || category.type !== ChannelType.GuildCategory)
        return res.status(404).json({ error: 'Category not found.' });
      const everyone = guild.roles.everyone;
      const currentOw = category.permissionOverwrites.cache.get(everyone.id);
      const isHidden = currentOw ? currentOw.deny.has('ViewChannel') : false;
      const nextHidden = !isHidden;
      await category.permissionOverwrites.edit(everyone, { ViewChannel: !nextHidden });
      const children = guild.channels.cache.filter(c => c.parentId === category.id);
      for (const ch of children.values()) {
        await ch.permissionOverwrites.edit(everyone, { ViewChannel: !nextHidden }).catch(() => {});
      }
      res.json({ ok: true, hidden: nextHidden });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── TICKET PANELS (multi-panel ticket system) ──
  // cfg.ticketPanels is an array of independent panel configs, each with its
  // own embed, buttons, panel channel, staff role and welcome message —
  // mirrors the same array+id pattern used by the Embed Manager (/api/embeds).
  app.get('/api/ticket-panels', auth, (req, res) => {
    res.json(loadConfig().ticketPanels || []);
  });

  app.post('/api/ticket-panels', auth, async (req, res) => {
    const cfg = loadConfig();
    if (!Array.isArray(cfg.ticketPanels)) cfg.ticketPanels = [];
    let { id, name, embedTitle, embedDescription, embedColor, embedImage, buttons, panelChannelId, staffRoleId, welcomeMessage } = req.body;
    if (embedImage) embedImage = await resolveImgbbUrl(embedImage);
    const entry = {
      name: (name || 'بانيل بدون اسم').toString().slice(0, 60),
      embedTitle: embedTitle || '',
      embedDescription: embedDescription || '',
      embedColor: embedColor || '#5865F2',
      embedImage: embedImage || '',
      buttons: (Array.isArray(buttons) && buttons.length)
        ? buttons.map(b => ({
            label: String(b.label || b.buttonName || '').slice(0, 80),
            ticketName: String(b.ticketName || b.channelName || '').slice(0, 40),
            style: b.style || 'Primary',
            categoryId: b.categoryId || '',
            emoji: b.emoji || '',
          }))
        : [{ label: '🎫 فتح تكت', ticketName: 'support', style: 'Primary', categoryId: '', emoji: '' }],
      panelChannelId: panelChannelId || '',
      staffRoleId: staffRoleId || '',
      welcomeMessage: welcomeMessage || '',
    };
    if (id) {
      const idx = cfg.ticketPanels.findIndex(p => p.id === id);
      if (idx !== -1) cfg.ticketPanels[idx] = { id, ...entry };
      else cfg.ticketPanels.push({ id, ...entry });
    } else {
      id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      cfg.ticketPanels.push({ id, ...entry });
    }
    saveConfig(cfg);
    res.json({ ok: true, id, panel: { id, ...entry }, panels: cfg.ticketPanels });
  });

  app.delete('/api/ticket-panels/:id', auth, (req, res) => {
    const cfg = loadConfig();
    if (!Array.isArray(cfg.ticketPanels)) cfg.ticketPanels = [];
    cfg.ticketPanels = cfg.ticketPanels.filter(p => p.id !== req.params.id);
    saveConfig(cfg);
    res.json({ ok: true, panels: cfg.ticketPanels });
  });

  // ── TICKET: send a specific panel to its channel ──
  app.post('/api/ticket-panels/:id/send', auth, async (req, res) => {
    try {
      const cfg = loadConfig();
      const t = (cfg.ticketPanels || []).find(p => p.id === req.params.id);
      if (!t) return res.status(404).json({ error: 'البانيل غير موجود' });
      if (!t.panelChannelId) return res.status(400).json({ error: 'لم يتم تحديد روم البانيل' });

      const channel = await discordClient.channels.fetch(t.panelChannelId).catch(() => null);
      if (!channel) return res.status(404).json({ error: 'القناة غير موجودة أو البوت ليس فيها' });

      const colorHex = (t.embedColor || '#5865F2').replace('#', '');
      const color = /^[0-9A-Fa-f]{6}$/.test(colorHex) ? parseInt(colorHex, 16) : 0x5865F2;

      const embed = new EmbedBuilder().setColor(color);
      if (t.embedTitle) embed.setTitle(t.embedTitle);
      if (t.embedDescription) embed.setDescription(t.embedDescription);
      const panelImageUrl = t.embedImage ? await resolveImgbbUrl(t.embedImage) : '';
      if (panelImageUrl) embed.setImage(panelImageUrl);

      const styleMap = { Primary: ButtonStyle.Primary, Secondary: ButtonStyle.Secondary, Success: ButtonStyle.Success, Danger: ButtonStyle.Danger };
      const buttons = Array.isArray(t.buttons) && t.buttons.length
        ? t.buttons
        : [{ label: '🎫 فتح تكت', style: 'Primary', categoryId: '' }];

      const rows = [];
      for (let i = 0; i < buttons.length; i += 5) {
        const row = new ActionRowBuilder();
        buttons.slice(i, i + 5).forEach((b, j) => {
          const idx = i + j;
          // customId encodes BOTH the panel and the button index, so the bot
          // can route a click back to the exact panel it came from:
          //   ticket_open_<panelId>:<buttonIndex>
          const btn = new ButtonBuilder()
            .setCustomId(`ticket_open_${t.id}:${idx}`)
            .setLabel(b.label || b.buttonName || 'فتح تكت')
            .setStyle(styleMap[b.style] || ButtonStyle.Primary);
          if (b.emoji) btn.setEmoji(b.emoji);
          row.addComponents(btn);
        });
        rows.push(row);
      }

      await channel.send({ embeds: [embed], components: rows });
      res.json({ ok: true });
    } catch (err) {
      console.error('Ticket panel send error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── AUTO QUOTE ──
  // ── DAILY EVENT ──
  app.get('/api/daily-event', auth, (req, res) => res.json(loadConfig().dailyEvent || {}));

  app.post('/api/daily-event', auth, (req, res) => {
    const cfg = loadConfig();
    cfg.dailyEvent = { ...(cfg.dailyEvent || {}), ...req.body };
    saveConfig(cfg);
    res.json({ ok: true });
  });

  app.post('/api/daily-event/trigger', auth, async (req, res) => {
    try {
      const { triggerNow } = require('./src/features/dailyEvent.js');
      await triggerNow(discordClient, loadConfig);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/auto-quote', auth, (req, res) => res.json(loadConfig().autoQuote || {}));

  app.post('/api/auto-quote', auth, (req, res) => {
    const cfg = loadConfig();
    cfg.autoQuote = { ...(cfg.autoQuote || {}), ...req.body };
    saveConfig(cfg);
    res.json({ ok: true });
  });

  app.post('/api/auto-quote/trigger', auth, async (req, res) => {
    try {
      await sendQuoteNow(discordClient, loadConfig);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── STAFF APPLICATION ──
  app.get('/api/staff-app', auth, (req, res) => res.json(loadConfig().staffApp || {}));

  app.post('/api/staff-app', auth, async (req, res) => {
    const cfg = loadConfig();
    const body = { ...req.body };
    if (body.embedImage) body.embedImage = await resolveImgbbUrl(body.embedImage);
    if (body.embedThumbnail) body.embedThumbnail = await resolveImgbbUrl(body.embedThumbnail);
    cfg.staffApp = { ...(cfg.staffApp || {}), ...body };
    saveConfig(cfg);
    res.json({ ok: true, staffApp: cfg.staffApp });
  });

  app.post('/api/staff-app/send-embed', auth, async (req, res) => {
    try {
      const cfg = loadConfig().staffApp || {};
      const guild = discordClient.guilds.cache.first();
      if (!guild) return res.status(400).json({ error: 'البوت ليس في أي سيرفر' });
      const body = { ...req.body };
      if (body.embedImage) body.embedImage = await resolveImgbbUrl(body.embedImage);
      if (body.embedThumbnail) body.embedThumbnail = await resolveImgbbUrl(body.embedThumbnail);
      await sendApplicationEmbed(guild, { ...cfg, ...body });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── STAFF PANEL SETTINGS ──
  app.get('/api/staff-panel', auth, (req, res) => {
    res.json(loadConfig().staffPanel || {});
  });

  app.post('/api/staff-panel', auth, async (req, res) => {
    try {
      const cfg = loadConfig();
      const body = { ...(req.body || {}) };
      if (body.image) body.image = await resolveImgbbUrl(body.image);
      if (body.thumbnail) body.thumbnail = await resolveImgbbUrl(body.thumbnail);
      cfg.staffPanel = { ...(cfg.staffPanel || {}), ...body };
      saveConfig(cfg);
      res.json({ ok: true, staffPanel: cfg.staffPanel });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/staff-panel/send', auth, async (req, res) => {
    try {
      const cfg = loadConfig();
      const guild = discordClient.guilds.cache.first();
      if (!guild) return res.status(400).json({ error: 'البوت ليس في أي سيرفر' });
      const panel = { ...(cfg.staffPanel || {}), ...(req.body || {}) };
      cfg.staffPanel = panel;
      saveConfig(cfg);
      await sendStaffPanel(guild, cfg);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/streak/stats', auth, async (req, res) => {
    try {
      const data = await db.getAllStreaks();
      res.json(data);
    } catch {
      res.json({});
    }
  });

  // ── ADVANCED SERVER ANALYTICS ──
  app.get('/api/analytics', auth, async (req, res) => {
    try {
      const guild = getDashboardGuild(discordClient);
      if (!guild) return res.status(404).json({ error: `Dashboard guild ${DASHBOARD_GUILD_ID} is unavailable` });
      const allowedDays = [7, 30, 90];
      const days = allowedDays.includes(Number(req.query.days)) ? Number(req.query.days) : 30;
      const endAt = Date.now();
      const startAt = endAt - days * 24 * 60 * 60 * 1000;
      const data = await db.getAnalyticsSummary(guild.id, startAt, endAt);
      res.json({ guild: { id: guild.id, name: guild.name }, days, ...data });
    } catch (err) {
      console.error('[analytics]', err.message);
      res.status(500).json({ error: 'Analytics unavailable' });
    }
  });

  app.patch('/api/streak/member', auth, async (req, res) => {
    try {
      const { guildId, userId, lastImageAt, reminded } = req.body;
      if (!guildId || !userId) return res.status(400).json({ error: 'guildId and userId required' });
      const fields = {};
      if (lastImageAt !== undefined) fields.lastImageAt = Number(lastImageAt);
      if (reminded    !== undefined) fields.reminded    = !!reminded;
      await db.upsertStreak(guildId, userId, fields);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── LOGS CONFIG ──
  app.get('/api/logs', auth, (req, res) => res.json(loadConfig().logs || {}));

  app.post('/api/logs', auth, (req, res) => {
    const cfg = loadConfig();
    cfg.logs = { ...(cfg.logs || {}), ...req.body };
    saveConfig(cfg);
    res.json({ ok: true });
  });

  // ── WARNINGS LOG ──
  app.get('/api/logs/warnings', auth, async (req, res) => {
    try {
      const data = await db.loadWarnings();
      const allWarnings = [];
      for (const guildId in data) {
        for (const userId in data[guildId]) {
          allWarnings.push({ guildId, userId, warns: data[guildId][userId] });
        }
      }
      res.json(allWarnings);
    } catch {
      res.json([]);
    }
  });

  // ── TICKETS LOG ──
  app.get('/api/logs/tickets', auth, async (req, res) => {
    try {
      const data = await db.loadTickets();
      const allTickets = [];
      for (const guildId in data) {
        for (const ticketId in data[guildId]) {
          allTickets.push({ guildId, ticketId, ...data[guildId][ticketId] });
        }
      }
      res.json(allTickets);
    } catch {
      res.json([]);
    }
  });

  // ── ROLE LOGS ──
  app.get('/api/logs/roles', auth, async (req, res) => {
    try {
      const data = await db.getRolesLog();
      res.json(data.map(r => ({
        id: r.id,
        action: r.action,
        userId: r.user_id,
        roleId: r.role_id,
        modId: r.mod_id,
        timestamp: Number(r.timestamp) || 0,
      })));
    } catch {
      res.json([]);
    }
  });

  // ── MESSAGE LOGS (edits/deletes) ──
  app.get('/api/logs/messages', auth, async (req, res) => {
    try {
      const data = await db.getMessagesLog();
      res.json(data.map(m => ({
        id: m.id,
        action: m.action,
        userId: m.user_id,
        channelId: m.channel_id,
        messageId: m.message_id,
        content: m.content,
        timestamp: Number(m.timestamp) || 0,
      })));
    } catch {
      res.json([]);
    }
  });

  // ── BAN LOGS ──
  app.get('/api/logs/bans', auth, async (req, res) => {
    try {
      const data = await db.getBansLog();
      res.json(data.map(b => ({
        id: b.id,
        guildId: b.guild_id,
        userId: b.user_id,
        userTag: b.user_tag,
        moderator: b.moderator,
        reason: b.reason,
        timestamp: Number(b.timestamp) || 0,
      })));
    } catch {
      res.json([]);
    }
  });

  // ── LOG DELETE ENDPOINTS ──
  app.delete('/api/logs/warnings/:guildId/:userId', auth, async (req, res) => {
    try {
      await db.deleteWarningsForUser(req.params.guildId, req.params.userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/logs/bans/:id', auth, async (req, res) => {
    try {
      await db.deleteBanLog(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/logs/roles/:id', auth, async (req, res) => {
    try {
      await db.deleteRoleLog(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/logs/messages/:id', auth, async (req, res) => {
    try {
      await db.deleteMessageLog(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── SERVER TAG ──
  app.get('/api/servertag', auth, (req, res) => res.json(loadConfig().serverTag || {}));
  app.post('/api/servertag', auth, async (req, res) => {
    const cfg = loadConfig();
    const wasEnabled = !!(cfg.serverTag && cfg.serverTag.enabled);
    cfg.serverTag = { ...(cfg.serverTag || {}), ...req.body };
    saveConfig(cfg);
    // Auto-backfill when feature is turned on
    if (!wasEnabled && cfg.serverTag.enabled && cfg.serverTag.roleId) {
      _syncServerTagRole(discordClient, cfg.serverTag).catch(() => {});
    }
    res.json({ ok: true });
  });

  app.post('/api/servertag/sync', auth, async (req, res) => {
    const cfg = loadConfig();
    const st = cfg.serverTag || {};
    if (!st.enabled || !st.roleId) return res.status(400).json({ error: 'Feature not enabled or no role set' });
    try {
      const result = await _syncServerTagRole(discordClient, st);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── BOOST REWARD ──
  app.get('/api/boost', auth, (req, res) => res.json(loadConfig().boost || {}));

  app.post('/api/boost', auth, async (req, res) => {
    const cfg = loadConfig();
    if (!cfg.boost) cfg.boost = {};
    if (req.body.channelId      !== undefined) cfg.boost.channelId      = req.body.channelId;
    if (req.body.positionRoleId !== undefined) cfg.boost.positionRoleId = req.body.positionRoleId;
    if (req.body.positionType   !== undefined) cfg.boost.positionType   = req.body.positionType;
    if (req.body.panelTitle     !== undefined) cfg.boost.panelTitle     = normalizeDiscordEmojiSyntax(req.body.panelTitle);
    if (req.body.panelDescription !== undefined) cfg.boost.panelDescription = normalizeDiscordEmojiSyntax(req.body.panelDescription);
    if (req.body.embedColor     !== undefined) cfg.boost.embedColor     = req.body.embedColor;
    if (req.body.embedImage     !== undefined) cfg.boost.embedImage     = req.body.embedImage
      ? await resolveImgbbUrl(req.body.embedImage) : req.body.embedImage;
    if (req.body.notifChannelId !== undefined) cfg.boost.notifChannelId = req.body.notifChannelId;
    if (req.body.notifMessage   !== undefined) cfg.boost.notifMessage   = req.body.notifMessage;
    if (req.body.notifUseEmbed  !== undefined) cfg.boost.notifUseEmbed  = !!req.body.notifUseEmbed;
    if (req.body.notifEmbedColor !== undefined) cfg.boost.notifEmbedColor = req.body.notifEmbedColor;
    if (req.body.notifImage     !== undefined) cfg.boost.notifImage     = req.body.notifImage
      ? await resolveImgbbUrl(req.body.notifImage) : req.body.notifImage;
    saveConfig(cfg);
    res.json({ ok: true });
  });

  app.post('/api/boost/send-panel', auth, async (req, res) => {
    const cfg = loadConfig();
    const channelId = cfg.boost?.channelId;
    if (!channelId) return res.status(400).json({ error: 'لم يتم ضبط قناة البوست بعد.' });
    try {
      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      const ch = discordClient.channels.cache.get(channelId);
      if (!ch) return res.status(404).json({ error: 'القناة غير موجودة أو البوت ليس لديه وصول.' });

      const boostColorHex = (cfg.boost?.embedColor || '').replace('#', '');
      const boostColor = /^[0-9A-Fa-f]{6}$/.test(boostColorHex) ? parseInt(boostColorHex, 16) : 0x1692c4;

      const embed = new EmbedBuilder()
        .setColor(boostColor)
        .setTitle(cfg.boost?.panelTitle || 'رتبة البوست الخاصة')
        .setDescription(
          cfg.boost?.panelDescription ||
          '**شكراً على بوستك!** 🩷\n\n' +
          'بما أنك بوستر، يمكنك إنشاء وإدارة **رتبة خاصة بك** في السيرفر.\n\n' +
          '> <a:create:1531641222743982201> **إنشاء رتبة** — باسم وإيموجي ولون خاص بك\n' +
          '> <:rename:1531641643390865678> **تغيير الاسم** — عدّل اسم رتبتك\n' +
          '> <:roleicon:1531643997095989358> **تغيير الإيموجي** — من أي سيرفر!\n' +
          '> 🎨 **تغيير اللون** — اختر أي لون تريد\n' +
          '> <:deleterole:1531642211643560057> **حذف الرتبة** — احذف رتبتك\n\n' +
          '*اضغط الزر أدناه لفتح تذكرة خاصة بك وإدارة رتبتك.*\n' +
          '*تُحذف الرتبة تلقائياً بعد 30 يوم أو عند إزالة البوست.*'
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('boost_btn_open_ticket')
          .setLabel('إدارة رتبتك')
          .setEmoji({ id: '1531641222743982201', name: 'create', animated: true })
          .setStyle(ButtonStyle.Primary),
      );

      if (cfg.boost?.embedImage) embed.setImage(cfg.boost.embedImage);
      await ch.send({ embeds: [embed], components: [row] });
      res.json({ ok: true });
    } catch (err) {
      console.error('[Boost panel send]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── CHANNEL RELAY AUTOMATIONS ──
  app.get('/api/channel-automations', auth, (req, res) => {
    res.json(loadConfig().channelAutomations || []);
  });
  app.post('/api/channel-automations', auth, async (req, res) => {
    const body = req.body || {};
    const sourceChannelId = String(body.sourceChannelId || '').trim();
    const sameChannel = body.sameChannel === true;
    const requestedDestinationChannelId = String(body.destinationChannelId || '').trim();
    const destinationChannelId = sameChannel ? sourceChannelId : requestedDestinationChannelId;
    const mode = body.mode === 'custom' ? 'custom' : 'forward';
    if (!sourceChannelId || (!sameChannel && !destinationChannelId)) return res.status(400).json({ error: 'Source and destination channels are required.' });
    if (!sameChannel && sourceChannelId === destinationChannelId) return res.status(400).json({ error: 'Choose different source and destination channels.' });
    if (mode === 'custom' && body.responseType === 'image' && !String(body.imageUrl || '').trim()) return res.status(400).json({ error: 'Image URL is required for image mode.' });
    const postAction = ['none', 'reaction', 'message', 'both'].includes(body.postAction) ? body.postAction : 'none';
    if ((postAction === 'reaction' || postAction === 'both') && !String(body.reactionEmoji || '').trim()) return res.status(400).json({ error: 'Reaction emoji is required for the selected post action.' });
    if ((postAction === 'message' || postAction === 'both') && !String(body.postMessage || '').trim()) return res.status(400).json({ error: 'Follow-up message is required for the selected post action.' });
    if (mode === 'custom' && body.responseType !== 'image' && !String(body.response || '').trim() && !String(body.embedDescription || '').trim() && !String(body.embedTitle || '').trim()) return res.status(400).json({ error: 'Add custom response text or Embed content.' });
    const cfg = loadConfig();
    if (!cfg.channelAutomations) cfg.channelAutomations = [];
    const entry = {
      id: body.id || `relay_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: String(body.name || 'Channel Relay').trim().slice(0, 80),
      enabled: body.enabled !== false,
      sourceChannelId,
      destinationChannelId,
      sameChannel,
      mode,
      requiredRoleId: String(body.requiredRoleId || '').trim(),
      deleteSource: !!body.deleteSource,
      responseType: body.responseType === 'image' ? 'image' : (body.responseType === 'embed' ? 'embed' : 'text'),
      response: String(body.response || '').slice(0, 2000),
      imageUrl: String(body.imageUrl || '').trim(),
      embedTitle: String(body.embedTitle || '').slice(0, 256),
      embedDescription: String(body.embedDescription || '').slice(0, 4096),
      embedColor: /^#?[0-9a-f]{6}$/i.test(String(body.embedColor || '')) ? String(body.embedColor) : '#5865F2',
      embedImageUrl: String(body.embedImageUrl || '').trim(),
      postAction: ['none', 'reaction', 'message', 'both'].includes(body.postAction) ? body.postAction : 'none',
      reactionEmoji: String(body.reactionEmoji || '').trim().slice(0, 100),
      postMessage: String(body.postMessage || '').slice(0, 2000),
    };
    const idx = cfg.channelAutomations.findIndex(r => r.id === entry.id);
    if (idx === -1) cfg.channelAutomations.push(entry); else cfg.channelAutomations[idx] = { ...cfg.channelAutomations[idx], ...entry };
    saveConfig(cfg);
    res.json({ ok: true, automations: cfg.channelAutomations, automation: entry });
  });
  app.post('/api/channel-automations/toggle', auth, (req, res) => {
    const cfg = loadConfig();
    const item = (cfg.channelAutomations || []).find(r => r.id === req.body?.id);
    if (!item) return res.status(404).json({ error: 'Automation not found.' });
    item.enabled = req.body.enabled !== false;
    saveConfig(cfg);
    res.json({ ok: true, automation: item });
  });
  app.delete('/api/channel-automations/:id', auth, (req, res) => {
    const cfg = loadConfig();
    cfg.channelAutomations = (cfg.channelAutomations || []).filter(r => r.id !== req.params.id);
    saveConfig(cfg);
    res.json({ ok: true, automations: cfg.channelAutomations });
  });

  // ── AUTO CHANNELS (emoji / sticker watch) ──
  app.get('/api/channels-watch', auth, async (req, res) => {
    const guild = discordClient.guilds.cache.first();
    if (!guild) return res.json({});
    try {
      const data = await db.loadData();
      const gd = data[guild.id] || {};
      res.json({ emojiChannelId: gd.emojiWatchChannel || '', stickerChannelId: gd.stickerWatchChannel || '' });
    } catch { res.json({}); }
  });

  app.post('/api/channels-watch', auth, async (req, res) => {
    const guild = discordClient.guilds.cache.first();
    if (!guild) return res.status(400).json({ error: 'Bot is not in any guild.' });
    try {
      const data = await db.loadData();
      if (!data[guild.id]) data[guild.id] = {};
      if (req.body.emojiChannelId !== undefined) data[guild.id].emojiWatchChannel = req.body.emojiChannelId;
      if (req.body.stickerChannelId !== undefined) data[guild.id].stickerWatchChannel = req.body.stickerChannelId;
      await db.saveData(data);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── EMBED MANAGER ──
  const normalizeDiscordEmojiSyntax = (value) => String(value || '').replace(/<:([as]):([^:>]+):(\d+)>/g, (_, kind, name, id) =>
    kind === 'a' ? `<a:${name}:${id}>` : `<:${name}:${id}>`
  );
  app.get('/api/embeds', auth, (req, res) => {
    const cfg = loadConfig();
    res.json(cfg.savedEmbeds || []);
  });

  app.post('/api/embeds', auth, async (req, res) => {
    const cfg = loadConfig();
    if (!cfg.savedEmbeds) cfg.savedEmbeds = [];
    let { id, name, title, description, color, footer, imageUrl, thumbnailUrl, buttons, selectMenu, reactionRoles } = req.body;
    // Normalize common malformed pasted custom-emoji tags before saving.
    title = normalizeDiscordEmojiSyntax(title);
    description = normalizeDiscordEmojiSyntax(description);
    footer = normalizeDiscordEmojiSyntax(footer);
    buttons = Array.isArray(buttons) ? buttons.map(b => ({ ...b, emoji: normalizeDiscordEmojiSyntax(b?.emoji) })) : [];
    if (selectMenu?.options) {
      selectMenu = { ...selectMenu, options: selectMenu.options.map(o => ({ ...o, emoji: normalizeDiscordEmojiSyntax(o?.emoji) })) };
    }
    // Resolve imgbb page links to direct image URLs so Discord can render them
    if (imageUrl)     imageUrl     = await resolveImgbbUrl(imageUrl);
    if (thumbnailUrl) thumbnailUrl = await resolveImgbbUrl(thumbnailUrl);
    reactionRoles = Array.isArray(reactionRoles)
      ? reactionRoles
          .filter(r => r && typeof r.emoji === 'string' && r.emoji.trim() && typeof r.roleId === 'string' && r.roleId.trim())
          .slice(0, 20)
          .map(r => ({ emoji: normalizeDiscordEmojiSyntax(r.emoji.trim()), roleId: r.roleId.trim() }))
      : [];
    const entry = { name, title, description, color, footer, imageUrl, thumbnailUrl,
      buttons: buttons || [], selectMenu: selectMenu || null, reactionRoles };
    if (id) {
      const idx = cfg.savedEmbeds.findIndex(e => e.id === id);
      if (idx !== -1) cfg.savedEmbeds[idx] = { id, ...entry };
      else cfg.savedEmbeds.push({ id, ...entry });
    } else {
      const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      cfg.savedEmbeds.push({ id: newId, ...entry });
    }
    saveConfig(cfg);
    res.json({ ok: true, embeds: cfg.savedEmbeds });
  });

  // ── TWO INDEPENDENT EMBED MESSAGES ──
  app.get('/api/message-pairs', auth, (req, res) => {
    const cfg = loadConfig();
    res.json({ ok: true, pairs: cfg.savedMessagePairs || [] });
  });
  app.post('/api/message-pairs', auth, async (req, res) => {
    const cfg = loadConfig();
    if (!cfg.savedMessagePairs) cfg.savedMessagePairs = [];
    const { id, name, messages } = req.body || {};
    if (!name || !Array.isArray(messages) || messages.length !== 2) {
      return res.status(400).json({ ok: false, error: 'name and exactly two messages are required' });
    }
    if (messages.some(m => !m || !String(m.channelId || '').trim())) {
      return res.status(400).json({ ok: false, error: 'Each message needs its own channelId' });
    }
    const normalizedMessages = [];
    for (const m of messages) {
      const item = {
        channelId: String(m.channelId).trim(),
        content: String(m.content || '').slice(0, 2000),
        title: String(m.title || '').slice(0, 256),
        description: String(m.description || '').slice(0, 4096),
        color: /^#?[0-9a-f]{6}$/i.test(String(m.color || '')) ? String(m.color) : '#5865F2',
        footer: String(m.footer || '').slice(0, 2048),
        imageUrl: m.imageUrl ? await resolveImgbbUrl(String(m.imageUrl).trim()) : null,
        thumbnailUrl: m.thumbnailUrl ? await resolveImgbbUrl(String(m.thumbnailUrl).trim()) : null,
      };
      if (!item.content && !item.title && !item.description && !item.imageUrl && !item.thumbnailUrl) {
        return res.status(400).json({ ok: false, error: 'Each message needs content or Embed data' });
      }
      normalizedMessages.push(item);
    }
    const entry = { name: String(name).trim().slice(0, 80), messages: normalizedMessages, updatedAt: new Date().toISOString() };
    if (id) {
      const idx = cfg.savedMessagePairs.findIndex(p => p.id === id);
      if (idx !== -1) cfg.savedMessagePairs[idx] = { id, ...entry };
      else cfg.savedMessagePairs.push({ id, ...entry });
    } else {
      const newId = `pair_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      cfg.savedMessagePairs.push({ id: newId, ...entry });
    }
    saveConfig(cfg);
    res.json({ ok: true, pairs: cfg.savedMessagePairs, pair: cfg.savedMessagePairs.at(-1) });
  });
  app.delete('/api/message-pairs/:id', auth, (req, res) => {
    const cfg = loadConfig();
    cfg.savedMessagePairs = (cfg.savedMessagePairs || []).filter(p => p.id !== req.params.id);
    saveConfig(cfg);
    res.json({ ok: true, pairs: cfg.savedMessagePairs });
  });
  app.post('/api/message-pairs/:id/send', auth, async (req, res) => {
    const cfg = loadConfig();
    const pair = (cfg.savedMessagePairs || []).find(p => p.id === req.params.id);
    if (!pair) return res.status(404).json({ ok: false, error: 'Message pair not found.' });
    const sent = [];
    try {
      for (const item of pair.messages) {
        const ch = discordClient.channels.cache.get(item.channelId) || await discordClient.channels.fetch(item.channelId).catch(() => null);
        if (!ch?.send) throw new Error(`Channel not found or not sendable: ${item.channelId}`);
        const payload = {};
        if (item.content) payload.content = item.content;
        const hasEmbed = item.title || item.description || item.footer || item.imageUrl || item.thumbnailUrl;
        if (hasEmbed) {
          const color = parseInt(String(item.color || '#5865F2').replace('#', ''), 16) || 0x5865F2;
          const embed = new EmbedBuilder().setColor(color);
          if (item.title) embed.setTitle(item.title);
          if (item.description) embed.setDescription(item.description);
          if (item.footer) embed.setFooter({ text: item.footer });
          if (item.imageUrl) embed.setImage(item.imageUrl);
          if (item.thumbnailUrl) embed.setThumbnail(item.thumbnailUrl);
          payload.embeds = [embed];
        }
        if (!payload.content && !payload.embeds) throw new Error('Message has no content or Embed data');
        const message = await ch.send(payload);
        sent.push({ channelId: ch.id, messageId: message.id });
      }
      res.json({ ok: true, sent });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message, sent });
    }
  });
  // ── RESOLVE IMAGE URL (for dashboard preview) ──
  // Resolves imgbb page links to direct image URLs; passes other URLs through unchanged.
  app.get('/api/resolve-image', auth, async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url required' });
    try {
      const resolved = await resolveImgbbUrl(url);
      res.json({ url: resolved });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/embeds/:id', auth, (req, res) => {
    const cfg = loadConfig();
    if (!cfg.savedEmbeds) return res.json({ ok: true });
    cfg.savedEmbeds = cfg.savedEmbeds.filter(e => e.id !== req.params.id);
    saveConfig(cfg);
    res.json({ ok: true });
  });

  app.post('/api/embeds/:id/send', auth, async (req, res) => {
    const { channelId, threadName } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId required' });
    const cfg = loadConfig();
    const emb = (cfg.savedEmbeds || []).find(e => e.id === req.params.id);
    if (!emb) return res.status(404).json({ error: 'Embed not found.' });
    try {
      const ch = discordClient.channels.cache.get(channelId);
      if (!ch) return res.status(404).json({ error: 'Channel not found.' });
      const color = emb.color ? parseInt(emb.color.replace('#', ''), 16) : 0x5865F2;
      const embed = new EmbedBuilder().setColor(color);
      if (emb.title)        embed.setTitle(normalizeDiscordEmojiSyntax(emb.title));
      if (emb.description)  embed.setDescription(normalizeDiscordEmojiSyntax(emb.description));
      if (emb.footer)       embed.setFooter({ text: normalizeDiscordEmojiSyntax(emb.footer) });
      if (emb.imageUrl)     embed.setImage(emb.imageUrl);
      if (emb.thumbnailUrl) embed.setThumbnail(emb.thumbnailUrl);

      const styleMap = { Primary: ButtonStyle.Primary, Secondary: ButtonStyle.Secondary, Success: ButtonStyle.Success, Danger: ButtonStyle.Danger };
      const components = [];

      // Buttons (up to 5 per row)
      if (emb.buttons?.length) {
        const row = new ActionRowBuilder();
        emb.buttons.forEach((b, idx) => {
          const btn = new ButtonBuilder()
            .setCustomId(`emb_btn_${emb.id}_${idx}`)
            .setLabel(b.label || 'Button')
            .setStyle(styleMap[b.style] || ButtonStyle.Primary);
          if (b.emoji) btn.setEmoji(normalizeDiscordEmojiSyntax(b.emoji));
          row.addComponents(btn);
        });
        components.push(row);
      }

      // Select menu
      if (emb.selectMenu?.options?.length) {
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`emb_sel_${emb.id}`)
          .setPlaceholder(emb.selectMenu.placeholder || 'Choose an option…')
          .addOptions(emb.selectMenu.options.map((o, idx) => {
            const opt = new StringSelectMenuOptionBuilder()
              .setLabel(o.label || `Option ${idx + 1}`)
              .setValue(String(idx));
            if (o.description) opt.setDescription(o.description);
            if (o.emoji) opt.setEmoji(normalizeDiscordEmojiSyntax(o.emoji));
            return opt;
          }));
        components.push(new ActionRowBuilder().addComponents(menu));
      }

      let sentMessage;
      if (ch.type === ChannelType.GuildForum) {
        const name = (threadName || emb.title || emb.name || 'New Post').slice(0, 100);
        const thread = await ch.threads.create({
          name,
          message: { embeds: [embed], components },
        });
        sentMessage = await thread.fetchStarterMessage();
      } else {
        sentMessage = await ch.send({ embeds: [embed], components });
      }

      // Reactions are configured on the saved embed, but tracked by message ID
      // so the same embed can be sent to multiple channels/messages.
      if (emb.reactionRoles?.length && sentMessage) {
        const reactionRoleMessages = cfg.reactionRoleMessages || {};
        for (const rr of emb.reactionRoles) {
          try {
            const customEmojiId = rr.emoji.match(/^<a?:[^:>]+:(\d+)>$/)?.[1];
            await sentMessage.react(customEmojiId || rr.emoji);
          } catch (err) {
            console.error(`[reaction role] failed to add ${rr.emoji}:`, err.message);
          }
        }
        reactionRoleMessages[sentMessage.id] = {
          embedId: emb.id,
          channelId: ch.id,
          reactions: emb.reactionRoles,
        };
        cfg.reactionRoleMessages = reactionRoleMessages;
        saveConfig(cfg);
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('[embed send]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── RULES CONFIG (text + colors) ──
  app.get('/api/rules/config', auth, (req, res) => {
    const cfg = loadConfig();
    res.json(cfg.rulesConfig || {});
  });

  app.post('/api/rules/config', auth, express.json(), (req, res) => {
    const cfg = loadConfig();
    cfg.rulesConfig = req.body;
    saveConfig(cfg);
    res.json({ ok: true });
  });

  // ── RULES BANNER UPLOAD ──
  app.post('/api/rules/banner', auth, express.raw({ type: 'application/octet-stream', limit: '10mb' }), async (req, res) => {
    try {
      const assetsDir = path.join(__dirname, 'assets');
      if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);
      const bannerPath = path.join(assetsDir, 'rules_banner.webp');
      fs.writeFileSync(bannerPath, req.body);
      await db.saveStaticAsset('rules_banner', req.body);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/rules/banner', auth, async (req, res) => {
    const bannerPath = path.join(__dirname, 'assets', 'rules_banner.webp');
    try { if (fs.existsSync(bannerPath)) fs.unlinkSync(bannerPath); } catch (err) { console.error('[rules banner delete]', err.message); }
    try { await db.deleteStaticAsset('rules_banner'); } catch (err) { console.error('[rules banner db delete]', err.message); }
    res.json({ ok: true });
  });

  app.get('/api/rules/banner', auth, (req, res) => {
    const bannerPath = path.join(__dirname, 'assets', 'rules_banner.webp');
    if (fs.existsSync(bannerPath)) return res.sendFile(bannerPath);
    res.status(404).end();
  });

  // ── RULES SEND ──
  app.post('/api/rules/send', auth, async (req, res) => {
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId required' });
    try {
      const ch = discordClient.channels.cache.get(channelId);
      if (!ch) return res.status(404).json({ error: 'Channel not found.' });
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
      const fs = require('fs');
      const path = require('path');
      const bannerPath = path.join(__dirname, 'assets', 'rules_banner.webp');
      const rulesConfig = loadConfig().rulesConfig || {};
      const embedColor  = rulesConfig.colors?.embedColor ? parseInt(rulesConfig.colors.embedColor.replace('#', ''), 16) : 0x3b82f6;
      const btnLabel    = rulesConfig.buttonLabel || '📖  القوانين';

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rules_spread_0').setLabel(btnLabel).setStyle(ButtonStyle.Secondary)
      );

      const embed = new EmbedBuilder()
        .setTitle(rulesConfig.embedTitle || 'Atlantis Rules')
        .setColor(embedColor)
        .setDescription(
          rulesConfig.embedDescription ||
          'في هذه الائحة توجد مجموعه من القوانين التي يجب على جميع من في خادمنا اتباعها، لكي\n' +
          'تتجنب العقوبات التي قد تلحق بك بسبب مخالفه احد هذه القوانين\n' +
          'نرجوا منكم حفظها وعدم مخالفتها!\n' +
          'لقد اجتهدنا لنجعل قوانين خادمنا بسيطه و ملأئمه للجميع <a:DVN_NekoHappy:1522696985080107019>'
        )
        .setImage('attachment://rules_banner.webp');
      const payload = { embeds: [embed], components: [row] };
      if (fs.existsSync(bannerPath)) payload.files = [new AttachmentBuilder(bannerPath, { name: 'rules_banner.webp' })];
      await ch.send(payload);
      res.json({ ok: true });
    } catch (err) {
      console.error('[rules send]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── BACKUPS ──
  app.get('/api/backups', auth, (req, res) => {
    try { res.json({ ok: true, backups: backup.getBackupList(), status: backup.getSchedulerStatus() }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/backups/now', auth, async (req, res) => {
    try {
      const filename = await backup.createBackup();
      res.json({ ok: true, filename, status: backup.getSchedulerStatus() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/backups/:filename', auth, (req, res) => {
    const p = backup.getBackupPath(req.params.filename);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const filename = path.basename(req.params.filename);
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.sendFile(p);
  });

  app.delete('/api/backups/:filename', auth, (req, res) => {
    const ok = backup.deleteBackup(req.params.filename);
    res.json({ ok });
  });

  app.post('/api/backups/:filename/restore', auth, async (req, res) => {
    try {
      const { parts = [] } = req.body;
      if (!Array.isArray(parts) || !parts.length)
        return res.status(400).json({ error: 'No restore parts specified' });
      const results = await backup.restoreBackup(req.params.filename, parts);
      res.json({ ok: true, results });
    } catch (err) {
      console.error('[restore]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  const PORT = process.env.PORT || _cfg.port || 8080;
  app.listen(PORT, '0.0.0.0', () => console.log(`Dashboard running on port ${PORT}`));
}

module.exports = { startWebServer, loadConfig, saveConfig, initWebConfig };
