import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrate, migrateSession, migrateProfile, migrateDataPath } from '../migration.mjs';

const MODULE = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migration.mjs')).href;

// French data as the French build wrote it
const frenchSession = dir => ({
  slug: 'n-abc', titre: 'nouvelle session', titreAuto: 'nouvelle session', ticket: '2702', lienTicket: 'https://x/2702',
  description: 'Une description', projet: 'app', cwd: 'D:\\app', mode: 'demander', statut: 'en-cours',
  resumeStatut: 'prête', etape: 'maquette', pilotee: true, sessionId: 'sid', modele: 'claude-opus-5-5',
  titreFixe: false, maj: '2026-11-12T00:00:00.000Z', termineLe: '2026-11-12T01:00:00.000Z',
  vu: { n: 3, id: 'ev-1' }, schemasSignales: { bdd: 'abc123' }, inconnue: { garde: 1 },
  stats: { claudeMs: 10, echanges: 2, actifMs: 5, nouveautes: 3, contexte: 1000, fenetre: 200000,
    hf: { autonomes: 1, outils: 40, lignes: 300, pctContexte: 12, lancees: 1, dernierEchange: 'x', debut: 'y', compactions: 2 } },
  avancement: [{ libelle: 'Cadrage', etat: 'fait' }, { libelle: 'Code', etat: 'en-cours' }, { libelle: 'Push', etat: 'a-faire' }],
  approche: { retenue: 'A', pourquoi: 'simple', variantes: [{ nom: 'B', raison: 'lent' }] },
  pointsCles: ['un', 'deux'], arbitrages: ['trois'],
  decisions: [{
    id: 'd1', question: 'Q ?', contexte: 'ctx', recommandation: 1,
    choix: [{ libelle: 'Oui', reponse: '1. oui' }, { libelle: 'Non' }],
    exemple: { type: 'comparaison', gauche: { titre: 'Avant', code: 'a', ton: 'mauvais', chemin: 'x', hauteur: 100 },
      droite: { titre: 'Après', texte: 'b', ton: 'bon' } },
  }, { id: 'd2', question: 'Q2', exemple: { type: 'situation', texte: 't', langage: 'js', code: 'c' } }],
  maquettes: [{ titre: 'M', chemin: path.join(dir, 'fichiers', 'n-abc', '1-m.html'), hauteur: 600,
    versions: [{ libelle: 'v1', chemin: 'E:\\x\\v1.html' }] }],
  architecture: { niveau: 'composants', couches: [{ nom: 'Front', large: true, elements: [
    { op: '+', nom: 'Comp', detail: 'd', utiliseDans: ['X'], exemple: { type: 'situation', code: 'x', langage: 'ts' } }] }] },
  bdd: { mermaid: 'erDiagram', notes: 'n' },
  fichiers: [{ chemin: 'E:\\a.txt', libelle: 'A', note: 'n' }, { url: 'https://x' }],
  images: [{ chemin: 'E:\\i.png', legende: 'L' }],
  cases: [{ libelle: 'x', fait: true }],
  grille: { colonnes: ['a'], lignes: [['1']] },
});

const englishSession = dir => ({
  slug: 'n-abc', title: 'nouvelle session', autoTitle: 'nouvelle session', ticket: '2702', ticketUrl: 'https://x/2702',
  description: 'Une description', project: 'app', cwd: 'D:\\app', mode: 'ask', status: 'working',
  statusSummary: 'prête', step: 'mockup', driven: true, sessionId: 'sid', model: 'claude-opus-5-5',
  titlePinned: false, updatedAt: '2026-11-12T00:00:00.000Z', endedAt: '2026-11-12T01:00:00.000Z',
  seen: { n: 3, id: 'ev-1' }, reportedSchemas: { db: 'abc123' }, inconnue: { garde: 1 },
  stats: { claudeMs: 10, exchanges: 2, activeMs: 5, newItems: 3, context: 1000, window: 200000,
    achievements: { autonomous: 1, tools: 40, lines: 300, contextPct: 12, launched: 1, lastExchange: 'x', start: 'y', compactions: 2 } },
  progress: [{ label: 'Cadrage', state: 'done' }, { label: 'Code', state: 'working' }, { label: 'Push', state: 'todo' }],
  approach: { chosen: 'A', why: 'simple', alternatives: [{ name: 'B', reason: 'lent' }] },
  keyPoints: ['un', 'deux'], tradeoffs: ['trois'],
  decisions: [{
    id: 'd1', question: 'Q ?', context: 'ctx', recommendation: 1,
    choices: [{ label: 'Oui', answer: '1. oui' }, { label: 'Non' }],
    example: { type: 'comparison', left: { title: 'Avant', code: 'a', tone: 'bad', path: 'x', height: 100 },
      right: { title: 'Après', text: 'b', tone: 'good' } },
  }, { id: 'd2', question: 'Q2', example: { type: 'situation', text: 't', language: 'js', code: 'c' } }],
  mockups: [{ title: 'M', path: path.join(dir, 'files', 'n-abc', '1-m.html'), height: 600,
    versions: [{ label: 'v1', path: 'E:\\x\\v1.html' }] }],
  architecture: { level: 'components', layers: [{ name: 'Front', wide: true, elements: [
    { op: '+', name: 'Comp', detail: 'd', usedIn: ['X'], example: { type: 'situation', code: 'x', language: 'ts' } }] }] },
  db: { mermaid: 'erDiagram', notes: 'n' },
  files: [{ path: 'E:\\a.txt', label: 'A', note: 'n' }, { url: 'https://x' }],
  images: [{ path: 'E:\\i.png', caption: 'L' }],
  checklist: [{ label: 'x', done: true }],
  grille: { columns: ['a'], rows: [['1']] },
});

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dash-migration-'));
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (dir, rel, data) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};

function frenchFolder() {
  const root = tmpDir(), dir = path.join(root, '.claude-dashboard');
  write(dir, 'sessions/n-abc.json', frenchSession(dir));
  write(dir, 'sessions/archive/n-old.json', { ...frenchSession(dir), slug: 'n-old', statut: 'termine', archiveeLe: 'z' });
  write(dir, 'sessions/archive/n-old/abcd-m.html', '<html></html>');
  write(dir, 'options.json', { archivageJours: 3, autoCompact: 'defaut', language: 'fr' });
  write(dir, 'groupes.json', [{ id: 'g1', nom: 'App', projets: ['d:/app'], couleur: '#f59e0b' }]);
  write(dir, 'projets.json', ['D:\\app']);
  write(dir, 'projets-meta.json', { 'd:/lib': { nom: 'Lib', couleur: '#3b82f6', icone: '🛠️' } });
  write(dir, 'ordres.json', { 'd:/app': ['n-abc'], 'projets:libres': ['d:/lib'] });
  write(dir, 'icones.json', { 'd:/lib': 'data:x' });
  write(dir, 'acces.json', {
    appareils: [{ id: 'd', jeton: 'h', nom: 'Chrome', ua: 'UA', ip: '1.2.3.4', cree: 'c', vu: 'v', approuve: true, approuveLe: 'a' }],
    domaine: 'x.fr', motDePasse: { sel: 's', hash: 'h' }, relais: [{ domaine: 'y.x.fr', cible: '10.0.0.2' }], viaRelais: '', portHttp: 80,
  });
  write(dir, 'acces.log', 'log\n');
  write(dir, 'reseau.json', { lan: true });
  write(dir, 'fenetre.json', { bounds: { x: 1, y: 2, width: 3, height: 4 }, maximise: true });
  write(dir, 'suivi.json', { profil: 'dev' });
  write(dir, 'suivis/depots/App.json', {
    id: 'perso', nom: 'Perso', etapes: [{ cle: 'cadrage', libelle: 'Cadrage' }, { cle: 'livre', libelle: 'Livré' }],
    methode: 'm', types: { jalon: { rendu: 'frise', champs: [{ cle: 'titre', type: 'texte' }, { cle: 'quand', type: 'date' }] } },
    blocs: [{ cle: 'avancement', type: 'avancement' }, { cote: [{ cle: 'pointsCles', type: 'liste', titre: 'Points' }, { cle: 'jalons', type: 'jalon', consigne: 'c' }] }],
  });
  write(dir, 'progression.json', {
    version: 1, debut: 'd', xpActivite: 237, xpJour: { date: '2026-11-13', xp: 237 },
    records: { 'premier-vol': { valeur: 1, journal: [[1, 't', 'n-abc']] }, outils: { valeur: 41, journal: [] }, go: { valeur: 2, journal: [] } },
    annonces: ['premier-vol:0', 'outils:1'], vus: ['premier-vol:0'],
    jours: { nuits: ['2026-11-01'], matins: [], weekends: [], globe: [], serie: { dernier: '2026-11-13', n: 1 } },
    decisions: { serieReco: 2 },
    forfait: { plan: 'max', resetSemaine: 1, jour: 'j', dernierPct: 61, consoJour: 0, pctMaxSemaine: 61, planChange: false, joursReleves: ['j'], fenetres5h: [], semainesPleines: [] },
    sessionCreee: true,
  });
  write(dir, 'fichiers/n-abc/1-m.html', '<html>m</html>');
  write(dir, 'caddy/Caddyfile', 'x');
  return { root, dir };
}

test('migrateSession converts a full French dev board', () => {
  const dir = path.join(os.tmpdir(), 'x-dash');
  assert.deepEqual(migrateSession(frenchSession(dir), { dir }), englishSession(dir));
});

test('migrateSession leaves English input unchanged (same object) and converts subsets', () => {
  const dir = path.join(os.tmpdir(), 'x-dash');
  const en = englishSession(dir);
  assert.equal(migrateSession(en, { dir }), en);
  assert.deepEqual(migrateSession({ titre: 'T', etape: 'cadrage', statut: 'attend', resumeStatut: 'r' }),
    { title: 'T', step: 'framing', status: 'waiting', statusSummary: 'r' });
  assert.deepEqual(migrateSession({ statut: 'termine', etape: 'livre' }), { status: 'done', step: 'delivered' });
});

test('migrateProfile: full profile, reference and legacy format', () => {
  assert.deepEqual(migrateProfile({ profil: 'dev' }), { profile: 'dev' });
  assert.deepEqual(migrateProfile({ defaut: 'dev', projets: {} }), { profile: 'dev' });
  assert.deepEqual(migrateProfile({ defaut: 'autre' }), { profile: 'simple' });
  const p = migrateProfile({ id: 'dev', nom: 'Suivi de dev', etapes: [{ cle: 'execution', libelle: 'Exécution' }], blocs: [{ cle: 'bdd', type: 'bdd', titre: 'BDD' }, { cle: 't', type: 'tableau' }] });
  assert.deepEqual(p, { id: 'dev', name: 'Dev tracker', steps: [{ key: 'execution', label: 'Exécution' }], blocks: [{ key: 'db', type: 'db', title: 'BDD' }, { key: 't', type: 'table' }] });
  assert.deepEqual(migrateProfile(p), p);
});

test('migrateDataPath moves attachment paths of the data folder only', () => {
  const dir = path.join(os.tmpdir(), 'x-dash');
  assert.equal(migrateDataPath(path.join(dir, 'fichiers', 'a', 'b.png'), dir), path.join(dir, 'files', 'a', 'b.png'));
  assert.equal(migrateDataPath(path.join(dir, 'suivi.json'), dir), path.join(dir, 'tracker.json'));
  assert.equal(migrateDataPath('E:\\fichiers\\b.png', dir), 'E:\\fichiers\\b.png');
});

test('migrate converts a whole French data folder, backs it up, and is idempotent', () => {
  const { root, dir } = frenchFolder();
  try {
    const r = migrate({ dir, log: null });
    assert.equal(r.migrated, true);
    const ls = fs.readdirSync(dir).sort();
    assert.deepEqual(ls, ['access.json', 'access.log', 'caddy', 'files', 'groups.json', 'icons.json', 'network.json',
      'options.json', 'orders.json', 'progress.json', 'projects-meta.json', 'projects.json', 'sessions', 'tracker.json',
      'trackers', 'version.json', 'window.json']);
    assert.deepEqual(readJson(path.join(dir, 'sessions/n-abc.json')), englishSession(dir));
    const arch = readJson(path.join(dir, 'sessions/archive/n-old.json'));
    assert.equal(arch.status, 'done');
    assert.equal(arch.archivedAt, 'z');
    assert.ok(fs.existsSync(path.join(dir, 'sessions/archive/n-old/abcd-m.html')));
    assert.deepEqual(readJson(path.join(dir, 'options.json')), { archiveAfterDays: 3, autoCompact: 'default', language: 'fr' });
    assert.deepEqual(readJson(path.join(dir, 'groups.json')), [{ id: 'g1', name: 'App', projects: ['d:/app'], color: '#f59e0b' }]);
    assert.deepEqual(readJson(path.join(dir, 'projects-meta.json')), { 'd:/lib': { name: 'Lib', color: '#3b82f6', icon: '🛠️' } });
    assert.deepEqual(readJson(path.join(dir, 'orders.json')), { 'd:/app': ['n-abc'], 'projects:ungrouped': ['d:/lib'] });
    assert.deepEqual(readJson(path.join(dir, 'access.json')), {
      devices: [{ id: 'd', token: 'h', name: 'Chrome', ua: 'UA', ip: '1.2.3.4', created: 'c', seen: 'v', approved: true, approvedAt: 'a' }],
      domain: 'x.fr', password: { salt: 's', hash: 'h' }, relays: [{ domain: 'y.x.fr', target: '10.0.0.2' }], viaRelay: '', httpPort: 80,
    });
    assert.deepEqual(readJson(path.join(dir, 'window.json')), { bounds: { x: 1, y: 2, width: 3, height: 4 }, maximized: true });
    assert.deepEqual(readJson(path.join(dir, 'tracker.json')), { profile: 'dev' });
    assert.deepEqual(readJson(path.join(dir, 'trackers/repos/App.json')), {
      id: 'perso', name: 'Perso', steps: [{ key: 'framing', label: 'Cadrage' }, { key: 'delivered', label: 'Livré' }],
      method: 'm', types: { jalon: { layout: 'timeline', fields: [{ key: 'title', type: 'text' }, { key: 'quand', type: 'date' }] } },
      blocks: [{ key: 'progress', type: 'progress' }, { sideBySide: [{ key: 'keyPoints', type: 'list', title: 'Points' }, { key: 'jalons', type: 'jalon', instruction: 'c' }] }],
    });
    assert.deepEqual(readJson(path.join(dir, 'progress.json')), {
      version: 1, start: 'd', activityXp: 237, dayXp: { date: '2026-11-13', xp: 237 },
      records: { 'first-flight': { value: 1, log: [[1, 't', 'n-abc']] }, toolbox: { value: 41, log: [] }, go: { value: 2, log: [] } },
      announcements: ['first-flight:0', 'toolbox:1'], seen: ['first-flight:0'],
      days: { nights: ['2026-11-01'], mornings: [], weekends: [], globe: [], streak: { last: '2026-11-13', n: 1 } },
      decisions: { recoStreak: 2 },
      plan: { plan: 'max', weekReset: 1, day: 'j', lastPct: 61, dayUsage: 0, weekMaxPct: 61, planChanged: false, sampledDays: ['j'], windows5h: [], fullWeeks: [] },
      sessionCreated: true,
    });
    assert.equal(fs.readFileSync(path.join(dir, 'files/n-abc/1-m.html'), 'utf8'), '<html>m</html>');
    // Backup: the untouched French folder, without caddy/ and fichiers/
    const backup = `${dir}-backup-fr`;
    assert.ok(fs.existsSync(path.join(backup, 'groupes.json')));
    assert.equal(readJson(path.join(backup, 'sessions/n-abc.json')).titre, 'nouvelle session');
    assert.ok(!fs.existsSync(path.join(backup, 'caddy')) && !fs.existsSync(path.join(backup, 'fichiers')));

    // Second run: marker found, nothing touched
    const before = fs.statSync(path.join(dir, 'sessions/n-abc.json')).mtimeMs;
    assert.deepEqual(migrate({ dir, log: null }), { done: true });
    assert.equal(fs.statSync(path.join(dir, 'sessions/n-abc.json')).mtimeMs, before);
    // Marker removed: steps run again but change nothing
    fs.rmSync(path.join(dir, 'version.json'));
    const again = migrate({ dir, log: null });
    assert.deepEqual(again.report, []);
    assert.deepEqual(readJson(path.join(dir, 'sessions/n-abc.json')), englishSession(dir));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migrate on a missing folder creates it with the marker only', () => {
  const root = tmpDir(), dir = path.join(root, 'neuf');
  try {
    migrate({ dir, log: null });
    assert.deepEqual(fs.readdirSync(dir), ['version.json']);
    assert.ok(!fs.existsSync(`${dir}-backup-fr`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('two processes migrating at the same time', async () => {
  const { root, dir } = frenchFolder();
  try {
    const run = () => new Promise((resolve, reject) => {
      const code = `import { migrate } from ${JSON.stringify(MODULE)}; migrate({ log: null });`;
      const p = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, DASH_DIR: dir }, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', d => { err += d; });
      p.on('exit', c => (c === 0 ? resolve() : reject(new Error(err))));
    });
    await Promise.all([run(), run(), run()]);
    assert.deepEqual(readJson(path.join(dir, 'sessions/n-abc.json')), englishSession(dir));
    assert.equal(readJson(path.join(dir, 'progress.json')).records.toolbox.value, 41);
    assert.ok(!fs.existsSync(path.join(dir, '.migration.lock')));
    assert.ok(!fs.existsSync(path.join(dir, 'progression.json')));
    assert.ok(fs.existsSync(path.join(`${dir}-backup-fr`, 'progression.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
