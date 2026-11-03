/* 12Invest — small progressive enhancements. Every page works without this file. */
(() => {
  "use strict";
  const root = document.documentElement;
  const BASE = root.dataset.base || "/";

  /* old single-page links (#p-xxx, #privacy) → the new page URLs */
  const h = location.hash.slice(1);
  if (location.pathname === BASE || location.pathname === BASE + "index.html") {
    if (/^p-[a-z0-9-]+$/.test(h)) { location.replace(BASE + "p/" + h.slice(2) + "/"); return; }
    if (/^(privacy|disclaimer|terms)$/.test(h)) { location.replace(BASE + h + "/"); return; }
  }

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const ready = fn => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();

  ready(() => {
    /* IPO status and dates, refreshed against today's Malaysia date (pages are built ahead of time) */
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const status = d => {
      if (d.listing && today >= d.listing) return ["listed", "已上市"];
      if (d.close && today > d.close) return ["closed", "已截止 · 待挂牌"];
      if (d.open && today >= d.open) return ["open", today === d.close ? "今天截止" : "招股中"];
      return ["upcoming", "即将招股"];
    };
    $$("[data-ipo]").forEach(el => { const [s, t] = status(el.dataset); el.dataset.s = s; el.textContent = t; });
    $$("[data-d]").forEach(el => {
      el.classList.toggle("past", el.dataset.d < today);
      el.classList.toggle("today", el.dataset.d === today);
    });
    $$(".tape [data-d]").forEach(el => { el.hidden = el.dataset.d < today; });
    $$("[data-limit]").forEach(list => {
      let shown = 0; const n = +list.dataset.limit;
      $$("[data-d]", list).forEach(li => { const on = li.dataset.d >= today && shown < n; if (on) shown++; li.hidden = !on; });
      const box = list.closest("[data-upcoming]"); if (box) box.hidden = shown === 0;
    });

    /* home: category chips + search over the article cards */
    const filters = $("#filters");
    if (filters) {
      filters.hidden = false;
      let cat = "全部", q = "";
      const cards = $$(".glance"), count = $("#count"), none = $("#nores");
      const apply = () => {
        let n = 0;
        cards.forEach(c => { const ok = (cat === "全部" || c.dataset.cat === cat) && (!q || c.dataset.text.includes(q)); c.hidden = !ok; if (ok) n++; });
        count.textContent = n; none.hidden = n > 0;
      };
      $$("[data-cat]", filters).forEach(b => b.addEventListener("click", () => {
        cat = b.dataset.cat; $$("[data-cat]", filters).forEach(x => x.setAttribute("aria-pressed", String(x === b))); apply();
      }));
      $("#q").addEventListener("input", e => { q = e.target.value.trim().toLowerCase(); apply(); });
    }

    /* copy link / copy full text */
    const toastEl = $("#toast");
    const toast = m => { if (!toastEl) return; toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { toastEl.hidden = true; }, 2200); };
    const copy = async (text, ok, fallback) => {
      try { await navigator.clipboard.writeText(text); toast(ok); }
      catch { if (fallback) { fallback.hidden = false; fallback.focus(); fallback.select(); } toast("请长按或按 Ctrl+C 复制"); }
    };
    $$("[data-copy-link]").forEach(b => b.addEventListener("click", () => copy(b.dataset.copyLink, "已复制链接")));
    const full = $("#copysrc");
    $$("[data-copy-full]").forEach(b => b.addEventListener("click", () => copy(full.value, "已复制全文", full)));

    /* cookie-free page count (only when enabled in site config; no cookies, no personal data) */
    const gc = root.dataset.gc;
    if (gc && navigator.doNotTrack !== "1" && !navigator.webdriver && !/bot|crawl|spider|preview/i.test(navigator.userAgent)) {
      const u = new URL(gc + "/count");
      u.searchParams.set("p", location.pathname);
      u.searchParams.set("t", document.title);
      if (document.referrer && !document.referrer.startsWith(location.origin)) u.searchParams.set("r", document.referrer);
      u.searchParams.set("s", [screen.width, screen.height, devicePixelRatio || 1].join(","));
      u.searchParams.set("rnd", Math.random().toString(36).slice(2));
      new Image().src = u.href;
    }
  });
})();
