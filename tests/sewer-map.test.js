// 下水道地图（新物品，3000）+ 单局幕间进入下水道（docs/ratfolk.md 第 6 节，issue #286）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const ROOT = path.resolve(__dirname, "..");
const plain = x => JSON.parse(JSON.stringify(x));

// 下水道的敌人（狂鼠 + 下水道维护，tests/ratfolk-units.test.js 核对过敌人池）
const SEWER_KITS = ["rat_lurker", "rat_biter", "rat_plague", "rat_tyrant", "sewer_sweeper", "sewer_keeper", "sewer_cleaner"];
const SEWER_NAMES = ["潜藏者", "撕咬者", "疫病暴徒", "暴虐猎手", "下水道清扫机", "触灵维护员", "触灵清扫员"];

/** 新开一局，停在第 act 幕的幕间（打完第 act 幕的首领）；map：背包里放几张下水道地图 */
function atInterlude(act, map, seed, c) {
  c = c || H.load();
  const R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: seed || "SEWER" + act });
  run.act = act; run.stage = "interlude";
  if (map) c.bagAdd("map_sewer", map);
  return { c, R, run };
}
const regions = (R, run) => plain(R.interludeOptions(run).map(o => o.region));
/** 让当前节点变成 type 的一站（battleSpec 只看这几样） */
function standAt(run, type, i) {
  run.stage = "task";
  run.task = { name: "测试", nodes: [{ type }], index: 0, weather: null, diff: 0 };
  run.taskNo = i;
  run.actDay = i % 8;
}

/* ---------- 1. 物品、跑团商店、单局商店 ---------- */
test("新物品「下水道地图」map_sewer：价格 3000，跑团商店「地图与票券」有卖；和污水处理厂地图 map_sewage 不是同一个（那个不动）；和别的地图一样不能卖", () => {
  const c = H.load();
  assert.equal(c.ITEM_CATALOG.map_sewer.name, "下水道地图");
  assert.equal(c.ITEM_CATALOG.map_sewage.name, "污水处理厂地图");
  const row = c.S.HANDBOOK_SHOP.find(r => r.key === "map_sewer");
  assert.deepEqual(plain(row), { group: "地图与票券", key: "map_sewer", price: 3000, give: { item: "map_sewer" } });
  assert.deepEqual(plain(c.S.HANDBOOK_SHOP.find(r => r.key === "map_sewage")), { group: "地图与票券", key: "map_sewage", price: 10000, give: { item: "map_sewage" } });
  c.S.state.kuizhi = 5000;
  c.trpgBuy("map_sewer", 1);
  assert.equal(c.bagCount("map_sewer"), 1);
  assert.equal(c.S.state.kuizhi, 2000);
  assert.equal(c.shopSellCheck("map_sewer").reason, "地图与票券");
});

test("单局商店：下水道地图 3000（ROGUE_SHOP）可以随机刷出来——另用一条随机流按 ROGUE_SHOP_RULES.mapChance 进一张，原来的商品照旧；买得到；进过下水道以后、长线养成都不再进货", () => {
  const c = H.load(), R = c.Rogue;
  const row = c.S.ROGUE_SHOP.find(r => r.key === "map_sewer");
  assert.equal(row.price, 3000);
  assert.equal(row.give.item, "map_sewer");
  const chance = vm.runInContext("ROGUE_SHOP_RULES.mapChance", c), fxN = vm.runInContext("ROGUE_SHOP_RULES.effectCount", c);
  assert.ok(chance > 0 && chance < 1, "概率放在配置表里");
  const run = R.newRun({ party: ["kolt", "helu"], seed: "SEWER-SHOP" });
  run.stage = "camp";
  const N = 300;
  let hit = 0, first = -1;
  for (let i = 0; i < N; i++) {
    run.taskNo = i;
    const keys = R.shopStock(run).map(r => r.key);
    assert.equal(keys.filter(k => k !== "map_sewer").length, 2 + 8 + fxN, "常备 2 种 + 随机 8 种 + 效果道具，不被地图挤掉");
    assert.equal(R.shopStock(run).map(r => r.key).join(), keys.join(), "同一家店看几次都一样");
    if (keys.includes("map_sewer")) { hit++; if (first < 0) first = i; }
  }
  assert.ok(hit > 0 && hit < N, `能刷出来，但不是每家都有：${hit}/${N}`);
  assert.ok(Math.abs(hit / N - chance) < 0.08, `约 ${chance}：${hit}/${N}`);
  run.taskNo = first;
  c.S.state.kuizhi = 3000;
  const notes = R.buy(run, "map_sewer", 1);
  assert.match(notes.join(""), /下水道地图/);
  assert.equal(c.bagCount("map_sewer"), 1);
  assert.equal(c.S.state.kuizhi, 0);
  // 进过下水道：地图用不上了，不再进货
  run.regionPick = { 2: "下水道" };
  for (let i = 0; i < N; i++) { run.taskNo = N + i; assert.ok(!R.shopStock(run).some(r => r.key === "map_sewer"), "进过下水道以后不再进货"); }
  // 长线养成没有幕间：不进货
  const g = R.newRun({ party: ["kolt", "helu"], seed: "SEWER-SHOP-G", growth: true });
  g.stage = "camp";
  for (let i = 0; i < N; i++) { g.taskNo = i; assert.ok(!R.shopStock(g).some(r => r.key === "map_sewer"), "长线养成不进货"); }
});

/* ---------- 2. 幕间多一个「下水道」 ---------- */
test("幕间：没有下水道地图时没有「下水道」；有地图时任何一次幕间都多一个（和原来的 1~2 个并列），说明写区域简介和会遇到的敌人", () => {
  const want = { 1: ["沙漠", "第一采矿场"], 2: ["巨人城", "第二采矿场"], 3: ["天网设施", "第三采矿场"] };
  for (const act of [1, 2, 3]) {
    const { c, R, run } = atInterlude(act);
    assert.deepEqual(regions(R, run), want[act], "没有地图：照旧");
    c.bagAdd("map_sewer", 1);
    const opts = plain(R.interludeOptions(run));
    assert.deepEqual(opts.map(o => o.region), want[act].concat("下水道"), "有地图：多一个下水道");
    const s = opts[2];
    assert.equal(s.sewer, true);
    assert.equal(s.alt, true);
    assert.ok(!opts[0].sewer && !opts[1].sewer);
    assert.ok(s.desc && s.desc === c.worldPlaceOf("下水道").desc, "区域简介写在 WORLD_PLACES");
    assert.deepEqual([...s.enemies].sort(), [...SEWER_NAMES].sort(), "会遇到的敌人：狂鼠和下水道维护");
  }
  // 额外幕（第 5 幕打完）：原本只有一条路，有地图也多一个下水道
  const { c, R, run } = atInterlude(5);
  run.extra = true;
  assert.deepEqual(regions(R, run), ["沙漠"]);
  c.bagAdd("map_sewer", 1);
  assert.deepEqual(regions(R, run), ["沙漠", "下水道"]);
});

test("选了下水道：用掉地图；这一幕的普通战、精英战都抽下水道的敌人，等级和原来那条路一样；任务不带天气（区域环境待定）；地图上的路线点在下水道", () => {
  const { c, R, run } = atInterlude(1, 1);
  const notes = R.nextAct(run, "下水道");
  assert.equal(run.act, 2);
  assert.equal(R.region(run), "下水道");
  assert.equal(c.bagCount("map_sewer"), 0, "地图用掉了");
  assert.match(notes.join(""), /下水道地图/);
  // 对照：同一个种子走原本的路（也带着地图）
  const base = atInterlude(1, 1);
  base.R.nextAct(base.run, "沙漠");
  assert.equal(base.c.bagCount("map_sewer"), 1, "没走下水道：不用地图");
  for (const type of ["battle", "elite"]) {
    for (let i = 0; i < 30; i++) {
      standAt(run, type, i); standAt(base.run, type, i);
      const spec = R.battleSpec(run), ref = base.R.battleSpec(base.run);
      assert.equal(spec.encounter.region, "下水道");
      assert.ok(spec.encounter.enemies.length > 0);
      spec.encounter.enemies.forEach(e => assert.ok(SEWER_KITS.includes(e.preset), type + "：" + e.preset));
      assert.equal(ref.encounter.region, "沙漠");
      assert.equal(spec.level, ref.level, "等级和原来那条路一样");
    }
  }
  // 下水道的任务都不带天气（遭遇默认的天气也是无：run.js · regionWeather）
  for (let i = 0; i < 20; i++) { run.boardNo = 100 + i; R.makeBoard(run); run.board.forEach(t => assert.equal(t.weather, null)); }
  // 地图上的路线：这一幕的区域能对到地图上的地点（rogue-ui.js · mapOptions 照 run.regionPick 画）
  assert.equal(c.worldPlaceOf(run.regionPick[2]).name, "下水道");
});

test("下水道那一幕的悬赏：目标和随从都是下水道的敌人", () => {
  const c = H.load();
  for (let n = 0; n < 60; n++) {
    const { R, run } = atInterlude(1, 1, "SEWER-BTY" + n, c);
    R.nextAct(run, "下水道");
    const k = run.board.findIndex(t => t.kind === "bounty");
    if (k < 0) continue;
    R.acceptTask(run, k);
    for (let guard = 0; guard < 30 && !(R.currentNode(run) || {}).target; guard++) {
      const node = R.currentNode(run);
      if (node.type === "check") {
        const info = R.checkInfo(run);
        node.check.diff = "easy";
        (node.check.options || []).forEach(o => { o.diff = "easy"; });
        run.party.forEach(h => { h.profs[info.prof] = 3; });
        R.attemptCheck(run, run.party[0].kit);
      } else if (node.type === "battle" || node.type === "elite") R.finishBattle(run, "win");
      else if (node.type === "rest") R.restAtNode(run, "leave");
      else R.leaveNode(run);
    }
    assert.ok(R.currentNode(run).target, "找到了悬赏目标");
    assert.equal(R.region(run), "下水道");
    assert.ok(c.bountyCandidates("下水道").includes(run.task.hunt.target.preset), run.task.hunt.target.preset);
    const spec = R.battleSpec(run);
    assert.equal(spec.encounter.region, "下水道");
    spec.encounter.enemies.forEach(e => assert.ok(SEWER_KITS.includes(e.preset), e.preset));
    return;
  }
  assert.fail("60 个种子都没抽到悬赏任务");
});

test("一局只能进一次：进过下水道以后，再有地图也不出现这个选项，硬选也不行；没有地图也不能选；走别的路不用地图", () => {
  const none = atInterlude(1);
  assert.throws(() => none.R.nextAct(none.run, "下水道"), /不能去下水道/, "没有地图");
  const { c, R, run } = atInterlude(1, 2);   // 带了两张
  R.nextAct(run, "下水道");
  assert.equal(c.bagCount("map_sewer"), 1, "只用掉一张");
  run.stage = "interlude";
  assert.deepEqual(regions(R, run), ["巨人城", "第二采矿场"], "进过一次：不再出现");
  assert.throws(() => R.nextAct(run, "下水道"), /不能去下水道/);
  R.nextAct(run, "巨人城");
  assert.equal(R.region(run), "巨人城");
  assert.equal(c.bagCount("map_sewer"), 1, "走别的路不用地图");
  run.stage = "interlude";
  c.bagAdd("map_sewer", 3);
  assert.ok(!regions(R, run).includes("下水道"), "再买到地图也不出现");
});

test("下水道那一幕的首领：ROGUE_CONFIG.bosses 给下水道一个空池 → 从全部首领里抽；首领战在下水道，等级照这一幕", () => {
  const c = H.load(), C = c.S.ROGUE_CONFIG;
  assert.deepEqual(plain(C.bosses["下水道"]), []);
  const all = Object.values(C.bosses).flat();
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const { R, run } = atInterlude(1, 1, "SEWER-BOSS" + i, c);
    R.nextAct(run, "下水道");
    run.stage = "boss";
    const spec = R.battleSpec(run);
    const boss = spec.encounter.enemies.map(e => e.preset).find(k => all.includes(k));
    assert.ok(boss, JSON.stringify(spec.encounter.enemies));
    assert.equal(spec.encounter.region, "下水道");
    assert.equal(spec.level, R.levelRange(run)[1] + (C.bossLevelOffset || 0));
    seen.add(boss);
  }
  assert.ok(seen.size > 1, "从全部首领里抽：" + [...seen].join("、"));
});

test("地图：下水道是角鳞星地图上的一个地点（WORLD_PLACES，区域简介写在这里）；跑团把队伍移到下水道，战斗的区域也认得出是下水道", () => {
  const c = H.load();
  const p = c.worldPlaceOf("下水道");
  assert.ok(p && p.name === "下水道" && p.desc);
  assert.equal(c.battleRegionName(p.id), "下水道");
  c.Commands.dispatch({ type: "trpg", action: "setPlace", place: p.id });
  assert.equal(c.LEDGER.place, p.id);
});

test("单局界面：下水道的按钮写明会用掉地图（rogue-ui.js）", () => {
  const src = fs.readFileSync(path.join(ROOT, "rogue-ui.js"), "utf8");
  assert.match(src, /o\.sewer \? "（用掉下水道地图）"/);
});

/* ---------- 3. 联机单局 ---------- */
function online(seed) {
  const c = H.load(), R = c.Rogue, run = R.newRun({ party: ["torque", "helu", "ruby"], seed });
  c.S.state.kuizhi = 0;
  c.RunFlow = {
    current: () => run,
    actRaw: cmd => c.Commands.dispatch(Object.assign({ type: "run" }, cmd), { run }),
    perform: cmd => c.Commands.dispatch(Object.assign({ type: "run" }, cmd), { run })   // 投票定下来的事真的去做（经过联机的指令层）
  };
  c.OnlineGame = { isHost: () => true, players: () => [{ id: "host", online: true }, { id: "p2", online: true }] };
  vm.runInContext(fs.readFileSync(path.join(ROOT, "online-rogue.js"), "utf8"), c, { filename: "online-rogue.js" });
  const O = c.OnlineRogue; O.enable(true, "host"); O.setOwners({ helu: "p2", ruby: "p2" });   // torque 归房主
  run.act = 1; run.stage = "interlude";
  return { c, R, run, O, d: O.data(run) };
}
/** 给一张下水道地图：kit = 记在这名角色名下；不给 = 公用的 */
function giveMap(c, d, kit) {
  c.bagAdd("map_sewer", 1);
  if (kit) { d.owned[kit] = d.owned[kit] || {}; d.owned[kit].map_sewer = (d.owned[kit].map_sewer || 0) + 1; }
}
async function voteAll(O, optionId) {
  O.vote("host", optionId); O.vote("p2", optionId);
  assert.ok(O.tryResolve(false), "两个人都投了：结算");
  await new Promise(r => setTimeout(r, 10));
}

test("联机：队伍里任何一个人有下水道地图，幕间投票就多一个「下水道」；投中了用掉那个人的地图；一局一次", async () => {
  const { c, R, run, O, d } = online("SEWER-OL1");
  assert.deepEqual(plain(O.options(run).map(o => o.id)), ["nextAct:沙漠", "nextAct:第一采矿场"], "没人有地图");
  giveMap(c, d, "ruby");   // p2 操控的角色
  const opts = plain(O.options(run));
  assert.deepEqual(opts.map(o => o.id), ["nextAct:沙漠", "nextAct:第一采矿场", "nextAct:下水道"]);
  assert.match(opts[2].label, /前往第 2 幕：下水道.*下水道地图/);
  assert.deepEqual(plain(opts[2].cmd), { action: "nextAct", region: "下水道" });
  assert.ok(O.viewFor("p2").vote.options.some(o => o.id === "nextAct:下水道"), "玩家那边也看得到这个选项");
  await voteAll(O, "nextAct:下水道");
  assert.equal(run.act, 2);
  assert.equal(R.region(run), "下水道");
  assert.equal(c.bagCount("map_sewer"), 0);
  assert.equal((d.owned.ruby || {}).map_sewer, undefined, "用掉的是 ruby 名下的那张");
  assert.ok(run.log.some(l => l.text.includes(R.heroName("ruby")) && l.text.includes("下水道地图")), "记录里写明用了谁的地图");
  // 一局一次：再有人有地图也不再出现
  run.stage = "interlude";
  giveMap(c, d, "torque");
  assert.ok(!O.options(run).some(o => o.id === "nextAct:下水道"));
});

test("联机：好几个人都有地图时只用掉一张——先用公用的；没有公用的，用队伍里排在最前面、名下有地图的角色的", async () => {
  {
    const { c, O, d } = online("SEWER-OL2");
    giveMap(c, d, "helu"); giveMap(c, d, null);   // helu 名下一张 + 公用一张
    await voteAll(O, "nextAct:下水道");
    assert.equal(c.bagCount("map_sewer"), 1);
    assert.equal(d.owned.helu.map_sewer, 1, "先用公用的，helu 的留着");
  }
  {
    const { c, O, d } = online("SEWER-OL3");
    giveMap(c, d, "ruby"); giveMap(c, d, "helu");   // 队伍顺序：torque → helu → ruby
    await voteAll(O, "nextAct:下水道");
    assert.equal(c.bagCount("map_sewer"), 1);
    assert.equal((d.owned.helu || {}).map_sewer, undefined, "helu 排在 ruby 前面：用 helu 的");
    assert.equal(d.owned.ruby.map_sewer, 1);
  }
});
