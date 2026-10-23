/* 角鳞 · 界面切换
 *
 * 游戏由几块「界面」组成，同一时间只显示一块：
 *   title    标题（新的一局 / 继续 / 跑团模式 / 跑团版计算器）
 *   battle   战斗（game.js 那一整块）
 * 之后的任务板、任务节点、休整、幕间选择等，都是在这里 register 一块新界面。
 *
 *   Screens.register("board", el, { onShow(arg) {…}, onHide() {…} });
 *   Screens.show("board", arg);
 *
 * 当前界面写在 <body data-screen="…">，战斗的快捷键只在 battle 界面生效。
 */
const Screens = (function () {
  "use strict";

  const list = {};
  let current = null;

  function register(name, el, hooks) {
    list[name] = Object.assign({ el }, hooks || {});
    if (el && name !== current) el.hidden = true;
  }

  function show(name, arg) {
    const next = list[name];
    if (!next) throw new Error("没有这个界面：" + name);
    const prev = current && list[current];
    if (prev && current !== name) {
      if (prev.el) prev.el.hidden = true;
      if (prev.onHide) prev.onHide();
    }
    current = name;
    if (next.el) next.el.hidden = false;
    document.body.dataset.screen = name;
    if (next.onShow) next.onShow(arg);
  }

  Commands.register("screen", cmd => show(cmd.name, cmd.arg), {
    domain: "screens",
    validate(cmd) {
      if (cmd.action !== "show" || typeof cmd.name !== "string") throw new Error("未知界面指令");
    }
  });
  function dispatchShow(name, arg) {
    const command = { type: "screen", action: "show", name };
    if (arg !== undefined) command.arg = arg;
    return dispatch(command);
  }
  return { register, show: dispatchShow, current: () => current, is: (name) => current === name };
})();

/* ---------- 标题界面 ---------- */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);

  function runSummary(run) {
    const names = (run.party || []).map(h => {
      const card = typeof livePartyCards === "function" ? livePartyCards().find(c => c.kit === h.kit) : null;
      return card ? card.name : h.kit;
    });
    if (run.growth) return `长线养成 · 第 ${run.day} 天 · ${names.join("、")}`;
    return `${run.solo ? "单人模式 · " : ""}第 ${run.act} 幕 · 第 ${run.day} 天 · ${names.join("、")}`;
  }

  function refreshTitle() {
    const run = typeof SaveStore !== "undefined" ? dispatch({ type: "run.session", action: "readSaved" }) : null;
    const growth = typeof SaveStore !== "undefined" ? dispatch({ type: "run.session", action: "readGrowth" }) : null;
    // 更新版本的游戏存的档：这一版读不了，但不能说成「没有」（开新局前也会提醒会覆盖）
    const newer = !run && typeof SaveStore !== "undefined" && dispatch({ type: "run.session", action: "savedStatus" }) === "newer";
    const cont = $("t-continue");
    cont.disabled = !run || !RunFlow.ready;
    $("t-continue-sub").textContent = run ? runSummary(run) : newer ? "有一局更新版本的游戏存下的进度，这一版读不了" : "没有进行中的一局";
    $("t-new").disabled = !RunFlow.ready;
    if ($("t-solo")) $("t-solo").disabled = !RunFlow.ready;
    if ($("t-growth")) {
      $("t-growth").disabled = !RunFlow.ready;
      const sub = $("t-growth-sub");
      if (sub) sub.textContent = growth ? runSummary(growth) : "独立存档 · 每天获得赫心融合体 · 角色永久死亡后从 1 级重新培养";
    }
    if ($("t-daily")) {
      $("t-daily").disabled = !RunFlow.ready;
      // 今天的种子和队伍（rogue.js · dailySeed / dailyParty）
      try { const seed = Rogue.dailySeed(); $("t-daily-sub").textContent = `${seed.slice(6)} · ${Rogue.dailyParty(seed).map(Rogue.heroName).join("、")} · 专长 4 选 1`; } catch (e) { /* 留默认说明 */ }
    }
    $("t-new-sub").textContent = RunFlow.ready ? "选择 2–4 名角色出发" : "单局流程在下一步（M1）接入";
  }

  // 单局流程（M1 实现）的入口。ready 为 false 时标题上的两个按钮是灰的。
  window.RunFlow = window.RunFlow || { ready: false, start() {}, resume() {} };

  // 标题画面的两级菜单：home（本地玩法 / 联机玩法）→ 对应子菜单
  let titleView = "home";
  function showTitleView(view, focus = true) {
    const from = titleView; titleView = view;
    const home = $("t-home"); if (!home) return;
    home.hidden = view !== "home";
    document.querySelectorAll("#scr-title .t-panel").forEach(p => { p.hidden = p.dataset.view !== view; });
    if (!focus) return;
    const target = view === "home" ? $("t-" + from) : document.querySelector(`#t-panel-${view} .t-btn:not(:disabled)`);
    if (target) target.focus();
  }

  function boot() {
    Screens.register("title", $("scr-title"), { onShow() {
      // 回到标题就不在跑团里了：不管从哪条路回来，都把跑团模式关掉（单局 / 每日挑战 / 训练场都从标题开，不能带着跑团规则；报告 H1）
      if (typeof TRPG !== "undefined" && TRPG.active && !(window.HotseatGame && HotseatGame.isActive()) && window.TrpgFlow && TrpgFlow.leave) TrpgFlow.leave();
      showTitleView("home", false); refreshTitle();
    } });
    document.querySelectorAll("#scr-title [data-view]").forEach(b => { if (b.tagName === "BUTTON") b.onclick = () => showTitleView(b.dataset.view); });
    document.querySelectorAll("#scr-title [data-back]").forEach(b => { b.onclick = () => showTitleView("home"); });
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape" || e.defaultPrevented || titleView === "home") return;
      const scr = $("scr-title"); if (!scr || scr.hidden) return;
      if (document.querySelector("dialog[open]")) return;
      if (e.target && e.target.matches && e.target.matches("input, textarea, select")) return;
      e.preventDefault(); showTitleView("home");
    });
    Screens.register("battle", $("g-app"), {
      // 隐藏时量不到尺寸，显示出来后按实际大小重新排一次战场
      onShow() {
        window.dispatchEvent(new Event("resize"));
        // 开战前的大字：切到战斗画面之后再弹（同一刻新布置的战斗会自己弹，这里只补还没弹过的）
        setTimeout(() => { if (window.GAME && GAME.showPendingIntro) GAME.showPendingIntro(); }, 0);
      },
      // 离开战斗画面：瞄准线、敌人攻击指向和还在播的攻击演出一起收掉（别留在标题 / 任务板上）
      onHide() {
        if (window.AttackFx) { AttackFx.clearAim(); AttackFx.clearThreat(); AttackFx.skip(); }
      }
    });
    $("t-new").onclick = () => RunFlow.start();
    if ($("t-solo")) $("t-solo").onclick = () => RunFlow.start({ solo: true });
    if ($("t-growth")) $("t-growth").onclick = () => {
      const growth = typeof SaveStore !== "undefined" ? dispatch({ type: "run.session", action: "readGrowth" }) : null;
      if (growth && RunFlow.resumeGrowth) RunFlow.resumeGrowth();
      else RunFlow.start({ growth: true });
    };
    if ($("t-daily")) $("t-daily").onclick = () => RunFlow.startDaily && RunFlow.startDaily();
    $("t-continue").onclick = () => RunFlow.resume();
    if ($("t-codex")) $("t-codex").onclick = () => { if (window.Bestiary) Bestiary.open({ mode: "hero", sub: "主菜单" }); };
    if ($("t-rules")) $("t-rules").onclick = () => { if (window.Bestiary) Bestiary.open({ mode: "rules", sub: "主菜单" }); };   // 规则说明：图鉴的「规则」一本（rulebook.js）
    $("t-sandbox").onclick = () => {
      // 没加载 trpg-ui.js 时的后备：直接进战斗画面（trpg-ui.js 会把这个按钮换成进探索环节）
      dispatch({ type: "run.session", action: "sandbox" }, { setupBattle() {
        if (window.GAME && GAME.rogue && GAME.setupBattle) GAME.setupBattle(1);
      } });
      Screens.show("battle");
    };
    $("g-title").onclick = () => {
      // 跑团战斗：走跑团自己的离开流程（放弃没打完的战斗、存团、关掉跑团规则；报告 H1）
      if (typeof TRPG !== "undefined" && TRPG.active && window.TrpgFlow && TrpgFlow.titleFromBattle) { TrpgFlow.titleFromBattle(); return; }
      if (!window.GAME || GAME.depth === 0) Screens.show("title");
    };
    Screens.show("title");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
