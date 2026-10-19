// 攻击演出（attack-fx.js）：按技能 / 敌人招式名 / 属性 / 距离挑招式；联机时招式按白名单发给玩家（online-view.js · projectFx）。
// 画法本身要浏览器才看得到（tests/ui.test.js 的战斗用例会把它跑一遍），这里只管「挑得对不对」和「发出去的东西干不干净」。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const F = require("../attack-fx");
const V = require("../online-view");

const pick = (info) => F.resolve(Object.assign({ dmg: true, hits: 1, targets: 1 }, info));

test("我方技能按武器挑招式：绯秋刀光、瑞比能量弹两发、灯盾击、年糕咬、诺拉针刺", () => {
  assert.deepEqual([pick({ skillId: "hiaki_aa", isPlayer: true, element: "fire", dist: 0 })].map(m => [m.kind, m.blade, m.melee]), [["slash", "katana", true]]);
  const ruby = pick({ skillId: "ruby_aa", isPlayer: true, element: "energy", dist: 1, hits: 2 });
  assert.equal(ruby.kind, "bolt"); assert.equal(ruby.melee, false); assert.equal(ruby.hits, 2);
  const tou = pick({ skillId: "tou_aa", isPlayer: true, element: "physical", dist: 0 });
  assert.equal(tou.kind, "smash"); assert.equal(tou.shield, true);
  assert.equal(pick({ skillId: "mochi_bite", isPlayer: true, dist: 0 }).kind, "bite");
  assert.equal(pick({ skillId: "nora_aa", isPlayer: true, element: "ice", dist: 1 }).kind, "thrust");
  assert.equal(pick({ skillId: "latte_puff", isPlayer: true, element: "acid", dist: 1 }).fur, true, "拿铁的毛球攻击是个毛球");
  assert.equal(pick({ skillId: "chuan_aa", isPlayer: true, element: "electric", dist: 0, hits: 2 }).kind, "zap");
});

test("要看现场的招式：龙哥手杖 / 霰弹枪、柯尔特酸液炮 / 电钻、结人冰美式打敌人 / 奶队友", () => {
  assert.equal(pick({ skillId: "longge_aa", isPlayer: true, element: "fire", dist: 1, mode: "gun" }).kind, "spread");
  const cane = pick({ skillId: "longge_aa", isPlayer: true, element: "ice", dist: 0 });
  assert.equal(cane.kind, "smash"); assert.equal(cane.cane, true);
  assert.equal(pick({ skillId: "kolt_aa", isPlayer: true, element: "acid", dist: 1 }).kind, "lob");
  const drill = pick({ skillId: "kolt_aa", isPlayer: true, element: "electric", dist: 0, hits: 3 });
  assert.equal(drill.kind, "smash"); assert.equal(drill.drill, true);
  assert.equal(pick({ skillId: "yuito_amer", isPlayer: true, element: "ice", dist: 1, targets: 3 }).kind, "wave");
  assert.equal(F.resolve({ skillId: "yuito_amer", isPlayer: true, dmg: false, ally: true }).kind, "support");
});

test("敌人按招式名挑：匕首一刀、远距射击开枪、近距砸枪是砸、电击挥砍是带电的刀、能量射线是光束、霰弹枪是一把弹丸", () => {
  const e = (skillName, skillId, kit, element, dist) => pick({ isPlayer: false, skillName, skillId, kit, element, dist });
  const knife = e("匕首", "en_thug_knife", "thug_knife", "physical", 0);
  assert.equal(knife.kind, "slash"); assert.equal(knife.blade, "knife");
  assert.equal(e("远距射击", "en_guard_gun_far", "guard_gun", "physical", 1).kind, "shot");
  assert.equal(e("近距砸枪", "en_guard_gun_near", "guard_gun", "physical", 0).kind, "smash");
  const sword = e("电击挥砍", "en_guard_sword", "guard_sword", "electric", 0);
  assert.equal(sword.kind, "slash"); assert.equal(sword.el, "electric");
  assert.equal(e("能量射线（倒流）", "en_miner_shot", "meteor_miner", "energy", 1).kind, "beam");
  assert.equal(e("弦振射线（高能 + 衍蛛追打）", "en_centi_shot", "meteor_centipede", "harmonic", 1).kind, "beam");
  assert.equal(e("霰弹枪射击（2点，需预热）", "en_chi_shot", "ufo_body", "physical", 1).kind, "spread");
  assert.equal(e("腾咬（白天）/ 猛咬（夜晚）", "en_fish_ambush_bite", "sandfish_ambush", "physical", 0).kind, "bite");
  assert.equal(e("冰爪", "en_wolf", "captain_wolf", "ice", 0).kind, "claw");
  assert.equal(e("借机攻击", "", "captain_wolf", "ice", 0).kind, "claw", "狼队长的借机攻击也是一爪");
  assert.equal(e("榴弹（选择区域）", "en_gl", "mecha_gl", "physical", 1).kind, "lob");
  const hammer = e("砸锤", "en_thug_hammer", "thug_hammer", "physical", 0);
  assert.equal(hammer.kind, "smash"); assert.equal(hammer.heavy, true);
});

test("对不上的按属性和距离挑：隔区按弹道，同区按近身", () => {
  const far = (element) => pick({ isPlayer: false, skillName: "普通攻击", skillId: "en_aa", element, dist: 1 }).kind;
  assert.deepEqual(["physical", "energy", "electric", "fire", "ice", "acid", "harmonic"].map(far), ["shot", "bolt", "zap", "flame", "shard", "lob", "wave"]);
  assert.equal(pick({ isPlayer: false, skillName: "普通攻击", skillId: "en_aa", element: "physical", dist: 0 }).kind, "smash");
  assert.equal(pick({ isPlayer: false, skillName: "普通攻击", skillId: "en_aa", element: "fire", dist: 0 }).kind, "slash");
  assert.equal(pick({ isPlayer: false, skillName: "普通攻击", skillId: "en_aa", element: "nonsense", dist: 0 }).el, "physical", "不认识的属性按物理");
});

test("没打出伤害：敌人不演（召唤、下命令、等协助格挡的那一下）；我方打友方是支援、给敌人挂上效果才演挂效果", () => {
  assert.equal(F.resolve({ isPlayer: false, skillName: "匕首", skillId: "en_thug_knife", dmg: false }).kind, "none", "要等格挡的那一击先不演");
  assert.equal(F.resolve({ isPlayer: false, skillName: "召唤沙灵 1d4", skillId: "en_bigsand_summon", dmg: false }).kind, "none");
  assert.equal(F.resolve({ isPlayer: true, skillId: "latte_love", dmg: false, ally: true }).kind, "support");
  assert.equal(F.resolve({ isPlayer: true, skillId: "chuan_wall", dmg: false, ally: true }).shield, true, "铁壁是护盾");
  const trig = F.resolve({ isPlayer: true, skillId: "ruby_trigger", dmg: false, touched: true });
  assert.equal(trig.kind, "hex"); assert.equal(trig.glitch, true, "黑客挂效果带错位方块");
  assert.equal(F.resolve({ isPlayer: true, skillId: "ruby_aa", dmg: false }).kind, "none", "普攻没打中（也没挂上东西）不演挂效果");
  assert.equal(F.resolve({ isPlayer: true, skillId: "ruby_summon", dmg: false }).kind, "none", "唤出武器人不是攻击");
  assert.equal(F.resolve({ isPlayer: true, skillId: "__move", dmg: false }).kind, "none");
});

test("范围招式：打到几个人的声波 / 爆炸标成整区", () => {
  assert.equal(pick({ skillId: "mochi_boom", isPlayer: true, element: "harmonic", dist: 0, targets: 3 }).area, true);
  assert.equal(pick({ skillId: "mochi_boom", isPlayer: true, element: "harmonic", dist: 0, targets: 1 }).area, undefined);
  assert.equal(pick({ skillId: "hiaki_flash", isPlayer: true, element: "fire", dist: 0, targets: 2 }).flash, true, "一闪：横贯整区的一道光");
});

test("每一种招式都在演出表里（加招式忘了接画法会在这里报）", () => {
  const kinds = new Set(["slash", "thrust", "smash", "claw", "bite", "shot", "spread", "bolt", "beam", "zap", "shard", "lob", "flame", "wave", "explode", "support", "hex", "none"]);
  for (const k of kinds) assert.ok(F.KIND[k], "缺少 " + k);
  for (const k of Object.keys(F.KIND)) assert.ok(kinds.has(k), "多出来的 " + k);
});

test("联机：攻击演出按白名单发给玩家——只有两个单位 id、招式种类、属性和画法开关", () => {
  const out = V.projectPacket({ type: "result", tape: [], fx: {
    actor: "u1", target: "u2",
    move: { kind: "slash", el: "fire", melee: true, blade: "katana", hits: 2, heavy: true, secret: "SECRET-FX", value: 99, note: "坚毅 123" }
  } }, { recipientId: "p1", gmId: "host" });
  assert.deepEqual(out.fx, { actor: "u1", target: "u2", move: { kind: "slash", el: "fire", melee: true, heavy: true, blade: "katana", hits: 2 } });
  const bad = (fx) => V.projectPacket({ type: "result", fx }, { recipientId: "p1", gmId: "host" }).fx;
  assert.equal(bad({ actor: "u1", target: "u2", move: { kind: "nuke", el: "fire" } }), null, "不认识的招式不发");
  assert.equal(bad({ actor: "u1", target: "坚毅", move: { kind: "slash" } }), null, "id 里有敏感字不发");
  assert.equal(bad({ actor: "u1", move: { kind: "slash" } }), null, "缺目标不发");
  assert.equal(bad("slash"), null);
  assert.equal(bad({ actor: "u1", target: "u2", move: { kind: "bolt", el: "plasma", blade: "chainsaw" } }).move.el, "physical", "不认识的属性按物理、刀型丢掉");
  // 主机自己（主持人）拿到的是原样
  assert.equal(V.projectPacket({ type: "result", fx: { actor: "u1", target: "u2", move: { kind: "slash", secret: 1 } } }, { recipientId: "host", gmId: "host" }).fx.move.secret, 1);
});

test("联机：伤害弹字带上 main（玩家画面只在攻击动作本身那几段补刀光 / 冲击星）", () => {
  const u = { id: "u1", name: "狂徒", isPlayer: false, zone: 2, layers: [{ type: "flesh", current: 10, max: 20 }] };
  const tape = V.projectTape([
    { type: "pop", unitId: "u1", kind: "dmg", value: 5, element: "fire", main: true, snap: [u] },
    { type: "pop", unitId: "u1", kind: "dmg", value: 2, element: "electric", main: false, snap: [u] },
    { type: "pop", unitId: "u1", kind: "status", text: "灼烧", main: true }
  ], { state: { units: [u] } });
  assert.deepEqual(tape.map(e => e.main === true), [true, false, false], "只有主攻击的伤害带 main");
});

test("game.html 先载入 attack-fx.js 再载入 game.js（演出在 game.js 里用到它）", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "game.html"), "utf8");
  const a = html.indexOf('src="attack-fx.js"'), g = html.indexOf('src="game.js"'), o = html.indexOf('src="online-ui.js"');
  assert.ok(a > 0 && g > a, "attack-fx.js 要在 game.js 前面");
  assert.ok(o < 0 || o > a, "联机玩家画面也用它");
});
