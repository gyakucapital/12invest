# 12Invest

马股新股与上市公司解读 — the 12Invest website.

- `index.html` — the site (static, no build step)
- `posts.json` — all articles; new articles are added here
- `img/` — article images

## Security

- Strict Content Security Policy: the page only loads its own files; the inline script and stylesheet are pinned by SHA-256 hash, so injected code won't run. (Update the hashes whenever `index.html`'s `<script>` or `<style>` changes.)
- No third-party requests: fonts are self-hosted (`fonts/`, Silkscreen under the SIL Open Font License), no analytics, no trackers, no cookies.
- Referrer policy `strict-origin-when-cross-origin`; HTTPS enforced by GitHub Pages.
- All article text is HTML-escaped before display; images load only from `img/`.
