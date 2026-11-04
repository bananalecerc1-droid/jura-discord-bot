const { createCanvas } = require('@napi-rs/canvas');
const { fetchImage, sanitizeName } = require('../../imageUtils.js');

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function scoreColor(pct) {
  if (pct >= 85) return { from: '#ff6b81', to: '#fd79a8' };
  if (pct >= 65) return { from: '#a29bfe', to: '#6c5ce7' };
  if (pct >= 40) return { from: '#f368e0', to: '#fd79a8' };
  return { from: '#636e72', to: '#2d3436' };
}

function shipName(a, b) {
  const half1 = a.slice(0, Math.ceil(a.length / 2));
  const half2 = b.slice(Math.floor(b.length / 2));
  return (half1 + half2).slice(0, 22);
}

async function generateShipCard({ user1, user2, score }) {
  const W = 860, H = 280;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const AV = 120;
  const colors = scoreColor(score);

  // ── clip card ──
  drawRoundedRect(ctx, 0, 0, W, H, 22);
  ctx.clip();

  // ── background ──
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0d0d20');
  bg.addColorStop(0.5, '#1a0a2e');
  bg.addColorStop(1, '#0a0a1e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // ── glow blobs behind each avatar ──
  function blob(cx, cy, color) {
    const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, 110);
    g.addColorStop(0, color + '44');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  blob(130, H / 2, colors.from);
  blob(W - 130, H / 2, colors.to);

  // ── draw one avatar ──
  async function drawAvatar(cx, cy, url) {
    const img = await fetchImage(url);
    const r = AV / 2;

    // ring glow
    ctx.save();
    ctx.shadowColor = colors.from;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = colors.from;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, cx - r, cy - r, AV, AV);
      ctx.restore();
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#2d2d4e';
      ctx.fill();
      ctx.restore();
    }
  }

  const av1X = 130, av2X = W - 130, avY = H / 2 - 18;
  await drawAvatar(av1X, avY, user1.avatarUrl);
  await drawAvatar(av2X, avY, user2.avatarUrl);

  // ── center score circle ──
  const midX = W / 2;
  const circR = 52;

  const circGrad = ctx.createRadialGradient(midX, avY, 0, midX, avY, circR);
  circGrad.addColorStop(0, colors.from);
  circGrad.addColorStop(1, colors.to);

  ctx.save();
  ctx.shadowColor = colors.from;
  ctx.shadowBlur = 28;
  ctx.beginPath();
  ctx.arc(midX, avY, circR, 0, Math.PI * 2);
  ctx.fillStyle = circGrad;
  ctx.fill();
  ctx.restore();

  // border on circle
  ctx.beginPath();
  ctx.arc(midX, avY, circR, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // score text
  ctx.textAlign = 'center';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${score}%`, midX, avY + 10);

  // connector lines
  const lineY = avY;
  ctx.save();
  ctx.globalAlpha = 0.22;
  const lineGrad = ctx.createLinearGradient(av1X + AV / 2 + 8, lineY, midX - circR, lineY);
  lineGrad.addColorStop(0, colors.from);
  lineGrad.addColorStop(1, 'transparent');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(av1X + AV / 2 + 8, lineY);
  ctx.lineTo(midX - circR - 2, lineY);
  ctx.stroke();

  const lineGrad2 = ctx.createLinearGradient(midX + circR + 2, lineY, av2X - AV / 2 - 8, lineY);
  lineGrad2.addColorStop(0, 'transparent');
  lineGrad2.addColorStop(1, colors.to);
  ctx.strokeStyle = lineGrad2;
  ctx.beginPath();
  ctx.moveTo(midX + circR + 2, lineY);
  ctx.lineTo(av2X - AV / 2 - 8, lineY);
  ctx.stroke();
  ctx.restore();

  // ── usernames ──
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(sanitizeName(user1.username).slice(0, 14), av1X, avY + AV / 2 + 22);
  ctx.fillText(sanitizeName(user2.username).slice(0, 14), av2X, avY + AV / 2 + 22);

  // ── ship name ──
  const sName = shipName(sanitizeName(user1.username), sanitizeName(user2.username));
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('Ship Name', midX, avY - circR - 18);
  ctx.font = 'bold 18px sans-serif';
  const snGrad = ctx.createLinearGradient(midX - 60, 0, midX + 60, 0);
  snGrad.addColorStop(0, colors.from);
  snGrad.addColorStop(1, colors.to);
  ctx.fillStyle = snGrad;
  ctx.fillText(sName, midX, avY - circR - 2);

  // ── bottom compatibility bar ──
  const barX = 60, barW = W - 120, barY = H - 44, barH = 14;

  drawRoundedRect(ctx, barX, barY, barW, barH, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fill();

  const fillW = Math.max(barH, (score / 100) * barW);
  const fillGrad = ctx.createLinearGradient(barX, barY, barX + barW, barY);
  fillGrad.addColorStop(0, colors.from);
  fillGrad.addColorStop(1, colors.to);
  drawRoundedRect(ctx, barX, barY, fillW, barH, 7);
  ctx.fillStyle = fillGrad;
  ctx.fill();

  // shimmer dot
  ctx.beginPath();
  ctx.arc(barX + fillW - 2, barY + barH / 2, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  // bar labels
  ctx.textAlign = 'left';
  ctx.font = '11px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText('Compatibility', barX, barY - 6);
  ctx.textAlign = 'right';
  ctx.fillText(`${score}%`, barX + barW, barY - 6);

  // ── outer border ──
  drawRoundedRect(ctx, 1, 1, W - 2, H - 2, 22);
  ctx.strokeStyle = `${colors.from}88`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

module.exports = { generateShipCard };
