# 12Invest

Static site for 12Invest articles, served by GitHub Pages: https://gyakucapital.github.io/12invest/

## How it is built
- `posts.json` – all articles (title, key facts, body, at-a-glance data, IPO dates).
- `tools/legal.mjs` – Privacy Notice (PDPA), Disclaimer, Terms of Use in English and Bahasa Malaysia.
- `tools/site.config.json` – site address, contact email, optional GoatCounter code.
- `node tools/og.mjs` – makes the 1200×630 share images in `og/` (needs Playwright).
- Telegram: when a new post appears in `posts.json`, the GitHub Action posts its share image with the post's `telegram` caption (or headline + summary), the article URL and `#TICKER #12Invest`.
- `node tools/build.mjs` – writes every page: `index.html`, `p/<id>/`, `ipo/`, legal pages, `404.html`, `sitemap.xml`, `robots.txt`, `feed.xml`.

Publish a new article: add it to `posts.json` (with an `ipo` block for IPOs), add images to `img/`, run `node tools/og.mjs && node tools/build.mjs`, commit and push.

Moving to a custom domain: set `origin` to `https://12invest.com.my` and `base` to `/` in `tools/site.config.json`, rebuild, and add a `CNAME` file.

## Security
- Strict Content-Security-Policy on every page: scripts and styles only from this site, no inline code, no third-party requests.
- Self-hosted font (Silkscreen, SIL OFL – see `fonts/OFL-Silkscreen.txt`).
- No cookies, no trackers, no forms. Share buttons are plain links.
