/* 角鳞 · 主菜单的看板娘（#552）：柏妮尔（柏妮尔·卡莉帕，游戏的吉祥物兼看板娘）的立绘站在主菜单旁边，点一下抖一下。
 *
 * 立绘是 game.html 里 #t-home 的最后一个子元素 <button id="t-mascot">（图片 art/burnier/burnier-stand-720.png，替代文字「柏妮尔」），
 * 进「本地玩法」「联机玩法」子菜单时跟着 #t-home 一起藏起来，进游戏时整个标题画面藏起来；位置、大小、动画在 game.css「标题界面 · 看板娘」，
 * 街头废土皮肤（skin.css）只另加投影和焦点框的颜色。这里只管两件事：
 *   · 点一下（触屏点一下、键盘 Enter / 空格都是按钮自己的 click）：加上抖动的 class，动画播完拿掉；
 *     连点从头再播（先拿掉、强制重排、再加上），不叠加，也不会卡在抖的状态（animationend 没来时按 TITLE_MASCOT 的时间兜底拿掉）。
 *     开着「减少动态效果」时 CSS 换成很轻的一下（不位移），流程一样。
 *   · 图片读不出来：整个按钮藏起来（hidden），不留空白大框、不报错，主菜单照常用。
 *   · 连点彩蛋（#554）：每点一下（和抖一下是同一个 click）记一下，连续点到第 BURNIER_TAP.gulpAfter 下，立绘换成「举着油桶猛灌汽油」的搞笑图
 *     （按钮里的第二张图，照常抖一下），gulpMs 后自动换回立绘、计数归零。两下之间隔超过 gap 就从头数；搞笑图显示期间再点只抖：不数、不延长。
 *     换图只是给按钮加 / 拿掉 class（game.css：两张图叠在同一个按钮里，只换看得见的那张，版面不动）；开着「减少动态效果」照样换，只是不抖（CSS）。
 *     搞笑图读不出来（读失败、还没读好）就不换，立绘照常；不响音效、不存档（刷新页面从头数）。
 * 只是画面：不碰规则；点它不触发任何菜单功能（click 里只抖一下、记一下）；不响音效（按钮带 data-sfx-none，sfx.js 统一挂的点击声 / 悬停声跳过它）。 */
(function (root) {
  "use strict";
  const TITLE_MASCOT = {
    id: "t-mascot",          // 立绘按钮（game.html）
    shakeClass: "shake",     // 抖动用的 class（game.css · .t-mascot.shake）
    shakeMs: 450,            // 抖一下多长（ms）：写进按钮的 CSS 变量 --t-mascot-shake，动画按它播
    spareMs: 150             // animationend 没来（被打断、页面在后台……）时，播完再等这么久按时间拿掉 class
  };
  // 连点彩蛋（#554，主人 11/01）：数值主人可能会调，只改这里（每点一下都现读，改了下一下就按新的算）
  const BURNIER_TAP = {
    gulpAfter: 10,               // 连续点到第几下换成搞笑图
    gap: 1500,                   // 两下之间隔超过这么多毫秒就从头数（正好这么多还算连着）
    gulpMs: 3000,                // 搞笑图显示多久（ms），到时间换回立绘、计数归零；显示期间再点只抖，不数、不延长
    gulpClass: "gulp",           // 换图用的 class（game.css · .t-mascot.gulp）
    gulpImg: "t-mascot-gulp"     // 搞笑图（game.html：#t-mascot 里立绘后面的第二张图）的 class
  };

  let el = null, img = null, timer = 0;
  let gulpImg = null, taps = 0, lastTap = 0, gulpTimer = 0;   // 彩蛋：搞笑图、连点了几下、上一下的时间、换回去的计时器

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
  /** 图片读不出来：整个立绘藏起来（hidden：不占地方、Tab 也不会停在一个看不见的按钮上）；正在显示的搞笑图一起收掉、计数归零 */
  function hide() {
    stop();
    endGulp();
    if (el) el.hidden = true;
  }
  const shaking = () => !!el && el.classList.contains(TITLE_MASCOT.shakeClass);
  /** 动画播完：只认图片自己的抖动（立绘上以后加了别的动画，也不会提前把抖动收掉） */
  function onAnimEnd(e) { if (e.target === img) stop(); }

  /* ---------- 连点彩蛋（#554） ---------- */
  /** 搞笑图读好了：读完了（complete）而且有尺寸。读失败（没有尺寸）、还没读好都算没有 */
  const gulpReady = () => !!gulpImg && !!gulpImg.complete && gulpImg.naturalWidth > 0;
  const gulping = () => !!gulpTimer;
  /** 换回立绘：拿掉 class、计时器清掉、计数归零 */
  function endGulp() {
    if (gulpTimer) { clearTimeout(gulpTimer); gulpTimer = 0; }
    taps = 0; lastTap = 0;
    if (el) el.classList.remove(BURNIER_TAP.gulpClass);
  }
  /** 记一下连点：搞笑图显示期间不数（也不延长）；和上一下隔超过 gap 就从头数；数到 gulpAfter 而且搞笑图读好了就换图，gulpMs 后换回。
   *  搞笑图还没读好时接着数，读好以后再连着点的下一下就换 */
  function countTap() {
    if (gulpTimer) return;
    const now = Date.now();
    if (now - lastTap > BURNIER_TAP.gap) taps = 0;
    taps++; lastTap = now;
    if (taps < BURNIER_TAP.gulpAfter || !gulpReady()) return;
    el.classList.add(BURNIER_TAP.gulpClass);
    gulpTimer = setTimeout(endGulp, BURNIER_TAP.gulpMs);
  }
  /** 点一下（click：鼠标、手指、键盘 Enter / 空格）：抖一下，再记一下连点；立绘藏起来了（读不出来）不抖、不数 */
  function onTap() { if (shake()) countTap(); }

  /** 接上 game.html 里的立绘（doc 默认是当前页面）；没有这个按钮就什么都不做，返回 null。重复接同一个按钮不会多挂一份 */
  function bind(doc) {
    doc = doc || root.document;
    const found = doc && doc.getElementById(TITLE_MASCOT.id);
    if (!found) return null;
    stop();
    endGulp();
    el = found;
    img = el.querySelector("img");
    gulpImg = el.querySelector("." + BURNIER_TAP.gulpImg);
    if (el.style && el.style.setProperty) el.style.setProperty("--t-mascot-shake", TITLE_MASCOT.shakeMs + "ms");
    el.addEventListener("click", onTap);
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

  root.TitleMascot = { CONFIG: TITLE_MASCOT, TAP: BURNIER_TAP, bind, shake, stop, hide, shaking, gulping, tapCount: () => taps };
})(typeof window !== "undefined" ? window : globalThis);
