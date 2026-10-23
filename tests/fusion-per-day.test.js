const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
test("每天发的融合体数量读 ROGUE_GROWTH.fusionPerDay", () => {
  const data = fs.readFileSync(__dirname + "/../rogue-data.js", "utf8");
  assert.match(data, /fusionPerDay:\s*1,/);
  const src = fs.readFileSync(__dirname + "/../rogue.js", "utf8");
  const fn = src.slice(src.indexOf("function grantDailyFusion"), src.indexOf("长线养成：每日挑战"));
  assert.match(fn, /fusionPerDay/);
  assert.doesNotMatch(fn, /bagAdd\(G\(\)\.fusionItem, today - last\)/);
});
