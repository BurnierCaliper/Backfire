// issue #340 第 11 条：联机跑团的私人钱包余额不能经小队聊天（所有人都看得到）泄露给队友
// 测试都走真的联机命令（HotseatGame.receiveFrom），再看队友 p3 实际收到、过了 online-view.js 白名单的包
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const V = require("../online-view");
const plain = x => JSON.parse(JSON.stringify(x));

// 开一个联机跑团会话（同 tests/trpg-online-rules.test.js）：主持人、操控瑞比的 p2、旁观的队友 p3
function online() {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "WALLET-340" });
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], disarm() {}, refresh() {}, resumeHotseat() {} };
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  c.location = { search: "" }; c.URLSearchParams = URLSearchParams; c.addEventListener = () => {}; c.setInterval = () => 0;
  c.OnlineGame = { isHost: () => true, isPaused: () => false };
  for (const f of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js"])
    vm.runInContext(fs.readFileSync(path.join(H.ROOT, f), "utf8"), c, { filename: f });
  const ruby = c.S.state.units.find(u => u.kit === "ruby");
  const players = [{ id: "host", name: "主持人", gm: true }, { id: "p2", name: "玩家" }, { id: "p3", name: "队友" }];
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players, assignments: { [ruby.id]: "p2" } }).ok, true);
  c.S.TRPG.active = true;
  c.LEDGER.purse = { ruby: 1234, helu: 5678 };
  const send = (who, cmd) => c.HotseatGame.receiveFrom(who, plain(cmd));
  const teammateChat = () => V.projectView(plain(c.HotseatGame.getViewFor("p3")), { recipientId: "p3" }).chat.map(m => m.text).join("\n");
  return { c, send, teammateChat };
}

test("第 11 条：玩家 / 主持人转账以后，队友收到的小队聊天只写谁转给谁多少，没有余额", () => {
  const { c, send, teammateChat } = online();
  assert.equal(send("p2", { type: "purseTransfer", from: "ruby", to: "helu", amount: 34 }).ok, true);
  assert.equal(send("p2", { type: "purseTransfer", from: "ruby", to: "party", amount: 10 }).ok, true);
  assert.equal(send("host", { type: "purseTransfer", from: "helu", to: "ruby", amount: 5 }).ok, true);
  assert.equal(c.trpgPurse("ruby"), 1195, "钱真的转了");
  const chat = teammateChat();
  assert.match(chat, /瑞比 转给 Helumica 34 奎支/);
  assert.match(chat, /瑞比 转给 .+ 10 奎支/);
  assert.match(chat, /Helumica 转给 瑞比 5 奎支/);
  assert.doesNotMatch(chat, /剩 \d|现有 \d/, "队友不能看到余额：" + chat);
  assert.doesNotMatch(chat, /1200|1190|1195|5712|5707/);
});

test("第 11 条：玩家用自己的钱包在商人处买东西，队友看到「由 瑞比 付」，看不到钱包剩多少", () => {
  const { c, send, teammateChat } = online();
  c.trpgMerchantCreate("老周");
  const m = c.LEDGER.merchants.at(-1);
  m.rows = [{ key: "medkit", price: null, stock: null }];
  c.trpgMerchantOpen(m.id);
  assert.equal(send("p2", { type: "shopBuy", merchant: m.id, key: "medkit", qty: 1, payer: "ruby" }).ok, true);
  assert.ok(c.trpgPurse("ruby") < 1234, "真的从瑞比的钱包付了");
  const chat = teammateChat();
  assert.match(chat, /（由 瑞比 付）/);
  assert.doesNotMatch(chat, /钱包剩|剩 \d/, "队友不能看到钱包余额：" + chat);
  assert.doesNotMatch(chat, new RegExp("\\b" + c.trpgPurse("ruby") + "\\b"));
});

test("README 规则改动记录写了 #340 第 11 条", () => {
  const md = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  const sec = md.slice(md.indexOf("## 规则改动记录"));
  const end = sec.indexOf("\n## ", 5);
  const body = end > 0 ? sec.slice(0, end) : sec;
  assert.match(body, /#340 第 11 条/);
});
