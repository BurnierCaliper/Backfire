// 任务日志（联机跑团）：主线 / 支线、每站奖励（只发一次）、回退、揭示、多条并行、按玩家可见、给玩家的数据不漏主持人信息
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "QUEST" });
  c.S.TRPG.active = true;
  c.S.state.kuizhi = 0;
  const LEDGER = vm.runInContext("LEDGER", c);
  LEDGER.tasks = [];
  const make = (category, extra) => {
    c.trpgTaskCreate("custom", category);
    const t = c.trpgTasks()[c.trpgTasks().length - 1];
    c.trpgTaskSave(Object.assign(plain(t), {
      name: category === "main" ? "锈港的余烬" : "失踪的送水工", goal: "查清真相", gmNote: "长老是幕后买家",
      nodes: [
        { type: "event", title: "在酒馆打听", note: "主持人：线人在后巷", reward: { xp: 50, kuizhi: 0 } },
        { type: "battle", title: "击退打手", enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], reward: { xp: 120, kuizhi: 1500 } },
        { type: "event", title: "把账本交给长老", hidden: true, reward: { xp: 0, kuizhi: 300 } }
      ],
      reward: { kuizhi: 6000, xp: 500 }
    }, extra || {}));
    return c.trpgTaskById(t.id);
  };
  // 发出去的经验（升级会把 xp 清零，直接记 trpgGiveXp 的调用）
  let given = 0;
  vm.runInContext("(function(){ const o = trpgGiveXp; trpgGiveXp = function(k, n){ globalThis.__xpGiven = (globalThis.__xpGiven || 0) + (Number(n) || 0); return o(k, n); }; })()", c);
  const xp = () => vm.runInContext("globalThis.__xpGiven || 0", c) + given;
  return { c, LEDGER, make, xp };
}

test("新建可以选主线 / 支线；主线、支线可以同时进行", () => {
  const { c, make } = field();
  const m = make("main"), s = make("side");
  assert.equal(m.category, "main");
  assert.equal(s.category, "side");
  [m, s].forEach(t => { c.trpgTaskSetStatus(t.id, "posted"); c.trpgTaskAccept(t.id); });
  assert.equal(m.status, "active");
  assert.equal(s.status, "active", "不再限制只能一个进行中");
});

test("完成一站发这一站的奖励（经验每人、奎支平分进各人钱包）；回退再推进不重发", () => {
  const { c, make, xp } = field();
  const t = make("main");
  c.trpgTaskSetStatus(t.id, "posted"); c.trpgTaskAccept(t.id);
  const x0 = xp();
  c.trpgTaskNodeDone(t.id);
  assert.equal(xp() - x0, 50);
  c.trpgTaskNodeDone(t.id);
  assert.equal(xp() - x0, 170);
  const wallets = () => [c.trpgPurse("kolt"), c.trpgPurse("helu")];
  assert.deepEqual(wallets(), [750, 750], "两人平分");
  assert.equal(c.S.state.kuizhi, 0, "不进公账");
  c.trpgTaskRollback(t.id);
  assert.equal(t.index, 1);
  assert.deepEqual(wallets(), [750, 750], "回退不收回");
  c.trpgTaskNodeDone(t.id);
  assert.deepEqual(wallets(), [750, 750], "再推进不重发");
  assert.equal(xp() - x0, 170);
});

test("走到隐藏的站自动揭示；完成奖励只发一次", () => {
  const { c, make } = field();
  const t = make("main");
  c.trpgTaskSetStatus(t.id, "posted"); c.trpgTaskAccept(t.id);
  assert.equal(t.nodes[2].hidden, true);
  c.trpgTaskNodeDone(t.id); c.trpgTaskNodeDone(t.id);
  assert.equal(t.nodes[2].hidden, false, "走到第 3 站就揭示");
  c.trpgTaskComplete(t.id);
  const k = c.S.state.kuizhi;
  t.status = "active";
  c.trpgTaskComplete(t.id);
  assert.equal(c.S.state.kuizhi, k, "完成奖励不重发");
});

test("给玩家的任务日志：草稿不给；隐藏站只给「？？？」；没有主持人备注、敌人配置、主持人说明", () => {
  const { c, make } = field();
  const draft = make("side");
  const t = make("main");
  c.trpgTaskSetStatus(t.id, "posted"); c.trpgTaskAccept(t.id);
  const log = plain(c.trpgQuestLog("p1", false));
  assert.ok(!log.some(q => q.id === draft.id), "草稿看不到");
  const q = log.find(x => x.id === t.id);
  assert.equal(q.category, "main");
  assert.deepEqual(q.steps.map(s => s.state), ["cur", "todo", "todo"]);
  assert.equal(q.steps[2].hidden, true);
  assert.equal(q.steps[2].title, "");
  assert.equal(q.steps[2].kuizhi, 0, "隐藏站的奖励也不给");
  const text = JSON.stringify(log);
  assert.ok(!/长老是幕后买家|线人在后巷|thug_knife|enemies|gmNote/.test(text), "不漏主持人信息：" + text);
});

test("指定玩家可见：别的玩家看不到，主持人看得到", () => {
  const { c, make } = field();
  const t = make("side", { visibility: { mode: "players", ids: ["alice"] } });
  c.trpgTaskSetStatus(t.id, "posted");
  assert.ok(c.trpgQuestLog("alice", false).some(q => q.id === t.id && q.private));
  assert.ok(!c.trpgQuestLog("bob", false).some(q => q.id === t.id));
  assert.ok(c.trpgQuestLog("gm", true).some(q => q.id === t.id));
});

test("旧存档的任务（没有分类、每站奖励、记账）补上默认值；走过的站当作发过奖励", () => {
  const { c, LEDGER } = field();
  LEDGER.tasks = [{ id: "old1", name: "旧任务", kind: "custom", goal: "", days: 1, status: "active", reward: { kuizhi: 0, xp: 0, items: [], parts: [], blueprints: [], intactKuizhi: 0 },
    escort: null, nodes: [{ type: "event", note: "", done: true, enemies: [] }, { type: "event", note: "", done: false, enemies: [] }], index: 1 }];
  const log = plain(c.trpgQuestLog("p1", false));
  assert.equal(log[0].category, "side");
  const t = c.trpgTaskById("old1");
  assert.deepEqual(plain(t.granted.nodes), [t.nodes[0].id], "记账记的是站的 id（#340 第 6 条，以前记第几站）");
  c.trpgTaskRollback("old1");
  c.trpgTaskNodeDone("old1");   // 不会崩，也不会补发
  assert.equal(t.index, 1);
});

test("联机投影（online-view.js · projectQuests）：白名单之外的字段一律丢掉", () => {
  const { c } = field();
  const OV = require("../online-view.js");
  const out = plain(OV.projectQuests([{ id: "q", name: "x", category: "main", status: "active", gmNote: "秘密", secret: 1,
    steps: [{ title: "a", state: "cur", xp: 5, enemies: [1] }, { title: "泄漏", state: "todo", hidden: true, xp: 9 }], reward: { xp: 1, kuizhi: 2, items: [], hp: 3 } }]));
  const text = JSON.stringify(out);
  assert.ok(!/秘密|secret|enemies|泄漏|"hp"/.test(text), text);
  assert.equal(out[0].steps[1].xp, 0);
});

/* ---------- 个人任务 ---------- */
test("个人任务：只有操控那名角色的玩家看得到，别人连有这条任务都不知道；主持人全看得到", () => {
  const { c, make } = field();
  const t = make("personal", { owner: "helu" });
  assert.equal(t.category, "personal");
  assert.equal(t.owner, "helu");
  c.trpgTaskSetStatus(t.id, "posted");
  const mine = plain(c.trpgQuestLog("p-helu", false, ["helu"]));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].category, "personal");
  assert.equal(mine[0].private, true);
  assert.equal(mine[0].owner, "Helumica");
  assert.equal(plain(c.trpgQuestLog("p-kolt", false, ["kolt"])).length, 0, "别人看不到");
  assert.equal(plain(c.trpgQuestLog("p-x", false, [])).length, 0, "没有角色的也看不到");
  assert.equal(plain(c.trpgQuestLog("gm", true, [])).length, 1, "主持人看得到");
  // 「指定玩家」的可见范围对个人任务不起作用
  c.trpgTaskSave(Object.assign(plain(t), { visibility: { mode: "players", ids: ["p-kolt"] } }));
  assert.equal(plain(c.trpgQuestLog("p-kolt", false, ["kolt"])).length, 0);
});

test("个人任务：经验和奎支都只给那名角色（奎支进他的私人钱包）；新建时先挂在第一名角色身上", () => {
  const { c, make } = field();
  const t = make("personal", { owner: "helu" });
  c.trpgTaskSetStatus(t.id, "posted"); c.trpgTaskAccept(t.id);
  vm.runInContext("globalThis.__xpKits = []; (function(){ const o = trpgGiveXp; trpgGiveXp = function(k, n){ globalThis.__xpKits.push(k); return o(k, n); }; })()", c);
  c.trpgTaskNodeDone(t.id);
  c.trpgTaskNodeDone(t.id);
  assert.equal(c.trpgPurse("helu"), 1500, "进 Helumica 的钱包");
  assert.equal(c.trpgPurse("kolt"), 0);
  assert.equal(c.S.state.kuizhi, 0);
  const kits = plain(vm.runInContext("globalThis.__xpKits", c));
  assert.ok(kits.length >= 2);
  kits.forEach(k => assert.deepEqual(k, ["helu"]));
  c.trpgTaskCreate("custom", "personal");
  const fresh = c.trpgTasks()[c.trpgTasks().length - 1];
  assert.equal(fresh.category, "personal");
  assert.equal(fresh.owner, "kolt");
});

test("个人任务：玩家收到的包照白名单过（分类、属于谁）", () => {
  const OV = require("../online-view.js");
  const out = OV.projectQuests([{ id: "q1", name: "家书", category: "personal", owner: "Helumica", status: "active", steps: [], reward: {}, gmNote: "不该出现" }]);
  assert.equal(out[0].category, "personal");
  assert.equal(out[0].owner, "Helumica");
  assert.ok(!("gmNote" in out[0]));
});

/* ---------- 剧情任务：没有路线、没有默认奖励 ---------- */
test("新任务只有标题和描述：没有路线、没有奖励（配置了才有）", () => {
  const { c } = field();
  ["custom", "clear", "escort"].forEach(kind => {
    c.trpgTaskCreate(kind, "main");
    const t = c.trpgTasks()[c.trpgTasks().length - 1];
    assert.equal(t.nodes.length, 0, kind);
    assert.deepEqual(plain(t.reward), { kuizhi: 0, xp: 0, items: [], parts: [], blueprints: [], intactKuizhi: 0 }, kind);
  });
  // 编辑里「按模板填路线」：照单局的模板给一条路线
  const route = plain(c.trpgTaskTemplateRoute("clear"));
  assert.ok(route.nodes.length >= 3 && route.days >= 1);
});

test("剧情任务（无路线）：发布、接下、直接结算；没配奖励就什么都不发，配了才发", () => {
  const { c, xp } = field();
  c.trpgTaskCreate("custom", "main");
  const t = c.trpgTasks()[c.trpgTasks().length - 1];
  c.trpgTaskSave(Object.assign(plain(t), { name: "旧港的约定", goal: "去见那个人" }));
  c.trpgTaskSetStatus(t.id, "posted"); c.trpgTaskAccept(t.id);
  const log = plain(c.trpgQuestLog("p1", false, []));
  assert.equal(log[0].name, "旧港的约定");
  assert.equal(log[0].steps.length, 0);
  const x0 = xp(), bag0 = c.bagList().length;
  const out = c.trpgTaskComplete(t.id);
  assert.equal(t.status, "done", out.join("\n"));
  assert.equal(xp(), x0, "没有经验");
  assert.equal(c.bagList().length, bag0, "没有道具 / 改装件");
  assert.equal(c.trpgPurse("kolt") + c.trpgPurse("helu") + (c.S.state.kuizhi || 0), 0, "没有钱");
  // 配了奖励的才发
  c.trpgTaskCreate("custom", "side");
  const u = c.trpgTasks()[c.trpgTasks().length - 1];
  c.trpgTaskSave(Object.assign(plain(u), { reward: { kuizhi: 1000, xp: 0, items: [{ id: "medkit", qty: 1 }], parts: [], blueprints: [] } }));
  c.trpgTaskSetStatus(u.id, "posted"); c.trpgTaskAccept(u.id);
  c.trpgTaskComplete(u.id);
  assert.equal(c.bagCount("medkit"), 1);
  assert.equal(c.trpgPurse("kolt") + c.trpgPurse("helu"), 1000);
});
