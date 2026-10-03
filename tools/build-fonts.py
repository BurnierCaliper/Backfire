#!/usr/bin/env python3
"""重新生成 fonts/：从 Google Fonts 下载游戏用的四款字体。
中文字体（指芒星、站酷庆科黄油体）只收游戏源码里出现过的汉字，分几批下载，体积小很多。
加了新的中文文本后跑一次：python3 tools/build-fonts.py
（需要能访问 fonts.googleapis.com；证书走系统或 SSL_CERT_FILE）"""
import glob, os, re, ssl, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "fonts")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
CTX = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE") or None)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, context=CTX, timeout=60).read()


def ranges(cps):
    cps = sorted(set(cps))
    out, i = [], 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
            j += 1
        out.append(f"U+{cps[i]:04X}" if i == j else f"U+{cps[i]:04X}-{cps[j]:04X}")
        i = j + 1
    return ", ".join(out)


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(os.path.join(OUT, "*.woff2")):
        os.remove(f)
    chars = set()
    for f in glob.glob(os.path.join(ROOT, "*.js")) + [os.path.join(ROOT, "game.html")]:
        s = open(f, encoding="utf-8").read()
        chars |= {c for c in s if "　" <= c <= "鿿" or "＀" <= c <= "￯"}
    chars = "".join(sorted(chars))
    ascii_ = "".join(chr(c) for c in range(0x20, 0x7F))
    css = []
    for fam, slug in [("Black Ops One", "blackopsone"), ("Permanent Marker", "permanentmarker")]:
        c = get("https://fonts.googleapis.com/css2?family=" + urllib.parse.quote_plus(fam) + "&display=swap").decode()
        for name, body in re.findall(r"/\* (\S+) \*/\s*@font-face \{(.*?)\}", c, re.S):
            if name != "latin":
                continue
            url = re.search(r"url\((.*?)\)", body).group(1)
            rng = re.search(r"unicode-range: (.*?);", body).group(1)
            fn = f"{slug}-latin.woff2"
            open(os.path.join(OUT, fn), "wb").write(get(url))
            css.append(f"@font-face {{ font-family: '{fam}'; font-style: normal; font-weight: 400; font-display: swap; src: url({fn}) format('woff2'); unicode-range: {rng}; }}")
    for fam, slug in [("Zhi Mang Xing", "zhimangxing"), ("ZCOOL QingKe HuangYou", "zcoolqingke")]:
        batches = [chars[i:i + 260] for i in range(0, len(chars), 260)]
        batches[0] = ascii_ + batches[0]
        for bi, b in enumerate(batches):
            c = get("https://fonts.googleapis.com/css2?family=" + urllib.parse.quote_plus(fam) + "&display=swap&text=" + urllib.parse.quote(b)).decode()
            url = re.search(r"url\((.*?)\)", c).group(1)
            fn = f"{slug}-{bi}.woff2"
            open(os.path.join(OUT, fn), "wb").write(get(url))
            css.append(f"@font-face {{ font-family: '{fam}'; font-style: normal; font-weight: 400; font-display: swap; src: url({fn}) format('woff2'); unicode-range: {ranges(ord(x) for x in b)}; }}")
    head = ("/* Antlerscale: Backfire · 打包进游戏的字体（离线可用）\n"
            " * Black Ops One、指芒星 Zhi Mang Xing、站酷庆科黄油体 ZCOOL QingKe HuangYou：SIL Open Font License 1.1\n"
            " * Permanent Marker：Apache License 2.0\n"
            " * 中文字体只收了游戏文本里用到的字（tools/build-fonts.py 重新生成）；缺的字浏览器会自动用系统字体补上。 */\n")
    open(os.path.join(OUT, "fonts.css"), "w").write(head + "\n".join(css) + "\n")
    print(f"{len(chars)} 个汉字，{len(css)} 个字体文件")


if __name__ == "__main__":
    main()
