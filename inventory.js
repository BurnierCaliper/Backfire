/* 背包 / 工坊共用的数据层（只有数据和规则，不画界面）。
 *
 *   工坊和背包都从这里读：同一份背包数量、同一套分类、同一个「配方差什么」的判断。
 *   分类（INVENTORY_TABS）：materials 材料 / consumables 消耗品 / parts 武器与改装件 / cyberware 义体。
 *   个人与公用：联机单局里物品归属记在 run.online.owned[角色 kit][物品 id]（online-rogue.js），
 *   背包总数减去所有人名下的就是公用的。单机没有归属，全部算公用。
 *   这里不存任何东西：不改存档格式，只按现有字段（state.bag、run.online.owned、h.weaponParts、h.cyber）算。
 */

const INVENTORY_TABS = [
  { id: "materials", name: "材料" },
  { id: "consumables", name: "消耗品" },
  { id: "parts", name: "武器与改装件" },
  { id: "cyberware", name: "义体" }
];

/** 物品属于哪一类：材料（制作材料、武器升级材料）/ 改装件和图纸 / 其余都是消耗品。不认识的 id → null */
function inventoryCategory(id) {
  const spec = (typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {})[id];
  if (!spec) return null;
  if (spec.material) return "materials";
  if (spec.part || spec.blueprint) return "parts";
  return "consumables";
}

const invItemName = id => (((typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {})[id]) || {}).name || id;
const invCountFn = have => typeof have === "function" ? id => Math.max(0, Number(have(id)) || 0)
  : id => Math.max(0, Number((have || {})[id]) || 0);

/** 反查：哪些配方用到这种材料 → [{ id, name, need, kind, prof, diff }]（按配方表顺序） */
function recipesUsing(materialId) {
  if (typeof CRAFT_RECIPES === "undefined") return [];
  return Object.keys(CRAFT_RECIPES).filter(id => CRAFT_RECIPES[id][materialId] > 0).map(id => {
    const it = (typeof EFFECT_ITEMS !== "undefined" ? EFFECT_ITEMS : []).find(x => x.id === id) || {};
    return { id, name: it.name || invItemName(id), need: CRAFT_RECIPES[id][materialId], kind: it.kind || "", prof: it.prof || "", diff: it.diff || "" };
  });
}

/** 一张配方材料够不够。have = { 物品 id: 数量 } 或 id => 数量。
 *  opt.payable：可以用奎支补的材料（默认 ["mat_metal"]，单局里金属按参考价付钱），这些不算 missing，记在 payable 里。
 *  → { id, name, craftable, need: [{ item, name, need, have }], missing: [{ item, name, need, have }], payable: [{ item, name, short }] }
 *  craftable 这里只看材料；地点、会不会、熟练项由 Rogue.recipeStatus 再判断。不认识的配方 → null */
function recipeCheck(recipeId, have, opt) {
  const rc = typeof CRAFT_RECIPES !== "undefined" ? CRAFT_RECIPES[recipeId] : null;
  if (!rc) return null;
  const count = invCountFn(have);
  const payable = (opt && Array.isArray(opt.payable)) ? opt.payable : ["mat_metal"];
  const need = Object.keys(rc).map(item => ({ item, name: invItemName(item), need: rc[item], have: count(item) }));
  const missing = need.filter(m => m.have < m.need && !payable.includes(m.item));
  const pay = need.filter(m => m.have < m.need && payable.includes(m.item)).map(m => ({ item: m.item, name: m.name, short: m.need - m.have }));
  return { id: recipeId, name: invItemName(recipeId), craftable: !missing.length, need, missing, payable: pay };
}

/** 背包总表 → 分类、分公用 / 个人。
 *  counts：{ 物品 id: 背包里的总数 }
 *  opt.owned：{ 角色 kit: { 物品 id: 名下数量 } }（联机单局的 run.online.owned；单机不传 → 全部公用）
 *  opt.kits：看的人能看的角色（只给这些角色出个人部分；不传 = 全部角色）
 *  opt.heroes：[{ kit, name, installed: [{ weapon, weaponName, slot, part, name }], blueprints: [...], cyber }]（装在身上的东西，只读）
 *  → { tabs, shared: { materials, consumables, parts }, personal: [{ kit, name, consumables, parts, installed, blueprints, cyberware }],
 *      usable: { kit: { 物品 id: 自己的 + 公用的 } }, sharedCounts: { 物品 id: 公用数量 } }
 *  行 Row = { id, name, hint, qty, category, uses?: [配方]（只有材料带） } */
function buildInventory(counts, opt) {
  opt = opt || {};
  counts = counts || {};
  const owned = opt.owned || {};
  const heroes = Array.isArray(opt.heroes) ? opt.heroes : [];
  const kits = Array.isArray(opt.kits) ? opt.kits : heroes.map(h => h.kit).concat(Object.keys(owned).filter(k => !heroes.some(h => h.kit === k)));
  const cat = typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {};
  const ownedTotal = id => Object.values(owned).reduce((s, m) => s + Math.max(0, Number((m || {})[id]) || 0), 0);
  const sharedCounts = {};
  Object.keys(counts).forEach(id => {
    const n = Math.max(0, (Number(counts[id]) || 0) - ownedTotal(id));
    if (n > 0 && cat[id]) sharedCounts[id] = n;
  });
  const row = (id, qty) => {
    const category = inventoryCategory(id);
    const r = { id, name: invItemName(id), hint: (cat[id] || {}).hint || "", qty, category };
    if (category === "materials") r.uses = recipesUsing(id);
    return r;
  };
  const group = (map) => {
    const g = { materials: [], consumables: [], parts: [] };
    Object.keys(map).forEach(id => { const c = inventoryCategory(id); if (c && g[c] && map[id] > 0) g[c].push(row(id, map[id])); });
    return g;
  };
  const shared = group(sharedCounts);
  const usable = {};
  const personal = kits.map(kit => {
    const mine = {};
    Object.keys(owned[kit] || {}).forEach(id => {
      // 名下的不超过背包里实际有的
      const n = Math.min(Math.max(0, Number(owned[kit][id]) || 0), Math.max(0, Number(counts[id]) || 0));
      if (n > 0 && cat[id]) mine[id] = n;
    });
    const u = Object.assign({}, sharedCounts);
    Object.keys(mine).forEach(id => { u[id] = (u[id] || 0) + mine[id]; });
    usable[kit] = u;
    const g = group(mine);
    const h = heroes.find(x => x.kit === kit) || {};
    return { kit, name: h.name || kit, consumables: g.consumables, parts: g.parts, materials: g.materials,
      installed: (h.installed || []).slice(), blueprints: (h.blueprints || []).slice(), cyberware: h.cyber || null };
  });
  return { tabs: INVENTORY_TABS.map(t => Object.assign({}, t)), shared, personal, usable, sharedCounts };
}
