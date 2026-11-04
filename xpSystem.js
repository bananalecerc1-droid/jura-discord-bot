'use strict';

// xpSystem.js — XP system backed by Supabase (async)

const db = require('./db.js');

let xpConfigGetter = () => ({});
function setXpConfigGetter(getter) {
  xpConfigGetter = typeof getter === 'function' ? getter : () => ({});
}
function getXpConfig() {
  const raw = xpConfigGetter() || {};
  const num = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const minGain = Math.max(0, num(raw.messageXpMin, 15));
  const maxGain = Math.max(minGain, num(raw.messageXpMax, 25));
  return {
    messageXpMin: minGain,
    messageXpMax: maxGain,
    messageXpCooldown: Math.max(0, num(raw.messageXpCooldown, 60)),
    levelBase: Math.max(1, num(raw.levelBase, 100)),
    levelLinear: Math.max(0, num(raw.levelLinear, 50)),
    levelQuadratic: Math.max(0, num(raw.levelQuadratic, 5)),
  };
}
const cooldowns = new Map();

// Only run the global leaderboard-reset check once per minute
let lastResetCheckAt = 0;
const RESET_CHECK_INTERVAL = 60_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function xpForLevel(level, settings = getXpConfig()) {
  return settings.levelQuadratic * level * level + settings.levelLinear * level + settings.levelBase;
}

function getLevelFromXp(totalXp, settings = getXpConfig()) {
  let level = 0;
  let xp = Number(totalXp) || 0; // تحويل صريح لـ Number عشان لو رجعت القيمة BigInt من قاعدة البيانات
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level, settings);
    level++;
  }
  return { level, currentXp: xp, xpNeeded: xpForLevel(level, settings) };
}

/** Convert a DB row to the in-memory user shape. */
function rowToUser(row) {
  return {
    totalXp:              row.total_xp             || 0,
    dailyLeaderboardXp:   row.daily_xp             || 0,
    weeklyLeaderboardXp:  row.weekly_xp            || 0,
    monthlyLeaderboardXp: row.monthly_xp           || 0,
    voiceTotalXp:         row.voice_total_xp       || 0,
    voiceDailyXp:         row.voice_daily_xp       || 0,
    voiceWeeklyXp:        row.voice_weekly_xp      || 0,
    voiceMonthlyXp:       row.voice_monthly_xp     || 0,
    lastDailyReset:       Number(row.last_daily_reset  || 0),
    lastWeeklyReset:      Number(row.last_weekly_reset || 0),
    lastMonthlyReset:     Number(row.last_monthly_reset || 0),
    username:             row.username || 'Unknown',
  };
}

/** Build a DB row from the user shape. */
function userToDbFields(user) {
  return {
    username:            user.username             || 'Unknown',
    total_xp:            user.totalXp              || 0,
    daily_xp:            user.dailyLeaderboardXp   || 0,
    weekly_xp:           user.weeklyLeaderboardXp  || 0,
    monthly_xp:          user.monthlyLeaderboardXp || 0,
    voice_total_xp:      user.voiceTotalXp         || 0,
    voice_daily_xp:      user.voiceDailyXp         || 0,
    voice_weekly_xp:     user.voiceWeeklyXp        || 0,
    voice_monthly_xp:    user.voiceMonthlyXp       || 0,
    last_daily_reset:    user.lastDailyReset        || 0,
    last_weekly_reset:   user.lastWeeklyReset       || 0,
    last_monthly_reset:  user.lastMonthlyReset      || 0,
  };
}

/**
 * Check and reset leaderboard XP for all users if a new period has started.
 * Throttled to run at most once per minute globally.
 */
async function resetLeaderboardXp() {
  const now = Date.now();
  if (now - lastResetCheckAt < RESET_CHECK_INTERVAL) return;
  lastResetCheckAt = now;

  const nowDate = new Date(now);
  const currentUtcDay       = nowDate.getUTCDate();
  const currentUtcMonth     = nowDate.getUTCMonth();
  const currentUtcYear      = nowDate.getUTCFullYear();
  const currentUtcDayOfWeek = nowDate.getUTCDay(); // 0 = Sunday

  let rows;
  try {
    rows = await db.getAllXpRows();
  } catch (err) {
    console.error('[xpSystem] Failed to load XP rows for reset:', err.message);
    return;
  }

  const toUpdate = [];

  for (const row of rows) {
    const user = rowToUser(row);
    let changed = false;

    // Daily reset
    const lastDaily = new Date(user.lastDailyReset || 0);
    if (lastDaily.getUTCDate() !== currentUtcDay ||
        lastDaily.getUTCMonth() !== currentUtcMonth ||
        lastDaily.getUTCFullYear() !== currentUtcYear) {
      user.dailyLeaderboardXp = 0;
      user.voiceDailyXp = 0;
      user.lastDailyReset = now;
      changed = true;
    }

    // Weekly reset (every Sunday, or if ≥7 days have passed)
    const lastWeekly = new Date(user.lastWeeklyReset || 0);
    const diffDays = (now - lastWeekly) / (1000 * 60 * 60 * 24);
    if (diffDays >= 7 ||
        (currentUtcDayOfWeek === 0 &&
         (lastWeekly.getUTCDate() !== currentUtcDay || lastWeekly.getUTCMonth() !== currentUtcMonth))) {
      user.weeklyLeaderboardXp = 0;
      user.voiceWeeklyXp = 0;
      user.lastWeeklyReset = now;
      changed = true;
    }

    // Monthly reset
    const lastMonthly = new Date(user.lastMonthlyReset || 0);
    if (lastMonthly.getUTCMonth() !== currentUtcMonth ||
        lastMonthly.getUTCFullYear() !== currentUtcYear) {
      user.monthlyLeaderboardXp = 0;
      user.voiceMonthlyXp = 0;
      user.lastMonthlyReset = now;
      changed = true;
    }

    if (changed) {
      toUpdate.push({
        guild_id: row.guild_id,
        user_id:  row.user_id,
        ...userToDbFields(user),
      });
    }
  }

  if (toUpdate.length) {
    try {
      await db.upsertXpBatch(toUpdate);
    } catch (err) {
      console.error('[xpSystem] Failed to save XP reset batch:', err.message);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

async function addXp(guildId, userId, username) {
  await resetLeaderboardXp();

  const settings = getXpConfig();
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const cooldownMs = settings.messageXpCooldown * 1000;

  if (cooldownMs > 0 && cooldowns.has(key) && now - cooldowns.get(key) < cooldownMs) return null;
  if (cooldownMs > 0) cooldowns.set(key, now);

  let row;
  try {
    row = await db.getXpUser(guildId, userId);
  } catch (err) {
    console.error('[xpSystem] addXp fetch error:', err.message);
    return null;
  }

  const user = row ? rowToUser(row) : {
    totalXp: 0, dailyLeaderboardXp: 0, weeklyLeaderboardXp: 0,
    monthlyLeaderboardXp: 0, lastDailyReset: 0, lastWeeklyReset: 0,
    lastMonthlyReset: 0, username: username || 'Unknown',
  };

  const xpGain = settings.messageXpMin === settings.messageXpMax
    ? settings.messageXpMin
    : Math.floor(Math.random() * (settings.messageXpMax - settings.messageXpMin + 1)) + settings.messageXpMin;
  const before = getLevelFromXp(user.totalXp, settings);

  user.totalXp             += xpGain;
  user.username             = username || user.username;
  user.dailyLeaderboardXp  += xpGain;
  user.weeklyLeaderboardXp += xpGain;
  user.monthlyLeaderboardXp += xpGain;

  const after = getLevelFromXp(user.totalXp, settings);

  try {
    await db.upsertXpUser(guildId, userId, userToDbFields(user));
    db.recordAnalyticsEvent?.({ guildId, eventType: 'xp', userId, username: user.username, value: xpGain });
  } catch (err) {
    console.error('[xpSystem] addXp save error:', err.message);
  }

  return {
    xpGain,
    leveledUp: after.level > before.level,
    newLevel:  after.level,
    totalXp:   user.totalXp,
  };
}

async function addXpDirect(guildId, userId, username, amount) {
  await resetLeaderboardXp();

  let row;
  try {
    row = await db.getXpUser(guildId, userId);
  } catch (err) {
    console.error('[xpSystem] addXpDirect fetch error:', err.message);
    return null;
  }

  const user = row ? rowToUser(row) : {
    totalXp: 0, dailyLeaderboardXp: 0, weeklyLeaderboardXp: 0,
    monthlyLeaderboardXp: 0, lastDailyReset: 0, lastWeeklyReset: 0,
    lastMonthlyReset: 0, username: username || 'Unknown',
  };

  const settings = getXpConfig();
  const before = getLevelFromXp(user.totalXp, settings);

  user.totalXp             += amount;
  user.username             = username || user.username;
  user.dailyLeaderboardXp  += amount;
  user.weeklyLeaderboardXp += amount;
  user.monthlyLeaderboardXp += amount;

  const after = getLevelFromXp(user.totalXp, settings);

  try {
    await db.upsertXpUser(guildId, userId, userToDbFields(user));
    db.recordAnalyticsEvent?.({ guildId, eventType: 'xp', userId, username: user.username, value: amount });
  } catch (err) {
    console.error('[xpSystem] addXpDirect save error:', err.message);
  }

  return {
    xpGain: amount,
    leveledUp: after.level > before.level,
    newLevel:  after.level,
    totalXp:   user.totalXp,
  };
}

async function getUserData(guildId, userId) {
  await resetLeaderboardXp();

  let rows, row;
  try {
    rows = await db.getGuildXpAll(guildId);
    row  = rows.find(r => r.user_id === userId);
  } catch (err) {
    console.error('[xpSystem] getUserData error:', err.message);
    return null;
  }

  if (!row) return null;

  const user = rowToUser(row);
  const sorted = [...rows].sort((a, b) => (b.total_xp || 0) - (a.total_xp || 0));
  const rank = sorted.findIndex(r => r.user_id === userId) + 1;
  const { level, currentXp, xpNeeded } = getLevelFromXp(user.totalXp);

  return { level, currentXp, xpNeeded, totalXp: user.totalXp, rank, username: user.username };
}

async function getLeaderboard(guildId, period = 'all') {
  await resetLeaderboardXp();

  let rows;
  try {
    rows = await db.getGuildXpAll(guildId);
  } catch (err) {
    console.error('[xpSystem] getLeaderboard error:', err.message);
    return [];
  }

  const entries = rows.map(row => {
    const user = rowToUser(row);
    let periodXp = 0;
    if      (period === 'all')                    periodXp = user.totalXp;
    else if (period === 'today'  || period === 'daily')   periodXp = user.dailyLeaderboardXp;
    else if (period === 'week'   || period === 'weekly')  periodXp = user.weeklyLeaderboardXp;
    else if (period === 'month'  || period === 'monthly') periodXp = user.monthlyLeaderboardXp;

    const { level, currentXp, xpNeeded } = getLevelFromXp(user.totalXp);
    return { userId: row.user_id, username: user.username, periodXp, totalXp: user.totalXp, level, currentXp, xpNeeded };
  });

  return entries
    .sort((a, b) => b.periodXp - a.periodXp)
    .slice(0, 10)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

async function getTopDay(guildId)   { return getLeaderboard(guildId, 'daily'); }
async function getTopWeek(guildId)  { return getLeaderboard(guildId, 'weekly'); }
async function getTopMonth(guildId) { return getLeaderboard(guildId, 'monthly'); }

// ── VOICE XP ──────────────────────────────────────────────────────────────────

async function addVoiceXp(guildId, userId, username, amount) {
  let row;
  try {
    row = await db.getXpUser(guildId, userId);
  } catch (err) {
    console.error('[xpSystem] addVoiceXp fetch error:', err.message);
    return null;
  }

  const user = row ? rowToUser(row) : {
    totalXp: 0, dailyLeaderboardXp: 0, weeklyLeaderboardXp: 0, monthlyLeaderboardXp: 0,
    voiceTotalXp: 0, voiceDailyXp: 0, voiceWeeklyXp: 0, voiceMonthlyXp: 0,
    lastDailyReset: 0, lastWeeklyReset: 0, lastMonthlyReset: 0,
    username: username || 'Unknown',
  };

  const before = getLevelFromXp(user.totalXp);

  // Voice XP is part of the same general XP pool as chat XP.
  // The voice-specific fields remain available for voice analytics and leaderboards.
  user.totalXp             += amount;
  user.dailyLeaderboardXp  += amount;
  user.weeklyLeaderboardXp += amount;
  user.monthlyLeaderboardXp += amount;
  user.voiceTotalXp        += amount;
  user.voiceDailyXp        += amount;
  user.voiceWeeklyXp       += amount;
  user.voiceMonthlyXp      += amount;
  user.username             = username || user.username;

  const after = getLevelFromXp(user.totalXp);

  try {
    await db.upsertXpUser(guildId, userId, userToDbFields(user));
    db.recordAnalyticsEvent?.({ guildId, eventType: 'voice_xp', userId, username: user.username, value: amount });
  } catch (err) {
    console.error('[xpSystem] addVoiceXp save error:', err.message);
  }

  return {
    xpGain:    amount,
    leveledUp: after.level > before.level,
    newLevel:  after.level,
    totalXp:   user.totalXp,
  };
}

async function getVoiceLeaderboard(guildId, period = 'all') {
  let rows;
  try {
    rows = await db.getGuildXpAll(guildId);
  } catch (err) {
    console.error('[xpSystem] getVoiceLeaderboard error:', err.message);
    return [];
  }

  const entries = rows.map(row => {
    const user = rowToUser(row);
    let periodXp = 0;
    if      (period === 'all')                           periodXp = user.voiceTotalXp;
    else if (period === 'today' || period === 'daily')   periodXp = user.voiceDailyXp;
    else if (period === 'week'  || period === 'weekly')  periodXp = user.voiceWeeklyXp;
    else if (period === 'month' || period === 'monthly') periodXp = user.voiceMonthlyXp;

    const { level } = getLevelFromXp(user.voiceTotalXp);
    return { userId: row.user_id, username: user.username, periodXp, totalXp: user.voiceTotalXp, level };
  });

  return entries
    .filter(e => e.periodXp > 0)
    .sort((a, b) => b.periodXp - a.periodXp)
    .slice(0, 10)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

async function getVoiceUserData(guildId, userId) {
  let row;
  try {
    row = await db.getXpUser(guildId, userId);
  } catch (err) {
    return null;
  }
  if (!row) return null;
  const user = rowToUser(row);
  const { level, currentXp, xpNeeded } = getLevelFromXp(user.voiceTotalXp);
  return { level, currentXp, xpNeeded, totalXp: user.voiceTotalXp };
}

module.exports = {
  setXpConfigGetter,
  addXp, addXpDirect, addVoiceXp,
  getUserData, getVoiceUserData,
  getLeaderboard, getVoiceLeaderboard,
  resetLeaderboardXp,
  getTopDay, getTopWeek, getTopMonth,
};
