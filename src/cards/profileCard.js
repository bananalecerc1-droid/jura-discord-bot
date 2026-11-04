const { createCanvas } = require('@napi-rs/canvas');
const { fetchImage } = require('../../imageUtils.js');

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Generates a profile card: the banner fills the whole card as a background,
// and the user's avatar sits as a plain circle in the bottom-left corner
// (no border/ring, no name).
async function generateProfileCard({ avatarUrl, bannerUrl, avatarSize, avatarX, avatarY }) {
  const W = 900, H = 300;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── clip whole card to rounded rect ──
  drawRoundedRect(ctx, 0, 0, W, H, 20);
  ctx.clip();

  // ── banner background (cover-fit) ──
  const banner = await fetchImage(bannerUrl);
  if (banner) {
    const scale = Math.max(W / banner.width, H / banner.height);
    const bw = banner.width * scale;
    const bh = banner.height * scale;
    const bx = (W - bw) / 2;
    const by = (H - bh) / 2;
    ctx.drawImage(banner, bx, by, bw, bh);
  } else {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#0d0d1e');
    grad.addColorStop(1, '#1a0a2e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // ── avatar (bottom-left by default), plain circle, no border/ring ──
  // avatarSize: diameter in px. avatarX/avatarY: distance in px from the
  // left/bottom edges of the card to the avatar's center-margin box.
  const AV = avatarSize || 130;
  const margin = 24;
  const avCX = (avatarX ?? margin) + AV / 2;
  const avCY = H - (avatarY ?? margin) - AV / 2;

  const avatar = await fetchImage(avatarUrl);

  if (avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(avCX, avCY, AV / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, avCX - AV / 2, avCY - AV / 2, AV, AV);
    ctx.restore();
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.arc(avCX, avCY, AV / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#1e1e3f';
    ctx.fill();
    ctx.restore();
  }

  return canvas.toBuffer('image/png');
}

module.exports = { generateProfileCard };
