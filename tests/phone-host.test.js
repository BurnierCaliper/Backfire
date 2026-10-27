// #429 安卓手机（Chrome）当联机跑团主持人：战斗画面（纸片画面 + 新画面）在手机上能用——不用浏览器的那部分
// （要浏览器的在 tests/phone-host-ui.test.js、tests/phone-host-gm-ui.test.js）。
//   第 1 步：顶栏胶带（paper-ui.js · topHtml，单机 / 联机玩家同一份）在手机竖屏上远 / 中 / 近收成一个按钮；
//            放不下时右边的镜头、「工具 ▾」「菜单」不缩，左边的字按先后省略（online-paper.css；电脑上一条都套不上）
//   第 4 步：单机 / 房主手机上轮到这台机器出手时技能栏自己展开（game.js · refreshHud / localTurn / localReason）；「检定申请 · N」挂到技能栏上面（game-paper.css）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const UI = require("../paper-ui.js");
const OP = require("../online-paper.js");
const GP = require("../game-paper.js");

const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
/** CSS 里某一段 @media（照原样的条件）大括号里的内容 */
function mediaBody(css, cond) {
  const at = css.indexOf("@media " + cond + " {");
  if (at < 0) return null;
  let i = css.indexOf("{", at) + 1, depth = 1;
  const start = i;
  for (; i < css.length && depth; i++) { if (css[i] === "{") depth++; else if (css[i] === "}") depth--; }
  return css.slice(start, i - 1);
}
const CAMS = [{ label: "远", on: true }, { label: "中" }, { label: "近" }];

test("#429 顶栏：远 / 中 / 近后面多一个收成一个的按钮（.olp-cam-cyc）——写这一刻是哪一段，data-olp-cam-next 是下一段（远 → 中 → 近 → 远）；没有镜头就不画；联机、单机同一份", () => {
  const cyc = h => { const m = /<button type="button" class="olp-cam-cyc" data-olp-cam-next="(\d)" aria-label="([^"]*)">([^<]*)<\/button>/.exec(h); return m && { next: Number(m[1]), aria: m[2], label: m[3] }; };
  for (const P of [OP, UI.make(GP.GPAPER)]) {
    assert.deepEqual(cyc(P.topHtml({ cams: CAMS })), { next: 1, aria: "镜头 远：点一下换到 中", label: "远" });
    assert.deepEqual(cyc(P.topHtml({ cams: [{ label: "远" }, { label: "中", on: true }, { label: "近" }] })), { next: 2, aria: "镜头 中：点一下换到 近", label: "中" });
    assert.deepEqual(cyc(P.topHtml({ cams: [{ label: "远" }, { label: "中" }, { label: "近", on: true }] })), { next: 0, aria: "镜头 近：点一下换到 远", label: "近" });
    assert.deepEqual(cyc(P.topHtml({ cams: [{ label: "远" }, { label: "中" }, { label: "近" }] })), { next: 1, aria: "镜头 远：点一下换到 中", label: "远" }, "哪个都没亮：当成远景");
    assert.doesNotMatch(P.topHtml({}), /olp-cam/, "没有镜头按钮就不画");
    // 原来的三个照旧（电脑上就是它们）；读屏的字在配置表里
    const h = P.topHtml({ cams: CAMS });
    assert.equal((h.match(/class="olp-cam-b/g) || []).length, 3);
    assert.match(h, /data-olp-cam="0" aria-pressed="true"[^>]*>远</);
    assert.equal(P.PAPER.cam.next, "镜头 {0}：点一下换到 {1}");
  }
  // 点它：单机 game-paper.js、联机 online-ui.js 都按 data-olp-cam-next 点新画面原来那个按钮
  assert.match(read("game-paper.js"), /closest\("\[data-olp-cam\], \[data-olp-cam-next\]"\)[\s\S]{0,200}olpCamNext/);
  assert.match(read("online-ui.js"), /closest\("\[data-olp-cam\], \[data-olp-cam-next\]"\)[\s\S]{0,200}olpCamNext/);
});

test("#429 online-paper.css：收成一个的按钮平时藏着，手机竖屏那一段换上它（三个藏起来）；手机竖屏或触屏时胶带上右边那一组不缩，天气 / 时间 / 遭遇名 / 标题只拿剩下的地方（按先后），回合、行动、房间码照原样", () => {
  const css = read("online-paper.css");
  assert.match(css, /body\.ol-paper \.olp-cam-cyc \{\s*display: none;/, "平时（电脑上）藏着");
  const phone = mediaBody(css, OP.PAPER.phone.media);
  assert.ok(phone, "手机竖屏那一段");
  assert.match(phone, /body\.ol-paper \.olp-cam-b \{ display: none; \}/, "手机竖屏：三个收起来");
  assert.match(phone, /body\.ol-paper \.olp-cam-cyc \{ display: inline-block; \}/, "换成一个");
  const fit = mediaBody(css, "(max-width: 760px), (pointer: coarse)");
  assert.ok(fit, "手机竖屏或触屏（横过来）的那一段");
  assert.match(fit, /\.olp-top > \.olp-right \{ flex-shrink: 0; \}/, "右边的镜头、「工具 ▾」「菜单」不缩");
  assert.match(fit, /\.olp-top > :is\(\.olp-title, \.olp-sub, \.olp-time, \.olp-weather\) \{ flex-basis: 0; max-width: max-content; \}/, "只拿剩下的地方，最多照原样宽");
  const grow = k => Number((new RegExp("\\.olp-top > \\.olp-" + k + " \\{ flex-grow: (\\d+); \\}").exec(fit) || [])[1]);
  assert.ok(grow("weather") > grow("time") && grow("time") > grow("sub") && grow("sub") > grow("title") && grow("title") > 0, "先让给天气，再是时间、遭遇名，标题最后");
  assert.match(fit, /:is\(\.olp-title, \.olp-room, \.olp-meta\) \{ flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/, "放不下的省略成「…」");
  // 电脑上（鼠标、宽屏）照旧：基础那几条一个字没改
  assert.match(css, /body\.ol-paper \.olp-top > \* \{ flex-shrink: 0; \}/);
  assert.match(css, /body\.ol-paper \.olp-right \{ margin-left: auto; display: flex; align-items: center; gap: 10px; flex-shrink: 1; min-width: 0; \}/);
  assert.match(css, /body\.ol-paper \.olp-cam-b \{ width: 30px; padding: 0; color: var\(--olp-tape-ink\); background: transparent; \}/);
});

/* ---------- 第 2 步：触屏上键盘才有的操作都有看得见的按钮，提示不写按键 ---------- */
/** 从源码里抠出一个函数 / 一段 const（按大括号配对） */
function blockEnd(src, i) {
  for (let depth = 0; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  throw new Error("大括号没配上");
}
function fnSrc(src, name) {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at >= 0, "找不到 " + name);
  return src.slice(at, blockEnd(src, src.indexOf("{", src.indexOf(")", at))) + 1);
}
function constSrc(src, name) {
  const at = src.indexOf("const " + name + " = {");
  assert.ok(at >= 0, "找不到 " + name);
  return src.slice(at, blockEnd(src, src.indexOf("{", at)) + 1) + ";";
}
const vm = require("node:vm");
const GAME_JS = read("game.js");

test("#429 game.js · defaultHint：触屏（touchUI）不写 Tab、空格，写点头像换人、点「结束回合」（热座 / 联机是「结束单位行动」）结束；电脑上一个字不改", () => {
  const hint = (o) => vm.runInNewContext(`(function () {
    const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const G = { ended: false, actorId: "a" }, state = { combatStarted: true, combatPhase: "player" };
    const HotseatGame = { reason: () => "", isRequested: () => O.hotseat, getView: () => ({ playerId: "gm" }), withOperator: (id, fn) => fn() }, window = { HotseatGame };
    const hotseat = () => O.hotseat, touchUI = () => O.touch, unitById = id => ({ id, name: "瑞比", stunned: O.stunned });
    ${constSrc(GAME_JS, "TOUCH_TEXT")}
    ${fnSrc(GAME_JS, "localReason")}
    ${fnSrc(GAME_JS, "defaultHint")}
    return defaultHint();
  })()`, { O: o });
  assert.equal(hint({ touch: false }), "<b>瑞比</b>　选择技能。Tab 切换角色，空格结束回合。", "电脑上照旧");
  assert.equal(hint({ touch: false, stunned: true }), "<b>瑞比</b> 失衡中，本回合无法行动。Tab 切换角色。");
  assert.equal(hint({ touch: false, hotseat: true }), "<b>瑞比</b>　选择技能。Tab 切换角色，空格结束回合。");
  assert.equal(hint({ touch: true }), "<b>瑞比</b>　选择技能。点头像换人，点「结束回合」结束。");
  assert.equal(hint({ touch: true, hotseat: true }), "<b>瑞比</b>　选择技能。点头像换人，点「结束单位行动」结束。", "热座 / 联机：按钮上写的是「结束单位行动」");
  assert.equal(hint({ touch: true, stunned: true }), "<b>瑞比</b>　失衡中，本回合无法行动。点头像换人。");
  for (const o of [{ touch: true }, { touch: true, stunned: true }, { touch: true, hotseat: true }]) assert.doesNotMatch(hint(o), /Tab|空格|Esc|右键|数字键/);
});

test("#429 game.js · showPickBar：选目标时的「放弃」触屏上不写（Esc）；触屏点了技能先预演时的「取消」那一条（tap）点了收起预演，不碰选目标的那一条", () => {
  const { window, document } = require("./mini-dom").create('<div class="g-hud"><div class="hud-row"></div></div>');
  const run = (touch) => {
    document.querySelector(".g-hud").innerHTML = '<div class="hud-row"></div>';
    const calls = [];
    const api = vm.runInNewContext(`(function () {
      const $ = id => document.getElementById(id);
      const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
      const G = { arm: null }, touchUI = () => TOUCH, disarm = () => calls.push("disarm"), cancelSkillTap = () => calls.push("cancelSkillTap");
      ${constSrc(GAME_JS, "TOUCH_TEXT")}
      ${fnSrc(GAME_JS, "showPickBar")}
      return { showPickBar };
    })()`, { document, window, calls, TOUCH: touch });
    return { api, calls };
  };
  const labels = () => [...document.querySelectorAll("#g-pick-bar .g-btn")].map(b => b.textContent);
  let r = run(false);
  r.api.showPickBar([{ label: "不选，继续", value: "skip" }], true);
  assert.deepEqual(labels(), ["不选，继续", "放弃（Esc）"], "电脑上照旧");
  r = run(true);
  r.api.showPickBar([{ label: "不选，继续", value: "skip" }], true);
  assert.deepEqual(labels(), ["不选，继续", "放弃"], "触屏：不写 Esc");
  assert.equal(document.getElementById("g-pick-bar").dataset.tap, undefined);
  document.querySelector("#g-pick-bar .g-btn.danger").click();
  assert.deepEqual(r.calls, ["disarm"], "「放弃」= 取消正在选的技能");
  r.api.showPickBar([{ label: "取消", tapCancel: true }], false, true);
  assert.deepEqual(labels(), ["取消"]);
  assert.equal(document.getElementById("g-pick-bar").dataset.tap, "1", "记着是预演那一条");
  document.querySelector("#g-pick-bar .g-btn.danger").click();
  assert.deepEqual(r.calls, ["disarm", "cancelSkillTap"], "「取消」= 收起预演");
  r.api.showPickBar(null);
  assert.equal(document.getElementById("g-pick-bar").classList.contains("show"), false);
  assert.equal(document.getElementById("g-pick-bar").dataset.tap, undefined);
});

test("#429 game.js：触屏点了不用选目标的技能先预演时摆出「取消」，预演收了（取消、点别处、技能栏重画、第二下放出去）那一条也收；点别处取消认得唤出武器人的大按钮（以前第二下被当成点了别处）；开始 / 结束按钮的「空格」、唤出的「· Q」触屏不写", () => {
  const tap = fnSrc(GAME_JS, "skillTapPv"), stop = fnSrc(GAME_JS, "stopSkillPv"), hud = fnSrc(GAME_JS, "refreshHud");
  assert.match(tap, /showPickBar\(\[\{ label: TOUCH_TEXT\.tapCancel, tapCancel: true \}\], false, true\)/, "预演时摆出「取消」");
  assert.match(tap, /G\.skillTap = null; stopSkillPv\(true\); return false;/, "第二下放出去：先收起「取消」那一条");
  assert.match(stop, /if \(clear && !G\.skillTap\) \{ const bar = \$\("g-pick-bar"\); if \(bar && bar\.dataset\.tap\) showPickBar\(null\); \}/, "预演收了：只收「取消」那一条（选目标的那一条不动）");
  assert.match(GAME_JS, /if \(!G\.skillTap\) return;\s*const b = e\.target && e\.target\.closest \? e\.target\.closest\("#g-skills \.sk, #g-summon"\) : null;/, "点别处取消：唤出武器人的按钮也算「同一个按钮」");
  assert.match(fnSrc(GAME_JS, "cancelSkillTap"), /"#g-skills \.sk\.armed, #g-summon\.armed"/);
  assert.match(hud, /spaceKey = touchUI\(\) \? "" : "<small>空格<\/small>"/);
  assert.match(hud, /etText = "开始战斗" \+ spaceKey;[\s\S]*etText = "结束回合" \+ spaceKey;[\s\S]*etText = "结束单位行动" \+ spaceKey;/);
  assert.match(hud, /\$\{touchUI\(\) \? "" : " · Q"\}/);
  assert.deepEqual(JSON.parse(vm.runInNewContext(constSrc(GAME_JS, "TOUCH_TEXT") + " JSON.stringify(TOUCH_TEXT)")), { pick: "选择技能。点头像换人，点「{0}」结束。", stunned: "失衡中，本回合无法行动。点头像换人。", giveUp: "放弃", tapCancel: "取消" }, "触屏的说法在配置表里");
});

test("#429 CSS / 联机玩家：没有悬停时（触屏）技能的数字键、问答框选项前的数字和 Esc、「菜单」「继续」上的 Esc 都不画；联机玩家选目标时的「取消」触屏不写（Esc）", () => {
  const hoverNone = css => mediaBody(css, "(hover: none)") || "";
  assert.match(hoverNone(read("game.css")), /\.g-hud \.skills \.sk \.key, \.choice \.opts button \.key \{ display: none; \}/);
  assert.match(read("pause-menu.css"), /@media \(hover: none\) \{ \.pm-resume kbd \{ display: none; \} \}/);
  assert.match(hoverNone(read("online-paper.css")), /body\.ol-paper \.olp-menu-b kbd \{ display: none; \}/);
  assert.match(read("online-battle.js"), /data-ob="cancel">\$\{isTouch\(\) \? "取消" : "取消（Esc）"\}<\/button>/);
});

/* ---------- 第 3 步：触屏时点按目标至少 40×40；吊牌上的名字至少两个字 ---------- */
test("#429 CSS：手指点（pointer: coarse）时点按目标至少 40×40（胶带上的按钮、⇅、「延后 / 换位」、收起按钮、队伍头像、角色资料 / 武器 / 背包、技能、选目标的按钮条、抽屉标签、新画面的镜头和换区箭头），胶带跟着高；吊牌放不下横着滑、名字至少两个字；电脑上一条都套不上", () => {
  const css = read("online-paper.css"), coarse = mediaBody(css, "(pointer: coarse)"), phone = mediaBody(css, "(pointer: coarse) and (max-width: 760px)");
  assert.ok(coarse && phone, "触屏那两段");
  const has = (re, why) => assert.match(coarse, re, why);
  has(/body\.ol-paper \{ --olp-bar: 52px; --olp-under: 112px; \}/, "胶带高一点，下面的往下挪");
  assert.match(phone, /body\.ol-paper \{ --olp-bar: 48px; --olp-under: 106px; \}/);
  has(/:is\(\.olp-cam-b, \.olp-cam-cyc, \.olp-tools-b, \.olp-menu-b\) \{ min-width: 40px; min-height: 40px; \}/, "胶带上的按钮");
  has(/\.olp-swap \{[^}]*width: 40px; height: 40px;/, "⇅");
  has(/\.olp-move \{ min-height: 40px;/, "「延后 / 换位」");
  has(/\.hd2d-toggle \{ min-width: 40px; min-height: 40px; \}/, "「技能 ▲」「队伍 ▶」");
  has(/\.hd2d-party\.collapsed > \.party > \.pm \{ min-width: 40px; justify-content: center; \}/, "收起的队伍头像");
  has(/\.hd2d-party > \.party > \.pm \{ min-height: 40px; \}/);
  has(/\.pc-sheet \{ min-height: 40px; \}/, "角色资料 / 武器 / 背包");
  has(/\.skills \.sk\[data-olp-tex\] \{ min-height: 40px; \}/, "技能");
  has(/\.olp-tags \{ justify-content: flex-start; overflow-x: auto;/, "吊牌放不下横着滑");
  has(/\.olp-tag \{ flex: none; \}/, "吊牌不再挤");
  has(/:is\(\.olp-tag-nm, \.olp-tag-nm b\) \{ min-width: 2em; \}/, "名字至少两个字");
  assert.match(read("game-paper.css"), /@media \(pointer: coarse\) \{ body\.ol-paper\.g-paper \.g-app > \.g-hud\.hd2d-shell \.g-pick-bar \.g-btn \{ min-height: 40px; \} \}/, "选目标的按钮条");
  assert.match(mediaBody(read("hd2d/hd2d.css"), "(pointer: coarse)") || "", /\.hd2d-cam-b, \.hd2d-zone-nav, \.hd2d-toggle \{ min-width: 40px; min-height: 40px; \}/, "新画面的镜头、换区箭头、收起按钮");
  // 吊牌横着滑时把轮到的 / 点开 ⇅ 的那一张滑进来：联机、单机重画完都叫
  assert.equal(typeof UI.revealTag, "function");
  assert.equal(OP.revealTag, UI.revealTag);
  assert.match(read("game-paper.js"), /UI\.revealTag\(env\.box\.querySelector\("\.olp-tags-host"\)\)/);
  assert.match(read("online-ui.js"), /OP\.revealTag\(q\("\.olp-tags-host"\)\)/);
  // 电脑上：基础那几条照旧
  assert.match(css, /body\.ol-paper \{\s*--olp-top: 6px;[^}]*--olp-bar: 46px;[^}]*--olp-under: 100px;/);
  assert.match(css, /body\.ol-paper \.olp-swap \{ margin-left: auto; padding: 2px 4px; font-size: 14px;/);
});

/* ---------- 第 4 步：单机 / 房主手机上轮到这台机器出手时技能栏自己展开；「检定申请 · N」挂到技能栏上面 ---------- */
/** game.js 的 localReason / localTurn 抠出来跑：HotseatGame 换成假的——reason 照「这一刻按谁问」（commandOperator：执行玩家发来的指令时是发指令的人）给原因 */
function turnFns(o) {
  return vm.runInNewContext(`(function () {
    const G = { ended: !!O.ended }, state = { combatStarted: O.started !== false, combatPhase: O.phase || "player" };
    let op = null;
    const HotseatGame = {
      getView: () => ({ playerId: "gm", currentUnitId: "u1" }), currentUnit: () => "u1",
      withOperator(id, fn) { const prev = op; op = id; try { return fn(); } finally { op = prev; } },
      reason: (u) => ((op || "gm") === (O.owner || "gm") ? "" : "不是你的角色或武器人")
    };
    const hotseat = () => !!O.hotseat, unitById = id => ({ id });
    ${fnSrc(GAME_JS, "localReason")}
    ${fnSrc(GAME_JS, "localTurn")}
    return { localReason, localTurn, HotseatGame };
  })()`, { O: o });
}
test("#429 game.js · localTurn：开打了、我方回合、没结束才算轮到这台机器；热座 / 联机还要轮到的那个人这台机器的操作者能动——执行玩家「甲」发来的指令时（reason 按甲问）也按这台机器的操作者问（以前「结束单位行动」灰着、技能栏不展开）", () => {
  assert.equal(turnFns({}).localTurn(null), true, "一个人打：我方回合");
  assert.equal(turnFns({ started: false }).localTurn(null), false, "开战前");
  assert.equal(turnFns({ phase: "enemy" }).localTurn(null), false, "敌人回合");
  assert.equal(turnFns({ ended: true }).localTurn(null), false, "打完了");
  const mine = turnFns({ hotseat: true, owner: "gm" }), theirs = turnFns({ hotseat: true, owner: "p-1" });
  assert.equal(mine.localTurn(), true, "轮到主持人的英雄");
  assert.equal(theirs.localTurn(), false, "轮到甲的英雄");
  // 甲发来「结束单位行动」，执行到一半画技能栏：HotseatGame.reason 按甲问会说「不是你的角色」，localReason 照旧按主持人问
  assert.equal(mine.HotseatGame.withOperator("p-1", () => mine.HotseatGame.reason({ id: "u1" })), "不是你的角色或武器人", "（假的 reason 照发指令的人问）");
  assert.equal(mine.HotseatGame.withOperator("p-1", () => mine.localReason({ id: "u1" })), "");
  assert.equal(mine.HotseatGame.withOperator("p-1", () => mine.localTurn()), true);
  assert.equal(theirs.HotseatGame.withOperator("p-1", () => theirs.localTurn()), false, "甲的英雄：这台机器照旧不算");
  assert.equal(turnFns({ hotseat: false }).localReason({ id: "u1" }), "", "不是热座：没有原因");
});

test("#429 game.js · refreshHud：手机竖屏（paper-ui.js · BASE.phone.media）上技能栏没手动点过时，照联机玩家（#311，dockAuto）轮到这台机器出手（演出播完）展开、不是就收起；「结束单位行动」灰不灰、提示都按这台机器的操作者问", () => {
  const hud = fnSrc(GAME_JS, "refreshHud");
  assert.match(hud, /PaperUI\.dockAuto\(\{ phone: phonePaper\(\), manual: shell\.manual\(hudEl, "dock"\), mine: localTurn\(hsView\), busy: G\.depth > 0 \}\)/);
  assert.match(hud, /if \(want != null\) shell\.setPanel\(hudEl, "dock", want\);/);
  assert.ok(hud.indexOf("shell.fold(hudEl, true)") < hud.indexOf("PaperUI.dockAuto"), "先收 / 放开选中技能那一段（#362），再看轮到谁：先收着的那一段 setPanel 不展开");
  assert.match(hud, /et\.disabled = et\.disabled \|\| !!localReason\(unitById\(HotseatGame\.currentUnit\(\)\), hsView\)/);
  assert.match(fnSrc(GAME_JS, "defaultHint"), /const why = localReason\(a\);/);
  assert.match(fnSrc(GAME_JS, "phonePaper"), /matchMedia\(PaperUI\.BASE\.phone\.media\)/, "多窄算手机：和联机玩家、online-paper.css 手机那一段同一个");
  assert.equal(UI.BASE.phone.media, "(max-width: 760px)");
});

test("#429 game-paper.css：联机房主的「检定申请 · N」手机竖屏 / 手指点时挂在技能栏上面（--olp-dock-h），不压住「技能 ▲」；战斗记录抽屉切到「小队」时「收起 ▸」也留着；电脑上照旧（online.css 那两条没动）", () => {
  const css = read("game-paper.css"), fit = mediaBody(css, "(max-width: 760px), (pointer: coarse)");
  assert.ok(fit, "手机竖屏或手指点的那一段");
  assert.match(fit, /body\.ol-paper\.g-paper \.crq-pill \{ bottom: calc\(var\(--olp-dock-h, 190px\) \+ 12px\); \}/);
  assert.match(fit, /body\.ol-paper\.g-paper \.g-app > \.g-log\.gp-drawer\.ol-chat-mode > \.gp-drawer-tab \{ display: block !important; \}/);
  const rest = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(fit, "");
  assert.doesNotMatch(rest, /\.crq-pill|\.ol-chat-mode/, "别处（电脑上）不碰它们");
  const online = read("online.css");
  assert.match(online, /\.crq-pill \{ position: fixed; inset: auto auto 12px 12px; z-index: 95; min-height: 44px; \}/);
  assert.match(online, /\.ol-chat-mode > :not\(\.ol-host-tabs\):not\(\.ol-host-chat\) \{ display: none !important; \}/, "切到小队只留标签和聊天：那一条照旧（抽屉的标签在这里另外留着）");
});

/* ---------- 第 5 步：手机横过来（矮、手指点）队伍栏、技能栏默认收起 ---------- */
test("#429 hd2d-shell.js：手机横过来（矮于 500、手指点：SHELL.short）没记过时技能栏、队伍栏也默认收起（以前 915×412 时两块都开着，把战场整个盖住）；竖屏手机照旧收起；电脑（宽屏、矮窗口用鼠标）照旧展开；记过的照记着的", () => {
  const SH = require("../hd2d/hd2d-shell.js").SHELL;
  assert.equal(SH.short, "(max-height: 499px) and (pointer: coarse)");
  assert.equal(SH.phone, "(max-width: 720px)", "竖屏手机那一条没动");
  const attach = (match, saved) => {
    const store = new Map(Object.entries(saved || {}));
    const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
    const P = require("./mini-dom").create('<div id="g-app"><div class="g-hud"><div class="party" id="g-party"></div><div class="hud-row"></div></div></div>', { storage, media: q => match.includes(q) });
    const ctx = vm.createContext(P.window);
    for (const f of ["hd2d/hd2d-ui.js", "hd2d/hd2d-shell.js"]) vm.runInContext(read(f), ctx, { filename: f });
    const S = P.window.HD2DShell, hud = P.document.querySelector(".g-hud"), phone = S.phoneNow();
    S.attach(hud, { storage });
    return { phone, dock: !hud.classList.contains("dock-closed"), party: !hud.querySelector(".hd2d-party").classList.contains("collapsed") };
  };
  assert.deepEqual(attach([SH.short]), { phone: true, dock: false, party: false }, "手机横过来：都收起");
  assert.deepEqual(attach([SH.phone]), { phone: true, dock: false, party: false }, "竖屏手机：照旧收起");
  assert.deepEqual(attach([]), { phone: false, dock: true, party: true }, "电脑（宽屏，或者矮窗口但是鼠标，SHELL.short 套不上）：照旧展开");
  assert.deepEqual(attach([SH.short], { [SH.keys.dock]: "open", [SH.keys.party]: "open" }), { phone: true, dock: true, party: true }, "手动点开过的照本机记着的");
});
