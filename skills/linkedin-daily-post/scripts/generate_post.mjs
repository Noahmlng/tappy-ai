#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    args[key] = value;
  }
  return args;
}

function parseDotEnv(raw) {
  const lines = raw.split(/\r?\n/);
  const result = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const envFromFile = parseDotEnv(fs.readFileSync(filePath, 'utf8'));
  for (const [key, value] of Object.entries(envFromFile)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function getResponseText(payload) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  if (!Array.isArray(payload.output)) return '';
  const parts = [];
  for (const item of payload.output) {
    if (!Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (typeof content.text === 'string') {
        parts.push(content.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function truncateToLimit(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function buildFallbackPost({ date, topic, audience, style, cta, maxChars, language }) {
  const languageHint =
    language.toLowerCase() === 'en'
      ? ''
      : `\n\nWrite the final copy in ${language}, keeping a professional tone.`;
  const base = [
    `Daily note (${date}) on ${topic}:`,
    `I keep seeing teams serving ${audience} over-invest in activity and under-invest in measurable outcomes.`,
    `A practical fix is to define one weekly operating metric, review it in public, and cut work that does not move it.`,
    `${cta}`
  ].join(' ');
  return truncateToLimit(`${base}${languageHint}`.trim(), maxChars);
}

async function generateWithOpenAI({ apiKey, model, topic, audience, style, cta, maxChars, language }) {
  const system =
    'You write high-quality LinkedIn posts for professionals. Keep claims grounded, avoid hype, and keep each post clear and actionable.';

  const user = [
    `Generate one LinkedIn post in ${language}.`,
    `Audience: ${audience}`,
    `Topic: ${topic}`,
    `Style: ${style}`,
    `Call to action: ${cta}`,
    `Maximum characters: ${maxChars}`,
    'Return only the post body without markdown fences or extra commentary.'
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const text = getResponseText(payload);
  if (!text) {
    throw new Error('OpenAI response did not include usable text output.');
  }
  return truncateToLimit(text, maxChars);
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const skillDir = path.resolve(scriptDir, '..');
  loadEnvFile(path.join(skillDir, '.env'));

  const args = parseArgs(process.argv.slice(2));
  const date = args.date || new Date().toISOString().slice(0, 10);
  const maxChars = Number.parseInt(process.env.LINKEDIN_POST_MAX_CHARS || '800', 10);
  const topic = process.env.LINKEDIN_POST_TOPIC || `an operational lesson for ${date}`;
  const audience = process.env.LINKEDIN_POST_AUDIENCE || 'B2B builders and growth operators';
  const style = process.env.LINKEDIN_POST_STYLE || 'operator';
  const language = process.env.LINKEDIN_POST_LANGUAGE || 'en';
  const cta = process.env.LINKEDIN_POST_CTA || 'If you want the template, comment "template" and I will share it.';
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const outputFile = args.out ? path.resolve(args.out) : null;

  let post;
  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey) {
    try {
      post = await generateWithOpenAI({
        apiKey,
        model,
        topic,
        audience,
        style,
        cta,
        maxChars,
        language
      });
    } catch (error) {
      console.error(`[generate_post] ${error.message}`);
      post = buildFallbackPost({ date, topic, audience, style, cta, maxChars, language });
    }
  } else {
    post = buildFallbackPost({ date, topic, audience, style, cta, maxChars, language });
  }

  if (outputFile) {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${post}\n`, 'utf8');
  }

  process.stdout.write(post);
}

main().catch((error) => {
  console.error(`[generate_post] ${error.message}`);
  process.exit(1);
});
