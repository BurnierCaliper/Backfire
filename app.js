const ROSTER_KEY = "anterscale-roster";

/* ---------- 宿主：网页 / 无界面 ----------
 * 规则只经由这几个函数碰网页。没有网页时（Node 测试、批量模拟）：
 *   uiEl       返回 null
 *   hostValue  读 state.inputs[id]，再没有就用默认值
 *   界面函数（render…、弹窗）开头用 HAS_DOM 直接跳过
 * 浏览器里行为与原来完全一致。 */
const HAS_DOM = typeof document !== "undefined";
function uiEl(id) {
  return HAS_DOM ? document.getElementById(id) : null;
}
function hostValue(id, fallback) {
  const el = uiEl(id);
  if (el && el.value !== undefined) return el.value;
  const inp = (typeof state !== "undefined" && state.inputs) || {};
  return inp[id] != null ? inp[id] : fallback;
}

const state = {
  zoneMode: 2,
  partySize: 2,
  weather: "none",
  weatherLock: null,
  phaseStep: 0,
  sandDir: "12",
  units: [],
  selectedId: null,
  attackerId: null,
  targetId: null,
  skillFlow: null,
  floaters: [],
  lastResult: null,
  history: [],
  roster: [],
  pcLayers: [{ type: "flesh", current: 20, max: 20 }],
  turnNo: 1,
  logPages: [{ turn: 1, lines: [] }],
  logIndex: 0,
  actionAcc: null,
  statusDmg: {},
  props: [],
  gaps: { "1-2": emptyGap(), "2-3": emptyGap() },
  combatPhase: "player",
  combatStarted: false,
  kuizhi: 0,
  forceVoid: {},
  fields: {
    1: emptyField(),
    2: emptyField(),
    3: emptyField()
  }
};

function emptyField() {
  return {
    fire: 0,
    fireOn: false,
    electric: false,
    acid: false,
    ice: false,
    quicksand: false,
    coral: false,
    collapse: 0,
    energy: false,
    energyVal: 0,
    harmonic: false,
    heal: false,
    highland: false,
    abyss: false,
    isolate: false,
    fieldLock: null,
    collapseOn: false,
    collapseLv: 1,
    ruinOn: false,
    ruinHp: 30,
    ruinMax: 30
  };
}

const FIELD_EFFECT_KEYS = ["fireOn", "electric", "acid", "ice", "quicksand", "coral", "energy", "harmonic", "heal"];
/** 高地：高地本身，或者沙珊瑚台地（战斗在珊瑚上面进行，desert.js） */
function isHighGround(f) { return !!(f && (f.highland || f.coral)); }

function clearFieldEffects(f) {
  if (!f) return;
  f.fire = 0;
  f.fireOn = false;
  f.electric = false;
  f.acid = false;
  f.ice = false;
  f.quicksand = false;
  f.coral = false;
  f.energy = false;
  f.energyVal = 0;
  f.harmonic = false;
  f.heal = false;
  f.by = null;   // 场地的所有者（环境分数）
}

/** 天气现在能不能改成 kind：能返回 null，不能返回原因（固有天气、被锁定） */
function weatherChangeWhy(kind, opts) {
  opts = opts || {};
  kind = kind || "none";
  if (opts.force || kind === state.weather) return null;
  if (state.combatStarted && state.weatherInnate && !opts.innateOk) {
    return `固有天气「${weatherName(state.weatherInnate)}」：战斗开始时就存在的天气无法被改变。`;
  }
  if (state.weatherLock) return `天气被「${state.weatherLock}」锁定，无法覆盖。`;
  return null;
}
function setWeather(kind, opts) {
  opts = opts || {};
  kind = kind || "none";
  const why = weatherChangeWhy(kind, opts);
  if (why) return why;
  const was = state.weather;
  state.weather = kind;
  // 长线养成每日任务「更换天气」：我方单位主动改成别的天气，记一次（战后 rogue.js · updateGrowthDailyProgress 读）
  if (kind !== was && opts.by != null) {
    const by = typeof unitById === "function" ? unitById(opts.by) : null;
    if (by && by.isPlayer) state.playerWeatherChanges = (Number(state.playerWeatherChanges) || 0) + 1;
  }
  // 天气的所有者（环境分数）：谁放的天气；主持人 / 固有天气没有所有者
  if (kind !== was || opts.by != null) state.weatherBy = kind === "none" ? null : (opts.by != null ? opts.by : null);
  if (kind === "sand" && (was !== "sand" || opts.casterZone != null)) rollSandDir(opts.casterZone);
  const sel = uiEl("weather");
  if (sel) sel.value = kind;
  if (opts.lock) state.weatherLock = opts.lock;
  if (opts.unlock) state.weatherLock = null;
  applyTheme();
  return null;
}

/** 我方单位普通移动的消耗（技能栏显示用；越过空隙要看去哪，在移动时另算）：
 *  导体 / 探测模式不耗；站在酸液地面上离开要 1 行动点（荒原行者只要附赠）；狂暴这回合还有免费移动就不耗；其余 1 附赠行动 */
function moveBaseCost(u) {
  if (!u) return { bonus: 1 };
  if (u.self === "conductor" || (u.kit === "ecmo" && u.resources && u.resources.probe)) return {};
  const f = (state.fields || {})[u.zone] || {};
  const wanderer = typeof featHas === "function" && featHas(u, "wanderer");
  if (f.acid && !u.flying && !wanderer && !(typeof acidGroundWalker === "function" && acidGroundWalker(u))) return { ap: 1 };
  if (typeof frenzyFreeMoveReady === "function" && frenzyFreeMoveReady(u)) return {};   // 狂暴（effects.js）：每回合的免费移动
  return { bonus: 1 };
}
/** 这一区的场地现在能不能改成 kind（空 = 清除）：能返回 null，不能返回原因（深渊、损毁地面、固有场地、被锁定） */
function fieldChangeWhy(zone, kind, opts) {
  opts = opts || {};
  const f = state.fields[zone];
  if (!f) return "没有这个区域。";
  const same = (kind === "fire" && fieldFireOn(f)) || (kind && kind !== "fire" && f[kind]);
  if (state.combatStarted && !opts.force && !opts.innateOk && !same) {
    if (f.abyss || f.ruinOn) return `${zone} 区是${f.abyss ? "深渊" : "损毁地面"}，场地无法被改变。`;
    if (f.innate) return `${zone} 区是固有场地（战斗开始时就存在），无法被改变。`;
  }
  if (f.fieldLock && !opts.force) {
    if (!same && kind) return `${zone} 区场地被「${f.fieldLock}」锁定，无法覆盖。`;
    if (!kind) return `${zone} 区场地被「${f.fieldLock}」锁定，无法清除。`;
  }
  return null;
}
function setZoneField(zone, kind, opts) {
  opts = opts || {};
  const f = state.fields[zone];
  // 深渊、损毁地面不能被改变；战斗开始时就存在的场地是固有场地，也不能被改变（重复施加同一种照常）；
  // innateOk：主持人的计算器面板（仍然尊重手动锁定）
  const why = fieldChangeWhy(zone, kind, opts);
  if (why) return why;
  clearFieldEffects(f);
  if (kind === "fire") {
    f.fireOn = true;
    f.fire = opts.stacks != null ? opts.stacks : 1;
  } else if (kind) {
    f[kind] = true;
  }
  if (kind && kind !== "highland") f.by = opts.by != null ? opts.by : null;
  if (opts.lock) f.fieldLock = opts.lock;
  if (opts.unlock) f.fieldLock = null;
  return null;
}

function snapshot() {
  if (globalThis.HotseatGame?.isActive?.()) return;
  state.history.push(clone({
    units: state.units,
    fields: state.fields,
    phaseStep: state.phaseStep
  }));
  if (state.history.length > 30) state.history.shift();
}

function undo() {
  const prev = state.history.pop();
  if (!prev) return;
  state.units = prev.units;
  state.fields = prev.fields;
  state.phaseStep = prev.phaseStep;
  const ps = uiEl("phaseStep");
  if (ps) ps.value = String(state.phaseStep);
  renderAll();
}

function unitById(id) {
  // 打配置物 / 危墙时的替身（structProxy）：技能分支里按 id 找目标也找得到它
  if (state._structProxy && id != null && state._structProxy.id === id) return state._structProxy;
  return state.units.find(u => u.id === id);
}

function renderAll() {
  if (!HAS_DOM) return;
  applyTheme();
  renderZones();
  renderEditor();
  renderInspect();
  renderSelects();
  renderDist();
  renderSkills();
}

function fieldThemeClass(f) {
  if (!f) return "";
  if (f.abyss) return "field-abyss";
  if (f.collapseOn) return "field-collapse";
  if (typeof fieldFireOn === "function" && fieldFireOn(f)) return "field-fire";
  if (f.electric) return "field-electric";
  if (f.ice) return "field-ice";
  if (f.acid) return "field-acid";
  if (f.quicksand) return "field-quicksand";
  if (f.coral) return "field-coral";
  if (f.energy) return "field-energy";
  if (f.harmonic) return "field-harmonic";
  return "";
}

function applyTheme() {
  if (!HAS_DOM) return;
  const pl = uiEl("phaseLabel");
  if (pl) pl.textContent = "回合阶段：" + phaseLabelText();
  const turnBtn = uiEl("btnTurnEnd");
  if (turnBtn) {
    if (!state.combatStarted) turnBtn.textContent = "开始战斗";
    else turnBtn.textContent = state.combatPhase === "enemy" ? "结束敌人回合" : "结束玩家回合";
  }
  const startBtn = uiEl("btnStartCombat");
  if (startBtn) {
    startBtn.disabled = !!state.combatStarted;
    startBtn.textContent = state.combatStarted ? "战斗进行中" : "开始战斗";
  }
  document.body.setAttribute("data-weather", state.weather || "none");
  const wl = uiEl("weatherLock");
  if (wl) wl.checked = !!state.weatherLock;
}

function renderInspect() {
  if (!HAS_DOM) return;
  const box = uiEl("inspectPane");
  if (!box) return;
  const u = unitById(state.selectedId) || unitById(state.attackerId);
  if (!u) { box.innerHTML = "点战场上的单位。"; return; }
  const hp = (u.layers || []).map(l => `${LAYER[l.type] || l.type} ${round2(l.current)}/${l.max}`).join(" · ");
  box.innerHTML = `<div class="name">${escapeHtml(u.name)} · Lv${u.level} · ${u.zone}区</div>
    <div>${hp}</div>
    <div>架势 ${defText(u)} · ATK ${effectiveAtk(u, state.units)}</div>
    <div>${resourceText(u) || ""}</div>
    <div class="status-line">${escapeHtml(statusLine(u))}</div>`;
}

function renderZones() {
  if (!HAS_DOM) return;
  const root = uiEl("zones");
  root.className = "zones z" + state.zoneMode;
  const n = Number(state.zoneMode);
  root.innerHTML = "";
  for (let z = 1; z <= n; z++) {
    root.appendChild(buildZoneBox(z));
    if (z < n) root.appendChild(buildGapBox(gapKey(z, z + 1)));
  }
}

function buildZoneBox(z) {
  const f = state.fields[z];
  const tags = fieldTags(f);
  const box = document.createElement("div");
  const threats = typeof zoneThreatsIn === "function" ? zoneThreatsIn(z) : [];
  const marked = threats.length > 0;
  box.className = ("zone " + fieldThemeClass(f) + (marked ? " zone-gl" : "")).trim();
  const windTag = (state.weather === "sand")
    ? " · 沙暴" + sandWindLabel(sandWind(z, state.zoneMode, state.sandDir))
    : "";
  const threatTag = marked
    ? `<span class="zone-threat">${threats.map(t => escapeHtml(t.label + (t.from ? "（" + t.from + "）" : ""))).join(" · ")}</span>`
    : "";
  box.innerHTML = `<h3><span>${z} 区${windTag}${threatTag}</span><span class="zone-tags">${tags || "无场地"}</span></h3>
    <div class="chk" data-zone="${z}">
      <label><input type="checkbox" data-k="fireOn" ${f.fireOn || f.fire > 0 ? "checked" : ""}>火场</label>
      <label>层 <input type="number" min="0" value="${f.fireOn || f.fire > 0 ? (f.fire || 1) : 0}" data-k="fire" style="width:48px"></label>
      <label><input type="checkbox" data-k="electric" ${f.electric ? "checked" : ""}>高压</label>
      <label><input type="checkbox" data-k="acid" ${f.acid ? "checked" : ""}>酸液地面</label>
      <label><input type="checkbox" data-k="ice" ${f.ice ? "checked" : ""}>冻土</label>
      <label><input type="checkbox" data-k="quicksand" ${f.quicksand ? "checked" : ""}>流沙</label>
      <label><input type="checkbox" data-k="coral" ${f.coral ? "checked" : ""}>沙珊瑚台地</label>
      <label><input type="checkbox" data-k="energy" ${f.energy ? "checked" : ""}>能量场</label>
      <label><input type="checkbox" data-k="harmonic" ${f.harmonic ? "checked" : ""}>干涉场</label>
      <label><input type="checkbox" data-k="heal" ${f.heal ? "checked" : ""}>治愈</label>
      <label><input type="checkbox" data-k="highland" ${f.highland ? "checked" : ""}>高地</label>
      <label><input type="checkbox" data-k="abyss" ${f.abyss ? "checked" : ""}>深渊</label>
      <label><input type="checkbox" data-k="isolate" ${f.isolate ? "checked" : ""}>隔离区</label>
      <label><input type="checkbox" data-k="collapseOn" ${f.collapseOn ? "checked" : ""}>塌陷区域</label>
      <label>计数 <input type="number" min="0" value="${f.collapse || 0}" data-k="collapse" style="width:48px"></label>
      <label><input type="checkbox" data-k="collapseLv" style="display:none">塌陷等级</label>
      <label>塌陷Lv <input type="number" min="1" value="${f.collapseLv || 1}" data-k="collapseLv" style="width:48px"></label>
      <label><input type="checkbox" data-k="ruinOn" ${f.ruinOn ? "checked" : ""}>损毁地面</label>
      <label>耐久 <input type="number" min="0" value="${f.ruinHp || 0}" data-k="ruinHp" style="width:52px"></label>
      <label>上限 <input type="number" min="0" value="${f.ruinMax || 30}" data-k="ruinMax" style="width:52px"></label>
      <label><input type="checkbox" data-k="fieldLock" ${f.fieldLock ? "checked" : ""}>锁定场地${f.fieldLock ? "（" + escapeHtml(f.fieldLock) + "）" : ""}</label>
    </div>
    <div class="prop-row"></div>
    <div class="unit-list" data-drop="${z}"></div>`;
  const list = box.querySelector(".unit-list");
  const propRow = box.querySelector(".prop-row");
  (state.props || []).filter(p => Number(p.zone) === z).forEach(p => propRow.appendChild(propCard(p)));
  const here = state.units.filter(u => Number(u.zone) === z && !u.hidden);
  const spots = tokenLayout(here.length);
  here.forEach((u, i) => list.appendChild(unitCard(u, spots[i] || { x: 50, y: 50 })));
  box.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("change", () => {
      calcCommand("field", { zone: z, key: inp.dataset.k, value: inp.type === "checkbox" ? inp.checked : inp.value });
    });
    if (inp.type === "number") {
      inp.addEventListener("wheel", ev => ev.preventDefault());
    }
  });
  box.addEventListener("click", (e) => {
    if (e.target.closest(".unit-token") || e.target.closest("button") || e.target.closest("input") || e.target.closest("label") || e.target.closest("select")) return;
    const step = flowStep();
    if (state.skillFlow && step && step.type === "zone") {
      const ok = (step.zones || []).some(x => Number(x) === Number(z));
      if (ok) calcCommand("skillPick", { value: Number(z) });
      else appendLog("当前步骤不能选这个区域。");
    }
  });
  return box;
}

function buildGapBox(key) {
  if (!state.gaps[key]) state.gaps[key] = emptyGap();
  const g = state.gaps[key];
  const box = document.createElement("div");
  box.className = "gap-box";
  box.innerHTML = `<h3>间隔 ${key.replace("-", "↔")}</h3>
    <label class="field">类型
      <select data-gap="${key}">
        <option value="open">畅通</option>
        <option value="bridge">不稳桥梁</option>
        <option value="wall">危墙</option>
        <option value="door">机关门</option>
        <option value="void">空隙</option>
      </select>
    </label>
    <label class="field">耐久 <input type="number" min="0" value="${g.hp}" data-ghp="${key}"></label>
    <div class="chk" style="margin-top:6px">
      <label><input type="checkbox" data-gopen="${key}" ${g.open ? "checked" : ""}>门开着</label>
      <label><input type="checkbox" data-gforce="${key}" ${state.forceVoid[key] ? "checked" : ""}>允许强行通过</label>
    </div>
    <button class="btn small" data-ghit="${key}" style="margin-top:6px">作为攻击目标</button>
    <div class="hint">${gapStatusText(g)}</div>`;
  box.querySelector("select").value = g.type;
  box.querySelector("select").onchange = e => calcCommand("gap", { key, field: "type", value: e.target.value });
  box.querySelector("[data-ghp]").onchange = e => calcCommand("gap", { key, field: "hp", value: e.target.value });
  box.querySelector("[data-gopen]").onchange = e => calcCommand("gap", { key, field: "open", value: e.target.checked });
  box.querySelector("[data-gforce]").onchange = e => calcCommand("gap", { key, field: "force", value: e.target.checked });
  box.querySelector("[data-ghit]").onclick = () => calcCommand("gap", { key, field: "target" });
  return box;
}

function gapStatusText(g) {
  if (g.type === "open") return "可通过，可影响对面。";
  if (g.type === "bridge") return `通过扣 1d6 耐久。现 ${g.hp}（手册 10～30）。被攻击时只有击破扣耐久。毁后变空隙。飞行无视。`;
  if (g.type === "wall") return `挡住对面。现耐久 ${g.hp}（手册 1～15）。只有击破扣耐久，伤害打不动；倒向最后一击的另一侧。`;
  if (g.type === "door") return g.open ? "门开着，可通过。" : "门关着，不能通过也不能打对面。";
  if (g.type === "void") return "地面单位花 1 行动点、过简单运动检定才能越过（失败过不去，行动点照扣）；飞行可过。勾「允许强行通过」= 主持人判定检定成功。";
  return "";
}

function propCard(p) {
  const el = document.createElement("div");
  el.className = "prop-card";
  if (state.targetId === "prop:" + p.id) el.classList.add("active-target");
  el.innerHTML = `<div><b>${escapeHtml(p.name)}</b> · ${p.hp}/${p.maxHp || p.hp}</div>
    <div class="meta">${p.kind === "battery" || p.kind === "turret" ? "阵营 " + (p.faction === "enemy" ? "敌" : "我") : ""} Lv${p.level}</div>`;
  const row = document.createElement("div");
  row.className = "row";
  const tgt = document.createElement("button");
  tgt.className = "btn small";
  tgt.textContent = "设为目标";
  tgt.onclick = e => { e.stopPropagation(); calcCommand("prop", { id: p.id, op: "target" }); };
  row.appendChild(tgt);
  if (p.kind === "button" || p.kind === "lever") {
    const use = document.createElement("button");
    use.className = "btn small";
    use.textContent = p.kind === "lever" ? "扳动" : "按下";
    use.onclick = e => { e.stopPropagation(); calcCommand("prop", { id: p.id, op: "use" }); };
    row.appendChild(use);
  }
  if (p.kind === "scrap") {
    const fire = document.createElement("button");
    fire.className = "btn small";
    fire.textContent = "开火";
    fire.onclick = e => { e.stopPropagation(); calcCommand("prop", { id: p.id, op: "fire" }); };
    row.appendChild(fire);
  }
  if (p.movable) {
    const mv = document.createElement("button");
    mv.className = "btn small";
    mv.textContent = "挪到邻区";
    mv.onclick = e => { e.stopPropagation(); calcCommand("prop", { id: p.id, op: "move", dest: Number(p.zone) === 1 ? 2 : Number(p.zone) - 1 }); };
    row.appendChild(mv);
  }
  const del = document.createElement("button");
  del.className = "btn small danger";
  del.textContent = "移除";
  del.onclick = e => { e.stopPropagation(); calcCommand("prop", { id: p.id, op: "remove" }); };
  row.appendChild(del);
  el.appendChild(row);
  return el;
}

function statusLine(u) {
  const s = [];
  if (u.vehMerged && typeof vehicleOf === "function") { const vp = vehicleOf(u); if (vp) s.push(vehicleSeatText(vp), `驾驶员：${u.name}`); }   // 载具（vehicle.js）：合并后画成车的卡片，写乘员和驾驶员是谁
  if (Number(u.stunMarks) > 0) s.push(`晕眩标记 ${u.stunMarks}/${typeof BOSS_STUN_MARKS !== "undefined" ? BOSS_STUN_MARKS : 2}`);
  if (u.statuses) {
    if (u.statuses.burn > 0) s.push("灼烧×" + u.statuses.burn);
    if (u.statuses.shock) s.push("感电");
    if (u.statuses.corr) s.push("腐蚀");
    if (u.statuses.frostbite) s.push("冻伤");
    if (u.statuses.shockwave) s.push("震荡");
    // #52：「高能」只看高能状态；没有高能状态、只是攒着高能值的（蓄能）写成「蓄能 N」
    if (u.statuses.high) s.push("高能 " + (u.highEnergy || 0));
    else if ((u.highEnergy || 0) > 0) s.push("蓄能 " + u.highEnergy);
    if (u.statuses.reso) s.push("共振");
    if (u.statuses.unstable) s.push("不稳");
    if (u.statuses.weak) s.push("虚弱");
    if (u.statuses.inspire) s.push("振奋");
    if (u.statuses.hide) s.push("躲藏");
    if (u.submerged) s.push("下潜");
    if (u.entangled) s.push("被缠绕");
    if (u.resources && u.resources.flattened) s.push("摊平");
    if (u.detected && typeof isDesertPrey === "function" && isDesertPrey(u)) s.push("已被发现");
    if (sinkOf(u) && inQuicksand(u)) s.push("下陷 " + sinkOf(u) + (sinkOf(u) >= QUICKSAND.lockAt ? "（没顶）" : ""));
    if (u.statuses.advantage) s.push("优势");
    if (u.statuses.chase) s.push("紧追");
  }
  (u.focuses || []).forEach(f => {
    const names = (f.seq || []).map((el, i) => (i === f.step ? "[" + (ELE[el] || el) + "]" : (ELE[el] || el)));
    s.push("聚焦" + (LAYER[f.layerType] || f.layerType) + " " + names.join("→"));
  });
  const yuito = (state.units || []).find(x => x.kit === "yuito" && x.resources && x.resources.bondId === u.id);
  if (yuito) s.push("牵挂");
  if (u.shieldFromChuan || u.magnetShield) s.push("磁场护盾");
  if (u.statuses && u.statuses.sturdy) s.push("坚挺");
  // 职责技能挂上的标记：以前只记在字段上，画面看不到，出手预演也因此判「没有效果」、把目标全变灰
  if (u.shelterTurn) s.push("保释");
  if (u.harshEnv) s.push("恶劣环境");
  if (u.instant && u.instant.doubleStatus) s.push("加倍计量");
  if (u.instant && u.instant.goldHold) s.push("黄金时间" + (INSTANT_NAME[u.instant.goldHold] ? "（" + INSTANT_NAME[u.instant.goldHold] + "）" : ""));
  if (u.instant && u.instant.omenArmed) s.push("击破预告");
  if (u.lockdownBy) {
    const tank = (state.units || []).find(x => x.id === u.lockdownBy);
    s.push(tank ? "禁足（" + tank.name + "）" : "禁足");
  }
  if (u.instant) {
    if (u.instant.melt) s.push("熔融");
    if (u.instant.sting) s.push("刺骨");
    if (u.instant.overload) s.push("过载");
    if (u.instant.shift) s.push("错位");
    if (u.instant.spread) s.push("扩散");
    if (u.instant.refract) s.push("折射");
    if (u.instant.iceNext) s.push("冰冻+50%");
  }
  if (u.kit === "sand_aggregate") {
    const ph = (u.resources && u.resources.phase) || 1;
    s.push(ph === 1 ? "一阶段" : ph === 2 ? "二阶段" : "三阶段");
    const dr = typeof mechChargeDr === "function" ? mechChargeDr(u) : 0;
    if (dr > 0) s.push(`电能炮蓄满（减伤 ${Math.round(dr * 100)}%）`);
    if (u.resources && Number(u.resources.meltHoldTurn) >= Number(state.turnNo) && u.instant && u.instant.melt) s.push("过热");
    if (u.resources && u.resources.debrisCount) s.push("碎片" + u.resources.debrisCount + "/2");
    if (u.resources && u.resources.rush) s.push("预备狂暴连打");
  }
  // 被沙灵聚合体盯上的狂暴连打目标
  if (u.isPlayer && (state.units || []).some(x => x.kit === "sand_aggregate" && !x.dead && x.resources && x.resources.rush && x.resources.rush.targetId === u.id)) s.push("连打预告");
  if (u.dormant) s.push("休眠");
  if (!u.isPlayer && typeof playerAllied === "function" && playerAllied(u)) s.push("友军");
  if (u.noMove) s.push("无法移动");
  if (u.tauntTo) s.push("嘲讽");
  if (typeof isPierced === "function" && isPierced(u)) s.push("刺入");
  if (u.coverBy) {
    const guard = (state.units || []).find(x => x.id === u.coverBy);
    s.push(guard ? "掩护（" + guard.name + "）" : "掩护");
  }
  if (u.kit === "kolt" && u.resources) s.push(u.resources.bit === "acid" ? "酸液炮" : "电钻");
  if (u.kit === "ras" && u.resources) {
    s.push("能量" + (u.resources.energyPct || 0) + "%");
    s.push("光能" + (u.resources.light || 0));
    if (u.resources.unstable) s.push("不稳态");
  }
  if (u.kit === "helu" && u.resources && u.resources.scanned) s.push("已探测");
  if (u.kit === "longge" && u.resources && u.resources.trigger) s.push("扳机解锁");
  // 自我效果（导体、霜结、自焚、溅射、千钧、蓄能、多普勒）：战斗画面的状态条读这里，以前漏了
  if (u.self && u.self !== "none") s.push(selfName(u.self) + (u.self === "burn" && u.selfBurnStacks ? "×" + u.selfBurnStacks : ""));
  return s.length ? s.join(" · ") : "无状态";
}

/** reason：日志里写的来源（高能余波这类只有一段的），不给就写「第 N 段能量伤害」 */
function gainHighFromHits(target, res, extra, reason) {
  if (!target || !res) return;
  if (!(target.statuses && target.statuses.high)) return;   // 只有高能状态才吃能量伤害涨高能值（蓄能不算）
  if ((res.element || "") !== "energy") return;
  const hits = (res.perHit && res.perHit.length) ? res.perHit : [{ dealt: res.total }];
  const damaging = hits.filter(h => (h.dealt || 0) > 0);
  if (!damaging.length) return;
  damaging.forEach((h, i) => {
    extra.push(addHighEnergy(target, reason || `第${i + 1}段能量伤害`));
  });
}

function tagHighFrom(unit, kit) {
  if (!unit || !kit) return;
  unit.highTags = unit.highTags || [];
  if (unit.highTags.indexOf(kit) < 0) unit.highTags.push(kit);
}

function addHighEnergy(unit, reason) {
  if (!unit) return "";
  const weather = currentWeatherFor(unit);
  const bonus = weather === "glow" ? envMult(unit) : 0;   // 微光：累积时 +1（恶劣环境 / 末日 +2）
  const d = statusDotDice("high", unit.level || 1, weather);
  const r = takeDice(d.n, d.s, (d.bonus || 0) + bonus);
  unit.statuses = unit.statuses || {};
  const fresh = !unit.statuses.high;
  unit.statuses.high = true;
  if (fresh) popStatus(unit, "high");
  const gain = r.total * statusMult(unit);   // 加倍计量：高能累积翻倍
  unit.highEnergy = (unit.highEnergy || 0) + gain;
  const line = `${unit.name} ${reason || "高能累积"} ${r.text}${gain !== r.total ? " ×2（加倍计量）" : ""} → 高能值 ${unit.highEnergy}`;
  checkHighBoom(unit);
  return line;
}

function currentLifeForHigh(unit) {
  let hp = 0;
  (unit.layers || []).forEach(l => { hp += Math.max(0, Number(l.current) || 0); });
  if (hp <= 0 && unit.upOnShp) hp = Math.max(0, Number(unit.shp) || 0);
  return hp;
}

/** 判定自爆用的高能值：自身高能值，带高能状态的再加上所在能量场的场地高能（保释中的不算场地） */
function highBoomValue(unit) {
  const f = (state.fields && state.fields[unit.zone]) || emptyField();
  const fieldHE = unit.statuses && unit.statuses.high && !fieldExempt(unit) ? (Number(f.energyVal) || 0) : 0;
  return (Number(unit.highEnergy) || 0) + fieldHE;
}

/** 高能自爆在一次完整的攻击行动之后才判定：行动中（runSkill 里）只记下要判的单位，
 *  让多段攻击全部打完、高能值继续累积，行动结束时再统一判（flushHighBooms） */
function checkHighBoom(unit, opt) {
  if (!unit || unit._highBooming) return;
  // 行动中被打死的也要记下：等行动结束带着高能照样自爆（不能因为已经判死就漏掉）
  if ((Number(state._highDefer) || 0) > 0) {
    if (unit.hidden && !unit.dead) return;
    state._highPending = state._highPending || [];
    if (!state._highPending.includes(unit.id)) state._highPending.push(unit.id);
    return;
  }
  if (unit.hidden) return;
  if (unit.resources && unit.resources.reviveGuard) return;   // 还魂（feats.js）：到自己下回合开始前不会高能自爆
  if (unit.dead && !(opt && opt.diedThisAction && !unit.isPlayer)) return;
  // 微光：蓄能状态下，高能值要在连续两个回合结束时都超过血量才自爆——平时不判，回合结束时判（glowStoreTurnEnd）
  if (unit.self === "store" && currentWeatherFor(unit) === "glow") return;
  const hp = currentLifeForHigh(unit);
  const val = highBoomValue(unit);
  // 陨石开采机被我方打死：高能值转给杀它的人，自己不自爆（还活着时蓄能撑爆照常自爆）
  if (val > 0 && hp <= 0 && unit.kit === "meteor_miner" && typeof minerDeathTransfer === "function") {
    const killer = unitById(unit._lastHitBy);
    if (killer && killer.isPlayer && !killer.dead) {
      const notes = [];
      minerDeathTransfer(unit, killer, notes);
      notes.forEach(s => appendLog(s));
      return;
    }
  }
  if (val > 0 && hp < val) explodeHigh(unit, val);   // 血量「低于」高能值才自爆；这次爆炸的高能值含能量场叠上来的部分
}

/** 行动结束：把行动中攒下的单位按顺序判一次高能自爆（这时已经不在行动中，余波连锁照常立即判） */
function flushHighBooms() {
  const ids = state._highPending || [];
  state._highPending = [];
  // 这次行动里被打死的敌人（已经判死、清场）只要身上还有高能，照样自爆
  ids.forEach(id => { const u = unitById(id); if (u) checkHighBoom(u, { diedThisAction: true }); });
}
/** 回合结束：微光 + 蓄能的单位，高能值超过血量记一次；连续两个回合结束都超过才自爆，中间有一次没超过就重新数 */
function glowStoreTurnEnd(notes) {
  state.units.forEach(u => {
    if (!u) return;
    if (offField(u) || u.self !== "store" || currentWeatherFor(u) !== "glow") { u._glowStoreOver = 0; return; }
    const hp = currentLifeForHigh(u);
    const val = highBoomValue(u);
    if (!(val > 0 && hp < val)) { u._glowStoreOver = 0; return; }
    u._glowStoreOver = (Number(u._glowStoreOver) || 0) + 1;
    if (u._glowStoreOver < 2) {
      notes.push(`${u.name} 微光 · 蓄能：高能值 ${val} 超过血量 ${hp}（第 1 个回合结束；下个回合结束还超过就自爆）。`);
      return;
    }
    u._glowStoreOver = 0;
    notes.push(`${u.name} 微光 · 蓄能：连续两个回合结束高能值都超过血量，自爆。`);
    explodeHigh(u, val);
  });
}

function highBoomHitsUnit(source, u) {
  if (!u || u.id === source.id || u.dead || u.hidden) return false;
  if (u.kit === "ufo_body") return false;
  return !!u.isPlayer === !!source.isPlayer;
}

function highBoomHitsProp(source, p) {
  if (!p) return false;
  if (p.kind === "button" || p.kind === "lever") return false;   // 由范围波及统一触发一次（markAoeZone）
  if (p.kind !== "battery" && p.kind !== "turret") return true;
  if (!p.faction) return true;
  if (p.faction === "enemy") return !source.isPlayer;
  return !!source.isPlayer;
}

function highBoomVictims(source) {
  // 余波是范围攻击：被屏障保护的单位不受（屏障在配置物那一轮挨打）
  return fieldUnits().filter(u => Number(u.zone) === Number(source.zone) && highBoomHitsUnit(source, u) && !aoeShieldFor(u));
}

/** 高能自爆。total：触发这次爆炸的高能值（含能量场叠加的部分）；不给就用单位自己的高能值 */
/** opt.envBy：能量场自爆（场地造成的）——炸掉的血量、溢出、余波都算环境分，记在场地所有者 / 触发者身上 */
function explodeHigh(unit, total, opt) {
  opt = opt || {};
  if (!unit || unit._highBooming) return;
  unit._highBooming = true;
  const he = Math.max(Number(total) || 0, Number(unit.highEnergy) || 0);
  const aoe = Math.floor(he / 2);
  const lifeBefore = currentLifeForHigh(unit);
  appendLog(`【高能自爆】${unit.name} 高能值 ${he} ≥ 当前生命 ${lifeBefore}，立即秒杀。余波只打同阵营与无阵营配置物，${aoe} 能量。`);
  // 画面：专门的「高能自爆」演出（大字、震屏、爆炸声、大号数字），溢出部分显示成负血量
  spawnPopup(unit, { kind: "highboom", value: he, text: String(aoe), element: "energy" });
  const envBoom = "envBy" in opt;
  if (!unit.isPlayer) {
    unit.overkill = Math.max(0, he - lifeBefore); unit.killBig = true;
    const acc = state.actionAcc;
    const envWho = envBoom ? envCreditUnit(opt.envBy) : null;
    if (envWho) {
      creditPlayerHit(unit, (envOwnerUnit(opt.envBy) || {}).id);   // 击杀算环境的所有者；没有所有者就算之前最后打过它的玩家
      scoreEnvHit(unit, { total: lifeBefore, breakDealt: 0 }, envWho, 0, "爆炸");
      const over = Math.floor(unit.overkill * SCORE_RULES.overkill);
      if (over > 0) envCommit(() => addScore("env", over * SCORE_RULES.env * scoreTargetMul(unit), envWho));
    } else if (acc && acc.actorIsPlayer) addScore("overkill", Math.floor(unit.overkill * SCORE_RULES.overkill) * scoreTargetMul(unit), unitById(acc.actorId));
  }
  const boomOwner = envBoom ? (envOwnerUnit(opt.envBy) || {}).id : statusOwnerId(unit, "high");   // 高能状态的所有者（要在清掉高能之前取）
  (unit.layers || []).forEach(l => { l.current = 0; });
  // 倒地统一结算（applyKnockdown）：力竭 3 即死，起身中的人坚毅生命扣光死亡（以前被炸回濒死、还能再起身）
  const downNotes = [];
  applyKnockdown(unit, downNotes, { lethal: true, cause: "高能自爆" });
  downNotes.forEach(s => appendLog(s));
  unit.highEnergy = 0;
  if (unit.statuses) unit.statuses.high = false;
  // 纳米科技：场上任何高能自爆都给瑞比 40 纳米能源
  if (findKit("ruby", state.units) && (typeof passiveOnKit !== "function" || passiveOnKit("ruby"))) {
    addNano(40);
    const ruby = findKit("ruby", state.units);
    appendLog(`纳米科技：场上高能自爆，纳米 +40 → ${ruby && ruby.resources ? ruby.resources.nano : "?"}`);
  }
  // 能量流向：场上发生任何高能值导致的爆炸，拉斯缪尔都回收等量光能（不再要求是自己施加的高能）
  {
    const ras = findKit("ras", state.units);
    if (ras && !ras.dead && he > 0 && (typeof passiveOnKit !== "function" || passiveOnKit("ras"))) {   // 放弃被动「能量流向」时不回收
      ras.resources = ras.resources || {};
      ras.resources.light = (Number(ras.resources.light) || 0) + he;
      appendLog(`能量流向：回收光能 +${he} → ${ras.resources.light}`);
    }
  }
  unit.highTags = [];
  if (state.fields[unit.zone]) state.fields[unit.zone].energyVal = 0;
  markAoeZone(unit.zone);
  if (aoe > 0) {
    const prevTag = state.popTag;
    state.popTag = "boom";   // 余波的伤害数字在画面上放大、停留更久（连锁自爆时恢复外层的标记）
    try { highBoomVictims(unit).forEach(u => {
      const notes = [];
      const lifeB = currentLifeForHigh(u);
      const maxB = (u.layers || []).reduce((a, l) => a + (Number(l.max) || 0), 0);
      // 先打标记再结算：演出里铭牌一变灰就走「慢慢消失」
      if (!u.isPlayer && aoe >= lifeB && aoe >= maxB * 0.5) u.killBig = true;
      // 余波打死的敌人算高能状态的所有者的击杀（不是引爆的那个人）；没有所有者就不改它们各自的最后一击
      // 余波是能量伤害：带高能状态的单位照打中时的口径累积高能值，先累积、再判它会不会连锁自爆（applyTypedDotIn · highGain）
      const hitIt = () => applyTypedDot(u, aoe, "energy", notes, `${u.name} 被高能余波击中 ${aoe}`, { by: boomOwner, highGain: "余波能量伤害" });
      if (envBoom) withEnvOwner(opt.envBy, hitIt); else hitIt();
      // 被余波炸死的敌人同样显示负血量，炸掉一半以上血量的慢慢消失
      if (!u.isPlayer && (u.dead || totalHp(u) <= 0)) {   // dead 要等稍后清场才标，这里看血量
        u.overkill = (Number(u.overkill) || 0) + Math.max(0, aoe - lifeB);
        const maxHp = (u.layers || []).reduce((a, l) => a + (Number(l.max) || 0), 0);
        if (aoe >= maxHp * 0.5) u.killBig = true;
      }
      notes.forEach(s => appendLog(s));
      checkHighBoom(u);
    });
    (state.props || []).filter(p => Number(p.zone) === Number(unit.zone) && highBoomHitsProp(unit, p)).forEach(p => {
      const notes = damageProp(p, { element: "energy", dmg: aoe }, unit);
      notes.forEach(s => appendLog(s));
    });
    markAoeZone(unit.zone, "handled"); } finally { state.popTag = prevTag || null; }
  }
  // 波及的按钮 / 拉杆在这次行动结束时统一触发（runSkill），同一区一次行动只触发一次
  unit._highBooming = false;
  if (!unit.isPlayer) sweepDeadEnemies().forEach(s => appendLog(s));
}

function fieldFireOn(f) {
  if (!f) return false;
  if (f.fireOn === false && !(Number(f.fire) > 0)) return false;
  return !!(f.fireOn || Number(f.fire) > 0);
}

function registerZoneBreak(zone, amount) {
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  if (!amount) return [];
  const f = state.fields[zone];
  if (!f || !f.collapseOn || f._collapsing) return [];
  f.collapse = (Number(f.collapse) || 0) + amount;
  const notes = [`${zone} 区塌陷计数 ${f.collapse - amount} → ${f.collapse}`];
  // 累计满 5 点击破塌陷一次，然后计数器清零（不留余数：一次大击破不会连塌两次）
  if (f.collapse >= 5) {
    f.collapse = 0;
    notes.push(`${zone} 区塌陷触发，计数清零。`);
    notes.push(...triggerCollapse(zone));
  }
  return notes;
}

function triggerCollapse(zone) {
  const notes = [];
  const f = state.fields[zone];
  if (!f) return notes;
  f._collapsing = true;
  const lv = Number(f.collapseLv) || 1;
  const n = 1 + milestone(lv, 4);
  const r = takeDice(n, 10, 0);
  notes.push(`${zone} 区塌陷：${r.text} 物理 + 2 击破（飞行免疫）。`);
  // 保释中的单位豁免场地；恶劣环境 / 末日让塌陷的击破和伤害翻倍
  state.units.filter(u => !u.hidden && !u.dead && !u._removed && Number(u.zone) === Number(zone) && !u.flying && !fieldExempt(u)).forEach(u => {
    const x = envMult(u);
    dealBreak(u, 2 * x, "physical", notes, x > 1 ? "塌陷 ×2" : "塌陷");
    withEnvOwner(f.by, () => applyTypedDot(u, r.total * x, "physical", notes, `${u.name} 塌陷伤害${x > 1 ? ` ×${x}（场地效果${x > 2 ? "×4" : "翻倍"}）` : ""}`));
    if (u.submerged && typeof surfaceUnit === "function") surfaceUnit(u, notes, true, "塌陷震", "physical");   // 下潜也躲不过塌陷
  });
  if (f.ruinOn) {
    notes.push(`${zone} 区损毁地面被塌陷直接摧毁，变为深渊。`);
    destroyRuinGround(zone, notes);
  }
  f._collapsing = false;
  return notes;
}

function destroyRuinGround(zone, notes) {
  const f = state.fields[zone];
  if (!f) return;
  f.ruinOn = false;
  f.ruinHp = 0;
  f.abyss = true;
  notes = notes || [];
  notes.push(`${zone} 区变为深渊。`);
  state.units.filter(u => !u.hidden && !u.dead && !u._removed && Number(u.zone) === Number(zone) && !u.flying).forEach(u => {
    applyAbyssFall(u, otherZone(zone), notes);
  });
}

function applyAbyssFall(unit, prevZone, notes) {
  if (!unit || unit.flying || unit.dead || unit.hidden) return false;
  const f = state.fields[unit.zone] || {};
  if (!f.abyss) return false;
  // 配置物（爆炸桶、电池……）没有血量层：掉进深渊直接消失，不引爆（以前读不存在的血量层抛异常，结算中断）
  if (!Array.isArray(unit.layers) || (state.props || []).includes(unit)) {
    state.props = (state.props || []).filter(x => x !== unit);
    if (notes) notes.push(`${unit.name || "配置物"} 掉进深渊，消失了。`);
    return true;
  }
  const loss = Math.floor(totalMaxHp(unit) * 0.1);
  // 环境分数：把敌人弄进深渊（损毁地面塌掉、被击退进去……）——记在场地所有者 / 这次行动的出手方身上
  if (!unit.isPlayer && loss > 0) {
    const who = envCreditUnit(f.by);
    creditPlayerHit(unit, (envOwnerUnit(f.by) || {}).id);   // 深渊：有所有者算所有者，没有就算之前最后打过它的玩家
    if (who) { scoreEnvHit(unit, { total: Math.min(loss, totalHp(unit)), breakDealt: 0 }, who, 0, "深渊"); }
  }
  applyTrueDamage(unit.layers, loss);
  if ((loss || 0) > 0) spawnFloater(unit, loss, "physical");
  let back = Number(prevZone);
  if (!(back >= 1) || back === Number(unit.zone) || (state.fields[back] && state.fields[back].abyss)) {
    back = otherZone(unit.zone);
    if (state.fields[back] && state.fields[back].abyss) {
      back = [1, 2, 3].find(z => z !== Number(unit.zone) && !(state.fields[z] && state.fields[z].abyss)) || 2;
    }
  }
  unit.zone = back;
  // 驻波墙：掉下去再回来不算又穿过一次（进深渊那一下已经在移动里算过）
  if (state._waveLedger && unit.id != null && state._waveLedger[unit.id] != null) state._waveLedger[unit.id] = back;
  notes.push(`${unit.name} 坠入深渊，失去最大生命 10%（${loss}）并回到 ${back} 区。`);
  // 倒地统一结算：力竭 3 即死；起身中的人这 10% 改扣坚毅生命（以前不扣、也不会死）
  applyKnockdown(unit, notes, { shpLoss: loss, cause: "坠落" });
  return true;
}

function tickRuinGround(notes) {
  Object.keys(state.fields || {}).forEach(z => {
    const f = state.fields[z];
    if (!f || !f.ruinOn) return;
    if (f.ruinMax == null) f.ruinMax = Math.max(20, Number(f.ruinHp) || 30);
    const grounds = state.units.filter(u => !u.hidden && !u.dead && !u._removed &&Number(u.zone) === Number(z) && !u.flying);
    grounds.forEach(u => {
      const r = takeDice(1, 6, 0);
      f.ruinHp = Math.max(0, (Number(f.ruinHp) || 0) - r.total);
      notes.push(`${z} 区损毁地面因 ${u.name} 损失耐久 ${r.text} → ${f.ruinHp}/${f.ruinMax}`);
    });
    if (f.ruinHp <= 0) {
      notes.push(`${z} 区损毁地面耐久归零，变为深渊。`);
      destroyRuinGround(z, notes);
    }
  });
}

function fieldTags(f) {
  const a = [];
  if (fieldFireOn(f)) a.push("火场" + f.fire);
  if (f.collapseOn) a.push("塌陷" + (Number(f.collapse) || 0) + "/5");
  if (f.ruinOn) a.push("损毁" + (Number(f.ruinHp) || 0) + "/" + (Number(f.ruinMax) || 0));
  if (f.electric) a.push("高压");
  if (f.acid) a.push("酸液");
  if (f.ice) a.push("冻土");
  if (f.quicksand) a.push("流沙");
  if (f.coral) a.push("沙珊瑚台地（高地）");
  if (f.energy) a.push("能量场" + (f.energyVal ? f.energyVal : ""));
  if (f.harmonic) a.push("干涉");
  if (f.heal) a.push("治愈");
  if (f.highland) a.push("高地");
  if (f.abyss) a.push("深渊");
  if (f.isolate) a.push("隔离");
  if (f.fieldLock) a.push("锁定:" + f.fieldLock);
  if (f.innate && state.combatStarted) a.push("固有");
  return a.join(" · ");
}

function tokenLayout(n) {
  if (n <= 0) return [];
  if (n === 1) return [{ x: 50, y: 50 }];
  if (n === 2) return [{ x: 28, y: 50 }, { x: 72, y: 50 }];
  if (n === 3) return [{ x: 50, y: 24 }, { x: 24, y: 76 }, { x: 76, y: 76 }];
  if (n === 4) return [{ x: 26, y: 26 }, { x: 74, y: 26 }, { x: 26, y: 76 }, { x: 74, y: 76 }];
  if (n === 5) return [{ x: 50, y: 22 }, { x: 80, y: 42 }, { x: 68, y: 78 }, { x: 32, y: 78 }, { x: 20, y: 42 }];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push({ x: 50 + 34 * Math.cos(a), y: 50 + 32 * Math.sin(a) });
  }
  return pts;
}

function unitCard(u, pos) {
  const wrap = document.createElement("div");
  wrap.className = "token-wrap";
  if (pos) {
    wrap.style.left = pos.x + "%";
    wrap.style.top = pos.y + "%";
  }
  const el = document.createElement("div");
  el.className = "unit-token " + (u.isPlayer ? "side-player" : "side-enemy") + (u.dead ? " dead-fade" : "");
  if (u.id === state.targetId) el.classList.add("active-target");
  if (u.id === state.attackerId) el.classList.add("active-attacker");
  const flags = [];
  if (u.flying) flags.push("飞");
  if (isEffectivelyStunned(u)) flags.push("晕");
  if (u.dying) flags.push("濒");
  if (u.upOnShp) flags.push("起");
  if (u.dead) flags.push("亡");
  if (u.self && u.self !== "none") flags.push(selfName(u.self) + (u.self === "burn" && u.selfBurnStacks ? "×" + u.selfBurnStacks : ""));
  hungAtkFx(u).forEach(id => { if (ATKFX[id]) flags.push("挂" + ATKFX[id].name); });
  const st = statusLine(u);
  el.innerHTML = `
    <div class="name">${escapeHtml(u.name)}</div>
    <div class="token-lv">Lv${u.level} · ${u.ap || 0}行 ${u.bonus || 0}附${u.kit === "ufo_body" ? (u.stunned ? " · 失衡可协助打本体" : " · 不可直击") : ""}${u.kit === "ufo_leg" ? " · 无架势" : ""}</div>
    <div class="bars">${(u.layers || []).map(l => {
      const pct = Math.max(0, Math.min(100, (Number(l.current) / Math.max(1, Number(l.max))) * 100));
      return `<div class="bar-label"><span>${LAYER[l.type] || l.type}</span><span>${round2(l.current)}/${l.max}</span></div>
        <div class="bar"><span style="width:${pct}%;background:${LAYER_COLOR[l.type] || "#888"}"></span></div>`;
    }).join("")}
      ${u.noPosture || u.kit === "ufo_leg" ? "" : `<div class="bar-label"><span>架势</span><span>${defText(u)}</span></div>
      <div class="bar def-bar"><span style="width:${Math.max(0, Math.min(100, (Number(u.def) / Math.max(1, Number(u.defMax))) * 100))}%"></span></div>`}
    </div>
    <div class="token-atk">ATK ${effectiveAtk(u, state.units)}</div>
    <div class="status-line">${escapeHtml([st, flags.join(" ")].filter(Boolean).join(" · "))}</div>
  `;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    calcCommand("clickUnit", { actor: u.id });
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    calcCommand("clearSelection");
  });
  wrap.appendChild(el);
  attachFloaters(wrap, u.id);
  const selected = u.id === state.selectedId || u.id === state.attackerId;
  if (selected) {
    const maxZ = Number(state.zoneMode);
    const z = Number(u.zone);
    [-1, 1].forEach(d => {
      const dest = z + d;
      if (dest < 1 || dest > maxZ) return;
      const b = document.createElement("button");
      b.className = "btn small token-shift " + (d < 0 ? "shift-left" : "shift-right");
      b.textContent = d < 0 ? `← ${dest}` : `${dest} →`;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        calcCommand("move", { actor: u.id, dest });
      });
      wrap.appendChild(b);
    });
  }
  return wrap;
}

/** 协助格挡成功：格挡者承担这一击的击破（最少留 1），目标不扣（engine.js · resolveAttack 的 helperBreak） */
function applyBlockBreakToHelper(helperId, amount) {
  const notes = [];
  const helper = unitById(helperId);
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  if (!helper || amount <= 0) return notes;
  const before = Number(helper.def) || 0;
  if (before <= 0) {
    notes.push(`${helper.name} 架势已空，协助格挡不再扣架势。`);
    return notes;
  }
  helper.def = Math.max(1, before - amount);
  notes.push(`${helper.name} 因协助格挡失去 ${amount} 架势：${before} → ${helper.def}（最少留 1，不会失衡）`);
  return notes;
}

function clearUnitSelection() {
  state.selectedId = null;
  state.attackerId = null;
  state.targetId = null;
  state.pickActor = false;
  const st = uiEl("skillTargetSel");
  const as = uiEl("attackerSel");
  const ts = uiEl("targetSel");
  if (st) st.value = "";
  if (as) as.value = "";
  if (ts) ts.value = "";
  renderAll();
}

function onUnitClick(id) {
  const step = flowStep();
  if (state.skillFlow && step && step.type === "unit") {
    const ok = (step.units || []).some(u => u.id === id);
    if (ok) { applyFlowPick(id); return; }
    appendLog("当前步骤不能选这个单位。");
    return;
  }
  state.selectedId = id;
  if (state.pickActor) {
    state.attackerId = id;
    state.pickActor = false;
  } else if (!state.attackerId) {
    state.attackerId = id;
  } else if (id === state.attackerId) {
    state.pickActor = true;
    appendLog("再点一个单位，将其设为行动发起者。");
  } else {
    state.targetId = id;
  }
  const actor = unitById(state.attackerId);
  if (actor && actor.suggest) fillFromSuggest(actor);
  renderAll();
  const st = uiEl("skillTargetSel");
  const as = uiEl("attackerSel");
  const ts = uiEl("targetSel");
  if (as && state.attackerId) as.value = state.attackerId;
  if (st && state.targetId) st.value = state.targetId;
  if (ts && state.targetId) ts.value = state.targetId;
}

function selfName(k) {
  return ({
    none: "无", burn: "自焚", frost: "霜结", splash: "溅射",
    conductor: "导体", anchor: "千钧", store: "蓄能", doppler: "多普勒",
    frenzy: "狂暴"   // 下水道狂鼠（effects.js · FRENZY）
  })[k] || k;
}

function fieldUnits() {
  return state.units.filter(u => u && u.id && !u.hidden && !u.dead && !u._removed);
}

function optionExists(el, value) {
  if (!value) return false;
  return Array.from(el.options || []).some(o => o.value === value);
}

function renderSelects() {
  if (!HAS_DOM) return;
  const validIds = new Set(fieldUnits().map(u => u.id));
  (state.props || []).forEach(p => validIds.add("prop:" + p.id));
  Object.keys(state.gaps || {}).forEach(k => {
    const g = state.gaps[k];
    if (g && (g.type === "wall" || g.type === "bridge")) validIds.add("gap:" + k);
  });
  if (state.attackerId && !validIds.has(state.attackerId)) state.attackerId = null;
  if (state.targetId && !validIds.has(state.targetId)) state.targetId = null;
  if (state.selectedId && !validIds.has(state.selectedId)) state.selectedId = null;

  const fill = (sel, cur) => {
    const el = uiEl(sel);
    if (!el) return;
    const unitOpts = fieldUnits().map(u =>
      `<option value="${u.id}">${escapeHtml(u.name)} @${u.zone}区</option>`).join("");
    const propOpts = (state.props || []).map(p =>
      `<option value="prop:${p.id}">${escapeHtml(p.name)} @${p.zone}区</option>`).join("");
    const gapOpts = Object.keys(state.gaps || {}).filter(k => {
      const g = state.gaps[k];
      return g && (g.type === "wall" || g.type === "bridge");
    }).map(k => `<option value="gap:${k}">间隔 ${k} · ${gapLabel(state.gaps[k].type)}</option>`).join("");
    el.innerHTML = `<option value="">（无）</option>` + unitOpts + propOpts + gapOpts;
    el.value = (cur && optionExists(el, cur)) ? cur : "";
  };
  fill("attackerSel", state.attackerId);
  fill("targetSel", state.targetId);
  const st = uiEl("skillTargetSel");
  if (st) {
    st.innerHTML = `<option value="">（无）</option>` + fieldUnits().map(u =>
      `<option value="${u.id}">${escapeHtml(u.name)} @${u.zone}区</option>`).join("");
    const prefer = (state.targetId && validIds.has(state.targetId)) ? state.targetId : "";
    st.value = optionExists(st, prefer) ? prefer : "";
  }
}

function renderDist() {
  if (!HAS_DOM) return;
  const a = unitById(state.attackerId);
  const t = unitById(state.targetId);
  const hint = uiEl("distHint");
  if (!a || !t) { hint.textContent = "请选择攻击者与受击者。"; return; }
  const d = zoneDist(a.zone, t.zone, state.zoneMode);
  const isoA = state.fields[a.zone] && state.fields[a.zone].isolate;
  const isoT = state.fields[t.zone] && state.fields[t.zone].isolate;
  let extra = "";
  if (state.weather === "sand") {
    extra += ` 沙暴：电/酸伤害 −25%，沙尘回复翻倍。`;
    extra += ` 攻击者${sandWindActionText(a)}；受击者${sandWindActionText(t)}。`;
  }
  const blocked = lineBlocked(a.zone, t.zone);
  hint.textContent = `当前距离 ${d}（同区=0）。${blocked ? blocked : ""} ${isoT ? "受击者处于隔离区，结算时忽略天气。" : ""} ${isoA ? "攻击者处于隔离区。" : ""}${extra}`;
}

function sandWindActionText(u) {
  if (!u) return "无风向";
  if (state.fields[u.zone] && state.fields[u.zone].isolate) return "隔离区（无视天气风向）";
  const w = sandWind(u.zone, state.zoneMode, state.sandDir);
  if (w === 0) {
    if (Number(state.zoneMode) >= 3) return `${u.zone}区在风向中线上，无风向（沙尘回复仍翻倍）`;
    return "无风向";
  }
  if (w > 0) return u.flying ? "顺风·空中（+1 行动点）" : "顺风·地面（+1 附赠行动）";
  if (u.flying && !u.isPlayer && typeof enemyRankOf === "function" && enemyRankOf(u) === "minion") return `逆风·空中（−1 行动点，杂兵有 ${Math.round(SAND_HEADWIND_KEEP * 100)}% 顶住）`;
  return u.flying ? "逆风·空中（−1 行动点）" : "逆风·地面（无额外行动变化）";
}

function renderEditor() {
  if (!HAS_DOM) return;
  const box = uiEl("unitEditor");
  const u = unitById(state.selectedId);
  if (!u) { box.innerHTML = `<p class="hint">先在战场里点一个单位。</p>`; return; }
  box.innerHTML = `
    <div class="row">
      <label class="field">名称<input id="edName" value="${escapeAttr(u.name)}"></label>
      <label class="field">等级<input id="edLv" type="number" min="1" value="${u.level}"></label>
      <label class="field">所在区<select id="edZone">${[1,2,3].map(z => `<option value="${z}" ${Number(u.zone)===z?"selected":""}>${z} 区</option>`).join("")}</select></label>
      <label class="field">ATK<input id="edAtk" type="number" value="${u.atk}"></label>
      <label class="field">当前架势<input id="edDef" type="number" value="${u.def}"></label>
      <label class="field">架势上限<input id="edDefMax" type="number" value="${u.defMax}"></label>
      <label class="field">高能值<input id="edHE" type="number" value="${u.highEnergy || 0}"></label>
    </div>
    <div class="chk" style="margin-top:8px">
      <label><input id="edFly" type="checkbox" ${u.flying?"checked":""}> 飞行</label>
      <label><input id="edStun" type="checkbox" ${u.stunned?"checked":""}> 晕眩</label>
    </div>
    <div class="section-title">移动（每次 1 格，耗附赠行动）</div>
    <div class="row" id="edMoveBtns"></div>
    <p class="hint">三区不能从 1 直接到 3。冻土离开要检定；酸液地面离开耗行动点。这些请你记账，程序会改区域并结算进入冻土的 1 击破。</p>
    <div class="section-title">血量层（上 = 最外层）</div>
    <div id="edLayers"></div>
    <div class="row">
      <button class="btn small" id="addLayer">加一层</button>
    </div>
    <div class="section-title">属性状态（占效果位）</div>
    <div class="chk">
      <label>灼烧层 <input id="stBurn" type="number" min="0" value="${u.statuses.burn||0}" style="width:52px"></label>
      <label><input id="stShock" type="checkbox" ${u.statuses.shock?"checked":""}> 感电</label>
      <label><input id="stCorr" type="checkbox" ${u.statuses.corr?"checked":""}> 腐蚀</label>
      <label><input id="stFrost" type="checkbox" ${u.statuses.frostbite?"checked":""}> 冻伤</label>
      <label><input id="stWave" type="checkbox" ${u.statuses.shockwave?"checked":""}> 震荡</label>
      <label><input id="stHigh" type="checkbox" ${u.statuses.high?"checked":""}> 高能</label>
      <label><input id="stReso" type="checkbox" ${u.statuses.reso?"checked":""}> 共振</label>
    </div>
    <div class="section-title">通用状态</div>
    <div class="chk">
      <label><input id="stUn" type="checkbox" ${u.statuses.unstable?"checked":""}> 不稳</label>
      <label><input id="stWeak" type="checkbox" ${u.statuses.weak?"checked":""}> 虚弱</label>
      <label><input id="stInsp" type="checkbox" ${u.statuses.inspire?"checked":""}> 振奋</label>
      <label><input id="stHide" type="checkbox" ${u.statuses.hide?"checked":""}> 躲藏</label>
      <label><input id="stAdv" type="checkbox" ${u.statuses.advantage?"checked":""}> 优势</label>
    </div>
    <div class="section-title">即时效果</div>
    <div class="chk">
      <label><input id="inMelt" type="checkbox" ${u.instant.melt?"checked":""}> 熔融</label>
      <label><input id="inSting" type="checkbox" ${u.instant.sting?"checked":""}> 刺骨</label>
      <label><input id="inOver" type="checkbox" ${u.instant.overload?"checked":""}> 过载</label>
      <label><input id="inShift" type="checkbox" ${u.instant.shift?"checked":""}> 错位</label>
      <label><input id="inSpread" type="checkbox" ${u.instant.spread?"checked":""}> 扩散</label>
      <label><input id="inRef" type="checkbox" ${u.instant.refract?"checked":""}> 折射</label>
      <button class="btn small" id="btnNeutralize">结算中和</button>
    </div>
    <div class="section-title">属性专属攻击效果（挂下一击，可与穿刺/猛击同挂）</div>
    <div class="chk">
      ${["combust","icebreak","bolt","etch","backflow","inertia","diffract"].map(id => {
        const on = (u.resources && u.resources.nextAtkFx || []).indexOf(id) >= 0;
        return '<label><input id="fxHang_' + id + '" type="checkbox" ' + (on ? "checked" : "") + '> ' + ATKFX[id].name + '</label>';
      }).join("")}
    </div>
    <div class="section-title">自我效果（同时仅一种）</div>
    <label class="field">当前自我效果
      <select id="edSelf">
        <option value="none">无</option>
        <option value="burn">火 · 自焚</option>
        <option value="frost">冰 · 霜结</option>
        <option value="splash">酸 · 溅射</option>
        <option value="conductor">电 · 导体</option>
        <option value="anchor">物理 · 千钧</option>
        <option value="store">能量 · 蓄能</option>
        <option value="doppler">谐波 · 多普勒</option>
      </select>
    </label>
    <label class="field">扩散用：最新状态属性
      <select id="edLatest">
        <option value="">无</option>
        ${Object.keys(ELE).map(k => `<option value="${k}" ${u.statuses.latestElement===k?"selected":""}>${ELE[k]}</option>`).join("")}
      </select>
    </label>
    <div class="row" style="margin-top:8px">
      <button class="btn danger small" id="delUnit">移出战场</button>
      <button class="btn small" id="copyUnit">复制单位</button>
      <button class="btn small" id="fullDef">回满架势</button>
      <button class="btn ok small" id="saveThisCard">存进卡组</button>
    </div>
  `;
  uiEl("edSelf").value = u.self || "none";
  const moveBox = uiEl("edMoveBtns");
  const maxZ = Number(state.zoneMode);
  const z0 = Number(u.zone);
  [-1, 1].forEach(d => {
    const dest = z0 + d;
    if (dest < 1 || dest > maxZ) return;
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = `移动到 ${dest} 区`;
    b.onclick = () => calcCommand("move", { actor: u.id, dest });
    moveBox.appendChild(b);
  });
  drawLayers(u);
  const bind = (id, fn) => {
    const el = uiEl(id);
    if (!el) return;
    el.addEventListener("input", fn);
    el.addEventListener("change", fn);
  };
  const editField = (field, value) => calcCommand("unitField", { actor: u.id, field, value });
  bind("edName", () => editField("name", uiEl("edName").value));
  bind("edLv", () => editField("level", Number(uiEl("edLv").value) || 1));
  bind("edZone", () => calcCommand("unitZone", { actor: u.id, dest: Number(uiEl("edZone").value) }));
  ["edAtk", "edDef", "edDefMax", "edHE"].forEach((id, i) => bind(id, () => editField(["atk", "def", "defMax", "highEnergy"][i], Number(uiEl(id).value) || 0)));
  bind("edFly", () => editField("flying", uiEl("edFly").checked));
  bind("edStun", () => editField("stunned", uiEl("edStun").checked));
  bind("stBurn", () => calcCommand("status", { actor: u.id, key: "burn", value: Number(uiEl("stBurn").value) || 0 }));
  const statuses = { Shock: "shock", Corr: "corr", Frost: "frostbite", Wave: "shockwave", High: "high", Reso: "reso", Un: "unstable", Weak: "weak", Insp: "inspire", Hide: "hide", Adv: "advantage" };
  Object.entries(statuses).forEach(([key, status]) => bind("st" + key, () => calcCommand("status", { actor: u.id, key: status, value: uiEl("st" + key).checked })));
  const imap = { inMelt: "melt", inSting: "sting", inOver: "overload", inShift: "shift", inSpread: "spread", inRef: "refract" };
  Object.entries(imap).forEach(([id, key]) => bind(id, () => calcCommand("instant", { actor: u.id, key, value: uiEl(id).checked })));
  const neu = uiEl("btnNeutralize");
  if (neu) neu.onclick = () => calcCommand("neutralize", { actor: u.id });
  bind("edSelf", () => calcCommand("self", { actor: u.id, value: uiEl("edSelf").value }));
  bind("edLatest", () => calcCommand("status", { actor: u.id, key: "latestElement", value: uiEl("edLatest").value || null }));
  ["combust", "icebreak", "bolt", "etch", "backflow", "inertia", "diffract"].forEach(key => bind("fxHang_" + key, () => calcCommand("hang", { actor: u.id, key, value: uiEl("fxHang_" + key).checked })));
  uiEl("addLayer").onclick = () => calcCommand("unitLayer", { actor: u.id, op: "add" });
  uiEl("delUnit").onclick = () => calcCommand("removeUnit", { actor: u.id });
  uiEl("copyUnit").onclick = () => calcCommand("copyUnit", { actor: u.id });
  uiEl("fullDef").onclick = () => calcCommand("fullDef", { actor: u.id });
  uiEl("saveThisCard").onclick = () => calcCommand("rosterSaveUnit", { actor: u.id });
}

function drawLayers(u) {
  if (!HAS_DOM) return;
  const box = uiEl("edLayers");
  if (!box) return;
  box.innerHTML = u.layers.map((l, i) => `
    <div class="layer-row">
      <select data-i="${i}" data-f="type">${Object.keys(LAYER).map(k => `<option value="${k}" ${l.type===k?"selected":""}>${LAYER[k]}</option>`).join("")}</select>
      <input data-i="${i}" data-f="current" type="number" value="${l.current}" title="当前">
      <input data-i="${i}" data-f="max" type="number" value="${l.max}" title="上限">
      <button class="btn small danger" data-del="${i}">×</button>
    </div>`).join("");
  box.querySelectorAll("select,input").forEach(el => {
    el.addEventListener("input", () => {
      const i = Number(el.dataset.i);
      const f = el.dataset.f;
      calcCommand("unitLayer", { actor: u.id, op: "set", index: i, field: f, value: f === "type" ? el.value : Number(el.value) });
    });
  });
  box.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      calcCommand("unitLayer", { actor: u.id, op: "remove", index: Number(btn.dataset.del) });
    });
  });
}

function fillFromSuggest(u) {
  if (!HAS_DOM) return;
  uiEl("atk").value = u.atk;
  if (u.suggest) {
    uiEl("element").value = u.suggest.element;
    uiEl("diceN").value = u.suggest.dice[0];
    uiEl("diceS").value = u.suggest.dice[1];
    uiEl("flat").value = u.suggest.flat || 0;
    uiEl("baseBreak").value = u.suggest.baseBreak || 1;
    uiEl("atkRange").value = u.range || "melee";
  }
}

function collectFlags() {
  return {
    pierce: uiEl("fPierce").checked,
    smash: uiEl("fSmash").checked,
    weak: uiEl("fWeak").checked,
    action: uiEl("fAction").checked,
    assist: uiEl("fAssist").checked,
    aoe: uiEl("fAoe").checked,
    doubleDeal: uiEl("fDoubleDeal").checked,
    doubleTake: uiEl("fDoubleTake").checked,
    dr50: uiEl("fDR50").checked,
    immune: uiEl("fImmune").checked,
    junAdd: uiEl("fJunAdd").checked,
    dopplerCloser: uiEl("fDopplerCloser").checked,
    dopplerFarther: uiEl("fDopplerFarther").checked,
    block: uiEl("blockResult").value
  };
}

function readCalcInput() {
  const input = { flags: collectFlags() };
  ["attackerSel", "targetSel", "element", "atk", "mult", "flat", "baseBreak", "hits", "atkRange", "diceN", "diceS", "diceB", "diceMode", "diceManual"].forEach(id => { input[id] = uiEl(id).value; });
  return input;
}
function calcCommand(action, data) { return Commands.dispatch(Object.assign({ type: "calc", action }, data || {})); }
function backstageCommand(action, data) { return Commands.dispatch(Object.assign({ type: "backstage", action }, data || {})); }
function diceValueNow(input) {
  input = input || readCalcInput();
  const n = Number(input.diceN) || 0;
  const s = Number(input.diceS) || 0;
  const b = Number(input.diceB) || 0;
  const mode = input.diceMode;
  if (mode === "manual") return { value: Number(input.diceManual) || 0, text: "手动 " + input.diceManual };
  if (mode === "roll") {
    const r = rollDice(n, s, b);
    if (uiEl("diceManual")) uiEl("diceManual").value = r.total;
    return { value: r.total, text: `掷出 ${r.parts.join("+")}${b ? (b >= 0 ? "+" : "") + b : ""} = ${r.total}` };
  }
  const v = diceExpect(n, s, b);
  return { value: v, text: `期望 ${n}d${s}${b ? (b >= 0 ? "+" : "") + b : ""} = ${round2(v)}` };
}

function currentWeatherFor(unit) {
  if (!unit) return state.weather;
  if (unit.shelterTurn || unit.isolate) return "none";
  const f = state.fields[unit.zone];
  if (f && f.isolate) return "none";
  return state.weather;
}
/** 这一区的天气：隔离区不受天气影响（火场叠层这类按区结算的用它，不看单位身上的保释） */
function zoneWeather(zone) {
  const f = state.fields[zone];
  return f && f.isolate ? "none" : state.weather;
}
/** 保释：此回合豁免天气与场地——场地伤害、场地的回合开始 / 结束效果、冻土、干涉、高压都不吃 */
function fieldExempt(unit) {
  return !!(unit && (unit.shelterTurn || unit.isolate));
}

/* ---------- 流沙（场地 quicksand）：下陷 u.sink 0–3，越挣扎陷得越深 ----------
 *   走进流沙 +1；回合结束时，这回合在流沙里花过行动点 +1，一个行动点都没花 −1（冷静下来慢慢浮出）。
 *   每回合开始：失去 生命上限 × 5% × 下陷层数（窒息：不分属性、不吃克制、没有击破）。
 *   下陷 2 层起自己走不出去（技能里的移动也不行）；被同伴「拉出流沙」或者被任何位移带出这一区，下陷清零。
 *   3 层「没顶」：不能用行动点和附赠动作，也不能协助攻击 / 协助格挡，直到脱困（下陷降到 2 层以下）。
 *   飞行、保释 / 隔离中的单位不受影响；沙灵和沙漠生物（沙里的原住民）完全免疫。 */
const QUICKSAND = { maxSink: 3, pctPerSink: 0.05, stuckAt: 2, lockAt: 3, natives: ["沙灵", "沙漠生物"] };
function quicksandImmune(u) {
  if (!u || u.flying || !Array.isArray(u.layers) || fieldExempt(u)) return true;
  const fac = !u.isPlayer && typeof factionOf === "function" ? factionOf(u) : null;
  return !!fac && QUICKSAND.natives.indexOf(fac) >= 0;
}
function inQuicksand(u) {
  if (!u || offField(u)) return false;
  const f = state.fields && state.fields[u.zone];
  return !!(f && f.quicksand) && !quicksandImmune(u);
}
function sinkOf(u) { return Math.max(0, Number(u && u.sink) || 0); }
/** 自己走不出流沙（2 层起） */
function sinkStuck(u) { return inQuicksand(u) && sinkOf(u) >= QUICKSAND.stuckAt; }
/** 没顶（3 层）：不能用行动点、附赠动作，不能协助 */
function sinkLocked(u) { return inQuicksand(u) && sinkOf(u) >= QUICKSAND.lockAt; }
function addSink(u, n, notes, why) {
  if (!inQuicksand(u)) return;
  const before = sinkOf(u);
  const after = Math.max(0, Math.min(QUICKSAND.maxSink, before + n));
  if (after === before) return;
  u.sink = after;
  if (notes) {
    notes.push(`${u.name} ${why ? why + "：" : ""}下陷 ${before} → ${after}` +
      (after >= QUICKSAND.lockAt ? "（没顶：不能用行动点和附赠动作，也不能协助）"
        : after >= QUICKSAND.stuckAt && before < QUICKSAND.stuckAt ? "（自己走不出去了）" : "") + "。");
  }
}
function clearSink(u, notes, why) {
  if (!u || !sinkOf(u)) { if (u) u.sink = 0; return; }
  u.sink = 0;
  if (notes) notes.push(`${u.name} ${why || "离开流沙"}，下陷清零。`);
}
/** 回合结束：这回合花过行动点就陷得更深，没花就慢慢浮出来。sideIsPlayer：结算哪一方 */
function quicksandTurnEnd(sideIsPlayer, notes) {
  (state.units || []).forEach(u => {
    if (!!u.isPlayer !== !!sideIsPlayer) return;
    const spent = !!u._sinkSpent;
    u._sinkSpent = false;
    if (!inQuicksand(u)) { if (sinkOf(u)) clearSink(u, notes, "不在流沙里"); return; }
    addSink(u, spent ? 1 : -1, notes, spent ? "在流沙里挣扎" : "没有挣扎，慢慢浮出");
  });
}
/** 回合开始：窒息伤害 */
function tickQuicksandFor(u, notes) {
  if (!inQuicksand(u) || !sinkOf(u)) return;
  const pct = QUICKSAND.pctPerSink * sinkOf(u) * envMult(u);
  const dmg = Math.max(1, Math.floor(totalMaxHp(u) * pct));
  applyTrueDamage(u.layers, dmg);
  spawnFloater(u, dmg, "physical");
  notes.push(`${u.name} 下陷 ${sinkOf(u)} 层，窒息：失去生命上限 ${Math.round(pct * 100)}%（${dmg}）。`);
  applyKnockdown(u, notes, { shpLoss: dmg, cause: "窒息" });
}
/** 拉出流沙（我方通用动作，附赠）：同区或相邻区一名下陷的友方，下陷清零；在相邻区就把他拉到自己这一区 */
function sandPullTargets(a) {
  if (!a) return [];
  return fieldUnits().filter(u => u.isPlayer && u.id !== a.id && !u.dead && inQuicksand(u) && sinkOf(u) > 0 &&
    zoneDist(Number(a.zone), Number(u.zone), state.zoneMode) <= 1 && !lineBlocked(a.zone, u.zone));
}
function runSandPull(a, t, lines) {
  if (!t || sandPullTargets(a).indexOf(t) < 0) { lines.push("先选一名陷在流沙里的友方（同区或相邻区）。"); return; }
  if (Number(t.zone) !== Number(a.zone)) {
    displaceTo(t, Number(a.zone), lines, `被 ${a.name} 拉出流沙`);
    clearSink(t, lines, "被拉出流沙");
  } else {
    clearSink(t, lines, `被 ${a.name} 拽了上来`);
  }
}
/** 恶劣环境（这个单位，到回合结束）/ 末日（整场，无法停止）：天气与场地效果翻倍；两个叠加再翻一倍（×4）。返回 1 / 2 / 4 */
function envMult(unit) {
  return (state.apocalypse ? 2 : 1) * (unit && unit.harshEnv ? 2 : 1);
}
/** 加倍计量：这个单位身上所有状态此回合效果翻倍（状态结算的伤害、击破、高能累积 ×2）。返回 2 或 1 */
function statusMult(unit) {
  return unit && unit.instant && unit.instant.doubleStatus ? 2 : 1;
}

function doCalc(input) {
  input = input || readCalcInput();
  const attacker = unitById(input.attackerSel);
  const targetTok = input.targetSel;
  if (targetTok && (String(targetTok).indexOf("gap:") === 0 || String(targetTok).indexOf("prop:") === 0)) {
    hitStructure(attacker, targetTok, {
      element: input.element,
      dmg: Number(input.atk) * Number(input.mult) + Number(input.flat),
      brk: Number(input.baseBreak) || 1
    });
    return;
  }
  const target = unitById(targetTok);
  state.attackerId = attacker ? attacker.id : null;
  state.targetId = target ? target.id : null;
  let dice = diceValueNow(input);
  const flags = Object.assign({}, input.flags);
  if (shouldDiceMin(attacker)) {
    const n = Number(input.diceN) || 0;
    const b = Number(input.diceB) || 0;
    if (input.diceMode !== "manual") {
      dice = { value: n + b, text: `决一死战取最低 ${n}×1${b ? "+" + b : ""} = ${n + b}` };
    }
    flags.diceMin = true;
  }
  const bearer = shieldBearer(target);
  if (bearer && flags.action) flags.holyShield = true;
  const dist = attacker && target ? zoneDist(attacker.zone, target.zone, state.zoneMode) : 0;
  const res = resolveAttack({
    attacker, target,
    atk: Number(input.atk),
    mult: Number(input.mult),
    flat: Number(input.flat),
    diceValue: dice.value,
    element: input.element,
    baseBreak: Number(input.baseBreak),
    hits: Number(input.hits),
    flags,
    weather: currentWeatherFor(target),
    phaseStep: Number(state.phaseStep),
    zoneMode: state.zoneMode,
    attackerField: attacker ? state.fields[attacker.zone] : {},
    targetField: target ? state.fields[target.zone] : {},
    highA: attacker && isHighGround(state.fields[attacker.zone]),
    highT: target && isHighGround(state.fields[target.zone]),
    dist,
    atkRange: input.atkRange
  });
  res.diceText = dice.text;
  res.dist = dist;
  res.flags = flags;
  state.lastResult = res;
  paintResult(res, attacker, target);
  renderZones();
}

function paintResult(res, attacker, target) {
  const lines = [];
  if (!res.ok) {
    appendLog((res.log || []).join("\n"));
    return;
  }
  const who = target ? target.name : "目标";
  lines.push(`—— 预览攻击 → ${who} ——`);
  if (res.perHit && res.perHit.length > 1) {
    res.perHit.forEach((h, i) => lines.push(`第${i + 1}击：${Math.floor(h.dealt || 0)} 伤害，击破 ${h.breakDealt || 0}`));
  }
  lines.push(`合计伤害 ${Math.floor(res.total || 0)} · 击破 ${res.breakDealt} · 架势 ${res.defBefore} → ${res.defAfter}`);
  if (res.broke) lines.push(`【失衡】${who} 若应用此次结果，将进入失衡。`);
  if (res.diceText) lines.push(res.diceText + (res.dist != null ? ` · 距离 ${res.dist}` : ""));
  (res.log || []).forEach(l => lines.push(l));
  if (res.sandNote) lines.push(res.sandNote);
  if (res.knockdownHp) lines.push(`击落预扣 ${res.knockdownHp}`);
  if (res.selfBreak) lines.push(`猛击将使 ${attacker ? attacker.name : "攻击者"} 失去 ${res.selfBreak} 架势`);
  appendLog(lines.join("\n"));
}

function doApply(input) {
  input = input || readCalcInput();
  if (!state.lastResult || !state.lastResult.ok) { doCalc(input); }
  const attacker = unitById(input.attackerSel);
  const target = unitById(input.targetSel);
  if (!target || !state.lastResult) return;
  snapshot();
  const extra = applyCombat(target, state.lastResult, attacker);
  if (target.statuses && target.statuses.reso && state.lastResult.total > 0) {
    const share = Math.floor((state.lastResult.total || 0) / 2);
    state.units.filter(u => u.id !== target.id && u.statuses && u.statuses.reso).forEach(u => {
      applyTrueDamage(u.layers, share);
      u.gotHitThisTurn = true;
    });
    extra.push(`共振分享伤害 ${round2(share)} 给其他共振单位（不回传）`);
  }
  renderAll();
  appendLog(`已应用到 ${target.name}。${extra.join("；")}`);
  state.lastResult = null;
}

function phaseWeatherName(step) {
  const n = Number(step);
  if (n === 0) return "波谷";
  if (n === 2) return "波峰";
  return "平衡";
}

/** 相位计数器：从第一次进入相位起持续运行，被其他天气覆盖也照走（state.phaseClock 记着它在跑）；
 *  再次释放驻波时接入当前计数（helu_wave 不再归零） */
function advancePhaseWeather() {
  const notes = [];
  if (state.weather === "phase") state.phaseClock = true;
  if (!state.phaseClock) return notes;
  state.phaseStep = (Number(state.phaseStep) + 1) % 4;
  const sel = uiEl("phaseStep");
  if (sel) sel.value = String(state.phaseStep);
  notes.push(state.weather === "phase"
    ? `相位天气进入下一阶段：${phaseWeatherName(state.phaseStep)}（${state.phaseStep}）。`
    : `相位计数器（被${weatherName(state.weather)}覆盖中）照常走到：${phaseWeatherName(state.phaseStep)}（${state.phaseStep}）。`);
  return notes;
}

function phaseLabelText() {
  if (!state.combatStarted) return "未开始";
  return state.combatPhase === "enemy" ? "敌人回合" : "玩家回合";
}

const WEATHER_CN = { none: "常态", heat: "酷暑", snow: "雪天", acid: "酸雨", thunder: "雷鸣", glow: "微光", sand: "沙暴", phase: "相位" };
function weatherName(w) { return WEATHER_CN[w] || w; }
/** 战斗开始时就存在的天气 / 场地是「固有」的：整场战斗都无法被改变（主持人后台除外）。高地不算场地名额，不影响。 */
function markInnateEnvironment() {
  state.weatherInnate = state.weather && state.weather !== "none" ? state.weather : null;
  const notes = [];
  if (state.weatherInnate) notes.push(`固有天气：${weatherName(state.weatherInnate)}（无法被改变）`);
  Object.keys(state.fields || {}).forEach(z => {
    const f = state.fields[z];
    if (!f) return;
    f.innate = fieldFireOn(f) || FIELD_EFFECT_KEYS.some(k => k !== "highland" && f[k]);
    if (f.innate) notes.push(`${z} 区固有场地：${fieldTags(f) || "场地"}（无法被改变）`);
    else if (f.abyss || f.ruinOn) notes.push(`${z} 区${f.abyss ? "深渊" : "损毁地面"}（无法被改变）`);
  });
  if (notes.length) appendLog(notes.join("\n"));
}
/** 开战时生效的被动升级（被动名带 +） */
function applyPassivePlusAtStart() {
  if (typeof passivePlus !== "function") return;
  const notes = [];
  const hero = (kit) => { const u = findKit(kit, state.units); return u && u.isPlayer && !u.dead && !u.hidden ? u : null; };
  const foes = () => state.units.filter(u => !u.isPlayer && !u.dead && !u.hidden && !u.fused && (u.layers || []).some(l => l.current > 0));
  const helu = hero("helu");
  if (helu && passivePlus(helu, 1)) {   // 频谱分析+：随机一个敌人的外层血量聚焦
    const pool = foes();
    const t = pool[Math.floor(Math.random() * pool.length)];
    if (t) { notes.push("频谱分析+：开局自动聚焦。"); applyFocus(t, ((t.layers || []).find(l => l.current > 0) || {}).type, notes); }
  }
  if (helu && passivePlus(helu, 2)) {   // 环境监测+：随机一个区域扫描出配置物（不触发）
    const z = 1 + Math.floor(Math.random() * (Number(state.zoneMode) || 2));
    notes.push("环境监测+：开局自动环境扫描。");
    heluScanAct(helu, { dest: z, act: "spawn" }, notes);
  }
  const ras = hero("ras");
  if (ras && passivePlus(ras, 1)) {     // 能量流向+：开局光能 = 等级 + 1d6
    const r = takeDice(1, 6, ras.level || 1);
    ras.resources.light = Math.max(Number(ras.resources.light) || 0, r.total);
    notes.push(`能量流向+：开局光能 ${r.text} → ${ras.resources.light}。`);
  }
  const ruby = hero("ruby");
  if (ruby && passivePlus(ruby, 1)) {   // 纳米科技+：初始纳米 60
    ruby.resources.nano = Math.max(Number(ruby.resources.nano) || 0, 60);
    notes.push(`纳米科技+：初始纳米能源 ${ruby.resources.nano}。`);
  }
  const chuan = hero("chuan");
  if (chuan && passivePlus(chuan, 1)) { // 发电站+：开局 1 电能
    chuan.resources.charge = Math.max(Number(chuan.resources.charge) || 0, 1);
    notes.push(`发电站+：开局电能 ${chuan.resources.charge}。`);
  }
  const tou = hero("tou");
  if (tou && passivePlus(tou, 2)) {     // 圣盾荣耀+：开局额外 1 圣盾点
    tou.resources.shield = Math.min(3, (Number(tou.resources.shield) || 0) + 1);
    notes.push(`圣盾荣耀+：开局额外获得 1 圣盾点 → ${tou.resources.shield}。`);
  }
  if (notes.length) appendLog(notes.join("\n"));
}
/** 开战时站在深渊里的地面单位（主持人把整区设成深渊、布阵落在里面）挪到最近的非深渊区，不算坠落。
 *  以前留在深渊里：玩家走不出去，敌人每回合走进去再摔回来，打到超时 */
function liftOutOfAbyss() {
  const abyss = (z) => !!(state.fields[z] && state.fields[z].abyss);
  // 棋盘上真有的区（字段表里可能多出没用到的 3 区）
  const zones = [...new Set((typeof boardLinks === "function" ? boardLinks() : []).flat().map(Number))];
  const safe = zones.filter(z => !abyss(z));
  if (!safe.length) return;
  const moved = [];
  (state.units || []).concat(state.props || []).forEach(u => {
    if (!u || u.flying || u.hidden || u.dead || !abyss(Number(u.zone))) return;
    const z = safe.slice().sort((a, b) => zoneDist(Number(u.zone), a, state.zoneMode) - zoneDist(Number(u.zone), b, state.zoneMode) || a - b)[0];
    u.zone = z;
    moved.push(`${u.name} → ${z} 区`);
  });
  if (moved.length) appendLog(`深渊里站不了人，开战时挪到旁边：${moved.join("，")}。`);
}

function startCombat() {
  if (state.combatStarted) return false;
  state.combatStarted = true;
  state.combatPhase = "player";
  // 按我方实际上场人数平衡敌人（开战前改过队伍也能跟上）
  const partyN = typeof syncPartySizeFromField === "function" ? syncPartySizeFromField() : state.partySize;
  const balanceNotes = typeof rebalanceEnemiesForParty === "function" ? rebalanceEnemiesForParty(partyN) : [];
  applyExhaustionAtStart(balanceNotes);
  // 开场击破记在开战前（第 0 回合），失衡的人第一回合照常跳过
  const openNotes = [];
  applyOpeningBreaks(openNotes);
  if (openNotes.length) appendLog(openNotes.join("\n"));
  // 开战前的布置记录算「第 0 回合」，开战后的第一回合才是第 1 回合
  const prePage = state.logPages[state.logPages.length - 1];
  if (prePage && prePage.lines.length) prePage.turn = 0;
  state.turnNo = 1;
  state.goneFoes = [];   // 新的一场：移出场的敌人名单从空开始
  // 整场战斗的天气开关从这一场开始算：末日（天气与场地翻倍）、相位计数器（开战就是相位天气的从现在开始走，否则第一次进入相位才走）
  state.apocalypse = false;
  state.phaseClock = state.weather === "phase";
  markInnateEnvironment();
  liftOutOfAbyss();
  // 过度自信看的是进入战斗时的血量上限：战斗中上限被抬高（护盾、临时层……）也不影响触发线
  (state.units || []).forEach(u => { if (u.kit === "kolt") u.prideMaxHp = baseMaxHp(u); });
  applyPassivePlusAtStart();
  // 沙漠生物 / 中立生物（desert.js）：夜晚下潜的尘虫、管虫的流沙、伏咬沙鱼埋伏
  if (typeof desertBattleStart === "function") { const dn = []; desertBattleStart(dn); if (dn.length) appendLog(dn.join("\n")); }
  // 专长（feats.js · hooks.battleStart）：开战时
  if (typeof featHook === "function") {
    const featNotes = [];
    (state.units || []).forEach(u => { if (u.isPlayer && !u.dead && !u.hidden) featHook(u, "battleStart", undefined, featNotes); });
    if (featNotes.length) appendLog(featNotes.join("\n"));
  }
  beginRound([]);
  startPlayerPhase();
  if (typeof ratfolkBattleStart === "function") ratfolkBattleStart();   // 下水道狂鼠：记下开战时的血量（暴虐猎手斩杀看「降到」，enemies.js）
  appendLog("战斗开始。回合开始效果已结算。", "sep");
  if (state.ambush) appendLog("遭遇战：长休时被偷袭，我方来不及反应，跳过第一回合（没有行动点和附赠动作）。");
  balanceNotes.forEach(t => appendLog(t));
  if (typeof applyTheme === "function") applyTheme();
  if (typeof renderAll === "function") renderAll();
  return true;
}

function canControlUnit(u) {
  if (!state.combatStarted) return false;
  if (!u || u.hidden || u.dead) return false;
  if (isEffectivelyStunned(u) && !u.isPlayer) return false;
  if (state.combatPhase === "enemy") return !u.isPlayer;
  return !!u.isPlayer;
}

/** 沙暴逆风：飞行的杂兵有 25% 概率顶住风、不扣行动点（精英、首领照扣） */
const SAND_HEADWIND_KEEP = 0.25;
function refreshEnemyEconomy(u, notes) {
  if (!u || u.isPlayer) return;
  const loseAp = !!u.loseApNext;   // 「下回合失去行动点」（同 refreshEconomy）
  u.loseApNext = false;
  if (u.stunned || u.dead) {
    u.ap = 0; u.apMax = 0; u.bonus = 0; u.bonusMax = 0;
    return;
  }
  const bud = enemyActBudget(u);
  let ap = bud.ap;
  let bonus = bud.bonus;
  const iso = state.fields[u.zone] && state.fields[u.zone].isolate;
  if (state.fields[u.zone] && state.fields[u.zone].energy) ap += 1;
  if (!iso && state.weather === "sand") {
    const w = sandWind(u.zone, state.zoneMode, state.sandDir);
    if (u.flying && w > 0) ap += 1;
    if (u.flying && w < 0) {
      const minion = (typeof enemyRankOf === "function" ? enemyRankOf(u) : "minion") === "minion";
      if (minion && Math.random() < SAND_HEADWIND_KEEP) {
        if (notes) notes.push(`${u.name} 顶住了逆风：这回合不扣行动点。`);
      } else ap -= 1;
    }
    if (!u.flying && w > 0) bonus += 1;
  }
  // 种族被动（enemies.js）：千里马第一回合 +1 附赠（在不稳之前加，不稳只扣 1，抵得掉）。
  // 只在真正的敌人回合开始（startEnemyPhase 传了 notes）才算一个回合；生成时的初始化不算
  if (notes && typeof raceBonusExtra === "function") bonus += raceBonusExtra(u);
  // 载具驾驶员每回合最少 1 个附赠（移动 / 冲撞）：也是加成，在扣之前托底
  if (typeof vehicleBonusFloor === "function") bonus = vehicleBonusFloor(u, bonus);
  // 不稳 / 空手格挡：和玩家同一个顺序，所有加成算完再各 −1
  bonus = applyBonusPenalties(u, bonus, notes);
  // 易怒蛮牛发作后这回合没有附赠（载具驾驶员也一样是 0）
  if (u.raceNoBonus) {
    u.raceNoBonus = false;
    bonus = 0;
    if (notes) notes.push(`${u.name} 易怒蛮牛：这回合失去附赠动作。`);
  }
  if (loseAp) ap = 0;
  u.ap = Math.max(0, ap);
  u.apMax = u.ap;
  u.bonus = Math.max(0, bonus);
  u.bonusMax = Math.max(u.bonus, bonus);
  if (typeof vehicleEconomy === "function") vehicleEconomy(u);   // 载具驾驶员：附赠上限对齐（最少 1 已在扣之前托底）
}

function beginRound(notes) {
  notes = notes || [];
  startLogTurn();
  // 易怒蛮牛（enemies.js · raceAfterHurt）：每回合最多发作一次，新回合重新可以触发
  state.units.forEach(u => { if (u && u.raceRageUsed) u.raceRageUsed = false; });
  // 援军（chain.js）：到了时候的这一波进场
  if (typeof Chain !== "undefined") Chain.roundStart([]).forEach(t => appendLog(t));
  // 背水一战+：夏濒死并且起身时，每回合自动获得 1 点燃油
  {
    const xia = findKit("xia", state.units);
    if (xia && !xia.dead && xia.upOnShp && typeof passivePlus === "function" && passivePlus(xia, 2)) addFuel(1, "背水一战+", notes);
  }
  // 研磨机+：每两个回合获得 1 颗咖啡豆（第 2、4、6…回合开始）
  {
    const yu = findKit("yuito", state.units);
    if (yu && !yu.dead && Number(state.turnNo) % 2 === 0 && typeof passivePlus === "function" && passivePlus(yu, 1)) {
      yu.resources = yu.resources || {};
      yu.resources.bean = (Number(yu.resources.bean) || 0) + 1;
      notes.push(`研磨机+：结人获得 1 颗咖啡豆 → ${yu.resources.bean}。`);
    }
  }
  // 扭矩「转移注意」：下回合开始自动变回武器（失去的装甲记为废料，见 endTorqueGuard）
  state.units.forEach(u => {
    if (u.kit === "torque" && u.resources && u.resources.divertGuard && !u.hidden && !u.dead) {
      notes.push("转移注意结束：扭矩变回武器。");
      notes.push(...returnWeapon(u));
    }
  });
  // Ecmo 探测模式：每回合开始自动对所在区做一次环境扫描
  state.units.forEach(u => {
    if (u.kit === "ecmo" && u.resources && u.resources.probe && !u.hidden && !u.dead) {
      (u.resources.probeZones = u.resources.probeZones || []).push(Number(u.zone));
      heluScanAct(u, { dest: Number(u.zone), act: "spawn" }, notes);
    }
  });
  // 双重奏的 atk、粉落汤气都只到这个回合开始
  state.units.forEach(u => {
    if (u.duetAtk) { notes.push(`${u.name} 双重奏的 atk +${u.duetAtk} 消失。`); u.duetAtk = 0; }
    if (u.kit === "hiaki" && u.resources && u.resources.powder) { u.resources.powder = false; notes.push("粉落汤气结束。"); }
  });
  if (typeof mutinyTick === "function") mutinyTick(notes);
  if (typeof desertRoundStart === "function") desertRoundStart(notes);   // 尘虫摊平结束、管虫流沙
  // 专长（feats.js · hooks.roundStart）：每回合开始
  if (typeof featHook === "function") state.units.forEach(u => { if (u.isPlayer && !u.dead && !u.hidden) featHook(u, "roundStart", undefined, notes); });
  if (typeof syncBpAll === "function") syncBpAll();
  state.units.forEach(u => {
    // 夕夏濒死（倒地没起身）、晕眩或死了就不自动碾压（以前照碾）
    if (u.kit === "xia" && isCrushing(u) && !u.dead && !u.dying && !u.stunned) {
      const ct = crushingTarget(u);
      u.zone = Number(ct.zone);
      notes.push(...crushOnce(u, ct, true));
    }
    if (u.kit === "nora" && (typeof passiveOn !== "function" || passiveOn(u))) {
      u.resources = u.resources || {};
      if (u.resources.forceCruelNext) {
        u.resources.forceCruelNext = false;
        setMood(u, "cruel", notes, "压力升高");
      } else if (!(typeof passivePlus === "function" && passivePlus(u, 2)) && Math.random() < 1 / 3) {   // 双相冲动+：不再随机翻面
        flipMood(u, notes, "双相冲动");
      }
      const pinBefore = u.resources.piercedId;
      if (pinBefore && !piercedTarget(u)) notes.push("刺入目标已超出距离 1，刺入结束。");
    }
    // 黄金时间：被延长的即时效果这一次回合开始不结束，多保留一回合
    const held = goldHeldInstants(u);
    if (u.instant && u.instant.shift && held.indexOf("shift") < 0) {
      clearShift(u);
      notes.push(`${u.name} 错位结束，血层顺序恢复。`);
    }
    // 黄金时间延长的过载这回合不结束；还在飞的高压巡逻艇一直过载（下面重新给它过载），旧的过载不在这里清零护盾（enemies.js · boatKeepsOverload）
    if (held.indexOf("overload") < 0 && typeof overloadRoundStart === "function" && !(typeof boatKeepsOverload === "function" && boatKeepsOverload(u)) && overloadRoundStart(u, notes)) u._noShieldRefill = true;
    if (typeof meltShieldRoundStart === "function" && meltShieldRoundStart(u, notes)) u._noShieldRefill = true;
    if (u.resources && u.resources.frostShell) { u.resources.frostShell = false; notes.push(`${u.name} 再次霜结的完全免疫结束。`); }
    if (typeof selfImmunities === "function") selfImmunities(u, notes);
    if (typeof syncShockwave === "function") syncShockwave(u, notes);
    if (typeof syncFrenzyPosture === "function") syncFrenzyPosture(u, notes);   // 狂暴的架势上限（effects.js）也对一遍账
    // 即时效果都是单回合的：没被用掉的也在回合开始时失效
    if (u.instant) {
      const gone = [];
      // 过热熔融（沙灵聚合体开炮后）：留到开炮之后那个我方回合结束
      const meltHold = u.resources && Number(u.resources.meltHoldTurn) >= Number(state.turnNo);
      if (u.instant.melt && held.indexOf("melt") < 0 && !meltHold) { u.instant.melt = false; gone.push("熔融"); }
      if (u.instant.sting && held.indexOf("sting") < 0) { u.instant.sting = false; gone.push("刺骨"); }
      if (u.instant.spread && held.indexOf("spread") < 0) { u.instant.spread = false; gone.push("扩散"); }
      if (u.instant.refract && held.indexOf("refract") < 0) { u.instant.refract = false; gone.push("折射"); }
      if (gone.length) notes.push(`${u.name} ${gone.join("、")}结束。`);
      if (held.length) notes.push(`${u.name} 黄金时间：${held.map(k => INSTANT_NAME[k] || k).join("、")}再保留一回合。`);
      if (u.instant.goldHold) u.instant.goldHold = false;   // 只延长一回合
    }
    if (!u.stunned && (u.def || 0) > 0) u._imbalanceLock = false;
    if (u.kit === "livesand" && u.resources && u.resources.giant && !u.dead) {
      u.resources.giantTurns = (u.resources.giantTurns || 0) + 1;
    }
    if (u.resources) u.resources.blockUsedThisTurn = false;
    if (u.kit === "xia" && u.resources) {
      // 背水一战：起身（靠坚毅生命）继续战斗时总是启动引擎，一回合没攻击也不熄火
      const backWater = u.upOnShp && !u.dead && (typeof passiveOn !== "function" || passiveOn(u));
      if (u.resources.engine && !u.resources.attackedThisTurn && !u.resources.engineJustOn && !backWater) {
        u.resources.engine = false;
        notes.push("夕夏一回合未攻击，引擎关闭。");
      } else if (u.resources.engineJustOn) {
        notes.push("夕夏引擎刚启动：本回合即使未攻击也不关闭。");
      }
      u.resources.engineJustOn = false;
      u.resources.attackedThisTurn = false;
    }
  });
  state.units.forEach(u => {
    if (u.kit === "watchcrow" && !u.dead && !u.hidden) {
      u.resources = u.resources || {};
      u.resources.reflect = true;
      notes.push(`${u.name}：本回合第一次受到的攻击伤害将以能量属性反弹（不反弹击破）。`);
    }
    if (u.kit === "spreader" && !u.dead && !u.hidden) {   // 死掉（还没清出场）的播撒者不再铺酸液
      const f = state.fields[u.zone] || emptyField();
      const err = setZoneField(u.zone, "acid", { by: u.id });
      notes.push(err || `${u.name} 低空作业：${u.zone} 区生成酸液地面（对自身无效）。`);
    }
    if (u.kit === "patrolboat" && typeof boatOverloadRoundStart === "function") boatOverloadRoundStart(u, notes);
    if (u.kit === "flint_sweeper" && typeof flintRollShots === "function") flintRollShots(u, notes);   // 连击预警：先掷好下一次发射几发
    // 赤牙的掩体「一回合内」有效：撑过我方回合，到她下次出手为止（enemies.js）；一直没出手的，过了一整回合在这里撤掉。
    // 以前在这里一律清掉，我方回合开始前掩体就没了
    if (u.kit === "chixia" && u.resources && u.resources.cover && Number(state.turnNo) >= (Number(u.resources.coverTurn) || 0) + 2) {
      u.resources.cover = false;
      notes.push(`${u.name} 的掩体撤掉了。`);
    }
    if (u.kit === "boomcar" && u.resources && u.resources.fuse != null) {
      if (u.resources.fuse <= 0) notes.push(`${u.name} 引信已到，请点「引爆」。`);
      else notes.push(`${u.name} 引信 ${u.resources.fuse} 回合后自爆。`);
    }
    if (u.kit === "ufo_body" && !u.dead) {
      const n = ufoLivingLegs(u).length;
      notes.push(`${u.name} 剩余机械足 ${n}。`);
      if (u.resources && u.resources.boomReady) {
        notes.push("飞碟触灵已准备自爆：本回合可点「自爆」引爆。");
      } else if (n === 1) {
        notes.push("只剩 1 条机械足：可先点「准备自爆」，下回合再点「自爆」引爆。");
      }
      if ((u.level || 1) >= 10 && n > 0) {
        const kinds = ["guard_sword", "guard_gun"];
        const kind = kinds[Math.floor(Math.random() * kinds.length)];
        const p = enemyPresets().find(x => x.id === kind);
        if (p) {
          const guard = typeof applyEnemyIV === "function" ? applyEnemyIV(p.build(u.level, state.partySize)) : p.build(u.level, state.partySize);
          guard.zone = u.zone;
          guard.summonedBy = u.id;   // 和技能版 ufo_summon 一致：自爆连它一起炸，战后不掉材料
          state.units.push(guard);
          notes.push(`十级被动：召唤 ${guard.name}。`);
        }
      }
    }
  });
  Object.keys(state.fields || {}).forEach(z => tickFireField(z, notes));
  tickRuinGround(notes);
  state.units.forEach(u => {
    u.lostDefThisTurn = 0;
    // 收回的武器人（hidden）、合体中的、已经死掉的不在场上：不吃场地、自我效果、沙尘回复，也不算进能量场
    if (offField(u)) return;
    const weather = currentWeatherFor(u);
    const f = state.fields[u.zone] || emptyField();
    if (f.energy) tickEnergyFieldFor(u, f, notes);
    if (f.acid && !u.flying && u.kit !== "spreader") tickAcidFieldFor(u, weather, notes);   // 播撒者被击落后也不吃自己铺的酸液（手册：对自身无效）
    if (f.heal) tickHealFieldFor(u, weather, notes);
    if (f.quicksand) tickQuicksandFor(u, notes);
    else if (sinkOf(u)) clearSink(u, notes, "已经不在流沙里");
    if (f.ice && !u.flying && !fieldExempt(u)) {
      notes.push(`${u.name} 处于冻土：对冰强制 25% 易伤。离开或进入时会自动结算运动检定与冰击破。`);
    }
    // 干涉叠层只在站在干涉场里时生效：已经离开（或换了区）的，叠层清掉
    if (u.interfere && !(f.harmonic && (u.interfereZone == null || Number(u.interfereZone) === Number(u.zone)))) {
      u.interfere = 0;
      u.interfereZone = null;
      notes.push(`${u.name} 不在原来的干涉场里，干涉叠层清空。`);
    }
    convertUnstableInHv(u, notes);
    // 晕眩后自我效果结束（所有自我效果；蓄能累积的高能值不清零）
    if (typeof endSelfOnStun === "function") endSelfOnStun(u, notes);
    if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(u, notes);
    if (u.self === "burn") {
      notes.push(...tickSelfBurn(u, true));
    }
    if (u.self === "frost") {
      // 霜结每回合开始 1 冰击破：雪天只让冻伤和冻土的击破翻倍，这里不翻倍
      dealBreak(u, 1, "ice", notes, "霜结");
    }
    if (u.self === "store") {
      u.highEnergy = (u.highEnergy || 0) + (u.level || 1);
      notes.push(`${u.name} 蓄能 +${u.level} → ${u.highEnergy}`);
      checkHighBoom(u);
    }
    if (weather === "acid" && u.self === "splash") {
      const regen = (u.level || 1) * envMult(u);
      healUnit(u, regen);
      notes.push(`${u.name} 酸雨溅射回复 ${regen}`);
    }
    // 沙尘恢复：认第一层还能回血的沙尘（沙灵聚合体外层沙壳打穿后上限是 0，二阶段起回的是内层沙尘）
    const sand = (u.layers || []).find(l => l.type === "sand" && Number(l.max) > 0);
    if (u.kit === "tou" && u.resources && (typeof passiveOn !== "function" || passiveOn(u))) {
      u.resources.shield = Math.min(3, (u.resources.shield || 0) + 1);
      notes.push(`${u.name} 圣盾 +1 → ${u.resources.shield}`);
    }
    if (weather === "sand") {
      notes.push(`${u.name} ${sandWindActionText(u)}`);
    }
    // 扬尘体的沙尘也只在这里每回合回复一次（以前回合结束另有一段「悬沙」，叠起来回两次）。
    // 手册「被击落则本回合不回复」：击落是永久落地，上次回复时还在飞、现在不飞了，就是这一回合被击落的
    const dustDown = u.kit === "dustbody" && !!u._dustFlying && !u.flying;
    if (u.kit === "dustbody") u._dustFlying = !!u.flying;
    if (sand && !u.sandLocked && !dustDown) {
      let regen = u.level || 1;
      if (weather === "sand") regen *= 2 * envMult(u);
      sand.current = Math.min(sand.max, Number(sand.current) + regen);
      notes.push(`${u.name} 沙尘恢复 ${regen}${weather === "sand" ? "（沙暴翻倍，与风向无关）" : ""}`);
    } else if (sand && dustDown) {
      notes.push(`${u.name} 被击落：本回合沙尘不回复。`);
    }
    if (!u.gotHitThisTurn && !u._noShieldRefill) {
      // 只回满单位自带的那部分：临时护盾扣掉的不回来（max 已经跟着减掉了）
      syncTempShield(u);
      (u.layers || []).forEach(l => {
        if (l.type === "shield") { l.current = l.max; l._lastCur = l.current; }
      });
    }
    u._noShieldRefill = false;
    u.gotHitThisTurn = false;
    u.damagedThisTurn = 0;
    u.sandLocked = false;
  });
  Object.keys(state.fields || {}).forEach(z => checkEnergyFieldBoom(z, notes));
  // 扭矩酸液炮蓄力：「下回合开始」爆发——和场地效果同一个时间段，在场地效果之后
  releaseAcidCharges(notes);
  appendLog(notes.join("\n"));
}

/** 不在场上的单位：收回的武器人、合体中的、已经死掉 / 移除的。回合开始 / 结束的结算都跳过它们 */
function offField(u) {
  return !u || !!(u.hidden || u.fused || u.dead || u._removed);
}

/** 回合开始时会结束的即时效果（玩家手册第四章「即时效果」：单回合生效） */
const INSTANT_NAME = { melt: "熔融", sting: "刺骨", overload: "过载", shift: "错位", spread: "扩散", refract: "折射" };
/** 黄金时间延长的即时效果：instant.goldHold 为 true 时是身上现有的全部即时效果，写成效果名（如 "melt"）时只延长那一种 */
function goldHeldInstants(u) {
  const g = u && u.instant && u.instant.goldHold;
  if (!g) return [];
  const keys = typeof g === "string" ? [g] : Object.keys(INSTANT_NAME);
  return keys.filter(k => INSTANT_NAME[k] && u.instant[k]);
}

function releaseAcidCharges(notes) {
  state.units.forEach(u => {
    if (u.kit === "torque" && u.resources && u.resources.acidCharge != null && !u.hidden && !u.dead) {
      const z = Number(u.resources.acidCharge);
      u.resources.acidCharge = null;
      notes.push(`扭矩酸液炮蓄力在 ${z} 区爆发。`);
      const atk = effectiveAtk(u, state.units);
      const kolt = findKit("kolt", state.units);
      visibleEnemies(z).forEach(t => {
        // 酸液炮蓄力是抛射：越过危墙 / 关着的门
        const out = dealTo(u, t, { element: "acid", mult: 1, baseBreak: 1, atk, flags: { action: true, aoe: true, lob: true } });
        (out.extra || []).forEach(s => notes.push(s));
        // 卡面：被打到的敌人下一击必须攻击柯尔特
        if (kolt && !kolt.dead && !t.dead) { t.tauntTo = kolt.id; notes.push(`${t.name} 被嘲讽：下一击必须攻击柯尔特。`); }
      });
    }
  });
}

/* ---------- 场地的回合开始效果（回合开始和 Helumica「环境扫描」共用） ---------- */
function tickFireField(z, notes) {
  const f = state.fields[z];
  if (!fieldFireOn(f)) return;
  f.fireOn = true;
  if (!(Number(f.fire) > 0)) f.fire = 1;
  const stacks = Number(f.fire) || 1;
  // 保释中的单位豁免场地；恶劣环境 / 末日让场地伤害翻倍
  fieldUnits().filter(u => Number(u.zone) === Number(z) && !u.flying && !u.dead && !fieldExempt(u)).forEach(u => withEnvOwner(f.by, () => {
    const weather = currentWeatherFor(u);
    const d = statusDotDice("firefield", u.level, weather);
    const parts = [];
    let dmg = 0;
    for (let i = 0; i < stacks; i++) {
      const r = takeDice(d.n, d.s, 0);
      dmg += r.total;
      parts.push(r.text);
    }
    const x = envMult(u);
    const cut = typeof raceFieldDamage === "function" ? raceFieldDamage(u, dmg * x) : dmg * x;   // 环境适应（鼠类人·鼠）：50% 概率免疫
    if (cut <= 0 && dmg * x > 0) { notes.push(`${u.name} 火场${stacks}层：环境适应，免疫这次场地伤害。`); return; }
    applyTypedDot(u, cut, "fire", notes, `${u.name} 火场${stacks}层 ${parts.join(" + ")} = ${dmg}${x > 1 ? ` ×${x}（场地效果${x > 2 ? "×4" : "翻倍"}）= ${dmg * x}` : ""}`);
  }));
  // 酷暑让火场层数再 +1：看的是这一区的天气（隔离区不受天气影响）；末日把这 +1 也翻倍
  const heat = zoneWeather(z) === "heat";
  const add = 1 + (heat ? (state.apocalypse ? 2 : 1) : 0);
  f.fire += add;
  notes.push(`${z} 区火场先结算伤害，然后层数 +${add} → ${f.fire}${heat ? "（酷暑）" : ""}`);
}
function tickEnergyFieldFor(u, f, notes) {
  if (fieldExempt(u)) return;   // 保释：豁免场地，也不算进能量场人数
  const s = leveledSides(u.level || 1, 4);
  const r = takeDice(1, s, 0);
  const x = envMult(u);
  f.energyVal = (f.energyVal || 0) + r.total * x;
  notes.push(`${u.name} 所在能量场累积 ${r.text}${x > 1 ? " ×2" : ""} → 场地高能 ${f.energyVal}`);
}
function tickAcidFieldFor(u, weather, notes) {
  if (fieldExempt(u)) return;
  if (typeof acidGroundImmune === "function" && acidGroundImmune(u)) return;   // 蚁型特殊戒备兵种：不吃酸液地面
  const d = statusDotDice("acidfield", u.level, weather);
  const r = takeDice(d.n, d.s, 0);
  const x = envMult(u);
  const cut = typeof raceFieldDamage === "function" ? raceFieldDamage(u, r.total * x) : r.total * x;   // 环境适应（鼠类人·鼠）：50% 概率免疫
  if (cut <= 0 && r.total * x > 0) { notes.push(`${u.name} 酸液地面：环境适应，免疫这次场地伤害。`); return; }
  withEnvOwner((state.fields[u.zone] || {}).by, () => applyTypedDot(u, cut, "acid", notes, `${u.name} 酸液地面 ${r.text}${x > 1 ? ` ×${x}（场地效果${x > 2 ? "×4" : "翻倍"}）` : ""}`));
}
function tickHealFieldFor(u, weather, notes) {
  if (fieldExempt(u)) return;
  const d = statusDotDice("healfield", u.level, weather);
  const r = takeDice(d.n, d.s, 0);
  const heal = r.total * envMult(u);
  healUnit(u, heal);
  notes.push(`${u.name} 治愈场地 ${r.text}${heal !== r.total ? " ×2" : ""} → +${heal}`);
}
/** 能量场自爆（回合开始）：血量最低的单位血量低于场地高能值就自爆；自己带着高能值的单位（不只最低血那个），
 *  阈值 = 自身高能 + 场地高能。都是「血量低于阈值」才爆，每回合最多一次，爆了场地高能清零（explodeHigh） */
function checkEnergyFieldBoom(z, notes) {
  const f = state.fields[z];
  if (!f || !f.energy || !(f.energyVal > 0)) return;
  const pool = fieldUnits().filter(u => Number(u.zone) === Number(z) && totalHp(u) > 0 && !fieldExempt(u));
  if (!pool.length) return;
  pool.sort((a, b) => totalHp(a) - totalHp(b));
  const low = pool[0];
  const own = u => Number(u.highEnergy) || 0;
  const threshold = u => (u === low || own(u) > 0) ? own(u) + f.energyVal : 0;
  notes.push(`${z} 区能量场高能 ${f.energyVal}，最低血 ${low.name} ${totalHp(low)}${own(low) ? "（含自身高能 " + own(low) + "）" : ""}。`);
  const boom = pool.find(u => totalHp(u) < threshold(u));
  if (boom) {
    const th = threshold(boom);
    notes.push(`${boom.name} 生命 ${totalHp(boom)} 低于高能阈值 ${th}${boom === low ? "" : `（自身高能 ${own(boom)} + 场地 ${f.energyVal}）`}，自爆。`);
    // 环境分数：能量场的所有者（没有就是触发它的人）；这次自爆炸死了我方单位就不加
    const alive = state.units.filter(u => u.isPlayer && !u.dead);
    const hold = [], prevHold = ENV_HOLD;
    ENV_HOLD = hold;
    try { explodeHigh(boom, th, { envBy: f.by == null ? null : f.by }); } finally { ENV_HOLD = prevHold; }
    if (alive.some(u => u.dead)) { if (hold.length) notes.push("能量场自爆炸死了我方单位：这次不加环境分。"); }
    else hold.forEach(fn => envCommit(fn));
  }
}

function startPlayerPhase() {
  const notes = ["—— 玩家回合 ——"];
  state.combatPhase = "player";
  state.units.forEach(u => {
    if (!u.isPlayer || u.hidden || u.dead) return;
    // 晕眩标记（首领的规则；我方只有和载具合并的驾驶员用，vehicle.js）：没攒满就只恢复架势、照常行动；攒满了照常晕眩，标记清零
    if (u.stunned) bossShrugStun(u, notes);
    const wasStun = !!u.stunned;
    refreshEconomy(u);
    if (wasStun) {
      recoverFromStun(u, notes);
      notes.push(`${u.name} 晕眩：本回合不获得行动点与附赠动作。`);
    }
    if (u.resources && u.resources.gambitArmed) {
      u.resources.gambitArmed = false;
      u.resources.gambitStrike = true;
      u.resources.gambitWound = false;   // 受伤翻倍到这里（自己下一次行动前）为止
      notes.push(`${u.name} 破釜沉舟：本回合攻击双倍；受伤翻倍结束。`);
    }
    if (u.kit === "ras" && u.resources && !u.stunned && (typeof passiveOn !== "function" || passiveOn(u))) {
      addRasEnergy(20, "玩家回合开始");
      notes.push("拉斯缪尔回合开始累积能量 +20%。");
    }
    if (u.resources && u.resources.preparedPending) {
      u.resources.preparedActive = true;
      u.resources.preparedPending = false;
      notes.push(`${u.name} 「准备」生效：本回合第一次攻击的第一击基础包 +1d${prepDieSides(u)}，吃倍率和克制。`);
    }
  });
  // 首领机制：落在我方回合开始的死刑等（我方已经回满行动点 / 附赠，可以用来协助格挡）
  if (typeof bossMechPhaseStart === "function") bossMechPhaseStart("player", notes);
  appendLog(notes.join("\n"));
  renderAll();
}

function startEnemyPhase() {
  const notes = ["—— 敌人回合 ——"];
  if (typeof escortAct === "function") escortAct(notes);   // 护送的人物先躲 / 还击
  state.combatPhase = "enemy";
  // 首领机制（boss-mechanics.js）：落在敌人回合开始的死刑等。要在失衡恢复之前判（首领失衡 → 推迟一回合）
  if (typeof bossMechPhaseStart === "function") bossMechPhaseStart("enemy", notes);
  // 废铁墙（回防命令）撑过了一个玩家回合，敌人回合开始时撤掉
  (state.props || []).filter(p => p.kind === "scrapwall").forEach(p => {
    notes.push(`${p.zone} 区的废铁墙撑过了玩家回合（剩 ${p.hp}/${p.maxHp}），撤掉了。`);
  });
  state.props = (state.props || []).filter(p => p.kind !== "scrapwall");
  settleBossStuns(notes);
  // 狂鼠的阵营被动「狂潮」（effects.js · frenzyTide）：放在失衡的敌人恢复之前，这时还在失衡的不会被拉进狂暴（照样算存活数量）
  if (typeof frenzyTide === "function") frenzyTide(notes);
  state.units.forEach(u => {
    if (u.isPlayer || u.hidden || u.dead) return;
    if (u.stunned && bossShrugStun(u, notes)) {
      refreshEnemyEconomy(u, notes);
    } else if (u.stunned) {
      recoverFromStun(u, notes);
      u.ap = 0; u.apMax = 0; u.bonus = 0; u.bonusMax = 0;
      notes.push(`${u.name} 敌人回合开始时晕眩：解除晕眩并回满架势，本回合不获得行动点。`);
    } else {
      refreshEnemyEconomy(u, notes);
      if (u.kit === "mecha_gl" && u.resources && u.resources.glPending && u.resources.glZone && !u.resources.glReady) {
        u.resources.glReady = true;
        notes.push(`${u.name} 榴弹已就绪，可对 ${u.resources.glZone} 区发射。`);
      }
      if (u.kit === "riot_molotov" && u.resources && u.resources.bottlePending && u.resources.bottleZone && !u.resources.bottleReady) {
        u.resources.bottleReady = true;
        notes.push(`${u.name} 燃烧瓶已就绪，可对 ${u.resources.bottleZone} 区投出。`);
      }
      if (u.kit === "ant_guard" && u.resources && u.resources.shellPending && u.resources.shellZone && !u.resources.shellReady) {
        u.resources.shellReady = true;
        notes.push(`${u.name} 大酸液弹已就绪，可对 ${u.resources.shellZone} 区发射。`);
      }
      if (u.kit === "ant_hunter" && typeof hunterHeatAtTurnStart === "function") hunterHeatAtTurnStart(u, notes);
    }
  });
  if (typeof desertEnemyPhaseStart === "function") desertEnemyPhaseStart(notes);   // 沙鱼：重新下潜、声呐探测、母系溃散
  appendLog(notes.join("\n"));
  renderAll();
}

function endPlayerTurn() {
  snapshot();
  // 汲取：拉斯缪尔每回合结束自动把 20% 累积能量转为光能
  {
    const ras = findKit("ras", state.units);
    if (ras && !ras.dead && ras.resources && ras.resources.siphon && (Number(ras.resources.energyPct) || 0) > 0) {
      appendLog("汲取：拉斯缪尔回合结束，20% 累积能量转为光能。");
      convertRasLight(20);
    }
  }
  state.units.forEach(u => {
    if (u.resources && u.resources.preparedActive) {
      u.resources.preparedActive = false;
      appendLog(`${u.name} 本回合未打出第一次攻击，「${u.resources.whetDice ? "磨刀" : "准备"}」消失。`);
      delete u.resources.whetDice;
    }
  });
  // 流沙：我方这回合花过行动点就陷得更深，没花就浮出来一点
  { const sk = []; quicksandTurnEnd(true, sk); sk.forEach(t => appendLog(t)); }
  appendLog("玩家回合结束。");
  startEnemyPhase();
  // 下水道狂鼠（enemies.js · ratfolkSweep）：敌人回合开始的首领机制等结算完，再看一遍反应
  if (typeof ratfolkSweep === "function" && !state._highDefer && !logSinkActive()) ratfolkSweep();
}

function endEnemyTurn() {
  snapshot();
  { const sk = []; quicksandTurnEnd(false, sk); sk.forEach(t => appendLog(t)); }   // 流沙：敌人一方
  appendLog("敌人回合结束。");
  turnEnd();
}

function turnEnd() {
  snapshot();
  const notes = ["—— 回合结束 ——"];
  releaseTurnLocks(notes);
  if (typeof spiderRoundEnd === "function") spiderRoundEnd(notes);   // 陨体衍蛛：到点复活
  if (typeof desertRoundEnd === "function") desertRoundEnd(notes);   // 夜晚的尘虫迁徙 / 离开
  // 剑术+：这一回合切换刀势得到的附赠动作没用掉的，留到下回合（再下回合就过期）
  state.units.forEach(u => {
    const g = u.kit === "hiaki" && u.resources && u.resources.stanceGrant;
    if (!g || g.turn !== Number(state.turnNo)) return;
    const n = Math.min(Number(u.bonus) || 0, g.n);
    u.resources.stanceGrant = null;
    if (n > 0) { u.resources.stanceCarry = { turn: Number(state.turnNo) + 1, n }; notes.push(`剑术+：${u.name} 还有 ${n} 个切换刀势得到的附赠动作，留到下回合。`); }
  });
  // 思念+：被牵挂的队友这一回合没受过伤 → 恢复 1 架势且 atk +10（可叠加）
  {
    const yu = findKit("yuito", state.units);
    const ally = yu && yu.resources && yu.resources.bondId ? unitById(yu.resources.bondId) : null;
    if (ally && !ally.dead && !yu.dead && typeof passivePlus === "function" && passivePlus(yu, 2) && ally._hurtRound !== Number(state.turnNo)) {
      ally.def = Math.min(Number(ally.defMax) || 0, (Number(ally.def) || 0) + 1);
      ally.bondAtk = (Number(ally.bondAtk) || 0) + 10;
      notes.push(`思念+：${ally.name} 这一回合没有受伤，恢复 1 架势，atk +10（累计 +${ally.bondAtk}）。`);
    }
  }
  state.units.forEach(u => {
    if (offField(u)) return;   // 收回的武器人 / 死掉的单位：灼烧不叠层、不掉血
    const weather = currentWeatherFor(u);
    if (typeof selfImmunities === "function") selfImmunities(u, notes);   // 自焚免疫灼烧：直接写进来的灼烧在这里清掉，不会先烫一跳
    if (typeof syncShockwave === "function") syncShockwave(u, notes);
    if (typeof syncFrenzyPosture === "function") syncFrenzyPosture(u, notes);
    // 加倍计量：这个单位的状态此回合效果翻倍；恶劣环境 / 末日：天气对状态的修正翻倍
    const sm = statusMult(u);
    const ex = envMult(u);
    if (Number(u.statuses && u.statuses.burn) > 0) {
      const d = statusDotDice("burn", u.level, weather);
      const stacks = Math.max(1, Math.floor(Number(u.statuses.burn) || 0));
      const parts = [];
      let dmg = 0;
      for (let i = 0; i < stacks; i++) {
        const r = takeDice(d.n, d.s, 0);
        dmg += r.total;
        parts.push(r.text);
      }
      applyTypedDot(u, dmg * sm, "fire", notes, `${u.name} 灼烧${stacks}层分别掷骰 ${parts.join(" + ")} = ${dmg}${sm > 1 ? ` ×2（加倍计量）= ${dmg * sm}` : ""}`, { by: statusOwnerId(u, "burn") });
      let add = 1;
      if (weather === "heat") add += ex;
      if (weather === "snow") add = 0;
      u.statuses.burn = stacks + add;
      if (add) notes.push(`${u.name} 灼烧结算后叠层 +${add} → ${u.statuses.burn}`);
    }
    if (u.statuses && u.statuses.shock) {
      notes.push(`${u.name} 回合结束触发感电。`);
      notes.push(...shockPulse(u));
    }
    if (u.statuses.corr) {
      const armor = (u.layers || []).some(l => l.type === "armor" && l.current > 0);
      const d = statusDotDice("corr", u.level, weather, armor, ex);
      const r = takeDice(d.n, d.s, 0);
      applyTypedDot(u, r.total * sm, "acid", notes, `${u.name} 腐蚀 ${r.text}${sm > 1 ? " ×2（加倍计量）" : ""}`, { by: statusOwnerId(u, "corr") });
    }
    if (u.statuses.frostbite) {
      let br = weather === "snow" ? 2 * ex : 1;
      if (u.frostbiteBreakOverride != null) {
        br = Number(u.frostbiteBreakOverride) || 0;
        notes.push(`${u.name} 破冰：冻伤击破改为本次记录值 ${br}`);
        u.frostbiteBreakOverride = null;
      }
      if (weather === "heat") {
        notes.push(`${u.name} 酷暑：冻伤触发一次后结束`);
        u.statuses.frostbite = false;
      }
      dealBreak(u, br * sm, "ice", notes, sm > 1 ? "冻伤 ×2（加倍计量）" : "冻伤");
    }
    // 过载：护盾在下回合开始时清零（effects.js · overloadRoundStart）
    if (u.statuses && u.statuses.sturdy) {
      u.statuses.sturdy = false;
      notes.push(`${u.name} 坚挺结束`);
    }
    if (u.statuses && u.statuses.weakFear) {
      u.statuses.weakFear = false;
      if (u.statuses.weak) { u.statuses.weak = false; notes.push(`${u.name} 恐惧怒吼的虚弱结束`); }
    }
    if (u.statuses && u.statuses.inspire && !u.statuses.inspireStay) {
      u.statuses.inspire = false;
      notes.push(`${u.name} 振奋结束`);
    }
    // 扬尘体的沙尘回复在回合开始（沙尘层的通用回复，被击落的那一回合不回），这里不再另回一次
    if (u.kit === "boomcar" && u.resources && u.resources.fuse != null) {
      u.resources.fuse -= 1;
    }
    if (u.kit === "ruby" && u.resources && u.resources.drone && !u.dead && !u.hidden) {
      // 收发代理：平时提取纳米；机甲里改为对高能敌人（没有就血量最少的）发射两次 0.2atk+1d12 能量激光，耗 10 纳米
      if (!u.resources.mecha) {
        addNano(10);
        notes.push(`收发代理：无人机提取纳米 +10 → ${u.resources.nano}`);
      } else if (nanoAvailable(u) >= 10) {   // 纳米不够的差额从储备能源扣（#219）
        // 激光不能穿墙：隔着危墙 / 关着的门的敌人不算可选目标；一个都没有就什么都不干（不耗纳米）。
        // 锁定前先判断够不够得着（和 dealTo 的判定一致：距离 ≤1、没躲藏、没下潜、不是友军 / 飞碟本体），
        // 以前只看墙，锁到距离 2 / 躲藏 / 下潜的目标，激光打不出去纳米却照扣
        const foes = fieldUnits().filter(x => !x.isPlayer && !x.dead && !x.hidden && !x.fused && !lineBlocked(u.zone, x.zone) &&
          zoneDist(Number(u.zone), Number(x.zone), Number(state.zoneMode)) <= 1 &&
          !(x.statuses && x.statuses.hide) && !x.submerged && x.kit !== "ufo_body" &&
          !(typeof playerAllied === "function" && playerAllied(x)));
        const high = foes.filter(x => x.statuses && x.statuses.high);   // 蓄能单位不算高能目标
        const pool = high.length ? high : foes;
        const tgt = pool.slice().sort((x, y) => totalHp(x) - totalHp(y))[0];
        if (tgt) {
          const paid = spendNano(10, { ruby: u });
          notes.push(`银翼·收发代理：无人机激光射向 ${tgt.name}（${nanoSpentText(u, paid)}）。`);
          const shots = 2 + (u.resources.overdrive ? 1 : 0);   // 机体强化：无人机攻击次数 +1
          for (let i = 0; i < shots && !tgt.dead; i++) {
            // 每一发照普通命中的格式写进回合结束的日志（hitOne2 现在会写出伤害行）
            hitOne2(u, tgt, { element: "energy", mult: 0.2, diceN: 1, diceS: 12, baseBreak: 0, atk: effectiveAtk(u, state.units), atkRange: "any", usePrep: false, flags: { action: true } }, notes);
          }
        } else notes.push("银翼·收发代理：没有打得到的敌人，无人机这回合什么都不干。");
      } else notes.push(`银翼·收发代理：纳米${nanoReserveOf(u) ? "（含储备能源）" : ""}不足 10，无人机这回合没有发射。`);
    }
    if (u.kit === "ruby" && u.resources && u.resources.mecha) {
      const cost = 20 + (u.resources.overdrive ? 20 : 0);   // 机体强化：每回合多耗 20
      // 纳米不够的差额从储备能源扣；两边都扣光才因为纳米耗尽退出机甲（#219）
      const paid = spendNano(cost, { ruby: u, partial: true });
      notes.push(`${u.name} 机甲维持：${paid.reserve ? nanoSpentText(u, paid) : `纳米 −${cost} → ${u.resources.nano}`}`);
      if (nanoAvailable(u) <= 0) notes.push(...exitMecha(u, "纳米耗尽，机甲结束"));
    }
    // 年糕咬住记了 noMoveUntil：持续到下一个敌人回合结束；其余禁足到这一回合结束
    if (u.noMove && !(Number(u.noMoveUntil) > Number(state.turnNo))) {
      u.noMove = false;
      u.noMoveUntil = null;
      notes.push(`${u.name} 解除禁足`);
    }
    if (u.coverBy) u.coverBy = null;
    if (u.resources) {
      if (u.resources.gritTurn) { u.resources.gritTurn = false; notes.push(`${u.name} 咬牙坚持结束。`); }
      if (u.resources.standTurn) { u.resources.standTurn = false; notes.push(`${u.name} ${u.resources.reviveGuard ? "还魂" : "屹立不倒"}结束。`); }
      if (u.resources.reviveGuard) u.resources.reviveGuard = false;
      if (u.resources.guardStrike) { u.resources.guardStrike = false; u.resources.guardStrikeUsed = false; }
      if (u.resources.allReflect) u.resources.allReflect = false;
      if (u.resources.gambitStrike) u.resources.gambitStrike = false;
    }
    if (u.shelterTurn) { u.shelterTurn = false; u.isolate = false; }
    if (u.harshEnv) u.harshEnv = false;
    if (u.instant && u.instant.doubleStatus) {
      u.instant.doubleStatus = false;
      if (typeof syncShockwave === "function") syncShockwave(u, notes);   // 震荡扣的上限回到 2
    }
    if (u.instant && u.instant.omenArmed) {
      if (u.stunned || u.instant.omenHit) {
        const caster = unitById(u.instant.omenFrom);
        if (caster && caster.resources && caster.resources.roleOnce) caster.resources.roleOnce.omen = Math.max(0, (caster.resources.roleOnce.omen || 1) - 1);
        notes.push(`${u.name} 已被击破，击破预告返还次数。`);
      } else {
        const caster = unitById(u.instant.omenFrom);
        if (caster && !caster.noPosture) {
          caster.def = 0;
          caster.stunned = true;
          notes.push(`击破预告失败：${caster.name} 架势被击破。`);
          notes.push(imbalanceLine(caster));
        }
      }
      u.instant.omenArmed = false;
      u.instant.doubleBreak = false;
    }
    // 黄金时间（instant.goldHold）在回合开始清除即时效果时认（beginRound · goldHeldInstants），这里不动
  });
  (state.props || []).filter(p => p.kind === "ironwall").forEach(p => {
    if (p.hp > 0 && !p._brokeWall) {
      const gain = typeof passivePlusKit === "function" && passivePlusKit("chuan", 1) ? 3 : 2;   // 发电站+：铁壁积攒的电能 +1
      addCharge(gain);
      notes.push(`铁壁撑过回合，川川电能 +${gain}。`);
    }
    state.props = (state.props || []).filter(x => x.id !== p.id);
  });
  (state.props || []).forEach(p => {
    if (p.kind === "acid" && p.hp < 3) {
      const pool = state.units.filter(u => !u.hidden && !u.dead && !u._removed &&Number(u.zone) === Number(p.zone));
      if (pool.length) {
        const u = pool[Math.floor(Math.random() * pool.length)];
        const dmg = 4 + (p.level || 1);
        const fake = unitOf("酸液桶", p.level, [{ type: "armor", hp: 1 }], 0, 0);
        fake.zone = p.zone;
        fake.envSrc = true; fake.envBy = p.lastBy;   // 环境分数：记在最后打它的人身上
        dealTo(fake, u, { atk: 0, mult: 0, flat: dmg, element: "acid", baseBreak: 0, flags: { action: false } });
        notes.push(`酸液桶渗漏：随机打到 ${u.name}，${dmg} 酸伤。`);
      }
    }
    if (p.kind === "turret") turretShot(p, p.faction === "enemy", notes);
  });
  state.units.forEach(u => {
    if (u && u._shieldRestoreAtTurnEnd) {
      syncTempShield(u);
      (u.layers || []).forEach(l => {
        if (l.type === "shield") { l.current = l.max || l.current; l._lastCur = l.current; }
      });
      u._shieldRestoreAtTurnEnd = false;
      notes.push(`${u.name} 护盾在回合结束时回满（中和·感电）。`);
    }
  });
  if ((state.props || []).some(p => p.kind === "battery")) {
    notes.push(...refillBatteryFactionShields());
  }
  glowStoreTurnEnd(notes);   // 微光 · 蓄能：连续两个回合结束高能值都超过血量才自爆
  expireWaveWalls(notes);    // 频域造物：这一整轮结束，驻波墙消失、原来的配置物恢复
  releaseButtons(notes);
  notes.push(...advancePhaseWeather());
  settleBossStuns(notes);
  if (typeof ratfolkRoundEnd === "function") ratfolkRoundEnd(notes);   // 狂暴的潜藏者回合结束进入躲藏（enemies.js）
  appendLog(notes.join("\n"));
  beginRound([]);
  startPlayerPhase();
  // 下水道狂鼠（enemies.js · ratfolkSweep）：回合结束 / 开始的腐蚀、灼烧、场地伤害都结算完，再看一遍反应（斩杀等）
  if (typeof ratfolkSweep === "function" && !state._highDefer && !logSinkActive()) ratfolkSweep();
  presentAssistModal();
  presentBlockModal();
}

/** 防卫自律炮台开一炮：自动攻击 atk 最高的目标（hitPlayers：打我方还是打敌方）。
 *  活着、看得见（不在躲藏）、没倒地（濒死还没起身）、没被危墙 / 关着的门挡住；不限距离，不能协助格挡。
 *  真的打出伤害才挂高能：伤害为 0、被屏障整个挡下都不挂 */
function turretShot(p, hitPlayers, notes) {
  const side = (u) => !u.hidden && !u.dead && !u.fused && !u._removed && !!u.isPlayer === !!hitPlayers && u.kit !== "ironwall";
  const foes = state.units.filter(u => side(u) && !(u.statuses && u.statuses.hide) && !u.submerged && !(u.dying && !u.upOnShp) &&
    u.kit !== "ufo_body" &&   // 飞碟本体不能被通常手段攻击，锁它就是白打
    !lineBlocked(p.zone, u.zone));
  if (foes.length) {
    const atkOf = (u) => Number(effectiveAtk(u, state.units)) || Number(u.atk) || 0;
    foes.sort((a, b) => atkOf(b) - atkOf(a));
    const u = foes[0];
    const dmg = p.level || 1;
    const fake = unitOf("防卫炮台", p.level, [{ type: "armor", hp: 1 }], 0, dmg);
    fake.zone = p.zone;
    fake.isPlayer = !hitPlayers;   // 我方炮台站在我方那边：敌人的废铁墙照样挡它
    fake.envSrc = true; fake.envBy = p.by;
    // 炮台这一炮是自己的一次攻击：屏障「已拦截本次行动」只看这一炮（不沿用上一次行动留下的记录）
    const wallBefore = state.actionWallHit;
    state.actionWallHit = {};
    const out = dealTo(fake, u, { atk: dmg, mult: 1, hits: 2, element: "energy", baseBreak: 0, flags: { action: true, blockResolved: true, propShot: true } });
    const walled = Object.keys(state.actionWallHit || {}).length > 0;
    state.actionWallHit = wallBefore;
    const dealt = walled ? 0 : Math.floor((out && out.res && out.res.total) || 0);
    if (dealt > 0) {
      u.statuses = u.statuses || {};
      u.statuses.high = true;
      notes.push(`防卫炮台锁定 ${u.name}（atk 最高）：打出 2 次 ${dmg} 能量（实际 ${dealt}），施加高能。`);
    } else {
      notes.push(`防卫炮台锁定 ${u.name}（atk 最高）：打出 2 次 ${dmg} 能量，${walled ? "被屏障挡下" : "没有造成伤害"}，不施加高能。`);
    }
    return true;
  }
  if (state.units.some(u => side(u) && !lineBlocked(p.zone, u.zone))) {
    notes.push("防卫炮台：没有能锁定的敌对单位（躲藏 / 倒地没起身的不打）。");
  } else if (state.units.some(side)) {
    notes.push("防卫炮台：敌对单位都在危墙 / 关着的门后面，打不到。");
  }
  return false;
}

function ignoresAoe(u) {
  return !!(u && u.kit === "ufo_body");
}

function isCombatAttack(attacker, flags) {
  if (!flags || flags.action === false || flags.environment) return false;
  if (!attacker || !attacker.id) return false;
  return (state.units || []).some(u => u.id === attacker.id);
}

function shockPulse(source) {
  const notes = [];
  if (!source || source._shockBusy) return notes;
  if (source.self === "conductor") {
    if (source.statuses) source.statuses.shock = false;
    notes.push(`${source.name} 导体：免疫感电。`);
    return notes;
  }
  source._shockBusy = true;
  const weather = currentWeatherFor(source);
  const d = statusDotDice("shock", source.level || 1, weather);
  const r = takeDice(d.n, d.s, d.bonus || 0);
  const sm = statusMult(source);   // 加倍计量：感电此回合效果翻倍
  const dmg = Math.max(d.min || 1, r.total) * sm;
  const allies = fieldUnits().filter(u =>
    !u.dead && !u.hidden &&
    !ignoresAoe(u) &&
    Number(u.zone) === Number(source.zone) &&
    !!u.isPlayer === !!source.isPlayer
  );
  notes.push(`${source.name} 感电触发 ${r.text} → ${dmg}${sm > 1 ? "（加倍计量 ×2）" : ""} 电击（同区同阵营：${allies.map(u => u.name).join("、") || "无"}）`);
  allies.forEach(u => {
    applyTypedDot(u, dmg, "electric", notes, `${u.name} 被感电波及`, { by: source.isPlayer ? null : statusOwnerId(source, "shock") });
    if (typeof popStatus === "function") { /* damage floater already from applyTypedDot */ }
  });
  source._shockBusy = false;
  return notes;
}

function resonanceAllies(u) {
  return fieldUnits().filter(o =>
    o.id !== u.id && !o.dead && !o.hidden && o.statuses && o.statuses.reso
  );
}

function pulseResonanceDamage(source, amount, element) {
  const notes = [];
  if (!source || !source.statuses || !source.statuses.reso || source._resoBusy) return notes;
  const share = source._resoFull ? Math.floor(Number(amount) || 0) : Math.floor(Number(amount) / 2);
  if (share <= 0) return notes;
  const others = resonanceAllies(source);
  if (!others.length) return notes;
  notes.push(`共振：${source.name} 的 ${share} 伤害分享给 ${others.map(o => o.name).join("、")}（不回传）`);
  others.forEach(o => {
    o._resoBusy = true;
    // 分享的是能量伤害：带高能的照样累积高能值（applyTypedDotIn）
    applyTypedDot(o, share, element || "harmonic", notes, `共振←${source.name}`, { highGain: "共振分享能量伤害" });
    o._resoBusy = false;
  });
  return notes;
}

function pulseResonanceHeal(source, amount) {
  if (!source || !source.statuses || !source.statuses.reso || source._resoBusy) return;
  const share = Math.floor(Number(amount) / 2);
  if (share <= 0) return;
  resonanceAllies(source).forEach(o => {
    o._resoBusy = true;
    healUnit(o, share);
    o._resoBusy = false;
    appendLog(`共振：${source.name} 的治疗半值 ${share} 分享给 ${o.name}`);
  });
}

function pulseResonanceStatus(source, key) {
  if (!source || !source.statuses || !source.statuses.reso || source._resoBusy) return;
  if (!key || key === "reso") return;
  resonanceAllies(source).forEach(o => {
    // 自焚免疫灼烧：共振分过来的灼烧也不吃
    if (key === "burn" && o.self === "burn") { appendLog(`共振：${source.name} 的灼烧分享给 ${o.name}，但自焚免疫灼烧。`); return; }
    o._resoBusy = true;
    o.statuses = o.statuses || {};
    if (key === "burn") o.statuses.burn = (Number(o.statuses.burn) || 0) + 1;
    else if (key === "unstable" && source.statuses.unstable) { const n = []; applyUnstable(o, n); n.forEach(t => appendLog(t)); }
    else if (source.statuses[key] != null) o.statuses[key] = source.statuses[key];
    if (key === "shockwave" && typeof syncShockwave === "function") syncShockwave(o, null);
    if (source.instant && source.instant[key] != null) {
      o.instant = o.instant || {};
      o.instant[key] = source.instant[key];
    }
    popStatus(o, key);
    o._resoBusy = false;
    appendLog(`共振：${source.name} 的${key}完整共享给 ${o.name}`);
  });
}

function inferStatusDmgKey(label, element) {
  const s = String(label || "");
  if (/灼烧/.test(s)) return "burn";
  if (/自焚/.test(s)) return "selfburn";
  if (/感电/.test(s)) return "shock";
  if (/腐蚀/.test(s)) return "corr";
  if (/高能/.test(s)) return "high";
  if (/火场/.test(s)) return "firefield";
  if (/酸液/.test(s)) return "acidfield";
  if (/高压|闪电场地/.test(s)) return "hvfield";
  if (/塌陷/.test(s)) return "collapse";
  if (/共振/.test(s)) return "reso";
  if (/能量场/.test(s)) return "energyfield";
  if (element === "fire") return "dot_fire";
  if (element === "electric") return "dot_elec";
  if (element === "acid") return "dot_acid";
  return "other";
}

const STATUS_DMG_NAME = {
  burn: "灼烧", selfburn: "自焚", shock: "感电", corr: "腐蚀", high: "高能自爆/余波",
  firefield: "火场", acidfield: "酸液地面", hvfield: "高压场地", collapse: "塌陷区域",
  reso: "共振分享", energyfield: "能量场", frostbite: "冻伤",
  dot_fire: "其他火焰持续", dot_elec: "其他电击持续", dot_acid: "其他酸液持续", other: "其他状态"
};

function addStatusDmg(key, amount) {
  const n = Math.floor(Number(amount) || 0);
  if (n <= 0 || !key) return;
  state.statusDmg = state.statusDmg || {};
  state.statusDmg[key] = (state.statusDmg[key] || 0) + n;
}

/* ===== 战场数据：每个我方单位这场造成的伤害、击破、承受的伤害、击杀、治疗 =====
 * 记在 state.battleStats[单位 id] 上（随撤销一起回退）。
 *   伤害 / 击破：打在敌人身上的每一击，加上自己行动里引发的连带伤害（感电、共振、余波……）
 *   承伤：落在自己身上的所有伤害，含坚毅生命和持续伤害
 *   击杀：最后一击是谁打的算谁
 *   治疗：自己的行动让「其他」友方多出来的血量和护盾（新唤出的单位不算）
 *   倒地：陷入濒死的次数（noteKnockdown；力竭 3 被击倒立刻死亡、起身中坚毅生命打光死亡、武器人倒下都不算） */
function battleStat(u) {
  if (u && u.creditTo) u = unitById(u.creditTo);   // 碎渣机炮这类代打：记在操控的人身上
  if (!u || !u.isPlayer || !(state.units || []).includes(u)) return null;
  if (u.escort) return null;   // 护送对象（货车 / 委托人）：数据没有参考价值，不记
  state.battleStats = state.battleStats || {};
  const s = state.battleStats[u.id] || (state.battleStats[u.id] = { name: u.name, kit: u.kit || "", weaponOf: u.weaponOf || null, dmg: 0, brk: 0, taken: 0, kills: 0, heal: 0,
    assists: 0, blocks: 0, blockOk: 0, avoided: 0, staggers: 0, reduced: 0, downs: 0 });
  s.name = u.name;
  return s;
}
/** 战场数据：倒地一次。设 dying = true 的地方都调它：applyKnockdown（攻击、坠落、高能自爆……）、
 *  不稳态（rasUnstableHit）、巨人捏碎颅骨（enemies.js · crushSkullDown）；这几处都先挡掉了已经濒死的，不会重复记 */
function noteKnockdown(u) {
  const st = battleStat(u);
  if (st) st.downs = (st.downs || 0) + 1;
}
/* ===== 单回合最高爆发：每个我方单位一回合（第 N 回合，含敌人回合里的协助 / 借机）里造成的伤害合计，
 * 记下这一回合用了哪些技能（各打了多少）、命中时吃到哪些增益（几次命中）。
 * 记在 battleStats[单位 id].burst（这场最高）/ burstCur（这一回合在累计）；整局最高并进 LEDGER.career（ledger.js）。 */
// 引擎计算过程里算增益的行：加成百分比、ATK / 倍率加成、翻倍、蚀刻视为克制……（减益、合计、基础包这些不算）
const BURST_BUFF_SKIP = /^(基础包|加算百分比合计|最终伤害包|攻击次数|本段倍率|愿你无恙|起身状态)/;
function burstBuffs(u, res) {
  const out = [];
  ((res && res.log) || []).forEach(line => {
    const s = String(line).replace(/^#\d+\s*/, "").replace(/。$/, "").trim();
    if (!s || BURST_BUFF_SKIP.test(s) || /[−-]\d/.test(s)) return;
    if (/^克制表/.test(s)) { const m = s.match(/克制表\s*(.+?)：\s*\+(\d+)%/); if (m && Number(m[2]) > 0) out.push(`属性克制（${m[1]} +${m[2]}%）`); return; }
    if (/\+0(\.0+)?(%|\b)/.test(s) && !/\+[1-9]|\+0\.\d*[1-9]/.test(s)) return;   // +0% 这类没起作用的
    if (/\+\d|×\s*[2-9]|翻倍|视为被该属性克制/.test(s)) out.push(s);
  });
  // 进引擎之前就加在 ATK 上的（引擎只看到结果）
  if (u) {
    if (Number(u.bondAtk) > 0) out.push(`思念：ATK +${Number(u.bondAtk)}`);
    if (Number(u.duetAtk) > 0) out.push(`双重奏：ATK +${Number(u.duetAtk)}`);
    if (u.resources && u.resources.mecha && u.resources.overdrive) out.push("机体强化：ATK ×1.2");
    if (u.resources && u.resources.preparedActive) out.push("准备：第一击加骰");
  }
  return out;
}
function burstNote(st, u, n, label, res) {
  n = Math.floor(Number(n) || 0);
  if (!st || n <= 0) return;
  const T = Number(state.turnNo) || 1;
  let cur = st.burstCur;
  if (!cur || cur.turn !== T) cur = st.burstCur = { turn: T, dmg: 0, skills: {}, buffs: {} };
  cur.dmg += n;
  const key = label || "其他";
  cur.skills[key] = (cur.skills[key] || 0) + n;
  burstBuffs(u, res).forEach(b => { cur.buffs[b] = (cur.buffs[b] || 0) + 1; });
  if (!st.burst || cur.dmg > st.burst.dmg) st.burst = JSON.parse(JSON.stringify(cur));
}
/** 这一下记在哪个技能名下：协助 / 借机按反应算，否则是这次行动用的技能 */
function burstLabel(flags) {
  if (flags && flags.assist) return "协助攻击";
  if (flags && (flags.opp || flags.opportunity)) return "借机攻击";
  const acc = state.actionAcc;
  return (acc && acc.actorIsPlayer && acc.skillName) || "其他";
}
/* ===== 战斗评分（像鬼泣那样，鼓励打得华丽） =====
 * 分值都在 SCORE_RULES；评价的分数线 = 固定线 × 0.65 + 基准分 × 倍数 × 0.35
 * （固定线：SCORE_GRADES 第一幕的线，之后每幕 +SCORE_ACT_STEP；基准分：scorePar，按这场的敌人算）。
 * 单局用本幕；跑团模式 / 战斗原型按敌人等级对应到幕（ROGUE_CONFIG.actLevels）。 */
const SCORE_RULES = {
  dmg: 1,          // 每点伤害（含连带伤害）
  heal: 1.5,       // 每点给其他友方的治疗 / 护盾（让治疗者的贡献显得出来：比伤害高 50%）
  brk: 10,         // 每点击破
  stagger: 50,     // 打出失衡
  block: 30,       // 协助格挡成功
  overkill: 1.5,   // 打死敌人时溢出的每点伤害（向下取整）
  kill: { minion: 20, elite: 100, boss: 300 },
  reduce: 1.5,     // 我方受击时，减伤减免掉的每点伤害（天气、血量改造、角色能力……完全免伤也算）
  blockSave: 1.2,  // 协助格挡成功减免掉的每点伤害（#44：1 → 1.2）（空手格挡成功：少挨的那一半）
  ap: 10,          // 我方每用 1 点行动点
  apGiftShare: 0.5,   // 队友给的行动点（意式浓缩……）：用它的那次行动得的分，这个比例记在给行动点的人身上
  bonusAction: 5,  // 我方每用 1 次附赠行动
  env: 1.2,        // 环境分数：利用配置物或场地（环境）造成的伤害 / 击破 / 溢出，分数 ×1.2
  neutralMul: 0.25 // 打中立生物（尘虫、管虫）：伤害 / 击破 / 失衡 / 溢出分（含环境分）只拿原来的这个比例（#187）；基准分不算它们
};
/** 打在这个单位身上的伤害 / 击破 / 失衡 / 溢出分的倍率：中立生物按 SCORE_RULES.neutralMul，其他 1 */
function scoreTargetMul(u) {
  return u && !u.isPlayer && typeof isNeutralCreature === "function" && isNeutralCreature(u) ? SCORE_RULES.neutralMul : 1;
}
// 招式疲劳（像大乱斗的同招衰减）：同一个角色连续几个回合用同一个技能，这次行动的总得分打折。
// 下标 = 连续第几个回合（1 不扣），超出表的按最后一项封顶
const SCORE_FATIGUE = [0, 0, 0.10, 0.25, 0.40];
// 速杀奖励：胜利时整场分数再乘一次。[几回合内（含）, 倍率]
const SCORE_SPEED = [[1, 2], [2, 1.5], [3, 1.2]];
// 无伤奖励：胜利、且整场我方（角色、武器人）没有受到任何伤害（护盾被打也算受伤）：先 +100 分，
// 再把整场分数的倍率 +0.5。和速杀的倍率加算：1 回合无伤 = ×(1 + 1 + 0.5) = ×2.5
const SCORE_FLAWLESS = { points: 100, mult: 0.5 };
// 遭遇战（长休时被偷袭）：分数 ×2，和速杀、无伤的倍率加算
const SCORE_AMBUSH_MULT = 2;
// 一击的加分倍率：各项加算（1 + 0.25 + …），乘在这一击产生的所有分数上
const SCORE_BONUS = {
  advantage: 0.25,  // 触发属性克制：这一击的伤害 / 击破 / 溢出 / 由它打出的失衡和击杀分 +25%
  bigHitMin: 0.10,  // 打出「大伤害」（数字变大、停留更久那种）：刚到门槛 +10%……
  bigHitMax: 0.25   // ……到门槛两倍及以上 +25%，中间按伤害线性分布
};
/** 大伤害的区间（伤害数字变大、停留更久）：门槛 = 目标等级 × 2 + 8，到门槛两倍封顶。
 *  ratio 0～1 表示在区间里的位置，画面上的字号 / 停留时间和评分加成都按它走 */
function bigHitInfo(level, dmg) {
  const th = (Number(level) || 1) * 2 + 8;
  dmg = Math.floor(Number(dmg) || 0);
  if (dmg < th) return { big: false, ratio: 0, th };
  return { big: true, ratio: Math.min(1, (dmg - th) / th), th };
}
// [评价, 第一幕的固定线, 战斗经验倍率, 基准分倍数]。C 线以下是 D（经验不加成）。
// 第一幕固定线 C 500 / B 1000 / A 1250 / S 1500 / SS 1750 / SSS 2000。SS、SSS 只是更高的评价，经验倍率和 S 一样
// 基准分倍数拉开：基准分 400 左右时，相邻评价的间距和固定线一样（C→B 500，其余各 250）
const SCORE_GRADES = [["SSS", 2000, 2, 4.4], ["SS", 1750, 2, 3.8], ["S", 1500, 2, 3.2], ["A", 1250, 1.5, 2.6], ["B", 1000, 1.2, 2.0], ["C", 500, 1, 0.7], ["D", 0, 1, 0]];
// B 及以上（B / A / S / SS / SSS）的分数线再 ×1.15（克制大师上线时一起调高；不管这场有没有拿到克制大师）
const SCORE_HIGH_LINE_MULT = 1.15;
const SCORE_B_LINE = 1000;   // SCORE_GRADES 里 B 的第一幕固定线：固定线 ≥ 它的评价吃 ×1.15
// 克制大师：我方主动发起的攻击里，克制或吃到天气增益的占一半及以上（至少 1 次攻击），胜利时整场分数再 ×1.5
const SCORE_COUNTER_MASTER = { ratio: 0.5, mult: 1.5 };
// 分数线里固定线和基准分各占多少
const SCORE_LINE_MIX = { fixed: 0.65, par: 0.35 };
const SCORE_ACT_STEP = 150;   // 之后每一幕，各条分数线（D 除外）+150
const SCORE_PART_NAMES = { dmg: "伤害", heal: "治疗 / 护盾", brk: "击破", stagger: "打出失衡", block: "协助格挡成功", reduce: "减伤", blockSave: "格挡减免", overkill: "溢出伤害", kill: "击杀", bonus: "克制 / 大伤害加成", action: "行动", speed: "速杀奖励", flawless: "无伤奖励", ambush: "遭遇战加成", fatigue: "招式疲劳（扣分）", env: "环境", counterMaster: "克制大师" };
/** 这个角色这回合用这个技能，算连续第几个回合（不改记录）。
 *  上回合用过 → 上回合的连续数 + 1；这回合已经用过 → 和这回合第一次一样；否则 1 */
function fatigueStreak(u, skillId) {
  const rec = (state.skillStreak || {})[u && u.id];
  const T = Number(state.turnNo) || 1;
  if (!rec) return 1;
  if (rec.turn === T) return rec.cur[skillId] || (rec.prev[skillId] || 0) + 1;
  if (rec.turn === T - 1) return (rec.cur[skillId] || 0) + 1;
  return 1;
}
function fatiguePct(streak) {
  return SCORE_FATIGUE[Math.min(streak, SCORE_FATIGUE.length - 1)] || 0;
}
/** 记下这回合用了这个技能 */
function noteSkillUse(u, skillId, streak) {
  state.skillStreak = state.skillStreak || {};
  const T = Number(state.turnNo) || 1;
  let rec = state.skillStreak[u.id];
  if (!rec || rec.turn !== T) rec = state.skillStreak[u.id] = { turn: T, prev: rec && rec.turn === T - 1 ? rec.cur : {}, cur: {} };
  rec.cur[skillId] = streak;
}
/** 反应类（协助攻击、协助格挡）不算主动出的招，不吃疲劳 */
function isReactionSkill(id) {
  return id === "assist_block" || /_assist$/.test(String(id || "")) || !!state._assistBy;
}
/** 一次行动结束后：按连续回合数，把这次行动的总得分打折（扣掉的记成「招式疲劳」） */
function applyFatigue(u, skillId, scoreBefore, personalBefore) {
  if (!u || !u.isPlayer || !state.combatStarted || isReactionSkill(skillId)) return;
  const sc = state.battleScore || { total: 0, parts: {} };
  const gained = sc.total - scoreBefore;
  if (gained <= 0) return;                     // 没真的出手（行动点不足之类）：不算一次使用
  const streak = fatigueStreak(u, skillId);
  noteSkillUse(u, skillId, streak);
  const pct = fatiguePct(streak);
  if (pct <= 0) return;
  const cut = Math.floor(gained * pct + 1e-6);
  if (cut <= 0) return;
  sc.total -= cut;
  sc.parts.fatigue = (sc.parts.fatigue || 0) + cut;
  const st = battleStat(u);
  if (st) st.score = (st.score || 0) - cut;
  appendLog(`  招式疲劳：连续第 ${streak} 个回合用「${skillDisplayName(u, skillId)}」，这次行动得分 −${Math.round(pct * 100)}%（−${cut}）`);
}

// Optional observers receive only spend data, never a reference to a live unit.
// Rules also run in preview sandboxes; adapters decide which executions are
// authoritative. This does not persist anything or change an action's cost.
const ACTION_SPEND_LISTENERS = new Set();
function onActionSpend(listener) {
  if (typeof listener !== "function") throw new TypeError("Action spend listener must be a function");
  ACTION_SPEND_LISTENERS.add(listener);
  return () => ACTION_SPEND_LISTENERS.delete(listener);
}

/** 我方用掉行动点 / 附赠行动时加分（开战后才算） */
function scoreSpend(u, ap, bonus) {
  if (!u || !u.isPlayer || !state.combatStarted) return;
  const spentAp = Number.isFinite(Number(ap)) && Number(ap) > 0 ? Number(ap) : 0;
  const spentBonus = Number.isFinite(Number(bonus)) && Number(bonus) > 0 ? Number(bonus) : 0;
  if (typeof u.id === "string" && (spentAp > 0 || spentBonus > 0)) {
    // Snapshot the subscriptions, and isolate each listener's data and errors.
    // An action that refunds its points later still spent them at this point.
    for (const listener of [...ACTION_SPEND_LISTENERS]) {
      try { listener({ unitId: u.id, ap: spentAp, bonus: spentBonus }); } catch (_) {}
    }
  }
  addScore("action", (Number(ap) || 0) * SCORE_RULES.ap + (Number(bonus) || 0) * SCORE_RULES.bonusAction, u);
}
/** 胜利时的速杀奖励：第 N 回合内打完，整场分数 ×倍率（多出来的记成「速杀奖励」）。只结算一次 */
/** 我方有单位受到了伤害（applyCombat 里记，所有伤害都走那里） */
function markPartyHurt(target, result) {
  if (!target || !target.isPlayer || !result) return;
  if ((Number(result.total) || 0) + (Number(result.shpDealt) || 0) <= 0) return;
  target._hurtRound = Number(state.turnNo) || 0;   // 思念+：这一回合受过伤
  state.battleScore = state.battleScore || { total: 0, parts: {} };
  state.battleScore.hurt = true;
}
/** 胜利结算：速杀（1 / 2 / 3 回合内）与无伤奖励。无伤先 +100 分；两者的倍率加算后乘在整场分数上。只算一次。
 *  返回 { extra 总共多出来的分, mult 最终倍率, speedMult, flawless, speed / flawlessPts 各自多出来的分 } */
function applyFinishBonus() {
  state.battleScore = state.battleScore || { total: 0, parts: {} };
  const bs = state.battleScore;
  const none = { extra: 0, mult: 1, speedMult: 1, flawless: false, speed: 0, flawlessPts: 0, ambush: false, ambushPts: 0, counterMaster: false, counterPts: 0 };
  if (bs.speedDone) return none;
  bs.speedDone = true;
  const turns = Number(state.turnNo) || 1;
  const hit = SCORE_SPEED.find(([n]) => turns <= n);
  const speedMult = hit ? hit[1] : 1;
  const flawless = !bs.hurt;
  const base = bs.total + (flawless ? SCORE_FLAWLESS.points : 0);
  const ambush = !!state.ambush;
  const ambushAdd = ambush ? SCORE_AMBUSH_MULT - 1 : 0;
  const mult = 1 + (speedMult - 1) + (flawless ? SCORE_FLAWLESS.mult : 0) + ambushAdd;
  // 1e-6：避免 1000×1.2 算成 1199.999…
  const speed = Math.floor(base * (speedMult - 1) + 1e-6);
  const flawlessPts = flawless ? SCORE_FLAWLESS.points + Math.floor(base * SCORE_FLAWLESS.mult + 1e-6) : 0;
  const ambushPts = ambush ? Math.floor(base * ambushAdd + 1e-6) : 0;
  if (speed > 0) bs.parts.speed = (bs.parts.speed || 0) + speed;
  if (flawlessPts > 0) bs.parts.flawless = (bs.parts.flawless || 0) + flawlessPts;
  if (ambushPts > 0) bs.parts.ambush = (bs.parts.ambush || 0) + ambushPts;
  bs.total += speed + flawlessPts + ambushPts;
  // 克制大师：速杀 / 无伤 / 遭遇战算完之后，整场分数再单独 ×1.5
  const cm = counterMasterInfo();
  const counterPts = cm.ok ? Math.floor(bs.total * (SCORE_COUNTER_MASTER.mult - 1) + 1e-6) : 0;
  if (counterPts > 0) { bs.parts.counterMaster = (bs.parts.counterMaster || 0) + counterPts; bs.total += counterPts; }
  bs.counterMaster = cm.ok;
  bs.speedMult = speedMult;
  // 存之前取到两位小数：1.2 × 1.5 直接乘是 1.7999999999999998，结算日志会显示成「×1.7999999999999998」
  bs.finishMult = Math.round(mult * (cm.ok ? SCORE_COUNTER_MASTER.mult : 1) * 100) / 100;
  bs.flawless = flawless;
  return { extra: speed + flawlessPts + ambushPts + counterPts, mult: bs.finishMult, speedMult, flawless, speed, flawlessPts, ambush, ambushPts,
    counterMaster: cm.ok, counterPts, counterQual: cm.qual, counterAttacks: cm.attacks };
}
/** 克制大师的计数：记一次我方主动发起的攻击（按行动序号，一次行动打几下、打几个人都只算一次）。
 *  只算我方自己回合里、这次行动的出手者本人打在敌人身上的攻击本身：协助攻击、借机 / 反击、持续伤害、
 *  连带伤害（高压场地、感电……）、配置物 / 环境都不算。这次行动里任何一下克制或吃到天气增益，这次攻击就算数 */
function noteCounterAttack(attacker, target, res, flags) {
  if (!attacker || !attacker.isPlayer || !target || target.isPlayer || attacker.envSrc || !res) return;
  flags = flags || {};
  if (flags.action === false || flags.environment || flags.assist || flags.opp || flags.opportunity) return;
  if (state._assistBy || state.combatPhase === "enemy") return;
  const acc = state.actionAcc;
  if (!acc || !acc.actorIsPlayer || acc.actorId !== attacker.id) return;
  state.battleScore = state.battleScore || { total: 0, parts: {} };
  const cm = state.battleScore.cmActs = state.battleScore.cmActs || {};
  const key = String(state.actionSeq || 0);
  cm[key] = !!cm[key] || !!res.advantage || (Number(res.weatherUp) || 0) > 0;
}
/** { attacks 我方主动攻击次数, qual 其中克制 / 天气增益的次数, ok 是否达成克制大师 } */
function counterMasterInfo() {
  const cm = (state.battleScore && state.battleScore.cmActs) || {};
  const vals = Object.keys(cm).map(k => cm[k]);
  const attacks = vals.length, qual = vals.filter(Boolean).length;
  return { attacks, qual, ok: attacks >= 1 && qual >= attacks * SCORE_COUNTER_MASTER.ratio - 1e-9 };
}
/** 旧接口：返回多出来的分 */
function applySpeedBonus() { return applyFinishBonus().extra; }
/** 加分。bonus：这一击的额外倍率之和（例如克制 0.25），多出来的部分单独记成「克制加成」 */
function addScore(kind, pts, u, bonus) {
  pts = Math.floor(Number(pts) || 0);
  if (pts <= 0) return;
  state.battleScore = state.battleScore || { total: 0, parts: {} };
  const extra = Math.floor(pts * (Number(bonus) || 0) + 1e-6);
  state.battleScore.total += pts + extra;
  state.battleScore.parts[kind] = (state.battleScore.parts[kind] || 0) + pts;
  if (extra > 0) state.battleScore.parts.bonus = (state.battleScore.parts.bonus || 0) + extra;
  // 这次行动用的是队友给的行动点：分数的一部分（apGiftShare）记在给行动点的人身上（队伍总分不变）
  const share = state._apShare;
  if (share && u && u.id === share.actorId) {
    const giver = unitById(share.giverId);
    const gst = giver && giver !== u ? battleStat(giver) : null;
    const give = gst ? Math.floor((pts + extra) * share.ratio + 1e-6) : 0;
    if (gst && give > 0) gst.score = (gst.score || 0) + give;
    const st = battleStat(u);
    if (st) st.score = (st.score || 0) + pts + extra - give;
    return;
  }
  const st = battleStat(u);
  if (st) st.score = (st.score || 0) + pts + extra;
}
/** 用技能给队友加行动点（意式浓缩……）：记下是谁给的，那个行动点打出来的分数分一半给他（SCORE_RULES.apGiftShare）。
 *  给自己加 / 返还行动点不算。行动点在回合开始重新补满时，没用掉的赠送一起作废 */
function grantAllyAp(giver, target, n, lines) {
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (!target || !n) return;
  target.ap = (Number(target.ap) || 0) + n;
  target.apMax = Math.max(Number(target.apMax) || 0, target.ap);
  if (giver && giver.id !== target.id && target.isPlayer) {
    target.resources = target.resources || {};
    target.resources.apGifts = (target.resources.apGifts || []).concat([{ from: giver.id, n }]);
  }
  if (lines) lines.push(`${target.name} 行动点 +${n}。`);
}
/** 这次行动会不会用到队友给的行动点：自己的行动点先用，赠送的算最后那几点。
 *  会用到就返回 { actorId, giverId, ratio, used }（ratio 按这次花的行动点里赠送的占多少折算） */
function apShareFor(a, cost) {
  const gifts = (a && a.resources && a.resources.apGifts) || [];
  cost = Math.max(0, Number(cost) || 0);
  if (!gifts.length || !cost) return null;
  const gifted = gifts.reduce((s, g) => s + (Number(g.n) || 0), 0);
  const left = (Number(a.ap) || 0) - cost;
  const used = Math.min(cost, gifted - Math.max(0, left));
  if (used <= 0) return null;
  return { actorId: a.id, giverId: gifts[0].from, ratio: (SCORE_RULES.apGiftShare || 0) * used / cost, used };
}
/** 用掉了赠送的行动点：从最早的赠送开始扣 */
function consumeApGifts(a, used) {
  const gifts = (a.resources && a.resources.apGifts) || [];
  let left = used;
  while (left > 0 && gifts.length) {
    const g = gifts[0], take = Math.min(left, Number(g.n) || 0);
    g.n -= take; left -= take;
    if (g.n <= 0) gifts.shift();
  }
  if (!gifts.length && a.resources) delete a.resources.apGifts;
}
/** 一击的额外倍率之和（各项加算） */
function attackScoreBonus(res, target) {
  let b = 0;
  if (res && res.advantage) b += SCORE_BONUS.advantage;
  if (res && target) {
    const bh = bigHitInfo(target.level, res.intended || res.total);
    if (bh.big) b += SCORE_BONUS.bigHitMin + (SCORE_BONUS.bigHitMax - SCORE_BONUS.bigHitMin) * bh.ratio;
  }
  return b;
}
/* ===== 环境分数 =====
 * 配置物（爆炸桶、电池、碎渣机炮、危墙倒塌、酸液桶……）和场地（火场、酸液地面、高压场地）打在敌人身上的伤害：
 *   分数 ×1.2（SCORE_RULES.env），记在「环境的所有者」身上——场地是谁铺的（f.by）、配置物是谁触发的（打爆 / 操控）；
 *   没有我方所有者（固有场地、敌人铺的）就记在触发它的人（这次行动的出手方）身上。
 * 天气：我方利用天气多打出来的伤害、我方因天气少挨的伤害，天气的所有者（state.weatherBy，谁放的天气）
 *   按这部分伤害的分值加分（伤害 ×1、减伤 ×1.5），记在「环境」里。 */
let ENV_CTX = null;
// 能量场自爆期间先把环境分扣着（ENV_HOLD），炸完看有没有我方单位死亡：死了就整笔作废
let ENV_HOLD = null;
function envCommit(fn) { if (ENV_HOLD) ENV_HOLD.push(fn); else fn(); }/** 结算场地伤害时标上场地的所有者 */
function withEnvOwner(by, fn) {
  const prev = ENV_CTX;
  ENV_CTX = { by: by == null ? null : by };
  try { return fn(); } finally { ENV_CTX = prev; }
}
/** 环境伤害该记在谁身上（单位 id）：配置物代打的假单位顺着操控 / 触发的人找过去 */
function envCreditId(u) {
  for (let i = 0; u != null && i < 6; i++) {
    if (typeof u !== "object") u = unitById(u);
    if (!u) return null;
    if (u.envSrc || u.creditTo) { u = u.creditTo || u.envBy; continue; }
    return u.id;
  }
  return null;
}
/** 环境分数记给哪个我方单位：所有者 / 触发者是我方就是他；否则是这次行动的出手方（我方） */
function envCreditUnit(by) {
  const id = envCreditId(by);
  const u = id != null ? unitById(id) : null;
  if (u && u.isPlayer) return u;
  const acc = state.actionAcc;
  return acc && acc.actorIsPlayer ? unitById(acc.actorId) || null : null;
}
/** 击杀归属用的环境所有者：只认真正的我方所有者 / 触发者，没有就是 null（不回落到当前行动者——
 *  没有所有者的场地、天气、流沙，打死的算它之前最后一个伤害过它的玩家，不能记给碰巧在行动的人）。 */
function envOwnerUnit(by) {
  const id = envCreditId(by);
  const u = id != null ? unitById(id) : null;
  return u && u.isPlayer ? u : null;
}
/** 当前正在行动的我方单位 id（谁的行动都不在进行时是 null） */
function actingPlayerId() {
  const acc = state.actionAcc;
  if (acc && acc.actorIsPlayer) return acc.actorId;
  return state._itemUserId != null ? state._itemUserId : null;   // 战-M3：使用道具不开 actionAcc，道具的即时伤害 / 状态按使用者算
}
/** 记下「最后一个伤害过这个敌人的玩家」：击杀归属只看它。uid 不是我方单位就不动 */
function creditPlayerHit(target, uid) {
  if (!target || target.isPlayer || uid == null) return;
  const u = unitById(uid);
  if (u && u.isPlayer) target._lastHitBy = u.id;
}
/** 持续状态（灼烧 / 腐蚀 / 高能……）的所有者：谁给敌人挂上的。回合结束的持续伤害、高能余波按它归属击杀 */
function statusOwnerId(unit, key) {
  const id = unit && unit._statusBy ? unit._statusBy[key] : null;
  const u = id != null ? unitById(id) : null;
  return u && u.isPlayer ? u.id : null;
}
function markStatusOwner(unit, key, uid) {
  if (!unit || unit.isPlayer || uid == null) return;
  unit._statusBy = unit._statusBy || {};
  unit._statusBy[key] = uid;
}
/** 环境伤害打在敌人身上：伤害、击破的分 ×1.2 记成「环境」 */
function scoreEnvHit(target, res, who, bonus, label) {
  if (!target || target.isPlayer || !res) return null;
  const st = battleStat(who);
  if (!st) return null;
  const dmg = Math.floor(Number(res.total) || 0), brk = Number(res.breakDealt) || 0;
  envCommit(() => {
    st.dmg += dmg; st.brk += brk; st.env = (st.env || 0) + dmg;
    burstNote(st, null, dmg, `环境 · ${label || "配置物 / 场地"}`, res);
    addScore("env", (dmg * SCORE_RULES.dmg + brk * SCORE_RULES.brk) * SCORE_RULES.env * scoreTargetMul(target), who, bonus);
  });
  return who;
}
/** 天气帮了我方：ours = 这一下是我方打出去的（含记给我方的环境 / 连带伤害）。天气没有我方所有者就不算 */
function scoreWeatherHelp(attacker, target, res, ours) {
  if (!res || !target || state.weatherBy == null) return;
  const owner = unitById(state.weatherBy);
  const st = battleStat(owner);
  if (!st) return;
  const up = Math.floor(Number(res.weatherUp) || 0), down = Math.floor(Number(res.weatherDown) || 0);
  if (!target.isPlayer && ours && up > 0) envCommit(() => {
    st.weatherUp = (st.weatherUp || 0) + up;
    addScore("env", up * SCORE_RULES.dmg * scoreTargetMul(target), owner);
  });
  if (target.isPlayer && down > 0 && !(attacker && attacker.isPlayer)) envCommit(() => {
    st.weatherDown = (st.weatherDown || 0) + down;
    addScore("env", Math.floor(down * SCORE_RULES.reduce), owner);
  });
}
/** 每场战斗开始时清空：战场数据、评分、这场的经验 / 掉落 */
function resetBattleRecords() {
  state.battleStats = {};
  state.skillStreak = {};
  state.battleScore = { total: 0, parts: {} };
  state.scoreSeen = {};
  state.scoreActLv = 0;
  state.battleGains = { xp: 0, kuizhi: 0 };
  state.lastBrokenLayer = null;   // 废物利用：每场重新记（上一场打碎的层不能拿来用）
  state.weaponFallen = {};        // 本场倒下过的武器（取回后 atk / 格挡加成减半）
}
/** 这场的基准分：把出现过的每个要打的敌人（含中途召唤的）「打空血、击杀」的分加起来，按第一次见到时的数值算。
 *  击破、失衡不算进来：那是玩家打出来的漂亮操作，不当成默认该拿的分。
 *  不算：中立生物、「我方同阵营」的友军（不是要打的敌人）；飞碟触灵本体的血量池是五条腿血量的镜像
 *  （syncUfoBody），腿已经算过了，本体只算击杀分。 */
function scorePar() {
  state.scoreSeen = state.scoreSeen || {};
  (state.units || []).forEach(u => {
    if (u.isPlayer || u.kit === "ironwall" || state.scoreSeen[u.id] != null) return;
    if (typeof isNeutralCreature === "function" && isNeutralCreature(u)) return;
    if (typeof playerAllied === "function" && playerAllied(u)) return;
    const hp = u.kit === "ufo_body" ? 0 : (u.layers || []).reduce((a, l) => a + (Number(l.max) || 0), 0);
    const rank = typeof enemyRankOf === "function" ? enemyRankOf(u) : "minion";
    state.scoreSeen[u.id] = hp * SCORE_RULES.dmg + (SCORE_RULES.kill[rank] || 0);
  });
  return Object.values(state.scoreSeen).reduce((a, n) => a + n, 0);
}
/** 这场按第几幕的分数线算：单局里由 battleSpec 写进 state.scoreAct；否则按敌人等级对应到幕 */
function scoreAct() {
  if (Number(state.scoreAct) > 0) return Number(state.scoreAct);
  const ranges = (typeof ROGUE_CONFIG !== "undefined" && ROGUE_CONFIG.actLevels) || [[1, 4], [5, 8], [9, 12], [12, 15]];
  const foes = (state.units || []).filter(u => !u.isPlayer && u.kit !== "ironwall");
  if (!foes.length && !(Number(state.scoreActLv) > 0)) return 1;
  // 战-L2：记下见过的最高等级，死掉的敌人被移出场后分数线不会变低
  const lv = state.scoreActLv = Math.max(Number(state.scoreActLv) || 0, ...foes.map(u => Number(u.level) || 1));
  for (let i = 0; i < ranges.length; i++) if (lv <= ranges[i][1]) return i + 1;
  return ranges.length + Math.ceil((lv - ranges[ranges.length - 1][1]) / 5);   // 额外幕：每 5 级一幕
}
/** 某一幕的分数线：[[评价, 分数线, 经验倍率, 固定线, 基准分倍数], …]，高到低。
 *  给了基准分：分数线 = 固定线 × 0.65 + 基准分 × 倍数 × 0.35，向上取整到 10 的倍数（好看）；不给（par 为 null）只看固定线 */
function gradeLines(act, par) {
  const step = SCORE_ACT_STEP * Math.max(0, (Number(act) || 1) - 1);
  // 援军、连续战斗：每多一波 / 一场，固定分数线 ×1.2（chain.js · fixedMult）
  const fm = typeof Chain !== "undefined" ? Chain.fixedMult() : 1;
  return SCORE_GRADES.map(([g, line, xp, k]) => {
    const fixed = line > 0 ? Math.round((line + step) * fm) : 0;
    const raw = fixed <= 0 ? 0 : par == null ? fixed : fixed * SCORE_LINE_MIX.fixed + (Number(par) || 0) * k * SCORE_LINE_MIX.par;
    const hi = line >= SCORE_B_LINE ? SCORE_HIGH_LINE_MULT : 1;   // B 及以上 ×1.15
    const v = raw <= 0 ? 0 : par == null && hi === 1 ? raw : Math.ceil(raw * hi / 10 - 1e-9) * 10;
    return [g, v, xp, fixed, k];
  });
}
function battleGrade() {
  const score = state.battleScore ? state.battleScore.total : 0;
  const act = scoreAct();
  const par = scorePar();
  const lines = gradeLines(act, par);
  const g = lines.find(x => score >= x[1]) || lines[lines.length - 1];
  const i = lines.indexOf(g);
  const next = i > 0 ? lines[i - 1] : null;
  return { grade: g[0], xpMult: g[2], score, act, par, lines, next: next ? { grade: next[0], need: next[1] } : null,
    floor: g[1], parts: Object.assign({}, (state.battleScore || {}).parts) };
}

/** 网页与无界面共用的战斗奖励结算。outcome：win / lose / retreat。
 *  顺序与原 game.js 一致：胜利加分 → 评价 → 给存活角色补评价经验 → 升级。
 *  不结算耐久或推进单局；调用方继续原有流程，由单局捕获待选升级。
 *  xpBonus 是本次实际发放的每人额外经验；totalXpBonus / ups 保留本场摘要供重复展示。
 *  重复调用不再加分、发经验或升级。
 *  标记保存在本场 battleScore 内，resetBattleRecords 开新战斗时一起清空。 */
function settleBattleRewards(outcome) {
  if (!["win", "lose", "retreat"].includes(outcome)) throw new Error("未知的战斗结局：" + outcome);
  state.battleScore = state.battleScore || { total: 0, parts: {} };
  const bs = state.battleScore;
  clearNanoReserve();   // 瑞比的储备能源战斗结束清零（#219）；连续战斗换区域不走这里，还是同一场
  if (bs.rewardSettlement) return {
    outcome: bs.rewardSettlement.outcome, grade: bs.rewardSettlement.grade,
    finishBonus: null, xpBonus: 0, totalXpBonus: bs.rewardSettlement.xpBonus,
    ups: bs.rewardSettlement.ups.slice(), drops: bs.rewardSettlement.drops || null, trpgXp: bs.rewardSettlement.trpgXp || [], alreadySettled: true
  };
  const finishBonus = outcome === "win" ? applyFinishBonus() : null;
  const grade = battleGrade();
  const gained = (state.battleGains && state.battleGains.xp) || 0;
  let xpBonus = 0;
  if (outcome === "win" && grade.xpMult > 1 && gained > 0) {
    xpBonus = Math.floor(gained * (grade.xpMult - 1));
    if (xpBonus > 0) {
      state.units.filter(u => u.isPlayer && !isWeaponUnit(u) && !u.dead).forEach(u => { u.xp = (u.xp || 0) + xpBonus; });
      state.battleGains.xp += xpBonus;
    }
  }
  // 跑团模式（和单局的长线养成）：打赢的每场战斗，每个角色额外获得「队伍最高等级 × 20 / 人数」经验（向下取整；人数 = 这场上场的角色数）
  const trpgXp = [];
  if (outcome === "win" && typeof trpgXpRules === "function" && trpgXpRules()) {
    const heroes = state.units.filter(u => u.isPlayer && !isWeaponUnit(u) && !u._removed);
    const n = Math.max(1, heroes.length);
    const top = heroes.reduce((m, u) => Math.max(m, Number(u.level) || 1), 1);
    const add = Math.floor(top * 20 / n);
    if (add > 0) heroes.filter(u => !u.dead).forEach(u => {
      u.xp = (u.xp || 0) + add;
      trpgXp.push({ name: u.name, xp: add });
    });
    if (trpgXp.length) appendLog(`战斗奖励经验（队伍最高 ${top} 级 × 20 / ${n} 人）：每人 +${add}。`);
  }
  const ups = [];
  const drops = outcome === "win" ? mergeBattleDrops(giveBattleDrops(), trpgEnemyMaterials()) : null;
  bs.rewardSettlement = { outcome, grade, xpBonus, ups, drops, trpgXp };
  state.units.filter(u => u.isPlayer && !isWeaponUnit(u)).forEach(u => {
    const from = u.level;
    if (typeof tryLevelUp === "function" && tryLevelUp(u) && u.level > from) ups.push(`${u.name} ${from}→${u.level}`);
  });
  // 整局战场记录：这场的数据并进本局 / 本团的累计（存在队伍档案 LEDGER.career 里，跟着存档走）
  const encName = typeof GAME !== "undefined" && GAME && GAME.encounter && GAME.encounter.name || "";
  if (typeof careerRecordBattle === "function") careerRecordBattle(outcome, grade, { name: encName, drops });
  if (typeof bestiaryRecordBattle === "function") bestiaryRecordBattle(outcome);   // 敌人图鉴：这场出现过的敌人记为遭遇过
  return { outcome, grade, finishBonus, xpBonus, totalXpBonus: xpBonus, ups: ups.slice(), drops, trpgXp, alreadySettled: false };
}

/* 战斗掉落：主持人在「战场配置」或战斗模板里设好（奎支 + 物品），打赢才给，进背包。
 * state.battleDrops = { kuizhi, items: [{ id, qty }] }。返回 { kuizhi, items: [{ id, name, qty }] } 或 null */
function normalizeBattleDrops(d) {
  if (!d || typeof d !== "object") return null;
  const kuizhi = Math.max(0, Math.min(999999, Math.floor(Number(d.kuizhi) || 0)));
  const items = (Array.isArray(d.items) ? d.items : []).filter(x => x && typeof ITEM_CATALOG !== "undefined" && Object.prototype.hasOwnProperty.call(ITEM_CATALOG, x.id))
    .slice(0, 30).map(x => ({ id: x.id, qty: Math.max(1, Math.min(999, Math.floor(Number(x.qty) || 1))) }));
  return kuizhi || items.length ? { kuizhi, items } : null;
}
function giveBattleDrops() {
  const d = normalizeBattleDrops(state.battleDrops);
  if (!d) return null;
  const notes = [];
  if (d.kuizhi) state.kuizhi = (Number(state.kuizhi) || 0) + d.kuizhi;
  d.items.forEach(x => bagAdd(x.id, x.qty, notes));
  state.battleDrops = null;   // 只给一次
  const out = { kuizhi: d.kuizhi, items: d.items.map(x => ({ id: x.id, name: (ITEM_CATALOG[x.id] || {}).name || x.id, qty: x.qty })) };
  appendLog("战斗掉落：" + battleDropsText(out) + "，已放进背包。");
  return out;
}
/** 跑团：打赢后打倒的敌人按掉落表（items.js · ENEMY_DROPS）掉制作材料，进队伍公用背包。单局另由 rogue.js · rollMaterialDrops 掉，这里不重复 */
function trpgEnemyMaterials() {
  if (typeof TRPG === "undefined" || !TRPG.active || typeof rollEnemyDrops !== "function") return null;
  if (typeof Rogue !== "undefined" && Rogue.inRunMode && Rogue.inRunMode()) return null;
  const got = rollEnemyDrops(enemyDropFoes(battleFoesSeen()));
  if (!got.length) return null;
  got.forEach(m => bagAdd(m.id, m.qty));
  const out = { kuizhi: 0, items: got.map(m => ({ id: m.id, name: (ITEM_CATALOG[m.id] || {}).name || m.id, qty: m.qty })) };
  appendLog("敌人掉落的材料：" + battleDropsText(out) + "，已放进队伍背包。");
  return out;
}
/** 主持人配的掉落 + 敌人掉的材料 合成一份结算（同一件合并数量） */
function mergeBattleDrops(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const items = a.items.map(x => Object.assign({}, x));
  b.items.forEach(x => { const r = items.find(y => y.id === x.id); if (r) r.qty += x.qty; else items.push(Object.assign({}, x)); });
  return { kuizhi: (a.kuizhi || 0) + (b.kuizhi || 0), items };
}
function battleDropsText(d) {
  if (!d) return "无";
  const parts = [];
  if (d.kuizhi) parts.push(d.kuizhi + " 奎支");
  (d.items || []).forEach(x => parts.push((x.name || (ITEM_CATALOG[x.id] || {}).name || x.id) + "×" + x.qty));
  return parts.join("、") || "无";
}

/** 包住一次行动：结束后
 *  · 其他友方多出来的血量 / 护盾记成 actor 的治疗量（并计分）；
 *  · 这一下新打进失衡的敌人，每个 +50 分 */
function trackHealBy(actor, fn) {
  const st = actor && actor.isPlayer ? battleStat(actor) : null;
  if (!st) return fn();
  // 瑞比机甲模式拼上去的明特装甲（l.mecha）不算瑞比的血：进机甲不是治疗
  const hpNow = (u) => (u.layers || []).reduce((a, l) => a + (l.mecha ? 0 : Math.max(0, Number(l.current) || 0)), 0);
  const before = new Map();
  const calm = new Set(), marks = new Map();
  (state.units || []).forEach(u => {
    if (u.isPlayer && u !== actor && !u.hidden && !u.dead) before.set(u.id, hpNow(u));
    if (!u.isPlayer && !u.dead && !u.stunned) calm.add(u.id);
    if (!u.isPlayer && typeof isBossUnit === "function" && isBossUnit(u)) marks.set(u.id, Number(u.stunMarks) || 0);
  });
  try { return fn(); } finally {
    (state.units || []).forEach(u => {
      if (before.has(u.id) && u !== actor) {
        const gain = hpNow(u) - before.get(u.id);
        if (gain > 0) { st.heal += gain; addScore("heal", gain * SCORE_RULES.heal, actor); }
      }
      // 首领 / 精英没攒满标记的失衡会立刻恢复架势，这时按新记上的晕眩标记数算（一次行动打出两次也算两次）
      const n = marks.has(u.id) ? Math.max(0, (Number(u.stunMarks) || 0) - marks.get(u.id)) : (calm.has(u.id) && u.stunned ? 1 : 0);
      if (n > 0 && !u.dead) for (let i = 0; i < n; i++) {
        addScore("stagger", SCORE_RULES.stagger * scoreTargetMul(u), actor, Number(u._staggerBonus) || 0);
        const ss = battleStat(actor); if (ss) ss.staggers = (ss.staggers || 0) + 1;   // 战场数据：打出失衡
      }
      if (u._staggerBonus) u._staggerBonus = 0;
    });
  }
}

function beginActionAcc(actor, skillId) {
  state.actionSeq = (Number(state.actionSeq) || 0) + 1;   // 第几次行动（用来判断一个技能是不是真的出手了）
  state.actionAcc = {
    dmg: 0, brk: 0, hits: 0, calls: 0, targets: [],
    side: 0, sideBy: {},   // 连带伤害：感电、高压场地、灼烧、共振、聚焦抹层等
    actorIsPlayer: actor ? !!actor.isPlayer : null,
    actorId: actor ? actor.id : null,
    skillName: actor && actor.isPlayer && skillId ? skillDisplayName(actor, skillId) : ""   // 单回合最高爆发：这一回合用了哪些技能
  };
  state.actionWallHit = {};
}

/** 记一笔本行动引发的连带伤害（不是攻击本身，而是状态、场地、余波等）。
 *  只算打在对面阵营身上的；不知道出手方时全算。 */
function noteSideDamage(amount, label, unit, noScore) {
  const acc = state.actionAcc;
  const n = Math.floor(Number(amount) || 0);
  if (!acc || n <= 0) return;
  if (unit && acc.actorIsPlayer != null && !!unit.isPlayer === acc.actorIsPlayer) return;
  const key = label || "其他";
  acc.side += n;
  acc.sideBy[key] = (acc.sideBy[key] || 0) + n;
  // 战场数据：我方行动引发、落在敌人身上的连带伤害，算出手的人
  if (acc.actorIsPlayer && !(unit && unit.isPlayer) && !noScore) {
    const who = unitById(acc.actorId);
    const st = battleStat(who);
    if (st) { st.dmg += n; addScore("dmg", n * SCORE_RULES.dmg * scoreTargetMul(unit), who); burstNote(st, who, n, `${acc.skillName || "行动"} · ${key}`); }
  }
}

/* ---------- 屏障：替同区一方挡攻击行动的配置物 ----------
 *   铁壁（川川，我方）：挡敌方攻击行动，撑到回合结束；被击破时川川受 3 击破
 *   防护罩（生存职责，我方）：护盾生命 atk + 10，撑到被打破为止
 *   废铁墙（亡命之王「回防命令」，敌方）：挡我方攻击行动，撑到下一个敌人回合开始
 * 同区这一方的单位挨一次攻击行动：只有墙吃这一下（按装甲层算克制），这次行动打在同区的其余伤害全被挡住。 */
const BARRIER_SIDE = { ironwall: "player", scrapwall: "enemy", dome: "player" };
/** 巨刃划空打危墙 / 不稳桥梁这类只按击破掉耐久的间隔：固定扣这么多耐久，取代原来的 2 击破（#44，夕夏定） */
const CHUAN_BLADE_GAP_DUR = 10;
function barrierIn(zone, side) {
  return (state.props || []).find(p => BARRIER_SIDE[p.kind] === side && Number(p.zone) === Number(zone) && p.hp > 0);
}
function ironWallIn(zone) { return barrierIn(zone, "player"); }
/** 单位属于哪一方的屏障保护（我方单位 / 防护罩 → 铁壁；敌方 → 废铁墙） */
function barrierSideOf(u) { return u && (u.isPlayer || u.kit === "ironwall") ? "player" : "enemy"; }

/* 屏障按阵营判断敌我（作者 10/19 试玩反馈：多阵营混战里铁壁 / 废铁墙挡错、被自己人的范围攻击波及）。
 * 以前按「是不是玩家」一刀切：废铁墙护着同区所有敌人（包括和盗匪敌对的安保），范围攻击不管谁放的屏障都挨打。
 * 现在：屏障只护自己那一伙（barrierGuards），只挡和那一伙敌对的单位打过来的攻击（barrierFoe，按 hostileTo）。 */
/** 屏障护着的那一伙的代表（拿来按阵营判断）：铁壁 / 防护罩是我方；废铁墙是筑墙的人那一伙（回防命令记下 ownerKit）。
 *  没记的（主持人放的、旧存档里的）照旧当成护着所有敌人、只挡我方 */
function barrierOwner(p) {
  if (BARRIER_SIDE[p && p.kind] === "player") return { isPlayer: true };
  return { isPlayer: false, kit: (p && p.ownerKit) || null };
}
/** 屏障 p 护不护着单位 u：铁壁 / 防护罩护同区的我方单位；废铁墙护和筑墙的人一伙的敌人
 *  （不护和它敌对的阵营、中立生物、立场和它不一样的友军） */
function barrierGuards(p, u) {
  if (!p || !u || u.kind || u.isStructure) return false;
  if (BARRIER_SIDE[p.kind] === "player") return barrierSideOf(u) === "player";
  if (u.isPlayer) return false;
  if (!p.ownerKit) return true;
  const owner = barrierOwner(p);
  if (typeof isNeutralCreature === "function" && isNeutralCreature(u)) return false;
  if (typeof playerAllied === "function" && playerAllied(u) !== playerAllied(owner)) return false;
  return typeof hostileTo !== "function" || !hostileTo(owner, u);
}
/** 这一下是不是屏障 p 要挡的「敌方」攻击：打的人和屏障护着的那一伙敌对（hostileTo）。
 *  我方自己的、友军的、多阵营里和被护的一伙不敌对的单位打过来的，屏障不管（不挡、也不挨打）。
 *  不在场上的替身攻击者（配置物爆炸、危墙倒塌、小车残骸……）没有阵营：照旧算敌方，屏障照挡；
 *  站在我方那边的替身（我方炮台、我方操控的碎渣机炮）对我方的屏障不算 */
function barrierFoe(p, attacker) {
  if (!p || !attacker) return true;
  const owner = barrierOwner(p);
  if (!(state.units || []).includes(attacker) || attacker.envSrc) return !(attacker.isPlayer && owner.isPlayer);
  return typeof hostileTo !== "function" || hostileTo(attacker, owner);
}
/** zone 区里护着 target、这一下又是它要挡的敌方攻击的屏障（没有就是 null） */
function barrierFor(target, attacker, zone) {
  if (!target) return null;
  const z = Number(zone != null ? zone : target.zone);
  return (state.props || []).find(p => BARRIER_SIDE[p.kind] && Number(p.zone) === z && p.hp > 0 &&
    barrierGuards(p, target) && barrierFoe(p, attacker)) || null;
}
/** 范围攻击：被同区屏障保护的单位完全不受范围攻击（伤害、击破都由屏障吃，一次行动只吃一下）。
 *  返回保护它的屏障（按阵营，见 barrierGuards）；以后新加的盾牌类配置物写进 BARRIER_SIDE 就自动生效。
 *  by：放这次范围效果的单位（投掷罐的使用者……），给了就只算挡它的屏障（barrierFoe：自己人扔的不挡）；
 *  不给（高能自爆的余波这类没有出手方的）只看护不护着 */
function aoeShieldFor(u, by) {
  if (!u || u.kind) return null;
  return (state.props || []).find(p => BARRIER_SIDE[p.kind] && Number(p.zone) === Number(u.zone) && p.hp > 0 &&
    barrierGuards(p, u) && (!by || barrierFoe(p, by))) || null;
}

function breakIronWall(p, notes) {
  notes = notes || [];
  if (!p || p._brokeWall) return notes;
  p._brokeWall = true;
  p.hp = 0;
  state.props = (state.props || []).filter(x => x.id !== p.id);
  if (p.kind === "scrapwall") {
    notes.push("废铁墙被打塌，移出战场。");
    return notes;
  }
  if (p.kind !== "ironwall") {
    notes.push(`${p.name}被打破，移出战场。`);
    return notes;
  }
  const c = findKit("chuan", state.units);
  if (c) {
    dealBreak(c, 3, "physical", notes, "铁壁被击破");
  }
  notes.push("铁壁碎裂并移出战场。");
  return notes;
}

/** 一下攻击打在墙上：墙是一层装甲（防护罩是护盾），照常算克制 / 天气 / 场地 */
function hitBarrier(p, attacker, opt) {
  // 铁壁可以带一层外层护盾（川川电能 ≥ 3 时额外加的）：先打护盾，再打本体
  const shieldNow = Math.max(0, Number(p.shield) || 0);
  const dummy = unitOf(p.name, p.level || 1,
    (shieldNow > 0 ? [{ type: "shield", hp: shieldNow }] : []).concat([{ type: p.layerType || "armor", hp: p.hp }]), 999, 0, { noPosture: true });
  dummy.zone = p.zone;
  dummy.def = 999;
  dummy.defMax = 999;
  dummy.stunned = false;
  const atk = (opt && opt.atk != null) ? opt.atk : effectiveAtk(attacker, state.units);
  let diceValue = opt.diceValue;
  if (diceValue == null && opt.diceN && opt.diceS) {
    diceValue = takeDice(opt.diceN, opt.diceS, opt.diceB || 0).total;
  }
  const res = resolveAttack({
    attacker, target: dummy,
    atk, mult: opt.mult != null ? opt.mult : 1, flat: opt.flat || 0,
    diceValue: diceValue || 0,
    element: opt.element || "physical",
    baseBreak: 0,
    hits: opt.hits || 1,
    flags: Object.assign({}, opt.flags || {}, { action: true, block: "none" }),
    weather: currentWeatherFor(dummy),
    phaseStep: Number(state.phaseStep),
    zoneMode: state.zoneMode,
    attackerField: state.fields[attacker && attacker.zone] || {},
    targetField: state.fields[p.zone] || {},
    dist: 0,
    atkRange: "any"
  });
  const dmg = Math.floor(res.total || 0);
  let notes;
  if (shieldNow > 0 && res.layersAfter && res.layersAfter.length === 2) {
    p.shield = Math.max(0, Math.floor(Number(res.layersAfter[0].current) || 0));
    p.hp = Math.max(0, Math.floor(Number(res.layersAfter[1].current) || 0));
    notes = [`${p.name}替同区承受本次攻击：${dmg} 伤害 → 护盾 ${p.shield}，装甲 ${p.hp}/${p.maxHp}。`];
  } else {
    p.hp = Math.max(0, p.hp - dmg);
    notes = [`${p.name}替同区承受本次攻击：${dmg} 伤害 → 剩余 ${p.hp}/${p.maxHp}。`];
  }
  // 川川卡面：铁壁也受过载和雷鸣的反伤增益（只反敌人的攻击；配置物爆炸这类假攻击者不反）
  if (p.kind === "ironwall" && attacker && !attacker.isPlayer && !attacker.dead && (state.units || []).includes(attacker)) {
    const c = findKit("chuan", state.units);
    const wallOwner = c;   // 铁壁是川川的配置物
    // 过载：装甲受到近距离攻击时，反伤 50% 这次受到的伤害（闪电）。先打在外层护盾上的不算
    if (c && c.instant && c.instant.overload && shieldNow <= 0 && dmg > 0 && Number(attacker.zone) === Number(p.zone)) {
      const back = Math.floor(dmg * 0.5);
      if (back > 0) applyTypedDot(attacker, back, "electric", notes, `${p.name} 过载反伤 → ${attacker.name}`, { by: wallOwner && wallOwner.id });   // 反伤算铁壁所有者（川川）的伤害（#187）
    }
    // 雷鸣：挡下攻击和成功的协助格挡一样，反伤 等级 × 1d4 闪电
    if (!attacker.dead && currentWeatherFor(dummy) === "thunder") {
      const r = takeDice(Math.max(1, Number(p.level) || 1), 4, 0);
      applyTypedDot(attacker, r.total, "electric", notes, `雷鸣：${p.name} 挡下攻击反伤 ${r.text}`, { by: wallOwner && wallOwner.id });
    }
  }
  if (p.hp <= 0) notes.push(...breakIronWall(p, []));
  return { dmg, res, notes };
}

/** side：被保护的一方（player = 铁壁，enemy = 废铁墙） */
function absorbIronWall(attacker, zone, opt, side) {
  return absorbBarrier(barrierIn(zone, side || "player"), attacker, opt);
}
/** 屏障 p 替同区挨这一下（同一次行动只挨一下，其余同区伤害被挡住） */
function absorbBarrier(p, attacker, opt) {
  if (!p) return null;
  state.actionWallHit = state.actionWallHit || {};
  if (state.actionWallHit[p.id]) {
    return { blocked: true, already: true, notes: [`${p.name}已拦截本次行动，其余同区伤害被挡住。`] };
  }
  state.actionWallHit[p.id] = true;
  const h = hitBarrier(p, attacker, opt);
  return { blocked: true, already: false, notes: h.notes, dmg: h.dmg, res: h.res };
}

function noteActionHit(target, res) {
  if (!state.actionAcc || !res) return;
  state.actionAcc.calls += 1;
  state.actionAcc.dmg += Math.floor(Number(res.total) || 0);
  state.actionAcc.brk += (Number(res.breakDealt) || 0) + (Number(res.helperBreak) || 0);
  state.actionAcc.hits += (res.perHit && res.perHit.length) ? res.perHit.length : 1;
  if (target && target.name && state.actionAcc.targets.indexOf(target.name) < 0) {
    state.actionAcc.targets.push(target.name);
  }
}

function actionAccLine() {
  const acc = state.actionAcc;
  if (!acc) return "";
  const side = acc.side || 0;
  if (!side && acc.calls < 2 && acc.hits < 2 && acc.targets.length < 2) return "";
  const who = acc.targets.length ? "（" + acc.targets.join("、") + "）" : "";
  if (!side) return `本行动合计：伤害 ${acc.dmg}，击破 ${acc.brk}${who}`;
  const parts = Object.keys(acc.sideBy).map(k => `${k} ${acc.sideBy[k]}`).join("、");
  return `本行动合计：伤害 ${acc.dmg + side}（攻击 ${acc.dmg} ＋ 连带 ${side}：${parts}），击破 ${acc.brk}${who}`;
}

function pulseHighVoltage(target, amount, hitNo, hitMax) {
  const notes = [];
  if (!target || target._hvBusy) return notes;
  if (!(Number(amount) > 0)) return notes;   // 这一下真的受了伤害才触发（被免疫、伤害为 0 不触发）
  if (fieldExempt(target)) return notes;     // 保释：豁免场地
  const f = state.fields[target.zone] || {};
  if (!f.electric) return notes;
  const weather = currentWeatherFor(target);
  const d = statusDotDice("hvfield", target.level || 1, weather);
  const r = takeDice(d.n, d.s, 0);
  let dmg = r.total;
  const ex = envMult(target);
  dmg *= ex;   // 恶劣环境 / 末日：场地效果翻倍（两个叠加 ×4）
  if (typeof raceFieldDamage === "function") dmg = raceFieldDamage(target, dmg);   // 环境适应（鼠类人·鼠）：50% 概率免疫
  if (!(dmg > 0)) { notes.push(`${target.name} 高压场地：环境适应，免疫这次场地伤害。`); return notes; }
  target._hvBusy = true;
  const tag = (hitMax > 1) ? `第${hitNo}/${hitMax}击 ` : "";
  withEnvOwner(f.by, () => applyTypedDot(target, dmg, "electric", notes, `${target.name} 高压场地${tag}${r.text}${ex > 1 ? "×" + ex : ""}`));
  target._hvBusy = false;
  return notes;
}

function convertUnstableInHv(u, notes) {
  if (!u || !u.statuses || !u.statuses.unstable) return;
  if (u.trainingDummy) return;
  if (fieldExempt(u)) return;   // 保释：豁免场地
  const f = state.fields[u.zone] || {};
  if (!f.electric) return;
  u.statuses.unstable = false;
  if (!u.stunned) {
    u.stunned = true;
    if (notes) notes.push(`${u.name} 在高压场地：不稳直接转为晕眩。`);
    if (typeof endSelfOnStun === "function") endSelfOnStun(u, notes);
    if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(u, notes);
  }
}

function applyTypedDot(unit, amount, element, notes, label, opts) {
  // 场地伤害（withEnvOwner 里）算环境分数；它引发的连带伤害（共振、高压……）各算各的，不沿用
  const env = ENV_CTX;
  ENV_CTX = null;
  try { return applyTypedDotIn(env, unit, amount, element, notes, label, opts); } finally { ENV_CTX = env; }
}
function applyTypedDotIn(env, unit, amount, element, notes, label, opts) {
  opts = opts || {};
  if (ignoresAoe(unit)) {
    notes.push(`${unit.name} 是飞碟触灵本体，不受该范围/余波伤害。`);
    return;
  }
  // 屹立不倒：此回合不受任何来源的任何伤害（状态、场地、余波都挡）；再次霜结：下回合开始前完全免受伤害
  if (unit && unit.resources && (unit.resources.standTurn || unit.resources.frostShell)) {
    notes.push(`${label} → ${unit.name} ${unit.resources.standTurn ? "屹立不倒" : "再次霜结"}：不受伤害。`);
    return;
  }
  const fakeTarget = unit;
  const res = resolveAttack({
    attacker: null,
    target: fakeTarget,
    atk: 0, mult: 0, flat: amount, diceValue: 0,
    element, baseBreak: 0, hits: 1,
    flags: { action: false, block: "none", focusLayer: opts.focusLayer || null },
    weather: currentWeatherFor(unit),
    phaseStep: state.phaseStep,
    zoneMode: state.zoneMode,
    targetField: state.fields[unit.zone],
    attackerField: {},
    dist: 0,
    atkRange: "any"
  });
  const shieldBefore = shieldSum(unit);
  // 腐坏抛射施加的腐蚀：记下这次对每种血量层造成的伤害，下一次废物利用时给柯尔特
  const rotOwner = element === "acid" && unit.rotBy && unit.statuses && unit.statuses.corr && /腐蚀/.test(String(label || "")) ? unitById(unit.rotBy) : null;
  const byType = () => (unit.layers || []).reduce((m, l) => { m[l.type] = (m[l.type] || 0) + Math.max(0, Number(l.current) || 0); return m; }, {});
  const rotBefore = rotOwner ? byType() : null;
  const envWho = env && unit && !unit.isPlayer ? envCreditUnit(env.by) : null;
  // 击杀归属：场地有所有者算所有者；调用方显式给了出手方（状态持续伤害的所有者、高能状态的所有者）算他，
  // 给的是 null 就不改最后一击；都没给，是玩家行动中顺带造成的就算行动的人
  if (!unit.isPlayer) {
    if (env) creditPlayerHit(unit, (envOwnerUnit(env.by) || {}).id);
    else if ("by" in opts) creditPlayerHit(unit, opts.by);
    else creditPlayerHit(unit, actingPlayerId());
  }
  // 能量伤害（余波、共振分享、衍射回传、激活高能、环境伤害、检定失败受伤……）都和打中一样累积高能值（#348），
  // 要先累积再判自爆：applyCombat 里会判一次，这里像行动中那样先记下（_highDefer），
  // 下面累积完再判（flushHighBooms：这一下打死、已经清了场的敌人照样带着高能自爆）。opts.highGain 是日志里写的来源
  const highGain = element === "energy" ? (opts.highGain || "能量伤害") : "";
  if (highGain) state._highDefer = (Number(state._highDefer) || 0) + 1;
  try { notes.push(...applyCombat(unit, res, null)); }
  finally { if (highGain) state._highDefer = Math.max(0, (Number(state._highDefer) || 0) - 1); }
  if (rotOwner) {
    const after = byType();
    rotOwner.resources = rotOwner.resources || {};
    const store = rotOwner.resources.rotStore = rotOwner.resources.rotStore || {};
    Object.keys(rotBefore).forEach(type => {
      const lost = rotBefore[type] - (after[type] || 0);
      if (lost > 0) { store[type] = (store[type] || 0) + lost; notes.push(`腐坏抛射记录：${LAYER[type] || type} ${lost}（下一次废物利用领取）。`); }
    });
  }
  notes.push(label + ` → 实伤 ${Math.floor(res.total || 0)}`);
  rasUnstableHit(unit, res, notes);   // 不稳态：持续伤害、场地、余波这类伤害同样倒地 / 起身后致死
  if (typeof afterDamageTaken === "function") afterDamageTaken(unit, element, res.total || 0, Math.max(0, shieldBefore - shieldSum(unit)), notes, {});
  // 聚焦只看受到的伤害属性对不对，不看来源：状态、场地、余波的伤害也推进序列
  if (!unit.dead) advanceFocusOnHit(null, unit, element, res, notes);
  const sdKey = inferStatusDmgKey(label, element);
  if (PROC_DOT_FX[sdKey]) procFx(unit, PROC_DOT_FX[sdKey]);
  addStatusDmg(sdKey, res.total || 0);
  noteSideDamage(res.total || 0, STATUS_DMG_NAME[sdKey] || "其他", unit, !!env);
  if (env) { if (scoreEnvHit(unit, res, envWho, 0, STATUS_DMG_NAME[sdKey] || "场地")) scoreWeatherHelp(null, unit, res, true); }
  else if (unit && !unit.isPlayer && state.actionAcc && state.actionAcc.actorIsPlayer) scoreWeatherHelp(null, unit, res, true);
  if (unit && unit.isPlayer) scoreWeatherHelp(null, unit, res, false);
  if (unit && unit.isPlayer) { const st = battleStat(unit); if (st) st.taken += Math.floor(Number(res.total) || 0) + Math.floor(Number(res.shpDealt) || 0); }
  if ((res.intended || res.total || 0) > 0) spawnFloater(unit, res.intended || res.total, element);
  if ((res.extraHarmonic || 0) > 0) spawnFloater(unit, res.extraHarmonic, element);
  // 带高能状态的单位照打中时的口径累积高能值（gainHighFromHits：只认能量、真的扣到血才掷），累积完再判自爆；
  // 从施加高能的那一刻起就累积（#348：刚被施加高能的那一回合也算，不再单独排除）
  if (highGain) gainHighFromHits(unit, res, notes, highGain);
  checkHighBoom(unit);
  if (highGain && !state._highDefer) flushHighBooms();
  // 共振分享、高压场地都按「真的受到的伤害」：没受到伤害（免疫、濒死倒地、0 伤）就不触发
  if (!unit._resoBusy) notes.push(...pulseResonanceDamage(unit, res.total || 0, element));
  if (!unit._hvBusy && !/高压场地/.test(String(label || ""))) {
    notes.push(...pulseHighVoltage(unit, res.total || 0));
  }
}

/** 事故幸存 · 不稳态：受到任何来源的伤害（攻击、持续伤害、场地、余波……）就倒地（濒死）；
 *  已经起身（用坚毅生命继续战斗）时再受到伤害、或力竭 3，直接死亡。以前只认攻击行动，灼烧、高压场地这类伤害不触发 */
function rasUnstableHit(target, res, notes) {
  if (!target || target.kit !== "ras" || !target.resources || !target.resources.unstable || target.dead) return;
  if (typeof passivePlus === "function" && passivePlus(target, 2)) return;   // 事故幸存+：不倒地，改为伤害 / 治疗 ×3
  if (!(((res && res.total) || 0) + ((res && res.shpDealt) || 0) > 0)) return;
  (target.layers || []).forEach(l => { l.current = 0; });
  const wasUp = !!target.upOnShp;
  if (wasUp || (typeof exhaustTierOf === "function" && exhaustTierOf(target) >= 3)) {
    target.shp = 0;
    target.upOnShp = false;
    target.dying = false;
    target.dead = true;
    if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(target, notes);
    notes.push(wasUp ? "不稳态：拉斯缪尔起身后再次受到伤害，立即死亡。" : "不稳态：拉斯缪尔受到伤害，力竭 3 下直接死亡。");
  } else if (!target.dying) {
    target.dying = true;
    noteKnockdown(target);   // 战场数据：倒地次数
    if (typeof clearStunOnDown === "function") clearStunOnDown(target);
    if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(target, notes);
    notes.push("不稳态：拉斯缪尔受到伤害，倒地陷入濒死。");
  }
}

function shieldSum(u) {
  return ((u && u.layers) || []).filter(l => l.type === "shield").reduce((a, l) => a + Math.max(0, Number(l.current) || 0), 0);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function loadRoster() {
  try {
    const raw = localStorage.getItem(ROSTER_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) state.roster = list;
    }
  } catch (e) { state.roster = []; }
}

function persistRoster() {
  try { localStorage.setItem(ROSTER_KEY, JSON.stringify(state.roster)); } catch (e) {}
  renderRosterSel();
  const hint = uiEl("rosterHint");
  if (hint) hint.textContent = `卡组 ${state.roster.length} 张。保存在本浏览器；导出 JSON 可备份。`;
}

function renderRosterSel() {
  if (!HAS_DOM) return;
  const sel = uiEl("rosterSel");
  if (!sel) return;
  const keep = sel.value;
  if (!state.roster.length) {
    sel.innerHTML = `<option value="">（还没有保存的玩家）</option>`;
    return;
  }
  sel.innerHTML = state.roster.map(c =>
    `<option value="${c.cardId}">${escapeHtml(c.name)} · Lv${c.level} · ATK${c.atk} · DEF${c.defMax}</option>`
  ).join("");
  if (keep && state.roster.some(c => c.cardId === keep)) sel.value = keep;
}

function renderPcLayers() {
  if (!HAS_DOM) return;
  const box = uiEl("pcLayers");
  if (!box) return;
  box.innerHTML = state.pcLayers.map((l, i) => `
    <div class="layer-row">
      <select data-i="${i}" data-f="type">${Object.keys(LAYER).map(k => `<option value="${k}" ${l.type===k?"selected":""}>${LAYER[k]}</option>`).join("")}</select>
      <input data-i="${i}" data-f="current" type="number" value="${l.current}" title="当前">
      <input data-i="${i}" data-f="max" type="number" value="${l.max}" title="上限">
      <button class="btn small danger" data-del="${i}">×</button>
    </div>`).join("");
  box.querySelectorAll("select,input").forEach(el => {
    el.addEventListener("input", () => {
      const i = Number(el.dataset.i);
      const f = el.dataset.f;
      calcCommand("pcLayer", { op: "set", index: i, field: f, value: f === "type" ? el.value : Number(el.value) });
    });
  });
  box.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      calcCommand("pcLayer", { op: "remove", index: Number(btn.dataset.del) });
    });
  });
}

function readPlayerForm() {
  const name = (uiEl("pcName").value || "").trim() || "未命名玩家";
  const level = Number(uiEl("pcLv").value) || 1;
  const zone = Number(uiEl("pcZone").value) || 1;
  const atk = Number(uiEl("pcAtk").value) || 0;
  const def = Number(uiEl("pcDef").value) || 0;
  const range = uiEl("pcRange").value || "any";
  const element = uiEl("pcElem").value || "physical";
  const flying = uiEl("pcFly").checked;
  const layers = (state.pcLayers.length ? state.pcLayers : [{ type: "flesh", current: 20, max: 20 }]).map(l => ({
    type: l.type,
    hp: Number(l.max) || Number(l.current) || 1
  }));
  const currentLayers = (state.pcLayers.length ? state.pcLayers : [{ type: "flesh", current: 20, max: 20 }]).map(l => ({
    type: l.type,
    current: Number(l.current),
    max: Number(l.max) || Number(l.current)
  }));
  return { name, level, zone, atk, def, range, element, flying, layers, currentLayers };
}

function unitFromForm(form) {
  const f = form || readPlayerForm();
  const u = unitOf(f.name, f.level, f.layers, f.def, f.atk, {
    isPlayer: true, flying: f.flying, range: f.range, element: f.element
  });
  u.zone = f.zone;
  u.layers = f.currentLayers.map(l => ({ type: l.type, current: l.current, max: l.max }));
  u.suggest.element = f.element;
  return u;
}

function fillFormFromCard(card) {
  if (HAS_DOM) {
  uiEl("pcName").value = card.name || "";
  uiEl("pcLv").value = card.level || 1;
  uiEl("pcZone").value = String(card.zone || 1);
  uiEl("pcAtk").value = card.atk || 0;
  uiEl("pcDef").value = card.defMax || card.def || 0;
  uiEl("pcRange").value = card.range || "any";
  uiEl("pcElem").value = (card.suggest && card.suggest.element) || "physical";
  uiEl("pcFly").checked = !!card.flying;
  }
  state.pcLayers = (card.layers || []).map(l => ({
    type: l.type,
    current: Number(l.max != null ? l.max : l.current) || 0,
    max: Number(l.max != null ? l.max : l.current) || 0
  }));
  if (!state.pcLayers.length) state.pcLayers = [{ type: "flesh", current: 20, max: 20 }];
  renderPcLayers();
}

function cardFromUnit(u) {
  return {
    cardId: "c" + Math.random().toString(36).slice(2, 9),
    name: u.name,
    level: u.level,
    zone: u.zone || 1,
    atk: u.atk,
    def: u.defMax || u.def,
    defMax: u.defMax || u.def,
    flying: !!u.flying,
    isPlayer: true,
    range: u.range || "any",
    suggest: u.suggest || { element: "physical", dice: [1, 4], flat: 0, baseBreak: 1 },
    layers: (u.layers || []).map(l => ({ type: l.type, current: l.max, max: l.max })),
    self: u.self || "none"
  };
}

function spawnFromCard(card) {
  const layers = (card.layers || []).map(l => ({ type: l.type, hp: Number(l.max) || Number(l.current) || 1 }));
  const u = unitOf(card.name, card.level, layers, card.defMax || card.def, card.atk, {
    isPlayer: true,
    flying: card.flying,
    range: card.range || "any",
    element: (card.suggest && card.suggest.element) || "physical"
  });
  u.zone = card.zone || 1;
  u.self = card.self || "none";
  if (card.suggest) u.suggest = clone(card.suggest);
  return u;
}

function saveUnitToRoster(u, toast) {
  if (!u) {
    setRosterHint("没有可保存的单位。");
    return;
  }
  const card = cardFromUnit(u);
  const exist = state.roster.findIndex(c => c.name === card.name);
  if (exist >= 0) {
    card.cardId = state.roster[exist].cardId;
    state.roster[exist] = card;
    setRosterHint(`已覆盖卡组中的「${card.name}」。`);
  } else {
    state.roster.push(card);
    setRosterHint(`已把「${card.name}」存进卡组。`);
  }
  persistRoster();
}

function saveFormToRoster() {
  const u = unitFromForm();
  saveUnitToRoster(u, true);
}

function setRosterHint(text) {
  if (!HAS_DOM) return;
  const hint = uiEl("rosterHint");
  if (hint) hint.textContent = text;
}

function bindRosterUi() {
  renderPcLayers();
  renderRosterSel();
  uiEl("pcAddLayer").onclick = () => calcCommand("pcLayer", { op: "add" });
  const liveSel = uiEl("liveKitSel");
  if (liveSel) {
    liveSel.innerHTML = livePartyCards().filter(c => !c.weaponOf).map(c =>
      `<option value="${c.kit}">${escapeHtml(c.name)} · ${escapeHtml(c.note || c.kit)}</option>`).join("");
  }
  const addKitBtn = uiEl("btnAddLiveKit");
  if (addKitBtn) addKitBtn.onclick = () => {
    const zone = Number(uiEl("pcZone").value) || 1;
    const out = calcCommand("rosterAddKit", { kit: uiEl("liveKitSel").value, zone });
    if (!out) return;
    if (out.exists) { setRosterHint(`${out.exists} 已在场上。`); return; }
    setRosterHint(`已加入「${out.name}」到 ${zone} 区。用技能唤出武器人。`);
    uiEl("playerModal").classList.add("hidden");
  };
  uiEl("btnAddPlayer").onclick = () => {
    const form = readPlayerForm(), name = calcCommand("rosterAddForm", { form });
    setRosterHint(`「${name}」已加入 ${form.zone} 区。若要下次直接用，再点「保存到卡组」。`);
    uiEl("playerModal").classList.add("hidden");
  };
  uiEl("btnSavePlayer").onclick = () => calcCommand("rosterSaveForm", { form: readPlayerForm() });
  uiEl("btnSaveSelected").onclick = () => calcCommand("rosterSaveUnit", { actor: state.selectedId });
  uiEl("btnLoadRoster").onclick = () => {
    const name = calcCommand("rosterLoad", { id: uiEl("rosterSel").value });
    if (!name) { setRosterHint("先在卡组里选一张。"); return; }
    setRosterHint(`已从卡组加入「${name}」。`);
    uiEl("playerModal").classList.add("hidden");
  };
  uiEl("btnEditRoster").onclick = () => {
    const name = calcCommand("rosterEdit", { id: uiEl("rosterSel").value });
    if (name) setRosterHint(`已把「${name}」载入表单，改完后点保存会覆盖同名卡。`);
  };
  uiEl("btnDelRoster").onclick = () => calcCommand("rosterDelete", { id: uiEl("rosterSel").value });
  uiEl("btnExportRoster").onclick = () => {
    const blob = new Blob([JSON.stringify(state.roster, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "anterscale-players.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setRosterHint("已导出 anterscale-players.json。");
  };
  uiEl("btnImportRoster").onclick = () => uiEl("rosterFile").click();
  uiEl("rosterFile").onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const list = JSON.parse(reader.result);
        if (!Array.isArray(list)) throw new Error("not array");
        calcCommand("rosterImport", { cards: list });
      } catch (err) {
        setRosterHint("导入失败：JSON 格式不对。");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };
}

function getGap(a, b) {
  const key = gapKey(a, b);
  if (!state.gaps[key]) state.gaps[key] = emptyGap();
  return state.gaps[key];
}

function blockedByGap(from, dest) {
  const g = getGap(from, dest);
  if (g.type === "wall") return "危墙挡住，不能通过，也不能影响对面。";
  if (g.type === "door" && !g.open) return "机关门关闭，不能通过，也不能影响对面。";
  return null;
}

/** 自己走一步能不能过这条间隔：true 能过；false 过不去（危墙 / 关着的门）；
 *  "void" = 地面单位面对空隙，要花 1 行动点并通过简单难度运动检定才能越过（doMoveInner 结算） */
function canCross(unit, from, dest, asObject) {
  const g = getGap(from, dest);
  const flying = unit && unit.flying;
  if (g.type === "wall") {
    paintSkillLog("危墙挡住去路。先打掉墙。");
    return false;
  }
  if (g.type === "door" && !g.open) {
    paintSkillLog("机关门关着。先用按钮/拉杆打开。");
    return false;
  }
  if (g.type === "void" && !flying && !asObject) return "void";
  return true;
}

/* ===== 空隙：地面单位花 1 行动点、过简单难度「运动」检定才能越过（手册 7.3 间隔效果） ===== */
const VOID_CROSS = { prof: "运动", diff: 0 };   // diff：ROGUE_CHECKS.chance 的列，0 = 简单
/** 越过空隙的成功率：玩家按熟练等级（简单难度有熟练就默认通过）+ 种族的优势 / 劣势 / 重掷；敌人没有熟练，按无熟练 50% */
function voidCrossOdds(u) {
  const mine = !!(u && u.isPlayer);
  const level = mine ? unitProfLevel(u, VOID_CROSS.prof) : 0;
  const table = typeof ROGUE_CHECKS !== "undefined" ? ROGUE_CHECKS.chance : [[0.5, 0, 0, 0], [1, 0.5, 0.25, 0.125], [1, 1, 0.5, 0.25], [1, 1, 0.75, 0.5]];
  const base = (table[level] || [])[VOID_CROSS.diff] || 0;
  const hpLow = mine && totalHp(u) * 2 < totalMaxHp(u);
  const perks = mine && typeof checkPerksFor === "function" ? checkPerksFor(u.kit, VOID_CROSS.prof, hpLow)
    : (!mine && typeof raceCheckPerks === "function" ? raceCheckPerks(u) : {});   // 敌人：种族被动（人类·迎难直上）
  let p = perks.adv ? 1 - (1 - base) * (1 - base) : perks.dis ? base * base : base;
  if (perks.reroll) p = 1 - (1 - p) * (1 - p);
  return { mine, level, base, chance: p, perks };
}
/** 掷越过空隙的运动检定（行动点由调用方先扣）。返回 { ok, text } */
function rollVoidCross(u) {
  const odds = voidCrossOdds(u);
  const once = () => {
    const roll = () => Math.random() < odds.base;
    return odds.perks.adv ? (roll() || roll()) : odds.perks.dis ? (roll() && roll()) : roll();
  };
  let ok = odds.base >= 1 || once();   // 有熟练：简单难度默认通过，不掷骰
  let rerolled = false;
  if (!ok && odds.perks.reroll) { rerolled = true; ok = once(); }
  const who = odds.mine ? ["没有熟练", "一级熟练", "二级熟练", "三级熟练"][odds.level] : "敌人没有熟练";
  return { ok, text: `越过空隙：简单「${VOID_CROSS.prof}」检定（${who}，成功率 ${Math.round(odds.chance * 100)}%）${rerolled ? "，失败后重掷" : ""}` +
    (ok ? "，成功。" : "，失败：没能过去，行动点照扣。") };
}

/** 地面单位从塌掉的桥 / 空隙掉下去：失去 10% 最大生命，移动不生效。
 *  血量掉到 0 按倒地处理：玩家角色进濒死，其他单位死亡（和坠入深渊同一套写法） */
function gapFall(unit, notes) {
  const fall = Math.floor(totalMaxHp(unit) * 0.1);
  applyTrueDamage(unit.layers, fall);
  if (fall > 0) spawnFloater(unit, fall, "physical");
  notes.push(`${unit.name} 坠落，失去最大生命 10%（${fall}），移动失败。`);
  // 倒地统一结算（和坠入深渊同一套）：力竭 3 即死；起身中的人这 10% 改扣坚毅生命
  applyKnockdown(unit, notes, { shpLoss: fall, cause: "坠落" });
}

/** 过一条间隔时的不稳桥梁：地面单位每过一次 −1d6 耐久，塌了就坠落（fail = 移动不生效） */
function passGap(unit, from, dest) {
  const g = getGap(from, dest);
  const notes = [];
  if (g.type === "bridge" && !(unit && unit.flying)) {
    const loss = 1 + Math.floor(Math.random() * 6);
    g.hp = Math.max(0, (g.hp || 0) - loss);
    notes.push(`经过不稳桥梁，耐久 −${loss} → ${g.hp}`);
    if (g.hp <= 0) {
      g.type = "void";
      g.hp = 0;
      notes.push("桥梁坍塌，间隔变成空隙。");
      if (unit && !unit.flying) {
        gapFall(unit, notes);
        return { fail: true, notes };
      }
    }
  }
  return { fail: false, notes };
}

/** 不是自己走的移动沿哪条路走（crossGapsForced 用；被推过驻波墙也按这条路算）：有一条一样短、不隔危墙 / 关着的门的就走那条。
 *  不在这块棋盘上的区返回 null */
function forcedPath(from, dest) {
  from = Number(from); dest = Number(dest);
  const shut = (a, b) => { const g = getGap(a, b); return g.type === "wall" || (g.type === "door" && !g.open); };
  const any = zonePath(from, dest);
  if (!any) return null;
  const free = zonePath(from, dest, (a, b) => !shut(a, b));
  return free && free.length <= any.length ? free : any;
}
/** 不是自己走的移动（被推 / 拉、紧追跟上、冲刺类技能）沿最短路线过间隔，一条一条结算：
 *  危墙 / 关着的门：过不去（有一条一样短、不隔墙的路就走那条）。
 *  空隙：飞行单位照过；配置物掉下去消失；地面单位 fall 时坠落（被迫做地面移动），否则只是过不去。
 *  不稳桥梁：地面单位每过一次 −1d6 耐久，塌了就坠落（配置物不算「有单位通过」）。
 *  返回 true = 移动生效（notes 里是路上发生的事），false = 移动不生效 */
function crossGapsForced(obj, from, dest, notes, fall, flyOver) {
  from = Number(from); dest = Number(dest);
  if (from === dest) return true;
  const isProp = !obj || !Array.isArray(obj.layers) || (state.props || []).includes(obj);
  const shut = (a, b) => { const g = getGap(a, b); return g.type === "wall" || (g.type === "door" && !g.open); };
  const path = forcedPath(from, dest);
  if (!path) return true;   // 不在这块棋盘上的区（旧存档 / 计算器）：照旧直接挪
  const name = (obj && obj.name) || "配置物";
  for (let i = 0; i < path.length - 1; i++) {
    const g = getGap(path[i], path[i + 1]);
    if (shut(path[i], path[i + 1])) {
      notes.push(`${name} 被${g.type === "wall" ? "危墙" : "关着的机关门"}挡住（${gapKey(path[i], path[i + 1])} 区之间），没有移动。`);
      return false;
    }
  }
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const g = getGap(a, b);
    if (g.type === "void" && !(obj && obj.flying) && !flyOver) {
      if (isProp) {
        state.props = (state.props || []).filter(x => x !== obj);
        notes.push(`${name} 掉进空隙（${gapKey(a, b)} 区之间），消失了。`);
      } else if (fall) {
        notes.push(`${name} 被迫越过空隙（${gapKey(a, b)} 区之间）：`);
        gapFall(obj, notes);
      } else {
        notes.push(`${name} 被空隙挡住（${gapKey(a, b)} 区之间），过不去。`);
      }
      return false;
    }
    if (!isProp) {
      const passed = passGap(obj, a, b);
      notes.push(...passed.notes);
      if (passed.fail) return false;
    }
  }
  return true;
}

/* ---------- 驻波墙（Helumica「频域造物」，作者 10/23 定）----------
 * 间隔的一种临时状态：g.type = "wave"，g.wave = { el, mode, by, until, saved }
 *   el 过滤的属性；mode "dampen" 降幅 / "amplify" 增幅；by 放墙的人；until 到哪一回合结束时消失（WAVE_WALL.rounds）
 *   saved 被暂时取代的那个间隔（危墙 / 机关门 / 不稳桥梁 / 空隙 / 畅通，连耐久、门的开关一起），消失时原样还回去
 * 驻波墙不挡移动：type 不是 wall / door / void / bridge，走路、推拉、射击、技能里的移动都当畅通（空隙不用检定、桥不扣耐久）。
 * 攻击穿墙：dealTo 按危墙挡远程攻击的判定找连线（waveWallsOnLine），伤害修正在 engine.js · resolveAttack（WAVE_WALL）；
 * 单位穿墙：wavePassUnit（挂状态、推进聚焦）。主持人中途改掉这条间隔：以主持人改的为准，墙不再恢复 */
function isWaveGap(g) { return !!(g && g.type === "wave" && g.wave); }
/** 被驻波墙暂时取代的那个间隔本来是什么（机关门的按钮、战斗模板都看它）；没有驻波墙就是它自己 */
function waveGapBase(g) { return isWaveGap(g) && g.wave.saved ? g.wave.saved : g; }
function anyWaveWall() { return Object.keys(state.gaps || {}).some(k => isWaveGap(state.gaps[k])); }
const WAVE_STATUS_CN = { unstable: "不稳", weak: "虚弱", sturdy: "坚挺", inspire: "振奋" };
/** 「驻波墙·火·降幅」 */
function waveWallName(w) {
  return `驻波墙·${ELE[w && w.el] || (w && w.el) || "?"}·${w && w.mode === "amplify" ? "增幅" : "降幅"}`;
}
/** 一道驻波墙的说明（悬停、技能里写的都是它）：数值读 WAVE_WALL */
function waveWallText(w) {
  if (!w) return "";
  const el = ELE[w.el] || w.el;
  const sts = (w.mode === "amplify" ? WAVE_WALL.amplifyStatus : WAVE_WALL.dampenStatus).map(k => WAVE_STATUS_CN[k] || k).join("和");
  const hit = w.mode === "amplify"
    ? `穿过这道墙的${el}属性伤害 +${Math.round(WAVE_WALL.amplifyPct * 100)}%（和其他百分比加算），击破照常`
    : `穿过这道墙的${el}属性伤害 −${Math.round(WAVE_WALL.dampenPct * 100)}%（和其他百分比加算），并且不造成任何击破`;
  const base = w.saved && w.saved.type && w.saved.type !== "open" ? `，原来的${gapLabel(w.saved.type)}恢复` : "";
  return `${hit}；其他属性照常。不挡移动，任何单位穿过时${w.mode === "amplify" ? "获得" : "受到"}${sts}，带聚焦的单位推进一步序列。这一整轮结束时消失${base}。`;
}
/** 间隔现在的样子（选间隙那一步、消失时的记录用）：「危墙（耐久 12）」「机关门（关着）」「畅通」 */
function gapStateText(g) {
  if (!g) return gapLabel("open");
  if (isWaveGap(g)) return waveWallName(g.wave);
  if (g.type === "wall" || g.type === "bridge") return `${gapLabel(g.type)}（耐久 ${Number(g.hp) || 0}）`;
  if (g.type === "door") return `${gapLabel(g.type)}（${g.open ? "开着" : "关着"}）`;
  return gapLabel(g.type || "open");
}
/** 在 key 这条间隔放一道驻波墙：原来的配置物整个记下来（已经是驻波墙的，换成新的属性 / 增降幅，记着的还是最早那个）。
 *  返回 null；放不了返回原因 */
function placeWaveWall(key, el, mode, by, notes) {
  key = String(key || "");
  if (!boardGapKeys().includes(key)) return "这块战场上没有这条间隙。";
  if (!WAVE_WALL.elements.includes(el)) return "驻波墙要选一种属性。";
  if (mode !== "dampen" && mode !== "amplify") return "驻波墙要选降幅或增幅。";
  const g = state.gaps[key] = state.gaps[key] || emptyGap();
  let saved;
  if (isWaveGap(g)) saved = g.wave.saved;
  else {
    const base = {};
    Object.keys(g).forEach(k => { if (k !== "wave") base[k] = g[k]; });
    saved = JSON.parse(JSON.stringify(base));
  }
  const before = gapStateText(g);
  Object.keys(g).forEach(k => delete g[k]);
  Object.assign(g, { type: "wave", hp: 0, maxHp: 0, open: true, lastFrom: null,
    wave: { el, mode, by: by != null ? by : null, until: (Number(state.turnNo) || 1) + Math.max(1, Number(WAVE_WALL.rounds) || 1) - 1, saved } });
  if (notes) {
    notes.push(`频域造物：${key} 区之间${before === gapLabel("open") ? "" : `的${before}被暂时取代，`}出现${waveWallName(g.wave)}。`);
    notes.push(waveWallText(g.wave));
  }
  return null;
}
/** 回合结束：到期的驻波墙消失，原来的配置物原样恢复（危墙的耐久、门的开关、桥、空隙都还原）。
 *  单位总是站在区里，间隔上不会站人：恢复成危墙 / 关着的门 / 空隙时，谁在哪一区就还在哪一区（墙在期间走过去的人留在对面） */
function expireWaveWalls(notes) {
  Object.keys(state.gaps || {}).forEach(k => {
    const g = state.gaps[k];
    if (!g || !g.wave) return;
    if (g.type !== "wave") { delete g.wave; return; }   // 主持人中途改过这条间隔：以主持人改的为准
    if (Number(g.wave.until) > (Number(state.turnNo) || 1)) return;
    const name = waveWallName(g.wave);
    const saved = JSON.parse(JSON.stringify(g.wave.saved || emptyGap()));
    Object.keys(g).forEach(x => delete g[x]);
    Object.assign(g, saved);
    notes.push(`${k} 区之间的${name}消失${g.type && g.type !== "open" ? `，${gapStateText(g)}恢复原样` : ""}。`);
  });
}
/** 攻击者所在区 → 目标所在区的连线经过的驻波墙，返回 [{ key, el, mode }]（同区是空的）。
 *  照危墙挡远程攻击的判定（lineBlocked）：在不隔危墙 / 关着的门的最短路线里找；这样的路线不止一条时（方形棋盘的对角）
 *  走经过驻波墙最少的那条——有一条一样短、没有驻波墙的就不算穿墙。一次攻击穿过两道墙，两道都算 */
function waveWallsOnLine(aZone, bZone) {
  aZone = Number(aZone); bZone = Number(bZone);
  if (aZone === bZone || !anyWaveWall()) return [];
  const d0 = zoneDist(aZone, bZone);
  if (!(d0 > 0 && d0 < 99)) return [];
  const shut = (x, y) => { const g = getGap(x, y); return g.type === "wall" || (g.type === "door" && !g.open); };
  const paths = [];
  const walk = (z, path) => {
    if (paths.length >= 64) return;
    if (z === bZone) { paths.push(path); return; }
    const d = zoneDist(z, bZone);
    zoneNeighbors(z).forEach(n => { if (zoneDist(n, bZone) === d - 1) walk(n, path.concat(n)); });
  };
  walk(aZone, [aZone]);
  const open = paths.filter(p => p.every((z, i) => i === 0 || !shut(p[i - 1], z)));
  let best = null;
  (open.length ? open : paths).forEach(p => {
    const walls = [];
    for (let i = 1; i < p.length; i++) {
      const g = getGap(p[i - 1], p[i]);
      if (isWaveGap(g)) walls.push({ key: gapKey(p[i - 1], p[i]), el: g.wave.el, mode: g.wave.mode });
    }
    if (!best || walls.length < best.length) best = walls;
  });
  return best || [];
}
function waveGiveStatus(by, u, key, notes) {
  // 和效果道具挂状态同一套（items.js · itemApplyStatus）：不稳叠两个转晕眩、高压场地上不稳直接晕眩、共振共享……照常
  if (typeof itemApplyStatus === "function") { itemApplyStatus(by, u, key, notes); return; }
  u.statuses = u.statuses || {};
  if (key === "unstable") { if (applyUnstable(u, notes)) notes.push(`${u.name} 陷入不稳。`); return; }
  u.statuses[key] = true;
  notes.push(`${u.name} 获得${WAVE_STATUS_CN[key] || key}。`);
}
/** 单位穿过 key 这条间隔上的驻波墙：降幅墙受到不稳和虚弱，增幅墙获得坚挺和振奋（敌我都算；自己走、被推 / 拉 / 击退、技能里的移动都算）；
 *  带聚焦的单位推进一步序列（stepFocus：和协助攻击的直接推进一样，一次行动对同一个聚焦只推进一步）。配置物不算 */
function wavePassUnit(u, key, notes) {
  const g = (state.gaps || {})[key];
  if (!isWaveGap(g) || !u || !(state.units || []).includes(u) || u.dead || u.hidden) return;
  const w = g.wave;
  notes.push(`${u.name} 穿过 ${key} 区之间的${waveWallName(w)}。`);
  const by = w.by != null ? unitById(w.by) : null;
  (w.mode === "amplify" ? WAVE_WALL.amplifyStatus : WAVE_WALL.dampenStatus).forEach(k => waveGiveStatus(by, u, k, notes));
  if ((u.focuses || []).length) u.focuses.slice().forEach(f => stepFocus(u, f, notes, "穿过驻波墙"));
}
/** 沿 path（区号数组）走过去：路上每条有驻波墙的间隔各结算一次 */
function wavePassPath(u, path, notes) {
  if (!Array.isArray(path)) return;
  for (let i = 1; i < path.length; i++) wavePassUnit(u, gapKey(path[i - 1], path[i]), notes);
}
/** 技能里直接换区的那一段按哪条路算：有不隔危墙 / 关着的门的最短路线就走那条 */
function waveRoute(from, dest) {
  const shut = (x, y) => { const g = getGap(x, y); return g.type === "wall" || (g.type === "door" && !g.open); };
  return zonePath(from, dest, (x, y) => !shut(x, y)) || zonePath(from, dest);
}
/* 技能里直接改所在区的移动（突进、逃离、燕飞、猛扑……）不走 doMoveInner / displaceTo：一次行动（runSkill / doMove）开始时记下
 * 每个在场单位在哪一区（state._waveLedger），出手之前（dealTo）和行动结束时补算——从记下的区沿最短的路走到现在的区，路上的驻波墙照样生效。
 * 走路、被推 / 拉、紧追当场结算（waveMoved），顺手把记下的区更新成新位置，不会重复算。场上没有驻波墙时什么都不记 */
function waveLedgerOpen() {
  if (state._waveLedger || !anyWaveWall()) return false;
  const led = {};
  (state.units || []).forEach(u => { if (u && u.id != null && u.zone != null && !u.dead && !u.hidden && !u.fused && !u._removed) led[u.id] = Number(u.zone); });
  state._waveLedger = led;
  return true;
}
function waveLedgerSync(notes) {
  const led = state._waveLedger;
  if (!led) return;
  const out = notes || [];
  (state.units || []).forEach(u => {
    if (!u || u.id == null) return;
    // 不在场上的不记（收回的武器人、倒下的）：再上场时从那一区重新记，不算穿墙
    if (u.zone == null || u.dead || u.hidden || u.fused || u._removed) { delete led[u.id]; return; }
    const now = Number(u.zone), was = led[u.id];
    led[u.id] = now;
    if (was == null || was === now) return;   // 这次行动里才上场的（唤出、援军）不算穿墙
    wavePassPath(u, waveRoute(was, now), out);
  });
  if (!notes && out.length) appendLog(out.join("\n"));
}
function waveLedgerClose(own) {
  if (!own) return;
  try { waveLedgerSync(); } finally { state._waveLedger = null; }
}
/** 走路 / 被推 / 紧追这类当场结算的移动：path = 这次走的路（区号数组，含起点终点）。
 *  这个单位之前在技能里直接换过区、还没补算的那一段先补上，再沿这次的路过墙 */
function waveMoved(u, path, notes) {
  if (!u || !Array.isArray(path) || path.length < 2) return;
  const led = state._waveLedger;
  if (led && u.id != null && led[u.id] != null && led[u.id] !== Number(path[0])) wavePassPath(u, waveRoute(led[u.id], path[0]), notes);
  wavePassPath(u, path, notes);
  if (led && u.id != null) led[u.id] = Number(path[path.length - 1]);
}

function toggleDevice(p, reason) {
  if (!p || (p.kind !== "button" && p.kind !== "lever")) return;
  if (gMissingDoor(p)) {
    const key = Object.keys(state.gaps).find(k => waveGapBase(state.gaps[k]).type === "door") || "1-2";
    p.link = key;
  }
  // 门被驻波墙暂时取代时：拨的是记着的那扇门（墙消失后照这个开关恢复）
  const gap = waveGapBase(state.gaps[p.link] || getGap(1, 2));
  // 按钮：改变状态直到整个回合结束（回合结束时恢复原样），按住期间再按没有效果；拉杆：切换一次
  if (p.kind === "button") {
    if (p.held) {
      appendLog(`${p.name} ${reason || "被操作"}：已经按下了，这一回合结束前保持（间隔 ${p.link} 的门${gap.open ? "打开" : "关闭"}）。`);
      return;
    }
    p.held = true;
  }
  gap.open = !gap.open;
  appendLog(`${p.name} ${reason || "被操作"}：间隔 ${p.link} 的门现在${gap.open ? "打开" : "关闭"}` +
    `${p.kind === "button" ? "（到这一回合结束为止）" : ""}。`);
}

/* ===== 防卫自律炮台：困难数据操作改写阵营 ===== */
const TURRET_HACK = { prof: "数据操作", diff: 2 };   // diff：ROGUE_CHECKS.chance 的列，2 = 困难
/** 这个人的某项熟练等级：单局里按本局成长（applyPartyToField 写进 u.profs），否则按角色卡 */
function unitProfLevel(u, prof) {
  if (!u) return 0;
  const own = u.profs || (typeof heroProfile === "function" && heroProfile(u.kit) ? heroProfile(u.kit).profs : null) || {};
  return Math.max(0, Math.min(typeof PROF_MAX !== "undefined" ? PROF_MAX : 3, Number(own[prof]) || 0));
}
/** 改写炮台的成功率：困难检定 + 种族的优势 / 劣势 / 重掷 */
function turretHackOdds(u) {
  const level = unitProfLevel(u, TURRET_HACK.prof);
  const table = typeof ROGUE_CHECKS !== "undefined" ? ROGUE_CHECKS.chance : [[0.5, 0, 0, 0], [1, 0.5, 0.25, 0.125], [1, 1, 0.5, 0.25], [1, 1, 0.75, 0.5]];
  const base = (table[level] || [])[TURRET_HACK.diff] || 0;
  const hpLow = totalHp(u) * 2 < totalMaxHp(u);
  const perks = typeof checkPerksFor === "function" ? checkPerksFor(u.kit, TURRET_HACK.prof, hpLow) : {};
  let p = perks.adv ? 1 - (1 - base) * (1 - base) : perks.dis ? base * base : base;
  if (perks.reroll) p = 1 - (1 - p) * (1 - p);
  return { level, base, chance: base ? p : 0, perks };
}
/** 可以改写的炮台：同区、阵营不是自己这边 */
function hackableTurrets(u) {
  if (!u || !u.isPlayer) return [];
  return (state.props || []).filter(p => p.kind === "turret" && p.hp > 0 && p.faction === "enemy" && Number(p.zone) === Number(u.zone));
}
function turretHackError(u, p) {
  if (!p || p.kind !== "turret") return "没有这个炮台。";
  if (!u) return "先选人。";
  if (Number(p.zone) !== Number(u.zone)) return "要和炮台同区才能改写。";
  if (p.faction === (u.isPlayer ? "player" : "enemy")) return "炮台已经是自己这边的了。";
  if (!turretHackOdds(u).chance) return `${u.name} 没有「${TURRET_HACK.prof}」熟练，做不了困难检定。`;
  return null;
}
/** 掷困难数据操作检定，成功就把炮台改成自己这边 */
function hackTurret(u, p) {
  const odds = turretHackOdds(u);
  const roll = () => Math.random() < odds.base;
  let ok;
  if (odds.perks.adv) ok = roll() || roll();
  else if (odds.perks.dis) ok = roll() && roll();
  else ok = roll();
  let rerolled = false;
  if (!ok && odds.perks.reroll) { rerolled = true; ok = odds.perks.adv ? (roll() || roll()) : odds.perks.dis ? (roll() && roll()) : roll(); }
  const lines = [`${u.name} 尝试改写 ${p.name}：困难「${TURRET_HACK.prof}」检定（${["没有熟练", "一级熟练", "二级熟练", "三级熟练"][odds.level]}，成功率 ${Math.round(odds.chance * 100)}%）${rerolled ? "，失败后重掷" : ""}。`];
  if (ok) {
    p.faction = u.isPlayer ? "player" : "enemy";
    p.name = propKindName(p.kind);
    lines.push(`成功：${p.name} 改写为${p.faction === "player" ? "我方" : "敌方"}阵营，回合结束时攻击对面。`);
  } else {
    lines.push("失败：炮台的阵营没有变。");
  }
  return lines;
}

/** 回合结束：按下的按钮弹起，门恢复 */
function releaseButtons(notes) {
  (state.props || []).filter(p => p.kind === "button" && p.held).forEach(p => {
    p.held = false;
    const gap = waveGapBase(state.gaps[p.link]);   // 门被驻波墙暂时取代：拨记着的那扇门
    if (!gap || gap.type !== "door") return;
    gap.open = !gap.open;
    notes.push(`${p.name} 弹起：间隔 ${p.link} 的门恢复${gap.open ? "打开" : "关闭"}。`);
  });
}

function gMissingDoor(p) {
  const g = waveGapBase(state.gaps[p.link]);
  return !g || g.type !== "door";
}

function useDevice(p) {
  snapshot();
  toggleDevice(p);
  renderAll();
}

function pulseDevicesInZone(zone, reason) {
  const list = (state.props || []).filter(p => Number(p.zone) === Number(zone) && (p.kind === "button" || p.kind === "lever"));
  if (!list.length) return;
  list.forEach(p => toggleDevice(p, reason || "受到范围效果"));
}

/** 记下这次行动的范围攻击波及了哪个区。hit = { element, dmg, attacker, from }：带伤害的范围攻击，
 *  结算（flushAoePulse）时同区可以打的配置物（爆炸桶、酸液桶、电池、炮台……）各挨一下。
 *  from = 范围攻击从哪个区打过来（不给就按攻击者所在的区），用来判危墙 / 关着的门 */
function markAoeZone(zone, hit) {
  if (zone == null) return;
  state.aoePulse = state.aoePulse || {};
  const z = Number(zone);
  if (!state.aoePulse[z] || state.aoePulse[z] === true) state.aoePulse[z] = { hits: [] };
  if (hit === "handled") state.aoePulse[z].propsDone = true;   // 技能自己已经打过区里的配置物，别再打一次
  if (hit === "triggered") { state.aoePulse[z].propsDone = true; state.aoePulse[z].devicesDone = true; return; }   // 区里每个配置物都已经被触发过一次（Ecmo 音爆）
  else if (hit && hit.element) {
    const from = hit.from != null ? hit.from : (hit.attacker && hit.attacker.zone != null ? hit.attacker.zone : null);
    state.aoePulse[z].hits.push(Object.assign({}, hit, { from: from != null ? Number(from) : null }));
  }
  if (!hit || hit === "handled") state.aoePulse[z].bare = true;   // 只记了区（没带来源）：照旧触发区里的按钮 / 拉杆
}

/** 范围攻击波及到的配置物：按钮 / 拉杆不在这里（它们按「被操作一次」处理） */
function aoeHittableProps(zone) {
  // 铁壁、废铁墙这类屏障也会被范围攻击打到；这次行动已经替人挡过一下的不再挨第二下
  return (state.props || []).filter(p => Number(p.zone) === Number(zone) && p.hp > 0 &&
    p.kind !== "button" && p.kind !== "lever" && !(BARRIER_SIDE[p.kind] && (state.actionWallHit || {})[p.id]));
}

function flushAoePulse() {
  // 配置物被炸毁会引发新的范围伤害（爆炸桶连锁），所以一轮一轮结算到没有新的为止
  for (let round = 0; round < 20; round++) {
    const map = state.aoePulse || {};
    const zones = Object.keys(map);
    if (!zones.length) break;
    state.aoePulse = {};
    zones.forEach(z => {
      // 危墙 / 关着的门：倒塌 / 打开之前，范围攻击影响不到墙对面的按钮、拉杆和配置物
      const all = (map[z] && map[z].hits) || [];
      const hits = all.filter(h => h.from == null || !lineBlocked(h.from, z));
      if (all.length && !hits.length && !(map[z] && map[z].bare)) return;
      if (!map[z].devicesDone) pulseDevicesInZone(Number(z), "受到范围伤害，视作被操作一次");
      if (!hits.length || map[z].propsDone) return;
      // 一次范围攻击里同区每个配置物只挨一下：取伤害最高的那一段
      const top = (list) => list.reduce((a, b) => ((Number(b.dmg) || 0) > (Number(a.dmg) || 0) ? b : a));
      const strongest = top(hits);
      aoeHittableProps(z).forEach(p => {
        if (!(state.props || []).includes(p) || !(p.hp > 0)) return;   // 同一轮里已经被连锁炸掉
        // 屏障只挨敌方的范围攻击（按阵营，见 barrierFoe）：我方 / 友军自己的、多阵营里和它护着的一伙不敌对的单位放的不算；
        // 配置物爆炸这类环境伤害（env）照旧算
        let hit = strongest;
        if (BARRIER_SIDE[p.kind]) {
          const foes = hits.filter(h => h.env || barrierFoe(p, h.attacker));
          if (!foes.length) return;
          hit = top(foes);
        }
        const before = Number(p.hp) || 0;
        if (BARRIER_SIDE[p.kind]) { state.actionWallHit = state.actionWallHit || {}; state.actionWallHit[p.id] = true; }
        const notes = damageProp(p, { element: hit.element, dmg: Math.max(1, Math.floor(Number(hit.dmg) || 1)) }, hit.attacker);
        if (typeof popStructure === "function") popStructure("prop:" + p.id, p.level, before - Math.max(0, Number(p.hp) || 0), hit.element, "无效");
        if (notes.length) appendLog(`范围攻击波及 ${p.name}：` + notes.join("\n"));
      });
    });
  }
  state.aoePulse = {};
  // 一次行动（或一次范围攻击）结算完：屏障「已拦截本次行动」的记录清掉，不留到下一次行动、回合结束的炮台那一炮
  state.actionWallHit = {};
  // 这次行动里召唤 / 生成的机械类单位，补上同阵营超充能电池的护盾
  if (typeof grantMissingBatteryShields === "function") {
    const got = grantMissingBatteryShields();
    if (got.length) appendLog(got.join("\n"));
  }
}

function fireScrap(p) {
  const t = skillTarget() || unitById(state.targetId);
  if (!t || t.isProp) { appendLog("先选一个敌人目标再让碎渣机炮开火。"); return; }
  if (zoneDist(p.zone, t.zone, state.zoneMode) > 2) {
    appendLog("碎渣机炮只能打 2 距离内。");
    return;
  }
  const block = lineBlocked(p.zone, t.zone);
  if (block) { appendLog(`碎渣机炮打不到 ${t.name}：${block}`); return; }
  snapshot();
  appendLog(scrapShot(p, t));
  renderAll();
}
/** 碎渣机炮可以被谁操控：玩家单位，或狂徒 */
function canControlScrap(u) {
  return !!u && !u.dead && !u.hidden && !u.fused && (u.isPlayer || /^thug_/.test(u.kit || ""));
}
/** u 所在区里能操控的碎渣机炮 */
function scrapsFor(u) {
  if (!canControlScrap(u)) return [];
  return (state.props || []).filter(p => p.kind === "scrap" && (Number(p.hp) || 0) > 0 && Number(p.zone) === Number(u.zone));
}
/** 操控者的敌人里，在机炮 2 距离内、打得到的：不隔着危墙 / 关着的门，不在躲藏，不是倒地没起身的人
 *  （这些打出去也是白打，狂徒 AI 也就不会去白用机炮） */
function scrapTargets(p, u) {
  if (!p || !u) return [];
  return (state.units || []).filter(t => t && !t.dead && !t.hidden && !t.fused && !t._removed &&
    !!t.isPlayer !== !!u.isPlayer && t.kit !== "ironwall" &&
    zoneDist(Number(p.zone), Number(t.zone), state.zoneMode) <= 2 &&
    !lineBlocked(p.zone, t.zone) && !(t.statuses && t.statuses.hide) && !t.submerged && !(t.dying && !t.upOnShp));
}
/** 操控碎渣机炮（消耗 1 行动点）：玩家和狂徒都能用 */
function controlScrap(a, p, t) {
  if (!p || p.kind !== "scrap" || !((Number(p.hp) || 0) > 0)) return "碎渣机炮已经不在了。";
  if (!canControlScrap(a)) return `${a ? a.name : "该单位"} 不能操控碎渣机炮。`;
  if (Number(p.zone) !== Number(a.zone)) return "必须和碎渣机炮在同一区才能操控。";
  if (!t || t.isProp || !(state.units || []).includes(t)) return "先选碎渣机炮要打的敌人。";
  if (!scrapTargets(p, a).includes(t)) {
    const block = lineBlocked(p.zone, t.zone);
    return block ? `碎渣机炮打不到 ${t.name}：${block}` : `${t.name} 不在碎渣机炮 2 距离内、打不到（躲藏 / 倒地），或不是敌人。`;
  }
  if (!scrapReady(p)) return "碎渣机炮这一回合已经发射过了。";
  if (!spendAp(a, 1, "操控碎渣机炮")) return `${a.name} 行动点不足，无法操控碎渣机炮。`;
  return `${a.name} 操控碎渣机炮攻击 ${t.name}。\n` + scrapShot(p, t, a);
}
/** 碎渣机炮每回合只能发射一次（不管被谁、用什么方式触发） */
function scrapReady(p) {
  return !!p && p.firedRound !== Number(state.turnNo || 0);
}
/** 碎渣机炮开火一次：1d4 次 6+等级 物理，每次 +2 击破，开完耐久 −1。打玩家时可以被协助格挡 */
function scrapShot(p, t, controller) {
  if (!scrapReady(p)) return "碎渣机炮这一回合已经发射过了。";
  p.firedRound = Number(state.turnNo || 0);
  const n = 1 + Math.floor(Math.random() * 4);
  const flat = 6 + (p.level || 1);
  const fake = unitOf("碎渣机炮", p.level, [{ type: "armor", hp: 1 }], 0, 0);
  fake.zone = p.zone;
  // 狂徒操控时站在敌人那边（打玩家），玩家操控时站在玩家那边
  if (controller) fake.isPlayer = !!controller.isPlayer;
  if (controller && controller.isPlayer) fake.creditTo = controller.id;
  // 射程是「2 距离内」（选目标时已经限定），这里不再按近距离判定
  fake.propId = p.id;
  fake.envSrc = true;
  const out = dealTo(fake, t, { atk: 0, mult: 0, flat, hits: n, element: "physical", baseBreak: 2, atkRange: "any", flags: { action: true, propShot: true, flyFree: true } });
  const wear = scrapWear(p, controller);
  if (out && out.pending) return `碎渣机炮开火：1d4 次 → ${n} 次，每次 ${flat} 物理 +2 击破，${t.name} 的队友可以协助格挡。\n${wear}`;
  return `碎渣机炮开火：1d4 次 → ${n} 次，每次 ${flat} 物理 +2 击破。合计伤害 ${Math.floor((out && out.res && out.res.total) || 0)}。\n${wear}`;
}
/** 碎渣机炮每用一次耐久 −1（和被攻击一样），耐久归零就报废 */
function scrapWear(p, controller) {
  p.hp = Math.max(0, (Number(p.hp) || 0) - 1);
  const notes = [`碎渣机炮使用磨损：耐久 −1 → ${p.hp}`];
  if (p.hp <= 0) notes.push(...destroyProp(p, controller));
  return notes.join("\n");
}

/** 技能打配置物 / 危墙时的伤害：按技能说明里写的元素、倍率、击破（「1atk 电 1击破」），
 *  没写就按 1atk 物理 1 击破。爆炸桶怕火、酸液桶怕谐波，所以元素要对。 */
const STRUCT_ELEMENT_WORDS = [["谐波", "harmonic"], ["火", "fire"], ["电", "electric"], ["能量", "energy"], ["冰", "ice"], ["酸", "acid"], ["物理", "physical"]];
function structureHitOpt(a, skillId) {
  let hint = "";
  try { const sk = (skillList(a) || []).find(x => x.id === skillId); if (sk) hint = String(sk.hint || ""); } catch (e) {}
  let element = null, at = Infinity;
  STRUCT_ELEMENT_WORDS.forEach(([w, el]) => { const i = hint.indexOf(w); if (i >= 0 && i < at) { at = i; element = el; } });
  const m = hint.match(/(\d+(?:\.\d+)?)\s*atk/);
  const hits = /两次|2\s*次/.test(hint) ? 2 : /三次|3\s*次/.test(hint) ? 3 : 1;   // 「两次 0.5atk」= 合计 1atk
  const mult = (m ? Number(m[1]) : 1) * hits;
  const b = hint.match(/(\d+)\s*击破/);
  const atk = effectiveAtk(a, state.units) || 5;
  return {
    element: element || hostValue("element", "physical"),
    dmg: Math.max(1, Math.floor(atk * (mult > 0 ? mult : 1))),
    brk: b ? Number(b[1]) : (Number(hostValue("baseBreak", 1)) || 1)
  };
}

/** 燕返的后续：丹生谷收回，绯秋换持丹生谷，鳴門出场（打单位和打配置物共用） */
function tsubameFollowUp(a, lines) {
  const owner = ownerOfWeapon(a, state.units);
  lines.push(...returnWeapon(a));
  if (owner) {
    owner.resources.blade = "niu";
    refreshHiakiAtk(owner);
    // 鳴門耐久为 0 / 本场已倒下：不能被燕返带出来（以前照样出场）
    const why = weaponSummonWhy(owner, "naruto");
    const w = why ? null : spawnWeapon(owner, "naruto");
    lines.push(w ? "持刀改为丹生谷，鳴門出场。" : why ? `持刀改为丹生谷；${why}。` : "鳴門已在场。");
  }
}

/* ---------- 打配置物 / 危墙算命中（#52） ---------- */
/** 替身目标：技能分支把它当成一个普通目标用（读 zone / statuses / def……），dealTo 认出 isStructure 交给 dealToStructure。
 *  写在替身身上的状态、减益都是丢掉的（物体不吃状态）；它不在 state.units 里，范围攻击、选目标列表都看不到它 */
function makeStructProxy(token, tokZones, a) {
  const tok = String(token);
  const isGap = tok.indexOf("gap:") === 0;
  const p = isGap ? null : propByRef(tok);
  const g = isGap ? (state.gaps || {})[tok.slice(4)] : null;
  // 危墙夹在两区之间：取离攻击者近的那一区（居合这类「移到目标区」的就移到这一侧）
  const zones = (tokZones || []).map(Number).filter(z => !isNaN(z));
  const zone = zones.slice().sort((x, y) => zoneDist(a.zone, x, state.zoneMode) - zoneDist(a.zone, y, state.zoneMode))[0];
  return {
    id: tok, structToken: tok, isStructure: true, kind: "structure",
    name: p ? p.name : `${gapLabel(g ? g.type : "wall")}（${tok.slice(4)} 区之间）`,
    zone: zone != null ? zone : Number(a.zone), level: (p && p.level) || 1, isPlayer: !!(p && p.faction !== "enemy" && p.faction),
    statuses: {}, instant: {}, resources: {}, layers: [], marks: [], focuses: [],
    def: 0, defMax: 0, noPosture: true, stunned: false, dead: false, hidden: false, flying: false
  };
}
/** dealTo 打到替身：用技能真实的属性 / 倍率 / 骰子 / 击破算一下，交给 hitStructureCore。
 *  攻击者身上挂着的下一击效果（猛击、穿刺、弱点、准备 / 磨刀）照常用掉；吸血、击退、打出失衡都不算（物体没有架势、不会被推走） */
function dealToStructure(attacker, target, opt) {
  const flags = opt.flags || {};
  const r = attacker && attacker.resources;
  const realAttack = flags.action !== false && !flags.environment;
  let prep = 0;
  if (r && realAttack) {
    if (r.smashNext) r.smashNext = false;
    if (r.pierceNext) r.pierceNext = false;
    if (r.weakNext) r.weakNext = false;
    if (r.preparedActive && opt.usePrep !== false) {
      const whet = Number(r.whetDice) || 0;
      prep = (whet ? takeDice(whet, 6, 0) : takeDice(1, prepDieSides(attacker), 0)).total;
      delete r.whetDice;
      r.preparedActive = false; r.prepared = false;
    }
  }
  const atk = opt.atk != null ? Number(opt.atk) : effectiveAtk(attacker, state.units);
  const hits = Math.max(1, Number(opt.hits) || 1);
  let dice = opt.diceValue;
  if (dice == null) dice = (opt.diceN && opt.diceS) ? takeDice(opt.diceN, opt.diceS, opt.diceB || 0).total : 0;
  let dmg = prep;
  for (let i = 0; i < hits; i++) {
    const m = Array.isArray(opt.hitMults) && opt.hitMults[i] != null ? Number(opt.hitMults[i]) : (opt.mult != null ? Number(opt.mult) : 1);
    dmg += atk * m + (Number(opt.flat) || 0) + (Number(dice) || 0);
  }
  let br = opt.baseBreak != null ? Number(opt.baseBreak) : 1;
  if (attacker && attacker.rallyBreak) br += attacker.rallyBreak;
  if (attacker && attacker.kit === "hiaki" && r && r.blade === "naruto" && (typeof passiveOn !== "function" || passiveOn(attacker))) br += 1;   // 佩刀
  if (attacker && attacker.kit === "naruto" && typeof passivePlus === "function" && passivePlus(attacker, 1)) br += 1;
  if (typeof featBreakBonus === "function") {
    try { br = featBreakBonus(attacker, target, opt, flags, br, zoneDist(attacker.zone, target.zone, state.zoneMode), false); } catch (e) {}
  }
  // 驻波墙：打配置物 / 危墙也照样过墙（这一属性：增幅每道 +25%、降幅每道 −50%，加在一起；降幅没有击破）
  const waves = attacker && attacker.zone != null && target.zone != null && !flags.diffract && !flags.locked && !flags.lob
    ? waveWallsOnLine(attacker.zone, target.zone).filter(w => w.el === (opt.element || "physical")) : [];
  const waveAmp = waves.filter(w => w.mode === "amplify").length, waveDamp = waves.length - waveAmp;
  if (waves.length) dmg *= Math.max(0, 1 + WAVE_WALL.amplifyPct * waveAmp - WAVE_WALL.dampenPct * waveDamp);
  if (waveDamp) br = 0;
  target._hit = true;
  const lines = hitStructureCore(attacker, target.structToken, { element: opt.element || "physical", dmg: Math.max(1, Math.floor(dmg)), brk: Math.max(0, br) });
  if (waves.length) {
    const parts = [];
    if (waveAmp) parts.push(`伤害 +${Math.round(WAVE_WALL.amplifyPct * waveAmp * 100)}%`);
    if (waveDamp) parts.push(`伤害 −${Math.round(WAVE_WALL.dampenPct * waveDamp * 100)}%，不造成击破`);
    lines.unshift(`穿过${waves.map(w => waveWallName(w)).join("、")}：${parts.join("；")}。`);
  }
  return { structure: true, lines, extra: [], res: { ok: true, structure: true, total: Math.max(0, Math.floor(dmg)), breakDealt: 0, perHit: [], log: [], flags } };
}
/** 技能结算完：技能分支出错、替身一下都没挨 → 照以前的通用打法打一下（行动点已经扣了，不白扣）；
 *  技能自己没打它（只上状态的、没选好分步的……）就不打。写在替身上的状态提示一句无效 */
function structProxyFinish(a, id, proxy, lines) {
  if (proxy._crashed && !proxy._hit) lines.push(...hitStructureCore(a, proxy.structToken, structureHitOpt(a, id)));
  const st = proxy.statuses || {}, ins = proxy.instant || {};
  if (Object.keys(st).some(k => k !== "latestElement" && st[k]) || Object.keys(ins).some(k => ins[k])) lines.push(`${proxy.name} 是物体：状态和减益对它无效。`);
}

/** 战斗画面的受击：给配置物 / 危墙也发一个「伤害弹字」，画面据此播前冲、受击变白和数字 */
function popStructure(token, level, value, element, text) {
  if (typeof spawnPopup !== "function") return;
  const fake = { id: token, level: level || 1 };
  try {
    if (value > 0) spawnPopup(fake, { kind: "dmg", value, element: element || "physical" });
    else spawnPopup(fake, { kind: "status", text: text || "无效", element: element || "physical" });
  } catch (e) {}
}

/** 打一下配置物 / 危墙 / 桥梁，返回日志行（不存撤销点、不刷新画面；技能里打多个目标时用） */
function hitStructureCore(attacker, targetToken, opt) {
  const notes = [];
  opt = opt || {};
  if (String(targetToken).indexOf("gap:") === 0) {
    const key = targetToken.slice(4);
    const g = state.gaps[key];
    if (!g) return notes;
    if (g.type !== "wall" && g.type !== "bridge") {
      notes.push("这个间隔没有可打的墙/桥。");
      return notes;
    }
    const dmg = Math.max(1, Math.floor(opt.dmg || (effectiveAtk(attacker, state.units) || 5)));
    const br = Math.max(0, Math.floor(Number(opt.brk != null ? opt.brk : 1) || 0));
    g.lastFrom = attacker ? attacker.zone : 1;   // 手册：摧毁方向只看最后一击来源区域
    g.lastBy = envCreditId(attacker);
    const before = Number(g.hp) || 0;
    // 危墙、不稳桥梁：受到击破时损失等量耐久值——伤害打不动，只有击破算（opt.gapDur：固定扣耐久，巨刃划空用）
    void dmg;
    if (opt.gapDur != null) {
      g.hp = Math.max(0, g.hp - Math.max(0, Math.floor(Number(opt.gapDur) || 0)));
      notes.push(`攻击间隔 ${key}（${gapLabel(g.type)}）：耐久 −${opt.gapDur} → ${g.hp}`);
    } else {
      g.hp = Math.max(0, g.hp - br);
      notes.push(`攻击间隔 ${key}（${gapLabel(g.type)}）：击破 ${br} → 耐久 ${g.hp}${br ? "" : `（伤害打不动${gapLabel(g.type)}，要靠击破）`}`);
    }
    popStructure(targetToken, g.level, before - g.hp, opt.element, "打不动");
    if (g.hp <= 0) notes.push(...destroyGap(key, g));
  } else if (String(targetToken).indexOf("prop:") === 0) {
    const p = (state.props || []).find(x => x.id === targetToken.slice(5));
    if (!p) return notes;
    const before = Number(p.hp) || 0;
    const out = damageProp(p, opt, attacker);
    const isDevice = p.kind === "button" || p.kind === "lever";
    popStructure(targetToken, p.level, isDevice ? 0 : before - Math.max(0, Number(p.hp) || 0), opt.element, isDevice ? "触发" : "无效");
    notes.push(...out);
  }
  return notes;
}

function hitStructure(attacker, targetToken, opt) {
  snapshot();
  const notes = hitStructureCore(attacker, targetToken, opt);
  if (notes.length) appendLog(notes.join("\n"));
  renderAll();
}

/** 技能可以打到的配置物与危墙 / 桥梁（距离 minD–maxD）。危墙夹在两区之间：两边任一区在范围里就算。
 *  隔着危墙 / 关着的门的不算（倒塌 / 打开之前影响不到对面）；墙本身从自己这一侧打得到 */
function structureTargets(actor, minD, maxD) {
  const out = [];
  const inR = (z) => { const d = zoneDist(actor.zone, z, state.zoneMode); return d >= minD && d <= maxD; };
  (state.props || []).forEach(p => {
    if (BARRIER_SIDE[p.kind] === "player") return;   // 自己的铁壁 / 防护罩不当目标
    if (!(p.hp > 0) && p.kind !== "button" && p.kind !== "lever") return;
    if (p.isVehicle && typeof vehiclePilot === "function" && vehiclePilot(p)) return;   // 有驾驶员的车和驾驶员合并成一个单位，打驾驶员（vehicle.js）
    if (inR(p.zone) && !lineBlocked(actor.zone, p.zone)) out.push({ id: "prop:" + p.id, name: p.name, zone: p.zone, isPlayer: p.faction !== "enemy" });
  });
  const zm = Number(state.zoneMode) || 2;
  Object.keys(state.gaps || {}).forEach(k => {
    const g = state.gaps[k];
    if (!g || (g.type !== "wall" && g.type !== "bridge")) return;
    if (!boardGapKeys().includes(k)) return;   // 只看这块棋盘上真的有的连接
    const zs = k.split("-").map(Number);
    const z = zs.find(inR);
    // 至少有一侧不隔着别的墙 / 关着的门（墙自己挡的是对面，不挡它本身）
    if (z != null && structureReachable(actor, "gap:" + k)) out.push({ id: "gap:" + k, name: `${gapLabel(g.type)}（${k} 区之间）`, zone: z, isPlayer: false });
  });
  return out;
}
/** 配置物 / 危墙 / 桥梁是不是隔着危墙或关着的门（不管射程）：配置物看它所在的区，
 *  危墙 / 桥梁看两侧里有没有一侧不被挡。返回 true = 影响得到 */
function structureReachable(actor, token) {
  if (!actor || actor.zone == null) return true;
  const s = String(token || "");
  if (s.indexOf("gap:") === 0) return s.slice(4).split("-").map(Number).some(z => !lineBlocked(actor.zone, z));
  const p = propByRef(s);
  return !p || !lineBlocked(actor.zone, p.zone);
}
const isStructureToken = (id) => /^(gap|prop):/.test(String(id || ""));

function destroyGap(key, g) {
  const notes = [];
  const parts = key.split("-").map(Number);
  if (g.type === "bridge") {
    g.type = "void";
    g.hp = 0;
    notes.push(`桥梁摧毁，${key} 变成空隙。`);
    return notes;
  }
  if (g.type === "wall") {
    const from = Number(g.lastFrom || parts[0]);
    const fallTo = from === parts[0] ? parts[1] : parts[0];
    g.type = "open";
    g.hp = 0;
    const lvEl = uiEl("propLevel");
    const lv = Number(g.level) || Number(lvEl && lvEl.value) || 1;
    const diceN = 1 + dieStep(lv, 5);
    const r = takeDice(diceN, 10, 0);
    const dmg = Math.floor(r.total);
    const victims = state.units.filter(u => !u.hidden && !u.dead && !u._removed &&Number(u.zone) === Number(fallTo));
    notes.push(`危墙向 ${fallTo} 区倒塌：${r.text} 物理 + 2 击破。`);
    if (!victims.length) notes.push(`${fallTo} 区没有单位承受倒塌。`);
    victims.forEach(u => {
      const fake = unitOf("危墙", lv, [{ type: "armor", hp: 1 }], 0, 0);
      fake.zone = fallTo;
      fake.envSrc = true; fake.envBy = g.lastBy;   // 环境分数：记在推倒它的人身上
      const out = dealTo(fake, u, {
        atk: 0, mult: 0, flat: dmg, hits: 1, element: "physical", baseBreak: 2,
        flags: { action: true, blockResolved: true, environment: true }
      });
      const hp = totalHp(u);
      notes.push(`${u.name} 承受倒塌 ${Math.floor((out.res && out.res.total) || 0)} 伤害、击破 ${(out.res && out.res.breakDealt) || 0} → 生命 ${hp}，架势 ${u.def}`);
      (out.extra || []).forEach(s => notes.push("  " + s));
    });
    notes.push("危墙已清除，间隔畅通。");
  }
  return notes;
}

/** 写了血量类型的配置物：被打时按属性克制表算倍率 */
const PROP_HP_TYPE = { battery: "armor", turret: "armor", coral_branch: "armor", coral_tentacle: "armor", death_statue: "armor" };
function damageProp(p, opt, attacker) {
  const notes = [];
  const element = opt.element || "physical";
  let lose = 1;
  if (p.kind === "boom") {
    // 手册：火焰 −3，能量 / 雷电 −1；其他属性打不动爆炸桶
    if (element === "fire") lose = 3;
    else if (element === "energy" || element === "electric") lose = 1;
    else lose = 0;
  } else if (p.kind === "acid") {
    lose = element === "harmonic" ? 3 : 1;
  } else if (p.kind === "scrap") {
    lose = 1;
  } else if (BARRIER_SIDE[p.kind]) {
    const h = hitBarrier(p, attacker, { atk: 0, mult: 0, flat: Math.max(1, Math.floor(opt.dmg || 5)), element });
    return notes.concat(h.notes);
  } else if (p.kind === "button" || p.kind === "lever") {
    notes.push(`${p.name} 被攻击，触发装置。`);
    useDevice(p);
    return notes;
  } else {
    lose = Math.max(1, Math.floor(opt.dmg || 5));
    // 写了血量类型的配置物（电池、炮台是装甲生命值）照属性克制表算倍率，和单位的装甲层一样吃天气：
    // 天气增减伤、微光反转克制、酸雨装甲减伤失效（隔离区不受天气影响）
    const type = PROP_HP_TYPE[p.kind] || (p.isVehicle ? "armor" : null);   // 载具（vehicle.js）是纯装甲
    let m = 1, chartOnly = 1;
    if (type && CHART[element]) {
      const f = state.fields[p.zone] || {};
      const weather = f.isolate ? "none" : state.weather;
      chartOnly = 1 + (Number(CHART[element][type]) || 0);
      m = Math.max(0, round2(1 + chartMod(element, type, weather, f, weather === "acid") + weatherDamagePct(weather, element)));
    }
    if (m !== 1) {
      const raw = lose;
      lose = Math.max(0, Math.floor(raw * m + 1e-6));
      notes.push(`${p.name}是${LAYER[type] || type}生命：${ELE[element] || element}属性 ×${m}${m !== chartOnly ? "（含天气 / 场地）" : ""}（${raw} → ${lose}）。`);
    }
  }
  // 沙珊瑚白天吸热：火焰不伤它，反而回复同样多的耐久（desert.js）
  if (typeof coralAbsorbsFire === "function" && coralAbsorbsFire(p, element, lose, notes)) return notes;
  if (lose <= 0) {
    notes.push(p.kind === "boom" ? `${p.name} 只怕火焰、能量和雷电：${ELE[element] || element}属性打不动它。` : `${p.name} 没有受到伤害。`);
    return notes;
  }
  p.hp = Math.max(0, p.hp - lose);
  p.lastBy = envCreditId(attacker);   // 环境分数：最后打它的人（酸液桶渗漏记在他身上）
  notes.push(`${p.name} 耐久 −${lose} → ${p.hp}`);
  if (typeof coralPropDamaged === "function") coralPropDamaged(p, lose, notes);   // 沙珊瑚枝：一回合打掉 25% 砍断触须
  if (p.hp <= 0) notes.push(...destroyProp(p, attacker));
  if (typeof coralGasBurst === "function") coralGasBurst(p, element, attacker, notes);   // 夜晚被火打中：可燃气爆燃
  return notes;
}

function destroyProp(p, attacker) {
  const notes = [`${p.name} 被摧毁。`];
  if (typeof coralPropDestroyed === "function") coralPropDestroyed(p, notes);   // 沙珊瑚：被抓的人脱困
  if (p.isVehicle && typeof vehicleDestroy === "function") return vehicleDestroy(p, notes);   // 载具被摧毁：殉爆（vehicle.js）
  if (BARRIER_SIDE[p.kind]) {
    notes.push(...breakIronWall(p, []));
    return notes;
  }
  const lv = p.level || 1;
  if (p.kind === "boom") {
    const r = takeDice(1, 20, lv);
    const dmg = r.total;
    notes.push(`爆炸：同区 ${r.text} 火焰 + 2 击破。`);
    markAoeZone(p.zone, { element: "fire", dmg, attacker, from: p.zone, env: true });   // 从桶所在的区炸开（环境伤害：屏障照样挨，不看是谁引爆的）
    state.units.filter(u => !u.hidden && !u.dead && !u._removed && Number(u.zone) === Number(p.zone)).forEach(u => {
      const fake = unitOf("爆炸桶", lv, [{ type: "armor", hp: 1 }], 0, 0);
      fake.zone = p.zone;
      fake.envSrc = true; fake.envBy = envCreditId(attacker);   // 环境分数：记在引爆它的人身上
      // 爆炸是范围伤害：不能协助格挡
      dealTo(fake, u, { atk: 0, mult: 0, flat: dmg, element: "fire", baseBreak: 2, flags: { action: true, aoe: true, blockResolved: true } });
    });
  }
  if (p.kind === "acid") {
    const f = state.fields[p.zone] || emptyField();
    // 酸液地面的所有者 = 打爆酸液桶的人（环境分数）
    const err = setZoneField(p.zone, "acid", { by: envCreditId(attacker) });
    notes.push(err || `${p.zone} 区生成酸液地面。`);
  }
  if (p.kind === "battery") {
    const r = takeDice(lv, 4, 0);
    const dmg = r.total;
    notes.push(`电池爆炸：同区所有单位（不分敌我）${r.text} 电击。`);
    markAoeZone(p.zone, { element: "electric", dmg, attacker, from: p.zone, env: true });
    state.units.filter(u => !u.hidden && !u.dead && !u._removed && Number(u.zone) === Number(p.zone)).forEach(u => {
      const fake = unitOf("电池", lv, [{ type: "armor", hp: 1 }], 0, 0);
      fake.zone = p.zone;
      fake.envSrc = true; fake.envBy = envCreditId(attacker);
      dealTo(fake, u, { atk: 0, mult: 0, flat: dmg, element: "electric", baseBreak: 0, flags: { action: true, aoe: true, blockResolved: true } });
    });
  }
  state.props = state.props.filter(x => x.id !== p.id);
  if (p.kind === "battery") notes.push(...syncBatteryShields());
  return notes;
}

function triggerLeaveOpportunity(mover, fromZone, notes) {
  if (!mover || mover.kind) return;
  fieldUnits().forEach(u => {
    if (u.id === mover.id || u.dead || u.hidden || u.stunned) return;
    if (Number(u.zone) !== Number(fromZone)) return;
    if (u.kit === "captain_wolf" && mover.isPlayer) {
      const n = addedDiceByLevel(u.level);
      notes.push(`${u.name} 对离开区域的 ${mover.name} 发动借机攻击。`);
      // 借机是近战：目标已经走到隔壁才结算，带上 atkRange 免得被当成高地远程（±25%）
      opportunityStrike(u, mover, fromZone, { atk: 0, mult: 0, diceN: n, diceS: 6, element: "ice", baseBreak: 1, atkRange: "melee", flags: { action: true, opportunity: true, blockResolved: true } });
      if (window.GAME && window.GAME.tape) window.GAME.tape.push({ type: "opp", attackerId: u.id, targetId: mover.id, name: u.name });
    }
    if (typeof bpLeaveOpportunity === "function") bpLeaveOpportunity(u, mover, notes);
    if (u.kit === "thug_knife" && mover.isPlayer) {
      notes.push(`${u.name} 对离开区域的 ${mover.name} 发动借机攻击。`);
      opportunityStrike(u, mover, fromZone, { atk: effectiveAtk(u, state.units), mult: 1, diceN: 1, diceS: 8, element: "physical", baseBreak: 1, atkRange: "melee", flags: { action: true, opportunity: true, blockResolved: true } });
      if (window.GAME && window.GAME.tape) window.GAME.tape.push({ type: "opp", attackerId: u.id, targetId: mover.id, name: u.name });
    }
  });
}
/** 一下借机攻击（作者 10/19：铁壁挡不了借机攻击是 bug）。
 *  · 结算时走的人已经站到隔壁了，这一下是在他离开的那一区打的：替他挡的是那一区的铁壁 / 屏障（dealTo · wallZone）。
 *  · 每一下借机攻击都是单独的一次攻击：屏障「已拦截本次行动」只看这一下，不沿用、也不占用当前行动的记录（和防卫炮台那一炮一样） */
function opportunityStrike(attacker, mover, fromZone, opt) {
  if (attacker && attacker.trainingDummy) return null;   // 训练假人不做任何反应攻击
  const wallBefore = state.actionWallHit;
  state.actionWallHit = {};
  try {
    return dealTo(attacker, mover, Object.assign({ wallZone: Number(fromZone) }, opt));
  } finally {
    state.actionWallHit = wallBefore;
  }
}

/** 离开冻土的检定：简单难度「运动」检定（手册第一章成功率表 ROGUE_CHECKS.chance：无熟练 50%，一级以上 100% 默认通过）。
 *  种族的优势 / 劣势 / 失败重掷照 RACE_CHECK_PERKS（party.js · checkPerksFor）。返回 { ok, text } */
function iceLeaveCheck(u) {
  const level = typeof unitProfLevel === "function" ? unitProfLevel(u, "运动") : 0;
  const table = typeof ROGUE_CHECKS !== "undefined" ? ROGUE_CHECKS.chance : [[0.5, 0, 0, 0], [1, 0.5, 0.25, 0.125], [1, 1, 0.5, 0.25], [1, 1, 0.75, 0.5]];
  const base = (table[level] || [])[0] || 0;   // 第 0 列 = 简单
  const lvText = ["没有熟练", "一级熟练", "二级熟练", "三级熟练"][level] || "";
  if (base >= 1) return { ok: true, text: `简单「运动」检定（${lvText}，默认通过）` };
  const hpLow = totalHp(u) * 2 < totalMaxHp(u);
  const perks = u.isPlayer && typeof checkPerksFor === "function" ? checkPerksFor(u.kit, "运动", hpLow)
    : (!u.isPlayer && typeof raceCheckPerks === "function" ? raceCheckPerks(u) : {});
  const roll = () => Math.random() < base;
  const once = () => perks.adv ? (roll() || roll()) : perks.dis ? (roll() && roll()) : roll();
  let ok = once();
  let rerolled = false;
  if (!ok && perks.reroll) { rerolled = true; ok = once(); }
  const tags = [perks.adv ? "优势" : "", perks.dis ? "劣势" : "", rerolled ? "失败后重掷" : ""].filter(Boolean).join("，");
  return { ok, text: `简单「运动」检定（${lvText}，成功率 ${Math.round(base * 100)}%${tags ? "，" + tags : ""}）` };
}
/** 进出冻土的冰击破：1 点，雪天翻倍；恶劣环境 / 末日让场地效果再翻倍 */
function iceFieldBreak(u) {
  return (currentWeatherFor(u) === "snow" ? 2 : 1) * envMult(u);
}

/** 移动也整理成一块：「【谁】移动」+ 从哪到哪 + 花费 + 移动引起的事（借机攻击、场地……）。
 *  moveOpt.title：这一块的标题（"" = 不写标题，并进调用方自己的那一块），moveOpt.note：「从哪到哪」后面的括号说明，
 *  moveOpt.noOpp：不触发借机攻击（潜藏者挨了近战逃跑，enemies.js · ratLurkerFlees） */
function doMove(unit, dest, moveOpt) {
  if (!unit) return;
  const prevActor = LOG_ACTOR_ID;
  LOG_ACTOR_ID = unit.id;
  let lines;
  try {
    lines = withLogSink(() => {
      const waveOwn = waveLedgerOpen();   // 驻波墙：走路引起的别的移动（借机攻击击退、紧追……）也补算穿墙
      try { doMoveInner(unit, dest, moveOpt); } finally { waveLedgerClose(waveOwn); }
    });
  } finally { LOG_ACTOR_ID = prevActor; }
  if (typeof vehicleSync === "function") vehicleSync();   // 驾驶员带着整辆车走（炮手和车跟着驾驶员的区）
  // 「X：1 区 → 2 区」挪到最前面，花费跟在后面
  const i = lines.findIndex(s => /区 → \d+ 区/.test(s));
  if (i > 0) lines.unshift(lines.splice(i, 1)[0]);
  const title = moveOpt && typeof moveOpt.title === "string" ? moveOpt.title : `【${unit.name}】移动`;
  const block = tidyActionBlock(title, lines.map(s => s.replace(new RegExp("^" + unit.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "：(\\d+ 区 → \\d+ 区)"), title ? "$1" : unit.name + "：$1")));
  if (block.length) appendLog(block.join("\n"));
  // 下水道狂鼠（enemies.js · ratfolkSweep）：最外层的移动结算完（坠落、场地……）再看一遍反应；技能里的移动等技能打完再看
  if (typeof ratfolkSweep === "function" && !state._highDefer && !logSinkActive()) ratfolkSweep();
}

function doMoveInner(unit, dest, moveOpt) {
  dest = Number(dest);
  if (typeof isCrushing === "function" && isCrushing(unit) && !(moveOpt && moveOpt.free)) {
    appendLog(`${unit.name} 正抓在敌人身上，无法主动移动。`);
    return;
  }
  moveOpt = moveOpt || {};
  // 坐在车上的炮手不能自己移动（驾驶员带着整辆车走，见 vehicle.js）
  if (unit.vehId && !unit.vehMerged && !moveOpt.forced) {
    paintSkillLog(`${unit.name} 在车里，不能自己移动。先下车，或者让驾驶员开车。`);
    return;
  }
  // 濒死没起身的人不能自己移动（以前规则层不拦，只靠界面）
  if (unit.dying && !moveOpt.free && !moveOpt.forced) {
    paintSkillLog(`${unit.name} 濒死中。先点「起身」。`);
    return;
  }
  const from = Number(unit.zone);
  const maxZ = Number(state.zoneMode);
  const notes = [];
  if (dest === from) return;
  if (dest < 1 || dest > maxZ) {
    paintSkillLog("没有那个区域。");
    return;
  }
  if (!zonesAdjacent(from, dest)) {
    paintSkillLog("一次只能移动 1 格（只能走到相连的区）。远的区要走几次。");
    return;
  }
  if (!moveOpt.free && !canControlUnit(unit)) {
    paintSkillLog(state.combatPhase === "enemy" ? "现在是敌人回合，不能移动玩家。" : "现在是玩家回合，不能移动敌人。");
    return;
  }
  if (!moveOpt.free && unit.stunned) {
    paintSkillLog(`${unit.name} 晕眩，不能移动。`);
    return;
  }
  if (unit.noMove) {
    paintSkillLog(`${unit.name} 被禁足（年糕咬住等），本回合不能移动。`);
    return;
  }
  if (!moveOpt.free && !moveOpt.forced && typeof touDuelVictim === "function" && touDuelVictim(unit)) {
    paintSkillLog(`${unit.name} 处于决一死战：只能攻击灯，不能移动或其他行动。`);
    return;
  }
  if (unit.self === "frost") {
    paintSkillLog("霜结：无法自行移动。");
    return;
  }
  const fromF = state.fields[from] || emptyField();
  const toF = state.fields[dest] || emptyField();
  // 深渊：地面单位不能主动走进去（被推进去才会坠落）；万一站在里面，可以走出来
  if (toF.abyss && !unit.flying && !moveOpt.forced) {
    paintSkillLog("深渊不能站人。飞行单位才能过。");
    return;
  }
  // 沙珊瑚缠绕：动不了，只有砍断触须才能脱困（desert.js）
  if (unit.entangled && !moveOpt.forced) {
    paintSkillLog(`${unit.name} 被${unit.entangled.name}缠住了，动不了：先砍断触须（打珊瑚）。`);
    return;
  }
  // 流沙：下陷 2 层起自己走不出去（技能里的移动也一样；被推、被拉不受限）
  if (sinkStuck(unit) && !moveOpt.forced) {
    paintSkillLog(`${unit.name} 下陷 ${sinkOf(unit)} 层，自己走不出流沙：要等下陷降下来，或者让同伴拉出来、被位移带出去。`);
    return;
  }
  const cross = canCross(unit, from, dest, false);
  if (!cross) return;
  // 空隙：地面单位这一步改花 1 行动点（不花附赠行动），还要过简单难度运动检定；技能里的移动不花行动点，过不去
  const overVoid = cross === "void";
  if (overVoid && moveOpt.free) {
    paintSkillLog("空隙：地面单位要花 1 行动点并通过运动检定才能越过，技能里的移动过不去（飞行单位可以）。");
    return;
  }
  // 荒原行者（feats.js）：酸液地面、空隙只要附赠动作，不用检定；冻土离开不检定、进入不受击破
  const wanderer = typeof featHas === "function" && featHas(unit, "wanderer");
  let frenzyFree = false;
  if (!moveOpt.free) {
    const fromF = state.fields[from] || emptyField();
    if (wanderer && (overVoid || (fromF.acid && !unit.flying))) {
      if (!spendBonus(unit, 1, overVoid ? "越过空隙（荒原行者）" : "离开酸液地面（荒原行者）")) return;
      if (unit.resources) unit.resources.chargeTurn = state.turnNo;
    } else if (overVoid) {
      if (!spendAp(unit, 1, "越过空隙")) return;
    } else if (fromF.acid && !unit.flying && !(typeof acidGroundWalker === "function" && acidGroundWalker(unit))) {
      if (!spendAp(unit, 1, "离开酸液地面")) return;
    } else if (typeof frenzyFreeMoveReady === "function" && frenzyFreeMoveReady(unit)) {
      // 狂暴（effects.js · FRENZY.freeMoves）：这回合的免费移动，不花附赠 / 行动点（越过空隙、离开酸液地面照上面的规则另算）
      useFrenzyFreeMove(unit);
      frenzyFree = true;
    } else if (unit.self === "conductor") {
      // 导体：移动不消耗附赠动作
    } else if (unit.kit === "ecmo" && unit.resources && unit.resources.probe) {
      // 探测模式：移动不消耗附赠动作
    } else if (unit.isPlayer) {
      if (!spendBonus(unit, 1, "移动")) return;
      if (unit.resources) unit.resources.chargeTurn = state.turnNo;   // 冲阵（feats.js）：这回合用附赠动作移动过
    } else if (enemyRankOf(unit) === "minion") {
      // 杂兵才用行动点移动
      if (!spendAp(unit, 1, "杂兵移动")) return;
    } else {
      // 精英与 BOSS 只能用附赠行动移动，不退回去扣行动点
      if (!spendBonus(unit, 1, "移动")) return;
    }
  }
  snapshot();
  if (overVoid) {
    // 计算器里勾了「允许强行通过」= 主持人判定检定成功，不再掷骰（行动点照扣）；荒原行者不用检定
    const chk = wanderer ? { ok: true, text: "越过空隙：荒原行者，不用检定。" } : state.forceVoid && state.forceVoid[gapKey(from, dest)]
      ? { ok: true, text: "越过空隙：主持人判定运动检定成功。" } : rollVoidCross(unit);
    notes.push(chk.text);
    if (!chk.ok) {
      paintSkillLog(notes.join("\n"));
      renderAll();
      return;
    }
  }
  const passed = passGap(unit, from, dest);
  notes.push(...passed.notes);
  if (passed.fail) {
    paintSkillLog(notes.join("\n"));
    renderAll();
    return;
  }
  if (fromF.acid && !unit.flying && !overVoid && !wanderer && !(typeof acidGroundWalker === "function" && acidGroundWalker(unit))) {
    notes.push("离开酸液地面：规则上消耗行动点而不是附赠行动。");
  }
  if (fromF.ice && !unit.flying && !moveOpt.free && !fieldExempt(unit) && wanderer) notes.push("离开冻土：荒原行者，不用检定。");
  if (fromF.ice && !unit.flying && !moveOpt.free && !fieldExempt(unit) && !wanderer) {
    // 离开冻土：简单难度「运动」检定（手册第一章成功率表：无熟练 50%，一级以上必过；种族优势 / 劣势 / 重掷照 RACE_CHECK_PERKS）
    const chk = iceLeaveCheck(unit);
    if (!chk.ok) {
      const br = iceFieldBreak(unit);
      if (typeof raceFieldImmune === "function" && raceFieldImmune(unit)) notes.push(`离开冻土：${chk.text}，失败：留在 ${from} 区；环境适应，免疫这次冰击破。`);   // 鼠类人·鼠：50% 概率免疫
      else {
        dealBreak(unit, br, "ice", notes, "冻土离开失败");
        notes.push(`离开冻土：${chk.text}，失败：留在 ${from} 区并受 ${br} 冰击破。`);
      }
      paintSkillLog(notes.join("\n"));
      renderAll();
      return;
    }
    notes.push(`离开冻土：${chk.text}，成功。`);
  }
  unit.zone = dest;
  if (unit.kit === "ecmo" && unit.resources && unit.resources.probe) (unit.resources.probeZones = unit.resources.probeZones || []).push(Number(dest));
  waveMoved(unit, [from, dest], notes);   // 驻波墙（频域造物）：穿过就挂状态、推进聚焦
  convertUnstableInHv(unit, notes);
  if (!moveOpt.noOpp) triggerLeaveOpportunity(unit, from, notes);
  if (typeof bpAfterEnemyMove === "function") bpAfterEnemyMove(unit, notes);   // 单局图纸：稳妥的距离
  if (typeof hunterAfterMove === "function") hunterAfterMove(unit, notes);     // 蚁型特殊剿灭兵种：有人走进来就退开
  if (typeof dormantAfterMove === "function") dormantAfterMove(unit, notes);   // 休眠的敌人：有人进它的区就醒
  quicksandAfterZoneChange(unit, notes, "走出流沙");
  if (typeof ambushOnEnter === "function") ambushOnEnter(unit, notes);   // 走进伏咬沙鱼的区
  enterFrozenGround(unit, notes);
  applyAbyssFall(unit, from, notes);
  if (typeof afterMove === "function") afterMove(unit, notes);
  if (typeof raceAfterMove === "function") raceAfterMove(unit, notes);   // 迅袭（enemies.js）：移动回 1 架势
  if (typeof featAlertOnEnter === "function") featAlertOnEnter(unit, notes);   // 警戒（feats.js）：敌人走进来挨一下
  chaseFollow(unit, notes);
  notes.unshift(`${unit.name}：${from} 区 → ${unit.zone} 区${moveOpt.note || (moveOpt.free ? "（技能内移动，不耗附赠）" : frenzyFree ? "（狂暴：这回合的免费移动）" : "")}`);
  paintSkillLog(notes.join("\n"));
  renderAll();
}

/** 进入冻土：地面单位受 1 冰击破（雪天翻倍、恶劣环境 / 末日再翻倍；保释豁免）。自己走进去、紧追跟进、被推进去都算。
 *  走通用击破：坚挺、屹立不倒、冰属性打进失衡的冰冻加伤、塌陷计数都照算 */
/** 换区之后的流沙：离开原来的流沙下陷清零；走进 / 被推进流沙 +1 */
function quicksandAfterZoneChange(unit, notes, why) {
  if (!unit || unit.kind || unit.dead) return;
  if (sinkOf(unit)) clearSink(unit, notes, why || "离开流沙");
  if (inQuicksand(unit)) addSink(unit, 1, notes, "陷进流沙");
}
function enterFrozenGround(unit, notes) {
  if (!unit || unit.kind || unit.flying || unit.dead) return;
  const toF = state.fields[unit.zone] || emptyField();
  if (!toF.ice || fieldExempt(unit)) return;
  if (typeof featHas === "function" && featHas(unit, "wanderer")) return;   // 荒原行者：进入冻土不受击破
  if (typeof raceFieldImmune === "function" && raceFieldImmune(unit)) { notes.push(`${unit.name} 进入冻土：环境适应，免疫这次冰击破。`); return; }   // 鼠类人·鼠：50% 概率免疫
  const br = iceFieldBreak(unit);
  notes.push(`${unit.name} 进入冻土：冰击破 ${br}。`);
  dealBreak(unit, br, "ice", notes, "进入冻土");
}

/** 紧追：被紧追的单位移动后，施加紧追的一方自动跟到它所在的区域（不耗行动）。
 *  跟上去也是地面移动：危墙 / 关着的门 / 空隙挡住就没跟上，过不稳桥梁照扣耐久，进冻土照受冰击破 */
function chaseFollow(unit, notes) {
  if (!unit || !unit.statuses || !unit.statuses.chase || unit.dead) return;
  let ids = (unit.chasers || []).slice();
  if (!ids.length) {   // 旧存档没记施加者：默认是柯尔特
    const k = typeof findKit === "function" ? findKit("kolt", state.units) : null;
    if (k) ids = [k.id];
  }
  ids.forEach(id => {
    const c = unitById(id);
    if (!c || c.dead || c.hidden || c.fused || c.id === unit.id) return;
    if (Number(c.zone) === Number(unit.zone)) return;
    const from = Number(c.zone);
    const crossing = [];
    if (crossGapsForced(c, from, unit.zone, crossing, false)) {
      c.zone = Number(unit.zone);
      notes.push(`${c.name} 紧追 ${unit.name}：${from} 区 → ${unit.zone} 区（不耗行动）。`, ...crossing);
      waveMoved(c, forcedPath(from, c.zone) || [from, c.zone], notes);
      enterFrozenGround(c, notes);
      applyAbyssFall(c, from, notes);
      if (typeof afterMove === "function") afterMove(c, notes);
    } else {
      notes.push(...crossing);
      notes.push(`${c.name} 紧追 ${unit.name}，但间隔挡住，没跟上。`);
    }
  });
}

function touDuelVictim(u) {
  if (!u || u.isPlayer || u.dead || u.hidden || u.fused) return null;
  const tou = findKit("tou", state.units);
  if (!tou || tou.dead || tou.hidden || tou.fused) return null;
  if (tou.dying && !tou.upOnShp) return null;
  if (typeof passiveOn === "function" && !passiveOn(tou)) return null;   // 放弃被动「决一死战」
  if (Number(u.zone) !== Number(tou.zone)) return null;
  // 只数和灯敌对的单位：中立生物、友军不算（自己也不会被牵制）
  const enemies = touDuelEnemies();
  // 决一死战+：同区两名以下的敌人都必须攻击灯
  const cap = typeof passivePlus === "function" && passivePlus(tou, 1) ? 2 : 1;
  if (enemies.length < 1 || enemies.length > cap || !enemies.some(x => x.id === u.id)) return null;
  return tou;
}

function shouldDiceMin(attacker) {
  // 决一死战+：两名敌人时也会被吸引火力，但只有单个敌人时掷骰才取最低
  return !!touDuelVictim(attacker) && touDuelEnemies().length === 1;
}
/** 灯所在区里的敌人 */
function touDuelEnemies() {
  const tou = findKit("tou", state.units);
  if (!tou) return [];
  return (typeof fieldUnits === "function" ? fieldUnits() : state.units).filter(x =>
    x && !x.isPlayer && !x.dead && !x.hidden && !x.fused && Number(x.zone) === Number(tou.zone) && hostileTo(tou, x));
}
/** 圣盾荣耀+：消耗圣盾点时为自身恢复 2d10 生命 */
function touShieldHeal(u) {
  if (!u || u.kit !== "tou" || typeof passivePlus !== "function" || !passivePlus(u, 2)) return;
  const r = takeDice(2, 10, 0);
  const got = healUnit(u, r.total);
  appendLog(`圣盾荣耀+：${u.name} 消耗圣盾，恢复 ${r.text} → ${got} 生命。`);
}

function shieldBearer(target) {
  if (!target) return null;
  const tou = findKit("tou", state.units);
  if (!tou || !tou.resources || !(tou.resources.shield > 0)) return null;
  // 圣盾荣耀：「对年糕也生效」——年糕在场时灯必然空手，所以年糕不看灯有没有持械（以前先判空手就返回，年糕永远用不上）
  if (target.kit === "mochi") return tou;
  if (target.kit === "tou" && tou.weaponHeld !== false) return tou;   // 空手无法使用圣盾点
  return null;
}

function applyCombat(target, result, attacker) {
  if (typeof isDownProtected === "function" && isDownProtected(target)) {
    return [`${target.name} 濒死倒地，起身之前不受任何伤害。`];
  }
  const notes = [];
  if (!result || !result.ok || !target) return notes;
  if (isUfoLeg(target)) clearUfoLegStun(target);
  if (target.kit === "watchcrow" && target.resources && target.resources.reflect && (result.total || 0) > 0 && attacker && isCombatAttack(attacker, result.flags || {})) {
    target.resources.reflectReady = result.total;
    target.resources.reflect = false;
  }
  // 牵挂：结人还能战斗时才代扛（死了 / 倒地没起身 / 不在场的不扛，以前照扛，被牵挂的人永远不失衡）
  const yuito = state.units.find(u => u.kit === "yuito" && u.resources && u.resources.bondId === target.id &&
    !u.dead && !u.hidden && !u.fused && !(u.dying && !u.upOnShp));
  if (yuito && result.broke && result.breakDealt > 0) {
    const taken = result.breakDealt;
    result = clone(result);
    result.breakDealt = 0;
    result.broke = false;
    result.defAfter = result.defBefore;
    yuito.def = Math.max(0, (Number(yuito.def) || 0) - taken);
    if (yuito.def <= 0) yuito.stunned = true;
    notes.push(`牵挂：结人代为承受 ${taken} 击破（结人架势 ${yuito.def}）`);
    if (yuito.def <= 0) {
      notes.push(imbalanceLine(yuito));
      queueAssistAttack(attacker, yuito);
    }
  }
  if (target.kit === "bandit_boss" && typeof checkMutiny === "function") {
    const mutinyNote = checkMutiny(state);
    if (mutinyNote) notes.push(mutinyNote);
  }
  const shieldBefore = (target.layers || []).filter(l => l.type === "shield").reduce((s, l) => s + Number(l.current || 0), 0);
  let aggOuterBefore = 0, aggArmorBefore = 0;
  if (target.kit === "sand_aggregate") {
    const outerL = (target.layers || [])[0];
    const armorL = (target.layers || []).find(l => l.type === "armor");
    aggOuterBefore = outerL && outerL.type === "sand" ? Number(outerL.current) || 0 : 0;
    aggArmorBefore = armorL ? Number(armorL.current) || 0 : 0;
  }
  const flyingBeforeHit = !!target.flying;
  notes.push(...applyResultToUnit(target, result, attacker));
  // 深渊上空被击落：击落的 20% 之外再坠入深渊失去 10%（共 30% 最大生命），并离开深渊
  if (flyingBeforeHit && !target.flying) applyAbyssFall(target, null, notes);
  markPartyHurt(target, result);
  maybeUnstableTrip(target, notes, attacker);
  if (target.kit === "ufo_leg") {
    target.stunned = false;
    target.def = 0;
    const body = ufoBodyOf(target);
    if (body && (result.breakDealt || 0) > 0) {
      const before = Number(body.def) || 0;
      body.def = Math.max(0, before - result.breakDealt);
      notes.push(`机械足击破转移至本体：${before} → ${body.def}`);
      notes.push(...registerZoneBreak(body.zone, result.breakDealt));
      if (body.def <= 0 && !body.stunned) {
        body.stunned = true;
        notes.push(imbalanceLine(body));
        queueAssistAttack(attacker, body);
      }
    }
    if (isInnerDepleted(target) && !target._legBroke) {
      target._legBroke = true;
      target.dead = true;
      notes.push(`${target.name} 被摧毁，立刻对本体造成 1 击破。`);
      if (body) {
        const before = Number(body.def) || 0;
        body.def = Math.max(0, before - 1);
        notes.push(`本体架势 ${before} → ${body.def}`);
        notes.push(...registerZoneBreak(body.zone, 1));
        if (body.def <= 0 && !body.stunned) {
          body.stunned = true;
          notes.push(imbalanceLine(body));
          queueAssistAttack(attacker, body);
        }
      }
    }
    if (body) {
      syncUfoBody(body);
      const left = ufoLivingLegs(body).length;
      notes.push(`飞碟触灵剩余机械足 ${left}。`);
      if (left <= 0 && !body._xpGiven) {
        body.dead = true;
        if (attacker && attacker.isPlayer) body._lastHitBy = attacker.id;
        // 和别的首领一样走击杀结算：首领击杀分、跑团经验倍率、掉落（以前直接发经验，这些都漏了）
        settleEnemyKill(body, notes);
        notes.push("全部机械足被摧毁，飞碟触灵死亡。");
      }
    }
  }
  const flags = result.flags || {};
  if (target.statuses && target.statuses.shock && isCombatAttack(attacker, flags)) {
    const realPulses = (result.perHit && result.perHit.length)
      ? result.perHit.filter(h => (Number(h.dealt) || 0) > 0).length
      : ((result.total || 0) > 0 ? 1 : 0);
    for (let i = 0; i < realPulses; i++) notes.push(...shockPulse(target));
  }
  if (target.kit === "ufo_body" && result.ok && (result.intended || result.total)) {
    const raw = result.intended || result.total;
    notes.push(...drainUfoLegs(target, raw));
    if (target.dead && !target._xpGiven) settleEnemyKill(target, notes);
  }
  checkHighBoom(target);
  const shieldAfter = (target.layers || []).filter(l => l.type === "shield").reduce((s, l) => s + Number(l.current || 0), 0);
  if (shieldBefore > 0 && shieldAfter <= 0) notes.push(...triggerMagnetShield(target));
  if (target.kit === "ironwall" && totalHp(target) <= 0 && !target._brokeWall) {
    target._brokeWall = true;
    const c = findKit("chuan", state.units);
    if (c) {
      c.def = Math.max(0, (c.def || 0) - 3);
      notes.push(`铁壁被击破，川川受到 3 击破 → 架势 ${c.def}`);
      if (c.def <= 0) {
        c.stunned = true;
        notes.push(imbalanceLine(c));
        if (typeof endSelfOnStun === "function") endSelfOnStun(c, notes);
        if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(c, notes);
        queueAssistAttack(null, c);
      }
    }
  }
  if (target.kit === "sand_aggregate" && !target.dead) {
    target.resources = target.resources || {};
    const outerL = (target.layers || [])[0];
    const armorL = (target.layers || []).find(l => l.type === "armor");
    const ph = target.resources.phase || 1;
    if (ph === 1 && aggOuterBefore > 0 && outerL && outerL.type === "sand" && outerL.current <= 0) {
      outerL.max = 0;
      dealBreak(target, 1, "physical", notes, "沙壳破碎");
      target.resources.phase = 2;
      target.name = "沙灵聚合体·机械躯";
      notes.push("外层沙壳破碎，进入二阶段。");
      if (typeof aggDisarmSpread === "function") aggDisarmSpread(target, notes);
      if (typeof aggArmCannon === "function") aggArmCannon(target, notes);
    }
    const ph2 = target.resources.phase || 1;
    if (ph2 === 2 && aggArmorBefore > 0 && armorL && armorL.current <= 0) {
      if (armorL) armorL.max = 0;
      target.resources.phase = 3;
      target.name = "沙灵聚合体·核心";
      notes.push("装甲被击破，进入三阶段。");
      if (typeof aggDisarmCannon === "function") aggDisarmCannon(target, notes);
    }
  }
  notes.push(...sweepDeadEnemies());
  if (target.def <= 0 && result.broke && !target.noPosture && target.kit !== "ufo_leg") notes.push(imbalanceLine(target));
  // 圣盾：真的受到伤害才扣（免疫、被挡下、伤害为 0 时不扣）
  if (result.flags && result.flags.holyShield && ((Number(result.total) || 0) > 0 || (Number(result.shpDealt) || 0) > 0)) {
    const tou = shieldBearer(target) || findKit("tou", state.units);
    if (tou && tou.resources && tou.resources.shield > 0) {
      tou.resources.shield -= 1; touShieldHeal(tou);
      notes.push(`圣盾 −1 → ${tou.resources.shield}`);
    }
  }
  if (result.broke && target.resources && target.resources.mecha) {
    notes.push(...exitMecha(target, "被击落，机甲解除"));
  }
  if (!target.isPlayer && isInnerDepleted(target) && !target._xpGiven) settleEnemyKill(target, notes);
  // 我方倒地：统一走 applyKnockdown（起身中的坚毅生命已在 applyResultToUnit 里扣过，这里不再扣）
  if (target.isPlayer) applyKnockdown(target, notes);
  // 双相冲动：诺拉或维塔斯击杀单位后翻一次面
  if (attacker && (attacker.kit === "nora" || attacker.kit === "vitas") && (typeof passiveOn !== "function" || passiveOn(attacker)) &&
      (target.dead || (target.isPlayer && target.dying)) && !target._noraKillCounted) {
    target._noraKillCounted = true;
    flipMood(noraOf(), notes, "击杀");
  }
  if (target.dead && typeof clearPierce === "function" && isPierced(target)) clearPierce(null, notes, "（目标倒下）", target);
  if (target.def <= 0 && (result.broke || target.stunned) && !target.noPosture && target.kit !== "ufo_leg") {
    queueAssistAttack(attacker, target);
  }
  bossQuickRecover(target, notes);   // 首领 / 精英：标记没攒满的失衡，协助攻击排上队后立刻恢复架势
  if (attacker && attacker.self === "burn" && result.element === "fire") {
    const raw = Number(result.intended || result.total) || 0;
    const st = selfBurnStacksOf(attacker);
    if (raw > 0) {
      const n = Math.floor(raw * 0.2 * st);
      const got = healUnit(attacker, n, { selfBurn: true });
      notes.push(attacker.upOnShp && shpHidden()
        ? `${attacker.name} 自焚×${st}：火焰伤害 +${10 * st}%，吸血恢复了一些坚毅生命`
        : `${attacker.name} 自焚×${st}：火焰伤害 +${10 * st}%，吸血 ${20 * st}% × ${Math.floor(raw)} = ${n}，回复 ${got}${attacker.upOnShp ? "（SHP）" : ""}`);
    }
  }
  // 晕眩后自我效果结束（所有自我效果；蓄能累积的高能值不清零）。攻击者被猛击反震打进失衡的，在 dealTo 结算完这一击后结束
  if (typeof endSelfOnStun === "function") endSelfOnStun(target, notes);
  if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(target, notes);
  // 死刑：被标记的人倒下了 → 立刻转标
  if (typeof bossMechSync === "function") bossMechSync(notes);
  if (typeof raceAfterHurt === "function") raceAfterHurt(target, result, attacker, notes);   // 易怒蛮牛（enemies.js）
  return notes;
}

function applyNeutralize(u) {
  const notes = [`【中和】结算 ${u ? u.name : "？"}`];
  if (!u) return notes;
  popStatus(u, "neutralize");
  if (typeof selfImmunities === "function") selfImmunities(u, notes);   // 自我效果免疫的状态（自焚的灼烧、霜结的冻伤……）本来就不在身上
  const st = u.statuses || {};
  const keys = [];
  if ((Number(st.burn) || 0) > 0) keys.push("burn");
  if (st.corr) keys.push("corr");
  if (st.shock) keys.push("shock");
  // 高能：只认高能状态。蓄能（自我效果）攒的高能值不是高能状态，中和不会把它当高能引爆
  if (st.high) keys.push("high");
  if (st.frostbite) keys.push("frostbite");
  if (st.shockwave) keys.push("shockwave");
  if (st.reso) keys.push("reso");
  const n = keys.length;
  const bonus = Math.max(0, n - 1) * 0.07;
  if (n > 1) notes.push(`属性状态 ${n} 个，中和整体伤害 +${Math.round(bonus * 100)}%。`);
  // 加倍计量：状态此回合效果翻倍，中和的结算也翻倍
  const sm = statusMult(u);
  if (sm > 1) notes.push(`加倍计量：${u.name} 的状态结算翻倍。`);
  const scale = (v) => Math.floor((Number(v) || 0) * (1 + bonus)) * sm;
  u._resoFull = !!st.reso;

  if (keys.indexOf("burn") >= 0) {
    const stacks = Math.max(1, Math.floor(Number(st.burn) || 1));
    const d = statusDotDice("burn", u.level || 1, currentWeatherFor(u));
    const raw = stacks * d.s;
    const dmg = scale(raw);
    applyTypedDot(u, dmg, "fire", notes, `${u.name} 中和灼烧（${stacks}×d${d.s}最大=${raw}）`);
    st.burn = 0;
  }
  if (keys.indexOf("corr") >= 0) {
    const armored = (u.layers || []).some(l => l.type === "armor");
    const d = statusDotDice("corr", u.level || 1, currentWeatherFor(u), armored, envMult(u));
    const raw = d.n * d.s;
    const dmg = scale(raw);
    applyTypedDot(u, dmg, "acid", notes, `${u.name} 中和腐蚀（${d.n}d${d.s}最大=${raw}）`);
    st.corr = false;
  }
  if (keys.indexOf("shock") >= 0) {
    const d = statusDotDice("shock", u.level || 1, currentWeatherFor(u));
    const raw = Math.max(d.min || 1, d.s + (d.bonus || 0));
    const dmg = scale(raw);
    notes.push(`${u.name} 中和感电：立刻触发一次（最大 ${raw}）。`);
    const allies = fieldUnits().filter(o =>
      !o.dead && !o.hidden && !ignoresAoe(o) &&
      Number(o.zone) === Number(u.zone) && !!o.isPlayer === !!u.isPlayer
    );
    allies.forEach(o => applyTypedDot(o, dmg, "electric", notes, `${o.name} 被中和感电波及`));
    const shields = (u.layers || []).filter(l => l.type === "shield" && Number(l.current) > 0);
    if (shields.length) {
      shields.forEach(l => { l.current = 0; });
      u._shieldRestoreAtTurnEnd = true;
      notes.push(`${u.name} 护盾因中和感电立刻失效，下回合结束回满。`);
    }
    st.shock = false;
  }
  if (keys.indexOf("high") >= 0) {
    notes.push(`${u.name} 中和高能：立刻自爆（无视血线）。`);
    explodeHigh(u);
    st.high = false;
  }
  if (keys.indexOf("frostbite") >= 0) {
    dealBreak(u, 2 * sm, "ice", notes, "中和冻伤");
    st.frostbite = false;
  }
  if (keys.indexOf("shockwave") >= 0) {
    dealBreak(u, 2 * sm, "physical", notes, "中和震荡");
    st.shockwave = false;
    if (typeof syncShockwave === "function") syncShockwave(u, notes);
  }
  if (u.self && u.self !== "none") {
    notes.push(`${u.name} 自我效果「${selfName(u.self)}」被中和清除（无额外结算）。`);
    u.self = "none";
    u.selfBurnStacks = 0;
    if (typeof syncFrenzyPosture === "function") syncFrenzyPosture(u, notes);   // 狂暴扣的架势上限还回去
  }
  if (keys.indexOf("reso") >= 0) {
    st.reso = false;
    notes.push(`${u.name} 共振在中和结算伤害完整生效后被清除。`);
  }
  u._resoFull = false;
  u.statuses = st;
  return notes;
}

function grantBurn(u, n, notes) {
  if (!u) return;
  if (u.self === "burn") {
    if (notes) notes.push(`${u.name} 自焚：免疫灼烧。`);
    return;
  }
  u.statuses = u.statuses || {};
  u.statuses.burn = (Number(u.statuses.burn) || 0) + (n || 1);
  popStatus(u, "burn");
}

function explodeBoomcar(target, notes) {
  if (!target || target._exploded) return;
  target._exploded = true;
  const half = Math.floor((target.atk || 0) / 2);
  notes.push(`${target.name} 死亡引爆：同区 ${half} 能量 + 1 击破。`);
  markAoeZone(target.zone, { element: "energy", dmg: half, attacker: target });
  // 画面：在小车身上炸开（震屏、爆炸声、爆炸形状、「引爆」字样；game.js · playTape、online-ui.js · playPacket、hd2d/hd2d-play.js 的 carboom）
  spawnPopup(target, { kind: "carboom", text: "引爆", element: "energy" });
  // 同区不分敌我的范围伤害（不能协助格挡）。画面上和高能自爆的余波一样标成爆炸（tag "boom"：数字放大、停久一点），
  // 不算进打死它的那次攻击的演出（game.js · strikePlan 跳过这些弹字）
  const prevTag = state.popTag;
  state.popTag = "boom";
  try {
    state.units.filter(u => !u.hidden && !u.dead && !u._removed && u.id !== target.id && Number(u.zone) === Number(target.zone)).forEach(u => {
      const fake = unitOf("小车残骸", target.level, [{ type: "armor", hp: 1 }], 0, 0);
      fake.zone = target.zone;
      dealTo(fake, u, { atk: 0, mult: 0, flat: half, element: "energy", baseBreak: 1, flags: { action: true, aoe: true } });
    });
  } finally { state.popTag = prevTag || null; }
}

/** 这场战斗出现过的所有单位：场上的 + 被打倒后已经移出场的（removeEnemyFromField 登记在 state.goneFoes）。
 *  战后掉落（enemyDropFoes）、图鉴（bestiaryRecordBattle）都读这份 */
function battleFoesSeen() {
  const units = state.units || [];
  const gone = (Array.isArray(state.goneFoes) ? state.goneFoes : []).filter(g => !units.some(x => x.id === g.id));
  return units.concat(gone);
}
function removeEnemyFromField(u, notes) {
  if (!u || u.isPlayer || u._removed) return;
  u._removed = true;
  u.dead = true;
  u.hidden = false;
  // 打倒当下就登记（不等 3 秒后移出场）：战后掉落、图鉴还要算到它（#340 第 18 条）。
  // 这 3 秒里 state 可能被预演 / 撤销换成拷贝、连续战斗换区域时 state.units 也会整份换掉，所以不能放进计时器。同一个 id 只留最新的一份
  state.goneFoes = (Array.isArray(state.goneFoes) ? state.goneFoes : []).filter(g => g.id !== u.id).concat([u]);
  notes.push(`${u.name} 被击杀。`);
  if (state.selectedId === u.id) state.selectedId = null;
  if (state.attackerId === u.id) state.attackerId = null;
  if (state.targetId === u.id) state.targetId = null;
  const id = u.id;
  const drop = () => {
    // 只清掉仍处于「已击杀」的那个；中途撤销复活回来的单位不能被这个计时器误删
    state.units = (state.units || []).filter(x => !(x.id === id && x._removed));
    renderAll();
  };
  // 一记重击打死的，铭牌多停一会儿再淡出（重击的标记可能在这之后才打上，所以到点再看）
  setTimeout(() => (u.killBig ? setTimeout(drop, 1900) : drop()), 3000);
}

/** 敌人内层归零：记死亡、发经验与掉落，以及个别 BOSS 的连带效果。只结算一次。 */
function isOutlawThugKit(kit) {
  return /^thug_/.test(kit || "");
}

function settleEnemyKill(target, notes) {
  if (!target || target.isPlayer || target._xpGiven) return;
  if (target._revived) { target.dead = true; target._xpGiven = true; return; }   // 复活过的陨体衍蛛：再死不给经验、掉落、击杀分
  if (typeof isNeutralCreature === "function" && isNeutralCreature(target)) {   // 中立生物：没有经验、掉落、击杀分
    target.dead = true; target._xpGiven = true;
    if (notes && !target._eaten) notes.push(`${target.name} 死了。`);
    return;
  }
  if (typeof desertOnDeath === "function") desertOnDeath(target, notes);   // 领潮沙鱼：母系溃散
  if (typeof playerAllied === "function" && playerAllied(target)) {   // 友军倒下：没有经验、掉落、击杀分
    target.dead = true; target._xpGiven = true;
    if (notes) notes.push(`友军 ${target.name} 倒下了。`);
    return;
  }
  // 友军（跑团模板「同阵营」）在敌人回合打死的敌人：没有经验、掉落、击杀分（和中立生物一样，只算战斗进度）
  if (!unitById(target._lastHitBy)) {
    const acc = state.actionAcc, who = acc && acc.actorIsPlayer === false ? unitById(acc.actorId) : null;
    if (who && typeof playerAllied === "function" && playerAllied(who)) {
      target.dead = true; target._xpGiven = true;
      if (notes) notes.push(`${target.name} 被友军 ${who.name} 打倒了。`);
      return;
    }
  }
  target.dead = true;
  target._xpGiven = true;
  // 战场数据：击杀算最后一个伤害过它的玩家（_lastHitBy，各条死亡路径在造成伤害时记下）；
  // 只被敌人 / 友军 / 中立生物打过的，不算任何玩家的击杀。不再回落到「当前行动者」（回合结束的死亡会记错人）
  {
    const killer = unitById(target._lastHitBy);
    const st = battleStat(killer);
    if (st) st.kills += 1;
    // 评分：敌人倒下就算（谁打的都算全队的分；能归到人的记在那个人身上）
    if (target.kit !== "ironwall") addScore("kill", SCORE_RULES.kill[enemyRankOf(target)] || SCORE_RULES.kill.minion, killer, Number(target._killBonus) || 0);
    if (typeof minerDeathTransfer === "function") minerDeathTransfer(target, killer, notes);   // 陨石开采机：高能转给杀它的人
  }
  const rank = ENEMY_RANK[target.kit] || "minion";
  // 跑团模式：手册「遭遇战敌人先动，经验双倍；困难遭遇三倍」，由主持人在战斗顶栏选
  const mult = typeof TRPG !== "undefined" && TRPG.active ? Math.max(1, Number(state.xpMult) || 1) : 1;
  const amt = xpDrop(rank, target.level) * mult;
  grantXpToPlayers(amt, `击杀 ${target.name}${mult > 1 ? ` · 经验 ×${mult}` : ""}`);
  let loot = typeof rollEnemyLoot === "function" ? rollEnemyLoot(target) : (target.kit === "patrol_car" ? 30 : 0);
  if (typeof desertLootMult === "function") loot = Math.round(loot * desertLootMult(target));   // 富集个体：奎支 ×5
  if (typeof desertEnrichedDrops === "function") desertEnrichedDrops(target, notes);          // 富集个体：武器升级材料
  if (loot > 0 && state.battleGains) state.battleGains.kuizhi += loot;
  if (loot > 0 && typeof addKuizhi === "function") addKuizhi(loot, notes, target.name);
  else if (target.kit === "patrol_car") {
    state.kuizhi = (Number(state.kuizhi) || 0) + 30;
    notes.push(`掉落 30 奎支（累计 ${state.kuizhi}）。`);
  }
  if (target.kit === "outlaw_king" && target.resources && target.resources.hostage) {
    const boss = findKit("bandit_boss", state.units);
    if (boss && boss.resources && boss.resources.mutinied && !boss.dead) {
      boss.atk = (Number(boss.atk) || 0) * 2;
      boss.def = (Number(boss.def) || 0) * 2;
      boss.defMax = (Number(boss.defMax) || boss.def) * 2;
      boss.resources.promoted = true;
      target.resources.hostage = false;
      boss.name = "亡命之王（" + boss.name + "）";
      notes.push(`${boss.name} 晋升为新任亡命之王：atk/def 翻倍。`);
    }
  }
  if (target.kit === "bandit_boss" && target.resources && target.resources.mutinied) {
    const king = findKit("outlaw_king", state.units);
    if (king && king.resources && king.resources.hostage && !king.dead) {
      king.resources.hostage = false;
      notes.push(`挟持者已死，${king.name} 恢复行动。`);
    }
  }
  // 手下被打倒：王下次行动改成回防命令（ai.js，KING_CFG.hold.cooldown 回合内最多一次）
  // 手下 = 狂徒和强盗头子（README：回防命令）
  if (isOutlawThugKit(target.kit) || target.kit === "bandit_boss") {
    const king = findKit("outlaw_king", state.units);
    if (king && !king.dead) { king.resources = king.resources || {}; king.resources.crewDown = true; }
  }
  if (isOutlawThugKit(target.kit) && typeof mutinyTick === "function") mutinyTick(notes);
}

function sweepDeadEnemies() {
  const notes = [];
  if (typeof deathStatueSweep === "function") deathStatueSweep(notes);   // 被沙珊瑚缠住时死掉的：留下死亡雕像
  if (typeof vehicleSweep === "function") vehicleSweep(notes);   // 载具：驾驶员倒下换人，装甲打空殉爆（vehicle.js）
  const list = (state.units || []).slice();
  list.forEach(u => {
    if (!u || u.isPlayer || u._removed) return;
    if (u.kit === "ironwall") return;
    const hpGone = isInnerDepleted(u) || !!u.dead;
    if (!hpGone) return;
    if (u.kit === "livesand" && !(u.resources && u.resources.giant) && !u._sandAbsorbed) {
      notes.push(...absorbSandsInto(u));
      if (!isInnerDepleted(u) && !u.dead) return;
    }
    // 自爆小车正在挨打死它的那一击（dealToInner · holdBoom）：等那一下的弹字出来再炸
    if (u.kit === "boomcar") { if (u._holdBoom) u._boomPending = true; else explodeBoomcar(u, notes); }
    if (u.kit === "ufo_body") {
      ufoAllLegs(u).forEach(leg => {
        if (leg && !leg._removed) {
          (leg.layers || []).forEach(l => { l.current = 0; });
          removeEnemyFromField(leg, notes);
        }
      });
    }
    if (u.kit === "ufo_leg") {
      const body = typeof ufoBodyOf === "function" ? ufoBodyOf(u) : null;
      if (body && ufoLivingLegs(body).filter(x => x.id !== u.id && !x._removed).length <= 0) {
        body.dead = true;
        notes.push("全部机械足被摧毁，飞碟触灵死亡。");
        if (!body._xpGiven) settleEnemyKill(body, notes);   // 击杀结算（首领击杀分、跑团经验倍率、掉落）
        removeEnemyFromField(body, notes);
      }
    }
    if (typeof alienOnDeath === "function" && alienOnDeath(u, notes)) return;   // 微光下的陨体衍蛛：留在场上等复活
    removeEnemyFromField(u, notes);
  });
  return notes;
}

function visibleEnemies(zone) {
  return state.units.filter(u => !u.hidden && !u._removed && !u.isPlayer && Number(u.zone) === Number(zone));
}

function skillTarget() {
  const drop = uiEl("skillTargetSel");
  const id = state.targetId || (drop && drop.value);
  return unitById(id);
}

function propByRef(id) {
  if (!id) return null;
  const raw = String(id).replace(/^prop:/, "");
  return (state.props || []).find(p => p.id === raw || ("prop:" + p.id) === String(id)) || null;
}

function skillTargetAny() {
  const drop = uiEl("skillTargetSel");
  const id = state.targetId || (drop && drop.value);
  return unitById(id) || propByRef(id);
}

function isDisplaceSkill(id) {
  return [
    "bili_magnet", "mint_banish", "mochi_roar", "role_pull",
    "berniel_dash", "mochi_pounce", "en_dust_lift", "en_live"
  ].indexOf(id) >= 0;
}

function canDisplace(obj) {
  if (!obj) return false;
  if (obj.kind) return obj.movable !== false;
  if (obj.self === "anchor") return false;                          // 千钧：免受其他单位的位移效果
  if (obj.resources && obj.resources.frostShell) return false;      // 再次霜结：免受位移
  if (obj.entangled) return false;                                  // 被沙珊瑚缠住：位移也带不走
  return !obj.noMove;
}

/** opts.flyOver：带飞行 / 跃过描述的技能带着走，越过空隙不会掉下去 */
function displaceTo(obj, dest, notes, reason, opts) {
  dest = Number(dest);
  if (!obj) return false;
  if (!canDisplace(obj)) {
    notes.push(`${obj.name} 无法被移动。`);
    return false;
  }
  const from = Number(obj.zone);
  if (from === dest) return true;
  // 被推 / 拉也要过间隔：危墙、关着的门推不过去；推进空隙的地面单位坠落（失去 10% 最大生命）、配置物掉下去，
  // 移动都不生效；过不稳桥梁的地面单位照常让桥 −1d6
  const crossing = [];
  if (!crossGapsForced(obj, from, dest, crossing, true, !!(opts && opts.flyOver))) {
    notes.push(...crossing);
    return false;
  }
  obj.zone = dest;
  notes.push(`${obj.name}${reason ? " " + reason : " 被移动"}：${from} 区 → ${dest} 区。`, ...crossing);
  if (!obj.kind) waveMoved(obj, forcedPath(from, dest) || [from, dest], notes);   // 被推 / 拉 / 击退过驻波墙也算
  quicksandAfterZoneChange(obj, notes, "被带出流沙");
  if (!obj.kind) obj._pushedTurn = state.turnNo;   // 伏咬沙鱼：这回合被推过的猎物多 1 击破
  if (!obj.kind && typeof ambushOnEnter === "function") ambushOnEnter(obj, notes);   // 被推进伏咬沙鱼的区
  enterFrozenGround(obj, notes);
  applyAbyssFall(obj, from, notes);
  if (!obj.kind) chaseFollow(obj, notes);   // 被推走也算移动：紧追的人跟上
  if (!obj.kind && typeof hunterAfterMove === "function") hunterAfterMove(obj, notes);   // 蚁型特殊剿灭兵种：被推进它的区也会退开
  if (!obj.kind && typeof dormantAfterMove === "function") dormantAfterMove(obj, notes);   // 休眠的敌人：被推进它的区也会醒
  return true;
}

function movablePropsInZone(zone) {
  return (state.props || []).filter(p => Number(p.zone) === Number(zone) && p.movable !== false);
}

function selectedToken() {
  const drop = uiEl("skillTargetSel");
  return state.targetId || (drop && drop.value) || "";
}

function lineBlocked(aZone, bZone) {
  aZone = Number(aZone); bZone = Number(bZone);
  if (aZone === bZone) return false;
  // 有一条同样短、中间没有危墙 / 关着的机关门的路线就不算挡住（直排只有一条路线，和以前一样）
  const why = (a, b) => {
    const g = getGap(a, b);
    if (g.type === "wall") return "危墙挡住，无法影响对面。";
    if (g.type === "door" && !g.open) return "关闭的机关门挡住，无法影响对面。";
    return null;
  };
  const free = zonePath(aZone, bZone, (a, b) => !why(a, b));
  const any = zonePath(aZone, bZone);
  if (free && any && free.length <= any.length) return false;
  if (!any) return false;
  for (let i = 0; i < any.length - 1; i++) { const w = why(any[i], any[i + 1]); if (w) return w; }
  return false;
}

/** 破釜沉舟看谁身上的状态：玩家唤出的武器人跟着持有者（攻击双倍、受伤翻倍都一样） */
function gambitRes(u) {
  if (!u) return {};
  const owner = u.weaponOf && typeof weaponOwnerUnit === "function" ? weaponOwnerUnit(u) : null;
  return (owner ? owner.resources : u.resources) || {};
}

function makeDealFlags(extra) {
  const flags = Object.assign({ action: true, block: "none" }, extra || {});
  return flags;
}

function recoverFromStun(u, notes) {
  if (!u || !u.stunned) return;
  notes = notes || [];
  // 击破预告：窗口里被打进过失衡就算成功（玩家回合打进的失衡在敌人回合开始就恢复了，回合结束时已不是失衡）
  if (u.instant && u.instant.omenArmed) u.instant.omenHit = true;
  u.stunned = false;
  if (typeof featUnbowedReset === "function") featUnbowedReset(u);   // 决不后退：晕眩后重置
  u._imbalanceLock = false;
  u._bossMarked = false;
  u._bossRefill = false;
  if (u.noPosture || u.kit === "ufo_leg") return;
  if (typeof canRestorePosture === "function" && !canRestorePosture(u)) {
    notes.push(`${u.name} 晕眩结束。千钧：无法恢复架势。`);
    return;
  }
  const cap = typeof postureCap === "function" ? postureCap(u) : (Number(u.defMax) || 0);
  if (cap > 0) {
    u.def = cap;
    notes.push(`${u.name} 晕眩结束，架势回满 ${u.def}/${u.defMax}。`);
  } else {
    notes.push(`${u.name} 晕眩结束。`);
  }
}

/** 遭遇战（长休时被偷袭）：我方跳过第一回合，不拿行动点和附赠动作 */
function ambushSkipRound() {
  return !!state.ambush && (Number(state.turnNo) || 1) <= 1;
}
/** 附赠动作的惩罚（玩家、敌人共用，所有加成算完之后调用）：
 *  不稳 −1（触发一次后消失）、空手格挡成功后的下一回合 −1；两个都有 −2；最少 0 */
function applyBonusPenalties(u, bonus, notes) {
  // 所有加成（含剑术+ 留下的、载具驾驶员最少 1）都算完以后再扣；最少扣到 0，日志写实际扣掉的数
  bonus = Math.max(0, Number(bonus) || 0);
  const take = (label) => {
    const n = Math.min(1, bonus);
    bonus -= n;
    if (notes) notes.push(n > 0 ? `${u.name} ${label}：这回合附赠动作 −${n}。` : `${u.name} ${label}：本来就没有附赠动作，没有可扣的。`);
  };
  if (u.statuses && u.statuses.unstable) { u.statuses.unstable = false; take("不稳"); }
  if (u.loseBonusNext) { u.loseBonusNext = false; take("空手格挡"); }
  return bonus;
}
function refreshEconomy(u) {
  if (!u || !u.isPlayer) return;
  if (u.resources) delete u.resources.apGifts;   // 回合开始重新补行动点：上回合没用掉的赠送作废
  // 肉体操控（沙灵聚合体三阶段）：这一回合失去行动点（附赠动作照常）。标记只管一回合，不管这回合能不能行动都用掉
  const loseAp = !!u.loseApNext;
  u.loseApNext = false;
  if (u.escort) { u.ap = 0; u.apMax = 0; u.bonus = 0; u.bonusMax = 0; return; }   // 护送对象玩家不能操作
  if (typeof isCrushing === "function" && isCrushing(u)) {
    u.ap = 0; u.apMax = 0; u.bonus = 0; u.bonusMax = 0;
    return;
  }
  if (u.stunned || ambushSkipRound()) {
    u.ap = 0;
    u.apMax = 0;
    u.bonus = 0;
    u.bonusMax = 0;
    return;
  }
  let ap = isSoloHero(u) ? soloCfg().apPerRound : 1, bonus = 1;   // 单人模式：主角每回合 2 行动点
  const iso = state.fields[u.zone] && state.fields[u.zone].isolate;
  if (!iso && state.weather === "sand") {
    const w = sandWind(u.zone, state.zoneMode, state.sandDir);
    if (u.flying && w > 0) ap += 1;
    if (u.flying && w < 0) ap -= 1;
    if (!u.flying && w > 0) bonus += 1;
  }
  if (state.fields[u.zone] && state.fields[u.zone].energy) ap += 1;
  if (typeof featAlertBonus === "function") bonus += featAlertBonus(u);   // 警戒（feats.js）：每场第一回合 +1 附赠
  if (typeof bpEconomy === "function") ({ ap, bonus } = bpEconomy(u, { ap, bonus }));   // 单局图纸
  // 剑术+：上回合切换刀势得到、还没用掉的附赠动作留到这一回合（这一回合结束时过期）；也是加成，在扣之前加
  const carry = u.resources && u.resources.stanceCarry;
  if (carry && carry.turn === Number(state.turnNo)) {
    bonus += carry.n;
    u.resources.stanceCarry = null;
  }
  bonus = applyBonusPenalties(u, bonus);   // 所有加成算完再扣：不稳、空手格挡各 −1
  if (loseAp) ap = 0;
  u.ap = Math.max(0, ap);
  u.apMax = u.ap;
  u.bonus = Math.max(0, bonus);
  u.bonusMax = u.bonus;
}

function skillNameHint(id) {
  return id || "技能";
}

/** 「准备」的骰子：1 级 1d6，5 级 1d8，10 级 1d10，15 级 1d12 */
function prepDieSides(u) {
  return upgradeDieSides(6, milestone((u && u.level) || 1, 5));
}
/** 付不起这笔消耗的原因（没顶 / 行动点不足 / 附赠行动不足）；付得起返回 ""。只查不扣，不写日志 */
function costBlockReason(u, cost) {
  if (!u || !cost) return "";
  const ap = cost.ap || 0, bonus = cost.bonus || 0;
  if ((ap || bonus) && sinkLocked(u)) return "陷在流沙里没顶，不能行动";
  if (ap > (u.ap || 0)) return "行动点不足";
  if (bonus > (u.bonus || 0)) return "附赠行动不足";
  return "";
}
function spendAp(u, n, reason) {
  n = n || 1;
  if (!u) return true;
  if (sinkLocked(u)) { appendLog(`${u.name} 陷在流沙里没顶，无法${!reason || /^[a-z_:]+$/.test(reason) ? "行动" : reason}。`); return false; }
  if ((u.ap || 0) < n) {
    appendLog(`${u.name} 行动点不足（${u.ap || 0}/${u.apMax || 0}），无法${reason || "行动"}。`);
    return false;
  }
  u.ap -= n;
  if (inQuicksand(u)) u._sinkSpent = true;   // 流沙：这回合花过行动点，回合结束陷得更深
  syncBladeTwin(u);   // 绯秋两把刀的武器人共享行动点（佩刀）
  scoreSpend(u, n, 0);
  appendLog(logSinkActive()
    ? `  ${u.id === LOG_ACTOR_ID ? "" : u.name + " "}消耗 ${n} 行动点（剩 ${u.ap}/${u.apMax}）`
    : `${u.name} ${/^[a-z_]+$/.test(reason || "") ? "" : (reason || "") + "："}消耗 ${n} 行动点（剩 ${u.ap}/${u.apMax}）`);
  return true;
}

function spendBonus(u, n, reason) {
  n = n || 1;
  if (!u) return true;
  if (sinkLocked(u)) { appendLog(`${u.name} 陷在流沙里没顶，无法${!reason || /^[a-z_:]+$/.test(reason) ? "行动" : reason}。`); return false; }
  if ((u.bonus || 0) < n) {
    appendLog(`${u.name} 附赠行动不足（${u.bonus || 0}/${u.bonusMax || 0}），无法${reason || "行动"}。`);
    return false;
  }
  u.bonus -= n;
  syncBladeTwin(u);   // 绯秋两把刀的武器人共享附赠动作（佩刀）
  scoreSpend(u, 0, n);
  appendLog(logSinkActive()
    ? `  ${u.id === LOG_ACTOR_ID ? "" : u.name + " "}消耗 ${n} 附赠行动（剩 ${u.bonus}/${u.bonusMax}）`
    : `${u.name} ${/^[a-z_]+$/.test(reason || "") ? "" : (reason || "") + "："}消耗 ${n} 附赠行动（剩 ${u.bonus}/${u.bonusMax}）`);
  return true;
}

/** 高地（手册）：高地对低地的远程攻击 −10% 协助格挡，反之 +10%。看这一击实际是不是隔区的远程攻击
 *  （以前看单位卡上的 range，远近皆可的敌人隔区打不算）。atkRange：这一击的射程，近战（借机等）不算 */
function highlandBlockMod(helper, attacker, atkRange) {
  if (!helper || !attacker) return 0;
  if (atkRange === "melee") return 0;
  if (zoneDist(Number(attacker.zone), Number(helper.zone), Number(state.zoneMode)) < 1) return 0;
  const hf = state.fields[helper.zone] || {};
  const af = state.fields[attacker.zone] || {};
  const atkHigh = isHighGround(af);
  const helpHigh = isHighGround(hf);
  // 死亡雕像（desert.js）：同区有一座，挨隔区的远程攻击时协助格挡 +10%（几座都只算一次）
  const statue = typeof statueCoverIn === "function" && statueCoverIn(helper.zone) ? 10 : 0;
  if (atkHigh && !helpHigh) return -10 + statue;
  if (helpHigh && !atkHigh) return 10 + statue;
  return statue;
}

/** 最终协助格挡率，5%–100%；绯秋居合「必定成功」是 100%。
 *  atkRange：这一击的射程（给高地判断用，可不传） */
function finalBlockChance(helper, attacker, protectedUnit, atkRange) {
  if (helper.kit === "hiaki" && helper.resources && helper.resources.stance === "iai") return 100;
  if (helper.resources && helper.resources.standby) return 100;   // 丹生谷「待命」：下一次协助格挡必定成功
  let c = typeof blockChanceRaw === "function" ? blockChanceRaw(helper) : blockChance(helper);   // 先不封顶，加完修正再封顶
  if (c == null) c = 50;
  c += highlandBlockMod(helper, attacker, atkRange);
  if (attacker && Number(attacker.blockMalus) > 0) c -= Number(attacker.blockMalus);   // 赤牙霰弹枪：对这一枪的协助格挡 −40%
  if (attacker && Number(attacker.rushBlock) > 0) c += Number(attacker.rushBlock);       // 沙灵聚合体狂暴连打：每一击的协助格挡 +10%（AGG_RUSH）
  if (attacker && Number(attacker.ratExecBlock) > 0) c += Number(attacker.ratExecBlock); // 暴虐猎手斩杀：这一击的协助格挡 +5%（enemies.js · RAT_CFG.tyrant）
  if (helper.self === "anchor") c += 10;   // 千钧：格挡成功率 +10%
  if (helper.kit === "xiaoxiao" && protectedUnit && protectedUnit.kit === "longge") c += 15;   // 小朋友守护龙哥：60% → 75%
  if (helper.rallyBlock) c += helper.rallyBlock;
  if (typeof bpBlockBonus === "function") {
    // 单局图纸。格挡者拿着的图纸「协助格挡 +N%」算进武器格挡加成（WEAPON_BLOCK_CAP，目前不封顶）
    let bp = bpBlockBonus(helper, protectedUnit);
    const own = typeof bpMod === "function" ? Number(bpMod(helper).block) || 0 : 0;
    const cap = typeof WEAPON_BLOCK_CAP !== "undefined" ? WEAPON_BLOCK_CAP : Infinity;
    if (own > 0 && typeof heldWeaponBlockBonus === "function") bp -= Math.max(0, Math.min(own, heldWeaponBlockBonus(helper) + own - cap));
    c += bp;
  }
  if (typeof passivePlus === "function") {
    // 更换刀头+：电钻模式下柯尔特协助格挡 +10%
    if (helper.kit === "kolt" && (helper.resources || {}).bit !== "acid" && passivePlus(helper, 1)) c += 10;
    // 过度自信+：队友为柯尔特格挡 +10%
    if (protectedUnit && protectedUnit.kit === "kolt" && helper.id !== protectedUnit.id && passivePlus(protectedUnit, 2)) c += 10;
    // 佩刀+：丹生谷提供的、以及刀的武器人自己的协助格挡率 +10%
    if (helper.kit === "hiaki" && !isUnarmed(helper) && ((helper.resources || {}).blade || "niu") === "niu" && !(helper.resources || {}).niuOut && passivePlus(helper, 1)) c += 10;
    if ((helper.kit === "niu" || helper.kit === "naruto") && passivePlus(helper, 1)) c += 10;
    // 思念+：被牵挂的队友受到协助格挡保护时 +10%
    const yu = findKit("yuito", state.units);
    if (yu && protectedUnit && yu.resources && yu.resources.bondId === protectedUnit.id && passivePlus(yu, 2)) c += 10;
  }
  return Math.max(5, Math.min(typeof BLOCK_CHANCE_CAP !== "undefined" ? BLOCK_CHANCE_CAP : 100, c));
}

/* ---------- 力竭（手册第五章） ----------
 * 距上次长休 20 小时：无法再用坚毅生命起身；40 小时：atk −3，def −1；
 * 60 小时：被击倒后立刻死亡；80 小时：角色死亡（在推进时间时结算，见 ledger / rogue）。
 * 战斗里读 state.exhaustTier，由开战的那一方（单局 / 战斗原型）按当时的小时数设置。
 * 只作用于角色本人，武器人不受影响。 */
function exhaustTierOf(u) {
  if (!u || !u.isPlayer || (typeof isWeaponUnit === "function" && isWeaponUnit(u))) return 0;
  return Math.max(0, Number(typeof state !== "undefined" && state.exhaustTier) || 0);
}
function exhaustTierFromHours(h) {
  h = Number(h) || 0;
  return h >= 80 ? 4 : h >= 60 ? 3 : h >= 40 ? 2 : h >= 20 ? 1 : 0;
}
/** 不能起身的原因；可以起身返回 null */
function standUpBlocked(u) {
  if (exhaustTierOf(u) >= 1) return "力竭：无法再用坚毅生命起身";
  if ((Number(u && u.shp) || 0) <= 0) return "坚毅生命已耗尽";
  return null;
}
/** 开战时的力竭惩罚：力竭 2 起 def −1 */
function applyExhaustionAtStart(notes) {
  const tier = Math.max(0, Number(state.exhaustTier) || 0);
  if (!tier) return;
  const heroes = state.units.filter(u => u.isPlayer && !isWeaponUnit(u) && !u.dead);
  if (tier >= 2) {
    heroes.forEach(u => {
      if (u._exhaustDef) return;
      u._exhaustDef = true;
      u.defMax = Math.max(0, (Number(u.defMax) || 0) - 1);
      u.def = Math.min(Number(u.def) || 0, u.defMax);
    });
  }
  const text = ["", "力竭：无法用坚毅生命起身", "力竭 2：atk −3，def −1", "力竭 3：被击倒立刻死亡"][Math.min(3, tier)];
  if (text && notes) notes.push(`队伍${text}。`);
}

/** 开场击破（单局：熟练项检定失败受的伤留到下一场战斗开始时结算，可能直接开局失衡） */
function applyOpeningBreaks(notes) {
  const list = state.openingBreaks || [];
  state.openingBreaks = null;
  list.forEach(row => {
    const u = state.units.find(x => x.kit === row.kit && x.isPlayer && !x.dead && !x.hidden);
    if (!u) return;
    (row.breaks || []).forEach(b => dealBreak(u, b.amount, b.element, notes, "检定时受的伤"));
  });
}

function standUp(u) {
  if (!u || !u.isPlayer || isWeaponUnit(u) || u.dead) return;
  const blocked = standUpBlocked(u);
  if (blocked) {
    appendLog(`${u.name} ${blocked}。`);
    return;
  }
  if (!u.dying && totalHp(u) > 0) {
    appendLog(`${u.name} 还没濒死，不用起身。`);
    return;
  }
  snapshot();
  u.dying = false;
  u.upOnShp = true;
  u.dead = false;
  // 倒地时晕眩已经被清掉（clearStunOnDown），所以也要看架势是不是 0：倒地前失衡的人起身也有 1 架势
  if (u.stunned || (Number(u.def) || 0) <= 0) {
    u.stunned = false;
    if (typeof canRestorePosture !== "function" || canRestorePosture(u)) u.def = Math.max(1, Number(u.def) || 0);
    appendLog(`${u.name} 起身：解除晕眩，架势变为 1。之后受伤改打坚毅生命。`);
  } else {
    appendLog(`${u.name} 起身继续战斗。之后受伤改打坚毅生命。`);
  }
  if (u.kit === "xia" && (typeof passiveOn !== "function" || passiveOn(u))) {
    u.resources = u.resources || {};
    u.resources.engine = true;
    appendLog("背水一战：引擎强制启动，起身期间不失去架势。");
  }
  if (u.self === "burn") {
    appendLog(tickSelfBurn(u, false).join("\n"));
  }
  renderAll();
}

/* ---------- 战斗结束 ---------- */

/** 手册（本作裁定）：濒死的角色在战斗结束后恢复到 1 点生命。起身靠坚毅生命撑着的也一样。 */
function recoverDownedAfterBattle(notes) {
  (state.units || []).filter(u => u.isPlayer && !isWeaponUnit(u) && !u.dead && !u._removed).forEach(u => {
    if (!u.dying && !u.upOnShp) return;
    u.dying = false;
    u.upOnShp = false;
    const inner = innermostLayer(u);
    if (inner && (Number(inner.current) || 0) < 1) inner.current = 1;
    if (notes) notes.push(`${u.name} 从濒死中缓过来，恢复到 1 点生命。`);
  });
}

/* ---------- 撤退（主持人手册第七章） ----------
 *   撤退状态   时间       断后                         资源                    shp
 *   全员完好   一两小时   无                           无                      每人 3，不致死
 *   有损伤     一两小时   一人挨一次无法格挡的攻击     一部分奎支或道具        每人 5
 *   半数倒地   四到五小时 同上                         全部使用道具 + 一部分奎支 每人 5，倒地者 7
 * 「一部分奎支」手册没给比例，写在 kuizhiLoss 里，随时可调。 */
const RETREAT_RULES = {
  intact: { name: "全员完好", hours: 2, rearguard: false, kuizhiLoss: 0,    combatItems: false, shp: 3, shpDown: 3, lethal: false },
  hurt:   { name: "有损伤",   hours: 2, rearguard: true,  kuizhiLoss: 0.25, combatItems: false, shp: 5, shpDown: 5, lethal: true },
  routed: { name: "半数倒地", hours: 5, rearguard: true,  kuizhiLoss: 0.25, combatItems: true,  shp: 5, shpDown: 7, lethal: true }
};

function retreatHeroes() {
  return (state.units || []).filter(u => u.isPlayer && !isWeaponUnit(u) && !u.dead && !u._removed && !u.hidden);
}
/** 撤退时算「倒地」的人：濒死没起身。靠坚毅生命站着的不算倒地（可以断后），但算「有损伤」 */
function retreatDown(u) {
  return !!(u && u.dying && !u.upOnShp);
}
/** 现在撤退属于哪一档（作者裁定）：
 *   半数倒地 = 倒地的人数 ≥ 一半；
 *   有损伤   = 全员血量都 ≤ 50%，或有人 ≤ 25% / 倒地 / 靠坚毅生命起身；
 *   其余算全员完好（以前掉 1 点血就算有损伤）。 */
function retreatStatus() {
  const heroes = retreatHeroes();
  const down = heroes.filter(retreatDown).length;
  if (heroes.length && down * 2 >= heroes.length) return "routed";
  const ratio = (u) => { const max = baseMaxHp(u); return max > 0 ? totalCurHp(u) / max : 1; };
  const hurt = heroes.some(u => retreatDown(u) || u.upOnShp || ratio(u) <= 0.25) ||
    (heroes.length > 0 && heroes.every(u => ratio(u) <= 0.5));
  return hurt ? "hurt" : "intact";
}
/** 可以断后的人：还站着的角色（靠坚毅生命起身的也算站着） */
function retreatRearguards() {
  return retreatHeroes().filter(u => !retreatDown(u));
}
/** 撤退的代价，给界面预先显示（游戏版不写坚毅生命的数字：手册里坚毅生命对玩家不可见） */
function retreatPreview() {
  const key = retreatStatus();
  const r = RETREAT_RULES[key];
  const lines = [`${r.name}：耗时 ${r.hours} 小时`];
  if (r.rearguard) lines.push("一人断后，挨一次无法格挡的攻击");
  if (r.kuizhiLoss) lines.push(`失去 ${Math.round(r.kuizhiLoss * 100)}% 奎支`);
  if (r.combatItems) lines.push("失去全部战斗道具");
  lines.push(shpHidden()
    ? `每人的坚毅生命都会被消磨${r.shpDown !== r.shp ? "，倒地的人更多" : ""}${r.lethal ? "" : "（不致死）"}`
    : `每人坚毅 −${r.shp}${r.shpDown !== r.shp ? `，倒地者 −${r.shpDown}` : ""}${r.lethal ? "" : "（不致死）"}`);
  return { key, rule: r, lines };
}

/** 执行撤退。rearguardId：断后的角色（需要时）。返回记录。战斗随之结束。 */
function performRetreat(rearguardId) {
  const key = retreatStatus();
  const r = RETREAT_RULES[key];
  const notes = [`撤退（${r.name}）。`];
  if (r.rearguard) {
    const guards = retreatRearguards();
    const guard = guards.find(u => u.id === rearguardId) || guards[0];
    const foes = (state.units || []).filter(u => !u.isPlayer && !u.dead && !u.hidden && !u._removed && u.kit !== "ironwall");
    const striker = foes.slice().sort((a, b) => effectiveAtk(b, state.units) - effectiveAtk(a, state.units))[0];
    if (guard && striker) {
      const sg = striker.suggest || {};
      const dice = sg.dice || [0, 0];
      const onShp = !!guard.upOnShp;
      const hp0 = totalCurHp(guard), shp0 = Number(guard.shp) || 0;
      const out = dealTo(striker, guard, {
        atk: effectiveAtk(striker, state.units), mult: 1, flat: sg.flat || 0,
        diceN: dice[0], diceS: dice[1], element: sg.element || "physical", baseBreak: sg.baseBreak || 1,
        flags: { action: true, opp: true, blockResolved: true, block: "none" }
      });
      // 按断后的人实际掉了多少写（以前被防护罩 / 铁壁挡下时也写「挨了 N 伤害」）
      const lost = Math.max(0, hp0 - totalCurHp(guard)) + Math.max(0, shp0 - (Number(guard.shp) || 0));
      const wall = ((out && out.extra) || []).find(s => /替同区承受/.test(String(s)));
      if (lost > 0) notes.push(onShp && shpHidden() ? `${guard.name} 断后，挨了 ${striker.name} 一击，打在坚毅生命上。`
        : `${guard.name} 断后，挨了 ${striker.name} 一击：${Math.floor(lost)} 伤害。`);
      else if (wall) notes.push(`${guard.name} 断后：${striker.name} 的一击被${String(wall).split("替同区承受")[0]}挡下，没有受伤。`);
      else notes.push(`${guard.name} 断后：${striker.name} 的一击没有伤到人。`);
    }
  }
  if (r.kuizhiLoss > 0) {
    const before = Number(state.kuizhi) || 0;
    const lost = Math.floor(before * r.kuizhiLoss);
    state.kuizhi = before - lost;
    if (lost) notes.push(`丢下 ${lost} 奎支。`);
  }
  if (r.combatItems && state.bag && Array.isArray(state.bag.items)) {
    // 维修工具包战斗中也能用，但不算「战斗道具」（以前也不丢）
    const gone = state.bag.items.filter(x => (x.qty || 0) > 0 && ITEM_CATALOG[x.id] && ITEM_CATALOG[x.id].combat && ITEM_CATALOG[x.id].target !== "weapon");
    if (gone.length) notes.push(`丢下全部战斗道具：${gone.map(x => ITEM_CATALOG[x.id].name + "×" + x.qty).join("、")}。`);
    gone.forEach(x => { x.qty = 0; });
  }
  retreatHeroes().forEach(u => {
    const down = retreatDown(u);   // 靠坚毅生命站着的不算倒地者
    const loss = down ? r.shpDown : r.shp;
    const before = Number(u.shp) || 0;
    u.shp = r.lethal ? Math.max(0, before - loss) : Math.max(Math.min(before, 1), before - loss);
    notes.push(shpHidden() ? `${u.name} 的坚毅生命被消磨了一些。` : `${u.name} 坚毅 ${before} → ${u.shp}。`);
    if (u.shp <= 0 && before > 0) {
      u.dead = true;
      u.dying = false;
      u.upOnShp = false;
      notes.push(`${u.name} 坚毅生命耗尽，永久死亡。`);
    }
  });
  if (typeof ledgerAdvance === "function") ledgerAdvance(r.hours, notes);
  state.retreated = true;
  notes.forEach(t => appendLog(t));
  return { key, notes };
}

/** 玩家手册第二章：坚毅生命的具体数值对玩家永远不可见。游戏版（game.html 设 GAME_MODE）
 *  只说「受损 / 恢复了一些」；主持人计算器照常写数字。 */
function shpHidden() {
  // 跑团模式由主持人操作：坚毅生命照常显示
  if (typeof TRPG !== "undefined" && TRPG.active) return false;
  return typeof GAME_MODE !== "undefined" && !!GAME_MODE;
}
/* 坚毅对玩家只给模糊说法（issue #52，作者定）：按坚毅占上限的比例分四档（80% 以上 / 50–80% / 20–50% / 20% 以下），
 * 每档 5 句随机抽一句（休息结算用）；角色资料这类常驻的地方用一个短词 */
const SHP_MOOD_LINES = [
  ["你休息得不错，醒来时神清气爽。", "一夜无梦，四肢重新充满了力气。", "晨光照在脸上，你觉得今天什么都能扛下来。", "你伸了个长长的懒腰，连骨头都轻快了。", "篝火的余温还在，你从没睡得这么踏实过。"],
  ["睡得还行，只是肩膀还有点沉。", "你恢复了大半精神，但还没有回到最好的状态。", "醒来时有些迷糊，喝口水就好多了。", "夜里醒了几次，好在后半夜睡得安稳。", "身体还算听使唤，只是腿脚有点发酸。"],
  ["你翻来覆去很久才睡着，醒来时眼皮依然很重。", "休息让你缓了口气，但疲惫像潮水一样还没退去。", "梦里全是昨天的战斗，你醒来时比入睡时更累。", "你勉强爬起来，每个动作都要比平时多用一分力。", "风声吵了一整夜，你觉得自己好像根本没睡着。"],
  ["尽管你尝试休息了，身体里的疲惫却从来没有完全恢复。", "你几乎没有合眼。再这样下去，总有一刻会撑不住。", "你醒来时手还在发抖，好像有什么东西被一点一点耗尽了。", "你盯着熄灭的篝火发呆，连站起来都要下很大决心。", "胸口闷得发慌，休息只是让你暂时忘了自己有多累。"]
];
const SHP_MOOD_LABELS = ["精力充沛", "还撑得住", "疲惫", "快撑不住了"];
function shpMoodTier(shp, max) {
  const r = (Number(max) || 0) > 0 ? (Number(shp) || 0) / Number(max) : 1;
  return r >= 0.8 ? 0 : r >= 0.5 ? 1 : r >= 0.2 ? 2 : 3;
}
function shpMoodLine(shp, max, rnd) {
  const lines = SHP_MOOD_LINES[shpMoodTier(shp, max)];
  return lines[Math.floor((typeof rnd === "function" ? rnd() : Math.random()) * lines.length) % lines.length];
}
function shpMoodLabel(shp, max) { return SHP_MOOD_LABELS[shpMoodTier(shp, max)]; }

function selfBurnStacksOf(u) {
  return Math.max(1, Number(u && u.selfBurnStacks) || 1);
}

function tickSelfBurn(u, growStacks) {
  const notes = [];
  if (!u || u.self !== "burn" || u.dead) return notes;
  if (u.statuses && u.statuses.burn) {
    u.statuses.burn = 0;
    notes.push(`${u.name} 自焚免疫灼烧，灼烧层清除。`);
  }
  const stacks = selfBurnStacksOf(u);
  const onShp = !!u.upOnShp;
  const maxPool = onShp ? (Number(u.shpMax) || Number(u.shp) || 0) : totalMaxHp(u);
  const cur = onShp ? (Number(u.shp) || 0) : totalHp(u);
  const cap = Math.max(0, cur - 1);
  const loss = Math.min(maxPool * 0.1 * stacks, cap);
  if (onShp) {
    u.shp = Math.max(1, (Number(u.shp) || 0) - loss);
    spawnFloater(u, loss, "fire");
    notes.push(shpHidden() ? `${u.name} 自焚×${stacks} 灼烧着坚毅生命（至少留 1）。`
      : `${u.name} 自焚×${stacks} 对 SHP 造成 ${round2(loss)}（上限10%×层，至少留 1）。SHP ${u.shp}/${u.shpMax || "?"}`);
  } else {
    applyTrueDamage(u.layers, loss);
    spawnFloater(u, loss, "fire");
    notes.push(`${u.name} 自焚×${stacks} 失去 ${round2(loss)}（上限10%×层，至少留 1）。`);
  }
  if (growStacks) {
    const heat = currentWeatherFor(u) === "heat";
    const maxSt = heat ? 10 : 5;
    u.selfBurnStacks = Math.min(maxSt, stacks + 1 + (heat ? envMult(u) : 0));   // 酷暑再 +1（恶劣环境 / 末日 +2）
    notes.push(`自焚层数 ${stacks} → ${u.selfBurnStacks}${heat ? "（酷暑）" : ""}`);
  }
  return notes;
}

function isWeaponUnit(u) {
  if (!u) return false;
  if (u.weaponOf) return true;
  if (u.escort) return true;   // 护送对象（escort.js）：和武器人一样血量归零直接倒下、不算进全员倒地
  return ["mint", "latte", "niu", "naruto", "mochi", "berniel", "bili", "ironwall", "torque", "ecmo", "edc", "xiaoxiao"].indexOf(u.kit) >= 0;
}

const FOCUS_ELEMS = ["fire", "acid", "electric", "ice", "energy", "physical", "harmonic"];

function focusSeqLen(target) {
  const r = typeof enemyRankOf === "function" ? enemyRankOf(target) : "minion";
  if (r === "boss") return 3;
  if (r === "elite") return 2;
  return 1;
}

const ELE_BY_CN = {
  "火": "fire", "冰": "ice", "电": "electric", "能量": "energy",
  "酸": "acid", "物理": "physical", "谐波": "harmonic"
};
/** 我方队伍当前能打出的属性。角色卡的 note 里写着「能量/电」这样的主副属性，一并读进来。 */
function partyElements() {
  const out = [];
  const add = (e) => { if (e && out.indexOf(e) < 0) out.push(e); };
  (state.units || []).filter(u => u.isPlayer && !u.hidden && !u.dead).forEach(u => {
    add(u.element);
    add(u.element2);
    add(u.subElement);
    add(u.suggest && u.suggest.element);
    (u.elements || []).forEach(add);
    // note 形如「人类黑客 · 能量/电 · 直伤专精」
    const note = String(u.note || "");
    Object.keys(ELE_BY_CN).forEach(cn => {
      if (new RegExp("(^|[·\\s/])" + cn + "([·\\s/]|$)").test(note)) add(ELE_BY_CN[cn]);
    });
  });
  return out;
}

/** 聚焦序列：队伍用得上的属性权重 3，队伍没人用的权重 1（约三分之一）。 */
function rollFocusSeq(n) {
  const have = partyElements();
  const bag = [];
  FOCUS_ELEMS.forEach(el => {
    const w = have.indexOf(el) >= 0 ? 3 : 1;
    for (let i = 0; i < w; i++) bag.push(el);
  });
  const seq = [];
  for (let i = 0; i < n; i++) seq.push(bag[Math.floor(Math.random() * bag.length)]);
  return seq;
}

function applyFocus(target, layerType, lines) {
  if (!target || target.isPlayer) return;
  if (!(typeof passiveOnKit !== "function" || passiveOnKit("helu"))) {   // 放弃被动「聚焦」
    const msg = "Helumica 放弃了被动「聚焦」，无法聚焦。";
    if (lines) lines.push(msg); else appendLog(msg);
    return;
  }
  const type = layerType || ((target.layers || []).find(l => (l.current || 0) > 0) || {}).type;
  if (!type) {
    if (lines) lines.push("没有可聚焦的血量层。");
    return;
  }
  target.focuses = (target.focuses || []).filter(f => f.layerType !== type);
  const seq = rollFocusSeq(focusSeqLen(target));
  target.focuses.push({ layerType: type, seq, step: 0 });
  const label = seq.map(el => (typeof ELE !== "undefined" && ELE[el]) || el).join(" → ");
  const msg = `${target.name} 的${(typeof LAYER !== "undefined" && LAYER[type]) || type}被聚焦：${label}`;
  if (lines) lines.push(msg);
  else appendLog(msg);
  if (typeof popStatus === "function") popStatus(target, "focus");
}

/** 聚焦所在的层已经被打碎（或被抹掉、被领走）：聚焦跟着清掉。以前聚焦一直挂在碎掉的层上，
 *  序列走完还会再「抹」一次：再给 2 击破，并把同一层重新记成废物利用的来源 */
function pruneFocus(target) {
  if (!target || !(target.focuses || []).length) return;
  target.focuses = target.focuses.filter(f => (target.layers || []).some(l => l.type === f.layerType && (Number(l.current) || 0) > 0));
}

function pickFocusLayer(target) {
  pruneFocus(target);
  const f = (target.focuses || [])[0];
  return f && f.layerType;
}

function stripFocusLayer(target, layerType, lines) {
  const layer = (target.layers || []).find(l => l.type === layerType && (Number(l.current) || 0) > 0);
  if (!layer) {   // 那一层已经碎了：只清掉聚焦，不再抹一次
    target.focuses = (target.focuses || []).filter(f => f.layerType !== layerType);
    return;
  }
  const lost = Math.max(0, Number(layer.current) || 0);
  const layerMax = Math.max(0, Number(layer.max) || 0);
  const wasInner = layer === innermostLayer(target);
  layer.current = 0;
  layer.max = 0;
  layer.sealed = true;
  target.focuses = (target.focuses || []).filter(f => f.layerType !== layerType);
  // 抹去的是内层：留着这层（0/0）让单位按内层归零死亡，不能让外层顶替成内层
  if (!wasInner) target.layers = (target.layers || []).filter(l => l !== layer);
  state.lastBrokenLayer = { type: layerType, lost: layerMax, dmg: lost };
  noteSideDamage(lost, "聚焦抹层", target);
  const msg = `${target.name} 聚焦完成：${(typeof LAYER !== "undefined" && LAYER[layerType]) || layerType}被抹去（视为 ${lost} 点伤害，该层无法再被治疗）。`;
  if (lines) lines.push(msg);
  else appendLog(msg);
  if (typeof spawnFloater === "function") spawnFloater(target, lost, "harmonic");
  if (typeof spawnPopup === "function") spawnPopup(target, { kind: "status", text: "聚焦抹层", element: "harmonic" });
  if (wasInner) { creditPlayerHit(target, actingPlayerId()); settleEnemyKill(target, lines || []); }
  // 抹层同时露出结构弱点：2 击破（内层被抹、敌人已倒下就不用了）
  else if (!target.dead) {
    const notes = [];
    dealBreak(target, 2, "harmonic", notes, "聚焦抹层");
    notes.forEach(n => { if (lines) lines.push(n); else appendLog(n); });
  }
}

/** 聚焦推进：受到的伤害属性符合序列的下一个就推进一步，不看来源（攻击、状态、场地、余波都算；
 *  同一个行动里多段攻击整次算一步），
 *  不要求打在被聚焦的那一层上。用符合天气（这天气下有增伤）的属性攻击时，不管序列要什么都推进一步。
 *  序列走完，被聚焦的层直接抹去（并造成 2 击破）。 */
function weatherFavorsElement(target, element) {
  const w = currentWeatherFor(target);
  return !!(w && w !== "none" && element && weatherDamagePct(w, element) > 0);
}
function advanceFocusOnHit(attacker, target, element, res, extra) {
  pruneFocus(target);   // 这一击把聚焦的层打碎了：聚焦清掉，不再推进 / 抹层
  if (!target || !target.focuses || !target.focuses.length) return;
  if (!res || !res.ok || (res.total || 0) <= 0) return;
  const byWeather = weatherFavorsElement(target, element);
  target.focuses.slice().forEach(f => {
    const need = f.seq[f.step];
    if (need && (element === need || byWeather)) {
      const eleName = (typeof ELE !== "undefined" && ELE[element]) || element;
      stepFocus(target, f, extra, element === need ? eleName : eleName + "，顺应天气");
    }
  });
}
/** 聚焦序列推进一步；走完就抹层 */
function stepFocus(target, f, out, why) {
  pruneFocus(target);
  if (!f || !(target.focuses || []).includes(f) || f.step >= f.seq.length) return;
  // 一次行动（一个技能）只推进一步：分几下结算的技能（川川普攻两三刀、雷电风暴、协助攻击的那一击 + 直接推进……）
  // 以前每一下各走一步，川川一次普攻就能走完精英的序列
  const act = state.actionAcc ? (Number(state.actionSeq) || 0) : null;
  if (act != null && f.actSeq === act) return;
  f.actSeq = act;
  f.step += 1;
  out.push(`${target.name} 聚焦推进 ${f.step}/${f.seq.length}（${why}）`);
  if (f.step >= f.seq.length) stripFocusLayer(target, f.layerType, out);
}

function addRasEnergy(pct, reason) {
  const r = findKit("ras", state.units);
  if (!r) return;
  if (pct > 0 && !(typeof passiveOnKit !== "function" || passiveOnKit("ras"))) return;   // 放弃被动「事故幸存」：不再累积能量
  r.resources = r.resources || {};
  r.resources.energyPct = Math.max(0, (Number(r.resources.energyPct) || 0) + pct);
  appendLog(`拉斯缪尔累积能量 ${pct > 0 ? "+" : ""}${pct}%${reason ? "（" + reason + "）" : ""} → ${r.resources.energyPct}%`);
  if (r.resources.energyPct >= 100 && !r.resources.unstable) {
    r.resources.unstable = true;
    appendLog("拉斯缪尔进入不稳态：受到攻击伤害就倒地（濒死；已经起身的直接死亡），攻击次数翻倍。");
  }
}

function convertRasLight(pct, bonusRate) {
  const r = findKit("ras", state.units);
  if (!r) return 0;
  const rate = 1 + (Number(bonusRate) || 0);
  // 只能转换现有的累积能量：不足 20% 时按实际能量转换，0 就什么都不给（以前 0% 也凭空给 20% 的光能）
  const use = Math.max(0, Math.min(Number(pct) || 0, Number(r.resources.energyPct) || 0));
  const hp = typeof totalMaxHp === "function" ? totalMaxHp(r) : ((r.layers || []).reduce((s, l) => s + (l.max || 0), 0));
  const gain = Math.floor(hp * (use / 100) * rate);
  r.resources.energyPct = Math.max(0, (r.resources.energyPct || 0) - use);
  r.resources.light = (Number(r.resources.light) || 0) + gain;
  if ((r.resources.energyPct || 0) < 100) r.resources.unstable = false;
  appendLog(`拉斯缪尔转化光能 +${gain}（${use}% × 血上限 ${hp}）→ 光能 ${r.resources.light}，累积 ${r.resources.energyPct}%`);
  return gain;
}

/* 柯尔特「过度自信」的满血减伤（koltPrideCut）：cut 受到的伤害减几成，plusCut 过度自信+（被动强化 2）减几成 */
const KOLT_PRIDE = { cut: 0.25, plusCut: 0.45 };
/** 过度自信的满血减伤现在生不生效。dealTo 结算、暴虐猎手的斩杀预判（enemies.js · ratExecFlags）和角色仪表（hud-icons.js · gaugeState）用这同一个判断——
 *  以前仪表自己按「现有血量 ≥ 现在的血量上限」算：上限被临时护盾 / 临时层抬高时明明在减伤却写「未满血」，被动被图纸放弃时照样亮（作者 10/20 反馈）。
 *  生效：被动开着、不在起身中（靠坚毅生命）、现有血量 ≥ 进入战斗时的血量上限（prideMaxHp；中途上场还没记下的按现在不含临时部分的上限）。
 *  返回减伤比例：0 = 不生效，否则 KOLT_PRIDE.cut / plusCut */
function koltPrideCut(u) {
  if (!u || u.kit !== "kolt" || u.dead || u.upOnShp) return 0;
  if (typeof passiveOn === "function" && !passiveOn(u)) return 0;
  const mx = Number(u.prideMaxHp != null ? u.prideMaxHp : baseMaxHp(u)) || 0;
  if (!(mx > 0) || totalCurHp(u) < mx) return 0;
  return typeof passivePlus === "function" && passivePlus(u, 2) ? KOLT_PRIDE.plusCut : KOLT_PRIDE.cut;
}

/* 柯尔特的废料（koltScrapCap / koltScrapTotal / koltScrapSpend）：
 *   capPct     废料上限 = 柯尔特生命上限 × capPct。敌人血量层来的废料按它封顶（和废物利用一样）；
 *              「非法」改装要废料合计达到它，才能消耗等量的废料给我方目标行动点
 *   modAp      「非法」改装消耗废料给目标的行动点（可以超过行动点上限）
 *   spendOrder 「非法」改装扣废料的顺序：layer 敌人血量层（按封顶后的数）→ rot 腐坏抛射 → divert 扭矩转移注意 → strip 扭矩拆卸模式 */
const KOLT_SCRAP = { capPct: 0.5, modAp: 1, spendOrder: ["layer", "rot", "divert", "strip"] };
/** 废料上限：柯尔特生命上限的一半（KOLT_SCRAP.capPct）；没有柯尔特时不封顶 */
function koltScrapCap(k) {
  return k && typeof baseMaxHp === "function" ? Math.floor(baseMaxHp(k) * KOLT_SCRAP.capPct) : Infinity;
}
/** 柯尔特的废料：上一个被摧毁的敌人血量层 + 腐坏抛射记下的腐蚀伤害 + 扭矩「转移注意」失去的装甲 + 扭矩「拆卸模式」变成废料的外层血量。
 *  废物利用领走它们；碎渣重炮把它们全部装填打出去；「非法」改装达到上限时扣掉一部分（koltScrapSpend） */
function koltScrapTotal(k) {
  k = k || findKit("kolt", state.units);
  const r = (k && k.resources) || {};
  // 敌人失去血量层得来的废料：不超过废料上限（和废物利用的封顶一样）；其余几种单独计算，不受上限
  const last = state.lastBrokenLayer ? Math.min(koltScrapCap(k), Math.floor(Number(state.lastBrokenLayer.lost) || 0)) : 0;
  const sum = store => Object.keys(store || {}).reduce((s, t) => s + Math.floor(Number(store[t]) || 0), 0);
  return Math.max(0, last + sum(r.rotStore) + Math.floor(Number(r.divertArmor) || 0) + sum(r.stripStore));
}
function koltScrapClear(k) {
  state.lastBrokenLayer = null;
  if (k && k.resources) { k.resources.rotStore = {}; k.resources.divertArmor = 0; k.resources.stripStore = {}; }
}
/** 「非法」改装：废料（所有来源合计）达到上限了没有 */
function koltScrapFull(k) {
  const cap = koltScrapCap(k);
  return cap > 0 && cap !== Infinity && koltScrapTotal(k) >= cap;
}
/** 「非法」改装：从柯尔特的废料里扣掉 n 点，按 KOLT_SCRAP.spendOrder 的顺序扣；扣完的来源清零，没扣完的留着。
 *  腐坏抛射、拆卸模式各自记着几种血量，按记录的先后依次扣。返回实际扣掉的量 */
function koltScrapSpend(k, n) {
  const r = (k && k.resources) || {};
  const want = Math.max(0, Math.floor(Number(n) || 0));
  let left = want;
  const fromStore = store => Object.keys(store || {}).forEach(t => {
    if (left <= 0) return;
    const have = Math.max(0, Math.floor(Number(store[t]) || 0)), use = Math.min(left, have);
    left -= use;
    if (use >= have) delete store[t];
    else store[t] = have - use;
  });
  const take = {
    // 敌人血量层：按封顶后的数算；扣不完的记回那一层，下次废物利用照样能领剩下的
    layer: () => {
      const rec = state.lastBrokenLayer;
      if (!rec) return;
      const have = Math.min(koltScrapCap(k), Math.max(0, Math.floor(Number(rec.lost) || 0))), use = Math.min(left, have);
      left -= use;
      if (use >= have) state.lastBrokenLayer = null;
      else rec.lost = have - use;
    },
    rot: () => fromStore(r.rotStore),
    divert: () => {
      const have = Math.max(0, Math.floor(Number(r.divertArmor) || 0)), use = Math.min(left, have);
      left -= use;
      r.divertArmor = have - use;
    },
    strip: () => fromStore(r.stripStore)
  };
  KOLT_SCRAP.spendOrder.forEach(src => { if (left > 0 && take[src]) take[src](); });
  return want - left;
}
/** 扭矩「转移注意」结束：失去的装甲记为废料（下次废物利用额外获得等量装甲） */
function endTorqueGuard(w, notes) {
  const r = w && w.resources;
  if (!r || !r.divertGuard) return;
  r.divertGuard = false;
  const armorNow = (w.layers || []).filter(l => l.type === "armor").reduce((s, l) => s + (Number(l.current) || 0), 0);
  const lost = Math.max(0, Math.floor((Number(r.divertArmor0) || 0) - armorNow));
  r.divertArmor0 = 0;
  const k = findKit("kolt", state.units);
  if (k && lost > 0) {
    k.resources = k.resources || {};
    k.resources.divertArmor = (Number(k.resources.divertArmor) || 0) + lost;
    notes.push(`转移注意：扭矩失去的 ${lost} 点装甲记为废料。`);
  }
}
/** 探测模式变回武器：经过的每个区各触发一个配置物 */
function ecmoProbeTrigger(a, notes) {
  const r = a && a.resources;
  if (!r || !r.probe) return;
  const zones = Array.from(new Set((r.probeZones || []).map(Number)));
  r.probe = false; r.probeZones = [];
  zones.forEach(z => {
    const p = (state.props || []).find(x => Number(x.zone) === z && !BARRIER_SIDE[x.kind] && !(x.kind === "scrap" && !scrapReady(x)));
    if (!p) return;
    const picks = { dest: z, act: "prop:" + p.id };
    if (p.kind === "battery") picks.mode = "boom";
    if (p.kind === "scrap") {
      const t = scrapTargets(p, a)[0];
      if (!t) { notes.push(`探测模式触发 ${p.name}：没有打得到的敌人。`); return; }
      picks.target = t.id;
    }
    const out = [];
    heluScanAct(a, picks, out);
    notes.push(...out.map(x => String(x).replace(/^环境扫描：/, "探测模式：").replace(/Helumica 的敌人/g, `${a.name} 的敌人`)));
  });
}

function swapKoltBit(actor, lines) {
  const k = findKit("kolt", state.units) || (actor && actor.kit === "kolt" ? actor : null);
  if (!k) return "drill";
  k.resources = k.resources || {};
  if (typeof passiveOn === "function" && !passiveOn(k)) {   // 放弃被动「更换刀头」
    lines.push(`${k.name} 放弃了被动「更换刀头」，刀头保持不变。`);
    return k.resources.bit || "drill";
  }
  k.resources.bit = k.resources.bit === "acid" ? "drill" : "acid";
  const name = k.resources.bit === "acid" ? "酸液炮（远距离）" : "电钻（近距离）";
  lines.push(`${k.name} 更换刀头 → ${name}`);
  return k.resources.bit;
}

function koltMeleeSwapTargets(actor) {
  const k = findKit("kolt", state.units) || actor;
  if (!k) return [];
  // 切刀追击不是谐波攻击：下潜中的不能被选为目标（effects.js · 下潜，#360）
  return fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && !u.fused && Number(u.zone) === Number(k.zone) && submergedPickOk(u, false));
}

function queueKoltSwap(actor) {
  const k = findKit("kolt", state.units) || (actor && actor.kit === "kolt" ? actor : null);
  if (!k || k.dead || k.hidden) return;
  if (typeof passiveOn === "function" && !passiveOn(k)) return;   // 放弃被动「更换刀头」
  state.koltSwapQueue = state.koltSwapQueue || [];
  // 每次触发（协助攻击、协助格挡……）各给一次更换刀头的机会：不按柯尔特去重，
  // 画面 / 模拟器会在处理下一个协助攻击之前先问完这一次
  state.koltSwapQueue.push({ actorId: k.id });
  if (typeof presentKoltSwapModal === "function") presentKoltSwapModal();
}

function resolveKoltSwap(doSwap, targetId) {
  const job = (state.koltSwapQueue || []).shift();
  const modal = uiEl("koltSwapModal");
  if (modal) modal.classList.add("hidden");
  if (!job) return;
  const k = unitById(job.actorId) || findKit("kolt", state.units);
  const lines = [];
  if (!k) return;
  if (!doSwap) {
    appendLog(`${k.name} 选择不更换刀头。`);
    if (typeof presentKoltSwapModal === "function") presentKoltSwapModal();
    return;
  }
  const next = swapKoltBit(k, lines);
  const tgt = targetId ? unitById(targetId) : null;
  if (tgt && Number(tgt.zone) === Number(k.zone) && !tgt.dead) {
    const ele = next === "acid" ? "acid" : "electric";
    const atk = effectiveAtk(k, state.units);
    const mult = typeof passivePlus === "function" && passivePlus(k, 1) ? 0.75 : 0.5;   // 更换刀头+：0.75×atk
    const out = dealTo(k, tgt, { element: ele, mult, baseBreak: 0, atk, atkRange: "melee", flags: { action: true, blockResolved: true, flyFree: true } });
    (out.extra || []).forEach(s => lines.push(s));
    lines.push(`切刀近距离打击 ${tgt.name}：${mult}atk ${ele === "acid" ? "酸" : "电"}。`);
  } else {
    lines.push("同区没有可打的敌人，只切换刀头。");
  }
  appendLog(lines.join("\n"));
  if (typeof presentKoltSwapModal === "function") presentKoltSwapModal();
  if (typeof renderAll === "function") renderAll();
}

function presentKoltSwapModal() {
  if (!HAS_DOM) return;
  const modal = uiEl("koltSwapModal");
  if (!modal) return;
  const job = (state.koltSwapQueue || [])[0];
  if (!job) { modal.classList.add("hidden"); return; }
  const k = unitById(job.actorId);
  if (!k) { state.koltSwapQueue.shift(); presentKoltSwapModal(); return; }
  const box = uiEl("koltSwapBtns");
  const text = uiEl("koltSwapText");
  const cur = (k.resources && k.resources.bit) === "acid" ? "酸液炮" : "电钻";
  const nxt = cur === "酸液炮" ? "电钻" : "酸液炮";
  if (text) text.textContent = `${k.name} 当前是${cur}。可以换成${nxt}，并对同区一名敌人打 0.5atk（近距离）。`;
  if (box) {
    box.innerHTML = "";
    const skip = document.createElement("button");
    skip.className = "btn";
    skip.textContent = "不切换";
    skip.onclick = () => calcCommand("koltSwap", { swap: false, target: null });
    box.appendChild(skip);
    const foes = koltMeleeSwapTargets(k);
    if (!foes.length) {
      const only = document.createElement("button");
      only.className = "btn primary";
      only.textContent = "切换（同区无目标）";
      only.onclick = () => calcCommand("koltSwap", { swap: true, target: null });
      box.appendChild(only);
    } else {
      foes.forEach(u => {
        const b = document.createElement("button");
        b.className = "btn primary";
        b.textContent = `切换并打 ${u.name}`;
        b.onclick = () => calcCommand("koltSwap", { swap: true, target: u.id });
        box.appendChild(b);
      });
    }
  }
  modal.classList.remove("hidden");
}

function assistSkillId(helper) {
  if (!helper) return null;
  if (helper.kit === "ruby" && helper.resources && helper.resources.mecha) return "wing_assist";
  return ({
    ruby: "ruby_assist",
    yuito: "yuito_assist",
    hiaki: "hiaki_assist",
    tou: "tou_assist",
    xia: "xia_assist",
    chuan: "chuan_assist",
    nora: "nora_assist",
    kolt: "kolt_assist",
    helu: "helu_assist",
    ras: "ras_assist",
    longge: "longge_assist"
  })[helper.kit] || null;
}

/* ---------- 龙哥：枪管手杖 + 胶囊弹药 ----------
 * 被动「枪管手杖」：武器可以当手杖（冰）或霰弹枪用。扳机没解锁时不能用霰弹枪；协助攻击、协助格挡成功、
 *   小朋友变回武器时解锁扳机；弹药打光后不能再解锁。
 * 被动「胶囊弹药」：6 发，红（火）蓝（冰）各 3 发，开战时顺序随机，按顺序消耗。窥探 N：从还没看过的那一发起，
 *   按顺序再知道 N 发的颜色。蓝弹用于治疗：固定（龙哥等级 + 5）；红弹用于治疗：该单位已损失血量的 40%。
 * 弹药记在龙哥身上（小朋友的直冲拳、治疗支援、反击也从这里扣）。子弹打光时扳机锁上。
 * 每一发看没看过记在 seen（和 ammo 一一对应）；known = 从队首数连续看过的枚数（旧存档 / 后台用）。
 * 预演（伤害预览）里下一发还没窥探到时，按最小 / 最大两次分别当蓝弹 / 红弹算，不提前泄露颜色。 */
const LONGGE_AMMO = { red: { name: "红弹", short: "红", element: "fire" }, blue: { name: "蓝弹", short: "蓝", element: "ice" } };
function longgeOf() { return (state.units || []).find(u => u.kit === "longge" && !u.weaponOf) || null; }
function longgeAmmoFresh() {
  const a = ["red", "red", "red", "blue", "blue", "blue"];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** 龙哥的弹药资源（小朋友出手时也找龙哥） */
function longgeRes(u) {
  const lg = u && u.kit === "longge" ? u : longgeOf();
  if (!lg) return null;
  const r = lg.resources = lg.resources || {};
  if (!Array.isArray(r.ammo)) r.ammo = [];
  if (!Array.isArray(r.seen) || r.seen.length !== r.ammo.length) {
    const k = Math.max(0, Math.min(r.ammo.length, Number(r.known) || 0));
    r.seen = r.ammo.map((c, i) => i < k);
  }
  longgeSyncKnown(r);
  return r;
}
function longgeSyncKnown(r) {
  let k = 0;
  while (k < r.seen.length && r.seen[k]) k++;
  r.known = k;
}
function longgeAmmoText(u) {
  const r = longgeRes(u);
  if (!r) return "";
  const seq = r.ammo.map((c, i) => r.seen[i] ? (LONGGE_AMMO[c] || {}).short || "?" : "?").join("");
  return `弹药 ${r.ammo.length}/6${r.ammo.length ? "（" + seq + "）" : ""}`;
}
function longgeGunReady(u) {
  const r = longgeRes(u);
  return !!(r && r.trigger && r.ammo.length);
}
/** 这次技能用哪种模式：分步里选的；选了霰弹枪但用不了就退回手杖 */
function longgeMode(a) {
  const fl = state.skillFlow;
  const want = fl && fl.picks && fl.picks.mode;
  return want === "gun" && longgeGunReady(a) ? "gun" : "cane";
}
/** 解锁扳机 */
function longgeUnlock(u, lines, why) {
  const r = longgeRes(u);
  if (!r || r.trigger) return;
  if (!r.ammo.length) { lines.push("弹药已经打光，扳机无法解锁。"); return; }
  r.trigger = true;
  lines.push(`${why ? why + "：" : ""}解锁扳机，可以使用霰弹枪模式。`);
}
/** 窥探 n：按顺序（从队首起还没看过的）多知道 n 发子弹的颜色 */
function longgePeek(u, n, lines) {
  const r = longgeRes(u);
  if (!r) return;
  if (!r.ammo.length) { lines.push("窥探：已经没有子弹了。"); return; }
  // 伤害预览（沙盒预演）不真的窥探：不记成看过、不写出颜色（以前悬停预览就能偷看到下一发）
  if (typeof window !== "undefined" && window.GAME && window.GAME.sim) {
    lines.push(`窥探 ${n}：出手后才知道颜色。`);
    return;
  }
  const got = [];
  for (let i = 0; i < r.ammo.length && got.length < n; i++) {
    if (r.seen[i]) continue;
    r.seen[i] = true;
    got.push(`第 ${i + 1} 发是${LONGGE_AMMO[r.ammo[i]].name}`);
  }
  longgeSyncKnown(r);
  lines.push(got.length ? `窥探 ${n}：${got.join("，")}。` : "窥探：剩下的子弹都已经看过了。");
}
/** 按顺序取一发子弹；没有返回 null */
function longgeTakeBullet(u, lines) {
  const r = longgeRes(u);
  if (!r || !r.ammo.length) return null;
  let c = r.ammo[0];
  // 伤害预览：没窥探到的那一发，最小 / 最大两次预演分别当蓝 / 红，不提前透露真正的颜色
  if (!r.seen[0] && typeof window !== "undefined" && window.GAME && window.GAME.sim) c = takeDice(1, 2, 0).total <= 1 ? "blue" : "red";
  r.ammo.shift();
  r.seen.shift();
  r.shuffleLock = false;   // 子弹数量变了：可以再洗牌
  longgeSyncKnown(r);
  lines.push(`消耗 1 发${LONGGE_AMMO[c].name}（剩 ${r.ammo.length} 发）。`);
  // 画面：开枪 / 出拳的人（龙哥或小朋友）头顶跳出红 / 蓝字，告诉玩家这一发是什么颜色
  if (typeof spawnPopup === "function" && u) spawnPopup(u, { kind: "bullet", text: LONGGE_AMMO[c].name, element: LONGGE_AMMO[c].element });
  if (!r.ammo.length && r.trigger) { r.trigger = false; lines.push("子弹打光了，扳机锁上。"); }
  return c;
}
/** 用一发子弹治疗：蓝弹（龙哥等级 + 5），红弹（已损失血量的 40%） */
function longgeBulletHeal(color, target, lines) {
  if (!color || !target) return 0;
  const lg = longgeOf();
  const lost = Math.max(0, totalMaxHp(target) - totalHp(target));
  const amt = color === "blue" ? ((lg && lg.level) || 1) + 5 : Math.ceil(lost * 0.4);
  const got = healUnit(target, amt);
  lines.push(`${LONGGE_AMMO[color].name}治疗 ${target.name}：${color === "blue" ? "固定 " + amt : "已损失 " + lost + " 的 40% = " + amt} → 恢复 ${got}。`);
  return got;
}
/** 枪管手杖+：霰弹枪普攻也能打近距离 */
function longgeGunNear(a) {
  const lg = a && a.kit === "longge" ? a : longgeOf();
  return !!(lg && typeof passivePlus === "function" && passivePlus(lg, 1));
}
/** 爆发治疗能不能用：要 3 发子弹。不用先窥探；只有已经看到的颜色就对不上时才拦下（明知会白扣行动点） */
function longgeBurstWhy(a) {
  const r = longgeRes(a) || { ammo: [], seen: [] };
  if (r.ammo.length < 3) return "爆发治疗要 3 发子弹";
  const known = [0, 1, 2].filter(i => r.seen[i]).map(i => r.ammo[i]);
  if (known.some(c => c !== known[0])) return "已经窥探到接下来 3 发不是同一种颜色";
  return null;
}
/** 胶囊弹药+：长休排好的下一场开局弹序（"RRBBRB" 这种 6 个字），没有就随机 */
function longgeOpeningAmmo() {
  const pre = typeof LEDGER !== "undefined" && LEDGER.ammoOrder && LEDGER.ammoOrder.longge;
  if (typeof pre === "string" && /^[RB]{6}$/.test(pre) && (pre.match(/R/g) || []).length === 3) {
    delete LEDGER.ammoOrder.longge;   // 只管下一场
    return pre.split("").map(ch => ch === "R" ? "red" : "blue");
  }
  return longgeAmmoFresh();
}
/** 手杖协助攻击带的治疗给谁：所在区里血量比例最低的友方（含自己） */
function longgeHealPick(a) {
  const pool = fieldUnits().filter(u => u.isPlayer && !u.dead && !u.hidden && !u.fused && Number(u.zone) === Number(a.zone));
  pool.sort((x, y) => totalHp(x) / Math.max(1, totalMaxHp(x)) - totalHp(y) / Math.max(1, totalMaxHp(y)));
  return pool[0] || a;
}

function unitIsCombatReady(u) {
  if (!u || u.hidden || u.dead || u.dying) return false;
  if (u.upOnShp) return (Number(u.shp) || 0) > 0;
  return !isInnerDepleted(u);
}

function unitCanFight(u) {
  return !!(unitIsCombatReady(u) && !u.stunned && !sinkLocked(u));   // 流沙没顶：不能协助
}

/** 协助攻击的目标已经不在了：死亡、被移出战场、倒地受保护（濒死没起身），或最内层生命归零。
 *  失衡往往和致命的那一下同时发生（同一击先算击破再算伤害，或排队期间又被别的伤害打死），
 *  所以排队时查过一次还不够，真正要发动时再查。 */
function assistTargetGone(u) {
  if (!u || u.dead || u._removed) return true;
  if (typeof isDownProtected === "function" && isDownProtected(u)) return true;
  if (!u.upOnShp && (u.layers || []).length && isInnerDepleted(u)) return true;
  return false;
}

/** 丢掉队首那些目标已经倒下的协助攻击 */
function pruneAssistQueue() {
  const q = state.assistQueue || [];
  while (q.length && assistTargetGone(unitById(q[0].targetId))) {
    const t = unitById(q[0].targetId);
    q.shift();
    appendLog(`${t ? t.name : "目标"} 已经倒下，协助攻击取消。`);
  }
}

/* ---------- 单人模式（rogue-data.js · ROGUE_SOLO） ----------
 * state.solo = { heroKit, partners, level, weaponLevel, used }，由单局的 battleSpec.before 写进来；其他模式为 null。
 *   · 主角每回合 2 行动点；可以给自己协助格挡、接自己打出的失衡做协助攻击
 *   · 支援：攒分换机会，门槛 250 分、手里每有 1 次 +25，最多存 6 次（没用完的次数带到之后的战斗），花 1 行动点叫一名伙伴登场，对一名敌人打一次他的协助攻击，
 *     再追加 3 点同属性击破，然后退场；每名伙伴一场只能叫一次。伙伴的等级和武器等级跟主角一样。 */
function soloCfg() {
  return typeof ROGUE_SOLO !== "undefined" ? ROGUE_SOLO
    : { apPerRound: 2, partners: 3, supportScore: 250, supportStep: 25, supportMax: 6, supportCost: 1, supportBreak: 3 };
}
function isSoloHero(u) {
  return !!(state.solo && u && u.isPlayer && !u.isPartner && u.kit === state.solo.heroKit);
}
/** 支援机会：带来的 + 本场攒到的 − 已经用掉的 */
/** 下一次支援要攒多少分：手里每持有 1 次，门槛 +supportStep */
function soloSupportCost(held) {
  const cfg = soloCfg();
  return (Number(cfg.supportScore) || 250) + (Number(cfg.supportStep) || 0) * Math.max(0, held);
}
function soloSupportMax() { return Number(soloCfg().supportMax) || 99; }
/** 把新得的分攒进支援进度：分数一段一段地换成支援次数（门槛看换的那一刻手里有几次），存满上限就不再攒。
 *  so.pool 是攒着、还没换成次数的分；so.scoreSeen 是已经算进去的分数 */
function syncSoloSupport() {
  const so = state.solo;
  if (!so) return;
  const score = state.battleScore ? Math.max(0, Math.floor(state.battleScore.total || 0)) : 0;
  so.earned = Number(so.earned) || 0;
  so.pool = Number(so.pool) || 0;
  so.scoreSeen = Number(so.scoreSeen) || 0;
  so.pool = Math.max(0, so.pool + (score - so.scoreSeen));   // 招式疲劳扣分也从进度里扣
  so.scoreSeen = score;
  const max = soloSupportMax();
  const bank = Math.min(max, Math.max(0, Number(so.bank) || 0));
  let held = bank + so.earned - so.used.length;
  while (held < max && so.pool >= soloSupportCost(held)) {
    so.pool -= soloSupportCost(held);
    so.earned += 1;
    held += 1;
  }
  if (held >= max) so.pool = 0;   // 存满了：多出来的分不攒
}
function soloSupportInfo() {
  const so = state.solo;
  if (!so) return null;
  syncSoloSupport();
  const score = so.scoreSeen;
  const max = soloSupportMax();
  const bank = Math.min(max, Math.max(0, Number(so.bank) || 0));   // 之前战斗没用完、带过来的次数
  const left = Math.max(0, bank + so.earned - so.used.length);
  const full = left >= max;
  const cost = soloSupportCost(left);
  return { score, earned: so.earned, bank, left, max, full, cost, progress: so.pool,
    next: full ? null : score + Math.max(0, cost - so.pool),
    partners: so.partners.filter(k => so.used.indexOf(k) < 0) };
}
/** 单人模式：主角倒地不算输。还能用坚毅生命起身就接着打（下个玩家回合点「起身」）；
 *  起不来（坚毅生命耗尽、力竭）才算真正死亡，这时战斗失败、本局结束。 */
function soloDownCheck(notes) {
  if (!state.solo) return notes;
  (state.units || []).forEach(u => {
    if (!isSoloHero(u) || !u.dying || u.dead || u.upOnShp) return;
    const why = standUpBlocked(u);
    if (!why) return;
    u.dead = true;
    u.dying = false;
    if (notes) notes.push(`${u.name} 倒地后无法再起身（${why}），死亡。`);
  });
  return notes;
}
/** 这名角色还算「站着」吗：没倒地；或者单人模式的主角倒地了、但还能起身 */
function heroStillFighting(u) {
  if (!u || u.dead) return false;
  if (!u.dying) return true;
  return isSoloHero(u) && !u.upOnShp && !standUpBlocked(u);
}
function soloSupportSkill(unit) {
  if (!isSoloHero(unit)) return null;
  const info = soloSupportInfo();
  return { id: "solo_support", name: "支援", bare: true,
    hint: `行动点 · 叫一名伙伴登场，对一名敌人打一次协助攻击 +${soloCfg().supportBreak} 击破 · 剩 ${info.left} 次` +
      (info.full ? `（已存满 ${info.max} 次）` : `（下一次 ${info.next} 分：门槛 ${soloCfg().supportScore} 分，手里每有 1 次 +${soloCfg().supportStep}，最多存 ${info.max} 次）`) };
}
function soloSupportError(a) {
  const info = soloSupportInfo();
  if (!info) return "只有单人模式能用";
  if (!info.partners.length) return "伙伴都已经出过场了";
  if (info.left < 1) return `支援机会不足（本场 ${info.score} 分，到 ${info.next} 分多一次）`;
  if (!fieldUnits().some(u => !u.isPlayer && !u.dead && !u.hidden)) return "没有敌人";
  return null;
}
/** 伙伴登场：照角色卡生成，等级、武器等级和主角一样 */
function soloSpawnPartner(kit, zone) {
  const card = livePartyCards().find(c => c.kit === kit);
  if (!card) return null;
  const u = spawnLiveCard(card, zone);
  resetBattleFlags(u);
  u.isPartner = true;
  u.weaponHeld = true;
  u.level = state.solo.level;
  u.weaponLevels = {};
  (card.linkedKits || []).forEach(w => { u.weaponLevels[w] = state.solo.weaponLevel; });
  applyLevelStats(u);
  (u.layers || []).forEach(l => { l.current = l.max; });
  u.def = u.defMax;
  u.ap = 0; u.bonus = 0;
  return u;
}
/** 支援技能的结算（扣行动点之后调用）：伙伴登场 → 协助攻击 → 追加击破 → 退场 */
function runSoloSupport(a, kit, target, lines) {
  const so = state.solo;
  const p = soloSpawnPartner(kit, target.zone);
  if (!p) { lines.push("没有这名伙伴。"); return; }
  syncSoloSupport();   // 先把用掉之前攒的分按「手里还有这次」的门槛结算掉
  so.used.push(kit);
  state.units.push(p);
  appendLog(lines.splice(0).concat([`${p.name} 登场支援（Lv${p.level}）！`]).join("\n"));
  // 战斗画面：伙伴先在场上亮相，再冲向目标（见 game.js · playTape 的 partner）
  if (typeof spawnPopup === "function") {
    try { spawnPopup(p, { kind: "partner", text: "登场支援！", element: (p.suggest && p.suggest.element) || "physical", targetId: target.id }); } catch (e) {}
  }
  const prev = { attacker: state.attackerId, target: state.targetId, flow: state.skillFlow, acc: state.actionAcc };
  state.attackerId = p.id;
  state.targetId = target.id;
  state.skillFlow = null;
  state.lastHitElement = null;
  state._assistBy = p.id;
  try {
    runSkillInner(assistSkillId(p), { ignorePhase: true });
  } finally {
    state._assistBy = null;
    state.attackerId = prev.attacker;
    state.targetId = prev.target;
    state.skillFlow = prev.flow;
    state.actionAcc = prev.acc;
  }
  const el = state.lastHitElement || (p.suggest && p.suggest.element) || "physical";
  const notes = [];
  if (!target.dead && !target.hidden && !assistTargetGone(target)) {
    dealBreak(target, soloCfg().supportBreak, el, notes, "支援追加");
  }
  // 退场：连同它这次唤出的武器人一起离开战场
  state.units = state.units.filter(u => u !== p && u.weaponOf !== p.kit);
  // 指向伙伴的嘲讽、掩护之类一并失效
  state.units.forEach(u => {
    if (u.tauntTo === p.id) u.tauntTo = null;
    if (u.coverBy === p.id) u.coverBy = null;
  });
  notes.push(`${p.name} 完成支援，退场。`);
  appendLog(notes.join("\n"));
}

/** 这次失衡算谁打出来的（决定由哪一边接协助攻击）。
 *  只有和失衡者敌对、真在场上的单位打出的失衡，才由打的那一方接（多阵营：沙鱼打失衡沙灵，沙鱼群起）。
 *  配置物爆炸、危墙倒塌、炮台、碎渣机炮这类替身攻击者（不在场上），以及和失衡者不敌对的单位（敌人被同伙的范围攻击误伤、
 *  我方误伤队友）都不算：按失衡的一方算——敌人失衡由我方接，我方失衡由敌人接（返回 null）。
 *  以前爆炸桶的替身不是玩家，炸出的敌人失衡被当成「敌人打敌人」，只找和它敌对的敌人来接，我方接不了（作者 10/19 反馈） */
function assistBreaker(breaker, broken) {
  if (!breaker || !broken) return null;
  if (!(state.units || []).includes(breaker) || breaker.envSrc) return null;
  if (typeof hostileTo === "function" && !hostileTo(breaker, broken)) return null;
  return breaker;
}

function eligibleAssisters(breaker, broken) {
  if (!broken || assistTargetGone(broken)) return [];
  breaker = assistBreaker(breaker, broken);
  // 敌人那边出手：我方失衡，或者敌人把敌对阵营的敌人打失衡（异星生物 ↔ 安保）。
  // 只有和打出失衡的那一方是一伙、又和失衡的人敌对的敌人才协助
  if (broken.isPlayer || (breaker && !breaker.isPlayer)) {
    const hostile = (x, y) => typeof hostileTo === "function" ? hostileTo(x, y) : !!x.isPlayer !== !!y.isPlayer;
    return fieldUnits().filter(u =>
      !u.isPlayer &&
      !u.trainingDummy &&   // 训练假人不协助攻击（training.js）
      hostile(u, broken) &&
      (!breaker || breaker.isPlayer || u.id === breaker.id || !hostile(u, breaker)) &&
      !u.dead && !u.hidden && !u.stunned &&
      (unitCanFight(u) || u.kit === "ufo_body") &&
      u.kit !== "ufo_leg" &&
      (!breaker || u.id !== breaker.id || u.kit === "ufo_body" || u.kit === "chixia") &&   // 飞碟触灵、赤牙（剿灭）可以接自己打出的失衡
      !(typeof touDuelVictim === "function" && touDuelVictim(u) && broken.kit !== "tou") &&
      (typeof enemyMayAssist !== "function" || enemyMayAssist(u)) &&   // 被挟持的王、哗变的狂徒不对我方出手（enemies.js）
      !(typeof fishFrenzyUsed === "function" && fishFrenzyUsed(u)) &&   // 沙鱼每回合只群起一次
      !lineBlocked(u.zone, broken.zone)                                 // #44：协助攻击不能穿墙（危墙 / 关着的机关门）
    );
  }
  // 只列真正能出手的人：濒死没起身、失衡、抓在敌人身上的不行（以前飞碟本体失衡时这些人也列进来，
  // 选上了先回满架势再被拒）；空手又没有能召回的武器（武器人已倒、耐久归零）的不行；
  // 敌方单位不进我方名单（以前「飞碟触灵·本体」自己也在里面，选它 = 给首领回满架势）
  return fieldUnits().filter(u =>
    u.isPlayer &&
    !isWeaponUnit(u) &&
    !u.dead && !u.hidden && !u.fused &&
    unitCanFight(u) &&
    assistSkillId(u) &&
    assistWeaponReady(u) &&
    !(typeof isCrushing === "function" && isCrushing(u)) &&
    !u.isPartner &&                                          // 支援的伙伴打完就退场，不接协助攻击
    (!breaker || u.id !== breaker.id || isSoloHero(u)) &&   // 单人模式可以接自己打出的失衡
    (typeof bpCanAssistAttack !== "function" || bpCanAssistAttack(u)) &&
    !lineBlocked(u.zone, broken.zone)                       // #44：协助攻击无论远近都不能穿墙，被墙隔开的不能选
  );
}

/** 协助攻击要拿着武器（手册：未持武器时先召回武器再发动）：手里有武器，或者场上有活着、耐久没归零的武器人可以召回 */
function assistWeaponReady(u) {
  if (!isUnarmed(u)) return true;
  return fieldUnits().some(w => isWeaponUnit(w) && (w.weaponOf === u.kit || (u.linkedKits || []).indexOf(w.kit) >= 0) &&
    !(typeof weaponUnusable === "function" && weaponUnusable(w.kit)));
}

function forceRecallWeapons(owner) {
  const notes = [];
  if (!owner) return notes;
  fieldUnits().filter(w => isWeaponUnit(w) && (w.weaponOf === owner.kit || (owner.linkedKits || []).indexOf(w.kit) >= 0)).forEach(w => {
    if (owner.kit === "hiaki") {
      if (w.kit === "niu") owner.resources.niuOut = false;
      if (w.kit === "naruto") owner.resources.narutoOut = false;
      refreshHiakiAtk(owner);
    } else {
      owner.weaponHeld = true;
      owner.atk = (owner.personalAtk || 0) + (owner.weaponAtk || 0);
    }
    w.hidden = true;
    notes.push(`${w.name} 因协助攻击被立刻收回为武器。`);
    // 开战前就坏了的武器收回来也不能用：照常空手（绯秋换另一把刀）；战斗中才坏的照常能用（减半）
    if (typeof weaponUnusable === "function" && weaponUnusable(w.kit) && typeof heldWeaponKit === "function" && heldWeaponKit(owner) === w.kit) {
      disarmBrokenWeapon(owner, notes);
    }
  });
  return notes;
}

/** 进入濒死时解除晕眩（倒地了就不再处于失衡状态） */
function clearStunOnDown(u) {
  if (!u) return;
  if (u.stunned && typeof featUnbowedReset === "function") featUnbowedReset(u);   // 决不后退：晕眩后重置
  u.stunned = false;
  if (u.statuses) u.statuses.unstable = false;
  u._imbalanceLock = false;
}

/** 倒地统一结算：单位的最内层生命被打到 0 之后调用（攻击、高能自爆、坠入深渊、桥塌坠落……都走这里）。
 *   · 玩家角色：力竭 3 → 立刻死亡；起身中（靠坚毅生命战斗）→ 这次的伤害改扣坚毅生命，扣光死亡，
 *     没扣光照常站着——不会重新濒死、再起身一次；其余 → 陷入濒死（倒地时解除晕眩）。
 *   · 武器人（含护送对象）、敌人等其他单位：死亡。
 * 调用前先把伤害扣在血量层上；最内层还有血、已经死亡、已经濒死的不再处理。
 * opt.shpLoss：起身中的人这次要扣的坚毅生命（攻击已由 applyResultToUnit 扣过，不传）；
 * opt.lethal：秒杀（高能自爆），起身中的人坚毅生命直接扣光；
 * opt.cause：写进记录的原因（「坠落」「高能自爆」…），不传按攻击的说法写。
 * 返回 "dead" / "dying" / "shp"（起身中，扣了坚毅生命还站着）/ null（没有倒地）。
 * 以前高能自爆、坠入深渊各写一套：绕过力竭 3 即死，起身中的人被炸 / 摔回濒死、坚毅不扣还能再起身。 */
function applyKnockdown(unit, notes, opt) {
  opt = opt || {};
  notes = notes || [];
  if (!unit || unit.dead || !isInnerDepleted(unit)) return null;
  if (unit.vehId && typeof vehiclePilotDown === "function") vehiclePilotDown(unit, notes);   // 驾驶员倒下：离开座位，车上下一个人接任（vehicle.js）
  if (unit.isPlayer && !isWeaponUnit(unit)) {
    if (unit.upOnShp) {
      const before = Math.max(0, Number(unit.shp) || 0);
      const loss = opt.lethal ? before : Math.max(0, Math.floor(Number(opt.shpLoss) || 0));
      if (loss <= 0) return "shp";
      unit.shp = Math.max(0, before - loss);
      if (unit.shp > 0) {
        notes.push(`${unit.name} 起身中，${opt.cause || "这次伤害"}改扣坚毅生命${shpHidden() ? "" : `（${before} → ${unit.shp}）`}。`);
        return "shp";
      }
      unit.dead = true;
      unit.upOnShp = false;
      unit.dying = false;
      if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(unit, notes);
      notes.push(`${unit.name} 起身中，${opt.cause ? opt.cause + "打光了坚毅生命" : "坚毅生命耗尽"}，死亡。`);
      return "dead";
    }
    if (unit.dying) return "dying";
    if (exhaustTierOf(unit) >= 3) {
      unit.dead = true;
      unit.dying = false;
      if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(unit, notes);
      notes.push(`${unit.name} 力竭 3：被击倒后立刻死亡。`);
      return "dead";
    }
    // 还魂（feats.js）：每场一次，留 1 点生命并免伤到自己下回合开始（高能自爆这种秒杀也一样救）
    if (typeof featReviveCheck === "function" && featReviveCheck(unit, notes)) return null;
    unit.dying = true;
    noteKnockdown(unit);   // 战场数据：倒地次数
    clearStunOnDown(unit);
    if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(unit, notes);
    notes.push(opt.cause ? `${unit.name} ${opt.cause}导致最内层归零，陷入濒死。`
      : `${unit.name} 最内层生命归零，陷入濒死。不能靠治疗起身，可消耗起身改用坚毅生命继续战斗。`);
    return "dying";
  }
  unit.dead = true;
  // 敌人被环境 / 规则直接弄死（高能自爆、坠落、窒息）：补上击杀结算（经验、奎支、击杀数、手下被打倒），_xpGiven 保证只结算一次
  if (!unit.isPlayer && typeof settleEnemyKill === "function") settleEnemyKill(unit, notes);
  if (unit.isPlayer) notes.push(`${unit.name} 最内层归零，武器人倒下。`);
  if (unit.isPlayer && isWeaponUnit(unit) && !unit.escort) onWeaponUnitDown(unit, notes);
  else if (opt.cause && !opt.lethal) notes.push(`${unit.name} ${opt.cause}致死（最内层归零）。`);
  return "dead";
}

/* ===== 武器人倒下与取回 =====
 * 倒下的那一刻扣 2 点耐久（以前在战斗结束时扣），这把武器本场记为「倒下过」。
 * 主人走到它倒下的区，花 1 行动点「取回武器」：拿回手里，本场不能再唤出，武器提供的 atk 和格挡加成减半
 * （战斗中修好耐久也一样减半）。这一场里耐久扣到 0 的照样能取回、能用（减半）；只有开战前就坏了的武器才完全用不了。 */
function onWeaponUnitDown(u, notes) {
  state.weaponFallen = state.weaponFallen || {};
  if (!state.weaponFallen[u.kit]) state.weaponFallen[u.kit] = "down";
  if (!u._durCounted && typeof spendDurability === "function") {
    u._durCounted = true;
    spendDurability(u.kit, 2, "武器人被击败", notes);
  }
  const owner = typeof weaponOwnerUnit === "function" ? weaponOwnerUnit(u) : null;
  if (owner && !owner.dead) notes.push(`${owner.name} 可以走到 ${u.zone} 区花 1 行动点取回 ${u.name}（本场不能再唤出，武器 atk 和格挡加成减半）。`);
}
/** 这把武器本场倒下过：主人拿着它时武器 atk、格挡加成减半 */
function weaponHalved(kit) {
  return !!(kit && state.weaponFallen && state.weaponFallen[kit]);
}
/** 这个角色倒在场上、还没取回的武器人 */
function fallenWeapons(owner) {
  if (!owner || !owner.isPlayer || owner.weaponOf || owner.dead) return [];
  const kits = [owner.kit].concat(owner.linkedKits || []);
  return (state.units || []).filter(u => u && u.isPlayer && u.dead && !u.hidden && !u._removed && !u.escort &&
    typeof isWeaponUnit === "function" && isWeaponUnit(u) && (u.weaponOf === owner.kit || kits.includes(u.kit)));
}
function retrieveWeapon(owner, w, lines) {
  w.hidden = true;            // 收回手里：不再留在场上（仍记为倒下，本场不能再唤出）
  w._retrieved = true;
  state.weaponFallen = state.weaponFallen || {};
  state.weaponFallen[w.kit] = "back";
  const broken = typeof weaponUnusable === "function" && weaponUnusable(w.kit);
  if (owner.kit === "hiaki") {
    owner.resources = owner.resources || {};
    if (w.kit === "niu") owner.resources.niuOut = false;
    if (w.kit === "naruto") owner.resources.narutoOut = false;
    if (typeof refreshHiakiAtk === "function") refreshHiakiAtk(owner);
  } else if (!broken) {
    owner.weaponHeld = true;
  }
  lines.push(`${owner.name} 取回了 ${w.name}。本场不能再唤出，武器 atk 和格挡加成减半。`);
  if (broken) lines.push(`${w.name} 开战前就已经损坏，修好之前还是只能空手。`);
}

function queueAssistAttack(breaker, broken) {
  if (!broken) return;
  if (typeof isDownProtected === "function" && isDownProtected(broken)) return;
  const hpLeft = typeof totalHp === "function" ? totalHp(broken) : 1;
  if (broken.dead || (hpLeft <= 0 && !broken.upOnShp)) return;
  if (isUfoLeg(broken)) {
    clearUfoLegStun(broken);
    broken = (typeof ufoBodyOf === "function" ? ufoBodyOf(broken) : null);
    if (!broken || broken.def > 0) return;
  }
  if (broken._imbalanceLock) return;
  if (typeof preyBroken === "function" && preyBroken(breaker, broken)) return;   // 尘虫 / 管虫失衡：被沙鱼吞掉（desert.js）
  if (broken.isPlayer && typeof bpFirstBreakGuard === "function" && bpFirstBreakGuard(broken)) return;
  breaker = assistBreaker(breaker, broken);
  const list = eligibleAssisters(breaker, broken);
  const side = broken.isPlayer || (breaker && !breaker.isPlayer) ? "敌人" : "玩家角色";
  if (!list.length) {
    appendLog(`${broken.name} 失衡，但没有可发动协助攻击的${side}。`);
    return;
  }
  broken._imbalanceLock = true;
  state.assistQueue = state.assistQueue || [];
  if (state.assistQueue.some(j => j.targetId === broken.id)) {
    presentAssistModal();
    return;
  }
  state.assistQueue.push({
    breakerId: breaker ? breaker.id : null,
    targetId: broken.id,
    vsPlayer: !!broken.isPlayer || !!(breaker && !breaker.isPlayer)   // 敌人那边出手协助（AI 选人）
  });
  appendLog(`${broken.name} 失衡。可协助攻击的${side}：${list.map(u => u.name).join("、")}。`);
  presentAssistModal();
}

function presentAssistModal() {
  if (!HAS_DOM) return;
  if (!state.assistQueue) state.assistQueue = [];
  pruneAssistQueue();
  if (!state.assistQueue.length) {
    const modal = uiEl("assistModal");
    if (modal) modal.classList.add("hidden");
    return;
  }
  const job = state.assistQueue[0];
  const breaker = unitById(job.breakerId);
  const target = unitById(job.targetId);
  const list = eligibleAssisters(breaker, target);
  const modal = uiEl("assistModal");
  const text = uiEl("assistModalText");
  const box = uiEl("assistModalBtns");
  if (!modal || !box) return;
  if (job.vsPlayer) {
    text.textContent = `${target ? target.name : "玩家"} 陷入失衡。选择一名敌人发动协助攻击。飞碟触灵可以由自己造成的失衡接协助攻击。${breaker && breaker.kit !== "ufo_body" ? breaker.name + " 作为造成失衡者不能为自己这一击发动。" : ""}被危墙 / 关着的机关门隔开的敌人不能协助攻击。`;
  } else {
    text.textContent = `${target ? target.name : "敌人"} 陷入失衡。选择一名其他玩家角色发动协助攻击。飞碟触灵本体失衡时也可被协助攻击；${breaker ? breaker.name : "造成失衡者"} 不能为自己这一击发动；被危墙 / 关着的机关门隔开的角色不能协助攻击。`;
  }
  box.innerHTML = "";
  list.forEach(h => {
    const b = document.createElement("button");
    b.className = "btn primary";
    b.textContent = `${h.name} 协助攻击`;
    b.onclick = () => calcCommand("assistAnswer", { helper: h.id });
    box.appendChild(b);
  });
  const no = document.createElement("button");
  no.className = "btn";
  no.textContent = "不发动";
  no.onclick = () => calcCommand("assistAnswer", { helper: null });
  box.appendChild(no);
  modal.classList.remove("hidden");
}

function finishAssist(helperId, extra) {
  const job = (state.assistQueue || []).shift();
  const modal = uiEl("assistModal");
  if (modal) modal.classList.add("hidden");
  extra = extra || {};
  if (!job) return;
  const target = unitById(job.targetId);
  if (assistTargetGone(target)) {
    if (target) target._bossAssistWindow = false;
    appendLog(`${target ? target.name : "目标"} 已经倒下，协助攻击取消。`);
    presentAssistModal();
    return;
  }
  if (!helperId) {
    target._bossAssistWindow = false;
    appendLog("没有人发动协助攻击。");
    presentAssistModal();
    return;
  }
  const helper = unitById(helperId);
  if (!helper || !target) { if (target) target._bossAssistWindow = false; presentAssistModal(); return; }
  // 先确认这个人真能出手，再召回武器、回满架势（以前先回满架势再判，空手 / 濒死的人选上了白回架势、啥也没打）
  if (!eligibleAssisters(unitById(job.breakerId), target).some(u => u.id === helper.id)) {
    appendLog(`${helper.name} 现在不能发动协助攻击，请另选。`);
    state.assistQueue.unshift(job);
    presentAssistModal();
    return;
  }
  const notes = helper.isPlayer ? forceRecallWeapons(helper) : [];
  if (helper.kit === "longge" && extra.mode) {
    helper.resources = helper.resources || {};
    helper.resources.assistMode = extra.mode === "gun" ? "gun" : "cane";
    helper.resources.assistHeal = typeof extra.heal === "string" ? extra.heal : null;
  }
  if (helper.kit === "hiaki" && extra.blade) {
    helper.resources = helper.resources || {};
    helper.resources.blade = extra.blade;
    if (typeof refreshHiakiAtk === "function") refreshHiakiAtk(helper);
    notes.push(`绯秋切换为${extra.blade === "naruto" ? "鳴門" : "丹生谷"}。`);
  }
  if (typeof canRestorePosture !== "function" || canRestorePosture(helper)) {
    helper.def = typeof postureCap === "function" ? postureCap(helper) : helper.defMax;
    notes.push(`${helper.name} 发动协助攻击，架势回满。`);
  } else {
    notes.push(`${helper.name} 发动协助攻击（千钧：架势不恢复）。`);
  }
  appendLog(notes.join("\n"));
  if (helper.isPlayer) { const ast = battleStat(helper); if (ast) ast.assists = (ast.assists || 0) + 1; }   // 战场数据：协助攻击
  const prevAtk = state.attackerId;
  const prevT = state.targetId;
  state.attackerId = helper.id;
  state.targetId = target.id;
  const sid = uiEl("skillTargetSel");
  if (sid) sid.value = target.id;
  const sidSkill = job.vsPlayer
    ? (typeof enemyAssistSkillId === "function" ? enemyAssistSkillId(helper) : "en_aa")
    : assistSkillId(helper);
  state._assistBy = helper.id;      // 协助攻击期间（图纸「恶眼」的伤害加成看这个）
  const prevAssistOf = RAGE_HOLD.assistOf;
  RAGE_HOLD.assistOf = target;     // 易怒蛮牛：这次协助攻击打到 target 的每一下都算这次失衡（rageBlocked）
  try { runSkill(sidSkill); } finally { state._assistBy = null; target._bossAssistWindow = false; RAGE_HOLD.assistOf = prevAssistOf; }
  state.attackerId = prevAtk;
  state.targetId = prevT;
  if (typeof fishFrenzyContinue === "function") fishFrenzyContinue(job, helper, target);   // 沙鱼群起：下一只接着上
  renderAll();
  presentAssistModal();
}

/** 敌人替 target 自动格挡时，u 是不是它的自己人：同一伙（不敌对）、都不是中立生物、对我方的立场一样（都是 / 都不是友军）。
 *  多阵营混战里按阵营判断（作者 10/19 反馈：敌人会错误地保护不该保护的单位）：
 *  以前只看「不敌对」——中立生物（谁都不当它是敌人）、我方友军阵营挡着的别家单位都会被护着 */
function enemyAllyOf(u, target) {
  if (!u || !target || u.isPlayer || target.isPlayer) return false;
  if (typeof isNeutralCreature === "function" && (isNeutralCreature(u) || isNeutralCreature(target))) return false;
  if (typeof playerAllied === "function" && playerAllied(u) !== playerAllied(target)) return false;
  return typeof hostileTo !== "function" || !hostileTo(u, target);
}

function autoEnemyBlockers(target, attacker) {
  if (!target || target.isPlayer || target.dead) return [];
  // 赤牙：受击时花 1 附赠为自己格挡（第九章，70%，见 party.js · FIXED_BLOCK）
  const self = target.kit === "chixia" && !target.stunned && (Number(target.bonus) || 0) >= 1 ? [target] : [];
  return self.concat(fieldUnits().filter(u => {
    if (u.isPlayer || u.id === target.id || u.stunned || u.dead || u.hidden || sinkLocked(u)) return false;
    if (Number(u.zone) !== Number(target.zone)) return false;
    if (!enemyAllyOf(u, target)) return false;   // 只替自己人挡（敌对阵营、中立生物、立场不同的友军都不挡）
    // 打过来的不是它的敌人（我方的友军阵营挡我方的攻击）：不出手
    if (attacker && (state.units || []).includes(attacker) && typeof hostileTo === "function" && !hostileTo(u, attacker)) return false;
    if (u.kit === "captain_ox") return true;
    if (u.kit === "patrol_car" && !(u.resources && u.resources.blockUsedThisTurn)) return true;
    return false;
  }));
}

/** 敌方的自动协助格挡：成功时目标免伤，击破由格挡者承担（最少留 1）；警卫队队长·牛成功后另外反击 1 击破（selfBreak） */
function tryOxAutoBlock(attacker, target, atkRange) {
  const oxes = autoEnemyBlockers(target, attacker);
  if (!oxes.length) return null;
  for (let i = 0; i < oxes.length; i++) {
    const ox = oxes[i];
    if (ox.kit === "patrol_car") {
      ox.resources = ox.resources || {};
      ox.resources.blockUsedThisTurn = true;
    }
    if (ox.id === target.id) ox.bonus = Math.max(0, (Number(ox.bonus) || 0) - 1);   // 赤牙为自己格挡：花 1 附赠
    const chance = finalBlockChance(ox, attacker, target, atkRange);
    const roll = 1 + Math.floor(Math.random() * 100);
    const ok = roll <= chance;
    appendLog(`${ox.id === target.id ? `${ox.name} 花 1 附赠为自己格挡` : `${ox.name} 自动协助格挡 ${target.name}`}：d100=${roll} 成功率 ${chance}% → ${ok ? "成功" : "失败"}`);
    if (!ok) continue;
    const selfBreak = ox.kit === "captain_ox";
    appendLog(selfBreak ? `成功：目标免伤，击破由 ${ox.name} 承担（架势最少留 1）。成功后反击 1 击破。`
      : `成功：目标免伤，击破由 ${ox.name} 承担（架势最少留 1）。`);
    if (attacker && selfBreak) {
      // 反击走 dealBreak：坚挺、塌陷计数、失衡后的协助攻击都照常（以前直接改架势）
      const notes = [];
      dealBreak(attacker, 1, "physical", notes, "队长牛反击", { by: ox });
      notes.forEach(s => appendLog(s));
    }
    return { ok: true, helperId: ox.id, selfBreak };
  }
  return { ok: false };
}

/** job：正在等格挡的那一击；已经试过（失败）的人不再列出（连续协助格挡） */
function eligibleBlockers(target, job) {
  if (!target || !target.isPlayer) return [];
  const tried = (job && job.tried) || [];
  const crushOut = (u) => !(typeof isCrushing === "function" && isCrushing(u));
  // 倒下的不能格挡：死亡的（倒下的武器人、坚毅耗尽的角色）；濒死但起不来的（力竭、坚毅耗尽）也不给「起身并格挡」
  const canStand = (u) => !u.dead && !(u.dying && !u.upOnShp && standUpBlocked(u));
  return state.units.filter(u =>
    u.isPlayer && !u.hidden && !u.isPartner && canStand(u) && (u.id !== target.id || isSoloHero(u)) &&   // 单人模式可以给自己协助格挡
    Number(u.zone) === Number(target.zone) &&
    !u.stunned && !sinkLocked(u) && crushOut(u) && ((u.bonus || 0) >= 1 || target.coverBy === u.id) &&
    blockChance(u) != null && tried.indexOf(u.id) < 0 &&
    (typeof bpCanAssistBlock !== "function" || bpCanAssistBlock(u))
  );
}

/** atkRange：这一击的射程（高地修正用，可不传） */
function performAssistBlock(helper, target, attacker, forced, atkRange) {
  const notes = [];
  forced = forced || {};
  // 死亡的单位不能格挡（以前倒下的武器人、坚毅耗尽的角色剩着附赠行动照样能挡，还扣耐久、触发被动）
  if (!helper || helper.dead || helper.hidden) {
    notes.push(`${helper ? helper.name : "格挡者"} 已经倒下，不能协助格挡。`);
    return { ok: false, notes, invalid: true };
  }
  // 濒死者不能直接格挡，但可以「起身并协助格挡」：先起身，再照常结算；起不来的（力竭、坚毅耗尽）不能格挡
  if (typeof isDownProtected === "function" && isDownProtected(helper)) {
    const why = standUpBlocked(helper);
    if (why) {
      notes.push(`${helper.name} ${why}，起不来，不能协助格挡。`);
      return { ok: false, notes, invalid: true };
    }
    standUp(helper);
    if (isDownProtected(helper)) return { ok: false, notes, invalid: true };
    notes.push(`${helper.name} 起身以进行协助格挡。`);
  }
  const freeCover = target && target.coverBy === helper.id;
  if (!freeCover && !spendBonus(helper, 1, "协助格挡")) return { ok: false, notes };
  if (freeCover) notes.push(`${helper.name} 因掩护免费格挡。`);
  if (helper.kit === "yuito" && target && target.id !== helper.id) {
    setBond(helper, target);
    notes.push(`思念：对 ${target.name} 施加牵挂（同时只能有一名）。`);
  }
  if (isUnarmed(helper)) {
    const chance = finalBlockChance(helper, attacker, target, atkRange);
    const roll = forced.roll != null ? Number(forced.roll) : (1 + Math.floor(Math.random() * 100));
    const ok = forced.ok != null ? !!forced.ok : roll <= chance;
    notes.push(`${helper.name} 空手格挡 ${target.name}：d100=${roll} 成功率 ${chance}% → ${ok ? "成功" : "失败"}`);
    if (ok) {
      notes.push("空手格挡成功：目标仍受一半伤害，架势照常扣（可能被打进失衡）。格挡者下回合附赠行动 −1。");
      helper.loseBonusNext = true;
    } else notes.push("空手格挡失败：目标照常受伤。");
    return { ok, notes, bare: true };
  }
  const chance = finalBlockChance(helper, attacker, target, atkRange);
  // 手册第六章：发动格挡 −1 耐久（空手格挡不扣，已在上面返回）
  if (typeof ledgerOnBlock === "function") ledgerOnBlock(helper, notes);
  const rolls = forced.roll != null ? [Number(forced.roll)] : [1 + Math.floor(Math.random() * 100)];
  if (forced.roll == null && helper.statuses && helper.statuses.advantage) rolls.push(1 + Math.floor(Math.random() * 100));
  const roll = Math.min.apply(null, rolls);
  let ok = forced.ok != null ? !!forced.ok : roll <= chance;
  notes.push(`${helper.name} 协助格挡 ${target.name}：d100=${rolls.join("/")} 成功率 ${chance}% → ${ok ? "成功" : "失败"}`);
  if (!ok && helper.kit === "tou" && (helper.resources.shield || 0) > 0) {
    helper.resources.shield -= 1; touShieldHeal(helper);
    const roll2 = 1 + Math.floor(Math.random() * 100);
    ok = roll2 <= chance;
    notes.push(`灯消耗 1 圣盾重掷 d100=${roll2} → ${ok ? "成功" : "失败"}（圣盾 ${helper.resources.shield}）`);
  }
  if (helper.kit === "hiaki" && helper.resources && helper.resources.stance === "iai") {
    ok = true;
    notes.push("居合下协助格挡必定成功。");
  }
  // 丹生谷「待命」：这一次协助格挡必定成功（用掉）
  const standbyUsed = !!(helper.resources && helper.resources.standby);
  if (standbyUsed) {
    helper.resources.standby = false;
    ok = true;
    notes.push("待命：这一次协助格挡必定成功。");
  }
  if (ok) {
    notes.push("成功：目标免伤，击破改由格挡者承担。");
    if (typeof bpAfterBlock === "function") bpAfterBlock(helper, target, notes);   // 单局图纸
    // 雷鸣：成功的协助格挡可以额外造成 等级 × 1d4 闪电伤害的反伤
    if (attacker && !attacker.dead && currentWeatherFor(helper) === "thunder") {
      const r = takeDice(Math.max(1, Number(helper.level) || 1), 4, 0);
      applyTypedDot(attacker, r.total, "electric", notes, `雷鸣：${helper.name} 格挡反伤 ${r.text}`, { by: helper.id });   // 反伤算格挡者的伤害（#187）
    }
    if (helper.kit === "nora" && attacker) setPierce(helper, attacker, notes);
    if (helper.kit === "vitas") flipMood(noraOf(), notes, "维塔斯格挡成功");
    if (helper.kit === "ruby" || helper.kit === "mint") {
      const ruby = findKit("ruby", state.units);
      if (ruby && ruby.resources && (typeof passiveOnKit !== "function" || passiveOnKit("ruby"))) {   // 放弃被动「纳米科技」就不加
        ruby.resources.nano = Math.min(100, (ruby.resources.nano || 0) + 20);
        notes.push(`纳米能源 +20 → ${ruby.resources.nano}`);
      }
    }
    if (helper.kit === "yuito") {
      notes.push(typeof beanToLiquid === "function" && beanToLiquid() ? "咖啡豆 → 咖啡液。" : "成功但没有咖啡豆可转化。");
    }
    if (helper.kit === "kolt" && attacker) {
      dealBreak(attacker, 1, "electric", notes, "协助格挡", { by: helper });
      queueKoltSwap(helper);
      notes.push("可选择是否更换刀头。");
    }
    if (helper.kit === "helu" && attacker) {
      const layer = ((attacker.layers || []).find(l => (l.current || 0) > 0) || {}).type;
      applyFocus(attacker, layer, notes);
    }
    if (helper.kit === "ras") addRasEnergy(20, "协助格挡");   // 无论成功与否都累积 20% 能量
    if (helper.kit === "longge") {
      longgePeek(helper, 1, notes);
      longgeUnlock(helper, notes, "协助格挡成功");
    }
    if (helper.kit === "xiaoxiao" && attacker && !attacker.dead) {
      // 成功时立刻反击：消耗 1 发子弹，一拳 1×atk 子弹属性伤害 + 2 击破
      const c = longgeTakeBullet(helper, notes);
      if (!c) notes.push("小朋友没有子弹，不能反击。");
      else {
        notes.push(`小朋友反击：一拳打向 ${attacker.name}（1×atk ${LONGGE_AMMO[c].name} + 2 击破）。`);
        hitOne2(helper, attacker, { element: LONGGE_AMMO[c].element, mult: 1, baseBreak: 2, atk: effectiveAtk(helper, state.units), atkRange: "melee", flags: { action: true, opportunity: true } }, notes);
      }
    }
    if (helper.kit === "ecmo") {
      notes.push("音波偏转：自身不扣除架势。");
    }
    if (standbyUsed && helper.kit === "niu") {
      const owner = ownerOfWeapon(helper, state.units);
      notes.push(...returnWeapon(helper));
      if (owner) {
        owner.resources.blade = "niu";
        setHiakiStance(owner, "iai");
        refreshHiakiAtk(owner);
        notes.push("待命格挡成功：丹生谷变回武器，绯秋换持丹生谷进入居合。");
      }
    }
    if (helper.kit === "hiaki" && helper.resources && helper.resources.powder) {
      // 粉落汤气：格挡成功不切刀势，用另一把刀反击 1atk（鳴門 +1 击破）
      const other = helper.resources.blade === "naruto" ? "niu" : "naruto";
      if (attacker && !attacker.dead) {
        notes.push(`粉落汤气：${helper.name} 用${other === "naruto" ? "鳴門" : "丹生谷"}反击 ${attacker.name}，刀势不变。`);
        hitOne2(helper, attacker, { element: other === "naruto" ? "ice" : "fire", mult: 1, baseBreak: other === "naruto" ? 1 : 0, atk: effectiveAtk(helper, state.units), atkRange: "any", flags: { action: true, opportunity: true } }, notes);
      }
    } else if (helper.kit === "hiaki") {
      const st = helper.resources.stance || "draw";
      if (st === "iai") {
        setHiakiStance(helper, "waki");
        notes.push("进入胁构。");
      } else if (st === "waki") {
        // 走 dealBreak：坚挺、塌陷计数照常，打空照样失衡、触发协助攻击（以前直接改架势）
        if (attacker) dealBreak(attacker, 1, "physical", notes, "胁构反伤", { by: helper });
        setHiakiStance(helper, "draw");
        notes.push("进入拔刀。");
      } else {
        setHiakiStance(helper, "iai");
        notes.push("进入居合。");
      }
    }
    if (helper.kit === "tou") {
      helper.zone = attacker ? attacker.zone : helper.zone;
      notes.push(`灯移动到进攻者所在 ${helper.zone} 区。`);
    }
    if (helper.kit === "mochi" && attacker && !attacker.isPlayer) {
      attacker.noMove = true;
      attacker.noMoveUntil = (Number(state.turnNo) || 0) + (state.combatPhase === "enemy" ? 1 : 0);   // 咬住 1 回合：到下一个敌人回合结束
      notes.push(`${attacker.name} 被年糕咬住，1 回合无法移动。`);
    }
    if (helper.kit === "xia" && attacker) {
      // 走 dealBreak：打空就失衡、触发协助攻击（以前直接改架势，敌人架势 0 却不失衡，下回合照常行动）
      dealBreak(attacker, 1, "physical", notes, "夕夏格挡反打", { by: helper });
      addFuel(1, "协助格挡", notes);   // #44：解锁燃油槽后协助格挡成功 +1 燃油（引擎开不开都给）
      if (helper.resources && helper.resources.engine) {
        const burn = Math.floor(effectiveAtk(helper, state.units) / 2);
        notes.push(`引擎格挡：追加 ${burn} 火焰。`);
        hitOne2(helper, attacker, { atk: 0, mult: 0, flat: burn, element: "fire", baseBreak: 0, atkRange: "melee", flags: { action: true, opportunity: true } }, notes);
      }
    }
    if (helper.kit === "berniel" && attacker) addFuel(1, "柏妮尔协助格挡", notes);   // #44：同上，引擎开不开都给
    if (helper.kit === "berniel" && attacker && ownerEngineOn("xia")) {
      notes.push("引擎下柏妮尔格挡成功：对进攻者打出 1×atk 物理。");
      hitOne2(helper, attacker, { element: "physical", mult: 1, baseBreak: 0, atk: effectiveAtk(helper, state.units), atkRange: "melee", flags: { action: true, opportunity: true } }, notes);
    }
    if (helper.kit === "chuan" && attacker) {
      dealBreak(attacker, 2, "electric", notes, "川川格挡", { by: helper });
      addCharge(1);
      notes.push("川川格挡：电能 +1。");
    }
    if (helper.kit === "bili" && attacker) {
      notes.push("哔哩哩格挡成功：反伤本次伤害的 50%（闪电），且自身不掉架势。");
    }
    if (helper.kit === "niu" || helper.kit === "naruto") {
      notes.push(...returnWeapon(helper));
    }
    const reflector = fieldUnits().find(u => u.isPlayer && u.resources && u.resources.allReflect);
    if (reflector && attacker) {
      const pkt = Number((state.lastResult && state.lastResult.intended) || (state.lastResult && state.lastResult.total) || attacker.atk || 0);
      if (pkt > 0) {
        dealTo(helper, attacker, { atk: 0, mult: 0, flat: pkt, element: "physical", baseBreak: 1, flags: { action: true, assist: true, blockResolved: true } });
        notes.push(`全反击：把伤害与击破反打给 ${attacker.name}。`);
      }
    }
    const striker = fieldUnits().find(u => u.isPlayer && !u.dead && u.resources && u.resources.guardStrike);
    if (striker && attacker && !striker.resources.guardStrikeUsed) {
      striker.resources.guardStrikeUsed = true;
      const sid = assistSkillId(striker);
      if (sid) {
        const prevA = state.attackerId, prevT = state.targetId;
        state.attackerId = striker.id;
        state.targetId = attacker.id;
        notes.push(`防守反击：${striker.name} 立刻对 ${attacker.name} 发动协助攻击。`);
        runSkill(sid, { ignorePhase: true, free: true });
        state.attackerId = prevA;
        state.targetId = prevT;
      } else {
        notes.push(`${striker.name} 没有协助攻击技能，防守反击未打出。`);
      }
    }
  } else {
    notes.push("失败：目标照常受伤。");
    if (helper.kit === "ras") addRasEnergy(20, "协助格挡失败");
  }
  return { ok, notes };
}

function openBlockModal(job) {
  if (!HAS_DOM) return;
  const modal = uiEl("blockModal");
  const text = uiEl("blockModalText");
  const box = uiEl("blockModalBtns");
  const attacker = blockJobAttacker(job);
  const target = unitById(job.targetId);
  const helpers = eligibleBlockers(target, job);
  const again = job.tried && job.tried.length;
  text.textContent = again
    ? `${attacker ? attacker.name : "敌人"} 的攻击还没落下：前面的协助格挡失败了，其他队友可以继续尝试。`
    : `${attacker ? attacker.name : "敌人"} 正在攻击 ${target ? target.name : "玩家"}。同区域有附赠行动的队友可以协助格挡：成功免伤，击破改由格挡者承担（最少留 1）；空手格挡成功受一半伤害。`;
  box.innerHTML = "";
  helpers.forEach(h => {
    const b = document.createElement("button");
    b.className = "btn primary";
    b.textContent = `${h.name} ${isUnarmed(h) ? "空手格挡" : "格挡"}（${finalBlockChance(h, attacker, target, job.opt && job.opt.atkRange)}%）`;
    b.onclick = () => calcCommand("blockAnswer", { helper: h.id });
    box.appendChild(b);
  });
  (typeof featIronwallDeclarers === "function" ? featIronwallDeclarers(target) : []).forEach(h => {
    const b = document.createElement("button");
    b.className = "btn primary";
    b.textContent = `${h.name} 以身作盾（必定挡住 · 每次短休一次）`;
    b.onclick = () => calcCommand("blockAnswer", { helper: "ironwall:" + h.id });
    box.appendChild(b);
  });
  const no = document.createElement("button");
  no.className = "btn";
  no.textContent = "不格挡";
  no.onclick = () => calcCommand("blockAnswer", { helper: null });
  box.appendChild(no);
  modal.classList.remove("hidden");
}

function closeBlockModal() {
  if (!HAS_DOM) return;
  const modal = uiEl("blockModal");
  if (modal) modal.classList.add("hidden");
}

/** 格挡队列里这一击的攻击者（场上单位，或者记下来的配置物） */
function blockJobAttacker(job) {
  if (!job) return null;
  return unitById(job.attackerId) || job.fakeAttacker || null;
}
function finishBlock(helperId, forced) {
  const job = (state.blockQueue || [])[0];
  const attacker0 = job ? blockJobAttacker(job) : null;
  const xf = job && job.opt && job.opt.flags;
  const title = !attacker0 ? "" : xf && xf.execution ? `【${attacker0.name}】${xf.execName || "死刑"} 第 ${xf.execHit}/${xf.execHits} 段落下` : `【${attacker0.name}】的攻击落下`;
  const prevActor = LOG_ACTOR_ID;
  LOG_ACTOR_ID = attacker0 ? attacker0.id : null;
  let lines;
  try { lines = withLogSink(() => finishBlockInner(helperId, forced)); } finally { LOG_ACTOR_ID = prevActor; }
  const block = tidyActionBlock(title, lines);
  if (block.length) appendLog(block.join("\n"));
  // 下水道狂鼠（enemies.js · ratfolkSweep）：等格挡的这一击落下之后再看一遍反应（斩杀等）
  if (typeof ratfolkSweep === "function" && !state._highDefer && !logSinkActive()) ratfolkSweep();
  renderAll();
  presentBlockModal();
}

function finishBlockInner(helperId, forced) {
  const job = (state.blockQueue || []).shift();
  closeBlockModal();
  if (!job) return;
  const attacker = blockJobAttacker(job);
  const target = unitById(job.targetId);
  let block = "none", blockHelperId = null;
  if (helperId && String(helperId).indexOf("ironwall:") === 0) {
    // 以身作盾（feats.js · ironwall）：宣布这一击视为协助格挡成功：免伤，击破由宣布的人承担（最少留 1），不花附赠动作
    const wall = unitById(String(helperId).slice("ironwall:".length));
    if (wall && typeof featIronwallDeclarers === "function" && featIronwallDeclarers(target).indexOf(wall) >= 0) {
      featUseOnce(wall, "ironwall");
      appendLog(`${wall.name} 以身作盾：这一击视为协助格挡成功。`);
      block = "assistOk";
      blockHelperId = wall.id;
      addScore("block", SCORE_RULES.block, wall);   // 评分：和协助格挡成功一样（#52）
      const bst = battleStat(wall);
      if (bst) { bst.blocks = (bst.blocks || 0) + 1; bst.blockOk = (bst.blockOk || 0) + 1; }
    }
  } else if (helperId) {
    const helper = unitById(helperId);
    const out = performAssistBlock(helper, target, attacker, forced, job.opt && job.opt.atkRange);
    appendLog(out.notes.join("\n"));
    if (out.ok && helper && helper.isPlayer) addScore("block", SCORE_RULES.block, helper);   // 评分：协助格挡成功
    const bst = out.invalid ? null : battleStat(helper);   // 战场数据：发动协助格挡（含失败），成功次数；倒下 / 起不来的不算发动
    if (bst) { bst.blocks = (bst.blocks || 0) + 1; if (out.ok) bst.blockOk = (bst.blockOk || 0) + 1; }
    block = out.ok ? (out.bare ? "bareOk" : "assistOk") : "fail";
    if (out.ok && !out.bare) blockHelperId = helperId;
    // 连续协助格挡：这个人没挡住，还有别人能挡 → 这一击先不落下，轮到剩下的人选
    if (!out.ok && attacker && target && !target.dead) {
      job.tried = (job.tried || []).concat(helperId);
      const rest = eligibleBlockers(target, job);
      if (rest.length) {
        appendLog(`${helper ? helper.name : ""} 没挡住 → ${rest.map(h => h.name).join("、")} 还可以接着协助格挡。`);
        state.blockQueue.unshift(job);
        return;
      }
    }
  } else if (job.tried && job.tried.length) {
    appendLog(`其他人不再格挡，${target ? target.name : ""} 照常受伤。`);
    block = "fail";
  } else {
    appendLog(`没有人协助格挡 ${target ? target.name : ""}。`);
  }
  const opt = job.opt || {};
  opt.flags = opt.flags || {};
  opt.flags.blockResolved = true;
  if (job.onConnect) opt.onConnect = job.onConnect;
  opt.flags.block = block;
  if (blockHelperId) opt.flags.blockHelperId = blockHelperId;
  if (attacker && target) {
    let out;
    const defBefore = target.def != null ? Number(target.def) || 0 : null;
    const captured = withLogSink(() => { out = dealTo(attacker, target, opt); });
    if (out && defBefore != null) out.defBefore = defBefore;
    if (out && out.res && !out.pending) formatHitLines(attacker, target, out, captured).forEach(s => appendLog(s));
    // 战场数据：格挡规避的伤害（协助格挡成功：这一击本来的伤害；空手格挡成功：少挨的那一半）
    // 以身作盾的 helperId 是「ironwall:单位」：记到宣布的人身上
    const saverUnit = blockHelperId ? unitById(blockHelperId) : helperId ? unitById(helperId) : null;
    const saver = saverUnit ? battleStat(saverUnit) : null;
    if (saver && out && out.res) {
      const saved = block === "assistOk" ? Number(out.res.blockedRaw) || 0 : block === "bareOk" ? Math.round(Number(out.res.total) || 0) : 0;
      saver.avoided = (saver.avoided || 0) + Math.max(0, saved);
      if (saved > 0) addScore("blockSave", Math.floor(saved * SCORE_RULES.blockSave), saverUnit);   // 评分：格挡减免的伤害
    }
  }
}

function presentBlockModal() {
  if (!HAS_DOM) return;
  if (!state.blockQueue) state.blockQueue = [];
  if (!state.blockQueue.length) return;
  openBlockModal(state.blockQueue[0]);
}

function resetBattleFlags(u) {
  if (!u) return;
  u.stunned = false;
  u.dying = false;
  u.dead = false;
  u.upOnShp = false;
  u.hidden = false;
  u.fused = false;
  u.tauntTo = null;
  u.noMove = false;
  u.coverBy = null;
  u.lockdownBy = null;
  u.shelterTurn = false;
  u.isolate = false;
  u.harshEnv = false;
  u.loseBonusNext = false;
  u.itemAtkBonus = 0;
  u.rallyAtk = 0;
  u.rallyBreak = 0;
  u.rallyBlock = 0;
  u.rallyHeal = false;
  u.rallyMove = false;
  delete u.rallyBuff;
  u.highEnergy = 0;
  u.highFrom = null;
  u._imbalanceLock = false;
  u.shpBurnBase = null;
  u.statuses = {
    burn: 0, shock: false, corr: false, frostbite: false, shockwave: false,
    high: false, reso: false, unstable: false, weak: false, inspire: false,
    sturdy: false, hide: false, advantage: false, chase: false, latestElement: null
  };
  u.instant = {};
  const r = u.resources = u.resources || {};
  delete r.rallyDr;   // 全队集结的坦克减伤只在那一场有效
  delete r.rallyOn;   // 施放者标记：晕眩 / 濒死时全体增益一起结束
  r.stance = "draw";
  r.smashOnce = true;
  r.smashNext = false;
  r.niuOut = false;
  r.narutoOut = false;
  r.mecha = false;
  r.tauntLeft = tauntCap(u);
  r.tauntTurn = null;
  r.roleOnce = {};
  r.prepared = false;
  r.preparedPending = false;
  r.preparedActive = false;
  r.weakNext = false;
  r.pierceNext = false;
  r.gambitArmed = false;
  r.gambitStrike = false;
  r.gambitWound = false;
  r.gritTurn = false;
  r.standTurn = false;
  r.guardStrike = false;
  r.guardStrikeUsed = false;
  r.allReflect = false;
  r.blockUsedThisTurn = false;
  // 专长（feats.js）：每场的次数、挂在下一击 / 这一回合上的效果
  r.featUsed = {};
  delete r.apGifts;
  delete r.whetDice; delete r.unstoppableNext; delete r.reviveGuard; delete r.alertGiven; delete r.attackSeq;
  r.chargeTurn = null; r.chargeUsed = null; r.blinkReady = null; r.blinkUsed = null;
  delete r.frenzyMoveTurn; delete r.frenzyMoves;   // 狂暴的免费移动按回合数记（effects.js），每场从头算
  if (u.kit === "hiaki" && !r.blade) r.blade = "niu";
  if (u.kit === "tou") r.shield = 0;
  if (!isWeaponUnit(u)) u.weaponHeld = true;
  if (u.kit === "xia") { r.engine = false; r.fuel = 0; }
  if (u.kit === "yuito") r.bean = Math.max(1, Number(r.bean) || 0);
  if (u.kit === "ruby" && r.nano == null) r.nano = 40;
  if (u.kit === "kolt") { r.bit = r.bit || "drill"; r.rotStore = {}; r.divertArmor = 0; r.stripStore = {}; }
  if (u.kit === "torque") { r.divertGuard = false; r.divertArmor0 = 0; }
  if (u.kit === "ecmo") { r.probe = false; r.probeZones = []; }
  if (u.kit === "ras") r.siphon = false;
  if (u.kit === "ruby") { r.drone = false; r.overdrive = false; delete r.nanoReserve; }   // 储备能源不跨战斗（#219）；纳米照旧
  if (u.kit === "hiaki") r.powder = false;
  if (u.kit === "niu") r.standby = false;
  if (u.kit === "ras") { r.energyPct = 0; r.light = 0; r.unstable = false; }
  if (u.kit === "helu") { r.scanned = false; r.lockLeft = roleLockCap(u); }
  if (u.kit === "torque") r.acidCharge = null;
  if (u.kit === "longge") { r.trigger = false; r.ammo = longgeOpeningAmmo(); r.seen = r.ammo.map(() => false); r.shuffleLock = false; r.known = 0; r.spitUsed = false; r.assistMode = null; }
  if (typeof canSpit === "function" && canSpit(u.kit)) r.spitElement = spitElementOf(u.kit);   // 吐酸的属性（长休时改，记在队伍档案）
  u.focuses = [];
  u.bondAtk = 0;
  u.duetAtk = 0;
  u.barrageBy = null;
  u.algoTurn = null;
  u._hurtRound = null;
  stripTempLayers(u);
  (u.layers || []).forEach(l => { l.current = l.max; });
  u.def = u.defMax;
  if (u.kit === "hiaki" && typeof refreshHiakiAtk === "function") refreshHiakiAtk(u);
}

/** 锁定每场能用几次：1 次，5 级 2 次，10 级 3 次 */
function roleLockCap(a) {
  const lv = Number(a && a.level) || 1;
  return lv >= 10 ? 3 : lv >= 5 ? 2 : 1;
}
/** 嘲讽每场能用几次：2 次，5 级 3 次，15 级 4 次（10 级前每回合只能用一次，10 级起一回合内可以用多次） */
function tauntCap(u) {
  const lv = Number(u && u.level) || 1;
  return lv >= 15 ? 4 : lv >= 5 ? 3 : 2;
}
/** 回合结束：职责「锁定」只锁这一回合，到点解开（主持人 / 全队集结的锁不动）；
 *  禁足怒吼「只能攻击坦克」也只到这一回合（不能移动的部分由 turnEnd 清 noMove） */
function releaseTurnLocks(notes) {
  if (state.weatherLockTurn) {
    state.weatherLockTurn = false;
    if (state.weatherLock) { state.weatherLock = null; if (notes) notes.push("天气锁定结束。"); }
  }
  Object.keys(state.fields || {}).forEach(z => {
    const f = state.fields[z];
    if (f && f.fieldLockTurn) {
      f.fieldLockTurn = false;
      if (f.fieldLock) { f.fieldLock = null; if (notes) notes.push(`${z} 区场地锁定结束。`); }
    }
  });
  (state.units || []).forEach(u => { if (u.lockdownBy) u.lockdownBy = null; });
}

/** 职责技能里「N 级起加强」看的等级：专长的涉猎版（feats.js · featNerfed）不吃这些加强 */
function roleSkillLv(a) {
  return a && a._dabbleNerf ? 1 : (Number(a && a.level) || 1);
}
function roleOnce(a, key, limit) {
  if (!a) return false;
  // 「长休一次」的技能记在队伍档案里，跨战斗保留，长休才刷新（守夜的人不刷新）
  if (typeof REST_ONCE_KEYS !== "undefined" && REST_ONCE_KEYS.indexOf(key) >= 0 && typeof useRestOnce === "function") {
    return useRestOnce(a.kit, key, limit);
  }
  a.resources = a.resources || {};
  a.resources.roleOnce = a.resources.roleOnce || {};
  const n = a.resources.roleOnce[key] || 0;
  if (n >= (limit || 1)) return false;
  a.resources.roleOnce[key] = n + 1;
  return true;
}

/* 有次数限制的职责技能（玩家手册第六步职责表）：技能 id → roleOnce 里记次数的名字、每场能用几次。
 * 技能里扣次数（roleSpend）和 SKILL_REQUIREMENT 判「用完了」（roleCapWhy）都读这张表，
 * 用完了在扣行动点 / 附赠动作之前就拦下、按钮变灰（以前先扣点，进了技能才说「已用完」）。 */
const roleLv = (a) => Number(a && a.level) || 1;
const ROLE_USE_CAP = {
  role_refine:      { key: "refine",     name: "精益求精", cap: a => roleLv(a) >= 15 ? 2 : 1 },
  role_pierce:      { key: "pierce",     name: "一击制敌", cap: () => 1 },
  role_gambit:      { key: "gambit",     name: "破釜沉舟", cap: () => 1 },
  role_double_dot:  { key: "doubleDot",  name: "加倍计量", cap: () => 1 },
  role_halve:       { key: "halve",      name: "折戟",     cap: () => 1 },
  role_omen:        { key: "omen",       name: "击破预告", cap: () => 1 },
  role_grit:        { key: "grit",       name: "咬牙坚持", cap: () => 2 },
  role_stand:       { key: "stand",      name: "屹立不倒", cap: () => 1 },
  role_fear:        { key: "fear",       name: "恐惧怒吼", cap: a => roleLv(a) >= 15 ? 3 : 2 },
  role_all_reflect: { key: "allReflect", name: "全反击",   cap: () => 1 },
  role_buffer:      { key: "buffer",     name: "缓冲",     cap: a => roleLv(a) >= 15 ? 2 : 1 },
  role_dome:        { key: "dome",       name: "防护罩",   cap: () => 1 },
  role_renew:       { key: "renew",      name: "续命",     cap: () => 1 },
  role_lock:        { key: "lock",       name: "锁定",     cap: a => roleLockCap(a) },
  role_shelter:     { key: "shelter",    name: "保释",     cap: a => roleLv(a) >= 15 ? 3 : 2 },
  role_harsh:       { key: "harsh",      name: "恶劣环境", cap: () => 1 },
  role_apocalypse:  { key: "apocalypse", name: "末日",     cap: () => 1 },
  role_shake:       { key: "shake",      name: "撼动",     cap: () => 1 },
  role_rearrange:   { key: "rearrange",  name: "重整",     cap: () => 1 },
  role_gold:        { key: "gold",       name: "黄金时间", cap: () => 2 },
  role_rally:       { key: "rally",      name: "全队集结", cap: () => 1, rest: true }   // 一次长休限一次
};
/** 已经用了几次（只看不记）。「长休一次」的记在队伍档案里 */
function roleUsed(a, key) {
  if (!a) return 0;
  if (typeof REST_ONCE_KEYS !== "undefined" && REST_ONCE_KEYS.indexOf(key) >= 0 && typeof LEDGER !== "undefined") {
    return Number(((LEDGER.restOnce || {})[a.kit] || {})[key]) || 0;
  }
  return Number(((a.resources || {}).roleOnce || {})[key]) || 0;
}
/** 这个职责技能还能用几次（没有次数限制的返回 Infinity） */
function roleUsesLeft(a, id) {
  const c = ROLE_USE_CAP[id];
  return c ? Math.max(0, c.cap(a) - roleUsed(a, c.key)) : Infinity;
}
/** 用完了返回原因，还能用返回 null */
function roleCapWhy(a, id) {
  const c = ROLE_USE_CAP[id];
  if (!c || roleUsesLeft(a, id) > 0) return null;
  return c.rest ? `${c.name}这次长休已经用过` : `本场${c.name}已用完（每场 ${c.cap(a)} 次）`;
}
/** 用掉一次（技能里调）；用完了返回 false */
function roleSpend(a, id) {
  const c = ROLE_USE_CAP[id];
  return c ? roleOnce(a, c.key, c.cap(a)) : true;
}

/* 传播（异常二）：复制一个单位身上的状态效果，施加到另一个单位。
 * 只复制七种属性状态效果；即时效果（熔融、错位……）、通用状态（虚弱、坚挺……）不复制。
 * 不会拿来源身上「没有」的东西去盖掉承受者已有的状态：灼烧按施加叠层（承受者原有层数 + 来源层数），
 * 高能值取两边较大的，其余是有 / 没有，承受者已有的保持不变。承受者自我效果的免疫照常（自焚、霜结、溅射、导体）。 */
const SPREAD_STATUS = ["burn", "shock", "corr", "frostbite", "shockwave", "high", "reso"];
const SPREAD_IMMUNE = { burn: "burn", frostbite: "frost", corr: "splash", shock: "conductor" };   // 状态 → 免疫它的自我效果
/** 单位身上能被传播出去的属性状态 */
function spreadKeys(u) {
  const st = (u && u.statuses) || {};
  return SPREAD_STATUS.filter(k => k === "burn" ? (Number(st.burn) || 0) > 0
    : !!st[k]);   // 高能只看高能状态，蓄能攒的高能值不算
}
/** 从 src 传播到 dest，真正会加上的状态（空数组 = 传过去没有变化） */
function spreadPlan(src, dest) {
  if (!src || !dest || src.id === dest.id) return [];
  const st = dest.statuses || {};
  return spreadKeys(src).filter(k => {
    if (SPREAD_IMMUNE[k] && dest.self === SPREAD_IMMUNE[k]) return false;
    if (k === "burn") return true;
    if (k === "high") return !st.high || (Number(src.highEnergy) || 0) > (Number(dest.highEnergy) || 0);
    return !st[k];
  });
}
/** 场上能当传播来源的单位：身上有属性状态，而且至少有一个别的单位接得住 */
function spreadSources() {
  const live = fieldUnits().filter(u => !u.fused);
  return live.filter(u => spreadKeys(u).length && live.some(v => spreadPlan(u, v).length));
}
/** 执行传播，返回加上去的状态（文字） */
function copyStatuses(src, dest, notes) {
  const got = [];
  if (!src || !dest) return got;
  notes = notes || [];
  dest.statuses = dest.statuses || {};
  spreadPlan(src, dest).forEach(k => {
    if (k === "burn") {
      const n = Math.floor(Number(src.statuses.burn) || 0);
      grantBurn(dest, n, notes);
      got.push(`灼烧 ${n} 层`);
    } else if (k === "high") {
      dest.statuses.high = true;
      dest.highEnergy = Math.max(Number(dest.highEnergy) || 0, Number(src.highEnergy) || 0);
      popStatus(dest, "high");
      got.push(`高能 ${dest.highEnergy}`);
    } else {
      dest.statuses[k] = true;
      popStatus(dest, k);   // 震荡顺带扣架势上限（syncShockwave）
      got.push(STATUS_POP[k].name);
    }
  });
  if (got.length && src.statuses && src.statuses.latestElement) dest.statuses.latestElement = src.statuses.latestElement;
  if (dest.statuses.high) checkHighBoom(dest);   // 高能值超过血量当场自爆
  return got;
}

/* 黄金时间（辅助三）：延长一个单位身上的一种即时效果。延长的那一种记在 instant.goldHold（结算按「有没有」判断照旧可用）。
 * 即时效果的中文名 INSTANT_NAME 和回合开始的保留逻辑在前面「黄金时间」那一段（goldHeldInstants） */
/** 单位身上能被黄金时间延长的即时效果（已经在延长的那一种不再列） */
function goldKeys(u) {
  const ins = (u && u.instant) || {};
  return Object.keys(INSTANT_NAME).filter(k => ins[k] && ins.goldHold !== k);
}
/** 加倍计量能翻倍的状态：属性状态 + 通用状态（有任何一种就行） */
function hasAnyStatus(u) {
  const st = (u && u.statuses) || {};
  return spreadKeys(u).length > 0 || ["unstable", "weak", "inspire", "sturdy", "hide", "advantage", "chase"].some(k => !!st[k]);
}
/** 保释分步里依次选的几名友方（联机只转发 online-view.js 白名单里的分步名，所以用现成的这几个） */
const SHELTER_PICKS = ["target", "target2", "ally"];
/** 保释能选的友方：除自己以外在场、这一回合还没被保释的友方 */
function shelterAllies(a) {
  return fieldUnits().filter(u => u.isPlayer && (!a || u.id !== a.id) && !u.fused && !u.shelterTurn);
}
/** 借力能移动的友方：任意位置的其他友方（被定住、千钧这类不能被移动的不算） */
function boostAllies(a) {
  return fieldUnits().filter(u => u.isPlayer && (!a || u.id !== a.id) && !u.fused && canDisplace(u));
}

/** 目标身上可以被「激活」的状态。返回 [{ key, label }]，空数组表示没有可激活的东西。 */
function activatableStatuses(t) {
  const out = [];
  if (!t) return out;
  const st = t.statuses || {};
  const stacks = Math.max(0, Math.floor(Number(st.burn) || 0));
  if (stacks > 0) out.push({ key: "burn", label: `灼烧 ${stacks} 层` });
  if (st.shock) out.push({ key: "shock", label: "感电" });
  if (st.corr) out.push({ key: "corr", label: "腐蚀" });
  if (st.frostbite) out.push({ key: "frostbite", label: "冻伤" });
  if (st.shockwave) out.push({ key: "shockwave", label: "震荡" });
  if (st.high) out.push({ key: "high", label: `高能 ${Number(t.highEnergy) || 0}` });
  return out;
}

/** 激活一种状态：效果与「触发一次该状态的回合结束结算」完全相同。
 *  灼烧一次性触发全部层；冻伤触发一次击破；其余同理。
 *  key 省略时取第一个可激活的状态。 */
function triggerOneStatus(t, src, key) {
  const notes = [];
  if (!t) return ["没有目标。"];
  if (typeof selfImmunities === "function") selfImmunities(t, notes);   // 自焚的灼烧、霜结的冻伤这类免疫的状态先清掉，不会被激活
  const list = activatableStatuses(t);
  if (!list.length) {
    notes.push(`${t.name} 身上没有可激活的状态。`);
    return notes;
  }
  const pick = list.find(x => x.key === key) || list[0];
  const weather = currentWeatherFor(t);
  t.statuses = t.statuses || {};
  // 和回合结束的那次结算一样：加倍计量让状态效果翻倍，恶劣环境 / 末日让天气的修正翻倍
  const sm = statusMult(t);
  const ex = envMult(t);

  if (pick.key === "burn") {
    const d = statusDotDice("burn", t.level, weather);
    const stacks = Math.max(1, Math.floor(Number(t.statuses.burn) || 0));
    const parts = [];
    let dmg = 0;
    for (let i = 0; i < stacks; i++) {
      const r = takeDice(d.n, d.s, 0);
      dmg += r.total;
      parts.push(r.text);
    }
    applyTypedDot(t, dmg * sm, "fire", notes, `${t.name} 激活灼烧 ${stacks} 层：${parts.join(" + ")} = ${dmg}${sm > 1 ? ` ×2（加倍计量）= ${dmg * sm}` : ""}`);
    let add = 1;
    if (weather === "heat") add += ex;
    if (weather === "snow") add = 0;
    t.statuses.burn = stacks + add;
    if (add) notes.push(`${t.name} 灼烧结算后叠层 +${add} → ${t.statuses.burn}`);
    return notes;
  }
  if (pick.key === "shock") {
    notes.push(`${t.name} 激活感电。`);
    notes.push(...shockPulse(t));
    return notes;
  }
  if (pick.key === "corr") {
    const armor = (t.layers || []).some(l => l.type === "armor" && l.current > 0);
    const d = statusDotDice("corr", t.level, weather, armor, ex);
    const r = takeDice(d.n, d.s, 0);
    applyTypedDot(t, r.total * sm, "acid", notes, `${t.name} 激活腐蚀 ${r.text}${sm > 1 ? " ×2（加倍计量）" : ""}`);
    return notes;
  }
  if (pick.key === "frostbite") {
    let br = weather === "snow" ? 2 * ex : 1;
    if (t.frostbiteBreakOverride != null) {
      br = Number(t.frostbiteBreakOverride) || 0;
      notes.push(`${t.name} 破冰：冻伤击破改为本次记录值 ${br}`);
      t.frostbiteBreakOverride = null;
    }
    if (weather === "heat") {
      notes.push(`${t.name} 酷暑：冻伤触发一次后结束`);
      t.statuses.frostbite = false;
    }
    notes.push(`${t.name} 激活冻伤。`);
    dealBreak(t, br * sm, "ice", notes, sm > 1 ? "冻伤 ×2（加倍计量）" : "冻伤", { by: src });
    return notes;
  }
  if (pick.key === "shockwave") {
    dealBreak(t, 1 * sm, "physical", notes, "激活震荡", { by: src });
    return notes;
  }
  if (pick.key === "high") {
    const dmg = (Number(t.highEnergy) || 0) * sm;
    // 这一下也是能量伤害：先累积高能值，再判自爆（applyTypedDotIn；行动里的照旧等行动结束统一判，只炸一次）
    applyTypedDot(t, dmg, "energy", notes, `${t.name} 激活高能 ${dmg}${sm > 1 ? "（加倍计量 ×2）" : ""}`, { highGain: "激活高能的能量伤害" });
    return notes;
  }
  notes.push(`${t.name} 身上没有可激活的状态。`);
  return notes;
}

// 全队集结·直伤：ATK 加成（applyRallyBuff 写 rallyAtk，party.js · effectiveAtk 读）
const RALLY_BUFF = { atk: 15 };

/** 清掉一名队员身上的全队集结增益（施放者晕眩 / 濒死时对所有拿到加成的队员调用） */
function clearRallyBuff(u, lines) {
  if (!u || !u.rallyBuff) return;
  const p = u.rallyBuff;
  if (p === "直伤") {
    const n = Number(u.rallyAtk) || 0;
    if (n) u.atk = (u.atk || 0) - n;
    u.rallyAtk = 0;
  } else if (p === "异常") {
    u.bonus = Math.max(0, (u.bonus || 0) - 1);
  } else if (p === "击破") {
    u.rallyBreak = 0;
  } else if (p === "坦克") {
    if (u.resources) delete u.resources.rallyDr;
  } else if (p === "护卫") {
    u.rallyBlock = 0;
  } else if (p === "生存") {
    u.rallyHeal = false;
  } else if (p === "环境手") {
    if (state.weatherLock && /集结锁定$/.test(String(state.weatherLock))) state.weatherLock = null;
  } else if (p === "控场") {
    u.rallyMove = false;
  }
  delete u.rallyBuff;
  if (lines) lines.push(`${u.name} 的全队集结增益结束。`);
}

/** 施放者晕眩或濒死（或直接死亡）时：全体队员的集结增益一起结束（主人确认：看施放者，不是每个拿到加成的人） */
function endRallyIfCasterDown(u, notes) {
  if (!u || !u.resources || !u.resources.rallyOn) return false;
  if (!(u.stunned || u.dying || u.dead)) return false;
  u.resources.rallyOn = false;
  const lines = notes || [];
  fieldUnits().filter(x => x && x.isPlayer).forEach(x => clearRallyBuff(x, lines));
  lines.push(`全队集结结束：施放者${u.dying || u.dead ? "濒死" : "晕眩"}。`);
  return true;
}

function applyRallyBuff(u, lines) {
  if (!u || !u.roles) return;
  const p = u.roles.primary;
  u.rallyBuff = p;
  if (p === "直伤") {
    u.rallyAtk = RALLY_BUFF.atk;   // 出手按 effectiveAtk 算，它读 rallyAtk；只改 u.atk 不加伤害（#340 第 16 条）
    u.atk = (u.atk || 0) + RALLY_BUFF.atk;
    lines.push(`${u.name} 直伤集结：ATK +${RALLY_BUFF.atk}。`);
  } else if (p === "异常") {
    u.bonus = (u.bonus || 0) + 1;
    lines.push(`${u.name} 异常集结：附赠 +1。`);
  } else if (p === "击破") {
    u.rallyBreak = 1;
    lines.push(`${u.name} 击破集结：造成击破 +1。`);
  } else if (p === "坦克") {
    u.resources = u.resources || {};
    u.resources.rallyDr = true;
    lines.push(`${u.name} 坦克集结：全属性减伤 15%。`);
  } else if (p === "护卫") {
    u.rallyBlock = 15;
    lines.push(`${u.name} 护卫集结：格挡成功率 +15%。`);
  } else if (p === "生存") {
    u.rallyHeal = true;
    lines.push(`${u.name} 生存集结：治疗与护盾 +50%。`);
  } else if (p === "环境手") {
    state.weatherLock = (state.weatherLock || u.name + "集结锁定");
    lines.push(`${u.name} 环境集结：天气锁定。`);
  } else if (p === "控场") {
    u.rallyMove = true;
    lines.push(`${u.name} 控场集结：可免费移动友方。`);
  }
}

function attackConnected(res, flags) {
  if (!res || res.pending || res.ok === false) return false;
  const b = (flags && flags.block) || (res.flags && res.flags.block);
  return b !== "assistOk" && b !== "bareOk";
}

/** 身上的灼烧层数 */
function burnStackCount(u) { return Math.max(0, Math.floor(Number(u && u.statuses && u.statuses.burn) || 0)); }
function runOnConnect(attacker, target, spec, res) {
  const notes = [];
  if (!spec || !target) return notes;
  // 这一击里真正打中的段数（多段攻击按段算；没有分段记录的算 1 段）
  const landed = () => {
    const ph = (res && res.perHit) || [];
    return ph.length ? ph.filter(h => (Number(h.dealt) || 0) > 0).length : 1;
  };
  if (spec.lifesteal && attacker && !attacker.dead) {
    // 燃气收集机：目标有灼烧时，每一段攻击恢复 最大血量 × lifesteal × 灼烧层数
    const stacks = Math.floor(Number(target.statuses && target.statuses.burn) || 0);
    if (stacks > 0) {
      const maxHp = (attacker.layers || []).reduce((sum, l) => sum + (Number(l.max) || 0), 0);
      const n = landed();
      const got = n > 0 && typeof healUnit === "function" ? healUnit(attacker, Math.round(maxHp * spec.lifesteal * stacks) * n) : 0;
      if (got > 0) notes.push(`${attacker.name} 从 ${target.name} 的灼烧（${stacks} 层）里吸收燃气：${n} 段，回复 ${got}。`);
    }
  }
  if (spec.burn || spec.burnPerHit) {
    const n = spec.burnPerHit ? landed() : Number(spec.burn) || 1;
    if (n > 0 && typeof grantBurn === "function") {
      const before = Number(target.statuses && target.statuses.burn) || 0;
      grantBurn(target, n, notes);
      const after = Number(target.statuses && target.statuses.burn) || 0;
      if (after > before) notes.push(`${target.name} 灼烧 +${after - before} → ${after} 层。`);
    }
  }
  if (spec.burnEach) {
    // 多段攻击每一段各掷一次（火焰喷射兵）：成功一次灼烧 +1
    const segs = ((res && res.perHit) || []).length || 1;
    let got = 0;
    for (let i = 0; i < segs; i++) if (Math.random() < spec.burnEach && typeof grantBurn === "function") { grantBurn(target, 1, notes); got++; }
    if (got) notes.push(`${target.name} 灼烧 +${got} → ${Number(target.statuses && target.statuses.burn) || 0} 层（${segs} 段各 ${Math.round(spec.burnEach * 100)}%）。`);
  }
  if (spec.instant && typeof applyInstantEffect === "function") {
    applyInstantEffect(target, spec.instant, notes);
    notes.push(`${target.name} 被施加${INSTANT_NAME[spec.instant] || spec.instant}。`);
  }
  if (spec.activate === "burn" && burnStackCount(target) > 0) {
    // 激活灼烧：目标没有灼烧就不触发（triggerOneStatus 没有灼烧时会改激活别的状态，这里先挡掉）
    notes.push(...triggerOneStatus(target, attacker, "burn"));
  }
  if (spec.dest != null) {
    const dest = Number(spec.dest);
    if (typeof displaceTo === "function") displaceTo(target, dest, notes, spec.reason || "被位移");
    else { target.zone = dest; notes.push(`${target.name} 被移到 ${dest} 区。`); }
  }
  if (spec.status) {
    target.statuses = target.statuses || {};
    target.statuses[spec.status] = spec.statusVal != null ? spec.statusVal : true;
    if (spec.status === "high" && attacker && attacker.kit === "ruby") tagHighFrom(target, "ruby");
    if (typeof popStatus === "function") popStatus(target, spec.status);
    const stName = ({ high: "高能", burn: "燃烧", shock: "感电", corr: "腐蚀", frostbite: "冻伤", weak: "虚弱" })[spec.status] || spec.status;
    notes.push(`${target.name} 被施加${stName}。`);
  }
  // 疫病暴徒（下水道狂鼠，enemies.js）：打中原本已经腐蚀的目标——撕扯 / 协助给自己回血，喷洒把腐蚀扩散到目标同区的所有敌人
  if (spec.selfHeal && typeof ratSelfHeal === "function") ratSelfHeal(attacker, spec.selfHeal, notes);
  if (spec.corrSpread && typeof ratPlagueSpread === "function") ratPlagueSpread(attacker, target, notes);
  if (spec.controlAlly) {
    const allies = (typeof allPlayers === "function" ? allPlayers() : []).filter(p =>
      p.id !== target.id && !p.dead && !p.dying && Number(p.zone) === Number(target.zone) && totalHp(p) > 0
    );
    if (allies.length) {
      const victim = allies[Math.floor(Math.random() * allies.length)];
      dealTo(target, victim, { atk: effectiveAtk(target, state.units), mult: 1, element: "physical", baseBreak: 1, flags: { action: true, blockResolved: true } });
      notes.push(`${target.name} 被操控，对 ${victim.name} 打出一次普通攻击。`);
    } else notes.push(`${target.name} 同区没有队友，操控未能转打队友。`);
  }
  if (spec.splash) {
    // 溅射（矿场看守机器人）：主攻击打中后，对目标那一区的其他敌对单位 mult×atk 范围伤害（不打同阵营，不能格挡）
    const sp = spec.splash;
    const others = (typeof enemiesOf === "function" ? enemiesOf(attacker) : []).filter(x =>
      x.id !== target.id && Number(x.zone) === Number(target.zone) && !(typeof isDownProtected === "function" && isDownProtected(x)));
    if (others.length) notes.push(`${attacker.name} 的攻击溅射到 ${others.map(x => x.name).join("、")}。`);
    others.forEach(x => dealTo(attacker, x, { atk: effectiveAtk(attacker, state.units), mult: sp.mult, element: sp.element || "acid", baseBreak: 0, flags: { action: true, aoe: true } }));
  }
  if (spec.spendAp) {
    target.ap = Math.max(0, (target.ap || 0) - spec.spendAp);
    notes.push(`${target.name} 行动点 −${spec.spendAp} → ${target.ap}`);
  }
  return notes;
}


const ATKFX = {
  combust: { name: "爆燃", element: "fire" },
  icebreak: { name: "破冰", element: "ice" },
  bolt: { name: "雷击", element: "electric" },
  etch: { name: "蚀刻", element: "acid" },
  backflow: { name: "倒流", element: "energy" },
  inertia: { name: "惯性", element: "physical" },
  diffract: { name: "衍射", element: "harmonic" }
};

/** 一次攻击带着的攻击效果（画面上打字用）：通用的 element 为 "generic" */
function attackFxWords(flags) {
  flags = flags || {};
  const out = [];
  if (flags.pierce) out.push({ name: "穿刺", element: "generic" });
  if (flags.smash) out.push({ name: "猛击", element: "generic" });
  if (flags.weak) out.push({ name: "弱点特效", element: "generic" });
  (flags.atkFx || []).forEach(id => { if (ATKFX[id]) out.push({ name: ATKFX[id].name, element: ATKFX[id].element }); });
  return out;
}

function hungAtkFx(unit) {
  if (!unit || !unit.resources) return [];
  const list = unit.resources.nextAtkFx;
  return Array.isArray(list) ? list.slice() : [];
}

function hangAtkFx(unit, id) {
  if (!unit || !ATKFX[id]) return;
  unit.resources = unit.resources || {};
  const cur = hungAtkFx(unit);
  if (cur.indexOf(id) < 0) cur.push(id);
  unit.resources.nextAtkFx = cur;
}

function armAtkFx(attacker, flags) {
  flags = flags || {};
  const fromHang = hungAtkFx(attacker);
  const fromBox = [];
  // 游戏模式（game.html）不读计算器界面的词条勾选框：那些勾选只给手动计算用，
  // 否则上次勾的「破冰」等会泄漏到技能攻击上（夕夏普攻、格挡反打等）
  if (!(typeof GAME_MODE !== "undefined" && GAME_MODE)) {
    ["combust","icebreak","bolt","etch","backflow","inertia","diffract"].forEach(id => {
      const el = uiEl("fFx_" + id);
      if (el && el.checked) fromBox.push(id);
    });
  }
  const list = [];
  fromHang.concat(fromBox).forEach(id => { if (list.indexOf(id) < 0 && ATKFX[id]) list.push(id); });
  flags.atkFx = list;
  if (list.indexOf("icebreak") >= 0) flags.icebreak = true;
  if (list.indexOf("etch") >= 0) flags.etchHit = true;
  if (list.indexOf("diffract") >= 0) flags.diffract = true;
  if (attacker && attacker.resources && fromHang.length) attacker.resources.nextAtkFx = [];
  return list;
}

function highestHpFoe(attacker, exceptId) {
  const pool = (typeof fieldUnits === "function" ? fieldUnits() : (state.units || [])).filter(u => {
    if (!u || u.dead || u.hidden || u.fused) return false;
    if (exceptId && u.id === exceptId) return false;
    if (u.kit === "ufo_body") return false;
    if (attacker && attacker.isPlayer) return !u.isPlayer;
    if (attacker && !attacker.isPlayer) return !!u.isPlayer;
    return true;
  });
  pool.sort((a, b) => totalCurHp(b) - totalCurHp(a));
  return pool[0] || null;
}

function inertiaShiftBoth(attacker, target, notes) {
  if (!attacker || !target) return;
  const mode = Number(state.zoneMode) || 2;
  const az = Number(attacker.zone) || 1;
  let dest;
  if (mode === 2) dest = az === 1 ? 2 : 1;
  else if (az !== Number(target.zone)) dest = Number(target.zone);
  else dest = az === 1 ? 2 : (az === 3 ? 2 : 1);
  const delta = dest - az;
  function step(u) {
    const nz = Number(u.zone) + delta;
    if (nz < 1 || nz > mode) return false;
    if (typeof displaceTo === "function") displaceTo(u, nz, notes, "惯性");
    else u.zone = nz;
    return true;
  }
  const aOk = step(attacker);
  const tOk = step(target);
  notes.push("惯性：攻击者与目标同向移动 1 格" + (aOk || tOk ? "。" : "（目标格无效，未移动）。"));
}

function applyAtkFxAfter(attacker, target, res, flags, extra, opt) {
  extra = extra || [];
  const list = (flags && flags.atkFx) || [];
  if (!list.length || !res || res.pending || !attackConnected(res, flags)) return extra;
  const ele = (opt && opt.element) || res.element || "physical";

  if (list.indexOf("icebreak") >= 0 && target && target.statuses && target.statuses.frostbite) {
    target.frostbiteBreakOverride = Number(res.breakDealt) || 0;
    extra.push("破冰：本回合结束时冻伤击破改为 " + target.frostbiteBreakOverride + "。");
  }

  if (list.indexOf("etch") >= 0 && target) {
    target.etchMarks = target.etchMarks || [];
    target.etchMarks.push({ element: ele, pct: 0.1 });
    extra.push("蚀刻：此后 " + (ELE[ele] || ele) + " 伤害 +10%，并视为被该属性克制。");
    if (target.statuses && target.statuses.corr) {
      target.etchMarks.push({ element: "acid", pct: 0.1 });
      extra.push("蚀刻 + 腐蚀：再叠一层酸易伤 +10%，视为被酸克制。");
    }
  }

  if (list.indexOf("backflow") >= 0 && attacker && (res.total || 0) > 0) {
    const heal = Math.floor((Number(res.total) || 0) * 0.25);
    if (heal > 0 && typeof healUnit === "function") {
      healUnit(attacker, heal);
      extra.push("倒流：攻击者恢复本次伤害 25% = " + heal + "。");
    }
    if (target && target.statuses && target.statuses.high) {
      const cut = Math.floor((Number(target.highEnergy) || 0) * 0.5);
      if (cut > 0) {
        if (typeof healUnit === "function") healUnit(attacker, cut);
        target.highEnergy = Math.max(0, (Number(target.highEnergy) || 0) - cut);
        extra.push("倒流 + 高能：再恢复高能值 50% = " + cut + "，目标高能 −" + cut + "。");
        if (typeof checkHighBoom === "function") checkHighBoom(target);
      }
    }
  }

  if (list.indexOf("bolt") >= 0) {
    const hits = (res.perHit && res.perHit.length) ? res.perHit : [{ dealt: res.total || 0 }];
    hits.forEach((h, i) => {
      const dealt = Number(h.dealt) || 0;
      if (dealt <= 0) return;
      const chunk = Math.floor(dealt * 0.25);
      if (chunk <= 0) return;
      let sink = highestHpFoe(attacker, target && target.id);
      if (!sink) sink = highestHpFoe(attacker, null);
      if (!sink) return;
      extra.push("雷击：第" + (i + 1) + "段 " + chunk + " 点转给当前最高血 " + sink.name + "。");
      const out = dealTo(attacker, sink, {
        atk: 0, mult: 0, flat: chunk, element: ele, baseBreak: 0,
        flags: { action: false, environment: true, blockResolved: true, atkFx: [] }
      });
      if (out && out.extra) extra.push.apply(extra, out.extra);
      if (sink.statuses && sink.statuses.shock) {
        extra.push("雷击 + 感电：再打一次等量电击。");
        const out2 = dealTo(attacker, sink, {
          atk: 0, mult: 0, flat: chunk, element: "electric", baseBreak: 0,
          flags: { action: false, environment: true, blockResolved: true, atkFx: [] }
        });
        if (out2 && out2.extra) extra.push.apply(extra, out2.extra);
      }
    });
  }

  if (list.indexOf("inertia") >= 0 && attacker && target) {
    inertiaShiftBoth(attacker, target, extra);
    if (target.statuses && target.statuses.shockwave) {
      dealBreak(target, 2, "physical", extra, "惯性 + 震荡");
    }
  }

  if (list.indexOf("diffract") >= 0 && target && target.statuses && target.statuses.reso && !target._resoBusy) {
    const share = target._resoFull ? Math.floor(Number(res.total) || 0) : Math.floor((Number(res.total) || 0) / 2);
    if (share > 0) {
      extra.push("衍射 + 共振：共享部分 " + share + " 回传一次。");
      target._resoBusy = true;
      applyTypedDot(target, share, ele, extra, "衍射回传", { highGain: "衍射回传能量伤害" });   // 能量攻击回传的也累积高能值
      target._resoBusy = false;
    }
  }

  // 爆燃要「杀死」目标：敌人 = 最内层归零；我方 = 被打倒（打进濒死也算被击倒，作者定）。
  // 靠坚毅生命站着的我方最内层本来就是 0，坚毅生命没打光就不算被打倒（以前每一击都会触发爆燃）
  const knockedDown = target && (target.isPlayer ? (typeof isUnitDown === "function" ? isUnitDown(target) : isInnerDepleted(target)) : (isInnerDepleted(target) || target.dead));
  if (list.indexOf("combust") >= 0 && knockedDown) {
    const over = Math.max(0, (Number(res.intended) || 0) - (Number(res.total) || 0));
    const foes = fieldUnits().filter(u => {
      if (!u || u.id === target.id || u.dead || u.hidden) return false;
      if (Number(u.zone) !== Number(target.zone)) return false;
      if (u.kit === "ufo_body") return false;
      if (attacker && attacker.isPlayer) return !u.isPlayer;
      if (attacker && !attacker.isPlayer) return !!u.isPlayer;
      return true;
    });
    if (over > 0 && foes.length) {
      extra.push("爆燃：溢出 " + over + " 打同区，各目标重算克制。");
      foes.forEach(u => {
        const out = dealTo(attacker, u, {
          atk: 0, mult: 0, flat: over, element: ele, baseBreak: 0,
          flags: { action: false, environment: true, aoe: true, blockResolved: true, atkFx: [] }
        });
        if (out && out.extra) extra.push.apply(extra, out.extra);
      });
    }
    if (target.statuses && Number(target.statuses.burn) > 0 && foes.length) {
      const stacks = Math.max(1, Math.floor(Number(target.statuses.burn) || 0));
      extra.push("爆燃 + 灼烧：按 " + stacks + " 层对同区再打一次灼烧。");
      foes.forEach(u => {
        const d = statusDotDice("burn", target.level || attacker.level || 1, currentWeatherFor(u));
        let dmg = 0;
        for (let i = 0; i < stacks; i++) dmg += takeDice(d.n, d.s, 0).total;
        applyTypedDot(u, dmg, "fire", extra, "爆燃灼烧×" + stacks);
      });
    }
  }
  return extra;
}

/** 一次 dealTo（含它自己结算的高压场地、共振、反弹等连带伤害）是「一击」：易怒蛮牛等这一击全部结算完再判（enemies.js · raceRageFlush） */
function dealTo(attacker, target, opt) {
  if (typeof raceRageFlush !== "function") return dealToInner(attacker, target, opt);
  RAGE_HOLD.depth++;
  let out, ok = false;
  try { out = dealToInner(attacker, target, opt); ok = true; }
  finally {
    RAGE_HOLD.depth--;
    // 中途出错：这一击作废，暂存的记录一起丢掉（不然会挂到下一次毫不相干的攻击上发作；意图预测还会留下指向模拟单位的记录）
    if (!ok && RAGE_HOLD.depth === 0) RAGE_HOLD.pending = [];
  }
  if (RAGE_HOLD.depth === 0) {
    const notes = raceRageFlush();
    if (notes.length) {
      // 打配置物 / 危墙的替身（dealToStructure）：formatHitLines 只输出 out.lines
      if (out && out.structure && Array.isArray(out.lines)) out.lines.push(...notes);
      else if (out && Array.isArray(out.extra)) out.extra.push(...notes);
      else appendLog(notes.join("\n"));
    }
  }
  return out;
}

function dealToInner(attacker, target, opt) {
  if (target) target._brokeNow = false;   // 新的一击：上一次「立刻恢复」留下的记号作废
  opt = opt || {};
  // 原始击破（后面会被目标一侧的效果改写，例如「加倍击破」翻倍）：导体额外那一下按它重新结算
  if (!("_origBaseBreak" in opt)) opt._origBaseBreak = opt.baseBreak;
  opt.flags = makeDealFlags(opt.flags);
  if (typeof vehicleSync === "function") vehicleSync();   // 被推 / 拉走的驾驶员：车和炮手先跟到他所在的区（vehicle.js）
  // 驻波墙：这次行动里技能直接换过区的单位，出手之前先把穿墙补算上（借机攻击是走的人离开那一下打的，不在这里补）
  if (state._waveLedger && !opt.flags.opportunity) waveLedgerSync();
  if (target && target.isStructure) return dealToStructure(attacker, target, opt);   // 打配置物 / 危墙的替身（#52）
  // 战场数据：击杀在伤害结算里就会发生，所以先记下「最后一击是谁」
  if (attacker && target && attacker.isPlayer && !target.isPlayer && (state.units || []).includes(attacker)) target._lastHitBy = attacker.id;
  else if (attacker && attacker.envSrc && target && !target.isPlayer) creditPlayerHit(target, (envOwnerUnit(attacker) || {}).id);   // 配置物打死的：击杀算触发者
  if (!opt.flags.atkFx) armAtkFx(attacker, opt.flags);
  if (opt.flags.diffract) {
    opt.flags.blockResolved = true;
    opt.flags.block = "none";
  }
  // 射程：近距离只能打距离 0，远距离只能打距离 1，任意距离 0–1。
  // 范围攻击、反应类（协助 / 借机 / 格挡）不受此限。
  // 借机 / 协助 / 格挡属于反应，不做射程与飞行附加代价判定：
  // 它们的触发条件本身已经限定了位置，再判一次距离反而会判错
  // （借机是目标已经离开那一区之后才结算的，此时距离必然是 1）
  const isReaction = !!(opt.flags.assist || opt.flags.opp || opt.flags.opportunity);
  // 导体的额外目标是随机击中的，不受射程限制
  // 配置物（防卫炮台）的自动攻击不限距离
  // 维塔斯对刺入目标出手（扯下 / 加压灌输）：针尖就在目标身上，不受距离限制（viaPierce）
  // 友军（和我方同阵营的敌人）：我方的攻击不打它（单体攻击打不出去，范围攻击跳过它）
  if (attacker && attacker.isPlayer && target && !target.isPlayer && typeof playerAllied === "function" && playerAllied(target) && !opt.flags.environment) {
    const msg = `${target.name} 是友军，不会被我方攻击。`;
    if (!opt.flags.aoe) appendLog(msg);
    return { res: { ok: false, total: 0, breakDealt: 0, log: [msg], perHit: [] }, extra: opt.flags.aoe ? [] : [msg] };
  }
  // 友军的攻击（包括原本打「同区所有我方」的范围攻击）不打我方
  if (attacker && !attacker.isPlayer && target && target.isPlayer && typeof playerAllied === "function" && playerAllied(attacker) && !opt.flags.environment) {
    return { res: { ok: false, total: 0, breakDealt: 0, log: [], perHit: [] }, extra: [] };
  }
  // anyRange：不限距离的攻击（矿场警戒自动机打所有高能的敌人）
  if (attacker && target && opt.flags.action && !opt.flags.aoe && !isReaction && !opt.flags.conductorExtra && !opt.flags.propShot && !opt.flags.locked && !opt.flags.viaPierce && !opt.flags.anyRange && !opt.flags.skillRange) {
    const d = zoneDist(Number(attacker.zone), Number(target.zone), Number(state.zoneMode));
    const rg = opt.atkRange || (attacker.isPlayer ? "any" : (attacker.range || "any"));
    const pointBlank = (typeof featHas === "function" && featHas(attacker, "pointblank"))   // 抵近射击（feats.js）
      || (typeof enemyForcedPointBlank === "function" && enemyForcedPointBlank(attacker, target));   // 被牵制又没有近身攻击的敌人（enemies.js）
    const okRange = rg === "melee" ? d === 0 : rg === "ranged" ? (d === 1 || (pointBlank && d === 0)) : d <= 1;
    if (!okRange) {
      const name = rg === "melee" ? "近距离" : rg === "ranged" ? "远距离" : "任意距离";
      const msg = `${attacker.name} 是${name}攻击，打不到距离 ${d} 的 ${target.name}。`;
      appendLog(msg);
      return { res: { ok: false, total: 0, breakDealt: 0, log: [msg], perHit: [] }, extra: [msg] };
    }
  }
  // 下潜（effects.js）：攻击时自己先浮上来；下潜中的目标只有谐波攻击（单体、范围都算）打得到，打到就被迫解除 +1 击破
  if (attacker && attacker.submerged && !attacker.envSrc && !opt.flags.environment) {
    const n = [];
    surfaceUnit(attacker, n, false, "发动攻击");
    n.forEach(t => appendLog(t));
  }
  if (target && target.submerged && attacker && !opt.flags.environment) {
    // 沙鱼的声呐找得到沙下的尘虫 / 管虫（捕食），不算把它打出来
    const fishPrey = typeof isSandFish === "function" && isSandFish(attacker) && isDesertPrey(target);
    if (!fishPrey && opt.element !== "harmonic") {
      const msg = `${target.name} 下潜中，${opt.flags.aoe ? "没有被波及" : "不能被选作攻击目标"}。`;
      if (!opt.flags.aoe) appendLog(msg);
      return { res: { ok: false, total: 0, breakDealt: 0, log: [msg], perHit: [] }, extra: opt.flags.aoe ? [] : [msg] };
    }
    if (!fishPrey) {
      const n = [];
      surfaceUnit(target, n, true, "谐波震", "harmonic");
      n.forEach(t => appendLog(t));
    }
  }
  // 躲藏：不会被选做攻击目标（范围攻击、反应不是「选目标」，照常波及）
  if (target && target.statuses && target.statuses.hide && opt.flags.action && !opt.flags.aoe && !isReaction && !opt.flags.conductorExtra && !opt.flags.locked) {
    const msg = `${target.name} 躲藏中，不能被选作攻击目标。`;
    appendLog(msg);
    return { res: { ok: false, total: 0, breakDealt: 0, log: [msg], perHit: [] }, extra: [msg] };
  }
  // 亡命之王：对他的攻击总被同区其他狂徒承受（被挟持时失效）
  if (target && target.kit === "outlaw_king" && !opt.flags.aoe && typeof kingGuardFor === "function") {
    const guard = kingGuardFor(target);
    if (guard) {
      appendLog(`${guard.name} 挡在 ${target.name} 身前，替他承受这次攻击。`);
      target = guard;
    }
  }
  // 载具（vehicle.js）：同区同阵营的单位挨打时，车每次各掷一次代挡（空车也算，范围攻击每人各掷）；成功就由车（驾驶员）承受这次攻击
  if (target && attacker && typeof vehicleGuard === "function") {
    const vg = vehicleGuard(attacker, target, opt);
    if (vg) {
      appendLog(`${vg.vehicle.name}替 ${target.name} 代挡了这次攻击（${Math.round(vg.chance * 100)}%）。`);
      if (vg.struct) return dealToStructure(attacker, vg.struct, opt);
      target = vg.unit;
    }
  }
  // 操控清扫机（下水道维护，enemies.js · sweeperGuardFor）：触灵清扫员在场时，维护员 / 清扫员挨打（范围攻击每人各挡一次），
  // 同区血量最多的清扫机 100% 代为承受；这一下结算完它剩下的血量 < 25% 还没死就立刻自爆（最后 return 之前，sweeperGuardAfter）
  let guardSweeper = null;
  if (target && attacker && typeof sweeperGuardFor === "function") {
    const sw = sweeperGuardFor(attacker, target, opt);
    if (sw) {
      appendLog(`${sw.name} 挡在 ${target.name} 身前，替它承受这次攻击（触灵清扫员操控）。`);
      target = guardSweeper = sw;
      target._brokeNow = false;
      // 击杀记在代挡的清扫机身上（开头记的是原来的目标）
      if (attacker.isPlayer && (state.units || []).includes(attacker)) target._lastHitBy = attacker.id;
      else if (attacker.envSrc) creditPlayerHit(target, (envOwnerUnit(attacker) || {}).id);
    }
  }
  // 飞行：近程攻击飞行单位要额外付一个附赠行动；付不起就打不到。
  // 范围攻击、杂兵、飞行打飞行、柯尔特切刀附带的那一击（flyFree）不受此限。
  if (attacker && target && target.flying && opt.flags.action && !opt.flags.aoe && !opt.flags.flyFree && !isReaction) {
    const d = zoneDist(Number(attacker.zone), Number(target.zone), Number(state.zoneMode));
    const minion = !attacker.isPlayer && (typeof enemyRankOf === "function") && enemyRankOf(attacker) === "minion";
    // 一次攻击行动只付一次：同一个技能里分几下打同一个飞行目标（连续拳、多段普攻）不重复收
    const flyKey = attacker.id + ">" + target.id;
    const paid = !!(state.flyPaid && state.flyPaid[flyKey]);
    const wanderer = typeof featHas === "function" && featHas(attacker, "wanderer");   // 荒原行者（feats.js）
    if (d === 0 && !attacker.flying && !minion && !paid && !wanderer) {
      if ((Number(attacker.bonus) || 0) < 1) {
        const msg = `${target.name} 在飞行，近程攻击需要额外 1 附赠行动，${attacker.name} 附赠行动不足。`;
        appendLog(msg);
        return { res: { ok: false, total: 0, breakDealt: 0, log: [msg], perHit: [] }, extra: [msg] };
      }
      attacker.bonus = (Number(attacker.bonus) || 0) - 1;
      if (state.flyPaid) state.flyPaid[flyKey] = true;
      scoreSpend(attacker, 0, 1);
      appendLog(`${attacker.name} 额外消耗 1 附赠行动以近程攻击飞行中的 ${target.name}。`);
    }
  }
  if (target && ignoresAoe(target) && opt.flags.aoe) {
    const msg = "飞碟触灵本体不受范围效果波及。";
    return { res: { ok: false, total: 0, breakDealt: 0, log: [msg], perHit: [] }, extra: [msg] };
  }
  if (target && target.kit === "ufo_body" && !(opt.flags.assist && (target.stunned || target._bossAssistWindow))) {
    const msg = "飞碟触灵本体无法被通常手段攻击。只有本体失衡时的协助攻击可以打到它。";
    appendLog(msg);
    return { res: { ok: false, total: 0, breakDealt: 0, log: [msg], perHit: [] }, extra: [msg] };
  }
  // 协助攻击无法被格挡：技能本身带 assist 标记的，以及「正在打协助攻击的人」打出的每一下（finishAssist 设的 state._assistBy；
  // 敌人大多拿普通攻击当协助，以前没有标记，会进我方协助格挡队列）
  const assisting = !!opt.flags.assist || !!(attacker && state._assistBy && state._assistBy === attacker.id);
  // 危墙 / 关着的机关门挡住：先判，再进协助格挡（以前先弹格挡，格挡者花掉附赠、扣了耐久，这一击才被墙挡住）
  // lob：越墙的抛射（扭矩酸液炮蓄力、碎渣重炮的迫击炮）不被危墙 / 门挡住
  // 决一死战（#44）：被决斗的敌人只能攻击灯——它的范围攻击（电弧扫射、榴弹……）也只打得到灯，同区的其他人不被波及；
  // 多目标的单体攻击、协助攻击、借机攻击同理，一律只打得到灯。
  // 首领机制（死刑、齐射……）和环境伤害不算它的攻击行动，不拦
  if (attacker && !attacker.isPlayer && target && target.isPlayer && opt.flags.action && !opt.flags.environment && !opt.flags.mechId && !opt.flags.execution &&
      typeof touDuelVictim === "function") {
    const duel = touDuelVictim(attacker);
    if (duel && target.id !== duel.id) {
      const msg = `决一死战：${attacker.name} 只打得到 ${duel.name}，${target.name} 没被波及。`;
      appendLog(msg);
      return { res: { ok: false, total: 0, breakDealt: 0, log: [msg], perHit: [] }, extra: [msg] };
    }
  }
  if (attacker && target && target.zone != null && attacker.zone != null && !opt.flags.diffract && !opt.flags.locked && !opt.flags.lob) {
    const block = lineBlocked(attacker.zone, target.zone);
    if (block) {
      appendLog(block);
      return { res: { ok: false, total: 0, breakDealt: 0, log: [block], perHit: [] }, extra: [block] };
    }
  }
  // 驻波墙（频域造物）：这一击的连线穿过了哪几道（判定和上面的危墙一样：衍射、锁定的机制伤害、越墙抛射不算穿墙；
  // 范围攻击按每个目标各自算；借机攻击按走的人离开的那一区算）。每次都重算（等协助格挡的那一击落下时墙可能已经不在了），
  // 伤害 / 击破的修正在 engine.js · resolveAttack
  delete opt.flags.waveWalls;
  if (attacker && target && target.zone != null && attacker.zone != null && !opt.flags.diffract && !opt.flags.locked && !opt.flags.lob) {
    const ww = waveWallsOnLine(attacker.zone, opt.wallZone != null ? opt.wallZone : target.zone);
    if (ww.length) opt.flags.waveWalls = ww.map(w => ({ el: w.el, mode: w.mode }));
  }
  if (typeof featArmAttack === "function" && target && !target.isPlayer) featArmAttack(attacker, target, opt);   // 无可阻挡（feats.js）：不能被格挡
  if (attacker && attacker.isPlayer && target && !target.isPlayer && opt.flags.action && !assisting && !opt.flags.aoe && opt.flags.block !== "assistOk" && !opt.flags.blockResolved) {
    const auto = tryOxAutoBlock(attacker, target, opt.atkRange);
    if (auto && auto.ok) {
      opt.flags.block = "assistOk";
      opt.flags.blockHelperId = auto.helperId;
      opt.flags.blockResolved = true;
      // 警卫队队长·牛按自己的条文：成功仍扣牛自己的架势（最少留 1），目标不扣
      if (auto.selfBreak) opt.flags.blockBreakToHelper = true;
    } else if (auto) {
      opt.flags.blockResolved = true;
    }
  }
  // 屏障（铁壁 / 防护罩 / 废铁墙）：同区被它护着的单位挨敌方的攻击行动、或者范围攻击（算不算行动都一样）时，屏障替它吃一下（同一次行动只吃一下）。
  // 谁护着谁、谁算敌方按阵营判断（barrierGuards / barrierFoe）：多阵营混战里敌人打敌对阵营的敌人、我方或友军自己的范围攻击，屏障都不管。
  // wallZone：借机攻击在离开的那一区结算——走的人已经站到隔壁，替他挡的是他离开的那一区的屏障
  const wallCase = attacker && target && opt.flags && !opt.flags.diffract && !opt.flags.locked &&
    (opt.flags.action || (opt.flags.aoe && !opt.flags.environment));
  if (wallCase) {
    const wallHit = absorbBarrier(barrierFor(target, attacker, opt.wallZone), attacker, opt);
    if (wallHit) {
      (wallHit.notes || []).forEach(s => appendLog(s));
      return {
        res: wallHit.res || { ok: true, total: 0, breakDealt: 0, log: wallHit.notes, perHit: [] },
        extra: wallHit.notes,
        pending: false
      };
    }
  }
  if (typeof isDownProtected === "function" && isDownProtected(target)) {
    const msg = `${target.name} 濒死倒地，起身之前不受任何伤害。`;
    appendLog(msg);
    return { res: { ok: false, total: 0, breakDealt: 0, log: [msg], perHit: [] }, extra: [msg] };
  }
  if (attacker && !attacker.isPlayer && target && target.isPlayer && opt.flags.action && !assisting && !opt.flags.aoe && opt.flags.block !== "assistOk" && !opt.flags.blockResolved) {
    const helpers = eligibleBlockers(target);
    const walls = typeof featIronwallDeclarers === "function" ? featIronwallDeclarers(target) : [];   // 以身作盾（feats.js）
    if (helpers.length || walls.length) {
      appendLog(`→ ${target.name}：等待协助格挡（同区可以格挡的：${helpers.map(h => h.name + " " + finalBlockChance(h, attacker, target, opt.atkRange) + "%").join("、")}）`);
      state.blockQueue = state.blockQueue || [];
      state.blockQueue.push({
        seq: (state.jobSeq = (Number(state.jobSeq) || 0) + 1),   // 这一击的编号：格挡骰和伤害骰按它定种子（Helumica 能预测）
        attackerId: attacker.id,
        // 配置物（碎渣机炮）这类不在场上的攻击者：把它本身记下来，格挡结算时照样能找到
        fakeAttacker: (state.units || []).includes(attacker) ? null : JSON.parse(JSON.stringify(attacker)),
        targetId: target.id,
        onConnect: opt.onConnect || null,
        opt: JSON.parse(JSON.stringify({
        atk: opt.atk, mult: opt.mult, hitMults: opt.hitMults, flat: opt.flat, hits: opt.hits, baseHits: opt.baseHits, breakOnce: opt.breakOnce, element: opt.element,
        bleed: opt.bleed,   // 出血（engine.js · BLEED）：等格挡结果的这一击落下时照样带着
        baseBreak: opt.baseBreak, diceN: opt.diceN, diceS: opt.diceS, diceB: opt.diceB, diceValue: opt.diceValue,
        usePrep: opt.usePrep, atkRange: opt.atkRange, wallZone: opt.wallZone, flags: Object.assign({}, opt.flags, { blockResolved: false })
      }))
      });
      presentBlockModal();
      return { res: { ok: false, pending: true, total: 0, breakDealt: 0, log: ["等待协助格挡选择"], perHit: [] }, extra: ["等待协助格挡选择"], pending: true };
    }
  }
  markXiaAttack(attacker);
  const flags = makeDealFlags(opt.flags);
  if (target && target.kit === "chixia" && target.resources && target.resources.cover) {
    flags.dr50 = true;
    opt.baseBreak = 0;
  }
  // 首领机制蓄满能量（沙灵聚合体开炮那一回合）：受到的伤害降低（boss-mechanics.js · mechChargeDr）
  if (target && !target.isPlayer && typeof mechChargeDr === "function") {
    const dr = mechChargeDr(target);
    if (dr > 0) { flags.drPct = (Number(flags.drPct) || 0) + dr; flags.drWhy = "蓄满能量"; }
  }
  // 防暴盾（镇压队员·警棍盾）：同区有护盾还没打空的警棍盾，友军受到的远程攻击 −25%，和其他百分比加算（enemies.js · riotShieldDr）
  if (target && !target.isPlayer && flags.action !== false && !flags.environment && typeof riotShieldDr === "function") {
    const sdr = riotShieldDr(target, attacker, opt);
    if (sdr > 0) {
      flags.drPct = (Number(flags.drPct) || 0) + sdr;
      flags.drWhy = flags.drWhy ? flags.drWhy + "、防暴盾" : "防暴盾";
    }
  }
  // 张开掩体（载具）：合并后的驾驶员（车）受伤 −25%，和其他百分比加算
  if (target && target.vehMerged && flags.action !== false && !flags.environment && typeof vehicleCoverDr === "function") {
    const cdr = vehicleCoverDr(target);
    if (cdr > 0) {
      flags.drPct = (Number(flags.drPct) || 0) + cdr;
      flags.drWhy = flags.drWhy ? flags.drWhy + "、张开掩体" : "张开掩体";
    }
  }
  // 挂在「下一击」上的猛击 / 穿刺 / 弱点特效只作用于真正的攻击行动，
  // 不作用于这一击派生出来的环境伤害（雷击转移、爆燃溢出、反弹……），也不会被它们提前用掉
  const realAttack = flags.action !== false && !flags.environment;
  if (opt.smash || (realAttack && attacker.resources && attacker.resources.smashNext)) flags.smash = true;
  if (realAttack && attacker.resources && attacker.resources.pierceNext) {
    flags.pierce = true;
    attacker.resources.pierceNext = false;
  }
  if (gambitRes(attacker).gambitStrike) flags.doubleDeal = true;
  // 受击一方的减伤 / 免伤 / 加伤开关（掩体、蓄满能量、张开掩体、受伤翻倍、咬牙坚持、转移注意、屹立不倒、圣盾、过度自信……）：
  // 暴虐猎手斩杀的预演照这些算（enemies.js · ratExecFlags），这里加了新的，那边也要加
  if (gambitRes(target).gambitWound) flags.doubleTake = true;
  if (target && target.resources && target.resources.gritTurn) flags.dr50 = true;
  if (target && target.resources && target.resources.divertGuard) flags.dr25 = true;   // 扭矩「转移注意」自保
  if (target && target.resources && target.resources.standTurn) flags.immune = true;
  if (target && target.resources && target.resources.frostShell) flags.immune = true;   // 再次霜结：完全免受伤害与击破
  if (target && target.instant && target.instant.doubleBreak) {
    opt.baseBreak = (opt.baseBreak != null ? opt.baseBreak : 1) * 2;
  }
  if (realAttack && attacker.resources && attacker.resources.weakNext) {
    flags.weak = true;
    attacker.resources.weakNext = false;
  }
  // 启动引擎+：夏 / 柏妮尔的火属性攻击动作自动消耗所有燃油，伤害 +燃油×10%（处决每点 15%）；一个动作只消耗一次
  // #44：格挡反打（opportunity）不消耗燃油
  if (flags.action && !flags.opportunity && (opt.element || "physical") === "fire" && attacker && (attacker.kit === "xia" || attacker.kit === "berniel") && xiaFuelOn()) {
    const acc = state.actionAcc || {};   // 没有行动记账（例如主持人出手）时按这一击单独算
    if (acc.fuelPct == null) {
      const n = takeFuel();
      acc.fuelPct = n * (acc.fuelRate || 0.1);
      if (n) appendLog(`燃油：消耗 ${n} 点，这次攻击伤害 +${Math.round(acc.fuelPct * 100)}%。`);
    }
    if (acc.fuelPct) flags.fuelPct = acc.fuelPct;
  }
  let prepBonus = 0;
  let prepNote = "";
  if (attacker.resources && attacker.resources.preparedActive && opt.usePrep !== false) {
    const whet = Number(attacker.resources.whetDice) || 0;   // 磨刀（feats.js）：(2+等级÷5)d6
    const r = whet ? takeDice(whet, 6, 0) : takeDice(1, prepDieSides(attacker), 0);
    prepBonus = r.total;
    prepNote = (whet ? "磨刀" : "准备") + r.text;
    delete attacker.resources.whetDice;
    attacker.resources.preparedActive = false;
    attacker.resources.prepared = false;
  }
  if (shouldDiceMin(attacker) && (opt.diceN || 0) > 0) {
    opt.diceValue = (opt.diceN || 0) + (opt.diceB || 0);
    flags.diceMin = true;
  }
  const bearer = shieldBearer(target);
  if (bearer && flags.action) flags.holyShield = true;
  let extraDiceNote = "";
  let diceValue = opt.diceValue;
  if (diceValue == null) {
    const n = opt.diceN || 0, s = opt.diceS || 0, b = opt.diceB || 0;
    const mode = hostValue("diceMode", "roll");
    if (mode === "manual") diceValue = Number(hostValue("diceManual", 0)) || 0;
    else if (n && s) {
      const r = takeDice(n, s, b);
      diceValue = r.total;
      extraDiceNote = r.text;
    } else diceValue = 0;
  }
  // 准备：只加在这次攻击第一击的基础包上（复数攻击只生效一次），不并进每一段都吃的骰子
  if (prepBonus) extraDiceNote = extraDiceNote ? extraDiceNote + " + " + prepNote + "（第一击）" : prepNote + "（第一击）";
  // 单局图纸：打近 / 远距离的额外骰、承受伤害 +1d10 等（mods.js）
  if (typeof bpDiceAdjust === "function") {
    const adj = bpDiceAdjust(attacker, target, flags);
    if (adj.text.length) {
      diceValue = (Number(diceValue) || 0) + adj.value;
      extraDiceNote = [extraDiceNote, ...adj.text].filter(Boolean).join(" + ");
    }
  }
  // 过度自信：现有血量 ≥ 进入战斗时的血量上限即减伤（并少受 1 击破）。战斗中上限被抬高也照原来的上限算，
  // 所以靠临时层、护盾把血量堆过原来的上限就会触发
  if (target && target.kit === "kolt" && flags.action) {
    if (target.prideMaxHp == null) target.prideMaxHp = baseMaxHp(target);   // 中途上场的：第一次挨打时记下
    const cut = koltPrideCut(target);   // 和角色仪表同一个判断
    if (cut) flags.prideReduce = cut;   // 过度自信+：45%
  }
  if (attacker && (attacker.kit === "helu" || attacker.kit === "ecmo") && target && target.focuses && target.focuses.length) {
    flags.focusLayer = pickFocusLayer(target);
  }
  let br = opt.baseBreak != null ? opt.baseBreak : 1;
  if (attacker.rallyBreak) br += attacker.rallyBreak;
  if (attacker.kit === "hiaki" && attacker.resources && attacker.resources.blade === "naruto" &&
      (typeof passiveOn !== "function" || passiveOn(attacker))) br += 1;   // 被动「佩刀」
  if (attacker.kit === "naruto" && typeof passivePlus === "function" && passivePlus(attacker, 1)) br += 1;   // 佩刀+：鳴門武器人击破 +1
  const dist = zoneDist(attacker.zone, target.zone, state.zoneMode);
  if (typeof featBreakBonus === "function") br = featBreakBonus(attacker, target, opt, flags, br, dist, isReaction);   // 冲阵 / 硬骨头 / 无可阻挡
  // 抵近射击：远距离攻击打同区（这一击是远程、或这个技能是靠抵近射击才打得到同区）→ 倍率 ×60%
  if (attacker && attacker.isPlayer && dist === 0 && flags.action !== false && !flags.environment && !flags.aoe && !isReaction &&
      typeof featHas === "function" && featHas(attacker, "pointblank") && (opt.atkRange === "ranged" || state._pointBlankShot === attacker.id)) flags.pointBlank = true;
  // 被决一死战 / 嘲讽牵制、又没有近身攻击的敌人：远距离攻击打同区的牵制者，同样 ×60%
  if (attacker && !attacker.isPlayer && dist === 0 && opt.atkRange === "ranged" && flags.action !== false && !flags.environment && !flags.aoe && !isReaction &&
      typeof enemyForcedPointBlank === "function" && enemyForcedPointBlank(attacker, target)) flags.pointBlank = true;
  const wasDeadForGhost = !!(target && target.dead);
  const wasDownForRat = !!(target && (target.dead || target.dying));   // 暴虐猎手「击杀后进入狂暴」：这一击之前还没倒下（enemies.js · ratfolkAfterHit）
  // 千钧：每个攻击行动总击破 +1 只加一次——这个行动里前面的攻击已经加过，就不再加
  const res = resolveAttack({
    attacker, target,
    atk: opt.atk != null ? opt.atk : effectiveAtk(attacker, state.units),
    mult: ((flags.assist || (attacker && state._assistBy === attacker.id)) && typeof bpAssistMult === "function") ? bpAssistMult(attacker, opt.mult != null ? opt.mult : 1) : (opt.mult != null ? opt.mult : 1),
    flat: opt.flat || 0,
    diceValue,
    firstHitBonus: prepBonus,
    firstHitNote: prepNote,
    // 迅袭（猫类人·豹）：整场第一个行动里的第一击 +击破；反应（协助、借机）和环境伤害不算
    firstBreak: flags.action && !isReaction && !flags.environment && typeof raceFirstBreak === "function" ? raceFirstBreak(attacker) : 0,
    element: opt.element || "physical",
    baseBreak: br,
    hits: opt.hits || 1,
    hitMults: Array.isArray(opt.hitMults) ? opt.hitMults.slice() : null,
    breakOnce: !!opt.breakOnce,
    baseHits: opt.baseHits,
    bleed: !!opt.bleed,   // 出血（engine.js · BLEED）：攻击规格上的开关
    // 这次攻击动作里刚被打死的敌人：留到动作结束，后面的攻击照常结算、全部算溢出
    ghostOk: !!(target && !target.isPlayer && target.dead && (state.actionKills || []).includes(target.id)),
    flags,
    weather: currentWeatherFor(target),
    phaseStep: Number(state.phaseStep),
    zoneMode: state.zoneMode,
    attackerField: state.fields[attacker.zone] || {},
    targetField: state.fields[target.zone] || {},
    highA: isHighGround(state.fields[attacker.zone]),
    highT: isHighGround(state.fields[target.zone]),
    dist,
    atkRange: opt.atkRange || "any"
  });
  res.flags = flags;
  // 种族被动（enemies.js）：这一击算出手了——迅袭的「第一个行动」用掉；注意力涣散记下这回合打的是谁
  if (attacker && flags.action && !isReaction && !flags.environment && res.ok !== false) {
    if (typeof raceMarkActed === "function") raceMarkActed(attacker);
    if (typeof raceNoteAttack === "function") raceNoteAttack(attacker, target);
  }
  const wasStunnedT = !!target.stunned;
  const wasFlyingT = !!target.flying;   // 击破飞行单位时引擎会先把它击落（engine.js · applyResultToUnit），荒原行者要看结算前的飞行状态
  const dopplerT = target.self === "doppler";   // 被这一下打进失衡、多普勒随晕眩结束，这一下的击破照样传出去
  const shieldBeforeT = shieldSum(target);
  // 评分：这一击的加分倍率（克制等）。击杀、失衡在 applyCombat 里发生，先挂在目标身上给它们用
  const scoreBonus = attacker && (attacker.isPlayer || attacker.envSrc) && target && !target.isPlayer ? attackScoreBonus(res, target) : 0;
  const wasStunnedForScore = !!(target && target.stunned);
  if (target && !target.isPlayer) target._killBonus = scoreBonus;
  // 废物利用的来源：记下这一击之前敌人每层的血量，之后只认这一击真正打碎的层
  const layersBeforeHit = target && !target.isPlayer ? (target.layers || []).map(l => ({ type: l.type, cur: Number(l.current) || 0, max: Number(l.max) || 0, sealed: !!l.sealed })) : null;
  // 自爆小车：这一击打死它时，死亡引爆等这一击的伤害弹字出来之后再炸（见函数末尾）——
  // 以前先炸（applyCombat 里清场在弹字之前），画面上先看到爆炸、小车倒下，打死它的那一下最后才落上去（作者 10/20 反馈）
  const holdBoom = !!(target && target.kit === "boomcar" && !target._exploded);
  if (holdBoom) target._holdBoom = true;
  const extra = applyCombat(target, res, attacker);
  // 出血（engine.js · BLEED）：日志单独写一行，排在这一击的其他后果（倒下、失衡……）前面
  const bleedLine = bleedLogLine(res);
  if (bleedLine) extra.unshift(bleedLine);
  // 这一击打死的敌人：本次行动后面的攻击还能打到它（全部算溢出）
  if (target && !target.isPlayer && target.dead && !wasDeadForGhost && state.actionKills && !state.actionKills.includes(target.id)) state.actionKills.push(target.id);
  if (target && !target.isPlayer && scoreBonus > 0 && brokeInto(target, wasStunnedForScore)) target._staggerBonus = scoreBonus;
  if (target && !target.isPlayer) target._killBonus = 0;   // 只给这一击打死的用
  // 手册第四章补全的效果（effects.js）
  if (typeof afterDamageTaken === "function") {
    afterDamageTaken(target, opt.element || res.element, res.total || 0, Math.max(0, shieldBeforeT - shieldSum(target)), extra, {
      attacker, action: !!flags.action, melee: dist === 0, startLayerType: res.startLayerType
    });
  }
  if ((res.breakDealt || 0) > 0 && typeof onBreakTaken === "function") onBreakTaken(target, res.breakDealt, opt.element || res.element, extra, dopplerT);
  if (brokeInto(target, wasStunnedT) && typeof onBroken === "function") onBroken(target, extra);
  if (typeof featAfterHit === "function") featAfterHit(attacker, target, res, flags, extra, brokeInto(target, wasStunnedT), wasFlyingT);   // 冲阵 / 乘势 / 荒原行者
  if (flags.action && !isReaction && typeof afterAttackDealt === "function") afterAttackDealt(attacker, target, opt.element || res.element, res, opt, extra);
  // 下水道狂鼠（enemies.js）：潜藏者挨了近战先记下（行动打完再逃）；暴虐猎手击杀后狂暴、狂暴时出血回血、斩杀那一击落下
  if (typeof ratfolkAfterHit === "function") ratfolkAfterHit(attacker, target, res, flags, extra, { dist, wasDown: wasDownForRat, wasStunned: wasStunnedT });
  // 猛击反震把攻击者自己打进失衡：这一击的霜结 / 溅射 / 导体照常结算完，再随晕眩结束自我效果
  if (attacker && attacker !== target && attacker.stunned && typeof endSelfOnStun === "function") endSelfOnStun(attacker, extra);
  if (attacker && attacker !== target && typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(attacker, extra);
  if ((res.total || 0) > 0 && layersBeforeHit) {
    // 只认敌人、只认这一击之前还有血、这一击之后归零（或被移除）的那一层；已经碎掉的层不会被后来的攻击反复记录
    const now = target.layers || [];
    const broken = layersBeforeHit.filter((p0, i) => {
      if (p0.cur <= 0 || p0.sealed) return false;
      const l = now.find((x, j) => x.type === p0.type && j >= i - 1 && j <= i);   // 外层被移除时会往前挪一位
      return !l || (Number(l.current) || 0) <= 0;
    });
    const deadLayer = broken[broken.length - 1];   // 一击打穿多层时取最里面那层
    if (deadLayer) state.lastBrokenLayer = { type: deadLayer.type, lost: deadLayer.max || 0, dmg: res.total || 0 };
  }
  advanceFocusOnHit(attacker, target, opt.element || res.element, res, extra);   // 聚焦不看来源，任何伤害都算
  rasUnstableHit(target, res, extra);
  if (attacker && (attacker.kit === "kolt" || attacker.kit === "torque") && target && !target.isPlayer && flags.action && !flags.aoe &&
      (typeof passiveOn !== "function" || passiveOn(attacker))) {
    target.tauntTo = (findKit("kolt", state.units) || attacker).id;
    extra.push(`过度自信：${target.name} 被嘲讽，下次攻击必须打柯尔特。`);
  }
  applyAtkFxAfter(attacker, target, res, flags, extra, opt);
  if (typeof bpAfterAttack === "function") bpAfterAttack(attacker, target, res, flags, extra);
  if (res && !res.pending) noteActionHit(target, res);
  if (flags.block === "assistOk") {
    const bh = unitById(flags.blockHelperId);
    if (bh && bh.kit === "bili") {
      // 哔哩哩格挡成功：自身不掉架势，把这一击原本的伤害 50% 以闪电反伤给进攻者
      if (attacker && !attacker.dead && !attacker.isProp) {
        const back = Math.floor((Number(res.blockedRaw) || 0) * 0.5);
        if (back > 0) applyTypedDot(attacker, back, "electric", extra, `${bh.name} 格挡反伤 → ${attacker.name}`, { by: bh.id });   // 反伤算格挡者的伤害（#187）
      }
    } else extra.push(...applyBlockBreakToHelper(flags.blockHelperId, res.helperBreak));
    if (typeof featAfterBlock === "function") featAfterBlock(bh, attacker, target, extra);   // 推搡（feats.js）：挡下后把攻击者推开
  }
  if (extraDiceNote) extra.unshift("掷骰 " + extraDiceNote);
  gainHighFromHits(target, res, extra);
  checkHighBoom(target);
  extra.push(...pulseResonanceDamage(target, res.total || 0, opt.element || res.element));
  // 高压场地：每次真的受到伤害才额外电击（协助格挡成功免伤、被免疫、0 伤不触发；空手格挡成功挨一半照样触发）
  if (flags.block !== "assistOk") {
    const hits = (res.perHit && res.perHit.length) ? res.perHit : [{ dealt: res.total || 0 }];
    hits.forEach((h, i) => {
      const dealt = Number(h.dealt) || 0;
      if (dealt > 0) extra.push(...pulseHighVoltage(target, dealt, i + 1, hits.length));
    });
  }
  if (flags.smash && attacker.resources) attacker.resources.smashNext = false;
  // 按钮 / 拉杆：被行动的范围攻击波及时触发一次；场地、状态这类环境伤害不算
  if (flags.aoe && !flags.environment) {
    markAoeZone(target && target.zone, { element: opt.element || res.element || "physical", dmg: Math.max(Number(res.intended) || 0, Number(res.total) || 0), attacker });
  }
  if (target && target.resources && target.resources.reflectReady && attacker && !flags.reflect) {
    const bounced = Math.floor(Number(target.resources.reflectReady) || 0);
    target.resources.reflectReady = 0;
    extra.push(`观测鸦反弹 ${bounced} 点能量伤害给 ${attacker.name}（不反弹击破）。`);
    if (bounced > 0) {
      const out = dealTo(target, attacker, {
        atk: 0, mult: 0, flat: bounced, element: "energy", baseBreak: 0,
        flags: { action: false, environment: true, reflect: true, blockResolved: true }
      });
      if (out && out.extra) extra.push.apply(extra, out.extra);
    }
  }
  if (opt.onConnect) {
    if (attackConnected(res, flags)) extra.push(...runOnConnect(attacker, target, opt.onConnect, res));
    else extra.push("格挡成功：位移与其他附带效果未生效。");
  }
  // 沙灵聚合体狂暴连打：每一击落下就记一次（被挡下没有），全部落下后判断是不是全被挡下（enemies.js · aggRushHitDone）
  if (flags.aggRush && !res.pending && typeof aggRushHitDone === "function") {
    const b = flags.block || (res.flags && res.flags.block);
    extra.push(...aggRushHitDone(attacker, b === "assistOk" || b === "bareOk"));
  }
  // 休眠：同阵营的敌人挨打（真的掉了血）就叫醒休眠的同伴
  if (target && !target.isPlayer && (Number(res.total) || 0) > 0 && typeof dormantOnAllyHurt === "function") extra.push(...dormantOnAllyHurt(target, attacker));

  if (!res.pending) {
    // 结算后实际用的属性（扩散会把攻击改成目标最新的状态属性）：伤害数字的颜色、图标、预览都跟着它
    const ele = res.element || opt.element || "physical";
    state.lastHitElement = ele;   // 单人模式的支援：协助攻击之后按这一下的属性追加击破
    // 战场数据
    // 配置物打在敌人身上：环境分数（×1.2，记在触发 / 操控它的人身上）
    const envWho = attacker && attacker.envSrc && target && !target.isPlayer ? envCreditUnit(attacker) : null;
    if (attacker && attacker.envSrc) {
      if (envWho && scoreEnvHit(target, res, envWho, scoreBonus, attacker.name)) scoreWeatherHelp(attacker, target, res, true);
    } else if (attacker && target && attacker.isPlayer && !target.isPlayer) {
      const st = battleStat(attacker);
      if (st) {
        const brkReal = res.breakSpent != null ? Number(res.breakSpent) || 0 : Number(res.breakDealt) || 0;   // 战-M5：实际扣掉的架势
        st.dmg += Math.floor(Number(res.total) || 0); st.brk += brkReal;
        burstNote(st, attacker, res.total, burstLabel(opt.flags), res);
        addScore("dmg", Math.floor(Number(res.total) || 0) * SCORE_RULES.dmg * scoreTargetMul(target), attacker, scoreBonus);
        addScore("brk", brkReal * SCORE_RULES.brk * scoreTargetMul(target), attacker, scoreBonus);
        scoreWeatherHelp(attacker, target, res, true);
      }
      noteCounterAttack(attacker, target, res, flags);
    }
    if (target && target.isPlayer) scoreWeatherHelp(attacker, target, res, false);
    if (target && target.isPlayer) {
      const st = battleStat(target);
      if (st) st.taken += Math.floor(Number(res.total) || 0) + Math.floor(Number(res.shpDealt) || 0);
      // 减伤得分：敌方（含配置物、环境）的攻击打在我方身上，被减伤减免掉的伤害 ×1.5
      const red = Math.floor(Number(res.reduced) || 0);
      if (st && red > 0 && !(attacker && attacker.isPlayer)) {
        st.reduced = (st.reduced || 0) + red;
        addScore("reduce", Math.floor(red * SCORE_RULES.reduce), target);
      }
    }
    // 画面用：敌人被这一击打死时，记下「溢出」的伤害（血量显示成负数）和是不是一记重击（死后慢慢消失）
    if (target && !target.isPlayer && (target.dead || totalHp(target) <= 0) && (res.intended || 0) > 0) {
      const over = Math.max(0, (res.intended || 0) - (res.total || 0));
      if (over > 0) target.overkill = (Number(target.overkill) || 0) + over;
      if (over > 0 && envWho) addScore("env", Math.floor(over * SCORE_RULES.overkill) * SCORE_RULES.env * scoreTargetMul(target), envWho, scoreBonus);
      else if (over > 0 && attacker && attacker.isPlayer && !attacker.envSrc) addScore("overkill", Math.floor(over * SCORE_RULES.overkill) * scoreTargetMul(target), attacker, scoreBonus);
      const maxHp = (target.layers || []).reduce((a, l) => a + (Number(l.max) || 0), 0);
      if ((res.intended || 0) >= maxHp * 0.5) target.killBig = true;
    }
    // main：这一下是攻击动作本身的伤害（不是高压场地、感电这类连带伤害）。预览和总伤害计数按它定属性颜色，
    // 攻击演出按它补打击形状（game.js · strikePlan）。不在场上的替身打的（自爆小车的残骸、爆炸桶、危墙倒塌……）也是连带伤害——
    // 以前算成主攻击，协助攻击打死自爆小车时，小车炸到的每个人身上都补一遍协助攻击的刀光（作者 10/20 反馈）。
    // 我方操控的碎渣机炮（替身记着操控的人 creditTo）照旧算：那一炮就是这次行动本身
    const standIn = !!attacker && (!!attacker.envSrc || !(state.units || []).includes(attacker));
    const mainHit = flags.action !== false && !flags.environment && (!standIn || !!attacker.creditTo);
    // adv：玩家这一击触发了属性克制（预览写「克制」、血条变浅金；演出时画面震一下）
    const advHit = !!(res.advantage && attacker && attacker.isPlayer && mainHit);
    const disHit = !!(res.disadvantage && attacker && attacker.isPlayer && mainHit);   // 劣势：预览写「劣势」、伤害变灰
    // 多段攻击（例：拉斯缪尔两次 0.5atk、不稳态四次）：每一段各跳一个数字，看得出判定了几次
    const segs = (res.perHit || []).filter(h => (Number(h.intended) || 0) > 0);
    if (segs.length > 1) segs.forEach(h => spawnPopup(target, { kind: "dmg", value: h.intended, element: ele, main: mainHit, adv: advHit, dis: disHit }));
    else if ((res.intended || res.total || 0) > 0) spawnPopup(target, { kind: "dmg", value: res.intended || res.total, element: ele, main: mainHit, adv: advHit, dis: disHit });
    if ((res.extraHarmonic || 0) > 0) spawnFloater(target, res.extraHarmonic, ele);
    // 出血：每触发一次另跳一个数字（真实伤害，不算进上面那一段的数字）
    (res.perHit || []).forEach(h => { if ((Number(h && h.bleed) || 0) > 0) spawnFloater(target, h.bleed, ele); });
    // 画面：这一击带的攻击效果打出大字（属性专属的用属性颜色，穿刺 / 猛击 / 弱点特效用灰色）
    if (flags.action !== false && !flags.environment && typeof attackConnected === "function" && attackConnected(res, flags)) {
      attackFxWords(flags).forEach(w => spawnPopup(target, { kind: "fxword", text: w.name, element: w.element }));
    }
    // 协助格挡成功：击破由格挡者承担（helperBreak）
    if ((res.breakDealt || 0) > 0) popBreak(target, res.breakDealt, ele);
    if (flags.block === "assistOk" && (res.helperBreak || 0) > 0) {
      const helper = unitById(flags.blockHelperId);
      if (helper && helper.kit !== "bili") popBreak(helper, res.helperBreak, ele);   // 哔哩哩格挡不掉架势
    }
  }
  // 代挡的清扫机剩下的血量 < 25%、还没死：立刻自爆（enemies.js · sweeperGuardAfter）
  if (guardSweeper && typeof sweeperGuardAfter === "function") sweeperGuardAfter(guardSweeper, attacker, extra);
  if (holdBoom) {
    target._holdBoom = false;
    if (target._boomPending) { target._boomPending = false; explodeBoomcar(target, extra); }   // 这一击把它打死了：弹字都出来了，现在才炸
  }
  return { res, extra };
}

function triggerMagnetShield(broken) {
  const notes = [];
  if (!broken || !(broken.shieldFromChuan || broken.magnetShield)) return notes;
  // 川川 / 哔哩哩给的护盾没了：不管这次有没有推人，标记都清掉（以前川川不在同区时标记留着，
  // 之后别人给的护盾被打破也会推人 + 击破）
  dropMagnetShield(broken);
  const c = findKit("chuan", state.units);
  if (!c || Number(c.zone) !== Number(broken.zone)) return notes;
  if (typeof passiveOn === "function" && !passiveOn(c)) return notes;   // 放弃被动「磁场护盾」
  const dest = magnetPushDest(c.zone);
  notes.push(`磁场护盾：${broken.name} 上由川川/哔哩哩施加的护盾被破坏，效果触发后解除。同区敌人${dest != null ? `被推向 ${dest} 区` : "无处可推"}并各受 1 击破。`);
  visibleEnemies(c.zone).filter(u => !ignoresAoe(u)).forEach(u => {
    if (dest != null) displaceTo(u, dest, notes, "被磁场护盾推开");   // #44：走标准推人逻辑（墙、空隙、深渊、流沙……照常结算）
    dealBreak(u, 1, "electric", notes, "磁场护盾");
  });
  return notes;
}
/** 磁场护盾推人的目标区（#44，夕夏定）：只在隔着可通行间隔（非危墙、非关着的机关门）的相邻区里选；
 *  优先危险区域（空隙、深渊、不稳桥梁、流沙、冻土、伏咬沙鱼、火场、酸液），危险区之间随机（对局种子）；
 *  没有危险区才推向普通区；无处可推返回 null */
function magnetPushDest(zone) {
  zone = Number(zone);
  const ns = typeof zoneNeighbors === "function" ? zoneNeighbors(zone) : [];
  const cand = (ns.length ? ns : [otherZone(zone)]).map(Number).filter(z => z !== zone && state.fields[z]);
  const open = cand.filter(z => { const g = getGap(zone, z); return !(g.type === "wall" || (g.type === "door" && !g.open)); });
  if (!open.length) return null;
  const hazard = z => {
    const g = getGap(zone, z), f = state.fields[z] || {};
    if (g.type === "void" || g.type === "bridge") return true;
    if (f.abyss || f.quicksand || f.ice || f.fireOn || (Number(f.fire) || 0) > 0 || f.acid) return true;
    return (state.units || []).some(u => u.kit === "sandfish_ambush" && !u.dead && Number(u.zone) === z);
  };
  const danger = open.filter(hazard);
  if (danger.length) return danger[Math.floor(Math.random() * danger.length)];
  return open[0];
}

function ownerEngineOn(kit) {
  const o = findKit(kit, state.units);
  return !!(o && o.resources && o.resources.engine);
}

function setEngine(on, reason) {
  const x = findKit("xia", state.units);
  if (!x) return;
  x.resources = x.resources || {};
  if (on && typeof passiveOn === "function" && !passiveOn(x)) {   // 放弃被动「启动引擎」
    appendLog("夕夏放弃了被动「启动引擎」，引擎无法启动。");
    return;
  }
  x.resources.engine = !!on;
  if (on) x.resources.engineJustOn = true;
  appendLog(`夕夏引擎${on ? "启动" : "关闭"}${reason ? "（" + reason + "）" : ""}`);
}

function markXiaAttack(attacker) {
  const x = findKit("xia", state.units);
  if (!x) return;
  if (!attacker) return;
  const fromXia = attacker.kit === "xia" || attacker.kit === "berniel" || attacker.weaponOf === "xia";
  if (!fromXia) return;
  x.resources = x.resources || {};
  x.resources.attackedThisTurn = true;
}

function addCharge(n) {
  const c = findKit("chuan", state.units);
  if (!c) return;
  if (n > 0 && typeof passiveOn === "function" && !passiveOn(c)) return;   // 放弃被动「发电站」：不再积攒电能
  c.resources = c.resources || {};
  c.resources.charge = Math.max(0, (c.resources.charge || 0) + n);
}

/** 加护盾。fromChuan：是不是川川 / 哔哩哩给的（只有他们给的护盾带「磁场护盾」）；默认是，其他来源要传 false。
 *  技能给的护盾记在层上：新开的层标 granted，叠在单位自带护盾层上的那部分记 grantBonus（回收护盾只清这些和当前值） */
function addShieldLayer(u, amount, fromChuan) {
  if (!u || amount <= 0) return;
  amount = Math.floor(amount);
  // 原来的护盾已经没了（被打破、过载清零、被回收……）：留下的磁场护盾标记作废，按这次的来源重新算
  if (shieldSum(u) <= 0) dropMagnetShield(u);
  addTempShield(u, amount);   // 施加的护盾都是临时护盾：并进护盾层，不会回满（engine.js · addTempShield）
  if (fromChuan !== false) u.shieldFromChuan = true;
}
/** 磁场护盾的标记作废：川川 / 哔哩哩给的护盾没了（被打破、被过载清零、被回收） */
function dropMagnetShield(u) {
  if (!u) return;
  u.shieldFromChuan = false;
  u.magnetShield = false;
}

function addNano(n) {
  const ruby = findKit("ruby", state.units);
  if (!ruby) return;
  if (n > 0 && !(typeof passiveOnKit !== "function" || passiveOnKit("ruby"))) return;   // 放弃被动「纳米科技」
  ruby.resources = ruby.resources || {};
  ruby.resources.nano = Math.max(0, Math.min(100, (ruby.resources.nano || 0) + n));
}

/* 瑞比「补充能源」（纳米科技+，作者 10/21 定，#219）：附赠动作二选一——纳米 +nano，或者把全部纳米按 compressRate（储备 / 纳米，1:1）
 * 压缩成储备能源、纳米归 0。储备能源记在 resources.nanoReserve：没有上限，纳米不够时自动补差额（spendNano），
 * 只在这一场战斗里有（战斗结束 / 开战清零；连续战斗换区域还是同一场）。没有储备时不留这个键（显示只在有储备时写「储备 n」） */
const RUBY_REFUEL = { nano: 10, compressRate: 1 };
function nanoReserveOf(ruby) { return Math.max(0, Number(ruby && ruby.resources && ruby.resources.nanoReserve) || 0); }
/** 瑞比能用的纳米能源：纳米 + 储备能源（花纳米的门槛都按这个算） */
function nanoAvailable(ruby) {
  ruby = ruby || findKit("ruby", state.units);
  return ruby ? Math.max(0, Number(ruby.resources && ruby.resources.nano) || 0) + nanoReserveOf(ruby) : 0;
}
/** 花纳米能源：先扣纳米，纳米不够的差额从储备能源里扣。
 *  纳米 + 储备不够 n 时不扣、返回 null；opt.partial（机甲维持）有多少扣多少，两边都扣到 0 为止。
 *  返回这次从纳米、储备各扣了多少 { nano, reserve } */
function spendNano(n, opt) {
  opt = opt || {};
  const ruby = opt.ruby || findKit("ruby", state.units);
  if (!ruby) return null;
  const r = ruby.resources = ruby.resources || {};
  const need = Math.max(0, Number(n) || 0);
  const nano = Math.max(0, Number(r.nano) || 0), reserve = nanoReserveOf(ruby);
  if (nano + reserve < need && !opt.partial) return null;
  const fromNano = Math.min(nano, need), fromReserve = Math.min(reserve, need - fromNano);
  r.nano = nano - fromNano;
  if (reserve - fromReserve > 0) r.nanoReserve = reserve - fromReserve;
  else delete r.nanoReserve;
  return { nano: fromNano, reserve: fromReserve };
}
/** 日志里的扣除：「纳米 −5 → 0，储备能源 −15 → 35」（没动储备就只写纳米） */
function nanoSpentText(ruby, paid) {
  const r = (ruby && ruby.resources) || {};
  return `纳米 −${paid ? paid.nano : 0} → ${Number(r.nano) || 0}` + (paid && paid.reserve ? `，储备能源 −${paid.reserve} → ${nanoReserveOf(ruby)}` : "");
}
/** 压缩 n 点纳米换得多少储备能源 */
function nanoCompressGain(n) { return Math.floor(Math.max(0, Number(n) || 0) * RUBY_REFUEL.compressRate); }
/** 补充能源·压缩：全部纳米按比例转进储备能源，纳米归 0 */
function compressNano(ruby, lines) {
  const r = ruby.resources = ruby.resources || {};
  const nano = Math.max(0, Number(r.nano) || 0);
  const add = nanoCompressGain(nano);
  r.nano = 0;
  if (add > 0) r.nanoReserve = nanoReserveOf(ruby) + add;
  lines.push(`补充能源·压缩：纳米 ${nano} → 0，储备能源 +${add} → ${nanoReserveOf(ruby)}。`);
}
/** 战斗结束：储备能源清零（不跨战斗保留；纳米照旧） */
function clearNanoReserve() {
  (state.units || []).forEach(u => { if (u && u.resources && "nanoReserve" in u.resources) delete u.resources.nanoReserve; });
}

function beanToLiquid() {
  const y = findKit("yuito", state.units);
  if (!y || !y.resources) return false;
  if (typeof passiveOn === "function" && !passiveOn(y)) return false;   // 放弃被动「研磨机」
  if ((y.resources.bean || 0) < 1) return false;
  y.resources.bean -= 1;
  y.resources.liquid = (y.resources.liquid || 0) + 1;
  return true;
}

/** 绯秋切换刀势。放弃被动「剑术」时一直停在拔刀 */
/** 剑术+：每回合最多靠切换刀势拿几个附赠动作 */
const HIAKI_STANCE_BONUS_PER_TURN = 1;
function setHiakiStance(u, stance) {
  if (!u) return;
  u.resources = u.resources || {};
  if (stance !== "draw" && typeof passiveOn === "function" && !passiveOn(u)) { u.resources.stance = "draw"; return; }
  const prev = u.resources.stance || "draw";
  u.resources.stance = stance;
  // 特盛乱打：之后进入居合时，被乱打过的敌人各被瞬间砍一刀（0.5atk 当前刀的属性，无视距离和障碍），标记去掉
  if (stance === "iai" && prev !== "iai" && u.kit === "hiaki") {
    const marked = (state.units || []).filter(x => x && !x.isPlayer && !x.dead && x.barrageBy === u.id);
    if (marked.length) {
      const notes = [];
      const el = u.resources.blade === "naruto" ? "ice" : "fire";
      marked.forEach(x => {
        x.barrageBy = null;
        hitOne2(u, x, { element: el, mult: 0.5, baseBreak: 0, atk: effectiveAtk(u, state.units), atkRange: "any", usePrep: false, flags: { action: true, lob: true, skillRange: true } }, notes);   // skillRange：无视距离（距离 2 也砍得到）
      });
      notes.unshift(`特盛乱打：进入居合，被乱打过的 ${marked.length} 个敌人各被瞬间砍一刀。`);
      appendLog(notes.join("\n"));
    }
  }
  // 剑术+：切换刀势立刻获得 1 个附赠动作，每回合最多 1 个（作者定：以前每次切换都给，协助格挡切刀势能无限格挡）；
  // 没用掉的留到下回合，下回合结束时过期
  if (prev !== stance && typeof passivePlus === "function" && passivePlus(u, 2)) {
    const turn = Number(state.turnNo) || 0;
    const g = u.resources.stanceGrant && u.resources.stanceGrant.turn === turn ? u.resources.stanceGrant : { turn, n: 0 };
    if (g.n >= HIAKI_STANCE_BONUS_PER_TURN) return;
    u.bonus = (Number(u.bonus) || 0) + 1;
    g.n += 1;
    u.resources.stanceGrant = g;
    appendLog(`剑术+：${u.name} 切换刀势，获得 1 个附赠动作。`);
  }
}

/** 牵挂（#44）：结人、拿铁给被牵挂的人治疗时，所有治疗骰取最大值。返回 { total, text, maxed } */
function bondHealDice(healer, target, n, sides, bonus) {
  const y = findKit("yuito", state.units);
  const mine = healer && (healer.kit === "yuito" || healer.kit === "latte");
  const maxed = !!(mine && y && y.resources && target && y.resources.bondId === target.id);
  if (!maxed) return Object.assign(takeDice(n, sides, bonus || 0), { maxed: false });
  const total = n * sides + (Number(bonus) || 0);
  return { total, text: `最大值 ${n}*${sides}${bonus ? "+" + bonus : ""} = ${total}`, maxed: true };
}
function setBond(yuito, ally) {
  if (!yuito || !ally) return;
  if (typeof passiveOn === "function" && !passiveOn(yuito)) return;   // 放弃被动「思念」
  yuito.resources = yuito.resources || {};
  yuito.resources.bondId = ally.id;
  yuito.resources.bondName = ally.name;
}

/** 武器人沿用之前的血量：按「同类型的第几层」对应，跳过临时层。
 *  以前按下标对应，前面插过护盾层（电站超频 / 缓冲）或护盾层被回收删掉后就对错层，收回再唤出装甲直接回满 */
function inheritLayers(u, src) {
  const pool = {};
  (src || []).filter(l => l && !l.temp).forEach(l => { (pool[l.type] = pool[l.type] || []).push(l); });
  (u.layers || []).forEach(l => {
    const sv = (pool[l.type] || []).shift();
    if (sv) l.current = Math.max(0, Math.min(Number(l.max) || 0, Number(sv.current) || 0));
  });
}

function spawnWeapon(owner, kit) {
  const card = livePartyCards().find(c => c.kit === kit);
  if (!card) return null;
  if (state.units.some(u => u.kit === kit && !u.hidden && !u.fused)) return null;
  // 耐久为 0 的武器唤不出来（weaponSummonWhy 写了原因；以前在场时耐久被打光，收回后还能再唤出）
  if (typeof weaponBroken === "function" && weaponBroken(kit)) return null;
  if (typeof weaponHalved === "function" && weaponHalved(kit)) return null;   // 本场受损过（倒下 / 耐久归零 / 战斗中修理）：不能再唤出
  // 同场战斗内血量继承：收回时只是隐藏，再唤出沿用上次的血量层，并移除旧的隐藏单位
  const prev = state.units.find(x => x.kit === kit && x.hidden && !x.fused);
  if (prev && (prev.layers || []).reduce((s, l) => s + Math.max(0, Number(l.current) || 0), 0) <= 0) return null;
  const u = spawnLiveCard(card, owner.zone);
  u.level = (owner.weaponLevels && owner.weaponLevels[kit]) || card.level || 1;
  if (typeof applyWeaponLevel === "function") applyWeaponLevel(u);
  // 队伍档案：武器人显示档案里的耐久
  if (typeof weaponDur === "function" && u.resources) u.resources.durability = weaponDur(kit);
  // 单局状态：武器人跨战斗保留耐久（血量每场回满）
  if (typeof RUN !== "undefined" && RUN.active && RUN.carry && RUN.carry[kit]) {
    const c = RUN.carry[kit];
    if (c.durability != null && u.resources) u.resources.durability = c.durability;
  }
  // 维塔斯：双相与刺入属于武器系统，分出来时从诺拉那边同步过来
  if (kit === "vitas") {
    u.resources = u.resources || {};
    u.resources.mood = (owner.resources || {}).mood === "cruel" ? "cruel" : "gentle";
    u.resources.piercedId = (owner.resources || {}).piercedId || null;
    u.resources.piercedIds = pierceIdsOf(owner);
  }
  if (prev) {
    inheritLayers(u, prev.layers);
    state.units = state.units.filter(x => x !== prev);
  }
  u.weaponHeld = false;
  owner.weaponHeld = (kit === "niu" || kit === "naruto") ? owner.weaponHeld : false;
  if (owner.kit === "hiaki") {
    if (kit === "niu") owner.resources.niuOut = true;
    if (kit === "naruto") owner.resources.narutoOut = true;
    const other = kit === "niu" ? "naruto" : "niu";
    const otherOut = other === "niu" ? owner.resources.niuOut : owner.resources.narutoOut;
    if (!otherOut) owner.resources.blade = other;
    refreshHiakiAtk(owner);
    syncBladeSel();
    // 佩刀：两把刀的武器人共享行动点和附赠动作——后分出来的那把接着用场上那把剩下的
    const twin = hiakiTwinBlade(u);
    if (twin) { u.ap = twin.ap; u.apMax = twin.apMax; u.bonus = twin.bonus; u.bonusMax = twin.bonusMax; }
  } else {
    owner.weaponHeld = false;
    owner.atk = owner.personalAtk;
  }
  state.units.push(u);
  return u;
}

function returnWeapon(weapon) {
  const owner = ownerOfWeapon(weapon, state.units);
  const notes = [];
  if (!owner) { notes.push("找不到持有者。"); return notes; }
  if (Number(owner.zone) !== Number(weapon.zone)) {
    notes.push(`${weapon.name} 强制收回（${weapon.zone} 区 → ${owner.zone} 区）。`);
    weapon.zone = owner.zone;
  }
  if (owner.kit === "hiaki") {
    if (weapon.kit === "niu") owner.resources.niuOut = false;
    if (weapon.kit === "naruto") owner.resources.narutoOut = false;
    if (!owner.resources.blade) owner.resources.blade = weapon.kit;
    refreshHiakiAtk(owner);
    syncBladeSel();
  } else {
    owner.weaponHeld = true;
    owner.atk = (owner.personalAtk || 0) + (owner.weaponAtk || 0);
  }
  if (weapon.kit === "ecmo") ecmoProbeTrigger(weapon, notes);
  if (weapon.kit === "torque") endTorqueGuard(weapon, notes);
  weapon.hidden = true;
  if (weapon.kit === "xiaoxiao") longgeUnlock(owner, notes, "小朋友变回武器");
  notes.push(`${weapon.name} 已收回为武器。`);
  // 在场时耐久被扣到 0（格挡）：这一场才坏的，收回来照常能用（atk / 格挡减半），本场唤不出来；开战前就坏了的才只能空手
  if (typeof weaponUnusable === "function" && weaponUnusable(weapon.kit) && typeof heldWeaponKit === "function" && heldWeaponKit(owner) === weapon.kit) {
    disarmBrokenWeapon(owner, notes);
  }
  return notes;
}

/** 武器人主动「收回为武器 / 变回武器」的前提：要和持有者同区（玩家手册第二章「武器生物化」）。
 *  技能自带的强制收回（攻击后变回武器、焰袭、格挡成功后变回、协助攻击前召回……）不受这条限制。可以返回 null */
function weaponReturnWhy(weapon) {
  const owner = weapon ? ownerOfWeapon(weapon, state.units) : null;
  if (!owner) return null;
  if (Number(owner.zone) !== Number(weapon.zone)) return `要和 ${owner.name} 同区才能收回为武器`;
  return null;
}

/** 佩刀：「两把刀的武器人共享行动点和附赠动作」——两把刀都分出来时，返回另一把（不在场返回 null） */
function hiakiTwinBlade(u) {
  if (!u || (u.kit !== "niu" && u.kit !== "naruto")) return null;
  const other = u.kit === "niu" ? "naruto" : "niu";
  return (state.units || []).find(x => x.kit === other && !x.hidden && !x.fused && !x.dead) || null;
}
/** 一把刀花了行动点 / 附赠动作，另一把跟着同步（两把刀共用一份，以前各有 1 + 1） */
function syncBladeTwin(u) {
  const tw = hiakiTwinBlade(u);
  if (!tw) return;
  tw.ap = u.ap; tw.bonus = u.bonus;
}

function heldHiakiBlade(h) {
  if (!h || !h.resources) return "niu";
  const r = h.resources;
  if (r.niuOut && !r.narutoOut) return "naruto";
  if (r.narutoOut && !r.niuOut) return "niu";
  if (r.niuOut && r.narutoOut) return null;
  return r.blade || "niu";
}

function syncBladeSel() {
  if (!HAS_DOM) return;
  const sel = uiEl("bladeSel");
  const h = findKit("hiaki", state.units);
  if (!sel) return;
  const niuOut = !!(h && h.resources && h.resources.niuOut);
  const narutoOut = !!(h && h.resources && h.resources.narutoOut);
  [...sel.options].forEach(opt => {
    if (opt.value === "niu") {
      opt.disabled = niuOut;
      opt.textContent = niuOut ? "丹生谷（已分出）" : "丹生谷（火）";
    }
    if (opt.value === "naruto") {
      opt.disabled = narutoOut;
      opt.textContent = narutoOut ? "鳴門（已分出）" : "鳴門（冰）";
    }
  });
  if (h && h.resources) {
    const held = heldHiakiBlade(h);
    if (held) {
      h.resources.blade = held;
      sel.value = held;
    }
  }
}

function refreshHiakiAtk(h) {
  if (!h || !h.resources) return;
  const held = heldHiakiBlade(h);
  if (held) h.resources.blade = held;
  const blade = h.resources.blade || "niu";
  const out = blade === "niu" ? h.resources.niuOut : h.resources.narutoOut;
  const lv = (h.weaponLevels && h.weaponLevels[blade]) || 1;
  const wAtk = typeof computeWeaponAtk === "function"
    ? computeWeaponAtk(blade, h.attrs, lv, weaponPartsOf(h, blade))
    : (blade === "niu" ? 7 : 6);
  h.weaponAtk = out || !held ? 0 : wAtk;
  h.atk = (h.personalAtk || 0) + h.weaponAtk;
  h.suggest = h.suggest || {};
  h.suggest.element = blade === "naruto" ? "ice" : "fire";
}

function enterMecha() {
  const ruby = findKit("ruby", state.units);
  const mint = findKit("mint", state.units);
  const notes = [];
  if (!ruby) return ["场上没有瑞比。"];
  if (!(typeof passiveOnKit !== "function" || passiveOnKit("ruby"))) return ["瑞比放弃了被动「银翼」，无法进入机甲。"];
  if (nanoAvailable(ruby) <= 0) return ["纳米能源不足，无法进入机甲。"];   // 纳米 + 储备能源（#219）
  if (!mint || mint.hidden) {
    const spawned = spawnWeapon(ruby, "mint");
    if (!spawned) return ["需要明特在场且与瑞比同区。先唤出明特。"];
  }
  const m = findKit("mint", state.units);
  if (Number(m.zone) !== Number(ruby.zone)) return ["机甲模式需要与瑞比同区。"];
  ruby.resources.mecha = true;
  ruby.resources.preMecha = {
    layers: clone(ruby.layers),
    def: ruby.def,
    defMax: ruby.defMax,
    flying: ruby.flying
  };
  // 明特的装甲拼在外层：去掉它自己的「内层」标记、标成 mecha（以前带着 inner 标记，装甲打空就把瑞比判成濒死）
  const outer = clone(m.layers).map(l => { delete l.inner; l.mecha = true; return l; });
  ruby.layers = outer.concat(clone(ruby.layers));
  if (typeof markInnerLayer === "function") { ruby.layers.forEach(l => { if (l.mecha) delete l.inner; }); if (!ruby.layers.some(l => l.inner && !l.mecha)) { const own = ruby.layers.filter(l => !l.mecha); if (own.length) own[own.length - 1].inner = true; } }
  ruby.def = m.def;
  ruby.defMax = m.defMax;
  ruby.flying = true;
  ruby.atk = effectiveAtk(ruby, state.units);
  const ap = Math.min(Number(ruby.ap) || 0, Number(m.ap) || 0);
  const bonus = Math.min(Number(ruby.bonus) || 0, Number(m.bonus) || 0);
  ruby.ap = m.ap = ap;
  ruby.bonus = m.bonus = bonus;
  m.fused = true;
  m.hidden = true;
  notes.push("进入银翼机甲：明特装甲为外层，瑞比为内层，飞行，架势用明特。");
  return notes;
}

function exitMecha(ruby, reason) {
  const notes = [reason || "解除机甲"];
  if (!ruby || !ruby.resources || !ruby.resources.mecha) return notes;
  const mint = state.units.find(u => u.kit === "mint");
  const pre = ruby.resources.preMecha;
  const layersNow = clone(ruby.layers);
  // 机甲的架势用的是明特的：解除时还给明特，瑞比换回自己的
  const mechaDef = Math.max(0, Number(ruby.def) || 0);
  const mechaStunned = !!ruby.stunned;
  // 只有被击落才坠落（两人各自受坠落伤害）；主动解除、纳米耗尽不坠落
  const shot = /击落/.test(String(reason || ""));
  // 银翼+：被击落时瑞比不受坠落伤害、也不失衡，只是退出机甲模式
  const safe = shot && typeof passivePlus === "function" && passivePlus(ruby, 2);
  // 按来源分回去：标了 mecha 的是明特的（老存档没有标记的按装甲算）。
  // 先分好再去掉标记（以前先删标记再分，瑞比身上留着明特的装甲层，两人还共用同一个层对象）
  const tagged = layersNow.some(l => l.mecha);
  const armor = layersNow.filter(l => tagged ? l.mecha : l.type === "armor");
  const rest = layersNow.filter(l => tagged ? !l.mecha : l.type !== "armor");
  armor.forEach(l => { delete l.mecha; });
  if (rest.length) ruby.layers = rest;
  else if (pre) ruby.layers = pre.layers;
  ruby.flying = false;
  ruby.resources.mecha = false;
  ruby.resources.overdrive = false;   // 机体强化随机甲结束
  if (safe && ruby.stunned) ruby.stunned = false;
  // 架势还原成瑞比自己的上限 / 当前值（以前解除后一直用着明特的，10 级 5 → 3）；被击落失衡的留在 0。
  // 机甲期间挂上的震荡（上限 −2，_waveCut）照样扣在还原后的上限上，震荡解除时再加回来
  if (pre) {
    ruby.defMax = Math.max(1, (Number(pre.defMax) || Number(ruby.defMax) || 1) - (Number(ruby._waveCut) || 0));
    ruby.def = ruby.stunned ? 0 : Math.max(1, Math.min(ruby.defMax, Number(pre.def) || 0));
  }
  if (mint) {
    mint.hidden = false;
    mint.fused = false;
    mint.zone = ruby.zone;
    mint.ap = ruby.ap || 0;
    mint.apMax = ruby.apMax || mint.apMax;
    mint.bonus = ruby.bonus || 0;
    mint.bonusMax = ruby.bonusMax || mint.bonusMax;
    notes.push(`机甲解除后行动资源同步：瑞比/明特 行动点 ${mint.ap}，附赠 ${mint.bonus}`);
    if (armor.length) { mint.layers = armor; armor.forEach(l => delete l.inner); armor[armor.length - 1].inner = true; }
    // 明特带走机甲这段时间的架势（不然解除一次两个人的架势都回满）；机甲失衡（被击落）时明特也失衡
    mint.def = mechaStunned ? 0 : Math.min(Number(mint.defMax) || 0, mechaDef);
    if (mechaStunned) mint.stunned = true;
    // 坠落伤害只在被击落时算一次（通用的「飞行被击落扣 20%」对机甲不再先扣一遍，见 engine.js · resolveAttack）
    if (shot) {
      const fall = safe ? 0 : Math.floor(totalMaxHp(ruby) * 0.2);
      const fallM = Math.floor(totalMaxHp(mint) * 0.2);
      if (fall) applyTrueDamage(ruby.layers, fall);
      applyTrueDamage(mint.layers, fallM);
      notes.push(safe ? `银翼+：瑞比安全退出机甲（不受坠落伤害、不失衡）；明特坠落 ${fallM}` : `坠落：瑞比 ${fall}，明特 ${fallM}`);
    }
  }
  ruby.atk = (ruby.personalAtk || 0) + (ruby.weaponHeld === false ? 0 : (ruby.weaponAtk || 8));
  return notes;
}

function spawnLiveCard(card, zone) {
  const u = unitOf(card.name, card.level, card.layers, card.def, card.atk, {
    isPlayer: true,
    flying: card.flying,
    range: card.range,
    element: card.suggest && card.suggest.element,
    kit: card.kit,
    personalAtk: card.personalAtk,
    weaponAtk: card.weaponAtk,
    weaponHeld: card.weaponOf ? false : true,
    resources: card.resources,
    shp: card.shp || 0,
    shpMax: card.shpMax || card.shp || 0
  });
  u.zone = zone || card.zone || 1;
  u.enName = card.enName || "";
  u.weaponOf = card.weaponOf || null;
  u.suggest = card.suggest || u.suggest;
  u.note = card.note;
  u.attrs = card.attrs ? Object.assign({}, card.attrs) : null;
  u.roles = card.roles ? Object.assign({}, card.roles) : null;
  u.xp = card.xp || 0;
  u.attrPoints = card.attrPoints || 0;
  u.growth = card.growth ? Object.assign({}, card.growth) : null;
  u.baseHp = card.layers && card.layers[0] ? card.layers[0].hp : 14;
  u.baseAtk = card.personalAtk;
  u.baseShp = card.shpMax || card.shp;
  u.linkedKits = (card.linkedKits && card.linkedKits.slice()) || defaultLinkedKits(card.kit);
  u.weaponLevels = card.weaponLevels ? Object.assign({}, card.weaponLevels) : (u.weaponLevels || {});
  (u.linkedKits || []).forEach(k => {
    if (u.weaponLevels[k] == null) u.weaponLevels[k] = 1;
  });
  u.weaponParts = card.weaponParts ? JSON.parse(JSON.stringify(card.weaponParts)) : (u.weaponParts || {});
  u.bonds = card.bonds ? Object.assign({}, card.bonds) : (u.bonds || {});
  if (u.kit === "hiaki" && typeof refreshHiakiAtk === "function") refreshHiakiAtk(u);
  if (typeof applyLevelStats === "function") applyLevelStats(u);
  return u;
}

function defaultLinkedKits(kit) {
  return ({
    ruby: ["mint"],
    yuito: ["latte"],
    hiaki: ["niu", "naruto"],
    tou: ["mochi"],
    xia: ["berniel"],
    chuan: ["bili"]
  })[kit] || [];
}

/** 载入队伍。kits 不给时读游戏的队伍配置（GAME.partyKits），再没有就用默认四人。
 *  （计算器的按钮会把点击事件传进来，所以只认数组） */
function loadLiveParty(kits) {
  snapshot();
  const keepEnemies = state.units.filter(u => !u.isPlayer && !u.weaponOf);
  state.units = keepEnemies.slice();
  const want = Array.isArray(kits) && kits.length ? kits
    : (typeof window !== "undefined" && window.GAME && Array.isArray(window.GAME.partyKits) && window.GAME.partyKits.length)
      ? window.GAME.partyKits
      : ["ruby", "yuito", "hiaki", "tou"];
  const players = livePartyCards().filter(c => !c.weaponOf && want.indexOf(c.kit) >= 0);
  players.forEach(c => {
    const u = spawnLiveCard(c, 1);
    u.weaponHeld = true;
    u.atk = (u.personalAtk || 0) + (u.weaponAtk || 0);
    state.units.push(u);
  });
  const ruby = findKit("ruby", state.units);
  state.attackerId = ruby ? ruby.id : (state.units[0] && state.units[0].id);
  state.selectedId = state.attackerId;
  state.targetId = null;
  const st = uiEl("skillTargetSel");
  if (st) st.value = "";
  renderAll();
  paintSkillLog("已载入瑞比 / 结人 / 绯秋 / 灯。武器默认持在手上。用「唤出××」把武器人放到场上。");
}

function zoneReachable(unit, dest, walk) {
  if (!unit) return "没有行动者。";
  dest = Number(dest);
  const from = Number(unit.zone);
  if (dest === from) return "必须换到另一个区域。";
  if (dest < 1 || dest > Number(state.zoneMode)) return "没有这个区域。";
  // 沿连接找一条走得通的路线（直排就是一格一格往那边走）；走不通时说出最近一条路上挡着的是什么。
  // walk：自己走一步的普通移动——空隙可以花 1 行动点做运动检定越过（doMoveInner 结算），不算挡住；技能里的移动照旧过不去
  const why = (a, b) => {
    const g = getGap(a, b);
    if (g.type === "wall") return "危墙挡住去路。";
    if (g.type === "door" && !g.open) return "机关门关着。";
    if (g.type === "void" && !(unit.flying || walk || (state.forceVoid && state.forceVoid[gapKey(a, b)]))) return "空隙挡住地面单位。";
    return null;
  };
  if (zonePath(from, dest, (a, b) => !why(a, b))) return null;
  const any = zonePath(from, dest);
  if (!any) return "到不了那个区域。";
  for (let i = 0; i < any.length - 1; i++) { const w = why(any[i], any[i + 1]); if (w) return w; }
  return null;
}

/** 技能里的「移动」（燕飞、圣战起始、居合、引火烧身、爱意、电钻突进、逃离、直流短接、猛扑、发射针尖、针尖剑斩……）能不能走到 dest：
 *  沿相连的区走，危墙 / 关着的机关门 / 空隙（地面单位）挡路，最多 maxSteps 步（不给就不限）；地面单位不能主动走进深渊。
 *  leap：写着「跃」的移动（猛扑）和飞行一样能越过空隙，危墙 / 关着的门照样挡，落点照旧按本人算（地面单位不能跳进深渊）。
 *  走得到返回 null，否则返回原因。以前这些技能直接改所在区，能穿墙 */
/** 选目标时：技能要先移动到目标那一区才出手的（绯秋居合普攻），走不过去（深渊、墙、门）的目标不列出 */
function skillTargetMoveOk(actor, id, u) {
  if (!actor || !u || u.zone == null) return true;
  if (id === "hiaki_aa" && ((actor.resources || {}).stance || "draw") === "iai" && Number(u.zone) !== Number(actor.zone)) {
    return !skillMoveWhy(actor, Number(u.zone), 1);
  }
  return true;
}
function skillMoveWhy(unit, dest, maxSteps, leap) {
  const mover = leap && !unit.flying ? { zone: unit.zone, flying: true } : unit;   // 跃：路上的空隙当飞过去
  const why = zoneReachable(mover, dest);
  if (why) return why;
  const f = state.fields[Number(dest)] || {};
  if (f.abyss && !unit.flying) return "深渊不能站人。";
  if (maxSteps != null) {
    const pass = (x, y) => {
      const g = getGap(x, y);
      return !(g.type === "wall" || (g.type === "door" && !g.open) ||
        (g.type === "void" && !(mover.flying || (state.forceVoid && state.forceVoid[gapKey(x, y)]))));
    };
    const path = zonePath(Number(unit.zone), Number(dest), pass);
    if (!path || path.length - 1 > maxSteps) return `移动 ${maxSteps} 距离走不到那一区。`;
  }
  return null;
}
/** 技能里最多移动 maxSteps 距离能走到的区（不含原地；不给 maxSteps 就不限距离；leap 见 skillMoveWhy） */
function skillMoveZones(unit, maxSteps, leap) {
  const out = [];
  for (let z = 1; z <= Number(state.zoneMode); z++) if (!skillMoveWhy(unit, z, maxSteps, leap)) out.push(z);
  return out;
}

/* ---------- Helumica「环境扫描」：扫描出配置物，或者和配置物 / 地形 / 场地互动 ---------- */
const HELU_SCAN_FIELDS = [
  ["fire", "火场", "立刻结算一次回合开始效果"],
  ["acid", "酸液地面", "立刻结算一次回合开始效果"],
  ["heal", "治愈场地", "立刻结算一次回合开始效果"],
  ["ice", "冻土", "区里所有地面单位受到 1 点冰属性击破"],
  ["collapseOn", "塌陷区域", "塌陷计数立刻 +5"],
  ["energy", "能量场", "立刻累积一次场地高能"],
  ["harmonic", "干涉场", "区里所有单位的下次伤害 ±25%"],
  ["ruinOn", "损毁地面", "立刻扣 20 点耐久"],
  ["electric", "高压场地", "区里所有单位立刻受到一次高压电击"]
];
const HELU_SCAN_SPAWN = ["boom", "acid", "battery", "scrap"];
function heluScanFieldOn(f, k) { return k === "fire" ? fieldFireOn(f) : !!(f && f[k]); }
function heluScanOptions(z) {
  const opts = [{ value: "spawn", label: "扫描出一个配置物（爆炸桶 / 酸液桶 / 超充能电池 / 碎渣机炮，随机）" }];
  (state.props || []).filter(p => Number(p.zone) === Number(z) && !BARRIER_SIDE[p.kind] && !(p.kind === "scrap" && !scrapReady(p))).forEach(p => {
    const what = p.kind === "boom" || p.kind === "acid" ? "直接引爆"
      : p.kind === "battery" ? "提取护盾或引爆"
      : p.kind === "scrap" ? "操控它攻击一名敌人"
      : p.kind === "turret" ? "立刻向 Helumica 的敌人开一炮"
      : (p.kind === "button" || p.kind === "lever") ? "远程触发" : "远程操作";
    opts.push({ value: "prop:" + p.id, label: `${p.name}：${what}` });
  });
  zoneNeighbors(z).map(n => gapKey(z, n)).forEach(key => {
    const g = (state.gaps || {})[key];
    if (g && (g.type === "wall" || g.type === "bridge") && (Number(g.hp) || 0) > 0) {
      opts.push({ value: "gap:" + key, label: `${key} 之间的${gapLabel(g.type)}：耐久 −10（现在 ${g.hp}）` });
    }
  });
  const f = state.fields[z];
  HELU_SCAN_FIELDS.forEach(([k, name, desc]) => {
    if (heluScanFieldOn(f, k)) opts.push({ value: "field:" + k, label: `场地 · ${name}：${desc}` });
  });
  return opts;
}

/* ---------- Helumica「规则干涉」（6 级）：1 距离以内一区变成干涉场（作者 10/23 定）----------
 * 场地能不能改照 fieldChangeWhy（深渊、损毁地面、固有场地、被锁定的改不了）。
 * 分析过当前战场（用过环境扫描，resources.scanned）并且干涉场取代了这一区原本的「别的」场地：同区自选一个单位（敌我都行）
 * 立刻获得附赠动作，可以超过上限。原本没有场地、原本就是干涉场都不给 */
const HELU_RULE = { range: 1, bonus: 1 };
/** 干涉场会取代掉的场地（主场地里除了干涉场以外开着的；高地、深渊、隔离、塌陷这些和场地共存的不算） */
function heluRuleReplaced(z) {
  const f = (state.fields || {})[z];
  if (!f) return [];
  const names = { fireOn: "火场", electric: "高压场地", acid: "酸液地面", ice: "冻土", quicksand: "流沙", coral: "沙珊瑚台地", energy: "能量场", heal: "治愈场地" };
  return FIELD_EFFECT_KEYS.filter(k => k !== "harmonic" && (k === "fireOn" ? fieldFireOn(f) : f[k])).map(k => names[k] || k);
}
/** 这一下给不给附赠动作：分析过战场、这一区的场地改得了、并且会取代掉别的场地 */
function heluRuleBonusOk(a, z) {
  return !!(res(a).scanned && z != null && !fieldChangeWhy(Number(z), "harmonic") && heluRuleReplaced(Number(z)).length);
}
/** 同区能拿附赠动作的单位：敌我都行（在场、没倒下的） */
function heluRuleUnits(z) {
  return fieldUnits().filter(u => Number(u.zone) === Number(z) && !u.dead && !u.hidden && !u.fused && !u._removed);
}
/** 频域造物：选间隙那一步的选项（任意间隙，不限距离；写出现在是什么，会被暂时取代） */
function heluForgeGapOptions() {
  return boardGapKeys().map(k => {
    const g = (state.gaps || {})[k];
    const now = gapStateText(g);
    return { value: k, label: `${k.replace("-", "–")} 区之间：${now}${!g || g.type === "open" ? "" : isWaveGap(g) ? "（换成新的驻波墙）" : "（暂时取代）"}` };
  });
}
/** Helumica 协助攻击附带的环境扫描：排进队列，由画面（或模拟器）问完选项再结算 */
function queueHeluScan(a, zone, lines) {
  if (!a || zone == null) return;
  state.heluScanQueue = state.heluScanQueue || [];
  state.heluScanQueue.push({ actorId: a.id, zone: Number(zone) });
  if (lines) lines.push(`接着对 ${zone} 区进行环境扫描。`);
}
/** 解开保险之后的选择：把最后一发移到队列最前面（front = true）还是留在最后 */
function resolveLonggeSafety(front) {
  const job = (state.longgeSafetyQueue || []).shift();
  if (!job) return;
  const a = unitById(job.actorId);
  const r = a ? longgeRes(a) : null;
  if (!r || r.ammo.length < 2) return;
  const c = r.ammo[r.ammo.length - 1];
  if (front) {
    r.ammo.unshift(r.ammo.pop());
    r.seen.unshift(r.seen.pop());
    longgeSyncKnown(r);
    appendLog(`${a.name} 把最后一发${LONGGE_AMMO[c].name}移到最前面：下一发就是它。`);
  } else appendLog(`${a.name} 让${LONGGE_AMMO[c].name}留在最后。`);
  if (typeof renderAll === "function") renderAll();
}
/** 结算队首的协助扫描。picks 为 null 表示放弃；区域固定为排队时的那一区 */
function resolveHeluScan(picks) {
  const job = (state.heluScanQueue || []).shift();
  if (!job) return;
  const a = unitById(job.actorId);
  if (!a || !picks) { if (a) appendLog(`${a.name} 放弃了这次环境扫描。`); return; }
  const lines = [];
  heluScanAct(a, Object.assign({}, picks, { dest: job.zone }), lines);
  appendLog(lines.join("\n"));
  if (typeof renderAll === "function") renderAll();
}
/** Ecmo 音爆：同区每个配置物按 Helumica 触发配置物的方式触发一次（危墙 / 屏障这类不算；本回合开过的碎渣机炮不算） */
function ecmoBoomTriggerProps(a, lines) {
  const z = Number(a.zone);
  markAoeZone(z, "triggered");   // 音爆本身的范围伤害不再另外扳拉杆 / 打配置物（每个只触发这一次）
  const list = (state.props || []).filter(p => Number(p.zone) === z && !BARRIER_SIDE[p.kind] && !(p.kind === "scrap" && !scrapReady(p)));
  list.forEach(p => {
    if (!(state.props || []).includes(p)) return;   // 前一个爆炸已经把它炸掉了
    const picks = { dest: z, act: "prop:" + p.id };
    if (p.kind === "battery") picks.mode = "boom";
    if (p.kind === "scrap") {
      const t = scrapTargets(p, a)[0];
      if (!t) { lines.push(`音爆触发 ${p.name}：没有打得到的敌人。`); return; }
      picks.target = t.id;
    }
    const out = [];
    heluScanAct(a, picks, out);
    lines.push(...out.map(x => String(x).replace(/^环境扫描：/, "音爆：").replace(/Helumica 的敌人/g, `${a.name} 的敌人`)));
  });
}
/** 执行环境扫描的选择。picks：{ dest, act, mode, ally, target, sign } */
function heluScanAct(a, picks, lines) {
  const z = picks.dest != null ? Number(picks.dest) : Number(a.zone);
  const act = String(picks.act || "spawn");
  const level = a.level || 1;
  if (act === "spawn") {
    const kind = HELU_SCAN_SPAWN[Math.floor(Math.random() * HELU_SCAN_SPAWN.length)];
    const p = makeProp(kind, z, level);
    p.faction = "player";
    state.props = state.props || [];
    state.props.push(p);
    lines.push(`环境扫描：在 ${z} 区找到可用的${p.name}。`);
    if (kind === "battery" && typeof syncBatteryShields === "function") lines.push(...syncBatteryShields());
    return;
  }
  if (act.indexOf("prop:") === 0) {
    const p = (state.props || []).find(x => x.id === act.slice(5));
    if (!p) { lines.push("那个配置物已经不在了。"); return; }
    if (p.kind === "boom" || p.kind === "acid") {
      lines.push(`环境扫描：远程引爆 ${p.name}。`);
      lines.push(...destroyProp(p, a));
    } else if (p.kind === "battery") {
      if (picks.mode === "boom") {
        lines.push(`环境扫描：远程引爆 ${p.name}。`);
        lines.push(...destroyProp(p, a));
      } else {
        const ally = unitById(picks.ally);
        if (!ally || !ally.isPlayer) { lines.push("先选一名友方。"); return; }
        const amt = 5 + 2 * (p.level || 1);
        addShieldLayer(ally, amt, false);   // 不是川川给的护盾，不触发「磁场护盾」
        lines.push(`环境扫描：从 ${p.name} 提取 ${amt} 点护盾给 ${ally.name}。`);
      }
    } else if (p.kind === "scrap") {
      const t = unitById(picks.target);
      if (!t || t.isPlayer || t.dead) { lines.push("先选碎渣机炮要打的敌人。"); return; }
      lines.push(`环境扫描：操控碎渣机炮攻击 ${t.name}。`);
      lines.push(scrapShot(p, t, a));
    } else if (p.kind === "turret") {
      lines.push(`环境扫描：干扰 ${p.name} 的识别，让它立刻向 Helumica 的敌人开一炮。`);
      turretShot(p, !a.isPlayer, lines);
    } else if (p.kind === "button" || p.kind === "lever") {
      toggleDevice(p, "环境扫描");
      lines.push(`环境扫描：远程触发 ${p.name}。`);
    } else {
      lines.push(`${p.name} 没有可以远程操作的地方。`);
    }
    return;
  }
  if (act.indexOf("gap:") === 0) {
    const key = act.slice(4);
    const g = (state.gaps || {})[key];
    if (!g || (g.type !== "wall" && g.type !== "bridge") || !((Number(g.hp) || 0) > 0)) { lines.push("那里已经没有危墙 / 桥梁了。"); return; }
    g.lastFrom = Number(a.zone);
    g.lastBy = a.id;
    // 选了倒塌方向：倒塌按「最后一击来自哪一侧」往另一侧倒，这里把来源记成选定方向的对面
    const parts = key.split("-").map(Number), fall = Number(picks.fall);
    if (g.type === "wall" && parts.includes(fall)) g.lastFrom = fall === parts[0] ? parts[1] : parts[0];
    g.hp = Math.max(0, (Number(g.hp) || 0) - 10);
    lines.push(`环境扫描：找到 ${key} 之间${gapLabel(g.type)}的薄弱点，耐久 −10 → ${g.hp}。`);
    if (g.hp <= 0) lines.push(...destroyGap(key, g));
    return;
  }
  if (act.indexOf("field:") === 0) {
    const k = act.slice(6);
    const f = state.fields[z];
    if (!heluScanFieldOn(f, k)) { lines.push(`${z} 区已经没有这个场地了。`); return; }
    const here = fieldUnits().filter(u => Number(u.zone) === z && !u.dead);
    const ground = here.filter(u => !u.flying);
    lines.push(`环境扫描：激发 ${z} 区的场地。`);
    if (k === "fire") tickFireField(z, lines);
    else if (k === "acid") ground.forEach(u => tickAcidFieldFor(u, currentWeatherFor(u), lines));
    else if (k === "heal") here.forEach(u => tickHealFieldFor(u, currentWeatherFor(u), lines));
    else if (k === "ice") ground.forEach(u => dealBreak(u, 1, "ice", lines, "冻土（环境扫描）"));
    else if (k === "collapseOn") lines.push(...registerZoneBreak(z, 5));
    else if (k === "energy") {
      if (here.length) here.forEach(u => tickEnergyFieldFor(u, f, lines));
      else tickEnergyFieldFor({ name: a.name, level: level }, f, lines);
      checkEnergyFieldBoom(z, lines);
    } else if (k === "harmonic") {
      const up = picks.sign !== "-";
      here.forEach(u => {
        const cur = Number(u.interfere) || 0;
        u.interfere = up ? (cur < 0 ? 0.25 : Math.min(INTERFERE_CAP, cur + 0.25)) : (cur > 0 ? -0.25 : Math.max(-INTERFERE_CAP, cur - 0.25));
        lines.push(`${u.name} 干涉 ${up ? "+" : "−"}25% → 下次伤害 ${u.interfere > 0 ? "+" : ""}${Math.round(u.interfere * 100)}%`);
      });
      if (!here.length) lines.push("区里没有单位。");
    } else if (k === "electric") {
      if (!here.length) lines.push("区里没有单位。");
      here.forEach(u => lines.push(...pulseHighVoltage(u, 1)));
    } else if (k === "ruinOn") {
      f.ruinHp = Math.max(0, (Number(f.ruinHp) || 0) - 20);
      lines.push(`${z} 区损毁地面耐久 −20 → ${f.ruinHp}/${f.ruinMax || 0}`);
      if (f.ruinHp <= 0) {
        lines.push(`${z} 区损毁地面耐久归零，变为深渊。`);
        destroyRuinGround(z, lines);
      }
    }
    return;
  }
  lines.push(`${z} 区环境扫描完成。`);
}

/* ---------- 击退 / 推开：推到哪一区由攻击方选 ----------
 * 玩家技能（吼叫、驱逐）：目标旁边相连的区不止一个时，多一步「推到哪一区」（skillFlowSteps 的 push）；
 * 只有一个可去的区就直接推过去。没选（旧存档 / 模拟器）按离攻击者最远的那一区。 */
const PUSH_SKILLS = ["mochi_roar", "mint_banish"];
function pushDest(a, t) {
  const fl = state.skillFlow;
  const want = fl && fl.picks && fl.picks.push != null ? Number(fl.picks.push) : null;
  if (want != null && zonesAdjacent(want, t.zone)) return want;
  return otherZone(t.zone, a && a.zone);
}
/** 技能的分步选择（skillFlowStepsAll 列出来的）。选单位的那几步：下潜中的单位不能被选为目标（effects.js · 下潜，#360）——
 *  谐波攻击（这一步写着 harmonic，或者整个技能在 engine.js · SKILL_HITS_SUBMERGED 里）照样留着，别的技能的名单里拿掉。
 *  画面、联机 / 热座的校验（hotseat-validation.js · checkFlow）、模拟器都用这一份：下潜中的单位也选不进去 */
function skillFlowSteps(id, actor, picks) {
  return (skillFlowStepsAll(id, actor, picks) || []).map(st => {
    if (!st || st.type !== "unit" || !Array.isArray(st.units)) return st;
    const harmonic = st.harmonic != null ? !!st.harmonic : skillHitsSubmerged(id);
    // 谐波的那一步记上 harmonic：涉猎专长调用原技能的分步（feats.js · featSkillSteps）时外面再过一遍也不会被拿掉
    if (harmonic) return st.harmonic ? st : Object.assign({}, st, { harmonic: true });
    const units = st.units.filter(u => submergedPickOk(u, false));
    return units.length === st.units.length ? st : Object.assign({}, st, { units });
  });
}
function skillFlowStepsAll(id, actor, picks) {
  picks = picks || {};
  if (!actor) return [];
  if (typeof featOfSkill === "function" && featOfSkill(id)) return featSkillSteps(actor, id, picks);
  if (typeof cyberwareOfSkill === "function" && cyberwareOfSkill(id)) return cyberwareSkillSteps(actor, id, picks);   // 义体（cyberware.js）
  if (id === "sand_pull") return [{ key: "target", type: "unit", optional: false, label: "把谁拉出流沙（距离 1 以内陷住的友方）", units: sandPullTargets(actor) }];
  if (PUSH_SKILLS.includes(id)) {
    // 这两个技能只打同区：目标就在自己这一区，推去的区 = 这一区相连的区
    const zones = zoneNeighbors(actor.zone);
    return zones.length > 1 ? [{ key: "push", type: "zone", optional: false, label: "把目标推到哪一区（相连的区）", zones }] : [];
  }
  const maxZ = Number(state.zoneMode);
  if (id === "solo_support") {
    const info = soloSupportInfo();
    if (!info) return [];
    return [
      { key: "partner", type: "choice", optional: false, label: "叫哪名伙伴登场（每人一场一次）",
        options: info.partners.map(k => {
          const c = livePartyCards().find(x => x.kit === k) || { name: k };
          return { value: k, label: `${c.name}${c.note ? " · " + c.note : ""}` };
        }) },
      // 伙伴打的是谐波协助攻击（Helumica）时，下潜中的敌人也能选（engine.js · SKILL_HITS_SUBMERGED）
      { key: "target", type: "unit", optional: false, label: "对哪名敌人打协助攻击",
        harmonic: !!picks.partner && skillHitsSubmerged(assistSkillId({ kit: picks.partner })),
        units: fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && !u.fused) }
    ];
  }
  if (id === "kolt_swap") {
    const units = fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && !u.fused && Number(u.zone) === Number(actor.zone));
    return [{ key: "target", type: "unit", optional: true, label: "切刀近距离目标（同区，可不选）", units }];
  }
  if (id === "torque_swap") {
    // 拆装部件：先换刀头，再按「换上去的」刀头的距离打——换成电钻打同区，换成酸液炮打距离 1
    const k = findKit("kolt", state.units);
    const next = ((k && k.resources && k.resources.bit) || "drill") === "acid" ? "drill" : "acid";
    const d = next === "acid" ? 1 : 0;
    const units = fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && !u.fused &&
      zoneDist(actor.zone, u.zone, maxZ) === d);
    const steps = [];
    // 换刀头本身触发柯尔特的被动「更换刀头」：先选柯尔特同区一名敌人切刀追击（0.5×atk，可不选）
    const passiveOk = k && !k.dead && !k.hidden && (typeof passiveOn !== "function" || passiveOn(k));
    if (passiveOk) {
      const foes = koltMeleeSwapTargets(k);
      if (foes.length) steps.push({ key: "swapTarget", type: "unit", optional: true,
        label: `更换刀头追击：柯尔特同区一名敌人 ${typeof passivePlus === "function" && passivePlus(k, 1) ? "0.75" : "0.5"}×atk（可不选）`, units: foes });
    }
    steps.push({ key: "target", type: "unit", optional: true,
      label: next === "acid" ? "换成酸液炮，打距离 1 的一名敌人 1×atk +1 击破（可不选）" : "换成电钻，打同区的一名敌人 1×atk +1 击破（可不选）", units });
    return steps;
  }
  if (id === "kolt_short") {
    // 只给场地能变成高压的区域（固有场地 / 深渊 / 损毁地面 / 被锁定的区不能选），别的区还要走得到（koltShortZones）
    const zones = koltShortZones(actor);
    return [{ key: "dest", type: "zone", optional: zones.includes(Number(actor.zone)), label: "可先移动至多 1 区（只列出走得到、能铺高压场地的区）", zones }];
  }
  if (id === "kolt_cannon") {
    const acid = ((findKit("kolt", state.units) || actor).resources || {}).bit === "acid";
    if (acid) {
      // 迫击炮：距离 1-2 的一名敌人，越墙
      return [{ key: "target", type: "unit", optional: false, label: "迫击炮目标（距离 1-2，可越墙）",
        units: fieldUnits().filter(u => { const d = zoneDist(actor.zone, u.zone, state.zoneMode); return !u.isPlayer && !u.dead && !u.hidden && !u.fused && d >= 1 && d <= 2; }) }];
    }
    // 机枪：选一个距离 1 以内、不隔墙的区域，子弹随机打那一区的敌人
    const zones = [];
    for (let z = 1; z <= maxZ; z++) if (zoneDist(actor.zone, z, state.zoneMode) <= 1 && !lineBlocked(actor.zone, z) && visibleEnemies(z).length) zones.push(z);
    return [{ key: "dest", type: "zone", optional: false, label: "机枪扫射哪个区域（距离 1 以内）", zones }];
  }
  if (id === "kolt_mod") {
    // 「非法」改装：废料（所有来源合计）达到上限时，先选目标；目标是我方单位再选只施加过载，还是再消耗等于上限的废料让它 +1 行动点。
    // 废料没到上限就没有分步（照常直接选目标）；目标是敌人也没有后一项
    const k = findKit("kolt", state.units) || actor;
    if (!koltScrapFull(k)) return [];
    const steps = [{ key: "target", type: "unit", optional: false, label: "施加过载的目标（1 距离以内任意单位，含自己）",
      units: fieldUnits().filter(u => !u.fused && zoneDist(actor.zone, u.zone, maxZ) <= 1) }];
    const tgt = picks.target ? unitById(picks.target) : null;
    if (tgt && tgt.isPlayer) {
      const cap = koltScrapCap(k), ap = KOLT_SCRAP.modAp;
      steps.push({ key: "mode", type: "choice", optional: false, label: `废料已达到上限（${koltScrapTotal(k)} / ${cap}）：要不要消耗 ${cap} 废料，让 ${tgt.name} 获得 ${ap} 行动点`,
        options: [{ value: "overload", label: "只施加过载" }, { value: "ap", label: `过载 + 消耗 ${cap} 废料：${tgt.name} 行动点 +${ap}（可以超过上限）` }] });
    }
    return steps;
  }
  if (id === "torque_boost") {
    const bit = ((findKit("kolt", state.units) || {}).resources || {}).bit || "drill";
    if (bit === "acid") {
      const zones = [];
      for (let z = 1; z <= maxZ; z++) zones.push(z);
      return [{ key: "dest", type: "zone", optional: false, label: "酸液炮蓄力落点（任意区域，不限距离）", zones }];
    }
    // 突进终点：距离 1、走得到的区（危墙 / 关着的门 / 空隙挡住的不列出）
    const zs = skillMoveZones(actor, 1);
    const steps = [{ key: "dest", type: "zone", optional: false, label: "突进终点（距离 1）", zones: zs }];
    // 电钻：突进之后自己选打那一区的哪个敌人（以前只会打第一个）
    if (picks.dest != null) {
      const foes = visibleEnemies(Number(picks.dest));
      if (foes.length) steps.push({ key: "target", type: "unit", optional: false, label: "突进后攻击哪个敌人", units: foes });
    }
    return steps;
  }
  if (id === "torque_strip") {
    // 拆下的外层血量：转移给一名同区友方，或者变成柯尔特的废料（单独计算、不受上限）；选废料就不用选接收的友方
    const steps = [
      { key: "target", type: "unit", optional: false, label: "拆卸目标（同区敌人）",
        units: fieldUnits().filter(u => !u.isPlayer && !u.dead && Number(u.zone) === Number(actor.zone)) }
    ];
    if (findKit("kolt", state.units)) {
      steps.push({ key: "mode", type: "choice", optional: false, label: "拆下的外层血量怎么处理",
        options: [{ value: "ally", label: "转移给一名同区友方" }, { value: "scrap", label: "变成柯尔特的废料（单独计算，不受上限）" }] });
    }
    if (picks.mode !== "scrap") {
      steps.push({ key: "ally", type: "unit", optional: false, label: "接收外层血量的同区友方",
        units: fieldUnits().filter(u => u.isPlayer && !u.dead && Number(u.zone) === Number(actor.zone)) });
    }
    return steps;
  }
  if (id === "helu_scan") {
    const zones = [];
    for (let z = 1; z <= maxZ; z++) zones.push(z);
    const steps = [{ key: "dest", type: "zone", optional: false, label: "环境扫描哪一区", zones }];
    const z = picks.dest != null ? Number(picks.dest) : null;
    if (z == null) return steps;
    steps.push({ key: "act", type: "choice", optional: false, label: `${z} 区：扫描出配置物，或者和已有的配置物 / 地形 / 场地互动`,
      options: heluScanOptions(z) });
    const act = String(picks.act || "");
    // 这一下会把危墙打塌（耐久 ≤ 10）：自己选往哪一区倒（以前固定往离 Helumica 远的那边倒）
    if (act.indexOf("gap:") === 0) {
      const key = act.slice(4), g = (state.gaps || {})[key];
      if (g && g.type === "wall" && (Number(g.hp) || 0) > 0 && (Number(g.hp) || 0) <= 10) {
        const who = zz => {
          const us = fieldUnits().filter(u => Number(u.zone) === zz && !u.dead && !u.hidden && !u.fused);
          const foe = us.filter(u => !u.isPlayer).length, ally = us.filter(u => u.isPlayer).length;
          return `敌人 ${foe} 名、友方 ${ally} 名`;
        };
        steps.push({ key: "fall", type: "choice", optional: false, label: `${key} 之间的危墙要塌了：往哪一区倒（倒塌：物理伤害 + 2 击破，不分敌我）`,
          options: key.split("-").map(Number).map(zz => ({ value: zz, label: `往 ${zz} 区倒（${who(zz)}）` })) });
      }
    }
    if (act.indexOf("prop:") === 0) {
      const p = (state.props || []).find(x => x.id === act.slice(5));
      if (p && p.kind === "battery") {
        steps.push({ key: "mode", type: "choice", optional: false, label: "超充能电池",
          options: [{ value: "shield", label: `提取 ${5 + 2 * (p.level || 1)} 点护盾给一名友方` }, { value: "boom", label: "直接引爆" }] });
        if (picks.mode === "shield") {
          steps.push({ key: "ally", type: "unit", optional: false, label: "护盾给谁（任意友方）",
            units: fieldUnits().filter(u => u.isPlayer && !u.dead && !u.hidden && !u.fused) });
        }
      }
      if (p && p.kind === "scrap") {
        steps.push({ key: "target", type: "unit", optional: false, label: "碎渣机炮打谁（2 距离内的敌人）",
          units: scrapTargets(p, actor) });   // 和直接操控同一份名单：不列隔着危墙 / 关着的门的
      }
    }
    if (act === "field:harmonic") {
      steps.push({ key: "sign", type: "choice", optional: false, label: "干涉场：区里所有单位的下次伤害",
        options: [{ value: "+", label: "+25%（叠一层正向干涉）" }, { value: "-", label: "−25%（叠一层反向干涉）" }] });
    }
    return steps;
  }
  if (id === "helu_rule") {
    // 规则干涉：先选区（1 距离以内、场地改得了的）；分析过战场、并且会取代别的场地时，再选那一区的一个单位（敌我都行）拿附赠动作
    const steps = [{ key: "dest", type: "zone", optional: false, label: "哪一区变成干涉场（距离 ≤1，只列出场地能改变的区）",
      zones: envZones(actor, "harmonic", HELU_RULE.range) }];
    const z = picks.dest != null ? Number(picks.dest) : null;
    if (z != null && heluRuleBonusOk(actor, z) && heluRuleUnits(z).length) {
      steps.push({ key: "target", type: "unit", optional: false,
        label: `干涉场取代${heluRuleReplaced(z).join("、")}：${z} 区自选一个单位立刻获得 ${HELU_RULE.bonus} 个附赠动作（敌我都行，可以超过上限）`,
        units: heluRuleUnits(z) });
    }
    return steps;
  }
  if (id === "helu_forge") {
    // 频域造物：选间隙（任意间隙，不限距离）→ 选一种属性 → 降幅还是增幅
    const steps = [{ key: "gap", type: "choice", optional: false, label: "在哪一条间隙创造驻波墙（任意间隙；已有的配置物会被暂时取代）",
      options: heluForgeGapOptions() }];
    if (picks.gap == null) return steps;
    steps.push({ key: "element", type: "choice", optional: false, label: "驻波墙过滤哪一种属性",
      options: WAVE_WALL.elements.map(el => ({ value: el, label: ELE[el] || el })) });
    if (picks.element == null) return steps;
    const el = ELE[picks.element] || picks.element;
    steps.push({ key: "mode", type: "choice", optional: false, label: `${el}属性：降幅还是增幅`,
      options: [
        { value: "dampen", label: `降幅：穿过的${el}伤害 −${Math.round(WAVE_WALL.dampenPct * 100)}%、不造成击破；穿过的单位受到不稳和虚弱` },
        { value: "amplify", label: `增幅：穿过的${el}伤害 +${Math.round(WAVE_WALL.amplifyPct * 100)}%、击破照常；穿过的单位获得坚挺和振奋` }
      ] });
    return steps;
  }
  if (id === "ecmo_focus") {
    const units = fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && !u.fused);
    const steps = [{ key: "target", type: "unit", optional: false, label: "聚焦目标", units }];
    const tgt = picks.target ? unitById(picks.target) : null;
    if (tgt && (tgt.layers || []).length) {
      steps.push({
        key: "layer", type: "choice", optional: false, label: "聚焦哪一层",
        options: tgt.layers.filter(l => (l.current || 0) > 0).map(l => ({ value: l.type, label: (LAYER[l.type] || l.type) + " " + l.current }))
      });
    }
    return steps;
  }
  if (id === "ras_flee") {
    const ras = findKit("ras", state.units) || actor;
    const unstable = !!(ras.resources && ras.resources.unstable);
    // 终点要走得到（危墙 / 关着的门 / 空隙挡住的不列出）；不稳态不限距离，但也不能留在原区
    const zones = skillMoveZones(actor, unstable ? null : 1);
    return [
      { key: "dest", type: "zone", optional: false, label: unstable ? "不稳：移动不限" : "逃离终点（1 距离）", zones },
      { key: "target", type: "unit", optional: true, label: "原区域受击敌人（可不选）",
        units: fieldUnits().filter(u => !u.isPlayer && !u.dead && Number(u.zone) === Number(actor.zone)) }
    ];
  }
  if (id === "xia_selfburn") {
    const zones = skillMoveZones(actor, 1);   // 顺势移动 1 距离：走得到的相连区
    const steps = [];
    if (xiaFuelOn() && xiaFuel() > 0) steps.push({ key: "mode", type: "choice", optional: true, label: `引火烧身 / 引火自焚（燃油 ${xiaFuel()}）`,
      options: [{ value: "", label: "引火烧身" }, { value: "full", label: `引火自焚：消耗 ${xiaFuel()} 燃油，自焚 +${xiaFuel()} 层` }] });
    if (zones.length) steps.push({ key: "dest", type: "choice", optional: true, label: "是否顺势移动 1 距离",
              options: [{ value: 0, label: "留在原地" }].concat(zones.map(z => ({ value: z, label: `移动到 ${z} 区` }))) });
    return steps;
  }
  if (id === "chuan_whip" && (Number(actor.resources && actor.resources.charge) || 0) >= 1) {
    return [{ key: "pull", type: "choice", optional: true, label: "命中后要不要消耗 1 电能，把自己拉到敌人那一区？",
              options: [{ value: "", label: "不拉" }, { value: "pull", label: "命中后拉过去（−1 电能）" }] }];
  }
  if (id === "chuan_wall" && (Number(actor.resources && actor.resources.charge) || 0) >= 3) {
    return [{ key: "shield", type: "choice", optional: true, label: "电能 ≥ 3：要不要额外消耗 1 电能，给铁壁加 atk 点外层护盾？",
              options: [{ value: "", label: "不加（−1 电能）" }, { value: "shield", label: "加护盾（共 −2 电能）" }] }];
  }
  if (id === "bili_field") {
    const c = findKit("chuan", state.units);
    if (c && (Number(c.resources && c.resources.charge) || 0) >= 2) {
      return [{ key: "boost", type: "choice", optional: true, label: `要不要额外消耗 1 电能，护盾再加 ${Number(c.level) || 1} 点（川川等级）？`,
                options: [{ value: "", label: "不加（−1 电能）" }, { value: "boost", label: "加（共 −2 电能）" }] }];
    }
  }
  if (id === "chuan_blade") {
    const near = (z) => zoneDist(Number(actor.zone), Number(z), maxZ) <= 1;   // 1 距离以内
    const units = fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && near(u.zone));
    // 配置物 / 危墙 / 桥梁：自己的铁壁、防护罩不能当目标（structureTargets 已经排除，以前能打自己的铁壁）
    const props = structureTargets(actor, 0, 1);
    if (!props.length) return [];
    return [{ key: "target", type: "unit", optional: false, structures: true, label: "巨刃划空目标（1 距离以内的敌人或配置物）",
              units: units.concat(props) }];
  }
  if (id === "role_activate") {
    // 只列身上确实带状态的敌人；状态多于一种时再选一种
    const units = (typeof fieldUnits === "function" ? fieldUnits() : state.units).filter(u =>
      u && !u.isPlayer && !u.dead && !u.hidden && !u.fused && activatableStatuses(u).length > 0
    );
    const steps = [{ key: "target", type: "unit", optional: false, label: "激活目标（身上有状态效果的敌人）", units }];
    const tgt = picks.target ? unitById(picks.target) : null;
    if (tgt) {
      const opts = activatableStatuses(tgt);
      if (opts.length > 1) {
        steps.push({
          key: "status", type: "choice", optional: false,
          label: `激活 ${tgt.name} 身上的哪一种状态`,
          options: opts.map(o => ({ value: o.key, label: o.label }))
        });
      }
    }
    return steps;
  }
  if (id === "role_spread") {
    // 传播：先选来源 target1（身上有属性状态效果的单位，敌我都行），再选承受者 target（另一个单位，复制过去要有变化）
    const live = fieldUnits().filter(u => !u.fused);
    const src = picks.target1 ? unitById(picks.target1) : null;
    return [
      { key: "target1", type: "unit", optional: false, label: "复制谁身上的状态（有属性状态效果的单位）", units: spreadSources() },
      { key: "target", type: "unit", optional: false, label: "施加给哪一个单位（另一个单位）",
        units: live.filter(u => !src || spreadPlan(src, u).length > 0) }
    ];
  }
  if (id === "role_shelter") {
    // 保释：一次附赠动作可以在这一回合里保释好几名友方，每人用掉一次（剩几次最多选几人）
    const keys = SHELTER_PICKS;
    const left = Math.min(keys.length, roleUsesLeft(actor, id));
    const allies = shelterAllies(actor);
    const steps = [];
    for (let i = 0; i < left; i++) {
      if (i > 0 && !picks[keys[i - 1]]) break;   // 上一步没选人就到此为止
      const taken = keys.slice(0, i).map(k => picks[k]);
      const units = allies.filter(u => taken.indexOf(u.id) < 0);
      if (i > 0 && !units.length) break;          // 没有别的友方可以再保释了
      steps.push({ key: keys[i], type: "unit", optional: i > 0,
        label: i ? "同一个附赠动作再保释一名友方（可不选，每人用掉一次）" : "保释谁（此回合豁免天气与场地）", units });
    }
    return steps;
  }
  if (id === "role_boost") {
    // 借力：任意位置的其他友方，移到任意一区
    const tgt = picks.target ? unitById(picks.target) : null;
    const all = [];
    for (let z = 1; z <= maxZ; z++) all.push(z);
    return [
      { key: "target", type: "unit", optional: false, label: "借力移动哪一名友方（任意位置）", units: boostAllies(actor) },
      { key: "dest", type: "zone", optional: false, label: "移到哪一区（任意距离）", zones: all.filter(z => !tgt || z !== Number(tgt.zone)) }
    ];
  }
  if (id === "role_gold") {
    // 黄金时间：一个身上有即时效果的单位（敌我都行）；有好几种时再选延长哪一种
    const steps = [{ key: "target", type: "unit", optional: false, label: "延长谁身上的即时效果",
      units: fieldUnits().filter(u => !u.fused && goldKeys(u).length > 0) }];
    const tgt = picks.target ? unitById(picks.target) : null;
    const keys = tgt ? goldKeys(tgt) : [];
    if (keys.length > 1) steps.push({ key: "status", type: "choice", optional: false, label: `延长 ${tgt.name} 身上的哪一种即时效果`,
      options: keys.map(k => ({ value: k, label: INSTANT_NAME[k] })) });
    return steps;
  }
  if (id === "role_sturdy" && roleSkillLv(actor) >= 15) {
    // 15 级：可以改用行动点，让全部友方此回合获得坚挺（选「一名友方」时再选目标）
    return [{ key: "mode", type: "choice", optional: false, label: "不倒战意",
      options: [{ value: "one", label: "附赠动作：一名同区友方此回合坚挺" }, { value: "all", label: "行动点：全部友方此回合坚挺" }] }];
  }
  if (id === "role_buffer" && roleSkillLv(actor) >= 15) {
    // 15 级：缓冲可以自选给哪一种血量（选完再选目标）
    return [{ key: "layer", type: "choice", optional: false, label: "缓冲给哪一种血量",
      options: ["shield", "armor", "flesh", "sand", "spirit"].map(k => ({ value: k, label: LAYER[k] })) }];
  }
  if (id === "ruby_refuel") {
    // 补充能源（#219）：纳米 +10，或者把全部纳米压缩成储备能源。纳米是 0 时没有东西可以压缩：不问，直接 +10
    const nano = Math.max(0, Number(actor.resources && actor.resources.nano) || 0), reserve = nanoReserveOf(actor);
    if (nano <= 0) return [];
    return [{ key: "mode", type: "choice", optional: false, label: `补充能源：纳米 +${RUBY_REFUEL.nano}，或者把全部纳米压缩成储备能源`,
      options: [{ value: "nano", label: `纳米 +${RUBY_REFUEL.nano}（现在 ${nano}）` },
        { value: "compress", label: `压缩：纳米 ${nano} → 0，储备能源 ${reserve} → ${reserve + nanoCompressGain(nano)}` }] }];
  }
  if (id === "ruby_trigger" || id === "ruby_short" || id === "wing_aa" || id === "mint_steal") {
    const units = (typeof fieldUnits === "function" ? fieldUnits() : state.units).filter(u =>
      u && !u.isPlayer && !u.dead && !u.hidden && !u.fused &&
      (typeof zoneDist === "function" ? zoneDist(actor.zone, u.zone, maxZ) : Math.abs(Number(actor.zone) - Number(u.zone))) <= 1
    );
    const label = id === "ruby_short" ? "短路目标（距离 1 以内）"
      : id === "wing_aa" ? "银翼普通攻击目标（距离 1 以内）"
      : id === "mint_steal" ? "电力夺取目标（距离 1 以内）"
      : "扳机目标（距离 1 以内）";
    return [{ key: "target", type: "unit", optional: false, label, units }];
  }
  const zones = [];
  for (let z = 1; z <= maxZ; z++) zones.push(z);
  if (id === "yuito_inspire" && (actor.level || 1) >= 10) {
    return [
      {
        key: "mode",
        type: "choice",
        optional: false,
        label: "助威方式",
        options: [
          { value: "turn", label: "附赠动作：本回合振奋" },
          { value: "stay", label: "行动点：持续振奋（直到被清除）" }
        ]
      },
      {
        key: "target",
        type: "unit",
        optional: false,
        label: "振奋目标（其他友方）",
        units: fieldUnits().filter(u => u.isPlayer && u.id !== actor.id && !u.dead && !u.hidden)
      }
    ];
  }
  if (id === "en_gl" || id === "en_ant_shell" || id === "en_riot_bottle") {
    return [{
      key: "dest",
      type: "zone",
      optional: false,
      label: id === "en_gl" ? "榴弹落点区域" : id === "en_riot_bottle" ? "燃烧瓶落点区域" : "大酸液弹落点区域",
      zones
    }];
  }
  if (id === "bili_magnet") {
    const tgt = unitById(picks.target) || propByRef(picks.target);
    const steps = [{
      key: "target",
      type: "unit",
      optional: false,
      label: "磁力移动目标（同区推远 / 其他区拉到身边）",
      units: fieldUnits().filter(u => u.id !== actor.id && !u.dead && !u.hidden)
        .concat((state.props || []).filter(p => p.movable !== false).map(p => ({ id: "prop:" + p.id, name: p.name, zone: p.zone })))
    }];
    if (tgt && Number(tgt.zone) === Number(actor.zone)) {
      steps.push({
        key: "dest",
        type: "zone",
        optional: false,
        label: "推向哪一区",
        zones: zones.filter(z => Number(z) !== Number(tgt.zone))
      });
    }
    return steps;
  }
  if (id === "berniel_dash") {
    const steps = [{
      key: "carry",
      type: "unit",
      optional: true,
      label: "带走同区单位（可不带）",
      units: fieldUnits().filter(u => u.id !== actor.id && Number(u.zone) === Number(actor.zone))
        .concat(movablePropsInZone(actor.zone).map(p => ({ id: "prop:" + p.id, name: p.name, zone: p.zone })))
    }];
    if (ownerEngineOn("xia")) {
      const foes = visibleEnemies(actor.zone);
      if (foes.length) {
        steps.push({
          key: "burn",
          type: "unit",
          optional: false,
          label: "引擎已开：选择原区承受 1×ATK 的敌人",
          units: foes
        });
      }
    }
    steps.push({
      key: "dest",
      type: "zone",
      optional: false,
      label: "飞到哪一区（必须换区）",
      zones: zones.filter(z => Number(z) !== Number(actor.zone) && !zoneReachable({ zone: actor.zone, flying: true }, z))
    });
    return steps;
  }
  if (id === "xia_ram") {
    const fuelStep = xiaFuelOn() && xiaFuel() > 0 ? [{ key: "mode", type: "choice", optional: true, label: `全速撞击 / 全速狂飙（燃油 ${xiaFuel()}）`,
      options: [{ value: "", label: "全速撞击" }, { value: "full", label: `全速狂飙：消耗 ${xiaFuel()} 燃油，额外 ${xiaFuel()} 击破` }] }] : [];
    return fuelStep.concat([
      {
        key: "dest",
        type: "zone",
        optional: false,
        label: "撞击终点（移动 1～2 区）",
        zones: zones.filter(z => {
          const d = zoneDist(actor.zone, z, state.zoneMode);
          return d >= 1 && d <= 2 && !zoneReachable(actor, z);
        })
      },
      {
        key: "target",
        type: "unit",
        optional: false,
        label: "到达后攻击的敌人",
        units: fieldUnits().filter(u => !u.isPlayer && Number(u.zone) === Number(picks.dest))
      }
    ]);
  }
  if (id === "tou_taunt") {
    return [{
      key: "target",
      type: "unit",
      optional: false,
      label: "嘲讽目标（距离 1 以内）",
      units: fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden &&
        zoneDist(actor.zone, u.zone, state.zoneMode) <= 1)
    }];
  }
  if (id === "longge_aa" || id === "longge_chill" || id === "longge_heat") {
    // 枪管手杖：扳机解锁、有子弹时先选手杖（近距离）还是霰弹枪（普攻 / 冷气穿刺是远距离 = 距离 1，热能轰击是近距离）
    const steps = [];
    const gun = longgeGunReady(actor);
    if (gun) {
      const near = id === "longge_aa" && longgeGunNear(actor);   // 枪管手杖+：霰弹枪普攻也能打近距离
      steps.push({ key: "mode", type: "choice", optional: false, label: "用手杖还是霰弹枪",
        options: id === "longge_aa"
          ? [{ value: "cane", label: "手杖：近距离 1atk 冰 +1 击破 · 窥探 1" }, { value: "gun", label: `霰弹枪：${near ? "近 / 远" : "远"}距离 1.5atk 子弹属性 +1 击破（耗 1 弹）` }]
          : id === "longge_heat"
            ? [{ value: "cane", label: "手杖：近距离施加熔融" }, { value: "gun", label: "霰弹枪：近距离特殊射击（耗 1 弹）" }]
            : [{ value: "cane", label: "手杖：近距离施加刺骨" }, { value: "gun", label: "霰弹枪：远距离特殊射击（耗 1 弹）" }] });
    }
    const gunPick = gun && picks.mode === "gun";
    const ds = !gunPick || id === "longge_heat" ? [0] : (id === "longge_aa" && longgeGunNear(actor) ? [0, 1] : [1]);
    // 普通攻击也能打配置物 / 危墙 / 桥梁（冷气穿刺、热能轰击只是上效果，不打物件）
    const structs = id === "longge_aa" ? structureTargets(actor, Math.min(...ds), Math.max(...ds)) : [];
    steps.push({ key: "target", type: "unit", optional: false, structures: structs.length > 0,
      label: ds.includes(1) ? (ds.includes(0) ? "射击目标（距离 0 或 1）" : "射击目标（距离 1）") : "目标（同区）",
      units: fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && !u.fused && ds.includes(zoneDist(actor.zone, u.zone, state.zoneMode))).concat(structs) });
    return steps;
  }
  if (id === "xiaoxiao_burst") {
    return [{ key: "target", type: "unit", optional: false, label: "治疗谁（同区友方）",
      units: fieldUnits().filter(u => u.isPlayer && !u.dead && !u.hidden && !u.fused && Number(u.zone) === Number(actor.zone)) }];
  }
  if (id === "tou_aa") {
    const spend = picks.rangeMode === "far";
    const steps = [];
    if ((actor.resources && (actor.resources.shield || 0) > 0)) {
      steps.push({
        key: "rangeMode",
        type: "choice",
        optional: false,
        label: "是否消耗 1 圣盾把射程改为距离 1",
        options: [
          { value: "near", label: "不消耗，只打同区" },
          { value: "far", label: "消耗 1 圣盾，打距离 1" }
        ]
      });
    }
    const maxD = spend ? 1 : 0;
    steps.push({
      key: "target",
      type: "unit",
      optional: false,
      label: spend ? "攻击目标（距离 ≤1）" : "攻击目标（同区）",
      structures: true,
      units: fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden &&
        zoneDist(actor.zone, u.zone, state.zoneMode) <= maxD).concat(structureTargets(actor, 0, maxD))
    });
    return steps;
  }
  if (id === "tou_bash") {
    // 盾击突进：先移动 ≤1（可留在本区），再选到达后同区的敌人；有圣盾时可以选再盾突一次
    const dest = picks.dest != null ? Number(picks.dest) : Number(actor.zone);
    const steps = [
      { key: "dest", type: "zone", optional: false, label: "移动到哪一区（距离 ≤1，可留在本区）",
        zones: zones.filter(z => Number(z) === Number(actor.zone) || skillMoveZones(actor, 1).includes(z)) },
      { key: "target", type: "unit", optional: false, label: "盾击谁（到达后同区的敌人）",
        units: fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && Number(u.zone) === dest) }
    ];
    if (((actor.resources || {}).shield || 0) >= 1) {
      steps.push({ key: "again", type: "choice", optional: false, label: "要不要耗 1 圣盾再盾突一次（1 击破 + 不稳）",
        options: [{ value: "no", label: "不用" }, { value: "yes", label: "消耗 1 圣盾再盾突" }] });
    }
    return steps;
  }
  if (id === "yuito_cold") {
    return [{ key: "dest", type: "zone", optional: false, label: "哪一区变成冻土（距离 ≤1，只列出场地能改变的区）",
      zones: zones.filter(z => zoneDist(actor.zone, z, state.zoneMode) <= 1 && !fieldChangeWhy(z, "ice")) }];
  }
  if (id === "yuito_duet") {
    return [{ key: "target", type: "unit", optional: false, label: "治疗谁（任意友方）",
      units: fieldUnits().filter(u => u.isPlayer && !u.dead && !u.hidden && !u.fused) }];
  }
  if (id === "tou_start") {
    const dest = picks.dest != null ? Number(picks.dest) : Number(actor.zone);
    const steps = [
      {
        key: "dest",
        type: "zone",
        optional: false,
        label: "移动到哪一区（距离 ≤1，可留在本区）",
        // 要走得到：危墙 / 关着的门 / 空隙挡住的区不列出（以前能穿墙）
        zones: zones.filter(z => Number(z) === Number(actor.zone) || skillMoveZones(actor, 1).includes(z))
      },
      {
        key: "target",
        type: "unit",
        optional: false,
        label: "对谁施加错位（到达后同区）",
        units: fieldUnits().filter(u => !u.isPlayer && Number(u.zone) === dest)
      }
    ];
    if ((actor.resources && actor.resources.shield > 0) && dest !== Number(actor.zone)) {
      steps.push({
        key: "carryMode",
        type: "choice",
        optional: false,
        label: "是否消耗 1 圣盾带一名同区单位一起移动",
        options: [
          { value: "yes", label: "消耗圣盾带人" },
          { value: "no", label: "不带人" }
        ]
      });
      if (picks.carryMode === "yes") {
        steps.push({
          key: "carry",
          type: "unit",
          optional: false,
          label: "一起移动的目标",
          units: fieldUnits().filter(u => u.id !== actor.id && Number(u.zone) === Number(actor.zone))
            .concat(movablePropsInZone(actor.zone).map(p => ({ id: "prop:" + p.id, name: p.name, zone: p.zone })))
        });
      }
    }
    return steps;
  }
  if (id === "mochi_pounce") {
    // 猛扑是「跃」：和飞行一样能越过空隙，危墙、关着的门照样挡；年糕是地面单位，不能跳进深渊（skillMoveWhy 的 leap）。
    // 距离 1 的目标要跳得过去才列出（以前只看距离，能隔墙扑过去）；同区的目标要有地方带过去才列出（不然选完卡在选区那一步）
    const carry = skillMoveZones(actor, null, true);
    const reach = z => Number(z) === Number(actor.zone) ? carry.length > 0 : !skillMoveWhy(actor, z, 1, true);
    const steps = [{
      key: "target",
      type: "unit",
      optional: false,
      label: "猛扑目标（距离1敌人，或同区带走）",
      units: fieldUnits().filter(u => !u.isPlayer && reach(u.zone))
        .concat((state.props || []).filter(p => p.movable !== false && reach(p.zone)).map(p => ({ id: "prop:" + p.id, name: p.name, zone: p.zone })))
    }];
    const t = unitById(picks.target) || propByRef(picks.target);
    if (t && Number(t.zone) === Number(actor.zone)) {
      steps.push({
        key: "dest",
        type: "zone",
        optional: false,
        label: "把目标带到哪一区",
        zones: carry
      });
    }
    return steps;
  }
  if (id === "yuito_amer") {
    const steps = [{
      key: "mode",
      type: "choice",
      optional: false,
      label: "冰美式效果",
      options: [
        { value: "heal", label: "治疗一名单位 2d4" },
        { value: "atk", label: "对目标所在区敌人 0.75atk 冰伤 +1击破" }
      ]
    }];
    // 射程照说明：治疗「距离 1 以内的同伴」；清场「距离 1 的一个区域」（以前不限距离）
    if (picks.mode === "heal") {
      steps.push({
        key: "target",
        type: "unit",
        optional: false,
        label: "治疗谁（距离 1 以内的同伴）",
        units: fieldUnits().filter(u => u.isPlayer && !u.dead && zoneDist(actor.zone, u.zone, state.zoneMode) <= 1)
      });
    } else if (picks.mode === "atk") {
      steps.push({
        key: "target",
        type: "unit",
        optional: false,
        label: "选该区参照单位（清场打距离 1 那一区的敌人）",
        units: fieldUnits().filter(u => !u.dead && zoneDist(actor.zone, u.zone, state.zoneMode) === 1)
      });
    }
    return steps;
  }
  if (id === "yuito_espresso") {
    const steps = [{
      key: "mode",
      type: "choice",
      optional: false,
      label: "意式浓缩效果",
      options: [
        { value: "ap", label: "友方行动点 +1" },
        { value: "atk", label: "1atk 酸液 +2 击破" }
      ]
    }];
    if (picks.mode === "ap") {
      steps.push({
        key: "target",
        type: "unit",
        optional: false,
        label: "给谁加行动点",
        units: fieldUnits().filter(u => u.isPlayer && !u.dead && zoneDist(actor.zone, u.zone, state.zoneMode) <= 1)
      });
    } else if (picks.mode === "atk") {
      steps.push({
        key: "target",
        type: "unit",
        optional: false,
        label: "酸液打击目标",
        units: fieldUnits().filter(u => !u.isPlayer && !u.dead && zoneDist(actor.zone, u.zone, state.zoneMode) <= 1)
      });
    }
    return steps;
  }
  if (id === "yuito_extract") {
    return [{
      key: "dest",
      type: "zone",
      optional: false,
      label: "哪一区变成酸液地面（距离 ≤1，只列出场地能改变的区）",
      zones: zones.filter(z => zoneDist(actor.zone, z, state.zoneMode) <= 1 && !fieldChangeWhy(z, "acid"))
    }];
  }
  if (id === "weapon_retrieve") {
    const here = fallenWeapons(actor).filter(w => Number(w.zone) === Number(actor.zone));
    if (here.length <= 1) return [];
    return [{ key: "weapon", type: "choice", optional: false, label: "取回哪一个",
              options: here.map(w => ({ value: w.id, label: w.name })) }];
  }
  if (id === "hiaki_summon") {
    const usable = typeof summonableBlades === "function" ? summonableBlades(actor) : [];
    const label = { niu: "分出丹生谷", naruto: "分出鳴門" };
    if (usable.length <= 1) return [];
    return [{ key: "blade", type: "choice", optional: false, label: "分出哪一把",
              options: usable.map(k => ({ value: k, label: label[k] })) }];
  }
  if (id === "naruto_fly") {
    // 燕飞：打完之后真的移动 1 格（以前只提示玩家再去按移动）；只列走得到的相连区
    const dests = skillMoveZones(actor, 1);
    return dests.length ? [{ key: "dest", type: "zone", optional: false, label: "燕飞之后移动到哪一区（1 格）", zones: dests }] : [];
  }
  if (id === "hiaki_sheath") {
    const r = actor.resources || {};
    const opts = [];
    if (!r.niuOut) opts.push({ value: "niu", label: "收刀 · 丹生谷" });
    if (!r.narutoOut) opts.push({ value: "naruto", label: "收刀 · 鳴門" });
    if (opts.length <= 1) return [];
    return [{ key: "blade", type: "choice", optional: false, label: "收哪一把进入居合", options: opts }];
  }
  if (id === "mochi_boom") {
    const tou = findKit("tou", state.units);
    const hasShield = !!(tou && (tou.resources.shield || 0) > 0);
    if (!hasShield) return [];
    return [{
      key: "again",
      type: "choice",
      optional: false,
      label: "第一次音爆后，是否消耗灯的 1 圣盾再触发一次",
      options: [
        { value: "once", label: "只触发一次" },
        { value: "twice", label: "消耗圣盾再触发一次" }
      ]
    }];
  }
  if (id === "tou_sonic") {
    // 同区目标（1atk）和距离 1 的目标（0.5atk）各选一个，都可以不选，但至少要选一个
    const near = fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && Number(u.zone) === Number(actor.zone))
      .concat(structureTargets(actor, 0, 0));
    const far = fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && zoneDist(actor.zone, u.zone, state.zoneMode) === 1)
      .concat(structureTargets(actor, 1, 1).filter(x => !near.some(n => n.id === x.id)));
    const steps = [];
    if (near.length) {
      steps.push({
        key: "target1", type: "unit", optional: far.length > 0, structures: true,
        label: far.length ? "同区目标（1atk 谐波，可不选）" : "同区目标（1atk 谐波）",
        units: near
      });
    }
    if (far.length && (!near.length || picks.target1 !== undefined)) {
      steps.push({
        key: "target2", type: "unit", optional: !!picks.target1, structures: true,
        label: picks.target1 ? "距离 1 的目标（0.5atk 谐波，可不选）" : "距离 1 的目标（0.5atk 谐波）",
        units: far
      });
    }
    return steps;
  }
  if (id === "ufo_sweep") {
    return [{
      key: "dest",
      type: "zone",
      optional: false,
      label: "扫射哪一区（距离 ≤1，含本区）",
      zones: zones.filter(z => zoneDist(actor.zone, z, state.zoneMode) <= 1)
    }];
  }
  if (id === "en_giant_sand_melee") {
    const foes = fieldUnits().filter(u => u.isPlayer && !u.dead && !u.dying && Number(u.zone) === Number(actor.zone));
    const first = foes.filter(u => u.id !== picks.target1);
    const steps = [{
      key: "target1",
      type: "unit",
      optional: false,
      label: "穿刺第一目标",
      units: foes
    }];
    if (picks.target1) {
      steps.push({
        key: "target2",
        type: "unit",
        optional: true,
        label: "穿刺第二目标（可不选，不能与第一目标相同）",
        units: first
      });
    }
    return steps;
  }
  return [];
}

function beginSkillFlow(id) {
  const actor = unitById(state.attackerId);
  if (!actor) { appendLog("先选行动发起者。"); return; }
  const steps = skillFlowSteps(id, actor, {});
  if (!steps.length) { runSkill(id); return; }
  state.skillFlow = { id, actorId: actor.id, picks: {}, index: 0 };
  appendLog(`开始「${id}」分步选择。`);
  renderAll();
}

function cancelSkillFlow() {
  state.skillFlow = null;
  renderAll();
}

function flowStep() {
  const fl = state.skillFlow;
  if (!fl) return null;
  const actor = unitById(fl.actorId);
  const steps = skillFlowSteps(fl.id, actor, fl.picks);
  return steps[fl.index] || null;
}

function applyFlowPick(value) {
  const fl = state.skillFlow;
  if (!fl) return;
  const step = flowStep();
  if (!step) return;
  fl.picks[step.key] = value;
  fl.index += 1;
  const actor = unitById(fl.actorId);
  const steps = skillFlowSteps(fl.id, actor, fl.picks);
  if (fl.index >= steps.length) {
    const id = fl.id;
    runSkill(id);
    state.skillFlow = null;
    renderAll();
    return;
  }
  renderAll();
}

function renderSkillFlow() {
  if (!HAS_DOM) return;
  const pane = uiEl("skillFlowPane");
  if (!pane) return;
  const fl = state.skillFlow;
  if (!fl) { pane.classList.add("hidden"); pane.innerHTML = ""; return; }
  const actor = unitById(fl.actorId);
  const steps = skillFlowSteps(fl.id, actor, fl.picks);
  const step = steps[fl.index];
  if (!step) { pane.classList.add("hidden"); return; }
  pane.classList.remove("hidden");
  const names = {
    berniel_dash: "点火突进", bili_magnet: "磁力移动", xia_ram: "全速撞击", tou_start: "圣战起始",
    mochi_pounce: "猛扑", en_giant_sand_melee: "穿刺", ufo_sweep: "激光扫射",
    yuito_amer: "冰美式", yuito_espresso: "意式浓缩", yuito_extract: "酸萃",
    hiaki_summon: "分出刀", hiaki_sheath: "收刀", tou_sonic: "声波切割", mochi_boom: "音爆"
  };
  pane.innerHTML = `<div class="flow-title">${names[fl.id] || fl.id} · 步骤 ${fl.index + 1}/${steps.length} · ${step.label}</div>
    <div class="flow-opts"></div>`;
  const opts = pane.querySelector(".flow-opts");
  if (step.type === "unit") {
    (step.units || []).forEach(u => {
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = `${u.name}（${u.zone}区）`;
      b.onclick = () => calcCommand("skillPick", { value: u.id });
      opts.appendChild(b);
    });
  } else if (step.type === "zone") {
    (step.zones || []).forEach(z => {
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = z + " 区";
      b.onclick = () => calcCommand("skillPick", { value: Number(z) });
      opts.appendChild(b);
    });
  } else if (step.type === "choice") {
    (step.options || []).forEach(opt => {
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = opt.label;
      b.onclick = () => calcCommand("skillPick", { value: opt.value == null ? null : opt.value });
      opts.appendChild(b);
    });
  }
  if (step.optional) {
    const skip = document.createElement("button");
    skip.className = "btn small";
    skip.textContent = "不选";
    skip.onclick = () => calcCommand("skillPick", { value: null });
    opts.appendChild(skip);
  }
  const cancel = document.createElement("button");
  cancel.className = "btn small danger";
  cancel.textContent = "放弃（Esc）";
  cancel.onclick = () => calcCommand("skillCancel");
  opts.appendChild(cancel);
}

function renderSkills() {
  if (!HAS_DOM) return;
  const box = uiEl("skillBtns");
  const hint = uiEl("skillKitHint");
  const res = uiEl("skillRes");
  if (!box) return;
  renderSkillFlow();
  syncBladeSel();
  const bladeField = uiEl("bladeField");
  const a0 = unitById(state.attackerId);
  if (bladeField) bladeField.style.display = a0 && a0.kit === "hiaki" ? "" : "none";
  const a = unitById(state.attackerId);
  box.innerHTML = "";
  const enemySkills = (!a || a.isPlayer) ? [] : enemySkillList(a);
  if (!a || (!a.kit && !enemySkills.length)) {
    if (hint) hint.textContent = "先点一个单位当攻击者。玩家有角色技能，敌人有攻击/移动按钮。";
    if (res) res.textContent = "";
    return;
  }
  if (hint) {
    const extra = (a.resources && a.resources.mecha) ? " · 机甲：银翼技能组。"
      : (isUnarmed(a) ? " · 空手：仅空手攻击 / 职责技能 / 可空手技能。" : " · 选目标后点技能，会立刻结算。");
    hint.textContent = (a.note || a.name) + extra;
  }
  if (res) res.textContent = a.isPlayer ? resourceText(a) : ((a.kit || "敌人") + (a.resources && a.resources.primed ? " · 已预热" : "") + (a.resources && a.resources.fuse != null ? " · 引信 " + a.resources.fuse : ""));
  const list = (a.isPlayer ? skillList(a) : enemySkills.map(s => ({ id: s.id, name: s.label, hint: s.label })))
    .filter(sk => !/协助攻击|协助格挡|空手格挡/.test(sk.name || "") && sk.id !== "assist_block" && !/_assist$/.test(sk.id || ""));
  list.forEach(sk => {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = sk.name;
    btn.title = sk.hint || "";
    btn.onclick = () => calcCommand("skill", { actor: a.id, skill: sk.id, target: state.targetId || null });
    box.appendChild(btn);
  });
  (state.props || []).filter(p => Number(p.zone) === Number(a.zone) && (p.kind === "button" || p.kind === "lever")).forEach(p => {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = p.kind === "lever" ? `扳动${p.name}` : `按下${p.name}`;
    btn.onclick = () => calcCommand("skill", { actor: a.id, skill: "use_device:" + p.id, target: state.targetId || null });
    box.appendChild(btn);
  });
  scrapsFor(a).forEach(p => {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = `操控${p.name}`;
    btn.title = "消耗 1 行动点：对机炮 2 距离内的一名敌人（先选为目标）打 1d4 次 6+等级 物理，2 击破；每用一次耐久 −1";
    btn.onclick = () => calcCommand("skill", { actor: a.id, skill: "use_scrap:" + p.id, target: state.targetId || null });
    box.appendChild(btn);
  });
  if (a.isPlayer && !isWeaponUnit(a) && a.dying && !a.dead) {
    const up = document.createElement("button");
    up.className = "btn ok";
    up.textContent = "起身";
    up.onclick = () => calcCommand("standUp", { actor: a.id });
    box.appendChild(up);
  }
}

function currentLogPage() {
  if (!state.logPages.length) {
    state.logPages = [{ turn: state.turnNo || 1, lines: [] }];
    state.logIndex = 0;
  }
  return state.logPages[state.logIndex];
}

const DMG_ELE_CLASS = {
  fire: "dmg-fire", ice: "dmg-ice", electric: "dmg-electric",
  energy: "dmg-energy", physical: "dmg-physical", acid: "dmg-acid", harmonic: "dmg-harmonic"
};

function detectLogElement(text) {
  const s = String(text || "");
  if (/火焰|自焚|灼烧|火场|喷火|焰袭|斩炎/.test(s) && !/冰/.test(s)) return "fire";
  if (/冰冻|寒冰|冻伤|冻土|霜/.test(s)) return "ice";
  if (/电击|闪电|感电|高压|电流/.test(s)) return "electric";
  if (/谐波|声波|吼叫|音爆/.test(s)) return "harmonic";
  if (/酸液|腐蚀|酸萃/.test(s)) return "acid";
  if (/能量/.test(s)) return "energy";
  if (/物理|砸|撞击|猛扑/.test(s)) return "physical";
  if (/火/.test(s)) return "fire";
  if (/冰/.test(s)) return "ice";
  if (/电/.test(s)) return "electric";
  if (/酸/.test(s)) return "acid";
  return null;
}

function colorizeLogLine(text) {
  let html = escapeHtml(text);
  const ele = detectLogElement(text);
  const cls = ele ? DMG_ELE_CLASS[ele] : "";
  if (cls) {
    html = html.replace(/(伤害\s*)(\d+)/g, `$1<span class="${cls}">$2</span>`);
    html = html.replace(/(\d+)(\s*点?(?:火焰|冰冻|寒冰|电击|能量|物理|酸液|谐波)?伤害)/g, `<span class="${cls}">$1</span>$2`);
    html = html.replace(/(第\d+击：)(\d+)/g, `$1<span class="${cls}">$2</span>`);
    html = html.replace(/(合计\s*)(\d+)/g, `$1<span class="${cls}">$2</span>`);
    html = html.replace(/(承受倒塌\s*)(\d+)/g, `$1<span class="${cls}">$2</span>`);
    html = html.replace(/(击破\s*)(\d+)/g, `$1<span class="${cls}">$2</span>`);
    html = html.replace(/(火焰|冰冻|寒冰|电击|能量|物理|酸液|谐波)/g, `<span class="${cls}">$1</span>`);
  }
  return html;
}

const STATUS_POP = {
  burn: { name: "灼烧", element: "fire" },
  shock: { name: "感电", element: "electric" },
  corr: { name: "腐蚀", element: "acid" },
  frostbite: { name: "冻伤", element: "ice" },
  shockwave: { name: "震荡", element: "physical" },
  high: { name: "高能", element: "energy" },
  reso: { name: "共振", element: "harmonic" },
  unstable: { name: "不稳", element: "harmonic" },
  melt: { name: "熔融", element: "fire" },
  shift: { name: "错位", element: "harmonic" },
  reflect: { name: "折射", element: "harmonic" },
  refract: { name: "折射", element: "harmonic" },   // 即时效果「折射」的键（超音波）
  overload: { name: "超载", element: "electric" },
  neutralize: { name: "中和", element: "acid" }
};

function nextFloaterSlot(unitId) {
  const now = Date.now();
  const live = (state.floaters || []).filter(f => f.unitId === unitId && now - f.born < f.dur * 1000);
  const used = {};
  live.forEach(f => { used[f.slot || 0] = true; });
  let slot = 0;
  while (used[slot]) slot += 1;
  return slot;
}

function spawnPopup(unit, spec) {
  if (!unit || unit.hidden) return;
  spec = spec || {};
  const kind = spec.kind || "dmg";
  // 自爆小车的「引爆」（carboom）只是战斗画面的演出（game.js 接管 spawnPopup，记进演出带）：计算器页不弹，
  // 也就不为浮字编号多抽一次随机数——装了种子随机数的模拟（BattleSim）照旧和以前一样复现
  if (kind === "carboom") return;
  const element = spec.element || "physical";
  let text = spec.text;
  let dur = 2.3;
  let size = 14;
  let big = false;
  if (kind === "dmg") {
    const dmg = Math.floor(Number(spec.value) || 0);
    if (dmg <= 0) return;
    const bh = bigHitInfo(unit.level, dmg);
    const ratio = bh.ratio;
    big = bh.big;
    dur = big ? 3 + ratio * 1.5 : 2.3;
    size = big ? 26 + ratio * 18 : 15;
    text = big ? dmg + "!!" : String(dmg);
  } else if (kind === "highboom") {
    text = "高能自爆";
    size = 20; dur = 3; big = true;
  } else if (kind === "break") {
    const br = Math.floor(Number(spec.value) || 0);
    if (br <= 0) return;
    text = "击破" + br;
    size = 13;
    dur = 2.3;
  } else {
    if (!text) return;
    size = 13;
    dur = 2.4;
  }
  const item = {
    fid: "f" + Math.random().toString(36).slice(2, 8),
    unitId: unit.id,
    text,
    element,
    kind,
    big,
    dur,
    size,
    slot: nextFloaterSlot(unit.id),
    born: Date.now()
  };
  state.floaters = (state.floaters || []).concat(item);
  setTimeout(() => {
    state.floaters = (state.floaters || []).filter(f => f.fid !== item.fid);
    const el = uiEl("floater-" + item.fid);
    if (el) el.remove();
  }, Math.ceil(dur * 1000) + 40);
}

function spawnFloater(unit, dmg, element) {
  spawnPopup(unit, { kind: "dmg", value: dmg, element: element });
}

/** 架势显示：训练假人（架势 ≥ DEF_INF_AT）写 ∞，其余照 当前/上限 */
const DEF_INF_AT = 100000;
function defText(u) {
  return Math.max(Number(u.defMax) || 0, Number(u.def) || 0) >= DEF_INF_AT ? "∞" : `${u.def}/${u.defMax}`;
}

function isEffectivelyStunned(u) {
  if (!u) return false;
  if (u.stunned) return true;
  if (u.kit === "ufo_leg" || u.noPosture || (u.name && String(u.name).indexOf("机械足") === 0)) {
    const body = typeof ufoBodyOf === "function" ? ufoBodyOf(u) : null;
    return !!(body && body.stunned);
  }
  return false;
}

function isUfoLeg(u) {
  return !!(u && (u.kit === "ufo_leg" || u.noPosture || (u.name && String(u.name).indexOf("机械足") === 0)));
}

function clearUfoLegStun(u) {
  if (!isUfoLeg(u)) return;
  u.kit = u.kit || "ufo_leg";
  u.noPosture = true;
  u.stunned = false;
  u.def = 0;
  u.defMax = 0;
  u._imbalanceLock = false;
}

/** 某个状态 / 效果在这个单位身上生效了：画面上对应的图标放大一下并发光（hud-icons.js 的 key） */
function procFx(unit, fx) {
  if (unit && fx && typeof spawnPopup === "function") spawnPopup(unit, { kind: "proc", fx });
}
const PROC_DOT_FX = { burn: "burn", selfburn: "selfBurn", shock: "shock", corr: "corr", reso: "reso", high: "high" };

/** 直接结算击破、不走 dealTo 的技能（特盛乱打、破势、蓝弹气化）也吃「下一击」上的猛击（全力以赴）：
 *  只有第一下吃到——击破 ×2、攻击者承受原击破，然后用掉，和 dealTo 打多个目标时一样。
 *  反震也走 dealBreak：打进失衡时写失衡、结束自我效果、敌人可以协助攻击，屹立不倒 / 坚挺照算（和正常攻击的反震一样） */
function smashableBreak(a, u, amount, element, notes, reason) {
  if (a && a.resources && a.resources.smashNext) {
    a.resources.smashNext = false;
    notes.push(`全力以赴：对 ${u.name} 的${reason}带猛击（击破 ×2，${a.name} 承受原击破）。`);
    dealBreak(u, amount * 2, element, notes, reason + "·猛击", { by: a });
    dealBreak(a, amount, "none", notes, "猛击反震", { by: u });
    return;
  }
  dealBreak(u, amount, element, notes, reason, { by: a });
}

/** 不经过攻击的击破（状态、场地、技能直接给的击破……）。
 *  opt.by：造成这次击破的单位——打进失衡时它不能接自己的协助攻击（queueAssistAttack） */
function dealBreak(unit, amount, element, notes, reason, opt) {
  if (unit) unit._brokeNow = false;
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  if (!unit || !amount) return;
  if (unit.trainingDummy) return;   // 训练假人架势无限：吃不到任何击破
  opt = opt || {};
  if (/冻伤/.test(reason || "")) procFx(unit, "frost");
  notes = notes || [];
  let sink = unit;
  if (isUfoLeg(unit)) {
    clearUfoLegStun(unit);
    sink = (typeof ufoBodyOf === "function" ? ufoBodyOf(unit) : null)
      || (state.units || []).find(x => x.kit === "ufo_body" && !x.dead)
      || unit;
  }
  if (isUfoLeg(sink)) {
    clearUfoLegStun(sink);
    popBreak(unit, amount, element);
    notes.push(`${unit.name} ${reason || "击破"} ${amount}（机械足无架势，已记到本体若存在）`);
    return;
  }
  if (sink.resources && sink.resources.frostShell) {
    notes.push(`${sink.name} 再次霜结：免受击破。`);
    return;
  }
  // 屹立不倒：此回合不受任何来源的击破
  if (sink.resources && sink.resources.standTurn) {
    notes.push(`${sink.name} 屹立不倒：免受击破${reason && reason !== "击破" ? "（" + reason + "）" : ""}。`);
    return;
  }
  // 决不后退（feats.js）：这下击破要把架势打空时，有附赠动作就先 +2 架势（坚挺另算，在下面）
  if (!((sink.statuses && sink.statuses.sturdy) || (sink.resources && sink.resources.divertGuard)) && typeof featUnbowedAuto === "function") featUnbowedAuto(sink, amount, notes);
  const before = Number(sink.def) || 0;
  const wasStunnedSink = !!sink.stunned;
  const wasDoppler = sink.self === "doppler";   // 被这一下打进失衡、多普勒随晕眩结束，这一下照样传出去
  // 坚挺：任何来源的击破都不会把架势打到 1 以下
  const guardFloor = !!(sink.resources && sink.resources.divertGuard);
  if (((sink.statuses && sink.statuses.sturdy) || guardFloor) && before >= 1 && amount > before - 1) {
    amount = before - 1;
    notes.push(`${sink.name} ${guardFloor ? "自保模式" : "坚挺"}：架势保留 1。`);
    if (amount <= 0) return;
  }
  sink.def = Math.max(0, before - amount);
  popBreak(sink, amount, element);
  const tag = sink.id !== unit.id ? `${unit.name}→${sink.name}` : sink.name;
  notes.push(`${tag} 受到 ${amount} 击破${reason && reason !== "击破" ? "（" + reason + "）" : ""}：架势 ${before} → ${sink.def}`);
  if (!state.fields[sink.zone] || !state.fields[sink.zone]._collapsing) {
    notes.push(...registerZoneBreak(sink.zone, amount));
  }
  if (sink.def <= 0) {
    // 只有这一下把架势打到 0 才算「打进失衡」；打已经失衡的目标不再挂冰冻加伤
    const brokeIntoStun = before > 0 && !wasStunnedSink;
    sink.stunned = true;
    if (brokeIntoStun && element === "ice") {
      sink.instant = sink.instant || {};
      sink.instant.iceNext = true;
      notes.push(`${sink.name} 因冰属性击破失衡：下次受到的攻击动作第一击 +50% 伤害。`);
    }
    notes.push(imbalanceLine(sink));
    // 飞行单位被击破：和攻击打空架势一样强制击落，扣 20% 最大生命（engine.js · resolveAttack 的击落）
    if (before > 0) knockdownByBreak(sink, notes);
    if (typeof endSelfOnStun === "function" && !opt.keepSelf) endSelfOnStun(sink, notes);   // keepSelf：猛击反震，留给 dealTo 结算完这一击再结束
    if (typeof endRallyIfCasterDown === "function" && !opt.keepSelf) endRallyIfCasterDown(sink, notes);
    queueAssistAttack(opt.by || null, sink);
    if (brokeIntoStun && typeof onBroken === "function") onBroken(sink, notes);
  } else {
    maybeUnstableTrip(sink, notes, opt.by);
  }
  if (typeof onBreakTaken === "function") onBreakTaken(sink, amount, element, notes, wasDoppler);
  bossQuickRecover(sink, notes);
}

/** 不经过攻击的击破把飞行单位打空架势：强制击落，扣除 20% 最大生命（真伤，从外层扣）。
 *  机甲中的瑞比照攻击路径走解除机甲（坠落伤害、银翼+ 在 exitMecha 里结算） */
function knockdownByBreak(u, notes) {
  if (!u || !u.flying || u.dead) return;
  if (u.kit === "ufo_body") return;   // 飞碟触灵本体的血量跟着机械足走（syncUfoBody），不吃击落
  if (u.resources && u.resources.mecha) {
    if (typeof exitMecha === "function") notes.push(...exitMecha(u, "被击落，机甲解除"));
    return;
  }
  u.flying = false;
  const fall = Math.floor(totalMaxHp(u) * 0.2);
  const loss = applyTrueDamage(u.layers || [], fall);
  if (loss > 0) spawnFloater(u, loss, "physical");
  notes.push(`${u.name} 飞行中被击破：强制击落，扣除 20% 最大生命 ${loss}。`);
  // 我方：倒地统一结算（力竭 3 即死、武器人倒下；和攻击打空架势的击落一样，起身中的人不另扣坚毅）
  if (u.isPlayer) applyKnockdown(u, notes, { cause: "被击落" });
  // 深渊上空被击落：再坠入深渊失去 10%（共 30%），并离开深渊（和攻击打空架势的击落一致）
  if (!u.dead) applyAbyssFall(u, null, notes);
  if (!u.isPlayer && isInnerDepleted(u)) {
    creditPlayerHit(u, actingPlayerId());
    settleEnemyKill(u, notes);
    notes.push(`${u.name} 被击落摔死。`);
    notes.push(...sweepDeadEnemies());
  }
}

/** 挂上不稳：已经不稳的再挂一个 → 两个不稳转成晕眩（失衡）。返回 true = 现在是不稳状态 */
function applyUnstable(u, notes) {
  if (!u) return false;
  if (u.trainingDummy) return false;   // 训练假人：不会不稳 / 晕眩
  u.statuses = u.statuses || {};
  if (u.statuses.unstable) {
    u.statuses.unstable = false;
    if (!u.stunned && !u.noPosture) {
      u.stunned = true;
      if (notes) { notes.push(`${u.name} 叠加两个不稳：转为晕眩。`); notes.push(imbalanceLine(u)); }
      if (typeof endSelfOnStun === "function") endSelfOnStun(u, notes);   // 晕眩后自我效果结束
      if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(u, notes);
      queueAssistAttack(null, u);
    }
    return false;
  }
  u.statuses.unstable = true;
  return true;
}

/** by：让它掉到 1 架势的那个单位（不能接自己打出的失衡的协助攻击） */
function maybeUnstableTrip(u, notes, by) {
  if (!u || u.stunned || u.dead || u.noPosture) return;
  if (u.statuses && u.statuses.sturdy) return;   // 坚挺：剩 1 架势也站得住
  if (u.resources && u.resources.divertGuard) return;   // 扭矩自保模式：和不稳面对坚挺一样（主人确认）
  if (!u.statuses || !u.statuses.unstable) return;
  if ((Number(u.def) || 0) > 1) return;
  u.stunned = true;
  u.statuses.unstable = false;
  notes = notes || [];
  notes.push(`${u.name} 不稳：架势只剩 ${u.def}，直接失衡。`);
  notes.push(imbalanceLine(u));
  if (typeof endSelfOnStun === "function") endSelfOnStun(u, notes);
  if (typeof endRallyIfCasterDown === "function") endRallyIfCasterDown(u, notes);
  queueAssistAttack(by || null, u);
}

function popBreak(unit, amount, element) {
  spawnPopup(unit, { kind: "break", value: amount, element: element });
}

/* ===== 诺拉：刺入 / 双相冲动 / 冷气注射 ==========================
 * 刺入：一次只能刺一个目标，刺新的会自动解除旧的；与诺拉距离 >1 自动结束。
 * 双相：温和 gentle / 残忍 cruel。每回合开始 1/3 概率翻面，击杀后翻一次。
 * 冷气注射：对已有冻伤的目标再施加冻伤时，改为额外一次 1d4+诺拉等级 的冰伤。
 * ============================================================== */
function noraOf() { return typeof findKit === "function" ? findKit("nora", state.units) : null; }
/** 维塔斯本体（分出来之后的单位） */
function vitasOf() { return (state.units || []).find(u => u && u.kit === "vitas" && !u.hidden && !u.dead) || null; }
/** 双相状态属于维塔斯这套武器系统：诺拉持着它时记在诺拉身上，分出来之后两边同步，
 *  即使场上只有其中一个也能正确读写。 */
function moodHolders() {
  return [noraOf(), vitasOf()].filter(Boolean);
}

/** 刺入的对象 id 列表（冷气注射+ 最多两个；旧存档只有 piercedId） */
function pierceIdsOf(h) {
  const r = (h && h.resources) || {};
  if (Array.isArray(r.piercedIds)) return r.piercedIds.slice();
  return r.piercedId ? [r.piercedId] : [];
}
function writePierceIds(ids) {
  moodHolders().forEach(h => { h.resources = h.resources || {}; h.resources.piercedIds = ids.slice(); h.resources.piercedId = ids[0] || null; });
}
function pierceCap() {
  return typeof passivePlusKit === "function" && passivePlusKit("nora", 1) ? 2 : 1;
}
/** 所有还有效的刺入对象（死了 / 离开 1 距离的自动结束） */
function piercedTargets(n) {
  n = n || noraOf() || vitasOf();
  if (!n) return [];
  const ids = pierceIdsOf(n);
  const keep = ids.map(id => unitById(id)).filter(t => t && !t.dead && !t.hidden &&
    zoneDist(Number(n.zone), Number(t.zone), Number(state.zoneMode)) <= 1);
  if (keep.length !== ids.length) writePierceIds(keep.map(t => t.id));
  return keep;
}
function piercedTarget(n) {
  return piercedTargets(n)[0] || null;
}
function isPierced(u) {
  return !!(u && piercedTargets().some(t => t.id === u.id));
}
function setPierce(n, t, lines) {
  if (!t) return;
  n = n || noraOf() || vitasOf();
  if (!n) return;
  if (typeof passiveOn === "function" && !passiveOn(n)) return;   // 放弃被动「冷气注射」：没有刺入
  n.resources = n.resources || {};
  let ids = piercedTargets(n).map(x => x.id).filter(id => id !== t.id);
  // 刺入的上限：1 个；冷气注射+ 2 个。满了就解除最早的那个
  while (ids.length >= pierceCap()) {
    const old = unitById(ids.shift());
    if (old) lines.push(`${old.name} 的刺入解除。`);
  }
  ids.push(t.id);
  writePierceIds(ids);
  spawnPopup(t, { kind: "status", text: "刺入", element: "ice" });
  lines.push(`针尖刺入 ${t.name}${ids.length > 1 ? `（同时刺入 ${ids.length} 个对象）` : ""}。`);
}
/** 结束刺入。only：只结束这一个对象；不给就全部结束 */
function clearPierce(n, lines, why, only) {
  n = n || noraOf() || vitasOf();
  const ids = pierceIdsOf(n || moodHolders()[0]);
  const gone = only ? ids.filter(id => id === only.id) : ids;
  writePierceIds(only ? ids.filter(id => id !== only.id) : []);
  gone.forEach(id => { const prev = unitById(id); if (prev && lines) lines.push(`${prev.name} 的刺入${why || "结束"}。`); });
}
function noraMood(n) {
  const holders = n ? [n].concat(moodHolders().filter(x => x !== n)) : moodHolders();
  for (const h of holders) {
    const m = (h && h.resources || {}).mood;
    if (m === "cruel" || m === "gentle") return m;
  }
  return "gentle";
}
function moodName(m) { return m === "cruel" ? "残忍" : "温和"; }
function setMood(n, mood, lines, why) {
  const holders = moodHolders();
  if (!holders.length) return;
  const before = noraMood();
  const next = mood === "cruel" ? "cruel" : "gentle";
  holders.forEach(h => { h.resources = h.resources || {}; h.resources.mood = next; });
  if (before !== next && lines) {
    lines.push(`维塔斯转为${moodName(next)}${why ? "（" + why + "）" : ""}。`);
    const who = n || holders[0];
    spawnPopup(who, { kind: "status", text: moodName(next), element: next === "cruel" ? "harmonic" : "ice" });
  }
}
function flipMood(n, lines, why) {
  if (!moodHolders().length) return;
  if (typeof passiveOn === "function" && !passiveOn(moodHolders()[0])) return;   // 放弃被动「双相冲动」
  setMood(n, noraMood() === "cruel" ? "gentle" : "cruel", lines, why);
}
/** 冷气注射：施加冻伤，已有冻伤则改为一次冰伤 */
function noraFrost(source, target, lines, atk) {
  if (!target) return;
  const n = noraOf();
  target.statuses = target.statuses || {};
  if (target.statuses.frostbite && n && !(typeof passiveOn === "function" && !passiveOn(n))) {
    const r = takeDice(typeof passivePlus === "function" && passivePlus(n, 1) ? 2 : 1, 4, n.level || 1);   // 冷气注射+：2d4
    lines.push(`冷气注射：${target.name} 已有冻伤，改为 ${r.text} 点冰伤。`);
    dealTo(source, target, {
      atk: 0, mult: 0, flat: r.total, element: "ice", baseBreak: 0,
      flags: { action: false }
    });
  } else {
    target.statuses.frostbite = true;
    target.statuses.latestElement = "ice";
    popStatus(target, "frostbite");
    lines.push(`${target.name} 获得冻伤。`);
  }
}

/* ===== 夕夏 · 狂怒碾压 =========================================
 * 打完若敌人没死也没失衡，夕夏就抓在它身上：位置绑定同区，
 * 不能主动移动，不能协助攻击 / 格挡，不获得行动点与附赠，
 * 每回合开始自动再碾一次。自动碾死目标时返还 1 行动点 1 附赠。
 * ============================================================ */
function crushingTarget(u) {
  if (!u || !u.resources || !u.resources.crushId) return null;
  const t = unitById(u.resources.crushId);
  if (!t || t.dead || t.hidden) { u.resources.crushId = null; return null; }
  return t;
}
function isCrushing(u) { return !!crushingTarget(u); }

/* ===== 夏的燃油（启动引擎+）===== */
const FUEL_MAX = 5;
const FUEL_SKILLS = ["xia_aa", "xia_assist", "xia_execute", "xia_ram", "xia_selfburn", "xia_crush",
  "berniel_spit", "berniel_ignite", "berniel_dash", "berniel_flare"];   // 带有启动引擎效果的技能
function xiaFuelOn() { return typeof passivePlusKit === "function" && passivePlusKit("xia", 1); }
function xiaFuel() { const x = findKit("xia", state.units); return x && x.resources ? (Number(x.resources.fuel) || 0) : 0; }
function addFuel(n, why, lines) {
  const x = findKit("xia", state.units);
  if (!x || !xiaFuelOn()) return 0;
  x.resources = x.resources || {};
  const before = Number(x.resources.fuel) || 0;
  x.resources.fuel = Math.min(FUEL_MAX, before + n);
  const got = x.resources.fuel - before;
  if (got > 0) (lines || []).push(`燃油 +${got}${why ? "（" + why + "）" : ""} → ${x.resources.fuel}/${FUEL_MAX}`);
  if (got > 0 && !lines) appendLog(`燃油 +${got}${why ? "（" + why + "）" : ""} → ${x.resources.fuel}/${FUEL_MAX}`);
  return got;
}
/** 消耗所有燃油，返回消耗的点数 */
function takeFuel() {
  const x = findKit("xia", state.units);
  if (!x || !x.resources || !xiaFuelOn()) return 0;
  const n = Number(x.resources.fuel) || 0;
  x.resources.fuel = 0;
  return n;
}
function crushOnce(a, t, auto) {
  const lines = [];
  if (!a || !t) return lines;
  const atk = effectiveAtk(a, state.units);
  a.zone = Number(t.zone);
  // 已经抓在目标身上（每回合自动再碾）：人就挂在它身上，打飞行目标不用再付「近程打飞行」的附赠行动。
  // 以前照收，可抓住期间夕夏拿不到附赠行动 → 每回合 0 伤害、目标不死不失衡、永远松不开手
  // 第一轮 0.75×atk + 2 击破；抓住后每回合自动再碾改为 1.5×atk + 1d8 + 3 击破
  const opt = auto
    ? { element: "physical", mult: 1.5, dice: [1, 8], baseBreak: 3, atk, flags: { action: true, flyFree: true } }
    : { element: "physical", mult: 0.75, baseBreak: 2, atk, flags: { action: true } };
  const out = hitOne2(a, t, opt, lines);
  if (!out || !out.res || out.res.ok === false) {
    // 没碾到（附赠行动不够打飞行目标、目标打不到……）：抓不住，已经抓着的也松手，免得卡死
    if (a.resources) a.resources.crushId = null;
    lines.push(`${a.name} 没能碾到 ${t.name}，${auto ? "松开了手" : "没能抓住"}。`);
    return lines;
  }
  if (auto) addFuel(1, "狂怒碾压", lines);   // 启动引擎+：狂怒碾压每个使用的回合 +1 燃油
  const dead = t.dead || (t.isPlayer && t.dying);
  if (dead) {
    if (a.resources) a.resources.crushId = null;
    lines.push(`${t.name} 被碾死，夕夏松手。`);
    if (auto) {
      a.ap = (Number(a.ap) || 0) + 1;
      a.bonus = (Number(a.bonus) || 0) + 1;
      lines.push("自动碾压击杀，返还 1 行动点与 1 附赠行动。");
    }
    return lines;
  }
  if (t.stunned) {
    if (a.resources) a.resources.crushId = null;
    lines.push(`${t.name} 失衡，夕夏没能抓住。`);
    return lines;
  }
  a.resources = a.resources || {};
  a.resources.crushId = t.id;
  lines.push(`${a.name} 抓在 ${t.name} 身上，每回合开始自动再碾一次。`);
  return lines;
}
/** 在没有 runSkill 闭包的地方也能打一次伤害 */
function hitOne2(actor, target, opt, lines) {
  // 和技能里的命中一样写出「→ 目标：N 伤害、击破、架势变化」（以前只收 extra，伤害那一行丢掉了，PR #48）
  const defBefore = target && target.def != null ? Number(target.def) || 0 : null;
  let out;
  const captured = withLogSink(() => { out = dealTo(actor, target, opt); });
  if (out && defBefore != null) out.defBefore = defBefore;
  lines.push(...formatHitLines(actor, target, out, captured));
  return out;
}

/** 错位：最外面两层「还有血」的血量层互换位置（打空的层不算）。
 *  两层各记一个标记（shiftSlot 1 = 原来在外的、2 = 原来在内的），层对象被复制、前面插进护盾、被抹掉也认得出来 */
function applyShift(u) {
  if (!u) return;
  u.instant = u.instant || {};
  u.instant.shift = true;
  if (u._shiftSwapped) return;
  const ls = u.layers || [];
  const living = [];
  ls.forEach((l, i) => { if (Number(l.current) > 0) living.push(i); });
  if (living.length < 2) return;
  const [i, j] = living;
  ls[i].shiftSlot = 1;
  ls[j].shiftSlot = 2;
  const tmp = ls[i];
  ls[i] = ls[j];
  ls[j] = tmp;
  u._shiftSwapped = true;
}

/** 错位结束（回合开始）：按标记把那两层换回原来的先后；其中一层已经被抹掉 / 移除就不换（不会把内层换到最外层） */
function clearShift(u) {
  if (!u) return;
  const ls = u.layers || [];
  if (u._shiftSwapped) {
    const a = ls.findIndex(l => l && l.shiftSlot === 1);
    const b = ls.findIndex(l => l && l.shiftSlot === 2);
    // 现在「原来在内的」排在「原来在外的」前面：换回来
    if (a >= 0 && b >= 0 && b < a) {
      const tmp = ls[a];
      ls[a] = ls[b];
      ls[b] = tmp;
    }
  }
  ls.forEach(l => { if (l && l.shiftSlot != null) delete l.shiftSlot; });
  u._shiftSwapped = false;
  if (u.instant) u.instant.shift = false;
}

function popStatus(unit, key) {
  if (unit && unit.isStructure) return;   // 物体不吃状态（#52）
  markStatusOwner(unit, key, actingPlayerId());   // 玩家行动中给敌人挂的状态：记下所有者
  if (key === "shockwave" && typeof syncShockwave === "function") syncShockwave(unit, null);
  const meta = STATUS_POP[key];
  if (meta) spawnPopup(unit, { kind: "status", text: meta.name, element: meta.element });
  if (typeof pulseResonanceStatus === "function") pulseResonanceStatus(unit, key);
}

function attachFloaters(wrap, unitId) {
  if (!HAS_DOM) return;
  const now = Date.now();
  const list = (state.floaters || []).filter(f => f.unitId === unitId && now - f.born < f.dur * 1000);
  list.forEach(f => {
    const el = document.createElement("div");
    el.id = "floater-" + f.fid;
    el.className = "dmg-float " + (DMG_ELE_CLASS[f.element] || "dmg-physical");
    el.textContent = f.text;
    el.style.fontSize = f.size + "px";
    el.style.animationDuration = f.dur + "s";
    el.style.animationDelay = (-(now - f.born) / 1000) + "s";
    const slot = f.slot || 0;
    el.style.left = (50 + ((slot % 2) ? 16 : -16)) + "%";
    el.style.top = (-8 - Math.floor(slot / 2) * 22) + "px";
    wrap.appendChild(el);
  });
}

/* ===== 战斗日志：一次行动收成一块，再按阅读顺序写出来 =====
 * runSkill / finishBlock 执行期间，所有 appendLog 先收进「收集桶」；结束后整理成：
 *   【谁】技能名
 *     消耗 …
 *     → 目标：造成多少伤害、多少击破
 *         掷骰 / 基础伤害 / 属性克制 / 打在哪一层（计算过程，缩进更深）
 *     后果（死亡、经验、掉落、状态……）
 * 同一块里重复的行只留一条；「等待协助格挡选择」这类占位行不写。 */
const LOG_SINKS = [];
let LOG_ACTOR_ID = null;   // 当前这块日志是谁的行动（花费行里是别人时才写名字）
/* 按时间顺序：技能代码先把要说的话 push 进本地的 lines，最后才一起写出；
 * 但同一时刻别处（击破、状态、震荡、配置物……）是直接 appendLog 的，会抢到前面去。
 * 登记在这里的 lines：在同一个收集桶里有人直接写日志之前，先把 lines 里已经攒下的话写出去，保证先发生的先写。 */
const LOG_PENDING = [];
function flushPendingLog(sink, text) {
  const top = LOG_PENDING[LOG_PENDING.length - 1];
  if (!top || top.sink !== sink || !top.lines.length) return;
  // 这次写的正是 lines 攒下的话（paintSkillLog(lines.join(...))）：不用先写一遍
  const joined = top.lines.join("\n");
  if (text != null && (String(text) === joined || String(text).startsWith(joined + "\n"))) { top.lines.length = 0; return; }
  top.lines.splice(0).forEach(t => String(t == null ? "" : t).split(/\n/).forEach(l => sink.push(l)));
}
/** 让 fn 执行期间，lines 里攒的话在别人直接写日志之前先写出去（只在当前收集桶里） */
function dropPendingFor(sink) {
  for (let i = LOG_PENDING.length - 1; i >= 0; i--) if (LOG_PENDING[i].sink === sink) {
    // 技能提前 return、没把 lines 写出去：剩下的照原样丢掉（和以前一样），只撤登记
    LOG_PENDING.splice(i, 1);
  }
}
function withPendingLines(lines, fn) {
  const sink = LOG_SINKS[LOG_SINKS.length - 1];
  if (!sink) return fn();
  LOG_PENDING.push({ lines, sink });
  try { return fn(); } finally { const i = LOG_PENDING.findIndex(p => p.lines === lines); if (i >= 0) LOG_PENDING.splice(i, 1); }
}   // 当前这块日志是谁的行动（花费行里是别人时才写名字）
function logSinkActive() { return LOG_SINKS.length > 0; }
function withLogSink(fn) {
  const sink = [];
  LOG_SINKS.push(sink);
  try { fn(sink); } finally {
    const i = LOG_SINKS.lastIndexOf(sink);
    if (i >= 0) LOG_SINKS.splice(i, 1);
  }
  return sink;
}

/** 技能在日志里显示的名字（不露内部编号） */
function skillDisplayName(a, id) {
  if (!id) return "行动";
  if (id === "assist_block") return "协助格挡";
  try {
    const own = (skillList(a) || []).find(s => s.id === id);
    if (own && own.name) return own.name;
  } catch (e) {}
  try {
    const en = (enemySkillList(a) || []).find(s => s.id === id);
    if (en && en.label) return en.label.replace(/[（(].*$/, "");
  } catch (e) {}
  if (/assist/.test(id)) return "协助攻击";
  if (/_opp$/.test(id)) return "借机攻击";
  if (/_aa$/.test(id)) return "普通攻击";
  return "技能";
}

/** 引擎给出的计算过程 → 人话；去掉 +0%、×1、固定 0 这类不起作用的步骤 */
function tidyCalcLines(log, multi) {
  const out = [];
  let hitNo = 0;
  (log || []).forEach(raw => {
    let s = String(raw || "").trim();
    if (!s) return;
    const m = s.match(/^#(\d+)\s+(.*)$/);
    if (m) {
      const k = Number(m[1]);
      s = m[2];
      if (multi && k !== hitNo) { hitNo = k; out.push(`第 ${k} 击：`); }
    }
    const base = s.match(/^基础包 = ATK ([\d.-]+) × 倍率 ([\d.-]+) \+ 固定 ([\d.-]+) \+ 骰子 ([\d.-]+) = ([\d.-]+)$/);
    if (base) {
      const [, atk, mult, flat, dice, total] = base;
      let t = `基础伤害：ATK ${atk}`;
      if (Number(mult) !== 1) t += ` × ${mult}`;
      if (Number(flat)) t += ` ${Number(flat) > 0 ? "+" : "−"} 固定 ${Math.abs(Number(flat))}`;
      if (Number(dice)) t += ` ${Number(dice) > 0 ? "+" : "−"} 骰子 ${Math.abs(Number(dice))}`;
      out.push(t === `基础伤害：ATK ${atk}` ? t : `${t} = ${total}`);
      return;
    }
    const chart = s.match(/^克制表 (.+?) → (.+?)：([+-]?[\d.]+%)/);
    if (chart) {
      if (/^[+-]?0(\.0)?%$/.test(chart[3])) return;
      out.push(`${multi ? "  " : ""}属性克制：${chart[1]}打${chart[2]} ${chart[3]}`);
      return;
    }
    const sum = s.match(/^加算百分比合计 ([+-]?[\d.]+%) → (.+)$/);
    if (sum) {
      if (/^[+-]?0(\.0)?%$/.test(sum[1])) return;
      out.push(`${multi ? "  " : ""}增减伤合计 ${sum[1]} → ${sum[2]}`);
      return;
    }
    const fin = s.match(/^最终伤害包 ([\d.]+)(?: → 向下取整 (\d+))?$/);
    if (fin) { if (fin[2] != null) out.push(`${multi ? "  " : ""}取整为 ${fin[2]}`); return; }
    const main = s.match(/^主目标：(.+?) ([\d.]+) → ([\d.]+)（吸收 [\d.]+）$/);
    if (main) { out.push(`${multi ? "  " : ""}${main[1]} ${main[2]} → ${main[3]}`); return; }
    if (/^协助格挡成功：目标免伤，击破 \d+ (改由格挡者承担|仍扣在目标的架势上)。$/.test(s)) return;   // 下一行说得更完整
    out.push(`${multi ? "  " : ""}${s.replace(/（溢出不重算）/g, "")}`);
  });
  return out;
}

/** 出血（engine.js · BLEED）的那一行：「出血 n（真实伤害）」；同一次攻击触发了几次就写「出血 10 + 5 = 15（真实伤害）」。没有出血返回 "" */
function bleedLogLine(res) {
  const parts = ((res && res.perHit) || []).map(h => Math.floor(Number(h && h.bleed) || 0)).filter(n => n > 0);
  if (!parts.length) return "";
  const sum = parts.reduce((s, n) => s + n, 0);
  return `出血 ${parts.length > 1 ? parts.join(" + ") + " = " + sum : sum}（真实伤害）`;
}

/** 一次命中写成几行：结果 → 掷骰 → 计算 → 后果 */
function formatHitLines(actor, target, out, captured) {
  if (out && out.structure) return (out.lines || []).map(s => "  " + s);   // 打配置物 / 危墙（dealToStructure）
  const L = [];
  const res = (out && out.res) || {};
  const extra = (out && out.extra) || [];
  const tName = target ? target.name : "目标";
  const after = (captured || []).map(s => String(s).trim()).filter(Boolean);
  if ((out && out.pending) || res.pending) {
    after.filter(s => !/等待协助格挡选择/.test(s)).forEach(s => L.push("  " + s));
    if (!L.length) L.push(`  → ${tName}：等待协助格挡的结果`);
    return L;
  }
  if (res.ok === false) {
    (res.log || []).concat(after).forEach(s => L.push("  ✗ " + String(s).trim()));
    return L;
  }
  const hits = (res.perHit || []).filter(Boolean);
  // 出血单独写一行（bleedLogLine），这里只写这一击本身的伤害
  const dmg = Math.floor((res.total || 0) - (res.bleed || 0)), br = Number(res.breakDealt) || 0;
  let head = `  → ${tName}：`;
  // 协助格挡成功：免伤，击破由格挡者承担
  const hb = Number(res.helperBreak) || 0;
  if (res.blocked) head += `被协助格挡挡下${hb ? `（格挡者承受 ${hb} 击破）` : ""}`;
  else {
    head += `${dmg} 伤害`;
    if (br) head += `、${br} 击破`;
    if (hits.length > 1) head += `（${hits.length} 击）`;
    // 架势：这一击前后实际的架势（含坚挺、背水一战等修正；协助格挡成功时不变）
    const defAfter = target && target.def != null ? Number(target.def) || 0 : null;
    if (out && out.defBefore != null && defAfter != null && out.defBefore !== defAfter) head += `，架势 ${out.defBefore} → ${defAfter}`;
    if (res.broke) head += "，打破架势";
  }
  L.push(head);
  const dice = extra.filter(s => /^\s*掷骰/.test(s));
  const others = extra.filter(s => !/^\s*掷骰/.test(s));
  dice.forEach(s => {
    // 「掷骰 1d6〔5〕=5」→「掷骰 1d6 → 5」；多颗骰子写出每颗：「掷骰 2d4（3+1）→ 4」
    const t = String(s).trim().replace(/^掷骰\s*/, "");
    const m = t.match(/^(.+?)〔(.+?)〕=(.+)$/);
    L.push("      掷骰 " + (m ? `${m[1]}${/[+,]/.test(m[2]) ? "（" + m[2] + "）" : ""} → ${m[3]}` : t));
  });
  const dead = target && (target.dead || (target.isPlayer && target.dying));
  tidyCalcLines(res.log, hits.length > 1)
    .filter(s => !(dead && !target.isPlayer && /架势归零|晕眩/.test(s)))
    .forEach(s => L.push("      " + s));
  const seen = new Set();
  others.concat(after).forEach(s => {
    const t = String(s).trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    // 目标已经死了：不再写它失衡 / 晕眩
    if (dead && !target.isPlayer && /失衡|晕眩|架势归零/.test(t)) return;
    L.push("  " + t);
  });
  return L;
}

/** 一块行动的收尾整理：加标题、去重、去占位 */
function tidyActionBlock(title, lines) {
  const out = [];
  const seen = new Set();
  lines.forEach(raw => {
    const s = String(raw == null ? "" : raw);
    const key = s.trim();
    if (!key) return;
    if (/^等待协助格挡选择$/.test(key)) return;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(/^ /.test(s) || /^——/.test(key) ? s : (title ? "  " + s : s));
  });
  if (!out.length) return [];
  return title ? [title].concat(out) : out;
}

function appendLog(text, kind) {
  if (text == null || String(text) === "") return;   // 空字符串不写成空行
  if (LOG_SINKS.length) {
    const sink = LOG_SINKS[LOG_SINKS.length - 1];
    flushPendingLog(sink, text);
    String(text == null ? "" : text).split(/\n/).forEach(l => sink.push(l));
    return;
  }
  const page = currentLogPage();
  const raw = String(text == null ? "" : text);
  const parts = raw.split(/\n/);
  parts.forEach(line => {
    if (line === "") {
      page.lines.push({ kind: "blank", text: "" });
      return;
    }
    const isBreak = kind === "break" || /【失衡】/.test(line) || /进入失衡/.test(line);
    const isSep = kind === "sep" || /^——/.test(line);
    page.lines.push({
      kind: isBreak ? "break" : isSep ? "sep" : (kind || "line"),
      text: line
    });
  });
  state.logIndex = state.logPages.length - 1;
  renderLog();
}

function paintSkillLog(text) {
  const sum = actionAccLine();
  if (state.actionAcc) state._endedAcc = state.actionAcc;   // 行动结束才判的高能自爆（flushHighBooms）还要靠它找记分归属
  state.actionAcc = null;
  appendLog(sum ? String(text || "") + (text ? "\n" : "") + sum : text);
}

function startLogTurn(label) {
  const last = state.logPages[state.logPages.length - 1];
  if (last && last.lines.length === 0) {
    last.turn = state.turnNo || 1;
  } else {
    state.turnNo = (last ? last.turn : 0) + 1;
    state.logPages.push({ turn: state.turnNo, lines: [] });
  }
  state.logIndex = state.logPages.length - 1;
  appendLog(label || `—— 第 ${state.logPages[state.logIndex].turn} 回合开始 ——`, "sep");
}

function clearLogs() {
  state.turnNo = 1;
  state.logPages = [{ turn: 1, lines: [] }];
  state.logIndex = 0;
  state.statusDmg = {};
  renderLog();
  if (typeof renderBackstage === "function") renderBackstage();
}

/** 日志的纯文本（给跑团复制用）。which：page 当前页 / all 全部 */
function logPlainText(which) {
  const pages = which === "all" ? (state.logPages || []) : [currentLogPage()];
  return pages.map(p => p.lines.map(l => l.kind === "blank" ? "" : l.text).join("\n")).join("\n\n").trim();
}
/** 复制到剪贴板（本地打开网页时 navigator.clipboard 可能不可用，退回老办法） */
function copyText(text, done) {
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    if (done) done(ok);
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done && done(true), fallback);
      return;
    }
  } catch (e) {}
  fallback();
}

function renderLog() {
  if (!HAS_DOM) return;
  const box = uiEl("result");
  const lab = uiEl("logPageLabel");
  if (!box) return;
  const page = currentLogPage();
  if (lab) lab.textContent = `${page.turn ? "第 " + page.turn + " 回合" : "开战前"} · ${state.logIndex + 1}/${state.logPages.length}`;
  if (!page.lines.length) {
    box.innerHTML = `<div class="sub">本回合还没有记录。技能、移动、攻击都会追加在这里。</div>`;
    return;
  }
  box.innerHTML = page.lines.map(l => {
    if (l.kind === "blank") return `<div class="log-line">&nbsp;</div>`;
    if (l.kind === "break") return `<div class="log-line log-break">${escapeHtml(l.text)}</div>`;
    if (l.kind === "sep") return `<div class="log-line log-sep">${escapeHtml(l.text)}</div>`;
    return `<div class="log-line">${colorizeLogLine(l.text)}</div>`;
  }).join("");
  box.scrollTop = box.scrollHeight;
}

/* ---------- 首领和 10 级起精英的晕眩标记（已定） ----------
 * 首领和 10 级起的精英架势被打空时和普通失衡完全一样（协助攻击、打出失衡的分数、冰属性加伤、「打进失衡时」的被动……），
 * 只是每次失衡记 1 个晕眩标记：到它自己的回合开始时，标记没满 BOSS_STUN_MARKS 个就恢复架势、照常行动；
 * 满了才真正晕眩（跳过这个回合），之后标记清零。目的是加快首领战的节奏。 */
const BOSS_STUN_MARKS = 2;
/** 用这套规则的：首领，以及 10 级起的精英（ELITE_RULE_MIN_LEVEL）；还有和载具合并的驾驶员（敌我都算） */
function isBossUnit(u) {
  if (u && u.vehMerged) return true;   // 载具驾驶员：架势、两个晕眩标记用车的，我方抢到车也一样（vehicle.js）
  if (!u || u.isPlayer || typeof enemyRankOf !== "function") return false;
  const r = enemyRankOf(u);
  return r === "boss" || (r === "elite" && (Number(u.level) || 1) >= (typeof ELITE_RULE_MIN_LEVEL !== "undefined" ? ELITE_RULE_MIN_LEVEL : 10));
}
/** 首领这次失衡记一个标记（同一次失衡只记一次）。返回刚记上的标记数，没记返回 0 */
function noteBossBreak(u) {
  if (!isBossUnit(u) || !u.stunned || u._bossMarked) return 0;
  u._bossMarked = true;
  u.stunMarks = Math.min(BOSS_STUN_MARKS, (Number(u.stunMarks) || 0) + 1);
  // 标记没攒满：这次失衡结算完（协助攻击排上队之后）立刻恢复架势，后面的击破接着攒下一个标记，不会白白打在 0 架势上
  if (u.stunMarks < BOSS_STUN_MARKS) u._bossRefill = true;
  return u.stunMarks;
}
function bossMarkText(u) {
  const veh = u.vehMerged && typeof vehicleOf === "function" ? vehicleOf(u) : null;   // 载具驾驶员：标记是车的（vehicle.js）
  return u.stunMarks >= BOSS_STUN_MARKS
    ? `晕眩标记 ${u.stunMarks}/${BOSS_STUN_MARKS}：攒满了，下个回合真正晕眩。`
    : `晕眩标记 ${u.stunMarks}/${BOSS_STUN_MARKS}：${veh ? veh.name : enemyRankOf(u) === "boss" ? "首领" : "精英"}要攒满 ${BOSS_STUN_MARKS} 个才会晕眩，架势立刻恢复，可以接着打下一个标记。`;
}
/** 没攒满标记的失衡：立刻恢复架势（协助攻击照常排队、照常打出） */
function bossQuickRecover(u, notes) {
  if (!u || !u._bossRefill) return;
  u._bossRefill = false;
  if (!u.stunned || u.dead) return;
  const out = [];
  recoverFromStun(u, out);
  if (typeof raceRageMarkBroke === "function") raceRageMarkBroke(u);   // 易怒蛮牛：这一击（含纯击破的一段）打出了失衡，整击不发作
  u._brokeNow = true;           // 这一下确实打进了失衡：后面「打进失衡时」的效果读 brokeInto，不看已经清掉的 stunned
  u._bossAssistWindow = true;   // 排上队的协助攻击还要打它（飞碟触灵本体平时不可直击，只有失衡时的协助攻击打得到）
  out.forEach(s => notes.push(s.replace("晕眩结束", "晕眩标记没攒满，失衡立刻结束")));
}
/** 这一击 / 这次击破把 u 打进了失衡吗：结算前不在失衡，结算后在失衡；或者首领 / 精英标记没攒满、立刻恢复了架势（bossQuickRecover） */
function brokeInto(u, wasStunned) {
  return !wasStunned && !!u && !u.dead && !!(u.stunned || u._brokeNow);
}
/** 兜底：没经过 imbalanceLine 的失衡（直接设成晕眩的那些）也记上标记 */
function settleBossStuns(notes) {
  (state.units || []).forEach(u => {
    if (isBossUnit(u) && !u.dead && noteBossBreak(u) && notes) notes.push(`${u.name} ${bossMarkText(u)}`);
    if (u && u._bossRefill) bossQuickRecover(u, notes || []);
  });
}
/** 敌人回合开始时：失衡中的首领，标记没攒满就只恢复架势、照常行动。返回 true 表示这样处理了 */
function bossShrugStun(u, notes) {
  if (!isBossUnit(u) || !u.stunned) return false;
  noteBossBreak(u);
  if ((Number(u.stunMarks) || 0) >= BOSS_STUN_MARKS) {
    u.stunMarks = 0;          // 真正晕眩：这回合照常跳过，标记清零
    return false;
  }
  recoverFromStun(u, notes);
  notes.push(`${u.name} 失衡结束（晕眩标记 ${u.stunMarks}/${BOSS_STUN_MARKS}，没攒满），这回合照常行动。`);
  return true;
}

function imbalanceLine(unit) {
  if (isBossUnit(unit)) {
    noteBossBreak(unit);
    return `【失衡】${unit.name} 架势归零，进入失衡。${bossMarkText(unit)}`;
  }
  return `【失衡】${unit.name} 架势归零，进入失衡。直到其下一次行动前跳过回合。`;
}

/* ===== 技能使用前提 =====================================================
 * 只看行动者自身的状态，与目标无关。在扣行动点之前检查：
 * 不满足就不扣行动点、不消耗资源，并说明原因。
 * 游戏界面也读这张表，把按钮变灰并写出原因。
 *
 * 加新技能就加一行：id: (a) => 不满足时返回原因字符串，满足返回 null
 * ==================================================================== */
const SKILL_REQUIREMENT = {
  hiaki_flash:    (a) => (res(a).stance || "draw") !== "iai" ? "只能在居合架势下使用" : null,
  hiaki_barrage:  (a) => (res(a).stance || "draw") !== "waki" ? "只能在胁构架势下使用" : null,
  hiaki_powder:   (a) => (res(a).stance || "draw") !== "iai" ? "只能在居合架势下使用" : res(a).powder ? "粉落汤气已经生效" : null,
  niu_standby:    (a) => res(a).standby ? "已经在待命" : null,
  ruby_relay:     () => (findKit("ruby", state.units) || {}).resources && findKit("ruby", state.units).resources.drone ? "已经有小型无人机" : null,
  wing_relay:     () => (findKit("ruby", state.units) || {}).resources && findKit("ruby", state.units).resources.drone ? "已经有小型无人机" : null,
  mint_repair:    () => nanoAvailable() >= 20 ? null : "纳米能源不足 20",   // 纳米 + 储备能源（#219）
  wing_boost:     (a) => res(a).overdrive ? "机体强化已经生效" : null,
  yuito_cold:     (a) => (res(a).liquid || 0) >= 1 ? null : "没有咖啡液",
  yuito_duet:     (a) => (res(a).liquid || 0) >= 2 ? null : "咖啡液不足 2",
  hiaki_pot:      (a) => res(a).blade !== "niu" ? "热锅只能用丹生谷发动" : null,
  yuito_amer:     (a) => (res(a).liquid || 0) < 1 ? "没有咖啡液" : null,
  yuito_espresso: (a) => (res(a).liquid || 0) < 1 ? "没有咖啡液" : null,
  yuito_extract:  (a) => (res(a).liquid || 0) < 1 ? "没有咖啡液"
    : !envZones(a, "acid", 1).length ? "距离 1 以内没有能变成酸液地面的区域（固有场地 / 深渊 / 损毁地面 / 被锁定）" : null,
  // 嘲讽：每场 2 次（5 级 3 次，15 级 4 次）；10 级前一回合只能用一次
  tou_taunt:      (a) => (res(a).tauntLeft || 0) <= 0 ? "本场嘲讽次数已用尽"
    : roleLv(a) < 10 && res(a).tauntTurn != null && res(a).tauntTurn === state.turnNo ? "10 级前每回合只能嘲讽一次" : null,
  solo_support:   (a) => soloSupportError(a),
  sand_pull:      (a) => sandPullTargets(a).length ? null : "距离 1 以内没有陷在流沙里的友方",
  tou_sonic:      (a) => (res(a).shield || 0) < 1 ? "没有圣盾"
    : !skillFlowSteps("tou_sonic", a, {}).length ? "距离 1 以内没有可以打的目标" : null,
  kolt_short:     (a) => ((findKit("kolt", state.units) || a).resources || {}).bit === "acid" ? "直流短接需要电钻模式"
    : !koltShortZones(a).length ? "附近没有能变成高压场地、又走得到的区域（固有场地 / 深渊 / 损毁地面 / 被锁定，或隔着危墙 / 关着的门 / 空隙）" : null,
  // 只改变天气 / 场地的技能：改不了就不能用（免得白白花掉行动点）
  latte_ice:      () => state.weather === "snow" ? "已经是雪天" : weatherChangeWhy("snow"),
  helu_wave:      (a) => state.weather !== "phase" ? weatherChangeWhy("phase")
    : !res(a).scanned ? "相位中再用要先做一次环境扫描（回波探测）" : null,
  helu_storm:     (a) => state.weather !== "sand" ? weatherChangeWhy("sand")
    : !res(a).scanned ? "沙暴中再用要先做一次环境扫描才能调转风向"
    : state.weatherLock ? `天气被「${state.weatherLock}」锁定，无法调转风向` : null,
  helu_rule:      (a) => envZones(a, "harmonic", HELU_RULE.range).length ? null
    : "距离 1 以内没有能变成干涉场的区域（固有场地 / 深渊 / 损毁地面 / 被锁定）",
  helu_forge:     (a) => !res(a).scanned ? "只有扫描过当前战场（用过环境扫描）才能使用"
    : !boardGapKeys().length ? "这块战场没有间隙" : null,
  torque_strip:   (a) => ((findKit("kolt", state.units) || {}).resources || {}).bit === "acid" ? "拆卸模式需要电钻模式" : null,
  // 废物利用：要有「还没利用过的被摧毁的敌人血量层」或腐坏抛射 / 转移注意 / 拆卸模式攒下的废料才能用（同一层不能反复利用）
  kolt_scrap:     (a) => state.lastBrokenLayer || (Number(res(a).divertArmor) || 0) > 0 ||
    [res(a).rotStore, res(a).stripStore].some(s => Object.keys(s || {}).some(k => (Number(s[k]) || 0) > 0))
    ? null : "还没有可以利用的残骸（被摧毁的敌人血量层，或腐坏抛射留下的记录）",
  kolt_rot:       (a) => ((findKit("kolt", state.units) || a).resources || {}).bit !== "acid" ? "腐坏抛射需要酸液炮模式" : null,
  kolt_mod:       (a) => ((findKit("kolt", state.units) || a).resources || {}).bit === "acid" ? "「非法」改装需要电钻模式" : null,
  kolt_cannon:    (a) => koltScrapTotal(a) > 0 ? null : "没有废料可以装填",
  ecmo_probe:     (a) => res(a).probe ? "已经在探测模式" : null,
  edc_siphon:     () => findKit("ras", state.units) ? null : "拉斯缪尔不在场",
  weapon_retrieve: (a) => {
    const list = fallenWeapons(a);
    if (!list.length) return "没有倒下的武器人";
    if (list.some(w => Number(w.zone) === Number(a.zone))) return null;
    return `要走到 ${list.map(w => w.name + " 倒下的 " + w.zone + " 区").join("、")}才能取回`;
  },
  ras_super:      (a) => a && a.self === "conductor" ? "已经处于导体状态" : null,
  ras_torrent:    (a) => fieldUnits().some(u => !u.isPlayer && !u.dead && u.statuses && u.statuses.high) ? null : "场上没有高能状态的敌人",
  edc_drain:      (a) => {
    const ras = findKit("ras", state.units);
    if (!ras) return "拉斯缪尔不在场";
    if (Number(ras.zone) !== Number(a.zone)) return "引流需要与拉斯缪尔同区";
    return null;
  },
  // 放弃被动「启动引擎」：引擎点不着，按钮不能用（以前照扣行动点）
  xia_engine:     (a) => (typeof passiveOn === "function" && !passiveOn(a)) ? "放弃了被动「启动引擎」，引擎点不着" : null,
  xia_execute:    (a) => !res(a).engine ? "处决需要引擎启动" : null,
  xia_ram:        (a) => !res(a).engine ? "全速撞击需要引擎启动" : null,
  xia_selfburn:   (a) => !res(a).engine ? "引火烧身需要引擎启动"
    : (a.self === "burn" ? "已经处于自焚" : null),
  xia_crush:      (a) => !res(a).engine ? "狂怒碾压需要引擎启动" : null,
  chuan_blade:    (a) => (res(a).charge || 0) < 3 ? "巨刃划空需要 3 电能" : null,
  berniel_flare:  (a) => {
    if (typeof ownerEngineOn === "function" && !ownerEngineOn("xia")) return "焰袭需要夕夏的引擎启动";
    const xia = findKit("xia", state.units);
    if (!xia || Number(xia.zone) === Number(a.zone)) return "焰袭需要与夕夏处于不同区域";
    return null;
  },
  chuan_wall:     (a) => (res(a).charge || 0) < 1 ? "没有电能" : null,
  ruby_summon:    (a) => weaponSummonWhy(a, "mint"),
  longge_summon:  (a) => weaponSummonWhy(a, "xiaoxiao"),
  kolt_summon:    (a) => weaponSummonWhy(a, "torque"),
  helu_summon:    (a) => weaponSummonWhy(a, "ecmo"),
  ras_summon:     (a) => weaponSummonWhy(a, "edc"),
  longge_spit:    (a) => res(a).spitUsed ? "本场已经吐过酸了（一局战斗仅限一次）" : null,
  longge_safety:  (a) => (longgeRes(a) || { ammo: [] }).ammo.length ? null : "没有子弹，扳机解不开",
  xiaoxiao_combo: (a) => (longgeRes(a) || { ammo: [] }).ammo.length >= 3 ? null : "连续拳要 3 发子弹",
  xiaoxiao_punch: (a) => (longgeRes(a) || { ammo: [] }).ammo.length ? null : "没有子弹了",
  xiaoxiao_heal:  (a) => (longgeRes(a) || { ammo: [] }).ammo.length ? null : "没有子弹了",
  xiaoxiao_burst: (a) => longgeBurstWhy(a),
  longge_drink:   (a) => (longgeRes(a) || { ammo: [] }).ammo.length ? null : "没有子弹了",
  longge_shuffle: (a) => {
    const r = longgeRes(a) || { ammo: [] };
    if (r.ammo.length < 2) return "剩下的子弹不到 2 发，洗不了";
    return r.shuffleLock ? "洗牌后子弹数量还没变过，不能连续洗牌" : null;
  },
  longge_reload:  (a) => !(typeof passivePlus === "function" && passivePlus(a, 2)) ? "需要胶囊弹药+" : (longgeRes(a) || { ammo: [1] }).ammo.length ? "子弹还没打光" : null,
  yuito_summon:   (a) => weaponSummonWhy(a, "latte"),
  tou_summon:     (a) => weaponSummonWhy(a, "mochi"),
  xia_summon:     (a) => weaponSummonWhy(a, "berniel"),
  chuan_summon:   (a) => weaponSummonWhy(a, "bili"),
  nora_summon:    (a) => weaponSummonWhy(a, "vitas"),
  // 武器人主动收回为武器：要和持有者同区（扣费之前就置灰）
  mint_return:     (a) => weaponReturnWhy(a),
  vitas_return:    (a) => weaponReturnWhy(a),
  latte_return:    (a) => weaponReturnWhy(a),
  niu_return:      (a) => weaponReturnWhy(a),
  naruto_return:   (a) => weaponReturnWhy(a),
  mochi_return:    (a) => weaponReturnWhy(a),
  berniel_return:  (a) => weaponReturnWhy(a),
  bili_return:     (a) => weaponReturnWhy(a),
  torque_return:   (a) => weaponReturnWhy(a),
  ecmo_return:     (a) => weaponReturnWhy(a),
  edc_return:      (a) => weaponReturnWhy(a),
  xiaoxiao_return: (a) => weaponReturnWhy(a),
  nora_indwell:   (a) => piercedTarget(a) ? null : "场上没有刺入的目标",
  // 声波震击：同区没有敌人时，刺入目标那一下照样打；两样都没有才不能用
  nora_sonic:     (a) => visibleEnemies(a.zone).length || piercedTargets(a).length ? null : "同区没有敌人，场上也没有刺入目标",
  vitas_infuse:   () => piercedTarget(noraOf()) ? null : "场上没有刺入的目标",
  vitas_rip:      () => piercedTarget(noraOf()) ? null : "场上没有刺入的目标",
  vitas_dance:    () => piercedTarget(noraOf()) ? "场上有刺入单位时无法使用" : null,
  // 针尖剑斩：有刺入对象时先移动到第一个刺入对象那一区再斩（不限距离，和以前一样），走不过去就不能用（#340 第 4 条，以前能穿墙）
  vitas_slash:    (a) => {
    const pin = piercedTarget(noraOf());
    const why = pin && Number(pin.zone) !== Number(a.zone) ? skillMoveWhy(a, Number(pin.zone), null) : null;
    return why ? `走不到刺入目标 ${pin.name} 所在的 ${pin.zone} 区（${why.replace(/。$/, "")}）` : null;
  },
  nora_soothe:    (a) => noraMood(a) === "gentle" ? "维塔斯已处于温和" : null,
  hiaki_allin:    (a) => (Number(a.resources && a.resources.smashUsed) || 0) >= allinMaxUses(a)
    ? "本场全力以赴已用完" : null,
  role_activate:  () => {
    const any = (typeof fieldUnits === "function" ? fieldUnits() : state.units)
      .some(u => u && !u.isPlayer && !u.dead && !u.hidden && activatableStatuses(u).length > 0);
    return any ? null : "场上没有带状态效果的敌人";
  },
  // 有次数的职责技能：用完了就拦下（ROLE_USE_CAP）。下面几个还要看场上有没有能用的对象
  role_refine:      (a) => roleCapWhy(a, "role_refine"),
  role_pierce:      (a) => roleCapWhy(a, "role_pierce"),
  role_gambit:      (a) => roleCapWhy(a, "role_gambit"),
  role_halve:       (a) => roleCapWhy(a, "role_halve"),
  role_omen:        (a) => roleCapWhy(a, "role_omen"),
  role_grit:        (a) => roleCapWhy(a, "role_grit"),
  role_stand:       (a) => roleCapWhy(a, "role_stand"),
  role_fear:        (a) => roleCapWhy(a, "role_fear"),
  role_all_reflect: (a) => roleCapWhy(a, "role_all_reflect"),
  role_buffer:      (a) => roleCapWhy(a, "role_buffer"),
  role_dome:        (a) => roleCapWhy(a, "role_dome"),
  role_renew:       (a) => roleCapWhy(a, "role_renew"),
  role_lock:        (a) => roleCapWhy(a, "role_lock"),
  role_harsh:       (a) => roleCapWhy(a, "role_harsh"),
  role_apocalypse:  (a) => roleCapWhy(a, "role_apocalypse"),
  role_shake:       (a) => roleCapWhy(a, "role_shake"),
  role_rearrange:   (a) => roleCapWhy(a, "role_rearrange"),
  role_rally:       (a) => roleCapWhy(a, "role_rally"),
  role_double_dot:  (a) => roleCapWhy(a, "role_double_dot")
    || (fieldUnits().some(u => !u.isPlayer && !u.fused && hasAnyStatus(u)) ? null : "场上没有带状态效果的敌人"),
  role_gold:        (a) => roleCapWhy(a, "role_gold")
    || (fieldUnits().some(u => !u.fused && goldKeys(u).length) ? null : "场上没有带即时效果的单位"),
  role_shelter:     (a) => roleCapWhy(a, "role_shelter")
    || (shelterAllies(a).length ? null : "没有可以保释的友方"),
  role_spread:      () => spreadSources().length ? null : "场上没有能传播的属性状态效果（或者没有能接收的另一个单位）",
  role_boost:       (a) => boostAllies(a).length ? null : "没有可以借力移动的其他友方",
  hiaki_summon:   (a) => {
    const usable = summonableBlades(a);
    // 已经选好了哪一把就直接校验那一把
    const picked = state.skillFlow && state.skillFlow.id === "hiaki_summon" &&
      state.skillFlow.picks && state.skillFlow.picks.blade;
    if (picked) {
      if (usable.includes(picked)) return null;
      const r = res(a);
      if (picked === "niu" ? r.niuOut : r.narutoOut) return "这把刀已经分出";
      return weaponSummonWhy(a, picked) || "这把刀现在无法分出";
    }
    if (usable.length) return null;
    const r = res(a);
    if (r.niuOut && r.narutoOut) return "两把刀都已分出";
    return "两把刀都无法分出（已在场或本场已倒下）";
  },
  bili_field:     () => {
    const c = findKit("chuan", state.units);
    return (!c || (c.resources.charge || 0) < 1) ? "川川电能不足" : null;
  },
  bili_storm:     () => {
    const c = findKit("chuan", state.units);
    return (!c || (c.resources.charge || 0) < 1) ? "雷电风暴需要至少 1 电能" : null;
  }
};
function res(u) { return (u && u.resources) || {}; }
/** actor 距离 range 以内、场地能改成 kind 的区域 */
function envZones(actor, kind, range) {
  const out = [];
  const maxZ = Number(state.zoneMode) || 2;
  for (let z = 1; z <= maxZ; z++) {
    if (actor && zoneDist(actor.zone, z, maxZ) > range) continue;
    if (!fieldChangeWhy(z, kind)) out.push(z);
  }
  return out;
}
/** 直流短接能选的区：能变成高压场地的原区，加上移动 1 距离走得到的区（危墙 / 关着的门 / 空隙那边、深渊不算；以前能穿墙过去铺） */
function koltShortZones(actor) {
  return envZones(actor, "electric", 1).filter(z => Number(z) === Number(actor.zone) || !skillMoveWhy(actor, z, 1));
}

/** 武器人现在能不能唤出：ok / out（已在场）/ dead（本场已倒下，不能再唤出）/
 *  broken（耐久为 0：spawnWeapon 不让唤出，绯秋分刀的可选列表也不列）。武器人每场开战都回满，不看上一场 */
function weaponSummonState(owner, kit) {
  const broken = typeof weaponBroken === "function" && weaponBroken(kit);
  const list = (state.units || []).filter(x => x.kit === kit && (!x.weaponOf || !owner || x.weaponOf === owner.kit));
  if (!list.length) {
    return broken ? "broken" : "ok";
  }
  const alive = list.find(x => !x.dead);
  if (!alive) return "dead";
  if (!alive.hidden && !alive.fused) return "out";
  const hp = (alive.layers || []).reduce((sum, l) => sum + Math.max(0, Number(l.current) || 0), 0);
  return hp <= 0 ? "dead" : broken ? "broken" : "ok";
}
function weaponSummonWhy(owner, kit) {
  if (typeof weaponBroken === "function" && weaponBroken(kit)) return `${weaponCardName(kit)} 耐久为 0，无法唤出`;
  if (typeof weaponHalved === "function" && weaponHalved(kit) && weaponSummonState(owner, kit) !== "out") return `${weaponCardName(kit)} 本场受损过，不能再唤出`;
  const st = weaponSummonState(owner, kit);
  const nm = typeof weaponCardName === "function" ? weaponCardName(kit) : kit;
  if (st === "out") return `${nm} 已经在场上`;
  if (st === "dead") return `${nm} 本场已倒下，无法再唤出`;
  return null;
}
/** 绯秋：还能分出哪几把刀 */
function summonableBlades(h) {
  const r = res(h);
  return ["niu", "naruto"].filter(k => {
    if (k === "niu" ? r.niuOut : r.narutoOut) return false;
    return weaponSummonState(h, k) === "ok";
  });
}

/** 不满足前提时返回原因字符串，满足返回 null */
function skillRequirementError(actor, id) {
  if (actor && /^veh_/.test(String(id)) && typeof vehicleSkillWhy === "function") return vehicleSkillWhy(actor, id);   // 载具招式（vehicle.js）
  if (actor && typeof featOfSkill === "function" && featOfSkill(id)) return featSkillWhy(actor, id);
  if (actor && typeof cyberwareOfSkill === "function" && cyberwareOfSkill(id)) return cyberwareSkillWhy(actor, id);   // 义体（cyberware.js）：没装 / 短休前用过了
  const fn = SKILL_REQUIREMENT[id];
  if (!actor || typeof fn !== "function") return null;
  try { return fn(actor) || null; } catch (e) { return null; }
}

/** 声波切割选中的两个目标：单位对象，或者危墙 / 配置物的 token */
function touSonicPicks(a, t) {
  const fl = state.skillFlow;
  const get = (id) => (!id ? null : isStructureToken(id) ? id : unitById(id));
  let t1 = fl && fl.picks ? get(fl.picks.target1) : null;
  let t2 = fl && fl.picks ? get(fl.picks.target2) : null;
  if (!fl || (!t1 && !t2)) {
    const tok = state.targetId;
    const x = isStructureToken(tok) ? tok : t;
    if (x) {
      const z = isStructureToken(x) ? (structureTargets(a, 0, 1).find(s => s.id === x) || {}).zone : x.zone;
      if (z != null && zoneDist(a.zone, z, state.zoneMode) === 0) t1 = x; else t2 = x;
    }
  }
  return { t1, t2 };
}

/** 职责技能的目标检查（skillTargetError 用）：分步里选的对象不合法返回原因。
 *  主目标还没选时返回 null，交给技能里的「先选……」（画面靠它判断还要选目标） */
function roleTargetError(a, id, t) {
  const fl = state.skillFlow;
  const p = (fl && fl.picks) || {};
  const tok = String(state.targetId || "");
  // 折戟 / 击破预告 / 加倍计量只作用于敌人单位：配置物、危墙不是目标（以前会被当成攻击打一下）
  if (/^role_(halve|omen|double_dot)$/.test(id) && (tok.indexOf("prop:") === 0 || tok.indexOf("gap:") === 0 || (t && (t.kind || t.isStructure)))) return "只能对敌人使用";
  if (id === "role_spread") {
    const src = p.target1 ? unitById(p.target1) : null;
    const dest = p.target ? unitById(p.target) : t;
    if (!src || offField(src) || !spreadKeys(src).length) return "先选一个身上有属性状态效果的单位当传播来源";
    if (!dest || offField(dest) || dest.id === src.id) return "先选另一个单位当承受者";
    if (!spreadPlan(src, dest).length) return `${dest.name} 已经有这些状态（或者免疫），传播过去没有变化`;
  }
  if (id === "role_shelter") {
    const ids = SHELTER_PICKS.map(k => p[k]).filter(Boolean);
    const list = ids.length ? ids : (t && t.id ? [t.id] : []);
    if (!list.length) return null;
    if (new Set(list).size !== list.length) return "同一名友方不用保释两次";
    const ok = shelterAllies(a).map(u => u.id);
    if (list.some(x => ok.indexOf(x) < 0)) return "保释只能选在场的其他友方（这一回合还没被保释的）";
    if (list.length > roleUsesLeft(a, id)) return `保释本场只剩 ${roleUsesLeft(a, id)} 次`;
  }
  if (id === "role_boost") {
    const tgt = p.target ? unitById(p.target) : t;
    if (!tgt) return null;
    if (boostAllies(a).indexOf(tgt) < 0) return "借力只能移动在场的其他友方（不能被移动的除外）";
    if (p.dest == null) return "先选借力把友方移到哪一区";
    const d = Number(p.dest);
    if (!(d >= 1 && d <= Number(state.zoneMode)) || d === Number(tgt.zone)) return "借力要把友方移到另一个区";
  }
  if (id === "role_gold") {
    const tgt = p.target ? unitById(p.target) : t;
    if (!tgt) return null;
    const keys = goldKeys(tgt);
    if (!keys.length) return `${tgt.name} 身上没有可以延长的即时效果`;
    if (p.status != null && keys.indexOf(p.status) < 0) return `${tgt.name} 身上没有这种即时效果`;
  }
  if (id === "role_double_dot" && t && t.id) {
    if (t.isPlayer) return "加倍计量只能对敌人使用";
    if (!hasAnyStatus(t)) return `${t.name} 身上没有状态效果，加倍计量没有可翻倍的`;
  }
  if (id === "role_buffer" && p.layer != null && !LAYER[p.layer]) return "没有这种血量种类";
  if (id === "role_sturdy" && p.mode != null && p.mode !== "one" && p.mode !== "all") return "不倒战意只能选一名友方或全部友方";
  return null;
}

/** 扣行动点之前先查目标：选不到合法目标的技能不白白花掉行动点。返回原因，null 表示可以 */
function skillTargetError(a, id, t) {
  if (typeof featOfSkill === "function" && featOfSkill(id)) {
    const fl = state.skillFlow;
    return featSkillTargetWhy(a, id, t, fl && fl.id === id ? fl.picks : {});
  }
  // 义体（cyberware.js）：先看义体种类自己的目标限制，再照下面通用的友军 / 近程打飞行检查
  if (typeof cyberwareOfSkill === "function" && cyberwareOfSkill(id)) {
    const fl = state.skillFlow;
    const why = cyberwareSkillTargetWhy(a, id, t, fl && fl.id === id ? fl.picks : {});
    if (why) return why;
  }
  if (id === "sand_pull") {
    const fl = state.skillFlow;
    const tgt = fl && fl.id === id && fl.picks && fl.picks.target ? unitById(fl.picks.target) : t;
    if (!tgt || sandPullTargets(a).indexOf(tgt) < 0) return "要选距离 1 以内陷在流沙里的友方";
  }
  if (id === "role_renew" && t && !t.isPlayer) return "续命只能对友方使用";
  // 战-L1：攻击友军 / 近战打飞行目标附赠不够，以前都是 dealTo 里才拒绝，行动点早扣了还记行动分；这里在扣点前拦下
  if (a.isPlayer && t && t.id && !t.isPlayer && !isStructureToken(t.id) && !(typeof featOfSkill === "function" && featOfSkill(id))) {
    let sk = null;
    try { sk = (skillList(a) || []).find(s => s.id === id); } catch (e) {}
    const hint = sk ? (sk.hint || "") + " " + (sk.name || "") : "";
    const side = (typeof SKILL_TARGET_SIDE !== "undefined" && SKILL_TARGET_SIDE[id]) ||
      (/任意单位|拉到|磁力/.test(hint) ? "any" : /友方|队友/.test(hint) ? "ally" : "enemy");
    if (side === "enemy" && sk && typeof playerAllied === "function" && playerAllied(t)) return `${t.name} 是友军，不会被我方攻击`;
    const rg = skillRangeFor(a, id) || (typeof parseSkillRange === "function" ? parseSkillRange(hint) : null);
    if (side === "enemy" && sk && rg && rg.max === 0 && !/所有|全部|范围|每名/.test(hint) &&
        t.flying && !a.flying && Number(t.zone) === Number(a.zone) && !(typeof featHas === "function" && featHas(a, "wanderer")) &&
        !["longge_aa", "longge_chill", "longge_heat", "longge_spit", "xiaoxiao_punch", "xiaoxiao_combo"].includes(id) &&
        (Number(a.bonus) || 0) < (skillCost(id).bonus || 0) + 1) return `${t.name} 在飞行，近程攻击需要额外 1 附赠行动`;
  }
  // 职责技能：分步里选的对象不合法就在扣点之前拦下
  if (/^role_(spread|shelter|boost|gold|double_dot|buffer|sturdy|halve|omen)$/.test(id)) {
    const why = roleTargetError(a, id, t);
    if (why) return why;
  }
  if (id === "kolt_cannon") {
    const acid = ((findKit("kolt", state.units) || a).resources || {}).bit === "acid";
    const fl = state.skillFlow;
    if (acid) {
      const tg = fl && fl.picks && fl.picks.target ? unitById(fl.picks.target) : t;
      if (!tg || tg.isPlayer) return "先选迫击炮的目标";
      { const d = zoneDist(a.zone, tg.zone, state.zoneMode); if (d < 1 || d > 2) return "迫击炮只能打距离 1-2 的敌人"; }
    } else {
      const z = fl && fl.picks && fl.picks.dest != null ? Number(fl.picks.dest) : (t ? Number(t.zone) : null);
      if (z == null) return "先选机枪扫射的区域";
      if (zoneDist(a.zone, z, state.zoneMode) > 1) return "机枪只能打距离 1 以内的区域";
      if (lineBlocked(a.zone, z)) return lineBlocked(a.zone, z);
    }
  }
  if (id === "ras_torrent" && t && !(t.statuses && t.statuses.high)) return "狂瀑要选已经处于高能状态的敌人";
  if (id === "solo_support") {
    const fl = state.skillFlow;
    const kit = fl && fl.picks ? fl.picks.partner : null;
    const tgt = fl && fl.picks && fl.picks.target ? unitById(fl.picks.target) : t;
    const info = soloSupportInfo();
    if (!kit || !info || info.partners.indexOf(kit) < 0) return "先选一名还没出过场的伙伴";
    if (!tgt || tgt.isPlayer || tgt.dead || tgt.hidden) return "先选一名敌人";
  }
  if (id === "tou_sonic") {
    if ((res(a).shield || 0) < 1) return "没有圣盾";
    const { t1, t2 } = touSonicPicks(a, t);
    if (!t1 && !t2) return "声波切割至少要选一个目标（同区或距离 1）";
    const zoneOf = (x) => isStructureToken(x) ? (structureTargets(a, 0, 1).find(s => s.id === x) || {}).zone : x.zone;
    if (t1 && (zoneOf(t1) == null || zoneDist(a.zone, zoneOf(t1), state.zoneMode) !== 0)) return "第一个目标要在同区";
    if (t2 && (zoneOf(t2) == null || zoneDist(a.zone, zoneOf(t2), state.zoneMode) !== 1)) return "第二个目标要在距离 1";
  }
  // 龙哥 / 小朋友的近程技能打飞行目标：要多付 1 附赠行动，付不起就先拦下（免得子弹白白消耗）
  if (["longge_aa", "longge_chill", "longge_heat", "longge_spit", "xiaoxiao_punch", "xiaoxiao_combo"].includes(id) && !isStructureToken(state.targetId)) {
    const fl = state.skillFlow;
    const tgt = (fl && fl.picks && fl.picks.target) ? unitById(fl.picks.target) : t;
    const gun = (id === "longge_aa" || id === "longge_chill" || id === "longge_heat") && longgeMode(a) === "gun";
    const needBonus = (skillCost(id).bonus || 0) + 1;
    if (tgt && tgt.flying && !a.flying && !gun && !(typeof featHas === "function" && featHas(a, "wanderer")) && Number(tgt.zone) === Number(a.zone) && (Number(a.bonus) || 0) < needBonus) return `${tgt.name} 在飞行，近程攻击需要额外 1 附赠行动`;
  }
  if ((id === "longge_aa" || id === "longge_chill" || id === "longge_heat") && !isStructureToken(state.targetId)) {
    const fl = state.skillFlow;
    const tgt = (fl && fl.picks && fl.picks.target) ? unitById(fl.picks.target) : t;
    if (!tgt) return null;
    const gun = longgeMode(a) === "gun";
    const d = zoneDist(a.zone, tgt.zone, state.zoneMode);
    if (id === "longge_heat") { if (d !== 0) return "热能轰击只能打同区的目标"; }
    else if (gun && id === "longge_aa" && longgeGunNear(a)) { if (d > 1) return "霰弹枪打不到这么远"; }
    else if (d !== (gun ? 1 : 0)) return gun ? "霰弹枪只能打距离 1 的目标" : "手杖只能打同区的目标";
  }
  if (id === "xiaoxiao_burst") {
    const fl = state.skillFlow;
    const tgt = (fl && fl.picks && fl.picks.target) ? unitById(fl.picks.target) : t;
    if (tgt && (!tgt.isPlayer || Number(tgt.zone) !== Number(a.zone))) return "爆发治疗只能给同区的友方";
  }
  if (id === "tou_aa" && !isStructureToken(state.targetId)) {
    const fl = state.skillFlow;
    const tgt = (fl && fl.picks && fl.picks.target) ? unitById(fl.picks.target) : t;
    if (!tgt) return null;   // 交给技能里的「先选攻击目标」（画面靠它判断还要选目标）
    const far = !!(fl && fl.picks && fl.picks.rangeMode === "far");
    if (far && (res(a).shield || 0) < 1) return "没有圣盾，只能打同区";
    if (zoneDist(a.zone, tgt.zone, state.zoneMode) > (far ? 1 : 0)) return "目标超出本次射程";
  }
  const flp = (state.skillFlow && state.skillFlow.picks) || {};
  // 「非法」改装选了「过载 + 消耗废料」：要废料达到上限、目标是我方单位（分步里才有这一项），不然在扣行动点之前拦下
  if (id === "kolt_mod" && flp.mode === "ap") {
    const k = findKit("kolt", state.units) || a;
    const tgt = flp.target ? unitById(flp.target) : t;
    if (!tgt || !tgt.isPlayer) return "只有目标是我方单位时才能消耗废料给行动点";
    if (!koltScrapFull(k)) return `废料还没达到上限（${koltScrapTotal(k)} / ${koltScrapCap(k)}），不能消耗废料给行动点`;
  }
  // 规则干涉：区要在 1 距离以内、场地改得了；要给附赠动作时，拿附赠的单位要在那一区（敌我都行）。不合法就在扣行动点之前拦下
  if (id === "helu_rule") {
    const z = flp.dest != null ? Number(flp.dest) : null;
    if (z == null || !envZones(a, "harmonic", HELU_RULE.range).includes(z)) return "要选距离 1 以内、场地能变成干涉场的区域";
    if (heluRuleBonusOk(a, z) && heluRuleUnits(z).length) {
      const tg = flp.target ? unitById(flp.target) : t;
      if (!tg || !heluRuleUnits(z).includes(tg)) return `要选 ${z} 区里获得附赠动作的单位`;
    }
  }
  // 频域造物：间隙、属性、降幅 / 增幅都要选好
  if (id === "helu_forge") {
    if (!boardGapKeys().includes(String(flp.gap))) return "要选创造驻波墙的间隙";
    if (!WAVE_WALL.elements.includes(flp.element)) return "要选驻波墙过滤的属性";
    if (flp.mode !== "dampen" && flp.mode !== "amplify") return "要选降幅还是增幅";
  }
  // 巨刃划空打配置物 / 危墙：要在 1 距离以内，不能打自己这边的铁壁 / 防护罩（以前能打自己的铁壁）
  if (id === "chuan_blade") {
    const ref = flp.target || state.targetId;
    const p = ref && !unitById(ref) ? propByRef(ref) : null;
    const tok = isStructureToken(ref) ? String(ref) : (p ? "prop:" + p.id : null);
    if (tok && !structureTargets(a, 0, 1).some(s => s.id === tok)) {
      return p && BARRIER_SIDE[p.kind] === "player" ? `不能打自己这边的${p.name}` : "这个目标不在 1 距离以内";
    }
  }
  // 补充能源选了压缩：没有纳米可以压缩就不白花附赠动作（纳米是 0 时分步里本来就不给这个选项）
  if (id === "ruby_refuel" && flp.mode === "compress" && !(Number(res(a).nano) > 0)) return "没有纳米能源可以压缩";
  // 回收护盾：目标身上要有能回收的护盾（电池的机械护盾、当作最内层的护盾不算），不白花附赠动作
  if (id === "chuan_reclaim" && t && t.id && t.isPlayer &&
      !(t.layers || []).some(l => l.type === "shield" && !l.batteryShield && !l.inner && (Number(l.current) || 0) > 0)) return `${t.name} 身上没有能回收的护盾`;
  // 诺拉普攻：没有刺入时只能打敌人（距离 1 的友方也在射程里，以前扣完行动点才说不行）
  if (id === "nora_aa" && t && t.id && t.isPlayer && !piercedTargets(a).length) return "没有刺入目标时，普通攻击只能打敌人";
  // 处决只能对晕眩中的敌人：扣行动点之前就拦下（以前先扣点再说不行，预览也会误判成有效）
  if (id === "xia_execute" && t && t.id && !isStructureToken(state.targetId) && !t.stunned) return "处决只能对晕眩中的敌人使用";
  // 技能里的移动要走得到：危墙 / 关着的机关门 / 空隙挡路，地面单位不能主动走进深渊（以前直接改所在区，能穿墙）
  const moveTo = (dest, maxSteps, leap) => (dest == null || Number(dest) === Number(a.zone) ? null : skillMoveWhy(a, Number(dest), maxSteps, leap));
  let moveWhy = null;
  if (id === "hiaki_aa" && t && t.id && !isStructureToken(state.targetId) && (res(a).stance || "draw") === "iai") moveWhy = moveTo(t.zone, 1);
  if (id === "tou_start" && flp.dest != null) moveWhy = moveTo(flp.dest, 1);
  if (id === "tou_bash" && flp.dest != null) moveWhy = moveTo(flp.dest, 1);
  if (id === "xia_selfburn" && flp.dest) moveWhy = moveTo(flp.dest, 1);
  if (id === "naruto_fly" && flp.dest != null) moveWhy = moveTo(flp.dest, 1);
  if (id === "latte_love" && t && t.id) moveWhy = moveTo(t.zone, null);
  if (id === "torque_boost" && flp.dest != null && ((findKit("kolt", state.units) || {}).resources || {}).bit !== "acid") moveWhy = moveTo(flp.dest, 1);
  if (id === "ras_flee" && flp.dest != null) {
    if (Number(flp.dest) === Number(a.zone)) return "逃离要离开所在的区域";
    moveWhy = moveTo(flp.dest, res(findKit("ras", state.units) || a).unstable ? null : 1);   // 不稳态不限距离
  }
  // #340 第 4 条：直流短接先移动至多 1 距离；猛扑跃向距离 1 的目标，或带着同区的目标跃到选的区（跃：空隙能越过）
  if (id === "kolt_short" && flp.dest != null) moveWhy = moveTo(flp.dest, 1);
  if (id === "mochi_pounce") {
    const tg = flp.target ? (unitById(flp.target) || propByRef(flp.target)) : t;
    const d = tg && tg.zone != null ? zoneDist(a.zone, tg.zone, state.zoneMode) : null;
    if (d === 0) moveWhy = moveTo(flp.dest, null, true);
    else if (d === 1) moveWhy = moveTo(tg.zone, 1, true);
  }
  if (moveWhy) return moveWhy;
  // 冰美式：治疗「距离 1 以内的同伴」，清场「距离 1 的一个区域」（以前不限距离）
  if (id === "yuito_amer" && flp.target) {
    const tg = unitById(flp.target);
    const d = tg ? zoneDist(a.zone, tg.zone, state.zoneMode) : null;
    if (tg && flp.mode === "heal" && d > 1) return "冰美式只能治疗距离 1 以内的同伴";
    if (tg && flp.mode === "atk" && d !== 1) return "冰美式清场只能打距离 1 的那一区";
  }
  return null;
}

/** 执行技能，并把这次行动的日志整理成一块（见 withLogSink） */
function runSkill(id, optRun) {
  const a0 = unitById(state.attackerId);
  const title = a0 ? `【${a0.name}】${skillDisplayName(a0, id)}` : "";
  const prevActor = LOG_ACTOR_ID;
  LOG_ACTOR_ID = a0 ? a0.id : null;
  let lines;
  try {
    lines = withLogSink(sink => { try {
      if (!state._highDefer) state._endedAcc = null;
      state.aoePulse = {};            // 只算这一次行动的范围攻击
      state.actionKills = [];         // 这一次行动里打死的敌人（动作结束前还能吃到后面的攻击、算溢出）
      state.flyPaid = {};             // 这一次行动里已经为「近程打飞行」付过附赠行动的（攻击者 > 目标）
      const scoreBefore = state.battleScore ? state.battleScore.total : 0;
      // 启动引擎+：引擎已启动时使用带有启动引擎效果的技能，结算后获得 1 燃油
      const fuelGain = FUEL_SKILLS.includes(id) && xiaFuelOn() && ((findKit("xia", state.units) || {}).resources || {}).engine;
      const seqBefore = Number(state.actionSeq) || 0;
      const apBefore = a0 ? Number(a0.ap) || 0 : 0;
      // 用队友给的行动点出手：这次行动的分数分一部分给给行动点的人（addScore 按 state._apShare 分）
      const apShare = a0 && a0.isPlayer && !state._apShare ? apShareFor(a0, (skillCost(id) || {}).ap) : null;
      if (apShare) state._apShare = apShare;
      // 高能自爆等这次行动完整打完再判（嵌套的行动由最外层统一判）
      state._highDefer = (Number(state._highDefer) || 0) + 1;
      // 驻波墙：这次行动开始时记下各单位在哪一区，技能里直接换区的移动出手前 / 行动结束时补算穿墙（最外层这一次记）
      const waveOwn = waveLedgerOpen();
      try { trackHealBy(a0, () => runSkillInner(id, optRun)); }
      finally {
        state._highDefer = Math.max(0, (Number(state._highDefer) || 0) - 1);
        if (apShare) { state._apShare = null; if ((Number(a0.ap) || 0) < apBefore) consumeApGifts(a0, apShare.used); }
        waveLedgerClose(waveOwn);
      }
      // 跃迁（feats.js）：这次花了行动点、真的打出了攻击
      if (a0 && typeof featAfterAction === "function") featAfterAction(a0, (Number(a0.ap) || 0) < apBefore);
      if (!state._highDefer) {
        // 技能收尾（paintSkillLog）已经清掉了行动记账：高能自爆的溢出分 / 余波分仍记给引发它的这一方
        if (!state.actionAcc && state._endedAcc) state.actionAcc = state._endedAcc;
        state._endedAcc = null;
        flushHighBooms();
      }
      if (fuelGain && (Number(state.actionSeq) || 0) !== seqBefore) addFuel(1, "引擎运转");   // 真的出手了（开始了新的行动）才算
      const bossNotes = []; settleBossStuns(bossNotes); if (bossNotes.length) appendLog(bossNotes.join("\n"));
      applyFatigue(a0, id, scoreBefore);   // 招式疲劳：连续几个回合用同一招，这次行动的总得分打折
      flushAoePulse();                // 波及到的按钮 / 拉杆各触发一次（提前 return 的分支也算）
      state.actionAcc = null;         // 行动结束：之后的持续伤害不再算到这个人头上
    } finally { dropPendingFor(sink); } });
  } finally { LOG_ACTOR_ID = prevActor; }
  const block = tidyActionBlock(title, lines);
  if (block.length) appendLog(block.join("\n"));
  // 下水道狂鼠（enemies.js · ratfolkSweep）：最外层的一次行动整个打完，再看潜藏者逃跑、疫病暴徒狂暴、暴虐猎手斩杀（各写一块日志）
  if (typeof ratfolkSweep === "function" && !state._highDefer && !logSinkActive()) ratfolkSweep();
}

function runSkillInner(id, optRun) {
  optRun = optRun || {};
  state._pointBlankShot = null;   // 抵近射击：这次行动是不是靠它才打得到同区（下面射程检查里设）
  const a = unitById(state.attackerId);
  const token = selectedToken();
  state._structProxy = null;
  let t = skillTargetAny();
  if (!a) { paintSkillLog("先选攻击者。"); return; }
  if (a.dead) { paintSkillLog(`${a.name} 已死亡，无法行动。`); return; }
  if (!optRun.ignorePhase && !canControlUnit(a) && id !== "assist_block") {
    paintSkillLog(!state.combatStarted
      ? "战斗尚未开始。先点「开始战斗」。"
      : (state.combatPhase === "enemy" ? "现在是敌人回合，不能操作玩家技能。" : "现在是玩家回合，不能操作敌人技能。"));
    return;
  }
  // 通用前置检查（配置物、角色 / 职责技能各分支之前）：
  // 濒死没起身的人只能起身（或「起身并协助格挡」），不能扳拉杆、操控机炮、改写炮台……（以前这几条排在濒死检查前面，只靠界面拦）
  if (a.dying && id !== "assist_block") { paintSkillLog(`${a.name} 濒死中。先点「起身」。`); return; }
  // 武器人主动收回为武器要和持有者同区；技能自带的强制收回不走这里
  if (/_return$/.test(String(id)) && isWeaponUnit(a)) {
    const why = weaponReturnWhy(a);
    if (why) { paintSkillLog(`${a.name} 现在不能收回：${why}。`); return; }
  }
  if (String(id).indexOf("hack_turret:") === 0) {
    const pid = id.slice("hack_turret:".length);
    const p = (state.props || []).find(x => x.id === pid);
    const why = turretHackError(a, p);
    if (why) { paintSkillLog(why); return; }
    if (a.isPlayer && !spendAp(a, 1, "改写炮台")) return;
    paintSkillLog(hackTurret(a, p).join("\n"));
    renderAll();
    return;
  }
  if (String(id).indexOf("use_scrap:") === 0) {
    const pid = id.slice("use_scrap:".length);
    const p = (state.props || []).find(x => x.id === pid);
    const tu = unitById(state.targetId);
    paintSkillLog(controlScrap(a, p, tu));
    renderAll();
    return;
  }
  if (String(id).indexOf("use_device:") === 0) {
    const pid = id.slice("use_device:".length);
    const p = (state.props || []).find(x => x.id === pid);
    if (!p) { paintSkillLog("没有这个装置。"); return; }
    if (Number(p.zone) !== Number(a.zone)) { paintSkillLog("必须与按钮/拉杆同区。"); return; }
    if (a.isPlayer && !spendAp(a, 1, p.kind === "lever" ? "扳动" : "按下")) return;
    useDevice(p);
    paintSkillLog(`${a.name} ${p.kind === "lever" ? "扳动" : "按下"}了 ${p.name}。`);
    return;
  }
  if (a.isPlayer && isUnarmed(a) && id !== "assist_block" && id !== "bare_aa") {
    const allowed = (skillList(a) || []).some(s => s.id === id);
    if (!allowed) {
      paintSkillLog(`${a.name} 空手中，只能空手攻击、职责技能，或卡片标明可空手使用的技能。`);
      return;
    }
  }
  // 反应（协助攻击、格挡、借机攻击）不花行动点。没有专属协助技能的敌人拿普通攻击当协助攻击（enemyAssistSkillId），
  // 技能名里没有 assist，所以也看「这个单位此刻是不是在打协助攻击」（finishAssist 里设的 state._assistBy）
  const reaction = /_opp$|_block$|assist/.test(id) || id === "ufo_assist" || id === "en_ox_block" || id === "en_wolf_opp" || id === "en_thug_opp" ||
    (!!state._assistBy && a && state._assistBy === a.id);
  // 敌人技能默认花 1 行动点；赤牙的霰弹枪 / 掩体 2 行动点、追猎 1 附赠（enemies.js · enemySkillCost）
  const enemyCost = !a.isPlayer && !reaction ? (typeof enemySkillCost === "function" ? enemySkillCost(a, id) : { ap: 1, bonus: 0 }) : null;
  if (enemyCost) {
    if (sinkLocked(a) || (a.ap || 0) < enemyCost.ap || (a.bonus || 0) < enemyCost.bonus) {
      paintSkillLog(`${a.name} ${(a.ap || 0) < enemyCost.ap ? "行动点" : "附赠行动"}不足，无法使用该技能。`);
      return;
    }
  }
  // 载具招式（vehicle.js）：敌人在扣点之前验一遍（我方的在下面 skillRequirementError 验）
  if (!a.isPlayer && /^veh_/.test(String(id)) && typeof vehicleSkillWhy === "function") {
    const why = vehicleSkillWhy(a, id, t);
    if (why) { paintSkillLog(why); return; }
  }
  const duelTou = typeof touDuelVictim === "function" ? touDuelVictim(a) : null;
  if (duelTou && id !== "assist_block") {
    const isAssist = /assist/.test(id) || id === "ufo_assist";
    const isMoveLike = id === "__move" || /move|shift|dash|进出|移动/.test(id);
    const tgt = t && t.id ? t : unitById(state.targetId);
    if (isMoveLike || String(id).indexOf("use_device:") === 0) {
      paintSkillLog(`${a.name} 处于决一死战：只能攻击灯，不能做其他行动。`);
      return;
    }
    if (tgt && tgt.id !== duelTou.id) {
      paintSkillLog(`${a.name} 处于决一死战：必须攻击灯，不能把行动用在 ${tgt.name} 上。`);
      return;
    }
    if (!tgt && !isAssist) {
      /* 群体技能没有单一目标时也不让用，避免打到别人 */
      if (/aoe|all|zone|area|扫/.test(id)) {
        paintSkillLog(`${a.name} 处于决一死战：只能攻击灯。`);
        return;
      }
    }
  }
  if (a.isPlayer && id !== "assist_block") {
    const why = skillRequirementError(a, id);
    if (why) { paintSkillLog(`${a.name} 现在不能使用该技能：${why}。`); return; }
    const bad = skillTargetError(a, id, t);
    if (bad) { paintSkillLog(`${a.name} 现在不能这样用：${bad}。`); return; }
  }
  if (a.isPlayer && id !== "assist_block") {
    const cost = skillCost(id);
    if ((cost.ap || 0) > (a.ap || 0)) {
      paintSkillLog(`${a.name} 行动点不足（${a.ap || 0}），无法使用该技能。`);
      return;
    }
    if ((cost.bonus || 0) > (a.bonus || 0)) {
      paintSkillLog(`${a.name} 附赠行动不足（${a.bonus || 0}），无法使用该技能。`);
      return;
    }
  }
  if (t && t.id && typeof inSkillRange === "function") {
    const ov = skillRangeFor(a, id);
    let inRange;
    let hint = "";
    if (ov) {
      const dd = zoneDist(a.zone, t.zone, state.zoneMode);
      inRange = dd >= ov.min && dd <= ov.max;
      hint = "x";
    } else {
      try {
        const sk = (skillList(a) || []).find(s => s.id === id);
        if (sk) hint = (sk.hint || "") + " " + (sk.name || "");
      } catch (e) {}
      inRange = !hint || inSkillRange(a, t, hint, state.zoneMode);
    }
    // 抵近射击（feats.js）：只能打远处（距离 1 起）的攻击也能打同区，这样打出的攻击倍率 ×60%（dealTo · flags.pointBlank）
    if (!inRange && t.zone != null && zoneDist(a.zone, t.zone, state.zoneMode) === 0 && typeof featHas === "function" && featHas(a, "pointblank")) {
      const r = ov || (typeof parseSkillRange === "function" ? parseSkillRange(hint) : null);
      if (r && r.min >= 1) { inRange = true; state._pointBlankShot = a.id; }
    }
    if (hint && !inRange) {
      const d = zoneDist(a.zone, t.zone, state.zoneMode);
      const shieldRange = id === "tou_aa" && d <= 1 && (
        (a.resources && a.resources.spendRange) ||
        (state.skillFlow && state.skillFlow.picks && state.skillFlow.picks.rangeMode === "far")
      );
      if (!shieldRange) {
        paintSkillLog(`${a.name} 的该技能不能打距离 ${d} 的目标（同区是距离 0，相邻才是距离 1）。`);
        return;
      }
    }
  }
  const isGapTok = token && String(token).indexOf("gap:") === 0;
  // 巨刃划空打配置物 / 危墙在自己的分支里结算（耗电能、对配置物伤害翻倍、摧毁才返还），不走这里的通用打法
  if (id !== "tou_sonic" && id !== "chuan_blade" && (isGapTok || (token && String(token).indexOf("prop:") === 0 && !isDisplaceSkill(id)))) {
    // 灯的普通攻击：耗圣盾时射程变成距离 1
    const touFar = id === "tou_aa" && state.skillFlow && state.skillFlow.picks && state.skillFlow.picks.rangeMode === "far";
    const touReach = (z) => zoneDist(a.zone, z, state.zoneMode) <= (touFar ? 1 : 0);
    const tokZones = isGapTok ? String(token).slice(4).split("-").map(Number)
      : [Number((propByRef(token) || {}).zone)];
    if (id === "tou_aa") {
      if (touFar && (res(a).shield || 0) < 1) { paintSkillLog(`${a.name} 没有圣盾，只能打同区。`); return; }
      if (!tokZones.some(touReach)) { paintSkillLog(`${a.name} 的普通攻击够不到这个目标。`); return; }
    }
    // 龙哥普攻：手杖只打同区，霰弹枪只打距离 1
    const lgGun = id === "longge_aa" && longgeMode(a) === "gun";
    if (id === "longge_aa" && !tokZones.some(z => { const d = zoneDist(a.zone, z, state.zoneMode); return lgGun ? (d === 1 || (d === 0 && longgeGunNear(a))) : d === 0; })) {
      paintSkillLog(lgGun ? "霰弹枪只能打距离 1 的目标。" : "手杖只能打同区的目标。");
      return;
    }
    // 危墙 / 桥梁夹在两区之间：两边任一区在射程里就能打
    if (isGapTok && id !== "tou_aa" && id !== "longge_aa") {
      const zs = String(token).slice(4).split("-").map(Number);
      const ov = typeof skillRangeFor === "function" ? skillRangeFor(a, id) : null;
      let hint = "";
      try { const sk = (skillList(a) || []).find(x => x.id === id); if (sk) hint = (sk.hint || "") + " " + (sk.name || ""); } catch (e) {}
      const reach = (z) => {
        if (ov) { const d = zoneDist(a.zone, z, state.zoneMode); return d >= ov.min && d <= ov.max; }
        return !hint || typeof inSkillRange !== "function" || inSkillRange(a, { id: token, zone: z, isPlayer: false }, hint, state.zoneMode);
      };
      const ok = zs.some(reach);
      if (!ok) { paintSkillLog(`${a.name} 的该技能够不到 ${String(token).slice(4)} 区之间的${gapLabel((state.gaps[String(token).slice(4)] || {}).type)}。`); return; }
    }
    // 隔着危墙 / 关着的门：倒塌 / 打开之前影响不到对面的配置物（不花行动点）
    if (!structureReachable(a, token)) {
      paintSkillLog(`${a.name} 打不到：${lineBlocked(a.zone, tokZones[0]) || "隔着危墙 / 关着的门。"}`);
      return;
    }
    if (id === "hiaki_aa" && !(heldHiakiBlade(a) || (a.resources || {}).blade)) { paintSkillLog("两把刀都已分出，空手不能用刀技。"); return; }
    // #52：玩家的技能打配置物 / 危墙算命中——换上一个替身目标，照常走技能自己的分支（属性、倍率、击破、命中后效果、技能消耗都照技能算）；
    // dealTo 认出替身，把这一击交给 hitStructureCore（dealToStructure）。灯 / 龙哥的普攻在上面另算，敌人还是走通用打法
    const unified = a.isPlayer && id !== "assist_block" && id !== "tou_aa" && id !== "longge_aa";
    if (unified) {
      t = makeStructProxy(token, tokZones, a);
      state._structProxy = t;
    } else {
    // 打配置物 / 危墙也是一次行动，照常消耗行动点 / 附赠行动
    if (a.isPlayer && id !== "assist_block") {
      const cost = skillCost(id);
      if (cost.ap && !spendAp(a, cost.ap, skillNameHint(id))) return;
      if (cost.bonus && !spendBonus(a, cost.bonus, skillNameHint(id))) return;
    } else if (!a.isPlayer) {
      if (!spendAp(a, 1, skillNameHint(id))) return;
    }
    if (touFar) { a.resources.shield -= 1; touShieldHeal(a); appendLog(`消耗 1 圣盾，射程变为距离 1。`); }
    if (id === "longge_aa") {
      // 手杖：1atk 冰 +1 击破，窥探 1；霰弹枪：耗 1 发，1.5atk 子弹属性 +1 击破
      snapshot();
      const lines = [];
      const atkV = effectiveAtk(a, state.units) || 5;
      let opt;
      if (lgGun) {
        const c = longgeTakeBullet(a, lines);
        opt = { element: LONGGE_AMMO[c].element, dmg: Math.max(1, Math.floor(atkV * 1.5)), brk: 1 };
      } else {
        opt = { element: "ice", dmg: Math.max(1, Math.floor(atkV)), brk: 1 };
        longgePeek(a, 1, lines);
      }
      lines.push(...hitStructureCore(a, token, opt));
      appendLog(lines.join("\n"));
      renderAll();
      return;
    }
    hitStructure(a, token, structureHitOpt(a, id));
    return;
    }
  }
  // 付不起消耗（流沙没顶 / 点数不够）：这次行动不结算，要在 snapshot / beginActionAcc 之前挡住，免得留下半截状态
  {
    const payCost = a.isPlayer && id !== "assist_block" ? skillCost(id) : enemyCost;
    const why = costBlockReason(a, payCost);
    if (why) {
      paintSkillLog(why === "陷在流沙里没顶，不能行动"
        ? `${a.name} 陷在流沙里没顶，无法${skillNameHint(id)}。`
        : `${a.name} ${why}，无法使用该技能。`);
      return;
    }
  }
  snapshot();
  beginActionAcc(a, id);
  if ((a.kit === "xia" || a.kit === "berniel" || a.weaponOf === "xia") && !/engine$|prep$|summon$|return$|cover$/.test(id)) {
    markXiaAttack(a);
  }
  if (a.isPlayer && id !== "assist_block") {
    const cost = skillCost(id);
    if (cost.ap) spendAp(a, cost.ap, skillNameHint(id));
    if (cost.bonus) spendBonus(a, cost.bonus, skillNameHint(id));
    if (typeof featCostSpent === "function") featCostSpent(a, id);   // 人器一心（feats.js）：这一场的半价唤出用掉了
  } else if (enemyCost) {
    if (enemyCost.ap) spendAp(a, enemyCost.ap, skillNameHint(id));
    if (enemyCost.bonus) spendBonus(a, enemyCost.bonus, skillNameHint(id));
  }
  const lines = [];
  const sinkNow = LOG_SINKS[LOG_SINKS.length - 1];
  if (sinkNow) LOG_PENDING.push({ lines, sink: sinkNow });   // runSkill 结束时撤掉（见 dropPendingFor）
  const needT = () => {
    if (!t) { lines.push("先在「技能目标」里选对象。"); return false; }
    return true;
  };
  const atk = effectiveAtk(a, state.units);

  const overloadSeq = [];
  const hitOne = (actor, target, opt) => {
    // 命中过程中立刻写出的日志（击杀、经验、掉落……）先收起来，排在这一击的结果后面
    let out;
    // 驻波墙：技能里直接换过区（突进、逃离……）还没补算的穿墙，先结算、先写（不然写在这一击的结果后面）
    if (state._waveLedger) waveLedgerSync(lines);
    // 攻击者不是这次行动的发起人（比如召唤物、残骸）时写明是谁打的；这一击之前攒下的话先写出去
    if (actor && actor.id !== a.id) lines.push(`  ${actor.name} 出手：`);
    appendLog(lines.splice(0).join("\n"));
    const defBefore = target && target.def != null ? Number(target.def) || 0 : null;
    const captured = withLogSink(() => { out = dealTo(actor, target, opt); });
    if (out && defBefore != null) out.defBefore = defBefore;
    // 过载 / 导体：一个技能里分几下（各 1 次）打同一个目标，也算复数次攻击 → 结尾重复最后一段
    if (actor && ((actor.instant && actor.instant.overload) || actor.self === "conductor") && target && !target.kind) {
      const n = opt.hits || 1;
      if (n <= 1 && (!opt.flags || opt.flags.action !== false)) {
        overloadSeq.push({ actor, target, opt: Object.assign({}, opt, { usePrep: false, hits: 1 }) });
      }
    }
    formatHitLines(actor, target, out, captured).forEach(s => appendLog(s));
    return out;
  };
  /* 「先施加震荡，再结算这一击」（盾击突进 / 全速撞击，按技能说明的顺序）：
   * 震荡先压架势上限（超出的架势压下来），这一击的击破再照常扣（熔融沙尘 +1 等不会被上限抹掉）。
   * 这一击没打中（闪避、格挡、射程……）：震荡不生效，上限和架势原样还回去；等协助格挡结果的那一击不动。 */
  const waveThenHit = (tgt, opt) => {
    tgt.statuses = tgt.statuses || {};
    const had = !!tgt.statuses.shockwave;
    // 屏障护着的目标：这一击整个被屏障吃掉，不会碰到屏障后面的人，震荡也不挂（先挂再还原会让屏障挡下的一击留着震荡）
    if (!had && barrierFor(tgt, a)) {
      lines.push(`${tgt.name} 被屏障护着，震荡不生效。`);
      return hitOne(a, tgt, opt);
    }
    const snap = { def: tgt.def, defMax: tgt.defMax, cut: tgt._waveCut };
    if (!had) {
      tgt.statuses.shockwave = true;
      lines.push(`${tgt.name} 震荡。`);
      popStatus(tgt, "shockwave");   // → syncShockwave：写出上限和架势的变化
    }
    const out = hitOne(a, tgt, opt);
    if (!had && !tgt.dead && out && !out.pending && !(out.res && out.res.pending) && !attackConnected(out.res, out.res && out.res.flags)) {
      tgt.statuses.shockwave = false;
      tgt.def = snap.def; tgt.defMax = snap.defMax; tgt._waveCut = snap.cut;
      lines.push(`没有打中：${tgt.name} 的震荡不生效，架势上限和架势还原。`);
    }
    return out;
  };

  // 职责涉猎专长（feats.js）：记次数，然后照原技能结算（没兼修的打上削弱标记，见 roleSkillLv）
  const dabbleBase = a.isPlayer && typeof featBeginDelegate === "function" ? featBeginDelegate(a, id) : null;
  if (dabbleBase) id = dabbleBase;
  try {
    if (/^veh_/.test(String(id)) && typeof runVehicleSkill === "function") {
      // 载具招式（vehicle.js）：上下车、拉人、开炮、焚烧、张开掩体、冲撞；行动点上面已经扣过
      runVehicleSkill(id, a, t, hitOne, lines, needT);
    } else if (typeof featOfSkill === "function" && featOfSkill(id)) {
      // 专长动作（feats.js）：行动点上面已经扣过
      const fl = state.skillFlow;
      runFeatSkill(a, id, { t, picks: (fl && fl.picks) || {}, lines, hitOne });
    } else if (typeof cyberwareOfSkill === "function" && cyberwareOfSkill(id)) {
      // 义体（cyberware.js）：行动点上面已经扣过；次数、坚毅消耗由义体那边记（和专长分开）
      const fl = state.skillFlow;
      runCyberwareSkill(a, id, { t, picks: (fl && fl.picks) || {}, lines, hitOne });
    } else if (id === "sand_pull") {
      const fl = state.skillFlow;
      const tgt = fl && fl.picks && fl.picks.target ? unitById(fl.picks.target) : t;
      runSandPull(a, tgt, lines);
    } else if (id === "weapon_retrieve") {
      const here = fallenWeapons(a).filter(w => Number(w.zone) === Number(a.zone));
      const pick = state.skillFlow && state.skillFlow.picks && state.skillFlow.picks.weapon;
      const w = here.find(x => x.id === pick) || here[0];
      if (!w) { lines.push("同区没有倒下的武器人。"); return paintSkillLog(lines.join("\n")); }
      retrieveWeapon(a, w, lines);
    } else if (id === "solo_support") {
      const fl = state.skillFlow;
      const tgt = fl && fl.picks && fl.picks.target ? unitById(fl.picks.target) : t;
      runSoloSupport(a, fl.picks.partner, tgt, lines);
    } else if (id === "ruby_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "energy", mult: 0.5, hits: 1, baseBreak: 1, atk });
      hitOne(a, t, { element: "energy", mult: 0.5, hits: 1, baseBreak: 0, atk, usePrep: false });
    } else if (id === "ruby_trigger") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      t.statuses.high = true;
      popStatus(t, "high");
      tagHighFrom(t, "ruby");
      t.statuses.latestElement = "energy";
      // 从施加的那一刻起就累积（#348：以前的说明写成下回合才开始累积，是旧 bug 留下的）
      lines.push(`${t.name} 被施加高能。从现在起受到的每段能量伤害各掷一次 ${statusDotDice("high", t.level || 1, currentWeatherFor(t)).label} 累积高能值。`);
    } else if (id === "ruby_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "energy", mult: 1, hits: 1, diceN: 1, diceS: 4, baseBreak: 0, atk, flags: { action: true, assist: true } });
      hitOne(a, t, { element: "energy", mult: 0.25, hits: 2, baseBreak: 0, atk, flags: { action: true, assist: true }, usePrep: false });
      addNano(20);
      lines.push("纳米 +20 → " + findKit("ruby", state.units).resources.nano);
    } else if (id === "wing_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const wingMain = hitOne(a, t, { element: "energy", mult: 1, diceN: 1, diceS: 4, baseBreak: 1, atk });
      if (wingMain && wingMain.res && wingMain.res.blocked) lines.push("主攻击被格挡，不产生溅射。");
      else visibleEnemies(t.zone).filter(u => u.id !== t.id).forEach(u => {
        hitOne(a, u, { element: "energy", mult: a.resources && a.resources.overdrive ? 0.4 : 0.3, baseBreak: 0, atk, flags: { action: true, aoe: true }, usePrep: false });   // 机体强化：溅射 +0.1
      });
    } else if (id === "wing_steal") {
      const foes = visibleEnemies(a.zone);
      if (!foes.length) lines.push("同区没有敌人。");
      foes.forEach(u => {
        hitOne(a, u, { element: "electric", mult: 0.5, baseBreak: 0, atk, flags: { action: true, aoe: true } });
        addNano(10);
      });
      lines.push("纳米 → " + (findKit("ruby", state.units).resources.nano));
    } else if (id === "wing_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const wingAsMain = hitOne(a, t, { element: "energy", mult: 1.5, baseBreak: 0, atk, flags: { action: true, assist: true } });
      if (wingAsMain && wingAsMain.res && wingAsMain.res.blocked) lines.push("主攻击被格挡，不产生溅射。");
      else visibleEnemies(t.zone).filter(u => u.id !== t.id).forEach(u => {
        hitOne(a, u, { element: "energy", mult: 0.5, baseBreak: 0, atk, flags: { action: true, assist: true, aoe: true }, usePrep: false });
      });
      addNano(20);
      lines.push("纳米 +20 → " + findKit("ruby", state.units).resources.nano);
    } else if (id === "ruby_unmecha") {
      lines.push(...exitMecha(a, "主动解除机甲"));
    } else if (id === "ruby_summon") {
      const w = spawnWeapon(a, "mint");
      lines.push(w ? "明特已进入战场。" : "明特已在场或无法唤出。");
    } else if (id === "mint_mecha") {
      lines.push(...enterMecha());
    } else if (id === "mint_steal") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "electric", mult: 1, baseBreak: 0, atk });
      addNano(20);
      lines.push("纳米 +20 → " + (findKit("ruby", state.units).resources.nano));
    } else if (id === "mint_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "yuito_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "ice", mult: 1, baseBreak: 1, atk });
      lines.push(beanToLiquid() ? "咖啡豆 → 咖啡液。" : "没有咖啡豆可转化。");
    } else if (id === "yuito_amer") {
      const y = a;
      if ((y.resources.liquid || 0) < 1) { lines.push("没有咖啡液。"); }
      else {
        const fl = state.skillFlow;
        const mode = fl && fl.picks.mode;
        const tgt = (fl && fl.picks.target) ? unitById(fl.picks.target) : t;
        if (!mode || !tgt) { lines.push("先完成冰美式的分步选择。"); return paintSkillLog(lines.join("\n")); }
        y.resources.liquid -= 1;
        if (mode === "heal") {
          // 每五级骰面升一档：2d4 → 2d6 → 2d8 …（骰子个数不变）
          const sides = leveledSides(y.level, 4);
          const r = bondHealDice(y, tgt, 2, sides, 0);
          healUnit(tgt, r.total);
          tgt.def = Math.min(tgt.defMax || tgt.def, (Number(tgt.def) || 0) + 1);
          lines.push(`冰美式治疗 ${tgt.name} ${r.text}${r.maxed ? "（牵挂取最大值）" : ""}，架势 +1。`);
        } else {
          visibleEnemies(tgt.zone).forEach(u => {
            hitOne(a, u, { element: "ice", mult: 0.75, baseBreak: 1, atk, flags: { action: true, aoe: true } });
          });
          lines.push(`冰美式清场：${tgt.zone} 区敌人各受 0.75atk 冰伤与 1 冰属性击破。`);
        }
      }
    } else if (id === "yuito_inspire") {
      const fl = state.skillFlow;
      const tgt = (fl && fl.picks && fl.picks.target) ? unitById(fl.picks.target) : t;
      if (!tgt) { lines.push("先选助威目标。"); return paintSkillLog(lines.join("\n")); }
      tgt.statuses = tgt.statuses || {};
      tgt.statuses.inspire = true;
      const stay = (a.level || 1) >= 10 && fl && fl.picks && fl.picks.mode === "stay";
      tgt.statuses.inspireStay = !!stay;
      popStatus(tgt, "inspire");
      lines.push(stay
        ? `${tgt.name} 获得持续振奋（助威·行动点）。`
        : `${tgt.name} 本回合振奋（助威${(a.level || 1) >= 10 ? "·附赠" : ""}）。`);
    } else if (id === "yuito_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "ice", mult: 1, baseBreak: 0, atk, flags: { action: true, assist: true } });
      // #52：拿到这颗豆之前，先把手上的咖啡豆全部转成咖啡液
      let brewed = 0;
      while (beanToLiquid()) brewed++;
      if (brewed) lines.push(`咖啡豆全部转成咖啡液：+${brewed} → 咖啡液 ${a.resources.liquid}`);
      a.resources.bean = (a.resources.bean || 0) + 1;
      lines.push("咖啡豆 +1 → " + a.resources.bean);
    } else if (id === "yuito_summon") {
      const w = spawnWeapon(a, "latte");
      lines.push(w ? "拿铁已进入战场。" : "拿铁已在场。");
    } else if (id === "latte_puff") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "acid", mult: 1, baseBreak: 1, atk });
      lines.push(beanToLiquid() ? "咖啡豆 → 咖啡液。" : "没有咖啡豆可转化。");
    } else if (id === "latte_ice") {
      const err = setWeather("snow", { by: a.id });
      lines.push(err || "天气变为雪天。");
    } else if (id === "latte_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "hiaki_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const blade = heldHiakiBlade(a) || a.resources.blade;
      if (!blade) { lines.push("两把刀都已分出，空手不能用刀技。"); return paintSkillLog(lines.join("\n")); }
      a.resources.blade = blade;
      refreshHiakiAtk(a);
      const el = blade === "naruto" ? "ice" : "fire";
      const st = a.resources.stance || "draw";
      if (st === "iai") {
        if (Number(a.zone) !== Number(t.zone)) {
          a.zone = t.zone;
          lines.push(`居合：先移动 1 距离到 ${t.zone} 区。`);
        }
        hitOne(a, t, { element: el, mult: 1.5, baseBreak: 0, atk: effectiveAtk(a, state.units) });
      } else if (st === "waki") {
        hitOne(a, t, { element: el, mult: 1, baseBreak: 2, atk: effectiveAtk(a, state.units) });
      } else {
        hitOne(a, t, { element: el, mult: 1, baseBreak: 1, atk: effectiveAtk(a, state.units) });
      }
    } else if (id === "hiaki_sheath") {
      const sheathed = (state.skillFlow && state.skillFlow.picks.blade) || heldHiakiBlade(a);
      if (!sheathed) { lines.push("两把刀都已分出，无法收刀。"); return paintSkillLog(lines.join("\n")); }
      a.resources.blade = sheathed;
      setHiakiStance(a, "iai");
      refreshHiakiAtk(a);
      lines.push(`收刀，使用${sheathed === "naruto" ? "鳴門" : "丹生谷"}，进入居合。`);
    } else if (id === "hiaki_allin") {
      const maxUse = allinMaxUses(a);
      const used = Number(a.resources.smashUsed) || 0;
      if (used >= maxUse) lines.push(`本场全力以赴已用完（${used}/${maxUse}）。`);
      else {
        a.resources.smashNext = true;
        a.resources.smashUsed = used + 1;
        a.resources.smashOnce = (used + 1) < maxUse;
        lines.push(`全力以赴：下一击带猛击（${used + 1}/${maxUse}）。`);
      }
    } else if (id === "hiaki_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const blade = (state.skillFlow && state.skillFlow.picks && state.skillFlow.picks.blade) || a.resources.blade || heldHiakiBlade(a);
      if (!blade) { lines.push("两把刀都已分出，空手不能协助攻击用刀。"); return paintSkillLog(lines.join("\n")); }
      a.resources.blade = blade;
      refreshHiakiAtk(a);
      a.zone = t.zone;
      const el = blade === "naruto" ? "ice" : "fire";
      hitOne(a, t, { element: el, mult: 1.5, baseBreak: 0, atk: effectiveAtk(a, state.units), flags: { action: true, assist: true } });
      setHiakiStance(a, "draw");
      lines.push("进入拔刀。");
    } else if (id === "hiaki_summon") {
      const usable = summonableBlades(a);
      const blade = (state.skillFlow && state.skillFlow.picks.blade) ||
        (usable.length === 1 ? usable[0] : (usable.includes(heldHiakiBlade(a)) ? heldHiakiBlade(a) : usable[0]));
      if (!blade) { lines.push("没有可分出的刀。"); return paintSkillLog(lines.join("\n")); }
      const w = spawnWeapon(a, blade);
      if (w) {
        const held = heldHiakiBlade(a);
        lines.push(`${w.name} 已分出。自动改为持有${held === "naruto" ? "鳴門" : held === "niu" ? "丹生谷" : "空手"}，收回前不能切回已分出的刀。`);
      } else lines.push("这把刀已经在场上。");
    } else if (id === "niu_slash") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "fire", mult: 1, baseBreak: 1, atk });
      t.statuses.burn = (t.statuses.burn || 0) + 1;
      popStatus(t, "burn");
      t.statuses.latestElement = "fire";
      lines.push("施加灼烧。");
      lines.push(...returnWeapon(a));
    } else if (id === "niu_return" || id === "naruto_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "naruto_wind") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "ice", mult: 1, baseBreak: 1, atk });
      t.statuses.frostbite = true;
      popStatus(t, "frostbite");
      t.statuses.latestElement = "ice";
      lines.push("施加冻伤。");
      lines.push(...returnWeapon(a));
    } else if (id === "tou_aa") {
      const fl = state.skillFlow;
      const tgt = (fl && fl.picks && fl.picks.target) ? unitById(fl.picks.target) : t;
      if (!tgt) { lines.push("先选攻击目标。"); return paintSkillLog(lines.join("\n")); }
      const wantFar = fl && fl.picks && fl.picks.rangeMode === "far";
      let rangeOk = Number(a.zone) === Number(tgt.zone);
      if (wantFar) {
        if ((a.resources.shield || 0) < 1) lines.push("没有圣盾点，只能打同区。");
        else {
          a.resources.shield -= 1; touShieldHeal(a);
          rangeOk = zoneDist(a.zone, tgt.zone, state.zoneMode) <= 1;
          lines.push("消耗 1 圣盾，射程变为距离 1。");
        }
      }
      if (!rangeOk) lines.push("目标超出本次射程。");
      else hitOne(a, tgt, { element: "physical", mult: 1, baseBreak: 1, atk });
    } else if (id === "tou_start") {
      const fl = state.skillFlow;
      const dest = fl && fl.picks.dest != null ? Number(fl.picks.dest) : (t ? Number(t.zone) : Number(a.zone));
      const tgt = (fl && fl.picks.target) ? unitById(fl.picks.target) : t;
      if (!tgt) { lines.push("先选错位目标。"); return paintSkillLog(lines.join("\n")); }
      const from = Number(a.zone);
      // 技能说明的顺序：（耗圣盾带的人）和灯一起移动 → 两人的落地效果一起结算 → 再对到达后同区的敌人施加错位
      let buddy = null;
      if (fl && fl.picks.carryMode === "yes" && fl.picks.carry && dest !== from) {
        if ((a.resources.shield || 0) < 1) lines.push("圣盾不足，未能带人。");
        else {
          buddy = unitById(fl.picks.carry) || propByRef(fl.picks.carry);
          if (buddy && Number(buddy.zone) !== from) buddy = null;
        }
      }
      if (dest !== from) {
        a.zone = dest;
        lines.push(`移动到 ${dest} 区。`);
        // 带的人和灯同时到：先把两人都放到终点，再各自结算落地（坠落、冻土、紧追……）
        if (buddy) {
          if (displaceTo(buddy, dest, lines, "随圣战起始一起移动")) {
            a.resources.shield -= 1; touShieldHeal(a);
            lines.push(`消耗 1 圣盾带 ${buddy.name} 同行。圣盾 → ${a.resources.shield}`);
          }
        }
        applyAbyssFall(a, from, lines);
      }
      if (Number(tgt.zone) !== Number(a.zone) || tgt.dead) lines.push(`${tgt.name} 不在 ${a.zone} 区，没能施加错位。`);
      else {
        applyShift(tgt);
        popStatus(tgt, "shift");
        lines.push(`对 ${tgt.name} 施加错位（次外层与最外层互换至下回合开始）。`);
      }
    } else if (id === "tou_taunt") {
      const fl = state.skillFlow;
      const tgt = (fl && fl.picks && fl.picks.target) ? unitById(fl.picks.target) : t;
      if (!tgt) { lines.push("先选嘲讽目标。"); return paintSkillLog(lines.join("\n")); }
      if (zoneDist(a.zone, tgt.zone, state.zoneMode) > 1) {
        lines.push("嘲讽只能选距离 1 以内的敌人。");
        return paintSkillLog(lines.join("\n"));
      }
      if ((a.resources.tauntLeft || 0) <= 0) lines.push("本场嘲讽次数用尽。");
      else {
        a.resources.tauntLeft -= 1;
        a.resources.tauntTurn = state.turnNo;   // 10 级前一回合只能嘲讽一次（SKILL_REQUIREMENT 判）
        tgt.tauntTo = a.id;
        // 坦克职责技能，柯尔特等也会用：写施放者自己的名字（以前一律写「必须打灯」）
        lines.push(`${tgt.name} 下次攻击必须打${a.name}。剩余 ${a.resources.tauntLeft} 次。`);
      }
    } else if (id === "tou_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      a.zone = t.zone;
      hitOne(a, t, { element: "physical", mult: 1, baseBreak: 0, atk, flags: { action: true, assist: true } });
      if (typeof passiveOn !== "function" || passiveOn(a)) a.resources.shield = Math.min(3, (a.resources.shield || 0) + 1);   // 放弃「圣盾荣耀」就没有圣盾点
      lines.push("圣盾 +1 → " + a.resources.shield);
    } else if (id === "tou_summon") {
      const w = spawnWeapon(a, "mochi");
      lines.push(w ? "年糕已进入战场。" : "年糕已在场。");
    } else if (id === "mochi_pounce") {
      const fl = state.skillFlow;
      const tgt = (fl && fl.picks.target) ? (unitById(fl.picks.target) || propByRef(fl.picks.target)) : t;
      if (!tgt) { lines.push("先选猛扑目标。"); return paintSkillLog(lines.join("\n")); }
      if (Number(tgt.zone) === Number(a.zone)) {
        const dest = fl && fl.picks.dest;
        if (!dest) { lines.push("带走同区目标时要再选目的地区。"); return paintSkillLog(lines.join("\n")); }
        const from = Number(a.zone);
        a.zone = dest;
        // 目标带不走（千钧、再次霜结、被缠住、路上的桥塌了……）：年糕也留在原区，照样出手（以前自己跳过去，隔着一区打这一下）
        if (!displaceTo(tgt, dest, lines, "被带走", { flyOver: true })) {
          a.zone = from;
          lines.push(`${tgt.name} 没被带走，${a.name} 留在 ${from} 区。`);
        }
      } else {
        a.zone = tgt.zone;
        lines.push(`猛扑跃到 ${tgt.name} 所在的 ${tgt.zone} 区。`);
      }
      if (!tgt.kind) hitOne(a, tgt, { element: "physical", mult: 1, diceN: 1, diceS: 4, baseBreak: 1, atk });
      else if (typeof damageProp === "function") damageProp(tgt, { element: "physical", dmg: Math.floor(atk), brk: 1 }, a);
    } else if (id === "mochi_roar") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const dest = pushDest(a, t);
      if (!t.kind) hitOne(a, t, { element: "harmonic", mult: 1, diceN: 1, diceS: 4, baseBreak: 1, atk, onConnect: { dest, reason: "被吼走" } });
      else {
        if (typeof damageProp === "function") damageProp(t, { element: "harmonic", dmg: Math.floor(atk), brk: 1 }, a);
        displaceTo(t, dest, lines, "被吼走");
      }
    } else if (id === "mochi_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "xia_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const eng = !!(a.resources && a.resources.engine);
      hitOne(a, t, { element: eng ? "fire" : "physical", mult: 1, diceN: 1, diceS: 4, baseBreak: eng ? 3 : 2, atk });
    } else if (id === "xia_engine") {
      if (a.resources && a.resources.engine && xiaFuelOn()) {
        // 加油（启动引擎+）：获得 2 燃油，不会导致引擎熄火
        addFuel(2, "加油", lines);
        a.resources.engineJustOn = true;
      } else setEngine(true, "拉响引擎");
    } else if (id === "xia_prep" || id === "ruby_prep") {   // 直伤职责技能一，两个 id 指同一个技能
      a.resources.preparedPending = true;
      a.resources.preparedActive = false;
      a.resources.prepared = true;
      lines.push(`准备：下个玩家回合第一次攻击的第一击基础包 +1d${prepDieSides(a)}（吃倍率与克制，含协助攻击；复数攻击只生效一次）。`);
    } else if (id === "xia_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      setEngine(true, "协助攻击");
      a.zone = t.zone;
      hitOne(a, t, { element: "fire", mult: 1, diceN: 1, diceS: 8, baseBreak: 0, atk, flags: { action: true, assist: true, pierce: true } });
    } else if (id === "xia_execute") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!(a.resources && a.resources.engine)) lines.push("处决需要引擎启动。");
      else if (!t.stunned) lines.push("处决只能对晕眩敌人使用。");
      else {
        if (state.actionAcc) state.actionAcc.fuelRate = 0.15;   // 处决：每点燃油 +15%
        hitOne(a, t, { element: "fire", mult: 1.5, diceN: 1, diceS: 8, baseBreak: 0, atk, flags: { action: true, pierce: true } });
      }
    } else if (id === "xia_ram") {
      if (!(a.resources && a.resources.engine)) lines.push("全速撞击需要引擎启动。");
      else {
        const fl = state.skillFlow;
        const dest = fl && fl.picks.dest != null ? Number(fl.picks.dest) : (t ? Number(t.zone) : null);
        const tgt = (fl && fl.picks.target) ? unitById(fl.picks.target) : t;
        if (dest == null) { lines.push("先选撞击终点区域。"); return paintSkillLog(lines.join("\n")); }
        if (!tgt) { lines.push("先选到达后攻击的敌人。"); return paintSkillLog(lines.join("\n")); }
        const dist = zoneDist(a.zone, dest, state.zoneMode);
        // 一路开过去也是地面移动：不稳桥梁照常 −1d6，塌了就坠落、撞击落空
        if (!crossGapsForced(a, a.zone, dest, lines, false)) return paintSkillLog(lines.join("\n"));
        a.zone = dest;
        // 全速狂飙（启动引擎+）：额外消耗所有燃油，每点额外 1 击破
        const fuelBrk = fl && fl.picks.mode === "full" ? takeFuel() : 0;
        // 技能描述：atk 物理 + 震荡，每移 1 格 +1 击破（没有错位）。
        // 和盾击突进统一：移动 → 先施加震荡（压上限）→ 这一击的伤害 / 击破（见 waveThenHit）
        lines.push(`${fuelBrk ? "全速狂飙" : "全速撞击"}：移动 ${dist} 区到 ${dest} 区，这一击 ${1 + dist + fuelBrk} 击破${fuelBrk ? `（消耗 ${fuelBrk} 燃油）` : ""}。`);
        waveThenHit(tgt, { element: "physical", mult: 1, baseBreak: 1 + dist + fuelBrk, atk });
      }
    } else if (id === "xia_summon") {
      const w = spawnWeapon(a, "berniel");
      lines.push(w ? "柏妮尔已进入战场。" : "柏妮尔已在场。");
    } else if (id === "berniel_spit") {
      const foes = visibleEnemies(a.zone);
      if (!foes.length) lines.push("同区没有敌人。");
      const eng = ownerEngineOn("xia");
      foes.forEach(u => hitOne(a, u, { element: "fire", mult: 0.5, baseBreak: eng ? 1 : 0, atk, flags: { action: true, aoe: true } }));
      markAoeZone(a.zone, { element: "fire", dmg: Math.floor(atk * 0.5), attacker: a });
    } else if (id === "berniel_ignite") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const d = zoneDist(a.zone, t.zone, state.zoneMode);
      if (d > 1) lines.push("燃点只能打距离 1 以内的敌人。");
      else {
        const fuel = takeFuel();   // 启动引擎+：燃点消耗所有燃油，额外施加等量灼烧
        const n = (ownerEngineOn("xia") ? 2 : 1) + fuel;
        grantBurn(t, n, lines);
        lines.push(`燃点：${t.name} 灼烧 +${n}${ownerEngineOn("xia") ? "（引擎）" : ""}${fuel ? `（消耗 ${fuel} 燃油）` : ""} → ${(t.statuses && t.statuses.burn) || 0} 层。`);
      }
    } else if (id === "berniel_dash") {
      const fl = state.skillFlow;
      const dest = fl && fl.picks.dest != null ? Number(fl.picks.dest) : null;
      if (dest == null) { lines.push("点火突进必须选择目的地区。"); return paintSkillLog(lines.join("\n")); }
      const from = Number(a.zone);
      const blocked = zoneReachable({ zone: from, flying: true }, dest);
      if (blocked) { lines.push(blocked); return paintSkillLog(lines.join("\n")); }
      const carry = fl && fl.picks.carry ? (unitById(fl.picks.carry) || propByRef(fl.picks.carry)) : null;
      const burn = fl && fl.picks.burn ? unitById(fl.picks.burn) : null;
      const engWas = ownerEngineOn("xia");
      a.flying = true;
      if (engWas && burn) {
        hitOne(a, burn, { element: "fire", mult: 1, baseBreak: 0, atk });
        lines.push(`引擎残留：对原区 ${burn.name} 造成 1×ATK 火焰。`);
      }
      a.zone = dest;
      if (carry && Number(carry.zone) === from) {
        carry.zone = dest;
        lines.push(`带走 ${carry.name}。`);
      }
      a.flying = false;
      applyAbyssFall(a, from, lines);
      if (carry && !carry.kind) applyAbyssFall(carry, from, lines);
      setEngine(true, "点火突进");
      lines.push(`点火突进飞到 ${dest} 区，落地后解除飞行。`);
    } else if (id === "berniel_flare") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const xia = findKit("xia", state.units);
      if (!ownerEngineOn("xia")) lines.push("焰袭需要引擎启动。");
      else if (!xia || Number(xia.zone) === Number(a.zone)) lines.push("焰袭需要与夕夏处于不同区域。");
      else if (zoneDist(Number(xia.zone), Number(t.zone), Number(state.zoneMode)) > 1) {
        lines.push(`焰袭由夕夏结算，${t.name} 距离夕夏超过 1。`);
      } else {
        lines.push(...returnWeapon(a));
        const xatk = effectiveAtk(xia, state.units);
        hitOne(xia, t, { element: "fire", mult: 1.5, diceN: 1, diceS: 6, baseBreak: 2, atk: xatk });
        lines.push(`焰袭：先收回武器，再以夕夏持武 ATK ${xatk} 结算 1.5×ATK+1d6 火焰。`);
      }
    } else if (id === "berniel_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "chuan_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const charged = (a.resources.charge || 0) >= 1;
      if (charged) { a.resources.charge -= 1; lines.push("消耗 1 电能，攻击变为三次、共 2 击破。"); }
      const hits = charged ? 3 : 2;
      const br = charged ? 2 : 1;
      hitOne(a, t, { element: "electric", mult: 0.5, hits: 1, diceN: 1, diceS: 4, baseBreak: br, atk });
      for (let i = 1; i < hits; i++) hitOne(a, t, { element: "electric", mult: 0.5, hits: 1, diceN: 1, diceS: 4, baseBreak: 0, atk, usePrep: false });
    } else if (id === "chuan_whip") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const hadCharge = (a.resources.charge || 0) >= 1;
      const whipFl = state.skillFlow;
      const wantPull = !!(whipFl && whipFl.picks && whipFl.picks.pull);
      const wr = hitOne(a, t, { element: "energy", mult: 0.5, baseBreak: 1, atk });
      const landed = !(wr && wr.res && wr.res.ok === false) && !t.dead;
      // 有电能时：命中后可以消耗 1 电能，把自己拉到敌人那一区
      if (wantPull && hadCharge && Number(t.zone) !== Number(a.zone) && (landed || t.dead)) {
        a.resources.charge -= 1;
        const from = a.zone;
        a.zone = Number(t.zone);
        lines.push(`电能鞭缠住 ${t.name}：消耗 1 电能，川川从 ${from} 区拉到 ${a.zone} 区。`);
        if (typeof afterMove === "function") afterMove(a, lines);
      }
      addCharge(1);
      lines.push("电能 +1 → " + (findKit("chuan", state.units).resources.charge));
    } else if (id === "chuan_cover") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      t.coverBy = a.id;
      lines.push(`掩护：此回合为 ${t.name} 免费自动协助格挡。`);
    } else if (id === "nora_aa") {
      const pins = piercedTargets(a);
      const tgt = pins[0] || t;
      if (!tgt) { lines.push("先选攻击目标。"); return paintSkillLog(lines.join("\n")); }
      if (pins.length && t && !pins.some(p => p.id === t.id)) lines.push(`场上有刺入目标，只能对刺入目标使用。`);
      const cruel = noraMood(a) === "cruel";
      if (pins.length) {
        // 刺入多个对象时效果完全一致：每个刺入对象都结算一次
        pins.forEach((pin, i) => {
          if (cruel) {
            hitOne(a, pin, { element: "ice", mult: 1, diceN: 1, diceS: 4, baseBreak: 1, atk, usePrep: i === 0 });
            noraFrost(a, pin, lines);
          } else {
            // 温和对刺入目标改为治疗，不造成伤害（所以刺入队友可以拿来奶）
            const r = takeDice(1, 6, a.level || 1);
            healUnit(pin, r.total);
            lines.push(`温和：${pin.name} 恢复 ${r.text} 点生命。`);
          }
        });
      } else if (tgt.isPlayer) {
        lines.push("没有刺入目标时，普通攻击只能打敌人。");
        return paintSkillLog(lines.join("\n"));
      } else {
        hitOne(a, tgt, { element: "ice", mult: 1, baseBreak: 1, atk, atkRange: "ranged" });   // 没有刺入：距离 1 的敌人
      }
    } else if (id === "nora_needle") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      setPierce(a, t, lines);
      if (noraMood(a) === "cruel") noraFrost(a, t, lines);
      else {
        // 温和：移到目标那一区也要走得到（危墙 / 关着的门 / 空隙挡路，不能走进深渊）；走不过去就留在原区，刺入照旧
        const why = Number(t.zone) === Number(a.zone) ? null : skillMoveWhy(a, Number(t.zone), 1);
        if (why) lines.push(`温和：诺拉没有移动，${why}`);
        else { a.zone = t.zone; lines.push(`温和：诺拉移动到 ${t.zone} 区。`); }
      }
    } else if (id === "nora_summon") {
      const w = spawnWeapon(a, "vitas");
      lines.push(w ? "维塔斯 已分出。" : "维塔斯无法唤出。");
    } else if (id === "nora_soothe") {
      if (noraMood(a) === "gentle") lines.push("维塔斯已处于温和。");
      else setMood(a, "gentle", lines, "安抚");
    } else if (id === "nora_indwell") {
      const pins = piercedTargets(a);
      if (!pins.length) { lines.push("场上没有刺入的目标。"); return paintSkillLog(lines.join("\n")); }
      pins.forEach(pin => {
        pin.instant = pin.instant || {};
        lines.push(`${pin.name} 获得刺骨。`);
        applyInstantEffect(pin, "sting", lines);
        noraFrost(a, pin, lines);
      });
    } else if (id === "nora_pressure") {
      a.resources.forceCruelNext = true;
      a.resources.nextAtkFx = (a.resources.nextAtkFx || []).concat(["diffract"]);
      lines.push("压力升高：下回合开始必定转为残忍，下一击带衍射。");
    } else if (id === "nora_sonic") {
      const list = visibleEnemies(a.zone);
      // 刺入目标那一下是额外的：同区没有敌人也照样打（以前同区没敌人就整个不打）
      if (!list.length && !piercedTargets(a).length) { lines.push("同区没有敌人，也没有刺入目标。"); return paintSkillLog(lines.join("\n")); }
      if (!list.length) lines.push("同区没有敌人。");
      list.forEach(u => hitOne(a, u, { element: "harmonic", mult: 0.5, baseBreak: 1, atk, flags: { action: true, aoe: true } }));
      piercedTargets(a).forEach(pin => {
        hitOne(a, pin, { element: "harmonic", mult: 0.5, baseBreak: 1, atk, flags: { action: true, aoe: true }, usePrep: false });
        lines.push(`刺入目标 ${pin.name} 额外再吃一次。`);
      });
    } else if (id === "nora_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (Number(a.zone) === Number(t.zone)) {
        // #44：后退也要能走得到（skillMoveZones 查地形），退到的区和目标之间不能隔墙
        const dest = skillMoveZones(a, 1).map(Number).find(z => z !== Number(a.zone) && !lineBlocked(z, t.zone));
        if (dest) { a.zone = dest; lines.push(`协助攻击：先退到 ${dest} 区再发射针尖。`); }
      }
      hitOne(a, t, { element: "ice", mult: 1, baseBreak: 0, atk, flags: { action: true, assist: true } });
      noraFrost(a, t, lines);
      setPierce(a, t, lines);
    } else if (id === "vitas_infuse") {
      const n = noraOf();
      const pins = piercedTargets(n);
      if (!pins.length) { lines.push("场上没有刺入的目标。"); return paintSkillLog(lines.join("\n")); }
      pins.forEach((pin, i) => {
        if (noraMood(n) === "cruel") {
          // 对刺入的目标生效：不受距离限制（维塔斯可能离刺入目标 2 区）
          hitOne(a, pin, { element: "ice", mult: 1, baseBreak: 1, atk, usePrep: i === 0, flags: { action: true, viaPierce: true } });
          noraFrost(a, pin, lines);
          noraFrost(a, pin, lines);
        } else {
          // 每五级多一个 d4
          const nd = 2 + dieStep(a.level || 1, 5);
          const r = takeDice(nd, 4, 2);
          healUnit(pin, r.total);
          pin.def = Math.min(pin.defMax, (pin.def || 0) + 1);
          lines.push(`温和：加压灌输 ${r.text}，${pin.name} 恢复生命并 +1 架势。`);
        }
      });
    } else if (id === "vitas_rip") {
      const n = noraOf();
      const pins = piercedTargets(n);
      if (!pins.length) { lines.push("场上没有刺入的目标。"); return paintSkillLog(lines.join("\n")); }
      // 对刺入的目标生效：不受距离限制（以前维塔斯离刺入目标 2 区时打不到，行动点照扣）
      pins.forEach((pin, i) => hitOne(a, pin, { element: "harmonic", mult: 1.5, baseBreak: 2, atk, usePrep: i === 0, flags: { action: true, viaPierce: true } }));
      clearPierce(n, lines, "被扯下");
    } else if (id === "vitas_slash") {
      const n = noraOf();
      const pins = piercedTargets(n);
      const tgt = pins[0] || t;
      if (!tgt) { lines.push("先选攻击目标。"); return paintSkillLog(lines.join("\n")); }
      if (pins.length) {
        // 有刺入对象时只能对刺入对象使用；刺入多个对象时每个都斩一次（先移动到第一个对象那一区）
        if (t && !pins.some(p => p.id === t.id)) lines.push("场上有刺入目标，只能对刺入目标使用。");
        if (Number(a.zone) !== Number(pins[0].zone)) { a.zone = Number(pins[0].zone); lines.push(`先移动到 ${pins[0].zone} 区。`); }
        pins.forEach((pin, i) => hitOne(a, pin, { element: "harmonic", mult: 1, baseBreak: 1, atk, atkRange: "any", usePrep: i === 0 }));
      } else hitOne(a, tgt, { element: "harmonic", mult: 1, baseBreak: 1, atk });
    } else if (id === "vitas_dance") {
      const n = noraOf();
      if (piercedTarget(n)) { lines.push("场上有刺入单位，无法使用寒气剑舞。"); return paintSkillLog(lines.join("\n")); }
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const cruel = noraMood(n) === "cruel";
      for (let i = 0; i < 3; i++) {
        hitOne(a, t, { element: "ice", mult: 0.2, baseBreak: i === 2 ? 1 : 0, atk, usePrep: i === 0 });
        if (cruel) noraFrost(a, t, lines);
      }
      if (!cruel) {
        const heal = Math.floor((Number(atk) || 0) * 0.5);
        fieldUnits().filter(u => u.isPlayer && Number(u.zone) === Number(a.zone)).forEach(u => healUnit(u, heal));
        lines.push(`温和：同区友方各恢复 ${heal} 点生命。`);
      }
    } else if (id === "vitas_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "xia_selfburn") {
      if (!a.resources.engine) { lines.push("引火烧身需要引擎启动。"); return paintSkillLog(lines.join("\n")); }
      a.self = "burn";
      a.selfBurnStacks = Math.max(1, Number(a.selfBurnStacks) || 1);
      const fl0 = state.skillFlow;
      // 引火自焚（启动引擎+）：消耗所有燃油，每点自焚 +1 层
      const fuelSt = fl0 && fl0.picks && fl0.picks.mode === "full" ? takeFuel() : 0;
      // 自焚最多 5 层（酷暑 10 层），和回合开始叠层的上限一样（以前 5 燃油能叠到 6 层）
      if (fuelSt) a.selfBurnStacks = Math.min(currentWeatherFor(a) === "heat" ? 10 : 5, a.selfBurnStacks + fuelSt);
      lines.push(`${a.name} 进入自焚${fuelSt ? `（引火自焚：消耗 ${fuelSt} 燃油，自焚 ${a.selfBurnStacks} 层）` : ""}。`);
      const dest = fl0 && fl0.picks ? Number(fl0.picks.dest) : null;
      if (dest && dest !== Number(a.zone)) {
        const why = skillMoveWhy(a, dest, 1);   // 移动要走得到（危墙 / 关着的门 / 空隙挡路）
        if (why) lines.push(`没能顺势移动：${why}`);
        else { a.zone = dest; lines.push(`顺势移动到 ${dest} 区。`); }
      }
    } else if (id === "xia_crush") {
      if (!a.resources.engine) { lines.push("狂怒碾压需要引擎启动。"); return paintSkillLog(lines.join("\n")); }
      if (!needT()) return paintSkillLog(lines.join("\n"));
      lines.push(...crushOnce(a, t));
    } else if (id === "chuan_pulse") {
      // 高能脉冲：对自身施加蓄能（自我效果，同时只能有一种）
      castSelfEffect(a, "store", lines);
      lines.push(`${a.name} 进入蓄能：每回合开始高能 +等级，能量 / 谐波 / 电伤害按高能值提高。`);
    } else if (id === "chuan_blade") {
      if ((a.resources.charge || 0) < 3) { lines.push("巨刃划空需要 3 电能。"); return paintSkillLog(lines.join("\n")); }
      const fl2 = state.skillFlow;
      const ref = (fl2 && fl2.picks && fl2.picks.target) || token || null;
      let prop = ref && !unitById(ref) ? propByRef(ref) : null;
      let sTok = isStructureToken(ref) ? String(ref) : (prop ? "prop:" + prop.id : null);   // 配置物 / 危墙 / 桥梁
      let tgt = sTok ? null : ((ref ? unitById(ref) : null) || t);
      if (!sTok && !tgt) { lines.push("先选目标。"); return paintSkillLog(lines.join("\n")); }
      // #44（夕夏定）：瞄准躲在敌方屏障（废铁墙……）后面的敌人，这一刀本来就会被屏障拦下——直接改砍屏障，走配置物的翻倍和摧毁返还
      // 改砍屏障也要和别的攻击一样被危墙 / 关着的门挡住（以前先换成屏障再砍，隔墙也砍得到）：挡住就不出手、不耗电能
      const shield = tgt && !tgt.isPlayer ? barrierFor(tgt, a) : null;
      if (shield && lineBlocked(a.zone, shield.zone)) {
        lines.push(`巨刃划空打不到 ${tgt.name}：${lineBlocked(a.zone, shield.zone)}`);
        return paintSkillLog(lines.join("\n"));
      }
      if (shield) {
        lines.push(`${shield.name} 挡在 ${tgt.name} 前面，巨刃划空改砍 ${shield.name}。`);
        prop = shield; sTok = "prop:" + shield.id; tgt = null;
      }
      a.resources.charge -= 3;
      if (sTok) {
        // 爆炸桶 / 酸液桶 / 碎渣机炮直接摧毁；其余配置物伤害翻倍（2×atk → 4×atk）走正规结算：
        // 电池 / 炮台 / 屏障按伤害算；危墙 / 桥梁照常只吃击破。
        // 以前直接改耐久：打爆的桶不爆炸也不移除，日志却写「摧毁配置物」
        const gk = sTok.indexOf("gap:") === 0 ? sTok.slice(4) : null;
        const standing = () => {
          if (!gk) return (state.props || []).includes(prop);
          const g = (state.gaps || {})[gk];
          return !!g && (g.type === "wall" || g.type === "bridge") && (Number(g.hp) || 0) > 0;
        };
        const was = standing();
        appendLog(lines.splice(0).join("\n"));
        if (prop && (prop.kind === "boom" || prop.kind === "acid" || prop.kind === "scrap")) {
          // 作者定：爆炸桶 / 酸液桶 / 碎渣机炮这类桶子直接摧毁（爆炸桶照常爆炸）
          lines.push(`巨刃划空劈开 ${prop.name}。`, ...destroyProp(prop, a));
        } else lines.push(...hitStructureCore(a, sTok, { element: "electric", dmg: Math.max(1, Math.floor((Number(atk) || 0) * 2 * 2)), brk: 2,
          gapDur: gk ? CHUAN_BLADE_GAP_DUR : null }));   // 危墙 / 桥梁：固定扣 10 耐久（#44）
        if (was && !standing()) {
          a.resources.charge = (a.resources.charge || 0) + 1;
          lines.push("摧毁配置物，返还 1 电能。");
        }
      } else {
        const layersBefore = (tgt.layers || []).filter(l => (Number(l.current) || 0) > 0).length;
        hitOne(a, tgt, { element: "electric", mult: 2, baseBreak: 2, atk });
        const layersAfter = (tgt.layers || []).filter(l => (Number(l.current) || 0) > 0).length;
        if (layersAfter < layersBefore) {
          a.resources.charge = (a.resources.charge || 0) + 1;
          lines.push("击穿血量层，返还 1 电能。");
        }
      }
    } else if (id === "chuan_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      a.zone = t.zone;
      // 「若有至少 3 电能」看的是发动协助攻击时手上的电能（这次积攒的 2 电能之前）
      const heavyReady = (a.resources.charge || 0) >= 3;
      hitOne(a, t, { element: "electric", mult: 0.5, diceN: 1, diceS: 4, baseBreak: 0, atk, flags: { action: true, assist: true } });
      hitOne(a, t, { element: "electric", mult: 0.5, diceN: 1, diceS: 4, baseBreak: 0, atk, flags: { action: true, assist: true }, usePrep: false });
      addCharge(2);
      lines.push("电能 +2。");
      // 有至少 3 电能：最后补一击重斩（1×atk+1d10 电击），消耗 2 电能
      if (heavyReady && !t.dead) {
        a.resources.charge -= 2;
        hitOne(a, t, { element: "electric", mult: 1, diceN: 1, diceS: 10, baseBreak: 0, atk, flags: { action: true, assist: true }, usePrep: false });
        lines.push(`重斩：1×atk+1d10 电击，电能 −2 → ${a.resources.charge}。`);
      }
    } else if (id === "chuan_wall") {
      if ((a.resources.charge || 0) < 1) lines.push("没有电能。");
      else {
        // 至少 3 电能时，可以额外消耗 1 电能给铁壁加一层 atk 点的外层护盾
        const wallFl = state.skillFlow;
        const extraShield = !!(wallFl && wallFl.picks && wallFl.picks.shield) && (a.resources.charge || 0) >= 3;
        a.resources.charge -= extraShield ? 2 : 1;
        const r = takeDice(1, 6, 0);
        const hp = Math.floor(atk + r.total);
        state.props = (state.props || []).filter(p => !(p.kind === "ironwall" && Number(p.zone) === Number(a.zone)));
        state.units = state.units.filter(u => !(u.kit === "ironwall" && Number(u.zone) === Number(a.zone)));
        const wall = makeProp("ironwall", a.zone, a.level);
        wall.hp = wall.maxHp = hp;
        wall.name = "铁壁";
        wall.movable = false;
        wall.faction = "player";
        if (extraShield) { wall.shield = wall.shieldMax = Math.floor(atk); }
        state.props.push(wall);
        lines.push(`铁壁展开：配置物装甲 ${hp}（${r.text}）${extraShield ? `，外层护盾 ${wall.shield}（多耗 1 电能）` : ""}，不可移动。同区敌方攻击行动只打铁壁一次。`);
      }
    } else if (id === "chuan_reclaim") {
      // 回收护盾（发电站… 磁场护盾+）：清除一名友方的护盾，得到 2 电能，并触发磁场护盾
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!t.isPlayer) { lines.push("只能对友方使用。"); return paintSkillLog(lines.join("\n")); }
      // 只清护盾的当前值：技能给的 / 临时的护盾层整层去掉，叠在单位自带护盾层上的那部分去掉，自带的护盾层留着
      //（以前整层删掉，维塔斯自带的 6 护盾这场再也回不来）。电池给的机械护盾、当作最内层的护盾不算
      const shields = (t.layers || []).filter(l => l.type === "shield" && !l.batteryShield && !l.inner);
      const had = shields.reduce((n, l) => n + Math.max(0, Number(l.current) || 0), 0);
      if (had <= 0) { lines.push(`${t.name} 身上没有护盾。`); return paintSkillLog(lines.join("\n")); }
      shields.forEach(l => {
        if (l.temp || l.granted) { t.layers = t.layers.filter(x => x !== l); return; }
        l.current = 0;
        const extra = (Number(l.grantBonus) || 0) + (Number(l.tempBonus) || 0) + (Number(l.tempShield) || 0);
        if (extra > 0) l.max = Math.max(0, (Number(l.max) || 0) - extra);
        delete l.grantBonus; delete l.tempBonus; l.tempShield = 0; l._lastCur = 0;
      });
      addCharge(2);
      lines.push(`回收护盾：清除 ${t.name} 的 ${had} 点护盾，川川电能 +2。`);
      t.magnetShield = true;
      lines.push(...triggerMagnetShield(t));
    } else if (id === "ruby_refuel") {
      // 补充能源（#219）：二选一，分步里选的 mode——"compress" 压缩成储备能源，其余（没选）纳米 +10
      const fl = state.skillFlow;
      if (fl && fl.picks && fl.picks.mode === "compress") compressNano(a, lines);
      else {
        addNano(RUBY_REFUEL.nano);
        lines.push(`补充能源：纳米 +${RUBY_REFUEL.nano} → ${a.resources.nano}。`);
      }
    } else if (id === "chuan_over") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      applyInstantEffect(t, "overload", lines);
      if ((a.resources.charge || 0) >= 3) {
        const sh = Math.floor(atk / 2);
        addShieldLayer(t, sh);
        lines.push(`电站超频：${t.name} 过载，并获得 ${sh} 护盾（电能≥3不增加电能）。`);
      } else {
        addCharge(2);   // #44 方案 A：电能 <3 时 +2（原 +1）
        lines.push(`电站超频：${t.name} 过载，电能 +2。`);
      }
    } else if (id === "chuan_summon") {
      const w = spawnWeapon(a, "bili");
      lines.push(w ? "哔哩哩&滋啦啦已进入战场。" : "武器已在场。");
    } else if (id === "bili_beam") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "electric", mult: 1, baseBreak: 0, atk });
      t.statuses.shock = true;
      popStatus(t, "shock");
      lines.push(`${t.name} 被施加感电。`);
    } else if (id === "bili_magnet") {
      const fl = state.skillFlow;
      const tgt = (fl && fl.picks.target) ? (unitById(fl.picks.target) || propByRef(fl.picks.target)) : t;
      let dest = fl && fl.picks.dest != null && fl.picks.dest !== "" ? Number(fl.picks.dest) : null;
      if (tgt && dest == null && Number(tgt.zone) !== Number(a.zone)) dest = Number(a.zone);
      if (!tgt || dest == null || Number.isNaN(dest)) {
        lines.push("先选择磁力移动的目标；同区目标还要选推向哪一区。");
        return paintSkillLog(lines.join("\n"));
      }
      if (Number(dest) === Number(tgt.zone)) { lines.push("目的地区不能和目标当前区域相同。"); return paintSkillLog(lines.join("\n")); }
      if (!displaceTo(tgt, dest, lines, "被磁力移动")) return paintSkillLog(lines.join("\n"));
      if (!tgt.kind) dealBreak(tgt, 1, "electric", lines, "磁力移动");
    } else if (id === "bili_field") {
      const c = findKit("chuan", state.units);
      if (!c || (c.resources.charge || 0) < 1) lines.push("川川电能不足。");
      else {
        // atk+1d4 护盾；额外消耗 1 电能再加「角色等级」点
        const fieldFl = state.skillFlow;
        const boost = !!(fieldFl && fieldFl.picks && fieldFl.picks.boost) && (c.resources.charge || 0) >= 2;
        c.resources.charge -= boost ? 2 : 1;
        const r = takeDice(1, 4, 0);
        const sh = effectiveAtk(a, state.units) + r.total + (boost ? (Number(c.level) || 1) : 0);
        fieldUnits().filter(u => u.isPlayer && Number(u.zone) === Number(a.zone)).forEach(u => addShieldLayer(u, sh));
        lines.push(`磁场盾：同区友方各获得 ${sh} 护盾（atk+${r.text}${boost ? ` + 等级 ${Number(c.level) || 1}` : ""}），电能 −${boost ? 2 : 1}。`);
      }
    } else if (id === "bili_storm") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const c = findKit("chuan", state.units);
      const charge = c ? (c.resources.charge || 0) : 0;
      if (!c || charge < 1) lines.push("雷电风暴需要至少 1 电能。");
      else {
        c.resources.charge = 0;
        const hits = charge * 2;
        const br = Math.floor(charge / 2);
        for (let i = 0; i < hits; i++) {
          hitOne(a, t, { element: "electric", mult: 0.4, baseBreak: 0, atk, flags: { action: true } });
        }
        if (br) dealBreak(t, br, "electric", lines, "雷电风暴");
        if (t.statuses && t.statuses.shock) {
          c.resources.charge += 2;
          lines.push("目标有感电：回复 2 电能。");
        }
        lines.push(`雷电风暴：消耗 ${charge} 电能，打 ${hits} 次 0.4atk 电击，击破 ${br}。电能 → ${c.resources.charge}`);
      }
    } else if (id === "bili_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "ruby_surge" || id === "wing_surge") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const out = hitOne(a, t, { element: "electric", mult: 1, baseBreak: 1, atk });
      const hitShield = (t.layers || []).some(l => l.type === "shield" && (out.res.total || 0) > 0);
      if (hitShield || (t.layers[0] && t.layers[0].type === "shield")) {
        addNano(id === "wing_surge" ? 20 : 10);
        lines.push("打到护盾，纳米 +" + (id === "wing_surge" ? 20 : 10));
      }
    } else if (id === "ruby_short") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      t.statuses.shock = true;
      popStatus(t, "shock");
      lines.push(`${t.name} 被施加感电。`);
    } else if (id === "mint_banish") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const dest = pushDest(a, t);
      if (!t.kind) hitOne(a, t, { element: "electric", mult: 0.5, hits: 2, baseBreak: 1, breakOnce: true, atk, onConnect: { dest, reason: "被驱逐" } });
      else {
        // 配置物和单位一样：先吃这一下（两次 0.5atk 电），没被打坏就推开 1 格
        if (typeof damageProp === "function") lines.push(...damageProp(t, { element: "electric", dmg: Math.floor(atk), brk: 1 }, a));
        if ((state.props || []).includes(t)) displaceTo(t, dest, lines, "被驱逐");
      }
    } else if (id === "yuito_espresso") {
      const fl = state.skillFlow;
      const mode = fl && fl.picks.mode;
      const tgt = (fl && fl.picks.target) ? unitById(fl.picks.target) : t;
      if (!mode || !tgt) { lines.push("先完成意式浓缩的分步选择。"); return paintSkillLog(lines.join("\n")); }
      if ((a.resources.liquid || 0) < 1) { lines.push("没有咖啡液。"); }
      else {
        a.resources.liquid -= 1;
        if (mode === "ap") {
          grantAllyAp(a, tgt, 1, lines);   // 这个行动点打出来的分数一半记在结人身上
        } else {
          hitOne(a, tgt, { element: "acid", mult: 1, baseBreak: 2, atk });
        }
      }
    } else if (id === "yuito_extract") {
      const fl = state.skillFlow;
      const z = fl && fl.picks.dest != null ? Number(fl.picks.dest) : (t ? t.zone : a.zone);
      if ((a.resources.liquid || 0) < 1) { lines.push("没有咖啡液。"); }
      else {
        a.resources.liquid -= 1;
        const ferr = setZoneField(z, "acid", { by: a.id });
        if (ferr) lines.push(ferr);
        else lines.push(`${z} 区变为酸液地面。`);
        markAoeZone(z);
        // 每五级多一个 d4，治疗和伤害都是
        const nd = addedDiceByLevel(a.level);
        const healR = takeDice(nd, 4, 0);
        const dmgR = takeDice(nd, 4, 0);
        const heal = healR.total;
        const dmg = dmgR.total;
        lines.push(`酸萃掷骰 治疗 ${healR.text} / 伤害 ${dmgR.text}`);
        fieldUnits().filter(u => Number(u.zone) === Number(z)).forEach(u => {
          if (u.isPlayer && !isWeaponUnit(u)) {
            const hb = bondHealDice(a, u, nd, 4, 0);   // 被牵挂的人：骰子取最大值
            const amt = hb.maxed ? hb.total : heal;
            healUnit(u, amt); lines.push(`${u.name} 恢复 ${amt}${hb.maxed ? "（牵挂取最大值）" : ""}`);
          }
          // 区域效果是范围攻击：打飞行敌人不用逐个多付附赠（以前对每只飞行敌人各扣 1 个，不够时后面的不受伤）
          else if (!u.isPlayer) hitOne(a, u, { atk: 0, mult: 0, flat: dmg, element: "acid", baseBreak: 0, flags: { action: true, aoe: true } });
        });
      }
    } else if (id === "latte_love") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      a.zone = t.zone;
      // 2d4，每五级骰面升一档（2d6、2d8…）
      // 牵挂：目标在这次施加之前就被牵挂，治疗骰取最大值（先治疗后挂牵挂的时序待定，先按施加前算）
      const healR = bondHealDice(a, t, 2, leveledSides(a.level, 4), 0);
      const heal = healR.total;
      lines.push(`爱意掷骰 ${healR.text}${healR.maxed ? "（牵挂取最大值）" : ""}`);
      const y = findKit("yuito", state.units);
      // 目标在施加之前就已经被牵挂：拿铁自己也恢复同量的生命和架势（先判断再施加，不然每次都成立）
      const already = !!(y && y.resources && y.resources.bondId === t.id);
      healUnit(t, heal);
      t.def = Math.min(t.defMax, (t.def || 0) + 1);
      if (y) setBond(y, t);
      lines.push(`爱意：${t.name} 恢复生命并 +1 架势，施加牵挂。`);
      if (already && t !== a) {
        healUnit(a, heal);
        a.def = Math.min(a.defMax, (a.def || 0) + 1);
        lines.push(`${t.name} 已经被牵挂：${a.name} 也恢复 ${heal} 生命并 +1 架势。`);
      }
    } else if (id === "hiaki_flash") {
      if ((a.resources.stance || "draw") !== "iai") { lines.push("只能在居合下使用一闪。"); }
      else {
        visibleEnemies(a.zone).forEach(u => {
          const el = a.resources.blade === "naruto" ? "ice" : "fire";
          hitOne(a, u, { element: el, mult: 1, baseBreak: 1, atk: effectiveAtk(a, state.units), flags: { action: true, aoe: true } });
        });
        markAoeZone(a.zone, { element: a.resources.blade === "naruto" ? "ice" : "fire", dmg: effectiveAtk(a, state.units), attacker: a });
        setHiakiStance(a, "draw");
        lines.push("一闪后进入拔刀。");
      }
    } else if (id === "hiaki_pot") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (a.resources.blade !== "niu") { lines.push("热锅只能用丹生谷发动。"); }
      else { applyInstantEffect(t, "melt", lines); lines.push(`${t.name} 被施加熔融。`); }
    } else if (id === "niu_tsubame") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "fire", mult: 1, baseBreak: 1, atk });
      tsubameFollowUp(a, lines);
    } else if (id === "naruto_fly") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "ice", mult: 0.5, baseBreak: 1, atk });
      // 燕飞：然后移动 1 格（以前只提示玩家再去按移动）。走不到的区在分步里就不列出
      const fl = state.skillFlow;
      const dest = fl && fl.picks && fl.picks.dest != null ? Number(fl.picks.dest) : null;
      const why = dest != null ? skillMoveWhy(a, dest, 1) : skillMoveZones(a, 1).length ? "没有选移动到哪一区" : "旁边没有走得到的区";
      if (why) lines.push(`燕飞后没有移动：${why}`);
      else {
        const from = Number(a.zone);
        a.zone = dest;
        lines.push(`燕飞：移动 1 格（${from} 区 → ${dest} 区）。`);
        applyAbyssFall(a, from, lines);
      }
    } else if (id === "tou_sonic") {
      const fl = state.skillFlow;
      // 分步里选的两个目标；没走分步（计算器直接选目标）时按距离归类
      const { t1, t2 } = touSonicPicks(a, t);
      a.resources.shield -= 1; touShieldHeal(a);   // 有没有圣盾、有没有目标在扣行动点之前就查过了（skillTargetError）
      const strike = (x, mult, first) => {
        if (isStructureToken(x)) {
          appendLog(lines.splice(0).join("\n"));
          appendLog(hitStructureCore(a, x, { element: "harmonic", dmg: Math.floor(atk * mult), brk: 1 }).join("\n"));
        } else hitOne(a, x, { element: "harmonic", mult, baseBreak: 1, atk, atkRange: "any", usePrep: first });
      };
      if (t1) strike(t1, 1, true);
      if (t2) strike(t2, 0.5, !t1);
      lines.push("圣盾 −1。");
    } else if (id === "tou_ultra") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      // 即时效果的键是 refract（以前弹字写成 reflect，共振按 reflect 去分享，折射传不过去）
      applyInstantEffect(t, "refract", lines);
      lines.push(`${t.name} 陷入折射。`);
    } else if (id === "mochi_boom") {
      const boom = () => {
        visibleEnemies(a.zone).forEach(u => hitOne(a, u, { element: "harmonic", mult: 0.5, baseBreak: 1, atk, flags: { action: true, aoe: true } }));
        markAoeZone(a.zone, { element: "harmonic", dmg: Math.floor(atk * 0.5), attacker: a });
        flushAoePulse();   // 再耗圣盾炸第二次算另一次范围攻击，按钮再触发一次
      };
      boom();
      lines.push("音爆：同区每个敌人 0.5atk 谐波 +1 击破。");
      const fl = state.skillFlow;
      const again = fl && fl.picks.again === "twice";
      const tou = findKit("tou", state.units);
      if (again) {
        if (!tou || (tou.resources.shield || 0) < 1) lines.push("圣盾不足，未能第二次音爆。");
        else {
          tou.resources.shield -= 1; touShieldHeal(tou);
          boom();
          lines.push(`消耗 1 圣盾再触发一次音爆。灯圣盾 → ${tou.resources.shield}`);
        }
      }
    } else if (id === "ruby_algo") {
      // 算法改变：任意距离的敌人施加扩散；这一回合内它每次受到伤害，瑞比 +5 纳米（engine.js · applyResultToUnit）
      if (!needT()) return paintSkillLog(lines.join("\n"));
      applyInstantEffect(t, "spread", lines);
      t.algoTurn = state.turnNo;
      lines.push(`算法改变：${t.name} 被施加扩散；这一回合它每次受到伤害，瑞比纳米 +5。`);
    } else if (id === "ruby_relay" || id === "wing_relay") {
      // 收发代理：放出小型无人机，不限时间。平时每回合 +10 纳米；瑞比在机甲里时改为每回合结束发射激光（turnEnd）
      const ruby = findKit("ruby", state.units) || a;
      ruby.resources = ruby.resources || {};
      ruby.resources.drone = true;
      lines.push(ruby.resources.mecha
        ? "收发代理：小型无人机升空。银翼模式下每回合结束对高能敌人（没有就打血量最少的）发射激光，每次耗 10 纳米。"
        : "收发代理：小型无人机升空，每回合为瑞比提取 10 纳米能源。进入机甲后自动改为发射激光。");
    } else if (id === "wing_boost") {
      // 银翼·机体强化（不耗行动）：每回合维持多耗 20 纳米；atk +20%；普攻溅射倍率 +0.1。解除机甲时结束
      a.resources.overdrive = true;
      a.atk = effectiveAtk(a, state.units);
      lines.push("机体强化：每回合消耗的纳米能源 +20，atk +20%，普通攻击溅射倍率 +0.1。");
    } else if (id === "mint_repair") {
      // 机体修复：消耗 20 纳米（纳米不够的差额从储备能源扣，#219），自身恢复 50% 生命上限，+1 架势
      const ruby = findKit("ruby", state.units);
      const paid = spendNano(20, { ruby, partial: true });   // 门槛（SKILL_REQUIREMENT）已经查过够 20
      const got = healUnit(a, Math.floor(totalMaxHp(a) * 0.5));
      a.def = Math.min(a.defMax || a.def, (Number(a.def) || 0) + 1);
      const left = !ruby || !ruby.resources ? "纳米 → —" : paid && paid.reserve ? nanoSpentText(ruby, paid) : "纳米 → " + ruby.resources.nano;
      lines.push(`机体修复：消耗 20 纳米，恢复 ${got} 生命，架势 +1。${left}`);
    } else if (id === "yuito_cold") {
      // 冷萃：1 咖啡液。距离 ≤1 的区变冻土，那一区的敌人 0.5atk 冰 +1 击破，友方 +1 架势
      const fl = state.skillFlow;
      const z = fl && fl.picks.dest != null ? Number(fl.picks.dest) : Number(a.zone);
      a.resources.liquid -= 1;
      const ferr = setZoneField(z, "ice", { by: a.id });
      lines.push(ferr || `${z} 区变为冻土。`);
      markAoeZone(z);
      fieldUnits().filter(u => Number(u.zone) === z && !u.dead).forEach(u => {
        if (u.isPlayer) {
          if (!isWeaponUnit(u)) { u.def = Math.min(u.defMax || u.def, (Number(u.def) || 0) + 1); lines.push(`${u.name} 架势 +1。`); }
        } else hitOne(a, u, { element: "ice", mult: 0.5, baseBreak: 1, atk, flags: { action: true, aoe: true } });
      });
    } else if (id === "yuito_duet") {
      // 双重奏：2 咖啡液。任意友方恢复 等级×1d6；溢出的治疗变成等量 atk，下回合开始失去
      const fl = state.skillFlow;
      const tgt = fl && fl.picks.target ? unitById(fl.picks.target) : t;
      if (!tgt || !tgt.isPlayer) { lines.push("先选要治疗的友方。"); return paintSkillLog(lines.join("\n")); }
      a.resources.liquid -= 2;
      const r = bondHealDice(a, tgt, Math.max(1, Number(a.level) || 1), 6, 0);   // 牵挂：取最大值
      const got = healUnit(tgt, r.total);
      const over = Math.max(0, r.total - (Number(got) || 0));
      lines.push(`双重奏：${tgt.name} 治疗 ${r.text}${r.maxed ? "（牵挂取最大值）" : ""}，恢复 ${got}。`);
      if (over > 0) {
        tgt.duetAtk = (Number(tgt.duetAtk) || 0) + over;
        lines.push(`溢出的 ${over} 点治疗变成 atk +${over}（下回合开始失去）。`);
      }
    } else if (id === "latte_claw") {
      // 猫爪挥打：同区 1atk 酸 +1 击破，击退 1；+1 咖啡豆，打出失衡再 +1
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const stun0 = !!t.stunned;
      const dest = pushDest(a, t);
      hitOne(a, t, { element: "acid", mult: 1, baseBreak: 1, atk, onConnect: { dest, reason: "被猫爪击退" } });
      const y = findKit("yuito", state.units);
      if (y) {
        const gain = brokeInto(t, stun0) ? 2 : 1;
        y.resources.bean = (Number(y.resources.bean) || 0) + gain;
        lines.push(`咖啡豆 +${gain}${gain > 1 ? "（打出失衡）" : ""} → ${y.resources.bean}`);
      }
    } else if (id === "hiaki_barrage") {
      // 特盛乱打：仅胁构。同区每个敌人 1 击破并做乱打标记，进入拔刀；下次进入居合时被标记的各挨 0.5atk（setHiakiStance）
      const el = a.resources.blade === "naruto" ? "ice" : "fire";
      const foes = visibleEnemies(a.zone);
      if (!foes.length) lines.push("同区没有敌人。");
      foes.forEach(u => { smashableBreak(a, u, 1, el, lines, "特盛乱打"); if (!u.dead) u.barrageBy = a.id; });
      setHiakiStance(a, "draw");
      lines.push("特盛乱打：同区敌人各 1 击破并被标记，进入拔刀。下次进入居合时，被乱打过的敌人各被瞬间砍一刀。");
    } else if (id === "hiaki_powder") {
      // 粉落汤气：仅居合。下回合之前格挡成功不切刀势，并且每次都用另一把刀反击（beginRound 清掉）
      a.resources.powder = true;
      lines.push("粉落汤气：两把刀都摆在身旁。下回合之前格挡成功不切刀势，并用另一把刀反击。");
    } else if (id === "niu_standby") {
      a.resources.standby = true;
      lines.push("待命：下一次协助格挡必定成功；成功后变回武器，绯秋换持丹生谷进入居合。");
    } else if (id === "naruto_frost") {
      // 霜取：近距离一击 3 冰击破；打出失衡就收回，绯秋换持鳴門进入胁构
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const stun0 = !!t.stunned;
      hitOne(a, t, { element: "ice", mult: 0, baseBreak: 3, atk, atkRange: "melee" });
      if (brokeInto(t, stun0)) {
        const owner = ownerOfWeapon(a, state.units);
        lines.push(...returnWeapon(a));
        if (owner) {
          owner.resources.blade = "naruto";
          setHiakiStance(owner, "waki");
          refreshHiakiAtk(owner);
          lines.push("霜取打出失衡：鳴門收回，绯秋换持鳴門进入胁构。");
        }
      }
    } else if (id === "tou_bash") {
      // 盾击突进：移动 ≤1，对同区敌人 1atk 物理 + 震荡；可耗 1 圣盾再盾突：1 击破 + 不稳
      const fl = state.skillFlow;
      const dest = fl && fl.picks.dest != null ? Number(fl.picks.dest) : Number(a.zone);
      const tgt = fl && fl.picks.target ? unitById(fl.picks.target) : t;
      if (!tgt) { lines.push("先选盾击目标。"); return paintSkillLog(lines.join("\n")); }
      if (dest !== Number(a.zone)) { const from = Number(a.zone); a.zone = dest; lines.push(`盾击突进：移动到 ${dest} 区。`); applyAbyssFall(a, from, lines); }
      // 技能说明的顺序：移动 → 先施加震荡 → 这一击的伤害 / 击破（熔融沙尘 +1 等照常）→ 可选的二次盾突（见 waveThenHit）
      waveThenHit(tgt, { element: "physical", mult: 1, baseBreak: 0, atk });
      if (fl && fl.picks.again === "yes" && !tgt.dead) {
        if ((a.resources.shield || 0) < 1) lines.push("圣盾不足，未能二次盾突。");
        else {
          a.resources.shield -= 1; touShieldHeal(a);
          dealBreak(tgt, 1, "physical", lines, "二次盾突", { by: a });
          if (!tgt.dead) { applyUnstable(tgt, lines); popStatus(tgt, "unstable"); }
          lines.push(`二次盾突：1 击破，${tgt.name} 不稳。圣盾 → ${a.resources.shield}`);
        }
      }
    } else if (id === "tou_accuse") {
      // 赤诚控诉：距离 1 以内的敌人 1atk 谐波，嘲讽，圣盾 +2；被决一死战影响的再虚弱
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const duel = typeof touDuelVictim === "function" && touDuelVictim(t) === a;
      hitOne(a, t, { element: "harmonic", mult: 1, baseBreak: 0, atk, atkRange: "any" });
      if (!t.dead) { t.tauntTo = a.id; lines.push(`${t.name} 被嘲讽：下次攻击必须打${a.name}。`); }
      a.resources.shield = Math.min(3, (Number(a.resources.shield) || 0) + 2);
      lines.push(`圣盾 +2 → ${a.resources.shield}`);
      if (duel && !t.dead) {
        t.statuses = t.statuses || {};
        t.statuses.weak = true;
        popStatus(t, "weak");
        lines.push(`${t.name} 正处于决一死战：额外虚弱。`);
      }
    } else if (id === "mochi_bite") {
      // 紧咬不放：同区 1atk 物理 +1 击破，嘲讽，并使其无法移动（到下一个敌人回合结束）
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "physical", mult: 1, baseBreak: 1, atk });
      if (!t.dead) {
        t.tauntTo = a.id;
        t.noMove = true;
        t.noMoveUntil = (Number(state.turnNo) || 0) + (state.combatPhase === "enemy" ? 1 : 0);
        lines.push(`${t.name} 被年糕死死咬住：嘲讽，无法移动。`);
      }
    } else if (id.indexOf("fx_") === 0) {
      const fx = id.slice(3);
      if (!ATKFX[fx]) lines.push("未知的属性攻击效果。");
      else {
        hangAtkFx(a, fx);
        lines.push(`${a.name} 将【${ATKFX[fx].name}】挂在下一次攻击上。晕眩不会清掉。`);
      }
    } else if (id === "role_refine") {
      // 职责技能的次数统一读 ROLE_USE_CAP（用完了在 SKILL_REQUIREMENT 就拦下，不扣点）
      if (!roleSpend(a, "role_refine")) lines.push("精益求精本场次数已用完。");
      else {
        a.resources.weakNext = true;
        lines.push("精益求精：下一击带弱点特效。");
      }
    } else if (id === "role_pierce") {
      if (!roleSpend(a, "role_pierce")) lines.push("一击制敌本场已用完。");
      else {
        a.resources.pierceNext = true;
        lines.push("一击制敌：下一击带穿刺。");
      }
    } else if (id === "role_gambit") {
      if (!roleSpend(a, "role_gambit")) lines.push("破釜沉舟本场已用完。");
      else {
        a.resources.gambitArmed = true;
        // 受伤翻倍从现在开始，到自己下一个回合开始（下一次行动前）结束；以前是下回合起整场翻倍
        a.resources.gambitWound = true;
        lines.push("破釜沉舟：下个自己的回合攻击双倍；从现在到自己下次行动前，受到的伤害翻倍。");
      }
    } else if (id === "role_activate") {
      const fl = state.skillFlow;
      const tgt = (fl && fl.picks && fl.picks.target) ? unitById(fl.picks.target) : t;
      if (!tgt) { lines.push("先选激活目标。"); return paintSkillLog(lines.join("\n")); }
      const key = fl && fl.picks ? fl.picks.status : null;
      lines.push(...triggerOneStatus(tgt, a, key));
    } else if (id === "role_spread") {
      // 来源和承受者都在分步里选（承受者也是这次的技能目标）；以前直接拿同区第一个别的单位，可能复制给自己人
      const fl = state.skillFlow;
      const src = fl && fl.picks && fl.picks.target1 ? unitById(fl.picks.target1) : null;
      const dest = fl && fl.picks && fl.picks.target ? unitById(fl.picks.target) : t;
      if (!src || !dest) { lines.push("先选传播的来源和承受者。"); return paintSkillLog(lines.join("\n")); }
      const got = copyStatuses(src, dest, lines);
      lines.push(got.length ? `传播：${src.name} 身上的${got.join("、")}施加到 ${dest.name}。` : `传播：${dest.name} 没有得到新的状态。`);
    } else if (id === "role_double_dot") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!roleSpend(a, "role_double_dot")) lines.push("加倍计量本场已用完。");
      else {
        t.instant = t.instant || {};
        t.instant.doubleStatus = true;
        lines.push(`${t.name} 本回合状态效果翻倍。`);
        if (typeof syncShockwave === "function") syncShockwave(t, lines);   // 震荡扣的架势上限也翻倍
      }
    } else if (id === "role_self_doom") {
      a.resources.selfDoom = !a.resources.selfDoom;
      lines.push(a.resources.selfDoom ? "自我毁灭开启：施加状态翻倍，自己也承受一层。" : "自我毁灭关闭。");
    } else if (id === "role_breakwave") {
      const cap = (a.level || 1) >= 15 ? 2 : 1;
      // 已经死掉（还在淡出）的敌人不算
      visibleEnemies(a.zone).filter(u => !u.dead && !u.fused && (u.def || 0) > 0 && (u.def || 0) <= cap).forEach(u => {
        smashableBreak(a, u, 1, "none", lines, "破势");
      });
      lines.push(`破势：同区架势 ≤ ${cap} 的敌人各受 1 无属性击破。`);
    } else if (id === "role_halve") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!roleSpend(a, "role_halve")) lines.push("折戟本场已用完。");
      else {
        const amt = Math.floor((Number(t.def) || 0) / 2);
        dealBreak(t, amt, "none", lines, "折戟", { by: a });
        lines.push(`折戟：击破 ${amt}。`);
      }
    } else if (id === "role_omen") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!roleSpend(a, "role_omen")) lines.push("击破预告本场已用完。");
      else {
        t.instant = t.instant || {};
        t.instant.doubleBreak = true;
        t.instant.omenFrom = a.id;
        t.instant.omenArmed = true;
        t.instant.omenHit = false;   // 判定窗口里被打进失衡就记下（recoverFromStun），回合结束按它判成功
        lines.push(`${t.name} 下回合受到双倍击破。若该回合未能击破其架势，你将失衡。`);
      }
    } else if (id === "role_lockdown") {
      // 只到这一回合结束：不能移动（turnEnd 清 noMove），攻击只能打施放者（lockdownBy，releaseTurnLocks 清）。
      // 以前借用嘲讽的 tauntTo：敌人这回合没出手就一直留到之后的回合；出手一次又提前没了
      visibleEnemies(a.zone).filter(u => !u.dead && !u.fused).forEach(u => {
        u.noMove = true;
        u.lockdownBy = a.id;
      });
      lines.push(`禁足怒吼：同区敌人本回合无法移动，且只能攻击${a.name}。`);
    } else if (id === "role_grit") {
      if (!roleSpend(a, "role_grit")) lines.push("咬牙坚持本场次数用尽。");
      else {
        a.resources.gritTurn = true;
        lines.push("咬牙坚持：本回合受伤减半。");
      }
    } else if (id === "role_stand") {
      if (!roleSpend(a, "role_stand")) lines.push("屹立不倒本场已用完。");
      else {
        a.resources.standTurn = true;
        lines.push("屹立不倒：本回合免疫伤害和击破。");
      }
    } else if (id === "role_fear") {
      if (!roleSpend(a, "role_fear")) lines.push("恐惧怒吼次数用尽。");
      else {
        fieldUnits().filter(u => !u.isPlayer && zoneDist(a.zone, u.zone, state.zoneMode) <= 1).forEach(u => {
          u.statuses = u.statuses || {};
          // 只到这一回合结束（敌人回合打完的 turnEnd 里清掉），不是整场
          if (!u.statuses.weak) u.statuses.weakFear = true;
          u.statuses.weak = true;
        });
        lines.push("恐惧怒吼：距离 1 内敌人本回合虚弱。");
      }
    } else if (id === "role_guard_strike") {
      a.resources.guardStrike = true;
      lines.push("防守反击：本回合第一次成功协助格挡会追加一次协助攻击。");
    } else if (id === "role_all_reflect") {
      if (!roleSpend(a, "role_all_reflect")) lines.push("全反击本场已用完。");
      else {
        a.resources.allReflect = true;
        lines.push("全反击：本回合全队成功格挡将反伤伤害与击破。");
      }
    } else if (id === "role_buffer") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!roleSpend(a, "role_buffer")) lines.push("缓冲次数用尽。");
      else {
        const r = takeDice(2, 4, 4);
        // 15 级后可以自选给哪一种血量（分步里选）；默认是护盾
        const fl = state.skillFlow;
        const kind = roleSkillLv(a) >= 15 && fl && fl.picks && LAYER[fl.picks.layer] ? fl.picks.layer : "shield";
        if (kind === "shield") addShieldLayer(t, r.total, false);   // 生存职责给的护盾，不是川川的磁场护盾
        else addTempLayer(t, kind, r.total);                        // 其他种类：战斗内的临时血量，战后去掉
        lines.push(`缓冲：${t.name} 获得 ${r.total} 点${kind === "shield" ? "护盾" : LAYER[kind]}（${r.text}）。`);
      }
    } else if (id === "role_dome") {
      if (!roleSpend(a, "role_dome")) lines.push("防护罩本场已用完。");
      else {
        const hp = Math.floor(atk + 10);
        // 防护罩是盾牌类配置物（和铁壁、废铁墙一样）：替同区我方挡攻击行动，范围攻击完全挡住，只有罩挨一下
        state.props = (state.props || []).filter(p => !(p.kind === "dome" && Number(p.zone) === Number(a.zone)));
        const wall = makeProp("dome", a.zone, a.level);
        wall.hp = wall.maxHp = hp;
        state.props.push(wall);
        lines.push(`防护罩展开：护盾 ${hp}。同区我方受到的攻击由罩承受，范围攻击完全挡住。`);
      }
    } else if (id === "role_renew") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!roleSpend(a, "role_renew")) lines.push("续命本场已用完。");
      else if (t.dying || t.upOnShp || totalHp(t) <= 0) {
        // 濒死（或已经靠坚毅生命起身）：直接救回濒死前的状态——不走坚毅生命那一套，不受力竭「不能起身」限制，
        // 之后受伤照常打血量层；恢复最大生命的 25%
        t.dying = false;
        t.upOnShp = false;
        t.dead = false;
        const heal = Math.floor(baseMaxHp(t) * 0.25);
        const got = healUnit(t, heal);
        lines.push(`续命：${t.name} 从濒死中救回（不消耗坚毅生命），恢复 ${got}（最大生命 25%）。`);
      } else {
        const heal = Math.floor(totalMaxHp(t) * 0.5);
        healUnit(t, heal);
        lines.push(`续命：${t.name} 恢复 ${heal}（最大生命 50%）。`);
      }
    } else if (id === "role_lock") {
      // 每场一次（5 级两次，10 级三次）；只锁到这一回合结束（turnEnd 里解开）
      const cap = roleLockCap(a);
      if (!roleSpend(a, "role_lock")) lines.push(`锁定本场已用完（每场 ${cap} 次）。`);
      else if (state.weather && state.weather !== "none") {
        if (!state.weatherLock) { state.weatherLock = a.name + "锁定"; state.weatherLockTurn = true; }
        lines.push(`锁定天气：${weatherName(state.weather)} 本回合不会被修改。`);
      } else {
        const f = state.fields[a.zone];
        if (f && !f.fieldLock) { f.fieldLock = a.name + "锁定"; f.fieldLockTurn = true; }
        lines.push(`锁定 ${a.zone} 区场地本回合不会被修改。`);
      }
      if (a.kit === "helu") a.resources.lockLeft = Math.max(0, cap - ((a.resources.roleOnce || {}).lock || 0));
    } else if (id === "role_shelter") {
      // 每场 2 次（15 级 3 次）；一次附赠动作可以在这一回合里保释好几名友方（分步里多选），每人用掉一次
      const fl = state.skillFlow;
      const ids = SHELTER_PICKS.map(k => fl && fl.picks ? fl.picks[k] : null).filter(Boolean);
      const list = ids.length ? ids.map(x => unitById(x)).filter(Boolean) : (t ? [t] : []);
      if (!list.length) { lines.push("先选要保释的友方。"); return paintSkillLog(lines.join("\n")); }
      list.forEach(u => {
        if (!roleSpend(a, "role_shelter")) { lines.push(`保释本场次数已用完，${u.name} 没有保释。`); return; }
        u.isolate = true;
        u.shelterTurn = true;
        lines.push(`${u.name} 本回合豁免天气与场地。`);
      });
    } else if (id === "role_harsh") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!roleSpend(a, "role_harsh")) lines.push("恶劣环境本场已用完。");
      else {
        t.harshEnv = true;
        lines.push(`${t.name} 本回合场地与天气效果翻倍。`);
      }
    } else if (id === "role_apocalypse") {
      if (!roleSpend(a, "role_apocalypse")) lines.push("末日本场已用完。");
      else {
        state.apocalypse = true;
        lines.push("末日：整场战斗天气与场地效果翻倍，无法停止。");
      }
    } else if (id === "role_boost") {
      // 目的地在分步里选（以前读一个不存在的界面元素 destZone，只能挪到默认的相邻区）
      const fl = state.skillFlow;
      const tgt = fl && fl.picks && fl.picks.target ? unitById(fl.picks.target) : t;
      const dest = fl && fl.picks && fl.picks.dest != null ? Number(fl.picks.dest) : null;
      if (!tgt || dest == null) { lines.push("先选借力移动的友方和目的地。"); return paintSkillLog(lines.join("\n")); }
      displaceTo(tgt, dest, lines, "被借力移动");
    } else if (id === "role_shake") {
      if (!roleSpend(a, "role_shake")) lines.push("撼动本场已用完。");
      else {
        visibleEnemies(a.zone).filter(u => !u.dead && !u.fused).forEach(u => {
          u.noMove = true;
          if (!applyUnstable(u, lines)) return;
          convertUnstableInHv(u, lines);
          maybeUnstableTrip(u, lines);
        });
        lines.push("撼动：同区敌人陷入不稳（本回合无法移动）。高压场上的不稳会立刻晕眩。");
      }
    } else if (id === "role_rearrange") {
      if (!roleSpend(a, "role_rearrange")) lines.push("重整本场已用完。");
      else {
        fieldUnits().filter(u => zoneDist(a.zone, u.zone, state.zoneMode) <= 1 && u.id !== a.id)
          .concat((state.props || []).filter(p => p.movable && zoneDist(a.zone, p.zone, state.zoneMode) <= 1))   // 可移动的配置物也一样
          .forEach(u => {
            const dest = otherZone(u.zone);
            if (zonesAdjacent(dest, u.zone)) displaceTo(u, dest, lines, "被重整");
          });
        lines.push("重整：距离 1 内其他单位各移动 1 区。飞行切换请在单位面板手动改。");
      }
    } else if (id === "role_sturdy") {
      const fl = state.skillFlow;
      if (roleSkillLv(a) >= 15 && fl && fl.picks && fl.picks.mode === "all") {
        // 15 级：用行动点让全部友方此回合获得坚挺（skillCost 按这个分步改收行动点）
        const all = fieldUnits().filter(u => u.isPlayer && !u.fused);
        all.forEach(u => { u.statuses = u.statuses || {}; u.statuses.sturdy = true; });
        lines.push(`不倒战意：全部友方（${all.map(u => u.name).join("、")}）本回合获得坚挺。`);
      } else {
        if (!needT()) return paintSkillLog(lines.join("\n"));
        t.statuses = t.statuses || {};
        t.statuses.sturdy = true;
        lines.push(`${t.name} 本回合获得坚挺。`);
      }
    } else if (id === "role_gold") {
      // 目标和延长哪一种即时效果在分步里选（只有一种时不用选）
      const fl = state.skillFlow;
      const tgt = fl && fl.picks && fl.picks.target ? unitById(fl.picks.target) : t;
      if (!tgt) { lines.push("先选黄金时间的目标。"); return paintSkillLog(lines.join("\n")); }
      const keys = goldKeys(tgt);
      const key = fl && fl.picks && keys.indexOf(fl.picks.status) >= 0 ? fl.picks.status : keys[0];
      if (!key) lines.push(`${tgt.name} 身上没有可以延长的即时效果。`);
      else if (!roleSpend(a, "role_gold")) lines.push("黄金时间次数用尽。");
      else {
        tgt.instant = tgt.instant || {};
        tgt.instant.goldHold = key;   // 记下延长的是哪一种（按真值判断的地方照旧能用）
        lines.push(`${tgt.name} 的${INSTANT_NAME[key]}将延长一回合。`);
      }
    } else if (id === "role_rally") {
      if (!roleSpend(a, "role_rally")) lines.push("全队集结本次长休已用过。");
      else {
        a.resources.rallyOn = true;
        fieldUnits().filter(u => u.isPlayer && Number(u.zone) === Number(a.zone)).forEach(u => applyRallyBuff(u, lines));
        lines.push("全队集结：同区队员获得主职责增益，直到你晕眩或濒死。");
      }
    } else if (id === "role_firstaid") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const n = addedDiceByLevel(a.level);
      const bonus = 1 + n;
      const healR = takeDice(n, 4, bonus);
      let heal = healR.total;
      lines.push(`应急处理掷骰 ${healR.text}`);
      if (totalHp(t) * 2 <= totalMaxHp(t)) heal = n * 4 + bonus;
      healUnit(t, heal);
      lines.push(`应急处理：${t.name} 恢复 ${heal}。`);
    } else if (id === "role_cover") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      t.coverBy = a.id;
      lines.push(`掩护：此回合为 ${t.name} 免费自动协助格挡。`);
    } else if (id === "role_pull") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      displaceTo(t, a.zone, lines, "被拉拽");
    } else if (id === "kolt_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const bit = (findKit("kolt", state.units) || a).resources.bit || "drill";
      if (bit === "acid") hitOne(a, t, { element: "acid", mult: 1, baseBreak: 1, atk, atkRange: "ranged" });
      else hitOne(a, t, { element: "electric", mult: 0.3, hitMults: [0.3, 0.3, 0.4], hits: 3, baseBreak: 2, breakOnce: true, atk, atkRange: "melee" });
    } else if (id === "kolt_swap" || id === "torque_swap") {
      const next = swapKoltBit(a, lines);
      // 拆装部件换了刀头 → 柯尔特的被动「更换刀头」照样触发一次切刀追击（同区一名敌人，0.5×atk / 被动+ 0.75×atk）
      if (id === "torque_swap") {
        const k = findKit("kolt", state.units);
        const st = state.skillFlow && state.skillFlow.picks && state.skillFlow.picks.swapTarget ? unitById(state.skillFlow.picks.swapTarget) : null;
        if (k && st && !st.dead && Number(st.zone) === Number(k.zone) && (typeof passiveOn !== "function" || passiveOn(k))) {
          const mult = typeof passivePlus === "function" && passivePlus(k, 1) ? 0.75 : 0.5;
          lines.push(`更换刀头：${k.name} 切刀追击 ${st.name}。`);
          hitOne(k, st, { element: next === "acid" ? "acid" : "electric", mult, baseBreak: 0, atk: effectiveAtk(k, state.units), atkRange: "melee", flags: { action: true, blockResolved: true, flyFree: true } });
        }
      }
      // 走了分步就只认分步里选的目标（拆装部件第二步可以不选；不能把第一步追击选的敌人当成它的目标）
      const fl = state.skillFlow;
      const tgt = fl && fl.picks ? (fl.picks.target ? unitById(fl.picks.target) : null) : t;
      if (tgt) {
        // 柯尔特被动「更换刀头」：不管换成哪种刀头，都打同区域（近距离）的敌人，0.5×atk。
        // 扭矩的「拆装部件」：按换上去的刀头的对应距离打（电钻同区 / 酸液炮距离 1），1×atk + 1 击破
        const ele = next === "acid" ? "acid" : "electric";
        if (id === "kolt_swap") hitOne(a, tgt, { element: ele, mult: typeof passivePlus === "function" && passivePlus(a, 1) ? 0.75 : 0.5, baseBreak: 0, atk, atkRange: "melee" });
        else hitOne(a, tgt, { element: ele, mult: 1, baseBreak: 1, atk, atkRange: next === "acid" ? "ranged" : "melee" });
      } else if (id === "torque_swap") {
        lines.push(next === "acid" ? "距离 1 没有选目标，只更换刀头。" : "同区没有选目标，只更换刀头。");
      }
      if (id === "torque_swap") lines.push(...returnWeapon(a));
    } else if (id === "kolt_short") {
      const fl = state.skillFlow;
      const dest = fl && fl.picks.dest != null ? Number(fl.picks.dest) : a.zone;
      if (dest !== Number(a.zone)) a.zone = dest;
      const ferr = setZoneField(a.zone, "electric", { by: a.id });
      if (ferr) lines.push(ferr);
      else lines.push(`${a.zone} 区变为高压场地。`);
    } else if (id === "kolt_chase") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      t.statuses = t.statuses || {};
      t.statuses.chase = true;
      // 记下是谁施加的：目标移动时，施加者自动跟到目标所在的区域
      t.chasers = (t.chasers || []).filter(id => id !== a.id).concat(a.id);
      popStatus(t, "chase");
      lines.push(`${t.name} 被 ${a.name} 紧追：它移动时，${a.name} 会自动跟上。`);
    } else if (id === "kolt_scrap") {
      const rec = state.lastBrokenLayer;
      const hp0 = totalHp(a);
      const grant = (type, amt, from) => {
        if (amt <= 0) return;
        if (type === "flesh" || type === "spirit") {
          healUnit(a, amt);
          lines.push(`${from}：恢复 ${amt} 生命（来自${LAYER[type] || type}）。`);
        } else {
          addTempLayer(a, type, amt);
          lines.push(`${from}：获得 ${amt} 点${LAYER[type] || type}（战斗结束消失）。`);
        }
      };
      // 获得上一个被摧毁的敌人血量层等量的对应血量，最多为柯尔特生命上限的 50%（腐坏抛射的记录不算在内）
      if (!rec) lines.push("本场还没有被摧毁的敌人血量层。");
      else {
        const cap = koltScrapCap(a);
        const amt = Math.min(Math.floor(Number(rec.lost) || 0), cap);
        grant(rec.type, amt, "废物利用");
        if ((Number(rec.lost) || 0) > cap) lines.push(`（那一层有 ${Math.floor(rec.lost)}，按生命上限一半封顶为 ${cap}）`);
        state.lastBrokenLayer = null;   // 这一层已经利用过了：要等下一个被摧毁的层
      }
      // 腐坏抛射留下的腐蚀记录：这一次废物利用一起领取，然后清空
      const rot = (a.resources && a.resources.rotStore) || {};
      Object.keys(rot).forEach(type => grant(type, Math.floor(Number(rot[type]) || 0), "腐坏回收"));
      if (a.resources) a.resources.rotStore = {};
      // 扭矩「转移注意」失去的装甲：额外获得等量装甲
      if (a.resources && (Number(a.resources.divertArmor) || 0) > 0) {
        grant("armor", Math.floor(Number(a.resources.divertArmor)), "扭矩回收");
        a.resources.divertArmor = 0;
      }
      // 扭矩「拆卸模式」变成废料的外层血量：按被拆下的那一层的种类领取（不受 50% 限制），然后清空
      const strip = (a.resources && a.resources.stripStore) || {};
      Object.keys(strip).forEach(type => grant(type, Math.floor(Number(strip[type]) || 0), "拆卸回收"));
      if (a.resources) a.resources.stripStore = {};
      // 废物利用给自己回的血 / 加的层也算治疗（一般的治疗只统计给其他友方的）
      const gain = totalHp(a) - hp0;
      const st = gain > 0 ? battleStat(a) : null;
      if (st) { st.heal += gain; addScore("heal", gain * SCORE_RULES.heal, a); }
    } else if (id === "kolt_rot") {
      // 腐坏抛射：酸液炮模式，对 1 距离的敌人施加腐蚀（不造成伤害）；这份腐蚀造成的伤害记给下一次废物利用
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (t.isPlayer || zoneDist(Number(a.zone), Number(t.zone), state.zoneMode) !== 1) {
        lines.push("腐坏抛射只能打距离 1 的敌人。");
        return paintSkillLog(lines.join("\n"));
      }
      t.statuses = t.statuses || {};
      t.statuses.corr = true;
      t.rotBy = a.id;
      if (typeof popStatus === "function") popStatus(t, "corr");
      lines.push(`腐坏抛射：${t.name} 被腐蚀。这份腐蚀造成的伤害会记下来，下一次废物利用时转为柯尔特的对应生命。`);
      // 不造成伤害，但仍是指向敌人的单体攻击：照样触发「过度自信」的嘲讽
      if (typeof passiveOn !== "function" || passiveOn(a)) {
        t.tauntTo = a.id;
        lines.push(`过度自信：${t.name} 被嘲讽，下次攻击必须打柯尔特。`);
      }
    } else if (id === "kolt_mod") {
      // 「非法」改装：电钻模式，对 1 距离内任意单位施加过载。
      // 废料达到上限、目标是我方单位时，分步里可以选再消耗等于上限的废料，让目标 +1 行动点（skillTargetError 已经查过能不能选）
      const fl = state.skillFlow;
      const tgt = fl && fl.picks && fl.picks.target ? unitById(fl.picks.target) : t;
      if (!tgt) { lines.push("先在「技能目标」里选对象。"); return paintSkillLog(lines.join("\n")); }
      applyInstantEffect(tgt, "overload", lines);
      lines.push(`「非法」改装：${tgt.name} 过载。`);
      const k = findKit("kolt", state.units) || a;
      if (fl && fl.picks && fl.picks.mode === "ap" && tgt.isPlayer && koltScrapFull(k)) {
        const cost = koltScrapSpend(k, koltScrapCap(k));
        lines.push(`「非法」改装：消耗 ${cost} 废料（还剩 ${koltScrapTotal(k)}）。`);
        grantAllyAp(a, tgt, KOLT_SCRAP.modAp, lines);   // 满了也加（可以超过上限）；用它打出的分数一半记给柯尔特，和意式浓缩一样
      }
    } else if (id === "kolt_cannon") {
      // 碎渣重炮：把全部废料装填进武器。电钻 → 机枪：选距离 1 以内的一个区域，每颗子弹（扭矩atk/3 + 1d10）电击、
      // 各自独立掷骰，打那一区的随机敌人；最后不够一颗的废料也打成一发；每 2 颗 1 击破。每颗都算单体攻击（吃过度自信的嘲讽）。
      // 酸液炮 → 迫击炮（距离 1-2，越墙；主目标算单体攻击）：废料量的酸 +2 击破，同区其他敌人 1/3 溅射；主目标损失超过上限 25% 的血量再 +2 击破
      const acid = (a.resources && a.resources.bit) === "acid";
      const flc = state.skillFlow;
      const mt = acid ? ((flc && flc.picks && flc.picks.target ? unitById(flc.picks.target) : null) || t) : null;
      if (acid && (!mt || mt.isPlayer)) { lines.push("先选迫击炮的目标。"); return paintSkillLog(lines.join("\n")); }
      const zone = flc && flc.picks && flc.picks.dest != null ? Number(flc.picks.dest) : (t ? Number(t.zone) : Number(a.zone));
      let pool = koltScrapTotal(a);
      koltScrapClear(a);
      if (pool <= 0) { lines.push("没有废料可以装填。"); return paintSkillLog(lines.join("\n")); }
      lines.push(`碎渣重炮：装填 ${pool} 点废料。`);
      if (acid) {
        const mx = totalMaxHp(mt), hp0 = totalHp(mt);
        const cut = weaponHalved("torque") ? 0.5 : 1;   // 扭矩倒下过：碎渣重炮总伤害 −50%
        hitOne(a, mt, { element: "acid", mult: cut, atk: pool, baseBreak: 2, atkRange: "any", flags: { action: true, lob: true } });
        const lost = hp0 - (mt.dead ? 0 : totalHp(mt));
        if (!mt.dead && lost > mx * 0.25) {
          lines.push(`迫击炮重创：${mt.name} 损失 ${lost}（超过上限 ${mx} 的 25%），额外 2 击破。`);
          dealBreak(mt, 2, "acid", lines, "碎渣重炮", { by: a });
        }
        const splash = Math.floor(pool / 3);
        if (splash > 0) visibleEnemies(mt.zone).filter(u => u !== mt && !u.dead).forEach(u => {
          hitOne(a, u, { element: "acid", mult: cut, atk: splash, baseBreak: 0, atkRange: "any", usePrep: false, flags: { action: true, aoe: true, lob: true } });
        });
      } else {
        const torq = findKit("torque", state.units);
        const tAtk = torq ? (Number(torq.atk) || 0) : (Number(a.weaponAtk) || 0);
        let n = 0;
        const hitIds = new Set();
        lines.push(`机枪扫射 ${zone} 区。`);
        // 扫射自己所在的区、里面有飞行的敌人：近程打飞行要额外 1 附赠行动——整轮扫射算一次攻击，只付一次
        // （以前每颗子弹打到一个新的飞行敌人就各付一次，附赠付光后打到飞行敌人的子弹全部作废）；付不起就这一轮不打飞行的
        let skipFly = false;
        const flyers = Number(zone) === Number(a.zone) && !a.flying ? visibleEnemies(zone).filter(u => !u.dead && u.flying) : [];
        if (flyers.length) {
          state.flyPaid = state.flyPaid || {};
          const unpaid = flyers.filter(u => !state.flyPaid[a.id + ">" + u.id]);
          if (unpaid.length && (Number(a.bonus) || 0) >= 1) {
            a.bonus -= 1;
            scoreSpend(a, 0, 1);
            lines.push(`扫射同区飞行中的敌人：整轮额外消耗 1 附赠行动。`);
          } else if (unpaid.length) {
            skipFly = true;
            lines.push(`附赠行动不足：这一轮不打同区飞行中的敌人。`);
          }
          if (!skipFly) flyers.forEach(u => { state.flyPaid[a.id + ">" + u.id] = true; });
        }
        while (pool > 0 && n < 300) {
          // 每一颗子弹打选中区域里的一个随机敌人（每颗都是单体攻击：照样触发过度自信的嘲讽）
          // 说明里写「随机」，实际先保证区里每个敌人都挨到一颗（在还没挨过的里随机），都挨过之后才完全随机
          const alive = visibleEnemies(zone).filter(u => !u.dead && !(skipFly && u.flying));
          const fresh = alive.filter(u => !hitIds.has(u.id));
          const from = fresh.length ? fresh : alive;
          const cur = from[Math.floor(Math.random() * from.length)];
          if (cur) hitIds.add(cur.id);
          if (!cur) { lines.push(`${zone} 区没有敌人了，剩下的 ${pool} 点废料没打出去。`); break; }
          const roll = takeDice(1, 10, 0);
          const per = Math.floor(tAtk / 3) + roll.total;
          const dmg = Math.min(pool, per);
          pool -= dmg; n += 1;
          // 扭矩倒下过：子弹数照原来的 atk 算，每颗伤害减半（总伤害 −50%）
          hitOne(a, cur, { element: "electric", mult: weaponHalved("torque") ? 0.5 : 1, atk: dmg, baseBreak: n % 2 === 0 ? 1 : 0, atkRange: "any", usePrep: n === 1, flags: { action: true } });
        }
        lines.push(`碎渣重炮：共打出 ${n} 颗子弹。`);
      }
    } else if (id === "kolt_summon") {
      const w = spawnWeapon(a, "torque");
      lines.push(w ? "扭矩已进入战场。" : "扭矩已在场。");
    } else if (id === "kolt_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      a.zone = t.zone;
      const bit = (a.resources && a.resources.bit) || "drill";
      hitOne(a, t, { element: bit === "acid" ? "acid" : "electric", mult: 1, baseBreak: 0, atk, flags: { action: true, assist: true } });
      queueKoltSwap(a);
      lines.push("可选择是否更换刀头。");
    } else if (id === "torque_boost") {
      const bit = ((findKit("kolt", state.units) || {}).resources || {}).bit || "drill";
      const fl = state.skillFlow;
      if (bit === "acid") {
        const dest = fl && fl.picks.dest != null ? Number(fl.picks.dest) : null;
        if (dest == null) { lines.push("先选蓄力区域。"); return paintSkillLog(lines.join("\n")); }
        a.resources.acidCharge = dest;
        lines.push(`酸液炮蓄力：下回合开始时对 ${dest} 区爆发。`);   // releaseAcidCharges 在回合开始（敌人回合打完之后）结算
      } else {
        const dest = fl && fl.picks.dest != null ? Number(fl.picks.dest) : null;
        if (dest == null) { lines.push("先选突进终点。"); return paintSkillLog(lines.join("\n")); }
        a.zone = dest;
        const foes = visibleEnemies(dest);
        const picked = fl && fl.picks.target ? unitById(fl.picks.target) : null;
        const tgt = (picked && foes.includes(picked)) ? picked : (t && Number(t.zone) === dest && foes.includes(t) ? t : foes[0]);
        if (!tgt) lines.push("终点没有敌人。");
        else {
          // 电钻：1d4+1 次 0.5atk 电击，共 2 击破
          const r = takeDice(1, 4, 1);
          lines.push(`电钻突进：攻击 ${r.text} 次。`);
          hitOne(a, tgt, { element: "electric", mult: 0.5, hits: r.total, baseHits: r.total, baseBreak: 2, breakOnce: true, atk });
        }
      }
    } else if (id === "torque_strip") {
      const fl = state.skillFlow;
      const tgt = (fl && fl.picks.target) ? unitById(fl.picks.target) : t;
      // 分步里选了「变成废料」：拆下的外层血量记给柯尔特，不用选接收的友方（没选的旧命令照旧给友方）
      const kolt = findKit("kolt", state.units);
      const toScrap = !!(fl && fl.picks.mode === "scrap" && kolt);
      const ally = (fl && fl.picks.ally) ? unitById(fl.picks.ally) : null;
      if (!tgt || (!ally && !toScrap)) { lines.push("先选拆卸目标和接收友方。"); return paintSkillLog(lines.join("\n")); }
      const stunnedBefore = !!tgt.stunned;
      dealBreak(tgt, 2, "electric", lines, "拆卸");
      // 拆卸是对一个敌人的单体攻击：照样触发柯尔特「过度自信」的嘲讽（击破不走 dealTo，要单独加）
      if (!tgt.isPlayer && !tgt.dead && (typeof passiveOn !== "function" || passiveOn(kolt || a))) {
        tgt.tauntTo = (kolt || a).id;
        lines.push(`过度自信：${tgt.name} 被嘲讽，下次攻击必须打柯尔特。`);
      }
      // 卡面：这次攻击行动造成失衡才提升到 1.5×；本来就失衡的不算
      const brokeNow = brokeInto(tgt, stunnedBefore);
      const amount = Math.floor(atk * (brokeNow ? 1.5 : 1));
      const outer = (tgt.layers || []).find(l => (l.current || 0) > 0);
      if (outer) {
        const take = Math.min(amount, outer.current);
        outer.current -= take;
        if (toScrap) {
          // 单独计算、不受上限（和腐坏抛射、转移注意一样）：按那一层的种类记下，废物利用领对应血量，碎渣重炮一起装填
          kolt.resources = kolt.resources || {};
          const store = kolt.resources.stripStore = kolt.resources.stripStore || {};
          if (take > 0) store[outer.type] = (Number(store[outer.type]) || 0) + take;
          lines.push(`拆卸转移 ${take} 点${LAYER[outer.type] || outer.type}，变成柯尔特的废料（现在共 ${koltScrapTotal(kolt)}）。`);
        } else {
          addTempLayer(ally, outer.type, take);
          lines.push(`拆卸转移 ${take} 点${LAYER[outer.type] || outer.type}给 ${ally.name}。`);
        }
        // 抽空了最内层：敌人照常被击杀（以前直接改血量不走击杀结算，0 血还能继续行动）
        if (!tgt.isPlayer && !tgt.dead && isInnerDepleted(tgt)) {
          tgt._lastHitBy = a.id;
          settleEnemyKill(tgt, lines);
          lines.push(`${tgt.name} 被拆卸抽空，倒下。`);
        }
      }
    } else if (id === "torque_divert") {
      // 转移注意：全场被嘲讽的单位改打扭矩；扭矩进入自保（受伤 −25%，架势不低于 1），下回合开始变回武器
      const taunted = (state.units || []).filter(u => u.tauntTo && !u.dead && u.id !== a.id);
      taunted.forEach(u => { u.tauntTo = a.id; });
      lines.push(taunted.length ? `转移注意：${taunted.map(u => u.name).join("、")} 改为攻击扭矩。` : "转移注意：场上没有被嘲讽的单位。");
      a.resources.divertGuard = true;
      a.resources.divertArmor0 = (a.layers || []).filter(l => l.type === "armor").reduce((s, l) => s + (Number(l.current) || 0), 0);
      lines.push("扭矩缩成一团进入自保：受到的伤害 −25%，架势不会低于 1。下回合开始变回武器。");
    } else if (id === "torque_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "helu_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "harmonic", mult: 1, baseBreak: 1, atk, atkRange: "ranged" });
    } else if (id === "helu_wave") {
      if (state.weather !== "phase") {
        const err = setWeather("phase", { by: a.id });
        if (err) lines.push(err);
        else {
          // 相位计数器从第一次释放起一直在走（被覆盖也不停），再次释放接入当前计数，不归零
          const resume = !!state.phaseClock;
          if (!resume) state.phaseStep = 0;
          state.phaseClock = true;
          lines.push(resume ? `驻波：战场重新进入相位天气，接入当前计数（${phaseWeatherName(state.phaseStep)}）。` : "驻波：战场进入相位天气。");
        }
      } else if (a.resources && a.resources.scanned) {
        lines.push(...advancePhaseWeather());
      } else lines.push("尚未完成回波探测，无法推进相位。");
    } else if (id === "helu_storm") {
      // 大气干扰：进入沙暴；已经分析过战场（用过环境扫描）时，沙暴中再用可以调转风向
      if (state.weather !== "sand") {
        const err = setWeather("sand", { casterZone: a.zone, by: a.id });
        lines.push(err || `大气干扰：战场进入沙暴，风向 ${sandDirText(state.sandDir, state.zoneMode)}。`);
      } else if (a.resources && a.resources.scanned) {
        if (state.weatherLock) lines.push(`天气被「${state.weatherLock}」锁定，无法调转风向。`);
        else {
          state.sandDir = reverseSandDir(state.sandDir);
          lines.push(`大气干扰：沙暴调转风向 → ${sandDirText(state.sandDir, state.zoneMode)}。`);
        }
      } else lines.push("尚未分析当前战场（环境扫描），无法调转风向。");
    } else if (id === "helu_scan") {
      const fl = state.skillFlow;
      a.resources.scanned = true;
      heluScanAct(a, Object.assign({}, (fl && fl.picks) || {}), lines);
    } else if (id === "helu_rule") {
      // 规则干涉：选的区变成干涉场；分析过战场、并且干涉场取代了别的场地 → 同区自选的一个单位（敌我都行）立刻 +1 附赠动作，可以超过上限
      const fl = state.skillFlow, p = (fl && fl.picks) || {};
      const z = Number(p.dest);
      const replaced = heluRuleReplaced(z);
      const wasHarm = !!(state.fields[z] || {}).harmonic;
      const bonusOk = heluRuleBonusOk(a, z);   // 改之前看：改完就没有「被取代的场地」了
      const ferr = setZoneField(z, "harmonic", { by: a.id });
      if (ferr) lines.push(ferr);
      else {
        lines.push(`规则干涉：${z} 区${replaced.length ? `的${replaced.join("、")}被取代，` : ""}变成干涉场。`);
        if (!replaced.length) lines.push(`${z} 区${wasHarm ? "本来就是干涉场" : "原本没有场地"}，没有取代别的场地：不给附赠动作。`);
        else if (!bonusOk) lines.push("还没分析过当前战场（环境扫描）：不给附赠动作。");
        else {
          const tg = p.target ? unitById(p.target) : t;
          if (tg && heluRuleUnits(z).includes(tg)) {
            tg.bonus = (Number(tg.bonus) || 0) + HELU_RULE.bonus;   // 可以超过上限（bonusMax 不动，画面按 max(上限, 现有) 画）
            lines.push(`干涉场取代了别的场地：${tg.name} 立刻获得 ${HELU_RULE.bonus} 个附赠动作（可以超过上限），现在 ${tg.bonus} 个。`);
          } else lines.push(`${z} 区没有可以获得附赠动作的单位。`);
        }
      }
    } else if (id === "helu_forge") {
      // 频域造物：在选的间隙创造驻波墙（不挡移动，暂时取代原来的配置物），这一整轮结束时消失（expireWaveWalls）
      const fl = state.skillFlow, p = (fl && fl.picks) || {};
      const werr = placeWaveWall(p.gap, p.element, p.mode, a.id, lines);
      if (werr) lines.push(werr);
    } else if (id === "helu_summon") {
      const w = spawnWeapon(a, "ecmo");
      lines.push(w ? "Ecmo/7418 已进入战场。" : "Ecmo 已在场。");
    } else if (id === "helu_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "harmonic", mult: 1, baseBreak: 0, atk, flags: { action: true, assist: true }, atkRange: "any" });
      // 已有聚焦：直接推进序列一次；没有就对一种血量层造成聚焦
      if (!t.dead && (t.focuses || []).length) {
        t.focuses.slice().forEach(f => stepFocus(t, f, lines, "协助攻击"));
      } else if (!t.dead) {
        const layer = ((t.layers || []).find(l => (l.current || 0) > 0) || {}).type;
        applyFocus(t, layer, lines);
      }
      // 再对这个敌人所在的区做一次环境扫描（不耗行动，也不算本场那次主动扫描）
      queueHeluScan(a, t.zone, lines);
    } else if (id === "ecmo_bite") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const beforeStun = !!t.stunned;
      hitOne(a, t, { element: "physical", mult: 1, baseBreak: 1, atk });
      if (brokeInto(t, beforeStun)) {
        a.ap = (a.ap || 0) + 1;
        lines.push("叮咬造成失衡，返还 1 行动点。");
      }
    } else if (id === "ecmo_focus") {
      const fl = state.skillFlow;
      const tgt = (fl && fl.picks.target) ? unitById(fl.picks.target) : t;
      if (!tgt) { lines.push("先选聚焦目标。"); return paintSkillLog(lines.join("\n")); }
      applyFocus(tgt, fl && fl.picks.layer, lines);
    } else if (id === "ecmo_boom") {
      visibleEnemies(a.zone).forEach(u => {
        const focused = (u.focuses || []).some(f => f.layerType && (u.layers || []).some(l => l.type === f.layerType && l.current > 0));
        hitOne(a, u, { element: "harmonic", mult: 0.5, hits: focused ? 2 : 1, baseBreak: 0, atk, flags: { action: true, aoe: true } });
      });
      // 触发所有同区域配置物：和 Helumica 环境扫描触发配置物一样（heluScanAct）——
      // 爆炸桶 / 酸液桶直接引爆、电池引爆、碎渣机炮打一名打得到的敌人、炮台向 Ecmo 的敌人开一炮、按钮 / 拉杆触发一次
      ecmoBoomTriggerProps(a, lines);
    } else if (id === "ecmo_probe") {
      a.resources.probe = true;
      a.resources.probeZones = [Number(a.zone)];
      lines.push("探测模式：移动不消耗附赠动作，每回合开始扫描所在区；变回武器时触发经过的每个区的一个配置物。");
    } else if (id === "ecmo_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "ras_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      // 两次 0.5atk 能量，共 1 击破；不稳时次数翻倍，额外击破按比例算（共 2）
      const times = (a.resources && a.resources.unstable) ? 4 : 2;
      hitOne(a, t, { element: "energy", mult: 0.5, hits: times, baseHits: 2, baseBreak: 1, breakOnce: true, atk, atkRange: "ranged" });
      addRasEnergy(20, "普通攻击");
    } else if (id === "ras_dump") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      t.statuses = t.statuses || {};
      t.statuses.high = true;
      tagHighFrom(t, "ras");
      popStatus(t, "high");
      convertRasLight(20);
      lines.push(`${t.name} 被施加高能。`);
    } else if (id === "ras_flee") {
      const fl = state.skillFlow;
      const dest = fl && fl.picks.dest != null ? Number(fl.picks.dest) : null;
      const tgt = (fl && fl.picks.target) ? unitById(fl.picks.target) : t;
      const from = a.zone;
      if (dest == null) { lines.push("先选逃离终点。"); return paintSkillLog(lines.join("\n")); }
      // 技能说明的顺序：移动 → 累积 20% 能量 → 对「原区域」的一名敌人出手。
      // 这一击按远距离攻击判定（atkRange: "ranged"：高地、协助格挡、近程打飞行等都按远程算）；
      // 目标限定在原区域（出手前选定、这里再核对），所以不再按「距离 1」卡射程（skillRange：不稳态走远了也打得到原区域）
      const inFrom = !!(tgt && Number(tgt.zone) === Number(from));
      a.zone = dest;
      lines.push(`逃离：从 ${from} 区到 ${dest} 区。`);
      addRasEnergy(20, "逃离");
      if (inFrom) hitOne(a, tgt, { element: "electric", mult: 1, baseBreak: 0, atk, atkRange: "ranged", flags: { action: true, skillRange: true } });
      else if (tgt) lines.push(`${tgt.name} 不在原区域，打不到。`);
    } else if (id === "ras_rampage") {
      // 失控暴走：累积 40% 能量；因此进入不稳态 → 同区变能量场；本来就在不稳态 → 全场所有区域变能量场
      const wasUnstable = !!(a.resources && a.resources.unstable);
      addRasEnergy(40, "失控暴走");
      const zones = [];
      if (wasUnstable) for (let z = 1; z <= Number(state.zoneMode || 2); z++) zones.push(z);
      else if (a.resources && a.resources.unstable) zones.push(Number(a.zone));
      if (!zones.length) lines.push("失控暴走：累积 40% 能量（未进入不稳态）。");
      else {
        lines.push(wasUnstable ? "失控暴走：已在不稳态，全场所有区域变为能量场！" : `失控暴走：进入不稳态，${a.zone} 区变为能量场。`);
        zones.forEach(z => { const err = setZoneField(z, "energy", { by: a.id }); if (err) lines.push(err); });
      }
    } else if (id === "ras_super") {
      // 不稳超导：转换 20% 累积能量为光能，给自己施加导体；不稳态下免费（skillCost）
      convertRasLight(20);
      a.self = "conductor";
      if (typeof spawnPopup === "function") spawnPopup(a, { kind: "status", text: "导体", element: "electric" });
      lines.push("不稳超导：转换 20% 累积能量为光能，自身获得导体效果。");
    } else if (id === "ras_torrent") {
      // 狂瀑：能量直接累积到 100%，每累积 20% 对高能目标打一次 0.2atk 能量，自己失去 10% 血量（不算受到伤害，最少留 1）
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const steps = Math.max(0, Math.floor((100 - (Number(a.resources.energyPct) || 0)) / 20));
      const loseHp = (u, amt) => {
        let left = Math.min(amt, Math.max(0, totalHp(u) - 1));
        const took = left;
        (u.layers || []).forEach(l => { const d = Math.min(left, Number(l.current) || 0); l.current -= d; left -= d; });
        return took;
      };
      for (let i = 0; i < steps && !t.dead; i++) {
        addRasEnergy(20, "狂瀑");
        hitOne(a, t, { element: "energy", mult: 0.2, baseBreak: 0, atk, atkRange: "any", usePrep: i === 0 });
        const lost = loseHp(a, Math.ceil(totalMaxHp(a) * 0.1));
        lines.push(`狂瀑：拉斯缪尔失去 ${lost} 血量。`);
      }
      const now = Number(a.resources.energyPct) || 0;
      if (now < 100) addRasEnergy(100 - now, "狂瀑");
      if (!steps) lines.push("累积能量已经满了，狂瀑没有额外的攻击。");
    } else if (id === "ras_summon") {
      const w = spawnWeapon(a, "edc");
      lines.push(w ? "EDC30k 已进入战场。" : "EDC30k 已在场。");
    } else if (id === "ras_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const light = (a.resources && a.resources.light) || 0;
      const hits = (a.resources && a.resources.unstable) ? 4 : 2;
      hitOne(a, t, { element: "energy", mult: 0.5, hits, baseHits: 2, baseBreak: 0, atk, flags: { action: true, assist: true }, atkRange: "any" });
      if (light > 0) {
        hitOne(a, t, { element: "energy", mult: 0, flat: light, baseBreak: 0, atk: 0, flags: { action: true, assist: true } });
        a.resources.light = 0;
        lines.push(`光能全部打出 ${light}。`);
      }
    } else if (id === "edc_drain") {
      const ras = findKit("ras", state.units);
      if (!ras) lines.push("拉斯缪尔不在场。");
      else convertRasLight(ras.resources.energyPct || 0, ras.resources.unstable ? 0.25 : 0);
    } else if (id === "edc_shock") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "electric", mult: 1, baseBreak: 1, atk, atkRange: "ranged" });   // 距离 1 的敌人
      const ras = findKit("ras", state.units);
      const light = ras && ras.resources ? (ras.resources.light || 0) : 0;
      if (light > 0) {
        hitOne(a, t, { element: "electric", mult: 0, flat: light, baseBreak: 1, atk: 0, atkRange: "ranged" });
        ras.resources.light = 0;
        lines.push(`追加光能电击 ${light}。`);
      }
    } else if (id === "edc_flash") {
      const ras = findKit("ras", state.units);
      const light = ras && ras.resources ? (ras.resources.light || 0) : 0;
      if (light <= 0) lines.push("没有光能。");
      else {
        visibleEnemies(a.zone).forEach(u => hitOne(a, u, { element: "electric", mult: 0, flat: Math.floor(light / 2), baseBreak: 1, atk: 0, flags: { action: true, aoe: true } }));
        ras.resources.light = 0;
        lines.push(`爆闪释放光能 ${light}。`);
      }
    } else if (id === "edc_siphon") {
      // 汲取：拉斯缪尔每回合结束自动把 20% 累积能量转光能，EDC 变回武器；生效中再用（免费）结束汲取
      const ras = findKit("ras", state.units);
      if (!ras) lines.push("拉斯缪尔不在场。");
      else if (ras.resources && ras.resources.siphon) {
        ras.resources.siphon = false;
        lines.push("汲取结束。");
      } else {
        ras.resources = ras.resources || {};
        ras.resources.siphon = true;
        lines.push("汲取：拉斯缪尔每回合结束时自动把 20% 累积能量转为光能。");
        lines.push(...returnWeapon(a));
      }
    } else if (id === "edc_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "longge_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (longgeMode(a) === "gun") {
        const c = longgeTakeBullet(a, lines);
        const near = Number(t.zone) === Number(a.zone);
        // 开枪不是近身挥打：近距离打飞行目标也不用多付附赠行动（和出手前的检查一致）
        hitOne(a, t, { element: LONGGE_AMMO[c].element, mult: 1.5, baseBreak: 1, atk, atkRange: near ? "melee" : "ranged", flags: { action: true, flyFree: true } });
        // 枪管手杖+：近距离打出火弹，同区其他敌人各受 0.75×atk 火焰
        if (near && c === "red") {
          const others = visibleEnemies(a.zone).filter(u => u.id !== t.id);
          if (others.length) lines.push("近距离火弹：火焰溅到同区其他敌人。");
          others.forEach(u => hitOne(a, u, { element: "fire", mult: 0.75, baseBreak: 0, atk, flags: { action: true, aoe: true }, usePrep: false }));
        }
      } else {
        hitOne(a, t, { element: "ice", mult: 1, baseBreak: 1, atk, atkRange: "melee" });
        longgePeek(a, 1, lines);   // 手杖普攻：窥探 1
      }
    } else if (id === "longge_chill") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (longgeMode(a) === "gun") {
        const c = longgeTakeBullet(a, lines);
        if (c === "blue") {
          lines.push(`冷气穿刺（霰弹枪 · 蓝弹）：${t.name} 获得刺骨。`);
          applyInstantEffect(t, "sting", lines);
          const allies = fieldUnits().filter(u => u.isPlayer && !u.dead && !u.hidden && !u.fused && Number(u.zone) === Number(t.zone));
          if (!allies.length) lines.push(`${t.zone} 区没有友方可以治疗。`);
          allies.forEach(u => longgeBulletHeal("blue", u, lines));
        } else {
          lines.push("冷气穿刺（霰弹枪 · 红弹）：子弹在半路爆开。");
          hitOne(a, t, { element: "fire", mult: 0.5, baseBreak: 0, atk, atkRange: "ranged" });
        }
      } else {
        lines.push(`冷气穿刺（手杖）：${t.name} 获得刺骨。`);
        applyInstantEffect(t, "sting", lines);
      }
    } else if (id === "longge_spit") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      // 种族特长「吐酸」：附赠动作，近距离，角色本身 atk（不算武器）的酸液伤害，一局战斗仅限一次；长休可以换属性（spitElement）
      a.resources.spitUsed = true;
      const ele = a.resources.spitElement || "acid";
      hitOne(a, t, { element: ele, mult: 1, baseBreak: 0, atk: Math.max(0, (a.personalAtk || 0) - ((typeof exhaustTierOf === "function" && exhaustTierOf(a) >= 2) ? 3 : 0)), atkRange: "melee" });
      lines.push("吐酸：本场战斗已用。");
    } else if (id === "longge_safety") {
      // 解开保险：解锁扳机；立刻查看最后一发子弹的颜色，可以选择把它移到队列最前方
      const r = longgeRes(a);
      longgeUnlock(a, lines, "解开保险");
      const n = r.ammo.length;
      if (n) {
        // 伤害预览（沙盒预演）里不真的查看：不记成看过、不写出颜色
        const sim = typeof window !== "undefined" && window.GAME && window.GAME.sim;
        if (!sim) { r.seen[n - 1] = true; longgeSyncKnown(r); }
        lines.push(sim ? "查看最后一发：出手后才知道颜色。" : `查看最后一发：${LONGGE_AMMO[r.ammo[n - 1]].name}。`);
        // 技能结算完（行动点已花掉）才问要不要移到最前：取消技能就看不到颜色
        if (n > 1) {
          state.longgeSafetyQueue = state.longgeSafetyQueue || [];
          state.longgeSafetyQueue.push({ actorId: a.id });
          lines.push("可以选择把它移到最前面。");
        }
      }
    } else if (id === "longge_summon") {
      const w = spawnWeapon(a, "xiaoxiao");
      lines.push(w ? "小朋友已进入战场。" : "小朋友已在场。");
    } else if (id === "longge_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const r = longgeRes(a);
      let mode = r.assistMode === "gun" ? "gun" : "cane";
      const healId = r.assistHeal || null;
      r.assistMode = null; r.assistHeal = null;
      longgeUnlock(a, lines, "协助攻击");
      if (mode === "gun" && !r.ammo.length) { lines.push("没有子弹，改用手杖。"); mode = "cane"; }
      if (mode === "cane") {
        if (Number(a.zone) !== Number(t.zone)) lines.push(`手杖：龙哥移动到 ${t.zone} 区。`);
        a.zone = t.zone;
        hitOne(a, t, { element: "ice", mult: 0.5, baseBreak: 0, atk, flags: { action: true, assist: true } });
        if (r.ammo.length) {
          // 治疗对象：自己选的同区友方（含自己）；没选或已经不在同区就给血量比例最低的
          const picked = healId ? unitById(healId) : null;
          const ok = picked && picked.isPlayer && !picked.dead && !picked.hidden && Number(picked.zone) === Number(a.zone);
          const c = longgeTakeBullet(a, lines);
          longgeBulletHeal(c, ok ? picked : longgeHealPick(a), lines);
        }
      } else {
        const c = longgeTakeBullet(a, lines);
        hitOne(a, t, { element: LONGGE_AMMO[c].element, mult: 1.5, baseBreak: 0, atk, flags: { action: true, assist: true } });
      }
      longgePeek(a, 2, lines);   // 无论哪种模式都窥探 2
    } else if (id === "longge_heat") {
      // 热能轰击：手杖 → 近距离敌人熔融；霰弹枪（近距离特殊射击）→ 红弹：同区所有敌人熔融、同区所有友方（含自己）按红弹治疗；
      // 蓝弹：子弹气化，同区所有友方各受 1 冰击破（可能被打进失衡，触发敌人的协助攻击）
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (longgeMode(a) === "gun") {
        const c = longgeTakeBullet(a, lines);
        const z = Number(a.zone);
        const allies = fieldUnits().filter(u => u.isPlayer && !u.dead && !u.hidden && !u.fused && Number(u.zone) === z);
        if (c === "red") {
          lines.push("热能轰击（霰弹枪 · 红弹）：子弹化作散射的火焰。");
          visibleEnemies(z).forEach(u => applyInstantEffect(u, "melt", lines));
          allies.forEach(u => longgeBulletHeal("red", u, lines));
        } else {
          lines.push("热能轰击（霰弹枪 · 蓝弹）：子弹瞬间气化。");
          allies.forEach(u => smashableBreak(a, u, 1, "ice", lines, "热能轰击（蓝弹气化）"));
        }
      } else {
        lines.push(`热能轰击（手杖）：${t.name} 熔融。`);
        applyInstantEffect(t, "melt", lines);
      }
    } else if (id === "longge_drink") {
      // 饮弹：枪口对准自己，消耗 1 发。蓝弹 → 霜结，并按蓝弹治疗自己；红弹 → 自己受 1×atk 火焰，返还行动点
      const c = longgeTakeBullet(a, lines);
      if (!c) lines.push("没有子弹了。");
      else if (c === "blue") {
        lines.push("饮弹（蓝弹）：进入霜结。");
        lines.push(...castSelfEffect(a, "frost", []));
        longgeBulletHeal("blue", a, lines);
      } else {
        lines.push("饮弹（红弹）：火焰灼身，行动点返还。");
        applyTypedDot(a, Math.max(1, Math.floor(atk)), "fire", lines, `${a.name} 饮弹（红弹）`);
        a.ap = (Number(a.ap) || 0) + (Number(skillCost(id).ap) || 1);
      }
    } else if (id === "longge_shuffle") {
      // 洗牌：剩下的子弹重新随机排列（看过的颜色作废）。连续 2 红：随机敌人 1×atk 火；连续 3 红再来一次。
      // 连续 2 蓝：治疗血量最低的队友（蓝弹治疗）；连续 3 蓝再治疗一名血量不满的队友。都没有就窥探 1
      const r = longgeRes(a);
      for (let i = r.ammo.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r.ammo[i], r.ammo[j]] = [r.ammo[j], r.ammo[i]]; }
      r.seen = r.ammo.map(() => false);
      r.shuffleLock = true;   // 洗过一次：子弹数量变动（开枪 / 消耗 / 换弹）之前不能再洗
      longgeSyncKnown(r);
      lines.push(`洗牌：剩下的 ${r.ammo.length} 发重新排列（之前看过的颜色作废）。`);
      const runOf = (color) => { let best = 0, cur = 0; r.ammo.forEach(c => { cur = c === color ? cur + 1 : 0; best = Math.max(best, cur); }); return best; };
      const redRun = runOf("red"), blueRun = runOf("blue");
      const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
      for (let k = 0; k < (redRun >= 3 ? 2 : redRun >= 2 ? 1 : 0); k++) {
        // 只在打得到的敌人里随机：距离 1 以内、不隔危墙 / 关着的门、没在躲藏（以前从全场随机，抽到射程外的就打空）
        const foes = fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && !u.fused && !(u.statuses && u.statuses.hide) && !u.submerged &&
          zoneDist(a.zone, u.zone, state.zoneMode) <= 1 && !lineBlocked(a.zone, u.zone));
        const f = pickRandom(foes);
        if (!f) { if (k === 0) lines.push("洗牌：连续红弹，但附近没有打得到的敌人。"); break; }
        lines.push(`洗牌：连续红弹，火焰打向 ${f.name}。`);
        // 火焰是子弹炸开的，打同区飞行敌人不用多付附赠行动
        hitOne(a, f, { element: "fire", mult: 1, baseBreak: 0, atk, atkRange: "any", flags: { action: true, flyFree: true }, usePrep: false });
      }
      for (let k = 0; k < (blueRun >= 3 ? 2 : blueRun >= 2 ? 1 : 0); k++) {
        const pals = fieldUnits().filter(u => u.isPlayer && !u.dead && !u.hidden && !u.fused);
        const ratio = u => totalHp(u) / Math.max(1, totalMaxHp(u));
        const target = k === 0 ? pals.slice().sort((x, y) => ratio(x) - ratio(y))[0] : pickRandom(pals.filter(u => totalHp(u) < totalMaxHp(u)));
        if (!target) break;
        lines.push(`洗牌：连续蓝弹，治疗 ${target.name}。`);
        longgeBulletHeal("blue", target, lines);
      }
      if (redRun < 2 && blueRun < 2) longgePeek(a, 1, lines);
    } else if (id === "longge_reload") {
      // 胶囊弹药+：子弹打光后花 1 行动点完全换弹，重新获得随机的 6 发
      const r = longgeRes(a);
      r.ammo = longgeAmmoFresh();
      r.seen = r.ammo.map(() => false);
      r.shuffleLock = false;
      longgeSyncKnown(r);
      lines.push("完全换弹：重新装上 6 发（顺序随机）。扳机要重新解锁。");
    } else if (id === "xiaoxiao_burst") {
      // 爆发治疗：消耗 3 发。全红 → 同区友方生命回满；全蓝 → 获得 2×（龙哥等级 + 5）临时护盾。
      // 不用先窥探；接下来 3 发不同色时技能失败，行动点白扣，子弹不消耗
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!t.isPlayer || Number(t.zone) !== Number(a.zone)) { lines.push("爆发治疗只能给同区的友方。"); return paintSkillLog(lines.join("\n")); }
      const nx = (longgeRes(a) || { ammo: [] }).ammo.slice(0, 3);
      const sim = typeof window !== "undefined" && window.GAME && window.GAME.sim;
      if (!sim && !(nx.length === 3 && nx.every(c => c === nx[0]))) {
        lines.push("爆发治疗失败：接下来 3 发子弹颜色不一样，行动点白白消耗（子弹没有消耗）。");
        return paintSkillLog(lines.join("\n"));
      }
      const shots = [longgeTakeBullet(a, lines), longgeTakeBullet(a, lines), longgeTakeBullet(a, lines)].filter(Boolean);
      if (shots.length === 3 && shots.every(c => c === "red")) {
        const got = healUnit(t, Math.max(0, totalMaxHp(t) - totalHp(t)));
        lines.push(`爆发治疗（全红）：${t.name} 生命回满（恢复 ${got}）。`);
      } else if (shots.length === 3 && shots.every(c => c === "blue")) {
        const lg = longgeOf();
        const amt = 2 * (((lg && lg.level) || 1) + 5);
        addShieldLayer(t, amt, false);
        lines.push(`爆发治疗（全蓝）：${t.name} 获得 ${amt} 点临时护盾。`);
      } else lines.push("三发子弹颜色不一样，爆发治疗没有效果。");
    } else if (id === "xiaoxiao_punch") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const c = longgeTakeBullet(a, lines);
      if (!c) lines.push("没有子弹了。");
      else hitOne(a, t, { element: LONGGE_AMMO[c].element, mult: 1, baseBreak: 2, atk, atkRange: "melee" });
    } else if (id === "xiaoxiao_combo") {
      // 连续拳：消耗 3 发。全红 → 升龙拳 3atk 火 +3 击破；全蓝 → 撼地拳 2atk 冰 +5 击破；
      // 其余：每发红弹 0.75atk 火，每发蓝弹 0.5atk 冰 +1 击破
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const shots = [longgeTakeBullet(a, lines), longgeTakeBullet(a, lines), longgeTakeBullet(a, lines)].filter(Boolean);
      if (shots.length < 3) lines.push("子弹不够 3 发。");
      else if (shots.every(c => c === "red")) {
        lines.push("全是红弹：升龙拳！");
        hitOne(a, t, { element: "fire", mult: 3, baseBreak: 3, atk, atkRange: "melee" });
      } else if (shots.every(c => c === "blue")) {
        lines.push("全是蓝弹：撼地拳！");
        hitOne(a, t, { element: "ice", mult: 2, baseBreak: 5, atk, atkRange: "melee" });
      } else {
        lines.push(`连续拳：${shots.map(c => LONGGE_AMMO[c].short).join("")}。`);
        shots.forEach((c, i) => {
          if (t.dead) return;
          hitOne(a, t, c === "red"
            ? { element: "fire", mult: 0.75, baseBreak: 0, atk, atkRange: "melee", usePrep: i === 0 }
            : { element: "ice", mult: 0.5, baseBreak: 1, atk, atkRange: "melee", usePrep: i === 0 });
        });
      }
    } else if (id === "xiaoxiao_heal") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!t.isPlayer || Number(t.zone) !== Number(a.zone)) { lines.push("治疗支援只能给同区的友方。"); return paintSkillLog(lines.join("\n")); }
      const c = longgeTakeBullet(a, lines);
      if (!c) lines.push("没有子弹了。");
      else longgeBulletHeal(c, t, lines);
      lines.push(...returnWeapon(a));
    } else if (id === "xiaoxiao_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "bare_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      // 硬骨头（feats.js）：空手攻击 +1 击破；自己的武器人在场时 1.5×atk
      const tough = typeof featHas === "function" && featHas(a, "tough");
      const wpnOut = tough && fieldUnits().some(u => u.isPlayer && u.weaponOf === a.kit && !u.dead && !u.hidden);
      hitOne(a, t, { element: "physical", mult: wpnOut ? 1.5 : 1, baseBreak: 0, atk, _bare: true });
      lines.push(`空手攻击：${wpnOut ? "1.5" : "1"}×atk 物理${tough ? "（硬骨头 +1 击破）" : ""}。`);
    } else if (id === "assist_block") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const chance = blockChance(a) || 0;
      const roll = 1 + Math.floor(Math.random() * 100);
      let ok = roll <= chance;
      if (!ok && a.kit === "tou" && (a.resources.shield || 0) > 0) {
        a.resources.shield -= 1; touShieldHeal(a);
        const roll2 = 1 + Math.floor(Math.random() * 100);
        ok = roll2 <= chance;
        lines.push(`格挡失败，消耗圣盾重掷 ${roll2}。`);
      }
      lines.push(`${a.name} 协助格挡 d100=${roll} / ${chance}% → ${ok ? "成功" : "失败"}`);
      if (a.kit === "ruby" && ok) { addNano(20); lines.push("纳米 +20。"); }
      if (a.kit === "mint" && ok) { addNano(20); lines.push("纳米 +20。"); }
      if (a.kit === "yuito") {
        if (ok) lines.push(beanToLiquid() ? "成功：豆→液。" : "成功但没有豆。");
        setBond(a, t);
        lines.push(`对 ${t.name} 施加牵挂。`);
      }
      if (a.kit === "hiaki") {
        const st = a.resources.stance || "draw";
        if (st === "iai") {
          lines.push("居合下协助格挡视为成功。");
          ok = true;
          setHiakiStance(a, "waki");
          lines.push("进入胁构。");
        } else if (st === "waki" && ok) {
          if (t) {
            /* reflect 1 break to attacker of the original hit: use skill target as the enemy if selected */
          }
          const enemy = t;
          // 走 dealBreak：打空照样失衡、触发协助攻击（以前直接改架势）
          if (enemy && !enemy.isPlayer) dealBreak(enemy, 1, "physical", lines, "胁构反伤", { by: a });
          setHiakiStance(a, "draw");
          lines.push("进入拔刀。");
        } else if (ok) {
          setHiakiStance(a, "iai");
          lines.push("进入居合。");
        }
      }
      if (a.kit === "tou" && ok) {
        const enemy = t;
        if (enemy) { a.zone = enemy.zone; lines.push("成功：灯移动到进攻者所在区。请把进攻者设为技能目标。"); }
      }
      if (a.kit === "mochi" && ok && t && !t.isPlayer) {
        t.noMove = true;
        t.noMoveUntil = (Number(state.turnNo) || 0) + (state.combatPhase === "enemy" ? 1 : 0);   // 咬住到下一个敌人回合结束
        lines.push(`${t.name} 被咬住，1 回合无法移动。`);
      }
      if (a.kit === "niu" && ok) lines.push(...returnWeapon(a));
      if (a.kit === "naruto" && ok) lines.push(...returnWeapon(a));
      const brSel = uiEl("blockResult");
      if (brSel) brSel.value = ok ? "assistOk" : "fail";
      lines.push("已把下方「格挡结果」设成对应项，可继续用手动攻击结算那一刀。");
    } else if (runEnemyAction(id, a, t, hitOne, lines, needT)) {
      /* handled */
    } else {
      lines.push("未实现的技能：" + id);
    }
  } catch (err) {
    lines.push("结算出错：" + err.message);
    if (state._structProxy) state._structProxy._crashed = true;
  } finally {
    if (a) delete a._dabbleNerf;
    state._pointBlankShot = null;
    const proxy = state._structProxy;
    state._structProxy = null;
    if (proxy) structProxyFinish(a, id, proxy, lines);
  }
  const extraBy = a ? [a.instant && a.instant.overload ? "过载" : null, a.self === "conductor" ? "导体" : null].filter(Boolean) : [];
  if (extraBy.length && overloadSeq.length >= 2) {
    // 每个被打了 2 次以上的目标都补一次，各重复打它的最后一段，按最后一段的先后补（#333：音爆再耗圣盾放两次，
    // 同区每个敌人都补；以前只看最后一个目标，只补它一个，它被打死了就谁都不补）
    const ids = overloadSeq.map(x => x.target.id);
    const repeat = overloadSeq.filter((x, i) => ids.lastIndexOf(x.target.id) === i && ids.indexOf(x.target.id) !== i);
    // 过载、导体各多打一次，都重复最后一段
    extraBy.forEach(by => {
      if (!repeat.some(x => totalHp(x.target) > 0)) return;
      lines.push(`${a.name} ${by}：复数次攻击额外再打一次，重复最后一段。`);
      repeat.forEach(x => { if (totalHp(x.target) > 0) hitOne(x.actor, x.target, x.opt); });
    });
  }
  flushAoePulse();
  paintSkillLog(lines.join("\n"));
  renderAll();
}

function init() {
  const presets = enemyPresets();
  const sel = uiEl("presetSelect");
  sel.innerHTML = presets.map(p => `<option value="${p.id}">${p.name}</option>`).join("");

  uiEl("zoneMode").onchange = e => calcCommand("global", { field: "zoneMode", value: Number(e.target.value) });
  uiEl("partySize").onchange = e => calcCommand("global", { field: "partySize", value: Number(e.target.value) });
  uiEl("weather").onchange = e => { const err = calcCommand("global", { field: "weather", value: e.target.value }); if (err) e.target.value = state.weather; };
  const wl = uiEl("weatherLock");
  if (wl) { wl.checked = !!state.weatherLock; wl.onchange = () => calcCommand("global", { field: "weatherLock", value: wl.checked }); }
  uiEl("phaseStep").onchange = e => calcCommand("global", { field: "phaseStep", value: Number(e.target.value) });
  uiEl("sandDir").onchange = e => calcCommand("global", { field: "sandDir", value: e.target.value });
  uiEl("btnAdvancePhase").onclick = () => { uiEl("phaseStep").value = String(calcCommand("advancePhase")); };
  uiEl("btnUndo").onclick = () => calcCommand("undo");
  uiEl("btnClearField").onclick = () => calcCommand("clearField");
  const skip = uiEl("btnBlockSkip");
  if (skip) skip.onclick = () => calcCommand("blockAnswer", { helper: null });
  const askip = uiEl("btnAssistSkip");
  if (askip) askip.onclick = () => calcCommand("assistAnswer", { helper: null });
  uiEl("skillTargetSel").onchange = e => calcCommand("select", { field: "targetId", value: e.target.value || null });
  const bs = uiEl("btnBackstage");
  const bsm = uiEl("backstageModal");
  if (bs && bsm) {
    bs.onclick = () => { renderBackstage(); bsm.classList.remove("hidden"); };
    uiEl("btnCloseBackstage").onclick = () => bsm.classList.add("hidden");
    bsm.addEventListener("click", e => { if (e.target === bsm) bsm.classList.add("hidden"); });
  }

  uiEl("btnLogPrev").onclick = () => calcCommand("logPage", { direction: -1 });
  uiEl("btnLogNext").onclick = () => calcCommand("logPage", { direction: 1 });
  uiEl("btnLogClear").onclick = () => calcCommand("clearLog");
  // 复制日志（跑团时贴到聊天里）
  const copyBtn = (id, which) => {
    const b = uiEl(id);
    if (!b) return;
    b.onclick = () => copyText(logPlainText(which), ok => {
      const old = b.textContent;
      b.textContent = ok ? "已复制" : "复制失败";
      setTimeout(() => { b.textContent = old; }, 1200);
    });
  };
  copyBtn("btnLogCopy", "page");
  copyBtn("btnLogCopyAll", "all");
  const btnStart = uiEl("btnStartCombat");
  if (btnStart) btnStart.onclick = () => calcCommand("startCombat");
  const btnTurn = uiEl("btnTurnEnd");
  if (btnTurn) btnTurn.onclick = () => calcCommand("endTurn");
  loadRoster();
  bindRosterUi();
  const modal = uiEl("playerModal");
  const openModal = () => {
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    renderPcLayers();
    renderRosterSel();
  };
  const closeModal = () => {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  };
  uiEl("btnOpenPlayer").onclick = openModal;
  const openHidden = (id) => {
    const m = uiEl(id);
    if (m) { m.classList.remove("hidden"); m.setAttribute("aria-hidden", "false"); }
  };
  const closeHidden = (id) => {
    const m = uiEl(id);
    if (m) { m.classList.add("hidden"); m.setAttribute("aria-hidden", "true"); }
  };
  const oa = uiEl("btnOpenAttack");
  if (oa) oa.onclick = () => openHidden("attackModal");
  const ca = uiEl("btnCloseAttack");
  if (ca) ca.onclick = () => closeHidden("attackModal");
  const oe = uiEl("btnOpenEditor");
  if (oe) oe.onclick = () => { renderEditor(); openHidden("editorModal"); };
  const oe2 = uiEl("btnOpenEditor2");
  if (oe2) oe2.onclick = () => { renderEditor(); openHidden("editorModal"); };
  const ce = uiEl("btnCloseEditor");
  if (ce) ce.onclick = () => closeHidden("editorModal");
  const am = uiEl("attackModal");
  if (am) am.addEventListener("click", e => { if (e.target === am) closeHidden("attackModal"); });
  const em = uiEl("editorModal");
  if (em) em.addEventListener("click", e => { if (e.target === em) closeHidden("editorModal"); });
  uiEl("btnClosePlayer").onclick = closeModal;
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeModal();
    // 分步选择中按 Esc = 放弃这个技能（还没结算，什么都不扣不改）；战斗界面（game.js）自己处理 Esc
    if (state.skillFlow && !document.querySelector(".g-hud")) calcCommand("skillCancel");
  });
  uiEl("btnLoadLive").onclick = () => calcCommand("loadLive");
  uiEl("attackerSel").addEventListener("change", () => renderSkills());
  uiEl("bladeSel").onchange = () => calcCommand("blade", { value: uiEl("bladeSel").value });
  uiEl("btnAddProp").onclick = () => calcCommand("addProp", { kind: uiEl("propKind").value, zone: Number(uiEl("propZone").value) || 1, level: Number(uiEl("propLevel").value) || 1, faction: (uiEl("propFaction") || {}).value || "player" });
  uiEl("btnAddPreset").onclick = () => calcCommand("addPreset", { id: uiEl("presetSelect").value, level: Number(uiEl("presetLevel").value) || 1 });
  uiEl("attackerSel").onchange = e => calcCommand("select", { field: "attackerId", value: e.target.value || null });
  uiEl("targetSel").onchange = e => calcCommand("select", { field: "targetId", value: e.target.value || null });
  uiEl("btnFillAtk").onclick = () => {
    const a = unitById(uiEl("attackerSel").value);
    if (a) fillFromSuggest(a);
  };
  uiEl("btnCalc").onclick = () => calcCommand("calculate", { input: readCalcInput() });
  uiEl("btnApply").onclick = () => calcCommand("applyAttack", { input: readCalcInput() });
  window.addEventListener("beforeunload", () => calcCommand("persist"));

  // Bootstrap precedes command-module registration; subsequent UI changes and
  // persistence all use commands. Keep the existing calculator save format.
  let loaded = false;
  try {
    const raw = localStorage.getItem("anterscale-calc");
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.units) && s.units.length) {
        state.zoneMode = s.zoneMode || 2;
        state.board = null;
        state.partySize = s.partySize || 2;
        state.weather = s.weather || "none";
        state.phaseStep = s.phaseStep || 0;
        state.sandDir = s.sandDir || "12";
        state.units = s.units;
        if (s.fields) state.fields = s.fields;
        uiEl("zoneMode").value = String(state.zoneMode);
        uiEl("partySize").value = String(state.partySize);
        uiEl("weather").value = state.weather;
        uiEl("phaseStep").value = String(state.phaseStep);
        loaded = true;
      }
    }
  } catch (e) {}
  if (!loaded) {
    const demoA = unitOf("玩家A", 3, [{ type: "flesh", hp: 20 }], 5, 8, { isPlayer: true, range: "any" });
    demoA.zone = 1;
    const demoE = enemyPresets().find(p => p.id === "thug_knife").build(3, 2);
    demoE.zone = enemySpawnZone();
    state.units = [demoA, demoE];
    state.attackerId = demoA.id;
    state.targetId = demoE.id;
    state.selectedId = demoE.id;
  } else if (state.units[0]) {
    state.selectedId = state.units[0].id;
  }
  state.units.forEach(u => { if (u.isPlayer) refreshEconomy(u); });
  renderAll();
  renderLog();
}

if (HAS_DOM) init();

/* 后台面板。原本写在 init() 里，只有计算器自己能用；
   移到顶层后游戏页面也能复用同一份渲染逻辑。 */
/** 开战时双相状态随机 */
function randomizeNoraMood() {
  const n = noraOf();
  if (!n) return;
  n.resources = n.resources || {};
  n.resources.mood = Math.random() < 0.5 ? "gentle" : "cruel";
  n.resources.piercedId = null;
  n.resources.piercedIds = [];
  n.resources.forceCruelNext = false;
}

/** 全力以赴每场可用次数：手册为 1 级 1 次、5 级 2 次、10 级 3 次 */
function allinMaxUses(u) {
  const lv = Number(u && u.level) || 1;
  return lv >= 10 ? 3 : lv >= 5 ? 2 : 1;
}

function weaponCardName(kit) {
  const c = typeof livePartyCards === "function" ? livePartyCards().find(x => x.kit === kit) : null;
  return c ? c.name : kit;
}

function setOwnedWeaponLevel(owner, kit, lv) {
  // 武器满级 10（以前后台填多少是多少：明特 15 级 atk 70）
  const maxLv = typeof HANDBOOK_WEAPON_UPGRADE !== "undefined" ? HANDBOOK_WEAPON_UPGRADE.maxLevel : 10;
  lv = Math.max(1, Math.min(maxLv, Number(lv) || 1));
  owner.weaponLevels = owner.weaponLevels || {};
  owner.weaponLevels[kit] = lv;
  if (typeof ejectExtraWeaponParts === "function") ejectExtraWeaponParts(owner, kit);   // 等级降了，多出来的改装件退回背包
  const existing = (state.units || []).find(u => u.kit === kit && u.weaponOf === owner.kit);
  if (existing) {
    existing.level = lv;
    if (typeof applyWeaponLevel === "function") applyWeaponLevel(existing);
  }
  if (lv >= 5) appendLog(`${weaponCardName(kit)} ${lv} 级：规则上须找工匠。已按主持人许可写入。`);
  if (typeof computeWeaponAtk === "function" && owner.kit !== "hiaki") {
    const primary = (owner.linkedKits || [])[0];
    if (kit === primary) {
      owner.weaponAtk = computeWeaponAtk(kit, owner.attrs, lv, weaponPartsOf(owner, kit));
      if (owner.weaponHeld !== false && typeof weaponIsOut === "function" && !weaponIsOut(owner)) {
        owner.atk = (owner.personalAtk || 0) + owner.weaponAtk;
      }
    }
  }
  if (owner.kit === "hiaki" && typeof refreshHiakiAtk === "function") refreshHiakiAtk(owner);
}

function dmAllUnits() {
  return (state.units || []).filter(u => u && u.id);
}

function dmUnitLabel(u) {
  const side = u.isPlayer ? (typeof isWeaponUnit === "function" && isWeaponUnit(u) ? "武器" : "玩家") : "敌人";
  const flag = u.dead ? "死亡" : u.hidden ? "未出场" : u.stunned ? "失衡" : u.dying ? "濒死" : "";
  return `${u.name} · ${side} · ${u.zone || "?"}区${flag ? " · " + flag : ""}`;
}

function dmApplyLayer(u, idx, cur, max) {
  if (!u || !u.layers || !u.layers[idx]) return;
  const l = u.layers[idx];
  if (max != null) l.max = Math.max(0, Number(max) || 0);
  if (cur != null) l.current = Math.max(0, Math.min(l.max || 0, Number(cur) || 0));
}

function dmFillHp(u) {
  (u.layers || []).forEach(l => { l.current = l.max; });
  u.dead = false;
  if (!u.upOnShp) u.dying = false;
}

function dmFillDef(u) {
  u.def = u.defMax || u.def || 0;
  u.stunned = false;
  u._imbalanceLock = false;
}

function dmForceStun(u) {
  if (u.trainingDummy) return;   // 训练假人不会失衡
  u.def = 0;
  u.stunned = true;
}

function dmRevive(u) {
  u.dead = false;
  u.dying = false;
  u.upOnShp = false;
  u.hidden = false;
  u.stunned = false;
  if ((u.def || 0) <= 0 && (u.defMax || 0) > 0) u.def = u.defMax;
  const inner = (u.layers || [])[u.layers.length - 1];
  if (inner && (inner.current || 0) <= 0) inner.current = Math.max(1, inner.max || 1);
}

function dmCheckedUnits(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`))
    .map(inp => unitById(inp.value))
    .filter(u => u && !u.hidden);
}

function dmSetHits(pred) {
  document.querySelectorAll('input[name="dmHit"]').forEach(inp => {
    const u = unitById(inp.value);
    inp.checked = !!(u && pred(u));
  });
}

function readDmAttackInput() {
  const input = { hits: dmCheckedUnits("dmHit").map(u => u.id) };
  ["dmAtk", "dmTgt", "dmEle", "dmMult", "dmSplash", "dmFlat", "dmBrk", "dmSplashBrk", "dmDiceN", "dmDiceS"].forEach(id => { input[id] = (uiEl(id) || {}).value || ""; });
  input.dmSkipBlock = !!(uiEl("dmSkipBlock") || {}).checked;
  return input;
}
function dmDealAttack(input) {
  input = input || readDmAttackInput();
  const atkId = input.dmAtk;
  const tgtId = input.dmTgt;
  const element = input.dmEle || "physical";
  const mult = Number(input.dmMult);
  const splash = Number(input.dmSplash);
  const flat = Number(input.dmFlat) || 0;
  const br = Number(input.dmBrk);
  const splashBr = Number(input.dmSplashBrk);
  const diceN = Number(input.dmDiceN) || 0;
  const diceS = Number(input.dmDiceS) || 0;
  const skip = !!input.dmSkipBlock;
  let targets = (input.hits || []).map(unitById).filter(u => u && !u.hidden);
  const main = unitById(tgtId);
  if (main && targets.every(u => u.id !== main.id)) targets.unshift(main);
  if (!targets.length) { appendLog("主持人出手：没有勾选波及单位，也没有主目标。"); return; }
  const notes = [`主持人安排一次攻击，波及 ${targets.map(u => u.name).join("、")}。`];
  const hitOne = (a, t, isMain) => {
    const m = isMain ? (isNaN(mult) ? 1 : mult) : (isNaN(splash) ? (isNaN(mult) ? 1 : mult) : splash);
    const b = isMain ? (isNaN(br) ? 1 : br) : (isNaN(splashBr) ? 0 : splashBr);
    if (!a) {
      if (flat > 0 || m === 0) applyTypedDot(t, flat || 0, element, notes, `${t.name} 环境伤害（${ELE[element] || element}）`, { highGain: "环境能量伤害" });
      if (b > 0 && typeof dealBreak === "function") dealBreak(t, b, element, notes, "主持人击破");
      return;
    }
    const out = dealTo(a, t, {
      element, mult: m, flat, baseBreak: b, diceN: isMain ? diceN : 0, diceS: isMain ? diceS : 0,
      atkRange: "any",
      flags: { action: true, aoe: !isMain || targets.length > 1, blockResolved: skip || !isMain, environment: false }
    });
    (out.extra || []).forEach(s => notes.push(s));
    notes.push(`${a.name} → ${t.name}${isMain ? "（主目标）" : "（波及）"}：${ELE[element] || element} ×${m}${flat ? " +" + flat : ""}${isMain && diceN && diceS ? " +" + diceN + "d" + diceS : ""}，击破 ${b}`);
  };
  if (!atkId || atkId === "__env") {
    targets.forEach((t, i) => hitOne(null, t, t.id === tgtId || i === 0));
  } else {
    const a = unitById(atkId);
    if (!a) { appendLog("主持人出手：没有攻击者。"); return; }
    targets.forEach((t, i) => hitOne(a, t, t.id === tgtId || i === 0));
  }
  appendLog(notes.join("\n"));
  if (typeof presentBlockModal === "function") presentBlockModal();
  if (typeof presentAssistModal === "function") presentAssistModal();
  renderAll();
}

function readDmEnvInput() {
  const input = { hits: dmCheckedUnits("dmHit").map(u => u.id) };
  ["dmEnvScope", "dmEnvZone", "dmEnvEle", "dmEnvFlat", "dmEnvBrk"].forEach(id => { input[id] = (uiEl(id) || {}).value || ""; });
  return input;
}
function dmDealEnv(input) {
  input = input || readDmEnvInput();
  const scope = input.dmEnvScope || "pick";
  const zone = Number(input.dmEnvZone) || 1;
  const element = input.dmEnvEle || "physical";
  const flat = Number(input.dmEnvFlat) || 0;
  const br = Number(input.dmEnvBrk) || 0;
  const notes = ["主持人安排环境伤害。"];
  let list = [];
  if (scope === "zone") {
    list = dmAllUnits().filter(u => !u.hidden && !u.dead && Number(u.zone) === zone);
  } else if (scope === "enemies") {
    list = dmAllUnits().filter(u => !u.hidden && !u.dead && !u.isPlayer);
  } else if (scope === "players") {
    list = dmAllUnits().filter(u => !u.hidden && !u.dead && u.isPlayer);
  } else {
    list = (input.hits || []).map(unitById).filter(u => u && !u.hidden);
  }
  if (!list.length) { appendLog("主持人环境伤害：没有目标。勾选波及单位，或改成整个区域。"); return; }
  notes.push("目标：" + list.map(u => u.name).join("、"));
  list.forEach(u => {
    if (flat > 0) applyTypedDot(u, flat, element, notes, `${u.name} 环境伤害（${ELE[element] || element}）`, { highGain: "环境能量伤害" });   // 选能量时带高能的累积高能值
    if (br > 0 && typeof dealBreak === "function") dealBreak(u, br, element, notes, "环境击破");
  });
  appendLog(notes.join("\n"));
  if (typeof presentAssistModal === "function") presentAssistModal();
  renderAll();
}

/* ===== 主持人后台：角色被动 / 资源的数值（给叙事用，直接改，不走规则） =====
 * 只开放这张表里列出的键，值按类型收紧（数字取整夹在范围里、选项只认表里的值）。 */
const PASSIVE_EDIT = {
  ruby:  [{ key: "nano", label: "纳米 %", type: "num", min: 0, max: 100 }],
  yuito: [{ key: "bean", label: "咖啡豆", type: "num", min: 0 }, { key: "liquid", label: "咖啡液", type: "num", min: 0 },
          { key: "bondId", label: "思念对象", type: "ally" }],
  hiaki: [{ key: "stance", label: "刀势", type: "select", options: [["draw", "拔刀"], ["iai", "居合"]] },
          { key: "blade", label: "手中的刀", type: "select", options: [["niu", "丹生谷"], ["naruto", "鳴門"]] }],
  tou:   [{ key: "shield", label: "圣盾", type: "num", min: 0, max: 3 }, { key: "tauntLeft", label: "嘲讽剩余次数", type: "num", min: 0 }],
  xia:   [{ key: "engine", label: "引擎已拉响", type: "bool" }],
  chuan: [{ key: "charge", label: "电能", type: "num", min: 0 }],
  nora:  [{ key: "mood", label: "维塔斯情绪", type: "select", options: [["gentle", "温和"], ["cruel", "残忍"]] }],
  kolt:  [{ key: "bit", label: "刀头", type: "select", options: [["drill", "电钻"], ["acid", "酸液炮"]] },
          { key: "tauntLeft", label: "嘲讽剩余次数", type: "num", min: 0 }],
  helu:  [{ key: "scanned", label: "本场已用过环境扫描", type: "bool" }],
  ras:   [{ key: "energyPct", label: "累积能量 %", type: "num", min: 0 }, { key: "light", label: "光能", type: "num", min: 0 },
          { key: "unstable", label: "不稳态", type: "bool" }],
  longge: [{ key: "ammo", label: "剩余子弹（按顺序，红 / 蓝）", type: "ammo" }, { key: "known", label: "已窥探枚数", type: "num", min: 0, max: 6 },
           { key: "trigger", label: "扳机解锁", type: "bool" }, { key: "spitUsed", label: "本场已吐酸", type: "bool" }]
};
function passiveEditSpec(u) { return (u && PASSIVE_EDIT[u.kit]) || []; }
/** 后台改一项被动数值，返回写进记录的一行 */
function dmSetPassive(u, key, value) {
  const spec = passiveEditSpec(u).find(x => x.key === key);
  if (!spec) throw new Error("Unknown passive field: " + key);
  u.resources = u.resources || {};
  const before = u.resources[key];
  let v;
  if (spec.type === "num") {
    v = Math.floor(Number(value) || 0);
    if (spec.min != null) v = Math.max(spec.min, v);
    if (spec.max != null) v = Math.min(spec.max, v);
  } else if (spec.type === "bool") v = value === true || value === "true" || value === 1 || value === "1";
  else if (spec.type === "ammo") {
    // 胶囊弹药：写成「红蓝红」或「r b r」，最多 6 发，按顺序
    v = String(value == null ? "" : value).split("").map(ch => /[红rR]/.test(ch) ? "red" : /[蓝bB]/.test(ch) ? "blue" : null).filter(Boolean).slice(0, 6);
  }
  else if (spec.type === "select") {
    if (!spec.options.some(o => o[0] === value)) throw new Error("Unknown value for " + key + ": " + value);
    v = value;
  } else if (spec.type === "ally") {
    const ally = value ? unitById(value) : null;
    if (value && !(ally && ally.isPlayer)) throw new Error("Unknown ally: " + value);
    v = ally ? ally.id : null;
    u.resources.bondName = ally ? ally.name : null;
  }
  if (key === "mood" && typeof setMood === "function") setMood(u, v, null);   // 诺拉和维塔斯一起变
  else u.resources[key] = v;
  if (u.kit === "longge") {
    // 改了子弹或已窥探枚数：从队首起前 known 发算看过
    const k = Math.min((u.resources.ammo || []).length, Number(u.resources.known) || 0);
    u.resources.seen = (u.resources.ammo || []).map((c, i) => i < k);
    longgeRes(u);
  }
  const show = (x) => spec.type === "bool" ? (x ? "是" : "否")
    : spec.type === "select" ? ((spec.options.find(o => o[0] === x) || [x, x])[1])
    : spec.type === "ally" ? ((unitById(x) || {}).name || "无")
    : spec.type === "ammo" ? ((x || []).map(c => c === "red" ? "红" : "蓝").join("") || "无") : String(x == null ? 0 : x);
  return `后台：${u.name} ${spec.label} ${show(before)} → ${show(v)}。`;
}
/** 后台改聚焦：op "set" 写入一层的聚焦（序列 + 已推进步数），op "clear" 清掉一层（不给 layerType 就全清） */
function dmSetFocus(u, op, layerType, seq, step) {
  if (!u || u.isPlayer) throw new Error("Focus only applies to enemies");
  const layerName = (t) => (LAYER[t] || t);
  if (op === "clear") {
    const had = (u.focuses || []).length;
    u.focuses = layerType ? (u.focuses || []).filter(f => f.layerType !== layerType) : [];
    return had ? `后台：清除 ${u.name} 的${layerType ? layerName(layerType) : "全部"}聚焦。` : `${u.name} 没有聚焦。`;
  }
  if (op !== "set") throw new Error("Unknown focus op: " + op);
  if (!(u.layers || []).some(l => l.type === layerType)) throw new Error("No such layer: " + layerType);
  let list = Array.isArray(seq) ? seq.filter(e => FOCUS_ELEMS.includes(e)) : [];
  if (!list.length) list = rollFocusSeq(focusSeqLen(u));
  const n = Math.max(0, Math.min(list.length - 1, Math.floor(Number(step) || 0)));
  u.focuses = (u.focuses || []).filter(f => f.layerType !== layerType);
  u.focuses.push({ layerType, seq: list, step: n });
  return `后台：${u.name} 的${layerName(layerType)}被聚焦：${list.map(e => ELE[e] || e).join(" → ")}（已推进 ${n}/${list.length}）。`;
}
/** 「火 电 冰」/「fire,electric」→ 属性 id 列表 */
function parseFocusSeqText(text) {
  const byName = {};
  FOCUS_ELEMS.forEach(e => { byName[e] = e; if (ELE[e]) byName[ELE[e]] = e; });
  Object.keys(ELE_BY_CN).forEach(cn => { byName[cn] = ELE_BY_CN[cn]; });
  return String(text || "").split(/[\s,，、→>\/]+/).map(x => byName[x.trim()]).filter(Boolean);
}

function renderBackstage() {
  if (!HAS_DOM) return;
  const box = uiEl("backstageBody");
  if (!box) return;
  const pcs = fieldUnits().filter(u => u.isPlayer && !isWeaponUnit(u));
  const all = dmAllUnits();
  const sd = state.statusDmg || {};
  const sdKeys = Object.keys(STATUS_DMG_NAME).filter(k => (sd[k] || 0) > 0);
  const eleOpts = Object.keys(ELE).map(k => `<option value="${k}">${ELE[k]}</option>`).join("");
  const unitOpts = all.map(u => `<option value="${u.id}">${escapeHtml(dmUnitLabel(u))}</option>`).join("");
  const hitBoxes = all.filter(u => !u.hidden).map(u =>
    `<label class="field" style="flex-direction:row;align-items:center;gap:6px;min-width:160px">
      <input type="checkbox" name="dmHit" value="${u.id}"> ${escapeHtml(u.name)} <span class="hint">${u.isPlayer ? (isWeaponUnit(u) ? "武器" : "玩家") : "敌人"} · ${u.zone || "?"}区</span>
    </label>`).join("");
  let html = `<div class="section-title">主持人出手</div>
    <p class="hint">先勾选波及单位。主目标用「目标」下拉指定，主目标吃完整倍率/击破/骰子，其余单位吃波及倍率与波及击破。</p>
    <div class="prop-card" style="margin-bottom:10px">
      <div class="row">
        <label class="field">攻击者
          <select id="dmAtk"><option value="__env">（环境 / 无来源）</option>${unitOpts}</select>
        </label>
        <label class="field">主目标
          <select id="dmTgt">${unitOpts}</select>
        </label>
        <label class="field">属性
          <select id="dmEle">${eleOpts}</select>
        </label>
      </div>
      <div class="row">
        <label class="field">主倍率<input id="dmMult" type="number" step="0.1" value="1"></label>
        <label class="field">波及倍率<input id="dmSplash" type="number" step="0.1" value="0.5"></label>
        <label class="field">固定伤害<input id="dmFlat" type="number" value="0"></label>
        <label class="field">主击破<input id="dmBrk" type="number" value="1"></label>
        <label class="field">波及击破<input id="dmSplashBrk" type="number" value="0"></label>
        <label class="field">骰子数<input id="dmDiceN" type="number" min="0" value="0"></label>
        <label class="field">面<input id="dmDiceS" type="number" min="0" value="6"></label>
        <label class="field" style="flex-direction:row;align-items:center;gap:6px">
          <input id="dmSkipBlock" type="checkbox" checked> 跳过格挡
        </label>
        <button class="btn primary" id="btnDmAtk">结算这次攻击</button>
      </div>
      <div class="hint" style="margin:8px 0 4px">波及单位</div>
      <div class="row" style="margin-bottom:6px">
        <button class="btn small" id="dmHitAll">全选</button>
        <button class="btn small" id="dmHitNone">清空</button>
        <button class="btn small" id="dmHitZone1">1 区</button>
        <button class="btn small" id="dmHitZone2">2 区</button>
        <button class="btn small" id="dmHitZone3">3 区</button>
        <button class="btn small" id="dmHitFoes">只敌人</button>
        <button class="btn small" id="dmHitPlayers">只玩家</button>
        <button class="btn small" id="dmHitAtkZone">攻击者同区</button>
        <button class="btn small" id="dmHitTgtZone">主目标同区</button>
      </div>
      <div class="row" style="flex-wrap:wrap">${hitBoxes || '<span class="hint">场上没有可勾选的单位</span>'}</div>
      <div class="hr"></div>
      <div class="row">
        <label class="field">环境范围
          <select id="dmEnvScope">
            <option value="pick">用上面勾选的单位</option>
            <option value="zone">整个区域</option>
            <option value="enemies">全部敌人</option>
            <option value="players">全部玩家</option>
          </select>
        </label>
        <label class="field">区域
          <select id="dmEnvZone"><option value="1">1 区</option><option value="2">2 区</option><option value="3">3 区</option></select>
        </label>
        <label class="field">属性
          <select id="dmEnvEle">${eleOpts}</select>
        </label>
        <label class="field">伤害<input id="dmEnvFlat" type="number" value="4"></label>
        <label class="field">击破<input id="dmEnvBrk" type="number" value="0"></label>
        <button class="btn" id="btnDmEnv">结算环境伤害</button>
      </div>
    </div>
    <div class="section-title">全场单位（血量 / 架势）</div>
    <p class="hint">任意单位都可以改。血量改到 0 不会自动走死亡演出，用「复活 / 击倒」按钮处理状态。</p>`;
  if (!all.length) html += `<p class="hint">场上没有单位。</p>`;
  all.forEach(u => {
    const layers = u.layers || [];
    const layerHtml = layers.map((l, i) => `
        <label class="field">${LAYER[l.type] || l.type}
          <span class="row" style="gap:4px">
            <input data-lcur="${u.id}" data-i="${i}" type="number" min="0" value="${Math.floor(Number(l.current) || 0)}" style="width:64px">
            <span class="hint">/</span>
            <input data-lmax="${u.id}" data-i="${i}" type="number" min="0" value="${Math.floor(Number(l.max) || 0)}" style="width:64px">
          </span>
        </label>`).join("");
    html += `<div class="prop-card" style="margin-bottom:8px">
      <div><b>${escapeHtml(u.name)}</b> · ${u.isPlayer ? (isWeaponUnit(u) ? "武器人" : "玩家") : "敌人"} · ${u.zone || "?"}区 · ${u.dead ? "死亡" : u.hidden ? "未出场" : u.stunned ? "失衡" : u.dying ? "濒死" : "正常"}</div>
      <div class="row">
        ${layerHtml}
        <label class="field">架势
          <span class="row" style="gap:4px">
            <input data-def="${u.id}" type="number" min="0" value="${Math.floor(Number(u.def) || 0)}" style="width:64px">
            <span class="hint">/</span>
            <input data-defmax="${u.id}" type="number" min="0" value="${Math.floor(Number(u.defMax) || 0)}" style="width:64px">
          </span>
        </label>
        <label class="field">区域<input data-zone="${u.id}" type="number" min="1" max="3" value="${Number(u.zone) || 1}"></label>
        <label class="field">ATK<input data-atk="${u.id}" type="number" value="${Number(u.atk) || 0}"></label>
      </div>
      <div class="row">
        <button class="btn small" data-fillhp="${u.id}">满血</button>
        <button class="btn small" data-filldef="${u.id}">满架势</button>
        <button class="btn small" data-stun="${u.id}">打失衡</button>
        <button class="btn small" data-unstun="${u.id}">解除失衡</button>
        <button class="btn small" data-kill="${u.id}">击倒</button>
        <button class="btn small ok" data-revive="${u.id}">复活</button>
      </div>
    </div>`;
  });
  // 角色被动 / 资源：光能、能量 %、电能、刀头、是否扫描过……给叙事用
  const passiveUnits = all.filter(u => u.isPlayer && passiveEditSpec(u).length);
  html += `<div class="section-title">角色被动 / 资源</div>
    <p class="hint">按叙事需要直接改，改完立刻生效并写进战斗记录，不走任何规则（例：改到 100% 能量不会自动进入不稳态，要的话一起勾上）。</p>`;
  if (!passiveUnits.length) html += `<p class="hint">场上没有带可调被动的角色。</p>`;
  passiveUnits.forEach(u => {
    const r = u.resources || {};
    const ctl = passiveEditSpec(u).map(sp => {
      const attrs = `data-passive="${u.id}" data-key="${sp.key}"`;
      if (sp.type === "num") return `<label class="field">${sp.label}<input ${attrs} type="number" ${sp.min != null ? `min="${sp.min}"` : ""} ${sp.max != null ? `max="${sp.max}"` : ""} value="${Math.floor(Number(r[sp.key]) || 0)}" style="width:72px"></label>`;
      if (sp.type === "bool") return `<label class="field" style="flex-direction:row;align-items:center;gap:6px"><input ${attrs} type="checkbox" ${r[sp.key] ? "checked" : ""}> ${sp.label}</label>`;
      if (sp.type === "ammo") return `<label class="field">${sp.label}<input ${attrs} type="text" value="${(r[sp.key] || []).map(c => c === "red" ? "红" : "蓝").join("")}" style="width:96px"></label>`;
      if (sp.type === "select") return `<label class="field">${sp.label}<select ${attrs}>${sp.options.map(o => `<option value="${o[0]}" ${r[sp.key] === o[0] ? "selected" : ""}>${o[1]}</option>`).join("")}</select></label>`;
      const allies = all.filter(x => x.isPlayer && x.id !== u.id && !x.hidden && !x.dead);
      return `<label class="field">${sp.label}<select ${attrs}><option value="">（无）</option>${allies.map(x => `<option value="${x.id}" ${r[sp.key] === x.id ? "selected" : ""}>${escapeHtml(x.name)}</option>`).join("")}</select></label>`;
    }).join("");
    html += `<div class="prop-card" style="margin-bottom:8px"><div><b>${escapeHtml(u.name)}</b></div><div class="row">${ctl}</div></div>`;
  });
  // 聚焦：给哪个敌人的哪一层加 / 改 / 清聚焦
  const focusFoes = all.filter(u => !u.isPlayer && !u.dead && !u.hidden && (u.layers || []).length);
  html += `<div class="section-title">聚焦</div>
    <p class="hint">序列用属性名写，空格隔开（例：火 电 冰）；留空就按规则随机生成（长度按敌人级别）。已推进 = 已经完成的步数。</p>`;
  if (!focusFoes.length) html += `<p class="hint">场上没有敌人。</p>`;
  focusFoes.forEach(u => {
    const cur = (u.focuses || []).map(f => `${LAYER[f.layerType] || f.layerType}：${f.seq.map(e => ELE[e] || e).join(" → ")}（${f.step}/${f.seq.length}）
        <button class="btn small" data-focusclear="${u.id}" data-layer="${f.layerType}">清除</button>`).join("<br>");
    const f0 = (u.focuses || [])[0];
    html += `<div class="prop-card" style="margin-bottom:8px">
      <div><b>${escapeHtml(u.name)}</b> · ${cur || '<span class="hint">没有聚焦</span>'}</div>
      <div class="row">
        <label class="field">血量层<select data-focuslayer="${u.id}">${(u.layers || []).map(l => `<option value="${l.type}" ${f0 && f0.layerType === l.type ? "selected" : ""}>${LAYER[l.type] || l.type}</option>`).join("")}</select></label>
        <label class="field">序列<input data-focusseq="${u.id}" type="text" placeholder="留空随机" value="${f0 ? f0.seq.map(e => ELE[e] || e).join(" ") : ""}" style="width:150px"></label>
        <label class="field">已推进<input data-focusstep="${u.id}" type="number" min="0" value="${f0 ? f0.step : 0}" style="width:56px"></label>
        <button class="btn small primary" data-focusset="${u.id}">设置聚焦</button>
      </div>
    </div>`;
  });
  html += `<div class="section-title">状态 / 场地累计伤害</div>`;
  html += `<p class="hint">从开战或上次清除日志起累计。清除日志会同时清零。</p>`;
  if (!sdKeys.length) html += `<p class="hint">还没有状态或场地伤害。</p>`;
  else {
    html += `<div class="prop-card" style="margin-bottom:10px">`;
    sdKeys.forEach(k => {
      html += `<div>${STATUS_DMG_NAME[k] || k}：<b>${sd[k]}</b></div>`;
    });
    const total = sdKeys.reduce((s, k) => s + (sd[k] || 0), 0);
    html += `<div class="hint">合计 ${total}</div></div>`;
  }
  html += `<div class="section-title">物资</div><p>奎支：<b>${Number(state.kuizhi) || 0}</b></p>`;
  html += `<div class="section-title">角色</div>`;
  if (!pcs.length) html += `<p class="hint">场上没有玩家角色。先载入实况组。</p>`;
  pcs.forEach(u => {
    const a = u.attrs || { str: 5, con: 5, dex: 5, wil: 5, int: 5, sta: 5 };
    const d = derivedFromAttrs(a, u.level);
    html += `<div class="prop-card" style="margin-bottom:10px">
      <div><b>${escapeHtml(u.name)}</b>${u.enName ? ` <span class="hint">${escapeHtml(u.enName)}</span>` : ""} · ${u.roles ? u.roles.primary + "/" + u.roles.secondary : ""} · ${u.dead ? "死亡" : u.upOnShp ? "起身" : u.dying ? "濒死" : "正常"}</div>
      <div class="row">
        <label class="field">等级<input data-lv="${u.id}" type="number" min="1" value="${u.level || 1}"></label>
        <label class="field">经验<input data-xp="${u.id}" type="number" min="0" value="${u.xp || 0}"></label>
        <label class="field">升级需<span>${xpToNext(u.level)}</span></label>
        <label class="field">可分配点<input data-pts="${u.id}" type="number" min="0" value="${u.attrPoints || 0}"></label>
      </div>
      <div class="row">
        <label class="field">力量<input data-attr="${u.id}" data-k="str" type="number" value="${a.str}"></label>
        <label class="field">体质<input data-attr="${u.id}" data-k="con" type="number" value="${a.con}"></label>
        <label class="field">敏捷<input data-attr="${u.id}" data-k="dex" type="number" value="${a.dex}"></label>
        <label class="field">意志<input data-attr="${u.id}" data-k="wil" type="number" value="${a.wil}"></label>
        <label class="field">智力<input data-attr="${u.id}" data-k="int" type="number" value="${a.int}"></label>
        <label class="field">耐力<input data-attr="${u.id}" data-k="sta" type="number" value="${a.sta}"></label>
      </div>
      <div class="hint">公式预览：HP ${d.hp} · 角色ATK ${d.personalAtk} · DEF ${d.def} · SHP ${d.shp} · 改造率 ${d.cyber}%</div>
      <div class="row">
        <label class="field">坚毅生命<input data-shp="${u.id}" type="number" value="${u.shp || 0}"></label>
        <label class="field">SHP上限<input data-shpmax="${u.id}" type="number" value="${u.shpMax || 0}"></label>
        <button class="btn small" data-recalc="${u.id}">按公式重算派生</button>
        <button class="btn small ok" data-lvup="${u.id}">用经验升级</button>
      </div>
    </div>`;
  });
  html += `<div class="section-title">武器等级</div>`;
  html += `<p class="hint">不用唤出武器人也能改等级。唤出时按这里的等级成长。</p>`;
  let wepRows = 0;
  pcs.forEach(pc => {
    const kits = (pc.linkedKits && pc.linkedKits.length) ? pc.linkedKits : defaultLinkedKits(pc.kit);
    if (!pc.linkedKits || !pc.linkedKits.length) pc.linkedKits = kits.slice();
    kits.forEach(kit => {
      wepRows += 1;
      const lv = (pc.weaponLevels && pc.weaponLevels[kit]) || 1;
      const existing = (state.units || []).find(u => u.kit === kit && u.weaponOf === pc.kit);
      html += `<div class="row" style="margin-bottom:6px">
        <strong style="min-width:110px">${escapeHtml(weaponCardName(kit))}</strong>
        <span class="hint">${escapeHtml(pc.name)}的武器</span>
        <label class="field">等级<input data-owkit="${pc.id}" data-wkit="${kit}" type="number" min="1" value="${lv}"></label>
        ${typeof weaponDur === "function" ? `<label class="field">耐久<input data-durkit="${kit}" type="number" min="0" value="${weaponDur(kit)}"></label><span class="hint">/ ${weaponDurMax(kit)}</span>` : ""}
        <span class="hint">${existing ? (existing.hidden ? "收在手上" : "在场") : "未唤出"} · 武器ATK ${typeof computeWeaponAtk === "function" ? computeWeaponAtk(kit, pc.attrs, lv, weaponPartsOf(pc, kit)) : "?"}${lv >= 5 ? " · 需工匠" : ""}</span>
      </div>`;
    });
  });
  if (!wepRows) html += `<p class="hint">场上没有带着武器的角色。</p>`;
  html += `<div class="hr"></div><div class="row">
    <label class="field">发放经验<input id="xpGrant" type="number" value="25"></label>
    <button class="btn" id="btnGrantXp">给所有角色加经验</button>
  </div>`;
  box.innerHTML = html;
  const after = () => { renderBackstage(); if (typeof renderAll === "function") renderAll(); };
  const send = (action, data, redraw) => { const result = backstageCommand(action, data); if (redraw) after(); return result; };
  const bindNum = (sel, fn) => box.querySelectorAll(sel).forEach(inp => { inp.onchange = () => fn(inp); });
  const fields = { lv: "level", xp: "xp", pts: "attrPoints", shp: "shp", shpmax: "shpMax", def: "def", defmax: "defMax", zone: "zone", atk: "atk" };
  Object.entries(fields).forEach(([attr, field]) => bindNum(`[data-${attr}]`, inp => send("set", { actor: inp.dataset[attr], field, value: inp.value })));
  bindNum("[data-owkit]", inp => send("weaponLevel", { actor: inp.dataset.owkit, kit: inp.dataset.wkit, value: inp.value }, true));
  bindNum("[data-durkit]", inp => send("durability", { kit: inp.dataset.durkit, value: inp.value }, true));
  bindNum("[data-attr]", inp => { send("attr", { actor: inp.dataset.attr, attr: inp.dataset.k, value: inp.value }); renderBackstage(); });
  box.querySelectorAll("[data-recalc]").forEach(b => { b.onclick = () => send("recalc", { actor: b.dataset.recalc }, true); });
  box.querySelectorAll("[data-lvup]").forEach(b => { b.onclick = () => send("levelUp", { actor: b.dataset.lvup }, true); });
  const g = uiEl("btnGrantXp");
  if (g) g.onclick = () => { send("grantXp", { amount: Number(uiEl("xpGrant").value) || 0 }); renderBackstage(); };
  bindNum("[data-lcur]", inp => send("layer", { actor: inp.dataset.lcur, index: Number(inp.dataset.i), current: inp.value, max: null }));
  bindNum("[data-lmax]", inp => send("layer", { actor: inp.dataset.lmax, index: Number(inp.dataset.i), current: null, max: inp.value }));
  box.querySelectorAll("[data-passive]").forEach(inp => {
    inp.onchange = () => send("passive", { actor: inp.dataset.passive, key: inp.dataset.key, value: inp.type === "checkbox" ? inp.checked : inp.value }, true);
  });
  box.querySelectorAll("[data-focusset]").forEach(b => {
    b.onclick = () => {
      const id = b.dataset.focusset;
      const q = (k) => box.querySelector(`[data-${k}="${id}"]`);
      send("focus", { actor: id, op: "set", layerType: q("focuslayer").value, seq: parseFocusSeqText(q("focusseq").value), step: q("focusstep").value }, true);
    };
  });
  box.querySelectorAll("[data-focusclear]").forEach(b => { b.onclick = () => send("focus", { actor: b.dataset.focusclear, op: "clear", layerType: b.dataset.layer }, true); });
  const buttons = { fillhp: "fillHp", filldef: "fillDef", stun: "stun", unstun: "unstun", kill: "knockOut", revive: "revive" };
  Object.entries(buttons).forEach(([attr, action]) => box.querySelectorAll(`[data-${attr}]`).forEach(b => {
    b.onclick = () => { send(action, { actor: b.dataset[attr] }, true); if (action === "stun" && typeof presentAssistModal === "function") presentAssistModal(); };
  }));
  const ba = uiEl("btnDmAtk");
  if (ba) ba.onclick = () => { send("attack", { input: readDmAttackInput() }); renderBackstage(); };
  const be = uiEl("btnDmEnv");
  if (be) be.onclick = () => { send("environment", { input: readDmEnvInput() }); renderBackstage(); };
  const hitBtn = (id, fn) => { const b = uiEl(id); if (b) b.onclick = fn; };
  hitBtn("dmHitAll", () => dmSetHits(() => true));
  hitBtn("dmHitNone", () => dmSetHits(() => false));
  hitBtn("dmHitZone1", () => dmSetHits(u => Number(u.zone) === 1));
  hitBtn("dmHitZone2", () => dmSetHits(u => Number(u.zone) === 2));
  hitBtn("dmHitZone3", () => dmSetHits(u => Number(u.zone) === 3));
  hitBtn("dmHitFoes", () => dmSetHits(u => !u.isPlayer));
  hitBtn("dmHitPlayers", () => dmSetHits(u => !!u.isPlayer));
  hitBtn("dmHitAtkZone", () => {
    const a = unitById((uiEl("dmAtk") || {}).value);
    const z = a ? Number(a.zone) : 0;
    dmSetHits(u => z && Number(u.zone) === z);
  });
  hitBtn("dmHitTgtZone", () => {
    const t = unitById((uiEl("dmTgt") || {}).value);
    const z = t ? Number(t.zone) : 0;
    dmSetHits(u => z && Number(u.zone) === z);
  });
}
