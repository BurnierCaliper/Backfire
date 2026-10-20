// 攻击演出（attack-fx.js）在真浏览器里：出手时按招式画刀光 / 弹道，攻击者冲过去、目标被打退，
// 敌人倒下喷红叉，敌人回合问格挡时问题框贴底、战场上画出这一击的指向，选目标时有瞄准线。
// 需要 Playwright（同 tests/ui.test.js）；找不到就整组跳过，`npm run test:ui` 时必须跑。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");
const { execSync } = require("child_process");

function findPlaywright() {
  try { return require("playwright"); } catch (e) {}
  try {
    const root = execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return require(path.join(root, "playwright"));
  } catch (e) {}
  return null;
}
const pw = findPlaywright();
const GAME_URL = pathToFileURL(path.resolve(__dirname, "..", "game.html")).href;
const requireUI = process.env.REQUIRE_UI === "1";

let browser = null;
let skipWhy = pw ? "" : "没装 Playwright，跳过画面测试";
test.before(async () => {
  if (!pw) {
    if (requireUI) throw new Error("UI 验收需要 Playwright；请安装或通过 NODE_PATH 指定现有安装。");
    return;
  }
  try { browser = await pw.chromium.launch(); } catch (e) {
    if (requireUI) throw e;
    skipWhy = "浏览器启动失败，跳过画面测试：" + e.message.split("\n")[0];
  }
});
test.after(async () => { if (browser) await browser.close(); });

async function open(t) {
  if (!browser) { t.skip(skipWhy); return null; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("dialog", d => (d.type() === "prompt" ? d.accept("测试团") : d.accept()));
  await page.goto(GAME_URL);
  await page.evaluate(() => {
    window.__noLevelUpPopup = true;
    // 记下演出层画了什么：每一下打中的招式、喷了几个红叉、瞄准线 / 攻击指向画过没有
    window.__fx = { impacts: [], ko: 0, aim: 0, threat: 0, sparks: [], laser: [] };
    const wrap = (k, fn) => { const f = AttackFx[k]; AttackFx[k] = function () { fn.apply(null, arguments); return f.apply(this, arguments); }; };
    wrap("impact", (at, move) => window.__fx.impacts.push(move && move.kind));
    wrap("ko", () => { window.__fx.ko++; });
    wrap("aim", () => { window.__fx.aim++; });
    wrap("threat", () => { window.__fx.threat++; });
    wrap("sparks", (at) => window.__fx.sparks.push(at));
    // 瑞比普攻的专属演出（青色激光）：出手 / 后几段 / 打中各记一笔
    const L = AttackFx.script("laser");
    ["pre", "again", "impact"].forEach(k => { const f = L[k]; L[k] = function () { window.__fx.laser.push(k); return f.apply(this, arguments); }; });
  });
  t.after(() => context.close());
  return { page, errors };
}
async function startBattle(page, prep) {
  await page.click("#t-online"); await page.click("#t-sandbox");
  await page.click('[data-new="0"]');
  await page.waitForSelector("#scr-trpg:not([hidden])");
  await page.click("#tr-fight");
  await page.waitForSelector("#g-start");
  if (prep) await page.evaluate(prep);
  await page.keyboard.press("Space");
  await page.waitForFunction(() => state.combatStarted && state.combatPhase === "player" && GAME.depth === 0, null, { timeout: 15000 });
}
async function selectHero(page, kit) {
  const id = await page.evaluate(k => (partyHeroes().find(h => h.kit === k) || {}).id, kit);
  assert.ok(id, "队伍里没有 " + kit);
  await page.click(`.unit-wrap[data-id="${id}"]`);
  await page.waitForFunction(i => GAME.actorId === i, id);
  return id;
}

test("攻击演出：绯秋近身一刀——瞄准时有瞄准线，出手冲过去、画刀光，目标顺着挨打的方向被打退", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await startBattle(page, () => {
    Math.random = () => 0.5;
    const foe = state.units.find(u => !u.isPlayer); foe.zone = 1;
  });
  await page.evaluate(() => {
    window.__seen = { lunge: false, knock: false };
    new MutationObserver(() => {
      if (document.querySelector(".unit-wrap.lunge")) window.__seen.lunge = true;
      if (document.querySelector(".unit-wrap.hit.knock")) window.__seen.knock = true;
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  const hiaki = await selectHero(page, "hiaki");
  const foe = await page.evaluate(() => state.units.find(u => !u.isPlayer && Number(u.zone) === 1).id);
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  await page.hover(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForFunction(() => window.__fx.aim > 0, null, { timeout: 3000 });
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForFunction(i => state.units.find(u => u.id === i).ap === 0 && GAME.depth === 0, hiaki, { timeout: 15000 });
  const fx = await page.evaluate(() => window.__fx);
  assert.ok(fx.impacts.includes("slash"), "绯秋的普通攻击按刀光演：" + JSON.stringify(fx.impacts));
  assert.ok(await page.evaluate(() => window.__seen.lunge), "攻击者冲过去");
  assert.ok(await page.evaluate(() => window.__seen.knock), "目标顺着挨打的方向被打退");
  assert.ok(await page.evaluate(() => !!document.getElementById("atk-fx")), "演出画布在页面上");
  assert.deepEqual(o.errors, []);
});

test("攻击演出：瑞比普攻是两束青色激光——两段各补一个落点；打倒的敌人等这一下演完才淡出，红叉跟着卡", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await startBattle(page, () => {
    Math.random = () => 0.999;
    const foes = state.units.filter(u => !u.isPlayer);
    state.units = state.units.filter(u => u.isPlayer || u === foes[0]);
    foes[0].layers.forEach(l => { l.current = 1; });
  });
  const ruby = await selectHero(page, "ruby");
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => state.units.find(u => !u.isPlayer).id);
  // 记下这张卡每次变样：倒下（dead）的那一刻是不是留着（ko-held、不透明），什么时候放开
  await page.evaluate((id) => {
    window.__card = [];
    new MutationObserver(() => {
      const c = document.querySelector(`.unit-wrap[data-id="${id}"]`);
      if (!c) return;
      const last = window.__card[window.__card.length - 1], now = { dead: c.classList.contains("dead"), held: c.classList.contains("ko-held"), laser: window.__fx.laser.length };
      if (!last || last.dead !== now.dead || last.held !== now.held) window.__card.push(Object.assign(now, { op: getComputedStyle(c).opacity }));
    }).observe(document.getElementById("g-field"), { subtree: true, attributes: true, attributeFilter: ["class"] });
  }, foe);
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForFunction(() => GAME.ended || (GAME.depth === 0 && state.units.find(u => !u.isPlayer).dead), null, { timeout: 15000 });
  await page.waitForFunction(() => window.__fx.ko > 0, null, { timeout: 5000 });
  const fx = await page.evaluate(() => window.__fx);
  assert.equal(fx.laser[0], "pre", "先射出激光：" + JSON.stringify(fx.laser));
  assert.equal(fx.laser.filter(k => k === "impact").length, 2, "两段激光各有落点：" + JSON.stringify(fx.laser));
  assert.equal(fx.ko, 1, "敌人倒下喷一个红叉");
  const card = await page.evaluate(() => window.__card);
  const died = card.find(x => x.dead);
  assert.ok(died && died.held && died.op === "1", "倒下的那一刻卡片留着、不透明：" + JSON.stringify(card));
  const freed = card.find(x => x.dead && !x.held);
  assert.ok(freed && freed.laser === 4, "两段激光都演完才放开淡出：" + JSON.stringify(card));
  assert.ok(ruby);
  assert.deepEqual(o.errors, []);
});

test("协助攻击：镜头推近目标、战场外的界面压暗，演完迅速拉回，不留动画和暗角", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await startBattle(page, () => { Math.random = () => 0.999; });
  await page.evaluate(() => {
    // 开战会回满架势：开战后再把架势改成 1，瑞比一下就打出失衡；血多一点，免得直接打死
    state.units.filter(u => !u.isPlayer).forEach(u => { u.def = 1; u.layers.forEach(l => { l.max = Math.max(l.max, 40); l.current = 40; }); });
    GAME.refresh();
    window.__focus = { on: false, hudDim: false };
    new MutationObserver(() => {
      const app = document.getElementById("g-app");
      if (!app.classList.contains("assist-focus")) return;
      window.__focus.on = true;
      setTimeout(() => { if (/brightness/.test(getComputedStyle(document.querySelector(".g-hud")).filter)) window.__focus.hudDim = true; }, 200);
    }).observe(document.getElementById("g-app"), { attributes: true, attributeFilter: ["class"] });
  });
  await selectHero(page, "ruby");
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => [...GAME.arm.map.entries()].find(([id, c]) => !c.invalid && !String(id).includes(":"))[0]);
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForFunction(() => !!document.querySelector("#g-choice.show") && /失衡/.test(document.querySelector("#g-choice.show h3").textContent), null, { timeout: 15000 });
  await page.click("#g-choice.show .opts button >> nth=0");
  // 绯秋 / 龙哥还会再问用哪把武器：选第一项
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(150);
    const ask = await page.evaluate(() => { const c = document.querySelector("#g-choice.show"); return c ? c.querySelector("h3").textContent : ""; });
    if (!/协助攻击|手杖/.test(ask) || /失衡/.test(ask)) break;
    await page.click("#g-choice.show .opts button >> nth=0");
  }
  await page.waitForFunction(() => GAME.depth === 0 && !document.querySelector("#g-choice.show"), null, { timeout: 20000 });
  await page.waitForTimeout(400);
  const f = await page.evaluate(() => window.__focus);
  assert.ok(f.on, "协助攻击时推镜头");
  assert.ok(f.hudDim, "战场外的界面压暗");
  const after = await page.evaluate(() => ({
    focus: document.getElementById("g-app").classList.contains("assist-focus"),
    anims: [...document.querySelectorAll("#g-field > *, .g-hud, .g-log")].reduce((n, el) => n + el.getAnimations().length, 0),
    vignette: getComputedStyle(document.getElementById("g-field"), "::after").opacity
  }));
  assert.deepEqual(after, { focus: false, anims: 0, vignette: "0" }, "演完拉回原样");
  assert.deepEqual(o.errors, []);
});

test("格挡成功：队长·牛替同伙挡下瑞比这一下——金色火花在两人连线的中点", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await page.click("#t-online"); await page.click("#t-sandbox");
  await page.click('[data-new="0"]');
  await page.waitForSelector("#scr-trpg:not([hidden])");
  // 牛队长替同伙（同为官方的安保机器人看守）挡
  await page.evaluate(() => { GAME.enemyPlan = [{ id: "captain_ox", lv: 1, zone: 2 }, { id: "guard_sword", lv: 1, zone: 2 }]; GAME.lastEncounter = null; });
  await page.click("#tr-fight");
  await page.waitForSelector("#g-start");
  await page.keyboard.press("Space");
  await page.waitForFunction(() => state.combatStarted && state.combatPhase === "player" && GAME.depth === 0, null, { timeout: 15000 });
  await page.evaluate(() => { Math.random = () => 0; });   // d100 掷出 1：格挡必定成功
  await selectHero(page, "ruby");
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const ids = await page.evaluate(() => ({ ruby: GAME.actorId, guard: state.units.find(u => u.kit === "guard_sword").id, ox: state.units.find(u => u.kit === "captain_ox").id }));
  await page.click(`.unit-wrap[data-id="${ids.guard}"]`);
  await page.waitForFunction(() => window.__fx.sparks.length > 0 && GAME.depth === 0, null, { timeout: 15000 });
  const sp = await page.evaluate(() => window.__fx.sparks);
  const c = await page.evaluate((ids) => Object.fromEntries(Object.entries(ids).map(([k, id]) => {
    const r = document.querySelector(`.unit-wrap[data-id="${id}"]`).getBoundingClientRect();
    return [k, { x: r.left + r.width / 2, y: r.top + r.height * .42 }];
  })), ids);
  assert.equal(sp.length, 1, "一下格挡一把火花");
  const mid = { x: (c.ruby.x + c.ox.x) / 2, y: (c.ruby.y + c.ox.y) / 2 };
  assert.ok(Math.abs(sp[0].x - mid.x) < 40 && Math.abs(sp[0].y - mid.y) < 40, `火花在瑞比和牛的中点：${JSON.stringify(sp[0])} vs ${JSON.stringify(mid)}`);
  assert.deepEqual(o.errors, []);
});

test("专属演出在浏览器里逐个画一遍（动画效果文档里的每个技能）：画布没有画坏的帧，也不报错", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await startBattle(page, () => { Math.random = () => 0.5; });
  const result = await page.evaluate(async () => {
    AttackFx.setClock(() => .25);   // 四倍速：每个效果照样画好几帧
    const cards = [...document.querySelectorAll("#g-field .unit-wrap")].slice(0, 4);
    const rectOfCard = (n) => { const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * .42, w: b.width, h: b.height }; };
    const ids = ["a", "o", "tt", "t2"], R = {};
    ids.forEach((id, i) => { R[id] = rectOfCard(cards[i % cards.length]); });
    const zone = (n) => { const z = document.querySelector(`#g-field .g-zone[data-num="${n}"]`).getBoundingClientRect(); return { x: z.left + z.width / 2, y: z.top + z.height / 2, w: z.width, h: z.height }; };
    const names = [...new Set(Object.values(AttackFx.SCRIPT_OF))];
    const failed = [];
    for (const name of names) {
      const s = AttackFx.script(name);
      for (const variant of [{ ally: false, el: "fire", dir: "push" }, { ally: true, el: "acid", dir: "pull", pierced: "tt" }]) {
        const mains = [{ unitId: "tt", element: variant.el, kind: "dmg", main: true }, { unitId: "t2", element: variant.el, kind: "dmg", main: true }];
        const c = {
          actor: "a", target: variant.ally ? "o" : "tt", targets: ["tt", "t2"], mains, move: { kind: "smash", el: variant.el },
          data: { ally: variant.ally, dist: 1, pierced: variant.pierced || null, owner: "o", dir: variant.dir, zoneOf: 2 },
          rect: (id) => (typeof id === "number" ? zone(id) : R[id] || null), zoneRect: (x) => zone(typeof x === "number" ? x : 2),
          wait: (ms) => AttackFx.after(ms), dash: async () => {}, recoil() {}, nudge() {}, shake() {}, cls() {}, burst() {}, owner: () => "o"
        };
        try {
          if (s.pre) await s.pre(c); else if (s.self) await s.self(c);
          if (s.again) await s.again(c, mains[1], 1);
          if (s.impact) { s.impact(c, mains[0], 0, true); s.impact(c, mains[1], 1, false); }
        } catch (e) { failed.push(name + ": " + e.message); }
      }
      await new Promise(r => setTimeout(r, 60));
    }
    await new Promise(r => { const t0 = performance.now(); (function w() { if (!AttackFx.busy() || performance.now() - t0 > 4000) r(); else requestAnimationFrame(w); })(); });
    return { failed, drawErrors: AttackFx.drawErrors(), names: names.length };
  });
  assert.ok(result.names >= 50, "脚本表在：" + result.names);
  assert.deepEqual(result.failed, []);
  assert.equal(result.drawErrors, 0, "画的时候出错的次数");
  assert.deepEqual(o.errors, []);
});

test("敌人回合问协助格挡：问题框贴在底部、战场不压暗，画出敌人这一击从谁指向谁", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await startBattle(page, () => {
    Math.random = () => 0.5;
    state.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 1; });
  });
  await page.keyboard.press("Space");
  // 还有行动点没用：先确认结束回合（普通确认框，不贴底）
  await page.waitForSelector("#g-choice.show", { timeout: 20000 });
  if (await page.evaluate(() => document.querySelector("#g-choice.show h3").textContent === "结束回合")) {
    assert.equal(await page.evaluate(() => document.getElementById("g-choice").classList.contains("dock")), false, "普通确认框照旧居中压暗");
    await page.keyboard.press("1");
    await page.waitForFunction(() => !!document.querySelector("#g-choice.show") && document.querySelector("#g-choice.show h3").textContent !== "结束回合", null, { timeout: 20000 });
  }
  assert.match(await page.evaluate(() => document.querySelector("#g-choice.show h3").textContent), /攻击|处刑/, "敌人打过来，问要不要格挡");
  assert.ok(await page.evaluate(() => document.getElementById("g-choice").classList.contains("dock")), "格挡询问贴底");
  assert.ok(await page.evaluate(() => window.__fx.threat > 0), "战场上画出这一击的指向");
  const bg = await page.evaluate(() => getComputedStyle(document.getElementById("g-choice")).backgroundImage);
  assert.match(bg, /gradient/, "上半截几乎不压暗（渐变）");
  await page.keyboard.press("Escape");   // 不格挡
  await page.waitForFunction(() => !document.querySelector("#g-choice.show") || document.querySelector("#g-choice.show h3").textContent, null, { timeout: 5000 });
  // 收起之后不是贴底样式残留在别的问题上：随便开一个普通确认框看一眼
  await page.waitForFunction(() => state.combatPhase === "player" && GAME.depth === 0 || !!document.querySelector("#g-choice.show"), null, { timeout: 30000 });
  assert.deepEqual(o.errors, []);
});

test("协助攻击打死自爆小车：打击形状只落在小车身上，然后小车引爆（以前协助攻击的刀光挨个落到被炸到的队友身上）", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await page.click("#t-online"); await page.click("#t-sandbox");
  await page.click('[data-new="0"]');
  await page.waitForSelector("#scr-trpg:not([hidden])");
  await page.evaluate(() => { GAME.enemyPlan = [{ id: "boomcar", lv: 3, zone: 2 }, { id: "thug_knife", lv: 1, zone: 2 }]; GAME.lastEncounter = null; });
  await page.click("#tr-fight");
  await page.waitForSelector("#g-start");
  await page.keyboard.press("Space");
  await page.waitForFunction(() => state.combatStarted && state.combatPhase === "player" && GAME.depth === 0, null, { timeout: 15000 });
  const car = await page.evaluate(() => {
    Math.random = () => 0.999;
    const c = state.units.find(u => u.kit === "boomcar");
    // 队友站到小车那一区（会被引爆炸到），瑞比是远程、留在 1 区；小车架势 1、血厚：瑞比一下打出失衡但打不死
    partyHeroes().forEach(h => { h.zone = h.kit === "ruby" ? 1 : 2; });
    c.def = 1; c.atk = Math.max(10, c.atk || 0);
    c.layers.forEach(l => { l.max = Math.max(l.max, 60); l.current = 60; });
    GAME.refresh();
    // 记下每个打击形状画在哪张卡上（离落点最近的）
    window.__hitOn = [];
    const f = AttackFx.impact;
    AttackFx.impact = function (at, move) {
      let best = null, bd = 1e9;
      document.querySelectorAll(".unit-wrap[data-id]").forEach(el => {
        const r = el.getBoundingClientRect(), d = Math.hypot(r.left + r.width / 2 - at.x, r.top + r.height / 2 - at.y);
        if (d < bd) { bd = d; best = el.dataset.id; }
      });
      window.__hitOn.push({ kind: move && move.kind, id: best });
      return f.apply(this, arguments);
    };
    return c.id;
  });
  await selectHero(page, "ruby");
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  await page.click(`.unit-wrap[data-id="${car}"]`);
  await page.waitForFunction(() => !!document.querySelector("#g-choice.show") && /失衡/.test(document.querySelector("#g-choice.show h3").textContent), null, { timeout: 20000 });
  // 协助攻击这一下要把小车打死：血压到 1
  await page.evaluate(i => { const c = state.units.find(u => u.id === i); c.layers.forEach((l, k) => { l.current = k === c.layers.length - 1 ? 1 : 0; }); window.__hitOn = []; }, car);
  await page.click("#g-choice.show .opts button >> nth=0");
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(150);
    const ask = await page.evaluate(() => { const c = document.querySelector("#g-choice.show"); return c ? c.querySelector("h3").textContent : ""; });
    if (!/协助攻击|手杖/.test(ask) || /失衡/.test(ask)) break;
    await page.click("#g-choice.show .opts button >> nth=0");
  }
  await page.waitForFunction(() => GAME.depth === 0 && !document.querySelector("#g-choice.show"), null, { timeout: 30000 });
  const r = await page.evaluate(() => ({ hits: window.__hitOn, log: (state.logPages || []).flatMap(p => p.lines || []).map(l => l.text).join("\n") }));
  assert.match(r.log, /自爆小车 死亡引爆/, "小车被协助攻击打死并引爆");
  assert.ok(r.hits.length >= 2, "协助攻击的打击形状 + 引爆的爆炸：" + JSON.stringify(r.hits));
  assert.ok(r.hits.every(h => h.id === car), "打击形状都落在小车身上：" + JSON.stringify(r.hits));
  assert.equal(r.hits[r.hits.length - 1].kind, "explode", "最后是小车炸开");
  assert.deepEqual(o.errors, []);
});

test("演出 2× 和点击跳过：攻击演出跟着加速 / 立刻收掉，不拖住战斗", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await startBattle(page, () => { Math.random = () => 0.5; });
  await page.keyboard.press("f");
  assert.equal(await page.evaluate(() => GAME.fast), true);
  const ruby = await selectHero(page, "ruby");
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => state.units.find(u => !u.isPlayer && !u.dead).id);
  const t0 = Date.now();
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForTimeout(60);
  await page.click(`.unit-wrap[data-id="${ruby}"]`).catch(() => {});   // 演出中点战场 = 跳过
  await page.waitForFunction(i => state.units.find(u => u.id === i).ap === 0 && GAME.depth === 0, ruby, { timeout: 15000 });
  assert.ok(Date.now() - t0 < 6000, "跳过后很快结束：" + (Date.now() - t0) + "ms");
  await page.waitForFunction(() => !AttackFx.busy(), null, { timeout: 3000 });
  assert.deepEqual(o.errors, []);
});
