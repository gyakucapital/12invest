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

const stateFile = path.join(ROOT, "data/telegram.json");
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : { posted: [] };
const { posts } = JSON.parse(fs.readFileSync(path.join(ROOT, "posts.json"), "utf8"));
const todo = posts.filter(p => p.id && !state.posted.includes(p.id) && !p.noTelegram)
  .sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)));
if (!todo.length) { console.log("Telegram: nothing new."); process.exit(0); }

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = id => CFG.origin + CFG.base + `p/${id}/`;

// Telegram photo captions are limited to 1024 characters (after entity parsing)
function caption(p){
  const g = p.glance || {};
  const stats = (g.stats || []).slice(0, 4).map(s => `${s.k}：${s.v}`).join("｜");
  const tags = (p.tags || []).slice(0, 6).map(t => "#" + String(t).replace(/\s+/g, "")).join(" ");
  const head = `<b>${esc(p.title)}</b>`;
  const tail = [stats && esc(stats), g.timeline && "🗓 " + esc(g.timeline), `👉 阅读全文：${url(p.id)}`, tags && esc(tags)].filter(Boolean).join("\n\n");
  let body = esc(p.excerpt || "");
  const plainLen = s => s.replace(/<[^>]+>/g, "").replace(/&lt;|&gt;|&amp;/g, "x").length;
  while (plainLen(`${head}\n\n${body}\n\n${tail}`) > 1000 && body.length > 20) body = body.slice(0, -10).replace(/[^\s，。]*$/, "") + "…";
  return `${head}\n\n${body}\n\n${tail}`;
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
