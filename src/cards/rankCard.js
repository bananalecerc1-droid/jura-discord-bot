const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const { fetchImage, sanitizeName } = require('../../imageUtils.js');
const db = require('../../db.js');

const BG_DIR = path.join(__dirname, '../../backgrounds');

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

async function generateRankCard({ userId, username, discriminator, avatarUrl, level, currentXp, xpNeeded, totalXp, rank, voiceLevel = 0 }) {
  // نتأكد إن كل أرقام الـ XP معرّفة وأرقام فعلية (Number()) عشان ما تنهار الكرت لو وصلت undefined أو BigInt من قاعدة البيانات
  level     = Number(level) || 0;
  currentXp = Number(currentXp) || 0;
  xpNeeded  = Number(xpNeeded) || 100;
  totalXp   = Number(totalXp) || 0;
  rank      = Number(rank) || 0;

  const W = 800, H = 260;
  const SPLIT = 240;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── clip whole card to rounded rect ──
  drawRoundedRect(ctx, 0, 0, W, H, 22);
  ctx.clip();

  // ── background ──
  let bgLoaded = false;

  // Try user's custom background from Turso first, then fall back to local file (legacy)
  try {
    const userBgBuf = await db.getUserBackground(userId);
    if (userBgBuf) {
      const bg = await loadImage(userBgBuf);
      ctx.drawImage(bg, 0, 0, W, H);
      ctx.fillStyle = 'rgba(8, 8, 20, 0.62)';
      ctx.fillRect(0, 0, W, H);
      bgLoaded = true;
    }
  } catch {}

  // Legacy local file fallback (for backgrounds set before migration)
  if (!bgLoaded) {
    const bgFile = path.join(BG_DIR, `${userId}.png`);
    if (fs.existsSync(bgFile)) {
      try {
        const bg = await loadImage(bgFile);
        ctx.drawImage(bg, 0, 0, W, H);
        ctx.fillStyle = 'rgba(8, 8, 20, 0.62)';
        ctx.fillRect(0, 0, W, H);
        bgLoaded = true;
      } catch {}
    }
  }

  if (!bgLoaded) {
    const defaultBg = path.join(BG_DIR, 'rank_default.png');
    if (fs.existsSync(defaultBg)) {
      try {
        const bg = await loadImage(defaultBg);
        ctx.drawImage(bg, 0, 0, W, H);
        ctx.fillStyle = 'rgba(8, 8, 20, 0.62)';
        ctx.fillRect(0, 0, W, H);
        bgLoaded = true;
      } catch {}
    }
    if (!bgLoaded) {
      const bgGrad = ctx.createLinearGradient(0, 0, W, H);
      bgGrad.addColorStop(0, '#0d0d1e');
      bgGrad.addColorStop(1, '#131328');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ── left panel tint ──
  const leftGrad = ctx.createLinearGradient(0, 0, SPLIT, 0);
  leftGrad.addColorStop(0, 'rgba(124,58,237,0.18)');
  leftGrad.addColorStop(1, 'rgba(124,58,237,0)');
  ctx.fillStyle = leftGrad;
  ctx.fillRect(0, 0, SPLIT, H);

  // ── avatar ──
  const AV = 140;
  const avX = (SPLIT - AV) / 2;
  const avY = (H - AV) / 2;
  const cx = avX + AV / 2, cy = avY + AV / 2;

  const avatar = await fetchImage(avatarUrl);
  if (avatar) {
    // glow ring
    ctx.save();
    ctx.shadowColor = '#7c3aed';
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(cx, cy, AV / 2 + 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, AV / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, avX, avY, AV, AV);
    ctx.restore();
  }

  // ── divider ──
  const divGrad = ctx.createLinearGradient(SPLIT, 0, SPLIT, H);
  divGrad.addColorStop(0, 'rgba(124,58,237,0)');
  divGrad.addColorStop(0.5, 'rgba(124,58,237,0.7)');
  divGrad.addColorStop(1, 'rgba(124,58,237,0)');
  ctx.fillStyle = divGrad;
  ctx.fillRect(SPLIT, 0, 1.5, H);

  // ── RIGHT SIDE ──
  const RX = SPLIT + 30;
  const RW = W - RX - 30;

  // username
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px sans-serif';
  const maxNameW = RW - 100;
  let uname = sanitizeName(username);
  while (ctx.measureText(uname).width > maxNameW && uname.length > 4) uname = uname.slice(0, -1);
  if (uname !== sanitizeName(username)) uname += '…';
  ctx.fillText(uname, RX, 58);

  if (discriminator && discriminator !== '0') {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '18px sans-serif';
    ctx.fillText(`#${discriminator}`, RX + ctx.measureText(uname).width + 5, 58);
  }

  // rank badge
  const rankText = `# ${rank}`;
  ctx.font = 'bold 14px sans-serif';
  const rankW = ctx.measureText(rankText).width + 20;
  drawRoundedRect(ctx, W - 30 - rankW, 30, rankW, 28, 14);
  ctx.fillStyle = 'rgba(124,58,237,0.35)';
  ctx.fill();
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#c4b5fd';
  ctx.textAlign = 'center';
  ctx.fillText(rankText, W - 30 - rankW / 2, 49);
  ctx.textAlign = 'left';

  // level — big number
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('LEVEL', RX, 103);

  ctx.font = 'bold 52px sans-serif';
  const lvlGrad = ctx.createLinearGradient(RX, 90, RX + 120, 150);
  lvlGrad.addColorStop(0, '#a78bfa');
  lvlGrad.addColorStop(1, '#60a5fa');
  ctx.fillStyle = lvlGrad;
  ctx.fillText(`${level}`, RX + 58, 155);

  // XP bar
  const barX = RX + 130;
  const barW = W - barX - 30;
  const barY = 108;
  const barH = 18;
  const progress = Math.min(1, currentXp / xpNeeded);

  drawRoundedRect(ctx, barX, barY, barW, barH, 9);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();

  if (progress > 0) {
    const fill = Math.max(barH, progress * barW);
    const fg = ctx.createLinearGradient(barX, barY, barX + barW, barY);
    fg.addColorStop(0, '#7c3aed');
    fg.addColorStop(1, '#2563eb');
    drawRoundedRect(ctx, barX, barY, fill, barH, 9);
    ctx.fillStyle = fg;
    ctx.fill();

    // shimmer dot
    ctx.beginPath();
    ctx.arc(barX + fill - 2, barY + barH / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  // XP numbers
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(`${currentXp.toLocaleString()} / ${xpNeeded.toLocaleString()} XP`, barX, barY + barH + 18);

  // total XP
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '12px sans-serif';
  ctx.fillText(`Total: ${totalXp.toLocaleString()} XP`, W - 30, barY + barH + 18);
  ctx.textAlign = 'left';

  // thin separator
  ctx.beginPath();
  ctx.moveTo(barX, barY + barH + 30);
  ctx.lineTo(W - 30, barY + barH + 30);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // bottom stats
  const stats = [
    { label: 'RANK',     value: `#${rank}` },
    { label: 'TEXT LVL', value: `${level}` },
    { label: 'TOTAL XP', value: totalXp.toLocaleString() },
  ];
    const statY = barY + barH + 55;
  // Start stats at the right panel edge, not at the XP bar. This removes
  // the empty area below LEVEL and keeps the final TOTAL XP value visible.
  const statSpacing = RW / stats.length;
  stats.forEach((s, i) => {
    const sx = RX + i * statSpacing;
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(s.label, sx, statY);
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(s.value, sx, statY + 20);
  });

  // outer border glow
  drawRoundedRect(ctx, 1, 1, W - 2, H - 2, 22);
  ctx.strokeStyle = 'rgba(124,58,237,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

module.exports = { generateRankCard };
