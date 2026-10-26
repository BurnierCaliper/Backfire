// #340 第 6 条：跑团任务进行中改路线（删站、插站、挪站）。每一站有固定的 id，走过没有、奖励发过没有都跟着站走，不跟位置；
// 当前站 = 改完的路线里第一个还没走过的站。以前按位置记：删了走过的站会跳过下一站，在前面插站会重复发奖、新站的奖励记成发过了。
// 编辑器里「奖励已发 ✓」跟着站走的那部分要浏览器，在 tests/task-route-edit-ui.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "ROUTE" });
  c.S.TRPG.active = true;
  c.S.state.kuizhi = 0;
  const LEDGER = vm.runInContext("LEDGER", c);
  LEDGER.tasks = [];
  return { c, LEDGER };
}
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "trpg" }, o)));
// 每一站的奎支报酬（平分进两人的钱包）：看钱包就知道哪一站发了、发了几次
const REWARD = { A: 100, B: 200, C: 400, NEW: 1000 };
/** 编辑器「＋ 事件」加的一站（trpg-ui.js · teAct 的 addNode），填好标题和奖励 */
const addNode = title => ({ type: "event", note: "", enemies: [], weather: "none", zoneMode: 2, title, hidden: false, reward: { xp: 0, kuizhi: REWARD[title] || 0 } });
/** 主持人建一条任务（默认 A / B / C 三站），发布、接下 */
function route(c, titles) {
  cmd(c, { action: "taskCreate", kind: "custom", category: "main" });
  const t = c.trpgTasks()[c.trpgTasks().length - 1];
  cmd(c, { action: "taskSave", task: Object.assign(plain(t), { nodes: (titles || ["A", "B", "C"]).map(addNode) }) });
  cmd(c, { action: "taskStatus", id: t.id, status: "posted" });
  cmd(c, { action: "taskAccept", id: t.id });
  return t.id;
}
/** 像任务编辑器那样：拷一份任务（trpg-ui.js 点「编辑」），改路线，点「保存」 */
function edit(c, id, change) {
  const e = plain(c.trpgTaskById(id));
  change(e.nodes);
  return cmd(c, { action: "taskSave", task: e });
}
const money = c => c.trpgPurse("kolt") + c.trpgPurse("helu");
const cur = (c, id) => { const t = c.trpgTaskById(id), n = t.nodes[t.index]; return n ? n.title : null; };
/** 任务日志（主持人看到的全部）：每一步「标题:状态」，奖励发过的带 ✓ */
const steps = (c, id) => plain(c.trpgQuestLog("gm", true).find(q => q.id === id).steps).map(s => `${s.title}:${s.state}${s.got ? "✓" : ""}`);
/** 一站一站点「这一站完成」走完，记每一站发了多少奎支 */
function walk(c, id) {
  const t = c.trpgTaskById(id), paid = [];
  while (t.index < t.nodes.length) {
    const before = money(c), title = t.nodes[t.index].title;
    cmd(c, { action: "taskNodeDone", id });
    paid.push(`${title}+${money(c) - before}`);
  }
  return paid;
}

test("完成第 1 站后删掉它：当前站还是原来的第 2 站，不跳站；第 2 站的奖励照发（以前跳到第 3 站，第 2 站的奖励记成发过了）", () => {
  const { c } = field();
  const id = route(c);
  cmd(c, { action: "taskNodeDone", id });   // A：+100
  edit(c, id, nodes => nodes.splice(0, 1));
  assert.equal(cur(c, id), "B");
  assert.deepEqual(steps(c, id), ["B:cur", "C:todo"]);
  assert.deepEqual(walk(c, id), ["B+200", "C+400"]);
  assert.equal(money(c), 700);
});

test("完成第 1 站后在最前面插一站：新站成了当前站、奖励照发；走过的那一站再走到不重发（以前当前站回到第 1 站、它的奖励再发一次，新站的奖励永远不发）", () => {
  const { c } = field();
  const id = route(c);
  cmd(c, { action: "taskNodeDone", id });   // A：+100
  // 编辑器是「＋ 事件」加在最后，再一下下「↑」挪到最前面；结果一样
  edit(c, id, nodes => nodes.unshift(addNode("NEW")));
  assert.equal(cur(c, id), "NEW");
  assert.deepEqual(steps(c, id), ["NEW:cur", "A:todo✓", "B:todo", "C:todo"]);
  assert.deepEqual(walk(c, id), ["NEW+1000", "A+0", "B+200", "C+400"]);
  assert.equal(money(c), 1700, "每一站的奖励都只发一次");
});

test("挪站：走过的站挪到当前站后面——当前站不变，那一站要再走一次但不重发；还没走的站挪到当前站前面——它成了当前站", () => {
  const { c } = field();
  const id = route(c);
  cmd(c, { action: "taskNodeDone", id });   // A：+100，当前 B
  edit(c, id, nodes => nodes.push(nodes.shift()));   // A 挪到最后：B / C / A
  assert.equal(cur(c, id), "B");
  assert.deepEqual(steps(c, id), ["B:cur", "C:todo", "A:todo✓"]);
  edit(c, id, nodes => nodes.unshift(nodes.splice(1, 1)[0]));   // C 挪到 B 前面：C / B / A
  assert.equal(cur(c, id), "C");
  assert.deepEqual(walk(c, id), ["C+400", "B+200", "A+0"]);
  assert.equal(money(c), 700);
});

test("删掉当前站：下一站接上；删到后面没有站：路线走完，可以结算；当前站换了时保存的日志写一句，没换不写", () => {
  const { c } = field();
  const id = route(c);
  cmd(c, { action: "taskNodeDone", id });   // 当前 B
  const out = edit(c, id, nodes => nodes.splice(1, 1));   // 删 B：A / C
  assert.equal(cur(c, id), "C");
  assert.match(out.join(""), /当前站改成第 2 站（C）/);
  const out2 = edit(c, id, nodes => nodes.splice(1, 1));   // 删 C：只剩走过的 A
  assert.equal(c.trpgTaskById(id).index, 1);
  assert.match(out2.join(""), /路线走完了，可以结算任务/);
  // 走完了再在最后加一站：它就是当前站
  const out3 = edit(c, id, nodes => { nodes.push(addNode("NEW")); });
  assert.equal(cur(c, id), "NEW");
  assert.match(out3.join(""), /当前站改成第 2 站（NEW）/);
  // 只改标题、奖励：当前站不动，不多写
  const out4 = edit(c, id, nodes => { nodes[0].title = "A2"; nodes[1].title = "NEW2"; nodes[1].reward.kuizhi = 1500; });
  assert.doesNotMatch(out4.join(""), /当前站|路线走完/);
  assert.equal(cur(c, id), "NEW2");
});

test("同一次保存里删掉一站又加一站：新加的站不会被当成删掉的那一站（不继承它走过 / 发过奖励）", () => {
  const { c } = field();
  const id = route(c, ["A", "B"]);
  cmd(c, { action: "taskNodeDone", id });   // A：+100，当前 B
  edit(c, id, nodes => { nodes.splice(0, 1); nodes.push(addNode("NEW")); });   // B / NEW
  assert.equal(cur(c, id), "B");
  assert.deepEqual(steps(c, id), ["B:cur", "NEW:todo"]);
  assert.deepEqual(walk(c, id), ["B+200", "NEW+1000"]);
});

test("编辑器交来的「走过没有」「发过奖励」「第几站」不算数：照改之前的记账（按站认）", () => {
  const { c } = field();
  const id = route(c);
  cmd(c, { action: "taskNodeDone", id });   // A
  const e = plain(c.trpgTaskById(id));
  e.nodes.forEach(n => { n.done = true; });
  e.granted = { nodes: e.nodes.map(n => n.id), complete: true };
  e.index = 3;
  cmd(c, { action: "taskSave", task: e });
  const t = c.trpgTaskById(id);
  assert.equal(cur(c, id), "B");
  assert.deepEqual(plain(t.nodes.map(n => n.done)), [true, false, false]);
  assert.deepEqual(steps(c, id), ["A:done✓", "B:cur", "C:todo"]);
  assert.equal(t.granted.complete, false);
  assert.deepEqual(walk(c, id), ["B+200", "C+400"]);
});

test("回退以后改路线：回退过的站照旧算没走过、发过的奖励不重发；在它前面删站不影响", () => {
  const { c } = field();
  const id = route(c);
  cmd(c, { action: "taskNodeDone", id }); cmd(c, { action: "taskNodeDone", id });   // A、B：+300，当前 C
  cmd(c, { action: "taskRollback", id });   // 回到 B（B 的奖励已经发过）
  edit(c, id, nodes => nodes.splice(0, 1));   // 删 A：B / C
  assert.equal(cur(c, id), "B");
  assert.deepEqual(steps(c, id), ["B:cur✓", "C:todo"]);
  assert.deepEqual(walk(c, id), ["B+0", "C+400"]);
  assert.equal(money(c), 700);
});

test("旧存档：站没有 id 的补上（不重复）；记账里记的「第几站」换成那一站的 id，之后改路线也跟着站走", () => {
  const { c, LEDGER } = field();
  const old = (title, done) => ({ type: "event", note: "", title, done, enemies: [], reward: { xp: 0, kuizhi: REWARD[title] } });
  LEDGER.tasks = [{ id: "old1", name: "旧任务", kind: "custom", goal: "", days: 1, status: "active", category: "main",
    reward: { kuizhi: 0, xp: 0, items: [], parts: [], blueprints: [], intactKuizhi: 0 }, escort: null,
    nodes: [old("A", true), old("B", false), old("C", false)], index: 1, granted: { nodes: [0], complete: false } }];
  const t = c.trpgTaskById("old1");
  assert.ok(t.nodes.every(n => typeof n.id === "string" && n.id), "每一站都有 id");
  assert.equal(new Set(t.nodes.map(n => n.id)).size, 3, "不重复");
  assert.deepEqual(plain(t.granted.nodes), [t.nodes[0].id], "第 1 站发过");
  edit(c, "old1", nodes => nodes.splice(0, 1));   // 删掉走过的 A
  assert.equal(cur(c, "old1"), "B");
  assert.deepEqual(steps(c, "old1"), ["B:cur", "C:todo"]);
  assert.deepEqual(walk(c, "old1"), ["B+200", "C+400"]);
});

test("站的 id 和记账跟着存档走：存档、读档以后再改路线照样按站认", () => {
  const { c, LEDGER } = field();
  const id = route(c);
  cmd(c, { action: "taskNodeDone", id });   // A：+100
  const saved = plain(LEDGER.save());
  LEDGER.reset();
  LEDGER.load(saved);
  const t = c.trpgTaskById(id);
  assert.ok(t.nodes.every(n => typeof n.id === "string" && n.id));
  assert.deepEqual(plain(t.nodes.map(n => n.id)), saved.tasks[0].nodes.map(n => n.id), "读档不换 id");
  edit(c, id, nodes => nodes.splice(0, 1));
  assert.equal(cur(c, id), "B");
  assert.deepEqual(walk(c, id), ["B+200", "C+400"]);
  assert.equal(money(c), 700);
});
