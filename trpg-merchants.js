/* Antlerscale: Backfire · 跑团商人（主持人设置商人、卖什么、打几折、能不能用积分兑换；开店后联机玩家同步看到商人界面，用自己的钱包买）
 *
 * 商人存在 LEDGER.merchants（跟着跑团存档走），现在开着的那家记在 LEDGER.shopOpen（商人 id，没开店是 null）。一个商人：
 *   { id, name, note 玩家看得到的一句介绍, discount 打几折（0–90，表示便宜百分之几），
 *     rows: [{ key 商品（trpg-data.js · HANDBOOK_SHOP 的 key）, price 单独定价（null = 手册价）, stock 库存（null = 不限）}],
 *     points: { on 能不能在这里用商店积分兑换, items: [能兑换的效果道具 id] } }
 * 折扣和巧手匠人（八折）不叠加，取更便宜的（feats.js · featHaggleMul）。买东西照常攒商店积分（trpg.js · trpgEarnPoints）。
 * 钱从谁的钱包出：主持人买时选「由谁付」，联机玩家只能用自己角色的钱包（hotseat-game.js · shopBuy）。 */
"use strict";

const TRPG_MERCHANT_MAX = 30;

function trpgMerchants() {
  if (!Array.isArray(LEDGER.merchants)) LEDGER.merchants = [];
  return LEDGER.merchants;
}
function trpgMerchantById(id) { return trpgMerchants().find(m => m.id === id) || null; }
function trpgMerchantOpenNow() { return LEDGER.shopOpen ? trpgMerchantById(LEDGER.shopOpen) : null; }

const mStr = (v, n) => String(v == null ? "" : v).slice(0, n);
const mNum = (v, def, lo, hi) => { const n = Math.floor(Number(v)); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
/** 整理主持人填的商人数据（商品只认手册商店里有的，兑换只认能用积分兑换的效果道具） */
function trpgMerchantNormalize(m, old) {
  m = m || {}; old = old || {};
  const seen = {};
  const rows = (Array.isArray(m.rows) ? m.rows : []).filter(r => r && trpgShopRow(r.key) && !seen[r.key] && (seen[r.key] = true)).slice(0, 200).map(r => ({
    key: r.key,
    price: r.price === "" || r.price == null ? null : mNum(r.price, null, 0, 9999999),
    stock: r.stock === "" || r.stock == null ? null : mNum(r.stock, null, 0, 9999)
  }));
  const redeemable = (typeof EFFECT_ITEMS !== "undefined" ? EFFECT_ITEMS : []).filter(x => x.points > 0).map(x => x.id);
  const p = m.points || {};
  return {
    id: old.id || mStr(m.id, 40),
    name: mStr(m.name, 30).trim() || "无名商人",
    note: mStr(m.note, 200),
    discount: mNum(m.discount, 0, 0, 90),
    rows,
    points: { on: !!p.on, items: (Array.isArray(p.items) ? p.items : []).filter(id => redeemable.includes(id)).filter((id, i, a) => a.indexOf(id) === i) }
  };
}

/* ---------- 主持人操作 ---------- */
function trpgMerchantCreate(name) {
  const list = trpgMerchants();
  if (list.length >= TRPG_MERCHANT_MAX) return [`最多 ${TRPG_MERCHANT_MAX} 个商人。`];
  const id = "m" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const m = trpgMerchantNormalize({ name: name || "新商人", rows: [] }, { id });
  list.push(m);
  return [`新商人「${m.name}」。`];
}
function trpgMerchantSave(data) {
  const old = trpgMerchantById(data && data.id);
  if (!old) return ["没有这个商人。"];
  Object.assign(old, trpgMerchantNormalize(data, old));
  return [`商人「${old.name}」已保存。`];
}
function trpgMerchantDelete(id) {
  const list = trpgMerchants(), i = list.findIndex(m => m.id === id);
  if (i < 0) return ["没有这个商人。"];
  const [m] = list.splice(i, 1);
  if (LEDGER.shopOpen === id) LEDGER.shopOpen = null;
  return [`删掉商人「${m.name}」。`];
}
/** 开店（玩家画面同步弹出商人界面）/ 关店（id = null） */
function trpgMerchantOpen(id) {
  if (!id) { const was = trpgMerchantOpenNow(); LEDGER.shopOpen = null; return [was ? `「${was.name}」收摊了。` : "现在没有开着的商店。"]; }
  const m = trpgMerchantById(id);
  if (!m) return ["没有这个商人。"];
  LEDGER.shopOpen = m.id;
  return [`「${m.name}」开张了${m.discount ? `（${trpgDiscountText(m.discount)}）` : ""}。`];
}
function trpgDiscountText(d) {
  const z = (100 - d) / 10;
  return `${Number.isInteger(z) ? z : z.toFixed(1)} 折`;
}

/* ---------- 价格 ---------- */
/** 这家店这件商品的单价：单独定价或手册价，再打折；巧手匠人八折不叠加，取更便宜的 */
function trpgMerchantPrice(m, r) {
  const row = trpgShopRow(r.key);
  const base = r.price != null ? r.price : row.price;
  const mul = typeof featHaggleMul === "function" ? featHaggleMul(trpgHeroes(), (100 - (m.discount || 0)) / 100) : (100 - (m.discount || 0)) / 100;
  return { base, unit: Math.round(base * mul) };
}

/* ---------- 买 / 兑换 ---------- */
/** 在这家店买 qty 份；payer：由谁付（角色 kit / 不写 = 队伍公账，trpg.js · trpgPayWith） */
function trpgMerchantBuy(id, key, qty, payer) {
  const m = trpgMerchantById(id);
  if (!m) return ["没有这个商人。"];
  const r = m.rows.find(x => x.key === key);
  if (!r) return [`「${m.name}」不卖这个。`];
  qty = Math.max(1, Math.min(99, Math.floor(Number(qty) || 1)));
  if (r.stock != null && r.stock < qty) return [r.stock ? `「${m.name}」只剩 ${r.stock} 份了。` : `「${m.name}」的这件卖完了。`];
  const row = trpgShopRow(key);
  const cost = trpgMerchantPrice(m, r).unit * qty;
  return trpgPayWith(payer, () => {
    if ((Number(state.kuizhi) || 0) < cost) return [`奎支不够：${trpgShopName(row)} ×${qty} 要 ${cost}，只有 ${Number(state.kuizhi) || 0}。`];
    state.kuizhi = (Number(state.kuizhi) || 0) - cost;
    if (row.give.water) setLedgerWater(ledgerWater() + row.give.water * qty);
    if (row.give.item) bagAdd(row.give.item, qty);
    if (r.stock != null) r.stock -= qty;
    const out = [`在「${m.name}」买下 ${trpgShopName(row)} ×${qty}，花掉 ${cost} 奎支。`];
    trpgEarnPoints(cost, out);
    if (typeof ledgerCapture === "function") ledgerCapture();
    return out;
  });
}
/** 在这家店用商店积分兑换（这家店开了兑换、这件在可兑换的单子里） */
function trpgMerchantRedeem(id, item) {
  const m = trpgMerchantById(id);
  if (!m) return ["没有这个商人。"];
  if (!m.points.on) return [`「${m.name}」这里不能用积分兑换。`];
  if (!m.points.items.includes(item)) return [`「${m.name}」这里换不到这件。`];
  return trpgRedeem(item);
}
/** 买 / 兑换成功了吗（失败时规则函数返回一句说明，开头不是「在」「用」） */
function trpgMerchantOk(notes) { return /^(在「|用 \d+ 积分兑换)/.test((notes || [])[0] || ""); }

/* ---------- 给玩家看的商店（联机包，online-view.js · projectShop 白名单）---------- */
function trpgMerchantView() {
  const m = trpgMerchantOpenNow();
  if (!m) return null;
  const pts = typeof trpgPointsInfo === "function" ? trpgPointsInfo() : { points: 0 };
  return {
    id: m.id, name: m.name, note: m.note, discount: m.discount,
    rows: m.rows.map(r => {
      const row = trpgShopRow(r.key), p = trpgMerchantPrice(m, r);
      const it = row.give && row.give.item && ITEM_CATALOG[row.give.item];
      return { key: r.key, name: trpgShopName(row), hint: row.note || (it && it.hint) || "", group: row.group, base: p.base, price: p.unit, stock: r.stock };
    }),
    points: m.points.on ? {
      have: pts.points,
      rows: m.points.items.map(id => EFFECT_ITEMS.find(x => x.id === id)).filter(Boolean).map(x => ({ item: x.id, name: x.name, points: x.points }))
    } : null
  };
}
