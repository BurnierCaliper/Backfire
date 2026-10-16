/* 角鳞 · 战斗原型（表现层）
 *
 * 规则一行都不在这里写。所有结算都调用计算器现有的函数：
 *   runSkill / doMove / standUp / finishBlock / finishAssist / endPlayerTurn / endEnemyTurn …
 * 这个文件只做四件事：
 *   1. 把 spawnPopup / appendLog 改成「记录事件」，每个伤害数字附带当时的全场快照
 *   2. 沙盒预演：备份 state → 用最小/最大骰跑一遍技能 → 读结果 → 还原 state
 *   3. 按事件顺序逐步播放（受击、掉血、击破、失衡）
 *   4. 敌人 AI、格挡 / 协助选择、回合流程
 */
(function () {
  "use strict";

  /* ================= 工具 ================= */
  const realTimeout = window.setTimeout.bind(window);
  const $ = (id) => document.getElementById(id);
  const colorLine = (t) => { try { return colorizeLogLine(t); } catch (e) { return esc(t); } };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const sumCur = (s) => (s.layers || []).reduce((a, l) => a + l.cur, 0);
  const sumMax = (s) => (s.layers || []).reduce((a, l) => a + l.max, 0);

  const G = {
    tape: null,        // 正在记录的事件
    sim: false,        // 是否处于沙盒预演
    depth: 0,          // >0 表示正在演出 / 敌人行动，禁止操作
    skip: false,
    fast: false,
    ended: false,
    slow: 1,
    actorId: null,
    arm: null,         // 当前选中的技能与目标选择状态
    skillTap: null,    // 触屏：不用选目标的技能点了一下、正在预演（再点同一个按钮才放出去）
    view: new Map(),   // 当前画面显示的快照 id → snap
    version: 0,
    level: 1,
    partyKits: ["ruby", "yuito", "hiaki", "tou"],
    enemyPlan: [
      { id: "thug_knife", lv: 1, zone: 2 },
      { id: "thug_hammer", lv: 1, zone: 2 },
      { id: "bandit_boss", lv: 1, zone: 2 }
    ]
  };
  window.GAME = G;
  const hotseat = () => window.HotseatGame && HotseatGame.isActive();
  const systemCommand = (cmd, context) => hotseat() ? HotseatGame.system(cmd, context) : dispatch(cmd, context);

  function wait(ms) {
    if (G.instant) return Promise.resolve();
    return new Promise(r => realTimeout(r, G.skip ? 0 : ms * (G.fast ? 0.5 : 1) * (G.slow || 1)));
  }

  function deepClone(o, seen) {
    if (o === null || typeof o !== "object") return o;
    seen = seen || new WeakMap();
    if (seen.has(o)) return seen.get(o);
    if (typeof Node !== "undefined" && o instanceof Node) return o;
    if (Array.isArray(o)) {
      const a = [];
      seen.set(o, a);
      for (let i = 0; i < o.length; i++) a.push(deepClone(o[i], seen));
      return a;
    }
    const proto = Object.getPrototypeOf(o);
    if (proto !== Object.prototype && proto !== null) return o;
    const out = {};
    seen.set(o, out);
    for (const k of Object.keys(o)) out[k] = deepClone(o[k], seen);
    return out;
  }

  /* ================= 1. 接管计算器的输出口 ================= */
  const orig = {
    appendLog: window.appendLog,
    spawnPopup: window.spawnPopup,
    renderAll: window.renderAll,
    renderLog: window.renderLog,
    rollDice: window.rollDice
  };

  window.appendLog = function (text, kind) {
    // 规则层正在把一次行动收成一块时先不记；整理好的整块写出来时再记一次
    const collecting = typeof logSinkActive === "function" && logSinkActive();
    if (G.tape && !collecting) G.tape.push({ type: "log", text: String(text == null ? "" : text) });
    // 收集中的行要交给规则层的收集器（只是数据，预演里也要），否则预演里整块日志是空的，
    // 看不到「先选目标」，技能会不等选目标就直接放出去
    if (G.sim && !collecting) return;
    return orig.appendLog(text, kind);
  };
  window.renderLog = function () { if (!G.sim) return orig.renderLog(); };
  window.renderAll = function () { if (!G.sim) return orig.renderAll(); };
  window.spawnPopup = function (unit, spec) {
    if (!unit || !G.tape) return;
    spec = spec || {};
    G.tape.push({
      type: "pop",
      unitId: unit.id,
      kind: spec.kind || "dmg",
      value: spec.value,
      text: spec.text,
      fx: spec.fx || null,         // kind "proc"：哪个图标生效了（hud-icons.js 的 key）
      element: spec.element || "physical",
      main: !!spec.main,           // 攻击动作本身的那一下（不是高压场地等连带伤害）
      adv: !!spec.adv,             // 玩家这一下触发了属性克制
      dis: !!spec.dis,             // 玩家这一下被克制表减伤（劣势）
      targetId: spec.targetId || null,
      tag: state.popTag || null,   // "boom"：高能自爆的余波，数字放大、停留更久
      snap: G.sim ? null : snapAll()
    });
  };
  // 目标只认 state.targetId，不读计算器隐藏的下拉框
  window.skillTarget = () => unitById(state.targetId);
  window.skillTargetAny = () => unitById(state.targetId) || propByRef(state.targetId);
  window.selectedToken = () => state.targetId || "";

  /* ================= 2. 快照 ================= */
  /** 敌人已经打死、身上还带着高能（这次行动结束时会高能自爆）：画面上先留着，等自爆演出完再消失 */
  function highBoomPending(u) {
    if (!u || u.isPlayer) return false;
    try { return typeof highBoomValue === "function" && highBoomValue(u) > 0; } catch (e) { return false; }
  }
  function snapUnit(u) {
    let status = "", res = "", atk = u.atk;
    try { status = statusLine(u); } catch (e) {}
    try {
      if (typeof touDuelVictim === "function" && touDuelVictim(u)) {
        status = (status ? status + " · " : "") + "决一死战";
      }
    } catch (e) {}
    try { if (u.isPlayer) res = resourceText(u); } catch (e) {}
    try { atk = effectiveAtk(u, state.units); } catch (e) {}
    return {
      id: u.id,
      name: u.name,
      level: u.level || 1,
      isPlayer: !!u.isPlayer,
      kit: u.kit || "",
      zone: Number(u.zone) || 1,
      hidden: !!(u.hidden || u.fused),
      // 带着高能被打死的敌人：高能自爆演完之前先不算死（卡片不淡出），自爆把高能清掉之后才淡出
      dead: !!(u.dead || u._removed) && !highBoomPending(u) && !(u._linger && !u._removed),   // 微光下倒在场上等复活的陨体衍蛛：卡片留着
      weaponUnit: (typeof isWeaponUnit === "function") ? !!isWeaponUnit(u) : !!u.weaponOf,
      escort: u.escort || null,   // 护送对象（货车 / 委托人）：规则上按武器人处理，但画面上不能叫它武器人
      dying: !!u.dying,
      upOnShp: !!u.upOnShp,
      stunned: !!u.stunned,
      iceNext: !!(u.instant && u.instant.iceNext),
      def: Math.max(0, Number(u.def) || 0),
      defMax: Math.max(0, Number(u.defMax) || 0),
      layers: (u.layers || []).map(l => ({
        type: l.type,
        cur: Math.max(0, Math.round(Number(l.current) || 0)),
        max: Math.max(0, Number(l.max) || 0)
      })),
      shp: Number(u.shp) || 0,
      shpMax: Number(u.shpMax) || 0,
      flying: !!u.flying,
      highEnergy: Number(u.highEnergy) || 0,
      hung: (function () {
        try { return (typeof hungAtkFx === "function" ? hungAtkFx(u) : []).map(id => (ATKFX[id] && ATKFX[id].name) || id); }
        catch (e) { return []; }
      })(),
      ap: Number(u.ap) || 0,
      apMax: Number(u.apMax) || 0,
      bonus: Number(u.bonus) || 0,
      bonusMax: Number(u.bonusMax) || 0,
      status: status === "无状态" ? "" : status,
      badges: unitBadgesOf(u),
      res,
      iv: u.iv ? { hp: Number(u.iv.hp) || 0, atk: Number(u.iv.atk) || 0 } : null,   // 个体值（杂兵、精英）
      intents: (() => { try { return typeof enemyIntents === "function" ? enemyIntents(u) : []; } catch (e) { return []; } })(),   // 名牌上的行动提示（连击……）
      atk: Math.round(Number(atk) || 0),
      weapon: !!u.weaponOf,
      dur: weaponDurSnap(u),
      // 首领机制（boss-mechanics.js）：身上的死刑标记 / 首领正在倒数的死刑
      marks: typeof bossMarksOn === "function" ? bossMarksOn(u) : [],
      casts: typeof bossCastsBy === "function" ? bossCastsBy(u) : [],
      // 中立生物（desert.js）：迷你名牌；夜晚下潜的不画名牌，折进区角的「沙下动静」
      neutral: typeof isNeutralCreature === "function" && isNeutralCreature(u),
      submerged: !!u.submerged,
      leaveIn: u.leaveIn != null ? Number(u.leaveIn) : null,
      neutralTags: typeof isNeutralCreature === "function" && isNeutralCreature(u) ? [
        u.stunned ? { key: "stun", text: "失衡" } : null,
        u.resources && u.resources.flattened ? { key: "flat", text: "摊平" } : null,
        u.detected ? { key: "seen", text: "已发现" } : null
      ].filter(Boolean) : [],
      overkill: !u.isPlayer && (u.dead || u._removed) ? Math.max(0, Math.round(Number(u.overkill) || 0)) : 0,
      killBig: !u.isPlayer && !!u.killBig
    };
  }
  /** 单位卡上的状态 / 效果徽章（hud-icons.js）：属性状态、通用状态、即时 / 自我效果、挂着的攻击效果，加上刺入、牵挂这两个别人挂上的标记 */
  function unitBadgesOf(u) {
    if (!window.HudIcons) return [];
    const extra = [];
    try { if (typeof isPierced === "function" && isPierced(u)) extra.push("needle"); } catch (e) {}
    if ((state.units || []).some(x => x.kit === "yuito" && x.resources && x.resources.bondId === u.id)) extra.push("bond");
    try { return HudIcons.unitBadges(u, extra); } catch (e) { return []; }
  }
  /** 武器耐久条：武器人显示自己的耐久；角色显示手里那把武器的耐久（空手不显示） */
  function weaponDurSnap(u) {
    try {
      if (!u || !u.isPlayer || u.escort) return null;   // 护送对象没有耐久
      const weapon = typeof isWeaponUnit === "function" ? isWeaponUnit(u) : !!u.weaponOf;
      const kit = weapon ? u.kit : (typeof heldWeaponKit === "function" ? heldWeaponKit(u) : null);
      if (!kit || typeof weaponDurMax !== "function") return null;
      const max = Number(weaponDurMax(kit)) || 0;
      if (!(max > 0)) return null;
      const cur = weapon && u.resources && u.resources.durability != null ? Number(u.resources.durability)
        : (typeof weaponDur === "function" ? Number(weaponDur(kit)) : max);
      const name = typeof weaponName === "function" ? weaponName(kit) : kit;
      return { cur: Math.max(0, Math.min(max, cur || 0)), max, name };
    } catch (e) { return null; }
  }
  const WEATHER_NAME = { none: "常态", heat: "酷暑", snow: "雪天", acid: "酸雨", thunder: "雷鸣", glow: "微光", sand: "沙暴", phase: "相位" };
  const FIELD_CLASSES = ["field-fire", "field-electric", "field-ice", "field-acid", "field-quicksand", "field-coral", "field-energy", "field-harmonic", "field-collapse", "field-abyss"];
  function snapEnv() {
    const zones = {};
    for (let z = 1; z <= Number(state.zoneMode || 2); z++) {
      const f = (state.fields || {})[z];
      let cls = "", tags = "";
      try { cls = fieldThemeClass(f); } catch (e) {}
      try { tags = f ? fieldTags(f) : ""; } catch (e) {}
      let threats = [];
      try { threats = (typeof zoneThreatsIn === "function" ? zoneThreatsIn(z) : []); } catch (e) {}
      let wind = "";
      if (state.weather === "sand") { try { wind = sandWindLabel(sandWind(z, state.zoneMode, state.sandDir)); } catch (e) {} }
      // 首领机制·踩塔：标在这个区上的塔
      let towers = [];
      try { towers = typeof bossZoneMarks === "function" ? bossZoneMarks(z) : []; } catch (e) {}
      zones[z] = { cls, tags, threats, wind, towers };
    }
    let weatherText = WEATHER_NAME[state.weather] || state.weather || "常态";
    if (state.weather === "phase") { try { weatherText += "·" + phaseWeatherName(state.phaseStep); } catch (e) {} }
    if (state.weather === "sand") { try { weatherText += "（风向 " + sandDirText(state.sandDir, state.zoneMode) + "）"; } catch (e) {} }
    if (state.weatherLock) weatherText += "（锁定）";
    // 机关门开关也算画面状态：打按钮 / 拉杆的预演靠它判断「有效果」
    const doors = Object.keys(state.gaps || {}).map(k => k + ":" + (state.gaps[k].open ? 1 : 0)).join(",");
    // 时钟：昼夜会改变沙漠生物的行为；沙暴（漠汛）时它们按夜晚行动
    let clock = null;
    try {
      const min = clockNow();
      const desertish = (state.units || []).some(u => !u.dead && typeof enemyInfo === "function" && /沙漠生物|中立生物/.test((enemyInfo(u.kit) || {}).faction || ""));
      clock = { min, text: clockText(min), night: isNightClock(min), sandNight: state.weather === "sand" && desertish };
    } catch (e) {}
    return { weather: state.weather || "none", weatherText, zones, doors, clock };
  }
  function snapProp(p) {
    const max = Math.max(1, Number(p.maxHp) || Number(p.hp) || 1);
    const cur = Math.max(0, Number(p.hp) || 0);
    return {
      id: "prop:" + p.id,
      name: p.name,
      isPlayer: p.faction !== "enemy",
      isProp: true,
      isDevice: p.kind === "button" || p.kind === "lever",   // 按钮 / 拉杆没有耐久，不显示血条
      zone: Number(p.zone) || 1,
      level: p.level || 1,
      atk: 0,
      // 铁壁的外层护盾（川川多耗电能加的）画在装甲外面
      layers: (Number(p.shieldMax) > 0 ? [{ type: "shield", max: Number(p.shieldMax), cur: Math.max(0, Number(p.shield) || 0) }] : [])
        .concat([{ type: "armor", max: max, cur: cur }]),
      def: 0, defMax: 0, ap: 0, apMax: 0, bonus: 0, bonusMax: 0,
      status: (typeof propKindName === "function" ? propKindName(p.kind) : p.kind) + (p.kind === "door" ? "" : ""),
      res: p.kind === "battery" || p.kind === "turret" ? (p.faction === "enemy" ? "敌方" : "我方") : "",
      highEnergy: 0, flying: false, stunned: false, dying: false, dead: cur <= 0 && p.kind !== "button" && p.kind !== "lever",
      hidden: false
    };
  }
  /** 区域之间的危墙 / 不稳桥梁：可以被攻击，快照和配置物一样（画在两区之间的竖条上，不单独出铭牌） */
  function snapGaps() {
    const out = [];
    for (const [za, zb] of boardLinks()) {
      const key = gapKey(za, zb);
      const z = Math.max(za, zb);
      const g = (state.gaps || {})[key];
      if (!g) continue;
      const hittable = (g.type === "wall" || g.type === "bridge") && (Number(g.hp) || 0) > 0;
      const max = Math.max(1, Number(g.maxHp) || Number(g.hp) || 1);
      out.push({
        id: "gap:" + key, name: gapLabel(g.type) + "（" + key.replace("-", "–") + " 区之间）", isPlayer: false, isProp: true, isGap: true, gapKey: key,
        zone: Math.min(za, zb), level: 1, atk: 0, layers: [{ type: "armor", max, cur: Math.max(0, Number(g.hp) || 0) }],
        def: 0, defMax: 0, ap: 0, apMax: 0, bonus: 0, bonusMax: 0, status: gapLabel(g.type), res: "",
        highEnergy: 0, flying: false, stunned: false, dying: false, dead: !hittable, hidden: !hittable, shp: 0
      });
    }
    return out;
  }
  function targetName(id) {
    const s = G.view.get(id);
    if (s) return s.name;
    const u = unitById(id);
    return u ? u.name : "";
  }
  function snapAll() {
    const arr = (state.units || []).map(snapUnit).concat((state.props || []).map(snapProp)).concat(snapGaps());
    arr.env = snapEnv();
    return arr;
  }
  function applyEnv(env) {
    if (!env) return;
    $("g-app").dataset.weather = env.weather;
    // 有天气时顶栏最前面放天气图标
    const wi = window.Icons ? Icons.weather(env.weather) : "";
    $("g-weather").innerHTML = wi + esc("天气 " + env.weatherText);
    $("g-weather").classList.toggle("has-icon", !!wi);
    const ck = $("g-clock");
    if (ck) {
      const c = env.clock;
      ck.innerHTML = !c ? "" : (window.Icons && Icons.daynight ? Icons.daynight(c.night) : "") +
        `<b>${esc(c.text)}</b> ${c.night ? "夜晚" : "白天"}${c.sandNight && !c.night ? `<small>漠汛：沙漠生物按夜晚行动</small>` : ""}`;
      ck.className = "g-clock" + (c ? (c.night ? " night" : " day") : "");
      ck.hidden = !c;
    }
    // 夜晚的战场：区域底色压暗偏蓝、四周暗角（名牌照常亮）
    const night = !!(env.clock && env.clock.night);
    $("g-app").classList.toggle("is-night", night);
    const fieldEl = document.querySelector(".g-zone") && document.querySelector(".g-zone").parentElement;
    if (fieldEl) {
      let vg = fieldEl.querySelector(".night-vignette");
      if (night && !vg) { vg = el("div", "night-vignette"); fieldEl.appendChild(vg); }
      else if (!night && vg) vg.remove();
    }
    if ($("g-weather-sel") && env.weather) $("g-weather-sel").value = env.weather;
    document.querySelectorAll(".g-zone").forEach(z => {
      const e = env.zones[z.dataset.num] || {};
      FIELD_CLASSES.forEach(c => z.classList.remove(c));
      if (e.cls) z.classList.add(e.cls);
      const lab = z.querySelector(".zlabel");
      if (lab) {
        lab.textContent = `${z.dataset.num} 区${e.tags ? "　" + e.tags : ""}`;
        if (e.wind) {
          const w = el("span", "zwind " + (e.wind === "顺风" ? "down" : e.wind === "逆风" ? "up" : "calm"), "沙暴 " + e.wind);
          lab.appendChild(w);
        }
      }
      // 区域预警：敌人已经标定、之后回合才落地的范围攻击
      const th = e.threats || [];
      z.classList.toggle("threat", th.length > 0);
      z.classList.toggle("threat-ready", th.some(t => t.ready));
      let tb = z.querySelector(".zthreat");
      if (!th.length) { if (tb) tb.remove(); }
      else {
        if (!tb) { tb = el("div", "zthreat"); z.appendChild(tb); }
        tb.innerHTML = th.map(t =>
          `<span class="${t.ready ? "rd" : ""}">${esc(t.label)}${t.from ? `<i>${esc(t.from)}</i>` : ""}</span>`
        ).join("");
      }
    });
    // 踩塔：区域边框 + 角上一块牌子「踩塔 N · 1/1 人」（人数不够时变红）
    document.querySelectorAll(".g-zone").forEach(z => {
      const tw = (env.zones[z.dataset.num] || {}).towers || [];
      z.classList.toggle("tower", tw.length > 0);
      z.classList.toggle("tower-ready", tw.some(t => t.left <= 0));
      z.classList.toggle("tower-short", tw.some(t => t.have < t.need));
      let tb = z.querySelector(".ztower");
      if (!tw.length) { if (tb) tb.remove(); return; }
      if (!tb) { tb = el("div", "ztower"); z.appendChild(tb); }
      const when = (t) => t.left > 0 ? `${t.left} 回合后` : `这回合${t.phase === "player" ? "我方" : "敌人"}回合开始时`;
      tb.innerHTML = tw.map(t => `<span class="${t.have < t.need ? "short" : "ok"}" title="${esc(`${t.by} 的${t.name}：${when(t)}落下${t.delayed ? "（首领失衡，会推迟一回合）" : ""}。至少 ${t.need} 人站在这个区里踩住${t.soak > 0 ? `，每人挨 ${t.soak}` : ""}；没人踩住${t.fail != null ? (t.fail > 0 ? `，我方全员各挨 ${t.fail}` : "，我方全员挨巨额伤害") : "，会触发严重惩罚"}。不能格挡。`)}">${esc(t.name)} ${t.left > 0 ? t.left : "!"} · ${t.have}/${t.need} 人</span>`).join("");
    });
    paintGaps();
  }
  const toMap = (arr) => new Map(arr.map(s => [s.id, s]));

  /* ================= 3. 沙盒预演 ================= */
  const SKIP_KEYS = ["roster", "history", "logPages", "floaters"];
  function saveState() {
    const keys = Object.keys(state);
    const data = {};
    keys.forEach(k => { data[k] = SKIP_KEYS.includes(k) ? state[k] : deepClone(state[k]); });
    return { keys, data };
  }
  function restoreState(s) {
    Object.keys(state).forEach(k => { if (!s.keys.includes(k)) delete state[k]; });
    s.keys.forEach(k => { state[k] = s.data[k]; });
  }

  /* ---------- 撤销：每次玩家行动、结束回合、开始战斗之前记一份完整快照 ----------
   * 跑团模式最多撤回 10 步；Roguelike 单局只能撤回 1 步（免得反复重掷）。战斗结算后不能撤销。
   * 战斗记录不删，只补一行「↶ 撤销」。 */
  G.undo = [];
  function undoLimit() { return (typeof TRPG !== "undefined" && TRPG.active) ? 10 : 1; }
  function pushUndo(label) {
    if (hotseat()) return;
    if (G.sim) return;
    G.undo.push({
      label: label || "行动",
      st: saveState(),
      ledger: typeof LEDGER !== "undefined" ? LEDGER.save() : null,
      actorId: G.actorId,
      apWarnTurn: G.apWarnTurn
    });
    while (G.undo.length > undoLimit()) G.undo.shift();
  }
  function canUndo() { return !hotseat() && G.undo.length > 0 && G.depth === 0 && !G.ended && !choiceResolve; }
  function doUndo() {
    if (!canUndo()) return;
    disarm();
    const u = dispatch({ type: "battle.undo" });
    if (!u) return;
    addLogPhase(`↶ 撤销：${u.label}`);
    setView(snapAll(), false);
    refreshAll();
    flashHint(`已撤销：${u.label}` + (G.undo.length ? `（还能再撤 ${G.undo.length} 步）` : ""));
  }
  function undoRules() {
    if (!canUndo()) return;
    const u = G.undo.pop();
    restoreState(u.st);
    if (u.ledger && typeof LEDGER !== "undefined") {
      const water = ledgerWater();
      LEDGER.load(u.ledger);
      setLedgerWater(water);   // 水在背包里，已随快照恢复
    }
    G.actorId = u.actorId;
    G.apWarnTurn = u.apWarnTurn;
    G.version++;
    G.predict = null;
    return { label: u.label };
  }

  function simulate(thunk, diceMode) {
    const saved = saveState();
    // 「长休一次」的职责技能（全队集结）次数记在队伍档案里，不在 state：预演完也要还原，不然悬停一下就用掉了
    const restOnce = typeof LEDGER !== "undefined" ? JSON.stringify(LEDGER.restOnce || {}) : null;
    const rnd = Math.random;
    const st = window.setTimeout;
    const outerTape = G.tape;
    G.sim = true;
    G.tape = [];
    state.history = [];
    Math.random = () => 0.999;   // 格挡判定等非骰子随机：按「没挡住」预演
    window.setTimeout = () => 0; // 例如死亡淡出计时，不能在预演里真的触发
    window.rollDice = function (n, s, b) {
      if (!n || !s) return { total: b || 0, parts: [], text: String(b || 0) };
      const v = diceMode === "min" ? 1 : s;
      const total = n * v + (b || 0);
      return { total, parts: new Array(n).fill(v), text: `${n}d${s}${b ? "+" + b : ""}（${diceMode === "min" ? "最小" : "最大"}）=${total}` };
    };
    const before = snapAll();
    let err = null;
    try { thunk(); } catch (e) { err = e; }
    const after = snapAll();
    const tape = G.tape;
    Math.random = rnd;
    window.setTimeout = st;
    window.rollDice = orig.rollDice;
    G.sim = false;
    G.tape = outerTape;
    restoreState(saved);
    if (restOnce != null && JSON.stringify(LEDGER.restOnce || {}) !== restOnce) LEDGER.restOnce = JSON.parse(restOnce);
    return { before, after, tape, err };
  }

  const COST_LINE = /消耗 \d+ (行动点|附赠行动)|^——|^\s*$/;
  function logLines(tape) {
    const out = [];
    tape.forEach(e => { if (e.type === "log") e.text.split("\n").forEach(t => out.push(t)); });
    return out;
  }

  function previewOf(thunk) {
    const lo = simulate(thunk, "min");
    const hi = simulate(thunk, "max");
    const b = toMap(lo.before), a1 = toMap(lo.after), a2 = toMap(hi.after);
    const units = new Map();
    let meaningful = false;
    b.forEach((bs, id) => {
      const s1 = a1.get(id), s2 = a2.get(id);
      if (!s1 || !s2 || bs.hidden) return;
      const p = { id, layers: [], dmgLo: 0, dmgHi: 0, healHi: 0, brLo: 0, brHi: 0, defAfterHi: bs.def, defAfterLo: bs.def };
      bs.layers.forEach((l, i) => {
        const c1 = s1.layers[i] ? s1.layers[i].cur : l.cur;
        const c2 = s2.layers[i] ? s2.layers[i].cur : l.cur;
        const lo2 = Math.min(c1, c2), hi2 = Math.max(c1, c2);
        p.layers.push({ before: l.cur, lo: lo2, hi: hi2, max: l.max });
      });
      const hb = sumCur(bs), h1 = sumCur(s1), h2 = sumCur(s2);
      const d1 = hb - h1, d2 = hb - h2;
      p.dmgLo = Math.max(0, Math.min(d1, d2));
      p.dmgHi = Math.max(0, Math.max(d1, d2));
      // 预览数字写「这一下打出去的伤害」，不按目标剩下的血量封顶（剩 8 血吃 15 伤害就写 15）：
      // 用伤害弹字的数值（规则层的 intended，含溢出）加起来；血条上闪的那段仍然是实际会掉的血
      const popDmg = (tape) => (tape || []).filter(e => e.type === "pop" && e.unitId === id && e.kind === "dmg")
        .reduce((sum, e) => sum + Math.max(0, Number(e.value) || 0), 0);
      const q1 = popDmg(lo.tape), q2 = popDmg(hi.tape);
      if (q1 > 0 || q2 > 0) { p.dmgLo = Math.min(q1, q2); p.dmgHi = Math.max(q1, q2); }
      p.healHi = Math.max(0, -Math.min(d1, d2));
      const shpLoss = Math.max(bs.shp - s1.shp, bs.shp - s2.shp, 0);
      p.shpLoss = bs.upOnShp || bs.dying ? shpLoss : 0;
      p.defAfterHi = Math.max(s1.def, s2.def);   // 击破较少的一侧
      p.defAfterLo = Math.min(s1.def, s2.def);
      p.brLo = Math.max(0, bs.def - p.defAfterHi);
      p.brHi = Math.max(0, bs.def - p.defAfterLo);
      p.stunSure = !bs.stunned && s1.stunned && s2.stunned;
      p.stunMaybe = !bs.stunned && !p.stunSure && (s1.stunned || s2.stunned);
      p.ice = (s1.stunned && s1.iceNext && !bs.iceNext) || (s2.stunned && s2.iceNext && !bs.iceNext);
      p.killSure = !bs.dead && !bs.dying && (s1.dead || s1.dying) && (s2.dead || s2.dying);
      p.killMaybe = !bs.dead && !bs.dying && !p.killSure && (s1.dead || s1.dying || s2.dead || s2.dying);
      p.zoneTo = s2.zone !== bs.zone ? s2.zone : null;
      const oldChips = new Set(bs.status ? bs.status.split(" · ") : []);
      p.newStatus = (s2.status ? s2.status.split(" · ") : []).filter(c => {
        if (!c || c === "无状态" || oldChips.has(c)) return false;
        if (/^高能 0$/.test(c) && [...oldChips].some(x => /^高能/.test(x))) return false;
        return true;
      });
      p.resChanged = bs.res !== s2.res;
      // 资源前后的文字（快照里的 res）：卡片数值牌和预览框写「资源：之前 → 之后」；配置物的 res 是阵营
      p.resBefore = bs.res || "";
      p.resAfter = s2.res || "";
      p.name = bs.name;
      p.isProp = !!bs.isProp;
      // 属性颜色按攻击动作本身那一下：高压场地这类连带伤害会先弹出来，不能拿第一个
      const dmgPops = hi.tape.filter(e => e.type === "pop" && e.unitId === id && e.kind === "dmg" && Number(e.value) > 0);
      const pop = dmgPops.find(e => e.main) || dmgPops[0];
      p.element = pop ? pop.element : "physical";
      p.adv = dmgPops.some(e => e.adv);   // 克制：预览写「克制」，要打掉的血条变浅金
      p.dis = !p.adv && dmgPops.some(e => e.dis);   // 劣势：预览写「劣势」，伤害数字和要打掉的血条变灰
      p.changed = p.dmgHi > 0 || p.healHi > 0 || p.brHi > 0 || p.stunSure || p.stunMaybe || p.killSure || p.killMaybe ||
        p.zoneTo != null || p.newStatus.length > 0 || p.shpLoss > 0 || p.resChanged;
      if (p.changed || p.resChanged) meaningful = true;
      units.set(id, p);
    });
    if (lo.after.length !== lo.before.length) meaningful = true;
    // 天气 / 场地的变化也算效果（制冰机、酸萃这类只改环境的技能）
    const envBefore = JSON.stringify(hi.before.env || {});
    const envAfter = JSON.stringify(hi.after.env || {});
    if (envBefore !== envAfter) meaningful = true;
    const lines = logLines(hi.tape);
    let reason = "";
    if (!meaningful) {
      const cand = lines.filter(t => !COST_LINE.test(t));
      reason = cand.length ? cand[cand.length - 1].trim() : "没有效果";
    }
    if (hi.err) reason = "结算出错：" + hi.err.message;
    return { units, lines, meaningful, reason, err: hi.err, needsTarget: lines.some(t => /先在「技能目标」里选对象|先选/.test(t)) };
  }

  /* ================= 4. 技能模型 ================= */
  function unitAlive(u) { return u && !u.hidden && !u.fused && !u.dead && !u._removed; }
  function players() { return state.units.filter(u => u.isPlayer && unitAlive(u)); }
  function foes() { return state.units.filter(u => !u.isPlayer && unitAlive(u) && u.kit !== "ironwall" && !(typeof isNeutralCreature === "function" && isNeutralCreature(u)) && !(typeof playerAllied === "function" && playerAllied(u))); }   // 友军不算要打的敌人

  function gameSkills(u) {
    if (!u || !u.isPlayer) return [];
    if (u.dying && !isWeaponUnit(u)) {
      return [{ id: "__stand", name: "起身", hint: "hp 归零后可以选择起身。之后受伤扣坚毅生命（shp），shp 归零即永久死亡。", cost: {} }];
    }
    if (!G.sim && typeof isSoloHero === "function" && isSoloHero(u)) dispatch({ type: "battle.supportInfo" });
    let list = [];
    try { list = skillList(u) || []; } catch (e) { list = []; }
    const out = list
      .filter(sk => !/^fx_/.test(sk.id || ""))
      .filter(sk => !/协助攻击|协助格挡|空手格挡/.test(sk.name || "") && sk.id !== "assist_block" && !/_assist$/.test(sk.id || ""))
      .filter((sk, i, arr) => arr.findIndex(x => x.id === sk.id) === i)
      .map(sk => Object.assign({}, sk, { cost: skillCost(sk.id) || {} }));
    (state.props || []).filter(p => Number(p.zone) === Number(u.zone) && (p.kind === "button" || p.kind === "lever")).forEach(p => {
      out.push({
        id: "use_device:" + p.id,
        name: (p.kind === "lever" ? "扳动 " : "按下 ") + p.name,
        hint: "同区 · 消耗行动点操作装置",
        cost: { ap: 1 }
      });
    });
    if (typeof scrapsFor === "function") scrapsFor(u).forEach(p => {
      out.push({
        id: "use_scrap:" + p.id,
        name: "操控 " + p.name,
        hint: `和机炮站在一起时操控 · 向机炮 2 距离以内的一名敌人发射碎渣：1d4 次 ${6 + (Number(p.level) || 1)} 点物理，2 击破 · 每用一次耐久 −1 · 耐久 ${p.hp}/${p.maxHp || 5}`,
        cost: { ap: 1 }
      });
    });
    if (typeof hackableTurrets === "function") hackableTurrets(u).forEach(p => {
      const odds = turretHackOdds(u);
      out.push({
        id: "hack_turret:" + p.id,
        name: "改写 " + p.name,
        hint: `同区 · 困难数据操作检定，成功后炮台归我方 · 成功率 ${Math.round(odds.chance * 100)}%`,
        cost: { ap: 1 }
      });
    });
    out.push({ id: "__item", name: "使用道具", hint: "从背包里选一件在战斗中使用。", cost: { bonus: 1 } });
    out.push({ id: "__move", name: "移动", hint: "移动到另一个区域。离开有借机攻击敌人的区域会被追打。", cost: { bonus: 1 } });
    return out;
  }

  function blockReason(u, sk) {
    const why = hotseat() && !G.sim ? HotseatGame.reason(u) : "";
    return why || baseBlockReason(u, sk);
  }
  function baseBlockReason(u, sk) {
    if (G.ended) return "战斗已结束";
    if (!state.combatStarted) return "战斗尚未开始";
    if (state.combatPhase !== "player") return "敌人回合";
    if (!u || u.dead) return "已阵亡";
    if (sk.id === "__stand") return typeof standUpBlocked === "function" ? standUpBlocked(u) : null;
    if (sk.id === "__item" && typeof bagList === "function" && !bagList(u).some(x => x.combat)) return "没有能在战斗中使用的道具";   // 维修工具包也算（战斗中能用）
    if (u.stunned) return "失衡中，本回合无法行动";
    if ((sk.cost.ap || 0) > (u.ap || 0)) return "行动点不足";
    if ((sk.cost.bonus || 0) > (u.bonus || 0)) return "附赠行动不足";
    if (sk.id === "__move" && u.noMove) return "本回合无法移动";
    if (String(sk.id).indexOf("use_scrap:") === 0 && typeof scrapTargets === "function") {
      const p = (state.props || []).find(x => "use_scrap:" + x.id === sk.id);
      if (p && typeof scrapReady === "function" && !scrapReady(p)) return "碎渣机炮这一回合已经发射过了";
      if (!p || !scrapTargets(p, u).length) return "碎渣机炮 2 距离内没有敌人";
    }
    if (String(sk.id).indexOf("hack_turret:") === 0 && typeof turretHackError === "function") {
      const p = (state.props || []).find(x => "hack_turret:" + x.id === sk.id);
      const why = turretHackError(u, p);
      if (why) return why;
    }
    if (typeof skillRequirementError === "function") {
      const why = skillRequirementError(u, sk.id);
      if (why) return why;
    }
    return null;
  }

  function skillThunk(actorId, skillId, targetId, picks) {
    const cmd = skillCommand(actorId, skillId, targetId, picks);
    return () => { G.lastCmd = cmd; return BattleCommands.execute(cmd); }; // Sandbox previews never enter the command log.
  }
  function skillCommand(actorId, skillId, targetId, picks) {
    picks = picks || {};
    if (skillId === "__move") return { type: "move", actor: actorId, dest: picks.dest };
    if (skillId === "__stand") return { type: "standUp", actor: actorId };
    if (skillId === "__item") return { type: "useItem", actor: actorId, target: targetId || null, item: picks.item, dest: picks.dest == null ? null : picks.dest };
    return { type: "skill", actor: actorId, skill: skillId, target: targetId || null, picks };
  }

  function otherZones(z) { return zoneNeighbors(z); }   // 能走一步过去的区（棋盘上相连的）

  /* ================= 5. 画面 ================= */
  const cards = new Map();

  function zoneGroup(zone, isPlayer, isProp, neutral) {
    const z = document.querySelector(`.g-zone[data-num="${zone}"]`) || document.querySelector(".g-zone");
    if (!z) return document.querySelector(".g-zone");
    if (isProp) return z.querySelector(".grp.prop") || z.querySelector(".grp.player");
    if (neutral) {   // 中立生物：区里单独一排迷你名牌（排在最下面）
      let g = z.querySelector(".grp.neutral");
      if (!g) { g = el("div", "grp neutral"); z.appendChild(g); }
      return g;
    }
    return z.querySelector(isPlayer ? ".grp.player" : ".grp.enemy");
  }

  /** 单位卡：画法在 unit-card.js（联机玩家画面也用）；这里加上战斗画面的鼠标事件并登记到 cards */
  function createCard(s) {
    const c = UnitCard.create(s);
    c.wrap.addEventListener("mouseenter", () => onCardHover(c.id, true));
    c.wrap.addEventListener("mouseleave", () => onCardHover(c.id, false));
    c.wrap.addEventListener("click", (e) => { e.stopPropagation(); onCardClick(c.id); });
    cards.set(s.id, c);
    return c;
  }

  function updateCard(c, s) { UnitCard.update(c, s, { sim: G.sim }); }

  function placeCard(c, s, animate) {
    const grp = zoneGroup(s.zone, s.isPlayer, s.isProp, s.neutral);
    if (c.wrap.parentElement === grp) return;
    const first = c.wrap.isConnected ? c.wrap.getBoundingClientRect() : null;
    if (first && animate && !s.isProp && window.Sfx && !G.sim) Sfx.ui("move");   // 换区移动：脚步声
    grp.appendChild(c.wrap);
    if (first && animate) {
      const last = c.wrap.getBoundingClientRect();
      const dx = first.left - last.left, dy = first.top - last.top;
      c.wrap.style.transition = "none";
      c.wrap.style.transform = `translate(${dx}px, ${dy}px)`;
      void c.wrap.offsetWidth;
      c.wrap.style.transition = `transform ${G.fast ? 0.4 : 0.75}s cubic-bezier(.3,.8,.3,1)`;
      c.wrap.style.transform = "";
    }
  }

  /** 把画面切到某个快照。返回这一帧里发生的「大事件」，给演出用。 */
  function setView(snaps, animate) {
    const next = toMap(snaps);
    const beats = [];
    applyEnv(snaps.env);
    next.forEach((s, id) => {
      if (s.isGap) return;   // 危墙 / 桥梁画在区域间的竖条上（paintGaps）
      if (s.hidden || (s.neutral && s.submerged && !s.dead)) {   // 下潜的中立生物：不画名牌（见 paintSandStir）
        const c = cards.get(id);
        if (c) { c.wrap.remove(); cards.delete(id); }
        return;
      }
      const p = G.view.get(id);
      let c = cards.get(id);
      if (!c) c = createCard(s);
      if (p) {
        if (!p.stunned && s.stunned && !s.dead) beats.push({ kind: "stun", id, ice: s.iceNext });
        if (!p.dead && s.dead) beats.push({ kind: "kill", id });
        if (!p.dying && s.dying && !s.dead) beats.push({ kind: "down", id });
        const healed = sumCur(s) - sumCur(p);
        const shieldOf = (x) => (x.layers || []).filter(l => l.type === "shield").reduce((a, l) => a + l.cur, 0);
        const shieldUp = shieldOf(s) - shieldOf(p);
        if (healed > 0) beats.push({ kind: "heal", id, value: healed, shield: shieldUp > 0, life: healed - Math.max(0, shieldUp) > 0 });
      }
      updateCard(c, s);
      placeCard(c, s, animate);
    });
    cards.forEach((c, id) => {
      if (!next.has(id)) { c.wrap.remove(); cards.delete(id); }
    });
    G.view = next;
    paintGaps();
    paintSandStir(snaps);
    fitZones();
    return beats;
  }

  /** 夜晚下潜的中立生物（尘虫迁徙）：每个区角上一块「沙下动静 ×N」，点开看每只的状态；谐波选目标时点列表里的那一只 */
  const STIR_ICON = `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M5 16c4-4 8-4 12 0s8 4 12 0 5-3 7 0" fill="none" stroke="#f0cf9a" stroke-width="2.6" stroke-linecap="round"/><path d="M5 25c4-4 8-4 12 0s8 4 12 0 5-3 7 0" fill="none" stroke="#d9a35f" stroke-width="2.2" stroke-linecap="round" opacity=".8"/><circle cx="12" cy="32" r="2" fill="#d9a35f"/><circle cx="22" cy="33" r="2" fill="#d9a35f"/><circle cx="30" cy="31" r="2" fill="#d9a35f"/></svg>`;
  function paintSandStir(snaps) {
    document.querySelectorAll(".g-zone").forEach(z => {
      const zone = Number(z.dataset.num);
      const list = snaps.filter(s => s.neutral && s.submerged && !s.dead && !s.hidden && Number(s.zone) === zone);
      let box = z.querySelector(".sandstir-wrap");
      if (!list.length) { if (box) box.remove(); return; }
      if (!box) {
        box = el("div", "sandstir-wrap");
        box.addEventListener("click", (e) => {
          e.stopPropagation();
          const row = e.target.closest("[data-stir-id]");
          if (row) { onCardClick(row.dataset.stirId); return; }
          box.classList.toggle("open");
        });
        z.appendChild(box);
      }
      const names = [...new Set(list.map(s => s.name))].join("、");
      const pct = (s) => Math.round(sumCur(s) / Math.max(1, sumMax(s)) * 100);
      box.innerHTML = `<div class="sandstir-pop"><h4>沙下动静 · ${zone} 区（${list.length} 只${esc(names)}）</h4>` +
        list.map(s => `<div class="r" data-stir-id="${esc(s.id)}"><span class="n">${esc(s.name)}</span><span class="bar"><i style="width:${pct(s)}%"></i></span>` +
          `${(s.neutralTags || []).some(t => t.key === "seen") ? "<em>已被发现</em>" : ""}<small>${s.leaveIn != null ? `${s.leaveIn} 回合后离开` : "在沙下"}</small></div>`).join("") +
        `<footer>下潜中：只有谐波攻击和塌陷打得到。沙鱼发现后会去吃。</footer></div>` +
        `<button class="sandstir" type="button" title="点开看看">${STIR_ICON}<span>沙下动静 ×${list.length}<small>${esc(names)}迁徙中 · 点开看看</small></span></button>`;
    });
  }

  /** 区域里单位太多时逐级缩小铭牌，避免压到下方的角色选单 */
  function fitZones() {
    const LV = ["dense-1", "dense-2", "dense-3"];
    const overflowing = (z) => {
      const cs = getComputedStyle(z);
      const grps = [...z.querySelectorAll(".grp")].filter(g => g.children.length);
      // 用 offsetHeight：移动动画的 transform 会让 scrollHeight 虚高
      const content = grps.reduce((sum, g) => sum + g.offsetHeight, 0) +
        Math.max(0, grps.length - 1) * (parseFloat(cs.rowGap) || 0) +
        (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      return content > z.clientHeight + 1;
    };
    document.querySelectorAll(".g-zone").forEach(z => {
      LV.forEach(c => z.classList.remove(c));
      for (let i = 0; i < LV.length && overflowing(z); i++) {
        LV.forEach(c => z.classList.remove(c));
        z.classList.add(LV[i]);
      }
    });
  }

  /* ---------- 演出小件 ---------- */
  const fx = () => $("g-fx");
  // 大伤害数字（单次伤害 ≥ 目标血量上限 20%）的字号与停留时间（秒）
  const BIG_POP_SIZE = 64;
  const BIG_POP_DUR = 2.2;
  const popCount = new Map();
  /** 危墙 / 桥梁画在区与区之间的竖条上，没有卡片 */
  function gapNode(id) {
    if (!String(id || "").startsWith("gap:")) return null;
    return document.querySelector(`#g-field .g-gap[data-key="${String(id).slice(4)}"]`);
  }
  function centerOf(id) {
    const gn = gapNode(id);
    if (gn) {
      const r = gn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.42, r };
    }
    const c = cards.get(id);
    if (!c || !c.wrap.isConnected) return null;
    const r = c.wrap.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.42, r };
  }
  function popup(id, text, cls, opts) {
    const p = centerOf(id);
    if (!p) return;
    opts = opts || {};
    const n = popCount.get(id) || 0;
    popCount.set(id, n + 1);
    realTimeout(() => popCount.set(id, Math.max(0, (popCount.get(id) || 1) - 1)), 700);
    const d = el("div", "pop " + (cls || ""));
    const icon = opts.icon && window.Icons ? Icons.element(opts.icon) : "";
    if (icon) {   // 伤害数字最左边放属性图标
      d.innerHTML = icon;
      d.appendChild(document.createTextNode(text));
    } else d.textContent = text;
    if (opts.below) {
      d.style.left = (p.x + 46) + "px";
      d.style.top = (p.y + 30) + "px";
    } else {
      d.style.left = (p.x + (n % 2 ? 22 : -22) * Math.min(n, 3) / 1.5) + "px";
      d.style.top = (p.y - n * 16 - (opts.lift || 0)) + "px";   // lift：往上抬（头顶的字）
    }
    if (opts.size) d.style.fontSize = opts.size + "px";
    d.style.setProperty("--dur", (opts.dur || 0.9) + "s");
    fx().appendChild(d);
    realTimeout(() => d.remove(), (opts.dur || 0.9) * 1000 + 60);
  }
  /** 单位卡上某个状态 / 效果图标生效：放大一下 + 发光（hud-icons.js） */
  function procBadge(id, key) {
    if (!key || !window.HudIcons || G.sim || G.skip) return;
    const c = cards.get(id);
    if (c) HudIcons.procIn(c.unit, key);
  }
  /** 攻击效果大字：倾斜着从目标身上缓缓飞出、慢慢变大一点、再淡出。n 是这次行动里第几个字，用来错开位置 */
  function fxWord(id, text, element, n) {
    const p = centerOf(id);
    if (!p) return;
    const d = el("div", "fxword fx-" + (element || "generic"));
    d.textContent = text;
    // 攻击效果的图标跟着大字一起出来，生效时放大发光
    const fk = window.HudIcons && HudIcons.keyOf(text);
    if (fk) { d.insertAdjacentHTML("afterbegin", HudIcons.badge(fk)); HudIcons.proc(d.firstElementChild); }
    // 在铭牌上沿排成左右两列、一行一行往上叠：不挡铭牌中间的伤害数字，也不压到隔壁的铭牌
    const side = n % 2 ? -1 : 1;
    const row = Math.floor((n - 1) / 2);
    const tilt = side * (6 + Math.random() * 7);                  // 往外侧倾斜 6°–13°
    d.style.left = (p.x + side * p.r.width * 0.28) + "px";
    d.style.top = (p.r.top - 8 - row * 52) + "px";
    d.style.setProperty("--tilt", tilt.toFixed(1) + "deg");
    d.style.setProperty("--dx", (side * (30 + Math.random() * 16)).toFixed(0) + "px");
    // 单独一层，压在顶部的技能横幅之上（顶排敌人的字不会被横幅挡住）
    let layer = $("g-fxw");
    if (!layer) { layer = el("div", "g-fx g-fxw"); layer.id = "g-fxw"; document.body.appendChild(layer); }
    layer.appendChild(d);
    realTimeout(() => d.remove(), 1900);
  }
  function stamp(id, text, cls) {
    const p = centerOf(id);
    if (!p) return;
    const d = el("div", "stamp " + (cls || ""));
    d.textContent = text;
    d.style.left = p.x + "px";
    // 「高能自爆」盖在铭牌上方，不和中间的大号数字叠在一起
    d.style.top = (cls === "boom" ? p.r.top - 18 : p.r.top + p.r.height / 2) + "px";
    fx().appendChild(d);
    realTimeout(() => d.remove(), cls === "boom" ? 1550 : 950);
  }
  const ELE_VAR = { fire: "--fire", acid: "--acid", electric: "--electric", ice: "--icee", energy: "--energy", physical: "--physical", harmonic: "--harmonic" };
  /** pop：这一击的伤害弹字（带 adv 克制 / dis 劣势），克制时音效更响更高并带混响，劣势更闷更低 */
  function hit(id, element, big, pop) {
    const tone = pop ? { adv: !!pop.adv, dis: !pop.adv && !!pop.dis } : {};
    const gn = gapNode(id);
    if (gn) {
      if (!G.sim && window.Sfx) Sfx.play(element || "physical", Object.assign({ big: !!big }, tone));
      gn.style.setProperty("--flash", `var(${ELE_VAR[element] || "--physical"})`);
      gn.classList.remove("hit");
      void gn.offsetWidth;
      gn.classList.add("hit");
      if (!G.sim && !G.skip && window.HitFx) HitFx.burst(element || "physical", gn.getBoundingClientRect(), { big: !!big });
      return;
    }
    const c = cards.get(id);
    if (!c) return;
    if (!G.sim && window.Sfx) Sfx.play(element || "physical", Object.assign({ big: !!big }, tone));
    c.flash.style.setProperty("--flash", `var(${ELE_VAR[element] || "--physical"})`);
    c.wrap.classList.remove("hit");
    void c.wrap.offsetWidth;
    c.wrap.classList.add("hit");
    // 属性受击特效（hit-fx.js）：火焰窜起、电弧、冰晶、酸液……
    if (!G.sim && !G.skip && window.HitFx) HitFx.burst(element || "physical", c.wrap.getBoundingClientRect(), { big: !!big });
  }
  async function lunge(actorId, targetId) {
    const a = centerOf(actorId), t = centerOf(targetId), c = cards.get(actorId);
    if (!a || !t || !c) return;
    const dx = t.x - a.x, dy = t.y - a.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    c.wrap.classList.add("lunge");
    c.wrap.style.transform = `translate(${(dx / len) * 26}px, ${(dy / len) * 26}px)`;
    await wait(130);
    c.wrap.style.transform = "";
    await wait(90);
    c.wrap.classList.remove("lunge");
  }
  let bannerTimer = null;
  function banner(html) {
    const b = $("g-banner");
    b.innerHTML = html;
    b.classList.add("show");
    clearTimeout(bannerTimer);
  }
  function hideBanner(delay) {
    clearTimeout(bannerTimer);
    bannerTimer = realTimeout(() => $("g-banner").classList.remove("show"), delay || 0);
  }
  function phaseCard(text, side) {
    const d = el("div", "phase-card " + side);
    d.textContent = text;
    document.body.appendChild(d);
    realTimeout(() => d.remove(), 1050);
  }

  /* ================= 6. 执行与逐步播放 ================= */
  function whoHtml(u) {
    if (!u) return "";
    return `<span class="who ${u.isPlayer ? "player" : "enemy"}">${esc(u.name)}</span>`;
  }
  function titleHtml(meta) {
    const a = unitById(meta.actorId), t = unitById(meta.targetId);
    let h = whoHtml(a);
    if (meta.skillName) h += ` · ${esc(meta.skillName)}`;
    if (t && t !== a) h += ` → ${whoHtml(t)}`;
    return h;
  }

  async function playBeats(beats, hold) {
    let longest = 0;
    const fallen = [];
    beats.forEach(b => {
      const s = G.view.get(b.id);
      if (b.kind === "stun") {
        stamp(b.id, "失衡", b.ice ? "ice" : "");
        if (window.Sfx) Sfx.stagger();   // 打出失衡：沉重、悠长的「咚——嗡——」
        longest = Math.max(longest, hold != null ? hold : 620);
      }
      if (b.kind === "kill") {
        if (window.Sfx && !G.sim) Sfx.ui("ko");
        stamp(b.id, s && s.isPlayer ? "倒下" : "击倒", "kill");
        longest = Math.max(longest, 520);
        if (s && s.isPlayer) fallen.push(s);
      }
      if (b.kind === "down") { if (window.Sfx && !G.sim) Sfx.ui("ko"); stamp(b.id, "濒死", "kill"); longest = Math.max(longest, 520); }
      if (b.kind === "heal") {
        // 加的是护盾就响护盾声，恢复生命就响治疗声
        if (window.Sfx && !G.sim) { if (b.life !== false) Sfx.ui("heal"); if (b.shield) Sfx.ui("shield"); }
        popup(b.id, "+" + b.value, "e-heal", { size: 22 }); longest = Math.max(longest, 300);
      }
    });
    if (longest) await wait(longest);
    for (const s of fallen) await announceDeath(s);
  }

  /** 玩家角色阵亡时弹一个提示框，需要确认才继续。角色会留在场上变灰。 */
  async function announceDeath(s) {
    if (G.ended) return;
    const who = s.escort ? "护送对象" : s.weaponUnit ? "武器人" : "队伍成员";
    const left = players().filter(u => !isWeaponUnit(u) && !u.dead).length;
    const tail = s.escort ? "护送失败。" : s.weaponUnit
      ? "本场无法再唤出。"
      : (left > 0 ? `队伍还剩 ${left} 人。` : "队伍已无人能战。");
    await openChoice(
      `${s.name} 阵亡`,
      `${who}${s.name} 的坚毅生命耗尽，已经倒下，本场战斗无法再行动。${tail}倒下的角色会留在场上，显示为灰色。`,
      [{ label: "知道了", value: "ok" }]
    );
  }

  function newStunId(after, pops) {
    const seen = new Set();
    const check = (id, s) => {
      if (!id || !s || seen.has(id)) return null;
      const p = G.view.get(id);
      if (s.stunned && !(p && p.stunned) && !s.dead) { seen.add(id); return id; }
      return null;
    };
    const afterMap = after ? (after instanceof Map ? after : toMap(after)) : null;
    if (afterMap) {
      for (const [id, s] of afterMap) {
        const hit = check(id, s);
        if (hit) return hit;
      }
    }
    (pops || []).forEach(e => {
      if (!e.snap) return;
      const snap = e.snap instanceof Map ? e.snap : toMap(e.snap);
      check(e.unitId, snap.get(e.unitId));
    });
    return seen.size ? [...seen][0] : null;
  }

  /** 克制命中：整个战场震一下（正反馈） */
  function advShake() {
    const f = $("g-field");
    if (!f) return;
    f.classList.remove("adv-shake"); void f.offsetWidth; f.classList.add("adv-shake");
    clearTimeout(advShake.t);
    advShake.t = setTimeout(() => f.classList.remove("adv-shake"), 420);
  }
  async function playTape(tape, after, meta) {
    const pops = tape.filter(e => e.type === "pop");
    comboPrime(pops);
    const stunId = newStunId(after, pops);
    if (meta.slow) {
      G.slow = 1.4;
      $("g-app").classList.add("hitstop");
    }
    if (meta.skillName || meta.actorId) banner(titleHtml(meta));
    // 回合结算（回合开始的区域 / 场地效果、回合结束的持续伤害……）：左上角写出现在结算的是什么
    const popCaption = new Map();
    if (meta.phase) {
      // 每个弹字配一句「为什么」：这段结算的记录（常常整块写在弹字后面）里提到这个单位、带伤害 / 治疗 / 击破的行，
      // 同一个单位按顺序一行配一个弹字（例：「灼烧：狂徒 受到 4 火焰」）
      const lines = [];
      tape.forEach(e => {
        if (e.type !== "log") return;
        String(e.text || "").split("\n").map(t => t.trim())
          .filter(t => t && !/^——|^【|回合(结束|开始)。?$/.test(t)).forEach(t => lines.push(t));
      });
      const used = new Set();
      tape.forEach(e => {
        if (e.type !== "pop") return;
        const u = unitById(e.unitId);
        const nm = u && u.name;
        let k = -1;
        if (nm) {
          k = lines.findIndex((t, n) => !used.has(n) && t.indexOf(nm) >= 0 && /\d/.test(t));
          if (k < 0) k = lines.findIndex(t => t.indexOf(nm) >= 0);
        }
        if (k >= 0) used.add(k);
        popCaption.set(e, k >= 0 ? lines[k] : "");
      });
      if (pops.length) banner(`<b>${esc(meta.phase)}</b>`);
    }
    const opps = tape.filter(e => e.type === "opp");
    if (opps.length) {
      $("g-app").classList.add("hitstop");
      const prevSlow = G.slow;
      G.slow = 1.7;
      for (let i = 0; i < opps.length; i++) {
        const o = opps[i];
        const moverCard = cards.get(o.targetId);
        if (moverCard) moverCard.wrap.classList.add("slow-move");
        banner(`${esc(o.name || "敌人")} · 借机攻击 → ` + whoHtml(unitById(o.targetId)));
        await lunge(o.attackerId, o.targetId);
        hit(o.targetId, "physical");
        if (moverCard) moverCard.wrap.classList.remove("slow-move");
      }
      G.slow = prevSlow;
      if (!meta.slow) $("g-app").classList.remove("hitstop");
    }
    // 单人模式的支援：出手的是登场的伙伴，主角不前冲（伙伴的前冲在 partner 里播）
    const supportTape = pops.some(e => e.kind === "partner");
    const lungeAtk = !opps.length && !supportTape && (meta.forceLunge || (pops.length && meta.actorId && meta.targetId && meta.actorId !== meta.targetId));
    const cmd = G.lastCmd; G.lastCmd = null;
    if (window.Sfx && !G.sim) {
      const sk = cmd && cmd.type === "skill" ? cmd.skill : "";
      const gun = /^longge_(aa|chill)$/.test(sk) && cmd.picks && cmd.picks.mode === "gun";
      if (/^hiaki_(sheath|summon)$|^(niu|naruto)_return$/.test(sk)) Sfx.ui("draw");           // 绯秋拔刀 / 收刀 / 分刀
      else if (/^(longge_safety|torque_swap)$/.test(sk)) Sfx.ui("mech");                    // 解开保险、换刀头
      if (gun) Sfx.ui("gun");
      else if (lungeAtk) {
        const a = unitById(meta.actorId), t = unitById(meta.targetId);
        if (a && t && Number(a.zone) === Number(t.zone)) Sfx.ui("swing");                     // 近战出手的破风声
      }
    }
    const motions = [];
    if (lungeAtk) motions.push(lunge(meta.actorId, meta.targetId));
    if (meta.blockerId) motions.push(lunge(meta.blockerId, meta.actorId));
    if (motions.length) await Promise.all(motions);
    // 格挡成功：兵刃相接的一声「铛——」+ 火花（玩家的协助格挡、空手格挡，敌人的格挡都算）
    const parried = !!meta.blockerId || tape.some(e => e.type === "log" && /格挡[^\n]*→ 成功/.test(e.text));
    if (parried) {
      if (window.Sfx) Sfx.parry();
      const pc = cards.get(meta.blockerId || meta.targetId);
      if (pc) { pc.wrap.classList.remove("parry"); void pc.wrap.offsetWidth; pc.wrap.classList.add("parry"); }
      await wait(90);
    }
    const firstHit = pops.find(e => e.kind === "dmg" && Number(e.value) > 0);
    if (firstHit) hit(firstHit.unitId, firstHit.element, false, firstHit);
    else if (meta.forceLunge && meta.targetId && !(meta.blockerId)) {
      /* 格挡失败仍应有受击；若伤害弹字迟到，先播受击 */
      const anyDmg = pops.some(e => e.kind === "dmg");
      if (anyDmg || pops.length) hit(meta.targetId, (pops[0] && pops[0].element) || "physical");
    }
    const zonesBefore = new Map([...G.view].map(([id, v]) => [id, v.zone]));
    const chainAfter = (i) => {
      for (let j = i + 1; j < pops.length; j++) {
        if (pops[j].kind === "dmg") return (Number(pops[j].value) || 0) > 0;
        if (pops[j].unitId !== pops[i].unitId) return false;
      }
      return false;
    };
    // 连击中途就打出的失衡先记下，等整串伤害放完再统一盖「失衡」章、响失衡声（以前这种会被漏掉）
    const pendingStun = [];
    const shownWords = new Set();
    let advShook = false;   // 克制：一段演出只震一次
    const deferStun = (bs) => bs.forEach(b => { if (b.kind === "stun" && !pendingStun.some(x => x.id === b.id)) pendingStun.push(b); });
    try {
      for (let i = 0; i < pops.length; i++) {
        const e = pops[i];
        const beatsBefore = e.snap ? setView(e.snap, true) : [];
        const s = G.view.get(e.unitId);
        if (meta.phase) {
          const why = popCaption.get(e) || "";
          banner(`<b>${esc(meta.phase)}</b> · ${whoHtml(unitById(e.unitId))}${why ? ` <span class="bn-why">${esc(why.length > 46 ? why.slice(0, 45) + "…" : why)}</span>` : ""}`);
        }
        const chain = chainAfter(i);
        if (e.kind === "dmg") {
          const v = Math.floor(Number(e.value) || 0);
          if (v <= 0) continue;
          const boom = e.tag === "boom";
          // 大伤害：和计算器同一个区间（目标等级 × 2 + 8 起，到两倍封顶），越重字越大、停得越久；评分加成也按它
          const bh = typeof bigHitInfo === "function" ? bigHitInfo(s ? s.level : 1, v) : { big: false, ratio: 0 };
          const big = bh.big;
          hit(e.unitId, e.element, big, e);
          if (e.adv && !advShook) { advShook = true; advShake(); }
          comboHit(e, v);
          popup(e.unitId, big ? v + "!" : String(v), "e-" + e.element + (big ? " big" : "") + (boom ? " boom" : ""),
            { icon: e.element, size: big ? Math.round(BIG_POP_SIZE * (0.8 + 0.35 * bh.ratio)) : boom ? 46 : 30,
              dur: boom ? 2.4 : big ? BIG_POP_DUR * (0.8 + 0.45 * bh.ratio) : 1.05 });
          if (boom) await wait(160);
          await wait(chain ? 30 : 45);
          deferStun(beatsBefore); await playBeats(beatsBefore.filter(b => b.kind !== "stun"));
          await wait(chain ? 40 : 55);
        } else if (e.kind === "partner") {
          // 伙伴登场：亮相、停一下，再冲向目标
          const pc = cards.get(e.unitId);
          if (pc) { pc.wrap.classList.remove("enter"); void pc.wrap.offsetWidth; pc.wrap.classList.add("enter"); }
          popup(e.unitId, e.text || "支援！", "txt e-" + e.element, { dur: 1.2 });
          if (window.Sfx && !G.sim) Sfx.parry();
          await wait(420);
          if (e.targetId) await lunge(e.unitId, e.targetId);
        } else if (e.kind === "bullet") {
          // 龙哥 / 小朋友消耗子弹：头顶跳出红弹 / 蓝弹
          popup(e.unitId, e.text || (e.element === "fire" ? "红弹" : "蓝弹"), "bullet " + (e.element === "fire" ? "b-red" : "b-blue"), { lift: 64, dur: 1.5 });
          await wait(160);
        } else if (e.kind === "proc") {
          // 效果生效（灼烧结算、自焚掉血、高能自爆……）：单位卡上对应的图标放大一下并发光，不占演出时间
          procBadge(e.unitId, e.fx);
        } else if (e.kind === "fxword") {
          // 攻击效果大字：同一次行动里同一个目标的同一个效果只打一次（多段攻击不重复）
          const key = e.unitId + "|" + e.text;
          if (!shownWords.has(key)) {
            shownWords.add(key);
            fxWord(e.unitId, e.text, e.element, shownWords.size);
            await wait(110);
          }
        } else if (e.kind === "highboom") {
          // 自爆前先预警：单位卡闪两下（薄荷色描边 + 高能液体发白），再炸
          const bc = cards.get(e.unitId);
          if (bc && !G.skip) {
            bc.wrap.classList.remove("high-warn"); void bc.wrap.offsetWidth; bc.wrap.classList.add("high-warn");
            if (window.Sfx && !G.sim) Sfx.ui("toggle");
            await wait(300);
            if (window.Sfx && !G.sim) Sfx.ui("toggle");
            await wait(chain ? 300 : 360);
            bc.wrap.classList.remove("high-warn");
          }
          procBadge(e.unitId, "high");
          // 高能自爆：震屏 + 大字 + 爆炸声 + 大号数字，停久一点让人看清
          const app = $("g-app");
          app.classList.remove("quake"); void app.offsetWidth; app.classList.add("quake");
          realTimeout(() => app.classList.remove("quake"), 700);
          if (window.Sfx) Sfx.boom();
          hit(e.unitId, "energy", true);
          comboHit(e, Math.floor(Number(e.value) || 0));
          stamp(e.unitId, "高能自爆", "boom");
          popup(e.unitId, (Math.floor(Number(e.value) || 0)) + "!", "e-energy big boom", { icon: "energy", size: BIG_POP_SIZE + 12, dur: 2.8 });
          await playBeats(beatsBefore.filter(b => b.kind !== "stun"));
          await wait(chain ? 380 : 520);
        } else if (e.kind === "break") {
          popup(e.unitId, "击破 " + e.value, "brk", { below: true, dur: 1.05 });
          deferStun(beatsBefore); await playBeats(beatsBefore.filter(b => b.kind !== "stun"));
          await wait(chain ? 40 : 55);
        } else {
          if (e.kind === "status" && e.text && window.Sfx && !G.sim) Sfx.ui(/振奋|坚固|坚挺|优势|躲藏|护盾|铁壁|免疫/.test(e.text) ? "shield" : /无效|打不动|触发/.test(e.text) ? "" : "debuff");
          if (e.text) popup(e.unitId, e.text, "txt e-" + e.element);
          if (e.kind === "status" && e.text && window.HudIcons) procBadge(e.unitId, HudIcons.keyOf(e.text));
          deferStun(beatsBefore); await playBeats(beatsBefore.filter(b => b.kind !== "stun"));
          await wait(240);
        }
      }
      const beats = setView(after, true);
      pendingStun.forEach(b => {
        const now = G.view.get(b.id);
        if (now && now.stunned && !now.dead && !beats.some(x => x.kind === "stun" && x.id === b.id)) beats.unshift(b);
      });
      if (stunId) {
        G.slow = 1;
        await playBeats(beats, 150);
        await wait(150);
      } else {
        await playBeats(beats);
        const moved = [...G.view].some(([id, v]) => zonesBefore.has(id) && zonesBefore.get(id) !== v.zone);
        await wait(moved ? 820 : pops.length ? 200 : 380);
      }
    } finally {
      G.slow = 1;
      $("g-app").classList.remove("hitstop");
      hideBanner(120);
    }
  }

  async function perform(thunk, meta, system = false, context) {
    if (system && window.OnlineGame?.isHost()) await OnlineGame.waitUntilReady();
    meta = meta || {};
    G.skip = false;
    G.tape = [];
    let result;
    try { result = typeof thunk === "function" ? thunk() : system ? systemCommand(thunk, context) : dispatch(thunk); if (result && result.meta) Object.assign(meta, result.meta); } catch (e) {
      if (window.OnlineGame?.isHost() && (system || e.code !== "HOTSEAT_REJECT")) { meta.onlineError = true; OnlineGame.reportError(e); }
      if (context && window.OnlineGame?.isHost()) { G.tape = null; OnlineGame.onActionSettled(thunk, { executed: false }, [], meta); throw e; }
      if (hotseat() && !system) { G.tape = null; flashHint(e.message); return null; }
      console.error(e);
      G.tape.push({ type: "log", text: "结算出错：" + e.message });
    }
    const tape = G.tape;
    G.tape = null;
    // 有些演出要看结算之后的局面才知道（例：连续协助格挡时这一击有没有落下）
    if (typeof meta.forceLunge === "function") meta.forceLunge = !!meta.forceLunge();
    if (typeof meta.blockerId === "function") meta.blockerId = meta.blockerId() || null;
    if (window.OnlineGame?.isHost()) OnlineGame.onActionSettled(meta.onlineLegacy ? { type: "gm.legacy" } : thunk, result, tape, meta);
    if (result && result.executed === false) return null;
    const after = snapAll();
    await playTape(tape, after, meta);
    pushLog(meta, tape);
    refreshHud();
    return tape;
  }

  async function act(thunk, meta, context) {
    pushUndo((meta && meta.skillName) || "行动");
    G.depth++;
    syncBusy();
    comboStart();
    try {
      const tape = await perform(thunk, meta, !!context, context);
      if (hotseat() && tape === null) return false;
      await resolveQueues();
      if (hotseat()) return true;
    } finally {
      comboEnd();
      G.depth--;
      G.version++;
      syncBusy();
      if (hotseat()) autoSelect(true);
      refreshAll();
      checkEnd();
      resumeHotseat();
    }
  }

  function syncBusy() {
    $("g-app").classList.toggle("busy", G.depth > 0);
    paintUndo();
    refreshHud();
  }

  /* ================= 7. 格挡与协助 ================= */
  function withPhaseOf(u, fn) {
    const prev = state.combatPhase;
    if (u && u.isPlayer) state.combatPhase = "player";
    if (u && !u.isPlayer) state.combatPhase = "enemy";
    try { fn(); } finally { state.combatPhase = prev; }
  }

  /** d100 检定动画（协助格挡、事件里的熟练项检定共用）：数字滚动后停在 spec.roll，按 spec.ok 变色。
   *  spec：{ who, chance, roll, ok, note, okText, failText } */
  function playBlockCheck(spec) {
    return new Promise(resolve => {
      const box = $("g-check");
      const num = $("g-check-num");
      $("g-check-who").textContent = spec.who || "协助格挡";
      $("g-check-rate").textContent = (spec.rateText || "成功率 " + spec.chance + "%") + (spec.note ? " · " + spec.note : "");
      $("g-check-hint").textContent = "检定中";
      if (window.Sfx && !G.sim) Sfx.ui("dice");   // 掷骰
      num.textContent = String(1 + Math.floor(Math.random() * 100));
      num.className = "check-num";
      box.classList.add("show");
      let delay = 28;
      let ticks = 0;
      const target = Math.max(1, Math.min(100, Number(spec.roll) || 1));
      const step = () => {
        ticks++;
        if (G.skip && ticks > 4) delay = 400;
        if (delay < 220) {
          num.textContent = String(1 + Math.floor(Math.random() * 100));
          delay = Math.min(240, delay * 1.22 + 6);
          realTimeout(step, delay);
          return;
        }
        num.textContent = String(target);
        num.classList.add(spec.ok ? "ok" : "fail");
        $("g-check-hint").textContent = spec.ok ? (spec.okText || "格挡成功") : (spec.failText || "格挡失败");
        realTimeout(() => {
          box.classList.remove("show");
          G.skip = false;
          resolve(spec);
        }, spec.ok ? 720 : 640);
      };
      realTimeout(step, delay);
    });
  }

  async function resolveQueues() {
    for (let guard = 0; guard < 40; guard++) {
      if (window.OnlineGame?.isHost()) await OnlineGame.waitUntilReady();
      if (G.ended) return;
      if (state.blockQueue && state.blockQueue.length) {
        const job = state.blockQueue[0];
        const attacker = blockJobAttacker(job), target = unitById(job.targetId);
        if (!attacker || !target) { systemCommand({ type: "battle.cleanQueues", queue: "block" }); continue; }
        const helpers = eligibleBlockers(target, job);
        const walls = typeof featIronwallDeclarers === "function" ? featIronwallDeclarers(target) : [];   // 铁壁（feats.js）
        let choice = null;
        if (helpers.length || walls.length) choice = await promptBlock(job, attacker, target, helpers, walls);
        const blocker = unitById(choice);
        let forced = null;
        if (blocker) {
          const chance = finalBlockChance(blocker, attacker, target);
          const iai = blocker.kit === "hiaki" && blocker.resources && blocker.resources.stance === "iai";
          const roll = blockRollFor(job);   // 按这一击的编号定种子：和 Helumica 预测的是同一颗骰子
          const ok = iai ? true : roll <= chance;
          forced = { roll, ok, chance, iai };
          await playBlockCheck({
            who: `${blocker.name} 格挡 ${attacker.name}`,
            chance,
            roll,
            ok,
            note: iai ? "居合：必定成功" : ""
          });
        }
        const seq = job.seq;
        // 连续协助格挡：这个人没挡住、还有别人能挡时，这一击还没落下（同一击仍在队首）——
        // 不播敌人的攻击动画，直接回到循环弹出下一个人的格挡确认
        const stillWaiting = () => !!(state.blockQueue && state.blockQueue[0] && state.blockQueue[0].seq === seq);
        await perform({ type: "blockAnswer", helper: choice || null, forced, seed: "hit:" + seq }, {
          actorId: attacker.propId ? "prop:" + attacker.propId : attacker.id, targetId: target.id,
          forceLunge: () => !stillWaiting(),
          blockerId: () => (blocker && forced && forced.ok && !stillWaiting() ? blocker.id : null),
          skillName: blocker ? `攻击（${blocker.name} 格挡）` : "攻击"
        }, true);
        continue;
      }
      if (state.koltSwapQueue && state.koltSwapQueue.length) {
        const job = state.koltSwapQueue[0];
        const k = unitById(job.actorId);
        if (!k) { systemCommand({ type: "battle.cleanQueues", queue: "kolt" }); continue; }
        const foes = typeof koltMeleeSwapTargets === "function" ? koltMeleeSwapTargets(k) : [];
        const opts = [{ label: "不切换", value: { swap: false } }];
        if (!foes.length) opts.push({ label: "切换刀头", sub: "同区没有可打的敌人", value: { swap: true, targetId: null } });
        else foes.forEach(u => opts.push({ label: `切换并打 ${u.name}`, sub: "近距离 0.5 ATK", value: { swap: true, targetId: u.id } }));
        let pick;
        if (hotseat()) pick = await HotseatGame.ownedChoice(k, "更换刀头", opts);
        else if (foes.length && allOnField(foes.map(u => u.id))) {
          // 在战场上点要追击的敌人；按钮：只换刀不打 / 不切换
          const got = await queueFieldPick(`<b>${esc(k.name)} 更换刀头</b>：点同区一名敌人切刀追击（近距离 0.5 ATK），或者不切换`,
            foes.map(u => ({ id: u.id })), (id) => `${k.name} 切刀 → ${targetName(id)}`, [{ label: "不切换", value: "no" }]);
          pick = got && typeof got === "object" ? { swap: false } : got ? { swap: true, targetId: got } : { swap: false };
        } else pick = await openChoice("更换刀头", `${k.name} 可以更换刀头。切刀攻击只能打同区目标。`, opts, { label: "不切换", value: { swap: false } });
        const swapTarget = (pick && pick.swap && pick.targetId) || null;
        if (pick && pick.swap) {
          // 换刀头的追击：和协助攻击一样播攻击演出（冲上去打同区那名敌人）
          const nextBit = (k.resources && k.resources.bit) === "acid" ? "电钻" : "酸液炮";
          await perform({ type: "koltSwapAnswer", swap: true, target: swapTarget }, {
            actorId: k.id, targetId: swapTarget, forceLunge: !!swapTarget, slow: true,
            skillName: `更换刀头 · ${nextBit}`
          }, true);
        } else {
          systemCommand({ type: "koltSwapAnswer", swap: false, target: null });
        }
        continue;
      }
      // 龙哥解开保险：技能结算完才问要不要把最后一发移到最前（取消技能看不到颜色）
      if (state.longgeSafetyQueue && state.longgeSafetyQueue.length) {
        const job = state.longgeSafetyQueue[0];
        const lg = unitById(job.actorId);
        const r = lg && typeof longgeRes === "function" ? longgeRes(lg) : null;
        if (!r || r.ammo.length < 2) { systemCommand({ type: "battle.cleanQueues", queue: "longge" }); continue; }
        const last = LONGGE_AMMO[r.ammo[r.ammo.length - 1]].name;
        const opts = [{ label: "移到最前", sub: `下一发就是${last}`, value: "front" }, { label: "留在最后", value: "stay" }];
        const pick = hotseat() ? await HotseatGame.ownedChoice(lg, "解开保险", opts)
          : await openChoice("解开保险", `最后一发是${last}。要把它移到队列最前面吗？`, opts, { label: "留在最后", value: "stay" });
        systemCommand({ type: "longgeSafetyAnswer", front: pick === "front" });
        continue;
      }
      // Helumica 协助攻击附带的环境扫描：区域已定（被打的敌人所在的区），按环境扫描的选项一步步问
      if (state.heluScanQueue && state.heluScanQueue.length) {
        const job = state.heluScanQueue[0];
        const h = unitById(job.actorId);
        if (!h) { systemCommand({ type: "battle.cleanQueues", queue: "helu" }); continue; }
        const SKIP = "__skip";
        const ask = (title, text, opts) => hotseat()
          ? HotseatGame.ownedChoice(h, title, opts.concat([{ label: "放弃扫描", value: SKIP }]))
          : openChoice(title, text, opts, { label: "放弃扫描", value: SKIP });
        const picks = { dest: job.zone };
        let skipped = false;
        for (let g = 0; g < 8; g++) {
          let steps = [];
          try { steps = skillFlowSteps("helu_scan", h, picks) || []; } catch (e) { steps = []; }
          const step = steps.find(st => picks[st.key] === undefined);
          if (!step) break;
          const opts = step.type === "unit"
            ? (step.units || []).map(u => ({ label: u.name, sub: u.zone ? `${u.zone} 区` : "", value: u.id }))
            : (step.options || []).map(o => ({ label: o.label, value: o.value }));
          let v;
          if (!hotseat() && step.type === "unit" && allOnField((step.units || []).map(u => u.id))) {
            const got = await queueFieldPick(`<b>环境扫描 · ${job.zone} 区</b>：${esc(step.label)}`,
              (step.units || []).map(u => ({ id: u.id })), (id) => `环境扫描 → ${targetName(id)}`, [{ label: "放弃扫描", value: SKIP }]);
            v = got && typeof got === "object" ? SKIP : got;
          } else v = await ask(`环境扫描 · ${job.zone} 区`, `协助攻击附带的环境扫描。${step.label}`, opts);
          if (v == null || v === SKIP) { skipped = true; break; }
          picks[step.key] = v;
        }
        await perform({ type: "heluScanAnswer", picks: skipped ? null : picks }, { actorId: animActor(h.id, "helu_scan", picks), targetId: (!skipped && picks.target) || null, skillName: "环境扫描" }, true);
        continue;
      }
      if (state.assistQueue && state.assistQueue.length) systemCommand({ type: "battle.cleanQueues", queue: "assist" });
      if (state.assistQueue && state.assistQueue.length) {
        const job = state.assistQueue[0];
        const target = unitById(job.targetId), breaker = unitById(job.breakerId);
        const list = target ? eligibleAssisters(breaker, target) : [];
        let choice = null, hotseatExtra = {};
        if (list.length) {
          if (hotseat() && !job.vsPlayer) {
            const options = list.flatMap(h => {
              if (h.kit === "longge") {
                const ammo = ((h.resources || {}).ammo || []).length;
                // 手杖有子弹时顺带治疗：每个能治疗的同区友方（含自己）各一个选项
                const cane = ammo ? longgeHealOptions(h, target).map(u => ({ helper: h.id, label: `${h.name} · 手杖（治疗 ${u.name}）`, sub: "协助攻击 · 0.5 ATK 冰 · 耗 1 发治疗", extra: { mode: "cane", heal: u.id } }))
                  : [{ helper: h.id, label: h.name + " · 手杖", sub: "协助攻击 · 0.5 ATK 冰", extra: { mode: "cane" } }];
                return cane.concat(ammo ? [{ helper: h.id, label: h.name + " · 霰弹枪", sub: "协助攻击 · 1.5 ATK", extra: { mode: "gun" } }] : []);
              }
              if (h.kit !== "hiaki") return [{ helper: h.id, label: h.name, sub: "协助攻击" }];
              const r = h.resources || {}, blades = [];
              if (!r.niuOut) blades.push("niu"); if (!r.narutoOut) blades.push("naruto");
              if (!blades.length) blades.push("niu", "naruto");
              return blades.map(blade => ({ helper: h.id, label: h.name + " · " + (blade === "niu" ? "丹生谷" : "鳴門"), sub: "协助攻击", extra: { blade } }));
            });
            const answer = await HotseatGame.requestAsk("assist", target.name + " 失衡 · 协助攻击", options, () => eligibleAssisters(breaker, target), job);
            choice = answer.unitId; hotseatExtra = answer.extra;
          } else choice = job.vsPlayer ? aiPickAssister(list) : await promptAssist(job, target, list);
        }
        const helper = unitById(choice);
        let extra = hotseatExtra;
        if (helper && helper.kit === "hiaki" && !extra.blade) {
          const r = helper.resources || {};
          const blades = [];
          if (!r.niuOut) blades.push({ label: "丹生谷", sub: "火焰 · 1.5 ATK", value: "niu" });
          if (!r.narutoOut) blades.push({ label: "鳴門", sub: "冰冻 · 1.5 ATK · 击破 +1", value: "naruto" });
          if (!blades.length) {
            blades.push({ label: "丹生谷", sub: "火焰 · 1.5 ATK（收回后使用）", value: "niu" });
            blades.push({ label: "鳴門", sub: "冰冻 · 1.5 ATK · 击破 +1（收回后使用）", value: "naruto" });
          }
          const pick = blades.length === 1 ? blades[0].value : await openChoice(
            "绯秋协助攻击",
            "选择使用哪一把刀。绯秋会切换到这把刀。",
            blades,
            { label: "取消", value: null }
          );
          if (!pick) {
            systemCommand({ type: "assistAnswer", helper: null, extra: {} });
            continue;
          }
          extra.blade = pick;
        }
        if (helper && helper.kit === "longge" && !extra.mode) {
          // 枪管手杖：协助攻击可选手杖或霰弹枪（立刻解锁扳机；霰弹枪要有子弹）
          const ammo = ((helper.resources || {}).ammo || []).length;
          const modes = [{ label: "手杖", sub: "移动到敌人那一区戳刺 0.5 ATK 冰；有子弹则耗 1 发给同区友方治疗", value: "cane" }];
          if (ammo) modes.push({ label: "霰弹枪", sub: `耗 1 发子弹 · 1.5 ATK 子弹属性（${typeof longgeAmmoText === "function" ? longgeAmmoText(helper) : ""}）`, value: "gun" });
          const pick = modes.length === 1 ? "cane" : await openChoice("龙哥协助攻击", "选择手杖还是霰弹枪。无论哪种都会立刻解锁扳机，并窥探 2。", modes, { label: "取消", value: null });
          if (!pick) {
            systemCommand({ type: "assistAnswer", helper: null, extra: {} });
            continue;
          }
          extra.mode = pick;
          // 手杖有子弹：自己选治疗同区的哪一名友方（含自己；龙哥会移动到敌人那一区）
          if (pick === "cane" && ammo) {
            const opts = longgeHealOptions(helper, target).map(u => ({ label: u.name, sub: u.id === helper.id ? "自己" : `${u.zone} 区`, value: u.id }));
            const heal = opts.length === 1 ? opts[0].value : await openChoice("龙哥 · 手杖治疗", `戳刺后会耗 1 发子弹治疗：选一名 ${target.zone} 区的友方（含自己）。蓝弹固定治疗等级 + 5，红弹治疗已损失血量的 40%。`, opts, { label: "让程序选（血量比例最低）", value: null });
            if (heal) extra.heal = heal;
          }
        }
        const bladeName = extra.blade === "naruto" ? "鳴門" : extra.blade === "niu" ? "丹生谷" : extra.mode === "gun" ? "霰弹枪" : extra.mode === "cane" ? "手杖" : "";
        await perform({ type: "assistAnswer", helper: choice || null, extra }, {
          actorId: choice, targetId: job.targetId, forceLunge: !!helper, slow: !!helper,
          skillName: helper ? ("协助攻击" + (bladeName ? " · " + bladeName : "")) : ""
        }, true);
        continue;
      }
      return;
    }
  }

  /** 龙哥手杖协助攻击能治疗的人：敌人所在区的友方，加上龙哥自己（他会移动过去） */
  function longgeHealOptions(lg, target) {
    const z = Number(target.zone);
    const list = state.units.filter(u => u.isPlayer && unitAlive(u) && u.id !== lg.id && Number(u.zone) === z);
    return [lg].concat(list);
  }
  let choiceResolve = null;
  let choiceKeys = [];
  function openChoice(title, text, options, cancel) {
    return new Promise(resolve => {
      const box = $("g-choice");
      box.querySelector("h3").textContent = title;
      box.querySelector("p").textContent = text || "";
      const opts = box.querySelector(".opts");
      opts.innerHTML = "";
      choiceKeys = [];
      const finish = (v) => {
        box.classList.remove("show");
        clearPreview();
        choiceResolve = null;
        resolve(v);
      };
      options.forEach((o, i) => {
        const b = el("button", "", `<span class="key">${i + 1}</span>${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ""}`);
        b.onclick = () => finish(o.value);
        if (o.onHover) {
          b.onmouseenter = o.onHover;
          b.onmouseleave = () => { clearPreview(); if (o.onLeave) o.onLeave(); };
        }
        opts.appendChild(b);
        choiceKeys.push(() => finish(o.value));
      });
      if (cancel) {
        const b = el("button", "", `<span class="key">Esc</span>${esc(cancel.label)}`);
        b.onclick = () => finish(cancel.value);
        if (cancel.onHover) { b.onmouseenter = cancel.onHover; b.onmouseleave = clearPreview; }
        opts.appendChild(b);
      }
      choiceResolve = { cancel: () => finish(cancel ? cancel.value : null) };
      box.classList.add("show");
      if (cancel && cancel.showOnOpen) cancel.onHover();
    });
  }

  function promptBlock(job, attacker, target, helpers, walls) {
    walls = walls || [];
    if (hotseat()) return HotseatGame.requestAsk("block", `${job.opt && job.opt.flags && job.opt.flags.execution ? `【${job.opt.flags.execName || "死刑"} ${job.opt.flags.execHit}/${job.opt.flags.execHits}】` : ""}${attacker.name} 攻击 ${target.name} · 协助格挡`,
      helpers.map(h => ({ helper: h.id, label: h.name, sub: `格挡成功率 ${finalBlockChance(h, attacker, target)}%` })),
      () => eligibleBlockers(target, job), job).then(answer => answer.unitId);
    const noBlock = () => showPreview(previewOf(() => finishBlock(null)), `${attacker.name} → ${target.name}（不格挡）`);
    const again = job.tried && job.tried.length;
    // 首领机制·死刑：标题写明是死刑的第几段（每一段都要单独挡）
    const fl = (job.opt && job.opt.flags) || {};
    const what = fl.execution ? `【${fl.execName || "死刑"} ${fl.execHit}/${fl.execHits}】${attacker.name} 处刑 ${target.name}` : `${attacker.name} 攻击 ${target.name}`;
    return openChoice(
      again ? `${what} · 前面的格挡失败了` : what,
      again ? "还有队友可以接着协助格挡；都不挡，这一击照常落下。闪白部分是不格挡时会受到的伤害。"
        : "同区有附赠行动的队友可以协助格挡。成功免伤，击破改由格挡者承担（最少留 1）；失败了其他队友还能接着挡。闪白部分是不格挡时会受到的伤害。",
      helpers.map(h => ({
        label: `${h.name} ${h.dying && !h.upOnShp ? "起身并格挡" : isUnarmed(h) ? "空手格挡" : "格挡"}`,
        sub: `成功率 ${finalBlockChance(h, attacker, target)}% · 消耗附赠行动${h.dying && !h.upOnShp ? " · 会先起身，之后受伤改打坚毅生命" : ""}`,
        value: h.id,
        onHover: noBlock
      })).concat(walls.map(h => ({
        label: `${h.name} 铁壁`,
        sub: "专长 · 这一击视为协助格挡成功（免伤，击破由自己承担、最少留 1）· 每场一次 · 不花附赠动作",
        value: "ironwall:" + h.id,
        onHover: noBlock
      }))),
      { label: "不格挡", value: null, onHover: noBlock, showOnOpen: true }
    );
  }

  function promptAssist(job, target, list) {
    return openChoice(
      `${target.name} 失衡`,
      "选择一名队友发动协助攻击。协助攻击无法被格挡，发动者架势回满。把鼠标放在人名上预览。",
      list.map(h => ({
        label: `${h.name}`,
        sub: "协助攻击",
        value: h.id,
        onHover: () => showPreview(previewOf(() => withPhaseOf(h, () => finishAssist(h.id))), `${h.name} 协助攻击 → ${target.name}`)
      })),
      { label: "不发动", value: null }
    );
  }

  /* ================= 8. 目标选择与预览显示 ================= */
  // 悬停技能的预演（见下面「悬停技能就预演」）：timer 是等着算的那一下，shown 表示现在画着的是它
  const skHover = { timer: 0, shown: false };
  function clearPreview() {
    skHover.shown = false;
    cards.forEach(c => {
      c.segs.forEach(sg => { if (!sg) return; sg.sure.style.width = sg.maybe.style.width = sg.heal.style.width = "0"; });
      c.pips.forEach(p => p.classList.remove("pv", "maybe"));
      c.wrap.classList.remove("pv-stun", "maybe", "ice", "pv-adv", "pv-dis", "pv-cand");
      c.tag.classList.remove("show", "compact");
    });
    if (!G.arm) idleBox();
  }

  /** 资源变化写成一句，只留前后不一样的几项：「引擎关闭 · 燃油 0/5」→「引擎启动 · 燃油 0/5」写成「资源：引擎关闭 → 引擎启动」；
   *  只多出来的写「资源：+已准备」，只少了的写「资源：−机甲中」。文字取快照里的 res，没有就不写；配置物的 res 是阵营 */
  function resChangeText(p) {
    if (!p || !p.resChanged) return "";
    const a = String(p.resBefore || ""), b = String(p.resAfter || "");
    if (!a && !b) return "";
    const pa = a ? a.split(" · ") : [], pb = b ? b.split(" · ") : [];
    const da = pa.filter(t => !pb.includes(t)), db = pb.filter(t => !pa.includes(t));
    const what = p.isProp ? "阵营" : "资源";
    if (da.length && db.length) return `${what}：${da.join(" · ")} → ${db.join(" · ")}`;
    if (db.length) return `${what}：+${db.join(" · ")}`;
    if (da.length) return `${what}：−${da.join(" · ")}`;
    return `${what}：${a} → ${b}`;
  }

  /** 一张单位卡上画预演结果：血条上闪要打掉 / 补上的那段、架势格、失衡光，卡片上方的数值牌 */
  function paintUnitPreview(c, p) {
    p.layers.forEach((l, i) => {
      const sg = c.segs[i];
      if (!sg || l.max <= 0) return;
      const pct = (v) => (v / l.max) * 100 + "%";
      if (l.hi < l.before) {
        sg.sure.style.left = pct(l.hi);
        sg.sure.style.width = pct(l.before - l.hi);
      }
      if (l.lo < l.hi && l.lo < l.before) {
        sg.maybe.style.left = pct(l.lo);
        sg.maybe.style.width = pct(Math.min(l.hi, l.before) - l.lo);
      }
      if (l.hi > l.before) {
        sg.heal.style.left = pct(l.before);
        sg.heal.style.width = pct(l.hi - l.before);
      }
    });
    c.pips.forEach((pip, i) => {
      if (i >= p.defAfterHi && i < (p.defAfterHi + p.brLo)) pip.classList.add("pv");
      else if (i >= p.defAfterLo && i < p.defAfterHi) pip.classList.add("pv", "maybe");
    });
    if (p.adv && p.dmgHi > 0) c.wrap.classList.add("pv-adv");
    if (p.dis && p.dmgHi > 0) c.wrap.classList.add("pv-dis");
    if (p.stunSure || p.stunMaybe) {
      c.wrap.classList.add("pv-stun");
      if (p.stunMaybe) c.wrap.classList.add("maybe");
      if (p.ice) c.wrap.classList.add("ice");
    }
    let h = "";
    if (p.dmgHi > 0 && p.adv) h += `<span class="adv">克制</span>`;
    if (p.dmgHi > 0 && p.dis) h += `<span class="disadv">劣势</span>`;
    if (p.dmgHi > 0) h += `<span class="dmg e-${p.element}${p.dis ? " dis" : ""}">${window.Icons ? Icons.element(p.element) : ""}${p.dmgLo === p.dmgHi ? p.dmgHi : p.dmgLo + "–" + p.dmgHi}</span>`;
    if (p.healHi > 0) h += `<span class="heal">+${p.healHi}</span>`;
    if (p.shpLoss > 0) h += `<span class="note">${typeof shpHidden === "function" && shpHidden() ? "伤到坚毅" : `坚毅 −${p.shpLoss}`}</span>`;
    if (p.brHi > 0) h += `<span class="brk">击破 ${p.brLo === p.brHi ? p.brHi : p.brLo + "–" + p.brHi}</span>`;
    if (p.stunSure) h += `<span class="stun${p.ice ? " ice" : ""}">失衡${p.ice ? "·冰冻" : ""}</span>`;
    if (p.stunMaybe) h += `<span class="stun${p.ice ? " ice" : ""}">可能失衡</span>`;
    if (p.killSure) h += `<span class="kill">击倒</span>`;
    if (p.killMaybe) h += `<span class="kill">可能击倒</span>`;
    if (p.zoneTo != null) h += `<span class="note">→ ${p.zoneTo} 区</span>`;
    if (p.newStatus.length) h += `<span class="note">+${esc(p.newStatus.join(" "))}</span>`;
    const res = resChangeText(p);
    if (res) h += `<span class="note res">${esc(res)}</span>`;
    if (h) {
      c.tag.innerHTML = h;
      const fieldTop = $("g-field").getBoundingClientRect().top;
      c.tag.classList.toggle("below", c.wrap.getBoundingClientRect().top - fieldTop < 52);
      c.tag.classList.add("show");
    }
  }

  /** 好几张卡同时出伤害 / 治疗 / 击破这类数值牌时（悬停技能对每个候选目标的预演、范围技能）：
   *  牌子收进卡片右下角、字小一号。不然下一排卡的牌子浮在卡片上方，正好盖住上一排卡的血量 */
  function compactTags() {
    const shown = [...cards.values()].filter(c => c.tag.classList.contains("show"));
    const many = shown.filter(c => c.tag.querySelector(".dmg, .heal, .brk, .stun, .kill")).length > 1;
    shown.forEach(c => { c.tag.classList.toggle("compact", many); if (many) c.tag.classList.remove("below"); });
  }

  /** opts.cost：预览框标题下面先写一行消耗（悬停技能的预演用） */
  function showPreview(pv, title, opts) {
    clearPreview();
    pv.units.forEach((p, id) => {
      const c = cards.get(id);
      if (!c || !p.changed) return;
      paintUnitPreview(c, p);
    });
    compactTags();
    const box = $("g-pvbox");
    box.classList.add("live");   // 手机：预览浮在操作栏上面
    const lines = pv.lines.filter(t => !COST_LINE.test(t)).slice(0, 18);
    // 资源变化单独写一行（例：「夕夏 资源：引擎关闭 → 引擎启动」）
    const res = [];
    pv.units.forEach((p, id) => { const t = resChangeText(p); if (t) res.push(`<div class="ln key">${esc(p.name || targetName(id))} ${esc(t)}</div>`); });
    box.innerHTML = `<h4>${esc(title || "预览")}</h4>` +
      (opts && opts.cost ? `<div class="ln key pv-cost">${esc(opts.cost)}</div>` : "") +
      (pv.meaningful ? "" : `<div class="ln key">${esc(pv.reason)}</div>`) +
      res.join("") +
      lines.map(t => `<div class="ln${/→|失衡|击倒|合计/.test(t) ? " key" : ""}">${colorLine(t)}</div>`).join("") +
      `<div class="ln">骰子按最小 / 最大各预演一次；格挡等判定按失败预演。</div>`;
  }

  function idleBox() {
    $("g-pvbox").classList.remove("live");
    const a = unitById(G.actorId);
    $("g-pvbox").innerHTML = `<h4>${a ? esc(a.name) : "选择角色"}</h4>
      <div class="ln">${a && a.note ? esc(a.note) : ""}</div>
      <div class="ln">${touchUI() ? "点技能，再点目标预览伤害与击破，再点一下出手；不用选目标的技能第一下先预演，再点一下才放出去；点空白处取消。" : "鼠标停在技能上先看预演（消耗、会打到谁、附带的变化）。点技能或按数字键，把鼠标移到目标上预览伤害与击破。左键出手，右键或 Esc 取消。"}</div>
      <div class="ln">闪白＝会被打掉的血量与架势；金光＝这一下会造成失衡；蓝光＝冰属性击破造成失衡（冰冻）。</div>`;
  }

  /* ---------- 悬停技能就预演 ----------
   * 鼠标停在技能按钮上（还没选目标）就按当前数值预演一次：消耗、会打到谁、附带的状态 / 护盾 / 治疗 / 移动 / 资源变化。
   * 判定照 armSkill 走：
   *   有分步选择的（skillFlowSteps 不是空的；道具、移动也算）：不预演，预览框写消耗和要先选什么；
   *   probe 说不用选目标的：预演一次，受影响的单位卡照常出数值牌、血条闪段；
   *   要选目标的：对每个候选目标（最多 8 个）各预演一次，每张候选卡上只画它自己被选中时的结果，预览框里每个目标一行。
   * 预演在一份用完就扔的局面上跑（HotseatValidation.inspect：state / LEDGER 连对象引用都原样还回去），
   * 再把 G.lastCmd 还原（演出按它挑音效），所以悬停不改变任何东西：不扣点、不消耗随机数、不进指令日志。
   * 技能栏每重画一次（refreshHud）算一个新局面：同一个局面里同一个角色、同一个技能重复悬停直接用缓存。
   * 触屏没有悬停：不用选目标、也没有分步的技能第一下点按钮先预演，再点同一个按钮才放出去；点别的地方取消。 */
  const SKILL_PV_DELAY = 120;   // 停这么久（毫秒）才算：鼠标扫过一排按钮不卡
  let hudEpoch = 0;             // refreshHud 每画一次技能栏 +1
  let skPvStamp = "";
  let skPvCache = new Map();    // actorId|skillId → 这个局面里算好的预演
  function skillPvStampNow() {
    let n = 0;
    (state.logPages || []).forEach(pg => { n += (pg.lines || []).length; });
    return `${hudEpoch}|${G.version}|${state.turnNo}|${n}`;
  }
  /** 现在能不能预演：我方回合、没有在选目标、没有演出在播、没有弹窗、战斗没结束。能就返回当前角色 */
  function skillPvActor() {
    if (!state.combatStarted || state.combatPhase !== "player" || G.ended || G.depth > 0 || G.arm || choiceResolve) return null;
    const a = unitById(G.actorId);
    return a && a.isPlayer && !a.hidden ? a : null;
  }
  /** 在用完就扔的局面上跑预演；跑完 state / LEDGER（连对象引用）、G.lastCmd 都原样还回去 */
  function disposablePreview(fn) {
    const keep = G.lastCmd;
    try { return window.HotseatValidation && HotseatValidation.inspect ? HotseatValidation.inspect(fn) : fn(); }
    finally { G.lastCmd = keep; }
  }
  /** 这个技能悬停时画什么（缓存） */
  function skillPvInfo(actor, sk) {
    const stamp = skillPvStampNow();
    if (stamp !== skPvStamp) { skPvStamp = stamp; skPvCache = new Map(); }
    const key = actor.id + "|" + sk.id;
    let info = skPvCache.get(key);
    if (!info) {
      info = disposablePreview(() => skillPvProbe(actor.id, sk));
      skPvCache.set(key, info);
    }
    return info;
  }
  function skillPvProbe(actorId, sk) {
    if (sk.id === "__item") return { kind: "flow", text: "分步选择：先选背包里的道具；要选对象的道具，选对象时再预览。" };
    if (sk.id === "__move") return { kind: "flow", text: "分步选择：先选去哪个相连的区，把鼠标移到区上再预览（离开有借机攻击敌人的区域会被追打）。" };
    let steps = [];
    if (sk.id !== "__stand") { try { steps = skillFlowSteps(sk.id, unitById(actorId), {}) || []; } catch (e) { steps = []; } }
    if (steps.length) {
      const labels = steps.slice(0, 3).map(s => s.label || "选项");
      return { kind: "flow", text: `分步选择：先选「${labels.join("」，再选「")}」，选好后再预览。` };
    }
    const pv = previewOf(skillThunk(actorId, sk.id, null, {}));
    return pv.needsTarget ? { kind: "target", targets: null } : { kind: "self", pv };
  }
  function skillCostText(actor, sk) {
    const c = sk.cost || {}, parts = [];
    if (c.ap) parts.push(`行动点 ${c.ap}（现有 ${Number(actor.ap) || 0}）`);
    if (c.bonus) parts.push(`附赠 ${c.bonus}（现有 ${Number(actor.bonus) || 0}）`);
    return parts.length ? "消耗 " + parts.join(" · ") : "不耗行动点和附赠";
  }
  function skillPvBox(title, cost, body) {
    const box = $("g-pvbox");
    box.classList.add("live");
    box.innerHTML = `<h4>${esc(title)}</h4><div class="ln key pv-cost">${esc(cost)}</div>` + body;
  }
  /** 要选目标的技能：悬停技能按钮时只把能选的目标高亮出来（和选目标时一样），不在每张卡上画伤害——
   *  那样看起来像范围技能。点了技能以后把鼠标移到单位上，才预览打这一个目标的结果 */
  function paintSkillPvTargets(sk, info, cost) {
    clearPreview();
    const actor = skillPvActor();
    const cands = actor ? candidateUnits(actor, sk) : [];
    cands.forEach(u => { const c = cards.get(u.id); if (c) c.wrap.classList.add("pv-cand"); });
    if (!cands.length) {
      skillPvBox(`${sk.name} · 预演`, cost, `<div class="ln key pv-why">没有可选目标</div>`);
      return;
    }
    const names = cands.slice(0, 8).map(u => esc(u.name || targetName(u.id)));
    skillPvBox(`${sk.name} · 选目标`, cost, `<div class="ln">能选的目标已经高亮：${names.join("、")}${cands.length > 8 ? " 等" : ""}。</div>` +
      `<div class="ln">点技能后把鼠标移到目标上，看打这一个目标的完整结算。</div>`);
  }
  /** 把算好的预演画出来（卡片 + 预览框）。kind：self 不用选目标 / target 要选目标 / flow 分步（只写说明）/ note 出错 */
  function paintSkillPv(actor, sk, info) {
    const cost = skillCostText(actor, sk);
    if (info.kind === "self") showPreview(info.pv, `${sk.name} · 预演`, { cost });
    else if (info.kind === "target") paintSkillPvTargets(sk, info, cost);
    else { clearPreview(); skillPvBox(sk.name, cost, `<div class="ln key">${esc(info.text)}</div>`); }
    skHover.shown = true;
  }
  /** 鼠标停够了：技能不能用就写原因，能用就预演 */
  function showSkillPv(sk) {
    const actor = skillPvActor();
    if (!actor) return;
    const why = blockReason(actor, sk);
    if (why) {
      clearPreview();
      skillPvBox(sk.name, skillCostText(actor, sk), `<div class="ln key pv-why">不能用：${esc(why)}</div>`);
      skHover.shown = true;
      return;
    }
    let info;
    try { info = skillPvInfo(actor, sk); }
    catch (e) { info = { kind: "note", text: "预演出错：" + e.message }; }
    paintSkillPv(unitById(actor.id) || actor, sk, info);
  }
  function scheduleSkillPv(sk, b) {
    stopSkillPv(false);
    if (touchUI() || !skillPvActor()) return;
    skHover.timer = realTimeout(() => {
      skHover.timer = 0;
      if (b.isConnected) showSkillPv(sk);   // 技能栏重画过就不算了
    }, SKILL_PV_DELAY);
  }
  /** 取消等着的预演；clear：画着的悬停预演也收起（回到默认说明） */
  function stopSkillPv(clear) {
    if (skHover.timer) { clearTimeout(skHover.timer); skHover.timer = 0; }
    if (clear && skHover.shown) clearPreview();
  }
  /** 触屏：不用选目标、也没有分步的技能第一下先预演（和悬停一样），再点同一个按钮才放出去。处理了（只预演）返回 true */
  function skillTapPv(sk, b) {
    const actor = skillPvActor();
    if (!actor || blockReason(actor, sk)) { G.skillTap = null; return false; }
    const key = skillPvStampNow() + "|" + actor.id + "|" + sk.id;
    if (G.skillTap && G.skillTap.key === key) { G.skillTap = null; return false; }   // 第二下：放出去
    let info = null;
    try { info = skillPvInfo(actor, sk); } catch (e) { info = null; }
    if (!info || info.kind !== "self") { G.skillTap = null; return false; }   // 要选目标 / 分步：照旧直接进入选择
    paintSkillPv(unitById(actor.id) || actor, sk, info);
    G.skillTap = { key, skillId: sk.id };
    b.classList.add("armed");
    setHint(`<b>${esc(sk.name)}</b>：预演在上面。再点一下放出去，点别的地方取消。`);
    return true;
  }
  function cancelSkillTap() {
    if (!G.skillTap) return;
    G.skillTap = null;
    document.querySelectorAll("#g-skills .sk.armed").forEach(x => { if (!(G.arm && G.arm.skillId === x.dataset.skill)) x.classList.remove("armed"); });
    stopSkillPv(true);
    if (!G.arm && G.depth === 0 && !$("g-hint").dataset.flash) setHint(defaultHint());
  }

  /* ---------- Helumica 被动「环境监测」：预测被聚焦敌人的下一步 ----------
   * 在沙盒里把这一回合往后演：结束玩家回合 → 排在它前面的敌人先行动 → 记下它这回合的每一步，然后还原。
   * 敌人做决定用固定随机数（EnemyAI.planFor），局势不变它就真的这么做；你移动、击杀、改变局势后它会重新判断。 */
  function scannerOn() {
    const h = findKit("helu", state.units);
    if (!h || h.dead || h.hidden) return false;
    return typeof passiveOn !== "function" || passiveOn(h);
  }
  function describeIntent(meta) {
    if (!meta) return "";
    const name = meta.skillName || "行动";
    const t = meta.targetId ? unitById(meta.targetId) : null;
    if (/^移动/.test(name)) return name;
    return t ? `用「${name}」打 ${t.name}` : `「${name}」`;
  }
  /* ---------- 敌人回合的骰子都按种子掷：同样的局势掷出同样的结果，所以 Helumica 的预测是准的 ----------
   *   end:<回合>            玩家回合结束时的结算
   *   act:<回合>:<敌人>:<第几动>  敌人这一动（不经格挡的伤害骰在这里掷）
   *   block:<这一击的编号>    协助格挡的 d100
   *   hit:<这一击的编号>      等格挡的那一击落下时的伤害骰 */
  function withSeed(key, fn) {
    if (typeof makeRng !== "function") return fn();
    const r = Math.random;
    Math.random = makeRng(key);
    try { return fn(); } finally { Math.random = r; }
  }
  function blockRollFor(job) {
    if (!job || job.seq == null || typeof makeRng !== "function") return 1 + Math.floor(Math.random() * 100);
    const n = (job.tried || []).length;   // 连续格挡：第二个人起换一颗骰子
    return 1 + Math.floor(makeRng("block:" + job.seq + (n ? ":" + n : ""))() * 100);
  }
  function predictTurn(id) {
    if (window.GMCommands?.isManual(unitById(id))) return ["由主持人操控，无法预测"];
    const key = `${G.version}|${state.turnNo}|${id}`;
    if (G.predict && G.predict.key === key) return G.predict.steps;
    const saved = saveState();
    const rnd = Math.random, st = window.setTimeout, outerTape = G.tape;
    G.sim = true; G.tape = [];
    state.history = [];
    window.setTimeout = () => 0;
    Math.random = makeRng("predict:" + key);
    const steps = [];
    // 这一段 tape 里打在我方身上的伤害：{ 名字: 伤害 }
    const dmgOnPlayers = (from) => {
      const out = new Map();
      G.tape.slice(from).forEach(e => {
        if (e.type !== "pop" || e.kind !== "dmg") return;
        const u = unitById(e.unitId);
        if (!u || !u.isPlayer) return;
        out.set(u.name, (out.get(u.name) || 0) + Math.floor(Number(e.value) || 0));
      });
      return out;
    };
    try {
      const endKey = `end:${state.turnNo}`;
      withSeed(endKey, () => endPlayerTurn());
      // 落下等格挡的攻击（按「没人格挡」算），focus 时顺便记下格挡骰、谁能挡住、会挨多少
      const drain = (detail) => {
        for (let g = 0; g < 20 && state.blockQueue && state.blockQueue.length; g++) {
          const job = state.blockQueue[0];
          const attacker = blockJobAttacker(job), target = unitById(job.targetId);
          let info = null;
          if (detail && attacker && target && job.attackerId === id) {
            const roll = blockRollFor(job);
            const helpers = eligibleBlockers(target, job).map(h => {
              const chance = finalBlockChance(h, attacker, target);
              const iai = h.kit === "hiaki" && h.resources && h.resources.stance === "iai";
              return `${h.name} ${iai ? "居合必挡" : chance + "%"} ${iai || roll <= chance ? "能挡住" : "挡不住"}`;
            });
            info = { target: target.name, roll, helpers };
          }
          const from = G.tape.length;
          withSeed("hit:" + job.seq, () => finishBlock(null));
          if (info) detail.push(Object.assign(info, { dmg: dmgOnPlayers(from).get(info.target) || 0 }));
        }
        state.assistQueue = []; state.koltSwapQueue = []; state.heluScanQueue = []; state.longgeSafetyQueue = [];
      };
      drain(null);
      for (const uid of EnemyAI.actingOrder()) {
        if (window.OnlineGame?.isHost() && GMCommands.isManual(unitById(uid))) continue;
        for (let n = 0; n < 5; n++) {
          const u = unitById(uid);
          if (!u || !unitAlive(u) || u.stunned || (u.ap || 0) <= 0) {
            if (uid === id && n === 0) steps.push(u && u.stunned ? "失衡中，这回合动不了" : "这回合不会行动");
            break;
          }
          const plan = EnemyAI.planFor(u, n);
          if (!plan) { if (uid === id && n === 0) steps.push("这回合不会行动"); break; }
          const sig = `${u.ap}|${u.bonus}|${u.zone}`;
          const from = G.tape.length;
          let failed = false;
          try { withSeed(`act:${state.turnNo}:${uid}:${n}`, plan.thunk); } catch (e) { failed = true; }
          const direct = dmgOnPlayers(from);       // 不经格挡、直接落下的伤害（范围攻击等）
          const blocked = [];
          drain(uid === id ? blocked : null);
          if (uid === id) {
            const parts = [];
            direct.forEach((v, name) => { if (v > 0) parts.push(`${name} 预计受到 ${v} 伤害（无法格挡）`); });
            blocked.forEach(b => {
              parts.push(`${b.target} 预计受到 ${b.dmg} 伤害；格挡骰 ${b.roll}` +
                (b.helpers.length ? `：${b.helpers.join("、")}` : "（同区没人能替他格挡）"));
            });
            steps.push(describeIntent(plan.meta) + (parts.length ? " —— " + parts.join("；") : ""));
          }
          if (failed) break;
          const v = unitById(uid);
          if (!v || `${v.ap}|${v.bonus}|${v.zone}` === sig) break;
        }
        if (uid === id) break;
      }
    } catch (e) {
      steps.push("（预测失败）");
    } finally {
      Math.random = rnd;
      window.setTimeout = st;
      G.sim = false;
      G.tape = outerTape;
      restoreState(saved);
    }
    G.predict = { key, steps };
    return steps;
  }
  function intentHtml(id) {
    const u = unitById(id);
    if (!u || u.isPlayer || !(u.focuses && u.focuses.length)) return "";
    if (!state.combatStarted || state.combatPhase !== "player" || G.depth > 0 || !scannerOn()) return "";
    const steps = predictTurn(id);
    if (!steps.length) return "";
    const stepHtml = (t, i) => {
      const [what, rest] = String(t).split(" —— ");
      const subs = rest ? rest.split("；").map(x => `<div class="intent-sub">${esc(x)}</div>`).join("") : "";
      return `<div class="intent-step">${steps.length > 1 ? (i + 1) + ". " : ""}${esc(what)}${subs}</div>`;
    };
    return `<div class="ln intent"><b>环境监测 · 预测</b>${steps.map(stepHtml).join("")}</div>
      <div class="ln intent-note">局势不变它就会这么做，伤害和格挡骰也会是这个数（伤害按没人格挡算；格挡成功则目标不受伤）。你移动、击杀或改变局势后它会重新判断。</div>`;
  }

  function unitInfoBox(id) {
    const s = G.view.get(id);
    if (!s) return;
    const layers = s.layers.map(l => `${LAYER[l.type] || l.type} ${l.cur}/${l.max}`).reverse().join("　");
    $("g-pvbox").classList.add("live");
    $("g-pvbox").innerHTML = `<h4>${esc(s.name)} · Lv${s.level}</h4>
      <div class="ln key">${esc(layers)}</div>
      <div class="ln">架势 ${s.def}/${s.defMax} · ATK ${s.atk} · ${s.zone} 区</div>
      <div class="ln">${esc(s.status || "无状态")}</div>
      ${s.res ? `<div class="ln">${esc(s.res)}</div>` : ""}
      ${intentHtml(id)}
      <div class="ln">血条最右边是最外层，先被打掉。</div>`;
  }

  function gapNodes() {
    return [...document.querySelectorAll("#g-field .g-gap[data-key]")];
  }
  function markTargets(ids) {
    cards.forEach((c, id) => {
      const ok = ids.has(id);
      c.wrap.classList.toggle("is-targetable", ok);
      c.wrap.classList.toggle("is-dim", !ok && id !== G.actorId);
    });
    gapNodes().forEach(n => n.classList.toggle("is-targetable", ids.has("gap:" + n.dataset.key)));
  }
  function unmarkTargets() {
    cards.forEach(c => c.wrap.classList.remove("is-targetable", "is-dim", "is-hover"));
    gapNodes().forEach(n => n.classList.remove("is-targetable", "is-hover"));
    document.querySelectorAll(".g-zone").forEach(z => z.classList.remove("is-move-target", "is-move-hover"));
  }

  function disarm() {
    const a = G.arm;
    G.arm = null;
    if (a && a.reject) a.reject();
    unmarkTargets();
    clearPreview();
    refreshHud();
  }

  /** 进入目标选择。candidates: [{id, preview}]；返回被点中的 id，取消返回 null */
  /**
   * 在战场上点选一个目标。buttons：额外的按钮（例：「不选」「不切换」「放弃扫描」），
   * 显示在提示栏旁边，点了返回 { button: value }；点目标返回目标 id；右键 / Esc 取消返回 null。
   */
  function pickUnit(candidates, labelFn, buttons) {
    return new Promise(resolve => {
      const map = new Map(candidates.map(c => [c.id, c]));
      G.arm = Object.assign(G.arm || {}, {
        mode: "unit",
        tapId: null,
        map,
        labelFn,
        resolve: (id) => { unmarkTargets(); clearPreview(); showPickBar(null); G.arm.mode = null; resolve(id); },
        reject: () => { unmarkTargets(); showPickBar(null); resolve(null); }
      });
      markTargets(new Set([...map.keys()].filter(id => !map.get(id).invalid)));
      showPickBar(buttons);
      refreshHud();
    });
  }
  /** 结算队列里（换刀头、协助攻击附带的扫描）在战场上点选：选完之前别的操作都锁住，和弹窗一样 */
  async function queueFieldPick(hint, cands, labelFn, buttons) {
    setHint(hint);
    choiceResolve = { field: true, cancel: () => disarm() };
    try { return await pickUnit(cands, labelFn, buttons); }
    finally { choiceResolve = null; G.arm = null; unmarkTargets(); clearPreview(); setHint(defaultHint()); refreshHud(); }
  }
  /** 选目标时的额外按钮条（在提示栏下面） */
  function showPickBar(buttons) {
    let bar = $("g-pick-bar");
    if (!buttons || !buttons.length) { if (bar) { bar.classList.remove("show"); bar.innerHTML = ""; } return; }
    if (!bar) {
      bar = el("div", "g-pick-bar");
      bar.id = "g-pick-bar";
      const row = document.querySelector(".g-hud .hud-row");   // 放在技能栏上面，显眼
      if (row && row.parentNode) row.parentNode.insertBefore(bar, row); else document.body.appendChild(bar);
    }
    bar.innerHTML = "";
    buttons.forEach(b => {
      const x = el("button", "g-btn", `${esc(b.label)}${b.sub ? `<small>${esc(b.sub)}</small>` : ""}`);
      x.onclick = (e) => { e.stopPropagation(); if (G.arm && G.arm.mode === "unit") G.arm.resolve({ button: b.value }); };
      bar.appendChild(x);
    });
    bar.classList.add("show");
  }
  /** 这些 id 是不是都在战场上有卡片（单位、配置物、危墙 / 桥梁），能直接点 */
  function allOnField(ids) {
    return ids.length > 0 && ids.every(id => cards.has(id) ||
      (String(id).indexOf("gap:") === 0 && !!document.querySelector(`#g-field .g-gap[data-key="${String(id).slice(4)}"]`)));
  }

  function pickZone(zones, previewFn) {
    return new Promise(resolve => {
      G.arm = Object.assign(G.arm || {}, {
        mode: "zone",
        tapZone: null,
        zones: new Set(zones),
        previewFn,
        resolve: (z) => { unmarkTargets(); clearPreview(); G.arm.mode = null; resolve(z); },
        reject: () => { unmarkTargets(); resolve(null); }
      });
      document.querySelectorAll(".g-zone").forEach(z => z.classList.toggle("is-move-target", zones.includes(Number(z.dataset.num))));
      refreshHud();
    });
  }

  /** 悬停说明（unit-tip.js）：图鉴里的简单描述 + 身上每个效果的文字说明 */
  function unitTipHtml(id) {
    if (!window.UnitTip) return "";
    if (String(id).indexOf("gap:") === 0) {
      const key = String(id).slice(4), g = (state.gaps || {})[key];
      if (!g) return "";
      const hp = (g.type === "bridge" || g.type === "wall") ? `耐久 ${g.hp || 0}` : g.type === "door" ? (g.open ? "开着" : "关着") : "";
      return UnitTip.html({ kind: "gap", gapType: g.type }, [], { name: gapLabel(g.type) + "（" + key.replace("-", "–") + " 区之间）", sub: hp });
    }
    const s = G.view.get(id);
    if (!s) return "";
    if (s.isProp) {
      const p = (state.props || []).find(x => "prop:" + x.id === id);
      const hp = s.isDevice ? "" : `耐久 ${sumCur(s)}/${sumMax(s)}`;
      return UnitTip.html({ kind: "prop", propKind: p && p.kind }, [], { name: s.name, sub: [hp, s.res, s.zone + " 区"].filter(Boolean).join(" · ") });
    }
    const u = unitById(id);
    const owner = u && u.weaponOf ? state.units.find(x => x.kit === u.weaponOf && !isWeaponUnit(x)) : null;
    const kind = s.isPlayer ? (s.escort ? "escort" : s.weaponUnit ? "weapon" : "hero") : "enemy";
    const tokens = [];
    if (s.dead) tokens.push(s.isPlayer ? "倒下" : "");
    if (s.dying && !s.dead) tokens.push("濒死");
    if (s.upOnShp) tokens.push("起身");
    if (s.stunned && !s.dead) tokens.push("失衡");
    if (s.flying) tokens.push("飞行");
    (s.status ? s.status.split(" · ") : []).forEach(t => { if (t && t !== "无状态") tokens.push(t); });
    (s.hung || []).forEach(n => tokens.push(n));
    return UnitTip.html({ kind, kit: s.kit, ownerName: owner && owner.name, escort: s.escort }, tokens.filter(Boolean), { name: s.name, sub: `Lv${s.level} · ${s.zone} 区${s.iv && typeof ivText === "function" ? " · 个体值 " + ivText(s) : ""}` });
  }
  function onCardHover(id, on) {
    // 悬停说明：任何时候都能看（选目标时也一样），离开就收起；触屏没有悬停
    if (window.UnitTip && !touchUI()) {
      const anchor = cards.get(id) ? cards.get(id).wrap : String(id).indexOf("gap:") === 0 ? document.querySelector(`#g-field .g-gap[data-key="${String(id).slice(4)}"]`) : null;
      if (on && anchor) { const h = unitTipHtml(id); if (h) UnitTip.show(anchor, h); else UnitTip.hide(); }
      else UnitTip.hide();
    }
    const gapNode = String(id).indexOf("gap:") === 0 ? document.querySelector(`#g-field .g-gap[data-key="${String(id).slice(4)}"]`) : null;
    const c = cards.get(id) || (gapNode ? { wrap: gapNode } : null);
    if (!c) return;
    c.wrap.classList.toggle("is-hover", on && !!(G.arm && G.arm.mode === "unit" && G.arm.map.has(id)));
    const fieldPick = !!(choiceResolve && choiceResolve.field);   // 结算队列里在战场上点选（那时动作还没结束，G.depth > 0）
    if ((G.depth > 0 && !fieldPick) || (choiceResolve && !fieldPick)) return;
    if (G.arm && G.arm.mode === "unit") {
      if (!on) { clearPreview(); return; }
      const cand = G.arm.map.get(id);
      if (!cand) return;
      if (!cand.preview && cand.thunk) cand.preview = previewOf(cand.thunk);
      if (cand.preview) showPreview(cand.preview, G.arm.labelFn ? G.arm.labelFn(id) : "");
      return;
    }
    // 触屏点了一下技能、正在预演：模拟出来的鼠标进出别把预演盖掉（手指点别的地方才取消）
    if (G.skillTap && touchUI()) return;
    if (!G.arm) { if (on) unitInfoBox(id); else idleBox(); }
  }

  /** 触屏没有悬停：第一下点目标先预览，再点一下才出手 */
  function touchUI() { return !!(window.matchMedia && window.matchMedia("(hover: none)").matches); }
  /** 选区域时点中某个区（点区里的空白，或者点区里的单位 / 配置物卡片都算）。处理了返回 true */
  function pickZoneByClick(zone) {
    if (!(G.arm && G.arm.mode === "zone" && zone && G.arm.zones.has(Number(zone.dataset.num)))) return false;
    const zn = Number(zone.dataset.num);
    if (touchUI() && G.arm.tapZone !== zn) {
      // 触屏：第一下预览移动的结果，再点一下才确认
      document.querySelectorAll(".g-zone").forEach(z => z.classList.remove("is-move-hover"));
      zone.classList.add("is-move-hover");
      G.arm.tapZone = zn;
      showPreview(G.arm.previewFn(zn), `移动到 ${zn} 区`);
      flashHint(`${zn} 区：再点一下确认`);
      return true;
    }
    G.arm.resolve(zn);
    return true;
  }
  function onCardClick(id) {
    const fieldPick = !!(choiceResolve && choiceResolve.field);
    if (G.depth > 0 && !fieldPick) { G.skip = true; return; }
    if (choiceResolve && !fieldPick) return;
    // 选区域时点到了区里的单位 / 配置物：当成点这个区（区里站满人时也能选）
    if (G.arm && G.arm.mode === "zone") {
      const c = cards.get(id);
      const zoneEl = c && c.wrap ? c.wrap.closest(".g-zone") : null;
      if (zoneEl) pickZoneByClick(zoneEl);
      return;
    }
    if (G.arm && G.arm.mode === "unit") {
      const cand = G.arm.map.get(id);
      if (!cand) return;
      if (touchUI() && G.arm.tapId !== id && !cand.invalid) {
        if (G.arm.tapId) onCardHover(G.arm.tapId, false);
        G.arm.tapId = id;
        onCardHover(id, true);
        flashHint(`${targetName(id)}：再点一下确认`);
        return;
      }
      if (cand.preview && !cand.preview.meaningful && cand.invalidOk !== true) {
        flashHint(`无法对 ${targetName(id)} 使用：${cand.preview.reason}`);
        return;
      }
      G.arm.resolve(id);
      return;
    }
    const u = unitById(id);
    if (u && u.isPlayer && !G.arm) selectActor(id);
    else if (!G.arm && touchUI()) unitInfoBox(id);   // 触屏：点敌人看详情
  }

  function candidateUnits(actor, sk) {
    const hint = (sk.hint || "") + " " + (sk.name || "");
    const side = (typeof SKILL_TARGET_SIDE !== "undefined" && SKILL_TARGET_SIDE[sk.id]) ||
      (/任意单位|拉到|磁力/.test(hint) ? "any" : /友方|队友/.test(hint) ? "ally" : "enemy");
    let all = state.units.filter(u => unitAlive(u) && (u.id !== actor.id || side === "allySelf" || side === "anySelf"));
    if (side === "ally" || side === "allySelf") all = all.filter(u => u.isPlayer);
    else if (side === "enemy") all = all.filter(u => !u.isPlayer);
    // 写明了射程（engine.js · SKILL_RANGE）的技能以表为准，不从提示文字里猜
    const ov = typeof skillRangeFor === "function" ? skillRangeFor(actor, sk.id) : null;
    // 抵近射击（专长）：写着距离 1 的攻击也能打同区
    const pointBlank = typeof featHas === "function" && featHas(actor, "pointblank") && side === "enemy";
    const near = (u) => pointBlank && zoneDist(actor.zone, u.zone, state.zoneMode) === 0;
    if (ov) {
      all = all.filter(u => { const d = zoneDist(actor.zone, u.zone, state.zoneMode); return (d >= ov.min && d <= ov.max) || (ov.min === 1 && near(u)); });
    } else if (typeof inSkillRange === "function") {
      all = all.filter(u => inSkillRange(actor, u, hint, state.zoneMode) || near(u));
    }
    if (typeof skillTargetMoveOk === "function") all = all.filter(u => skillTargetMoveOk(actor, sk.id, u));
    if (side !== "ally" && side !== "allySelf" && side !== "anySelf") {
      const inRange = (fake) => ov
        ? (() => { const d = zoneDist(actor.zone, fake.zone, state.zoneMode); return d >= ov.min && d <= ov.max; })()
        : (typeof inSkillRange !== "function" || inSkillRange(actor, fake, hint, state.zoneMode));
      (state.props || []).forEach(p => {
        const fake = { id: "prop:" + p.id, name: p.name, zone: p.zone, isPlayer: p.faction !== "enemy" };
        if (inRange(fake)) all.push(fake);
      });
      // 危墙 / 不稳桥梁：夹在两区之间，两边任一区在射程里就能打
      snapGaps().filter(g => !g.hidden).forEach(g => {
        const hit = g.gapKey.split("-").map(Number)
          .map(z => ({ id: g.id, name: g.name, zone: z, isPlayer: false }))
          .find(inRange);
        if (hit) all.push(hit);
      });
    }
    return all;
  }

  /** 攻击演出由谁前冲：操控碎渣机炮（直接操控、环境扫描操控）时是机炮自己 */
  function animActor(actorId, skillId, picks) {
    const sid = String(skillId || "");
    if (sid.indexOf("use_scrap:") === 0) return "prop:" + sid.slice("use_scrap:".length);
    const act = String((picks && picks.act) || "");
    if (act.indexOf("prop:") === 0) {
      const p = (state.props || []).find(x => x.id === act.slice(5));
      if (p && p.kind === "scrap") return "prop:" + p.id;
    }
    return actorId;
  }
  async function armSkill(sk) {
    if (G.depth > 0 || G.ended || choiceResolve) return;
    const actor = unitById(G.actorId);
    if (!actor) return;
    const why = blockReason(actor, sk);
    if (why) { flashHint(`${sk.name}：${why}`); return; }
    disarm();
    const my = G.arm = { skillId: sk.id, actorId: actor.id };
    const stale = () => G.arm !== my;
    const cancel = () => { if (!stale()) disarm(); };
    refreshHud();
    const label = (id) => `${actor.name} · ${sk.name}${id ? " → " + targetName(id) : ""}`;

    if (sk.id === "__stand") {
      G.arm = null;
      return act(skillCommand(actor.id, "__stand"), { actorId: actor.id, skillName: "起身" });
    }
    if (sk.id === "__item") {
      // 维修工具包（没开封的 + 开封的）合成一项，按维修点数显示
      const items = (typeof bagList === "function" ? bagList(actor) : []).filter(x => x.combat && x.id !== "repair_kit_open");
      if (typeof repairPoints === "function" && repairPoints() > 0 && !items.some(x => x.id === "repair_kit")) items.push(Object.assign({ qty: 0 }, ITEM_CATALOG.repair_kit, { id: "repair_kit" }));
      if (!items.length) { cancel(); flashHint("背包里没有能在战斗中使用的道具。"); return; }
      setHint("<b>使用道具</b>：选择一件。");
      const itemId = await openChoice("使用道具", "背包", items.map(x => ({
        label: x.id === "repair_kit" ? `维修工具包 · ${repairPoints()} 点维修量` : x.name + " ×" + x.qty, sub: x.hint, value: x.id
      })), { label: "取消", value: null });
      if (stale()) return;
      if (!itemId) { cancel(); return; }
      const spec = ITEM_CATALOG[itemId];
      let targetId = null, dest = null;
      // 效果道具（items.js · EFFECT_ITEMS）：只列射程内、能用的目标 / 区域
      const unitsFor = () => (typeof itemTargetUnits === "function" ? itemTargetUnits(actor, itemId) : players());
      if (spec && (spec.target === "ally" || spec.target === "enemy")) {
        const list = unitsFor();
        if (!list.length) { cancel(); flashHint(`${spec.name}：距离 ${typeof EFFECT_ITEM_RANGE !== "undefined" ? EFFECT_ITEM_RANGE : 1} 以内没有能选的${spec.target === "ally" ? "友方" : "敌人"}。`); return; }
        const cands = list.map(u => ({ id: u.id, invalidOk: true }));
        setHint("<b>" + spec.name + "</b>：选择" + (spec.target === "ally" ? "友方" : "敌人") + "。");
        targetId = await pickUnit(cands, (id) => spec.name + " → " + targetName(id));
        if (stale()) return;
        if (!targetId) { cancel(); return; }
      } else if (spec && spec.target === "zone") {
        const zones = typeof itemTargetZones === "function" ? itemTargetZones(actor, itemId) : boardZoneIds();
        if (!zones.length) { cancel(); flashHint(`${spec.name}：附近没有能用的区域。`); return; }
        setHint("<b>" + spec.name + "</b>：选择区域。");
        dest = await pickZone(zones, () => null);
        if (stale()) return;
        if (dest == null) { cancel(); return; }
      } else if (spec && spec.target === "weapon") {
        // 维修工具包：选一把武器（武器名不会重名，用列表选）；倒地的武器人会被修好站起来
        const rows = repairTargets().filter(r => r.need > 0);
        if (!rows.length) { cancel(); flashHint("没有需要修的武器（耐久都是满的，也没有倒地的武器人）。"); return; }
        const pts = repairPoints();
        dest = await openChoice("维修工具包", `还有 ${pts} 点维修量：修几点耐久用几点；倒地的武器人修好后重新站起来（恢复最大生命的 25%）。`, rows.map(r => ({
          label: r.down ? `${r.name}（${r.owner.name}）· 倒地` : `${r.name}（${r.owner.name}）· 耐久 ${r.dur}/${r.max}`,
          sub: r.down ? `修好站起来：恢复 ${Math.min(r.need, pts)} 点生命，用 ${Math.min(r.need, pts)} 点` : `修到 ${Math.min(r.max, r.dur + pts)}，用 ${Math.min(r.need, pts)} 点`,
          value: r.kit
        })), { label: "取消", value: null });
        if (stale()) return;
        if (!dest) { cancel(); return; }
      }
      G.arm = null;
      return act(skillCommand(actor.id, "__item", targetId, { item: itemId, dest }), { actorId: actor.id, targetId, skillName: spec ? spec.name : "使用道具" });
    }
    if (sk.id === "__move") {
      const zones = otherZones(Number(actor.zone));
      const z = zones;
      setHint(`<b>移动</b>：点目标区域。离开有借机攻击敌人的区域时，闪白是会被追打的伤害。`);
      const dest = await pickZone(z, (zone) => previewOf(skillThunk(actor.id, "__move", null, { dest: zone })));
      if (stale()) return;
      if (dest == null) { cancel(); return; }
      G.arm = null;
      return act(skillCommand(actor.id, "__move", null, { dest }), { actorId: actor.id, skillName: `移动到 ${dest} 区` });
    }

    // 分步选择（计算器里的 skillFlowSteps）
    const picks = {};
    let lastUnitPick = null;
    for (let guard = 0; guard < 8; guard++) {
      let steps = [];
      // 预览会在沙盒里跑一遍技能再还原局面，手里的旧单位对象可能已被改过（例：逃离预览把人挪走了），每步都重新取
      const live = unitById(actor.id) || actor;
      try { steps = skillFlowSteps(sk.id, live, picks) || []; } catch (e) { steps = []; }
      const step = steps.find(s => picks[s.key] === undefined);
      if (!step) break;
      // 选了这一项以后还有没有下一步：要按选了之后的步骤算（猛扑选同区目标后才多出「带到哪一区」），
      // 否则预演缺着后面的选项，结算成「要再选」→ 判为无效，同区目标点不了
      const withPick = v => Object.assign({}, picks, { [step.key]: v });
      const isLastWith = v => {
        let next = [];
        try { next = skillFlowSteps(sk.id, live, withPick(v)) || []; } catch (e) { next = steps; }
        return next.every(s => withPick(v)[s.key] !== undefined);
      };
      let value = null;
      if (step.type === "zone") {
        setHint(`<b>${esc(sk.name)}</b>：${esc(step.label)}`);
        value = await pickZone(step.zones || [], (zone) => previewOf(skillThunk(actor.id, sk.id, lastUnitPick, Object.assign({}, picks, { [step.key]: zone }))));
      } else if (step.type === "unit" && allOnField((step.units || []).map(u => u.id))) {
        // 选单位一律在战场上点（同名敌人也分得清）；可不选的步骤多一个「不选」按钮
        setHint(`<b>${esc(sk.name)}</b>：${esc(step.label)}　<span style="color:var(--faint)">${touchUI() ? "点空白处取消" : "右键取消"}</span>`);
        const cands = (step.units || []).map(u => ({
          id: u.id,
          thunk: isLastWith(u.id) ? skillThunk(actor.id, sk.id, u.id, withPick(u.id)) : null
        }));
        const got = await pickUnit(cands, label, step.optional ? [{ label: "不选，继续", value: "skip" }] : null);
        if (stale()) return;
        if (got && typeof got === "object") value = "";   // 点了「不选」
        else { value = got; if (value == null) { cancel(); return; } lastUnitPick = value; }
        if (value === "") value = null;
      } else {
        const options = step.type === "unit"
          ? (step.units || []).map(u => ({ label: u.name, sub: u.zone ? `${u.zone} 区` : "", value: u.id }))
          : (step.options || []).map(o => ({ label: o.label, value: o.value }));
        value = await openChoice(`${sk.name}`, step.label, options, { label: step.optional ? "不选" : "取消", value: step.optional ? "" : null });
        if (stale()) return;
        if (value === "") value = null;
        else if (value == null) { cancel(); return; }
      }
      if (stale()) return;
      if (value == null && !step.optional) { cancel(); return; }
      picks[step.key] = value;
      if (step.type === "unit" && value) lastUnitPick = value;
    }

    // 是否需要单独选目标
    const probe = previewOf(skillThunk(actor.id, sk.id, lastUnitPick, picks));
    if (!probe.needsTarget) {
      G.arm = null;
      return act(skillCommand(actor.id, sk.id, lastUnitPick, picks), { actorId: animActor(actor.id, sk.id, picks), targetId: lastUnitPick, skillName: sk.name });
    }
    setHint(`<b>${esc(sk.name)}</b>：${esc(sk.hint || "选择目标")}　<span style="color:var(--faint)">${touchUI() ? "点目标预览，再点确认；点空白处取消" : "右键取消"}</span>`);
    const cands = candidateUnits(unitById(actor.id) || actor, sk).map(u => {
      const thunk = skillThunk(actor.id, sk.id, u.id, picks);
      const preview = previewOf(thunk);
      return { id: u.id, thunk, preview, invalid: !preview.meaningful };
    });
    if (!cands.some(c => !c.invalid)) {
      const r = cands[0] && cands[0].preview ? cands[0].preview.reason : "没有可选目标";
      cancel();
      flashHint(`${sk.name}：${r}`);
      return;
    }
    const target = await pickUnit(cands, label);
    if (stale()) return;
    if (!target) { cancel(); return; }
    G.arm = null;
    return act(skillCommand(actor.id, sk.id, target, picks), { actorId: animActor(actor.id, sk.id, picks), targetId: target, skillName: sk.name });
  }

  /* ================= 9. 敌人 AI ================= */
  // 决策逻辑在 ai.js（与无界面模拟共用），这里只负责按顺序演出
  const aiPlan = EnemyAI.plan;
  const aiPickAssister = EnemyAI.pickAssister;

  async function enemyPhase() {
    if (window.OnlineGame?.isHost()) GMCommands.beginEnemyRound(state.turnNo);
    const order = EnemyAI.actingOrder();
    for (const id of order) {
      if (window.OnlineGame?.isHost()) await OnlineGame.flushGM();
      if (window.OnlineGame?.isHost() && (!GMCommands.enemyMayAct(unitById(id)) || GMCommands.isManual(unitById(id)))) continue;
      for (let n = 0; n < 5; n++) {
        if (window.OnlineGame?.isHost() && n < (G.onlineEnemyCursor?.[id] || 0)) continue;
        if (window.OnlineGame?.isHost() && (GMCommands.isManual(unitById(id)) || !GMCommands.enemyMayAct(unitById(id)))) break;
        if (window.OnlineGame?.isHost()) await OnlineGame.waitUntilReady();
        const u = unitById(id);
        if (!u || !unitAlive(u) || u.stunned || (u.ap || 0) <= 0) break;
        const sig = `${u.ap}|${u.bonus}|${u.zone}`;
        const actKey = `act:${state.turnNo}:${id}:${n}`;
        const tape = await perform({ type: "battle.enemyAction", actor: id, step: n, seed: actKey }, {}, true);
        if (tape === null) break;
        await resolveQueues();
        if (window.OnlineGame?.isHost()) await OnlineGame.flushGM();
        if (checkEnd()) return true;
        const v = unitById(id);
        if (!v || `${v.ap}|${v.bonus}|${v.zone}` === sig) break;
        await wait(450);
      }
      await wait(450);
    }
    if (window.OnlineGame?.isHost() && !G.ended) { await OnlineGame.manualEnemyPhase(); if (checkEnd()) return true; if (OnlineGame.takeAIResume()) return enemyPhase(); }
    return false;
  }

  /* ================= 10. 回合流程 ================= */
  const SPACE_SAFE = "button, a[href], summary, [role=button], [role=tab], [role=option], [contenteditable], [tabindex]:not([tabindex='-1'])";
  // 鼠标 / 触屏点过的按钮会留着焦点：记下来，空格不当成「按下它」（:focus-visible 在按键那一刻也会变真，用不了）；按 Tab 换焦点后才算键盘焦点
  let pointerFocusEl = null;
  if (typeof document !== "undefined") {
    document.addEventListener("pointerdown", e => { pointerFocusEl = e.target && e.target.closest ? e.target.closest(SPACE_SAFE) : null; }, true);
    document.addEventListener("keydown", e => { if (e.key === "Tab") pointerFocusEl = null; }, true);
  }
  const kbdFocus = el => { const hit = el && el.closest ? el.closest(SPACE_SAFE) : null; return !!hit && hit !== pointerFocusEl; };
  /** 空格：热座 / 联机里结束的是当前这个单位的行动；它还有行动点或附赠没用时先问一句 */
  async function spaceStartOrEnd() {
    if (state.combatStarted && hotseat() && !G.depth && !G.ended && !choiceResolve) {
      const cur = unitById(HotseatGame.currentUnit());
      if (cur && ((cur.ap || 0) > 0 || (cur.bonus || 0) > 0)) {
        const ans = await openChoice("结束行动", `${cur.name} 还有 ${cur.ap || 0} 点行动、${cur.bonus || 0} 次附赠没用，确定结束行动吗？`, [
          { label: "确定结束", value: "yes" },
          { label: "继续行动", value: "no" }
        ]);
        if (ans !== "yes") return;
      }
    }
    return clickStartOrEnd();
  }
  async function clickStartOrEnd() {
    if (G.depth > 0 || G.ended || choiceResolve) return;
    if (!state.combatStarted) {
      if (window.HotseatGame && !HotseatGame.canStart()) return;
      await askOpeningChoices();
      pushUndo("开始战斗");
      if (hotseat()) HotseatGame.startCombat();
      else dispatch({ type: "startCombat" });
      if (window.Sfx) Sfx.ui("turn");   // 开战：第一回合开始
      if (hotseat()) await resolveQueues();
      if (state.ambush) {
        // 遭遇战：我方第一回合被跳过，直接进敌人回合
        phaseCard("遭遇战 · 被偷袭", "enemy");
        refreshAll();
        await wait(900);
        endTurn(true);
        return;
      }
      phaseCard("战斗开始", "player");
      if (hotseat()) HotseatGame.beginRound();
      autoSelect(true);
      refreshAll();
      return;
    }
    endTurn();
  }

  /* ---------- 撤退（规则见 app.js · performRetreat，按主持人手册第七章） ---------- */
  function canRetreat() {
    if (hotseat() && (!HotseatGame.isHost() || HotseatGame.hasAsk())) return false;
    if (!state.combatStarted || G.ended || G.depth > 0) return false;
    if (state.combatPhase !== "player") return false;
    return !(G.rogue && G.rogue.spec && G.rogue.spec.retreat === false);
  }
  async function askRetreat() {
    if (!canRetreat() || choiceResolve) return;
    const pv = retreatPreview();
    const text = pv.lines.join("；") + "。";
    let guardId = null;
    if (pv.rule.rearguard) {
      const guards = retreatRearguards();
      const pickG = await openChoice("撤退 · 谁来断后", text + " 选一名还站着的角色断后。",
        guards.map(u => ({ label: u.name, sub: `血量 ${sumHp(u)}`, value: u.id })),
        { label: "不撤了", value: null });
      if (!pickG) return;
      guardId = pickG;
    } else {
      const ok = await openChoice("撤退", text, [{ label: "撤退", value: "yes" }], { label: "不撤了", value: null });
      if (ok !== "yes") return;
    }
    if (hotseat() && !canRetreat()) return;
    const success = await act({ type: "retreat", rearguard: guardId });
    if (!G.ended && (!hotseat() || success && state.retreated)) finish(false, "retreat");
  }
  const sumHp = (u) => (u.layers || []).reduce((a, l) => a + Math.max(0, Number(l.current) || 0), 0);

  /** 开战前的选择。柯尔特可以自行决定初始刀头（不算「更换刀头」，不触发追击伤害）。 */
  async function askOpeningChoices() {
    // 双相冲动+：诺拉自选初始状态
    const nora = typeof findKit === "function" ? findKit("nora", state.units) : null;
    if (nora && nora.isPlayer && typeof passivePlus === "function" && passivePlus(nora, 2)) {
      const opts = [{ label: "温和", value: "gentle" }, { label: "残忍", value: "cruel" }];
      const pick = hotseat() ? await HotseatGame.ownedChoice(nora, "诺拉 · 初始状态", opts)
        : await openChoice("诺拉 · 初始状态", "双相冲动+：开局时可以自行选择初始状态，回合开始时不会再随机改变。", opts, { label: "保持当前", value: (nora.resources || {}).mood || "gentle" });
      systemCommand({ type: "openingChoice", actor: nora.id, mood: pick === "cruel" ? "cruel" : "gentle" });
      addLogPhase(`诺拉 初始状态：${pick === "cruel" ? "残忍" : "温和"}`);
    }
    const k = typeof findKit === "function" ? findKit("kolt", state.units) : null;
    if (!k || !k.isPlayer) return;
    const pick = hotseat() ? await HotseatGame.ownedChoice(k, "柯尔特 · 初始刀头", [
      { label: "电钻（电 · 近距离）", value: "drill" }, { label: "酸液炮（酸 · 远距离）", value: "acid" }
    ]) : await openChoice(
      "柯尔特 · 初始刀头",
      "进入战斗时可以自行决定装哪个刀头。这不算「更换刀头」，不会触发追击伤害。",
      [
        { label: "电钻（电 · 近距离）", value: "drill" },
        { label: "酸液炮（酸 · 远距离）", value: "acid" }
      ],
      { label: "保持电钻", value: "drill" }
    );
    systemCommand({ type: "openingChoice", actor: k.id, bit: pick === "acid" ? "acid" : "drill" });
    addLogPhase(`柯尔特 初始刀头：${k.resources.bit === "acid" ? "酸液炮（远距离）" : "电钻（近距离）"}`);
  }

  async function endTurn(ambush = false) {
    if (G.depth > 0 || G.ended || !state.combatStarted || state.combatPhase !== "player" || choiceResolve) return;
    if (hotseat() && !ambush) {
      const ack = HotseatGame.submit({ type: "endTurn" });
      if (!ack.ok) { flashHint(ack.error); return; }
      if (!ack.result.roundDone) { autoSelect(true); refreshAll(); return; }
    }
    const leftover = !hotseat() && players().some(u => !u.dying && (u.ap || 0) > 0);
    if (leftover && G.apWarnTurn !== state.turnNo) {
      G.apWarnTurn = state.turnNo;
      const ans = await openChoice("结束回合", "你还有没有使用的行动点，确定结束回合吗？", [
        { label: "确定结束", value: "yes" },
        { label: "继续行动", value: "no" }
      ], { label: "取消", value: "no" });
      if (ans !== "yes") return;
    }
    disarm();
    pushUndo(`结束第 ${state.turnNo} 回合`);
    G.depth++;
    syncBusy();
    try {
      const endKey = `end:${state.turnNo}`;
      await perform({ type: hotseat() ? "battle.endPlayerTurn" : "endTurn", seed: endKey }, { phase: "玩家回合结束 · 敌人回合开始" }, hotseat());
      await resolveQueues();   // 敌人回合开始时落下的死刑：每一段先问协助格挡
      if (checkEnd()) return;
      refreshTop();
      phaseCard("敌人回合", "enemy");
      await wait(750);
      const over = await enemyPhase();
      if (!over && !G.ended) {
        await wait(250);
        await perform({ type: "battle.endEnemyTurn" }, { skillName: "", phase: "敌人回合结束 · 玩家回合开始" }, true);
        if (window.Sfx) Sfx.ui("turn");   // 我方回合开始
        await resolveQueues();
        if (!checkEnd()) {
          phaseCard(`第 ${state.turnNo} 回合`, "player");
          if (hotseat()) HotseatGame.beginRound();
          autoSelect(true);
        }
      }
    } finally {
      G.depth--;
      G.version++;
      syncBusy();
      refreshAll();
      checkEnd();
    }
  }

  function resumeHotseat() {
    if (!hotseat() || G.depth > 0 || G.ended || choiceResolve || HotseatGame.hasAsk()) return;
    if (state.combatStarted && state.combatPhase === "player" && HotseatGame.needsEnemy() && !checkEnd()) endTurn(true);
  }

  function checkEnd() {
    if (G.ended) return true;
    // 训练场：训练假人掉到一半就补满、被打死也拉回来，战斗不会结束；顺便记每回合的伤害
    if (window.Training && Training.active && !G.sim) Training.tick();
    if (!state.units || !state.units.length) return false;
    // 单人：主角倒地后还能用坚毅生命起身就不算输；起不来才算真正死亡
    const downNotes = dispatch({ type: "battle.checkSolo" });
    if (downNotes && downNotes.length) addLogPhase(downNotes.join("\n"));
    const heroes = state.units.filter(u => u.isPlayer && !u.hidden && !u.dead && !isWeaponUnit(u));
    // 多人模式（含热座 / 联机）：全员倒地即失败，和 README 一致；只有单人主角能靠起身撑着不算输
    const standing = heroes.filter(u => typeof heroStillFighting === "function" ? heroStillFighting(u) : !u.dying);
    if (!foes().length && (state.chain || (state.waves || []).length) && standing.length) {
      // 还有援军 / 下一场（chain.js）：不结束，换了区域就重画战场
      const r = systemCommand({ type: "battle.chain" });
      if (r && r.continued) {
        if (foes().length) { syncFieldDom(); setView(snapAll(), false); refreshAll(); phaseCard(`第 ${(state.chain ? state.chain.index : 0) + 1} 场`, "player"); }
        else refreshAll();
        return false;
      }
    }
    if (!foes().length) return finish(true);
    if (!standing.length) return finish(false);
    return false;
  }
  /** outcome：win / lose / retreat */
  function finish(win, outcome) {
    G.ended = true;
    let finishRoll = 0;   // 结束加分动画要多久：结算面板等它播完
    G.lastOutcome = outcome || (win ? "win" : "lose");
    disarm();
    refreshTop();
    const box = $("g-result");
    const retreated = G.lastOutcome === "retreat";
    box.querySelector("h2").textContent = retreated ? "撤退" : win ? "胜利" : state.solo ? "阵亡" : "全员倒地";
    box.querySelector("h2").className = win ? "win" : "lose";
    // 战斗评分：胜利时先算速杀（1 / 2 / 3 回合内 ×2 / ×1.5 / ×1.2）和无伤（+100，倍率 +0.5，与速杀加算），再定评价
    const rewards = systemCommand({ type: "battle.finish", outcome: G.lastOutcome });
    if (rewards.finishBonus) {
      const fb = rewards.finishBonus;
      const what = [fb.speedMult > 1 ? `速杀（第 ${state.turnNo} 回合打完）×${fb.speedMult}` : "", fb.flawless ? `无伤 +${SCORE_FLAWLESS.points}、×${1 + SCORE_FLAWLESS.mult}` : "", fb.ambush ? `遭遇战 ×${SCORE_AMBUSH_MULT}` : ""].filter(Boolean);
      if (fb.extra > 0) {
        addLogPhase(`${what.join(" + ")}：整场分数 ×${fb.mult}（+${fb.extra}）`);
        if (!G.instant && !G.sim) {
          paintRank();
          finishRoll = Math.round(Math.min(1600, 350 + fb.extra * 1.2));
        }
      }
    }
    // 按评价把这场的战斗经验乘上去（S ×2 / A ×1.5 / B ×1.2 / C ×1）
    const gr = rewards.grade;
    G.lastGrade = gr;
    let gradeLine = "";
    if (gr) {
      gradeLine = `评价 ${gr.grade}（${gr.score} 分）`;
      if (rewards.totalXpBonus > 0) gradeLine += `：战斗经验 ×${gr.xpMult}，每人额外 +${rewards.totalXpBonus}`;
      if (rewards.xpBonus > 0) {
        addLogPhase(`评价 ${gr.grade}：战斗经验 ×${gr.xpMult}，每人额外 +${rewards.xpBonus} 经验`);
      }
    }
    // 跑团：每场额外的「等级 × 20 / 人数」经验
    const trpgXpLine = (rewards.trpgXp || []).length ? "战斗奖励经验：" + rewards.trpgXp.map(x => `${x.name} +${x.xp}`).join("、") + "。" : "";
    if (trpgXpLine) addLogPhase(trpgXpLine);
    const ups = rewards.ups;
    // 跑团版的队伍档案只在战斗原型里结算；Roguelike 由单局流程自己记
    if (!G.rogue) {
      const durNotes = systemCommand({ type: "battle.afterBattle" });
      if (typeof G.onBattleFinished === "function") {
        const g = state.battleGains || { xp: 0, kuizhi: 0 };
        G.onBattleFinished({ outcome: G.lastOutcome, turn: state.turnNo, xp: g.xp, kuizhi: g.kuizhi, xpMult: state.xpMult || 1, ups, durNotes, stats: statRows(), grade: gr, drops: rewards.drops || null });
      }
      rememberCampaign();
      durNotes.forEach(t => addLogPhase(t));
    }
    const loot = `背包现有 ${Number(state.kuizhi) || 0} 奎支`;
    const lvline = trpgXpLine + (ups.length ? "升级：" + ups.join("、") + "。" : "") + (rewards.drops ? "战斗掉落：" + battleDropsText(rewards.drops) + "。" : "");
    box.querySelector("p").textContent = retreated
      ? `第 ${state.turnNo} 回合撤出战斗。${loot}。${lvline}`
      : win
        ? `第 ${state.turnNo} 回合结束。${gradeLine ? gradeLine + "。" : ""}${loot}。${lvline}`
        : `队伍倒地。${loot}。${lvline}`;
    // 结算面板上的大号评价字母
    let badge = box.querySelector(".grade-badge");
    if (!badge) { badge = el("div", "grade-badge"); box.insertBefore(badge, box.querySelector("p")); }
    badge.className = "grade-badge g-" + (gr ? gr.grade : "C") + (win ? "" : " dim");
    badge.innerHTML = gr ? `<b>${gr.grade}</b><span>${gr.score} 分</span>` : "";
    // 结算面板晚一点弹出，先让最后一击的大伤害数字和击倒演出放完
    const token = G.endToken = {};
    const showResult = () => {
      if (!G.ended || G.endToken !== token) return;
      if (rankRaf) return realTimeout(showResult, 250);   // 分数还在滚：等它滚完
      box.classList.add("show");
      $("g-reopen").classList.add("show");
    };
    realTimeout(showResult, G.instant ? 0 : Math.max(Math.round(BIG_POP_DUR * 1000) + 500, finishRoll ? finishRoll + 900 : 0));
    return true;
  }

  /** 结算后查看日志：收起结算面板，战场和右侧记录都留着，随时能再打开 */
  function reviewLog() {
    $("g-result").classList.remove("show");
    $("g-logs").scrollTop = $("g-logs").scrollHeight;
  }

  function encSummary(spec) {
    if (!spec) return "默认巷战";
    let names = [];
    try {
      const presets = enemyPresets();
      names = (spec.enemies || []).map(e => {
        const p = presets.find(x => x.id === e.preset);
        const n = Math.max(1, Number(e.count) || 1);
        return (p ? p.name : e.preset) + (n > 1 ? "×" + n : "");
      });
    } catch (err) {
      names = (spec.enemies || []).map(e => e.preset);
    }
    const extra = spec.extraToken ? " · 五代币" : "";
    const mix = spec.mixed ? " · 混战" : "";
    return (spec.name || "遭遇") + extra + mix + (names.length ? " · " + names.join("、") : "");
  }
  function startEncounter(spec) {
    if (!spec) return;
    dispatch({ type: "battle.panel", action: "selectEncounter", encounter: spec });
    if ($("g-enc-sheet")) $("g-enc-sheet").classList.remove("show");
    setupBattle(Number($("g-level").value) || 1, spec);
  }
  function renderEncSheet() {
    const box = $("g-enc-list");
    if (!box) return;
    box.innerHTML = "";
    const list = typeof ENCOUNTERS !== "undefined" ? ENCOUNTERS : [];
    if (!list.length) {
      box.innerHTML = '<p class="sheet-empty">没有固定遭遇表。run.js 未加载。</p>';
      return;
    }
    list.forEach(e => {
      const row = el("div", "sheet-slot");
      const sub = [e.region, e.tier, (e.zoneMode || 2) + "区"]
        .concat(e.weather ? [e.weather] : [])
        .concat([(e.enemies || []).map(x => x.preset + (x.count > 1 ? "×" + x.count : "")).join("、")])
        .join(" · ");
      row.innerHTML = `<div><b>${esc(e.name)}</b><div class="sub">${esc(sub)}</div></div>`;
      const go = el("button", "g-btn", "开战");
      go.onclick = () => startEncounter(e);
      row.appendChild(go);
      box.appendChild(row);
    });
    if ($("g-enc-preview")) $("g-enc-preview").textContent = G.lastEncounter ? ("上场：" + encSummary(G.lastEncounter)) : "";
  }

  /** 开一场战斗。encounter 可以是遭遇 id、遭遇数据，或省略（用原来的默认阵容）。 */
  /** 清空战斗画面（两种开战方式共用） */
  function resetBattleView() {
    G.ended = false;
    G.endToken = null;
    G.arm = null;
    $("g-result").classList.remove("show");
    $("g-reopen").classList.remove("show");
    cards.forEach(c => c.wrap.remove());
    cards.clear();
    G.view = new Map();
    $("g-logs").innerHTML = "";
  }

  /** Roguelike 单局里的战斗：顶栏只留战斗相关的按钮，结算后把胜负交回单局流程 */
  function setRogueMode(rogue) {
    G.rogue = rogue;
    document.body.classList.toggle("rogue-battle", !!rogue);
  }

  /**
   * 开一场 Roguelike 战斗。
   *   spec   Rogue.battleSpec 的结果：{ title, party, encounter, level, seed, before }
   *   onEnd  结算面板点「继续」后调用，参数是 win（true / false）
   * 战场由 BattleSim.setup 布置（与无界面模拟同一套），不读写跑团版的队伍档案。
   */
  function startRogueBattle(spec, onEnd) {
    setRogueMode({ onEnd, spec });
    resetBattleView();
    if ($("g-enc-name")) $("g-enc-name").textContent = spec.title || "战斗";
    const data = BattleCommands.battleSpecData(spec);
    dispatch({ type: "battle.setupRogue", spec: data }, { before: spec.before });
    G.undo = [];
    if ($("g-weather-sel")) $("g-weather-sel").value = state.weather;
    syncFieldDom();
    setView(snapAll(), false);
    const enc = spec.encounter || {};
    addLogPhase(`${spec.title || "战斗"} · ${enc.name || ""} · 敌人 Lv${spec.level} · 点「开始战斗」`);
    autoSelect(true);
    refreshAll();
    idleBox();
    battleIntro(spec.kind === "boss" || enc.tier === "boss" ? "boss" : spec.kind === "elite" || enc.tier === "elite" ? "elite" : "normal");
  }

  /**
   * 自定义布置的战斗（训练场等）：setup() 自己布置战场（BattleSim.setup + 加单位），这里只接画面。
   * 返回 setup() 的结果（可以带 notes：开场写进战斗记录的几行字）。
   */
  function startCustomBattle(title, setup) {
    setRogueMode(null);
    resetBattleView();
    if ($("g-enc-name")) $("g-enc-name").textContent = title || "战斗";
    const info = setup() || {};
    G.undo = [];
    G.encounter = null;
    if ($("g-weather-sel")) $("g-weather-sel").value = state.weather;
    syncFieldDom();
    setView(snapAll(), false);
    (info.notes || []).forEach(t => addLogPhase(t));
    autoSelect(true);
    refreshAll();
    idleBox();
    battleIntro("normal");
    return info;
  }

  /* ---------- 开战前的大字：战斗类型、几区制、天气、场地 ----------
   * 准备阶段（点「开始战斗」之前）弹出，逐行猛地放大落定。黑字、白色外框，内框颜色跟着天气 / 场地走，
   * 免得玩家漏看天气这种要紧的信息。点一下或几秒后自动消失。 */
  const INTRO_WEATHER = {
    none: ["常态", null], heat: ["酷暑", "#ff5a1f"], snow: ["雪天", "#8fdcff"], acid: ["酸雨", "#7ee04a"],
    thunder: ["雷鸣", "#ffd23f"], glow: ["微光", "#fff08a"], sand: ["沙暴", "#e2a24f"], phase: ["相位", "#c07bff"]
  };
  const INTRO_TIER = { boss: ["首领战斗", "#ff2e3f"], elite: ["精英战斗", "#ff9f1c"], normal: ["普通战斗", "#9aa6b2"] };
  const INTRO_FIELD = [
    ["fire", "火场", "#ff6a2b"], ["electric", "高压场地", "#ffd23f"], ["acid", "酸液地面", "#7ee04a"],
    ["ice", "冻土", "#8fdcff"], ["quicksand", "流沙", "#d9a35f"], ["coral", "沙珊瑚台地", "#e8957a"], ["energy", "能量场", "#fff08a"], ["harmonic", "干涉场地", "#c07bff"],
    ["heal", "治愈场地", "#6ee7a8"], ["highland", "高地", "#d8c3a5"], ["abyss", "深渊", "#7a6cff"],
    ["collapseOn", "塌陷区域", "#b08968"], ["isolate", "隔离", "#9aa6b2"]
  ];
  function battleIntro(tier) {
    if (typeof document === "undefined") return;
    // 战斗画面还没显示（例如打开网页时预先布置的原型战斗）：等切到战斗画面再弹
    if (typeof Screens !== "undefined" && Screens.is && !Screens.is("battle")) {
      G.pendingIntro = tier || "normal";
      return;
    }
    G.pendingIntro = null;
    const old = document.getElementById("g-intro");
    if (old) old.remove();
    const lines = [];
    const t = INTRO_TIER[tier] || INTRO_TIER.normal;
    lines.push({ text: t[0], color: t[1], big: true });
    const zm = Number(state.zoneMode) || 2;
    lines.push({ text: state.board ? (state.board.name || `${zm} 区棋盘`) : zm === 3 ? "三区制" : "两区制", color: "#6cc4ff" });
    const w = INTRO_WEATHER[state.weather] || [state.weather, "#ffffff"];
    if (state.weather && state.weather !== "none") lines.push({ text: "天气 · " + w[0], color: w[1] });
    if (state.weather === "sand") lines.push({ text: "风向 " + sandDirText(state.sandDir, zm), color: w[1] });
    for (let z = 1; z <= zm; z++) {
      const f = (state.fields || {})[z] || {};
      INTRO_FIELD.forEach(([k, name, color]) => {
        const on = k === "fire" ? (typeof fieldFireOn === "function" ? fieldFireOn(f) : !!f.fire) : !!f[k];
        if (on) lines.push({ text: `${z} 区 · ${name}`, color });
      });
    }
    // 配置物与区间地形
    (state.props || []).filter(p => p.kind !== "ironwall" && p.kind !== "dome").forEach(p => {
      const side = p.kind === "battery" || p.kind === "turret" ? (p.faction === "enemy" ? "（敌方）" : "（我方）") : "";
      lines.push({ text: `${p.zone} 区 · ${p.name}${side}`, color: p.faction === "enemy" && side ? "#ff6b6b" : "#e8c07a" });
    });
    Object.keys(state.gaps || {}).forEach(k => {
      const g = state.gaps[k];
      if (!g || g.type === "open" || (zm === 2 && k !== "1-2")) return;
      lines.push({ text: `${k.replace("-", "–")} 区之间 · ${typeof gapLabel === "function" ? gapLabel(g.type) : g.type}`, color: "#b8a88a" });
    });
    const box = el("div", "battle-intro" + (tier === "boss" ? " boss" : ""));
    box.id = "g-intro";
    box.innerHTML = `<div class="bi-flash" style="--c:${lines[0].color}"></div>` + lines.map((l, i) =>
      `<div class="bi-line${l.big ? " big" : ""}" style="--inner:${l.color};animation-delay:${0.08 + i * 0.28}s" data-text="${esc(l.text)}"><span>${esc(l.text)}</span></div>`).join("");
    const close = () => { box.classList.add("out"); realTimeout(() => box.remove(), 400); };
    box.addEventListener("click", close);
    document.body.appendChild(box);
    realTimeout(close, 2600 + lines.length * 280);
  }

  function setupBattle(level, encounter) {
    if (window.OnlineGame?.isHost() && state.combatStarted && !G.ended) {
      const error = new Error("战斗中不能重新布置遭遇，请先结束当前战斗"); error.code = "HOTSEAT_REJECT"; throw error;
    }
    setRogueMode(null);
    const online = window.OnlineGame?.isHost();
    const setupCommand = { type: "battle.setup", level, encounter: encounter || null, xpMult: Number(($("g-xp-mult") || {}).value) || 1 };
    // Keep the previous ended flag available to the online authority guard.
    // Ordinary single-player retains its original view/rule ordering.
    let result = online ? dispatch(setupCommand) : null;
    resetBattleView();
    if (!online) result = dispatch(setupCommand);
    const enc = result.encounter;
    const encTitle = enc && enc.name ? (enc.name + (typeof layoutLabel === "function" && enc.layout ? " · " + layoutLabel(enc.layout) : "")) : "外城区巷战";
    if ($("g-enc-name")) $("g-enc-name").textContent = "遭遇 " + encTitle;
    if ($("g-weather-sel")) $("g-weather-sel").value = state.weather;
    syncFieldDom();
    setView(snapAll(), false);
    result.notes.forEach(t => addLogPhase(t));
    addLogPhase(enc ? `${enc.name} · 敌人 Lv${level} · ${result.partySize} 人队 · 点「开始战斗」结算回合开始效果` : `外城区巷战 · 敌人 Lv${level} · 点「开始战斗」结算回合开始效果`);
    autoSelect(true);
    refreshAll();
    idleBox();
    battleIntro(enc ? enc.tier : "normal");
  }

  /* ================= 11. HUD / 记录 ================= */
  function selectActor(id) {
    if (hotseat() && HotseatGame.reason(unitById(id))) return;
    if (unitById(id) && unitById(id).escort) return;   // 护送对象玩家不能操作
    if (G.arm) disarm();
    G.actorId = id;
    refreshHud();
    idleBox();
  }

  function autoSelect(force) {
    if (hotseat()) { G.actorId = HotseatGame.currentUnit(); return; }
    const cur = unitById(G.actorId);
    const able = (u) => u && u.isPlayer && unitAlive(u) && !u.stunned && ((u.ap || 0) > 0 || (u.bonus || 0) > 0 || u.dying);
    if (!force && able(cur)) return;
    const list = players().filter(u => !isWeaponUnit(u)).concat(players().filter(u => isWeaponUnit(u)));
    const next = list.find(able) || list[0];
    if (next) G.actorId = next.id;
  }

  function refreshTop() {
    // 连续战斗第几场、援军倒计时（chain.js）
    // 浮在战场正上方（顶栏已经很挤）；战场重画时挂回去
    let ch = document.getElementById("g-chain");
    const field = $("g-field");
    if (!ch && field) { ch = document.createElement("div"); ch.id = "g-chain"; ch.className = "g-chain"; ch.hidden = true; }
    if (ch && field && ch.parentNode !== field) field.appendChild(ch);
    if (ch && typeof Chain !== "undefined") { const h = Chain.barHtml(Chain.status()); ch.hidden = !h; if (ch.innerHTML !== h) ch.innerHTML = h; }
    $("g-round").textContent = state.combatStarted ? `第 ${state.turnNo || 1} 回合` : "准备中";
    const ph = $("g-phasel");
    ph.textContent = !state.combatStarted ? "等待开始" : (state.combatPhase === "enemy" ? "敌人行动" : "我方行动");
    ph.classList.toggle("enemy", state.combatStarted && state.combatPhase === "enemy");
    const rt = $("g-retreat");
    if (rt) {
      const bossNoRetreat = !!(G.rogue && G.rogue.spec && G.rogue.spec.retreat === false);
      rt.hidden = bossNoRetreat;
      rt.disabled = !canRetreat();
    }
    paintUndo();
  }
  /* ---------- 战场数据 ---------- */
  // share：按「造成伤害」算的输出占比；blockText：协助格挡 成功 / 次数
  const STAT_COLS = [["dmg", "造成伤害"], ["share", "输出占比"], ["brk", "击破"], ["staggers", "打出失衡"], ["kills", "击杀"],
    ["assists", "协助攻击"], ["blocks", "协助格挡"], ["avoided", "格挡规避伤害"], ["reduced", "减伤减免"], ["taken", "承受伤害"], ["heal", "治疗 / 护盾"], ["score", "得分"]];
  /** 按队伍顺序排好的行：角色在前，武器人跟在主人后面 */
  function statRows() {
    const stats = state.battleStats || {};
    const blank = (u) => ({ name: u.name, kit: u.kit, weaponOf: u.weaponOf || null, dmg: 0, brk: 0, taken: 0, kills: 0, heal: 0, score: 0,
      assists: 0, blocks: 0, blockOk: 0, avoided: 0, staggers: 0, reduced: 0 });
    const units = (state.units || []).filter(u => u.isPlayer && !u._removed && !u.escort);   // 护送对象不列
    const heroes = units.filter(u => !isWeaponUnit(u));
    const rows = [];
    heroes.forEach(h => {
      rows.push(Object.assign({ id: h.id, sub: false, dead: !!h.dead }, stats[h.id] || blank(h)));
      units.filter(w => isWeaponUnit(w) && w.weaponOf === h.kit && stats[w.id]).forEach(w =>
        rows.push(Object.assign({ id: w.id, sub: true, dead: !!w.dead }, stats[w.id])));
    });
    const team = rows.reduce((a, r) => a + (Number(r.dmg) || 0), 0);
    rows.forEach(r => { r.share = team > 0 ? Math.round((Number(r.dmg) || 0) / team * 1000) / 10 : 0; });
    return rows;
  }
  /** 把武器人那一行并进主人那一行（数据加在一起，名字写「龙哥＋小朋友」）；输出占比重新算 */
  const STAT_SUM_KEYS = ["dmg", "brk", "staggers", "kills", "assists", "blocks", "blockOk", "avoided", "reduced", "taken", "heal", "score"];
  function mergeStatRows(rows) {
    const out = [];
    rows.forEach(r => {
      const host = r.sub ? out[out.length - 1] : null;
      if (!host) { out.push(Object.assign({}, r, { sub: false, parts: [r.name] })); return; }
      STAT_SUM_KEYS.forEach(k => { host[k] = (Number(host[k]) || 0) + (Number(r[k]) || 0); });
      host.parts.push(r.name);
    });
    out.forEach(r => { r.name = r.parts.join("＋"); });
    const team = out.reduce((a, r) => a + (Number(r.dmg) || 0), 0);
    out.forEach(r => { r.share = team > 0 ? Math.round((Number(r.dmg) || 0) / team * 1000) / 10 : 0; });
    return out;
  }
  G.statsMerge = false;
  const shownStatRows = () => G.statsMerge ? mergeStatRows(statRows()) : statRows();
  /** 表格单元格：输出占比带 %，协助格挡写「成功/次数」 */
  function statCell(r, k) {
    if (k === "share") return (Number(r.share) || 0).toFixed(1) + "%";
    if (k === "blocks") return `${Math.round(Number(r.blockOk) || 0)}/${Math.round(Number(r.blocks) || 0)}`;
    return String(Math.round(Number(r[k]) || 0));
  }
  function openStats() {
    const rows = shownStatRows();
    const mb = $("g-stats-merge");
    if (mb) { mb.textContent = G.statsMerge ? "分开武器人" : "合并武器人"; mb.classList.toggle("on", G.statsMerge); }
    const tot = {}; STAT_COLS.forEach(([k]) => { tot[k] = rows.reduce((a, r) => a + (Number(r[k]) || 0), 0); });
    tot.blockOk = rows.reduce((a, r) => a + (Number(r.blockOk) || 0), 0);
    tot.share = rows.length && tot.dmg > 0 ? 100 : 0;
    const best = {}; STAT_COLS.forEach(([k]) => { best[k] = Math.max(0, ...rows.map(r => Number(r[k]) || 0)); });
    $("g-stats-body").innerHTML = `<div class="stats-scroll"><table class="stats-table">
      <thead><tr><th>角色</th>${STAT_COLS.map(([, n]) => `<th>${n}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.sub ? "sub" : ""}${r.dead ? " dead" : ""}">
        <td>${r.sub ? "└ " : ""}${esc(r.name)}${r.sub ? "<small>武器人</small>" : ""}</td>
        ${STAT_COLS.map(([k]) => `<td class="${best[k] > 0 && r[k] === best[k] ? "top" : ""}">${statCell(r, k)}</td>`).join("")}</tr>`).join("")}</tbody>
      <tfoot><tr><td>合计</td>${STAT_COLS.map(([k]) => `<td>${statCell(tot, k)}</td>`).join("")}</tr></tfoot>
    </table></div>
    ${(() => {
      if (typeof battleGrade !== "function") return "";
      const gr = battleGrade();
      const parts = Object.keys(SCORE_PART_NAMES).filter(k => gr.parts[k]).map(k => k === "fatigue" ? `招式疲劳 −${gr.parts[k]}` : `${SCORE_PART_NAMES[k]} ${gr.parts[k]}`).join(" · ");
      return `<p class="stats-grade"><b class="g-${gr.grade}">评价 ${gr.grade}</b> ${gr.score} 分（按第 ${gr.act} 幕的分数线）${gr.next ? `，距 ${gr.next.grade} 还差 ${Math.max(0, gr.next.need - gr.score)} 分` : ""}<br>${parts || "还没有得分"}</p>`;
    })()}
    <p class="stats-turn">${state.combatStarted ? `第 ${state.turnNo || 1} 回合` : "还没开战"} · 分数线（第 ${typeof scoreAct === "function" ? scoreAct() : 1} 幕固定线 × ${SCORE_LINE_MIX.fixed} + 本场基准分 ${scorePar()} × 倍数 × ${SCORE_LINE_MIX.par}）：${gradeLines(typeof scoreAct === "function" ? scoreAct() : 1, scorePar()).filter(([, k]) => k > 0).map(([g, k, x]) => `${g} ≥ ${k}${x > 1 ? `（经验 ×${x}）` : ""}`).join("、")}，C 线以下为 D。基准分 = 每个出现过的敌人的血量 + 击杀分（击破、失衡不算进基准，是额外的漂亮操作）；固定线每往后一幕 +${SCORE_ACT_STEP}。速杀：${SCORE_SPEED.map(([n, m]) => `${n} 回合内 ×${m}`).join(" / ")}；无伤（我方没受任何伤害）：+${SCORE_FLAWLESS.points}、倍率 +${SCORE_FLAWLESS.mult}，和速杀倍率加算（胜利时整场分数再乘）${state.battleScore && state.battleScore.hurt ? "。本场已有人受伤" : ""}。得分里的击杀、团队分不一定能归到具体某人，所以个人得分加起来可能比总分少。队友给的行动点（例如结人的意式浓缩）打出来的那次行动，分数一半算给提供行动点的人。</p>`;
    $("g-stats-sheet").classList.add("show");
  }
  function statsText() {
    const rows = shownStatRows();
    const gr = typeof battleGrade === "function" ? battleGrade() : null;
    return [`战场数据（第 ${state.turnNo || 1} 回合）` + (gr ? ` · 评价 ${gr.grade} · ${gr.score} 分` : ""), "角色\t" + STAT_COLS.map(([, n]) => n).join("\t")]
      .concat(rows.map(r => (r.sub ? "  " + r.name + "（武器人）" : r.name) + "\t" + STAT_COLS.map(([k]) => statCell(r, k)).join("\t")))
      .join("\n");
  }
  G.statRows = statRows;
  G.mergeStatRows = mergeStatRows;
  G.statsText = statsText;

  function paintUndo() {
    const b = $("g-undo");
    if (!b) return;
    b.hidden = !!hotseat();
    b.disabled = !canUndo();
    b.textContent = G.undo.length > 1 ? `撤销（${G.undo.length}）` : "撤销";
    b.title = G.undo.length ? `撤销：${G.undo[G.undo.length - 1].label}（Ctrl+Z）` : "还没有可以撤销的操作（Ctrl+Z）";
  }

  function refreshHud() {
    refreshTop();
    // 队伍
    const party = $("g-party");
    party.innerHTML = "";
    const all = state.units.filter(u => u.isPlayer && !u.hidden && !u.fused && !u._removed && !u.escort);   // 护送对象玩家不能操作，不进队伍栏
    const heroes = all.filter(u => !isWeaponUnit(u));
    const ordered = [];
    heroes.forEach(h => {
      ordered.push(h);
      all.filter(w => isWeaponUnit(w) && (w.weaponOf === h.kit || (h.linkedKits || []).includes(w.kit))).forEach(w => { if (!ordered.includes(w)) ordered.push(w); });
    });
    all.forEach(u => { if (!ordered.includes(u)) ordered.push(u); });
    // 热座 / 联机：角色卡上写出是谁在操控（武器人跟着主人）
    const hsView = window.HotseatGame && HotseatGame.isActive && HotseatGame.isActive() ? HotseatGame.getView() : null;
    const operatorOf = (u) => {
      if (!hsView) return "";
      const hero = isWeaponUnit(u) ? (state.units.find(h => h.kit === u.weaponOf) || u) : u;
      const row = (hsView.heroes || []).find(h => h.id === hero.id);
      const p = row && (hsView.players || []).find(x => x.id === row.owner);
      return p ? p.name : "";
    };
    ordered.forEach((u, i) => {
      const s = snapUnit(u);
      const op = operatorOf(u);
      const b = el("button", "pc" + (isWeaponUnit(u) ? " weapon" : "") + (s.dead ? " downed" : "") +
        (u.id === G.actorId ? " on" : "") + ((s.ap + s.bonus === 0 && !s.dying) || s.stunned ? " off" : ""));
      const pct = sumMax(s) ? (sumCur(s) / sumMax(s)) * 100 : 0;
      let econ = "";
      for (let k = 0; k < Math.max(s.apMax, s.ap); k++) econ += `<i class="econ-ap${k < s.ap ? " on" : ""}"></i>`;
      for (let k = 0; k < Math.max(s.bonusMax, s.bonus); k++) econ += `<i class="econ-bonus${k < s.bonus ? " on" : ""}"></i>`;
      b.innerHTML = `<span class="n"><span>${esc(u.name)}</span><span class="k">${i < 9 ? "" : ""}</span></span>${op ? `<span class="pc-op" title="操控者">${esc(op)}</span>` : ""}
        <div class="mini"><i style="width:${pct}%"></i></div>
        <div class="u-econ">${s.dead ? '<span style="font-size:11px;color:#9d9081">倒下</span>' : econ}${!s.dead && s.stunned ? '<span style="font-size:11px;color:var(--gold)">失衡</span>' : ""}${!s.dead && s.dying ? '<span style="font-size:11px;color:var(--foe)">濒死</span>' : ""}</div>`;
      b.dataset.id = u.id;
      b.onclick = () => { if (G.depth === 0 && !choiceResolve && !u.dead) selectActor(u.id); };
      party.appendChild(b);
    });
    if (heroes.length) {
      const info = el("button", "pc pc-sheet");
      info.innerHTML = `<span class="n"><span>角色资料</span></span><div class="u-econ" style="font-size:11px;color:var(--muted)">技能 · 数值</div>`;
      info.title = "查看每个角色的数值、被动和技能说明";
      info.dataset.sheet = G.actorId && unitById(G.actorId) ? unitById(G.actorId).kit : heroes[0].kit;
      party.appendChild(info);
      const arm = el("button", "pc pc-sheet pc-armory");
      arm.innerHTML = `<span class="n"><span>武器工坊</span></span><div class="u-econ" style="font-size:11px;color:var(--muted)">补正 · 改装</div>`;
      arm.title = "查看武器补正、atk 明细、改装件和客制化";
      arm.dataset.armory = info.dataset.sheet;
      party.appendChild(arm);
    }
    cards.forEach((c, id) => c.wrap.classList.toggle("is-actor", id === G.actorId && state.combatPhase === "player"));

    // 技能（技能栏重画一次 = 新局面：悬停预演的缓存作废；悬停中、触屏点了一下的预演收起）
    hudEpoch++;
    G.skillTap = null;
    stopSkillPv(true);
    const box = $("g-skills");
    box.innerHTML = "";
    const actor = unitById(G.actorId);
    // 武器生物化（唤出武器人 / 收回为武器）单独放到结束回合左边的特殊按钮里，不占技能栏
    const allSkills = gameSkills(actor);
    // 武器人倒下后：这个按钮改成「取回武器」；倒下那把的唤出（本场不能再唤出）就不再占技能栏
    const retrieveSk = allSkills.find(sk => sk.id === "weapon_retrieve") || null;
    const summonSk = retrieveSk || allSkills.find(sk => isSummonSkill(sk.id)) || null;
    const list = allSkills.filter(sk => sk !== summonSk && !(retrieveSk && isSummonSkill(sk.id) && blockReason(actor, sk)));
    const wireSkill = (b, sk, why) => {
      b.onclick = () => {
        if (window.HeroSheet) HeroSheet.hideTip();
        stopSkillPv(false);
        if (touchUI() && skillTapPv(sk, b)) return;   // 触屏：不用选目标的技能第一下先预演，再点一下才放出去
        armSkill(sk);
      };
      b.onmouseenter = () => {
        if (window.HeroSheet) HeroSheet.tip(b, HeroSheet.skillTipHtml(sk, why));
        if (G.arm || G.depth > 0) return;
        setHint(`<b>${esc(sk.name)}</b>　${esc(sk.hint || "")}${why ? `　<span style="color:var(--foe)">${esc(why)}</span>` : ""}`);
        scheduleSkillPv(sk, b);
      };
      b.onmouseleave = () => {
        if (window.HeroSheet) HeroSheet.hideTip();
        if (G.skillTap && touchUI()) return;
        if (!G.arm) setHint("");
        stopSkillPv(true);
      };
    };
    const sb = $("g-summon");
    if (sb) {
      sb.hidden = !summonSk;
      sb.onclick = sb.onmouseenter = sb.onmouseleave = null;
      if (summonSk) {
        const why = blockReason(actor, summonSk);
        const back = /_return$/.test(summonSk.id) || summonSk.id === "weapon_retrieve";
        const ele = mainElementOf(actor);
        sb.className = "summonbtn" + (back ? " back" : "") + (G.arm && G.arm.skillId === summonSk.id ? " armed" : "");
        sb.style.setProperty("--el", ele ? `var(--${ele})` : "var(--sk-hazard, #f2c230)");
        sb.dataset.skill = summonSk.id;
        sb.disabled = !!why;
        const cost = [];
        if (summonSk.cost.ap) cost.push(`行动 ${summonSk.cost.ap}`);
        if (summonSk.cost.bonus) cost.push(`附赠 ${summonSk.cost.bonus}`);
        sb.innerHTML = `${summonIcon(back)}<span class="sm-nm">${esc(summonSk.name)}</span><small>${esc(cost.join(" · ") || "不耗行动")} · Q</small>`;
        sb.setAttribute("aria-label", `${summonSk.name}${why ? "：" + why : ""}`);
        wireSkill(sb, summonSk, why);
      }
    }
    G.summonShown = summonSk;
    list.forEach((sk, i) => {
      const why = blockReason(actor, sk);
      const b = el("button", "sk" + (G.arm && G.arm.skillId === sk.id ? " armed" : ""));
      b.dataset.skill = sk.id;
      const cost = [];
      if (sk.cost.ap) cost.push(`<span class="ap">行动 ${sk.cost.ap}</span>`);
      if (sk.cost.bonus) cost.push(`<span class="bn">附赠 ${sk.cost.bonus}</span>`);
      if (!cost.length) cost.push("不耗行动");
      b.innerHTML = `<span class="key">${i < 9 ? i + 1 : ""}</span><span class="nm">${esc(sk.name)}</span><span class="cost">${cost.join(" ")}</span>`;
      if (why) { b.disabled = true; b.setAttribute("aria-label", `${sk.name}：${why}`); }
      // 悬停：浮窗里显示完整技能说明（照角色卡，skill-text.js）；停一会儿就按当前数值预演
      wireSkill(b, sk, why);
      box.appendChild(b);
    });
    G.skillsShown = list;
    // 角色仪表：当前角色独有的资源和状态，画成图标（hud-icons.js），放在技能栏左边
    const gauge = $("g-gauge");
    if (gauge) {
      let gh = "";
      try { if (window.HudIcons && actor && actor.isPlayer && !isWeaponUnit(actor)) gh = HudIcons.gauge(HudIcons.gaugeState(actor, state.units)); } catch (e) { gh = ""; }
      if (gauge.dataset.html !== gh) { gauge.innerHTML = gh; gauge.dataset.html = gh; }
      gauge.setAttribute("aria-label", actor ? actor.name + "的角色仪表" : "角色仪表");
    }

    const et = $("g-endturn");
    if (!state.combatStarted) {
      et.disabled = G.depth > 0 || G.ended;
      et.innerHTML = "开始战斗<small>空格</small>";
    } else {
      et.disabled = G.depth > 0 || G.ended || state.combatPhase !== "player";
      et.innerHTML = "结束回合<small>空格</small>";
    }
    if ($("g-start")) {
      $("g-start").disabled = !!state.combatStarted || G.ended;
      $("g-start").textContent = state.combatStarted ? "战斗中" : "开始战斗";
    }
    if (window.HotseatGame && HotseatGame.isRequested()) {
      if (!state.combatStarted) { et.disabled = et.disabled || !HotseatGame.canStart(); $("g-start").disabled = $("g-start").disabled || !HotseatGame.canStart(); }
      else if (hotseat()) { et.disabled = et.disabled || !!HotseatGame.reason(unitById(HotseatGame.currentUnit())); et.innerHTML = "结束单位行动<small>空格</small>"; }
    }
    if (!G.arm && G.depth === 0 && !$("g-hint").dataset.flash) setHint(defaultHint());
  }

  /** 武器生物化的技能：唤出武器人（xxx_summon、绯秋分出当前刀），以及武器人的收回为武器（xxx_return） */
  function isSummonSkill(id) { return /_summon$/.test(id || "") || /_return$/.test(id || ""); }
  /** 角色的主属性（卡面 note「人类黑客 · 能量/电 · 直伤专精」里斜杠前那个）；武器人跟着主人 */
  function mainElementOf(u) {
    if (!u) return null;
    const owner = isWeaponUnit(u) && typeof ownerOfWeapon === "function" ? ownerOfWeapon(u, state.units) : null;
    const src = owner || u;
    const part = String(src.note || "").split("·").map(x => x.trim())[1] || "";
    const cn = part.split("/")[0].trim();
    return (typeof ELE_BY_CN !== "undefined" && ELE_BY_CN[cn]) || null;
  }
  /** 武器生物化的图标：一把刀被圆形箭头环绕（唤出 = 顺时针、刀上冒出生命的火花；收回 = 逆时针） */
  function summonIcon(back) {
    return `<svg class="sm-ic" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 4a16 16 0 1 1-14.3 8.8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>` +
      (back ? `<path d="M3 6v7.5h7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
            : `<path d="M20 4l-5-3M20 4l-4 4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`) +
      `<path d="M13 27 25 15l2.2 2.2L15.2 29.2z" fill="currentColor"/><path d="M11 25l6 6M10.5 30.5l2.5-2.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>` +
      (back ? "" : `<path d="M28 9l1.2 2.6 2.6 1.2-2.6 1.2L28 16.6l-1.2-2.6-2.6-1.2 2.6-1.2z" fill="currentColor"/>`) + `</svg>`;
  }

  function defaultHint() {
    const a = unitById(G.actorId);
    if (G.ended) return "";
    if (hotseat() && state.combatStarted) { const why = HotseatGame.reason(a); if (why) return esc(why); }
    if (!state.combatStarted) return "摆好队伍和敌人后，点「开始战斗」。回合开始效果会在此时结算。";
    if (state.combatPhase !== "player") return "敌人行动中。点击战场可以跳过演出。";
    if (!a) return "选择一名角色。";
    if (a.stunned) return `<b>${esc(a.name)}</b> 失衡中，本回合无法行动。Tab 切换角色。`;
    return `<b>${esc(a.name)}</b>　选择技能。Tab 切换角色，空格结束回合。`;
  }
  function setHint(html) { $("g-hint").innerHTML = html; }
  function flashHint(text) {
    if (window.Sfx) Sfx.ui("error");   // 不能这样做
    const h = $("g-hint");
    h.dataset.flash = "1";
    h.innerHTML = `<span style="color:var(--foe)">${esc(text)}</span>`;
    realTimeout(() => { delete h.dataset.flash; if (!G.arm) setHint(defaultHint()); }, 1800);
  }

  function syncAfterBackstage() {
    if (G.depth > 0) return;
    setView(snapAll(), false);
    refreshHud();
  }

  /* ---------- 战斗评分（右上角的评价字母） ---------- */
  let lastParts = {};
  let rankShown = 0, rankTarget = 0, rankLines = null, rankRaf = 0;
  /** 按「现在显示的分数」画评价字母、分数、进度条；评价变了就让字母放大跳出来 */
  function paintRankAt(score) {
    const box = $("g-rank");
    if (!box || !rankLines) return;
    const lines = rankLines;
    const g = lines.find(x => score >= x[1]) || lines[lines.length - 1];
    const i = lines.indexOf(g);
    const next = i > 0 ? lines[i - 1] : null;
    const prevGrade = box.dataset.grade;
    box.dataset.grade = g[0];
    box.querySelector(".rk-grade").textContent = g[0];
    box.querySelector(".rk-score").textContent = score + " 分";
    const span = next ? Math.max(1, next[1] - g[1]) : 1;
    box.querySelector(".rk-bar i").style.width = (next ? Math.min(100, Math.max(0, (score - g[1]) / span * 100)) : 100) + "%";
    box.querySelector(".rk-next").textContent = next ? `距 ${next[0]} 还差 ${Math.max(0, next[1] - score)} 分` : "最高评价";
    if (prevGrade && prevGrade !== g[0] && score > 0 && lines.indexOf(lines.find(x => x[0] === prevGrade)) > i) {
      box.classList.remove("up"); void box.offsetWidth; box.classList.add("up");
    }
  }
  /** 加分动画：数字逐渐变多（先快后慢），滚动时放大、抖动；滚完慢慢缩回原大小。返回大约要多久（毫秒） */
  function rollScore(target) {
    rankTarget = target;
    const box = $("g-rank");
    const num = box && box.querySelector(".rk-score");
    if (!num) { rankShown = target; return 0; }
    num.classList.add("counting");
    const est = Math.min(1600, 350 + (target - rankShown) * 1.2);
    if (rankRaf) return est;
    let last = 0;
    const step = (t) => {
      if (t - last >= 40) {   // 约 25 帧 / 秒地跳数字
        last = t;
        const gap = rankTarget - rankShown;
        rankShown = gap <= 0 ? rankTarget : rankShown + Math.max(1, Math.ceil(gap * 0.12));
        paintRankAt(rankShown);
      }
      if (rankShown < rankTarget) rankRaf = requestAnimationFrame(step);
      else { rankRaf = 0; num.classList.remove("counting"); }
    };
    rankRaf = requestAnimationFrame(step);
    return est;
  }
  function paintRank() {
    const box = $("g-rank");
    if (!box || typeof battleGrade !== "function") return;
    const show = !!state.combatStarted || !!G.ended;
    box.classList.toggle("on", show);
    if (!show) {
      lastParts = {}; rankShown = rankTarget = 0;
      if (rankRaf) { cancelAnimationFrame(rankRaf); rankRaf = 0; }
      delete box.dataset.grade;
      return;
    }
    const gr = battleGrade();
    // 分数往上加时数字滚动上去（rollScore），评价字母跟着滚到的分数走；往下掉、模拟、瞬间回放直接跳到位
    rankLines = gr.lines;
    if (G.sim || G.instant || gr.score <= rankShown || !box.dataset.grade) {
      rankShown = gr.score;
      paintRankAt(rankShown);
    } else rollScore(gr.score);
    // 单人模式：支援机会（门槛 ROGUE_SOLO.supportScore 分，手里每有 1 次 +supportStep，最多存 supportMax 次）
    const sup = state.solo ? dispatch({ type: "battle.supportInfo" }) : null;
    const supBox = box.querySelector(".rk-support");
    if (supBox) {
      supBox.textContent = sup ? `支援 ×${sup.left}${!sup.partners.length ? "　伙伴都出过场了" : sup.full ? `　已存满 ${sup.max} 次` : `　下一次 ${sup.next} 分`}` : "";
      const prevLeft = Number(supBox.dataset.left || 0);
      if (sup && sup.left > prevLeft && !G.sim) { supBox.classList.remove("gain"); void supBox.offsetWidth; supBox.classList.add("gain"); }
      supBox.dataset.left = sup ? sup.left : 0;
    }
    // 新得的分：一行一行冒出来
    const feed = box.querySelector(".rk-feed");
    Object.keys(gr.parts).forEach(k => {
      const d = (gr.parts[k] || 0) - (lastParts[k] || 0);
      if (d > 0 && !G.sim) {
        const line = k === "fatigue"
          ? el("div", "rk-gain neg", `−${d} 招式疲劳`)
          : el("div", "rk-gain", `+${d} ${SCORE_PART_NAMES[k] || k}`);
        feed.prepend(line);   // column-reverse：最新的一行贴着评价字母，旧的往上推
        realTimeout(() => line.remove(), 2600);
        while (feed.children.length > 5) feed.lastChild.remove();
      }
    });
    lastParts = Object.assign({}, gr.parts);
  }
  /* ---------- 单次行动的总伤害（评分旁边） ----------
   * 一次行动（含它引出的协助攻击等后续）里打在敌人身上的所有伤害都加进来：多段攻击、高压场地 / 感电 / 共振这类附带伤害都算。
   * 字号按总数涨，门槛和伤害数字的「大伤害」一致（bigHitInfo：目标等级 × 2 + 8 起，到两倍封顶）。
   * 一下就打出大伤害：大数字直接砸出来；多段：每段都弹一下、数字滚上去、越来越大，跨过门槛时再砸一次。
   * 颜色 = 这次攻击动作本身那一下的属性（不是附带伤害的属性）。 */
  const combo = { on: false, total: 0, shown: 0, hits: 0, level: 1, element: null, mainSet: false, big: false, token: 0, raf: 0 };
  function comboBox() {
    let b = $("g-combo");
    if (!b) {
      const rank = $("g-rank");
      if (!rank) return null;
      b = el("div", "g-combo", `<div class="cb-num"></div><div class="cb-sub"></div>`);
      b.id = "g-combo";
      rank.appendChild(b);
    }
    return b;
  }
  function comboStart() {
    if (G.sim) return;
    Object.assign(combo, { on: true, total: 0, hits: 0, level: 1, element: null, mainSet: false, big: false });
  }
  /** 放这段演出之前先看一眼：攻击动作本身那一下的属性，免得连带伤害先弹出来时颜色先变成它的 */
  function comboPrime(pops) {
    if (!combo.on || combo.mainSet) return;
    const m = pops.find(e => e.kind === "dmg" && e.main && Number(e.value) > 0 && unitById(e.unitId) && !unitById(e.unitId).isPlayer);
    if (m) { combo.element = m.element; combo.mainSet = true; }
  }
  function comboHit(e, v) {
    if (!combo.on || G.sim || !(v > 0)) return;
    const u = unitById(e.unitId);
    if (!u || u.isPlayer) return;   // 只算打在敌人身上的
    if (!combo.hits) { combo.level = Number(u.level) || 1; combo.shown = 0; }
    if (e.main && !combo.mainSet) { combo.element = e.element; combo.mainSet = true; }
    else if (!combo.element) combo.element = e.element;
    combo.total += v;
    combo.hits += 1;
    combo.token += 1;
    paintCombo();
  }
  function comboSize(total) {
    const bh = bigHitInfo(combo.level, total);
    return { bh, size: bh.big ? Math.round(58 + 34 * bh.ratio) : Math.round(24 + 22 * Math.min(1, total / bh.th)) };
  }
  function paintCombo() {
    const b = comboBox();
    if (!b) return;
    const num = b.querySelector(".cb-num"), sub = b.querySelector(".cb-sub");
    const { bh } = comboSize(combo.total);
    const wasBig = combo.big;
    combo.big = bh.big;
    b.className = "g-combo show e-" + (combo.element || "physical") + (bh.big ? " big" : "");
    sub.textContent = combo.hits > 1 ? `${combo.hits} 段 · 总伤害` : "伤害";
    // 动画：一下就是大伤害 / 多段跨过门槛 → 砸出来；其余每段弹一下
    const anim = bh.big && (combo.hits === 1 || !wasBig) ? "slam" : combo.hits === 1 ? "enter" : "bump";
    num.classList.remove("slam", "enter", "bump");
    void num.offsetWidth;
    num.classList.add(anim);
    if (anim === "slam") { b.classList.remove("quake"); void b.offsetWidth; b.classList.add("quake"); }
    // 数字滚上去（一下打出来的直接显示）
    const from = combo.hits === 1 ? combo.total : combo.shown;
    const to = combo.total, t0 = performance.now(), span = 160;
    if (combo.raf) cancelAnimationFrame(combo.raf);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / span);
      combo.shown = Math.round(from + (to - from) * k);
      num.textContent = combo.shown;
      num.style.fontSize = comboSize(combo.shown).size + "px";
      if (k < 1) combo.raf = requestAnimationFrame(step); else combo.raf = 0;
    };
    step(t0);
    if (from !== to) combo.raf = requestAnimationFrame(step);
  }
  function comboEnd() {
    if (!combo.on) return;
    combo.on = false;
    if (!combo.hits) return;
    const token = combo.token;
    realTimeout(() => {
      if (token !== combo.token || combo.on && combo.hits) return;   // 下一次行动已经开始打了
      const b = $("g-combo");
      if (b) b.classList.remove("show");
    }, combo.big ? 2400 : 1600);
  }

  function refreshAll() {
    if (G.depth === 0) setView(snapAll(), true);
    refreshHud();
    paintUndo();
    paintRank();
    if ($("g-stats-sheet") && $("g-stats-sheet").classList.contains("show")) openStats();   // 开着就随时刷新
  }

  function addLogPhase(text) {
    const d = el("div", "lg phase", `<div class="t">${esc(text)}</div>`);
    $("g-logs").appendChild(d);
    $("g-logs").scrollTop = 1e9;
  }

  /* 右侧战斗记录：规则层已经把每次行动整理成一块（app.js · formatHitLines / tidyActionBlock）：
   *   【谁】技能名           → 卡片标题
   *     消耗 / → 目标：结果 / 后果   → 每行都显示
   *         掷骰、基础伤害、克制……   → 缩进更深的是计算过程，收在「计算过程」里
   * 全部文字可以选中复制；顶上有「复制本回合」「复制全部」。 */
  function pushLog(meta, tape) {
    const lines = logLines(tape).filter(t => t.trim());
    if (!lines.length) return;
    // 严格按顺序：回合 / 阶段分隔单独一行；中间的行按「【谁】…」分成一张张卡片
    let run = [];
    let phases = [];
    const flushPhases = () => { if (phases.length) { addLogPhase([...new Set(phases)].join("　")); phases = []; } };
    const flushRun = () => { if (run.length) { pushLogCard(meta, run); run = []; } };
    lines.forEach(t => {
      if (/^——/.test(t.trim())) { flushRun(); phases.push(t.replace(/——/g, "").trim()); return; }
      flushPhases();
      run.push(t);
    });
    flushRun();
    flushPhases();
  }
  function pushLogCard(meta, rest) {
    let html = "";
    let calc = [];
    const flushCalc = () => {
      if (!calc.length) return;
      html += `<details class="calc"><summary>计算过程</summary><pre>${calc.map(colorLine).join("\n")}</pre></details>`;
      calc = [];
    };
    rest.forEach(raw => {
      const ind = raw.match(/^ */)[0].length;
      const t = raw.trim();
      if (/^【/.test(t)) { flushCalc(); html += `<div class="t">${colorLine(t)}</div>`; return; }
      if (ind >= 6) { calc.push(raw.slice(6)); return; }
      flushCalc();
      const cls = /^→/.test(t) ? " hit"
        : /^本行动合计/.test(t) ? " sum"
        : /^消耗|消耗 \d+ (行动点|附赠)/.test(t) ? " cost"
        : /失衡|打破架势|击杀|死亡|濒死|倒下|起身/.test(t) ? " warn" : "";
      html += `<div class="s${cls}">${colorLine(t)}</div>`;
    });
    flushCalc();
    // 没有「【谁】」标题的零散行（回合结束、回合开始的结算……）不硬套标题
    const loose = !/^<div class="t">/.test(html);
    if (loose && meta.actorId) html = `<div class="t">${titleHtml(meta)}</div>` + html;
    const d = el("div", "lg" + (loose && !meta.actorId ? " note" : ""));
    d.innerHTML = html;
    $("g-logs").appendChild(d);
    $("g-logs").scrollTop = 1e9;
  }

  /** 复制记录（跑团时贴到聊天里）：用规则层的纯文本，包含计算过程 */
  function copyBattleLog(which, btn) {
    const text = typeof logPlainText === "function" ? logPlainText(which) : $("g-logs").innerText;
    const done = (ok) => {
      if (!btn) return;
      const old = btn.dataset.label || btn.textContent;
      btn.dataset.label = old;
      btn.textContent = ok ? "已复制" : "复制失败";
      realTimeout(() => { btn.textContent = old; }, 1200);
    };
    if (typeof copyText === "function") copyText(text, done);
  }


  const SAVE_KEY = "anterscale-saves";
  const CAMP_KEY = "anterscale-campaign";

  function defaultStatuses() {
    return {
      burn: 0, shock: false, corr: false, frostbite: false, shockwave: false,
      high: false, reso: false, unstable: false, weak: false, inspire: false,
      sturdy: false, hide: false, advantage: false, chase: false, latestElement: null
    };
  }

  function packHero(u) {
    return {
      kit: u.kit,
      name: u.name,
      level: u.level,
      xp: u.xp || 0,
      attrs: u.attrs ? JSON.parse(JSON.stringify(u.attrs)) : null,
      shp: u.shpMax || u.shp || 0,
      shpMax: u.shpMax || u.shp || 0,
      personalAtk: u.personalAtk,
      weaponAtk: u.weaponAtk,
      resources: (function () {
        const r = u.resources || {};
        const keep = {};
        ["nano", "bean", "liquid", "power"].forEach(k => { if (r[k] != null) keep[k] = r[k]; });
        if (r.blade) keep.blade = r.blade;
        return keep;
      })(),
      roles: u.roles || null,
      // 跑团模式：武器等级、属性点、加过的属性、手册里还没做成系统的奖励（熟练项、专长……）
      weaponLevels: u.weaponLevels ? JSON.parse(JSON.stringify(u.weaponLevels)) : null,
      weaponParts: u.weaponParts ? JSON.parse(JSON.stringify(u.weaponParts)) : null,   // 武器改装槽
      bonds: u.bonds ? JSON.parse(JSON.stringify(u.bonds)) : null,   // 羁绊（和每把武器之间，0–5）
      weaponBlueprints: u.weaponBlueprints ? JSON.parse(JSON.stringify(u.weaponBlueprints)) : null,   // 客制化图纸
      attrPoints: Number(u.attrPoints) || 0,
      attrPicks: (u.attrPicks || []).slice(),
      notes: u.levelNotes ? JSON.parse(JSON.stringify(u.levelNotes)) : null
    };
  }

  function rememberCampaign() { return dispatch({ type: "battle.rememberCampaign" }); }
  function rememberCampaignRules() {
    const party = state.units.filter(u => u.isPlayer && !isWeaponUnit(u)).map(packHero);
    // 换下场的队员也留着记忆（跑团模式换人后再换回来，等级、经验不丢）
    const prev = (G.campaign && G.campaign.party) || [];
    prev.forEach(s => { if (!party.some(x => x.kit === s.kit)) party.push(s); });
    G.campaign = {
      party,
      partyKits: G.partyKits.slice(),
      kuizhi: Number(state.kuizhi) || 0,
      items: JSON.parse(JSON.stringify((ensureBag().items) || [])),
      ledger: typeof LEDGER !== "undefined" ? LEDGER.save() : null
    };
    try { localStorage.setItem(CAMP_KEY, JSON.stringify(G.campaign)); } catch (e) {}
    if (typeof G.onCampaignSaved === "function") G.onCampaignSaved(G.campaign);
  }

  function loadCampaignMem() { return dispatch({ type: "battle.loadCampaign" }); }
  function loadCampaignMemRules() {
    if (G.campaign) return G.campaign;
    try {
      const raw = localStorage.getItem(CAMP_KEY);
      if (raw) G.campaign = JSON.parse(raw);
    } catch (e) {}
    if (G.campaign && typeof LEDGER !== "undefined") LEDGER.load(G.campaign.ledger);
    return G.campaign;
  }

  function applyCampaignToField() {
    const camp = loadCampaignMem();
    if (!camp) return;
    if (camp.kuizhi != null) state.kuizhi = camp.kuizhi;
    if (camp.items) { ensureBag(); state.bag.items = JSON.parse(JSON.stringify(camp.items)); }
    (camp.party || []).forEach(s => {
      const u = state.units.find(x => x.isPlayer && x.kit === s.kit);
      if (!u) return;
      if (s.level) u.level = s.level;
      u.xp = s.xp || 0;
      if (s.attrs) u.attrs = s.attrs;
      if (s.roles) u.roles = s.roles;
      if (s.resources) u.resources = Object.assign(u.resources || {}, s.resources);
      if (s.attrPoints != null) u.attrPoints = s.attrPoints;
      if (s.attrPicks) u.attrPicks = s.attrPicks.slice();
      if (s.notes) u.levelNotes = s.notes;
      if (typeof applyLevelStats === "function") applyLevelStats(u);
      if (s.bonds) u.bonds = JSON.parse(JSON.stringify(s.bonds));   // 先放羁绊：改装槽数量要按「武器等级 + 羁绊」算
      if (s.weaponParts) u.weaponParts = JSON.parse(JSON.stringify(s.weaponParts));
      if (s.weaponBlueprints) u.weaponBlueprints = JSON.parse(JSON.stringify(s.weaponBlueprints));
      if (s.weaponLevels && typeof setOwnedWeaponLevel === "function") {
        Object.keys(s.weaponLevels).forEach(k => {
          const quiet = window.appendLog; window.appendLog = () => {};   // 恢复存档时不写「须找工匠」提示
          try { setOwnedWeaponLevel(u, k, s.weaponLevels[k]); } finally { window.appendLog = quiet; }
        });
      }
      u.shpMax = s.shpMax || u.shpMax;
      u.shp = u.shpMax;
      if (s.personalAtk != null) u.personalAtk = s.personalAtk;
      if (s.weaponAtk != null) u.weaponAtk = s.weaponAtk;
      u.atk = (u.personalAtk || 0) + (u.weaponHeld === false ? 0 : (u.weaponAtk || 0));
      u.stunned = false; u.dying = false; u.dead = false; u.upOnShp = false;
      u.statuses = defaultStatuses();
      (u.layers || []).forEach(l => { l.current = l.max; });
      u.def = u.defMax;
    });
  }

  function readSlots() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      const arr = raw ? JSON.parse(raw) : [null, null, null];
      while (arr.length < 3) arr.push(null);
      return arr.slice(0, 3);
    } catch (e) { return [null, null, null]; }
  }
  function writeSlots(arr) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  function writeSlot(i) {
    rememberCampaign();
    const slots = readSlots();
    slots[i] = {
      at: Date.now(),
      label: "第 " + (state.turnNo || 1) + " 回合 · " + (Number(state.kuizhi) || 0) + " 奎支",
      campaign: JSON.parse(JSON.stringify(G.campaign))
    };
    writeSlots(slots);
    return slots[i];
  }
  function loadSlot(i, level) {
    const slots = readSlots();
    const s = slots[i];
    if (!s || !s.campaign) return false;
    G.campaign = JSON.parse(JSON.stringify(s.campaign));
    if (typeof LEDGER !== "undefined") LEDGER.load(G.campaign.ledger);
    try { localStorage.setItem(CAMP_KEY, JSON.stringify(G.campaign)); } catch (e) {}
    return true;
  }
  function clearSlot(i) {
    const slots = readSlots();
    slots[i] = null;
    writeSlots(slots);
  }

  /** 档案有变动：存下来、刷新战场显示、写一行记录 */
  function panelCommit(command) {
    const result = dispatch(Object.assign({ type: "battle.panel" }, command));
    ledgerCommit(result && result.notes);
    return result;
  }
  function ledgerCommit(notes) {
    rememberCampaign();
    (notes || []).forEach(t => addLogPhase(t));
    if (G.depth === 0) { setView(snapAll(), false); refreshAll(); }
  }
  function heroesForUse() {
    return (typeof partyHeroes === "function" ? partyHeroes() : []).filter(h => !h.dead);
  }

  function renderBagSheet() {
    dispatch({ type: "battle.panel", action: "normalizeBag" });
    $("g-kuizhi").textContent = String(Number(state.kuizhi) || 0);
    $("g-water").textContent = String(typeof ledgerWater === "function" ? ledgerWater() : 0);

    // 食物：四档都列出来，数量 0 也显示，方便直接加
    const fbox = $("g-food-list");
    fbox.innerHTML = "";
    (typeof FOOD_ORDER !== "undefined" ? FOOD_ORDER : []).forEach(id => {
      const spec = ITEM_CATALOG[id];
      if (!spec) return;
      fbox.appendChild(itemRow(id, spec, bagCount(id), false));
    });

    // 物品：背包里的非食物
    const box = $("g-bag-list");
    box.innerHTML = "";
    const rows = bagList().filter(it => !it.food);
    if (!rows.length) box.innerHTML = '<p class="sheet-empty">没有物品。</p>';
    rows.forEach(it => box.appendChild(itemRow(it.id, it, it.qty, true)));

    // 添加物品下拉
    const sel = $("g-item-add-sel");
    const keep = sel.value;
    sel.innerHTML = "";
    Object.keys(ITEM_CATALOG).filter(id => !ITEM_CATALOG[id].food).forEach(id => {
      const o = document.createElement("option");
      o.value = id; o.textContent = ITEM_CATALOG[id].name;
      sel.appendChild(o);
    });
    if (keep) sel.value = keep;
  }

  /** 一行物品：名字、数量、加减，能在休整时用的给一个「使用」 */
  function itemRow(id, spec, qty, usable) {
    const d = el("div", "ledger-item");
    d.innerHTML = `<div class="li-name"><b>${esc(spec.name)}</b><span class="li-qty">×${qty}</span></div>`;
    const btns = el("div", "qty-btns");
    const minus = el("button", "g-btn", "−");
    minus.disabled = qty <= 0;
    minus.onclick = () => { panelCommit({ action: "bagAdd", item: id, amount: -1 }); renderBagSheet(); };
    const plus = el("button", "g-btn", "+");
    plus.onclick = () => { panelCommit({ action: "bagAdd", item: id, amount: 1 }); renderBagSheet(); };
    btns.append(minus, plus);
    d.appendChild(btns);
    d.appendChild(el("small", "", esc(spec.hint || "")));
    if (usable && qty > 0) {
      const useBox = restUseControl(id, spec);
      if (useBox) d.appendChild(useBox);
    }
    return d;
  }

  /** 休整时能用的物品：医疗包对角色，维修工具包对武器 */
  function restUseControl(id, spec) {
    const inFight = state.combatStarted && !G.ended;
    if (id === "medkit" || id === "clinic") {
      if (inFight) return null;     // 战斗里走「使用道具」
      const box = el("div", "ledger-use");
      const sel = document.createElement("select");
      heroesForUse().forEach(h => {
        const o = document.createElement("option");
        o.value = h.kit; o.textContent = `${h.name}（${totalHpOf(h)}/${totalHpMaxOf(h)}）`;
        sel.appendChild(o);
      });
      const go = el("button", "g-btn", "使用");
      go.onclick = () => { panelCommit({ action: "healItem", item: id, kit: sel.value }); renderBagSheet(); };
      box.append(sel, go);
      return box;
    }
    if (id === "repair_kit" || id === "repair_kit_open") {
      if (inFight) return null;     // 战斗里走「使用道具」
      const box = el("div", "ledger-use");
      const sel = document.createElement("select");
      heroesForUse().forEach(h => (h.linkedKits || []).forEach(k => {
        const o = document.createElement("option");
        o.value = k; o.textContent = `${weaponName(k)}（耐久 ${weaponDur(k)}/${weaponDurMax(k)}）`;
        sel.appendChild(o);
      }));
      const go = el("button", "g-btn", "修复（修几点用几点）");
      go.onclick = () => { panelCommit({ action: "repair", kit: sel.value }); renderBagSheet(); };
      box.append(sel, go);
      return box;
    }
    return null;
  }

  /* ---------- 休整 ---------- */
  G.restFood = G.restFood || {};
  G.restSleep = G.restSleep || {};
  G.restSpit = G.restSpit || {};
  G.restAmmo = G.restAmmo || {};
  function renderRestSheet() {
    const t = typeof exhaustTier === "function" ? exhaustTier() : 0;
    $("g-rest-time").innerHTML = `第 <b>${LEDGER.day}</b> 天 <b>${clockText(LEDGER.clock == null ? 480 : LEDGER.clock)}</b> · 距上次长休 <b>${durationText(LEDGER.hours || 0)}</b> · ` +
      `<span class="${t ? "bad" : ""}">${exhaustText(t)}</span>`;
    const inFight = state.combatStarted && !G.ended;
    $("g-rest-lock").textContent = inFight ? "战斗进行中，不能休整。背包仍可随时增减。" : "";

    // 队伍
    const box = $("g-rest-party");
    box.innerHTML = "";
    const foods = FOOD_ORDER.filter(id => ITEM_CATALOG[id]);
    partyHeroes().forEach(h => {
      const row = el("div", "rp-row");
      const tag = h.dead ? "死亡" : h.dying ? "濒死" : h.upOnShp ? "起身中" : "";
      row.appendChild(el("div", "rp-name", `<b>${esc(h.name)}</b>${tag ? `<span class="rp-tag">${tag}</span>` : ""}`));
      const weapons = (h.linkedKits || []).map(k => {
        const d = weaponDur(k), m = weaponDurMax(k);
        return `${esc(weaponName(k))} <b class="${d <= 0 ? "bad" : ""}">${d}/${m}</b>`;
      }).join(" · ");
      const cost = heroRestCost(h);
      row.appendChild(el("div", "rp-stats",
        `血量 <b>${totalHpOf(h)}/${totalHpMaxOf(h)}</b><br>` +
        `${weapons || "无武器"}<br>长休需 ${cost.water} ml 水 · ${cost.food} 份食物`));
      const act = el("div", "rp-act");
      const fsel = document.createElement("select");
      foods.forEach(id => {
        const o = document.createElement("option");
        o.value = id; o.textContent = `长休吃 ${ITEM_CATALOG[id].name}（有 ${bagCount(id)}）`;
        fsel.appendChild(o);
      });
      fsel.value = G.restFood[h.kit] || (typeof defaultFoodFor === "function" ? defaultFoodFor() : foods[0]);
      fsel.onchange = () => { G.restFood[h.kit] = fsel.value; renderRestSheet(); };
      fsel.disabled = h.dead;
      const ssel = document.createElement("select");
      const sleepOpt = (v, t) => { const o = document.createElement("option"); o.value = v; o.textContent = t; ssel.appendChild(o); };
      sleepOpt("", "不用睡眠道具");
      sleepItemIds().forEach(id => sleepOpt(id, `睡 ${ITEM_CATALOG[id].name}（${typeof shpHidden === "function" && shpHidden() ? "睡得更好，多恢复坚毅" : `每小时坚毅 +${ITEM_CATALOG[id].sleep}`} · 有 ${bagCount(id)}）`));
      ssel.value = h.dead ? "" : sleepFor(currentRestPlan(), h.kit);
      ssel.onchange = () => { G.restSleep[h.kit] = ssel.value; renderRestSheet(); };
      ssel.disabled = h.dead;
      // 兽人-蜥蜴：长休时可以换吐酸攻击的属性
      let psel = null;
      if (typeof canSpit === "function" && canSpit(h.kit)) {
        psel = document.createElement("select");
        SPIT_ELEMENTS.forEach(e => { const o = document.createElement("option"); o.value = e; o.textContent = `长休后吐酸：${ELE[e] || e}`; psel.appendChild(o); });
        psel.value = G.restSpit[h.kit] || spitElementOf(h.kit);
        psel.onchange = () => { G.restSpit[h.kit] = psel.value; };
        psel.disabled = h.dead;
      }
      // 龙哥 胶囊弹药+：长休时排下一场开局的弹序
      if (typeof canOrderAmmo === "function" && canOrderAmmo(h)) {
        const asel = document.createElement("select");
        [""].concat(AMMO_ORDERS).forEach(v => { const o = document.createElement("option"); o.value = v; o.textContent = v ? `下一场弹序：${v.replace(/R/g, "红").replace(/B/g, "蓝")}` : "下一场弹序：开局随机"; asel.appendChild(o); });
        asel.value = G.restAmmo[h.kit] != null ? G.restAmmo[h.kit] : ((LEDGER.ammoOrder || {})[h.kit] || "");
        asel.onchange = () => { G.restAmmo[h.kit] = asel.value; };
        asel.disabled = h.dead;
        if (!psel) psel = asel; else { const both = document.createElement("span"); both.append(psel, asel); psel = both; }
      }
      const sr = el("button", "g-btn", `短休（剩 ${shortRestLeft(h)}）`);
      sr.disabled = inFight || h.dead || shortRestLeft(h) <= 0;
      sr.onclick = () => { panelCommit({ action: "shortRest", kits: [h.kit] }); renderRestSheet(); };
      act.append(fsel, ssel);
      if (psel) act.append(psel);
      act.append(sr);
      row.appendChild(act);
      box.appendChild(row);
    });
    $("g-short-all").disabled = inFight;

    // 长休
    const hsel = $("g-long-hours");
    if (!hsel.options.length) {
      for (let x = 8; x <= 12; x++) {
        const o = document.createElement("option");
        o.value = x; o.textContent = x;
        hsel.appendChild(o);
      }
    }
    const plan = currentRestPlan();
    const need = longRestNeeds(plan);
    const foodTxt = Object.keys(need.food).map(fid =>
      `${ITEM_CATALOG[fid].name} <b class="${bagCount(fid) < need.food[fid] ? "bad" : ""}">${need.food[fid]}</b>/${bagCount(fid)}`
    ).join(" · ");
    $("g-long-need").innerHTML =
      `水 <b class="${ledgerWater() < need.water ? "bad" : ""}">${need.water}</b>/${ledgerWater()} ml · ${foodTxt}` +
      Object.keys(need.sleep).map(sid =>
        ` · ${ITEM_CATALOG[sid].name} <b class="${bagCount(sid) < need.sleep[sid] ? "bad" : ""}">${need.sleep[sid]}</b>/${bagCount(sid)}`).join("") +
      (need.ok ? "" : `<br><span class="bad">不够：${esc(need.lack.join("，"))}</span>`);
    const force = $("g-long-force").checked;
    $("g-long-go").disabled = inFight || (!need.ok && !force);
    const foodN = Object.keys(need.food).reduce((a, fid) => a + (Number(need.food[fid]) || 0), 0);
    $("g-long-go").textContent = need.ok || force ? (force ? "长休（不扣补给）" : `长休（${need.water} ml 水 · ${foodN} 份食物）`) : "补给不足";
  }
  function currentRestPlan() {
    const food = {};
    partyHeroes().forEach(h => { food[h.kit] = G.restFood[h.kit] || defaultFoodFor(); });
    const hsel = $("g-long-hours");
    return { hours: Number(hsel && hsel.value) || 8, food, sleep: Object.assign({}, G.restSleep), spit: Object.assign({}, G.restSpit), ammo: Object.assign({}, G.restAmmo), force: !!($("g-long-force") && $("g-long-force").checked) };
  }

  function renderSaveSheet() {
    const box = $("g-save-list");
    box.innerHTML = "";
    readSlots().forEach((s, i) => {
      const d = el("div", "sheet-slot");
      const when = s && s.at ? new Date(s.at).toLocaleString() : "空";
      d.innerHTML = `<div><b>存档 ${i + 1}</b><div class="sub">${s ? esc(s.label) + " · " + when : "空档"}</div></div>`;
      const save = el("button", "g-btn", "写入");
      save.onclick = () => { dispatch({ type: "battle.panel", action: "saveSlot", index: i }); renderSaveSheet(); flashHint("已写入存档 " + (i + 1)); };
      const load = el("button", "g-btn", "读取");
      load.disabled = !s;
      load.onclick = () => { if (dispatch({ type: "battle.panel", action: "loadSlot", index: i })) setupBattle(Number($("g-level").value) || 1); $("g-save-sheet").classList.remove("show"); flashHint("已读取存档 " + (i + 1)); };
      const wipe = el("button", "g-btn", "清除");
      wipe.disabled = !s;
      wipe.onclick = () => { dispatch({ type: "battle.panel", action: "clearSlot", index: i }); renderSaveSheet(); };
      d.append(save, load, wipe);
      box.appendChild(d);
    });
  }

  function paintGaps() {
    document.querySelectorAll("#g-field .g-gap").forEach(node => {
      const key = node.dataset.key;
      if (!key) return;
      if (!state.gaps || !state.gaps[key]) dispatch({ type: "battle.panel", action: "normalizeGaps" });
      const g = state.gaps[key];
      const keep = ["is-targetable", "is-hover", "hit"].filter(c => node.classList.contains(c));
      node.className = "g-gap gap-" + (g.type || "open") + (keep.length ? " " + keep.join(" ") : "");
      if (!node._bound) {
        node._bound = true;
        const id = "gap:" + key;
        node.addEventListener("mouseenter", () => onCardHover(id, true));
        node.addEventListener("mouseleave", () => onCardHover(id, false));
        node.addEventListener("click", (e) => { e.stopPropagation(); onCardClick(id); });
      }
      const hp = (g.type === "bridge" || g.type === "wall") ? (" " + (g.hp || 0)) : "";
      const door = g.type === "door" ? (g.open ? " 开" : " 关") : "";
      node.innerHTML = `<span class="gap-lab">${gapLabel(g.type)}${hp}${door}</span>`;
    });
  }

  /** 一个区的格子（单位、配置物都摆在里面） */
  function makeZoneSection(z) {
    const sec = el("section", "g-zone");
    sec.dataset.num = String(z);
    sec.innerHTML = `<span class="zlabel">${z} 区</span><div class="grp enemy"></div><div class="grp prop"></div><div class="grp player"></div>`;
    return sec;
  }
  /**
   * 战场棋盘：普通的两区 / 三区直排照旧（一排：区 | 间隔 | 区 …）；
   * 特殊棋盘（state.board）按每个区的格子坐标摆进网格：区占奇数行列，相连两区之间的那一格放间隔条
   * （左右相连是竖条，上下相连是横条）。没有区的格子空着。
   */
  function syncFieldDom() {
    const field = $("g-field");
    if (!field) return;
    const n = Number(state.zoneMode) || 2;
    field.innerHTML = "";
    field.removeAttribute("style");
    dispatch({ type: "battle.panel", action: "normalizeField" });
    const sections = [];
    if (state.board) {
      const b = state.board;
      const W = Math.max(...b.zones.map(q => Number(q.x))) + 1, Hh = Math.max(...b.zones.map(q => Number(q.y))) + 1;
      field.className = "g-field board-grid " + (W >= 3 ? "z3" : "z2") + (Hh >= 2 ? " rows" + Hh : "");
      const track = (k, zone, gap) => Array.from({ length: 2 * k - 1 }, (_, i) => (i % 2 ? gap : zone)).join(" ");
      field.style.gridTemplateColumns = track(W, "minmax(0, 1fr)", W >= 3 ? "32px" : "28px");
      field.style.gridTemplateRows = track(Hh, "minmax(0, 1fr)", "24px");
      b.zones.forEach(q => {
        const sec = makeZoneSection(Number(q.id));
        sec.style.gridColumn = String(2 * Number(q.x) + 1);
        sec.style.gridRow = String(2 * Number(q.y) + 1);
        field.appendChild(sec);
        sections.push(sec);
      });
      boardLinks(b).forEach(([za, zb]) => {
        const qa = boardZone(za, b), qb = boardZone(zb, b);
        const dx = Math.abs(qa.x - qb.x), dy = Math.abs(qa.y - qb.y);
        if (dx + dy !== 1) return;   // 只画上下左右挨着的连接（不挨着的连接规则上照样算，画面上不画条）
        const gap = el("div", "g-gap" + (dy ? " horiz" : ""));
        gap.dataset.key = gapKey(za, zb);
        gap.style.gridColumn = String(dx ? 2 * Math.min(qa.x, qb.x) + 2 : 2 * qa.x + 1);
        gap.style.gridRow = String(dy ? 2 * Math.min(qa.y, qb.y) + 2 : 2 * qa.y + 1);
        field.appendChild(gap);
      });
    } else {
      field.className = "g-field z" + n;
      for (let z = 1; z <= n; z++) {
        if (z > 1) {
          const key = gapKey(z - 1, z);
          const gap = el("div", "g-gap");
          gap.dataset.key = key;
          field.appendChild(gap);
        }
        const sec = makeZoneSection(z);
        field.appendChild(sec);
        sections.push(sec);
      }
    }
    sections.forEach(sec => {
      sec.addEventListener("mouseenter", () => {
        if (!(G.arm && G.arm.mode === "zone" && G.arm.zones.has(Number(sec.dataset.num)))) return;
        sec.classList.add("is-move-hover");
        const pv = G.arm.previewFn(Number(sec.dataset.num));
        showPreview(pv, `移动到 ${sec.dataset.num} 区`);
      });
      sec.addEventListener("mouseleave", () => {
        sec.classList.remove("is-move-hover");
        if (G.arm && G.arm.mode === "zone") clearPreview();
      });
    });
    paintGaps();
    requestAnimationFrame(() => { try { fitZones(); } catch (e) {} });
  }

  function heroKits() {
    return livePartyCards().filter(c => !c.weaponOf);
  }

  /** 后台。计算器的 renderBackstage 写在 app.js 里，这里复用同一份：
   *  把它要写入的 #backstageBody 从隐藏的 #calc-core 搬到游戏面板中，
   *  这样规则和字段只有一份，计算器改了游戏跟着变。 */
  function openBackstage() {
    const mount = $("g-bs-mount");
    let body = document.getElementById("backstageBody");
    if (!body) {
      body = el("div", "");
      body.id = "backstageBody";
      mount.appendChild(body);
    } else if (body.parentElement !== mount) {
      mount.appendChild(body);            // 从 #calc-core 里搬出来
    }
    if (typeof renderBackstage === "function") renderBackstage();
    else mount.innerHTML = '<p class="hint">后台渲染函数缺失。</p>';
    if (!mount.dataset.bound) {
      // 后台里的输入框只改 state，不会通知游戏，这里统一在改动后刷新战场
      const sync = () => setTimeout(syncAfterBackstage, 0);
      mount.addEventListener("change", sync, true);
      mount.addEventListener("input", sync, true);
      mount.addEventListener("click", (e) => { if (e.target.closest("button")) sync(); }, true);
      mount.dataset.bound = "1";
    }
    $("g-party-sheet").classList.remove("show");   // 避免两层面板叠在一起
    $("g-bs-sheet").classList.add("show");
    G.bsOpen = true;
  }

  function renderPartySheet() {
    const box = $("g-party-list");
    const sel = $("g-party-add-sel");
    box.innerHTML = "";
    const on = state.units.filter(u => u.isPlayer && !isWeaponUnit(u) && !u.hidden);
    if (!on.length) box.innerHTML = '<p class="sheet-empty">场上没有玩家角色。</p>';
    on.forEach(u => {
      const row = el("div", "sheet-slot");
      row.innerHTML = `<div><b>${esc(u.name)}</b><div class="sub">${esc(u.enName || u.kit)} · Lv${u.level} · ${u.zone} 区</div></div>`;
      const rm = el("button", "g-btn", "移出");
      rm.onclick = () => {
        dispatch({ type: "battle.panel", action: "removeParty", actor: u.id });
        setView(snapAll(), false);
        refreshAll();
        renderPartySheet();
      };
      row.appendChild(rm);
      box.appendChild(row);
    });
    const used = new Set(on.map(u => u.kit));
    sel.innerHTML = heroKits().filter(c => !used.has(c.kit)).map(c => `<option value="${c.kit}">${esc(c.name)}</option>`).join("");
  }

  function addPartyKit(kit, zone) {
    dispatch({ type: "battle.panel", action: "addParty", kit, zone: Number(zone) || 1 });
    setView(snapAll(), false);
    refreshAll();
  }

  function renderFieldSheet() {
    $("g-cfg-zones").value = state.board ? String(state.board.id) : String(state.zoneMode || 2);
    $("g-cfg-ps").value = String(state.partySize || 4);
    $("g-cfg-weather").value = state.weather || "none";
    const elist = $("g-enemy-list");
    elist.innerHTML = "";
    const foesNow = state.units.filter(u => !u.isPlayer && !u.hidden && u.kit !== "ufo_leg");
    if (!foesNow.length) elist.innerHTML = '<p class="sheet-empty">场上没有敌人。</p>';
    foesNow.forEach(u => {
      const row = el("div", "sheet-slot");
      row.innerHTML = `<div><b>${esc(u.name)}</b><div class="sub">${u.kit || ""} · Lv${u.level} · ${u.zone} 区</div></div>`;
      const rm = el("button", "g-btn", "移出");
      rm.onclick = () => {
        dispatch({ type: "battle.panel", action: "removeEnemy", actor: u.id });
        setView(snapAll(), false);
        refreshAll();
        renderFieldSheet();
      };
      // 首领机制·死刑（boss-mechanics.js）：在这里给任意敌人挂上试用
      const cur = (u.mechanics || []).find(m => m.type === "execution");
      const ex = el("button", "g-btn" + (cur ? " on" : ""), cur ? "死刑 ✓" : "死刑…");
      ex.title = "给这个敌人加上「死刑」机制：标记我方血量上限最高的单位，倒计时到了在回合开始时打一次（可以分几段，每段都能协助格挡）";
      row.appendChild(ex);
      row.appendChild(rm);
      elist.appendChild(row);
      const ed = el("div", "exec-edit");
      ed.hidden = true;
      ed.innerHTML = `<label>落下<select data-x="phase"><option value="enemy">敌人回合开始</option><option value="player">我方回合开始</option></select></label>
        <label>标记后<input data-x="turns" type="number" min="1" max="20" value="3"> 回合</label>
        <label title="每一段的倍率（× 这个敌人的 atk），用逗号隔开：3 = 一段 3 倍；2,1,1 = 三段">每段倍率<input data-x="hits" type="text" value="3"></label>
        <label>落下后<select data-x="then"><option value="repeat">重新标记</option><option value="once">只放一次</option></select></label>
        <button class="g-btn" data-x="go">${cur ? "改" : "加上"}</button>${cur ? '<button class="g-btn" data-x="off">去掉</button>' : ""}`;
      elist.appendChild(ed);
      const f = (k) => ed.querySelector(`[data-x="${k}"]`);
      if (cur) {
        f("phase").value = cur.phase || "enemy"; f("turns").value = cur.turns || 3;
        f("hits").value = (cur.hits || []).map(h => h.mult).join(","); f("then").value = cur.then || "repeat";
      }
      ex.onclick = () => { ed.hidden = !ed.hidden; };
      const apply = (cfg) => {
        let r;
        try { r = dispatch({ type: "battle.panel", action: "setExecution", actor: u.id, cfg }); } catch (e) { flashHint(e.message); return; }
        ((r && r.notes) || []).forEach(t => appendLog(t));
        setView(snapAll(), false);
        refreshAll();
        renderFieldSheet();
      };
      f("go").onclick = () => apply({
        phase: f("phase").value, then: f("then").value,
        turns: Math.max(1, Math.min(20, Math.floor(Number(f("turns").value) || 3))),
        hits: String(f("hits").value).split(/[,，\s]+/).filter(Boolean).map(x => ({ mult: Number(x) }))
      });
      if (f("off")) f("off").onclick = () => apply(null);
      // 首领机制·分担
      const curS = (u.mechanics || []).find(m => m.type === "share");
      const sb = el("button", "g-btn" + (curS ? " on" : ""), curS ? "分担 ✓" : "分担…");
      sb.title = "给这个敌人加上「分担」机制：随机标记一名我方单位，倒计时到了对他所在区造成一次伤害，由同区的友方平均分担，不能格挡";
      row.insertBefore(sb, rm);
      const se = el("div", "exec-edit");
      se.hidden = true;
      se.innerHTML = `<label>落下<select data-x="phase"><option value="enemy">敌人回合开始</option><option value="player">我方回合开始</option></select></label>
        <label>标记后<input data-x="turns" type="number" min="1" max="20" value="3"> 回合</label>
        <label title="伤害池 = 这个倍率 × 这个敌人的 atk，同区的友方平均分担">伤害池<input data-x="mult" type="number" min="0.5" max="50" step="0.5" value="4"> × atk</label>
        <label>落下后<select data-x="then"><option value="repeat">重新标记</option><option value="once">只放一次</option></select></label>
        <button class="g-btn" data-x="go">${curS ? "改" : "加上"}</button>${curS ? '<button class="g-btn" data-x="off">去掉</button>' : ""}`;
      elist.appendChild(se);
      const g = (k) => se.querySelector(`[data-x="${k}"]`);
      if (curS) {
        g("phase").value = curS.phase || "enemy"; g("turns").value = curS.turns || 3;
        g("mult").value = (curS.pool && curS.pool.mult) || 4; g("then").value = curS.then || "repeat";
      }
      sb.onclick = () => { se.hidden = !se.hidden; };
      const applyS = (cfg) => {
        let r;
        try { r = dispatch({ type: "battle.panel", action: "setShare", actor: u.id, cfg }); } catch (e) { flashHint(e.message); return; }
        ((r && r.notes) || []).forEach(t => appendLog(t));
        setView(snapAll(), false);
        refreshAll();
        renderFieldSheet();
      };
      g("go").onclick = () => applyS({
        phase: g("phase").value, then: g("then").value,
        turns: Math.max(1, Math.min(20, Math.floor(Number(g("turns").value) || 3))),
        mult: Math.max(0.5, Math.min(50, Number(g("mult").value) || 4))
      });
      if (g("off")) g("off").onclick = () => applyS(null);
      // 首领机制·远离
      const curP = (u.mechanics || []).find(m => m.type === "spread");
      const pb = el("button", "g-btn" + (curP ? " on" : ""), curP ? "远离 ✓" : "远离…");
      pb.title = "给这个敌人加上「远离」机制：标记我方全员，倒计时到了每人在自己的区爆炸一次，同区有几个标记就炸几次，每次每个人都挨";
      row.insertBefore(pb, rm);
      const pe = el("div", "exec-edit");
      pe.hidden = true;
      pe.innerHTML = `<label>落下<select data-x="phase"><option value="enemy">敌人回合开始</option><option value="player">我方回合开始</option></select></label>
        <label>标记后<input data-x="turns" type="number" min="1" max="20" value="3"> 回合</label>
        <label title="每一次爆炸对同区每个友方的伤害 = 这个倍率 × 这个敌人的 atk">每次爆炸<input data-x="mult" type="number" min="0.5" max="20" step="0.5" value="1"> × atk</label>
        <label>落下后<select data-x="then"><option value="repeat">重新标记</option><option value="once">只放一次</option></select></label>
        <button class="g-btn" data-x="go">${curP ? "改" : "加上"}</button>${curP ? '<button class="g-btn" data-x="off">去掉</button>' : ""}`;
      elist.appendChild(pe);
      const q2 = (k) => pe.querySelector(`[data-x="${k}"]`);
      if (curP) {
        q2("phase").value = curP.phase || "enemy"; q2("turns").value = curP.turns || 3;
        q2("mult").value = (curP.blast && curP.blast.mult) || 1; q2("then").value = curP.then || "repeat";
      }
      pb.onclick = () => { pe.hidden = !pe.hidden; };
      const applyP = (cfg) => {
        let r;
        try { r = dispatch({ type: "battle.panel", action: "setSpread", actor: u.id, cfg }); } catch (e) { flashHint(e.message); return; }
        ((r && r.notes) || []).forEach(t => appendLog(t));
        setView(snapAll(), false);
        refreshAll();
        renderFieldSheet();
      };
      q2("go").onclick = () => applyP({
        phase: q2("phase").value, then: q2("then").value,
        turns: Math.max(1, Math.min(20, Math.floor(Number(q2("turns").value) || 3))),
        mult: Math.max(0.5, Math.min(20, Number(q2("mult").value) || 1))
      });
      if (q2("off")) q2("off").onclick = () => applyP(null);
      // 首领机制·踩塔
      const curT = (u.mechanics || []).find(m => m.type === "tower");
      const tbn = el("button", "g-btn" + (curT ? " on" : ""), curT ? "踩塔 ✓" : "踩塔…");
      tbn.title = "给这个敌人加上「踩塔」机制：随机标记区域，倒计时到了需要有人站在里面踩住（挨一点伤害），没人踩则全员挨巨额伤害";
      row.insertBefore(tbn, rm);
      const te = el("div", "exec-edit");
      te.hidden = true;
      te.innerHTML = `<label>落下<select data-x="phase"><option value="enemy">敌人回合开始</option><option value="player">我方回合开始</option></select></label>
        <label>标记后<input data-x="turns" type="number" min="1" max="20" value="3"> 回合</label>
        <label>塔数<input data-x="count" type="number" min="1" max="5" value="1"></label>
        <label>每座至少<input data-x="need" type="number" min="1" max="4" value="1"> 人</label>
        <label title="踩塔的人每人挨的伤害 = 这个倍率 × 这个敌人的 atk">踩塔伤害<input data-x="soak" type="number" min="0" max="20" step="0.5" value="0.5"> × atk</label>
        <label title="没人踩住时我方全员每人挨的伤害 = 这个倍率 × 这个敌人的 atk">没人踩<input data-x="fail" type="number" min="0.5" max="50" step="0.5" value="4"> × atk</label>
        <label>落下后<select data-x="then"><option value="repeat">重新标记</option><option value="once">只放一次</option></select></label>
        <button class="g-btn" data-x="go">${curT ? "改" : "加上"}</button>${curT ? '<button class="g-btn" data-x="off">去掉</button>' : ""}`;
      elist.appendChild(te);
      const q3 = (k) => te.querySelector(`[data-x="${k}"]`);
      if (curT) {
        q3("phase").value = curT.phase || "enemy"; q3("turns").value = curT.turns || 3; q3("count").value = curT.count || 1; q3("need").value = curT.need || 1;
        q3("soak").value = (curT.soak && curT.soak.mult) != null ? curT.soak.mult : 0.5; q3("fail").value = (curT.fail && curT.fail.mult) || 4; q3("then").value = curT.then || "repeat";
      }
      tbn.onclick = () => { te.hidden = !te.hidden; };
      const applyT = (cfg) => {
        let r;
        try { r = dispatch({ type: "battle.panel", action: "setTower", actor: u.id, cfg }); } catch (e) { flashHint(e.message); return; }
        ((r && r.notes) || []).forEach(t => appendLog(t));
        setView(snapAll(), false);
        refreshAll();
        renderFieldSheet();
      };
      const int = (k, lo, hi, d) => Math.max(lo, Math.min(hi, Math.floor(Number(q3(k).value) || d)));
      q3("go").onclick = () => applyT({
        phase: q3("phase").value, then: q3("then").value,
        turns: int("turns", 1, 20, 3), count: int("count", 1, 5, 1), need: int("need", 1, 4, 1),
        soak: Math.max(0, Math.min(20, Number(q3("soak").value) || 0)),
        fail: Math.max(0.5, Math.min(50, Number(q3("fail").value) || 4))
      });
      if (q3("off")) q3("off").onclick = () => applyT(null);
    });
    const sel = $("g-enemy-sel");
    if (!sel.options.length) {
      sel.innerHTML = enemyPresets().filter(p => p.id !== "blank_pc" && p.id !== "ufo_leg").map(p =>
        `<option value="${p.id}">${esc(p.name)}</option>`
      ).join("");
    }
    const zbox = $("g-field-zones");
    zbox.innerHTML = "";
    const kinds = [
      ["", "无"], ["fireOn", "火场"], ["ice", "冻土"], ["acid", "酸液"], ["quicksand", "流沙"], ["coral", "沙珊瑚台地"],
      ["electric", "高压"], ["energy", "能量场"], ["harmonic", "干涉场"],
      ["heal", "恢复"], ["abyss", "深渊"], ["collapseOn", "塌陷"],
      ["ruinOn", "损毁地面"], ["isolate", "隔离区"]   // 规则层本来就支持（app.js · tickRuinGround、隔离区不吃天气），以前选不到
    ];
    for (let z = 1; z <= Number(state.zoneMode); z++) {
      const f = state.fields[z] || emptyField();
      const row = el("div", "sheet-slot");
      const cur = kinds.find(k => k[0] && f[k[0]]) || kinds[0];
      row.innerHTML = `<div><b>${z} 区场地</b></div>`;
      const s = el("select", "");
      kinds.forEach(k => {
        const o = document.createElement("option");
        o.value = k[0]; o.textContent = k[1];
        if (k[0] === cur[0]) o.selected = true;
        s.appendChild(o);
      });
      s.onchange = () => {
        dispatch({ type: "battle.panel", action: "setField", zone: z, kind: s.value });
        setView(snapAll(), false);
        refreshAll();
        renderFieldSheet();   // 选了损毁地面要马上出现耐久输入框
      };
      row.appendChild(s);
      // 高地和其他区域效果共存：单独一个勾选框
      const hl = el("label", "");
      hl.style.cssText = "display:inline-flex;align-items:center;gap:4px;margin-left:8px;font-size:13px";
      const hc = document.createElement("input");
      hc.type = "checkbox"; hc.checked = !!f.highland;
      hc.onchange = () => {
        dispatch({ type: "battle.panel", action: "setHighland", zone: z, value: hc.checked });
        setView(snapAll(), false);
        refreshAll();
      };
      hl.appendChild(hc); hl.appendChild(document.createTextNode("高地"));
      row.appendChild(hl);
      if (f.ruinOn) {
        // 损毁地面的耐久（坍塌前还能撑多少）
        const rl = el("label", "");
        rl.style.cssText = "display:inline-flex;align-items:center;gap:4px;margin-left:8px;font-size:13px";
        const ri = document.createElement("input");
        ri.type = "number"; ri.min = "1"; ri.style.width = "64px"; ri.value = Number(f.ruinHp) || 30;
        ri.dataset.ruinZone = String(z);
        ri.onchange = () => {
          dispatch({ type: "battle.panel", action: "ruinHp", zone: z, hp: Number(ri.value) || 1 });
          setView(snapAll(), false);
          refreshAll();
        };
        rl.appendChild(document.createTextNode("耐久")); rl.appendChild(ri);
        row.appendChild(rl);
      }
      zbox.appendChild(row);
    }
    const gbox = $("g-gap-list");
    if (gbox) {
      gbox.innerHTML = "";
      const keys = boardGapKeys();
      dispatch({ type: "battle.panel", action: "normalizeGaps" });
      keys.forEach(key => {
        const g = state.gaps[key];
        const row = el("div", "sheet-slot");
        row.innerHTML = `<div><b>间隙 ${key.replace("-", "↔")}</b><div class="sub">${gapStatusText(g)}</div></div>`;
        const s = el("select", "");
        ["open", "bridge", "wall", "door", "void"].forEach(t => {
          const o = document.createElement("option");
          o.value = t; o.textContent = gapLabel(t);
          if (g.type === t) o.selected = true;
          s.appendChild(o);
        });
        s.onchange = () => {
          dispatch({ type: "battle.panel", action: "setGap", key, kind: s.value });
          paintGaps();
          renderFieldSheet();
        };
        row.appendChild(s);
        // 危墙 / 桥梁的耐久：主持人自行调整（危墙按手册 1～15，「随机」重掷一次）
        if (g.type === "wall" || g.type === "bridge") {
          const hp = el("input", "");
          hp.type = "number"; hp.min = "1"; hp.value = String(g.hp || 1); hp.style.width = "64px";
          hp.title = g.type === "wall" ? "危墙耐久（手册 1～15）" : "桥梁耐久";
          hp.onchange = () => { dispatch({ type: "battle.panel", action: "gapHp", key, hp: Number(hp.value) || 1 }); paintGaps(); renderFieldSheet(); };
          row.appendChild(hp);
          if (g.type === "wall") {
            const rnd = el("button", "g-btn", "随机");
            rnd.title = "重掷 1～15";
            rnd.onclick = () => { dispatch({ type: "battle.panel", action: "rollWall", key }); paintGaps(); renderFieldSheet(); };
            row.appendChild(rnd);
          }
        }
        if (g.type === "door") {
          const tog = el("button", "g-btn", g.open ? "关门" : "开门");
          tog.onclick = () => { dispatch({ type: "battle.panel", action: "toggleDoor", key }); paintGaps(); renderFieldSheet(); };
          row.appendChild(tog);
        }
        gbox.appendChild(row);
      });
    }
    const pbox = $("g-prop-list");
    if (pbox) {
      pbox.innerHTML = "";
      const list = state.props || [];
      if (!list.length) pbox.innerHTML = '<p class="sheet-empty">场上没有配置物。</p>';
      list.forEach(p => {
        const row = el("div", "sheet-slot");
        row.innerHTML = `<div><b>${esc(p.name)}</b><div class="sub">${p.zone} 区 · ${p.hp}/${p.maxHp || p.hp} · ${p.faction === "enemy" ? "敌" : "我"}</div></div>`;
        const rm = el("button", "g-btn", "移出");
        rm.onclick = () => {
          dispatch({ type: "battle.panel", action: "removeProp", id: p.id });
          setView(snapAll(), false);
          refreshAll();
          renderFieldSheet();
        };
        row.appendChild(rm);
        pbox.appendChild(row);
      });
    }
    renderTemplateList();
    renderDrops();
  }
  /* ---------- 战斗掉落：主持人设好，打赢才进背包 ---------- */
  function renderDrops() {
    const box = $("g-drop-list"); if (!box) return;
    const d = state.battleDrops || { kuizhi: 0, items: [] };
    $("g-drop-kz").value = String(d.kuizhi || 0);
    box.innerHTML = (d.items || []).length ? "" : '<p class="sheet-empty">没有设物品掉落。</p>';
    (d.items || []).forEach((x, i) => {
      const row = el("div", "sheet-slot");
      row.innerHTML = `<div><b>${esc((ITEM_CATALOG[x.id] || {}).name || x.id)}</b><div class="sub">× ${x.qty}</div></div>`;
      const rm = el("button", "g-btn", "去掉");
      rm.onclick = () => setDrops({ kuizhi: d.kuizhi, items: d.items.filter((_, j) => j !== i) });
      row.appendChild(rm); box.appendChild(row);
    });
  }
  function setDrops(drops) {
    try { dispatch({ type: "battle.panel", action: "setDrops", drops }); } catch (e) { flashHint(e.message); }
    renderDrops();
  }

  /* ---------- 战斗模板（battle-templates.js）：存当前战场 / 套用 ---------- */
  function renderTemplateList() {
    const box = $("g-tpl-list");
    if (!box || typeof battleTemplateList !== "function") return;
    box.innerHTML = "";
    const list = battleTemplateList();
    if (!list.length) box.innerHTML = '<p class="sheet-empty">还没有模板。摆好战场后在上面起个名字存下来。</p>';
    list.forEach(t => {
      const row = el("div", "sheet-slot");
      row.innerHTML = `<div><b>${esc(t.name)}</b><div class="sub">${esc(battleTemplateSummary(t))}</div></div>`;
      const use = el("button", "g-btn", "套用");
      use.title = "按这个模板重新摆战场（战斗开始前才能换）";
      use.onclick = () => applyTemplate(t);
      const over = el("button", "g-btn", "覆盖");
      over.title = "用现在的战场覆盖这个模板";
      over.onclick = () => {
        if (!confirm(`用现在的战场覆盖模板「${t.name}」？`)) return;
        // 援军、连续战斗在场上看不出来：沿用模板里的
        try { battleTemplateSave(Object.assign(battleTemplateCapture(t.name), { id: t.id, note: t.note, waves: t.waves, chain: t.chain })); flashHint("已覆盖模板「" + t.name + "」"); }
        catch (e) { flashHint(e.message); }
        renderTemplateList();
      };
      const del = el("button", "g-btn", "删除");
      del.onclick = () => { if (confirm(`删除模板「${t.name}」？`)) { battleTemplateDelete(t.id); renderTemplateList(); } };
      row.appendChild(use); row.appendChild(over); row.appendChild(del);
      box.appendChild(row);
    });
  }
  function applyTemplate(t) {
    if (state.combatStarted && !G.ended) { flashHint("战斗已经开始，不能换战场"); return; }
    try { setupBattle(Number($("g-level").value) || 1, battleTemplateToEncounter(t)); }
    catch (e) { flashHint(e.message); return; }
    $("g-field-sheet").classList.remove("show");
    flashHint("已按模板「" + t.name + "」摆好战场");
  }

  /* ================= 12. 输入 ================= */

  function bindInput() {
    // Esc 关掉最上层的游戏面板（背包 / 队伍配置 / 战场配置 / 后台……）。
    // 捕获阶段处理：联机主持人页面的面板、聊天框会拦掉冒泡的按键。
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const open = [...document.querySelectorAll(".sheet.show")];
      const top = open[open.length - 1];
      if (!top || !/^g-/.test(top.id)) return;   // 角色资料、武器工坊等自己处理 Esc
      e.preventDefault(); e.stopPropagation();
      const close = top.querySelector(".sheet-head button[id$='-close']");
      if (close) close.click();
      else top.classList.remove("show");
      if (top.id === "g-bs-sheet") G.bsOpen = false;
    }, true);
    document.addEventListener("keydown", (e) => {
      // 只在战斗界面响应（标题、任务板等界面不能误触结束回合）
      if (document.body.dataset.screen && document.body.dataset.screen !== "battle") return;
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.target && e.target.closest(".hs-ui")) return;
      if (hotseat() && HotseatGame.hasAsk()) return;
      if (choiceResolve) {
        if (e.key === "Escape") { e.preventDefault(); choiceResolve.cancel(); }
        const n = Number(e.key);
        if (n >= 1 && n <= choiceKeys.length) { e.preventDefault(); choiceKeys[n - 1](); }
        return;
      }
      if (G.depth > 0) {
        if (e.key === " " || e.key === "Escape") { e.preventDefault(); G.skip = true; }
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); disarm(); return; }
      if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doUndo(); return; }
      if (e.key === " ") {
        // 用键盘把焦点移到按钮、链接等可以操作的东西上时，空格是「按下它」，不是结束行动；
        // 鼠标点过的按钮也会留着焦点，那不算（不然点完撤销再按空格会又撤销一次）
        if (e.target && e.target.closest && e.target.closest(SPACE_SAFE) && kbdFocus(e.target)) return;
        e.preventDefault(); spaceStartOrEnd(); return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const list = [...document.querySelectorAll("#g-party .pc")].map(b => unitById(b.dataset.id)).filter(Boolean);
        if (!list.length) return;
        const i = list.findIndex(u => u.id === G.actorId);
        selectActor(list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length].id);
        return;
      }
      if (e.key === "f" || e.key === "F") { toggleFast(); return; }
      const n = Number(e.key);
      if ((e.key === "q" || e.key === "Q") && G.summonShown && !$("g-summon").disabled && !$("g-summon").hidden) { e.preventDefault(); armSkill(G.summonShown); return; }
      if (n >= 1 && n <= 9 && G.skillsShown && G.skillsShown[n - 1]) {
        e.preventDefault();
        armSkill(G.skillsShown[n - 1]);
      }
    });
    document.addEventListener("contextmenu", (e) => {
      if (G.arm) { e.preventDefault(); disarm(); }
    });
    // 触屏：不用选目标的技能点了一下正在预演，点别的地方就取消（再点同一个技能按钮才放出去）
    document.addEventListener("click", (e) => {
      if (!G.skillTap) return;
      const b = e.target && e.target.closest ? e.target.closest("#g-skills .sk") : null;
      if (b && b.dataset.skill === G.skillTap.skillId) return;
      cancelSkillTap();
    }, true);
    $("g-field").addEventListener("click", (e) => {
      if (G.depth > 0) { G.skip = true; return; }
      const zone = e.target.closest(".g-zone");
      if (pickZoneByClick(zone)) return;
      // 触屏：点战场空白处取消正在选的技能
      if (G.arm && touchUI() && !e.target.closest(".unit-wrap, .g-gap")) { disarm(); return; }
      if (!G.arm && !e.target.closest(".unit-wrap") && touchUI()) idleBox();
    });
    document.querySelectorAll(".g-zone").forEach(z => {
      z.addEventListener("mouseenter", () => {
        if (!(G.arm && G.arm.mode === "zone" && G.arm.zones.has(Number(z.dataset.num)))) return;
        z.classList.add("is-move-hover");
        const pv = G.arm.previewFn(Number(z.dataset.num));
        showPreview(pv, `移动到 ${z.dataset.num} 区`);
      });
      z.addEventListener("mouseleave", () => {
        z.classList.remove("is-move-hover");
        if (G.arm && G.arm.mode === "zone") clearPreview();
      });
    });
    // 手机：战斗记录收在抽屉里；操作栏的高度写进 --hud-h，战场底部留出这么多空
    if ($("g-log-open")) $("g-log-open").onclick = () => $("g-app").classList.toggle("log-open");
    if ($("g-log-close")) $("g-log-close").onclick = () => $("g-app").classList.remove("log-open");
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        document.documentElement.style.setProperty("--hud-h", $("g-app").querySelector(".g-hud").offsetHeight + "px");
      }).observe($("g-app").querySelector(".g-hud"));
    }
    $("g-endturn").onclick = clickStartOrEnd;
    if ($("g-start")) $("g-start").onclick = clickStartOrEnd;
    $("g-bag").onclick = () => { renderBagSheet(); $("g-bag-sheet").classList.add("show"); };
    $("g-bag-close").onclick = () => $("g-bag-sheet").classList.remove("show");
    const readAmt = (id) => Math.max(0, Math.floor(Number($(id).value) || 0));
    $("g-kz-add").onclick = () => { const n = readAmt("g-kz-in"); if (!n) return; panelCommit({ action: "currency", amount: n }); $("g-kz-in").value = ""; renderBagSheet(); };
    $("g-kz-sub").onclick = () => { const n = readAmt("g-kz-in"); if (!n) return; panelCommit({ action: "currency", amount: -n }); $("g-kz-in").value = ""; renderBagSheet(); };
    $("g-water-add").onclick = () => { const n = readAmt("g-water-in"); if (!n) return; panelCommit({ action: "water", amount: n }); $("g-water-in").value = ""; renderBagSheet(); };
    $("g-water-sub").onclick = () => { const n = readAmt("g-water-in"); if (!n) return; panelCommit({ action: "water", amount: -n }); $("g-water-in").value = ""; renderBagSheet(); };
    $("g-item-add").onclick = () => { const id = $("g-item-add-sel").value; if (!id) return; panelCommit({ action: "bagAdd", item: id, amount: 1 }); renderBagSheet(); };

    $("g-rest").onclick = () => { renderRestSheet(); $("g-rest-sheet").classList.add("show"); };
    $("g-rest-close").onclick = () => $("g-rest-sheet").classList.remove("show");
    document.querySelectorAll("#g-rest-sheet [data-advance]").forEach(b => {
      b.onclick = () => { panelCommit({ action: "advance", hours: Number(b.dataset.advance) }); renderRestSheet(); };
    });
    $("g-short-all").onclick = () => { panelCommit({ action: "shortRest", kits: null }); renderRestSheet(); };
    $("g-long-hours").onchange = renderRestSheet;
    $("g-long-force").onchange = renderRestSheet;
    $("g-long-go").onclick = () => {
      const r = panelCommit({ action: "longRest", plan: currentRestPlan() });
      renderRestSheet();
      if (r && r.report && window.RestReport) RestReport.show(r.report, { gm: !(typeof shpHidden === "function" && shpHidden()) });
    };
    $("g-restore-all").onclick = () => { panelCommit({ action: "restore" }); renderRestSheet(); };
    $("g-cheat").onclick = () => {
      dispatch({ type: "battle.panel", action: "cheat" }).notes.forEach(s => appendLog(s));
      rememberCampaign();
      renderBagSheet();
      flashHint("已刷入 1000 奎支和每种道具 ×3。");
    };
    $("g-save").onclick = () => { renderSaveSheet(); $("g-save-sheet").classList.add("show"); };
    $("g-save-close").onclick = () => $("g-save-sheet").classList.remove("show");
    $("g-stats").onclick = () => { G.statsFromResult = false; openStats(); };
    // 结算面板上的「战场数据」：先收起结算面板，关掉数据表时再回到结算面板
    $("g-review-stats").onclick = () => {
      $("g-result").classList.remove("show");
      G.statsFromResult = true;
      openStats();
    };
    if ($("g-stats-merge")) $("g-stats-merge").onclick = () => { G.statsMerge = !G.statsMerge; openStats(); };   // 角色和自己的武器人并成一行看
    $("g-stats-close").onclick = () => {
      $("g-stats-sheet").classList.remove("show");
      if (G.statsFromResult && G.ended) $("g-result").classList.add("show");
      G.statsFromResult = false;
    };
    $("g-stats-copy").onclick = (e) => {
      const btn = e.currentTarget;
      copyText(statsText(), ok => { const t = btn.textContent; btn.textContent = ok ? "已复制" : "复制失败"; setTimeout(() => { btn.textContent = t; }, 1200); });
    };
    $("g-party-cfg").onclick = () => { renderPartySheet(); $("g-party-sheet").classList.add("show"); };
    $("g-party-close").onclick = () => $("g-party-sheet").classList.remove("show");
    $("g-party-add").onclick = () => {
      const kit = $("g-party-add-sel").value;
      if (!kit) return;
      addPartyKit(kit, $("g-party-add-zone").value);
      renderPartySheet();
    };
    $("g-party-backstage").onclick = () => openBackstage();
    $("g-bs").onclick = () => openBackstage();
    // 音效开关 + 后台里的试听
    const sfxBtn = $("g-sfx");
    const paintSfx = () => { if (sfxBtn && window.Sfx) { sfxBtn.textContent = Sfx.enabled() ? "音效 开" : "音效 关"; sfxBtn.setAttribute("aria-pressed", String(Sfx.enabled())); } };
    if (sfxBtn) sfxBtn.onclick = () => { if (!window.Sfx) return; Sfx.setEnabled(!Sfx.enabled()); paintSfx(); if (Sfx.enabled()) Sfx.play("physical"); };
    paintSfx();
    const pv = $("g-sfx-preview");
    if (pv && window.Sfx) {
      pv.innerHTML = "试听音效：" + Sfx.ELEMENTS.map(e => `<button class="g-btn small e-${e}" data-sfx="${e}">${Sfx.NAMES[e]}</button>`).join("") +
        `<button class="g-btn small" data-sfx="parry">格挡成功</button><button class="g-btn small" data-sfx="stagger">打出失衡</button><button class="g-btn small" data-sfx="boom">高能自爆</button>`;
      pv.querySelectorAll("[data-sfx]").forEach(b => { b.onclick = (ev) => Sfx.play(b.dataset.sfx, { big: ev.shiftKey }); });
    }
    $("g-bs-close").onclick = () => { $("g-bs-sheet").classList.remove("show"); G.bsOpen = false; };
    $("g-field-cfg").onclick = () => { renderFieldSheet(); $("g-field-sheet").classList.add("show"); };
    $("g-enc-cfg").onclick = () => { renderEncSheet(); $("g-enc-sheet").classList.add("show"); };
    $("g-enc-close").onclick = () => $("g-enc-sheet").classList.remove("show");
    $("g-enc-roll").onclick = () => {
      if (typeof rollEncounter !== "function") { flashHint("遭遇系统未加载"); return; }
      const spec = dispatch({ type: "battle.panel", action: "rollEncounter", region: $("g-enc-region").value, faction: $("g-enc-faction").value || null }).value;
      $("g-enc-preview").textContent = encSummary(spec);
      startEncounter(spec);
    };
    $("g-enc-boss").onclick = () => {
      if (typeof rollBossEncounter !== "function") { flashHint("遭遇系统未加载"); return; }
      const region = $("g-enc-region").value;
      const bosses = Object.keys(ENEMY_INFO || {}).filter(k => ENEMY_INFO[k].boss && ENEMY_INFO[k].regions.indexOf(region) >= 0);
      if (!bosses.length) { flashHint(region + " 没有首领"); return; }
      const spec = dispatch({ type: "battle.panel", action: "rollBossEncounter", region }).value;
      $("g-enc-preview").textContent = encSummary(spec);
      startEncounter(spec);
    };
    $("g-field-close").onclick = () => $("g-field-sheet").classList.remove("show");
    if ($("g-drop-sel")) {
      $("g-drop-sel").innerHTML = Object.keys(ITEM_CATALOG).map(id => `<option value="${esc(id)}">${esc(ITEM_CATALOG[id].name || id)}</option>`).join("");
      const cur = () => state.battleDrops || { kuizhi: 0, items: [] };
      $("g-drop-kz").onchange = () => setDrops({ kuizhi: Number($("g-drop-kz").value) || 0, items: cur().items || [] });
      $("g-drop-add").onclick = () => {
        const id = $("g-drop-sel").value, qty = Math.max(1, Number($("g-drop-qty").value) || 1), items = (cur().items || []).slice();
        const same = items.find(x => x.id === id); if (same) same.qty += qty; else items.push({ id, qty });
        setDrops({ kuizhi: Number($("g-drop-kz").value) || 0, items });
      };
    }
    if ($("g-tpl-save")) $("g-tpl-save").onclick = () => {
      if (typeof battleTemplateCapture !== "function") return;
      const name = ($("g-tpl-name").value || "").trim();
      if (!name) { flashHint("先给模板起个名字"); $("g-tpl-name").focus(); return; }
      try { battleTemplateSave(battleTemplateCapture(name)); } catch (e) { flashHint(e.message); return; }
      $("g-tpl-name").value = "";
      renderTemplateList();
      flashHint("已存为模板「" + name + "」");
    };
    $("g-cfg-zones").onchange = () => {
      const v = $("g-cfg-zones").value;
      dispatch({ type: "battle.panel", action: "setZones", value: /^\d+$/.test(v) ? Number(v) : v });
      const zm = document.getElementById("zoneMode");
      if (zm) zm.value = String(state.zoneMode);
      syncFieldDom();
      setView(snapAll(), false);
      refreshAll();
      renderFieldSheet();
    };
    $("g-cfg-ps").onchange = () => {
      /* 仅作显示；添加敌人时按场上玩家人数重算 */
      dispatch({ type: "battle.panel", action: "setPartySize", value: Number($("g-cfg-ps").value) || 2 });
    };
    $("g-cfg-weather").onchange = () => {
      dispatch({ type: "battle.panel", action: "setWeather", value: $("g-cfg-weather").value, persist: true });
      if ($("g-weather-sel")) $("g-weather-sel").value = state.weather;
      setView(snapAll(), false);
      refreshAll();
    };
    $("g-prop-add").onclick = () => {
      const kind = $("g-prop-kind").value;
      const zone = Number($("g-prop-zone").value) || 1;
      const lv = Number($("g-prop-lv").value) || 1;
      dispatch({ type: "battle.panel", action: "addProp", kind, zone, level: lv, faction: $("g-prop-fac").value || "player" });
      setView(snapAll(), false);
      refreshAll();
      renderFieldSheet();
    };
    $("g-enemy-add").onclick = () => {
      const id = $("g-enemy-sel").value;
      const lv = Number($("g-enemy-lv").value) || 1;
      const zone = Number($("g-enemy-zone").value) || 2;
      dispatch({ type: "battle.panel", action: "addEnemy", preset: id, level: lv, zone });
      setView(snapAll(), false);
      refreshAll();
      renderFieldSheet();
    };
    $("g-fast").onclick = toggleFast;
    $("g-copy-turn").onclick = (e) => copyBattleLog("page", e.currentTarget);
    $("g-copy-all").onclick = (e) => copyBattleLog("all", e.currentTarget);
    $("g-weather-sel").onchange = () => {
      if (G.depth > 0) return;
      dispatch({ type: "battle.panel", action: "setWeather", value: $("g-weather-sel").value || "none", persist: false });
      applyEnv(snapEnv());
      addLogPhase("天气改为 " + (WEATHER_NAME[state.weather] || state.weather));
    };
    // 角鳞星地图：跑团看队伍的位置，单局看这一幕的区域，战斗原型看这场遭遇的区域
    $("g-map").onclick = () => {
      if (!window.WorldMap) return;
      let o = null;
      if (typeof TRPG !== "undefined" && TRPG.active && window.TrpgFlow && TrpgFlow.mapOptions) o = TrpgFlow.mapOptions();
      else if (typeof Rogue !== "undefined" && Rogue.inRunMode && Rogue.inRunMode() && window.RunFlow && RunFlow.mapOptions) o = RunFlow.mapOptions();
      if (!o) {
        const reg = G.lastEncounter && G.lastEncounter.region;
        o = { here: reg || null, sub: reg ? `战斗原型 · 这场遭遇在${reg}` : "战斗原型" };
      }
      WorldMap.open(o);
    };
    $("g-restart").onclick = () => { if (G.depth === 0) setupBattle(Number($("g-level").value) || 1, G.lastEncounter || null); };
    $("g-again").onclick = () => setupBattle(Number($("g-level").value) || 1, G.lastEncounter || null);
    $("g-retreat").onclick = askRetreat;
    $("g-undo").onclick = doUndo;
    $("g-rogue-next").onclick = () => {
      const r = G.rogue;
      if (!r || !G.ended) return;
      const outcome = G.lastOutcome;
      $("g-result").classList.remove("show");
      $("g-reopen").classList.remove("show");
      setRogueMode(null);
      systemCommand({ type: "battle.continue", outcome }, { continueBattle: r.onEnd });
    };
    $("g-review").onclick = reviewLog;
    $("g-reopen").onclick = () => $("g-result").classList.add("show");
    window.addEventListener("resize", () => { if (G.depth === 0) setView(snapAll(), false); else fitZones(); });
    // 下方选单变高 / 变矮时，战场高度跟着变，重新排一次
    if (window.ResizeObserver) new ResizeObserver(() => fitZones()).observe($("g-field"));
  }
  function toggleFast() {
    G.fast = !G.fast;
    $("g-fast").setAttribute("aria-pressed", G.fast ? "true" : "false");
    $("g-fast").textContent = G.fast ? "演出 2×" : "演出 1×";
  }

  BattleCommands.configure({ game: G, applyCampaignToField, undo: undoRules, writeSlot, loadSlot, clearSlot, rememberCampaign: rememberCampaignRules, loadCampaignMem: loadCampaignMemRules });

  /* ================= 启动 ================= */
  function boot() {
    bindInput();
    loadCampaignMem();
    setupBattle(1);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // 调试用
  G.previewOf = previewOf;
  G.candidateUnits = candidateUnits;
  G.skillThunk = skillThunk;
  G.snapAll = snapAll;
  G.setupBattle = setupBattle;
  G.startCustomBattle = startCustomBattle;
  G.startRogueBattle = startRogueBattle;
  // 联机单局：房主刷新页面后，把结算面板的「继续」重新接回单局（rogue-ui.js · battleEnd）
  G.resumeRogueBattle = (spec, onEnd) => setRogueMode({ spec, onEnd });
  G.playCheck = playBlockCheck;   // 单局事件的检定也用同一个动画
  G.rememberCampaign = rememberCampaign;
  G.doUndo = doUndo;
  G.loadCampaignMem = loadCampaignMem;
  G.showPendingIntro = () => { if (G.pendingIntro && !state.combatStarted) battleIntro(G.pendingIntro); };
  G.armSkill = armSkill;
  G.gameSkills = gameSkills;
  G.blockReason = blockReason;
  G.baseBlockReason = baseBlockReason;
  G.disarm = disarm;
  G.selectActor = selectActor;
  G.startOrEnd = clickStartOrEnd;
  G.resumeHotseat = resumeHotseat;
  G.aiPlan = aiPlan;
  G.aiStep = EnemyAI.step; G.aiTarget = EnemyAI.target; G.AI_SPEC = EnemyAI.SPEC; G.aiSpecial = EnemyAI.special;
  G.endTurn = endTurn;
  G.checkEnd = checkEnd;
  G.refresh = refreshAll;
  G.fitZones = fitZones;
  G.act = act;
  G.actSystem = (cmd, meta, context) => act(cmd, meta, context);
  G.actLegacy = fn => act(fn, { skillName: "主持人操作", onlineLegacy: true });
  G.resolveOnlineEdits = async () => {
    if (!window.OnlineGame?.isHost() || G.depth || G.ended) return;
    G.depth++; syncBusy();
    try { await resolveQueues(); }
    finally { G.depth--; G.version++; syncBusy(); autoSelect(true); refreshAll(); if (state.combatStarted) checkEnd(); resumeHotseat(); }
  };
  G.onlineCheckpoint = () => JSON.parse(JSON.stringify({ state, campaign: G.campaign, partyKits: G.partyKits, enemyPlan: G.enemyPlan,
    encounter: G.encounter || null, lastEncounter: G.lastEncounter, level: G.level, ended: G.ended, lastOutcome: G.lastOutcome, actorId: G.actorId,
    enemyCursor: G.onlineEnemyCursor || {}, ledger: typeof LEDGER === "undefined" ? null : LEDGER.save() }));
  G.restoreOnline = saved => {
    for (const key of Object.keys(state)) delete state[key]; Object.assign(state, deepClone(saved.state));
    Object.assign(G, { campaign: saved.campaign, partyKits: saved.partyKits, enemyPlan: saved.enemyPlan, encounter: saved.encounter || null, lastEncounter: saved.lastEncounter,
      level: saved.level, ended: saved.ended, lastOutcome: saved.lastOutcome, actorId: saved.actorId, onlineEnemyCursor: saved.enemyCursor || {}, depth: 0, tape: null, arm: null, undo: [] });
    if (saved.ledger) LEDGER.load(saved.ledger);
    G.version++; setView(snapAll(), false); refreshAll();
  };
  G.resumeOnline = async () => {
    if (!state.combatStarted || G.ended || G.depth) return;
    G.depth++; syncBusy();
    try {
      await resolveQueues();
      if (state.combatPhase === "enemy") {
        const over = await enemyPhase();
        if (!over) { await perform({ type: "battle.endEnemyTurn" }, { phase: "敌人回合结束 · 玩家回合开始" }, true); await resolveQueues(); if (window.Sfx) Sfx.ui("turn"); }
      }
      if (!G.ended && ["setup", "enemy"].includes(HotseatGame.getView().phase)) HotseatGame.beginRound();
    } finally { G.depth--; syncBusy(); autoSelect(true); refreshAll(); checkEnd(); resumeHotseat(); }
  };
})();
