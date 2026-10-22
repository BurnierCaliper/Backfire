// NPC 资料界面（lore-ui.js，角色资料 issue #264）：主持人新建 / 编辑 / 发布（草稿只有主持人看得到），联机玩家只读。
// 画面的拼装在 Node 里测（玩家画面只认 packet.lore 的索引、没有任何编辑按钮），点击流程在真浏览器里测（没装 Playwright 时跳过）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { execSync } = require("node:child_process");
const H = require("./headless");
const L = require("../lore-ui.js");
const ROOT = path.resolve(__dirname, "..");
const plain = x => JSON.parse(JSON.stringify(x));
const TYPES = plain(vm.runInContext("LORE_TYPES", H.load()));
const npc = (id, fields, extra = {}) => ({ id, type: "npc", fields, rev: 1, ...extra });

test("玩家列表：只画收到的索引（packet.lore），没有编辑 / 发布 / 删除按钮；名字照 HTML 转义", () => {
  const html = L.playerHtml({ types: TYPES, list: [npc("a", { name: "特蕾莎<script>", gender: "女", faction: "ARMS" }, { more: true }), npc("b", { name: "" })] });
  assert.match(html, /特蕾莎&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<span class="crq-chip">女<\/span><span class="crq-chip">ARMS<\/span>/, "标题以外的字段按表的顺序");
  assert.match(html, /（未命名）/, "没写姓名");
  assert.match(html, /data-lore="view" data-id="a">查看详细</); assert.match(html, /data-lore="view" data-id="b">查看</);
  assert.doesNotMatch(html, /data-lore="(edit|publish|unpublish|delete|new|save|up|down)"/, "玩家端只读");
  assert.match(L.playerHtml({ types: TYPES, list: [] }), /主持人还没有发布 NPC 资料/);
});

test("玩家详细：字段带名字、详细内容（保留换行的那一段）；没有详细内容、正在要、要不到（重试）、主持人改过（旧的先留着）、撤回了", () => {
  const row = npc("a", { name: "季玛", gender: "男", race: "人类", faction: "沙漠", title: "工匠" }, { rev: 2, more: true });
  const base = { types: TYPES, list: [row], openId: "a" };
  const loaded = L.playerHtml({ ...base, entry: { ...row, body: "“愚人”季玛\n<b>不收加工费</b>" } });
  assert.match(loaded, /<p class="ol-lore-body">“愚人”季玛\n&lt;b&gt;不收加工费&lt;\/b&gt;<\/p>/);
  assert.match(loaded, /性别 · 男[\s\S]*种族 · 人类[\s\S]*阵营 · 沙漠[\s\S]*职位 · 工匠/);
  assert.match(loaded, /data-lore="back"/);
  assert.match(L.playerHtml(base), /正在向主持人要详细内容/);
  const failed = L.playerHtml({ ...base, error: "房主离线，等待恢复连接" });
  assert.match(failed, /房主离线，等待恢复连接/); assert.match(failed, /data-lore="retry"/);
  assert.match(L.playerHtml({ ...base, list: [{ ...row, more: false }] }), /（没有详细内容）/, "没有详细内容就不要了");
  const stale = L.playerHtml({ ...base, list: [{ ...row, rev: 3 }], entry: { ...row, body: "旧的介绍" } });
  assert.match(stale, /主持人改过这条，正在取新的/); assert.match(stale, /旧的介绍/);
  assert.match(L.playerHtml({ ...base, list: [] }), /这条资料现在看不到了/, "撤回或删除了");
});

test("玩家详细：主持人清空了详细内容（索引 rev 变大、没有 more），缓存里的旧正文不再画，也不挂着「正在取新的」", () => {
  const row = npc("a", { name: "季玛" }, { rev: 2, more: true });
  // 玩家点开过 rev 2（缓存着）；主持人把详细内容清空保存，索引里这条变成 rev 3、没有 more
  const html = L.playerHtml({ types: TYPES, list: [npc("a", { name: "季玛" }, { rev: 3 })], openId: "a", entry: { ...row, body: "写错的剧透" } });
  assert.doesNotMatch(html, /写错的剧透/, "清空往往是要撤掉写错的 / 剧透的内容");
  assert.doesNotMatch(html, /正在取新的/, "没有详细内容就不会再去要，不能一直挂着");
  assert.match(html, /（没有详细内容）/);
});

test("主持人列表：草稿和已发布都在（状态写清楚），草稿「发布」、已发布「撤回为草稿」，↑↓ 到头灰掉；认不得的类型只能删；忙的时候全灰", () => {
  const list = [npc("a", { name: "甲" }, { status: "published", body: "第一行\n第二行" }), npc("b", { name: "乙" }, { status: "draft" }), { id: "c", type: "place", fields: { name: "锈港" }, status: "draft" }];
  const html = L.gmHtml({ types: TYPES, list });
  const card = id => html.match(new RegExp(`<article[^>]*data-lore-id="${id}"[\\s\\S]*?</article>`))[0];
  assert.match(card("a"), /ol-q-active/); assert.match(card("a"), /已发布/); assert.match(card("a"), /data-lore="unpublish"/); assert.doesNotMatch(card("a"), /data-lore="publish"/);
  assert.match(card("a"), /第一行 第二行/, "列表上露出详细内容的开头");
  assert.match(card("a"), /data-lore="up" title="往前挪" disabled/);
  assert.match(card("b"), /草稿/); assert.match(card("b"), /data-lore="publish"/);
  assert.match(card("c"), /认不得这种资料，只能删除/); assert.match(card("c"), /data-lore="edit" disabled/); assert.match(card("c"), /data-lore="down" title="往后挪" disabled/);
  assert.match(html, /data-lore="new" data-type="npc">＋ 新建 NPC</);
  const busy = L.gmHtml({ types: TYPES, list, busy: true });
  assert.ok((busy.match(/<button[^>]*data-lore="(?!close)[^"]*"[^>]*>/g) || []).every(b => / disabled/.test(b)), "忙的时候除了关闭都灰掉");
  assert.match(L.gmHtml({ types: TYPES, list, error: "只有主持人可以编辑角色资料" }), /只有主持人可以编辑角色资料/);
});

test("编辑表单：字段、长度上限照 LORE_TYPES（maxlength），详细内容一个大框带字数；草稿有「保存并发布」，已发布的保存就更新；内容照 HTML 转义", () => {
  const e = npc("a", { name: '"引号"<i>', gender: "女" }, { status: "draft", body: "</textarea><b>x</b>" });
  const html = L.editorHtml(e, TYPES);
  for (const f of TYPES.npc.fields) assert.match(html, new RegExp(`${f.label}<input data-lore-field="${f.key}" maxlength="${f.max}"`));
  assert.match(html, /value="&quot;引号&quot;&lt;i&gt;"/);
  assert.match(html, new RegExp(`<textarea data-lore-body rows="10" maxlength="${TYPES.npc.body.max}">&lt;/textarea&gt;&lt;b&gt;x&lt;/b&gt;</textarea>`));
  assert.match(html, new RegExp(`data-lore-count>19 / ${TYPES.npc.body.max}<`));
  assert.match(html, /data-lore="savePublish"/); assert.match(html, /只有你看得到/);
  const pub = L.editorHtml({ ...e, status: "published" }, TYPES);
  assert.doesNotMatch(pub, /data-lore="savePublish"/); assert.match(pub, /保存后玩家看到的跟着更新/);
  assert.equal(L.editorHtml({ ...e, type: "place" }, TYPES), "", "认不得的类型不给编辑");
});

test("界面文件：game.html 先载规则 lore.js、再载 lore-ui.js、再载 online-ui.js；浮层带 .ol-ui（玩家页只放行它）；online-ui 挂上它、工具栏有入口", () => {
  const html = fs.readFileSync(path.join(ROOT, "game.html"), "utf8"), ui = fs.readFileSync(path.join(ROOT, "online-ui.js"), "utf8");
  const at = f => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at("ledger.js") < at("lore.js") && at("commands.js") < at("lore.js") && at("lore.js") < at("online-game.js"));
  assert.ok(at("lore-ui.js") > 0 && at("lore-ui.js") < at("online-ui.js"));
  assert.match(fs.readFileSync(path.join(ROOT, "lore-ui.js"), "utf8"), /box\.className = "ol-ui ol-overlay ol-bag"/);
  assert.match(ui, /LoreUI\.mount\(/); assert.match(ui, /\$\{loreButton\(\)\}/);
  assert.equal(L.ENTRY, "NPC 资料", "和工具栏上已有的「角色资料」（自己角色的卡）区分开");
});

/* ---------- 真浏览器 ---------- */
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
}
let browser;
test.before(async () => { try { browser = await playwright().chromium.launch(); } catch (error) { if (process.env.REQUIRE_UI === "1") throw error; } });
test.after(async () => { if (browser) await browser.close(); });
async function open(t, mobile = false) {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 }, isMobile: mobile, hasTouch: mobile });
  t.after(() => context.close());
  const page = await context.newPage(), errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><section id="scr-title"><div class="t-menu"></div></section><header class="tr-top"><button class="g-btn" id="tr-bestiary">图鉴</button></header><main class="g-app">Original host battlefield</main></body>');
  for (const file of ["game.css", "skin.css", "online.css"]) await page.addStyleTag({ path: path.resolve(ROOT, file) });
  await page.evaluate(() => {
    const players = [{ id: "gm", name: "主持人", gm: true, online: true }, { id: "p1", name: "甲", online: true }];
    const state = { displayOnly: true, units: [], turnNo: 1, zoneMode: 2, weather: "none", props: [] };
    const heroes = [];
    window.fixture = { calls: [], listeners: [], packets: [], gmLore: [], bodies: {}, nextId: 1,
      view: { active: false, isHost: false, mode: "trpg", identity: null, status: { connected: true, hostOnline: true, paused: false, roster: players }, screen: "exploration", roomCode: "ABCD23", players, state, heroes, messages: [],
        packet: { mode: "trpg", view: { mode: "trpg", playerId: "p1", hostId: "gm", units: heroes, heroes, phase: "setup", order: [] }, state, publicLogs: [], lore: [] } },
      emit() { this.listeners.forEach(fn => fn()); }, set(data) { Object.assign(this.view, data); this.emit(); },
      setLore(lore) { this.view.packet = { ...this.view.packet, lore }; this.emit(); }
    };
    const record = (kind, args) => { fixture.calls.push({ kind, args: args == null ? null : JSON.parse(JSON.stringify(args)) }); };
    window.OnlineGame = {
      getView: () => JSON.parse(JSON.stringify(fixture.view)), slots: () => [], hasSaved: () => false,
      submit(cmd) {
        record("submit", cmd);
        if (cmd.type === "lore" && cmd.action === "create") { const id = "new" + fixture.nextId++; fixture.gmLore.push({ id, type: "npc", fields: { name: "", gender: "", race: "", faction: "", title: "" }, body: "", status: "draft", rev: 1 }); fixture.emit(); return Promise.resolve({ ok: true, id }); }
        if (cmd.type === "lore" && cmd.action === "save") { const e = fixture.gmLore.find(x => x.id === cmd.entry.id); Object.assign(e.fields, cmd.entry.fields); e.body = cmd.entry.body; if (cmd.status) e.status = cmd.status; fixture.emit(); }
        return Promise.resolve({ ok: true });
      },
      loreAll: () => fixture.view.isHost ? JSON.parse(JSON.stringify(fixture.gmLore)) : null,
      loreEntry(id) { record("loreEntry", id); const row = (fixture.view.packet.lore || []).find(e => e.id === id); return Promise.resolve({ type: "loreEntry", displayOnly: true, entry: row ? { ...row, body: fixture.bodies[id] || "" } : null }); },
      reconnect() {}, leave() {},
      subscribe(fn) { fixture.listeners.push(fn); return () => { fixture.listeners = fixture.listeners.filter(f => f !== fn); }; },
      onPacket(fn) { fixture.packets.push(fn); return () => { fixture.packets = fixture.packets.filter(f => f !== fn); }; }
    };
    // 玩家画面不碰规则：读到这些入口直接报错
    for (const name of ["GAME", "state", "BattleCommands", "dispatch", "skillFlowSteps", "previewOf", "Screens", "LEDGER"]) Object.defineProperty(window, name, { configurable: true, get() { throw new Error("Display touched rules: " + name); } });
  });
  for (const file of ["lore.js", "hud-icons.js", "unit-card.js", "unit-tip.js", "online-battle.js", "lore-ui.js", "online-ui.js"]) await page.addScriptTag({ path: path.resolve(ROOT, file) });
  return { page, errors };
}
const calls = (page, kind) => page.evaluate(kind => fixture.calls.filter(c => c.kind === kind).map(c => c.args), kind);
const pubRow = (id, name, rev = 1, more = true) => ({ id, type: "npc", fields: { name, gender: "女", race: "人类", faction: "ARMS", title: "武器工匠" }, rev, ...(more ? { more: true } : {}) });

test("玩家：工具栏「NPC 资料」→ 列表 → 点开才向房主要详细内容，取过的不再要，主持人改了（rev 变大）再要一次；390px 不横向溢出，按钮 ≥ 44px", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o;
  await page.evaluate(() => { fixture.bodies.a = "第一行\n第二行"; fixture.set({ active: true, isHost: false, identity: { id: "p1" } }); fixture.setLore([]); });
  await page.click('#online-stage [data-online="lore"]');
  assert.match(await page.locator("#online-lore").innerText(), /主持人还没有发布 NPC 资料/);
  await page.evaluate(row => fixture.setLore([row]), pubRow("a", "特蕾莎"));
  await page.click('#online-lore [data-lore="view"]');
  await page.waitForSelector("#online-lore .ol-lore-body");
  assert.equal(await page.locator("#online-lore .ol-lore-body").innerText(), "第一行\n第二行", "换行照原样");
  assert.deepEqual(await calls(page, "loreEntry"), ["a"]);
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth <= innerWidth, minH: Math.min(...[...document.querySelectorAll("#online-lore button")].map(b => b.getBoundingClientRect().height)) }));
  assert.equal(sizes.page, true); assert.ok(sizes.minH >= 44, "按钮高度 " + sizes.minH);
  await page.click('#online-lore [data-lore="back"]'); await page.click('#online-lore [data-lore="view"]');
  await page.waitForSelector("#online-lore .ol-lore-body");
  assert.deepEqual(await calls(page, "loreEntry"), ["a"], "取过的不再要");
  await page.evaluate(row => { fixture.bodies.a = "改过的介绍"; fixture.setLore([row]); }, pubRow("a", "特蕾莎", 2));
  await page.waitForFunction(() => document.querySelector("#online-lore .ol-lore-body")?.innerText === "改过的介绍");
  assert.deepEqual(await calls(page, "loreEntry"), ["a", "a"], "rev 变大再要一次");
  await page.evaluate(row => fixture.setLore([row]), pubRow("a", "特蕾莎", 3, false));   // 主持人把详细内容清空了
  const cleared = await page.locator("#online-lore").innerText();
  assert.match(cleared, /（没有详细内容）/); assert.doesNotMatch(cleared, /改过的介绍|正在取新的/, "缓存的旧正文不画");
  assert.deepEqual(await calls(page, "loreEntry"), ["a", "a"], "没有详细内容就不再要");
  await page.evaluate(() => fixture.setLore([]));
  assert.match(await page.locator("#online-lore").innerText(), /这条资料现在看不到了/, "主持人撤回了");
  await page.keyboard.press("Escape");
  assert.equal(await page.isVisible("#online-lore"), false);
  assert.deepEqual(o.errors, []);
});

test("玩家：主持人新发布的弹一句提示；刚进房间收到的不算新的", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  // 进房间收到的第一包就带着已有的资料
  await page.evaluate(row => { fixture.view.packet.lore = [row]; fixture.set({ active: true, isHost: false, identity: { id: "p1" } }); }, pubRow("a", "旧人物"));
  assert.equal(await page.isVisible(".ol-toast"), false);
  await page.evaluate(rows => fixture.setLore(rows), [pubRow("a", "旧人物"), pubRow("b", "新人物", 1, false)]);
  assert.match(await page.locator(".ol-toast").innerText(), /新的 NPC 资料：「新人物」/);
  assert.deepEqual(o.errors, []);
});

test("主持人：探索顶栏（图鉴旁边）有「NPC 资料」→ 新建 → 填写（收到新包时表单不重画、不打断打字）→ 保存并发布；草稿、已发布都看得到", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await page.evaluate(() => { fixture.gmLore.push({ id: "d1", type: "npc", fields: { name: "鬼面人", gender: "", race: "", faction: "", title: "" }, body: "真实身份", status: "draft", rev: 1 }); fixture.set({ active: true, isHost: true, identity: { id: "gm" } }); });
  assert.equal(await page.evaluate(() => document.querySelector("#tr-bestiary").nextElementSibling?.id), "tr-lore");
  await page.click("#tr-lore");
  assert.match(await page.locator('#online-lore [data-lore-id="d1"]').innerText(), /鬼面人[\s\S]*草稿/);
  await page.click('#online-lore [data-lore="new"]');
  assert.deepEqual((await calls(page, "submit")).at(-1), { type: "lore", action: "create", entryType: "npc" });
  await page.waitForSelector('#online-lore [data-lore-field="name"]');
  await page.fill('#online-lore [data-lore-field="name"]', "季玛");
  await page.focus('#online-lore [data-lore-body]'); await page.keyboard.type("住在沙漠");
  await page.evaluate(() => fixture.emit());   // 来了新包：表单不重画
  assert.equal(await page.evaluate(() => document.activeElement?.matches("[data-lore-body]")), true, "焦点还在");
  assert.equal(await page.inputValue('#online-lore [data-lore-body]'), "住在沙漠");
  assert.match(await page.locator("#online-lore [data-lore-count]").innerText(), /^4 \//);
  await page.click('#online-lore [data-lore="savePublish"]');
  const save = (await calls(page, "submit")).at(-1);
  assert.deepEqual(save, { type: "lore", action: "save", entry: { id: "new1", fields: { name: "季玛", gender: "", race: "", faction: "", title: "" }, body: "住在沙漠" }, status: "published" });
  await page.waitForSelector('#online-lore [data-lore-id="new1"]');
  assert.match(await page.locator('#online-lore [data-lore-id="new1"]').innerText(), /季玛[\s\S]*已发布/);
  assert.deepEqual(o.errors, []);
});

test("联机单局：玩家工具栏没有「NPC 资料」，主持人顶栏也没有", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await page.evaluate(() => { fixture.view.packet.mode = "rogue"; fixture.set({ active: true, isHost: false, identity: { id: "p1" } }); });
  assert.equal(await page.locator('#online-stage [data-online="lore"]').count(), 0);
  await page.evaluate(() => fixture.set({ isHost: true, mode: "rogue", identity: { id: "gm" } }));
  assert.equal(await page.locator("#tr-lore").count(), 0);
  assert.deepEqual(o.errors, []);
});
