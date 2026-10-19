// 作者试玩反馈（10/19）：配置物打出的失衡没进我方协助攻击、铁壁挡不了借机攻击、
// 铁壁被友方 / 不该算的范围攻击波及、多阵营混战里敌人保护错了人、活沙也吸收沙漠生物
// （README「规则改动记录」里有对应说明）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function setup(party, enemies, opt) {
  const c = H.load();
  c.BattleSim.setup(Object.assign({ party, enemies, seed: "MF" }, opt || {}));
  c.startCombat();
  const S = c.S.state;
  // 这些用例只看击破 / 失衡：关掉柯尔特「过度自信」的 −1 击破
  S.units.forEach(u => { if (u.kit === "kolt") u.prideMaxHp = Infinity; });
  return { c, S, K: k => S.units.find(u => u.kit === k && !u.hidden && !u.dead) };
}
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));
const fatten = (u, hp) => { u.layers = [{ type: "flesh", current: hp, max: hp, inner: true }]; };
const ready = (u, zone) => { if (zone != null) u.zone = zone; u.ap = 5; u.bonus = 5; };
const logText = (S) => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
/** 一下范围攻击（照技能里的写法：dealTo 带 aoe，打完结算波及的配置物） */
function aoe(c, a, t, extra) {
  c.beginActionAcc(a, "test");
  const out = c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "fire", baseBreak: 0, atkRange: "any",
    flags: { action: true, aoe: true, blockResolved: true } }, extra || {}));
  c.flushAoePulse();
  return out;
}
/** 一下单体攻击（不进协助格挡） */
const hit = (c, a, t, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 0, atkRange: "any",
  flags: { action: true, blockResolved: true, block: "none" } }, extra || {}));
/** 川川在 zone 区展开铁壁，耐久改成 500 方便看 */
function ironWall(c, S, chuan, zone) {
  ready(chuan, zone);
  chuan.resources.charge = 1;
  cmd(c, { actor: chuan.id, skill: "chuan_wall" });
  const wall = S.props.find(p => p.kind === "ironwall");
  assert.ok(wall, "铁壁展开了");
  wall.hp = wall.maxHp = 500;
  return wall;
}

/* ---------- 1. 配置物打出的失衡：我方协助攻击 ---------- */

test("爆炸桶炸出敌人失衡：进我方的协助攻击队列（以前当成敌人那边打出的失衡，「没有可发动协助攻击的敌人」）", () => {
  const { c, S, K } = setup(["kolt", "helu"], [{ id: "thug_hammer", lv: 1, zone: 1 }]);
  const kolt = K("kolt"), helu = K("helu"), thug = K("thug_hammer");
  kolt.zone = helu.zone = 2;                 // 我方不在爆炸的区
  thug.zone = 1; fatten(thug, 300); thug.def = 2;
  const boom = c.makeProp("boom", 1, 1);
  S.props.push(boom);
  c.hitStructureCore(kolt, "prop:" + boom.id, { dmg: 10, brk: 1, element: "fire" });
  assert.ok(!S.props.includes(boom), "桶炸了");
  assert.equal(thug.stunned, true, "爆炸 2 击破打空架势");
  assert.equal(S.assistQueue.length, 1, "进了协助攻击队列");
  const job = S.assistQueue[0];
  assert.equal(job.vsPlayer, false, "由我方接");
  assert.deepEqual(plain(c.eligibleAssisters(c.unitById(job.breakerId), thug).map(u => u.kit).sort()), ["helu", "kolt"], "我方都能接（是桶炸的，不是谁打的）");
  assert.doesNotMatch(logText(S), /没有可发动协助攻击的敌人/);
});

test("电池爆炸、危墙倒塌这类环境伤害打出的失衡也一样；敌人被自己人的范围攻击误伤失衡，也由我方接", () => {
  // 电池爆炸（电击 0 击破）不打击破，这里用不稳：架势只剩 1 时挨一下就失衡
  const f = setup(["kolt", "helu"], [{ id: "guard_sword", lv: 1, zone: 1 }]);
  const g = f.K("guard_sword");
  f.K("kolt").zone = f.K("helu").zone = 2;
  fatten(g, 300); g.def = 1; g.statuses.unstable = true;
  const bat = f.c.makeProp("battery", 1, 1); bat.hp = 1;
  f.S.props.push(bat);
  f.c.hitStructureCore(f.K("kolt"), "prop:" + bat.id, { dmg: 10, brk: 1, element: "physical" });
  assert.equal(g.stunned, true);
  assert.equal(f.S.assistQueue.length, 1);
  assert.equal(f.S.assistQueue[0].vsPlayer, false);
  // 敌人的范围攻击误伤同伙（同一阵营、不敌对）：由我方接
  const e = setup(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }]);
  const knife = e.K("thug_knife"), ham = e.K("thug_hammer");
  e.K("kolt").zone = e.K("helu").zone = 2;
  fatten(ham, 300); ham.def = 1;
  aoe(e.c, knife, ham, { element: "physical", baseBreak: 1 });
  assert.equal(ham.stunned, true);
  assert.equal(e.S.assistQueue.length, 1);
  assert.equal(e.S.assistQueue[0].vsPlayer, false, "同伙误伤，我方接");
  assert.ok(e.c.eligibleAssisters(e.c.unitById(e.S.assistQueue[0].breakerId), ham).some(u => u.kit === "kolt"));
});

test("敌对阵营打出的失衡照旧由打的那一方接（沙鱼打失衡沙灵：沙鱼群起）", () => {
  const { c, S, K } = setup(["kolt", "helu"], [{ id: "sandfish_lead", lv: 3, zone: 1 }, { id: "sandfish_drive", lv: 3, zone: 1 }, { id: "sand_beast", lv: 3, zone: 1 }]);
  const lead = K("sandfish_lead"), sand = K("sand_beast");
  K("kolt").zone = K("helu").zone = 2;
  fatten(sand, 300); sand.def = 1;
  hit(c, lead, sand, { baseBreak: 1 });
  assert.equal(sand.stunned, true);
  assert.equal(S.assistQueue.length, 1);
  assert.equal(S.assistQueue[0].vsPlayer, true, "敌人那边（沙鱼）接");
  assert.deepEqual(plain(c.eligibleAssisters(c.unitById(S.assistQueue[0].breakerId), sand).map(u => u.kit)), ["sandfish_drive"]);
});

/* ---------- 2. 铁壁挡借机攻击 ---------- */

test("铁壁挡借机攻击：离开铁壁所在区时被借机攻击，打在铁壁上，人不受伤", () => {
  const { c, S, K } = setup(["chuan", "nora"], [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  const chuan = K("chuan"), nora = K("nora");
  S.units.forEach(u => { u.zone = 1; });
  S.units.filter(u => !u.isPlayer).forEach(u => fatten(u, 300));
  const wall = ironWall(c, S, chuan, 1);
  ready(nora, 1);
  const hp = c.totalHp(nora);
  c.doMove(nora, 2);
  assert.equal(nora.zone, 2, "走过去了");
  assert.match(logText(S), /借机攻击/);
  assert.equal(c.totalHp(nora), hp, "两下借机攻击都被铁壁挡下");
  assert.ok(wall.hp < 500, "铁壁替她挨了");
  assert.equal((logText(S).match(/铁壁替同区承受本次攻击/g) || []).length, 2, "两个狂徒各打一下，铁壁各挨一下（每次借机攻击是一次单独的攻击）");
});

test("主持人手动放的借机攻击（匕首狂徒 / 狼队长的借机技能）也按出手的那一区找铁壁", () => {
  for (const [kit, sid] of [["thug_knife", "en_thug_opp"], ["captain_wolf", "en_wolf_opp"]]) {
    const { c, S, K } = setup(["chuan", "nora"], [{ id: kit, lv: 1, zone: 1 }]);
    const chuan = K("chuan"), nora = K("nora"), foe = K(kit);
    foe.zone = 1; fatten(foe, 300);
    const wall = ironWall(c, S, chuan, 1);
    nora.zone = 2;                           // 已经走到隔壁了
    const hp = c.totalHp(nora);
    S.combatPhase = "enemy"; foe.ap = 1; foe.bonus = 1;
    S.attackerId = foe.id; S.targetId = nora.id;
    c.runSkill(sid);
    assert.equal(c.totalHp(nora), hp, sid + "：铁壁挡下");
    assert.ok(wall.hp < 500, sid + "：铁壁挨了");
  }
});

test("借机攻击按出手的那一区找铁壁：走进有铁壁的区不算", () => {
  const { c, S, K } = setup(["chuan", "nora"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const chuan = K("chuan"), nora = K("nora"), thug = K("thug_knife");
  thug.zone = 1; fatten(thug, 300);
  const wall = ironWall(c, S, chuan, 2);   // 铁壁在 2 区
  ready(nora, 1);
  const hp = c.totalHp(nora);
  c.doMove(nora, 2);
  assert.ok(c.totalHp(nora) < hp, "借机攻击发生在 1 区，2 区的铁壁挡不到");
  assert.equal(wall.hp, 500);
});

/* ---------- 3. 铁壁只挡「敌方」的攻击：按阵营判断 ---------- */

test("我方自己的范围攻击打同区的敌人：铁壁不挨打（以前范围攻击波及配置物时连自己的铁壁一起打）", () => {
  const { c, S, K } = setup(["chuan", "nora"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const chuan = K("chuan"), nora = K("nora"), thug = K("thug_knife");
  S.units.forEach(u => { u.zone = 1; });
  fatten(thug, 300);
  const wall = ironWall(c, S, chuan, 1);
  const hp = c.totalHp(thug);
  aoe(c, nora, thug);
  assert.ok(c.totalHp(thug) < hp, "敌人照常挨打");
  assert.equal(wall.hp, 500, "铁壁没被自己人的范围攻击波及");
  // 敌人的范围攻击照旧：打铁壁一次，我方不受伤
  const nHp = c.totalHp(nora);
  aoe(c, thug, nora);
  assert.equal(c.totalHp(nora), nHp);
  assert.ok(wall.hp < 500, "敌人的范围攻击照旧打在铁壁上");
});

test("我方同阵营的友军（战斗模板）放范围攻击：铁壁不挨打", () => {
  const { c, S, K } = setup(["chuan", "nora"], [{ id: "guard_sword", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  S.playerAllies = ["安保", "警卫队"];
  const chuan = K("chuan"), guard = K("guard_sword"), thug = K("thug_knife");
  S.units.forEach(u => { u.zone = 1; });
  fatten(thug, 300);
  const wall = ironWall(c, S, chuan, 1);
  const hp = c.totalHp(thug);
  aoe(c, guard, thug);
  assert.ok(c.totalHp(thug) < hp);
  assert.equal(wall.hp, 500, "友军的范围攻击不打我方的铁壁");
});

test("我方扔的投掷罐（不分敌我）：铁壁不挡自己人扔的、也不挨打；扔进废铁墙那一区，狂徒照旧被墙护住", () => {
  const { c, S, K } = setup(["chuan", "nora", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const chuan = K("chuan"), nora = K("nora"), kolt = K("kolt"), thug = K("thug_knife");
  S.units.forEach(u => { u.zone = 1; });
  kolt.zone = 2;
  fatten(thug, 300); fatten(nora, 300);
  thug.def = thug.defMax = 9; nora.def = nora.defMax = 9;
  const wall = ironWall(c, S, chuan, 1);
  c.bagAdd("bomb_e", 1); c.bagAdd("shockbomb", 1);
  c.useItemOn(kolt, "bomb_e", null, 1);
  assert.ok(c.totalHp(nora) < 300, "自己人扔的电击罐不分敌我，铁壁不挡");
  assert.ok(c.totalHp(thug) < 300);
  assert.equal(wall.hp, 500, "铁壁也不挨打");
  c.useItemOn(kolt, "shockbomb", null, 1);
  assert.equal(nora.def, 7, "震荡罐 2 击破照常打到诺拉");
  assert.equal(thug.def, 7);
  // 敌人那边的屏障照旧挡我方扔过去的
  const k = kingWithGuard();
  const knife = k.K("thug_knife");
  knife.def = knife.defMax = 9;
  k.c.bagAdd("shockbomb", 1);
  k.K("kolt").zone = 2;
  k.c.useItemOn(k.K("kolt"), "shockbomb", null, 1);
  assert.equal(knife.def, 9, "狂徒被废铁墙护住");
  assert.equal(k.K("guard_sword").def < k.K("guard_sword").defMax, true, "和盗匪敌对的剑看守不护");
});

test("多阵营：敌人打敌对阵营的敌人，不会被我方的铁壁「挡下」；敌人打我方照旧挡", () => {
  const { c, S, K } = setup(["chuan", "nora"], [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "guard_sword", lv: 1, zone: 1 }]);
  const chuan = K("chuan"), nora = K("nora"), thug = K("thug_knife"), guard = K("guard_sword");
  S.units.forEach(u => { u.zone = 1; });
  fatten(thug, 300); fatten(guard, 300);
  const wall = ironWall(c, S, chuan, 1);
  const g0 = c.totalHp(guard);
  hit(c, thug, guard);
  assert.ok(c.totalHp(guard) < g0, "狂徒打剑看守：打到剑看守身上");
  assert.equal(wall.hp, 500);
  const n0 = c.totalHp(nora);
  S.actionWallHit = {};
  hit(c, guard, nora);
  assert.equal(c.totalHp(nora), n0, "剑看守打诺拉：铁壁挡下");
  assert.ok(wall.hp < 500);
});

/* ---------- 4. 多阵营：敌人只保护自己人 ---------- */

/** 外城区的三方混战：亡命之王一伙 + 安保的剑看守，王用回防命令在 1 区筑废铁墙 */
function kingWithGuard() {
  const f = setup(["kolt", "helu"], [{ id: "outlaw_king", lv: 1, zone: 1 }, { id: "bandit_boss", lv: 1, zone: 1 },
    { id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }, { id: "guard_sword", lv: 1, zone: 1 }]);
  const { c, S, K } = f;
  S.units.forEach(u => { u.zone = 1; if (!u.isPlayer) fatten(u, 300); });
  K("kolt").zone = K("helu").zone = 2;
  const king = K("outlaw_king");
  king.ap = 1;
  S.combatPhase = "enemy";
  S.attackerId = king.id; S.targetId = null;
  c.runSkill("en_king_hold");
  S.combatPhase = "player";
  const wall = S.props.find(p => p.kind === "scrapwall");
  assert.ok(wall, "筑起了废铁墙");
  wall.hp = wall.maxHp = 500;
  S.actionWallHit = {};
  K("kolt").zone = 1;
  return Object.assign(f, { wall, king });
}

test("废铁墙只护着亡命之王一伙：和盗匪敌对的安保（剑看守）挨我方攻击时，墙不替它挡", () => {
  const { c, S, K, wall } = kingWithGuard();
  const kolt = K("kolt"), guard = K("guard_sword"), knife = K("thug_knife");
  const g0 = c.totalHp(guard);
  hit(c, kolt, guard);
  assert.ok(c.totalHp(guard) < g0, "剑看守自己挨打");
  assert.equal(wall.hp, 500, "废铁墙不替敌对阵营挡");
  // 打狂徒：照旧被墙挡下
  S.actionWallHit = {};
  const k0 = c.totalHp(knife);
  hit(c, kolt, knife);
  assert.equal(c.totalHp(knife), k0);
  assert.ok(wall.hp < 500, "狂徒照旧被废铁墙护住");
});

test("废铁墙不被盗匪自己的范围攻击波及，也不替被打的安保挡；安保的范围攻击打狂徒照旧被墙挡", () => {
  const { c, S, K, wall } = kingWithGuard();
  const guard = K("guard_sword"), knife = K("thug_knife"), ham = K("thug_hammer");
  const g0 = c.totalHp(guard);
  aoe(c, knife, guard);
  assert.ok(c.totalHp(guard) < g0, "狂徒的范围攻击打到剑看守");
  assert.equal(wall.hp, 500, "自己人的范围攻击不打废铁墙");
  const h0 = c.totalHp(ham);
  aoe(c, guard, ham);
  assert.equal(c.totalHp(ham), h0, "剑看守的范围攻击：狂徒被废铁墙护住");
  assert.ok(wall.hp < 500, "墙替狂徒挨了这一下");
});

test("警卫队队长·牛不替中立生物格挡；和我方同阵营时不替别人挡我方的攻击", () => {
  // 中立生物（尘虫）：谁都不当它是敌人，牛也不该护着它
  const f = setup(["kolt", "helu"], [{ id: "captain_ox", lv: 1, zone: 1 }, { id: "dust_bug", lv: 1, zone: 1 }]);
  const kolt = f.K("kolt"), ox = f.K("captain_ox"), bug = f.K("dust_bug");
  f.S.units.forEach(u => { u.zone = 1; });
  fatten(bug, 300);
  bug.submerged = false;
  vm.runInContext("Math", f.c).random = () => 0;   // 格挡骰必定成功
  const oxDef = ox.def, b0 = f.c.totalHp(bug);
  hit(f.c, kolt, bug, { flags: { action: true } });
  assert.ok(f.c.totalHp(bug) < b0, "尘虫挨打");
  assert.equal(ox.def, oxDef, "牛没有出手格挡");
  assert.doesNotMatch(logText(f.S), /自动协助格挡/);
  // 我方和警卫队同阵营（战斗模板）：牛是友军，不替巨人挡我方的攻击
  const g = setup(["kolt", "helu"], [{ id: "captain_ox", lv: 1, zone: 1 }, { id: "giant", lv: 1, zone: 1 }]);
  g.S.playerAllies = ["警卫队", "安保"];
  const k2 = g.K("kolt"), ox2 = g.K("captain_ox"), giant = g.K("giant");
  g.S.units.forEach(u => { u.zone = 1; });
  fatten(giant, 300);
  vm.runInContext("Math", g.c).random = () => 0;
  const ox2Def = ox2.def, gi0 = g.c.totalHp(giant);
  hit(g.c, k2, giant, { flags: { action: true } });
  assert.ok(g.c.totalHp(giant) < gi0, "巨人挨打");
  assert.equal(ox2.def, ox2Def, "友军的牛不替巨人格挡");
  // 平常（不是友军）：牛照旧替同伙挡
  const n = setup(["kolt", "helu"], [{ id: "captain_ox", lv: 1, zone: 1 }, { id: "guard_sword", lv: 1, zone: 1 }]);
  const k3 = n.K("kolt"), ox3 = n.K("captain_ox"), sw = n.K("guard_sword");
  n.S.units.forEach(u => { u.zone = 1; });
  fatten(sw, 300);
  vm.runInContext("Math", n.c).random = () => 0;
  const s0 = n.c.totalHp(sw);
  hit(n.c, k3, sw, { flags: { action: true } });
  assert.equal(n.c.totalHp(sw), s0, "牛替剑看守挡下");
});

/* ---------- 5. 活沙也吸收沙漠生物 ---------- */

test("活沙被杀死时吸收场上活着的沙灵和沙漠生物（沙鱼），不吸收中立生物、已经逃走的沙鱼", () => {
  const { c, S, K } = setup(["kolt", "helu"], [{ id: "livesand", lv: 3, zone: 1 }, { id: "sand_beast", lv: 3, zone: 1 },
    { id: "sandfish_drive", lv: 3, zone: 2 }, { id: "sandfish_ambush", lv: 3, zone: 2 }, { id: "dust_bug", lv: 3, zone: 2 }]);
  const live = K("livesand"), beast = K("sand_beast"), drive = K("sandfish_drive"), ambush = K("sandfish_ambush"), bug = K("dust_bug");
  ambush._removed = true; ambush.submerged = false;   // 下潜逃走了
  const atk0 = live.atk, def0 = live.defMax;
  const gain = c.totalHp(beast) + c.totalHp(drive);
  live.layers.forEach(l => { l.current = 0; });
  const notes = c.sweepDeadEnemies().join("\n");
  assert.equal(live.resources.giant, true, "变成巨型活沙");
  assert.ok(!live.dead);
  assert.equal(beast.dead, true, "沙灵被吸收");
  assert.equal(drive.dead, true, "沙鱼也被吸收");
  assert.ok(!bug.dead, "尘虫（中立生物）不吸收");
  assert.ok(!ambush.dead, "逃走的沙鱼不在场上，不吸收");
  assert.equal(live.atk, atk0 + beast.atk + drive.atk);
  assert.equal(live.defMax, def0 + 2, "吸收两只 def +2");
  assert.equal(c.totalHp(live), gain);
  assert.match(notes, new RegExp(`吸收 ${drive.name}`));
});
