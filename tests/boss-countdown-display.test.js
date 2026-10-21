// 首领机制的倒计时显示（#206 起改成 FF14 式）：被点名的人头上一个图标、首领头上是它正在读条的机制、踩塔在区名旁边，
// 角上的数字都是「还有 N 回合」的 N（到时写「!」）；战场正上方的横幅按剩余回合排序；铭牌上不写机制名字、不画彩色边框。
// 单位的悬停说明照样写「还有 N 回合」（到时写「本回合落下」）；信息多（首领机制 + 一长串状态）时悬停说明加宽、可以滚动，
// 挤的区里也不再把状态整行藏掉。单机（Roguelike 同一个战斗画面）和联机玩家画面都看得到；坚毅生命永远不给玩家看
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const { execSync } = require("node:child_process");
const H = require("./headless");
const ROOT = path.resolve(__dirname, "..");
const UnitCard = require("../unit-card.js"), UnitTip = require("../unit-tip.js");

/* ---------- 文字（不需要浏览器） ---------- */
test("倒计时文字：还有 N 回合 / 本回合落下；踩塔的图标和悬停说明里的首领机制都写出剩几回合", () => {
  assert.equal(UnitCard.mechLeft({ left: 3 }), "还有 3 回合");
  assert.equal(UnitCard.mechLeft({ left: 1 }), "还有 1 回合");
  assert.equal(UnitCard.mechLeft({ left: 0 }), "本回合落下");
  const lines = UnitCard.mechLines({
    marks: [{ type: "execution", name: "死刑", left: 2, by: "亡命之王", phase: "enemy" }],
    casts: [{ type: "share", name: "分担", left: 0, target: "瑞比", phase: "player" }]
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^死刑（还有 2 回合）：亡命之王 的死刑：2 回合后落下/);
  assert.match(lines[1], /^分担 → 瑞比（本回合落下）：这回合在我方回合开始时落下/);
  // 踩塔：区名旁边的图标写还有几回合，旁边写几人 / 要几人；说明里写清楚要几个人踩、踩不住会怎样
  const tw = UnitCard.towerMarkHtml([{ type: "tower", name: "踩塔", left: 2, need: 1, have: 0, by: "王", phase: "enemy", soak: 5, fail: 60 }]);
  assert.match(tw, /class="mech-ico k-zone t-tower"[^>]*data-left="2"/);
  assert.match(tw, /<b class="mi-n" aria-hidden="true">2<\/b>/);
  assert.match(tw, /<span class="zt-need short">0\/1 人<\/span>/);
  assert.match(tw, /还有 2 回合/);
  assert.match(UnitCard.towerTip({ name: "踩塔", left: 2, need: 1, by: "王", phase: "enemy", soak: 5, fail: 60 }), /至少 1 人站在这个区里踩住，每人挨 5；没人踩住，我方全员各挨 60/);
  const html = UnitTip.html({ kind: "enemy", kit: "thug_knife" }, ["灼烧×2"], { name: "王", sub: "Lv5", mechs: lines });
  assert.match(html, /首领机制 · 倒计时/);
  assert.match(html, /<b>死刑（还有 2 回合）<\/b>/);
  // 没有机制就不出这一栏
  assert.doesNotMatch(UnitTip.html({ kind: "enemy", kit: "thug_knife" }, [], { name: "王" }), /首领机制/);
});

test("规则 → 显示：首领机制倒数时 left 逐回合减少，联机投影（online-view.js）把 left 原样带给玩家，图标上的数字跟着变，不带坚毅生命", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "yuito", "ras"], enemies: [{ id: "thug_knife", lv: 5, zone: 2 }], seed: "CD-T" });
  const S = c.S.state;
  const boss = S.units.find(u => !u.isPlayer);
  boss.layers.forEach(l => { l.current = l.max = 999; });
  S.units.filter(u => u.isPlayer).forEach(u => { u.layers.forEach(l => { l.current = l.max = 500; }); u.shp = 777001; });
  c.addBossMechanic(boss, { type: "execution", turns: 3, hits: [{ flat: 1 }] });
  c.startCombat();
  const left = () => c.bossCastsBy(boss)[0].left;
  assert.equal(left(), 3);
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.equal(left(), 2, "过一回合少一回合");
  const target = S.units.find(u => u.id === boss.mechanics[0].st.targetId);
  Object.assign(globalThis, { state: S, bossMarksOn: c.bossMarksOn, bossCastsBy: c.bossCastsBy, statusLine: c.statusLine });
  try {
    delete require.cache[require.resolve("../online-view.js")];
    const OV = require("../online-view.js");
    const pb = OV.projectUnit(boss), pt = OV.projectUnit(target);
    assert.equal(JSON.stringify(pb.display.casts.map(x => [x.name, x.left, x.target])), JSON.stringify([["死刑", 2, target.name]]));
    assert.equal(JSON.stringify(pt.display.marks.map(x => [x.name, x.left])), JSON.stringify([["死刑", 2]]));
    // 悬停说明里的写法
    assert.match(UnitCard.mechLines(pt.display)[0], /^死刑（还有 2 回合）/);
    // 头顶的图标：被点名的人头上是死刑（k-mark），首领头上是正在读条的死刑（k-cast），数字都是 2
    assert.match(UnitCard.mechIconsHtml(pt.display), /class="mech-ico k-mark t-execution"[^>]*data-left="2"[\s\S]*<b class="mi-n" aria-hidden="true">2<\/b>/);
    assert.match(UnitCard.mechIconsHtml(pb.display), /class="mech-ico k-cast t-execution"[^>]*data-left="2"/);
    assert.deepEqual(UnitCard.bannerItems([Object.assign({ id: pb.id, name: pb.name }, pb.display)]).map(UnitCard.bannerText), [`死刑 → ${target.name} · 2 回合`]);
    assert.doesNotMatch(JSON.stringify([pb, pt]), /777001|"shp"/, "坚毅生命不进玩家数据");
  } finally { for (const k of ["state", "bossMarksOn", "bossCastsBy", "statusLine", "OnlineView"]) delete globalThis[k]; }
});

test("挤的区（dense-3）不再把状态 / 首领倒计时整行藏掉；资源一行不再截成省略号；悬停说明能滚动；铭牌上不再有机制的色块和彩色边框", () => {
  const css = fs.readFileSync(path.join(ROOT, "game.css"), "utf8"), tip = fs.readFileSync(path.join(ROOT, "hud-icons.css"), "utf8");
  assert.doesNotMatch(css, /\.g-zone\.dense-3 [^{]*\.u-status[^{]*\{\s*display:\s*none/);
  assert.doesNotMatch(css, /\.u-res \{[^}]*text-overflow: ellipsis/);
  assert.match(tip, /\.unit-tip \{[^}]*overflow: hidden auto/);
  assert.match(tip, /\.unit-tip\.ut-wide \.ut-effects \{ grid-template-columns: 1fr 1fr/);
  // 以前：铭牌上「死刑 · 还有 N 回合」的色块（.chip.mark-* / .cast-*），被点名时铭牌内圈一道红 / 黄 / 紫 / 橙框
  assert.doesNotMatch(css, /\.chip\.(mark|cast)-|mech-chip/);
  assert.doesNotMatch(css, /\.unit-wrap\.(doomed|shared|spread|volley|doom-now)[^{]*\.unit\b/);
  // 最后一回合的脉动、横幅的闪：系统开了「减少动态效果」就不动
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{\n  \.mech-ico\.last \.mi-svg, \.mb-row\.last, \.g-zone\.tower-ready \.ztower-ring \{ animation: none; \}/);
  assert.ok(reduced, "减少动态效果时图标、横幅、地上的圈都不动");
});

/* ---------- 画面（Playwright） ---------- */
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
}
let browser;
test.before(async () => { try { const pw = playwright(); if (!pw) throw new Error("Playwright is required"); browser = await pw.chromium.launch(); } catch (error) { if (process.env.REQUIRE_UI === "1") throw error; } });
test.after(async () => { if (browser) await browser.close(); });
async function site(t) {
  const website = http.createServer((req, res) => {
    const file = path.resolve(ROOT, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.setHeader("Content-Type", ({ ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml" })[path.extname(file)] || "application/octet-stream");
      res.end(bytes);
    });
  });
  await new Promise((resolve, reject) => { website.once("error", reject); website.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => website.close(resolve)));
  return "http://127.0.0.1:" + website.address().port;
}
/** 首领身上一长串状态 + 四种机制（踩塔、死刑、分担、远离） */
const PILE = () => {
  const boss = state.units.find(u => !u.isPlayer && !u.dead && u.mechanics);
  boss.statuses = Object.assign(boss.statuses || {}, { burn: 3, shock: true, corr: true, frostbite: true, shockwave: true, weak: true, reso: true, unstable: true, inspire: true, hide: true, advantage: true, chase: true, sturdy: true });
  boss.instant = Object.assign(boss.instant || {}, { melt: true, sting: true, overload: true, shift: true, spread: true, refract: true, doubleStatus: true, omenArmed: true });
  boss.focuses = [{ layerType: "armor", seq: ["fire", "ice", "electric"], step: 1 }];
  boss.stunMarks = 1; boss.harshEnv = true; boss.shelterTurn = 1;
  return boss.id;
};
const MECHS = [{ type: "execution", turns: 3 }, { type: "share", turns: 2 }, { type: "tower", turns: 2 }, { type: "spread", turns: 4 }];

/** 一张单位卡（.unit-wrap）上看得到的：头顶的图标（类型、数字、在不在铭牌上面、有没有被别的东西盖住）、铭牌上的字和边框 */
const CARD = w => {
  const first = w.querySelector(".u-mechs .mech-ico");
  if (first) first.scrollIntoView({ block: "nearest" });   // 区里能滚动时先把图标滚进来
  const unit = w.querySelector(".unit"), ur = unit.getBoundingClientRect();
  const probe = document.createElement("div"); probe.className = unit.className; w.parentElement.appendChild(probe);
  const plain = getComputedStyle(probe).boxShadow; probe.remove();
  return {
    icons: [...w.querySelectorAll(".u-mechs .mech-ico")].map(i => {
      const r = i.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { kind: [...i.classList].find(c => /^k-/.test(c)), type: i.dataset.mech, n: i.querySelector(".mi-n").textContent, last: i.classList.contains("last"), above: r.bottom <= ur.top + 1, seen: !!hit && i.contains(hit) };
    }),
    chips: w.querySelectorAll(".mech-chip").length, text: unit.innerText, shadow: getComputedStyle(unit).boxShadow, plain,
    shown: getComputedStyle(w.querySelector(".u-status")).display, dense: w.closest(".g-zone").className
  };
};
/** 踩塔的区：区名旁边的图标、几人 / 要几人、地上的圈；以前右上角的文字牌子没有了 */
const TOWER = z => {
  const i = z.querySelector(".zhead > .zlabel ~ .ztower-mark .mech-ico");
  return { icon: i ? { kind: [...i.classList].find(c => /^k-/.test(c)), type: i.dataset.mech, n: i.querySelector(".mi-n").textContent } : null,
    need: (z.querySelector(".ztower-mark .zt-need") || {}).textContent || "", ring: !!z.querySelector(":scope > .ztower-ring"),
    board: !!z.querySelector(".ztower"), head: z.querySelector(".zhead").innerText };
};
/** 战场正上方的横幅：每一条的机制、剩几回合、写法、颜色；在不在战场正中、有没有压到区 */
const BANNER = f => {
  const st = f.querySelector(":scope > .g-topstack"), sr = st.getBoundingClientRect(), fr = f.getBoundingClientRect();
  return { rows: [...st.querySelectorAll(".mech-bar .mb-row")].map(r => ({ type: r.dataset.mech, left: Number(r.dataset.left), last: r.classList.contains("last"), text: r.innerText.replace(/\s+/g, " ").trim(), color: getComputedStyle(r).color })),
    center: Math.abs((sr.left + sr.right) / 2 - (fr.left + fr.right) / 2), top: sr.top - fr.top, bottom: sr.bottom,
    zoneTop: Math.min(...[...f.querySelectorAll(".g-zone")].map(z => z.getBoundingClientRect().top)) };
};
function checkBanner(b) {
  assert.deepEqual(b.rows.map(r => r.type), ["share", "tower", "execution", "spread"], "剩余回合少的在上面");
  assert.ok(b.rows.every((r, i) => !i || b.rows[i - 1].left <= r.left), JSON.stringify(b.rows));
  assert.match(b.rows[0].text, /^分担 → \S+ · 2 回合$/);
  assert.match(b.rows[1].text, /^踩塔 · \d 区 · 2 回合$/);
  assert.match(b.rows[2].text, /^死刑 → \S+ · 3 回合$/);
  assert.equal(b.rows[3].text, "远离 → 全员 · 4 回合");
  assert.ok(b.rows.every(r => r.color === "rgb(227, 36, 28)" && !r.last), "红字；这几条都还没到最后一回合");
  assert.ok(b.center <= 2 && b.top < 50, "在战场正上方的中间 " + JSON.stringify(b));
  assert.ok(b.bottom <= b.zoneTop + 1, "横幅不压在区上 " + JSON.stringify(b));
}

async function checkTip(page, sel) {
  await page.hover(sel);
  await page.waitForSelector(".unit-tip.show");
  const t0 = await page.$eval(".unit-tip", t => ({ mechs: [...t.querySelectorAll(".ut-mechs li")].map(li => li.textContent), wide: t.classList.contains("ut-wide"), scroll: t.classList.contains("ut-scroll"), more: !!t.querySelector(".ut-more"), sh: t.scrollHeight, ch: t.clientHeight, bottom: t.getBoundingClientRect().bottom, text: t.textContent, visible: getComputedStyle(t).visibility }));
  assert.ok(t0.mechs.length >= 4, "悬停说明列出首领的每个机制");
  for (const name of ["死刑", "分担", "踩塔", "远离"]) assert.ok(t0.mechs.some(x => x.startsWith(name) && /还有 \d 回合/.test(x)), name + " 写出还有几回合");
  assert.ok(t0.wide && t0.scroll && t0.more, "内容多：加宽、可滚动、底下有提示 " + JSON.stringify({ ...t0, text: t0.text.slice(0, 300) }));
  assert.ok(t0.bottom <= 800, "浮窗不超出屏幕");
  assert.equal(t0.visible, "visible", "鼠标离开机制图标后，单位的说明又露出来");
  assert.doesNotMatch(t0.text, /坚毅生命/);
  await page.mouse.wheel(0, 5000);
  const t1 = await page.$eval(".unit-tip", t => ({ top: t.scrollTop, max: t.scrollHeight - t.clientHeight }));
  assert.ok(t1.top > 0 && Math.abs(t1.top - t1.max) <= 1, "鼠标停在卡上滚轮能翻到浮窗最底下");
  return t0;
}
/** 鼠标停在首领头上的死刑图标上：弹出说明（名字、剩几回合、会发生什么、怎么应对），单位的说明先让开 */
async function checkIconTip(page, sel) {
  await page.hover(sel);
  await page.waitForSelector(".mech-tip.show");
  const tip = await page.evaluate(() => {
    const t = document.querySelector(".mech-tip.show"), u = document.querySelector(".unit-tip"), r = t.getBoundingClientRect();
    return { text: t.innerText, inside: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth, unitTip: !!u && u.classList.contains("show") && getComputedStyle(u).visibility !== "hidden" };
  });
  for (const re of [/死刑 → \S+/, /还有 3 回合/, /到时在敌人回合开始时落下/, /会发生什么/, /3 回合后落下/, /怎么应对/, /协助格挡/]) assert.match(tip.text, re);
  assert.ok(tip.inside, "说明不出屏幕");
  assert.equal(tip.unitTip, false, "单位的悬停说明让开，不叠在一起");
  assert.doesNotMatch(tip.text, /坚毅生命|777001/);
}

/** 点名瞬间：记下每一次弹出（unit-card.js · popIcon 的 Web Animations，id "mech-pop"：谁头上 / 哪个区、哪种图标、什么机制）
 *  和每一次提示音（Sfx.marker 被叫了几次） */
const SPY = () => {
  window.__pops = []; window.__pings = 0;
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (frames, opts) {
    if (opts && opts.id === "mech-pop") {
      const w = this.closest(".unit-wrap"), z = this.closest(".g-zone");
      window.__pops.push({ unit: w ? w.dataset.id : null, zone: !w && z ? z.dataset.num : null, kind: [...this.classList].find(c => /^k-/.test(c)) || "", type: this.dataset.mech });
    }
    return animate.call(this, frames, opts);
  };
  const marker = Sfx.marker;
  Sfx.marker = function () { window.__pings++; return marker.apply(this, arguments); };
};
const spied = (page, from) => page.evaluate(n => ({ pops: window.__pops.slice(n || 0), pings: window.__pings, count: window.__pops.length }), from || 0);

/** 单机：Roguelike 同一个战斗画面，首领（和五个手下挤在 2 区）挂上四种机制、一长串状态，开战。opts.spy：开战前装上 SPY */
async function localBoss(page, origin, opts) {
  await page.goto(origin + "/game.html"); await page.waitForFunction(() => !!window.GAME && !!window.UnitCard);
  if (opts && opts.spy) await page.evaluate(SPY);
  await page.evaluate(MECHS => {
    GAME.skip = true; GAME.instant = true;
    Screens.show("battle");
    GAME.startCustomBattle("首领测试", () => {
      BattleSim.setup({ party: ["ruby", "yuito", "ras"], enemies: [{ id: "thug_knife", lv: 5, zone: 2 }, { id: "thug_knife", lv: 3, zone: 2 }, { id: "thug_knife", lv: 3, zone: 2 }, { id: "thug_knife", lv: 3, zone: 2 }, { id: "thug_knife", lv: 3, zone: 2 }, { id: "thug_knife", lv: 3, zone: 2 }], seed: "CD-UI" });
      const boss = state.units.find(u => !u.isPlayer);
      MECHS.forEach(m => addBossMechanic(boss, m));
      return {};
    });
    GAME.startOrEnd();
  }, MECHS);
  await page.waitForFunction(() => state.combatStarted);
  const bossId = await page.evaluate(PILE);
  await page.evaluate(() => { bossMechSync([]); GAME.refresh(); });
  await page.evaluate(() => document.querySelectorAll(".g-intro, .intro, .battle-intro").forEach(n => n.remove()));
  await page.waitForTimeout(300);
  return bossId;
}

test("单机战斗画面（Roguelike 同一套）：首领头上四个读条图标、被点名的人头上图标、区名旁的塔、正上方的横幅；铭牌上不写机制名字、没有彩色边框；挤的区里也看得到；悬停说明放不下时能滚到底", { timeout: 60000 }, async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const origin = await site(t);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }); t.after(() => context.close());
  const page = await context.newPage(); const errors = []; page.on("pageerror", e => errors.push(e.message));
  const bossId = await localBoss(page, origin);
  const card = await page.$eval(`#g-field .unit-wrap[data-id="${bossId}"]`, CARD);
  assert.deepEqual(card.icons.map(i => [i.kind, i.type, i.n]), [["k-cast", "execution", "3"], ["k-cast", "share", "2"], ["k-cast", "tower", "2"], ["k-cast", "spread", "4"]]);
  assert.ok(card.icons.every(i => i.above && i.seen), "图标在铭牌上方、没被别的卡盖住（" + card.dense + "）" + JSON.stringify(card.icons));
  assert.equal(card.chips, 0, "铭牌上没有机制色块");
  assert.doesNotMatch(card.text, /死刑|分担|踩塔|远离/, "铭牌上不写机制名字");
  assert.notEqual(card.shown, "none", "状态一行没藏起来（" + card.dense + "）");
  // 被点名的人：头上的图标（死刑 3、分担 2、远离 4），铭牌的边框和没点名时一样
  const who = await page.evaluate(() => { const b = state.units.find(u => !u.isPlayer && u.mechanics), m = t => b.mechanics.find(x => x.type === t).st.targetId; return { exec: m("execution"), share: m("share") }; });
  const ex = await page.$eval(`#g-field .unit-wrap[data-id="${who.exec}"]`, CARD);
  assert.ok(ex.icons.some(i => i.kind === "k-mark" && i.type === "execution" && i.n === "3"), JSON.stringify(ex.icons));
  assert.ok(ex.icons.some(i => i.kind === "k-mark" && i.type === "spread" && i.n === "4"));
  assert.ok(ex.icons.every(i => i.above && i.seen), JSON.stringify(ex.icons));
  assert.equal(ex.shadow, ex.plain, "铭牌上没有彩色边框");
  assert.doesNotMatch(ex.text, /死刑|分担|踩塔|远离/);
  const sh = await page.$eval(`#g-field .unit-wrap[data-id="${who.share}"]`, CARD);
  assert.ok(sh.icons.some(i => i.kind === "k-mark" && i.type === "share" && i.n === "2"), JSON.stringify(sh.icons));
  assert.equal(sh.shadow, sh.plain);
  // 踩塔：区名旁边的图标，地上一圈
  const tower = await page.$eval("#g-field .g-zone.tower", TOWER);
  assert.deepEqual(tower.icon, { kind: "k-zone", type: "tower", n: "2" });
  assert.match(tower.need, /^\d\/1 人$/);
  assert.ok(tower.ring && !tower.board, "地上画一圈；右上角的文字牌子没有了");
  assert.doesNotMatch(tower.head, /踩塔/, "区名旁边不写机制名字");
  // 战场正上方的横幅
  checkBanner(await page.$eval("#g-field", BANNER));
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "issue206-local-boss.png") });
  await checkIconTip(page, `#g-field .unit-wrap[data-id="${bossId}"] .mech-ico[data-mech="execution"]`);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "issue206-local-icon-tip.png") });
  await checkTip(page, `#g-field .unit-wrap[data-id="${bossId}"] .unit`);
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1), true, "页面本身不滚动");
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "bug3-rogue-local-tip.png") });
  assert.deepEqual(errors, []);
});

test("最后一回合（本回合落下）：图标写「!」并轻轻脉动，横幅那一条放大、闪；系统开了「减少动态效果」就不动；结算掉以后横幅里那一条消失", { timeout: 60000 }, async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const origin = await site(t);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }); t.after(() => context.close());
  const page = await context.newPage(); const errors = []; page.on("pageerror", e => errors.push(e.message));
  const bossId = await localBoss(page, origin);
  await page.evaluate(() => { const b = state.units.find(u => !u.isPlayer && u.mechanics); b.mechanics.find(m => m.type === "share").st.due = state.turnNo; GAME.refresh(); });
  const read = () => page.evaluate(id => {
    const b = state.units.find(u => u.id === id), target = b.mechanics.find(m => m.type === "share").st.targetId;
    const ico = (sel) => document.querySelector(sel);
    const cast = ico(`#g-field .unit-wrap[data-id="${id}"] .mech-ico[data-mech="share"]`), mark = ico(`#g-field .unit-wrap[data-id="${target}"] .mech-ico[data-mech="share"]`);
    const rows = [...document.querySelectorAll("#g-field .mech-bar .mb-row")];
    return { cast: [cast.querySelector(".mi-n").textContent, cast.classList.contains("last"), getComputedStyle(cast.querySelector(".mi-svg")).animationName],
      mark: [mark.querySelector(".mi-n").textContent, mark.classList.contains("last"), getComputedStyle(mark.querySelector(".mi-svg")).animationName],
      others: [...document.querySelectorAll("#g-field .u-mechs .mech-ico:not(.last) .mi-svg")].map(s => getComputedStyle(s).animationName),
      first: [rows[0].dataset.mech, rows[0].innerText.replace(/\s+/g, " ").trim(), rows[0].classList.contains("last"), getComputedStyle(rows[0]).animationName],
      bigger: parseFloat(getComputedStyle(rows[0]).fontSize) > parseFloat(getComputedStyle(rows[1]).fontSize),
      rest: rows.slice(1).map(r => getComputedStyle(r).animationName) };
  }, bossId);
  const a = await read();
  assert.deepEqual(a.cast, ["!", true, "miPulse"], "首领头上的分担写「!」、脉动");
  assert.deepEqual(a.mark, ["!", true, "miPulse"], "被点名的人头上的分担写「!」、脉动");
  assert.ok(a.others.length && a.others.every(x => x === "none"), "还没到的不动");
  assert.equal(a.first[0], "share"); assert.match(a.first[1], /^分担 → \S+ · 本回合落下$/); assert.equal(a.first[2], true); assert.equal(a.first[3], "mbFlash");
  assert.ok(a.bigger, "最后一回合那条放大");
  assert.ok(a.rest.every(x => x === "none"));
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "issue206-last-round.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const b = await read();
  assert.deepEqual([b.cast[2], b.mark[2], b.first[3], b.bigger], ["none", "none", "none", true], "减少动态效果：不脉动、不闪，那一条照样放大");
  // 结算掉（这里直接把分担拿掉）：横幅里那一条、头顶的图标都没了
  await page.evaluate(() => { const b = state.units.find(u => !u.isPlayer && u.mechanics); b.mechanics = b.mechanics.filter(m => m.type !== "share"); GAME.refresh(); });
  const after = await page.evaluate(() => ({ rows: [...document.querySelectorAll("#g-field .mech-bar .mb-row")].map(r => r.dataset.mech), icons: document.querySelectorAll('#g-field .mech-ico[data-mech="share"]').length }));
  assert.deepEqual(after, { rows: ["tower", "execution", "spread"], icons: 0 });
  assert.deepEqual(errors, []);
});

test("触屏：点一下头顶的图标弹出说明（不会选中这个单位），点别处收起", { timeout: 60000 }, async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const origin = await site(t);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); t.after(() => context.close());
  const page = await context.newPage(); const errors = []; page.on("pageerror", e => errors.push(e.message));
  await localBoss(page, origin);
  const pick = await page.evaluate(() => ({ actor: GAME.actorId, other: state.units.find(u => u.isPlayer && !u.hidden && u.id !== GAME.actorId).id }));
  await page.tap(`#g-field .unit-wrap[data-id="${pick.other}"] .mech-ico[data-mech="spread"]`);
  await page.waitForSelector(".mech-tip.show");
  const tip = await page.evaluate(() => { const r = document.querySelector(".mech-tip.show").getBoundingClientRect(); return { text: document.querySelector(".mech-tip").innerText, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; });
  assert.match(tip.text, /远离/); assert.match(tip.text, /还有 4 回合/); assert.match(tip.text, /怎么应对/);
  assert.ok(tip.inside, "说明不出屏幕");
  assert.equal(await page.evaluate(() => GAME.actorId), pick.actor, "点图标不会选中这个单位");
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "issue206-touch-tip.png") });
  await page.tap("#g-round");   // 点别处（顶栏的回合数）
  await page.waitForFunction(() => !document.querySelector(".mech-tip.show"));
  assert.deepEqual(errors, []);
});

/** 分担换一个人点名（转给另一个没被它点名的队友），重画；返回新点名的人、他头上那个图标是不是正在弹（Web Animations + 一圈光） */
const RETARGET = () => {
  const m = state.units.find(u => !u.isPlayer && u.mechanics).mechanics.find(x => x.type === "share");
  const to = state.units.find(u => u.isPlayer && !u.hidden && !u.dead && u.id !== m.st.targetId);
  m.st.targetId = to.id;
  GAME.refresh();
  const ico = document.querySelector(`#g-field .unit-wrap[data-id="${to.id}"] .u-mechs .mech-ico[data-mech="share"]`);
  return { to: to.id, icon: !!ico, running: !!ico && ico.getAnimations().some(a => a.id === "mech-pop"), burst: !!ico && !!ico.querySelector(".mi-burst") };
};

test("点名瞬间（单机）：开战那一刻被点名的人头上的图标「啪」地弹出来、区名旁边的塔也弹，响一声提示音；刷新画面、悬停、倒计时减少都不再弹 / 响；换人点名再弹；静音时不响；减少动态效果时不弹、声音照响", { timeout: 60000 }, async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const origin = await site(t);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }); t.after(() => context.close());
  const page = await context.newPage(); const errors = []; page.on("pageerror", e => errors.push(e.message));
  const bossId = await localBoss(page, origin, { spy: true });
  await page.waitForFunction(() => window.__pops.length > 0 && window.__pings > 0);
  const who = await page.evaluate(() => {
    const b = state.units.find(u => !u.isPlayer && u.mechanics), st = t => b.mechanics.find(x => x.type === t).st;
    return { exec: st("execution").targetId, share: st("share").targetId, tower: String(st("tower").zones[0]), heroes: st("spread").targetIds.slice() };
  });
  const first = await spied(page);
  const popped = (unit, type) => first.pops.some(p => p.unit === unit && p.type === type && p.kind === "k-mark");
  assert.ok(popped(who.exec, "execution"), "死刑点名的人头上弹了 " + JSON.stringify(first.pops));
  assert.ok(popped(who.share, "share"), "分担点名的人头上弹了");
  for (const id of who.heroes) assert.ok(popped(id, "spread"), id + " 头上的远离弹了");
  assert.ok(first.pops.some(p => p.zone === who.tower && p.type === "tower" && p.kind === "k-zone"), "区名旁边的塔弹了");
  assert.ok(!first.pops.some(p => p.unit === bossId), "首领头上的读条不弹");
  assert.ok(first.pings >= 1, "响了提示音");
  // 提示音本身：短促、有声、不削顶（sfx.js · MARKER_PING）
  const ping = await page.evaluate(async () => {
    const d = await Sfx.render("marker");
    let peak = 0, last = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); peak = Math.max(peak, a); if (a > 0.01) last = i; }
    return { peak, len: last / 44100 };
  });
  assert.ok(ping.peak > 0.05 && ping.peak < 1, "提示音音量 " + ping.peak);
  assert.ok(ping.len < 0.35, "提示音很短：" + ping.len + " 秒");
  // 弹完以后：刷新画面、悬停图标、倒计时减少——都不再弹、不再响
  await page.waitForTimeout(700);
  const base = await spied(page);
  await page.evaluate(() => { GAME.refresh(); GAME.refresh(); });
  await page.hover(`#g-field .unit-wrap[data-id="${who.exec}"] .u-mechs .mech-ico[data-mech="execution"]`);
  await page.waitForSelector(".mech-tip.show");
  await page.mouse.move(4, 4);
  await page.evaluate(() => { state.units.find(u => !u.isPlayer && u.mechanics).mechanics.forEach(m => { if (m.st && m.st.due != null) m.st.due -= 1; }); GAME.refresh(); });
  await page.waitForTimeout(200);
  const quiet = await spied(page, base.count);
  assert.deepEqual([quiet.pops, quiet.pings], [[], base.pings], "刷新、悬停、倒计时减少都不再弹 / 响 " + JSON.stringify(quiet));
  // 换人点名（分担转到另一个人身上）：新的那个人头上弹出来，响一声
  const moved = await page.evaluate(RETARGET);
  assert.ok(moved.icon && moved.running && moved.burst, "新被点名的人头上的图标正在弹（缩放 + 一圈光）" + JSON.stringify(moved));
  if (process.env.SHOTS) { await page.waitForTimeout(110); await page.screenshot({ path: path.join(process.env.SHOTS, "issue206-mark-pop.png") }); }
  const a1 = await spied(page, base.count);
  assert.deepEqual(a1.pops.map(p => [p.unit, p.type]), [[moved.to, "share"]], "只弹新点名的那一个");
  assert.equal(a1.pings, base.pings + 1, "响一声");
  // 静音（顶栏「音效 关」）：照样弹，不叫提示音
  await page.waitForTimeout(700);
  const b2 = await spied(page);
  await page.evaluate(() => Sfx.setEnabled(false));
  const muted = await page.evaluate(RETARGET);
  const a2 = await spied(page, b2.count);
  assert.deepEqual([muted.running, a2.pops.map(p => [p.unit, p.type]), a2.pings], [true, [[muted.to, "share"]], b2.pings], "静音：照样弹，不响");
  await page.evaluate(() => Sfx.setEnabled(true));
  // 系统开了「减少动态效果」：不弹，声音照音效开关响
  await page.waitForTimeout(700);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const b3 = await spied(page);
  const calm = await page.evaluate(RETARGET);
  const a3 = await spied(page, b3.count);
  assert.deepEqual([calm.icon, calm.running, calm.burst, a3.pops, a3.pings], [true, false, false, [], b3.pings + 1], "减少动态效果：不弹，照响");
  assert.deepEqual(errors, []);
});

/** 联机单局：房主 + 玩家 Alice（1280×800），首领挂上四种机制开战，等到 Alice 画面上首领头上有四个图标。
 *  opts.spy：Alice 的页面一打开就装上 SPY，并且等她的战场先画好（第一次画只记下）再开战 */
async function onlineBoss(t, opts) {
  opts = opts || {};
  const { createLocalRelayServer } = require("../relay/local-server.cjs");
  const origin = await site(t);
  const relay = await createLocalRelayServer({ origins: [origin] }); t.after(() => relay.close());
  const pages = [], errors = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }); t.after(() => context.close());
    const p = await context.newPage(); pages.push(p);
    p.on("pageerror", e => errors.push(e.message)); p.on("dialog", d => d.accept());
    await p.goto(origin + "/game.html"); await p.waitForFunction(() => !!window.OnlineGame && !!window.GAME);
    await p.evaluate(() => { GAME.skip = true; GAME.instant = true; window.__noLevelUpPopup = true; });
    if (opts.spy && i === 1) await p.evaluate(SPY);
  }
  const [host, alice] = pages;
  const code = await host.evaluate(async url => { await OnlineGame.create({ url, name: "房主", mode: "rogue" }); return OnlineGame.getView().roomCode; }, relay.url);
  await alice.evaluate(o => OnlineGame.join(o), { url: relay.url, roomCode: code, name: "Alice" });
  await host.waitForFunction(() => OnlineGame.getView().players.length === 2 && !OnlineGame.isPaused());
  const aliceId = await alice.evaluate(() => OnlineGame.getView().identity.id), hostId = await host.evaluate(() => OnlineGame.getView().identity.id);
  const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  for (const kit of ["ruby", "yuito", "ras"]) await click(host, `.hero-pick[data-kit="${kit}"]`);
  await click(host, "#party-go");
  await host.waitForFunction(() => Screens.is("run") && OnlineGame.getView().heroes.length === 3);
  await host.waitForSelector('#online-panel [data-assign="ruby"]');
  await host.selectOption('#online-panel [data-assign="ruby"]', aliceId);
  await click(host, '#online-panel [data-online="assign"]');
  await host.waitForFunction(a => OnlineRogue.ownerOf("ruby") === a, aliceId);
  await host.evaluate(() => { document.querySelector('#online-panel [data-online="close"]')?.click(); OnlineGame.start(); });
  await alice.waitForFunction(() => !!OnlineGame.getView().packet?.rogue);
  await alice.evaluate(() => OnlineGame.submit({ type: "rogue.vote", option: "task:main" }));
  await click(host, '#run-body .r-go[data-which="main"]');
  await host.waitForFunction(() => RunFlow.current().stage === "task");
  await host.evaluate(() => { const r = RunFlow.current(); r.task.nodes[r.task.index] = { type: "elite", done: false }; RunFlow.refresh(); OnlineGame.touch(); });
  await alice.waitForFunction(() => (OnlineGame.getView().packet?.rogue?.vote?.options || []).some(o => o.id === "fight"));
  await alice.evaluate(() => OnlineGame.submit({ type: "rogue.vote", option: "fight" }));
  await host.evaluate(id => OnlineRogue.vote(id, "fight"), hostId);
  await host.waitForFunction(() => Screens.is("battle") && state.units.some(u => !u.isPlayer));
  await alice.waitForFunction(() => OnlineGame.getView().screen === "battle");
  if (opts.spy) await alice.waitForFunction(() => document.querySelectorAll(".ol-battle .unit-wrap").length > 0);
  await host.evaluate(MECHS => { const boss = state.units.find(u => !u.isPlayer && !u.dead); MECHS.forEach(m => addBossMechanic(boss, m)); GAME.startOrEnd(); }, MECHS);
  await host.waitForFunction(() => state.combatStarted);
  const bossId = await host.evaluate(PILE);
  await host.evaluate(() => { bossMechSync([]); state.units.filter(u => u.isPlayer).forEach(u => { u.shp = 777001; }); OnlineGame.touch(); });
  const who = await host.evaluate(() => { const b = state.units.find(u => !u.isPlayer && u.mechanics), m = t => b.mechanics.find(x => x.type === t).st.targetId; return { exec: m("execution"), share: m("share") }; });
  // 行动顺序：房主按当前格子开始，玩家画面露出战场
  await host.waitForSelector('[data-hs="forceStart"]');
  await click(host, '[data-hs="forceStart"]');
  const fourIcons = id => document.querySelectorAll(`.ol-battle [data-unit-id="${id}"] .u-mechs .mech-ico`).length === 4;
  await alice.waitForFunction(id => document.querySelectorAll(`.ol-battle [data-unit-id="${id}"] .u-mechs .mech-ico`).length === 4 && !document.querySelector(".hs-overlay:not([hidden]) .hs-card"), bossId).catch(() => {});
  await alice.waitForFunction(fourIcons, bossId);
  await alice.waitForTimeout(400);
  return { host, alice, bossId, who, errors };
}

test("联机单局玩家画面（1280×800）：头顶图标、区名旁的塔、正上方的横幅、悬停说明和单机一样；内容多时能滚动；战场高度不变、页面不滚动；玩家数据不含坚毅生命", { timeout: 120000 }, async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const { alice, bossId, who, errors } = await onlineBoss(t);
  const card = await alice.$eval(`.ol-battle [data-unit-id="${bossId}"]`, CARD);
  assert.deepEqual(card.icons.map(i => [i.kind, i.type, i.n]), [["k-cast", "execution", "3"], ["k-cast", "share", "2"], ["k-cast", "tower", "2"], ["k-cast", "spread", "4"]]);
  assert.ok(card.icons.every(i => i.above && i.seen), JSON.stringify(card.icons));
  assert.equal(card.chips, 0);
  assert.doesNotMatch(card.text, /死刑|分担|踩塔|远离/);
  assert.notEqual(card.shown, "none");
  const ex = await alice.$eval(`.ol-battle [data-unit-id="${who.exec}"]`, CARD);
  assert.ok(ex.icons.some(i => i.kind === "k-mark" && i.type === "execution" && i.n === "3") && ex.icons.some(i => i.type === "spread" && i.n === "4"), JSON.stringify(ex.icons));
  assert.equal(ex.shadow, ex.plain, "铭牌上没有彩色边框");
  const sh = await alice.$eval(`.ol-battle [data-unit-id="${who.share}"]`, CARD);
  assert.ok(sh.icons.some(i => i.kind === "k-mark" && i.type === "share" && i.n === "2"), JSON.stringify(sh.icons));
  const tower = await alice.$eval(".ol-battle .g-zone.tower", TOWER);
  assert.deepEqual(tower.icon, { kind: "k-zone", type: "tower", n: "2" });
  assert.match(tower.need, /^\d\/1 人$/);
  assert.ok(tower.ring && !tower.board);
  checkBanner(await alice.$eval(".ol-battle .g-field", BANNER));
  const seen = await alice.evaluate(() => ({ field: document.querySelector(".ol-battle .g-field").getBoundingClientRect().height, pageScroll: document.scrollingElement.scrollHeight - innerHeight, text: document.body.innerText,
    data: JSON.stringify(OnlineGame.getView().state || {}) }));
  assert.ok(seen.field >= 400, "战场高度没被挤小（" + seen.field + "px）");
  assert.ok(seen.pageScroll <= 1, "页面本身不滚动");
  assert.doesNotMatch(seen.text, /坚毅生命|777001/);
  assert.doesNotMatch(seen.data, /777001|"shp"/, "玩家收到的数据里没有坚毅生命");
  if (process.env.SHOTS) await alice.screenshot({ path: path.join(process.env.SHOTS, "issue206-online-boss.png") });
  await checkIconTip(alice, `.ol-battle [data-unit-id="${bossId}"] .mech-ico[data-mech="execution"]`);
  if (process.env.SHOTS) await alice.screenshot({ path: path.join(process.env.SHOTS, "issue206-online-icon-tip.png") });
  await checkTip(alice, `.ol-battle [data-unit-id="${bossId}"] .unit`);
  if (process.env.SHOTS) {
    await alice.mouse.wheel(0, -5000); await alice.waitForTimeout(150);
    await alice.screenshot({ path: path.join(process.env.SHOTS, "bug3-online-overflow-tip.png") });
    await alice.mouse.wheel(0, 5000); await alice.waitForTimeout(150);
    await alice.screenshot({ path: path.join(process.env.SHOTS, "bug3-online-overflow-tip-scrolled.png") });
  }
  assert.deepEqual(errors, []);
});

test("点名瞬间（联机玩家画面）：开战那一刻被点名的人头上的图标、区名旁边的塔弹出来，响一声（只看玩家收到的数据）；房主重发一样的画面不再弹 / 响；换人点名再弹", { timeout: 120000 }, async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const { host, alice, bossId, who, errors } = await onlineBoss(t, { spy: true });
  const more = await host.evaluate(() => {
    const b = state.units.find(u => !u.isPlayer && u.mechanics);
    const st = t => b.mechanics.find(x => x.type === t).st;
    return { tower: String(st("tower").zones[0]), heroes: st("spread").targetIds.slice() };
  });
  const first = await spied(alice);
  const popped = (unit, type) => first.pops.some(p => p.unit === unit && p.type === type && p.kind === "k-mark");
  assert.ok(popped(who.exec, "execution"), "死刑点名的人头上弹了 " + JSON.stringify(first.pops));
  assert.ok(popped(who.share, "share"), "分担点名的人头上弹了");
  for (const id of more.heroes) assert.ok(popped(id, "spread"), id + " 头上的远离弹了");
  assert.ok(first.pops.some(p => p.zone === more.tower && p.type === "tower" && p.kind === "k-zone"), "区名旁边的塔弹了");
  assert.ok(!first.pops.some(p => p.unit === bossId), "首领头上的读条不弹");
  assert.ok(first.pings >= 1, "响了提示音");
  // 房主再发一次一样的画面：不再弹、不再响
  await alice.waitForTimeout(700);
  const base = await spied(alice);
  await host.evaluate(() => OnlineGame.touch());
  await alice.waitForTimeout(800);
  const quiet = await spied(alice, base.count);
  assert.deepEqual([quiet.pops, quiet.pings], [[], base.pings], "重发一样的画面不再弹 / 响 " + JSON.stringify(quiet));
  // 换人点名：房主把分担转给另一个队友，玩家画面上新的那个人头上弹出来、响一声
  const to = await host.evaluate(() => {
    const m = state.units.find(u => !u.isPlayer && u.mechanics).mechanics.find(x => x.type === "share");
    const u = state.units.find(x => x.isPlayer && !x.hidden && !x.dead && x.id !== m.st.targetId);
    m.st.targetId = u.id; OnlineGame.touch();
    return u.id;
  });
  await alice.waitForFunction(id => !!document.querySelector(`.ol-battle [data-unit-id="${id}"] .u-mechs .mech-ico[data-mech="share"]`), to);
  const after = await spied(alice, base.count);
  assert.deepEqual(after.pops.map(p => [p.unit, p.type]), [[to, "share"]], "只弹新点名的那一个");
  assert.equal(after.pings, base.pings + 1, "响一声");
  if (process.env.SHOTS) await alice.screenshot({ path: path.join(process.env.SHOTS, "issue206-online-mark-pop.png") });
  assert.doesNotMatch(await alice.evaluate(() => JSON.stringify(OnlineGame.getView().state || {})), /777001|"shp"/, "玩家收到的数据里没有坚毅生命");
  assert.deepEqual(errors, []);
});
