/* Host-only form controls. Every write crosses the serialized gm command boundary. */
(function (root) {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const option = (value, label, selected) => `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
  const present = u => !u.hidden && !u.dead && !u.fused && !u._removed;
  const propNames = { button: "按钮", lever: "拉杆", battery: "超充能电池", boom: "爆炸桶", acid: "酸液桶", scrap: "碎渣机炮", turret: "防卫炮台", ironwall: "铁壁", scrapwall: "废铁墙", dome: "防护罩", coral_branch: "沙珊瑚枝", coral_tentacle: "沙珊瑚触须" };
  const factionNames = { player: "玩家", enemy: "敌人", neutral: "中立" };
  const isCoral = k => k === "coral_branch" || k === "coral_tentacle";   // 沙珊瑚是中立的（props.js · makeProp）
  const statusNames = { burn: "灼烧层数", shock: "感电", corr: "腐蚀", frostbite: "冻伤", shockwave: "冲击", high: "高能", reso: "共振", unstable: "不稳定", weak: "虚弱", inspire: "振奋", sturdy: "坚固", hide: "隐蔽", advantage: "优势", chase: "追猎" };
  const fieldNames = { "": "无主场地", fireOn: "火场", acid: "酸液", ice: "冰面", electric: "电场", energy: "能量", harmonic: "谐波", heal: "疗愈", quicksand: "流沙", coral: "沙珊瑚台地" };
  const weatherNames = { none: "常态", heat: "酷暑", snow: "雪天", acid: "酸雨", thunder: "雷鸣", glow: "微光", sand: "沙暴", phase: "相位" };
  const gapNames = { open: "畅通", bridge: "不稳桥梁", wall: "危墙", door: "机关门", void: "空隙" };
  const numericUnit = { hp: "最内层生命", shp: "坚毅生命（仅主持人）", shpMax: "坚毅生命上限", def: "架势", defMax: "架势上限", ap: "行动点", apMax: "行动点上限", bonus: "附赠行动", bonusMax: "附赠行动上限", atk: "个人 ATK", level: "等级", zone: "所在区", highEnergy: "高能层数" };
  const instantNames = { melt: "熔融", sting: "刺骨", overload: "过载", shift: "错位", spread: "扩散", refract: "折射" };
  const layerNames = () => typeof LAYER !== "undefined" ? LAYER : { flesh: "肉体", armor: "装甲", shield: "护盾", sand: "沙尘" };
  const atkFxIds = () => typeof ATKFX !== "undefined" ? Object.keys(ATKFX).filter(k => ["combust", "icebreak", "bolt", "etch", "backflow", "inertia", "diffract"].includes(k)) : [];   // 同单机编辑器里的七种属性专属攻击效果
  const flagUnit = { stunned: "失衡", dying: "濒死", dead: "倒下", flying: "飞行" };
  const NO_TARGET = new Set("en_boom_fuse en_patrol_chase en_patrol_near en_gl en_gl_fire en_ant_shell en_ant_shell_fire en_riot_bottle en_riot_bottle_fireen_gas_ignite en_hunter_heat en_alarm_zap en_bigsand_summon en_bigsand_heal en_live_absorb en_giant_sand_pulse en_boat_arc en_king_hold en_king_exec en_thug_mutiny en_chi_cover ufo_stomp ufo_sweep ufo_prime ufo_boom en_agg2_overheat en_agg3_debris en_agg1_rush en_agg1_rush_prep ufo_summon".split(" "));
  function mount(bridge) {
    if (!bridge || typeof bridge.getView !== "function" || typeof bridge.submit !== "function") throw new TypeError("OnlineGMUI requires getView and submit");
    let view, container = null, open = false, tab = "enemies", busy = false, notice = "", silent = false;
    let enemyId = "", actorId = "", skillId = "", picks = {}, unitId = "", unitField = "hp", propId = "", propKind = "boom", fieldZone = 1, gapKey = "1-2";
    const state = () => view && view.state || {};
    const units = () => state().units || [];
    const enemies = () => units().filter(u => !u.isPlayer && present(u));
    const zones = () => Array.from({ length: Number(state().zoneMode) || 2 }, (_, i) => i + 1);
    const manual = u => !!u && (view.manual && Object.prototype.hasOwnProperty.call(view.manual, u.id) ? view.manual[u.id] : !!root.GMCommands?.isManual(u));
    const presets = () => typeof enemyPresets === "function" ? enemyPresets().filter(p => p.id !== "blank_pc") : view.enemyCatalog || [];
    const skills = u => u ? (typeof enemySkillList === "function" ? enemySkillList(u) : (view.enemySkills || {})[u.id] || []).filter(s => !/协助|借机/.test(s.label || "") && !/_assist$|_opp$|_block$/.test(s.id)) : [];
    const selectedUnit = () => units().find(u => u.id === unitId) || units()[0];
    const selectedProp = () => (state().props || []).find(p => p.id === propId) || (state().props || [])[0];
    const value = id => container.querySelector("#" + id)?.value;
    const checked = id => !!container.querySelector("#" + id)?.checked;
    const num = id => Number(value(id));
    // 可以空着的个体值输入（空 = 随机）
    const ivInput = (id, label) => `<label>${label}<input id="${id}" type="number" min="-10" max="10" step="1" placeholder="随机"></label>`;
    // 富集与否（沙鱼，desert.js）：随机 / 富集 / 普通
    const isFishKit = kit => typeof SAND_FISH_KITS !== "undefined" && SAND_FISH_KITS.includes(kit);
    const enrichNames = { "": "随机（开战时 10%，沙暴 25%）", on: "富集", off: "普通（不富集）" };
    const ivVal = id => { const v = value(id); return v === undefined || v === null || String(v).trim() === "" ? null : Math.max(-10, Math.min(10, Math.round(Number(v)))); };
    // 种族（enemies.js）：空 = 随机（固定种族的敌人照固定）；「类人」= 四个大支里随机
    const raceNames = () => {
      const o = { "": "随机 / 照配置" };
      if (typeof ENEMY_RACES === "undefined") return o;
      ["人类", "红皮人", "类人"].concat(Object.keys(ENEMY_RACES).filter(r => !["人类", "红皮人"].includes(r)).reduce((a, r) => a.concat([r], (ENEMY_RACES[r].branches || []).map(b => r + "·" + b)), [])).forEach(r => { o[r] = r; });
      return o;
    };
    const select = (id, label, options) => `<label>${label}<select id="${id}">${options}</select></label>`;
    const number = (id, label, initial = 0, min = 0, max = "", step = "any") => { if (id.endsWith("-level") || (id === "ogm-unit-value" && unitField === "level")) max = 25; return `<label>${label}<input id="${id}" type="number" min="${min}"${max === "" ? "" : ` max="${max}"`} step="${step}" value="${esc(initial)}" required></label>`; };
    const check = (id, label, yes) => `<label class="ogm-check"><input id="${id}" type="checkbox"${yes ? " checked" : ""}>${label}</label>`;
    const button = (label, action, extra = "", disabled = false) => `<button type="button" data-action="${action}" ${extra}${disabled || busy ? " disabled" : ""}>${label}</button>`;
    const zoneOptions = selected => zones().map(z => option(z, z + " 区", Number(selected) === z)).join("");
    const unitOptions = (list, selected) => list.map(u => option(u.id, `${u.name} · ${u.zone} 区`, u.id === selected)).join("");
    const options = (map, selected) => Object.entries(map).map(([k, label]) => option(k, label, k === String(selected))).join("");
    function manualMarkup() {
      const a = enemies().find(u => u.id === actorId && manual(u)) || enemies().find(manual);
      if (!a) return '<p class="ogm-muted">还没有开启手动控制的敌人。</p>' + (view.manualPhase ? button("结束敌人回合", "enemy-end", 'class="ogm-primary"') : "");
      actorId = a.id; const list = skills(a);
      if (!list.some(s => s.id === skillId)) { skillId = list[0]?.id || ""; picks = {}; }
      let steps = [];
      if (typeof skillFlowSteps === "function") steps = skillFlowSteps(skillId, a, picks) || [];
      else steps = (view.skillSteps || {})[skillId] || [];
      const stepMarkup = steps.map(step => {
        const choices = step.type === "zone" ? step.zones.map(z => ({ value: z, label: z + " 区" }))
          : step.type === "unit" ? step.units.filter(present).map(u => ({ value: u.id, label: u.name })) : step.options || [];
        return select("ogm-pick-" + step.key, esc(step.label), option("", step.optional ? "不选择" : "请选择", picks[step.key] == null) + choices.map(o => option(o.value, o.label, o.value === picks[step.key])).join(""));
      }).join("");
      const needTarget = !NO_TARGET.has(skillId) && !steps.some(s => s.type === "unit");
      return `<p class="ogm-muted">先由 AI 行动，再由主持人操作。点数和射程仍按敌人原规则结算。</p><div class="ogm-grid">${select("ogm-manual-actor", "手动敌人", unitOptions(enemies().filter(manual), actorId))}<p class="ogm-budget">行动 ${esc(a.ap || 0)} / 附赠 ${esc(a.bonus || 0)}${a.stunned ? " · 失衡" : ""}</p>${select("ogm-skill", "技能", list.map(s => option(s.id, s.label || s.id, s.id === skillId)).join(""))}${needTarget ? select("ogm-target", "目标", option("", "请选择目标", true) + unitOptions(units().filter(u => u.isPlayer && present(u)), null)) : ""}${stepMarkup}</div><div class="ogm-actions">${button("执行技能", "enemy-skill", "", !view.manualPhase || !skillId)}${zones().filter(z => Math.abs(z - a.zone) === 1).map(z => button("移动到 " + z + " 区", "enemy-move", `data-zone="${z}"`, !view.manualPhase)).join("")}${button("结束敌人回合", "enemy-end", 'class="ogm-primary"', !view.manualPhase)}</div>${!view.manualPhase ? '<p class="ogm-muted">敌人回合的手动阶段开始后可以操作。</p>' : ""}`;
    }
    function enemiesMarkup() {
      const library = presets(); if (!library.some(p => p.id === enemyId)) enemyId = library[0]?.id || "";
      return `<h3>生成敌人</h3><div class="ogm-grid">${select("ogm-enemy-kind", "种类", library.map(p => option(p.id, p.name || p.label || p.id, p.id === enemyId)).join(""))}${number("ogm-enemy-level", "等级", 1, 1, "", 1)}${select("ogm-enemy-zone", "加入区域", zoneOptions(zones().length))}${number("ogm-enemy-count", "数量", 1, 1, 100, 1)}${ivInput("ogm-enemy-iv-hp", "血量水平 %")}${ivInput("ogm-enemy-iv-atk", "ATK 水平 %")}${select("ogm-enemy-race", "种族", options(raceNames(), ""))}${isFishKit(enemyId) ? select("ogm-enemy-enrich", "富集", options(enrichNames, "")) : ""}</div><p class="ogm-muted">个体值：杂兵、精英的血量和 ATK 在 ±10% 内波动；水平空着就随机，写了就按写的（−10～10）。首领不波动。种族：空着就按敌人的配置（固定的照固定，随机的抽），只有有种族的敌人才生效。</p>${button("加入战场", "spawn", 'class="ogm-primary"', !enemyId)}<h3>在场敌人</h3><div class="ogm-actions">${button("全部手动", "manual-all-on")}${button("全部交给 AI", "manual-all-off")}</div><ul class="ogm-enemies">${enemies().map(u => `<li><span><b>${esc(u.name)}</b><small>${esc(u.zone)} 区 · Lv${esc(u.level)} · ${manual(u) ? "手动" : "AI"}</small></span><div class="ogm-actions">${button(manual(u) ? "交给 AI" : "手动", "manual-one", `data-id="${esc(u.id)}"`)}${button("移出", "remove-enemy", `data-id="${esc(u.id)}"`)}${button("击杀", "kill-enemy", `data-id="${esc(u.id)}" class="ogm-danger"`)}</div></li>`).join("") || "<li>当前没有敌人。</li>"}</ul><p class="ogm-muted">移出：无击杀奖励、无死亡效果。击杀：按正常死亡结算。</p><h3>手动行动</h3>${manualMarkup()}`;
    }
    function unitMarkup() {
      const u = selectedUnit(); if (!u) return "<p>场上没有单位。</p>"; unitId = u.id;
      // 字段和单机的单位编辑器（app.js · renderEditor）一样：名称、血量层（含类型 / 加 / 删）、状态、即时效果、挂攻击效果、自我效果、最近元素
      const names = Object.assign({ name: "名称" }, numericUnit, flagUnit, { layers: "各层生命与上限", statuses: "添加 / 移除状态", instant: "即时效果", atkFx: "挂下一击的攻击效果", latestElement: "最近元素", self: "自身状态" },
        typeof ivEligible === "function" && ivEligible(u) ? { iv: "个体值（血量 / ATK 水平）" } : {},
        typeof enemyRaceInfo === "function" && enemyRaceInfo(u) ? { race: "种族" } : {},
        isFishKit(u.kit) ? { enriched: "富集与否" } : {});
      if (unitField === "race" && !names.race) unitField = "hp";
      if (unitField === "iv" && !names.iv) unitField = "hp";
      if (unitField === "enriched" && !names.enriched) unitField = "hp";
      let editor;
      if (unitField === "layers") editor = (u.layers || []).map((l, i) => `<fieldset><legend>第 ${i + 1} 层 · ${esc(typeof LAYER !== "undefined" ? LAYER[l.type] || l.type : l.type)}</legend><div class="ogm-grid">${select("ogm-layer-type-" + i, "类型", options(layerNames(), l.type))}${number("ogm-layer-hp-" + i, "当前生命", l.current)}${number("ogm-layer-max-" + i, "生命上限", l.max)}</div>${(u.layers || []).length > 1 ? button("删掉这一层", "remove-layer", `data-index="${i}"`) : ""}</fieldset>`).join("") + button("加一层（10 / 10 肉体）", "add-layer");
      else if (unitField === "name") editor = `<label>名称<input id="ogm-unit-name" type="text" maxlength="40" value="${esc(u.name)}" required></label>`;
      else if (unitField === "instant") editor = `<div class="ogm-grid">${Object.entries(instantNames).map(([k, label]) => check("ogm-instant-" + k, label, !!(u.instant || {})[k])).join("")}</div>${button("结算中和", "neutralize")}`;
      else if (unitField === "atkFx") editor = `<div class="ogm-grid">${atkFxIds().map(k => check("ogm-atkfx-" + k, esc(ATKFX[k].name), (u.resources?.nextAtkFx || []).includes(k))).join("")}</div><p class="ogm-muted">挂在下一击上，可与穿刺 / 猛击同挂。</p>`;
      else if (unitField === "statuses") editor = `<div class="ogm-grid">${select("ogm-status", "状态", options(statusNames, "burn"))}${number("ogm-status-value", "层数（0 移除；开关状态用 0 / 1）", 1, 0, "", 1)}</div>`;
      else if (unitField === "latestElement") editor = select("ogm-unit-value", "最近元素", options({ "": "无", physical: "物理", fire: "火", acid: "酸", electric: "电", ice: "冰", energy: "能量", harmonic: "谐波" }, u.statuses?.latestElement || ""));
      else if (unitField === "iv") editor = `<div class="ogm-grid">${number("ogm-iv-hp", "血量水平 %（−10～10）", (u.iv || {}).hp || 0, -10, 10, 1)}${number("ogm-iv-atk", "ATK 水平 %（−10～10）", (u.iv || {}).atk || 0, -10, 10, 1)}</div><p class="ogm-muted">按生成时的原始数值重算：血量上限 ×(1 + 血量%)（已受的伤按比例保留），ATK ×(1 + ATK%)。</p>`;
      else if (unitField === "race") {
        const o = raceNames(); delete o[""];
        editor = `${select("ogm-unit-value", "种族", options(o, typeof raceLabel === "function" ? raceLabel(u.race) : ""))}<p class="ogm-muted">按生成时的原始数值重算六维（先去掉旧种族加的，再加新种族的；只有随机种族的盗匪、燃气收集机才改数值），个体值跟着重算。</p>`;
      }
      else if (unitField === "enriched") editor = `${select("ogm-unit-value", "富集", options({ on: "富集", off: "普通（不富集）" }, u.enriched ? "on" : "off"))}<p class="ogm-muted">富集：装甲层 ×1.5、名字加「富集」、打倒奎支 ×5 并掉武器升级材料、第 3 回合起会下潜逃走。改成普通则反过来（已受的伤按比例保留）。定了以后开战不再随机。</p>`;
      else if (unitField === "self") editor = select("ogm-unit-value", "自身状态", options({ none: "无", burn: "焚身", frost: "霜结", splash: "溅射", conductor: "导体", anchor: "锚定", store: "储能", doppler: "多普勒" }, u.self));
      else if (Object.prototype.hasOwnProperty.call(flagUnit, unitField)) editor = check("ogm-unit-flag", esc(flagUnit[unitField]), !!u[unitField]);
      else editor = number("ogm-unit-value", esc(numericUnit[unitField]), unitField === "hp" ? (u.layers || []).at(-1)?.current || 0 : u[unitField] || 0, ["level", "zone"].includes(unitField) ? 1 : 0, unitField === "zone" ? zones().length : "", ["level", "zone", "ap", "apMax", "bonus", "bonusMax"].includes(unitField) ? 1 : "any");
      const unitTools = !u.isPlayer ? button("复制单位", "copy-unit") : "";
      return `<h3>修改单位</h3><div class="ogm-grid">${select("ogm-unit", "单位", unitOptions(units(), unitId))}${select("ogm-unit-field", "修改项目", options(names, unitField))}</div>${editor}${button("应用单位修改", "edit-unit", 'class="ogm-primary"')}${button("回满架势", "full-def")}${unitTools}<p class="ogm-muted">超过上限的当前数值会自动夹到上限。坚毅生命数值仅主持人可见。</p>`;
    }
    function propMarkup() {
      const p = selectedProp(); if (p) propId = p.id;
      const edit = p ? `<h3>编辑配置物</h3>${select("ogm-prop", "配置物", (state().props || []).map(x => option(x.id, `${x.name} · ${x.zone} 区`, x.id === propId)).join(""))}<div class="ogm-grid">${select("ogm-prop-zone", "所在区", zoneOptions(p.zone))}${select("ogm-prop-faction", "阵营", options(factionNames, p.faction))}${number("ogm-prop-hp", "耐久", p.hp)}${number("ogm-prop-max", "耐久上限", p.maxHp)}${number("ogm-prop-edit-level", "等级", p.level || 1, 1, 25, 1)}${check("ogm-prop-movable", "可移动", !!p.movable)}${select("ogm-prop-link", "连接间隔", (zones().length === 3 ? ["1-2", "2-3"] : ["1-2"]).map(k => option(k, k + " 区", p.link === k)).join(""))}</div><div class="ogm-actions">${button("应用配置物修改", "edit-prop", 'class="ogm-primary"')}${button("移除配置物", "remove-prop")}${button("摧毁配置物", "destroy-prop", 'class="ogm-danger"')}</div>` : "";
      return `<h3>添加配置物</h3><div class="ogm-grid">${select("ogm-prop-kind", "种类", options(propNames, propKind))}${select("ogm-prop-add-zone", "放置区域", zoneOptions(1))}${number("ogm-prop-level", "等级", 1, 1, "", 1)}${select("ogm-prop-add-faction", "阵营", options(factionNames, isCoral(propKind) ? "neutral" : "player"))}</div>${button("添加配置物", "add-prop", 'class="ogm-primary"')}${edit}<p class="ogm-muted">移除不触发效果；摧毁会按正常规则引爆或释放场地效果。</p>`;
    }
    function fieldMarkup() {
      const gapKeys = zones().length === 3 ? ["1-2", "2-3"] : ["1-2"]; if (!gapKeys.includes(gapKey)) gapKey = gapKeys[0];
      if (!zones().includes(fieldZone)) fieldZone = 1;
      const g = (state().gaps || {})[gapKey] || {}, f = (state().fields || {})[fieldZone] || {};
      return `<h3>区间地形</h3><div class="ogm-grid">${select("ogm-gap", "间隔", gapKeys.map(k => option(k, k + " 区", k === gapKey)).join(""))}${select("ogm-gap-kind", "类型", options(gapNames, g.type || "open"))}${number("ogm-gap-hp", "耐久", g.hp || 0)}${number("ogm-gap-max", "耐久上限", g.maxHp || 0)}${check("ogm-gap-open", "机关门开启", !!g.open)}</div>${button("应用地形修改", "edit-gap", 'class="ogm-primary"')}<h3>区域场地</h3><div class="ogm-grid">${select("ogm-field-zone", "区域", zoneOptions(fieldZone))}${select("ogm-field-kind", "主场地", options(fieldNames, Object.keys(fieldNames).find(k => k && f[k]) || ""))}${number("ogm-field-fire", "火场层数", f.fire || 1)}${number("ogm-field-energy", "能量数值", f.energyVal || 0)}${check("ogm-field-abyss", "深渊", !!f.abyss)}${check("ogm-field-highland", "高地", !!f.highland)}${check("ogm-field-isolate", "隔离", !!f.isolate)}${check("ogm-field-collapse", "坍塌", !!f.collapseOn)}${number("ogm-field-collapse-lv", "坍塌等级", f.collapseLv || 1, 1)}${number("ogm-field-collapse-count", "坍塌计数", f.collapse || 0)}${check("ogm-field-ruin", "废墟", !!f.ruinOn)}${number("ogm-field-ruin-hp", "废墟耐久", f.ruinHp || 0)}${number("ogm-field-ruin-max", "废墟上限", f.ruinMax || 0)}${check("ogm-field-lock", "锁定场地", !!f.fieldLock)}${state().combatStarted ? check("ogm-field-innate", "固有场地（技能改不掉）", !!f.innate) : ""}</div>${button("应用场地修改", "edit-field", 'class="ogm-primary"')}<p class="ogm-muted">固有场地：整场战斗都无法被技能改变或清除（主持人仍可修改）。开战前布置的场地开战时自动成为固有场地；开战后加的场地勾上这一项也会变成固有。</p>`;
    }
    function weatherMarkup() { return `<h3>天气</h3><div class="ogm-grid">${select("ogm-weather", "天气", options(weatherNames, state().weather || "none"))}${select("ogm-sand", "沙暴风向", options({ "12": "1 区 → 2 区", "21": "2 区 → 1 区" }, state().sandDir || "12"))}${select("ogm-phase", "相位阶段", [0, 1, 2, 3].map(i => option(i, "阶段 " + (i + 1), i === Number(state().phaseStep || 0))).join(""))}${check("ogm-weather-lock", "锁定天气", !!state().weatherLock)}</div>${button("应用天气修改", "edit-weather", 'class="ogm-primary"')}<p class="ogm-muted">战前遭遇与区数请使用已有「遭遇」面板。</p>`; }
    function attackMarkup() {
      return `<h3>安排一次攻击</h3><div class="ogm-grid">${select("ogm-attack-actor", "攻击者", option("__env", "环境", true) + unitOptions(units().filter(present), null))}${select("ogm-attack-target", "主目标", unitOptions(units().filter(present), null))}${select("ogm-attack-element", "元素", options({ physical: "物理", fire: "火", acid: "酸", electric: "电", ice: "冰", energy: "能量", harmonic: "谐波" }, "physical"))}${number("ogm-attack-mult", "ATK 倍率", 1)}${number("ogm-attack-flat", "固定伤害", 0)}${number("ogm-attack-break", "击破", 1)}${number("ogm-attack-dice-n", "额外骰子个数", 0, 0, 1000, 1)}${number("ogm-attack-dice-s", "骰子面数", 6, 1, "", 1)}${number("ogm-attack-splash", "波及倍率", 0.5)}${number("ogm-attack-splash-break", "波及击破", 0)}${check("ogm-attack-skip", "跳过协助格挡", false)}</div><fieldset><legend>波及其他单位（可不选）</legend>${units().filter(present).map(u => `<label class="ogm-check"><input type="checkbox" name="ogm-hit" value="${esc(u.id)}">${esc(u.name)}</label>`).join("")}</fieldset>${button("安排攻击", "force-attack", 'class="ogm-primary"')}<p class="ogm-muted">该操作沿用主持人后台的安排攻击，不消耗常规行动点。</p>`;
    }
    function render() {
      view = bridge.getView();
      // 联机单局没有主持人：不放主持人工具
      if (!view || !view.active || !view.isHost || view.mode === "rogue") { if (container) container.remove(); container = null; open = false; silent = false; return; }
      if (!container) { container = document.createElement("div"); container.id = "online-gm-tools"; container.className = "ogm-ui"; document.body.appendChild(container); container.addEventListener("click", onClick); container.addEventListener("change", onChange); }
      const focused = container.contains(document.activeElement) ? document.activeElement.id : "";
      // Notifications may arrive while the GM types. Preserve the pending form,
      // except after an explicit selector change or accepted submit.
      if (open && focused && !busy && container.querySelector("#ogm-panel")) return;
      const tabs = { enemies: "敌人", units: "单位", props: "配置物", field: "地形", weather: "天气", attack: "安排攻击" };
      container.innerHTML = `<button id="ogm-toggle" type="button" data-action="toggle" aria-expanded="${open}" aria-controls="ogm-panel">${view.manualPhase ? "敌人待操作 · " : ""}主持人工具</button>${open ? `<section id="ogm-panel" aria-label="主持人工具面板"><header><h2>主持人工具</h2>${button("关闭", "close", 'aria-label="关闭主持人工具"')}</header><div class="ogm-toolbar">${check("ogm-silent", "静默（不写玩家记录）", silent)}<span class="ogm-muted">仅主持人</span></div><nav aria-label="主持人工具类别">${Object.entries(tabs).map(([k, label]) => button(label, "tab", `data-tab="${k}" aria-pressed="${tab === k}"`)).join("")}</nav><p id="ogm-notice" role="status"${notice ? "" : " hidden"}>${esc(notice)}</p><div class="ogm-content">${({ enemies: enemiesMarkup, units: unitMarkup, props: propMarkup, field: fieldMarkup, weather: weatherMarkup, attack: attackMarkup })[tab]()}</div></section>` : ""}`;
    }
    // Esc closes the panel wherever focus is (capture phase, before the stage swallows the key).
    function onKey(event) { if (event.key === "Escape" && open && container) { event.preventDefault(); event.stopPropagation(); open = false; refresh(); } }
    function refresh() { if (container?.contains(document.activeElement)) document.activeElement.blur(); render(); }
    async function send(command) {
      if (busy) return;
      view = bridge.getView(); if (!view?.active || !view.isHost || view.mode === "rogue") { render(); return; }
      const form = container.querySelector("#ogm-panel"); if (form && !Array.from(form.querySelectorAll("input")).every(i => i.reportValidity())) return;
      command.silent = silent; busy = true; notice = "正在执行…";
      if (["gm.enemyAct", "gm.forceAttack"].includes(command.type)) open = false; // Let normal player reaction dialogs appear.
      refresh();
      try { const result = await bridge.submit(JSON.parse(JSON.stringify(command))); notice = result && result.ok === false ? result.error || "操作被拒绝。" : "已执行。"; }
      catch (error) { notice = error.message || String(error); }
      finally { busy = false; refresh(); }
    }
    function onChange(event) {
      const { id, value: v } = event.target;
      if (id === "ogm-silent") { silent = event.target.checked; return; }
      const selectors = {
        "ogm-enemy-kind": () => { enemyId = v; }, "ogm-manual-actor": () => { actorId = v; skillId = ""; picks = {}; },
        "ogm-skill": () => { skillId = v; picks = {}; }, "ogm-unit": () => { unitId = v; }, "ogm-unit-field": () => { unitField = v; },
        "ogm-prop": () => { propId = v; }, "ogm-prop-kind": () => { propKind = v; }, "ogm-gap": () => { gapKey = v; }, "ogm-field-zone": () => { fieldZone = Number(v); }
      };
      if (selectors[id]) { selectors[id](); refresh(); }
      else if (id.startsWith("ogm-pick-")) {
        const key = id.slice(9), a = units().find(u => u.id === actorId);
        const step = typeof skillFlowSteps === "function" ? skillFlowSteps(skillId, a, picks).find(s => s.key === key) : ((view.skillSteps || {})[skillId] || []).find(s => s.key === key);
        picks[key] = v === "" ? null : step?.type === "zone" ? Number(v) : v; refresh();
      }
    }
    function onClick(event) {
      const b = event.target.closest("[data-action]"); if (!b || !container.contains(b)) return;
      const action = b.dataset.action;
      if (action === "toggle") { open = !open; refresh(); return; }
      if (action === "close") { open = false; refresh(); return; }
      if (action === "tab") { tab = b.dataset.tab; notice = ""; refresh(); return; }
      if (busy) return;
      view = bridge.getView(); const u = selectedUnit(), p = selectedProp(); let cmd;
      switch (action) {
        case "spawn": {
          cmd = { type: "gm.spawnEnemy", enemyId: value("ogm-enemy-kind"), level: num("ogm-enemy-level"), zone: num("ogm-enemy-zone"), count: num("ogm-enemy-count") };
          const ivHp = ivVal("ogm-enemy-iv-hp"), ivAtk = ivVal("ogm-enemy-iv-atk");
          if (ivHp != null || ivAtk != null) cmd.iv = { hp: ivHp, atk: ivAtk };
          const race = value("ogm-enemy-race"); if (race) cmd.race = race;
          const enr = isFishKit(cmd.enemyId) ? value("ogm-enemy-enrich") : ""; if (enr) cmd.enriched = enr === "on";
          break;
        }
        case "remove-enemy": case "kill-enemy": cmd = { type: "gm.removeUnit", actor: b.dataset.id, mode: action === "kill-enemy" ? "kill" : "remove" }; break;
        case "manual-all-on": case "manual-all-off": cmd = { type: "gm.setManual", actors: "all", enabled: action === "manual-all-on" }; break;
        case "manual-one": cmd = { type: "gm.setManual", actors: [b.dataset.id], enabled: !manual(units().find(u => u.id === b.dataset.id)) }; break;
        case "enemy-move": cmd = { type: "gm.enemyAct", actor: actorId, action: "move", dest: Number(b.dataset.zone) }; break;
        case "enemy-skill": {
          const a = units().find(u => u.id === actorId), steps = typeof skillFlowSteps === "function" ? skillFlowSteps(skillId, a, picks) : (view.skillSteps || {})[skillId] || [];
          const unitSteps = steps.filter(s => s.type === "unit" && picks[s.key]);
          cmd = { type: "gm.enemyAct", actor: actorId, action: "skill", skill: skillId, picks, target: unitSteps.length ? picks[unitSteps.at(-1).key] : value("ogm-target") || null }; break;
        }
        case "enemy-end": cmd = { type: "gm.enemyEndTurn" }; break;
        case "edit-unit": {
          if (!u) return; let patch;
          if (unitField === "layers") patch = { layers: u.layers.map((l, i) => ({ type: value("ogm-layer-type-" + i), current: num("ogm-layer-hp-" + i), max: num("ogm-layer-max-" + i) })) };
          else if (unitField === "name") patch = { name: value("ogm-unit-name") };
          else if (unitField === "instant") patch = { instant: Object.fromEntries(Object.keys(instantNames).map(k => [k, checked("ogm-instant-" + k)])) };
          else if (unitField === "atkFx") patch = { atkFx: Object.fromEntries(atkFxIds().map(k => [k, checked("ogm-atkfx-" + k)])) };
          else if (unitField === "latestElement") patch = { statuses: { latestElement: value("ogm-unit-value") || null } };
          else if (unitField === "iv") patch = { iv: { hp: num("ogm-iv-hp"), atk: num("ogm-iv-atk") } };
          else if (unitField === "race") patch = { race: value("ogm-unit-value") };
          else if (unitField === "enriched") patch = { enriched: value("ogm-unit-value") === "on" };
          else if (unitField === "statuses") { const key = value("ogm-status"), n = num("ogm-status-value"); patch = { statuses: { [key]: key === "burn" ? n : n !== 0 } }; }
          else patch = { [unitField]: Object.prototype.hasOwnProperty.call(flagUnit, unitField) ? checked("ogm-unit-flag") : unitField === "self" ? value("ogm-unit-value") : num("ogm-unit-value") };
          cmd = { type: "gm.editUnit", actor: u.id, patch }; break;
        }
        case "add-layer": if (!u) return; cmd = { type: "gm.editUnit", actor: u.id, patch: { addLayer: true } }; break;
        case "remove-layer": if (!u) return; cmd = { type: "gm.editUnit", actor: u.id, patch: { removeLayer: Number(b.dataset.index) } }; break;
        case "neutralize": if (!u) return; cmd = { type: "gm.editUnit", actor: u.id, patch: { neutralize: true } }; break;
        case "full-def": if (!u) return; cmd = { type: "gm.editUnit", actor: u.id, patch: { def: Number(u.defMax) || 0 } }; break;
        case "copy-unit": if (!u) return; cmd = { type: "gm.copyUnit", actor: u.id }; break;
        case "add-prop": cmd = { type: "gm.addProp", kind: value("ogm-prop-kind"), zone: num("ogm-prop-add-zone"), level: num("ogm-prop-level"), faction: value("ogm-prop-add-faction") }; break;
        case "edit-prop": if (!p) return; cmd = { type: "gm.editProp", id: p.id, patch: { zone: num("ogm-prop-zone"), hp: num("ogm-prop-hp"), maxHp: num("ogm-prop-max"), level: num("ogm-prop-edit-level"), movable: checked("ogm-prop-movable"), faction: value("ogm-prop-faction"), link: value("ogm-prop-link") } }; break;
        case "remove-prop": case "destroy-prop": if (!p) return; cmd = { type: "gm.removeProp", id: p.id, mode: action === "destroy-prop" ? "destroy" : "remove" }; break;
        case "edit-gap": cmd = { type: "gm.editGap", key: gapKey, patch: { type: value("ogm-gap-kind"), hp: num("ogm-gap-hp"), maxHp: num("ogm-gap-max"), open: checked("ogm-gap-open") } }; break;
        case "edit-field": {
          const kind = value("ogm-field-kind"), patch = Object.fromEntries(Object.keys(fieldNames).filter(Boolean).map(k => [k, k === kind]));
          Object.assign(patch, { fire: kind === "fireOn" ? num("ogm-field-fire") : 0, energyVal: num("ogm-field-energy"), abyss: checked("ogm-field-abyss"), highland: checked("ogm-field-highland"), isolate: checked("ogm-field-isolate"), collapseOn: checked("ogm-field-collapse"), collapseLv: num("ogm-field-collapse-lv"), collapse: num("ogm-field-collapse-count"), ruinOn: checked("ogm-field-ruin"), ruinHp: num("ogm-field-ruin-hp"), ruinMax: num("ogm-field-ruin-max"), fieldLock: checked("ogm-field-lock") ? "主持人" : null });
          if (state().combatStarted) patch.innate = checked("ogm-field-innate");
          cmd = { type: "gm.setField", zone: fieldZone, patch }; break;
        }
        case "edit-weather": cmd = { type: "gm.setWeather", weather: value("ogm-weather"), sandDir: value("ogm-sand"), phaseStep: num("ogm-phase"), lock: checked("ogm-weather-lock") }; break;
        case "force-attack": cmd = { type: "gm.forceAttack", input: { dmAtk: value("ogm-attack-actor"), dmTgt: value("ogm-attack-target"), dmEle: value("ogm-attack-element"), dmMult: num("ogm-attack-mult"), dmSplash: num("ogm-attack-splash"), dmFlat: num("ogm-attack-flat"), dmBrk: num("ogm-attack-break"), dmSplashBrk: num("ogm-attack-splash-break"), dmDiceN: num("ogm-attack-dice-n"), dmDiceS: num("ogm-attack-dice-s"), dmSkipBlock: checked("ogm-attack-skip"), hits: Array.from(container.querySelectorAll('input[name="ogm-hit"]:checked'), n => n.value) } }; break;
      }
      if (cmd) void send(cmd);
    }
    const off = typeof bridge.subscribe === "function" ? bridge.subscribe(render) : null;
    if (typeof document !== "undefined") document.addEventListener("keydown", onKey, true);
    render();
    return { render: refresh, destroy() { if (typeof off === "function") off(); if (typeof document !== "undefined") document.removeEventListener("keydown", onKey, true); container?.remove(); container = null; } };
  }
  root.OnlineGMUI = { mount };
})(typeof globalThis !== "undefined" ? globalThis : window);
