#!/usr/bin/env node
// 解析/下载本平台的 Obscura 二进制（含 OHOS 自建 musl 资产）。
// 用法: node resolve.mjs [--check] [--json] [--force]
// 默认输出二进制路径（一行），供其它脚本 execFileSync 取用。
// 环境变量:
//   DSH_OBSCURA_CACHE        缓存目录（默认 ~/.cache/dsh-obscura）
//   DSH_OBSCURA_LOCAL_DIR    离线目录：内含对应归档文件（或已解压的 obscura）即可，不联网
//   DSH_OBSCURA_ASSET_BASE   自定义下载基址（末尾无斜杠）
//   DSH_OBSCURA_ASSET        强制指定资产文件名（调试用）
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(fs.readFileSync(join(HERE, '..', 'assets', 'manifest.json'), 'utf8'));
const TAG = MANIFEST.release_tag;
const CACHE = process.env.DSH_OBSCURA_CACHE || join(homedir(), '.cache', 'dsh-obscura');
const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
const VARIANT = process.env.DSH_OBSCURA_VARIANT || 'render';

function fail(msg, code = 1) { console.error('[resolve] ' + msg); process.exit(code); }

function platformAsset() {
  if (process.env.DSH_OBSCURA_ASSET) {
    const a = MANIFEST.assets.find((x) => x.file === process.env.DSH_OBSCURA_ASSET);
    if (!a) fail(`manifest 里没有资产 ${process.env.DSH_OBSCURA_ASSET}`, 4);
    return a;
  }
  const p = process.platform, a = process.arch;
  const arch = a === 'arm64' || a === 'aarch64' ? 'aarch64' : a === 'x64' || a === 'x86_64' ? 'x86_64' : a;
  const os = p === 'openharmony' ? 'openharmony' : p === 'linux' ? 'linux' : p === 'darwin' ? 'darwin' : p === 'win32' ? 'win32' : null;
  if (!os) fail(`不支持的平台: ${p}/${a}`, 3);
  const found = MANIFEST.assets.find((x) => x.os === os && x.arch === arch && (x.variant || 'render') === VARIANT);
  if (!found) fail(`没有 ${os}/${arch}/${VARIANT} 的资产（可用: ${MANIFEST.assets.map((x) => x.os + '/' + x.arch + '/' + (x.variant || 'render')).join(', ')}）`, 4);
  return found;
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    fs.createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function baseUrls(file) {
  const urls = [];
  const base = process.env.DSH_OBSCURA_ASSET_BASE;
  if (base) urls.push(base.replace(/\/$/, '') + '/' + file);
  urls.push(`https://github.com/fufay/dsh-obscura-skill/releases/download/${TAG}/${file}`);
  urls.push(`https://atomgit.com/Kevin911/dsh-obscura-skill/releases/download/${TAG}/${file}`);
  urls.push(`https://github.com/${MANIFEST.upstream.repo}/releases/download/${TAG}/${file}`);
  return urls;
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const tmp = dest + '.part';
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

function extract(archive, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const isZip = archive.endsWith('.zip');
  let r = isZip
    ? spawnSync('tar', ['-xf', archive, '-C', dest], { stdio: 'ignore' })
    : spawnSync('tar', ['-xzf', archive, '-C', dest], { stdio: 'ignore' });
  if (isZip && r.status !== 0) r = spawnSync('unzip', ['-o', '-q', archive, '-d', dest], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`解压失败: ${archive}（需要 tar / unzip）`);
}

function findBin(root, name) {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (p.split('/').length - root.split('/').length < 3) stack.push(p); }
      else if (e.name === name) return p;
    }
  }
  return null;
}

const asset = platformAsset();
const stem = asset.file.replace(/\.(tar\.gz|zip)$/, '');
const dir = join(CACHE, TAG, stem);
const win = process.platform === 'win32';
const names = win ? ['obscura.exe', 'obscura-worker.exe'] : ['obscura', 'obscura-worker'];
const bin = join(dir, names[0]);
const worker = join(dir, names[1]);
const marker = join(dir, '.ok');
const archive = join(CACHE, TAG, asset.file);   // 放在解压目录外，避免 extract 时被清掉

const info = { platform: process.platform, arch: process.arch, file: asset.file, variant: asset.variant || 'render', tag: TAG, cacheDir: CACHE, bin, worker, size: asset.size, sha256: asset.sha256 };

if (has('check')) {
  console.log(JSON.stringify({ ...info, cached: fs.existsSync(bin) && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === asset.sha256 }, null, 2));
  process.exit(0);
}

const cacheOk = () => fs.existsSync(bin) && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === asset.sha256;

if (cacheOk() && !has('force')) {
  console.log(has('json') ? JSON.stringify(info) : bin);
  process.exit(0);
}

fs.mkdirSync(dir, { recursive: true });

async function ensureArchive() {
  const local = process.env.DSH_OBSCURA_LOCAL_DIR;
  if (local) {
    const localArchive = join(local, asset.file);
    if (fs.existsSync(localArchive)) {
      fs.copyFileSync(localArchive, archive);
      console.error(`[resolve] 使用本地归档 ${localArchive}`);
      return;
    }
    const localBin = join(local, names[0]);
    if (fs.existsSync(localBin)) {
      console.error(`[resolve] 使用本地已解压目录 ${local}`);
      for (const n of names) if (fs.existsSync(join(local, n))) fs.copyFileSync(join(local, n), join(dir, n));
      fs.writeFileSync(marker, asset.sha256);
      return 'local-dir';
    }
  }
  for (const url of baseUrls(asset.file)) {
    try {
      console.error(`[resolve] 下载 ${url}`);
      await download(url, archive);
      return;
    } catch (e) { console.error(`[resolve] 失败: ${e.message}`); }
  }
  throw new Error('所有镜像都失败（可用 DSH_OBSCURA_LOCAL_DIR 指定离线目录）');
}

try {
  const mode = await ensureArchive();
  if (mode !== 'local-dir') {
    const got = await sha256File(archive);
    if (asset.sha256 && got !== asset.sha256) throw new Error(`sha256 不匹配（期望 ${asset.sha256.slice(0, 16)}…，得到 ${got.slice(0, 16)}…）`);
    extract(archive, dir);
    if (!fs.existsSync(bin)) throw new Error(`解压后找不到 ${names[0]}`);
    if (!win) { fs.chmodSync(bin, 0o755); if (fs.existsSync(worker)) fs.chmodSync(worker, 0o755); }
    fs.writeFileSync(marker, asset.sha256 || got);
  }
} catch (e) {
  fail(e.message, 5);
}

console.log(has('json') ? JSON.stringify(info) : bin);
