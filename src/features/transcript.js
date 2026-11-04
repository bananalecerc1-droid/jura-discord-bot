const { escapeMarkdown } = require('discord.js');

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeUrl(value = '') {
  const url = String(value || '');
  return /^https?:\/\//i.test(url) ? escapeHtml(url) : '#';
}

function renderEmbed(embed) {
  const color = embed.hexColor || '#5865f2';
  const image = embed.image?.url || embed.thumbnail?.url;
  return `<div class="discord-embed" style="border-left-color:${escapeHtml(color)}">
    ${embed.author?.name ? `<div class="embed-author">${escapeHtml(embed.author.name)}</div>` : ''}
    ${embed.title ? `<div class="embed-title">${escapeHtml(embed.title)}</div>` : ''}
    ${embed.description ? `<div class="embed-description">${escapeHtml(embed.description)}</div>` : ''}
    ${embed.fields?.map((field) => `<div class="embed-field"><b>${escapeHtml(field.name)}</b><div>${escapeHtml(field.value)}</div></div>`).join('') || ''}
    ${image ? `<a href="${safeUrl(image)}" target="_blank" rel="noopener"><img class="embed-image" src="${safeUrl(image)}" loading="lazy"></a>` : ''}
    ${embed.footer?.text ? `<div class="embed-footer">${escapeHtml(embed.footer.text)}</div>` : ''}
  </div>`;
}

function renderComponents(message) {
  const rows = [];
  for (const row of message.components || []) {
    const parts = [];
    for (const component of row.components || []) {
      const label = component.label || component.placeholder || component.customId || 'Component';
      const url = component.url;
      if (component.type === 2 && url) {
        parts.push(`<a class="component button-link" href="${safeUrl(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`);
      } else {
        parts.push(`<span class="component">${escapeHtml(label)}${component.emoji?.name ? ` ${escapeHtml(component.emoji.name)}` : ''}</span>`);
      }
    }
    if (parts.length) rows.push(`<div class="component-row">${parts.join('')}</div>`);
  }
  return rows.join('');
}

async function fetchAllMessages(channel) {
  const all = [];
  let before;
  while (true) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!page.size) break;
    all.push(...page.values());
    if (page.size < 100) break;
    before = page.last().id;
  }
  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function createHtmlTranscript(channel, ticketName, metadata = {}) {
  try {
    const messages = await fetchAllMessages(channel);
    const title = escapeHtml(ticketName || channel.name);
    const rows = messages.map((msg) => {
      const avatar = msg.author.displayAvatarURL({ extension: 'png', size: 128 });
      const date = new Date(msg.createdTimestamp);
      const timestamp = date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }) + ' UTC';
      const content = msg.content ? `<div class="text">${escapeHtml(msg.content)}</div>` : '';
      const attachments = [...msg.attachments.values()].map((att) => {
        const url = safeUrl(att.url);
        const type = att.contentType || '';
        if (type.startsWith('image/')) return `<a href="${url}" target="_blank" rel="noopener"><img class="attachment image" src="${url}" loading="lazy" alt="${escapeHtml(att.name)}"></a>`;
        if (type.startsWith('video/')) return `<video class="attachment video" controls preload="metadata"><source src="${url}" type="${escapeHtml(type)}"></video><a class="file-link" href="${url}" target="_blank" rel="noopener">${escapeHtml(att.name)}</a>`;
        return `<a class="file-link" href="${url}" target="_blank" rel="noopener">📎 ${escapeHtml(att.name || 'Attachment')}</a>`;
      }).join('');
      const embeds = msg.embeds.map(renderEmbed).join('');
      const components = renderComponents(msg);
      return `<article class="message">
        <img class="avatar" src="${safeUrl(avatar)}" alt="avatar" loading="lazy">
        <div class="message-body"><div class="message-header"><span class="username">${escapeHtml(msg.author.tag || msg.author.username)}</span>${msg.author.bot ? '<span class="bot">BOT</span>' : ''}<span class="timestamp">${escapeHtml(timestamp)}</span></div>
        ${content}${attachments}${embeds}${components}</div>
      </article>`;
    }).join('\n');
    const opened = metadata.openedAt ? new Date(metadata.openedAt).toISOString() : '';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ticket transcript - ${title}</title><style>
      :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#313338;color:#dbdee1;font:15px Arial,sans-serif}.wrap{max-width:1050px;margin:auto;padding:28px}.top{background:#1e1f22;border-radius:10px;padding:22px;margin-bottom:22px}.top h1{margin:0 0 10px;color:#fff}.meta{color:#b5bac1}.message{display:flex;gap:14px;padding:15px 8px;border-bottom:1px solid #3f4147}.avatar{width:42px;height:42px;border-radius:50%;object-fit:cover}.message-body{min-width:0;flex:1}.message-header{display:flex;align-items:center;gap:8px;margin-bottom:4px}.username{font-weight:700;color:#f2f3f5}.bot{font-size:10px;background:#5865f2;color:#fff;padding:2px 4px;border-radius:3px}.timestamp{font-size:12px;color:#949ba4}.text{white-space:pre-wrap;word-break:break-word;margin:4px 0 8px}.attachment{display:block;max-width:min(640px,100%);max-height:480px;border-radius:7px;margin:8px 0;border:1px solid #1e1f22}.video{background:#000}.file-link{display:block;color:#00a8fc;margin:7px 0}.discord-embed{background:#2b2d31;border-left:4px solid #5865f2;border-radius:4px;padding:10px 12px;margin:8px 0;max-width:700px}.embed-author,.embed-footer{color:#b5bac1;font-size:12px}.embed-title{font-weight:700;color:#fff;margin:4px 0}.embed-description{white-space:pre-wrap}.embed-field{margin-top:8px}.embed-image{display:block;max-width:100%;max-height:400px;margin-top:10px;border-radius:4px}.component-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}.component{display:inline-block;background:#4e5058;color:#fff;border-radius:4px;padding:7px 12px;font-size:13px}.button-link{background:#5865f2;text-decoration:none}.empty{padding:25px;color:#949ba4}
    </style></head><body><main class="wrap"><section class="top"><h1>Ticket transcript: ${title}</h1><div class="meta">Channel: #${escapeHtml(channel.name)} · Messages: ${messages.length}${opened ? ` · Opened: ${escapeHtml(opened)}` : ''}</div></section><section>${rows || '<div class="empty">No messages found.</div>'}</section></main></body></html>`;
    return Buffer.from(html, 'utf8');
  } catch (err) {
    console.error('[Transcript] Error generating HTML:', err);
    return null;
  }
}

module.exports = { createHtmlTranscript };
