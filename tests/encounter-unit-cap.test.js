// 随机遭遇上场单位数上限 ENCOUNTER_UNIT_CAP：五代币的成组杂兵（空投蜂群 / 下水道清扫机）不再超过 12 只
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const H = require("./headless");

const get = (c, expr) => vm.runInContext(expr, c);
const plain = x => JSON.parse(JSON.stringify(x));

/** 一场遭遇里敌人单位总数（成组的 count 累加；三区制拆开后每行 count 多为 1） */
function unitTotal(enemies) {
  return (enemies || []).reduce((n, e) => n + Math.max(1, Number(e.count) || 1), 0);
}
/** 未拆开的抽卡行花掉的代币（每行按 ENEMY_INFO.tokens，与 pickByTokens 一致） */
function rowTokens(c, enemies) {
  const info = get(c, "ENEMY_INFO");
  return (enemies || []).reduce((n, e) => n + (info[e.preset].tokens || 1), 0);
}

test("常量：ENCOUNTER_UNIT_CAP = 12，对齐 4 枚代币 × group:3", () => {
  const c = H.load();
  assert.equal(get(c, "ENCOUNTER_UNIT_CAP"), 12);
  assert.equal(get(c, "ENCOUNTER_TOKENS"), 4);
  assert.equal(get(c, "ENEMY_INFO").swarm.group, 3);
  assert.equal(get(c, "ENEMY_INFO").sewer_sweeper.group, 3);
});

test("旧行为（对照）：只抽清扫机 / 空投蜂群时，5 枚代币在没上限时会到 15 只；有上限后 ≤12 且尽量花完代币", () => {
  const c = H.load();
  // 只有成组杂兵：5 枚装不下，花 4 枚停在 12 只（没有别的兵可改抽）
  c.S.RNG.install("CAP-SWEEP-ONLY");
  const only = c.pickByTokens(["sewer_sweeper"], 5);
  assert.equal(unitTotal(only), 12, "只有清扫机时 5 枚也最多 12 只");
  assert.equal(only.length, 4, "停在 4 组（第 5 枚装不下）");
  // 下水道维护整池（清扫机 + 两个精英）：5 枚必须花完，且 ≤12
  c.S.RNG.install("CAP-SEWER-POOL");
  const sewerPool = ["sewer_sweeper", "sewer_keeper", "sewer_cleaner"];
  for (let i = 0; i < 200; i++) {
    const rows = c.pickByTokens(sewerPool, 5);
    const units = unitTotal(rows);
    const spent = rowTokens(c, rows);
    assert.ok(units <= 12, `下水道池 seed 步 ${i}: ${units} 只 ${JSON.stringify(rows)}`);
    assert.equal(spent, 5, `下水道池必须花完 5 枚：${JSON.stringify(rows)}`);
  }
  // 外城区安保池（含空投蜂群和单只杂兵 / 精英）：同上
  c.S.RNG.install("CAP-SWARM-POOL");
  const swarmPool = Object.keys(get(c, "ENEMY_INFO")).filter(k => {
    const info = get(c, "ENEMY_INFO")[k];
    return info.faction === "安保" && info.regions.includes("外城区") && !info.boss && !info.neutral;
  });
  assert.ok(swarmPool.includes("swarm"));
  for (let i = 0; i < 200; i++) {
    const rows = c.pickByTokens(swarmPool, 5);
    const units = unitTotal(rows);
    const spent = rowTokens(c, rows);
    assert.ok(units <= 12, `安保池 seed 步 ${i}: ${units} 只 ${JSON.stringify(rows)}`);
    assert.equal(spent, 5, `安保池必须花完 5 枚：${JSON.stringify(rows)}`);
  }
});

test("5 枚代币的下水道维护 / 外城区安保遭遇：多种子下场上单位 ≤12，代币花完（车占代币后敌人+车合计仍是 5）", () => {
  const c = H.load();
  const cap = get(c, "ENCOUNTER_UNIT_CAP");
  const N = 300;
  const vehicleTok = enc => (enc.vehicles || []).reduce((n, v) => n + (Number(v.tokens) || 0), 0);
  for (let i = 0; i < N; i++) {
    c.S.RNG.install("CAP-SEWER-ENC-" + i);
    const enc = c.rollEncounter({ region: "下水道", faction: "下水道维护", tokens: 5, mixed: false, zoneMode: 2 });
    assert.ok(unitTotal(enc.enemies) <= cap, `下水道维护 #${i}: ${unitTotal(enc.enemies)} ${JSON.stringify(enc.enemies)}`);
    assert.equal(rowTokens(c, enc.enemies) + vehicleTok(enc), 5, `下水道维护 #${i} 代币：${JSON.stringify(enc)}`);
  }
  for (let i = 0; i < N; i++) {
    c.S.RNG.install("CAP-SWARM-ENC-" + i);
    const enc = c.rollEncounter({ region: "外城区", faction: "安保", tokens: 5, mixed: false, zoneMode: 2 });
    assert.ok(unitTotal(enc.enemies) <= cap, `外城区安保 #${i}: ${unitTotal(enc.enemies)} ${JSON.stringify(enc.enemies)}`);
    // 镇压队混编可能带移动堡垒，车占 1 枚：敌人行代币 + 车代币 = 本场代币
    assert.equal(rowTokens(c, enc.enemies) + vehicleTok(enc), 5, `外城区安保 #${i} 代币：${JSON.stringify({ e: enc.enemies, v: enc.vehicles })}`);
  }
});

test("4 枚代币：只抽清扫机仍是 12 只；分布与上限不冲突（≤12，代币花完）", () => {
  const c = H.load();
  c.S.RNG.install("CAP-4-SWEEP");
  const only = c.pickByTokens(["sewer_sweeper"], 4);
  assert.deepEqual(plain(only.map(e => [e.preset, e.count])), [
    ["sewer_sweeper", 3], ["sewer_sweeper", 3], ["sewer_sweeper", 3], ["sewer_sweeper", 3]
  ]);
  assert.equal(unitTotal(only), 12);

  c.S.RNG.install("CAP-4-SEWER");
  for (let i = 0; i < 200; i++) {
    const enc = c.rollEncounter({ region: "下水道", faction: "下水道维护", tokens: 4, mixed: false, zoneMode: 2 });
    assert.ok(unitTotal(enc.enemies) <= 12);
    const spent = rowTokens(c, enc.enemies);
    assert.equal(spent, 4, JSON.stringify(enc.enemies));
  }
});

test("三方混战每一边 3 枚代币：单边最多 9 只（group:3），总场 ≤18；受 ENCOUNTER_UNIT_CAP 约束但 3 枚本来就装得下", () => {
  const c = H.load();
  // 每一边独立 pickByTokens(3)，上限 12 对 3 枚不成组上限（9）无约束
  c.S.RNG.install("CAP-3WAY");
  for (let i = 0; i < 100; i++) {
    const enc = c.rollEncounter({ region: "下水道", threeWay: true, zoneMode: 3 });
    assert.equal(enc.layout, "threeway");
    const byZone = { 1: 0, 3: 0 };
    enc.enemies.forEach(e => { byZone[e.zone] = (byZone[e.zone] || 0) + Math.max(1, Number(e.count) || 1); });
    assert.ok(byZone[1] <= 12 && byZone[3] <= 12, JSON.stringify(byZone));
    assert.ok(byZone[1] <= 9, "3 枚 × group:3 = 9：" + byZone[1]);
    assert.ok(byZone[3] <= 9, "3 枚 × group:3 = 9：" + byZone[3]);
    // 两边代币都花完（拆开后按组折回）
    const sideTokens = z => {
      const rows = enc.enemies.filter(e => e.zone === z);
      // 拆开的成组：每 group 只合计 tokens
      let t = 0;
      const bag = {};
      rows.forEach(e => { bag[e.preset] = (bag[e.preset] || 0) + 1; });
      Object.keys(bag).forEach(p => {
        const info = get(c, "ENEMY_INFO")[p];
        const g = Number(info.group) || 1;
        t += (bag[p] / g) * (info.tokens || 1);
      });
      return t;
    };
    assert.equal(Math.round(sideTokens(1)), 3, JSON.stringify(enc.enemies));
    assert.equal(Math.round(sideTokens(3)), 3, JSON.stringify(enc.enemies));
  }
});

test("README：代币制章节写了单位上限；规则改动记录置顶有本条", () => {
  const fs = require("fs");
  const path = require("path");
  const md = fs.readFileSync(path.join(H.ROOT, "README.md"), "utf8");
  const changelog = md.split("## 规则改动记录")[1] || "";
  const top = changelog.slice(0, 1200);
  assert.ok(/ENCOUNTER_UNIT_CAP|上场.*12|单位.*上限|12\s*只/.test(top), "规则改动记录置顶应写单位上限");
  const tokenSec = md.split("### 2. 随机遭遇（代币制）")[1]?.split("### 3.")[0] || "";
  assert.ok(/12|单位上限|ENCOUNTER_UNIT_CAP/.test(tokenSec), "代币制章节应提到单位上限");
});
