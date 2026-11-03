# Publishing on 12Invest without code

The site rebuilds itself on GitHub (Actions → "Build site") after every change to `posts.json`, `data/`, `img/`, `tools/` or `assets/`. It takes about 3 minutes, then GitHub Pages goes live about 1 minute later.

## Post a new article
1. Upload images: open the `img` folder on GitHub → **Add file → Upload files**. Use short lowercase names, e.g. `keb-cover.jpg`.
2. Open `posts.json` → pencil icon (Edit). Copy an existing post block and change:
   - `id`: publish date + ticker, e.g. `2026-11-10-keb` (this becomes the URL `/p/2026-11-10-keb/` and must never change after publishing)
   - `ticker`: Bursa stock short name, e.g. `KEB` (links the article to the IPO calendar and company page)
   - `title`, `category`, `excerpt`, `publishedAt` (e.g. `2026-11-10T09:00:00.000Z`), `cover` (`img/keb-cover.jpg`)
   - `keyFacts` (label/value pairs), `glance` (4 stats, 3 highlights, 3 watch points, one timeline line), `tags`
   - `body`: the article text. Blank line = new paragraph; `## ` = subheading; `![caption](img/file.jpg)` = image; `---` = divider; `**bold**`.
3. **Commit changes**. The share image, phone-sized images and all pages are generated automatically.

## Fix a typo
Edit the text in `posts.json` and commit. Do not change `id`.

## IPO calendar
Updated daily by a scheduled task (`data/ipos.json`). To correct a date by hand, edit that file and keep a source link in `sources`.

## Legal pages
Text lives in `tools/legal.mjs` (English and Bahasa Malaysia). Contact email and social links are in `tools/site.config.json`.
