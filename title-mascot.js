/* 角鳞 · 主菜单的看板娘（#552）：柏妮尔（柏妮尔·卡莉帕，游戏的吉祥物兼看板娘）的立绘站在主菜单旁边，点一下抖一下。
 *
 * 立绘是 game.html 里 #t-home 的最后一个子元素 <button id="t-mascot">（图片 art/burnier/burnier-stand-720.png，替代文字「柏妮尔」），
 * 进「本地玩法」「联机玩法」子菜单时跟着 #t-home 一起藏起来，进游戏时整个标题画面藏起来；位置、大小、动画在 game.css「标题界面 · 看板娘」，
 * 街头废土皮肤（skin.css）只另加投影和焦点框的颜色。这里只管两件事：
 *   · 点一下（触屏点一下、键盘 Enter / 空格都是按钮自己的 click）：加上抖动的 class，动画播完拿掉；
 *     连点从头再播（先拿掉、强制重排、再加上），不叠加，也不会卡在抖的状态（animationend 没来时按 TITLE_MASCOT 的时间兜底拿掉）。
 *     开着「减少动态效果」时 CSS 换成很轻的一下（不位移），流程一样。
 *   · 图片读不出来：整个按钮藏起来（hidden），不留空白大框、不报错，主菜单照常用。
 * 只是画面：不碰规则；点它不触发任何菜单功能（click 里只抖一下）；不响音效（按钮带 data-sfx-none，sfx.js 统一挂的点击声 / 悬停声跳过它）。 */
(function (root) {
  "use strict";
  const TITLE_MASCOT = {
    id: "t-mascot",          // 立绘按钮（game.html）
    shakeClass: "shake",     // 抖动用的 class（game.css · .t-mascot.shake）
    shakeMs: 450,            // 抖一下多长（ms）：写进按钮的 CSS 变量 --t-mascot-shake，动画按它播
    spareMs: 150             // animationend 没来（被打断、页面在后台……）时，播完再等这么久按时间拿掉 class
  };

  let el = null, img = null, timer = 0;

  /** 抖完：拿掉 class，计时器清掉 */
  function stop() {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (el) el.classList.remove(TITLE_MASCOT.shakeClass);
  }
  /** 抖一下：class 先拿掉再加回去（中间强制重排一次，动画才会从头播），计时器重新算。藏起来了（图片读不出来）不抖 */
  function shake() {
    if (!el || el.hidden) return false;
    if (timer) clearTimeout(timer);
    el.classList.remove(TITLE_MASCOT.shakeClass);
    void el.offsetWidth;
    el.classList.add(TITLE_MASCOT.shakeClass);
    timer = setTimeout(stop, TITLE_MASCOT.shakeMs + TITLE_MASCOT.spareMs);
    return true;
  }
  /** 图片读不出来：整个立绘藏起来（hidden：不占地方、Tab 也不会停在一个看不见的按钮上） */
  function hide() {
    stop();
    if (el) el.hidden = true;
  }
  const shaking = () => !!el && el.classList.contains(TITLE_MASCOT.shakeClass);
  /** 动画播完：只认图片自己的抖动（立绘上以后加了别的动画，也不会提前把抖动收掉） */
  function onAnimEnd(e) { if (e.target === img) stop(); }

  /** 接上 game.html 里的立绘（doc 默认是当前页面）；没有这个按钮就什么都不做，返回 null。重复接同一个按钮不会多挂一份 */
  function bind(doc) {
    doc = doc || root.document;
    const found = doc && doc.getElementById(TITLE_MASCOT.id);
    if (!found) return null;
    stop();
    el = found;
    img = el.querySelector("img");
    if (el.style && el.style.setProperty) el.style.setProperty("--t-mascot-shake", TITLE_MASCOT.shakeMs + "ms");
    el.addEventListener("click", shake);
    el.addEventListener("animationend", onAnimEnd);
    if (!img) { hide(); return el; }
    img.addEventListener("error", hide);
    // 脚本跑到这里之前图片可能已经读失败了（error 事件已经过去）：读完了（complete）却没有尺寸就是失败
    if (img.complete && !img.naturalWidth) hide();
    return el;
  }

  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", () => bind());
    else bind();
  }

  root.TitleMascot = { CONFIG: TITLE_MASCOT, bind, shake, stop, hide, shaking };
})(typeof window !== "undefined" ? window : globalThis);
