/* Antlerscale: Backfire · HD-2D 战场原型 · 按联机玩家收到的包播攻击演出（浏览器）
 *
 * 只拿投影过的包（OnlineView.projectPacket：state / tape / fx），不读房主的原始 state。
 * 画法全用现成的 2D 演出：attack-fx.js 的出手 windup → 弹道 travel → 打中 impact（刀光、冲击星……）、hit-fx.js 的受击粒子 HitFx.burst、
 * 击倒的红叉 ko、格挡 clash；位置问适配器（hd2d-fx.js · adapter：3D 铭牌投影到屏幕上的矩形）。伤害数字是这里的纸片风 DOM（粗墨线 + 属性色）。
 *
 *   await HD2DPlay.play(packet, ad, { before, bigHit, view, onImpact })
 *     ad        适配器（rectOf / zoneRectOf / track / remember）
 *     before    出招前画面用的那一份（上一个包的 state；比一比谁被击倒）
 *     bigHit    规则的 bigHitInfo（大伤害的数字加 !! 放大）
 *     view()    画面大小和上下被界面盖住的像素（数字不顶进顶栏）
 *     onImpact  第一下打中的那一刻：画面换成包里的 state（铭牌的血条跟着掉）
 * 数值（字号、颜色、时长、间隔）在 hd2d-fx.js 的 FX；演出速度跟着 AttackFx.setClock（等待都走 AttackFx.after）。 */
(function (root) {
  "use strict";
  const F = root.HD2DFx;
  let layer = null;

  /** 数字层：铺满整个窗口、不挡鼠标，压在受击粒子上面 */
  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement("div");
    layer.id = "hd2d-pop";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
    return layer;
  }
  /** 弹出一批数字（这一段打中的）：位置已经按 placeNumbers 排好，两两不压住 */
  function showNumbers(list) {
    if (!list.length) return;
    const host = ensureLayer(), N = F.FX.num;
    const life = (N.dur.pop + N.dur.hold + N.dur.out) * clockScale();
    list.forEach(n => {
      const el = document.createElement("div");
      el.className = "hd2d-num k-" + n.kind;
      el.textContent = n.text;
      el.style.left = n.x.toFixed(1) + "px";
      el.style.top = n.y.toFixed(1) + "px";
      el.style.fontSize = n.size.toFixed(1) + "px";
      el.style.setProperty("--c", F.colorOf(n));
      el.style.setProperty("--ink", n.ink.toFixed(1) + "px");
      el.style.setProperty("--ink-c", N.colors.ink);
      el.style.setProperty("--paper", N.colors.paper);
      el.style.setProperty("--tilt", n.tilt + "deg");
      el.style.setProperty("--rise", N.rise + "px");
      el.style.setProperty("--life", Math.max(1, life) + "ms");
      host.appendChild(el);
      setTimeout(() => el.remove(), life + 60);
    });
  }
  /** 数字停留的倍率（1 正常；第二步和 AttackFx.setClock 接上） */
  let clockFn = () => 1;
  function clockScale() { const s = Number(clockFn()); return Number.isFinite(s) && s >= 0 ? s : 1; }

  /**
   * 播一个包。返回的 Promise 在最后一段数字弹出来以后结束（数字自己淡出）。
   * 只读 packet（投影过的），位置全问适配器
   */
  async function play(packet, ad, opts) {
    opts = opts || {};
    const cue = F.cues(packet, { before: opts.before, bigHit: opts.bigHit });
    const ids = [cue.actor, cue.target].concat(cue.waves.map(w => w.unitId), cue.numbers.map(n => n.unitId)).filter(Boolean);
    ad.remember(ids);                                   // 先记一遍：被打死的结算后就不在画面上了
    const view = opts.view ? opts.view() : { width: innerWidth, height: innerHeight, top: 0 };
    const move = cue.move;
    let applied = false;
    const impactNow = () => { if (!applied) { applied = true; if (opts.onImpact) opts.onImpact(); } };
    if (move && cue.actor && cue.target) {
      const from = ad.rectOf(cue.actor), to = ad.rectOf(cue.target);
      await AttackFx.windup(from, to, move);
      if (move.area) AttackFx.area(ad.zoneRectOf(packetZone(packet, cue.target)) || to, from, move);
      else await AttackFx.travel(from, to, move);
    }
    impactNow();
    const waves = cue.waves.length ? cue.waves : (cue.target ? [{ unitId: cue.target, el: move ? move.el : "physical" }] : []);
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i], at = ad.rectOf(w.unitId), from = cue.actor ? ad.rectOf(cue.actor) : null;
      if (at && move) AttackFx.impact(at, move, { n: i, from });
      if (at && root.HitFx) HitFx.burst(w.el || "physical", at, { big: !!(move && move.big) });
      if (i === 0 && cue.parried && at) AttackFx.clash(at);
      showNumbers(F.placeNumbers(cue.numbers.filter(n => n.wave === i), ad.rectOf, view));
      if (i < waves.length - 1) await AttackFx.after(F.FX.timing.hitGap);
    }
    if (!waves.length) showNumbers(F.placeNumbers(cue.numbers, ad.rectOf, view));
    if (cue.ko.length) {
      await AttackFx.after(F.FX.timing.koDelay);
      cue.ko.forEach(id => { const r = ad.rectOf(id); if (r) AttackFx.ko(r, { track: ad.track(id) }); });
    }
    return cue;
  }
  /** 目标所在的区（范围攻击画在整块地台上）：只看包里的 state */
  function packetZone(packet, id) {
    const u = packet && packet.state && (packet.state.units || []).find(x => x.id === id);
    return u ? Number(u.zone) : null;
  }
  function clear() { if (layer) layer.textContent = ""; }

  root.HD2DPlay = { play, clear, setClock(fn) { clockFn = typeof fn === "function" ? fn : () => 1; } };
})(typeof window !== "undefined" ? window : globalThis);
