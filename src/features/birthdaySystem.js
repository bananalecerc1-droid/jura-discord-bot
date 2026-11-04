'use strict';

// birthdaySystem.js — Birthday system backed by Supabase (async)

const { EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../../db.js');

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── API ───────────────────────────────────────────────────────────────────────

async function setBirthday(userId, username, day, month) {
  await db.setBirthday(userId, username, day, month);
}

async function removeBirthday(userId) {
  return db.removeBirthday(userId);
}

async function getBirthday(userId) {
  return db.getBirthday(userId);
}

async function getAllBirthdays() {
  return db.getAllBirthdays();
}

/** Returns birthdays sorted by upcoming (from today forward) */
async function getUpcomingBirthdays(limit = 10) {
  const now   = new Date();
  const today = { month: now.getMonth() + 1, day: now.getDate() };

  const all = (await getAllBirthdays()).map(b => {
    let daysUntil;
    const thisYear = new Date(now.getFullYear(), b.month - 1, b.day);
    if (b.month > today.month || (b.month === today.month && b.day >= today.day)) {
      daysUntil = Math.ceil((thisYear - now) / 86400000);
    } else {
      const nextYear = new Date(now.getFullYear() + 1, b.month - 1, b.day);
      daysUntil = Math.ceil((nextYear - now) / 86400000);
    }
    return { ...b, daysUntil };
  });

  return all.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, limit);
}

// ── SCHEDULER ─────────────────────────────────────────────────────────────────

function initBirthdayScheduler(client, loadConfig) {
  setInterval(() => checkBirthdays(client, loadConfig).catch(e => console.error('[Birthday]', e.message)), 60_000);
  setTimeout(() => checkBirthdays(client, loadConfig).catch(() => {}), 5_000);
}

const ANNOUNCED_TODAY = new Set();
let lastAnnouncedDay = -1;

async function checkBirthdays(client, loadConfig) {
  const now   = new Date();
  const today = now.getDate();
  const month = now.getMonth() + 1;

  if (lastAnnouncedDay !== today) {
    ANNOUNCED_TODAY.clear();
    lastAnnouncedDay = today;
  }

  const cfg       = loadConfig();
  const channelId = cfg.birthday?.channelId;
  if (!channelId) return;

  const channel = client.channels.cache.get(channelId);
  if (!channel) return;

  const all = (await getAllBirthdays()).filter(b => b.day === today && b.month === month);

  for (const b of all) {
    const key = `${channel.guild.id}_${b.userId}`;
    if (ANNOUNCED_TODAY.has(key)) continue;
    ANNOUNCED_TODAY.add(key);

    const member = channel.guild.members.cache.get(b.userId)
      || await channel.guild.members.fetch(b.userId).catch(() => null);
    const displayName = member?.displayName || b.username;
    const avatar      = member?.user.displayAvatarURL({ size: 256, extension: 'png' });

    const embed = new EmbedBuilder()
      .setColor(0xfd79a8)
      .setTitle('🎂 Happy Birthday!')
      .setDescription(
        `🎉 **Happy Birthday ${member ? member : displayName}!** 🎂\n\n` +
        `Wishing you an amazing day filled with joy! 🥳✨`
      )
      .setFooter({ text: `🎈 ${MONTH_NAMES[month - 1]} ${today}` })
      .setTimestamp();

    if (avatar) embed.setThumbnail(avatar);

    await channel.send({ content: member ? `${member}` : `<@${b.userId}>`, embeds: [embed] });
  }
}

// ── SLASH HANDLER ─────────────────────────────────────────────────────────────

async function handleBirthday(interaction) {
  const sub = interaction.options.getSubcommand();

  // ── /birthday set ──
  if (sub === 'set') {
    const day   = interaction.options.getInteger('day');
    const month = interaction.options.getInteger('month');

    const maxDays = new Date(2024, month, 0).getDate();
    if (day < 1 || day > maxDays) {
      return interaction.reply({ content: `❌ Invalid day for month ${MONTH_NAMES[month-1]}. Must be 1–${maxDays}.`, flags: MessageFlags.Ephemeral });
    }

    await setBirthday(interaction.user.id, interaction.user.username, day, month);

    const embed = new EmbedBuilder()
      .setColor(0xfd79a8)
      .setTitle('🎂 Birthday Set!')
      .setDescription(`Your birthday has been saved as **${MONTH_NAMES[month - 1]} ${day}** 🎉\nThe bot will celebrate it every year!`)
      .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // ── /birthday remove ──
  if (sub === 'remove') {
    const removed = await removeBirthday(interaction.user.id);
    if (!removed) return interaction.reply({ content: '❌ You have no birthday saved.', flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: '✅ Your birthday has been removed.', flags: MessageFlags.Ephemeral });
  }

  // ── /birthday check ──
  if (sub === 'check') {
    const target = interaction.options.getUser('user') || interaction.user;
    const b      = await getBirthday(target.id);
    if (!b) {
      return interaction.reply({
        content: target.id === interaction.user.id
          ? `❌ You haven't set your birthday yet. Use \`/birthday set\`!`
          : `❌ **${target.username}** hasn't set their birthday.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const now   = new Date();
    const today = { month: now.getMonth() + 1, day: now.getDate() };
    const isToday = b.day === today.day && b.month === today.month;

    const embed = new EmbedBuilder()
      .setColor(isToday ? 0xfd79a8 : 0x6c5ce7)
      .setTitle(isToday ? '🎂 It\'s their birthday TODAY!' : '🎂 Birthday Info')
      .setDescription(
        `**${target.username}**'s birthday: **${MONTH_NAMES[b.month - 1]} ${b.day}**` +
        (isToday ? '\n\n🎉 Happy Birthday! 🎉' : '')
      )
      .setThumbnail(target.displayAvatarURL({ size: 128 }))
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ── /birthday list ──
  if (sub === 'list') {
    const upcoming = await getUpcomingBirthdays(15);
    if (!upcoming.length) {
      return interaction.reply({ content: '😔 No birthdays saved yet.', flags: MessageFlags.Ephemeral });
    }

    const lines = upcoming.map((b, i) => {
      const tag = b.daysUntil === 0 ? '🎂 **TODAY!**' : `in **${b.daysUntil}** day${b.daysUntil === 1 ? '' : 's'}`;
      return `\`${String(i + 1).padStart(2)}\` <@${b.userId}> — **${MONTH_NAMES[b.month - 1]} ${b.day}** (${tag})`;
    });

    const embed = new EmbedBuilder()
      .setColor(0xfd79a8)
      .setTitle('🎂 Upcoming Birthdays')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${upcoming.length} birthdays` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
}

module.exports = { initBirthdayScheduler, handleBirthday };
