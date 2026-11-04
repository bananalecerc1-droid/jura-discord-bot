const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const { fetchImage } = require('../../imageUtils.js');

const BG_DIR = path.join(__dirname, '../../backgrounds');
const WELCOME_BG = path.join(BG_DIR, 'welcome_bg.png');

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

async function generateWelcomeCard({ username, avatarUrl, memberCount, guildName, welcomeCfg = {} }) {
  const W = 900, H = 320;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const avatarPctX = welcomeCfg.avatarX ?? 50;
  const avatarPctY = welcomeCfg.avatarY ?? 50;
  const AV = welcomeCfg.avatarSize ?? 140;

  // ── clip card to rounded rect ──
  drawRoundedRect(ctx, 0, 0, W, H, 20);
  ctx.clip();

  // ── background ──
  let bgLoaded = false;
  if (fs.existsSync(WELCOME_BG)) {
    try {
      const bg = await loadImage(WELCOME_BG);
      ctx.drawImage(bg, 0, 0, W, H);
      bgLoaded = true;
    } catch {}
  }
  if (!bgLoaded) {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#0d0d20');
    grad.addColorStop(0.5, '#1a0a2e');
    grad.addColorStop(1, '#0a1628');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // ── decorative accent lines ──
  ctx.save();
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 5; i++) {
    const lineX = W * 0.12 * i;
    const lg = ctx.createLinearGradient(lineX, 0, lineX + 60, H);
    lg.addColorStop(0, 'transparent');
    lg.addColorStop(0.5, '#7c3aed');
    lg.addColorStop(1, 'transparent');
    ctx.fillStyle = lg;
    ctx.fillRect(lineX, 0, 1.5, H);
  }
  ctx.restore();

  // ── determine avatar x/y from percentage ──
  const avCX = Math.round((avatarPctX / 100) * W);
  const avCY = Math.round((avatarPctY / 100) * H);
  const avR = AV / 2;

  const showAvatar = welcomeCfg.showAvatar !== false;

  if (showAvatar) {
    // ── avatar glow ──
    ctx.save();
    ctx.shadowColor = '#7c3aed';
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(avCX, avCY, avR + 5, 0, Math.PI * 2);
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // ── outer ring ──
    const ringGrad = ctx.createLinearGradient(avCX - avR, avCY - avR, avCX + avR, avCY + avR);
    ringGrad.addColorStop(0, '#7c3aed');
    ringGrad.addColorStop(1, '#2563eb');
    ctx.save();
    ctx.beginPath();
    ctx.arc(avCX, avCY, avR + 4, 0, Math.PI * 2);
    ctx.strokeStyle = ringGrad;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.restore();

    // ── avatar image ──
    const avatar = await fetchImage(avatarUrl);
    if (avatar) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(avCX, avCY, avR, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(avatar, avCX - avR, avCY - avR, AV, AV);
      ctx.restore();
    }

    // ── member count badge ──
    const badge = `Member #${memberCount}`;
    ctx.font = 'bold 11px sans-serif';
    const badgeW = ctx.measureText(badge).width + 18;
    const badgeX = avCX - badgeW / 2;
    const badgeY = avCY + avR + 10;
    drawRoundedRect(ctx, badgeX, badgeY, badgeW, 22, 11);
    ctx.fillStyle = 'rgba(124,58,237,0.5)';
    ctx.fill();
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#c4b5fd';
    ctx.textAlign = 'center';
    ctx.fillText(badge, avCX, badgeY + 15);
    ctx.textAlign = 'left';
  }

  // ── outer border glow ──
  drawRoundedRect(ctx, 1, 1, W - 2, H - 2, 20);
  ctx.strokeStyle = 'rgba(124,58,237,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

module.exports = { generateWelcomeCard };
