/* D2 authority model and in-memory transport. No DOM, game rules, networking or saves.
 * Slots use zero-based indices. null slots are intentional: moving an unspent unit
 * past a locked slot must never shift that slot. Only a unit leaving the field may
 * shrink the slot array. Game integration owns rule validation and actual execution.
 */
(function (root) {
  "use strict";
  function clone(value) {
    if (root.Commands) return root.Commands.validate({ type: "hotseat.data", value }).value;
    const walk = (v, seen = new Set()) => {
      if (v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) return;
      if (!v || typeof v !== "object" || seen.has(v)) throw new TypeError("Transport requires JSON data");
      const proto = Object.getPrototypeOf(v);
      if (!Array.isArray(v) && proto !== null && Object.getPrototypeOf(proto) !== null) throw new TypeError("Transport requires plain JSON data");
      if (Object.getOwnPropertySymbols(v).length) throw new TypeError("Transport requires JSON keys");
      seen.add(v);
      for (const key of Object.getOwnPropertyNames(v)) {
        if (Array.isArray(v) && key === "length") continue;
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (!d.enumerable || d.get || d.set || ["__proto__", "constructor", "prototype"].includes(key)) throw new TypeError("Transport requires JSON properties");
        if (Array.isArray(v) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= v.length)) throw new TypeError("Transport requires JSON arrays");
        walk(d.value, seen);
      }
      if (Array.isArray(v)) for (let i = 0; i < v.length; i++) if (!Object.hasOwn(v, i)) throw new TypeError("Transport requires dense arrays");
      seen.delete(v);
    };
    walk(value);
    return JSON.parse(JSON.stringify(value));
  }
  function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
  const DEFAULT_HEROES = ["ruby", "yuito", "hiaki", "tou", "xia", "chuan", "nora", "kolt", "helu", "ras"];

  const CHAT_KEEP = 300;   // 小队聊天保留的条数
  /* 掷骰（按钮式，d100）：选角色和熟练项，掷一颗 d100（种族优势掷两颗取低，劣势取高）。
   * 点数越低越好：≤5 大成功；之后按这名角色这项熟练的成功线（手册的成功率表 × 100）
   * 看过得了哪一档——极难 / 困难 / 普通 / 简单；都过不了就是失败。
   * lines：{ extreme, hard, normal, easy }（百分比）。一级熟练是 12.5 / 25 / 50 / 100。 */
  const ROLL_TIERS = [["extreme", "极难成功"], ["hard", "困难成功"], ["normal", "普通成功"], ["easy", "简单成功"]];
  function rollTier(roll, lines) {
    if (roll <= 5) return { key: "crit", name: "大成功" };
    for (const [key, name] of ROLL_TIERS) if (roll <= (Number((lines || {})[key]) || 0)) return { key, name };
    return { key: "fail", name: "失败" };
  }
  function rollD100(spec, random) {
    const rnd = typeof random === "function" ? random : Math.random;
    const one = () => 1 + Math.floor(rnd() * 100);
    const dice = spec.adv || spec.dis ? [one(), one()] : [one()];
    const roll = spec.adv ? Math.min(...dice) : spec.dis ? Math.max(...dice) : dice[0];
    return { dice, roll, tier: rollTier(roll, spec.lines) };
  }
  /* 检定（手册第一章）：每颗骰子 d100，掷出 ≤ 成功线（基础成功率 × 100）算成功。
   * 优势掷两颗取好的，劣势两颗都要过；人类「迎难直上」整个检定失败后再来一次。
   * target：{ base, adv, dis, reroll }。返回 { ok, rolls: [{ roll, ok, label }], rerolled } */
  function rollCheck(target, random) {
    const rnd = typeof random === "function" ? random : Math.random;
    const base = Math.max(0, Math.min(1, Number(target.base) || 0)), line = base * 100, rolls = [];
    const d100 = label => {
      const r = rnd(), hit = r < base;
      let roll = Math.floor(r * 100) + 1;
      if (hit && roll > line) roll = Math.max(1, Math.floor(line));
      if (!hit && roll <= line) roll = Math.floor(line) + 1;
      rolls.push({ roll, ok: hit, label }); return hit;
    };
    const once = tag => {
      if (base >= 1) { rolls.push({ roll: null, ok: true, label: tag + "必定成功" }); return true; }
      if (base <= 0) { rolls.push({ roll: null, ok: false, label: tag + "没有资格尝试" }); return false; }
      if (!target.adv && !target.dis) return d100(tag);
      const a = d100(tag + (target.adv ? "优势 · 第 1 颗" : "劣势 · 第 1 颗")), b = d100(tag + (target.adv ? "优势 · 第 2 颗" : "劣势 · 第 2 颗"));
      return target.adv ? a || b : a && b;
    };
    let ok = once(""), rerolled = false;
    if (!ok && target.reroll && base > 0) { rerolled = true; ok = once("迎难直上重掷 · "); }
    return { ok, rolls, rerolled };
  }
  const TABLE_KEEP = 20;
  function create(options) {
    options = options || {};
    if (typeof options.getUnits !== "function") throw new TypeError("Hotseat requires getUnits");
    const operators = (options.operators || []).map(p => typeof p === "string" ? { id: p, name: p } : { id: p.id, name: p.name || p.id });
    const operatorMap = new Map(operators.map(p => [p.id, p]));
    if (!operators.length || operatorMap.size !== operators.length || operators.some(p => typeof p.id !== "string" || !p.id)) throw new TypeError("Hotseat requires unique operators");
    const gmId = options.gmId || operators[0].id, mode = options.mode || "trpg";
    if (!operatorMap.has(gmId)) throw new TypeError("Unknown host operator");
    if (!["trpg", "coop"].includes(mode)) throw new TypeError("Unknown hotseat mode");
    const now = options.now || (() => Date.now());
    const cards = typeof root.livePartyCards === "function" ? root.livePartyCards() : null;
    const heroKits = new Set(options.heroKits || (cards ? cards.filter(c => !c.weaponOf).map(c => c.kit) : DEFAULT_HEROES));
    const isHero = options.isHero || (u => !!u.isPlayer && !u.weaponOf && !u.isPartner && heroKits.has(u.kit));
    const canStand = options.canStand || (u => typeof root.standUpBlocked === "function" ? !root.standUpBlocked(u) : Number(u.shp) > 0);
    let assignments = {}, phase = "setup", turnNo = 0, roster = [], slots = [], confirmed = new Set();
    let swaps = [], ask = null, closedAsk = null, sequence = 0;
    // 小队聊天：重新分配角色 / 有人进出房间会重建会话，聊天记录从上一个会话带过来
    let chat = (Array.isArray(options.chat) ? options.chat : []).filter(r => r && typeof r.text === "string").slice(-CHAT_KEEP);
    // 主持人发起的检定、玩家申请的属性点（跨战斗保留，和小队聊天一样）
    let table = cleanTable(options.table);
    sequence = chat.reduce((m, r) => Math.max(m, Number(String(r.id || "").replace(/^chat-/, "")) || 0), 0);
    const spent = new Set(), completed = new Set(), stableById = new Map();
    const changes = new Set(), askClosures = new Set();

    function operator(id) { if (!operatorMap.has(id)) fail("unknown_operator", "没有这个操作者"); return operatorMap.get(id); }
    function host(id) { operator(id); if (id !== gmId) fail("host_only", "只有房主可以执行此操作"); }
    function present(u) { return !!u && !u.hidden && !u.fused && !u._removed && !u.dead; }
    function down(u) { return !!u.dying || (Array.isArray(u.layers) && u.layers.length > 0 && u.layers.every(l => (Number(l.current) || 0) <= 0) && !u.upOnShp); }
    function maps() {
      const units = options.getUnits() || [], heroes = units.filter(isHero);
      return { units, heroes, byId: new Map(units.map(u => [u.id, u])), byKit: new Map(heroes.map(u => [u.kit, u])) };
    }
    function identity(u, all) {
      if (!u) return null;
      const hero = u.weaponOf ? all.byId.get(u.weaponOf) || all.byKit.get(u.weaponOf) : u;
      if (!hero || !isHero(hero)) return null;
      return { hero, operatorId: assignments[hero.id] || gmId, stableKey: u.weaponOf ? hero.id + ":weapon:" + u.kit : hero.id };
    }
    function rows() {
      const all = maps(), result = [];
      for (const u of all.units) {
        const ident = identity(u, all);
        if (!ident) continue;
        stableById.set(u.id, ident.stableKey);
        if (!present(u) || !present(ident.hero) || (down(ident.hero) && !canStand(ident.hero))) continue;
        if (u.weaponOf ? down(u) : down(u) && !canStand(u)) continue;
        result.push({ unitId: u.id, unitName: u.name || u.kit || u.id, operatorId: ident.operatorId,
          operatorName: operatorMap.get(ident.operatorId).name, weaponOf: u.weaponOf || null, stableKey: ident.stableKey });
      }
      return result;
    }
    const rowFor = id => roster.find(r => r.unitId === id);
    const slotFor = id => slots.findIndex(r => r && r.unitId === id);
    const current = () => phase === "acting" ? (slots.find(r => r && !r.completed) || {}).unitId || null : null;
    const lastLocked = () => slots.reduce((last, row, i) => row && (row.spent || row.completed) ? i : last, -1);
    function askSummary() {
      if (!ask) return null;
      return { id: ask.id, kind: ask.kind, jobId: ask.jobId, targetId: ask.targetId, deadline: ask.deadline,
        waiting: ask.operators.filter(id => !ask.declined.includes(id)).map(id => ({ operatorId: id, operatorName: operatorMap.get(id).name })) };
    }
    function snapshot() {
      return clone({ phase, turnNo, mode, gmId, operators, assignments, roster, slots,
        currentUnitId: current(), confirmed: [...confirmed], pendingSwaps: swaps, ask: askSummary(), closedAsk, chat, table });
    }
    function cleanTable(t) {
      t = t && typeof t === "object" ? t : {};
      return { seq: Number(t.seq) || 0, title: t.title && typeof t.title.text === "string" ? t.title : null, checks: (Array.isArray(t.checks) ? t.checks : []).filter(c => c && Array.isArray(c.targets)).slice(-TABLE_KEEP),
        attrs: (Array.isArray(t.attrs) ? t.attrs : []).filter(r => r && Array.isArray(r.attrs)).slice(-TABLE_KEEP) };
    }
    function tableNote(id, text) {
      const op = operator(id);
      chat.push({ id: "chat-" + (++sequence), operatorId: id, operatorName: op.name, text: text.slice(0, 500), at: now(), roll: true });
      if (chat.length > CHAT_KEEP) chat.splice(0, chat.length - CHAT_KEEP);
    }
    /** 大字（像 Minecraft 的 /title）：主持人在所有人画面中间打出一行大字，可带一行小字。
     * opt：{ text, sub, tone: "plain" | "danger" | "hope", seconds } */
    function showTitle(id, opt) {
      const op = operator(id);
      if (id !== gmId) fail("table_gm", "只有主持人能发大字");
      const text = String((opt && opt.text) || "").trim().slice(0, 40);
      if (!text) fail("title_empty", "大字不能为空");
      const sub = String((opt && opt.sub) || "").trim().slice(0, 80);
      const tone = ["plain", "danger", "hope"].includes(opt && opt.tone) ? opt.tone : "plain";
      const seconds = Math.max(2, Math.min(15, Math.round(Number(opt && opt.seconds) || 4)));
      table.title = { id: "title-" + (++table.seq), text, sub, tone, seconds, at: now() };
      chat.push({ id: "chat-" + (++sequence), operatorId: id, operatorName: op.name, text: `【${text}】${sub ? " " + sub : ""}`, at: now(), title: true });
      if (chat.length > CHAT_KEEP) chat.splice(0, chat.length - CHAT_KEEP);
      return emit("title");
    }
    /** 按钮掷骰：spec 由房主按角色卡算好 { unitId, name, prof, level, adv, dis, lines, note }；secret 只有主持人能用（暗骰） */
    function skillRoll(id, spec, secret) {
      const op = operator(id);
      if (!spec || typeof spec.prof !== "string" || !spec.unitId) fail("roll_bad", "先选角色和熟练项");
      const owner = (rowFor(spec.unitId) || {}).operatorId || gmId;
      if (id !== gmId && id !== owner) fail("table_owner", "只能替自己的角色掷骰");
      if (secret && id !== gmId) fail("chat_secret", "只有主持人能暗骰");
      const r = rollD100(spec, options.random);
      const lv = ["没有熟练", "一级熟练", "二级熟练", "三级熟练"][Number(spec.level) || 0] || "";
      const dice = r.dice.length > 1 ? `${r.dice.join("、")}（${spec.adv ? "优势取低" : "劣势取高"}）→ ${r.roll}` : String(r.roll);
      const text = `${secret ? "暗骰" : "掷骰"} · ${spec.name}「${spec.prof}」${lv}：d100 ${dice} → ${r.tier.name}${spec.note ? "（" + String(spec.note).slice(0, 80) + "）" : ""}`;
      const row = { id: "chat-" + (++sequence), operatorId: id, operatorName: op.name, text: text.slice(0, 500), at: now(),
        roll: { total: r.roll, tier: r.tier.key } };
      if (secret) row.secret = true;
      chat.push(row);
      if (chat.length > CHAT_KEEP) chat.splice(0, chat.length - CHAT_KEEP);
      return emit("chat");
    }
    /** 主持人发起检定。spec：{ prof, diff, diffName, note, targets: [{ unitId, name, base, adv, dis, reroll, level, perkText }] } */
    function openCheck(id, spec) {
      operator(id);
      if (id !== gmId) fail("table_gm", "只有主持人能发起检定");
      if (!spec || typeof spec.prof !== "string" || !Array.isArray(spec.targets) || !spec.targets.length) fail("table_check", "检定需要熟练项和至少一名角色");
      const check = { id: "check-" + (++table.seq), prof: spec.prof.slice(0, 20), diff: String(spec.diff || ""), diffName: String(spec.diffName || "").slice(0, 10),
        note: String(spec.note || "").slice(0, 200), status: "open", at: now(),
        targets: spec.targets.slice(0, 12).map(t => ({ unitId: String(t.unitId), name: String(t.name || t.unitId).slice(0, 40), base: Number(t.base) || 0,
          adv: !!t.adv, dis: !!t.dis, reroll: !!t.reroll, level: Number(t.level) || 0, perkText: String(t.perkText || "").slice(0, 80), result: null })) };
      table.checks.push(check);
      if (table.checks.length > TABLE_KEEP) table.checks.splice(0, table.checks.length - TABLE_KEEP);
      tableNote(id, `主持人发起${check.diffName}「${check.prof}」检定：${check.targets.map(t => t.name).join("、")}${check.note ? "（" + check.note + "）" : ""}`);
      return emit("table");
    }
    function rollCheckFor(id, checkId, unitId) {
      operator(id);
      const check = table.checks.find(c => c.id === checkId);
      if (!check || check.status !== "open") fail("table_check", "这个检定已经结束");
      const t = check.targets.find(x => x.unitId === unitId);
      if (!t) fail("table_check", "这名角色不在检定里");
      if (t.result) fail("table_check", "已经掷过了");
      const owner = (rowFor(unitId) || {}).operatorId || gmId;
      if (id !== gmId && id !== owner) fail("table_owner", "只能替自己的角色掷骰");
      t.result = rollCheck(t, options.random);
      t.result.by = id;
      const shown = t.result.rolls.map(r => r.roll == null ? r.label : `${r.label ? r.label + " " : ""}${r.roll}`).join("，");
      tableNote(id, `检定 · ${t.name}「${check.prof}」${check.diffName}（成功率 ${Math.round(t.base * 1000) / 10}%）：d100 ${shown} → ${t.result.ok ? (t.result.rolls.some(r => r.ok && r.roll != null && r.roll <= 5) ? "大成功" : "成功") : "失败"}`);
      if (check.targets.every(x => x.result)) check.status = "done";
      return emit("table");
    }
    function closeCheck(id, checkId) {
      operator(id);
      if (id !== gmId) fail("table_gm", "只有主持人能结束检定");
      const check = table.checks.find(c => c.id === checkId);
      if (!check) fail("table_check", "没有这个检定");
      check.status = check.targets.every(x => x.result) ? "done" : "closed";
      return emit("table");
    }
    /** 玩家给自己的角色申请属性点（一次一点），主持人确认后才真正加上 */
    function requestAttr(id, unitId, attr, name) {
      operator(id);
      const owner = (rowFor(unitId) || {}).operatorId || gmId;
      if (id !== owner) fail("table_owner", "只能给自己的角色申请");
      if (table.attrs.some(r => r.unitId === unitId && r.status === "pending")) fail("table_attr", "上一次申请还在等主持人确认");
      const row = { id: "attr-" + (++table.seq), unitId: String(unitId), unitName: String(name || unitId).slice(0, 40), operatorId: id, attrs: [String(attr)], status: "pending", at: now() };
      table.attrs.push(row);
      if (table.attrs.length > TABLE_KEEP) table.attrs.splice(0, table.attrs.length - TABLE_KEEP);
      return emit("table");
    }
    function decideAttr(id, reqId, decision) {
      operator(id);
      const row = table.attrs.find(r => r.id === reqId);
      if (!row || row.status !== "pending") fail("table_attr", "这条申请已经处理过了");
      if (decision === "cancel") { if (id !== row.operatorId && id !== gmId) fail("table_owner", "只能撤回自己的申请"); row.status = "cancelled"; }
      else { if (id !== gmId) fail("table_gm", "只有主持人能确认"); row.status = decision === "approve" ? "approved" : "rejected"; }
      row.decidedAt = now();
      return emit("table");
    }
    function emit(reason) { const data = snapshot(); for (const fn of [...changes]) fn(data, reason); return data; }
    function closeAsk(reason, unitId, extra, operatorId) {
      if (!ask) return closedAsk;
      closedAsk = { id: ask.id, kind: ask.kind, jobId: ask.jobId, reason, unitId: unitId || null,
        operatorId: operatorId || null, extra: clone(extra || {}), closedAt: now() };
      ask = null;
      for (const fn of [...askClosures]) fn(clone(closedAsk));
      return closedAsk;
    }
    function reconcile(notify = true) {
      const next = rows(), byId = new Map(next.map(r => [r.unitId, r]));
      const previousIds = new Set(roster.map(r => r.unitId));
      const changed = next.length !== roster.length || next.some(r => { const old = rowFor(r.unitId); return !old || old.operatorId !== r.operatorId; });
      roster = next;
      const slotRow = r => ({ ...r, spent: spent.has(r.stableKey), completed: completed.has(r.stableKey) });
      slots = slots.filter(r => !r || byId.has(r.unitId)).map(r => r ? slotRow(byId.get(r.unitId)) : null);
      if (phase === "selecting") {
        while (slots.length > roster.length) { const i = slots.lastIndexOf(null); if (i < 0) break; slots.splice(i, 1); }
        while (slots.length < roster.length) slots.push(null);
        if (changed) confirmed.clear();
      } else if (phase === "acting" || phase === "enemy") {
        for (const r of roster) if (!previousIds.has(r.unitId) && slotFor(r.unitId) < 0) {
          // 战斗中召唤出的武器人：紧挨着本人，并且立刻轮到它行动（本人还有行动的话，武器人结束后再回到本人）
          const ownerKey = r.weaponOf ? String(r.stableKey).split(":weapon:")[0] : null;
          const at = ownerKey ? slots.findIndex(s => s && s.stableKey === ownerKey) : -1;
          if (at >= 0 && phase === "acting" && !slots[at].completed && current() === slots[at].unitId) slots.splice(at, 0, slotRow(r));
          else if (at >= 0) slots.splice(at + 1, 0, slotRow(r));
          else slots.push(slotRow(r));
        }
        if (phase === "acting" && !current()) phase = "enemy";
      }
      swaps = swaps.filter(s => {
        const a = slots[s.from], b = slots[s.to];
        return a && b && a.unitId === s.actor && b.unitId === s.target && !a.spent && !a.completed && !b.spent && !b.completed &&
          (phase === "selecting" || (phase === "acting" && s.from > lastLocked() && s.to > lastLocked()));
      });
      if (ask) {
        ask.candidates = ask.candidates.filter(id => byId.has(id));
        ask.operators = [...new Set(ask.candidates.map(id => byId.get(id).operatorId))];
        if (!ask.operators.length || ask.operators.every(id => ask.declined.includes(id))) closeAsk("unavailable", null, {}, null);
      }
      return notify ? emit("reconcile") : snapshot();
    }
    function setAssignments(value) {
      if (!["setup", "ended"].includes(phase)) fail("battle_started", "战斗中不能重新分配角色");
      const next = clone(value || {}), heroes = maps().heroes;
      for (const id of Object.keys(next)) {
        if (!heroes.some(u => u.id === id)) fail("not_hero", "只能分配英雄角色");
        operator(next[id]);
      }
      assignments = next; reconcile(false); return emit("assignments");
    }
    function beginRound(number) {
      if (!Number.isInteger(number) || number < 1) fail("round", "回合编号无效");
      if (phase === "ended") fail("ended", "战斗已经结束");
      if (turnNo === number && ["selecting", "acting"].includes(phase)) return snapshot();
      if (ask) fail("waiting", "正在等待协助回应");
      turnNo = number; spent.clear(); completed.clear(); swaps = []; confirmed.clear();
      phase = "selecting"; roster = rows(); slots = roster.map(() => null);
      if (!roster.length) phase = "enemy";
      return emit("beginRound");
    }
    function requireOwned(id, unitId, override = false) {
      operator(id);
      const row = rowFor(unitId);
      if (!row) fail("unavailable_unit", "该单位不在可操作队伍中");
      if (row.operatorId !== id && !(override && id === gmId && mode === "trpg")) fail("not_owner", "不是你的角色或武器人");
      return row;
    }
    function place(id, unitId, index) {
      if (phase !== "selecting") fail("not_selecting", "现在不是选择顺序阶段");
      reconcile(false); const row = requireOwned(id, unitId);
      if (!Number.isInteger(index) || index < 0 || index >= slots.length) fail("slot", "没有这个顺序格子");
      if (slots[index] && slots[index].unitId !== unitId) fail("occupied", "已被占用");
      const old = slotFor(unitId);
      if (old === index) return snapshot();
      if (old >= 0 && slots[old].spent) fail("locked", "这个格子已经固定，不能调整");
      if (old >= 0) slots[old] = null;
      slots[index] = { ...row, spent: spent.has(row.stableKey), completed: completed.has(row.stableKey) };
      confirmed.delete(id); swaps = []; return emit("pick");
    }
    function startIfReady() {
      const owners = [...new Set(roster.map(r => r.operatorId))];
      if (slots.some(r => !r) || owners.some(id => !confirmed.has(id))) return false;
      phase = "acting"; if (!current()) phase = "enemy"; swaps = []; return true;
    }
    function confirm(id) {
      operator(id); if (phase !== "selecting") fail("not_selecting", "现在不是选择顺序阶段");
      reconcile(false);
      if (roster.some(r => r.operatorId === id && slotFor(r.unitId) < 0)) fail("unplaced_units", "请为自己的全部单位选择格子");
      confirmed.add(id); startIfReady(); return emit("confirm");
    }
    function forceStart(id) {
      host(id); if (phase !== "selecting") fail("not_selecting", "现在不是选择顺序阶段");
      reconcile(false);
      for (const row of roster) if (slotFor(row.unitId) < 0) {
        const index = slots.indexOf(null); slots[index] = { ...row, spent: spent.has(row.stableKey), completed: completed.has(row.stableKey) };
      }
      confirmed = new Set(roster.map(r => r.operatorId)); startIfReady(); return emit("forceStart");
    }
    function movable(row) { if (!row || row.spent || row.completed) fail("locked", "这个格子已经固定，不能调整"); }
    function move(id, unitId, to) {
      operator(id); if (!["selecting", "acting"].includes(phase)) fail("not_ordering", "当前不能调整顺序");
      reconcile(false); requireOwned(id, unitId, true);
      const from = slotFor(unitId), row = slots[from]; movable(row);
      if (!Number.isInteger(to) || to < 0 || to > slots.length || (phase === "selecting" && to === slots.length)) fail("slot", "没有这个顺序格子");
      if (phase === "acting" && to <= lastLocked()) fail("locked_boundary", "只能移到所有固定格子之后");
      if (to === from) return { status: "moved", snapshot: snapshot() };
      const target = slots[to];
      if (target) {
        movable(target);
        if (phase === "acting" && from <= lastLocked()) fail("locked_boundary", "互换双方都必须在固定格子之后");
        if (target.operatorId !== row.operatorId && !(id === gmId && mode === "trpg")) {
          const request = { id: "swap-" + (++sequence), actor: unitId, target: target.unitId, from, to, requester: id, responder: target.operatorId };
          swaps = swaps.filter(s => ![s.actor, s.target].some(u => u === unitId || u === target.unitId)); swaps.push(request);
          return { status: "pending", requestId: request.id, snapshot: emit("swapRequested") };
        }
      }
      if (to === slots.length) slots.push(null);
      slots[to] = row; slots[from] = target || null;
      confirmed.delete(row.operatorId); if (target) confirmed.delete(target.operatorId); swaps = [];
      return { status: "moved", snapshot: emit("move") };
    }
    function acceptSwap(id, requestId, accept) {
      operator(id); reconcile(false);
      const request = swaps.find(s => s.id === requestId);
      if (!request) fail("stale_swap", "这个互换请求已经失效");
      if (id !== request.responder) fail("not_responder", "这不是发给你的互换请求");
      swaps = swaps.filter(s => s.id !== requestId);
      if (accept) {
        const a = slots[request.from], b = slots[request.to]; movable(a); movable(b);
        slots[request.from] = b; slots[request.to] = a;
        confirmed.delete(a.operatorId); confirmed.delete(b.operatorId); swaps = [];
      }
      return { accepted: !!accept, snapshot: emit("swapAnswered") };
    }
    function assertAction(id, actorId) {
      reconcile(false); requireOwned(id, actorId);
      if (ask) fail("waiting", "正在等待协助回应");
      if (phase !== "acting") fail("not_acting", phase === "selecting" ? "请先确定行动顺序" : "现在不能操作玩家技能");
      if (current() !== actorId) fail("not_turn", "还没轮到这个单位");
      return true;
    }
    function finishUnit(id, actorId) {
      const unitId = actorId || current(); assertAction(id, unitId);
      const row = slots[slotFor(unitId)]; completed.add(row.stableKey); row.completed = true;
      swaps = []; if (!current()) phase = "enemy";
      return { roundDone: phase === "enemy", snapshot: emit("finishUnit") };
    }
    function markSpent(entries) {
      const all = maps();
      for (const e of entries || []) {
        if (!(Number(e.ap) > 0 || Number(e.bonus) > 0)) continue;
        const ident = identity(all.byId.get(e.unitId), all);
        const key = ident ? ident.stableKey : stableById.get(e.unitId);
        if (key) spent.add(key);
      }
      reconcile(false); return emit("spent");
    }
    function openAsk(spec) {
      if (ask) fail("ask_pending", "还有协助询问没有结束");
      if (!spec || typeof spec.kind !== "string" || !spec.kind) throw new TypeError("Ask requires a kind");
      reconcile(false);
      const candidates = [...new Set(spec.candidates || [])].filter(id => rowFor(id));
      const owners = [...new Set(candidates.map(id => rowFor(id).operatorId))];
      ask = { id: "ask-" + (++sequence), kind: spec.kind, jobId: spec.jobId == null ? null : spec.jobId,
        targetId: spec.targetId || null, candidates, operators: owners, declined: [],
        deadline: now() + (Number.isFinite(spec.remainingMs) ? Math.max(0, Math.min(20000, spec.remainingMs)) : 20000) };
      closedAsk = null; const result = askSummary();
      if (!candidates.length) closeAsk("unavailable", null, {}, null);
      emit("askOpened"); return clone(result);
    }
    function tick() { if (ask && now() >= ask.deadline) { closeAsk("timeout", null, {}, null); return emit("askTimeout"); } return snapshot(); }
    function answer(id, askId, response) {
      operator(id); tick(); reconcile(false);
      if (!ask) {
        if (closedAsk && closedAsk.id === askId) return { status: "closed", accepted: false, result: clone(closedAsk) };
        fail("stale_ask", "这个协助询问已经结束");
      }
      if (ask.id !== askId) fail("stale_ask", "这个协助询问已经结束");
      if (!ask.operators.includes(id)) fail("not_candidate", "这次询问没有发给你");
      if (ask.declined.includes(id)) fail("already_declined", "你已经放弃这次协助");
      const unitId = response && response.unitId || null;
      if (unitId) {
        if (!ask.candidates.includes(unitId) || rowFor(unitId).operatorId !== id) fail("not_candidate", "不能代替其他单位回答");
        const extra = clone(response.extra || {});
        const result = closeAsk("accepted", unitId, extra, id); emit("askAccepted");
        return { status: "closed", accepted: true, result: clone(result) };
      }
      ask.declined.push(id);
      if (ask.operators.every(op => ask.declined.includes(op))) { const result = closeAsk("declined", null, {}, null); emit("askDeclined"); return { status: "closed", accepted: false, result: clone(result) }; }
      emit("askDeclined"); return { status: "waiting", accepted: false, result: null };
    }
    function askFor(id) {
      operator(id); if (!ask) return null;
      const summary = askSummary(), declined = ask.declined.includes(id);
      const list = ask.candidates.map(rowFor).filter(r => r && r.operatorId === id);
      return clone({ ...summary, eligible: list.length > 0, declined,
        options: declined ? [] : list.map(r => ({ unitId: r.unitId, unitName: r.unitName })) });
    }
    function chatMessage(id, text) {
      const op = operator(id);
      // 小队聊天在大厅、探索和战斗中都开放
      if (typeof text !== "string" || !text.trim()) fail("chat_empty", "消息不能为空");
      const row = { id: "chat-" + (++sequence), operatorId: id, operatorName: op.name, text: text.trim().slice(0, 500), at: now() };
      chat.push(row);
      if (chat.length > CHAT_KEEP) chat.splice(0, chat.length - CHAT_KEEP);
      return emit("chat");
    }
    function endBattle() { phase = "ended"; swaps = []; if (ask) closeAsk("ended", null, {}, null); return emit("ended"); }
    function reset() {
      if (ask) closeAsk("reset", null, {}, null);
      phase = "setup"; turnNo = 0; spent.clear(); completed.clear(); slots = []; swaps = []; confirmed.clear(); stableById.clear();
      roster = rows(); return emit("reset");
    }
    // This checkpoint belongs to the host's online recovery sidecar, never to a
    // player packet or the campaign save format. Pending questions are recreated
    // from the authoritative reaction queues after a host reload.
    function checkpoint() {
      return clone({ ...snapshot(), sequence, spent: [...spent], completed: [...completed] });
    }
    function restore(value) {
      const saved = clone(value);
      if (!saved || !["setup", "selecting", "acting", "enemy", "ended"].includes(saved.phase) ||
          !Number.isInteger(saved.turnNo) || saved.turnNo < 0 || !Array.isArray(saved.slots)) throw new Error("无效的房主顺序存档");
      phase = "setup"; setAssignments(saved.assignments);
      phase = saved.phase; turnNo = saved.turnNo; sequence = Number(saved.sequence) || 0;
      spent.clear(); completed.clear();
      for (const key of saved.spent || []) spent.add(key);
      for (const key of saved.completed || []) completed.add(key);
      confirmed = new Set((saved.confirmed || []).filter(id => operatorMap.has(id)));
      roster = rows(); const available = new Map(roster.map(r => [r.unitId, r]));
      const used = new Set();
      slots = saved.slots.map(r => {
        if (!r) return null;
        if (!available.has(r.unitId) || used.has(r.unitId)) return null;
        used.add(r.unitId); const row = available.get(r.unitId);
        return { ...row, spent: spent.has(row.stableKey), completed: completed.has(row.stableKey) };
      });
      ask = null; closedAsk = null; swaps = [];
      // 已经离开房间的人说过的话也保留（名字存在记录里）
      chat = (saved.chat || []).filter(r => r && typeof r.text === "string").slice(-CHAT_KEEP);
      table = cleanTable(saved.table);
      reconcile(false); return emit("restored");
    }
    setAssignments(options.assignments || {});
    return { snapshot, reconcile, setAssignments, beginRound, pick: place, confirm, forceStart, move, acceptSwap,
      assertAction, finishUnit, markSpent, openAsk, answer, tick, askFor, chat: chatMessage, endBattle, reset, checkpoint, restore,
      openCheck, rollCheck: rollCheckFor, closeCheck, requestAttr, decideAttr, skillRoll, showTitle,
      ownerOf: unitId => (rowFor(unitId) || {}).operatorId || null,
      extendAsk(ms) { if (ask && Number.isFinite(ms) && ms > 0) { ask.deadline += ms; emit("askResumed"); } },
      onChange(fn) { changes.add(fn); return () => changes.delete(fn); },
      onAskClosed(fn) { askClosures.add(fn); return () => askClosures.delete(fn); } };
  }

  function createHub(options) {
    const hostId = options && options.hostId || "host", endpoints = new Map(); let closed = false;
    function endpoint(id, isHost) {
      if (closed) throw new Error("LocalTransport is closed");
      if (typeof id !== "string" || !id || endpoints.has(id)) throw new Error("Duplicate or invalid transport identity");
      const listeners = new Set(); let active = true;
      const entry = {
        deliver(message, from) { if (active) for (const fn of [...listeners]) fn(clone(message), from); },
        send(message, recipientId) {
          if (closed || !active) throw new Error("LocalTransport is closed");
          const data = clone(message);
          if (isHost) {
            if (recipientId != null) { const peer = endpoints.get(recipientId); if (!peer) throw new Error("Unknown transport recipient"); peer.deliver(data, hostId); }
            else for (const [peerId, peer] of endpoints) if (peerId !== hostId) peer.deliver(data, hostId);
          } else {
            if (recipientId != null) throw new Error("Clients can only send to the host");
            const server = endpoints.get(hostId); if (!server) throw new Error("LocalTransport host is closed"); server.deliver(data, id);
          }
        },
        onMessage(fn) { if (typeof fn !== "function") throw new TypeError("onMessage requires a function"); if (!active) throw new Error("LocalTransport is closed"); listeners.add(fn); return () => listeners.delete(fn); },
        close() { active = false; listeners.clear(); endpoints.delete(id); }
      };
      endpoints.set(id, entry);
      return { send: entry.send, onMessage: entry.onMessage, close: entry.close };
    }
    const host = endpoint(hostId, true);
    return { host, connect: id => endpoint(id, false), close() { for (const entry of [...endpoints.values()]) entry.close(); closed = true; } };
  }
  const Hotseat = { create, rollCheck, rollTier, rollD100 }, LocalTransport = { createHub };
  root.Hotseat = Hotseat; root.LocalTransport = LocalTransport;
  if (typeof module !== "undefined" && module.exports) module.exports = { Hotseat, LocalTransport };
})(typeof globalThis !== "undefined" ? globalThis : window);
