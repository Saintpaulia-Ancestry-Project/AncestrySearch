import { spawn } from "node:child_process"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const port = "9381", base = "http://127.0.0.1:8765/mycrosses/index.html?db=e2e";
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
await send("Browser.setDownloadBehavior", { behavior: "deny" });   // tests must never write into the real Downloads folder
await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
let fails = 0; const check = (name, ok, extra = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " " + extra)); if (!ok) fails++; };
const until = async (expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch {} await sleep(150); } return false; };
const go = async (hash) => { await ev(`location.hash = ${JSON.stringify(hash)}`); await sleep(500); };
const setVal = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true})()`);
const click = (txt) => ev(`(()=>{const b=[...document.querySelectorAll('button,a.btn')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(txt)})); if(!b) return false; b.click(); return true})()`);
const text = () => ev("document.getElementById('main').innerText");

await send("Page.navigate", { url: base });
check("home loads", await until("document.querySelector('h1')?.textContent==='Home'"));
check("empty home invites first cross", (await text()).includes("Record your first cross"));
await shot("1-home-empty");

// new cross
await go("#/cross/new");
check("form shows suggested code", await until("document.querySelector('[name=code]')?.value?.length>3"));
await setVal("[name=seed_parent_name]", "Rob's Boolgooroo"); await setVal("[name=pollen_parent_name]", "<b>Baby Pink</b>");
await setVal("[name=hybridizer]", "Test Person"); await setVal("[name=date_made]", "2026-11-01"); await setVal("[name=date_harvested]", "2026-10-01");
await click("Save");
check("date order error is shown", await until("document.querySelector('[role=alert]')?.textContent.includes('before')"), await text());
await setVal("[name=date_harvested]", "2026-12-01"); await click("Save");
check("cross page opens", await until("location.hash.startsWith('#/cross/') && document.querySelector('h1')?.textContent.length>3 && document.body.innerText.includes('Seedlings (0)')"), await text());
check("html in a parent name is shown as text", (await ev("document.getElementById('main').innerHTML")).includes("&lt;b&gt;Baby Pink"), "");
const crossHash = await ev("location.hash");
await setVal("input[type=number]", "3"); await click("Add");
check("3 seedlings added", await until("document.body.innerText.includes('Seedlings (3)')"), await text());
await shot("2-cross");

// status change
await ev("(()=>{const s=document.querySelector('select[aria-label^=\"Status of seedling 2\"]'); s.value='flowering'; s.dispatchEvent(new Event('change',{bubbles:true}))})()");
check("status changed", await until("document.body.innerText.includes('Flowering')"));

// seedling page: notes with a script tag, trait, photo
await ev("document.querySelector('a.t').click()"); await sleep(500);
check("seedling page", await until("document.querySelector('h1')?.textContent.startsWith('Seedling 1')"));
await setVal("[name=notes]", "<script>window.__pwn=1</script> deep purple"); await click("Save");
await sleep(600);
check("note saved and not executed", (await ev("window.__pwn")) === undefined && (await ev("document.querySelector('[name=notes]').value")).includes("deep purple"));
await setVal("input[name=trait]", "bloom size"); await setVal("input[name=value]", "large"); await click("Add trait");
check("trait added", await until("document.body.innerText.includes('bloom size')"));
// photo: build a JPEG in the page and give it to the file input
await ev(`(async()=>{const c=document.createElement('canvas');c.width=2000;c.height=1500;const x=c.getContext('2d');x.fillStyle='#c33';x.fillRect(0,0,2000,1500);const b=await new Promise(r=>c.toBlob(r,'image/jpeg',.9));const f=new File([b],'p.jpg',{type:'image/jpeg'});const dt=new DataTransfer();dt.items.add(f);const inp=document.querySelector('input[type=file][multiple]');inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
check("photo added (1000 px)", await until("document.body.innerText.includes('Photos (1)')"), await text());
const dims = await ev(`(async()=>{const p=(await window.__hyb.repo.list('photos'))[0];const f=await window.__hyb.repo.getBlob(p.sha256);const t=await window.__hyb.repo.getBlob(p.thumb_sha256);return [p.width,p.height,f.bytes.length>1000,t.bytes.length<f.bytes.length]})()`);
check("photo resized to 1000x750 with a thumb", JSON.stringify(dims) === "[1000,750,true,true]", JSON.stringify(dims));
await shot("3-seedling");

// delete seedling -> trash -> restore
await ev("window.confirm = () => true");
await click("Delete seedling");
check("deleted seedling returns to cross", await until("document.body.innerText.includes('Seedlings (2)')"), await text());
await go("#/trash");
check("trash lists the seedling", await until("document.body.innerText.includes('Seedling 1')"), await text());
await shot("4-trash");
await click("Restore");
await go("#/crosses");
check("crosses list shows the cross and 3 seedlings", await until("document.body.innerText.includes('3 seedlings')"), await text());
check("cross thumbnail appears", await until("!!document.querySelector('.card img.thumb[src^=blob]')"));
await shot("5-list");
await go("#/crosses?q=pink%20x%20rob"); check("search finds it in either order", await until("document.body.innerText.includes('1 of 1 cross')"), await text());
await go("#/crosses?q=zzzz"); check("search finds nothing", await until("document.body.innerText.includes('0 of 1 cross')"), await text());

// settings: theme
await go("#/settings");
await ev("(()=>{const s=[...document.querySelectorAll('select')].find(x=>[...x.options].some(o=>o.value==='hc-dark')); s.value='hc-dark'; s.dispatchEvent(new Event('change',{bubbles:true}))})()");
await sleep(400);
check("high-contrast dark applied", (await ev("document.documentElement.dataset.mode")) === "hc-dark" && (await ev("getComputedStyle(document.body).backgroundColor")) === "rgb(0, 0, 0)");
await shot("6-settings-hc");
await ev("(()=>{const s=[...document.querySelectorAll('select')].find(x=>[...x.options].some(o=>o.value==='red')); s.value='red'; s.dispatchEvent(new Event('change',{bubbles:true})); const m=[...document.querySelectorAll('select')].find(x=>[...x.options].some(o=>o.value==='light')); m.value='light'; m.dispatchEvent(new Event('change',{bubbles:true}))})()");
await sleep(400); await go("#/");
await shot("7-home-red-light");
check("look survives reload (first paint from localStorage)", await (async () => { await send("Page.reload"); await sleep(1200); return (await ev("document.documentElement.dataset.scheme")) === "red"; })());

// sync page export
await go("#/sync");
check("sync page", await until("document.body.innerText.includes('Make a file')"));
const exp = await ev(`(async()=>{const {exportSync}=await import('./js/sync/export.js'); const o=await exportSync(window.__hyb.repo,{mode:'full',photos:'thumbs'}); return [o.counts.crosses,o.counts.seedlings,o.counts.photos,o.blob.size>500]})()`);
check("export through the app's repo", JSON.stringify(exp) === "[1,3,1,true]", JSON.stringify(exp));
await go("#/"); check("home shows backup age", await until("document.body.innerText.includes('sync or backup file was made today')"), await text());
await go("#/nonsense"); check("unknown page handled", (await text()).includes("does not exist"));

check("no console errors or exceptions", problems.length === 0, problems.join(" | "));
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
proc.kill(); process.exit(fails ? 1 : 0);
