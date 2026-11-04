'use strict';
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
require('../canvas/canvasFonts.js');
const { getEmojiImage, drawEmojiImage } = require('../canvas/canvasEmoji.js');
const path = require('path');
const fs = require('fs');

// Register Arabic Font
const fontPath = path.join(__dirname, '../../fonts', 'NotoSansArabic.ttf');
if (fs.existsSync(fontPath)) {
  GlobalFonts.registerFromPath(fontPath, 'NotoSansArabic');
}

function hex2rgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Wrap text for RTL (Arabic). Returns lines array.
 */
function wrapArabic(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Generate a canvas image for an Arabic wisdom quote.
 * @param {object} opts
 * @param {string} opts.quote   - Arabic quote text
 * @param {string} opts.author  - Author name (Arabic)
 * @param {string} [opts.category] - quote category key for colour theming
 * @param {string} [opts.serverName] - optional server name shown in footer
 * @returns {Buffer} PNG buffer
 */
async function generateQuoteCard({ quote, author, category = 'wisdom', serverName = '' }) {
  const W = 900, H = 420;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── background image ──────────────────────────────────────
  let hasCustomBg = false;
  const bgPath = path.join(__dirname, '../../backgrounds', 'quote_bg.png');
  if (fs.existsSync(bgPath)) {
    try {
      const bgImg = await loadImage(bgPath);
      ctx.drawImage(bgImg, 0, 0, W, H);
      hasCustomBg = true;
      
      // Add dark overlay for readability
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, 0, W, H);
    } catch (e) {
      console.error('Error loading quote background:', e);
    }
  }

  // ── colour themes ─────────────────────────────────────────
  const THEMES = {
    wisdom:      { from: '#f9ca24', to: '#e67e22' },
    motivation:  { from: '#a29bfe', to: '#6c5ce7' },
    life:        { from: '#55efc4', to: '#00b894' },
    love:        { from: '#fd79a8', to: '#e84393' },
    religion:    { from: '#00cec9', to: '#0984e3' },
    success:     { from: '#fdcb6e', to: '#e17055' },
    nature:      { from: '#81ecec', to: '#27ae60' },
    default:     { from: '#74b9ff', to: '#0984e3' },
  };
  const theme = THEMES[category] || THEMES.default;
  const c1 = hex2rgb(theme.from);

  // ── clip rounded card ─────────────────────────────────────
  drawRoundRect(ctx, 0, 0, W, H, 24);
  ctx.clip();

  // ── dark background ───────────────────────────────────────
  if (!hasCustomBg) {
    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, W, H);
  }

  // ── radial glow top-right ─────────────────────────────────
  const glow = ctx.createRadialGradient(W, 0, 20, W, 0, 480);
  glow.addColorStop(0, `rgba(${c1.r},${c1.g},${c1.b},0.22)`);
  glow.addColorStop(1, `rgba(${c1.r},${c1.g},${c1.b},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ── left accent gradient stripe ───────────────────────────
  const stripe = ctx.createLinearGradient(0, 0, 0, H);
  stripe.addColorStop(0, theme.from);
  stripe.addColorStop(1, theme.to);
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 0, 7, H);

  // ── top bar line ──────────────────────────────────────────
  const bar = ctx.createLinearGradient(0, 0, W, 0);
  bar.addColorStop(0, theme.from);
  bar.addColorStop(0.7, theme.to);
  bar.addColorStop(1, 'transparent');
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, W, 3);

  // ── decorative large quote marks ──────────────────────────
  ctx.save();
  ctx.font = 'bold 160px serif';
  ctx.fillStyle = `rgba(${c1.r},${c1.g},${c1.b},0.07)`;
  ctx.textAlign = 'right';
  ctx.direction = 'rtl';
  ctx.fillText('"', W - 30, 170);
  ctx.fillText('"', 90, H - 40);
  ctx.restore();

  // ── category badge ────────────────────────────────────────
  const LABELS = {
    wisdom: 'حكمة', motivation: 'تحفيز', life: 'حياة',
    love: 'محبة', religion: 'روحانية', success: 'نجاح',
    nature: 'طبيعة', default: 'اقتباس',
  };
  const ICONS = {
    wisdom: '💡', motivation: '🔥', life: '🌿', love: '💖',
    religion: '🕌', success: '🏆', nature: '🌱', default: '✨',
  };
  const badge = LABELS[category] || LABELS.default;
  const badgeIcon = await getEmojiImage(ICONS[category] || ICONS.default);
  ctx.save();
  ctx.font = 'bold 15px "NotoSansArabic", DejaVuSans';
  const bw = ctx.measureText(badge).width + 54;
  const bx = W - bw - 24, by = 22;
  drawRoundRect(ctx, bx, by, bw, 32, 16);
  ctx.fillStyle = `rgba(${c1.r},${c1.g},${c1.b},0.18)`;
  ctx.fill();
  ctx.strokeStyle = `rgba(${c1.r},${c1.g},${c1.b},0.5)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = theme.from;
  ctx.textAlign = 'center';
  if (!drawEmojiImage(ctx, badgeIcon, bx + 18, by + 16, 20)) ctx.fillText('•', bx + 18, by + 20);
  ctx.fillText(badge, bx + bw / 2 + 10, by + 20);
  ctx.restore();

  // ── main quote text ───────────────────────────────────────
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  const qFont = quote.length > 80 ? 26 : quote.length > 50 ? 30 : 34;
  ctx.font = `bold ${qFont}px "NotoSansArabic", DejaVuSans`;
  ctx.fillStyle = '#f0f0f0';

  const lines = wrapArabic(ctx, quote, W - 120);
  const lineH = qFont * 1.65;
  const totalH = lines.length * lineH;
  const startY = (H - totalH) / 2 - 16;

  lines.forEach((line, i) => {
    ctx.fillText(line, W / 2, startY + i * lineH);
  });
  ctx.restore();

  // ── decorative divider line ───────────────────────────────
  const divY = H - 88;
  const divGrad = ctx.createLinearGradient(W * 0.2, 0, W * 0.8, 0);
  divGrad.addColorStop(0, 'transparent');
  divGrad.addColorStop(0.5, `rgba(${c1.r},${c1.g},${c1.b},0.5)`);
  divGrad.addColorStop(1, 'transparent');
  ctx.strokeStyle = divGrad;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.2, divY);
  ctx.lineTo(W * 0.8, divY);
  ctx.stroke();

  // ── author name ───────────────────────────────────────────
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.font = `500 20px "NotoSansArabic", DejaVuSans`;
  ctx.fillStyle = theme.from;
  ctx.fillText(`— ${author} —`, W / 2, H - 58);
  ctx.restore();

  // ── footer server name ────────────────────────────────────
  if (serverName) {
    ctx.save();
    ctx.font = '13px Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.textAlign = 'left';
    ctx.fillText(serverName, 22, H - 18);
    ctx.restore();
  }

  // ── right sparkle dots ────────────────────────────────────
  [[820, 60], [860, 110], [840, 160]].forEach(([dx, dy], i) => {
    ctx.beginPath();
    ctx.arc(dx, dy, 2 + i, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${c1.r},${c1.g},${c1.b},${0.2 + i * 0.1})`;
    ctx.fill();
  });

  return canvas.toBuffer('image/png');
}

module.exports = { generateQuoteCard };
