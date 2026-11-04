// Adds a space between Chinese characters and English letters / numbers, e.g.
//   "这家IPO公司11月25日上市，市值约RM5.28 billion" -> "这家 IPO 公司 11 月 25 日上市，市值约 RM5.28 billion"
// Full-width punctuation (，。：（）) is left alone, and **bold** markers are kept outside the space:
//   "约**RM5**亿" -> "约 **RM5** 亿". Safe to run more than once.
const CJK = "⺀-⻿⼀-⿟぀-ゟ゠-ヺー-ヿ㄀-ㄯ㈀-㋿㐀-䶿一-鿿豈-﫿";
const AFTER_CJK = new RegExp(`([${CJK}])((?:\\*\\*)?)([A-Za-z0-9$@#])`, "g");      // 中A -> 中 A
const BEFORE_CJK = new RegExp(`([A-Za-z0-9%$)\\]])((?:\\*\\*)?)([${CJK}])`, "g");  // A中 -> A 中
export function pangu(s){
  if (typeof s !== "string" || !s) return s;
  let out = s, prev;
  do { prev = out; out = out.replace(AFTER_CJK, "$1 $2$3").replace(BEFORE_CJK, "$1$2 $3"); } while (out !== prev);
  return out;
}
// Fields that hold paths, ids, dates, links or English-only text are never touched.
const SKIP = new Set(["id", "cover", "ogImage", "ticker", "publishedAt", "updatedAt", "oldIds", "url", "urls", "sources", "source_url",
  "date", "kind", "href", "link", "image", "img", "theme", "code", "en", "checked", "open", "close", "ballot", "pricing", "listing", "noTelegram"]);
export function spaceAll(v, key = ""){
  if (SKIP.has(key)) return v;
  if (typeof v === "string") return pangu(v);
  if (Array.isArray(v)) return v.map(x => spaceAll(x, key === "tags" ? "tags" : ""));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, spaceAll(x, k)]));
  return v;
}
