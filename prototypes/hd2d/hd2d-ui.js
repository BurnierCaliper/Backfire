/* Antlerscale: Backfire · HD-2D 战场原型 · 界面数据（纯函数，#238）
 *
 * 界面外壳（index.html 的队伍栏 / 技能栏、hd2d-scene.js 的铭牌）要画的东西，在这里整理成数据和 HTML 片段：
 *   econHtml(econ, big)   铭牌上的行动点 / 附赠动作（plateData 的 econ；画法照正式画面的单位卡 unit-card.js）
 * 不碰 three.js，也不碰 DOM，Node 里可以直接 require 来测（tests/hd2d-ui.test.js）。
 * 单位数据只读联机投影过的（online-view.js · projectUnit 的白名单）；坚毅生命（shp）压根不读。
 * 数值和对应表都在下面的 UI 里。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HD2DUI = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 配置（数值、对应表都在这里，逻辑里不写死）---------- */
  const UI = {
    /* 行动点 / 附赠：和 unit-card.js 一样画 max(上限, 现有) 个——行动点是圆点、附赠是三角，还有的实心、用掉的空心 / 灰；
     * 超过 maxPips 个就不画了，改写数字（训练木桩之类的） */
    econ: { maxPips: 4 }
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- 铭牌上的行动点 / 附赠 ---------- */
  /** 「行动点 1/1 · 附赠 0/1」（悬停说明、读屏用） */
  function econText(econ) {
    if (!econ) return "";
    return `行动点 ${econ.ap.cur}/${econ.ap.max} · 附赠 ${econ.bonus.cur}/${econ.bonus.max}`;
  }
  /** 一种（行动点 ap / 附赠 bn）的小标记：画 max(上限, 现有) 个，前 cur 个是满的；太多就写数字 */
  function pipsOf(kind, v, label) {
    const n = Math.max(v.max, v.cur);
    if (!n) return "";
    if (n > UI.econ.maxPips) return `<b class="${kind}">${label}${v.cur}/${v.max}</b>`;
    let s = "";
    for (let i = 0; i < n; i++) s += `<i class="${kind}${i < v.cur ? " on" : ""}"></i>`;
    return s;
  }
  /** 铭牌上的行动点 / 附赠（plateData 的 econ：投影里的 ap / apMax / bonus / bonusMax）。
   *  紧凑铭牌：贴在卡片右上角的一小块（不占名字和血条的地方）；近景放大的铭牌（big）：写在名字那一行。econ 是 null（配置物等）时不画 */
  function econHtml(econ, big) {
    if (!econ) return "";
    const body = pipsOf("ap", econ.ap, "行") + pipsOf("bn", econ.bonus, "附");
    if (!body) return "";
    const t = esc(econText(econ));
    return `<span class="pl-econ${big ? " in" : ""}" title="${t}" role="img" aria-label="${t}">${body}</span>`;
  }

  return { UI, esc, econText, econHtml };
});
