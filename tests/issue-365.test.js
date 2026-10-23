// #365：活沙被杀死时也吸收场上活着的扬尘体
// （以前吸收列表 LIVESAND_FEED_KITS 只有四足 / 人形 / 大沙灵，扬尘体留在场上，活沙照样死掉）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function setup(enemies) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies, seed: "I365" });
  c.startCombat();
  const S = c.S.state;
  return { c, S, K: k => S.units.find(u => u.kit === k && !u.hidden && !u.dead) };
}
/** 活沙内层打空，再清场（被打死时走的就是 sweepDeadEnemies），返回清场的日志 */
function killLivesand(c, live) {
  live.layers.forEach(l => { l.current = 0; });
  return c.sweepDeadEnemies().join("\n");
}

test("活沙被杀死：吸收场上活着的扬尘体，护甲和沙尘的血量、atk 都给活沙，def +1，变成巨型活沙（以前不吸收，活沙直接死）", () => {
  const { c, K } = setup([{ id: "livesand", lv: 3, zone: 1 }, { id: "dustbody", lv: 3, zone: 2 }]);
  const live = K("livesand"), dust = K("dustbody");
  assert.equal(dust.flying, true, "扬尘体在飞");
  const atk0 = live.atk, def0 = live.defMax, gain = c.totalHp(dust);
  const notes = killLivesand(c, live);
  assert.equal(live.resources.giant, true, "变成巨型活沙");
  assert.ok(!live.dead, "吸收后复活");
  assert.equal(dust.dead, true, "扬尘体被吸收");
  assert.equal(live.atk, atk0 + dust.atk);
  assert.equal(live.defMax, def0 + 1, "吸收一只 def +1");
  assert.equal(c.totalHp(live), gain, "扬尘体的护甲和沙尘都算进活沙的血量");
  assert.match(notes, new RegExp(`吸收 ${dust.name}：\\+${gain} 沙尘`));
  assert.doesNotMatch(notes, /场上没有可吸收的/);
});

test("扬尘体和沙灵一起吸收，被击落的也算；打到 0 血还没清出场的、已经移出战场的扬尘体照旧不吸收", () => {
  const { c, S, K } = setup([{ id: "livesand", lv: 3, zone: 1 }, { id: "sand_beast", lv: 3, zone: 1 },
    { id: "dustbody", lv: 3, zone: 1 }, { id: "dustbody", lv: 3, zone: 2 }, { id: "dustbody", lv: 3, zone: 2 }]);
  const live = K("livesand"), beast = K("sand_beast");
  const [down, zero, gone] = S.units.filter(u => u.kit === "dustbody");
  down.flying = false;                              // 被击落：落地了，还活着
  zero.layers.forEach(l => { l.current = 0; });     // 刚被打死，还没清出场
  gone._removed = true;                             // 已经移出战场
  const atk0 = live.atk, def0 = live.defMax;
  const gain = c.totalHp(beast) + c.totalHp(down);
  const notes = killLivesand(c, live);
  assert.equal(live.resources.giant, true, "变成巨型活沙");
  assert.equal(beast.dead, true, "沙灵照旧被吸收");
  assert.equal(down.dead, true, "被击落的扬尘体也被吸收");
  assert.ok(!gone.dead, "移出战场的扬尘体不吸收");
  assert.equal(live.atk, atk0 + beast.atk + down.atk, "0 血的、移出战场的扬尘体不加 atk");
  assert.equal(live.defMax, def0 + 2, "吸收两只 def +2");
  assert.equal(c.totalHp(live), gain);
  assert.equal((notes.match(new RegExp(`吸收 ${down.name}：`, "g")) || []).length, 1, "只吸收了一只扬尘体");
});
