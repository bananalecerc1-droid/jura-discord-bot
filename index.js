require("dotenv").config();
let cfg = {};
try { cfg = require("./config.json"); } catch {}
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DEBUG = true; // غيّرها إلى true إذا أردت رؤية سجلات console.log
// Silence routine console.log noise (e.g. 24/7 voice session logs) — only real errors get printed.
if (!DEBUG) {
  console.log = () => {};
}
const { createHtmlTranscript } = require('./src/features/transcript.js');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  AuditLogEvent,
  PermissionFlagsBits,
  AttachmentBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  MentionableSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  Collection,
} = require("discord.js");

function nonPingMention(user) {
  if (!user) return 'Unknown';
  const id = typeof user === 'string' ? user : user.id;
  return `<@${id}>`;
}



async function sendTicketClosureLog(interaction, cfg) {
  try {
    const allTickets = await db.loadTickets();
    const ticketData = (allTickets[interaction.guild.id] || {})[interaction.channel.id] || {};
    const openerId = ticketData.userId || interaction.channel.topic?.replace('ticket-', '') || null;
    const openerLabel = openerId ? `<@${openerId}>${ticketData.username ? ` (${ticketData.username})` : ''}` : 'Unknown';
    const logChannelId = cfg.logs?.ticketChannelId;
    if (!logChannelId) {
      console.error('[Ticket Log] No ticketChannelId configured');
      return;
    }
    const logCh = await interaction.guild.channels.fetch(logChannelId).catch((err) => {
      console.error('[Ticket Log] Could not fetch log channel:', err.message);
      return null;
    });
    if (!logCh || !logCh.isTextBased()) {
      console.error('[Ticket Log] Configured log channel is unavailable or not text-based');
      return;
    }
    const closedAt = new Date();
    const logEmbed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🔒 Ticket closed')
      .setAuthor({ name: interaction.user.tag || interaction.user.username, iconURL: interaction.user.displayAvatarURL({ size: 128 }) })
      .addFields(
        { name: 'Ticket', value: `#${interaction.channel.name}`, inline: true },
        { name: 'Opened by', value: openerLabel, inline: true },
        { name: 'Closed by', value: `<@${interaction.user.id}> (${interaction.user.username})`, inline: true },
        { name: 'Closed at', value: `<t:${Math.floor(closedAt.getTime() / 1000)}:F>`, inline: false },
      )
      .setFooter({ text: 'The full HTML transcript will be sent as a separate file message' })
      .setTimestamp(closedAt);
    await logCh.send({ embeds: [logEmbed], allowedMentions: { users: [] } });

    const transcriptBuffer = await createHtmlTranscript(interaction.channel, interaction.channel.name, { openedAt: ticketData.openedAt });
    if (!transcriptBuffer) {
      await logCh.send({ content: '⚠️ The ticket was closed, but the HTML transcript could not be generated.' });
      console.error('[Ticket Log] Transcript generator returned no buffer');
      return;
    }
    console.log(`[Ticket Log] Sending transcript (${transcriptBuffer.length} bytes) for ${interaction.channel.name}`);
    await logCh.send({
      content: `📄 Full HTML transcript for **#${interaction.channel.name}**`,
      files: [new AttachmentBuilder(transcriptBuffer, { name: `transcript-${interaction.channel.name}.html` })],
      allowedMentions: { users: [] },
    });
    console.log(`[Ticket Log] Transcript sent for ${interaction.channel.name}`);
  } catch (err) {
    console.error('[Ticket Log] Close log/transcript failed:', err.stack || err.message);
  }
}
// ── Boost ticket system ──
const BOOST_TICKET_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const boostTickets = new Map(); // channelId → { channelId, userId, guildId, stage, data, expiresAt }
const boostTicketTimers = new Map();

function scheduleBoostTicketExpiry(ticket) {
  const previous = boostTicketTimers.get(ticket.channelId);
  if (previous) clearTimeout(previous);
  const delay = Math.max(1, (ticket.expiresAt || Date.now() + BOOST_TICKET_TIMEOUT_MS) - Date.now());
  const timer = setTimeout(async () => {
    const current = boostTickets.get(ticket.channelId);
    if (!current || current !== ticket) return;
    await closeBoostTicket(ticket.channelId, "انتهت مدة تذكرة البوست (ساعتان) وتم إغلاقها تلقائياً.");
  }, delay);
  boostTicketTimers.set(ticket.channelId, timer);
}

// Close a boost ticket: send final message then delete channel after a delay
async function closeBoostTicket(channelId, successMsg) {
  const timer = boostTicketTimers.get(channelId);
  if (timer) clearTimeout(timer);
  boostTicketTimers.delete(channelId);
  const ch = client.channels.cache.get(channelId);
  boostTickets.delete(channelId);
  if (!ch) return;
  try {
    if (successMsg)
      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setDescription(`✅ ${successMsg}`),
        ],
      });
    setTimeout(() => ch.delete("Boost ticket completed").catch(() => {}), 4000);
  } catch {}
}

async function failBoostTicket(channelId, errMsg) {
  const timer = boostTicketTimers.get(channelId);
  if (timer) clearTimeout(timer);
  boostTicketTimers.delete(channelId);
  const ch = client.channels.cache.get(channelId);
  boostTickets.delete(channelId);
  if (!ch) return;
  try {
    await ch.send({
      embeds: [
        new EmbedBuilder().setColor(0xff0000).setDescription(`❌ ${errMsg}`),
      ],
    });
    // Il canale NON viene più cancellato automaticamente in caso di errore,
    // cosi hai tempo di leggere il messaggio. Cancellalo tu manualmente quando hai finito.
  } catch {}
}

// Send the role preview embed with Change / Delete / Done buttons
async function sendBoostRolePreview(channel, userId, guild) {
  const cfg = loadConfig();
  const rd = cfg.boost?.roles?.[userId];
  if (!rd?.roleId) return closeBoostTicket(channel.id, "ما وجدت رتبتك.");
  const role =
    guild.roles.cache.get(rd.roleId) ||
    (await guild.roles.fetch(rd.roleId).catch(() => null));
  const colorHex = role
    ? `#${role.color.toString(16).padStart(6, "0").toUpperCase()}`
    : "#1692C4";
  const embed = new EmbedBuilder()
    .setColor(role?.color || 0x1692c4)
    .setTitle("🎨 معاينة رتبتك")
    .setDescription(
      `هذا شكل رتبتك — راجعها واضغط **تغيير** إذا أردت تعديلاً أو **تم** للإنهاء.`,
    )
    .addFields(
      {
        name: "📛 الاسم",
        value: role ? `${role}` : `\`${rd.roleName}\``,
        inline: true,
      },
      { name: "🎨 اللون", value: `\`${colorHex}\``, inline: true },
      {
        name: "😀 الإيموجي",
        value: rd.roleEmoji || "*(بدون إيموجي)*",
        inline: true,
      },
    )
    .setFooter({ text: "تُحذف الرتبة تلقائياً بعد 30 يوم." });
  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("boost_preview_change")
      .setLabel("تغيير")
      .setEmoji("✏️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("boost_preview_delete")
      .setLabel("حذف")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("boost_preview_done")
      .setLabel("تم")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Secondary),
  );
  try {
    console.log("[sendBoostRolePreview] sending, embed title=", embed.data?.title, "fields=", embed.data?.fields?.length);
    await channel.send({ embeds: [embed], components: [btnRow] });
    console.log("[sendBoostRolePreview] sent OK");
  } catch (err) {
    console.error("[sendBoostRolePreview] FAILED:", err.message);
    console.error("[sendBoostRolePreview] STACK:", err.stack);
    if (err.requestBody) console.error("[sendBoostRolePreview] requestBody:", JSON.stringify(err.requestBody));
  }
  const ticket = boostTickets.get(channel.id);
  if (ticket) ticket.stage = "preview";
}

// Parse color name or hex → integer (null if invalid)
function parseBoostColor(text) {
  const C = {
    pink: 0xff73fa,
    red: 0xff0000,
    orange: 0xff8c00,
    yellow: 0xffff00,
    green: 0x57f287,
    cyan: 0x00d4ff,
    blue: 0x5865f2,
    purple: 0x9b59b6,
    white: 0xffffff,
    black: 0x2b2d31,
    gold: 0xf1c40f,
    gray: 0x95a5a6,
    grey: 0x95a5a6,
    rose: 0xff007f,
    teal: 0x008080,
    lime: 0x00ff00,
    magenta: 0xff00ff,
    violet: 0x7f00ff,
    navy: 0x000080,
    brown: 0x8b4513,
    coral: 0xff6b6b,
    lavender: 0xb57edc,
    indigo: 0x4b0082,
    crimson: 0xdc143c,
    turquoise: 0x40e0d0,
    aqua: 0x00ffff,
    mint: 0x98ff98,
    salmon: 0xfa8072,
    maroon: 0x800000,
    silver: 0xc0c0c0,
  };
  const lower = text.toLowerCase().trim();
  if (C[lower] !== undefined) return C[lower];
  const hex = lower.replace("#", "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return parseInt(hex, 16);
  return null;
}

// Parse emoji from a message → { type, iconUrl, display } or null
function parseBoostEmoji(message) {
  const content = message.content.trim();
  const customMatch = content.match(/<(a?):(\w+):(\d+)>/);
  if (customMatch) {
    const animated = customMatch[1] === "a";
    const name = customMatch[2],
      id = customMatch[3];
    return {
      type: "custom",
      iconUrl: `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`,
      display: animated ? `<a:${name}:${id}>` : `<:${name}:${id}>`,
    };
  }
  const uniMatch = content.match(
    /^(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u,
  );
  if (uniMatch)
    return {
      type: "unicode",
      char: uniMatch[1],
      display: uniMatch[1],
      iconUrl: null,
    };
  return null;
}

// Resolve emoji val → CDN URL (or null) — kept for any remaining references
function boostEmojiCdnUrl(emojiVal) {
  if (!emojiVal || emojiVal === "none") return null;
  const parts = emojiVal.split(":");
  return `https://cdn.discordapp.com/emojis/${parts[2]}.${parts[0] === "a" ? "gif" : "png"}`;
}

// Build emoji-only select menu Component V2 for the change-emoji flow
function buildBoostEmojiV2(client, selectedEmojiVal = "none") {
  const emojiOptions = [
    {
      label: "✖️ بدون إيموجي",
      value: "none",
      default: selectedEmojiVal === "none",
    },
  ];
  const seen = new Set();
  for (const [, emoji] of client.emojis.cache) {
    if (emojiOptions.length >= 25) break;
    if (seen.has(emoji.id)) continue;
    seen.add(emoji.id);
    const val = `${emoji.animated ? "a" : "s"}:${emoji.name}:${emoji.id}`;
    emojiOptions.push({
      label: emoji.name,
      value: val,
      emoji: { id: emoji.id, name: emoji.name, animated: emoji.animated },
      default: selectedEmojiVal === val,
    });
  }
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: 17,
        components: [
          {
            type: 10,
            content:
              "## 😀 تغيير إيموجي الرتبة\nاختر الإيموجي من القائمة أدناه ثم اضغط **تطبيق**.",
          },
          { type: 14, spacing: 1 },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: "boost_select_emoji_change",
                placeholder: "😀 اختر الإيموجي",
                options: emojiOptions,
              },
            ],
          },
          { type: 14, spacing: 1 },
          {
            type: 1,
            components: [
              {
                type: 2,
                custom_id: "boost_btn_emoji_apply",
                label: "✅ تطبيق",
                style: 1,
              },
            ],
          },
        ],
      },
    ],
  };
}

const BOOST_COLORS = [
  { label: "🩵 فاتح", value: "1692C4" },
  { label: "💗 بينك", value: "FF73FA" },
  { label: "❤️ أحمر", value: "FF3333" },
  { label: "🧡 برتقالي", value: "FF8C00" },
  { label: "💛 أصفر", value: "FFD700" },
  { label: "💚 أخضر", value: "57F287" },
  { label: "🩵 سماوي", value: "00D4FF" },
  { label: "💙 أزرق", value: "5865F2" },
  { label: "💜 بنفسجي", value: "9B59B6" },
  { label: "🌸 وردي فاتح", value: "FFB6C1" },
  { label: "🏅 ذهبي", value: "F1C40F" },
  { label: "🤍 أبيض", value: "FFFFFF" },
  { label: "🖤 أسود", value: "2B2D31" },
];

// Build the Component V2 payload for the boost-create UI
function buildBoostCreateV2(
  client,
  selectedColor = "1692C4",
  selectedEmojiVal = "none",
) {
  const colorOptions = BOOST_COLORS.map((c) => ({
    label: c.label,
    value: c.value,
    default: c.value === selectedColor,
  }));

  const emojiOptions = [
    {
      label: "✖️ بدون إيموجي",
      value: "none",
      default: selectedEmojiVal === "none",
    },
  ];
  const seen = new Set();
  for (const [, emoji] of client.emojis.cache) {
    if (emojiOptions.length >= 25) break;
    if (seen.has(emoji.id)) continue;
    seen.add(emoji.id);
    const val = `${emoji.animated ? "a" : "s"}:${emoji.name}:${emoji.id}`;
    emojiOptions.push({
      label: emoji.name,
      value: val,
      emoji: { id: emoji.id, name: emoji.name, animated: emoji.animated },
      default: selectedEmojiVal === val,
    });
  }

  // Resolve display emoji string for preview
  let emojiDisplay = "";
  if (selectedEmojiVal && selectedEmojiVal !== "none") {
    const parts = selectedEmojiVal.split(":");
    emojiDisplay =
      parts[0] === "a"
        ? `<a:${parts[1]}:${parts[2]}>`
        : `<:${parts[1]}:${parts[2]}>`;
  }

  const previewText = [
    "## 🎨 إنشاء رتبتك الخاصة",
    "",
    `🎨 **اللون المختار:** \`#${selectedColor}\``,
    `😀 **الإيموجي المختار:** ${emojiDisplay || "*(بدون إيموجي)*"}`,
    "",
    "اختر اللون والإيموجي من القوائم أدناه، ثم اضغط **✨ التالي** لكتابة اسم الرتبة.",
  ].join("\n");

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: 17, // Container
        accent_color: parseInt(selectedColor, 16),
        components: [
          { type: 10, content: previewText },
          { type: 14, spacing: 1 }, // Separator
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: "boost_select_color",
                placeholder: "🎨 اختر لون الرتبة",
                options: colorOptions,
              },
            ],
          },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: "boost_select_emoji",
                placeholder: "😀 اختر إيموجي الرتبة",
                options: emojiOptions,
              },
            ],
          },
          { type: 14, spacing: 1 },
          {
            type: 1,
            components: [
              {
                type: 2,
                custom_id: "boost_btn_create_next",
                label: "✨ التالي — أدخل اسم الرتبة",
                style: 1,
              },
            ],
          },
        ],
      },
    ],
  };
}
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const {
  setXpConfigGetter,
  addXp,
  addXpDirect,
  addVoiceXp,
  getUserData,
  getVoiceUserData,
  getLeaderboard,
  getVoiceLeaderboard,
} = require("./xpSystem.js");
const topCommand = require("./top.js");
const db = require("./db.js");
const { parseDuration, formatDuration, scheduleTimeout } = require("./utils/duration.js");
const { initAutoQuote } = require("./src/features/autoQuote.js");
const { initBirthdayScheduler, handleBirthday } = require("./src/features/birthdaySystem.js");
const {
  handleApplicationStart,
  handleApplicationDecision,
} = require("./src/features/staffApp.js");
const { handleStaffPanelButton, PANEL_IDS, isStaffMember, awardStaffXp } = require("./src/features/staffPanel.js");
const { generateRankCard } = require("./src/cards/rankCard.js");
const { generateLeaderboardCard } = require("./src/cards/leaderboardCard.js");
const { generateRulesCard } = require("./src/cards/rulesCard.js");
const { generateWelcomeCard } = require("./src/cards/welcomeCard.js");
const { generateShipCard } = require("./src/cards/shipCard.js");
const {
  recordStreakImage,
  startStreakScheduler,
  getUserStreak,
} = require("./src/features/streakSystem.js");
const { generateProfileCard } = require("./src/cards/profileCard.js");
const { downloadImageBytes, resolveImgbbUrl } = require("./imageUtils.js");
const {
  extractMediaLinks,
  resolveMedia,
  downloadMediaBuffer,
  downloadInstagramFallback,
} = require("./mediaDownload.js");
const {
  numguessStart,
  numguessHandle,
  triviaStart,
  triviaButton,
  blackjackStart,
  blackjackButton,
  minesweeperStart,
  minesweeperButton,
  slotsStart,
  slotsReplay,
  catStart,
  raceChallenge,
  raceDM,
  raceAcceptBtn,
  raceDeclineBtn,
} = require("./src/games/games.js");
const { startRouletteGame, stopRouletteGame, handleRouletteButton, setRouletteConfigGetter } = require("./src/games/rouletteGame.js");
const { buildSpreads, DEFAULT_RULES, DEFAULT_NOTE } = require("./rules.js");
if (typeof buildSpreads !== "function") {
  console.error(
    "[FATAL] rules.js did not export buildSpreads — you are likely running an old/mismatched copy of rules.js. Redeploy the latest rules.js alongside index.js.",
  );
}
const { attachRelayReactionCleanup, registerRelayMessage } = require('./relayReactionCleanup.js');
const {
  startWebServer,
  loadConfig,
  saveConfig,
  initWebConfig,
} = require("./webServer");
const { startActiveChatRole } = require('./activeChatRole.js');
setRouletteConfigGetter(() => loadConfig().roulette || {});
setXpConfigGetter(() => loadConfig().xp || {});
const { startBackupScheduler } = require("./backupSystem.js");
const { installComponentV2Transport } = require("./componentV2.js");

function logRoleAction(action, userId, roleId, modId) {
  db.logRole(action, userId, roleId, modId).catch((err) =>
    console.error("Role log error:", err),
  );
}

function logMessageAction(action, userId, channelId, messageId, content = "") {
  db.logMessage(action, userId, channelId, messageId, content).catch((err) =>
    console.error("Message log error:", err),
  );
}

function logBanAction(guildId, userId, userTag, moderator, reason = "") {
  db.logBan(guildId, userId, userTag, moderator, reason).catch((err) =>
    console.error("Ban log error:", err),
  );
}

// ── ROLEPLAY CONFIG ──
const RP_CMDS = {
  kiss: {
    color: 0xff6b81,
    init: (a, b) => `**${a}** gives **${b}** a cheek kiss! 😚`,
    accept: (a, b) => `**${b}** gives **${a}** a cheek kiss back! 😚`,
    decline: (a, b) => `**${b}** pulled away from **${a}**'s cheek kiss. 😳`,
    acceptEmote: "cheek kissed back 😚",
    declineEmote: "pulled away",
    acceptLabel: "Kiss Back 😚",
    declineLabel: "Reject",
  },
  hug: {
    color: 0xa29bfe,
    apiAction: "hug",
    init: (a, b) => `**${a}** wants to hug **${b}**`,
    accept: (a, b) => `**${b}** hugged **${a}** back!`,
    decline: (a, b) => `**${b}** didn't want a hug from **${a}**.`,
    acceptEmote: "hugged back",
    declineEmote: "stepped away",
    acceptLabel: "Hug Back 🤗",
    declineLabel: "Reject",
  },
  slap: {
    color: 0xe17055,
    apiAction: "slap",
    init: (a, b) => `**${a}** slapped **${b}**`,
    accept: (a, b) => `**${b}** slapped **${a}** back for revenge!`,
    acceptEmote: "slapped back",
    acceptLabel: "Slap Back 👋",
    noDecline: true,
  },
  pat: {
    color: 0x55efc4,
    apiAction: "pat",
    init: (a, b) => `**${a}** pats **${b}**`,
    accept: (a, b) => `**${b}** enjoyed the pat from **${a}**!`,
    decline: (a, b) => `**${b}** moved away from **${a}**'s pat.`,
    acceptEmote: "enjoyed it",
    declineEmote: "moved away",
    acceptLabel: "Pat Back 👋",
    declineLabel: "Reject",
  },
  cuddle: {
    color: 0xfdcb6e,
    apiAction: "cuddle",
    init: (a, b) => `**${a}** wants to cuddle with **${b}**`,
    accept: (a, b) => `**${b}** cuddled up with **${a}**!`,
    decline: (a, b) => `**${b}** wasn't in the mood to cuddle with **${a}**.`,
    acceptEmote: "cuddled back",
    declineEmote: "not in the mood",
    acceptLabel: "Cuddle Back 🥰",
    declineLabel: "Reject",
  },
  byte: {
    color: 0x6c5ce7,
    apiAction: "bite",
    init: (a, b) => `**${a}** wants to bite **${b}**`,
    accept: (a, b) => `**${b}** bit **${a}** back for revenge!`,
    decline: (a, b) => `**${b}** dodged **${a}**'s bite!`,
    acceptEmote: "bit back",
    declineEmote: "dodged",
    acceptLabel: "Byte Revenge",
    declineLabel: "Reject",
  },
  lipkiss: {
    color: 0xff4d6d,
    apiAction: "kiss",
    init: (a, b) => `**${a}** blows a lip kiss to **${b}** 💋`,
    accept: (a, b) => `**${b}** kissed **${a}** back! 💋`,
    decline: (a, b) => `**${b}** turned their cheek away from **${a}**. 😳`,
    acceptEmote: "kissed back 💋",
    declineEmote: "turned away",
    acceptLabel: "Kiss Back 💋",
    declineLabel: "Reject",
  },
  poke: {
    color: 0x00cec9,
    apiAction: "poke",
    init: (a, b) => `**${a}** pokes **${b}** 👉`,
    accept: (a, b) => `**${b}** poked **${a}** back! 👉`,
    decline: (a, b) => `**${b}** ignored **${a}**'s poke.`,
    acceptEmote: "poked back",
    declineEmote: "ignored",
    acceptLabel: "Poke Back 👉",
    declineLabel: "Ignore",
  },
  tickle: {
    color: 0xffeaa7,
    apiAction: "tickle",
    init: (a, b) => `**${a}** tickles **${b}** 🤣`,
    accept: (a, b) => `**${b}** tickled **${a}** back! 🤣`,
    decline: (a, b) => `**${b}** escaped **${a}**'s tickles!`,
    acceptEmote: "tickled back",
    declineEmote: "escaped",
    acceptLabel: "Tickle Back 🤣",
    declineLabel: "Escape",
  },
  highfive: {
    color: 0x00b894,
    apiAction: "brofist",
    init: (a, b) => `**${a}** goes for a high five with **${b}** ✋`,
    accept: (a, b) => `**${b}** gave **${a}** a high five! ✋`,
    decline: (a, b) => `**${b}** left **${a}** hanging. 😬`,
    acceptEmote: "high fived back",
    declineEmote: "left hanging",
    acceptLabel: "High Five! ✋",
    declineLabel: "Leave Hanging",
  },
  lick: {
    color: 0xfd79a8,
    apiAction: "lick",
    init: (a, b) => `**${a}** licks **${b}** 👅`,
    accept: (a, b) => `**${b}** licked **${a}** back! 👅`,
    decline: (a, b) => `**${b}** backed away from **${a}**'s lick. 😳`,
    acceptEmote: "licked back",
    declineEmote: "backed away",
    acceptLabel: "Lick Back 👅",
    declineLabel: "Reject",
  },
};

const OTAKU_GIFS_API = "https://api.otakugifs.xyz/gif";
let otakuReactionsCache = null;
let otakuReactionsFetchedAt = 0;
const OTAKU_REACTIONS_CACHE_TTL = 60 * 60 * 1000;
const LOCAL_KISS_GIFS_FILE = path.join(__dirname, "assets", "gif-sources", "gifs");
const LOCAL_SON_GIFS_FILE = path.join(__dirname, "assets", "gif-sources", "songifs");
const LOCAL_THINK_GIFS_FILE = path.join(__dirname, "assets", "gif-sources", "think");
let localKissGifSources = null;
let localSonGifSources = null;
let localThinkGifSources = null;
const localKissGifUrlCache = new Map();
const localSonGifUrlCache = new Map();
const localThinkGifUrlCache = new Map();

async function getOtakuReactions() {
  const now = Date.now();
  if (
    otakuReactionsCache &&
    now - otakuReactionsFetchedAt < OTAKU_REACTIONS_CACHE_TTL
  ) {
    return otakuReactionsCache;
  }

  const res = await axios.get(`${OTAKU_GIFS_API}/allreactions`, {
    timeout: 8000,
  });
  const reactions = res.data?.reactions;
  if (!Array.isArray(reactions) || !reactions.length) {
    throw new Error("Otaku GIF API returned no reactions");
  }

  otakuReactionsCache = new Set(reactions);
  otakuReactionsFetchedAt = now;
  return otakuReactionsCache;
}

async function fetchOtakuGif(reaction) {
  const reactions = await getOtakuReactions();
  if (!reactions.has(reaction)) {
    throw new Error(`Unsupported Otaku GIF reaction: ${reaction}`);
  }

  const res = await axios.get(OTAKU_GIFS_API, {
    params: { reaction },
    timeout: 8000,
  });
  return res.data?.url || null;
}

async function fetchRpGif(action) {
  try {
    return await fetchOtakuGif(action);
  } catch (err) {
    console.error(`[fetchRpGif] otakugifs failed for ${action}:`, err.message);
  }
  return null;
}

function getLocalKissGifSources() {
  if (localKissGifSources) return localKissGifSources;

  try {
    localKissGifSources = fs
      .readFileSync(LOCAL_KISS_GIFS_FILE, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^https?:\/\//i.test(line));
  } catch (err) {
    console.error("[local kiss GIFs] Could not read gifs file:", err.message);
    localKissGifSources = [];
  }

  return localKissGifSources;
}

function getHtmlAttribute(tag, attribute) {
  const match = tag.match(
    new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "i"),
  );
  return match?.[1] || null;
}

async function resolveLocalKissGif(sourceUrl) {
  if (localKissGifUrlCache.has(sourceUrl)) {
    return localKissGifUrlCache.get(sourceUrl);
  }

  // The file can also contain direct media URLs, not only Tenor pages.
  if (!/tenor\.com\//i.test(sourceUrl)) {
    localKissGifUrlCache.set(sourceUrl, sourceUrl);
    return sourceUrl;
  }

  const response = await axios.get(sourceUrl, {
    timeout: 8000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const metaTags = response.data.match(/<meta\b[^>]*>/gi) || [];
  let mediaUrl = null;

  for (const tag of metaTags) {
    const property =
      getHtmlAttribute(tag, "property") || getHtmlAttribute(tag, "name");
    if (property?.toLowerCase() === "og:image" || property?.toLowerCase() === "twitter:image") {
      mediaUrl = getHtmlAttribute(tag, "content");
      if (mediaUrl) break;
    }
  }

  if (!mediaUrl) {
    throw new Error("Tenor page did not contain a GIF image URL");
  }

  localKissGifUrlCache.set(sourceUrl, mediaUrl);
  return mediaUrl;
}

function getLocalSonGifSources() {
  if (localSonGifSources) return localSonGifSources;

  try {
    localSonGifSources = fs
      .readFileSync(LOCAL_SON_GIFS_FILE, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^https?:\/\//i.test(line));
  } catch (err) {
    console.error("[local son GIFs] Could not read songifs file:", err.message);
    localSonGifSources = [];
  }

  return localSonGifSources;
}

async function resolveLocalSonGif(sourceUrl) {
  if (localSonGifUrlCache.has(sourceUrl)) {
    return localSonGifUrlCache.get(sourceUrl);
  }

  // songifs may contain direct media URLs as well as Tenor page URLs.
  if (!/tenor\.com\//i.test(sourceUrl)) {
    localSonGifUrlCache.set(sourceUrl, sourceUrl);
    return sourceUrl;
  }

  const response = await axios.get(sourceUrl, {
    timeout: 8000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const metaTags = response.data.match(/<meta\b[^>]*>/gi) || [];
  let mediaUrl = null;

  for (const tag of metaTags) {
    const property =
      getHtmlAttribute(tag, "property") || getHtmlAttribute(tag, "name");
    if (
      property?.toLowerCase() === "og:image" ||
      property?.toLowerCase() === "twitter:image"
    ) {
      mediaUrl = getHtmlAttribute(tag, "content");
      if (mediaUrl) break;
    }
  }

  if (!mediaUrl) {
    throw new Error("Tenor page did not contain a GIF image URL");
  }

  localSonGifUrlCache.set(sourceUrl, mediaUrl);
  return mediaUrl;
}

function getLocalThinkGifSources() {
  if (localThinkGifSources) return localThinkGifSources;

  try {
    localThinkGifSources = fs
      .readFileSync(LOCAL_THINK_GIFS_FILE, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^https?:\/\//i.test(line));
  } catch (err) {
    console.error("[local think GIFs] Could not read think file:", err.message);
    localThinkGifSources = [];
  }

  return localThinkGifSources;
}

async function resolveLocalThinkGif(sourceUrl) {
  if (localThinkGifUrlCache.has(sourceUrl)) {
    return localThinkGifUrlCache.get(sourceUrl);
  }

  // think may contain direct media URLs as well as Tenor page URLs.
  if (!/tenor\.com\//i.test(sourceUrl)) {
    localThinkGifUrlCache.set(sourceUrl, sourceUrl);
    return sourceUrl;
  }

  const response = await axios.get(sourceUrl, {
    timeout: 8000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const metaTags = response.data.match(/<meta\b[^>]*>/gi) || [];
  let mediaUrl = null;

  for (const tag of metaTags) {
    const property =
      getHtmlAttribute(tag, "property") || getHtmlAttribute(tag, "name");
    if (
      property?.toLowerCase() === "og:image" ||
      property?.toLowerCase() === "twitter:image"
    ) {
      mediaUrl = getHtmlAttribute(tag, "content");
      if (mediaUrl) break;
    }
  }

  if (!mediaUrl) {
    throw new Error("Tenor page did not contain a GIF image URL");
  }

  localThinkGifUrlCache.set(sourceUrl, mediaUrl);
  return mediaUrl;
}

async function fetchLocalKissGif() {
  const sources = getLocalKissGifSources();
  if (!sources.length) return null;

  const shuffled = [...sources].sort(() => Math.random() - 0.5);
  for (const sourceUrl of shuffled) {
    try {
      return await resolveLocalKissGif(sourceUrl);
    } catch (err) {
      console.error(`[local kiss GIFs] Could not resolve ${sourceUrl}:`, err.message);
    }
  }

  return null;
}

async function fetchLocalSonGif() {
  const sources = getLocalSonGifSources();
  if (!sources.length) return null;

  const shuffled = [...sources].sort(() => Math.random() - 0.5);
  for (const sourceUrl of shuffled) {
    try {
      return await resolveLocalSonGif(sourceUrl);
    } catch (err) {
      console.error(`[local son GIFs] Could not resolve ${sourceUrl}:`, err.message);
    }
  }

  return null;
}

async function fetchLocalThinkGif() {
  const sources = getLocalThinkGifSources();
  if (!sources.length) return null;

  const shuffled = [...sources].sort(() => Math.random() - 0.5);
  for (const sourceUrl of shuffled) {
    try {
      return await resolveLocalThinkGif(sourceUrl);
    } catch (err) {
      console.error(`[local think GIFs] Could not resolve ${sourceUrl}:`, err.message);
    }
  }

  return null;
}

async function fetchRoleplayGif(commandName, apiAction) {
  if (commandName === "kiss") {
    // /kiss is intentionally restricted to the URLs in ./gifs. Never use
    // the Otaku GIF API for this command.
    return fetchLocalKissGif();
  }
  return fetchRpGif(apiAction);
}

// ── EMOTION GIF FETCHER ──
// Maps command name → otakugifs reaction name (angry → mad, etc.)
const EMOTION_API_MAP = {
  happy: "happy",
  angry: "mad",
  sad: "sad",
  cry: "cry",
  laugh: "laugh",
  dance: "dance",
  wave: "wave",
  sleep: "sleep",
  blush: "blush",
  smile: "smile",
  wink: "wink",
};

async function fetchEmotionGif(emotion) {
  // /son is intentionally restricted to the URLs in ./songifs. Never use
  // the Otaku GIF API for this command.
  if (emotion === "son") return fetchLocalSonGif();
  // /think is intentionally restricted to the URLs in ./think. Never use
  // the Otaku GIF API for this command.
  if (emotion === "think") return fetchLocalThinkGif();

  const reaction = EMOTION_API_MAP[emotion] || emotion;
  try {
    return await fetchOtakuGif(reaction);
  } catch (err) {
    console.error(
      `[fetchEmotionGif] otakugifs failed for ${reaction}:`,
      err.message,
    );
  }
  return null;
}

// Discord does not always render third-party GIF URLs reliably, especially in
// DMs. Download the GIF first and attach it to the response so the embed can
// reference a Discord-hosted attachment.
async function attachGifToEmbed(embed, gifUrl, filename = "reaction.gif") {
  if (!gifUrl) return [];

  try {
    const gifBytes = await downloadImageBytes(gifUrl, {
      timeout: 10000,
      retries: 1,
    });
    if (gifBytes && gifBytes !== "EXPIRED") {
      embed.setImage(`attachment://${filename}`);
      return [new AttachmentBuilder(gifBytes, { name: filename })];
    }

    // Keep the remote URL as a last-resort fallback if the source temporarily
    // refuses the bot's download request.
    embed.setImage(gifUrl);
  } catch (err) {
    console.error("[attachGifToEmbed] GIF attachment failed:", err.message);
  }
  return [];
}

// ── GIPHY SEARCH-BASED RANDOM GIF FETCHER ──
// Pulls a random gif from a Giphy search for `query`, using the "search + random offset"
// trick (Giphy's own /random endpoint often ignores multi-word tags, so this is more reliable).
const GIPHY_SEARCH_CACHE = {}; // query -> { urls: [...], fetchedAt: timestamp }
const GIPHY_CACHE_TTL_MS = 10 * 60 * 1000; // refresh the pool every 10 minutes

async function fetchGiphySearchGif(query) {
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) return null;

  const cached = GIPHY_SEARCH_CACHE[query];
  const isFresh = cached && Date.now() - cached.fetchedAt < GIPHY_CACHE_TTL_MS;

  try {
    let urls;
    if (isFresh) {
      urls = cached.urls;
    } else {
      const res = await axios.get("https://api.giphy.com/v1/gifs/search", {
        params: {
          api_key: apiKey,
          q: query,
          limit: 50,
          rating: "pg-13",
          lang: "en",
        },
        timeout: 8000,
      });
      urls = (res.data?.data || [])
        .map((g) => g.images?.original?.url || g.images?.downsized?.url)
        .filter(Boolean);
      if (urls.length)
        GIPHY_SEARCH_CACHE[query] = { urls, fetchedAt: Date.now() };
    }
    if (!urls || !urls.length) return null;
    return urls[Math.floor(Math.random() * urls.length)];
  } catch (err) {
    console.error(
      `[fetchGiphySearchGif] search failed for "${query}":`,
      err.message,
    );
    return null;
  }
}

const EMOTION_CMDS = {
  son: {
    color: 0x2f3542,
    emoji: "😭😭😭",
    label: "son",
    defaultMsg: (name) => `**${name}**: SON 😭😭😭😭😭`,
  },
  happy: {
    color: 0xffeaa7,
    emoji: "😄",
    label: "happy",
    defaultMsg: (name) => `**${name}** is feeling happy!`,
  },
  angry: {
    color: 0xff7675,
    emoji: "😡",
    label: "angry",
    defaultMsg: (name) => `**${name}** is feeling angry!`,
  },
  sad: {
    color: 0x74b9ff,
    emoji: "😢",
    label: "sad",
    defaultMsg: (name) => `**${name}** is feeling sad...`,
  },
  cry: {
    color: 0x0984e3,
    emoji: "😭",
    label: "cry",
    defaultMsg: (name) => `**${name}** is crying!`,
  },
  laugh: {
    color: 0xfdcb6e,
    emoji: "😂",
    label: "laugh",
    defaultMsg: (name) => `**${name}** is laughing!`,
  },
  dance: {
    color: 0xa29bfe,
    emoji: "💃",
    label: "dance",
    defaultMsg: (name) => `**${name}** is dancing!`,
  },
  wave: {
    color: 0x55efc4,
    emoji: "👋",
    label: "wave",
    defaultMsg: (name) => `**${name}** waves hello!`,
  },
  sleep: {
    color: 0x6c5ce7,
    emoji: "😴",
    label: "sleep",
    defaultMsg: (name) => `**${name}** is sleeping... 😴`,
  },
  blush: {
    color: 0xff7979,
    emoji: "😊",
    label: "blush",
    defaultMsg: (name) => `**${name}** is blushing! 😊`,
  },
  smile: {
    color: 0xffd32a,
    emoji: "😊",
    label: "smile",
    defaultMsg: (name) => `**${name}** is smiling!`,
  },
  wink: {
    color: 0xf9ca24,
    emoji: "😉",
    label: "wink",
    defaultMsg: (name) => `**${name}** winks! 😉`,
  },
  think: {
    color: 0xa29bfe,
    emoji: "🤔",
    label: "think",
    defaultMsg: (name) => `**${name}** is thinking... 🤔`,
  },
};

// ── JAIL SYSTEM ──
const JAIL_ROLE_NAME = "سجن";

async function getOrCreateJailRole(guild) {
  const cfg = loadConfig();
  cfg.jail = cfg.jail || {};
  let role = cfg.jail.roleId ? guild.roles.cache.get(cfg.jail.roleId) : null;
  if (!role) role = guild.roles.cache.find((r) => r.name === JAIL_ROLE_NAME);
  if (!role) {
    role = await guild.roles.create({
      name: JAIL_ROLE_NAME,
      colors: { primaryColor: 0x2f3542 },
      reason: "Jail role auto-created",
    });
  }
  if (cfg.jail.roleId !== role.id) {
    cfg.jail.roleId = role.id;
    saveConfig(cfg);
  }
  return role;
}

function canManageJail(member, cfg) {
  if (member.guild.ownerId === member.id) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  // التحقق من الرتب المسموح لها في إعدادات السجن الخاصة
  const jailAllowedRoleId = cfg.jail?.allowedRoleId;
  if (jailAllowedRoleId && member.roles.cache.has(jailAllowedRoleId))
    return true;

  // التحقق من الرتب المسموح لها في إعدادات الأوامر العامة (botConfig.json -> commands -> سجن)
  const cmdAllowedRoles = cfg.commands?.["سجن"]?.allowedRoles;
  if (cmdAllowedRoles && Array.isArray(cmdAllowedRoles)) {
    if (member.roles.cache.some((role) => cmdAllowedRoles.includes(role.id)))
      return true;
  }

  return false;
}

async function applyJailOverwrites(guild, jailRole, jailChannelId) {
  const channels = guild.channels.cache.filter((c) => c.permissionOverwrites);
  for (const [, channel] of channels) {
    const shouldView = channel.id === jailChannelId;
    await channel.permissionOverwrites
      .edit(jailRole, { ViewChannel: shouldView })
      .catch(() => {});
  }
}

// ── GIVEAWAY SYSTEM ──
const activeGiveaways = new Map(); // messageId → { prize, winners, entries, endsAt, channelId, guildId, hostId }
const completedGiveaways = new Map();
async function initGiveaways() {
  const loaded = await db.loadGiveaways();
  for (const [id, value] of loaded.active) activeGiveaways.set(id, value);
  for (const [id, value] of loaded.completed) completedGiveaways.set(id, value);
  for (const [id, value] of activeGiveaways) {
    const delay = Math.max(0, Number(value.endsAt) - Date.now());
    setTimeout(() => endGiveaway(id).catch(err => console.error('[Giveaway] Recovery end failed:', err.message)), delay).unref?.();
  }
  console.log(`[Giveaway] Loaded ${activeGiveaways.size} active and ${completedGiveaways.size} completed giveaway(s) from Turso.`);
}
async function saveCompletedGiveaway(messageId, value) {
  await db.saveGiveaway(messageId, value, 'completed');
}
const pendingProfileAvatar = new Map(); // `${guildId}:${userId}` → avatarUrl (waiting for banner)
const pendingProfilePreview = new Map(); // `${guildId}:${userId}` → { avatarUrl, bannerUrl }
const profileDownloadData = new Map(); // downloadId → { avatarUrl, bannerUrl }
const mediaDownloadCooldown = new Map(); // userId → آخر وقت استخدم فيه تحميل الفيديو

function buildGiveawayEmbed(g, ended = false, winnersList = []) {
  const endUnix = Math.floor(g.endsAt / 1000);
  const winnerLine = ended && winnersList.length
    ? `\nWinner${winnersList.length === 1 ? "" : "s"}: ${winnersList.map((id) => `<@${id}>`).join(", ")}`
    : ended ? "\nWinner: No one entered"
    : "";
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(String(g.prize).slice(0, 256))
    .setDescription(`Ends: <t:${endUnix}:R> (<t:${endUnix}:F>)\nHosted by: <@${g.hostId}>\nEntries: ${g.entries.size}\nWinners: ${g.winners}${winnerLine}`)
    .setTimestamp(g.endsAt);
}

async function endGiveaway(messageId) {
  const g = activeGiveaways.get(messageId);
  if (!g) return;
  activeGiveaways.delete(messageId);
  try {
    const channel = await client.channels.fetch(g.channelId);
    const msg = await channel.messages.fetch(messageId);
    const entries = [...g.entries];
    const winnersList = entries.sort(() => Math.random() - 0.5).slice(0, Math.min(g.winners, entries.length));
    const endedEmbed = buildGiveawayEmbed(g, true, winnersList).setFooter({ text: winnersList.length ? "Giveaway ended" : "Giveaway ended — no entries" });
    const completed = { prize: g.prize, winners: g.winners, entries: new Set(entries), endsAt: g.endsAt, channelId: g.channelId, guildId: g.guildId, hostId: g.hostId, hostUsername: g.hostUsername, lastWinners: winnersList, rerolls: 0 };
    completedGiveaways.set(messageId, completed);
    await saveCompletedGiveaway(messageId, completed);
    await msg.edit({ __legacyEmbed: true, embeds: [endedEmbed], components: [], allowedMentions: { parse: [], roles: [], repliedUser: false } });
    if (winnersList.length) await channel.send({ content: `🎉 Congratulations ${winnersList.map((id) => `<@${id}>`).join(", ")}! You won **${g.prize}**!`, allowedMentions: { users: winnersList } });
  } catch (err) {
    console.error("Giveaway end error:", err?.code === 10008 || err?.code === 10003 ? `Message/channel deleted: ${err.message}` : (err.stack || err.message));
  }
}
async function loadWarnings() {
  try {
    return await db.loadWarnings();
  } catch (err) {
    console.error("[loadWarnings]", err.message);
    return {};
  }
}

async function saveWarnings(data) {
  try {
    await db.saveWarnings(data);
  } catch (err) {
    console.error("[saveWarnings]", err.message);
  }
}

async function loadData() {
  try {
    return await db.loadData();
  } catch (err) {
    console.error("[loadData]", err.message);
    return {};
  }
}

async function saveData(data) {
  try {
    await db.saveData(data);
  } catch (err) {
    console.error("[saveData]", err.message);
  }
}

function getLevelInfo(totalXp) {
  let level = 0,
    xp = totalXp;
  while (xp >= 5 * level * level + 50 * level + 100) {
    xp -= 5 * level * level + 50 * level + 100;
    level++;
  }
  return { level };
}

const afkNoticeCooldown = new Map();

function formatAfkDuration(ms) {
  const totalMinutes = Math.max(0, Math.floor(Number(ms || 0) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || !parts.length) parts.push(`${minutes}m`);
  return parts.join(' ');
}

async function handleAfkMessage(message) {
  if (!message.guild || message.author.bot) return;
  try {
    const ownState = await db.getAfkState(message.guildId, message.author.id);
    if (ownState) {
      const cleared = await db.clearAfkState(message.guildId, message.author.id);
      const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
      if (member) await member.setNickname(cleared?.nickname ?? null, 'AFK ended when member sent a message').catch(() => {});
      const mentionCount = Number(cleared?.mentions_count || 0);
      const notice = await message.channel.send(
        `👋 ${message.author} عاد من وضع AFK بعد **${formatAfkDuration(Date.now() - Number(cleared?.since || Date.now()))}**${mentionCount ? ` وتم منشنه **${mentionCount}** مرة` : ''}.`,
      ).catch(() => null);
      if (notice) setTimeout(() => notice.delete().catch(() => {}), 8000);
    }

    const mentionedIds = [...message.mentions.users.values()]
      .filter((user) => !user.bot && user.id !== message.author.id)
      .map((user) => user.id)
      .slice(0, 10);
    if (!mentionedIds.length) return;
    const states = await db.getAfkStates(message.guildId, mentionedIds);
    for (const userId of mentionedIds) {
      const state = states.get(userId);
      if (!state) continue;
      await db.incrementAfkMention(message.guildId, userId).catch(() => {});
      const key = `${message.guildId}:${userId}`;
      const now = Date.now();
      if (now - (afkNoticeCooldown.get(key) || 0) < 15000) continue;
      afkNoticeCooldown.set(key, now);
      const notice = await message.channel.send(
        `💤 <@${userId}> في وضع AFK: **${state.reason || 'AFK'}** (منذ ${formatAfkDuration(now - Number(state.since || now))}).`,
      ).catch(() => null);
      if (notice) setTimeout(() => notice.delete().catch(() => {}), 10000);
    }
  } catch (err) {
    console.error('[AFK message handler]', err.message);
  }
}

function checkPermission(cmdName, member, channelId = null) {
  const cfg = loadConfig();
  const cmd = cfg.commands?.[cmdName];
  if (!cmd) return true;
  if (!cmd.enabled) return false;

  // In DMs member is null — skip all guild-specific checks
  if (!member) return true;

  // Se l'utente è il proprietario del server o ha il permesso di Amministratore, ha sempre accesso
  if (member.guild.ownerId === member.id) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  // Mappatura dei permessi nativi di Discord necessari per i comandi di moderazione
  const nativePermsMap = {
    ban: PermissionFlagsBits.BanMembers,
    unban: PermissionFlagsBits.BanMembers,
    kick: PermissionFlagsBits.KickMembers,
    mute: PermissionFlagsBits.ModerateMembers,
    unmute: PermissionFlagsBits.ModerateMembers,
    warn: PermissionFlagsBits.ModerateMembers,
    warnings: PermissionFlagsBits.ModerateMembers,
    clearwarns: PermissionFlagsBits.ModerateMembers,
    giverole: PermissionFlagsBits.ManageRoles,
    removerole: PermissionFlagsBits.ManageRoles,
    deletemsg: PermissionFlagsBits.ManageMessages,
  };

  // Se l'utente ha il permesso nativo di Discord per questo comando, permetti l'accesso
  if (
    nativePermsMap[cmdName] &&
    member.permissions.has(nativePermsMap[cmdName])
  ) {
    return true;
  }

  const memberRoleIds = member.roles.cache.map((r) => r.id);

  if (cmd.blockedRoles?.length) {
    if (memberRoleIds.some((id) => cmd.blockedRoles.includes(id))) return false;
  }
  if (cmd.allowedRoles?.length) {
    if (!memberRoleIds.some((id) => cmd.allowedRoles.includes(id)))
      return false;
  }
  if (channelId && cmd.allowedChannels?.length) {
    if (!cmd.allowedChannels.includes(channelId)) return false;
  }

  return true;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.GuildMember, Partials.User],
});

// Track known boost states so startup/member refresh events cannot replay an old boost.
const knownBoostStates = new Map();

installComponentV2Transport(client);
attachRelayReactionCleanup(client);

// ── REACTION ROLES ────────────────────────────────────────────────────────────
// Reaction-role messages are stored by message ID because one saved embed can
// be sent more than once. The dashboard creates this mapping when it sends one.
function reactionRoleEmojiKey(emoji) {
  if (!emoji) return "";
  if (emoji.id) return emoji.id;
  return emoji.name || "";
}

function configuredEmojiKey(value) {
  const custom = String(value || "").match(/^<a?:[^:>]+:(\d+)>$/);
  return custom ? custom[1] : String(value || "");
}

async function handleReactionRole(reaction, user, added) {
  if (user?.bot) return;
  if (reaction.partial) await reaction.fetch();
  const message = reaction.message;
  if (message.partial) await message.fetch();

  const mapping = loadConfig().reactionRoleMessages?.[message.id];
  if (!mapping || !message.guild) return;

  const emojiKey = reactionRoleEmojiKey(reaction.emoji);
  const rule = (mapping.reactions || []).find(
    (entry) => configuredEmojiKey(entry.emoji) === emojiKey,
  );
  if (!rule) return;

  const role = message.guild.roles.cache.get(rule.roleId)
    || await message.guild.roles.fetch(rule.roleId).catch(() => null);
  if (!role) {
    console.error(`[reaction role] role ${rule.roleId} was not found`);
    return;
  }

  const member = message.guild.members.cache.get(user.id)
    || await message.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  try {
    if (added) {
      await member.roles.add(role, "Reaction role selected");
    } else {
      await member.roles.remove(role, "Reaction role deselected");
    }
  } catch (err) {
    console.error(`[reaction role] failed to ${added ? "add" : "remove"} ${role.name}:`, err.message);
  }
}

client.on(Events.MessageReactionAdd, (reaction, user) =>
  handleReactionRole(reaction, user, true).catch((err) =>
    console.error("[reaction role add]", err.message),
  ),
);
client.on(Events.MessageReactionRemove, (reaction, user) =>
  handleReactionRole(reaction, user, false).catch((err) =>
    console.error("[reaction role remove]", err.message),
  ),
);

// ── VOICE XP SYSTEM ──────────────────────────────────────────────────────────
const voiceXpTimers = new Map(); // `${guildId}:${userId}` → intervalId
const voiceAnalyticsSessions = new Map(); // `${guildId}:${userId}` → { startedAt, channelId, channelName }
// VOICE_XP_MS and VOICE_XP_GAIN are now read from config (xp.voiceXpInterval, xp.voiceXpGain)

async function syncLevelRole(guild, userId, level, xpCfg, reason = "Level role sync") {
  const mappings = xpCfg?.levelRoles;
  if (!mappings || typeof mappings !== "object") return;
  const eligibleEntries = Object.entries(mappings)
    .map(([lvl, roleId]) => ({ level: Number.parseInt(lvl, 10), roleId: String(roleId || "") }))
    .filter(({ level: entryLevel, roleId }) => Number.isFinite(entryLevel) && entryLevel <= Number(level) && roleId);
  const highestEntry = eligibleEntries.reduce(
    (highest, entry) => (!highest || entry.level > highest.level ? entry : highest),
    null,
  );
  if (!highestEntry) return;

  const member = await guild.members.fetch(userId).catch((err) => {
    console.error(`[LevelRoles] Could not fetch member ${userId}:`, err.message);
    return null;
  });
  if (!member) return;
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const botTopPosition = botMember?.roles?.highest?.position ?? -1;
  const configuredRoleIds = [...new Set(Object.values(mappings).filter(Boolean).map(String))];
  const roles = new Map();
  for (const roleId of configuredRoleIds) {
    const role = await guild.roles.fetch(roleId).catch((err) => {
      console.error(`[LevelRoles] Could not fetch role ${roleId}:`, err.message);
      return null;
    });
    if (role) roles.set(role.id, role);
  }
  const targetRole = roles.get(highestEntry.roleId);
  if (!targetRole) return;
  if (targetRole.managed || targetRole.position >= botTopPosition) {
    console.error(`[LevelRoles] Cannot manage ${targetRole.name} (${targetRole.id}); role position=${targetRole.position}, bot position=${botTopPosition}`);
    return;
  }

  const lowerRoles = [...roles.values()].filter(
    (role) => role.id !== targetRole.id && role.position < targetRole.position && member.roles.cache.has(role.id),
  );
  if (lowerRoles.length) {
    await member.roles.remove(lowerRoles, `${reason}: remove lower level roles`).catch((err) => {
      console.error(`[LevelRoles] Failed removing lower roles from ${member.user.tag}:`, err.message);
    });
  }
  if (!member.roles.cache.has(targetRole.id)) {
    await member.roles.add(targetRole, reason).then(() => {
      console.log(`[LevelRoles] Granted ${targetRole.name} to ${member.user.tag} at level ${level}`);
    }).catch((err) => {
      console.error(`[LevelRoles] Failed granting ${targetRole.name} to ${member.user.tag}:`, err.message);
    });
  }
}

function parseXpLevelUpColor(value) {
  const hex = String(value || '').replace('#', '');
  return /^[0-9a-f]{6}$/i.test(hex) ? parseInt(hex, 16) : 0x5865f2;
}

function buildXpLevelUpMessage(xpCfg, userId, level, isVoice = false) {
  const fallback = isVoice
    ? '🎤 {user} وصلت للمستوى {level} بالصوت!'
    : 'شطورر! {user} <:1nk:1522692892936769819> وصلت للمستوى {level}';
  const configured = isVoice ? (xpCfg.voiceLevelUpMessage || xpCfg.levelUpMessage) : xpCfg.levelUpMessage;
  const text = String(configured || fallback)
    .replaceAll('{user}', `<@${userId}>`)
    .replaceAll('{level}', String(level));
  const allowedMentions = { users: [userId] };
  if (xpCfg.levelUpMessageFormat === 'embed') {
    const embed = new EmbedBuilder()
      .setColor(parseXpLevelUpColor(xpCfg.levelUpMessageColor))
      .setDescription(text);
    if (xpCfg.levelUpMessageImage) embed.setImage(xpCfg.levelUpMessageImage);
    return { embeds: [embed], allowedMentions };
  }
  return { content: text, allowedMentions };
}

async function handleVoiceLevelUp(guild, userId, result) {
  if (!result?.leveledUp) return;
  const xpCfg = loadConfig().xp || {};
  const levelUpPayload = buildXpLevelUpMessage(xpCfg, userId, result.newLevel, true);
  const ch = xpCfg.levelUpChannel
    ? guild.channels.cache.get(xpCfg.levelUpChannel)
    : null;
  if (ch) ch.send(levelUpPayload).catch(() => {});
  if (xpCfg.voiceLevelRoles) {
    const member = guild.members.cache.get(userId);
    if (member) {
      const toGrant = Object.entries(xpCfg.voiceLevelRoles)
        .filter(([lvl]) => parseInt(lvl) <= result.newLevel)
        .map(([, rid]) => rid)
        .filter((rid) => !member.roles.cache.has(rid));
      if (toGrant.length) member.roles.add(toGrant).catch(() => {});
    }
  }
}

function startVoiceXp(guildId, userId, username, guild) {
  const key = `${guildId}:${userId}`;
  if (voiceXpTimers.has(key)) return;
  const xpCfg = loadConfig().xp || {};
  const gainPerInterval = Math.max(1, parseInt(xpCfg.voiceXpGain) || 10);
  const intervalMs = Math.max(
    10_000,
    (parseInt(xpCfg.voiceXpInterval) || 1) * 60_000,
  );
  const timer = setInterval(async () => {
    try {
      const member = guild.members.cache.get(userId);
      if (!member?.voice?.channelId) {
        stopVoiceXp(guildId, userId);
        return;
      }
      if (guild.afkChannelId && member.voice.channelId === guild.afkChannelId)
        return;
      const result = await addVoiceXp(
        guildId,
        userId,
        username,
        gainPerInterval,
      );
      await handleVoiceLevelUp(guild, userId, result);
    } catch (err) {
      console.error("[voiceXp]", err.message);
    }
  }, intervalMs);
  voiceXpTimers.set(key, timer);
}

function stopVoiceXp(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const t = voiceXpTimers.get(key);
  if (t) {
    clearInterval(t);
    voiceXpTimers.delete(key);
  }
}

// Track all users already in voice when bot starts/reconnects
function syncVoiceXpOnReady(c) {
  for (const [, guild] of c.guilds.cache) {
    for (const [, member] of guild.members.cache) {
      if (
        !member.user.bot &&
        member.voice?.channelId &&
        member.voice.channelId !== guild.afkChannelId
      ) {
        startVoiceXp(guild.id, member.id, member.user.username, guild);
      }
    }
  }
}

// VoiceStateUpdate — user voice XP tracking
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const user = newState.member?.user || oldState.member?.user;
  if (!user || user.bot) return;
  const guild = newState.guild || oldState.guild;
  const guildId = guild.id;
  const sessionKey = `${guildId}:${user.id}`;
  const endVoiceAnalyticsSession = (channelId) => {
    const session = voiceAnalyticsSessions.get(sessionKey);
    if (!session) return;
    voiceAnalyticsSessions.delete(sessionKey);
    const seconds = Math.max(0, Math.round((Date.now() - session.startedAt) / 1000));
    if (seconds > 0) db.recordAnalyticsEvent?.({
      guildId,
      eventType: 'voice_session',
      userId: user.id,
      username: user.username,
      channelId: session.channelId || channelId || '',
      channelName: session.channelName || '',
      value: seconds,
    });
  };
  const joined = !oldState.channelId && !!newState.channelId;
  const left = !!oldState.channelId && !newState.channelId;
  const moved =
    oldState.channelId &&
    newState.channelId &&
    oldState.channelId !== newState.channelId;

  if (joined || moved) {
    // Stop old timer if moving between channels, then start fresh
    stopVoiceXp(guildId, user.id);
    if (oldState.channelId) endVoiceAnalyticsSession(oldState.channelId);
    if (newState.channelId !== guild.afkChannelId) {
      startVoiceXp(guildId, user.id, user.username, guild);
      voiceAnalyticsSessions.set(sessionKey, {
        startedAt: Date.now(),
        channelId: newState.channelId,
        channelName: newState.channel?.name || newState.channelId,
      });
    }
  } else if (left) {
    stopVoiceXp(guildId, user.id);
    endVoiceAnalyticsSession(oldState.channelId);
  }
});
// ── INVITE SYSTEM ──────────────────────────────────────────────────────────────
const INVITE_GUILD_ID = '1374859719046463569';
const inviteSnapshots = new Map();

async function snapshotInviteGuild(guild) {
  try {
    const invites = await guild.invites.fetch();
    const rows = [];
    const snapshot = new Map();
    invites.forEach((invite) => {
      const data = {
        uses: Number(invite.uses || 0),
        inviterId: invite.inviter?.id || null,
        channelId: invite.channel?.id || null,
      };
      snapshot.set(invite.code, data);
      rows.push({ code: invite.code, ...data });
    });
    inviteSnapshots.set(guild.id, snapshot);
    await db.upsertInviteCodes(guild.id, rows).catch((err) => console.error('[Invites] cache save:', err.message));
    return snapshot;
  } catch (err) {
    console.error(`[Invites] Could not fetch invites for ${guild.name}:`, err.message);
    return inviteSnapshots.get(guild.id) || new Map();
  }
}

async function initInviteTracking(c) {
  for (const guild of c.guilds.cache.values()) {
    if (guild.id === INVITE_GUILD_ID) await snapshotInviteGuild(guild);
  }
}

async function attributeInviteJoin(member) {
  if (!member?.guild || member.guild.id !== INVITE_GUILD_ID || member.user.bot) return;
  const before = inviteSnapshots.get(member.guild.id) || new Map();
  const after = await snapshotInviteGuild(member.guild);
  let usedCode = null;
  let usedData = null;
  for (const [code, data] of after.entries()) {
    const oldUses = Number(before.get(code)?.uses || 0);
    if (Number(data.uses || 0) > oldUses) {
      usedCode = code;
      usedData = data;
      break;
    }
  }
  if (!usedCode) {
    console.warn(`[Invites] Could not identify the invite used by ${member.user.tag}.`);
    return;
  }
  const stored = await db.getInviteCode(member.guild.id, usedCode).catch(() => null);
  const inviterId = stored?.inviter_id || usedData?.inviterId || null;
  if (!inviterId || inviterId === member.id) return;
  await db.recordInviteJoin(member.guild.id, member.id, member.user.username, inviterId, usedCode);
  await syncInviteRewardRoles(member.guild, inviterId);
  await refreshInvitePanel(member.guild);
  console.log(`[Invites] ${member.user.tag} joined through ${usedCode} by ${inviterId}.`);
}

async function getInviteRewardRole(guild, inviterId) {
  const cfg = loadConfig().inviteSystem || {};
  const count = await db.getInviteCount(guild.id, inviterId);
  const rewards = (Array.isArray(cfg.rewards) ? cfg.rewards : [])
    .map((reward) => ({ threshold: Math.max(0, Number(reward.threshold) || 0), roleId: String(reward.roleId || ''), label: reward.label || '' }))
    .filter((reward) => reward.roleId)
    .sort((a, b) => b.threshold - a.threshold);
  const eligible = rewards.find((reward) => count >= reward.threshold) || null;
  return { count, rewards, eligible };
}

async function syncInviteRewardRoles(guild, inviterId) {
  const cfg = loadConfig().inviteSystem || {};
  if (!cfg.enabled || guild.id !== INVITE_GUILD_ID || !inviterId) return null;
  const member = await guild.members.fetch(inviterId).catch(() => null);
  if (!member || member.user.bot) return null;
  const { count, rewards, eligible } = await getInviteRewardRole(guild, inviterId);
  const configuredIds = new Set(rewards.map((reward) => reward.roleId));
  for (const reward of rewards) {
    const role = await guild.roles.fetch(reward.roleId).catch(() => null);
    if (!role || role.managed) continue;
    try {
      if (eligible?.roleId === reward.roleId) {
        if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Invite reward tier reached');
      } else if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role, 'Invite reward tier no longer reached');
      }
    } catch (err) {
      console.warn(`[Invites] Reward update failed for ${member.user.tag}:`, err.message);
    }
  }
  return { count, eligible, configuredIds };
}

function inviteInfoEmbed(title, description, color = 0x2ecc71) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
}

async function refreshInvitePanel(guild) {
  const cfg = loadConfig().inviteSystem || {};
  if (!cfg.enabled || guild?.id !== INVITE_GUILD_ID || !cfg.channelId || !cfg.panelMessageId) return;
  const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
  const message = channel?.messages ? await channel.messages.fetch(cfg.panelMessageId).catch(() => null) : null;
  if (!message) return;
  const parseColor = (value) => {
    const hex = String(value || '').replace('#', '');
    return /^[0-9a-f]{6}$/i.test(hex) ? parseInt(hex, 16) : 0x2ecc71;
  };
  const embed = new EmbedBuilder()
    .setColor(parseColor(cfg.embedColor))
    .setTitle(String(cfg.embedTitle || 'نظام الدعوات').slice(0, 256))
    .setDescription(String(cfg.embedDescription || '').slice(0, 4096))
    .setFooter({ text: 'ادعُ أصدقاءك واحصل على مكافآت الدعوات' });
  if (cfg.imageUrl) embed.setImage(cfg.imageUrl);
  const labels = cfg.buttonLabels || {};
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('invite_link').setLabel(String(labels.link || '🔗 رابطك الخاص').slice(0, 80)).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('invite_mine').setLabel(String(labels.mine || '📊 دعواتي').slice(0, 80)).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('invite_joiners').setLabel(String(labels.joiners || '👤 من دخل من رابطي').slice(0, 80)).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('invite_top').setLabel(String(labels.top || '🏆 توب الدعوات').slice(0, 80)).setStyle(ButtonStyle.Danger),
  );
  await message.edit({ embeds: [embed], components: [row] }).catch((err) => console.warn('[Invites] Panel refresh failed:', err.message));
}

async function handleInviteButton(interaction) {
  if (!interaction.guild || interaction.guild.id !== INVITE_GUILD_ID) {
    return interaction.reply({ content: '❌ هذا النظام يعمل داخل سيرفر Jura فقط.', flags: MessageFlags.Ephemeral });
  }
  const cfg = loadConfig().inviteSystem || {};
  const memberId = interaction.user.id;
  if (interaction.customId === 'invite_link') {
    const channel = cfg.channelId
      ? await interaction.guild.channels.fetch(cfg.channelId).catch(() => null)
      : interaction.channel;
    if (!channel || typeof channel.createInvite !== 'function') {
      return interaction.reply({ content: '❌ لا أستطيع إنشاء رابط دعوة من القناة المحددة.', flags: MessageFlags.Ephemeral });
    }
    const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: `Invite link requested by ${interaction.user.tag}` }).catch(() => null);
    if (!invite) return interaction.reply({ content: '❌ فشل إنشاء رابط الدعوة. تأكد من صلاحية Create Instant Invite.', flags: MessageFlags.Ephemeral });
    await db.upsertInviteCodes(interaction.guild.id, [{ code: invite.code, inviterId: memberId, channelId: channel.id, uses: 0 }]).catch(() => {});
    const current = inviteSnapshots.get(interaction.guild.id) || new Map();
    current.set(invite.code, { uses: 0, inviterId: memberId, channelId: channel.id });
    inviteSnapshots.set(interaction.guild.id, current);
    return interaction.reply({ embeds: [inviteInfoEmbed('🔗 رابط دعوتك الخاص', `استخدم هذا الرابط لدعوة أصدقائك:\n\n${invite.url}\n\nتُحسب الدعوة عندما يدخل عضو جديد من الرابط.`)], flags: MessageFlags.Ephemeral });
  }
  if (interaction.customId === 'invite_mine') {
    const reward = await syncInviteRewardRoles(interaction.guild, memberId);
    const count = reward?.count ?? await db.getInviteCount(interaction.guild.id, memberId);
    const tier = reward?.eligible ? `\nالرتبة الحالية: **${reward.eligible.label || reward.eligible.roleId}**` : '\nلم تصل إلى رتبة مكافأة بعد.';
    return interaction.reply({ embeds: [inviteInfoEmbed('📊 دعواتي', `إجمالي الدعوات المحتسبة: **${count}**${tier}`)], flags: MessageFlags.Ephemeral });
  }
  if (interaction.customId === 'invite_joiners') {
    const rows = await db.getInviteJoiners(interaction.guild.id, memberId, 50);
    const description = rows.length
      ? rows.map((row, index) => `${index + 1}. <@${row.member_id}> — <t:${Math.floor(Number(row.joined_at || 0) / 1000)}:R>`).join('\n')
      : 'لم يدخل أي عضو من رابطك حتى الآن.';
    return interaction.reply({ embeds: [inviteInfoEmbed('👤 من دخل من رابطي', description.slice(0, 4096))], flags: MessageFlags.Ephemeral });
  }
  if (interaction.customId === 'invite_top') {
    const rows = await db.getInviteLeaderboard(interaction.guild.id, 10);
    const description = rows.length
      ? (await Promise.all(rows.map(async (row, index) => {
          const member = await interaction.guild.members.fetch(row.inviter_id).catch(() => null);
          return `${index + 1}. <@${row.inviter_id}> — **${Number(row.invites || 0)}** دعوة${member ? '' : ' (غادر السيرفر)'}`;
        }))).join('\n')
      : 'لا توجد دعوات مسجلة حتى الآن.';
    return interaction.reply({ embeds: [inviteInfoEmbed('🏆 توب الدعوات', description.slice(0, 4096))], flags: MessageFlags.Ephemeral });
  }
}

client.on(Events.InviteCreate, (invite) => {
  if (invite.guild?.id === INVITE_GUILD_ID) snapshotInviteGuild(invite.guild).catch(() => {});
});
client.on(Events.InviteDelete, (invite) => {
  if (invite.guild?.id === INVITE_GUILD_ID) snapshotInviteGuild(invite.guild).catch(() => {});
});

// ─────────────────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, async (c) => {
  console.log(`Bot online: ${c.user.tag}`);
  // Seed current booster state without sending notifications for historical boosts.
  for (const guild of c.guilds.cache.values()) {
    await guild.members.fetch({ withPresences: false }).catch(() => null);
    for (const member of guild.members.cache.values()) {
      knownBoostStates.set(`${guild.id}:${member.id}`, !!member.premiumSince);
    }
  }
  console.log(`[Boost] Snapshot saved for ${knownBoostStates.size} members.`);
  syncVoiceXpOnReady(c);
  await initInviteTracking(c);
  refreshInvitePanel(c.guilds.cache.get(INVITE_GUILD_ID)).catch((err) =>
    console.warn('[Invites] Startup panel repair failed:', err.message),
  );
  startStreakScheduler(client, loadConfig);
  initAutoQuote(client, loadConfig);
  initBirthdayScheduler(client, loadConfig);
  startBackupScheduler(client);

  // ── Boost role 30-day expiry scheduler ──
  async function checkExpiredBoostRoles() {
    try {
      const cfg = loadConfig();
      const roles = cfg.boost?.roles;
      if (!roles || !Object.keys(roles).length) return;
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      let changed = false;
      for (const [userId, rd] of Object.entries(roles)) {
        if (!rd.createdAt || Date.now() - rd.createdAt < thirtyDays) continue;
        // Expired — delete the role from every guild
        for (const guild of c.guilds.cache.values()) {
          const role = guild.roles.cache.get(rd.roleId);
          if (role)
            await role.delete("Boost role expired (30 days)").catch(() => {});
        }
        delete roles[userId];
        changed = true;
        console.log(`[Boost] Expired role for user ${userId}`);
      }
      if (changed) saveConfig(cfg);
    } catch (err) {
      console.error("[Boost] Expiry check error:", err.message);
    }
  }
  checkExpiredBoostRoles();
  setInterval(checkExpiredBoostRoles, 60 * 60 * 1000); // check every hour
});

// Prevent crashes from stale/unknown interactions and network blips
client.on("error", (err) => console.error("[Client error]", err.message));
process.on("unhandledRejection", (err) =>
  console.error("[Unhandled rejection]", err?.message ?? err),
);

// ── BAN LOGGING ───────────────────────────────────────────────────────────────
// GuildBanAdd catches bans made by the bot as well as bans made manually in
// Discord, so the dashboard and the configured Discord log channel stay in sync.
client.on(Events.GuildBanAdd, async (ban) => {
  const logsCfg = loadConfig().logs || {};
  const user = ban.user;
  let moderator = "Unknown moderator";
  let reason = "Ban recorded by Discord";

  try {
    const auditLogs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd });
    const log = auditLogs.entries.first();
    if (log && log.target.id === user.id) {
      moderator = log.executor.tag;
      reason = log.reason || reason;
    }
  } catch (e) { console.error('[BanLog] Audit fetch failed:', e.message); }

  logBanAction(ban.guild.id, user.id, user.tag, moderator, reason);
  const logChannelId = logsCfg.banChannelId || logsCfg.generalChannelId;
  const logChannel = logChannelId ? ban.guild.channels.cache.get(logChannelId) : null;
  if (logChannel) {
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("🔨 Member banned")
      .addFields(
        { name: "Member", value: `${user.tag}\n\`${user.id}\``, inline: true },
        { name: "Moderator", value: moderator, inline: true },
        { name: "Reason", value: reason },
      )
      .setTimestamp();
    logChannel.send({ embeds: [embed], allowedMentions: { users: [] } }).catch(() => {});
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const addedRoles = newMember.roles.cache.filter(
    (r) => !oldMember.roles.cache.has(r.id),
  );
  const removedRoles = oldMember.roles.cache.filter(
    (r) => !newMember.roles.cache.has(r.id),
  );

  const logsCfg = loadConfig().logs || {};
  const logChannel = logsCfg.roleChannelId
    ? newMember.guild.channels.cache.get(logsCfg.roleChannelId)
    : null;

  // Fetch audit log once for both added and removed roles
  let auditExecutorName = "System";
  try {
    await new Promise((r) => setTimeout(r, 600));
    const auditLogs = await newMember.guild.fetchAuditLogs({
      type: AuditLogEvent.MemberRoleUpdate,
      limit: 5,
    });
    const entry = auditLogs.entries.find(
      (e) =>
        e.target?.id === newMember.id && Date.now() - e.createdTimestamp < 8000,
    );
    if (entry?.executor)
      auditExecutorName =
        entry.executor.username || entry.executor.tag || entry.executorId;
  } catch {
    /* no audit log access */
  }

  const memberName =
    newMember.displayName || newMember.user?.username || newMember.id;

  addedRoles.forEach((role) => {
    logRoleAction(
      "إعطاء رتبة",
      `${newMember.id}|${memberName}`,
      role.name,
      auditExecutorName,
    );
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("➕ رتبة مضافة")
        .setDescription(`تم إعطاء رتبة ${role.name} للعضو ${nonPingMention(newMember.id)}`)
        
        .addFields({ name: "بواسطة", value: auditExecutorName, inline: true })
        .setTimestamp();
      logChannel.send({ embeds: [embed], allowedMentions: { users: [] } }).catch(() => {});
    }
  });

  removedRoles.forEach((role) => {
    logRoleAction(
      "سحب رتبة",
      `${newMember.id}|${memberName}`,
      role.name,
      auditExecutorName,
    );
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("➖ رتبة مسحوبة")
        .setDescription(`تم سحب رتبة ${role.name} من العضو ${nonPingMention(newMember.id)}`)
        
        .addFields({ name: "بواسطة", value: auditExecutorName, inline: true })
        .setTimestamp();
      logChannel.send({ embeds: [embed], allowedMentions: { users: [] } }).catch(() => {});
    }
  });

  // ── BOOST DETECTION: hidden channel access ──
  const boostStateKey = `${newMember.guild.id}:${newMember.id}`;
  const wasBooster = knownBoostStates.has(boostStateKey)
    ? knownBoostStates.get(boostStateKey)
    : !!oldMember.premiumSince;
  const isBooster = !!newMember.premiumSince;
  knownBoostStates.set(boostStateKey, isBooster);
  if (DEBUG) console.log(`[Boost Debug] ${newMember.user.tag}: wasBooster=${wasBooster}, isBooster=${isBooster}`);

  // Boost added → reveal the boost channel + send notification
  if (!wasBooster && isBooster) {
    try {
      const cfg = loadConfig();
      const boostCh = cfg.boost?.channelId
        ? newMember.guild.channels.cache.get(cfg.boost.channelId)
        : null;
      if (boostCh) {
        await boostCh.permissionOverwrites.edit(
          newMember.id,
          {
            ViewChannel: true,
            SendMessages: false,
            ReadMessageHistory: true,
          },
          { reason: "Server boost" },
        );
      }

      // ── Send boost notification ──
      const notifChannelId = cfg.boost?.notifChannelId;
      const notifMessage =
        cfg.boost?.notifMessage || "{user} 💜 شكراً على بوستك للسيرفر!";
      if (notifChannelId) {
        const notifCh = newMember.guild.channels.cache.get(notifChannelId);
        if (notifCh) {
          const text = notifMessage
            .replace(/{user}/g, `<@${newMember.id}>`)
            .replace(/{username}/g, newMember.user.username)
            .replace(/{server}/g, newMember.guild.name);
          if (cfg.boost?.notifUseEmbed) {
            const notifEmbed = new EmbedBuilder()
              .setColor(parseBoostColor(cfg.boost?.notifEmbedColor || "") ?? 0x1692c4)
              .setDescription(text);
            if (cfg.boost?.notifImage) notifEmbed.setImage(cfg.boost.notifImage);
            notifCh
              .send({ embeds: [notifEmbed] })
              .catch((err) => console.error("[Boost notif]", err.message));
          } else {
            notifCh
              .send(text)
              .catch((err) => console.error("[Boost notif]", err.message));
          }
        }
      }
    } catch (err) {
      console.error("[Boost] Grant access error:", err.message);
    }
  }

  // Boost removed → hide channel + delete custom role
  if (wasBooster && !isBooster) {
    try {
      const cfg = loadConfig();
      // Revoke channel access
      const boostCh = cfg.boost?.channelId
        ? newMember.guild.channels.cache.get(cfg.boost.channelId)
        : null;
      if (boostCh) {
        await boostCh.permissionOverwrites
          .delete(newMember.id, "Boost removed")
          .catch(() => {});
      }
      // Delete their custom role
      const roleData = cfg.boost?.roles?.[newMember.id];
      if (roleData?.roleId) {
        const role = newMember.guild.roles.cache.get(roleData.roleId);
        if (role) await role.delete("Boost removed").catch(() => {});
      }
      // Clean up from config
      if (cfg.boost?.roles?.[newMember.id]) {
        delete cfg.boost.roles[newMember.id];
        saveConfig(cfg);
      }
    } catch (err) {
      console.error("[Boost] Remove error:", err.message);
    }
  }
});

// ── USER UPDATE: server tag role ────────────────────────────────────────────
// Discord fires USER_UPDATE (not GUILD_MEMBER_UPDATE) when primaryGuild changes.
client.on(Events.UserUpdate, async (oldUser, newUser) => {
  const stCfg = loadConfig().serverTag || {};
  if (!stCfg.enabled || !stCfg.roleId) return;

  for (const guild of client.guilds.cache.values()) {
    const hasTag =
      newUser.primaryGuild != null &&
      newUser.primaryGuild.identityGuildId === guild.id &&
      newUser.primaryGuild.identityEnabled === true;
    const member = await guild.members.fetch({ user: newUser.id, force: true }).catch(() =>
      guild.members.cache.get(newUser.id),
    );
    if (!member) continue;
    const tagRole = guild.roles.cache.get(stCfg.roleId);
    if (!tagRole) continue;
    const hasRole = member.roles.cache.has(tagRole.id);
    if (hasTag === hasRole) continue;

    if (hasTag) {
      await member.roles.add(tagRole).catch((err) =>
        console.error("[ServerTag] add role:", err.message),
      );
    } else {
      await member.roles.remove(tagRole).catch((err) =>
        console.error("[ServerTag] remove role:", err.message),
      );
    }
  }
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (newMessage.author?.bot || oldMessage.content === newMessage.content)
    return;
  const editPayload = JSON.stringify({
    text: `قديم: ${oldMessage.content || ""}\nجديد: ${newMessage.content || ""}`,
    attachments: [],
  });
  logMessageAction(
    "تعديل رسالة",
    newMessage.author.id,
    newMessage.channelId,
    newMessage.id,
    editPayload,
  );

  const logsCfg = loadConfig().logs || {};
  const logChannel = logsCfg.messageChannelId
    ? newMessage.guild.channels.cache.get(logsCfg.messageChannelId)
    : null;
  if (logChannel) {
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("📝 رسالة معدلة")
      .addFields(
        { name: "العضو", value: `${newMessage.author?.tag || newMessage.author?.username || "غير معروف"}`, inline: true },
        { name: "الروم", value: `${newMessage.channel}`, inline: true },
        { name: "قبل", value: oldMessage.content || "لا يوجد نص" },
        { name: "بعد", value: newMessage.content || "لا يوجد نص" },
      )
      .setTimestamp();
    logChannel.send({ embeds: [embed], allowedMentions: { users: [] } }).catch(() => {});
  }
});

client.on(Events.MessageDelete, async (message) => {
  if (message.author?.bot) return;
  if (message.partial) await message.fetch().catch(() => {});

  const attachments = [...(message.attachments?.values() || [])].map((a) => ({
    url: a.url,
    proxyUrl: a.proxyURL || a.url,
    name: a.name || "",
    contentType: a.contentType || "",
    size: a.size || 0,
  }));
  const deletePayload = JSON.stringify({
    text: message.content || "",
    attachments,
  });
  logMessageAction(
    "حذف رسالة",
    message.author?.id || "Unknown",
    message.channelId,
    message.id,
    deletePayload,
  );

  const logsCfg = loadConfig().logs || {};
  const logChannel = logsCfg.messageChannelId
    ? message.guild?.channels.cache.get(logsCfg.messageChannelId)
    : null;
  if (!logChannel) return;

  const files = [];
  const attachmentNotes = [];
  const MAX_LOG_ATTACHMENT_BYTES = 25 * 1024 * 1024;
  for (const attachment of attachments) {
    const displayName = attachment.name || `deleted-${message.id}`;
    if (attachment.size > MAX_LOG_ATTACHMENT_BYTES) {
      attachmentNotes.push(`⚠️ ${displayName}: الملف أكبر من حد Discord لإعادة الرفع`);
      continue;
    }
    try {
      const response = await axios.get(attachment.url, {
        responseType: "arraybuffer",
        timeout: 15000,
        maxContentLength: MAX_LOG_ATTACHMENT_BYTES,
        maxBodyLength: MAX_LOG_ATTACHMENT_BYTES,
      });
      files.push(new AttachmentBuilder(Buffer.from(response.data), { name: displayName }));
    } catch (err) {
      attachmentNotes.push(`🔗 ${displayName}: ${attachment.url}`);
      console.warn(`[message log] Could not preserve ${displayName}: ${err.message}`);
    }
  }

  const contentLines = [message.content || "لا يوجد نص"];
  if (attachmentNotes.length) contentLines.push(...attachmentNotes);
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("🗑️ رسالة محذوفة")
    .addFields(
      {
        name: "العضو",
        value: `${message.author?.tag || message.author?.username || "غير معروف"}`,
        inline: true,
      },
      { name: "الروم", value: `${message.channel}`, inline: true },
      { name: "المحتوى / المرفقات", value: contentLines.join(String.fromCharCode(10)).slice(0, 4000) },
    )
    .setTimestamp();

  await logChannel.send({ embeds: [embed], files }).catch((err) => {
    console.warn(`[message log] Could not send deleted-message copy: ${err.message}`);
    return logChannel.send({ embeds: [embed], allowedMentions: { users: [] } }).catch(() => {});
  });
});

client.on(Events.ChannelCreate, async (channel) => {
  try {
    if (!channel.guild || !channel.permissionOverwrites) return;
    const cfg = loadConfig();
    const jailRoleId = cfg.jail?.roleId;
    if (!jailRoleId) return;
    const role = channel.guild.roles.cache.get(jailRoleId);
    if (!role) return;
    if (channel.id === cfg.jail?.channelId) return;
    await channel.permissionOverwrites
      .edit(role, { ViewChannel: false })
      .catch(() => {});
  } catch (err) {
    console.error("ChannelCreate jail sync error:", err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Acknowledge reaction commands before any routing or network work. This is
  // especially important in DMs, where the GIF request can otherwise make the
  // interaction token expire before the normal reply is sent.
  if (
    interaction.isChatInputCommand() &&
    (RP_CMDS[interaction.commandName] || EMOTION_CMDS[interaction.commandName]) &&
    !interaction.guild &&
    !interaction.deferred &&
    !interaction.replied
  ) {
    try {
      await interaction.deferReply();
    } catch (err) {
      console.error(
        `[Interaction ${interaction.commandName}] immediate acknowledgement failed:`,
        err,
      );
      return;
    }
  }

  if (interaction.guildId && interaction.member && isStaffMember(interaction, loadConfig())) {
    db.incrementStaffActivity(interaction.guildId, interaction.user.id, interaction.user.username, 'interactions').catch(() => {});
  }

  if (interaction.isButton() && await handleRouletteButton(interaction)) return;
  if (interaction.isButton() && interaction.customId.startsWith('invite_')) {
    return handleInviteButton(interaction).catch((err) => {
      console.error('[Invites] Button error:', err.message);
      if (!interaction.replied && !interaction.deferred) interaction.reply({ content: '❌ حدث خطأ في نظام الدعوات.', flags: MessageFlags.Ephemeral }).catch(() => {});
    });
  }

  // ── BUTTON: staff administration panel ──
  if (interaction.isButton() && Object.values(PANEL_IDS).includes(interaction.customId)) {
    return handleStaffPanelButton(interaction, loadConfig).catch((err) => {
      console.error('[StaffPanel]', err.message);
      if (!interaction.replied && !interaction.deferred) {
        interaction.reply({ content: '❌ حدث خطأ في لوحة الإدارة.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    });
  }

  // ── BUTTON: rules navigation ──
  // ── CUSTOM EMBED: button click ──
  if (interaction.isButton() && interaction.customId.startsWith("emb_btn_")) {
    const parts = interaction.customId.split("_"); // emb_btn_<embedId>_<idx>
    const btnIdx = parseInt(parts[parts.length - 1], 10);
    const embedId = parts.slice(2, parts.length - 1).join("_");
    const emb = (loadConfig().savedEmbeds || []).find((e) => e.id === embedId);
    const btn = emb?.buttons?.[btnIdx];
    if (!btn)
      return interaction.reply({
        content: "❌ Button not found.",
        flags: MessageFlags.Ephemeral,
      });

    const btnHidden = btn.hidden !== false;
    const btnEmbed = btn.responseFormat === "embed";
    const _btnReply = (text) => {
      if (!btnEmbed) return { content: text, ephemeral: btnHidden };
      const color = btn.responseEmbedColor
        ? parseInt(btn.responseEmbedColor.replace("#", ""), 16)
        : 0x5865f2;
      return {
        embeds: [new EmbedBuilder().setColor(color).setDescription(text)],
        ephemeral: btnHidden,
      };
    };
    if (btn.responseType === "role") {
      if (!interaction.guild)
        return interaction.reply({
          content: "❌ Roles only work in a server.",
          flags: MessageFlags.Ephemeral,
        });
      const member = interaction.member;
      const role = interaction.guild.roles.cache.get(btn.responseRoleId);
      if (!role)
        return interaction.reply({
          content: "❌ Role not found.",
          flags: MessageFlags.Ephemeral,
        });
      try {
        const has = member.roles.cache.has(role.id);
        const action = btn.responseRoleAction || "toggle";
        if (action === "add" || (action === "toggle" && !has)) {
          await member.roles.add(role);
          return interaction.reply(
            _btnReply(`✅ You received the **${role.name}** role!`),
          );
        } else {
          await member.roles.remove(role);
          return interaction.reply(
            _btnReply(`✅ Removed the **${role.name}** role.`),
          );
        }
      } catch (err) {
        return interaction.reply({
          content: `❌ Failed: ${err.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } else {
      return interaction.reply(_btnReply(btn.responseText || "✅"));
    }
  }

  // ── CUSTOM EMBED: select menu ──
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("emb_sel_")
  ) {
    const embedId = interaction.customId.slice("emb_sel_".length);
    const emb = (loadConfig().savedEmbeds || []).find((e) => e.id === embedId);
    const optIdx = parseInt(interaction.values[0], 10);
    const opt = emb?.selectMenu?.options?.[optIdx];
    if (!opt)
      return interaction.reply({
        content: "❌ Option not found.",
        flags: MessageFlags.Ephemeral,
      });

    const optHidden = opt.hidden !== false;
    const optEmbed = opt.responseFormat === "embed";
    const _optReply = (text) => {
      if (!optEmbed) return { content: text, ephemeral: optHidden };
      const color = opt.responseEmbedColor
        ? parseInt(opt.responseEmbedColor.replace("#", ""), 16)
        : 0x5865f2;
      return {
        embeds: [new EmbedBuilder().setColor(color).setDescription(text)],
        ephemeral: optHidden,
      };
    };
    if (opt.responseType === "role") {
      if (!interaction.guild)
        return interaction.reply({
          content: "❌ Roles only work in a server.",
          flags: MessageFlags.Ephemeral,
        });
      const member = interaction.member;
      const role = interaction.guild.roles.cache.get(opt.responseRoleId);
      if (!role)
        return interaction.reply({
          content: "❌ Role not found.",
          flags: MessageFlags.Ephemeral,
        });
      try {
        const has = member.roles.cache.has(role.id);
        const action = opt.responseRoleAction || "toggle";
        if (action === "add" || (action === "toggle" && !has)) {
          await member.roles.add(role);
          return interaction.reply(
            _optReply(`✅ You received the **${role.name}** role!`),
          );
        } else {
          await member.roles.remove(role);
          return interaction.reply(
            _optReply(`✅ Removed the **${role.name}** role.`),
          );
        }
      } catch (err) {
        return interaction.reply({
          content: `❌ Failed: ${err.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } else {
      return interaction.reply(_optReply(opt.responseText || "✅"));
    }
  }

  if (
    interaction.isButton() &&
    interaction.customId.startsWith("rules_spread_")
  ) {
    const index = parseInt(
      interaction.customId.replace("rules_spread_", ""),
      10,
    );
    const isEphemeralMsg = interaction.message?.flags?.has(
      MessageFlags.Ephemeral,
    );

    if (isEphemeralMsg) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    try {
      const rulesConfig = loadConfig().rulesConfig || {};
      const dynamicRules = rulesConfig.rules || DEFAULT_RULES;
      const dynamicNote = rulesConfig.note || DEFAULT_NOTE;
      const dynamicColors = rulesConfig.colors || {};
      const SPREADS = buildSpreads(dynamicRules, dynamicNote);
      if (isNaN(index) || index < 0 || index >= SPREADS.length) return;
      const buffer = generateRulesCard(
        SPREADS[index],
        index,
        SPREADS.length,
        dynamicColors,
      );
      const attachment = new AttachmentBuilder(buffer, { name: "rules.png" });

      const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rules_spread_${index - 1}`)
          .setLabel("◀  السابق")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === 0),
        new ButtonBuilder()
          .setCustomId(`rules_spread_${index + 1}`)
          .setLabel("التالي  ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === SPREADS.length - 1),
      );

      await interaction.editReply({
        files: [attachment],
        components: [navRow],
      });
    } catch (err) {
      console.error("[Rules navigation]", err.message);
      await interaction
        .editReply({ content: `❌ فشل عرض القوانين: ${err.message}` })
        .catch(() => {});
    }
    return;
  }

  // ── BUTTON: trivia ──
  if (interaction.isButton() && interaction.customId.startsWith("trivia_")) {
    await triviaButton(interaction);
    return;
  }

  // ── BUTTON: blackjack ──
  if (interaction.isButton() && interaction.customId.startsWith("bj_")) {
    await blackjackButton(interaction);
    return;
  }

  // ── BUTTON: minesweeper ──
  if (interaction.isButton() && interaction.customId.startsWith("ms_")) {
    await minesweeperButton(interaction);
    return;
  }

  // ── BUTTON: slots replay ──
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("race_accept_")
  ) {
    return raceAcceptBtn(interaction).catch((err) =>
      console.error("[Race accept]", err.message),
    );
  }

  if (
    interaction.isButton() &&
    interaction.customId.startsWith("race_decline_")
  ) {
    return raceDeclineBtn(interaction).catch((err) =>
      console.error("[Race decline]", err.message),
    );
  }

  if (interaction.isButton() && interaction.customId === "slots_replay") {
    await slotsReplay(interaction);
    return;
  }

  // ── BUTTON: roleplay accept / decline ──
  if (interaction.isButton() && interaction.customId.startsWith("rp_")) {
    const parts = interaction.customId.split("_");
    // format: rp_accept_kiss_initiatorId_targetId  OR  rp_decline_...
    const verdict = parts[1]; // 'accept' or 'decline'
    const action = parts[2]; // 'kiss' etc.
    const initiatorId = parts[3];
    const targetId = parts[4];

    if (interaction.user.id !== targetId) {
      return interaction.reply({
        content: "Only the person who received this can respond.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const rp = RP_CMDS[action];
    if (!rp)
      return interaction.reply({
        content: "Unknown action.",
        flags: MessageFlags.Ephemeral,
      });

    const initiator = interaction.guild
      ? await interaction.guild.members.fetch(initiatorId).catch(() => null)
      : await client.users.fetch(initiatorId).catch(() => null);
    const target = interaction.guild ? interaction.member : interaction.user;
    const iName = initiator?.displayName || initiator?.username || "Someone";
    const tName = target?.displayName || target?.username || "Someone";

    let gifUrl = await fetchRoleplayGif(action, rp.apiAction);

    if (verdict === "accept") {
      const embed = new EmbedBuilder()
        .setColor(rp.color)
        .setDescription(rp.accept(iName, tName))
        .setFooter({ text: rp.acceptEmote });
      const files = await attachGifToEmbed(embed, gifUrl);
      await interaction
        .update({ embeds: [embed], files, components: [] })
        .catch(() => {});
    } else {
      const embed = new EmbedBuilder()
        .setColor(0x636e72)
        .setDescription(rp.decline(iName, tName))
        .setFooter({ text: rp.declineEmote });
      await interaction
        .update({ embeds: [embed], components: [] })
        .catch(() => {});
    }
    return;
  }

  // ── BUTTON: profile card confirm / cancel ──
  if (
    interaction.isButton() &&
    (interaction.customId.startsWith("profile_send_") ||
      interaction.customId.startsWith("profile_cancel_"))
  ) {
    const isSend = interaction.customId.startsWith("profile_send_");
    const ownerId = interaction.customId.replace(
      isSend ? "profile_send_" : "profile_cancel_",
      "",
    );

    if (interaction.user.id !== ownerId) {
      return interaction
        .reply({
          content: "بس صاحب البروفيل يقدر يستخدم هذا الزر.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }

    const key = `${interaction.guildId}:${ownerId}`;
    const pending = pendingProfilePreview.get(key);
    if (!pending) {
      return interaction
        .update({
          content: "⌛ انتهت صلاحية هذا الطلب.",
          embeds: [],
          components: [],
        })
        .catch(() => {});
    }

    if (!isSend) {
      pendingProfilePreview.delete(key);
      pendingProfileAvatar.delete(key);
      return interaction
        .update({ content: "❌ تم إلغاء البروفيل.", files: [], components: [] })
        .catch(() => {});
    }

    try {
      await interaction.deferUpdate();
    } catch (err) {
      // لو فشل هذا السطر بدون try/catch، الخطأ كان يروح لـ unhandledRejection
      // ويتسجل بالكونسول بس، والمستخدم ما يشوف أي رد فعل على الزر أبداً.
      console.error("Profile deferUpdate error:", err);
      return;
    }

    try {
      await db.saveProfileImages(
        interaction.guildId,
        ownerId,
        pending.avatarBuffer,
        pending.bannerBuffer,
      );

      const cfg = loadConfig();
      const outputChannelId = cfg.profile?.outputChannelId;
      const outputChannel = outputChannelId
        ? await interaction.guild.channels
            .fetch(outputChannelId)
            .catch(() => null)
        : null;

      const buffer = await generateProfileCard({
        avatarUrl: pending.avatarBuffer,
        bannerUrl: pending.bannerBuffer,
        avatarSize: cfg.profile?.avatarSize,
        avatarX: cfg.profile?.avatarX,
        avatarY: cfg.profile?.avatarY,
      });
      pendingProfilePreview.delete(key);
      pendingProfileAvatar.delete(key);

      const downloadId = `${ownerId}_${Date.now()}`;
      profileDownloadData.set(downloadId, {
        avatarBuffer: pending.avatarBuffer,
        bannerBuffer: pending.bannerBuffer,
      });
      const downloadRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`profile_download_${downloadId}`)
          .setLabel("تحميل")
          .setStyle(ButtonStyle.Secondary),
      );

      if (outputChannel) {
        await outputChannel.send({
          content: `${interaction.user}`,
          files: [new AttachmentBuilder(buffer, { name: "profile.png" })],
          components: [downloadRow],
        });
        await interaction
          .editReply({
            content: `✅ تم إرسال بروفيلك في ${outputChannel}`,
            files: [],
            components: [],
          })
          .catch(() => {});
      } else {
        await interaction
          .editReply({
            content: `✅ بروفيلك جاهز (ما تم تحديد روم النتيجة، اطلب من الإدارة تحديده):`,
            files: [new AttachmentBuilder(buffer, { name: "profile.png" })],
            components: [downloadRow],
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error("Profile confirm error:", err);
      await interaction
        .editReply({
          content: "صار خطأ أثناء حفظ أو إنشاء البروفيل. حاول مرة ثانية.",
          components: [],
        })
        .catch(() => {});
    }
    return;
  }

  // ── BUTTON: profile download (avatar + banner separately, hidden reply) ──
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("profile_download_")
  ) {
    const downloadId = interaction.customId.replace("profile_download_", "");
    let data = profileDownloadData.get(downloadId);

    // The in-memory cache is only an optimization. If the bot restarted or
    // has been running for a long time, restore the saved images from Turso.
    if (!data && interaction.guildId) {
      const ownerId = downloadId.split("_")[0];
      const saved = await db
        .getProfileImages(interaction.guildId, ownerId)
        .catch((err) => {
          console.error("[profile] Failed to load saved images:", err.message);
          return null;
        });
      if (saved) {
        data = { avatarBuffer: saved.avatar, bannerBuffer: saved.banner };
        profileDownloadData.set(downloadId, data);
      }
    }

    // Older profiles were not stored in Turso. If the original Discord
    // message still has its generated profile card, return that card so the
    // old download button remains useful.
    if (!data) {
      const profileAttachment = interaction.message?.attachments?.find(
        (attachment) =>
          attachment.contentType?.startsWith("image/") ||
          attachment.name?.endsWith(".png"),
      );
      if (profileAttachment) {
        const profileBuffer = await downloadImageBytes(profileAttachment.url);
        if (profileBuffer && profileBuffer !== "EXPIRED") {
          return interaction.reply({
            content: "✅ هذا بروفيل قديم محفوظ في رسالة ديسكورد:",
            files: [
              new AttachmentBuilder(profileBuffer, { name: "profile.png" }),
            ],
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    }

    if (!data) {
      return interaction.reply({
        content:
          "⌛ ما لقيت صور هذا البروفيل. إذا كان بروفيل قديم، أعد إرسال الأفتار والبنر لحفظهما في قاعدة البيانات.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const avatarFile = new AttachmentBuilder(data.avatarBuffer, {
      name: "avatar.png",
    });
    const bannerFile = new AttachmentBuilder(data.bannerBuffer, {
      name: "banner.png",
    });
    const avatarEmbed = new EmbedBuilder()
      .setTitle("الأفتار")
      .setImage("attachment://avatar.png");
    const bannerEmbed = new EmbedBuilder()
      .setTitle("البنر")
      .setImage("attachment://banner.png");
    return interaction.reply({
      embeds: [avatarEmbed, bannerEmbed],
      files: [avatarFile, bannerFile],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── BUTTON: giveaway entry ──
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("giveaway_enter_")
  ) {
    const giveawayId = interaction.customId.replace("giveaway_enter_", "");
    const g = activeGiveaways.get(giveawayId);
    if (!g) {
      return interaction.reply({
        content: "This giveaway has ended.",
        flags: MessageFlags.Ephemeral,
      });
    }
    if (g.entries.has(interaction.user.id)) {
      g.entries.delete(interaction.user.id);
      await interaction.reply({
        content: "You left the giveaway.",
        flags: MessageFlags.Ephemeral,
      });
    } else {
      g.entries.add(interaction.user.id);
      await interaction.reply({
        content: "You entered the giveaway! 🎉",
        flags: MessageFlags.Ephemeral,
      });
    }
    await db.saveGiveaway(giveawayId, g, 'active');
    const updatedEmbed = buildGiveawayEmbed(g);
    const newRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(interaction.customId).setLabel("🎉").setStyle(ButtonStyle.Primary),
    );
    await interaction.message.edit({ __legacyEmbed: true, embeds: [updatedEmbed], components: [newRow], allowedMentions: { parse: [], roles: [], repliedUser: false } }).catch((err) => console.error("Giveaway update error:", err.message));
    return;
  }

  // ── BUTTON: staff application — open form ──
  if (interaction.isButton() && interaction.customId === "staff_app_open") {
    return handleApplicationStart(interaction, loadConfig).catch((err) => {
      console.error("[StaffApp open]", err.message);
      interaction
        .reply({
          content: "❌ حدث خطأ أثناء فتح التقديم.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    });
  }

  // ── BUTTON: staff application — accept / reject ──
  if (
    interaction.isButton() &&
    (interaction.customId.startsWith("staff_accept_") ||
      interaction.customId.startsWith("staff_reject_"))
  ) {
    const decision = interaction.customId.startsWith("staff_accept_")
      ? "accept"
      : "reject";
    return handleApplicationDecision(interaction, loadConfig, decision).catch(
      (err) => {
        console.error("[StaffApp decision]", err.message);
        interaction
          .reply({ content: "❌ حدث خطأ.", flags: MessageFlags.Ephemeral })
          .catch(() => {});
      },
    );
  }

  // ── BUTTON: boost — open ticket ──
  if (
    interaction.isButton() &&
    interaction.customId === "boost_btn_open_ticket"
  ) {
    if (!interaction.member.premiumSince) {
      return interaction.reply({
        content: "❌ هذا الزر للبوسترز فقط.",
        flags: MessageFlags.Ephemeral,
      });
    }
    // Check if user already has an open ticket
    const existing = [...boostTickets.values()].find(
      (t) => t.userId === interaction.user.id,
    );
    if (existing) {
      const existCh = interaction.guild.channels.cache.get(existing.channelId);
      if (existCh)
        return interaction.reply({
          content: `لديك تذكرة مفتوحة بالفعل: ${existCh}`,
          flags: MessageFlags.Ephemeral,
        });
      else boostTickets.delete(existing.channelId);
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const cfg = loadConfig();
      const boostCh = cfg.boost?.channelId
        ? interaction.guild.channels.cache.get(cfg.boost.channelId)
        : null;
      const ticketCh = await interaction.guild.channels.create({
        name: `boost-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "") || interaction.user.id}`,
        type: ChannelType.GuildText,
        parent: boostCh?.parentId ?? null,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels,
            ],
          },
        ],
      });

      const boostTicket = {
        channelId: ticketCh.id,
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        stage: "menu",
        data: {},
        expiresAt: Date.now() + BOOST_TICKET_TIMEOUT_MS,
      };
      boostTickets.set(ticketCh.id, boostTicket);
      scheduleBoostTicketExpiry(boostTicket);

      const hasRole = !!cfg.boost?.roles?.[interaction.user.id]?.roleId;
      const menuOptions = [];
      if (!hasRole) {
        menuOptions.push({
          label: "إنشاء رتبة خاصة",
          value: "create",
          description: "أنشئ رتبتك باسم وإيموجي ولون",
          emoji: { id: "1531641222743982201", name: "create", animated: true },
        });
      } else {
        menuOptions.push({
          label: "تغيير اسم الرتبة",
          value: "rename",
          description: "عدّل اسم رتبتك الحالية",
          emoji: { id: "1531641643390865678", name: "rename" },
        });
        menuOptions.push({
          label: "تغيير إيموجي الرتبة",
          value: "emoji",
          description: "غيّر إيموجي رتبتك من أي سيرفر",
          emoji: { id: "1531643997095989358", name: "roleicon" },
        });
        menuOptions.push({
          label: "تغيير لون الرتبة",
          value: "color",
          description: "غيّر لون رتبتك",
          emoji: { name: "🎨" },
        });
        menuOptions.push({
          label: "حذف الرتبة",
          value: "delete",
          description: "احذف رتبتك الحالية",
          emoji: { id: "1531642211643560057", name: "deleterole" },
        });
      }

      const menuRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("boost_ticket_menu")
          .setPlaceholder("اختر ما تريد فعله...")
          .addOptions(menuOptions),
      );
      await ticketCh.send({
        content: `مرحباً ${interaction.user}! 👋\nاختر ما تريد فعله من القائمة أدناه:`,
        components: [menuRow],
      });
      return interaction.editReply({
        content: `✅ تم فتح تذكرتك: ${ticketCh}`,
      });
    } catch (err) {
      console.error("[Boost ticket open]", err.message);
      return interaction.editReply({
        content: `❌ فشل فتح التذكرة: ${err.message}`,
      });
    }
  }

  // ── BUTTON: support ticket — open (panel sent via /api/ticket-panels/:id/send) ──
  if (interaction.isButton() && interaction.customId.startsWith("ticket_open_")) {
    const cfg = loadConfig();
    const panels = Array.isArray(cfg.ticketPanels) ? cfg.ticketPanels : [];
    // customId is "ticket_open_<panelId>:<buttonIndex>". Buttons posted before
    // the multi-panel upgrade have no panelId embedded (just "ticket_open_<idx>") —
    // fall back to the first/legacy panel so those old panel messages keep working.
    const raw = interaction.customId.slice("ticket_open_".length);
    const sep = raw.lastIndexOf(":");
    let panelId, btnIdx;
    if (sep === -1) {
      btnIdx = parseInt(raw, 10) || 0;
      panelId = panels[0]?.id;
    } else {
      panelId = raw.slice(0, sep);
      btnIdx = parseInt(raw.slice(sep + 1), 10) || 0;
    }
    const t = panels.find((p) => p.id === panelId);
    if (!t) {
      return interaction.reply({
        content: "❌ هذا البانيل لم يعد موجوداً، تواصل مع الإدارة.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const ticketButtons = Array.isArray(t.buttons) && t.buttons.length
      ? t.buttons
      : [{ label: "🎫 فتح تكت", style: "Primary", categoryId: "" }];
    const chosenTicketButton = ticketButtons[btnIdx] || ticketButtons[0] || {};

    // Prevent a user from opening more than one ticket at a time
    const existing = interaction.guild.channels.cache.find(
      (c) => c.topic === `ticket-${interaction.user.id}`,
    );
    if (existing) {
      return interaction.reply({
        content: `❌ لديك تذكرة مفتوحة بالفعل: ${existing}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const overwrites = [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
          ],
        },
      ];
      if (t.staffRoleId) {
        overwrites.push({
          id: t.staffRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        });
      }

      const parent = chosenTicketButton.categoryId
        ? interaction.guild.channels.cache.get(chosenTicketButton.categoryId)
        : null;

      const slug = (value, fallback) => {
        const raw = String(value || '').trim().toLowerCase();
        const clean = raw
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^\p{L}\p{N}]+/gu, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 38);
        return clean || fallback;
      };
      const configuredTicketName = chosenTicketButton.ticketName || chosenTicketButton.channelName || 'support';
      const supportPart = slug(configuredTicketName, 'support');
      const userPart = slug(interaction.user.username, interaction.user.id);
      const ticketChannelName = `${supportPart}-${userPart}`.slice(0, 100);

      const ticketCh = await interaction.guild.channels.create({
        name: ticketChannelName,
        type: ChannelType.GuildText,
        parent: parent?.id ?? null,
        topic: `ticket-${interaction.user.id}`,
        permissionOverwrites: overwrites,
      });

      // Persist ticket so it shows up in dashboard → Logs → Tickets
      try {
        const allTickets = await db.loadTickets();
        if (!allTickets[interaction.guild.id])
          allTickets[interaction.guild.id] = {};
        allTickets[interaction.guild.id][ticketCh.id] = {
          userId: interaction.user.id,
          username: interaction.user.username,
          panelId: t.id,
          panelName: t.name || "",
          ticketName: configuredTicketName,
          channelName: ticketCh.name,
          openedAt: Date.now(),
        };
        await db.saveTickets(allTickets);
      } catch (dbErr) {
        console.error("[Ticket open][db]", dbErr.message);
      }

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_close")
          .setLabel("🔒 إغلاق التذكرة")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("ticket_claim")
          .setLabel("✋ Claim")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("ticket_manage")
          .setLabel("⚙️ Manage")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("ticket_unclaim")
          .setLabel("↩️ إلغاء الاستلام")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      );

      const tColorHex = (t.embedColor || "#5865F2").replace("#", "");
      const tColor = /^[0-9A-Fa-f]{6}$/.test(tColorHex)
        ? parseInt(tColorHex, 16)
        : 0x5865f2;

      const welcomeEmbed = new EmbedBuilder()
        .setColor(tColor)
        .setTitle(t.embedTitle || "🎫 تذكرة جديدة")
        .setDescription(
          t.welcomeMessage ||
            "مرحباً! شكراً لتواصلك معنا، سيقوم أحد أعضاء الفريق بالرد عليك قريباً.",
        )
        .setFooter({
          text: `تم الفتح بواسطة ${interaction.user.username}`,
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();
      const ticketImageUrl = t.embedImage ? await resolveImgbbUrl(t.embedImage) : '';
      if (ticketImageUrl) welcomeEmbed.setImage(ticketImageUrl);

      // Send one message: real opener and staff-role mentions first,
      // followed by the ticket Embed and its controls.
      const openerMention = `<@${interaction.user.id}>`;
      const staffMention = t.staffRoleId ? `<@&${t.staffRoleId}>` : '';
      await ticketCh.send({
        content: `${openerMention} ${staffMention}`.trim(),
        embeds: [welcomeEmbed],
        components: [closeRow],
        allowedMentions: {
          users: [interaction.user.id],
          roles: t.staffRoleId ? [t.staffRoleId] : [],
        },
      });

      return interaction.editReply({
        content: `✅ تم فتح تذكرتك: ${ticketCh}`,
      });
    } catch (err) {
      console.error("[Ticket open]", err.message);
      return interaction.editReply({
        content: `❌ فشل فتح التذكرة: ${err.message}`,
      });
    }
  }

  // ── BUTTON: support ticket — close ──
  if (interaction.isButton() && interaction.customId === "ticket_close") {
    try {
      await interaction.reply({
        content: "🔒 سيتم إغلاق التذكرة خلال 5 ثواني...",
      });
    } catch (err) {
      console.error("[Ticket close][reply]", err.message);
    }
    setTimeout(async () => {
      try {
        const cfg = loadConfig();
        await sendTicketClosureLog(interaction, cfg);
        const allTickets = await db.loadTickets();
        if (allTickets[interaction.guild.id])
          delete allTickets[interaction.guild.id][interaction.channel.id];
        await db.saveTickets(allTickets);
        if (isStaffMember(interaction, cfg)) {
          await db.incrementStaffActivity(interaction.guild.id, interaction.user.id, interaction.user.username, 'closedTickets');
          await db.incrementStaffActivity(interaction.guild.id, interaction.user.id, interaction.user.username, 'actions');
          await awardStaffXp(interaction, cfg, 'ticketClose');
        }
        await interaction.channel.delete("Ticket closed");
      } catch (err) {
        console.error("[Ticket close]", err.message);
      }
    }, 5000);
  }

  // ── BUTTON: support ticket — claim ──
  if (interaction.isButton() && interaction.customId === "ticket_claim") {
    const cfg = loadConfig();
    const member = interaction.member;
    try {
      // Update DB with claimer info
      const allTickets = await db.loadTickets();
      const guildTickets = allTickets[interaction.guild.id] || {};
      const ticketData = guildTickets[interaction.channel.id];
      if (!ticketData) {
        return interaction.reply({
          content: "❌ لم يتم العثور على بيانات التذكرة.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const t =
        (Array.isArray(cfg.ticketPanels) ? cfg.ticketPanels : []).find(
          (p) => p.id === ticketData.panelId,
        ) || {};
      // Only staff can claim (if staffRoleId set, enforce it; otherwise any server member can claim)
      if (t.staffRoleId && !member.roles.cache.has(t.staffRoleId)) {
        return interaction.reply({
          content: "❌ فقط أعضاء الفريق يمكنهم المطالبة بالتذكرة.",
          flags: MessageFlags.Ephemeral,
        });
      }
      if (ticketData.claimedBy) {
        const claimerMention = `<@${ticketData.claimedBy}>`;
        return interaction.reply({
          content: `❌ هذه التذكرة مطالب بها بالفعل من قبل ${claimerMention}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      ticketData.claimedBy = interaction.user.id;
      ticketData.claimedAt = Date.now();
      allTickets[interaction.guild.id][interaction.channel.id] = ticketData;
      await db.saveTickets(allTickets);
      await db.incrementStaffActivity(interaction.guild.id, interaction.user.id, interaction.user.username, 'actions');
      await awardStaffXp(interaction, cfg, 'ticketClaim');

      // Lock conversation after claim: the opener and the claimer can talk;
      // other staff can still view the ticket but cannot send messages.
      await interaction.channel.permissionOverwrites.edit(interaction.guild.id, {
        ViewChannel: false,
        SendMessages: false,
        ReadMessageHistory: false,
      });
      if (t.staffRoleId) {
        await interaction.channel.permissionOverwrites.edit(t.staffRoleId, {
          ViewChannel: true,
          SendMessages: false,
          ReadMessageHistory: true,
        });
      }
      await interaction.channel.permissionOverwrites.edit(ticketData.userId, {
        ViewChannel: true,
        SendMessages: true,
        AttachFiles: true,
        EmbedLinks: true,
        UseExternalApps: true,
        ReadMessageHistory: true,
      });
      await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
        ViewChannel: true,
        SendMessages: true,
        AttachFiles: true,
        EmbedLinks: true,
        UseExternalApps: true,
        ReadMessageHistory: true,
      });
      await interaction.channel.permissionOverwrites.edit(client.user.id, {
        ViewChannel: true,
        SendMessages: true,
        AttachFiles: true,
        EmbedLinks: true,
        UseExternalApps: true,
        ReadMessageHistory: true,
        ManageChannels: true,
      });

      // Fetch the complete message before editing it. Rebuild only the
      // component rows and carry the original content + embeds forward.
      // This changes the Claim button without removing the ticket Embed.
      try {
        const originalMsg = await interaction.channel.messages.fetch(interaction.message.id);
        const preservedRows = (originalMsg.components || []).map((row) => {
          const rowData = typeof row.toJSON === 'function' ? row.toJSON() : row;
          const rebuilt = (rowData.components || []).map((component) => {
            // Raw API components do not implement toJSON(). Rebuild each known
            // component type so MessagePayload can serialize the edited row.
            let builder;
            switch (component.type) {
              case 2: builder = ButtonBuilder.from(component); break;
              case 3: builder = StringSelectMenuBuilder.from(component); break;
              case 5: builder = UserSelectMenuBuilder.from(component); break;
              case 6: builder = RoleSelectMenuBuilder.from(component); break;
              case 7: builder = MentionableSelectMenuBuilder.from(component); break;
              case 8: builder = ChannelSelectMenuBuilder.from(component); break;
              default: return component;
            }
            if (component.type === 2 && component.custom_id === 'ticket_claim') {
              builder
                .setLabel(`✅ Claimed by ${interaction.user.username}`)
                .setDisabled(true);
            }
            if (component.type === 2 && component.custom_id === 'ticket_unclaim') {
              builder
                .setLabel("↩️ إلغاء الاستلام")
                .setDisabled(false);
            }
            return builder;
          });
          return new ActionRowBuilder().addComponents(...rebuilt);
        });
        await originalMsg.edit({
          content: originalMsg.content || undefined,
          embeds: (originalMsg.embeds || []).map((embed) => embed.toJSON()),
          components: preservedRows,
          allowedMentions: { parse: [] },
        });
      } catch (messageUpdateErr) {
        console.error('[Ticket claim][message update]', messageUpdateErr.message);
      }

      await interaction.reply({
        content: `✅ تم المطالبة بالتذكرة بواسطة ${interaction.user}`,
      });
    } catch (err) {
      console.error("[Ticket claim]", err.message);
      return interaction.reply({
        content: `❌ حدث خطأ: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── BUTTON: support ticket — unclaim (leave open for another staff member) ──
  if (interaction.isButton() && interaction.customId === "ticket_unclaim") {
    try {
      const cfg = loadConfig();
      const allTickets = await db.loadTickets();
      const guildTickets = allTickets[interaction.guild.id] || {};
      const ticketData = guildTickets[interaction.channel.id];
      if (!ticketData) {
        return interaction.reply({ content: "❌ لم يتم العثور على بيانات التذكرة.", flags: MessageFlags.Ephemeral });
      }
      if (ticketData.claimedBy !== interaction.user.id) {
        return interaction.reply({ content: "❌ فقط الإداري المستلم يستطيع إلغاء الاستلام.", flags: MessageFlags.Ephemeral });
      }
      const t = (Array.isArray(cfg.ticketPanels) ? cfg.ticketPanels : []).find((p) => p.id === ticketData.panelId) || {};
      ticketData.claimedBy = null;
      ticketData.claimedAt = null;
      ticketData.unclaimedAt = Date.now();
      guildTickets[interaction.channel.id] = ticketData;
      allTickets[interaction.guild.id] = guildTickets;
      await db.saveTickets(allTickets);
      if (t.staffRoleId) {
        await interaction.channel.permissionOverwrites.edit(t.staffRoleId, {
          ViewChannel: true,
          SendMessages: true,
          AttachFiles: true,
          EmbedLinks: true,
          ReadMessageHistory: true,
        });
      }
      await interaction.channel.permissionOverwrites.delete(interaction.user.id).catch(() => {});
      const originalMsg = await interaction.channel.messages.fetch(interaction.message.id);
      const rows = (originalMsg.components || []).map((row) => {
        const rowData = typeof row.toJSON === 'function' ? row.toJSON() : row;
        const rebuilt = (rowData.components || []).map((component) => {
          if (component.type !== 2) return component;
          const builder = ButtonBuilder.from(component);
          if (component.custom_id === 'ticket_claim') builder.setLabel("✋ استلام التذكرة").setDisabled(false);
          if (component.custom_id === 'ticket_unclaim') builder.setLabel("↩️ إلغاء الاستلام").setDisabled(true);
          return builder;
        });
        return new ActionRowBuilder().addComponents(...rebuilt);
      });
      await originalMsg.edit({
        content: originalMsg.content || undefined,
        embeds: (originalMsg.embeds || []).map((embed) => embed.toJSON()),
        components: rows,
        allowedMentions: { parse: [] },
      });
      return interaction.reply({ content: "✅ تم إلغاء الاستلام، وبقيت التذكرة مفتوحة ليستلمها إداري آخر.", flags: MessageFlags.Ephemeral });
    } catch (err) {
      console.error("[Ticket unclaim]", err.message);
      return interaction.reply({ content: "❌ تعذر إلغاء الاستلام.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }

  // ── BUTTON: support ticket — manage (ephemeral select menu) ──
  if (interaction.isButton() && interaction.customId === "ticket_manage") {
    const cfg = loadConfig();
    const member = interaction.member;
    // Only staff or ticket opener can manage
    const allTickets = await db.loadTickets();
    const ticketData = (allTickets[interaction.guild.id] || {})[
      interaction.channel.id
    ];
    const t =
      (Array.isArray(cfg.ticketPanels) ? cfg.ticketPanels : []).find(
        (p) => p.id === ticketData?.panelId,
      ) || {};
    const isStaff = t.staffRoleId
      ? member.roles.cache.has(t.staffRoleId)
      : member.permissions.has(PermissionFlagsBits.ManageChannels);
    const isOpener = ticketData && ticketData.userId === interaction.user.id;
    if (!isStaff && !isOpener) {
      return interaction.reply({
        content: "❌ ليس لديك صلاحية إدارة هذه التذكرة.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const manageMenu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("ticket_manage_select")
        .setPlaceholder("اختر إجراءً...")
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setValue("rename")
            .setLabel("✏️ Rename Ticket")
            .setDescription("Change the ticket channel name"),
          new StringSelectMenuOptionBuilder()
            .setValue("sendmsg")
            .setLabel("📩 Send Message")
            .setDescription("Send a message to someone in this ticket"),
          new StringSelectMenuOptionBuilder()
            .setValue("transfer")
            .setLabel("🔄 Transfer Ticket")
            .setDescription("Assign the ticket to another staff member"),
          new StringSelectMenuOptionBuilder()
            .setValue("addmember")
            .setLabel("➕ Add Member")
            .setDescription("Give another member access to this ticket"),
          new StringSelectMenuOptionBuilder()
            .setValue("removemember")
            .setLabel("➖ Remove Member")
            .setDescription("Remove a member's direct access to this ticket"),
        ),
    );

    return interaction.reply({
      content: "⚙️ **Manage Ticket** — اختر إجراءً:",
      components: [manageMenu],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── SELECT: ticket manage menu ──
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "ticket_manage_select"
  ) {
    const choice = interaction.values[0];

    if (choice === "rename") {
      const modal = new ModalBuilder()
        .setCustomId("ticket_rename_modal")
        .setTitle("✏️ Rename Ticket");
      const nameInput = new TextInputBuilder()
        .setCustomId("ticket_new_name")
        .setLabel("اسم القناة الجديد")
        .setPlaceholder("ticket-username")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
      return interaction.showModal(modal);
    }

    if (choice === "transfer" || choice === "addmember" || choice === "removemember") {
      const selectId = choice === "transfer"
        ? "ticket_transfer_select"
        : choice === "addmember"
          ? "ticket_addmember_select"
          : "ticket_removemember_select";
      const placeholder = choice === "transfer"
        ? "اختر الموظف الجديد..."
        : choice === "addmember"
          ? "اختر العضو لإضافته..."
          : "اختر العضو لإزالته...";
      const userSelect = new UserSelectMenuBuilder()
        .setCustomId(selectId)
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(1);
      return interaction.reply({
        content: "اختر عضواً من القائمة:",
        components: [new ActionRowBuilder().addComponents(userSelect)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (choice === "sendmsg") {
      const modal = new ModalBuilder()
        .setCustomId("ticket_sendmsg_modal")
        .setTitle("📩 Send Message");
      const targetInput = new TextInputBuilder()
        .setCustomId("ticket_msg_target")
        .setLabel("User ID أو @mention (اختياري)")
        .setPlaceholder("اتركه فارغاً للإرسال في التذكرة فقط")
        .setStyle(TextInputStyle.Short)
        .setRequired(false);
      const msgInput = new TextInputBuilder()
        .setCustomId("ticket_msg_content")
        .setLabel("الرسالة")
        .setPlaceholder("اكتب رسالتك هنا...")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(2000)
        .setRequired(true);
      modal.addComponents(
        new ActionRowBuilder().addComponents(targetInput),
        new ActionRowBuilder().addComponents(msgInput),
      );
      return interaction.showModal(modal);
    }
  }

  // ── SELECT: ticket member actions ──
  if (interaction.isUserSelectMenu() && [
    "ticket_transfer_select",
    "ticket_addmember_select",
    "ticket_removemember_select",
  ].includes(interaction.customId)) {
    const selectedId = interaction.values[0];
    const action = interaction.customId.replace("ticket_", "").replace("_select", "");
    try {
      const cfg = loadConfig();
      const allTickets = await db.loadTickets();
      const guildTickets = allTickets[interaction.guild.id] || {};
      const ticketData = guildTickets[interaction.channel.id];
      if (!ticketData) return interaction.reply({ content: "❌ لم يتم العثور على بيانات التذكرة.", flags: MessageFlags.Ephemeral });
      const t = (Array.isArray(cfg.ticketPanels) ? cfg.ticketPanels : []).find((p) => p.id === ticketData.panelId) || {};
      const actorIsStaff = t.staffRoleId
        ? interaction.member.roles.cache.has(t.staffRoleId)
        : interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);
      const actorIsOpener = ticketData.userId === interaction.user.id;
      if (!actorIsStaff && !actorIsOpener) {
        return interaction.reply({ content: "❌ ليس لديك صلاحية إدارة هذه التذكرة.", flags: MessageFlags.Ephemeral });
      }
      const target = await interaction.guild.members.fetch(selectedId).catch(() => null);
      if (!target || target.user.bot) {
        return interaction.reply({ content: "❌ اختر عضواً صالحاً من هذا السيرفر.", flags: MessageFlags.Ephemeral });
      }

      if (action === "transfer") {
        const targetIsStaff = t.staffRoleId
          ? target.roles.cache.has(t.staffRoleId)
          : target.permissions.has(PermissionFlagsBits.ManageChannels);
        if (!targetIsStaff) {
          return interaction.reply({ content: "❌ Transfer يحتاج إلى اختيار عضو من فريق الدعم.", flags: MessageFlags.Ephemeral });
        }
        const previousClaimer = ticketData.claimedBy;
        ticketData.claimedBy = target.id;
        ticketData.claimedAt = Date.now();
        ticketData.transferredFrom = previousClaimer || null;
        await interaction.channel.permissionOverwrites.edit(target.id, {
          ViewChannel: true,
          SendMessages: true,
          AttachFiles: true,
          EmbedLinks: true,
          ReadMessageHistory: true,
        });
        if (previousClaimer && previousClaimer !== ticketData.userId && previousClaimer !== target.id) {
          await interaction.channel.permissionOverwrites.edit(previousClaimer, {
            ViewChannel: true,
            SendMessages: false,
            ReadMessageHistory: true,
          });
        }
        guildTickets[interaction.channel.id] = ticketData;
        allTickets[interaction.guild.id] = guildTickets;
        await db.saveTickets(allTickets);
        return interaction.reply({ content: `✅ تم تحويل التذكرة إلى ${target}.`, flags: MessageFlags.Ephemeral });
      }

      if (action === "addmember") {
        if (selectedId === ticketData.userId || selectedId === ticketData.claimedBy) {
          return interaction.reply({ content: "ℹ️ هذا العضو لديه صلاحية بالفعل.", flags: MessageFlags.Ephemeral });
        }
        await interaction.channel.permissionOverwrites.edit(target.id, {
          ViewChannel: true,
          SendMessages: true,
          AttachFiles: true,
          EmbedLinks: true,
          ReadMessageHistory: true,
        });
        ticketData.addedMembers = Array.isArray(ticketData.addedMembers) ? ticketData.addedMembers : [];
        if (!ticketData.addedMembers.includes(target.id)) ticketData.addedMembers.push(target.id);
        guildTickets[interaction.channel.id] = ticketData;
        allTickets[interaction.guild.id] = guildTickets;
        await db.saveTickets(allTickets);
        return interaction.reply({ content: `✅ تمت إضافة ${target} إلى التذكرة.`, flags: MessageFlags.Ephemeral });
      }

      if (selectedId === ticketData.userId || selectedId === ticketData.claimedBy) {
        return interaction.reply({ content: "❌ لا يمكن إزالة صاحب التذكرة أو الموظف المسؤول.", flags: MessageFlags.Ephemeral });
      }
      await interaction.channel.permissionOverwrites.delete(target.id).catch(() => {});
      ticketData.addedMembers = (Array.isArray(ticketData.addedMembers) ? ticketData.addedMembers : []).filter((id) => id !== target.id);
      guildTickets[interaction.channel.id] = ticketData;
      allTickets[interaction.guild.id] = guildTickets;
      await db.saveTickets(allTickets);
      return interaction.reply({ content: `✅ تمت إزالة ${target} من التذكرة.`, flags: MessageFlags.Ephemeral });
    } catch (err) {
      console.error("[Ticket member action]", err.message);
      return interaction.reply({ content: `❌ فشل تنفيذ العملية: ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  }

  // ── MODAL: ticket rename ──
  if (
    interaction.isModalSubmit() &&
    interaction.customId === "ticket_rename_modal"
  ) {
    const newName =
      interaction.fields
        .getTextInputValue("ticket_new_name")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "ticket";
    try {
      await interaction.channel.setName(newName);
      return interaction.reply({
        content: `✅ تم تغيير اسم التذكرة إلى **${newName}**`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      console.error("[Ticket rename]", err.message);
      return interaction.reply({
        content: `❌ فشل تغيير الاسم: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── MODAL: ticket send message ──
  if (
    interaction.isModalSubmit() &&
    interaction.customId === "ticket_sendmsg_modal"
  ) {
    const rawTarget = interaction.fields
      .getTextInputValue("ticket_msg_target")
      .trim();
    const msgContent = interaction.fields
      .getTextInputValue("ticket_msg_content")
      .trim();

    // Build the embed to send in the channel
    const sendEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setDescription(msgContent)
      .setFooter({
        text: `من: ${interaction.user.username}`,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTimestamp();

    // If a user ID or <@id> was provided, mention them
    let mention = "";
    if (rawTarget) {
      const userId = rawTarget.replace(/[^0-9]/g, "");
      if (userId) mention = `<@${userId}>`;
    }

    try {
      await interaction.channel.send({
        content: mention || undefined,
        embeds: [sendEmbed],
      });
      return interaction.reply({
        content: "✅ تم إرسال الرسالة بنجاح.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      console.error("[Ticket sendmsg]", err.message);
      return interaction.reply({
        content: `❌ فشل إرسال الرسالة: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── SELECT: boost ticket menu ──
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "boost_ticket_menu"
  ) {
    const ticket = boostTickets.get(interaction.channelId);
    if (!ticket || ticket.userId !== interaction.user.id) {
      return interaction.reply({
        content: "❌ غير مصرح.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const choice = interaction.values[0];
    await interaction.update({
      content: `اخترت: **${choice === "create" ? "إنشاء رتبة" : choice === "rename" ? "تغيير الاسم" : choice === "emoji" ? "تغيير الإيموجي" : choice === "color" ? "تغيير اللون" : "حذف الرتبة"}**`,
      components: [],
    });

    // Delete — show confirm buttons
    if (choice === "delete") {
      const cfg = loadConfig();
      const rd = cfg.boost?.roles?.[interaction.user.id];
      if (!rd?.roleId)
        return closeBoostTicket(interaction.channelId, "ما عندك رتبة لحذفها.");
      ticket.stage = "preview";
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("boost_delete_confirm")
          .setLabel("تأكيد الحذف")
          .setEmoji("🗑️")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("boost_delete_cancel")
          .setLabel("إلغاء")
          .setEmoji("❌")
          .setStyle(ButtonStyle.Secondary),
      );
      return interaction.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff0000)
            .setDescription(
              "⚠️ **هل أنت متأكد من حذف رتبتك؟**\nهذا الإجراء لا يمكن التراجع عنه.",
            ),
        ],
        components: [confirmRow],
      });
    }

    // Start conversational stages
    const prompts = {
      create: {
        stage: "create_name",
        msg: "📝 **ما اسم الرتبة؟**\nاكتبه هنا:",
      },
      rename: { stage: "rename_name", msg: "📝 **ما الاسم الجديد للرتبة؟**" },
      emoji: {
        stage: "emoji_val",
        msg: "😀 **أرسل الإيموجي للرتبة.**\nيمكنك إرسال إيموجي من **أي سيرفر**، إيموجي عادي، أو اكتب `none` لإزالته.",
      },
      color: {
        stage: "color_val",
        msg: "🎨 **ما اللون الجديد؟**\nمثال: `pink` `red` `blue` `gold` `purple` أو كود هيكس مثل `#FF73FA`",
      },
    };
    const p = prompts[choice];
    if (!p) return;
    ticket.stage = p.stage;
    ticket.data.action = choice;
    await interaction.channel.send(p.msg);
  }

  // ── BUTTON: boost preview — change ──
  if (
    interaction.isButton() &&
    interaction.customId === "boost_preview_change"
  ) {
    const ticket = boostTickets.get(interaction.channelId);
    if (!ticket || ticket.userId !== interaction.user.id)
      return interaction.reply({
        content: "❌ غير مصرح.",
        flags: MessageFlags.Ephemeral,
      });
    ticket.stage = "menu";
    const changeRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("boost_ticket_change_menu")
        .setPlaceholder("ماذا تريد تغييره؟")
        .addOptions([
          {
            label: "تغيير اسم الرتبة",
            value: "rename",
            description: "عدّل اسم رتبتك",
            emoji: { id: "1531641643390865678", name: "rename" },
          },
          {
            label: "تغيير إيموجي الرتبة",
            value: "emoji",
            description: "غيّر إيموجي من أي سيرفر",
            emoji: { id: "1531643997095989358", name: "roleicon" },
          },
          {
            label: "تغيير لون الرتبة",
            value: "color",
            description: "غيّر لون رتبتك",
            emoji: { name: "🎨" },
          },
        ]),
    );
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setDescription("اختر ما تريد تغييره:"),
      ],
      components: [changeRow],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── SELECT: boost preview change menu ──
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "boost_ticket_change_menu"
  ) {
    const ticket = boostTickets.get(interaction.channelId);
    if (!ticket || ticket.userId !== interaction.user.id)
      return interaction.reply({
        content: "❌ غير مصرح.",
        flags: MessageFlags.Ephemeral,
      });
    const choice = interaction.values[0];
    await interaction.update({ embeds: [], components: [], content: " " });
    const prompts = {
      rename: { stage: "rename_name", msg: "📝 **ما الاسم الجديد للرتبة؟**" },
      emoji: {
        stage: "emoji_val",
        msg: "😀 **أرسل الإيموجي الجديد.**\nيمكنك إرسال إيموجي من **أي سيرفر**، أو اكتب `none` لإزالته.",
      },
      color: {
        stage: "color_val",
        msg: "🎨 **ما اللون الجديد؟**\nمثال: `pink` `red` `blue` `gold` أو كود هيكس مثل `#FF73FA`",
      },
    };
    const p = prompts[choice];
    if (!p) return;
    ticket.stage = p.stage;
    ticket.data.action = choice;
    await interaction.channel.send(p.msg);
  }

  // ── BUTTON: boost preview — delete (confirm) ──
  if (
    interaction.isButton() &&
    interaction.customId === "boost_delete_confirm"
  ) {
    const ticket = boostTickets.get(interaction.channelId);
    if (!ticket || ticket.userId !== interaction.user.id)
      return interaction.reply({
        content: "❌ غير مصرح.",
        flags: MessageFlags.Ephemeral,
      });
    await interaction.update({
      embeds: [],
      components: [],
      content: "🗑️ جارٍ حذف الرتبة...",
    });
    const cfg = loadConfig();
    const rd = cfg.boost?.roles?.[interaction.user.id];
    if (!rd?.roleId)
      return closeBoostTicket(interaction.channelId, "ما وجدت رتبتك.");
    try {
      const role = interaction.guild.roles.cache.get(rd.roleId);
      if (role) await role.delete("Booster deleted their role").catch(() => {});
      delete cfg.boost.roles[interaction.user.id];
      saveConfig(cfg);
      return closeBoostTicket(interaction.channelId, "تم حذف رتبتك بنجاح! 🗑️");
    } catch (err) {
      return failBoostTicket(
        interaction.channelId,
        `فشل الحذف: ${err.message}`,
      );
    }
  }

  // ── BUTTON: boost preview — delete cancel ──
  if (
    interaction.isButton() &&
    interaction.customId === "boost_delete_cancel"
  ) {
    const ticket = boostTickets.get(interaction.channelId);
    if (!ticket || ticket.userId !== interaction.user.id)
      return interaction.reply({
        content: "❌ غير مصرح.",
        flags: MessageFlags.Ephemeral,
      });
    ticket.stage = "preview";
    await interaction.update({
      embeds: [],
      components: [],
      content: "↩️ تم إلغاء الحذف.",
    });
    return sendBoostRolePreview(
      interaction.channel,
      interaction.user.id,
      interaction.guild,
    );
  }

  // ── BUTTON: boost preview — done ──
  if (interaction.isButton() && interaction.customId === "boost_preview_done") {
    const ticket = boostTickets.get(interaction.channelId);
    if (!ticket || ticket.userId !== interaction.user.id)
      return interaction.reply({
        content: "❌ غير مصرح.",
        flags: MessageFlags.Ephemeral,
      });
    await interaction.update({ components: [] });
    return closeBoostTicket(interaction.channelId, "تم! رتبتك جاهزة. ✅");
  }

  if (!interaction.isChatInputCommand()) return;
  try {
    await handleChatCommand(interaction);
  } catch (err) {
    console.error(
      `[Interaction ${interaction.commandName}${interaction.guildId ? ` in ${interaction.guildId}` : " in DM"}]`,
      err,
    );
    // Discord may have already invalidated or acknowledged the interaction.
    // Do not issue a second response in those cases.
    if (err?.code === 10062 || err?.code === 40060) return;
    const errorMessage =
      "❌ Something went wrong while running this command. Please try again.";
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: errorMessage,
          embeds: [],
          components: [],
          files: [],
        });
      } else {
        await interaction.reply({ content: errorMessage });
      }
    } catch (replyErr) {
      console.error("[Interaction error reply]", replyErr.message);
    }
  }
});

async function handleChatCommand(interaction) {
  const { commandName } = interaction;
  const inDM = !interaction.guild;

  if (
    !inDM &&
    !checkPermission(commandName, interaction.member, interaction.channelId)
  ) {
    const cfg = loadConfig();
    if (!cfg.commands?.[commandName]?.enabled) {
      return interaction.reply({
        content: "هذا الأمر معطل حالياً.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({
      content: "ما عندك صلاحية لاستخدام هذا الأمر.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Server reaction commands still need the same acknowledgement, but DM
  // reaction commands are already deferred at the top of InteractionCreate.
  if (
    !inDM &&
    (RP_CMDS[commandName] || EMOTION_CMDS[commandName]) &&
    !interaction.deferred &&
    !interaction.replied
  ) {
    await interaction.deferReply();
  }

  // ── AFK ──
  if (commandName === "afk") {
    if (!interaction.guild || !interaction.member) {
      return interaction.reply({ content: "❌ AFK يعمل داخل السيرفر فقط.", flags: MessageFlags.Ephemeral });
    }
    const reason = (interaction.options.getString("reason") || "AFK").trim().slice(0, 200) || "AFK";
    const previousNickname = interaction.member.nickname ?? null;
    await db.saveAfkState(
      interaction.guildId,
      interaction.user.id,
      interaction.user.username,
      reason,
      previousNickname,
    );
    const nicknameResult = await interaction.member
      .setNickname(`[AFK] ${interaction.member.displayName}`.slice(0, 32), 'AFK enabled')
      .then(() => true)
      .catch(() => false);
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle("💤 AFK enabled")
        .setDescription(`أنت الآن في وضع AFK.\n**السبب:** ${reason}`)
        .addFields({ name: "الحالة", value: nicknameResult ? "تم تحديث الاسم إلى [AFK]" : "تم الحفظ، لكن لا أستطيع تغيير الاسم" })
        .setTimestamp()],
    });
  }

  // ── ROULETTE ──
  // ── NICKNAME ──
  
  if (commandName === "resetstaffpoints") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: "❌ هذا الأمر يتطلب صلاحية إدارة السيرفر.", flags: MessageFlags.Ephemeral });
    }
    await db.resetStaffPoints(interaction.guildId);
    return interaction.reply({ content: "✅ تم تصفير نقاط فريق الإدارة بالكامل." });
  }

  if (commandName === "nickname") {
    if (!interaction.guild || !interaction.member) {
      return interaction.reply({ content: "❌ هذا الأمر يعمل داخل السيرفر فقط.", flags: MessageFlags.Ephemeral });
    }
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      return interaction.reply({ content: "❌ تحتاج صلاحية Manage Nicknames لاستخدام هذا الأمر.", flags: MessageFlags.Ephemeral });
    }
    const target = interaction.options.getMember("user") || interaction.member;
    const rawName = (interaction.options.getString("name") || "").trim();
    if (!target) {
      return interaction.reply({ content: "❌ العضو غير موجود في هذا السيرفر.", flags: MessageFlags.Ephemeral });
    }
    const resetNickname = !rawName || ["reset", "original", "اصلي", "الأصلي", "الاصلي"].includes(rawName.toLowerCase());
    if (target.id === interaction.guild.ownerId) {
      return interaction.reply({ content: "❌ لا يمكن تغيير اسم مالك السيرفر.", flags: MessageFlags.Ephemeral });
    }
    const me = interaction.guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      return interaction.reply({ content: "❌ البوت لا يملك صلاحية Manage Nicknames.", flags: MessageFlags.Ephemeral });
    }
    if (target.roles.highest.position >= me.roles.highest.position) {
      return interaction.reply({ content: "❌ رتبة العضو أعلى من أو مساوية لرتبة البوت.", flags: MessageFlags.Ephemeral });
    }
    try {
      if (resetNickname) {
        await target.setNickname(null, `Nickname reset by ${interaction.user.tag}`);
        return interaction.reply({ content: `✅ تم إرجاع اسم ${target} إلى الاسم الأصلي **${target.user.username}**`, flags: MessageFlags.Ephemeral });
      }
      const nextNickname = rawName.slice(0, 32);
      await target.setNickname(nextNickname, `Nickname changed by ${interaction.user.tag}`);
      return interaction.reply({ content: `✅ تم تغيير اسم ${target} إلى **${nextNickname}**`, flags: MessageFlags.Ephemeral });
    } catch (err) {
      console.error('[nickname]', err.message);
      return interaction.reply({ content: "❌ لم أستطع تغيير الاسم. تحقق من صلاحيات البوت وترتيب الرتب.", flags: MessageFlags.Ephemeral });
    }
  }

  if (commandName === "roulette") {
    if (!interaction.guild) {
      return interaction.reply({
        content: "❌ Roulette can only be started inside a server.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return startRouletteGame(interaction);
  }

  // ── ROULETTE STOP ──
  if (commandName === "توقيف") {
    if (!interaction.guild) {
      return interaction.reply({
        content: "❌ هذا الأمر يعمل داخل السيرفر فقط.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return stopRouletteGame(interaction);
  }

  // ── WARN ──
  if (commandName === "warn") {
    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)
    ) {
      return interaction.reply({
        content:
          "You need the Moderate Members permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const target = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason");
    if (!target)
      return interaction.reply({
        content: "Member not found in this server.",
        flags: MessageFlags.Ephemeral,
      });
    if (target.id === interaction.user.id)
      return interaction.reply({
        content: "You cannot warn yourself.",
        flags: MessageFlags.Ephemeral,
      });
    if (target.id === client.user.id)
      return interaction.reply({
        content: "You cannot warn me.",
        flags: MessageFlags.Ephemeral,
      });

    const warns = await loadWarnings();
    if (!warns[interaction.guildId]) warns[interaction.guildId] = {};
    if (!warns[interaction.guildId][target.id])
      warns[interaction.guildId][target.id] = [];
    warns[interaction.guildId][target.id].push({
      reason,
      moderator: interaction.user.id,
      moderatorTag: interaction.user.tag,
      timestamp: Date.now(),
    });
    await saveWarnings(warns);

    const count = warns[interaction.guildId][target.id].length;

    // Log warning
    const logsCfg = loadConfig().logs || {};
    const logChannel = logsCfg.warningChannelId
      ? interaction.guild.channels.cache.get(logsCfg.warningChannelId)
      : null;
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle("⚠️ تحذير جديد")
        .addFields(
          { name: "العضو", value: `${target.user?.tag || target.displayName || target.user?.username}`, inline: true },
          { name: "بواسطة", value: `${interaction.user.tag}`, inline: true },
          { name: "السبب", value: reason || "بدون سبب" },
          { name: "إجمالي التحذيرات", value: `${count}`, inline: true },
        )
        .setTimestamp();
      logChannel.send({ embeds: [embed], allowedMentions: { users: [] } }).catch(() => {});
    }

    try {
      await target
        .send(
          `You have received a warning in **${interaction.guild.name}**.\nReason: ${reason}\nTotal warnings: ${count}`,
        )
        .catch(() => {});
    } catch {}
    return interaction.reply({
      content: `Warning issued to **${target.user.tag}**. Reason: ${reason}. They now have ${count} warning(s).`,
      ephemeral: false,
    });
  }

  // ── WARNINGS ──
  if (commandName === "warnings") {
    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)
    ) {
      return interaction.reply({
        content:
          "You need the Moderate Members permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const target = interaction.options.getUser("user") || interaction.user;
    const warns = await loadWarnings();
    const userWarns = warns[interaction.guildId]?.[target.id] || [];
    if (userWarns.length === 0) {
      return interaction.reply({
        content: `**${target.tag}** has no warnings.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    const list = userWarns
      .map((w, i) => {
        const date = new Date(w.timestamp).toUTCString();
        return `${i + 1}. **${w.reason}** — by ${w.moderatorTag} on ${date}`;
      })
      .join("\n");
    return interaction.reply({
      content: `**Warnings for ${target.tag} (${userWarns.length} total):**\n${list}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── CLEARWARNS ──
  if (commandName === "clearwarns") {
    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)
    ) {
      return interaction.reply({
        content:
          "You need the Moderate Members permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const target = interaction.options.getUser("user");
    if (!target)
      return interaction.reply({
        content: "يرجى منشن المستخدم لمسح تحذيراته.",
        flags: MessageFlags.Ephemeral,
      });
    const warns = await loadWarnings();
    if (!warns[interaction.guildId]?.[target.id]?.length) {
      return interaction.reply({
        content: `**${target.tag}** has no warnings to clear.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    const count = warns[interaction.guildId][target.id].length;
    warns[interaction.guildId][target.id] = [];
    await saveWarnings(warns);

    // Log clear warns
    const logsCfg = loadConfig().logs || {};
    const logChannel = logsCfg.warningChannelId
      ? interaction.guild.channels.cache.get(logsCfg.warningChannelId)
      : null;
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ سحب تحذيرات")
        .addFields(
          { name: "العضو", value: `${target.tag || target.username}`, inline: true },
          { name: "بواسطة", value: `${interaction.user.tag}`, inline: true },
          { name: "العدد المسحوب", value: `${count}`, inline: true },
        )
        .setTimestamp();
      logChannel.send({ embeds: [embed], allowedMentions: { users: [] } }).catch(() => {});
    }

    return interaction.reply({
      content: `All warnings for **${target.tag}** have been cleared.`,
      ephemeral: false,
    });
  }

  // ── MUTE ──
  if (commandName === "mute") {
    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)
    ) {
      return interaction.reply({
        content:
          "You need the Moderate Members permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const target = interaction.options.getMember("user");
    const durationInput = interaction.options.getString("duration") ?? interaction.options.getInteger("duration");
    const durationMs = parseDuration(durationInput);
    if (!durationMs || durationMs > 28 * 24 * 60 * 60 * 1000) {
      return interaction.reply({
        content: "Duration must be between 1s and 28d. Examples: `30s`, `1m`, `1h`, `1d`, `1d 2h`.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const durationLabel = formatDuration(durationMs);
    const reason =
      interaction.options.getString("reason") || "No reason provided";
    if (!target)
      return interaction.reply({
        content: "Member not found in this server.",
        flags: MessageFlags.Ephemeral,
      });
    if (target.id === interaction.user.id)
      return interaction.reply({
        content: "You cannot mute yourself.",
        flags: MessageFlags.Ephemeral,
      });
    if (!target.moderatable)
      return interaction.reply({
        content:
          "I cannot mute this member. They may have a higher role than me.",
        flags: MessageFlags.Ephemeral,
      });

    try {
      await target.timeout(durationMs, reason);
      await target
        .send(
          `You have been muted in **${interaction.guild.name}** for ${durationLabel}.\nReason: ${reason}`,
        )
        .catch(() => {});
      return interaction.reply({
        content: `**${target.user.tag}** has been muted for ${durationLabel}. Reason: ${reason}`,
        ephemeral: false,
      });
    } catch (err) {
      console.error("Mute error:", err);
      return interaction.reply({
        content: "Failed to mute this member.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── UNMUTE ──
  if (commandName === "unmute") {
    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)
    ) {
      return interaction.reply({
        content:
          "You need the Moderate Members permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const target = interaction.options.getMember("user");
    if (!target)
      return interaction.reply({
        content: "Member not found in this server.",
        flags: MessageFlags.Ephemeral,
      });
    if (!target.isCommunicationDisabled()) {
      return interaction.reply({
        content: `**${target.user.tag}** is not currently muted.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    try {
      await target.timeout(null);
      return interaction.reply({
        content: `**${target.user.tag}** has been unmuted.`,
        ephemeral: false,
      });
    } catch (err) {
      console.error("Unmute error:", err);
      return interaction.reply({
        content: "Failed to unmute this member.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── TIMEOUT ──
  if (commandName === "timeout") {
    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)
    ) {
      return interaction.reply({
        content:
          "You need the Moderate Members permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const target = interaction.options.getMember("user");
    const durationInput = interaction.options.getString("duration") ?? interaction.options.getInteger("duration");
    const durationMs = parseDuration(durationInput);
    const durationLabel = durationMs ? formatDuration(durationMs) : null;
    const reason = interaction.options.getString("reason") || "بدون سبب";
    if (!durationMs || durationMs > 28 * 24 * 60 * 60 * 1000)
      return interaction.reply({
        content: "المدة يجب أن تكون بين 1s و28d. أمثلة: `30s` أو `1m` أو `1h` أو `1d 2h`.",
        flags: MessageFlags.Ephemeral,
      });
    if (!target)
      return interaction.reply({
        content: "العضو غير موجود.",
        flags: MessageFlags.Ephemeral,
      });
    if (target.id === interaction.user.id)
      return interaction.reply({
        content: "لا يمكنك كتم نفسك.",
        flags: MessageFlags.Ephemeral,
      });
    if (!target.moderatable)
      return interaction.reply({
        content: "لا أستطيع كتم هذا العضو. قد تكون رتبته أعلى مني.",
        flags: MessageFlags.Ephemeral,
      });
    try {
      await target.timeout(durationMs, reason);
      await target
        .send(
          `تم كتمك في **${interaction.guild.name}** لمدة ${durationLabel}.\nالسبب: ${reason}`,
        )
        .catch(() => {});
      return interaction.reply({
        content: `🔇 تم كتم **${target.user.tag}** لمدة **${durationLabel}**.\nالسبب: ${reason}`,
        ephemeral: false,
      });
    } catch (err) {
      console.error("Timeout error:", err);
      return interaction.reply({
        content: "فشل الكتم.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── KICK ──
  if (commandName === "kick") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.KickMembers)) {
      return interaction.reply({
        content: "You need the Kick Members permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const target = interaction.options.getMember("user");
    const reason =
      interaction.options.getString("reason") || "No reason provided";
    if (!target)
      return interaction.reply({
        content: "Member not found in this server.",
        flags: MessageFlags.Ephemeral,
      });
    if (target.id === interaction.user.id)
      return interaction.reply({
        content: "You cannot kick yourself.",
        flags: MessageFlags.Ephemeral,
      });
    if (!target.kickable)
      return interaction.reply({
        content:
          "I cannot kick this member. They may have a higher role than me.",
        flags: MessageFlags.Ephemeral,
      });

    try {
      await target
        .send(
          `You have been kicked from **${interaction.guild.name}**.\nReason: ${reason}`,
        )
        .catch(() => {});
      await target.kick(reason);
      const logsCfg = loadConfig().logs || {};
      const logChannelId = logsCfg.kickChannelId || logsCfg.generalChannelId;
      const logChannel = logChannelId ? interaction.guild.channels.cache.get(logChannelId) : null;
      if (logChannel) {
        const embed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle("👢 Member kicked")
          .addFields(
            { name: "Member", value: `${target.user.tag}\n\`${target.id}\``, inline: true },
            { name: "Moderator", value: interaction.user.tag, inline: true },
            { name: "Reason", value: reason },
          )
          .setTimestamp();
        logChannel.send({ embeds: [embed], allowedMentions: { users: [] } }).catch(() => {});
      }
      return interaction.reply({
        content: `**${target.user.tag}** has been kicked. Reason: ${reason}`,
        ephemeral: false,
      });
    } catch (err) {
      console.error("Kick error:", err);
      return interaction.reply({
        content: "Failed to kick this member.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── BAN ──
  if (commandName === "ban") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
      return interaction.reply({
        content: "You need the Ban Members permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const targetUser = interaction.options.getUser("user");
    const targetMember = interaction.options.getMember("user"); // null if not in server
    const reason = interaction.options.getString("reason") || "بدون سبب";
    const timeStr = interaction.options.getString("time") ?? null;
    const deleteDays = interaction.options.getInteger("delete_days") ?? 0;

    if (!targetUser)
      return interaction.reply({
        content: "العضو غير موجود.",
        flags: MessageFlags.Ephemeral,
      });
    if (targetUser.id === interaction.user.id)
      return interaction.reply({
        content: "لا يمكنك حظر نفسك.",
        flags: MessageFlags.Ephemeral,
      });

    // Parse optional duration: 30m, 2h, 7d
    const banDurationMs = parseDuration(timeStr);
    const banDurationLabel = banDurationMs ? formatDuration(banDurationMs) : null;
    if (timeStr && !banDurationMs) {
      return interaction.reply({
        content: "Invalid duration. Examples: `30s`, `1m`, `1h`, `1d`, `1d 2h`.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (targetMember && !targetMember.bannable) {
      return interaction.reply({
        content: "لا أستطيع حظر هذا العضو. قد يكون رتبته أعلى مني.",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      if (targetMember) {
        const dmMsg = banDurationMs
          ? `تم حظرك من **${interaction.guild.name}** لمدة **${banDurationLabel}**.\nالسبب: ${reason}`
          : `تم حظرك من **${interaction.guild.name}**.\nالسبب: ${reason}`;
        await targetUser.send(dmMsg).catch(() => {});
      }
      await interaction.guild.bans.create(targetUser.id, {
        reason,
        deleteMessageSeconds: deleteDays * 86400,
      });

      const durationNote = banDurationMs ? ` لمدة **${banDurationLabel}**` : " (دائم)";
      await interaction.reply({
        content: `🔨 تم حظر **${targetUser.tag}**${durationNote}.\nالسبب: ${reason}`,
        ephemeral: false,
      });

      // Schedule auto-unban for temp bans
      if (banDurationMs) {
        scheduleTimeout(async () => {
          try {
            await interaction.guild.bans.remove(
              targetUser.id,
              "انتهاء مدة الحظر المؤقت",
            );
            interaction.channel
              ?.send(
                `✅ انتهت مدة الحظر المؤقت — تم رفع الحظر عن **${targetUser.tag}**.`,
              )
              .catch(() => {});
          } catch {}
        }, banDurationMs);
      }
    } catch (err) {
      console.error("Ban error:", err);
      return interaction.reply({
        content: `فشل الحظر: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── UNBAN ──
  if (commandName === "unban") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
      return interaction.reply({
        content: "You need the Ban Members permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const userId = interaction.options.getString("user_id").trim();
    const reason =
      interaction.options.getString("reason") || "No reason provided";
    if (!/^\d{17,20}$/.test(userId)) {
      return interaction.reply({
        content: "Invalid user ID. Please provide a valid Discord user ID.",
        flags: MessageFlags.Ephemeral,
      });
    }
    try {
      const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
      if (!ban)
        return interaction.reply({
          content: "That user is not banned in this server.",
          flags: MessageFlags.Ephemeral,
        });
      await interaction.guild.members.unban(userId, reason);
      return interaction.reply({
        content: `**${ban.user.tag}** has been unbanned. Reason: ${reason}`,
        ephemeral: false,
      });
    } catch (err) {
      console.error("Unban error:", err);
      return interaction.reply({
        content:
          "Failed to unban. Make sure the user ID is correct and the user is banned.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── GIVE ROLE ──
  if (commandName === "giverole") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: "You need the Manage Roles permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const target = interaction.options.getMember("user");
    const role = interaction.options.getRole("role");
    if (!target)
      return interaction.reply({
        content: "Member not found in this server.",
        flags: MessageFlags.Ephemeral,
      });
    if (!role)
      return interaction.reply({
        content: "Role not found.",
        flags: MessageFlags.Ephemeral,
      });
    if (role.managed)
      return interaction.reply({
        content:
          "❌ That role is managed by an integration and cannot be assigned manually.",
        flags: MessageFlags.Ephemeral,
      });
    if (role.position >= interaction.guild.members.me.roles.highest.position) {
      return interaction.reply({
        content:
          "❌ That role is higher than or equal to my highest role. I can't manage it.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const hasRole = target.roles.cache.has(role.id);
    if (hasRole && interaction.isMock) {
      try {
        await target.roles.remove(role);
        return interaction.reply({
          content: `✅ Removed **${role.name}** from **${target.user.tag}**.`,
        });
      } catch (err) {
        return interaction.reply({
          content: `❌ Failed: ${err.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
    if (hasRole) {
      return interaction.reply({
        content: `**${target.user.tag}** already has the **${role.name}** role.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    try {
      await target.roles.add(role);
      return interaction.reply({
        content: `✅ Gave **${role.name}** to **${target.user.tag}**.`,
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ Failed: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── REMOVE ROLE ──
  if (commandName === "removerole") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: "You need the Manage Roles permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const target = interaction.options.getMember("user");
    const role = interaction.options.getRole("role");
    if (!target)
      return interaction.reply({
        content: "Member not found in this server.",
        flags: MessageFlags.Ephemeral,
      });
    if (!role)
      return interaction.reply({
        content: "Role not found.",
        flags: MessageFlags.Ephemeral,
      });
    if (role.managed)
      return interaction.reply({
        content:
          "❌ That role is managed by an integration and cannot be assigned manually.",
        flags: MessageFlags.Ephemeral,
      });
    if (role.position >= interaction.guild.members.me.roles.highest.position) {
      return interaction.reply({
        content:
          "❌ That role is higher than or equal to my highest role. I can't manage it.",
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!target.roles.cache.has(role.id)) {
      return interaction.reply({
        content: `**${target.user.tag}** doesn't have the **${role.name}** role.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    try {
      await target.roles.remove(role);
      return interaction.reply({
        content: `✅ Removed **${role.name}** from **${target.user.tag}**.`,
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ Failed: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── DELETE MESSAGES ──
  if (commandName === "deletemsg") {
    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)
    ) {
      return interaction.reply({
        content: "You need the Manage Messages permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const amount = interaction.options.getInteger("amount");
    const filterUser = interaction.options.getUser("user");
    try {
      let messages = await interaction.channel.messages.fetch({
        limit: filterUser ? 100 : amount,
      });
      if (filterUser) {
        messages = messages
          .filter((m) => m.author.id === filterUser.id)
          .first(amount);
      }
      const deleted = await interaction.channel.bulkDelete(messages, true);
      const note =
        deleted.size < amount
          ? ` (${amount - deleted.size} messages were older than 14 days and could not be deleted)`
          : "";
      return interaction.reply({
        content: `✅ Deleted **${deleted.size}** message${deleted.size === 1 ? "" : "s"}${note}.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ Failed: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── GAMES ──
  if (commandName === "numguess") {
    const result = numguessStart(interaction.channel, interaction.user);
    if (result.error)
      return interaction.reply({
        content: result.error,
        flags: MessageFlags.Ephemeral,
      });
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x6c5ce7)
          .setTitle("🔢 Number Guessing Game!")
          .setDescription(
            "I've picked a number between **1** and **100**.\nType your guess in chat!\n\n⏰ You have **2 minutes**.",
          )
          .setFooter({ text: `Started by ${interaction.user.username}` }),
      ],
    });
  }

  if (commandName === "trivia") {
    return triviaStart(interaction);
  }

  if (commandName === "blackjack") {
    return blackjackStart(interaction);
  }

  if (commandName === "minesweeper") {
    return minesweeperStart(interaction);
  }

  if (commandName === "slots") {
    return slotsStart(interaction);
  }

  if (commandName === "cat") {
    return catStart(interaction);
  }

  if (commandName === "race") {
    if (inDM) {
      return raceDM(interaction).catch((err) => {
        console.error("[Race DM]", err.message);
        interaction.editReply({ content: `❌ ${err.message}` }).catch(() => {});
      });
    }
    // In a server, opponent is required
    if (!interaction.options.getUser("user")) {
      return interaction.reply({
        content: "❌ حدد العضو الذي تريد تحديه!",
        flags: MessageFlags.Ephemeral,
      });
    }
    return raceChallenge(interaction).catch((err) => {
      console.error("[Race]", err.message);
      interaction
        .reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    });
  }

  // ── BIRTHDAY ──
  if (commandName === "birthday") {
    return handleBirthday(interaction).catch((err) => {
      console.error("[Birthday]", err.message);
      interaction
        .reply({ content: "❌ حدث خطأ.", flags: MessageFlags.Ephemeral })
        .catch(() => {});
    });
  }

  // ── DOWN ──
  if (commandName === "down") {
    if (interaction.guild) {
      return interaction.reply({
        content: "❌ This command only works in DMs.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const link = interaction.options.getString("link");

    // Quick validation — must look like a supported URL
    const SUPPORTED =
      /https?:\/\/(?:(?:www\.|vm\.|vt\.|m\.)?(?:tiktok\.com|instagram\.com|youtube\.com|youtu\.be))/i;
    if (!SUPPORTED.test(link)) {
      return interaction.reply({
        content:
          "❌ Unsupported link. Please send an Instagram, TikTok, or YouTube link.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!process.env.COBALT_API_URL) {
      return interaction.reply({
        content:
          "❌ Download service is not configured yet (COBALT_API_URL missing).",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      const media = await resolveMedia(link);

      // Try to upload the file directly if it's small enough
      try {
        const buffer = await downloadMediaBuffer(media.url, MAX_UPLOAD_BYTES);
        const attachment = new AttachmentBuilder(buffer, {
          name: media.filename || "video.mp4",
        });
        return interaction.editReply({
          content: "✅ Here you go!",
          files: [attachment],
        });
      } catch {
        // File too large — send the direct download link instead
        return interaction.editReply({
          content: `✅ The file is too large to upload directly. Here's your direct download link:\n[LINK](${media.url})`,
        });
      }
    } catch (err) {
      console.error("[/down] failed:", err.message);
      return interaction.editReply({
        content: `❌ Could not download this video. It might be private, deleted, or temporarily unavailable.\n\`${err.message}\``,
      });
    }
  }

  // ── SHIP ──
  if (commandName === "ship") {
    await interaction.deferReply();
    const user1 = interaction.options.getUser("user1");
    const user2 = interaction.options.getUser("user2") || interaction.user;
    if (!user1)
      return interaction.editReply({
        content: "يرجى منشن شخص واحد على الأقل.",
      });

    if (user1.id === user2.id) {
      return interaction.editReply({
        content: "You cannot ship someone with themselves.",
      });
    }

    const score = Number((BigInt(user1.id) + BigInt(user2.id)) % 101n);

    try {
      const buffer = await generateShipCard({
        user1: {
          username: user1.username,
          avatarUrl: user1.displayAvatarURL({ extension: "png", size: 256 }),
        },
        user2: {
          username: user2.username,
          avatarUrl: user2.displayAvatarURL({ extension: "png", size: 256 }),
        },
        score,
      });
      return interaction.editReply({
        files: [new AttachmentBuilder(buffer, { name: "ship.png" })],
      });
    } catch (err) {
      console.error("Ship card error:", err);
      return interaction.editReply({
        content: "Failed to generate ship card.",
      });
    }
  }

  // ── GIVEAWAY ──
  if (commandName === "giveaway") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "You need the Manage Server permission to start a giveaway.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const prize = interaction.options.getString("prize");
    const durationInput = interaction.options.getString("duration") ?? interaction.options.getInteger("duration");
    const durationMs = parseDuration(durationInput);
    if (!durationMs || durationMs > 30 * 24 * 60 * 60 * 1000) {
      return interaction.reply({
        content: "Duration must be between 1s and 30d. Examples: `30s`, `1m`, `1h`, `1d`, `1d 2h`.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const winnersCount = interaction.options.getInteger("winners") || 1;
    const endsAt = Date.now() + durationMs;
    const giveawayData = {
      prize,
      winners: winnersCount,
      entries: new Set(),
      endsAt,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      hostId: interaction.user.id,
      hostUsername: interaction.user.username,
    };
    const embed = buildGiveawayEmbed(giveawayData);
    const placeholderRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("giveaway_enter_pending").setLabel("🎉").setStyle(ButtonStyle.Primary));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const msg = await interaction.channel.send({
      __legacyEmbed: true,
      embeds: [embed],
      components: [placeholderRow],
      allowedMentions: { parse: [], roles: [], repliedUser: false },
    });
    const realRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway_enter_${msg.id}`).setLabel("🎉").setStyle(ButtonStyle.Primary));
    await msg.edit({ __legacyEmbed: true, components: [realRow], allowedMentions: { parse: [], roles: [], repliedUser: false } });
    await interaction.deleteReply().catch(() => {});
    activeGiveaways.set(msg.id, giveawayData);
    await db.saveGiveaway(msg.id, giveawayData, 'active');
    setTimeout(() => endGiveaway(msg.id).catch(err => console.error('[Giveaway] End failed:', err.message)), durationMs);
    return;
  }

  // ── GIVEAWAY REROLL ──
  if (commandName === "giveaway-reroll") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: "You need the Manage Server permission to reroll a giveaway.", flags: MessageFlags.Ephemeral });
    }
    const messageId = interaction.options.getString("message_id");
    const saved = completedGiveaways.get(messageId);
    if (!saved) {
      return interaction.reply({ content: "Giveaway history was not found. Use the message ID of a giveaway that ended after this update.", flags: MessageFlags.Ephemeral });
    }
    const candidates = saved.entries.filter((id) => !(saved.lastWinners || []).includes(id));
    const pool = candidates.length ? candidates : saved.entries;
    if (!pool.length) {
      return interaction.reply({ content: "Nobody entered this giveaway, so there is nobody to reroll.", flags: MessageFlags.Ephemeral });
    }
    const winnerId = pool[Math.floor(Math.random() * pool.length)];
    saved.lastWinners = [winnerId];
    saved.rerolls = (saved.rerolls || 0) + 1;
    completedGiveaways.set(messageId, saved);
    await saveCompletedGiveaway(messageId, saved);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.channel.send({ content: `🎉 Reroll! Congratulations <@${winnerId}> — you won **${saved.prize}**!`, allowedMentions: { users: [winnerId] } });
    await interaction.deleteReply().catch(() => {});
    return;
  }
  // ── JAIL (سجن) ──
  if (commandName === "سجن") {
    const cfg = loadConfig();
    if (!canManageJail(interaction.member, cfg)) {
      return interaction.reply({
        content: "ما عندك صلاحية تسجن الأعضاء.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const target = interaction.options.getMember("user");
    if (!target)
      return interaction.reply({
        content: "العضو غير موجود.",
        flags: MessageFlags.Ephemeral,
      });
    if (target.id === interaction.user.id)
      return interaction.reply({
        content: "ما تقدر تسجن نفسك.",
        flags: MessageFlags.Ephemeral,
      });
    if (target.id === client.user.id)
      return interaction.reply({
        content: "ما تقدر تسجنني.",
        flags: MessageFlags.Ephemeral,
      });

    const jailChannelId = cfg.jail?.channelId;
    if (
      !jailChannelId ||
      !interaction.guild.channels.cache.has(jailChannelId)
    ) {
      return interaction.reply({
        content:
          "ما تم تحديد روم السجن بعد أو الروم المحدد محذوف. حدده من الداشبورد أولاً.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      const jailRole = await getOrCreateJailRole(interaction.guild);
      await applyJailOverwrites(interaction.guild, jailRole, jailChannelId);
      await target.roles.add(jailRole, `Jailed by ${interaction.user.tag}`);
      return interaction.editReply({
        content: `🔒 تم سجن **${target.user.tag}**. الآن يقدر يشوف بس <#${jailChannelId}>.`,
      });
    } catch (err) {
      console.error("Jail error:", err);
      return interaction.editReply({
        content:
          "صار خطأ أثناء تنفيذ السجن. تأكد إن صلاحيات البوت كافية (Manage Roles/Channels) وإن رتبة البوت أعلى من رتبة العضو.",
      });
    }
  }

  // ── UNJAIL (فك_سجن) ──
  if (commandName === "فك_سجن") {
    const cfg = loadConfig();
    if (!canManageJail(interaction.member, cfg)) {
      return interaction.reply({
        content: "ما عندك صلاحية تفك السجن.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const target = interaction.options.getMember("user");
    if (!target)
      return interaction.reply({
        content: "العضو غير موجود.",
        flags: MessageFlags.Ephemeral,
      });

    const jailRoleId = cfg.jail?.roleId;
    const jailRole = jailRoleId
      ? interaction.guild.roles.cache.get(jailRoleId)
      : interaction.guild.roles.cache.find((r) => r.name === JAIL_ROLE_NAME);

    if (!jailRole || !target.roles.cache.has(jailRole.id)) {
      return interaction.reply({
        content: "هذا العضو مو مسجون.",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await target.roles.remove(
        jailRole,
        `Unjailed by ${interaction.user.tag}`,
      );
      return interaction.reply({
        content: `🔓 تم فك السجن عن **${target.user.tag}**.`,
      });
    } catch (err) {
      console.error("Unjail error:", err);
      return interaction.reply({
        content: "صار خطأ أثناء فك السجن.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── ROLEPLAY COMMANDS ──
  // ── EMOTION COMMANDS (happy / angry) ──
  if (EMOTION_CMDS[commandName]) {
    const em = EMOTION_CMDS[commandName];
    const customMsg = interaction.options.getString("message");
    const displayName =
      interaction.member?.displayName || interaction.user.username;

    let gifUrl;
    gifUrl = await fetchEmotionGif(commandName);

    const embed = new EmbedBuilder()
      .setColor(em.color)
      .setDescription(
        `${em.emoji} ${customMsg ? `**${displayName}**: ${customMsg}` : em.defaultMsg(displayName)}`,
      );

    if (gifUrl) {
      // Attach the GIF instead of relying on Discord to fetch a third-party
      // URL from the embed.
      const files = await attachGifToEmbed(embed, gifUrl);
      return interaction.editReply({ embeds: [embed], files });
    } else {
      embed.setFooter({ text: "⚠️ Could not load GIF right now." });
    }

    return interaction.editReply({ embeds: [embed] });
  }

  if (RP_CMDS[commandName]) {
    const rp = RP_CMDS[commandName];
    const inDM = !interaction.guild;

    // In DMs getMember returns null — fall back to getUser
    const targetMember = inDM ? null : interaction.options.getMember("user");
    const targetUser = inDM
      ? interaction.options.getUser("user")
      : targetMember?.user;
    if (!targetMember && !targetUser)
      return interaction.editReply({
        content: "User not found.",
      });

    const targetId = inDM ? targetUser.id : targetMember.id;
    if (targetId === interaction.user.id)
      return interaction.editReply({
        content: "You cannot use this on yourself.",
      });
    if (targetUser?.bot ?? targetMember?.user?.bot)
      return interaction.editReply({
        content: "You cannot use this on a bot.",
      });

    const iName = interaction.member?.displayName || interaction.user.username;
    const tName = inDM
      ? targetUser.globalName || targetUser.username
      : targetMember.displayName;

    let gifUrl = null;
    try {
      gifUrl = await fetchRoleplayGif(commandName, rp.apiAction);
    } catch (e) {
      console.error("Initial GIF fetch failed:", e);
    }

    // In DMs there's no shared channel for the target to respond — skip accept/decline
    if (inDM) {
      const embed = new EmbedBuilder()
        .setColor(rp.color)
        .setDescription(rp.init(iName, tName));
      const files = await attachGifToEmbed(embed, gifUrl);
      return interaction.editReply({ embeds: [embed], files });
    }

    const embed = new EmbedBuilder()
      .setColor(rp.color)
      .setDescription(`${targetMember}\n\n${rp.init(iName, tName)}`)
      .setFooter({
        text: rp.acceptLabel
          ? `${tName}, get them back?`
          : `${tName}, do you accept?`,
      });

    let files = [];
    if (gifUrl) {
      files = await attachGifToEmbed(embed, gifUrl);
    } else {
      embed.setFooter({
        text: `⚠️ Image failed to load. ${rp.acceptLabel ? `${tName}, get them back?` : `${tName}, do you accept?`}`,
      });
    }

    const rowButtons = [
      new ButtonBuilder()
        .setCustomId(
          `rp_accept_${commandName}_${interaction.user.id}_${targetMember.id}`,
        )
        .setLabel(rp.acceptLabel || "Accept")
        .setStyle(ButtonStyle.Success),
    ];
    if (!rp.noDecline) {
      rowButtons.push(
        new ButtonBuilder()
          .setCustomId(
            `rp_decline_${commandName}_${interaction.user.id}_${targetMember.id}`,
          )
          .setLabel(rp.declineLabel || "Reject")
          .setStyle(ButtonStyle.Danger),
      );
    }
    const row = new ActionRowBuilder().addComponents(...rowButtons);

    return interaction.editReply({
      embeds: [embed],
      files,
      components: [row],
    });
  }

  if (commandName === "setbg") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const attachment = interaction.options.getAttachment("image");
    const isImage =
      attachment.contentType?.startsWith("image/") ||
      /\.(png|jpe?g|gif|webp)$/i.test(attachment.name || "");
    if (!isImage) {
      return interaction.editReply({
        content: "Please upload a valid image file (PNG, JPG, etc.).",
      });
    }
    if (attachment.size > 8 * 1024 * 1024) {
      return interaction.editReply({
        content: "Image is too large. Please upload an image under 8MB.",
      });
    }
    try {
      const res = await axios.get(attachment.url, {
        responseType: "arraybuffer",
        timeout: 10000,
      });
      const sharp = require("sharp");
      const resized = await sharp(Buffer.from(res.data))
        .resize(800, 260, { fit: "cover" })
        .png()
        .toBuffer();
      await db.saveUserBackground(interaction.user.id, resized);
      return interaction.editReply({
        content:
          "Your rank card background has been updated. Use `/rank` to see it.",
      });
    } catch (err) {
      console.error("setbg error:", err);
      return interaction.editReply({
        content: "Failed to save background. Please try again.",
      });
    }
  }

  if (commandName === "resetbg") {
    const existing = await db.getUserBackground(interaction.user.id);
    if (existing) {
      await db.deleteUserBackground(interaction.user.id);
      return interaction.reply({
        content: "Your rank card background has been reset to default.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({
      content: "You do not have a custom background set.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (commandName === "rank") {
    await interaction.deferReply();
    const target = interaction.options.getUser("user") || interaction.user;
    const userData = await getUserData(interaction.guildId, target.id);

    if (!userData) {
      return interaction.editReply({
        content: `${target.username} has not earned any XP yet. Send some messages to get started.`,
      });
    }

    try {
      const buffer = await generateRankCard({
        userId: target.id,
        username: target.username,
        discriminator: target.discriminator,
        avatarUrl: target.displayAvatarURL({ extension: "png", size: 256 }),
        level: userData.level,
        currentXp: userData.currentXp,
        xpNeeded: userData.xpNeeded,
        totalXp: userData.totalXp,
        rank: userData.rank,
      });
      return interaction.editReply({
        files: [new AttachmentBuilder(buffer, { name: "rank.png" })],
      });
    } catch (err) {
      console.error("Rank card error:", err);
      return interaction.editReply({
        content: "Failed to generate rank card.",
      });
    }
  }

  if (commandName === "top") {
    return topCommand.execute(interaction);
  }

  if (commandName === "leaderboard") {
    await interaction.deferReply();
    const period = interaction.options.getString("period") || "all";
    try {
      const leaderboard = await getLeaderboard(interaction.guildId, period);
      if (!leaderboard || leaderboard.length === 0)
        return interaction.editReply({
          content: "ما في بيانات XP لهذه الفترة في السيرفر بعد.",
        });

      const payload = await buildLeaderboardPayload(
        interaction.guildId,
        interaction.guild,
        period,
      );
      return interaction.editReply(
        payload || { content: "Failed to generate leaderboard." },
      );
    } catch (err) {
      console.error("Leaderboard error:", err);
      return interaction.editReply({
        content: "Failed to generate leaderboard.",
      });
    }
  }

  if (commandName === "voiceleaderboard") {
    await interaction.deferReply();
    const period = interaction.options.getString("period") || "all";
    try {
      const payload = await buildVoiceLeaderboardPayload(
        interaction.guildId,
        interaction.guild,
        period,
      );
      if (!payload)
        return interaction.editReply({
          content: "ما في بيانات صوت لهذه الفترة في السيرفر بعد.",
        });
      return interaction.editReply(payload);
    } catch (err) {
      console.error("Voice Leaderboard error:", err);
      return interaction.editReply({
        content: "Failed to generate voice leaderboard.",
      });
    }
  }

  // ── تحديد روم البروفيل ──
  // ── SAY ──
  if (commandName === "say") {
    if (
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)
    ) {
      return interaction.reply({
        content: "تحتاج صلاحية **Manage Messages** لاستخدام هذا الأمر.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const messageText = interaction.options.getString("message");
    const targetChannel =
      interaction.options.getChannel("channel") || interaction.channel;

    // Ensure target is a text-based channel
    if (!targetChannel.isTextBased()) {
      return interaction.reply({
        content: "الروم المحدد ليس روم نصي.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Ensure the invoker can send messages in the target channel
    const invokerPermsInTarget = targetChannel.permissionsFor(
      interaction.member,
    );
    if (!invokerPermsInTarget?.has(PermissionFlagsBits.SendMessages)) {
      return interaction.reply({
        content: "ما عندك صلاحية الكتابة في ذلك الروم.",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await targetChannel.send(messageText);
      return interaction.reply({
        content: `✅ تم إرسال الرسالة في ${targetChannel}.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      console.error("Say error:", err);
      return interaction.reply({
        content:
          "ما قدرت أرسل الرسالة. تأكد إن البوت عنده صلاحية الكتابة في ذلك الروم.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── START STREAK ──

  // ── STREAK (image channel) ──
  if (commandName === "st") {
    const target = interaction.options.getUser("user") || interaction.user;
    const data = await getUserStreak(interaction.guildId, target.id);
    const streakCfg2 = loadConfig().streak || {};
    if (!streakCfg2.channelId) {
      return interaction.reply({
        content: "ما تم تحديد روم الستريك بعد. حدده من الداشبورد أولاً.",
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!data || data.count <= 0) {
      return interaction.reply({
        content: `**${target.username}** ما عنده ستريك حالياً. ابعت صورة أو فيديو في <#${streakCfg2.channelId}> عشان تبدأ!`,
        ephemeral: false,
      });
    }
    return interaction.reply({
      content: `**${target.username}**\nالستريك الحالي: **${data.count}**\nاعلى تقدم: **${data.longest}**`,
      ephemeral: false,
    });
  }

  // ── USERINFO ──
  if (commandName === "userinfo") {
    const target = interaction.options.getUser("user") || interaction.user;
    const member =
      interaction.guild.members.cache.get(target.id) ||
      (await interaction.guild.members.fetch(target.id).catch(() => null));

    const createdAt = Math.floor(target.createdTimestamp / 1000);
    const joinedAt = member?.joinedTimestamp
      ? Math.floor(member.joinedTimestamp / 1000)
      : null;

    const embed = new EmbedBuilder()
      .setColor(member?.displayHexColor || "#5865F2")
      .setAuthor({
        name: target.tag || target.username,
        iconURL: target.displayAvatarURL({ size: 128 }),
      })
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(
        {
          name: "📅 Discord Joined",
          value: `<t:${createdAt}:R>`,
          inline: true,
        },
        ...(joinedAt
          ? [
              {
                name: "📥 Server Joined",
                value: `<t:${joinedAt}:R>`,
                inline: true,
              },
            ]
          : []),
      )
      .setFooter({ text: `Requested by ${interaction.user.username}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ── AVATAR ──
  if (commandName === "avatar") {
    const target = interaction.options.getUser("user") || interaction.user;
    const avatarURL = target.displayAvatarURL({ size: 4096, extension: "png" });
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: `${target.username}'s Avatar`, iconURL: avatarURL })
      .setImage(avatarURL)
      .setFooter({ text: `ID: ${target.id}` });
    return interaction.reply({ embeds: [embed] });
  }

  // ── BANNER ──
  if (commandName === "banner") {
    await interaction.deferReply();
    const target = await interaction.client.users.fetch(
      interaction.options.getUser("user")?.id || interaction.user.id,
      { force: true },
    );
    const bannerURL = target.bannerURL({ size: 4096, extension: "png" });
    if (!bannerURL) {
      const accentColor = target.accentColor
        ? `#${target.accentColor.toString(16).padStart(6, "0")}`
        : null;
      const embed = new EmbedBuilder()
        .setColor(target.accentColor || 0x5865f2)
        .setDescription(
          `**${target.username}** doesn't have a banner set.${accentColor ? `\nProfile colour: **${accentColor}**` : ""}`,
        );
      return interaction.editReply({ embeds: [embed] });
    }
    const embed = new EmbedBuilder()
      .setColor(target.accentColor || 0x5865f2)
      .setAuthor({
        name: `${target.username}'s Banner`,
        iconURL: target.displayAvatarURL({ size: 128 }),
      })
      .setImage(bannerURL)
      .setFooter({ text: `ID: ${target.id}` });
    return interaction.editReply({ embeds: [embed] });
  }

  // ── CLOSE (ticket) ──
  if (commandName === "close") {
    const cfg = loadConfig();
    // Must be used inside a ticket channel (topic starts with "ticket-")
    if (!interaction.channel?.topic?.startsWith("ticket-")) {
      return interaction.reply({
        content: "❌ هذا الأمر يعمل فقط داخل تذكرة دعم.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const allTicketsForClose = await db.loadTickets();
    const ticketDataForClose = (allTicketsForClose[interaction.guild.id] || {})[
      interaction.channel.id
    ];
    const t =
      (Array.isArray(cfg.ticketPanels) ? cfg.ticketPanels : []).find(
        (p) => p.id === ticketDataForClose?.panelId,
      ) || {};
    const member = interaction.member;
    const isStaff = t.staffRoleId
      ? member.roles.cache.has(t.staffRoleId)
      : member.permissions.has(PermissionFlagsBits.ManageChannels);
    const ticketUserId = interaction.channel.topic.replace("ticket-", "");
    const isOpener = ticketUserId === interaction.user.id;
    if (!isStaff && !isOpener) {
      return interaction.reply({
        content: "❌ فقط أعضاء الفريق أو صاحب التذكرة يمكنهم إغلاقها.",
        flags: MessageFlags.Ephemeral,
      });
    }
    await interaction.reply({
      content: "🔒 سيتم إغلاق التذكرة خلال 5 ثواني...",
    });
    setTimeout(async () => {
      try {
        await sendTicketClosureLog(interaction, cfg);
        const allTickets = await db.loadTickets();
        if (allTickets[interaction.guild.id])
          delete allTickets[interaction.guild.id][interaction.channel.id];
        await db.saveTickets(allTickets);
        if (isStaffMember(interaction, cfg)) {
          await db.incrementStaffActivity(interaction.guild.id, interaction.user.id, interaction.user.username, 'closedTickets');
          await db.incrementStaffActivity(interaction.guild.id, interaction.user.id, interaction.user.username, 'actions');
          await awardStaffXp(interaction, cfg, 'ticketClose');
        }
        await interaction.channel.delete("Ticket closed");
      } catch (err) {
        console.error("[Ticket close cmd]", err.message);
      }
    }, 5000);
    return;
  }

  // ── RENAME (ticket) ──
  if (commandName === "rename") {
    const cfg = loadConfig();
    if (!interaction.channel?.topic?.startsWith("ticket-")) {
      return interaction.reply({
        content: "❌ هذا الأمر يعمل فقط داخل تذكرة دعم.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const allTicketsForRename = await db.loadTickets();
    const ticketDataForRename = (allTicketsForRename[interaction.guild.id] || {})[
      interaction.channel.id
    ];
    const t =
      (Array.isArray(cfg.ticketPanels) ? cfg.ticketPanels : []).find(
        (p) => p.id === ticketDataForRename?.panelId,
      ) || {};
    const member = interaction.member;
    const isStaff = t.staffRoleId
      ? member.roles.cache.has(t.staffRoleId)
      : member.permissions.has(PermissionFlagsBits.ManageChannels);
    const ticketUserId = interaction.channel.topic.replace("ticket-", "");
    const isOpener = ticketUserId === interaction.user.id;
    if (!isStaff && !isOpener) {
      return interaction.reply({
        content: "❌ فقط أعضاء الفريق أو صاحب التذكرة يمكنهم تغيير اسمها.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const rawName = interaction.options.getString("name");
    const newName =
      rawName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "ticket";
    try {
      await interaction.channel.setName(newName);
      return interaction.reply({
        content: `✅ تم تغيير اسم التذكرة إلى **${newName}**`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      console.error("[Ticket rename cmd]", err.message);
      return interaction.reply({
        content: `❌ فشل تغيير الاسم: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

// Helper to create a fake interaction from a message for alias support
function createMockInteraction(message, args = []) {
  let replyMsg = null;

  // يحاول يرد على الرسالة الأصلية (reply)، ولو فشلت (مثلاً انحذفت الرسالة
  // قبل ما يقدر يرد عليها → MESSAGE_REFERENCE_UNKNOWN_MESSAGE) يبعت رسالة
  // عادية بالروم بدل ما يفشل تماماً وما يوصل أي رد للمستخدم.
  const trySend = async (payload) => {
    try {
      return await message.reply(payload);
    } catch (e) {
      return await message.channel.send(payload);
    }
  };

  // Enhanced option extraction
  const getString = (name) => {
    const cmd = message.content.split(/\s+/)[0].toLowerCase();
    // Duration/time options must return only their duration token so prefixed
    // commands can use: mute @user 1d 2h reason here.
    if (name === "duration" || name === "time") {
      const durationParts = [];
      for (const arg of args) {
        if (arg.startsWith("<@")) continue;
        if (/^\d+(?:\.\d+)?\s*[smhdw]$/i.test(arg)) durationParts.push(arg);
        else if (durationParts.length) break;
      }
      return durationParts.length ? durationParts.join(" ") : null;
    }
    if (["say", "embed", "son"].includes(cmd)) return args.join(" ");
    return args.filter((a) => !a.startsWith("<@")).join(" ") || null;
  };
  const getInteger = (name) => {
    const num = args.find((a) => !isNaN(parseInt(a)));
    return num ? parseInt(num) : null;
  };

  return {
    isMock: true,
    id: message.id,
    client: message.client,
    channelId: message.channelId,
    channel: message.channel,
    user: message.author,
    member: message.member,
    guild: message.guild,
    guildId: message.guildId,
    memberPermissions: message.member?.permissions,
    options: {
      getString,
      getInteger,
      getMember: (name) => {
        const mentioned = message.mentions.members.first();
        if (mentioned) return mentioned;
        return message.member;
      },
      getUser: (name) => message.mentions.users.first() || null,
      getAttachment: (name) => message.attachments.first() || null,
      getChannel: (name) =>
        message.mentions.channels.first() || message.channel,
      getRole: (name) => {
        const mentioned = message.mentions.roles.first();
        if (mentioned) return mentioned;
        const roleText = args.filter((a) => !a.startsWith("<@")).join(" ").trim().toLowerCase();
        if (!roleText || !message.guild?.roles?.cache) return null;
        return message.guild.roles.cache.find((r) => r.name.toLowerCase() === roleText)
          || message.guild.roles.cache.find((r) => r.name.toLowerCase().includes(roleText))
          || null;
      },
      getSubcommand: () => args[0] || null,
    },
    reply: async (payload) => {
      try {
        if (replyMsg)
          return await replyMsg.edit(payload).catch(() => trySend(payload));
        replyMsg = await trySend(payload);
        return replyMsg;
      } catch (e) {
        console.error("[Mock Reply Error]", e.message);
      }
    },
    deferReply: async (options) => {
      try {
        // Only reply if not already replied
        // Disabled processing message
        //         // if (!replyMsg) replyMsg = await message.reply(options?.ephemeral ? '⏳ جاري المعالجة...' : '⏳ Processing...');
        return replyMsg;
      } catch (e) {
        console.error("[Mock Defer Error]", e.message);
      }
    },
    editReply: async (payload) => {
      try {
        if (replyMsg)
          return await replyMsg.edit(payload).catch(() => trySend(payload));
        replyMsg = await trySend(payload);
        return replyMsg;
      } catch (e) {
        console.error("[Mock Edit Error]", e.message);
      }
    },
    followUp: async (payload) => message.channel.send(payload).catch(() => {}),
    deferUpdate: async () => {},
    update: async (payload) => {
      try {
        if (replyMsg)
          return await replyMsg.edit(payload).catch(() => trySend(payload));
        replyMsg = await trySend(payload);
        return replyMsg;
      } catch (e) {
        console.error("[Mock Update Error]", e.message);
      }
    },
    fetchReply: async () => replyMsg,
  };
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // حد الرفع العادي في ديسكورد للسيرفرات الغير مبوستة
const MEDIA_COOLDOWN_MS = 10 * 1000; // كولداون 10 ثواني لكل عضو

// يحذف رسالة الرابط الأصلية، وبعدين يبعث الفيديو بمنشن صاحب الرابط
async function handleMediaLinks(message, links) {
  const channel = message.channel;
  const author = message.author;

  // ── كولداون 10 ثواني ──
  const now = Date.now();
  const lastUsed = mediaDownloadCooldown.get(author.id) || 0;
  if (now - lastUsed < MEDIA_COOLDOWN_MS) {
    message.delete().catch(() => {});
    const remaining = Math.ceil((MEDIA_COOLDOWN_MS - (now - lastUsed)) / 1000);
    channel
      .send(`⏱️ ${author} تمهّل شوي! جرب بعد **${remaining}** ثانية.`)
      .then((warn) => setTimeout(() => warn.delete().catch(() => {}), 5000))
      .catch(() => {});
    return;
  }
  mediaDownloadCooldown.set(author.id, now);

  // نحذف رسالة الرابط الأصلية فور اكتشافها
  message.delete().catch(() => {});

  for (const link of links.slice(0, 3)) {
    // حد أقصى 3 روابط بنفس الرسالة عشان ما نغرق القناة
    let notice;
    try {
      notice = await channel.send(`⏳ ${author} جاري تحميل الفيديو...`);
      let media;
      try {
        media = await resolveMedia(link);
        // Send Cobalt's playable/download URL directly instead of downloading
        // the whole file into memory and uploading it to Discord.
        await notice
          .edit(`✅ ${author} تفضل رابط الفيديو:\n[LINK](${media.url})`)
          .catch(() => {});
      } catch (cobaltError) {
        // Cobalt can be blocked by Instagram for some public /p/ posts. Use
        // the local public-post fallback for Instagram only.
        if (!/instagram\.com/i.test(link)) throw cobaltError;
        const fallback = await downloadInstagramFallback(link);
        const stat = await require('fs').promises.stat(fallback.path);
        if (stat.size > MAX_UPLOAD_BYTES) {
          throw new Error(`instagram fallback file too large: ${stat.size} bytes`);
        }
        await channel.send({
          content: `✅ ${author} هذا الملف من Instagram`,
          files: [{ attachment: fallback.path, name: fallback.filename || 'instagram-media' }],
        });
        await notice.delete().catch(() => {});
        await require('fs').promises.rm(fallback.temp_dir || require('path').dirname(fallback.path), { recursive: true, force: true }).catch(() => {});
      }
    } catch (err) {
      console.error(`Media download failed for ${link}:`, err.message);
      const errMsg = `❌ ${author} ما قدرت أحمّل هذا الفيديو (يمكن يكون خاص، محذوف، أو صار خطأ مؤقت).`;
      if (notice) await notice.edit(errMsg).catch(() => {});
      else await channel.send(errMsg).catch(() => {});
    }
  }
}

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild) return;

  if (message.member && isStaffMember(message, loadConfig())) {
    db.incrementStaffActivity(message.guildId, message.author.id, message.author.username, 'messages').catch(() => {});
  }

  // ── رسائل الويب هوك: تُفحص فقط لقنوات مراقبة الايموجي/الستكر، وتتوقف بعدها ──
  if (message.webhookId) {
    const guildData = (await loadData())[message.guildId];
    if (guildData?.watchChannel === message.channelId) {
      await addEmojisFromText(
        message.guild,
        collectWatchText(message),
        "Webhook",
      );
    }
    if (guildData?.emojiWatchChannel === message.channelId) {
      await addEmojisFromText(
        message.guild,
        collectWatchText(message),
        "Webhook-EmojiWatch",
      );
    }
    if (guildData?.stickerWatchChannel === message.channelId) {
      const stickers = collectWatchStickers(message);
      if (stickers.size > 0)
        await addStickersFromMessage(message.guild, stickers);
    }
    return;
  }

  if (message.author.bot) return;

  db.recordAnalyticsEvent?.({
    guildId: message.guildId,
    eventType: 'message',
    userId: message.author.id,
    username: message.author.username,
    channelId: message.channelId,
    channelName: message.channel?.name || message.channelId,
  });

  const cfg = loadConfig();
  await handleAfkMessage(message);
  const aliases = cfg.aliases || {};
  const content = message.content?.trim() || "";

  // ── ALIASES (Text Shortcuts) ──
  const contentLower = content.toLowerCase();
  let aliasKey = null;
  let aliasCmd = null;
  let aliasArgs = [];

  // Hardcoded aliases for immediate use (no dashboard config needed)
  const HARDCODED_ALIASES = {
    "-نك": "nickname",
    son: "son",
    سباق: "race",
    race: "race",
    سلوت: "slots",
    سلوتس: "slots",
    bj: "blackjack",
    بلاك: "blackjack",
    الغام: "minesweeper",
    ms: "minesweeper",
    تريفيا: "trivia",
    ارقام: "numguess",
    كات: "cat",
    top: "top",
    توب: "top",
    r: "rank",
    st: "st",
    رول: "giverole",
    // user info / avatar / banner
    ui: "userinfo",
    whois: "userinfo",
    av: "avatar",
    pfp: "avatar",
    صورة: "avatar",
    banner: "banner",
    بانر: "banner",
    afk: "afk",
    افك: "afk",
    "أفك": "afk",
  };

  const hardcodedMatch = Object.keys(HARDCODED_ALIASES)
    .sort((a, b) => b.length - a.length)
    .find((k) => contentLower === k || contentLower.startsWith(k + " "));

  if (hardcodedMatch) {
    aliasKey = hardcodedMatch;
    aliasCmd = HARDCODED_ALIASES[hardcodedMatch];
    const remaining = content.slice(hardcodedMatch.length).trim();
    aliasArgs = remaining ? remaining.split(/\s+/) : [];
  } else {
    // Get all aliases from config
    const sortedAliasKeys = Object.keys(aliases).sort(
      (a, b) => b.length - a.length,
    );

    for (const key of sortedAliasKeys) {
      // Exact match or starts with key + space
      if (
        contentLower === key.toLowerCase() ||
        contentLower.startsWith(key.toLowerCase() + " ")
      ) {
        const remaining = content.slice(key.length).trim();
        aliasKey = key;
        aliasCmd = aliases[key];
        aliasArgs = remaining ? remaining.split(/\s+/) : [];
        break;
      }
    }
  }

  if (aliasKey) {
    let [baseCmd, defaultOption] = aliasCmd.split(":");

    // Permission check
    if (!checkPermission(baseCmd, message.member, message.channelId)) {
      return;
    }

    if (baseCmd === "top") {
      const topArgs = defaultOption ? [defaultOption, ...aliasArgs] : aliasArgs;
      return topCommand.executePrefixed(message, topArgs);
    }
    const interaction = createMockInteraction(message, aliasArgs);
    interaction.commandName = baseCmd;

    // Handle default options (like leaderboard:week)
    if (defaultOption) {
      const originalGetString = interaction.options.getString;
      interaction.options.getString = (name) => {
        if (
          (baseCmd === "leaderboard" || baseCmd === "voiceleaderboard") &&
          name === "period"
        )
          return defaultOption;
        // Add more default options mapping here if needed
        return originalGetString(name);
      };
    }

    try {
      await handleChatCommand(interaction);
    } catch (err) {
      console.error(`Error executing alias ${baseCmd}:`, err);
      return message.reply("❌ حدث خطأ أثناء تنفيذ هذا الاختصار.");
    }
    return;
  }

  // ── تحميل فيديوهات انستقرام / تيك توك / يوتيوب ──
  const mediaLinks = extractMediaLinks(content);
  if (mediaLinks.length > 0) {
    handleMediaLinks(message, mediaLinks).catch((err) =>
      console.error("handleMediaLinks error:", err.message),
    );
  }

  // ── STREAK ROOM ──
  const streakCfg = cfg.streak || {};
  if (
    streakCfg.enabled &&
    streakCfg.channelId &&
    message.channelId === streakCfg.channelId
  ) {
    const hasMedia = message.attachments.some((a) => {
      if (
        a.contentType?.startsWith("image/") ||
        a.contentType?.startsWith("video/")
      )
        return true;
      // Some clients (mobile uploads) don't set contentType — fall back to the file extension.
      return /\.(png|jpe?g|gif|webp|mp4|mov|webm|avi|mkv)$/i.test(a.name || "");
    });
    if (hasMedia) {
      const result = await recordStreakImage(
        message.guildId,
        message.author.id,
        message.author.username,
      );
      const streakFormat = String(streakCfg.displayFormat || 'st: **{streak}** {emoji}')
        .replaceAll('{streak}', String(result.streak))
        .replaceAll('{emoji}', String(streakCfg.displayEmoji || ':happyggdng:'))
        .replaceAll('{user}', message.author.username)
        .slice(0, 2000);
      message.reply(streakFormat).catch(() => {});
      message.react("🔥").catch(() => {});
    }
  }

  // ── PROFILE ROOM ──
  const profileCfg = cfg.profile || {};
  if (profileCfg.channelId && message.channelId === profileCfg.channelId) {
    const imageAttachments = message.attachments.filter(
      (a) =>
        a.contentType?.startsWith("image/") ||
        /\.(png|jpe?g|gif|webp)$/i.test(a.name || ""),
    );
    const hasAccess =
      !profileCfg.roleId || message.member?.roles.cache.has(profileCfg.roleId);
    if (imageAttachments.size > 0 && hasAccess) {
      const key = `${message.guildId}:${message.author.id}`;

      if (imageAttachments.size > 1) {
        message
          .reply("❗ ابعث الأفتار الأول، صورة وحدة بس في كل مرة.")
          .catch(() => {});
      } else {
        const imageUrl = imageAttachments.first().url;
        const pendingAvatarBuffer = pendingProfileAvatar.get(key);

        // Download the raw bytes right away and keep them in memory instead
        // of the CDN URL: the raw message gets deleted a moment later to
        // keep the room clean, and Discord invalidates an attachment's URL
        // as soon as its message is deleted, which used to make the avatar
        // silently fail to render on the final card.
        const imageBuffer = await downloadImageBytes(imageUrl);
        if (!imageBuffer) {
          message
            .reply("❗ ما قدرت أحمّل هذي الصورة، حاول ترسلها مرة ثانية.")
            .catch(() => {});
          return;
        }

        if (!pendingAvatarBuffer) {
          pendingProfileAvatar.set(key, imageBuffer);
          await message.channel
            .send(
              `✅ استلمت الأفتار من ${message.author}! الحين ابعث صورة البنر.`,
            )
            .catch(() => {});
          message.delete().catch(() => {});
        } else {
          pendingProfileAvatar.delete(key);
          pendingProfilePreview.set(key, {
            avatarBuffer: pendingAvatarBuffer,
            bannerBuffer: imageBuffer,
          });
          try {
            const buffer = await generateProfileCard({
              username: message.member.displayName,
              avatarUrl: pendingAvatarBuffer,
              bannerUrl: imageBuffer,
              avatarSize: profileCfg.avatarSize,
              avatarX: profileCfg.avatarX,
              avatarY: profileCfg.avatarY,
            });
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`profile_send_${message.author.id}`)
                .setLabel("✅ بعت")
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`profile_cancel_${message.author.id}`)
                .setLabel("❌ لا")
                .setStyle(ButtonStyle.Danger),
            );
            await message.channel.send({
              content: `هذا شكل بروفيلك يا ${message.author}، تبي ترسله؟`,
              files: [
                new AttachmentBuilder(buffer, { name: "profile_preview.png" }),
              ],
              components: [row],
            });
            message.delete().catch(() => {});
          } catch (err) {
            console.error("Profile preview error:", err);
            pendingProfilePreview.delete(key);
            message.channel
              .send(
                `صار خطأ أثناء إنشاء البروفيل يا ${message.author}، حاول مرة ثانية.`,
              )
              .catch(() => {});
            message.delete().catch(() => {});
          }
        }
      }
    }
  }

  const autoReplies = (loadConfig().autoReplies || []).filter((r) => r.enabled);
  for (const rule of autoReplies) {
    const msgText = rule.caseSensitive ? content : content.toLowerCase();
    const trigger = rule.caseSensitive
      ? rule.trigger
      : rule.trigger.toLowerCase();
    let matched = false;
    if (rule.matchType === "exact") matched = msgText === trigger;
    else if (rule.matchType === "startsWith")
      matched = msgText.startsWith(trigger);
    else matched = msgText.includes(trigger);
    if (matched) {
      // Optional per-rule restrictions: required role and/or one specific user.
      if (rule.roleId && !message.member?.roles?.cache?.has(rule.roleId)) continue;
      if (rule.userId && String(message.author.id) !== String(rule.userId)) continue;
      if (rule.responseType === 'image' && rule.imageUrl) {
        const imageUrl = await resolveImgbbUrl(rule.imageUrl).catch(() => rule.imageUrl);
        const imageBytes = await downloadImageBytes(imageUrl).catch(() => null);
        if (imageBytes && Buffer.isBuffer(imageBytes)) {
          const extension = (imageUrl.match(/\.(png|jpe?g|gif|webp)(?:\?|$)/i)?.[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
          await message.channel.send({ files: [{ attachment: imageBytes, name: `auto-reply-image.${extension}` }] }).catch(() => {});
        } else {
          // If the host blocks downloading, still provide the resolved direct URL as a fallback.
          await message.channel.send({ content: imageUrl }).catch(() => {});
        }
      } else {
        await message.channel.send(rule.response).catch(() => {});
      }
      // Deletion is configurable per rule; legacy rules keep their previous behavior.
      if (rule.deleteTrigger !== false) await message.delete().catch(() => {});
      break;
    }
  }

  // ── CHANNEL RELAY AUTOMATIONS ──
  // These rules are configured from the Dashboard. Bot messages are ignored so
  // forwarding never creates a loop between source and destination channels.
  if (!message.author.bot && !message.webhookId) {
    const channelAutomations = (loadConfig().channelAutomations || []).filter(r => r.enabled !== false);
    for (const rule of channelAutomations) {
      if (String(rule.sourceChannelId || '') !== String(message.channelId)) continue;
      if (rule.requiredRoleId && !message.member?.roles?.cache?.has(rule.requiredRoleId)) continue;
      const destinationId = rule.sameChannel ? message.channelId : rule.destinationChannelId;
      const target = message.guild.channels.cache.get(destinationId)
        || await message.guild.channels.fetch(destinationId).catch(() => null);
      if (!target?.send) continue;
      try {
        const mode = rule.mode === 'custom' ? 'custom' : 'forward';
        let payload = {};
        if (mode === 'forward') {
          if (message.content) payload.content = message.content;
          if (message.attachments?.size) {
            payload.files = [...message.attachments.values()].map(a => ({
              attachment: a.url,
              name: a.name || 'forwarded-file',
            }));
          }
        } else if (rule.responseType === 'image' && rule.imageUrl) {
          const imageUrl = await resolveImgbbUrl(rule.imageUrl).catch(() => rule.imageUrl);
          const imageBytes = await downloadImageBytes(imageUrl).catch(() => null);
          if (imageBytes && Buffer.isBuffer(imageBytes)) {
            const extension = (imageUrl.match(/\.(png|jpe?g|gif|webp)(?:\?|$)/i)?.[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
            payload.files = [{ attachment: imageBytes, name: `channel-relay-image.${extension}` }];
          } else {
            payload.content = imageUrl;
          }
        } else if (rule.responseType === 'embed') {
          const hex = String(rule.embedColor || '#5865F2').replace('#', '');
          const color = /^[0-9a-f]{6}$/i.test(hex) ? parseInt(hex, 16) : 0x5865F2;
          const embed = new EmbedBuilder().setColor(color);
          if (rule.embedTitle) embed.setTitle(rule.embedTitle);
          if (rule.embedDescription) embed.setDescription(rule.embedDescription);
          if (rule.embedImageUrl) embed.setImage(await resolveImgbbUrl(rule.embedImageUrl).catch(() => rule.embedImageUrl));
          payload.embeds = [embed];
        } else {
          payload.content = String(rule.response || '');
        }
        if (payload.content || payload.embeds || payload.files) {
          const sent = await target.send(payload);
          registerRelayMessage(sent);
          const postAction = ['reaction', 'message', 'both'].includes(rule.postAction) ? rule.postAction : 'none';
          if ((postAction === 'message' || postAction === 'both') && rule.postMessage) {
            const followUp = String(rule.postMessage)
              .replace(/{user}/g, `<@${message.author.id}>`)
              .replace(/{username}/g, message.author.username)
              .replace(/{server}/g, message.guild.name);
            const followUpMessage = await target.send(followUp).catch(err => {
              console.warn(`[Channel Relay] Follow-up failed for ${rule.id || 'unknown'}:`, err.message);
              return null;
            });
            if (followUpMessage) registerRelayMessage(followUpMessage);
          }
          if ((postAction === 'reaction' || postAction === 'both') && rule.reactionEmoji) {
            // The reaction belongs on the original user's message, not a bot message.
            registerRelayMessage(message);
            await message.react(rule.reactionEmoji).catch(err => console.warn(`[Channel Relay] Reaction failed for ${rule.id || 'unknown'}:`, err.message));
          }
          if (rule.deleteSource) await message.delete().catch(() => {});
        }
      } catch (error) {
        console.error(`[Channel Relay] Rule ${rule.id || 'unknown'} failed:`, error.message);
      }
    }
  }

  if (!message.webhookId) {
    const result = await addXp(
      message.guildId,
      message.author.id,
      message.author.username,
    );
    if (result) {
      const xpCfg = loadConfig().xp || {};
      // Sync on every awarded XP event, not only the exact level-up message.
      // This repairs roles missed during outages, cache misses, or permission errors.
      await syncLevelRole(message.guild, message.author.id, result.newLevel, xpCfg,
        result.leveledUp ? "Level role reached" : "Level role repair");
      if (result.leveledUp) {
      const levelUpPayload = buildXpLevelUpMessage(xpCfg, message.author.id, result.newLevel, false);
      const target = xpCfg.levelUpChannel
        ? message.guild.channels.cache.get(xpCfg.levelUpChannel) ||
          message.channel
        : message.channel;
      target.send(levelUpPayload).catch(() => {});

      }
    }
  }

  const guildData2 = (await loadData())[message.guildId];

  // ── قناة مراقبة الايموجيات (تشمل الرسائل المعاد توجيهها Forward) ──
  if (guildData2?.emojiWatchChannel === message.channelId) {
    await addEmojisFromText(
      message.guild,
      collectWatchText(message),
      "EmojiWatch",
    );
  }

  // ── قناة مراقبة الستكرات (تشمل الرسائل المعاد توجيهها Forward) ──
  if (guildData2?.stickerWatchChannel === message.channelId) {
    const stickers = collectWatchStickers(message);
    if (stickers.size > 0)
      await addStickersFromMessage(message.guild, stickers);
  }
});

async function buildVoiceLeaderboardPayload(guildId, guild, period = "all") {
  const leaderboard = await getVoiceLeaderboard(guildId, period);
  if (!leaderboard || leaderboard.length === 0) return null;

  return buildLeaderboardEmbedPayload(leaderboard, guild, period, {
    title: "🎤 Voice XP Leaderboard",
    footerLabel: "voice",
    color: 0x5865f2,
  });
}

async function buildLeaderboardPayload(guildId, guild, period = "all") {
  const leaderboard = await getLeaderboard(guildId, period);
  if (!leaderboard || leaderboard.length === 0) return null;

  return buildLeaderboardEmbedPayload(leaderboard, guild, period, {
    title: "🏆 XP Leaderboard",
    footerLabel: "XP",
    color: 0xf1c40f,
  });
}

async function buildLeaderboardEmbedPayload(
  leaderboard,
  guild,
  period,
  options,
) {
  const userIds = leaderboard.map((entry) => entry.userId);
  if (guild?.members) {
    try {
      await guild.members.fetch({ user: userIds });
    } catch {}
  }

  const lines = leaderboard.map((entry) => {
    const name = `<@${entry.userId}>`;
    return `**${entry.rank}.** ${name} — **Level ${entry.level}** · **${Number(entry.periodXp || 0).toLocaleString()} XP**`;
  });

  const embed = new EmbedBuilder()
    .setColor(options.color)
    .setTitle(options.title)
    .setDescription(lines.join(String.fromCharCode(10)))
    .setFooter({
      text: `${guild?.name || "Server"} • ${options.footerLabel} rankings`,
    })
    .setTimestamp();

  return { embeds: [embed] };
}

// يجمع نص الرسالة العادي + محتوى أي رسالة تمت إعادة توجيهها (Forward) معها
function collectWatchText(message) {
  let text = message.content || "";
  text +=
    " " +
    (message.embeds || [])
      .map((e) =>
        [e.title, e.description, ...(e.fields || []).map((f) => f.value)].join(
          " ",
        ),
      )
      .join(" ");
  if (message.messageSnapshots?.size) {
    for (const snap of message.messageSnapshots.values()) {
      text += " " + (snap.content || "");
      text +=
        " " +
        (snap.embeds || [])
          .map((e) =>
            [
              e.title,
              e.description,
              ...(e.fields || []).map((f) => f.value),
            ].join(" "),
          )
          .join(" ");
    }
  }
  return text;
}

// يجمع ستكرات الرسالة العادية + ستكرات أي رسالة تمت إعادة توجيهها (Forward) معها
function collectWatchStickers(message) {
  const merged = new Collection(message.stickers);
  if (message.messageSnapshots?.size) {
    for (const snap of message.messageSnapshots.values()) {
      if (snap.stickers?.size) {
        for (const [id, sticker] of snap.stickers) merged.set(id, sticker);
      }
    }
  }
  return merged;
}

async function addEmojisFromText(guild, text, source) {
  const regex = /<a?:(\w+):(\d+)>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const [full, emojiName, emojiId] = match;
    if (
      guild.emojis.cache.find((e) => e.name === emojiName || e.id === emojiId)
    )
      continue;
    try {
      const ext = full.startsWith("<a:") ? "gif" : "png";
      await guild.emojis.create({
        attachment: `https://cdn.discordapp.com/emojis/${emojiId}.${ext}`,
        name: emojiName,
      });
      console.log(`[${source}] Added emoji: ${emojiName}`);
    } catch (err) {
      console.error(`[${source}] Failed to add ${emojiName}:`, err.message);
    }
  }
}

async function addStickersFromMessage(guild, stickers) {
  const { StickerFormatType } = require("discord.js");
  for (const [, sticker] of stickers) {
    // Lottie ستكرات تحتاج سيرفر موثق — نتخطاها
    if (sticker.format === StickerFormatType.Lottie) {
      console.log(`[StickerWatch] Skipping Lottie sticker: ${sticker.name}`);
      continue;
    }
    // تجنب الإضافة إذا موجود بنفس الاسم أو الـ ID
    if (
      guild.stickers.cache.find(
        (s) => s.name === sticker.name || s.id === sticker.id,
      )
    )
      continue;
    try {
      // GIF-format stickers are served from media.discordapp.net, NOT cdn.discordapp.com
      const url =
        sticker.format === StickerFormatType.GIF
          ? `https://media.discordapp.net/stickers/${sticker.id}.gif`
          : `https://cdn.discordapp.com/stickers/${sticker.id}.png`;
      await guild.stickers.create({
        file: url,
        name: sticker.name,
        tags: "⭐",
        reason: "Auto-added via sticker watch channel",
      });
      console.log(`[StickerWatch] Added sticker: ${sticker.name}`);
    } catch (err) {
      console.error(
        `[StickerWatch] Failed to add ${sticker.name}:`,
        err.message,
      );
    }
  }
}

client.on(Events.GuildMemberAdd, async (member) => {
  // ── Invite attribution and reward tiers ──
  try {
    await attributeInviteJoin(member);
  } catch (err) {
    console.error('[Invites] Join attribution error:', err.message);
  }

  // ── Auto Role ──
  try {
    const autoRole = loadConfig().autoRole || {};
    if (member.guild.id === '1374859719046463569' && autoRole.enabled && autoRole.roleId) {
      const role = await member.guild.roles.fetch(autoRole.roleId).catch(() => null);
      if (!role) {
        console.warn(`[AutoRole] Configured role ${autoRole.roleId} was not found.`);
      } else if (role.managed) {
        console.warn(`[AutoRole] Cannot assign managed role ${role.name}.`);
      } else {
        await member.roles.add(role, 'Automatic role on member join');
        console.log(`[AutoRole] Assigned ${role.name} to ${member.user.tag}.`);
      }
    }
  } catch (err) {
    console.error(`[AutoRole] Failed for ${member.user.tag}:`, err.message);
  }

  // ── Welcome card ──
  try {
    const cfg = loadConfig();
    const wc = cfg.welcome;
    if (wc?.enabled && wc?.channelId) {
      const welcomeChan = member.guild.channels.cache.get(wc.channelId);
      if (welcomeChan) {
        const memberCount = member.guild.memberCount;
        const avatarUrl = member.user.displayAvatarURL({
          extension: "png",
          size: 256,
        });
        const msg = (wc.message || "Welcome {user}!")
          .replace("{user}", `${member}`)
          .replace("{server}", member.guild.name)
          .replace("{count}", memberCount);

        let payload = {};

        if (wc.sendCard !== false) {
          const buffer = await generateWelcomeCard({
            username: member.user.username,
            avatarUrl,
            memberCount,
            guildName: member.guild.name,
            welcomeCfg: wc,
          });
          const attachment = new AttachmentBuilder(buffer, {
            name: "welcome.png",
          });

          if (wc.sendEmbed) {
            const { EmbedBuilder: _EB } = require("discord.js");
            const embed = new _EB()
              .setDescription(msg)
              .setImage("attachment://welcome.png")
              .setColor(0x7c3aed);
            payload = { embeds: [embed], files: [attachment] };
          } else {
            payload = { content: msg, files: [attachment] };
          }
        } else {
          if (wc.sendEmbed) {
            const { EmbedBuilder: _EB } = require("discord.js");
            const embed = new _EB()
              .setDescription(msg)
              .setColor(0x7c3aed)
              .setThumbnail(avatarUrl);
            payload = { embeds: [embed] };
          } else {
            payload = { content: msg };
          }
        }

        await welcomeChan.send(payload).catch(console.error);

        // Optional second Welcome message in a different channel.
        const second = wc.secondMessage || {};
        if (second.enabled && second.channelId && second.channelId !== wc.channelId) {
          const secondChan = member.guild.channels.cache.get(second.channelId)
            || await member.guild.channels.fetch(second.channelId).catch(() => null);
          if (secondChan?.send) {
            const secondMsg = (second.message || 'Welcome {user}!')
              .replaceAll('{user}', `${member}`)
              .replaceAll('{server}', member.guild.name)
              .replaceAll('{count}', String(memberCount));
            const secondPayload = {};
            if (second.sendEmbed) {
              const { EmbedBuilder: _EB2 } = require('discord.js');
              const secondColorHex = String(second.embedColor || '#7c3aed').replace('#', '');
              const secondColor = /^[0-9A-Fa-f]{6}$/.test(secondColorHex) ? parseInt(secondColorHex, 16) : 0x7c3aed;
              secondPayload.embeds = [new _EB2().setDescription(secondMsg).setColor(secondColor)];
            } else {
              secondPayload.content = secondMsg;
            }
            await secondChan.send(secondPayload).catch(error => {
              console.error('[Welcome] Second message failed:', error.message);
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("Welcome card error:", err.message);
  }

  // ── Level & Role restoration ──
  try {
    const userData = await getUserData(member.guild.id, member.id);
    if (userData && userData.level > 0) {
      const cfg = loadConfig();
      const levelRoles = cfg.xp?.levelRoles;
      if (levelRoles) {
        const eligibleEntries = Object.entries(levelRoles)
          .map(([lvl, roleId]) => ({ level: Number.parseInt(lvl, 10), roleId }))
          .filter(({ level, roleId }) => Number.isFinite(level) && level <= userData.level && roleId);
        const highestEntry = eligibleEntries.reduce(
          (highest, entry) => (!highest || entry.level > highest.level ? entry : highest),
          null,
        );
        if (highestEntry) {
          const configuredRoleIds = new Set(Object.values(levelRoles).filter(Boolean));
          const lowerRoleIds = [...configuredRoleIds].filter(
            (roleId) => roleId !== highestEntry.roleId && member.roles.cache.has(roleId),
          );
          if (lowerRoleIds.length > 0) {
            await member.roles.remove(lowerRoleIds, "Replaced by higher level role").catch((err) => {
              console.error(`[RestoreRoles] Failed to remove lower level roles from ${member.user.tag}:`, err.message);
            });
          }
          if (!member.roles.cache.has(highestEntry.roleId)) {
            await member.roles.add(highestEntry.roleId, "Level restoration on rejoin").catch((err) => {
              console.error(`[RestoreRoles] Failed to add level role to ${member.user.tag}:`, err.message);
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("[RestoreRoles] Error:", err.message);
  }

  // ── Emoji watcher ──
  try {
    const data = await loadData();
    const guildData = data[member.guild.id];
    if (guildData?.watchChannel) {
      const channel = member.guild.channels.cache.get(guildData.watchChannel);
      if (channel) {
        const messages = await channel.messages.fetch({ limit: 5 });
        for (const msg of messages.values()) {
          if (msg.webhookId || msg.author?.bot) {
            await addEmojisFromText(
              member.guild,
              msg.content || "",
              "MemberJoin",
            );
          }
        }
      }
    }
  } catch (err) {
    console.error("Error on member join emoji watch:", err.message);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  if (member.guild.id !== INVITE_GUILD_ID || member.user?.bot) return;
  try {
    const inviterId = await db.removeInviteJoin(member.guild.id, member.id);
    if (inviterId) await syncInviteRewardRoles(member.guild, inviterId);
    await refreshInvitePanel(member.guild);
    console.log(`[Invites] Removed ${member.user?.tag || member.id} from invite count.`);
  } catch (err) {
    console.error('[Invites] Leave correction error:', err.message);
  }
});

// ── NUMBER GUESS: listen for typed guesses ──
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const result = numguessHandle(message);
  if (!result) return;

  if (result.correct) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00b894)
          .setTitle("🎉 Correct!")
          .setDescription(
            `**${result.winner.username}** guessed it in **${result.attempts}** attempt${result.attempts === 1 ? "" : "s"}!\nThe number was **${result.answer}**.`,
          ),
      ],
    });
  } else {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x6c5ce7)
          .setDescription(`${result.hint} _(Attempt ${result.attempts})_`),
      ],
    });
  }
});

// ── Boost ticket: conversational messageCreate handler ──
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  const ticket = boostTickets.get(message.channelId);
  if (!ticket || ticket.userId !== message.author.id) return;

  const content = message.content.trim();
  const { stage, data } = ticket;

  // ── stage: waiting for role name (create) ──
  if (stage === "create_name") {
    if (content.length > 100)
      return message.reply("❌ الاسم طويل جداً! الحد الأقصى 100 حرف.");
    data.roleName = content;
    ticket.stage = "create_emoji";
    return message.channel.send(
      "😀 **أرسل إيموجي للرتبة.**\n" +
        "يمكنك إرسال إيموجي من **أي سيرفر**، إيموجي عادي، أو اكتب `skip` لتخطي هذه الخطوة.",
    );
  }

  // ── stage: waiting for emoji (create) ──
  if (stage === "create_emoji") {
    data.emoji =
      content.toLowerCase() === "skip" ? null : parseBoostEmoji(message);
    ticket.stage = "create_color";
    return message.channel.send(
      "🎨 **ما لون الرتبة؟**\n" +
        "مثال: `pink` `red` `blue` `gold` `purple` `violet` أو كود هيكس مثل `#FF73FA`",
    );
  }

  // ── stage: waiting for color (create) ──
  if (stage === "create_color") {
    const color = parseBoostColor(content);
    if (color === null)
      return message.reply(
        "❌ لون غير معروف! جرب مثلاً: `pink` `red` `blue` `gold` أو كود هيكس مثل `#FF73FA`",
      );
    ticket.stage = "done";
    try {
      console.log("[Boost ticket create] STEP 1: starting, roleName=", data.roleName, "color=", color);
      const guild = message.guild;
      const cfg = loadConfig();
      const roleOpts = {
        name: data.roleName,
        colors: { primaryColor: color },
        reason: `Boost role — ${message.author.tag}`,
        mentionable: false,
      };
      if (data.emoji?.iconUrl) roleOpts.icon = data.emoji.iconUrl;
      console.log("[Boost ticket create] STEP 2: calling guild.roles.create with", JSON.stringify({ name: roleOpts.name, colors: roleOpts.colors, hasIcon: !!roleOpts.icon }));
      const newRole = await guild.roles.create(roleOpts);
      console.log("[Boost ticket create] STEP 3: role created OK, id=", newRole.id);
      const boostCfg = cfg.boost || {};
      if (boostCfg.positionRoleId) {
        const refRole = guild.roles.cache.get(boostCfg.positionRoleId);
        if (refRole) {
          const pos =
            boostCfg.positionType === "below"
              ? Math.max(1, refRole.position - 1)
              : refRole.position;
          await newRole.setPosition(pos).catch((e) => console.error("[Boost ticket create] setPosition failed (non-fatal):", e.message));
        }
      }
      console.log("[Boost ticket create] STEP 4: fetching member");
      const member = await guild.members
        .fetch(message.author.id)
        .catch((e) => { console.error("[Boost ticket create] member fetch failed:", e.message); return null; });
      console.log("[Boost ticket create] STEP 5: member found?", !!member);
      if (member) {
        await member.roles.add(newRole, "Boost reward role");
        console.log("[Boost ticket create] STEP 6: role added to member OK");
      } else {
        console.error("[Boost ticket create] STEP 6 SKIPPED: member not found, role NOT assigned");
      }
      if (!cfg.boost) cfg.boost = {};
      if (!cfg.boost.roles) cfg.boost.roles = {};
      cfg.boost.roles[message.author.id] = {
        roleId: newRole.id,
        roleName: data.roleName,
        roleEmoji: data.emoji?.display || null,
        createdAt: Date.now(),
      };
      saveConfig(cfg);
      console.log("[Boost ticket create] STEP 7: config saved, sending confirmation");
      await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setDescription(`✅ تم إنشاء الرتبة ${newRole} وإضافتها إليك!`),
        ],
      });
      console.log("[Boost ticket create] STEP 8: confirmation sent, showing preview");
      return sendBoostRolePreview(message.channel, message.author.id, guild);
    } catch (err) {
      console.error("[Boost ticket create] FAILED at some step:", err.message);
      console.error("[Boost ticket create] FULL STACK:", err.stack);
      return failBoostTicket(
        message.channelId,
        `فشل إنشاء الرتبة: ${err.message}`,
      );
    }
  }

  // ── stage: waiting for new name (rename) ──
  if (stage === "rename_name") {
    if (content.length > 100)
      return message.reply("❌ الاسم طويل جداً! الحد الأقصى 100 حرف.");
    ticket.stage = "done";
    const cfg = loadConfig();
    const rd = cfg.boost?.roles?.[message.author.id];
    if (!rd?.roleId)
      return failBoostTicket(message.channelId, "ما وجدت رتبتك.");
    try {
      const role = message.guild.roles.cache.get(rd.roleId);
      if (role) await role.setName(content, "Booster renamed role");
      rd.roleName = content;
      saveConfig(cfg);
      return sendBoostRolePreview(
        message.channel,
        message.author.id,
        message.guild,
      );
    } catch (err) {
      return failBoostTicket(
        message.channelId,
        `فشل تغيير الاسم: ${err.message}`,
      );
    }
  }

  // ── stage: waiting for emoji (change) ──
  if (stage === "emoji_val") {
    ticket.stage = "done";
    const cfg = loadConfig();
    const rd = cfg.boost?.roles?.[message.author.id];
    if (!rd?.roleId)
      return failBoostTicket(message.channelId, "ما وجدت رتبتك.");
    try {
      const role = message.guild.roles.cache.get(rd.roleId);
      if (content.toLowerCase() === "none") {
        if (role)
          await role.setIcon(null, "Booster removed emoji").catch(() => {});
        rd.roleEmoji = null;
        saveConfig(cfg);
        return sendBoostRolePreview(
          message.channel,
          message.author.id,
          message.guild,
        );
      }
      const emoji = parseBoostEmoji(message);
      if (!emoji)
        return message.reply(
          "❌ ما قدرت أقرأ الإيموجي! أرسل الإيموجي مباشرة أو اكتب `none` لإزالته.",
        );
      ticket.stage = "done";
      if (emoji.iconUrl && role)
        await role
          .setIcon(emoji.iconUrl, "Booster changed emoji")
          .catch(() => {});
      rd.roleEmoji = emoji.display;
      saveConfig(cfg);
      return sendBoostRolePreview(
        message.channel,
        message.author.id,
        message.guild,
      );
    } catch (err) {
      return failBoostTicket(
        message.channelId,
        `فشل تغيير الإيموجي: ${err.message}`,
      );
    }
  }

  // ── stage: waiting for color (change) ──
  if (stage === "color_val") {
    const color = parseBoostColor(content);
    if (color === null)
      return message.reply(
        "❌ لون غير معروف! جرب مثلاً: `pink` `red` `blue` `gold` أو كود هيكس مثل `#FF73FA`",
      );
    ticket.stage = "done";
    const cfg = loadConfig();
    const rd = cfg.boost?.roles?.[message.author.id];
    if (!rd?.roleId)
      return failBoostTicket(message.channelId, "ما وجدت رتبتك.");
    try {
      const role = message.guild.roles.cache.get(rd.roleId);
      if (role) await role.setColors({ primaryColor: color }, "Booster changed color");
      saveConfig(cfg);
      return sendBoostRolePreview(
        message.channel,
        message.author.id,
        message.guild,
      );
    } catch (err) {
      return failBoostTicket(
        message.channelId,
        `فشل تغيير اللون: ${err.message}`,
      );
    }
  }
});

const token = DISCORD_BOT_TOKEN;
if (!token || token === "ضع_التوكن_هنا") {
  console.error("DISCORD_BOT_TOKEN is missing.");
  process.exit(1);
}

// Connect to Turso, start the web server, then attempt Discord login.
db.initDb()
  .then(async () => {
    await initWebConfig();
    const { initLocalXP } = require('./localTrust');
    await initLocalXP();
    await initGiveaways();
    startWebServer(client);
    startActiveChatRole(client, () => loadConfig());
    // Login is non-blocking — web dashboard stays up even if Discord is unreachable.
    client.login(token).catch((err) => {
      console.error("[startup] Discord login failed:", err.message);
    });
  })
  .catch((err) => {
    console.error("[startup] Failed to initialise Turso:", err?.stack || err?.message || err);
    process.exit(1);
  });

// === Local XP Tracker ===
try {
  const { addLocalXP } = require('./localTrust');
  if (typeof client !== 'undefined') {
    client.on('messageCreate', (message) => {
      if (message && message.author && !message.author.bot && message.guild) {
        addLocalXP(message.author.id, 5);
      }
    });
  }
} catch (err) {
  console.error("Local XP Handler Error:", err.message);
}
