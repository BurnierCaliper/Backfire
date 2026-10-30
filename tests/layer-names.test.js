// 层名全项目只留一份（#510，主人 10/30 定）：正式名以 engine.js · LAYER 为准，界面上写层名的地方都读它，不另写。
// 扫描所有非测试的 .js / .html：
//   ① 除了 engine.js · LAYER，别处不许再写层名映射：{ flesh: "…" }、{ sand: "…" } 这种，[["armor", "装甲"]] 这种成对的也算
//     （值是一到四个汉字的名字才算；层的说明句子、颜色、数值不算）；
//   ② 不许出现旧名「砂甲」「护甲层」「灵体」「血肉」（注释里也不写，免得照着抄回去）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const LAYER = require("./layer-names");

const ROOT = path.resolve(__dirname, "..");
// 不扫的目录：测试、第三方库（vendor）、装出来的依赖和测试产物
const SKIP_DIRS = new Set([".git", "node_modules", "tests", "vendor", "dist", "playwright-report", "test-results", ".wrangler"]);
// 键和层 id 一样、但不是层名的写法：天气「沙暴」、路面「沙地」「松软沙地」、资源「盾」（online-ui.js · names）
const NOT_LAYER = { sand: ["沙暴", "沙地", "松软沙地"], shield: ["盾"] };
const OLD_NAMES = ["砂甲", "护甲层", "灵体", "血肉"];

const IDS = Object.keys(LAYER.table).join("|");   // flesh|armor|shield|sand|spirit
const NAME = "\\p{Script=Han}{1,4}";
const MAPS = [
  new RegExp(`\\b(${IDS})["']?\\s*:\\s*["'\`](${NAME})["'\`]`, "gu"),     // { flesh: "肉体" }
  new RegExp(`["'\`](${IDS})["'\`]\\s*,\\s*["'\`](${NAME})["'\`]`, "gu")  // [["armor", "装甲"]]
];

/** 仓库里要扫的 .js / .html（相对路径，/ 分隔） */
function scanned(dir = ROOT, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) scanned(full, out); }
    else if (/\.(js|html)$/.test(e.name)) out.push(path.relative(ROOT, full).split(path.sep).join("/"));
  }
  return out;
}
const FILES = scanned();   // High Flux（counter-cards*.js、casino*.js）在 #509 改好以后也一起查
/** 要查的源码：engine.js 去掉 LAYER 那一份（正式名就写在那里） */
const source = f => {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  return f === "engine.js" ? src.replace(LAYER.script, "") : src;
};
const lineOf = (src, i) => src.slice(0, i).split("\n").length;

test("#510 扫描范围：根目录、hd2d、原型页的 .js / .html 都在里面，测试和第三方库不扫", () => {
  for (const f of ["engine.js", "online-ui.js", "online-gm-ui.js", "game.html", "hd2d/hd2d-ui.js", "prototypes/hd2d/index.html"]) assert.ok(FILES.includes(f), "没扫到 " + f);
  assert.ok(!FILES.some(f => f.startsWith("tests/") || f.startsWith("vendor/")), "测试、第三方库不扫");
  assert.ok(fs.readFileSync(path.join(ROOT, "engine.js"), "utf8").includes(LAYER.script), "engine.js 里正式的那一份");
});

test("#510 层名只有 engine.js · LAYER 一份：别处不另写 flesh: \"…\"、sand: \"…\"、[\"armor\", \"装甲\"] 这种层名映射", () => {
  const bad = [];
  for (const f of FILES) {
    const src = source(f);
    for (const re of MAPS) {
      for (const m of src.matchAll(re)) {
        if ((NOT_LAYER[m[1]] || []).includes(m[2])) continue;
        bad.push(`${f}:${lineOf(src, m.index)}  ${m[0]}`);
      }
    }
  }
  assert.deepEqual(bad, [], "这些地方另写了层名，改成读 engine.js · LAYER：\n" + bad.join("\n"));
});

test("#510 不再出现旧层名「砂甲」「护甲层」「灵体」「血肉」（正式名：" + Object.values(LAYER.table).join(" / ") + "）", () => {
  const bad = [];
  for (const f of FILES) {
    const src = source(f);
    for (const name of OLD_NAMES) {
      for (let i = src.indexOf(name); i >= 0; i = src.indexOf(name, i + name.length)) bad.push(`${f}:${lineOf(src, i)}  ${name}`);
    }
  }
  assert.deepEqual(bad, [], "这些地方还写着旧层名：\n" + bad.join("\n"));
});
