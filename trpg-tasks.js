/* Antlerscale: Backfire · 跑团模式的任务系统（主持人发布、编辑任务）
 *
 * 任务存在 LEDGER.tasks（跟着跑团存档走）。一个任务：
 *   { id, name, kind, goal, days, status: draft 草稿 / posted 已发布 / active 进行中 / done 已完成 / failed 失败,
 *     reward: { kuizhi, xp, items: [{ id, qty }], parts: [改装件 id], blueprints: [图纸 id], intactKuizhi },
 *     escort: null 或 { kind: cart / vip, name, hp, def, atk, level, cur 当前血量（null = 满）, lost },
 *     nodes: [{ type, note, enemies: [{ id, lv, zone }], weather, zoneMode, done }], index 走到第几站 }
 * 路线（nodes）、每一站的敌人和天气、奖励都由主持人预先配置，进行中也能改。
 * 打战斗站：trpgTaskPrepareBattle 返回这一站的敌人配置并记下 TRPG.taskBattle，
 * 摆战场时护送对象跟着上场（trpgSpawnTaskEscort），战斗结算后 trpgTaskAfterBattle 记血量、推进路线。 */
"use strict";

const TRPG_TASK_KINDS = { clear: "清剿", escort: "护送", scout: "侦察", bounty: "悬赏", custom: "自定义" };
const TRPG_NODE_TYPES = { battle: "战斗", elite: "精英战", rest: "休息点", shop: "商店", smith: "工匠", clinic: "诊所", event: "事件" };
const TRPG_TASK_STATUS = { draft: "草稿", posted: "已发布", active: "进行中", done: "已完成", failed: "失败" };
const TRPG_WEATHERS = ["none", "heat", "snow", "acid", "thunder", "glow", "sand", "phase"];

function trpgTasks() {
  if (!Array.isArray(LEDGER.tasks)) LEDGER.tasks = [];
  return LEDGER.tasks;
}
function trpgTaskById(id) { return trpgTasks().find(t => t.id === id) || null; }
function trpgActiveTask() { return trpgTasks().find(t => t.status === "active") || null; }
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
    index: old.index != null ? old.index : 0
  };
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
function trpgTaskCreate(kind) {
  const list = trpgTasks();
  const id = "t" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const t = trpgTaskNormalize(trpgTaskTemplate(kind), { id });
  list.push(t);
  return [`新建任务草稿「${t.name}」（${TRPG_TASK_KINDS[t.kind]}）。`];
}
/** 保存主持人改过的任务（状态、走到第几站、护送对象当前血量保留） */
function trpgTaskSave(data) {
  const old = trpgTaskById(data && data.id);
  if (!old) return ["没有这个任务。"];
  const t = trpgTaskNormalize(data, old);
  t.index = Math.min(old.index || 0, t.nodes.length);
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
  const cur = trpgActiveTask();
  if (cur) return [`已经有进行中的任务「${cur.name}」，先结算它。`];
  t.status = "active";
  t.index = 0;
  t.nodes.forEach(n => { n.done = false; });
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
  n.done = true;
  t.index += 1;
  const next = t.nodes[t.index];
  return [`任务「${t.name}」第 ${t.index} 站（${TRPG_NODE_TYPES[n.type]}）完成。${next ? `下一站：${TRPG_NODE_TYPES[next.type]}${next.note ? "（" + next.note + "）" : ""}。` : "路线走完了，可以结算任务。"}`];
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
  const r = t.reward;
  const notes = [`任务「${t.name}」完成！`];
  if (r.kuizhi) { state.kuizhi = (Number(state.kuizhi) || 0) + r.kuizhi; notes.push(`报酬 ${r.kuizhi} 奎支。`); }
  if (t.escort) {
    const sp = escortSpec(t.escort, t.escort.level);
    const hp = t.escort.cur != null ? t.escort.cur : sp.hpMax;
    if (escortIntact(hp, sp.hpMax) && r.intactKuizhi) {
      state.kuizhi += r.intactKuizhi;
      notes.push(`${sp.name}完好送达（${hp}/${sp.hpMax}）：额外 ${r.intactKuizhi} 奎支。`);
    } else notes.push(`${sp.name}送到了（${hp}/${sp.hpMax}）${escortIntact(hp, sp.hpMax) ? "" : "，受损严重，没有额外报酬"}。`);
  }
  r.items.forEach(x => { bagAdd(x.id, x.qty); notes.push(`获得 ${ITEM_CATALOG[x.id].name} ×${x.qty}。`); });
  r.parts.forEach(id => { bagAdd(weaponPartItemId(id), 1); notes.push(`获得改装件 ${weaponPartLabel(id)}。`); });
  r.blueprints.forEach(id => { bagAdd(id, 1); notes.push(`获得客制化图纸「${blueprintSpec(id).name}」。`); });
  if (r.xp) notes.push(...trpgGiveXp(null, r.xp));
  t.status = "done";
  if (typeof ledgerCapture === "function") ledgerCapture();
  return notes;
}
function trpgTaskFail(id, why) {
  const t = trpgTaskById(id);
  if (!t || t.status !== "active") return ["没有进行中的这个任务。"];
  t.status = "failed";
  if (TRPG.taskBattle && TRPG.taskBattle.id === id) TRPG.taskBattle = null;
  return [`任务「${t.name}」失败${why ? "：" + why : ""}。没有报酬。`];
}
/** 长休时护送的人物也休息（货车不会自己好） */
function trpgTaskRestEscort(notes) {
  const t = trpgActiveTask();
  if (t && t.escort && !t.escort.lost && t.escort.kind === "vip" && t.escort.cur != null) {
    t.escort.cur = null;
    notes.push(`${escortSpec(t.escort, t.escort.level).name}也休息好了，血量回满。`);
  }
}
