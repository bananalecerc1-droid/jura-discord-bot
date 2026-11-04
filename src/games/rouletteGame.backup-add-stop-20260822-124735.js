const { ButtonBuilder, ButtonStyle, AttachmentBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const { createButtonRows, sleep } = require('./roulette-utils.js');
const { createWheel } = require('./rouletteWheel.js');
const rouletteCfg = require('../../roulette-config.json');

let rouletteConfigGetter = () => ({});
function setRouletteConfigGetter(getter) {
  rouletteConfigGetter = typeof getter === 'function' ? getter : () => ({});
}
function getRouletteSettings() {
  const saved = rouletteConfigGetter() || {};
  const presentation = saved.presentation || {};
  return {
    startTime: Number(process.env.ROULETTE_START_TIME || saved.startTime || rouletteCfg.startTime || 50),
    chooseTimeout: Number(process.env.ROULETTE_CHOOSE_TIMEOUT || saved.chooseTimeout || rouletteCfg.chooseTimeout || 30),
    timeBetweenRounds: Number(process.env.ROULETTE_TIME_BETWEEN_ROUNDS || saved.timeBetweenRounds || rouletteCfg.timeBetweenRounds || 10),
    allowedRoleId: process.env.ROULETTE_ALLOWED_ROLE_ID || saved.allowedRoleId || rouletteCfg.allowedRoleId || '',
    maxPlayers: Number(saved.maxPlayers || rouletteCfg.maxPlayers || 40),
    embedTitle: presentation.embedTitle || '🎲 بدء لعبة الروليت',
    embedDescription: presentation.embedDescription || 'انضم إلى اللعبة بالضغط على الزر أدناه.\n\n**{count}/{max}** لاعبين انضموا',
    imageUrl: presentation.imageUrl || '',
    embedColor: presentation.embedColor || '#5865F2',
    joinButtonLabel: presentation.joinButtonLabel || 'انضم إلى اللعبة',
    joinButtonColor: presentation.joinButtonColor || 'Success',
    leaveButtonLabel: presentation.leaveButtonLabel || 'غادر اللعبة',
    leaveButtonColor: presentation.leaveButtonColor || 'Danger',
    kickButtonColor: presentation.kickButtonColor || 'Secondary',
    actionButtonColor: presentation.actionButtonColor || 'Primary',
    paginationButtonColor: presentation.paginationButtonColor || 'Primary',
  };
}
function toButtonStyle(name, fallback) {
  return ButtonStyle[name] || fallback;
}

const Games = new Map();
const KickedPlayers = new Map();
const AllPlayers = new Map();

async function startRouletteGame(source) {
  try {
    const member = source.member || source.guild.members.cache.get(source.author.id);
    const guildId = source.guildId || source.guild.id;

    const settings = getRouletteSettings();
    if (settings.allowedRoleId && !member.roles.cache.has(settings.allowedRoleId)) {
      if (source.reply) {
        source.reply({ content: 'ليس لديك الإذن لاستخدام هذا الأمر.', ephemeral: true }).catch(console.error);
      } else {
        source.channel.send('ليس لديك الإذن لاستخدام هذا الأمر.').catch(console.error);
      }
      return;
    }

    if (await Games.get(guildId)) {
      if (source.reply) {
        source.reply({ content: 'هناك لعبة قيد التقدم بالفعل في هذا السيرفر.', ephemeral: true }).catch(console.error);
      } else {
        source.channel.send('هناك لعبة قيد التقدم بالفعل في هذا السيرفر.').catch(console.error);
      }
      return;
    }

    const joinButton = new ButtonBuilder()
      .setCustomId('join_roulette')
      .setLabel(settings.joinButtonLabel)
      .setStyle(toButtonStyle(settings.joinButtonColor, ButtonStyle.Success));

    const leaveButton = new ButtonBuilder()
      .setCustomId('leave_roulette')
      .setLabel(settings.leaveButtonLabel)
      .setStyle(toButtonStyle(settings.leaveButtonColor, ButtonStyle.Danger));

    const rows = createButtonRows([joinButton, leaveButton]);
    const initialEmbed = new EmbedBuilder()
      .setColor(settings.embedColor)
      .setTitle(settings.embedTitle)
      .setDescription(settings.embedDescription
        .replaceAll('{count}', '0')
        .replaceAll('{max}', String(settings.maxPlayers)));
    const initialFiles = [];
    if (settings.imageUrl) {
      initialEmbed.setImage(settings.imageUrl);
    } else {
      initialFiles.push(new AttachmentBuilder('./roulette.png', { name: 'roulette.png' }));
      initialEmbed.setImage('attachment://roulette.png');
    }

    const initialMessage = await source.channel.send({
      embeds: [initialEmbed],
      files: initialFiles,
      components: rows,
    });

    Games.set(guildId, {
      players: [],
      messageId: initialMessage.id,
      winner: {},
    });
    KickedPlayers.set(guildId, { players: [] });
    AllPlayers.set(guildId, new Map());

    if (source.reply) {
      source.reply({ content: 'تم بدء اللعبة! انضم عن طريق الضغط على الزر أدناه.', ephemeral: true }).catch(console.error);
    } else {
      source.channel.send('تم بدء اللعبة! انضم عن طريق الضغط على الزر أدناه.').catch(console.error);
    }

    setTimeout(async () => {
      try {
        await initialMessage.edit({ components: [] }).catch(console.error);
        await startGame(source, true);
      } catch (error) {
        console.error('Error starting the game:', error);
      }
    }, getRouletteSettings().startTime * 1000);
  } catch (error) {
    console.error('Error in startRouletteGame:', error);
    source.channel.send('حدث خطأ أثناء بدء اللعبة. يرجى المحاولة مرة أخرى.').catch(console.error);
  }
}


async function handleButtonInteraction(interaction) {
  try {
    const customId = interaction.customId;

    if (customId === 'join_roulette') {
      await handleJoinGame(interaction);
    } else if (customId === 'leave_roulette') {
      await handleLeaveGame(interaction);
    } else if (customId.startsWith('kick_')) {
      await handleKickPlayer(interaction);
    } else if (customId === 'auto_kick') {
      await handleAutoKick(interaction);
    } else if (customId === 'withdrawal') {
      await handleWithdrawal(interaction);
    } else if (customId.startsWith('revive_player')) {
      await handleReviveAction(interaction);
    } else if (customId.startsWith('protect_player')) {
      await handleProtectYourself(interaction);
    } else if (customId.startsWith('switch_turn')) {
      await handleSwitchTurn(interaction);
    } else if (customId.startsWith('freeze_player')) {
      await handleFreezeAction(interaction);
    } else if (customId.startsWith('select_player_')) {
      await handleSelectPlayer(interaction);
    } else if (customId.startsWith('paginate_')) {
      await handlePagination(interaction);
    }
  } catch (error) {
    console.error('Error handling button interaction:', error);
    if (!interaction.replied) {
      interaction.reply({ content: 'حدث خطأ أثناء معالجة التفاعل. يرجى المحاولة مرة أخرى.', ephemeral: true }).catch(console.error);
    }
  }
}


function updateV2TextComponents(components, nextDescription) {
  let replaced = false;
  const boldCountTest = /\*\*\d+\/\d+\*\*/;
  const boldCountReplace = /\*\*\d+\/\d+\*\*/g;
  const plainCountTest = /\b\d+\/\d+\b/;
  const plainCountReplace = /\b\d+\/\d+\b/g;
  const targetBold = nextDescription.match(boldCountTest)?.[0];
  const targetPlain = nextDescription.match(plainCountTest)?.[0];
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const next = { ...value };
    if (next.type === 10 && typeof next.content === 'string') {
      const current = next.content;
      if (boldCountTest.test(current)) {
        next.content = current.replace(boldCountReplace, targetBold || nextDescription);
        replaced = true;
      } else if (plainCountTest.test(current)) {
        next.content = current.replace(plainCountReplace, targetPlain || nextDescription);
        replaced = true;
      }
    }
    if (Array.isArray(next.components)) next.components = next.components.map(visit);
    if (next.accessory) next.accessory = visit(next.accessory);
    return next;
  };
  return { components: (components || []).map(visit), replaced };
}

async function updateLobbyPlayerCount(message, joinCount) {
  const settings = getRouletteSettings();
  const description = String(settings.embedDescription || '')
    .replaceAll('{count}', String(joinCount))
    .replaceAll('{max}', String(settings.maxPlayers))
    .slice(0, 4096);
  if (message.flags?.has?.(32768) || !message.embeds?.length) {
    const sourceComponents = (message.components || []).map(component =>
      typeof component.toJSON === 'function' ? component.toJSON() : component,
    );
    const updated = updateV2TextComponents(sourceComponents, description);
    if (updated.replaced) return message.edit({ components: updated.components });
  }
  if (message.embeds?.length) {
    const embed = EmbedBuilder.from(message.embeds[0].toJSON()).setDescription(description);
    return message.edit({ embeds: [embed] });
  }
  return message.edit({ content: `🎲 **بدء لعبة الروليت**\\n${joinCount}/${settings.maxPlayers} لاعبين انضموا` });
}

async function handleJoinGame(interaction) {
  try {
    const savedGame = await Games.get(interaction.guildId);
    const allPlayers = AllPlayers.get(interaction.guildId);

    if (!savedGame) {
      interaction
        .reply({ content: 'لا توجد لعبة قيد التشغيل حاليًا في هذا السيرفر.', ephemeral: true })
        .catch(console.error);
      return;
    }

    if (savedGame.players.some(user => user.user === interaction.user.id)) {
      interaction
        .reply({
          content: 'لقد انضممت بالفعل.',
          ephemeral: true,
        })
        .catch(console.error);
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);

    const assignedNumbers = savedGame.players.map(p => parseInt(p.buttonNumber, 10));
    let number = 1;
    while (assignedNumbers.includes(number)) {
      number++;
    }

    if (number > 40) {
      interaction
        .reply({
          content: 'تم الوصول إلى الحد الأقصى لعدد اللاعبين في هذه اللعبة.',
          ephemeral: true,
        })
        .catch(console.error);
      return;
    }

    const playerData = {
      user: interaction.user.id,
      buttonNumber: number.toString(),
      username: interaction.user.username,
      avatar: interaction.user.displayAvatarURL({ size: 256, extension: 'png' }),
      color: interaction.user.hexAccentColor,
      shield: false,
      shieldUsed: false,
      reviveUsed: false,
      freezeUsed: false,
      frozen: false,
      switchUsed: false,
      kills: 0,
      deaths: 0,
    };

    savedGame.players.push(playerData);
    allPlayers.set(interaction.user.id, playerData);
    await Games.set(interaction.guildId, savedGame);
    AllPlayers.set(interaction.guildId, allPlayers);

    const messageId = savedGame.messageId;
    const channel = interaction.channel;

    const message = await channel.messages.fetch(messageId);

    const joinCount = savedGame.players.length;

    await updateLobbyPlayerCount(message, joinCount).catch(console.error);

    interaction
      .reply({ content: `انضممت بنجاح! رقمك هو ${number}.`, ephemeral: true })
      .catch(console.error);
  } catch (error) {
    console.error('Error handling join game:', error);
    interaction.reply({ content: 'حدث خطأ أثناء الانضمام إلى اللعبة.', ephemeral: true }).catch(console.error);
  }
}


async function handleLeaveGame(interaction) {
  try {
    const savedGame = await Games.get(interaction.guildId);

    if (!savedGame) {
      interaction
        .reply({ content: 'لا توجد لعبة قيد التشغيل حاليًا في هذا السيرفر.', ephemeral: true })
        .catch(console.error);
      return;
    }

    if (!savedGame.players.some(user => user.user === interaction.user.id)) {
      interaction.reply({ content: 'لم تنضم إلى اللعبة.', ephemeral: true }).catch(console.error);
      return;
    }

    savedGame.players = savedGame.players.filter(user => user.user !== interaction.user.id);
    await Games.set(interaction.guildId, savedGame);

    const messageId = savedGame.messageId;
    const channel = interaction.channel;

    const message = await channel.messages.fetch(messageId);

    const joinCount = savedGame.players.length;

    await updateLobbyPlayerCount(message, joinCount).catch(console.error);

    interaction.reply({ content: 'لقد غادرت اللعبة.', ephemeral: true }).catch(console.error);
  } catch (error) {
    console.error('Error handling leave game:', error);
    interaction.reply({ content: 'حدث خطأ أثناء مغادرة اللعبة.', ephemeral: true }).catch(console.error);
  }
}


async function handleKickPlayer(interaction) {
  try {
    const kickedUserId = interaction.customId.split('_')[1];

    const savedGame = await Games.get(interaction.guildId);
    const kickedPlayers = await KickedPlayers.get(interaction.guildId);
    const allPlayers = AllPlayers.get(interaction.guildId);

    if (!savedGame) {
      interaction
        .reply({ content: 'لا توجد لعبة قيد التشغيل حاليًا في هذا السيرفر.', ephemeral: true })
        .catch(console.error);
      return;
    }

    if (interaction.user.id !== savedGame?.winner.id) {
      interaction
        .reply({ content: 'ليس دورك في اللعبة، لذا لا يمكنك طرد اللاعبين.', ephemeral: true })
        .catch(console.error);
      return;
    }
    if (Date.now() > savedGame.winner.until) {
      interaction.reply({ content: 'لقد فاتك دورك.', ephemeral: true }).catch(console.error);
      return;
    }

    const playerToKick = savedGame.players.find(player => player.user === kickedUserId);

    if (!playerToKick) {
      interaction.reply({ content: 'هذا اللاعب غير موجود في اللعبة.', ephemeral: true }).catch(console.error);
      return;
    }

    if (playerToKick.shield) {
      interaction
        .reply({ content: 'لا يمكنك طرد هذا اللاعب لأنه محمي للدور القادم.', ephemeral: true })
        .catch(console.error);
      return;
    }

    kickedPlayers.players.push(playerToKick);
    playerToKick.deaths += 1;
    const kicker = savedGame.players.find(player => player.user === interaction.user.id);
    kicker.kills += 1;
    allPlayers.get(playerToKick.user).deaths = playerToKick.deaths;
    allPlayers.get(kicker.user).kills = kicker.kills;

    savedGame.players = savedGame.players.filter(player => player.user !== kickedUserId);
    savedGame.winner.id = '';

    await Games.set(interaction.guildId, savedGame);
    await KickedPlayers.set(interaction.guildId, kickedPlayers);
    await AllPlayers.set(interaction.guildId, allPlayers);

    interaction
      .reply({ content: 'تم طرد اللاعب من اللعبة.', ephemeral: true })
      .catch(console.error);
    interaction.channel
      .send(
        `💣 | <@${kickedUserId}> تم طرده من اللعبة، ستبدأ الجولة التالية قريبًا...`,
      )
      .catch(console.error);
    await startGame(interaction).catch(console.error);
  } catch (error) {
    console.error('Error handling kick player:', error);
    interaction.reply({ content: 'حدث خطأ أثناء طرد اللاعب.', ephemeral: true }).catch(console.error);
  }
}


async function handleAutoKick(interaction) {
  try {
    const savedGame = await Games.get(interaction.guildId);

    if (!savedGame) {
      interaction
        .reply({ content: 'لا توجد لعبة قيد التشغيل حاليًا في هذا السيرفر.', ephemeral: true })
        .catch(console.error);
      return;
    }

    if (interaction.user.id !== savedGame?.winner.id) {
      interaction
        .reply({
          content: 'ليس دورك في اللعبة، لذا لا يمكنك تنفيذ هذا الإجراء.',
          ephemeral: true,
        })
        .catch(console.error);
      return;
    }
    if (Date.now() > savedGame.winner.until) {
      interaction.reply({ content: 'لقد فاتك دورك.', ephemeral: true }).catch(console.error);
      return;
    }

    const randomPlayer = savedGame.players.find(
      player => player.user !== interaction.user.id && !player.shield,
    );
    if (!randomPlayer) {
      interaction
        .reply({ content: 'لا يوجد لاعبون لطردهم.', ephemeral: true })
        .catch(console.error);
      return;
    }

    const kickedPlayers = await KickedPlayers.get(interaction.guildId);
    const allPlayers = AllPlayers.get(interaction.guildId);

    kickedPlayers.players.push(randomPlayer);
    randomPlayer.deaths += 1;
    const kicker = savedGame.players.find(player => player.user === interaction.user.id);
    kicker.kills += 1;
    allPlayers.get(randomPlayer.user).deaths = randomPlayer.deaths;
    allPlayers.get(kicker.user).kills = kicker.kills;

    savedGame.players = savedGame.players.filter(player => player.user !== randomPlayer.user);
    savedGame.winner.id = '';

    await Games.set(interaction.guildId, savedGame);
    await KickedPlayers.set(interaction.guildId, kickedPlayers);
    await AllPlayers.set(interaction.guildId, allPlayers);

    interaction
      .reply({ content: 'تم طرد اللاعب تلقائيًا من اللعبة.', ephemeral: true })
      .catch(console.error);
    interaction.channel
      .send(
        `💣 | <@${randomPlayer.user}> تم طرده من اللعبة تلقائيًا، ستبدأ الجولة التالية قريبًا...`,
      )
      .catch(console.error);

    await startGame(interaction).catch(console.error);
  } catch (error) {
    console.error('Error handling auto kick:', error);
    interaction.reply({ content: 'حدث خطأ أثناء الطرد التلقائي.', ephemeral: true }).catch(console.error);
  }
}


async function handleWithdrawal(interaction) {
  try {
    const savedGame = await Games.get(interaction.guildId);

    if (!savedGame) {
      interaction
        .reply({ content: 'لا توجد لعبة قيد التشغيل حاليًا في هذا السيرفر.', ephemeral: true })
        .catch(console.error);
      return;
    }

    if (interaction.user.id !== savedGame?.winner.id) {
      interaction
        .reply({
          content: 'ليس دورك في اللعبة، لذا لا يمكنك تنفيذ هذا الإجراء.',
          ephemeral: true,
        })
        .catch(console.error);
      return;
    }
    if (Date.now() > savedGame.winner.until) {
      interaction.reply({ content: 'لقد فاتك دورك.', ephemeral: true }).catch(console.error);
      return;
    }

    savedGame.players = savedGame.players.filter(player => player.user !== interaction.user.id);
    savedGame.winner.id = '';

    await Games.set(interaction.guildId, savedGame);

    interaction
      .reply({ content: 'لقد انسحبت بنجاح من اللعبة.', ephemeral: true })
      .catch(console.error);
    interaction.channel
      .send(
        `💣 | <@${interaction.user.id}> انسحب من اللعبة، ستبدأ الجولة التالية قريبًا...`,
      )
      .catch(console.error);

    await startGame(interaction).catch(console.error);
  } catch (error) {
    console.error('Error handling withdrawal:', error);
    interaction.reply({ content: 'حدث خطأ أثناء الانسحاب من اللعبة.', ephemeral: true }).catch(console.error);
  }
}


async function handleReviveAction(interaction) {
  try {
    const savedGame = await Games.get(interaction.guildId);
    const kickedPlayers = await KickedPlayers.get(interaction.guildId);

    if (!savedGame) {
      interaction.reply({ content: 'لا توجد لعبة قيد التشغيل حاليًا في هذا السيرفر.', ephemeral: true }).catch(console.error);
      return;
    }

    if (interaction.user.id !== savedGame?.winner.id) {
      interaction.reply({
        content: 'ليس دورك في اللعبة، لذا لا يمكنك تنفيذ هذا الإجراء.',
        ephemeral: true,
      }).catch(console.error);
      return;
    }

    if (!kickedPlayers || !kickedPlayers.players.length) {
      interaction.reply({ content: 'لا يوجد لاعبون لإعادتهم.', ephemeral: true }).catch(console.error);
      return;
    }

    const currentPlayer = savedGame.players.find(player => player.user === interaction.user.id);

    if (currentPlayer.reviveUsed) {
      interaction.reply({
        content: 'يمكنك استخدام انعاش اللاعب مرة واحدة فقط في اللعبة.',
        ephemeral: true,
      }).catch(console.error);
      return;
    }

    const maxButtons = 21;
    const reviveButtons = kickedPlayers.players.slice(0, maxButtons).map(player =>
      new ButtonBuilder()
        .setCustomId(`select_player_revive_${player.user}`)
        .setLabel(`${player.buttonNumber} - ${player.username}`)
        .setStyle(ButtonStyle.Secondary)
    );

    const components = createButtonRows(reviveButtons);

    const message = await interaction.reply({
      content: 'اختر لاعبًا لإعادته:',
      components: components,
      ephemeral: true,
      fetchReply: true,
    });

    savedGame.actionData = {
      action: 'revive',
    };
    await Games.set(interaction.guildId, savedGame);

  } catch (error) {
    console.error('Error handling revive action:', error);
    interaction.reply({ content: 'حدث خطأ أثناء تنفيذ إجراء الإحياء.', ephemeral: true }).catch(console.error);
  }
}


async function handleSelectPlayer(interaction) {
  try {
    const [action, userId] = interaction.customId.split('_').slice(2);
    const savedGame = await Games.get(interaction.guildId);

    if (!savedGame) {
      interaction.reply({ content: 'لا توجد لعبة قيد التشغيل حاليًا في هذا السيرفر.', ephemeral: true }).catch(console.error);
      return;
    }

    if (interaction.user.id !== savedGame.winner.id) {
      interaction.reply({ content: 'ليس دورك في اللعبة، لذا لا يمكنك تنفيذ هذا الإجراء.', ephemeral: true }).catch(console.error);
      return;
    }

    switch (action) {
      case 'revive':
        await revivePlayer(interaction, userId);
        break;
      case 'shield':
        await shieldPlayer(interaction, userId);
        break;
      case 'switch':
        await switchPlayer(interaction, userId);
        break;
      case 'freeze':
        await freezePlayer(interaction, userId);
        break;
      default:
        interaction.reply({ content: 'إجراء غير معروف.', ephemeral: true }).catch(console.error);
    }
  } catch (error) {
    console.error('Error handling select player:', error);
    interaction.reply({ content: 'حدث خطأ أثناء تنفيذ الإجراء.', ephemeral: true }).catch(console.error);
  }
}


async function revivePlayer(interaction, userId) {
  try {
    const savedGame = await Games.get(interaction.guildId);
    const kickedPlayers = await KickedPlayers.get(interaction.guildId);
    const allPlayers = AllPlayers.get(interaction.guildId);

    const currentPlayer = savedGame.players.find(player => player.user === interaction.user.id);

    if (currentPlayer.reviveUsed) {
      interaction.reply({
        content: 'يمكنك استخدام انعاش اللاعب مرة واحدة فقط في اللعبة.',
        ephemeral: true,
      }).catch(console.error);
      return;
    }

    const playerToRevive = kickedPlayers.players.find(player => player.user === userId);

    if (!playerToRevive) {
      interaction.reply({ content: 'هذا اللاعب غير موجود في قائمة المطرودين.', ephemeral: true }).catch(console.error);
      return;
    }

    kickedPlayers.players = kickedPlayers.players.filter(player => player.user !== userId);
    savedGame.players.push(playerToRevive);
    savedGame.winner.id = '';
    currentPlayer.reviveUsed = true;

    allPlayers.get(playerToRevive.user).reviveUsed = true;

    await Games.set(interaction.guildId, savedGame);
    await KickedPlayers.set(interaction.guildId, kickedPlayers);
    await AllPlayers.set(interaction.guildId, allPlayers);

    interaction
      .reply({
        content: `تم إحياء اللاعب ${playerToRevive.username} بنجاح وإعادته إلى اللعبة.`,
        ephemeral: true,
      })
      .catch(console.error);
    interaction.channel
      .send(
        `💖 | <@${playerToRevive.user}> تم إحياؤه وإعادته إلى اللعبة، ستبدأ الجولة التالية قريبًا...`,
      )
      .catch(console.error);

    await startGame(interaction).catch(console.error);
  } catch (error) {
    console.error('Error reviving player:', error);
    interaction.reply({ content: 'حدث خطأ أثناء إحياء اللاعب.', ephemeral: true }).catch(console.error);
  }
}


async function handleProtectYourself(interaction) {
  try {
    const savedGame = await Games.get(interaction.guildId);

    if (!savedGame) {
      interaction
        .reply({ content: 'لا توجد لعبة قيد التشغيل حاليًا في هذا السيرفر.', ephemeral: true })
        .catch(console.error);
      return;
    }

    if (interaction.user.id !== savedGame?.winner.id) {
      interaction
        .reply({
          content: 'ليس دورك في اللعبة، لذا لا يمكنك تنفيذ هذا الإجراء.',
          ephemeral: true,
        })
        .catch(console.error);
      return;
    }

    const currentPlayer = savedGame.players.find(player => player.user === interaction.user.id);

    if (currentPlayer.shieldUsed) {
      interaction
        .reply({ content: 'يمكنك استخدام حماية نفسك مرة واحدة فقط في اللعبة.', ephemeral: true })
        .catch(console.error);
      return;
    }

    const maxButtons = 21;
    const shieldButtons = savedGame.players.slice(0, maxButtons).map(player =>
      new ButtonBuilder()
        .setCustomId(`select_player_shield_${player.user}`)
        .setLabel(`${player.buttonNumber} - ${player.username}`)
        .setStyle(ButtonStyle.Secondary)
    );

    const components = createButtonRows(shieldButtons);

    const message = await interaction.reply({
      content: 'اختر لاعبًا لتمنحه الحماية:',
      components: components,
      ephemeral: true,
      fetchReply: true,
    });

    savedGame.actionData = {
      action: 'shield',
    };
    await Games.set(interaction.guildId, savedGame);
  } catch (error) {
    console.error('Error handling protect action:', error);
    interaction.reply({ content: 'حدث خطأ أثناء تنفيذ إجراء الحماية.', ephemeral: true }).catch(console.error);
  }
}


async function shieldPlayer(interaction, userId) {
  try {
    const savedGame = await Games.get(interaction.guildId);
    const allPlayers = AllPlayers.get(interaction.guildId);

    const currentPlayer = savedGame.players.find(player => player.user === interaction.user.id);

    if (currentPlayer.shieldUsed) {
      interaction
        .reply({ content: 'يمكنك استخدام حماية نفسك مرة واحدة فقط في اللعبة.', ephemeral: true })
        .catch(console.error);
      return;
    }

    const playerToShield = savedGame.players.find(player => player.user === userId);

    if (!playerToShield) {
      interaction
        .reply({ content: 'لا يوجد لاعب بهذا الاسم في اللعبة.', ephemeral: true })
        .catch(console.error);
      return;
    }

    playerToShield.shield = true;
    currentPlayer.shieldUsed = true;

    allPlayers.get(playerToShield.user).shieldUsed = true;

    await Games.set(interaction.guildId, savedGame);
    await AllPlayers.set(interaction.guildId, allPlayers);

    interaction
      .reply({
        content: `تم منح الحماية بنجاح للاعب ${playerToShield.username}.`,
        ephemeral: true,
      })
      .catch(console.error);
    interaction.channel
      .send(`🛡️ | <@${playerToShield.user}> تم منحه الحماية للدور القادم.`)
      .catch(console.error);

    savedGame.winner.id = '';
    await Games.set(interaction.guildId, savedGame);
    await startGame(interaction).catch(console.error);
  } catch (error) {
    console.error('Error shielding player:', error);
    interaction.reply({ content: 'حدث خطأ أثناء منح الحماية.', ephemeral: true }).catch(console.error);
  }
}


async function handleSwitchTurn(interaction) {
  try {
    const savedGame = await Games.get(interaction.guildId);

    if (!savedGame) {
      interaction
        .reply({ content: 'لا توجد لعبة قيد التشغيل حاليًا في هذا السيرفر.', ephemeral: true })
        .catch(console.error);
      return;
    }

    if (interaction.user.id !== savedGame?.winner.id) {
      interaction
        .reply({
          content: 'ليس دورك في اللعبة، لذا لا يمكنك تنفيذ هذا الإجراء.',
          ephemeral: true,
        })
        .catch(console.error);
      return;
    }

    const currentPlayer = savedGame.players.find(player => player.user === interaction.user.id);

    if (currentPlayer.switchUsed) {
      interaction
        .reply({
          content: 'يمكنك تبديل دورك مرة واحدة فقط في اللعبة.',
          ephemeral: true,
        })
        .catch(console.error);
      return;
    }

    const maxButtons = 21;
    const switchButtons = savedGame.players
      .filter(player => player.user !== interaction.user.id)
      .slice(0, maxButtons)
      .map(player =>
        new ButtonBuilder()
          .setCustomId(`select_player_switch_${player.user}`)
          .setLabel(`${player.buttonNumber} - ${player.username}`)
          .setStyle(ButtonStyle.Secondary)
      );

    const components = createButtonRows(switchButtons);

    const message = await interaction.reply({
      content: 'اختر لاعبًا لتبديل دورك معه:',
      components: components,
      ephemeral: true,
      fetchReply: true,
    });

    savedGame.actionData = {
      action: 'switch',
    };
    await Games.set(interaction.guildId, savedGame);
  } catch (error) {
    console.error('Error handling switch turn action:', error);
    interaction.reply({ content: 'حدث خطأ أثناء تنفيذ إجراء تبديل الدور.', ephemeral: true }).catch(console.error);
  }
}


async function switchPlayer(interaction, userId) {
  try {
    const savedGame = await Games.get(interaction.guildId);
    const allPlayers = AllPlayers.get(interaction.guildId);

    const currentPlayer = savedGame.players.find(player => player.user === interaction.user.id);

    if (currentPlayer.switchUsed) {
      interaction
        .reply({
          content: 'يمكنك تبديل دورك مرة واحدة فقط في اللعبة.',
          ephemeral: true,
        })
        .catch(console.error);
      return;
    }

    const playerToSwitch = savedGame.players.find(player => player.user === userId);

    if (!playerToSwitch) {
      interaction
        .reply({ content: 'لا يوجد لاعب بهذا الاسم في اللعبة.', ephemeral: true })
        .catch(console.error);
      return;
    }

    savedGame.winner.id = playerToSwitch.user;
    savedGame.winner.until = Date.now() + getRouletteSettings().chooseTimeout * 1000;

    currentPlayer.switchUsed = true;
    allPlayers.get(interaction.user.id).switchUsed = true;

    await AllPlayers.set(interaction.guildId, allPlayers);
    await Games.set(interaction.guildId, savedGame);

    interaction
      .reply({
        content: `تم تبديل دورك مع اللاعب ${playerToSwitch.username}.`,
        ephemeral: true,
      })
      .catch(console.error);
    interaction.channel
      .send(
        `🔄 | <@${interaction.user.id}> قام بتبديل دوره مع <@${playerToSwitch.user}>. لديك ${getRouletteSettings().chooseTimeout} ثانية للاختيار!`,
      )
      .catch(console.error);

    setTimeout(async () => {
      try {
        const checkUser = await Games.get(interaction.guildId);
        if (
          checkUser &&
          checkUser.winner.id === playerToSwitch.user &&
          Date.now() >= checkUser.winner.until
        ) {
          checkUser.players = checkUser.players.filter(player => player.user !== playerToSwitch.user);
          checkUser.winner.id = '';

          await Games.set(interaction.guildId, checkUser);

          interaction.channel
            .send(
              `⏰ | <@${playerToSwitch.user}> تم طرده من اللعبة بسبب انتهاء الوقت. ستبدأ الجولة التالية قريبًا...`,
            )
            .catch(console.error);

          await startGame(interaction).catch(console.error);
        }
      } catch (error) {
        console.error('Error during switch turn timeout:', error);
      }
    }, getRouletteSettings().chooseTimeout * 1000);
  } catch (error) {
    console.error('Error switching player turn:', error);
    interaction.reply({ content: 'حدث خطأ أثناء تبديل الدور.', ephemeral: true }).catch(console.error);
  }
}


async function handleFreezeAction(interaction) {
  try {
    const savedGame = await Games.get(interaction.guildId);

    if (!savedGame) {
      interaction.reply({ content: 'لا توجد لعبة قيد التشغيل حاليًا في هذا السيرفر.', ephemeral: true }).catch(console.error);
      return;
    }

    if (interaction.user.id !== savedGame?.winner.id) {
      interaction.reply({
        content: 'ليس دورك في اللعبة، لذا لا يمكنك تنفيذ هذا الإجراء.',
        ephemeral: true,
      }).catch(console.error);
      return;
    }

    const currentPlayer = savedGame.players.find(player => player.user === interaction.user.id);

    if (currentPlayer.freezeUsed) {
      interaction.reply({
        content: 'يمكنك استخدام تجميد لاعب مرة واحدة فقط في اللعبة.',
        ephemeral: true,
      }).catch(console.error);
      return;
    }

    const maxButtons = 21;
    const freezeButtons = savedGame.players
      .filter(player => player.user !== interaction.user.id)
      .slice(0, maxButtons)
      .map(player =>
        new ButtonBuilder()
          .setCustomId(`select_player_freeze_${player.user}`)
          .setLabel(`${player.buttonNumber} - ${player.username}`)
          .setStyle(ButtonStyle.Secondary)
      );

    const components = createButtonRows(freezeButtons);

    const message = await interaction.reply({
      content: 'اختر لاعبًا لتجميده:',
      components: components,
      ephemeral: true,
      fetchReply: true,
    });

    savedGame.actionData = {
      action: 'freeze',
    };
    await Games.set(interaction.guildId, savedGame);
  } catch (error) {
    console.error('Error handling freeze action:', error);
    interaction.reply({ content: 'حدث خطأ أثناء تنفيذ إجراء التجميد.', ephemeral: true }).catch(console.error);
  }
}


async function freezePlayer(interaction, userId) {
  try {
    const savedGame = await Games.get(interaction.guildId);
    const allPlayers = AllPlayers.get(interaction.guildId);

    const currentPlayer = savedGame.players.find(player => player.user === interaction.user.id);

    if (currentPlayer.freezeUsed) {
      interaction.reply({
        content: 'يمكنك استخدام تجميد لاعب مرة واحدة فقط في اللعبة.',
        ephemeral: true,
      }).catch(console.error);
      return;
    }

    const playerToFreeze = savedGame.players.find(player => player.user === userId);

    if (!playerToFreeze) {
      interaction.reply({ content: 'لا يوجد لاعب بهذا الاسم في اللعبة.', ephemeral: true }).catch(console.error);
      return;
    }

    playerToFreeze.frozen = true;
    currentPlayer.freezeUsed = true;
    allPlayers.get(playerToFreeze.user).frozen = true;
    allPlayers.get(interaction.user.id).freezeUsed = true;

    await Games.set(interaction.guildId, savedGame);
    await AllPlayers.set(interaction.guildId, allPlayers);

    interaction.reply({
      content: `تم تجميد قدرات اللاعب ${playerToFreeze.username} لدوره القادم.`,
      ephemeral: true,
    }).catch(console.error);

    interaction.channel.send(`❄️ | <@${playerToFreeze.user}> تم تجميد قدراته للدور القادم.`).catch(console.error);

    savedGame.winner.id = '';
    await Games.set(interaction.guildId, savedGame);
    await startGame(interaction).catch(console.error);
  } catch (error) {
    console.error('Error freezing player:', error);
    interaction.reply({ content: 'حدث خطأ أثناء تجميد اللاعب.', ephemeral: true }).catch(console.error);
  }
}


async function handlePagination(interaction) {
}


async function startGame(source, start = false) {
  try {
    const guildId = source.guildId || source.guild.id;
    const savedData = await Games.get(guildId);

    if (!savedData) {
      return;
    }

    const { players } = savedData;
    if (players.length === 0) {
      await sleep(5);
      source.channel
        .send({ content: ':x: تم إلغاء اللعبة: لا يوجد لاعبون.' })
        .catch(console.error);
      await cleanUpGame(guildId);
      return;
    }
    if (start) {
      await source.channel
        .send({
          content: '✅ | تم توزيع الأرقام على كل لاعب. ستبدأ الجولة الأولى في غضون ثوانٍ قليلة...',
        })
        .catch(console.error);
    }
    await sleep(getRouletteSettings().timeBetweenRounds);
    const colorsGradient = ['#32517f', '#4876a3', '#5d8ec7', '#74a6eb', '#8ac0ff'];

    const options = players.map((user, index) => ({
      user: user,
      label: user.username,
      color: colorsGradient[index % colorsGradient.length],
    }));

    const winnerOption = options[Math.floor(Math.random() * options.length)];
    const winnerIndex = options.indexOf(winnerOption);
    options[winnerIndex] = {
      ...winnerOption,
      winner: true,
    };

    const time = Date.now() + getRouletteSettings().chooseTimeout * 1000;
    savedData.winner = { id: winnerOption.user.user, until: time };
    await Games.set(guildId, savedData);
    const image = await createWheel(options, winnerOption.user.avatar);

    const kickablePlayers = players.filter(user => user.user !== winnerOption.user.user);

    const kickButtons = kickablePlayers.map(player =>
      new ButtonBuilder()
        .setCustomId(`kick_${player.user}`)
        .setLabel(`${player.buttonNumber} - ${player.username}`)
        .setStyle(toButtonStyle(getRouletteSettings().kickButtonColor, ButtonStyle.Secondary))
        .setDisabled(player.shield)
    );

    const kickButtonPages = paginateButtons(kickButtons, 'kick');

    const currentPlayer = players.find(player => player.user === winnerOption.user.user);

    const actionButtons = [
      new ButtonBuilder()
        .setCustomId('auto_kick')
        .setLabel('طرد تلقائي')
        .setStyle(toButtonStyle(getRouletteSettings().actionButtonColor, ButtonStyle.Primary))
        .setDisabled(currentPlayer.frozen),
      new ButtonBuilder()
        .setCustomId('revive_player')
        .setLabel('انعاش اللاعب')
        .setStyle(toButtonStyle(getRouletteSettings().actionButtonColor, ButtonStyle.Success))
        .setDisabled(currentPlayer.frozen || currentPlayer.reviveUsed),
      new ButtonBuilder()
        .setCustomId('protect_player')
        .setLabel('حماية لاعب')
        .setStyle(toButtonStyle(getRouletteSettings().actionButtonColor, ButtonStyle.Primary))
        .setDisabled(currentPlayer.frozen || currentPlayer.shieldUsed),
      new ButtonBuilder()
        .setCustomId('switch_turn')
        .setLabel('تبادل دور')
        .setStyle(toButtonStyle(getRouletteSettings().actionButtonColor, ButtonStyle.Secondary))
        .setDisabled(currentPlayer.frozen || currentPlayer.switchUsed),
      new ButtonBuilder()
        .setCustomId('freeze_player')
        .setLabel('تجميد لاعب')
        .setStyle(toButtonStyle(getRouletteSettings().actionButtonColor, ButtonStyle.Success))
        .setDisabled(currentPlayer.frozen || currentPlayer.freezeUsed),
      new ButtonBuilder()
        .setCustomId('withdrawal')
        .setLabel('انسحاب')
        .setStyle(toButtonStyle(getRouletteSettings().actionButtonColor, ButtonStyle.Danger)),
    ];

    const attachment = new AttachmentBuilder(image, { name: 'wheel.png' });

    if (players.length <= 2) {
      const finalEmbed = new EmbedBuilder()
        .setColor(getRouletteSettings().embedColor)
        .setDescription(`**${winnerOption.user.buttonNumber} - <@${winnerOption.user.user}> **\n:crown: هذه هي الجولة الأخيرة! اللاعب المختار هو الفائز في اللعبة.`)
        .setImage('attachment://wheel.png');
      await source.channel
        .send({
          embeds: [finalEmbed],
          files: [attachment],
        })
        .catch(console.error);

      await cleanUpGame(guildId);
      return;
    } else {
      const roundEmbed = new EmbedBuilder()
        .setColor(getRouletteSettings().embedColor)
        .setDescription(`**${winnerOption.user.buttonNumber} - <@${winnerOption.user.user}> **\n⏰ | لديك ${getRouletteSettings().chooseTimeout} ثانية لاختيار لاعب للطرد`)
        .setImage('attachment://wheel.png');
      const message = await source.channel
        .send({
          embeds: [roundEmbed],
          files: [attachment],
          components: kickButtonPages[0],
        })
        .catch(console.error);

      savedData.pagination = {
        messageId: message.id,
        page: 0,
        totalPages: kickButtonPages.length,
        buttonsType: 'kick',
        buttons: kickButtons,
      };
      savedData.actionButtons = actionButtons;
      await Games.set(guildId, savedData);

      const actionRows = createActionRowFromButtons(actionButtons);

      const actionMessage = await source.channel.send({
        content: `**خيارات إضافية لـ <@${winnerOption.user.user}> **`,
        components: actionRows,
      });

      savedData.actionMessageId = actionMessage.id;
      await Games.set(guildId, savedData);

      setTimeout(async () => {
        try {
          const checkUser = await Games.get(guildId);
          if (
            checkUser &&
            checkUser.winner.id === winnerOption.user.user &&
            Date.now() >= checkUser.winner.until
          ) {
            checkUser.players = checkUser.players.filter(
              player => player.user !== winnerOption.user.user,
            );
            checkUser.winner.id = '';

            await Games.set(guildId, checkUser);

            source.channel
              .send(
                `⏰ | <@${winnerOption.user.user}> تم طرده من اللعبة بسبب انتهاء الوقت. ستبدأ الجولة التالية قريبًا...`,
              )
              .catch(console.error);

            await startGame(source).catch(console.error);
          }
        } catch (error) {
          console.error('Error during timeout handling:', error);
        }
      }, getRouletteSettings().chooseTimeout * 1000);
    }

    if (currentPlayer.frozen) {
      currentPlayer.frozen = false;
      await Games.set(guildId, savedData);
    }

    savedData.players.forEach(player => {
      if (player.shield) {
        player.shield = false;
      }
    });
    await Games.set(guildId, savedData);
  } catch (error) {
    console.error('Error during game execution:', error);
    source.channel
      .send({ content: 'حدث خطأ أثناء تشغيل اللعبة. يرجى المحاولة مرة أخرى.' })
      .catch(console.error);
  }
}


function paginateButtons(buttons, buttonsType) {
  const maxButtonsPerRow = 5;
  const maxActionRows = 4;
  const buttonsPerPage = maxButtonsPerRow * maxActionRows;

  const totalPages = Math.ceil(buttons.length / buttonsPerPage);
  const pages = [];

  for (let i = 0; i < totalPages; i++) {
    const pageButtons = buttons.slice(i * buttonsPerPage, (i + 1) * buttonsPerPage);
    const components = [];

    let actionRow = new ActionRowBuilder();
    pageButtons.forEach((button, index) => {
      if (index % maxButtonsPerRow === 0 && index !== 0) {
        components.push(actionRow);
        actionRow = new ActionRowBuilder();
      }
      actionRow.addComponents(button);
    });
    if (actionRow.components.length > 0) {
      components.push(actionRow);
    }

    if (totalPages > 1) {
      const navigationRow = new ActionRowBuilder();
      const previousButton = new ButtonBuilder()
        .setCustomId(`paginate_${buttonsType}_previous`)
        .setLabel('السابق')
        .setStyle(toButtonStyle(getRouletteSettings().paginationButtonColor, ButtonStyle.Primary))
        .setDisabled(i === 0);

      const nextButton = new ButtonBuilder()
        .setCustomId(`paginate_${buttonsType}_next`)
        .setLabel('التالي')
        .setStyle(toButtonStyle(getRouletteSettings().paginationButtonColor, ButtonStyle.Primary))
        .setDisabled(i === totalPages - 1);

      navigationRow.addComponents(previousButton, nextButton);
      components.push(navigationRow);
    }

    pages.push(components);
  }

  return pages;
}


function createActionRowFromButtons(buttons) {
  const components = [];
  const maxButtonsPerRow = 5;

  let actionRow = new ActionRowBuilder();
  for (let i = 0; i < buttons.length; i++) {
    if (actionRow.components.length >= maxButtonsPerRow) {
      components.push(actionRow);
      actionRow = new ActionRowBuilder();
    }
    actionRow.addComponents(buttons[i]);
  }
  if (actionRow.components.length > 0) {
    components.push(actionRow);
  }

  return components;
}


async function cleanUpGame(guildId) {
  try {
    await Games.delete(guildId);
    await KickedPlayers.delete(guildId);
    await AllPlayers.delete(guildId);
  } catch (error) {
    console.error('Error cleaning up game:', error);
  }
}


function isRouletteButton(interaction) {
  const id = interaction?.customId || '';
  return id === 'join_roulette' || id === 'leave_roulette' || id === 'auto_kick' ||
    id === 'withdrawal' || id === 'revive_player' || id === 'protect_player' ||
    id === 'switch_turn' || id === 'freeze_player' || id.startsWith('kick_') ||
    id.startsWith('revive_player') || id.startsWith('protect_player') ||
    id.startsWith('select_player_') || id.startsWith('paginate_');
}

async function handleRouletteButton(interaction) {
  if (!isRouletteButton(interaction)) return false;
  await handleButtonInteraction(interaction);
  return true;
}

module.exports = { startRouletteGame, handleRouletteButton, isRouletteButton, setRouletteConfigGetter };
