/* 角鳞 · 界面切换
 *
 * 游戏由几块「界面」组成，同一时间只显示一块：
 *   title    标题（新的一局 / 继续 / 战斗原型 / 跑团版计算器）
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

  return { register, show, current: () => current, is: (name) => current === name };
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
    return `第 ${run.act} 幕 · 第 ${run.day} 天 · ${names.join("、")}`;
  }

  function refreshTitle() {
    const run = typeof SaveStore !== "undefined" ? SaveStore.loadRun() : null;
    const cont = $("t-continue");
    cont.disabled = !run || !RunFlow.ready;
    $("t-continue-sub").textContent = run ? runSummary(run) : "没有进行中的一局";
    $("t-new").disabled = !RunFlow.ready;
    $("t-new-sub").textContent = RunFlow.ready ? "选择 2–4 名角色出发" : "单局流程在下一步（M1）接入";
  }

  // 单局流程（M1 实现）的入口。ready 为 false 时标题上的两个按钮是灰的。
  window.RunFlow = window.RunFlow || { ready: false, start() {}, resume() {} };

  function boot() {
    Screens.register("title", $("scr-title"), { onShow: refreshTitle });
    Screens.register("battle", $("g-app"), {
      // 隐藏时量不到尺寸，显示出来后按实际大小重新排一次战场
      onShow() { window.dispatchEvent(new Event("resize")); }
    });
    $("t-new").onclick = () => RunFlow.start();
    $("t-continue").onclick = () => RunFlow.resume();
    $("t-sandbox").onclick = () => {
      // 战斗原型用跑团版的规则：正常经验曲线；如果画面上还留着单局里的战斗，换回原型战斗
      if (typeof Rogue !== "undefined") Rogue.leaveRunMode();
      if (window.GAME && GAME.rogue && GAME.setupBattle) GAME.setupBattle(1);
      Screens.show("battle");
    };
    $("g-title").onclick = () => { if (!window.GAME || GAME.depth === 0) Screens.show("title"); };
    Screens.show("title");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
