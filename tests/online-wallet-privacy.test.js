// issue #340 第 11 条：联机跑团的私人钱包余额不能经小队聊天（所有人都看得到）泄露给队友
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./headless");

function hideWalletsFromSource() {
  const src = fs.readFileSync(path.join(__dirname, "..", "hotseat-game.js"), "utf8");
  const m = src.match(/const hideWallets = (text => [\s\S]*?\);)\n/);
  assert.ok(m, "hotseat-game.js 有 hideWallets");
  return eval(m[1].replace(/;$/, ""));
}

test("第 11 条：「由谁付，钱包剩 N」/ 转账余额 / 进钱包现有 N 写进聊天时都去掉数字", () => {
  const hide = hideWalletsFromSource();
  assert.equal(hide("🛒 买了 绷带 ×1（由 瑞比 付，钱包剩 1166）"), "🛒 买了 绷带 ×1（由 瑞比 付）");
  assert.equal(hide("💰 瑞比 转给 Helumica 34 奎支（瑞比 剩 1200，Helumica 现有 5712）。"), "💰 瑞比 转给 Helumica 34 奎支。");
  assert.equal(hide("💰 120 奎支（卖出）进 瑞比 的钱包（现有 1320）。"), "💰 120 奎支（卖出）进 瑞比 的钱包。");
  // 所有人共用的公账照旧写
  assert.equal(hide("奎支 +5（奖励），现有 200。"), "奎支 +5（奖励），现有 200。");
});

test("第 11 条：联机转账后小队聊天里不写任何人的钱包余额", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "WALLET-340" });
  c.S.TRPG.active = true;
  c.LEDGER.purse = { ruby: 1234, helu: 5678 };
  // 直接走 hotseat-game 的 system 路径：挂上假 session.chat 收集文本
  const chats = [];
  const real = c.HotseatGame;
  // HotseatGame 已加载；用 trpgPurseTransfer + hideWallets 同源校验
  const notes = c.trpgPurseTransfer("ruby", "helu", 34);
  assert.match(notes[0], /剩 1200|现有 5712/, "规则层说明本身仍带余额（给本人/主持人看）");
  const hide = hideWalletsFromSource();
  const text = hide("💰 " + notes[0]);
  assert.match(text, /瑞比 转给 .+ 34 奎支/);
  assert.doesNotMatch(text, /1200|5712|剩 \d|现有 \d/);
  assert.equal(c.trpgPurse("ruby"), 1200);
  assert.equal(c.trpgPurse("helu"), 5712);
  // 源码：purseTransfer / 商店 / 工匠 / 义体 走 teamChat 而不是裸 session.chat
  const src = fs.readFileSync(path.join(__dirname, "..", "hotseat-game.js"), "utf8");
  assert.match(src, /teamChat\(sender, "💰 " \+ notes\[0\]\)/);
  assert.match(src, /teamChat\(sender, "🛒 "/);
  assert.match(src, /teamChat\(sender, "🦾 "/);
  assert.match(src, /teamChat\(sender, "🔨 "/);
  assert.doesNotMatch(src, /session\.chat\(sender, "💰 " \+ notes\[0\]\)/);
});

test("README 规则改动记录写了 #340 第 11 条", () => {
  const md = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  const sec = md.slice(md.indexOf("## 规则改动记录"));
  const end = sec.indexOf("\n## ", 5);
  const body = end > 0 ? sec.slice(0, end) : sec;
  assert.match(body, /#340 第 11 条/);
  assert.match(body, /钱包|hideWallets|小队聊天/);
});
