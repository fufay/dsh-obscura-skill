#!/usr/bin/env node
// 给 DSH(Whale) 用的「账号密码 + 图形验证码」登录助手（两步，跨命令保持页面）：
//   start  : 打开登录页 → 等验证码 → 填账号/密码 → 裁剪验证码图片 → 保持连接后台等待
//   answer : 把 agent 识别出的验证码填进去 → 提交 → 返回 URL/标题/cookies
// Obscura 的页面是连接级的，所以必须由一个后台进程持住连接；POST 用 in-page fetch 提交，
// 避免原生表单 POST 导航把 CDP 连接 reset。
//
// 用法:
//   node login.mjs start --port 9222 --url https://site/login \
//     --user-sel "#user" --user-env LOGIN_USER \
//     --pass-sel "#pass" --pass-env LOGIN_PASS \
//     --captcha-sel "#captcha" --captcha-out /tmp/cap.png \
//     --code-sel "#code" [--submit-sel "#submit"] [--wait 15000]
//   node login.mjs answer --port 9222 --code A7K3 [--success-url https://site/home]
//   node login.mjs abort|status --port 9222
//
// 安全: 密码只从环境变量/文件读，不进命令行参数、不回显。
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE = process.env.DSH_OBSCURA_CACHE || join(homedir(), '.cache', 'dsh-obscura');
const DIR = join(CACHE, 'login');
const argv = process.argv.slice(2);
const cmd = argv[0] || 'status';
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flag = (n) => argv.includes('--' + n);
const port = Number(opt('port', '9222'));
const stateFile = join(DIR, `login-${port}.json`);
const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; } };
const saveState = (s) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(s, null, 2)); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const jsStr = (v) => JSON.stringify(v);
const FILL_JS = (sel, val) => `(() => { const el = document.querySelector(${jsStr(sel)}); if (!el) return 'no-element'; const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${jsStr(val)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; })()`;

function secret(envName, file) {
  if (file) { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; } }
  if (envName) return process.env[envName] ?? null;
  return null;
}

async function startDaemon() {
  if (cmd !== '__daemon' && readState() && alive(readState().pid)) {
    console.log(JSON.stringify({ ok: true, alreadyRunning: true, ...readState() })); process.exit(0);
  }
  if (cmd !== '__daemon') {
    const args = [process.argv[1], '__daemon', '--port', String(port)];
    for (const k of ['url', 'user-sel', 'user-env', 'pass-sel', 'pass-env', 'pass-file', 'captcha-sel', 'captcha-out', 'code-sel', 'submit-sel', 'wait']) {
      if (opt(k, null) !== null) args.push('--' + k, opt(k));
    }
    spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const s = readState();
      if (s && alive(s.pid)) { console.log(JSON.stringify({ ok: true, ...s })); return; }
    }
    console.error('[login] 启动超时'); process.exit(5);
  }

  let ver;
  try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
  catch { console.error(`[login] ${port} 上没有 CDP，先 node serve.mjs ensure --port ${port}`); process.exit(3); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}, sid) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) })); });
  const t = await send('Target.createTarget', { url: 'about:blank' });
  const pageTarget = t.result.targetId;
  const a = await send('Target.attachToTarget', { targetId: pageTarget, flatten: true });
  const sid = a.result.sessionId;
  await send('Page.enable', {}, sid);
  const evalIn = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid);
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text || 'exception' };
    return { value: r.result?.result?.value ?? null };
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const user = secret(opt('user-env', null), null);
  const pass = secret(opt('pass-env', null), opt('pass-file', null));
  if (!user || !pass) { console.error('[login] 需要 --user-env/--pass-env（或 --pass-file）'); process.exit(4); }

  const url = opt('url', null);
  if (url) { const r = await send('Page.navigate', { url }, sid); if (r.error) { console.error('[login] 导航失败: ' + r.error.message); process.exit(6); } }

  const captchaSel = opt('captcha-sel', '#captcha');
  const waitMs = Number(opt('wait', '15000'));
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const r = await evalIn(`!!document.querySelector(${jsStr(captchaSel)})`);
    if (r.value) break;
    await sleep(500);
  }
  if (opt('user-sel', null)) { const r = await evalIn(FILL_JS(opt('user-sel'), user)); if (r.value !== 'ok') console.error('[login] 填账号失败: ' + (r.value || r.error)); }
  if (opt('pass-sel', null)) { const r = await evalIn(FILL_JS(opt('pass-sel'), pass)); if (r.value !== 'ok') console.error('[login] 填密码失败: ' + (r.value || r.error)); }

  let captchaPath = null;
  if (opt('captcha-out', null)) {
    const r = await evalIn(`(() => { const el = document.querySelector(${jsStr(captchaSel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const b = el.getBoundingClientRect(); return {x:b.x+scrollX, y:b.y+scrollY, width:b.width, height:b.height}; })()`);
    if (r.value && r.value.width) {
      const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...r.value, scale: 1 } }, sid);
      if (s.result?.data) { fs.writeFileSync(opt('captcha-out'), Buffer.from(s.result.data, 'base64')); captchaPath = opt('captcha-out'); }
    }
  }

  const ctl = net.createServer((sock) => {
    let buf = '';
    sock.on('data', async (d) => {
      buf += d.toString();
      if (!buf.includes('\n')) return;
      const req = JSON.parse(buf.slice(0, buf.indexOf('\n'))); buf = '';
      let reply = { ok: false, error: 'unknown' };
      try {
        if (req.cmd === 'answer') {
          const codeSel = opt('code-sel', '#code');
          const f = await evalIn(FILL_JS(codeSel, req.code));
          if (f.value !== 'ok') throw new Error('填验证码失败: ' + (f.value || f.error));
          const submitSel = opt('submit-sel', null);
          let submitted = false;
          // 优先 in-page fetch 提交表单（不触发原生 POST 导航，连接不会 reset）
          const fetchJs = `(async () => {
            const form = document.querySelector('form');
            if (!form) return 'no-form';
            const body = new URLSearchParams();
            for (const el of form.querySelectorAll('input,select,textarea')) { if (el.name) body.append(el.name, el.value); }
            const action = (form.getAttribute && form.getAttribute('action')) || location.pathname;
            const method = ((form.getAttribute && form.getAttribute('method')) || 'post').toUpperCase();
            const r = await fetch(action, { method, body, credentials: 'include', redirect: 'follow' });
            return 'fetch:' + r.status;
          })()`;
          const fsub = await evalIn(fetchJs);
          if (String(fsub.value || '').startsWith('fetch:')) submitted = true;
          if (!submitted && submitSel) {
            const c = await evalIn(`(() => { const el = document.querySelector(${jsStr(submitSel)}); if (!el) return 'no-element'; el.click(); return 'ok'; })()`);
            submitted = c.value === 'ok';
          }
          if (!submitted) throw new Error('提交失败（没找到 form，也没配 --submit-sel）');
          await sleep(1200);
          if (req.successUrl) { await send('Page.navigate', { url: req.successUrl }, sid); await sleep(800); }
          await send('Network.enable', {}, sid);
          const c = await send('Network.getCookies', {}, sid);
          const meta = await evalIn("JSON.stringify({url:location.href,title:document.title})");
          let m = {}; try { m = JSON.parse(meta.value); } catch {}
          reply = { ok: true, submitted, url: m.url, title: m.title, cookies: c.result?.cookies ?? [] };
          sock.end(JSON.stringify(reply) + '\n');
          try { ws.close(); } catch {}
          fs.rmSync(stateFile, { force: true });
          setTimeout(() => process.exit(0), 100);
          return;
        }
        if (req.cmd === 'abort') { reply = { ok: true, aborted: true }; sock.end(JSON.stringify(reply) + '\n'); try { ws.close(); } catch {} fs.rmSync(stateFile, { force: true }); setTimeout(() => process.exit(0), 50); return; }
      } catch (e) { reply = { ok: false, error: e.message }; }
      sock.end(JSON.stringify(reply) + '\n');
    });
  });
  await new Promise((res) => ctl.listen(0, '127.0.0.1', res));
  saveState({ ok: true, pid: process.pid, port, ctl: ctl.address().port, pageTarget, captcha: captchaPath, url: url || null, started_at: new Date().toISOString() });
  console.log(JSON.stringify({ ok: true, pid: process.pid, ctl: ctl.address().port, captcha: captchaPath, pageTarget }));
  setInterval(() => {}, 1 << 30);
}

function sendToDaemon(req) {
  const st = readState();
  if (!st || !alive(st.pid)) { console.error('[login] 没有进行中的登录（先 start）'); process.exit(3); }
  const sock = net.connect(st.ctl, '127.0.0.1', () => sock.write(JSON.stringify(req) + '\n'));
  let buf = '';
  sock.on('data', (d) => { buf += d.toString(); });
  sock.on('end', () => { console.log(buf.trim() || JSON.stringify({ ok: false, error: 'no reply' })); });
  sock.on('error', (e) => { console.error('[login] ' + e.message); process.exit(4); });
  setTimeout(() => { try { sock.destroy(); } catch {} }, 60000);
}

if (cmd === 'start' || cmd === '__daemon') await startDaemon();
else if (cmd === 'answer') sendToDaemon({ cmd: 'answer', code: opt('code'), successUrl: opt('success-url', null) });
else if (cmd === 'abort') sendToDaemon({ cmd: 'abort' });
else if (cmd === 'status') { const s = readState(); console.log(JSON.stringify({ running: !!(s && alive(s.pid)), ...(s || {}) })); }
else { console.error('用法: node login.mjs start|answer|abort|status ...'); process.exit(2); }
