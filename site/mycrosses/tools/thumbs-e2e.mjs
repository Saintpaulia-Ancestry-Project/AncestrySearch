import { spawn } from "node:child_process"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const port = "9385", base = "http://127.0.0.1:8765/mycrosses/index.html?db=thumbs";
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
const crossId = await ev(`(async()=>{
  const r=window.__hyb.repo;
  const a=await r.create('crosses',{code:'P-1'}); const [s]=await r.createMany('seedlings',[{cross_id:a.id,label:'1',promoted_name:'My Seedling'}]);
  const c=document.createElement('canvas');c.width=400;c.height=300;c.getContext('2d').fillRect(0,0,400,300);const b=await new Promise(x=>c.toBlob(x,'image/jpeg',.8));const u=new Uint8Array(await b.arrayBuffer());
  await r.addPhoto({seedling_id:s.id,full:u,thumb:u,width:400,height:300});
  const x=await r.create('crosses',{code:'T-1',seed_parent_name:'Agam',seed_parent_ref:'8e-agam-darshi',pollen_parent_name:'My Seedling',pollen_parent_ref:s.id,hybridizer:'Rob'});
  // a snapshot saved by the earlier version: no photo fields at all
  await r.adapter.tx(['official_cache'],'readwrite',(t)=>t.put('official_cache',{id:'8e-agam-darshi',name:'8E Agam Darshi',hybridizer:'Miemietz',size_class:'Standard',description:null,registration_no:null,saved_at:'2026-11-20T00:00:00.000Z'}));
  return x.id})()`);
await go("#/cross/" + crossId);
check("local parent thumbnail", await until("!!document.querySelector('.pline a[href^=\"#/seedling/\"] img[src^=blob]')"), await ev("document.getElementById('main').innerHTML.slice(0,1500)"));
check("official thumbnail appears after the old snapshot is refreshed", await until("!!document.querySelector('.pline img[src^=\"https://cdn.jsdelivr.net/gh/Saintpaulia-Ancestry-Project/\"]')", 40000), await ev("document.getElementById('main').innerHTML.slice(0,1500)"));
const m = await ev("document.getElementById('main').innerText");
check("summary: no storage rows, hybridizer and sown date visible", !m.includes("Seed stored") && !m.includes("Storage") && m.includes("Hybridizer:") && m.includes("Rob") && m.includes("Date seed sown"), m);
check("the refreshed snapshot kept its photo", (await ev("(async()=>(await window.__hyb.repo.getOfficial('8e-agam-darshi')).photo)()")) === "8e-agam-darshi-1.webp");
await sleep(1500);
await shot("13-thumbs");
const csp = problems.filter((p) => /Content Security Policy/.test(p));
check("no policy violations", csp.length === 0, csp.join(" | "));
console.log(fails ? "FAILED" : "ALL PASSED"); proc.kill(); process.exit(0);
