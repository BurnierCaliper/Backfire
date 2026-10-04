"""Package the final R1 evidence without changing the original reports.

Run from any directory with Python 3. Input files stay in docs/r1/; the ZIP
contains relative names and SHA256SUMS.json so reviewers can check extraction.
"""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent
FILES = [
    "manifest.json",
    "matrix-formal.json", "matrix-formal.csv", "matrix-formal.battles.csv",
    "campaign-formal.json", "campaign-formal.csv", "campaign-formal.battles.csv",
    "boss-coverage-diagnostic.json", "boss-coverage-diagnostic.csv",
    "matrix-timeout-diagnostics.json", "campaign-timeout-diagnostics.json",
    "test-final.log", "test-tools-final.log", "economy-final.log",
    "ui-upgrade-final.log",
]


def main():
    for name in FILES:
        if not (ROOT / name).is_file():
            raise FileNotFoundError(ROOT / name)
    for suite in ("matrix", "campaign"):
        report = json.loads((ROOT / f"{suite}-formal.json").read_text(encoding="utf-8"))
        if report["status"] == "BLOCKED":
            raise ValueError(f"Cannot package a blocked report: {suite}")
    sums = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in FILES}
    target = ROOT / "evaluation-evidence.zip"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in FILES:
            archive.write(ROOT / name, name)
        archive.writestr("SHA256SUMS.json", json.dumps(sums, indent=2) + "\n")
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None:
            raise ValueError("ZIP CRC validation failed")
        for name, expected in sums.items():
            if hashlib.sha256(archive.read(name)).hexdigest() != expected:
                raise ValueError(f"ZIP round-trip SHA256 mismatch: {name}")
    receipt = {
        "file": target.name,
        "bytes": target.stat().st_size,
        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "verification": "ZIP CRC and every uncompressed file SHA256 verified",
        "contents": sums,
    }
    (ROOT / "evidence-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in receipt.items() if k != "contents"}, indent=2))


if __name__ == "__main__":
    main()
