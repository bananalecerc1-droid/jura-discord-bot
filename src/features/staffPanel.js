'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('../../db.js');
const { addXpDirect } = require('../../xpSystem.js');

const PANEL_IDS = {
  login: 'staff_panel_login',
  stats: 'staff_panel_stats',
  top: 'staff_panel_top',
};

function staffRoleId(cfg) {
  return cfg?.staffPanel?.staffRoleId || cfg?.staffApp?.acceptRoleId || cfg?.staffRoleId || '';
}

function isStaffMember(interaction, cfg) {
  const roleId = staffRoleId(cfg);
  if (roleId) return Boolean(interaction.member?.roles?.cache?.has(roleId));
  return Boolean(interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    interaction.member?.permissions?.has(PermissionFlagsBits.ManageRoles));
}

async function awardStaffXp(interaction, cfg, rewardKey) {
  const amount = Number(cfg?.xp?.staffActionXp?.[rewardKey] || 0);
  if (amount > 0) {
    await addXpDirect(interaction.guildId, interaction.user.id, interaction.user.username, amount);
  }
}

function ago(timestamp) {
  if (!timestamp) return 'لم يسجّل بعد';
  const diff = Math.max(0, Date.now() - Number(timestamp));
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  return `منذ ${Math.floor(hours / 24)} يوم`;
}

function panelEmbed(cfg = {}) {
  const panel = cfg.staffPanel || {};
  const embed = new EmbedBuilder()
    .setTitle(panel.title || '📊 لوحة تحكم الإدارة')
    .setDescription(panel.description || 'نظام متابعة وإحصائيات فريق الإدارة\nاستخدم الأزرار أدناه للوصول إلى بياناتك في سيرفرك')
    .setColor(parseInt(String(panel.color || '#5865F2').replace('#', ''), 16) || 0x5865f2)
    .setTimestamp();
  if (panel.image) embed.setImage(panel.image);
  if (panel.thumbnail) embed.setThumbnail(panel.thumbnail);
  if (panel.thumbnail) embed.setThumbnail(panel.thumbnail);
  if (panel.footer) embed.setFooter({ text: panel.footer });
  return embed;
}

function panelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PANEL_IDS.stats).setLabel('📈 إحصائياتي').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(PANEL_IDS.top).setLabel('🏆 توب الإدارة').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(PANEL_IDS.login).setLabel('🔐 تسجيل دخول').setStyle(ButtonStyle.Secondary),
  );
}

async function sendStaffPanel(guild, cfg) {
  const panel = cfg.staffPanel || {};
  const channelId = panel.channelId || cfg.staffApp?.embedChannelId;
  if (!channelId) throw new Error('حدد روم إرسال لوحة الإدارة أولاً');
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) throw new Error('روم لوحة الإدارة غير موجودة');
  await channel.send({ embeds: [panelEmbed(cfg)], components: [panelRow()] });
}

function statsEmbed(interaction, stats, xp) {
  const points = Number(xp?.total_xp || 0);
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📋 إحصائيات الإدارة')
    .setDescription(`العضو: ${interaction.user} — **${interaction.user.username}**`)
    .addFields(
      { name: '✉️ الرسائل', value: `**${stats.messages}**`, inline: true },
      { name: '💬 التفاعلات', value: `**${stats.interactions}**`, inline: true },
      { name: '🔒 تكتات مغلقة', value: `**${stats.closedTickets}**`, inline: true },
      { name: '⚡ أكشنز', value: `**${stats.actions}**`, inline: true },
      { name: '🏅 النقاط', value: `**${points} نقطة**`, inline: true },
      { name: '🕘 آخر نشاط', value: ago(stats.lastActivity), inline: true },
      { name: '🔑 آخر تسجيل دخول', value: ago(stats.lastLogin), inline: true },
    )
    .setFooter({ text: 'يتم تحديث الإحصائيات تلقائياً مع نشاطك' })
    .setTimestamp();
}

async function handleStaffPanelButton(interaction, loadConfig) {
  const cfg = loadConfig();
  if (!isStaffMember(interaction, cfg)) {
    return interaction.reply({ content: '❌ هذا النظام مخصص لأعضاء فريق الإدارة فقط.', flags: MessageFlags.Ephemeral });
  }

  const base = { guildId: interaction.guildId, userId: interaction.user.id, username: interaction.user.username };
  if (interaction.customId === PANEL_IDS.login) {
    const today = new Date().toISOString().split('T')[0];
    const stats = await db.getStaffActivity(base.guildId, base.userId);
    if (stats.lastLoginDay === today) {
      return interaction.reply({ content: '❌ لقد قمت بتسجيل الدخول اليوم بالفعل.', flags: MessageFlags.Ephemeral });
    }
    await db.recordStaffLogin(base.guildId, base.userId, base.username, today);
    await awardStaffXp(interaction, cfg, 'login');
    await logStaffLogin(interaction, cfg);
    return interaction.reply({ content: '✅ تم تسجيل دخولك في فريق الإدارة.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === PANEL_IDS.stats) {
    await awardStaffXp(interaction, cfg, 'interaction');
    const [stats, xp] = await Promise.all([
      db.getStaffActivity(base.guildId, base.userId),
      db.getXpUser(base.guildId, base.userId),
    ]);
    return interaction.reply({ embeds: [statsEmbed(interaction, stats, xp)], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === PANEL_IDS.top) {
    await awardStaffXp(interaction, cfg, 'interaction');
    const rows = await db.getStaffActivityRows(base.guildId, 10);
    const lines = rows.length
      ? rows.map((row, index) => `${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : (index + 1) + '.'} <@${row.user_id}> — **${Number(row.total_xp || 0)} نقطة**`).join('\n')
      : 'لا توجد بيانات نشاط للإدارة بعد.';
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('🏆 توب الإدارة').setDescription(lines).setTimestamp()],
      flags: MessageFlags.Ephemeral,
    });
  }
}


async function logStaffLogin(interaction, cfg) {
  const logChannelId = cfg.logs?.loginChannelId || cfg.logs?.generalChannelId;
  if (!logChannelId) return;
  const channel = interaction.guild.channels.cache.get(logChannelId);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('🔐 تسجيل دخول إداري')
    .setDescription(`قام الإداري ${interaction.user} بتسجيل دخوله اليومي.`)
    .setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { sendStaffPanel, handleStaffPanelButton, isStaffMember, staffRoleId, awardStaffXp, PANEL_IDS };
