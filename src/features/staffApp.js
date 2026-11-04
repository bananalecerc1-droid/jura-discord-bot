'use strict';
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ComponentType, MessageFlags
} = require('discord.js');
const { COMPONENTS_V2_FLAG, updateComponentV2Components } = require('../../componentV2.js');

// ─── Per-user application lock (prevents button-spam duplicate DM sessions) ──
const _inProgress = new Set();

/** Default questions used when none are configured */
const DEFAULT_QUESTIONS = [
  '📛 ما اسمك الكامل؟',
  '🎂 كم عمرك؟',
  '⚥ ما جنسك؟ (ذكر / أنثى)',
  '🌍 من أي دولة أنت؟',
  '📋 ما خبرتك وكيف يمكنك مساعدة السيرفر؟',
];

// ─── DM Question flow ─────────────────────────────────────────────────────────
/** Ask DM questions one by one. Questions = array of label strings. Returns {q0,q1,...} or null. */
async function askDM(user, introText, questions) {
  let dm;
  try { dm = await user.createDM(); }
  catch { return null; }

  try {
    await dm.send(`${introText}\n\n*(سيتم إلغاء التقديم تلقائياً إذا لم تردّ خلال **5 دقائق** على كل سؤال)*`);
  } catch { return null; }

  const answers = {};
  for (let i = 0; i < questions.length; i++) {
    const label = questions[i];
    try {
      await dm.send(`**${i + 1}/${questions.length}** — ${label}`);
      const collected = await dm.awaitMessages({
        filter: m => !m.author.bot,
        max: 1,
        time: 5 * 60_000,
        errors: ['time'],
      });
      answers[`q${i}`] = collected.first().content.trim().slice(0, 500);
    } catch {
      await dm.send('⏱️ انتهى الوقت. يُرجى المحاولة مرة أخرى من خلال زر التقديم.').catch(() => {});
      return null;
    }
  }

  return answers; // success message shown after confirmation
}

// ─── Confirmation step ────────────────────────────────────────────────────────
/**
 * Show a summary embed of all answers, let the user confirm or pick a
 * question to re-answer. Loops until confirmed or timed-out.
 * Returns true = confirmed, false = timed-out / aborted.
 */
async function askConfirmation(dm, user, questions, answers) {
  const CONFIRM_YES  = `sa_conf_yes_${user.id}`;
  const CONFIRM_EDIT = `sa_conf_edit_${user.id}`;
  const SELECT_Q     = `sa_sel_${user.id}`;

  while (true) {
    // Build review embed
    const fields = questions.map((q, i) => ({
      name: q.slice(0, 256),
      value: (answers[`q${i}`] || '—').slice(0, 1024),
      inline: false,
    }));

    const reviewEmbed = new EmbedBuilder()
      .setTitle('📋 مراجعة إجاباتك')
      .setDescription('راجع إجاباتك أدناه — هل أنت متأكد من خياراتك؟')
      .setColor(0x2563eb)
      .addFields(fields.slice(0, 25)); // Discord limit

    const btnRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CONFIRM_EDIT)
        .setLabel('لا، تعديل')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CONFIRM_YES)
        .setLabel('نعم، متأكد ✅')
        .setStyle(ButtonStyle.Success),
    );

    const reviewMsg = await dm.send({ embeds: [reviewEmbed], components: [btnRow] });

    // Wait for button press
    let btnInt;
    try {
      btnInt = await reviewMsg.awaitMessageComponent({
        filter: i => i.user.id === user.id &&
                     [CONFIRM_YES, CONFIRM_EDIT].includes(i.customId),
        componentType: ComponentType.Button,
        time: 5 * 60_000,
      });
    } catch {
      await dm.send('⏱️ انتهى الوقت. يُرجى المحاولة مرة أخرى من خلال زر التقديم.').catch(() => {});
      return false;
    }

    await btnInt.deferUpdate().catch(() => {});

    if (btnInt.customId === CONFIRM_YES) return true; // ✅ done

    // ── Edit branch: show select menu ────────────────────────────────────────
    const options = questions.slice(0, 25).map((q, i) => ({
      label: q.replace(/^[\p{Emoji}\s]+/u, '').trim().slice(0, 100) || `سؤال ${i + 1}`,
      description: (answers[`q${i}`] || '—').slice(0, 100),
      value: String(i),
    }));

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(SELECT_Q)
        .setPlaceholder('اختر السؤال الذي تريد تعديل إجابته')
        .addOptions(options),
    );

    const selectMsg = await dm.send({
      content: '✏️ **اختر السؤال الذي تريد إعادة الإجابة عليه:**',
      components: [selectRow],
    });

    let selInt;
    try {
      selInt = await selectMsg.awaitMessageComponent({
        filter: i => i.user.id === user.id && i.customId === SELECT_Q,
        componentType: ComponentType.StringSelect,
        time: 5 * 60_000,
      });
    } catch {
      await dm.send('⏱️ انتهى الوقت. يُرجى المحاولة مرة أخرى من خلال زر التقديم.').catch(() => {});
      return false;
    }

    await selInt.deferUpdate().catch(() => {});

    const idx = parseInt(selInt.values[0], 10);
    await dm.send(`✏️ **أعد الإجابة على:** ${questions[idx]}`);

    try {
      const collected = await dm.awaitMessages({
        filter: m => m.author.id === user.id,
        max: 1,
        time: 5 * 60_000,
        errors: ['time'],
      });
      answers[`q${idx}`] = collected.first().content.trim().slice(0, 500);
    } catch {
      await dm.send('⏱️ انتهى الوقت. يُرجى المحاولة مرة أخرى من خلال زر التقديم.').catch(() => {});
      return false;
    }

    // Disable stale select menu before looping back
    await selectMsg.edit({ components: [] }).catch(() => {});
    // loop → show confirmation embed again with updated answer
  }
}

/** Send the application result embed to the review channel. Returns true on success. */
async function sendToReview(guild, reviewChannelId, applicant, answers, questions) {
  const channel = await guild.channels.fetch(reviewChannelId).catch(() => null);
  if (!channel) return false;

  // Build answer fields dynamically from the questions used
  const questionLabels = questions?.length ? questions : DEFAULT_QUESTIONS;
  const answerFields = questionLabels.map((label, i) => {
    return {
      name: `🔹 ${label.slice(0, 250)}`,
      value: `\`\`\`\n${(answers[`q${i}`] || '—').slice(0, 1000)}\n\`\`\``,
      inline: false,
    };
  });

  const embed = new EmbedBuilder()
    .setTitle('📋 طلب انضمام جديد للإدارة')
    .setColor(0x5865f2)
    .setThumbnail(applicant.displayAvatarURL({ size: 128 }))
    .setDescription(`👤 **المتقدم:** <@${applicant.id}>\n🆔 **الأيدي:** \`${applicant.id}\`\n🏷️ **التاغ:** \`${applicant.tag}\``)
    .addFields(answerFields)
    .setFooter({ text: 'نظام التقديمات', iconURL: guild.iconURL() });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`staff_accept_${applicant.id}`)
      .setLabel('✅ قبول')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`staff_reject_${applicant.id}`)
      .setLabel('❌ رفض')
      .setStyle(ButtonStyle.Danger),
  );

  await channel.send({ embeds: [embed], components: [row] });
  return true;
}

/**
 * Called when a user clicks "تقديم" on the public embed.
 * Starts the DM flow.
 */
async function handleApplicationStart(interaction, loadConfig) {
  const cfg = loadConfig().staffApp;
  if (!cfg?.enabled) {
    return interaction.reply({ content: '❌ التقديم مغلق حالياً.', flags: MessageFlags.Ephemeral });
  }

  // Per-user lock — prevent spam / duplicate sessions
  const uid = interaction.user.id;
  if (_inProgress.has(uid)) {
    return interaction.reply({ content: '⏳ لديك تقديم جارٍ حالياً في رسائلك الخاصة. أكمل الإجابة أو انتظر انتهاء الجلسة.', flags: MessageFlags.Ephemeral });
  }
  _inProgress.add(uid);

  // A DM check can take longer than Discord's 3-second initial-response
  // window. Acknowledge the button immediately, then edit the reply.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Test DM ability before promising success to user
  let dm;
  try { dm = await interaction.user.createDM(); await dm.send('\u200b'); }
  catch {
    _inProgress.delete(uid);
    return interaction.editReply({ content: '❌ لا يمكن إرسال رسالة خاصة إليك. تأكد أن رسائلك الخاصة مفتوحة ثم حاول مجدداً.' });
  }

  await interaction.editReply({ content: '📩 تم إرسال الأسئلة إليك عبر الرسائل الخاصة. تحقق من بريدك في ديسكورد!' });

  const introText = cfg.dmIntro || '👋 مرحباً! يسعدنا تقديمك لفريق الإدارة. سأسألك بعض الأسئلة الآن:';
  const questions = cfg.questions?.length ? cfg.questions : DEFAULT_QUESTIONS;
  let answers;
  let confirmed = false;
  try {
    answers = await askDM(interaction.user, introText, questions);
    if (answers) {
      const dmCh = await interaction.user.createDM();
      confirmed = await askConfirmation(dmCh, interaction.user, questions, answers);
    }
  } finally {
    _inProgress.delete(uid);
  }

  if (!confirmed) return; // timed out, cancelled, or not confirmed

  const guild = interaction.guild;
  const reviewChannelId = cfg.reviewChannelId;
  if (!reviewChannelId) {
    await interaction.user.send('✅ **تم إرسال تقديمك بنجاح!** سيتم مراجعته من قِبل الإدارة قريباً. شكراً لك 🙏').catch(() => {});
    return;
  }

  const sent = await sendToReview(guild, reviewChannelId, interaction.user, answers, questions);
  if (sent) {
    await interaction.user.send('✅ **تم إرسال تقديمك بنجاح!** سيتم مراجعته من قِبل الإدارة قريباً. شكراً لك 🙏').catch(() => {});
  } else {
    await interaction.user.send('✅ تم تسجيل تقديمك — سيتم التواصل معك قريباً.').catch(() => {});
  }
}

/**
 * Called when admin clicks Accept / Reject button in review channel.
 * Requires ManageGuild or ManageRoles permission on the clicker.
 */
async function handleApplicationDecision(interaction, loadConfig, decision) {
  // ── Authorization: only users with ManageGuild or ManageRoles may decide ──
  const { PermissionFlagsBits } = require('discord.js');
  const member = interaction.member;
  const canDecide = member.permissions.has(PermissionFlagsBits.ManageGuild) ||
                    member.permissions.has(PermissionFlagsBits.ManageRoles);
  if (!canDecide) {
    return interaction.reply({ content: '❌ ليس لديك صلاحية للبت في التقديمات.', flags: MessageFlags.Ephemeral });
  }

  // Member fetches and role operations can exceed Discord's 3-second
  // interaction window, so acknowledge the decision before doing them.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const cfg = loadConfig().staffApp;
  const applicantId = interaction.customId.replace(`staff_${decision}_`, '');

  const guild = interaction.guild;
  let applicantMember;
  try { applicantMember = await guild.members.fetch(applicantId); }
  catch {
    return interaction.editReply({ content: '❌ لم أتمكن من إيجاد العضو في السيرفر.' });
  }

  // Preserve the review message permanently. The decision update below edits
  // the existing message in one request and disables both buttons; it never
  // deletes the application embed or its applicant answers.
  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('staff_accept_done').setLabel('✅ قُبِل').setStyle(ButtonStyle.Success).setDisabled(true),
    new ButtonBuilder().setCustomId('staff_reject_done').setLabel('❌ رُفِض').setStyle(ButtonStyle.Danger).setDisabled(true),
  );

  if (decision === 'accept') {
    // Give role if configured
    const roleId = cfg.acceptRoleId;
    if (roleId) {
      try { await applicantMember.roles.add(roleId); } catch {}
    }

    // DM applicant
    const acceptMsg = cfg.acceptMessage || '🎉 تهانينا! تم **قبول** تقديمك في فريق الإدارة. مرحباً بك في الفريق! 🌟';
    try { await applicantMember.send(acceptMsg); } catch {}

    await interaction.editReply({ content: `✅ تم قبول <@${applicantId}> وإشعاره.` });

    // Update embed colour to green
    try {
      const oldEmbed = interaction.message.embeds[0];
      if (oldEmbed) {
        const updated = EmbedBuilder.from(oldEmbed).setColor(0x57f287).setTitle('✅ ' + oldEmbed.title);
        await interaction.message.edit({ embeds: [updated], components: [disabledRow] });
      } else {
        await interaction.message.edit({
          components: updateComponentV2Components(interaction.message.components, {
            accentColor: 0x57f287,
            heading: '✅ التقديم لفريق الإدارة',
          }),
          flags: COMPONENTS_V2_FLAG,
        });
      }
    } catch {}

  } else {
    // DM applicant
    const rejectMsg = cfg.rejectMessage || '😔 نأسف لإعلامك بأنه تم **رفض** تقديمك في فريق الإدارة في الوقت الحالي. نتمنى لك التوفيق!';
    try { await applicantMember.send(rejectMsg); } catch {}

    await interaction.editReply({ content: `❌ تم رفض تقديم <@${applicantId}> وإشعاره.` });

    // Update embed colour to red
    try {
      const oldEmbed = interaction.message.embeds[0];
      if (oldEmbed) {
        const updated = EmbedBuilder.from(oldEmbed).setColor(0xed4245).setTitle('❌ ' + oldEmbed.title);
        await interaction.message.edit({ embeds: [updated], components: [disabledRow] });
      } else {
        await interaction.message.edit({
          components: updateComponentV2Components(interaction.message.components, {
            accentColor: 0xed4245,
            heading: '❌ التقديم لفريق الإدارة',
          }),
          flags: COMPONENTS_V2_FLAG,
        });
      }
    } catch {}
  }
}

/**
 * Send the public application embed with button to a channel.
 * Called from the web dashboard.
 */
async function sendApplicationEmbed(guild, cfg) {
  const channel = await guild.channels.fetch(cfg.embedChannelId).catch(() => null);
  if (!channel) throw new Error('قناة الإعلان غير موجودة');

  const embed = new EmbedBuilder()
    .setTitle(cfg.embedTitle || '📋 التقديم لفريق الإدارة')
    .setDescription(cfg.embedDescription || 'هل لديك الرغبة في الانضمام لفريق إدارة السيرفر؟\nاضغط على الزر أدناه وابدأ رحلتك معنا!')
    .setColor(cfg.embedColor ? parseInt(cfg.embedColor.replace('#', ''), 16) : 0x5865f2);

  if (cfg.embedImage) embed.setImage(cfg.embedImage);
  if (cfg.embedThumbnail) embed.setThumbnail(cfg.embedThumbnail);
  if (cfg.embedFooter) embed.setFooter({ text: cfg.embedFooter });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('staff_app_open')
      .setLabel(cfg.buttonLabel || '📝 تقدم الآن')
      .setStyle(ButtonStyle.Primary),
  );

  await channel.send({ embeds: [embed], components: [row] });
}

module.exports = { handleApplicationStart, handleApplicationDecision, sendApplicationEmbed };
