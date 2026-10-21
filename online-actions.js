/* Host-only D3 action menus. Reads and legacy previews run inside inspect's
 * disposable state. Clients receive choices/commands, never rule snapshots or
 * damage forecasts. A ready command still requires validation when submitted. */
(function (root) {
  "use strict";
  const plain = v => !!v && typeof v === "object" && !Array.isArray(v);
  const has = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
  const present = u => !!u && !u.dead && !u.hidden && !u.fused && !u._removed;
  function costLabel(c) {
    c = c || {};
    const parts = [];
    if (c.ap) parts.push(c.ap > 1 ? `${c.ap} 行动点` : "行动点");
    if (c.bonus) parts.push(c.bonus > 1 ? `${c.bonus} 附赠动作` : "附赠动作");
    return parts.length ? parts.join(" + ") : "不消耗行动";
  }
  function create(options) {
    const { game, validation, inspect, assertAction, getState } = options || {};
    if (!game || !validation || typeof validation.validateBattle !== "function" || typeof validation.reason !== "function" ||
      typeof inspect !== "function" || typeof assertAction !== "function" || typeof getState !== "function") throw new TypeError("OnlineActions requires host game, validation, inspect, assertAction and getState");
    for (const name of ["gameSkills", "previewOf", "skillThunk", "candidateUnits"]) if (typeof game[name] !== "function") throw new TypeError("OnlineActions requires game." + name);
    const view = root.OnlineView || (typeof require === "function" ? require("./online-view") : null);
    if (!view) throw new Error("OnlineView must be loaded before host action menus");
    const session = { assertAction };
    const fail = message => { throw new Error(message); };
    function requestData(input) {
      if (!plain(input)) fail("无效的动作菜单请求");
      const data = root.Commands.validate({ type: "online.actionOptions", request: input }).request;
      if (Object.keys(data).some(k => !["requestId", "actor", "skill", "picks", "target", "item", "dest"].includes(k))) fail("动作菜单包含未知字段");
      if (typeof data.actor !== "string" || !data.actor) fail("缺少行动单位");
      if (data.skill != null && (typeof data.skill !== "string" || !data.skill)) fail("没有这项可用技能");
      if (data.picks != null && !plain(data.picks)) fail("分步选项必须是对象");
      for (const key of ["target", "item"]) if (data[key] != null && typeof data[key] !== "string") fail("不合法的" + key);
      if (data.dest != null && !Number.isInteger(data.dest)) fail("不合法的目标区域");
      if (data.requestId != null && (!Number.isSafeInteger(data.requestId) || data.requestId < 0)) fail("无效的请求编号");
      return data;
    }
    function menu(input, sender) {
      const request = requestData(input);
      if (assertAction(sender, request.actor) === false) fail("不是你的行动顺位");
      if (game.depth > 0 || game.ended) fail("正在结算或战斗已结束");
      const beforeSim = game.sim;
      try {
        return inspect(() => {
          game.sim = true;
          const state = getState(), actor = () => getState().units.find(u => u.id === request.actor);
          if (!present(actor()) || !actor().isPlayer) fail("没有这个可用玩家单位");
          state.attackerId = request.actor; state.selectedId = request.actor; state.targetId = request.target || null;
          state.skillFlow = request.skill && !request.skill.startsWith("__") ? { id: request.skill, actorId: request.actor, picks: request.picks || {}, index: 99 } : null;
          const base = { type: "actionOptions", actor: request.actor, ...(request.requestId == null ? {} : { requestId: request.requestId }), ...(request.skill ? { skill: request.skill } : {}) };
          const emit = choices => view.projectActionMenu({ ...base, choices });
          const check = command => {
            const value = validation.validateBattle(command, { session, sender, game });
            if (value === false) fail("规则不允许这条动作");
            return command;
          };
          const ready = command => emit({ kind: "ready", title: "确认执行", command: check(command), options: [] });
          const legal = command => { try { check(command); return true; } catch (_) { return false; } };
          const optionFor = u => ({ value: u.id, label: u.name || u.id, sub: Number.isFinite(u.zone) ? `${u.zone} 区` : "" });
          const skills = game.gameSkills(actor()) || [];
          if (!request.skill) {
            if (Object.keys(request.picks || {}).length || request.target != null || request.item != null || request.dest != null) fail("请先选择技能");
            return emit({ kind: "skill", title: "选择行动", options: skills.map(sk => {
              const reason = validation.reason(actor(), sk.id, session, sender, game);
              // cost：房主按这名角色现在的情况算好的消耗（移动 / 道具用附赠、导体移动不耗……）。以前玩家端只按技能 id 查，移动、道具都写成「行动点」
              return { value: sk.id, label: sk.name || sk.id, cost: costLabel(sk.cost), ...(reason ? { disabled: true, reason } : {}) };
            }) });
          }
          const sk = skills.find(s => s.id === request.skill);
          if (!sk) fail("这个单位没有这项可用技能");
          const why = validation.reason(actor(), sk.id, session, sender, game);
          if (why) fail(why);
          const picks = request.picks || {};
          if (sk.id.startsWith("__") && Object.keys(picks).length) fail("这条动作不接受技能分步选项");
          if (sk.id !== "__item" && request.item != null) fail("这条动作不接受道具字段");
          if (sk.id !== "__item" && sk.id !== "__move" && request.dest != null) fail("请在技能分步中选择区域");
          if (sk.id === "__stand") {
            if (request.target != null) fail("起身不接受目标");
            return ready({ type: "standUp", actor: request.actor });
          }
          if (sk.id === "__move") {
            if (request.target != null) fail("移动不接受单位目标");
            const command = dest => ({ type: "move", actor: request.actor, dest });
            if (request.dest != null) return ready(command(request.dest));
            const zones = zoneNeighbors(actor().zone).filter(z => legal(command(z)));
            return emit({ kind: "zone", key: "dest", title: "选择移动区域", options: zones.map(z => ({ value: z, label: `${z} 区` })) });
          }
          if (sk.id === "__item") {
            const items = bagList(actor()).filter(item => item.combat);
            if (!request.item) {
              if (request.target != null || request.dest != null) fail("请先选择道具");
              return emit({ kind: "choice", key: "item", title: "选择战斗道具", options: items.map(item => ({ value: item.id, label: `${item.name} ×${item.qty}` })) });
            }
            const item = items.find(x => x.id === request.item);
            if (!item) fail("背包里没有这件可用战斗道具");
            const command = (target, dest) => ({ type: "useItem", actor: request.actor, item: request.item, target, dest });
            if (item.target === "ally" && request.target == null) {
              if (request.dest != null) fail("友方道具不接受区域选项");
              return emit({ kind: "unit", key: "target", title: "选择友方", options: state.units.filter(u => present(u) && u.isPlayer && legal(command(u.id, null))).map(optionFor) });
            }
            if (item.target === "enemy" && request.target == null) {
              if (request.dest != null) fail("对敌道具不接受区域选项");
              return emit({ kind: "unit", key: "target", title: "选择敌人", options: state.units.filter(u => present(u) && !u.isPlayer && legal(command(u.id, null))).map(optionFor) });
            }
            if (item.target === "zone" && request.dest == null) {
              if (request.target != null) fail("区域道具不接受单位目标");
              return emit({ kind: "zone", key: "dest", title: "选择道具区域", options: boardZoneIds().filter(z => legal(command(null, z))).map(z => ({ value: z, label: `${z} 区` })) });
            }
            if (item.target === "weapon" && request.dest == null) {
              // 维修工具包：选要修的武器（倒地的武器人修好站起来）
              return emit({ kind: "choice", key: "dest", title: `维修工具包（${repairPoints()} 点）`, options: repairTargets().filter(r => r.need > 0)
                .map(r => ({ value: r.kit, label: r.down ? `${r.name} · 倒地` : `${r.name} · 耐久 ${r.dur}/${r.max}` })) });
            }
            return ready(command(request.target || null, request.dest == null ? null : request.dest));
          }
          const accepted = {}, processed = new Set(); let lastUnit = null;
          for (let guard = 0; guard < 16; guard++) {
            const steps = skillFlowSteps(sk.id, actor(), accepted) || [];
            const step = steps.find(s => !processed.has(s.key));
            if (!step) break;
            if (typeof step.key !== "string" || !["zone", "unit", "choice"].includes(step.type)) fail("技能分步格式无效");
            processed.add(step.key);
            const options = step.type === "zone" ? (step.zones || []).map(z => ({ value: z, label: `${z} 区` }))
              : step.type === "unit" ? (step.units || []).filter(present).map(optionFor)
                : (step.options || []).map(o => ({ value: o.value, label: o.label || String(o.value) }));
            if (step.optional) options.push({ value: null, label: "不选" });
            if (!has(picks, step.key)) {
              if (Object.keys(picks).some(key => !has(accepted, key))) fail("请按顺序完成技能分步选择");
              if (request.target != null && request.target !== lastUnit) fail("请先完成技能分步选择");
              return emit({ kind: step.type, key: step.key, title: step.label || sk.name, optional: !!step.optional, options });
            }
            const value = picks[step.key];
            if (!options.some(option => option.value === value)) fail("不合法的分步选择");
            accepted[step.key] = value;
            if (step.type === "unit" && value) lastUnit = value;
          }
          if (Object.keys(picks).some(key => !processed.has(key))) fail("包含未提供的分步选项");
          if (lastUnit && request.target != null && request.target !== lastUnit) fail("技能目标与分步选择不一致");
          const command = target => ({ type: "skill", actor: request.actor, skill: sk.id, target: target || null, picks: accepted });
          // The legacy UI's target probe is run only here, on the host's draft.
          // It may replace the draft's unit arrays; actor() therefore re-resolves
          // the current copy before each subsequent helper.
          const probe = game.previewOf(game.skillThunk(request.actor, sk.id, lastUnit, accepted));
          if (!probe.needsTarget) return ready(command(lastUnit || request.target));
          const candidates = game.candidateUnits(actor(), sk) || [];
          if (request.target != null) {
            if (!candidates.some(u => u.id === request.target)) fail("没有这个可用目标");
            const preview = game.previewOf(game.skillThunk(request.actor, sk.id, request.target, accepted));
            if (!preview.meaningful) fail("当前目标不能使用这项技能");
            return ready(command(request.target));
          }
          const options = candidates.filter(u => {
            if (!legal(command(u.id))) return false;
            return !!game.previewOf(game.skillThunk(request.actor, sk.id, u.id, accepted)).meaningful;
          }).map(optionFor);
          return emit({ kind: "unit", key: "target", title: "选择目标", options });
        });
      } finally { game.sim = beforeSim; }
    }
    return { menu };
  }
  const api = { create };
  root.OnlineActions = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
