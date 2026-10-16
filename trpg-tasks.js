/* Antlerscale: Backfire · 跑团模式的任务系统（主持人发布、编辑任务）
 *
 * 任务存在 LEDGER.tasks（跟着跑团存档走）。一个任务：
 *   { id, name, kind, goal, days, status: draft 草稿 / posted 已发布 / active 进行中 / done 已完成 / failed 失败,
 *     reward: { kuizhi, xp, items: [{ id, qty }], parts: [改装件 id], blueprints: [图纸 id], intactKuizhi },
 *     escort: null 或 { kind: cart / vip, name, hp, def, atk, level, cur 当前血量（null = 满）, lost },
 *     nodes: [{ type, note, enemies: [{ id, lv, zone }], weather, zoneMode, done }], index 走到第几站 }
 * 路线（nodes）、每一站的敌人和天气、奖励都由主持人预先配置，进行中也能改。
 * 任务日志（联机玩家也看得到，trpgQuestLog）：
 *   category main 主线 / side 支线 / personal 个人；visibility { mode: party 全队 / players, ids: 房间成员 id }；gmNote 只给主持人看；
 *   个人任务：owner 是一名角色（kit），只有操控这名角色的玩家看得到（别的玩家连有这条任务都不知道，visibility 不用），
 *   每一站和完成的经验只给这名角色（奎支、物品照样进队伍）；
 *   每一站：title 玩家看到的步骤文字（空着就只写站的类型）、hidden 没揭示前玩家只看到「？？？」、reward { xp 每人, kuizhi 队伍 } 完成这一站时发；
 *   granted { nodes: 已发过奖励的站, complete } 记账：每站奖励只发一次，回退再推进不重发。
 * 打战斗站：trpgTaskPrepareBattle 返回这一站的敌人配置并记下 TRPG.taskBattle，
 * 摆战场时护送对象跟着上场（trpgSpawnTaskEscort），战斗结算后 trpgTaskAfterBattle 记血量、推进路线。 */
"use strict";

const TRPG_TASK_KINDS = { clear: "清剿", escort: "护送", scout: "侦察", bounty: "悬赏", custom: "自定义" };
const TRPG_NODE_TYPES = { battle: "战斗", elite: "精英战", rest: "休息点", shop: "商店", smith: "工匠", clinic: "诊所", event: "事件" };
const TRPG_TASK_STATUS = { draft: "草稿", posted: "已发布", active: "进行中", done: "已完成", failed: "失败" };
const TRPG_WEATHERS = ["none", "heat", "snow", "acid", "thunder", "glow", "sand", "phase"];

function trpgTasks() {
  if (!Array.isArray(LEDGER.tasks)) LEDGER.tasks = [];
  LEDGER.tasks.forEach(trpgTaskUpgrade);
  return LEDGER.tasks;
}
/** 旧存档的任务补上任务日志的字段（分类、可见范围、每站奖励、发奖记账） */
function trpgTaskUpgrade(t) {
  if (!t || t._v === 2) return;
  if (t.category !== "main" && t.category !== "personal") t.category = "side";
  if (typeof t.owner !== "string") t.owner = "";
  if (!t.visibility || !t.visibility.mode) t.visibility = { mode: "party", ids: [] };
  if (typeof t.gmNote !== "string") t.gmNote = "";
  if (typeof t.failWhy !== "string") t.failWhy = "";
  (t.nodes || []).forEach(n => {
    if (typeof n.title !== "string") n.title = "";
    n.hidden = !!n.hidden;
    if (!n.reward || typeof n.reward !== "object") n.reward = { xp: 0, kuizhi: 0 };
  });
  if (!t.granted) t.granted = trpgTaskGranted(null, t.nodes);
  Object.defineProperty(t, "_v", { value: 2, enumerable: false, configurable: true, writable: true });
}
function trpgTaskById(id) { return trpgTasks().find(t => t.id === id) || null; }
function trpgActiveTask() { return trpgTasks().find(t => t.status === "active") || null; }
/** 任务日志可以多条同时进行（主线 + 几条支线） */
function trpgActiveTasks() { return trpgTasks().filter(t => t.status === "active"); }
function trpgPartyLevel() {
  const hs = trpgHeroes();
  return hs.length ? Math.max(1, Math.round(hs.reduce((s, h) => s + (Number(h.level) || 1), 0) / hs.length)) : 1;
}

/* ---------- 整理主持人填的数据（界面传来的 JSON 不一定干净） ---------- */
const tNum = (v, d, lo, hi) => {
  let n = Math.floor(Number(v));
  if (!isFinite(n)) n = d;
  if (lo != null) n = Math.max(lo, n);
  if (hi != null) n = Math.min(hi, n);
  return n;
};
const tStr = (v, max) => String(v == null ? "" : v).slice(0, max || 200);
function trpgTaskNormalizeNode(n) {
  n = n || {};
  const type = TRPG_NODE_TYPES[n.type] ? n.type : "battle";
  const fight = type === "battle" || type === "elite";
  const presets = typeof enemyPresets === "function" ? enemyPresets().map(p => p.id) : [];
  return {
    type, note: tStr(n.note, 300), done: !!n.done,
    title: tStr(n.title, 120), hidden: !!n.hidden,
    reward: { xp: tNum(n.reward && n.reward.xp, 0, 0), kuizhi: tNum(n.reward && n.reward.kuizhi, 0, 0) },
    enemies: fight ? (Array.isArray(n.enemies) ? n.enemies : []).filter(e => e && (!presets.length || presets.includes(e.id)))
      .slice(0, 12).map(e => ({ id: e.id, lv: tNum(e.lv, 1, 1, 30), zone: tNum(e.zone, 2, 1, 9) })) : [],
    weather: fight && TRPG_WEATHERS.includes(n.weather) ? n.weather : "none",
    // 选了战斗模板（battle-templates.js）就按模板摆战场；存的是一份拷贝，模板以后改了、删了都不影响这个任务
    template: fight && n.template && typeof n.template === "object" && typeof battleTemplateNormalize === "function" ? battleTemplateNormalize(n.template) : null,
    // 两区 / 三区，或者特殊棋盘的布局名（line4 / square4 / cross5，engine.js · BOARD_LAYOUTS）
    zoneMode: !fight ? 2 : (typeof BOARD_LAYOUTS !== "undefined" && typeof n.zoneMode === "string" && BOARD_LAYOUTS[n.zoneMode] && !/^line[23]$/.test(n.zoneMode))
      ? n.zoneMode : Number(n.zoneMode) === 3 || n.zoneMode === "line3" ? 3 : 2
  };
}
function trpgTaskNormalize(t, old) {
  t = t || {}; old = old || {};
  const r = t.reward || {};
  const known = (id) => typeof ITEM_CATALOG !== "undefined" && ITEM_CATALOG[id];
  const kind = TRPG_TASK_KINDS[t.kind] ? t.kind : "custom";
  const e = t.escort;
  return {
    id: old.id || t.id,
    name: tStr(t.name, 40) || TRPG_TASK_KINDS[kind],
    kind, goal: tStr(t.goal, 400), days: tNum(t.days, 1, 0, 30),
    status: old.status || "draft",
    reward: {
      kuizhi: tNum(r.kuizhi, 0, 0), xp: tNum(r.xp, 0, 0),
      items: (Array.isArray(r.items) ? r.items : []).filter(x => x && known(x.id)).map(x => ({ id: x.id, qty: tNum(x.qty, 1, 1, 99) })),
      parts: (Array.isArray(r.parts) ? r.parts : []).filter(id => typeof WEAPON_PARTS !== "undefined" && WEAPON_PARTS[id]),
      blueprints: (Array.isArray(r.blueprints) ? r.blueprints : []).filter(id => typeof blueprintSpec === "function" && blueprintSpec(id)),
      intactKuizhi: tNum(r.intactKuizhi, 0, 0)
    },
    escort: kind === "escort" || (e && e.kind) ? {
      kind: e && e.kind === "vip" ? "vip" : "cart",
      name: tStr(e && e.name, 20),
      hp: e && e.hp !== "" && e.hp != null ? tNum(e.hp, 0, 1, 999) : null,
      def: e && e.def !== "" && e.def != null ? tNum(e.def, 0, 0, 99) : null,
      atk: e && e.atk !== "" && e.atk != null ? tNum(e.atk, 0, 0, 99) : null,
      level: tNum(e && e.level, trpgPartyLevel(), 1, 30),
      cur: old.escort && old.escort.cur != null ? old.escort.cur : null,
      lost: !!(old.escort && old.escort.lost)
    } : null,
    nodes: (Array.isArray(t.nodes) ? t.nodes : []).slice(0, 20).map(trpgTaskNormalizeNode),
    index: old.index != null ? old.index : 0,
    category: trpgTaskCategory(t.category || old.category),
    owner: trpgTaskCategory(t.category || old.category) === "personal" ? tStr(t.owner != null ? t.owner : old.owner, 40) : "",
    visibility: trpgTaskVisibility(t.visibility || old.visibility),
    gmNote: tStr(t.gmNote, 400),
    granted: trpgTaskGranted(old.granted || t.granted, old.nodes || t.nodes),
    failWhy: tStr(old.failWhy, 120)
  };
}
/** 角色的名字（个人任务写「属于谁」用） */
function trpgHeroLabel(kit) {
  if (!kit) return "";
  if (typeof Rogue !== "undefined" && Rogue.heroName) return Rogue.heroName(kit);
  const c = typeof livePartyCards === "function" ? livePartyCards().find(x => x.kit === kit) : null;
  return c ? c.name : kit;
}
function trpgTaskCategory(c) { return c === "main" || c === "personal" ? c : "side"; }
const TRPG_TASK_CATEGORY = { main: "主线", side: "支线", personal: "个人" };
/** 这个任务的经验发给谁：个人任务只给它的角色，其他给全队（null） */
function trpgTaskXpKits(t) { return t && t.category === "personal" && t.owner ? [t.owner] : null; }
function trpgTaskVisibility(v) {
  if (v && v.mode === "players") return { mode: "players", ids: (Array.isArray(v.ids) ? v.ids : []).map(x => tStr(x, 80)).filter(Boolean).slice(0, 16) };
  return { mode: "party", ids: [] };
}
/** 发奖记账。旧存档没有：已经走过的站当作发过了（免得推进时补发） */
function trpgTaskGranted(g, nodes) {
  if (g && typeof g === "object") return { nodes: (Array.isArray(g.nodes) ? g.nodes : []).map(Number).filter(n => n >= 0), complete: !!g.complete };
  return { nodes: (Array.isArray(nodes) ? nodes : []).map((n, i) => (n && n.done ? i : -1)).filter(i => i >= 0), complete: false };
}

/* 主持人手册第三章「任务金钱（现行基准）」「任务经验」：按任务长度（天数）给，经验再按队伍等级分档（每人）。
 * 模板的默认报酬：奎支取区间中间，经验按队伍平均等级查表。主持人在任务编辑里随时改（手册：按完成质量和关系上下浮动）。
 * 以前沿用单局的报酬（清剿 1500 奎支 / 15 经验），单局为了自己的节奏调过，和手册差得很远 */
const TRPG_TASK_PAY = [
  // 最多几天, 奎支区间, 每人经验（队伍 1–4 / 5–8 / 9–12 / 13–16 / 17–20 级）
  { days: 2, name: "短", kuizhi: [2000, 3000], xp: [70, 100, 300, 500, 800] },
  { days: 5, name: "中", kuizhi: [6000, 8000], xp: [100, 300, 500, 800, 1500] },
  { days: 10, name: "长", kuizhi: [12000, 18000], xp: [300, 500, 1000, 2000, 4000] },
  { days: Infinity, name: "极难", kuizhi: [20000, 30000], xp: [500, 1000, 2000, 5000, 10000] }
];
/** 手册的任务报酬：{ name 长度档, kuizhi 默认奎支, range [低, 高], xp 每人经验 } */
function trpgTaskHandbookPay(days, level) {
  const row = TRPG_TASK_PAY.find(r => Math.max(1, Number(days) || 1) <= r.days);
  const band = Math.max(0, Math.min(row.xp.length - 1, Math.floor((Math.max(1, Number(level) || 1) - 1) / 4)));
  return { name: row.name, kuizhi: Math.round((row.kuizhi[0] + row.kuizhi[1]) / 2 / 100) * 100, range: row.kuizhi.slice(), xp: row.xp[band] };
}

/** 按单局的任务模板给一份草稿（路线、目标、天数照单局的模板，报酬照手册；主持人再改） */
function trpgTaskTemplate(kind) {
  const lv = trpgPartyLevel();
  const tpl = (typeof ROGUE_TASKS !== "undefined" ? ROGUE_TASKS : []).find(x => x.kind === kind);
  const fight = (type) => ({ type, note: "", enemies: [{ id: "thug_knife", lv, zone: 2 }, { id: "thug_hammer", lv, zone: 2 }], weather: "none", zoneMode: 2 });
  const nodes = [fight("battle"), { type: "rest", note: "可以长休的地方" }, fight(tpl && tpl.elite ? "elite" : "battle")];
  const days = tpl ? tpl.days : 1;
  const pay = trpgTaskHandbookPay(days, lv);
  const kuizhi = pay.kuizhi;
  return {
    name: tpl ? tpl.name : "新任务", kind: TRPG_TASK_KINDS[kind] ? kind : "custom",
    goal: tpl ? tpl.goal.replace("{region}", "外城区") : "", days,
    reward: { kuizhi, xp: pay.xp, items: [], parts: [], blueprints: [],
      intactKuizhi: kind === "escort" ? Math.round(kuizhi * ESCORT_RULES.intactBonus) : 0 },
    escort: kind === "escort" ? { kind: "cart", name: "", level: lv } : null,
    nodes
  };
}

/* ---------- 主持人操作 ---------- */
function trpgTaskCreate(kind, category) {
  const list = trpgTasks();
  const id = "t" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  // 个人任务先挂在第一名角色身上，主持人在编辑里换人
  const owner = category === "personal" ? ((typeof trpgHeroes === "function" ? trpgHeroes() : []).find(h => !h.weaponOf) || {}).kit || "" : "";
  const t = trpgTaskNormalize(Object.assign(trpgTaskTemplate(kind), { category, owner }), { id });
  list.push(t);
  return [`新建${TRPG_TASK_CATEGORY[t.category]}任务草稿「${t.name}」（${TRPG_TASK_KINDS[t.kind]}）。`];
}
/** 保存主持人改过的任务（状态、走到第几站、护送对象当前血量保留） */
function trpgTaskSave(data) {
  const old = trpgTaskById(data && data.id);
  if (!old) return ["没有这个任务。"];
  const t = trpgTaskNormalize(data, old);
  t.index = Math.min(old.index || 0, t.nodes.length);
  t.granted = trpgTaskGranted(old.granted, old.nodes);
  if (t.escort && old.escort && old.escort.cur != null) t.escort.cur = Math.min(old.escort.cur, escortSpec(t.escort, t.escort.level).hpMax);
  Object.keys(old).forEach(k => delete old[k]);
  Object.assign(old, t);
  return [`任务「${t.name}」已保存。`];
}
function trpgTaskDelete(id) {
  const list = trpgTasks();
  const i = list.findIndex(t => t.id === id);
  if (i < 0) return ["没有这个任务。"];
  const [t] = list.splice(i, 1);
  return [`删除任务「${t.name}」。`];
}
/** 发布 / 撤回为草稿 */
function trpgTaskSetStatus(id, status) {
  const t = trpgTaskById(id);
  if (!t) return ["没有这个任务。"];
  if (!["draft", "posted"].includes(status)) return ["只能在草稿和已发布之间切换。"];
  if (t.status === "active") return ["任务进行中，先结算或判失败。"];
  t.status = status;
  return [status === "posted" ? `发布任务「${t.name}」：${t.goal || "（没写目标）"}` : `任务「${t.name}」撤回为草稿。`];
}
function trpgTaskAccept(id) {
  const t = trpgTaskById(id);
  if (!t) return ["没有这个任务。"];
  if (t.status !== "posted") return ["只能接下已发布的任务。"];
  // 任务日志：主线、支线可以同时进行（一场战斗一次只打一个任务的站，TRPG.taskBattle 按任务记）
  t.status = "active";
  t.index = 0;
  t.nodes.forEach(n => { n.done = false; });
  t.granted = { nodes: [], complete: false };
  if (t.nodes[0]) t.nodes[0].hidden = false;   // 走到的这一站自动揭示
  if (t.escort) { t.escort.cur = null; t.escort.lost = false; }
  const sp = t.escort ? escortSpec(t.escort, t.escort.level) : null;
  return [`接下任务「${t.name}」：${t.goal || ""}（${t.nodes.length} 站${t.days ? `，${t.days} 天` : ""}）${sp ? `。护送 ${sp.name}（血量 ${sp.hpMax}）` : ""}。`];
}
/** 当前这一站完成，走到下一站 */
function trpgTaskNodeDone(id) {
  const t = trpgTaskById(id);
  if (!t || t.status !== "active") return ["没有进行中的这个任务。"];
  const n = t.nodes[t.index];
  if (!n) return ["路线已经走完了，可以结算任务。"];
  const at = t.index;
  n.done = true;
  n.hidden = false;
  t.index += 1;
  const next = t.nodes[t.index];
  if (next) next.hidden = false;   // 走到的下一站自动揭示
  const notes = [`任务「${t.name}」第 ${at + 1} 站（${trpgNodeLabel(n)}）完成。${next ? `下一站：${trpgNodeLabel(next)}。` : "路线走完了，可以结算任务。"}`];
  t.granted = t.granted || { nodes: [], complete: false };
  if (!t.granted.nodes.includes(at)) {
    t.granted.nodes.push(at);
    notes.push(...trpgTaskGrant(n.reward, `「${t.name}」第 ${at + 1} 站`, trpgTaskXpKits(t)));
  }
  return notes;
}
function trpgNodeLabel(n) { return n.title || (TRPG_NODE_TYPES[n.type] + (n.note ? "（" + n.note + "）" : "")); }
/** 发奖励（奎支平分进各人钱包——个人任务只进那名角色的；经验全队每人 / 个人任务只给那名角色）。返回日志行 */
function trpgTaskGrant(r, label, kits) {
  r = r || {};
  const notes = [];
  if (r.kuizhi > 0) notes.push(...trpgPurseSplit(r.kuizhi, kits, label));
  if (r.xp > 0) notes.push(...trpgGiveXp(kits || null, r.xp));
  if (notes.length && typeof ledgerCapture === "function") ledgerCapture();
  return notes;
}
/** 回退一站：不收回已经发过的奖励（记账保留，再推进不重发；要收回用「后台」手动改） */
function trpgTaskRollback(id) {
  const t = trpgTaskById(id);
  if (!t || t.status !== "active") return ["没有进行中的这个任务。"];
  if (!(t.index > 0)) return ["已经在第一站了。"];
  t.index -= 1;
  const n = t.nodes[t.index];
  n.done = false;
  return [`任务「${t.name}」回退到第 ${t.index + 1} 站（${trpgNodeLabel(n)}）。已经发过的奖励不收回。`];
}
/** 揭示 / 隐藏某一站（玩家的任务日志里显示「？？？」） */
function trpgTaskReveal(id, node, hidden) {
  const t = trpgTaskById(id);
  const n = t && t.nodes[Number(node)];
  if (!n) return ["没有这一站。"];
  n.hidden = !!hidden;
  return [hidden ? `任务「${t.name}」第 ${Number(node) + 1} 站对玩家隐藏。` : `任务「${t.name}」揭示第 ${Number(node) + 1} 站：${trpgNodeLabel(n)}。`];
}
/** 任务日志里的顺序：往前 / 往后挪一格 */
function trpgTaskMove(id, dir) {
  const list = trpgTasks(), i = list.findIndex(t => t.id === id), j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return [];
  list.splice(j, 0, list.splice(i, 1)[0]);
  return [];
}
/** 打当前这一站：返回 { enemies, weather, zoneMode }（选了模板就是 { template }），并记下这场是任务战斗 */
function trpgTaskPrepareBattle(id) {
  const t = trpgTaskById(id);
  if (!t || t.status !== "active") throw new Error("没有进行中的这个任务");
  const n = t.nodes[t.index];
  if (!n || (n.type !== "battle" && n.type !== "elite")) throw new Error("当前这一站不是战斗");
  if (!n.template && !n.enemies.length) throw new Error("这一站还没配置敌人");
  TRPG.taskBattle = { id: t.id, index: t.index };
  if (n.template) return { template: JSON.parse(JSON.stringify(n.template)) };
  return { enemies: JSON.parse(JSON.stringify(n.enemies)), weather: n.weather, zoneMode: n.zoneMode };
}
/** 摆战场时（battle-commands.js）：任务战斗就把护送对象放上场 */
function trpgSpawnTaskEscort() {
  const tb = TRPG.taskBattle;
  const t = tb && trpgTaskById(tb.id);
  if (!t || t.status !== "active" || !t.escort || t.escort.lost || typeof spawnEscort !== "function") return null;
  return spawnEscort(t.escort, t.escort.level, t.escort.cur);
}
/** 任务战斗结算之后：记下护送对象的血量（被摧毁 = 任务失败），赢了就走到下一站 */
function trpgTaskAfterBattle(outcome) {
  const tb = TRPG.taskBattle;
  TRPG.taskBattle = null;
  const t = tb && trpgTaskById(tb.id);
  if (!t || t.status !== "active") return [];
  const notes = [];
  if (t.escort && typeof escortStatus === "function") {
    const st = escortStatus();
    if (st) {
      t.escort.cur = st.hp;
      if (st.destroyed) {
        t.escort.lost = true;
        notes.push(...trpgTaskFail(t.id, `${st.name || escortSpec(t.escort, t.escort.level).name}被摧毁`));
        return notes;
      }
      notes.push(`护送对象剩 ${st.hp}/${st.max}。`);
    }
  }
  if (outcome === "win" && t.index === tb.index) notes.push(...trpgTaskNodeDone(t.id));
  return notes;
}
/** 结算：发奖励（奎支、每人经验、物品、改装件、图纸；护送完好额外奎支） */
function trpgTaskComplete(id) {
  const t = trpgTaskById(id);
  if (!t || t.status !== "active") return ["没有进行中的这个任务。"];
  t.granted = t.granted || { nodes: [], complete: false };
  if (t.granted.complete) { t.status = "done"; return [`任务「${t.name}」完成（奖励之前已经发过）。`]; }
  t.granted.complete = true;
  const r = t.reward;
  const notes = [`任务「${t.name}」完成！`];
  if (r.kuizhi) notes.push(...trpgPurseSplit(r.kuizhi, trpgTaskXpKits(t), "报酬"));
  if (t.escort) {
    const sp = escortSpec(t.escort, t.escort.level);
    const hp = t.escort.cur != null ? t.escort.cur : sp.hpMax;
    if (escortIntact(hp, sp.hpMax) && r.intactKuizhi) {
      notes.push(`${sp.name}完好送达（${hp}/${sp.hpMax}）：额外 ${r.intactKuizhi} 奎支。`);
      notes.push(...trpgPurseSplit(r.intactKuizhi, trpgTaskXpKits(t), "完好送达"));
    } else notes.push(`${sp.name}送到了（${hp}/${sp.hpMax}）${escortIntact(hp, sp.hpMax) ? "" : "，受损严重，没有额外报酬"}。`);
  }
  r.items.forEach(x => { bagAdd(x.id, x.qty); notes.push(`获得 ${ITEM_CATALOG[x.id].name} ×${x.qty}。`); });
  r.parts.forEach(id => { bagAdd(weaponPartItemId(id), 1); notes.push(`获得改装件 ${weaponPartLabel(id)}。`); });
  r.blueprints.forEach(id => { bagAdd(id, 1); notes.push(`获得客制化图纸「${blueprintSpec(id).name}」。`); });
  if (r.xp) notes.push(...trpgGiveXp(trpgTaskXpKits(t), r.xp));
  t.status = "done";
  if (typeof ledgerCapture === "function") ledgerCapture();
  return notes;
}
function trpgTaskFail(id, why) {
  const t = trpgTaskById(id);
  if (!t || t.status !== "active") return ["没有进行中的这个任务。"];
  t.status = "failed";
  t.failWhy = tStr(why, 120);
  if (TRPG.taskBattle && TRPG.taskBattle.id === id) TRPG.taskBattle = null;
  return [`任务「${t.name}」失败${why ? "：" + why : ""}。没有报酬。`];
}
/** 长休时护送的人物也休息（货车不会自己好） */
function trpgTaskRestEscort(notes) {
  trpgActiveTasks().forEach(t => {
    if (t.escort && !t.escort.lost && t.escort.kind === "vip" && t.escort.cur != null) {
      t.escort.cur = null;
      notes.push(`${escortSpec(t.escort, t.escort.level).name}也休息好了，血量回满。`);
    }
  });
}

/* ---------- 任务日志（玩家看到的样子）----------
 * 房主按收件人算好（online-game.js · rawPacket 的 quests），online-view.js · projectQuests 再按白名单过一遍。
 * 不给玩家：草稿、没指定给他的任务、主持人备注、敌人配置、模板、隐藏站的文字和奖励。
 * viewerId：房间成员 id；isGM：主持人自己看（全部都看得到）；viewerKits：这名玩家操控的角色（看个人任务用） */
function trpgQuestVisible(t, viewerId, isGM, viewerKits) {
  if (t.status === "draft") return false;
  if (isGM) return true;
  if (t.category === "personal") return !!t.owner && (viewerKits || []).includes(t.owner);
  return t.visibility.mode !== "players" || t.visibility.ids.includes(viewerId);
}
function trpgQuestLog(viewerId, isGM, viewerKits) {
  const order = { main: 0, side: 1, personal: 2 };
  return trpgTasks().filter(t => trpgQuestVisible(t, viewerId, isGM, viewerKits))
    .map(t => {
      const g = t.granted || { nodes: [], complete: false };
      const steps = t.nodes.map((n, i) => {
        const state = t.status === "active" ? (i < t.index ? "done" : i === t.index ? "cur" : "todo") : t.status === "done" ? "done" : "todo";
        if (n.hidden && state !== "done" && state !== "cur") return { title: "", state, hidden: true, xp: 0, kuizhi: 0, got: false };
        return { title: n.title || TRPG_NODE_TYPES[n.type], state, hidden: false, xp: n.reward.xp, kuizhi: n.reward.kuizhi, got: g.nodes.includes(i) };
      });
      return {
        id: t.id, name: t.name, category: t.category, status: t.status, goal: t.goal, days: t.days,
        private: t.category === "personal" || t.visibility.mode === "players", steps, index: t.index,
        owner: t.category === "personal" ? trpgHeroLabel(t.owner) : "",
        reward: { xp: t.reward.xp, kuizhi: t.reward.kuizhi, items: t.reward.items.map(x => `${(ITEM_CATALOG[x.id] || {}).name || x.id}×${x.qty}`)
          .concat(t.reward.parts.map(id => typeof weaponPartLabel === "function" ? weaponPartLabel(id) : id))
          .concat(t.reward.blueprints.map(id => `图纸「${(typeof blueprintSpec === "function" && blueprintSpec(id) || {}).name || id}」`)) },
        got: !!g.complete, failWhy: t.status === "failed" ? t.failWhy || "" : ""
      };
    })
    .sort((a, b) => order[a.category] - order[b.category]);
}
