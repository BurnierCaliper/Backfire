// 主菜单的看板娘（#552，主人 11/01）：柏妮尔的立绘放进主菜单首页（game.html · #t-home 的最后一个子元素 #t-mascot），点一下抖一下（title-mascot.js）。
// 这里是不用浏览器的那部分：页面结构（图片、替代文字、按钮、不响音效的标记、脚本先后、桌面版打包带上图片），
// 点一下加上 / 动画播完拿掉抖动的 class（连点从头再播、不叠加；animationend 没来时按时间兜底），图片读不出来整个藏起来，样式里减少动态效果时不位移。
// Node 里用 tests/mini-dom.js 跑 game.html 的真页面结构；摆的位置、真的抖、键盘、减少动态效果、不触发菜单、不响音效在 tests/title-mascot-ui.test.js（真浏览器）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const MD = require("./mini-dom");

const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const IMG = "art/burnier/burnier-stand-720.png";

/** game.html 的 <body> 解析进小 DOM；before(window) 在加载 title-mascot.js 之前改页面（比如把图片设成已经读失败） */
function page(before) {
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body);
  const ctx = vm.createContext(P.window);
  if (before) before(P.window, P.document);
  vm.runInContext(read("title-mascot.js"), ctx, { filename: "title-mascot.js" });
  const doc = P.document, el = doc.getElementById("t-mascot");
  return { w: P.window, doc, el, img: el && el.querySelector("img"), M: P.window.TitleMascot };
}
/** 动画播完：animationend 从 target 发出、往上冒泡（同浏览器） */
const animEnd = (p, target, name) => target.dispatchEvent(new MD.Event("animationend", { bubbles: true, animationName: name || "tMascotShake" }));
/** PNG 的宽高（IHDR 在文件头第 16–23 字节） */
function pngSize(file) {
  const b = fs.readFileSync(path.join(ROOT, file));
  assert.equal(b.toString("latin1", 1, 4), "PNG", file + " 是 PNG");
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

test("game.html：主菜单首页 #t-home 的最后一个是柏妮尔的立绘（button#t-mascot 里一张 burnier-stand-720.png，替代文字「柏妮尔」，标了 data-sfx-none 不响音效）；原来的四个按钮和顺序不变；title-mascot.js 在 screens.js 后面加载，桌面版打包带上这张图", () => {
  const p = page();
  const home = p.doc.getElementById("t-home");
  assert.ok(p.el, "有立绘");
  assert.equal(p.el.parentNode, home, "在主菜单首页里（进子菜单跟着 #t-home 一起藏起来）");
  assert.equal(home.lastElementChild, p.el, "排在最后：前面几个按钮的 :nth-child 不变（皮肤按它歪的角度照旧）");
  assert.deepEqual(home.children.filter(c => c !== p.el).map(c => c.id), ["t-local", "t-online", "t-codex", "t-rules"], "原来的按钮和顺序不变");
  assert.ok(home.children.filter(c => c !== p.el).every(c => c.classList.contains("t-btn")));
  // 按钮：键盘能聚焦，Enter / 空格就是按钮自己的 click；不是菜单按钮（screens.js 只给带 data-view 的按钮接子菜单，图鉴 / 规则说明按 id 接）
  assert.equal(p.el.localName, "button");
  assert.equal(p.el.getAttribute("type"), "button", "不是提交按钮");
  assert.ok(!p.el.classList.contains("t-btn"), "不当成菜单按钮（.t-btn）");
  assert.ok(!p.el.hasAttribute("data-view") && !p.el.hasAttribute("data-back"), "不接子菜单 / 返回");
  assert.ok(p.el.hasAttribute("data-sfx-none"), "sfx.js 统一挂的点击声、悬停声跳过它（不加音效）");
  assert.ok(!p.el.hasAttribute("tabindex"), "照按钮默认的顺序聚焦（在四个按钮后面）");
  // 图片：网页用的那一张（499×720），宽高写在标签上（先占好比例），替代文字是按钮的名字
  assert.equal(p.img.getAttribute("src"), IMG);
  assert.equal(p.img.getAttribute("alt"), "柏妮尔");
  assert.equal(p.el.textContent.trim(), "", "按钮里没有别的字：名字就是图片的替代文字");
  assert.ok(fs.existsSync(path.join(ROOT, IMG)), "图片在仓库里");
  assert.deepEqual(pngSize(IMG), { w: Number(p.img.getAttribute("width")), h: Number(p.img.getAttribute("height")) }, "标签上的宽高和图片一样");
  assert.deepEqual(pngSize(IMG), { w: 499, h: 720 });
  assert.equal(p.img.getAttribute("draggable"), "false", "按住拖不会拖出一张图");
  // 脚本：在 screens.js 后面加载（主菜单的切换照旧在 screens.js，这里只管立绘）
  const html = read("game.html"), at = f => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at("title-mascot.js") > at("screens.js") && at("screens.js") > 0, "title-mascot.js 在 screens.js 后面");
  // 桌面版（tools/desktop/build.sh 只放玩家需要的文件）：带上这张图，不然桌面版的主菜单没有立绘
  assert.match(read("tools/desktop/build.sh"), /cp art\/burnier\/burnier-stand-720\.png "\$STAGE\/game\/art\/burnier\/"/);
});

test("点一下：加上抖动的 class（.shake），图片的动画播完（animationend）拿掉；连点从头再播（拿掉再加上），不叠加；别的东西的动画结束不算", () => {
  const p = page();
  const C = p.M.CONFIG;
  assert.equal(C.shakeClass, "shake");
  assert.ok(C.shakeMs > 0 && C.shakeMs <= 800, "几百毫秒内抖完");
  assert.equal(p.el.style.getPropertyValue("--t-mascot-shake"), C.shakeMs + "ms", "时长写进 CSS 变量，动画按它播（数值只在 TITLE_MASCOT 一处）");
  assert.ok(!p.el.classList.contains("shake"), "开始没在抖");
  p.el.click();
  assert.ok(p.el.classList.contains("shake"), "点一下就抖");
  assert.equal(p.M.shaking(), true);
  // 连点：先拿掉再加回去（浏览器里中间强制重排，动画从头播），class 只有一个
  const calls = [], cl = p.el.classList, add = cl.add, remove = cl.remove;
  cl.add = (...c) => { calls.push("add " + c.join(" ")); return add(...c); };
  cl.remove = (...c) => { calls.push("remove " + c.join(" ")); return remove(...c); };
  p.el.click(); p.el.click();
  cl.add = add; cl.remove = remove;
  assert.deepEqual(calls, ["remove shake", "add shake", "remove shake", "add shake"], "每一下都先拿掉再加上（从头再播）");
  assert.ok(p.el.classList.contains("shake"));
  assert.equal(p.el.className.split(/\s+/).filter(c => c === "shake").length, 1, "不叠加");
  // 动画播完：只认图片自己的动画
  animEnd(p, p.el, "somethingElse");
  assert.ok(p.el.classList.contains("shake"), "按钮自己（或别的东西）的动画结束不算");
  animEnd(p, p.img);
  assert.ok(!p.el.classList.contains("shake"), "图片的动画播完就拿掉");
  assert.equal(p.M.shaking(), false);
  // 键盘的 Enter / 空格在浏览器里也是 click（按钮自带），这里直接发 click 一样
  p.el.dispatchEvent(new MD.Event("click", { bubbles: true }));
  assert.ok(p.el.classList.contains("shake"), "播完以后再点照样抖");
  p.M.stop();
});

test("animationend 没来（被打断、页面在后台……）：按 TITLE_MASCOT.shakeMs + spareMs 兜底拿掉，不会卡在抖的状态；连点时按最后一下重新算", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const p = page();
  const C = p.M.CONFIG, total = C.shakeMs + C.spareMs;
  assert.ok(C.spareMs >= 0 && total < 1000);
  p.el.click();
  t.mock.timers.tick(total - 1);
  assert.ok(p.el.classList.contains("shake"), "还没到时间");
  t.mock.timers.tick(1);
  assert.ok(!p.el.classList.contains("shake"), "到时间就拿掉");
  // 连点：每一下都重新算
  p.el.click();
  t.mock.timers.tick(total - 100);
  p.el.click();
  t.mock.timers.tick(150);
  assert.ok(p.el.classList.contains("shake"), "第二下从头算，第一下的时间到了也不拿掉");
  t.mock.timers.tick(total);
  assert.ok(!p.el.classList.contains("shake"));
  // 动画播完先拿掉了：之后计时器到了也没事
  p.el.click(); animEnd(p, p.img);
  assert.ok(!p.el.classList.contains("shake"));
  t.mock.timers.tick(total * 2);
  assert.ok(!p.el.classList.contains("shake"));
});

test("图片读不出来：整个立绘藏起来（hidden，不留空白大框），点了也不抖；脚本跑到之前就已经读失败（读完了却没有尺寸）的也一样；读得出来的照常显示", () => {
  // 加载中出错（error 事件）
  const p = page();
  assert.ok(!p.el.hidden, "正常时显示");
  p.el.click();
  assert.ok(p.el.classList.contains("shake"));
  p.img.dispatchEvent(new MD.Event("error"));
  assert.equal(p.el.hidden, true, "读不出来就藏起来");
  assert.ok(!p.el.classList.contains("shake"), "正在抖的也收掉");
  assert.equal(p.M.shake(), false);
  p.el.click();
  assert.ok(!p.el.classList.contains("shake"), "藏起来了不抖");
  // 脚本跑到之前已经失败了：complete 而且 naturalWidth 是 0
  const failed = page((w, doc) => { const img = doc.querySelector("#t-mascot img"); img.complete = true; img.naturalWidth = 0; });
  assert.equal(failed.el.hidden, true, "接上的时候就发现读失败了");
  // 已经读好了：照常
  const loaded = page((w, doc) => { const img = doc.querySelector("#t-mascot img"); img.complete = true; img.naturalWidth = 499; });
  assert.equal(loaded.el.hidden, false);
  // 主菜单的按钮都还在、都能用
  for (const id of ["t-local", "t-online", "t-codex", "t-rules"]) assert.ok(!failed.doc.getElementById(id).hidden && !failed.doc.getElementById(id).disabled, id);
});

test("样式：藏起来真的不占地方（[hidden] 压过 display: block）；抖动用图片上的 tMascotShake（时长读 --t-mascot-shake），开着「减少动态效果」时换成只淡一下的 tMascotBlink（不位移、不转）；两套样式（game.css、skin.css 皮肤）都管到立绘", () => {
  const css = read("game.css"), skin = read("skin.css");
  assert.match(css, /\.t-mascot\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.t-mascot\.shake img \{ animation: tMascotShake var\(--t-mascot-shake, \d+ms\)/);
  /** @keyframes name { … } 里面的东西（数大括号找到它自己的结尾） */
  const frames = name => {
    const at = css.indexOf(`@keyframes ${name} {`);
    if (at < 0) return "";
    const start = css.indexOf("{", at) + 1;
    for (let i = start, depth = 1; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
    }
    return "";
  };
  assert.match(frames("tMascotShake"), /translate:[\s\S]*rotate:/, "抖：左右晃");
  const blink = frames("tMascotBlink");
  assert.ok(blink && /opacity/.test(blink), "减少动态效果：淡一下");
  assert.doesNotMatch(blink, /translate|rotate|transform|scale/, "减少动态效果：不位移、不转、不缩放");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.t-mascot\.shake img \{ animation-name: tMascotBlink; \} \}/);
  assert.match(css, /\.t-mascot img \{[^}]*pointer-events: none/, "动的只是图片、不接鼠标：抖的时候点不到别处");
  assert.match(skin, /\.t-mascot img \{[^}]*drop-shadow/, "皮肤：硬投影");
  assert.match(skin, /\.t-mascot:focus-visible \{[^}]*outline/, "皮肤：焦点框");
});
