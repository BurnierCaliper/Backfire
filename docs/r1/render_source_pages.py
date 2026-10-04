"""Render only pages needed to verify the supplied errata PDFs."""
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "r1" / "source-extracts" / "page-images"
OUT.mkdir(parents=True, exist_ok=True)
POPPLER = os.environ.get("PDFTOPPM") or shutil.which("pdftoppm")
if not POPPLER:
    bundled = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe"
    if not bundled.is_file():
        raise RuntimeError("Install Poppler, put pdftoppm on PATH, or set PDFTOPPM to its executable path")
    POPPLER = str(bundled)
for name, prefix, pages in [
    ("回火_主持人手册_经验勘误.pdf", "gm", [12, 13, 16]),
    ("回火_玩家手册_经验勘误.pdf", "player", [17, 25, 27, 36, 37]),
]:
    for page in pages:
        subprocess.run([str(POPPLER), "-f", str(page), "-l", str(page), "-scale-to", "1700", "-png", "-singlefile",
                        str(ROOT / "docs" / name), str(OUT / f"{prefix}-{page}")], check=True)
        print(f"Rendered {prefix}-{page}")
