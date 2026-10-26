// 新画面接入（四）（#297）：原型页的技能栏、队伍栏、主职责图标接进正式画面（单机 game.html、联机玩家）。
//   · 共用的一份在 hd2d/：hd2d-shell.js（收起 / 展开、换上 / 拆掉新外壳、技能按钮 / 唤出按钮 / 头像要的东西）、hd2d-ui.js（按钮里面、队伍栏一个人的 HTML 片段）；
//   · 收起 / 展开记在这台电脑上（localStorage，读写都包 try/catch），没记过时手机上默认收起；
//   · 换上新外壳只换样子：按钮还是 game.js / online-battle.js 自己建、自己接（出手流程只有原来那一份），拆掉以后 .g-hud 和换上之前一模一样；
//   · 只用投影过的单位：新加的 DOM 里没有坚毅生命的数字。
// 都在 Node 里跑：tests/mini-dom.js 是一个够用的小 DOM（解析 innerHTML、选择器、事件冒泡）；game.html 的 <body> 真的解析出来，
// game.js 里技能栏 / 队伍栏（refreshHud）和快捷键那一段从源码里抠出来跑，其余的给假的；online-battle.js 整个跑。WebGL 画面由仓库主人看。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");
const HP = require("./hd2d-paths");
const MD = require("./mini-dom");

const shell = () => require("../hd2d/hd2d-shell.js");
const read = (f) => fs.readFileSync(path.join(HP.ROOT, f), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");   // 去掉注释，只看代码
const plain = (v) => JSON.parse(JSON.stringify(v));
const PARTY = ["kolt", "helu", "ruby", "yuito"];
const SHP = 7771, SHP_MAX = 7772;
const settle = async (n) => { for (let i = 0; i < (n || 6); i++) await new Promise(r => setImmediate(r)); };

function memStorage(init) {
  const m = new Map(init || []);
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}
/** 新加的 DOM 里不能有坚毅生命：特殊的数、字段名、「坚毅」两个字都不能出现 */
function noShp(text, tag) {
  assert.ok(!text.includes(String(SHP)) && !text.includes(String(SHP_MAX)), tag + "：出现了坚毅生命的数字");
  assert.doesNotMatch(text, /shp|坚毅/i, tag + "：出现了坚毅生命");
}
/** 从源码里抠出一个函数（按大括号配对；这几个函数的字符串里大括号都是配对的） */
function fnSrc(src, name) {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at >= 0, "找不到 " + name);
  return src.slice(at, blockEnd(src, src.indexOf("{", src.indexOf(")", at))) + 1);
}
function blockEnd(src, i) {
  for (let depth = 0; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  throw new Error("大括号没配上");
}

/* ---------- 规则环境、页面 ---------- */
/** 规则环境里一场三区的战斗：每个人塞上特殊的坚毅生命数，柯尔特身上灼烧 ×2（队伍栏名字右边的效果）。投影用 online-view.js */
function rules() {
  const ctx = H.load();
  vm.runInContext(read("online-view.js"), ctx, { filename: "online-view.js" });
  const st = ctx.BattleSim.setup({ party: PARTY, zoneMode: 3, seed: "hd2d-shell", enemies: [{ id: "guard_sword", lv: 2, zone: 3 }, { id: "thug_hammer", lv: 2, zone: 2 }] });
  st.units.forEach(u => { u.shp = SHP; u.shpMax = SHP_MAX; u.baseShp = SHP; u.shpBase = SHP; u.shpBonus = SHP_MAX; });
  st.combatStarted = true; st.combatPhase = "player";
  const unit = (kit) => st.units.find(u => u.kit === kit);
  unit("kolt").statuses.burn = 2;
  return {
    ctx, st, unit, OV: ctx.OnlineView,
    cards: plain(ctx.livePartyCards()), ele: plain(vm.runInContext("ELE_BY_CN", ctx)), codex: plain(vm.runInContext("CODEX_EFFECTS", ctx)),
    COL: require("../attack-fx.js").COL
  };
}
/** game.html 的 <body>（脚本去掉）解析进小 DOM；界面图标、hd2d-ui.js、hd2d-shell.js 加载进同一个页面。opts.media(q) = matchMedia 的结果 */
function uiPage(R, opts) {
  opts = opts || {};
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body, { storage: opts.storage, media: opts.media });
  const w = P.window;
  Object.assign(w, { livePartyCards: () => R.cards, ELE_BY_CN: R.ele, CODEX_EFFECTS: R.codex, OnlineView: R.OV, skillList: (u) => R.ctx.skillList(u) });
  const ctx = vm.createContext(w);
  // hud-patch.js（#317：技能栏 / 队伍栏按需更新）：game.html 里在 game.js、online-battle.js 前面加载；opts.noPatch = 不加载（看退回整块换的那一条）
  ["icons.js", "hud-icons.js"].concat(opts.noPatch ? [] : ["hud-patch.js"], ["hd2d/hd2d-ui.js", "hd2d/hd2d-shell.js"], opts.scripts || []).forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  return { P, w, ctx, doc: P.document };
}
/** game.js 里技能栏 / 队伍栏按需更新的小工具（#317）：有的才抠（没改的旧代码里没有，照样跑得起来，测试在断言上失败） */
const HUD_FNS = ["hudAttr", "hudCls", "hudInner", "hudKeep", "hudPlace", "hudTrim", "hudSoon"];
const hudFns = (g) => HUD_FNS.filter(n => g.includes("function " + n + "(")).map(n => fnSrc(g, n)).join("\n");

/**
 * 单机：game.js 的技能栏 / 队伍栏（refreshHud 和它用到的 isSummonSkill / mainElementOf / summonIcon）、战斗画面的快捷键（boot 里那一个 keydown），
 * 从源码里抠出来放进页面里跑；出手流程的入口（armSkill 选技能、selectActor 切人、spaceStartOrEnd 结束回合）、技能表（gameSkills）、
 * 用不了的原因（blockReason）、悬停说明（HeroSheet）换成记下来的假的。opts.blocked = { 技能 id: 原因 }
 */
function soloHud(R, page, opts) {
  opts = opts || {};
  const g = read("game.js");
  const helpers = ["esc", "el", "sumCur", "sumMax"].map(n => { const m = new RegExp("^  const " + n + " = .*$", "m").exec(g); assert.ok(m, "game.js 有 " + n); return m[0]; }).join("\n");
  const fns = ["refreshHud", "isSummonSkill", "mainElementOf", "summonIcon"].map(n => fnSrc(g, n)).join("\n") + "\n" + hudFns(g);
  const keyHead = 'document.addEventListener("keydown", (e) => {\n      // 只在战斗界面响应';
  const k0 = g.indexOf(keyHead);
  assert.ok(k0 > 0, "game.js 的战斗快捷键");
  const k1 = g.indexOf("(e) => {", k0);
  const keySrc = g.slice(k1, blockEnd(g, g.indexOf("{", k1)) + 1);
  const space = /const SPACE_SAFE = ("[^"]*");/.exec(g);
  const log = { arms: [], picks: [], space: 0, tips: [] };
  const V = {
    G: { actorId: R.unit("kolt").id, depth: 0, arm: null, ended: false, summonShown: null, skillsShown: null, skillTap: null, undo: [] },
    state: R.st,
    snapUnit: (u) => ({ dead: !!u.dead, dying: !!u.dying, stunned: !!u.stunned, ap: u.ap || 0, apMax: u.apMax || 0, bonus: u.bonus || 0, bonusMax: u.bonusMax || 0,
      layers: (u.layers || []).map(l => ({ type: l.type, cur: l.current, max: l.max })), shp: u.shp, shpMax: u.shpMax }),
    gameSkills: (u) => (u && u.isPlayer ? R.ctx.skillList(u).map(s => Object.assign({}, s, { cost: R.ctx.skillCost(s.id) || {} })) : []),
    blockReason: (u, sk) => (opts.blocked && opts.blocked[sk.id]) || "",
    armSkill: (sk) => log.arms.push(sk.id),
    selectActor: (id) => { log.picks.push(id); V.G.actorId = id; },
    spaceStartOrEnd: () => { log.space++; }
  };
  page.w.HeroSheet = { tip: (el, h) => log.tips.push([el, h]), hideTip() {}, skillTipHtml: (sk, why) => "技能说明 " + sk.id + (why ? "：" + why : "") };
  const make = new vm.Script(`(function (V) {
    const G = V.G, state = V.state;
    ${helpers}
    const $ = (id) => document.getElementById(id);
    const refreshTop = () => {}, hotseat = () => false, stopSkillPv = () => {}, touchUI = () => false, skillTapPv = () => false;
    const setHint = () => {}, scheduleSkillPv = () => {}, defaultHint = () => "", disarm = () => {}, doUndo = () => {}, toggleFast = () => {};
    const unitById = (id) => state.units.find(u => u.id === id) || null;
    const isWeaponUnit = (u) => !!(u && u.weaponOf);
    const snapUnit = V.snapUnit, gameSkills = V.gameSkills, blockReason = V.blockReason, armSkill = V.armSkill, selectActor = V.selectActor, spaceStartOrEnd = V.spaceStartOrEnd;
    const cards = new Map();
    let hudEpoch = 0, hudPaints = 0, choiceResolve = null, choiceKeys = [];
    const SPACE_SAFE = ${space ? space[1] : '"button"'}, kbdFocus = () => false;
    ${fns}
    const onKey = ${keySrc};
    return { refreshHud, onKey };
  })`, { filename: "game.js（抠出来的技能栏 / 队伍栏 / 快捷键）" });
  const api = make.runInContext(page.ctx)(V);
  page.doc.addEventListener("keydown", api.onKey);
  return Object.assign(api, { V, log, hud: page.doc.querySelector("#g-app > .g-hud") });
}

/** 联机玩家：online-battle.js 整个跑；点选回调记下来（online-ui.js 的 battleCb 就是接在这几个上）。悬停说明（HeroSheet）记下来 */
function onlineHud(R, opts) {
  const page = uiPage(R, Object.assign({}, opts, { scripts: ["online-battle.js"] }));
  const log = { skills: [], ends: 0, units: [], tips: [] };
  page.w.HeroSheet = { tip: (el, h) => log.tips.push([el, h]), hideTip() {}, skillTipHtml: (sk, why) => "技能说明 " + sk.id + (why ? "：" + why : "") };
  const b = page.w.OnlineBattle.create({ onSkill: (id) => log.skills.push(id), onEnd: () => { log.ends++; }, onUnit: (id) => log.units.push(id), onZone() {}, onOption() {}, onCancel() {} });
  page.doc.body.appendChild(b.el);
  const kolt = R.unit("kolt");
  const pv = plain(R.OV.projectState(R.st, { itemCatalog: {} }));
  // 主机给的技能选项（online-view.js · projectActionMenu 投影过的样子）：一个用不了的、一个唤出武器人
  const skills = [
    { value: "kolt_aa", label: "普通攻击", cost: "行动 1" },
    { value: "kolt_short", label: "直流短接", cost: "行动 1", disabled: true, reason: "行动点不足" },
    { value: "kolt_summon", label: "唤出武器人", cost: "附赠 1" },
    { value: "__move", label: "移动", cost: "附赠 1" }
  ];
  const ui = { mine: [kolt.id], current: kolt.id, acting: true, menu: { kind: "skill", options: skills }, skills, armed: "", hint: "选择技能", busy: false };
  return { page, b, log, pv, ui, skills, kolt, hud: b.el.querySelector(".g-hud"), paint: () => b.update(pv, ui) };
}

/* ---------- 1. 收起 / 展开记在本机 ---------- */
test("收起 / 展开：记在本机 localStorage（技能栏、队伍栏各一项，存 open / closed）；没记过按默认（手机收起）；读不了 / 存不了不报错", () => {
  const S = shell();
  const s = memStorage();
  assert.equal(S.isOpen("dock", s, true), true, "没记过：按默认（桌面展开）");
  assert.equal(S.isOpen("party", s, false), false, "没记过：按默认（手机收起）");
  assert.equal(S.setOpen("dock", false, s), true);
  assert.equal(s.m.get(S.SHELL.keys.dock), "closed");
  assert.equal(S.isOpen("dock", s, true), false, "收起记住了");
  S.setOpen("party", true, s);
  assert.equal(S.isOpen("party", s, false), true, "展开也记住");
  s.m.set(S.SHELL.keys.dock, "乱写的");
  assert.equal(S.isOpen("dock", s, true), true, "认不得：按默认");
  const broken = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } };
  assert.doesNotThrow(() => S.isOpen("dock", broken, true));
  assert.equal(S.isOpen("dock", broken, true), true, "读不了：按默认");
  assert.equal(S.setOpen("dock", false, broken), false, "存不了：不报错");
  assert.equal(S.isOpen("dock", null, false), false, "没有 localStorage：按默认");
  assert.equal(S.labelOf("dock", true), "技能 ▼");
  assert.equal(S.labelOf("dock", false), "技能 ▲");
  assert.equal(S.labelOf("party", true), "队伍 ◀");
  assert.equal(S.labelOf("party", false), "队伍 ▶");
  // 源码：读写都在 try 里
  const src = code(read("hd2d/hd2d-shell.js"));
  assert.match(fnSrc(src, "isOpen"), /try \{[\s\S]*storage\.getItem\(k\)[\s\S]*\} catch/);
  assert.match(fnSrc(src, "setOpen"), /try \{[\s\S]*storage\.setItem\(k, open \? "open" : "closed"\)[\s\S]*\} catch/);
});

test("换上 / 拆掉新外壳（hd2d-shell.js · attach / detach）：技能栏上面加「技能 ▼ / ▲」一行，旧的队伍栏原样挪进一块能收起的面板；点一下收起、记在本机，再换上还是收起的；拆掉后 .g-hud 和以前一模一样", () => {
  const R = rules();
  const storage = memStorage();
  const page = uiPage(R, { storage });
  const S = page.w.HD2DShell, doc = page.doc;
  const hud = doc.querySelector("#g-app > .g-hud"), party = doc.getElementById("g-party");
  party.innerHTML = '<button class="pc" data-id="a">甲</button>';
  const before = hud.outerHTML;
  assert.equal(S.on(hud), false);
  assert.equal(S.attach(hud, { phone: false }), true, "换上了");
  assert.equal(S.attach(hud, { phone: false }), false, "已经换上了：不再来一次");
  assert.equal(S.on(hud), true);
  assert.ok(hud.classList.contains("hd2d-shell") && hud.classList.contains("hd2d-theme"), ".g-hud 挂上新外壳的类（样式在 hd2d.css）");
  const row = hud.firstElementChild;
  assert.ok(row.classList.contains("hd2d-dock-row"), "最上面一行");
  const dockBtn = row.querySelector(".hd2d-dock-toggle");
  assert.equal(dockBtn.textContent, "技能 ▼", "桌面没记过：展开");
  assert.equal(dockBtn.getAttribute("aria-expanded"), "true");
  const panel = hud.querySelector(":scope > .hd2d-party");
  assert.ok(panel, "队伍栏面板");
  assert.equal(party.parentNode, panel, "旧的 #g-party 原样挪进面板（还是同一个元素，game.js 照旧往里画）");
  assert.equal(doc.getElementById("g-party"), party, "还找得到");
  assert.equal(doc.querySelectorAll("#g-party .pc").length, 1, "Tab 切人看的 #g-party .pc 照旧找得到");
  assert.equal(panel.querySelector(".hd2d-tape").textContent, "我方队伍");
  const partyBtn = panel.querySelector(".hd2d-party-toggle");
  assert.equal(partyBtn.textContent, "队伍 ◀");
  // 点一下：收起，记在本机
  dockBtn.click();
  assert.ok(hud.classList.contains("dock-closed"), "技能栏收起");
  assert.equal(dockBtn.textContent, "技能 ▲");
  assert.equal(dockBtn.getAttribute("aria-expanded"), "false");
  assert.equal(storage.m.get(S.SHELL.keys.dock), "closed", "记在本机");
  partyBtn.click();
  assert.ok(panel.classList.contains("collapsed"), "队伍栏收起");
  assert.equal(partyBtn.textContent, "队伍 ▶");
  assert.equal(storage.m.get(S.SHELL.keys.party), "closed");
  // 拆掉：和换上之前一模一样
  assert.equal(S.detach(hud), true);
  assert.equal(S.detach(hud), false, "拆过了：不再拆");
  assert.equal(hud.outerHTML, before, "拆掉后 .g-hud 和以前一模一样");
  assert.equal(party.parentNode, hud, "队伍栏放回原处");
  // 再换上：还是收起的（同一台电脑）
  S.attach(hud, { phone: false });
  assert.ok(hud.classList.contains("dock-closed"), "技能栏记得收起");
  assert.ok(hud.querySelector(".hd2d-party").classList.contains("collapsed"), "队伍栏记得收起");
  hud.querySelector(".hd2d-dock-toggle").click();
  assert.equal(storage.m.get(S.SHELL.keys.dock), "open", "展开也记住");
  S.detach(hud);
  // 手机没记过：都收起；本机存不了也照样能换上、能点
  const P2 = uiPage(R, { storage: { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } }, media: (q) => q === "(max-width: 720px)" });
  const hud2 = P2.doc.querySelector("#g-app > .g-hud");
  assert.doesNotThrow(() => P2.w.HD2DShell.attach(hud2));
  assert.ok(hud2.classList.contains("dock-closed") && hud2.querySelector(".hd2d-party").classList.contains("collapsed"), "手机：没记过默认收起");
  assert.doesNotThrow(() => hud2.querySelector(".hd2d-dock-toggle").click());
  assert.equal(hud2.classList.contains("dock-closed"), false, "存不了也能点开");
});

test("页面自己收起 / 展开一块（#311：联机纸片画面的手机上轮到你时展开技能栏）：setPanel 不记在本机、和现在一样就不动；manual = 手动点过（本机记着的，或者这次点过但存不了）；没换上新外壳不报错", () => {
  const R = rules();
  const storage = memStorage();
  const page = uiPage(R, { storage });
  const S = page.w.HD2DShell, hud = page.doc.querySelector("#g-app > .g-hud");
  assert.equal(S.saved("dock", storage), null, "没记过");
  assert.equal(S.manual(hud, "dock"), false, "没换上新外壳：不算");
  assert.equal(S.setPanel(hud, "dock", true), false, "没换上新外壳：不动");
  S.attach(hud, { phone: true });
  const btn = hud.querySelector(".hd2d-dock-toggle"), panel = hud.querySelector(".hd2d-party");
  assert.ok(hud.classList.contains("dock-closed"), "手机没记过：收着");
  assert.equal(S.manual(hud, "dock"), false, "还没点过");
  assert.equal(S.setPanel(hud, "dock", true), true);
  assert.equal(hud.classList.contains("dock-closed"), false, "页面自己展开了");
  assert.deepEqual([btn.textContent, btn.getAttribute("aria-expanded")], ["技能 ▼", "true"], "按钮上的字、读屏跟着");
  assert.equal(S.saved("dock", storage), null, "页面自己展开的不记在本机");
  assert.equal(S.manual(hud, "dock"), false, "也不算手动点过");
  let set = 0; const was = btn.setAttribute; btn.setAttribute = function () { set++; return was.apply(this, arguments); };
  S.setPanel(hud, "dock", true);
  btn.setAttribute = was;
  assert.equal(set, 0, "和现在一样：不动");
  assert.equal(S.setPanel(hud, "party", true), true);
  assert.equal(panel.classList.contains("collapsed"), false, "队伍栏也能");
  S.setPanel(hud, "dock", false);
  assert.ok(hud.classList.contains("dock-closed"), "收起");
  // 手动点一下：照旧记在本机，算手动点过
  btn.click();
  assert.equal(S.saved("dock", storage), "open");
  assert.equal(S.manual(hud, "dock"), true);
  assert.equal(S.manual(hud, "party"), false, "队伍栏没点过");
  S.detach(hud);
  assert.equal(S.manual(hud, "dock"), false, "拆掉了：不算");
  assert.equal(S.setPanel(hud, "dock", false), false, "拆掉了：不动");
  // 以前点过（本机记着）：一换上就算手动
  S.attach(hud, { phone: true });
  assert.equal(S.manual(hud, "dock"), true, "本机记着的：算手动");
  assert.equal(hud.classList.contains("dock-closed"), false, "照记着的展开");
  // 存不了（隐私模式）：这次点过也算手动
  const broken = { getItem() { return null; }, setItem() { throw new Error("QuotaExceededError"); } };
  const P2 = uiPage(R, { storage: broken }), S2 = P2.w.HD2DShell, hud2 = P2.doc.querySelector("#g-app > .g-hud");
  S2.attach(hud2, { phone: true });
  assert.equal(S2.manual(hud2, "dock"), false);
  hud2.querySelector(".hd2d-dock-toggle").click();
  assert.equal(S2.saved("dock", broken), null, "没存上");
  assert.equal(S2.manual(hud2, "dock"), true, "这次点过：算手动");
  assert.equal(S.saved("dock", { getItem() { throw new Error("SecurityError"); } }), null, "读不了：不报错");
  assert.equal(S.saved("dock", null), null);
  const src = code(read("hd2d/hd2d-shell.js"));
  assert.match(fnSrc(src, "saved"), /try \{[\s\S]*storage\.getItem\(k\)[\s\S]*\} catch/, "读在 try 里");
});

/* ---------- 2. 单机 game.js ---------- */
test("单机 game.js：开着新画面（.g-hud 换上了新外壳）时技能按钮画成原型那一套——左上角属性、右上角攻击 / 技能、轮流换颜色，唤出武器人是单独的大按钮；队伍栏是主职责头像 + 身上的效果；关着时一点没变", () => {
  const R = rules(), kolt = R.unit("kolt");
  const page = uiPage(R);
  const second = R.ctx.skillList(kolt).filter(s => !/_summon$|_return$/.test(s.id))[1].id;
  const H2 = soloHud(R, page, { blocked: { [second]: "行动点不足" } });
  const hud = H2.hud, S = page.w.HD2DShell, U = page.w.HD2DUI;
  // 关着：旧画面
  H2.refreshHud();
  const old = hud.innerHTML;
  const oldSk = hud.querySelectorAll("#g-skills .sk");
  assert.ok(oldSk.length >= 3, "有技能按钮");
  assert.equal(hud.querySelectorAll(".sk-el, .sk-kind, .face.av, .hd2d-dock-row").length, 0, "关着：没有新样子");
  assert.equal(oldSk[0].firstElementChild.className, "key", "旧的按钮：左上角是数字键");
  assert.ok(hud.querySelector("#g-party .pc .mini"), "旧的队伍栏：血量细条");
  // 开着：换上新外壳以后再画一遍
  S.attach(hud, { phone: false });
  H2.refreshHud();
  const sks = hud.querySelectorAll("#g-skills .sk");
  assert.equal(sks.length, oldSk.length, "按钮一个都不少");
  const shown = H2.V.G.skillsShown;
  sks.forEach((b, i) => {
    const sk = shown[i];
    assert.equal(b.dataset.skill, sk.id, "同一个技能、同一个顺序");
    assert.ok(b.querySelector(":scope > .sk-el") && b.querySelector(":scope > .sk-kind"), sk.id + "：属性、攻击 / 技能两个角标");
    const nb = S.skillButton({ id: sk.id, name: sk.name, hint: sk.hint, cost: sk.cost }, i, R.OV.projectUnit(kolt), { key: i < 9 ? i + 1 : "" });
    nb.cls.split(" ").forEach(c => assert.ok(b.classList.contains(c), sk.id + " 有 " + c));
    assert.ok(b.classList.contains("t-" + U.UI.skill.tints[i % U.UI.skill.tints.length]), "按顺序轮流换颜色");
    assert.equal(b.querySelector(".key").textContent, i < 9 ? String(i + 1) : "", "数字键照旧写着（右下角）");
    assert.equal(b.querySelector(".nm").textContent, sk.name);
    assert.ok(!U.isSummon(sk.id), "唤出 / 收回武器人不在普通技能里");
  });
  // 用不了的照旧灰掉，读屏写原因
  const blocked = hud.querySelector(`#g-skills .sk[data-skill="${second}"]`);
  assert.ok(blocked.disabled, "行动点不够的照旧灰掉");
  assert.match(blocked.getAttribute("aria-label"), /行动点不足/);
  // 唤出武器人：单独的大按钮（#g-summon），在结束回合旁边
  const sb = page.doc.getElementById("g-summon");
  assert.equal(sb.hidden, false);
  assert.match(sb.dataset.skill, /_summon$/);
  assert.equal(sb.parentNode.nextElementSibling, hud.querySelector(".hud-side"), "和结束回合放在一起");
  assert.match(sb.querySelector("small").textContent, /· Q$/, "快捷键 Q");
  // 技能栏上面那一行：谁在行动
  assert.match(hud.querySelector(".hd2d-who").innerHTML, new RegExp(kolt.name + "<small>Lv\\d+ · 行动中</small>"));
  // 队伍栏：头像 = 主职责图标 + 主属性 → 副属性渐变；名字右边身上的效果（柯尔特灼烧）；角色资料 / 武器工坊照旧在
  const rows = [...hud.querySelectorAll("#g-party .pc.pm")];
  const heroes = Array.from(R.st.units.filter(u => u.isPlayer && !u.hidden && !u.weaponOf));
  assert.deepEqual(rows.map(r => r.dataset.id), heroes.map(u => u.id), "每个人一行，顺序照旧");
  rows.forEach(r => {
    const u = heroes.find(x => x.id === r.dataset.id), card = R.cards.find(c => c.kit === u.kit);
    const [main, sub] = card.note.split("·")[1].split("/").map(s => R.ele[s.trim()]);
    const av = r.querySelector(".face.av");
    assert.equal(av.getAttribute("style"), `background:linear-gradient(to bottom right, ${R.COL[main]}, ${R.COL[sub]})`, u.kit + "：主属性 → 副属性渐变");
    assert.equal(av.querySelector(".ink").innerHTML, MD.create(U.UI.roles[card.roles.primary]).document.body.innerHTML, u.kit + "：主职责「" + card.roles.primary + "」的图标");
    assert.match(av.getAttribute("title"), new RegExp("主职责 " + card.roles.primary));
    assert.equal(r.querySelector(".nm-t").textContent, u.name);
    assert.ok(r.querySelector(".bar i"), "分层血条");
    assert.equal(r.classList.contains("on"), u.id === kolt.id, "行动的人亮着");
  });
  const koltRow = rows.find(r => r.dataset.id === kolt.id);
  assert.ok(koltRow.querySelector('.pm-fx .hi-badge[data-fx="burn"]'), "名字右边：灼烧");
  assert.equal(koltRow.querySelector(".pm-fx").hasAttribute("tabindex"), false, "按钮里面的效果不再单独停键盘焦点");
  assert.equal(hud.querySelectorAll("#g-party .pc-sheet").length, 2, "角色资料、武器工坊照旧在队伍栏里");
  noShp(hud.innerHTML, "新外壳的技能栏、队伍栏");
  // 拆掉：再画一遍就是原来的样子
  S.detach(hud);
  H2.refreshHud();
  assert.equal(hud.innerHTML, old, "关掉新画面：技能栏、队伍栏和以前一模一样");
});

test("单机：开着新画面时点技能按钮 / 唤出按钮 / 队伍栏、悬停、数字键 / Q / Tab / 空格，走的都是 game.js 现有的那一套（armSkill / selectActor / spaceStartOrEnd、HeroSheet 的说明）", () => {
  const R = rules(), kolt = R.unit("kolt");
  const page = uiPage(R);
  const H2 = soloHud(R, page);
  const hud = H2.hud, doc = page.doc;
  page.w.HD2DShell.attach(hud, { phone: false });
  H2.refreshHud();
  const L = H2.log, G = H2.V.G;
  const sks = hud.querySelectorAll("#g-skills .sk");
  sks[1].click();
  assert.deepEqual(L.arms, [G.skillsShown[1].id], "点技能按钮 = armSkill（选技能 → 选目标 → 出手，原来那一条）");
  doc.getElementById("g-summon").click();
  assert.deepEqual(L.arms.slice(-1), [G.summonShown.id], "点唤出武器人 = armSkill(唤出)");
  // 悬停照旧弹技能说明（HeroSheet，挂在这个按钮上）
  sks[0].dispatchEvent(new MD.Event("mouseenter"));
  assert.equal(L.tips.length, 1);
  assert.equal(L.tips[0][0], sks[0], "说明挂在新样子的按钮上");
  assert.equal(L.tips[0][1], "技能说明 " + G.skillsShown[0].id);
  // 队伍栏：点别人 = 切人
  const other = hud.querySelector(`#g-party .pc.pm:not([data-id="${kolt.id}"])`);
  other.click();
  assert.deepEqual(L.picks, [other.dataset.id], "点队伍栏 = selectActor");
  G.actorId = kolt.id;
  H2.refreshHud();
  // 快捷键：数字键选技能、Q 唤出、Tab 切人（按 #g-party .pc 的顺序）、空格结束回合
  L.arms.length = 0; L.picks.length = 0;
  MD.key(doc, "1");
  assert.deepEqual(L.arms, [G.skillsShown[0].id], "1 = 第一个技能");
  MD.key(doc, "3");
  assert.deepEqual(L.arms.slice(-1), [G.skillsShown[2].id], "3 = 第三个技能");
  MD.key(doc, "q");
  assert.deepEqual(L.arms.slice(-1), [G.summonShown.id], "Q = 唤出武器人");
  MD.key(doc, "Tab");
  const order = [...doc.querySelectorAll("#g-party .pc")].map(b => b.dataset.id).filter(Boolean);
  assert.deepEqual(L.picks, [order[order.indexOf(kolt.id) + 1]], "Tab = 切到队伍栏里下一个人");
  MD.key(doc, " ");
  assert.equal(L.space, 1, "空格 = 结束回合");
  // 收起技能栏：快捷键照旧能用
  hud.querySelector(".hd2d-dock-toggle").click();
  assert.ok(hud.classList.contains("dock-closed"));
  MD.key(doc, "2");
  assert.deepEqual(L.arms.slice(-1), [G.skillsShown[1].id], "收起时数字键照旧");
  // 源码：新样子只换按钮里面的东西，点击 / 悬停还是 wireSkill 接的那一个按钮
  const src = code(fnSrc(read("game.js"), "refreshHud"));
  assert.match(src, /if \(shell\) \{\s*const nb = shell\.skillButton\(\{ id: sk\.id, name: sk\.name, hint: sk\.hint, cost: sk\.cost \}, i, actorView, \{ key: i < 9 \? i \+ 1 : "" \}\);\s*cls \+= " " \+ nb\.cls;\s*inner = nb\.html;/);
  assert.match(src, /wireSkill\(b, sk, why\);\s*hudPlace\(box, b, i\);/, "接点击 / 悬停的还是原来那一个（#317 起同一个技能还是同一个按钮）");
  assert.match(src, /const shell = window\.HD2DShell && HD2DShell\.on\(hudEl\) && window\.OnlineView \? HD2DShell : null;/, "只有换上了新外壳才换样子");
});

/* ---------- 3. 联机玩家 online-battle.js ---------- */
test("联机玩家（online-battle.js）：开着新画面时技能按钮画成原型那一套、唤出武器人单独做成大按钮（结束行动旁边）、队伍栏是主职责头像 + 效果 +「你」；只用收到的包；关着时一点没变", () => {
  const R = rules();
  const O = onlineHud(R);
  const hud = O.hud, S = O.page.w.HD2DShell;
  // 关着：旧画面（唤出武器人在技能栏里）
  O.paint();
  const old = hud.innerHTML;
  assert.deepEqual([...hud.querySelectorAll(".skills .sk")].map(b => b.dataset.obSkill), O.skills.map(o => o.value), "关着：技能栏照主机给的整张表");
  assert.equal(hud.querySelectorAll(".hud-summon, .sk-el, .face.av, .hd2d-dock-row").length, 0, "关着：没有新样子、没有单独的唤出按钮");
  // 开着
  S.attach(hud, { phone: false });
  O.paint();
  const sks = [...hud.querySelectorAll(".skills .sk")];
  assert.deepEqual(sks.map(b => b.dataset.obSkill), ["kolt_aa", "kolt_short", "__move"], "唤出武器人不在普通技能里");
  sks.forEach((b, i) => {
    assert.ok(b.querySelector(":scope > .sk-el") && b.querySelector(":scope > .sk-kind"), b.dataset.obSkill + "：两个角标");
    assert.equal(b.querySelector(".key").textContent, String(i + 1), "数字键按剩下的普通技能排");
    assert.ok([...b.classList].some(c => /^t-/.test(c)) && [...b.classList].some(c => /^k-/.test(c)));
  });
  assert.ok(sks[0].classList.contains("k-attack"), "普通攻击：攻击（按本机技能表的提示读）");
  assert.ok(sks[0].querySelector(".sk-el").innerHTML.length > 0 && !sks[0].querySelector(".sk-el").classList.contains("none"), "普通攻击有属性");
  const blocked = sks[1];
  assert.ok(blocked.disabled && blocked.classList.contains("blocked"), "用不了的照旧灰掉");
  assert.equal(blocked.querySelector(".cost").textContent, "行动点不足", "照旧写原因");
  const sb = hud.querySelector(".hud-summon > .summonbtn");
  assert.ok(sb, "唤出武器人：单独的大按钮");
  assert.equal(sb.dataset.obSkill, "kolt_summon");
  assert.equal(sb.parentNode.nextElementSibling, hud.querySelector(".hud-side"), "放在结束行动旁边");
  assert.match(sb.querySelector(".sm-nm").textContent, /唤出武器人/);
  assert.match(sb.querySelector("small").textContent, /附赠 1 · Q/);
  assert.ok(sb.getAttribute("style").includes("--el:"), "颜色跟着主属性");
  assert.match(hud.querySelector(".hd2d-who").innerHTML, new RegExp(O.kolt.name + "<small>Lv\\d+ · 行动中</small>"));
  // 队伍栏：头像、「你」、效果
  const rows = [...hud.querySelectorAll(".party .pc.pm")];
  assert.equal(rows.length, O.pv.units.filter(u => u.isPlayer && !u.hidden).length);
  const mine = rows.find(r => r.dataset.obUnit === O.kolt.id);
  assert.equal(mine.querySelector(".pm-tag").textContent, "你");
  assert.ok(mine.querySelector('.pm-fx .hi-badge[data-fx="burn"]'), "身上的效果（投影里的）");
  rows.forEach(r => {
    const u = O.pv.units.find(x => x.id === r.dataset.obUnit), card = R.cards.find(c => c.kit === u.kit);
    const [main, sub] = card.note.split("·")[1].split("/").map(s => R.ele[s.trim()]);
    assert.equal(r.querySelector(".face.av").getAttribute("style"), `background:linear-gradient(to bottom right, ${R.COL[main]}, ${R.COL[sub]})`, u.kit + "：主 → 副属性渐变");
  });
  noShp(hud.innerHTML, "联机新外壳的技能栏、队伍栏");
  // 拆掉：再画一遍就是原来的样子
  S.detach(hud);
  O.paint();
  assert.equal(hud.innerHTML, old, "关掉新画面：和以前一模一样");
  assert.equal(hud.querySelector(".hud-summon"), null, "单独的唤出按钮拿掉");
});

test("联机玩家：开着新画面时点技能 / 唤出按钮、悬停、数字键 / Q / 空格，走的都是现有的回调（online-ui.js 的 battleCb：onSkill → menu 问主机、onEnd）；关着时数字键照旧按主机给的整张表", () => {
  const R = rules();
  const O = onlineHud(R);
  const hud = O.hud, doc = O.page.doc, L = O.log;
  O.page.w.HD2DShell.attach(hud, { phone: false });
  O.paint();
  hud.querySelector('.skills .sk[data-ob-skill="kolt_aa"]').click();
  assert.deepEqual(L.skills, ["kolt_aa"], "点技能 = cb.onSkill");
  hud.querySelector('.skills .sk[data-ob-skill="kolt_short"]').click();
  assert.deepEqual(L.skills, ["kolt_aa"], "灰掉的点不了");
  hud.querySelector(".hud-summon > .summonbtn").click();
  assert.deepEqual(L.skills.slice(-1), ["kolt_summon"], "点唤出武器人 = cb.onSkill（同一条）");
  // 悬停：照旧弹技能说明（刚点过的按钮照旧先不弹，鼠标离开再回来才弹——online-battle.js 原来的 tipMuted）
  const sb = hud.querySelector(".hud-summon > .summonbtn");
  sb.dispatchEvent(new MD.Event("mouseover", { bubbles: true }));
  assert.equal(L.tips.length, 0, "刚点过：先不弹");
  sb.dispatchEvent(new MD.Event("mouseout", { bubbles: true, relatedTarget: doc.body }));
  sb.dispatchEvent(new MD.Event("mouseover", { bubbles: true }));
  assert.equal(L.tips[L.tips.length - 1][0], sb);
  assert.equal(L.tips[L.tips.length - 1][1], "技能说明 kolt_summon");
  // 快捷键
  L.skills.length = 0;
  MD.key(doc, "1"); MD.key(doc, "3"); MD.key(doc, "q"); MD.key(doc, "2");
  assert.deepEqual(L.skills, ["kolt_aa", "__move", "kolt_summon"], "1 / 3 按剩下的普通技能、Q 唤出、2 是灰掉的不理");
  MD.key(doc, " ");
  assert.equal(L.ends, 1, "空格结束行动");
  // 收起技能栏：快捷键照旧
  hud.querySelector(".hd2d-dock-toggle").click();
  MD.key(doc, "1");
  assert.deepEqual(L.skills.slice(-1), ["kolt_aa"]);
  // 关着：数字键照旧按主机给的整张表（3 = 唤出），Q 不管
  O.page.w.HD2DShell.detach(hud);
  O.paint();
  L.skills.length = 0;
  MD.key(doc, "3"); MD.key(doc, "q");
  assert.deepEqual(L.skills, ["kolt_summon"], "关着：3 = 表里第三个；Q 什么都不做");
  // 源码：新画面的按钮走的还是 data-ob-skill → cb.onSkill 那一条，不另开一条路
  const src = code(read("online-battle.js"));
  assert.match(src, /if \(sk && !sk\.disabled\) \{ if \(cb\.onSkill\) cb\.onSkill\(sk\.dataset\.obSkill\); return; \}/);
  assert.match(fnSrc(src, "paintSummon"), /b\.dataset\.obSkill = o\.value;/);
});

/* ---------- 4. 接进 hd2d-field.js：新画面建好 / 拆掉时换上 / 拆掉 ---------- */
/** 假的 3D 场景 */
function fakeScene(log) {
  return (stage, options) => {
    const sc = {
      portrait: false, motion: true, tier: "far", zone: null, flash: 0, stage, options, disposed: false,
      view: () => ({ width: 1100, height: 620, top: 0, bottom: 0 }), setInsets() {}, refit() {}, setWind() {}, setBattle() {}, setMarks() {}, setActor() {},
      lensNow: () => null, plateOf: () => null, zoneOf: () => null, setTier() {}, stepZone() {}, dispose() { sc.disposed = true; }
    };
    log.scenes.push(sc);
    return sc;
  };
}
test("hd2d-field.js：新画面建好时给单机的 .g-hud 换上新外壳、叫 game.js 再画一遍；关掉时拆掉、再画一遍；联机玩家进战斗挪到他的 .g-hud 上（单机的拆掉），离开战斗挪回来", async () => {
  const R = rules();
  const storage = memStorage([["backfire-hd2d-field", "on"]]);
  const page = uiPage(R, { storage, scripts: ["hd2d/hd2d-layout.js", "hd2d/hd2d-camera.js", "hd2d/hd2d-fx.js"] });
  const w = page.w, doc = page.doc;
  const log = { scenes: [], refreshes: 0 };
  w.HD2DWfx = { windOf: () => ({ x: 1, z: 0 }), create: () => ({ sync() {}, dispose() {} }) };
  w.GAME = { depth: 0, fxClock: () => 1, snapAll: () => null, refresh() { log.refreshes++; }, fieldInput: { unit() {}, hover() {}, zone() {}, zoneHover() {} } };
  vm.runInContext(read("hd2d/hd2d-field.js"), page.ctx, { filename: "hd2d/hd2d-field.js" });
  const F = w.HD2DField, S = w.HD2DShell;
  const hud = doc.querySelector("#g-app > .g-hud"), before = hud.outerHTML;
  F.boot({ doc, storage, load: () => Promise.resolve(fakeScene(log)), hint() {}, reduced: () => true });
  await settle();
  assert.equal(log.scenes.length, 1, "本机记着开：建好了");
  assert.equal(S.on(hud), true, "单机的 .g-hud 换上了新外壳");
  assert.equal(doc.getElementById("g-party").parentNode.className, "hd2d-party", "队伍栏挪进面板");
  assert.ok(log.refreshes >= 1, "建好以后叫 game.js 再画一遍（技能栏、队伍栏画成新样子）");
  // 关掉（减少动态效果：直接切）：拆掉新外壳，再画一遍
  const n = log.refreshes;
  assert.equal(F.switchTo("old"), true);
  await settle();
  assert.equal(S.on(hud), false, "关掉：新外壳拆掉");
  assert.equal(hud.outerHTML, before, ".g-hud 和以前一模一样");
  assert.ok(log.refreshes > n, "拆掉以后再画一遍（技能栏、队伍栏换回旧样子）");
  // 再打开；联机玩家进战斗：挪到他的 .g-hud 上（单机的拆掉），离开战斗挪回来
  F.switchTo("new");
  await settle();
  assert.equal(S.on(hud), true);
  const ol = doc.createElement("div");
  ol.className = "ol-battle";
  ol.innerHTML = '<main class="g-field ol-field"></main><footer class="g-hud ol-hud"><div class="party"></div><div class="hud-row"><div class="hi-gauge"></div><div class="skills"></div><div class="hud-side"><button class="endturn" type="button" data-ob="end">结束行动</button></div></div><div class="hint"></div></footer>';
  doc.body.appendChild(ol);
  const olHud = ol.querySelector(".g-hud"), olBefore = olHud.outerHTML;
  const spec = { field: () => ol.querySelector(".g-field"), app: () => ol, view: () => null, refresh() {} };
  const handle = F.attach(spec);
  await settle();
  assert.ok(handle && handle.on(), "联机玩家的新画面建好了");
  assert.equal(S.on(olHud), true, "联机玩家的 .g-hud 换上新外壳（spec 没给 hud() 就用 app() 里的那一个）");
  assert.equal(S.on(hud), false, "单机的拆掉");
  assert.equal(F.detach(spec), true);
  assert.equal(S.on(olHud), false, "离开战斗：联机的拆掉");
  assert.equal(olHud.outerHTML, olBefore, "联机的 .g-hud 也和以前一模一样");
  await settle();
  assert.equal(S.on(hud), true, "挪回单机（开关开着）");
  // 源码：建好 / 拆掉时才碰新外壳
  const src = code(read("hd2d/hd2d-field.js"));
  assert.match(fnSrc(src, "mount"), /app\.classList\.add\("hd2d-on"\);\s*const shell = root\.HD2DShell, hud = h\.hud \? h\.hud\(\) : null;\s*if \(shell && hud && shell\.attach\(hud, \{ storage: env\.storage \}\)\) S\.hud = hud;/);
  assert.match(fnSrc(src, "teardown"), /if \(S\.hud\) \{ if \(root\.HD2DShell\) root\.HD2DShell\.detach\(S\.hud\); S\.hud = null; \}/);
  assert.ok(F.FIELD.scripts.indexOf("hd2d-shell.js") > F.FIELD.scripts.indexOf("hd2d-ui.js"), "开了才加载 hd2d-shell.js（在 hd2d-ui.js 后面）");
});

/* ---------- 5. 样式：关着时一条都套不上；原型页和正式画面共用一份 ---------- */
test("样式（hd2d/hd2d.css）：新外壳的规则都要 .hd2d-shell（或者只有新样子才有的类），关着新画面时一条都套不上；原型页的技能栏 / 队伍栏和正式画面用同一份，原型页自己不再留一份", () => {
  const css = read("hd2d/hd2d.css");
  ["hd2d/hd2d.css", "prototypes/hd2d/hd2d-shell.css"].forEach(f => {
    const s = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"]*"/g, "");
    assert.equal((s.match(/\{/g) || []).length, (s.match(/\}/g) || []).length, f + "：大括号配得上");
  });
  const a = css.indexOf("/* ---------- 新画面的技能栏、队伍栏（#297"), b = css.indexOf("/* 「新画面 关 / 开」开关（#g-hd2d-toggle");
  assert.ok(a > 0 && b > a, "#297 那一段");
  const part = css.slice(a, b).replace(/\/\*[\s\S]*?\*\//g, "");
  const NEW = /hd2d-shell|\.sk\.t-|\.sk\.k-|\.sk-k-ic|\.stk\b|\.av-ic|\.pm-fx|\.hd2d-toggle|\.hd2d-who|\.hd2d-party-head|\.hd2d-tape/;
  const sels = [];
  part.replace(/(^|[{};])\s*([^{};@]+?)\s*\{/g, (m, p, sel) => { sels.push(sel.trim()); return m; });
  assert.ok(sels.length > 40, "规则都读到了");
  /** 按逗号拆一条选择器（:is(…) 里面的逗号不拆） */
  const split = (s) => { const out = []; let d = 0, cur = ""; for (const c of s) { if (c === "(") d++; if (c === ")") d--; if (c === "," && !d) { out.push(cur); cur = ""; } else cur += c; } out.push(cur); return out; };
  sels.forEach(sel => split(sel).forEach(s => assert.match(s.trim(), NEW, "关着新画面时也会套上：" + s.trim())));
  assert.match(part, /\.g-hud\.hd2d-shell\.dock-closed > \.hud-row \{ display: none; \}/, "收起技能栏：技能那一排藏起来");
  assert.match(part, /\.g-hud\.hd2d-shell > \.hd2d-party \{[^}]*position: absolute; left: 0; bottom: calc\(100% \+ 10px\)/, "队伍栏浮在战场左下角");
  assert.match(part, /\.g-hud\.hd2d-shell > \.hd2d-party\.collapsed > \.party[^{]*\{ display: none; \}/, "收起队伍栏");
  // 原型页：#dock / #party 挂着同一套类，技能按钮、队伍栏一个人、贴纸图标的样子不在原型页自己的 CSS 里
  const page = read("prototypes/hd2d/index.html"), proto = read("prototypes/hd2d/hd2d-shell.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(page, /<footer id="dock" class="panel collapsed hd2d-shell hd2d-theme">/);
  assert.match(page, /<aside id="party" class="panel collapsed hd2d-shell hd2d-theme">/);
  assert.match(page, /<div class="skills" id="skills"><\/div>/);
  assert.match(page, /<div class="list party" id="party-list"><\/div>/);
  assert.match(page, /<script src="\.\.\/\.\.\/hd2d\/hd2d-shell\.js"><\/script>/);
  assert.doesNotMatch(proto, /(^|\})\s*\.sk[\s.:{]|(^|\})\s*\.pm[\s.:{]|\.stk \.rim|\.pm-fx/, "原型页自己不再留一份技能按钮 / 队伍栏的样子");
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(page)[1];
  assert.match(mod, /SHELL\.wirePanel\(\$\("dock"\), \$\("dock-toggle"\), \{ name: "dock", open: !phone/, "收起 / 展开用共用的一份（记在本机）");
  assert.match(mod, /SHELL\.wirePanel\(\$\("party"\), \$\("party-toggle"\), \{ name: "party", open: !phone \}\)/);
  assert.doesNotMatch(mod, /function wirePanel\(/, "原型页不再自己写一份");
  // game.html 不直接加载 hd2d-shell.js（开了新画面才由 hd2d-field.js 加载）
  assert.doesNotMatch(read("game.html"), /hd2d-shell\.js/);
});

/* ---------- 6. 只用投影过的数据 ---------- */
test("只用该看的数据：头像、效果、技能按钮里没有坚毅生命；hd2d-shell.js 不读 shp；联机那边技能的提示查本机的技能表时拿的是收到的单位的副本（不改收到的包）", () => {
  const R = rules();
  const page = uiPage(R);
  const S = page.w.HD2DShell, U = page.w.HD2DUI;
  const pv = plain(R.OV.projectState(R.st, { itemCatalog: {} }));
  let html = "";
  pv.units.filter(u => u.isPlayer).forEach(u => {
    html += S.member(u, { tag: "你" });
    const hints = S.hintsOf(u);
    R.ctx.skillList(R.st.units.find(x => x.id === u.id)).forEach((sk, i) => {
      html += S.skillButton({ id: sk.id, name: sk.name, hint: hints[sk.id] || "" }, i, u, { key: i + 1 }).html;
    });
  });
  noShp(html, "队伍栏 / 技能按钮");
  // 不改收到的包：冻住的投影单位照样查得出提示
  const kolt = pv.units.find(u => u.kit === "kolt");
  const frozen = plain(kolt);
  (function deepFreeze(o) { Object.freeze(o); Object.values(o).forEach(v => { if (v && typeof v === "object" && !Object.isFrozen(v)) deepFreeze(v); }); })(frozen);
  const hints = S.hintsOf(frozen);
  assert.ok(hints.kolt_aa, "普通攻击的提示（本机的技能表）");
  assert.equal(U.skillKind({ id: "kolt_aa", hint: hints.kolt_aa }), "attack");
  assert.equal(Object.keys(S.hintsOf(null)).length, 0, "没有人：没有提示");
  // 代码里（去掉注释）不出现 shp
  assert.doesNotMatch(code(read("hd2d/hd2d-shell.js")), /shp|坚毅/i, "hd2d-shell.js 不读坚毅生命");
  assert.doesNotMatch(code(fnSrc(read("hd2d/hd2d-ui.js"), "partyInner")), /shp/i);
});

/* ---------- 7. 技能按钮的属性图标不带白描边（#317）---------- */
/** 技能按钮左上角的属性图标：只有属性色那一层（.c），没有白描边（icons.js 的 .o、贴纸的 .rim） */
function noRim(els, tag) {
  assert.ok(els.length >= 3, tag + "：有技能按钮");
  assert.ok(els.some(e => !e.classList.contains("none")), tag + "：有带属性的");
  els.forEach(e => {
    const svg = e.querySelector("svg.eicon");
    assert.ok(svg && svg.querySelector(":scope > .c"), tag + "：属性色那一层还在");
    assert.equal(svg.querySelectorAll(".o, .rim").length, 0, tag + "：属性图标没有白描边");
  });
}
test("技能按钮上的属性图标去掉白描边（#317，主人：白边让图标看不清）：单机、联机玩家、原型页的技能按钮都只画属性色那一层；头像、攻击 / 技能角标、别处的属性图标照旧带白边", () => {
  const R = rules(), kolt = R.unit("kolt");
  // 单机
  const page = uiPage(R);
  const H2 = soloHud(R, page);
  page.w.HD2DShell.attach(H2.hud, { phone: false });
  H2.refreshHud();
  noRim([...H2.hud.querySelectorAll("#g-skills .sk .sk-el")], "单机");
  const avs = [...H2.hud.querySelectorAll("#g-party .face.av")];
  assert.ok(avs.length >= 2, "队伍栏有头像");
  avs.forEach(a => assert.ok(a.querySelector(".stk > .rim") && a.querySelector(".stk > .ink"), "头像照旧：白边 + 墨线"));
  H2.hud.querySelectorAll("#g-skills .sk .sk-kind").forEach(k => assert.ok(k.querySelector(".stk > .rim"), "右上角攻击 / 技能角标照旧带白边"));
  assert.match(page.w.Icons.element("fire"), /<g class="o">/, "别处的属性图标（伤害数字、预览牌）照旧带白边");
  // 联机玩家
  const O = onlineHud(R);
  O.page.w.HD2DShell.attach(O.hud, { phone: false });
  O.paint();
  noRim([...O.hud.querySelectorAll(".skills .sk .sk-el")], "联机");
  O.hud.querySelectorAll(".party .face.av").forEach(a => assert.ok(a.querySelector(".stk > .rim"), "联机的头像照旧带白边"));
  // 原型页的技能按钮（同一份 hd2d-ui.js · skillInner）
  const U = page.w.HD2DUI, effects = R.codex.filter(e => e.element).map(e => [e.name, e.element]);
  const box = page.doc.createElement("div");
  box.innerHTML = R.ctx.skillList(kolt).map((s, i) => U.skillHtml(U.skillButton({ id: s.id, name: s.name, hint: s.hint }, R.OV.projectUnit(kolt), effects, i), page.w.Icons)).join("");
  noRim([...box.querySelectorAll(".sk .sk-el")], "原型页");
});

/* ---------- 8. 选技能 / 取消 / 选目标：按钮还是原来的节点，一下只画一遍（#317）---------- */
/** 从源码里抠出一个函数，前面有 async 的也带上 */
function fnSrcAsync(src, name) {
  const at = src.indexOf("function " + name + "(");
  return (src.slice(at - 6, at) === "async " ? "async " : "") + fnSrc(src, name);
}
/**
 * 单机：选技能那一条真的跑——armSkill → disarm → pickUnit、Esc / 点队伍栏换人 → disarm、点目标 → G.arm.resolve → 出手（act），
 * 连同技能栏 / 队伍栏（refreshHud）和快捷键，都从 game.js 抠出来。规则那边（分步 skillFlowSteps、预演 previewOf、能选的目标 candidateUnits）、
 * 战场上的标记换成假的；出手（act）照 game.js：花掉这个技能的行动点，演完 refreshAll 画一遍。paints() = refreshHud 一共画了几遍（数 refreshTop）
 */
function soloFlow(R, page) {
  const g = read("game.js");
  const helpers = ["esc", "el", "sumCur", "sumMax"].map(n => new RegExp("^  const " + n + " = .*$", "m").exec(g)[0]).join("\n");
  const fns = ["refreshHud", "isSummonSkill", "mainElementOf", "summonIcon", "disarm", "pickUnit", "canGiveUp", "selectActor"].map(n => fnSrc(g, n)).join("\n") +
    "\n" + fnSrcAsync(g, "armSkill") + "\n" + hudFns(g);
  const k0 = g.indexOf('document.addEventListener("keydown", (e) => {\n      // 只在战斗界面响应'), k1 = g.indexOf("(e) => {", k0);
  const keySrc = g.slice(k1, blockEnd(g, g.indexOf("{", k1)) + 1);
  const space = /const SPACE_SAFE = ("[^"]*");/.exec(g);
  const log = { acts: [], hints: [], paints: 0 };
  const enemies = R.st.units.filter(u => !u.isPlayer && !u.hidden);
  const V = {
    G: { actorId: R.unit("kolt").id, depth: 0, arm: null, ended: false, summonShown: null, skillsShown: null, skillTap: null, undo: [] },
    state: R.st, log, enemies,
    snapUnit: (u) => ({ dead: !!u.dead, dying: !!u.dying, stunned: !!u.stunned, ap: u.ap || 0, apMax: u.apMax || 0, bonus: u.bonus || 0, bonusMax: u.bonusMax || 0,
      layers: (u.layers || []).map(l => ({ type: l.type, cur: l.current, max: l.max })) }),
    gameSkills: (u) => (u && u.isPlayer ? R.ctx.skillList(u).map(s => Object.assign({}, s, { cost: R.ctx.skillCost(s.id) || {} })) : []),
    // 行动点不够的灰掉（出手花掉以后有的按钮跟着灰）
    blockReason: (u, sk) => (((sk.cost && sk.cost.ap) || 0) > (u.ap || 0) ? "行动点不足" : "")
  };
  page.w.HeroSheet = { tip() {}, hideTip() {}, skillTipHtml: () => "" };
  const make = new vm.Script(`(function (V) {
    const G = V.G, state = V.state;
    ${helpers}
    const $ = (id) => document.getElementById(id);
    const refreshTop = () => { V.log.paints++; }, hotseat = () => false, stopSkillPv = () => {}, touchUI = () => false, skillTapPv = () => false, scheduleSkillPv = () => {};
    const setHint = (h) => { V.log.hints.push(h); }, flashHint = (t) => { V.log.hints.push("flash:" + t); }, defaultHint = () => "";
    const markTargets = () => {}, unmarkTargets = () => {}, clearPreview = () => {}, showPickBar = () => {}, idleBox = () => {}, doUndo = () => {}, toggleFast = () => {};
    const unitById = (id) => state.units.find(u => u.id === id) || null;
    const isWeaponUnit = (u) => !!(u && u.weaponOf);
    const snapUnit = V.snapUnit, gameSkills = V.gameSkills, blockReason = V.blockReason, spaceStartOrEnd = () => {};
    const skillFlowSteps = () => [], skillThunk = () => null, previewOf = () => ({ needsTarget: true, meaningful: true }), candidateUnits = () => V.enemies;
    const targetName = (id) => id, animActor = (id) => id, allOnField = () => true, skillCommand = (actor, skill, target) => ({ actor, skill, target });
    // 出手：花掉行动点，演完照 refreshAll 画一遍。V.play（#362 的测试给）= 演出：照 game.js · act，演之前 G.depth++、画一遍，等它演完 G.depth--、再画一遍
    const act = (cmd) => {
      V.log.acts.push(cmd);
      const u = unitById(cmd.actor), c = (gameSkills(u).find(s => s.id === cmd.skill) || {}).cost || {};
      u.ap = Math.max(0, (u.ap || 0) - (c.ap || 0));
      if (V.play) { G.depth++; refreshHud(); return V.play().then(() => { G.depth--; refreshHud(); return true; }); }
      refreshHud();
      return Promise.resolve(true);
    };
    const cards = new Map();
    let hudEpoch = 0, hudPaints = 0, choiceResolve = null, choiceKeys = [];
    const SPACE_SAFE = ${space ? space[1] : '"button"'}, kbdFocus = () => false;
    ${fns}
    const onKey = ${keySrc};
    return { refreshHud, onKey, pick: (id) => G.arm.resolve(id) };
  })`, { filename: "game.js（抠出来的选技能那一条）" });
  const api = make.runInContext(page.ctx)(V);
  page.doc.addEventListener("keydown", api.onKey);
  return Object.assign(api, { V, log, paints: () => log.paints, hud: page.doc.querySelector("#g-app > .g-hud") });
}

test("单机（#317）：选技能、Esc 取消重复三次，再换人、点目标出手——技能按钮、队伍栏的人、唤出按钮一直是原来那几个节点；选技能 / 取消 / 换人一下只画一遍；只碰变了的那一个按钮", async () => {
  for (const shellOn of [true, false]) {
    const R = rules(), kolt = R.unit("kolt");
    kolt.ap = Math.max(2, kolt.apMax || 0); kolt.apMax = Math.max(kolt.apMax || 0, kolt.ap);
    const page = uiPage(R);
    const F = soloFlow(R, page);
    const hud = F.hud, doc = page.doc, tag = shellOn ? "新画面" : "旧画面";
    if (shellOn) page.w.HD2DShell.attach(hud, { phone: false });
    F.refreshHud();
    const skills = () => [...hud.querySelectorAll("#g-skills .sk")], pcs = () => [...hud.querySelectorAll("#g-party .pc")];
    const sk0 = skills(), pc0 = pcs(), summon = doc.getElementById("g-summon"), summonKids = [...summon.childNodes];
    const inner0 = sk0.map(b => [...b.querySelectorAll("*")]);
    assert.ok(sk0.length >= 3 && pc0.length >= 4 && !summon.hidden, tag + "：有技能按钮、队伍栏、唤出按钮");
    const aa = sk0.find(b => b.dataset.skill === "kolt_aa");
    assert.ok(aa, "普通攻击");
    const W = MD.watch([doc.getElementById("g-skills"), doc.getElementById("g-party"), summon]);
    const only = (node) => W.log.map(([k, x]) => [k, x === node]);
    try {
      for (let r = 0; r < 3; r++) {
        W.clear();
        let n = F.paints();
        aa.click();   // 选技能：armSkill → disarm → pickUnit
        await settle();
        assert.ok(F.V.G.arm && F.V.G.arm.skillId === "kolt_aa" && F.V.G.arm.mode === "unit", tag + "：在选目标");
        assert.equal(F.paints() - n, 1, tag + "：选技能一下只画一遍（以前 disarm、armSkill、pickUnit 各一遍）");
        assert.ok(aa.classList.contains("armed"), tag + "：选中的亮着");
        assert.deepEqual(only(aa), [["setAttribute", true]], tag + "：只改了选中的那个按钮的 class，别的按钮、队伍栏、唤出按钮一下都没碰");
        W.clear();
        n = F.paints();
        MD.key(doc, "Escape");   // 取消
        await settle();
        assert.equal(F.V.G.arm, null, tag + "：取消了");
        assert.equal(F.paints() - n, 1, tag + "：取消一下只画一遍");
        assert.ok(!aa.classList.contains("armed"));
        assert.deepEqual(only(aa), [["setAttribute", true]], tag + "：取消也只改那一个按钮的 class");
        assert.deepEqual(skills(), sk0, tag + "：技能按钮还是原来那几个节点");
        assert.deepEqual(pcs(), pc0, tag + "：队伍栏的人还是原来那几个节点");
      }
      // 数字键选技能；选着技能时点队伍栏换人
      let n = F.paints();
      MD.key(doc, "1");
      await settle();
      assert.equal(F.V.G.arm && F.V.G.arm.skillId, F.V.G.skillsShown[0].id);
      assert.equal(F.paints() - n, 1, tag + "：数字键选技能也只画一遍");
      // 里面的东西（图标、名字、费用）也没整块换：每个按钮里面的节点还是原来那些
      skills().forEach((b, i) => assert.deepEqual([...b.querySelectorAll("*")], inner0[i], tag + "：" + b.dataset.skill + " 里面没重画"));
      assert.deepEqual([...summon.childNodes], summonKids, tag + "：唤出按钮里面也没重画");
      const other = pc0.find(b => b.dataset.id && b.dataset.id !== kolt.id), mine = new Map(sk0.map(b => [b.dataset.skill, b]));
      n = F.paints();
      other.click();
      await settle();
      assert.equal(F.V.G.actorId, other.dataset.id);
      assert.equal(F.paints() - n, 1, tag + "：选着技能时点队伍栏换人只画一遍（以前 disarm 一遍、selectActor 一遍）");
      assert.deepEqual(pcs(), pc0, tag + "：换人以后队伍栏还是原来那几个节点（只换了谁亮着）");
      assert.ok(other.classList.contains("on") && !pc0.find(b => b.dataset.id === kolt.id).classList.contains("on"), tag + "：亮着的换了人");
      // 换了人技能也换了：两个人都有的（移动之类）还是原来那个按钮，柯尔特自己的拿掉
      const theirs = skills();
      assert.ok(theirs.some(b => !mine.has(b.dataset.skill)), tag + "：换成了这个人的技能");
      theirs.filter(b => mine.has(b.dataset.skill)).forEach(b => assert.equal(b, mine.get(b.dataset.skill), tag + "：两个人都有的 " + b.dataset.skill + " 还是原来那个按钮"));
      F.V.G.actorId = kolt.id; F.refreshHud();   // 换回柯尔特
      const sk1 = skills(), aa1 = sk1.find(b => b.dataset.skill === "kolt_aa"), inner1 = sk1.map(b => [...b.querySelectorAll("*")]);
      // 选目标出手：花掉行动点，演完画一遍
      aa1.click();
      await settle();
      const enemy = F.V.enemies[0], apBefore = kolt.ap;
      F.pick(enemy.id);
      await settle();
      assert.deepEqual(plain(F.log.acts.slice(-1)), [{ actor: kolt.id, skill: "kolt_aa", target: enemy.id }], tag + "：点目标出手");
      assert.ok(kolt.ap < apBefore, "花掉了行动点");
      assert.ok(!aa1.classList.contains("armed"), tag + "：出手以后不再亮着");
      assert.ok(skills().length === sk1.length && skills().every((b, i) => b === sk1[i]), tag + "：出手以后技能按钮还是原来那几个节点");
      skills().forEach((b, i) => assert.deepEqual([...b.querySelectorAll("*")], inner1[i], tag + "：出手以后 " + b.dataset.skill + " 里面没重画"));
      assert.deepEqual(pcs(), pc0, tag + "：出手以后队伍栏的人还是原来那几个节点");
    } finally { W.stop(); }
  }
});

test("联机玩家（#317）：选技能（问主机前后 online-ui.js · call() 各画一遍）、取消、选目标出手——技能按钮、队伍栏的人还是原来那几个节点；只碰变了的；纸片画面贴的纸纹留着", () => {
  for (const shellOn of [true, false]) {
    const R = rules(), O = onlineHud(R);
    const hud = O.hud, tag = shellOn ? "新画面" : "旧画面";
    if (shellOn) O.page.w.HD2DShell.attach(hud, { phone: false });
    O.paint();
    const skills = () => [...hud.querySelectorAll(".skills .sk")], pcs = () => [...hud.querySelectorAll(".party .pc")];
    const sk0 = skills(), pc0 = pcs(), inner0 = sk0.concat(pc0).map(b => [...b.querySelectorAll("*")]);
    assert.ok(sk0.length >= 3 && pc0.length >= 4, tag + "：有技能按钮、队伍栏");
    const aa = sk0.find(b => b.dataset.obSkill === "kolt_aa");
    // 纸片画面贴的纸纹（online-paper.js · dress：data-olp-tex、style 里的 --olp-tex，记过的不再贴）
    sk0.concat(pc0).forEach(b => { b.dataset.olpTex = "tag"; b.style.setProperty("--olp-tex", 'url("t")'); });
    const enemy = O.pv.units.find(u => !u.isPlayer && !u.hidden);
    const pickMenu = { kind: "unit", title: "普通攻击", options: [{ value: enemy.id, label: enemy.name }] };
    const same = (what) => {
      assert.ok(skills().length === sk0.length && skills().every((b, i) => b === sk0[i]), tag + "：" + what + "：技能按钮还是原来那几个节点");
      assert.ok(pcs().length === pc0.length && pcs().every((b, i) => b === pc0[i]), tag + "：" + what + "：队伍栏的人还是原来那几个节点");
      sk0.concat(pc0).forEach((b, i) => assert.deepEqual([...b.querySelectorAll("*")], inner0[i], tag + "：" + what + "：按钮里面没重画"));
      sk0.concat(pc0).forEach(b => assert.ok(b.dataset.olpTex === "tag" && b.style.getPropertyValue("--olp-tex") === 'url("t")', tag + "：" + what + "：纸纹还在"));
    };
    const W = MD.watch([hud.querySelector(".skills"), hud.querySelector(".party")]);
    try {
      // 选技能：先画一遍「正在同步」（按钮照旧灰掉），主机回了再画一遍（选中普通攻击、菜单换成选目标）
      O.ui.busy = true; O.paint();
      same("正在同步");
      assert.ok(skills().every(b => b.disabled), tag + "：正在同步：照旧都灰掉");
      O.ui.busy = false; O.ui.armed = "kolt_aa"; O.ui.menu = pickMenu; O.paint();
      same("选了技能");
      assert.ok(aa.classList.contains("armed") && !aa.disabled, tag + "：选中的亮着");
      assert.deepEqual(W.log.filter(([, x]) => pc0.some(b => b.contains(x))), [], tag + "：选技能前后队伍栏一下都没碰");
      // 不经过「正在同步」直接换选中的：只改那两个按钮的 class
      W.clear();
      O.ui.armed = "__move"; O.paint();
      const mv = sk0.find(b => b.dataset.obSkill === "__move");
      assert.deepEqual(W.log.map(([k, x]) => [k, x === aa || x === mv]), [["setAttribute", true], ["setAttribute", true]], tag + "：只改了换下来、换上去那两个按钮的 class");
      // 取消（Esc → onCancel → 问主机，前后各画一遍）
      O.ui.busy = true; O.paint();
      O.ui.busy = false; O.ui.armed = ""; O.ui.menu = { kind: "skill", options: O.skills }; O.paint();
      assert.ok(!skills().some(b => b.classList.contains("armed")), tag + "：取消了");
      same("取消");
      // 选目标出手：新的一包（柯尔特的行动点花掉了）
      O.ui.armed = "kolt_aa"; O.ui.menu = pickMenu; O.paint();
      const pv2 = plain(O.pv), k2 = pv2.units.find(u => u.id === O.kolt.id);
      k2.ap = Math.max(0, (k2.ap || 0) - 1);
      O.ui.armed = ""; O.ui.menu = { kind: "skill", options: O.skills };
      O.b.update(pv2, O.ui);
      assert.ok(!aa.classList.contains("armed"));
      assert.ok(skills().every((b, i) => b === sk0[i]) && pcs().every((b, i) => b === pc0[i]), tag + "：出手以后技能按钮、队伍栏的人还是原来那几个节点");
    } finally { W.stop(); }
  }
});

test("联机玩家（#317 追加）：只是在等主机回话才灰掉的技能 / 唤出 / 结束行动按钮挂 ob-wait，online.css 让它过 0.3 秒还没回才变灰（主机回得快就不闪）；本来就用不了的（blocked）不挂、照旧马上灰；回话了就摘掉", () => {
  for (const shellOn of [true, false]) {
    const R = rules(), O = onlineHud(R), hud = O.hud, tag = shellOn ? "新画面" : "旧画面";
    if (shellOn) O.page.w.HD2DShell.attach(hud, { phone: false });
    O.paint();
    const skills = () => [...hud.querySelectorAll(".skills .sk")];
    assert.ok(!skills().some(b => b.classList.contains("ob-wait")), tag + "：平时没有");
    O.ui.busy = true; O.paint();
    const wait = skills().filter(b => b.classList.contains("ob-wait"));
    assert.ok(wait.length >= 2 && wait.every(b => b.disabled), tag + "：等主机时灰掉的按钮挂 ob-wait");
    skills().filter(b => b.classList.contains("blocked")).forEach(b => assert.ok(!b.classList.contains("ob-wait"), tag + "：本来就用不了的不挂"));
    const end = hud.querySelector(".endturn");
    assert.ok(end.disabled && end.classList.contains("ob-wait"), tag + "：结束行动也是");
    O.ui.busy = false; O.paint();
    assert.ok(!skills().some(b => b.classList.contains("ob-wait")) && !end.classList.contains("ob-wait"), tag + "：回话了就摘掉");
  }
  const css = read("online.css");
  assert.match(css, /\.ob-wait:disabled \{ animation: ob-wait-dim \.32s step-end forwards; \}/, "过 0.3 秒才变灰");
  assert.match(css, /@keyframes ob-wait-dim \{ from \{ opacity: 1; \} to \{ opacity: \.4; \} \}/);
  assert.ok(!/\.sk\[disabled\],/.test(read("weather-fx.css")), "天气的灰按钮样式不盖等主机的那几个");
});

/* ---------- 9. 选中技能以后先收起技能栏（#362）：选目标时不挡战场，取景照收起之前的、镜头不重新取景 ---------- */
test("先收起技能栏（#362，hd2d-shell.js · fold / held）：开着的收起来（不记在本机、不算手动点过），这一段里再叫不再收，打完放开；本来就收着的不动；中间手动点开的以手动的为准；收着时页面自己展开（setPanel，手机上轮到你）不展开；没换上新外壳不报错", () => {
  const R = rules();
  const storage = memStorage();
  const page = uiPage(R, { storage });
  const S = page.w.HD2DShell, hud = page.doc.querySelector("#g-app > .g-hud");
  const closed = () => hud.classList.contains("dock-closed");
  assert.equal(S.fold(hud, true), false, "没换上新外壳：不动");
  assert.equal(S.held(hud), false);
  S.attach(hud, { phone: false });
  const btn = hud.querySelector(".hd2d-dock-toggle");
  assert.equal(closed(), false, "桌面：开着");
  // 选中技能：收起来，是这里收的；不记在本机，不算手动点过
  assert.equal(S.fold(hud, true), true);
  assert.ok(closed() && S.held(hud), "收起来了");
  assert.deepEqual([btn.textContent, btn.getAttribute("aria-expanded")], ["技能 ▲", "false"], "按钮上的字、读屏跟着");
  assert.equal(S.saved("dock", storage), null, "不记在本机");
  assert.equal(S.manual(hud, "dock"), false, "不算手动点过");
  assert.equal(S.fold(hud, true), true, "这一段里再叫：照旧收着");
  // 收着时页面自己要展开（联机纸片画面的手机上轮到你，online-ui.js · dockAuto → setPanel）：不展开
  assert.equal(S.setPanel(hud, "dock", true), true);
  assert.ok(closed() && S.held(hud), "setPanel 不在这一段里展开");
  // 打完这一下：放开
  assert.equal(S.fold(hud, false), false);
  assert.ok(!closed() && !S.held(hud), "打完放开");
  assert.deepEqual([btn.textContent, btn.getAttribute("aria-expanded")], ["技能 ▼", "true"]);
  assert.equal(S.saved("dock", storage), null, "放开也不记");
  assert.equal(S.fold(hud, false), false, "不在这一段里：不动");
  assert.equal(closed(), false);
  // 中间手动点开：以手动的为准——这一段里再叫不再收，打完也不动
  S.fold(hud, true);
  btn.click();
  assert.ok(!closed() && !S.held(hud), "手动点开了");
  assert.equal(S.fold(hud, true), false, "这一段里再叫：不再收");
  assert.equal(closed(), false);
  S.fold(hud, false);
  assert.equal(closed(), false, "打完也不动");
  assert.equal(S.saved("dock", storage), "open", "手动点的照旧记在本机");
  // 手动收着的：不算这里收的，打完也不展开
  btn.click();
  assert.equal(closed(), true);
  assert.equal(S.fold(hud, true), false, "本来就收着：不算这里收的");
  assert.equal(S.held(hud), false);
  S.fold(hud, false);
  assert.equal(closed(), true, "打完照旧收着");
  S.detach(hud);
  assert.equal(S.fold(hud, false), false, "拆掉了：不动");
  assert.equal(S.held(hud), false);
  // 手机：没记过时收着，轮到你页面自己展开（setPanel）；选目标收起、这一段里 setPanel 不展开；打完放开；不是你了照旧能收（setPanel）
  const P2 = uiPage(R, { storage: memStorage() }), S2 = P2.w.HD2DShell, hud2 = P2.doc.querySelector("#g-app > .g-hud");
  S2.attach(hud2, { phone: true });
  const closed2 = () => hud2.classList.contains("dock-closed");
  assert.equal(closed2(), true, "手机没记过：收着");
  S2.setPanel(hud2, "dock", true);
  assert.equal(closed2(), false, "轮到你：页面自己展开");
  S2.fold(hud2, true);
  S2.setPanel(hud2, "dock", true);
  assert.ok(closed2() && S2.held(hud2), "选目标：收起，轮到你的展开不打开它");
  S2.fold(hud2, false);
  assert.equal(closed2(), false, "打完放开");
  S2.setPanel(hud2, "dock", false);
  assert.equal(closed2(), true, "不是你了：页面照旧能收");
});

test("取景（#362，paper-ui.js · coverRects / dockHeight）：技能栏先收着的这一段，交给新画面的技能栏矩形照收起之前量到的、--olp-dock-h 照旧（null = 不写）——收起、打完再展开取景都不变；别的面板照常量；放开以后、手动收起的照常量", () => {
  const R = rules();
  const page = uiPage(R, { scripts: ["paper-ui.js"] });
  const PU = page.w.PaperUI, S = page.w.HD2DShell, doc = page.doc, hud = doc.querySelector("#g-app > .g-hud");
  S.attach(hud, { phone: false });
  const party = hud.querySelector(".hd2d-party");
  // 量到的大小（视口坐标）：技能栏开着 960 × 190、收起 560 × 90（都贴着底）
  const OPEN = { left: 240, top: 700, right: 1200, bottom: 890 }, FOLDED = { left: 440, top: 800, right: 1000, bottom: 890 };
  let box = OPEN, partyBox = { left: 10, top: 80, right: 246, bottom: 400 };
  const geo = (b) => Object.assign({ x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top }, b);
  hud.getBoundingClientRect = () => geo(box);
  party.getBoundingClientRect = () => geo(partyBox);
  Object.defineProperty(hud, "offsetHeight", { configurable: true, get: () => box.bottom - box.top });
  const sel = ["#g-app > .g-hud.hd2d-shell > .hd2d-party", "#g-app > .g-hud.hd2d-shell"];
  const rects = () => plain(PU.coverRects(doc, sel));
  assert.deepEqual(rects(), [partyBox, OPEN], "平时：照量到的");
  assert.equal(PU.dockHeight(hud), "190px");
  // 选中技能：技能栏收起（变矮、变窄）——取景照收起之前量到的，--olp-dock-h 照旧
  S.fold(hud, true);
  box = FOLDED;
  assert.deepEqual(rects(), [partyBox, OPEN], "收着的这一段：技能栏照收起之前量到的那一块");
  assert.equal(PU.dockHeight(hud), null, "--olp-dock-h 照旧（不写）");
  // 别的面板照常量（收着时点开 / 收起队伍）
  partyBox = { left: 10, top: 80, right: 80, bottom: 400 };
  assert.deepEqual(rects(), [partyBox, OPEN], "队伍栏照常量");
  // 打完放开：照常量（和选技能之前一样就是一样的，取景不变）
  S.fold(hud, false);
  box = OPEN;
  assert.deepEqual(rects(), [partyBox, OPEN]);
  assert.equal(PU.dockHeight(hud), "190px");
  // 手动收起的（不是这里收的）：照常量
  hud.querySelector(".hd2d-dock-toggle").click();
  box = FOLDED;
  assert.deepEqual(rects(), [partyBox, FOLDED], "手动收起的照常量");
  assert.equal(PU.dockHeight(hud), "90px");
  // 没换上新外壳 / 量不到：照旧
  S.detach(hud);
  assert.equal(PU.dockHeight(hud), "90px");
  assert.equal(PU.dockHeight(null), "");
  // 用到它的两处：单机 game-paper.js · dress、联机 online-ui.js · paperDress 写 --olp-dock-h 都先问它（null 不写）
  assert.match(code(read("game-paper.js")), /dockH = UI\.dockHeight\(hud\);\s*if \(dockH != null && /);
  assert.match(code(read("online-ui.js")), /dockH = global\.OnlinePaper\.dockHeight\(hud\);\s*if \(dockH != null && /);
});

test("单机（#362）：开着新画面时选技能、选目标，技能栏先收起；换技能照旧收着；Esc 取消就展开；点目标出手，演出中照旧收着，演完回到选技能再展开；不记在本机；手动收着的不动；旧画面不管", async () => {
  const R = rules(), kolt = R.unit("kolt");
  kolt.ap = Math.max(3, kolt.apMax || 0); kolt.apMax = Math.max(kolt.apMax || 0, kolt.ap);
  // 旧画面：选技能不收
  {
    const page = uiPage(R), F = soloFlow(R, page);
    F.refreshHud();
    F.hud.querySelector('#g-skills .sk[data-skill="kolt_aa"]').click();
    await settle();
    assert.ok(F.V.G.arm && F.V.G.arm.mode === "unit");
    assert.equal(F.hud.classList.contains("dock-closed"), false, "旧画面：不管");
  }
  const storage = memStorage();
  const page = uiPage(R, { storage });
  const F = soloFlow(R, page), hud = F.hud, S = page.w.HD2DShell, doc = page.doc;
  S.attach(hud, { phone: false });
  F.refreshHud();
  const closed = () => hud.classList.contains("dock-closed");
  const aa = () => hud.querySelector('#g-skills .sk[data-skill="kolt_aa"]');
  assert.equal(closed(), false, "平时开着");
  // 选技能 → 选目标：收起
  aa().click();
  await settle();
  assert.ok(F.V.G.arm && F.V.G.arm.mode === "unit", "在选目标");
  assert.ok(closed() && S.held(hud), "选中技能：技能栏收起来了");
  assert.equal(hud.querySelector(".hd2d-dock-toggle").textContent, "技能 ▲");
  // 换一个技能（数字键）：照旧收着
  MD.key(doc, "2");
  await settle();
  assert.ok(F.V.G.arm && F.V.G.arm.skillId !== "kolt_aa" && closed(), "换技能：照旧收着");
  // Esc 取消：回到选技能，展开
  MD.key(doc, "Escape");
  await settle();
  assert.equal(F.V.G.arm, null);
  assert.ok(!closed() && !S.held(hud), "取消：展开");
  // 点目标出手：演出中照旧收着，演完展开
  let done = null;
  F.V.play = () => new Promise(r => { done = r; });
  aa().click();
  await settle();
  assert.equal(closed(), true);
  F.pick(F.V.enemies[0].id);
  await settle();
  assert.equal(F.V.G.depth, 1, "演出中");
  assert.equal(F.V.G.arm, null);
  assert.ok(closed() && S.held(hud), "演出中照旧收着");
  done();
  await settle();
  assert.equal(F.V.G.depth, 0, "演完了");
  assert.ok(!closed() && !S.held(hud), "演完回到选技能：展开");
  assert.deepEqual(plain(F.log.acts.slice(-1)), [{ actor: kolt.id, skill: "kolt_aa", target: F.V.enemies[0].id }]);
  assert.equal(S.saved("dock", storage), null, "自己收起 / 展开的不记在本机");
  assert.equal(S.manual(hud, "dock"), false);
  // 手动收着的：选技能不算这里收的，取消以后照旧收着
  F.V.play = null;
  hud.querySelector(".hd2d-dock-toggle").click();
  assert.equal(closed(), true);
  aa().click();
  await settle();
  assert.ok(F.V.G.arm && closed() && !S.held(hud), "本来就收着：不算这里收的");
  MD.key(doc, "Escape");
  await settle();
  assert.equal(closed(), true, "取消以后照旧收着");
});

test("联机玩家（#362）：主机问目标 / 区域 / 选项时技能栏先收起，等主机、演出中照旧收着，回到选技能（主机给了技能栏、演完）或者不是你了再展开；不用选目标的（主机直接回「确认执行」）、规则询问（__field）不收；中间手动点开的不再收；旧画面不管", () => {
  const R = rules(), O = onlineHud(R), hud = O.hud, S = O.page.w.HD2DShell;
  const closed = () => hud.classList.contains("dock-closed");
  const enemy = O.pv.units.find(u => !u.isPlayer && !u.hidden);
  const target = { kind: "unit", key: "target", title: "选择目标", options: [{ value: enemy.id, label: enemy.name }] };
  const ask = { kind: "unit", title: "更换刀头", options: [{ value: enemy.id, label: enemy.name }] };
  const skills = { kind: "skill", options: O.skills }, ready = { kind: "ready", title: "确认执行", options: [] };
  const step = (patch, why, want) => { Object.assign(O.ui, patch); O.paint(); assert.equal(closed(), want, why); };
  // 旧画面：不管
  step({ armed: "kolt_aa", menu: target }, "旧画面：不收", false);
  step({ armed: "", menu: skills }, "旧画面", false);
  S.attach(hud, { phone: false });
  step({}, "新画面：平时开着", false);
  // 点技能：先问主机（正在同步）——还没收；主机回了问目标：收起
  step({ armed: "kolt_aa", menu: null, busy: true }, "还在问主机：不收", false);
  step({ busy: false, menu: target }, "主机问目标：收起", true);
  assert.ok(S.held(hud), "是这里收的");
  assert.match(hud.querySelector(".hint").innerHTML, /^<b>选择目标<\/b>[\s\S]*data-ob="cancel"/, "提示栏照旧写标题、取消按钮（收起时有标题 / 按钮的提示栏照旧露出来）");
  // 点目标：问主机 → 确认执行 → 提交了、还没拿到新的技能栏 → 演出中 → 主机给了新的技能栏但还在演——一直收着
  step({ busy: true }, "点了目标、问主机：照旧收着", true);
  step({ busy: false, menu: ready }, "确认执行：照旧收着", true);
  step({ armed: "", menu: null }, "提交了、还没拿到新的技能栏：照旧收着", true);
  step({ busy: true }, "演出中：照旧收着", true);
  step({ menu: skills }, "主机给了新的技能栏、还在演：照旧收着", true);
  step({ busy: false }, "演完、回到选技能：展开", false);
  assert.equal(S.held(hud), false);
  // 不用选目标的：主机直接回「确认执行」——不收
  step({ armed: "__move", menu: ready }, "不用选目标：不收", false);
  step({ armed: "", menu: skills }, "", false);
  // 换一个技能（主机问区域）：照旧收着；选目标时不是你了（超时、主持人跳过）：展开
  step({ armed: "kolt_aa", menu: target }, "", true);
  step({ armed: "__move", menu: { kind: "zone", key: "dest", title: "选择移动区域", options: [{ value: 2, label: "2 区" }] } }, "换技能、问区域：照旧收着", true);
  step({ armed: "", menu: null, acting: false }, "不是你了：展开", false);
  // 规则询问（战场点选，__field）：不是选了技能，不收；选着技能时来了询问也不展开
  step({ acting: true, armed: "__field", menu: ask }, "规则询问：不收", false);
  step({ armed: "kolt_aa", menu: target }, "", true);
  step({ armed: "__field", menu: ask }, "选着技能时来了规则询问：照旧收着", true);
  step({ armed: "", menu: skills }, "回到选技能：展开", false);
  // 中间手动点开：以手动的为准（这一段里不再收）
  step({ armed: "kolt_aa", menu: target }, "", true);
  hud.querySelector(".hd2d-dock-toggle").click();
  step({}, "手动点开了：再画也不收", false);
  step({ armed: "", menu: skills }, "", false);
});
