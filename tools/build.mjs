// 12Invest static site builder.
// Reads posts.json + tools/legal.mjs + tools/site.config.json and writes every page as plain HTML,
// so each article has its own URL and its own share preview (Facebook / Telegram / WhatsApp / Google).
// Run from the repo root:  node tools/build.mjs      (then optionally: node tools/og.mjs)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { PUB, UPDATED, LEGAL, ZH, PUB_ZH, UPDATED_ZH } from "./legal.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/site.config.json"), "utf8"));
const BASE = CFG.base;                       // e.g. "/12invest/" (becomes "/" on a custom domain)
const ABS = p => CFG.origin + BASE + p;      // absolute URL for previews, sitemap, feed
const REL = p => BASE + p;                   // site-absolute path for links
const DISC = "本文仅供参考及教育用途，并不构成任何买卖建议。投资者在作出任何投资决定前，应细阅相关资料并自行判断。投资涉及风险，请谨慎。";
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // Malaysia date
const GC = CFG.goatcounter ? `https://${CFG.goatcounter}.goatcounter.com` : "";

const data = JSON.parse(fs.readFileSync(path.join(ROOT, "posts.json"), "utf8"));
// Article URL = publish date (Malaysia) + ticker, e.g. p/2026-11-02-mydcd/
const posts = data.posts.filter(p => p && p.id && p.title && /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(p.id))
  .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
const skipped = data.posts.filter(p => !posts.includes(p)).map(p => p.id);
if (skipped.length) console.warn("skipped posts with invalid id (need YYYY-MM-DD-ticker):", skipped.join(", "));

// IPO calendar data (updated daily from public sources) — shown even when there is no article yet
const ipoData = JSON.parse(fs.readFileSync(path.join(ROOT, "data/ipos.json"), "utf8"));
const IPOS = (ipoData.ipos || []).filter(i => i && i.ticker && i.name);
const byTicker = Object.fromEntries(IPOS.map(i => [i.ticker, i]));
for (const p of posts) if (p.ticker && byTicker[p.ticker]) p.ipo = byTicker[p.ticker];
const postFor = i => posts.find(p => p.ticker === i.ticker);

// Daily market news (data/news.json, written each trading day by the scheduled task)
const newsData = fs.existsSync(path.join(ROOT, "data/news.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "data/news.json"), "utf8")) : { days: [] };
const NEWS = (newsData.days || []).filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && (d.items || []).length)
  .sort((a, b) => b.date.localeCompare(a.date));
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
// calendar window: anything not yet listed, plus IPOs listed in the last 30 days
const CAL = IPOS.filter(i => !i.listing || i.listing >= addDays(TODAY, -30));
const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const TICKERS = [...new Set([...IPOS.map(i => i.ticker), ...posts.map(p => p.ticker).filter(Boolean)])];
const SOCIAL = [["Facebook", CFG.social && CFG.social.facebook], ["moomoo", CFG.social && CFG.social.moomoo], ["Telegram", CFG.social && CFG.social.telegram]].filter(([, u]) => u);

/* ---------- helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inline = t => esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
const hash = f => crypto.createHash("sha1").update(fs.readFileSync(path.join(ROOT, f))).digest("hex").slice(0, 8);
const short = t => String(t).replace(/^【.*?】\s*/, "");
const WD = "日一二三四五六";
const day = d => { const [y, m, dd] = d.split("-").map(Number); const w = new Date(Date.UTC(y, m - 1, dd)).getUTCDay(); return { md: `${m}月${dd}日`, wd: `（${WD[w]}）` }; };
const fmtPub = iso => { const d = new Date(new Date(iso).getTime() + 8 * 3600e3); return isNaN(d) ? "" : `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; };
const safeImg = p => /^img\/[A-Za-z0-9._-]+$/.test(p || "") && fs.existsSync(path.join(ROOT, p)) ? p : "";
function imgSize(rel){
  const b = fs.readFileSync(path.join(ROOT, rel));
  if (b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  let i = 2;
  while (i < b.length - 9){
    if (b[i] !== 0xFF){ i++; continue; }
    const m = b[i + 1];
    if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  return [0, 0];
}
const img = (rel, alt, eager = false) => {
  const [w, h] = imgSize(rel);
  const tag = `<img src="${REL(rel)}" alt="${esc(alt)}" width="${w}" height="${h}" loading="${eager ? "eager" : "lazy"}" decoding="async">`;
  const webp = rel.replace(/\.(jpe?g|png)$/i, ".webp"); // made by tools/images.py; smaller for phones
  return webp !== rel && fs.existsSync(path.join(ROOT, webp)) ? `<picture><source srcset="${REL(webp)}" type="image/webp">${tag}</picture>` : tag;
};
function write(rel, html){ const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); }

/* ---------- article body markup ---------- */
function render(body, hooks = {}){
  const lines = String(body || "").replace(/\r/g, "").split("\n");
  const out = []; let para = [], ol = [], call = [];
  const flush = () => {
    if (para.length){ out.push("<p>" + inline(para.join("")) + "</p>"); para = []; }
    if (ol.length){ out.push("<ol>" + ol.map(x => "<li>" + inline(x) + "</li>").join("") + "</ol>"); ol = []; }
    if (call.length){ out.push('<div class="callout">' + call.map(x => "<p>" + inline(x) + "</p>").join("") + "</div>"); call = []; }
  };
  for (const raw of lines){
    const l = raw.trim(); let m;
    if (!l){ flush(); continue; }
    if ((m = l.match(/^!\[(.*?)\]\((img\/[A-Za-z0-9._-]+)\)$/))){ flush(); if (safeImg(m[2])) out.push(`<figure>${img(m[2], m[1] || "图表")}${m[1] ? `<figcaption>${esc(m[1])}</figcaption>` : ""}</figure>`); continue; }
    if (l === "---"){ flush(); out.push("<hr>"); continue; }
    if ((m = l.match(/^\{\{(\w+)\}\}$/))){ flush(); if (hooks[m[1]]) out.push(hooks[m[1]]()); continue; }
    if ((m = l.match(/^##\s+(.*)/))){ flush(); out.push("<h2>" + inline(m[1]) + "</h2>"); continue; }
    if ((m = l.match(/^>\s?(.*)/))){ if (para.length || ol.length){ const c = call; call = []; flush(); call = c; } call.push(m[1]); continue; }
    if ((m = l.match(/^\d+[.、]\s*(.*)/))){ if (para.length || call.length){ const o = ol; ol = []; flush(); ol = o; } ol.push(m[1]); continue; }
    if (call.length || ol.length) flush();
    para.push(l);
  }
  flush();
  return out.join("");
}
function plain(p){
  const facts = (p.keyFacts || []).map(f => `${f.k}：${f.v}`).join("\n");
  const body = String(p.body || "").split("\n").map(l => {
    const t = l.trim();
    if (/^!\[.*\]\(img\//.test(t)) return null;
    if (t === "---") return "";
    if (/^\{\{\w+\}\}$/.test(t)) return null;
    return t.replace(/^##\s+/, "").replace(/^>\s?/, "").replace(/\*\*/g, "");
  }).filter(x => x !== null).join("\n").replace(/\n{3,}/g, "\n\n");
  return [p.title, facts, body.trim(), "免责声明：" + DISC, (p.tags || []).map(t => "#" + t).join(" ")].filter(Boolean).join("\n\n");
}

/* ---------- IPO status + events ---------- */
const STEPS = [["open", "开放申请", "开放"], ["close", "截止申请", "截止"], ["pricing", "定价", "定价"], ["ballot", "抽签", "抽签"], ["listing", "挂牌", "挂牌"]];
function ipoStatus(i, today = TODAY){
  if (i.listing && today >= i.listing) return ["listed", "已上市"];
  if (i.close && today > i.close) return ["closed", "已截止 · 待挂牌"];
  if (i.open && today >= i.open) return ["open", today === i.close ? "今天截止" : "招股中"];
  return ["upcoming", "即将招股"];
}
const ipoAttrs = i => ["open", "close", "listing"].filter(k => i[k]).map(k => ` data-${k}="${i[k]}"`).join("");
const badge = i => { const [s, t] = ipoStatus(i); return `<span class="badge" data-ipo${ipoAttrs(i)} data-s="${s}">${t}</span>`; };
const dclass = d => d < TODAY ? " past" : d === TODAY ? " today" : "";
const events = CAL.flatMap(i => STEPS.filter(([k]) => i[k]).map(([k, label]) => ({ d: i[k], label, i, p: postFor(i) })))
  .sort((a, b) => a.d.localeCompare(b.d) || a.i.name.localeCompare(b.i.name));
const evLi = e => { const { md, wd } = day(e.d); const who = `<a href="${REL(e.p ? `p/${e.p.id}/` : `c/${slug(e.i.ticker)}/`)}">${esc(e.i.name)}</a>`;
  return `<li class="ev${dclass(e.d)}" data-d="${e.d}"><time datetime="${e.d}">${md}${wd}</time><span class="kind">${e.label}</span><span class="who">${who} <small>${esc(e.i.board)}</small></span></li>`; };
const stepsHTML = i => `<ol class="steps">${STEPS.filter(([k]) => i[k]).map(([k, , s]) => { const { md } = day(i[k]); return `<li class="step${dclass(i[k])}" data-d="${i[k]}"><i></i><b>${md}</b><span>${s}</span></li>`; }).join("")}</ol>`;

/* ---------- page shell ---------- */
const V = { css: hash("assets/site.css"), js: hash("assets/app.js") };
const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'",
  `img-src 'self' data:${GC ? " " + GC : ""}`, "font-src 'self'", "connect-src 'self'",
  "base-uri 'none'", "form-action 'self'", "object-src 'none'", "manifest-src 'self'", "worker-src 'self'", "upgrade-insecure-requests"
].join("; ");
const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' shape-rendering='crispEdges'%3E%3Crect x='1' y='2' width='10' height='8' fill='%23F4C24F'/%3E%3Crect x='3' y='1' width='6' height='10' fill='%23F4C24F'/%3E%3Crect x='3' y='7' width='1' height='2' fill='%23081230'/%3E%3Crect x='5' y='5' width='1' height='4' fill='%23081230'/%3E%3Crect x='7' y='3' width='1' height='6' fill='%23081230'/%3E%3C/svg%3E";
const LOGO = `<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="3" y="0" width="6" height="1" fill="#B8861A"/><rect x="1" y="1" width="2" height="1" fill="#B8861A"/><rect x="9" y="1" width="2" height="1" fill="#B8861A"/><rect x="0" y="3" width="1" height="6" fill="#B8861A"/><rect x="11" y="3" width="1" height="6" fill="#B8861A"/><rect x="1" y="2" width="10" height="8" fill="#F4C24F"/><rect x="3" y="1" width="6" height="10" fill="#F4C24F"/><rect x="1" y="10" width="2" height="1" fill="#B8861A"/><rect x="9" y="10" width="2" height="1" fill="#B8861A"/><rect x="3" y="11" width="6" height="1" fill="#B8861A"/><rect x="3" y="7" width="1" height="2" fill="#081230"/><rect x="5" y="5" width="1" height="4" fill="#081230"/><rect x="7" y="3" width="1" height="6" fill="#081230"/><rect x="2" y="3" width="1" height="1" fill="#FFE7A3"/></svg>`;
const DEFAULT_DESC = "12Invest：马股新股与上市公司解读，IPO 速读、估值与风险一次看懂。";

function tape(){
  const up = events.filter(e => e.d >= TODAY);
  const items = up.length
    ? up.map(e => { const { md } = day(e.d); return `<span data-d="${e.d}"><i>&gt;</i>${md} ${esc(e.i.name)} ${e.label}</span>`; })
    : posts.slice(0, 6).map(p => `<span><i>&gt;</i>${esc(p.category)} · ${esc(short(p.title).slice(0, 26))}</span>`);
  return items.join("") || `<span><i>&gt;</i>马股新股与上市公司解读</span>`;
}
function page({ path: rel, title, desc = DEFAULT_DESC, nav = "", body, og = {}, head = "", noindex = false, side = false }){
  const url = ABS(rel);
  const ogImg = og.image ? `
<meta property="og:image" content="${esc(ABS(og.image))}">
<meta property="og:image:width" content="${og.w}">
<meta property="og:image:height" content="${og.h}">
<meta name="twitter:image" content="${esc(ABS(og.image))}">` : "";
  return `<!doctype html>
<html lang="zh-CN" data-base="${BASE}"${GC ? ` data-gc="${GC}"` : ""}>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(url)}">`}
<meta property="og:site_name" content="${CFG.siteName}">
<meta property="og:locale" content="zh_CN">
<meta property="og:type" content="${og.type || "website"}">
<meta property="og:title" content="${esc(og.title || title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">${ogImg}
<meta name="twitter:card" content="${og.image ? "summary_large_image" : "summary"}">
<meta name="theme-color" content="#081230">${CFG.googleVerification ? `\n<meta name="google-site-verification" content="${esc(CFG.googleVerification)}">` : ""}
<link rel="icon" href="${FAVICON}">
<link rel="manifest" href="${REL("manifest.webmanifest")}">
<link rel="apple-touch-icon" href="${REL("icons/icon-180.png")}">
<meta name="apple-mobile-web-app-title" content="12Invest">
<link rel="alternate" type="application/rss+xml" title="12Invest" href="${REL("feed.xml")}">
<link rel="preload" href="${REL("fonts/silkscreen-700.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${REL("assets/site.css")}?v=${V.css}">
<script src="${REL("assets/app.js")}?v=${V.js}" defer></script>${head}
</head>
<body>
<header class="mast">
  <div class="wrap">
    <a class="logo" href="${BASE}" aria-label="12Invest 首页">${LOGO}<span><span class="word">12<b>INVEST</b></span><small>马股 · IPO · 公司解读</small></span></a>
    <nav aria-label="主导航"><a href="${BASE}"${nav === "home" ? ' aria-current="page"' : ""}>文章</a>${NEWS.length ? `<a href="${REL("news/")}"${nav === "news" ? ' aria-current="page"' : ""}>速报</a>` : ""}<a href="${REL("ipo/")}"${nav === "ipo" ? ' aria-current="page"' : ""}>IPO</a>${RESULTS.length ? `<a href="${REL("results/")}"${nav === "results" ? ' aria-current="page"' : ""}>业绩</a>` : ""}<a class="nsearch" href="${REL("search/")}" aria-label="搜索"${nav === "search" ? ' aria-current="page"' : ""}><svg viewBox="0 0 10 10" aria-hidden="true" shape-rendering="crispEdges"><path d="M2 1h4v1H2zM1 2h1v4H1zM6 2h1v4H6zM2 6h4v1H2zM6 7h1v1H6zM7 8h1v1H7zM8 9h1v1H8z" fill="currentColor"/></svg></a></nav>
  </div>
  <div class="tape"><div class="wrap">${tape()}</div></div>
</header>
<main class="wrap" id="main">
${side ? `<div class="layout"><div class="main-col">
${body}
</div>
${sidebar()}</div>` : body}
</main>
<footer><div class="wrap"><span class="brand">12INVEST</span><span>本站内容仅供参考及教育用途，并不构成任何买卖建议。投资涉及风险，请自行判断。</span>
${SOCIAL.length ? `<nav class="fsocial" aria-label="关注 12Invest"><span>关注 12Invest：</span>${SOCIAL.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`).join("")}</nav>` : ""}
<nav aria-label="Legal"><a href="${REL("privacy/")}">隐私政策 Privacy Notice</a><a href="${REL("disclaimer/")}">免责声明 Disclaimer</a><a href="${REL("terms/")}">使用条款 Terms of Use</a><a href="${REL("feed.xml")}">RSS</a><span>© ${TODAY.slice(0, 4)} Gyaku Capital Sdn. Bhd. (201901044631)</span></nav></div></footer>
<div class="toast" id="toast" role="status" hidden></div>
</body>
</html>
`;
}

/* ---------- follow box ---------- */
const follow = () => SOCIAL.length ? `<aside class="follow" aria-label="关注 12Invest"><div class="follow-t"><b>关注 12Invest</b><span>新股解读、IPO 日程与上市表现，第一时间更新</span></div><div class="follow-b">${SOCIAL.map(([n, u]) => `<a class="btn primary" href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`).join("")}</div></aside>` : "";

/* ---------- moomoo referral CTA (shown on every IPO) ---------- */
const REF = CFG.moomooReferral;
const isListed = i => i && i.listing && i.listing <= TODAY;
// Apply-for-IPO prompt, worded by stage: open → apply now (with deadline), upcoming → get ready, closed/listed → next IPO
function ipoStage(i){
  if (!i) return null;
  if (i.close && TODAY > i.close) return "done";
  if (i.open && TODAY < i.open) return "soon";
  if (!i.open && !i.close) return "soon";   // application dates not announced yet
  return "open";
}
function moomooCTA(i, mode = "box"){
  if (!REF || !i) return "";
  const st = ipoStage(i), a = `href="${esc(REF)}" target="_blank" rel="sponsored noopener"`;
  const close = i.close ? `${day(i.close).md}下午5点截止` : "";
  const btn = st === "open" ? "立即申购 IPO →" : st === "soon" ? "提前开户，准备申购 →" : "申购下一只新股 →";
  if (mode === "btn") return `<a class="btn mm" ${a}>${st === "open" ? "立即申购" : st === "soon" ? "准备申购" : "申购新股"}</a>`;
  const head = st === "open" ? `${esc(i.name)} 正在招股${close ? `，${close}` : ""}，立即申购！`
    : st === "soon" ? (i.open ? `${esc(i.name)} 将于${day(i.open).md}开放申购，先开户做好准备` : `${esc(i.name)} 即将招股，先开户做好准备`)
    : `错过了 ${esc(i.name)}？下一只新股别再错过`;
  return `<aside class="mmcta" aria-label="申购 IPO"><div class="mm-t"><b>📢 ${head}</b>
  <span>通过 moomoo 一键申购马股新股。推荐链接 · 合作推广，非投资建议，投资前请细阅招股书。</span></div><a class="btn primary" ${a}>${btn}</a></aside>`;
}

/* ---------- IPO results ---------- */
const num = v => typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.]/g, ""));
const rm = v => { const n = num(v); return isNaN(n) ? "" : "RM" + (Math.round(n * 1000) % 10 ? n.toFixed(3) : n.toFixed(2)); };
const finalPrice = i => num((i.result && i.result.final) ?? i.price);
function premium(i){
  const r = i.result || {}, fp = finalPrice(i), c = num(r.close);
  if (!fp || isNaN(c)) return null;
  const v = (c / fp - 1) * 100; return { v, txt: (v > 0 ? "+" : "") + v.toFixed(1) + "%", cls: v > 0 ? "up" : v < 0 ? "down" : "flat" };
}
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
function resultRow(i){
  const r = i.result; if (!r) return "";
  const pr = premium(i), bits = [];
  if (r.oversub != null) bits.push(`<span>公众超额认购 <b>${esc(num(r.oversub).toFixed(2))} 倍</b></span>`);
  if (r.close != null) bits.push(`<span>首日收 <b>${rm(r.close)}</b>${pr ? ` <em class="${pr.cls}">${pr.txt}</em>` : ""}</span>`);
  return bits.length ? `<div class="ipo-res">${bits.join("")}</div>` : "";
}
function ipoCard(i, opts = {}){
  const p = postFor(i), s = (i.sources || [])[0];
  const kv = [["板块", i.board], ["发售价", i.price], ["上市市值", i.cap], ["股票代号", i.code]].filter(([, v]) => v)
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
  const nameHTML = `${esc(i.name)}${i.ticker !== i.name.toUpperCase() ? ` <small>${esc(i.ticker)}</small>` : ""}`;
  return `<article class="ipo px" id="${esc(slug(i.ticker))}">
  <div class="ipo-top"><h2>${opts.noLink ? nameHTML : `<a href="${REL(`c/${slug(i.ticker)}/`)}">${nameHTML}</a>`}</h2>${badge(i)}</div>
  <dl class="ipo-kv">${kv}</dl>
  ${stepsHTML(i)}
  ${resultRow(i)}
  <div class="gfoot">${s ? `<a class="gtime src" href="${esc(s)}" target="_blank" rel="noopener noreferrer">来源：${esc(host(s))} ↗</a>` : "<span></span>"}<span class="gbtns">${moomooCTA(i, "btn")}${p ? `<a class="btn primary" href="${REL(`p/${p.id}/`)}">阅读解读 →</a>` : ""}</span></div>
</article>`;
}
function scoreboard(){
  const done = IPOS.filter(i => i.result && (i.result.close != null || i.result.oversub != null))
    .sort((a, b) => (b.listing || "").localeCompare(a.listing || "")).slice(0, 40);
  if (!done.length) return `<div class="sec">上市表现</div><div class="empty px">新股挂牌后，这里会列出公众超额认购倍数与首日表现。</div>`;
  return `<div class="sec">上市表现</div>
<div class="tbl"><table class="score"><thead><tr><th>公司</th><th>板块</th><th>挂牌日</th><th>IPO 价</th><th>公众超购</th><th>首日开</th><th>首日收</th><th>首日涨跌</th></tr></thead><tbody>
${done.map(i => { const r = i.result, pr = premium(i); return `<tr><td><a href="${REL(`c/${slug(i.ticker)}/`)}">${esc(i.name)}</a></td><td>${esc(i.board)}</td><td>${i.listing ? day(i.listing).md : ""}</td><td>${rm(finalPrice(i))}</td><td>${r.oversub != null ? esc(num(r.oversub).toFixed(2)) + " 倍" : "—"}</td><td>${r.open != null ? rm(r.open) : "—"}</td><td>${r.close != null ? rm(r.close) : "—"}</td><td>${pr ? `<em class="${pr.cls}">${pr.txt}</em>` : "—"}</td></tr>`; }).join("\n")}
</tbody></table></div>`;
}

/* ---------- sidebar (wide screens: beside the content; phones: below it) ---------- */
function sidebar(){
  // one row per IPO that has not listed yet, ordered by its next key date
  const nextStep = i => STEPS.filter(([k]) => i[k] && i[k] >= TODAY).map(([k, label]) => ({ d: i[k], label }))[0];
  const upIpos = CAL.filter(i => !i.listing || i.listing >= TODAY).filter(nextStep)
    .sort((a, b) => nextStep(a).d.localeCompare(nextStep(b).d)).slice(0, 6);
  const res = IPOS.filter(i => i.result && i.result.close != null).sort((a, b) => (b.listing || "").localeCompare(a.listing || "")).slice(0, 5);
  const link = i => REL(postFor(i) ? `p/${postFor(i).id}/` : `c/${slug(i.ticker)}/`);
  return `<aside class="side" aria-label="IPO 动态">
  ${upIpos.length ? `<section class="sbox s-events"><div class="sh"><span>IPO 日程</span><a href="${REL("ipo/")}">全部 →</a></div>
    <ol class="slist">${upIpos.map(i => { const nx = nextStep(i); return `<li class="sipo"><span><a href="${link(i)}">${esc(i.name)}</a><small>${esc(i.board)}${i.listing && nx && nx.d !== i.listing ? ` · ${day(i.listing).md}挂牌` : ""}</small></span><span class="snext">${badge(i)}${nx ? `<small data-next>${day(nx.d).md} ${nx.label}</small>` : ""}</span></li>`; }).join("")}</ol></section>` : ""}
  ${res.length ? `<section class="sbox"><div class="sh"><span>上市首日表现</span><a href="${REL("ipo/")}">更多 →</a></div>
    <ol class="slist">${res.map(i => { const pr = premium(i); return `<li><span><a href="${REL(`c/${slug(i.ticker)}/`)}">${esc(i.name)}</a><small>${esc(i.board)} · ${day(i.listing).md}</small></span>${pr ? `<em class="${pr.cls}">${pr.txt}</em>` : ""}</li>`; }).join("")}</ol></section>` : ""}
  ${REF ? (() => { const openNow = CAL.filter(i => ipoStage(i) === "open" && i.close).sort((x, y) => x.close.localeCompare(y.close));
    return `<section class="sbox s-mm"><div class="sh"><span>📢 立即申购 IPO</span></div>
    ${openNow.length ? `<ul class="mm-open">${openNow.map(i => `<li><b>${esc(i.name)}</b><small>${day(i.close).md} 截止</small></li>`).join("")}</ul>` : `<p class="mm-side">下一只新股开放申购时，第一时间用 moomoo 申购。</p>`}
    <a class="btn primary mm-full" href="${esc(REF)}" target="_blank" rel="sponsored noopener">用 moomoo 立即申购 →</a><small class="note">推荐链接 · 合作推广</small></section>`; })() : ""}
  ${SOCIAL.length ? `<section class="sbox s-follow"><div class="sh"><span>关注 12Invest</span></div><div class="ssocial">${SOCIAL.map(([n, u]) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`).join("")}</div></section>` : ""}
</aside>`;
}

/* ---------- views ---------- */
const cover = (p, eager) => { const src = safeImg(p.cover); return src ? img(src, "", eager) : `<div class="noimg">${esc(p.category || "12INVEST")}</div>`; };
function glance(p, i){
  const g = p.glance || {};
  const stats = (g.stats && g.stats.length ? g.stats : (p.keyFacts || []).slice(0, 4)).filter(s => s.k && s.v);
  const list = (arr, cls, label) => arr && arr.length ? `<div class="gcol ${cls}"><div class="glabel">${label}</div><ul>${arr.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
  const href = REL(`p/${p.id}/`);
  const text = [p.title, p.excerpt, (p.tags || []).join(" "), p.ipo && p.ipo.name].join(" ").toLowerCase();
  return `<article class="glance px" data-cat="${esc(p.category)}" data-text="${esc(text)}">
  <a class="gcover" href="${href}" tabindex="-1" aria-hidden="true">${cover(p, i < 2)}</a>
  <div class="gbody">
    <div class="gtop"><span class="cat">【${esc(p.category)}】</span><span class="gtop-r">${p.ipo ? badge(p.ipo) : ""}<span class="meta"><span>${fmtPub(p.publishedAt)}</span></span></span></div>
    <h2 class="gtitle"><a href="${href}">${esc(p.title)}</a></h2>
    ${stats.length ? `<dl class="gstats">${stats.map(s => `<div class="gstat"><dt>${esc(s.k)}</dt><dd>${esc(s.v)}</dd></div>`).join("")}</dl>` : ""}
    ${(g.pros || g.watch) ? `<div class="gcols">${list(g.pros, "pros", "亮点")}${list(g.watch, "watch", "留意")}</div>` : `<p class="gex">${esc(p.excerpt)}</p>`}
    <div class="gfoot">${g.timeline ? `<span class="gtime">${esc(g.timeline)}</span>` : "<span></span>"}<span class="gbtns">${p.ipo ? moomooCTA(p.ipo, "btn") : ""}<a class="btn primary" href="${href}">阅读全文 →</a></span></div>
  </div>
</article>`;
}
function home(){
  const cats = ["全部", ...new Set(posts.map(p => p.category).filter(Boolean))];
  const upcoming = events.filter(e => e.d >= TODAY);
  const nd = NEWS[0];
  const band = nd ? `<section class="newsband"><div class="nb-hd"><span class="cat">${nlabel(nd)}</span><span class="meta"><span>${longDate(nd.date)}</span></span></div>
  <h2><a href="${REL(nroute(nd))}">${esc(nd.title)}</a></h2>
  ${nd.market ? `<div class="nb-mkt"><b>${esc(nd.market.index || "FBM KLCI")} ${esc(nd.market.close)}</b>${nd.market.date && nd.market.date !== nd.date ? `<small class="note">${day(nd.market.date).md}收市</small>` : ""}<em class="${/^[-−]/.test(nd.market.change || "") ? "down" : "up"}">${esc(nd.market.change)}</em></div>` : ""}
  <ul>${nd.items.slice(0, 4).map(it => `<li><span class="ntag">${esc(it.tag || "焦点")}</span>${esc(it.title)}</li>`).join("")}</ul>
  <a class="btn primary" href="${REL(nroute(nd))}">阅读完整${isWeekly(nd) ? "回顾" : "速报"} →</a></section>` : "";
  // rolling banner: latest edition's headlines, scrolling right to left (pauses on hover; static for reduced motion)
  const rollItems = nd ? nd.items.map(it => `<a href="${REL(nroute(nd))}"><span class="ntag">${esc(it.tag || "焦点")}</span>${esc(it.title)}</a>`).join("") : "";
  const roll = nd ? `<div class="roll" role="region" aria-label="最新快讯"><a class="roll-lbl" href="${REL(nroute(nd))}">最新快讯<small>${day(nd.date).md}</small></a>
  <div class="roll-vp"><div class="roll-track">${rollItems}<span class="roll-dup" aria-hidden="true">${rollItems.replace(/<a /g, '<a tabindex="-1" ')}</span></div></div></div>` : "";
  const body = `${roll}${band}${upcoming.length ? `<section class="upc" data-upcoming><div class="sec"><span>近期 IPO 日程</span><a href="${REL("ipo/")}">完整日历 →</a></div><ol class="events" data-limit="4">${upcoming.map(evLi).join("")}</ol></section>` : ""}
<div class="filters" id="filters" hidden>${cats.map(c => `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === "全部"}">${esc(c)}</button>`).join("")}
  <input class="search" id="q" type="search" placeholder="搜索公司、主题…" aria-label="搜索文章" autocomplete="off"></div>
<div class="sec">一眼看懂 · <span id="count">${posts.length}</span> 篇</div>
<div class="glances">${posts.map((p, i) => glance(p, i)).join("\n")}</div>
<div class="empty px" id="nores" hidden><h3>没有符合的文章</h3>换个关键词，或<a id="sall" href="${REL("search/")}">在全站搜索（速报、IPO）→</a></div>
${follow()}`;
  return page({ path: "", title: "12Invest · 马股新股与上市公司解读", nav: "home", body, side: true,
    og: { image: posts[0] && ogImage(posts[0]).src, w: posts[0] && ogImage(posts[0]).w, h: posts[0] && ogImage(posts[0]).h } });
}
function ogImage(p){
  const gen = `og/${p.id}.jpg`;
  const src = fs.existsSync(path.join(ROOT, gen)) ? gen : safeImg(p.cover);
  if (!src) return {};
  const [w, h] = imgSize(src); return { src, w, h };
}
function shareHTML(p, url = ABS(`p/${p.id}/`), t = short(p.title)){
  const enc = encodeURIComponent;
  return `<div class="share" aria-label="分享这篇文章"><span class="lbl">分享 SHARE</span>
  <a class="btn" href="https://www.facebook.com/sharer/sharer.php?u=${enc(url)}" target="_blank" rel="noopener noreferrer">Facebook</a>
  <a class="btn" href="https://t.me/share/url?url=${enc(url)}&amp;text=${enc(t)}" target="_blank" rel="noopener noreferrer">Telegram</a>
  <a class="btn" href="https://wa.me/?text=${enc(t + " " + url)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
  <button class="btn" type="button" data-copy-link="${esc(url)}">复制链接</button>
</div>`;
}
/* 8-bit financial chart (made by tools/charts.mjs) + the numbers behind it */
function financialsHTML(p, inline = false){
  const f = p.financials; if (!f) return "";
  const chart = `img/${p.id}-fin.png`, has = fs.existsSync(path.join(ROOT, chart));
  const rows = [[f.revenueLabel || "营业额", f.revenue, v => v.toFixed(2)], [f.profitLabel || "税后盈利", f.profit, v => v.toFixed(2)],
    ...(f.margin ? [[f.marginLabel || "利润率", f.margin, v => v.toFixed(2) + "%"]] : [])];
  return `<section class="fin${inline ? " inline" : ""}">${inline ? "" : `<div class="sec">财务速览</div>`}
  ${has ? `<figure class="finchart">${img(chart, `${f.title || "财务表现"}（资料来源：${f.source || "公司招股书"}）`)}</figure>` : ""}
  <details class="findata"><summary>查看数据（${esc(f.unit || "RM m")}）</summary><div class="tbl"><table class="score"><thead><tr><th></th>${f.periods.map(x => `<th>${esc(x)}</th>`).join("")}</tr></thead>
  <tbody>${rows.map(([k, vals, fm]) => `<tr><td>${esc(k)}</td>${vals.map(v => `<td>${fm(num(v))}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details></section>`;
}
function article(p){
  const facts = (p.keyFacts || []).filter(f => f.k && f.v);
  const txt = plain(p);
  const others = posts.filter(x => x.id !== p.id).slice(0, 3);
  const o = ogImage(p);
  const ld = JSON.stringify({
    "@context": "https://schema.org", "@type": "NewsArticle", headline: short(p.title).slice(0, 110),
    image: o.src ? [ABS(o.src)] : undefined, datePublished: p.publishedAt, dateModified: p.updatedAt || p.publishedAt,
    inLanguage: "zh-CN", mainEntityOfPage: ABS(`p/${p.id}/`), description: p.excerpt,
    author: { "@type": "Organization", name: "12Invest" }, publisher: { "@type": "Organization", name: "12Invest" }
  }).replace(/</g, "\\u003c");
  const body = `<article class="article">
  <a class="back" href="${BASE}">← 返回首页</a>
  <div class="cat">【${esc(p.category || "未分类")}】</div>
  <h1>${esc(p.title)}</h1>
  <div class="meta"><span>${fmtPub(p.publishedAt)}</span><span>12Invest</span>${p.ipo ? badge(p.ipo) : ""}${p.ticker ? `<a class="tick" href="${REL(`c/${slug(p.ticker)}/`)}">${esc(p.ticker)} 公司页 →</a>` : ""}</div>
  ${facts.length ? `<dl class="facts"><div class="hd">关键资料<span>KEY FACTS</span></div>${facts.map(f => `<div class="fact"><dt>${esc(f.k)}</dt><dd>${esc(f.v)}</dd></div>`).join("")}</dl>` : ""}
  ${/\{\{financials\}\}/.test(p.body || "") ? "" : financialsHTML(p)}
  <div class="body">${render(p.body, { financials: () => financialsHTML(p, true) })}</div>
  ${p.ipo ? moomooCTA(p.ipo) : ""}
  <p class="disc"><strong>免责声明：</strong>${DISC}</p>
  ${(p.tags || []).length ? `<div class="tags">${p.tags.map(t => `<span>#${esc(t)}</span>`).join("")}</div>` : ""}
  ${shareHTML(p)}
  ${follow()}
  <div class="tools"><button class="btn" type="button" data-copy-full>复制全文</button><span class="note">${[...txt].length.toLocaleString("en")} 字符 · 纯文字，可直接贴到 Facebook</span></div>
  <textarea class="copysrc" id="copysrc" hidden readonly aria-label="全文纯文字">${esc(txt)}</textarea>
  ${others.length ? `<section class="more"><div class="sec">更多文章</div><div class="list">${others.map(x => `<a class="item" href="${REL(`p/${x.id}/`)}"><div class="cover">${cover(x)}</div><div class="minw0"><div class="cat">【${esc(x.category)}】</div><h3>${esc(x.title)}</h3><div class="meta"><span>${fmtPub(x.publishedAt)}</span></div></div></a>`).join("")}</div></section>` : ""}
</article>`;
  return page({ path: `p/${p.id}/`, title: `${short(p.title)} · 12Invest`, desc: p.excerpt, body, side: true,
    og: { type: "article", title: p.title, image: o.src, w: o.w, h: o.h },
    head: `\n<meta property="article:published_time" content="${esc(p.publishedAt)}">\n<script type="application/ld+json">${ld}</script>` });
}
function calendar(){
  // not yet listed first (soonest listing first), then recently listed (newest first)
  const pending = CAL.filter(i => !i.listing || i.listing > TODAY).sort((a, b) => (a.listing || "9999").localeCompare(b.listing || "9999"));
  const listed = CAL.filter(i => i.listing && i.listing <= TODAY).sort((a, b) => b.listing.localeCompare(a.listing));
  const ipos = [...pending, ...listed];
  const body = `<div class="page-hd"><div class="cat">IPO CALENDAR</div><h1>IPO 日历</h1><p>12Invest 追踪中的马股新股。日期为马来西亚时间，以招股书为准；招股一般在截止日下午5点结束。</p></div>
${calcHTML()}
<div class="sec">关键日期</div>
<ol class="events">${events.map(evLi).join("")}</ol>
<div class="sec">新股一览</div>
<div class="ipos">${ipos.map(i => ipoCard(i)).join("\n")}</div>
<p class="note">资料取自招股书、公司新闻稿及媒体报道，每日更新${ipoData.updated ? `（最后更新：${esc(ipoData.updated)}）` : ""}。日期如有更改，以 Bursa Malaysia 公告为准。</p>
${scoreboard()}
<p class="note">首日涨跌以首日收市价对比最终 IPO 价计算，仅供参考。</p>`;
  return page({ path: "ipo/", title: "IPO 日历 · 12Invest", desc: "马股新股招股、抽签与挂牌日期一览，附 12Invest 新股解读。", nav: "ipo", body });
}
function company(t){
  const i = byTicker[t], arts = posts.filter(p => p.ticker === t);
  const name = (i && i.name) || (arts[0] && arts[0].ticker) || t;
  const sub = [i && i.company, i && i.board, i && i.code && `股票代号 ${i.code}`].filter(Boolean).join(" · ");
  const body = `<div class="page-hd"><div class="cat">COMPANY · ${esc(t)}</div><h1>${esc(name)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div>
${i ? `<div class="sec">IPO</div><div class="ipos one">${ipoCard(i, { noLink: true })}</div>` : ""}
<div class="sec">12Invest 解读 · ${arts.length} 篇</div>
${arts.length ? `<div class="glances">${arts.map((p, k) => glance(p, k)).join("\n")}</div>` : `<div class="empty px">暂时还没有这家公司的解读。</div>`}
${follow()}`;
  return page({ path: `c/${slug(t)}/`, title: `${name}（${t}）· 12Invest`, desc: `${name}${i && i.company ? `（${i.company}）` : ""}的 IPO 日程与 12Invest 解读。`, body, noindex: !arts.length, side: true });
}
/* ---------- daily news + weekly wrap ---------- */
const isWeekly = d => d.kind === "weekly";
const nroute = d => `${isWeekly(d) ? "weekly" : "news"}/${d.date}/`;
const nlabel = (d, L = "zh") => L === "en" ? (isWeekly(d) ? "12Invest Weekly Wrap" : "12Invest Daily Bursa Brief") : (isWeekly(d) ? "每周回顾" : "每日马股速报");
const longDate = d => { const { md, wd } = day(d); return `${d.slice(0, 4)}年${md}${wd}`; };
const enDate = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
function tickerChip(t){
  const known = TICKERS.includes(t);
  return known ? `<a class="tchip" href="${REL(`c/${slug(t)}/`)}">${esc(t)}</a>` : `<span class="tchip">${esc(t)}</span>`;
}
function newsDayHTML(d, L = "zh", heading = "h1"){
  const en = L === "en" && d.en ? d.en : null, m = d.market;
  const T = en ? { close: "close", chg: "Change", br: "Breadth", to: "Turnover", week: "this week", src: "Source", disc: "<strong>Disclaimer:</strong> Summarised by 12Invest in our own words from public news and announcements, for information only. Not investment advice. See the original sources for details." }
    : { close: "收市", chg: "涨跌", br: "涨跌家数", to: "成交", week: "本周", src: "来源", disc: `<strong>免责声明：</strong>${isWeekly(d) ? "回顾" : "速报"}内容整理自公开新闻与公告，由 12Invest 以自己的文字撰写，仅供参考，不构成任何买卖建议。详情请参阅原文来源。` };
  const items = d.items.map((it, k) => ({ ...it, ...(en && en.items && en.items[k] ? en.items[k] : {}) }));
  const mdate = m && (m.range ? `${T.week}（${esc(m.range)}）` : m.date ? (en ? `${enDate(m.date)} ${T.close}` : `${day(m.date).md}${T.close}`) : "");
  return `<div class="cat">${nlabel(d, L)} · ${isWeekly(d) ? "WEEKLY" : "DAILY"}</div>
  <${heading} class="nd-title">${esc(en ? en.title : d.title)}</${heading}>
  <div class="meta"><span>${en ? enDate(d.date) : longDate(d.date)}</span><span>12Invest</span></div>
  ${m ? `<section class="mkt"><dl>
    <div><dt>${esc(m.index || "FBM KLCI")}${mdate ? ` · ${mdate}` : ""}</dt><dd>${esc(m.close)}</dd></div>
    <div><dt>${T.chg}</dt><dd><em class="${/^[-−]/.test(m.change || "") ? "down" : "up"}">${esc(m.change)}</em></dd></div>
    ${m.breadth && !en ? `<div><dt>${T.br}</dt><dd>${esc(m.breadth)}</dd></div>` : ""}
    ${m.turnover && !en ? `<div><dt>${T.to}</dt><dd>${esc(m.turnover)}</dd></div>` : ""}
  </dl>${(en ? en.note : m.note) ? `<p>${esc(en ? en.note : m.note)}${m.source ? ` <a class="nsrc-a" href="${esc(m.source.url)}" target="_blank" rel="noopener noreferrer">${T.src}: ${esc(m.source.name)} ↗</a>` : ""}</p>` : ""}</section>` : ""}
  <ol class="nitems">${items.map(it => `<li class="nitem"><span class="ntag">${esc(en ? (it.tagEn || it.tag) : it.tag || "焦点")}</span><div class="nbody">
    <h3>${esc(it.title)}</h3><p>${esc(it.text)}</p>
    <div class="nsrc">${(it.tickers || []).map(tickerChip).join("")}${it.source ? `<a href="${esc(it.source.url)}" target="_blank" rel="noopener noreferrer">${T.src}${en ? ":" : "："} ${esc(it.source.name)} ↗</a>` : ""}</div>
  </div></li>`).join("")}</ol>
  <p class="disc">${T.disc}</p>`;
}
// plain text for Facebook / WhatsApp, copied with one click
function newsPlain(d){
  const m = d.market || {}, md = day(d.date).md;
  return [`${isWeekly(d) ? "📅 12Invest 每周回顾" : "📰 每日马股速报"}｜${md}`, d.title,
    m.close ? `📈 ${m.index || "FBM KLCI"}${m.range ? `（${m.range}）` : m.date ? `（${day(m.date).md}收市）` : ""} ${m.close} ${m.change || ""}${m.note ? `\n${m.note}` : ""}` : "",
    d.items.map((it, k) => `${k + 1}. 【${it.tag || "焦点"}】${it.title}\n${it.text}`).join("\n\n"),
    `👉 完整${isWeekly(d) ? "回顾" : "速报"}：${ABS(nroute(d))}`,
    `${isWeekly(d) ? "#每周回顾" : "#每日马股速报"} #12Invest`,
    "免责声明：内容整理自公开新闻与公告，仅供参考，不构成任何买卖建议。"].filter(Boolean).join("\n\n");
}
function newsBody(d){
  if (!d.en) return newsDayHTML(d);
  const tabs = `<div class="langs" role="group" aria-label="语言 / Language"><a class="chip" href="#zh">中文</a><a class="chip" href="#en" lang="en">English</a></div>`;
  return `<div class="langsw"><section class="lang" id="zh">${tabs}${newsDayHTML(d)}</section><section class="lang" id="en" lang="en">${tabs}${newsDayHTML(d, "en")}</section></div>`;
}
function newsIndex(kind){
  const list = NEWS.filter(d => kind === "weekly" ? isWeekly(d) : !isWeekly(d));
  const [latest, ...rest] = list;
  const weekly = kind === "weekly";
  const other = NEWS.filter(d => weekly ? !isWeekly(d) : isWeekly(d))[0];
  const body = `<div class="article newsday">${newsBody(latest)}
  <div class="tools"><a class="btn" href="${REL(nroute(latest))}">单独页面 · 分享</a>${other ? `<a class="btn" href="${REL(weekly ? "news/" : "weekly/")}">${weekly ? "每日速报 →" : "每周回顾 →"}</a>` : ""}</div>
  ${rest.length ? `<section class="more"><div class="sec">往期${weekly ? "回顾" : "速报"}</div><ol class="nlist">${rest.map(d => `<li><a href="${REL(nroute(d))}"><time>${longDate(d.date)}</time><span>${esc(d.title)}</span></a></li>`).join("")}</ol></section>` : ""}
  ${follow()}</div>`;
  return page({ path: `${kind}/`, title: `${weekly ? "每周回顾" : "每日马股速报"} · 12Invest`, nav: "news", body, side: true,
    desc: weekly ? "每周六整理：一周大市表现、新股上市表现与重点新闻。" : "每个交易日开市前整理：上一交易日大市表现、新股、合约与企业动态，每条附来源。" });
}
function newsPage(d){
  const list = NEWS.filter(x => isWeekly(x) === isWeekly(d)), i = list.indexOf(d);
  const prev = list[i + 1], next = list[i - 1], url = ABS(nroute(d)), label = nlabel(d);
  const ogf = `og/${isWeekly(d) ? "weekly" : "news"}-${d.date}.jpg`;
  const og = fs.existsSync(path.join(ROOT, ogf)) ? ogf : null;
  const [w, h] = og ? imgSize(og) : [0, 0];
  const txt = newsPlain(d);
  const body = `<div class="article newsday"><a class="back" href="${REL(isWeekly(d) ? "weekly/" : "news/")}">← 所有${isWeekly(d) ? "回顾" : "速报"}</a>${newsBody(d)}
  ${shareHTML(null, url, `${label} ${day(d.date).md}：${d.title}`)}
  <div class="tools"><button class="btn primary" type="button" data-copy-full>复制 Facebook 文案</button><span class="note">${[...txt].length.toLocaleString("en")} 字符 · 含链接与标签</span></div>
  <textarea class="copysrc" id="copysrc" hidden readonly aria-label="Facebook 文案">${esc(txt)}</textarea>
  <div class="tools">${prev ? `<a class="btn" href="${REL(nroute(prev))}">← ${day(prev.date).md}</a>` : ""}${next ? `<a class="btn" href="${REL(nroute(next))}">${day(next.date).md} →</a>` : ""}</div>
  ${follow()}</div>`;
  return page({ path: nroute(d), title: `${label} ${day(d.date).md} · 12Invest`, desc: d.title, nav: "news", body, side: true,
    og: { type: "article", title: `${label} ${day(d.date).md}｜${d.title}`, image: og, w, h } });
}

/* ---------- results season tracker ---------- */
const resData = fs.existsSync(path.join(ROOT, "data/results.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "data/results.json"), "utf8")) : { results: [] };
const RESULTS = (resData.results || []).filter(r => r && r.ticker && r.quarter).sort((a, b) => String(b.announced || "").localeCompare(String(a.announced || "")));
function yoy(a, b){ a = num(a); b = num(b); if (isNaN(a) || isNaN(b) || b === 0) return ""; const v = (a / b - 1) * 100; if (b < 0 || a < 0 && b > 0) return `<em class="flat">${a < 0 && b < 0 ? "亏损收窄/扩大" : a < 0 ? "转亏" : "转盈"}</em>`; return `<em class="${v > 0 ? "up" : v < 0 ? "down" : "flat"}">${v > 0 ? "+" : ""}${v.toFixed(1)}%</em>`; }
function resultsPage(){
  const body = `<div class="page-hd"><div class="cat">RESULTS SEASON</div><h1>业绩追踪</h1><p>12Invest 追踪的公司最新季度业绩（按年比较）。数字取自公司向马交所提交的季度报告或媒体报道，单位为 RM million。</p></div>
${RESULTS.length ? `<div class="tbl"><table class="score"><thead><tr><th>公司</th><th>季度</th><th>公布日</th><th>营业额</th><th>按年</th><th>净利</th><th>按年</th><th>来源</th></tr></thead><tbody>
${RESULTS.map(r => `<tr><td><a href="${REL(`c/${slug(r.ticker)}/`)}">${esc(r.name || r.ticker)}</a></td><td>${esc(r.quarter)}</td><td>${r.announced ? day(r.announced).md : ""}</td>
<td>${r.revenue != null ? num(r.revenue).toFixed(1) : "—"}</td><td>${yoy(r.revenue, r.revenuePrev) || "—"}</td><td>${r.profit != null ? num(r.profit).toFixed(1) : "—"}</td><td>${yoy(r.profit, r.profitPrev) || "—"}</td>
<td>${r.source ? `<a href="${esc(r.source.url)}" target="_blank" rel="noopener noreferrer">${esc(r.source.name)} ↗</a>` : ""}</td></tr>`).join("\n")}
</tbody></table></div>` : `<div class="empty px"><h3>业绩季开始后在这里更新</h3>12Invest 解读过的公司以及近期上市的新股，一公布季度业绩就会自动加入这个表。</div>`}
<p class="note">净利指归属股东的税后盈利（如适用）。按年比较以去年同季为基准。仅供参考，不构成任何买卖建议。</p>`;
  return page({ path: "results/", title: "业绩追踪 · 12Invest", desc: "12Invest 追踪公司的最新季度业绩：营业额与净利按年变化。", nav: "results", body, side: true });
}

/* ---------- IPO application calculator ---------- */
function calcHTML(){
  const pick = CAL.filter(i => !isNaN(num(i.price)) && ipoStage(i) !== "done" && !isListed(i)).sort((a, b) => (a.close || a.listing || "9").localeCompare(b.close || b.listing || "9"));
  const subs = IPOS.filter(i => i.result && i.result.oversub != null && i.board !== "主板").sort((a, b) => (b.listing || "").localeCompare(a.listing || "")).slice(0, 8);
  const avg = subs.length ? subs.reduce((s, i) => s + num(i.result.oversub), 0) / subs.length : null;
  const data = JSON.stringify({ ipos: pick.map(i => ({ t: i.ticker, n: i.name, p: num(i.price), c: i.close || "", b: i.board, max: /最高/.test(i.price) })), ref: REF || "" }).replace(/</g, "\\u003c");
  return `<section class="calc px" id="calc" hidden><div class="sh"><span>申购计算器</span><span class="note">1 手 = 100 股</span></div>
  <div class="calc-f"><label class="f">选择新股<select id="calc-ipo"></select></label><label class="f">申购手数<input id="calc-lots" type="number" inputmode="numeric" min="1" step="1" value="10"></label></div>
  <div class="calc-o"><div><small>股数</small><b id="calc-sh">—</b></div><div><small>申购金额</small><b id="calc-amt">—</b></div><div><small>截止</small><b id="calc-close">—</b></div></div>
  <p class="note" id="calc-note">${avg != null ? `参考：近期 ${subs.length} 只 ACE 新股公众部分平均超额认购约 ${avg.toFixed(1)} 倍，中签与否靠抽签。` : ""}未含申购手续费；最高价新股按最高价计算，多付金额在定价后退回。</p>
  ${REF ? `<a class="btn primary mm-full" href="${esc(REF)}" target="_blank" rel="sponsored noopener">用 moomoo 立即申购 →</a><small class="note calc-ref">推荐链接 · 合作推广</small>` : ""}
  <script type="application/json" id="calc-data">${data}</script></section>`;
}

/* ---------- site search ---------- */
function searchPage(){
  const body = `<div class="page-hd"><div class="cat">SEARCH</div><h1>全站搜索</h1><p>搜索文章、每日速报、每周回顾与 IPO。</p></div>
  <form class="sform" role="search" action="${REL("search/")}"><input class="search big" id="sq" name="q" type="search" placeholder="公司名、股票代号、主题…" aria-label="搜索" autocomplete="off"></form>
  <div id="sres" class="sres" aria-live="polite"></div>
  <noscript><p class="note">搜索需要启用 JavaScript。</p></noscript>`;
  return page({ path: "search/", title: "搜索 · 12Invest", nav: "search", body, side: true });
}
function searchIndex(){
  const rows = [];
  for (const p of posts) rows.push({ k: "文章", t: p.title, x: p.excerpt || "", u: REL(`p/${p.id}/`), d: (p.publishedAt || "").slice(0, 10), s: [p.ticker, ...(p.tags || [])].filter(Boolean).join(" ") });
  for (const d of NEWS) d.items.forEach(it => rows.push({ k: isWeekly(d) ? "每周回顾" : "速报", t: it.title, x: it.text, u: REL(nroute(d)), d: d.date, s: (it.tickers || []).join(" ") }));
  for (const i of IPOS) rows.push({ k: "IPO", t: `${i.name}（${i.board}）`, x: [i.company, i.price, i.listing ? `${day(i.listing).md}挂牌` : ""].filter(Boolean).join(" · "), u: REL(`c/${slug(i.ticker)}/`), d: i.listing || "", s: i.ticker });
  return JSON.stringify(rows);
}

function legal(key){
  // English + Chinese on every legal page. The privacy notice also keeps Bahasa Malaysia: PDPA s.7(3) requires
  // the notice in both the national language and English.
  const doc = LEGAL[key];
  const langs = [["en", "English", "en", doc.en, PUB.en, UPDATED.en, "Contact us", "Email"],
    ["zh", "中文", "zh-CN", ZH[key], PUB_ZH, UPDATED_ZH, "联络我们", "电邮"],
    ...(key === "privacy" ? [["bm", "Bahasa Malaysia", "ms", doc.bm, PUB.bm, UPDATED.bm, "Hubungi kami", "E-mel"]] : [])];
  const tabs = `<div class="langs" role="group" aria-label="Language / 语言">${langs.map(([id, label, hl]) => `<a class="chip" href="#${id}" lang="${hl}">${label}</a>`).join("")}</div>`;
  const others = L => Object.keys(LEGAL).filter(k => k !== key).map(k => `<a class="btn" href="${REL(k + "/")}">${esc(L === "zh" ? ZH[k].title : L === "bm" ? LEGAL[k].bm.title : LEGAL[k].en.title)}</a>`).join("");
  const sec = ([id, , hl, d, pub, upd, contact, mail]) => `<section class="lang-${id}" id="${id}" lang="${hl}">
    ${tabs}
    <h1>${esc(d.title)}</h1>
    <div class="meta"><span>${esc(d.sub)}</span><span>${esc(upd)}</span></div>
    <div class="body">
      ${d.s.map(([h, p], i) => `<h2>${i + 1}. ${esc(h)}</h2><p>${esc(p)}</p>`).join("\n      ")}
      <h2>${contact}</h2>
      <p>${esc(pub)}</p>
      <div class="callout"><p>${mail}: <strong class="sel">${esc(CFG.contact)}</strong></p></div>
    </div>
    <div class="tools">${others(id)}</div>
  </section>`;
  const body = `<article class="article legal">
  <a class="back" href="${BASE}">← 返回首页</a>
  <div class="cat">${esc(doc.zh)}</div>
  ${langs.map(sec).join("\n  ")}
</article>`;
  return page({ path: key + "/", title: `${doc.en.title} · ${ZH[key].title} · 12Invest`, desc: `${doc.en.title} / ${ZH[key].title} — 12Invest (Gyaku Capital Sdn. Bhd.)`, body });
}
function redirect(to){
  const u = ABS(to);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${esc(u)}"><link rel="canonical" href="${esc(u)}"><meta name="robots" content="noindex"><title>12Invest</title></head><body><a href="${esc(u)}">${esc(u)}</a></body></html>\n`;
}
function notFound(){
  return page({ path: "404.html", title: "找不到页面 · 12Invest", noindex: true,
    body: `<div class="empty px"><h3>找不到这个页面</h3>链接可能已更改。<br><br><a class="btn primary" href="${BASE}">返回首页</a></div>` });
}

/* ---------- write everything ---------- */
const urls = [];
write("index.html", home()); urls.push(["", data.updated]);
write("ipo/index.html", calendar()); urls.push(["ipo/", data.updated]);
if (NEWS.some(d => !isWeekly(d))){ write("news/index.html", newsIndex("news")); urls.push(["news/", NEWS.find(d => !isWeekly(d)).date]); }
if (NEWS.some(isWeekly)){ write("weekly/index.html", newsIndex("weekly")); urls.push(["weekly/", NEWS.find(isWeekly).date]); }
NEWS.forEach(d => { write(`${nroute(d)}index.html`, newsPage(d)); urls.push([nroute(d), d.date]); });
write("results/index.html", resultsPage()); if (RESULTS.length) urls.push(["results/", RESULTS[0].announced || data.updated]);
write("search/index.html", searchPage());
write("search.json", searchIndex());
for (const p of posts){
  write(`p/${p.id}/index.html`, article(p)); urls.push([`p/${p.id}/`, (p.updatedAt || p.publishedAt).slice(0, 10)]);
  for (const old of p.oldIds || []) if (/^[a-z0-9-]+$/.test(old) && old !== p.id) write(`p/${old}/index.html`, redirect(`p/${p.id}/`)); // keep old shared links working
}
for (const tk of TICKERS){ write(`c/${slug(tk)}/index.html`, company(tk)); if (posts.some(p => p.ticker === tk)) urls.push([`c/${slug(tk)}/`, data.updated]); }
for (const k of Object.keys(LEGAL)){ write(`${k}/index.html`, legal(k)); urls.push([`${k}/`, null]); }
write("404.html", notFound());
write("offline.html", page({ path: "offline.html", title: "离线 · 12Invest", noindex: true,
  body: `<div class="empty px"><h3>目前没有网络</h3>你之前看过的文章和速报仍可离线阅读。连上网络后再刷新即可。<br><br><a class="btn primary" href="${BASE}">返回首页</a></div>` }));
write("manifest.webmanifest", JSON.stringify({
  name: "12Invest · 马股新股与上市公司解读", short_name: "12Invest", lang: "zh-CN", start_url: BASE, scope: BASE, display: "standalone",
  background_color: "#081230", theme_color: "#081230", description: DEFAULT_DESC,
  icons: [192, 512].map(s => ({ src: REL(`icons/icon-${s}.png`), sizes: `${s}x${s}`, type: "image/png", purpose: "any" }))
    .concat([{ src: REL("icons/icon-maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" }])
}, null, 1));
// service worker: cache-first for static files, network-first for pages (falls back to the cached copy, then offline.html)
const SWV = crypto.createHash("sha1").update(V.css + V.js + data.updated + (NEWS[0] ? NEWS[0].date : "")).digest("hex").slice(0, 8);
write("sw.js", `const V = "12i-${SWV}", BASE = ${JSON.stringify(BASE)};
const PRE = [BASE, BASE + "offline.html", BASE + "assets/site.css?v=${V.css}", BASE + "assets/app.js?v=${V.js}", BASE + "fonts/silkscreen-400.woff2", BASE + "fonts/silkscreen-700.woff2", BASE + "icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(PRE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || !u.pathname.startsWith(BASE)) return;
  if (r.mode === "navigate" || (r.headers.get("accept") || "").includes("text/html")) {
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(V).then(x => x.put(r, c)); return res; })
      .catch(() => caches.match(r).then(m => m || caches.match(BASE + "offline.html"))));
    return;
  }
  if (/\\.json$/.test(u.pathname)) { e.respondWith(fetch(r).catch(() => caches.match(r))); return; }
  e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(V).then(x => x.put(r, c)); } return res; })));
});
`);
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, d]) => `  <url><loc>${esc(ABS(u))}</loc>${d ? `<lastmod>${d}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`);
write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${ABS("sitemap.xml")}\n`);
write("feed.xml", `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>12Invest</title>
  <link>${esc(ABS(""))}</link>
  <atom:link href="${esc(ABS("feed.xml"))}" rel="self" type="application/rss+xml"/>
  <description>马股新股与上市公司解读</description>
  <language>zh-cn</language>
${NEWS.slice(0, 10).map(d => `  <item>
    <title>${esc(`${nlabel(d)} ${day(d.date).md}：${d.title}`)}</title>
    <link>${esc(ABS(nroute(d)))}</link>
    <guid isPermaLink="true">${esc(ABS(nroute(d)))}</guid>
    <pubDate>${new Date(d.date + "T10:30:00Z").toUTCString()}</pubDate>
    <description>${esc(d.items.map(it => it.title).join("；"))}</description>
  </item>`).join("\n")}
${posts.map(p => `  <item>
    <title>${esc(p.title)}</title>
    <link>${esc(ABS(`p/${p.id}/`))}</link>
    <guid isPermaLink="true">${esc(ABS(`p/${p.id}/`))}</guid>
    <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>
    <description>${esc(p.excerpt)}</description>
  </item>`).join("\n")}
</channel>
</rss>
`);
console.log(`built ${urls.length} pages for ${CFG.origin}${BASE} (Malaysia date ${TODAY})`);
