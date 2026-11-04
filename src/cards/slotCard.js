const { createCanvas, loadImage } = require('@napi-rs/canvas');
require('../canvas/canvasFonts.js');

// ── Twemoji image URLs (jsdelivr CDN, v14.0.2) ──────────────────
const EMOJI_URLS = {
  '🍒': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f352.png',
  '🍋': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f34b.png',
  '🍊': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f34a.png',
  '🍇': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f347.png',
  '⭐': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2b50.png',
  '💎': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f48e.png',
};

// In-memory cache: emoji char → Image object (null = failed to load)
const _imgCache = new Map();

async function getEmojiImage(emoji) {
  if (_imgCache.has(emoji)) return _imgCache.get(emoji);
  const url = EMOJI_URLS[emoji];
  if (!url) { _imgCache.set(emoji, null); return null; }
  try {
    const img = await loadImage(url);
    _imgCache.set(emoji, img);
    return img;
  } catch {
    _imgCache.set(emoji, null);
    return null;
  }
}

// ── Symbol visual definitions (used for bg/glow colours + text fallback) ──
const SYM_DEFS = {
  '7️⃣': { label: '7',  bg: '#c0392b', accent: '#f1c40f', glow: '#e74c3c' },
  '💎':  { label: '◆', bg: '#0984e3', accent: '#a8e6ff', glow: '#74b9ff' },
  '⭐':  { label: '★', bg: '#f9ca24', accent: '#ffffff', glow: '#ffeaa7' },
  '🍇':  { label: '❋', bg: '#6c5ce7', accent: '#dfe6e9', glow: '#a29bfe' },
  '🍊':  { label: '●', bg: '#e17055', accent: '#ffeaa7', glow: '#fab1a0' },
  '🍋':  { label: '▲', bg: '#d4a017', accent: '#fffde7', glow: '#fdcb6e' },
  '🍒':  { label: '♥', bg: '#d63031', accent: '#ffcccc', glow: '#fd79a8' },
};

const ALL_SYMS = Object.keys(SYM_DEFS);

// Canvas dimensions
const W = 580, H = 420;
const REEL_COUNT   = 3;
const REEL_ROWS    = 3;
const CELL_W       = 140;
const CELL_H       = 82;
const REEL_GAP     = 8;
const MACHINE_PAD  = 18;
const MACHINE_X    = (W - (REEL_COUNT * CELL_W + (REEL_COUNT - 1) * REEL_GAP + MACHINE_PAD * 2)) / 2;
const MACHINE_Y    = 70;
const MACHINE_W    = REEL_COUNT * CELL_W + (REEL_COUNT - 1) * REEL_GAP + MACHINE_PAD * 2;
const MACHINE_H    = REEL_ROWS * CELL_H + MACHINE_PAD * 2;
const PAYLINE_ROW  = 1;

// ── Helpers ──────────────────────────────────────────────────────
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function cellXY(reelIdx, rowIdx) {
  const x = MACHINE_X + MACHINE_PAD + reelIdx * (CELL_W + REEL_GAP);
  const y = MACHINE_Y + MACHINE_PAD + rowIdx * CELL_H;
  return { x, y };
}

function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + Math.round(255 * amt));
  const g = Math.min(255, ((n >>  8) & 0xff) + Math.round(255 * amt));
  const b = Math.min(255, ((n      ) & 0xff) + Math.round(255 * amt));
  return `rgb(${r},${g},${b})`;
}

// ── Draw one symbol cell ──────────────────────────────────────────
// emojiImg may be null (for 7️⃣ or on load failure) — falls back to text label
function drawSymbolCell(ctx, x, y, sym, emojiImg) {
  const def = SYM_DEFS[sym] || SYM_DEFS['🍒'];
  const R = 12, pad = 6;

  // glow behind cell
  ctx.save();
  ctx.shadowColor = def.glow;
  ctx.shadowBlur  = 18;
  rr(ctx, x + pad, y + pad, CELL_W - pad * 2, CELL_H - pad * 2, R);
  ctx.fillStyle = def.bg;
  ctx.fill();
  ctx.restore();

  // cell background gradient
  const grad = ctx.createLinearGradient(x, y, x, y + CELL_H);
  grad.addColorStop(0, lighten(def.bg, 0.25));
  grad.addColorStop(1, def.bg);
  rr(ctx, x + pad, y + pad, CELL_W - pad * 2, CELL_H - pad * 2, R);
  ctx.fillStyle = grad;
  ctx.fill();

  // inner border
  rr(ctx, x + pad, y + pad, CELL_W - pad * 2, CELL_H - pad * 2, R);
  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // clip to cell so image doesn't overflow
  ctx.save();
  rr(ctx, x + pad, y + pad, CELL_W - pad * 2, CELL_H - pad * 2, R);
  ctx.clip();

  if (emojiImg) {
    // draw twemoji image centred in cell
    const imgSize = 52;
    const ix = x + CELL_W / 2 - imgSize / 2;
    const iy = y + CELL_H / 2 - imgSize / 2 + 2;
    ctx.drawImage(emojiImg, ix, iy, imgSize, imgSize);
  } else {
    // text fallback (e.g. for 7️⃣ lucky 7)
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `bold ${def.label === '7' ? 54 : 46}px DejaVuSans`;
    ctx.fillStyle    = def.accent;
    ctx.shadowColor  = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur   = 6;
    ctx.fillText(def.label, x + CELL_W / 2, y + CELL_H / 2 + 2);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

// ── Draw a spinning reel cell ─────────────────────────────────────
function drawSpinCell(ctx, x, y) {
  const sym = ALL_SYMS[Math.floor(Math.random() * ALL_SYMS.length)];
  const def = SYM_DEFS[sym] || SYM_DEFS['🍒'];
  const R = 12, pad = 6;

  // simple solid colour for spinning cells (no image needed)
  ctx.save();
  ctx.shadowColor = def.glow;
  ctx.shadowBlur  = 18;
  rr(ctx, x + pad, y + pad, CELL_W - pad * 2, CELL_H - pad * 2, R);
  ctx.fillStyle = def.bg;
  ctx.fill();
  ctx.restore();

  // motion-blur overlay
  ctx.save();
  rr(ctx, x + pad, y + pad, CELL_W - pad * 2, CELL_H - pad * 2, R);
  ctx.clip();
  const shimmer = ctx.createLinearGradient(x, y + pad, x, y + CELL_H - pad);
  shimmer.addColorStop(0,    'rgba(0,0,0,0.45)');
  shimmer.addColorStop(0.35, 'rgba(0,0,0,0)');
  shimmer.addColorStop(0.65, 'rgba(0,0,0,0)');
  shimmer.addColorStop(1,    'rgba(0,0,0,0.45)');
  ctx.fillStyle = shimmer;
  ctx.fillRect(x + pad, y + pad, CELL_W - pad * 2, CELL_H - pad * 2);
  ctx.restore();
}

// ── MAIN EXPORT ───────────────────────────────────────────────────
/**
 * @param {string[]} reels      - final symbols [reel0, reel1, reel2]
 * @param {boolean[]} stopped   - which reels have finished spinning
 * @param {object|null} outcome - null while spinning, { title, color } when done
 * @param {string} username
 * @returns {Promise<Buffer>}
 */
async function generateSlotCard({ reels, stopped, outcome, username }) {
  // Pre-load emoji images for any stopped reel symbols
  const uniqueSyms = [...new Set(reels)];
  await Promise.all(uniqueSyms.map(getEmojiImage));

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // ── background ──
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1a1a2e');
  bg.addColorStop(1, '#0f0c29');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // vignette
  const vignette = ctx.createRadialGradient(W/2, H/2, 60, W/2, H/2, Math.max(W, H));
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  // ── title ──
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = 'bold 38px DejaVuSans';
  ctx.fillStyle    = '#f9ca24';
  ctx.shadowColor  = '#f9ca24';
  ctx.shadowBlur   = 14;
  ctx.fillText('SLOTS', W / 2, 36);
  ctx.shadowBlur = 0;

  const lineGrad = ctx.createLinearGradient(60, 58, W - 60, 58);
  lineGrad.addColorStop(0, 'transparent');
  lineGrad.addColorStop(0.5, '#f9ca24');
  lineGrad.addColorStop(1, 'transparent');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, 58);
  ctx.lineTo(W - 60, 58);
  ctx.stroke();

  // ── machine body ──
  ctx.save();
  ctx.shadowColor = 'rgba(249,202,36,0.3)';
  ctx.shadowBlur  = 24;
  rr(ctx, MACHINE_X, MACHINE_Y, MACHINE_W, MACHINE_H, 18);
  ctx.fillStyle = '#16213e';
  ctx.fill();
  ctx.restore();

  rr(ctx, MACHINE_X, MACHINE_Y, MACHINE_W, MACHINE_H, 18);
  ctx.strokeStyle = '#f9ca2466';
  ctx.lineWidth   = 2;
  ctx.stroke();

  // ── payline highlight ──
  const py = MACHINE_Y + MACHINE_PAD + PAYLINE_ROW * CELL_H;
  rr(ctx, MACHINE_X + 4, py, MACHINE_W - 8, CELL_H, 8);
  ctx.fillStyle = 'rgba(249,202,36,0.07)';
  ctx.fill();

  ctx.fillStyle = '#f9ca24';
  ctx.fillRect(MACHINE_X + 4, py + 4, 6, CELL_H - 8);
  ctx.fillRect(MACHINE_X + MACHINE_W - 10, py + 4, 6, CELL_H - 8);

  // ── reels ──
  const STRIP = Object.keys(SYM_DEFS);
  for (let ri = 0; ri < REEL_COUNT; ri++) {
    for (let row = 0; row < REEL_ROWS; row++) {
      const { x, y } = cellXY(ri, row);

      if (!stopped[ri]) {
        drawSpinCell(ctx, x, y);
      } else {
        const mainIdx = STRIP.indexOf(reels[ri]);
        const L = STRIP.length;
        const sym = row === 0
          ? STRIP[(mainIdx - 1 + L) % L]
          : row === 1
            ? reels[ri]
            : STRIP[(mainIdx + 1) % L];
        const img = _imgCache.get(sym) || null;
        drawSymbolCell(ctx, x, y, sym, img);
      }
    }
  }

  // ── payline label ──
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  ctx.font         = 'bold 11px DejaVuSans';
  ctx.fillStyle    = '#f9ca2499';
  ctx.fillText('PAYLINE', MACHINE_X - 6, py + CELL_H / 2);

  // ── status bar ──
  const statusY = MACHINE_Y + MACHINE_H + 14;

  if (!outcome) {
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.font         = 'bold 16px "NotoSansArabic", DejaVuSans';
    ctx.fillStyle    = '#b2bec3';
    ctx.fillText('جاري الدوران...', W / 2, statusY);
  } else {
    ctx.save();
    ctx.shadowColor = outcome.color + '88';
    ctx.shadowBlur  = 20;
    rr(ctx, W / 2 - 180, statusY - 2, 360, 36, 10);
    ctx.fillStyle = outcome.color + '22';
    ctx.fill();
    ctx.restore();

    rr(ctx, W / 2 - 180, statusY - 2, 360, 36, 10);
    ctx.strokeStyle = outcome.color + 'aa';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = 'bold 18px "NotoSansArabic", DejaVuSans';
    ctx.fillStyle    = outcome.color;
    ctx.shadowColor  = outcome.color;
    ctx.shadowBlur   = 8;
    ctx.fillText(outcome.title, W / 2, statusY + 16);
    ctx.shadowBlur = 0;
  }

  // ── username watermark ──
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'bottom';
  ctx.font         = '11px "NotoSansArabic", DejaVuSans';
  ctx.fillStyle    = 'rgba(255,255,255,0.2)';
  ctx.fillText(username, W - 14, H - 8);

  return canvas.toBuffer('image/png');
}

module.exports = { generateSlotCard };
