'use strict';
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } = require('discord.js');
const { addXpDirect } = require('../../xpSystem.js');
const { generateEventCard } = require('../cards/dailyEventCard.js');
const db = require('../../db.js');

const MIN_DURATION = 180; // 3 minutes minimum

// One active event per guild (in-memory)
const activeEvents = new Map();

// ── Persistence ───────────────────────────────────────────────────────────────
async function loadDailyData() {
  try { return await db.loadDailyEvents(); } catch { return {}; }
}
async function saveDailyData(d) {
  try { await db.saveDailyEvents(d); } catch (err) { console.error('[dailyEvent] Save error:', err.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// ██  QUESTION BANKS  (MCQ format: { q, opts:[4], ans:index })
// ─────────────────────────────────────────────────────────────────────────────
const MCQ_BANKS = {
  // games will be added here
};

// ─────────────────────────────────────────────────────────────────────────────
// ██  TYPE ANSWER POOLS
// ─────────────────────────────────────────────────────────────────────────────
const TYPE_POOLS = {
  // games will be added here
};

// REACT RACE emojis pool
const REACT_EMOJIS = ['⭐','🔥','🎯','💎','🚀','👑','🍀','⚡','🌟','🎵','🏆','💫'];

// ─────────────────────────────────────────────────────────────────────────────
// ██  GAME CATALOGUE
// mechanic: 'lottery' | 'first_click' | 'react_race' | 'mcq' | 'type'
// ─────────────────────────────────────────────────────────────────────────────
const GAME_CATALOGUE = [
  // games will be added here
];

// ─────────────────────────────────────────────────────────────────────────────
// ██  HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const MCQ_LABELS = ['🅰️', '🅱️', '🅾️', '🆇'];

function clampDuration(d) { return Math.max(MIN_DURATION, Number(d ?? MIN_DURATION)); }

async function sendCanvas(channel, type, title, question, reward, duration) {
  try {
    const buf = await generateEventCard({ type, title, question, reward, duration });
    return new AttachmentBuilder(buf, { name: 'daily_event.png' });
  } catch (err) {
    console.error('[DailyEvent] canvas error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ██  SCHEDULER
// ─────────────────────────────────────────────────────────────────────────────
function initDailyEvents(client, loadConfig) {
  setInterval(
    () => checkAndRun(client, loadConfig).catch(e => console.error('[DailyEvent]', e.message)),
    60_000,
  );
  setTimeout(() => checkAndRun(client, loadConfig).catch(() => {}), 10_000);
}

async function checkAndRun(client, loadConfig) {
  const cfg = loadConfig();
  const ev  = cfg.dailyEvent;
  if (!ev?.enabled || !ev?.channelId) return;

  const now   = new Date();
  const today = now.toISOString().slice(0, 10);

  if (now.getUTCHours()   !== Number(ev.utcHour   ?? 17)) return;
  if (now.getUTCMinutes() !== Number(ev.utcMinute ?? 0))  return;

  const data = await loadDailyData();

  let dirty = false;
  for (const [guildId, guild] of client.guilds.cache) {
    if (data[guildId]?.lastDate === today) continue;
    if (!data[guildId]) data[guildId] = {};
    data[guildId].lastDate = today;
    dirty = true;
    runEventForGuild(guild, ev).catch(e => console.error('[DailyEvent run]', e.message));
  }
  if (dirty) await saveDailyData(data);
}

async function runEventForGuild(guild, ev) {
  const channel = guild.channels.cache.get(ev.channelId);
  if (!channel) return;

  if (GAME_CATALOGUE.length === 0) {
    return channel.send({ embeds: [new EmbedBuilder().setColor(0x636e72).setDescription('⚠️ لا توجد ألعاب مضافة بعد!')] });
  }

  const duration    = clampDuration(ev.duration);
  const reward      = Number(ev.reward ?? 200);
  const customEmojis = Array.isArray(ev.reactEmojis) && ev.reactEmojis.length > 0
    ? ev.reactEmojis
    : null;

  const allowed = ev.eventTypes?.length
    ? GAME_CATALOGUE.filter(g => ev.eventTypes.includes(g.id))
    : GAME_CATALOGUE;

  const game = pick(allowed.length ? allowed : GAME_CATALOGUE);
  return runGame(guild, channel, game, reward, duration, customEmojis);
}

// ─────────────────────────────────────────────────────────────────────────────
// ██  GAME RUNNER  (dispatches by mechanic)
// ─────────────────────────────────────────────────────────────────────────────
async function runGame(guild, channel, game, reward, duration, customEmojis) {
  switch (game.mechanic) {
    case 'lottery':     return runLottery(guild, channel, game, reward, duration);
    case 'first_click': return runFirstClick(guild, channel, game, reward, duration);
    case 'react_race':  return runReactRace(guild, channel, game, reward, duration, customEmojis);
    case 'mcq':         return runMCQ(guild, channel, game, reward, duration);
    case 'type':        return runType(guild, channel, game, reward, duration);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ██  MECHANIC: LOTTERY
// ─────────────────────────────────────────────────────────────────────────────
async function runLottery(guild, channel, game, reward, duration) {
  const attachment = await sendCanvas(channel, game.id, game.name, game.hint, reward, duration);

  const embed = new EmbedBuilder()
    .setColor(0xf9ca24)
    .setTitle(game.name)
    .setDescription(`اضغط الزر للمشاركة!\nسيتم اختيار فائز عشوائي بعد **${Math.floor(duration/60)} دقيقة**\nالجائزة: **${reward} XP** 🏆\n\n👥 المشاركون: **0**`)
    .setFooter({ text: `⏱ ينتهي بعد ${Math.floor(duration/60)} دقيقة` })
    .setTimestamp();
  if (attachment) embed.setImage('attachment://daily_event.png');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`daily_join_${guild.id}`)
      .setLabel('🎟️ أشارك!')
      .setStyle(ButtonStyle.Success),
  );

  const files = attachment ? [attachment] : [];
  const msg = await channel.send({ embeds: [embed], components: [row], files });

  activeEvents.set(guild.id, {
    type: 'lottery', channelId: channel.id, messageId: msg.id,
    participants: new Set(), reward, duration, guild, game,
  });

  setTimeout(async () => {
    const ev = activeEvents.get(guild.id);
    if (!ev || ev.type !== 'lottery') return;
    activeEvents.delete(guild.id);

    const parts = [...ev.participants];
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`daily_join_${guild.id}`)
        .setLabel(`🎟️ انتهى — ${parts.length} مشارك`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );
    msg.edit({ components: [disabledRow] }).catch(() => {});

    if (parts.length === 0) {
      return channel.send({ embeds: [new EmbedBuilder().setColor(0x636e72).setDescription('😔 لم يشارك أحد في اليانصيب اليوم. إلى الغد!')] });
    }

    const winnerId = pick(parts);
    const winner   = await guild.members.fetch(winnerId).catch(() => null);
    if (!winner) return;
    addXpDirect(guild.id, winnerId, winner.user.username, ev.reward);

    channel.send({ embeds: [new EmbedBuilder()
      .setColor(0xf9ca24).setTitle('🏆 فائز اليانصيب اليومي!')
      .setDescription(`🎉 مبروك ${winner}!\nفزت بـ **${ev.reward} XP** من بين **${parts.length}** مشارك! 🎊`)
      .setThumbnail(winner.user.displayAvatarURL({ extension: 'png', size: 128 })).setTimestamp()] });
  }, duration * 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// ██  MECHANIC: FIRST CLICK
// ─────────────────────────────────────────────────────────────────────────────
async function runFirstClick(guild, channel, game, reward, duration) {
  duration = clampDuration(duration);
  const attachment = await sendCanvas(channel, game.id, game.name, game.hint, reward, duration);

  const embed = new EmbedBuilder()
    .setColor(0xfd79a8)
    .setTitle(game.name)
    .setDescription(`⚡ أول من يضغط الزر يفوز بـ **${reward} XP**!\n\nكن الأسرع!`)
    .setFooter({ text: `⏱ ينتهي بعد ${Math.floor(duration/60)} دقيقة` })
    .setTimestamp();
  if (attachment) embed.setImage('attachment://daily_event.png');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`daily_first_${guild.id}`)
      .setLabel('⚡ اضغط الآن!')
      .setStyle(ButtonStyle.Danger),
  );

  const files = attachment ? [attachment] : [];
  const msg = await channel.send({ embeds: [embed], components: [row], files });

  activeEvents.set(guild.id, { type: 'first_click', channelId: channel.id, messageId: msg.id, reward, guild, won: false });

  setTimeout(async () => {
    const ev = activeEvents.get(guild.id);
    if (!ev || ev.type !== 'first_click' || ev.won) return;
    activeEvents.delete(guild.id);
    const doneRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`daily_first_${guild.id}_done`).setLabel('انتهت الفعالية').setStyle(ButtonStyle.Secondary).setDisabled(true)
    );
    msg.edit({ components: [doneRow] }).catch(() => {});
    channel.send({ embeds: [new EmbedBuilder().setColor(0x636e72).setDescription('⏰ لم يضغط أحد! حظاً أوفر غداً 😅')] });
  }, duration * 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// ██  MECHANIC: REACT RACE
// ─────────────────────────────────────────────────────────────────────────────
async function runReactRace(guild, channel, game, reward, duration, customEmojis) {
  const emojiPool = (customEmojis && customEmojis.length > 0) ? customEmojis : REACT_EMOJIS;
  const emoji = pick(emojiPool);
  const attachment = await sendCanvas(channel, game.id, game.name, `أرسل الإيموجي ${emoji} في الشات أولاً!`, reward, duration);

  const embed = new EmbedBuilder()
    .setColor(0xa29bfe)
    .setTitle(game.name)
    .setDescription(`🎯 أرسل الإيموجي التالي في الشات أولاً لتفوز بـ **${reward} XP**!\n\n# ${emoji}\n\nلديك **${Math.floor(duration/60)} دقيقة**!`)
    .setFooter({ text: `⏱ ينتهي بعد ${Math.floor(duration/60)} دقيقة` })
    .setTimestamp();
  if (attachment) embed.setImage('attachment://daily_event.png');

  const files = attachment ? [attachment] : [];
  await channel.send({ embeds: [embed], files });

  activeEvents.set(guild.id, { type: 'react_race', channelId: channel.id, emoji, reward, guild, won: false });

  setTimeout(async () => {
    const ev = activeEvents.get(guild.id);
    if (!ev || ev.type !== 'react_race' || ev.won) return;
    activeEvents.delete(guild.id);
    channel.send({ embeds: [new EmbedBuilder().setColor(0x636e72).setDescription(`⏰ انتهى الوقت! الإيموجي كان **${emoji}** — لا أحد فاز. إلى الغد!`)] });
  }, duration * 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// ██  MECHANIC: MCQ
// ─────────────────────────────────────────────────────────────────────────────
async function runMCQ(guild, channel, game, reward, duration) {
  const bank = MCQ_BANKS[game.id];
  if (!bank?.length) return;
  const q = pick(bank);

  const attachment = await sendCanvas(channel, game.id, game.name, q.q, reward, duration);

  const embed = new EmbedBuilder()
    .setColor(0x6c5ce7)
    .setTitle(game.name)
    .setDescription(`**${q.q}**\n\nأول إجابة صحيحة تفوز بـ **${reward} XP** 🧠`)
    .setFooter({ text: `⏱ لديك ${Math.floor(duration/60)} دقيقة` })
    .setTimestamp();
  if (attachment) embed.setImage('attachment://daily_event.png');

  const row = new ActionRowBuilder().addComponents(
    q.opts.map((opt, i) =>
      new ButtonBuilder()
        .setCustomId(`daily_mcq_${guild.id}_${i}`)
        .setLabel(`${MCQ_LABELS[i]} ${opt}`)
        .setStyle(ButtonStyle.Primary),
    ),
  );

  const files = attachment ? [attachment] : [];
  const msg = await channel.send({ embeds: [embed], components: [row], files });

  activeEvents.set(guild.id, {
    type: 'mcq', channelId: channel.id, messageId: msg.id,
    correctIndex: q.ans, options: q.opts, reward, guild, answered: false, game,
  });

  setTimeout(async () => {
    const ev = activeEvents.get(guild.id);
    if (!ev || ev.type !== 'mcq' || ev.answered) return;
    activeEvents.delete(guild.id);
    msg.edit({ components: [_mcqDisabledRow(guild.id, q.opts, q.ans)] }).catch(() => {});
    channel.send({ embeds: [new EmbedBuilder().setColor(0x636e72)
      .setDescription(`⏰ انتهى الوقت! الإجابة الصحيحة كانت: **${q.opts[q.ans]}**`)] });
  }, duration * 1000);
}

function _mcqDisabledRow(guildId, options, correctIndex) {
  return new ActionRowBuilder().addComponents(
    options.map((opt, i) =>
      new ButtonBuilder()
        .setCustomId(`daily_mcq_${guildId}_${i}_done`)
        .setLabel(`${MCQ_LABELS[i]} ${opt}`)
        .setStyle(i === correctIndex ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(true),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ██  MECHANIC: TYPE ANSWER
// ─────────────────────────────────────────────────────────────────────────────
async function runType(guild, channel, game, reward, duration) {
  let question, answer, displayQ;

  const pool = TYPE_POOLS[game.id];
  if (!pool?.length) return;

  const item = pick(pool);

  // Each pool entry can be:
  //   string              → question = answer = item
  //   { q, a }            → standard Q&A
  //   { q, a, display }   → custom display text
  if (typeof item === 'string') {
    question = item; answer = item;
    displayQ = `✍️ أول من يكتب هذا بدقة يفوز بـ **${reward} XP**!\n\n# \`${item}\``;
  } else if (item.display) {
    question = item.q; answer = item.a;
    displayQ = item.display.replace('{reward}', reward);
  } else {
    question = item.q; answer = item.a;
    displayQ = `❓ **${item.q}**\n\naكتب الإجابة في الشات لتفوز بـ **${reward} XP**!`;
  }

  const attachment = await sendCanvas(channel, game.id, game.name, question.length > 80 ? game.hint : question, reward, duration);

  const embed = new EmbedBuilder()
    .setColor(0xe17055)
    .setTitle(game.name)
    .setDescription(displayQ)
    .setFooter({ text: `⏱ لديك ${Math.floor(duration/60)} دقيقة` })
    .setTimestamp();
  if (attachment) embed.setImage('attachment://daily_event.png');

  const files = attachment ? [attachment] : [];
  await channel.send({ embeds: [embed], files });

  activeEvents.set(guild.id, {
    type: 'type', mechanic_id: game.id, channelId: channel.id,
    answer, reward, guild, won: false,
  });

  setTimeout(async () => {
    const ev = activeEvents.get(guild.id);
    if (!ev || ev.type !== 'type' || ev.won) return;
    activeEvents.delete(guild.id);
    channel.send({ embeds: [new EmbedBuilder().setColor(0x636e72)
      .setDescription(`⏰ انتهى الوقت! الإجابة كانت: **${answer}** — لا أحد فاز. إلى الغد!`)] });
  }, duration * 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// ██  BUTTON / MESSAGE HANDLERS  (called from index.js)
// ─────────────────────────────────────────────────────────────────────────────

async function handleLotteryJoin(interaction) {
  const ev = activeEvents.get(interaction.guildId);
  if (!ev || ev.type !== 'lottery') {
    return interaction.reply({ content: '⏰ انتهت الفعالية.', flags: MessageFlags.Ephemeral });
  }
  if (ev.participants.has(interaction.user.id)) {
    return interaction.reply({ content: '✅ أنت مسجّل بالفعل! انتظر النتيجة.', flags: MessageFlags.Ephemeral });
  }
  ev.participants.add(interaction.user.id);

  const updatedEmbed = new EmbedBuilder()
    .setColor(0xf9ca24)
    .setTitle(ev.game?.name || 'اليانصيب اليومي')
    .setDescription(
      `اضغط الزر للمشاركة! سيتم اختيار فائز عشوائي ويحصل على **${ev.reward} XP** 🏆\n\n` +
      `👥 المشاركون: **${ev.participants.size}**`,
    )
    .setFooter({ text: `⏱ ينتهي بعد ${Math.floor((ev.duration || 0) / 60)} دقيقة` })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`daily_join_${interaction.guildId}`)
      .setLabel('🎟️ أشارك!')
      .setStyle(ButtonStyle.Success),
  );
  await interaction.update({ embeds: [updatedEmbed], components: [row] });
}

async function handleFirstClick(interaction) {
  const ev = activeEvents.get(interaction.guildId);
  if (!ev || ev.type !== 'first_click' || ev.won) {
    return interaction.reply({ content: '⏰ انتهت الفعالية.', flags: MessageFlags.Ephemeral });
  }
  ev.won = true;
  activeEvents.delete(interaction.guildId);

  addXpDirect(interaction.guildId, interaction.user.id, interaction.user.username, ev.reward);

  const doneRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`daily_first_${interaction.guildId}_done`)
      .setLabel(`🏆 فاز: ${interaction.user.username}`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
  );
  await interaction.update({ components: [doneRow] });

  await interaction.channel.send({ embeds: [new EmbedBuilder()
    .setColor(0xfd79a8).setTitle('⚡ أول ضغطة!')
    .setDescription(`🏆 مبروك ${interaction.user}!\nكنت الأسرع وفزت بـ **${ev.reward} XP**! ⚡`)
    .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 128 })).setTimestamp()] });
}

async function handleMCQAnswer(interaction, optionIndex) {
  const ev = activeEvents.get(interaction.guildId);
  if (!ev || ev.type !== 'mcq' || ev.answered) {
    return interaction.reply({ content: '⏰ انتهت الفعالية.', flags: MessageFlags.Ephemeral });
  }
  if (optionIndex !== ev.correctIndex) {
    return interaction.reply({ content: '❌ إجابة خاطئة! حاول مجدداً.', flags: MessageFlags.Ephemeral });
  }

  ev.answered = true;
  activeEvents.delete(interaction.guildId);
  addXpDirect(interaction.guildId, interaction.user.id, interaction.user.username, ev.reward);

  await interaction.update({ components: [_mcqDisabledRow(interaction.guildId, ev.options, ev.correctIndex)] });
  await interaction.channel.send({ embeds: [new EmbedBuilder()
    .setColor(0x00b894).setTitle('🏆 إجابة صحيحة!')
    .setDescription(`🎉 مبروك ${interaction.user}!\nأجبت بـ **${ev.options[optionIndex]}** وفزت بـ **${ev.reward} XP**! 🧠`)
    .setTimestamp()] });
}

async function handleTypeMessage(message) {
  if (message.author.bot || !message.guildId) return;
  const ev = activeEvents.get(message.guildId);
  if (!ev || ev.type !== 'type' || ev.won) return;
  if (message.channelId !== ev.channelId) return;

  const content = message.content.trim();
  if (content !== ev.answer) return;

  ev.won = true;
  activeEvents.delete(message.guildId);
  addXpDirect(message.guildId, message.author.id, message.author.username, ev.reward);

  await message.channel.send({ embeds: [new EmbedBuilder()
    .setColor(0xe17055).setTitle('🏆 إجابة صحيحة!')
    .setDescription(`🎉 مبروك ${message.author}!\nكتبت **${content}** أولاً وفزت بـ **${ev.reward} XP**!`)
    .setTimestamp()] });
}

async function handleReactMessage(message) {
  if (message.author.bot || !message.guildId) return;
  const ev = activeEvents.get(message.guildId);
  if (!ev || ev.type !== 'react_race' || ev.won) return;
  if (message.channelId !== ev.channelId) return;
  if (message.content.trim() !== ev.emoji) return;

  ev.won = true;
  activeEvents.delete(message.guildId);
  addXpDirect(message.guildId, message.author.id, message.author.username, ev.reward);

  await message.channel.send({ embeds: [new EmbedBuilder()
    .setColor(0xa29bfe).setTitle('🎯 فائز سباق الإيموجي!')
    .setDescription(`🎉 مبروك ${message.author}!\nأرسلت **${ev.emoji}** أولاً وفزت بـ **${ev.reward} XP**!`)
    .setTimestamp()] });
}

// Combined message handler called from index.js
async function handleDailyMessage(message) {
  await handleTypeMessage(message);
  await handleReactMessage(message);
}

// ─────────────────────────────────────────────────────────────────────────────
// ██  MANUAL TRIGGER
// ─────────────────────────────────────────────────────────────────────────────
async function triggerNow(client, loadConfig) {
  const cfg = loadConfig();
  const ev  = cfg.dailyEvent;
  if (!ev?.channelId) throw new Error('لم يتم تحديد روم الفعاليات في الإعدادات');

  if (GAME_CATALOGUE.length === 0) throw new Error('لا توجد ألعاب مضافة بعد!');

  const duration = clampDuration(ev.duration);
  const reward   = Number(ev.reward ?? 200);
  const allowed  = ev.eventTypes?.length
    ? GAME_CATALOGUE.filter(g => ev.eventTypes.includes(g.id))
    : GAME_CATALOGUE;
  const game = pick(allowed.length ? allowed : GAME_CATALOGUE);
  const customEmojis = Array.isArray(ev.reactEmojis) && ev.reactEmojis.length > 0
    ? ev.reactEmojis
    : null;

  for (const [, guild] of client.guilds.cache) {
    const ch = guild.channels.cache.get(ev.channelId);
    if (ch) {
      await runGame(guild, ch, game, reward, duration, customEmojis);
      return;
    }
  }
  throw new Error('القناة غير موجودة أو البوت ليس فيها');
}

function getActiveEvent(guildId) { return activeEvents.get(guildId) ?? null; }
function getGameCatalogue()      { return GAME_CATALOGUE; }

module.exports = {
  initDailyEvents,
  handleLotteryJoin,
  handleFirstClick,
  handleMCQAnswer,
  handleDailyMessage,
  // legacy aliases kept for backward compat with index.js
  handleQuizAnswer:  handleMCQAnswer,
  handleRaceMessage: handleDailyMessage,
  triggerNow,
  getActiveEvent,
  getGameCatalogue,
};
