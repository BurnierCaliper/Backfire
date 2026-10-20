/* 工坊 / 背包界面的数据适配层（workshop-ui.js、backpack-ui.js 只读这里）。
 * 真正的数据接口在 PR #79（rogue.js · workshopAvailable / craftListGrouped / craftPreview / bagByCategory / materialBar /
 * cyberSummary / modInstallPreview，inventory.js · itemCategory / recipesUsing，online-rogue.js · viewFor 的 craft / bag / cyber …）。
 * 这里只做两件事：
 *   1. 有接口就直接调（R(name)），没有就用旧的 craftList / craftOdds / bag 粗算一份（fallback），换接口只改这一个文件；
 *   2. 把「房主本机」和「联机玩家收到的 viewFor」统一成同一个界面模型（hostWorkshopModel / viewWorkshopModel …）。
 * 规则：数量一律读 usable / shared（不自己 bagCount）；金属能用奎支补，不算缺料；成功率只给能做的配方。 */
(function (root) {
  "use strict";
  const RG = () => (typeof Rogue !== "undefined" ? Rogue : root.Rogue) || null;
  const R = (name) => { const r = RG(); return r && typeof r[name] === "function" ? r[name] : null; };
  const G = (name) => (typeof root[name] === "function" ? root[name] : null);
  const cat = () => (typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {});
  const nameOf = id => (cat()[id] || {}).name || id;
  const hintOf = id => (cat()[id] || {}).hint || "";
  const counts0 = () => { const f = R("bagCounts"); if (f) return f(); const o = {}; ((root.state && state.bag && state.bag.items) || []).forEach(x => { o[x.id] = (o[x.id] || 0) + (Number(x.qty) || 0); }); return o; };

  /* ---------- 单项接口（有就转发，没有就粗算） ---------- */
  function workshopAvailable(run) {
    const f = R("workshopAvailable") || R("craftPlace");
    return run && f ? f(run) : null;
  }
  function itemCategory(id) {
    if (typeof root.itemCategory === "function") return root.itemCategory(id);
    if (typeof itemCategoryGlobal === "function") return itemCategoryGlobal(id);
    const s = cat()[id]; if (!s) return null;
    return s.key ? "key" : s.material ? "material" : (s.part || s.blueprint) ? "mod" : "consumable";
  }
  function recipesUsingMaterial(id) {
    const f = R("recipesUsingMaterial") || G("recipesUsing");
    if (f) return f(id);
    const rc = typeof CRAFT_RECIPES !== "undefined" ? CRAFT_RECIPES : {};
    return Object.keys(rc).filter(k => rc[k][id]).map(k => ({ id: k, name: nameOf(k), need: rc[k][id] }));
  }
  function materialBar(run, counts) {
    const f = R("materialBar");
    if (f) return f(run, counts);
    const c = counts || counts0();
    return ["cm_scrap", "cm_chem", "cm_gas", "cm_coil", "cm_cell", "cm_scale", "cm_spirit", "mat_metal"].map(id => ({ id, name: nameOf(id), hint: hintOf(id), have: Number(c[id]) || 0 }));
  }
  function craftListGrouped(run, opt) {
    const f = R("craftListGrouped");
    if (f) return f(run, opt || {});
    // fallback：旧 craftList（金属不算缺）
    opt = opt || {};
    const place = workshopAvailable(run), c = opt.counts || counts0(), out = { craftable: [], missing: [] };
    (R("craftList") ? R("craftList")(run) : []).filter(x => !opt.kind || x.kind === opt.kind).forEach(x => {
      const mats = x.mats.map(m => Object.assign({}, m, { have: Number(c[m.id]) || 0 }));
      const missing = mats.filter(m => m.id !== "mat_metal" && m.have < m.need).map(m => ({ id: m.id, need: m.need, have: m.have }));
      const canMakeHere = !!place && (place === "bench" || !x.bench);
      const row = Object.assign({}, x, { mats, missing, metalKuizhi: x.metalKuizhi || 0, affordable: true, canMakeHere });
      (x.known && canMakeHere && !missing.length ? out.craftable : out.missing).push(row);
    });
    if (opt.onlyCraftable) out.missing = [];
    return out;
  }
  function craftPreview(run, kit, item, helper, opt) {
    const f = R("craftPreview");
    if (f) return f(run, kit, item, helper || null, opt || {});
    const g = craftListGrouped(run, opt), row = g.craftable.find(x => x.id === item);
    const o = row && R("craftOdds") ? R("craftOdds")(run, kit, item, helper || null) : null;
    const ok = !!(o && o.base);
    return { id: item, kit, helper: helper || null, craftable: ok, reasons: ok ? [] : ["材料不够或不会做"], missing: row ? [] : ((g.missing.find(x => x.id === item) || {}).missing || []),
      odds: ok ? o : null, output: { id: item, name: nameOf(item), qty: 1 }, onFail: null, hours: row ? row.hours : 0, metalKuizhi: row ? row.metalKuizhi : 0 };
  }
  function bagByCategory(run, viewerKit) {
    const f = R("bagByCategory");
    if (f && run) return f(run, viewerKit);
    const shared = { material: [], consumable: [], mod: [], key: [] }, c = counts0();
    Object.keys(c).filter(id => c[id] > 0 && cat()[id]).forEach(id => {
      const k = itemCategory(id) || "consumable";
      shared[k].push({ id, name: nameOf(id), hint: hintOf(id), qty: c[id], category: k });
    });
    return { kit: viewerKit || null, shared, personal: null, usable: c };
  }
  function cyberSummary(run, kit) { const f = R("cyberSummary"); return f && run ? f(run, kit) : null; }
  function modInstallPreview(run, heroKit, weaponKit, partId, slot) {
    const f = R("modInstallPreview");
    try { return f && run ? f(run, heroKit, weaponKit, partId, slot) : null; } catch (e) { return null; }
  }

  /* ---------- 界面模型 ----------
   * WorkshopModel = { net, host, place, mats, heroes:[{kit,name}], helpers:[{kit,name}], grouped(kit), preview(kit,item,helper),
   *                   queue:[{kit,name,itemName,helperName,chance,hours}], learn:[{item,name,prof,diffName,price,smith,smithName}],
   *                   salvage:[{id,name,qty,yield}], money(kit) }
   * BackpackModel = { readOnly, inBattle, workshop(place|null), views:[{kit,name,shared,personal}], cyber:[cyberSummary], uses(id) } */
  /** 房主 / 单机（rogue-ui.js）：kits = 我能操控的角色（单机 = 全队）；money(kit) = 能花的钱 */
  function hostWorkshopModel(run, opt) {
    opt = opt || {};
    const place = workshopAvailable(run);
    const live = (run.party || []).filter(h => !h.dead);
    const heroName = k => (RG() && RG().heroName ? RG().heroName(k) : k);
    const kits = (opt.kits || live.map(h => h.kit)).filter(k => live.some(h => h.kit === k));
    const money = opt.money || (() => Number(root.state && state.kuizhi) || 0);
    const byKit = {};
    const grouped = kit => (byKit[kit] = byKit[kit] || craftListGrouped(run, { kuizhi: money(kit) }));
    return {
      net: !!opt.net, host: true, place,
      mats: materialBar(run),
      heroes: kits.map(k => ({ kit: k, name: heroName(k) })),
      helpers: live.map(h => ({ kit: h.kit, name: heroName(h.kit) })),
      grouped, preview: (kit, item, helper) => craftPreview(run, kit, item, helper, { kuizhi: money(kit) }),
      queue: opt.net && R("craftQueue") ? R("craftQueue")(run) : [],
      learn: R("learnOptions") ? R("learnOptions")(run) : [],
      salvage: R("salvageList") ? R("salvageList")() : [],
      money
    };
  }
  /** 联机玩家（online-ui.js）：r = viewFor 的 rogue 包 */
  function viewWorkshopModel(r) {
    const craft = (r && r.craft) || [];
    const place = (r && r.workshopAvailable) || null;
    const purse = kit => ((r.heroes || []).find(h => h.kit === kit) || {}).purse || 0;
    const empty = { craftable: [], missing: [] };
    return {
      net: true, host: false, place,
      mats: r.materialBar || [],
      heroes: craft.map(c => ({ kit: c.kit, name: c.name })),
      helpers: ((r.workshop && r.workshop.helpers) || []).map(h => ({ kit: h.kit, name: h.name })),
      grouped: kit => ((craft.find(c => c.kit === kit) || {}).grouped) || empty,
      preview: (kit, item, helper) => {
        const c = craft.find(x => x.kit === kit);
        const p = c && (c.previews || []).find(x => x && x.id === item);
        if (p) {
          if (!helper || !p.odds || p.odds.adv) return Object.assign({}, p, { helper: helper || null });
          // 打下手给优势：玩家端没有带帮手的预览，按同一公式估（真正结算以房主为准）
          const base = p.odds.base, adv = 1 - (1 - base) * (1 - base);
          return Object.assign({}, p, { helper, estimated: true, odds: Object.assign({}, p.odds, { adv: true, helped: true, chance: p.odds.reroll ? 1 - (1 - adv) * (1 - adv) : adv }) });
        }
        const g = c ? c.grouped : empty, row = g.craftable.concat(g.missing).find(x => x.id === item);
        return row ? { id: item, kit, helper: null, craftable: false, reasons: [], missing: row.missing || [], odds: null, output: { id: item, name: row.name, qty: 1 }, hours: row.hours, metalKuizhi: row.metalKuizhi } : null;
      },
      queue: (r.workshop && r.workshop.queue) || [],
      learn: (r.workshop && r.workshop.learn) || [],
      salvage: ((r.workshop && r.workshop.salvage) || []).map(x => Object.assign({}, x, { qty: x.have != null ? x.have : x.qty })),
      money: purse
    };
  }
  /** 房主 / 单机的背包。battle：战斗中只读（不调会重摆队伍的 cyberSummary） */
  function hostBackpackModel(run, opt) {
    opt = opt || {};
    const heroName = k => (RG() && RG().heroName ? RG().heroName(k) : k);
    const kits = run ? (opt.kits || null) : null;
    const views = kits && kits.length ? kits.map(k => Object.assign({ name: heroName(k) }, bagByCategory(run, k)))
      : [Object.assign({ name: "队伍" }, bagByCategory(run, null))];
    return {
      readOnly: !!opt.battle, inBattle: !!opt.battle,
      workshop: opt.battle ? null : workshopAvailable(run),
      views,
      cyber: run && !opt.battle ? (run.party || []).filter(h => !h.dead).map(h => cyberSummary(run, h.kit)).filter(Boolean) : [],
      uses: recipesUsingMaterial
    };
  }
  function viewBackpackModel(r, opt) {
    opt = opt || {};
    const heroes = r.heroes || [];
    const nm = k => ((heroes.find(h => h.kit === k) || {}).name) || k;
    return {
      readOnly: !!opt.battle || r.stage === "over", inBattle: !!opt.battle,
      workshop: opt.battle ? null : (r.workshopAvailable || null),
      views: (r.bag || []).map(b => Object.assign({ name: nm(b.kit) }, b)),
      cyber: r.cyber || [],
      uses: recipesUsingMaterial
    };
  }

  root.WorkshopData = {
    workshopAvailable, itemCategory, recipesUsingMaterial, materialBar, craftListGrouped, craftPreview,
    bagByCategory, cyberSummary, modInstallPreview,
    hostWorkshopModel, viewWorkshopModel, hostBackpackModel, viewBackpackModel
  };
})(typeof window !== "undefined" ? window : globalThis);
