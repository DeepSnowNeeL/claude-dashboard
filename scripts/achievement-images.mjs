// Achievement images: one per family (the milestone colour frame is added by the page), through OpenAI's image
// API. Usage: node scripts/achievement-images.mjs [id…] [--all]
//   without id: the missing ones; --all: redoes them all.
// Key: OPENAI_API_KEY from the environment, otherwise read from the .env file given by DASH_OPENAI_ENV.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAMILIES } from '../engine/achievements/definitions.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'public', 'achievements');

function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const env = process.env.DASH_OPENAI_ENV;
  if (!env) throw new Error('OPENAI_API_KEY missing: set it, or point DASH_OPENAI_ENV to a .env file that contains it');
  const m = fs.readFileSync(env, 'utf8').match(/^OPENAI_API_KEY=(.+)$/m);
  if (!m) throw new Error(`OPENAI_API_KEY missing from ${env}`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

// No transparent background with gpt-image-2: a solid background, which the page crops to a disc (milestone frame around it)
const STYLE = 'Achievement icon for a video game. Square image, the subject large and centered, on a soft radial gradient '
  + 'background in deep navy blue that fills the whole image edge to edge (it will be cropped to a circle). '
  + 'Flat vector illustration with soft shading, bold simple shapes and thick clean outlines, bright cheerful colors, '
  + 'readable at 64 pixels, the whole subject fitting inside the central circle. Playful aviation and air traffic control touch where it fits. No text, no letters, no numbers, '
  + 'no frame, no ring, no border. Subject: ';

async function generate(f, k) {
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.DASH_IMAGE_MODEL || 'gpt-image-2', prompt: STYLE + f.image + '.', size: '1024x1024', quality: 'medium', output_format: 'webp', output_compression: 80, n: 1 }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || r.status);
  fs.writeFileSync(path.join(DIR, `${f.id}.webp`), Buffer.from(j.data[0].b64_json, 'base64'));
}

const args = process.argv.slice(2);
const all = args.includes('--all');
const ids = args.filter(a => !a.startsWith('--'));
fs.mkdirSync(DIR, { recursive: true });
const targets = FAMILIES.filter(f => (ids.length ? ids.includes(f.id) : all || !fs.existsSync(path.join(DIR, `${f.id}.webp`))));
const k = apiKey();
// Four at a time: the API takes 20 to 40 s per image
let i = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (i < targets.length) {
    const f = targets[i++];
    try { await generate(f, k); console.log(`✓ ${f.id}`); } catch (e) { console.log(`✗ ${f.id}: ${e.message}`); }
  }
}));
