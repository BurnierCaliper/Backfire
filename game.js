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
    if (G.tape) G.tape.push({ type: "log", text: String(text == null ? "" : text) });
    if (G.sim) return;
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
      element: spec.element || "physical",
      snap: G.sim ? null : snapAll()
    });
  };
  // 目标只认 state.targetId，不读计算器隐藏的下拉框
  window.skillTarget = () => unitById(state.targetId);
  window.skillTargetAny = () => unitById(state.targetId) || propByRef(state.targetId);
  window.selectedToken = () => state.targetId || "";

  /* ================= 2. 快照 ================= */
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
      dead: !!(u.dead || u._removed),
      weaponUnit: (typeof isWeaponUnit === "function") ? !!isWeaponUnit(u) : !!u.weaponOf,
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
      res,
      atk: Math.round(Number(atk) || 0),
      weapon: !!u.weaponOf
    };
  }
  const WEATHER_NAME = { none: "常态", heat: "酷暑", snow: "雪天", acid: "酸雨", thunder: "雷鸣", glow: "微光", sand: "沙暴", phase: "相位" };
  const FIELD_CLASSES = ["field-fire", "field-electric", "field-ice", "field-acid", "field-energy", "field-harmonic", "field-collapse", "field-abyss"];
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
      zones[z] = { cls, tags, threats, wind };
    }
    let weatherText = WEATHER_NAME[state.weather] || state.weather || "常态";
    if (state.weather === "phase") { try { weatherText += "·" + phaseWeatherName(state.phaseStep); } catch (e) {} }
    if (state.weather === "sand") { try { weatherText += "（风向 " + sandDirText(state.sandDir, state.zoneMode) + "）"; } catch (e) {} }
    if (state.weatherLock) weatherText += "（锁定）";
    return { weather: state.weather || "none", weatherText, zones };
  }
  function snapProp(p) {
    const max = Math.max(1, Number(p.maxHp) || Number(p.hp) || 1);
    const cur = Math.max(0, Number(p.hp) || 0);
    return {
      id: "prop:" + p.id,
      name: p.name,
      isPlayer: p.faction !== "enemy",
      isProp: true,
      zone: Number(p.zone) || 1,
      level: p.level || 1,
      atk: 0,
      layers: [{ type: "armor", max: max, cur: cur }],
      def: 0, defMax: 0, ap: 0, apMax: 0, bonus: 0, bonusMax: 0,
      status: (typeof propKindName === "function" ? propKindName(p.kind) : p.kind) + (p.kind === "door" ? "" : ""),
      res: p.kind === "battery" || p.kind === "turret" ? (p.faction === "enemy" ? "敌方" : "我方") : "",
      highEnergy: 0, flying: false, stunned: false, dying: false, dead: cur <= 0 && p.kind !== "button" && p.kind !== "lever",
      hidden: false
    };
  }
  function snapAll() {
    const arr = (state.units || []).map(snapUnit).concat((state.props || []).map(snapProp));
    arr.env = snapEnv();
    return arr;
  }
  function applyEnv(env) {
    if (!env) return;
    $("g-app").dataset.weather = env.weather;
    $("g-weather").textContent = "天气 " + env.weatherText;
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

  function simulate(thunk, diceMode) {
    const saved = saveState();
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
      const pop = hi.tape.find(e => e.type === "pop" && e.unitId === id && e.kind === "dmg");
      p.element = pop ? pop.element : "physical";
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
  function foes() { return state.units.filter(u => !u.isPlayer && unitAlive(u) && u.kit !== "ironwall"); }

  function gameSkills(u) {
    if (!u || !u.isPlayer) return [];
    if (u.dying && !isWeaponUnit(u)) {
      return [{ id: "__stand", name: "起身", hint: "hp 归零后可以选择起身。之后受伤扣坚毅生命（shp），shp 归零即永久死亡。", cost: {} }];
    }
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
    out.push({ id: "__item", name: "使用道具", hint: "从背包里选一件在战斗中使用。", cost: { bonus: 1 } });
    out.push({ id: "__move", name: "移动", hint: "移动到另一个区域。离开有借机攻击敌人的区域会被追打。", cost: { bonus: 1 } });
    return out;
  }

  function blockReason(u, sk) {
    if (G.ended) return "战斗已结束";
    if (!state.combatStarted) return "战斗尚未开始";
    if (state.combatPhase !== "player") return "敌人回合";
    if (!u || u.dead) return "已阵亡";
    if (sk.id === "__stand") return typeof standUpBlocked === "function" ? standUpBlocked(u) : null;
    if (sk.id === "__item" && typeof bagList === "function" && !bagList().some(x => x.combat)) return "没有能在战斗中使用的道具";
    if (u.stunned) return "失衡中，本回合无法行动";
    if ((sk.cost.ap || 0) > (u.ap || 0)) return "行动点不足";
    if ((sk.cost.bonus || 0) > (u.bonus || 0)) return "附赠行动不足";
    if (sk.id === "__move" && u.noMove) return "本回合无法移动";
    if (typeof skillRequirementError === "function") {
      const why = skillRequirementError(u, sk.id);
      if (why) return why;
    }
    return null;
  }

  function skillThunk(actorId, skillId, targetId, picks) {
    return function () {
      const a = unitById(actorId);
      state.attackerId = actorId;
      state.selectedId = actorId;
      state.targetId = targetId || null;
      if (skillId === "__move") { doMove(a, picks.dest); return; }
      if (skillId === "__stand") { standUp(a); return; }
      if (skillId === "__item") {
        const notes = useItemOn(a, picks.item, unitById(targetId), picks.dest);
        (notes || []).forEach(s => appendLog(s));
        if (a && (a.bonus || 0) > 0) a.bonus -= 1;
        return;
      }
      if (picks && Object.keys(picks).length) {
        state.skillFlow = { id: skillId, actorId, picks: Object.assign({}, picks), index: 99 };
      }
      try { runSkill(skillId); } finally { state.skillFlow = null; }
    };
  }

  function otherZones(z) {
    const out = [];
    for (let i = 1; i <= Number(state.zoneMode); i++) if (Math.abs(i - z) === 1) out.push(i);
    return out;
  }

  /* ================= 5. 画面 ================= */
  const cards = new Map();

  function zoneGroup(zone, isPlayer, isProp) {
    const z = document.querySelector(`.g-zone[data-num="${zone}"]`) || document.querySelector(".g-zone");
    if (!z) return document.querySelector(".g-zone");
    if (isProp) return z.querySelector(".grp.prop") || z.querySelector(".grp.player");
    return z.querySelector(isPlayer ? ".grp.player" : ".grp.enemy");
  }

  function createCard(s) {
    const wrap = el("div", "unit-wrap");
    wrap.dataset.id = s.id;
    const unit = el("div", "unit " + (s.isProp ? "prop " : "") + (s.isPlayer ? "player" : "foe"),
      `<div class="u-head"><span class="u-name"></span><span class="u-lv"></span><span class="u-atk"></span></div>
       <div class="u-hp"></div>
       <div class="u-hpline"><span class="hpn"></span><span class="shpn"></span></div>
       <div class="u-def"></div>
       <div class="u-foot"><div class="u-econ"></div><div class="u-status"></div></div>
       <div class="u-res"></div>
       <span class="u-flag stun">失衡</span><span class="u-flag dying">濒死</span><span class="u-flag downed">倒下</span>`);
    const flash = el("div", "flash");
    const tag = el("div", "pvtag");
    wrap.append(unit, flash, tag);
    const c = { id: s.id, wrap, unit, flash, tag, segs: [], pips: [], layersKey: "", prev: null };
    wrap.addEventListener("mouseenter", () => onCardHover(c.id, true));
    wrap.addEventListener("mouseleave", () => onCardHover(c.id, false));
    wrap.addEventListener("click", (e) => { e.stopPropagation(); onCardClick(c.id); });
    cards.set(s.id, c);
    return c;
  }

  function updateCard(c, s) {
    const q = (sel) => c.unit.querySelector(sel);
    q(".u-name").textContent = s.name;
    q(".u-lv").textContent = "Lv" + s.level;
    q(".u-atk").textContent = "ATK " + s.atk;

    // 分层血条：数组 0 是最外层，显示在最右
    const key = s.layers.map(l => l.type + ":" + l.max).join("|");
    const hp = q(".u-hp");
    if (key !== c.layersKey) {
      hp.innerHTML = "";
      c.segs = [];
      c.highBar = null;
      for (let i = s.layers.length - 1; i >= 0; i--) {
        const l = s.layers[i];
        const seg = el("div", "seg t-" + l.type, `<div class="ghost"></div><div class="fill"></div><div class="pv maybe"></div><div class="pv sure"></div><div class="pv heal"></div>`);
        seg.style.flex = `${Math.max(1, l.max)} 1 0`;
        seg.style.minWidth = "10px";
        seg.title = (LAYER[l.type] || l.type);
        hp.appendChild(seg);
        c.segs[i] = {
          el: seg, fill: seg.querySelector(".fill"), ghost: seg.querySelector(".ghost"),
          sure: seg.querySelector(".pv.sure"), maybe: seg.querySelector(".pv.maybe"), heal: seg.querySelector(".pv.heal")
        };
      }
      c.layersKey = key;
      c.prev = null;
    }
    s.layers.forEach((l, i) => {
      const sg = c.segs[i];
      if (!sg) return;
      const pct = l.max > 0 ? (l.cur / l.max) * 100 : 0;
      sg.fill.style.width = pct + "%";
      sg.ghost.style.width = pct + "%";
      const was = c.prev && c.prev.layers[i] ? c.prev.layers[i].cur : l.cur;
      if (was > 0 && l.cur === 0) { sg.el.classList.remove("crack"); void sg.el.offsetWidth; sg.el.classList.add("crack"); }
    });
    if (!c.highBar || c.highBar.parentElement !== hp) {
      c.highBar = el("div", "u-high");
      hp.appendChild(c.highBar);
    }
    {
      const tot = Math.max(1, sumMax(s));
      const he = Math.max(0, Number(s.highEnergy) || 0);
      c.highBar.style.width = (he > 0 ? Math.min(100, (he / tot) * 100) : 0) + "%";
      c.highBar.style.display = he > 0 ? "" : "none";
      c.highBar.title = he > 0 ? ("高能 " + he) : "";
    }
    q(".hpn").innerHTML = `<b>${sumCur(s)}</b>/${sumMax(s)}`;
    q(".shpn").textContent = s.upOnShp ? "起身" : "";

    // 架势
    const defBox = q(".u-def");
    const n = Math.max(s.defMax, s.def);
    if (c.pips.length !== n) {
      defBox.innerHTML = "";
      c.pips = [];
      for (let i = 0; i < n; i++) { const p = el("i", "pip"); defBox.appendChild(p); c.pips.push(p); }
    }
    const prevDef = c.prev ? c.prev.def : s.def;
    c.pips.forEach((p, i) => {
      p.classList.toggle("on", i < s.def);
      if (i >= s.def && i < prevDef) { p.classList.remove("shatter"); void p.offsetWidth; p.classList.add("shatter"); }
    });

    // 行动点 / 附赠
    const econ = q(".u-econ");
    {
      let h = "";
      for (let i = 0; i < Math.max(s.apMax, s.ap); i++) h += `<i class="econ-ap${i < s.ap ? " on" : ""}"></i>`;
      for (let i = 0; i < Math.max(s.bonusMax, s.bonus); i++) h += `<i class="econ-bonus${i < s.bonus ? " on" : ""}"></i>`;
      if (s.flying) h += `<span class="chip">飞</span>`;
      (s.hung || []).forEach(n => { h += `<span class="chip">${esc(n)}</span>`; });
      econ.innerHTML = h;
      econ.title = `行动点 ${s.ap}/${s.apMax} · 附赠 ${s.bonus}/${s.bonusMax}`;
    }

    // 高能和其他状态放在同一行、同一种样式（之前放在行动点那一行，字体大小不一样）
    const highChip = (s.highEnergy > 0 || (s.status && /高能/.test(s.status)))
      ? `<span class="chip">高能${s.highEnergy > 0 ? " " + s.highEnergy : ""}</span>` : "";
    q(".u-status").innerHTML = highChip + (s.status
      ? s.status.split(" · ").filter(t => t && t !== "无状态" && !/^高能/.test(t)).map(t => `<span class="chip">${esc(t)}</span>`).join("")
      : "");
    q(".u-res").textContent = s.res || "";
    q(".u-res").style.display = s.res ? "" : "none";

    c.wrap.classList.toggle("stunned", s.stunned && !s.dead);
    c.wrap.classList.toggle("dying", s.dying && !s.dead);
    c.wrap.classList.toggle("dead", s.dead && !s.isPlayer);
    c.wrap.classList.toggle("downed", s.dead && s.isPlayer);
    c.prev = s;
  }

  function placeCard(c, s, animate) {
    const grp = zoneGroup(s.zone, s.isPlayer, s.isProp);
    if (c.wrap.parentElement === grp) return;
    const first = c.wrap.isConnected ? c.wrap.getBoundingClientRect() : null;
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
      if (s.hidden) {
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
        if (healed > 0) beats.push({ kind: "heal", id, value: healed });
      }
      updateCard(c, s);
      placeCard(c, s, animate);
    });
    cards.forEach((c, id) => {
      if (!next.has(id)) { c.wrap.remove(); cards.delete(id); }
    });
    G.view = next;
    fitZones();
    return beats;
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
  function centerOf(id) {
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
    d.textContent = text;
    if (opts.below) {
      d.style.left = (p.x + 46) + "px";
      d.style.top = (p.y + 30) + "px";
    } else {
      d.style.left = (p.x + (n % 2 ? 22 : -22) * Math.min(n, 3) / 1.5) + "px";
      d.style.top = (p.y - n * 16) + "px";
    }
    if (opts.size) d.style.fontSize = opts.size + "px";
    d.style.setProperty("--dur", (opts.dur || 0.9) + "s");
    fx().appendChild(d);
    realTimeout(() => d.remove(), (opts.dur || 0.9) * 1000 + 60);
  }
  function stamp(id, text, cls) {
    const p = centerOf(id);
    if (!p) return;
    const d = el("div", "stamp " + (cls || ""));
    d.textContent = text;
    d.style.left = p.x + "px";
    d.style.top = (p.r.top + p.r.height / 2) + "px";
    fx().appendChild(d);
    realTimeout(() => d.remove(), 950);
  }
  const ELE_VAR = { fire: "--fire", acid: "--acid", electric: "--electric", ice: "--icee", energy: "--energy", physical: "--physical", harmonic: "--harmonic" };
  function hit(id, element) {
    const c = cards.get(id);
    if (!c) return;
    c.flash.style.setProperty("--flash", `var(${ELE_VAR[element] || "--physical"})`);
    c.wrap.classList.remove("hit");
    void c.wrap.offsetWidth;
    c.wrap.classList.add("hit");
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
      if (b.kind === "stun") { stamp(b.id, "失衡", b.ice ? "ice" : ""); longest = Math.max(longest, hold != null ? hold : 620); }
      if (b.kind === "kill") {
        stamp(b.id, s && s.isPlayer ? "倒下" : "击倒", "kill");
        longest = Math.max(longest, 520);
        if (s && s.isPlayer) fallen.push(s);
      }
      if (b.kind === "down") { stamp(b.id, "濒死", "kill"); longest = Math.max(longest, 520); }
      if (b.kind === "heal") { popup(b.id, "+" + b.value, "e-heal", { size: 22 }); longest = Math.max(longest, 300); }
    });
    if (longest) await wait(longest);
    for (const s of fallen) await announceDeath(s);
  }

  /** 玩家角色阵亡时弹一个提示框，需要确认才继续。角色会留在场上变灰。 */
  async function announceDeath(s) {
    if (G.ended) return;
    const who = s.weaponUnit ? "武器人" : "队伍成员";
    const left = players().filter(u => !isWeaponUnit(u) && !u.dead).length;
    const tail = s.weaponUnit
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

  async function playTape(tape, after, meta) {
    const pops = tape.filter(e => e.type === "pop");
    const stunId = newStunId(after, pops);
    if (meta.slow) {
      G.slow = 1.4;
      $("g-app").classList.add("hitstop");
    }
    if (meta.skillName || meta.actorId) banner(titleHtml(meta));
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
    const lungeAtk = !opps.length && (meta.forceLunge || (pops.length && meta.actorId && meta.targetId && meta.actorId !== meta.targetId));
    const motions = [];
    if (lungeAtk) motions.push(lunge(meta.actorId, meta.targetId));
    if (meta.blockerId) motions.push(lunge(meta.blockerId, meta.actorId));
    if (motions.length) await Promise.all(motions);
    const firstHit = pops.find(e => e.kind === "dmg" && Number(e.value) > 0);
    if (firstHit) hit(firstHit.unitId, firstHit.element);
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
    try {
      for (let i = 0; i < pops.length; i++) {
        const e = pops[i];
        const beatsBefore = e.snap ? setView(e.snap, true) : [];
        const s = G.view.get(e.unitId);
        const chain = chainAfter(i);
        if (e.kind === "dmg") {
          const v = Math.floor(Number(e.value) || 0);
          if (v <= 0) continue;
          const total = s ? Math.max(1, sumMax(s)) : 50;
          const big = v >= total * 0.2;
          hit(e.unitId, e.element);
          popup(e.unitId, big ? v + "!" : String(v), "e-" + e.element + (big ? " big" : ""), { size: big ? BIG_POP_SIZE : 30, dur: big ? BIG_POP_DUR : 1.05 });
          await wait(chain ? 30 : 45);
          await playBeats(beatsBefore.filter(b => b.kind !== "stun"));
          await wait(chain ? 40 : 55);
        } else if (e.kind === "break") {
          popup(e.unitId, "击破 " + e.value, "brk", { below: true, dur: 1.05 });
          await playBeats(beatsBefore.filter(b => b.kind !== "stun"));
          await wait(chain ? 40 : 55);
        } else {
          if (e.text) popup(e.unitId, e.text, "txt e-" + e.element);
          await playBeats(beatsBefore.filter(b => b.kind !== "stun"));
          await wait(240);
        }
      }
      const beats = setView(after, true);
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

  async function perform(thunk, meta) {
    meta = meta || {};
    G.skip = false;
    G.tape = [];
    try { thunk(); } catch (e) {
      console.error(e);
      G.tape.push({ type: "log", text: "结算出错：" + e.message });
    }
    const tape = G.tape;
    G.tape = null;
    const after = snapAll();
    await playTape(tape, after, meta);
    pushLog(meta, tape);
    refreshHud();
    return tape;
  }

  async function act(thunk, meta) {
    G.depth++;
    syncBusy();
    try {
      await perform(thunk, meta);
      await resolveQueues();
    } finally {
      G.depth--;
      G.version++;
      syncBusy();
      refreshAll();
      checkEnd();
    }
  }

  function syncBusy() {
    $("g-app").classList.toggle("busy", G.depth > 0);
    refreshHud();
  }

  /* ================= 7. 格挡与协助 ================= */
  function withPhaseOf(u, fn) {
    const prev = state.combatPhase;
    if (u && u.isPlayer) state.combatPhase = "player";
    if (u && !u.isPlayer) state.combatPhase = "enemy";
    try { fn(); } finally { state.combatPhase = prev; }
  }

  function playBlockCheck(spec) {
    return new Promise(resolve => {
      const box = $("g-check");
      const num = $("g-check-num");
      $("g-check-who").textContent = spec.who || "协助格挡";
      $("g-check-rate").textContent = "成功率 " + spec.chance + "%" + (spec.note ? " · " + spec.note : "");
      $("g-check-hint").textContent = "检定中";
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
        $("g-check-hint").textContent = spec.ok ? "格挡成功" : "格挡失败";
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
      if (G.ended) return;
      if (state.blockQueue && state.blockQueue.length) {
        const job = state.blockQueue[0];
        const attacker = unitById(job.attackerId), target = unitById(job.targetId);
        if (!attacker || !target) { state.blockQueue.shift(); continue; }
        const helpers = eligibleBlockers(target);
        let choice = null;
        if (helpers.length) choice = await promptBlock(job, attacker, target, helpers);
        const blocker = unitById(choice);
        let forced = null;
        if (blocker) {
          const chance = finalBlockChance(blocker, attacker, target);
          const iai = blocker.kit === "hiaki" && blocker.resources && blocker.resources.stance === "iai";
          const roll = 1 + Math.floor(Math.random() * 100);
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
        await perform(() => finishBlock(choice, forced), {
          actorId: attacker.id, targetId: target.id, forceLunge: true,
          blockerId: blocker && forced && forced.ok ? blocker.id : null,
          skillName: blocker ? `攻击（${blocker.name} 格挡）` : "攻击"
        });
        continue;
      }
      if (state.assistQueue && state.assistQueue.length) pruneAssistQueue();
      if (state.assistQueue && state.assistQueue.length) {
        const job = state.assistQueue[0];
        const target = unitById(job.targetId), breaker = unitById(job.breakerId);
        const list = target ? eligibleAssisters(breaker, target) : [];
        let choice = null;
        if (list.length) {
          choice = job.vsPlayer ? aiPickAssister(list) : await promptAssist(job, target, list);
        }
        const helper = unitById(choice);
        let extra = {};
        if (helper && helper.kit === "hiaki") {
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
            finishAssist(null);
            continue;
          }
          extra.blade = pick;
        }
        const bladeName = extra.blade === "naruto" ? "鳴門" : extra.blade === "niu" ? "丹生谷" : "";
        await perform(() => withPhaseOf(helper, () => finishAssist(choice, extra)), {
          actorId: choice, targetId: job.targetId, forceLunge: !!helper, slow: !!helper,
          skillName: helper ? ("协助攻击" + (bladeName ? " · " + bladeName : "")) : ""
        });
        continue;
      }
      if (state.koltSwapQueue && state.koltSwapQueue.length) {
        const job = state.koltSwapQueue[0];
        const k = unitById(job.actorId);
        if (!k) { state.koltSwapQueue.shift(); continue; }
        const foes = typeof koltMeleeSwapTargets === "function" ? koltMeleeSwapTargets(k) : [];
        const opts = [{ label: "不切换", value: { swap: false } }];
        if (!foes.length) opts.push({ label: "切换刀头", sub: "同区没有可打的敌人", value: { swap: true, targetId: null } });
        else foes.forEach(u => opts.push({ label: `切换并打 ${u.name}`, sub: "近距离 0.5 ATK", value: { swap: true, targetId: u.id } }));
        const pick = await openChoice("更换刀头", `${k.name} 可以更换刀头。切刀攻击只能打同区目标。`, opts, { label: "不切换", value: { swap: false } });
        resolveKoltSwap(!!(pick && pick.swap), pick && pick.targetId);
        continue;
      }
      return;
    }
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

  function promptBlock(job, attacker, target, helpers) {
    const noBlock = () => showPreview(previewOf(() => finishBlock(null)), `${attacker.name} → ${target.name}（不格挡）`);
    return openChoice(
      `${attacker.name} 攻击 ${target.name}`,
      "同区有附赠行动的队友可以协助格挡。成功免伤，但仍扣架势（最少留 1）。闪白部分是不格挡时会受到的伤害。",
      helpers.map(h => ({
        label: `${h.name} ${h.dying && !h.upOnShp ? "起身并格挡" : isUnarmed(h) ? "空手格挡" : "格挡"}`,
        sub: `成功率 ${finalBlockChance(h, attacker, target)}% · 消耗附赠行动${h.dying && !h.upOnShp ? " · 会先起身，之后受伤改打坚毅生命" : ""}`,
        value: h.id,
        onHover: noBlock
      })),
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
  function clearPreview() {
    cards.forEach(c => {
      c.segs.forEach(sg => { if (!sg) return; sg.sure.style.width = sg.maybe.style.width = sg.heal.style.width = "0"; });
      c.pips.forEach(p => p.classList.remove("pv", "maybe"));
      c.wrap.classList.remove("pv-stun", "maybe", "ice");
      c.tag.classList.remove("show");
    });
    if (!G.arm) idleBox();
  }

  function showPreview(pv, title) {
    clearPreview();
    pv.units.forEach((p, id) => {
      const c = cards.get(id);
      if (!c || !p.changed) return;
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
      if (p.stunSure || p.stunMaybe) {
        c.wrap.classList.add("pv-stun");
        if (p.stunMaybe) c.wrap.classList.add("maybe");
        if (p.ice) c.wrap.classList.add("ice");
      }
      let h = "";
      if (p.dmgHi > 0) h += `<span class="dmg e-${p.element}">${p.dmgLo === p.dmgHi ? p.dmgHi : p.dmgLo + "–" + p.dmgHi}</span>`;
      if (p.healHi > 0) h += `<span class="heal">+${p.healHi}</span>`;
      if (p.shpLoss > 0) h += `<span class="note">坚毅 −${p.shpLoss}</span>`;
      if (p.brHi > 0) h += `<span class="brk">击破 ${p.brLo === p.brHi ? p.brHi : p.brLo + "–" + p.brHi}</span>`;
      if (p.stunSure) h += `<span class="stun${p.ice ? " ice" : ""}">失衡${p.ice ? "·冰冻" : ""}</span>`;
      if (p.stunMaybe) h += `<span class="stun${p.ice ? " ice" : ""}">可能失衡</span>`;
      if (p.killSure) h += `<span class="kill">击倒</span>`;
      if (p.killMaybe) h += `<span class="kill">可能击倒</span>`;
      if (p.zoneTo != null) h += `<span class="note">→ ${p.zoneTo} 区</span>`;
      if (p.newStatus.length) h += `<span class="note">+${esc(p.newStatus.join(" "))}</span>`;
      if (h) {
        c.tag.innerHTML = h;
        const fieldTop = $("g-field").getBoundingClientRect().top;
        c.tag.classList.toggle("below", c.wrap.getBoundingClientRect().top - fieldTop < 52);
        c.tag.classList.add("show");
      }
    });
    const box = $("g-pvbox");
    const lines = pv.lines.filter(t => !COST_LINE.test(t)).slice(0, 18);
    box.innerHTML = `<h4>${esc(title || "预览")}</h4>` +
      (pv.meaningful ? "" : `<div class="ln key">${esc(pv.reason)}</div>`) +
      lines.map(t => `<div class="ln${/→|失衡|击倒|合计/.test(t) ? " key" : ""}">${colorLine(t)}</div>`).join("") +
      `<div class="ln">骰子按最小 / 最大各预演一次；格挡等判定按失败预演。</div>`;
  }

  function idleBox() {
    const a = unitById(G.actorId);
    $("g-pvbox").innerHTML = `<h4>${a ? esc(a.name) : "选择角色"}</h4>
      <div class="ln">${a && a.note ? esc(a.note) : ""}</div>
      <div class="ln">点技能或按数字键，把鼠标移到目标上预览伤害与击破。左键出手，右键或 Esc 取消。</div>
      <div class="ln">闪白＝会被打掉的血量与架势；金光＝这一下会造成失衡；蓝光＝冰属性击破造成失衡（冰冻）。</div>`;
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
  function predictTurn(id) {
    const key = `${G.version}|${state.turnNo}|${id}`;
    if (G.predict && G.predict.key === key) return G.predict.steps;
    const saved = saveState();
    const rnd = Math.random, st = window.setTimeout, outerTape = G.tape;
    G.sim = true; G.tape = [];
    state.history = [];
    window.setTimeout = () => 0;
    Math.random = makeRng("predict:" + key);
    const steps = [];
    try {
      endPlayerTurn();
      const drain = () => {
        for (let g = 0; g < 20 && state.blockQueue && state.blockQueue.length; g++) finishBlock(null);
        state.assistQueue = []; state.koltSwapQueue = [];
      };
      drain();
      for (const uid of EnemyAI.actingOrder()) {
        for (let n = 0; n < 5; n++) {
          const u = unitById(uid);
          if (!u || !unitAlive(u) || u.stunned || (u.ap || 0) <= 0) {
            if (uid === id && n === 0) steps.push(u && u.stunned ? "失衡中，这回合动不了" : "这回合不会行动");
            break;
          }
          const plan = EnemyAI.planFor(u, n);
          if (!plan) { if (uid === id && n === 0) steps.push("这回合不会行动"); break; }
          if (uid === id) steps.push(describeIntent(plan.meta));
          const sig = `${u.ap}|${u.bonus}|${u.zone}`;
          try { plan.thunk(); } catch (e) { break; }
          drain();
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
    return `<div class="ln intent"><b>环境监测 · 预测</b>：${steps.map(esc).join(" → ")}</div>
      <div class="ln intent-note">局势不变它就会这么做；你移动、击杀或改变局势后它会重新判断。</div>`;
  }

  function unitInfoBox(id) {
    const s = G.view.get(id);
    if (!s) return;
    const layers = s.layers.map(l => `${LAYER[l.type] || l.type} ${l.cur}/${l.max}`).reverse().join("　");
    $("g-pvbox").innerHTML = `<h4>${esc(s.name)} · Lv${s.level}</h4>
      <div class="ln key">${esc(layers)}</div>
      <div class="ln">架势 ${s.def}/${s.defMax} · ATK ${s.atk} · ${s.zone} 区</div>
      <div class="ln">${esc(s.status || "无状态")}</div>
      ${s.res ? `<div class="ln">${esc(s.res)}</div>` : ""}
      ${intentHtml(id)}
      <div class="ln">血条最右边是最外层，先被打掉。</div>`;
  }

  function markTargets(ids) {
    cards.forEach((c, id) => {
      const ok = ids.has(id);
      c.wrap.classList.toggle("is-targetable", ok);
      c.wrap.classList.toggle("is-dim", !ok && id !== G.actorId);
    });
  }
  function unmarkTargets() {
    cards.forEach(c => c.wrap.classList.remove("is-targetable", "is-dim", "is-hover"));
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
  function pickUnit(candidates, labelFn) {
    return new Promise(resolve => {
      const map = new Map(candidates.map(c => [c.id, c]));
      G.arm = Object.assign(G.arm || {}, {
        mode: "unit",
        map,
        labelFn,
        resolve: (id) => { unmarkTargets(); clearPreview(); G.arm.mode = null; resolve(id); },
        reject: () => { unmarkTargets(); resolve(null); }
      });
      markTargets(new Set([...map.keys()].filter(id => !map.get(id).invalid)));
      refreshHud();
    });
  }

  function pickZone(zones, previewFn) {
    return new Promise(resolve => {
      G.arm = Object.assign(G.arm || {}, {
        mode: "zone",
        zones: new Set(zones),
        previewFn,
        resolve: (z) => { unmarkTargets(); clearPreview(); G.arm.mode = null; resolve(z); },
        reject: () => { unmarkTargets(); resolve(null); }
      });
      document.querySelectorAll(".g-zone").forEach(z => z.classList.toggle("is-move-target", zones.includes(Number(z.dataset.num))));
      refreshHud();
    });
  }

  function onCardHover(id, on) {
    const c = cards.get(id);
    if (!c) return;
    c.wrap.classList.toggle("is-hover", on && !!(G.arm && G.arm.mode === "unit" && G.arm.map.has(id)));
    if (G.depth > 0 || choiceResolve) return;
    if (G.arm && G.arm.mode === "unit") {
      if (!on) { clearPreview(); return; }
      const cand = G.arm.map.get(id);
      if (!cand) return;
      if (!cand.preview && cand.thunk) cand.preview = previewOf(cand.thunk);
      if (cand.preview) showPreview(cand.preview, G.arm.labelFn ? G.arm.labelFn(id) : "");
      return;
    }
    if (!G.arm) { if (on) unitInfoBox(id); else idleBox(); }
  }

  function onCardClick(id) {
    if (G.depth > 0) { G.skip = true; return; }
    if (choiceResolve) return;
    if (G.arm && G.arm.mode === "unit") {
      const cand = G.arm.map.get(id);
      if (!cand) return;
      if (cand.preview && !cand.preview.meaningful && cand.invalidOk !== true) {
        flashHint(`无法对 ${unitById(id).name} 使用：${cand.preview.reason}`);
        return;
      }
      G.arm.resolve(id);
      return;
    }
    const u = unitById(id);
    if (u && u.isPlayer && !G.arm) selectActor(id);
  }

  function candidateUnits(actor, sk) {
    const hint = (sk.hint || "") + " " + (sk.name || "");
    const side = (typeof SKILL_TARGET_SIDE !== "undefined" && SKILL_TARGET_SIDE[sk.id]) ||
      (/任意单位|拉到|磁力/.test(hint) ? "any" : /友方|队友/.test(hint) ? "ally" : "enemy");
    let all = state.units.filter(u => unitAlive(u) && (u.id !== actor.id || side === "allySelf"));
    if (side === "ally" || side === "allySelf") all = all.filter(u => u.isPlayer);
    else if (side === "enemy") all = all.filter(u => !u.isPlayer);
    // 写明了射程（engine.js · SKILL_RANGE）的技能以表为准，不从提示文字里猜
    const ov = typeof SKILL_RANGE !== "undefined" ? SKILL_RANGE[sk.id] : null;
    if (ov) {
      all = all.filter(u => { const d = zoneDist(actor.zone, u.zone, state.zoneMode); return d >= ov.min && d <= ov.max; });
    } else if (typeof inSkillRange === "function") {
      all = all.filter(u => inSkillRange(actor, u, hint, state.zoneMode));
    }
    if (side !== "ally" && side !== "allySelf") {
      (state.props || []).forEach(p => {
        const fake = { id: "prop:" + p.id, name: p.name, zone: p.zone, isPlayer: p.faction !== "enemy" };
        if (!inSkillRange || inSkillRange(actor, fake, hint, state.zoneMode)) all.push(fake);
      });
    }
    return all;
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
    const label = (id) => `${actor.name} · ${sk.name}${id ? " → " + (unitById(id) || {}).name : ""}`;

    if (sk.id === "__stand") {
      G.arm = null;
      return act(skillThunk(actor.id, "__stand"), { actorId: actor.id, skillName: "起身" });
    }
    if (sk.id === "__item") {
      const items = (typeof bagList === "function" ? bagList() : []).filter(x => x.combat);
      if (!items.length) { cancel(); flashHint("背包里没有能在战斗中使用的道具。"); return; }
      setHint("<b>使用道具</b>：选择一件。");
      const itemId = await openChoice("使用道具", "背包", items.map(x => ({
        label: x.name + " ×" + x.qty, sub: x.hint, value: x.id
      })), { label: "取消", value: null });
      if (stale()) return;
      if (!itemId) { cancel(); return; }
      const spec = ITEM_CATALOG[itemId];
      let targetId = null, dest = null;
      if (spec && spec.target === "ally") {
        const cands = players().map(u => ({ id: u.id, invalidOk: true }));
        setHint("<b>" + spec.name + "</b>：选择友方。");
        targetId = await pickUnit(cands, (id) => spec.name + " → " + ((unitById(id) || {}).name || ""));
        if (stale()) return;
        if (!targetId) { cancel(); return; }
      } else if (spec && spec.target === "zone") {
        dest = await pickZone([1, 2, 3].filter(z => z <= Number(state.zoneMode)), () => null);
        if (stale()) return;
        if (dest == null) { cancel(); return; }
      }
      G.arm = null;
      return act(skillThunk(actor.id, "__item", targetId, { item: itemId, dest }), { actorId: actor.id, targetId, skillName: spec ? spec.name : "使用道具" });
    }
    if (sk.id === "__move") {
      const zones = otherZones(Number(actor.zone));
      const z = zones;
      setHint(`<b>移动</b>：点目标区域。离开有借机攻击敌人的区域时，闪白是会被追打的伤害。`);
      const dest = await pickZone(z, (zone) => previewOf(skillThunk(actor.id, "__move", null, { dest: zone })));
      if (stale()) return;
      if (dest == null) { cancel(); return; }
      G.arm = null;
      return act(skillThunk(actor.id, "__move", null, { dest }), { actorId: actor.id, skillName: `移动到 ${dest} 区` });
    }

    // 分步选择（计算器里的 skillFlowSteps）
    const picks = {};
    let lastUnitPick = null;
    for (let guard = 0; guard < 8; guard++) {
      let steps = [];
      try { steps = skillFlowSteps(sk.id, actor, picks) || []; } catch (e) { steps = []; }
      const step = steps.find(s => picks[s.key] === undefined);
      if (!step) break;
      const isLast = steps.every(s => s.key === step.key || picks[s.key] !== undefined);
      let value = null;
      if (step.type === "zone") {
        setHint(`<b>${esc(sk.name)}</b>：${esc(step.label)}`);
        value = await pickZone(step.zones || [], (zone) => previewOf(skillThunk(actor.id, sk.id, lastUnitPick, Object.assign({}, picks, { [step.key]: zone }))));
      } else if (step.type === "unit" && !step.optional && (step.units || []).every(u => !String(u.id).startsWith("prop:"))) {
        setHint(`<b>${esc(sk.name)}</b>：${esc(step.label)}`);
        const cands = (step.units || []).map(u => ({
          id: u.id,
          thunk: isLast ? skillThunk(actor.id, sk.id, u.id, Object.assign({}, picks, { [step.key]: u.id })) : null
        }));
        value = await pickUnit(cands, label);
        lastUnitPick = value;
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
      return act(skillThunk(actor.id, sk.id, lastUnitPick, picks), { actorId: actor.id, targetId: lastUnitPick, skillName: sk.name });
    }
    setHint(`<b>${esc(sk.name)}</b>：${esc(sk.hint || "选择目标")}　<span style="color:var(--faint)">右键取消</span>`);
    const cands = candidateUnits(actor, sk).map(u => {
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
    return act(skillThunk(actor.id, sk.id, target, picks), { actorId: actor.id, targetId: target, skillName: sk.name });
  }

  /* ================= 9. 敌人 AI ================= */
  // 决策逻辑在 ai.js（与无界面模拟共用），这里只负责按顺序演出
  const aiPlan = EnemyAI.plan;
  const aiPickAssister = EnemyAI.pickAssister;

  async function enemyPhase() {
    const order = EnemyAI.actingOrder();
    for (const id of order) {
      for (let n = 0; n < 5; n++) {
        const u = unitById(id);
        if (!u || !unitAlive(u) || u.stunned || (u.ap || 0) <= 0) break;
        const plan = EnemyAI.planFor(u, n);
        if (!plan) break;
        const sig = `${u.ap}|${u.bonus}|${u.zone}`;
        await perform(plan.thunk, plan.meta);
        await resolveQueues();
        if (checkEnd()) return true;
        const v = unitById(id);
        if (!v || `${v.ap}|${v.bonus}|${v.zone}` === sig) break;
        await wait(450);
      }
      await wait(450);
    }
    return false;
  }

  /* ================= 10. 回合流程 ================= */
  async function clickStartOrEnd() {
    if (G.depth > 0 || G.ended || choiceResolve) return;
    if (!state.combatStarted) {
      await askOpeningChoices();
      startCombat();
      phaseCard("战斗开始", "player");
      autoSelect(true);
      refreshAll();
      return;
    }
    endTurn();
  }

  /* ---------- 撤退（规则见 app.js · performRetreat，按主持人手册第七章） ---------- */
  function canRetreat() {
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
    await act(() => { performRetreat(guardId); });
    if (!G.ended) finish(false, "retreat");
  }
  const sumHp = (u) => (u.layers || []).reduce((a, l) => a + Math.max(0, Number(l.current) || 0), 0);

  /** 开战前的选择。柯尔特可以自行决定初始刀头（不算「更换刀头」，不触发追击伤害）。 */
  async function askOpeningChoices() {
    const k = typeof findKit === "function" ? findKit("kolt", state.units) : null;
    if (!k || !k.isPlayer) return;
    k.resources = k.resources || {};
    const pick = await openChoice(
      "柯尔特 · 初始刀头",
      "进入战斗时可以自行决定装哪个刀头。这不算「更换刀头」，不会触发追击伤害。",
      [
        { label: "电钻（电 · 近距离）", value: "drill" },
        { label: "酸液炮（酸 · 远距离）", value: "acid" }
      ],
      { label: "保持电钻", value: "drill" }
    );
    k.resources.bit = pick === "acid" ? "acid" : "drill";
    addLogPhase(`柯尔特 初始刀头：${k.resources.bit === "acid" ? "酸液炮（远距离）" : "电钻（近距离）"}`);
  }

  async function endTurn() {
    if (G.depth > 0 || G.ended || !state.combatStarted || state.combatPhase !== "player" || choiceResolve) return;
    const leftover = players().some(u => !u.dying && (u.ap || 0) > 0);
    if (leftover && G.apWarnTurn !== state.turnNo) {
      G.apWarnTurn = state.turnNo;
      const ans = await openChoice("结束回合", "你还有没有使用的行动点，确定结束回合吗？", [
        { label: "确定结束", value: "yes" },
        { label: "继续行动", value: "no" }
      ], { label: "取消", value: "no" });
      if (ans !== "yes") return;
    }
    disarm();
    G.depth++;
    syncBusy();
    try {
      await perform(() => endPlayerTurn(), {});
      refreshTop();
      phaseCard("敌人回合", "enemy");
      await wait(750);
      const over = await enemyPhase();
      if (!over && !G.ended) {
        await wait(250);
        await perform(() => endEnemyTurn(), { skillName: "" });
        await resolveQueues();
        if (!checkEnd()) {
          phaseCard(`第 ${state.turnNo} 回合`, "player");
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

  function checkEnd() {
    if (G.ended) return true;
    if (!state.units || !state.units.length) return false;
    const heroes = state.units.filter(u => u.isPlayer && !u.hidden && !u.dead && !isWeaponUnit(u));
    const standing = heroes.filter(u => !u.dying);
    if (!foes().length) return finish(true);
    if (!standing.length) return finish(false);
    return false;
  }
  /** outcome：win / lose / retreat */
  function finish(win, outcome) {
    G.ended = true;
    G.lastOutcome = outcome || (win ? "win" : "lose");
    disarm();
    refreshTop();
    const box = $("g-result");
    const retreated = G.lastOutcome === "retreat";
    box.querySelector("h2").textContent = retreated ? "撤退" : win ? "胜利" : "全员倒地";
    box.querySelector("h2").className = win ? "win" : "lose";
    const ups = [];
    state.units.filter(u => u.isPlayer && !isWeaponUnit(u)).forEach(u => {
      const from = u.level;
      if (typeof tryLevelUp === "function" && tryLevelUp(u) && u.level > from) ups.push(`${u.name} ${from}→${u.level}`);
    });
    // 跑团版的队伍档案只在战斗原型里结算；Roguelike 由单局流程自己记
    if (!G.rogue) {
      const durNotes = typeof ledgerAfterBattle === "function" ? ledgerAfterBattle([]) : [];
      rememberCampaign();
      durNotes.forEach(t => addLogPhase(t));
    }
    const loot = `背包现有 ${Number(state.kuizhi) || 0} 奎支`;
    const lvline = ups.length ? "升级：" + ups.join("、") + "。" : "";
    box.querySelector("p").textContent = retreated
      ? `第 ${state.turnNo} 回合撤出战斗。${loot}。${lvline}`
      : win
        ? `第 ${state.turnNo} 回合结束。${loot}。${lvline}`
        : `队伍倒地。${loot}。${lvline}`;
    // 结算面板晚一点弹出，先让最后一击的大伤害数字和击倒演出放完
    const token = G.endToken = {};
    realTimeout(() => {
      if (!G.ended || G.endToken !== token) return;
      box.classList.add("show");
      $("g-reopen").classList.add("show");
    }, G.instant ? 0 : Math.round(BIG_POP_DUR * 1000) + 500);
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
    G.lastEncounter = spec;
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
    BattleSim.setup(spec);
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
    ["ice", "冻土", "#8fdcff"], ["energy", "能量场", "#fff08a"], ["harmonic", "干涉场地", "#c07bff"],
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
    lines.push({ text: zm === 3 ? "三区制" : "两区制", color: "#6cc4ff" });
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
    let enc = typeof encounter === "string"
      ? (typeof encounterById === "function" ? encounterById(encounter) : null)
      : (encounter || null);
    if (enc) {
      try { enc = JSON.parse(JSON.stringify(enc)); } catch (e) {}
      if (typeof applyEncounterLayout === "function") applyEncounterLayout(enc);
    }
    G.encounter = enc;
    if (enc) G.lastEncounter = enc;
    const encTitle = enc && enc.name
      ? (enc.name + (typeof layoutLabel === "function" && enc.layout ? " · " + layoutLabel(enc.layout) : ""))
      : "外城区巷战";
    if ($("g-enc-name")) $("g-enc-name").textContent = "遭遇 " + encTitle;
    setRogueMode(null);
    resetBattleView();
    G.level = level;

    state.units = [];
    state.props = [];
    state.fields = { 1: emptyField(), 2: emptyField(), 3: emptyField() };
    state.gaps = { "1-2": emptyGap(), "2-3": emptyGap() };
    state.zoneMode = Number(G.zoneMode) || 2;
    state.partySize = 2;
    state.weather = G.weather || "none";
    if (typeof rollSandDir === "function") rollSandDir();
    if ($("g-weather-sel")) $("g-weather-sel").value = state.weather;
    syncFieldDom();
    state.weatherLock = null;
    state.phaseStep = 0;
    state.assistQueue = [];
    state.blockQueue = [];
    state.skillFlow = null;
    state.history = [];
    state.actionAcc = null;
    state.statusDmg = {};
    state.turnNo = 1;
    state.logPages = [{ turn: 1, lines: [] }];
    state.logIndex = 0;
    state.combatPhase = "player";
    state.combatStarted = false;
    state.exhaustTier = 0;
    state.retreated = false;
    state.lootByRank = null;

    loadLiveParty();
    if (enc && enc.playerZone) {
      state.units.forEach(u => {
        if (u.isPlayer && !u.hidden) u.zone = Number(enc.playerZone);
      });
    }
    if (typeof randomizeNoraMood === "function") randomizeNoraMood();
    applyCampaignToField();
    state.units.forEach(u => { if (typeof resetBattleFlags === "function") resetBattleFlags(u); });
    // 队伍档案要放在最后：resetBattleFlags 会把血量补满、清掉濒死、让角色重新持武器，
    // 档案里保存的血量 / 坚毅 / 濒死 / 耐久要盖在它之后才能留住
    if (typeof ledgerApplyToField === "function") {
      const lnotes = [];
      ledgerApplyToField(lnotes);
      lnotes.forEach(t => addLogPhase(t));
    }
    const partyN = typeof syncPartySizeFromField === "function" ? syncPartySizeFromField() : liveHeroCount();
    // 单局状态：把上一场保留下来的血量、坚毅、耐久盖回去
    if (typeof RUN !== "undefined" && RUN.active) RUN.apply();
    if (enc && typeof buildEncounter === "function") {
      buildEncounter(enc, level, partyN);
      if ($("g-weather-sel")) $("g-weather-sel").value = state.weather;
      syncFieldDom();
      setView(snapAll(), false);
      addLogPhase(`${enc.name} · 敌人 Lv${level} · ${partyN} 人队 · 点「开始战斗」结算回合开始效果`);
      autoSelect(true);
      refreshAll();
      idleBox();
      battleIntro(enc.tier);
      return;
    }
    const presets = enemyPresets();
    const plan = (G.enemyPlan && G.enemyPlan.length) ? G.enemyPlan : [
      { id: "thug_knife", lv: level, zone: 2 },
      { id: "thug_hammer", lv: level, zone: 2 },
      { id: "bandit_boss", lv: level, zone: 2 }
    ];
    plan.forEach(row => {
      const pack = typeof spawnEnemyGroup === "function"
        ? spawnEnemyGroup(row.id, Number(row.lv) || level, partyN, row.zone)
        : null;
      if (pack && pack.length) {
        pack.forEach(u => state.units.push(u));
        return;
      }
      const p = presets.find(x => x.id === row.id);
      if (!p || !p.build) return;
      const u = p.build(Number(row.lv) || level, partyN);
      u.zone = Math.min(Number(state.zoneMode), Number(row.zone) || Number(state.zoneMode));
      state.units.push(u);
    });
    setView(snapAll(), false);
    addLogPhase(`外城区巷战 · 敌人 Lv${level} · 点「开始战斗」结算回合开始效果`);
    autoSelect(true);
    refreshAll();
    idleBox();
    battleIntro("normal");
  }

  /* ================= 11. HUD / 记录 ================= */
  function selectActor(id) {
    if (G.arm) disarm();
    G.actorId = id;
    refreshHud();
    idleBox();
  }

  function autoSelect(force) {
    const cur = unitById(G.actorId);
    const able = (u) => u && u.isPlayer && unitAlive(u) && !u.stunned && ((u.ap || 0) > 0 || (u.bonus || 0) > 0 || u.dying);
    if (!force && able(cur)) return;
    const list = players().filter(u => !isWeaponUnit(u)).concat(players().filter(u => isWeaponUnit(u)));
    const next = list.find(able) || list[0];
    if (next) G.actorId = next.id;
  }

  function refreshTop() {
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
  }

  function refreshHud() {
    refreshTop();
    // 队伍
    const party = $("g-party");
    party.innerHTML = "";
    const all = state.units.filter(u => u.isPlayer && !u.hidden && !u.fused && !u._removed);
    const heroes = all.filter(u => !isWeaponUnit(u));
    const ordered = [];
    heroes.forEach(h => {
      ordered.push(h);
      all.filter(w => isWeaponUnit(w) && (w.weaponOf === h.kit || (h.linkedKits || []).includes(w.kit))).forEach(w => { if (!ordered.includes(w)) ordered.push(w); });
    });
    all.forEach(u => { if (!ordered.includes(u)) ordered.push(u); });
    ordered.forEach((u, i) => {
      const s = snapUnit(u);
      const b = el("button", "pc" + (isWeaponUnit(u) ? " weapon" : "") + (s.dead ? " downed" : "") +
        (u.id === G.actorId ? " on" : "") + ((s.ap + s.bonus === 0 && !s.dying) || s.stunned ? " off" : ""));
      const pct = sumMax(s) ? (sumCur(s) / sumMax(s)) * 100 : 0;
      let econ = "";
      for (let k = 0; k < Math.max(s.apMax, s.ap); k++) econ += `<i class="econ-ap${k < s.ap ? " on" : ""}"></i>`;
      for (let k = 0; k < Math.max(s.bonusMax, s.bonus); k++) econ += `<i class="econ-bonus${k < s.bonus ? " on" : ""}"></i>`;
      b.innerHTML = `<span class="n"><span>${esc(u.name)}</span><span class="k">${i < 9 ? "" : ""}</span></span>
        <div class="mini"><i style="width:${pct}%"></i></div>
        <div class="u-econ">${s.dead ? '<span style="font-size:11px;color:#9d9081">倒下</span>' : econ}${!s.dead && s.stunned ? '<span style="font-size:11px;color:var(--gold)">失衡</span>' : ""}${!s.dead && s.dying ? '<span style="font-size:11px;color:var(--foe)">濒死</span>' : ""}</div>`;
      b.dataset.id = u.id;
      b.onclick = () => { if (G.depth === 0 && !choiceResolve && !u.dead) selectActor(u.id); };
      party.appendChild(b);
    });
    cards.forEach((c, id) => c.wrap.classList.toggle("is-actor", id === G.actorId && state.combatPhase === "player"));

    // 技能
    const box = $("g-skills");
    box.innerHTML = "";
    const actor = unitById(G.actorId);
    const list = gameSkills(actor);
    list.forEach((sk, i) => {
      const why = blockReason(actor, sk);
      const b = el("button", "sk" + (G.arm && G.arm.skillId === sk.id ? " armed" : ""));
      const cost = [];
      if (sk.cost.ap) cost.push(`<span class="ap">行动 ${sk.cost.ap}</span>`);
      if (sk.cost.bonus) cost.push(`<span class="bn">附赠 ${sk.cost.bonus}</span>`);
      if (!cost.length) cost.push("不耗行动");
      b.innerHTML = `<span class="key">${i < 9 ? i + 1 : ""}</span><span class="nm">${esc(sk.name)}</span><span class="cost">${cost.join(" ")}</span>`;
      if (why) { b.disabled = true; b.title = why; }
      b.onclick = () => armSkill(sk);
      b.onmouseenter = () => {
        if (G.arm || G.depth > 0) return;
        setHint(`<b>${esc(sk.name)}</b>　${esc(sk.hint || "")}${why ? `　<span style="color:var(--foe)">${esc(why)}</span>` : ""}`);
      };
      b.onmouseleave = () => { if (!G.arm) setHint(""); };
      box.appendChild(b);
    });
    G.skillsShown = list;

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
    if (!G.arm && G.depth === 0 && !$("g-hint").dataset.flash) setHint(defaultHint());
  }

  function defaultHint() {
    const a = unitById(G.actorId);
    if (G.ended) return "";
    if (!state.combatStarted) return "摆好队伍和敌人后，点「开始战斗」。回合开始效果会在此时结算。";
    if (state.combatPhase !== "player") return "敌人行动中。点击战场可以跳过演出。";
    if (!a) return "选择一名角色。";
    if (a.stunned) return `<b>${esc(a.name)}</b> 失衡中，本回合无法行动。Tab 切换角色。`;
    return `<b>${esc(a.name)}</b>　选择技能。Tab 切换角色，空格结束回合。`;
  }
  function setHint(html) { $("g-hint").innerHTML = html; }
  function flashHint(text) {
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

  function refreshAll() {
    if (G.depth === 0) setView(snapAll(), true);
    refreshHud();
  }

  function addLogPhase(text) {
    const d = el("div", "lg phase", `<div class="t">${esc(text)}</div>`);
    $("g-logs").appendChild(d);
    $("g-logs").scrollTop = 1e9;
  }

  function pushLog(meta, tape) {
    const lines = logLines(tape).filter(t => t.trim());
    if (!lines.length) return;
    if (lines.some(t => /等待协助格挡选择/.test(t)) && !tape.some(e => e.type === "pop")) return;
    const phaseLine = lines.find(t => /^—— /.test(t));
    if (phaseLine && !meta.actorId) {
      const ph = [...new Set(lines.filter(t => /^—— /.test(t)).map(t => t.replace(/——/g, "").trim()))];
      addLogPhase(ph.join("　"));
      return;
    }
    const d = el("div", "lg");
    const key = lines.filter(t => /→|失衡|击倒|死亡|濒死|起身|协助|格挡|借机|移动|区 →/.test(t) && !COST_LINE.test(t)).slice(0, 5);
    // 本行动合计（含感电、高压场地等连带伤害）单独一行，不占上面的名额
    const sum = lines.find(t => /^本行动合计/.test(t.trim()));
    d.innerHTML = `<div class="t">${meta.actorId ? titleHtml(meta) : "结算"}</div>` +
      key.map(t => `<div class="s${/失衡|击倒|死亡|濒死/.test(t) ? " warn" : ""}">${colorLine(t.trim())}</div>`).join("") +
      (sum ? `<div class="s sum">${colorLine(sum.trim())}</div>` : "") +
      `<details><summary>完整计算</summary><pre>${lines.map(colorLine).join("\n")}</pre></details>`;
    $("g-logs").appendChild(d);
    $("g-logs").scrollTop = 1e9;
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
      roles: u.roles || null
    };
  }

  function rememberCampaign() {
    const party = state.units.filter(u => u.isPlayer && !isWeaponUnit(u)).map(packHero);
    G.campaign = {
      party,
      kuizhi: Number(state.kuizhi) || 0,
      items: JSON.parse(JSON.stringify((ensureBag().items) || [])),
      ledger: typeof LEDGER !== "undefined" ? LEDGER.save() : null
    };
    try { localStorage.setItem(CAMP_KEY, JSON.stringify(G.campaign)); } catch (e) {}
  }

  function loadCampaignMem() {
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
      if (typeof applyLevelStats === "function") applyLevelStats(u);
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
  function loadSlot(i) {
    const slots = readSlots();
    const s = slots[i];
    if (!s || !s.campaign) return false;
    G.campaign = JSON.parse(JSON.stringify(s.campaign));
    if (typeof LEDGER !== "undefined") LEDGER.load(G.campaign.ledger);
    try { localStorage.setItem(CAMP_KEY, JSON.stringify(G.campaign)); } catch (e) {}
    setupBattle(Number($("g-level").value) || 1);
    return true;
  }
  function clearSlot(i) {
    const slots = readSlots();
    slots[i] = null;
    writeSlots(slots);
  }

  /** 档案有变动：存下来、刷新战场显示、写一行记录 */
  function ledgerCommit(notes) {
    rememberCampaign();
    (notes || []).forEach(t => addLogPhase(t));
    if (G.depth === 0) { setView(snapAll(), false); refreshAll(); }
  }
  function heroesForUse() {
    return (typeof partyHeroes === "function" ? partyHeroes() : []).filter(h => !h.dead);
  }

  function renderBagSheet() {
    ensureBag();
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
    minus.onclick = () => { bagAdd(id, -1); ledgerCommit([`背包：${spec.name} −1`]); renderBagSheet(); };
    const plus = el("button", "g-btn", "+");
    plus.onclick = () => { bagAdd(id, 1); ledgerCommit([`背包：${spec.name} +1`]); renderBagSheet(); };
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
      go.onclick = () => { ledgerCommit(ledgerHealItem(id, sel.value, [])); renderBagSheet(); };
      box.append(sel, go);
      return box;
    }
    if (id === "repair_kit") {
      const box = el("div", "ledger-use");
      const sel = document.createElement("select");
      heroesForUse().forEach(h => (h.linkedKits || []).forEach(k => {
        const o = document.createElement("option");
        o.value = k; o.textContent = `${weaponName(k)}（耐久 ${weaponDur(k)}/${weaponDurMax(k)}）`;
        sel.appendChild(o);
      }));
      const go = el("button", "g-btn", "修复");
      go.onclick = () => { ledgerCommit(ledgerRepair(sel.value, [])); renderBagSheet(); };
      box.append(sel, go);
      return box;
    }
    return null;
  }

  /* ---------- 休整 ---------- */
  G.restFood = G.restFood || {};
  function renderRestSheet() {
    const t = typeof exhaustTier === "function" ? exhaustTier() : 0;
    $("g-rest-time").innerHTML = `第 <b>${LEDGER.day}</b> 天 · 距上次长休 <b>${LEDGER.hours}</b> 小时 · ` +
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
      const sr = el("button", "g-btn", `短休（剩 ${shortRestLeft(h)}）`);
      sr.disabled = inFight || h.dead || shortRestLeft(h) <= 0;
      sr.onclick = () => { ledgerCommit(ledgerShortRest([h.kit], [])); renderRestSheet(); };
      act.append(fsel, sr);
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
    const bags = Math.min(bagCount("sleepbag"), partyHeroes().filter(h => !h.dead).length);
    const foodTxt = Object.keys(need.food).map(fid =>
      `${ITEM_CATALOG[fid].name} <b class="${bagCount(fid) < need.food[fid] ? "bad" : ""}">${need.food[fid]}</b>/${bagCount(fid)}`
    ).join(" · ");
    $("g-long-need").innerHTML =
      `水 <b class="${ledgerWater() < need.water ? "bad" : ""}">${need.water}</b>/${ledgerWater()} ml · ${foodTxt}` +
      (bags ? ` · 睡袋 ${bags} 个` : "");
    const force = $("g-long-force").checked;
    $("g-long-go").disabled = inFight || (!need.ok && !force);
    $("g-long-go").textContent = need.ok || force ? "长休" : "补给不足";
  }
  function currentRestPlan() {
    const food = {};
    partyHeroes().forEach(h => { food[h.kit] = G.restFood[h.kit] || defaultFoodFor(); });
    return { hours: Number($("g-long-hours").value) || 8, food, force: $("g-long-force").checked };
  }

  function renderSaveSheet() {
    const box = $("g-save-list");
    box.innerHTML = "";
    readSlots().forEach((s, i) => {
      const d = el("div", "sheet-slot");
      const when = s && s.at ? new Date(s.at).toLocaleString() : "空";
      d.innerHTML = `<div><b>存档 ${i + 1}</b><div class="sub">${s ? esc(s.label) + " · " + when : "空档"}</div></div>`;
      const save = el("button", "g-btn", "写入");
      save.onclick = () => { writeSlot(i); renderSaveSheet(); flashHint("已写入存档 " + (i + 1)); };
      const load = el("button", "g-btn", "读取");
      load.disabled = !s;
      load.onclick = () => { loadSlot(i); $("g-save-sheet").classList.remove("show"); flashHint("已读取存档 " + (i + 1)); };
      const wipe = el("button", "g-btn", "清除");
      wipe.disabled = !s;
      wipe.onclick = () => { clearSlot(i); renderSaveSheet(); };
      d.append(save, load, wipe);
      box.appendChild(d);
    });
  }

  function paintGaps() {
    document.querySelectorAll("#g-field .g-gap").forEach(node => {
      const key = node.dataset.key;
      if (!key) return;
      state.gaps = state.gaps || {};
      if (!state.gaps[key]) state.gaps[key] = emptyGap();
      const g = state.gaps[key];
      node.className = "g-gap gap-" + (g.type || "open");
      const hp = (g.type === "bridge" || g.type === "wall") ? (" " + (g.hp || 0)) : "";
      const door = g.type === "door" ? (g.open ? " 开" : " 关") : "";
      node.innerHTML = `<span class="gap-lab">${gapLabel(g.type)}${hp}${door}</span>`;
    });
  }

  function syncFieldDom() {
    const field = $("g-field");
    if (!field) return;
    const n = Number(state.zoneMode) || 2;
    field.className = "g-field z" + n;
    field.innerHTML = "";
    state.gaps = state.gaps || {};
    if (!state.gaps["1-2"]) state.gaps["1-2"] = emptyGap();
    if (n >= 3 && !state.gaps["2-3"]) state.gaps["2-3"] = emptyGap();
    for (let z = 1; z <= n; z++) {
      if (z > 1) {
        const key = gapKey(z - 1, z);
        const gap = el("div", "g-gap");
        gap.dataset.key = key;
        field.appendChild(gap);
      }
      const sec = el("section", "g-zone");
      sec.dataset.num = String(z);
      sec.innerHTML = `<span class="zlabel">${z} 区</span><div class="grp enemy"></div><div class="grp prop"></div><div class="grp player"></div>`;
      field.appendChild(sec);
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
    }
    (state.units || []).forEach(u => {
      if (Number(u.zone) > n) u.zone = n;
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
        state.units = state.units.filter(x => x.id !== u.id && x.weaponOf !== u.kit);
        G.partyKits = G.partyKits.filter(k => k !== u.kit);
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
    const card = livePartyCards().find(c => c.kit === kit);
    if (!card) return;
    const u = spawnLiveCard(card, Number(zone) || 1);
    u.weaponHeld = true;
    u.atk = (u.personalAtk || 0) + (u.weaponAtk || 0);
    if (typeof resetBattleFlags === "function") resetBattleFlags(u);
    if (typeof applyLevelStats === "function") applyLevelStats(u);
    state.units.push(u);
    if (G.partyKits.indexOf(kit) < 0) G.partyKits.push(kit);
    if (state.combatStarted && state.combatPhase === "player") {
      u.ap = u.apMax || 1;
      u.bonus = u.bonusMax || 1;
    }
    setView(snapAll(), false);
    refreshAll();
  }

  function renderFieldSheet() {
    $("g-cfg-zones").value = String(state.zoneMode || 2);
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
        state.units = state.units.filter(x => x.id !== u.id && x.ufoParent !== u.id);
        G.enemyPlan = (G.enemyPlan || []).filter(p => !(p.id === u.kit && Number(p.zone) === Number(u.zone)));
        setView(snapAll(), false);
        refreshAll();
        renderFieldSheet();
      };
      row.appendChild(rm);
      elist.appendChild(row);
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
      ["", "无"], ["fireOn", "火场"], ["ice", "冻土"], ["acid", "酸液"],
      ["electric", "高压"], ["energy", "能量场"], ["harmonic", "干涉场"],
      ["heal", "恢复"], ["abyss", "深渊"], ["highland", "高地"], ["collapseOn", "塌陷"]
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
        const nf = emptyField();
        if (s.value) nf[s.value] = s.value === "fireOn" || s.value === "collapseOn" ? true : true;
        if (s.value === "fireOn") nf.fire = 1;
        state.fields[z] = nf;
        setView(snapAll(), false);
        refreshAll();
      };
      row.appendChild(s);
      zbox.appendChild(row);
    }
    const gbox = $("g-gap-list");
    if (gbox) {
      gbox.innerHTML = "";
      const keys = Number(state.zoneMode) >= 3 ? ["1-2", "2-3"] : ["1-2"];
      keys.forEach(key => {
        state.gaps = state.gaps || {};
        if (!state.gaps[key]) state.gaps[key] = emptyGap();
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
          g.type = s.value;
          if (g.type === "bridge" || g.type === "wall") {
            if (!g.hp) { g.hp = defaultGapHp(g.type); g.maxHp = g.hp; }
          }
          if (g.type === "door") g.open = false;
          if (g.type === "open") { g.hp = 0; g.open = true; }
          paintGaps();
          renderFieldSheet();
        };
        row.appendChild(s);
        if (g.type === "door") {
          const tog = el("button", "g-btn", g.open ? "关门" : "开门");
          tog.onclick = () => { g.open = !g.open; paintGaps(); renderFieldSheet(); };
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
          state.props = state.props.filter(x => x.id !== p.id);
          setView(snapAll(), false);
          refreshAll();
          renderFieldSheet();
        };
        row.appendChild(rm);
        pbox.appendChild(row);
      });
    }
  }

  /* ================= 12. 输入 ================= */

  function bindInput() {
    document.addEventListener("keydown", (e) => {
      // 只在战斗界面响应（标题、任务板等界面不能误触结束回合）
      if (document.body.dataset.screen && document.body.dataset.screen !== "battle") return;
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
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
      if (e.key === "Escape" && $("g-bs-sheet").classList.contains("show")) {
        e.preventDefault(); $("g-bs-sheet").classList.remove("show"); G.bsOpen = false; return;
      }
      if (e.key === "Escape") { e.preventDefault(); disarm(); return; }
      if (e.key === " ") { e.preventDefault(); clickStartOrEnd(); return; }
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
      if (n >= 1 && n <= 9 && G.skillsShown && G.skillsShown[n - 1]) {
        e.preventDefault();
        armSkill(G.skillsShown[n - 1]);
      }
    });
    document.addEventListener("contextmenu", (e) => {
      if (G.arm) { e.preventDefault(); disarm(); }
    });
    $("g-field").addEventListener("click", (e) => {
      if (G.depth > 0) { G.skip = true; return; }
      const zone = e.target.closest(".g-zone");
      if (G.arm && G.arm.mode === "zone" && zone && G.arm.zones.has(Number(zone.dataset.num))) {
        G.arm.resolve(Number(zone.dataset.num));
      }
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
    $("g-endturn").onclick = clickStartOrEnd;
    if ($("g-start")) $("g-start").onclick = clickStartOrEnd;
    $("g-bag").onclick = () => { renderBagSheet(); $("g-bag-sheet").classList.add("show"); };
    $("g-bag-close").onclick = () => $("g-bag-sheet").classList.remove("show");
    const readAmt = (id) => Math.max(0, Math.floor(Number($(id).value) || 0));
    $("g-kz-add").onclick = () => { const n = readAmt("g-kz-in"); if (!n) return;
      state.kuizhi = (Number(state.kuizhi) || 0) + n; $("g-kz-in").value = "";
      ledgerCommit([`背包：奎支 +${n} → ${state.kuizhi}`]); renderBagSheet(); };
    $("g-kz-sub").onclick = () => { const n = readAmt("g-kz-in"); if (!n) return;
      state.kuizhi = Math.max(0, (Number(state.kuizhi) || 0) - n); $("g-kz-in").value = "";
      ledgerCommit([`背包：奎支 −${n} → ${state.kuizhi}`]); renderBagSheet(); };
    $("g-water-add").onclick = () => { const n = readAmt("g-water-in"); if (!n) return;
      setLedgerWater(ledgerWater() + n); $("g-water-in").value = "";
      ledgerCommit([`背包：水 +${n} ml → ${ledgerWater()} ml`]); renderBagSheet(); };
    $("g-water-sub").onclick = () => { const n = readAmt("g-water-in"); if (!n) return;
      setLedgerWater(ledgerWater() - n); $("g-water-in").value = "";
      ledgerCommit([`背包：水 −${n} ml → ${ledgerWater()} ml`]); renderBagSheet(); };
    $("g-item-add").onclick = () => { const id = $("g-item-add-sel").value; if (!id) return;
      bagAdd(id, 1); ledgerCommit([`背包：${ITEM_CATALOG[id].name} +1`]); renderBagSheet(); };

    $("g-rest").onclick = () => { renderRestSheet(); $("g-rest-sheet").classList.add("show"); };
    $("g-rest-close").onclick = () => $("g-rest-sheet").classList.remove("show");
    document.querySelectorAll("#g-rest-sheet [data-advance]").forEach(b => {
      b.onclick = () => { const n = []; ledgerAdvance(Number(b.dataset.advance), n);
        ledgerCommit([`时间推进 ${b.dataset.advance} 小时。`].concat(n)); renderRestSheet(); };
    });
    $("g-short-all").onclick = () => { ledgerCommit(ledgerShortRest(null, [])); renderRestSheet(); };
    $("g-long-hours").onchange = renderRestSheet;
    $("g-long-force").onchange = renderRestSheet;
    $("g-long-go").onclick = () => { const r = ledgerLongRest(currentRestPlan(), []);
      ledgerCommit(r.notes); renderRestSheet(); };
    $("g-restore-all").onclick = () => { ledgerCommit(ledgerRestoreAll([])); renderRestSheet(); };
    $("g-cheat").onclick = () => {
      cheatFillBag().forEach(s => appendLog(s));
      rememberCampaign();
      renderBagSheet();
      flashHint("已刷入 1000 奎支和每种道具 ×3。");
    };
    $("g-save").onclick = () => { renderSaveSheet(); $("g-save-sheet").classList.add("show"); };
    $("g-save-close").onclick = () => $("g-save-sheet").classList.remove("show");
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
    $("g-bs-close").onclick = () => { $("g-bs-sheet").classList.remove("show"); G.bsOpen = false; };
    $("g-field-cfg").onclick = () => { renderFieldSheet(); $("g-field-sheet").classList.add("show"); };
    $("g-enc-cfg").onclick = () => { renderEncSheet(); $("g-enc-sheet").classList.add("show"); };
    $("g-enc-close").onclick = () => $("g-enc-sheet").classList.remove("show");
    $("g-enc-roll").onclick = () => {
      if (typeof rollEncounter !== "function") { flashHint("遭遇系统未加载"); return; }
      const spec = rollEncounter({
        region: $("g-enc-region").value,
        faction: $("g-enc-faction").value || undefined
      });
      $("g-enc-preview").textContent = encSummary(spec);
      startEncounter(spec);
    };
    $("g-enc-boss").onclick = () => {
      if (typeof rollBossEncounter !== "function") { flashHint("遭遇系统未加载"); return; }
      const region = $("g-enc-region").value;
      const bosses = Object.keys(ENEMY_INFO || {}).filter(k => ENEMY_INFO[k].boss && ENEMY_INFO[k].regions.indexOf(region) >= 0);
      if (!bosses.length) { flashHint(region + " 没有首领"); return; }
      const spec = rollBossEncounter(bosses[Math.floor(Math.random() * bosses.length)], { region });
      $("g-enc-preview").textContent = encSummary(spec);
      startEncounter(spec);
    };
    $("g-field-close").onclick = () => $("g-field-sheet").classList.remove("show");
    $("g-cfg-zones").onchange = () => {
      G.zoneMode = state.zoneMode = Number($("g-cfg-zones").value) || 2;
      const zm = document.getElementById("zoneMode");
      if (zm) zm.value = String(state.zoneMode);
      syncFieldDom();
      setView(snapAll(), false);
      refreshAll();
      renderFieldSheet();
    };
    $("g-cfg-ps").onchange = () => {
      /* 仅作显示；添加敌人时按场上玩家人数重算 */
      G.partySize = state.partySize = Number($("g-cfg-ps").value) || 2;
    };
    $("g-cfg-weather").onchange = () => {
      const was = state.weather;
      G.weather = state.weather = $("g-cfg-weather").value;
      if (state.weather === "sand" && was !== "sand" && typeof rollSandDir === "function") rollSandDir();
      if ($("g-weather-sel")) $("g-weather-sel").value = state.weather;
      setView(snapAll(), false);
      refreshAll();
    };
    $("g-prop-add").onclick = () => {
      const kind = $("g-prop-kind").value;
      const zone = Number($("g-prop-zone").value) || 1;
      const lv = Number($("g-prop-lv").value) || 1;
      const p = makeProp(kind, zone, lv);
      p.faction = $("g-prop-fac").value || "player";
      state.props = state.props || [];
      state.props.push(p);
      if (kind === "battery" && typeof syncBatteryShields === "function") syncBatteryShields();
      setView(snapAll(), false);
      refreshAll();
      renderFieldSheet();
    };
    $("g-enemy-add").onclick = () => {
      const id = $("g-enemy-sel").value;
      const lv = Number($("g-enemy-lv").value) || 1;
      const zone = Number($("g-enemy-zone").value) || 2;
      const p = enemyPresets().find(x => x.id === id);
      if (!p) return;
      const partyN = typeof syncPartySizeFromField === "function" ? syncPartySizeFromField() : liveHeroCount();
      const pack = typeof spawnEnemyGroup === "function" ? spawnEnemyGroup(id, lv, partyN, zone) : null;
      if (pack && pack.length) pack.forEach(u => state.units.push(u));
      else {
        const u = p.build(lv, partyN);
        u.zone = Math.min(zone, Number(state.zoneMode));
        state.units.push(u);
        if (typeof refreshEnemyEconomy === "function") refreshEnemyEconomy(u);
      }
      G.enemyPlan = (G.enemyPlan || []).concat([{ id, lv, zone }]);
      setView(snapAll(), false);
      refreshAll();
      renderFieldSheet();
    };
    $("g-fast").onclick = toggleFast;
    $("g-weather-sel").onchange = () => {
      if (G.depth > 0) return;
      const was = state.weather;
      state.weather = $("g-weather-sel").value || "none";
      if (state.weather === "sand" && was !== "sand" && typeof rollSandDir === "function") rollSandDir();
      applyEnv(snapEnv());
      addLogPhase("天气改为 " + (WEATHER_NAME[state.weather] || state.weather));
    };
    $("g-restart").onclick = () => { if (G.depth === 0) setupBattle(Number($("g-level").value) || 1, G.lastEncounter || null); };
    $("g-again").onclick = () => setupBattle(Number($("g-level").value) || 1, G.lastEncounter || null);
    $("g-retreat").onclick = askRetreat;
    $("g-rogue-next").onclick = () => {
      const r = G.rogue;
      if (!r || !G.ended) return;
      const outcome = G.lastOutcome;
      $("g-result").classList.remove("show");
      $("g-reopen").classList.remove("show");
      setRogueMode(null);
      r.onEnd(outcome);
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
  G.skillThunk = skillThunk;
  G.snapAll = snapAll;
  G.setupBattle = setupBattle;
  G.startRogueBattle = startRogueBattle;
  G.showPendingIntro = () => { if (G.pendingIntro && !state.combatStarted) battleIntro(G.pendingIntro); };
  G.armSkill = armSkill;
  G.gameSkills = gameSkills;
  G.blockReason = blockReason;
  G.aiPlan = aiPlan;
  G.aiStep = EnemyAI.step; G.aiTarget = EnemyAI.target; G.AI_SPEC = EnemyAI.SPEC; G.aiSpecial = EnemyAI.special;
  G.endTurn = endTurn;
  G.checkEnd = checkEnd;
  G.refresh = refreshAll;
  G.fitZones = fitZones;
  G.act = act;
})();
