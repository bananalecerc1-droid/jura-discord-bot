// db.js — Turso (libsql) data layer for the Discord bot
'use strict';

const { createClient } = require('@libsql/client');
let cfg = {};
try { cfg = require('./config.json'); } catch {}

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl || !tursoAuthToken) {
  throw new Error(
    'Turso is not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the environment.'
  );
}

const client = createClient({
  url: tursoUrl,
  authToken: tursoAuthToken,
});

// ── INIT ──────────────────────────────────────────────────────────────────────

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS xp_stats (
    guild_id           TEXT    NOT NULL,
    user_id            TEXT    NOT NULL,
    username           TEXT    NOT NULL DEFAULT 'Unknown',
    total_xp           INTEGER NOT NULL DEFAULT 0,
    daily_xp           INTEGER NOT NULL DEFAULT 0,
    weekly_xp          INTEGER NOT NULL DEFAULT 0,
    monthly_xp         INTEGER NOT NULL DEFAULT 0,
    voice_total_xp     INTEGER NOT NULL DEFAULT 0,
    voice_daily_xp     INTEGER NOT NULL DEFAULT 0,
    voice_weekly_xp    INTEGER NOT NULL DEFAULT 0,
    voice_monthly_xp   INTEGER NOT NULL DEFAULT 0,
    last_daily_reset   INTEGER NOT NULL DEFAULT 0,
    last_weekly_reset  INTEGER NOT NULL DEFAULT 0,
    last_monthly_reset INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS warnings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id      TEXT    NOT NULL,
    user_id       TEXT    NOT NULL,
    reason        TEXT    NOT NULL DEFAULT '',
    moderator     TEXT    NOT NULL DEFAULT '',
    moderator_tag TEXT    NOT NULL DEFAULT '',
    timestamp     INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS warnings_guild_user ON warnings (guild_id, user_id)`,
  `CREATE TABLE IF NOT EXISTS local_xp (
    user_id   TEXT PRIMARY KEY,
    xp        INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS chat_activity (
    guild_id      TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    last_message  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS relay_messages (
    message_key TEXT PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    message_id  TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS relay_reactions (
    message_key TEXT NOT NULL,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    message_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    emoji       TEXT NOT NULL,
    PRIMARY KEY (message_key, user_id, emoji)
  )`,
  `CREATE TABLE IF NOT EXISTS giveaways (
    message_id    TEXT PRIMARY KEY,
    status        TEXT NOT NULL DEFAULT 'active',
    prize         TEXT NOT NULL DEFAULT '',
    winners       INTEGER NOT NULL DEFAULT 1,
    entries       TEXT NOT NULL DEFAULT '[]',
    ends_at       INTEGER NOT NULL DEFAULT 0,
    channel_id    TEXT NOT NULL DEFAULT '',
    guild_id      TEXT NOT NULL DEFAULT '',
    host_id       TEXT NOT NULL DEFAULT '',
    host_username TEXT NOT NULL DEFAULT '',
    last_winners  TEXT NOT NULL DEFAULT '[]',
    rerolls       INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS guild_config (
    guild_id              TEXT PRIMARY KEY,
    watch_channel         TEXT,
    emoji_watch_channel   TEXT,
    sticker_watch_channel TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS birthdays (
    user_id  TEXT PRIMARY KEY,
    username TEXT    NOT NULL DEFAULT '',
    day      INTEGER NOT NULL,
    month    INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS streaks (
    guild_id      TEXT    NOT NULL,
    user_id       TEXT    NOT NULL,
    count         INTEGER NOT NULL DEFAULT 0,
    longest       INTEGER NOT NULL DEFAULT 0,
    last_image_at INTEGER NOT NULL DEFAULT 0,
    username      TEXT    NOT NULL DEFAULT '',
    reminded      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS tickets (
    guild_id   TEXT    NOT NULL,
    channel_id TEXT    NOT NULL,
    user_id    TEXT    NOT NULL DEFAULT '',
    username   TEXT    NOT NULL DEFAULT '',
    opened_at  INTEGER NOT NULL DEFAULT 0,
    claimed_by TEXT,
    claimed_at INTEGER,
    PRIMARY KEY (guild_id, channel_id)
  )`,
  `CREATE TABLE IF NOT EXISTS roles_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    action    TEXT,
    user_id   TEXT,
    role_id   TEXT,
    mod_id    TEXT,
    timestamp INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS messages_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    action     TEXT,
    user_id    TEXT,
    channel_id TEXT,
    message_id TEXT,
    content    TEXT    NOT NULL DEFAULT '',
    timestamp  INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS bans_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT    NOT NULL DEFAULT '',
    user_id    TEXT    NOT NULL DEFAULT '',
    user_tag   TEXT    NOT NULL DEFAULT '',
    moderator  TEXT    NOT NULL DEFAULT '',
    reason     TEXT    NOT NULL DEFAULT '',
    timestamp  INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS boost_roles (
    guild_id   TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    role_id    TEXT    NOT NULL DEFAULT '',
    role_name  TEXT    NOT NULL DEFAULT '',
    role_emoji TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS bot_config (
    id     TEXT PRIMARY KEY DEFAULT 'main',
    config TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS daily_events (
    id   TEXT PRIMARY KEY DEFAULT 'main',
    data TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS afk_states (
    guild_id        TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    username        TEXT NOT NULL DEFAULT '',
    reason          TEXT NOT NULL DEFAULT 'AFK',
    nickname        TEXT,
    since           INTEGER NOT NULL DEFAULT 0,
    mentions_count  INTEGER NOT NULL DEFAULT 0,
    last_mentioned  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS invite_joins (
    guild_id    TEXT NOT NULL,
    member_id   TEXT NOT NULL,
    member_name TEXT NOT NULL DEFAULT '',
    inviter_id  TEXT NOT NULL,
    invite_code TEXT NOT NULL DEFAULT '',
    joined_at   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, member_id)
  )`,
  `CREATE INDEX IF NOT EXISTS invite_joins_inviter ON invite_joins (guild_id, inviter_id)`,
  `CREATE TABLE IF NOT EXISTS invite_codes (
    guild_id   TEXT NOT NULL,
    code       TEXT NOT NULL,
    inviter_id TEXT,
    channel_id TEXT,
    uses       INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, code)
  )`,
  `CREATE TABLE IF NOT EXISTS invite_code_baselines (
    guild_id   TEXT NOT NULL,
    code       TEXT NOT NULL,
    inviter_id TEXT NOT NULL,
    uses       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, code)
  )`,
  `CREATE TABLE IF NOT EXISTS profile_images (
    guild_id   TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    avatar     BLOB    NOT NULL,
    banner     BLOB    NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_streaks (
    user_a      TEXT    NOT NULL,
    user_b      TEXT    NOT NULL,
    count       INTEGER NOT NULL DEFAULT 0,
    longest     INTEGER NOT NULL DEFAULT 0,
    last_day_at INTEGER NOT NULL DEFAULT 0,
    a_sent      INTEGER NOT NULL DEFAULT 0,
    b_sent      INTEGER NOT NULL DEFAULT 0,
    reminded    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_a, user_b)
  )`,
  `CREATE INDEX IF NOT EXISTS chat_streaks_user_a ON chat_streaks (user_a)`,
  `CREATE INDEX IF NOT EXISTS chat_streaks_user_b ON chat_streaks (user_b)`,
  `CREATE TABLE IF NOT EXISTS staff_activity (
    guild_id       TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    username       TEXT NOT NULL DEFAULT '',
    messages       INTEGER NOT NULL DEFAULT 0,
    interactions   INTEGER NOT NULL DEFAULT 0,
    closed_tickets INTEGER NOT NULL DEFAULT 0,
    actions_count  INTEGER NOT NULL DEFAULT 0,
    last_activity  INTEGER NOT NULL DEFAULT 0,
    last_login     INTEGER NOT NULL DEFAULT 0,
    last_login_day TEXT DEFAULT '',
    PRIMARY KEY (guild_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS analytics_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT    NOT NULL,
    event_type   TEXT    NOT NULL,
    user_id      TEXT    NOT NULL DEFAULT '',
    username     TEXT    NOT NULL DEFAULT '',
    channel_id   TEXT    NOT NULL DEFAULT '',
    channel_name TEXT    NOT NULL DEFAULT '',
    value        INTEGER NOT NULL DEFAULT 0,
    metadata     TEXT    NOT NULL DEFAULT '',
    timestamp    INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS analytics_events_guild_time ON analytics_events (guild_id, timestamp)`,
  `CREATE INDEX IF NOT EXISTS analytics_events_guild_type_time ON analytics_events (guild_id, event_type, timestamp)`,
  `CREATE TABLE IF NOT EXISTS user_backgrounds (
    user_id    TEXT    PRIMARY KEY,
    image      BLOB    NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS static_assets (
    key        TEXT    PRIMARY KEY,
    image      BLOB    NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
];

let dbReady = false;
module.exports.isDbReady = () => dbReady;

async function initDb() {
  try {
    try {
      await client.batch(
        SCHEMA_SQL.map(sql => ({ sql, args: [] })),
        'write'
      );
    } catch (batchErr) {
      // Some Turso/libSQL deployments reject large or mixed schema batches
      // with a generic HTTP 400. Retry individually so startup can recover
      // and expose the exact statement if a schema change is truly invalid.
      console.warn('[db] Turso schema batch failed; retrying statements individually:', batchErr.message);
      for (let i = 0; i < SCHEMA_SQL.length; i += 1) {
        try {
          await client.execute({ sql: SCHEMA_SQL[i], args: [] });
        } catch (statementErr) {
          statementErr.message = `schema statement ${i + 1}/${SCHEMA_SQL.length} failed: ${statementErr.message}`;
          throw statementErr;
        }
      }
    }
    // Migration: add voice XP columns to existing tables
    const migrations = [
      'ALTER TABLE xp_stats ADD COLUMN voice_total_xp   INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE xp_stats ADD COLUMN voice_daily_xp   INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE xp_stats ADD COLUMN voice_weekly_xp  INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE xp_stats ADD COLUMN voice_monthly_xp INTEGER NOT NULL DEFAULT 0',
    ];
    for (const sql of migrations) {
      await client.execute({ sql, args: [] }).catch(() => {}); // ignore "column already exists"
    }
    dbReady = true;
    console.log('[db] ✅ Connected to Turso — all tables ready.');
  } catch (err) {
    console.error('[db] ❌ Failed to initialise Turso schema:', err.message);
    throw err;
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function row2obj(row, columns) {
  const obj = {};
  columns.forEach((col, i) => { obj[col] = row[i]; });
  return obj;
}

function rows2objs({ rows, columns }) {
  return rows.map(r => row2obj(r, columns));
}

// ── XP ────────────────────────────────────────────────────────────────────────

async function getXpUser(guildId, userId) {
  const rs = await client.execute({
    sql:  'SELECT * FROM xp_stats WHERE guild_id = ? AND user_id = ?',
    args: [guildId, userId],
  });
  const objs = rows2objs(rs);
  return objs[0] || null;
}

async function upsertXpUser(guildId, userId, fields) {
  const keys   = ['guild_id', 'user_id', ...Object.keys(fields)];
  const values = [guildId,    userId,    ...Object.values(fields)];
  const sets   = Object.keys(fields).map(k => `${k} = excluded.${k}`).join(', ');
  await client.execute({
    sql:  `INSERT INTO xp_stats (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})
           ON CONFLICT(guild_id, user_id) DO UPDATE SET ${sets}`,
    args: values,
  });
}

async function getGuildXpAll(guildId) {
  const rs = await client.execute({
    sql:  'SELECT * FROM xp_stats WHERE guild_id = ?',
    args: [guildId],
  });
  return rows2objs(rs);
}

async function getAllXpRows() {
  const rs = await client.execute({ sql: 'SELECT * FROM xp_stats', args: [] });
  return rows2objs(rs);
}

async function upsertXpBatch(rows) {
  if (!rows.length) return;
  const stmts = rows.map(r => ({
    sql: `INSERT INTO xp_stats
            (guild_id, user_id, username, total_xp, daily_xp, weekly_xp, monthly_xp,
             voice_total_xp, voice_daily_xp, voice_weekly_xp, voice_monthly_xp,
             last_daily_reset, last_weekly_reset, last_monthly_reset)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(guild_id, user_id) DO UPDATE SET
            username = excluded.username,
            total_xp = excluded.total_xp,
            daily_xp = excluded.daily_xp,
            weekly_xp = excluded.weekly_xp,
            monthly_xp = excluded.monthly_xp,
            voice_total_xp = excluded.voice_total_xp,
            voice_daily_xp = excluded.voice_daily_xp,
            voice_weekly_xp = excluded.voice_weekly_xp,
            voice_monthly_xp = excluded.voice_monthly_xp,
            last_daily_reset = excluded.last_daily_reset,
            last_weekly_reset = excluded.last_weekly_reset,
            last_monthly_reset = excluded.last_monthly_reset`,
    args: [
      r.guild_id, r.user_id, r.username ?? 'Unknown',
      r.total_xp ?? 0, r.daily_xp ?? 0, r.weekly_xp ?? 0, r.monthly_xp ?? 0,
      r.voice_total_xp ?? 0, r.voice_daily_xp ?? 0, r.voice_weekly_xp ?? 0, r.voice_monthly_xp ?? 0,
      r.last_daily_reset ?? 0, r.last_weekly_reset ?? 0, r.last_monthly_reset ?? 0,
    ],
  }));
  await client.batch(stmts, 'write');
}

// ── WARNINGS ──────────────────────────────────────────────────────────────────

async function loadWarnings() {
  const rs = await client.execute({ sql: 'SELECT * FROM warnings ORDER BY id', args: [] });
  const result = {};
  for (const row of rows2objs(rs)) {
    if (!result[row.guild_id]) result[row.guild_id] = {};
    if (!result[row.guild_id][row.user_id]) result[row.guild_id][row.user_id] = [];
    result[row.guild_id][row.user_id].push({
      reason:       row.reason       || '',
      moderator:    row.moderator    || '',
      moderatorTag: row.moderator_tag || '',
      timestamp:    Number(row.timestamp) || 0,
    });
  }
  return result;
}

async function saveWarnings(data) {
  const guildIds = Object.keys(data);
  if (!guildIds.length) return;

  const stmts = guildIds.map(gId => ({
    sql:  'DELETE FROM warnings WHERE guild_id = ?',
    args: [gId],
  }));

  for (const [guildId, users] of Object.entries(data)) {
    for (const [userId, warns] of Object.entries(users || {})) {
      for (const w of warns) {
        stmts.push({
          sql:  'INSERT INTO warnings (guild_id, user_id, reason, moderator, moderator_tag, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          args: [guildId, userId, w.reason || '', w.moderator || '', w.moderatorTag || '', w.timestamp || Date.now()],
        });
      }
    }
  }
  await client.batch(stmts, 'write');
}

// ── GUILD CONFIG ──────────────────────────────────────────────────────────────

async function loadData() {
  const rs = await client.execute({ sql: 'SELECT * FROM guild_config', args: [] });
  const result = {};
  for (const row of rows2objs(rs)) {
    result[row.guild_id] = {
      watchChannel:        row.watch_channel         || null,
      emojiWatchChannel:   row.emoji_watch_channel   || null,
      stickerWatchChannel: row.sticker_watch_channel || null,
    };
  }
  return result;
}

async function saveData(data) {
  const stmts = Object.entries(data).map(([guildId, cfg]) => ({
    sql:  `INSERT INTO guild_config (guild_id, watch_channel, emoji_watch_channel, sticker_watch_channel)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(guild_id) DO UPDATE SET
             watch_channel = excluded.watch_channel,
             emoji_watch_channel = excluded.emoji_watch_channel,
             sticker_watch_channel = excluded.sticker_watch_channel`,
    args: [guildId, cfg.watchChannel || null, cfg.emojiWatchChannel || null, cfg.stickerWatchChannel || null],
  }));
  if (!stmts.length) return;
  await client.batch(stmts, 'write');
}

// ── TICKETS ───────────────────────────────────────────────────────────────────

async function loadTickets() {
  const rs = await client.execute({ sql: 'SELECT * FROM tickets', args: [] });
  const result = {};
  for (const row of rows2objs(rs)) {
    if (!result[row.guild_id]) result[row.guild_id] = {};
    const entry = {
      userId:   row.user_id,
      username: row.username  || '',
      openedAt: Number(row.opened_at) || 0,
    };
    if (row.claimed_by) {
      entry.claimedBy = row.claimed_by;
      entry.claimedAt = Number(row.claimed_at) || 0;
    }
    result[row.guild_id][row.channel_id] = entry;
  }
  return result;
}

async function saveTickets(data) {
  const guildIds = Object.keys(data);
  if (!guildIds.length) return;

  const stmts = guildIds.map(gId => ({
    sql:  'DELETE FROM tickets WHERE guild_id = ?',
    args: [gId],
  }));

  for (const [guildId, channels] of Object.entries(data)) {
    for (const [channelId, t] of Object.entries(channels || {})) {
      stmts.push({
        sql:  `INSERT INTO tickets (guild_id, channel_id, user_id, username, opened_at, claimed_by, claimed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [guildId, channelId, t.userId || '', t.username || '', t.openedAt || Date.now(), t.claimedBy || null, t.claimedAt || null],
      });
    }
  }
  await client.batch(stmts, 'write');
}

// ── BIRTHDAYS ─────────────────────────────────────────────────────────────────

async function setBirthday(userId, username, day, month) {
  await client.execute({
    sql:  `INSERT INTO birthdays (user_id, username, day, month) VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, day = excluded.day, month = excluded.month`,
    args: [userId, username, day, month],
  });
}

async function removeBirthday(userId) {
  const rs = await client.execute({
    sql:  'DELETE FROM birthdays WHERE user_id = ? RETURNING user_id',
    args: [userId],
  });
  return rs.rows.length > 0;
}

async function getBirthday(userId) {
  const rs = await client.execute({
    sql:  'SELECT * FROM birthdays WHERE user_id = ?',
    args: [userId],
  });
  const objs = rows2objs(rs);
  if (!objs[0]) return null;
  const d = objs[0];
  return { userId: d.user_id, username: d.username, day: d.day, month: d.month };
}

async function getAllBirthdays() {
  const rs = await client.execute({ sql: 'SELECT * FROM birthdays', args: [] });
  return rows2objs(rs).map(d => ({ userId: d.user_id, username: d.username, day: d.day, month: d.month }));
}

// ── STREAKS ───────────────────────────────────────────────────────────────────

async function getStreak(guildId, userId) {
  const rs = await client.execute({
    sql:  'SELECT * FROM streaks WHERE guild_id = ? AND user_id = ?',
    args: [guildId, userId],
  });
  const objs = rows2objs(rs);
  if (!objs[0]) return null;
  const d = objs[0];
  return {
    count:       d.count,
    longest:     d.longest,
    lastImageAt: Number(d.last_image_at),
    username:    d.username,
    reminded:    !!d.reminded,
  };
}

async function upsertStreak(guildId, userId, fields) {
  const colMap = {
    count:       'count',
    longest:     'longest',
    lastImageAt: 'last_image_at',
    username:    'username',
    reminded:    'reminded',
  };
  const cols   = ['guild_id', 'user_id'];
  const vals   = [guildId, userId];
  const setCls = [];

  for (const [key, col] of Object.entries(colMap)) {
    if (fields[key] !== undefined) {
      cols.push(col);
      vals.push(key === 'reminded' ? (fields[key] ? 1 : 0) : fields[key]);
      setCls.push(`${col} = excluded.${col}`);
    }
  }

  await client.execute({
    sql:  `INSERT INTO streaks (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
           ON CONFLICT(guild_id, user_id) DO UPDATE SET ${setCls.join(', ')}`,
    args: vals,
  });
}

async function getAllStreaks() {
  const rs = await client.execute({ sql: 'SELECT * FROM streaks', args: [] });
  const result = {};
  for (const d of rows2objs(rs)) {
    if (!result[d.guild_id]) result[d.guild_id] = {};
    result[d.guild_id][d.user_id] = {
      count:       d.count,
      longest:     d.longest,
      lastImageAt: Number(d.last_image_at),
      username:    d.username,
      reminded:    !!d.reminded,
    };
  }
  return result;
}

async function upsertStreakBatch(rows) {
  if (!rows.length) return;
  const stmts = rows.map(r => ({
    sql: `INSERT INTO streaks (guild_id, user_id, count, longest, last_image_at, username, reminded)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(guild_id, user_id) DO UPDATE SET
            count = excluded.count,
            longest = excluded.longest,
            last_image_at = excluded.last_image_at,
            username = excluded.username,
            reminded = excluded.reminded`,
    args: [
      r.guild_id, r.user_id,
      r.count ?? 0, r.longest ?? 0, r.last_image_at ?? 0,
      r.username ?? '', r.reminded ? 1 : 0,
    ],
  }));
  await client.batch(stmts, 'write');
}

// ── BOT CONFIG ────────────────────────────────────────────────────────────────

async function loadBotConfig() {
  const rs = await client.execute({
    sql:  "SELECT config FROM bot_config WHERE id = 'main'",
    args: [],
  });
  const objs = rows2objs(rs);
  if (!objs[0]) return {};
  try { return JSON.parse(objs[0].config); } catch { return {}; }
}

async function saveBotConfig(config) {
  const json = JSON.stringify(config);
  await client.execute({
    sql:  `INSERT INTO bot_config (id, config) VALUES ('main', ?)
           ON CONFLICT(id) DO UPDATE SET config = excluded.config`,
    args: [json],
  });
}

// ── DAILY EVENTS ──────────────────────────────────────────────────────────────

async function loadDailyEvents() {
  const rs = await client.execute({
    sql:  "SELECT data FROM daily_events WHERE id = 'main'",
    args: [],
  });
  const objs = rows2objs(rs);
  if (!objs[0]) return {};
  try { return JSON.parse(objs[0].data); } catch { return {}; }
}

async function saveDailyEvents(data) {
  const json = JSON.stringify(data);
  await client.execute({
    sql:  `INSERT INTO daily_events (id, data) VALUES ('main', ?)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    args: [json],
  });
}

// ── PROFILE IMAGES ────────────────────────────────────────────────────────────

async function saveProfileImages(guildId, userId, avatar, banner) {
  if (!guildId || !userId || !Buffer.isBuffer(avatar) || !Buffer.isBuffer(banner)) {
    throw new TypeError('Profile images require a guild, user, avatar buffer, and banner buffer.');
  }

  await client.execute({
    sql: `INSERT INTO profile_images (guild_id, user_id, avatar, banner, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(guild_id, user_id) DO UPDATE SET
            avatar = excluded.avatar,
            banner = excluded.banner,
            updated_at = excluded.updated_at`,
    args: [guildId, userId, avatar, banner, Date.now()],
  });
}

function blobToBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return value ? Buffer.from(value) : null;
}

async function getProfileImages(guildId, userId) {
  const rs = await client.execute({
    sql: 'SELECT avatar, banner, updated_at FROM profile_images WHERE guild_id = ? AND user_id = ?',
    args: [guildId, userId],
  });
  if (!rs.rows.length) return null;

  const row = rs.rows[0];
  return {
    avatar: blobToBuffer(row[0]),
    banner: blobToBuffer(row[1]),
    updatedAt: Number(row[2]) || 0,
  };
}

// ── USER RANK CARD BACKGROUNDS ────────────────────────────────────────────────

async function saveUserBackground(userId, imageBuffer) {
  if (!userId || !Buffer.isBuffer(imageBuffer)) {
    throw new TypeError('saveUserBackground requires a userId and image Buffer.');
  }
  await client.execute({
    sql: `INSERT INTO user_backgrounds (user_id, image, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            image = excluded.image,
            updated_at = excluded.updated_at`,
    args: [userId, imageBuffer, Date.now()],
  });
}

async function getUserBackground(userId) {
  const rs = await client.execute({
    sql:  'SELECT image FROM user_backgrounds WHERE user_id = ?',
    args: [userId],
  });
  if (!rs.rows.length) return null;
  return blobToBuffer(rs.rows[0][0]);
}

async function deleteUserBackground(userId) {
  await client.execute({
    sql:  'DELETE FROM user_backgrounds WHERE user_id = ?',
    args: [userId],
  });
}

// ── STATIC DASHBOARD ASSETS (welcome bg, rank bg, leaderboard bg, quote bg, rules banner) ──

async function saveStaticAsset(key, imageBuffer) {
  if (!key || !Buffer.isBuffer(imageBuffer)) {
    throw new TypeError('saveStaticAsset requires a key and image Buffer.');
  }
  await client.execute({
    sql: `INSERT INTO static_assets (key, image, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            image = excluded.image,
            updated_at = excluded.updated_at`,
    args: [key, imageBuffer, Date.now()],
  });
}

async function getStaticAsset(key) {
  const rs = await client.execute({
    sql:  'SELECT image FROM static_assets WHERE key = ?',
    args: [key],
  });
  if (!rs.rows.length) return null;
  return blobToBuffer(rs.rows[0][0]);
}

async function deleteStaticAsset(key) {
  await client.execute({
    sql:  'DELETE FROM static_assets WHERE key = ?',
    args: [key],
  });
}

// ── CHAT STREAKS ──────────────────────────────────────────────────────────────

async function getChatStreak(userA, userB) {
  const rs = await client.execute({
    sql:  'SELECT * FROM chat_streaks WHERE user_a = ? AND user_b = ?',
    args: [userA, userB],
  });
  const objs = rows2objs(rs);
  if (!objs[0]) return null;
  const d = objs[0];
  return {
    userA:     d.user_a,
    userB:     d.user_b,
    count:     Number(d.count),
    longest:   Number(d.longest),
    lastDayAt: Number(d.last_day_at),
    aSent:     Number(d.a_sent),
    bSent:     Number(d.b_sent),
    reminded:  Number(d.reminded),
  };
}

async function upsertChatStreak(userA, userB, fields) {
  const colMap = {
    count:     'count',
    longest:   'longest',
    lastDayAt: 'last_day_at',
    aSent:     'a_sent',
    bSent:     'b_sent',
    reminded:  'reminded',
  };
  const cols   = ['user_a', 'user_b'];
  const vals   = [userA, userB];
  const setCls = [];
  for (const [key, col] of Object.entries(colMap)) {
    if (fields[key] !== undefined) {
      cols.push(col);
      vals.push(fields[key]);
      setCls.push(`${col} = excluded.${col}`);
    }
  }
  await client.execute({
    sql:  `INSERT INTO chat_streaks (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
           ON CONFLICT(user_a, user_b) DO UPDATE SET ${setCls.join(', ')}`,
    args: vals,
  });
}

async function getChatStreaksForUser(userId) {
  const rs = await client.execute({
    sql:  'SELECT * FROM chat_streaks WHERE user_a = ? OR user_b = ? ORDER BY count DESC',
    args: [userId, userId],
  });
  return rows2objs(rs).map(d => ({
    userA:     d.user_a,
    userB:     d.user_b,
    count:     Number(d.count),
    longest:   Number(d.longest),
    lastDayAt: Number(d.last_day_at),
    aSent:     Number(d.a_sent),
    bSent:     Number(d.b_sent),
    reminded:  Number(d.reminded),
  }));
}

async function getAllChatStreaks() {
  const rs = await client.execute({ sql: 'SELECT * FROM chat_streaks', args: [] });
  return rows2objs(rs).map(d => ({
    userA:     d.user_a,
    userB:     d.user_b,
    count:     Number(d.count),
    longest:   Number(d.longest),
    lastDayAt: Number(d.last_day_at),
    aSent:     Number(d.a_sent),
    bSent:     Number(d.b_sent),
    reminded:  Number(d.reminded),
  }));
}

// ── STAFF ACTIVITY ─────────────────────────────────────────────────────────────
function staffActivityObject(row = {}) {
  return {
    guildId: row.guild_id || '',
    userId: row.user_id || '',
    username: row.username || '',
    messages: Number(row.messages) || 0,
    interactions: Number(row.interactions) || 0,
    closedTickets: Number(row.closed_tickets) || 0,
    actions: Number(row.actions_count) || 0,
    lastActivity: Number(row.last_activity) || 0,
    lastLogin: Number(row.last_login) || 0,
    lastLoginDay: row.last_login_day || '',
  };
}

async function getStaffActivity(guildId, userId) {
  const rs = await client.execute({
    sql: 'SELECT * FROM staff_activity WHERE guild_id = ? AND user_id = ?',
    args: [guildId, userId],
  });
  return staffActivityObject(rs.rows?.length ? row2obj(rs.rows[0], rs.columns) : { guild_id: guildId, user_id: userId });
}

async function recordStaffLogin(guildId, userId, username = '', loginDay = '') {
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO staff_activity (guild_id, user_id, username, last_activity, last_login, last_login_day)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(guild_id, user_id) DO UPDATE SET
            username = excluded.username,
            last_activity = excluded.last_activity,
            last_login = excluded.last_login,
            last_login_day = excluded.last_login_day`,
    args: [guildId, userId, username, now, now, loginDay],
  });
}

async function incrementStaffActivity(guildId, userId, username = '', metric = 'interactions', amount = 1) {
  const columns = {
    messages: 'messages',
    interactions: 'interactions',
    closedTickets: 'closed_tickets',
    actions: 'actions_count',
  };
  const column = columns[metric];
  if (!column) throw new Error(`Unknown staff activity metric: ${metric}`);
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO staff_activity (guild_id, user_id, username, ${column}, last_activity)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(guild_id, user_id) DO UPDATE SET
            username = excluded.username,
            ${column} = staff_activity.${column} + excluded.${column},
            last_activity = excluded.last_activity`,
    args: [guildId, userId, username, Number(amount) || 1, now],
  });
}

async function getStaffActivityRows(guildId, limit = 10) {
  const rs = await client.execute({
    sql: `SELECT a.*, COALESCE(x.total_xp, 0) AS total_xp
            FROM staff_activity a
            LEFT JOIN xp_stats x ON x.guild_id = a.guild_id AND x.user_id = a.user_id
           WHERE a.guild_id = ?
           ORDER BY total_xp DESC, a.actions_count DESC, a.last_activity DESC
           LIMIT ?`,
    args: [guildId, limit],
  });
  return rows2objs(rs);
}

// ── LOGS ──────────────────────────────────────────────────────────────────────

async function getRolesLog(limit = 1000) {
  const rs = await client.execute({
    sql:  'SELECT * FROM roles_log ORDER BY timestamp DESC LIMIT ?',
    args: [limit],
  });
  return rows2objs(rs);
}

async function getMessagesLog(limit = 1000) {
  const rs = await client.execute({
    sql:  'SELECT * FROM messages_log ORDER BY timestamp DESC LIMIT ?',
    args: [limit],
  });
  return rows2objs(rs);
}

async function getBansLog(limit = 1000) {
  const rs = await client.execute({
    sql:  'SELECT * FROM bans_log ORDER BY timestamp DESC LIMIT ?',
    args: [limit],
  });
  return rows2objs(rs);
}

async function logRole(action, userId, roleId, modId) {
  try {
    await client.execute({
      sql:  'INSERT INTO roles_log (action, user_id, role_id, mod_id, timestamp) VALUES (?, ?, ?, ?, ?)',
      args: [action, userId, roleId, modId, Date.now()],
    });
  } catch (err) {
    console.error('[db] Role log error:', err.message);
  }
}

async function logMessage(action, userId, channelId, messageId, content = '') {
  try {
    await client.execute({
      sql:  'INSERT INTO messages_log (action, user_id, channel_id, message_id, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      args: [action, userId, channelId, messageId, content.slice(0, 2000), Date.now()],
    });
  } catch (err) {
    console.error('[db] Message log error:', err.message);
  }
}

async function logBan(guildId, userId, userTag, moderator, reason = '') {
  try {
    await client.execute({
      sql:  'INSERT INTO bans_log (guild_id, user_id, user_tag, moderator, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      args: [guildId, userId, userTag || '', moderator || '', reason || '', Date.now()],
    });
  } catch (err) {
    console.error('[db] Ban log error:', err.message);
  }
}

async function deleteWarningsForUser(guildId, userId) {
  await client.execute({ sql: 'DELETE FROM warnings WHERE guild_id = ? AND user_id = ?', args: [guildId, userId] });
}

async function deleteRoleLog(id) {
  await client.execute({ sql: 'DELETE FROM roles_log WHERE id = ?', args: [id] });
}

async function deleteMessageLog(id) {
  await client.execute({ sql: 'DELETE FROM messages_log WHERE id = ?', args: [id] });
}

async function deleteBanLog(id) {
  await client.execute({ sql: 'DELETE FROM bans_log WHERE id = ?', args: [id] });
}

// ── AFK ────────────────────────────────────────────────────────────────────────

async function getAfkState(guildId, userId) {
  const rs = await client.execute({
    sql: 'SELECT guild_id, user_id, username, reason, nickname, since, mentions_count, last_mentioned FROM afk_states WHERE guild_id = ? AND user_id = ?',
    args: [guildId, userId],
  });
  const row = rs.rows?.[0];
  if (!row) return null;
  return row2obj(row, rs.columns);
}

async function getAfkStates(guildId, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rs = await client.execute({
    sql: `SELECT guild_id, user_id, username, reason, nickname, since, mentions_count, last_mentioned FROM afk_states WHERE guild_id = ? AND user_id IN (${placeholders})`,
    args: [guildId, ...ids],
  });
  return new Map(rows2objs(rs).map(row => [row.user_id, row]));
}

async function saveAfkState(guildId, userId, username, reason, nickname) {
  await client.execute({
    sql: `INSERT INTO afk_states (guild_id, user_id, username, reason, nickname, since, mentions_count, last_mentioned)
          VALUES (?, ?, ?, ?, ?, ?, 0, 0)
          ON CONFLICT(guild_id, user_id) DO UPDATE SET
            username = excluded.username,
            reason = excluded.reason,
            nickname = excluded.nickname,
            since = excluded.since,
            mentions_count = 0,
            last_mentioned = 0`,
    args: [guildId, userId, username || '', reason || 'AFK', nickname ?? null, Date.now()],
  });
  return getAfkState(guildId, userId);
}

async function incrementAfkMention(guildId, userId) {
  await client.execute({
    sql: 'UPDATE afk_states SET mentions_count = mentions_count + 1, last_mentioned = ? WHERE guild_id = ? AND user_id = ?',
    args: [Date.now(), guildId, userId],
  });
}

async function clearAfkState(guildId, userId) {
  const state = await getAfkState(guildId, userId);
  if (state) {
    await client.execute({ sql: 'DELETE FROM afk_states WHERE guild_id = ? AND user_id = ?', args: [guildId, userId] });
  }
  return state;
}

// ── INVITES ─────────────────────────────────────────────────────────────────────

async function upsertInviteCodes(guildId, rows) {
  const entries = Array.isArray(rows) ? rows : [];
  if (!entries.length) return;
  const now = Date.now();
  const statements = [];
  for (const row of entries) {
    const uses = Number(row.uses) || 0;
    const inviterId = row.inviterId || null;
    if (inviterId) statements.push({
      sql: `INSERT OR IGNORE INTO invite_code_baselines (guild_id, code, inviter_id, uses, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [guildId, row.code, inviterId, uses, now],
    });
    statements.push({
      sql: `INSERT INTO invite_codes (guild_id, code, inviter_id, channel_id, uses, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, code) DO UPDATE SET
              inviter_id = COALESCE(inviter_id, excluded.inviter_id),
              channel_id = excluded.channel_id,
              uses = excluded.uses,
              updated_at = excluded.updated_at`,
      args: [guildId, row.code, inviterId, row.channelId || null, uses, now],
    });
  }
  await client.batch(statements, 'write');
}

async function getInviteCode(guildId, code) {
  const rs = await client.execute({
    sql: 'SELECT guild_id, code, inviter_id, channel_id, uses, updated_at FROM invite_codes WHERE guild_id = ? AND code = ?',
    args: [guildId, code],
  });
  const row = rs.rows?.[0];
  return row ? row2obj(row, rs.columns) : null;
}

async function recordInviteJoin(guildId, memberId, memberName, inviterId, inviteCode) {
  await client.execute({
    sql: `INSERT INTO invite_joins (guild_id, member_id, member_name, inviter_id, invite_code, joined_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(guild_id, member_id) DO UPDATE SET
            member_name = excluded.member_name,
            inviter_id = excluded.inviter_id,
            invite_code = excluded.invite_code,
            joined_at = excluded.joined_at`,
    args: [guildId, memberId, memberName || '', inviterId, inviteCode || '', Date.now()],
  });
}

async function removeInviteJoin(guildId, memberId) {
  const rs = await client.execute({
    sql: 'SELECT inviter_id FROM invite_joins WHERE guild_id = ? AND member_id = ?',
    args: [guildId, memberId],
  });
  const inviterId = rs.rows?.[0]?.[0] || null;
  await client.execute({ sql: 'DELETE FROM invite_joins WHERE guild_id = ? AND member_id = ?', args: [guildId, memberId] });
  return inviterId;
}

async function getInviteCount(guildId, inviterId) {
  const rs = await client.execute({
    sql: `SELECT
            (SELECT COALESCE(SUM(uses), 0) FROM invite_code_baselines WHERE guild_id = ? AND inviter_id = ?) +
            (SELECT COUNT(*) FROM invite_joins WHERE guild_id = ? AND inviter_id = ?) AS count`,
    args: [guildId, inviterId, guildId, inviterId],
  });
  return Number(rs.rows?.[0]?.[0] || 0);
}

async function getInviteJoiners(guildId, inviterId, limit = 50) {
  const rs = await client.execute({
    sql: 'SELECT member_id, member_name, inviter_id, invite_code, joined_at FROM invite_joins WHERE guild_id = ? AND inviter_id = ? ORDER BY joined_at DESC LIMIT ?',
    args: [guildId, inviterId, Math.max(1, Math.min(100, Number(limit) || 50))],
  });
  return rows2objs(rs);
}

async function getInviteLeaderboard(guildId, limit = 10) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  const rs = await client.execute({
    sql: `SELECT inviter_id, SUM(invites) AS invites, MAX(last_joined) AS last_joined
            FROM (
              SELECT inviter_id, SUM(uses) AS invites, MAX(created_at) AS last_joined
                FROM invite_code_baselines
               WHERE guild_id = ?
               GROUP BY inviter_id
              UNION ALL
              SELECT inviter_id, COUNT(*) AS invites, MAX(joined_at) AS last_joined
                FROM invite_joins
               WHERE guild_id = ?
               GROUP BY inviter_id
            )
           GROUP BY inviter_id
           ORDER BY invites DESC, last_joined ASC
           LIMIT ?`,
    args: [guildId, guildId, safeLimit],
  });
  return rows2objs(rs);
}

// ── ANALYTICS ──────────────────────────────────────────────────────────────────

const analyticsBuffer = [];
let analyticsFlushPromise = null;

async function flushAnalyticsEvents() {
  if (analyticsFlushPromise || !analyticsBuffer.length) return analyticsFlushPromise;
  const batch = analyticsBuffer.splice(0, 250);
  analyticsFlushPromise = client.batch(batch.map(e => ({
    sql: `INSERT INTO analytics_events
      (guild_id, event_type, user_id, username, channel_id, channel_name, value, metadata, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      e.guildId || '', e.eventType || '', e.userId || '', e.username || '',
      e.channelId || '', e.channelName || '', Number(e.value) || 0,
      e.metadata ? JSON.stringify(e.metadata) : '', Number(e.timestamp) || Date.now(),
    ],
  })), 'write').catch(err => {
    console.error('[db] Analytics flush error:', err.message);
    analyticsBuffer.unshift(...batch);
  }).finally(() => { analyticsFlushPromise = null; });
  return analyticsFlushPromise;
}

function recordAnalyticsEvent(event) {
  if (!event?.guildId || !event?.eventType) return;
  analyticsBuffer.push({ ...event, timestamp: event.timestamp || Date.now() });
  if (analyticsBuffer.length >= 100) flushAnalyticsEvents().catch(() => {});
}

setInterval(() => flushAnalyticsEvents().catch(() => {}), 5000).unref();

async function getAnalyticsSummary(guildId, startAt, endAt) {
  await flushAnalyticsEvents();
  const args = [guildId, Number(startAt) || 0, Number(endAt) || Date.now()];
  const rs = await client.execute({
    sql: `SELECT event_type, user_id, username, channel_id, channel_name, value, metadata, timestamp
            FROM analytics_events
           WHERE guild_id = ? AND timestamp >= ? AND timestamp < ?
           ORDER BY timestamp ASC
           LIMIT 100000`,
    args,
  });
  const events = rows2objs(rs);
  const activeHours = Array.from({ length: 24 }, (_, hour) => ({ hour, messages: 0, xp: 0 }));
  const activeDays = {};
  const channelMap = new Map();
  const xpMap = new Map();
  const voiceMap = new Map();
  const uniqueUsers = new Set();
  let messages = 0, xp = 0, voiceSeconds = 0;
  for (const e of events) {
    const ts = Number(e.timestamp) || 0;
    const d = new Date(ts);
    const day = d.toISOString().slice(0, 10);
    const hour = d.getHours();
    if (e.user_id) uniqueUsers.add(e.user_id);
    if (e.event_type === 'message') {
      messages++;
      activeHours[hour].messages++;
      activeDays[day] = (activeDays[day] || 0) + 1;
      const key = e.channel_id || 'unknown';
      const cur = channelMap.get(key) || { channelId: key, name: e.channel_name || key, messages: 0 };
      cur.messages++;
      if (e.channel_name) cur.name = e.channel_name;
      channelMap.set(key, cur);
    } else if (e.event_type === 'xp' || e.event_type === 'voice_xp') {
      const amount = Number(e.value) || 0;
      xp += amount;
      activeHours[hour].xp += amount;
      xpMap.set(day, (xpMap.get(day) || 0) + amount);
    } else if (e.event_type === 'voice_session') {
      const seconds = Number(e.value) || 0;
      voiceSeconds += seconds;
      const cur = voiceMap.get(e.user_id || 'unknown') || { userId: e.user_id || '', username: e.username || 'Unknown', seconds: 0 };
      cur.seconds += seconds;
      if (e.username) cur.username = e.username;
      voiceMap.set(e.user_id || 'unknown', cur);
    }
  }
  const moderation = await Promise.all([
    client.execute({ sql: `SELECT COUNT(*) AS count FROM warnings WHERE guild_id = ? AND timestamp >= ? AND timestamp < ?`, args }),
    client.execute({ sql: `SELECT COUNT(*) AS count FROM bans_log WHERE guild_id = ? AND timestamp >= ? AND timestamp < ?`, args }),
    client.execute({ sql: `SELECT COUNT(*) AS count FROM roles_log WHERE timestamp >= ? AND timestamp < ?`, args: [args[1], args[2]] }),
  ]);
  const count = rs => Number(rs.rows?.[0]?.count || 0);
  return {
    range: { startAt: args[1], endAt: args[2] },
    totals: { messages, xp, voiceSeconds, uniqueUsers: uniqueUsers.size, events: events.length },
    activeHours,
    activeDays: Object.entries(activeDays).map(([date, count]) => ({ date, count })),
    topChannels: Array.from(channelMap.values()).sort((a, b) => b.messages - a.messages).slice(0, 10),
    xpGrowth: Array.from(xpMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount })),
    voiceActivity: Array.from(voiceMap.values()).sort((a, b) => b.seconds - a.seconds).slice(0, 10),
    moderation: { warnings: count(moderation[0]), bans: count(moderation[1]), roleActions: count(moderation[2]) },
  };
}

async function resetStaffPoints(guildId) {
  // Reset only staff-specific metrics in staff_activity table
  await client.execute({
    sql: 'UPDATE staff_activity SET messages=0, interactions=0, closed_tickets=0, actions_count=0 WHERE guild_id = ?',
    args: [guildId],
  });
  // NOTE: We no longer reset xp_stats here to prevent resetting general server XP.
}

// ── DURABLE FEATURE STATE ─────────────────────────────────────────────────────
async function getLocalXpAll() {
  const rs = await client.execute('SELECT user_id, xp FROM local_xp');
  const out = {};
  for (const row of rows2objs(rs)) out[String(row.user_id)] = Number(row.xp) || 0;
  return out;
}
async function incrementLocalXp(userId, amount = 1) {
  await client.execute({
    sql: `INSERT INTO local_xp (user_id, xp, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET xp = local_xp.xp + excluded.xp, updated_at = excluded.updated_at`,
    args: [String(userId), Number(amount) || 0, Date.now()],
  });
}
async function getChatActivityAll() {
  const rs = await client.execute('SELECT guild_id, user_id, last_message FROM chat_activity');
  const out = {};
  for (const row of rows2objs(rs)) {
    if (!out[row.guild_id]) out[row.guild_id] = {};
    out[row.guild_id][row.user_id] = Number(row.last_message) || 0;
  }
  return out;
}
async function upsertChatActivity(guildId, userId, lastMessage = Date.now()) {
  await client.execute({
    sql: `INSERT INTO chat_activity (guild_id, user_id, last_message) VALUES (?, ?, ?)
          ON CONFLICT(guild_id, user_id) DO UPDATE SET last_message = excluded.last_message`,
    args: [String(guildId), String(userId), Number(lastMessage) || Date.now()],
  });
}
async function loadRelayState() {
  const messagesRs = await client.execute('SELECT * FROM relay_messages');
  const reactionsRs = await client.execute('SELECT * FROM relay_reactions');
  const messages = {};
  for (const row of rows2objs(messagesRs)) messages[row.message_key] = { guildId: row.guild_id, channelId: row.channel_id, messageId: row.message_id };
  const reactions = rows2objs(reactionsRs).map(row => ({ messageKey: row.message_key, guildId: row.guild_id, channelId: row.channel_id, messageId: row.message_id, userId: row.user_id, emoji: row.emoji }));
  return { messages, reactions };
}
async function saveRelayState(state) {
  const stmts = [{ sql: 'DELETE FROM relay_messages', args: [] }, { sql: 'DELETE FROM relay_reactions', args: [] }];
  for (const item of Object.values(state?.messages || {})) stmts.push({ sql: 'INSERT OR REPLACE INTO relay_messages (message_key, guild_id, channel_id, message_id) VALUES (?, ?, ?, ?)', args: [`${item.guildId}:${item.messageId}`, item.guildId, item.channelId, item.messageId] });
  for (const item of state?.reactions || []) stmts.push({ sql: 'INSERT OR REPLACE INTO relay_reactions (message_key, guild_id, channel_id, message_id, user_id, emoji) VALUES (?, ?, ?, ?, ?, ?)', args: [item.messageKey, item.guildId, item.channelId, item.messageId, item.userId, item.emoji] });
  await client.batch(stmts, 'write');
}
function parseJsonArray(value) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function giveawayFromRow(row) {
  return { prize: row.prize || '', winners: Number(row.winners) || 1, entries: new Set(parseJsonArray(row.entries)), endsAt: Number(row.ends_at) || 0, channelId: row.channel_id || '', guildId: row.guild_id || '', hostId: row.host_id || '', hostUsername: row.host_username || '', lastWinners: parseJsonArray(row.last_winners), rerolls: Number(row.rerolls) || 0, status: row.status || 'active' };
}
async function loadGiveaways() {
  const rs = await client.execute('SELECT * FROM giveaways');
  const active = new Map(), completed = new Map();
  for (const row of rs.rows.map((r) => row2obj(r, rs.columns))) {
    const value = giveawayFromRow(row);
    if (row.status === 'active') active.set(String(row.message_id), value);
    else completed.set(String(row.message_id), value);
  }
  return { active, completed };
}
async function saveGiveaway(messageId, value, status = 'active') {
  await client.execute({
    sql: `INSERT INTO giveaways (message_id, status, prize, winners, entries, ends_at, channel_id, guild_id, host_id, host_username, last_winners, rerolls, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(message_id) DO UPDATE SET status=excluded.status, prize=excluded.prize, winners=excluded.winners, entries=excluded.entries, ends_at=excluded.ends_at, channel_id=excluded.channel_id, guild_id=excluded.guild_id, host_id=excluded.host_id, host_username=excluded.host_username, last_winners=excluded.last_winners, rerolls=excluded.rerolls, updated_at=excluded.updated_at`,
    args: [String(messageId), status, value.prize || '', Number(value.winners) || 1, JSON.stringify([...value.entries || []]), Number(value.endsAt) || 0, value.channelId || '', value.guildId || '', value.hostId || '', value.hostUsername || '', JSON.stringify(value.lastWinners || []), Number(value.rerolls) || 0, Date.now()],
  });
}
async function deleteGiveaway(messageId) { await client.execute({ sql: 'DELETE FROM giveaways WHERE message_id = ?', args: [String(messageId)] }); }

// ── EXPORTS ───────────────────────────────────────────────────────────────────

module.exports = {
  client,
  initDb,
  isDbReady: () => dbReady,
  // XP
  getXpUser, upsertXpUser, getGuildXpAll, getAllXpRows, upsertXpBatch,
  // Warnings
  loadWarnings, saveWarnings,
  // Durable feature state
  getLocalXpAll, incrementLocalXp, getChatActivityAll, upsertChatActivity,
  loadRelayState, saveRelayState, loadGiveaways, saveGiveaway, deleteGiveaway,
  // Guild config
  loadData, saveData,
  // Tickets
  loadTickets, saveTickets,
  // Birthdays
  setBirthday, removeBirthday, getBirthday, getAllBirthdays,
  // Streaks
  getStreak, upsertStreak, getAllStreaks, upsertStreakBatch,
  // Staff activity
  getStaffActivity, recordStaffLogin, incrementStaffActivity, getStaffActivityRows, resetStaffPoints,
  // Chat streaks
  getChatStreak, upsertChatStreak, getChatStreaksForUser, getAllChatStreaks,
  // Bot config
  loadBotConfig, saveBotConfig,
  // Daily events
  loadDailyEvents, saveDailyEvents,
  // AFK
  getAfkState, getAfkStates, saveAfkState, incrementAfkMention, clearAfkState,
  // Invites
  upsertInviteCodes, getInviteCode, recordInviteJoin, removeInviteJoin, getInviteCount, getInviteJoiners, getInviteLeaderboard,
  // Profile images
  saveProfileImages, getProfileImages,
  // User rank card backgrounds
  saveUserBackground, getUserBackground, deleteUserBackground,
  // Static dashboard assets (welcome/rank/leaderboard/quote bg, rules banner)
  saveStaticAsset, getStaticAsset, deleteStaticAsset,
  // Logs (read)
  getRolesLog, getMessagesLog, getBansLog,
  // Logs (write)
  logRole, logMessage, logBan,
  // Logs (delete)
  deleteWarningsForUser, deleteRoleLog, deleteMessageLog, deleteBanLog,
  // Analytics
  recordAnalyticsEvent, flushAnalyticsEvents, getAnalyticsSummary,
};
