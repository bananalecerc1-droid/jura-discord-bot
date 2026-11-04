// One-off diagnostic: run with `node diag-channels.js` inside your bot folder.
// Uses your existing .env DISCORD_BOT_TOKEN and installed discord.js — no new installs needed.
// Lists EVERY channel in the guild (all types), and flags which ones the bot
// cannot actually see (View Channel permission missing), which is the #1
// reason a channel silently disappears from dashboard dropdowns.

require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const typeNames = {
  [ChannelType.GuildText]: 'Text',
  [ChannelType.GuildVoice]: 'Voice',
  [ChannelType.GuildCategory]: 'Category',
  [ChannelType.GuildAnnouncement]: 'Announcement',
  [ChannelType.GuildForum]: 'Forum',
  [ChannelType.GuildStageVoice]: 'Stage',
  [ChannelType.PublicThread]: 'Public Thread',
  [ChannelType.PrivateThread]: 'Private Thread',
  [ChannelType.AnnouncementThread]: 'Announcement Thread',
  [ChannelType.GuildMedia]: 'Media',
};

client.once('ready', async () => {
  console.log(`\nLogged in as ${client.user.tag}\n`);

  for (const guild of client.guilds.cache.values()) {
    console.log(`\n=== Guild: ${guild.name} (${guild.id}) ===`);
    await guild.channels.fetch();
    const me = await guild.members.fetchMe();

    const all = [...guild.channels.cache.values()];
    console.log(`Total channels bot's cache has (all types): ${all.length}\n`);

    const byType = {};
    all.forEach(c => {
      const label = typeNames[c.type] || `Type ${c.type}`;
      byType[label] = (byType[label] || 0) + 1;
    });
    console.log('Breakdown by type:', byType, '\n');

    console.log('--- Channels the bot CANNOT see/view (permission problem) ---');
    let hiddenCount = 0;
    all.forEach(c => {
      if (!c.isTextBased || c.type === ChannelType.GuildCategory) {
        // still check view permission generically below
      }
      try {
        const perms = c.permissionsFor(me);
        if (perms && !perms.has(PermissionsBitField.Flags.ViewChannel)) {
          hiddenCount++;
          console.log(`  ❌ ${c.name}  (id: ${c.id}, type: ${typeNames[c.type] || c.type}, parent: ${c.parent ? c.parent.name : 'none'})`);
        }
      } catch (e) {
        console.log(`  ⚠️ ${c.name} — could not compute perms (${e.message})`);
      }
    });
    if (hiddenCount === 0) console.log('  (none — bot can view every channel)');

    console.log('\n--- Text-based channels excluded from dashboard list on purpose (forum/threads) ---');
    all.filter(c => !c.isTextBased() || c.isThread())
       .filter(c => c.type !== ChannelType.GuildVoice && c.type !== ChannelType.GuildCategory)
       .forEach(c => console.log(`  • ${c.name}  (type: ${typeNames[c.type] || c.type})`));

    console.log('\n--- FULL channel list (name : type : bot can view?) ---');
    all
      .filter(c => c.type !== ChannelType.GuildCategory)
      .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
      .forEach(c => {
        const perms = c.permissionsFor(me);
        const canView = perms ? perms.has(PermissionsBitField.Flags.ViewChannel) : '?';
        console.log(`  ${canView ? '✅' : '❌'} ${c.name}  [${typeNames[c.type] || c.type}]`);
      });
  }

  console.log('\nDone.\n');
  process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
