/* Antlerscale: Backfire · 把新画面的场景打成一个普通脚本：npm run build:hd2d
 *
 * hd2d/hd2d-scene.js 是 ES 模块（import three.js、hd2d-world.js……），浏览器不让直接双击打开的页面（file://）加载 ES 模块。
 * 这里用 esbuild 把它和用到的 three.js（vendor/three/）打成 hd2d/hd2d-scene.bundle.js：一个普通脚本，加载后在 window 上挂
 * HD2DSceneBundle.createHd2dScene。game.html 开新画面时由 hd2d/hd2d-field.js 用 <script> 加载它（http:// 和 file:// 都一样）。
 * 包的第一行记着用到的源文件和指纹（tools/hd2d-fingerprint.js）：改了场景、three.js 却没重新打包，tests/hd2d-bundle.test.js 会失败。
 * 原型页（prototypes/hd2d/index.html）照旧直接用 ES 模块，不用这个包。
 * 要先装 esbuild（package.json 的 devDependencies：npm install）；跑测试不需要它。 */
"use strict";
const path = require("path"), fs = require("fs");
const { fingerprint, stampLine } = require("./hd2d-fingerprint.js");

/* 配置：入口、输出、挂到 window 上的名字、three.js 在哪 */
const BUILD = {
  entry: "hd2d/hd2d-scene.js",
  out: "hd2d/hd2d-scene.bundle.js",
  globalName: "HD2DSceneBundle",
  three: "vendor/three/three.module.min.js",
  addons: "vendor/three/addons/",
  target: "es2020"
};

const ROOT = path.resolve(__dirname, "..");
let esbuild;
try { esbuild = require("esbuild"); } catch (e) {
  console.error("没装 esbuild：先在仓库目录运行 npm install（package.json 的 devDependencies 里有固定版本）");
  process.exit(1);
}

/** three.js 的两种写法（"three"、"three/addons/…"）都指到 vendor/three/，和原型页的 importmap 一样 */
const threeVendor = {
  name: "three-vendor",
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: path.join(ROOT, BUILD.three) }));
    b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: path.join(ROOT, BUILD.addons, a.path.slice("three/addons/".length)) }));
  }
};

(async () => {
  const r = await esbuild.build({
    entryPoints: [path.join(ROOT, BUILD.entry)], bundle: true, format: "iife", globalName: BUILD.globalName,
    minify: true, target: BUILD.target, legalComments: "eof", metafile: true, write: false, plugins: [threeVendor], absWorkingDir: ROOT
  });
  const inputs = Object.keys(r.metafile.inputs).map(f => path.relative(ROOT, path.resolve(ROOT, f)).split(path.sep).join("/"));
  const code = r.outputFiles[0].text;
  fs.writeFileSync(path.join(ROOT, BUILD.out), stampLine(inputs, fingerprint(ROOT, inputs)) + "\n" + code);
  console.log(`${BUILD.out}：${inputs.length} 个源文件，${Math.round(code.length / 1024)} KB`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
