#!/usr/bin/env node
// 截图任意页面的验证码/图片元素（给 agent 识别用）。无状态：打开页面→等元素→裁剪 PNG→退出。
// 用法: node captcha.mjs --url https://x --selector "#captcha" --out /tmp/cap.png [--port 9222] [--wait 15000]
// 输出: JSON {ok, out, width, height}
import fs from 'node:fs';
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const port = Number(opt('port', '9222'));
const url = opt('url', null);
const sel = opt('selector', '#captcha');
const out = opt('out', 'captcha.png');
const waitMs = Number(opt('wait', '15000'));
const jsStr = (v) => JSON.stringify(v);

let ver;
try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
catch { console.error(`[captcha] ${port} 上没有 CDP，先 node serve.mjs ensure --port ${port}`); process.exit(3); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}, sid) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) })); });
const t = await send('Target.createTarget', { url: 'about:blank' });
const a = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
const sid = a.result.sessionId;
await send('Page.enable', {}, sid);
if (url) await send('Page.navigate', { url }, sid);
const evalIn = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid)).result?.result?.value ?? null;
const deadline = Date.now() + waitMs;
while (Date.now() < deadline) { if (await evalIn(`!!document.querySelector(${jsStr(sel)})`)) break; await new Promise((r) => setTimeout(r, 500)); }
const rect = await evalIn(`(() => { const el = document.querySelector(${jsStr(sel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const b = el.getBoundingClientRect(); return {x:b.x+scrollX,y:b.y+scrollY,width:b.width,height:b.height}; })()`);
if (!rect || !rect.width) { console.log(JSON.stringify({ ok: false, error: 'no-element' })); process.exit(1); }
const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...rect, scale: 1 } }, sid);
if (!s.result?.data) { console.log(JSON.stringify({ ok: false, error: s.error?.message || 'capture failed' })); process.exit(1); }
fs.writeFileSync(out, Buffer.from(s.result.data, 'base64'));
console.log(JSON.stringify({ ok: true, out, width: rect.width, height: rect.height }));
ws.close();
