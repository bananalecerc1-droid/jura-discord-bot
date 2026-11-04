const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

GlobalFonts.registerFromPath(path.join(__dirname, '../../fonts', 'NotoSansArabic.ttf'), 'NotoArabic');

const W = 960, H = 680;
const SPINE_W = 30;
const BOOK_X = 28, BOOK_Y = 28;
const BOOK_W = W - 56, BOOK_H = H - 56;
const PAGE_W = (BOOK_W - SPINE_W) / 2;

const FONT_TITLE  = `bold 19px NotoArabic, sans-serif`;
const FONT_NUM    = `bold 26px NotoArabic, sans-serif`;
const FONT_TEXT   = `21px NotoArabic, sans-serif`;
const FONT_NOTE   = `19px NotoArabic, sans-serif`;
const LINE_H      = 32;   // px per text line
const NUM_H       = 36;   // height of rule-number row
const RULE_GAP    = 18;   // gap between rules

/** Build a full theme object from a partial colors override. */
function buildTheme(colors = {}) {
  const gold      = colors.gold      || '#b8902a';
  const goldLight = colors.goldLight || lighten(gold, 0.15);
  return {
    outerBg1:  colors.outerBg1  || '#1a1030',
    outerBg2:  colors.outerBg2  || '#080610',
    pageBg1:   colors.pageBg1   || '#f5edd8',
    pageBg2:   colors.pageBg2   || '#ede5cc',
    gold,
    goldLight,
    spine1:    colors.spine1    || '#120a28',
    spine2:    colors.spine2    || '#3a2060',
    ink:       colors.ink       || '#1a1020',
    headerInk: colors.headerInk || '#2a1a4a',
  };
}

/** Naïve hex lightener — returns a lighter shade of a hex color. */
function lighten(hex, amount) {
  const c = hex.replace('#', '');
  const num = parseInt(c.length === 3
    ? c.split('').map(x => x + x).join('')
    : c, 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * amount));
  const g = Math.min(255, ((num >>  8) & 0xff) + Math.round(255 * amount));
  const b = Math.min(255, ( num        & 0xff) + Math.round(255 * amount));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function wrapText(ctx, text, maxWidth) {
  // Split on ANY run of whitespace — including literal newlines that can sneak
  // in from a multi-line dashboard textarea. Splitting on a plain ' ' only
  // left "wordA\nwordB" glued together as a single unbreakable token, which
  // could render wider than maxWidth and overflow past the page border.
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else if (ctx.measureText(word).width > maxWidth) {
      // A single word alone is already wider than the box (very long word/URL
      // with no spaces) — hard-break it character by character so it never
      // overflows the page instead of silently spilling past the border.
      if (line) { lines.push(line); line = ''; }
      let chunk = '';
      for (const ch of word) {
        const testChunk = chunk + ch;
        if (ctx.measureText(testChunk).width > maxWidth && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk = testChunk;
        }
      }
      line = chunk;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawPageBase(ctx, x, y, w, h, isRight, theme) {
  const { pageBg1, pageBg2, gold } = theme;
  // shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetX = isRight ? 5 : -5;
  ctx.fillStyle = pageBg1;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  // gradient fill
  const pg = ctx.createLinearGradient(x, y, x + w, y + h);
  pg.addColorStop(0, isRight ? pageBg2 : pageBg1);
  pg.addColorStop(1, isRight ? pageBg1 : pageBg2);
  ctx.fillStyle = pg;
  ctx.fillRect(x, y, w, h);

  // outer decorative border
  ctx.strokeStyle = gold;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 14, y + 14, w - 28, h - 28);

  // inner thin border
  ctx.strokeStyle = gold + '55';
  ctx.lineWidth = 0.7;
  ctx.strokeRect(x + 18, y + 18, w - 36, h - 36);

  // corner dots
  [[x+14,y+14],[x+w-14,y+14],[x+14,y+h-14],[x+w-14,y+h-14]].forEach(([cx,cy]) => {
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = gold;
    ctx.fill();
  });
}

function drawPageHeader(ctx, x, y, w, title, theme) {
  const { gold, headerInk } = theme;
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = headerInk;
  ctx.font = FONT_TITLE;
  ctx.fillText(title, x + w / 2, y + 36);
  ctx.restore();

  // header double line
  ctx.fillStyle = gold;
  ctx.fillRect(x + 26, y + 44, w - 52, 2);
  ctx.fillStyle = gold + '55';
  ctx.fillRect(x + 26, y + 48, w - 52, 0.8);
}

function drawPageFooter(ctx, x, y, w, h, theme) {
  const { gold } = theme;
  ctx.fillStyle = gold + '55';
  ctx.fillRect(x + 26, y + h - 48, w - 52, 0.8);
  ctx.fillStyle = gold;
  ctx.fillRect(x + 26, y + h - 44, w - 52, 2);
}

function drawPage(ctx, x, y, w, h, rules, startNum, title, isRight, theme) {
  const { gold, goldLight, ink } = theme;
  drawPageBase(ctx, x, y, w, h, isRight, theme);
  drawPageHeader(ctx, x, y, w, title, theme);
  drawPageFooter(ctx, x, y, w, h, theme);

  if (!rules.length) return;

  // content area
  const contentTop = y + 58;
  const contentBot = y + h - 52;
  const contentH   = contentBot - contentTop;
  const textX      = x + w - 30;
  const maxW       = w - 56;

  // pre-measure lines per rule so we can distribute evenly
  ctx.save();
  ctx.font = FONT_TEXT;
  const wrapped = rules.map(r => wrapText(ctx, r, maxW - 12));
  ctx.restore();

  // total used height → spread evenly
  const totalRuleH = rules.length * NUM_H + wrapped.reduce((a, ls) => a + ls.length * LINE_H, 0);
  const extraGap   = Math.max(RULE_GAP, (contentH - totalRuleH) / (rules.length + 1));

  let curY = contentTop + extraGap;

  rules.forEach((rule, i) => {
    const num      = startNum + i;
    const numLabel = `. ${num}`;

    // number
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillStyle = goldLight;
    ctx.font = FONT_NUM;
    ctx.fillText(numLabel, textX, curY);
    const numW = ctx.measureText(numLabel).width;
    ctx.restore();

    // gold underline under number
    ctx.fillStyle = gold + '66';
    ctx.fillRect(textX - numW - 2, curY + 3, numW + 4, 1.5);

    curY += NUM_H;

    // rule text
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillStyle = ink;
    ctx.font = FONT_TEXT;
    wrapped[i].forEach(line => {
      ctx.fillText(line, textX, curY);
      curY += LINE_H;
    });
    ctx.restore();

    curY += extraGap;
  });
}

function drawNotePage(ctx, x, y, w, h, note, theme) {
  const { ink } = theme;
  drawPageBase(ctx, x, y, w, h, true, theme);
  drawPageHeader(ctx, x, y, w, ' ملاحظة مهمة', theme);
  drawPageFooter(ctx, x, y, w, h, theme);

  // note text
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = ink;
  ctx.font = FONT_NOTE;
  const maxW = w - 64;
  const lines = wrapText(ctx, note, maxW);
  const totalH = lines.length * (LINE_H + 2);
  let curY = y + h / 2 - totalH / 2 + 10;
  lines.forEach(line => {
    ctx.fillText(line, x + w / 2, curY);
    curY += LINE_H + 2;
  });
  ctx.restore();
}

/**
 * @param {object} spread
 * @param {number} spreadIndex
 * @param {number} totalSpreads
 * @param {object} [colors]  — optional color overrides from the dashboard
 */
function generateRulesCard(spread, spreadIndex, totalSpreads, colors = {}) {
  const theme = buildTheme(colors);

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // outer background
  const bgGrad = ctx.createRadialGradient(W/2, H/2, 80, W/2, H/2, W);
  bgGrad.addColorStop(0, theme.outerBg1);
  bgGrad.addColorStop(1, theme.outerBg2);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // book drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur  = 50;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#000';
  ctx.fillRect(BOOK_X, BOOK_Y, BOOK_W, BOOK_H);
  ctx.restore();

  const TITLE = 'مقهى الإنترنت | القوانين';
  const leftX  = BOOK_X;
  const rightX = BOOK_X + PAGE_W + SPINE_W;

  if (spread.rightNote) {
    drawPage     (ctx, leftX,  BOOK_Y, PAGE_W, BOOK_H, spread.left,  spread.leftStart, TITLE, false, theme);
    drawNotePage (ctx, rightX, BOOK_Y, PAGE_W, BOOK_H, spread.rightNote, theme);
  } else {
    drawPage(ctx, leftX,  BOOK_Y, PAGE_W, BOOK_H, spread.left,  spread.leftStart,  TITLE, false, theme);
    drawPage(ctx, rightX, BOOK_Y, PAGE_W, BOOK_H, spread.right, spread.rightStart, TITLE, true,  theme);
  }

  // spine
  const spineX    = BOOK_X + PAGE_W;
  const spineGrad = ctx.createLinearGradient(spineX, 0, spineX + SPINE_W, 0);
  spineGrad.addColorStop(0,   theme.spine1);
  spineGrad.addColorStop(0.3, theme.spine2);
  spineGrad.addColorStop(0.7, theme.spine2);
  spineGrad.addColorStop(1,   theme.spine1);
  ctx.fillStyle = spineGrad;
  ctx.fillRect(spineX, BOOK_Y, SPINE_W, BOOK_H);
  ctx.fillStyle = theme.gold;
  ctx.fillRect(spineX + 3,           BOOK_Y + 22, 1.5, BOOK_H - 44);
  ctx.fillRect(spineX + SPINE_W - 5, BOOK_Y + 22, 1.5, BOOK_H - 44);

  // page number
  ctx.save();
  ctx.fillStyle = 'rgba(184,144,42,0.65)';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${spreadIndex + 1} / ${totalSpreads}`, W / 2, H - 7);
  ctx.restore();

  return canvas.toBuffer('image/png');
}

module.exports = { generateRulesCard };
