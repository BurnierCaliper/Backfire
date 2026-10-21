/* 商店卖东西（单机单局 / 联机单局 / 跑团共用的规则层，不画界面）。
 *
 *   卖价 = 物品的标准价（物品表里的基础价，不是这家店打过折的价）× 50%，向下取整。没有标准价的不能卖。
 *   任务道具（物品表标了 key / quest）、图纸不能卖；改装件走原来的 sellPart（价格规则不变），这里不列。
 *   装在身上的要先卸下；义体在诊所拆，不算背包物品。
 *   回购：同一家店、离开之前，卖掉的东西可以按卖出价买回来，由卖的人付钱，回到原来的归属（个人 / 公用）。离店清空。
 *
 *   这里只放纯函数和回购单的数据结构；单局（rogue.js · sellItem / buybackItem / shopSellView）、
 *   跑团（本文件下半段 trpgShopSell / trpgShopBuyback / trpgShopSellView）各自接钱包。
 *   视图里只有 id / name / qty / 价格 / 归属，绝不带物品表里的其他字段（食物有 shp 坚毅数值）。 */
"use strict";

const SHOP_SELL_RATE = 0.5;
const SHOP_SELL_REASONS = ["任务道具", "图纸", "已装备", "无标准价", "改装件"];

/** 标准价（基础价）：物品表 price → 制作材料参考价 → 效果道具价 → 手册武器材料价 → 手册商店价 → 单局商店价。没有 → null */
function shopStdPrice(id) {
  const cat = typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {};
  const spec = cat[id];
  if (!spec) return null;
  const pos = v => (typeof v === "number" && isFinite(v) && v > 0 ? v : null);
  if (pos(spec.price)) return spec.price;
  const cm = (typeof CRAFT_MATERIALS !== "undefined" ? CRAFT_MATERIALS : []).find(m => m.id === id);
  if (cm) return pos(cm.price);
  const fx = (typeof EFFECT_ITEMS !== "undefined" ? EFFECT_ITEMS : []).find(x => x.id === id);
  if (fx) return pos(fx.price);
  if (spec.material && typeof HANDBOOK_MATERIALS !== "undefined" && HANDBOOK_MATERIALS[spec.material]) return pos(HANDBOOK_MATERIALS[spec.material].price);
  const row = list => (list || []).find(r => r && r.give && r.give.item === id && !r.give.water && !(r.give.qty > 1));
  const hb = row(typeof HANDBOOK_SHOP !== "undefined" ? HANDBOOK_SHOP : []);
  if (hb) return pos(hb.price);
  const rs = row(typeof ROGUE_SHOP !== "undefined" ? ROGUE_SHOP : []);
  if (rs) return pos(rs.price);
  return null;
}
/** 卖一件的价：标准价 × 50% 向下取整；没有标准价 → null */
function shopSellPrice(id) {
  const p = shopStdPrice(id);
  if (p == null) return null;
  const v = Math.floor(p * SHOP_SELL_RATE);
  return v > 0 ? v : null;
}
/** 能不能卖。ctx.equipped：这件正装在身上（数量或 true）。→ { ok, reason }，reason 见 SHOP_SELL_REASONS */
function shopSellCheck(id, ctx) {
  ctx = ctx || {};
  const spec = (typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {})[id];
  if (spec && (spec.key || spec.quest)) return { ok: false, reason: "任务道具" };
  if (spec && spec.blueprint) return { ok: false, reason: "图纸" };
  if (spec && spec.part) return { ok: false, reason: "改装件" };
  if (ctx.equipped) return { ok: false, reason: "已装备" };
  if (shopSellPrice(id) == null) return { ok: false, reason: "无标准价" };
  return { ok: true, reason: "" };
}
/** 这件要不要出现在卖出列表里（改装件另有 sellPart，不列） */
function shopSellListable(id) {
  const spec = (typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {})[id];
  return !!spec && !spec.part;
}
const shopSellName = id => (((typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {})[id]) || {}).name || id;

/* ---------- 回购单 { place, seq, list: [{ token, id, name, qty, price, owner, seller }] } ---------- */
/** 取回购单；place 变了（换了店 / 离了店）就清空 */
function shopBuybackBook(holder, key, place) {
  let b = holder[key];
  if (!b || typeof b !== "object" || b.place !== place) b = holder[key] = { place, seq: 0, list: [] };
  if (!Array.isArray(b.list)) b.list = [];
  return b;
}
function shopBuybackAdd(book, row) {
  book.seq = (Number(book.seq) || 0) + 1;
  const r = { token: `bb${book.seq}`, id: row.id, name: shopSellName(row.id), qty: row.qty, price: row.price, owner: row.owner, seller: row.seller };
  book.list.push(r);
  return r;
}
function shopBuybackPublic(r) { return { token: r.token, id: r.id, name: r.name, qty: r.qty, price: r.price, owner: r.owner, seller: r.seller }; }
/** 一行卖出列表 */
function shopSellRow(id, qty, owner, ctx) {
  const chk = shopSellCheck(id, ctx);
  return { id, name: shopSellName(id), qty, unitPrice: shopSellPrice(id), owner, ok: chk.ok, reason: chk.reason };
}
/** 卖出份数：1…持有数量 */
function shopSellQty(qty, have) {
  const n = Math.floor(Number(qty == null ? 1 : qty));
  if (!(n >= 1)) throw new Error("卖几件要是正整数");
  if (n > have) throw new Error(`只有 ${have} 件可以卖`);
  return n;
}

/* ---------- 跑团（trpg.js 钱包 / trpg-merchants.js 开着的店）：东西都是公用的，卖的钱进队伍公账 state.kuizhi ---------- */
function trpgShopSellBook() {
  const open = typeof trpgMerchantOpenNow === "function" ? trpgMerchantOpenNow() : null;
  return open ? shopBuybackBook(LEDGER, "shopSell", open.id) : null;
}
/** 离店（关店、换店）清空回购单：trpg-merchants.js · trpgMerchantOpen 调 */
function trpgShopSellReset() { if (typeof LEDGER !== "undefined") delete LEDGER.shopSell; }
/** 跑团卖出视图：{ items, buyback }；kits：看的人能回购谁卖的（不传 = 全部，主持人） */
function trpgShopSellView(kits) {
  const book = trpgShopSellBook();
  if (!book) return null;
  const items = ((ensureBag().items) || []).filter(x => (Number(x.qty) || 0) > 0 && shopSellListable(x.id))
    .map(x => shopSellRow(x.id, Number(x.qty) || 0, "shared"));
  const buyback = book.list.filter(r => !kits || kits.includes(r.seller)).map(shopBuybackPublic);
  return { items, buyback };
}
/** 卖：kit 是卖的人（角色 kit，主持人可以写 "party"）；钱进队伍公账 */
function trpgShopSell(kit, id, qty, owner) {
  const book = trpgShopSellBook();
  if (!book) throw new Error("现在没有开着的商店");
  if (owner != null && owner !== "shared") throw new Error("跑团的背包都是公用的");
  const seller = kit || TRPG_PARTY_PURSE;
  if (seller !== TRPG_PARTY_PURSE && !trpgHeroes().some(h => h.kit === seller)) throw new Error("没有这名角色");
  const chk = shopSellCheck(id);
  if (!chk.ok) throw new Error(`不能卖：${chk.reason}`);
  const n = shopSellQty(qty, bagCount(id));
  const unit = shopSellPrice(id), total = unit * n;
  bagAdd(id, -n);
  state.kuizhi = (Number(state.kuizhi) || 0) + total;
  shopBuybackAdd(book, { id, qty: n, price: total, owner: "shared", seller });
  if (typeof ledgerCapture === "function") ledgerCapture();
  const msg = `卖掉 ${shopSellName(id)} ×${n}，得 ${total} 奎支，进队伍公账（现有 ${state.kuizhi}）。`;
  return { ok: true, total, payout: [{ to: TRPG_PARTY_PURSE, amount: total }], msg };
}
/** 回购：只有卖的人能买回，按卖出价从他的钱包付（"party" = 公账），东西回到公用背包 */
function trpgShopBuyback(kit, token) {
  const book = trpgShopSellBook();
  if (!book) throw new Error("现在没有开着的商店");
  const i = book.list.findIndex(r => r.token === token);
  if (i < 0) throw new Error("回购单里没有这件");
  const r = book.list[i], payer = kit || TRPG_PARTY_PURSE;
  if (r.seller !== payer) throw new Error("只有卖掉它的人能买回来");
  if (trpgPurse(payer) < r.price) throw new Error(`钱不够：要 ${r.price}，只有 ${trpgPurse(payer)}`);
  trpgPurseSet(payer, trpgPurse(payer) - r.price);
  bagAdd(r.id, r.qty);
  book.list.splice(i, 1);
  if (typeof ledgerCapture === "function") ledgerCapture();
  const msg = `买回 ${r.name} ×${r.qty}，${trpgPurseName(payer)} 付 ${r.price} 奎支。`;
  return { ok: true, total: r.price, payout: [{ to: payer, amount: -r.price }], msg };
}
