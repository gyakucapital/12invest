// Posts newly published articles AND each new daily news / weekly wrap edition to the 12Invest Telegram channel.
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
const IPOS = fs.existsSync(path.join(ROOT, "data/ipos.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "data/ipos.json"), "utf8")).ipos : [];
state.news = state.news || [];
const newsFile = path.join(ROOT, "data/news.json");
const days = fs.existsSync(newsFile) ? (JSON.parse(fs.readFileSync(newsFile, "utf8")).days || []) : [];
const todo = posts.filter(p => p.id && !state.posted.includes(p.id) && !p.noTelegram)
  .sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)));
// only editions from the last 2 days, so an old edition is never blasted late
const recent = new Date(Date.now() + 8 * 3600e3 - 2 * 864e5).toISOString().slice(0, 10);
const newsTodo = days.filter(d => d.date && d.date >= recent && !state.news.includes(newsKey(d))).sort((a, b) => a.date.localeCompare(b.date));
function newsKey(d){ return (d.kind === "weekly" ? "weekly-" : "") + d.date; }
// Polls: one engagement poll after each article / news edition (keys kept in state.polls)
state.polls = state.polls || [];
const todayMY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const pollKey = (kind, id) => `${kind}:${id}`;
// articles published in the last 36 hours that have been (or are about to be) posted but have no poll yet
const fresh = p => Date.parse(p.publishedAt || 0) > Date.now() - 36 * 3600e3; // published within the last 36 hours
const postPollTodo = () => posts.filter(p => p.id && state.posted.includes(p.id) && !p.noTelegram && p.poll !== false && fresh(p) && !state.polls.includes(pollKey("post", p.id)));
// daily edition: only on its own day (a "today" poll is stale tomorrow); weekly: within a day of publishing
const newsPollOk = d => d.kind === "weekly" ? d.date >= new Date(Date.now() + 8 * 3600e3 - 864e5).toISOString().slice(0, 10) : d.date === todayMY;
const newsPollTodo = () => days.filter(d => d.date && state.news.includes(newsKey(d)) && newsPollOk(d) && d.poll !== false && !state.polls.includes(pollKey(d.kind === "weekly" ? "weekly" : "news", d.date)));
if (!todo.length && !newsTodo.length && !postPollTodo().length && !newsPollTodo().length) { console.log("Telegram: nothing new."); process.exit(0); }

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
  const ipo = (IPOS || []).find(i => i.ticker === p.ticker);
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const md = d => `${+d.slice(5, 7)}月${+d.slice(8, 10)}日`;
  const isIpo = p.ticker && (ipo || /IPO/i.test(String(p.category || "") + (p.tags || []).join(" ")));
  // referral link only while applications are open (or not yet open); closed IPOs just state the outcome
  const closed = ipo && ((ipo.close && today > ipo.close) || (ipo.listing && today >= ipo.listing));
  const prompt = !ipo || !ipo.close ? `📢 立即申购 ${p.ticker} IPO` : `📢 立即申购 ${ipo.name} IPO（${md(ipo.close)}下午5点截止）`;
  const ref = closed ? `\n📌 IPO 完毕 · ${ipo.listing ? `${md(ipo.listing)}挂牌` : "挂牌日待公布"}` : CFG.moomooReferral && isIpo ? `\n${prompt}：${CFG.moomooReferral}` : "";
  const link = `👉 阅读全文：${url(p.id)}${ref}`;
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
function newsCaption(d){
  const weekly = d.kind === "weekly", md = `${+d.date.slice(5, 7)}月${+d.date.slice(8, 10)}日`;
  const m = d.market || {};
  const head = `<b>${weekly ? "📅 12Invest 每周回顾" : "📰 每日马股速报"}｜${md}</b>\n${esc(d.title)}`;
  const mk = m.close ? `\n\n📈 ${esc(m.index || "FBM KLCI")}${m.date && m.date !== d.date ? `（${+m.date.slice(5, 7)}月${+m.date.slice(8, 10)}日收市）` : ""} ${esc(m.close)} ${esc(m.change || "")}` : "";
  const link = `\n\n👉 完整${weekly ? "回顾" : "速报"}：${CFG.origin + CFG.base}${weekly ? "weekly" : "news"}/${d.date}/`;
  const ref = CFG.moomooReferral && (d.items || []).some(it => it.tag === "IPO") ? `\n📢 申购马股新股：${CFG.moomooReferral}` : "";
  const tags = `\n\n${weekly ? "#每周回顾" : "#每日马股速报"} #12Invest`;
  const lines = (d.items || []).map(it => `• 【${esc(it.tag || "焦点")}】${esc(it.title)}`);
  const fixed = [...(head + mk + link + ref + tags).replace(/<[^>]+>/g, "")].length + 4;
  while (lines.length && fixed + [...lines.join("\n")].length > 1000) lines.pop();
  return `${head}${mk}\n\n${lines.join("\n")}${link}${ref}${tags}`;
}
// Poll wording. A post (or news edition) can set its own: "poll": {"question": "...", "options": ["...", "..."]}, or "poll": false to skip.
function postPoll(p){
  if (p.poll && p.poll.question) return p.poll;
  const ipo = (IPOS || []).find(i => i.ticker === p.ticker);
  const name = (ipo && ipo.name) || p.ticker || String(p.title).replace(/^【.*?】\s*/, "").slice(0, 30);
  const isIpo = ipo || /IPO/i.test(String(p.category || "") + (p.tags || []).join(" "));
  if (isIpo && !(ipo && ipo.listing && todayMY >= ipo.listing)){
    const closed = ipo && ipo.close && todayMY > ipo.close;
    if (!closed) return { question: `📊 投票：你会申购 ${name} 吗？`, options: ["会，已申购或准备申购 ✅", "观望，上市后再看 👀", "不会，这只没兴趣 🙅"] };
    return { question: `📊 投票：你觉得 ${name} 上市首日会？`, options: ["上涨 📈", "持平 ➖", "下跌 📉"] };
  }
  return { question: `📊 投票：看完这篇，你对 ${name} 的看法是？`, options: ["看好 📈", "中立 ➖", "不看好 📉"] };
}
function newsPoll(d){
  if (d.poll && d.poll.question) return d.poll;
  return d.kind === "weekly"
    ? { question: "📊 投票：下周马股（FBM KLCI）你怎么看？", options: ["上涨 📈", "横摆 ➖", "下跌 📉"] }
    : { question: "📊 投票：今天马股（FBM KLCI）你怎么看？", options: ["上涨 📈", "横摆 ➖", "下跌 📉"] };
}
async function sendPoll(q, key){
  // channel polls are always anonymous; Telegram limits: question ≤300 chars, 2–10 options of ≤100 chars
  const body = { chat_id: CHAT, question: [...String(q.question)].slice(0, 300).join(""), is_anonymous: true,
    options: q.options.slice(0, 10).map(o => ({ text: [...String(o)].slice(0, 100).join("") })) };
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPoll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) { console.error(`Telegram: poll failed for ${key}: ${j.description}`); process.exitCode = 1; return; }
  state.polls.push(key);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 1) + "\n");
  console.log(`Telegram: poll sent for ${key}`);
  await sleep(2000);
}
async function send(photo, text){
  const fd = new FormData();
  fd.append("chat_id", CHAT); fd.append("parse_mode", "HTML");
  let method = "sendMessage";
  if (photo) { method = "sendPhoto"; fd.append("caption", text); fd.append("photo", new Blob([fs.readFileSync(photo)]), path.basename(photo)); }
  else fd.append("text", text);
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: "POST", body: fd });
  return r.json();
}
for (const d of newsTodo){
  const u = `${CFG.origin + CFG.base}${d.kind === "weekly" ? "weekly" : "news"}/${d.date}/`;
  if (!(await live(u))) { console.log(`Telegram: news ${d.date} not live yet; will retry next run.`); continue; }
  const og = path.join(ROOT, "og", `${d.kind === "weekly" ? "weekly" : "news"}-${d.date}.jpg`);
  const j = await send(fs.existsSync(og) ? og : null, newsCaption(d));
  if (!j.ok) { console.error(`Telegram: failed for news ${d.date}: ${j.description}`); process.exitCode = 1; continue; }
  state.news.push(newsKey(d));
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 1) + "\n");
  console.log(`Telegram: posted news ${newsKey(d)}`);
  await sleep(3000);
  if (newsPollOk(d) && d.poll !== false) await sendPoll(newsPoll(d), pollKey(d.kind === "weekly" ? "weekly" : "news", d.date));
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
  if (p.poll !== false && fresh(p)) await sendPoll(postPoll(p), pollKey("post", p.id));
}
// catch-up: polls for items posted earlier that have no poll yet (e.g. a failed poll, or posted before polls existed)
for (const d of newsPollTodo()) await sendPoll(newsPoll(d), pollKey(d.kind === "weekly" ? "weekly" : "news", d.date));
for (const p of postPollTodo()) await sendPoll(postPoll(p), pollKey("post", p.id));
