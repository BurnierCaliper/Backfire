// 区制棋盘：区像模块一样拼接（四区直排、2×2 方形、五区十字…）；普通两区 / 三区直排行为不变
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field(board, enemies, party) {
  const c = H.load();
  c.S.RNG.install("BOARD");
  c.BattleSim.setup({ party: party || ["kolt", "helu"], board, enemies: enemies || [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "BOARD" });
  return c;
}

test("普通两区 / 三区直排：距离和以前的算法完全一样", () => {
  const c = field(null);
  for (const zm of [2, 3]) {
    c.S.state.zoneMode = zm;
    for (let a = 1; a <= zm; a++) for (let b = 1; b <= zm; b++) {
      const old = zm === 2 ? (a === b ? 0 : 1) : Math.abs(a - b);
      assert.equal(c.zoneDist(a, b, zm), old, `${zm} 区 ${a}→${b}`);
    }
  }
  assert.equal(c.S.state.board, null);
  assert.equal(c.otherZone(1), 2);
  c.S.state.zoneMode = 3;
  assert.deepEqual([1, 2, 3].map(z => c.otherZone(z)), [2, 1, 2], "三区：1、3 → 2，2 → 1（和以前一样）");
});

test("2×2 方形：只有相连的区距离 1，对角距离 2；十字形中心到四臂 1、臂到臂 2", () => {
  const c = field("square4");
  assert.equal(c.S.state.zoneMode, 4);
  assert.deepEqual(plain(c.zoneNeighbors(1)), [2, 3]);
  assert.equal(c.zoneDist(1, 4), 2);
  assert.equal(c.zoneDist(2, 3), 2);
  assert.equal(c.zoneDist(1, 2), 1);
  assert.deepEqual(Object.keys(c.S.state.gaps).sort(), ["1-2", "1-3", "2-4", "3-4"]);
  c.applyBoard("cross5");
  assert.deepEqual(plain(c.zoneNeighbors(3)), [1, 2, 4, 5]);
  assert.equal(c.zoneDist(1, 5), 2);
  assert.equal(c.zoneDist(2, 4), 2);
});

test("移动只能走到相连的区；危墙挡住时能绕路就算走得到", () => {
  const c = field("square4");
  const k = c.findKit("kolt", c.S.state.units);
  c.startCombat();
  k.zone = 1;
  k.bonus = 1;
  c.doMove(k, 4);
  assert.equal(k.zone, 1, "1 → 4 是对角，不能一步走过去");
  c.doMove(k, 3);
  assert.equal(k.zone, 3);
  k.zone = 1;
  c.S.state.gaps["1-2"] = Object.assign(c.emptyGap(), { type: "wall", hp: 10, maxHp: 10 });
  k.bonus = 1;
  c.doMove(k, 2);
  assert.equal(k.zone, 1, "一步走 1 → 2 被墙挡住");
  assert.equal(c.zoneReachable(k, 2), null, "多步移动：1 → 3 → 4 → 2 绕得过去");
  assert.equal(c.zoneReachable(k, 4), null);
  assert.ok(c.lineBlocked(1, 2), "隔着墙打不到对面");
  assert.equal(c.lineBlocked(1, 4), false, "有一条一样短的路不隔墙");
  c.S.state.gaps["1-3"] = Object.assign(c.emptyGap(), { type: "wall", hp: 10, maxHp: 10 });
  assert.match(c.zoneReachable(k, 4) || "", /危墙/, "两条路都被墙堵住");
  assert.ok(c.lineBlocked(1, 4), "两条一样短的路都隔着墙");
});

test("沙暴：方形 / 十字按上下左右吹，上风半边顺风、下风半边逆风、中线无风", () => {
  const c = field("square4");
  assert.deepEqual([1, 2, 3, 4].map(z => c.sandWind(z, 4, "E")), [1, -1, 1, -1]);
  assert.deepEqual([1, 2, 3, 4].map(z => c.sandWind(z, 4, "S")), [1, 1, -1, -1]);
  c.applyBoard("cross5");
  assert.deepEqual([1, 2, 3, 4, 5].map(z => c.sandWind(z, 5, "E")), [0, 1, 0, -1, 0]);
  assert.equal(c.reverseSandDir("E"), "W");
  const d = c.rollSandDir(2);
  assert.equal(c.sandWind(2, 5, d), 1, "释放者那一区顺风");
  // 直排：和以前一样
  c.applyBoard(null); c.S.state.zoneMode = 3;
  assert.deepEqual([1, 2, 3].map(z => c.sandWind(z, 3, "12")), [1, 0, -1]);
});

test("击退：玩家技能相连的区不止一个时多一步「推到哪一区」，敌人推到离自己最远的区", () => {
  const c = field("square4", [{ id: "thug_knife", lv: 1, zone: 1 }], ["tou", "kolt"]);
  const t = c.findKit("tou", c.S.state.units);
  t.zone = 1;
  const steps = c.skillFlowSteps("mochi_roar", t, {});
  assert.equal(steps[0].key, "push");
  assert.deepEqual(plain(steps[0].zones), [2, 3]);
  assert.equal(c.otherZone(1, 1), 2, "攻击者同区：一样远取编号小的");
  assert.equal(c.otherZone(2, 3), 1, "离攻击者（3 区）最远的相邻区");
  const c2 = field(null);
  const t2 = c2.findKit("kolt", c2.S.state.units);
  assert.equal(c2.skillFlowSteps("mochi_roar", t2, {}).length, 0, "两区直排只有一个可去的区：不用选");
});

test("特殊棋盘上整场战斗能自动打完（AI 移动、技能射程、回合结算）", () => {
  for (const b of ["line4", "square4", "cross5"]) {
    const c = field(b, [{ id: "thug_knife", lv: 1, zone: 2 }, { id: "thug_hammer", lv: 1, zone: 4 }]);
    const r = c.BattleSim.run({ maxTurns: 15 });
    assert.ok(r.winner || r.rounds, b);
    assert.ok(c.S.state.units.every(u => u.zone >= 1 && u.zone <= c.S.state.zoneMode), `${b}：单位都在棋盘上`);
  }
});

test("布局的区编号要从 1 连续；换回 null 就是普通直排", () => {
  const c = field(null);
  assert.throws(() => c.applyBoard({ zones: [{ id: 1, x: 0, y: 0 }, { id: 3, x: 1, y: 0 }], links: [[1, 3]] }), /连续/);
  c.applyBoard("cross5");
  assert.equal(c.S.state.zoneMode, 5);
  assert.equal(c.placePartyOnBoard, c.placePartyOnBoard);
  c.applyBoard(null);
  assert.equal(c.S.state.board, null);
});
