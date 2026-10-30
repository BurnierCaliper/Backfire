/* 角鳞 · 跑团模式：探索环节的规则（界面在 trpg-ui.js）
 *
 * 跑团模式一切按原手册：正常经验曲线、敌人按手册逐个掉落、物价与武器升级按手册，
 * 坚毅生命对主持人可见。战斗环节就是战斗画面；探索环节里主持人手动操作：
 * 买东西、推进时间、短休 / 长休、升级武器、用道具、发经验、分配属性点。
 *
 * 所有操作都作用在场上的队伍（state.units）和队伍档案（LEDGER、背包、奎支）上，
 * 做完调用 trpgSave（由界面传进来，存到战斗原型的「队伍记忆」里），下一场战斗照这个状态开打。
 * 每个函数返回写给日志的几行文字。 */

const TRPG = {
  active: false,
  lastRest: null,    // 最近一次长休的结算（ledger.js · restReport）
  camp: null,        // 营地（长休前）：{ plan, force, status: ledger.js · campStatus }；联机玩家也看到
  taskBattle: null,  // 正在打的任务战斗 { id, index }（trpg-tasks.js）；联机房主的房间检查点带着它（trpg-ui.js · TrpgFlow.onlineCheckpoint）
  clinicOpen: false, // 诊所向联机玩家开放（玩家可以申请义体改造），主持人在「诊所」页开关
  smithOpen: false,  // 工匠向联机玩家开放（玩家给自己的武器升级，加工费从这名角色的钱包出），主持人在「武器升级」页开关
  workshopOpen: false, // 工坊向联机玩家开放（玩家给自己制作 / 拆解），主持人在「工坊」页开关
  cyberRequests: []  // 联机玩家的改造申请：[{ id, kit, plan, by, byName, status: pending / done / denied, note }]
};

function trpgHeroes() {
  return typeof partyHeroes === "function" ? partyHeroes() : [];
}

/* ---------- 商店 ---------- */
function trpgShopRow(key) {
  return HANDBOOK_SHOP.find(r => r.key === key) || null;
}
function trpgShopName(row) {
  if (!row) return "";
  if (row.name) return row.name;
  const it = row.give && row.give.item && ITEM_CATALOG[row.give.item];
  return it ? it.name : row.key;
}
/** 买 qty 份。free：主持人直接给，不扣钱 */
function trpgBuy(key, qty, free) {
  const row = trpgShopRow(key);
  qty = Math.max(1, Math.floor(Number(qty) || 1));
  if (!row) return ["没有这件商品。"];
  const cost = Math.round(row.price * qty * (typeof featHaggleMul === "function" ? featHaggleMul(trpgHeroes(), 1) : 1));   // 巧手匠人：八折
  if (!free && (Number(state.kuizhi) || 0) < cost) return [`奎支不够：${trpgShopName(row)} ×${qty} 要 ${cost}，手里只有 ${Number(state.kuizhi) || 0}。`];
  if (!free) state.kuizhi = (Number(state.kuizhi) || 0) - cost;
  if (row.give.water) setLedgerWater(ledgerWater() + row.give.water * qty);
  if (row.give.item) bagAdd(row.give.item, qty);
  const out = [`${free ? "主持人给予" : "买下"} ${trpgShopName(row)} ×${qty}${free ? "" : `，花掉 ${cost} 奎支（剩 ${state.kuizhi}）`}。`];
  if (!free) trpgEarnPoints(cost, out);
  return out;
}

/* ---------- 工坊（docs/workshop-design.md 第 5–7 节）----------
 * 配方、商店积分记在队伍账上（LEDGER.workshop），跟着存档空位走。
 * 制作检定照常由玩家掷：主持人可以让程序掷，也可以直接记下玩家掷出的结果；难度可以改。地点不强制，主持人按剧情判断。 */
function trpgWorkshop() {
  if (!LEDGER.workshop) LEDGER.workshop = { recipes: [], points: 0, carry: 0 };
  return LEDGER.workshop;
}
function trpgEarnPoints(spent, out) {
  const per = typeof ROGUE_SHOP_POINTS !== "undefined" ? Number(ROGUE_SHOP_POINTS.per) || 0 : 0;
  if (!per || !(spent > 0)) return;
  const w = trpgWorkshop();
  const total = w.carry + spent, got = Math.floor(total / per);
  w.carry = total - got * per;
  w.points += got;
  if (got && out) out.push(`商店积分 +${got} → ${w.points}。`);
}
function trpgPointsInfo() {
  const w = trpgWorkshop(), per = typeof ROGUE_SHOP_POINTS !== "undefined" ? Number(ROGUE_SHOP_POINTS.per) || 0 : 0;
  return { points: w.points, carry: w.carry, per, next: per ? per - w.carry : 0 };
}
function trpgAdjustPoints(n, why) {
  n = Math.floor(Number(n) || 0);
  if (!n) return [];
  const w = trpgWorkshop();
  w.points = Math.max(0, w.points + n);
  return [`商店积分 ${n > 0 ? "+" : ""}${n}${why ? "（" + why + "）" : ""}，现有 ${w.points}。`];
}
function trpgRedeem(itemId) {
  const it = EFFECT_ITEMS.find(x => x.id === itemId && x.points > 0);
  if (!it) return ["这件东西不能用积分兑换。"];
  const w = trpgWorkshop();
  if (w.points < it.points) return [`积分不够：${it.name} 要 ${it.points}，现有 ${w.points}。`];
  w.points -= it.points;
  bagAdd(it.id, 1);
  return [`用 ${it.points} 积分兑换 ${it.name}（剩 ${w.points} 积分）。`];
}
function trpgKnowsRecipe(id) {
  const it = craftItem(id);
  return !!it && (CRAFT_RULES.knownDiffs.includes(it.diff) || trpgWorkshop().recipes.includes(id));
}
/** 主持人教会 / 收回一张配方 */
function trpgTeachRecipe(id, on) {
  const it = craftItem(id);
  if (!it) return ["没有这个配方。"];
  const w = trpgWorkshop();
  w.recipes = w.recipes.filter(x => x !== id);
  if (on !== false) w.recipes.push(id);
  return [on !== false ? `学会了${it.name}的配方（${ROGUE_CHECKS.diffs[it.diff].name} · ${it.prof}）。` : `收回${it.name}的配方。`];
}
function trpgProfLevel(u, prof) {
  const p = heroProfile(u.kit), profs = (p && p.profs) || {};
  let level = Math.min(PROF_MAX, Number(profs[profName(prof)] || profs[prof]) || 0);
  if (!level && typeof featHas === "function" && featHas(u, "polymath")) level = 1;
  return level;
}
/** 成功率：diff 不给时按配方的难度（主持人可以改）；helper 有对应熟练项就给优势 */
function trpgCraftOdds(kit, itemId, diff, helper) {
  const it = craftItem(itemId), u = trpgHeroes().find(h => h.kit === kit);
  if (!it || !u) return null;
  if (u.dead) return null;   // 死亡角色不能制作（主持人复活后才能做）
  diff = ROGUE_CHECKS.diffs[diff] ? diff : it.diff;
  const level = trpgProfLevel(u, it.prof);
  const hp = (u.layers || []).reduce((a, l) => a + (Number(l.current) || 0), 0), max = (u.layers || []).reduce((a, l) => a + (Number(l.max) || 0), 0);
  const perks = checkPerksFor(u.kit, it.prof, hp * 2 < max);
  const hu = helper && helper !== kit ? trpgHeroes().find(h => h.kit === helper) : null;
  const helped = !!(hu && !hu.dead &&trpgProfLevel(hu, it.prof) > 0);
  const adv = !!perks.adv || helped, dis = !!perks.dis && !adv;
  const base = ROGUE_CHECKS.chance[level][["easy", "normal", "hard", "extreme"].indexOf(diff)] || 0;
  let chance = adv ? 1 - (1 - base) * (1 - base) : dis ? base * base : base;
  if (perks.reroll) chance = 1 - (1 - chance) * (1 - chance);
  return { kit, item: it.id, name: u.name, prof: it.prof, diff, diffName: ROGUE_CHECKS.diffs[diff].name, level, base, chance: base ? chance : 0,
    adv, dis, reroll: !!perks.reroll, helped, hours: CRAFT_RULES.hours[diff] };
}
/** 制作一样：c = { kit, item, diff?, helper?, result: "roll"（程序掷）/ "ok" / "fail"（记下玩家掷的结果）}。材料要背包里有实物（金属也是）。
 *  同时做好几样：c = { jobs: [上面那种…] }，大家一起开工，时间只推进一次、按最久的那件算（设计文档：休息时大家同时各做各的） */
function trpgCraft(c) {
  c = c || {};
  if (Array.isArray(c.jobs)) {
    const out = [], busy = new Set();
    let hours = 0;
    const nameOf = (kit) => (trpgHeroes().find(h => h.kit === kit) || {}).name || kit;
    c.jobs.filter(Boolean).forEach(j => {
      // 设计文档第 5 节：打下手的人这段时间不能做自己的东西；做东西的人和打下手的人都算忙，同一个人同一段时间只做一件事
      if (busy.has(j.kit)) { out.push(`${nameOf(j.kit)} 同时只能做一样东西。`); return; }
      if (j.helper && busy.has(j.helper)) { out.push(`${nameOf(j.helper)} 已经在忙了。`); return; }
      if (j.helper && j.helper === j.kit) { out.push(`${nameOf(j.kit)} 不能给自己打下手。`); return; }
      busy.add(j.kit);
      if (j.helper) busy.add(j.helper);
      const r = trpgCraftOne(j);
      out.push(...r.notes);
      hours = Math.max(hours, r.hours);
    });
    return out.concat(trpgPassHours(hours));
  }
  const r = trpgCraftOne(c);
  return r.notes.concat(trpgPassHours(r.hours));
}
/** 做一样但不推进时间：返回 { notes, hours }（没做成 hours 为 0） */
function trpgCraftOne(c) {
  const it = craftItem(c.item);
  if (!it) return { notes: ["没有这个配方。"], hours: 0 };
  if (!trpgKnowsRecipe(it.id)) return { notes: [`还不会做${it.name}（在工坊页教会配方）。`], hours: 0 };
  const o = trpgCraftOdds(c.kit, it.id, c.diff, c.helper);
  if (!o) {
    const d = trpgHero(c.kit);
    return { notes: [d && d.dead ? `${d.name} 已死亡，不能制作。` : "没有这名角色。"], hours: 0 };
  }
  const hd = c.helper ? trpgHero(c.helper) : null;
  if (hd && hd.dead) return { notes: [`${hd.name} 已死亡，不能打下手。`], hours: 0 };
  const rc = CRAFT_RECIPES[it.id];
  const lack = Object.keys(rc).filter(id => bagCount(id) < rc[id]);
  if (lack.length) return { notes: ["材料不够：" + lack.map(id => `${ITEM_CATALOG[id].name} 差 ${rc[id] - bagCount(id)}`).join("，") + "。"], hours: 0 };
  let ok, rollText = "";
  if (c.result === "ok" || c.result === "fail") ok = c.result === "ok";
  else {
    if (!o.base) return { notes: [`${o.name} 没有「${it.prof}」熟练，做不了${o.diffName}的东西。`], hours: 0 };
    const r = typeof Hotseat !== "undefined" ? Hotseat.rollCheck({ base: o.base, adv: o.adv, dis: o.dis, reroll: o.reroll }) : { ok: Math.random() < o.chance, rolls: [] };
    ok = r.ok;
    rollText = r.rolls.length ? `d100 ${r.rolls.map(x => x.roll == null ? x.label : (x.label ? x.label + " " : "") + x.roll).join("，")} → ` : "";
  }
  const spend = ok ? rc : craftFailLoss(rc);
  Object.keys(spend).forEach(id => bagAdd(id, -spend[id]));
  const used = Object.keys(spend).map(id => `${ITEM_CATALOG[id].name}×${spend[id]}`).join("、") || "无";
  const helperName = o.helped ? `（${(trpgHeroes().find(h => h.kit === c.helper) || {}).name} 打下手）` : "";
  const out = [`${o.name}${helperName} 制作${it.name}（${o.diffName} · 成功率 ${Math.round(o.chance * 1000) / 10}%）：${rollText}${ok ? "成功" : "失败"}。` +
    (ok ? `用掉 ${used}。` : `损失 ${used}，壳体留着。`)];
  if (ok) bagAdd(it.id, 1);
  return { notes: out, hours: o.hours };
}
function trpgSalvage(itemId) {
  const y = salvageYield(itemId);
  if (!y) return ["这件东西拆不了。"];
  if (bagCount(itemId) < 1) return ["背包里没有这件东西。"];
  bagAdd(itemId, -1);
  Object.keys(y).forEach(id => bagAdd(id, y[id]));
  return [`拆掉 ${ITEM_CATALOG[itemId].name}：拿回 ${Object.keys(y).map(id => `${ITEM_CATALOG[id].name}×${y[id]}`).join("、")}。`];
}
/* ---------- 联机玩家的武器升级 / 工坊（规则同主持人面板，入口在 online-ui.js；联机由房主结算，hotseat-game.js）----------
 * 主持人开了「工匠 / 工坊向联机玩家开放」玩家才能用；只能动自己操控的角色；钱从这名角色自己的钱包出。
 * 发给玩家的包里只有材料数量、价格、成功率这类公开数字，没有坚毅生命。 */
/** 联机包 / 界面：{ kit, name, purse, weapons: [{ kit, name, lv, next, max, canSelf, enough, fee, mats }] } */
function trpgSmithPacket(kit) {
  const u = trpgHero(kit);
  if (!u) return null;
  const weapons = (u.linkedKits || []).map(k => {
    const info = trpgUpgradeInfo(u, k);
    return { kit: k, name: typeof weaponName === "function" ? weaponName(k) : k, lv: info.lv, next: info.next, max: !!info.max, canSelf: !!info.canSelf,
      enough: !!info.enough, fee: info.max ? 0 : trpgSmithFee(info), mats: info.mats.map(m => ({ name: m.name, need: m.need, have: m.have })) };
  });
  return { kit, name: u.name, purse: trpgPurse(kit), weapons };
}
/** 玩家升级武器：mode self（工作站，≤ 4 级，只耗材料）/ smith（找工匠，材料 + 参考加工费，费用从这名角色的钱包出）；失败抛错，不扣钱 */
function trpgSmithUpgrade(kit, weaponKit, mode) {
  if (!TRPG.smithOpen) throw new Error("工匠现在没开");
  if (mode !== "self" && mode !== "smith") throw new Error("不认识的升级方式");
  const u = trpgHero(kit);
  if (!u) throw new Error("没有这名角色");
  if (u.dead) throw new Error(`${u.name} 已死亡`);
  if (!(u.linkedKits || []).includes(weaponKit)) throw new Error("这不是你的武器");
  const before = trpgWeaponLevel(u, weaponKit);
  const notes = mode === "smith" ? trpgPayWith(kit, () => trpgUpgradeWeapon(kit, weaponKit, "smith")) : trpgUpgradeWeapon(kit, weaponKit, "self");
  if (trpgWeaponLevel(u, weaponKit) === before) throw new Error(notes[0] || "升不了");
  return notes;
}
/** 联机包 / 界面：{ kit, name, recipes: [{ id, name, prof, diff, diffName, hours, known, level, chance, mats }], salvage: [{ id, name, qty, yields }], points } */
function trpgWorkshopPacket(kit) {
  const u = trpgHero(kit);
  if (!u) return null;
  const recipes = EFFECT_ITEMS.filter(it => CRAFT_RECIPES[it.id]).map(it => {
    const rc = CRAFT_RECIPES[it.id], o = trpgCraftOdds(kit, it.id, null, null);
    return { id: it.id, name: it.name, prof: it.prof, diff: it.diff, diffName: ROGUE_CHECKS.diffs[it.diff].name, hours: CRAFT_RULES.hours[it.diff],
      known: trpgKnowsRecipe(it.id), level: o ? o.level : 0, chance: o ? Math.round(o.chance * 1000) / 10 : 0,
      mats: Object.keys(rc).map(id => ({ id, name: ITEM_CATALOG[id].name, need: rc[id], have: bagCount(id) })) };
  });
  const salvage = bagList().filter(x => salvageYield(x.id)).map(x => {
    const y = salvageYield(x.id);
    return { id: x.id, name: x.name, qty: x.qty, yields: Object.keys(y).map(id => `${ITEM_CATALOG[id].name}×${y[id]}`).join("、") };
  });
  return { kit, name: u.name, recipes, salvage, points: trpgPointsInfo().points };
}
/** 玩家制作：程序掷骰，难度按配方，可以让队友打下手；配方要主持人教会才行。成功率 / 材料不够这类失败抛错，不推进时间 */
function trpgWorkshopCraft(kit, item, helper) {
  if (!TRPG.workshopOpen) throw new Error("工坊现在没开");
  const it = craftItem(item);
  if (!it) throw new Error("没有这个配方");
  if (!trpgKnowsRecipe(it.id)) throw new Error(`还不会做${it.name}，要主持人教会配方`);
  const r = trpgCraftOne({ kit, item: it.id, helper: helper || null, result: "roll" });
  if (!r.hours) throw new Error(r.notes[0] || "做不了");
  return r.notes.concat(trpgPassHours(r.hours));
}
/** 玩家拆解背包里的东西（不花时间、不花钱） */
function trpgWorkshopSalvage(kit, itemId) {
  if (!TRPG.workshopOpen) throw new Error("工坊现在没开");
  const u = trpgHero(kit);
  if (!u || u.dead) throw new Error("没有这名角色");
  const notes = trpgSalvage(itemId);
  if (!/^拆掉/.test(notes[0] || "")) throw new Error(notes[0] || "拆不了");
  return notes;
}
/** 背包里的东西 ±n（丢弃、剧情里拿走 / 得到） */
function trpgAdjustItem(id, n) {
  const spec = ITEM_CATALOG[id];
  if (!spec) return ["没有这个物品。"];
  const have = bagCount(id);
  const d = Math.max(-have, Math.floor(Number(n) || 0));
  if (!d) return [];
  bagAdd(id, d);
  return [`${spec.name} ${d > 0 ? "+" : ""}${d}（现有 ${bagCount(id)}）。`];
}
function trpgAdjustKuizhi(n, why) {
  n = Math.floor(Number(n) || 0);
  if (!n) return [];
  state.kuizhi = Math.max(0, (Number(state.kuizhi) || 0) + n);
  return [`奎支 ${n > 0 ? "+" : ""}${n}${why ? "（" + why + "）" : ""}，现有 ${state.kuizhi}。`];
}
/* ---------- 私人钱包 ----------
 * 每名角色一个钱包（LEDGER.purse，跟着跑团存档走）；state.kuizhi 是队伍公账（战斗掉落、主持人加减的钱进这里）。
 * 任务的奎支报酬自动平分进还活着的角色的钱包（个人任务只进那名角色的）；队员之间可以互相转钱，公账也能转进 / 转出。
 * 买东西、升级武器、改装、制作……主持人可以选「由谁付」：选了角色就从他的钱包扣（trpg-commands.js · payer）。 */
const TRPG_PARTY_PURSE = "party";
function trpgPurseKits() { return trpgHeroes().filter(h => !h.dead).map(h => h.kit); }
function trpgPurse(kit) {
  if (kit === TRPG_PARTY_PURSE) return Math.max(0, Number(state.kuizhi) || 0);
  return Math.max(0, Math.floor(Number((LEDGER.purse || {})[kit]) || 0));
}
function trpgPurseSet(kit, n) {
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (kit === TRPG_PARTY_PURSE) { state.kuizhi = n; return; }
  LEDGER.purse = LEDGER.purse || {};
  if (n) LEDGER.purse[kit] = n; else delete LEDGER.purse[kit];
}
function trpgPurseName(kit) { return kit === TRPG_PARTY_PURSE ? "队伍公账" : (typeof trpgHeroLabel === "function" ? trpgHeroLabel(kit) : kit); }
/** 把 amount 奎支平分进 kits 的钱包（默认还活着的全队）；分不尽的零头从前面的人起每人多 1。返回日志行 */
function trpgPurseSplit(amount, kits, why) {
  amount = Math.floor(Number(amount) || 0);
  kits = (kits && kits.length ? kits : trpgPurseKits()).slice();
  if (amount <= 0) return [];
  if (!kits.length) { trpgPurseSet(TRPG_PARTY_PURSE, trpgPurse(TRPG_PARTY_PURSE) + amount); return [`${amount} 奎支${why ? "（" + why + "）" : ""}：没有能分的人，进队伍公账。`]; }
  const each = Math.floor(amount / kits.length), rest = amount - each * kits.length;
  kits.forEach((k, i) => trpgPurseSet(k, trpgPurse(k) + each + (i < rest ? 1 : 0)));
  if (kits.length === 1) return [`${amount} 奎支${why ? "（" + why + "）" : ""}进 ${trpgPurseName(kits[0])} 的钱包（现有 ${trpgPurse(kits[0])}）。`];
  return [`${amount} 奎支${why ? "（" + why + "）" : ""}平分给 ${kits.length} 人：每人 ${each}${rest ? `（零头 ${rest} 从前面的人起每人多 1）` : ""}。`];
}
/** 转钱：from / to 是角色 kit 或 "party"（队伍公账） */
function trpgPurseTransfer(from, to, amount) {
  amount = Math.floor(Number(amount) || 0);
  const ok = (k) => k === TRPG_PARTY_PURSE || trpgHeroes().some(h => h.kit === k);
  if (!ok(from) || !ok(to)) return ["没有这个钱包。"];
  if (from === to) return ["不能转给自己。"];
  if (amount <= 0) return ["转多少要大于 0。"];
  if (trpgPurse(from) < amount) return [`${trpgPurseName(from)} 只有 ${trpgPurse(from)} 奎支，不够转 ${amount}。`];
  trpgPurseSet(from, trpgPurse(from) - amount);
  trpgPurseSet(to, trpgPurse(to) + amount);
  if (typeof ledgerCapture === "function") ledgerCapture();
  return [`${trpgPurseName(from)} 转给 ${trpgPurseName(to)} ${amount} 奎支（${trpgPurseName(from)} 剩 ${trpgPurse(from)}，${trpgPurseName(to)} 现有 ${trpgPurse(to)}）。`];
}
/** 用某名角色的钱包付这次操作的钱：把他的钱包换成 state.kuizhi 跑一遍，跑完写回（公账原样还回去） */
function trpgPayWith(payer, fn) {
  if (!payer || payer === TRPG_PARTY_PURSE) return fn();
  if (!trpgHeroes().some(h => h.kit === payer)) return ["没有这名角色。"];
  const pool = Number(state.kuizhi) || 0;
  const start = trpgPurse(payer);
  state.kuizhi = start;
  try {
    const out = fn();
    trpgPurseSet(payer, state.kuizhi);
    // 没花钱（维修 / 制作 / 教配方这类不收钱的操作，或者操作失败）就不写「由谁付」
    if (Array.isArray(out) && trpgPurse(payer) !== start) out.push(`（由 ${trpgPurseName(payer)} 付，钱包剩 ${trpgPurse(payer)}）`);
    return out;
  } finally { state.kuizhi = pool; }
}
/* ---------- 黑市赌命桌（#489 · counter-cards-guess.js 的赌命版，界面 counter-cards-guess-ui.js · startLife）：主持人当庄 ----------
 * 赌命桌每一手结算后，账（CounterCardsGuess.lifeBill：押输了几点、奖品）交到这里：押输的点数从这名角色的坚毅里扣；
 * 扣光 = 坚毅耗尽，真正死亡（状态记成死亡，和后台改成「死亡」一样）。赢的奎支进这名角色的钱包（这一手死了就进队伍公账），材料进背包。
 * 押坚毅永远能下：上桌、押注都不看还剩多少坚毅。返回记录的几行字，不带坚毅数值（不写扣了多少、还剩多少；主持人在角色卡上照样看得到坚毅）。
 * 联机开着房间时不开（#489：联机对赌不开，入口在 counter-cards-guess-ui.js · blackMarketHtml 就收起来了）。 */
function trpgBlackMarketSettle(kit, bill) {
  const u = trpgHeroes().find(h => h.kit === kit);
  if (!u) return ["没有这名角色。"];
  if (u.dead) return [`${u.name} 已经死亡，不能上赌命桌。`];
  bill = bill || {};
  const lost = Math.max(0, Math.floor(Number(bill.lost) || 0));
  const prize = bill.prize || {};
  const notes = [];
  if (lost > 0) {
    u.shp = Math.max(0, (Number(u.shp) || 0) - lost);
    if (u.shp <= 0) {
      u.dead = true; u.dying = false; u.upOnShp = false;
      notes.push(`${u.name} 在黑市赌命桌押输了：坚毅耗尽，永久死亡。`);
    } else notes.push(`${u.name} 在黑市赌命桌押输了：坚毅受创。`);
  }
  const kz = Math.max(0, Math.floor(Number(prize.kuizhi) || 0));
  const to = u.dead ? TRPG_PARTY_PURSE : kit;
  if (kz) trpgPurseSet(to, trpgPurse(to) + kz);
  const got = (prize.items || []).filter(x => x && ITEM_CATALOG[x.id] && Math.floor(Number(x.n)) > 0);
  got.forEach(x => bagAdd(x.id, Math.floor(Number(x.n))));
  if (kz || got.length) {
    const what = [kz ? kz + " 奎支" : ""].concat(got.map(x => `${ITEM_CATALOG[x.id].name} ×${Math.floor(Number(x.n))}`)).filter(Boolean).join("、");
    notes.push(`${u.name} 在黑市赌命桌赢得 ${what}${kz ? `（奎支进${to === TRPG_PARTY_PURSE ? "队伍公账" : ` ${trpgPurseName(to)} 的钱包`}）` : ""}。`);
  }
  if (typeof ledgerCapture === "function") ledgerCapture();
  return notes.length ? notes : [`${u.name} 在黑市赌命桌这一手没押。`];
}
/* ---------- 赌场（#487）：跑团里去赌场，和庄家打 High Flux ----------
 * 钱的规则在 casino.js（筹码钱包、200 奎支买 1 枚 / 1 枚卖 190、入场费、离桌结算），牌局在 counter-cards.js。
 * 记在 LEDGER.casino，跟着跑团存档走：{ wallets, tables, seq }
 *   wallets.party = 这个存档自己的钱包（本机跑团：主持人在「赌场」页带着大家玩，庄家是 AI）；
 *   wallets[角色 kit] = 联机玩家各自的钱包（按操控的角色记：换了房间、玩家 id 变了也认得）；
 *   tables = 联机玩家对赌的桌子（两边的钱包都坐在同一张桌子上，牌局只存一份）；seq = 对赌桌编号。
 * 买筹码由谁付、卖筹码的钱进谁的钱包：队伍公账或某名角色的私人钱包（trpgPurse；联机玩家只能用自己角色的）。
 * 赌场桌（AI / 主持人坐庄）打到一半的牌局在钱包里（seat.game）。 */
const TRPG_CASINO_LOCAL = "party";
function trpgCasinoBook() {
  if (typeof Casino === "undefined") throw new Error("没有加载赌场（casino.js）");
  const c = LEDGER.casino && typeof LEDGER.casino === "object" && !Array.isArray(LEDGER.casino) ? LEDGER.casino : {};
  if (!c.wallets || typeof c.wallets !== "object") c.wallets = {};
  if (!c.tables || typeof c.tables !== "object") c.tables = {};
  c.seq = Math.max(0, Math.floor(Number(c.seq) || 0));
  LEDGER.casino = c;
  return c;
}
function trpgCasinoWallet(key) {
  const c = trpgCasinoBook(), k = key || TRPG_CASINO_LOCAL;
  c.wallets[k] = Casino.wallet(c.wallets[k]);
  return c.wallets[k];
}
/** 付钱 / 收钱的钱包：队伍公账或还活着的角色 */
function trpgCasinoPurse(who) {
  const p = who || TRPG_PARTY_PURSE;
  if (p !== TRPG_PARTY_PURSE && !trpgHeroes().some(h => h.kit === p && !h.dead)) throw new Error("没有这个钱包");
  return p;
}
/** 进赌场：第一次来送赠送筹码（每个钱包只送一次）。返回日志行 */
function trpgCasinoOpen(key) { return Casino.welcome(trpgCasinoWallet(key)).map(t => "赌场：" + t); }
/** 界面用：钱包（按枚）、能卖几枚、付钱那个钱包的奎支、桌子、兑换价、坐着的这一局 */
function trpgCasinoView(key, payer) {
  const w = trpgCasinoWallet(key);
  return { chips: Casino.chips(w), sellable: Casino.sellable(w), kuizhi: trpgPurse(payer || TRPG_PARTY_PURSE), tables: Casino.tables(),
    buy: Casino.CONFIG.buy, sell: Casino.CONFIG.sell, game: w.seat ? w.seat.game : null };
}
function trpgCasinoBuy(n, payer, key) {
  const w = trpgCasinoWallet(key), p = trpgCasinoPurse(payer);
  const r = Casino.buy(w, n, trpgPurse(p));
  trpgPurseSet(p, trpgPurse(p) - r.cost);
  return [`赌场：${r.text.replace(/。$/, "")}（由 ${trpgPurseName(p)} 付）。`];
}
function trpgCasinoSell(n, payee, key) {
  const w = trpgCasinoWallet(key), p = trpgCasinoPurse(payee);
  const r = Casino.sell(w, n);
  trpgPurseSet(p, trpgPurse(p) + r.gain);
  return [`赌场：${r.text.replace(/。$/, "")}（进 ${trpgPurseName(p)}）。`];
}
/** 坐上一张赌场桌开一局（先收入场费）；opt：dealer（"ai" / "gm"）、deck（测试用） */
function trpgCasinoSit(table, buyIn, key, opt) {
  const w = trpgCasinoWallet(key);
  Casino.sit(w, table, buyIn, { dealer: opt && opt.dealer, deck: opt && opt.deck });
  return [`赌场：坐上${w.seat.name}，买入 ${w.seat.buyIn} 枚，交入场费 ${w.seat.fee} 枚（不退）。`];
}
/** 离桌：赌场桌桌上剩下的筹码按倍率回钱包（打到一半离桌，已经押进底池的不退）；
 *  对赌桌：还没开局的退回押的；开了局以后有人离桌，这一桌就结束了——打到一半离桌的算认输（和弃牌一样，底池归对方），两边一起结算 */
function trpgCasinoLeave(key) {
  const w = trpgCasinoWallet(key), s = w.seat;
  if (!s || s.kind !== "pvp") { const text = Casino.leave(w).text; w.last = text; return ["赌场：" + text]; }
  const c = trpgCasinoBook(), t = c.tables[s.table];
  if (!t) { w.seat = null; return ["赌场：这一桌已经没有了。"]; }
  const leaver = t.game && !t.game.over ? s.side : null, notes = [];
  const settle = (side) => {
    const who = t.seats[side];
    if (!who) return;
    const ww = trpgCasinoWallet(who), r = Casino.pvpSettle(t, side, ww, leaver);
    if (r.kuizhi) trpgPurseSet(who, trpgPurse(who) + r.kuizhi);   // 押奎支：桌上剩下的按 1 枚 200 奎支回钱包（还不上的借款扣到 0 为止）
    ww.last = r.text;
    notes.push(`赌场：${trpgPurseName(who)}${leaver === side ? "离桌认输，" : ""}${r.text}`);
  };
  settle(s.side);
  if (t.game) settle(s.side === "dealer" ? "player" : "dealer");
  if (!t.seats.dealer && !t.seats.player) delete c.tables[t.id];
  return notes;
}

/* ---------- 赌场 · 联机（hotseat-game.js 的 casino 指令；谁能动哪个钱包在那边查）---------- */
/** 联机浮层（casino-online-ui.js）现在只画得出 High Flux 的牌局：Flux Duel / Flux Hold'em 的赌场桌（#488）先只在本机开
 *  （长线养成、本机跑团），联机包里不放、联机也坐不上 */
const TRPG_CASINO_ONLINE_GAMES = ["highflux"];
const trpgCasinoOnlineTables = () => Casino.tables().filter(t => TRPG_CASINO_ONLINE_GAMES.indexOf(t.game || "highflux") >= 0);
/** kit 这名角色坐着的牌局：{ kind: "ai" | "gm" | "pvp", side（人坐哪一方）, game（对赌还没开局是 null）, table, level（AI 庄家的难度）} 或 null */
function trpgCasinoSeatOf(kit) {
  const c = LEDGER.casino && typeof LEDGER.casino === "object" ? LEDGER.casino : {};   // 只读：联机包每一包都要看，不往存档里加东西
  const w = c.wallets && c.wallets[kit] ? Casino.wallet(c.wallets[kit]) : null, s = w && w.seat;
  if (!s) return null;
  if (s.kind === "pvp") { const t = c.tables && c.tables[s.table]; return t ? { kind: "pvp", side: s.side, game: t.game, table: t } : null; }
  const cfg = Casino.tables().find(x => x.id === s.table) || {};
  return { kind: s.kind, side: "player", game: s.game, table: cfg, level: cfg.difficulty || "normal" };
}
/** 牌局里走一步：kit 坐着的那一局、他那一方（opt.asDealer：主持人替主持人坐庄的那一桌出庄家那一方）。
 *  AI 当庄的桌子接着让 AI 走到轮到人；主持人坐庄的桌子等主持人 */
function trpgCasinoAct(kit, action, opt) {
  const seat = trpgCasinoSeatOf(kit);
  if (!seat) throw new Error("没坐在桌上");
  if (!seat.game) throw new Error("对手还没坐下，还没开局");
  let side = seat.side;
  if (opt && opt.asDealer) {
    if (seat.kind !== "gm") throw new Error("这一桌不是主持人坐庄");
    side = "dealer";
  }
  CounterCards.act(seat.game, side, action);
  if (seat.kind === "ai") Casino.runAi(seat.game, seat.level);
  return [];
}
/** 坐上赌场桌（opt.dealer = "ai" / "gm"）；AI 坐庄的先走到轮到人。联机只有 High Flux 的桌子（TRPG_CASINO_ONLINE_GAMES） */
function trpgCasinoSitAt(kit, table, buyIn, opt) {
  const t = Casino.tables().find(x => x.id === table);
  if (t && !trpgCasinoOnlineTables().some(x => x.id === table)) throw new Error(`联机赌场暂时只有 ${CounterCards.CC_CONFIG.name} 的桌子：${t.gameName} 先在本机（长线养成、本机跑团）玩`);
  const notes = trpgCasinoSit(table, buyIn, kit, opt);
  const seat = trpgCasinoSeatOf(kit);
  if (seat && seat.kind === "ai") Casino.runAi(seat.game, seat.level);
  return notes;
}
/** 开一张对赌桌：kit 先坐 side 那一方，押筹码（只能押普通筹码）或押奎支（从这名角色的钱包扣） */
function trpgCasinoPvpOpen(kit, side, stakeKind, opt) {
  const c = trpgCasinoBook(), w = trpgCasinoWallet(kit);
  const t = Casino.pvpTable("t" + (c.seq + 1), stakeKind);
  const pay = Casino.pvpSit(t, side, kit, w, trpgPurse(kit), opt);
  if (pay) trpgPurseSet(kit, trpgPurse(kit) - pay);
  c.seq += 1;
  c.tables[t.id] = t;
  return [`赌场：${trpgPurseName(kit)} 开了一桌对赌（坐${CounterCards.sideName(side)}，${stakeKind === "chips" ? "押筹码" : "押奎支"}），等对手坐下。`];
}
/** 坐上别人开的对赌桌（空着的那一方），两边都坐下就开局 */
function trpgCasinoPvpJoin(kit, tableId, opt) {
  const c = trpgCasinoBook(), t = c.tables[tableId];
  if (!t) throw new Error("没有这一桌");
  const side = !t.seats.dealer ? "dealer" : !t.seats.player ? "player" : null;
  if (!side || t.game) throw new Error("这一桌已经满了");
  const pay = Casino.pvpSit(t, side, kit, trpgCasinoWallet(kit), trpgPurse(kit), opt);
  if (pay) trpgPurseSet(kit, trpgPurse(kit) - pay);
  return [`赌场：${trpgPurseName(kit)} 坐上了对赌桌（${CounterCards.sideName(side)}），开局。`];
}
/** 联机包：这个人能看到的赌场（hotseat-game.js · getViewFor 按收件人造，online-view.js · projectCasino 再按白名单拷）。
 *  kits = 他操控的角色；isGM = 主持人。只读，不往存档里加东西。
 *   - 人人都有：桌子（倍率、最低买入、入场费）、兑换价、等人坐的对赌桌（谁开的、押什么、空着哪一方）；
 *   - mine：自己每名角色的钱包（筹码、能卖几枚、角色钱包里的奎支、上一局的结算）和坐着的那一局——只有自己这一方的 view
 *     （CounterCards.view：对方的手牌、暗出 / 暗弃的牌、庄家偷看到的天气都不在里面）；
 *   - 主持人另有 dealing：主持人坐庄的那几桌（庄家那一方的 view）；seated：谁坐在哪桌、第几轮（公开的，没有牌）。
 *   别人的钱包、别人那一方的 view 都不放。 */
function trpgCasinoPacket(kits, isGM) {
  if (typeof Casino === "undefined" || typeof CounterCards === "undefined") return null;
  const raw = LEDGER.casino && typeof LEDGER.casino === "object" ? LEDGER.casino : {};
  const wallets = raw.wallets && typeof raw.wallets === "object" ? raw.wallets : {}, tables = raw.tables && typeof raw.tables === "object" ? raw.tables : {};
  const nameOf = (k) => (k ? trpgPurseName(k) : null);
  const meta = (kit, seat) => {
    if (seat.kind === "pvp") {
      const t = seat.table, opp = t.seats[seat.side === "dealer" ? "player" : "dealer"];
      return { kind: "pvp", table: t.id, stakeKind: t.stakeKind, start: t.start, opponent: nameOf(opp) };
    }
    return { kind: seat.kind, table: seat.table.id, tableName: seat.table.name, rate: seat.table.rate, buyIn: seat.game.casino.buyIn, fee: seat.table.entryFee, level: seat.level };
  };
  const out = {
    config: { buy: Casino.CONFIG.buy, sell: Casino.CONFIG.sell, face: Casino.CONFIG.face, gift: Casino.CONFIG.gift },
    tables: trpgCasinoOnlineTables(),
    open: Object.keys(tables).map(k => tables[k]).filter(t => t && !t.game).map(t => ({ id: t.id, stakeKind: t.stakeKind, start: t.start, dealer: nameOf(t.seats.dealer), player: nameOf(t.seats.player) })),
    mine: [], dealing: [], seated: []
  };
  (kits || []).forEach(kit => {
    const w = Casino.wallet(JSON.parse(JSON.stringify(wallets[kit] || null)));   // 拷一份看：没来过赌场的角色不往存档里加钱包
    const seat = trpgCasinoSeatOf(kit);
    const row = { kit, name: nameOf(kit), purse: trpgPurse(kit), chips: Casino.chips(w), sellable: Casino.sellable(w), last: typeof w.last === "string" ? w.last : "" };
    if (seat) row.seat = Object.assign(meta(kit, seat), { side: seat.side, game: seat.game ? CounterCards.view(seat.game, seat.side) : null });
    out.mine.push(row);
  });
  if (isGM) Object.keys(wallets).forEach(kit => {
    if (kit === TRPG_CASINO_LOCAL) return;
    const seat = trpgCasinoSeatOf(kit);
    if (!seat || (seat.kind === "pvp" && seat.side !== "player")) return;   // 对赌桌只列一次（按坐玩家那一方的人）
    const m = meta(kit, seat), g = seat.game;
    out.seated.push(Object.assign({ kit, name: nameOf(kit), round: g ? g.round : 0, over: !!(g && g.over) }, m));
    if (seat.kind === "gm" && g) out.dealing.push(Object.assign({ kit, name: nameOf(kit), game: CounterCards.view(g, "dealer") }, m));
  });
  return out;
}
/* ---------- 诊所：义体改造（规则和单局一样：growth.js · cyberPlanError / cyberLayersFor，价格 ROGUE_CLINIC.cyberPerHp）----------
 * 方案记在角色身上（u.cyberPlan），跟着跑团存档走（game.js · packHero）；升级后按方案重建血量层。
 * 主持人在「诊所」页直接改（可以选由谁付）；联机玩家在诊所开放时提交申请，主持人同意后才改，钱从那名角色的钱包出。 */
function trpgHero(kit) { return trpgHeroes().find(h => h.kit === kit) || null; }
/** 没改造时的肉体上限（和 applyLevelStats 一样算） */
function trpgFleshMax(u) {
  if (u.growth && !u.attrs) return (u.baseHp || 14) + (u.growth.hp || 0) * Math.max(0, (u.level || 1) - 1);
  return u.attrs ? derivedFromAttrs(u.attrs, u.level).hp : ((u.layers || []).reduce((s, l) => s + (Number(l.max) || 0), 0));
}
function trpgCyberPlan(p) {
  p = p || {};
  return { armor: Math.floor(Number(p.armor) || 0), shield: Math.floor(Number(p.shield) || 0), sand: Math.floor(Number(p.sand) || 0), spirit: !!p.spirit };
}
/** { fleshMax, rate, limit, current, perHp } */
function trpgCyberInfo(kit) {
  const u = trpgHero(kit);
  if (!u) return null;
  const fleshMax = trpgFleshMax(u) - (u.cyberware && u.cyberware.length && typeof cyberwareHpCut === "function" ? cyberwareHpCut(u) : 0);
  const rate = u.cyberware && u.cyberware.length && typeof cyberwareLayerRateFor === "function" ? cyberwareLayerRateFor(u, fleshMax) : cyberRateOf(u.attrs, u.level);   // 和义体共用改造率
  return { kit, name: u.name, fleshMax, rate, limit: cyberConvertLimit(fleshMax, rate), current: trpgCyberPlan(u.cyberPlan), perHp: ROGUE_CLINIC.cyberPerHp };
}
/** 改造预览：{ error, cost, layers（从外到内） } —— 动了多少点肉体（加减都算），换成 / 换回星灵按被换的肉体点数算 */
function trpgCyberPreview(kit, plan) {
  const info = trpgCyberInfo(kit);
  if (!info) return { error: "没有这名角色", cost: 0, layers: [] };
  const p = trpgCyberPlan(plan), a = info.current;
  const error = cyberPlanError(p, info.fleshMax, info.rate);
  if (error) return Object.assign({ error, cost: 0, layers: [] }, info);
  let pts = CYBER_OUTER.reduce((s, t) => s + Math.abs(p[t] - a[t]), 0);
  if (a.spirit !== p.spirit) pts += info.fleshMax - CYBER_OUTER.reduce((s, t) => s + p[t], 0);
  return Object.assign({ error: null, cost: pts * info.perHp, layers: cyberLayersFor(info.fleshMax, p) }, info);
}
/** 做改造：扣钱（state.kuizhi —— 由谁付由 trpgPayWith 换好），按方案重建血量层；伤势照旧带着（缺的先从外层扣，最内层至少留 1）。
 *  free：主持人直接改，不收钱 */
function trpgModifyHero(kit, plan, free) {
  const u = trpgHero(kit);
  if (!u) return ["没有这名角色。"];
  const pv = trpgCyberPreview(kit, plan);
  if (pv.error) return [pv.error + "。"];
  if (!pv.cost) return ["方案没有变化。"];
  if (!free && (Number(state.kuizhi) || 0) < pv.cost) return [`奎支不够：改造要 ${pv.cost}，只有 ${Number(state.kuizhi) || 0}。`];
  if (!free) state.kuizhi -= pv.cost;
  const before = (u.layers || []).reduce((s, l) => s + (Number(l.current) || 0), 0);
  const beforeMax = (u.layers || []).reduce((s, l) => s + (Number(l.max) || 0), 0);
  let missing = Math.max(0, beforeMax - before);
  const p = trpgCyberPlan(plan);
  u.cyberPlan = (p.armor || p.shield || p.sand || p.spirit) ? p : null;
  u.layers = pv.layers.map((l, i) => ({ type: l.type, current: l.max, max: l.max, inner: i === pv.layers.length - 1 }));
  u.layers.forEach((l, i) => {
    const keep = i === u.layers.length - 1 ? 1 : 0;
    const take = Math.min(missing, Math.max(0, l.current - keep));
    l.current -= take; missing -= take;
  });
  if (typeof ledgerCapture === "function") ledgerCapture();
  const text = pv.layers.map(l => `${LAYER[l.type] || l.type} ${l.max}`).join(" / ");
  return [`义体改造：${u.name} 完成改造（${text}）${free ? "，主持人免费安排" : `，花掉 ${pv.cost} 奎支`}。`];
}
/** 改造成功了吗（失败时规则函数返回一句说明） */
function trpgModifyOk(notes) { return /^义体改造：/.test((notes || [])[0] || ""); }

/* 联机玩家的改造申请（主持人同意 / 拒绝） */
function trpgCyberRequest(kit, plan, by, byName) {
  if (!TRPG.clinicOpen) return { error: "诊所现在没开" };
  const pv = trpgCyberPreview(kit, plan);
  if (pv.error) return { error: pv.error };
  if (!pv.cost) return { error: "方案没有变化" };
  if (trpgPurse(kit) < pv.cost) return { error: `钱包里的钱不够：要 ${pv.cost}，只有 ${trpgPurse(kit)}` };
  TRPG.cyberRequests = (TRPG.cyberRequests || []).filter(r => !(r.kit === kit && r.status === "pending")).slice(-20);
  const r = { id: "cy" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), kit, plan: trpgCyberPlan(plan), by, byName: String(byName || "").slice(0, 30), status: "pending", cost: pv.cost, note: "" };
  TRPG.cyberRequests.push(r);
  return { request: r };
}
function trpgCyberDecide(id, ok) {
  const r = (TRPG.cyberRequests || []).find(x => x.id === id && x.status === "pending");
  if (!r) return ["没有这条申请（可能已经处理过了）。"];
  const name = (trpgHero(r.kit) || {}).name || r.kit;
  if (!ok) { r.status = "denied"; return [`拒绝了 ${name} 的义体改造申请。`]; }
  const notes = trpgPayWith(r.kit, () => trpgModifyHero(r.kit, r.plan, false));
  r.status = trpgModifyOk(notes) ? "done" : "denied";
  r.note = r.status === "done" ? "" : String(notes[0] || "").slice(0, 80);
  return notes;
}
/* ---------- 诊所：义体（cyberware.js）——和单局一样：装 / 拆从这名角色自己的钱包出；联机由房主结算 ---------- */
/** 联机包 / 界面：{ kit, name, purse, view, shop, previews }（没有坚毅数值） */
function trpgCyberwarePacket(kit) {
  const u = trpgHero(kit);
  if (!u || typeof cyberwarePacket !== "function") return null;
  const previews = {};
  cyberwareCatalog().forEach(d => { previews[d.id] = cyberwareInstallPreview(u, d.id); });
  return Object.assign(cyberwarePacket(u), { kit, name: u.name, purse: trpgPurse(kit), previews });
}
function trpgCyberwareAct(kit, id, remove) {
  if (!TRPG.clinicOpen) throw new Error("诊所现在没开");
  const u = trpgHero(kit);
  if (!u) throw new Error("没有这名角色");
  let pv = null, cost = 0;
  const name = (cyberwareDef(id) || {}).name || id;
  const notes = trpgPayWith(kit, () => {
    const purse = { kuizhi: Number(state.kuizhi) || 0 };
    if (remove) cost = cyberwareRemove(u, id, purse).cost; else { pv = cyberwareInstall(u, id, purse); cost = pv.cost; }   // 同系列的旧义体一起拆掉（以新换旧）
    state.kuizhi = purse.kuizhi;
    return [remove ? `${u.name} 拆掉了义体「${name}」，花掉 ${cost} 奎支。` : cyberwareInstallNote(u.name, pv)];
  });
  return notes;
}
function trpgCyberwareInstall(kit, id) { return trpgCyberwareAct(kit, id, false); }
function trpgCyberwareRemove(kit, id) { return trpgCyberwareAct(kit, id, true); }
function trpgAdjustWater(ml) {
  ml = Math.floor(Number(ml) || 0);
  if (!ml) return [];
  setLedgerWater(Math.max(0, ledgerWater() + ml));
  return [`水 ${ml > 0 ? "+" : ""}${ml} ml，现有 ${ledgerWater()} ml。`];
}

/* ---------- 时间与休息（规则都在 ledger.js，照手册第五章） ----------
 * 满 80 小时力竭致死在 ledger.js · ledgerAdvance 里判（短休、消磨时间的长休推进时间也一样） */
function trpgPassHours(h) {
  const notes = [];
  h = Math.max(0, Math.floor(Number(h) || 0));
  if (!h) return notes;
  notes.push(`经过 ${h} 小时。`);
  ledgerAdvance(h, notes);
  ledgerCapture();
  return notes;
}
/** 按分钟推进（24 小时时钟） */
function trpgPassMinutes(m) {
  const notes = [];
  m = Math.max(0, Math.floor(Number(m) || 0));
  if (!m) return notes;
  notes.push(`经过 ${durationText(m / 60)}。`);
  ledgerAdvance(m / 60, notes);
  ledgerCapture();
  return notes;
}
/** 一直等到某个时刻（"21:00"）：已经过了就等到明天的这个时刻 */
function trpgPassUntil(text) {
  const target = parseClock(text);
  if (target == null) return [`看不懂时刻「${text}」，请写成 21:00 这样。`];
  let m = target - (LEDGER.clock == null ? CLOCK_START : LEDGER.clock);
  if (m <= 0) m += 1440;
  const notes = trpgPassMinutes(m);
  if (notes.length) notes[0] = `等到 ${clockText(target)}（经过 ${durationText(m / 60)}）。`;
  return notes;
}
function trpgShortRest(kits) {
  return ledgerShortRest(kits && kits.length ? kits : null, []);
}
/** plan：{ hours, food: { kit: foodId }, force } */
function trpgLongRest(plan) {
  TRPG.camp = null;
  const r = ledgerLongRest(plan || {}, []);
  // 补给不够只能硬撑（ok:false）时队员没恢复，护送 VIP 也一样不恢复
  if (r.ok !== false && typeof trpgTaskRestEscort === "function") trpgTaskRestEscort(r.notes);
  if (r.report) TRPG.lastRest = r.report;   // 长休结算画面：主持人本机弹，联机玩家收到 rest 包（online-view.js · projectRest）
  return r.notes;
}

/** 营地（issue #52）：长休前大家围着篝火坐下，看全队状态和补给；主持人点「开始长休」才真的休息 */
function trpgCampOpen(plan) {
  plan = plan || {};
  TRPG.camp = { plan: JSON.parse(JSON.stringify(plan)), force: !!plan.force, status: campStatus(plan) };
  return ["队伍在营地坐下，准备长休。"];
}
function trpgCampClose() {
  if (!TRPG.camp) return [];
  TRPG.camp = null;
  return ["先不休息，收起营地。"];
}

/* ---------- 道具 ---------- */
function trpgUseHeal(itemId, kit) { return ledgerHealItem(itemId, kit, []); }
function trpgRepair(kit) { const n = ledgerRepair(kit, []); ledgerCapture(); return n; }

/* ---------- 经验与属性点（手册第三章） ---------- */
function trpgGiveXp(kits, amount) {
  amount = Math.floor(Number(amount) || 0);
  const notes = [];
  if (!amount) return notes;
  trpgHeroes().filter(u => !u.dead && (!kits || !kits.length || kits.indexOf(u.kit) >= 0)).forEach(u => {
    const lv = u.level || 1;
    u.xp = (Number(u.xp) || 0) + amount;
    notes.push(`${u.name} 获得 ${amount} 经验。`);
    if (typeof tryLevelUp === "function" && tryLevelUp(u) && u.level > lv) {
      notes.push(`${u.name} 升到 ${u.level} 级${u.attrPoints ? `（有 ${u.attrPoints} 点属性点可分配）` : ""}。`);
    }
  });
  ledgerCapture();
  return notes;
}
function trpgSpendAttr(kit, attr) {
  const u = trpgHeroes().find(h => h.kit === kit);
  if (!u) return ["没有这个角色。"];
  if (!(Number(u.attrPoints) > 0)) return [`${u.name} 没有可分配的属性点。`];
  if (typeof ATTR_NAMES !== "undefined" && !ATTR_NAMES[attr]) return ["没有这项属性。"];
  u.attrs = Object.assign({}, u.attrs || {});
  // 手册：8 级的那一点不能加在曾经加过的同一项上
  u.attrPicks = u.attrPicks || [];
  if (u.attrPicks.length === 1 && u.attrPicks.indexOf(attr) >= 0) {   // 19 级那点（第三点）可以重复
    return ["8 级的属性点不能加在曾经加过的同一项上。"];
  }
  u.attrs[attr] = (Number(u.attrs[attr]) || 0) + 1;
  u.attrPicks.push(attr);
  u.attrPoints -= 1;
  if (typeof applyLevelStats === "function") applyLevelStats(u);
  ledgerCapture();
  const nm = typeof ATTR_NAMES !== "undefined" ? ATTR_NAMES[attr] : attr;
  return [`${u.name} ${nm} +1（现在 ${u.attrs[attr]}）。`];
}

/* ---------- 专长（feats.js）：7 / 11 / 13 / 16 级各一项，主持人在队伍页分配 ----------
 * fullId：选「兼修」时一起选要升成完整版的涉猎专长。多面手 / 万事通的熟练项照旧由主持人记在角色卡上 */
function trpgPickFeat(kit, id, fullId) {
  const u = trpgHeroes().find(h => h.kit === kit);
  if (!u) return ["没有这个角色。"];
  if (!(Number(u.featPoints) > 0)) return [`${u.name} 没有可以分配的专长。`];
  // 每个专长点按自己的来源等级判断能选哪层；用满足条件的最低一点，高等级的点留着
  const pts = featPointLevelsOf(u);
  const at = typeof featChoicesFor !== "function" ? -1 : pts.findIndex(L => featChoicesFor(u, L).indexOf(id) >= 0);
  if (at < 0) return ["这项专长现在不能选。"];
  const f = FEATS[id];
  if (id === "dualclass" && featFullOptions(u).indexOf(fullId) < 0) return ["兼修要选一张专长①–③的职责涉猎专长。"];
  u.feats = (u.feats || []).concat(id);
  if (id === "dualclass") u.featFull = (u.featFull || []).concat(fullId);
  u.featPointLevels = pts.filter((_, i) => i !== at);
  u.featPoints -= 1;
  if (typeof applyLevelStats === "function") applyLevelStats(u);
  ledgerCapture();
  const out = [`${u.name} 获得专长：${featLabel(id)}。`];
  if (id === "dualclass") out.push(`兼修：「${FEATS[fullId].name}」改成原职责技能的完整版。`);
  if (id === "versatile") out.push("多面手：三项熟练项各升一级（主持人记在角色卡上）。");
  if (id === "polymath") out.push("万事通：选一项熟练项升到三级（主持人记在角色卡上）。");
  if (f.explore) out.push("探索专长：检定、商店、休息时由主持人照卡面结算。");
  return out;
}

/* ---------- 武器升级（手册：材料 + 4 级以上找工匠付费） ---------- */
function trpgWeaponLevel(owner, kit) {
  return Number((owner.weaponLevels || {})[kit]) || 1;
}
/** 解锁客制化看的等级 = 武器等级 + 羁绊（和改装槽、被动升级一样，growth.js · weaponRewardLevel） */
function trpgBpLevel(owner, kit) {
  return typeof weaponRewardLevel === "function" ? weaponRewardLevel(owner, kit) : trpgWeaponLevel(owner, kit);
}
/** 升下一级要什么：{ next, mats: [{ key, id, name, need, have }], labor, canSelf, max } */
function trpgUpgradeInfo(owner, kit) {
  const lv = trpgWeaponLevel(owner, kit);
  const next = lv + 1;
  const U = HANDBOOK_WEAPON_UPGRADE;
  const rc = U.recipe[next];
  if (!rc) return { lv, next, max: true, mats: [], labor: 0, canSelf: false };
  const mats = Object.keys(rc.mats).map(k => ({
    key: k, id: "mat_" + k, name: HANDBOOK_MATERIALS[k].name, need: rc.mats[k], have: bagCount("mat_" + k)
  }));
  return { lv, next, max: false, mats, labor: rc.labor || 0, canSelf: next <= U.selfMaxLevel, enough: mats.every(m => m.have >= m.need) };
}
/** 找工匠升级的默认加工费：参考费用，带巧手匠人的队伍打八折（主持人另填费用则按填的） */
function trpgSmithFee(info) {
  const mul = typeof featHaggleMul === "function" ? featHaggleMul(trpgHeroes(), 1) : 1;
  return Math.round((Number(info.labor) || 0) * mul);
}
/** mode：self 自己在工作站（≤4 级，只耗材料）/ smith 找工匠（材料 + 费用）/ gm 主持人直接升（不耗） */
function trpgUpgradeWeapon(ownerKit, kit, mode, fee) {
  const owner = trpgHeroes().find(h => h.kit === ownerKit);
  if (!owner) return ["没有这个角色。"];
  const info = trpgUpgradeInfo(owner, kit);
  const wname = typeof weaponName === "function" ? weaponName(kit) : kit;
  if (info.max) return [`${wname} 已经满级。`];
  const notes = [];
  if (mode !== "gm") {
    if (mode === "self" && !info.canSelf) return [`${wname} 升 ${info.next} 级要找武器工匠，自己在工作站只能升到 ${HANDBOOK_WEAPON_UPGRADE.selfMaxLevel} 级。`];
    if (!info.enough) return [`材料不够：${info.mats.map(m => `${m.name} ${m.have}/${m.need}`).join("、")}。`];
    const pay = mode === "smith" ? Math.max(0, Math.floor(Number(fee != null ? fee : trpgSmithFee(info)) || 0)) : 0;
    if (pay > (Number(state.kuizhi) || 0)) return [`奎支不够付加工费：要 ${pay}，手里只有 ${Number(state.kuizhi) || 0}。`];
    info.mats.forEach(m => bagAdd(m.id, -m.need));
    if (pay) state.kuizhi -= pay;
    notes.push(`${mode === "smith" ? "工匠" : "在工作站"}把 ${wname} 升到 ${info.next} 级：消耗 ${info.mats.map(m => `${m.name}×${m.need}`).join("、")}${pay ? `，加工费 ${pay} 奎支` : ""}。`);
  } else {
    notes.push(`主持人把 ${wname} 升到 ${info.next} 级（不耗材料和奎支）。`);
  }
  const before = typeof LevelUp !== "undefined" ? LevelUp.snapshot(owner) : null;
  if (typeof setOwnedWeaponLevel === "function") setOwnedWeaponLevel(owner, kit, info.next);
  else { owner.weaponLevels = owner.weaponLevels || {}; owner.weaponLevels[kit] = info.next; }
  if (before) LevelUp.note("weapon", owner, before, { weapon: wname });
  trpgSyncWeaponMods();   // 升到 4 级：装着的客制化图纸开始生效
  ledgerCapture();
  return notes;
}

/* ---------- 武器改装槽（growth.js：3 级 +1 槽，7 级 +1 槽） ----------
 * free：主持人直接装，不从背包拿 */
function trpgInstallPart(ownerKit, kit, slot, part, free) {
  const owner = trpgHeroes().find(h => h.kit === ownerKit);
  const notes = installWeaponPart(owner, kit, slot, part, free);
  ledgerCapture();
  return notes;
}
/** 主持人随机生成一个改装件放进背包（grade：C / B） */
function trpgRandomPart(grade) {
  const id = rollWeaponPart({ [grade === "B" ? "B" : "C"]: 1 });
  bagAdd(weaponPartItemId(id), 1);
  ledgerCapture();
  return [`背包里多了一个改装件：${weaponPartLabel(id)}（${weaponPartText(id)}）。`];
}
function trpgRemovePart(ownerKit, kit, slot) {
  const owner = trpgHeroes().find(h => h.kit === ownerKit);
  const notes = removeWeaponPart(owner, kit, slot);
  ledgerCapture();
  return notes;
}

/* ---------- 客制化图纸（rogue-data.js · ROGUE_SMITHS 的图纸，背包物品 id 就是图纸 id） ----------
 * 装在哪把武器上记在角色身上：hero.weaponBlueprints[武器kit] = 图纸 id，一把武器一张。
 * 战斗规则读 state.weaponMods（mods.js）：每次摆队伍、装 / 拆、升降武器等级之后按队伍重算一遍。
 * 武器 4 级才解锁客制化（mods.js · BLUEPRINT_MIN_LEVEL）：不到 4 级的（旧存档、后台降级）图纸留在武器上，但不生效。 */
function trpgSyncWeaponMods() {
  const mods = {}, ids = {};
  trpgHeroes().forEach(h => Object.keys(h.weaponBlueprints || {}).forEach(k => {
    const b = typeof blueprintSpec === "function" ? blueprintSpec(h.weaponBlueprints[k]) : null;
    if (b && b.mod && trpgBpLevel(h, k) >= BLUEPRINT_MIN_LEVEL) { mods[k] = JSON.parse(JSON.stringify(b.mod)); ids[k] = b.id; }
  }));
  state.weaponMods = Object.keys(mods).length ? mods : null;
  state.weaponBlueprints = Object.keys(ids).length ? ids : null;
  if (typeof syncBpAll === "function") syncBpAll();
  // 耐久上限变小（大杀器、耐久 −N）：当前耐久跟着压下来
  if (typeof LEDGER !== "undefined" && LEDGER.dur && typeof weaponDurMax === "function") {
    Object.keys(LEDGER.dur).forEach(k => { const m = weaponDurMax(k); if (Number(LEDGER.dur[k]) > m) LEDGER.dur[k] = m; });
  }
}
/** 装图纸。fee：付给工匠的奎支（主持人按剧情定）；free：主持人直接装（不从背包拿，不收钱） */
function trpgInstallBlueprint(ownerKit, kit, bpId, fee, free) {
  const owner = trpgHeroes().find(h => h.kit === ownerKit);
  if (!owner) return ["没有这个角色。"];
  if (!(owner.linkedKits || []).includes(kit)) return ["这把武器不属于这个角色。"];
  const b = typeof blueprintSpec === "function" ? blueprintSpec(bpId) : null;
  if (!b) return ["没有这张图纸。"];
  const wname = typeof weaponName === "function" ? weaponName(kit) : kit;
  // 武器 4 级才解锁客制化（主持人手册「本版规则修订」）：主持人直接装也一样，先把武器升上去
  const lv = trpgBpLevel(owner, kit);
  if (lv < BLUEPRINT_MIN_LEVEL) return [`${wname} 的「武器等级 + 羁绊」要到 ${BLUEPRINT_MIN_LEVEL} 级才能装客制化图纸（现在 ${lv} 级）。`];
  const pay = free ? 0 : Math.max(0, Math.floor(Number(fee) || 0));
  if (!free && bagCount(bpId) < 1) return [`背包里没有图纸「${b.name}」。`];
  if (pay > (Number(state.kuizhi) || 0)) return [`奎支不够付工钱：要 ${pay}，手里只有 ${Number(state.kuizhi) || 0}。`];
  const notes = [];
  if (!free) { bagAdd(bpId, -1); if (pay) state.kuizhi -= pay; }
  owner.weaponBlueprints = owner.weaponBlueprints || {};
  const old = owner.weaponBlueprints[kit];
  if (old) { bagAdd(old, 1); notes.push(`拆下原来的图纸「${(blueprintSpec(old) || {}).name || old}」放回背包。`); }
  owner.weaponBlueprints[kit] = bpId;
  trpgSyncWeaponMods();
  notes.push(`${free ? "主持人" : "工匠"}把客制化图纸「${b.name}」装到 ${wname} 上（${b.text}）${pay ? `，工钱 ${pay} 奎支` : ""}。`);
  ledgerCapture();
  return notes;
}
function trpgRemoveBlueprint(ownerKit, kit) {
  const owner = trpgHeroes().find(h => h.kit === ownerKit);
  if (!owner) return ["没有这个角色。"];
  const id = (owner.weaponBlueprints || {})[kit];
  if (!id) return ["这把武器没有装图纸。"];
  delete owner.weaponBlueprints[kit];
  bagAdd(id, 1);
  trpgSyncWeaponMods();
  ledgerCapture();
  return [`拆下 ${typeof weaponName === "function" ? weaponName(kit) : kit} 上的图纸「${(blueprintSpec(id) || {}).name || id}」，放回背包。`];
}

/* ---------- 后台：主持人按叙事直接改数值（不走规则） ----------
 * edit = {
 *   day, hours, kuizhi, water,
 *   heroes: { kit: { status: "ok"|"up"|"dying"|"dead", layers: [当前值…], shp, level, xp, attrPoints,
 *                    attrs: { str… }, shortUsed, weapons: { 武器kit: { level, dur, heal } } } }
 * }
 * 没写的项不动。返回改了什么（写进探索记录）。 */
const TRPG_STATUS = { ok: "正常", up: "起身中", dying: "濒死", dead: "死亡" };
function trpgHeroStatus(u) {
  return u.dead ? "dead" : u.dying ? "dying" : u.upOnShp ? "up" : "ok";
}
function trpgBackstageApply(edit, why) {
  edit = edit || {};
  const notes = [];
  const num = (v, lo, hi) => {
    let n = Math.floor(Number(v));
    if (!isFinite(n)) return null;
    if (lo != null) n = Math.max(lo, n);
    if (hi != null) n = Math.min(hi, n);
    return n;
  };
  const change = (label, a, b) => { if (a !== b) notes.push(`${label} ${a} → ${b}`); };

  if (edit.day != null) { const v = num(edit.day, 1); if (v != null) { change("天数", LEDGER.day, v); LEDGER.day = v; } }
  if (edit.clock != null && String(edit.clock).trim() !== "") {
    const v = parseClock(edit.clock);
    if (v == null) notes.push(`时刻「${edit.clock}」看不懂，没有改（写成 21:00 这样）。`);
    else { change("时刻", clockText(LEDGER.clock), clockText(v)); LEDGER.clock = v; }
  }
  if (edit.hours != null && Math.abs(Number(edit.hours) - (Number(LEDGER.hours) || 0)) >= 0.01) { const v = num(edit.hours, 0); if (v != null) { change("距上次长休（小时）", LEDGER.hours, v); LEDGER.hours = v; } }
  if (edit.kuizhi != null) { const v = num(edit.kuizhi, 0); if (v != null) { change("奎支", Number(state.kuizhi) || 0, v); state.kuizhi = v; } }
  if (edit.water != null) { const v = num(edit.water, 0); if (v != null) { change("水（ml）", ledgerWater(), v); setLedgerWater(v); } }

  Object.keys(edit.heroes || {}).forEach(kit => {
    const u = trpgHeroes().find(h => h.kit === kit);
    const e = edit.heroes[kit];
    if (!u || !e) return;
    const n = (label, a, b) => change(`${u.name} ${label}`, a, b);
    // 等级、属性先改：会重算血量与坚毅上限。角色满级 20（以前夹到 25）；单项属性硬性上限 10
    let restat = false;
    if (e.level != null) { const v = num(e.level, 1, 20); if (v != null && v !== (u.level || 1)) { n("等级", u.level || 1, v); u.level = v; restat = true; } }
    if (e.attrs) {
      u.attrs = Object.assign({}, u.attrs || {});
      Object.keys(e.attrs).forEach(k => {
        const v = num(e.attrs[k], 1);
        const was = Number(u.attrs[k]) || 0;
        if (v != null && v !== was) { n(typeof ATTR_NAMES !== "undefined" ? ATTR_NAMES[k] || k : k, was, v); u.attrs[k] = v; restat = true; }
      });
    }
    if (restat && typeof applyLevelStats === "function") applyLevelStats(u);
    if (e.xp != null) { const v = num(e.xp, 0); if (v != null) { n("经验", Number(u.xp) || 0, v); u.xp = v; } }
    if (e.attrPoints != null) { const v = num(e.attrPoints, 0); if (v != null) { n("未分配属性点", Number(u.attrPoints) || 0, v); u.attrPoints = v; } }
    if (Array.isArray(e.layers)) {
      (u.layers || []).forEach((l, i) => {
        if (e.layers[i] == null) return;
        const v = num(e.layers[i], 0, Number(l.max) || 0);
        const was = Number(l.current) || 0;
        if (v != null && v !== was) { n(`${(typeof LAYER !== "undefined" && LAYER[l.type]) || l.type}血量`, was, v); l.current = v; }
      });
    }
    if (e.shp != null) { const v = num(e.shp, 0, Number(u.shpMax) || 0); if (v != null) { n("坚毅", Number(u.shp) || 0, v); u.shp = v; } }
    if (e.status && TRPG_STATUS[e.status]) {
      const was = trpgHeroStatus(u);
      if (was !== e.status) {
        n("状态", TRPG_STATUS[was], TRPG_STATUS[e.status]);
        u.dead = e.status === "dead";
        u.dying = e.status === "dying";
        u.upOnShp = e.status === "up";
        if (!u.dead && !u.dying && totalHpOf(u) <= 0) {
          const l = (u.layers || [])[u.layers.length - 1];
          if (l) { l.current = 1; notes.push(`${u.name} 血量 0 → 1（活着至少要有 1 点血）`); }
        }
      }
    }
    if (e.shortUsed != null) {
      const v = num(e.shortUsed, 0);
      const was = Number(LEDGER.shortUsed[kit]) || 0;
      if (v != null && v !== was) { n("今天已短休", was, v); LEDGER.shortUsed[kit] = v; }
    }
    Object.keys(e.weapons || {}).forEach(wk => {
      if ((u.linkedKits || []).indexOf(wk) < 0) return;
      const w = e.weapons[wk];
      const wn = typeof weaponName === "function" ? weaponName(wk) : wk;
      if (w.level != null) {
        const v = num(w.level, 1, HANDBOOK_WEAPON_UPGRADE.maxLevel);
        const was = trpgWeaponLevel(u, wk);
        if (v != null && v !== was) {
          change(`${wn} 等级`, was, v);
          if (typeof setOwnedWeaponLevel === "function") setOwnedWeaponLevel(u, wk, v);
          else { u.weaponLevels = u.weaponLevels || {}; u.weaponLevels[wk] = v; }
          trpgSyncWeaponMods();   // 降到 4 级以下：装着的客制化图纸不再生效；升回去又生效
        }
      }
      if (w.bond != null) {
        const v = num(w.bond, 0, typeof BOND_MAX !== "undefined" ? BOND_MAX : 5);
        const was = typeof weaponBond === "function" ? weaponBond(u, wk) : 0;
        if (v != null && v !== was) {
          change(`${wn} 羁绊`, was, v);
          const ej = [];
          if (typeof setWeaponBond === "function") setWeaponBond(u, wk, v, ej);
          ej.forEach(t => notes.push(t));
        }
      }
      if (w.dur != null) {
        const v = num(w.dur, 0, weaponDurMax(wk));
        const was = weaponDur(wk);
        if (v != null && v !== was) {
          change(`${wn} 耐久`, was, v);
          LEDGER.dur[wk] = v;
          if (v > 0 && u.weaponHeld === false && !u.dead) u.weaponHeld = true;
        }
      }
      if (w.heal && LEDGER.weapons && LEDGER.weapons[wk]) {
        delete LEDGER.weapons[wk];
        notes.push(`${wn}（武器人）伤势治好`);
      }
    });
  });
  if (!notes.length) return ["后台：没有改动。"];
  ledgerCapture();
  return [`后台调整${why ? "（" + why + "）" : ""}：`].concat(notes.map(x => "· " + x + "。"));
}

/* ---------- 放弃这场战斗（没结算就回到探索环节） ----------
 * 队伍档案回到开战前存下的那一份（campaign.ledger）：耐久、「长休一次」技能的使用记录、武器人伤势……
 * 都回到开战前；奎支、物品、等级由重新摆队伍时按队伍记忆回滚（game.js · applyCampaignToField）。
 * 以前只回奎支和物品，提示却说回到开战前。返回是否回滚了 */
function trpgAbandonBattle(campaign) {
  if (!campaign || !campaign.ledger) return false;
  LEDGER.load(JSON.parse(JSON.stringify(campaign.ledger)));
  return true;
}

/* ---------- 存档：每个团一个空位 ----------
 * 空位里放：{ name, at, campaign（队伍记忆）, log（探索记录）, level（敌人等级）, enc（上次的遭遇） }
 * 玩的时候每个操作、每场战斗结算都自动写回当前空位。 */
const TRPG_SLOT_COUNT = 3;
const TRPG_SLOTS_KEY = "anterscale-trpg-slots";
let trpgSlotsTrouble = null;   // 上次读空位时发现的问题：{ backedUp }（空位文件坏了）；没问题是 null
function trpgReadSlots() {
  let raw = null;
  try { raw = localStorage.getItem(TRPG_SLOTS_KEY); } catch (e) { raw = null; }
  let arr = [];
  trpgSlotsTrouble = null;
  if (raw != null) {
    try { arr = JSON.parse(raw); } catch (e) { arr = null; }
    const ok = Array.isArray(arr) && arr.every(s => s == null || trpgValidSlot(s));
    if (!ok) {
      // 空位文件坏了（写到一半断电之类）：先原样另存一份 .broken，读得出来的团照旧留着。
      // 以前直接当成三个空位，再往随便哪个空位写一个团，另外两个就永久没了
      let backedUp = false;
      try {
        if (localStorage.getItem(TRPG_SLOTS_KEY + ".broken") !== raw) localStorage.setItem(TRPG_SLOTS_KEY + ".broken", raw);
        backedUp = true;
      } catch (e) {}
      trpgSlotsTrouble = { backedUp };
      arr = Array.isArray(arr) ? arr.map(s => (s != null && trpgValidSlot(s) ? s : null)) : [];
    }
  } else {
    // 旧版只有一份队伍记忆（anterscale-campaign）：只在空位文件从来没写过的时候搬进空位 1，搬一次就算数。
    // 以前只要三个空位都空着就再搬一次，而战斗画面一直在重写这个旧键：删掉的团会带着最近进过的团的内容回来
    try {
      const old = localStorage.getItem("anterscale-campaign");
      if (old) {
        let log = [];
        try { log = JSON.parse(localStorage.getItem("anterscale-trpg-log") || "[]"); } catch (e) {}
        arr[0] = { name: "团 1", at: Date.now(), campaign: JSON.parse(old), log, level: 1, enc: null };
      }
      while (arr.length < TRPG_SLOT_COUNT) arr.push(null);
      localStorage.setItem(TRPG_SLOTS_KEY, JSON.stringify(arr));
    } catch (e) {}
  }
  while (arr.length < TRPG_SLOT_COUNT) arr.push(null);
  return arr.slice(0, TRPG_SLOT_COUNT);
}
/** 空位文件有没有问题（界面上提醒）：null 没问题，否则是一句说明 */
function trpgSlotsProblem() {
  trpgReadSlots();
  if (!trpgSlotsTrouble) return null;
  return trpgSlotsTrouble.backedUp
    ? `存档空位的文件坏了：原来的内容已另存为 ${TRPG_SLOTS_KEY}.broken，读得出来的团照旧留着。`
    : "存档空位的文件坏了，而且没能另存备份：先不要往空位里写，以免把读不出来的团覆盖掉。";
}
function trpgWriteSlot(i, data) {
  const arr = trpgReadSlots();
  // 空位文件坏了又没能备份：不写，免得把读不出来的团当成空位覆盖掉
  if (trpgSlotsTrouble && !trpgSlotsTrouble.backedUp) return false;
  arr[i] = data ? JSON.parse(JSON.stringify(Object.assign({}, data, { at: Date.now() }))) : null;
  try { localStorage.setItem(TRPG_SLOTS_KEY, JSON.stringify(arr)); return true; } catch (e) { return false; }
}
function trpgClearSlot(i) { return trpgWriteSlot(i, null); }
/** 读进来的存档文件是否像样 */
function trpgValidSlot(s) {
  return !!(s && typeof s === "object" && (s.campaign == null || typeof s.campaign === "object") && (s.log == null || Array.isArray(s.log)));
}
/** 空位卡片上显示的摘要 */
function trpgSlotSummary(s) {
  if (!s) return null;
  const c = s.campaign || {};
  const kits = (c.partyKits && c.partyKits.length) ? c.partyKits : (c.party || []).map(p => p.kit);
  const cards = typeof livePartyCards === "function" ? livePartyCards() : [];
  const party = kits.map(k => {
    const p = (c.party || []).find(x => x.kit === k) || {};
    const card = cards.find(x => x.kit === k);
    return `${card ? card.name : k} Lv${p.level || 1}`;
  });
  return { name: s.name || "未命名", party, day: (c.ledger && c.ledger.day) || 1, kuizhi: Number(c.kuizhi) || 0, at: s.at || 0 };
}
