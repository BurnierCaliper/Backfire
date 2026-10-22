// 新画面接入（一）（#261）：HD-2D 战场接进单机的正式战斗画面（game.html），旧画面留开关。
// 一、原型（prototypes/hd2d/）的模块挪到仓库根目录的 hd2d/，原型页改成引用那里（不复制两份），照样能加载。
// 都是 Node 能跑的；画面（WebGL）截图、浏览器测试由仓库主人跑。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HD2D = path.join(ROOT, "hd2d");                          // HD-2D 战场的模块
const PROTO = path.join(ROOT, "prototypes", "hd2d");           // 原型页
/** 正式代码也要用的模块（issue 里列的那些 + 攻击演出的适配器 / 播放）；「演示出招」的房主那边（hd2d-host.js）是原型自己的 */
const MODS = ["hd2d-layout.js", "hd2d-camera.js", "hd2d-scene.js", "hd2d-world.js", "hd2d-backdrop.js", "hd2d-scene-art.js",
  "hd2d-scenes-mine.js", "hd2d-scenes-city.js", "hd2d-scenes-desert.js", "hd2d-weather.js", "hd2d-wfx.js", "hd2d-ui.js",
  "hd2d-fx.js", "hd2d-play.js", "hd2d.css"];

/* ---------- 一、模块挪到 hd2d/ ---------- */
test("模块挪到仓库根目录的 hd2d/：原型页引用那里、原型目录里不另存一份；页面引用的文件、importmap 的 three.js、模块之间 import 的都找得到；假网页照页面顺序加载不报错", () => {
  MODS.forEach(f => assert.ok(fs.existsSync(path.join(HD2D, f)), "hd2d/" + f + " 在"));
  MODS.forEach(f => assert.ok(!fs.existsSync(path.join(PROTO, f)), "原型目录里不再留一份 " + f));
  assert.ok(fs.existsSync(path.join(PROTO, "hd2d-host.js")), "「演示出招」的房主那边还是原型自己的");
  const html = fs.readFileSync(path.join(PROTO, "index.html"), "utf8");
  // 页面上的 <script src> / <link href>（不含网址）、页面主脚本的 import、importmap：按页面所在的目录都找得到
  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(r => !/^[a-z]+:/i.test(r));
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  const imports = [...mod.matchAll(/\bfrom\s+"(\.{1,2}\/[^"]+)"/g)].map(m => m[1]);
  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;
  refs.concat(imports, Object.values(map)).forEach(r => assert.ok(fs.existsSync(path.resolve(PROTO, r)), "原型页引用的 " + r + " 找不到"));
  assert.ok(Object.values(map).every(u => /^\.\.\/\.\.\/vendor\/three\//.test(u)), "three.js 照旧用 vendor/three/（importmap）");
  // 每个模块：要么原型页直接引用（../../hd2d/…），要么被 hd2d-scene.js 这些 ES 模块 import（./…，同一个目录里找得到）
  const esm = ["hd2d-scene.js", "hd2d-world.js", "hd2d-backdrop.js", "hd2d-weather.js"];
  const inner = new Set();
  esm.forEach(f => [...fs.readFileSync(path.join(HD2D, f), "utf8").matchAll(/\bfrom\s+"(\.\/[^"]+)"/g)].forEach(m => {
    assert.ok(fs.existsSync(path.join(HD2D, m[1])), f + " import 的 " + m[1] + " 找不到");
    inner.add(m[1].slice(2));
  }));
  const used = new Set(refs.concat(imports).filter(r => r.startsWith("../../hd2d/")).map(r => r.slice("../../hd2d/".length)));
  MODS.forEach(f => assert.ok(used.has(f) || inner.has(f), "原型页用到了 hd2d/" + f));
  // 假网页：照 index.html 的顺序跑普通脚本（src 按页面目录找；找不到的脚本也记成错误）
  const page = require("./hd2d-fake-page").load();
  assert.deepEqual(page.errors, [], "加载时报错");
  ["HD2DLayout", "HD2DSceneArt", "HD2DScenesMine", "HD2DScenesDesert", "HD2DUI", "HD2DCamera", "HD2DFx", "HD2DHost", "HD2DPlay", "HD2DWfx"].forEach(k => assert.ok(page.ctx[k], "页面里有 " + k));
});
