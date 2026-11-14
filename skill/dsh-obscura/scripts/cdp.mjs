#!/usr/bin/env node
// 零依赖 CDP 客户端（Node 22+ 内建 WebSocket）。走浏览器级 endpoint + Target.attach(flatten)。
// 用法:
//   node cdp.mjs --port 9222 --url https://example.com --eval "document.title"
//   node cdp.mjs --port 9222 --url https://x --poll-selector ".card" --min 3 --eval "document.querySelectorAll('.card').length"
//   node cdp.mjs --port 9222 --url https://x --screenshot out.png [--full-page]
//   node cdp.mjs --port 9222 --url https://x --pdf out.pdf
//   node cdp.mjs --port 9222 --eval-only "1+1"
//   node cdp.mjs --port 9222 --url https://x --fill "#user=alice" --fill "#pass=secret" --click "#submit"
//   node cdp.mjs --port 9222 --url https://x --clip-selector "#captcha" --out cap.png
//   node cdp.mjs --port 9222 --url https://x --wait-url /welcome
// 输出: JSON {ok,url,title,value,screenshot,pdf,cookies,error}
import fs from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flag = (n) => argv.includes('--' + n);
const port = Number(opt('port', '9222'));
const url = opt('url', null);
const evalExpr = opt('eval', null);
const evalOnly = flag('eval-only');
const waitMs = Number(opt('wait-ms', '3000'));
const pollSel = opt('poll-selector', null);
const pollMin = Number(opt('min', '3'));
const screenshot = opt('screenshot', null);
const pdf = opt('pdf', null);
const fullPage = flag('full-page');
const wantCookies = flag('cookies');
const outFile = opt('out', null);
const clipSel = opt('clip-selector', null);
const waitUrl = opt('wait-url', null);
const fills = argv.flatMap((a, i) => (a === '--fill' && argv[i + 1] ? [argv[i + 1]] : []));
const clicks = argv.flatMap((a, i) => (a === '--click' && argv[i + 1] ? [argv[i + 1]] : []));

function out(o, code = 0) { console.log(JSON.stringify(o)); process.exit(code); }

let ver;
try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
catch (e) { out({ ok: false, error: `CDP 不可达（${port}）：${e.message}。先 node serve.mjs ensure` }, 1); }

const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}, sid) => new Promise((res) => {
  const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) }));
});
const evalIn = async (expr, sid) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid);
  if (r.error) return { error: r.error.message };
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text || 'exception' };
  return { value: r.result?.result?.value ?? null };
};

const result = { ok: true, url: null, title: null, value: null, actions: [] };
const jsStr = (v) => JSON.stringify(v);
const FILL_JS = (sel, val) => `(() => {
  const el = document.querySelector(${jsStr(sel)});
  if (!el) return 'no-element';
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${jsStr(val)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`;
try {
  let sid = null;
  if (!evalOnly) {
    const t = await send('Target.createTarget', { url: 'about:blank' });
    if (t.error) throw new Error(t.error.message);
    const a = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
    if (a.error) throw new Error(a.error.message);
    sid = a.result.sessionId;
    await send('Page.enable', {}, sid);
    if (url) {
      const nav = await send('Page.navigate', { url }, sid);
      if (nav.error) throw new Error(nav.error.message);
    }
    if (pollSel) {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const n = await evalIn(`document.querySelectorAll(${JSON.stringify(pollSel)}).length`, sid);
        if ((n.value || 0) >= pollMin) break;
      }
    } else {
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  if (sid) {
    for (const spec of fills) {
      const i = spec.indexOf('=');
      if (i < 0) { result.actions.push({ fill: spec, ok: false, error: 'need selector=value' }); continue; }
      const v = await evalIn(FILL_JS(spec.slice(0, i), spec.slice(i + 1)), sid);
      result.actions.push({ fill: spec.slice(0, i), ok: v.value === 'ok', detail: v.value || v.error });
    }
    for (const sel of clicks) {
      const v = await evalIn(`(() => { const el = document.querySelector(${jsStr(sel)}); if (!el) return 'no-element'; el.click(); return 'ok'; })()`, sid);
      result.actions.push({ click: sel, ok: v.value === 'ok', detail: v.value || v.error });
      await new Promise((r) => setTimeout(r, 800));
    }
    if (waitUrl) {
      for (let i = 0; i < 40; i++) {
        const u = await evalIn('location.href', sid);
        if (String(u.value || '').includes(waitUrl)) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
  if (evalExpr) {
    const v = await evalIn(evalExpr, sid || undefined);
    if (v.error) result.error = v.error; else result.value = v.value;
  }
  if (sid) {
    const meta = await evalIn("JSON.stringify({url:location.href,title:document.title})", sid);
    try { Object.assign(result, JSON.parse(meta.value)); } catch {}
    if (wantCookies) {
      await send('Network.enable', {}, sid);
      const c = await send('Network.getCookies', {}, sid);
      result.cookies = c.result?.cookies ?? null;
    }
    if (screenshot) {
      const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage }, sid);
      if (s.result?.data) { fs.writeFileSync(screenshot, Buffer.from(s.result.data, 'base64')); result.screenshot = screenshot; }
      else result.error = s.error?.message || 'screenshot failed';
    }
    if (clipSel) {
      const r = await evalIn(`(() => { const el = document.querySelector(${jsStr(clipSel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const b = el.getBoundingClientRect(); return {x:b.x+scrollX, y:b.y+scrollY, width:b.width, height:b.height}; })()`, sid);
      const clip = r.value;
      if (!clip || !clip.width) result.error = `clip-selector 未命中: ${clipSel}`;
      else {
        const s2 = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...clip, scale: 1 } }, sid);
        if (s2.result?.data) { const f = outFile || 'clip.png'; fs.writeFileSync(f, Buffer.from(s2.result.data, 'base64')); result.clip = f; }
        else result.error = s2.error?.message || 'clip failed';
      }
    }
    if (pdf) {
      const p = await send('Page.printToPDF', { printBackground: true, paperWidth: 8.27, paperHeight: 11.69 }, sid);
      if (p.result?.data) { fs.writeFileSync(pdf, Buffer.from(p.result.data, 'base64')); result.pdf = pdf; }
      else result.error = p.error?.message || 'pdf failed';
    }
  }
} catch (e) {
  result.ok = false; result.error = e.message;
}
ws.close();
out(result, result.ok ? 0 : 1);
