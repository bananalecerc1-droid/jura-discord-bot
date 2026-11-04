const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const INPUT_DIR = path.join(__dirname, 'emojis_clean');
const OUTPUT_DIR = path.join(__dirname, 'emojis_final');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

const files = fs.readdirSync(INPUT_DIR).filter((f) => /\.(png|jpg|gif)$/i.test(f));

(async () => {
  for (const file of files) {
    const inputPath = path.join(INPUT_DIR, file);
    const outputPath = path.join(OUTPUT_DIR, path.basename(file, path.extname(file)) + '.png');
    await sharp(inputPath)
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, quality: 80 })
      .toFile(outputPath);
    const size = fs.statSync(outputPath).size;
    console.log(`✅ ${file} → ${(size / 1024).toFixed(0)} KB`);
  }
  console.log('\nتم ضغط جميع الصور!');
})();
