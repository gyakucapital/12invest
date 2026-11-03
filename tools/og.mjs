// Generates 1200x630 share-preview images (og/<id>.jpg) for each post, used by Facebook, Telegram and WhatsApp.
// Needs Playwright + Chromium. Run after adding a post:  node tools/og.mjs   (add --force to redo all)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
// Playwright may be installed globally; resolve it the CommonJS way so both local and global installs work.
const { chromium } = createRequire(import.meta.url)("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");
const { posts } = JSON.parse(fs.readFileSync(path.join(ROOT, "posts.json"), "utf8"));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f = p => pathToFileURL(path.join(ROOT, p)).href;

fs.mkdirSync(path.join(ROOT, "og"), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const p of posts) {
  const out = path.join(ROOT, "og", `${p.id}.jpg`);
  if (fs.existsSync(out) && !force) continue;
  const photo = p.ogImage || p.cover;
  const stats = ((p.glance && p.glance.stats) || []).slice(0, 3);
  const title = String(p.title).replace(/^【.*?】\s*/, "");
  const tmp = path.join(os.tmpdir(), `og-${p.id}.html`); // loaded from a file so local images and fonts resolve
  fs.writeFileSync(tmp, `<!doctype html><html><head><style>
@font-face{font-family:Silk;src:url(${f("fonts/silkscreen-700.woff2")})}
*{box-sizing:border-box}
body{margin:0;width:1200px;height:630px;overflow:hidden;background:#081230;color:#EEF2FF;font-family:"Noto Sans CJK SC","Noto Sans SC",sans-serif;
  display:grid;grid-template-columns:470px 1fr}
.ph{background:#0C1A42 url(${f(photo)}) center/cover no-repeat;border-right:10px solid #F4C24F}
.r{padding:44px 52px 44px 48px;display:flex;flex-direction:column;gap:20px;min-width:0;
  background-image:linear-gradient(rgba(63,93,179,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(63,93,179,.12) 1px,transparent 1px);background-size:32px 32px}
.top{display:flex;justify-content:space-between;align-items:center}
.logo{font-family:Silk;font-size:30px;letter-spacing:1px}.logo b{color:#F4C24F;font-weight:400}
.cat{font-size:20px;font-weight:700;color:#081230;background:#F4C24F;padding:4px 14px}
h1{margin:6px 0 0;font-size:41px;line-height:1.36;font-weight:900;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.tl{font-size:22px;color:#F4C24F;font-weight:700}
.st{margin-top:auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.s{background:#11235A;padding:12px 12px;box-shadow:0 -4px 0 0 #2B4590,0 4px 0 0 #2B4590,-4px 0 0 0 #2B4590,4px 0 0 0 #2B4590}
.s div{font-size:18px;color:#A3B3DC}.s b{display:block;font-size:25px;color:#F4C24F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head><body><div class="ph"></div><div class="r">
<div class="top"><div class="logo">12<b>INVEST</b></div><div class="cat">${esc(p.category)}</div></div>
<h1>${esc(title)}</h1>
${p.glance && p.glance.timeline ? `<div class="tl">${esc(p.glance.timeline)}</div>` : ""}
${stats.length ? `<div class="st">${stats.map(s => `<div class="s"><div>${esc(s.k)}</div><b>${esc(s.v)}</b></div>`).join("")}</div>` : ""}
</div></body></html>`);
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, type: "jpeg", quality: 86 });
  console.log("og", p.id);
}
// Daily news share cards: og/news-<date>.jpg
const newsFile = path.join(ROOT, "data/news.json");
const days = fs.existsSync(newsFile) ? JSON.parse(fs.readFileSync(newsFile, "utf8")).days || [] : [];
for (const d of days){
  const out = path.join(ROOT, "og", `news-${d.date}.jpg`);
  if (!d.date || (fs.existsSync(out) && !force)) continue;
  const [y, m, dd] = d.date.split("-").map(Number);
  const mk = d.market || {};
  const down = /^[-−]/.test(mk.change || "");
  const tmp = path.join(os.tmpdir(), `og-news-${d.date}.html`);
  fs.writeFileSync(tmp, `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Silk;src:url(${f("fonts/silkscreen-700.woff2")})}
@font-face{font-family:PS2P;src:url(${f("fonts/pressstart2p-400.woff2")})}
*{box-sizing:border-box}
body{margin:0;width:1200px;height:630px;overflow:hidden;background:#081230;color:#EEF2FF;font-family:"Noto Sans CJK SC",sans-serif;display:grid;grid-template-columns:400px 1fr;
  background-image:linear-gradient(rgba(63,93,179,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(63,93,179,.12) 1px,transparent 1px);background-size:32px 32px}
.l{background:#F4C24F;color:#081230;padding:48px 40px;display:flex;flex-direction:column;justify-content:space-between}
.l .k{font-family:Silk;font-size:30px;letter-spacing:2px}
.l .d{font-family:PS2P;font-size:64px;line-height:1.1}
.l .y{font-family:PS2P;font-size:22px;margin-top:14px}
.l .t{font-size:34px;font-weight:900}
.r{padding:46px 52px;display:flex;flex-direction:column;gap:18px;min-width:0}
.logo{font-family:Silk;font-size:30px}.logo b{color:#F4C24F;font-weight:400}
h1{margin:0;font-size:38px;line-height:1.38;font-weight:900;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.mk{display:flex;gap:18px;align-items:baseline;font-size:26px;font-weight:700}
.mk em{font-style:normal;color:${down ? "#FF7A66" : "#F4C24F"}}
ul{margin:auto 0 0;padding:0;list-style:none;display:grid;gap:10px}
li{font-size:22px;color:#A3B3DC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
li b{color:#081230;background:#F4C24F;font-size:17px;padding:2px 8px;margin-right:10px}
</style></head><body><div class="l"><div class="k">DAILY</div><div><div class="d">${m}/${dd}</div><div class="y">${y}</div></div><div class="t">每日马股速报</div></div>
<div class="r"><div class="logo">12<b>INVEST</b></div><h1>${esc(d.title)}</h1>
${mk.close ? `<div class="mk"><span>${esc(mk.index || "FBM KLCI")} ${esc(mk.close)}</span><em>${esc(mk.change || "")}</em></div>` : ""}
<ul>${(d.items || []).slice(0, 3).map(it => `<li><b>${esc(it.tag || "焦点")}</b>${esc(it.title)}</li>`).join("")}</ul></div></body></html>`);
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, type: "jpeg", quality: 86 });
  console.log("og news", d.date);
}
await browser.close();
