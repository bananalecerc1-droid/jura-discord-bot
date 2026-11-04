const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } = require('discord.js');
const { generateSlotCard } = require('../cards/slotCard.js');
const { generateRaceCard }  = require('../cards/raceCard.js');
const axios = require('axios');
const { generateBlackjackCard } = require('../cards/blackjackCard.js');

// ═══════════════════════════════════════════
//  NUMBER GUESS
// ═══════════════════════════════════════════
const activeGuess = new Map(); // channelId -> { answer, attempts, timeout }

function numguessStart(channel, starter) {
  if (activeGuess.has(channel.id)) {
    return { error: '❌ A game is already running in this channel! Guess a number 1–100.' };
  }
  const answer = Math.floor(Math.random() * 100) + 1;
  const timeout = setTimeout(() => {
    if (activeGuess.has(channel.id)) {
      activeGuess.delete(channel.id);
      channel.send({
        embeds: [new EmbedBuilder()
          .setColor(0x636e72)
          .setTitle('⏰ Time\'s Up!')
          .setDescription(`Nobody guessed it! The number was **${answer}**.`)],
      }).catch(() => {});
    }
  }, 2 * 60 * 1000);
  activeGuess.set(channel.id, { answer, attempts: 0, starterId: starter.id, timeout });
  return { ok: true };
}

function numguessStop(channelId) {
  const g = activeGuess.get(channelId);
  if (!g) return false;
  clearTimeout(g.timeout);
  activeGuess.delete(channelId);
  return true;
}

function numguessHandle(message) {
  const game = activeGuess.get(message.channel.id);
  if (!game || message.author.bot) return false;
  const num = parseInt(message.content.trim());
  if (isNaN(num) || num < 1 || num > 100 || String(num) !== message.content.trim()) return false;

  game.attempts++;

  if (num === game.answer) {
    clearTimeout(game.timeout);
    activeGuess.delete(message.channel.id);
    return { correct: true, answer: game.answer, attempts: game.attempts, winner: message.author };
  }

  const hint = num < game.answer ? '📈 **Higher!**' : '📉 **Lower!**';
  return { correct: false, hint, attempts: game.attempts };
}

// ═══════════════════════════════════════════
//  TRIVIA
// ═══════════════════════════════════════════
const activeTrivia = new Map(); // channelId -> { correct, timeout, messageId }

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"').replace(/&lsquo;/g, "'").replace(/&rsquo;/g, "'")
    .replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è').replace(/&ntilde;/g, 'ñ');
}

async function triviaStart(interaction) {
  if (activeTrivia.has(interaction.channelId)) {
    return interaction.reply({ content: '❌ يوجد سؤال معلومات عامة قيد التشغيل في هذه القناة بالفعل!', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply();

  let data;
  try {
    const res = await axios.get('https://opentdb.com/api.php?amount=1&type=multiple', { timeout: 8000 });
    data = res.data.results[0];
  } catch {
    return interaction.editReply({ content: '❌ تعذر جلب سؤال معلومات عامة. حاول مرة أخرى!' });
  }

  const question = decodeHtml(data.question);
  const correct  = decodeHtml(data.correct_answer);
  const wrong    = data.incorrect_answers.map(decodeHtml);

  const answers  = [...wrong, correct].sort(() => Math.random() - 0.5);
  const labels   = ['أ', 'ب', 'ج', 'د'];

  const embed = new EmbedBuilder()
    .setColor(0x6c5ce7)
    .setTitle('🎯 وقت المعلومات العامة!')
    .setDescription(`**${question}**`)
    .addFields(answers.map((a, i) => ({ name: `${labels[i]}.`, value: a, inline: true })))
    .setFooter({ text: `الفئة: ${decodeHtml(data.category)} • الصعوبة: ${data.difficulty === 'easy' ? 'سهلة' : data.difficulty === 'hard' ? 'صعبة' : 'متوسطة'} • 20 ثانية` });

  const row = new ActionRowBuilder().addComponents(
    answers.map((a, i) =>
      new ButtonBuilder()
        .setCustomId(`trivia_${i}_${interaction.channelId}`)
        .setLabel(labels[i])
        .setStyle(ButtonStyle.Primary)
    )
  );

  const msg = await interaction.editReply({ embeds: [embed], components: [row] });

  const timeout = setTimeout(async () => {
    if (activeTrivia.has(interaction.channelId)) {
      activeTrivia.delete(interaction.channelId);
      const ended = EmbedBuilder.from(embed)
        .setColor(0x636e72)
        .setFooter({ text: `انتهى الوقت! الإجابة الصحيحة هي: ${correct}` });
      await msg.edit({ embeds: [ended], components: [] }).catch(() => {});
    }
  }, 20000);

  activeTrivia.set(interaction.channelId, { correct, answers, timeout, msgId: msg.id });
}

async function triviaButton(interaction) {
  const [, idx, chanId] = interaction.customId.split('_');
  const game = activeTrivia.get(chanId);
  if (!game) {
    return interaction.reply({ content: 'انتهت جلسة المعلومات العامة هذه بالفعل.', flags: MessageFlags.Ephemeral });
  }

  const chosen = game.answers[parseInt(idx)];
  const isRight = chosen === game.correct;

  clearTimeout(game.timeout);
  activeTrivia.delete(chanId);

  const embed = new EmbedBuilder()
    .setColor(isRight ? 0x00b894 : 0xd63031)
    .setTitle(isRight ? '✅ إجابة صحيحة!' : '❌ إجابة خاطئة!')
    .setDescription(
      isRight
        ? `**${interaction.user.username}** أجاب بشكل صحيح!\n\nالإجابة: **${game.correct}**`
        : `**${interaction.user.username}** اختار **${chosen}**.\n\nالإجابة الصحيحة: **${game.correct}**`
    );

  await interaction.update({ embeds: [embed], components: [] }).catch(() => {});
  return isRight ? interaction.user : null;
}

// ═══════════════════════════════════════════
//  BLACKJACK
// ═══════════════════════════════════════════
const SUITS  = ['♠', '♥', '♦', '♣'];
const RANKS  = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const activeBlackjack = new Map(); // userId -> game

function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ s, r });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

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

function bjRow(doubled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setStyle(ButtonStyle.Success).setEmoji('👊'),
    new ButtonBuilder().setCustomId('bj_stand').setLabel('Stand').setStyle(ButtonStyle.Primary).setEmoji('✋'),
    new ButtonBuilder().setCustomId('bj_double').setLabel('Double Down').setStyle(ButtonStyle.Secondary).setEmoji('💰').setDisabled(doubled),
  );
}

async function sendBjCard(interactionOrChannel, game, { ended = false, result = null, edit = false } = {}) {
  const buf = await generateBlackjackCard({
    playerHand: game.player,
    dealerHand: game.dealer,
    deckCount: game.deck.length,
    showDealerFull: ended,
    result,
  });
  const file = new AttachmentBuilder(buf, { name: 'blackjack.png' });
  const embed = new EmbedBuilder()
    .setColor(ended
      ? (result && (result.includes('win') || result.includes('Blackjack')) ? 0x00b894
        : result && result.includes('Tie') ? 0xf39c12 : 0xd63031)
      : 0x1b5e35)
    .setImage('attachment://blackjack.png')
    .setFooter({ text: ended ? '🃏 Game over' : '🃏 Blackjack — Hit, Stand, or Double Down' });

  const payload = { embeds: [embed], files: [file], components: ended ? [] : [bjRow(game.doubled)] };
  if (edit) return interactionOrChannel.update(payload);
  return interactionOrChannel.reply(payload);
}

async function blackjackStart(interaction) {
  if (activeBlackjack.has(interaction.user.id)) {
    return interaction.reply({ content: '❌ You already have a game running! Finish it first.', flags: MessageFlags.Ephemeral });
  }

  const deck   = newDeck();
  const player = [deck.pop(), deck.pop()];
  const dealer = [deck.pop(), deck.pop()];
  const game   = { deck, player, dealer, doubled: false };

  // Natural blackjack check
  if (handValue(player) === 21) {
    activeBlackjack.delete(interaction.user.id);
    return sendBjCard(interaction, game, { ended: true, result: 'Blackjack! You win!' });
  }

  activeBlackjack.set(interaction.user.id, game);
  return sendBjCard(interaction, game);
}

async function blackjackButton(interaction) {
  const game = activeBlackjack.get(interaction.user.id);
  if (!game) return interaction.reply({ content: 'No active blackjack game for you.', flags: MessageFlags.Ephemeral });

  const action = interaction.customId.split('_')[1];

  if (action === 'hit' || action === 'double') {
    if (action === 'double') game.doubled = true;
    game.player.push(game.deck.pop());
    const pv = handValue(game.player);

    if (pv > 21) {
      activeBlackjack.delete(interaction.user.id);
      return sendBjCard(interaction, game, { ended: true, result: 'Bust! You lose.', edit: true });
    }
    if (pv === 21 || action === 'double') {
      return resolveBlackjack(interaction, game);
    }
    return sendBjCard(interaction, game, { edit: true });
  }

  if (action === 'stand') {
    return resolveBlackjack(interaction, game);
  }
}

async function resolveBlackjack(interaction, game) {
  while (handValue(game.dealer) < 17) game.dealer.push(game.deck.pop());

  const pv = handValue(game.player);
  const dv = handValue(game.dealer);

  let result;
  if (dv > 21 || pv > dv)  result = '🏆 You win!';
  else if (pv === dv)       result = '🤝 Tie!';
  else                      result = '😔 Dealer wins!';

  activeBlackjack.delete(interaction.user.id);
  return sendBjCard(interaction, game, { ended: true, result, edit: true });
}

// ═══════════════════════════════════════════
//  MINESWEEPER
// ═══════════════════════════════════════════
// Discord max: 5 rows × 5 buttons = 25 buttons
const DIFF = {
  easy:   { rows: 4, cols: 4, mines: 3 },
  medium: { rows: 5, cols: 5, mines: 6 },
  hard:   { rows: 5, cols: 5, mines: 10 },
};

const DIFF_LABELS = {
  easy:   'Easy (4×4, 3 💣)',
  medium: 'Medium (5×5, 6 💣)',
  hard:   'Hard (5×5, 10 💣)',
};

// gameId → { grid, revealed, rows, cols, mineCount, difficulty, safeCells, userId }
const activeMinesweeper = new Map();
// userId → gameId  (so we can retire old sessions when a new game starts)
const userMsGame = new Map();

function msGameId() {
  return Math.random().toString(36).slice(2, 8); // 6-char alphanumeric nonce
}

function msGenGrid(difficulty) {
  const { rows, cols, mines } = DIFF[difficulty] || DIFF.medium;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(0));

  let placed = 0;
  while (placed < mines) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    if (grid[r][c] !== -1) { grid[r][c] = -1; placed++; }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === -1) continue;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === -1) count++;
      }
      grid[r][c] = count;
    }
  }
  return grid;
}

function msBuildComponents(gameId, grid, revealed, rows, cols, gameOver = false) {
  const CELL_LABELS = [' ', '1', '2', '3', '4', '5', '6', '7', '8'];
  const rows_ = [];
  for (let r = 0; r < rows; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < cols; c++) {
      const btn = new ButtonBuilder().setCustomId(`ms_${gameId}_${r}_${c}`);
      if (revealed[r][c]) {
        const val = grid[r][c];
        if (val === -1) {
          btn.setLabel('💣').setStyle(ButtonStyle.Danger).setDisabled(true);
        } else {
          btn.setLabel(CELL_LABELS[val]).setStyle(ButtonStyle.Success).setDisabled(true);
        }
      } else if (gameOver && grid[r][c] === -1) {
        btn.setLabel('💣').setStyle(ButtonStyle.Danger).setDisabled(true);
      } else {
        btn.setLabel('⬜').setStyle(ButtonStyle.Secondary).setDisabled(gameOver);
      }
      row.addComponents(btn);
    }
    rows_.push(row);
  }
  return rows_;
}

async function minesweeperStart(interaction) {
  const diff = interaction.options.getString('difficulty') || 'medium';
  const { rows, cols, mines } = DIFF[diff] || DIFF.medium;
  const grid = msGenGrid(diff);
  const revealed = Array.from({ length: rows }, () => Array(cols).fill(false));
  const safeCells = rows * cols - mines;
  const userId = interaction.user.id;

  // Retire any prior active game for this user
  const oldGameId = userMsGame.get(userId);
  if (oldGameId) activeMinesweeper.delete(oldGameId);

  const gameId = msGameId();
  activeMinesweeper.set(gameId, { grid, revealed, rows, cols, mineCount: mines, safeCells, difficulty: diff, userId });
  userMsGame.set(userId, gameId);

  const components = msBuildComponents(gameId, grid, revealed, rows, cols);
  const embed = new EmbedBuilder()
    .setColor(0x00b894)
    .setTitle('💣 Minesweeper')
    .setDescription(`**${DIFF_LABELS[diff]}**\nاضغط على الأزرار، تجنب الألغام! 💥`)
    .setFooter({ text: `${interaction.user.username} • ${safeCells} خلية آمنة` });

  return interaction.reply({ embeds: [embed], components });
}

async function minesweeperButton(interaction) {
  // customId format: ms_<gameId>_<r>_<c>
  const parts = interaction.customId.split('_');
  if (parts.length !== 4) return interaction.deferUpdate();

  const gameId = parts[1];
  const r = parseInt(parts[2], 10);
  const c = parseInt(parts[3], 10);
  const userId = interaction.user.id;

  const state = activeMinesweeper.get(gameId);

  // Stale button from a retired or nonexistent game
  if (!state) {
    return interaction.reply({ content: '❌ هذه اللعبة انتهت أو لم تعد موجودة.', flags: MessageFlags.Ephemeral });
  }

  // Only the owner can click
  if (state.userId !== userId) {
    return interaction.reply({ content: '❌ هذه اللعبة ليست لك!', flags: MessageFlags.Ephemeral });
  }

  const { grid, revealed, rows, cols, safeCells, difficulty } = state;

  // Bounds check
  if (r < 0 || r >= rows || c < 0 || c >= cols) return interaction.deferUpdate();

  if (revealed[r][c]) return interaction.deferUpdate();

  revealed[r][c] = true;

  // Hit a mine → lose
  if (grid[r][c] === -1) {
    activeMinesweeper.delete(gameId);
    userMsGame.delete(userId);
    const components = msBuildComponents(gameId, grid, revealed, rows, cols, true);
    const embed = new EmbedBuilder()
      .setColor(0xd63031)
      .setTitle('💥 انفجرت لغم! خسرت!')
      .setDescription(`**${DIFF_LABELS[difficulty]}**\nكانت هناك لغم في تلك الخلية 💣`)
      .setFooter({ text: `${interaction.user.username} • اللعبة انتهت` });
    return interaction.update({ embeds: [embed], components });
  }

  // Count revealed safe cells
  let revealedSafe = 0;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++)
      if (revealed[i][j] && grid[i][j] !== -1) revealedSafe++;

  if (revealedSafe >= safeCells) {
    // Win!
    activeMinesweeper.delete(gameId);
    userMsGame.delete(userId);
    const components = msBuildComponents(gameId, grid, revealed, rows, cols, true);
    const embed = new EmbedBuilder()
      .setColor(0xfdcb6e)
      .setTitle('🏆 فزت! نظفت الحقل!')
      .setDescription(`**${DIFF_LABELS[difficulty]}**\nكشفت كل الخلايا الآمنة بنجاح! 🎉`)
      .setFooter({ text: `${interaction.user.username} • اللعبة انتهت` });
    return interaction.update({ embeds: [embed], components });
  }

  // Game continues
  const remaining = safeCells - revealedSafe;
  const components = msBuildComponents(gameId, grid, revealed, rows, cols);
  const embed = new EmbedBuilder()
    .setColor(0x00b894)
    .setTitle('💣 Minesweeper')
    .setDescription(`**${DIFF_LABELS[difficulty]}**\nاضغط على الأزرار، تجنب الألغام! 💥`)
    .setFooter({ text: `${interaction.user.username} • ${remaining} خلية آمنة متبقية` });
  return interaction.update({ embeds: [embed], components });
}

// ═══════════════════════════════════════════
//  SLOTS  🎰
// ═══════════════════════════════════════════
const SLOT_SYMS    = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎', '7️⃣'];
const SLOT_WEIGHTS = [ 30,   25,   20,   15,    7,    3,    1 ];

const SLOT_PAY = {
  '7️⃣': { label: '777 JACKPOT!!!',  cardColor: '#f9ca24', embedColor: 0xfdcb6e },
  '💎':  { label: 'Diamond Win!',   cardColor: '#74b9ff', embedColor: 0x0984e3 },
  '⭐':  { label: 'Star Win!',       cardColor: '#ffeaa7', embedColor: 0xffeaa7 },
  '🍇':  { label: 'Grape Win!',     cardColor: '#a29bfe', embedColor: 0xa29bfe },
  '🍊':  { label: 'Orange Win!',    cardColor: '#e17055', embedColor: 0xe17055 },
  '🍋':  { label: 'Lemon Win!',     cardColor: '#fdcb6e', embedColor: 0xfdcb6e },
  '🍒':  { label: 'Cherry Win!',    cardColor: '#fd79a8', embedColor: 0xd63031 },
};

function slotPick() {
  const total = SLOT_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < SLOT_SYMS.length; i++) {
    r -= SLOT_WEIGHTS[i];
    if (r < 0) return i;
  }
  return SLOT_SYMS.length - 1;
}

function slotOutcome(result) {
  const [a, b, c] = result;
  if (a === b && b === c) {
    const pay = SLOT_PAY[a];
    return {
      title:      pay?.label      ?? 'فزت!',
      cardColor:  pay?.cardColor  ?? '#00b894',
      embedColor: pay?.embedColor ?? 0x00b894,
      desc:       'ثلاثة متطابقين! 🥳🥳🥳',
      win:        true,
    };
  }
  if (a === b || b === c || a === c) {
    return { title: 'نصف فوز!',  cardColor: '#0984e3', embedColor: 0x0984e3, desc: 'اثنين متطابقين 😄', win: false };
  }
  return { title: 'حظ أفضل المرة القادمة!', cardColor: '#636e72', embedColor: 0x636e72, desc: 'ما في تطابق 😅', win: false };
}

// Animation frames:
// 0-2 → all spinning | 3 → reel-0 stops | 4 → reel-1 stops | 5 → all stopped (final)
const SLOT_FRAMES = [
  [false, false, false],
  [false, false, false],
  [false, false, false],
  [true,  false, false],
  [true,  true,  false],
  [true,  true,  true ],
];

function replayRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('slots_replay')
      .setLabel('🔄 العب مرة ثانية')
      .setStyle(ButtonStyle.Primary),
  );
}

async function runSlotsAnimation(interaction, isReplay = false) {
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  const resultIdx = [slotPick(), slotPick(), slotPick()];
  const result    = resultIdx.map((i) => SLOT_SYMS[i]);
  const outcome   = slotOutcome(result);
  const username  = interaction.user.username;

  if (isReplay) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply();
  }

  for (let f = 0; f < SLOT_FRAMES.length; f++) {
    const stopped  = SLOT_FRAMES[f];
    const isFinal  = f === SLOT_FRAMES.length - 1;

    const cardOutcome = isFinal
      ? { title: outcome.title, color: outcome.cardColor }
      : null;

    const buffer = await generateSlotCard({ reels: result, stopped, outcome: cardOutcome, username });
    const file   = new AttachmentBuilder(buffer, { name: 'slots.png' });

    const embed = new EmbedBuilder()
      .setColor(isFinal ? outcome.embedColor : 0xfdcb6e)
      .setImage('attachment://slots.png');

    if (isFinal) {
      embed.setFooter({ text: outcome.desc });
    }

    const payload = { embeds: [embed], files: [file], components: isFinal ? [replayRow()] : [] };
    await interaction.editReply(payload);

    if (!isFinal) await sleep(750);
  }
}

async function slotsStart(interaction)  { return runSlotsAnimation(interaction, false); }
async function slotsReplay(interaction) { return runSlotsAnimation(interaction, true);  }

// ═══════════════════════════════════════════
//  CAR RACE  🏎️
// ═══════════════════════════════════════════
const RACE_LEN = 12; // track length in steps
const activeRaceChallenge = new Map(); // channelId → challenge data

/** Build { embeds, files } payload from a canvas race card frame */
async function racePayload(opts) {
  const buf  = await generateRaceCard(opts);
  const file = new AttachmentBuilder(buf, { name: 'race.png' });
  const embed = new EmbedBuilder()
    .setColor(
      opts.status === 'p1wins' ? 0xe74c3c :
      opts.status === 'p2wins' ? 0x0984e3 :
      opts.status === 'tie'    ? 0xf39c12 :
      opts.status === 'countdown' ? 0xfdcb6e : 0x0984e3
    )
    .setImage('attachment://race.png');
  return { embeds: [embed], files: [file] };
}

/** DM-only: race the user against the bot immediately, no challenge phase */
async function raceDM(interaction) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const p1Name = interaction.user.username;
  const p2Name = '🤖 Bot';

  await interaction.deferReply();

  // Countdown frame
  await interaction.editReply({
    ...(await racePayload({ p1Name, p2Name, pos1: 0, pos2: 0, raceLen: RACE_LEN, status: 'countdown' })),
    components: [],
  });
  await sleep(2000);

  let pos1 = 0, pos2 = 0;

  while (true) {
    pos1 = Math.min(pos1 + Math.floor(Math.random() * 3) + 1, RACE_LEN);
    pos2 = Math.min(pos2 + Math.floor(Math.random() * 3) + 1, RACE_LEN);

    const p1done = pos1 >= RACE_LEN;
    const p2done = pos2 >= RACE_LEN;

    let status;
    if      (p1done && p2done) status = 'tie';
    else if (p1done)           status = 'p1wins';
    else if (p2done)           status = 'p2wins';
    else                       status = 'racing';

    await interaction.editReply({
      ...(await racePayload({ p1Name, p2Name, pos1, pos2, raceLen: RACE_LEN, status })),
      components: [],
    });

    if (p1done || p2done) break;
    await sleep(1200);
  }
}

async function raceChallenge(interaction) {
  const opponent = interaction.options.getMember('user');
  if (!opponent) return interaction.reply({ content: '❌ العضو غير موجود في السيرفر.', flags: MessageFlags.Ephemeral });
  if (opponent.id === interaction.user.id) return interaction.reply({ content: '❌ ما تقدر تتسابق مع نفسك!', flags: MessageFlags.Ephemeral });
  if (opponent.user.bot) return interaction.reply({ content: '❌ ما تقدر تتسابق مع بوت!', flags: MessageFlags.Ephemeral });
  if (activeRaceChallenge.has(interaction.channelId)) {
    return interaction.reply({ content: '❌ في تحدي سباق شغال في هذا الروم! انتظر انتهائه.', flags: MessageFlags.Ephemeral });
  }

  const p1Name = interaction.user.username;
  const p2Name = opponent.user.username;

  const payload = await racePayload({ p1Name, p2Name, pos1: 0, pos2: 0, raceLen: RACE_LEN, status: 'waiting' });

  const challengeEmbed = new EmbedBuilder()
    .setColor(0x0984e3)
    .setTitle('🏎️ تحدي سباق سيارات!')
    .setDescription(`${interaction.user} يتحداك على سباق سيارات يا ${opponent}! 🔥\n\nعندك **30 ثانية** للرد!`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`race_accept_${interaction.channelId}`).setLabel('✅ قبول').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`race_decline_${interaction.channelId}`).setLabel('❌ رفض').setStyle(ButtonStyle.Danger),
  );

  const msg = await interaction.reply({
    embeds: [...payload.embeds, challengeEmbed],
    files:  payload.files,
    components: [row],
    fetchReply: true,
  });

  const timeout = setTimeout(async () => {
    if (activeRaceChallenge.has(interaction.channelId)) {
      activeRaceChallenge.delete(interaction.channelId);
      const expired = new EmbedBuilder().setColor(0x636e72).setTitle('⏰ انتهى وقت التحدي').setDescription('لم يقبل أحد. السباق ألغي!');
      await msg.edit({ embeds: [expired], files: [], components: [] }).catch(() => {});
    }
  }, 30_000);

  activeRaceChallenge.set(interaction.channelId, {
    challengerId: interaction.user.id,
    challenger:   interaction.user,
    opponentId:   opponent.id,
    opponent:     opponent.user,
    p1Name, p2Name,
    timeout,
  });
}

async function raceAcceptBtn(interaction) {
  const chanId = interaction.customId.replace('race_accept_', '');
  const ch = activeRaceChallenge.get(chanId);
  if (!ch) return interaction.reply({ content: '❌ هذا التحدي لم يعد موجوداً.', flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== ch.opponentId) {
    return interaction.reply({ content: '❌ هذا التحدي موجه لشخص آخر!', flags: MessageFlags.Ephemeral });
  }
  clearTimeout(ch.timeout);
  activeRaceChallenge.delete(chanId);
  await runRace(interaction, ch.challenger, ch.opponent, ch.p1Name, ch.p2Name);
}

async function raceDeclineBtn(interaction) {
  const chanId = interaction.customId.replace('race_decline_', '');
  const ch = activeRaceChallenge.get(chanId);
  if (!ch) return interaction.reply({ content: '❌ هذا التحدي لم يعد موجوداً.', flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== ch.opponentId && interaction.user.id !== ch.challengerId) {
    return interaction.reply({ content: '❌ ما تقدر تتدخل في هذا التحدي.', flags: MessageFlags.Ephemeral });
  }
  clearTimeout(ch.timeout);
  activeRaceChallenge.delete(chanId);

  const embed = new EmbedBuilder()
    .setColor(0xd63031)
    .setTitle('🚫 تم رفض التحدي')
    .setDescription(`${interaction.user} رفض التحدي. ربما في وقت آخر! 👋`);
  return interaction.update({ embeds: [embed], files: [], components: [] });
}

async function runRace(interaction, p1, p2, p1Name, p2Name) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Countdown frame
  await interaction.update({
    ...(await racePayload({ p1Name, p2Name, pos1: 0, pos2: 0, raceLen: RACE_LEN, status: 'countdown' })),
    components: [],
  });
  await sleep(2000);

  let pos1 = 0, pos2 = 0, round = 0;

  while (true) {
    round++;
    pos1 = Math.min(pos1 + Math.floor(Math.random() * 3) + 1, RACE_LEN);
    pos2 = Math.min(pos2 + Math.floor(Math.random() * 3) + 1, RACE_LEN);

    const p1done = pos1 >= RACE_LEN;
    const p2done = pos2 >= RACE_LEN;

    let status;
    if      (p1done && p2done) status = 'tie';
    else if (p1done)           status = 'p1wins';
    else if (p2done)           status = 'p2wins';
    else                       status = 'racing';

    await interaction.editReply({
      ...(await racePayload({ p1Name, p2Name, pos1, pos2, raceLen: RACE_LEN, status, round })),
      components: [],
    });

    if (p1done || p2done) break;
    await sleep(1200);
  }
}

// ═══════════════════════════════════════════
//  CAT GAME  🐱
// ═══════════════════════════════════════════
const { CAT_QUESTIONS } = require('./catQuestions.js');

function catEmbed(q, username) {
  return new EmbedBuilder()
    .setColor(0xff9ff3)
    .setTitle('🐱 سؤال كت')
    .setDescription(`\n# **${q}**\n`)
    .setFooter({ text: `${username} • اجاوب بصراحة! 👀` });
}

async function catStart(interaction) {
  const q     = CAT_QUESTIONS[Math.floor(Math.random() * CAT_QUESTIONS.length)];
  const embed = catEmbed(q, interaction.user.username);

  return interaction.reply({ embeds: [embed] });
}

module.exports = {
  numguessStart, numguessStop, numguessHandle,
  triviaStart, triviaButton,
  blackjackStart, blackjackButton,
  minesweeperStart, minesweeperButton,
  slotsStart, slotsReplay,
  catStart,
  raceChallenge, raceDM, raceAcceptBtn, raceDeclineBtn,
};
