// 联机：悬停只出简短说明，点一下单位看完整的（作者 10/20 定，online-ui.js · unitTip / openDetail，unit-tip.js · html 的 brief）——要浏览器的那部分：
//   · 悬停（旧画面的单位卡、间隔竖条、配置物；新画面的铭牌）只写名字、行动方式、效果名字（最多 8 个，多的「+N」），首领机制的倒计时照样列出；
//   · 不在选目标时点一下单位 / 配置物 / 间隔（手机上轻点）打开详情面板看完整说明：桌面靠右、手机贴底，自带滚动条；✕ / Esc / 再点一下收起；
//   · 选目标时点单位照旧是选目标；Esc 和暂停菜单不抢：详情面板开着时 Esc 先收面板（PauseMenu.addBlocker），选着技能时这一下也不取消技能；
//   · 载具（移动堡垒）、间隔 / 驻波墙、配置物、分阶段首领：简短版和详情面板都照样认得；单位卡上的效果图标只排一行（+N）；
//   · 本机战斗画面的悬停说明照旧是完整版。玩家看到的都不含坚毅生命。
// 用 Playwright；没装 Playwright 时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过。
// 联机房间是假的（同 online-paper-ui.test.js：OnlineGame 换成记下调用的假接口），说明要的图鉴、配置物、效果文字加载 codex.js / bestiary.js / growth.js 那几张表。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const file = f => path.join(ROOT, f);
const SHP = 7771, SHP_MAX = 7772;
const MORE = "点一下单位看全部说明";
/** 有鼠标的电脑：没装 Playwright 时的备用浏览器（tests/cdp-browser.js）是无界面的 Chrome，认不出鼠标——(hover: none) 是真的，界面就当成触屏、不弹悬停说明。
 *  这里让 (hover: none) 不成立（Playwright 的无界面 Chrome 本来就认得鼠标，换上去也一样）；手机那一条不换 */
const MOUSE = () => {
  const mm = window.matchMedia.bind(window);
  window.matchMedia = q => (/\(\s*hover\s*:\s*none\s*\)/.test(String(q)) ? { matches: false, media: String(q), onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } : mm(q));
};

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

/**
 * 一位联机玩家（p1，操控红玉）的页面：假房间 + 真的联机界面（online-battle.js / online-ui.js / unit-card.js / unit-tip.js / pause-menu.js……）。
 * 战场：1 区红玉、绯秋；2 区亡命之王（首领，身上十几个效果、正在读条死刑）、沙灵聚合体（二阶段）、和移动堡垒合并的狂徒、爆炸桶；1–2 区之间一道驻波墙。
 * opt.context：视口；opt.paper：开着新画面（假的 HD2DField，attach 时把 spec 记在 window.__spec，点 / 悬停铭牌就是 spec.input.unit / hover）
 */
async function onlinePage(t, opt) {
  opt = opt || {};
  if (!browser) { t.skip(skipWhy); return null; }
  const context = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 } }, opt.context || {}));
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  // 先到一个本地文件的地址：about:blank 不让读写 localStorage
  await page.goto(pathToFileURL(file("online.css")).href);
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><section id="scr-title"><div class="t-menu"></div></section><main class="g-app" id="g-app"><header class="g-top"><button id="g-hd2d-toggle" type="button">新画面 关</button></header>单机的战斗画面</main></body>');
  if (!(opt.context && opt.context.hasTouch)) await page.evaluate(MOUSE);
  for (const f of ["game.css", "skin.css", "hotseat.css", "online.css", "online-gm-ui.css", "hud-icons.css", "workshop.css", "matchup.css", "pause-menu.css", "hd2d/hd2d.css", "online-paper.css"]) await page.addStyleTag({ path: file(f) });
  // 说明里的图鉴、配置物、效果文字：图鉴（BESTIARY_TEXT、阶段 BESTIARY_STAGES）、配置物和效果（CODEX_PROPS、CODEX_EFFECTS）、敌人的级别（ENEMY_RANK）——只有数据，不带规则
  for (const f of ["codex.js", "bestiary.js", "growth.js"]) await page.addScriptTag({ path: file(f) });
  await page.evaluate(([shp, shpMax, paper]) => {
    localStorage.setItem("backfire-hd2d-field", paper ? "on" : "off");
    const players = [{ id: "gm", name: "主持人", gm: true, online: true }, { id: "p1", name: "甲", online: true }, { id: "p2", name: "乙", online: true }];
    // 房主那边漏过来的坚毅生命（投影过的包本来没有）：故意塞上，看说明里碰不碰
    const unit = (id, name, kit, isPlayer, zone, more) => Object.assign({ id, name, kit, isPlayer, zone, level: isPlayer ? 3 : 5, ap: 2, apMax: 2, bonus: 1, bonusMax: 1, def: 6, defMax: 6, shp, shpMax,
      layers: [{ type: "flesh", current: 30, max: 35 }], statuses: {}, resources: {} }, more || {});
    const pile = { burn: 3, shock: true, corr: true, frostbite: true, shockwave: true, reso: true, unstable: true, weak: true, inspire: true, hide: true, advantage: true, chase: true, sturdy: true };
    const state = { displayOnly: true, turnNo: 3, zoneMode: 2, weather: "none", light: "day", fields: { 1: {}, 2: {} },
      units: [
        unit("a", "红玉", "ruby", true, 1), unit("b", "绯秋", "hiaki", true, 1),
        unit("king", "亡命之王", "outlaw_king", false, 2, { statuses: pile, instant: { melt: true, overload: true, shift: true }, stunMax: 2, stunMarks: 1,
          display: { casts: [{ type: "execution", name: "死刑", target: "红玉", left: 2, phase: "enemy" }] } }),
        unit("agg", "沙灵聚合体", "sand_aggregate", false, 2, { display: { stage: 2 } }),
        unit("pilot", "狂徒", "thug_knife", false, 2, { stunMax: 2, statuses: { burn: 1 },
          vehicle: { kind: "fortress", name: "移动堡垒", level: 3, atk: 20, seatText: "乘员 2 / 4", pilot: "狂徒", roster: ["驾驶员：狂徒", "炮手：锤狂徒"] } })
      ],
      props: [{ id: "boom1", kind: "boom", name: "爆炸桶", hp: 5, maxHp: 8, zone: 2, faction: "enemy" }],
      gaps: { "1-2": { type: "wave", wave: { el: "fire", mode: "dampen", saved: { type: "wall", hp: 12 } } } } };
    const heroes = [{ id: "a", name: "红玉", owner: "p1" }, { id: "b", name: "绯秋", owner: "p2" }];
    const order = [{ actor: "a", owner: "p1", current: true }, { actor: "b", owner: "p2" }];
    window.fixture = { calls: [], listeners: [], packets: [], view: { active: false, isHost: false, identity: null, status: { connected: true, hostOnline: true, paused: false, roster: players }, screen: "lobby", roomCode: "UD3T7K", players, state, heroes, messages: [], mode: "trpg",
      packet: { mode: "trpg", clock: { day: 1, clock: 480, hours: 2 }, view: { mode: "trpg", playerId: "p1", hostId: "gm", units: heroes, heroes, phase: "acting", currentUnitId: "a", order, players, chat: [], checks: [], checkRequests: [] }, state, publicLogs: [{ text: "红玉 · 普通攻击 → 亡命之王 12" }], quests: [] } },
      emit() { this.listeners.forEach(fn => fn()); }, set(data) { Object.assign(this.view, data); this.emit(); } };
    const record = (kind, args) => { fixture.calls.push({ kind, args: args == null ? null : JSON.parse(JSON.stringify(args)) }); return { ok: true }; };
    window.OnlineGame = {
      getView: () => JSON.parse(JSON.stringify(fixture.view)), slots: () => [], hasSaved: () => false,
      submit(cmd) { return record("submit", cmd); }, reconnect() { return record("reconnect"); }, leave() { record("leave"); fixture.set({ active: false }); },
      async sheetData() { return { sheets: [], armory: [], battles: [] }; },
      async actionMenu(request) {
        record("menu", request);
        const base = { type: "actionOptions", displayOnly: true, actor: request.actor, skill: request.skill };
        if (!request.skill) return { ...base, choices: { kind: "skill", options: [{ value: "ruby_aa", label: "普通攻击", cost: "行动 1" }, { value: "__move", label: "移动", cost: "附赠 1" }] } };
        if (!request.target) return { ...base, choices: { kind: "unit", key: "target", title: "选择目标", options: [{ value: "king", label: "亡命之王" }, { value: "agg", label: "沙灵聚合体" }, { value: "gap:1-2", label: "驻波墙" }] } };
        return { ...base, choices: { kind: "ready", title: "确认执行", command: { type: "skill", actor: request.actor, skill: request.skill, target: request.target, picks: {} }, options: [] } };
      },
      subscribe(fn) { fixture.listeners.push(fn); return () => { fixture.listeners = fixture.listeners.filter(f => f !== fn); }; },
      onPacket(fn) { fixture.packets.push(fn); return () => { fixture.packets = fixture.packets.filter(f => f !== fn); }; }
    };
    // 假的新画面（照 hd2d/hd2d-field.js 的 attach / detach / 开关；建好时战场里铺一层、给 .g-hud 换上 hd2d-shell.js 的外壳）：spec 记下来，测试里直接点 / 悬停铭牌
    window.HD2DField = (() => {
      let spec = null, want = localStorage.getItem("backfire-hd2d-field") === "on", built = null;
      const toggle = document.getElementById("g-hd2d-toggle");
      const place = () => { const s = spec && spec.slot(); if (s && toggle.parentNode !== s) s.appendChild(toggle); };
      function build() {
        if (built || !spec || !want) return;
        const field = spec.field(), app = spec.app(); if (!field || !app) return;
        const stage = document.createElement("div"); stage.className = "hd2d-field hd2d-theme";
        stage.innerHTML = '<div class="hd2d-cam"><button type="button" class="hd2d-cam-b on">远</button><button type="button" class="hd2d-cam-b">中</button><button type="button" class="hd2d-cam-b">近</button></div><div class="plate" id="plate-king" style="position:absolute;left:60%;top:40%;width:150px;height:60px"></div>';
        stage.addEventListener("click", e => e.stopPropagation());
        field.appendChild(stage); app.classList.add("hd2d-on");
        const hud = app.querySelector(".g-hud"); if (window.HD2DShell) HD2DShell.attach(hud, { storage: localStorage });
        built = { stage, hud }; spec.refresh();
      }
      const handle = { on: () => !!built, view() { place(); }, actor() {}, marks() {}, play: () => null, skip() {} };
      return { packetView: () => null, cover() {}, attach(s) { if (spec === s) return handle; spec = s; window.__spec = s; place(); build(); return handle; }, detach() { if (built) { built.stage.remove(); if (window.HD2DShell) HD2DShell.detach(built.hud); built = null; } spec = null; return true; } };
    })();
  }, [SHP, SHP_MAX, !!opt.paper]);
  const scripts = ["icons.js", "hud-icons.js", "unit-card.js", "unit-tip.js", "daylight.js", "party-cards.js", "hotseat-ui.js", "online-battle.js", "pause-menu.js", "matchup-ui.js"]
    .concat(opt.paper ? ["hd2d/hd2d-ui.js", "hd2d/hd2d-shell.js", "paper-ui.js", "online-paper.js"] : [], ["online-ui.js"]);
  for (const f of scripts) await page.addScriptTag({ path: file(f) });
  // 热座栏：和 online-game.js · mountOrder 一样，玩家看的是收到的包里的 view
  await page.evaluate(() => {
    window.hotseat = HotseatUI.mount({ getView: () => Object.assign({}, fixture.view.packet.view, { enabled: !!fixture.view.active && fixture.view.screen === "battle", configured: true, network: true, canConfigure: false, canDisable: false }),
      submit: cmd => OnlineGame.submit(cmd), subscribe: fn => { fixture.listeners.push(fn); return () => {}; } });
    fixture.set({ active: true, isHost: false, identity: { id: "p1" }, screen: "battle" });
  });
  await page.waitForSelector('.ol-battle .unit-wrap[data-unit-id="king"]', { state: "attached" });
  await page.waitForTimeout(150);
  return { page, errors, context };
}
const settle = page => page.waitForTimeout(150);
const tipText = page => page.evaluate(() => { const t = document.querySelector(".unit-tip.show"); return t ? t.textContent : ""; });
/** 详情面板：开着没有、字、位置、能不能滚 */
const panel = page => page.evaluate(() => {
  const p = document.getElementById("online-unit-detail"), r = p.getBoundingClientRect();
  return { open: !p.hidden && r.height > 0, text: p.textContent, html: p.innerHTML, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, vw: innerWidth, vh: innerHeight,
    sh: p.scrollHeight, ch: p.clientHeight, list: p.querySelectorAll(".ut-list li").length, effects: p.querySelectorAll(".ut-effects li").length,
    tip: !!document.querySelector(".unit-tip.show"), focus: !!(document.activeElement && p.contains(document.activeElement)) };
});
const menuOpen = page => page.isVisible("#pm-overlay");
const card = id => `#online-stage .ol-battle .unit-wrap[data-unit-id="${id}"]`;
const noShp = (text, tag) => { assert.ok(!text.includes(String(SHP)) && !text.includes(String(SHP_MAX)), tag + "：出现了坚毅生命的数字"); assert.doesNotMatch(text, /坚毅生命/, tag); };

test("联机旧画面（1440×900）：悬停敌人只出简短说明（名字、行动方式、效果名字最多 8 个 +N、首领机制倒计时）；点一下右边打开详情面板（完整说明、能滚）；✕ / Esc / 再点一下收起，Esc 先收面板不开菜单；敌人卡的效果图标只排一行", { timeout: 90000 }, async t => {
  const o = await onlinePage(t); if (!o) return; const { page } = o;
  // 卡上的效果图标只排一行，多的收进「+N」（和本机同一份 unit-card.js；画出来的下一帧量好）
  await page.waitForFunction(sel => { const m = document.querySelector(sel + " .u-status .hi-badges.hi-row .hi-more"); return !!m && !m.hidden; }, card("king"));
  const row = await page.evaluate(sel => {
    const r = document.querySelector(sel + " .u-status .hi-badges.hi-row"), shown = [...r.querySelectorAll(".hi-badge")].filter(b => getComputedStyle(b).display !== "none");
    return { tops: new Set(shown.map(b => Math.round(b.getBoundingClientRect().top))).size, shown: shown.length, off: r.querySelectorAll(".hi-badge.hi-off").length, first: r.querySelector(".hi-badge").dataset.fx,
      more: r.querySelector(".hi-more").hidden ? "" : r.querySelector(".hi-more").textContent };
  }, card("king"));
  assert.ok(row.tops === 1 && row.shown >= 3 && row.off > 0 && row.more === "+" + row.off, "一行，放不下的收进 +N：" + JSON.stringify(row));
  assert.equal(row.first, "stunMark", "首领的晕眩标记排第一");
  // 悬停：简短版
  await page.hover(card("king") + " .u-name");
  await page.waitForSelector(".unit-tip.show");
  const tip = await page.evaluate(() => { const t = document.querySelector(".unit-tip.show"), r = t.getBoundingClientRect(); return { text: t.textContent, html: t.innerHTML, h: r.height, bottom: r.bottom, vh: innerHeight, scroll: t.classList.contains("ut-scroll") }; });
  assert.match(tip.text, /亡命之王/);
  assert.match(tip.text, /行动方式/, "行动方式");
  assert.match(tip.text, /首领机制 · 倒计时[\s\S]*死刑 → 红玉（还有 2 回合）/, "首领机制的倒计时照样列出");
  assert.match(tip.text, /身上的效果 · 1[6-9]/);
  assert.equal((tip.html.match(/<ul class="ut-chips">([\s\S]*?)<\/ul>/)[1].match(/<b>/g) || []).length, 8, "效果名字最多 8 个");
  assert.match(tip.html, /class="ut-chips-more">\+\d+</, "多的写 +N");
  assert.match(tip.text, new RegExp(MORE));
  assert.doesNotMatch(tip.text, /攻击命令|处死命令/, "不列能力");
  assert.doesNotMatch(tip.text, /灼烧层数/, "不写效果的说明");
  assert.ok(!tip.scroll && tip.h < tip.vh * 0.5 && tip.bottom <= tip.vh, "简短：不用滚、不到半屏：" + JSON.stringify({ h: tip.h, vh: tip.vh }));
  noShp(tip.text, "悬停说明");
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "unit-detail-brief-tip.png") });
  // 点一下：右边打开详情面板（完整说明），悬停说明收起
  await page.click(card("king") + " .u-name");
  await page.waitForSelector("#online-unit-detail", { state: "visible" });
  let p = await panel(page);
  assert.match(p.text, /亡命之王/);
  assert.match(p.text, /攻击命令/, "能力写全了");
  assert.match(p.text, /灼烧层数/, "效果有说明");
  assert.match(p.text, /首领机制 · 倒计时[\s\S]*死刑/);
  assert.ok(p.effects >= 16, "效果一个不少：" + p.effects);
  assert.ok(p.vw - p.right < 20 && p.left > p.vw / 2, "靠右：" + JSON.stringify(p));
  assert.ok(p.top >= 56 && p.bottom <= p.vh, "热座栏下面、整个在屏幕里：" + JSON.stringify(p));
  assert.equal(p.tip, false, "打开详情时悬停说明收起");
  assert.equal(p.focus, false, "不抢键盘焦点（空格照旧结束行动）");
  noShp(p.text, "详情面板");
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "unit-detail-panel.png") });
  assert.ok(p.sh > p.ch, "内容多：面板自己能滚 " + JSON.stringify({ sh: p.sh, ch: p.ch }));
  await page.evaluate(() => { const el = document.getElementById("online-unit-detail"); el.scrollTop = el.scrollHeight; });
  const end = await page.evaluate(() => { const el = document.getElementById("online-unit-detail"); return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight }; });
  assert.ok(end.top > 0 && Math.abs(end.top - end.max) <= 1, "能翻到最底下");
  // 面板开着时：悬停同一个不再弹简短版；悬停别的照样弹
  await page.mouse.move(5, 300); await settle(page);
  await page.hover(card("king") + " .u-name"); await settle(page);
  assert.equal(await tipText(page), "", "正开着的那一个不弹悬停说明");
  await page.hover(card("agg") + " .u-name");
  await page.waitForSelector(".unit-tip.show");
  assert.match(await tipText(page), /沙灵聚合体/);
  // 跟着战场刷新：首领多挂一个效果，面板里跟着有
  await page.evaluate(() => { fixture.view.state.units.find(u => u.id === "king").self = "conductor"; fixture.emit(); });
  await page.waitForFunction(() => /导体/.test(document.getElementById("online-unit-detail").textContent));
  // 再点一下同一个：收起
  await page.click(card("king") + " .u-name");
  await page.waitForSelector("#online-unit-detail", { state: "hidden" });
  // ✕ 收起
  await page.click(card("king") + " .u-name");
  await page.waitForSelector("#online-unit-detail", { state: "visible" });
  await page.click("#online-unit-detail [data-ut-close]");
  await page.waitForSelector("#online-unit-detail", { state: "hidden" });
  // 点别的：换成别的；Esc 收起，这一下不开菜单
  await page.click(card("king") + " .u-name");
  await page.click(card("agg") + " .u-name");
  await page.waitForFunction(() => /沙灵聚合体/.test(document.getElementById("online-unit-detail").textContent) && !/亡命之王/.test(document.getElementById("online-unit-detail").textContent));
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  assert.equal(await page.evaluate(() => PauseMenu.blocked()), true, "面板开着：暂停菜单那边登记了「先别开」");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#online-unit-detail", { state: "hidden" });
  await settle(page);
  assert.equal(await menuOpen(page), false, "这一下 Esc 只收面板，不开菜单");
  // 面板收了：Esc 照旧打开菜单，再按关掉
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pm-overlay", { state: "visible" });
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pm-overlay", { state: "hidden" });
  assert.deepEqual(o.errors, []);
});

test("联机：选目标时点单位照旧是选目标（不开面板）；面板开着时选了技能，Esc 先收面板、技能还选着，再按才取消技能", { timeout: 90000 }, async t => {
  const o = await onlinePage(t); if (!o) return; const { page } = o;
  await page.waitForSelector('.ol-battle [data-ob-skill="ruby_aa"]:not([disabled])');
  // 先开着沙灵聚合体的面板，再选普通攻击
  await page.click(card("agg") + " .u-name");
  await page.waitForSelector("#online-unit-detail", { state: "visible" });
  await page.click('.ol-battle [data-ob-skill="ruby_aa"]');
  await page.waitForSelector(card("king") + ".is-targetable", { state: "attached" });
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Escape");
  await page.waitForSelector("#online-unit-detail", { state: "hidden" });
  await settle(page);
  assert.equal(await page.locator(".ol-battle .unit-wrap.is-targetable").count(), 2, "技能还选着（这一下 Esc 只收了面板）");
  assert.equal(await menuOpen(page), false);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".ol-battle .unit-wrap.is-targetable"));
  await settle(page);
  assert.equal(await menuOpen(page), false, "第二下取消技能，也不开菜单");
  // 选目标：点亡命之王 = 打他，不开面板
  await page.click('.ol-battle [data-ob-skill="ruby_aa"]');
  await page.waitForSelector(card("king") + ".is-targetable", { state: "attached" });
  await page.click(card("king") + " .u-name");
  await page.waitForFunction(() => fixture.calls.some(c => c.kind === "submit" && c.args.type === "skill"));
  assert.deepEqual(await page.evaluate(() => fixture.calls.filter(c => c.kind === "submit").map(c => c.args)), [{ type: "skill", actor: "a", skill: "ruby_aa", target: "king", picks: {} }], "点哪个打哪个");
  assert.equal((await panel(page)).open, false, "选目标时点单位不开面板");
  // 打墙：点间隔竖条也能选（和本机、新画面一样）
  await page.waitForSelector('.ol-battle [data-ob-skill="ruby_aa"]:not([disabled])');
  await page.click('.ol-battle [data-ob-skill="ruby_aa"]');
  await page.waitForSelector(card("king") + ".is-targetable", { state: "attached" });
  await page.click('.ol-battle .g-gap[data-key="1-2"]');
  await page.waitForFunction(() => fixture.calls.filter(c => c.kind === "submit" && c.args.type === "skill").length === 2);
  assert.equal(await page.evaluate(() => fixture.calls.filter(c => c.kind === "submit").pop().args.target), "gap:1-2");
  assert.equal((await panel(page)).open, false);
  assert.deepEqual(o.errors, []);
});

test("联机：间隔 / 驻波墙、配置物、载具（移动堡垒）、分阶段首领——悬停简短版、点开的详情面板都照样认得；都不含坚毅生命", { timeout: 90000 }, async t => {
  const o = await onlinePage(t); if (!o) return; const { page } = o;
  const hoverTip = async (sel) => { await page.mouse.move(5, 300); await settle(page); await page.hover(sel); await page.waitForSelector(".unit-tip.show"); return tipText(page); };
  const open = async (sel) => { await page.click(sel); await page.waitForSelector("#online-unit-detail", { state: "visible" }); return panel(page); };
  const close = async () => { await page.click("#online-unit-detail [data-ut-close]"); await page.waitForSelector("#online-unit-detail", { state: "hidden" }); };
  // 驻波墙：写它过滤什么属性、降幅还是增幅、暂时取代的是什么
  let tip = await hoverTip('.ol-battle .g-gap[data-key="1-2"]');
  assert.match(tip, /驻波墙·火·降幅（1–2 区之间）/); assert.match(tip, /暂时取代：危墙（耐久 12）/); assert.match(tip, /这一道过滤火属性/); assert.match(tip, new RegExp(MORE));
  let p = await open('.ol-battle .g-gap[data-key="1-2"]');
  assert.match(p.text, /驻波墙·火·降幅/); assert.match(p.text, /这一道过滤火属性/);
  assert.ok(p.list > 0, "完整版列出配置物图鉴里的说明");
  noShp(p.text, "驻波墙");
  await close();
  // 配置物：名字、耐久
  tip = await hoverTip('.ol-battle .unit-wrap[data-prop-id="boom1"] .unit');
  assert.match(tip, /爆炸桶[\s\S]*耐久 5\/8/);
  p = await open('.ol-battle .unit-wrap[data-prop-id="boom1"] .unit');
  assert.match(p.text, /爆炸桶[\s\S]*耐久 5\/8/);
  assert.ok(p.list > 0);
  await close();
  // 载具：和车合并的驾驶员按车写，乘员名单照写（简短版也写）
  tip = await hoverTip(card("pilot") + " .u-name");
  assert.match(tip, /移动堡垒/); assert.match(tip, /乘员 2 \/ 4[\s\S]*驾驶员：狂徒[\s\S]*炮手：锤狂徒/);
  p = await open(card("pilot") + " .u-name");
  assert.match(p.text, /移动堡垒/); assert.match(p.text, /驾驶员：狂徒/);
  assert.ok(p.list > 2, "完整版有车的说明");
  noShp(p.text, "载具");
  await close();
  // 分阶段的首领：简短版写现在是哪个阶段、不列能力；详情面板只列这一阶段的能力
  tip = await hoverTip(card("agg") + " .u-name");
  assert.match(tip, /当前阶段：二阶段 · 还有其他阶段/);
  assert.doesNotMatch(tip, /电能炮|沙尘爆裂/);
  p = await open(card("agg") + " .u-name");
  assert.match(p.text, /当前阶段：二阶段/);
  assert.match(p.text, /电能炮/, "这一阶段的能力");
  assert.doesNotMatch(p.text, /沙尘爆裂|吸引碎片/, "别的阶段的不写");
  noShp(p.text, "分阶段首领");
  assert.deepEqual(o.errors, []);
});

test("联机（手机 390×844）：轻点敌人，详情面板从底部弹出——占满宽、不超过屏幕高度的 62%，自带滚动条，底下留出「回到…」按钮的地方；✕ 收起", { timeout: 90000 }, async t => {
  const o = await onlinePage(t, { context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }); if (!o) return; const { page } = o;
  await page.click(card("king") + " .u-name");
  await page.waitForSelector("#online-unit-detail", { state: "visible" });
  const p = await panel(page);
  assert.ok(Math.abs(p.bottom - p.vh) < 1 && Math.abs(p.width - p.vw) < 1 && p.left < 1, "贴底、占满宽：" + JSON.stringify(p));
  assert.ok(p.height <= p.vh * 0.62 + 1, "不超过 62% 高：" + JSON.stringify(p));
  assert.ok(p.sh > p.ch, "内容多：自己能滚");
  assert.match(p.text, /攻击命令/);
  const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("online-unit-detail")).paddingBottom));
  assert.ok(pad >= 60, "底下留出「回到…」按钮那么高：" + pad);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "unit-detail-phone.png") });
  await page.click("#online-unit-detail [data-ut-close]");
  await page.waitForSelector("#online-unit-detail", { state: "hidden" });
  assert.deepEqual(o.errors, []);
});

test("纸片画面（新画面开着）：点 3D 铭牌打开详情面板（在顶栏和吊牌下面、让开右边缘的竖标签和底下的技能栏），悬停铭牌只出简短版；选目标时点铭牌照旧是选目标", { timeout: 90000 }, async t => {
  const o = await onlinePage(t, { paper: true }); if (!o) return; const { page } = o;
  await page.waitForFunction(() => document.body.classList.contains("ol-paper") && !!window.__spec);
  await settle(page);
  // 悬停铭牌：简短版
  await page.evaluate(() => __spec.input.hover("king", true, document.getElementById("plate-king")));
  await page.waitForSelector(".unit-tip.show");
  const tip = await tipText(page);
  assert.match(tip, /亡命之王/); assert.match(tip, new RegExp(MORE)); assert.doesNotMatch(tip, /攻击命令/);
  // 点铭牌：详情面板
  await page.evaluate(() => __spec.input.unit("king"));
  await page.waitForSelector("#online-unit-detail", { state: "visible" });
  const p = await panel(page);
  assert.match(p.text, /攻击命令/);
  const box = await page.evaluate(() => {
    const r = s => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
    return { top: r("#online-paper .olp-top"), tab: r("#online-side"), dock: r(".ol-battle > .g-hud") };
  });
  assert.ok(p.top >= box.top.bottom, "在顶栏下面：" + JSON.stringify([p.top, box.top]));
  assert.ok(p.right <= box.tab.left + 1, "让开右边缘的竖标签：" + JSON.stringify([p.right, box.tab]));
  assert.ok(p.bottom <= box.dock.top + 1 || p.right <= box.dock.left || p.left >= box.dock.right, "不压在技能栏上：" + JSON.stringify([p, box.dock]));
  assert.equal(p.tip, false, "悬停说明收起");
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "unit-detail-paper.png") });
  // 铭牌上点间隔：换成驻波墙；再点一下收起
  await page.evaluate(() => __spec.input.unit("gap:1-2"));
  await page.waitForFunction(() => /驻波墙/.test(document.getElementById("online-unit-detail").textContent));
  await page.evaluate(() => __spec.input.unit("gap:1-2"));
  await page.waitForSelector("#online-unit-detail", { state: "hidden" });
  // 选目标时点铭牌：打他
  await page.click('.ol-battle [data-ob-skill="ruby_aa"]');
  await page.waitForFunction(() => fixture.calls.some(c => c.kind === "menu" && c.args.skill === "ruby_aa"));
  await settle(page);
  await page.evaluate(() => __spec.input.unit("king"));
  await page.waitForFunction(() => fixture.calls.some(c => c.kind === "submit" && c.args.type === "skill"));
  assert.equal(await page.evaluate(() => fixture.calls.filter(c => c.kind === "submit").pop().args.target), "king");
  assert.equal((await panel(page)).open, false, "选目标时不开面板");
  assert.deepEqual(o.errors, []);
});

test("本机战斗画面的悬停说明照旧是完整版（能力、效果说明都写，没有「点一下」的提示）", { timeout: 90000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await require("./old-screen")(context);   // #316：新画面默认开，这里测的是旧画面
  await context.addInitScript(MOUSE);
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(pathToFileURL(file("game.html")).href);
  await page.waitForFunction(() => !!window.GAME && !!window.UnitTip);
  await page.evaluate(() => {
    window.__noLevelUpPopup = true; GAME.skip = true; GAME.instant = true;
    Screens.show("battle");
    GAME.startCustomBattle("悬停测试", () => { BattleSim.setup({ party: ["ruby", "yuito"], enemies: [{ id: "outlaw_king", lv: 5, zone: 2 }], seed: "TIP-LOCAL" }); return {}; });
    GAME.startOrEnd();
  });
  await page.waitForFunction(() => state.combatStarted);
  await page.evaluate(() => { document.querySelectorAll(".g-intro, .intro, .battle-intro").forEach(n => n.remove()); const k = state.units.find(u => u.kit === "outlaw_king"); k.statuses.burn = 2; GAME.refresh(); });
  const id = await page.evaluate(() => state.units.find(u => u.kit === "outlaw_king").id);
  await page.hover(`#g-field .unit-wrap[data-id="${id}"] .u-name`);
  await page.waitForSelector(".unit-tip.show");
  const html = await page.evaluate(() => document.querySelector(".unit-tip.show").innerHTML);
  assert.match(html, /class="ut-list"/, "能力照旧列出");
  assert.match(html, /class="ut-effects"/); assert.match(html, /灼烧层数/, "效果照旧有说明");
  assert.doesNotMatch(html, /ut-chips|ut-open/, "不是简短版");
  assert.deepEqual(errors, []);
});
