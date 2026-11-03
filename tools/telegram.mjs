// Posts newly published articles to the 12Invest Telegram channel (photo + caption + link).
// Runs in the GitHub Action after the site is built and pushed. Needs the repo secret TELEGRAM_BOT_TOKEN;
// without it, it does nothing. Already-posted article ids are kept in data/telegram.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/site.config.json"), "utf8"));
const CHAT = process.env.TELEGRAM_CHAT_ID || CFG.telegramChat;
if (!TOKEN || !CHAT) { console.log("Telegram: no bot token or chat set; skipping."); process.exit(0); }

if (process.env.TELEGRAM_TEST === "true"){ // manual check from GitHub → Actions → Build site → Run workflow
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text: "✅ 12Invest 网站已连接 Telegram 频道。新文章发布后会自动推送到这里。\n" + CFG.origin + CFG.base }) });
  const j = await r.json();
  console.log(j.ok ? "Telegram test: sent." : `Telegram test failed: ${j.description}`);
  process.exit(j.ok ? 0 : 1);
}

const stateFile = path.join(ROOT, "data/telegram.json");
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : { posted: [] };
const { posts } = JSON.parse(fs.readFileSync(path.join(ROOT, "posts.json"), "utf8"));
const todo = posts.filter(p => p.id && !state.posted.includes(p.id) && !p.noTelegram)
  .sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)));
if (!todo.length) { console.log("Telegram: nothing new."); process.exit(0); }

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = id => CFG.origin + CFG.base + `p/${id}/`;

// Telegram post = summary caption + article URL + ticker hashtag.
// Summary: headline, short intro, key figures, highlights, watch points and key dates (from the article's glance data).
// A hand-written "telegram" field in posts.json replaces the generated summary. Photo captions max 1024 characters.
function summary(p){
  const g = p.glance || {};
  const parts = [`【${String(p.title).replace(/^【.*?】\s*/, "")}】`, p.excerpt || ""];
  if ((g.stats || []).length) parts.push("📊 " + g.stats.map(s => `${s.k} ${s.v}`).join("｜"));
  if ((g.pros || []).length) parts.push("✅ 亮点\n" + g.pros.map(x => "• " + x).join("\n"));
  if ((g.watch || []).length) parts.push("⚠️ 留意\n" + g.watch.map(x => "• " + x).join("\n"));
  if (g.timeline) parts.push("🗓 " + g.timeline);
  return parts.filter(Boolean).join("\n\n");
}
function caption(p){
  const tickerTag = p.ticker ? "#" + String(p.ticker).toUpperCase().replace(/[^A-Z0-9_]/g, "") : "";
  const tags = [tickerTag, "#12Invest"].filter(Boolean).join(" ");
  const link = `👉 阅读全文：${url(p.id)}`;
  let text = p.telegram ? String(p.telegram) : summary(p);
  const room = 1000 - [...link].length - [...tags].length - 4;
  if ([...text].length > room){ // drop whole lines from the end rather than cutting mid-sentence
    const lines = text.split("\n");
    while (lines.length > 1 && [...lines.join("\n")].length > room - 1) lines.pop();
    text = lines.join("\n").trimEnd() + "\n…";
  }
  return `${esc(text)}\n\n${link}\n\n${esc(tags)}`;
}
async function live(u){ // wait until GitHub Pages serves the new page (up to ~8 min)
  for (let i = 0; i < 48; i++){ try { const r = await fetch(u, { method: "HEAD" }); if (r.ok) return true; } catch {} await sleep(10000); }
  return false;
}
for (const p of todo){
  if (!(await live(url(p.id)))) { console.log(`Telegram: ${p.id} not live yet; will retry next run.`); continue; }
  const photo = ["og", "img"].map(d => path.join(ROOT, d === "og" ? `og/${p.id}.jpg` : String(p.cover || ""))).find(f => f && fs.existsSync(f) && fs.statSync(f).isFile());
  const fd = new FormData();
  fd.append("chat_id", CHAT); fd.append("caption", caption(p)); fd.append("parse_mode", "HTML");
  let method = "sendMessage";
  if (photo) { method = "sendPhoto"; fd.append("photo", new Blob([fs.readFileSync(photo)]), path.basename(photo)); }
  else { fd.delete("caption"); fd.append("text", caption(p)); }
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: "POST", body: fd });
  const j = await r.json();
  if (!j.ok) { console.error(`Telegram: failed for ${p.id}: ${j.description}`); process.exitCode = 1; continue; }
  state.posted.push(p.id);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 1) + "\n");
  console.log(`Telegram: posted ${p.id}`);
  await sleep(3000);
}
