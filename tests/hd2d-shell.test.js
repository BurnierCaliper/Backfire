// 新画面接入（四）（#297）：原型页的技能栏、队伍栏、主职责图标接进正式画面（单机 game.html、联机玩家）。
//   · 共用的一份在 hd2d/：hd2d-shell.js（收起 / 展开、换上 / 拆掉新外壳、技能按钮 / 唤出按钮 / 头像要的东西）、hd2d-ui.js（按钮里面、队伍栏一个人的 HTML 片段）；
//   · 收起 / 展开记在这台电脑上（localStorage，读写都包 try/catch），没记过时手机上默认收起；
//   · 换上新外壳只换样子：按钮还是 game.js / online-battle.js 自己建、自己接（出手流程只有原来那一份），拆掉以后 .g-hud 和换上之前一模一样；
//   · 只用投影过的单位：新加的 DOM 里没有坚毅生命的数字。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const shell = () => require("../hd2d/hd2d-shell.js");
const UI = () => require("../hd2d/hd2d-ui.js");

function memStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}

/* ---------- 1. 收起 / 展开记在本机 ---------- */
test("收起 / 展开：记在本机 localStorage（技能栏、队伍栏各一项，存 open / closed）；没记过按默认（手机收起）；读不了 / 存不了不报错", () => {
  const S = shell();
  const s = memStorage();
  assert.equal(S.isOpen("dock", s, true), true, "没记过：按默认（桌面展开）");
  assert.equal(S.isOpen("party", s, false), false, "没记过：按默认（手机收起）");
  assert.equal(S.setOpen("dock", false, s), true);
  assert.equal(s.m.get(S.SHELL.keys.dock), "closed");
  assert.equal(S.isOpen("dock", s, true), false, "收起记住了");
  S.setOpen("party", true, s);
  assert.equal(S.isOpen("party", s, false), true, "展开也记住");
  s.m.set(S.SHELL.keys.dock, "乱写的");
  assert.equal(S.isOpen("dock", s, true), true, "认不得：按默认");
  const broken = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } };
  assert.doesNotThrow(() => S.isOpen("dock", broken, true));
  assert.equal(S.isOpen("dock", broken, true), true, "读不了：按默认");
  assert.equal(S.setOpen("dock", false, broken), false, "存不了：不报错");
  assert.equal(S.isOpen("dock", null, false), false, "没有 localStorage：按默认");
  assert.equal(S.labelOf("dock", true), "技能 ▼");
  assert.equal(S.labelOf("dock", false), "技能 ▲");
  assert.equal(S.labelOf("party", true), "队伍 ◀");
  assert.equal(S.labelOf("party", false), "队伍 ▶");
});
