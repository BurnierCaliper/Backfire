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
