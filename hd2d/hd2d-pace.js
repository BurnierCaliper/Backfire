/* Antlerscale: Backfire · HD-2D 战场 · 什么时候画一帧、画得卡不卡（#321）
 *
 * 3D 战场（hd2d-scene.js）以前每一帧都画：像素比最高 2，后期有景深 / 泛光 / 热浪 / 调色，画面静止时也一直满负荷（联机玩家那边更卡、操作延迟更大）。
 * 现在场景每一帧先问这里画不画：
 *   · 满帧画（busy）：有演出在播、镜头在动（换段 / 推镜头 / 转场的过渡、拖动和它的惯性）、天气粒子在飞（沙 / 雨 / 雪 / 热浪……）、打雷（闪光、镜头抖）、
 *     刚变过（铭牌、标记、选中、换行动的人、窗口大小、画质……，之后 PACE.wake 秒都满帧：铭牌的位置、阻尼都走完）
 *   · 都没有（画面静止）：一秒只画 PACE.idle 帧——待机的小动画（行动光圈慢慢转、选中框一明一暗、飘浮物、灯闪、胶片颗粒）照样走，只是帧少一点；
 *     系统开了「减少动态效果」（待机动画本来就停住）又不在打雷：一帧都不画，等下一次变
 *   · 帧时间（画质「自动」降一档用，hd2d-field.js 的 FIELD.quality）：只量满帧画的时候两帧之间隔多久——开场、换画质以后满帧画够 PACE.slow.grace 秒才开始算
 *     （编译着色器、传贴图），之后每攒够 PACE.slow.secs 秒算一次平均，一帧超过 PACE.slow.ms 毫秒就算卡；两帧之间隔太久（切到后台、卡了一下，
 *     超过 PACE.slow.gap 秒）的那一下不算
 * 纯函数，Node 里能 require（tests/hd2d-pace.test.js）；页面里挂在 window.HD2DPace（hd2d-field.js 开新画面时在场景包前面加载，原型页也加载）。
 * 场景没找到它（浏览器缓存里还是旧的页面）就照旧每帧都画。
 *
 *   HD2DPace.PACE                    配置
 *   HD2DPace.busy(s)                 这一刻要不要满帧画（s 见下面）
 *   HD2DPace.due(last, now, s)       这一帧画不画：last = 上一次画的时间（秒；还没画过 = null），now 秒
 *   HD2DPace.meter(m, dt, full)      量帧时间：m = 上一次返回的（第一次 null），dt = 离上一次画隔了几秒，full = 这一帧和上一帧都是满帧画的 → { m, slow }
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HD2DPace = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 配置 ----------
   *   idle    画面静止时一秒画几帧（待机的小动画照走，只是帧少；场景每帧的 dt 最多 0.1 秒，这里不要低于 10）
   *   jitter  rAF 的间隔不是正好 1/60 秒：离该画的时候还差这么一点（秒）也算到了
   *   wake    变过以后接着满帧画多久（秒）
   *   flash   雷击的闪光（0–1）超过这么多算还在闪（满帧画）
   *   slow    帧时间：grace 开场 / 换画质以后满帧画够多少秒才开始算，secs 每攒够多少秒算一次平均，ms 平均一帧超过多少毫秒算卡（42 ≈ 不到 24 帧），
   *           gap 两帧之间超过多少秒的那一下不算 */
  const PACE = {
    idle: 12,
    jitter: 0.004,
    wake: 0.6,
    flash: 0.002,
    slow: { grace: 4, secs: 3, ms: 42, gap: 0.25 }
  };

  /** 这一刻要不要满帧画：s = {
   *    fx 演出在播（hd2d-field.js 给：联机 / 原型的整包演出、单机的出招演出 / 敌人行动）, tween 镜头在过渡（换段、推镜头、转场）, moved 拖动 / 惯性让镜头动了,
   *    particles 有天气粒子（沙 / 雨 / 雪 / 热浪……；飘浮物不算，它飘得慢）, motion 没开减少动态效果（开着时粒子停住，不用满帧）,
   *    flash 雷击的闪光 0–1, shake 镜头在抖, woke 刚变过（还在 PACE.wake 秒里） } */
  function busy(s) {
    s = s || {};
    return !!(s.fx || s.tween || s.moved || s.woke || s.shake || (s.particles && s.motion) || Number(s.flash) > PACE.flash);
  }
  /** 这一帧画不画：last = 上一次画的时间（秒；还没画过 = null），now 秒，s = busy 的那些再加 storm（雷鸣：减少动态效果时雷也照打，要按时间数）。
   *  要满帧画、还没画过 → 画；不然画面静止：减少动态效果又不在打雷 → 不画（等下一次变）；否则离上一次画够 1 / PACE.idle 秒才画 */
  function due(last, now, s) {
    s = s || {};
    if (last == null || busy(s)) return true;
    if (!s.motion && !s.storm) return false;
    return now - last >= 1 / PACE.idle - PACE.jitter;
  }
  /** 量帧时间：m = 上一次返回的（第一次 null），dt = 这一帧离上一次画隔了几秒，full = 这一帧和上一帧都是满帧画的（静止降帧时不算）。
   *  满帧画够 PACE.slow.grace 秒以后，每攒够 secs 秒算一次平均：一帧超过 ms 毫秒 → slow = true（算完从头再攒）。返回 { m, slow } */
  function meter(m, dt, full) {
    const S = PACE.slow;
    m = m ? { seen: m.seen, sum: m.sum, n: m.n } : { seen: 0, sum: 0, n: 0 };
    if (!full || !(dt > 0) || dt > S.gap) return { m, slow: false };
    m.seen += dt;
    if (m.seen <= S.grace) return { m, slow: false };
    m.sum += dt; m.n += 1;
    if (m.sum < S.secs) return { m, slow: false };
    const slow = (m.sum / m.n) * 1000 > S.ms;
    m.sum = 0; m.n = 0;
    return { m, slow };
  }

  return { PACE, busy, due, meter };
});
