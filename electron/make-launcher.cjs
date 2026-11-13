// Makes the app launcher: a renamed copy of Electron, with the control tower icon, that loads the code of the repo
// where it is (nothing is bundled: an F5 is still enough for public/, a restart for main.cjs).
// The resources/app folder of the copy only holds a package.json and an index.cjs that require()s
// electron/main.cjs; it carries the same app name, hence the same settings and single instance as with npm run app.
// The display name ("Claude Dashboard" or "Tableau de bord Claude") follows the language when the launcher is made.
//   Windows: launcher/win/<name>.exe (icon and description set by rcedit), Start menu and desktop shortcuts
//            redone on it;
//   macOS  : launcher/mac/<name>.app (.icns icon, name and identifier in Info.plist, ad hoc signature);
//   Linux  : launcher/linux/claude-dashboard and an entry in ~/.local/share/applications.
// To redo after an Electron update or a move of the repo, with the app quit.
// Run: npm run launcher
const { app, nativeImage, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadI18n } = require('./language.cjs');

let NAME = 'Claude Dashboard'; // set from the dictionary at startup (electron.appName)
const BUNDLE_ID = 'io.github.claude-dashboard';
const ROOT = path.join(__dirname, '..');
const ICONS = path.join(__dirname, 'icons');
const DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const OUTPUT = path.join(ROOT, 'launcher');
const RCEDIT = 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe';
process.noAsar = true; // the .asar files of dist are copied and deleted as files, not as folders

/** resources/app folder: points to the code of the repo. */
function writeApp(resources) {
  const dir = path.join(resources, 'app');
  fs.mkdirSync(dir, { recursive: true });
  const { name, version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, main: 'index.cjs' }, null, 2));
  fs.writeFileSync(path.join(dir, 'index.cjs'), `require(${JSON.stringify(path.join(__dirname, 'main.cjs'))});\n`);
  fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
}

/** Fresh copy of dist in launcher/<platform> (fails if the app is running from this copy). */
function copy(platform) {
  const target = path.join(OUTPUT, platform);
  try { fs.rmSync(target, { recursive: true, force: true }); } catch (e) {
    throw new Error(`cannot replace ${target}: quit the app first (${e.code})`);
  }
  fs.mkdirSync(OUTPUT, { recursive: true });
  // cp -a / ditto keep the symbolic links and permissions of the macOS frameworks and of the Linux chrome-sandbox
  if (process.platform === 'darwin') execFileSync('ditto', [DIST, target]);
  else if (process.platform === 'linux') execFileSync('cp', ['-a', DIST, target]);
  else fs.cpSync(DIST, target, { recursive: true });
  return target;
}

async function windows() {
  const target = copy('win');
  const exe = path.join(target, `${NAME}.exe`);
  fs.renameSync(path.join(target, 'electron.exe'), exe);
  writeApp(path.join(target, 'resources'));

  const rcedit = path.join(OUTPUT, '.tools', 'rcedit-x64.exe');
  if (!fs.existsSync(rcedit)) {
    const res = await fetch(RCEDIT);
    if (!res.ok) throw new Error(`rcedit download: HTTP ${res.status}`);
    fs.mkdirSync(path.dirname(rcedit), { recursive: true });
    fs.writeFileSync(rcedit, Buffer.from(await res.arrayBuffer()));
  }
  execFileSync(rcedit, [exe, '--set-icon', path.join(ICONS, 'app.ico'),
    '--set-version-string', 'FileDescription', NAME, '--set-version-string', 'ProductName', NAME,
    '--set-version-string', 'OriginalFilename', `${NAME}.exe`, '--set-version-string', 'InternalName', NAME]);

  // Same identifier as app.setAppUserModelId: the window is grouped under the pinned shortcut
  const link = { target: exe, icon: exe, iconIndex: 0, appUserModelId: 'claude-dashboard', description: NAME };
  const shortcuts = [path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), app.getPath('desktop')]
    .map(d => path.join(d, `${NAME}.lnk`));
  for (const s of shortcuts) shell.writeShortcutLink(s, 'create', link);
  return [exe, ...shortcuts];
}

/** .icns file made of PNG images (types ic07 to ic10: 128 to 1024 px). */
function icns(source) {
  const blocks = [['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]].map(([type, n]) => {
    const png = source.resize({ width: n, height: n, quality: 'best' }).toPNG();
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii'); header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii'); header.writeUInt32BE(8 + blocks.reduce((s, b) => s + b.length, 0), 4);
  return Buffer.concat([header, ...blocks]);
}

function mac() {
  const target = copy('mac');
  const bundle = path.join(target, `${NAME}.app`);
  fs.renameSync(path.join(target, 'Electron.app'), bundle);
  const contents = path.join(bundle, 'Contents');
  writeApp(path.join(contents, 'Resources'));
  fs.writeFileSync(path.join(contents, 'Resources', 'electron.icns'), icns(nativeImage.createFromPath(path.join(ICONS, 'source.png'))));
  const plist = path.join(contents, 'Info.plist');
  const setKey = (text, key, value) => text.replace(new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*`), `$1${value}`);
  let text = fs.readFileSync(plist, 'utf8');
  text = setKey(setKey(setKey(text, 'CFBundleName', NAME), 'CFBundleDisplayName', NAME), 'CFBundleIdentifier', BUNDLE_ID);
  fs.writeFileSync(plist, text);
  // The modified copy no longer has a valid signature: without an ad hoc signature, macOS (Apple Silicon) refuses to launch it
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle]);
  return [bundle];
}

function linux() {
  const target = copy('linux');
  const binary = path.join(target, 'claude-dashboard');
  fs.renameSync(path.join(target, 'electron'), binary);
  writeApp(path.join(target, 'resources'));
  const entry = path.join(os.homedir(), '.local', 'share', 'applications', 'claude-dashboard.desktop');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, ['[Desktop Entry]', 'Type=Application', `Name=${NAME}`, `Exec="${binary}"`,
    `Icon=${path.join(ICONS, 'app.png')}`, 'StartupWMClass=claude-dashboard', 'Categories=Development;', ''].join('\n'));
  return [binary, entry];
}

app.whenReady().then(async () => {
  try {
    const { t } = await loadI18n(app);
    NAME = t('electron.appName');
    const made = process.platform === 'win32' ? await windows() : process.platform === 'darwin' ? mac() : linux();
    console.log('launcher made:\n  ' + made.join('\n  '));
  } catch (e) {
    console.error('failed:', e.message);
    process.exitCode = 1;
  }
  app.quit();
});
