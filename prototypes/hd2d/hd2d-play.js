/* Antlerscale: Backfire · HD-2D 战场原型 · 按联机玩家收到的包播攻击演出（浏览器）
 *
 * 只拿投影过的包（OnlineView.projectPacket：state / tape / fx），不读房主的原始 state。
 * 画法全用现成的 2D 演出：attack-fx.js 的出手 windup → 弹道 travel → 打中 impact（刀光、冲击星……）、hit-fx.js 的受击粒子 HitFx.burst、
 * 击倒的红叉 ko、格挡 clash；位置问适配器（hd2d-fx.js · adapter：3D 铭牌投影到屏幕上的矩形）。伤害数字是这里的纸片风 DOM（粗墨线 + 属性色）。
 * 纸片感（hd2d-fx.js · paperOf）：打中的那一下，attack-fx 的画布按镜头俯角在竖直方向压扁一点（CSS 变换，不改 attack-fx 的画法），脚下地台上投一道淡影子。
 *
 *   await HD2DPlay.play(packet, ad, { before, bigHit, view, onImpact, camera })
 *     ad        适配器（rectOf / zoneRectOf / track / remember）
 *     before    出招前画面用的那一份（上一个包的 state；比一比谁被击倒）
 *     bigHit    规则的 bigHitInfo（大伤害的数字加 !! 放大）
 *     view()    画面大小和上下被界面盖住的像素（数字不顶进顶栏）
 *     onImpact  第一下打中的那一刻：画面换成包里的 state（铭牌的血条跟着掉）；跳过时也照样换
 *     camera    { push(actorId, targetId, secs) 出手时推一下镜头, release(secs) 播完拉回 }（页面给；关掉 / 减少动态效果时页面那边不推）
 *     lens()    这一刻的镜头（纸片感按俯角压扁）
 *   HD2DPlay.setClock(fn)   演出倍率（1 正常、0.5 两倍速、0 跳过）：同时交给 AttackFx.setClock；数字、影子停留的时长、推镜头的快慢也跟着它
 *   HD2DPlay.skip()         跳过：正在播的立刻结束（attack-fx / hit-fx 清掉、数字和影子拿掉、镜头直接回去），play 马上返回
 * 数值（字号、颜色、时长、间隔、压扁、影子、推多少）在 hd2d-fx.js 的 FX。 */
(function (root) {
  "use strict";
  const F = root.HD2DFx;
  let layer = null, shade = null, live = [], run = null;
  let clockFn = () => 1;
  const clockScale = () => { const s = Number(clockFn()); return Number.isFinite(s) && s >= 0 ? s : 1; };

  /** 两层：影子在下面（压在攻击演出底下，地台上），数字在最上面（受击粒子上面） */
  function ensureLayers() {
    if (!layer || !layer.isConnected) {
      layer = document.createElement("div");
      layer.id = "hd2d-pop";
      layer.setAttribute("aria-hidden", "true");
      document.body.appendChild(layer);
    }
    if (!shade || !shade.isConnected) {
      shade = document.createElement("div");
      shade.id = "hd2d-shade";
      shade.setAttribute("aria-hidden", "true");
      document.body.appendChild(shade);
    }
  }
  /** 放一个会自己消失的元素（跳过时一起拿掉） */
  function put(host, cls, text, css, life) {
    const el = document.createElement("div");
    el.className = cls;
    if (text != null) el.textContent = text;
    el.style.cssText = css;
    host.appendChild(el);
    live.push(el);
    setTimeout(() => { el.remove(); live = live.filter(x => x !== el); }, life + 60);
    return el;
  }
  /** 弹出一批数字（这一段打中的）：位置已经按 placeNumbers 排好，两两不压住。跳过（倍率 0）时不弹 */
  function showNumbers(list) {
    const s = clockScale();
    if (!list.length || s <= 0) return;
    ensureLayers();
    const N = F.FX.num, life = Math.max(1, (N.dur.pop + N.dur.hold + N.dur.out) * s);
    list.forEach(n => put(layer, "hd2d-num k-" + n.kind, n.text,
      `left:${n.x.toFixed(1)}px;top:${n.y.toFixed(1)}px;font-size:${n.size.toFixed(1)}px;--c:${F.colorOf(n)};--ink:${n.ink.toFixed(1)}px;` +
      `--ink-c:${N.colors.ink};--paper:${N.colors.paper};--tilt:${n.tilt}deg;--rise:${N.rise}px;--life:${life}ms`, life));
  }
  /** 纸片感：attack-fx 的画布按俯角压扁（以打中的那一点为中心），脚下地台上一道淡影子 */
  function paper(p) {
    const s = clockScale();
    if (!p || s <= 0) return;
    const cv = document.querySelector("canvas.atkfx");
    if (cv) { cv.style.transformOrigin = `${p.origin.x.toFixed(1)}px ${p.origin.y.toFixed(1)}px`; cv.style.transform = `scaleY(${p.squash.toFixed(3)})`; }
    ensureLayers();
    const S = p.shadow, life = Math.max(1, F.FX.paper.shadow.dur * s);
    put(shade, "hd2d-shadow", null, `left:${S.x.toFixed(1)}px;top:${S.y.toFixed(1)}px;width:${S.w.toFixed(1)}px;height:${S.h.toFixed(1)}px;--o:${S.opacity};--life:${life}ms`, life);
  }
  function unpaper() {
    const cv = document.querySelector("canvas.atkfx");
    if (cv) { cv.style.transform = ""; cv.style.transformOrigin = ""; }
  }

  /**
   * 播一个包。返回的 Promise 在最后一段数字弹出来、镜头拉回去以后结束（数字自己淡出）；跳过时马上结束。
   * 只读 packet（投影过的），位置全问适配器
   */
  async function play(packet, ad, opts) {
    opts = opts || {};
    const me = run = { skipped: false, kick: null };
    const skipped = new Promise(r => { me.kick = r; });
    const wait = (p) => Promise.race([p, skipped]);
    const cue = F.cues(packet, { before: opts.before, bigHit: opts.bigHit });
    const ids = [cue.actor, cue.target].concat(cue.waves.map(w => w.unitId), cue.numbers.map(n => n.unitId)).filter(Boolean);
    ad.remember(ids);                                   // 先记一遍：被打死的结算后就不在画面上了
    const view = opts.view ? opts.view() : { width: innerWidth, height: innerHeight, top: 0 };
    const move = cue.move, cam = opts.camera, P = F.FX.push;
    let applied = false, pushed = false;
    const impactNow = () => { if (!applied) { applied = true; if (opts.onImpact) opts.onImpact(); } };
    try {
      if (move && cue.actor && cue.target && clockScale() > 0) {
        if (cam && cam.push) pushed = !!cam.push(cue.actor, cue.target, P.in * clockScale());
        // 推到位再出手：attack-fx 的出手 / 弹道在开始那一刻按矩形画（没有 track），镜头停住了，弹道才对得上铭牌
        if (pushed) { await wait(AttackFx.after(P.in * 1000)); if (me.skipped) return cue; }
        const from = ad.rectOf(cue.actor), to = ad.rectOf(cue.target);
        await wait(AttackFx.windup(from, to, move));
        if (me.skipped) return cue;
        if (move.area) AttackFx.area(ad.zoneRectOf(packetZone(packet, cue.target)) || to, from, move);
        else await wait(AttackFx.travel(ad.rectOf(cue.actor), ad.rectOf(cue.target), move));
        if (me.skipped) return cue;
      }
      impactNow();
      const waves = cue.waves.length ? cue.waves : (cue.target ? [{ unitId: cue.target, el: move ? move.el : "physical" }] : []);
      for (let i = 0; i < waves.length && !me.skipped; i++) {
        const w = waves[i], at = ad.rectOf(w.unitId), from = cue.actor ? ad.rectOf(cue.actor) : null;
        if (at && move) AttackFx.impact(at, move, { n: i, from });
        if (at && opts.lens) paper(F.paperOf(F.lens(opts.lens()), at));
        if (at && root.HitFx && clockScale() > 0) HitFx.burst(w.el || "physical", at, { big: !!(move && move.big) });
        if (i === 0 && cue.parried && at) AttackFx.clash(at);
        showNumbers(F.placeNumbers(cue.numbers.filter(n => n.wave === i), ad.rectOf, view));
        if (i < waves.length - 1) await wait(AttackFx.after(F.FX.timing.hitGap));
      }
      if (!waves.length) showNumbers(F.placeNumbers(cue.numbers, ad.rectOf, view));
      if (cue.ko.length && !me.skipped) {
        await wait(AttackFx.after(F.FX.timing.koDelay));
        unpaper();                                      // 击倒的红叉要停一阵：画布先复原，红叉不会画到一半变形
        if (!me.skipped) cue.ko.forEach(id => { const r = ad.rectOf(id); if (r) AttackFx.ko(r, { track: ad.track(id) }); });
      }
      if (!me.skipped) await wait(AttackFx.after(F.FX.paper.shadow.dur));
      return cue;
    } finally {
      impactNow();                                      // 跳过也要把画面换成包里的 state
      unpaper();
      if (pushed && cam.release) cam.release(me.skipped ? 0 : P.out * clockScale());
      if (run === me) run = null;
    }
  }
  /** 目标所在的区（范围攻击画在整块地台上）：只看包里的 state */
  function packetZone(packet, id) {
    const u = packet && packet.state && (packet.state.units || []).find(x => x.id === id);
    return u ? Number(u.zone) : null;
  }
  /** 数字、影子都拿掉 */
  function clear() { live.forEach(el => el.remove()); live = []; unpaper(); }
  /** 跳过：正在播的立刻结束 */
  function skip() {
    const r = run;
    if (r) { r.skipped = true; if (r.kick) r.kick(); }
    if (root.AttackFx) AttackFx.skip();
    if (root.HitFx) HitFx.clear();
    clear();
  }

  root.HD2DPlay = {
    play, clear, skip,
    get busy() { return !!run; },
    setClock(fn) { clockFn = typeof fn === "function" ? fn : () => 1; if (root.AttackFx) AttackFx.setClock(clockFn); }
  };
})(typeof window !== "undefined" ? window : globalThis);
