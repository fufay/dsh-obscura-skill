#!/usr/bin/env node
// P2（无状态）：调用 Obscura fetch 抓页面（可渲染截图）。
// 用法:
//   node fetch.mjs <url> [--dump markdown|html|text|links|assets|cookies|original]
//                      [--eval EXPR] [--screenshot out.png] [--wait 5] [--wait-until load]
//                      [--selector CSS] [--timeout 30] [--proxy URL] [--stealth]
//                      [--storage-dir DIR] [--user-agent UA] [--obey-robots]
//                      [--allow-private-network] [--json] [--quiet] [-- <透传>]
// 输出: 默认原样透传 stdout；--json 输出 {ok,url,output,screenshot}（多 URL 为数组）
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
  console.error('用法: node fetch.mjs <url…> [--dump markdown] [--screenshot out.png] [--eval EXPR] [--wait 5] [--json]');
  process.exit(2);
}

const take = (name) => { const i = argv.indexOf('--' + name); if (i < 0 || !argv[i + 1]) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = (name) => { const i = argv.indexOf('--' + name); if (i < 0) return false; argv.splice(i, 1); return true; };

const dump = take('dump');
const evalExpr = take('eval');
const screenshot = take('screenshot');
const wait = take('wait');
const waitUntil = take('wait-until');
const selector = take('selector');
const timeout = take('timeout');
const proxy = take('proxy');
const storageDir = take('storage-dir');
const userAgent = take('user-agent');
const stealth = flag('stealth');
const obey = flag('obey-robots');
const allowPrivate = flag('allow-private-network');
const quiet = flag('quiet');
const json = flag('json');
const sep = argv.indexOf('--');
const passthru = sep >= 0 ? argv.splice(sep + 1) : [];
const urls = argv.filter((a) => !a.startsWith('--'));

if (!urls.length) { console.error('[fetch] 缺少 URL'); process.exit(2); }

const bin = execFileSync(process.execPath, [join(HERE, 'resolve.mjs')], { encoding: 'utf8' }).trim();
const mode = dump || (screenshot ? null : 'markdown');

function runOne(url, i) {
  const args = ['fetch', url];
  if (mode) args.push('--dump', mode);
  if (evalExpr) args.push('--eval', evalExpr);
  if (screenshot) args.push('--screenshot', urls.length === 1 ? screenshot : screenshot.replace(/(\.[a-z]+)$/i, `-${i + 1}$1`));
  if (wait) args.push('--wait', wait);
  if (waitUntil) args.push('--wait-until', waitUntil);
  if (selector) args.push('--selector', selector);
  if (timeout) args.push('--timeout', timeout);
  if (proxy) args.push('--proxy', proxy);
  if (storageDir) args.push('--storage-dir', storageDir);
  if (userAgent) args.push('--user-agent', userAgent);
  if (stealth) args.push('--stealth');
  if (obey) args.push('--obey-robots');
  if (allowPrivate) args.push('--allow-private-network');
  if (quiet) args.push('--quiet');
  args.push(...passthru);

  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: (Number(timeout) || 30) * 1000 + 15000 });
  const out = { ok: r.status === 0, url, output: (r.stdout || '').trim(), stderr: (r.stderr || '').trim().split('\n').slice(-3).join('\n') };
  if (screenshot) {
    const file = urls.length === 1 ? screenshot : screenshot.replace(/(\.[a-z]+)$/i, `-${i + 1}$1`);
    out.screenshot = fs.existsSync(file) ? file : null;
  }
  return out;
}

const results = urls.map(runOne);
if (json) console.log(JSON.stringify(urls.length === 1 ? results[0] : results, null, 2));
else for (const r of results) { if (r.output) console.log(r.output); if (!r.ok) console.error(`[fetch] 失败 ${r.url}: ${r.stderr}`); }
process.exit(results.every((r) => r.ok) ? 0 : 1);
