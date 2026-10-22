/* Antlerscale: Backfire · 角色资料（NPC 条目，issue #264）：主持人新建、编辑、发布，联机玩家只读。目前只在联机跑团开放。
 *
 * 条目存在 LEDGER.lore（跟着跑团存档走：队伍记忆 GAME.campaign.ledger → 存档空位；联机房间的检查点也带着 LEDGER）。一条：
 *   { id, type 条目类型（LORE_TYPES 的键，现在只有 npc）, fields: { 字段 key: 一行字 }（有哪些字段看 LORE_TYPES[type].fields）,
 *     body 详细内容（自由书写，可以换行）, status: draft 草稿 / published 已发布,
 *     rev 内容改过几次（玩家端按它判断缓存的详细内容还能不能用）, at 最后一次改内容的时间 }
 * 草稿只有主持人看得到：发给玩家的只有已发布的条目——每个包带 lorePublicIndex（不含详细内容），
 * 玩家点开一条时才向房主要 lorePublicEntry（online-game.js · loreEntry），两样都再经 online-view.js · projectLore / projectLoreEntry 白名单。
 * 以后加类型 / 字段：在 LORE_TYPES 里加一行，再到 online-view.js 的 LORE_PUBLIC 登记给玩家看哪些字段（没登记的默认不发）。
 * 存档里认不得的类型、字段（比如新版本存的档在旧版本里打开）原样留着、截长度，不显示也不发给玩家，写回存档时不会丢。 */
"use strict";

/** 条目类型：字段（key、名字、最多几个字）、列表上当标题的字段、详细内容（名字、最多几个字）。界面、存档整理、给玩家的数据都照这张表 */
const LORE_TYPES = {
  npc: {
    name: "NPC",
    fields: [
      { key: "name", label: "姓名", max: 30 },
      { key: "gender", label: "性别", max: 10 },
      { key: "race", label: "种族", max: 20 },
      { key: "faction", label: "阵营", max: 30 },
      { key: "title", label: "职位", max: 30 }
    ],
    titleKey: "name",
    body: { label: "详细内容", max: 2000 }
  }
};
/** 上限：最多几条；认不得的字段留几个、每个留多长，认不得的类型的详细内容留多长；没写标题时列表上写什么 */
const LORE_LIMITS = { entries: 200, otherFields: 20, otherFieldMax: 60, otherBodyMax: 4000, untitled: "（未命名）" };
const LORE_STATUS = { draft: "草稿", published: "已发布" };
const LORE_ID = /^[A-Za-z0-9_-]{1,40}$/, LORE_KEY = /^[a-z][A-Za-z0-9_]{0,19}$/;

/** 截到 max 个字（UTF-16），不把一个 emoji 切成两半 */
function loreCut(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max), last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
/** 一行字（姓名、阵营……）：换行、制表符换成空格，去掉其余控制字符和零宽 / 双向控制字符，去掉头尾空白 */
function loreLine(v, max) {
  if (typeof v !== "string") return "";
  return loreCut(v.replace(/[\t\r\n]+/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, "").trim(), max);
}
/** 详细内容：保留换行（\r\n 统一成 \n），制表符换成空格，其余控制字符去掉，结尾的空白去掉 */
function loreText(v, max) {
  if (typeof v !== "string") return "";
  return loreCut(v.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/(?!\n)[\p{Cc}\p{Cf}]/gu, "").replace(/\s+$/, ""), max);
}
/** 新 id：创建时间，同一毫秒撞了才加序号（-1、-2…）。不按已经有几条编号：id 会发给玩家，看得出有几条草稿。
 *  不用 Math.random：战斗里的随机数按种子排好了，抽走一个后面的骰子就变了 */
function loreNewId(used) {
  const base = "lore-" + Date.now();
  let n = 0, id = base;
  while (used.has(id)) id = base + "-" + ++n;
  return id;
}
/** 整理一条资料（存档读进来的、主持人存的）：认得的字段照表截长度，认不得的原样留着（截短）；id 缺了 / 重复了换一个新的 */
function loreNormalize(e, used) {
  e = e && typeof e === "object" && !Array.isArray(e) ? e : {};
  used = used || new Set();
  const type = typeof e.type === "string" && LORE_KEY.test(e.type) ? e.type : "npc";
  const spec = Object.hasOwn(LORE_TYPES, type) ? LORE_TYPES[type] : null;
  let id = typeof e.id === "string" && LORE_ID.test(e.id) ? e.id : "";
  if (!id || used.has(id)) id = loreNewId(used);
  used.add(id);
  const src = e.fields && typeof e.fields === "object" && !Array.isArray(e.fields) ? e.fields : {};
  const fields = {};
  (spec ? spec.fields : []).forEach(f => { fields[f.key] = loreLine(src[f.key], f.max); });
  let other = 0;
  Object.keys(src).forEach(k => {
    if (Object.hasOwn(fields, k) || !LORE_KEY.test(k) || k === "constructor" || k === "prototype" || typeof src[k] !== "string" || other >= LORE_LIMITS.otherFields) return;
    fields[k] = loreLine(src[k], LORE_LIMITS.otherFieldMax); other++;
  });
  return {
    id, type, fields,
    body: loreText(e.body, spec ? spec.body.max : LORE_LIMITS.otherBodyMax),
    status: e.status === "published" ? "published" : "draft",
    rev: Number.isSafeInteger(e.rev) && e.rev > 0 ? e.rev : 1,
    at: typeof e.at === "number" && Number.isFinite(e.at) && e.at > 0 ? Math.floor(e.at) : 0
  };
}
/** 全部资料（主持人看的，按主持人排的顺序）。存档读进来的整份整理一次 */
function loreList() {
  if (!Array.isArray(LEDGER.lore)) LEDGER.lore = [];
  const list = LEDGER.lore;
  if (!list._clean) {
    const used = new Set();
    const clean = list.filter(e => e && typeof e === "object" && !Array.isArray(e)).slice(0, LORE_LIMITS.entries).map(e => loreNormalize(e, used));
    list.length = 0; list.push(...clean);
    Object.defineProperty(list, "_clean", { value: true, enumerable: false, configurable: true });
  }
  return list;
}
function loreById(id) { return loreList().find(e => e.id === id) || null; }
/** 列表上的标题（NPC 是姓名），空着写「（未命名）」 */
function loreTitle(e) {
  const spec = e && Object.hasOwn(LORE_TYPES, e.type) ? LORE_TYPES[e.type] : null;
  return (e && e.fields && e.fields[spec ? spec.titleKey : "name"]) || LORE_LIMITS.untitled;
}
function loreMustGet(id) {
  const e = typeof id === "string" ? loreById(id) : null;
  if (!e) throw new Error("没有这条资料");
  return e;
}

/* ---------- 主持人操作（Commands「lore」；联机时只认房主绑定的主持人身份，online-game.js · execute） ---------- */
/** 新建一条草稿（字段全空），返回 { id, notes } */
function loreCreate(type) {
  type = type || "npc";
  if (!Object.hasOwn(LORE_TYPES, type)) throw new Error("没有这种资料");
  const list = loreList();
  if (list.length >= LORE_LIMITS.entries) throw new Error(`角色资料最多 ${LORE_LIMITS.entries} 条，先删掉一些`);
  const e = loreNormalize({ type, status: "draft", rev: 1, at: Date.now() }, new Set(list.map(x => x.id)));
  list.push(e);
  return { id: e.id, notes: [`新建 ${LORE_TYPES[type].name} 资料（草稿，玩家看不到）。`] };
}
/** 保存主持人改的字段和详细内容（只认字符串；没传的字段照旧）。status 给了就一起改（「保存并发布」）。内容真的变了 rev + 1 */
function loreSave(data, status) {
  const old = loreMustGet(data && data.id);
  if (status != null && !Object.hasOwn(LORE_STATUS, status)) throw new Error("只能在草稿和已发布之间切换");
  const src = data.fields && typeof data.fields === "object" && !Array.isArray(data.fields) ? data.fields : {};
  const fields = Object.assign({}, old.fields);
  Object.keys(src).forEach(k => { if (typeof src[k] === "string") fields[k] = src[k]; });
  const next = loreNormalize(Object.assign({}, old, { fields, body: typeof data.body === "string" ? data.body : old.body, status: status || old.status }),
    new Set(loreList().filter(e => e !== old).map(e => e.id)));
  const changed = JSON.stringify([next.fields, next.body]) !== JSON.stringify([old.fields, old.body]);
  if (changed) { next.rev = old.rev + 1; next.at = Date.now(); }
  const wasPublished = old.status === "published";
  Object.assign(old, next);
  const name = loreTitle(old);
  return { notes: [old.status === "published" && !wasPublished ? `资料「${name}」已保存并发布：玩家看得到了。`
    : old.status === "published" ? `资料「${name}」已保存${changed ? "，玩家看到的跟着更新" : ""}。` : `资料「${name}」已保存（草稿，玩家看不到）。`] };
}
/** 发布 / 撤回为草稿 */
function loreSetStatus(id, status) {
  const e = loreMustGet(id);
  if (!Object.hasOwn(LORE_STATUS, status)) throw new Error("只能在草稿和已发布之间切换");
  e.status = status;
  return { notes: [status === "published" ? `发布资料「${loreTitle(e)}」：玩家看得到了。` : `资料「${loreTitle(e)}」撤回为草稿：玩家看不到了。`] };
}
function loreDelete(id) {
  const e = loreMustGet(id), list = loreList();
  list.splice(list.indexOf(e), 1);
  return { notes: [`删除资料「${loreTitle(e)}」。`] };
}
/** 往前 / 往后挪一格（玩家看到的顺序也一样） */
function loreMove(id, dir) {
  const list = loreList(), i = list.indexOf(loreMustGet(id)), j = i + (dir < 0 ? -1 : 1);
  if (j >= 0 && j < list.length) list.splice(j, 0, list.splice(i, 1)[0]);
  return { notes: [] };
}

/* ---------- 给玩家的（房主按这两样发，online-view.js 再按白名单过一遍） ---------- */
/** 只留表里登记的字段 */
function lorePublicFields(e) {
  const out = {};
  LORE_TYPES[e.type].fields.forEach(f => { if (e.fields[f.key]) out[f.key] = e.fields[f.key]; });
  return out;
}
/** 每个包都带的索引：已发布、认得类型的条目，不带详细内容（more = 有没有详细内容） */
function lorePublicIndex() {
  return loreList().filter(e => e.status === "published" && Object.hasOwn(LORE_TYPES, e.type))
    .map(e => Object.assign({ id: e.id, type: e.type, fields: lorePublicFields(e), rev: e.rev }, e.body ? { more: true } : {}));
}
/** 玩家点开一条时要的详细内容：草稿、没有这条、认不得的类型一律 null（不告诉玩家有没有这条草稿） */
function lorePublicEntry(id) {
  const e = typeof id === "string" ? loreById(id) : null;
  if (!e || e.status !== "published" || !Object.hasOwn(LORE_TYPES, e.type)) return null;
  return { id: e.id, type: e.type, fields: lorePublicFields(e), body: e.body, rev: e.rev };
}

const LoreCommands = (() => {
  const handlers = {
    create: c => loreCreate(c.entryType),
    save: c => loreSave(c.entry, c.status),
    status: c => loreSetStatus(c.id, c.status),
    delete: c => loreDelete(c.id),
    move: c => loreMove(c.id, Number(c.dir) || 1)
  };
  const api = { execute, actions: Object.keys(handlers), onChange: null };
  function execute(c) {
    if (!Object.hasOwn(handlers, c.action)) throw new Error("Unknown lore action: " + c.action);
    const value = handlers[c.action](c);
    // 改完的钩子（online-game.js 设：写进跑团存档）。在这条指令的执行里调用：联机时还在热座的执行里，写空位不会被等着回应的询问挡住
    if (typeof api.onChange === "function") api.onChange(c);
    return value;
  }
  // 联机玩家画面也加载这个文件（只为了读 LORE_TYPES 的字段名）；没有指令边界的页面不注册
  if (typeof Commands !== "undefined") Commands.register("lore", execute, { domain: "lore" });
  return api;
})();
