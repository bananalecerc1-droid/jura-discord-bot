'use strict';

const fs   = require('fs');
const path = require('path');
const db   = require('./db.js');

const BACKUP_DIR  = path.join(__dirname, 'backups');
const MAX_BACKUPS = 10;
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Stored on first startBackupScheduler() call so API routes can trigger
// createBackup() without needing to re-pass the client.
let _discordClient = null;

// ── helpers ───────────────────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function backupFilename() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `backup_${date}_${time}.json`;
}

function listBackupFiles() {
  ensureDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
    .sort();
}

function pruneOldBackups() {
  const files = listBackupFiles();
  const excess = files.length - MAX_BACKUPS;
  for (let i = 0; i < excess; i++) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, files[i])); }
    catch (e) { console.error('[backup] prune error:', e.message); }
  }
}

// ── Discord guild snapshot ────────────────────────────────────────────────────

async function snapDiscordGuild(client) {
  if (!client || !client.isReady()) return null;
  const guild = client.guilds.cache.first();
  if (!guild) return null;

  // Re-fetch to get banner/splash/icon fields populated
  try { await guild.fetch(); } catch { /* use cached */ }

  // Roles
  const roles = await Promise.all(guild.roles.cache
    .sort((a, b) => b.position - a.position)
    .map(async r => {
      const iconUrl = r.iconURL({ extension: 'png', size: 1024 }) || null;
      let iconData = null;
      if (iconUrl) {
        try {
          const response = await fetch(iconUrl);
          if (response.ok) {
            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length <= 1024 * 1024) iconData = bytes.toString('base64');
          }
        } catch (err) {
          console.warn(`[backup] Could not download icon for role ${r.name}:`, err.message);
        }
      }
      return ({
      id:          r.id,
      name:        r.name,
      color:       r.hexColor,
      position:    r.position,
      hoist:       r.hoist,
      mentionable: r.mentionable,
      managed:     r.managed,
      permissions: r.permissions.bitfield.toString(),
      icon_url:    iconUrl,
      icon_data:   iconData,
      unicode_emoji: r.unicodeEmoji || null,
      });
    }));

  // Channels (all types: text, voice, category, forum, announcement, stage …)
  const channels = guild.channels.cache
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(c => {
      const base = {
        id:        c.id,
        name:      c.name,
        type:      c.type,       // numeric ChannelType enum
        position:  c.position ?? null,
        parent_id: c.parentId   || null,
        permission_overwrites: [...(c.permissionOverwrites?.cache?.values() ?? [])].map(ow => ({
          id:    ow.id,
          type:  ow.type,
          allow: ow.allow.bitfield.toString(),
          deny:  ow.deny.bitfield.toString(),
        })),
      };
      // Text-like fields
      if (c.topic      != null) base.topic       = c.topic;
      if (c.nsfw       != null) base.nsfw        = c.nsfw;
      if (c.rateLimitPerUser != null) base.slowmode = c.rateLimitPerUser;
      // Voice-like fields
      if (c.bitrate    != null) base.bitrate     = c.bitrate;
      if (c.userLimit  != null) base.user_limit  = c.userLimit;
      if (c.rtcRegion  != null) base.region      = c.rtcRegion;
      return base;
    });

  // Emojis
  const emojis = guild.emojis.cache.map(e => ({
    id:        e.id,
    name:      e.name,
    animated:  e.animated,
    available: e.available,
    url:       e.imageURL({ size: 128 }),
  }));

  // Stickers
  const stickers = guild.stickers.cache.map(s => ({
    id:          s.id,
    name:        s.name,
    description: s.description || '',
    format:      s.format,
    url:         s.url,
  }));

  // Fetch the complete member cache before recording boosters and role
  // assignments; otherwise only recently seen members may be included.
  try { await guild.members.fetch({ withPresences: false }); } catch { /* use cached */ }

  // Members who have boosted
  const boosters = guild.members.cache
    .filter(m => m.premiumSince)
    .map(m => ({
      id:            m.id,
      username:      m.user.username,
      displayName:   m.displayName,
      boostingSince: m.premiumSinceTimestamp,
    }));

  // Member role assignments. This must be captured explicitly; Discord does
  // not provide historical role membership after roles are deleted/recreated.
  const member_roles = [...guild.members.cache.values()]
    .filter(m => !m.user.bot)
    .map(m => ({
      id: m.id,
      username: m.user.username,
      roles: m.roles.cache
        .filter(r => r.id !== guild.id && !r.managed)
        .map(r => r.id),
    }));

  return {
    id:                guild.id,
    name:              guild.name,
    description:       guild.description || null,
    owner_id:          guild.ownerId,
    member_count:      guild.memberCount,
    created_at:        guild.createdTimestamp,
    boost_tier:        guild.premiumTier,
    boost_count:       guild.premiumSubscriptionCount || 0,
    preferred_locale:  guild.preferredLocale,
    verification_level: guild.verificationLevel,
    // Asset URLs (CDN — remain valid as long as assets exist)
    icon_url:          guild.iconURL({ size: 4096, forceStatic: false }) || null,
    banner_url:        guild.bannerURL({ size: 4096 }) || null,
    splash_url:        guild.splashURL({ size: 4096 }) || null,
    discovery_splash:  guild.discoverySplashURL({ size: 4096 }) || null,
    roles,
    channels,
    emojis,
    stickers,
    boosters,
    member_roles,
  };
}

// ── Saved embeds from bot config ──────────────────────────────────────────────

async function snapSavedEmbeds() {
  try {
    const cfg = await db.loadBotConfig();
    return cfg.savedEmbeds || cfg.embeds || null;
  } catch { return null; }
}

// ── Main backup creator ───────────────────────────────────────────────────────

/**
 * Create a full backup snapshot and save it to disk.
 * Pass a Discord client to include the full guild structure.
 * Returns the filename on success.
 */
async function createBackup(client) {
  ensureDir();
  const resolvedClient = client || _discordClient;

  const [
    botConfig,
    xpStats,
    warnings,
    guildConfig,
    tickets,
    birthdays,
    streaks,
    dailyEvents,
    discordGuild,
    savedEmbeds,
  ] = await Promise.all([
    db.loadBotConfig(),
    db.getAllXpRows(),
    db.loadWarnings(),
    db.loadData(),
    db.loadTickets(),
    db.getAllBirthdays(),
    db.getAllStreaks(),
    db.loadDailyEvents(),
    snapDiscordGuild(resolvedClient),
    snapSavedEmbeds(),
  ]);

  const snapshot = {
    created_at:    Date.now(),
    version:       2,
    // ── Bot database ──
    bot_config:    botConfig,
    xp_stats:      xpStats,
    warnings,
    guild_config:  guildConfig,
    tickets,
    birthdays,
    streaks,
    daily_events:  dailyEvents,
    saved_embeds:  savedEmbeds,
    // ── Discord server structure ──
    discord_guild: discordGuild,
  };

  const filename = backupFilename();
  fs.writeFileSync(
    path.join(BACKUP_DIR, filename),
    JSON.stringify(snapshot, null, 2),
    'utf8'
  );
  pruneOldBackups();
  console.log(`[backup] ✅ Backup saved: ${filename}${discordGuild ? ` (guild: ${discordGuild.name}, ${discordGuild.roles.length} roles, ${discordGuild.channels.length} channels)` : ''}`);
  return filename;
}

// ── List / delete / download helpers ─────────────────────────────────────────

function getBackupList() {
  return listBackupFiles()
    .reverse()
    .map(filename => {
      const fullPath = path.join(BACKUP_DIR, filename);
      const stat = fs.statSync(fullPath);
      let created_at = stat.mtimeMs;
      let hasGuild = false;
      try {
        const m = filename.match(/backup_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/);
        if (m) {
          const iso = `${m[1]}T${m[2].replace(/-/g, ':')}`;
          const d   = new Date(iso);
          if (!isNaN(d)) created_at = d.getTime();
        }
        // Peek at first 512 bytes to detect guild snapshot presence cheaply
        const fd  = fs.openSync(fullPath, 'r');
        const buf = Buffer.alloc(512);
        fs.readSync(fd, buf, 0, 512, 0);
        fs.closeSync(fd);
        hasGuild = buf.toString().includes('"discord_guild"');
      } catch { /* ignore */ }
      return { filename, size: stat.size, created_at, hasGuild };
    });
}

function deleteBackup(filename) {
  if (!filename.match(/^backup_[\w-]+\.json$/)) return false;
  const fullPath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(fullPath)) return false;
  fs.unlinkSync(fullPath);
  return true;
}

function getBackupPath(filename) {
  if (!filename.match(/^backup_[\w-]+\.json$/)) return null;
  const fullPath = path.join(BACKUP_DIR, filename);
  return fs.existsSync(fullPath) ? fullPath : null;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _schedulerTimer = null;
let _lastBackupAt   = null;
let _nextBackupAt   = null;

function startBackupScheduler(client) {
  if (_schedulerTimer) return;
  _discordClient = client || null;

  const run = async () => {
    try {
      await createBackup();
      _lastBackupAt = Date.now();
    } catch (err) {
      console.error('[backup] ❌ Scheduled backup failed:', err.message);
    }
    _nextBackupAt = Date.now() + INTERVAL_MS;
  };

  run();
  _schedulerTimer = setInterval(run, INTERVAL_MS);
  _nextBackupAt   = Date.now() + INTERVAL_MS;
  console.log('[backup] Scheduler started — running every 24 h, keeping last', MAX_BACKUPS, 'backups.');
}

function getSchedulerStatus() {
  return {
    running:      !!_schedulerTimer,
    lastBackupAt: _lastBackupAt,
    nextBackupAt: _nextBackupAt,
    count:        listBackupFiles().length,
    maxBackups:   MAX_BACKUPS,
  };
}

// ── Restore ───────────────────────────────────────────────────────────────────

/**
 * Restore parts of a backup snapshot back into the bot database and/or
 * Discord server.  `parts` is an array of string keys:
 *   bot_config | xp_stats | warnings | guild_config | tickets |
 *   birthdays  | streaks  | daily_events |
 *   discord_roles | discord_channels | discord_emojis | member_roles
 *
 * Returns an object with one key per restored part and a short status string.
 */
async function restoreBackup(filename, parts) {
  const fullPath = getBackupPath(filename);
  if (!fullPath) throw new Error('Backup file not found');

  const snapshot = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const results  = {};

  // ── Bot DB ────────────────────────────────────────────────────────────────

  if (parts.includes('bot_config') && snapshot.bot_config) {
    await db.saveBotConfig(snapshot.bot_config);
    results.bot_config = 'restored';
  }

  if (parts.includes('xp_stats') && Array.isArray(snapshot.xp_stats) && snapshot.xp_stats.length) {
    await db.upsertXpBatch(snapshot.xp_stats);
    results.xp_stats = `${snapshot.xp_stats.length} rows restored`;
  }

  if (parts.includes('warnings') && snapshot.warnings) {
    await db.saveWarnings(snapshot.warnings);
    results.warnings = 'restored';
  }

  if (parts.includes('guild_config') && snapshot.guild_config) {
    await db.saveData(snapshot.guild_config);
    results.guild_config = 'restored';
  }

  if (parts.includes('tickets') && snapshot.tickets) {
    await db.saveTickets(snapshot.tickets);
    results.tickets = 'restored';
  }

  if (parts.includes('birthdays') && Array.isArray(snapshot.birthdays) && snapshot.birthdays.length) {
    await Promise.all(
      snapshot.birthdays.map(b => db.setBirthday(b.userId, b.username, b.day, b.month))
    );
    results.birthdays = `${snapshot.birthdays.length} entries restored`;
  }

  if (parts.includes('streaks') && snapshot.streaks) {
    const rows = [];
    for (const [guildId, users] of Object.entries(snapshot.streaks)) {
      for (const [userId, s] of Object.entries(users || {})) {
        rows.push({
          guild_id:      guildId,
          user_id:       userId,
          count:         s.count       ?? 0,
          longest:       s.longest     ?? 0,
          last_image_at: s.lastImageAt ?? 0,
          username:      s.username    ?? '',
          reminded:      s.reminded    ?? false,
        });
      }
    }
    if (rows.length) await db.upsertStreakBatch(rows);
    results.streaks = `${rows.length} entries restored`;
  }

  if (parts.includes('daily_events') && snapshot.daily_events) {
    await db.saveDailyEvents(snapshot.daily_events);
    results.daily_events = 'restored';
  }

  // ── Discord server structure ──────────────────────────────────────────────

  const client = _discordClient;
  const guild  = (client && client.isReady()) ? client.guilds.cache.first() : null;

  if (parts.includes('discord_roles') || parts.includes('discord_channels') ||
      parts.includes('discord_emojis') || parts.includes('member_roles')) {
    if (!guild) throw new Error('Discord client is not ready — cannot restore server structure');
  }

  // Roles
  const roleIdMap = {}; // backup role id → current role id (used by channel restore)

  if (parts.includes('discord_roles') && snapshot.discord_guild?.roles?.length) {
    await guild.roles.fetch();

    const backupRoles = snapshot.discord_guild.roles
      .filter(r => r.name !== '@everyone' && !r.managed)
      .sort((a, b) => a.position - b.position);

    let created = 0, updated = 0;

    for (const br of backupRoles) {
      let existing = guild.roles.cache.get(br.id)
                  || guild.roles.cache.find(r => r.name === br.name && !r.managed);
      const roleOptions = {
        name:        br.name,
        color:       br.color || '#000000',
        hoist:       br.hoist,
        mentionable: br.mentionable,
        permissions: br.permissions || '0',
        reason:      'Restored from backup',
      };
      // New backups contain icon_data so restoration does not depend on the
      // original Discord CDN asset still existing. Fall back to icon_url for
      // older backups, and leave icons untouched if neither field was saved.
      if (Object.hasOwn(br, 'icon_data')) {
        if (br.icon_data) roleOptions.icon = Buffer.from(br.icon_data, 'base64');
        else if (br.icon_url) roleOptions.icon = br.icon_url;
        else roleOptions.icon = null;
      } else if (br.icon_url) {
        roleOptions.icon = br.icon_url;
      }
      if (Object.hasOwn(br, 'unicode_emoji')) roleOptions.unicodeEmoji = br.unicode_emoji;

      if (existing) {
        try {
          await existing.edit(roleOptions);
          roleIdMap[br.id] = existing.id;
          updated++;
        } catch {
          roleIdMap[br.id] = existing.id; // keep mapping even if edit fails
        }
      } else {
        try {
          const newRole = await guild.roles.create(roleOptions);
          roleIdMap[br.id] = newRole.id;
          created++;
        } catch { /* skip un-creatable roles */ }
      }
    }
    const rolePositions = backupRoles
      .filter(br => roleIdMap[br.id] && Number.isInteger(br.position))
      .map(br => ({ role: roleIdMap[br.id], position: br.position }));
    if (rolePositions.length) {
      try {
        await guild.roles.setPositions(rolePositions);
      } catch (err) {
        console.warn('[backup] Could not fully restore role positions:', err.message);
      }
    }
    results.discord_roles = `${created} created, ${updated} updated`;
  }

  // Restore member role assignments after roles exist. Older backups created
  // before member_roles was introduced are left unchanged and report clearly.
  if (parts.includes('member_roles')) {
    if (!Array.isArray(snapshot.discord_guild?.member_roles)) {
      results.member_roles = 'not present in this backup';
    } else {
      await guild.roles.fetch();
      await guild.members.fetch({ withPresences: false });
      const backupRoleById = new Map(
        (snapshot.discord_guild.roles || []).map(r => [r.id, r])
      );
      const resolveSavedRole = (savedRoleId) => {
        const direct = guild.roles.cache.get(savedRoleId);
        if (direct && !direct.managed) return direct;
        const savedRole = backupRoleById.get(savedRoleId);
        return savedRole
          ? guild.roles.cache.find(r => !r.managed && r.name === savedRole.name)
          : null;
      };
      let restored = 0, skipped = 0;
      for (const savedMember of snapshot.discord_guild.member_roles) {
        const member = guild.members.cache.get(savedMember.id);
        if (!member) { skipped++; continue; }
        const mapped = (savedMember.roles || [])
          .map(resolveSavedRole)
          .filter(Boolean)
          .map(r => r.id);
        const managed = member.roles.cache.filter(r => r.managed).map(r => r.id);
        try {
          await member.roles.set(
            [...new Set([...managed, ...mapped])],
            'Restored member roles from backup'
          );
          restored++;
        } catch (err) {
          skipped++;
          console.warn(`[backup] Could not restore roles for ${savedMember.id}:`, err.message);
        }
      }
      results.member_roles = `${restored} members restored, ${skipped} skipped`;
    }
  }

  // Channels
  if (parts.includes('discord_channels') && snapshot.discord_guild?.channels?.length) {
    await guild.channels.fetch();

    const backupChannels = snapshot.discord_guild.channels;
    const cats   = backupChannels.filter(c => c.type === 4); // GuildCategory
    const others = backupChannels.filter(c => c.type !== 4);
    const catIdMap = {}; // backup category id → current category id

    // Convert saved overwrite targets to IDs in the current guild. Role IDs
    // normally remain stable, but role names provide a fallback when a role
    // was deleted and recreated. The @everyone role always uses the guild ID.
    const backupRoleById = new Map(
      (snapshot.discord_guild.roles || []).map(r => [r.id, r])
    );
    const resolveOverwriteId = (ow) => {
      if (ow.type === 0 && ow.id === snapshot.discord_guild.id) return guild.id;
      if (ow.type === 0) {
        const exact = guild.roles.cache.get(ow.id);
        if (exact) return exact.id;
        const savedRole = backupRoleById.get(ow.id);
        const byName = savedRole && guild.roles.cache.find(
          r => !r.managed && r.name === savedRole.name
        );
        return byName?.id || null;
      }
      // Member overwrites can retain their original user ID.
      return ow.id;
    };
    const permissionOverwritesFor = (saved) =>
      (saved.permission_overwrites || [])
        .map(ow => ({
          id: resolveOverwriteId(ow),
          type: ow.type,
          allow: BigInt(ow.allow || 0),
          deny: BigInt(ow.deny || 0),
        }))
        .filter(ow => ow.id);
    const applyChannelSnapshot = async (channel, saved) => {
      const overwrites = permissionOverwritesFor(saved);
      if (!Array.isArray(saved.permission_overwrites)) return;
      try {
        await channel.permissionOverwrites.set(
          overwrites,
          'Restored channel permissions from backup'
        );
      } catch (err) {
        console.warn(`[backup] Could not restore permissions for ${saved.name}:`, err.message);
      }
    };

    let created = 0;

    // Categories first
    for (const cat of cats) {
      const existing = guild.channels.cache.get(cat.id)
                    || guild.channels.cache.find(c => c.name === cat.name && c.type === 4);
      if (existing) {
        catIdMap[cat.id] = existing.id;
      } else {
        try {
          const nc = await guild.channels.create({ name: cat.name, type: 4, reason: 'Restored from backup' });
          catIdMap[cat.id] = nc.id;
          await applyChannelSnapshot(nc, cat);
          created++;
        } catch { /* skip */ }
      }
      const current = guild.channels.cache.get(catIdMap[cat.id]);
      if (current) await applyChannelSnapshot(current, cat);
    }

    // Text / voice / etc.
    for (const ch of others) {
      const existing = guild.channels.cache.get(ch.id)
                    || guild.channels.cache.find(c => c.name === ch.name && c.type === ch.type);
      if (!existing) {
        try {
          const opts = {
            name:   ch.name,
            type:   ch.type,
            reason: 'Restored from backup',
          };
          if (ch.parent_id && catIdMap[ch.parent_id]) opts.parent = catIdMap[ch.parent_id];
          if (ch.topic    != null) opts.topic            = ch.topic;
          if (ch.nsfw     != null) opts.nsfw             = ch.nsfw;
          if (ch.slowmode != null) opts.rateLimitPerUser = ch.slowmode;
          if (ch.bitrate  != null) opts.bitrate          = ch.bitrate;
          if (ch.user_limit != null) opts.userLimit      = ch.user_limit;
          const createdChannel = await guild.channels.create(opts);
          await applyChannelSnapshot(createdChannel, ch);
          created++;
        } catch (err) {
          console.warn(`[backup] Could not restore channel ${ch.name}:`, err.message);
        }
      } else {
        await applyChannelSnapshot(existing, ch);
      }
    }
    results.discord_channels = `${created} created`;
  }

  // Emojis
  if (parts.includes('discord_emojis') && snapshot.discord_guild?.emojis?.length) {
    await guild.emojis.fetch();

    let created = 0, skipped = 0;
    for (const em of snapshot.discord_guild.emojis) {
      const exists = guild.emojis.cache.find(e => e.name === em.name);
      if (exists) { skipped++; continue; }
      try {
        await guild.emojis.create({ attachment: em.url, name: em.name, reason: 'Restored from backup' });
        created++;
      } catch { skipped++; }
    }
    results.discord_emojis = `${created} created, ${skipped} skipped`;
  }

  return results;
}

module.exports = {
  createBackup,
  restoreBackup,
  getBackupList,
  deleteBackup,
  getBackupPath,
  startBackupScheduler,
  getSchedulerStatus,
};
