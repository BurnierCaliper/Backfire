// #429 安卓手机（Chrome）当联机跑团主持人：战斗画面（纸片画面 + 新画面）在手机上能用——不用浏览器的那部分
// （要浏览器的在 tests/phone-host-ui.test.js）。
//   第 1 步：顶栏胶带（paper-ui.js · topHtml，单机 / 联机玩家同一份）在手机竖屏上远 / 中 / 近收成一个按钮；
//            放不下时右边的镜头、「工具 ▾」「菜单」不缩，左边的字按先后省略（online-paper.css；电脑上一条都套不上）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const UI = require("../paper-ui.js");
const OP = require("../online-paper.js");
const GP = require("../game-paper.js");

const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
/** CSS 里某一段 @media（照原样的条件）大括号里的内容 */
function mediaBody(css, cond) {
  const at = css.indexOf("@media " + cond + " {");
  if (at < 0) return null;
  let i = css.indexOf("{", at) + 1, depth = 1;
  const start = i;
  for (; i < css.length && depth; i++) { if (css[i] === "{") depth++; else if (css[i] === "}") depth--; }
  return css.slice(start, i - 1);
}
const CAMS = [{ label: "远", on: true }, { label: "中" }, { label: "近" }];

test("#429 顶栏：远 / 中 / 近后面多一个收成一个的按钮（.olp-cam-cyc）——写这一刻是哪一段，data-olp-cam-next 是下一段（远 → 中 → 近 → 远）；没有镜头就不画；联机、单机同一份", () => {
  const cyc = h => { const m = /<button type="button" class="olp-cam-cyc" data-olp-cam-next="(\d)" aria-label="([^"]*)">([^<]*)<\/button>/.exec(h); return m && { next: Number(m[1]), aria: m[2], label: m[3] }; };
  for (const P of [OP, UI.make(GP.GPAPER)]) {
    assert.deepEqual(cyc(P.topHtml({ cams: CAMS })), { next: 1, aria: "镜头 远：点一下换到 中", label: "远" });
    assert.deepEqual(cyc(P.topHtml({ cams: [{ label: "远" }, { label: "中", on: true }, { label: "近" }] })), { next: 2, aria: "镜头 中：点一下换到 近", label: "中" });
    assert.deepEqual(cyc(P.topHtml({ cams: [{ label: "远" }, { label: "中" }, { label: "近", on: true }] })), { next: 0, aria: "镜头 近：点一下换到 远", label: "近" });
    assert.deepEqual(cyc(P.topHtml({ cams: [{ label: "远" }, { label: "中" }, { label: "近" }] })), { next: 1, aria: "镜头 远：点一下换到 中", label: "远" }, "哪个都没亮：当成远景");
    assert.doesNotMatch(P.topHtml({}), /olp-cam/, "没有镜头按钮就不画");
    // 原来的三个照旧（电脑上就是它们）；读屏的字在配置表里
    const h = P.topHtml({ cams: CAMS });
    assert.equal((h.match(/class="olp-cam-b/g) || []).length, 3);
    assert.match(h, /data-olp-cam="0" aria-pressed="true"[^>]*>远</);
    assert.equal(P.PAPER.cam.next, "镜头 {0}：点一下换到 {1}");
  }
  // 点它：单机 game-paper.js、联机 online-ui.js 都按 data-olp-cam-next 点新画面原来那个按钮
  assert.match(read("game-paper.js"), /closest\("\[data-olp-cam\], \[data-olp-cam-next\]"\)[\s\S]{0,200}olpCamNext/);
  assert.match(read("online-ui.js"), /closest\("\[data-olp-cam\], \[data-olp-cam-next\]"\)[\s\S]{0,200}olpCamNext/);
});

test("#429 online-paper.css：收成一个的按钮平时藏着，手机竖屏那一段换上它（三个藏起来）；手机竖屏或触屏时胶带上右边那一组不缩，天气 / 时间 / 遭遇名 / 标题只拿剩下的地方（按先后），回合、行动、房间码照原样", () => {
  const css = read("online-paper.css");
  assert.match(css, /body\.ol-paper \.olp-cam-cyc \{\s*display: none;/, "平时（电脑上）藏着");
  const phone = mediaBody(css, OP.PAPER.phone.media);
  assert.ok(phone, "手机竖屏那一段");
  assert.match(phone, /body\.ol-paper \.olp-cam-b \{ display: none; \}/, "手机竖屏：三个收起来");
  assert.match(phone, /body\.ol-paper \.olp-cam-cyc \{ display: inline-block; \}/, "换成一个");
  const fit = mediaBody(css, "(max-width: 760px), (pointer: coarse)");
  assert.ok(fit, "手机竖屏或触屏（横过来）的那一段");
  assert.match(fit, /\.olp-top > \.olp-right \{ flex-shrink: 0; \}/, "右边的镜头、「工具 ▾」「菜单」不缩");
  assert.match(fit, /\.olp-top > :is\(\.olp-title, \.olp-sub, \.olp-time, \.olp-weather\) \{ flex-basis: 0; max-width: max-content; \}/, "只拿剩下的地方，最多照原样宽");
  const grow = k => Number((new RegExp("\\.olp-top > \\.olp-" + k + " \\{ flex-grow: (\\d+); \\}").exec(fit) || [])[1]);
  assert.ok(grow("weather") > grow("time") && grow("time") > grow("sub") && grow("sub") > grow("title") && grow("title") > 0, "先让给天气，再是时间、遭遇名，标题最后");
  assert.match(fit, /:is\(\.olp-title, \.olp-room, \.olp-meta\) \{ flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/, "放不下的省略成「…」");
  // 电脑上（鼠标、宽屏）照旧：基础那几条一个字没改
  assert.match(css, /body\.ol-paper \.olp-top > \* \{ flex-shrink: 0; \}/);
  assert.match(css, /body\.ol-paper \.olp-right \{ margin-left: auto; display: flex; align-items: center; gap: 10px; flex-shrink: 1; min-width: 0; \}/);
  assert.match(css, /body\.ol-paper \.olp-cam-b \{ width: 30px; padding: 0; color: var\(--olp-tape-ink\); background: transparent; \}/);
});
