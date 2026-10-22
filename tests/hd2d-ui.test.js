// HD-2D 战场原型（模块在 hd2d/，原型页在 prototypes/hd2d/）· 主人试玩反馈 · 二（#238）：界面。
// 铭牌补上行动点 / 附赠动作、队伍栏名字右边的效果、按主职责的头像（主副属性色渐变）、技能按钮照旧画面（属性 / 攻击-技能两个角标）、
// 唤出武器人单独做大按钮。数据只读联机投影过的（online-view.js 的白名单），坚毅生命（shp）的数值绝不出现。
// 都是 Node 能跑的：界面数据是纯函数（hd2d-ui.js），房主那边用 tests/headless.js 的规则环境；画面截图由仓库主人跑。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");
const HP = require("./hd2d-paths");
const L = require("../hd2d/hd2d-layout.js");
const OV = require("../online-view.js");

// 缺这个文件时只是用到它的那几条失败（每条测试里各自 require）
const ui = () => require("../hd2d/hd2d-ui.js");

/** 战场的模块在正式目录 hd2d/（#261）；原型页 index.html 在 prototypes/hd2d/；hd2d.css 读原型页加载的那两份（正式的战场样式 + 原型的界面外壳） */
const read = (f) => (f === "index.html" ? HP.readPage(f) : f === "hd2d.css" ? HP.protoCss() : HP.readMod(f));
const PARTY = ["kolt", "helu", "ruby", "yuito"];
const DESKTOP = { width: 1440, height: 900, top: 46, bottom: 160 };
const SHP = 7771, SHP_MAX = 7772;
const gapOf = (type, hp, open) => ({ type, hp: hp || 0, maxHp: hp || 0, open: open !== false, lastFrom: null });
const plain = (v) => JSON.parse(JSON.stringify(v));

/** 三个演示战场（和 index.html 的 DEMOS 一样：区域、光影写进战斗状态，几个单位挂上状态） */
const DEMOS = {
  mine(S) {
    const st = S.setup({ party: PARTY, zoneMode: 3, seed: "hd2d-mine", region: "第一采矿场", light: "dusk", enemies: [{ id: "guard_sword", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 3 }, { id: "thug_hammer", lv: 2, zone: 2 }, { id: "boomcar", lv: 2, zone: 2 }] });
    st.fields[2].acid = true; st.fields[3].highland = true; st.gaps["1-2"] = gapOf("bridge", 12); st.gaps["2-3"] = gapOf("wall", 20, false);
    st.units.find(u => u.kit === "kolt").statuses.burn = 2; st.units.find(u => u.kit === "guard_gun").statuses.shock = true;
    return st;
  },
  desert(S) {
    const st = S.setup({ party: PARTY, board: "square4", weather: "sand", seed: "hd2d-desert", region: "沙漠", light: "day", enemies: [{ id: "sandfish_ambush", lv: 2, zone: 1 }, { id: "sandfish_lead", lv: 2, zone: 2 }, { id: "sand_beast", lv: 2, zone: 4 }, { id: "sand_human", lv: 2, zone: 4 }] });
    st.fields[1].quicksand = true; st.fields[4].coral = true; st.gaps["1-3"] = gapOf("void"); st.gaps["2-4"] = gapOf("bridge", 10);
    st.units.find(u => u.kit === "sand_human").statuses.corr = true; st.units.find(u => u.kit === "helu").statuses.inspire = true;
    return st;
  },
  cross(S) {
    const st = S.setup({ party: PARTY, board: "cross5", weather: "thunder", seed: "hd2d-cross", region: "外城区", light: "night", enemies: [{ id: "crow", lv: 2, zone: 1 }, { id: "buoy", lv: 2, zone: 1 }, { id: "thug_hammer", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 4 }] });
    st.fields[1].abyss = true; st.fields[2].highland = true; st.fields[3].electric = true; st.fields[4].acid = true;
    st.gaps["1-3"] = gapOf("void"); st.gaps["2-3"] = gapOf("door", 0, false); st.gaps["3-4"] = gapOf("bridge", 12);
    st.units.find(u => u.kit === "buoy").statuses.shock = true; st.units.find(u => u.kit === "guard_gun").stunned = true;
    return st;
  }
};
/** 在规则环境里摆一个演示战场，每个单位塞上特殊的坚毅生命数（找得到就是漏了）；pv() = 联机玩家拿到的那一份（和原型页一样在规则环境里投影） */
function demo(id) {
  const ctx = H.load();
  const st = DEMOS[id](ctx.BattleSim);
  st.units.forEach(u => { u.shp = SHP; u.shpMax = SHP_MAX; u.baseShp = SHP; });
  if (!ctx.OnlineView) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "online-view.js"), "utf8"), ctx, { filename: "online-view.js" });
  return { ctx, st, pv: () => ctx.OnlineView.projectState(st, { itemCatalog: ctx.ITEM_CATALOG || {} }) };
}
/** 投影后的东西里不能有坚毅生命（upOnShp 是给玩家看的「起身」开关，只有 true / false，不是数值） */
function noShp(x, tag) {
  const s = (typeof x === "string" ? x : JSON.stringify(x)).replace(/"upOnShp":(true|false)/g, "");
  assert.ok(!/shp|坚毅生命/i.test(s), tag + "：出现了坚毅生命");
  assert.ok(!s.includes(String(SHP)) && !s.includes(String(SHP_MAX)), tag + "：出现了坚毅生命的数值");
}
/** online-view.js · projectUnit 放行的单位字段（白名单）：从源码里的 copyFields / identifiers / out.xxx = 读出来 */
function projectedUnitFields() {
  const src = fs.readFileSync(path.join(__dirname, "..", "online-view.js"), "utf8");
  const body = src.slice(src.indexOf("function projectUnit("), src.indexOf("function projectHud("));
  const out = new Set();
  const first = /identifiers\(unit, \{\}, \[([^\]]*)\]\)/.exec(body);
  const copy = /copyFields\(unit, out, \[([^\]]*)\], \[([^\]]*)\], \[([^\]]*)\]\)/.exec(body);
  assert.ok(first && copy, "找得到 projectUnit 的白名单");
  [first[1], copy[1], copy[2], copy[3]].forEach(list => [...list.matchAll(/"(\w+)"/g)].forEach(m => out.add(m[1])));
  [...body.matchAll(/\bout\.(\w+)\s*=/g)].forEach(m => out.add(m[1]));
  return out;
}
/** 一个函数的源码（按名字从文件里截出来：到下一个顶层 function 为止） */
function fnSource(src, name) {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at >= 0, "找得到 " + name);
  const next = src.indexOf("\n  function ", at + 10);
  return src.slice(at, next > 0 ? next : undefined);
}

/* ---------- 1. 铭牌补上行动点 / 附赠动作 ---------- */
test("铭牌数据：有行动点 / 附赠动作（现有 / 上限），只从投影里的 ap / apMax / bonus / bonusMax 来；配置物这类不画；没有坚毅生命", () => {
  for (const id of Object.keys(DEMOS)) {
    const d = demo(id);
    // 有人用掉了行动点、有人用掉了附赠，有人多一个行动点（单人模式的 2 行动点）
    const ruby = d.st.units.find(u => u.kit === "ruby"), kolt = d.st.units.find(u => u.kit === "kolt"), helu = d.st.units.find(u => u.kit === "helu");
    ruby.ap = 0; kolt.bonus = 0; helu.apMax = 2; helu.ap = 2;
    const pv = d.pv();
    const out = L.build(pv, { view: DESKTOP, region: pv.region, theme: pv.light });
    assert.ok(out.units.length >= 6, id + "：排出来了");
    out.units.forEach(u => {
      const pu = pv.units.find(x => x.id === u.id);
      assert.ok(u.plate.econ, `${id}：${u.plate.name} 的铭牌上没有行动点 / 附赠`);
      assert.deepEqual(u.plate.econ, { ap: { cur: pu.ap, max: pu.apMax }, bonus: { cur: pu.bonus, max: pu.bonusMax } }, `${id}：${u.plate.name} 的行动点 / 附赠和投影里的不一样`);
      assert.ok(u.plate.text.includes(`行动点 ${pu.ap}/${pu.apMax}`) && u.plate.text.includes(`附赠 ${pu.bonus}/${pu.bonusMax}`), "铭牌文字里写着行动点 / 附赠");
      noShp(u.plate, `${id}：${u.plate.name} 的铭牌`);
    });
    const plateOf = (kit) => out.units.find(u => u.id === d.st.units.find(x => x.kit === kit).id).plate;
    assert.deepEqual(plateOf("ruby").econ, { ap: { cur: 0, max: 1 }, bonus: { cur: 1, max: 1 } }, "瑞比用掉了行动点");
    assert.deepEqual(plateOf("kolt").econ.bonus, { cur: 0, max: 1 }, "柯尔特用掉了附赠");
    assert.deepEqual(plateOf("helu").econ.ap, { cur: 2, max: 2 }, "两个行动点");
  }
  // 配置物、装置、间隔、中立生物：正式画面的卡片上本来就不画（game.css · .unit.prop / .unit.mini 的 .u-econ）
  ["isProp", "isDevice", "isGap", "neutral"].forEach(k => assert.equal(L.plateData({ id: "x", name: "x", ap: 1, apMax: 1, [k]: true }).econ, null, k));
  // 只读白名单里有的字段：plateData / econOf 读到的单位字段都在 projectUnit 的白名单里（没有就是绕开了白名单）
  const allowed = projectedUnitFields(), src = read("hd2d-layout.js");
  ["ap", "apMax", "bonus", "bonusMax", "isProp", "isDevice", "isGap", "neutral"].forEach(f => assert.ok(allowed.has(f), f + " 在白名单里"));
  ["econOf", "plateData"].forEach(fn => {
    const used = new Set([...fnSource(src, fn).matchAll(/\bu\.(\w+)/g)].map(m => m[1]));
    assert.ok(used.has("ap") || fn !== "econOf", "econOf 读的是 ap");
    used.forEach(f => assert.ok(allowed.has(f), `${fn} 读了白名单里没有的字段 u.${f}`));
  });
});

test("铭牌上画出行动点 / 附赠：紧凑铭牌贴在卡片右上角，近景放大的写在名字那一行；圆点 = 行动点、三角 = 附赠，用掉的是空的（照 unit-card.js）", () => {
  const U = ui();
  const econ = { ap: { cur: 1, max: 2 }, bonus: { cur: 0, max: 1 } };
  const small = U.econHtml(econ, false), big = U.econHtml(econ, true);
  const count = (h, re) => (h.match(re) || []).length;
  for (const h of [small, big]) {
    assert.equal(count(h, /<i class="ap/g), 2, "两个行动点");
    assert.equal(count(h, /<i class="ap on"/g), 1, "还剩一个行动点");
    assert.equal(count(h, /<i class="bn/g), 1, "一个附赠");
    assert.equal(count(h, /<i class="bn on"/g), 0, "附赠用掉了");
    assert.ok(/aria-label="行动点 1\/2 · 附赠 0\/1"/.test(h), "读屏 / 悬停写着数");
  }
  assert.ok(/class="pl-econ"/.test(small) && /class="pl-econ in"/.test(big), "紧凑版和放大版各一种样子");
  // 和 unit-card.js 一样画 max(上限, 现有) 个（多出来的行动点也画）；太多就写数字；没有就不画
  assert.equal(count(U.econHtml({ ap: { cur: 3, max: 2 }, bonus: { cur: 0, max: 0 } }), /<i class="ap on"/g), 3);
  assert.ok(/行9\/9/.test(U.econHtml({ ap: { cur: 9, max: 9 }, bonus: { cur: 0, max: 0 } })), "太多就写数字");
  assert.equal(U.econHtml(null), "");
  assert.equal(U.econHtml({ ap: { cur: 0, max: 0 }, bonus: { cur: 0, max: 0 } }), "");
  // 场景的铭牌 HTML：紧凑卡片里、放大那张的名字那一行里都有，悬停展开的详情里写着数；不碰 shp
  const scene = read("hd2d-scene.js");
  const html = scene.slice(scene.indexOf("function plateHtml"), scene.indexOf("function makePlate"));
  const card = html.slice(html.indexOf('class="pl-card"')), r1 = html.slice(html.indexOf('class="pl-r1"'), html.indexOf('class="pl-r2"'));
  assert.ok(/econHtml\(p\.econ/.test(html) && /econ\(false\)/.test(card) && /econ\(true\)/.test(r1), "紧凑铭牌、放大铭牌都画行动点 / 附赠");
  assert.ok(/econText/.test(html.slice(html.indexOf('class="pl-more"'), html.indexOf('class="pl-big"'))), "悬停展开的详情里写着行动点 / 附赠");
  assert.ok(!/shp/i.test(html));
  const css = read("hd2d.css");
  assert.ok(/\.pl-econ \{[^}]*position: absolute[^}]*top: -\d+px/.test(css) && /\.pl-econ\.in \{[^}]*position: static/.test(css), "紧凑版贴在卡片上沿，放大版在名字那一行");
  assert.ok(/\.pl-econ i\.ap \{[^}]*border-radius: 50%/.test(css) && /\.pl-econ i\.bn \{[^}]*border-bottom: 6px solid/.test(css), "圆点和三角");
  // 页面在场景之前加载 hd2d-ui.js
  const page = read("index.html");
  const tag = `<script src="${HP.pageSrc("hd2d-ui.js")}"></script>`;   // 从原型页指到正式目录 hd2d/（#261）
  assert.ok(page.indexOf(tag) > 0 && page.indexOf(tag) < page.indexOf('<script type="module">'), "页面加载 hd2d-ui.js");
});

/* ---------- 2. 队伍栏：名字右边身上的效果 ---------- */
const HI = () => require("../hud-icons.js");
test("队伍栏的效果：投影里的状态 / 即时效果 / 濒死 / 失衡……排成一列（hud-icons.js 的图标 + 没图标的短标签），角色自己的仪表读数不算；多了写 +n，悬停看全部；没有坚毅生命", () => {
  const U = ui(), icons = HI();
  const d = demo("mine");
  const unit = (kit) => d.st.units.find(u => u.kit === kit);
  Object.assign(unit("kolt"), { dying: true }); unit("kolt").statuses.inspire = true; unit("kolt").instant = { melt: true };   // 灼烧 2 是演示本来就有的
  unit("ruby").stunned = true; unit("ruby").tauntTo = unit("kolt").id;
  const pv = d.pv();
  const pu = (kit) => pv.units.find(u => u.id === unit(kit).id);
  const kolt = U.effectsOf(pu("kolt"), icons);
  assert.deepEqual(kolt.map(e => e.name), ["濒死", "灼烧", "振奋", "熔融"], "柯尔特：濒死在最前面，然后是有图标的灼烧 / 振奋 / 熔融；状态文字里的「电钻」是刀头，不算效果");
  assert.equal(kolt.find(e => e.key === "burn").stack, "2", "灼烧带层数");
  assert.ok(kolt.filter(e => e.icon).every(e => icons.ICONS[e.key]) && !kolt.find(e => e.key === "dying").icon, "有图标的用 hud-icons 的徽章，濒死写字");
  const ruby = U.effectsOf(pu("ruby"), icons);
  assert.deepEqual(ruby.map(e => e.name), ["失衡", "嘲讽"], "瑞比：失衡 + 状态文字里没图标的嘲讽");
  assert.deepEqual(U.effectsOf(pu("yuito"), icons), [], "结人身上什么都没有");
  // 没有 hud-icons.js 时只写短标签（状态文字里一段一段的）
  assert.ok(U.effectsOf(pu("kolt"), null).every(e => !e.icon) && U.effectsOf(pu("kolt"), null).some(e => e.name === "灼烧×2"));
  // 画出来：最多 UI.effects.show 个，多的写 +n；悬停的那一块列出全部（名字 + 层数）；读屏也念全部
  const html = U.effectsHtml(kolt, icons);
  const head = html.slice(0, html.indexOf('class="pm-fx-all"')), all = html.slice(html.indexOf('class="pm-fx-all"'));
  assert.equal(U.UI.effects.show, 3);
  assert.equal((head.match(/class="hi-badge /g) || []).length + (head.match(/class="fx-t/g) || []).length, 3, "名字右边摆 3 个");
  assert.ok(/class="fx-more">\+1</.test(head), "多的写 +1");
  assert.ok(["濒死", "灼烧 2", "振奋", "熔融"].every(n => all.includes(`<b>${n}</b>`)), "悬停看全部");
  assert.ok(/aria-label="身上的效果：濒死、灼烧 2、振奋、熔融"/.test(html) && /tabindex="0"/.test(html), "键盘停上去也能看，读屏念全部");
  assert.equal(U.effectsHtml([], icons), "", "没有效果就什么都不画");
  assert.ok(!/fx-more/.test(U.effectsHtml(ruby, icons)), "两个就不写 +n");
  pv.units.forEach(u => noShp(U.effectsHtml(U.effectsOf(u, icons), icons), "效果"));
  // 只读投影：冻住的投影单位照样排得出来；读到的单位字段都在白名单里
  const frozen = JSON.parse(JSON.stringify(pu("kolt")));
  (function deepFreeze(o) { Object.freeze(o); Object.values(o).forEach(v => { if (v && typeof v === "object" && !Object.isFrozen(v)) deepFreeze(v); }); })(frozen);
  assert.deepEqual(U.effectsOf(frozen, icons).map(e => e.name), kolt.map(e => e.name));
  const allowed = projectedUnitFields(), src = read("hd2d-ui.js");
  new Set([...fnSource(src, "effectsOf").matchAll(/\bu\.(\w+)/g)].map(m => m[1])).forEach(f => assert.ok(allowed.has(f), "effectsOf 读了白名单里没有的 u." + f));
  U.UI.effects.flags.forEach(f => assert.ok(allowed.has(f.key), f.key + " 在白名单里"));
  // 页面：队伍栏用投影过的单位（players() 读 pv）排效果，加载 hud-icons.js / hud-icons.css；名字右边。
  // 一个人里面画什么挪进了 hd2d-ui.js · partyInner（#297：正式画面的新画面同一份），原型页按投影里的单位调它
  const page = read("index.html"), mod = /<script type="module">([\s\S]*?)<\/script>/.exec(page)[1];
  assert.ok(/function players\(\) \{ return \(pv \? pv\.units : \[\]\)/.test(mod), "队伍栏的人从投影里来");
  assert.ok(/UIX\.partyInner\(u, SHELL\.lookOf\(u, LOOKS\), \{ icons: window\.HudIcons \}\)/.test(mod), "队伍栏排效果（hd2d-ui.js · partyInner）");
  const inner = fnSource(read("hd2d-ui.js"), "partyInner");
  assert.ok(/effectsHtml\(effectsOf\(u, o\.icons\)/.test(inner), "partyInner 排效果");
  assert.ok(/class="nm-t">[^`]*<span class="lv">[^`]*\$\{tag\}\$\{fx\}<\/span>/.test(inner), "效果在名字（和等级）的右边");
  assert.ok(page.includes('<script src="../../hud-icons.js"></script>') && page.includes('<link rel="stylesheet" href="../../hud-icons.css">'), "加载 hud-icons");
  const css = read("hd2d.css");
  assert.ok(/\.pm-fx:hover \.pm-fx-all, \.pm-fx:focus \.pm-fx-all \{ display: grid;/.test(css), "悬停 / 键盘停上去展开全部");
});

/* ---------- 3. 按主职责的头像 ---------- */
test("主职责图标是主人定稿的那一套（10/22）：击破 = 右半完整、左半碎开飞溅（碎片 + 虚影），坦克 = 带拱窗的城塔，控场 = 三块菱形地台之间跳一个单位；碎片 / 虚影 / 洞的样式在 CSS 里", () => {
  const U = ui(), R = U.UI.roles;
  assert.ok(/class="solid frag"/.test(R["击破"]) && /class="ghost"/.test(R["击破"]), "击破：碎片 + 原轮廓的虚影");
  assert.ok(/A14 14 0 0 1/.test(R["击破"]), "击破：右半边还是完整的半圆");
  assert.ok(/class="hole"/.test(R["坦克"]), "坦克：城塔上挖出拱窗");
  assert.equal((R["控场"].match(/L\d+(?:\.\d+)? \d+(?:\.\d+)? L\d+(?:\.\d+)? \d+(?:\.\d+)? L\d+(?:\.\d+)? \d+(?:\.\d+)? Z/g) || []).length, 3, "控场：三块菱形地台");
  assert.ok(/<circle class="solid" cx="37" cy="16.5" r="5"\/>/.test(R["异常"]), "异常：分子环上一个节点亮着");
  const css = HP.protoCss();
  for (const cls of ["frag", "ghost", "hole", "cut"]) assert.ok(new RegExp("\\.stk \\.(rim|ink) \\." + cls).test(css), "CSS 有 ." + cls);
});

test("头像：每个主职责一个图标（职责用 growth.js · ROLE_LIST），底色是主属性 → 副属性的代表色从左上到右下渐变（属性色 = attack-fx.js 的 COL，主副属性照角色卡 note）", () => {
  const U = ui(), AF = require("../attack-fx.js");
  require("../icons.js");   // icons.js 没有 module.exports，挂在 globalThis.Icons 上
  const IC = globalThis.Icons;
  const ctx = H.load();
  const ROLES = plain(vm.runInContext("ROLE_LIST", ctx)), ELE = plain(vm.runInContext("ELE_BY_CN", ctx));   // 规则环境里的对象换成这边的（deepEqual 比原型）
  // 对应表在配置里：九种职责各一个、互不相同；属性色就是 attack-fx.js 的 COL，名字和 icons.js 一样
  assert.deepEqual(Object.keys(U.UI.roles).sort(), ROLES.slice().sort(), "每个主职责一个图标，职责名和游戏里一样");
  assert.equal(new Set(Object.values(U.UI.roles)).size, ROLES.length, "图标互不相同");
  assert.deepEqual(U.UI.elements, AF.COL, "属性色和 attack-fx.js 的 COL 一样");
  assert.deepEqual(U.UI.elementNames, IC.NAME, "属性名和 icons.js 一样");
  const cards = plain(ctx.livePartyCards());
  const looks = U.heroLooks(cards, ELE);
  const heroes = cards.filter(c => c.roles && !c.weaponOf);
  assert.ok(heroes.length >= 10, "角色卡都读到了");
  assert.deepEqual(Object.keys(looks).sort(), heroes.map(c => c.kit).sort(), "武器人不算");
  noShp(looks, "头像资料");   // 角色卡上有坚毅生命（shp），头像只拿职责和属性
  heroes.forEach(c => {
    const [main, sub] = c.note.split("·")[1].split("/").map(s => ELE[s.trim()]);
    const look = looks[c.kit], av = U.avatarOf(look);
    assert.ok(ROLES.includes(c.roles.primary), c.kit + " 的主职责在职责表里");
    assert.deepEqual(look, { role: c.roles.primary, main, sub }, c.kit + "：主职责 + 主 / 副属性（note 里斜杠前主、后副）");
    assert.equal(av.glyph, U.UI.roles[c.roles.primary], c.kit + "：按主职责的图标");
    assert.equal(av.background, `linear-gradient(to bottom right, ${AF.COL[main]}, ${AF.COL[sub]})`, c.kit + "：左上主属性色 → 右下副属性色");
    const html = U.avatarHtml(av);
    assert.ok(html.includes(`style="background:${av.background}"`) && html.includes('<g class="rim">') && html.includes('<g class="ink">'), c.kit + "：渐变底 + 白边墨线的贴纸图标");
    assert.ok(html.includes("主职责 " + c.roles.primary), c.kit + "：悬停写着主职责");
  });
  // 演示队伍：瑞比 直伤 能量→电、Helumica 环境手 谐波→物理、结人 辅助 冰→酸、柯尔特 坦克 电→酸
  const want = { ruby: ["直伤", "energy", "electric"], helu: ["环境手", "harmonic", "physical"], yuito: ["辅助", "ice", "acid"], kolt: ["坦克", "electric", "acid"] };
  Object.keys(want).forEach(k => assert.deepEqual([looks[k].role, looks[k].main, looks[k].sub], want[k], k));
  // 认不得的角色：人形图标 + 灰底；只有一种属性：纯色
  const none = U.avatarOf(null);
  assert.equal(none.glyph, U.UI.avatar.glyph);
  assert.equal(none.background, `linear-gradient(to bottom right, ${U.UI.avatar.fallback}, ${U.UI.avatar.fallback})`);
  assert.equal(U.avatarOf({ role: "坦克", main: "fire", sub: null }).background, `linear-gradient(to bottom right, ${AF.COL.fire}, ${AF.COL.fire})`);
  // 页面：头像按投影里的 kit 查（不再是写着名字第一个字的圆圈），资料来自角色卡；CSS 是贴纸风（白边 + 墨线）。
  // #297：查表、画头像挪进了 hd2d-shell.js · looks / lookOf 和 hd2d-ui.js · partyInner（正式画面的新画面同一份）
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(read("index.html"))[1];
  assert.ok(/const LOOKS = SHELL\.looks\(\);/.test(mod) && /SHELL\.lookOf\(u, LOOKS\)/.test(mod), "原型页的头像资料用共用的一份");
  const shellSrc = read("hd2d-shell.js");
  assert.ok(/UIX\(\)\.heroLooks\(list, map\)/.test(shellSrc) && /root\.livePartyCards\(\)/.test(shellSrc) && /typeof ELE_BY_CN !== "undefined" \? ELE_BY_CN/.test(shellSrc), "头像按 kit 查角色卡上的职责和属性");
  assert.ok(/avatarHtml\(avatarOf\(look \|\| null\)\)/.test(fnSource(read("hd2d-ui.js"), "partyInner")), "队伍栏一个人前面是头像");
  assert.ok(!/class="face">\$\{esc\(p\.name\.slice\(0, 1\)\)\}/.test(mod), "不再是名字第一个字的圆圈");
  const css = read("hd2d.css");
  assert.ok(/\.stk \.rim \* \{[^}]*stroke: var\(--canvas\)/.test(css) && /\.stk \.ink \* \{[^}]*stroke: var\(--ink\)/.test(css), "白边 + 墨线");
  assert.ok(/class="stk av-ic"/.test(U.avatarHtml(U.avatarOf(null))), "头像图标用贴纸风的画法");
});

/* ---------- 4 / 5. 技能按钮照旧画面；唤出武器人单独做大按钮 ---------- */
/** 规则环境里一个单位的技能（和原型页 renderSkills 一样：skillList + skillCost + SkillText 的说明） */
function rowsOf(ctx, u) {
  return plain(ctx.skillList(u).map(s => ({ id: s.id, name: s.name, hint: s.hint, text: ctx.SkillText.skillText(s.id) || s.hint, cost: ctx.skillCost(s.id) || {} })));
}
const effectWords = (ctx) => plain(vm.runInContext("CODEX_EFFECTS", ctx)).filter(e => e.element).map(e => [e.name, e.element]);
test("技能按钮：每个都有两个角标——左上角属性（icons.js 的属性图标，无属性是灰圈）、右上角攻击还是技能；按顺序轮流换颜色；悬停写名字、消耗、说明；属性 / 攻击-技能读得对", () => {
  const U = ui(); require("../icons.js"); const IC = globalThis.Icons;
  const d = demo("mine"), pv = d.pv(), CE = effectWords(d.ctx);
  const of = (kit) => d.st.units.find(u => u.kit === kit), view = (kit) => pv.units.find(u => u.id === of(kit).id);
  for (const kit of PARTY) {
    const bar = U.skillBar(rowsOf(d.ctx, of(kit)), view(kit), { effects: CE });
    assert.ok(bar.skills.length >= 2, kit + "：有技能按钮");
    bar.skills.forEach((b, i) => {
      assert.ok(b.element === null || U.UI.elements[b.element], `${kit} ${b.id}：属性认得`);
      assert.ok(["attack", "skill"].includes(b.kind), `${kit} ${b.id}：攻击还是技能`);
      assert.equal(b.tint, U.UI.skill.tints[i % U.UI.skill.tints.length], "按顺序轮流换颜色");
      const html = U.skillHtml(b, IC);
      assert.equal((html.match(/class="sk-el/g) || []).length, 1, b.id + "：一个属性角标");
      assert.equal((html.match(/class="sk-kind"/g) || []).length, 1, b.id + "：一个攻击 / 技能角标");
      assert.ok(html.startsWith(`<button class="sk t-${b.tint} k-${b.kind}"`), b.id + "：按钮样式照 game.js 的 .sk");
      if (b.element) assert.ok(html.includes(IC.element(b.element)) && html.includes(`style="color:${U.UI.elements[b.element]}"`), b.id + "：用 icons.js 的属性图标、属性色");
      else assert.ok(/class="sk-el none"/.test(html) && html.includes('title="无属性"'), b.id + "：无属性是灰圈");
      assert.ok(html.includes(`title="${U.UI.skill.kinds[b.kind].name}"`) && html.includes(U.stickerSvg(U.UI.skill.kinds[b.kind].glyph, "sk-k-ic")), b.id + "：攻击是剑、技能是齿轮");
      assert.ok(html.includes(U.esc(b.name)) && html.includes(U.esc(b.text.split("\n")[0])), b.id + "：悬停写着说明");
      assert.ok(/<span class="cost">/.test(html), b.id + "：消耗一行（行动 / 附赠 / 不耗行动）");
      noShp(html, b.id);
    });
  }
  // 读得对：几个有代表性的（提示文字 → 属性 / 攻击还是技能；例外表；跟着刀 / 引擎变的读投影里的单位）
  const pick = (id, hint) => ({ id, name: id, hint });
  const cases = [
    ["ruby_aa", "距离1 · 两次 0.5atk 能量 · 共 1 击破", "energy", "attack"],
    ["ruby_trigger", "距离1以内 · 施加高能", "energy", "skill"],
    ["ruby_short", "距离1以内 · 施加感电", "electric", "skill"],
    ["yuito_aa", "距离1 · 1atk 冰 +1击破 · 豆→液", "ice", "attack"],
    ["kolt_aa", "同区 · 0.3/0.3/0.4atk 三次电 · 共2击破", "electric", "attack"],
    ["helu_aa", "远距离 · 1atk 谐波 +1击破 · 有聚焦则打聚焦层", "harmonic", "attack"],
    ["naruto_frost", "同区 · 3 冰击破 · 打出失衡则收回，绯秋换鳴門胁构", "ice", "attack"],
    ["ras_flee", "移动1 → +20%能量 → 原区一名敌人 1atk 电（远距离）· 不触发借机攻击。不稳则移动不限", "electric", "attack"],
    ["chuan_wall", "耗1电能 · 同区挡伤盾 atk+1d6 装甲 · 电能≥3可多耗1加 atk 护盾", null, "skill"],
    ["chuan_whip", "距离1以内 · atk/2 能量 1击破 · +1电能 · 可耗1电能把自己拉到敌人区", "energy", "attack"],
    ["latte_ice", "天气变为雪天", "ice", "skill"],
    ["xia_prep", "附赠 · 下回合伤害骰 +1d6（每5级提高骰子）· 对复数攻击只生效一次", null, "skill"],
    ["role_breakwave", "附赠 · 同区架势=1（15级≤2）的敌人各 1 无属性击破", null, "attack"],
    ["role_halve", "行动点 · 造成当前架势一半击破 · 每场一次", null, "attack"],
    ["wing_boost", "不耗行动 · 每回合纳米多耗 20 · atk +20% · 普攻溅射倍率 +0.1 · 无人机攻击次数 +1", null, "skill"]
  ];
  cases.forEach(([id, hint, el, kind]) => {
    assert.equal(U.skillElement(pick(id, hint), null, CE), el, id + " 的属性");
    assert.equal(U.skillKind(pick(id, hint)), kind, id + "：攻击还是技能");
  });
  const blade = (b) => ({ resources: { blade: b } }), engine = (on) => ({ resources: { engine: on } });
  assert.equal(U.skillElement(pick("hiaki_aa", "按刀势：拔刀 1atk+1击破"), blade("niu"), CE), "fire", "绯秋拿丹生谷：火");
  assert.equal(U.skillElement(pick("hiaki_aa", "按刀势：拔刀 1atk+1击破"), blade("naruto"), CE), "ice", "绯秋拿鳴門：冰");
  assert.equal(U.skillElement(pick("hiaki_powder", "…另一把刀反击"), blade("niu"), CE), "ice", "粉落汤气用另一把");
  assert.equal(U.skillElement(pick("xia_aa", "近战 1d4+atk 物理 2击破 · 引擎时火焰 3击破"), engine(false), CE), "physical");
  assert.equal(U.skillElement(pick("xia_aa", "近战 1d4+atk 物理 2击破 · 引擎时火焰 3击破"), engine(true), CE), "fire", "夕夏引擎发动：火焰");
  // 例外表里写的都是游戏里真有的技能（party.js 的 skillList / roleSkillDef 里有）；跟着刀 / 引擎变的读的字段在投影的白名单里（resources.blade / engine）
  const partySrc = fs.readFileSync(path.join(__dirname, "..", "party.js"), "utf8");
  [].concat(Object.keys(U.UI.skill.kind), Object.keys(U.UI.skill.element), Object.keys(U.UI.skill.byState)).forEach(id => assert.ok(partySrc.includes(`id: "${id}"`), id + " 是游戏里的技能"));
  const ov = fs.readFileSync(path.join(__dirname, "..", "online-view.js"), "utf8");
  assert.ok(/enumField\(r, out\.resources, "blade", \["niu", "naruto"\]\)/.test(ov) && /resourceFlags = \[[^\]]*"engine"/.test(ov), "刀、引擎在投影的白名单里");
  // CSS：按钮照 game.js 的 .sk（铁板 + 墨线框），四种颜色，两个角
  const css = read("hd2d.css");
  assert.ok(/\.sk \{[^}]*border: 2px solid var\(--ink\)[^}]*border-left: 6px solid var\(--tint\)/.test(css), "按钮：墨线框 + 按技能换颜色的色条");
  U.UI.skill.tints.forEach(t => assert.ok(new RegExp(`\\.sk\\.t-${t} \\{ --tint:`).test(css), t + " 颜色有样式"));
  assert.ok(/\.sk \.sk-el \{[^}]*left: \d+px; top: \d+px/.test(css) && /\.sk \.sk-kind \{[^}]*right: -\d+px; top: -\d+px/.test(css), "属性在左上角、攻击 / 技能在右上角");
  assert.ok(/\.eicon \.o \* \{/.test(css), "属性图标的白边（照 game.css 的 .eicon）");
});

test("唤出武器人（唤出 / 收回 / 取回武器）单独做成大按钮，和「结束回合」放在一起、同一种样式，不在普通技能按钮里；原型的调试按钮收在一边", () => {
  const U = ui();
  const d = demo("mine"), pv = d.pv(), CE = effectWords(d.ctx);
  for (const kit of PARTY) {
    for (const lv of [1, 99]) {
      const u = Object.assign({}, d.st.units.find(x => x.kit === kit), { level: lv });
      const rows = rowsOf(d.ctx, u), bar = U.skillBar(rows, pv.units.find(x => x.kit === kit), { effects: CE });
      const summon = rows.find(r => /_summon$/.test(r.id));
      assert.ok(summon, `${kit} Lv${lv}：技能表里有唤出武器人`);
      assert.equal(bar.summon && bar.summon.id, summon.id, `${kit} Lv${lv}：唤出武器人是大按钮`);
      assert.equal(bar.summon.back, false);
      assert.ok(!bar.skills.some(b => U.isSummon(b.id)), `${kit} Lv${lv}：普通技能按钮里没有唤出 / 收回武器人`);
      assert.equal(bar.skills.length, Math.min(U.UI.skill.max, rows.length - 1), "别的技能都在");
      assert.ok(/唤出/.test(U.summonInner(bar.summon)) && U.summonInner(bar.summon).includes(U.UI.skill.summonIcon(false)), "大按钮：图标 + 名字 + 消耗（照 game.js · #g-summon）");
    }
  }
  // 武器人倒下以后是「取回武器」（先放它，同 game.js）；武器人自己的「收回为武器」也是大按钮
  const both = U.skillBar([{ id: "ruby_aa", name: "普通攻击", hint: "" }, { id: "ruby_summon", name: "唤出明特", hint: "" }, { id: "weapon_retrieve", name: "取回武器", hint: "" }], null);
  assert.equal(both.summon.id, "weapon_retrieve"); assert.equal(both.summon.back, true);
  assert.deepEqual(both.skills.map(b => b.id), ["ruby_aa"]);
  const mint = U.skillBar([{ id: "mint_steal", name: "电力夺取", hint: "" }, { id: "mint_return", name: "收回为武器", hint: "需与瑞比同区" }], null);
  assert.equal(mint.summon.id, "mint_return"); assert.equal(mint.summon.back, true);
  assert.equal(U.skillBar([{ id: "x_aa", name: "打", hint: "" }], null).summon, null, "没有武器人就没有大按钮");
  // 页面：#summon-btn 和 #end-turn 在同一块（.hud-side）、同一种样式（.bigbtn）；普通技能按钮在 #skills；调试按钮在 .dbg 里
  const page = read("index.html");
  const dock = page.slice(page.indexOf('<footer id="dock"'), page.indexOf("</footer>"));
  const side = dock.slice(dock.indexOf('<div class="hud-side">'), dock.indexOf("</div>", dock.indexOf('<div class="hud-side">')));
  assert.ok(/id="summon-btn"/.test(side) && /id="end-turn"/.test(side), "唤出武器人和结束回合在同一块");
  assert.ok(/class="bigbtn sumbtn" id="summon-btn"/.test(side) && /class="bigbtn endbtn" id="end-turn"/.test(side), "同一种大按钮样式");
  const skillsAt = dock.indexOf('<div class="skills" id="skills"></div>');   // #297：挂 .skills，按钮样式和正式画面的新画面共用（hd2d.css）
  assert.ok(skillsAt > 0 && skillsAt < dock.indexOf('<div class="hud-side">'), "普通技能在左、两个大按钮在右（照 game.html 的 .hud-row）");
  const dbg = dock.slice(dock.indexOf('<div class="dbg"'), dock.indexOf("</div>", dock.indexOf('<div class="dbg"')));
  ["demo-strike", "fx-speed", "push-toggle", "fx-skip"].forEach(id => assert.ok(dbg.includes(`id="${id}"`), id + " 收在原型调试那一块"));
  assert.ok(!/class="btn alt" id="demo-strike"/.test(page), "演示出招不再是大喷漆按钮");
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(page)[1];
  const render = mod.slice(mod.indexOf("function renderSkills"), mod.indexOf("\n}", mod.indexOf("function renderSkills")));
  assert.ok(/UIX\.skillBar\(rows, v,/.test(render) && /\$\("skills"\)\.innerHTML = bar\.skills\.map\(b => UIX\.skillHtml\(b, window\.Icons\)\)/.test(render), "普通技能按钮只画 bar.skills");
  assert.ok(/\$\("summon-btn"\)/.test(render) && /UIX\.summonInner\(s\)/.test(render) && /--el/.test(render), "唤出武器人画在大按钮上，颜色跟着主属性");
  assert.ok(/pv\.units\.find\(x => x\.id === actorId\)/.test(render), "属性跟着刀 / 引擎变的读投影里的单位");
  const css = read("hd2d.css");
  assert.ok(/\.bigbtn::before \{[^}]*filter: url\(#spray\)/.test(css) && /\.endbtn \{[^}]*--el: var\(--hazard\)/.test(css), "喷漆大按钮（照 skin.css 的 .summonbtn / .endturn）");
  assert.ok(/#dock\.collapsed \.hud-row \{ display: none; \}/.test(css), "收起技能栏时整行收起");
});

/* ---------- 6. 坚毅生命的数值绝不显示 ---------- */
test("坚毅生命（shp）：三个演示战场里铭牌、行动点、队伍栏的效果和头像、技能按钮、唤出武器人按钮都没有；hd2d-ui.js 的代码里不读 shp", () => {
  const U = ui(), icons = HI(); require("../icons.js");
  for (const id of Object.keys(DEMOS)) {
    const d = demo(id), pv = d.pv(), CE = effectWords(d.ctx);
    noShp(pv, id + " 的投影");
    const out = L.build(pv, { view: DESKTOP, region: pv.region, theme: pv.light });
    const looks = U.heroLooks(plain(d.ctx.livePartyCards()), plain(vm.runInContext("ELE_BY_CN", d.ctx)));
    let html = "";
    out.units.forEach(u => { html += U.econHtml(u.plate.econ, false) + U.econHtml(u.plate.econ, true) + JSON.stringify(u.plate); });
    pv.units.filter(u => u.isPlayer).forEach(u => {
      html += U.effectsHtml(U.effectsOf(u, icons), icons) + U.avatarHtml(U.avatarOf(looks[u.kit] || null));
      const raw = d.st.units.find(x => x.id === u.id), bar = U.skillBar(rowsOf(d.ctx, raw), u, { effects: CE });
      html += bar.skills.map(b => U.skillHtml(b, globalThis.Icons)).join("") + (bar.summon ? U.summonInner(bar.summon) : "");
    });
    noShp(html, id + " 的界面");
  }
  // 代码里（去掉注释）不出现 shp
  const code = read("hd2d-ui.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/shp|坚毅/i.test(code), "hd2d-ui.js 不读坚毅生命");
});
