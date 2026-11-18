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
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ready = fn => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn();

  ready(() => {
    /* IPO status and dates, refreshed against today's Malaysia date (pages are built ahead of time) */
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const status = d => {
      if (d.listing && today >= d.listing) return ["listed", "已上市"];
      if (d.close && today > d.close) return ["closed", "已截止 · 待挂牌"];
      if (d.open && today >= d.open) return ["open", today === d.close ? "今天截止" : "招股中"];
      if (!d.open && d.close && today <= d.close) return ["open", today === d.close ? "今天截止" : "招股中"];
      if (!d.open && !d.close) return ["tba", "日期待公布"];
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

    /* reader feedback → private Google Form (no-cors: the response is opaque, so a sent request counts as received) */
    const rv = $("[data-review]");
    if (rv && window.fetch){
      const id = rv.dataset.review, key = "12i-rv:" + id, form = $(".rv-form", rv), done = $(".rv-done", rv), msg = $(".rv-msg", rv), said = $(".rv-said", rv);
      const words = ["", "没帮助", "一般", "还不错", "很有帮助", "非常有帮助"];
      let sent = false; try { sent = localStorage.getItem(key) === "1"; } catch {}
      rv.hidden = false;
      if (sent){ form.hidden = true; done.hidden = false; }
      $$("input[name=rating]", form).forEach(r => r.addEventListener("change", () => { said.textContent = r.value + "/5 · " + words[+r.value]; msg.textContent = ""; }));
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const r = $("input[name=rating]:checked", form), c = form.comment.value.trim();
        if (form.website.value) return;
        if (!r && !c){ msg.textContent = "请先点星星评分，或写下你的意见。"; return; }
        if (/https?:|www\./i.test(c)){ msg.textContent = "意见里请勿附上链接。"; return; }
        const btn = $("button[type=submit]", form); btn.disabled = true; msg.textContent = "";
        const body = new URLSearchParams();
        body.set(rv.dataset.fArticle, id);
        if (r) body.set(rv.dataset.fRating, r.value);
        if (c) body.set(rv.dataset.fComment, c.slice(0, 1000));
        try {
          await fetch(rv.dataset.action, { method: "POST", mode: "no-cors", body });
          try { localStorage.setItem(key, "1"); } catch {}
          form.hidden = true; done.hidden = false;
        } catch { msg.textContent = "提交失败，请检查网络后再试。"; btn.disabled = false; }
      });
    }

    /* IPO application calculator */
    const cd = $("#calc-data");
    if (cd){
      const box = $("#calc"), sel = $("#calc-ipo"), lots = $("#calc-lots"), D = JSON.parse(cd.textContent);
      if (D.ipos.length){
        box.hidden = false;
        sel.innerHTML = D.ipos.map((i, k) => `<option value="${k}">${i.n}（${i.max ? "最高 " : ""}RM${i.p.toFixed(i.p * 1000 % 10 ? 3 : 2)}）</option>`).join("");
        const md = d => d ? `${+d.slice(5, 7)}月${+d.slice(8, 10)}日 5pm` : "—";
        const calc = () => {
          const i = D.ipos[+sel.value], n = Math.max(1, Math.floor(+lots.value || 0));
          $("#calc-sh").textContent = (n * 100).toLocaleString("en") + " 股";
          $("#calc-amt").textContent = "RM" + (n * 100 * i.p).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          $("#calc-close").textContent = md(i.c);
        };
        sel.addEventListener("change", calc); lots.addEventListener("input", calc); calc();
      }
    }

    /* site search (search.json is built with the site) */
    const sq = $("#sq");
    if (sq){
      const out = $("#sres"); let rows = null;
      const run = async () => {
        const q = sq.value.trim().toLowerCase();
        history.replaceState(null, "", q ? "?q=" + encodeURIComponent(q) : location.pathname);
        if (!q){ out.innerHTML = ""; return; }
        if (!rows){ try { rows = await fetch(BASE + "search.json").then(r => r.json()); } catch { out.textContent = "搜索暂时无法使用。"; return; } }
        const terms = q.split(/\s+/);
        const hit = rows.filter(r => { const h = (r.t + " " + r.x + " " + r.s + " " + r.k).toLowerCase(); return terms.every(w => h.includes(w)); })
          .sort((a, b) => String(b.d).localeCompare(String(a.d))).slice(0, 60);
        out.innerHTML = hit.length ? `<p class="note">${hit.length} 个结果</p><ol class="slist2">${hit.map(r => `<li><a href="${r.u}"><span class="ntag">${esc(r.k)}</span><b>${esc(r.t)}</b><small>${esc(r.x.slice(0, 90))}${r.x.length > 90 ? "…" : ""}${r.d ? " · " + r.d : ""}</small></a></li>`).join("")}</ol>`
          : `<div class="empty px"><h3>没有找到「${esc(q)}」</h3>试试公司名、股票代号或主题，例如 IPO、数据中心。</div>`;
      };
      const init = new URLSearchParams(location.search).get("q"); if (init){ sq.value = init; run(); }
      let tm; sq.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(run, 150); });
      sq.form.addEventListener("submit", e => { e.preventDefault(); run(); });
    }
    const sall = $("#sall"), hq = $("#q");
    if (sall && hq) hq.addEventListener("input", () => { sall.href = BASE + "search/?q=" + encodeURIComponent(hq.value.trim()); });

    /* installable app + offline reading */
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register(BASE + "sw.js", { scope: BASE }).catch(() => {});

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
