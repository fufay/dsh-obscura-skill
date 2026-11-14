#!/usr/bin/env node
// 用 GitHub Release API 的 JSON 刷新 manifest 里的上游资产（size/sha256），并可选更新 OHOS 资产。
// 用法:
//   node tools/update-manifest.mjs --release-json <rel.json> [--ohos render.tar.gz] [--ohos-stealth stealth.tar.gz]
//   node tools/update-manifest.mjs --fetch v0.2.7           # 直接拉 API（需网络/代理）
// 说明: GitHub API 的 asset.digest 形如 "sha256:..."；无 digest 时回退为 null（需手工补）。
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'skill', 'dsh-obscura', 'assets', 'manifest.json');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const mapping = {
  'obscura-x86_64-linux.tar.gz': ['linux', 'x86_64', 'glibc'],
  'obscura-aarch64-linux.tar.gz': ['linux', 'aarch64', 'glibc'],
  'obscura-aarch64-macos.tar.gz': ['darwin', 'aarch64', 'darwin'],
  'obscura-x86_64-macos.tar.gz': ['darwin', 'x86_64', 'darwin'],
  'obscura-x86_64-windows.zip': ['win32', 'x86_64', 'msvc'],
};

let rel = null;
if (opt('release-json')) rel = JSON.parse(fs.readFileSync(opt('release-json'), 'utf8'));
else if (opt('fetch')) {
  const tag = opt('fetch');
  const res = await fetch(`https://api.github.com/repos/h4ckf0r0day/obscura/releases/tags/${tag}`, {
    headers: { 'User-Agent': 'dsh-obscura-skill', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) { console.error(`[manifest] GitHub API HTTP ${res.status}`); process.exit(1); }
  rel = await res.json();
}
if (!rel) { console.error('用法: node tools/update-manifest.mjs --release-json rel.json | --fetch v0.2.7'); process.exit(2); }

const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
m.release_tag = rel.tag_name;
m.upstream.tag = rel.tag_name;
m.upstream.fetched_at = new Date().toISOString().slice(0, 10);
let n = 0;
for (const a of m.assets) {
  if (a.source !== 'upstream') continue;
  const hit = (rel.assets || []).find((x) => x.name === a.file);
  if (!hit) { console.error(`[manifest] release 里没有 ${a.file}`); continue; }
  a.size = hit.size;
  a.sha256 = hit.digest ? String(hit.digest).replace(/^sha256:/, '') : null;
  const [os, arch, libc] = mapping[a.file] || [];
  if (os) Object.assign(a, { os, arch, libc });
  n++;
}
for (const [flag, variant] of [['ohos', 'render'], ['ohos-stealth', 'stealth']]) {
  const file = opt(flag);
  if (!file) continue;
  const buf = fs.readFileSync(file);
  const e = m.assets.find((x) => x.os === 'openharmony' && (x.variant || 'render') === variant);
  if (e) { e.size = buf.length; e.sha256 = createHash('sha256').update(buf).digest('hex'); delete e.notes; }
  else console.error(`[manifest] 没有 openharmony/${variant} 条目`);
}
m.generated_at = new Date().toISOString();
fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
console.log(`[manifest] 更新 ${n} 条上游资产${opt('ohos') ? ' + OHOS render' : ''}${opt('ohos-stealth') ? ' + OHOS stealth' : ''} → ${MANIFEST}`);
