const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const fontsPath = path.join(__dirname, '../../fonts', 'NotoSansArabic.ttf');
if (fs.existsSync(fontsPath)) {
  GlobalFonts.registerFromPath(fontsPath, 'NotoArabic');
}
const { fetchImage: fetchAvatar, sanitizeName } = require('../../imageUtils.js');
const BG_DIR = path.join(__dirname, '../../backgrounds');

const THEME = {
  bg: '#0d0d1a',
  card: '#13132b',
  border: '#2a2a4a',
  accent: '#7c3aed',
  accent2: '#2563eb',
  gold: '#f59e0b',
  silver: '#94a3b8',
  bronze: '#b45309',
  text: '#f1f5f9',
  muted: '#64748b',
  bar_bg: '#1e1e3f',
};

const MEDALS = ['#f59e0b', '#94a3b8', '#b45309'];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * @param {Array} entries - القائمة الرئيسية (توب 10 مثلاً)
 * @param {Object} userData - بيانات المستخدم الحالي (اختياري)
 * @param {string} period - الفترة الزمنية
 */
async function generateLeaderboardCard(entries, userData = null, period = 'all') {
  const W = 780;
  const ROW_H = 72;
  const PADDING = 24;
  
  // التحقق مما إذا كان المستخدم موجوداً في التوب 10
  const isUserInTop = userData && entries.some(e => e.userId === userData.userId);
  const showUserCard = userData && !isUserInTop;
  
  // الحساب الجديد للطول: لا يوجد هيدر، فقط الصفوف وبطاقة المستخدم إذا لزم الأمر
  const USER_CARD_H = showUserCard ? ROW_H + 20 : 0;
  const H = (entries.length * ROW_H) + USER_CARD_H + PADDING;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // جلب الصور بشكل متوازي
  const avatarImages = await Promise.all(
    entries.map((e) => fetchAvatar(e.avatarUrl).catch(() => null))
  );
  
  let userAvatarImg = null;
  if (showUserCard) {
    userAvatarImg = await fetchAvatar(userData.avatarUrl).catch(() => null);
  }

  // قص الحواف
  roundRect(ctx, 0, 0, W, H, 20);
  ctx.clip();

  // الخلفية
  const lbBgFile = path.join(BG_DIR, 'leaderboard_bg.png');
  let bgLoaded = false;
  if (fs.existsSync(lbBgFile)) {
    try {
      const bgImg = await loadImage(lbBgFile);
      ctx.drawImage(bgImg, 0, 0, W, H);
      ctx.fillStyle = 'rgba(8, 8, 20, 0.70)';
      ctx.fillRect(0, 0, W, H);
      bgLoaded = true;
    } catch {}
  }
  if (!bgLoaded) {
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#0d0d1a');
    bgGrad.addColorStop(1, '#12122a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);
  }

  const FONT = fs.existsSync(fontsPath) ? 'NotoArabic' : 'sans-serif';
  const isAllTime = period === 'all';

  // رسم الصفوف
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const avatar = avatarImages[i];
    const y = i * ROW_H + 10; // إزاحة بسيطة عن الأعلى
    drawRow(ctx, entry, avatar, y, i, W, ROW_H, FONT, isAllTime);
    
    // فاصل بين الصفوف
    if (i < entries.length - 1) {
      ctx.beginPath();
      ctx.moveTo(24, y + ROW_H);
      ctx.lineTo(W - 24, y + ROW_H);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // رسم بطاقة المستخدم في الأسفل إذا لم يكن في التوب
  if (showUserCard) {
    const userY = entries.length * ROW_H + 20;
    
    // خلفية مميزة لبطاقة المستخدم
    roundRect(ctx, 8, userY - 5, W - 16, ROW_H + 10, 15);
    ctx.fillStyle = 'rgba(124, 58, 237, 0.15)'; // لون بنفسجي خفيف للتمييز
    ctx.fill();
    ctx.strokeStyle = 'rgba(124, 58, 237, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    drawRow(ctx, userData, userAvatarImg, userY, -1, W, ROW_H, FONT, isAllTime);
  }

  return canvas.toBuffer('image/png');
}

/**
 * دالة مساعدة لرسم صف واحد (سواء في القائمة أو بطاقة المستخدم)
 */
function drawRow(ctx, data, avatarImg, y, index, W, ROW_H, FONT, isAllTime) {
  const { username, level, totalXp, currentXp, xpNeeded, periodXp, rank } = data;
  const avatarPad = 16;
  const avatarSize = 44;
  const isEven = index !== -1 && index % 2 === 0;

  if (index !== -1) {
    roundRect(ctx, 8, y + 4, W - 16, ROW_H - 6, 10);
    ctx.fillStyle = isEven ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)';
    ctx.fill();
  }

  const rankX = avatarPad + 14;
  const rankColor = (index >= 0 && index < 3) ? MEDALS[index] : THEME.muted;
  ctx.fillStyle = rankColor;
  ctx.font = `bold ${(index >= 0 && index < 3) ? '20px' : '16px'} ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(`${rank}`, rankX, y + ROW_H / 2 + 7);

  const avatarX = rankX + 26;
  const avatarY = y + (ROW_H - avatarSize) / 2;
  const cx = avatarX + avatarSize / 2;
  const cy = avatarY + avatarSize / 2;

  ctx.beginPath();
  ctx.arc(cx, cy, avatarSize / 2, 0, Math.PI * 2);
  ctx.fillStyle = THEME.border;
  ctx.fill();

  if (avatarImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
  }

  if (index >= 0 && index < 3) {
    ctx.beginPath();
    ctx.arc(cx, cy, avatarSize / 2 + 2, 0, Math.PI * 2);
    ctx.strokeStyle = MEDALS[index];
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const textX = avatarX + avatarSize + 14;
  const midY = y + ROW_H / 2;

  ctx.textAlign = 'left';
  ctx.fillStyle = THEME.text;
  ctx.font = `bold 15px ${FONT}`;
  const cleanUsername = sanitizeName(username);
  ctx.fillText(cleanUsername.length > 18 ? cleanUsername.slice(0, 17) + '…' : cleanUsername, textX, midY - 6);

  const barW = 180;
  const barH = 7;
  const barX = textX;
  const barY = midY + 4;

  if (isAllTime) {
    const progress = Math.min(1, currentXp / xpNeeded);
    roundRect(ctx, barX, barY, barW, barH, 4);
    ctx.fillStyle = THEME.bar_bg;
    ctx.fill();

    if (progress > 0) {
      const barGrad = ctx.createLinearGradient(barX, barY, barX + barW, barY);
      barGrad.addColorStop(0, THEME.accent);
      barGrad.addColorStop(1, THEME.accent2);
      roundRect(ctx, barX, barY, Math.max(barH, progress * barW), barH, 4);
      ctx.fillStyle = barGrad;
      ctx.fill();
    }

    ctx.fillStyle = THEME.muted;
    ctx.font = `11px ${FONT}`;
    ctx.fillText(`${currentXp.toLocaleString()} / ${xpNeeded.toLocaleString()} XP`, barX, barY + barH + 13);
  } else {
    roundRect(ctx, barX, barY, barW, barH, 4);
    ctx.fillStyle = THEME.bar_bg;
    ctx.fill();

    const barGrad = ctx.createLinearGradient(barX, barY, barX + barW, barY);
    barGrad.addColorStop(0, THEME.accent);
    barGrad.addColorStop(1, THEME.accent2);
    roundRect(ctx, barX, barY, barW * 0.85, barH, 4);
    ctx.fillStyle = barGrad;
    ctx.fill();

    ctx.fillStyle = THEME.muted;
    ctx.font = `11px ${FONT}`;
    ctx.fillText(`${periodXp.toLocaleString()} XP gained`, barX, barY + barH + 13);
  }

  ctx.textAlign = 'right';
  const rightX = W - avatarPad;

  if (isAllTime) {
    ctx.fillStyle = THEME.accent;
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillText(`${totalXp.toLocaleString()} XP`, rightX, midY - 4);

    ctx.fillStyle = THEME.muted;
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillText(`LVL ${level}`, rightX, midY + 14);
  } else {
    ctx.fillStyle = THEME.accent;
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillText(`${periodXp.toLocaleString()} XP`, rightX, midY - 4);

    ctx.fillStyle = THEME.muted;
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillText(`LVL ${level} total`, rightX, midY + 14);
  }
}

module.exports = { generateLeaderboardCard };
