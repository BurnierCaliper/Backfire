// 单位卡上的效果图标只排一行（作者 10/20 定，unit-card.js · BADGE_ROW / orderBadges / fitBadges）：
//   · 要紧的排前面：晕眩标记、休眠 / 下潜 / 下陷、高能、蓄能，其余照 hud-icons.js · unitBadges 的顺序；
//   · 一行放不下的收进最后的「+N」，悬停「+N」写着收起的是哪些；区里挤（dense-2 / dense-3）时图标小一号；
//   · 卡片缩小、窗口变化之后重新量（以前一区 7 个敌人、每个十几个效果时，卡片缩到最小、图标排成四五行，要在区里滚动）；
//   · 首领机制画在头顶（#206），不在这一行。
// 前两条在 Node 的小 DOM（tests/mini-dom.js）里跑；画面那条用 Playwright，没装时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");
const MD = require("./mini-dom");

const ROOT = path.resolve(__dirname, "..");
const file = f => path.join(ROOT, f);

/** 小 DOM 的页面：界面图标 + 单位卡 */
function page() {
  const P = MD.create('<main id="g-field"></main>');
  const ctx = vm.createContext(P.window);
  ["icons.js", "hud-icons.js", "unit-card.js"].forEach(f => vm.runInContext(fs.readFileSync(file(f), "utf8"), ctx, { filename: f }));
  return { w: P.window, doc: P.document, UC: P.window.UnitCard, HI: P.window.HudIcons };
}
/** 一张卡的快照（字段同 game.js · snapUnit） */
const snap = (badges, extra) => Object.assign({ id: "u1", name: "狂徒", level: 3, atk: 9, isPlayer: false, layers: [{ type: "flesh", cur: 20, max: 26 }], def: 3, defMax: 3,
  ap: 2, apMax: 2, bonus: 1, bonusMax: 1, status: "", badges }, extra || {});
const keys = (box) => [...box.querySelectorAll(".hi-badge")].map(b => b.dataset.fx);

test("要紧的排前面：晕眩标记、休眠 / 下潜 / 下陷、高能、蓄能，其余照原来的顺序；顺序在配置表里", () => {
  const { UC, HI } = page();
  assert.deepEqual(Object.keys(UC.BADGE_ROW.first), ["stunMark", "dormant", "submerged", "sink", "high", "store"], "BADGE_ROW.first");
  const order = UC.orderBadges(["burn", "weak", "store", "high", "melt", "sink", "stunMark", "shock", "submerged", "dormant"].map(key => ({ key })));
  assert.deepEqual(order.map(b => b.key), ["stunMark", "sink", "submerged", "dormant", "high", "store", "burn", "weak", "melt", "shock"]);
  // 首领身上的一串（hud-icons.js · unitBadges 的顺序：晕眩标记、休眠……、灼烧、感电、高能……）：高能挪到灼烧前面
  const boss = HI.unitBadges({ isPlayer: false, stunMax: 2, stunMarks: 1, dormant: true, highEnergy: 6, statuses: { burn: 3, shock: true, high: true, weak: true } });
  assert.deepEqual([...boss].map(b => b.key), ["stunMark", "dormant", "burn", "shock", "high", "weak"], "unitBadges 原来的顺序");
  assert.deepEqual([...UC.orderBadges(boss)].map(b => b.key), ["stunMark", "dormant", "high", "burn", "shock", "weak"]);
});

test("单位卡：效果图标排在一行（.hi-badges.hi-row），按要紧的排好，最后留一个收起来的「+N」；首领机制不在这一行；内容一样不重画", () => {
  const { doc, UC, HI } = page();
  const badges = HI.unitBadges({ isPlayer: false, stunMax: 2, stunMarks: 0, highEnergy: 4, statuses: { burn: 2, shock: true, high: true }, instant: { melt: true } });
  const s = snap(badges, { status: "聚焦装甲 火→[冰] · 掩护（灯）", marks: [{ type: "execution", name: "死刑", by: "王", left: 2, phase: "enemy" }] });
  const c = UC.create(s);
  doc.getElementById("g-field").appendChild(c.wrap);
  UC.update(c, s, {});
  const box = c.unit.querySelector(".u-status"), row = box.querySelector(":scope > .hi-badges");
  assert.ok(row && row.classList.contains("hi-row"), "一行的徽章");
  assert.deepEqual(keys(row), ["stunMark", "high", "burn", "shock", "melt"], "晕眩标记、高能排前面");
  const more = row.lastElementChild;
  assert.ok(more.classList.contains("hi-more") && more.hidden, "最后一个是「+N」，放得下时藏着");
  assert.match(box.innerHTML, /<span class="chip">聚焦装甲 火→\[冰\]<\/span><span class="chip">掩护（灯）<\/span>/, "没有图标的照旧写字");
  assert.doesNotMatch(box.innerHTML, /死刑|mech/, "首领机制不在效果这一行（画在头顶）");
  assert.ok(c.mechs.querySelector(".mech-ico"), "首领机制在头顶");
  // 同一个快照再画一遍：效果这一行不重画（量好的「+N」、正在生效的动画都留着）
  const first = row;
  UC.update(c, Object.assign({}, s), {});
  assert.equal(box.querySelector(":scope > .hi-badges"), first, "没换元素");
  // 中立生物的迷你名牌：照旧只挂小标签
  const n = UC.create(snap(badges, { id: "n1", neutral: true, neutralTags: [{ key: "seen", text: "已发现" }] }));
  UC.update(n, snap(badges, { id: "n1", neutral: true, neutralTags: [{ key: "seen", text: "已发现" }] }), {});
  assert.equal(n.unit.querySelector(".u-status").innerHTML, '<span class="chip m-seen">已发现</span>');
});

test("fitBadges：一行放不下的收进「+N」——留下的都在行里，「+N」就是收起来的个数，悬停写着收起的是哪些（名字 + 层数）；放得下就不收", () => {
  const { w, doc, UC, HI } = page();
  const badges = HI.unitBadges({ isPlayer: false, stunMax: 2, stunMarks: 1, highEnergy: 5,
    statuses: { burn: 3, shock: true, corr: true, frostbite: true, shockwave: true, high: true, reso: true, unstable: true, weak: true, chase: true } });
  const s = snap(badges);
  const c = UC.create(s);
  doc.getElementById("g-field").appendChild(c.wrap);
  UC.update(c, s, {});
  const row = c.unit.querySelector(".hi-badges.hi-row"), items = [...row.querySelectorAll(".hi-badge")], more = row.querySelector(".hi-more");
  assert.equal(items.length, 11);
  // 假的排版：每个图标 22 宽、间隔 5；「+N」每个字 7 宽；行宽 150（右边内边距 6 给层数小圆标）
  items.forEach((b, i) => { Object.defineProperty(b, "offsetLeft", { configurable: true, get: () => i * 27 }); Object.defineProperty(b, "offsetWidth", { configurable: true, get: () => 22 }); });
  Object.defineProperty(more, "offsetWidth", { configurable: true, get: () => 7 * more.textContent.length });
  let rowWidth = 150;
  Object.defineProperty(row, "clientWidth", { configurable: true, get: () => rowWidth });
  w.getComputedStyle = (el) => ({ paddingRight: el === row ? "6px" : "0px", columnGap: "5px" });
  UC.fitBadges(c.wrap);
  // 能用 150 − 6 = 144；「+11」21 宽 + 间隔 5 → 图标的右边不超过 118：留 4 个（第 4 个右边 103，第 5 个 130）
  const off = () => items.filter(b => b.classList.contains("hi-off")).map(b => b.dataset.fx);
  assert.deepEqual(items.filter(b => !b.classList.contains("hi-off")).map(b => b.dataset.fx), ["stunMark", "high", "burn", "shock"], "要紧的留在前面");
  assert.equal(off().length, 7);
  assert.equal(more.hidden, false);
  assert.equal(more.textContent, "+7", "「+N」就是收起来的个数");
  assert.equal(more.title, "还有：腐蚀、冻伤、震荡、共振、不稳、紧追、虚弱");
  assert.equal(more.getAttribute("aria-label"), more.title, "读屏也念得到");
  // 层数写在名字后面
  rowWidth = 75;
  UC.fitBadges(c.wrap);
  assert.deepEqual(items.filter(b => !b.classList.contains("hi-off")).map(b => b.dataset.fx), ["stunMark"], "窄了：重新量，留得更少");
  assert.equal(more.textContent, "+10");
  assert.match(more.title, /^还有：高能 5、灼烧 3、感电、/);
  // 宽了：全放得下，「+N」藏起来
  rowWidth = 400;
  UC.fitBadges(c.wrap);
  assert.deepEqual(off(), []);
  assert.equal(more.hidden, true);
  assert.equal(more.textContent, "");
  assert.equal(more.hasAttribute("title"), false);
  // 还没画出来（宽 0）：不收
  rowWidth = 0;
  UC.fitBadges([c.wrap]);
  assert.deepEqual(off(), []);
});

/* ---------- 画面（真的 game.html，旧画面） ---------- */
function playwright() {
  try { return require("playwright"); } catch (_) { /* 没装在本地 */ }
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) { /* 也没装在全局 */ }
  return null;
}
let browser = null, skipWhy = "";
test.before(async () => {
  try {
    const pw = playwright();
    browser = pw ? await pw.chromium.launch() : await require("./cdp-browser").launch();
    if (!browser) skipWhy = "没装 Playwright，也没有能用的 Chrome，跳过画面测试";
  } catch (e) {
    if (process.env.REQUIRE_UI === "1") throw e;
    browser = null; skipWhy = "浏览器启动失败，跳过画面测试：" + String(e.message).split("\n")[0];
  }
});
test.after(async () => { if (browser) await browser.close(); });

/** 一区七个敌人（首领 + 六个手下）、每个身上十几个效果，开战 */
const PILE = () => {
  state.units.filter(u => !u.isPlayer).forEach((u, i) => {
    u.statuses = Object.assign(u.statuses || {}, { burn: 3, shock: true, corr: true, frostbite: true, shockwave: true, reso: true, unstable: true, weak: true, inspire: true, hide: true, advantage: true, chase: true, sturdy: true });
    u.instant = Object.assign(u.instant || {}, { melt: true, overload: true, shift: true });
    if (i === 1) { u.statuses.high = true; u.highEnergy = 6; }
  });
  GAME.refresh();
};
/** 战场上每一张敌人卡的徽章行：一行多高、留下 / 收起的是哪些、「+N」写什么、留下的有没有被行的边截掉、「+N」在不在行里 */
const ROWS = () => [...document.querySelectorAll("#g-field .unit-wrap .unit.foe")].map(unit => {
  const row = unit.querySelector(".u-status .hi-badges.hi-row");
  if (!row) return null;
  const r = row.getBoundingClientRect(), pad = parseFloat(getComputedStyle(row).paddingRight) || 0;
  const all = [...row.querySelectorAll(".hi-badge")], shown = all.filter(b => getComputedStyle(b).display !== "none"), off = all.filter(b => b.classList.contains("hi-off"));
  const more = row.querySelector(".hi-more"), mr = more.getBoundingClientRect();
  // 图标的大小看样式（新挂上的图标正在「生效」放大一下，量外框会量到放大的）
  const icon = shown.length ? parseFloat(getComputedStyle(shown[0].querySelector(".hi-svg")).width) : 0;
  return {
    id: unit.closest(".unit-wrap").dataset.id, h: r.height, icon, keys: all.map(b => b.dataset.fx), shown: shown.length, off: off.length,
    offNames: off.map(b => b.getAttribute("aria-label") + (b.querySelector(".hi-stack") ? " " + b.querySelector(".hi-stack").textContent : "")),
    more: more.hidden ? "" : more.textContent, title: more.getAttribute("title") || "",
    clipped: shown.filter(b => b.getBoundingClientRect().right > r.right - pad + 0.5).length, moreInside: more.hidden || (mr.right <= r.right + 0.5 && mr.left >= r.left - 0.5),
    tops: new Set(shown.map(b => Math.round(b.getBoundingClientRect().top))).size, dense: unit.closest(".g-zone").className
  };
});
/** 等量好：每一行都只有一行、留下的没被截掉、「+N」对得上收起来的个数（卡片换了宽度以后要等下一帧重新量） */
const fitted = page => page.waitForFunction(() => [...document.querySelectorAll("#g-field .unit-wrap .unit.foe .u-status .hi-badges.hi-row")].every(row => {
  const r = row.getBoundingClientRect(), pad = parseFloat(getComputedStyle(row).paddingRight) || 0, more = row.querySelector(".hi-more");
  const shown = [...row.querySelectorAll(".hi-badge")].filter(b => getComputedStyle(b).display !== "none"), off = row.querySelectorAll(".hi-badge.hi-off").length;
  return shown.every(b => b.getBoundingClientRect().right <= r.right - pad + 0.5) && new Set(shown.map(b => Math.round(b.getBoundingClientRect().top))).size <= 1 &&
    (more.hidden ? off === 0 : more.textContent === "+" + off);
}), null, { timeout: 10000 });
function checkRows(rows, tag, min) {
  assert.ok(rows.length >= 7 && rows.every(Boolean), tag + "：每张敌人卡都有一行徽章");
  rows.forEach(r => {
    const t = tag + " " + JSON.stringify(r);
    assert.equal(r.tops, 1, "只排一行：" + t);
    assert.ok(r.h < r.icon * 1.6 + 8, "行高只有一个图标那么高：" + t);
    assert.equal(r.clipped, 0, "留下的图标都在行里，没有被截掉半个：" + t);
    assert.ok(r.moreInside, "「+N」在行里：" + t);
    assert.equal(r.more, r.off ? "+" + r.off : "", "「+N」就是收起来的个数：" + t);
    assert.equal(r.title, r.off ? "还有：" + r.offNames.join("、") : "", "悬停「+N」写着收起的是哪些：" + t);
    assert.ok(r.shown >= (min == null ? 3 : min), "至少放得下三个：" + t);
  });
  assert.ok(rows.some(r => r.off > 0), tag + "：效果多的收进了 +N");
}

test("画面（单机旧画面）：一区七个敌人、每个十几个效果——图标只排一行，放不下的收进「+N」，区里挤时图标小一号，区里不用滚动；卡片缩小、窗口变了重新量", { timeout: 90000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await require("./old-screen")(context);   // #316：新画面默认开，这里测的是旧画面
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(pathToFileURL(file("game.html")).href);
  await page.waitForFunction(() => !!window.GAME && !!window.UnitCard && !!window.HudIcons);
  await page.evaluate(() => {
    window.__noLevelUpPopup = true; GAME.skip = true; GAME.instant = true;
    Screens.show("battle");
    GAME.startCustomBattle("徽章测试", () => {
      BattleSim.setup({ party: ["ruby", "yuito", "ras"], seed: "BADGE-ROW",
        enemies: [{ id: "outlaw_king", lv: 5, zone: 2 }].concat(Array.from({ length: 6 }, (_, i) => ({ id: i % 2 ? "thug_hammer" : "thug_knife", lv: 3, zone: 2 }))) });
      return {};
    });
    GAME.startOrEnd();
  });
  await page.waitForFunction(() => state.combatStarted);
  await page.evaluate(() => document.querySelectorAll(".g-intro, .intro, .battle-intro").forEach(n => n.remove()));
  await page.evaluate(PILE);
  await page.waitForTimeout(150);
  await fitted(page);
  let rows = await page.evaluate(ROWS);
  checkRows(rows, "1280×800");
  // 要紧的排前面：首领的晕眩标记、带高能的那个的高能在最前面
  const boss = await page.evaluate(() => state.units.find(u => u.kit === "outlaw_king").id);
  assert.equal(rows.find(r => r.id === boss).keys[0], "stunMark", "首领：晕眩标记排第一");
  assert.ok(rows.some(r => r.keys[0] === "high"), "高能排在灼烧前面");
  // 一行就是 unitBadges 排好以后的顺序（BADGE_ROW）
  const want = await page.evaluate(() => state.units.filter(u => !u.isPlayer).map(u => UnitCard.orderBadges(HudIcons.unitBadges(u)).map(b => b.key)));
  assert.deepEqual(rows.map(r => r.keys), want);
  // 区里放得下：七张卡都整张露在区里，不用滚动区才看得到（以前图标排成五六行，卡片伸出区的下沿七八十像素）；挤到缩小两级以上时图标小一号
  const zone = await page.evaluate(() => {
    const z = document.querySelector('#g-field .g-zone[data-num="2"]'), zr = z.getBoundingClientRect();
    return { cls: z.className, top: z.scrollTop, out: [...z.querySelectorAll(".unit-wrap")].map(w => Math.round(w.getBoundingClientRect().bottom - (zr.top + z.clientTop + z.clientHeight))).filter(d => d > 0) };
  });
  assert.deepEqual([zone.top, zone.out], [0, []], "七张敌人卡都整张露在区里：" + JSON.stringify(zone));
  const iconOf = cls => (/dense-[23]/.test(cls) ? 19 : 22);
  assert.ok(rows.every(r => Math.round(r.icon) === iconOf(r.dense)), "图标大小跟着区的疏密：" + rows.map(r => r.icon + " " + r.dense));
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "badge-row-local.png") });
  // 卡片缩小（区里又挤了，缩成最小一级）：图标小一号，重新量，照样一行、不截半个
  await page.evaluate(() => { const z = document.querySelector('#g-field .g-zone[data-num="2"]'); z.classList.remove("dense-1", "dense-2"); z.classList.add("dense-3"); });
  await page.waitForTimeout(100);
  await fitted(page);
  const narrow = await page.evaluate(ROWS);
  checkRows(narrow, "缩成 dense-3");
  assert.ok(narrow.every(r => Math.round(r.icon) === 19), "挤的区里图标小一号：" + narrow.map(r => r.icon));
  // 再窄一截（卡片 110 宽）：放得下的更少——是重新量过的，不是留着原来那几个、把后面的截掉
  await page.evaluate(() => document.querySelectorAll('#g-field .g-zone[data-num="2"] .unit.foe').forEach(u => { u.style.width = "110px"; }));
  await page.waitForTimeout(100);
  await fitted(page);
  const thin = await page.evaluate(ROWS);
  checkRows(thin, "卡片 110 宽", 1);
  assert.ok(thin.every((r, i) => r.shown < narrow[i].shown), "卡片窄了：留下的个数跟着变少：" + JSON.stringify([narrow.map(r => r.shown), thin.map(r => r.shown)]));
  await page.evaluate(() => document.querySelectorAll('#g-field .g-zone[data-num="2"] .unit.foe').forEach(u => { u.style.width = ""; }));
  // 窗口变了（变矮变窄、再变回来）：重新量
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.waitForTimeout(250);
  await fitted(page);
  rows = await page.evaluate(ROWS);
  checkRows(rows, "1100×700");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(250);
  await fitted(page);
  checkRows(await page.evaluate(ROWS), "回到 1280×800");
  // 层数变了（重画这一行）：照样重新量
  await page.evaluate(() => { state.units.filter(u => !u.isPlayer).forEach(u => { u.statuses.burn = 5; }); GAME.refresh(); });
  await page.waitForTimeout(100);
  await fitted(page);
  rows = await page.evaluate(ROWS);
  checkRows(rows, "层数变了");
  assert.ok(rows.every(r => !r.title || /灼烧 5|^还有：/.test(r.title)));
  assert.deepEqual(errors, []);
});
