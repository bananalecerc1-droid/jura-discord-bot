const { createCanvas } = require('@napi-rs/canvas');
require('../canvas/canvasFonts.js');
const SUIT_COLOR = { '♠': '#1a1a2e', '♣': '#1a1a2e', '♥': '#c0392b', '♦': '#c0392b' };

// Draw suits as vector shapes instead of relying on font glyph support.
function drawSuit(ctx, cx, cy, suit, size, color) {
  const s = size;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (suit === '♦') {
    ctx.moveTo(0, -s * 0.72);
    ctx.lineTo(s * 0.55, 0);
    ctx.lineTo(0, s * 0.72);
    ctx.lineTo(-s * 0.55, 0);
    ctx.closePath();
    ctx.fill();
  } else if (suit === '♥') {
    ctx.moveTo(0, s * 0.68);
    ctx.lineTo(-s * 0.62, -s * 0.05);
    ctx.bezierCurveTo(-s * 1.02, -s * 0.48, -s * 0.48, -s * 0.9, 0, -s * 0.42);
    ctx.bezierCurveTo(s * 0.48, -s * 0.9, s * 1.02, -s * 0.48, s * 0.62, -s * 0.05);
    ctx.closePath();
    ctx.fill();
  } else if (suit === '♣') {
    ctx.arc(0, -s * 0.36, s * 0.36, 0, Math.PI * 2);
    ctx.arc(-s * 0.38, s * 0.02, s * 0.36, 0, Math.PI * 2);
    ctx.arc(s * 0.38, s * 0.02, s * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-s * 0.1, s * 0.05, s * 0.2, s * 0.62);
  } else {
    // Spade: an inverted heart with a short stem.
    ctx.moveTo(0, -s * 0.68);
    ctx.bezierCurveTo(-s * 0.22, -s * 0.35, -s * 0.72, -s * 0.06, -s * 0.62, s * 0.22);
    ctx.bezierCurveTo(-s * 0.56, s * 0.45, -s * 0.25, s * 0.48, 0, s * 0.2);
    ctx.bezierCurveTo(s * 0.25, s * 0.48, s * 0.56, s * 0.45, s * 0.62, s * 0.22);
    ctx.bezierCurveTo(s * 0.72, -s * 0.06, s * 0.22, -s * 0.35, 0, -s * 0.68);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-s * 0.1, s * 0.12, s * 0.2, s * 0.58);
  }
  ctx.restore();
}

function drawResultMark(ctx, x, y, kind, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  if (kind === 'win') {
    ctx.moveTo(x - 7, y);
    ctx.lineTo(x - 2, y + 6);
    ctx.lineTo(x + 8, y - 7);
  } else if (kind === 'tie') {
    ctx.moveTo(x - 7, y);
    ctx.lineTo(x + 7, y);
  } else {
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x, y + 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y + 8, 1.4, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

function drawRR(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// ── draw one playing card ──
function drawCard(ctx, x, y, card, faceDown = false) {
  const W = 70, H = 100, R = 8;

  // shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 4;
  drawRR(ctx, x, y, W, H, R);
  ctx.fillStyle = faceDown ? '#1a237e' : '#f5f5f5';
  ctx.fill();
  ctx.restore();

  // border
  drawRR(ctx, x, y, W, H, R);
  ctx.strokeStyle = faceDown ? '#283593' : '#dcdcdc';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  if (faceDown) {
    // card back pattern — diagonal lines
    ctx.save();
    drawRR(ctx, x + 4, y + 4, W - 8, H - 8, 5);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 4;
    for (let i = -H; i < W + H; i += 12) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i - H, y + H);
      ctx.stroke();
    }
    ctx.restore();

    // center diamond
    drawSuit(ctx, x + W / 2, y + H / 2, '♦', 26, 'rgba(255,255,255,0.18)');
    return;
  }

  const color = SUIT_COLOR[card.s] || '#1a1a2e';

  // top-left rank + suit
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `bold 14px DejaVuSans`;
  ctx.fillStyle = color;
  ctx.fillText(card.r, x + 6, y + 5);
  drawSuit(ctx, x + 12, y + 25, card.s, 8, color);

  // bottom-right (rotated)
  ctx.save();
  ctx.translate(x + W - 6, y + H - 5);
  ctx.rotate(Math.PI);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `bold 14px DejaVuSans`;
  ctx.fillStyle = color;
  ctx.fillText(card.r, 0, 0);
  drawSuit(ctx, 5, 20, card.s, 8, color);
  ctx.restore();

  // center suit
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawSuit(ctx, x + W / 2, y + H / 2, card.s, 28, color);
}

// ── draw a stack of cards (deck indicator) ──
function drawDeck(ctx, x, y, count) {
  const W = 58, H = 80, R = 6;
  const layers = Math.min(6, Math.ceil(count / 8));
  for (let i = layers; i >= 0; i--) {
    const ox = i * 1.5, oy = -i * 1.5;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 4;
    drawRR(ctx, x + ox, y + oy, W, H, R);
    ctx.fillStyle = i === 0 ? '#1a237e' : '#283593';
    ctx.fill();
    ctx.restore();
    drawRR(ctx, x + ox, y + oy, W, H, R);
    ctx.strokeStyle = '#3949ab';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // count badge
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.arc(x + W / 2, y + H / 2, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = 'bold 13px DejaVuSans';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(count, x + W / 2, y + H / 2);
}

// ── draw hand value badge ──
function drawBadge(ctx, x, y, text, bust = false, bj = false) {
  const col = bust ? '#e74c3c' : bj ? '#f39c12' : 'rgba(0,0,0,0.5)';
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.roundRect(x, y, 56, 26, 6);
  ctx.fill();
  ctx.font = 'bold 14px DejaVuSans';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x + 28, y + 13);
}

// ── draw section label ──
function drawLabel(ctx, x, y, text, sub = '') {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 13px DejaVuSans';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(text.toUpperCase(), x, y);
  if (sub) {
    ctx.font = '11px DejaVuSans';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(sub, x, y + 17);
  }
}

// ─────────────────────────────────────────────────
//  MAIN EXPORT
// ─────────────────────────────────────────────────
function handValue(hand) {
  let val = hand.reduce((s, c) => {
    if (['J','Q','K'].includes(c.r)) return s + 10;
    if (c.r === 'A') return s + 11;
    return s + parseInt(c.r);
  }, 0);
  let aces = hand.filter(c => c.r === 'A').length;
  while (val > 21 && aces-- > 0) val -= 10;
  return val;
}

async function generateBlackjackCard({ playerHand, dealerHand, deckCount, showDealerFull = false, result = null }) {
  const W = 700, H = 400;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── felt background ──
  drawRR(ctx, 0, 0, W, H, 20);
  ctx.clip();

  const felt = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 420);
  felt.addColorStop(0, '#1b5e35');
  felt.addColorStop(1, '#0a3520');
  ctx.fillStyle = felt;
  ctx.fillRect(0, 0, W, H);

  // subtle oval table outline
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(W / 2, H / 2, W / 2 - 20, H / 2 - 18, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // ── divider line ──
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(40, H / 2);
  ctx.lineTo(W - 40, H / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── DECK (top-right) ──
  const deckX = W - 110, deckY = 30;
  drawDeck(ctx, deckX, deckY, deckCount);
  ctx.font = '11px DejaVuSans';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillText('DECK', deckX + 29, deckY + 86);

  // ── DEALER SECTION ──
  const dealerLabelX = 36, dealerLabelY = 28;
  drawLabel(ctx, dealerLabelX, dealerLabelY, 'Dealer', showDealerFull ? `Total: ${handValue(dealerHand)}` : '??');

  const dealerCardY = 58;
  dealerHand.forEach((card, i) => {
    const cx = 36 + i * 82;
    const hide = !showDealerFull && i === 1;
    drawCard(ctx, cx, dealerCardY, card, hide);
  });

  // dealer badge
  if (showDealerFull) {
    const dv = handValue(dealerHand);
    drawBadge(ctx, 36 + dealerHand.length * 82 + 8, dealerCardY + 37, `${dv}`, dv > 21, dv === 21);
  }

  // ── PLAYER SECTION ──
  const playerLabelY = H / 2 + 12;
  const playerVal = handValue(playerHand);
  drawLabel(ctx, dealerLabelX, playerLabelY, 'You', `Total: ${playerVal}`);

  const playerCardY = playerLabelY + 30;
  playerHand.forEach((card, i) => {
    drawCard(ctx, 36 + i * 82, playerCardY, card, false);
  });

  // player badge
  const bust = playerVal > 21;
  const bj = playerVal === 21 && playerHand.length === 2;
  drawBadge(ctx, 36 + playerHand.length * 82 + 8, playerCardY + 37, bust ? 'BUST' : bj ? 'BJ!' : `${playerVal}`, bust, bj);

  // ── RESULT OVERLAY ──
  if (result) {
    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    drawRR(ctx, W / 2 - 150, H / 2 - 28, 300, 56, 14);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 22px DejaVuSans';
    ctx.fillStyle = result.includes('win') || result.includes('Blackjack') ? '#2ecc71'
      : result.includes('Tie') ? '#f39c12' : '#e74c3c';
    const kind = result.includes('win') || result.includes('Blackjack') ? 'win'
      : result.includes('Tie') ? 'tie' : 'lose';
    const resultText = result.replace(/^(🏆|🤝|😔)\s*/, '').trim();
    drawResultMark(ctx, W / 2 - 112, H / 2, kind, ctx.fillStyle);
    ctx.fillText(resultText, W / 2 + 22, H / 2);
  }

  return canvas.toBuffer('image/png');
}

module.exports = { generateBlackjackCard };
