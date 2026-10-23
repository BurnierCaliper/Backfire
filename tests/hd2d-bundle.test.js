"use strict";
// 新画面直接双击 game.html（file://）也能开：场景打成普通脚本 hd2d/hd2d-scene.bundle.js（tools/build-hd2d.js），
// hd2d/hd2d-field.js 用 <script> 加载它，不再 import ES 模块（浏览器不让 file:// 加载 ES 模块）。
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { execSync } = require("node:child_process");
const { fingerprint, readStamp } = require("../tools/hd2d-fingerprint.js");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const BUNDLE = "hd2d/hd2d-scene.bundle.js";

test("场景包是最新的：第一行记的源文件和指纹，按现在的源文件重算对得上（改了场景 / three.js 要 npm run build:hd2d）", () => {
  assert.ok(fs.existsSync(path.join(ROOT, BUNDLE)), "有 " + BUNDLE);
  const stamp = readStamp(read(BUNDLE));
  assert.ok(stamp && Array.isArray(stamp.inputs) && stamp.sha256, "包的第一行记着源文件和指纹");
  ["hd2d/hd2d-scene.js", "hd2d/hd2d-world.js", "hd2d/hd2d-backdrop.js", "hd2d/hd2d-weather.js", "vendor/three/three.module.min.js"]
    .forEach(f => assert.ok(stamp.inputs.includes(f), "打进去了 " + f));
  stamp.inputs.forEach(f => assert.ok(fs.existsSync(path.join(ROOT, f)), "源文件还在：" + f));
  assert.equal(fingerprint(ROOT, stamp.inputs), stamp.sha256, "源文件改过了，包没重新打：运行 npm run build:hd2d");
  // 是普通脚本：没有 import / export 语句，加载后挂出 HD2DSceneBundle
  const body = read(BUNDLE).split("\n").slice(1).join("\n");
  assert.ok(!/^\s*(import|export)\s/m.test(body), "不是 ES 模块");
  assert.match(body, /var HD2DSceneBundle\s*=/);
});

test("指纹：换行统一成 \\n 再算（Windows 签出也一样）；文件改一个字指纹就变", () => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "hd2d-fp-"));
  fs.writeFileSync(path.join(dir, "a.js"), "let a = 1;\nlet b = 2;\n");
  const one = fingerprint(dir, ["a.js"]);
  fs.writeFileSync(path.join(dir, "a.js"), "let a = 1;\r\nlet b = 2;\r\n");
  assert.equal(fingerprint(dir, ["a.js"]), one);
  fs.writeFileSync(path.join(dir, "a.js"), "let a = 1;\nlet b = 3;\n");
  assert.notEqual(fingerprint(dir, ["a.js"]), one);
});

test("hd2d-field.js 用普通脚本加载场景包，不再 import ES 模块；game.html 不再要 importmap；file:// 不再当成打不开", () => {
  const F = require("../hd2d/hd2d-field.js");
  assert.equal(F.FIELD.scene, "hd2d-scene.bundle.js");
  assert.equal(F.FIELD.sceneGlobal, "HD2DSceneBundle");
  assert.ok(!("file" in F.FIELD.text), "没有「要用本地服务打开」的提示了");
  const src = read("hd2d/hd2d-field.js");
  assert.ok(!/\bimport\s*\(/.test(src), "不再动态 import");
  assert.ok(!/isFile\(\)/.test(src), "file:// 不再特殊对待（滚轮照样能打开新画面）");
  const html = read("game.html");
  assert.ok(!/<script type="importmap">/.test(html), "game.html 不再要 importmap");
  assert.ok(!/<script[^>]*type="module"/.test(html), "也不加载 ES 模块");
  const title = /id="g-hd2d-toggle"[^>]*title="([^"]*)"/.exec(html)[1];
  assert.ok(!/本地服务|file:\/\//.test(title), "开关的说明不再叫人起本地服务");
  // 原型页照旧用 ES 模块（不碰）
  assert.match(read("prototypes/hd2d/index.html"), /<script type="importmap">/);
  // package.json：打包命令和固定版本的 esbuild（只打包时要，跑测试不要）
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["build:hd2d"], "node tools/build-hd2d.js");
  assert.match(pkg.devDependencies.esbuild, /^\d+\.\d+\.\d+$/, "esbuild 写死版本");
});

/* ---------- 浏览器：真的双击打开（file://）开新画面（没装 Playwright 时跳过） ---------- */
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
  return null;
}
let browser = null;
test.before(async () => {
  const pw = playwright(); if (!pw) return;
  try { browser = await pw.chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }); }
  catch (e) { if (process.env.REQUIRE_UI === "1") throw e; }
});
test.after(async () => { if (browser) await browser.close(); });

test("浏览器 · 用 file:// 打开 game.html：点开关就建好 3D 战场（画布、铭牌都在），没有报错；关掉回到旧画面", { timeout: 180000 }, async (t) => {
  if (!browser) { if (process.env.REQUIRE_UI === "1") throw new Error("UI 验收需要 Playwright"); t.skip("Playwright/browser unavailable"); return; }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  try {
    await require("./old-screen")(page);   // #316 起默认开：页面加载前先记着「关」，下面点开关打开
    await page.goto("file://" + path.join(ROOT, "game.html"));
    await page.waitForFunction(() => !!window.GAME && !!window.HD2DField);
    assert.equal(await page.evaluate(() => location.protocol), "file:");
    await page.evaluate(() => {
      Screens.show("battle");
      GAME.startCustomBattle("双击打开", () => { BattleSim.setup({ party: ["ruby", "yuito"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "FILE", region: "第一采矿场" }); return {}; });
    });
    await page.click("#g-hd2d-toggle");
    await page.waitForFunction(() => HD2DField.on() && !HD2DField.transition().busy && !!document.querySelector(".hd2d-field canvas"), null, { timeout: 120000 });
    assert.equal(await page.textContent("#g-hd2d-toggle"), await page.evaluate(() => HD2DField.FIELD.label.on));
    assert.ok(await page.evaluate(() => document.querySelectorAll(".hd2d-plate").length >= 3), "铭牌都在");
    assert.deepEqual(errors, []);
    // #339：单机开着新画面换成纸片画面，开关收进了「工具 ▾」下拉（旧顶栏原地变的）：先打开下拉再点
    await page.waitForFunction(() => document.body.classList.contains("g-paper") && !!document.querySelector('#g-paper [data-olp="tools"]'), null, { timeout: 30000 });
    await page.click('#g-paper [data-olp="tools"]');
    await page.waitForSelector("#g-app > .g-top.gp-open #g-hd2d-toggle", { state: "visible" });
    await page.click("#g-app > .g-top #g-hd2d-toggle");
    await page.waitForFunction(() => !HD2DField.on() && !HD2DField.transition().busy, null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => !!document.querySelector(".hd2d-field")), false, "关掉拆干净");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
