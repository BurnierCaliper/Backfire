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
  ["icons.js", "hud-icons.js", "hd2d/hd2d-ui.js", "hd2d/hd2d-shell.js"].concat(opts.scripts || []).forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  return { P, w, ctx, doc: P.document };
}

/**
 * 单机：game.js 的技能栏 / 队伍栏（refreshHud 和它用到的 isSummonSkill / mainElementOf / summonIcon）、战斗画面的快捷键（boot 里那一个 keydown），
 * 从源码里抠出来放进页面里跑；出手流程的入口（armSkill 选技能、selectActor 切人、spaceStartOrEnd 结束回合）、技能表（gameSkills）、
 * 用不了的原因（blockReason）、悬停说明（HeroSheet）换成记下来的假的。opts.blocked = { 技能 id: 原因 }
 */
function soloHud(R, page, opts) {
  opts = opts || {};
  const g = read("game.js");
  const helpers = ["esc", "el", "sumCur", "sumMax"].map(n => { const m = new RegExp("^  const " + n + " = .*$", "m").exec(g); assert.ok(m, "game.js 有 " + n); return m[0]; }).join("\n");
  const fns = ["refreshHud", "isSummonSkill", "mainElementOf", "summonIcon"].map(n => fnSrc(g, n)).join("\n");
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
    let hudEpoch = 0, choiceResolve = null, choiceKeys = [];
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
  assert.match(src, /if \(shell\) \{\s*const nb = shell\.skillButton\(\{ id: sk\.id, name: sk\.name, hint: sk\.hint, cost: sk\.cost \}, i, actorView, \{ key: i < 9 \? i \+ 1 : "" \}\);\s*nb\.cls\.split\(" "\)\.forEach\(c => b\.classList\.add\(c\)\);\s*b\.innerHTML = nb\.html;/);
  assert.match(src, /wireSkill\(b, sk, why\);\s*box\.appendChild\(b\);/, "接点击 / 悬停的还是原来那一个");
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
