'use strict';

const fs = require('fs');
const path = require('path');
const { GlobalFonts } = require('@napi-rs/canvas');

let registered = false;

function registerCanvasFonts() {
  if (registered) return;
  const fonts = [
    ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'DejaVuSans'],
    ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'DejaVuSans Bold'],
    ['/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', 'DejaVuSerif'],
    [path.join(__dirname, '../../fonts', 'NotoSansArabic.ttf'), 'NotoSansArabic'],
  ];
  for (const [fontPath, family] of fonts) {
    if (fs.existsSync(fontPath)) {
      try { GlobalFonts.registerFromPath(fontPath, family); } catch {}
    }
  }
  registered = true;
}

registerCanvasFonts();
module.exports = { registerCanvasFonts };
