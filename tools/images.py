"""Make phone-friendly WebP copies of article images (img/*.jpg|png -> img/*.webp, max 1400px wide).
The build uses the .webp automatically when it exists; the original stays as fallback.
Run from the repo root:  python3 tools/images.py   (needs Pillow)"""
import pathlib
from PIL import Image

MAX_W = 1400
for src in sorted(pathlib.Path("img").glob("*")):
    if src.suffix.lower() not in (".jpg", ".jpeg", ".png"):
        continue
    out = src.with_suffix(".webp")
    if out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
        continue
    im = Image.open(src)
    im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
    if im.width > MAX_W:
        im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
    # charts (png) keep sharp text with higher quality
    im.save(out, "WEBP", quality=90 if src.suffix.lower() == ".png" else 80, method=6)
    print(f"{src.name}: {src.stat().st_size//1024}KB -> {out.name}: {out.stat().st_size//1024}KB")
