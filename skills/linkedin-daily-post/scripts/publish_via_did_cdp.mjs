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
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    result[key] = value;
  }
  return result;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const env = parseDotEnv(fs.readFileSync(filePath, 'utf8'));
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

async function loadPlaywrightChromium() {
  try {
    const mod = await import('playwright');
    return mod.chromium;
  } catch {
    try {
      const mod = await import('playwright-core');
      return mod.chromium;
    } catch {
      throw new Error('Missing dependency: install playwright or playwright-core for did-cdp mode.');
    }
  }
}

async function findFirstVisible(page, selectors, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
        return locator;
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const skillDir = path.resolve(scriptDir, '..');
  loadEnvFile(path.join(skillDir, '.env'));

  const args = parseArgs(process.argv.slice(2));
  const input = args.input ? path.resolve(args.input) : null;
  if (!input || !fs.existsSync(input)) {
    throw new Error('Provide --input <post-file>.');
  }

  const postText = fs.readFileSync(input, 'utf8').trim();
  if (!postText) {
    throw new Error('Post file is empty.');
  }

  const cdpUrl = process.env.DID_BROWSER_CDP_URL;
  if (!cdpUrl) {
    throw new Error('DID_BROWSER_CDP_URL is required for did-cdp mode.');
  }

  const chromium = await loadPlaywrightChromium();
  const browser = await chromium.connectOverCDP(cdpUrl);

  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());

  await page.goto('https://www.linkedin.com/post/new/', { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/login')) {
    throw new Error('LinkedIn session is not logged in within DID Browser profile.');
  }

  const editor = await findFirstVisible(page, [
    'div.share-box-feed-entry__trigger[role="button"]',
    'div[role="textbox"]',
    'div.ql-editor[contenteditable="true"]'
  ]);

  if (!editor) {
    throw new Error('Unable to locate LinkedIn post editor.');
  }

  await editor.click();
  await page.waitForTimeout(500);

  const textbox = await findFirstVisible(page, [
    'div[role="textbox"][contenteditable="true"]',
    'div.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"][data-placeholder]'
  ]);

  if (!textbox) {
    throw new Error('Unable to focus post text area.');
  }

  await textbox.click();
  const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  await page.keyboard.press(selectAll);
  await page.keyboard.type(postText, { delay: 5 });

  const postButton = await findFirstVisible(page, [
    'button:has-text("Post")',
    'button.share-actions__primary-action',
    'button.artdeco-button--primary:has-text("Post")'
  ]);

  if (!postButton) {
    throw new Error('Unable to locate Post button.');
  }

  await postButton.click();
  await page.waitForTimeout(3000);

  const payload = {
    status: 'published',
    mode: 'did-cdp',
    published_at: new Date().toISOString(),
    post_preview: postText.slice(0, 140)
  };

  process.stdout.write(JSON.stringify(payload));
}

main().catch((error) => {
  console.error(`[publish_via_did_cdp] ${error.message}`);
  process.exit(1);
});
