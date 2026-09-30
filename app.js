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

const FIELD_EFFECT_KEYS = ["fireOn", "electric", "acid", "ice", "energy", "harmonic", "heal"];

function clearFieldEffects(f) {
  if (!f) return;
  f.fire = 0;
  f.fireOn = false;
  f.electric = false;
  f.acid = false;
  f.ice = false;
  f.energy = false;
  f.energyVal = 0;
  f.harmonic = false;
  f.heal = false;
}

function setWeather(kind, opts) {
  opts = opts || {};
  kind = kind || "none";
  if (state.weatherLock && !opts.force && kind !== state.weather) {
    return `天气被「${state.weatherLock}」锁定，无法覆盖。`;
  }
  const was = state.weather;
  state.weather = kind;
  if (kind === "sand" && (was !== "sand" || opts.casterZone != null)) rollSandDir(opts.casterZone);
  const sel = uiEl("weather");
  if (sel) sel.value = kind;
  if (opts.lock) state.weatherLock = opts.lock;
  if (opts.unlock) state.weatherLock = null;
  applyTheme();
  return null;
}

function setZoneField(zone, kind, opts) {
  opts = opts || {};
  const f = state.fields[zone];
  if (!f) return "没有这个区域。";
  if (f.fieldLock && !opts.force) {
    const same = (kind === "fire" && fieldFireOn(f)) || (kind && kind !== "fire" && f[kind]);
    if (!same && kind) return `${zone} 区场地被「${f.fieldLock}」锁定，无法覆盖。`;
    if (!kind) return `${zone} 区场地被「${f.fieldLock}」锁定，无法清除。`;
  }
  clearFieldEffects(f);
  if (kind === "fire") {
    f.fireOn = true;
    f.fire = opts.stacks != null ? opts.stacks : 1;
  } else if (kind) {
    f[kind] = true;
  }
  if (opts.lock) f.fieldLock = opts.lock;
  if (opts.unlock) f.fieldLock = null;
  return null;
}

function snapshot() {
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
    <div>架势 ${u.def}/${u.defMax} · ATK ${effectiveAtk(u, state.units)}</div>
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
      const k = inp.dataset.k;
      if (k === "fieldLock") {
        state.fields[z].fieldLock = inp.checked ? (state.fields[z].fieldLock || "手动锁定") : null;
      } else if (k === "fire") {
        const n = Math.max(0, Number(inp.value) || 0);
        if (n > 0) {
          const err = setZoneField(z, "fire", { stacks: n });
          if (err) appendLog(err);
        } else if (!state.fields[z].fieldLock) {
          state.fields[z].fire = 0;
          state.fields[z].fireOn = false;
        }
      } else if (k === "fireOn" || FIELD_EFFECT_KEYS.indexOf(k) >= 0) {
        if (inp.checked) {
          const kind = k === "fireOn" ? "fire" : k;
          const err = setZoneField(z, kind, k === "fireOn" ? { stacks: state.fields[z].fire || 1 } : {});
          if (err) appendLog(err);
        } else if (!state.fields[z].fieldLock) {
          clearFieldEffects(state.fields[z]);
        }
      } else state.fields[z][k] = inp.type === "checkbox" ? inp.checked : inp.value;
      if (k === "abyss" && inp.checked) {
        const notes = [];
        state.units.filter(u => Number(u.zone) === z && !u.hidden && !u.dead).forEach(u => applyAbyssFall(u, otherZone(z), notes));
        if (notes.length) appendLog(notes.join("\n"));
      }
      renderZones();
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
      if (ok) applyFlowPick(Number(z));
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
  box.querySelector("select").onchange = (e) => {
    g.type = e.target.value;
    if (g.type === "bridge" || g.type === "wall") {
      if (!g.hp) { g.hp = defaultGapHp(g.type); g.maxHp = g.hp; }
    }
    if (g.type === "door") g.open = false;
    if (g.type === "open") { g.hp = 0; g.open = true; }
    renderAll();
  };
  box.querySelector("[data-ghp]").onchange = (e) => { g.hp = Number(e.target.value) || 0; g.maxHp = Math.max(g.maxHp || 0, g.hp); };
  box.querySelector("[data-gopen]").onchange = (e) => { g.open = e.target.checked; renderAll(); };
  box.querySelector("[data-gforce]").onchange = (e) => { state.forceVoid[key] = e.target.checked; };
  box.querySelector("[data-ghit]").onclick = () => {
    state.targetId = "gap:" + key;
    renderAll();
    appendLog(`已把间隔 ${key}（${gapLabel(g.type)}）设为攻击目标。`);
  };
  return box;
}

function gapStatusText(g) {
  if (g.type === "open") return "可通过，可影响对面。";
  if (g.type === "bridge") return `通过扣 1d6 耐久。现 ${g.hp}。毁后变空隙。飞行无视。`;
  if (g.type === "wall") return `挡住对面。现耐久 ${g.hp}。击破也扣耐久。`;
  if (g.type === "door") return g.open ? "门开着，可通过。" : "门关着，不能通过也不能打对面。";
  if (g.type === "void") return "地面不能过；飞行可过。强行通过需行动点+运动检定。";
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
  tgt.onclick = (e) => {
    e.stopPropagation();
    const step = flowStep();
    if (state.skillFlow && step && step.type === "unit") {
      const pid = "prop:" + p.id;
      const ok = (step.units || []).some(u => u.id === pid);
      if (ok) { applyFlowPick(pid); return; }
    }
    state.targetId = "prop:" + p.id;
    renderAll();
  };
  row.appendChild(tgt);
  if (p.kind === "button" || p.kind === "lever") {
    const use = document.createElement("button");
    use.className = "btn small";
    use.textContent = p.kind === "lever" ? "扳动" : "按下";
    use.onclick = (e) => { e.stopPropagation(); useDevice(p); };
    row.appendChild(use);
  }
  if (p.kind === "scrap") {
    const fire = document.createElement("button");
    fire.className = "btn small";
    fire.textContent = "开火";
    fire.onclick = (e) => { e.stopPropagation(); fireScrap(p); };
    row.appendChild(fire);
  }
  if (p.movable) {
    const mv = document.createElement("button");
    mv.className = "btn small";
    mv.textContent = "挪到邻区";
    mv.onclick = (e) => {
      e.stopPropagation();
      const dest = Number(p.zone) === 1 ? 2 : Number(p.zone) - 1;
      if (canCross(null, p.zone, dest, true)) {
        snapshot();
        p.zone = dest;
        appendLog(`${p.name} 移到 ${dest} 区。`);
        renderAll();
      }
    };
    row.appendChild(mv);
  }
  const del = document.createElement("button");
  del.className = "btn small danger";
  del.textContent = "移除";
  del.onclick = (e) => {
    e.stopPropagation();
    snapshot();
    state.props = state.props.filter(x => x.id !== p.id);
    renderAll();
  };
  row.appendChild(del);
  el.appendChild(row);
  return el;
}

function statusLine(u) {
  const s = [];
  if (u.statuses) {
    if (u.statuses.burn > 0) s.push("灼烧×" + u.statuses.burn);
    if (u.statuses.shock) s.push("感电");
    if (u.statuses.corr) s.push("腐蚀");
    if (u.statuses.frostbite) s.push("冻伤");
    if (u.statuses.shockwave) s.push("震荡");
    if (u.statuses.high || (u.highEnergy || 0) > 0) s.push("高能 " + (u.highEnergy || 0));
    if (u.statuses.reso) s.push("共振");
    if (u.statuses.unstable) s.push("不稳");
    if (u.statuses.weak) s.push("虚弱");
    if (u.statuses.inspire) s.push("振奋");
    if (u.statuses.hide) s.push("躲藏");
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
    if (u.resources && u.resources.forceCharge) s.push("蓄力中");
    if (u.resources && u.resources.forceOverheat) s.push("将过热");
    if (u.resources && u.resources.debrisCount) s.push("碎片" + u.resources.debrisCount + "/2");
  }
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
  return s.length ? s.join(" · ") : "无状态";
}

function gainHighFromHits(target, res, extra) {
  if (!target || !res) return;
  const hasHigh = (target.statuses && target.statuses.high) || (target.highEnergy || 0) > 0;
  if (!hasHigh) return;
  if ((res.element || "") !== "energy") return;
  const hits = (res.perHit && res.perHit.length) ? res.perHit : [{ dealt: res.total }];
  const damaging = hits.filter(h => (h.dealt || 0) > 0);
  if (!damaging.length) return;
  damaging.forEach((h, i) => {
    extra.push(addHighEnergy(target, `第${i + 1}段能量伤害`));
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
  const bonus = weather === "glow" ? 1 : 0;
  const d = statusDotDice("high", unit.level || 1, weather);
  const r = takeDice(d.n, d.s, (d.bonus || 0) + bonus);
  unit.statuses = unit.statuses || {};
  const fresh = !unit.statuses.high;
  unit.statuses.high = true;
  if (fresh) popStatus(unit, "high");
  unit.highEnergy = (unit.highEnergy || 0) + r.total;
  const line = `${unit.name} ${reason || "高能累积"} ${r.text} → 高能值 ${unit.highEnergy}`;
  checkHighBoom(unit);
  return line;
}

function currentLifeForHigh(unit) {
  let hp = 0;
  (unit.layers || []).forEach(l => { hp += Math.max(0, Number(l.current) || 0); });
  if (hp <= 0 && unit.upOnShp) hp = Math.max(0, Number(unit.shp) || 0);
  return hp;
}

function checkHighBoom(unit) {
  if (!unit || unit._highBooming || unit.dead || unit.hidden) return;
  const hp = currentLifeForHigh(unit);
  const f = (state.fields && state.fields[unit.zone]) || emptyField();
  const fieldHE = unit.statuses && unit.statuses.high ? (Number(f.energyVal) || 0) : 0;
  const val = (Number(unit.highEnergy) || 0) + fieldHE;
  if (val > 0 && val >= hp) explodeHigh(unit);
}

function highBoomHitsUnit(source, u) {
  if (!u || u.id === source.id || u.dead || u.hidden) return false;
  if (u.kit === "ufo_body") return false;
  return !!u.isPlayer === !!source.isPlayer;
}

function highBoomHitsProp(source, p) {
  if (!p) return false;
  if (p.kind !== "battery" && p.kind !== "turret") return true;
  if (!p.faction) return true;
  if (p.faction === "enemy") return !source.isPlayer;
  return !!source.isPlayer;
}

function highBoomVictims(source) {
  return fieldUnits().filter(u => Number(u.zone) === Number(source.zone) && highBoomHitsUnit(source, u));
}

function explodeHigh(unit) {
  if (!unit || unit._highBooming) return;
  unit._highBooming = true;
  const he = Number(unit.highEnergy) || 0;
  const aoe = Math.floor(he / 2);
  appendLog(`【高能自爆】${unit.name} 高能值 ${he} ≥ 当前生命 ${currentLifeForHigh(unit)}，立即秒杀。余波只打同阵营与无阵营配置物，${aoe} 能量。`);
  spawnPopup(unit, { kind: "status", text: "自爆", element: "energy" });
  (unit.layers || []).forEach(l => { l.current = 0; });
  if (unit.isPlayer && !isWeaponUnit(unit)) {
    unit.dying = true;
    unit.upOnShp = false;
    clearStunOnDown(unit);
  } else {
    unit.dead = true;
  }
  unit.highEnergy = 0;
  if (unit.statuses) unit.statuses.high = false;
  if (unit.highTags && unit.highTags.indexOf("ruby") >= 0) {
    addNano(40);
    const ruby = findKit("ruby", state.units);
    appendLog(`瑞比标签高能自爆：纳米 +40 → ${ruby && ruby.resources ? ruby.resources.nano : "?"}`);
  }
  if (unit.highTags && unit.highTags.indexOf("ras") >= 0) {
    const ras = findKit("ras", state.units);
    if (ras && (typeof passiveOnKit !== "function" || passiveOnKit("ras"))) {   // 放弃被动「能量流向」时不回收
      ras.resources = ras.resources || {};
      ras.resources.light = (Number(ras.resources.light) || 0) + he;
      appendLog(`能量流向：回收光能 +${he} → ${ras.resources.light}`);
    }
  }
  unit.highTags = [];
  if (state.fields[unit.zone]) state.fields[unit.zone].energyVal = 0;
  markAoeZone(unit.zone);
  if (aoe > 0) {
    highBoomVictims(unit).forEach(u => {
      const notes = [];
      applyTypedDot(u, aoe, "energy", notes, `${u.name} 被高能余波击中 ${aoe}`);
      notes.forEach(s => appendLog(s));
      checkHighBoom(u);
    });
    (state.props || []).filter(p => Number(p.zone) === Number(unit.zone) && highBoomHitsProp(unit, p)).forEach(p => {
      const notes = damageProp(p, { element: "energy", dmg: aoe }, unit);
      notes.forEach(s => appendLog(s));
    });
  }
  flushAoePulse();
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
  while (f.collapse >= 5) {
    f.collapse -= 5;
    notes.push(`${zone} 区塌陷触发（计数清零后余 ${f.collapse}）。`);
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
  state.units.filter(u => !u.hidden && !u.dead && Number(u.zone) === Number(zone) && !u.flying).forEach(u => {
    dealBreak(u, 2, "physical", notes, "塌陷");
    applyTypedDot(u, r.total, "physical", notes, `${u.name} 塌陷伤害`);
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
  state.units.filter(u => !u.hidden && !u.dead && Number(u.zone) === Number(zone) && !u.flying).forEach(u => {
    applyAbyssFall(u, otherZone(zone), notes);
  });
}

function applyAbyssFall(unit, prevZone, notes) {
  if (!unit || unit.flying || unit.dead || unit.hidden) return false;
  const f = state.fields[unit.zone] || {};
  if (!f.abyss) return false;
  const loss = Math.floor(totalMaxHp(unit) * 0.1);
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
  notes.push(`${unit.name} 坠入深渊，失去最大生命 10%（${loss}）并回到 ${back} 区。`);
  if (isUnitDown(unit) && !unit.upOnShp) {
    if (unit.isPlayer && !isWeaponUnit(unit) && !unit.dead) {
      unit.dying = true;
      clearStunOnDown(unit);
      notes.push(`${unit.name} 坠落导致最内层归零，陷入濒死。`);
    } else {
      unit.dead = true;
      notes.push(`${unit.name} 坠落致死（最内层归零）。`);
    }
  }
  return true;
}

function tickRuinGround(notes) {
  Object.keys(state.fields || {}).forEach(z => {
    const f = state.fields[z];
    if (!f || !f.ruinOn) return;
    if (f.ruinMax == null) f.ruinMax = Math.max(20, Number(f.ruinHp) || 30);
    const grounds = state.units.filter(u => !u.hidden && !u.dead && Number(u.zone) === Number(z) && !u.flying);
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
  if (f.energy) a.push("能量场" + (f.energyVal ? f.energyVal : ""));
  if (f.harmonic) a.push("干涉");
  if (f.heal) a.push("治愈");
  if (f.highland) a.push("高地");
  if (f.abyss) a.push("深渊");
  if (f.isolate) a.push("隔离");
  if (f.fieldLock) a.push("锁定:" + f.fieldLock);
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
      ${u.noPosture || u.kit === "ufo_leg" ? "" : `<div class="bar-label"><span>架势</span><span>${u.def}/${u.defMax}</span></div>
      <div class="bar def-bar"><span style="width:${Math.max(0, Math.min(100, (Number(u.def) / Math.max(1, Number(u.defMax))) * 100))}%"></span></div>`}
    </div>
    <div class="token-atk">ATK ${effectiveAtk(u, state.units)}</div>
    <div class="status-line">${escapeHtml([st, flags.join(" ")].filter(Boolean).join(" · "))}</div>
  `;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onUnitClick(u.id);
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearUnitSelection();
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
        doMove(u, dest);
      });
      wrap.appendChild(b);
    });
  }
  return wrap;
}

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
    conductor: "导体", anchor: "千钧", store: "蓄能", doppler: "多普勒"
  })[k] || k;
}

function fieldUnits() {
  return state.units.filter(u => u && u.id && !u.hidden && !u.dead);
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
    if (Number(state.zoneMode) === 3 && Number(u.zone) === 2) return "2区无风向（沙尘回复仍翻倍）";
    return "无风向";
  }
  if (w > 0) return u.flying ? "顺风·空中（+1 行动点）" : "顺风·地面（+1 附赠行动）";
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
    b.onclick = () => doMove(u, dest);
    moveBox.appendChild(b);
  });
  drawLayers(u);
  const bind = (id, fn) => {
    const el = uiEl(id);
    if (!el) return;
    el.addEventListener("input", fn);
    el.addEventListener("change", fn);
  };
  bind("edName", () => { u.name = uiEl("edName").value; renderZones(); renderSelects(); });
  bind("edLv", () => u.level = Number(uiEl("edLv").value) || 1);
  bind("edZone", () => {
    const dest = Number(uiEl("edZone").value);
    if (Math.abs(dest - Number(u.zone)) === 1) doMove(u, dest);
    else {
      snapshot();
      u.zone = dest;
      paintSkillLog(`${u.name} 被直接放到 ${dest} 区（GM 强制换位，不走移动规则）。`);
      renderAll();
    }
  });
  bind("edAtk", () => u.atk = Number(uiEl("edAtk").value) || 0);
  bind("edDef", () => { u.def = Number(uiEl("edDef").value) || 0; renderZones(); });
  bind("edDefMax", () => u.defMax = Number(uiEl("edDefMax").value) || 0);
  bind("edHE", () => {
    u.highEnergy = Number(uiEl("edHE").value) || 0;
    checkHighBoom(u);
    renderAll();
  });
  bind("edFly", () => { u.flying = uiEl("edFly").checked; renderZones(); });
  bind("edStun", () => { u.stunned = uiEl("edStun").checked; renderZones(); });
  bind("stBurn", () => u.statuses.burn = Number(uiEl("stBurn").value) || 0);
  ["Shock","Corr","Frost","Wave","High","Reso","Un","Weak","Insp","Hide","Adv"].forEach(key => {
    const map = {
      Shock: ["shock"], Corr: ["corr"], Frost: ["frostbite"], Wave: ["shockwave"],
      High: ["high"], Reso: ["reso"], Un: ["unstable"], Weak: ["weak"], Insp: ["inspire"],
      Hide: ["hide"], Adv: ["advantage"]
    };
    bind("st" + key, () => {
      u.statuses[map[key][0]] = uiEl("st" + key).checked;
      if (key === "Wave" && typeof syncShockwave === "function") syncShockwave(u, null);
    });
  });
  const imap = { inMelt: "melt", inSting: "sting", inOver: "overload", inShift: "shift", inSpread: "spread", inRef: "refract" };
  Object.keys(imap).forEach(id => bind(id, () => { u.instant[imap[id]] = uiEl(id).checked; }));
  const neu = uiEl("btnNeutralize");
  if (neu) neu.onclick = () => {
    snapshot();
    const notes = applyNeutralize(u);
    appendLog(notes.join("\n") || `${u.name} 身上没有可中和的属性状态。`);
    renderAll();
  };
  bind("edSelf", () => {
    u.self = uiEl("edSelf").value;
    if (u.self === "burn") u.selfBurnStacks = Math.max(1, Number(u.selfBurnStacks) || 1);
    else u.selfBurnStacks = 0;
    renderZones();
  });
  bind("edLatest", () => u.statuses.latestElement = uiEl("edLatest").value || null);
  ["combust","icebreak","bolt","etch","backflow","inertia","diffract"].forEach(id => {
    bind("fxHang_" + id, () => {
      u.resources = u.resources || {};
      const on = uiEl("fxHang_" + id).checked;
      let cur = hungAtkFx(u);
      if (on && cur.indexOf(id) < 0) cur.push(id);
      if (!on) cur = cur.filter(x => x !== id);
      u.resources.nextAtkFx = cur;
      renderZones();
    });
  });
  uiEl("addLayer").onclick = () => {
    u.layers.push({ type: "flesh", current: 10, max: 10 });
    drawLayers(u); renderZones();
  };
  uiEl("delUnit").onclick = () => {
    snapshot();
    state.units = state.units.filter(x => x.id !== u.id);
    if (state.selectedId === u.id) state.selectedId = null;
    if (state.attackerId === u.id) state.attackerId = null;
    if (state.targetId === u.id) state.targetId = null;
    renderAll();
  };
  uiEl("copyUnit").onclick = () => {
    snapshot();
    const c = clone(u);
    c.id = uid();
    c.name = u.name + " 复制";
    state.units.push(c);
    renderAll();
  };
  uiEl("fullDef").onclick = () => { u.def = u.defMax; renderAll(); };
  uiEl("saveThisCard").onclick = () => saveUnitToRoster(u, true);
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
      u.layers[i][f] = f === "type" ? el.value : Number(el.value);
      renderZones();
    });
  });
  box.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      u.layers.splice(Number(btn.dataset.del), 1);
      drawLayers(u); renderZones();
    });
  });
}

function fillFromSuggest(u) {
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

function diceValueNow() {
  const n = Number(uiEl("diceN").value) || 0;
  const s = Number(uiEl("diceS").value) || 0;
  const b = Number(uiEl("diceB").value) || 0;
  const mode = uiEl("diceMode").value;
  if (mode === "manual") return { value: Number(uiEl("diceManual").value) || 0, text: "手动 " + uiEl("diceManual").value };
  if (mode === "roll") {
    const r = rollDice(n, s, b);
    uiEl("diceManual").value = r.total;
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

function doCalc() {
  const attacker = unitById(uiEl("attackerSel").value);
  const targetTok = uiEl("targetSel").value;
  if (targetTok && (String(targetTok).indexOf("gap:") === 0 || String(targetTok).indexOf("prop:") === 0)) {
    hitStructure(attacker, targetTok, {
      element: uiEl("element").value,
      dmg: Number(uiEl("atk").value) * Number(uiEl("mult").value) + Number(uiEl("flat").value),
      brk: Number(uiEl("baseBreak").value) || 1
    });
    return;
  }
  const target = unitById(targetTok);
  state.attackerId = attacker ? attacker.id : null;
  state.targetId = target ? target.id : null;
  let dice = diceValueNow();
  const flags = collectFlags();
  if (shouldDiceMin(attacker)) {
    const n = Number(uiEl("diceN").value) || 0;
    const b = Number(uiEl("diceB").value) || 0;
    if (uiEl("diceMode").value !== "manual") {
      dice = { value: n + b, text: `决一死战取最低 ${n}×1${b ? "+" + b : ""} = ${n + b}` };
    }
    flags.diceMin = true;
  }
  const bearer = shieldBearer(target);
  if (bearer && flags.action) flags.holyShield = true;
  const dist = attacker && target ? zoneDist(attacker.zone, target.zone, state.zoneMode) : 0;
  const res = resolveAttack({
    attacker, target,
    atk: Number(uiEl("atk").value),
    mult: Number(uiEl("mult").value),
    flat: Number(uiEl("flat").value),
    diceValue: dice.value,
    element: uiEl("element").value,
    baseBreak: Number(uiEl("baseBreak").value),
    hits: Number(uiEl("hits").value),
    flags,
    weather: currentWeatherFor(target),
    phaseStep: Number(state.phaseStep),
    zoneMode: state.zoneMode,
    attackerField: attacker ? state.fields[attacker.zone] : {},
    targetField: target ? state.fields[target.zone] : {},
    highA: attacker && state.fields[attacker.zone] && state.fields[attacker.zone].highland,
    highT: target && state.fields[target.zone] && state.fields[target.zone].highland,
    dist,
    atkRange: uiEl("atkRange").value
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

function doApply() {
  if (!state.lastResult || !state.lastResult.ok) { doCalc(); }
  const attacker = unitById(uiEl("attackerSel").value);
  const target = unitById(uiEl("targetSel").value);
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

function advancePhaseWeather() {
  const notes = [];
  if (state.weather !== "phase") return notes;
  state.phaseStep = (Number(state.phaseStep) + 1) % 4;
  const sel = uiEl("phaseStep");
  if (sel) sel.value = String(state.phaseStep);
  notes.push(`相位天气进入下一阶段：${phaseWeatherName(state.phaseStep)}（${state.phaseStep}）。`);
  return notes;
}

function phaseLabelText() {
  if (!state.combatStarted) return "未开始";
  return state.combatPhase === "enemy" ? "敌人回合" : "玩家回合";
}

function startCombat() {
  if (state.combatStarted) return false;
  state.combatStarted = true;
  state.combatPhase = "player";
  // 按我方实际上场人数平衡敌人（开战前改过队伍也能跟上）
  const partyN = typeof syncPartySizeFromField === "function" ? syncPartySizeFromField() : state.partySize;
  const balanceNotes = typeof rebalanceEnemiesForParty === "function" ? rebalanceEnemiesForParty(partyN) : [];
  applyExhaustionAtStart(balanceNotes);
  // 开战前的布置记录算「第 0 回合」，开战后的第一回合才是第 1 回合
  const prePage = state.logPages[state.logPages.length - 1];
  if (prePage && prePage.lines.length) prePage.turn = 0;
  state.turnNo = 1;
  beginRound([]);
  startPlayerPhase();
  appendLog("战斗开始。回合开始效果已结算。", "sep");
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

function refreshEnemyEconomy(u) {
  if (!u || u.isPlayer) return;
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
    if (u.flying && w < 0) ap -= 1;
    if (!u.flying && w > 0) bonus += 1;
  }
  u.ap = Math.max(0, ap);
  u.apMax = u.ap;
  u.bonus = Math.max(0, bonus);
  u.bonusMax = Math.max(u.bonus, bonus);
}

function beginRound(notes) {
  notes = notes || [];
  startLogTurn();
  if (typeof mutinyTick === "function") mutinyTick(notes);
  if (typeof syncBpAll === "function") syncBpAll();
  state.units.forEach(u => {
    if (u.kit === "xia" && isCrushing(u)) {
      const ct = crushingTarget(u);
      u.zone = Number(ct.zone);
      notes.push(...crushOnce(u, ct, true));
    }
    if (u.kit === "nora" && (typeof passiveOn !== "function" || passiveOn(u))) {
      u.resources = u.resources || {};
      if (u.resources.forceCruelNext) {
        u.resources.forceCruelNext = false;
        setMood(u, "cruel", notes, "压力升高");
      } else if (Math.random() < 1 / 3) {
        flipMood(u, notes, "双相冲动");
      }
      const pinBefore = u.resources.piercedId;
      if (pinBefore && !piercedTarget(u)) notes.push("刺入目标已超出距离 1，刺入结束。");
    }
    if (u.instant && u.instant.shift) {
      clearShift(u);
      notes.push(`${u.name} 错位结束，血层顺序恢复。`);
    }
    if (typeof overloadRoundStart === "function" && overloadRoundStart(u, notes)) u._noShieldRefill = true;
    if (typeof meltShieldRoundStart === "function" && meltShieldRoundStart(u, notes)) u._noShieldRefill = true;
    if (u.resources && u.resources.frostShell) { u.resources.frostShell = false; notes.push(`${u.name} 再次霜结的完全免疫结束。`); }
    if (typeof selfImmunities === "function") selfImmunities(u, notes);
    if (typeof syncShockwave === "function") syncShockwave(u, notes);
    // 即时效果都是单回合的：没被用掉的也在回合开始时失效
    if (u.instant) {
      const gone = [];
      if (u.instant.melt) { u.instant.melt = false; gone.push("熔融"); }
      if (u.instant.sting) { u.instant.sting = false; gone.push("刺骨"); }
      if (u.instant.spread) { u.instant.spread = false; gone.push("扩散"); }
      if (u.instant.refract) { u.instant.refract = false; gone.push("折射"); }
      if (gone.length) notes.push(`${u.name} ${gone.join("、")}结束。`);
    }
    if (!u.stunned && (u.def || 0) > 0) u._imbalanceLock = false;
    if (u.kit === "livesand" && u.resources && u.resources.giant && !u.dead) {
      u.resources.giantTurns = (u.resources.giantTurns || 0) + 1;
    }
    if (u.resources) u.resources.blockUsedThisTurn = false;
    if (u.kit === "xia" && u.resources) {
      if (u.resources.engine && !u.resources.attackedThisTurn && !u.resources.engineJustOn) {
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
    if (u.kit === "watchcrow") {
      u.resources = u.resources || {};
      u.resources.reflect = true;
      notes.push(`${u.name}：本回合第一次受到的攻击伤害将以能量属性反弹（不反弹击破）。`);
    }
    if (u.kit === "spreader") {
      const f = state.fields[u.zone] || emptyField();
      const err = setZoneField(u.zone, "acid");
      notes.push(err || `${u.name} 低空作业：${u.zone} 区生成酸液地面（自身飞行免疫）。`);
    }
    if (u.kit === "chixia" && u.resources) u.resources.cover = false;
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
          const guard = p.build(u.level, state.partySize);
          guard.zone = u.zone;
          state.units.push(guard);
          notes.push(`十级被动：召唤 ${guard.name}。`);
        }
      }
    }
  });
  Object.keys(state.fields || {}).forEach(z => {
    const f = state.fields[z];
    if (!fieldFireOn(f)) return;
    f.fireOn = true;
    if (!(Number(f.fire) > 0)) f.fire = 1;
    const stacks = Number(f.fire) || 1;
    fieldUnits().filter(u => Number(u.zone) === Number(z) && !u.flying && !u.dead).forEach(u => {
      const weather = currentWeatherFor(u);
      const d = statusDotDice("firefield", u.level, weather);
      const parts = [];
      let dmg = 0;
      for (let i = 0; i < stacks; i++) {
        const r = takeDice(d.n, d.s, 0);
        dmg += r.total;
        parts.push(r.text);
      }
      applyTypedDot(u, dmg, "fire", notes, `${u.name} 火场${stacks}层 ${parts.join(" + ")} = ${dmg}`);
    });
    const add = state.weather === "heat" ? 2 : 1;
    f.fire += add;
    notes.push(`${z} 区火场先结算伤害，然后层数 +${add} → ${f.fire}${state.weather === "heat" ? "（酷暑）" : ""}`);
  });
  tickRuinGround(notes);
  state.units.forEach(u => {
    u.lostDefThisTurn = 0;
    const weather = currentWeatherFor(u);
    const f = state.fields[u.zone] || emptyField();
    if (f.energy) {
      const s = leveledSides(u.level || 1, 4);
      const r = takeDice(1, s, 0);
      f.energyVal = (f.energyVal || 0) + r.total;
      notes.push(`${u.name} 所在能量场累积 ${r.text} → 场地高能 ${f.energyVal}`);
    }
    if (f.acid && !u.flying) {
      const d = statusDotDice("acidfield", u.level, weather);
      const r = takeDice(d.n, d.s, 0);
      applyTypedDot(u, r.total, "acid", notes, `${u.name} 酸液地面 ${r.text}`);
    }
    if (f.heal) {
      const d = statusDotDice("healfield", u.level, weather);
      const r = takeDice(d.n, d.s, 0);
      healUnit(u, r.total);
      notes.push(`${u.name} 治愈场地 ${r.text} → +${r.total}`);
    }
    if (f.ice && !u.flying) {
      notes.push(`${u.name} 处于冻土：对冰强制 25% 易伤。离开或进入时会自动结算运动检定与冰击破。`);
    }
    convertUnstableInHv(u, notes);
    if (u.stunned && u.self === "burn") {
      u.self = "none";
      u.selfBurnStacks = 0;
      notes.push(`${u.name} 晕眩，自焚结束。`);
    }
    if (u.self === "burn") {
      notes.push(...tickSelfBurn(u, true));
    }
    if (u.self === "frost") {
      const extra = weather === "snow" ? 2 : 1;
      dealBreak(u, extra, "ice", notes, "霜结");
    }
    if (u.self === "store") {
      u.highEnergy = (u.highEnergy || 0) + (u.level || 1);
      notes.push(`${u.name} 蓄能 +${u.level} → ${u.highEnergy}`);
      checkHighBoom(u);
    }
    if (weather === "acid" && u.self === "splash") {
      healUnit(u, u.level || 1);
      notes.push(`${u.name} 酸雨溅射回复 ${u.level}`);
    }
    const sand = (u.layers || []).find(l => l.type === "sand");
    if (u.kit === "tou" && u.resources && (typeof passiveOn !== "function" || passiveOn(u))) {
      u.resources.shield = Math.min(3, (u.resources.shield || 0) + 1);
      notes.push(`${u.name} 圣盾 +1 → ${u.resources.shield}`);
    }
    if (weather === "sand") {
      notes.push(`${u.name} ${sandWindActionText(u)}`);
    }
    if (sand && !u.sandLocked) {
      let regen = u.level || 1;
      if (weather === "sand") regen *= 2;
      sand.current = Math.min(sand.max, Number(sand.current) + regen);
      notes.push(`${u.name} 沙尘恢复 ${regen}${weather === "sand" ? "（沙暴翻倍，与风向无关）" : ""}`);
    }
    if (!u.gotHitThisTurn && !u._noShieldRefill) {
      (u.layers || []).forEach(l => {
        if (l.type === "shield") l.current = l.max;
      });
    }
    u._noShieldRefill = false;
    u.gotHitThisTurn = false;
    u.damagedThisTurn = 0;
    u.sandLocked = false;
  });
  Object.keys(state.fields || {}).forEach(z => {
    const f = state.fields[z];
    if (!f || !f.energy || !(f.energyVal > 0)) return;
    const pool = fieldUnits().filter(u => Number(u.zone) === Number(z) && totalHp(u) > 0);
    if (!pool.length) return;
    pool.sort((a, b) => totalHp(a) - totalHp(b));
    const low = pool[0];
    const hp = totalHp(low);
    const combined = (low.highEnergy || 0) + f.energyVal;
    notes.push(`${z} 区能量场高能 ${f.energyVal}，最低血 ${low.name} ${hp}${low.statuses && low.statuses.high ? "（含自身高能 " + (low.highEnergy || 0) + "）" : ""}。`);
    if (hp < combined) {
      notes.push(`${low.name} 生命低于高能阈值，自爆。`);
      low.highEnergy = combined;
      explodeHigh(low);
    }
  });
  appendLog(notes.join("\n"));
}

function startPlayerPhase() {
  const notes = ["—— 玩家回合 ——"];
  state.combatPhase = "player";
  state.units.forEach(u => {
    if (!u.isPlayer || u.hidden || u.dead) return;
    const wasStun = !!u.stunned;
    refreshEconomy(u);
    if (wasStun) {
      recoverFromStun(u, notes);
      notes.push(`${u.name} 晕眩：本回合不获得行动点与附赠动作。`);
    }
    if (u.resources && u.resources.gambitArmed) {
      u.resources.gambitArmed = false;
      u.resources.gambitStrike = true;
      u.resources.gambitWound = true;
      notes.push(`${u.name} 破釜沉舟生效：本回合攻击双倍，直到下次行动前受伤双倍。`);
    }
    if (u.kit === "ras" && u.resources && !u.stunned && (typeof passiveOn !== "function" || passiveOn(u))) {
      addRasEnergy(20, "玩家回合开始");
      notes.push("拉斯缪尔回合开始累积能量 +20%。");
    }
    if (u.resources && u.resources.preparedPending) {
      const n = 1 + milestone(u.level || 1, 5);
      u.resources.preparedActive = true;
      u.resources.preparedPending = false;
      notes.push(`${u.name} 「准备」生效：本回合第一次攻击裸伤害 +${n}d6，吃倍率和增伤。`);
    }
  });
  appendLog(notes.join("\n"));
  renderAll();
}

function startEnemyPhase() {
  const notes = ["—— 敌人回合 ——"];
  state.combatPhase = "enemy";
  state.units.forEach(u => {
    if (u.kit === "torque" && u.resources && u.resources.acidCharge != null && !u.hidden && !u.dead) {
      const z = Number(u.resources.acidCharge);
      u.resources.acidCharge = null;
      notes.push(`扭矩酸液炮蓄力在 ${z} 区爆发。`);
      const atk = effectiveAtk(u, state.units);
      visibleEnemies(z).forEach(t => {
        const out = dealTo(u, t, { element: "acid", mult: 1, baseBreak: 1, atk, flags: { action: true, aoe: true } });
        (out.extra || []).forEach(s => notes.push(s));
      });
    }
  });
  state.units.forEach(u => {
    if (u.isPlayer || u.hidden || u.dead) return;
    if (u.stunned) {
      recoverFromStun(u, notes);
      u.ap = 0; u.apMax = 0; u.bonus = 0; u.bonusMax = 0;
      notes.push(`${u.name} 敌人回合开始时晕眩：解除晕眩并回满架势，本回合不获得行动点。`);
    } else {
      refreshEnemyEconomy(u);
      if (u.kit === "mecha_gl" && u.resources && u.resources.glPending && u.resources.glZone && !u.resources.glReady) {
        u.resources.glReady = true;
        notes.push(`${u.name} 榴弹已就绪，可对 ${u.resources.glZone} 区发射。`);
      }
    }
  });
  appendLog(notes.join("\n"));
  renderAll();
}

function endPlayerTurn() {
  snapshot();
  state.units.forEach(u => {
    if (u.resources && u.resources.preparedActive) {
      u.resources.preparedActive = false;
      appendLog(`${u.name} 本回合未打出第一次攻击，「准备」消失。`);
    }
  });
  appendLog("玩家回合结束。");
  startEnemyPhase();
}

function endEnemyTurn() {
  snapshot();
  appendLog("敌人回合结束。");
  turnEnd();
}

function turnEnd() {
  snapshot();
  const notes = ["—— 回合结束 ——"];
  state.units.forEach(u => {
    const weather = currentWeatherFor(u);
    if (typeof selfImmunities === "function") selfImmunities(u, notes);
    if (typeof syncShockwave === "function") syncShockwave(u, notes);
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
      applyTypedDot(u, dmg, "fire", notes, `${u.name} 灼烧${stacks}层分别掷骰 ${parts.join(" + ")} = ${dmg}`);
      let add = 1;
      if (weather === "heat") add += 1;
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
      const d = statusDotDice("corr", u.level, weather, armor);
      const r = takeDice(d.n, d.s, 0);
      applyTypedDot(u, r.total, "acid", notes, `${u.name} 腐蚀 ${r.text}`);
    }
    if (u.statuses.frostbite) {
      let br = weather === "snow" ? 2 : 1;
      if (u.frostbiteBreakOverride != null) {
        br = Number(u.frostbiteBreakOverride) || 0;
        notes.push(`${u.name} 破冰：冻伤击破改为本次记录值 ${br}`);
        u.frostbiteBreakOverride = null;
      }
      if (weather === "heat") {
        notes.push(`${u.name} 酷暑：冻伤触发一次后结束`);
        u.statuses.frostbite = false;
      }
      dealBreak(u, br, "ice", notes, "冻伤");
    }
    // 过载：护盾在下回合开始时清零（effects.js · overloadRoundStart）
    if (u.statuses && u.statuses.inspire && !u.statuses.inspireStay) {
      u.statuses.inspire = false;
      notes.push(`${u.name} 振奋结束`);
    }
    if (u.kit === "dustbody" && !u.stunned) {
      const sand = (u.layers || []).find(l => l.type === "sand");
      if (sand) {
        sand.current = Math.min(sand.max, sand.current + (u.level || 1));
        notes.push(`${u.name} 悬沙：沙尘 +${u.level}。`);
      }
    }
    if (u.kit === "boomcar" && u.resources && u.resources.fuse != null) {
      u.resources.fuse -= 1;
    }
    if (u.kit === "ruby" && u.resources && u.resources.mecha) {
      u.resources.nano = Math.max(0, (u.resources.nano || 0) - 20);
      notes.push(`${u.name} 机甲维持：纳米 −20 → ${u.resources.nano}`);
      if (u.resources.nano <= 0) notes.push(...exitMecha(u, "纳米耗尽，机甲结束"));
    }
    if (u.noMove) {
      u.noMove = false;
      notes.push(`${u.name} 解除禁足`);
    }
    if (u.coverBy) u.coverBy = null;
    if (u.resources) {
      if (u.resources.gritTurn) { u.resources.gritTurn = false; notes.push(`${u.name} 咬牙坚持结束。`); }
      if (u.resources.standTurn) { u.resources.standTurn = false; notes.push(`${u.name} 屹立不倒结束。`); }
      if (u.resources.guardStrike) { u.resources.guardStrike = false; u.resources.guardStrikeUsed = false; }
      if (u.resources.allReflect) u.resources.allReflect = false;
      if (u.resources.gambitStrike) u.resources.gambitStrike = false;
    }
    if (u.shelterTurn) { u.shelterTurn = false; u.isolate = false; }
    if (u.harshEnv) u.harshEnv = false;
    if (u.instant && u.instant.doubleStatus) u.instant.doubleStatus = false;
    if (u.instant && u.instant.omenArmed) {
      if (u.stunned) {
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
    if (u.instant && u.instant.goldHold) {
      u.instant.goldHold = false;
      notes.push(`${u.name} 黄金时间：即时效果再保留一回合。`);
    } else if (u.instant) {
      ["melt", "sting", "overload", "shift", "spread", "refract"].forEach(k => {
        /* 即时效果默认回合结束不清，由施加者或黄金时间处理 */
      });
    }
  });
  (state.props || []).filter(p => p.kind === "ironwall").forEach(p => {
    if (p.hp > 0 && !p._brokeWall) {
      addCharge(2);
      notes.push("铁壁撑过回合，川川电能 +2。");
    }
    state.props = (state.props || []).filter(x => x.id !== p.id);
  });
  (state.props || []).forEach(p => {
    if (p.kind === "acid" && p.hp < 3) {
      const pool = state.units.filter(u => !u.hidden && Number(u.zone) === Number(p.zone));
      if (pool.length) {
        const u = pool[Math.floor(Math.random() * pool.length)];
        const dmg = 4 + (p.level || 1);
        const fake = unitOf("酸液桶", p.level, [{ type: "armor", hp: 1 }], 0, 0);
        fake.zone = p.zone;
        dealTo(fake, u, { atk: 0, mult: 0, flat: dmg, element: "acid", baseBreak: 0, flags: { action: false } });
        notes.push(`酸液桶渗漏：随机打到 ${u.name}，${dmg} 酸伤。`);
      }
    }
    if (p.kind === "turret") {
      const foes = state.units.filter(u => !u.hidden && !!u.isPlayer === (p.faction === "enemy"));
      if (foes.length) {
        foes.sort((a, b) => (b.atk || 0) - (a.atk || 0));
        const u = foes[0];
        u.statuses.high = true;
        u.highApplyTurn = state.turnNo;
        const dmg = p.level || 1;
        const fake = unitOf("防卫炮台", p.level, [{ type: "armor", hp: 1 }], 0, dmg);
        fake.zone = p.zone;
        dealTo(fake, u, { atk: dmg, mult: 1, hits: 2, element: "energy", baseBreak: 0, flags: { action: true } });
        notes.push(`防卫炮台锁定 ${u.name}：施加高能，并打出 2 次 ${dmg} 能量。`);
      }
    }
  });
  state.units.forEach(u => {
    if (u && u._shieldRestoreAtTurnEnd) {
      (u.layers || []).forEach(l => {
        if (l.type === "shield") l.current = l.max || l.current;
      });
      u._shieldRestoreAtTurnEnd = false;
      notes.push(`${u.name} 护盾在回合结束时回满（中和·感电）。`);
    }
  });
  if ((state.props || []).some(p => p.kind === "battery")) {
    notes.push(...refillBatteryFactionShields());
  }
  notes.push(...advancePhaseWeather());
  appendLog(notes.join("\n"));
  beginRound([]);
  startPlayerPhase();
  presentAssistModal();
  presentBlockModal();
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
  const dmg = Math.max(d.min || 1, r.total);
  const allies = fieldUnits().filter(u =>
    !u.dead && !u.hidden &&
    !ignoresAoe(u) &&
    Number(u.zone) === Number(source.zone) &&
    !!u.isPlayer === !!source.isPlayer
  );
  notes.push(`${source.name} 感电触发 ${r.text} → ${dmg} 电击（同区同阵营：${allies.map(u => u.name).join("、") || "无"}）`);
  allies.forEach(u => {
    applyTypedDot(u, dmg, "electric", notes, `${u.name} 被感电波及`);
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
    applyTypedDot(o, share, element || "harmonic", notes, `共振←${source.name}`);
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
    o._resoBusy = true;
    o.statuses = o.statuses || {};
    if (key === "burn") o.statuses.burn = (Number(o.statuses.burn) || 0) + 1;
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

function beginActionAcc(actor) {
  state.actionAcc = {
    dmg: 0, brk: 0, hits: 0, calls: 0, targets: [],
    side: 0, sideBy: {},   // 连带伤害：感电、高压场地、灼烧、共振、聚焦抹层等
    actorIsPlayer: actor ? !!actor.isPlayer : null
  };
  state.actionWallHit = {};
}

/** 记一笔本行动引发的连带伤害（不是攻击本身，而是状态、场地、余波等）。
 *  只算打在对面阵营身上的；不知道出手方时全算。 */
function noteSideDamage(amount, label, unit) {
  const acc = state.actionAcc;
  const n = Math.floor(Number(amount) || 0);
  if (!acc || n <= 0) return;
  if (unit && acc.actorIsPlayer != null && !!unit.isPlayer === acc.actorIsPlayer) return;
  const key = label || "其他";
  acc.side += n;
  acc.sideBy[key] = (acc.sideBy[key] || 0) + n;
}

function ironWallIn(zone) {
  return (state.props || []).find(p => p.kind === "ironwall" && Number(p.zone) === Number(zone) && p.hp > 0);
}

function breakIronWall(p, notes) {
  notes = notes || [];
  if (!p || p._brokeWall) return notes;
  p._brokeWall = true;
  p.hp = 0;
  const c = findKit("chuan", state.units);
  if (c) {
    dealBreak(c, 3, "physical", notes, "铁壁被击破");
  }
  state.props = (state.props || []).filter(x => x.id !== p.id);
  notes.push("铁壁碎裂并移出战场。");
  return notes;
}

function absorbIronWall(attacker, zone, opt) {
  const notes = [];
  const p = ironWallIn(zone);
  if (!p) return null;
  state.actionWallHit = state.actionWallHit || {};
  if (state.actionWallHit[p.id]) {
    notes.push("铁壁已拦截本次行动，其余同区伤害被挡住。");
    return { blocked: true, already: true, notes };
  }
  state.actionWallHit[p.id] = true;
  const dummy = unitOf("铁壁", p.level || 1, [{ type: "armor", hp: p.hp }], 999, 0, { noPosture: true });
  dummy.zone = zone;
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
    targetField: state.fields[zone] || {},
    dist: 0,
    atkRange: "any"
  });
  const dmg = Math.floor(res.total || 0);
  p.hp = Math.max(0, p.hp - dmg);
  notes.push(`铁壁替同区承受本次攻击：${dmg} 伤害 → 剩余 ${p.hp}/${p.maxHp}。`);
  if (p.hp <= 0) notes.push(...breakIronWall(p, []));
  return { blocked: true, already: false, notes, dmg, res };
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
  if (!(Number(amount) > 0)) return notes;
  const f = state.fields[target.zone] || {};
  if (!f.electric) return notes;
  const weather = currentWeatherFor(target);
  const d = statusDotDice("hvfield", target.level || 1, weather);
  const r = takeDice(d.n, d.s, 0);
  let dmg = r.total;
  if (target.harshEnv || state.apocalypse) dmg *= 2;
  target._hvBusy = true;
  const tag = (hitMax > 1) ? `第${hitNo}/${hitMax}击 ` : "";
  applyTypedDot(target, dmg, "electric", notes, `${target.name} 高压场地${tag}${r.text}${dmg !== r.total ? "×2" : ""}`);
  target._hvBusy = false;
  return notes;
}

function convertUnstableInHv(u, notes) {
  if (!u || !u.statuses || !u.statuses.unstable) return;
  const f = state.fields[u.zone] || {};
  if (!f.electric) return;
  u.statuses.unstable = false;
  if (!u.stunned) {
    u.stunned = true;
    if (notes) notes.push(`${u.name} 在高压场地：不稳直接转为晕眩。`);
  }
}

function applyTypedDot(unit, amount, element, notes, label, opts) {
  opts = opts || {};
  if (ignoresAoe(unit)) {
    notes.push(`${unit.name} 是飞碟触灵本体，不受该范围/余波伤害。`);
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
  notes.push(...applyCombat(unit, res, null));
  notes.push(label + ` → 实伤 ${Math.floor(res.total || 0)}`);
  if (typeof afterDamageTaken === "function") afterDamageTaken(unit, element, res.total || 0, Math.max(0, shieldBefore - shieldSum(unit)), notes, {});
  const sdKey = inferStatusDmgKey(label, element);
  addStatusDmg(sdKey, res.total || amount);
  noteSideDamage(res.total || 0, STATUS_DMG_NAME[sdKey] || "其他", unit);
  if ((res.intended || res.total || 0) > 0) spawnFloater(unit, res.intended || res.total, element);
  if ((res.extraHarmonic || 0) > 0) spawnFloater(unit, res.extraHarmonic, element);
  checkHighBoom(unit);
  if (!unit._resoBusy) notes.push(...pulseResonanceDamage(unit, res.total || amount, element));
  if (!unit._hvBusy && !/高压场地/.test(String(label || ""))) {
    notes.push(...pulseHighVoltage(unit, res.total || amount));
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
      state.pcLayers[i][f] = f === "type" ? el.value : Number(el.value);
      if (f === "max" && !Number(state.pcLayers[i].current)) state.pcLayers[i].current = Number(el.value);
    });
  });
  box.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (state.pcLayers.length <= 1) return;
      state.pcLayers.splice(Number(btn.dataset.del), 1);
      renderPcLayers();
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

function unitFromForm() {
  const f = readPlayerForm();
  const u = unitOf(f.name, f.level, f.layers, f.def, f.atk, {
    isPlayer: true, flying: f.flying, range: f.range, element: f.element
  });
  u.zone = f.zone;
  u.layers = f.currentLayers.map(l => ({ type: l.type, current: l.current, max: l.max }));
  u.suggest.element = f.element;
  return u;
}

function fillFormFromCard(card) {
  uiEl("pcName").value = card.name || "";
  uiEl("pcLv").value = card.level || 1;
  uiEl("pcZone").value = String(card.zone || 1);
  uiEl("pcAtk").value = card.atk || 0;
  uiEl("pcDef").value = card.defMax || card.def || 0;
  uiEl("pcRange").value = card.range || "any";
  uiEl("pcElem").value = (card.suggest && card.suggest.element) || "physical";
  uiEl("pcFly").checked = !!card.flying;
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
  uiEl("pcAddLayer").onclick = () => {
    state.pcLayers.push({ type: "flesh", current: 10, max: 10 });
    renderPcLayers();
  };
  const liveSel = uiEl("liveKitSel");
  if (liveSel) {
    liveSel.innerHTML = livePartyCards().filter(c => !c.weaponOf).map(c =>
      `<option value="${c.kit}">${escapeHtml(c.name)} · ${escapeHtml(c.note || c.kit)}</option>`).join("");
  }
  const addKitBtn = uiEl("btnAddLiveKit");
  if (addKitBtn) addKitBtn.onclick = () => {
    const kit = uiEl("liveKitSel").value;
    const card = livePartyCards().find(c => c.kit === kit);
    if (!card) return;
    if (state.units.some(u => u.kit === kit && !u.hidden)) {
      setRosterHint(`${card.name} 已在场上。`);
      return;
    }
    snapshot();
    const zone = Number(uiEl("pcZone").value) || 1;
    const u = spawnLiveCard(card, zone);
    u.weaponHeld = true;
    u.atk = (u.personalAtk || 0) + (u.weaponAtk || 0);
    state.units.push(u);
    state.selectedId = u.id;
    state.attackerId = u.id;
    renderAll();
    setRosterHint(`已加入「${u.name}」到 ${zone} 区。用技能唤出武器人。`);
    uiEl("playerModal").classList.add("hidden");
  };
  uiEl("btnAddPlayer").onclick = () => {
    snapshot();
    const u = unitFromForm();
    state.units.push(u);
    state.selectedId = u.id;
    state.attackerId = u.id;
    renderAll();
    setRosterHint(`「${u.name}」已加入 ${u.zone} 区。若要下次直接用，再点「保存到卡组」。`);
    uiEl("playerModal").classList.add("hidden");
  };
  uiEl("btnSavePlayer").onclick = saveFormToRoster;
  uiEl("btnSaveSelected").onclick = () => {
    const u = unitById(state.selectedId);
    saveUnitToRoster(u, true);
  };
  uiEl("btnLoadRoster").onclick = () => {
    const id = uiEl("rosterSel").value;
    const card = state.roster.find(c => c.cardId === id);
    if (!card) { setRosterHint("先在卡组里选一张。"); return; }
    snapshot();
    const u = spawnFromCard(card);
    state.units.push(u);
    state.selectedId = u.id;
    state.attackerId = u.id;
    renderAll();
    setRosterHint(`已从卡组加入「${u.name}」。`);
    uiEl("playerModal").classList.add("hidden");
  };
  uiEl("btnEditRoster").onclick = () => {
    const id = uiEl("rosterSel").value;
    const card = state.roster.find(c => c.cardId === id);
    if (!card) return;
    fillFormFromCard(card);
    setRosterHint(`已把「${card.name}」载入表单，改完后点保存会覆盖同名卡。`);
  };
  uiEl("btnDelRoster").onclick = () => {
    const id = uiEl("rosterSel").value;
    const card = state.roster.find(c => c.cardId === id);
    if (!card) return;
    state.roster = state.roster.filter(c => c.cardId !== id);
    persistRoster();
    setRosterHint(`已删除「${card.name}」。`);
  };
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
        list.forEach(card => {
          if (!card.cardId) card.cardId = "c" + Math.random().toString(36).slice(2, 9);
          const i = state.roster.findIndex(c => c.name === card.name);
          if (i >= 0) state.roster[i] = Object.assign({}, state.roster[i], card, { cardId: state.roster[i].cardId });
          else state.roster.push(card);
        });
        persistRoster();
        setRosterHint(`导入完成，卡组现有 ${state.roster.length} 张。`);
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
  if (g.type === "void" && !flying && !asObject) {
    const key = gapKey(from, dest);
    if (state.forceVoid[key]) {
      return "force-void";
    }
    paintSkillLog("空隙：地面单位不能通过。勾选间隔上的「允许强行通过」表示运动检定已成功（耗行动点）。飞行单位可直接过。");
    return false;
  }
  return true;
}

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
        const fall = Math.floor(totalMaxHp(unit) * 0.1);
        applyTrueDamage(unit.layers, fall);
        notes.push(`${unit.name} 坠落，失去最大生命 10%（${fall}），移动失败。`);
        return { fail: true, notes };
      }
    }
  }
  if (g.type === "void" && unit && !unit.flying && state.forceVoid[gapKey(from, dest)]) {
    notes.push("地面单位强行通过空隙（已耗行动点，检定成功）。");
  }
  return { fail: false, notes };
}

function toggleDevice(p, reason) {
  if (!p || (p.kind !== "button" && p.kind !== "lever")) return;
  if (gMissingDoor(p)) {
    const key = Object.keys(state.gaps).find(k => state.gaps[k].type === "door") || "1-2";
    p.link = key;
  }
  const gap = state.gaps[p.link] || getGap(1, 2);
  gap.open = !gap.open;
  appendLog(`${p.name} ${reason || "被操作"}：间隔 ${p.link} 的门现在${gap.open ? "打开" : "关闭"}。`);
}

function gMissingDoor(p) {
  const g = state.gaps[p.link];
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

function markAoeZone(zone) {
  if (zone == null) return;
  state.aoePulse = state.aoePulse || {};
  state.aoePulse[Number(zone)] = true;
}

function flushAoePulse() {
  const map = state.aoePulse || {};
  Object.keys(map).forEach(z => pulseDevicesInZone(Number(z), "受到范围伤害，视作被操作一次"));
  state.aoePulse = {};
}

function fireScrap(p) {
  const t = skillTarget() || unitById(state.targetId);
  if (!t || t.isProp) { appendLog("先选一个敌人目标再让碎渣机炮开火。"); return; }
  if (zoneDist(p.zone, t.zone, state.zoneMode) > 2) {
    appendLog("碎渣机炮只能打 2 距离内。");
    return;
  }
  snapshot();
  const n = 1 + Math.floor(Math.random() * 4);
  const flat = 6 + (p.level || 1);
  const fake = unitOf("碎渣机炮", p.level, [{ type: "armor", hp: 1 }], 0, 0);
  fake.zone = p.zone;
  const out = dealTo(fake, t, { atk: 0, mult: 0, flat, hits: n, element: "physical", baseBreak: 2, flags: { action: true } });
  appendLog(`碎渣机炮开火 ${n} 次，每次 ${flat} 物理 +2 击破。合计伤害 ${Math.floor(out.res.total || 0)}。`);
  renderAll();
}

function hitStructure(attacker, targetToken, opt) {
  snapshot();
  const notes = [];
  if (String(targetToken).indexOf("gap:") === 0) {
    const key = targetToken.slice(4);
    const g = state.gaps[key];
    if (!g) return;
    if (g.type !== "wall" && g.type !== "bridge") {
      notes.push("这个间隔没有可打的墙/桥。");
      appendLog(notes.join("\n"));
      return;
    }
    const dmg = Math.max(1, Math.floor((opt && opt.dmg) || (effectiveAtk(attacker, state.units) || 5)));
    const br = (opt && opt.brk) || 1;
    g.lastFrom = attacker ? attacker.zone : 1;
    g.hp = Math.max(0, g.hp - dmg - br);
    notes.push(`攻击间隔 ${key}（${gapLabel(g.type)}）：耐久 −${dmg} 伤害 −${br} 击破 → ${g.hp}`);
    if (g.hp <= 0) notes.push(...destroyGap(key, g));
  } else if (String(targetToken).indexOf("prop:") === 0) {
    const p = (state.props || []).find(x => x.id === targetToken.slice(5));
    if (!p) return;
    notes.push(...damageProp(p, opt || {}, attacker));
  }
  appendLog(notes.join("\n"));
  renderAll();
}

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
    const lv = Number(lvEl && lvEl.value) || 1;
    const diceN = 1 + dieStep(lv, 5);
    const r = takeDice(diceN, 10, 0);
    const dmg = Math.floor(r.total);
    const victims = state.units.filter(u => !u.hidden && !u.dead && Number(u.zone) === Number(fallTo));
    notes.push(`危墙向 ${fallTo} 区倒塌：${r.text} 物理 + 2 击破。`);
    if (!victims.length) notes.push(`${fallTo} 区没有单位承受倒塌。`);
    victims.forEach(u => {
      const fake = unitOf("危墙", lv, [{ type: "armor", hp: 1 }], 0, 0);
      fake.zone = fallTo;
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

function damageProp(p, opt, attacker) {
  const notes = [];
  const element = opt.element || "physical";
  let lose = 1;
  if (p.kind === "boom") {
    if (element === "fire") lose = 3;
    else if (element === "energy" || element === "electric") lose = 1;
  } else if (p.kind === "acid") {
    lose = element === "harmonic" ? 3 : 1;
  } else if (p.kind === "scrap") {
    lose = 1;
  } else if (p.kind === "button" || p.kind === "lever") {
    notes.push(`${p.name} 被攻击，触发装置。`);
    useDevice(p);
    return notes;
  } else {
    lose = Math.max(1, Math.floor(opt.dmg || 5));
  }
  p.hp = Math.max(0, p.hp - lose);
  notes.push(`${p.name} 耐久 −${lose} → ${p.hp}`);
  if (p.hp <= 0) notes.push(...destroyProp(p, attacker));
  return notes;
}

function destroyProp(p, attacker) {
  const notes = [`${p.name} 被摧毁。`];
  if (p.kind === "ironwall") {
    notes.push(...breakIronWall(p, []));
    return notes;
  }
  const lv = p.level || 1;
  if (p.kind === "boom") {
    const r = takeDice(1, 20, lv);
    const dmg = r.total;
    notes.push(`爆炸：同区 ${r.text} 火焰 + 2 击破。`);
    state.units.filter(u => !u.hidden && Number(u.zone) === Number(p.zone)).forEach(u => {
      const fake = unitOf("爆炸桶", lv, [{ type: "armor", hp: 1 }], 0, 0);
      fake.zone = p.zone;
      dealTo(fake, u, { atk: 0, mult: 0, flat: dmg, element: "fire", baseBreak: 2, flags: { action: true } });
    });
  }
  if (p.kind === "acid") {
    const f = state.fields[p.zone] || emptyField();
    const err = setZoneField(p.zone, "acid");
    notes.push(err || `${p.zone} 区生成酸液地面。`);
  }
  if (p.kind === "battery") {
    const r = takeDice(lv, 4, 0);
    const dmg = r.total;
    notes.push(`电池爆炸：同区同阵营 ${r.text} 电击。`);
    state.units.filter(u => !u.hidden && Number(u.zone) === Number(p.zone) && !!u.isPlayer === (p.faction !== "enemy")).forEach(u => {
      const fake = unitOf("电池", lv, [{ type: "armor", hp: 1 }], 0, 0);
      fake.zone = p.zone;
      dealTo(fake, u, { atk: 0, mult: 0, flat: dmg, element: "electric", baseBreak: 0, flags: { action: true } });
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
      dealTo(u, mover, { atk: 0, mult: 0, diceN: n, diceS: 6, element: "ice", baseBreak: 1, flags: { action: true, opportunity: true, blockResolved: true } });
      if (window.GAME && window.GAME.tape) window.GAME.tape.push({ type: "opp", attackerId: u.id, targetId: mover.id, name: u.name });
    }
    if (typeof bpLeaveOpportunity === "function") bpLeaveOpportunity(u, mover, notes);
    if (u.kit === "thug_knife" && mover.isPlayer) {
      notes.push(`${u.name} 对离开区域的 ${mover.name} 发动借机攻击。`);
      dealTo(u, mover, { atk: effectiveAtk(u, state.units), mult: 1, diceN: 1, diceS: 8, element: "physical", baseBreak: 1, flags: { action: true, opportunity: true, blockResolved: true } });
      if (window.GAME && window.GAME.tape) window.GAME.tape.push({ type: "opp", attackerId: u.id, targetId: mover.id, name: u.name });
    }
  });
}

/** 移动也整理成一块：「【谁】移动」+ 从哪到哪 + 花费 + 移动引起的事（借机攻击、场地……） */
function doMove(unit, dest, moveOpt) {
  if (!unit) return;
  const prevActor = LOG_ACTOR_ID;
  LOG_ACTOR_ID = unit.id;
  let lines;
  try { lines = withLogSink(() => doMoveInner(unit, dest, moveOpt)); } finally { LOG_ACTOR_ID = prevActor; }
  // 「X：1 区 → 2 区」挪到最前面，花费跟在后面
  const i = lines.findIndex(s => /区 → \d+ 区/.test(s));
  if (i > 0) lines.unshift(lines.splice(i, 1)[0]);
  const block = tidyActionBlock(`【${unit.name}】移动`, lines.map(s => s.replace(new RegExp("^" + unit.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "：(\\d+ 区 → \\d+ 区)"), "$1")));
  if (block.length) appendLog(block.join("\n"));
}

function doMoveInner(unit, dest, moveOpt) {
  dest = Number(dest);
  if (typeof isCrushing === "function" && isCrushing(unit) && !(moveOpt && moveOpt.free)) {
    appendLog(`${unit.name} 正抓在敌人身上，无法主动移动。`);
    return;
  }
  moveOpt = moveOpt || {};
  const from = Number(unit.zone);
  const maxZ = Number(state.zoneMode);
  const notes = [];
  if (dest === from) return;
  if (dest < 1 || dest > maxZ) {
    paintSkillLog("没有那个区域。");
    return;
  }
  if (Math.abs(dest - from) !== 1) {
    paintSkillLog("一次只能移动 1 格。1 区到 3 区要走两次。");
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
  if (fromF.abyss && !unit.flying) {
    paintSkillLog("深渊不能站人。飞行单位才能过。");
    return;
  }
  const cross = canCross(unit, from, dest, false);
  if (!cross) return;
  if (!moveOpt.free) {
    const fromF = state.fields[from] || emptyField();
    if (fromF.acid && !unit.flying) {
      if (!spendAp(unit, 1, "离开酸液地面")) return;
    } else if (unit.self === "conductor") {
      // 导体：移动不消耗附赠动作
    } else if (unit.isPlayer) {
      if (!spendBonus(unit, 1, "移动")) return;
    } else if (enemyRankOf(unit) === "minion") {
      // 杂兵才用行动点移动
      if (!spendAp(unit, 1, "杂兵移动")) return;
    } else {
      // 精英与 BOSS 只能用附赠行动移动，不退回去扣行动点
      if (!spendBonus(unit, 1, "移动")) return;
    }
  }
  snapshot();
  const passed = passGap(unit, from, dest);
  notes.push(...passed.notes);
  if (passed.fail) {
    paintSkillLog(notes.join("\n"));
    renderAll();
    return;
  }
  if (fromF.acid && !unit.flying) {
    notes.push("离开酸液地面：规则上消耗行动点而不是附赠行动。");
  }
  if (fromF.ice && !unit.flying && !moveOpt.free) {
    const roll = 1 + Math.floor(Math.random() * 20);
    const dc = 10;
    if (roll < dc) {
      dealBreak(unit, 1, "ice", notes, "冻土离开失败");
      notes.push(`离开冻土运动检定 d20=${roll}＜${dc}，失败：留在 ${from} 区并受 1 冰击破。`);
      paintSkillLog(notes.join("\n"));
      renderAll();
      return;
    }
    notes.push(`离开冻土运动检定 d20=${roll}≥${dc}，成功。`);
  }
  unit.zone = dest;
  convertUnstableInHv(unit, notes);
  triggerLeaveOpportunity(unit, from, notes);
  if (typeof bpAfterEnemyMove === "function") bpAfterEnemyMove(unit, notes);   // 单局图纸：稳妥的距离
  if (toF.ice && !unit.flying) {
    const br = state.weather === "snow" && currentWeatherFor(unit) === "snow" ? 2 : 1;
    const defBeforeIce = Math.max(0, Number(unit.def) || 0);
    const wasStunnedIce = !!unit.stunned;
    unit.def = Math.max(0, defBeforeIce - br);
    notes.push(`进入冻土：冰击破 ${br}，架势 ${unit.def}`);
    popBreak(unit, br, "ice");
    if (unit.def <= 0) {
      const brokeIntoStun = defBeforeIce > 0 && !wasStunnedIce;
      unit.stunned = true;
      if (brokeIntoStun) {
        unit.instant = unit.instant || {};
        unit.instant.iceNext = true;
        notes.push(imbalanceLine(unit));
        notes.push(`${unit.name} 因冰属性击破失衡：下次受到的攻击动作第一击 +50% 伤害。`);
      }
      queueAssistAttack(null, unit);
    }
  }
  applyAbyssFall(unit, from, notes);
  if (typeof afterMove === "function") afterMove(unit, notes);
  state.units.forEach(u => {
    if (u.id === unit.id || u.hidden) return;
    if (u.statuses && u.statuses.chase) {
      if (canCross(u, u.zone, unit.zone, false)) {
        u.zone = unit.zone;
        notes.push(`${u.name} 因紧追跟到 ${unit.zone} 区（不耗附赠）。`);
      } else {
        notes.push(`${u.name} 紧追但间隔挡住，没跟上。`);
      }
    }
  });
  notes.unshift(`${unit.name}：${from} 区 → ${unit.zone} 区${moveOpt.free ? "（技能内移动，不耗附赠）" : ""}`);
  paintSkillLog(notes.join("\n"));
  renderAll();
}

function touDuelVictim(u) {
  if (!u || u.isPlayer || u.dead || u.hidden || u.fused) return null;
  const tou = findKit("tou", state.units);
  if (!tou || tou.dead || tou.hidden || tou.fused) return null;
  if (tou.dying && !tou.upOnShp) return null;
  if (typeof passiveOn === "function" && !passiveOn(tou)) return null;   // 放弃被动「决一死战」
  if (Number(u.zone) !== Number(tou.zone)) return null;
  const enemies = (typeof fieldUnits === "function" ? fieldUnits() : state.units).filter(x =>
    x && !x.isPlayer && !x.dead && !x.hidden && !x.fused && Number(x.zone) === Number(tou.zone)
  );
  if (enemies.length !== 1 || enemies[0].id !== u.id) return null;
  return tou;
}

function shouldDiceMin(attacker) {
  return !!touDuelVictim(attacker);
}

function shieldBearer(target) {
  if (!target) return null;
  const tou = findKit("tou", state.units);
  if (!tou || !tou.resources || !(tou.resources.shield > 0)) return null;
  if (tou.weaponHeld === false) return null;
  if (target.kit === "tou" || target.kit === "mochi") return tou;
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
  const yuito = state.units.find(u => u.kit === "yuito" && u.resources && u.resources.bondId === target.id);
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
  notes.push(...applyResultToUnit(target, result, attacker));
  maybeUnstableTrip(target, notes);
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
        body._xpGiven = true;
        grantXpToPlayers(xpDrop("boss", body.level), "击破飞碟触灵");
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
    if (target.dead && !target._xpGiven) {
      target._xpGiven = true;
      grantXpToPlayers(xpDrop("boss", target.level), "击破飞碟触灵");
    }
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
    }
    const ph2 = target.resources.phase || 1;
    if (ph2 === 2 && aggArmorBefore > 0 && armorL && armorL.current <= 0) {
      if (armorL) armorL.max = 0;
      target.resources.phase = 3;
      target.resources.forceCharge = false;
      target.resources.forceOverheat = false;
      target.name = "沙灵聚合体·核心";
      notes.push("装甲被击破，进入三阶段。");
    }
  }
  notes.push(...sweepDeadEnemies());
  if (target.def <= 0 && result.broke && !target.noPosture && target.kit !== "ufo_leg") notes.push(imbalanceLine(target));
  if (attacker && result.selfBreak && attacker.def <= 0) notes.push(imbalanceLine(attacker));
  if (result.flags && result.flags.holyShield) {
    const tou = shieldBearer(target) || findKit("tou", state.units);
    if (tou && tou.resources && tou.resources.shield > 0) {
      tou.resources.shield -= 1;
      notes.push(`圣盾 −1 → ${tou.resources.shield}`);
    }
  }
  if (result.broke && target.resources && target.resources.mecha) {
    notes.push(...exitMecha(target, "被击落，机甲解除"));
  }
  if (!target.isPlayer && isInnerDepleted(target) && !target._xpGiven) settleEnemyKill(target, notes);
  if (target.isPlayer && !isWeaponUnit(target) && isInnerDepleted(target) && !target.upOnShp && !target.dead) {
    if (exhaustTierOf(target) >= 3) {
      target.dead = true;
      target.dying = false;
      notes.push(`${target.name} 力竭 3：被击倒后立刻死亡。`);
    } else {
      target.dying = true;
      clearStunOnDown(target);
      notes.push(`${target.name} 最内层生命归零，陷入濒死。不能靠治疗起身，可消耗起身改用坚毅生命继续战斗。`);
    }
  }
  if (target.isPlayer && isWeaponUnit(target) && isInnerDepleted(target)) {
    target.dead = true;
    notes.push(`${target.name} 最内层归零，武器人倒下。`);
  }
  // 双相冲动：诺拉或维塔斯击杀单位后翻一次面
  if (attacker && (attacker.kit === "nora" || attacker.kit === "vitas") && (typeof passiveOn !== "function" || passiveOn(attacker)) &&
      (target.dead || (target.isPlayer && target.dying)) && !target._noraKillCounted) {
    target._noraKillCounted = true;
    flipMood(noraOf(), notes, "击杀");
  }
  if (target.dead && typeof clearPierce === "function" && isPierced(target)) clearPierce(null, notes, "（目标倒下）");
  if (target.def <= 0 && (result.broke || target.stunned) && !target.noPosture && target.kit !== "ufo_leg") {
    queueAssistAttack(attacker, target);
  }
  if (attacker && result.selfBreak && attacker.def <= 0) {
    queueAssistAttack(target, attacker);
  }
  if (attacker && attacker.self === "burn" && result.element === "fire") {
    const raw = Number(result.intended || result.total) || 0;
    const st = selfBurnStacksOf(attacker);
    if (raw > 0) {
      const n = Math.floor(raw * 0.2 * st);
      const got = healUnit(attacker, n, { selfBurn: true });
      notes.push(`${attacker.name} 自焚×${st}：火焰伤害 +${10 * st}%，吸血 ${20 * st}% × ${Math.floor(raw)} = ${n}，回复 ${got}${attacker.upOnShp ? "（SHP）" : ""}`);
    }
  }
  if (target && target.stunned && target.self === "burn") {
    target.self = "none";
    target.selfBurnStacks = 0;
    notes.push(`${target.name} 晕眩，自焚结束。`);
  }
  return notes;
}

function applyNeutralize(u) {
  const notes = [`【中和】结算 ${u ? u.name : "？"}`];
  if (!u) return notes;
  popStatus(u, "neutralize");
  const st = u.statuses || {};
  const keys = [];
  if ((Number(st.burn) || 0) > 0) keys.push("burn");
  if (st.corr) keys.push("corr");
  if (st.shock) keys.push("shock");
  if (st.high || (u.highEnergy || 0) > 0) keys.push("high");
  if (st.frostbite) keys.push("frostbite");
  if (st.shockwave) keys.push("shockwave");
  if (st.reso) keys.push("reso");
  const n = keys.length;
  const bonus = Math.max(0, n - 1) * 0.07;
  if (n > 1) notes.push(`属性状态 ${n} 个，中和整体伤害 +${Math.round(bonus * 100)}%。`);
  const scale = (v) => Math.floor((Number(v) || 0) * (1 + bonus));
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
    const d = statusDotDice("corr", u.level || 1, currentWeatherFor(u), armored);
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
    dealBreak(u, 2, "ice", notes, "中和冻伤");
    st.frostbite = false;
  }
  if (keys.indexOf("shockwave") >= 0) {
    dealBreak(u, 2, "physical", notes, "中和震荡");
    st.shockwave = false;
    if (typeof syncShockwave === "function") syncShockwave(u, notes);
  }
  if (u.self && u.self !== "none") {
    notes.push(`${u.name} 自我效果「${selfName(u.self)}」被中和清除（无额外结算）。`);
    u.self = "none";
    u.selfBurnStacks = 0;
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
  // 同区不分敌我的范围伤害（不能协助格挡）
  state.units.filter(u => !u.hidden && !u.dead && u.id !== target.id && Number(u.zone) === Number(target.zone)).forEach(u => {
    const fake = unitOf("小车残骸", target.level, [{ type: "armor", hp: 1 }], 0, 0);
    fake.zone = target.zone;
    dealTo(fake, u, { atk: 0, mult: 0, flat: half, element: "energy", baseBreak: 1, flags: { action: true, aoe: true } });
  });
}

function removeEnemyFromField(u, notes) {
  if (!u || u.isPlayer || u._removed) return;
  u._removed = true;
  u.dead = true;
  u.hidden = false;
  notes.push(`${u.name} 被击杀。`);
  if (state.selectedId === u.id) state.selectedId = null;
  if (state.attackerId === u.id) state.attackerId = null;
  if (state.targetId === u.id) state.targetId = null;
  const id = u.id;
  setTimeout(() => {
    state.units = (state.units || []).filter(x => x.id !== id);
    renderAll();
  }, 3000);
}

/** 敌人内层归零：记死亡、发经验与掉落，以及个别 BOSS 的连带效果。只结算一次。 */
function isOutlawThugKit(kit) {
  return /^thug_/.test(kit || "");
}

function settleEnemyKill(target, notes) {
  if (!target || target.isPlayer || target._xpGiven) return;
  target.dead = true;
  target._xpGiven = true;
  const rank = ENEMY_RANK[target.kit] || "minion";
  const amt = xpDrop(rank, target.level);
  grantXpToPlayers(amt, `击杀 ${target.name}`);
  const loot = typeof rollEnemyLoot === "function" ? rollEnemyLoot(target) : (target.kit === "patrol_car" ? 30 : 0);
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
  if (isOutlawThugKit(target.kit) && typeof mutinyTick === "function") mutinyTick(notes);
}

function sweepDeadEnemies() {
  const notes = [];
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
    if (u.kit === "boomcar") explodeBoomcar(u, notes);
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
        if (!body._xpGiven) {
          body._xpGiven = true;
          grantXpToPlayers(xpDrop("boss", body.level), "击破飞碟触灵");
        }
        removeEnemyFromField(body, notes);
      }
    }
    removeEnemyFromField(u, notes);
  });
  return notes;
}

function visibleEnemies(zone) {
  return state.units.filter(u => !u.hidden && !u.isPlayer && Number(u.zone) === Number(zone));
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
  return !obj.noMove;
}

function displaceTo(obj, dest, notes, reason) {
  dest = Number(dest);
  if (!obj) return false;
  if (!canDisplace(obj)) {
    notes.push(`${obj.name} 无法被移动。`);
    return false;
  }
  const from = Number(obj.zone);
  if (from === dest) return true;
  obj.zone = dest;
  notes.push(`${obj.name}${reason ? " " + reason : " 被移动"}：${from} 区 → ${dest} 区。`);
  applyAbyssFall(obj, from, notes);
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
  const step = aZone < bZone ? 1 : -1;
  for (let z = aZone; z !== bZone; z += step) {
    const g = getGap(z, z + step);
    if (g.type === "wall") return "危墙挡住，无法影响对面。";
    if (g.type === "door" && !g.open) return "关闭的机关门挡住，无法影响对面。";
  }
  return false;
}

function makeDealFlags(extra) {
  const flags = Object.assign({ action: true, block: "none" }, extra || {});
  return flags;
}

function recoverFromStun(u, notes) {
  if (!u || !u.stunned) return;
  notes = notes || [];
  u.stunned = false;
  u._imbalanceLock = false;
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

function refreshEconomy(u) {
  if (!u || !u.isPlayer) return;
  if (typeof isCrushing === "function" && isCrushing(u)) {
    u.ap = 0; u.apMax = 0; u.bonus = 0; u.bonusMax = 0;
    return;
  }
  if (u.stunned) {
    u.ap = 0;
    u.apMax = 0;
    u.bonus = 0;
    u.bonusMax = 0;
    return;
  }
  let ap = 1, bonus = 1;
  if (u.loseBonusNext) {
    bonus = 0;
    u.loseBonusNext = false;
  }
  if (u.self === "unstable") bonus = 0;
  const iso = state.fields[u.zone] && state.fields[u.zone].isolate;
  if (!iso && state.weather === "sand") {
    const w = sandWind(u.zone, state.zoneMode, state.sandDir);
    if (u.flying && w > 0) ap += 1;
    if (u.flying && w < 0) ap -= 1;
    if (!u.flying && w > 0) bonus += 1;
  }
  if (state.fields[u.zone] && state.fields[u.zone].energy) ap += 1;
  if (typeof bpEconomy === "function") ({ ap, bonus } = bpEconomy(u, { ap, bonus }));   // 单局图纸
  u.ap = Math.max(0, ap);
  u.apMax = u.ap;
  u.bonus = Math.max(0, bonus);
  u.bonusMax = Math.max(u.bonus, bonus);
}

function skillNameHint(id) {
  return id || "技能";
}

function spendAp(u, n, reason) {
  n = n || 1;
  if (!u) return true;
  if ((u.ap || 0) < n) {
    appendLog(`${u.name} 行动点不足（${u.ap || 0}/${u.apMax || 0}），无法${reason || "行动"}。`);
    return false;
  }
  u.ap -= n;
  appendLog(logSinkActive()
    ? `  ${u.id === LOG_ACTOR_ID ? "" : u.name + " "}消耗 ${n} 行动点（剩 ${u.ap}/${u.apMax}）`
    : `${u.name} ${/^[a-z_]+$/.test(reason || "") ? "" : (reason || "") + "："}消耗 ${n} 行动点（剩 ${u.ap}/${u.apMax}）`);
  return true;
}

function spendBonus(u, n, reason) {
  n = n || 1;
  if (!u) return true;
  if ((u.bonus || 0) < n) {
    appendLog(`${u.name} 附赠行动不足（${u.bonus || 0}/${u.bonusMax || 0}），无法${reason || "行动"}。`);
    return false;
  }
  u.bonus -= n;
  appendLog(logSinkActive()
    ? `  ${u.id === LOG_ACTOR_ID ? "" : u.name + " "}消耗 ${n} 附赠行动（剩 ${u.bonus}/${u.bonusMax}）`
    : `${u.name} ${/^[a-z_]+$/.test(reason || "") ? "" : (reason || "") + "："}消耗 ${n} 附赠行动（剩 ${u.bonus}/${u.bonusMax}）`);
  return true;
}

function highlandBlockMod(helper, attacker) {
  if (!helper || !attacker) return 0;
  const hf = state.fields[helper.zone] || {};
  const af = state.fields[attacker.zone] || {};
  const atkHigh = !!af.highland;
  const helpHigh = !!hf.highland;
  const ranged = attacker.range === "ranged" || (attacker.suggest && attacker.suggest.range === "ranged");
  if (atkHigh && !helpHigh && ranged) return -10;
  if (helpHigh && !atkHigh) return 10;
  return 0;
}

function finalBlockChance(helper, attacker, protectedUnit) {
  let c = blockChance(helper);
  if (c == null) c = 50;
  if (helper.kit === "hiaki" && helper.resources && helper.resources.stance === "iai") c = 100;
  c += highlandBlockMod(helper, attacker);
  if (helper.self === "anchor") c += 10;   // 千钧：格挡成功率 +10%
  if (helper.rallyBlock) c += helper.rallyBlock;
  if (typeof bpBlockBonus === "function") c += bpBlockBonus(helper, protectedUnit);   // 单局图纸
  return Math.max(5, Math.min(100, c));
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
  if (u.stunned) {
    u.stunned = false;
    if (typeof canRestorePosture !== "function" || canRestorePosture(u)) u.def = 1;
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
/** 现在撤退属于哪一档 */
function retreatStatus() {
  const heroes = retreatHeroes();
  const down = heroes.filter(u => u.dying || u.upOnShp).length;
  if (heroes.length && down * 2 >= heroes.length) return "routed";
  const hurt = heroes.some(u => u.dying || u.upOnShp || totalCurHp(u) < baseMaxHp(u));
  return hurt ? "hurt" : "intact";
}
/** 可以断后的人：还站着的角色 */
function retreatRearguards() {
  return retreatHeroes().filter(u => !u.dying && !u.upOnShp);
}
/** 撤退的代价，给界面预先显示 */
function retreatPreview() {
  const key = retreatStatus();
  const r = RETREAT_RULES[key];
  const lines = [`${r.name}：耗时 ${r.hours} 小时`];
  if (r.rearguard) lines.push("一人断后，挨一次无法格挡的攻击");
  if (r.kuizhiLoss) lines.push(`失去 ${Math.round(r.kuizhiLoss * 100)}% 奎支`);
  if (r.combatItems) lines.push("失去全部战斗道具");
  lines.push(`每人坚毅 −${r.shp}${r.shpDown !== r.shp ? `，倒地者 −${r.shpDown}` : ""}${r.lethal ? "" : "（不致死）"}`);
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
      const out = dealTo(striker, guard, {
        atk: effectiveAtk(striker, state.units), mult: 1, flat: sg.flat || 0,
        diceN: dice[0], diceS: dice[1], element: sg.element || "physical", baseBreak: sg.baseBreak || 1,
        flags: { action: true, opp: true, blockResolved: true, block: "none" }
      });
      notes.push(`${guard.name} 断后，挨了 ${striker.name} 一击：${Math.floor((out.res && out.res.total) || 0)} 伤害。`);
    }
  }
  if (r.kuizhiLoss > 0) {
    const before = Number(state.kuizhi) || 0;
    const lost = Math.floor(before * r.kuizhiLoss);
    state.kuizhi = before - lost;
    if (lost) notes.push(`丢下 ${lost} 奎支。`);
  }
  if (r.combatItems && state.bag && Array.isArray(state.bag.items)) {
    const gone = state.bag.items.filter(x => (x.qty || 0) > 0 && ITEM_CATALOG[x.id] && ITEM_CATALOG[x.id].combat);
    if (gone.length) notes.push(`丢下全部战斗道具：${gone.map(x => ITEM_CATALOG[x.id].name + "×" + x.qty).join("、")}。`);
    gone.forEach(x => { x.qty = 0; });
  }
  retreatHeroes().forEach(u => {
    const down = u.dying || u.upOnShp;
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
    u.selfBurnStacks = Math.min(maxSt, stacks + 1 + (heat ? 1 : 0));
    notes.push(`自焚层数 ${stacks} → ${u.selfBurnStacks}${heat ? "（酷暑）" : ""}`);
  }
  return notes;
}

function isWeaponUnit(u) {
  if (!u) return false;
  if (u.weaponOf) return true;
  return ["mint", "latte", "niu", "naruto", "mochi", "berniel", "bili", "ironwall", "torque", "ecmo", "edc"].indexOf(u.kit) >= 0;
}

const FOCUS_ELEMS = ["fire", "acid", "electric", "ice", "energy", "physical", "harmonic"];

function focusSeqLen(target) {
  const r = typeof enemyRankOf === "function" ? enemyRankOf(target) : "minion";
  if (r === "boss") return 4;
  if (r === "elite") return 3;
  return 2;
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

function pickFocusLayer(target) {
  const f = (target.focuses || [])[0];
  return f && f.layerType;
}

function stripFocusLayer(target, layerType, lines) {
  const layer = (target.layers || []).find(l => l.type === layerType);
  if (!layer) return;
  const lost = Math.max(0, Number(layer.current) || 0);
  const wasInner = layer === innermostLayer(target);
  layer.current = 0;
  layer.max = 0;
  layer.sealed = true;
  target.focuses = (target.focuses || []).filter(f => f.layerType !== layerType);
  // 抹去的是内层：留着这层（0/0）让单位按内层归零死亡，不能让外层顶替成内层
  if (!wasInner) target.layers = (target.layers || []).filter(l => l !== layer);
  state.lastBrokenLayer = { type: layerType, lost, dmg: lost };
  noteSideDamage(lost, "聚焦抹层", target);
  const msg = `${target.name} 聚焦完成：${(typeof LAYER !== "undefined" && LAYER[layerType]) || layerType}被抹去（视为 ${lost} 点伤害，该层无法再被治疗）。`;
  if (lines) lines.push(msg);
  else appendLog(msg);
  if (typeof spawnFloater === "function") spawnFloater(target, lost, "harmonic");
  if (typeof spawnPopup === "function") spawnPopup(target, { kind: "status", text: "聚焦抹层", element: "harmonic" });
  if (wasInner) settleEnemyKill(target, lines || []);
}

/** 聚焦推进：按序列的下一个属性、对该目标造成伤害的攻击行动推进一步（多段攻击整次算一步），
 *  不要求打在被聚焦的那一层上。序列走完，被聚焦的层直接抹去。 */
function advanceFocusOnHit(attacker, target, element, res, extra) {
  if (!target || !target.focuses || !target.focuses.length) return;
  if (!res || !res.ok || (res.total || 0) <= 0) return;
  target.focuses.slice().forEach(f => {
    const need = f.seq[f.step];
    if (need && element === need) {
      f.step += 1;
      extra.push(`${target.name} 聚焦推进 ${f.step}/${f.seq.length}（${(typeof ELE !== "undefined" && ELE[element]) || element}）`);
      if (f.step >= f.seq.length) stripFocusLayer(target, f.layerType, extra);
    }
  });
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
    appendLog("拉斯缪尔进入不稳态：受到任何伤害即死，攻击次数翻倍。");
  }
}

function convertRasLight(pct, bonusRate) {
  const r = findKit("ras", state.units);
  if (!r) return 0;
  const rate = 1 + (Number(bonusRate) || 0);
  const use = Math.max(0, Number(pct) != null ? pct : (r.resources.energyPct || 0));
  const hp = typeof totalMaxHp === "function" ? totalMaxHp(r) : ((r.layers || []).reduce((s, l) => s + (l.max || 0), 0));
  const gain = Math.floor(hp * (use / 100) * rate);
  r.resources.energyPct = Math.max(0, (r.resources.energyPct || 0) - use);
  r.resources.light = (Number(r.resources.light) || 0) + gain;
  if ((r.resources.energyPct || 0) < 100) r.resources.unstable = false;
  appendLog(`拉斯缪尔转化光能 +${gain}（${use}% × 血上限 ${hp}）→ 光能 ${r.resources.light}，累积 ${r.resources.energyPct}%`);
  return gain;
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
  return fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && !u.fused && Number(u.zone) === Number(k.zone));
}

function queueKoltSwap(actor) {
  const k = findKit("kolt", state.units) || (actor && actor.kit === "kolt" ? actor : null);
  if (!k || k.dead || k.hidden) return;
  if (typeof passiveOn === "function" && !passiveOn(k)) return;   // 放弃被动「更换刀头」
  state.koltSwapQueue = state.koltSwapQueue || [];
  if (state.koltSwapQueue.some(j => j.actorId === k.id)) return;
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
    const out = dealTo(k, tgt, { element: ele, mult: 0.5, baseBreak: 0, atk, atkRange: "melee", flags: { action: true, blockResolved: true } });
    (out.extra || []).forEach(s => lines.push(s));
    lines.push(`切刀近距离打击 ${tgt.name}：0.5atk ${ele === "acid" ? "酸" : "电"}。`);
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
    skip.onclick = () => resolveKoltSwap(false, null);
    box.appendChild(skip);
    const foes = koltMeleeSwapTargets(k);
    if (!foes.length) {
      const only = document.createElement("button");
      only.className = "btn primary";
      only.textContent = "切换（同区无目标）";
      only.onclick = () => resolveKoltSwap(true, null);
      box.appendChild(only);
    } else {
      foes.forEach(u => {
        const b = document.createElement("button");
        b.className = "btn primary";
        b.textContent = `切换并打 ${u.name}`;
        b.onclick = () => resolveKoltSwap(true, u.id);
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
    ras: "ras_assist"
  })[helper.kit] || null;
}

function unitIsCombatReady(u) {
  if (!u || u.hidden || u.dead || u.dying) return false;
  if (u.upOnShp) return (Number(u.shp) || 0) > 0;
  return !isInnerDepleted(u);
}

function unitCanFight(u) {
  return !!(unitIsCombatReady(u) && !u.stunned);
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

function eligibleAssisters(breaker, broken) {
  if (!broken || assistTargetGone(broken)) return [];
  if (broken.isPlayer) {
    return fieldUnits().filter(u =>
      !u.isPlayer &&
      !u.dead && !u.hidden && !u.stunned &&
      (unitCanFight(u) || u.kit === "ufo_body") &&
      u.kit !== "ufo_leg" &&
      (!breaker || u.id !== breaker.id || u.kit === "ufo_body") &&
      !(typeof touDuelVictim === "function" && touDuelVictim(u) && broken.kit !== "tou")
    );
  }
  const list = fieldUnits().filter(u =>
    u.isPlayer &&
    !isWeaponUnit(u) &&
    !u.dead && !u.hidden && !u.fused &&
    (unitCanFight(u) || (u.upOnShp && unitIsCombatReady(u) && !u.stunned) || broken.kit === "ufo_body") &&
    (assistSkillId(u) || broken.kit === "ufo_body") &&
    !(typeof isCrushing === "function" && isCrushing(u)) &&
    (!breaker || u.id !== breaker.id) &&
    (typeof bpCanAssistAttack !== "function" || bpCanAssistAttack(u))
  );
  if (broken.kit === "ufo_body") {
    if (list.every(u => u.id !== broken.id)) list.push(broken);
  }
  return list;
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
  });
  return notes;
}

/** 进入濒死时解除晕眩（倒地了就不再处于失衡状态） */
function clearStunOnDown(u) {
  if (!u) return;
  u.stunned = false;
  if (u.statuses) u.statuses.unstable = false;
  u._imbalanceLock = false;
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
  if (broken.isPlayer && typeof bpFirstBreakGuard === "function" && bpFirstBreakGuard(broken)) return;
  const list = eligibleAssisters(breaker, broken);
  const side = broken.isPlayer ? "敌人" : "玩家角色";
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
    vsPlayer: !!broken.isPlayer
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
    text.textContent = `${target ? target.name : "玩家"} 陷入失衡。选择一名敌人发动协助攻击。飞碟触灵可以由自己造成的失衡接协助攻击。${breaker && breaker.kit !== "ufo_body" ? breaker.name + " 作为造成失衡者不能为自己这一击发动。" : ""}`;
  } else {
    text.textContent = `${target ? target.name : "敌人"} 陷入失衡。选择一名其他玩家角色发动协助攻击。飞碟触灵本体失衡时也可被协助攻击；${breaker ? breaker.name : "造成失衡者"} 不能为自己这一击发动。`;
  }
  box.innerHTML = "";
  list.forEach(h => {
    const b = document.createElement("button");
    b.className = "btn primary";
    b.textContent = `${h.name} 协助攻击`;
    b.onclick = () => finishAssist(h.id);
    box.appendChild(b);
  });
  const no = document.createElement("button");
  no.className = "btn";
  no.textContent = "不发动";
  no.onclick = () => finishAssist(null);
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
    appendLog(`${target ? target.name : "目标"} 已经倒下，协助攻击取消。`);
    presentAssistModal();
    return;
  }
  if (!helperId) {
    appendLog("没有人发动协助攻击。");
    presentAssistModal();
    return;
  }
  const helper = unitById(helperId);
  if (!helper || !target) { presentAssistModal(); return; }
  const notes = helper.isPlayer ? forceRecallWeapons(helper) : [];
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
  try { runSkill(sidSkill); } finally { state._assistBy = null; }
  state.attackerId = prevAtk;
  state.targetId = prevT;
  renderAll();
  presentAssistModal();
}

function autoEnemyBlockers(target) {
  if (!target || target.isPlayer || target.dead) return [];
  return fieldUnits().filter(u => {
    if (u.isPlayer || u.id === target.id || u.stunned || u.dead || u.hidden) return false;
    if (Number(u.zone) !== Number(target.zone)) return false;
    if (u.kit === "captain_ox") return true;
    if (u.kit === "patrol_car" && !(u.resources && u.resources.blockUsedThisTurn)) return true;
    return false;
  });
}

function tryOxAutoBlock(attacker, target) {
  const oxes = autoEnemyBlockers(target);
  if (!oxes.length) return null;
  for (let i = 0; i < oxes.length; i++) {
    const ox = oxes[i];
    if (ox.kit === "patrol_car") {
      ox.resources = ox.resources || {};
      ox.resources.blockUsedThisTurn = true;
    }
    const chance = finalBlockChance(ox, attacker);
    const roll = 1 + Math.floor(Math.random() * 100);
    const ok = roll <= chance;
    appendLog(`${ox.name} 自动协助格挡 ${target.name}：d100=${roll} 成功率 ${chance}% → ${ok ? "成功" : "失败"}`);
    if (!ok) continue;
    appendLog(`成功：目标免伤，击破由 ${ox.name} 承担（架势最少留 1）。${ox.kit === "captain_ox" ? "成功后反击 1 击破。" : ""}`);
    if (attacker && ox.kit === "captain_ox") {
      const before = Number(attacker.def) || 0;
      attacker.def = Math.max(0, before - 1);
      appendLog(`队长牛反击：${attacker.name} 架势 ${before} → ${attacker.def}`);
      if (attacker.def <= 0) {
        attacker.stunned = true;
        appendLog(imbalanceLine(attacker));
        queueAssistAttack(ox, attacker);
      }
    }
    return { ok: true, helperId: ox.id };
  }
  return { ok: false };
}

function eligibleBlockers(target) {
  if (!target || !target.isPlayer) return [];
  const crushOut = (u) => !(typeof isCrushing === "function" && isCrushing(u));
  return state.units.filter(u =>
    u.isPlayer && !u.hidden && u.id !== target.id &&
    Number(u.zone) === Number(target.zone) &&
    !u.stunned && crushOut(u) && ((u.bonus || 0) >= 1 || target.coverBy === u.id) &&
    blockChance(u) != null &&
    (typeof bpCanAssistBlock !== "function" || bpCanAssistBlock(u))
  );
}

function performAssistBlock(helper, target, attacker, forced) {
  const notes = [];
  forced = forced || {};
  // 濒死者不能直接格挡，但可以「起身并协助格挡」：先起身，再照常结算
  if (typeof isDownProtected === "function" && isDownProtected(helper)) {
    standUp(helper);
    notes.push(`${helper.name} 起身以进行协助格挡。`);
    if (isDownProtected(helper)) return { ok: false, notes };
  }
  const freeCover = target && target.coverBy === helper.id;
  if (!freeCover && !spendBonus(helper, 1, "协助格挡")) return { ok: false, notes };
  if (freeCover) notes.push(`${helper.name} 因掩护免费格挡。`);
  if (helper.kit === "yuito" && target && target.id !== helper.id) {
    setBond(helper, target);
    notes.push(`思念：对 ${target.name} 施加牵挂（同时只能有一名）。`);
  }
  if (isUnarmed(helper)) {
    const chance = finalBlockChance(helper, attacker, target);
    const roll = forced.roll != null ? Number(forced.roll) : (1 + Math.floor(Math.random() * 100));
    const ok = forced.ok != null ? !!forced.ok : roll <= chance;
    notes.push(`${helper.name} 空手格挡 ${target.name}：d100=${roll} 成功率 ${chance}% → ${ok ? "成功" : "失败"}`);
    if (ok) {
      notes.push("空手格挡成功：目标仍受一半伤害。格挡者下回合失去附赠行动。");
      helper.loseBonusNext = true;
    } else notes.push("空手格挡失败：目标照常受伤。");
    return { ok, notes, bare: true };
  }
  const chance = finalBlockChance(helper, attacker, target);
  // 手册第六章：发动格挡 −1 耐久（空手格挡不扣，已在上面返回）
  if (typeof ledgerOnBlock === "function") ledgerOnBlock(helper, notes);
  const rolls = forced.roll != null ? [Number(forced.roll)] : [1 + Math.floor(Math.random() * 100)];
  if (forced.roll == null && helper.statuses && helper.statuses.advantage) rolls.push(1 + Math.floor(Math.random() * 100));
  const roll = Math.min.apply(null, rolls);
  let ok = forced.ok != null ? !!forced.ok : roll <= chance;
  notes.push(`${helper.name} 协助格挡 ${target.name}：d100=${rolls.join("/")} 成功率 ${chance}% → ${ok ? "成功" : "失败"}`);
  if (!ok && helper.kit === "tou" && (helper.resources.shield || 0) > 0) {
    helper.resources.shield -= 1;
    const roll2 = 1 + Math.floor(Math.random() * 100);
    ok = roll2 <= chance;
    notes.push(`灯消耗 1 圣盾重掷 d100=${roll2} → ${ok ? "成功" : "失败"}（圣盾 ${helper.resources.shield}）`);
  }
  if (helper.kit === "hiaki" && helper.resources && helper.resources.stance === "iai") {
    ok = true;
    notes.push("居合下协助格挡必定成功。");
  }
  if (ok) {
    notes.push("成功：目标免伤，击破改由格挡者承担。");
    if (typeof bpAfterBlock === "function") bpAfterBlock(helper, target, notes);   // 单局图纸
    // 雷鸣：成功的协助格挡可以额外造成 等级 × 1d4 闪电伤害的反伤
    if (attacker && !attacker.dead && currentWeatherFor(helper) === "thunder") {
      const r = takeDice(Math.max(1, Number(helper.level) || 1), 4, 0);
      applyTypedDot(attacker, r.total, "electric", notes, `雷鸣：${helper.name} 格挡反伤 ${r.text}`);
    }
    if (helper.kit === "nora" && attacker) setPierce(helper, attacker, notes);
    if (helper.kit === "vitas") flipMood(noraOf(), notes, "维塔斯格挡成功");
    if (helper.kit === "ruby" || helper.kit === "mint") {
      const ruby = findKit("ruby", state.units);
      if (ruby && ruby.resources) {
        ruby.resources.nano = Math.min(100, (ruby.resources.nano || 0) + 20);
        notes.push(`纳米能源 +20 → ${ruby.resources.nano}`);
      }
    }
    if (helper.kit === "yuito") {
      notes.push(typeof beanToLiquid === "function" && beanToLiquid() ? "咖啡豆 → 咖啡液。" : "成功但没有咖啡豆可转化。");
    }
    if (helper.kit === "kolt" && attacker) {
      dealBreak(attacker, 1, "electric", notes, "协助格挡");
      queueKoltSwap(helper);
      notes.push("可选择是否更换刀头。");
    }
    if (helper.kit === "helu" && attacker) {
      const layer = ((attacker.layers || []).find(l => (l.current || 0) > 0) || {}).type;
      applyFocus(attacker, layer, notes);
    }
    if (helper.kit === "ras") {
      convertRasLight(helper.resources && helper.resources.energyPct);
      notes.push("格挡成功：累积能量全部转为光能。");
    }
    if (helper.kit === "ecmo") {
      notes.push("音波偏转：自身不扣除架势。");
    }
    if (helper.kit === "hiaki") {
      const st = helper.resources.stance || "draw";
      if (st === "iai") {
        setHiakiStance(helper, "waki");
        notes.push("进入胁构。");
      } else if (st === "waki") {
        if (attacker) {
          attacker.def = Math.max(0, (attacker.def || 0) - 1);
          notes.push(`胁构反伤 1 击破 → ${attacker.name} 架势 ${attacker.def}`);
          if (attacker.def <= 0) {
            attacker.stunned = true;
            notes.push(imbalanceLine(attacker));
            queueAssistAttack(helper, attacker);
          }
        }
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
      notes.push(`${attacker.name} 被年糕咬住，1 回合无法移动。`);
    }
    if (helper.kit === "xia" && attacker) {
      attacker.def = Math.max(0, (attacker.def || 0) - 1);
      notes.push(`夕夏格挡反打 1 击破 → ${attacker.name} 架势 ${attacker.def}`);
      if (helper.resources && helper.resources.engine) {
        const burn = Math.floor(effectiveAtk(helper, state.units) / 2);
        hitOne2(helper, attacker, { atk: 0, mult: 0, flat: burn, element: "fire", baseBreak: 0, flags: { action: true, opportunity: true } }, notes);
        notes.push(`引擎格挡：追加 ${burn} 火焰。`);
      }
    }
    if (helper.kit === "berniel" && attacker && ownerEngineOn("xia")) {
      hitOne2(helper, attacker, { element: "physical", mult: 1, baseBreak: 0, atk: effectiveAtk(helper, state.units), flags: { action: true, opportunity: true } }, notes);
      notes.push("引擎下柏妮尔格挡成功：对进攻者打出 1×atk 物理。");
    }
    if (helper.kit === "chuan" && attacker) {
      dealBreak(attacker, 2, "electric", notes, "川川格挡");
      addCharge(1);
      notes.push("川川格挡：电能 +1。");
    }
    if (helper.kit === "bili" && attacker) {
      notes.push("哔哩哩格挡成功：反伤本次伤害的 50%，且自身不掉架势。");
      helper.biliReflect = true;
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
  const attacker = unitById(job.attackerId);
  const target = unitById(job.targetId);
  const helpers = eligibleBlockers(target);
  text.textContent = `${attacker ? attacker.name : "敌人"} 正在攻击 ${target ? target.name : "玩家"}。同区域有附赠行动的队友可以协助格挡。`;
  box.innerHTML = "";
  helpers.forEach(h => {
    const b = document.createElement("button");
    b.className = "btn primary";
    b.textContent = `${h.name} ${isUnarmed(h) ? "空手格挡" : "格挡"}（${finalBlockChance(h, attacker, target)}%）`;
    b.onclick = () => finishBlock(h.id);
    box.appendChild(b);
  });
  const no = document.createElement("button");
  no.className = "btn";
  no.textContent = "不格挡";
  no.onclick = () => finishBlock(null);
  box.appendChild(no);
  modal.classList.remove("hidden");
}

function closeBlockModal() {
  if (!HAS_DOM) return;
  const modal = uiEl("blockModal");
  if (modal) modal.classList.add("hidden");
}

function finishBlock(helperId, forced) {
  const job = (state.blockQueue || [])[0];
  const attacker0 = job ? unitById(job.attackerId) : null;
  const title = attacker0 ? `【${attacker0.name}】的攻击落下` : "";
  const prevActor = LOG_ACTOR_ID;
  LOG_ACTOR_ID = attacker0 ? attacker0.id : null;
  let lines;
  try { lines = withLogSink(() => finishBlockInner(helperId, forced)); } finally { LOG_ACTOR_ID = prevActor; }
  const block = tidyActionBlock(title, lines);
  if (block.length) appendLog(block.join("\n"));
  renderAll();
  presentBlockModal();
}

function finishBlockInner(helperId, forced) {
  const job = (state.blockQueue || []).shift();
  closeBlockModal();
  if (!job) return;
  const attacker = unitById(job.attackerId);
  const target = unitById(job.targetId);
  const opt = job.opt || {};
  opt.flags = opt.flags || {};
  opt.flags.blockResolved = true;
  if (job.onConnect) opt.onConnect = job.onConnect;
  if (helperId) {
    const helper = unitById(helperId);
    const out = performAssistBlock(helper, target, attacker, forced);
    appendLog(out.notes.join("\n"));
    opt.flags.block = out.ok ? (out.bare ? "bareOk" : "assistOk") : "fail";
    if (out.ok && !out.bare) opt.flags.blockHelperId = helperId;
  } else {
    appendLog(`没有人协助格挡 ${target ? target.name : ""}。`);
    opt.flags.block = "none";
  }
  if (attacker && target) {
    let out;
    const captured = withLogSink(() => { out = dealTo(attacker, target, opt); });
    if (out && out.res && !out.pending) formatHitLines(attacker, target, out, captured).forEach(s => appendLog(s));
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
  u.loseBonusNext = false;
  u.itemAtkBonus = 0;
  u.highEnergy = 0;
  u.highApplyTurn = null;
  u.highFrom = null;
  u._imbalanceLock = false;
  u.statuses = {
    burn: 0, shock: false, corr: false, frostbite: false, shockwave: false,
    high: false, reso: false, unstable: false, weak: false, inspire: false,
    sturdy: false, hide: false, advantage: false, chase: false, latestElement: null
  };
  u.instant = {};
  const r = u.resources = u.resources || {};
  r.stance = "draw";
  r.smashOnce = true;
  r.smashNext = false;
  r.niuOut = false;
  r.narutoOut = false;
  r.mecha = false;
  r.tauntLeft = 2;
  r.roleOnce = {};
  r.prepared = false;
  r.preparedPending = false;
  r.preparedActive = false;
  r.weakNext = false;
  r.gambitStrike = false;
  r.gambitWound = false;
  r.gritTurn = false;
  r.standTurn = false;
  r.blockUsedThisTurn = false;
  if (u.kit === "hiaki" && !r.blade) r.blade = "niu";
  if (u.kit === "tou") r.shield = 0;
  if (!isWeaponUnit(u)) u.weaponHeld = true;
  if (u.kit === "xia") r.engine = false;
  if (u.kit === "yuito") r.bean = Math.max(1, Number(r.bean) || 0);
  if (u.kit === "ruby" && r.nano == null) r.nano = 40;
  if (u.kit === "kolt") r.bit = r.bit || "drill";
  if (u.kit === "ras") { r.energyPct = 0; r.light = 0; r.unstable = false; }
  if (u.kit === "helu") { r.scanned = false; r.lockLeft = 1; }
  if (u.kit === "torque") r.acidCharge = null;
  u.focuses = [];
  stripTempLayers(u);
  (u.layers || []).forEach(l => { l.current = l.max; });
  u.def = u.defMax;
  if (u.kit === "hiaki" && typeof refreshHiakiAtk === "function") refreshHiakiAtk(u);
}

function roleOnce(a, key, limit) {
  if (!a) return false;
  a.resources = a.resources || {};
  a.resources.roleOnce = a.resources.roleOnce || {};
  const n = a.resources.roleOnce[key] || 0;
  if (n >= (limit || 1)) return false;
  a.resources.roleOnce[key] = n + 1;
  return true;
}

function copyStatuses(src, dest) {
  if (!src || !dest) return;
  dest.statuses = dest.statuses || {};
  Object.keys(src.statuses || {}).forEach(k => {
    dest.statuses[k] = src.statuses[k];
  });
  if (typeof syncShockwave === "function") syncShockwave(dest, null);
  dest.instant = dest.instant || {};
  Object.keys(src.instant || {}).forEach(k => {
    if (k === "omenFrom" || k === "omenArmed") return;
    dest.instant[k] = src.instant[k];
  });
  dest.highEnergy = src.highEnergy || dest.highEnergy;
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
  if (st.high || (Number(t.highEnergy) || 0) > 0) out.push({ key: "high", label: `高能 ${Number(t.highEnergy) || 0}` });
  return out;
}

/** 激活一种状态：效果与「触发一次该状态的回合结束结算」完全相同。
 *  灼烧一次性触发全部层；冻伤触发一次击破；其余同理。
 *  key 省略时取第一个可激活的状态。 */
function triggerOneStatus(t, src, key) {
  const notes = [];
  if (!t) return ["没有目标。"];
  const list = activatableStatuses(t);
  if (!list.length) {
    notes.push(`${t.name} 身上没有可激活的状态。`);
    return notes;
  }
  const pick = list.find(x => x.key === key) || list[0];
  const weather = currentWeatherFor(t);
  t.statuses = t.statuses || {};

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
    applyTypedDot(t, dmg, "fire", notes, `${t.name} 激活灼烧 ${stacks} 层：${parts.join(" + ")} = ${dmg}`);
    let add = 1;
    if (weather === "heat") add += 1;
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
    const d = statusDotDice("corr", t.level, weather, armor);
    const r = takeDice(d.n, d.s, 0);
    applyTypedDot(t, r.total, "acid", notes, `${t.name} 激活腐蚀 ${r.text}`);
    return notes;
  }
  if (pick.key === "frostbite") {
    let br = weather === "snow" ? 2 : 1;
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
    dealBreak(t, br, "ice", notes, "冻伤");
    return notes;
  }
  if (pick.key === "shockwave") {
    dealBreak(t, 1, "physical", notes, "激活震荡");
    return notes;
  }
  if (pick.key === "high") {
    const dmg = Number(t.highEnergy) || 0;
    applyTypedDot(t, dmg, "energy", notes, `${t.name} 激活高能 ${dmg}`);
    return notes;
  }
  notes.push(`${t.name} 身上没有可激活的状态。`);
  return notes;
}

function applyRallyBuff(u, lines) {
  if (!u || !u.roles) return;
  const p = u.roles.primary;
  u.rallyBuff = p;
  if (p === "直伤") {
    u.atk = (u.atk || 0) + 15;
    lines.push(`${u.name} 直伤集结：ATK +15。`);
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

function runOnConnect(attacker, target, spec) {
  const notes = [];
  if (!spec || !target) return notes;
  if (spec.dest != null) {
    const dest = Number(spec.dest);
    if (typeof displaceTo === "function") displaceTo(target, dest, notes, spec.reason || "被位移");
    else { target.zone = dest; notes.push(`${target.name} 被移到 ${dest} 区。`); }
  }
  if (spec.status) {
    target.statuses = target.statuses || {};
    target.statuses[spec.status] = spec.statusVal != null ? spec.statusVal : true;
    if (spec.status === "high") {
      target.highApplyTurn = state.turnNo;
      if (attacker && attacker.kit === "ruby") tagHighFrom(target, "ruby");
    }
    if (typeof popStatus === "function") popStatus(target, spec.status);
    notes.push(`${target.name} 被施加${spec.status}。`);
  }
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
  ["combust","icebreak","bolt","etch","backflow","inertia","diffract"].forEach(id => {
    const el = uiEl("fFx_" + id);
    if (el && el.checked) fromBox.push(id);
  });
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
      applyTypedDot(target, share, ele, extra, "衍射回传");
      target._resoBusy = false;
    }
  }

  if (list.indexOf("combust") >= 0 && target && (isInnerDepleted(target) || target.dead || (typeof isUnitDown === "function" && isUnitDown(target) && !target.upOnShp))) {
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

function dealTo(attacker, target, opt) {
  opt = opt || {};
  opt.flags = makeDealFlags(opt.flags);
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
  if (attacker && target && opt.flags.action && !opt.flags.aoe && !isReaction && !opt.flags.conductorExtra) {
    const d = zoneDist(Number(attacker.zone), Number(target.zone), Number(state.zoneMode));
    const rg = opt.atkRange || (attacker.isPlayer ? "any" : (attacker.range || "any"));
    const okRange = rg === "melee" ? d === 0 : rg === "ranged" ? d === 1 : d <= 1;
    if (!okRange) {
      const name = rg === "melee" ? "近距离" : rg === "ranged" ? "远距离" : "任意距离";
      const msg = `${attacker.name} 是${name}攻击，打不到距离 ${d} 的 ${target.name}。`;
      appendLog(msg);
      return { res: { ok: false, total: 0, breakDealt: 0, log: [msg], perHit: [] }, extra: [msg] };
    }
  }
  // 躲藏：不会被选做攻击目标（范围攻击、反应不是「选目标」，照常波及）
  if (target && target.statuses && target.statuses.hide && opt.flags.action && !opt.flags.aoe && !isReaction && !opt.flags.conductorExtra) {
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
  // 飞行：近程攻击飞行单位要额外付一个附赠行动；付不起就打不到。
  // 范围攻击、杂兵、以及飞行打飞行不受此限。
  if (attacker && target && target.flying && opt.flags.action && !opt.flags.aoe && !isReaction) {
    const d = zoneDist(Number(attacker.zone), Number(target.zone), Number(state.zoneMode));
    const minion = !attacker.isPlayer && (typeof enemyRankOf === "function") && enemyRankOf(attacker) === "minion";
    if (d === 0 && !attacker.flying && !minion) {
      if ((Number(attacker.bonus) || 0) < 1) {
        const msg = `${target.name} 在飞行，近程攻击需要额外 1 附赠行动，${attacker.name} 附赠行动不足。`;
        appendLog(msg);
        return { res: { ok: false, total: 0, breakDealt: 0, log: [msg], perHit: [] }, extra: [msg] };
      }
      attacker.bonus = (Number(attacker.bonus) || 0) - 1;
      appendLog(`${attacker.name} 额外消耗 1 附赠行动以近程攻击飞行中的 ${target.name}。`);
    }
  }
  if (target && ignoresAoe(target) && opt.flags.aoe) {
    const msg = "飞碟触灵本体不受范围效果波及。";
    return { res: { ok: false, total: 0, breakDealt: 0, log: [msg], perHit: [] }, extra: [msg] };
  }
  if (target && target.kit === "ufo_body" && !(opt.flags.assist && target.stunned)) {
    const msg = "飞碟触灵本体无法被通常手段攻击。只有本体失衡时的协助攻击可以打到它。";
    appendLog(msg);
    return { res: { ok: false, total: 0, breakDealt: 0, log: [msg], perHit: [] }, extra: [msg] };
  }
  if (attacker && attacker.isPlayer && target && !target.isPlayer && opt.flags.action && !opt.flags.assist && !opt.flags.aoe && opt.flags.block !== "assistOk" && !opt.flags.blockResolved) {
    const auto = tryOxAutoBlock(attacker, target);
    if (auto && auto.ok) {
      opt.flags.block = "assistOk";
      opt.flags.blockHelperId = auto.helperId;
      opt.flags.blockResolved = true;
    } else if (auto) {
      opt.flags.blockResolved = true;
    }
  }
  if (attacker && !attacker.isPlayer && target && (target.isPlayer || target.kit === "ironwall") && opt.flags && opt.flags.action && !opt.flags.diffract) {
    const wallHit = absorbIronWall(attacker, target.zone, opt);
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
  if (attacker && !attacker.isPlayer && target && target.isPlayer && opt.flags.action && !opt.flags.assist && !opt.flags.aoe && opt.flags.block !== "assistOk" && !opt.flags.blockResolved) {
    const helpers = eligibleBlockers(target);
    if (helpers.length) {
      appendLog(`→ ${target.name}：等待协助格挡（同区可以格挡的：${helpers.map(h => h.name + " " + finalBlockChance(h, attacker, target) + "%").join("、")}）`);
      state.blockQueue = state.blockQueue || [];
      state.blockQueue.push({
        attackerId: attacker.id,
        targetId: target.id,
        onConnect: opt.onConnect || null,
        opt: JSON.parse(JSON.stringify({
        atk: opt.atk, mult: opt.mult, flat: opt.flat, hits: opt.hits, breakOnce: opt.breakOnce, element: opt.element,
        baseBreak: opt.baseBreak, diceN: opt.diceN, diceS: opt.diceS, diceB: opt.diceB, diceValue: opt.diceValue,
        usePrep: opt.usePrep, flags: Object.assign({}, opt.flags, { blockResolved: false })
      }))
      });
      presentBlockModal();
      return { res: { ok: false, pending: true, total: 0, breakDealt: 0, log: ["等待协助格挡选择"], perHit: [] }, extra: ["等待协助格挡选择"], pending: true };
    }
  }
  markXiaAttack(attacker);
  if (attacker && target && target.zone != null && attacker.zone != null && !opt.flags.diffract) {
    const block = lineBlocked(attacker.zone, target.zone);
    if (block) {
      appendLog(block);
      return { res: { ok: false, total: 0, breakDealt: 0, log: [block], perHit: [] }, extra: [block] };
    }
  }
  const flags = makeDealFlags(opt.flags);
  if (target && target.kit === "chixia" && target.resources && target.resources.cover) {
    flags.dr50 = true;
    opt.baseBreak = 0;
  }
  if (opt.smash || (attacker.resources && attacker.resources.smashNext)) flags.smash = true;
  if (attacker.resources && attacker.resources.pierceNext) {
    flags.pierce = true;
    attacker.resources.pierceNext = false;
  }
  if (attacker.resources && attacker.resources.gambitStrike) flags.doubleDeal = true;
  if (target && target.resources && target.resources.gambitWound) flags.doubleTake = true;
  if (target && target.resources && target.resources.gritTurn) flags.dr50 = true;
  if (target && target.resources && target.resources.standTurn) flags.immune = true;
  if (target && target.resources && target.resources.frostShell) flags.immune = true;   // 再次霜结：完全免受伤害与击破
  if (target && target.instant && target.instant.doubleBreak) {
    opt.baseBreak = (opt.baseBreak != null ? opt.baseBreak : 1) * 2;
  }
  if (attacker.resources && attacker.resources.weakNext) {
    flags.weak = true;
    attacker.resources.weakNext = false;
  }
  let prepBonus = 0;
  let prepNote = "";
  if (attacker.resources && attacker.resources.preparedActive && opt.usePrep !== false) {
    const s = upgradeDieSides(6, milestone(attacker.level || 1, 5));
    const r = takeDice(1, s, 0);
    prepBonus = r.total;
    prepNote = "准备" + r.text;
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
  if (prepBonus) {
    diceValue = (Number(diceValue) || 0) + prepBonus;
    extraDiceNote = extraDiceNote ? extraDiceNote + " + " + prepNote : prepNote;
  }
  // 单局图纸：打近 / 远距离的额外骰、承受伤害 +1d10 等（mods.js）
  if (typeof bpDiceAdjust === "function") {
    const adj = bpDiceAdjust(attacker, target, flags);
    if (adj.text.length) {
      diceValue = (Number(diceValue) || 0) + adj.value;
      extraDiceNote = [extraDiceNote, ...adj.text].filter(Boolean).join(" + ");
    }
  }
  // 过度自信：现有血量 ≥ 血量上限即减伤。上限不含废物利用等临时血量，
  // 所以靠临时层把血量堆回（甚至超过）上限时也会触发。
  if (target && target.kit === "kolt" && flags.action && !target.upOnShp && (typeof passiveOn !== "function" || passiveOn(target))) {
    const cur = totalCurHp(target);
    const mx = baseMaxHp(target);
    if (mx > 0 && cur >= mx) flags.prideReduce = true;
  }
  if (attacker && (attacker.kit === "helu" || attacker.kit === "ecmo") && target && target.focuses && target.focuses.length) {
    flags.focusLayer = pickFocusLayer(target);
  }
  let br = opt.baseBreak != null ? opt.baseBreak : 1;
  if (attacker.rallyBreak) br += attacker.rallyBreak;
  if (attacker.kit === "hiaki" && attacker.resources && attacker.resources.blade === "naruto" &&
      (typeof passiveOn !== "function" || passiveOn(attacker))) br += 1;   // 被动「佩刀」
  const dist = zoneDist(attacker.zone, target.zone, state.zoneMode);
  const res = resolveAttack({
    attacker, target,
    atk: opt.atk != null ? opt.atk : effectiveAtk(attacker, state.units),
    mult: ((flags.assist || (attacker && state._assistBy === attacker.id)) && typeof bpAssistMult === "function") ? bpAssistMult(attacker, opt.mult != null ? opt.mult : 1) : (opt.mult != null ? opt.mult : 1),
    flat: opt.flat || 0,
    diceValue,
    element: opt.element || "physical",
    baseBreak: br,
    hits: opt.hits || 1,
    breakOnce: !!opt.breakOnce,
    flags,
    weather: currentWeatherFor(target),
    phaseStep: Number(state.phaseStep),
    zoneMode: state.zoneMode,
    attackerField: state.fields[attacker.zone] || {},
    targetField: state.fields[target.zone] || {},
    highA: state.fields[attacker.zone] && state.fields[attacker.zone].highland,
    highT: state.fields[target.zone] && state.fields[target.zone].highland,
    dist,
    atkRange: opt.atkRange || "any"
  });
  res.flags = flags;
  const wasStunnedT = !!target.stunned;
  const shieldBeforeT = shieldSum(target);
  const extra = applyCombat(target, res, attacker);
  // 手册第四章补全的效果（effects.js）
  if (typeof afterDamageTaken === "function") {
    afterDamageTaken(target, opt.element || res.element, res.total || 0, Math.max(0, shieldBeforeT - shieldSum(target)), extra, {
      attacker, action: !!flags.action, melee: dist === 0, startLayerType: res.startLayerType
    });
  }
  if ((res.breakDealt || 0) > 0 && typeof onBreakTaken === "function") onBreakTaken(target, res.breakDealt, opt.element || res.element, extra);
  if (!wasStunnedT && target.stunned && typeof onBroken === "function") onBroken(target, extra);
  if (flags.action && !isReaction && typeof afterAttackDealt === "function") afterAttackDealt(attacker, target, opt.element || res.element, res, opt, extra);
  if ((res.total || 0) > 0) {
    const deadLayer = (target.layers || []).find(l => (Number(l.current) || 0) <= 0 && !l.sealed);
    if (deadLayer) state.lastBrokenLayer = { type: deadLayer.type, lost: deadLayer.max || 0, dmg: res.total || 0 };
  }
  if (flags.action) advanceFocusOnHit(attacker, target, opt.element || res.element, res, extra);
  if (target && target.kit === "ras" && target.resources && target.resources.unstable && (res.total || 0) > 0 && flags.action) {
    extra.push("不稳态：拉斯缪尔受到伤害，立即死亡。");
    (target.layers || []).forEach(l => { l.current = 0; });
    target.dead = true;
  }
  if (attacker && (attacker.kit === "kolt" || attacker.kit === "torque") && target && !target.isPlayer && flags.action && !flags.aoe &&
      (typeof passiveOn !== "function" || passiveOn(attacker))) {
    target.tauntTo = (findKit("kolt", state.units) || attacker).id;
    extra.push(`过度自信：${target.name} 被嘲讽，下次攻击必须打柯尔特。`);
  }
  applyAtkFxAfter(attacker, target, res, flags, extra, opt);
  if (typeof bpAfterAttack === "function") bpAfterAttack(attacker, target, res, flags, extra);
  if (res && !res.pending) noteActionHit(target, res);
  if (flags.block === "assistOk") {
    extra.push(...applyBlockBreakToHelper(flags.blockHelperId, res.helperBreak));
  }
  if (extraDiceNote) extra.unshift("掷骰 " + extraDiceNote);
  gainHighFromHits(target, res, extra);
  checkHighBoom(target);
  extra.push(...pulseResonanceDamage(target, res.total || 0, opt.element || res.element));
  if (flags.block !== "assistOk" && flags.block !== "bareOk") {
    const hits = (res.perHit && res.perHit.length) ? res.perHit : [{ dealt: res.total || res.intended || 0 }];
    hits.forEach((h, i) => {
      extra.push(...pulseHighVoltage(target, (h.dealt || h.total || h.intended || 0) || 1, i + 1, hits.length));
    });
  }
  if (flags.smash && attacker.resources) attacker.resources.smashNext = false;
  if (flags.aoe) markAoeZone(target && target.zone);
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
    if (attackConnected(res, flags)) extra.push(...runOnConnect(attacker, target, opt.onConnect));
    else extra.push("格挡成功：位移与其他附带效果未生效。");
  }
  if (!res.pending) {
    const ele = opt.element || res.element || "physical";
    if ((res.intended || res.total || 0) > 0) spawnFloater(target, res.intended || res.total, ele);
    if ((res.extraHarmonic || 0) > 0) spawnFloater(target, res.extraHarmonic, ele);
    if ((res.breakDealt || 0) > 0 && flags.block !== "assistOk") popBreak(target, res.breakDealt, ele);
    if (flags.block === "assistOk" && (res.helperBreak || 0) > 0) {
      const helper = unitById(flags.blockHelperId);
      if (helper) popBreak(helper, res.helperBreak, ele);
    }
  }
  return { res, extra };
}

function triggerMagnetShield(broken) {
  const notes = [];
  if (!broken || !(broken.shieldFromChuan || broken.magnetShield)) return notes;
  const c = findKit("chuan", state.units);
  if (!c || Number(c.zone) !== Number(broken.zone)) return notes;
  if (typeof passiveOn === "function" && !passiveOn(c)) return notes;   // 放弃被动「磁场护盾」
  broken.shieldFromChuan = false;
  broken.magnetShield = false;
  const dest = otherZone(c.zone);
  notes.push(`磁场护盾：${broken.name} 上由川川/哔哩哩施加的护盾被破坏，效果触发后解除。同区敌人被推到 ${dest} 区并各受 1 击破。`);
  visibleEnemies(c.zone).filter(u => !ignoresAoe(u)).forEach(u => {
    u.zone = dest;
    dealBreak(u, 1, "electric", notes, "磁场护盾");
  });
  return notes;
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

function addShieldLayer(u, amount) {
  if (!u || amount <= 0) return;
  amount = Math.floor(amount);
  let sh = (u.layers || []).find(l => l.type === "shield");
  if (!sh) {
    u.layers.unshift({ type: "shield", current: amount, max: amount });
  } else {
    sh.current = Number(sh.current) + amount;
    sh.max = Number(sh.max) + amount;
  }
  u.shieldFromChuan = true;
}

function addNano(n) {
  const ruby = findKit("ruby", state.units);
  if (!ruby) return;
  if (n > 0 && !(typeof passiveOnKit !== "function" || passiveOnKit("ruby"))) return;   // 放弃被动「纳米科技」
  ruby.resources = ruby.resources || {};
  ruby.resources.nano = Math.max(0, Math.min(100, (ruby.resources.nano || 0) + n));
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
function setHiakiStance(u, stance) {
  if (!u) return;
  u.resources = u.resources || {};
  if (stance !== "draw" && typeof passiveOn === "function" && !passiveOn(u)) { u.resources.stance = "draw"; return; }
  u.resources.stance = stance;
}

function setBond(yuito, ally) {
  if (!yuito || !ally) return;
  if (typeof passiveOn === "function" && !passiveOn(yuito)) return;   // 放弃被动「思念」
  yuito.resources = yuito.resources || {};
  yuito.resources.bondId = ally.id;
  yuito.resources.bondName = ally.name;
}

function spawnWeapon(owner, kit) {
  const card = livePartyCards().find(c => c.kit === kit);
  if (!card) return null;
  if (state.units.some(u => u.kit === kit && !u.hidden && !u.fused)) return null;
  // 同场战斗内血量继承：收回时只是隐藏，再唤出沿用上次的血量层，并移除旧的隐藏单位
  const prev = state.units.find(x => x.kit === kit && x.hidden && !x.fused);
  if (prev && (prev.layers || []).reduce((s, l) => s + Math.max(0, Number(l.current) || 0), 0) <= 0) return null;
  const u = spawnLiveCard(card, owner.zone);
  u.level = (owner.weaponLevels && owner.weaponLevels[kit]) || card.level || 1;
  if (typeof applyWeaponLevel === "function") applyWeaponLevel(u);
  // 队伍档案：武器人显示档案里的耐久
  if (typeof weaponDur === "function" && u.resources) u.resources.durability = weaponDur(kit);
  // 单局状态：武器人跨战斗保留耐久与血量
  if (typeof RUN !== "undefined" && RUN.active && RUN.carry && RUN.carry[kit]) {
    const c = RUN.carry[kit];
    if (c.durability != null && u.resources) u.resources.durability = c.durability;
    (u.layers || []).forEach((l, i) => {
      const sv = (c.layers || [])[i];
      if (sv && sv.type === l.type) l.current = Math.max(0, Math.min(Number(l.max) || 0, sv.current));
    });
  }
  // 队伍档案：本场第一次唤出时，带着上一场留下的伤势
  const carried = !prev && typeof weaponCarryLayers === "function" ? weaponCarryLayers(kit) : null;
  if (carried) {
    (u.layers || []).forEach((l, i) => {
      const sv = carried[i];
      if (sv && sv.type === l.type) l.current = Math.max(0, Math.min(Number(l.max) || 0, Number(sv.current) || 0));
    });
    if (totalCurHp(u) <= 0) return null;   // 上一场倒下、还没长休：唤不出来
  }
  // 维塔斯：双相与刺入属于武器系统，分出来时从诺拉那边同步过来
  if (kit === "vitas") {
    u.resources = u.resources || {};
    u.resources.mood = (owner.resources || {}).mood === "cruel" ? "cruel" : "gentle";
    u.resources.piercedId = (owner.resources || {}).piercedId || null;
  }
  if (prev) {
    (u.layers || []).forEach((l, i) => {
      const old = (prev.layers || [])[i];
      if (old && old.type === l.type) l.current = Math.max(0, Math.min(Number(l.max) || 0, Number(old.current) || 0));
    });
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
  weapon.hidden = true;
  notes.push(`${weapon.name} 已收回为武器。`);
  return notes;
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
    ? computeWeaponAtk(blade, h.attrs, lv)
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
  if ((ruby.resources.nano || 0) <= 0) return ["纳米能源不足，无法进入机甲。"];
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
  ruby.layers = clone(m.layers).concat(clone(ruby.layers));
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
  const armor = layersNow.filter(l => l.type === "armor");
  const rest = layersNow.filter(l => l.type !== "armor");
  if (pre) {
    ruby.layers = rest.length ? rest : pre.layers;
    ruby.flying = false;
  }
  ruby.resources.mecha = false;
  if (mint) {
    mint.hidden = false;
    mint.fused = false;
    mint.zone = ruby.zone;
    mint.ap = ruby.ap || 0;
    mint.apMax = ruby.apMax || mint.apMax;
    mint.bonus = ruby.bonus || 0;
    mint.bonusMax = ruby.bonusMax || mint.bonusMax;
    notes.push(`机甲解除后行动资源同步：瑞比/明特 行动点 ${mint.ap}，附赠 ${mint.bonus}`);
    if (armor.length) mint.layers = armor;
    const fall = Math.floor(totalMaxHp(ruby) * 0.2);
    const fallM = Math.floor(totalMaxHp(mint) * 0.2);
    applyTrueDamage(ruby.layers, fall);
    applyTrueDamage(mint.layers, fallM);
    notes.push(`坠落：瑞比 ${fall}，明特 ${fallM}`);
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

function zoneReachable(unit, dest) {
  if (!unit) return "没有行动者。";
  dest = Number(dest);
  const from = Number(unit.zone);
  if (dest === from) return "必须换到另一个区域。";
  if (dest < 1 || dest > Number(state.zoneMode)) return "没有这个区域。";
  const step = dest > from ? 1 : -1;
  for (let z = from; z !== dest; z += step) {
    const g = getGap(z, z + step);
    if (g.type === "wall") return "危墙挡住去路。";
    if (g.type === "door" && !g.open) return "机关门关着。";
    if (g.type === "void" && !(unit.flying || (state.forceVoid && state.forceVoid[gapKey(z, z + step)]))) {
      return "空隙挡住地面单位。";
    }
  }
  return null;
}

function skillFlowSteps(id, actor, picks) {
  picks = picks || {};
  if (!actor) return [];
  const maxZ = Number(state.zoneMode);
  if (id === "kolt_swap" || id === "torque_swap") {
    const units = fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && !u.fused && Number(u.zone) === Number(actor.zone));
    return [{ key: "target", type: "unit", optional: true, label: "切刀近距离目标（同区，可不选）", units }];
  }
  if (id === "kolt_short") {
    const zones = [];
    for (let z = 1; z <= maxZ; z++) if (zoneDist(actor.zone, z, maxZ) <= 1) zones.push(z);
    return [{ key: "dest", type: "zone", optional: true, label: "可先移动至多 1 区", zones }];
  }
  if (id === "torque_boost") {
    const bit = ((findKit("kolt", state.units) || {}).resources || {}).bit || "drill";
    if (bit === "acid") {
      const zones = [];
      for (let z = 1; z <= maxZ; z++) zones.push(z);
      return [{ key: "dest", type: "zone", optional: false, label: "酸液炮蓄力落点", zones }];
    }
    const zs = [];
    for (let z = 1; z <= maxZ; z++) if (zoneDist(actor.zone, z, maxZ) === 1) zs.push(z);
    return [{ key: "dest", type: "zone", optional: false, label: "突进终点（距离 1）", zones: zs }];
  }
  if (id === "torque_strip") {
    return [
      { key: "target", type: "unit", optional: false, label: "拆卸目标（同区敌人）",
        units: fieldUnits().filter(u => !u.isPlayer && !u.dead && Number(u.zone) === Number(actor.zone)) },
      { key: "ally", type: "unit", optional: false, label: "接收外层血量的同区友方",
        units: fieldUnits().filter(u => u.isPlayer && !u.dead && Number(u.zone) === Number(actor.zone)) }
    ];
  }
  if (id === "helu_scan") {
    const zones = [];
    for (let z = 1; z <= maxZ; z++) zones.push(z);
    const steps = [{ key: "dest", type: "zone", optional: false, label: "检查哪一区", zones }];
    const z = picks.dest != null ? Number(picks.dest) : null;
    if (z != null) {
      const props = (state.props || []).filter(p => Number(p.zone) === z);
      if (props.length) {
        steps.push({
          key: "prop", type: "choice", optional: true, label: "远程操作已有配置物（可跳过）",
          options: [{ value: "", label: "不操作" }].concat(props.map(p => ({ value: p.id, label: p.name })))
        });
      }
    }
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
    const zones = [];
    for (let z = 1; z <= maxZ; z++) {
      if (unstable || zoneDist(actor.zone, z, maxZ) === 1) zones.push(z);
    }
    return [
      { key: "dest", type: "zone", optional: false, label: unstable ? "不稳：移动不限" : "逃离终点（1 距离）", zones },
      { key: "target", type: "unit", optional: false, label: "原区受击敌人",
        units: fieldUnits().filter(u => !u.isPlayer && !u.dead && Number(u.zone) === Number(actor.zone)) }
    ];
  }
  if (id === "xia_selfburn") {
    const zones = [];
    for (let z = 1; z <= maxZ; z++) if (Math.abs(z - Number(actor.zone)) === 1) zones.push(z);
    if (!zones.length) return [];
    return [{ key: "dest", type: "choice", optional: true, label: "是否顺势移动 1 距离",
              options: [{ value: 0, label: "留在原地" }].concat(zones.map(z => ({ value: z, label: `移动到 ${z} 区` }))) }];
  }
  if (id === "chuan_blade") {
    const units = fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden &&
      Number(u.zone) === Number(actor.zone));
    const props = (state.props || []).filter(p => Number(p.zone) === Number(actor.zone) && (Number(p.hp) || 0) > 0)
      .map(p => ({ id: "prop:" + p.id, name: p.name, zone: p.zone }));
    if (!props.length) return [];
    return [{ key: "target", type: "unit", optional: false, label: "巨刃划空目标（同区敌人或配置物）",
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
  if (id === "en_gl") {
    return [{
      key: "dest",
      type: "zone",
      optional: false,
      label: "榴弹落点区域",
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
    return [
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
    ];
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
      units: fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden &&
        zoneDist(actor.zone, u.zone, state.zoneMode) <= maxD)
    });
    return steps;
  }
  if (id === "tou_start") {
    const dest = picks.dest != null ? Number(picks.dest) : Number(actor.zone);
    const steps = [
      {
        key: "dest",
        type: "zone",
        optional: false,
        label: "移动到哪一区（距离 ≤1，可留在本区）",
        zones: zones.filter(z => zoneDist(actor.zone, z, state.zoneMode) <= 1)
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
    const steps = [{
      key: "target",
      type: "unit",
      optional: false,
      label: "猛扑目标（距离1敌人，或同区带走）",
      units: fieldUnits().filter(u => !u.isPlayer && (Number(u.zone) === Number(actor.zone) || zoneDist(actor.zone, u.zone, state.zoneMode) === 1))
        .concat((state.props || []).filter(p => p.movable !== false && (Number(p.zone) === Number(actor.zone) || zoneDist(actor.zone, p.zone, state.zoneMode) === 1)).map(p => ({ id: "prop:" + p.id, name: p.name, zone: p.zone })))
    }];
    const t = unitById(picks.target) || propByRef(picks.target);
    if (t && Number(t.zone) === Number(actor.zone)) {
      steps.push({
        key: "dest",
        type: "zone",
        optional: false,
        label: "把目标带到哪一区",
        zones: zones.filter(z => Number(z) !== Number(actor.zone) && !zoneReachable(actor, z))
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
    if (picks.mode === "heal") {
      steps.push({
        key: "target",
        type: "unit",
        optional: false,
        label: "治疗谁",
        units: fieldUnits().filter(u => u.isPlayer && !u.dead)
      });
    } else if (picks.mode === "atk") {
      steps.push({
        key: "target",
        type: "unit",
        optional: false,
        label: "选该区参照单位（清场打该区敌人）",
        units: fieldUnits().filter(u => !u.dead)
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
      label: "哪一区变成酸液地面（距离 ≤1）",
      zones: zones.filter(z => zoneDist(actor.zone, z, state.zoneMode) <= 1)
    }];
  }
  if (id === "hiaki_summon") {
    const usable = typeof summonableBlades === "function" ? summonableBlades(actor) : [];
    const label = { niu: "分出丹生谷", naruto: "分出鳴門" };
    if (usable.length <= 1) return [];
    return [{ key: "blade", type: "choice", optional: false, label: "分出哪一把",
              options: usable.map(k => ({ value: k, label: label[k] })) }];
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
    const near = fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && Number(u.zone) === Number(actor.zone));
    const far = fieldUnits().filter(u => !u.isPlayer && !u.dead && !u.hidden && zoneDist(actor.zone, u.zone, state.zoneMode) === 1);
    const steps = [];
    if (near.length) {
      steps.push({
        key: "target1", type: "unit", optional: far.length > 0,
        label: far.length ? "同区目标（1atk 谐波，可不选）" : "同区目标（1atk 谐波）",
        units: near
      });
    }
    if (far.length && (!near.length || picks.target1 !== undefined)) {
      steps.push({
        key: "target2", type: "unit", optional: !!picks.target1,
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
      b.onclick = () => applyFlowPick(u.id);
      opts.appendChild(b);
    });
  } else if (step.type === "zone") {
    (step.zones || []).forEach(z => {
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = z + " 区";
      b.onclick = () => applyFlowPick(Number(z));
      opts.appendChild(b);
    });
  } else if (step.type === "choice") {
    (step.options || []).forEach(opt => {
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = opt.label;
      b.onclick = () => applyFlowPick(opt.value);
      opts.appendChild(b);
    });
  }
  if (step.optional) {
    const skip = document.createElement("button");
    skip.className = "btn small";
    skip.textContent = "不选";
    skip.onclick = () => applyFlowPick(null);
    opts.appendChild(skip);
  }
  const cancel = document.createElement("button");
  cancel.className = "btn small danger";
  cancel.textContent = "取消技能";
  cancel.onclick = cancelSkillFlow;
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
    btn.onclick = () => {
      if (skillFlowSteps(sk.id, a, {}).length) beginSkillFlow(sk.id);
      else runSkill(sk.id);
    };
    box.appendChild(btn);
  });
  (state.props || []).filter(p => Number(p.zone) === Number(a.zone) && (p.kind === "button" || p.kind === "lever")).forEach(p => {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = p.kind === "lever" ? `扳动${p.name}` : `按下${p.name}`;
    btn.onclick = () => runSkill("use_device:" + p.id);
    box.appendChild(btn);
  });
  if (a.isPlayer && !isWeaponUnit(a) && a.dying && !a.dead) {
    const up = document.createElement("button");
    up.className = "btn ok";
    up.textContent = "起身";
    up.onclick = () => standUp(a);
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
  const element = spec.element || "physical";
  let text = spec.text;
  let dur = 2.3;
  let size = 14;
  let big = false;
  if (kind === "dmg") {
    const dmg = Math.floor(Number(spec.value) || 0);
    if (dmg <= 0) return;
    const th = ((unit.level || 1) * 2) + 8;
    const over = Math.max(0, Math.min(th, dmg - th));
    const ratio = th > 0 ? over / th : 0;
    big = dmg >= th;
    dur = big ? 3 + ratio * 1.5 : 2.3;
    size = big ? 26 + ratio * 18 : 15;
    text = big ? dmg + "!!" : String(dmg);
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

function dealBreak(unit, amount, element, notes, reason) {
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  if (!unit || !amount) return;
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
  const before = Number(sink.def) || 0;
  const wasStunnedSink = !!sink.stunned;
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
    queueAssistAttack(null, sink);
    if (brokeIntoStun && typeof onBroken === "function") onBroken(sink, notes);
  } else {
    maybeUnstableTrip(sink, notes);
  }
  if (typeof onBreakTaken === "function") onBreakTaken(sink, amount, element, notes);
}

function maybeUnstableTrip(u, notes) {
  if (!u || u.stunned || u.dead || u.noPosture) return;
  if (!u.statuses || !u.statuses.unstable) return;
  if ((Number(u.def) || 0) > 1) return;
  u.stunned = true;
  u.statuses.unstable = false;
  notes = notes || [];
  notes.push(`${u.name} 不稳：架势只剩 ${u.def}，直接失衡。`);
  notes.push(imbalanceLine(u));
  queueAssistAttack(null, u);
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

function piercedTarget(n) {
  n = n || noraOf() || vitasOf();
  if (!n || !n.resources || !n.resources.piercedId) return null;
  const t = unitById(n.resources.piercedId);
  if (!t || t.dead || t.hidden) { n.resources.piercedId = null; return null; }
  if (zoneDist(Number(n.zone), Number(t.zone), Number(state.zoneMode)) > 1) {
    n.resources.piercedId = null;
    return null;
  }
  return t;
}
function isPierced(u) {
  const t = piercedTarget();
  return !!(t && u && t.id === u.id);
}
function setPierce(n, t, lines) {
  if (!t) return;
  n = n || noraOf() || vitasOf();
  if (!n) return;
  if (typeof passiveOn === "function" && !passiveOn(n)) return;   // 放弃被动「冷气注射」：没有刺入
  n.resources = n.resources || {};
  const prev = n.resources.piercedId && unitById(n.resources.piercedId);
  if (prev && prev.id !== t.id) lines.push(`${prev.name} 的刺入解除。`);
  moodHolders().forEach(h => { h.resources = h.resources || {}; h.resources.piercedId = t.id; });
  spawnPopup(t, { kind: "status", text: "刺入", element: "ice" });
  lines.push(`针尖刺入 ${t.name}。`);
}
function clearPierce(n, lines, why) {
  n = n || noraOf() || vitasOf();
  moodHolders().forEach(h => { if (h !== n && h.resources) h.resources.piercedId = null; });
  if (!n || !n.resources || !n.resources.piercedId) return;
  const prev = unitById(n.resources.piercedId);
  n.resources.piercedId = null;
  if (prev && lines) lines.push(`${prev.name} 的刺入${why || "结束"}。`);
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
    const r = takeDice(1, 4, n.level || 1);
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

function crushOnce(a, t, auto) {
  const lines = [];
  if (!a || !t) return lines;
  const atk = effectiveAtk(a, state.units);
  a.zone = Number(t.zone);
  hitOne2(a, t, { element: "physical", mult: 1.5, baseBreak: 3, atk, flags: { action: true } }, lines);
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
  const out = dealTo(actor, target, opt);
  if (out && out.extra) lines.push(...out.extra);
}

function applyShift(u) {
  if (!u) return;
  u.instant = u.instant || {};
  u.instant.shift = true;
  if (u._shiftSwapped) return;
  if ((u.layers || []).length < 2) return;
  const tmp = u.layers[0];
  u.layers[0] = u.layers[1];
  u.layers[1] = tmp;
  u._shiftSwapped = true;
}

function clearShift(u) {
  if (!u) return;
  if (u._shiftSwapped && (u.layers || []).length >= 2) {
    const tmp = u.layers[0];
    u.layers[0] = u.layers[1];
    u.layers[1] = tmp;
  }
  u._shiftSwapped = false;
  if (u.instant) u.instant.shift = false;
}

function popStatus(unit, key) {
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
    if (/^协助格挡成功：目标免伤，击破 \d+ 改由格挡者承担。$/.test(s)) return;   // 下一行说得更完整
    out.push(`${multi ? "  " : ""}${s.replace(/（溢出不重算）/g, "")}`);
  });
  return out;
}

/** 一次命中写成几行：结果 → 掷骰 → 计算 → 后果 */
function formatHitLines(actor, target, out, captured) {
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
  const dmg = Math.floor(res.total || 0), br = Number(res.breakDealt) || 0;
  let head = `  → ${tName}：`;
  if (res.blocked) head += `被协助格挡挡下${br ? `（格挡者承受 ${br} 击破）` : ""}`;
  else {
    head += `${dmg} 伤害`;
    if (br) head += `、${br} 击破`;
    if (hits.length > 1) head += `（${hits.length} 击）`;
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

function imbalanceLine(unit) {
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
  hiaki_pot:      (a) => res(a).blade !== "niu" ? "热锅只能用丹生谷发动" : null,
  yuito_amer:     (a) => (res(a).liquid || 0) < 1 ? "没有咖啡液" : null,
  yuito_espresso: (a) => (res(a).liquid || 0) < 1 ? "没有咖啡液" : null,
  yuito_extract:  (a) => (res(a).liquid || 0) < 1 ? "没有咖啡液" : null,
  tou_taunt:      (a) => (res(a).tauntLeft || 0) <= 0 ? "本场嘲讽次数已用尽" : null,
  kolt_short:     (a) => ((findKit("kolt", state.units) || a).resources || {}).bit === "acid" ? "直流短接需要电钻模式" : null,
  torque_strip:   (a) => ((findKit("kolt", state.units) || {}).resources || {}).bit === "acid" ? "拆卸模式需要电钻模式" : null,
  edc_drain:      (a) => {
    const ras = findKit("ras", state.units);
    if (!ras) return "拉斯缪尔不在场";
    if (Number(ras.zone) !== Number(a.zone)) return "引流需要与拉斯缪尔同区";
    return null;
  },
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
  yuito_summon:   (a) => weaponSummonWhy(a, "latte"),
  tou_summon:     (a) => weaponSummonWhy(a, "mochi"),
  xia_summon:     (a) => weaponSummonWhy(a, "berniel"),
  chuan_summon:   (a) => weaponSummonWhy(a, "bili"),
  nora_summon:    (a) => weaponSummonWhy(a, "vitas"),
  nora_indwell:   (a) => piercedTarget(a) ? null : "场上没有刺入的目标",
  vitas_infuse:   () => piercedTarget(noraOf()) ? null : "场上没有刺入的目标",
  vitas_rip:      () => {
    if (noraMood(noraOf()) !== "cruel") return "只能在残忍状态下使用";
    return piercedTarget(noraOf()) ? null : "场上没有刺入的目标";
  },
  vitas_dance:    () => piercedTarget(noraOf()) ? "场上有刺入单位时无法使用" : null,
  nora_soothe:    (a) => noraMood(a) === "gentle" ? "维塔斯已处于温和" : null,
  hiaki_allin:    (a) => (Number(a.resources && a.resources.smashUsed) || 0) >= allinMaxUses(a)
    ? "本场全力以赴已用完" : null,
  role_activate:  () => {
    const any = (typeof fieldUnits === "function" ? fieldUnits() : state.units)
      .some(u => u && !u.isPlayer && !u.dead && !u.hidden && activatableStatuses(u).length > 0);
    return any ? null : "场上没有带状态效果的敌人";
  },
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

/** 武器人现在能不能唤出：ok / out（已在场）/ dead（本场已倒下，不能再唤出） */
function weaponSummonState(owner, kit) {
  const list = (state.units || []).filter(x => x.kit === kit && (!x.weaponOf || !owner || x.weaponOf === owner.kit));
  if (!list.length) {
    // 本场还没唤出过：看上一场留下的伤势
    const carried = typeof weaponCarryLayers === "function" ? weaponCarryLayers(kit) : null;
    if (carried && carried.reduce((sum, l) => sum + Math.max(0, Number(l.current) || 0), 0) <= 0) return "wounded";
    return "ok";
  }
  const alive = list.find(x => !x.dead);
  if (!alive) return "dead";
  if (!alive.hidden && !alive.fused) return "out";
  const hp = (alive.layers || []).reduce((sum, l) => sum + Math.max(0, Number(l.current) || 0), 0);
  return hp <= 0 ? "dead" : "ok";
}
function weaponSummonWhy(owner, kit) {
  if (typeof weaponBroken === "function" && weaponBroken(kit)) return `${weaponCardName(kit)} 耐久为 0，无法唤出`;
  const st = weaponSummonState(owner, kit);
  const nm = typeof weaponCardName === "function" ? weaponCardName(kit) : kit;
  if (st === "out") return `${nm} 已经在场上`;
  if (st === "dead") return `${nm} 本场已倒下，无法再唤出`;
  if (st === "wounded") return `${nm} 上一场倒下后还没长休，无法唤出`;
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
  const fn = SKILL_REQUIREMENT[id];
  if (!actor || typeof fn !== "function") return null;
  try { return fn(actor) || null; } catch (e) { return null; }
}

/** 执行技能，并把这次行动的日志整理成一块（见 withLogSink） */
function runSkill(id, optRun) {
  const a0 = unitById(state.attackerId);
  const title = a0 ? `【${a0.name}】${skillDisplayName(a0, id)}` : "";
  const prevActor = LOG_ACTOR_ID;
  LOG_ACTOR_ID = a0 ? a0.id : null;
  let lines;
  try { lines = withLogSink(() => runSkillInner(id, optRun)); } finally { LOG_ACTOR_ID = prevActor; }
  const block = tidyActionBlock(title, lines);
  if (block.length) appendLog(block.join("\n"));
}

function runSkillInner(id, optRun) {
  optRun = optRun || {};
  const a = unitById(state.attackerId);
  const token = selectedToken();
  const t = skillTargetAny();
  if (!a) { paintSkillLog("先选攻击者。"); return; }
  if (a.dead) { paintSkillLog(`${a.name} 已死亡，无法行动。`); return; }
  if (!optRun.ignorePhase && !canControlUnit(a) && id !== "assist_block") {
    paintSkillLog(!state.combatStarted
      ? "战斗尚未开始。先点「开始战斗」。"
      : (state.combatPhase === "enemy" ? "现在是敌人回合，不能操作玩家技能。" : "现在是玩家回合，不能操作敌人技能。"));
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
  if (a.dying && id !== "assist_block") { paintSkillLog(`${a.name} 濒死中。先点「起身」。`); return; }
  if (a.isPlayer && isUnarmed(a) && id !== "assist_block" && id !== "bare_aa") {
    const allowed = (skillList(a) || []).some(s => s.id === id);
    if (!allowed) {
      paintSkillLog(`${a.name} 空手中，只能空手攻击、职责技能，或卡片标明可空手使用的技能。`);
      return;
    }
  }
  const reaction = /_opp$|_block$|assist/.test(id) || id === "ufo_assist" || id === "en_ox_block" || id === "en_wolf_opp" || id === "en_thug_opp";
  if (!a.isPlayer && !reaction) {
    if ((a.ap || 0) < 1) {
      paintSkillLog(`${a.name} 行动点不足，无法使用该技能。`);
      return;
    }
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
  if (token && String(token).indexOf("gap:") === 0) {
    hitStructure(a, token, { element: hostValue("element", "physical"), dmg: effectiveAtk(a, state.units), brk: Number(hostValue("baseBreak", 1)) || 1 });
    return;
  }
  if (token && String(token).indexOf("prop:") === 0 && !isDisplaceSkill(id)) {
    hitStructure(a, token, { element: hostValue("element", "physical"), dmg: effectiveAtk(a, state.units), brk: Number(hostValue("baseBreak", 1)) || 1 });
    return;
  }
  snapshot();
  beginActionAcc(a);
  if ((a.kit === "xia" || a.kit === "berniel" || a.weaponOf === "xia") && !/engine$|prep$|summon$|return$|cover$/.test(id)) {
    markXiaAttack(a);
  }
  if (a.isPlayer && id !== "assist_block") {
    const cost = skillCost(id);
    if (cost.ap) spendAp(a, cost.ap, skillNameHint(id));
    if (cost.bonus) spendBonus(a, cost.bonus, skillNameHint(id));
  } else if (!a.isPlayer && !reaction) {
    spendAp(a, 1, skillNameHint(id));
  }
  const lines = [];
  const needT = () => {
    if (!t) { lines.push("先在「技能目标」里选对象。"); return false; }
    return true;
  };
  const atk = effectiveAtk(a, state.units);

  const overloadSeq = [];
  const hitOne = (actor, target, opt) => {
    // 命中过程中立刻写出的日志（击杀、经验、掉落……）先收起来，排在这一击的结果后面
    let out;
    const captured = withLogSink(() => { out = dealTo(actor, target, opt); });
    if (actor && actor.instant && actor.instant.overload && target && !target.kind) {
      const n = opt.hits || 1;
      if (n <= 1 && (!opt.flags || opt.flags.action !== false)) {
        overloadSeq.push({ actor, target, opt: Object.assign({}, opt, { usePrep: false, hits: 1 }) });
      }
    }
    // 攻击者不是这次行动的发起人（比如召唤物、残骸）时写明是谁打的
    if (actor && actor.id !== a.id) lines.push(`  ${actor.name} 出手：`);
    appendLog(lines.splice(0).join("\n"));
    formatHitLines(actor, target, out, captured).forEach(s => appendLog(s));
    return out;
  };

  try {
    if (id === "ruby_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "energy", mult: 0.5, hits: 1, baseBreak: 1, atk });
      hitOne(a, t, { element: "energy", mult: 0.5, hits: 1, baseBreak: 0, atk, usePrep: false });
    } else if (id === "ruby_trigger") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      t.statuses.high = true;
      popStatus(t, "high");
      tagHighFrom(t, "ruby");
      t.highApplyTurn = state.turnNo;
      t.statuses.latestElement = "energy";
      lines.push(`${t.name} 被施加高能。本回合受到的能量伤害不累积高能值，从下回合起每段能量伤害各掷一次 1d4+1。`);
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
        hitOne(a, u, { element: "energy", mult: 0.3, baseBreak: 0, atk, flags: { action: true, aoe: true }, usePrep: false });
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
          const bonded = y.resources.bondId === tgt.id;
          const r = bonded ? { total: 2 * sides, text: `最大值 2*${sides}` } : takeDice(2, sides, 0);
          healUnit(tgt, r.total);
          tgt.def = Math.min(tgt.defMax || tgt.def, (Number(tgt.def) || 0) + 1);
          lines.push(`冰美式治疗 ${tgt.name} ${r.text}${bonded ? "（牵挂取最大值）" : ""}，架势 +1。`);
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
      const err = setWeather("snow");
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
          a.resources.shield -= 1;
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
      a.zone = dest;
      applyShift(tgt);
      popStatus(tgt, "shift");
      lines.push(`移动到 ${dest} 区，对 ${tgt.name} 施加错位（次外层与最外层互换至下回合开始）。`);
      if (fl && fl.picks.carryMode === "yes" && fl.picks.carry) {
        if ((a.resources.shield || 0) < 1) lines.push("圣盾不足，未能带人。");
        else {
          a.resources.shield -= 1;
          const buddy = unitById(fl.picks.carry) || propByRef(fl.picks.carry);
          if (buddy) {
            if (typeof displaceTo === "function") displaceTo(buddy, dest, lines, "随圣战起始一起移动");
            else buddy.zone = dest;
            lines.push(`消耗 1 圣盾，${buddy.name} 从 ${from} 区带到 ${dest} 区。圣盾 → ${a.resources.shield}`);
          }
        }
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
        tgt.tauntTo = a.id;
        lines.push(`${tgt.name} 下次攻击必须打灯。剩余 ${a.resources.tauntLeft} 次。`);
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
        a.zone = dest;
        displaceTo(tgt, dest, lines, "被带走");
      } else {
        a.zone = tgt.zone;
        lines.push(`猛扑跃到 ${tgt.name} 所在的 ${tgt.zone} 区。`);
      }
      if (!tgt.kind) hitOne(a, tgt, { element: "physical", mult: 1, diceN: 1, diceS: 4, baseBreak: 1, atk });
      else if (typeof damageProp === "function") damageProp(tgt, { element: "physical", dmg: Math.floor(atk), brk: 1 }, a);
    } else if (id === "mochi_roar") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!t.kind) hitOne(a, t, { element: "harmonic", mult: 1, diceN: 1, diceS: 4, baseBreak: 1, atk, onConnect: { dest: otherZone(t.zone), reason: "被吼走" } });
      else {
        if (typeof damageProp === "function") damageProp(t, { element: "harmonic", dmg: Math.floor(atk), brk: 1 }, a);
        displaceTo(t, otherZone(t.zone), lines, "被吼走");
      }
    } else if (id === "mochi_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "xia_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const eng = !!(a.resources && a.resources.engine);
      hitOne(a, t, { element: eng ? "fire" : "physical", mult: 1, diceN: 1, diceS: 4, baseBreak: eng ? 3 : 2, atk });
    } else if (id === "xia_engine") {
      setEngine(true, "拉响引擎");
    } else if (id === "xia_prep" || id === "ruby_prep") {   // 直伤职责技能一，两个 id 指同一个技能
      a.resources.preparedPending = true;
      a.resources.preparedActive = false;
      a.resources.prepared = true;
      const n = 1 + milestone(a.level || 1, 5);
      lines.push(`准备：下个玩家回合第一次攻击裸伤害 +${n}d6（吃倍率与增伤，含协助攻击）。`);
    } else if (id === "xia_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      setEngine(true, "协助攻击");
      a.zone = t.zone;
      hitOne(a, t, { element: "fire", mult: 1, diceN: 1, diceS: 8, baseBreak: 0, atk, flags: { action: true, assist: true, pierce: true } });
    } else if (id === "xia_execute") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!(a.resources && a.resources.engine)) lines.push("处决需要引擎启动。");
      else if (!t.stunned) lines.push("处决只能对晕眩敌人使用。");
      else hitOne(a, t, { element: "fire", mult: 1.5, diceN: 1, diceS: 8, baseBreak: 0, atk, flags: { action: true, pierce: true } });
    } else if (id === "xia_ram") {
      if (!(a.resources && a.resources.engine)) lines.push("全速撞击需要引擎启动。");
      else {
        const fl = state.skillFlow;
        const dest = fl && fl.picks.dest != null ? Number(fl.picks.dest) : (t ? Number(t.zone) : null);
        const tgt = (fl && fl.picks.target) ? unitById(fl.picks.target) : t;
        if (dest == null) { lines.push("先选撞击终点区域。"); return paintSkillLog(lines.join("\n")); }
        if (!tgt) { lines.push("先选到达后攻击的敌人。"); return paintSkillLog(lines.join("\n")); }
        const dist = zoneDist(a.zone, dest, state.zoneMode);
        a.zone = dest;
        tgt.instant = tgt.instant || {};
        tgt.instant.shift = true;
        tgt.statuses.shockwave = true;
        popStatus(tgt, "shift");
        popStatus(tgt, "shockwave");
        hitOne(a, tgt, { element: "physical", mult: 1, baseBreak: 1 + dist, atk });
        lines.push(`全速撞击移动 ${dist} 区，震荡，击破 ${1 + dist}。`);
      }
    } else if (id === "xia_summon") {
      const w = spawnWeapon(a, "berniel");
      lines.push(w ? "柏妮尔已进入战场。" : "柏妮尔已在场。");
    } else if (id === "berniel_spit") {
      const foes = visibleEnemies(a.zone);
      if (!foes.length) lines.push("同区没有敌人。");
      const eng = ownerEngineOn("xia");
      foes.forEach(u => hitOne(a, u, { element: "fire", mult: 0.5, baseBreak: eng ? 1 : 0, atk, flags: { action: true, aoe: true } }));
      markAoeZone(a.zone);
    } else if (id === "berniel_ignite") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const d = zoneDist(a.zone, t.zone, state.zoneMode);
      if (d > 1) lines.push("燃点只能打距离 1 以内的敌人。");
      else {
        const n = ownerEngineOn("xia") ? 2 : 1;
        grantBurn(t, n, lines);
        lines.push(`燃点：${t.name} 灼烧 +${n}${n === 2 ? "（引擎）" : ""} → ${(t.statuses && t.statuses.burn) || 0} 层。`);
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
      hitOne(a, t, { element: "energy", mult: 0.5, hits: 1, diceN: 1, diceS: 4, baseBreak: br, atk });
      for (let i = 1; i < hits; i++) hitOne(a, t, { element: "energy", mult: 0.5, hits: 1, diceN: 1, diceS: 4, baseBreak: 0, atk, usePrep: false });
    } else if (id === "chuan_whip") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "electric", mult: 0.5, baseBreak: 1, atk });
      addCharge(1);
      lines.push("电能 +1 → " + (findKit("chuan", state.units).resources.charge));
    } else if (id === "chuan_cover") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      t.coverBy = a.id;
      lines.push(`掩护：此回合为 ${t.name} 免费自动协助格挡。`);
    } else if (id === "nora_aa") {
      const pin = piercedTarget(a);
      const tgt = pin || t;
      if (!tgt) { lines.push("先选攻击目标。"); return paintSkillLog(lines.join("\n")); }
      if (pin && t && t.id !== pin.id) lines.push(`场上有刺入目标，只能攻击 ${pin.name}。`);
      const cruel = noraMood(a) === "cruel";
      if (pin && tgt.id === pin.id) {
        if (cruel) {
          hitOne(a, tgt, { element: "ice", mult: 1, diceN: 1, diceS: 4, baseBreak: 1, atk });
          noraFrost(a, tgt, lines);
        } else {
          // 温和对刺入目标改为治疗，不造成伤害（所以刺入队友可以拿来奶）
          const r = takeDice(1, 4, a.level || 1);
          healUnit(tgt, r.total);
          lines.push(`温和：${tgt.name} 恢复 ${r.text} 点生命。`);
        }
      } else if (tgt.isPlayer) {
        lines.push("没有刺入目标时，普通攻击只能打敌人。");
        return paintSkillLog(lines.join("\n"));
      } else {
        hitOne(a, tgt, { element: "ice", mult: 1, baseBreak: 1, atk });
      }
    } else if (id === "nora_needle") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      setPierce(a, t, lines);
      if (noraMood(a) === "cruel") noraFrost(a, t, lines);
      else { a.zone = t.zone; lines.push(`温和：诺拉移动到 ${t.zone} 区。`); }
    } else if (id === "nora_summon") {
      const w = spawnWeapon(a, "vitas");
      lines.push(w ? "维塔斯 已分出。" : "维塔斯无法唤出。");
    } else if (id === "nora_soothe") {
      if (noraMood(a) === "gentle") lines.push("维塔斯已处于温和。");
      else setMood(a, "gentle", lines, "安抚");
    } else if (id === "nora_indwell") {
      const pin = piercedTarget(a);
      if (!pin) { lines.push("场上没有刺入的目标。"); return paintSkillLog(lines.join("\n")); }
      pin.instant = pin.instant || {};
      lines.push(`${pin.name} 获得刺骨。`);
      applyInstantEffect(pin, "sting", lines);
      noraFrost(a, pin, lines);
    } else if (id === "nora_pressure") {
      a.resources.forceCruelNext = true;
      a.resources.nextAtkFx = (a.resources.nextAtkFx || []).concat(["diffract"]);
      lines.push("压力升高：下回合开始必定转为残忍，下一击带衍射。");
    } else if (id === "nora_sonic") {
      const list = visibleEnemies(a.zone);
      if (!list.length) { lines.push("同区没有敌人。"); return paintSkillLog(lines.join("\n")); }
      list.forEach(u => hitOne(a, u, { element: "harmonic", mult: 0.5, baseBreak: 1, atk, flags: { action: true, aoe: true } }));
      const pin = piercedTarget(a);
      if (pin) {
        hitOne(a, pin, { element: "harmonic", mult: 0.5, baseBreak: 1, atk, flags: { action: true, aoe: true }, usePrep: false });
        lines.push(`刺入目标 ${pin.name} 额外再吃一次。`);
      }
    } else if (id === "nora_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (Number(a.zone) === Number(t.zone)) {
        const zn = Number(state.zoneMode);
        const dest = [Number(a.zone) - 1, Number(a.zone) + 1].find(z => z >= 1 && z <= zn);
        if (dest) { a.zone = dest; lines.push(`协助攻击：先退到 ${dest} 区再发射针尖。`); }
      }
      hitOne(a, t, { element: "ice", mult: 1, baseBreak: 0, atk, flags: { action: true, assist: true } });
      noraFrost(a, t, lines);
      setPierce(a, t, lines);
    } else if (id === "vitas_infuse") {
      const n = noraOf();
      const pin = piercedTarget(n);
      if (!pin) { lines.push("场上没有刺入的目标。"); return paintSkillLog(lines.join("\n")); }
      if (noraMood(n) === "cruel") {
        hitOne(a, pin, { element: "ice", mult: 1, baseBreak: 1, atk });
        noraFrost(a, pin, lines);
        noraFrost(a, pin, lines);
      } else {
        // 每五级多一个 d4
        const nd = 2 + dieStep(a.level || 1, 5);
        const r = takeDice(nd, 4, 0);
        healUnit(pin, r.total);
        pin.def = Math.min(pin.defMax, (pin.def || 0) + 1);
        lines.push(`温和：加压灌输 ${r.text}，${pin.name} 恢复生命并 +1 架势。`);
      }
    } else if (id === "vitas_rip") {
      const n = noraOf();
      if (noraMood(n) !== "cruel") { lines.push("扯下只能在残忍状态下使用。"); return paintSkillLog(lines.join("\n")); }
      const pin = piercedTarget(n);
      if (!pin) { lines.push("场上没有刺入的目标。"); return paintSkillLog(lines.join("\n")); }
      hitOne(a, pin, { element: "harmonic", mult: 1.5, baseBreak: 2, atk });
      clearPierce(n, lines, "被扯下");
    } else if (id === "vitas_slash") {
      const n = noraOf();
      const pin = piercedTarget(n);
      const tgt = pin || t;
      if (!tgt) { lines.push("先选攻击目标。"); return paintSkillLog(lines.join("\n")); }
      if (pin) {
        if (t && t.id !== pin.id) lines.push(`场上有刺入目标，只能攻击 ${pin.name}。`);
        if (Number(a.zone) !== Number(tgt.zone)) { a.zone = Number(tgt.zone); lines.push(`先移动到 ${tgt.zone} 区。`); }
      }
      hitOne(a, tgt, { element: "harmonic", mult: 1, baseBreak: 1, atk });
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
      lines.push(`${a.name} 进入自焚。`);
      const fl0 = state.skillFlow;
      const dest = fl0 && fl0.picks ? Number(fl0.picks.dest) : null;
      if (dest && dest !== Number(a.zone)) {
        a.zone = dest;
        lines.push(`顺势移动到 ${dest} 区。`);
      }
    } else if (id === "xia_crush") {
      if (!a.resources.engine) { lines.push("狂怒碾压需要引擎启动。"); return paintSkillLog(lines.join("\n")); }
      if (!needT()) return paintSkillLog(lines.join("\n"));
      lines.push(...crushOnce(a, t));
    } else if (id === "chuan_pulse") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      addHighEnergy(t, "高能脉冲");
      lines.push(`${t.name} 被施加高能。`);
    } else if (id === "chuan_blade") {
      if ((a.resources.charge || 0) < 3) { lines.push("巨刃划空需要 3 电能。"); return paintSkillLog(lines.join("\n")); }
      const fl2 = state.skillFlow;
      const ref = fl2 && fl2.picks && fl2.picks.target;
      const prop = ref ? propByRef(ref) : null;
      const tgt = prop || (ref ? unitById(ref) : null) || t;
      if (!tgt) { lines.push("先选目标。"); return paintSkillLog(lines.join("\n")); }
      a.resources.charge -= 3;
      if (prop) {
        // 对配置物伤害翻倍
        const dmg = Math.floor((Number(atk) || 0) * 2 * 2);
        const before = Number(prop.hp) || 0;
        prop.hp = Math.max(0, before - dmg);
        lines.push(`巨刃划空：${prop.name} 耐久 ${before} → ${prop.hp}（对配置物伤害翻倍 ${dmg}）。`);
        if (before > 0 && prop.hp <= 0) {
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
      hitOne(a, t, { element: "electric", mult: 0.5, diceN: 1, diceS: 4, baseBreak: 0, atk, flags: { action: true, assist: true } });
      hitOne(a, t, { element: "electric", mult: 0.5, diceN: 1, diceS: 4, baseBreak: 0, atk, flags: { action: true, assist: true }, usePrep: false });
      addCharge(2);
      lines.push("电能 +2。");
    } else if (id === "chuan_wall") {
      if ((a.resources.charge || 0) < 1) lines.push("没有电能。");
      else {
        a.resources.charge -= 1;
        const r = takeDice(1, 6, 0);
        const hp = Math.floor(atk + r.total);
        state.props = (state.props || []).filter(p => !(p.kind === "ironwall" && Number(p.zone) === Number(a.zone)));
        state.units = state.units.filter(u => !(u.kit === "ironwall" && Number(u.zone) === Number(a.zone)));
        const wall = makeProp("ironwall", a.zone, a.level);
        wall.hp = wall.maxHp = hp;
        wall.name = "铁壁";
        wall.movable = false;
        wall.faction = "player";
        state.props.push(wall);
        lines.push(`铁壁展开：配置物装甲 ${hp}（${r.text}），不可移动。同区敌方攻击行动只打铁壁一次。`);
      }
    } else if (id === "chuan_over") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      applyInstantEffect(t, "overload", lines);
      if ((a.resources.charge || 0) >= 3) {
        const sh = Math.floor(atk / 2);
        addShieldLayer(t, sh);
        lines.push(`电站超频：${t.name} 过载，并获得 ${sh} 护盾（电能≥3不增加电能）。`);
      } else {
        addCharge(1);
        lines.push(`电站超频：${t.name} 过载，电能 +1。`);
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
        c.resources.charge -= 1;
        const sh = effectiveAtk(a, state.units);
        fieldUnits().filter(u => u.isPlayer && Number(u.zone) === Number(a.zone)).forEach(u => addShieldLayer(u, sh));
        lines.push(`磁场盾：同区友方各获得 ${sh} 护盾，电能 −1。`);
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
        lines.push(`雷电风暴：消耗 ${charge} 电能，打 ${hits} 次 0.5atk 电击，击破 ${br}。电能 → ${c.resources.charge}`);
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
      if (!t.kind) hitOne(a, t, { element: "electric", mult: 0.5, hits: 2, baseBreak: 1, breakOnce: true, atk, onConnect: { dest: otherZone(t.zone), reason: "被驱逐" } });
      else displaceTo(t, otherZone(t.zone), lines, "被驱逐");
    } else if (id === "yuito_espresso") {
      const fl = state.skillFlow;
      const mode = fl && fl.picks.mode;
      const tgt = (fl && fl.picks.target) ? unitById(fl.picks.target) : t;
      if (!mode || !tgt) { lines.push("先完成意式浓缩的分步选择。"); return paintSkillLog(lines.join("\n")); }
      if ((a.resources.liquid || 0) < 1) { lines.push("没有咖啡液。"); }
      else {
        a.resources.liquid -= 1;
        if (mode === "ap") {
          tgt.ap = (tgt.ap || 0) + 1;
          tgt.apMax = Math.max(tgt.apMax || 0, tgt.ap);
          lines.push(`${tgt.name} 行动点 +1。`);
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
        const ferr = setZoneField(z, "acid");
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
          if (u.isPlayer && !isWeaponUnit(u)) { healUnit(u, heal); lines.push(`${u.name} 恢复 ${heal}`); }
          else if (!u.isPlayer) hitOne(a, u, { atk: 0, mult: 0, flat: dmg, element: "acid", baseBreak: 0 });
        });
      }
    } else if (id === "latte_love") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      a.zone = t.zone;
      const n = extraDiceByLevel(a.level);
      const healR = takeDice(n * 2, 4, 0);
      const heal = healR.total;
      lines.push(`爱意掷骰 ${healR.text}`);
      healUnit(t, heal);
      t.def = Math.min(t.defMax, (t.def || 0) + 1);
      const y = findKit("yuito", state.units);
      if (y) setBond(y, t);
      lines.push(`爱意：${t.name} 恢复生命并 +1 架势，施加牵挂。`);
      if (y && y.resources && y.resources.bondId === t.id && t.id !== a.id) {
        healUnit(a, heal);
        a.def = Math.min(a.defMax, (a.def || 0) + 1);
        lines.push("目标已有牵挂，拿铁自己也恢复同样数值。");
      }
    } else if (id === "hiaki_flash") {
      if ((a.resources.stance || "draw") !== "iai") { lines.push("只能在居合下使用一闪。"); }
      else {
        visibleEnemies(a.zone).forEach(u => {
          const el = a.resources.blade === "naruto" ? "ice" : "fire";
          hitOne(a, u, { element: el, mult: 1, baseBreak: 1, atk: effectiveAtk(a, state.units), flags: { action: true, aoe: true } });
        });
        markAoeZone(a.zone);
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
      const owner = ownerOfWeapon(a, state.units);
      lines.push(...returnWeapon(a));
      if (owner) {
        owner.resources.blade = "niu";
        refreshHiakiAtk(owner);
        const w = spawnWeapon(owner, "naruto");
        lines.push(w ? "持刀改为丹生谷，鳴門出场。" : "鳴門已在场。");
      }
    } else if (id === "naruto_fly") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "ice", mult: 0.5, baseBreak: 1, atk });
      lines.push("燕飞后请用移动按钮走 1 格。");
    } else if (id === "tou_sonic") {
      const fl = state.skillFlow;
      // 分步里选的两个目标；没走分步（计算器直接选目标）时按距离归类
      let t1 = fl && fl.picks.target1 ? unitById(fl.picks.target1) : null;
      let t2 = fl && fl.picks.target2 ? unitById(fl.picks.target2) : null;
      if (!fl && t) {
        if (zoneDist(a.zone, t.zone, state.zoneMode) === 0) t1 = t; else t2 = t;
      }
      if (!t1 && !t2) { lines.push("声波切割至少要选一个目标（同区或距离 1）。"); return paintSkillLog(lines.join("\n")); }
      if ((a.resources.shield || 0) < 1) { lines.push("没有圣盾。"); }
      else {
        a.resources.shield -= 1;
        if (t1) hitOne(a, t1, { element: "harmonic", mult: 1, baseBreak: 1, atk, atkRange: "any" });
        if (t2) hitOne(a, t2, { element: "harmonic", mult: 0.5, baseBreak: 1, atk, atkRange: "any", usePrep: !t1 });
        lines.push("圣盾 −1。");
      }
    } else if (id === "tou_ultra") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      t.instant.refract = true;
      popStatus(t, "reflect");
      lines.push(`${t.name} 陷入折射。`);
    } else if (id === "mochi_boom") {
      const boom = () => {
        visibleEnemies(a.zone).forEach(u => hitOne(a, u, { element: "harmonic", mult: 0.5, baseBreak: 1, atk, flags: { action: true, aoe: true } }));
        markAoeZone(a.zone);
      };
      boom();
      lines.push("音爆：同区每个敌人 0.5atk 谐波 +1 击破。");
      const fl = state.skillFlow;
      const again = fl && fl.picks.again === "twice";
      const tou = findKit("tou", state.units);
      if (again) {
        if (!tou || (tou.resources.shield || 0) < 1) lines.push("圣盾不足，未能第二次音爆。");
        else {
          tou.resources.shield -= 1;
          boom();
          lines.push(`消耗 1 圣盾再触发一次音爆。灯圣盾 → ${tou.resources.shield}`);
        }
      }
    } else if (id.indexOf("fx_") === 0) {
      const fx = id.slice(3);
      if (!ATKFX[fx]) lines.push("未知的属性攻击效果。");
      else {
        hangAtkFx(a, fx);
        lines.push(`${a.name} 将【${ATKFX[fx].name}】挂在下一次攻击上。晕眩不会清掉。`);
      }
    } else if (id === "role_refine") {
      if (!roleOnce(a, "refine", (a.level || 1) >= 15 ? 2 : 1)) lines.push("精益求精本场次数已用完。");
      else {
        a.resources.weakNext = true;
        lines.push("精益求精：下一击带弱点特效。");
      }
    } else if (id === "role_pierce") {
      if (!roleOnce(a, "pierce", 1)) lines.push("一击制敌本场已用完。");
      else {
        a.resources.pierceNext = true;
        lines.push("一击制敌：下一击带穿刺。");
      }
    } else if (id === "role_gambit") {
      if (!roleOnce(a, "gambit", 1)) lines.push("破釜沉舟本场已用完。");
      else {
        a.resources.gambitArmed = true;
        lines.push("破釜沉舟：下个自己的回合攻击双倍，直到自己下次行动前受伤也双倍。");
      }
    } else if (id === "role_activate") {
      const fl = state.skillFlow;
      const tgt = (fl && fl.picks && fl.picks.target) ? unitById(fl.picks.target) : t;
      if (!tgt) { lines.push("先选激活目标。"); return paintSkillLog(lines.join("\n")); }
      const key = fl && fl.picks ? fl.picks.status : null;
      lines.push(...triggerOneStatus(tgt, a, key));
    } else if (id === "role_spread") {
      const src = t;
      const destId = state.targetId;
      const dest = unitById(destId);
      if (!src) { lines.push("先选被复制状态的目标。"); return paintSkillLog(lines.join("\n")); }
      const other = fieldUnits().find(u => u.id !== src.id && u.id === state.targetId) || fieldUnits().filter(u => u.id !== src.id && Number(u.zone) === Number(src.zone))[0];
      if (!other) { lines.push("需要另一个同区或当前选中的承受者。请先点源，再点目标后重放。"); }
      else {
        copyStatuses(src, other);
        lines.push(`传播：${src.name} 的状态复制到 ${other.name}。`);
      }
    } else if (id === "role_double_dot") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!roleOnce(a, "doubleDot", 1)) lines.push("加倍计量本局限已用完。");
      else {
        t.instant = t.instant || {};
        t.instant.doubleStatus = true;
        lines.push(`${t.name} 本回合状态效果翻倍。`);
      }
    } else if (id === "role_self_doom") {
      a.resources.selfDoom = !a.resources.selfDoom;
      lines.push(a.resources.selfDoom ? "自我毁灭开启：施加状态翻倍，自己也承受一层。" : "自我毁灭关闭。");
    } else if (id === "role_breakwave") {
      const cap = (a.level || 1) >= 15 ? 2 : 1;
      visibleEnemies(a.zone).filter(u => (u.def || 0) > 0 && (u.def || 0) <= cap).forEach(u => {
        dealBreak(u, 1, "none", lines, "破势");
      });
      lines.push(`破势：同区架势 ≤ ${cap} 的敌人各受 1 无属性击破。`);
    } else if (id === "role_halve") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!roleOnce(a, "halve", 1)) lines.push("折戟本场已用完。");
      else {
        const amt = Math.floor((Number(t.def) || 0) / 2);
        dealBreak(t, amt, "none", lines, "折戟");
        lines.push(`折戟：击破 ${amt}。`);
      }
    } else if (id === "role_omen") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!roleOnce(a, "omen", 1)) lines.push("击破预告本场已用完。");
      else {
        t.instant = t.instant || {};
        t.instant.doubleBreak = true;
        t.instant.omenFrom = a.id;
        t.instant.omenArmed = true;
        lines.push(`${t.name} 下回合受到双倍击破。若该回合未能击破其架势，你将失衡。`);
      }
    } else if (id === "role_lockdown") {
      visibleEnemies(a.zone).forEach(u => {
        u.noMove = true;
        u.tauntTo = a.id;
      });
      lines.push("禁足怒吼：同区敌人本回合无法移动，且必须打你。");
    } else if (id === "role_grit") {
      if (!roleOnce(a, "grit", 2)) lines.push("咬牙坚持本场次数用尽。");
      else {
        a.resources.gritTurn = true;
        lines.push("咬牙坚持：本回合受伤减半。");
      }
    } else if (id === "role_stand") {
      if (!roleOnce(a, "stand", 1)) lines.push("屹立不倒本场已用完。");
      else {
        a.resources.standTurn = true;
        lines.push("屹立不倒：本回合免疫伤害和击破。");
      }
    } else if (id === "role_fear") {
      if (!roleOnce(a, "fear", (a.level || 1) >= 15 ? 3 : 2)) lines.push("恐惧怒吼次数用尽。");
      else {
        fieldUnits().filter(u => !u.isPlayer && zoneDist(a.zone, u.zone, state.zoneMode) <= 1).forEach(u => {
          u.statuses = u.statuses || {};
          u.statuses.weak = true;
        });
        lines.push("恐惧怒吼：距离 1 内敌人本回合虚弱。");
      }
    } else if (id === "role_guard_strike") {
      a.resources.guardStrike = true;
      lines.push("防守反击：本回合第一次成功协助格挡会追加一次协助攻击。");
    } else if (id === "role_all_reflect") {
      if (!roleOnce(a, "allReflect", 1)) lines.push("全反击本场已用完。");
      else {
        a.resources.allReflect = true;
        lines.push("全反击：本回合全队成功格挡将反伤伤害与击破。");
      }
    } else if (id === "role_buffer") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!roleOnce(a, "buffer", (a.level || 1) >= 15 ? 2 : 1)) lines.push("缓冲次数用尽。");
      else {
        const r = takeDice(2, 4, 4);
        addShieldLayer(t, r.total);
        lines.push(`缓冲：${t.name} 获得 ${r.total} 护盾（${r.text}）。`);
      }
    } else if (id === "role_dome") {
      if (!roleOnce(a, "dome", 1)) lines.push("防护罩本场已用完。");
      else {
        const hp = Math.floor(atk + 10);
        const wall = unitOf("防护罩", a.level, [{ type: "shield", hp }], 0, 0, { kit: "ironwall", isPlayer: true, range: "melee" });
        wall.zone = a.zone;
        wall.note = "生存职责防护罩";
        state.units.push(wall);
        lines.push(`防护罩展开：护盾 ${hp}。同区友方受击先打罩。`);
      }
    } else if (id === "role_renew") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!roleOnce(a, "renew", 1)) lines.push("续命本场已用完。");
      else if (t.dying || totalHp(t) <= 0) {
        standUp(t);
        const heal = Math.floor(totalMaxHp(t) * 0.25);
        healUnit(t, heal);
        lines.push(`续命：${t.name} 起身并恢复 ${heal}。`);
      } else {
        const heal = Math.floor(totalMaxHp(t) * 0.5);
        healUnit(t, heal);
        lines.push(`续命：${t.name} 恢复 ${heal}（最大生命 50%）。`);
      }
    } else if (id === "role_lock") {
      if (state.weather && state.weather !== "none") {
        state.weatherLock = a.name + "锁定";
        lines.push(`锁定天气：${state.weather} 本回合不会被修改。`);
      } else {
        const f = state.fields[a.zone];
        if (f) f.fieldLock = a.name + "锁定";
        lines.push(`锁定 ${a.zone} 区场地本回合不会被修改。`);
      }
    } else if (id === "role_shelter") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      t.isolate = true;
      t.shelterTurn = true;
      lines.push(`${t.name} 本回合豁免天气与场地。`);
    } else if (id === "role_harsh") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!roleOnce(a, "harsh", 1)) lines.push("恶劣环境本场已用完。");
      else {
        t.harshEnv = true;
        lines.push(`${t.name} 本回合场地与天气效果翻倍。`);
      }
    } else if (id === "role_apocalypse") {
      if (!roleOnce(a, "apocalypse", 1)) lines.push("末日本场已用完。");
      else {
        state.apocalypse = true;
        lines.push("末日：整场战斗天气与场地效果翻倍，无法停止。");
      }
    } else if (id === "role_boost") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const dest = Number(hostValue("destZone", "")) || otherZone(t.zone);
      displaceTo(t, dest, lines, "被借力移动");
    } else if (id === "role_shake") {
      if (!roleOnce(a, "shake", 1)) lines.push("撼动本场已用完。");
      else {
        visibleEnemies(a.zone).forEach(u => {
          u.noMove = true;
          u.statuses = u.statuses || {};
          u.statuses.unstable = true;
          convertUnstableInHv(u, lines);
          maybeUnstableTrip(u, lines);
        });
        lines.push("撼动：同区敌人陷入不稳（本回合无法移动）。高压场上的不稳会立刻晕眩。");
      }
    } else if (id === "role_rearrange") {
      if (!roleOnce(a, "rearrange", 1)) lines.push("重整本场已用完。");
      else {
        fieldUnits().filter(u => zoneDist(a.zone, u.zone, state.zoneMode) <= 1 && u.id !== a.id).forEach(u => {
          const dest = otherZone(u.zone);
          if (Math.abs(Number(dest) - Number(u.zone)) === 1) displaceTo(u, dest, lines, "被重整");
        });
        lines.push("重整：距离 1 内其他单位各移动 1 区。飞行切换请在单位面板手动改。");
      }
    } else if (id === "role_sturdy") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      t.statuses = t.statuses || {};
      t.statuses.sturdy = true;
      lines.push(`${t.name} 本回合获得坚挺。`);
    } else if (id === "role_gold") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      if (!roleOnce(a, "gold", 2)) lines.push("黄金时间次数用尽。");
      else {
        t.instant = t.instant || {};
        t.instant.goldHold = true;
        lines.push(`${t.name} 的即时效果将延长一回合。`);
      }
    } else if (id === "role_rally") {
      if (!roleOnce(a, "rally", 1)) lines.push("全队集结本次长休已用过。");
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
      else hitOne(a, t, { element: "electric", mult: 0.4, hits: 3, baseBreak: 2, breakOnce: true, atk, atkRange: "melee" });
    } else if (id === "kolt_swap" || id === "torque_swap") {
      const next = swapKoltBit(a, lines);
      const tgt = (state.skillFlow && state.skillFlow.picks.target) ? unitById(state.skillFlow.picks.target) : t;
      if (tgt) {
        // 「攻击范围内」按换上去的新刀头算：电钻近距离，酸液炮远距离
        const ele = next === "acid" ? "acid" : "electric";
        const rng = next === "acid" ? "ranged" : "melee";
        hitOne(a, tgt, { element: ele, mult: 0.5, baseBreak: 0, atk, atkRange: rng });
      }
      if (id === "torque_swap") lines.push(...returnWeapon(a));
    } else if (id === "kolt_short") {
      const fl = state.skillFlow;
      const dest = fl && fl.picks.dest != null ? Number(fl.picks.dest) : a.zone;
      if (dest !== Number(a.zone)) a.zone = dest;
      const ferr = setZoneField(a.zone, "electric");
      if (ferr) lines.push(ferr);
      else lines.push(`${a.zone} 区变为高压场地。`);
    } else if (id === "kolt_chase") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      t.statuses = t.statuses || {};
      t.statuses.chase = true;
      popStatus(t, "chase");
      lines.push(`${t.name} 被紧追。`);
    } else if (id === "kolt_scrap") {
      const rec = state.lastBrokenLayer;
      if (!rec) lines.push("本场还没有被摧毁的血量层。");
      else {
        const amt = Math.floor((rec.dmg || rec.lost || 0) * 2);
        if (rec.type === "flesh" || rec.type === "spirit") {
          healUnit(a, amt);
          lines.push(`废物利用：恢复 ${amt} 生命（来自${LAYER[rec.type] || rec.type}）。`);
        } else {
          addTempLayer(a, rec.type, amt);
          lines.push(`废物利用：获得 ${amt} 点${LAYER[rec.type] || rec.type}（战斗结束消失）。`);
        }
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
        lines.push(`酸液炮蓄力：下个敌人回合开始时对 ${dest} 区爆发。`);
      } else {
        const dest = fl && fl.picks.dest != null ? Number(fl.picks.dest) : null;
        if (dest == null) { lines.push("先选突进终点。"); return paintSkillLog(lines.join("\n")); }
        a.zone = dest;
        const foes = visibleEnemies(dest);
        const tgt = t && Number(t.zone) === dest ? t : foes[0];
        if (!tgt) lines.push("终点没有敌人。");
        else hitOne(a, tgt, { element: "electric", mult: 0.5, hits: 3, baseBreak: 2, breakOnce: true, atk });
      }
    } else if (id === "torque_strip") {
      const fl = state.skillFlow;
      const tgt = (fl && fl.picks.target) ? unitById(fl.picks.target) : t;
      const ally = (fl && fl.picks.ally) ? unitById(fl.picks.ally) : null;
      if (!tgt || !ally) { lines.push("先选拆卸目标和接收友方。"); return paintSkillLog(lines.join("\n")); }
      const stunnedBefore = !!tgt.stunned;
      dealBreak(tgt, 2, "electric", lines, "拆卸");
      // 卡面：这次攻击行动造成失衡才提升到 1.5×；本来就失衡的不算
      const brokeNow = !stunnedBefore && !!tgt.stunned;
      const amount = Math.floor(atk * (brokeNow ? 1.5 : 1));
      const outer = (tgt.layers || []).find(l => (l.current || 0) > 0);
      if (outer) {
        const take = Math.min(amount, outer.current);
        outer.current -= take;
        addTempLayer(ally, outer.type, take);
        lines.push(`拆卸转移 ${take} 点${LAYER[outer.type] || outer.type}给 ${ally.name}。`);
      }
    } else if (id === "torque_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "helu_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "harmonic", mult: 1, baseBreak: 1, atk, atkRange: "ranged" });
    } else if (id === "helu_wave") {
      if (state.weather !== "phase") {
        const err = setWeather("phase");
        if (err) lines.push(err);
        else {
          state.phaseStep = 0;
          lines.push("驻波：战场进入相位天气。");
        }
      } else if (a.resources && a.resources.scanned) {
        lines.push(...advancePhaseWeather());
      } else lines.push("尚未完成回波探测，无法推进相位。");
    } else if (id === "helu_scan") {
      const fl = state.skillFlow;
      const z = fl && fl.picks.dest != null ? Number(fl.picks.dest) : a.zone;
      a.resources.scanned = true;
      const pid = fl && fl.picks.prop;
      if (pid) {
        const p = (state.props || []).find(x => x.id === pid);
        if (p) {
          if (typeof useDevice === "function" && (p.kind === "button" || p.kind === "lever")) useDevice(p);
          else if (p.kind === "boom" && typeof explodeProp === "function") explodeProp(p);
          else if (typeof useDevice === "function") useDevice(p);
          lines.push(`远程操作了 ${p.name}。`);
        }
      } else {
        const exist = (state.props || []).filter(p => Number(p.zone) === z);
        if (!exist.length && Math.random() < 0.5) {
          const kind = Math.random() < 0.5 ? "boom" : "button";
          const p = makeProp(kind, z, a.level || 1);
          state.props = state.props || [];
          state.props.push(p);
          lines.push(`${z} 区扫描出 ${p.name}。`);
        } else lines.push(`${z} 区环境扫描完成。`);
      }
    } else if (id === "helu_summon") {
      const w = spawnWeapon(a, "ecmo");
      lines.push(w ? "Ecmo/7418 已进入战场。" : "Ecmo 已在场。");
    } else if (id === "helu_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "harmonic", mult: 1, baseBreak: 0, atk, flags: { action: true, assist: true }, atkRange: "any" });
      const layer = ((t.layers || []).find(l => (l.current || 0) > 0) || {}).type;
      applyFocus(t, layer, lines);
    } else if (id === "ecmo_bite") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const beforeStun = !!t.stunned;
      hitOne(a, t, { element: "physical", mult: 1, baseBreak: 1, atk });
      if (!beforeStun && t.stunned) {
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
      (state.props || []).filter(p => Number(p.zone) === Number(a.zone)).forEach(p => {
        if (typeof useDevice === "function" && (p.kind === "button" || p.kind === "lever")) useDevice(p);
        lines.push(`音爆触发 ${p.name}。`);
      });
    } else if (id === "ecmo_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "ras_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const times = (a.resources && a.resources.unstable) ? 4 : 2;
      hitOne(a, t, { element: "energy", mult: 0.5, hits: times, baseBreak: 1, atk, atkRange: "ranged" });
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
      a.zone = dest;
      addRasEnergy(20, "逃离");
      if (tgt) hitOne(a, tgt, { element: "electric", mult: 1, baseBreak: 0, atk });
      lines.push(`逃离：从 ${from} 区到 ${dest} 区。`);
    } else if (id === "ras_summon") {
      const w = spawnWeapon(a, "edc");
      lines.push(w ? "EDC30k 已进入战场。" : "EDC30k 已在场。");
    } else if (id === "ras_assist") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const light = (a.resources && a.resources.light) || 0;
      const hits = (a.resources && a.resources.unstable) ? 4 : 2;
      hitOne(a, t, { element: "energy", mult: 0.5, hits, baseBreak: 0, atk, flags: { action: true, assist: true }, atkRange: "any" });
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
      hitOne(a, t, { element: "electric", mult: 1, baseBreak: 1, atk });
      const ras = findKit("ras", state.units);
      const light = ras && ras.resources ? (ras.resources.light || 0) : 0;
      if (light > 0) {
        hitOne(a, t, { element: "electric", mult: 0, flat: light, baseBreak: 1, atk: 0 });
        ras.resources.light = 0;
        lines.push(`追加光能电击 ${light}。`);
      }
    } else if (id === "edc_flash") {
      const ras = findKit("ras", state.units);
      const light = ras && ras.resources ? (ras.resources.light || 0) : 0;
      if (light <= 0) lines.push("没有光能。");
      else {
        visibleEnemies(a.zone).forEach(u => hitOne(a, u, { element: "energy", mult: 0, flat: Math.floor(light / 2), baseBreak: 1, atk: 0, flags: { action: true, aoe: true } }));
        ras.resources.light = 0;
        lines.push(`爆闪释放光能 ${light}。`);
      }
    } else if (id === "edc_return") {
      lines.push(...returnWeapon(a));
    } else if (id === "bare_aa") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      hitOne(a, t, { element: "physical", mult: 1, baseBreak: 0, atk });
      lines.push("空手攻击：1×atk 物理。");
    } else if (id === "assist_block") {
      if (!needT()) return paintSkillLog(lines.join("\n"));
      const chance = blockChance(a) || 0;
      const roll = 1 + Math.floor(Math.random() * 100);
      let ok = roll <= chance;
      if (!ok && a.kit === "tou" && (a.resources.shield || 0) > 0) {
        a.resources.shield -= 1;
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
          if (enemy && !enemy.isPlayer) {
            enemy.def = Math.max(0, enemy.def - 1);
            lines.push(`胁构反伤 1 击破 → ${enemy.name} 架势 ${enemy.def}`);
          }
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
  }
  if (a && a.instant && a.instant.overload && overloadSeq.length >= 2) {
    const last = overloadSeq[overloadSeq.length - 1];
    const same = overloadSeq.filter(x => x.target && last.target && x.target.id === last.target.id);
    if (same.length >= 2 && last.target && totalHp(last.target) > 0) {
      lines.push(`${a.name} 过载：复数次攻击额外再打一次，沿用最后一段倍率。`);
      hitOne(last.actor, last.target, last.opt);
    }
  }
  flushAoePulse();
  paintSkillLog(lines.join("\n"));
  renderAll();
}

function init() {
  const presets = enemyPresets();
  const sel = uiEl("presetSelect");
  sel.innerHTML = presets.map(p => `<option value="${p.id}">${p.name}</option>`).join("");

  uiEl("zoneMode").onchange = e => {
    state.zoneMode = Number(e.target.value);
    renderAll();
  };
  uiEl("partySize").onchange = e => { state.partySize = Number(e.target.value); };
  uiEl("weather").onchange = e => {
    const err = setWeather(e.target.value);
    if (err) {
      appendLog(err);
      e.target.value = state.weather;
      return;
    }
    renderAll();
  };
  const wl = uiEl("weatherLock");
  if (wl) {
    wl.checked = !!state.weatherLock;
    wl.onchange = () => {
      state.weatherLock = wl.checked ? (state.weatherLock || "手动锁定") : null;
      renderAll();
    };
  }
  uiEl("phaseStep").onchange = e => { state.phaseStep = Number(e.target.value); };
  uiEl("sandDir").onchange = e => { state.sandDir = e.target.value; renderAll(); };
  uiEl("btnAdvancePhase").onclick = () => {
    state.phaseStep = (Number(state.phaseStep) + 1) % 4;
    uiEl("phaseStep").value = String(state.phaseStep);
  };
  uiEl("btnUndo").onclick = undo;
  uiEl("btnClearField").onclick = clearBattlefield;

function clearBattlefield() {
  snapshot();
  state.units = [];
  state.props = [];
  state.gaps = { "1-2": emptyGap(), "2-3": emptyGap() };
  state.fields = { 1: emptyField(), 2: emptyField(), 3: emptyField() };
  state.forceVoid = {};
  state.combatStarted = false;
  state.combatPhase = "player";
  state.selectedId = null;
  state.attackerId = null;
  state.targetId = null;
  state.lastResult = null;
  state.blockQueue = [];
  state.assistQueue = [];
  const st = uiEl("skillTargetSel");
  if (st) st.value = "";
  appendLog("已清空战场（单位、配置物、间隔、场地）。天气和区制保留。可点撤销恢复。");
  renderAll();
}
  const skip = uiEl("btnBlockSkip");
  if (skip) skip.onclick = () => finishBlock(null);
  const askip = uiEl("btnAssistSkip");
  if (askip) askip.onclick = () => finishAssist(null);
  uiEl("skillTargetSel").onchange = e => {
    state.targetId = e.target.value || null;
    renderAll();
  };
  const bs = uiEl("btnBackstage");
  const bsm = uiEl("backstageModal");
  if (bs && bsm) {
    bs.onclick = () => { renderBackstage(); bsm.classList.remove("hidden"); };
    uiEl("btnCloseBackstage").onclick = () => bsm.classList.add("hidden");
    bsm.addEventListener("click", e => { if (e.target === bsm) bsm.classList.add("hidden"); });
  }

  uiEl("btnLogPrev").onclick = () => {
    if (state.logIndex > 0) { state.logIndex -= 1; renderLog(); }
  };
  uiEl("btnLogNext").onclick = () => {
    if (state.logIndex < state.logPages.length - 1) { state.logIndex += 1; renderLog(); }
  };
  uiEl("btnLogClear").onclick = clearLogs;
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
  if (btnStart) btnStart.onclick = () => startCombat();
  const btnTurn = uiEl("btnTurnEnd");
  if (btnTurn) btnTurn.onclick = () => {
    if (!state.combatStarted) { startCombat(); return; }
    if (state.combatPhase === "enemy") endEnemyTurn();
    else endPlayerTurn();
  };
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
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  uiEl("btnLoadLive").onclick = loadLiveParty;
  uiEl("attackerSel").addEventListener("change", () => renderSkills());
  uiEl("bladeSel").onchange = () => {
    const h = findKit("hiaki", state.units);
    const want = uiEl("bladeSel").value;
    if (h && h.resources) {
      if ((want === "niu" && h.resources.niuOut) || (want === "naruto" && h.resources.narutoOut)) {
        appendLog(`${want === "niu" ? "丹生谷" : "鳴門"} 已分出，收回前不能切换到这把刀。`);
        syncBladeSel();
        return;
      }
      h.resources.blade = want;
      refreshHiakiAtk(h);
      renderAll();
    }
  };
  uiEl("btnAddProp").onclick = () => {
    snapshot();
    const kind = uiEl("propKind").value;
    const zone = Number(uiEl("propZone").value) || 1;
    const lv = Number(uiEl("propLevel").value) || 1;
    const p = makeProp(kind, zone, lv);
    const fac = uiEl("propFaction");
    if (fac) p.faction = fac.value || "player";
    state.props.push(p);
    appendLog(`在 ${zone} 区放置 ${p.name}（${p.faction === "enemy" ? "敌方" : "我方"}）。`);
    if (kind === "battery") {
      const extra = syncBatteryShields();
      extra.forEach(s => appendLog(s));
    }
    renderAll();
  };
  uiEl("btnAddPreset").onclick = () => {
    snapshot();
    const id = uiEl("presetSelect").value;
    const lv = Number(uiEl("presetLevel").value) || 1;
    if (id === "ufo_boss") {
      if (typeof syncPartySizeFromField === "function") syncPartySizeFromField();
      const pack = spawnUfoBoss(lv);
      pack.forEach(u => state.units.push(u));
      const body = pack[0];
      state.selectedId = body.id;
      state.attackerId = body.id;
      appendLog(`飞碟触灵登场（Lv${lv}）：本体在 2 区，机械足甲乙丙在 2 区，丁戊在 1 区。本体不能被通常攻击。`);
      renderAll();
      return;
    }
    const p = presets.find(x => x.id === id);
    const partyN = typeof syncPartySizeFromField === "function" ? syncPartySizeFromField() : state.partySize;
    const u = p.build(lv, partyN);
    u.zone = enemySpawnZone();
    state.units.push(u);
    state.selectedId = u.id;
    state.targetId = u.id;
    if (isMechanicalUnit(u)) syncBatteryShields().forEach(s => appendLog(s));
    renderAll();
  };
  uiEl("attackerSel").onchange = e => { state.attackerId = e.target.value || null; renderAll(); };
  uiEl("targetSel").onchange = e => { state.targetId = e.target.value || null; renderAll(); };
  uiEl("btnFillAtk").onclick = () => {
    const a = unitById(uiEl("attackerSel").value);
    if (a) fillFromSuggest(a);
  };
  uiEl("btnCalc").onclick = doCalc;
  uiEl("btnApply").onclick = doApply;
  window.addEventListener("beforeunload", () => {
    try { localStorage.setItem("anterscale-calc", JSON.stringify({
      zoneMode: state.zoneMode, partySize: state.partySize, weather: state.weather,
      phaseStep: state.phaseStep, sandDir: state.sandDir, units: state.units, fields: state.fields
    })); } catch (e) {}
  });

  let loaded = false;
  try {
    const raw = localStorage.getItem("anterscale-calc");
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.units) && s.units.length) {
        state.zoneMode = s.zoneMode || 2;
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
  lv = Math.max(1, Number(lv) || 1);
  owner.weaponLevels = owner.weaponLevels || {};
  owner.weaponLevels[kit] = lv;
  const existing = (state.units || []).find(u => u.kit === kit && u.weaponOf === owner.kit);
  if (existing) {
    existing.level = lv;
    if (typeof applyWeaponLevel === "function") applyWeaponLevel(existing);
  }
  if (lv >= 5) appendLog(`${weaponCardName(kit)} ${lv} 级：规则上须找工匠。已按主持人许可写入。`);
  if (typeof computeWeaponAtk === "function" && owner.kit !== "hiaki") {
    const primary = (owner.linkedKits || [])[0];
    if (kit === primary) {
      owner.weaponAtk = computeWeaponAtk(kit, owner.attrs, lv);
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

function dmDealAttack() {
  const atkId = (uiEl("dmAtk") || {}).value;
  const tgtId = (uiEl("dmTgt") || {}).value;
  const element = (uiEl("dmEle") || {}).value || "physical";
  const mult = Number((uiEl("dmMult") || {}).value);
  const splash = Number((uiEl("dmSplash") || {}).value);
  const flat = Number((uiEl("dmFlat") || {}).value) || 0;
  const br = Number((uiEl("dmBrk") || {}).value);
  const splashBr = Number((uiEl("dmSplashBrk") || {}).value);
  const diceN = Number((uiEl("dmDiceN") || {}).value) || 0;
  const diceS = Number((uiEl("dmDiceS") || {}).value) || 0;
  const skip = !!(uiEl("dmSkipBlock") || {}).checked;
  let targets = dmCheckedUnits("dmHit");
  const main = unitById(tgtId);
  if (main && targets.every(u => u.id !== main.id)) targets.unshift(main);
  if (!targets.length) { appendLog("主持人出手：没有勾选波及单位，也没有主目标。"); return; }
  const notes = [`主持人安排一次攻击，波及 ${targets.map(u => u.name).join("、")}。`];
  const hitOne = (a, t, isMain) => {
    const m = isMain ? (isNaN(mult) ? 1 : mult) : (isNaN(splash) ? (isNaN(mult) ? 1 : mult) : splash);
    const b = isMain ? (isNaN(br) ? 1 : br) : (isNaN(splashBr) ? 0 : splashBr);
    if (!a) {
      if (flat > 0 || m === 0) applyTypedDot(t, flat || 0, element, notes, `${t.name} 环境伤害（${ELE[element] || element}）`);
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

function dmDealEnv() {
  const scope = (uiEl("dmEnvScope") || {}).value || "pick";
  const zone = Number((uiEl("dmEnvZone") || {}).value) || 1;
  const element = (uiEl("dmEnvEle") || {}).value || "physical";
  const flat = Number((uiEl("dmEnvFlat") || {}).value) || 0;
  const br = Number((uiEl("dmEnvBrk") || {}).value) || 0;
  const notes = ["主持人安排环境伤害。"];
  let list = [];
  if (scope === "zone") {
    list = dmAllUnits().filter(u => !u.hidden && !u.dead && Number(u.zone) === zone);
  } else if (scope === "enemies") {
    list = dmAllUnits().filter(u => !u.hidden && !u.dead && !u.isPlayer);
  } else if (scope === "players") {
    list = dmAllUnits().filter(u => !u.hidden && !u.dead && u.isPlayer);
  } else {
    list = dmCheckedUnits("dmHit");
  }
  if (!list.length) { appendLog("主持人环境伤害：没有目标。勾选波及单位，或改成整个区域。"); return; }
  notes.push("目标：" + list.map(u => u.name).join("、"));
  list.forEach(u => {
    if (flat > 0) applyTypedDot(u, flat, element, notes, `${u.name} 环境伤害（${ELE[element] || element}）`);
    if (br > 0 && typeof dealBreak === "function") dealBreak(u, br, element, notes, "环境击破");
  });
  appendLog(notes.join("\n"));
  if (typeof presentAssistModal === "function") presentAssistModal();
  renderAll();
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
        <span class="hint">${existing ? (existing.hidden ? "收在手上" : "在场") : "未唤出"} · 武器ATK ${typeof computeWeaponAtk === "function" ? computeWeaponAtk(kit, pc.attrs, lv) : "?"}${lv >= 5 ? " · 需工匠" : ""}</span>
      </div>`;
    });
  });
  if (!wepRows) html += `<p class="hint">场上没有带着武器的角色。</p>`;
  html += `<div class="hr"></div><div class="row">
    <label class="field">发放经验<input id="xpGrant" type="number" value="25"></label>
    <button class="btn" id="btnGrantXp">给所有角色加经验</button>
  </div>`;
  box.innerHTML = html;
  const bindNum = (sel, fn) => box.querySelectorAll(sel).forEach(inp => { inp.onchange = () => fn(inp); });
  bindNum("[data-lv]", inp => {
    const u = unitById(inp.dataset.lv);
    if (!u) return;
    u.level = Math.max(1, Number(inp.value) || 1);
    if (typeof applyLevelStats === "function") applyLevelStats(u);
    if (u.kit === "hiaki" && typeof refreshHiakiAtk === "function") refreshHiakiAtk(u);
  });
  bindNum("[data-xp]", inp => { const u = unitById(inp.dataset.xp); if (u) u.xp = Math.max(0, Number(inp.value) || 0); });
  bindNum("[data-pts]", inp => { const u = unitById(inp.dataset.pts); if (u) u.attrPoints = Math.max(0, Number(inp.value) || 0); });
  bindNum("[data-shp]", inp => { const u = unitById(inp.dataset.shp); if (u) u.shp = Math.max(0, Number(inp.value) || 0); });
  bindNum("[data-shpmax]", inp => { const u = unitById(inp.dataset.shpmax); if (u) u.shpMax = Math.max(0, Number(inp.value) || 0); });
  box.querySelectorAll("[data-owkit]").forEach(inp => {
    inp.onchange = () => {
      const owner = unitById(inp.dataset.owkit);
      if (!owner) return;
      setOwnedWeaponLevel(owner, inp.dataset.wkit, inp.value);
      appendLog(`${owner.name} 的 ${weaponCardName(inp.dataset.wkit)} 设为 ${owner.weaponLevels[inp.dataset.wkit]} 级。`);
      renderBackstage();
      renderAll();
    };
  });
  box.querySelectorAll("[data-attr]").forEach(inp => {
    inp.onchange = () => {
      const u = unitById(inp.dataset.attr);
      if (!u) return;
      u.attrs = u.attrs || { str: 5, con: 5, dex: 5, wil: 5, int: 5, sta: 5 };
      const next = Math.max(1, Number(inp.value) || 1);
      const prev = Number(u.attrs[inp.dataset.k]) || 5;
      if (next > prev && (u.attrPoints || 0) > 0) {
        u.attrPoints -= 1;
        u.attrs[inp.dataset.k] = next;
      } else if (next <= prev) {
        u.attrs[inp.dataset.k] = next;
      } else {
        inp.value = prev;
        appendLog(`${u.name} 没有可分配属性点。4 级和 8 级各得 1 点。`);
      }
      renderBackstage();
    };
  });
  box.querySelectorAll("[data-recalc]").forEach(btn => {
    btn.onclick = () => {
      const u = unitById(btn.dataset.recalc);
      if (u) { applyLevelStats(u); appendLog(`${u.name} 已按规则重算 HP/ATK/DEF/SHP。`); renderBackstage(); renderAll(); }
    };
  });
  box.querySelectorAll("[data-lvup]").forEach(btn => {
    btn.onclick = () => {
      const u = unitById(btn.dataset.lvup);
      if (u && tryLevelUp(u)) { renderBackstage(); renderAll(); }
      else if (u) appendLog(`${u.name} 经验不足（${u.xp || 0}/${xpToNext(u.level)}）。`);
    };
  });
  const g = uiEl("btnGrantXp");
  if (g) g.onclick = () => {
    grantXpToPlayers(Number(uiEl("xpGrant").value) || 0, "后台发放");
    renderBackstage();
  };
  const after = () => { renderBackstage(); if (typeof renderAll === "function") renderAll(); };
  bindNum("[data-lcur]", inp => {
    const u = unitById(inp.dataset.lcur);
    dmApplyLayer(u, Number(inp.dataset.i), inp.value, null);
  });
  bindNum("[data-lmax]", inp => {
    const u = unitById(inp.dataset.lmax);
    dmApplyLayer(u, Number(inp.dataset.i), null, inp.value);
  });
  bindNum("[data-def]", inp => { const u = unitById(inp.dataset.def); if (u) u.def = Math.max(0, Number(inp.value) || 0); });
  bindNum("[data-defmax]", inp => {
    const u = unitById(inp.dataset.defmax);
    if (!u) return;
    u.defMax = Math.max(0, Number(inp.value) || 0);
    if ((u.def || 0) > u.defMax) u.def = u.defMax;
  });
  bindNum("[data-zone]", inp => {
    const u = unitById(inp.dataset.zone);
    if (u) u.zone = Math.max(1, Math.min(Number(state.zoneMode) || 3, Number(inp.value) || 1));
  });
  bindNum("[data-atk]", inp => { const u = unitById(inp.dataset.atk); if (u) u.atk = Math.max(0, Number(inp.value) || 0); });
  box.querySelectorAll("[data-fillhp]").forEach(b => b.onclick = () => { const u = unitById(b.dataset.fillhp); if (u) { dmFillHp(u); appendLog(`${u.name} 后台满血。`); after(); } });
  box.querySelectorAll("[data-filldef]").forEach(b => b.onclick = () => { const u = unitById(b.dataset.filldef); if (u) { dmFillDef(u); appendLog(`${u.name} 后台满架势。`); after(); } });
  box.querySelectorAll("[data-stun]").forEach(b => b.onclick = () => {
    const u = unitById(b.dataset.stun);
    if (!u) return;
    dmForceStun(u);
    appendLog(`${u.name} 被后台打入失衡。`);
    if (typeof queueAssistAttack === "function") queueAssistAttack(null, u);
    after();
    if (typeof presentAssistModal === "function") presentAssistModal();
  });
  box.querySelectorAll("[data-unstun]").forEach(b => b.onclick = () => { const u = unitById(b.dataset.unstun); if (u) { u.stunned = false; if ((u.def || 0) <= 0) u.def = u.defMax || 1; appendLog(`${u.name} 解除失衡。`); after(); } });
  box.querySelectorAll("[data-kill]").forEach(b => b.onclick = () => {
    const u = unitById(b.dataset.kill);
    if (!u) return;
    (u.layers || []).forEach(l => { l.current = 0; });
    u.dead = true;
    u.dying = !u.isPlayer ? false : true;
    appendLog(`${u.name} 被后台击倒。`);
    after();
  });
  box.querySelectorAll("[data-revive]").forEach(b => b.onclick = () => { const u = unitById(b.dataset.revive); if (u) { dmRevive(u); appendLog(`${u.name} 后台复活。`); after(); } });
  const ba = uiEl("btnDmAtk");
  if (ba) ba.onclick = () => { dmDealAttack(); renderBackstage(); };
  const be = uiEl("btnDmEnv");
  if (be) be.onclick = () => { dmDealEnv(); renderBackstage(); };
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
