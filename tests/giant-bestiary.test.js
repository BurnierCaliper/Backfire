// #340 第 19 条：巨人招式图鉴文字按等级 d8（和实际 diceN: a.level 一致）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

test("巨人图鉴：近距砸击 / 远距能量写「等级 d8」，不再写「1d8」", () => {
  const c = H.load();
  const abs = c.S.BESTIARY_TEXT.giant.abilities;
  const near = abs.find(s => s.includes("近距砸击"));
  const far = abs.find(s => s.includes("远距能量"));
  assert.ok(near && near.includes("等级 d8"), "近距砸击应写等级 d8，实际：" + near);
  assert.ok(far && far.includes("等级 d8"), "远距能量应写等级 d8，实际：" + far);
  assert.ok(!near.includes("1d8"), "近距砸击不应再写 1d8");
  assert.ok(!far.includes("1d8"), "远距能量不应再写 1d8");
});
