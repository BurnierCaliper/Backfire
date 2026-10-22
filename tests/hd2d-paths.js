// HD-2D 战场的文件在哪（#261）：模块和战场的样子挪到了正式目录 hd2d/（正式画面 game.html 的「新画面」和原型页共用一份），
// 原型页 prototypes/hd2d/ 只剩页面本身（index.html）、原型自己的界面外壳（hd2d-shell.css）和演示出招的房主那边（hd2d-host.js）。
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MOD = path.join(ROOT, "hd2d");                 // 战场的模块（布局、镜头、场景、美术包、天气、界面数据、攻击演出）和 hd2d.css
const PAGE = path.join(ROOT, "prototypes", "hd2d");  // 原型页
const mod = (f) => path.join(MOD, f);
const readMod = (f) => fs.readFileSync(mod(f), "utf8");
const readPage = (f) => fs.readFileSync(path.join(PAGE, f), "utf8");
/** 原型页加载的样式：正式的战场样式（hd2d/hd2d.css）+ 原型的界面外壳（prototypes/hd2d/hd2d-shell.css） */
const protoCss = () => readMod("hd2d.css") + "\n" + readPage("hd2d-shell.css");
/** 原型页里一个战场模块的 <script src>（从原型页指到正式目录） */
const pageSrc = (f) => "../../hd2d/" + f;

module.exports = { ROOT, MOD, PAGE, mod, readMod, readPage, protoCss, pageSrc };
