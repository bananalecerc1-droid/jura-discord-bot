'use strict';

// streakSystem.js — Streak system backed by Supabase (async)

const db = require('../../db.js');

const DAY_MS     = 24 * 60 * 60 * 1000;
const GRACE_MS   = DAY_MS;               // one full extra day of grace
const MIN_GAP_MS = 20 * 60 * 60 * 1000; // don't allow double-counting within ~20 h

// ── API ───────────────────────────────────────────────────────────────────────

async function getUserStreak(guildId, userId) {
  return db.getStreak(guildId, userId);
}

/**
 * Called when a user posts an image in the configured streak channel.
 * Returns { streak, longest, status } where status is one of:
 *   'started'   — brand new streak
 *   'continued' — normal day-to-day continuation
 *   'saved'     — posted during the grace window, streak kept alive
 *   'reset'     — too much time had passed, streak restarted at 1
 *   'already'   — already counted today, no change
 */
async function recordStreakImage(guildId, userId, username) {
  const now      = Date.now();
  const existing = await db.getStreak(guildId, userId);

  let entry;
  let status;

  if (!existing) {
    entry  = { count: 1, longest: 1, lastImageAt: now, username, reminded: false };
    status = 'started';
  } else {
    const diff = now - existing.lastImageAt;

    if (diff < MIN_GAP_MS) {
      return { streak: existing.count, longest: existing.longest, status: 'already' };
    } else if (diff <= DAY_MS + GRACE_MS) {
      const newCount = existing.count + 1;
      entry = {
        count:       newCount,
        longest:     Math.max(existing.longest || 0, newCount),
        lastImageAt: now,
        username,
        reminded: false,
      };
      status = diff > DAY_MS ? 'saved' : 'continued';
    } else {
      entry  = { count: 1, longest: existing.longest || 1, lastImageAt: now, username, reminded: false };
      status = 'reset';
    }
  }

  await db.upsertStreak(guildId, userId, entry);
  return { streak: entry.count, longest: entry.longest, status };
}

// ── SCHEDULER ─────────────────────────────────────────────────────────────────

async function checkStreaks(client, loadConfig) {
  const allStreaks = await db.getAllStreaks();
  const now = Date.now();
  const updates = [];

  for (const [guildId, users] of Object.entries(allStreaks)) {
    const cfg       = loadConfig();
    const streakCfg = cfg.streak || {};
    if (!streakCfg.enabled) continue;

    // Keep existing configurations working: a configured channel previously
    // meant chat notifications, while no channel meant DMs.
    const notificationMode = streakCfg.notificationMode === 'dm'
      ? 'dm'
      : streakCfg.notificationMode === 'channel'
        ? 'channel'
        : (streakCfg.channelId ? 'channel' : 'dm');
    const notifChannelId = notificationMode === 'channel' ? streakCfg.channelId : null;
    let notifChannel = null;
    if (notifChannelId) {
      try {
        const guild = await client.guilds.fetch(guildId);
        notifChannel = await guild.channels.fetch(notifChannelId);
      } catch {
        // Channel not found — fall back to DM
      }
    }

    for (const [userId, entry] of Object.entries(users)) {
      const diff = now - entry.lastImageAt;

      if (diff > DAY_MS + GRACE_MS) {
        if (entry.count > 0) {
          const lostMsg = (streakCfg.lostMessage ||
            'انتهى الستريك الخاص بك لقد حققت ستريك متواصل **{streak}** تستطيع اعادة فتح ستريك جديد والتقدم من جديد :OTG_MikuScared: !')
            .replace('{streak}', entry.longest || 0)
            .replace('{user}', entry.username || 'there');
          sendNotif(client, userId, lostMsg, notifChannel, notificationMode);
          updates.push({ guildId, userId, fields: { count: 0, reminded: false } });
        }
        continue;
      }

      if (diff > DAY_MS && diff <= DAY_MS + GRACE_MS && !entry.reminded) {
        const reminderMsg = (streakCfg.reminderMessage ||
          'الستريك الخاص بك قرب على الانتهاء قم بنشر ستريك جديد للحفاظ على تقدمك :kanaderamen: discord.gg/juraajura')
          .replace('{streak}', entry.count)
          .replace('{user}', entry.username || 'there');
        sendNotif(client, userId, reminderMsg, notifChannel, notificationMode);
        updates.push({ guildId, userId, fields: { reminded: true } });
      }
    }
  }

  // Batch-save changed streak rows
  if (updates.length) {
    for (const { guildId, userId, fields } of updates) {
      await db.upsertStreak(guildId, userId, fields).catch(err =>
        console.error('[streakSystem] upsert error:', err.message)
      );
    }
  }
}

async function sendNotif(client, userId, content, channel, notificationMode = 'dm') {
  if (notificationMode === 'channel') {
    if (!channel) {
      console.error(`Streak channel notification skipped for user ${userId}: channel is not configured or unavailable.`);
      return;
    }
    try {
      await channel.send(`<@${userId}> ${content}`);
    } catch (err) {
      console.error('Streak channel send failed:', err.message);
    }
    return;
  }

  try {
    const user = await client.users.fetch(userId);
    await user.send(content);
  } catch (err) {
    console.error(`Streak DM failed for user ${userId}:`, err.message);
  }
}

function startStreakScheduler(client, loadConfig, intervalMs = 15 * 60 * 1000) {
  checkStreaks(client, loadConfig).catch(err => console.error('Streak check error:', err));
  return setInterval(() => {
    checkStreaks(client, loadConfig).catch(err => console.error('Streak check error:', err));
  }, intervalMs);
}

// loadStreaks kept for backward compatibility — returns the same format as getAllStreaks
async function loadStreaks() {
  return db.getAllStreaks();
}

module.exports = {
  recordStreakImage,
  getUserStreak,
  startStreakScheduler,
  loadStreaks,
};
