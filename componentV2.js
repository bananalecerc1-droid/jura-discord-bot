'use strict';

const COMPONENTS_V2_FLAG = 1 << 15;

function jsonValue(value) {
  if (!value) return null;
  if (typeof value.toJSON === 'function') return value.toJSON();
  return value;
}

function componentValue(value) {
  return jsonValue(value);
}

function truncate(text, max = 4000) {
  const value = String(text ?? '');
  const clipped = value.length > max ? `${value.slice(0, max - 1)}…` : value;
  // Discord trims whitespace-only text content before validating length,
  // so a value that's all spaces/newlines collapses to 0 chars server-side
  // and gets rejected as BASE_TYPE_BAD_LENGTH. A zero-width space survives
  // trimming while staying visually invisible.
  return clipped.trim() ? clipped : '\u200b';
}

function timestampText(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

function embedLines(embed) {
  const lines = [];
  const title = embed.title ? String(embed.title) : '';
  if (title) {
    lines.push(embed.url ? `## [${title}](${embed.url})` : `## ${title}`);
  }
  if (embed.author?.name) {
    lines.push(embed.author.url
      ? `[${embed.author.name}](${embed.author.url})`
      : `**${embed.author.name}**`);
  }
  if (embed.description) lines.push(String(embed.description));

  for (const field of embed.fields || []) {
    if (!field?.name && !field?.value) continue;
    const fieldText = `**${field.name || 'Field'}**\n${field.value || '—'}`;
    lines.push(field.inline ? fieldText.replace(/\n/g, ' · ') : fieldText);
  }

  if (embed.footer?.text) lines.push(`_${embed.footer.text}_`);
  const timestamp = timestampText(embed.timestamp);
  if (timestamp) lines.push(timestamp);
  return lines;
}

function textComponents(lines) {
  const blocks = [];
  let current = '';
  for (const line of lines) {
    const next = current ? `${current}\n\n${line}` : line;
    if (next.length <= 3900) {
      current = next;
    } else {
      if (current) blocks.push({ type: 10, content: truncate(current) });
      current = String(line).slice(0, 3900);
    }
  }
  if (current) blocks.push({ type: 10, content: truncate(current) });
  return blocks;
}

function mediaComponent(url) {
  if (!url) return null;
  return {
    type: 12,
    items: [{ media: { url: String(url) } }],
  };
}

function embedComponents(embed) {
  const components = textComponents(embedLines(embed));

  // A thumbnail is represented by a section accessory in Component V2.
  if (embed.thumbnail?.url && components.length) {
    components[0] = {
      type: 9,
      components: [components[0]],
      accessory: {
        type: 11,
        media: { url: String(embed.thumbnail.url) },
      },
    };
  } else if (embed.thumbnail?.url) {
    components.push({
      type: 9,
      components: [{
        type: 10,
        // Discord trims whitespace-only text content before validating
        // length, so a plain space collapses to 0 chars and gets rejected.
        // A zero-width space survives trimming while staying invisible.
        content: '\u200b',
      }],
      accessory: {
        type: 11,
        media: { url: String(embed.thumbnail.url) },
      },
    });
  }

  const image = mediaComponent(embed.image?.url);
  if (image) components.push(image);
  if (!components.length) components.push({ type: 10, content: '\u200b' });
  return components;
}

function containerize(children, accentColor) {
  const containers = [];
  for (let i = 0; i < children.length; i += 10) {
    containers.push({
      type: 17,
      ...(accentColor ? { accent_color: accentColor } : {}),
      components: children.slice(i, i + 10),
    });
  }
  return containers;
}

function convertEmbedsToComponents(embeds, existingContent = '') {
  const embedList = embeds.map(jsonValue).filter(Boolean);
  const containers = [];
  if (existingContent) containers.push(...containerize(textComponents([existingContent])));

  for (const embed of embedList) {
    containers.push(...containerize(embedComponents(embed), embed.color));
  }
  return containers;
}

function convertMessageData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  // A key being present at all (even as an empty array) is a deliberate
  // signal from the caller — e.g. `interaction.update({ content, components: [] })`
  // to swap text and clear buttons on a message that may already carry the
  // V2 flag. We must still route those through conversion (so `content`
  // never survives onto a V2 message), so this checks presence, not length.
  const legacyEmbedMarker = data.__legacyEmbed === true || (
    data.allowed_mentions &&
    Array.isArray(data.allowed_mentions.parse) && data.allowed_mentions.parse.length === 0 &&
    Array.isArray(data.allowed_mentions.roles) && data.allowed_mentions.roles.length === 0 &&
    data.allowed_mentions.replied_user === false
  );
  if (legacyEmbedMarker) {
    const legacy = { ...data };
    delete legacy.__legacyEmbed;
    return legacy;
  }
  const hasEmbeds = Array.isArray(data.embeds);
  const hasComponents = Array.isArray(data.components);
  const hasV2Flag = (Number(data.flags) || 0) & COMPONENTS_V2_FLAG;
  if (!hasEmbeds && !hasComponents && !hasV2Flag) return data;

  const converted = { ...data };
  const containers = hasEmbeds && converted.embeds.length
    ? convertEmbedsToComponents(converted.embeds, converted.content)
    : converted.content
      ? containerize(textComponents([converted.content]))
      : [];
  delete converted.embeds;
  delete converted.content;
  converted.components = [
    ...containers,
    ...(hasComponents ? converted.components.map(componentValue) : []),
  ].slice(0, 10);
  // Safety net: never ship a V2 message with zero components — Discord
  // rejects it as "Cannot send an empty message". This covers cases like
  // `interaction.update({ components: [] })` with no content/embeds either,
  // used to just clear buttons on a V2 message.
  if (!converted.components.length) {
    converted.components = [{ type: 10, content: '\u200b' }];
  }
  converted.flags = (Number(converted.flags) || 0) | COMPONENTS_V2_FLAG;
  return converted;
}

function updateComponentV2Components(components, { accentColor, heading } = {}) {
  let headingUpdated = false;
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const next = { ...value };
    if (next.type === 17 && accentColor) next.accent_color = accentColor;
    if (next.type === 10 && heading && !headingUpdated) {
      next.content = String(next.content || '').replace(/^## .*(?=\n|$)/, `## ${heading}`);
      headingUpdated = true;
    }
    if (Array.isArray(next.components)) next.components = next.components.map(visit);
    return next;
  };
  return (components || []).map((component) => visit(jsonValue(component)));
}

function transformRestOptions(options = {}) {
  if (!options || typeof options !== 'object' || !options.body || typeof options.body !== 'object') {
    return options;
  }
  // Some REST calls (e.g. role position reorders, bulk command overwrites)
  // send an ARRAY as the body, not a message payload object. `typeof []`
  // is 'object' in JS, so without this guard the array got spread into a
  // plain `{0: ..., 1: ...}` object below — corrupting it into something
  // that is no longer iterable and causing Discord/discord.js to reject
  // it (e.g. "[LIST_TYPE_CONVERT]: Only iterables may be used in a
  // ListType", surfaced by role.setPosition() as "Invalid Form Body").
  if (Array.isArray(options.body)) {
    return options;
  }

  const body = { ...options.body };
  if (Array.isArray(body.data)) {
    return options;
  }
  if (body.data && typeof body.data === 'object') {
    body.data = convertMessageData(body.data);
  } else {
    // Replace rather than merge: V2 forbids legacy keys such as `content`
    // and `embeds`, including when discord.js populated them as undefined.
    return { ...options, body: convertMessageData(body) };
  }
  return { ...options, body };
}

function installComponentV2Transport(client) {
  if (!client?.rest || client.rest.__componentV2Installed) return;
  const rest = client.rest;
  const originalPost = rest.post;
  const originalPatch = rest.patch;

  const callAndLog = (original, verb, route, options) => {
    const transformed = transformRestOptions(options);
    const p = original.call(rest, route, transformed);
    // Temporary diagnostic: log route + outgoing body on ANY failure so we
    // can pinpoint exactly which call site produces an invalid payload.
    // (Message data can live at `body` directly, e.g. channel.send, or
    // nested at `body.data`, e.g. interaction replies/updates — log both.)
    p.catch((err) => {
      console.error(
        `[componentV2 debug] ${verb} ${route} FAILED:`,
        err.message,
        '\nbody:',
        JSON.stringify(transformed?.body),
      );
    });
    return p;
  };

  rest.post = function patchedPost(route, options = {}) {
    return callAndLog(originalPost, 'POST', route, options);
  };
  rest.patch = function patchedPatch(route, options = {}) {
    return callAndLog(originalPatch, 'PATCH', route, options);
  };
  Object.defineProperty(rest, '__componentV2Installed', { value: true });
}

module.exports = {
  COMPONENTS_V2_FLAG,
  convertMessageData,
  convertEmbedsToComponents,
  updateComponentV2Components,
  installComponentV2Transport,
};