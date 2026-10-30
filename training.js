/* Antlerscale: Backfire · 训练场
 * 和 tools/dpt.js（自动搜最优输出循环）用同一套布置，手动打一遍对照：
 *   场地两区直排、常态天气、没有场地效果、关闭属性克制表（state.noChart）；
 *   角色走单局的升级流程到指定等级（主属性加点、第一个合法奖励），武器等级 = clamp(round(等级 × 0.6), 1, 10)，满血；
 *   训练假人：血量 = 同等级 4 人队伍精英「警卫队队长（牛）」，掉到一半以下补满（掉的血照记）、被打死也拉回来；
 *   架势极高打不进失衡；不行动（ai.js 看 trainingDummy）。
 *   柯尔特：假人打不碎，「被摧毁的敌人血量层」的废料按每 3 个回合一次精英牛护盾层注入。
 * 训练场还可以改：假人的血量层（照精英牛原样 / 自己配 1–3 层，总血量不变、平分）、天气、两个区各自的场地和高地、算不算属性克制。
 *   不改就是上面的默认布置（tools/dpt.js 用的就是默认）。
 * Training.setupField(kit, level, opts) 规则层（无界面）也能用；Training.open() 是标题画面上的入口。
 * 训练场只改内存里的局面，不存档；离开时重新载入页面，原来的跑团 / 单局进度照旧。 */
(function (root) {
  "use strict";
  const HEROES = ["ruby", "yuito", "hiaki", "tou", "xia", "chuan", "nora", "kolt", "helu", "ras", "longge"];
  const MAIN_ATTR = { tou: "con", yuito: "int", xia: "str", ruby: "int", hiaki: "str", chuan: "int", nora: "int", kolt: "str", helu: "int", ras: "int", longge: "int" };
  const DUMMY_NAME = "训练假人";
  const DUMMY_DEF = 1e6;
  const REFILL_AT = 0.5;
  const TURNS = 8;
  // 假人的血量层：层 id 和层名都读 engine.js · LAYER（#510：全项目只留一份层名，这里不另写）
  const WEATHERS = [["none", "常态"], ["heat", "酷暑"], ["snow", "雪天"], ["acid", "酸雨"], ["thunder", "雷鸣"], ["glow", "微光"], ["sand", "沙暴"], ["phase", "相位"]];
  const FIELDS = [["", "无"], ["fire", "火场"], ["electric", "高压场地"], ["acid", "酸液地面"], ["ice", "冻土"], ["energy", "能量场"], ["harmonic", "干涉场地"], ["heal", "治愈场地"]];
  /** 默认布置（和自动搜索一样） */
  const DEFAULT_OPTS = { layers: ["flesh"], weather: "none", fields: { 1: "", 2: "" }, high: { 1: false, 2: false }, chart: false };
  function normOpts(o) {
    o = Object.assign({}, DEFAULT_OPTS, o || {});
    o.fields = Object.assign({ 1: "", 2: "" }, o.fields || {});
    o.high = Object.assign({ 1: false, 2: false }, o.high || {});
    if (o.layers !== "ox") o.layers = (Array.isArray(o.layers) ? o.layers : ["flesh"]).filter(t => LAYER[t]).slice(0, 3);
    if (Array.isArray(o.layers) && !o.layers.length) o.layers = ["flesh"];
    if (!WEATHERS.some(w => w[0] === o.weather)) o.weather = "none";
    return o;
  }
  /** 一行字说明这次的布置（面板和战斗记录用） */
  function optsText(o) {
    o = normOpts(o);
    const layers = o.layers === "ox" ? "血量层照精英牛" : "血量层 " + o.layers.map(t => LAYER[t]).join(" → ");
    const wName = (WEATHERS.find(w => w[0] === o.weather) || [])[1];
    const zone = z => [(FIELDS.find(f => f[0] === o.fields[z]) || [])[1], o.high[z] ? "高地" : ""].filter(x => x && x !== "无").join("+") || "无场地";
    return `${layers} · ${wName} · 1 区 ${zone(1)} · 2 区 ${zone(2)} · ${o.chart ? "算属性克制" : "不算属性克制"}`;
  }

  function chooseLevels(R, run) {
    for (let guard = 0; guard < 100; guard++) {
      const p = R.pendingChoices(run)[0];
      if (!p) return;
      const opts = R.choiceOptions(run, p.kit, p.index);
      if (!opts.length) throw new Error(`No upgrade choices for ${p.kit}`);
      const pick = (p.choice.type === "attr" && (opts.find(o => o.value === MAIN_ATTR[p.kit]) || opts.find(o => o.value === "con"))) || opts[0];
      R.choose(run, p.kit, p.index, pick.value);
    }
    throw new Error("Upgrade selection exceeded 100 choices");
  }

  /** 布置：角色按单局升级流程到 level 级，站 1 区；训练假人在 2 区。opts 见 DEFAULT_OPTS。返回 { dummy } */
  function setupField(kit, level, opts) {
    const o = normOpts(opts);
    const R = Rogue;
    RNG.install(`dpt:${kit}:${level}:setup`);
    const filler = HEROES.find(k => k !== kit);
    const run = R.newRun({ party: [kit, filler], seed: `dpt:${kit}:${level}` });
    run.party.forEach(h => {
      const from = h.level || 1;
      h.level = level; h.xp = 0; h.hp = null; h.shp = null;
      R.queueLevelRewards(h, from, level, [], run);
      Object.keys(h.weaponLevels || {}).forEach(k => { h.weaponLevels[k] = Math.max(1, Math.min(10, Math.round(level * 0.6))); });
    });
    if (typeof LevelUp !== "undefined") LevelUp.quiet(() => chooseLevels(R, run)); else chooseLevels(R, run);
    run.party.forEach(h => { h.hp = null; h.shp = null; h.weaponState = {}; });
    const L = LEDGER;
    L.dur = {}; L.weapons = {}; L.heroes = {}; L.hours = 0;
    // 借单局的 before（把升级后的角色数据写到场上的单位上）；队伍里只放这一个角色
    run.act = 1; run.actDay = 0; R.makeBoard(run); R.acceptTask(run, "main");
    run.task.nodes[run.task.index] = { type: "battle", done: false };
    const spec = R.battleSpec(run);
    // 布置用固定种子：单位编号每次都一样（自动搜索重放时记下的动作才对得上）
    BattleSim.setup({ party: [kit], enemies: [], seed: `dpt:${kit}:${level}:setup`, before: spec.before, zoneMode: 2 });
    const S = state;
    S.zoneMode = 2; S.weather = o.weather; S.noChart = !o.chart; S.board = null; S.phaseStep = 0;
    if (o.weather === "sand" && typeof rollSandDir === "function") rollSandDir();
    // 两个区都是空场地、中间没有障碍（不能留空对象：战斗画面排版要读每个区和区间）
    S.fields = { 1: emptyField(), 2: emptyField() }; S.gaps = { "1-2": emptyGap() };
    [1, 2].forEach(z => {
      if (o.fields[z]) setZoneField(z, o.fields[z]);
      if (o.high[z]) S.fields[z].highland = true;
    });
    // 战-M4：假人和精英牛都不带个体值（和 BattleSim.setup 一样关掉），同等级的布置完全一样
    const spawn = (...args) => {
      ENEMY_IV.off++;
      try { return spawnEnemyGroup(...args); } finally { ENEMY_IV.off--; }
    };
    const dummy = spawn("thug_knife", level, 1, 2)[0];
    dummy.name = DUMMY_NAME;
    const ox = spawn("captain_ox", level, 4, 2)[0];
    const hp = ox.layers.reduce((a, l) => a + (Number(l.max) || 0), 0);
    if (o.layers === "ox") dummy.layers = ox.layers.map(l => ({ type: l.type, current: l.max, max: l.max }));
    else {
      // 自己配的层：总血量和精英牛一样，按层数平分（除不尽的给最里层）；数组第一个是最外层
      const n = o.layers.length, each = Math.floor(hp / n);
      dummy.layers = o.layers.map((t, i) => { const m = i === n - 1 ? hp - each * (n - 1) : each; return { type: t, current: m, max: m }; });
    }
    dummy.def = dummy.defMax = DUMMY_DEF;
    dummy.zone = 2;
    dummy.trainingDummy = true;
    S.units.push(dummy);
    S.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; });
    S.dptBank = 0;   // 补血之前假人已经掉的血
    S.dptScrap = kit === "kolt" ? { every: 3, type: "shield", lost: spawn("captain_ox", level, 4, 1)[0].layers[0].max } : null;
    // 假人原始的层（种类和最大值）：聚焦抹层会把层写成 0/0 或直接移走，补满时按这个重建
    S.training = { kit, level, opts: o, turn: 0, turnStart: 0, per: [], dummyLayers: dummy.layers.map(l => ({ type: l.type, max: l.max })) };
    return { dummy };
  }

  const dummies = S => (S.units || []).filter(u => !u.isPlayer && u.name === DUMMY_NAME);
  const dummyLost = S => dummies(S).reduce((s, u) => s + (u.layers || []).reduce((a, l) => a + Math.max(0, (Number(l.max) || 0) - Math.max(0, Number(l.current) || 0)), 0), 0);
  /** 到现在为止对假人造成的总伤害（补血前掉的 + 现在少的） */
  const damage = S => (Number(S.dptBank) || 0) + dummyLost(S);
  /** 假人掉到一半以下：补满，掉的血记进总伤害（也会顺手把假人从「倒下」里拉回来） */
  function refillDummy(S) {
    const spec = S.training && S.training.dummyLayers;
    dummies(S).forEach(u => {
      // 架势无限：不管什么效果动过，每次结算后补回满、清掉失衡
      u.def = u.defMax = DUMMY_DEF; u.stunned = false; u._imbalanceLock = false;
      const lost = spec && !(u.layers || []).every((l, i) => spec.length === u.layers.length && l.type === spec[i].type && l.max === spec[i].max && !l.sealed);
      const max = spec ? spec.reduce((a, l) => a + l.max, 0) : (u.layers || []).reduce((a, l) => a + (Number(l.max) || 0), 0);
      const cur = (u.layers || []).reduce((a, l) => a + Math.max(0, Number(l.current) || 0), 0);
      if (!lost && !u.dead && !u._removed && cur >= max * REFILL_AT) return;
      S.dptBank = (Number(S.dptBank) || 0) + (max - cur);
      if (spec) u.layers = spec.map(l => ({ type: l.type, current: l.max, max: l.max })); else u.layers.forEach(l => { l.current = l.max; });
      u.focuses = [];
      u.dead = false; u.dying = false; u._removed = false; u.hidden = false;
    });
  }
  /** 柯尔特：第 3、6……个回合开始时，当作刚打碎了一层牛的护盾（和实战一样累积成废料） */
  function injectScrap(S) {
    const sc = S.dptScrap;
    if (sc && Number(S.turnNo) % sc.every === 0 && typeof koltScrapAdd === "function") koltScrapAdd(sc.type, sc.lost);
  }

  /** 战斗画面每次结算后调用：补假人、记每回合伤害、回合开始注入废料（记录放在 state 里，撤销也跟着回去） */
  function tick() {
    const S = typeof state !== "undefined" ? state : null, tr = S && S.training;
    if (!tr) return;
    refillDummy(S);
    const turn = S.combatStarted ? (Number(S.turnNo) || 1) : 0;
    if (turn !== tr.turn) {
      // 新的回合：上一回合的伤害（含回合结束 → 这回合开始时的结算）定下来
      if (tr.turn > 0) tr.per[tr.turn - 1] = damage(S) - tr.turnStart;
      // 从「还没开打」进第 1 回合：开打前不会有伤害，起点是 0（第一次结算可能已经在第一个动作之后了）
      tr.turnStart = tr.turn === 0 ? 0 : damage(S);
      tr.turn = turn;
      if (turn > 0) injectScrap(S);
    }
    if (tr.turn > 0) tr.per[tr.turn - 1] = damage(S) - tr.turnStart;
    paint();
  }

  /* ---------- 画面 ---------- */
  const doc = typeof document !== "undefined" ? document : null;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const heroName = k => (typeof Rogue !== "undefined" && Rogue.heroName ? Rogue.heroName(k) : k);

  function panel() {
    let el = doc.getElementById("g-train");
    if (!el) {
      el = doc.createElement("aside");
      el.id = "g-train";
      el.setAttribute("aria-label", "训练场记录");
      el.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:60;width:260px;max-width:calc(100vw - 24px);background:#15110de8;color:#f1e6cf;border:1px solid #d8b25a;border-radius:6px;padding:10px 12px;font:13px/1.5 system-ui,sans-serif;box-shadow:0 6px 20px #0008";
      doc.body.appendChild(el);
      el.addEventListener("click", e => {
        const b = e.target.closest("button[data-tr]");
        if (!b) return;
        if (b.dataset.tr === "restart") restart();
        if (b.dataset.tr === "config") open();
        if (b.dataset.tr === "exit") root.location.reload();
        if (b.dataset.tr === "fold") { el.classList.toggle("folded"); paint(); }
      });
    }
    return el;
  }
  function paint() {
    if (!doc || !Training.active) return;
    const S = state, tr = S.training || { per: [], turn: 0 };
    const el = panel();
    const per = tr.per || [];
    const sum = n => per.slice(0, n).reduce((a, b) => a + (Number(b) || 0), 0);
    const total = sum(per.length), first8 = sum(TURNS);
    const folded = el.classList.contains("folded");
    const rows = per.map((d, i) => `<tr${i + 1 === tr.turn ? ' style="color:#ffd56b"' : ""}><td>T${i + 1}${i + 1 === tr.turn ? "（进行中）" : ""}</td><td style="text-align:right">${Math.round(d)}</td></tr>`).join("");
    el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b>训练场 · ${esc(heroName(tr.kit))} Lv${esc(tr.level)}</b><button data-tr="fold" style="background:none;border:0;color:#d8b25a;cursor:pointer">${folded ? "展开" : "收起"}</button></div>`
      + (folded ? `<div>累计 ${Math.round(total)}</div>` : `<div style="color:#b9ad98;font-size:12px">${tr.turn ? `第 ${tr.turn} 回合` : "点「开始战斗」开打"} · 假人掉到一半补满，伤害照记</div>`
      + `<div style="color:#b9ad98;font-size:12px">${esc(optsText(tr.opts))}</div>`
      + `<table style="width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;margin:6px 0">${rows}</table>`
      + `<div>前 ${TURNS} 回合合计 <b style="color:#ffd56b">${Math.round(first8)}</b>${per.length > TURNS ? ` · 全部 ${Math.round(total)}` : ""}</div>`
      + `<div style="display:flex;gap:6px;margin-top:8px"><button class="g-train-btn" data-tr="restart">重新开始</button><button class="g-train-btn" data-tr="config">换布置</button><button class="g-train-btn" data-tr="exit">离开训练场</button></div>`);
  }

  /** 顶栏「重新开始」：在训练场里就重开这一场训练（返回 true）；不在训练场返回 false，交给普通战斗处理 */
  function restart() {
    if (!Training.active) return false;
    start(Training.kit, Training.level, Training.opts);
    return true;
  }

  function start(kit, level, opts) {
    const o = normOpts(opts);
    Training.active = true;
    Training.kit = kit; Training.level = level; Training.opts = o;
    const plain = JSON.stringify(o) === JSON.stringify(normOpts(DEFAULT_OPTS));
    root.GAME.startCustomBattle(`训练场 · ${heroName(kit)} Lv${level}`, () => {
      setupField(kit, level, o);
      RNG.install(`train:${kit}:${level}:${Date.now()}`);   // 布置用固定种子，打的时候骰子正常随机
      return { notes: [`训练场：${heroName(kit)} Lv${level} 对训练假人（同等级精英牛的总血量，掉到一半补满；不行动、打不进失衡）。${optsText(o)}。` +
        (plain ? "和输出循环页面上的数字同一套布置。" : "") + "点「开始战斗」开打。"] };
    });
    if (typeof Screens !== "undefined") Screens.show("battle");
    paint();
  }

  /** 标题画面上的入口：选角色和等级 */
  function open() {
    let dlg = doc.getElementById("g-train-pick");
    if (!dlg) {
      dlg = doc.createElement("dialog");
      dlg.id = "g-train-pick";
      dlg.style.cssText = "background:#15110d;color:#f1e6cf;border:1px solid #d8b25a;border-radius:8px;padding:16px 18px;max-width:min(420px,calc(100vw - 32px))";
      doc.body.appendChild(dlg);
    }
    const o = normOpts(Training.opts);
    const sel = (id, list, cur) => `<select id="${id}">${list.map(([v, n]) => `<option value="${v}"${v === cur ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
    const layerList = [["", "无"]].concat(Object.keys(LAYER).map(k => [k, LAYER[k]]));
    const lay = o.layers === "ox" ? [] : o.layers;
    const lvOpts = Array.from({ length: 15 }, (_, i) => i + 1).map(l => `<option value="${l}"${l === (Training.level || 10) ? " selected" : ""}>${l} 级</option>`).join("");
    dlg.innerHTML = `<form method="dialog" style="display:grid;gap:10px">
      <h3 style="margin:0">训练场</h3>
      <p style="margin:0;color:#b9ad98;font-size:13px">单人对训练假人，手动打出伤害，和自动搜出来的输出循环对照。不存档，离开时页面会重新载入。</p>
      <label>角色 <select id="g-train-kit">${HEROES.map(k => `<option value="${k}"${k === Training.kit ? " selected" : ""}>${esc(heroName(k))}</option>`).join("")}</select></label>
      <label>等级 <select id="g-train-lv">${lvOpts}</select></label>
      <fieldset style="border:1px solid #5a5146;border-radius:6px;padding:8px 10px;display:grid;gap:6px">
        <legend>训练假人的血量层（总血量 = 同等级精英牛）</legend>
        <label><input type="checkbox" id="g-train-ox"${o.layers === "ox" ? " checked" : ""}> 照精英牛原样（层的种类和血量都一样）</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">外层 ${sel("g-train-l0", layerList.slice(1), lay[0] || "flesh")} 中层 ${sel("g-train-l1", layerList, lay[1] || "")} 内层 ${sel("g-train-l2", layerList, lay[2] || "")}</div>
        <small style="color:#b9ad98">自己配的层按层数平分总血量</small>
      </fieldset>
      <label>天气 ${sel("g-train-weather", WEATHERS, o.weather)}</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center">1 区（角色）${sel("g-train-f1", FIELDS, o.fields[1])}<label><input type="checkbox" id="g-train-h1"${o.high[1] ? " checked" : ""}> 高地</label></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center">2 区（假人）${sel("g-train-f2", FIELDS, o.fields[2])}<label><input type="checkbox" id="g-train-h2"${o.high[2] ? " checked" : ""}> 高地</label></div>
      <label><input type="checkbox" id="g-train-chart"${o.chart ? " checked" : ""}> 算属性克制（属性对血量层的克制；微光反转、冻土冰伤也在这里面）</label>
      <small style="color:#b9ad98">全部默认（肉体一层、常态、无场地、不算克制）时和输出循环页面同一套布置。改了血量层 / 天气 / 场地会自动勾上「算属性克制」，可以再取消。</small>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="g-train-btn" value="cancel">取消</button><button class="g-train-btn primary" value="go" id="g-train-go">进入训练场</button></div>
    </form>`;
    const $ = id => doc.getElementById(id);
    // 改了血量层 / 天气 / 场地：自动勾上「算属性克制」（不算的话层的种类、微光、冻土都没有区别）
    ["g-train-ox", "g-train-l0", "g-train-l1", "g-train-l2", "g-train-weather", "g-train-f1", "g-train-f2"].forEach(id => { $(id).addEventListener("change", () => { $("g-train-chart").checked = true; }); });
    dlg.onclose = () => {
      if (dlg.returnValue !== "go") return;
      const layers = $("g-train-ox").checked ? "ox" : ["g-train-l0", "g-train-l1", "g-train-l2"].map(id => $(id).value).filter(Boolean);
      start($("g-train-kit").value, Number($("g-train-lv").value) || 1, {
        layers, weather: $("g-train-weather").value, chart: $("g-train-chart").checked,
        fields: { 1: $("g-train-f1").value, 2: $("g-train-f2").value }, high: { 1: $("g-train-h1").checked, 2: $("g-train-h2").checked }
      });
    };
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }

  const Training = { active: false, kit: null, level: 10, opts: null, DEFAULT_OPTS, normOpts, optsText, HEROES, TURNS, setupField, refillDummy, injectScrap, damage, tick, start, restart, open, DUMMY_NAME };
  root.Training = Training;

  if (doc) {
    const boot = () => {
      // 训练场自己的按钮样式（标题画面和战斗画面的 .btn 配色在这两处看不清）
      if (!doc.getElementById("g-train-style")) {
        const st = doc.createElement("style");
        st.id = "g-train-style";
        st.textContent = ".g-train-btn{background:#2a241d;color:#f1e6cf;border:1px solid #d8b25a;border-radius:4px;padding:4px 10px;font:inherit;cursor:pointer}"
          + ".g-train-btn.primary{background:#d8b25a;color:#15110d;font-weight:700}.g-train-btn:hover,.g-train-btn:focus-visible{outline:2px solid #ffd56b;outline-offset:1px}"
          + "#g-train-pick::backdrop{background:#0009}#g-train-pick select{background:#2a241d;color:#f1e6cf;border:1px solid #5a5146;padding:2px 4px}";
        doc.head.appendChild(st);
      }
      const btn = doc.getElementById("t-training");
      if (btn) btn.onclick = open;
      // 训练场里点「标题」：直接重新载入（训练场改过的内存局面不能带回别的模式）
      const title = doc.getElementById("g-title");
      if (title) title.addEventListener("click", e => { if (Training.active) { e.stopImmediatePropagation(); root.location.reload(); } }, true);
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot); else boot();
  }
  if (typeof module !== "undefined" && module.exports) module.exports = Training;
})(typeof window !== "undefined" ? window : globalThis);
