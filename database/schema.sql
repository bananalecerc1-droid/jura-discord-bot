-- ============================================================
-- Discord Bot — Turso (SQLite) Schema
-- This is applied automatically on bot startup via db.js
-- ============================================================

CREATE TABLE IF NOT EXISTS xp_stats (
  guild_id           TEXT    NOT NULL,
  user_id            TEXT    NOT NULL,
  username           TEXT    NOT NULL DEFAULT 'Unknown',
  total_xp           INTEGER NOT NULL DEFAULT 0,
  daily_xp           INTEGER NOT NULL DEFAULT 0,
  weekly_xp          INTEGER NOT NULL DEFAULT 0,
  monthly_xp         INTEGER NOT NULL DEFAULT 0,
  last_daily_reset   INTEGER NOT NULL DEFAULT 0,
  last_weekly_reset  INTEGER NOT NULL DEFAULT 0,
  last_monthly_reset INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS warnings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  reason        TEXT    NOT NULL DEFAULT '',
  moderator     TEXT    NOT NULL DEFAULT '',
  moderator_tag TEXT    NOT NULL DEFAULT '',
  timestamp     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS warnings_guild_user ON warnings (guild_id, user_id);

CREATE TABLE IF NOT EXISTS guild_config (
  guild_id              TEXT PRIMARY KEY,
  watch_channel         TEXT,
  emoji_watch_channel   TEXT,
  sticker_watch_channel TEXT
);

CREATE TABLE IF NOT EXISTS birthdays (
  user_id  TEXT PRIMARY KEY,
  username TEXT    NOT NULL DEFAULT '',
  day      INTEGER NOT NULL,
  month    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS streaks (
  guild_id      TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  longest       INTEGER NOT NULL DEFAULT 0,
  last_image_at INTEGER NOT NULL DEFAULT 0,
  username      TEXT    NOT NULL DEFAULT '',
  reminded      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS tickets (
  guild_id   TEXT    NOT NULL,
  channel_id TEXT    NOT NULL,
  user_id    TEXT    NOT NULL DEFAULT '',
  username   TEXT    NOT NULL DEFAULT '',
  opened_at  INTEGER NOT NULL DEFAULT 0,
  claimed_by TEXT,
  claimed_at INTEGER,
  PRIMARY KEY (guild_id, channel_id)
);

CREATE TABLE IF NOT EXISTS roles_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  action    TEXT,
  user_id   TEXT,
  role_id   TEXT,
  mod_id    TEXT,
  timestamp INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT,
  user_id    TEXT,
  channel_id TEXT,
  message_id TEXT,
  content    TEXT    NOT NULL DEFAULT '',
  timestamp  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bans_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT    NOT NULL DEFAULT '',
  user_id    TEXT    NOT NULL DEFAULT '',
  user_tag   TEXT    NOT NULL DEFAULT '',
  moderator  TEXT    NOT NULL DEFAULT '',
  reason     TEXT    NOT NULL DEFAULT '',
  timestamp  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bot_config (
  id     TEXT PRIMARY KEY DEFAULT 'main',
  config TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS daily_events (
  id   TEXT PRIMARY KEY DEFAULT 'main',
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS profile_images (
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  avatar     BLOB    NOT NULL,
  banner     BLOB    NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_backgrounds (
  user_id    TEXT    PRIMARY KEY,
  image      BLOB    NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);
