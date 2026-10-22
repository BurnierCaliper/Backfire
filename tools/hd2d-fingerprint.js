/* Antlerscale: Backfire · 新画面场景包（hd2d/hd2d-scene.bundle.js）的源文件指纹
 *
 * 场景（hd2d/hd2d-scene.js 和它 import 的模块、vendor/three/）由 tools/build-hd2d.js 打成一个普通脚本，
 * 这样直接双击打开 game.html（file://）也能开新画面——浏览器不让 file:// 加载 ES 模块，普通脚本可以。
 * 打包时把「用到了哪些源文件、它们的指纹」写在包的第一行；测试（tests/hd2d-bundle.test.js）按同一个算法重算，
 * 改了源文件忘了重新打包就会失败。这里不依赖 esbuild，测试里也能用。
 *   fingerprint(root, inputs)  → sha256（inputs 是相对仓库根目录的路径；换行统一成 \n 再算，Windows 签出也一样）
 *   readStamp(bundleText)      → 包第一行记的 { inputs, sha256 }（没有 = null）
 *   stampLine(inputs, sha256)  → 写进包第一行的注释 */
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");

const STAMP = {
  head: "/* hd2d-scene.bundle.js · 由 tools/build-hd2d.js 生成（npm run build:hd2d），别手改。源文件指纹：",
  tail: " */"
};

function fingerprint(root, inputs) {
  const h = crypto.createHash("sha256");
  [...inputs].sort().forEach(f => {
    const text = fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
    h.update(f + "\0" + text + "\0");
  });
  return h.digest("hex");
}
function stampLine(inputs, sha256) { return STAMP.head + JSON.stringify({ inputs: [...inputs].sort(), sha256 }) + STAMP.tail; }
function readStamp(bundleText) {
  const line = String(bundleText).split("\n", 1)[0];
  if (!line.startsWith(STAMP.head) || !line.endsWith(STAMP.tail)) return null;
  try { return JSON.parse(line.slice(STAMP.head.length, line.length - STAMP.tail.length)); } catch (e) { return null; }
}

module.exports = { STAMP, fingerprint, stampLine, readStamp };
