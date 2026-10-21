// 首领机制的 FF14 式显示（issue #206）：被点名的人头上一个图标（每种机制一个形状，角上的大数字 = 还有几回合，本回合落下写「!」），
// 首领头上是它正在读条的机制；踩塔在区名旁边；战场正上方的横幅按剩余回合排序。铭牌上不写机制名字。
// 这里测不需要浏览器的部分：图标 / 说明 / 横幅的内容，以及规则 → 单机快照 / 联机投影 → 画面这一串（联机数据不含坚毅生命）。
// 画面本身（位置、悬停、触屏、减少动态效果）见 tests/boss-countdown-display.test.js 的浏览器测试。
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const H = require("./headless");
const UnitCard = require("../unit-card.js");

const TYPES = ["execution", "share", "spread", "tower", "volley"];
const NAME = { execution: "死刑", share: "分担", spread: "远离", tower: "踩塔", volley: "齐射" };
const unent = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** 画出来看得见的字（去掉标签；属性里的说明、读屏文字不算） */
const visible = (html) => unent(html.replace(/<[^>]*>/g, ""));
/** 拆出一串图标：[{ kind, type, last, left, n, tip }] */
function icons(html) {
  const out = [];
  const re = /<span class="mech-ico k-(\w+) t-(\w+)( last)?"[^>]*?data-left="(\d+)"([^>]*)>[\s\S]*?<b class="mi-n" aria-hidden="true">([^<]*)<\/b><\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    const tip = /data-mtip="([^"]*)"/.exec(m[5]);
    out.push({ kind: m[1], type: m[2], last: !!m[3], left: Number(m[4]), n: m[6], tip: tip ? JSON.parse(unent(tip[1])) : null });
  }
  return out;
}

test("图标：五种机制五个不同的形状；角上的数字 = 还有几回合，本回合落下写「!」、标成最后一回合；图标上不写机制名字", () => {
  const glyphs = TYPES.map(t => UnitCard.MECH_ICON[t].glyph);
  assert.equal(new Set(glyphs).size, TYPES.length, "形状互不相同（不只靠颜色）");
  assert.equal(new Set(TYPES.map(t => UnitCard.MECH_ICON[t].color)).size, TYPES.length);
  for (const type of TYPES) {
    const h = UnitCard.mechIcon({ type, name: NAME[type], left: 2, phase: "enemy", by: "亡命之王", need: 1, have: 0, target: "3区" }, "mark");
    const [ico] = icons(h);
    assert.deepEqual([ico.kind, ico.type, ico.left, ico.n, ico.last], ["mark", type, 2, "2", false], type);
    assert.ok(h.includes(UnitCard.MECH_ICON[type].glyph), type + " 用自己的图形");
    assert.equal(visible(h), "2", type + "：图标上只有数字，没有「" + NAME[type] + "」这样的字");
    assert.match(h, new RegExp(`aria-label="${NAME[type]}：还有 2 回合"`), "读屏能读到名字和回合");
  }
  const now = icons(UnitCard.mechIcon({ type: "execution", name: "死刑", left: 0, phase: "enemy" }, "mark"))[0];
  assert.deepEqual([now.left, now.n, now.last], [0, "!", true]);
  // 「最后一回合」= 落下之前我方只剩这一回合：敌人回合开始时落下的看「本回合」，我方回合开始时落下的看「还有 1 回合」
  assert.equal(UnitCard.mechLast({ left: 1, phase: "enemy" }), false);
  assert.equal(UnitCard.mechLast({ left: 1, phase: "player" }), true);
  assert.equal(UnitCard.mechLast({ left: 2, phase: "player" }), false);
  // 首领读条的图标：同一个形状，换成深底（k-cast），名字带上点名对象
  const cast = icons(UnitCard.mechIcon({ type: "execution", name: "死刑", left: 3, phase: "enemy", target: "柯尔特" }, "cast"))[0];
  assert.deepEqual([cast.kind, cast.n, cast.tip.name], ["cast", "3", "死刑 → 柯尔特"]);
  // 不认识的机制也画得出来（感叹号）
  assert.equal(icons(UnitCard.mechIcon({ type: "laser", name: "激光", left: 1, phase: "enemy" }, "mark")).length, 1);
  // 横幅里的小图标不带数字和说明
  const bar = UnitCard.mechIcon({ type: "share", name: "分担", left: 1, phase: "enemy" }, "bar");
  assert.doesNotMatch(bar, /mi-n|data-mtip/);
});

test("悬停说明：机制名字、剩几回合、会发生什么（markTip / castTip / towerTip 的文字）、怎么应对", () => {
  const share = UnitCard.mechTip({ type: "share", name: "分担", left: 2, phase: "enemy", by: "亡命之王", pool: 40, group: 2 }, "mark");
  assert.equal(share.name, "分担");
  assert.equal(share.left, "还有 2 回合");
  assert.equal(share.when, "到时在敌人回合开始时落下");
  assert.match(share.what, /^亡命之王 的分担：2 回合后落下。伤害池 40，由这个人所在区的所有友方平均分担，不能格挡/);
  assert.match(share.what, /每人约 20/);
  assert.match(share.how, /聚到他所在的区一起扛/);
  assert.match(share.how, /推迟一回合/);
  const spread = UnitCard.mechTip({ type: "spread", name: "远离", left: 1, phase: "enemy", by: "王", blast: 10, stack: 2 }, "mark");
  assert.match(spread.what, /现在这里有 2 个标记，每人会挨 2 次/);
  assert.match(spread.how, /分开站/);
  const exec = UnitCard.mechTip({ type: "execution", name: "死刑", left: 3, phase: "enemy", by: "王" }, "mark");
  assert.match(exec.what, /每一段都可以协助格挡/);
  assert.match(exec.how, /协助格挡/);
  const volley = UnitCard.mechTip({ type: "volley", name: "齐射", left: 0, phase: "enemy", by: "王", shot: "1×atk + 1d8", brk: 2, mates: 1 }, "mark");
  assert.equal(volley.left, "本回合落下");
  assert.match(volley.how, /站在一起/);
  const tower = UnitCard.mechTip({ type: "tower", name: "踩塔", left: 0, phase: "enemy", by: "王", need: 2, have: 1, soak: 5, fail: 60 }, "zone");
  assert.match(tower.what, /至少 2 人站在这个区里踩住，每人挨 5；没人踩住，我方全员各挨 60/);
  assert.match(tower.how, /凑够 2 个人站进这个区/);
  const cast = UnitCard.mechTip({ type: "spread", name: "远离", left: 4, phase: "enemy", target: "全员（3）" }, "cast");
  assert.equal(cast.name, "远离 → 全员");
  assert.match(cast.what, /^远离 → 全员（3）：4 回合后落下。被点名的每个人到时在自己所在的区爆炸一次/);
  const towerCast = UnitCard.mechTip({ type: "tower", name: "踩塔", left: 2, phase: "enemy", target: "3区、1区" }, "cast");
  assert.equal(towerCast.name, "踩塔 · 3 区、1 区");
  const html = UnitCard.mechTipHtml(share);
  for (const s of ["分担", "还有 2 回合", "到时在敌人回合开始时落下", "会发生什么", "伤害池 40", "怎么应对", "一起扛"]) assert.ok(html.includes(s), s);
  // 图标上带着这份说明（悬停 / 触屏点一下时显示）
  const ico = icons(UnitCard.mechIcon({ type: "share", name: "分担", left: 2, phase: "enemy", by: "亡命之王", pool: 40, group: 2 }, "mark"))[0];
  assert.deepEqual(ico.tip, share);
});

test("踩塔：区名旁边的图标数字 = 还有几回合，旁边写几人 / 要几人（人数不够标红），不写机制名字", () => {
  const h = UnitCard.towerMarkHtml([{ type: "tower", name: "踩塔", left: 2, need: 2, have: 1, by: "王", phase: "enemy", soak: 5, fail: 60 }]);
  const [ico] = icons(h);
  assert.deepEqual([ico.kind, ico.type, ico.left, ico.n], ["zone", "tower", 2, "2"]);
  assert.match(ico.tip.what, /至少 2 人站在这个区里踩住/);
  assert.match(h, /<span class="zt-need short">1\/2 人<\/span>/);
  assert.equal(visible(h), "21/2 人");
  assert.match(UnitCard.towerMarkHtml([{ type: "tower", name: "踩塔", left: 0, need: 1, have: 1, phase: "enemy" }]), /class="mech-ico k-zone t-tower last"[\s\S]*<span class="zt-need ok">1\/1 人<\/span>/);
});

test("横幅：每个首领正在读条的机制一条，按剩余回合排序（最紧急的在最上面，一样多的照原来的顺序），死掉的首领不算", () => {
  const units = [
    { id: "kolt", isPlayer: true, name: "柯尔特", marks: [{ type: "execution", name: "死刑", left: 2 }] },
    { id: "king", name: "亡命之王", casts: [
      { type: "execution", name: "死刑", left: 2, target: "柯尔特", phase: "enemy" },
      { type: "spread", name: "远离", left: 4, target: "全员（3）", phase: "enemy" },
      { type: "tower", name: "踩塔", left: 1, target: "3区", phase: "enemy" },
      { type: "share", name: "分担", left: 0, target: "瑞比", phase: "enemy" }] },
    { id: "boss2", name: "沙灵聚合体", casts: [{ type: "volley", name: "齐射", left: 2, target: "全员（2）", phase: "enemy" }] },
    { id: "gone", name: "倒下的首领", dead: true, casts: [{ type: "execution", name: "电能炮", left: 0, target: "瑞比", phase: "enemy" }] },
    { id: "prop:1", isProp: true, name: "铁壁", casts: [{ type: "share", name: "?", left: 0 }] }
  ];
  const items = UnitCard.bannerItems(units);
  assert.deepEqual(items.map(UnitCard.bannerText), ["分担 → 瑞比 · 本回合落下", "踩塔 · 3 区 · 1 回合", "死刑 → 柯尔特 · 2 回合", "齐射 → 全员 · 2 回合", "远离 → 全员 · 4 回合"]);
  assert.deepEqual(items.map(x => x.by), ["亡命之王", "亡命之王", "亡命之王", "沙灵聚合体", "亡命之王"]);
  assert.deepEqual(items.map(UnitCard.mechLast), [true, false, false, false, false], "只有本回合落下的那条是最后一回合");
  assert.equal(UnitCard.bannerText({ type: "tower", name: "踩塔", left: 2, target: "3区、1区" }), "踩塔 · 3 区、1 区 · 2 回合");
  assert.equal(UnitCard.bannerText({ type: "execution", name: "死刑", left: 2, target: "" }), "死刑 · 2 回合", "没有目标就不写箭头");
  assert.equal(UnitCard.bannerText({ type: "spread", name: "远离", left: 4, target: "全员(3)" }), "远离 → 全员 · 4 回合", "联机投影把全角括号规范成了半角，也一样写");
  assert.deepEqual(UnitCard.bannerItems([]), []);
});

/** 规则环境里摆一个首领，挂四种机制（死刑 3、分担 2、踩塔 2、远离 4 回合），开战 */
function bossField(seed, extra) {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "yuito", "ras"], enemies: [{ id: "thug_knife", lv: 5, zone: 2 }], seed });
  const S = c.S.state;
  const boss = S.units.find(u => !u.isPlayer);
  boss.layers.forEach(l => { l.current = l.max = 999; });
  S.units.filter(u => u.isPlayer).forEach(u => { u.layers.forEach(l => { l.current = l.max = 500; }); u.shp = 777001; });
  [{ type: "execution", turns: 3, hits: [{ flat: 1 }] }, { type: "share", turns: 2, pool: { flat: 2 } }, { type: "tower", turns: 2, soak: { flat: 1 }, fail: { kind: "raid", flat: 1 } }, { type: "spread", turns: 4, blast: { flat: 1 } }]
    .concat(extra || []).forEach(m => c.addBossMechanic(boss, m));
  c.startCombat();
  return { c, S, boss };
}
/** 主机 → 联机投影（online-view.js）→ 玩家端的单位快照（online-battle.js · snapUnit） */
function playerView(c, S) {
  Object.assign(globalThis, { state: S, bossMarksOn: c.bossMarksOn, bossCastsBy: c.bossCastsBy, bossZoneMarks: c.bossZoneMarks, statusLine: c.statusLine });
  try {
    for (const f of ["../online-view.js", "../online-battle.js"]) delete require.cache[require.resolve(f)];
    const OV = require("../online-view.js"), OB = require("../online-battle.js");
    const view = OV.projectState(S);
    return { view, snaps: view.units.filter(u => !u.hidden).map(OB.snapUnit) };
  } finally { for (const k of ["state", "bossMarksOn", "bossCastsBy", "bossZoneMarks", "statusLine", "OnlineView", "OnlineBattle"]) delete globalThis[k]; }
}

test("规则 → 显示：死刑 / 分担 / 远离 / 踩塔点名时，头顶图标类型对、数字对；横幅按剩余回合排好序；联机玩家拿到的数据画出来一样，不含坚毅生命", () => {
  const { c, S, boss } = bossField("MI-T");
  const { view, snaps } = playerView(c, S);
  assert.doesNotMatch(JSON.stringify(view), /777001|"shp"|坚毅/, "坚毅生命不进玩家数据");
  const mech = (t) => boss.mechanics.find(m => m.type === t);
  const name = (id) => S.units.find(u => u.id === id).name;
  // 首领头上：正在读条的四个机制（深底的 k-cast），数字 = 还有几回合
  const onBoss = icons(UnitCard.mechIconsHtml(snaps.find(s => s.id === boss.id)));
  assert.deepEqual(onBoss.map(i => [i.kind, i.type, i.n]), [["cast", "execution", "3"], ["cast", "share", "2"], ["cast", "tower", "2"], ["cast", "spread", "4"]]);
  assert.equal(onBoss[0].tip.name, "死刑 → " + name(mech("execution").st.targetId));
  // 被点名的人头上：死刑 / 分担各一个；远离是全员
  const on = (id) => icons(UnitCard.mechIconsHtml(snaps.find(s => s.id === id)));
  assert.ok(on(mech("execution").st.targetId).some(i => i.kind === "mark" && i.type === "execution" && i.n === "3"), "死刑点名的人头上有死刑图标，写 3");
  assert.ok(on(mech("share").st.targetId).some(i => i.kind === "mark" && i.type === "share" && i.n === "2"), "分担点名的人头上有分担图标，写 2");
  const heroes = S.units.filter(u => u.isPlayer && !u.hidden);
  for (const u of heroes) assert.ok(on(u.id).some(i => i.type === "spread" && i.n === "4"), u.name + " 头上有远离图标，写 4");
  assert.ok(!heroes.some(u => on(u.id).some(i => i.type === "tower")), "踩塔不放在单位头上");
  // 踩塔：被标记的区，区名旁边的图标
  const zone = mech("tower").st.zones[0];
  const zt = icons(UnitCard.towerMarkHtml(view.zoneView[String(zone)].towers));
  assert.deepEqual(zt.map(i => [i.kind, i.type, i.n]), [["zone", "tower", "2"]]);
  // 横幅：最紧急的在最上面
  const items = UnitCard.bannerItems(snaps);
  assert.deepEqual(items.map(UnitCard.bannerText), [
    `分担 → ${name(mech("share").st.targetId)} · 2 回合`, `踩塔 · ${zone} 区 · 2 回合`,
    `死刑 → ${name(mech("execution").st.targetId)} · 3 回合`, "远离 → 全员 · 4 回合"]);
});

test("机制落下以后横幅里那一条消失、头顶图标跟着没了；最后一回合（本回合落下）那条在最上面、标成最后一回合；首领倒下横幅清空", () => {
  const { c, S, boss } = bossField("MI-GONE", [{ type: "share", name: "砸地", turns: 1, then: "once", pool: { flat: 2 } }]);
  const once = boss.mechanics.find(m => m.name === "砸地");
  c.endPlayerTurn(); c.endEnemyTurn();
  let v = playerView(c, S);
  let items = UnitCard.bannerItems(v.snaps);
  assert.equal(UnitCard.bannerText(items[0]), `砸地 → ${S.units.find(u => u.id === once.st.targetId).name} · 本回合落下`);
  assert.equal(UnitCard.mechLast(items[0]), true);
  const target = once.st.targetId;
  const mark = icons(UnitCard.mechIconsHtml(v.snaps.find(s => s.id === target))).find(i => i.tip && i.tip.name === "砸地");
  assert.deepEqual([mark.n, mark.last], ["!", true], "被点名的人头上写「!」并脉动");
  c.endPlayerTurn(); c.endEnemyTurn();   // 敌人回合开始时落下（then: once，不再标记）
  assert.equal(once.st.done, true);
  v = playerView(c, S);
  items = UnitCard.bannerItems(v.snaps);
  assert.ok(!items.some(x => x.name === "砸地"), "落下以后横幅里没有这一条");
  assert.ok(items.length > 0, "别的机制还在");
  assert.ok(!v.snaps.some(s => icons(UnitCard.mechIconsHtml(s)).some(i => i.tip && /砸地/.test(i.tip.name))), "头顶的图标也没了");
  boss.dead = true;
  v = playerView(c, S);
  assert.deepEqual(UnitCard.bannerItems(v.snaps), [], "首领倒下：横幅清空");
  assert.ok(v.snaps.every(s => UnitCard.mechIconsHtml(s) === ""), "首领倒下：谁头上都没有图标");
});
