// #360：场上有下潜的沙漠中立生物时，本来在战场上点目标的技能改成弹出选择列表。
//   原因：game.js · allOnField 只认战场上有卡片的 id（候选里有一个没卡片就整步退回弹列表）；夜晚下潜的尘虫不画卡，折进区角的「沙下动静」，
//   而非谐波技能的候选名单（app.js · skillFlowSteps 里选单位的步骤、koltMeleeSwapTargets；game.js · candidateUnits）又把它们放了进来。
//   · 规则：下潜中的单位不能被选为目标，只有谐波攻击例外（effects.js · 下潜 / submergedPickOk，engine.js · SKILL_HITS_SUBMERGED）
//   · 画面：折进「沙下动静」、列表里点得到的也算在场上——谐波攻击的候选里有沙下的，照样在战场上点（点列表里那一行）；选目标时能选的那几行亮着
// 规则在 Node 里跑（tests/headless.js）；画面：小 DOM（tests/mini-dom.js）里解析 game.html 的 <body>，game.js 里选目标的那几段从源码抠出来，放进规则环境里跑。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");
const MD = require("./mini-dom");

const read = (f) => fs.readFileSync(path.join(H.ROOT, f), "utf8");
const settle = async (n) => { for (let i = 0; i < (n || 10); i++) await new Promise(r => setImmediate(r)); };
// 规则环境 / 抠出来的画面在 vm 里跑：拿出来比较的数组、对象先换成这边的（不然 deepEqual 比原型不相等）
const ids = (list) => Array.from(list || [], u => u.id);
const plain = (v) => JSON.parse(JSON.stringify(v));

/** 从源码里抠出一个函数（连着前面的 async；按大括号配对） */
function fnSrc(src, name) {
  let at = src.indexOf("function " + name + "(");
  assert.ok(at >= 0, "game.js 里有 " + name);
  if (src.slice(at - 6, at) === "async ") at -= 6;
  let i = src.indexOf("{", src.indexOf(")", at)), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(at, i + 1);
}

/** 一区里有敌人（刀手）+ 两只尘虫：夜晚开战，尘虫下潜（desert.js · desertBattleStart）。队伍四人都在 1 区 */
function battle() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu", "ruby", "tou"], zoneMode: 2, seed: "issue-360",
    enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "dust_bug", lv: 1, zone: 1 }, { id: "dust_bug", lv: 1, zone: 1 }] });
  c.LEDGER.clock = 22 * 60;
  c.startCombat();
  const st = c.S.state;
  st.combatPhase = "player";
  const bugs = st.units.filter(u => u.kit === "dust_bug"), thug = st.units.find(u => u.kit === "thug_knife");
  assert.ok(bugs.length === 2 && bugs.every(b => b.submerged && Number(b.zone) === 1), "两只尘虫在 1 区下潜");
  assert.equal(Number(thug.zone), 1);
  st.units.filter(u => u.isPlayer).forEach(u => { u.level = 10; assert.equal(Number(u.zone), 1); });   // 分步要用的技能都学会了
  return { c, st, bugs, thug, kit: (k) => c.findKit(k, st.units) };
}
/** 技能栏上的那一项（game.js · gameSkills 的样子：带上花费） */
function skill(R, u, id) {
  const s = R.c.skillList(u).find(x => x.id === id);
  assert.ok(s, u.name + " 有 " + id);
  return Object.assign({}, s, { cost: R.c.skillCost(id) || {} });
}

/* ---------- 1. 规则：候选名单 ---------- */
test("规则：非谐波技能分步里选单位的那几步没有下潜中的尘虫（以前全都有）；切刀追击的名单也没有；谐波的声波切割留着", () => {
  const R = battle(), { c, st, bugs, thug } = R;
  const kolt = R.kit("kolt"), helu = R.kit("helu"), ruby = R.kit("ruby"), tou = R.kit("tou");
  // 激活 / 传播要身上有状态的单位；规则干涉要分析过战场、取代别的场地（1 区原本是冻土）
  [thug].concat(bugs).forEach(u => { u.statuses = Object.assign(u.statuses || {}, { shock: true, burn: 1 }); });
  helu.resources.scanned = true;
  st.fields[1].ice = true;
  const cases = [
    ["ruby_trigger", ruby, {}, "target"], ["ruby_short", ruby, {}, "target"], ["wing_aa", ruby, {}, "target"], ["mint_steal", ruby, {}, "target"],
    ["yuito_espresso", ruby, { mode: "atk" }, "target"], ["role_activate", ruby, {}, "target"], ["role_spread", ruby, {}, "target1"],
    ["tou_aa", tou, {}, "target"], ["tou_taunt", tou, {}, "target"], ["tou_bash", tou, { dest: 1 }, "target"], ["tou_start", tou, { dest: 1 }, "target"],
    ["mochi_pounce", tou, {}, "target"], ["bili_magnet", tou, {}, "target"], ["berniel_dash", tou, {}, "carry"], ["xia_ram", tou, { dest: 1 }, "target"],
    ["kolt_swap", kolt, {}, "target"], ["torque_swap", kolt, {}, "swapTarget"], ["torque_strip", kolt, {}, "target"], ["torque_boost", kolt, { dest: 1 }, "target"],
    ["feat_shove", kolt, {}, "target"],
    ["ecmo_focus", helu, {}, "target"], ["ras_flee", helu, { dest: 2 }, "target"], ["helu_rule", helu, { dest: 1 }, "target"]
  ];
  cases.forEach(([id, actor, picks, key]) => {
    const step = c.skillFlowSteps(id, actor, picks).find(s => s.key === key);
    assert.ok(step && step.type === "unit", `${id} 有选单位的「${key}」这一步`);
    assert.ok(ids(step.units).includes(thug.id), `${id}：刀手照样能选`);
    assert.ok(!step.units.some(u => bugs.includes(u)), `${id}「${step.label}」：名单里不该有下潜中的尘虫`);
  });
  assert.deepEqual(ids(c.koltMeleeSwapTargets(kolt)), [thug.id], "换刀头的切刀追击（结算队列）只有刀手");
  // 谐波攻击：声波切割同区的那一步留着沙下的尘虫（打到就被迫浮上来 +1 击破）
  const sonic = c.skillFlowSteps("tou_sonic", tou, {}).find(s => s.key === "target1");
  assert.deepEqual(ids(sonic.units).sort(), [thug.id].concat(ids(bugs)).sort(), "声波切割：刀手和两只沙下的尘虫都能选");
  // 尘虫浮上来以后（不再下潜）照常能选
  bugs.forEach(b => { b.submerged = false; });
  assert.ok(bugs.every(b => ids(c.skillFlowSteps("ruby_trigger", ruby, {})[0].units).includes(b.id)), "浮上来的尘虫照常能选");
});

test("规则：联机 / 热座的分步校验（hotseat-validation.js · checkFlow 用同一份 skillFlowSteps）不收下潜中的尘虫；表里写明的是谐波攻击", () => {
  const R = battle(), { c, bugs, thug } = R;
  const ruby = R.kit("ruby");
  const units = c.skillFlowSteps("ruby_trigger", ruby, {})[0].units;
  assert.ok(!units.some(u => bugs.includes(u)) && ids(units).includes(thug.id));
  assert.equal(c.submergedPickOk(bugs[0], false), false, "下潜中：非谐波选不中");
  assert.equal(c.submergedPickOk(bugs[0], true), true, "下潜中：谐波攻击选得中");
  assert.equal(c.submergedPickOk(thug, false), true, "没下潜的照常");
  ["helu_aa", "mochi_roar", "tou_sonic", "tou_accuse", "vitas_slash", "helu_assist"].forEach(id => assert.equal(c.skillHitsSubmerged(id), true, id + " 是谐波攻击"));
  ["kolt_aa", "ruby_trigger", "tou_aa", "kolt_swap", "toString", "constructor"].forEach(id => assert.equal(c.skillHitsSubmerged(id), false, id + " 不是谐波攻击"));
});

/* ---------- 2. 画面：战场上点，还是弹列表 ---------- */
/**
 * 旧画面的战斗：game.html 的 <body> 解析进小 DOM，game.js 里选目标的那几段从源码抠出来（armSkill、结算队列 resolveQueues、pickUnit、queueFieldPick、
 * onCardClick、candidateUnits、allOnField、沙下动静的画法 paintSandStir 和标记），放进规则环境里跑。单位卡照 game.js · setView 摆：
 * 下潜的中立生物不画卡，折进区角的「沙下动静」（paintSandStir 真的画）。弹列表（openChoice）、出手（act / perform）换成记一笔的；
 * 预演（previewOf）换成「选了目标就不用再选」；新画面的标记（HD2DField.marks）记下来
 */
function screen(R) {
  const html = read("game.html");
  const P = MD.create(html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")));
  const g = read("game.js");
  const line = (n) => { const m = new RegExp("^  const " + n + " = .*$", "m").exec(g); return m ? m[0] : ""; };
  const need = ["esc", "el", "sumCur", "sumMax", "STIR_ICON", "fieldMarks", "abandoned"];
  need.forEach(n => assert.ok(line(n), "game.js 里有 " + n));
  // #360 才有的（没修的旧代码里没有：照样跑得起来，测试在断言上失败）
  const consts = need.concat(["inSandStir"]).map(line).filter(Boolean).join("\n");
  const fns = ["unitAlive", "skillCommand", "paintSandStir", "allOnField", "paintMarks", "gapNodes", "markTargets", "unmarkTargets", "disarm",
    "pickUnit", "canGiveUp", "queueFieldPick", "onCardClick", "candidateUnits", "armSkill", "resolveQueues"].map(n => fnSrc(g, n))
    .concat(["markStir", "stirRow"].filter(n => g.includes("function " + n + "(")).map(n => fnSrc(g, n))).join("\n");
  const log = { choices: [], acts: [], marks: [] };
  const V = { G: { depth: 0, arm: null, actorId: null, ended: false, sim: false, skip: false, battleGen: 0 }, log, answer: () => null };
  V.dequeue = (cmd) => {
    if (cmd.type === "koltSwapAnswer") R.st.koltSwapQueue.shift();
    if (cmd.type === "heluScanAnswer") R.st.heluScanQueue.shift();
  };
  const make = vm.runInContext(`(function (V, document) {
    const G = V.G, cards = new Map();
    const HD2DField = { marks: (m) => V.log.marks.push(JSON.parse(JSON.stringify(m))) }, window = { HD2DField };
    let choiceResolve = null;
    const $ = (id) => document.getElementById(id);
    const hotseat = () => false, touchUI = () => false, hudSoon = () => {}, refreshHud = () => {}, showPickBar = () => {}, clearPreview = () => {};
    const setHint = () => {}, flashHint = () => {}, defaultHint = () => "", blockReason = () => null, animActor = (id) => id, snapGaps = () => [];
    const targetName = (id) => (unitById(id) || { name: id }).name;
    const selectActor = () => {}, unitInfoBox = () => {}, onCardHover = () => {}, pickZoneByClick = () => false, pickZone = () => Promise.resolve(null);
    const skillThunk = (a, s, t, p) => ({ t: t || null, p: Object.assign({}, p) });
    const previewOf = (th) => ({ needsTarget: !th.t && !Object.keys(th.p).length, meaningful: true, units: new Map(), lines: [], reason: "" });
    // 弹列表：记下来，按 V.answer 回答（不答 = 取消）
    const openChoice = (title, text, options, cancel) => { V.log.choices.push({ title, values: options.map(o => o.value) }); return Promise.resolve(V.answer(title, options, cancel)); };
    const act = (cmd) => { V.log.acts.push(JSON.parse(JSON.stringify(cmd))); return Promise.resolve(true); };
    // 结算队列的回答：记下来，队首拿掉（规则层结算时也是先出队）
    const perform = (cmd) => { V.log.acts.push(JSON.parse(JSON.stringify(cmd))); V.dequeue(cmd); return Promise.resolve([]); };
    const systemCommand = (cmd) => { V.log.acts.push(JSON.parse(JSON.stringify(cmd))); V.dequeue(cmd); };
    ${consts}
    ${fns}
    /** 照 game.js · setView 摆单位卡（点卡片 = onCardClick），下潜的中立生物不画卡；再画沙下动静 */
    function paint() {
      const snaps = state.units.filter(u => !u.hidden && !u.dead && !u._removed).map(u => ({ id: u.id, name: u.name, zone: Number(u.zone), isPlayer: !!u.isPlayer,
        neutral: isNeutralCreature(u), submerged: !!u.submerged, dead: false, hidden: false, leaveIn: u.leaveIn != null ? u.leaveIn : null, neutralTags: [],
        layers: (u.layers || []).map(l => ({ type: l.type, cur: l.current, max: l.max })) }));
      snaps.forEach(s => {
        if ((s.neutral && s.submerged) || cards.has(s.id)) return;
        const wrap = document.createElement("div");
        wrap.className = "unit-wrap";
        wrap.dataset.id = s.id;
        wrap.addEventListener("click", (e) => { e.stopPropagation(); onCardClick(s.id); });
        document.querySelector('#g-field .g-zone[data-num="' + s.zone + '"]').querySelector(s.isPlayer ? ".grp.player" : ".grp.enemy").appendChild(wrap);
        cards.set(s.id, { id: s.id, wrap });
      });
      paintSandStir(snaps);
    }
    return { G, cards, paint, armSkill, resolveQueues, onCardClick, allOnField, candidateUnits };
  })`, R.c, { filename: "game.js（抠出来的选目标那几段）" });
  const api = make(V, P.document);
  const doc = P.document;
  return Object.assign(api, {
    V, log, doc,
    rows: () => [...doc.querySelectorAll("#g-field .sandstir-wrap [data-stir-id]")],
    row: (id) => [...doc.querySelectorAll("#g-field .sandstir-wrap [data-stir-id]")].find(r => r.dataset.stirId === id) || null,
    lit: () => [...doc.querySelectorAll("#g-field .sandstir-wrap [data-stir-id]")].filter(r => r.classList.contains("is-targetable")).map(r => r.dataset.stirId),
    box: () => doc.querySelector("#g-field .g-zone[data-num=\"1\"] .sandstir-wrap"),
    picking: () => (api.G.arm && api.G.arm.mode === "unit" ? [...api.G.arm.map.keys()] : null)
  });
}

test("画面：两只下潜的尘虫不画卡，折进 1 区的「沙下动静」；allOnField 把列表里点得到的也算在场上（以前算不在，整步退回弹列表）", () => {
  const R = battle(), S = screen(R);
  S.paint();
  assert.ok(R.bugs.every(b => !S.cards.has(b.id)), "尘虫没有卡片");
  assert.deepEqual(S.rows().map(r => r.dataset.stirId).sort(), ids(R.bugs).sort(), "沙下动静列表里是这两只");
  assert.equal(S.allOnField([R.thug.id]), true);
  assert.equal(S.allOnField([R.thug.id].concat(ids(R.bugs))), true, "刀手有卡片，尘虫在沙下动静里点得到");
  assert.equal(S.allOnField(["nobody"]), false, "哪里都点不到的照旧不算");
  assert.equal(S.allOnField([]), false);
});

test("① 普通攻击（柯尔特电钻，最后单独选目标）：候选里没有沙下的尘虫，直接在战场上点刀手出手", async () => {
  const R = battle(), S = screen(R), kolt = R.kit("kolt");
  S.G.actorId = kolt.id;
  S.paint();
  const run = S.armSkill(skill(R, kolt, "kolt_aa"));
  await settle();
  assert.deepEqual(S.log.choices, [], "没弹列表");
  assert.deepEqual(S.picking(), [R.thug.id], "候选只有刀手（以前两只沙下的尘虫也在名单里）");
  assert.deepEqual(S.lit(), [], "沙下动静里没有能选的行");
  S.cards.get(R.thug.id).wrap.click();
  await run;
  assert.deepEqual(S.log.acts.map(a => [a.skill, a.target]), [["kolt_aa", R.thug.id]], "点刀手出手");
});

test("① 分步选单位的技能（瑞比扳机）：这一步的候选里没有沙下的尘虫，直接在战场上点（以前弹出列表）", async () => {
  const R = battle(), S = screen(R), ruby = R.kit("ruby");
  S.G.actorId = ruby.id;
  S.paint();
  const run = S.armSkill(skill(R, ruby, "ruby_trigger"));
  await settle();
  assert.deepEqual(S.log.choices, [], "没弹列表");
  assert.deepEqual(S.picking(), [R.thug.id], "在战场上点：候选只有刀手");
  S.cards.get(R.thug.id).wrap.click();
  await run;
  assert.deepEqual(S.log.acts.map(a => [a.skill, a.target, a.picks.target]), [["ruby_trigger", R.thug.id, R.thug.id]]);
});

test("② 谐波攻击（声波切割，分步选单位）：候选里有沙下的尘虫，照样在战场上点；沙下动静里能选的那几行亮着，点列表里那一行就选中它", async () => {
  const R = battle(), S = screen(R), tou = R.kit("tou"), [b1, b2] = R.bugs;
  S.G.actorId = tou.id;
  S.paint();
  const run = S.armSkill(skill(R, tou, "tou_sonic"));
  await settle();
  assert.deepEqual(S.log.choices, [], "没弹列表（以前候选里有沙下的尘虫，整步退回弹列表）");
  assert.deepEqual(S.picking().sort(), [R.thug.id, b1.id, b2.id].sort(), "刀手和两只沙下的尘虫都能选");
  assert.deepEqual(S.lit().sort(), [b1.id, b2.id].sort(), "沙下动静里能选的那两行亮着");
  assert.ok(S.box().classList.contains("has-target"), "区角的沙下动静按钮也亮着（点开才看得到列表）");
  // 新画面（#358）的标记照 fieldMarks.targets 亮：沙下的尘虫也在里面
  const mk = S.log.marks[S.log.marks.length - 1];
  assert.ok(mk.pick && [b1.id, b2.id, R.thug.id].every(id => mk.targets.includes(id)), "交给新画面的标记里有沙下的尘虫");
  // 列表每次重画（setView → paintSandStir）都照正在选的目标再标一遍
  S.paint();
  assert.deepEqual(S.lit().sort(), [b1.id, b2.id].sort(), "重画以后照样亮着");
  // 点开沙下动静，点 b2 那一行
  S.box().querySelector(".sandstir").click();
  assert.ok(S.box().classList.contains("open"), "点开了列表（选目标没被取消）");
  assert.ok(S.picking(), "还在选目标");
  S.row(b2.id).click();
  await run;
  assert.deepEqual(S.log.acts.map(a => [a.skill, a.target, a.picks.target1]), [["tou_sonic", b2.id, b2.id]], "选中列表里的那一只出手");
  assert.deepEqual(S.lit(), [], "选完收起标记");
  assert.ok(!S.box().classList.contains("has-target"));
});

test("② 谐波攻击（Helumica 普攻，最后单独选目标）：候选里有沙下的尘虫，能选的行亮着；新画面标记里那一行点下去（G.fieldInput.unit = onCardClick）也选得中", async () => {
  const R = battle(), S = screen(R), helu = R.kit("helu"), [b1] = R.bugs;
  helu.zone = 2;   // 远距离：打距离 1 的 1 区
  S.G.actorId = helu.id;
  S.paint();
  const run = S.armSkill(skill(R, helu, "helu_aa"));
  await settle();
  assert.deepEqual(S.log.choices, []);
  assert.deepEqual(S.picking().sort(), [R.thug.id].concat(ids(R.bugs)).sort(), "谐波攻击：沙下的尘虫也在候选里");
  assert.deepEqual(S.lit().sort(), ids(R.bugs).sort(), "沙下动静里能选的那两行亮着");
  S.onCardClick(b1.id);   // 新画面的沙下动静标记点一行 = G.fieldInput.unit(id)
  await run;
  assert.deepEqual(S.log.acts.map(a => [a.skill, a.target]), [["helu_aa", b1.id]]);
});

test("③ 结算队列·更换刀头：同区的追击目标里没有沙下的尘虫，直接在战场上点刀手（以前弹列表）", async () => {
  const R = battle(), S = screen(R), kolt = R.kit("kolt");
  S.paint();
  R.st.koltSwapQueue = [{ actorId: kolt.id }];
  S.V.answer = (title, options, cancel) => cancel && cancel.value;   // 旧代码弹列表时按「不切换」
  const run = S.resolveQueues();
  await settle();
  assert.deepEqual(S.log.choices, [], "没弹列表");
  assert.deepEqual(S.picking(), [R.thug.id], "在战场上点：追击目标只有刀手");
  S.cards.get(R.thug.id).wrap.click();
  await run;
  assert.deepEqual(plain(S.log.acts), [{ type: "koltSwapAnswer", swap: true, target: R.thug.id }]);
  assert.equal(R.st.koltSwapQueue.length, 0);
});

test("③ 结算队列·协助攻击附带的环境扫描：碎渣机炮打谁那一步在战场上点刀手（这份名单 scrapTargets 本来就不收下潜中的单位，留作回归）", async () => {
  const R = battle(), S = screen(R), helu = R.kit("helu");
  const p = R.c.makeProp("scrap", 1, 1);
  p.faction = "player";
  R.st.props = (R.st.props || []).concat([p]);
  S.paint();
  R.st.heluScanQueue = [{ actorId: helu.id, zone: 1 }];
  S.V.answer = (title, options) => (options.find(o => o.value === "prop:" + p.id) || {}).value;   // 「扫描出 / 互动」那一步（选项，本来就弹）：操控碎渣机炮
  const run = S.resolveQueues();
  await settle();
  assert.equal(S.log.choices.length, 1, "只有「和哪个配置物互动」那一步是选项");
  assert.deepEqual(S.picking(), [R.thug.id], "碎渣机炮打谁：在战场上点，名单里没有沙下的尘虫");
  S.cards.get(R.thug.id).wrap.click();
  await run;
  assert.deepEqual(plain(S.log.acts), [{ type: "heluScanAnswer", picks: { dest: 1, act: "prop:" + p.id, target: R.thug.id } }]);
});
