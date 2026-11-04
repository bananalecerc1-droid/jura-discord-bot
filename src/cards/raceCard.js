const { createCanvas } = require('@napi-rs/canvas');
require('../canvas/canvasFonts.js');
const { getEmojiImage, drawEmojiImage } = require('../canvas/canvasEmoji.js');

// ── Canvas dimensions ────────────────────────────────────────────
const W = 640, H = 320;
const TRACK_X  = 140;          // left edge of track
const TRACK_W  = 450;          // track pixel width
const LANE_Y   = [105, 210];   // center Y of each lane
const LANE_H   = 64;           // lane height

// ── Helpers ──────────────────────────────────────────────────────
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + Math.round(255 * amt));
  const g = Math.min(255, ((n >>  8) & 0xff) + Math.round(255 * amt));
  const b = Math.min(255, ((n      ) & 0xff) + Math.round(255 * amt));
  return `rgb(${r},${g},${b})`;
}

// ── Top-down car shape ────────────────────────────────────────────
function drawCar(ctx, cx, cy, color, accent) {
  const BW = 54, BH = 26;

  // Shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  rr(ctx, cx - BW / 2, cy - BH / 2, BW, BH, 7);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  // Body gradient
  const bodyGrad = ctx.createLinearGradient(cx - BW / 2, cy - BH / 2, cx - BW / 2, cy + BH / 2);
  bodyGrad.addColorStop(0, lighten(color, 0.28));
  bodyGrad.addColorStop(1, color);
  rr(ctx, cx - BW / 2, cy - BH / 2, BW, BH, 7);
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  // Body border
  rr(ctx, cx - BW / 2, cy - BH / 2, BW, BH, 7);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Front windshield
  rr(ctx, cx + 6, cy - BH / 2 + 4, 14, BH - 8, 4);
  ctx.fillStyle = 'rgba(180,230,255,0.65)';
  ctx.fill();

  // Rear window
  rr(ctx, cx - BW / 2 + 4, cy - BH / 2 + 5, 10, BH - 10, 3);
  ctx.fillStyle = 'rgba(180,230,255,0.40)';
  ctx.fill();

  // Accent stripe
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.rect(cx - BW / 2 + 18, cy - BH / 2 + 2, BW - 36, 3);
  ctx.fill();

  // 4 wheels
  const wheels = [
    [cx - BW / 2 + 9,  cy - BH / 2 - 4],
    [cx + BW / 2 - 9,  cy - BH / 2 - 4],
    [cx - BW / 2 + 9,  cy + BH / 2 + 4],
    [cx + BW / 2 - 9,  cy + BH / 2 + 4],
  ];
  for (const [wx, wy] of wheels) {
    ctx.beginPath(); ctx.arc(wx, wy, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = '#111'; ctx.fill();
    ctx.beginPath(); ctx.arc(wx, wy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#777'; ctx.fill();
  }
}

// ── Checkered finish tile strip ──────────────────────────────────
function drawFinishStrip(ctx, x, y, h) {
  const TW = 10;
  for (let fy = y; fy < y + h; fy += TW) {
    for (let col = 0; col < 2; col++) {
      const even = (Math.floor((fy - y) / TW) + col) % 2 === 0;
      ctx.fillStyle = even ? 'rgba(255,255,255,0.75)' : 'rgba(20,20,30,0.75)';
      ctx.fillRect(x + col * TW, fy, TW, Math.min(TW, y + h - fy));
    }
  }
}

// ── Speed blur lines on track ─────────────────────────────────────
function drawSpeedLines(ctx, lx, ly, lw, lh, color) {
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const lineY = ly + 10 + i * ((lh - 20) / 5);
    ctx.beginPath();
    ctx.moveTo(lx + 10, lineY);
    ctx.lineTo(lx + lw - 30, lineY);
    ctx.stroke();
  }
  ctx.restore();
}

// ═══════════════════════════════════════════════════════
//  MAIN EXPORT
// ═══════════════════════════════════════════════════════
/**
 * @param {object} opts
 *   p1Name, p2Name   — display names
 *   pos1, pos2       — current positions (0 → raceLen)
 *   raceLen          — total track length
 *   status           — 'waiting' | 'countdown' | 'racing' | 'p1wins' | 'p2wins' | 'tie'
 *   round            — current round number (used when status === 'racing')
 */
async function generateRaceCard({ p1Name, p2Name, pos1, pos2, raceLen, status = 'racing', round = 1 }) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // ── Background ──
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0f0c29');
  bg.addColorStop(0.5, '#1a1a3e');
  bg.addColorStop(1, '#0d0b24');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Vignette
  const vig = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, Math.max(W, H) * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // ── Title ──
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = 'bold 30px sans-serif';
  ctx.fillStyle    = '#fdcb6e';
  ctx.shadowColor  = '#fdcb6e';
  ctx.shadowBlur   = 18;
  ctx.fillText('RACE', W / 2, 32);
  ctx.shadowBlur = 0;

  // Title underline
  const lineG = ctx.createLinearGradient(80, 52, W - 80, 52);
  lineG.addColorStop(0, 'transparent');
  lineG.addColorStop(0.5, '#fdcb6e66');
  lineG.addColorStop(1, 'transparent');
  ctx.strokeStyle = lineG;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(80, 52); ctx.lineTo(W - 80, 52); ctx.stroke();

  // ── Players ──
  const players = [
    { name: p1Name, pos: pos1, color: '#e74c3c', accent: '#ff9f9f', laneY: LANE_Y[0] },
    { name: p2Name, pos: pos2, color: '#0984e3', accent: '#a8e6ff', laneY: LANE_Y[1] },
  ];

  for (const p of players) {
    const lx = TRACK_X;
    const ly = p.laneY - LANE_H / 2;
    const lw = TRACK_W;
    const lh = LANE_H;

    // Lane asphalt
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur  = 8;
    rr(ctx, lx, ly, lw, lh, 10);
    ctx.fillStyle = '#1c2130';
    ctx.fill();
    ctx.restore();

    // Lane border
    rr(ctx, lx, ly, lw, lh, 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Progress glow fill
    const progress = Math.min(p.pos / raceLen, 1);
    if (progress > 0) {
      const pw = progress * lw;
      ctx.save();
      rr(ctx, lx, ly, lw, lh, 10);
      ctx.clip();
      const progG = ctx.createLinearGradient(lx, 0, lx + pw, 0);
      progG.addColorStop(0, p.color + '18');
      progG.addColorStop(1, p.color + '40');
      rr(ctx, lx, ly, pw, lh, 0);
      ctx.fillStyle = progG;
      ctx.fill();
      ctx.restore();
    }

    // Speed lines on track
    drawSpeedLines(ctx, lx, ly, lw, lh, p.color);

    // Dashed centre line
    ctx.save();
    ctx.setLineDash([16, 12]);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx + 12, p.laneY);
    ctx.lineTo(lx + lw - 22, p.laneY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Finish strip
    drawFinishStrip(ctx, lx + lw - 20, ly + 1, lh - 2);

    // Player name (left label)
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.font         = 'bold 14px "NotoSansArabic", DejaVuSans';
    ctx.fillStyle    = p.color;
    ctx.shadowColor  = p.color;
    ctx.shadowBlur   = 8;
    ctx.fillText(p.name.slice(0, 13), lx - 10, p.laneY);
    ctx.shadowBlur = 0;

    // Car position
    const carProgress = Math.min(p.pos / raceLen, 1);
    const carCX = lx + 34 + carProgress * (lw - 78);
    drawCar(ctx, carCX, p.laneY, p.color, p.accent);

    // Trophy if finished
    if (p.pos >= raceLen) {
      const trophyImage = await getEmojiImage('🏆');
      if (!drawEmojiImage(ctx, trophyImage, lx + lw - 10, p.laneY - 32, 28)) {
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.font         = 'bold 16px DejaVuSans';
        ctx.fillText('1st', lx + lw - 10, p.laneY - 32);
      }
    }
  }

  // ── Status bar ──
  let statusText = '', statusColor = '#b2bec3';
  if      (status === 'waiting')  { statusText = 'في انتظار القبول...';                 statusColor = '#b2bec3'; }
  else if (status === 'countdown'){ statusText = '3... 2... 1... انطلق!';                statusColor = '#fdcb6e'; }
  else if (status === 'racing')   { statusText = `الجولة ${round}  •  السباق جارٍ`;       statusColor = '#74b9ff'; }
  else if (status === 'p1wins')   { statusText = `${p1Name} فاز بالسباق!`;                 statusColor = '#e74c3c'; }
  else if (status === 'p2wins')   { statusText = `${p2Name} فاز بالسباق!`;                 statusColor = '#0984e3'; }
  else if (status === 'tie')      { statusText = 'تعادل! وصلا في نفس اللحظة!';             statusColor = '#fdcb6e'; }

  if (statusText) {
    const sy = H - 36;
    rr(ctx, W / 2 - 210, sy, 420, 28, 8);
    ctx.fillStyle = statusColor + '18';
    ctx.fill();
    rr(ctx, W / 2 - 210, sy, 420, 28, 8);
    ctx.strokeStyle = statusColor + '55';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = 'bold 14px "NotoSansArabic", DejaVuSans';
    ctx.fillStyle    = statusColor;
    ctx.shadowColor  = statusColor;
    ctx.shadowBlur   = 8;
    ctx.fillText(statusText, W / 2, sy + 14);
    ctx.shadowBlur = 0;
  }

  return canvas.toBuffer('image/png');
}

module.exports = { generateRaceCard };
