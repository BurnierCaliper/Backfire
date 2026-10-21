// HD-2D 战场原型（prototypes/hd2d/）· 主人试玩反馈 · 二（#238）：界面。
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
const L = require("../prototypes/hd2d/hd2d-layout.js");
const OV = require("../online-view.js");

// 缺这个文件时只是用到它的那几条失败（每条测试里各自 require）
const ui = () => require("../prototypes/hd2d/hd2d-ui.js");

const DIR = path.join(__dirname, "..", "prototypes", "hd2d");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
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
  assert.ok(page.indexOf('<script src="hd2d-ui.js"></script>') > 0 && page.indexOf('<script src="hd2d-ui.js"></script>') < page.indexOf('<script type="module">'), "页面加载 hd2d-ui.js");
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
  // 页面：队伍栏用投影过的单位（players() 读 pv）排效果，加载 hud-icons.js / hud-icons.css；名字右边
  const page = read("index.html"), mod = /<script type="module">([\s\S]*?)<\/script>/.exec(page)[1];
  assert.ok(/function players\(\) \{ return \(pv \? pv\.units : \[\]\)/.test(mod), "队伍栏的人从投影里来");
  assert.ok(/UIX\.effectsHtml\(UIX\.effectsOf\(u, window\.HudIcons\)/.test(mod), "队伍栏排效果");
  assert.ok(/class="nm-t">[^`]*<span class="lv">[^`]*\$\{fx\}<\/div>/.test(mod), "效果在名字（和等级）的右边");
  assert.ok(page.includes('<script src="../../hud-icons.js"></script>') && page.includes('<link rel="stylesheet" href="../../hud-icons.css">'), "加载 hud-icons");
  const css = read("hd2d.css");
  assert.ok(/\.pm-fx:hover \.pm-fx-all, \.pm-fx:focus \.pm-fx-all \{ display: grid;/.test(css), "悬停 / 键盘停上去展开全部");
});

/* ---------- 3. 按主职责的头像 ---------- */
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
  // 页面：头像按投影里的 kit 查（不再是写着名字第一个字的圆圈），资料来自角色卡；CSS 是贴纸风（白边 + 墨线）
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(read("index.html"))[1];
  assert.ok(/UIX\.avatarHtml\(UIX\.avatarOf\(LOOKS\[u\.kit\]/.test(mod) && /UIX\.heroLooks\(typeof livePartyCards === "function" \? livePartyCards\(\) : \[\], typeof ELE_BY_CN/.test(mod), "头像按 kit 查角色卡上的职责和属性");
  assert.ok(!/class="face">\$\{esc\(p\.name\.slice\(0, 1\)\)\}/.test(mod), "不再是名字第一个字的圆圈");
  const css = read("hd2d.css");
  assert.ok(/\.av-ic \.rim \* \{[^}]*stroke: var\(--canvas\)/.test(css) && /\.av-ic \.ink \* \{[^}]*stroke: var\(--ink\)/.test(css), "白边 + 墨线");
});
