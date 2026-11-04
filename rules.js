const DEFAULT_RULES = [
  'قم باحترام كل من في الخادم، السب والإهانة غير مرغوبٍ بهما. لا تتصرف بطريقة غير لائقة مع الأعضاء.',
  'مواضيع الـ NSFW غير مرغوبٍ بها في الخادم، فلا تقم بتداولها أو نشرها بأي شكلٍ كان.',
  'لا تقم بإزعاج الأعضاء بالمنشن المتكرر أو إرسال الرسائل بشكلٍ مزعج (Spam)، واحرص على عدم إفساد المحادثات.',
  'لا تقم بنشر روابط أو الإعلانات الخاصة بخوادم أو منصاتٍ أخرى دون إذنٍ من الإدارة.',
  'استخدم كل روم فيما خُصص له، ولا تقم بإرسال محتوى خارج عن موضوع الروم.',
  'لا تقم بانتحال شخصية أي عضو أو إداري، أو استخدام أسماء وصورٍ قد تسبب اللبس بين الأعضاء.',
  'يمنع نشر أو طلب أي معلوماتٍ شخصية تخصك أو تخص غيرك، حفاظًا على خصوصية الجميع.',
  'لا تقم بإثارة المشاكل أو الفتن بين الأعضاء، وإذا واجهتك مشكلة فتوجه إلى الإدارة لحلها.',
  'يمنع استغلال أي ثغرة أو خطأ داخل الخادم، ويجب إبلاغ الإدارة بها عند اكتشافها.',
  'قرارات الإدارة وطاقم الإشراف وُضعت للمحافظة على نظام الخادم، لذا يُرجى احترامها.',
  'الأشياء التي قد تُشعل كراهية في الخادم غير مرغوب بها، فلا تقم بالتلميح أو التحدث عنها.',
  'الطائفية الدينية والعنصرية العرقية ممنوعة بشكل كامل.',
  'لا تقم بالتقليل من تفكير أحدهم أو تفضيلاته، بل كن شخصًا ودودًا لتنال احترامهم.',
];

const DEFAULT_NOTE = 'يحق للإدارة اتخاذ العقوبة المناسبة بحسب نوع المخالفة، وقد يتم تجاوز التنبيه في حال كانت المخالفة جسيمة.';

/**
 * Build spreads from a rules array + note.
 * 3 rules per page, 2 pages per spread → 6 per spread.
 * The final spread always has the note on the right page.
 */
function buildSpreads(rules, note) {
  const spreads = [];
  for (let i = 0; i < rules.length; i += 6) {
    const left  = rules.slice(i, i + 3);
    const right = rules.slice(i + 3, i + 6);
    spreads.push({
      left,
      leftStart:  i + 1,
      right,
      rightStart: i + 4,
      rightNote:  null,
    });
  }
  // Attach the note to the right side of the last spread
  if (spreads.length > 0) {
    const last = spreads[spreads.length - 1];
    last.rightNote = note || DEFAULT_NOTE;
    // If the last spread already has right-page rules, add a new spread for the note
    if (last.right.length > 0) {
      last.rightNote = null;
      spreads.push({ left: [], leftStart: 0, right: [], rightStart: 0, rightNote: note || DEFAULT_NOTE });
    }
  } else {
    spreads.push({ left: [], leftStart: 0, right: [], rightStart: 0, rightNote: note || DEFAULT_NOTE });
  }
  return spreads;
}

// Static default export for backward-compat
const RULES   = DEFAULT_RULES;
const NOTE    = DEFAULT_NOTE;
const SPREADS = buildSpreads(DEFAULT_RULES, DEFAULT_NOTE);

module.exports = { RULES, SPREADS, NOTE, DEFAULT_RULES, DEFAULT_NOTE, buildSpreads };
