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
  "base-uri 'none'", "form-action 'none'", "object-src 'none'", "manifest-src 'self'", "upgrade-insecure-requests"
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
<link rel="alternate" type="application/rss+xml" title="12Invest" href="${REL("feed.xml")}">
<link rel="preload" href="${REL("fonts/silkscreen-700.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${REL("assets/site.css")}?v=${V.css}">
<script src="${REL("assets/app.js")}?v=${V.js}" defer></script>${head}
</head>
<body>
<header class="mast">
  <div class="wrap">
    <a class="logo" href="${BASE}" aria-label="12Invest 首页">${LOGO}<span><span class="word">12<b>INVEST</b></span><small>马股 · IPO · 公司解读</small></span></a>
    <nav aria-label="主导航"><a href="${BASE}"${nav === "home" ? ' aria-current="page"' : ""}>文章</a><a href="${REL("ipo/")}"${nav === "ipo" ? ' aria-current="page"' : ""}>IPO 日历</a></nav>
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
  <div class="gfoot">${s ? `<a class="gtime src" href="${esc(s)}" target="_blank" rel="noopener noreferrer">来源：${esc(host(s))} ↗</a>` : "<span></span>"}${p ? `<a class="btn primary" href="${REL(`p/${p.id}/`)}">阅读解读 →</a>` : `<span class="note">暂无解读</span>`}</div>
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
    <div class="gfoot">${g.timeline ? `<span class="gtime">${esc(g.timeline)}</span>` : "<span></span>"}<a class="btn primary" href="${href}">阅读全文 →</a></div>
  </div>
</article>`;
}
function home(){
  const cats = ["全部", ...new Set(posts.map(p => p.category).filter(Boolean))];
  const upcoming = events.filter(e => e.d >= TODAY);
  const body = `${upcoming.length ? `<section class="upc" data-upcoming><div class="sec"><span>近期 IPO 日程</span><a href="${REL("ipo/")}">完整日历 →</a></div><ol class="events" data-limit="4">${upcoming.map(evLi).join("")}</ol></section>` : ""}
<div class="filters" id="filters" hidden>${cats.map(c => `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === "全部"}">${esc(c)}</button>`).join("")}
  <input class="search" id="q" type="search" placeholder="搜索公司、主题…" aria-label="搜索文章" autocomplete="off"></div>
<div class="sec">一眼看懂 · <span id="count">${posts.length}</span> 篇</div>
<div class="glances">${posts.map((p, i) => glance(p, i)).join("\n")}</div>
<div class="empty px" id="nores" hidden><h3>没有符合的文章</h3>换个关键词或分类试试。</div>
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
function shareHTML(p){
  const url = ABS(`p/${p.id}/`), t = short(p.title);
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
for (const p of posts){
  write(`p/${p.id}/index.html`, article(p)); urls.push([`p/${p.id}/`, (p.updatedAt || p.publishedAt).slice(0, 10)]);
  for (const old of p.oldIds || []) if (/^[a-z0-9-]+$/.test(old) && old !== p.id) write(`p/${old}/index.html`, redirect(`p/${p.id}/`)); // keep old shared links working
}
for (const tk of TICKERS){ write(`c/${slug(tk)}/index.html`, company(tk)); if (posts.some(p => p.ticker === tk)) urls.push([`c/${slug(tk)}/`, data.updated]); }
for (const k of Object.keys(LEGAL)){ write(`${k}/index.html`, legal(k)); urls.push([`${k}/`, null]); }
write("404.html", notFound());
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
