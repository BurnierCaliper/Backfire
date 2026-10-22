/* Antlerscale: Backfire · HD-2D 战场 · 攻击演出的纸片风数字、纸片感、推镜头（浏览器；原型按联机包播，正式画面的新画面一下一下调）
 *
 * 只拿投影过的包（OnlineView.projectPacket：state / tape / fx），不读房主的原始 state。
 * 画法全用现成的 2D 演出：attack-fx.js 的出手 windup → 弹道 travel → 打中 impact（刀光、冲击星……）、hit-fx.js 的受击粒子 HitFx.burst、
 * 击倒的红叉 ko、格挡 clash；位置问适配器（hd2d-fx.js · adapter：3D 铭牌投影到屏幕上的矩形）。伤害数字是这里的纸片风 DOM（粗墨线 + 属性色）。
 * 纸片感（hd2d-fx.js · paperOf）：打中的那一下，attack-fx 的画布按镜头俯角在竖直方向压扁一点（CSS 变换，不改 attack-fx 的画法），脚下地台上投一道淡影子。
 *
 *   await HD2DPlay.play(packet, ad, { before, bigHit, view, onImpact, camera })   原型：按一个包从头播到尾
 *     ad        适配器（rectOf / zoneRectOf / track / remember）
 *     before    出招前画面用的那一份（上一个包的 state；比一比谁被击倒）
 *     bigHit    规则的 bigHitInfo（大伤害的数字加 !! 放大）
 *     view()    画面大小和上下被界面盖住的像素（数字不顶进顶栏）
 *     onImpact  第一下打中的那一刻：画面换成包里的 state（铭牌的血条跟着掉）；跳过时也照样换
 *     camera    { push(actorId, targetId, secs) 出手时推一下镜头, release(secs) 播完拉回 }（HD2DPlay.camera 给；关掉 / 减少动态效果时不推）
 *     lens()    这一刻的镜头（纸片感按俯角压扁）
 * 正式画面（game.html 的新画面，#283）自己的攻击演出（game.js · playTape）一下一下播，只借这里的三样（hd2d-field.js 转交）：
 *   HD2DPlay.numbers(list, rectOf, view)   弹一批数字（hd2d-fx.js · numberOf 挑好的）：摆位照 placeNumbers，也不压住画面上还没消失的
 *   HD2DPlay.paperHit(rect, lens, { hold })   打中那一下的纸片感（hold = 多少毫秒后画布自己复原，跟着演出倍率）
 *   HD2DPlay.camera(sc, { enabled })      推镜头：{ push, release }（原型页、正式画面同一份；减少动态效果、跳过时不推）
 *   HD2DPlay.shadeIn(el)                  影子那一层挂在哪（正式画面挂进 3D 战场那一层：要压在 3D 画面上、铭牌下面；不给 = body）
 *   HD2DPlay.setClock(fn)   演出倍率（1 正常、0.5 两倍速、0 跳过）：同时交给 AttackFx.setClock；数字、影子停留的时长、推镜头的快慢也跟着它
 *   HD2DPlay.skip()         跳过：正在播的立刻结束（attack-fx / hit-fx 清掉、数字和影子拿掉、镜头直接回去），play 马上返回
 *   HD2DPlay.clear()        数字、影子都拿掉，画布复原
 * 数值（字号、颜色、时长、间隔、压扁、影子、推多少）在 hd2d-fx.js 的 FX。 */
(function (root) {
  "use strict";
  const F = root.HD2DFx;
  let layer = null, shade = null, shadeHost = null, live = [], run = null, flatTimer = 0;
  let clockFn = () => 1;
  const clockScale = () => { const s = Number(clockFn()); return Number.isFinite(s) && s >= 0 ? s : 1; };
  const now = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());

  /** 两层：影子在下面（压在攻击演出底下，地台上），数字在最上面（受击粒子上面）。影子那一层挂在 shadeIn 给的地方（没给 = body） */
  function ensureLayers() {
    if (!layer || !layer.isConnected) {
      layer = document.createElement("div");
      layer.id = "hd2d-pop";
      layer.setAttribute("aria-hidden", "true");
      document.body.appendChild(layer);
    }
    const host = shadeHost && shadeHost.isConnected ? shadeHost : document.body;
    if (!shade || !shade.isConnected || shade.parentNode !== host) {
      if (shade && shade.remove) shade.remove();
      shade = document.createElement("div");
      shade.id = "hd2d-shade";
      shade.setAttribute("aria-hidden", "true");
      host.appendChild(shade);
    }
  }
  /** 放一个会自己消失的元素（跳过时一起拿掉）；box = 数字占的范围（后面弹的数字让开它） */
  function put(host, cls, text, css, life, box) {
    const el = document.createElement("div");
    el.className = cls;
    if (text != null) el.textContent = text;
    el.style.cssText = css;
    host.appendChild(el);
    live.push({ el, box: box || null, until: now() + life });
    setTimeout(() => { el.remove(); live = live.filter(x => x.el !== el); }, life + 60);
    return el;
  }
  /** 画面上还没消失的数字占的范围 */
  const taken = () => { const t = now(); return live.filter(x => x.box && x.until > t && x.el.isConnected).map(x => x.box); };
  /** 弹出一批数字（这一段打中的）：位置已经按 placeNumbers 排好，两两不压住。跳过（倍率 0）时不弹 */
  function showNumbers(list) {
    const s = clockScale();
    if (!list.length || s <= 0) return;
    ensureLayers();
    const N = F.FX.num, life = Math.max(1, (N.dur.pop + N.dur.hold + N.dur.out) * s);
    list.forEach(n => put(layer, "hd2d-num k-" + n.kind, n.text,
      `left:${n.x.toFixed(1)}px;top:${n.y.toFixed(1)}px;font-size:${n.size.toFixed(1)}px;--c:${F.colorOf(n)};--ink:${n.ink.toFixed(1)}px;` +
      `--ink-c:${N.colors.ink};--paper:${N.colors.paper};--tilt:${n.tilt}deg;--rise:${N.rise}px;--life:${life}ms`, life, n.box));
  }
  /** 正式画面一下一下弹：list = [{ unitId, kind, text, el }]（hd2d-fx.js · numberOf），rectOf / view 同 placeNumbers。
   *  也让开画面上还没消失的数字。跳过（倍率 0）时不弹。返回弹出来的（带位置、字号） */
  function numbers(list, rectOf, view) {
    if (!list || !list.length || clockScale() <= 0) return [];
    const placed = F.placeNumbers(list, rectOf, Object.assign({}, view, { taken: taken() }));
    showNumbers(placed);
    return placed;
  }
  /** 纸片感：attack-fx 的画布按俯角压扁（以打中的那一点为中心），脚下地台上一道淡影子 */
  function paper(p) {
    const s = clockScale();
    if (!p || s <= 0) return false;
    const cv = document.querySelector("canvas.atkfx");
    if (cv) { cv.style.transformOrigin = `${p.origin.x.toFixed(1)}px ${p.origin.y.toFixed(1)}px`; cv.style.transform = `scaleY(${p.squash.toFixed(3)})`; }
    ensureLayers();
    const S = p.shadow, life = Math.max(1, F.FX.paper.shadow.dur * s);
    put(shade, "hd2d-shadow", null, `left:${S.x.toFixed(1)}px;top:${S.y.toFixed(1)}px;width:${S.w.toFixed(1)}px;height:${S.h.toFixed(1)}px;--o:${S.opacity};--life:${life}ms`, life);
    return true;
  }
  function unpaper() {
    clearTimeout(flatTimer);
    const cv = document.querySelector("canvas.atkfx");
    if (cv) { cv.style.transform = ""; cv.style.transformOrigin = ""; }
  }
  /** 正式画面：打中那一下的纸片感（rect = 目标铭牌的矩形，lens = 这一刻的镜头输入）。o.hold = 多少毫秒后画布自己复原（跟着演出倍率；
   *  正式画面的演出一下一下播，没有原型那样「播完」的那一刻）；不给 = 不自己复原（原型 play 播完复原） */
  function paperHit(rect, lens, o) {
    if (!rect || !lens) return false;
    const done = paper(F.paperOf(F.lens(lens), rect));
    if (done && o && o.hold > 0) { clearTimeout(flatTimer); flatTimer = setTimeout(unpaper, o.hold * clockScale()); }
    return done;
  }

  /**
   * 出手时镜头稍微推一下（hd2d-fx.js · pushPose：远景 / 中景，攻击者和目标的铭牌推过去也在画面里），播完拉回原来的镜头。
   * sc = 场景（hd2d-scene.js：view / plateOf / poseNow / posePush / poseRelease / motion）；o.enabled() = 页面上的开关（原型的「推镜头」按钮；不给 = 开）。
   * 系统开了「减少动态效果」（sc.motion 为 false）、跳过（倍率 0）时不推。原型页和正式画面用同一份
   */
  function camera(sc, o) {
    o = o || {};
    const L = root.HD2DLayout;
    return {
      push(actorId, targetId, secs) {
        if (!sc || typeof sc.posePush !== "function" || clockScale() <= 0) return false;
        const v = sc.view(), a = sc.plateOf(actorId), b = sc.plateOf(targetId);
        const plates = [a, b].filter(Boolean).map(q => Object.assign({ size: L.plateSize(v, !!q.big) }, q));
        const p = F.pushPose(sc.poseNow(), a, b, { enabled: o.enabled ? !!o.enabled() : true, reduced: !sc.motion, view: v, plates });
        if (!p) return false;
        sc.posePush(p, secs);
        return true;
      },
      release(secs) { if (sc && typeof sc.poseRelease === "function") sc.poseRelease(secs); }
    };
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
  function clear() { live.forEach(x => x.el.remove()); live = []; unpaper(); }
  /** 跳过：正在播的立刻结束 */
  function skip() {
    const r = run;
    if (r) { r.skipped = true; if (r.kick) r.kick(); }
    if (root.AttackFx) AttackFx.skip();
    if (root.HitFx) HitFx.clear();
    clear();
  }

  root.HD2DPlay = {
    play, clear, skip, numbers, paperHit, unpaper, camera,
    get busy() { return !!run; },
    get clock() { return clockScale(); },
    shadeIn(el) { shadeHost = el || null; },
    setClock(fn) { clockFn = typeof fn === "function" ? fn : () => 1; if (root.AttackFx) AttackFx.setClock(clockFn); }
  };
})(typeof window !== "undefined" ? window : globalThis);
