const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildEmojisAndStickers],
});

const EMOJIS_DIR = path.join(__dirname, 'emojis_final');
const TARGET_GUILD_NAME = 'coffe';

client.once('ready', async () => {
  console.log(`✅ متصل كـ ${client.user.tag}`);

  const guild = client.guilds.cache.find(
    (g) => g.name.toLowerCase().includes(TARGET_GUILD_NAME.toLowerCase())
  );

  if (!guild) {
    const available = client.guilds.cache.map((g) => `"${g.name}"`).join(', ');
    console.error(`❌ ما لقيت سيرفر "${TARGET_GUILD_NAME}". السيرفرات المتاحة: ${available}`);
    process.exit(1);
  }

  console.log(`🎯 السيرفر: ${guild.name} (${guild.id})`);

  await guild.emojis.fetch();
  const existingNames = new Set(guild.emojis.cache.map((e) => e.name.toLowerCase()));
  console.log(`📋 إيموجيات موجودة: ${existingNames.size}`);

  const files = fs.readdirSync(EMOJIS_DIR).filter((f) => /\.(png|jpg|gif)$/i.test(f));
  console.log(`📦 إيموجيات للرفع: ${files.length}\n`);

  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const emojiName = path.basename(file, path.extname(file));
    const cleanName = emojiName.replace(/[^a-zA-Z0-9_]/g, '_');

    if (existingNames.has(cleanName.toLowerCase())) {
      console.log(`⏭️  موجود مسبقاً: ${cleanName}`);
      skipped++;
      continue;
    }

    try {
      const filePath = path.join(EMOJIS_DIR, file);
      await guild.emojis.create({ attachment: filePath, name: cleanName });
      console.log(`✅ أضفت: ${cleanName}`);
      added++;
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`❌ فشل ${cleanName}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n📊 النتيجة:`);
  console.log(`   ✅ أُضيف: ${added}`);
  console.log(`   ⏭️  موجود مسبقاً: ${skipped}`);
  console.log(`   ❌ فشل: ${failed}`);

  process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
