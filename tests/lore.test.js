// 角色资料（NPC 条目，issue #264）：主持人新建 / 编辑 / 发布，联机玩家只读。
// 规则（lore.js）、存档（LEDGER.lore 跟着跑团存档和联机房间的检查点走）、给玩家的白名单（online-view.js · projectLore / projectLoreEntry）、
// 包大小（online-wire.js：没变只带 loreUnchanged，改了只发改了的条目；详细内容玩家点开时才要），以及真实联机协调层里玩家看不到草稿
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const H = require("./headless");
const OV = require("../online-view.js");
const OnlineWire = require("../online-wire.js");
const plain = x => JSON.parse(JSON.stringify(x));
const BUILD = "backfire-d3-v1";
// 零宽空格、从右到左覆盖（不直接写进源码：看不见，双向控制字符还会把这一行显示乱）
const ZWSP = String.fromCharCode(0x200b), RLO = String.fromCharCode(0x202e);

function rules() {
  const c = H.load();
  c.LEDGER.lore = [];
  const run = cmd => c.Commands.dispatch(Object.assign({ type: "lore" }, cmd));
  const TYPES = plain(vm.runInContext("LORE_TYPES", c)), LIMITS = plain(vm.runInContext("LORE_LIMITS", c));
  return { c, run, TYPES, LIMITS, list: () => plain(c.loreList()), byId: id => plain(c.loreById(id)) };
}

/* ---------- 规则（lore.js） ---------- */
test("新建是草稿：字段全空、rev 1；草稿不进玩家的索引，玩家要详细内容也是 null", () => {
  const { c, run, list, TYPES } = rules();
  const { id } = run({ action: "create", entryType: "npc" });
  const e = list()[0];
  assert.equal(e.id, id); assert.equal(e.type, "npc"); assert.equal(e.status, "draft"); assert.equal(e.rev, 1); assert.equal(e.body, "");
  assert.deepEqual(Object.keys(e.fields), TYPES.npc.fields.map(f => f.key), "字段照 LORE_TYPES：姓名、性别、种族、阵营、职位");
  assert.deepEqual(TYPES.npc.fields.map(f => f.label), ["姓名", "性别", "种族", "阵营", "职位"]);
  assert.equal(TYPES.npc.body.label, "详细内容");
  assert.ok(Object.values(e.fields).every(v => v === ""));
  assert.deepEqual(plain(c.lorePublicIndex()), []);
  assert.equal(c.lorePublicEntry(id), null);
  assert.match(id, /^lore-\d+-\d+$/, "id 只用数字，不会撞上联机白名单的敏感词（online-view.js · id）");
});

test("保存：按 LORE_TYPES 截长度、去控制字符和零宽字符，详细内容保留换行；只认字符串，没传的字段照旧；内容变了 rev + 1，没变不加", () => {
  const { c, run, byId, TYPES } = rules();
  const { id } = run({ action: "create" });
  const max = Object.fromEntries(TYPES.npc.fields.map(f => [f.key, f.max]));
  run({ action: "save", entry: { id, fields: { name: `  特蕾莎${ZWSP}·特雷丝\n `, gender: "女", race: "人".repeat(200), faction: 12, title: "武器工匠" }, body: "第一行\r\n第二行\t有制表符\u0007\n\n" } });
  let e = byId(id);
  assert.equal(e.fields.name, "特蕾莎·特雷丝", "去掉头尾空白、零宽字符，换行换成空格再去掉");
  assert.equal(e.fields.race.length, max.race, "种族截到配置的长度");
  assert.equal(e.fields.faction, "", "不是字符串的不收（新建时是空的）");
  assert.equal(e.body, "第一行\n第二行 有制表符", "\\r\\n 统一成 \\n，制表符换成空格，控制字符去掉，结尾空白去掉");
  assert.equal(e.rev, 2); assert.ok(e.at > 0);
  run({ action: "save", entry: { id, fields: { faction: "ARMS" } } });
  e = byId(id);
  assert.equal(e.fields.name, "特蕾莎·特雷丝", "没传的字段照旧"); assert.equal(e.fields.faction, "ARMS"); assert.equal(e.body, "第一行\n第二行 有制表符", "没传详细内容就照旧");
  assert.equal(e.rev, 3);
  run({ action: "save", entry: { id, fields: { faction: "ARMS" }, body: "第一行\n第二行 有制表符" } });
  assert.equal(byId(id).rev, 3, "内容没变，rev 不加（玩家端缓存的详细内容照样能用）");
  run({ action: "save", entry: { id, body: "长".repeat(TYPES.npc.body.max + 50) } });
  assert.equal(byId(id).body.length, TYPES.npc.body.max, "详细内容截到配置的长度");
  // 截长度不把一个 emoji 切成两半
  run({ action: "save", entry: { id, fields: { gender: "a".repeat(max.gender - 1) + "😀" } } });
  assert.equal(byId(id).fields.gender, "a".repeat(max.gender - 1));
});

test("发布 / 撤回为草稿 / 保存并发布 / 排序 / 删除；没有这条、不认识的状态和动作都报错，不改数据", () => {
  const { c, run, list, byId } = rules();
  const a = run({ action: "create" }).id, b = run({ action: "create" }).id, d = run({ action: "create" }).id;
  run({ action: "save", entry: { id: a, fields: { name: "甲" } } });
  run({ action: "status", id: a, status: "published" });
  assert.equal(byId(a).status, "published");
  assert.deepEqual(plain(c.lorePublicIndex()).map(e => e.id), [a]);
  run({ action: "save", entry: { id: b, fields: { name: "乙" } }, status: "published" });
  assert.equal(byId(b).status, "published", "保存并发布");
  run({ action: "status", id: a, status: "draft" });
  assert.deepEqual(plain(c.lorePublicIndex()).map(e => e.id), [b], "撤回为草稿：玩家的索引里没了");
  run({ action: "move", id: d, dir: -1 });
  assert.deepEqual(list().map(e => e.id), [a, d, b]);
  run({ action: "move", id: a, dir: -1 });
  assert.deepEqual(list().map(e => e.id), [a, d, b], "已经在最前面");
  run({ action: "delete", id: d });
  assert.deepEqual(list().map(e => e.id), [a, b]);
  const before = JSON.stringify(list());
  assert.throws(() => run({ action: "save", entry: { id: "lore-nope", fields: { name: "x" } } }), /没有这条资料/);
  assert.throws(() => run({ action: "status", id: b, status: "posted" }), /只能在草稿和已发布之间切换/);
  assert.throws(() => run({ action: "save", entry: { id: b, fields: { name: "x" } }, status: "hidden" }), /只能在草稿和已发布之间切换/);
  assert.throws(() => run({ action: "delete", id: "lore-nope" }), /没有这条资料/);
  assert.throws(() => run({ action: "create", entryType: "monster" }), /没有这种资料/);
  assert.throws(() => run({ action: "rename" }), /Unknown lore action/);
  assert.equal(JSON.stringify(list()), before, "报错的都没改数据");
});

test("最多 LORE_LIMITS.entries 条", () => {
  const { run, list, LIMITS } = rules();
  for (let i = 0; i < LIMITS.entries; i++) run({ action: "create" });
  assert.throws(() => run({ action: "create" }), /最多/);
  assert.equal(list().length, LIMITS.entries);
  assert.equal(new Set(list().map(e => e.id)).size, LIMITS.entries, "id 不重复");
});

test("扩展空间：存档里认不得的字段、类型原样留着（截短），主持人保存时不丢，也不发给玩家；id 缺了 / 重复了换新的；坏数据丢掉", () => {
  const { c, run, list, LIMITS } = rules();
  c.LEDGER.lore = [
    { id: "lore-1", type: "npc", fields: { name: "甲", age: "三十", secretPlan: "x".repeat(500), __proto__x: "?" }, body: "正文", status: "published", rev: 4 },
    { id: "lore-1", type: "npc", fields: { name: "乙（id 重复）" }, status: "published" },
    { type: "place", fields: { name: "锈港" }, body: "地点", status: "published" },
    { id: "bad id!", fields: "不是对象", rev: -3, status: "weird" },
    null, "字符串", [1, 2]
  ];
  const all = list();
  assert.equal(all.length, 4, "null、字符串、数组丢掉");
  assert.equal(all[0].fields.age, "三十", "认不得的字段留着");
  assert.equal(all[0].fields.secretPlan.length, LIMITS.otherFieldMax, "截短");
  assert.ok(!("__proto__x" in all[0].fields), "key 不合规矩的丢掉");
  assert.notEqual(all[1].id, "lore-1", "重复的 id 换新的"); assert.equal(all[1].fields.name, "乙（id 重复）");
  assert.equal(all[2].type, "place", "认不得的类型留着"); assert.match(all[2].id, /^lore-/);
  assert.equal(all[3].status, "draft"); assert.equal(all[3].rev, 1); assert.match(all[3].id, /^lore-/);
  // 主持人改了认得的字段：认不得的照旧留着
  run({ action: "save", entry: { id: "lore-1", fields: { name: "甲改" } } });
  assert.equal(c.loreById("lore-1").fields.age, "三十");
  // 给玩家的：只有认得的类型、登记过的字段
  const index = plain(c.lorePublicIndex());
  assert.deepEqual(index.map(e => e.fields.name), ["甲改", "乙（id 重复）"]);
  assert.ok(!JSON.stringify(index).includes("三十") && !JSON.stringify(index).includes("锈港"), "认不得的字段 / 类型不进索引");
  assert.equal(c.lorePublicEntry(all[2].id), null);
  assert.ok(!("age" in plain(c.lorePublicEntry("lore-1")).fields));
});

test("存档：LEDGER.save / load 带着资料（跑团存档的 campaign.ledger、联机检查点都是这一份），读回来一样", () => {
  const { c, run, list } = rules();
  const a = run({ action: "create" }).id;
  run({ action: "save", entry: { id: a, fields: { name: "季玛", title: "工匠" }, body: "“愚人”季玛\n沙漠" }, status: "published" });
  run({ action: "create" });
  const saved = plain(c.LEDGER.save());
  assert.equal(saved.lore.length, 2);
  assert.ok(!("_clean" in saved.lore), "整理过的标记不进存档");
  const d = H.load();
  d.LEDGER.load(saved);
  assert.deepEqual(plain(d.loreList()), list(), "另一台机器读回来一模一样");
  d.LEDGER.load({});
  assert.deepEqual(plain(d.loreList()), [], "旧存档没有这一项：空的");
});

test("给玩家的索引不带详细内容（more 只说有没有）；详细内容只给已发布的", () => {
  const { c, run } = rules();
  const a = run({ action: "create" }).id, b = run({ action: "create" }).id;
  run({ action: "save", entry: { id: a, fields: { name: "甲", gender: "男" }, body: "BODY_A" }, status: "published" });
  run({ action: "save", entry: { id: b, fields: { name: "乙" } }, status: "published" });
  const index = plain(c.lorePublicIndex());
  assert.deepEqual(index, [{ id: a, type: "npc", fields: { name: "甲", gender: "男" }, rev: 2, more: true }, { id: b, type: "npc", fields: { name: "乙" }, rev: 2 }]);
  assert.ok(!JSON.stringify(index).includes("BODY_A"));
  assert.deepEqual(plain(c.lorePublicEntry(a)), { id: a, type: "npc", fields: { name: "甲", gender: "男" }, body: "BODY_A", rev: 2 });
});

/* ---------- 给玩家的白名单（online-view.js） ---------- */
test("projectLore：带 status 又不是已发布的（草稿）丢掉；没登记的字段、类型丢掉；重复 id 只留第一条；超长截断", () => {
  const out = OV.projectLore([
    { id: "a", type: "npc", fields: { name: "甲", gender: "女", shp: "9137", secret: "主持人笔记" }, rev: 3, more: true, body: "不该在索引里", gmNote: "x" },
    { id: "b", type: "npc", status: "draft", fields: { name: "草稿乙" } },
    { id: "c", type: "npc", status: "published", fields: { name: "丙" } },
    { id: "a", type: "npc", fields: { name: "重复甲" } },
    { id: "d", type: "place", fields: { name: "地点" } },
    { id: "e", type: "npc", fields: { name: "长".repeat(500) }, rev: -1 },
    { id: "bad id!", type: "npc", fields: { name: "坏 id" } }, null, 7
  ]);
  assert.deepEqual(out.map(e => e.id), ["a", "c", "e"]);
  assert.deepEqual(out[0], { id: "a", type: "npc", fields: { name: "甲", gender: "女" }, rev: 3, more: true });
  assert.equal(out[2].rev, 1); assert.ok(out[2].fields.name.length <= 60);
  assert.doesNotMatch(JSON.stringify(out), /草稿乙|9137|主持人笔记|不该在索引里|重复甲|地点|坏 id/);
  assert.equal(OV.projectLore("不是列表"), null);
});

test("projectLoreEntry：详细内容保留换行、去控制字符；主持人写的「有后台」「坚毅」不被敏感词整段丢掉；草稿是 null", () => {
  const e = OV.projectLoreEntry({ id: "a", type: "npc", fields: { name: "甲", faction: "外城区" }, body: `他在剧院后台工作，有很硬的后台。\r\n性格坚毅。\u0007${RLO}`, rev: 2, extra: "x" });
  assert.deepEqual(e, { id: "a", type: "npc", fields: { name: "甲", faction: "外城区" }, rev: 2, body: "他在剧院后台工作，有很硬的后台。\n性格坚毅。" });
  assert.equal(OV.projectLoreEntry({ id: "a", type: "npc", status: "draft", fields: { name: "草稿" }, body: "x" }), null);
  assert.equal(OV.projectLoreEntry(null), null);
});

test("projectPacket：结算包的 lore、loreEntry 回包的 entry 都过白名单；主持人自己收到的是原样", () => {
  const ctx = { recipientId: "p1", gmId: "host" };
  const lore = [{ id: "a", type: "npc", fields: { name: "甲", hidden: "x" }, rev: 1 }, { id: "b", type: "npc", status: "draft", fields: { name: "草稿" } }];
  const out = OV.projectPacket({ type: "result", protocol: 1, build: BUILD, seq: 1, lore }, ctx);
  assert.deepEqual(out.lore, [{ id: "a", type: "npc", fields: { name: "甲" }, rev: 1 }]);
  const reply = OV.projectPacket({ type: "loreEntry", protocol: 1, build: BUILD, requestId: 3, entry: { id: "a", type: "npc", fields: { name: "甲" }, body: "正文", rev: 1, gmNote: "x" } }, ctx);
  assert.equal(reply.type, "loreEntry"); assert.equal(reply.requestId, 3); assert.equal(reply.displayOnly, true);
  assert.deepEqual(reply.entry, { id: "a", type: "npc", fields: { name: "甲" }, rev: 1, body: "正文" });
  assert.equal(OV.projectPacket({ type: "loreEntry", protocol: 1, build: BUILD, requestId: 4, entry: null }, ctx).entry, null);
  assert.deepEqual(OV.projectPacket({ type: "result", lore }, { recipientId: "host", gmId: "host" }).lore, lore);
});

test("登记给玩家看的字段（online-view.js · LORE_PUBLIC）都在 lore.js 的 LORE_TYPES 里：加字段时两边要一起改", () => {
  const { TYPES } = rules();
  for (const [type, keys] of Object.entries(OV.LORE_PUBLIC)) {
    assert.ok(TYPES[type], type);
    for (const key of keys) assert.ok(TYPES[type].fields.some(f => f.key === key), type + "." + key);
  }
  assert.deepEqual([...OV.LORE_PUBLIC.npc], TYPES.npc.fields.map(f => f.key), "NPC 的五个字段都给玩家看");
});

/* ---------- 包大小（online-wire.js） ---------- */
const row = (id, name, rev = 1) => ({ id, type: "npc", fields: { name, gender: "女", race: "人类", faction: "ARMS", title: "武器工匠" }, rev, more: true });
const packet = (seq, lore, type = "result") => ({ displayOnly: true, protocol: 1, type, seq, messages: [], publicLogs: [], lore });

test("索引没变只带 loreUnchanged；改了一条只发那一条（loreDelta）；新增、删除、换顺序；玩家端还原成整份；resync 整份发", () => {
  const host = OnlineWire.create(), client = OnlineWire.create();
  let lore = [row("a", "甲"), row("b", "乙"), row("c", "丙")];
  const first = host.pack(packet(1, lore));
  assert.deepEqual(first.lore, lore); assert.deepEqual(client.unpack(first).lore, lore);
  const same = host.pack(packet(2, plain(lore)));
  assert.equal("lore" in same, false); assert.equal(same.loreUnchanged, true);
  const got = client.unpack(same); assert.deepEqual(got.lore, lore); assert.equal("loreUnchanged" in got, false);
  lore = [row("a", "甲"), row("b", "乙（改）", 2), row("c", "丙")];
  const edit = host.pack(packet(3, lore));
  assert.equal("lore" in edit, false); assert.deepEqual(edit.loreDelta, { changed: [{ id: "b", set: { fields: lore[1].fields, rev: 2 } }] }, "只发改了的那一条");
  assert.deepEqual(client.unpack(edit).lore, lore);
  lore = [row("c", "丙"), row("a", "甲"), row("d", "丁")];
  const mixed = client.unpack(host.pack(packet(4, lore)));
  assert.deepEqual(mixed.lore, lore, "删掉乙、加上丁、换顺序");
  const sync = host.pack(packet(5, lore, "resync"));
  assert.deepEqual(sync.lore, lore); assert.equal("loreUnchanged" in sync, false);
  client.reset(); assert.deepEqual(client.unpack(sync).lore, lore);
  assert.equal(host.pack(packet(6, null)).lore, null, "联机单局（null）照发");
  assert.equal(client.unpack(host.pack(packet(6, null))).lore, null);
  assert.deepEqual(client.unpack(host.pack(packet(7, []))).lore, [], "从 null 变回列表：整份发");
});

test("没有基准的 loreUnchanged / loreDelta 拒绝解码（逼出重同步）；坏标记、坏差异拒绝且不动上一份基准；打包过的不能再打包", () => {
  const host = OnlineWire.create(), client = OnlineWire.create(), lore = [row("a", "甲"), row("b", "乙")];
  const first = host.pack(packet(1, lore));
  const omitted = { ...first, loreUnchanged: true }; delete omitted.lore;
  assert.throws(() => OnlineWire.create().unpack(omitted), /lore omission requires a baseline/);
  assert.throws(() => OnlineWire.create().unpack({ ...omitted, type: "resync" }), /lore omission requires a baseline/);
  const raw = { ...packet(1, null), loreUnchanged: true }; delete raw.lore;
  assert.throws(() => OnlineWire.create().unpack(raw), /invalid lore metadata/, "没打包的包不能带标记");
  client.unpack(first);
  const second = host.pack(packet(2, lore)); assert.equal(second.loreUnchanged, true);
  for (const bad of [{ ...second, lore }, { ...second, loreUnchanged: 1 }, { ...second, loreDelta: { changed: [] } }]) assert.throws(() => client.unpack(bad), /invalid lore metadata/);
  const delta = { ...second }; delete delta.loreUnchanged;
  for (const d of [{ removedUnitIds: ["zzz"] }, { changed: [{ id: "a", set: { id: "x" } }] }, { order: ["a"] }, { what: 1 }]) assert.throws(() => client.unpack({ ...delta, loreDelta: d }));
  assert.deepEqual(client.unpack(second).lore, lore, "坏包没有动上一份基准");
  assert.throws(() => host.pack({ ...packet(3, lore), loreUnchanged: true }), /already packed/);
  assert.throws(() => host.pack({ ...packet(3, lore), loreDelta: {} }), /already packed/);
  // 做不了差异的（id 重复，投影后不会出现）照整份发，不报错
  const dup = [row("a", "甲"), row("a", "甲2")];
  assert.deepEqual(host.pack(packet(4, dup)).lore, dup);
});

test("包大小：50 条已发布的资料，没变时每包只多一个标记；改一条只多那一条", () => {
  const lore = Array.from({ length: 50 }, (_, i) => row("lore-1729561234567-" + i, "外城区的人物" + i));
  const projected = (seq, list) => OV.projectPacket(packet(seq, list), { recipientId: "p1", gmId: "host" });
  const full = Buffer.byteLength(JSON.stringify(projected(1, lore).lore));
  assert.ok(full > 5000, "50 条整份好几 KB：" + full);
  const withLore = OnlineWire.create(), noLore = OnlineWire.create(), client = OnlineWire.create();
  client.unpack(withLore.pack(projected(1, lore))); noLore.pack(projected(1, null));
  const extra = seq => Buffer.byteLength(JSON.stringify(withLore.pack(projected(seq, lore)))) - Buffer.byteLength(JSON.stringify(noLore.pack(projected(seq, null))));
  for (let seq = 2; seq <= 4; seq++) assert.ok(extra(seq) <= 20, `第 ${seq} 包多出 ${extra(seq)} 字节（整份 ${full}）`);
  lore[7] = row(lore[7].id, "改过名字的人", 2);
  const edited = withLore.pack(projected(5, lore)), size = Buffer.byteLength(JSON.stringify(edited.loreDelta));
  assert.ok(size < 400, "改一条只发那一条：" + size);
  assert.deepEqual(client.unpack(edited).lore, projected(5, lore).lore);
});

/* ---------- 真实联机协调层（online-game.js + hotseat + online-view + online-wire） ---------- */
async function room(saved = null) {
  const c = H.load(), sends = [], slotWrites = [], errors = [];
  c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "LORE-ROOM" });
  c.S.TRPG.active = true;
  let message, statusListener;
  const status = { connected: true, hostOnline: true, paused: true, roster: [{ id: "host", role: "host", name: "主持人", online: true }, { id: "p2", role: "player", name: "玩家", online: true }] };
  c.console = { error: e => errors.push(String(e)), log() {}, warn() {} };
  c.location = { search: "", reload() {} }; c.URLSearchParams = URLSearchParams;
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; }, body: { classList: { add() {} } } };
  c.addEventListener = () => {}; c.setInterval = () => 0; c.queueMicrotask = queueMicrotask; c.setTimeout = setTimeout; c.clearTimeout = clearTimeout;
  const state = c.S.state;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], onlineEditWindow: false,
    // 队伍记忆（game.js · rememberCampaignRules 存的那份；战斗中途是开战前的）。写空位走 trpg-ui.js 的 trpg.ui saveCaptured，写的就是它
    campaign: { party: [], ledger: c.LEDGER.save() },
    onCampaignSaved: () => c.Commands.dispatch({ type: "trpg.ui", action: "saveCaptured", level: 1 }),
    refresh() {}, disarm() {}, resumeHotseat() {},
    // 和 game.js 的 onlineCheckpoint / restoreOnline 一样带着 LEDGER（见下面对 game.js 的检查）
    onlineCheckpoint: () => plain({ state, campaign: c.GAME.campaign, ledger: c.LEDGER.save() }),
    restoreOnline(s) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, plain(s.state)); c.GAME.campaign = s.campaign; if (s.ledger) c.LEDGER.load(s.ledger); },
    resumeOnline: async () => {}, async actSystem() {}, async endTurn() {} };
  c.Commands.register("trpg.ui", cmd => { if (cmd.action === "saveCaptured") slotWrites.push(plain(c.GAME.campaign)); }, { domain: "fixture" });
  c.Commands.register("screen", () => ({}), { domain: "fixture" });
  c.Screens = { current: () => "trpg", is: s => s === "trpg" };
  c.TrpgFlow = { enter() {}, onlineCheckpoint: () => ({}), restoreOnline() {} };
  c.trpgReadSlots = () => [{ name: "已有团" }, null, null];
  c.HotseatUI = { mount() {} };
  c.OnlineActions = { create: () => ({ menu() { return {}; } }) };
  const ep = { identity: { id: "host", name: "主持人", role: "host", roomCode: "AAAAAA" },
    credentials: () => ({ roomCode: "AAAAAA", role: "host", token: "test", build: BUILD, protocol: 1 }),
    onMessage(fn) { message = fn; }, onStatus(fn) { statusListener = fn; fn(plain(status)); },
    send: async (packet, recipient) => { sends.push({ packet: plain(packet), recipient }); return { ok: true }; },
    async setReady() { status.paused = false; statusListener(plain(status)); }, close() {}, reconnect() {} };
  c.RelayTransport = { createHost: async () => ep, resumeHost: async () => ep };
  for (const file of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js", "online-view.js", "online-wire.js", "online-game.js"]) vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  if (saved) { c.localStorage.setItem("backfire-online-v1", JSON.stringify(saved)); await c.OnlineGame.resume(); }
  else await c.OnlineGame.create({ slot: 0, name: "主持人", url: "https://fixture.invalid" });
  c.OnlineGame.start();
  const heroes = state.units.filter(u => u.isPlayer && !u.weaponOf);
  c.OnlineGame.assign(Object.fromEntries(heroes.map(u => [u.id, u.kit === "kolt" ? "p2" : "host"])));
  let requestId = 0;
  const f = { c, state, heroes, sends, slotWrites, errors,
    gm: cmd => c.OnlineGame.submit(Object.assign({ type: "lore" }, cmd)),
    receive: packet => message({ protocol: 1, build: BUILD, requestId: ++requestId, ...packet }, "p2"),
    /** 发给玩家 p2 的包，按顺序用玩家端的解码器解开（和 online-game.js · receiveDisplay 一样） */
    toPlayer() { const client = OnlineWire.create(); return sends.filter(s => s.recipient === "p2").map(s => ["result", "resync"].includes(s.packet.type) ? client.unpack(s.packet) : s.packet); },
    lastLore() { return f.toPlayer().filter(p => ["result", "resync"].includes(p.type)).at(-1).lore; },
    lastReply() { return sends.filter(s => s.recipient === "p2").at(-1).packet; } };
  /** 主持人新建一条、写好内容，publish 就发布 */
  f.make = async (fields, body, publish) => {
    const r = await f.gm({ action: "create", entryType: "npc" });
    assert.equal(r.ok, true, r.error); assert.equal(typeof r.id, "string");
    const s = await f.gm({ action: "save", entry: { id: r.id, fields, body }, ...(publish ? { status: "published" } : {}) });
    assert.equal(s.ok, true, s.error);
    return r.id;
  };
  return f;
}

test("联机：玩家收到的包里只有已发布的条目——草稿的字段、详细内容，已发布条目的详细内容都不在任何一包里；主持人看得到全部", async () => {
  const f = await room();
  const draft = await f.make({ name: "DRAFT_NAME_鬼面人", faction: "DRAFT_FACTION" }, "DRAFT_BODY_真实身份是首领", false);
  const pub = await f.make({ name: "特蕾莎·特雷丝", gender: "女", race: "人类", faction: "ARMS", title: "武器工匠" }, "PUB_BODY_第一行\n第二行", true);
  const raw = JSON.stringify(f.sends.filter(s => s.recipient === "p2"));
  assert.doesNotMatch(raw, /DRAFT_/, "草稿一个字都不发给玩家");
  assert.doesNotMatch(raw, /PUB_BODY/, "详细内容不跟着每个包走（玩家点开时才要）");
  assert.deepEqual(f.lastLore(), [{ id: pub, type: "npc", fields: { name: "特蕾莎·特雷丝", gender: "女", race: "人类", faction: "ARMS", title: "武器工匠" }, rev: 2, more: true }]);
  const gmView = plain(f.c.OnlineGame.loreAll());
  assert.deepEqual(gmView.map(e => [e.id, e.status]), [[draft, "draft"], [pub, "published"]], "主持人看得到草稿");
  assert.equal(gmView[0].body, "DRAFT_BODY_真实身份是首领");
  assert.deepEqual(f.errors, []);
});

test("联机：玩家点开一条才要详细内容——已发布的给（保留换行），草稿和不存在的一样回 null；玩家发来的 lore 指令一律拒绝", async () => {
  const f = await room();
  const draft = await f.make({ name: "DRAFT_NAME" }, "DRAFT_BODY", false);
  const pub = await f.make({ name: "季玛" }, "“愚人”季玛\n住在沙漠", true);
  await f.receive({ type: "loreEntry", id: pub });
  let reply = f.lastReply();
  assert.equal(reply.type, "loreEntry"); assert.equal(reply.displayOnly, true);
  assert.deepEqual(reply.entry, { id: pub, type: "npc", fields: { name: "季玛" }, rev: 2, body: "“愚人”季玛\n住在沙漠" });
  for (const id of [draft, "lore-0-0", 42]) {
    await f.receive({ type: "loreEntry", id });
    reply = f.lastReply();
    assert.equal(reply.type, "loreEntry"); assert.equal(reply.entry, null, String(id));
  }
  assert.doesNotMatch(JSON.stringify(f.sends.filter(s => s.recipient === "p2")), /DRAFT_/);
  const before = JSON.stringify(f.c.OnlineGame.loreAll());
  for (const command of [{ type: "lore", action: "status", id: draft, status: "published" }, { type: "lore", action: "create", entryType: "npc" }, { type: "lore", action: "delete", id: pub }]) {
    await f.receive({ type: "cmd", command });
    reply = f.lastReply();
    assert.equal(reply.type, "ack"); assert.equal(reply.ok, false); assert.match(reply.error, /只有主持人/);
  }
  assert.equal(JSON.stringify(f.c.OnlineGame.loreAll()), before, "玩家改不了资料");
  assert.equal(f.c.OnlineGame.loreAll().length, 2);
});

test("联机：主持人改已发布的条目，玩家下一包就是新的（rev + 1，只发改了的那条）；撤回为草稿后玩家那边没了、详细内容也要不到", async () => {
  const f = await room();
  const a = await f.make({ name: "甲" }, "旧的介绍", true), b = await f.make({ name: "乙" }, "", true);
  const start = f.sends.length;
  assert.equal((await f.gm({ action: "save", entry: { id: a, fields: { name: "甲", title: "新职位" }, body: "新的介绍" } })).ok, true);
  const packed = f.sends.slice(start).filter(s => s.recipient === "p2" && s.packet.type === "result").map(s => s.packet);
  const deltas = packed.filter(p => "loreDelta" in p);
  assert.equal(deltas.length, 1, "改了一次，只有一包带差异");
  assert.deepEqual(deltas[0].loreDelta, { changed: [{ id: a, set: { fields: { name: "甲", title: "新职位" }, rev: 3 } }] }, "只发改了的那条");
  assert.ok(packed.every(p => !("lore" in p)), "不整份重发");
  assert.ok(packed.filter(p => p !== deltas[0]).every(p => p.loreUnchanged === true), "别的包只带标记");
  assert.deepEqual(f.lastLore().map(e => [e.id, e.rev, e.fields.title || ""]), [[a, 3, "新职位"], [b, 2, ""]]);
  await f.receive({ type: "loreEntry", id: a });
  assert.equal(f.lastReply().entry.body, "新的介绍");
  assert.equal((await f.gm({ action: "status", id: a, status: "draft" })).ok, true);
  assert.deepEqual(f.lastLore().map(e => e.id), [b], "撤回为草稿：玩家那边没了");
  await f.receive({ type: "loreEntry", id: a });
  assert.equal(f.lastReply().entry, null);
  assert.equal((await f.gm({ action: "delete", id: b })).ok, true);
  assert.deepEqual(f.lastLore(), []);
  assert.deepEqual(f.errors, []);
});

test("联机存档：改完写进队伍记忆（GAME.campaign.ledger）和跑团存档空位；战斗没打完就回探索（trpgAbandonBattle）不丢；房主刷新后恢复房间资料还在", async () => {
  const f = await room();
  const draft = await f.make({ name: "草稿丙" }, "丙的底细", false);
  const pub = await f.make({ name: "摩尔玛" }, "巨腕军火工业", true);
  const want = plain(f.c.loreList());
  assert.deepEqual(plain(f.c.GAME.campaign.ledger.lore), want, "队伍记忆里那份换上了新的资料（草稿也在，存档是主持人的）");
  assert.ok(f.slotWrites.length >= 4, "每次改完都写空位");
  assert.deepEqual(f.slotWrites.at(-1).ledger.lore, want, "写进空位的就是这份");
  // 战斗没打完就回探索：LEDGER 按队伍记忆整个重读，资料还在
  f.c.trpgAbandonBattle(f.c.GAME.campaign);
  assert.deepEqual(plain(f.c.loreList()), want);
  // 房主刷新：用本机的房间检查点恢复
  const saved = JSON.parse(f.c.localStorage.getItem("backfire-online-v1"));
  assert.deepEqual(saved.game.ledger.lore, want, "房间检查点带着资料");
  const g = await room(saved);
  assert.deepEqual(plain(g.c.loreList()), want, "恢复房间后资料还在");
  assert.deepEqual(g.lastLore().map(e => e.id), [pub], "恢复后玩家照样只看到已发布的");
  assert.doesNotMatch(JSON.stringify(g.sends.filter(s => s.recipient === "p2")), /草稿丙|丙的底细/);
  assert.equal(g.c.loreById(draft).status, "draft");
  // 真游戏（game.js）的房间检查点确实带着 LEDGER，恢复时读回去
  const gameSrc = fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8");
  assert.match(gameSrc, /G\.onlineCheckpoint = \(\) => JSON\.parse\(JSON\.stringify\(\{[\s\S]{0,400}?ledger: typeof LEDGER === "undefined" \? null : LEDGER\.save\(\) \}\)\)/);
  assert.match(gameSrc, /G\.restoreOnline = saved => \{[\s\S]{0,700}?if \(saved\.ledger\) LEDGER\.load\(saved\.ledger\);/);
});

test("只在联机跑团：联机单局的包里 lore 是 null、lore 指令拒绝（online-game.js 按 rogue() 分开）", () => {
  const og = fs.readFileSync(path.join(H.ROOT, "online-game.js"), "utf8");
  assert.match(og, /lore: !rogue\(\) && typeof lorePublicIndex === "function" \? lorePublicIndex\(\) : null/);
  assert.match(og, /if \(cmd\.type === "lore"\) \{\s*if \(sender !== identity\.id\) error\("只有主持人可以编辑角色资料"\);\s*if \(rogue\(\)\) error\("联机单局没有角色资料"\);/);
  assert.match(og, /const entry = !rogue\(\) && typeof lorePublicEntry === "function"/);
  assert.match(og, /loreAll: \(\) => isHost\(\) && !rogue\(\)/);
});

test("联机：战斗中有询问在等玩家回应时，主持人照样能改资料，也照样写进存档（写空位在 lore 指令的执行里，不被询问挡住）", async () => {
  const f = await room();
  f.c.HotseatGame.startCombat(); f.c.HotseatGame.beginRound();
  const kolt = f.heroes.find(u => u.kit === "kolt"), ruby = f.heroes.find(u => u.kit === "ruby");
  f.c.HotseatGame.requestAsk("block", "谁来格挡", [{ helper: kolt.id, label: kolt.name, extra: {} }], () => [kolt], { seq: 9, targetId: ruby.id });
  assert.ok(f.c.HotseatGame.hasAsk(), "有一条询问在等玩家");
  // 这时直接写空位会被热座挡住（所以不能在指令外面写）
  assert.throws(() => f.c.Commands.dispatch({ type: "trpg.ui", action: "saveCaptured", level: 1 }), /正在等待其他操作者回应/);
  const writes = f.slotWrites.length;
  const id = await f.make({ name: "战斗中写的人" }, "战斗中写的介绍", true);
  assert.ok(f.slotWrites.length >= writes + 2, "改完照样写空位");
  assert.equal(f.slotWrites.at(-1).ledger.lore.find(e => e.id === id).body, "战斗中写的介绍");
  assert.ok(f.c.HotseatGame.hasAsk(), "询问还在，没被打断");
  assert.deepEqual(f.lastLore().map(e => e.id), [id]);
});
