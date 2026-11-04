const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const db = require('./db.js');
const { resetLeaderboardXp } = require('./xpSystem.js');

const PER_PAGE = 5;
const MAX_ENTRIES = 10;
// Marker carried through discord.js MessagePayload using only valid Discord fields.
// The Component V2 transport recognizes this exact empty mention policy and leaves
// Top responses as normal legacy embeds.
const TOP_LEGACY_MENTIONS = Object.freeze({
  parse: [],
  users: [],
  roles: [],
  repliedUser: false,
});
const PERIODS = {
  all: { label: 'الإجمالي 🏆', total: 'total_xp', voice: 'voice_total_xp' },
  daily: { label: 'اليومي ☀️', total: 'daily_xp', voice: 'voice_daily_xp' },
  weekly: { label: 'الأسبوعي 📅', total: 'weekly_xp', voice: 'voice_weekly_xp' },
  monthly: { label: 'الشهري 📆', total: 'monthly_xp', voice: 'voice_monthly_xp' },
};

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatXp(value) {
  return number(value).toLocaleString();
}

function getPeriod(type) {
  return PERIODS[type] || PERIODS.all;
}

function getEntryMetrics(row, type, mode) {
  const period = getPeriod(type);
  const totalPeriodXp = number(row[period.total]);
  const voicePeriodXp = number(row[period.voice]);
  // XP الفويس أصبح داخل total_xp/daily_xp/weekly_xp/monthly_xp.
  // لذلك لا نضيفه مرة ثانية في الإجمالي؛ نستخدم الفرق فقط لعرض التفصيل.
  const textPeriodXp = Math.max(0, totalPeriodXp - voicePeriodXp);
  const metric = mode === 'voice'
    ? voicePeriodXp
    : mode === 'text'
      ? textPeriodXp
      : totalPeriodXp;
  return { metric, totalPeriodXp, voicePeriodXp, textPeriodXp };
}

async function buildTopData(guild, type, mode, requesterId) {
  if (!guild) return null;

  // نفّذ reset نفس المستخدم في xpSystem قبل قراءة صفوف Turso.
  await resetLeaderboardXp().catch(() => {});
  await guild.members.fetch().catch(() => null);

  let rows;
  try {
    rows = await db.getGuildXpAll(guild.id);
  } catch (error) {
    console.error('[Top] Turso query error:', error.message);
    return null;
  }

  const entries = [];
  for (const row of rows || []) {
    const member = guild.members.cache.get(String(row.user_id));
    if (!member || member.user?.bot) continue;

    const metrics = getEntryMetrics(row, type, mode);
    if (metrics.metric <= 0) continue;

    entries.push({
      userId: String(row.user_id),
      username: row.username || member.user.username,
      ...metrics,
    });
  }

  entries.sort((a, b) => {
    const difference = b.metric - a.metric;
    return difference || a.username.localeCompare(b.username);
  });

  if (!entries.length) return null;

  const displayed = entries.slice(0, MAX_ENTRIES);
  const pages = Math.ceil(displayed.length / PER_PAGE);
  const requesterRank = entries.findIndex(entry => entry.userId === String(requesterId));
  const requesterInfo = requesterRank >= 0 ? entries[requesterRank] : null;
  const period = getPeriod(type);

  function buildEmbed(page) {
    const lines = displayed
      .slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)
      .map((entry, index) => {
        const rank = page * PER_PAGE + index + 1;
        if (mode === 'voice') {
          return `**#${rank}** <@${entry.userId}>\n┗ 🎤 XP: **${formatXp(entry.voicePeriodXp)}**`;
        }
        if (mode === 'text') {
          return `**#${rank}** <@${entry.userId}>\n┗ 💬 XP: **${formatXp(entry.textPeriodXp)}**`;
        }

        const breakdown = [];
        if (entry.textPeriodXp > 0) breakdown.push(`💬 ${formatXp(entry.textPeriodXp)}`);
        if (entry.voicePeriodXp > 0) breakdown.push(`🎤 ${formatXp(entry.voicePeriodXp)}`);
        const details = breakdown.length ? ` ┃ ${breakdown.join(' + ')}` : '';
        return `**#${rank}** <@${entry.userId}>\n┗ XP: **${formatXp(entry.totalPeriodXp)}**${details}`;
      });

    const titleMode = mode === 'voice'
      ? '🎤 توب الفويس'
      : mode === 'text'
        ? '💬 توب الكتابي'
        : '🏆 توب الإجمالي';
    const color = mode === 'voice' ? 0x5865f2 : mode === 'text' ? 0x57f287 : 0xf1c40f;
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${titleMode} — ${period.label}`)
      .setDescription(lines.join('\n\n'))
      .setTimestamp();
    const guildIcon = guild.iconURL({ extension: 'png', size: 256 });
    if (guildIcon) embed.setThumbnail(guildIcon);

    if (requesterInfo) {
      const requesterParts = [];
      if (mode === 'total') {
        if (requesterInfo.textPeriodXp > 0) requesterParts.push(`💬 ${formatXp(requesterInfo.textPeriodXp)}`);
        if (requesterInfo.voicePeriodXp > 0) requesterParts.push(`🎤 ${formatXp(requesterInfo.voicePeriodXp)}`);
      }
      const breakdown = requesterParts.length ? ` ┃ ${requesterParts.join(' + ')}` : '';
      embed.addFields({
        name: 'ترتيبك :',
        value: `**#${requesterRank + 1}** ┊ XP: **${formatXp(requesterInfo.metric)}**${breakdown}`,
        inline: false,
      });
    }
    return embed;
  }

  return { pages, buildEmbed };
}

function buildRows(page, pages, mode) {
  const rows = [];
  if (pages > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('top_prev')
        .setLabel('◀ السابق')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('top_next')
        .setLabel('التالي ▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page >= pages - 1),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('top_mode_total')
      .setLabel('🏆 الإجمالي')
      .setStyle(mode === 'total' ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(mode === 'total'),
    new ButtonBuilder()
      .setCustomId('top_mode_voice')
      .setLabel('🎤 توب الفويس')
      .setStyle(mode === 'voice' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(mode === 'voice'),
    new ButtonBuilder()
      .setCustomId('top_mode_text')
      .setLabel('💬 توب الكتابي')
      .setStyle(mode === 'text' ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(mode === 'text'),
  ));
  return rows;
}

async function startCollector(message, guild, type, userId) {
  let mode = 'total';
  let page = 0;
  const collector = message.createMessageComponentCollector({
    filter: interaction => interaction.user.id === userId,
    time: 120_000,
  });

  collector.on('collect', async interaction => {
    try {
      await interaction.deferUpdate();
      if (interaction.customId === 'top_next') page += 1;
      if (interaction.customId === 'top_prev') page = Math.max(0, page - 1);
      if (interaction.customId === 'top_mode_total') { mode = 'total'; page = 0; }
      if (interaction.customId === 'top_mode_voice') { mode = 'voice'; page = 0; }
      if (interaction.customId === 'top_mode_text') { mode = 'text'; page = 0; }

      const result = await buildTopData(guild, type, mode, userId);
      if (!result) {
        await interaction.editReply({ content: '⚠️ لا توجد بيانات لهذا النوع بعد.', embeds: [], components: [], allowedMentions: TOP_LEGACY_MENTIONS });
        collector.stop('empty');
        return;
      }
      page = Math.min(page, result.pages - 1);
      await interaction.editReply({
        embeds: [result.buildEmbed(page)],
        components: buildRows(page, result.pages, mode),
        allowedMentions: TOP_LEGACY_MENTIONS,
      });
    } catch (error) {
      console.error('[Top] button error:', error.message);
    }
  });

  collector.on('end', () => message.edit({ components: [], allowedMentions: TOP_LEGACY_MENTIONS }).catch(() => {}));
}

const command = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('🏆 عرض لوحة المتصدرين')
    .setIntegrationTypes([0, 1])
    .setContexts([0])
    .addStringOption(option => option
      .setName('type')
      .setDescription('نوع اللوحة')
      .setRequired(false)
      .addChoices(
        { name: '🏆 الإجمالي', value: 'all' },
        { name: '☀️ اليومي', value: 'daily' },
        { name: '📅 الأسبوعي', value: 'weekly' },
        { name: '📆 الشهري', value: 'monthly' },
      )),

  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ content: '❌ هذا الأمر يعمل داخل السيرفر فقط.', flags: MessageFlags.Ephemeral });
    const type = interaction.options.getString('type') || 'all';
    await interaction.deferReply();
    const result = await buildTopData(interaction.guild, type, 'total', interaction.user.id);
    if (!result) return interaction.editReply({ content: '⚠️ لا توجد بيانات XP لهذا النوع بعد.' });
    await interaction.editReply({
      embeds: [result.buildEmbed(0)],
      components: buildRows(0, result.pages, 'total'),
      allowedMentions: TOP_LEGACY_MENTIONS,
    });
    const message = await interaction.fetchReply();
    await startCollector(message, interaction.guild, type, interaction.user.id);
  },

  async executePrefixed(message, args = []) {
    if (!message.guild) return message.reply('❌ هذا الأمر يعمل داخل السيرفر فقط.');
    const type = ['all', 'daily', 'weekly', 'monthly'].includes(args[0]) ? args[0] : 'all';
    const result = await buildTopData(message.guild, type, 'total', message.author.id);
    if (!result) return message.reply({ content: '⚠️ لا توجد بيانات XP لهذا النوع بعد.', allowedMentions: TOP_LEGACY_MENTIONS });
    const sent = await message.reply({
      embeds: [result.buildEmbed(0)],
      components: buildRows(0, result.pages, 'total'),
      allowedMentions: TOP_LEGACY_MENTIONS,
    });
    await startCollector(sent, message.guild, type, message.author.id);
  },
};

module.exports = command;
module.exports.buildTopData = buildTopData;
