// Tracker profiles: what a session's "Tracker" panel shows and what Claude must put in it.
// A profile = steps, a method (text added to the instructions) and typed blocks { key, type, title, instruction }.
// No setting: the presence of a file decides (the /tracker skill writes them). For a session, the first one
// found: ~/.claude-dashboard/trackers/repos/<repo>.json (the installation's choice for this repo) >
// <repo root>/.claude/tracker.json (shared with the team) > ~/.claude-dashboard/tracker.json (installation
// default) > "Simple tracker" (built in). Each file is a full profile, or a reference `{ "profile": "dev" }`
// to a built-in profile (trackers/ of the app repo), which thus follows its updates.
// Human texts of a profile (name, description, method, step labels, block titles and instructions) are either a
// plain string or `{ "fr": "...", "en": "..." }`: the profiles handed out by this module are resolved to the
// current language, so consumers always get plain strings.
// Used by the page (server.mjs) and by the sessions (driver.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { DASH_DIR } from './common.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pathKey } from './projects.mjs';
import { language, LANGUAGES } from './public/i18n/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILT_IN = path.join(HERE, 'trackers');
const ROOT = DASH_DIR;
const DEFAULT_FILE = path.join(ROOT, 'tracker.json');
const REPOS_DIR = path.join(ROOT, 'trackers', 'repos');
export const DEFAULT_PROFILE = 'simple';

// --- Languages ---------------------------------------------------------------------------------------------

/** French or English text depending on the current language. */
const L = (fr, en) => (language() === 'fr' ? fr : en);
/** `{ fr, en }` object (only language keys, string values)? */
const isLocalized = v => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length > 0 && Object.entries(v).every(([k, x]) => LANGUAGES.includes(k) && typeof x === 'string');
/** Text in the current language: a plain string is returned as is, `{ fr, en }` gives its current version. */
export const localize = v => (isLocalized(v) ? (v[language()] ?? v.en ?? v.fr ?? '') : v);
/** Copy of a profile with every `{ fr, en }` text resolved to the current language. */
export function localizeProfile(p) {
  const walk = v => (isLocalized(v) ? localize(v)
    : Array.isArray(v) ? v.map(walk)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
        : v);
  return p ? walk(p) : p;
}
/** A non-empty text, plain or `{ fr, en }`. */
const hasText = v => (isLocalized(v) ? Object.values(v).some(x => x.trim()) : !!String(v || '').trim());

/** Base types: default title and data format, as Claude reads it in its instructions. */
const TYPE_TEXTS = {
  progress: { title: ['Avancement', 'Progress'], format: ['`[{ label, state }]`, `state` = `done`, `working` ou `todo`', '`[{ label, state }]`, `state` = `done`, `working` or `todo`'] },
  approach: { title: ['Approche', 'Approach'], format: ['`{ chosen, why, alternatives: [{ name, reason }] }`', '`{ chosen, why, alternatives: [{ name, reason }] }`'] },
  list: { title: ['', ''], format: ['tableau de textes (texte riche)', 'array of texts (rich text)'] },
  text: { title: ['', ''], format: ['un texte (texte riche)', 'a text (rich text)'] },
  checklist: { title: ['', ''], format: ['`[{ label, done }]`, `done` vrai ou faux', '`[{ label, done }]`, `done` true or false'] },
  images: { title: ['Images', 'Images'], format: ['`[{ path | url, caption? }]` : `path` absolu d\'une image du projet, ou `url` en https', '`[{ path | url, caption? }]`: absolute `path` of an image of the project, or an https `url`'] },
  files: { title: ['Fichiers et liens', 'Files and links'], format: ['`[{ path | url, label?, note? }]` : `path` absolu, ou `url` http(s)', '`[{ path | url, label?, note? }]`: absolute `path`, or http(s) `url`'] },
  table: { title: ['', ''], format: ['`{ columns: [..], rows: [[..], ..] }` (cellules en texte riche)', '`{ columns: [..], rows: [[..], ..] }` (cells in rich text)'] },
  code: { title: ['', ''], format: ['`{ language?, code }`', '`{ language?, code }`'] },
  mermaid: { title: ['Schéma', 'Diagram'], format: ['`{ source, notes? }` : un schéma Mermaid', '`{ source, notes? }`: a Mermaid diagram'] },
  mockups: { title: ['Maquettes', 'Mockups'], format: ['`[{ title, path, versions?: [{ label, path }] }]`, `path` absolu de la version courante', '`[{ title, path, versions?: [{ label, path }] }]`, absolute `path` of the current version'] },
  architecture: { title: ['Architecture', 'Architecture'], format: ['`{ level, layers: [{ name, wide?, elements: [{ op, name, detail, usedIn?, example? }] }] }`', '`{ level, layers: [{ name, wide?, elements: [{ op, name, detail, usedIn?, example? }] }] }`'] },
  db: { title: ['BDD', 'Database'], format: ['`{ mermaid, notes? }`', '`{ mermaid, notes? }`'] },
};
/** Same, resolved to the current language when read (getters: the language can change while running). */
export const BLOCK_TYPES = {};
for (const [name, { title, format }] of Object.entries(TYPE_TEXTS)) {
  Object.defineProperty(BLOCK_TYPES, name, { enumerable: true, get: () => ({ title: L(...title), format: L(...format) }) });
}
const COMPOSITE_LAYOUTS = ['cards', 'timeline', 'rows'];
const COMPOSITE_FIELDS = ['text', 'date', 'image', 'link', 'file'];
// Fields that update_board carries for every session (header, list, decision cards) or that the engine manages alone
const RESERVED_KEYS = new Set(['decisions', 'title', 'ticket', 'ticketUrl', 'description', 'project', 'step', 'status',
  'statusSummary', 'slug', 'cwd', 'sessionId', 'mode', 'stats', 'updatedAt', 'titlePinned', 'autoTitle', 'endedAt',
  'archivedAt', 'trackerPreview', 'driven', 'model', 'paused', 'stopped', 'busy', 'activity', 'seen', 'reportedSchemas', 'tracker',
  '__proto__', 'constructor', 'prototype']);
/** Keys of steps, blocks, composite types and their fields: they end up in the page's HTML attributes. */
const KEY = /^[\w-]{1,60}$/;
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readDir = dir => (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(f => f.endsWith('.json'))
  .map(f => readJson(path.join(dir, f))).filter(p => p?.id);

/** Built-in profiles, as written (texts possibly `{ fr, en }`). */
const rawBuiltIns = () => readDir(BUILT_IN);
const rawBuiltIn = id => rawBuiltIns().find(p => p.id === id) || null;
/** Built-in profiles, resolved to the current language. */
export const builtInProfiles = () => rawBuiltIns().map(localizeProfile);
/** Content of a tracker file: full profile, or reference `{ profile: "<built-in id>" }`; null if missing or invalid. */
function profileFromFile(f) {
  const j = f && readJson(f);
  if (!j) return null;
  const p = typeof j.profile === 'string' ? rawBuiltIn(j.profile) : j;
  return p && !profileError(p) ? p : null;
}

// --- Repo and project of a folder (git, synchronous: the instructions are computed when a session is launched) ---------

const gitCache = new Map(); // pathKey(folder) → { at, root, main }
function gitInfo(dir) {
  const k = pathKey(dir), c = gitCache.get(k);
  if (c && Date.now() - c.at < 300_000) return c; // 5 min: the root and main worktree of a folder hardly ever move
  const git = args => { try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 4000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
  const root = git(['rev-parse', '--show-toplevel']);
  // Main worktree = first of `git worktree list`: it identifies the project (projects.mjs)
  const main = git(['worktree', 'list', '--porcelain']).match(/^worktree (.+)$/m)?.[1] || root || dir;
  const r = { at: Date.now(), root: root ? path.normalize(root) : null, main: path.normalize(main) };
  gitCache.set(k, r);
  return r;
}
const repoFile = dir => { const r = gitInfo(dir).root; return r ? path.join(r, '.claude', 'tracker.json') : null; };
/** Installation file for the folder's repo: named after its main worktree ("App.json"). */
const installRepoFile = dir => path.join(REPOS_DIR, `${path.basename(gitInfo(dir).main).replace(/[^\w.-]/g, '_')}.json`);
export const repoProfile = dir => localizeProfile(profileFromFile(repoFile(dir)));

/** Profile that applies to a folder (resolved to the current language), where it comes from (`install-repo`, `repo`, `installation`, `built-in`) and its file. */
export function profileOf(dir) {
  const candidates = dir ? [['install-repo', installRepoFile(dir)], ['repo', repoFile(dir)]] : [];
  for (const [source, file] of [...candidates, ['installation', DEFAULT_FILE]]) {
    const p = profileFromFile(file);
    if (p) return { profile: localizeProfile(p), source, file };
  }
  return { profile: localizeProfile(rawBuiltIn(DEFAULT_PROFILE)), source: 'built-in', file: path.join(BUILT_IN, `${DEFAULT_PROFILE}.json`) };
}
/** The three possible files for a folder, existing or not (list_trackers tool). */
export const filesOf = dir => ({ installRepo: installRepoFile(dir), repo: repoFile(dir), default: DEFAULT_FILE });

// --- Validation ------------------------------------------------------------------------------------------------

/** Error readable by Claude (set_tracker tool) or the page (import), or null if the profile is fine. */
export function profileError(p) {
  if (!p || typeof p !== 'object') return L('le profil doit être un objet JSON', 'the profile must be a JSON object');
  if (!/^[a-z0-9-]{1,40}$/.test(String(p.id || ''))) return L('`id` : lettres minuscules, chiffres et tirets (40 au plus)', '`id`: lowercase letters, digits and hyphens (40 at most)');
  if (!hasText(p.name)) return L('`name` manquant', '`name` missing');
  if (p.steps && (!Array.isArray(p.steps) || p.steps.some(e => !e?.key || !hasText(e?.label)))) return L('`steps` : `[{ key, label }]`', '`steps`: `[{ key, label }]`');
  if (p.steps?.some(e => !KEY.test(String(e.key)))) return L('`steps` : `key` en lettres, chiffres, `_` ou `-`', '`steps`: `key` made of letters, digits, `_` or `-`');
  const types = p.types || {};
  for (const [name, t] of Object.entries(types)) {
    if (!KEY.test(name) || t?.fields?.some?.(c => !KEY.test(String(c?.key)))) return L(`type composé « ${name} » : nom et clés en lettres, chiffres, \`_\` ou \`-\``, `composite type "${name}": name and keys made of letters, digits, \`_\` or \`-\``);
    if (BLOCK_TYPES[name]) return L(`type composé « ${name} » : ce nom est celui d'un type de base`, `composite type "${name}": this name is a base type's`);
    if (!COMPOSITE_LAYOUTS.includes(t?.layout)) return L(`type composé « ${name} » : \`layout\` parmi ${COMPOSITE_LAYOUTS.join(', ')}`, `composite type "${name}": \`layout\` among ${COMPOSITE_LAYOUTS.join(', ')}`);
    if (!Array.isArray(t.fields) || !t.fields.length || t.fields.some(c => !c?.key || !COMPOSITE_FIELDS.includes(c.type))) {
      return L(`type composé « ${name} » : \`fields: [{ key, type }]\`, type parmi ${COMPOSITE_FIELDS.join(', ')}`,
        `composite type "${name}": \`fields: [{ key, type }]\`, type among ${COMPOSITE_FIELDS.join(', ')}`);
    }
  }
  if (!Array.isArray(p.blocks) || !p.blocks.length) return L('`blocks` : au moins un bloc', '`blocks`: at least one block');
  const seen = new Set();
  for (const b of p.blocks.flatMap(b => b?.sideBySide || [b])) {
    if (!b?.key || !b?.type) return L('chaque bloc a une `key` et un `type`', 'every block has a `key` and a `type`');
    if (!KEY.test(String(b.key))) return L(`bloc « ${b.key} » : clé en lettres, chiffres, \`_\` ou \`-\``, `block "${b.key}": key made of letters, digits, \`_\` or \`-\``);
    if (RESERVED_KEYS.has(b.key)) return L(`bloc « ${b.key} » : cette clé est réservée au tableau de bord`, `block "${b.key}": this key is reserved for the dashboard`);
    if (seen.has(b.key)) return L(`bloc « ${b.key} » : clé en double`, `block "${b.key}": duplicate key`);
    if (!BLOCK_TYPES[b.type] && !types[b.type]) return L(`bloc « ${b.key} » : type « ${b.type} » inconnu`, `block "${b.key}": unknown type "${b.type}"`);
    seen.add(b.key);
  }
  return null;
}

// --- Saving ----------------------------------------------------------------------------------------------------

/**
 * Writes a profile where it will apply: `install-repo` (your choice for this repo), `repo` (in the repo,
 * versioned), `default` (installation default). `profile`: a full profile, or the id of a built-in profile (reference
 * `{ profile: id }`, which follows its updates). `null` deletes the file (back to the next level). Returns the path.
 */
export function writeTracker(dir, scope, profile) {
  const f = scope === 'default' ? DEFAULT_FILE : scope === 'repo' ? repoFile(dir) : scope === 'install-repo' ? installRepoFile(dir) : null;
  if (!f) throw new Error(scope === 'repo' ? L('ce dossier n\'est pas dans un dépôt git', 'this folder is not in a git repo') : L(`portée inconnue : ${scope}`, `unknown scope: ${scope}`));
  if (profile === null) { fs.rmSync(f, { force: true }); return f; }
  let content = profile;
  if (typeof profile === 'string') {
    if (!rawBuiltIn(profile)) throw new Error(L(`profil fourni inconnu : ${profile}`, `unknown built-in profile: ${profile}`) + ` (${rawBuiltIns().map(p => p.id).join(', ')})`);
    content = { profile };
  } else {
    const e = profileError(profile);
    if (e) throw new Error(e);
  }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(content, null, 2));
  return f;
}

/** Setup: an installation already in use (sessions exist) keeps its display, "Dev tracker". */
export function init() {
  if (readJson(DEFAULT_FILE)) return;
  const dir = path.join(ROOT, 'sessions');
  const inUse = fs.existsSync(dir) && fs.readdirSync(dir, { recursive: true }).some(f => String(f).endsWith('.json'));
  if (inUse) writeTracker(null, 'default', 'dev');
}

// --- Claude's instructions -------------------------------------------------------------------------------------

/** Text added to the session's instructions: steps, method, tracker blocks and their format. */
export function instructionsOf(profile) {
  const p = localizeProfile(profile || rawBuiltIn(DEFAULT_PROFILE));
  const blocks = p.blocks.flatMap(b => b.sideBySide || [b]);
  const types = p.types || {};
  const blockLine = b => {
    const t = BLOCK_TYPES[b.type], c = types[b.type];
    const fields = c && c.fields.map(x => `${x.key}${x.type === 'text' ? '' : ` (${x.type})`}`).join(', ');
    const format = t ? t.format : L(`type composé « ${b.type} » : tableau d'objets \`{ ${fields} }\``, `composite type "${b.type}": array of objects \`{ ${fields} }\``);
    const title = String(b.title || t?.title || '').replace(/\s*\(\{n\}\)/, '');
    const instruction = b.instruction ? ` ${b.instruction[0].toUpperCase()}${b.instruction.slice(1)}` : '';
    return `- **\`${b.key}\`**${title ? L(` (« ${title} »)`, ` ("${title}")`) : ''}${L(' : ', ': ')}${format}.${instruction}`;
  };
  return [
    L(`## Le suivi de cette session : profil « ${p.name} »`, `## This session's tracker: profile "${p.name}"`),
    '',
    L('Le panneau Suivi affiche ces blocs, dans cet ordre ; chacun lit le champ de `update_board` qui porte sa clé. Ne remplis que ceux-là (plus les champs communs et `decisions`).',
      'The Tracker panel shows these blocks, in this order; each one reads the `update_board` field named after its key. Fill only those (plus the common fields and `decisions`).'),
    '',
    ...blocks.map(blockLine),
    L('- Images et fichiers : `path` absolu sur ce PC, ou `url` ; un chemin s\'ouvre depuis le panneau.',
      '- Images and files: absolute `path` on this PC, or `url`; a path opens from the panel.'),
    L('- Texte riche accepté : `**gras**`, `` `code` ``, blocs ```` ``` ````, listes `- `.',
      '- Rich text accepted: `**bold**`, `` `code` ``, ```` ``` ```` blocks, `- ` lists.'),
    '',
    p.steps?.length ? L(`Étapes (\`step\`) : ${p.steps.map(e => `\`${e.key}\``).join(' → ')}.`, `Steps (\`step\`): ${p.steps.map(e => `\`${e.key}\``).join(' → ')}.`) : '',
    '',
    p.method || '',
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
