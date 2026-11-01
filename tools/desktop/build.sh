#!/usr/bin/env bash
# 打 Windows 桌面版（Electron）：只放玩家需要的文件（不带手册、设计文档、测试、转发服务）
# 用法：tools/desktop/build.sh [输出目录]   需要 node / npm（第一次会下载 Electron，约 100MB）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/dist}"
VER="$(node -p "require('$ROOT/tools/desktop/package.json').version")"
STAGE="$OUT/stage"
rm -rf "$STAGE" && mkdir -p "$STAGE/game/art"
cp "$ROOT/tools/desktop/main.js" "$ROOT/tools/desktop/preload.js" "$ROOT/tools/desktop/package.json" "$STAGE/"
cd "$ROOT"
# 游戏本体：根目录的页面、脚本、样式、字体，和地图图片
cp game.html index.html "$STAGE/game/"
for f in *.js *.css; do cp "$f" "$STAGE/game/"; done
cp -r fonts "$STAGE/game/"
cp art/world-map.webp "$STAGE/game/art/"
# 主菜单的看板娘（#552）：柏妮尔的立绘，网页用的那一张
mkdir -p "$STAGE/game/art/burnier"
cp art/burnier/burnier-stand-720.png "$STAGE/game/art/burnier/"
# 打包（用 @electron/packager，不需要 wine；图标暂用 Electron 默认）
cd "$OUT"
npx --yes @electron/packager@20.3.0 "$STAGE" Backfire --platform=win32 --arch=x64 --electron-version=42.11.12 --out "$OUT" --overwrite --asar --app-version="$VER" >/dev/null
DIR="$OUT/Backfire-win32-x64"
# 界面语言包只留中文和英文（其余几十种占 40MB+）
find "$DIR/locales" -name "*.pak" ! -name "zh-CN.pak" ! -name "zh-TW.pak" ! -name "en-US.pak" -delete
cat > "$DIR/使用说明.txt" <<TXT
Antlerscale: Backfire  v$VER

双击 Backfire.exe 开始游戏。
第一次打开 Windows 可能提示「Windows 已保护你的电脑」：点「更多信息」→「仍要运行」。
F11 全屏。存档在本机；游戏里「存成文件 / 从文件读入」可以备份和搬存档。
联机：进入联机后填主持人给的转发服务地址。
TXT
rm -f "$OUT/Backfire-win-x64-v$VER.zip"
(cd "$OUT" && zip -qr "Backfire-win-x64-v$VER.zip" "Backfire-win32-x64")
echo "$OUT/Backfire-win-x64-v$VER.zip"
