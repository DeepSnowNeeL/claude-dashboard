import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathKey as pageKey } from '../public/core/path-key.js';
import { pathKey as serverKey } from '../projects.mjs';
import { wslPath, linuxToWindows, windowsToLinux, gitCommand } from '../git-exec.mjs';

const WIN = process.platform === 'win32';
const WSL_SESSION = '\\\\wsl.localhost\\Ubuntu-22.04\\home\\alan\\workspace\\kpax';
const WSL_GROUP = '//wsl.localhost/ubuntu-22.04/home/alan/workspace/kpax'; // as stored in groups.json

test('page key: a WSL folder matches whatever the case of the distro', () => {
  assert.equal(pageKey(WSL_SESSION), WSL_GROUP);
  assert.equal(pageKey(WSL_SESSION + '\\'), WSL_GROUP);
  assert.ok(pageKey(WSL_SESSION + '\\tmp\\wt-1').startsWith(pageKey(WSL_GROUP) + '/'));
  assert.equal(pageKey('\\\\wsl$\\Ubuntu\\home'), '//wsl$/ubuntu/home');
});

test('page key: drive paths are case-insensitive, POSIX paths keep their case', () => {
  assert.equal(pageKey('D:\\Projects\\App\\'), 'd:/projects/app');
  assert.equal(pageKey('/home/Alan/App/'), '/home/Alan/App');
  assert.equal(pageKey(''), '');
  assert.equal(pageKey(null), '');
});

test('server and page keys agree on Windows paths', { skip: !WIN }, () => {
  for (const p of [WSL_SESSION, WSL_GROUP, 'D:\\Projects\\App', 'd:/projects/app/']) assert.equal(serverKey(p), pageKey(p));
  assert.equal(serverKey(WSL_SESSION), WSL_GROUP);
});

test('wslPath: distro, prefix and Linux path of a WSL folder', () => {
  assert.deepEqual(wslPath(WSL_SESSION), { distro: 'Ubuntu-22.04', prefix: '\\\\wsl.localhost\\Ubuntu-22.04', linux: '/home/alan/workspace/kpax' });
  assert.deepEqual(wslPath('//wsl$/Debian/'), { distro: 'Debian', prefix: '\\\\wsl$\\Debian', linux: '/' });
  assert.equal(wslPath('D:\\projects\\app'), null);
  assert.equal(wslPath('\\\\server\\share\\x'), null);
  assert.equal(wslPath('/home/alan'), null);
});

test('paths printed by the git of a distribution, as Windows sees them', () => {
  const prefix = '\\\\wsl.localhost\\Ubuntu-22.04';
  assert.equal(linuxToWindows('/home/alan/workspace/kpax/tmp/wt-1', prefix), `${prefix}\\home\\alan\\workspace\\kpax\\tmp\\wt-1`);
  assert.equal(linuxToWindows('/mnt/d/projects/app', prefix), 'D:\\projects\\app');
  assert.equal(linuxToWindows('/mnt/c', prefix), 'C:\\');
  // A worktree created by the Windows git keeps its //wsl.localhost/… path
  assert.equal(linuxToWindows('//wsl.localhost/Ubuntu-22.04/home/x', prefix), '\\\\wsl.localhost\\Ubuntu-22.04\\home\\x');
});

test('paths given to the git of a distribution', () => {
  assert.equal(windowsToLinux(WSL_SESSION + '-feat'), '/home/alan/workspace/kpax-feat');
  assert.equal(windowsToLinux('D:\\projects\\App'), '/mnt/d/projects/App');
  assert.equal(windowsToLinux('/already/linux'), '/already/linux');
});

test('git command: wsl.exe for a WSL folder on Windows, git elsewhere', () => {
  assert.deepEqual(gitCommand('D:\\projects\\app', ['status']), ['git', ['-C', 'D:\\projects\\app', 'status']]);
  if (WIN) assert.deepEqual(gitCommand(WSL_SESSION, ['status']), ['wsl.exe', ['-d', 'Ubuntu-22.04', '--exec', 'git', '-C', '/home/alan/workspace/kpax', 'status']]);
  else assert.deepEqual(gitCommand(WSL_SESSION, ['status']), ['git', ['-C', WSL_SESSION, 'status']]);
});
