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

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const skillDir = path.resolve(scriptDir, '..');
  loadEnvFile(path.join(skillDir, '.env'));

  const args = parseArgs(process.argv.slice(2));
  const input = args.input ? path.resolve(args.input) : null;
  if (!input || !fs.existsSync(input)) {
    throw new Error('Provide --input <post-file>.');
  }

  const token = process.env.LINKEDIN_API_ACCESS_TOKEN;
  const author = process.env.LINKEDIN_AUTHOR_URN;
  if (!token || !author) {
    throw new Error('LINKEDIN_API_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN are required for linkedin-api mode.');
  }

  const postText = fs.readFileSync(input, 'utf8').trim();
  if (!postText) {
    throw new Error('Post file is empty.');
  }

  const payload = {
    author,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: postText },
        shareMediaCategory: 'NONE'
      }
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
    }
  };

  const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`LinkedIn API failed (${response.status}): ${text}`);
  }

  const postId = response.headers.get('x-restli-id') || '';
  const result = {
    status: 'published',
    mode: 'linkedin-api',
    published_at: new Date().toISOString(),
    post_id: postId
  };

  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
  console.error(`[publish_via_linkedin_api] ${error.message}`);
  process.exit(1);
});
