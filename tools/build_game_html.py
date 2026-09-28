# 同步 game.html 里隐藏的那份计算器界面（#calc-core）。
#
# app.js 会读写计算器的那些 DOM 元素，所以 game.html 里藏了一份 index.html 的界面。
# 改过 index.html 的结构之后，跑一次这个脚本，把 #calc-core 里的内容换成最新的。
#
#   python tools/build_game_html.py
#
# 只替换 #calc-core 这一块，game.html 里其他手写的部分（顶栏、各种面板、后台等）一律不动。

import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parent.parent
index_path = root / "index.html"
game_path = root / "game.html"

index = index_path.read_text(encoding="utf-8")
game = game_path.read_text(encoding="utf-8")

m = re.search(r"<body[^>]*>(.*)</body>", index, re.S)
if not m:
    sys.exit("index.html 里找不到 <body>。")
body = re.sub(r"<script[^>]*>.*?</script>", "", m.group(1), flags=re.S).strip()

start_m = re.search(r'<div id="calc-core"[^>]*>', game)
if not start_m:
    sys.exit('game.html 里找不到 <div id="calc-core">。')

# 从 #calc-core 开始数 div，找到与之配对的 </div>
i = start_m.end()
depth = 1
tag = re.compile(r"</?div\b", re.I)
while depth > 0:
    t = tag.search(game, i)
    if not t:
        sys.exit("#calc-core 没有正确闭合。")
    depth += -1 if t.group(0).lower().startswith("</") else 1
    i = t.end()
end = game.rindex("</div>", 0, i)

new_game = game[:start_m.end()] + "\n" + body + "\n" + game[end:]
game_path.write_text(new_game, encoding="utf-8")

scripts = re.findall(r'<script src="([^"]+)"></script>', index)
missing = [s for s in scripts if 'src="%s"' % s not in new_game]
print("#calc-core 已更新（%d 字符）。" % len(body))
if missing:
    print("注意：index.html 用到但 game.html 没加载的脚本 →", ", ".join(missing))
    print("请手动在 game.html 底部补上对应的 <script> 标签。")
else:
    print("脚本标签齐全：" + ", ".join(scripts))
