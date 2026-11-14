#!/usr/bin/env node
// P3（有状态）：管理 Obscura serve（CDP 服务）生命周期。
// 用法:
//   node serve.mjs start|ensure|stop|restart|status [--port 9222] [--font-dir DIR]…
//                  [--storage-dir DIR] [--proxy URL] [--stealth] [--workers N] [--json]
// 说明: 只监听 127.0.0.1；默认 storage-dir 固定（cookie/localStorage 跨重启保留）；
//       OHOS 上自动把 /system/fonts 加进 --font-dir（否则 CJK 渲染成方块）。
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = process.env.DSH_OBSCURA_CACHE || join(homedir(), '.cache', 'dsh-obscura');
const STATE_DIR = join(CACHE, 'serve');
const argv = process.argv.slice(2);
const cmd = argv[0] || 'status';
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const optAll = (n) => argv.flatMap((a, i) => (a === '--' + n && argv[i + 1] ? [argv[i + 1]] : []));
const flag = (n) => argv.includes('--' + n);
const json = flag('json');
const port = Number(opt('port', '9222'));
const stateFile = join(STATE_DIR, `serve-${port}.json`);
const logFile = join(STATE_DIR, `serve-${port}.log`);

const loadState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; } };
const saveState = (s) => { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(s, null, 2)); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function health() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

function binPath() {
  const variant = flag('stealth') ? 'stealth' : (process.env.DSH_OBSCURA_VARIANT || 'render');
  return execFileSync(process.execPath, [join(HERE, 'resolve.mjs')], { encoding: 'utf8', env: { ...process.env, DSH_OBSCURA_VARIANT: variant } }).trim();
}

function fontDirs() {
  const dirs = optAll('font-dir');
  if (!dirs.length && process.platform === 'openharmony' && fs.existsSync('/system/fonts')) dirs.push('/system/fonts');
  return dirs;
}

function storageDir() {
  return opt('storage-dir', join(STATE_DIR, `storage-${port}`));
}

async function start() {
  const existing = await health();
  if (existing) { const o = { started: false, alreadyRunning: true, port, ...existing }; console.log(JSON.stringify(o)); return; }
  const bin = binPath();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const args = ['serve', '--host', '127.0.0.1', '--port', String(port), '--storage-dir', storageDir()];
  for (const d of fontDirs()) args.push('--font-dir', d);
  if (opt('proxy', null)) args.push('--proxy', opt('proxy', null));
  if (opt('workers', null)) args.push('--workers', opt('workers', null));
  if (flag('stealth')) args.push('--stealth');
  if (opt('user-agent', null)) args.push('--user-agent', opt('user-agent', null));
  if (flag('allow-private-network')) args.push('--allow-private-network');

  for (let attempt = 1; attempt <= 3; attempt++) {
    const fd = fs.openSync(logFile, 'a');
    const child = spawn(bin, args, { detached: true, stdio: ['ignore', fd, fd], env: { ...process.env } });
    child.unref();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const h = await health();
      if (h) {
        const st = { pid: child.pid, port, started_at: new Date().toISOString(), log: logFile, storage: storageDir(), ws: h.webSocketDebuggerUrl };
        saveState(st);
        console.log(JSON.stringify({ started: true, attempt, ...st }));
        return;
      }
      if (!alive(child.pid)) break;
    }
    console.error(`[serve] 第 ${attempt} 次启动失败，重试（日志 ${logFile}）`);
  }
  console.error('[serve] 启动失败，日志: ' + logFile);
  process.exit(6);
}

async function stop() {
  const s = loadState();
  if (!s) { console.log(JSON.stringify({ stopped: false, reason: 'no state' })); return; }
  try { process.kill(s.pid, 'SIGTERM'); } catch {}
  await new Promise((r) => setTimeout(r, 800));
  try { if (alive(s.pid)) process.kill(s.pid, 'SIGKILL'); } catch {}
  fs.rmSync(stateFile, { force: true });
  console.log(JSON.stringify({ stopped: true, pid: s.pid, port: s.port }));
}

async function status() {
  const s = loadState();
  const h = await health();
  const o = { state: s, healthy: !!h, ws: h?.webSocketDebuggerUrl ?? null, port };
  console.log(json ? JSON.stringify(o, null, 2) : JSON.stringify(o, null, 2));
}

switch (cmd) {
  case 'start': await start(); break;
  case 'ensure': { const h = await health(); if (h) console.log(JSON.stringify({ started: false, healthy: true, port, ...h })); else await start(); break; }
  case 'stop': await stop(); break;
  case 'restart': await stop(); await start(); break;
  case 'status': await status(); break;
  default: console.error('用法: node serve.mjs start|ensure|stop|restart|status [--port 9222] [--font-dir DIR]'); process.exit(2);
}
