'use strict';
const { createCanvas } = require('@napi-rs/canvas');
require('../canvas/canvasFonts.js');
const { getEmojiImage, drawEmojiImage } = require('../canvas/canvasEmoji.js');

// Color themes per mechanic
const THEMES = {
  lottery:       { from: '#f9ca24', to: '#e67e22', icon: '🎲' },
  first_click:   { from: '#fd79a8', to: '#c0392b', icon: '⚡' },
  react_race:    { from: '#a29bfe', to: '#6c5ce7', icon: '🎯' },
  // MCQ categories
  general:       { from: '#6c5ce7', to: '#341f97', icon: '❓' },
  true_false:    { from: '#00b894', to: '#006266', icon: '✅' },
  capitals:      { from: '#0984e3', to: '#2980b9', icon: '🌍' },
  animal_sounds: { from: '#e17055', to: '#a93226', icon: '🦁' },
  flags:         { from: '#00cec9', to: '#1abc9c', icon: '🏳️' },
  sports:        { from: '#27ae60', to: '#145a32', icon: '⚽' },
  food:          { from: '#e74c3c', to: '#7b241c', icon: '🍔' },
  tech:          { from: '#2980b9', to: '#1a5276', icon: '💻' },
  islamic:       { from: '#1abc9c', to: '#0e6655', icon: '🕌' },
  history:       { from: '#e67e22', to: '#784212', icon: '📜' },
  science:       { from: '#9b59b6', to: '#4a235a', icon: '🔬' },
  movies:        { from: '#e74c3c', to: '#922b21', icon: '🎬' },
  proverbs:      { from: '#f39c12', to: '#7d6608', icon: '📖' },
  emoji_guess:   { from: '#fd79a8', to: '#e91e8c', icon: '😊' },
  odd_out:       { from: '#636e72', to: '#2d3436', icon: '🔍' },
  math_mcq:      { from: '#00cec9', to: '#006266', icon: '🔢' },
  arabic_lang:   { from: '#d35400', to: '#7e5109', icon: '📝' },
  geography:     { from: '#27ae60', to: '#0b5345', icon: '🗺️' },
  famous_quotes: { from: '#8e44ad', to: '#4a235a', icon: '💬' },
  poetry:        { from: '#c0392b', to: '#7b241c', icon: '📜' },
  animals_facts: { from: '#16a085', to: '#0e6655', icon: '🐾' },
  inventions:    { from: '#2471a3', to: '#154360', icon: '💡' },
  planets:       { from: '#1a1a2e', to: '#16213e', icon: '🪐' },
  human_body:    { from: '#e74c3c', to: '#922b21', icon: '🧠' },
  world_records: { from: '#f39c12', to: '#784212', icon: '🏆' },
  colors:        { from: '#9b59b6', to: '#6c3483', icon: '🎨' },
  cars:          { from: '#2c3e50', to: '#1a252f', icon: '🚗' },
  // TYPE categories
  race_word:     { from: '#e17055', to: '#a93226', icon: '⚡' },
  race_sentence: { from: '#e74c3c', to: '#7b241c', icon: '✍️' },
  math_calc:     { from: '#00cec9', to: '#006266', icon: '🧮' },
  reverse_word:  { from: '#6c5ce7', to: '#341f97', icon: '🔄' },
  anagram:       { from: '#fd79a8', to: '#c0392b', icon: '🔀' },
  riddle:        { from: '#f9ca24', to: '#f39c12', icon: '🤔' },
  fill_blank:    { from: '#27ae60', to: '#145a32', icon: '📝' },
  count_emoji:   { from: '#e91e8c', to: '#880e4f', icon: '🔢' },
  missing_num:   { from: '#0984e3', to: '#154360', icon: '❓' },
  who_am_i:      { from: '#8e44ad', to: '#4a235a', icon: '👤' },
  fastest_math:  { from: '#e74c3c', to: '#7b241c', icon: '💨' },
  word_chain:    { from: '#00b894', to: '#006266', icon: '🔗' },
  default:       { from: '#636e72', to: '#2d3436', icon: '🎮' },
};

function hex2rgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return { r, g, b };
}

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Generate a canvas banner for a daily event.
 * @param {object} opts
 * @param {string} opts.type      - game type key (see THEMES)
 * @param {string} opts.title     - short Arabic title
 * @param {string} opts.question  - question / description text
 * @param {number} opts.reward    - XP reward
 * @param {number} opts.duration  - seconds
 * @returns {Buffer} PNG buffer
 */
async function generateEventCard({ type, title, question, reward, duration }) {
  const W = 900, H = 300;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const theme = THEMES[type] ?? THEMES.default;
  const c1 = hex2rgb(theme.from);

  // ── clip card ────────────────────────────────────────────
  drawRoundRect(ctx, 0, 0, W, H, 22);
  ctx.clip();

  // ── dark background ──────────────────────────────────────
  ctx.fillStyle = '#0a0a18';
  ctx.fillRect(0, 0, W, H);

  // ── gradient overlay left→center ────────────────────────
  const grad = ctx.createLinearGradient(0, 0, W * 0.65, 0);
  grad.addColorStop(0, `rgba(${c1.r},${c1.g},${c1.b},0.28)`);
  grad.addColorStop(1, `rgba(${c1.r},${c1.g},${c1.b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // ── top accent bar ───────────────────────────────────────
  const barGrad = ctx.createLinearGradient(0, 0, W, 0);
  barGrad.addColorStop(0, theme.from);
  barGrad.addColorStop(1, theme.to);
  ctx.fillStyle = barGrad;
  ctx.fillRect(0, 0, W, 5);

  // ── decorative right circle ──────────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.arc(W + 40, H / 2, 180, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${c1.r},${c1.g},${c1.b},0.07)`;
  ctx.fill();
  ctx.restore();

  // ── left icon circle ─────────────────────────────────────
  const ICX = 140, ICY = H / 2, ICRAD = 78;
  ctx.save();
  ctx.shadowColor = theme.from;
  ctx.shadowBlur = 28;
  ctx.beginPath();
  ctx.arc(ICX, ICY, ICRAD, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${c1.r},${c1.g},${c1.b},0.18)`;
  ctx.fill();
  ctx.strokeStyle = theme.from;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  // icon emoji — draw as a colored image so it never becomes a square glyph
  const iconImage = await getEmojiImage(theme.icon);
  if (!drawEmojiImage(ctx, iconImage, ICX, ICY, 112)) {
    ctx.font = 'bold 58px DejaVuSans';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', ICX, ICY);
  }

  // ── right text section (RTL) ─────────────────────────────
  const TL = 245; // text left edge
  const TR = W - 30; // text right edge

  // title
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 34px "NotoSansArabic", DejaVuSans';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, TR, 42);
  ctx.restore();

  // divider line
  ctx.strokeStyle = `rgba(${c1.r},${c1.g},${c1.b},0.4)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(TL, 92);
  ctx.lineTo(TR, 92);
  ctx.stroke();

  // question / description text
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = '21px "NotoSansArabic", DejaVuSans';
  ctx.fillStyle = '#dfe6e9';
  // manual RTL wrap from right
  const qWords = question.split(' ');
  let qLine = '', qRow = 0;
  const qMaxW = TR - TL - 10, qLineH = 32, qMaxRows = 3, qY = 104;
  for (const w of qWords) {
    const test = qLine ? `${qLine} ${w}` : w;
    if (ctx.measureText(test).width > qMaxW && qLine) {
      ctx.fillText(qLine, TR, qY + qRow * qLineH);
      qLine = w; qRow++;
      if (qRow >= qMaxRows) break;
    } else { qLine = test; }
  }
  if (qLine && qRow < qMaxRows) ctx.fillText(qLine, TR, qY + qRow * qLineH);
  ctx.restore();

  // ── badges row ───────────────────────────────────────────
  const BY = 228;

  // reward badge
  drawRoundRect(ctx, TL, BY, 168, 44, 22);
  ctx.fillStyle = `rgba(${c1.r},${c1.g},${c1.b},0.22)`;
  ctx.fill();
  ctx.strokeStyle = theme.from;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = 'bold 19px "NotoSansArabic", DejaVuSans';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.from;
  const trophyImage = await getEmojiImage('🏆');
  if (!drawEmojiImage(ctx, trophyImage, TL + 43, BY + 22, 24)) ctx.fillText('★', TL + 43, BY + 22);
  ctx.fillText(`${reward} XP`, TL + 108, BY + 22);

  // duration badge
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  const durLabel = secs === 0 ? `${mins} دقيقة` : `${mins}:${String(secs).padStart(2,'0')}`;
  drawRoundRect(ctx, TL + 186, BY, 168, 44, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#dfe6e9';
  const clockImage = await getEmojiImage('⏱️');
  if (!drawEmojiImage(ctx, clockImage, TL + 229, BY + 22, 24)) ctx.fillText('•', TL + 229, BY + 22);
  ctx.fillText(durLabel, TL + 294, BY + 22);

  // ── "فعالية يومية" watermark ──────────────────────────────
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.font = '15px "NotoSansArabic", DejaVuSans';
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  const starImage = await getEmojiImage('🌟');
  if (drawEmojiImage(ctx, starImage, TR - 9, H - 17, 18)) ctx.fillText('فعالية يومية', TR - 22, H - 10);
  else ctx.fillText('فعالية يومية', TR, H - 10);
  ctx.restore();

  return canvas.toBuffer('image/png');
}

module.exports = { generateEventCard };
