'use strict';
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { generateQuoteCard } = require('../cards/autoQuoteCard.js');

// ─── Quote bank (Arabic wisdom quotes) ───────────────────────────────────────
const QUOTES = [
  // Wisdom / حكمة
  { quote: 'من عرف نفسه فقد عرف ربه', author: 'مثل عربي', category: 'wisdom' },
  { quote: 'العقل السليم في الجسم السليم', author: 'مثل عربي', category: 'wisdom' },
  { quote: 'خير الكلام ما قلّ ودلّ', author: 'مثل عربي', category: 'wisdom' },
  { quote: 'الصمت أبلغ من الكلام في أحيان كثيرة', author: 'مثل عربي', category: 'wisdom' },
  { quote: 'لا تؤجل عمل اليوم إلى الغد', author: 'مثل عربي', category: 'wisdom' },
  { quote: 'التجربة خير معلم', author: 'مثل عربي', category: 'wisdom' },
  { quote: 'العلم نور والجهل ظلام', author: 'مثل عربي', category: 'wisdom' },
  { quote: 'اتقِ شر من أحسنت إليه', author: 'مثل عربي', category: 'wisdom' },
  { quote: 'من حسن إسلام المرء تركه ما لا يعنيه', author: 'حديث شريف', category: 'wisdom' },
  { quote: 'إنما الأعمال بالنيات', author: 'حديث شريف', category: 'wisdom' },
  { quote: 'الحكمة ضالة المؤمن أنى وجدها فهو أحق بها', author: 'حديث شريف', category: 'wisdom' },
  // Motivation / تحفيز
  { quote: 'لا تقل لا أستطيع قبل أن تحاول', author: 'مثل عربي', category: 'motivation' },
  { quote: 'الإرادة الصادقة تهزم المستحيل', author: 'مثل عربي', category: 'motivation' },
  { quote: 'النجاح ليس نهاية الطريق بل بداية طريق أطول', author: 'مثل عربي', category: 'motivation' },
  { quote: 'كل عاقبة الصبر جميلة', author: 'مثل عربي', category: 'motivation' },
  { quote: 'لا يُدرك المجد من يبقى في راحة دائمة', author: 'مثل عربي', category: 'motivation' },
  { quote: 'من جد وجد ومن زرع حصد', author: 'مثل عربي', category: 'motivation' },
  { quote: 'ابدأ حيث أنت، استخدم ما لديك، افعل ما تستطيع', author: 'مثل عربي', category: 'motivation' },
  { quote: 'الأحلام لا تتحقق من النوم بل من اليقظة والعمل', author: 'مثل عربي', category: 'motivation' },
  // Life / حياة
  { quote: 'الحياة قصيرة فلا تضيع وقتك في ما لا يهم', author: 'مثل عربي', category: 'life' },
  { quote: 'جمال الإنسان في أخلاقه لا في مظهره', author: 'مثل عربي', category: 'life' },
  { quote: 'الوقت كالسيف إن لم تقطعه قطعك', author: 'مثل عربي', category: 'life' },
  { quote: 'الصحة تاج على رؤوس الأصحاء لا يراه إلا المرضى', author: 'مثل عربي', category: 'life' },
  { quote: 'العمر أمانة فلا تضيعه', author: 'مثل عربي', category: 'life' },
  { quote: 'لا يعرف قيمة اللحظة إلا من فقدها', author: 'مثل عربي', category: 'life' },
  // Religion / روحانية
  { quote: 'وَمَن يَتَّقِ اللَّهَ يَجْعَل لَّهُ مَخْرَجًا وَيَرْزُقْهُ مِنْ حَيْثُ لَا يَحْتَسِبُ', author: 'القرآن الكريم', category: 'religion' },
  { quote: 'إِنَّ مَعَ الْعُسْرِ يُسْرًا', author: 'القرآن الكريم', category: 'religion' },
  { quote: 'وَلَا تَيْأَسُوا مِن رَّوْحِ اللَّهِ ۖ إِنَّهُ لَا يَيْأَسُ مِن رَّوْحِ اللَّهِ إِلَّا الْقَوْمُ الْكَافِرُونَ', author: 'القرآن الكريم', category: 'religion' },
  { quote: 'الدنيا سجن المؤمن وجنة الكافر', author: 'حديث شريف', category: 'religion' },
  // Success / نجاح
  { quote: 'النجاح هو نتيجة الاستعداد والعمل الجاد والتعلم من الفشل', author: 'مثل عربي', category: 'success' },
  { quote: 'لا يعلو سقفُ مَن لم يبنِ أساساً متيناً', author: 'مثل عربي', category: 'success' },
  { quote: 'الفاشل من يلوم الآخرين، والناجح من يلوم نفسه', author: 'مثل عربي', category: 'success' },
  { quote: 'كل فشل هو خطوة نحو النجاح لمن لم يستسلم', author: 'مثل عربي', category: 'success' },
  // Nature / طبيعة
  { quote: 'كما تزرع تحصد', author: 'مثل عربي', category: 'nature' },
  { quote: 'قطرة الماء تثقب الصخر بالمواصلة لا بالقوة', author: 'مثل عربي', category: 'nature' },
  { quote: 'الشجرة ذات الثمار كثيراً ما تُقطف', author: 'مثل عربي', category: 'nature' },
  // Love / محبة
  { quote: 'تعامل مع الناس كما تحب أن يعاملوك', author: 'مثل عربي', category: 'love' },
  { quote: 'الكلمة الطيبة صدقة', author: 'حديث شريف', category: 'love' },
  { quote: 'أحب لأخيك ما تحب لنفسك', author: 'حديث شريف', category: 'love' },
  { quote: 'خير الناس أنفعهم للناس', author: 'حديث شريف', category: 'love' },
];

let _timer = null;
let _lastIndex = -1;
// Track effective settings so we can detect changes without writing to config
let _activeIntervalMs = 0;
let _activeEnabled = false;
let _activeCategories = '';
let _activeFooterText = '';

/** Pick a quote respecting selected categories (never repeats back-to-back) */
function pickQuote(categories) {
  const cats = categories?.length ? new Set(categories) : null;
  const eligible = QUOTES.filter((q, i) => {
    if (i === _lastIndex) return false;
    if (cats && !cats.has(q.category)) return false;
    return true;
  });
  // Fall back to full pool if filtering leaves nothing
  const pool = eligible.length ? eligible : QUOTES.filter((_, i) => i !== _lastIndex);
  const q = pool[Math.floor(Math.random() * pool.length)];
  _lastIndex = QUOTES.indexOf(q);
  return q;
}

/** Send one quote card to the configured channel */
async function sendQuoteNow(client, loadConfig) {
  const cfg = loadConfig().autoQuote;
  if (!cfg?.channelId) throw new Error('لم يتم تحديد الروم في الإعدادات');

  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel) throw new Error('الروم غير موجود أو البوت لا يملك صلاحية الوصول إليه');

  const guild = channel.guild;
  const serverName = guild?.name || '';

  const q = pickQuote(cfg.categories);
  const imgBuf = await generateQuoteCard({ ...q, serverName });
  const attachment = new AttachmentBuilder(imgBuf, { name: 'quote.png' });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setImage('attachment://quote.png')
    .setFooter({ text: cfg.footerText || '✨ حكمة اليوم' });

  await channel.send({ embeds: [embed], files: [attachment] });
}

/** (Re)build the send timer from current config */
function _rebuildTimer(client, loadConfig) {
  if (_timer) { clearInterval(_timer); _timer = null; }

  const cfg = loadConfig().autoQuote || {};
  if (!cfg.enabled || !cfg.channelId) {
    _activeEnabled = false;
    _activeIntervalMs = 0;
    _activeCategories = '';
    _activeFooterText = '';
    return;
  }

  const intervalMs = Math.max(1, cfg.intervalHours || 4) * 60 * 60 * 1000;
  _activeEnabled = true;
  _activeIntervalMs = intervalMs;
  _activeCategories = (cfg.categories || []).join(',');
  _activeFooterText = cfg.footerText || '';

  _timer = setInterval(() => {
    sendQuoteNow(client, loadConfig).catch(e =>
      console.error('[autoQuote] send error:', e.message)
    );
  }, intervalMs);
}

/** Start the scheduler and watch for config changes every 30 seconds */
function initAutoQuote(client, loadConfig) {
  _rebuildTimer(client, loadConfig);

  // Poll for config changes; rebuild timer if enabled/interval/channel changed
  setInterval(() => {
    const cfg = loadConfig().autoQuote || {};
    const nowEnabled = !!(cfg.enabled && cfg.channelId);
    // Only these matter while disabled is 0/'' either way, so avoid computing
    // them off stale/default cfg values that would never match the stored
    // disabled state (that was causing a false "changed" every 30s).
    const wantedMs = nowEnabled ? Math.max(1, cfg.intervalHours || 4) * 60 * 60 * 1000 : 0;
    const nowCategories = nowEnabled ? (cfg.categories || []).join(',') : '';
    const nowFooterText = nowEnabled ? (cfg.footerText || '') : '';

    if (nowEnabled !== _activeEnabled || wantedMs !== _activeIntervalMs || nowCategories !== _activeCategories || nowFooterText !== _activeFooterText) {
      console.log('[autoQuote] config changed — rebuilding scheduler');
      _rebuildTimer(client, loadConfig);
    }
  }, 30_000);
}

module.exports = { initAutoQuote, sendQuoteNow, QUOTES };
