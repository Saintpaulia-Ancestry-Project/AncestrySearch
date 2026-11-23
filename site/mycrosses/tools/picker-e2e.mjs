import { spawn } from "node:child_process"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const port = "9383", base = "http://127.0.0.1:8765/mycrosses/index.html?db=pick";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"; const dir = mkdtempSync(join(tmpdir(), "edge-a-"));
const proc = spawn(edge, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run", "--remote-allow-origins=*", "--window-size=420,900", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(200); } }
const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const w = new Map(); const problems = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && w.has(d.id)) { w.get(d.id)(d); w.delete(d.id); }
  if (d.method === "Log.entryAdded" && d.params.entry.level === "error") problems.push("LOG " + d.params.entry.text + " " + (d.params.entry.url || ""));
  if (d.method === "Runtime.exceptionThrown") problems.push("EXC " + JSON.stringify(d.params.exceptionDetails).slice(0, 400));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") problems.push("console.error " + d.params.args.map((a) => a.value || a.description).join(" ").slice(0, 300)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; w.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result; if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result?.value; };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(process.argv[2], name + ".png"), Buffer.from(r.result.data, "base64")); };
await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
let fails = 0; const check = (name, ok, extra = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " " + extra)); if (!ok) fails++; };
const until = async (expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch {} await sleep(150); } return false; };
const go = async (hash) => { await ev(`location.hash = ${JSON.stringify(hash)}`); await sleep(500); };
const setVal = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true})()`);
const click = (txt) => ev(`(()=>{const b=[...document.querySelectorAll('button,a.btn')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(txt)})); if(!b) return false; b.click(); return true})()`);
const text = () => ev("document.getElementById('main').innerText");

await send("Page.navigate", { url: base });
await send("Page.navigate", { url: base });
await until("document.querySelector('h1')?.textContent==='Home'");
// a cross with a named seedling to use as a parent
await ev(`(async()=>{const r=window.__hyb.repo;const c=await r.create('crosses',{code:'Z-1'});await r.createMany('seedlings',[{cross_id:c.id,label:'1',promoted_name:'Purple Rain'}]);return true})()`);
await go("#/cross/new"); await until("document.querySelector('[name=seed_parent_name]')");
const type = (name, v) => ev(`(()=>{const e=document.querySelector('[name=${name}]'); e.focus(); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); return true})()`);
const opts = () => ev("[...document.querySelectorAll('.pick-list:not([hidden]) li')].map(l=>l.innerText.split(String.fromCharCode(10)).join(' | '))");
await type("seed_parent_name", "baby pink");
check("official database loads and suggestions appear", await until("[...document.querySelectorAll('.pick-list:not([hidden]) li')].some(l=>/baby pink/i.test(l.innerText))", 30000), JSON.stringify(await opts()));
console.log("options:", JSON.stringify((await opts()).slice(0, 4)));
check("combobox attributes", (await ev("document.querySelector('[name=seed_parent_name]').getAttribute('aria-expanded')")) === "true" && (await ev("document.querySelector('[name=seed_parent_name]').getAttribute('role')")) === "combobox");
await shot("10-picker-open");
await ev("document.querySelector('[name=seed_parent_name]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
const ref1 = await ev("document.querySelector('[name=seed_parent_ref]').value");
check("Enter picks the first official match and sets the ref", /^[a-z0-9-]+$/.test(ref1) && ref1.length > 2, ref1);
check("status says linked", (await ev("document.querySelector('.pick .hint').innerText")).includes("Linked to the official database"));
await type("pollen_parent_name", "purple");
check("own seedling is offered", await until("[...document.querySelectorAll('.pick-list:not([hidden]) li')].some(l=>/your seedling/.test(l.innerText))"), JSON.stringify(await opts()));
await ev("[...document.querySelectorAll('.pick-list:not([hidden]) li')].find(l=>/your seedling/.test(l.innerText)).click()");
const ref2 = await ev("document.querySelector('[name=pollen_parent_ref]').value");
check("own seedling sets a local id as ref", /^[0-9a-f]{8}-/.test(ref2), ref2);
await click("Save");
check("cross page shows both links", await until("document.body.innerText.includes('official page') && document.body.innerText.includes('your seedling')"), await text());
const hrefs = await ev("[...document.querySelectorAll('main a')].map(a=>a.getAttribute('href')).filter(h=>h.includes('#/c/')||h.includes('#/seedling/'))");
check("link targets", hrefs.some(h=>h.startsWith("../#/c/")) && hrefs.some(h=>h.startsWith("#/seedling/")), JSON.stringify(hrefs));
const saved = await ev(`(async()=>{const cs=await window.__hyb.repo.list('crosses');const c=cs.find(x=>x.code!=='Z-1');return [c.seed_parent_ref,c.seed_parent_name,c.pollen_parent_ref,c.pollen_parent_name]})()`);
check("record holds names and refs", saved[0] === ref1 && saved[2] === ref2 && saved[1] && saved[3] === "Purple Rain", JSON.stringify(saved));
const cache = await ev(`(async()=>{const o=await window.__hyb.repo.listOfficial();return o.map(x=>x.name)})()`);
check("official snapshot kept for offline", cache.length === 1, JSON.stringify(cache));
// editing the text drops the link; "as typed" keeps a name
await click("Edit cross"); await until("document.querySelector('[name=pollen_parent_name]')");
await type("pollen_parent_name", "Purple Rainbow");
check("changing the text unlinks", (await ev("document.querySelector('[name=pollen_parent_ref]').value")) === "");
// the older-names action
await type("seed_parent_name", "baby pink");
await until("[...document.querySelectorAll('.pick-list:not([hidden]) li')].some(l=>/older names/.test(l.innerText))", 10000);
check("older names action offered", (await opts()).some(t=>/older names/.test(t)), JSON.stringify(await opts()));
// offline: block the database, reload, type
await send("Network.setBlockedURLs", { urls: ["*avancestry.sqlite*"] });
await send("Page.reload"); await until("document.querySelector('h1')");
await go("#/cross/new"); await until("document.querySelector('[name=seed_parent_name]')");
await type("seed_parent_name", "baby");
check("offline: remembered names and a clear message", await until("document.querySelector('.pick-list:not([hidden])')?.innerText.includes('could not be loaded') && document.querySelector('.pick-list:not([hidden])').innerText.includes('kept on this device')", 15000), JSON.stringify(await opts()));
const real = problems.filter((p) => !/Failed to load resource|ERR_BLOCKED/.test(p));
check("no console errors or CSP violations", real.length === 0, real.join(" | "));
console.log(fails ? "FAILED" : "ALL PASSED"); proc.kill(); process.exit(0);
