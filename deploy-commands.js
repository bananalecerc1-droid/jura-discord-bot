require("dotenv").config();
let cfg = {};
try { cfg = require("./config.json"); } catch {}
const {
  REST,
  Routes,
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
} = require("discord.js");

// ── إعدادات البوت (تُقرأ من config.json) ──
const token = process.env.DISCORD_BOT_TOKEN || cfg.token;
const clientId = process.env.DISCORD_CLIENT_ID || cfg.clientId;

if (
  !token ||
  !clientId ||
  token === "ضع_التوكن_هنا" ||
  clientId === "ضع_معرف_البوت_هنا"
) {
  console.error("Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID.");
  process.exit(1);
}

// Shorthand helpers
// DM-allowed: works in servers, bot DMs, AND friend DMs (private channels)
// Normal commands are guild-installed only. This prevents moderation commands
// from appearing in unrelated servers when the app is connected to a user account.
const DM_TYPES = [ApplicationIntegrationType.GuildInstall];
// Only the private downloader is available through User Install / DMs.
const DOWN_TYPES = [
  ApplicationIntegrationType.GuildInstall,
  ApplicationIntegrationType.UserInstall,
];
// Default context for commands that must stay in servers.
const DM_CONTEXTS = [
  InteractionContextType.Guild,
];
// Only commands explicitly using this list are visible in DMs.
const ALLOWED_DM_CONTEXTS = [
  InteractionContextType.Guild,
  InteractionContextType.BotDM,
  InteractionContextType.PrivateChannel,
];
const DOWN_CONTEXTS = [
  InteractionContextType.BotDM,
  InteractionContextType.PrivateChannel,
];

const commands = [
  // ── Birthday ──
  new SlashCommandBuilder()
    .setName("birthday")
    .setDescription("Birthday system")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set your birthday")
        .addIntegerOption((o) =>
          o
            .setName("day")
            .setDescription("Day (1-31)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(31),
        )
        .addIntegerOption((o) =>
          o
            .setName("month")
            .setDescription("Month (1-12)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(12),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("remove").setDescription("Remove your birthday"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("check")
        .setDescription("Check someone's birthday")
        .addUserOption((o) =>
          o.setName("user").setDescription("User to check").setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("See upcoming birthdays"),
    )
    .toJSON(),

  // ── Roleplay Commands ──
  ...[
    "kiss",
    "hug",
    "slap",
    "pat",
    "cuddle",
    "byte",
    "lipkiss",
    "poke",
    "tickle",
    "highfive",
    "lick",
  ].map((name) => {
    const rpDescriptions = {
      kiss: "Give someone a cheek kiss",
      hug: "Give someone a hug 🤗",
      slap: "Slap someone 👋",
      pat: "Pat someone on the head 😊",
      cuddle: "Cuddle with someone 🥰",
      byte: "Bite someone 😬",
      lipkiss: "Blow a lip kiss to someone",
      poke: "Poke someone 👉",
      tickle: "Tickle someone 🤣",
      highfive: "High five someone ✋",
      lick: "Lick someone 👅",
    };
    return new SlashCommandBuilder()
      .setName(name)
      .setDescription(rpDescriptions[name] || `Send a ${name} to someone`)
      .setIntegrationTypes(DM_TYPES)
      .setContexts(ALLOWED_DM_CONTEXTS)
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("Who to " + name)
          .setRequired(true),
      )
      .toJSON();
  }),

  // ── Emotion Commands ──
  ...[
    "happy",
    "angry",
    "sad",
    "cry",
    "laugh",
    "dance",
    "wave",
    "son",
    "sleep",
    "blush",
    "smile",
    "wink",
    "think",
  ].map((name) => {
    const descriptions = {
      happy: "Express happiness with a GIF 😄",
      angry: "Express anger with a GIF 😡",
      sad: "Express sadness with a GIF 😢",
      cry: "Express crying with a GIF 😭",
      laugh: "Express laughter with a GIF 😂",
      dance: "Express dancing with a GIF 💃",
      wave: "Wave hello with a GIF 👋",
      son: "Send a random SON meme GIF 😭😭😭😭😭",
      sleep: "Show a sleeping GIF 😴",
      blush: "Show a blushing GIF 😊",
      smile: "Show a smiling GIF 😊",
      wink: "Wink with a GIF 😉",
      think: "Show a thinking GIF 🤔",
    };
    return new SlashCommandBuilder()
      .setName(name)
      .setDescription(descriptions[name])
      .setIntegrationTypes(DM_TYPES)
      .setContexts(ALLOWED_DM_CONTEXTS)
      .addStringOption((opt) =>
        opt
          .setName("message")
          .setDescription("Optional message to include")
          .setRequired(false),
      )
      .toJSON();
  }),

  // ── Roulette ──
  new SlashCommandBuilder()
    .setName("roulette")
    .setDescription("🎲 Start an interactive roulette game")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("توقيف")
    .setDescription("⛔ إيقاف لعبة الروليت الحالية")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .toJSON(),

  // ── Games ──
  new SlashCommandBuilder()
    .setName("numguess")
    .setDescription("Start a number guessing game (1–100) in this channel")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(ALLOWED_DM_CONTEXTS)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("trivia")
    .setDescription(
      "احصل على سؤال معلومات عامة عشوائي مع خيارات متعددة",
    )
    .setIntegrationTypes(DM_TYPES)
    .setContexts(ALLOWED_DM_CONTEXTS)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Play a game of Blackjack against the dealer")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(ALLOWED_DM_CONTEXTS)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("minesweeper")
    .setDescription("Play interactive Minesweeper with buttons")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(ALLOWED_DM_CONTEXTS)
    .addStringOption((opt) =>
      opt
        .setName("difficulty")
        .setDescription("Grid difficulty (default: medium)")
        .setRequired(false)
        .addChoices(
          { name: "Easy (4×4, 3 mines)", value: "easy" },
          { name: "Medium (5×5, 6 mines)", value: "medium" },
          { name: "Hard (5×5, 10 mines)", value: "hard" },
        ),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("slots")
    .setDescription("🎰 العب ماكينة الحظ! شاهد البكرات تدور وتتوقف")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(ALLOWED_DM_CONTEXTS)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("cat")
    .setDescription("🐱 لعبة كت — أجب على أسئلة شخصية بصراحة!")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(ALLOWED_DM_CONTEXTS)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("race")
    .setDescription("🏎️ تحدّى صديقك على سباق سيارات! (في الDM تتسابق ضد البوت)")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(ALLOWED_DM_CONTEXTS)
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("العضو الذي تريد تحديه")
        .setRequired(false),
    )
    .toJSON(),

  // ── XP / Profile ──
  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("View your XP rank card or another member's")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("Member to check (default: yourself)")
        .setRequired(false),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the top 10 members by XP in this server")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .addStringOption((opt) =>
      opt
        .setName("period")
        .setDescription("الفترة الزمنية (افتراضي: كل الوقت)")
        .setRequired(false)
        .addChoices(
          { name: "🌅 اليوم", value: "today" },
          { name: "📅 الأسبوع", value: "week" },
          { name: "🗓️ الشهر", value: "month" },
          { name: "🏆 كل الوقت", value: "all" },
        ),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("top")
    .setDescription("🏆 عرض لوحة المتصدرين")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .addStringOption((opt) =>
      opt
        .setName("type")
        .setDescription("نوع اللوحة")
        .setRequired(false)
        .addChoices(
          { name: "🏆 الإجمالي", value: "all" },
          { name: "🌅 اليومي", value: "daily" },
          { name: "📅 الأسبوعي", value: "weekly" },
          { name: "📆 الشهري", value: "monthly" },
        ),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("st")
    .setDescription("اعرض الستريك الحالي وأعلى تقدم")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("العضو المراد عرض ستريكه (افتراضي: أنت)")
        .setRequired(false),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("setbg")
    .setDescription("Upload a custom background image for your rank card")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .addAttachmentOption((opt) =>
      opt
        .setName("image")
        .setDescription("Image to use as background (PNG/JPG recommended)")
        .setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("resetbg")
    .setDescription(
      "Remove your custom rank card background and go back to default",
    )
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .toJSON(),

  // ── Giveaway ──
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Start a giveaway")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .addStringOption((opt) =>
      opt
        .setName("prize")
        .setDescription("What are you giving away?")
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("duration")
        .setDescription("Duration: 30s, 1m, 1h, 1d, or 1d 2h")
        .setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("winners")
        .setDescription("Number of winners (default 1)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(20),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("giveaway-reroll")
    .setDescription("Reroll a winner from an ended giveaway")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .addStringOption((opt) => opt.setName("message_id").setDescription("Message ID of the ended giveaway").setRequired(true))
    .toJSON(),
  // ── Jail System ──
  new SlashCommandBuilder()
    .setName("سجن")
    .setDescription("سجن عضو ويحصر رؤيته على روم واحد فقط")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .addUserOption((opt) =>
      opt.setName("user").setDescription("العضو المراد سجنه").setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("فك_سجن")
    .setDescription("يفك السجن عن عضو")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("العضو المراد فك سجنه")
        .setRequired(true),
    )
    .toJSON(),

  // ── User Info / Avatar / Banner ──
  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("See info about a user — join dates, roles, and more")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("User to look up (default: you)")
        .setRequired(false),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Show a user's profile picture")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(ALLOWED_DM_CONTEXTS)
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("User to look up (default: you)")
        .setRequired(false),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("banner")
    .setDescription("Show a user's profile banner")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(ALLOWED_DM_CONTEXTS)
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("User to look up (default: you)")
        .setRequired(false),
    )
    .toJSON(),

  // ── Ticket ──
  new SlashCommandBuilder()
    .setName("close")
    .setDescription("Close the current support ticket")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("rename")
    .setDescription("Rename the current support ticket channel")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .addStringOption((opt) =>
      opt
        .setName("name")
        .setDescription("New channel name")
        .setRequired(true)
        .setMaxLength(100),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("resetstaffpoints")
    .setDescription("تصفير نقاط فريق الإدارة بالكامل")
    .setContexts(DM_CONTEXTS)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .toJSON(),

  // ── Nickname ──
  new SlashCommandBuilder()
    .setName("nickname")
    .setDescription("Change a member's server nickname")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Member whose nickname should change").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("name").setDescription("New nickname; leave empty to restore original").setRequired(false).setMaxLength(32),
    )
    .toJSON(),

  // ── Private media downloader ──
  new SlashCommandBuilder()
    .setName("down")
    .setDescription("Download an Instagram, TikTok, or YouTube video")
    .setIntegrationTypes(DOWN_TYPES)
    .setContexts(DOWN_CONTEXTS)
    .addStringOption((opt) =>
      opt
        .setName("link")
        .setDescription("Instagram, TikTok, or YouTube URL")
        .setRequired(true),
    )
    .toJSON(),
  // ── Say ──
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("خلّ البوت يرسل رسالة")
    .setIntegrationTypes(DM_TYPES)
    .setContexts(DM_CONTEXTS)
    .addStringOption((opt) =>
      opt
        .setName("message")
        .setDescription("الرسالة اللي تبي البوت يقولها")
        .setRequired(true),
    )
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("الروم اللي تبي تبعت فيه (افتراضي: نفس الروم)")
        .setRequired(false),
    )
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("Registering commands...");
    const timeout = new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "Discord API timed out after 5s — skipping command registration",
            ),
          ),
        5_000,
      ),
    );
    await Promise.race([
      rest.put(Routes.applicationCommands(clientId), { body: commands }),
      timeout,
    ]);
    console.log("Commands registered successfully.");
  } catch (error) {
    console.error("Warning (non-fatal):", error.message);
  }
  process.exit(0);
})();
