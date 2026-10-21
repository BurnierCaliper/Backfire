// 首领机制的 FF14 式显示（issue #206）：被点名的人头上一个图标（每种机制一个形状，角上的大数字 = 还有几回合，本回合落下写「!」），
// 首领头上是它正在读条的机制；踩塔在区名旁边；战场正上方的横幅按剩余回合排序。铭牌上不写机制名字。
// 新点名的那一下（点名瞬间）：图标「啪」地弹出来、响一声提示音（unit-card.js · MECH_ALERT，sfx.js · Sfx.marker）。
// 这里测不需要浏览器的部分：图标 / 说明 / 横幅的内容，以及规则 → 单机快照 / 联机投影 → 画面这一串（联机数据不含坚毅生命）。
// 画面本身（位置、悬停、触屏、减少动态效果、真的弹出来）见 tests/boss-countdown-display.test.js 的浏览器测试。
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
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

/* ---------- 点名瞬间（MECH_ALERT）：新点名的图标弹一下 + 提示音 ---------- */
const mk = (type, left, extra) => Object.assign({ type, name: NAME[type], left, phase: "enemy", by: "亡命之王" }, extra);
/** 假的一排图标（alertNew 只用到 querySelectorAll / dataset / classList / animate）。
 *  paint(html) 和 unit-card.js · setHtml 一样：HTML 没变就不换节点，变了就整排换成新的 */
function fakeRow() {
  const row = { html: null, icons: [], querySelectorAll: sel => (sel === ".mech-ico[data-mkey]" ? row.icons : []) };
  row.paint = (html) => {
    if (row.html === html) return row;
    row.html = html;
    row.icons = [...html.matchAll(/<span class="mech-ico k-(\w+) t-(\w+)[^"]*"[^>]*?data-mkey="([^"]*)"/g)].map(m => {
      const cls = new Set();
      const ico = { kind: m[1], type: m[2], dataset: { mkey: unent(m[3]) }, anims: [],
        classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) },
        animate(frames, opts) { const a = { frames, opts, currentTime: 0 }; ico.anims.push(a); return a; } };
      return ico;
    });
    return row;
  };
  return row;
}
/** 装上假的音效（数 Sfx.marker 叫了几次；muted = 音效关着）、「减少动态效果」开关（still）、钟（clock 毫秒），跑完还原 */
function alertEnv(fn) {
  const env = { pings: 0, muted: false, still: false, clock: 1000 };
  const keep = ["Sfx", "matchMedia", "performance"].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  const put = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  put("Sfx", { enabled: () => !env.muted, marker: () => { env.pings++; return true; } });
  put("matchMedia", q => ({ matches: env.still && /prefers-reduced-motion:\s*reduce/.test(q) }));
  put("performance", { now: () => env.clock });
  try { return fn(env); }
  finally { keep.forEach(([k, d]) => { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }); }
}

test("点名瞬间：只认新出现的点名——第一次画只记下；一样的重画、倒计时减少、推迟一回合都不算；换人、拿掉再出现、落下以后马上重新点名算", () => {
  const fresh = (memo, list, kind) => UnitCard.mechFresh(memo, list, kind || "mark").map(x => x.type + (x.by === "亡命之王" ? "" : "@" + x.by));
  assert.deepEqual(fresh({}, [mk("execution", 3)]), [], "第一次画（读档、刚连进来）：已经有的点名只记下，不弹");
  const kolt = {};
  assert.deepEqual(fresh(kolt, []), []);
  assert.deepEqual(fresh(kolt, [mk("execution", 3)]), ["execution"], "新点名");
  assert.deepEqual(fresh(kolt, [mk("execution", 3)]), [], "一样的重画");
  assert.deepEqual(fresh(kolt, [mk("execution", 2)]), [], "倒计时减少");
  assert.deepEqual(fresh(kolt, [mk("execution", 2), mk("spread", 4)]), ["spread"], "又被另一个机制点名：只算新的那个");
  assert.deepEqual(fresh(kolt, [mk("execution", 2), mk("execution", 2, { by: "沙灵聚合体" }), mk("spread", 4)]), ["execution@沙灵聚合体"], "别的首领放的同名机制也是新的");
  assert.deepEqual(fresh(kolt, [mk("execution", 1), mk("spread", 3)]), []);
  assert.deepEqual(fresh(kolt, [mk("execution", 0), mk("spread", 2)]), [], "本回合落下（!）");
  assert.deepEqual(fresh(kolt, [mk("execution", 1, { delayed: true }), mk("spread", 2)]), [], "首领失衡推迟一回合（倒计时 +1）不算");
  assert.deepEqual(fresh(kolt, [mk("execution", 0), mk("spread", 1)]), []);
  assert.deepEqual(fresh(kolt, [mk("execution", 3), mk("spread", 1)]), ["execution"], "落下以后马上重新点名（倒计时 0 → 3）算新的一次");
  assert.ok(UnitCard.MECH_ALERT.jump >= 2, "推迟只 +1：往上跳 jump 回合以上才算重新点名");
  assert.deepEqual(fresh(kolt, [mk("spread", 1)]), [], "死刑转到别人身上");
  assert.deepEqual(fresh(kolt, [mk("execution", 3), mk("spread", 1)]), ["execution"], "又转回来（拿掉再出现）算");
  // 区名旁边的塔（zone）也算；首领头上的读条（cast）只记不算
  const zone = {}, boss = {};
  fresh(zone, [], "zone"); fresh(boss, [], "cast");
  assert.deepEqual(fresh(zone, [mk("tower", 2)], "zone"), ["tower"]);
  assert.deepEqual(fresh(boss, [mk("execution", 3, { target: "柯尔特" })], "cast"), []);
  assert.deepEqual(UnitCard.MECH_ALERT.kinds, ["mark", "zone"]);
});

test("点名瞬间：新点名的图标弹一下（关键帧、时长照 MECH_ALERT）并调用提示音；同一个点名再刷新、倒计时减少都不再弹 / 响；没弹完就被重画换掉的接着弹完、不再响；静音时不调用提示音；减少动态效果时不弹、声音照响；预演时什么都不做", () => alertEnv(env => {
  const A = UnitCard.MECH_ALERT, row = fakeRow();
  const paint = (marks, opts) => UnitCard.alertNew(row.paint(UnitCard.mechIconsHtml({ id: "kolt", name: "柯尔特", isPlayer: true, marks })), marks, "mark", opts || {}).map(x => x.type);
  const ico = (type) => row.icons.find(i => i.type === type);
  const step = (ms) => { env.clock += ms == null ? 1000 : ms; };
  const sp = (left, stack) => mk("spread", left, { blast: 8, stack: stack || 1 });
  // 第一次画：只记下
  assert.deepEqual(paint([mk("execution", 3)]), []);
  assert.equal(ico("execution").anims.length, 0);
  assert.equal(env.pings, 0);
  // 新点名：那一个图标弹一下（Web Animations，id mech-pop），调用一次提示音；别的图标不动
  step();
  assert.deepEqual(paint([mk("execution", 3), sp(4)]), ["spread"]);
  const [pop] = ico("spread").anims;
  assert.ok(pop && ico("spread").anims.length === 1, "弹了一下");
  assert.deepEqual([pop.opts.id, pop.opts.duration, pop.currentTime], ["mech-pop", A.ms, 0]);
  assert.deepEqual(pop.frames.map(f => f.offset), A.frames.map(f => f.at), "关键帧照配置");
  assert.deepEqual(pop.frames.map(f => [f.transform, f.opacity]), A.frames.map(f => [`translateY(${f.y}px) scale(${f.scale})`, f.alpha]));
  assert.ok(ico("spread").classList.contains("pop"), "弹出标记");
  assert.equal(ico("execution").anims.length, 0, "原来就有的图标不弹");
  assert.equal(env.pings, 1, "响一声");
  // 同一个点名再刷新：不再弹、不再响
  step(100);
  assert.deepEqual(paint([mk("execution", 3), sp(4)]), []);
  assert.equal(ico("spread").anims.length, 1);
  // 还没弹完（200 毫秒）就被重画换掉了（同区的标记数变了）：新的图标接着从 200 毫秒处弹完，不算新点名、不再响
  step(100);
  assert.deepEqual(paint([mk("execution", 3), sp(4, 2)]), []);
  assert.deepEqual(ico("spread").anims.map(a => a.currentTime), [200]);
  assert.equal(ico("execution").anims.length, 0);
  // 倒计时减少：不弹、不响
  step();
  assert.deepEqual(paint([mk("execution", 2), sp(3, 2)]), []);
  assert.ok(row.icons.every(i => !i.anims.length));
  assert.equal(env.pings, 1);
  // 静音（音效关着）：照样弹，不调用提示音
  env.muted = true; step();
  assert.deepEqual(paint([mk("execution", 2), sp(3, 2), mk("share", 2, { pool: 30, group: 1 })]), ["share"]);
  assert.equal(ico("share").anims.length, 1);
  assert.equal(env.pings, 1, "静音时不调用提示音");
  // 减少动态效果：不弹，声音照音效开关响
  env.muted = false; env.still = true; step();
  assert.deepEqual(paint([mk("execution", 2), sp(3, 2), mk("share", 2, { pool: 30, group: 1 }), mk("volley", 2, { shot: "1×atk", brk: 2, mates: 0 })]), ["volley"]);
  assert.ok(row.icons.every(i => !i.anims.length), "减少动态效果：不弹");
  assert.equal(env.pings, 2, "声音照响");
  // 预演（sim）：什么都不做，也不记；回到真的画面再看到这个点名才弹
  env.still = false; step();
  const more = [mk("execution", 2), sp(3, 2), mk("share", 2, { pool: 30, group: 1 }), mk("volley", 2, { shot: "1×atk", brk: 2, mates: 0 }), mk("execution", 2, { by: "沙灵聚合体" })];
  assert.deepEqual(paint(more, { sim: true }), []);
  assert.ok(row.icons.every(i => !i.anims.length));
  assert.equal(env.pings, 2);
  step();
  assert.deepEqual(paint(more), ["execution"]);
  assert.equal(row.icons.filter(i => i.anims.length).map(i => i.dataset.mkey).join(), "mark:execution:死刑:沙灵聚合体");
  assert.equal(env.pings, 3);
}));

test("点名瞬间：区名旁边新标出来的塔也弹一下、响一声（记在区上：没有塔时图标那一块拿掉了，下次标出来照样算新的）；首领头上的读条不弹", () => alertEnv(env => {
  const zone = {};
  const paintZone = (list) => {
    env.clock += 1000;
    const row = list.length ? fakeRow().paint(UnitCard.towerMarkHtml(list)) : null;   // 没有塔：区名旁边那一块拿掉（unit-card.js · paintTowers）
    return { row, fresh: UnitCard.alertNew(row, list, "zone", {}, zone).map(x => x.type) };
  };
  const tw = (left) => mk("tower", left, { need: 1, have: 0, soak: 5, fail: 60 });
  assert.deepEqual(paintZone([]).fresh, [], "第一次画");
  let z = paintZone([tw(2)]);
  assert.deepEqual(z.fresh, ["tower"]);
  assert.deepEqual(z.row.icons.map(i => [i.kind, i.anims.length]), [["zone", 1]]);
  assert.equal(env.pings, 1);
  z = paintZone([tw(1)]);
  assert.deepEqual([z.fresh, z.row.icons[0].anims.length, env.pings], [[], 0, 1], "倒计时减少不弹");
  paintZone([]);
  z = paintZone([tw(3)]);
  assert.deepEqual([z.fresh, z.row.icons[0].anims.length, env.pings], [["tower"], 1, 2], "塔落下、过后又标出来：算新的");
  // 首领：头上是正在读条的机制（casts），身上没有点名（marks）——和 unit-card.js · update 一样只拿 marks 去比，读条再多也不弹
  const row = fakeRow(), boss = (casts) => ({ id: "king", name: "亡命之王", marks: [], casts });
  const paintBoss = (casts) => { env.clock += 1000; const s = boss(casts); return UnitCard.alertNew(row.paint(UnitCard.mechIconsHtml(s)), s.marks, "mark", {}); };
  paintBoss([]);
  assert.deepEqual(paintBoss([mk("execution", 3, { target: "柯尔特" }), mk("tower", 2, { target: "1区" })]), []);
  assert.ok(row.icons.length === 2 && row.icons.every(i => i.kind === "cast" && !i.anims.length));
  assert.equal(env.pings, 2);
}));

test("规则 → 联机投影 → 玩家端：开战那一刻被点名的人（远离全员、死刑、分担）和区名旁边的塔弹出来、响一声；过一回合倒计时减少不弹不响；落下以后马上重新点名再弹；只用玩家收到的数据（不含坚毅生命）", () => alertEnv(env => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "yuito", "ras"], enemies: [{ id: "thug_knife", lv: 5, zone: 2 }], seed: "MA-T" });
  const S = c.S.state, boss = S.units.find(u => !u.isPlayer);
  boss.layers.forEach(l => { l.current = l.max = 999; });
  S.units.filter(u => u.isPlayer).forEach(u => { u.layers.forEach(l => { l.current = l.max = 500; }); u.shp = 777001; });
  [{ type: "execution", turns: 2, interval: 3, hits: [{ flat: 1 }] }, { type: "share", turns: 3, pool: { flat: 2 } },
    { type: "tower", turns: 2, interval: 3, soak: { flat: 1 }, fail: { kind: "raid", flat: 1 } }, { type: "spread", turns: 4, blast: { flat: 1 } }]
    .forEach(m => c.addBossMechanic(boss, m));
  // 玩家端画一帧：和 online-battle.js 一样，每张卡 / 每个区都走 unit-card.js（这里用假的一排图标），返回这一帧弹了哪些 [单位 id 或「N 区」, 机制]
  const rows = new Map(), zones = new Map(), of = (m, k) => m.get(k) || m.set(k, fakeRow()).get(k);
  const frame = () => {
    env.clock += 1000;
    const { view, snaps } = playerView(c, S);
    assert.doesNotMatch(JSON.stringify(view), /777001|"shp"|坚毅/, "玩家收到的数据里没有坚毅生命");
    const out = [];
    snaps.forEach(s => UnitCard.alertNew(of(rows, s.id).paint(UnitCard.mechIconsHtml(s)), s.dead || s.hidden ? [] : s.marks, "mark", {}).forEach(x => out.push([s.id, x.type])));
    for (let z = 1; z <= Number(S.zoneMode || 2); z++) {
      const towers = ((view.zoneView || {})[String(z)] || {}).towers || [];
      UnitCard.alertNew(towers.length ? fakeRow().paint(UnitCard.towerMarkHtml(towers)) : null, towers, "zone", {}, of(zones, z)).forEach(x => out.push([z + " 区", x.type]));
    }
    return out.map(p => p.join(":")).sort();
  };
  const mech = (t) => boss.mechanics.find(m => m.type === t);
  assert.deepEqual(frame(), [], "开战前：第一次画只记下");
  c.startCombat();
  const heroes = Array.from(mech("spread").st.targetIds);   // 远离点了全员；Array.from：规则环境（vm）里的数组换成这边的
  assert.equal(heroes.length, 3);
  assert.deepEqual(frame(), heroes.map(id => id + ":spread").concat([mech("execution").st.targetId + ":execution", mech("share").st.targetId + ":share", mech("tower").st.zones[0] + " 区:tower"]).sort(),
    "开战那一刻：远离点了全员、死刑、分担各一个人、一座塔");
  const pinged = env.pings;
  assert.ok(pinged >= 1, "响了提示音");
  assert.deepEqual(frame(), [], "再画一次：不弹");
  c.endPlayerTurn(); assert.deepEqual(frame(), [], "敌人回合");
  c.endEnemyTurn(); assert.deepEqual(frame(), [], "过一回合：倒计时减少");
  c.endPlayerTurn(); frame(); c.endEnemyTurn();
  assert.deepEqual(frame(), [], "本回合落下（!）：还是同一次点名");
  assert.equal(env.pings, pinged, "这几回合都没再响");
  c.endPlayerTurn();   // 敌人回合开始：死刑、踩塔落下，马上重新点名（倒计时 0 → 3）
  assert.deepEqual(frame(), [mech("execution").st.targetId + ":execution", mech("tower").st.zones[0] + " 区:tower"].sort(), "落下以后重新点名：再弹一次");
  assert.ok(env.pings > pinged, "再响一次");
}));

/** 无界面加载 sfx.js：假的 AudioContext 记下建了哪些声音节点（振荡器的波形、音高、起止，滤波器，音量包络） */
function loadSfx() {
  const nodes = [];
  const param = (value) => ({ value, events: [], setValueAtTime(v, t) { this.events.push(["set", v, t]); }, exponentialRampToValueAtTime(v, t) { this.events.push(["exp", v, t]); }, linearRampToValueAtTime(v, t) { this.events.push(["lin", v, t]); } });
  const node = (kind, extra) => { const n = Object.assign({ kind, connect() {}, disconnect() {} }, extra); nodes.push(n); return n; };
  let ac = null;
  class FakeAudioContext {
    constructor() { ac = this; this.currentTime = 0; this.state = "running"; this.sampleRate = 44100; this.destination = {}; }
    createDynamicsCompressor() { return node("comp", { threshold: param(0), ratio: param(1) }); }
    createGain() { return node("gain", { gain: param(1) }); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    createOscillator() { return node("osc", { type: "sine", frequency: param(440), start(t) { this.at = t; }, stop(t) { this.end = t; } }); }
    createBiquadFilter() { return node("filter", { type: "lowpass", frequency: param(350), Q: param(1) }); }
    createBufferSource() { return node("src", { start() {}, stop() {} }); }
    createConvolver() { return node("conv", {}); }
    resume() { return Promise.resolve(); }
  }
  const store = new Map();
  const win = { AudioContext: FakeAudioContext, addEventListener() {}, localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) } };
  win.window = win;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "sfx.js"), "utf8"), vm.createContext(win));
  return { Sfx: win.Sfx, nodes, ac: () => ac };
}

test("提示音（sfx.js · Sfx.marker）：很短的两声「叮」先低后高，音高、长短、音量都照 MARKER_PING，低通去掉刺耳的高频；同一刻好几个人被点名只响一声；音效关着时一点声音都不出", () => {
  const { Sfx, nodes, ac } = loadSfx();
  const P = Sfx.MARKER;
  assert.ok(P && P.notes.length === 2 && P.notes[0].freq < P.notes[1].freq, "两声，先低后高");
  assert.equal(Sfx.marker(), true);
  const osc = nodes.filter(n => n.kind === "osc");
  assert.deepEqual(osc.filter(o => o.type === "sine").map(o => o.frequency.events[0][1]), Array.from(P.notes, n => n.freq), "音高照配置");
  assert.deepEqual(osc.filter(o => o.type === "triangle").map(o => o.frequency.events[0][1]), Array.from(P.notes, n => n.freq * 2), "一点高八度的泛音");
  const end = Math.max(...osc.map(o => o.end)), last = Math.max(...P.notes.map(n => n.at + n.len));
  assert.ok(end <= last + 0.06 && end < 0.4, `短促：${end.toFixed(3)} 秒就全停了`);
  assert.ok(nodes.some(n => n.kind === "filter" && n.type === "lowpass" && n.frequency.value === P.lowpass), "低通");
  const peaks = nodes.filter(n => n.kind === "gain").flatMap(g => g.gain.events.filter(e => e[0] === "exp").map(e => e[1]));
  assert.ok(Math.abs(Math.max(...peaks) - P.gain) < 1e-9, "音量照配置");
  const n0 = nodes.length;
  assert.equal(Sfx.marker(), false, "同一刻再叫一次不叠（远离点全员也只响一声）");
  assert.equal(nodes.length, n0);
  ac().currentTime = P.throttle + 1;
  assert.equal(Sfx.marker(), true, "过了一会儿再有人被点名，照响");
  Sfx.setEnabled(false);
  ac().currentTime += P.throttle + 1;
  const n1 = nodes.length;
  assert.equal(Sfx.marker(), false, "音效关着不响");
  assert.equal(nodes.length, n1, "一个声音节点都不建");
});
