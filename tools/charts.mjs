// 8-bit financial charts. For every post with a "financials" block, renders img/<id>-fin.png (1600x900):
// left = revenue bars, right = profit bars with a stepped margin line. Pixel blocks, pixel font, 12Invest navy.
// Each article gets its own accent palette (financials.theme, or picked from the id) so charts don't look copy-pasted.
// Run from the repo root:  node tools/charts.mjs   (add --force to redraw all; needs Playwright)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");
const { posts } = JSON.parse(fs.readFileSync(path.join(ROOT, "posts.json"), "utf8"));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const font = f => pathToFileURL(path.join(ROOT, "fonts", f)).href;

// accent pairs on the navy base: [revenue, profit, margin line]
const THEMES = [
  ["#F4C24F", "#4FD1C5", "#FF7A66"], // gold / teal / coral
  ["#7CD992", "#F4C24F", "#FF9DE2"], // green / gold / pink
  ["#6EA8FF", "#F4C24F", "#7CD992"], // blue / gold / green
  ["#FF9F43", "#A78BFA", "#4FD1C5"], // orange / violet / teal
  ["#F4C24F", "#FF7A66", "#6EA8FF"]  // gold / coral / blue
];
const pick = id => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % THEMES.length;
// "FYE2026" -> "FY26" so four periods fit under each panel
const shortP = p => String(p).replace(/^(FYE?|FP|FPE)\s*(\d{2})(\d{2})$/i, (m, a, c, y) => a.toUpperCase().replace("FYE", "FY") + y);
const fmt = v => Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en") : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);

function frame({ x, y, w, h, title, unit }){
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#0E1C4A"/>`;
  s += `<text x="${x + 32}" y="${y + 50}" class="pt">${esc(title)}</text>`;
  if (unit) s += `<text x="${x + w - 32}" y="${y + 50}" class="pu" text-anchor="end">${esc(unit)}</text>`;
  return s;
}
function geom({ x, y, w, h }, n){
  const top = y + 140, base = y + h - 76, slot = (w - 64) / n;
  return { top, base, plotH: base - top, slot, cx: i => Math.round(x + 32 + slot * i + slot / 2) };
}
function axis({ x, w }, g, periods){
  let s = "";
  for (let k = 0; k <= 4; k++){ const gy = Math.round(g.base - g.plotH * k / 4); s += `<rect x="${x + 32}" y="${gy}" width="${w - 64}" height="2" fill="#1C2E66"/>`; }
  periods.forEach((p, i) => { s += `<text x="${g.cx(i)}" y="${g.base + 44}" class="px" text-anchor="middle">${esc(shortP(p))}</text>`; });
  return s;
}
function bars(box, { title, unit, periods, values, color }){
  const B = 12, G = 3, n = values.length, g = geom(box, n);
  const max = Math.max(...values.map(Math.abs), 1e-9);
  const cols = Math.max(2, Math.min(6, Math.floor(g.slot * 0.6 / (B + G)))), bw = cols * (B + G) - G;
  let s = frame({ ...box, title, unit }) + axis(box, g, periods);
  values.forEach((v, i) => {
    const rows = Math.max(1, Math.round(g.plotH * Math.abs(v) / max / (B + G))), last = i === n - 1, x0 = g.cx(i) - bw / 2;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
      s += `<rect x="${x0 + c * (B + G)}" y="${g.base - (r + 1) * (B + G) + G}" width="${B}" height="${B}" fill="${color}" opacity="${last ? 1 : 0.6}"/>`;
    s += `<text x="${g.cx(i)}" y="${g.base - rows * (B + G) - 16}" class="pv" text-anchor="middle" fill="${last ? color : "#EEF2FF"}">${fmt(v)}</text>`;
  });
  return s;
}
function steps(box, { title, periods, values, color }){
  const n = values.length, g = geom(box, n);
  const lo = Math.min(...values), hi = Math.max(...values), pad = Math.max((hi - lo) * 0.35, 1);
  const yOf = v => Math.round(g.base - g.plotH * 0.08 - (g.plotH * 0.8) * (v - (lo - pad)) / ((hi + pad) - (lo - pad)));
  const pts = values.map((v, i) => [g.cx(i), yOf(v)]);
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < n; i++){ const mx = Math.round((pts[i - 1][0] + pts[i][0]) / 2); d += ` H${mx} V${pts[i][1]} H${pts[i][0]}`; }
  let s = frame({ ...box, title, unit: "%" }) + axis(box, g, periods);
  s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="8"/>`;
  pts.forEach(([px, py], i) => {
    const last = i === n - 1;
    s += `<rect x="${px - 12}" y="${py - 12}" width="24" height="24" fill="${last ? color : "#0E1C4A"}" stroke="${color}" stroke-width="6"/>`;
    s += `<text x="${px}" y="${py - 30}" class="pl" text-anchor="middle" fill="${last ? color : "#EEF2FF"}">${values[i].toFixed(1)}%</text>`;
  });
  return s;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
for (const p of posts){
  const f = p.financials; if (!f) continue;
  const out = path.join(ROOT, "img", `${p.id}-fin.png`);
  if (fs.existsSync(out) && !force) continue;
  const [c1, c2, c3] = THEMES[Number.isInteger(f.theme) ? f.theme % THEMES.length : pick(p.id)];
  const unit = f.unit || "RM m";
  const W = 1600, H = 900;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">
  <defs><pattern id="g" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#132457" stroke-width="2"/></pattern></defs>
  <rect width="${W}" height="${H}" fill="#081230"/><rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="64" y="84" class="tt">${esc(f.title || `${p.ipo && p.ipo.name || ""} 财务表现`)}</text>
  <text x="${W - 64}" y="84" class="br" text-anchor="end"><tspan fill="#EEF2FF">12</tspan>INVEST</text>
  <rect x="64" y="112" width="${W - 128}" height="6" fill="${c1}"/>
  <rect x="64" y="150" width="${(W - 160) / 2}" height="${H - 250}" fill="#0E1C4A"/>
  <rect x="${96 + (W - 160) / 2}" y="150" width="${(W - 160) / 2}" height="${H - 250}" fill="#0E1C4A"/>
  ${(() => {
    const has = Array.isArray(f.margin) && f.margin.length === f.periods.length, k = has ? 3 : 2, gap = 24;
    const pw = (W - 128 - gap * (k - 1)) / k, box = j => ({ x: 64 + j * (pw + gap), y: 150, w: pw, h: H - 250 });
    return bars(box(0), { title: f.revenueLabel || "营业额", unit, periods: f.periods, values: f.revenue, color: c1 })
      + bars(box(1), { title: f.profitLabel || "税后盈利", unit, periods: f.periods, values: f.profit, color: c2 })
      + (has ? steps(box(2), { title: f.marginLabel || "利润率", periods: f.periods, values: f.margin, color: c3 }) : "");
  })()}
  <text x="64" y="${H - 44}" class="src">资料来源：${esc(f.source || "公司招股书")}</text>
  <text x="${W - 64}" y="${H - 44}" class="src" text-anchor="end">仅供参考，非买卖建议</text>
</svg>`;
  const tmp = path.join(os.tmpdir(), `chart-${p.id}.html`);
  fs.writeFileSync(tmp, `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Silk;src:url(${font("silkscreen-400.woff2")})}
@font-face{font-family:Silk;font-weight:700;src:url(${font("silkscreen-700.woff2")})}
@font-face{font-family:PS2P;src:url(${font("pressstart2p-400.woff2")})}
body{margin:0}svg{display:block}
text{font-family:Silk,"Noto Sans CJK SC",sans-serif}
.tt{font-family:"Noto Sans CJK SC",sans-serif;font-weight:900;font-size:44px;fill:#EEF2FF}
.br{font-family:Silk;font-weight:700;font-size:34px;fill:${c1};letter-spacing:2px}
.pt{font-family:"Noto Sans CJK SC",sans-serif;font-weight:700;font-size:32px;fill:#EEF2FF}
.pu{font-family:"Noto Sans CJK SC",sans-serif;font-size:22px;fill:#A3B3DC}
.pv{font-family:PS2P;font-size:19px}
.pl{font-family:"Noto Sans CJK SC",sans-serif;font-weight:900;font-size:26px}
.px{font-family:PS2P;font-size:15px;fill:#A3B3DC}
.src{font-family:"Noto Sans CJK SC",sans-serif;font-size:22px;fill:#A3B3DC}
</style></head><body>${svg}</body></html>`);
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, type: "png" });
  console.log("chart", p.id);
}
await browser.close();
