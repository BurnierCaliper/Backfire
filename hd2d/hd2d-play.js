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
 *     sound(kind, i)  该响音效的那一刻（联机玩家，online-sfx.js，#304）：出手 strike、第 i 段打中 wave、格挡 parry、演完 end；跳过、倍率 0 时不叫
 *     cards     3D 白卡的卡片动画（#330，HD2DPlay.cards 给的；正式画面才有）：近身冲过去、远程后坐、支援拉线、协助格挡冲上去挡、受击闪 + 击退、格挡、登场、高能自爆预警
 *     ko        { hold(ids), release() }：被打倒的先留在场上（画面换成包里的 state 之前说好），演完再淡出（hd2d-field.js）
 *     warn(id, on) / quake(力度)   高能自爆预警（卡片 + 脚下的地台一起闪，hd2d-field.js）、震屏
 * 正式画面（game.html 的新画面，#283）自己的攻击演出（game.js · playTape）一下一下播，只借这里的三样（hd2d-field.js 转交）：
 *   HD2DPlay.numbers(list, rectOf, view)   弹一批数字（hd2d-fx.js · numberOf 挑好的）：摆位照 placeNumbers，也不压住画面上还没消失的
 *   HD2DPlay.paperHit(rect, lens, { hold })   打中那一下的纸片感（hold = 多少毫秒后画布自己复原，跟着演出倍率）
 *   HD2DPlay.camera(sc, { enabled })      推镜头：{ push, release }（原型页、正式画面同一份；减少动态效果、跳过时不推）
 *   HD2DPlay.shadeIn(el)                  影子那一层挂在哪（正式画面挂进 3D 战场那一层：要压在 3D 画面上、铭牌下面；不给 = body）
 *   HD2DPlay.cards(host)                  3D 白卡的卡片动画（#330，旧画面单位卡的那一套：冲撞 / 冲一下 / 后坐 / 挪一下 / 受击 + 击退 / 格挡 / 登场 / 高能自爆预警 / 慢动作），
 *                                         单机 game.js（经 hd2d-field.js）和联机玩家的 play 用同一份；跳过、倍率 0、减少动态效果时不演
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
    const ids = [cue.actor, cue.target, cue.blocker].concat(cue.waves.map(w => w.unitId), cue.numbers.map(n => n.unitId)).filter(Boolean);
    ad.remember(ids);                                   // 先记一遍：被打死的结算后就不在画面上了
    const view = opts.view ? opts.view() : { width: innerWidth, height: innerHeight, top: 0 };
    const move = cue.move, cam = opts.camera, P = F.FX.push;
    // 卡片动画（#330）：正式画面给（3D 白卡照旧画面的单位卡动：HD2DPlay.cards）；原型页没有白卡，不给就照以前的样子演
    const C = opts.cards || null, KO = opts.ko || null, warn = opts.warn || (C ? C.warn : null);
    let applied = false, pushed = false;
    // 第一下打中：被打倒的先说好留在场上（#330：这一段演完再淡出），再把画面换成包里的 state
    const impactNow = () => { if (!applied) { applied = true; if (KO && cue.ko.length) KO.hold(cue.ko); if (opts.onImpact) opts.onImpact(); } };
    // 该响音效的那一刻（联机玩家，online-sfx.js，#304）：跟着画面走；跳过、倍率 0 时不响
    const sound = (kind, i) => { if (typeof opts.sound === "function" && !me.skipped && clockScale() > 0) { try { opts.sound(kind, i); } catch (e) { /* 出不了声不影响演出 */ } } };
    const bigAt = (i, id) => cue.numbers.some(n => n.wave === i && n.unitId === id && n.kind === "big" && !n.boom);
    try {
      if (move && cue.actor && cue.target && clockScale() > 0) {
        if (cam && cam.push) pushed = !!cam.push(cue.actor, cue.target, P.in * clockScale());
        // 推到位再出手：attack-fx 的出手 / 弹道在开始那一刻按矩形画（没有 track），镜头停住了，弹道才对得上铭牌
        if (pushed) { await wait(AttackFx.after(P.in * 1000)); if (me.skipped) return cue; }
        const from = ad.rectOf(cue.actor), to = ad.rectOf(cue.target);
        sound("strike");
        const motions = [];
        // 协助格挡的人冲上去挡（game.js · playTape 的 lunge(blockerId, actorId)）
        if (C && cue.blocker && cue.blocker !== cue.actor) motions.push(C.lunge(cue.blocker, cue.actor));
        if (C && (move.kind === "support" || move.kind === "hex")) {
          // 支援 / 挂效果：往后一顿，拉一条线过去（game.js · strikeIn、online-ui.js · strikeOnline）
          if (cue.actor !== cue.target && from && to) { C.recoil(cue.actor, to, F.FX.card.recoil.link); motions.push(AttackFx.link(from, to, move)); }
        } else if (C && move.melee) {
          // 近身：卡片先往后一收再朝目标那张卡扑上去（game.js · dashTo，按屏幕投影的方向）；一闪再横着划一道光
          motions.push(C.dash(cue.actor, to, { heavy: !!move.heavy }));
          if (move.flash && to) AttackFx.area(to, from, move);
        } else {
          if (C && to) C.recoil(cue.actor, to);       // 远程：后坐（game.js · recoil）
          await wait(AttackFx.windup(from, to, move));
          if (me.skipped) return cue;
          if (move.area) AttackFx.area(ad.zoneRectOf(packetZone(packet, cue.target)) || to, from, move);
          else motions.push(AttackFx.travel(ad.rectOf(cue.actor), ad.rectOf(cue.target), move));
        }
        if (motions.length) await wait(Promise.all(motions));
        if (me.skipped) return cue;
      }
      impactNow();
      if (C) cue.enters.forEach(id => C.enter(id));     // 登场支援的伙伴亮个相（画面已经换成包里的 state，卡在了）
      const waves = cue.waves.length ? cue.waves : (cue.target ? [{ unitId: cue.target, el: move ? move.el : "physical" }] : []);
      for (let i = 0; i < waves.length && !me.skipped; i++) {
        const w = waves[i], at = ad.rectOf(w.unitId), from = cue.actor ? ad.rectOf(cue.actor) : null;
        if (at && move) AttackFx.impact(at, move, { n: i, from });
        if (at && opts.lens) paper(F.paperOf(F.lens(opts.lens()), at));
        if (at && root.HitFx && clockScale() > 0) HitFx.burst(w.el || "physical", at, { big: !!(move && move.big) });
        // 卡片闪一下属性色、顺着挨打的方向被打退一下（game.js · hit）
        if (C) C.hit(w.unitId, w.el || "physical", bigAt(i, w.unitId), from && w.unitId !== cue.actor ? from : null);
        sound("wave", i);
        if (i === 0 && cue.parried && at) {
          // 格挡成功：协助格挡的火花在两人连线的中点、自己格挡的在挡下来的人身上（game.js · playTape、online-ui.js · playPacket）；那张卡一闪（.parry）
          const b = C && cue.blocker ? ad.rectOf(cue.blocker) : null, a = cue.actor ? ad.rectOf(cue.actor) : null;
          if (b && a) AttackFx.sparks({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); else AttackFx.clash(at);
          if (C) C.parry(cue.blocker || cue.target);
          sound("parry");
        }
        showNumbers(F.placeNumbers(cue.numbers.filter(n => n.wave === i && !n.boom), ad.rectOf, view));
        if (i < waves.length - 1) await wait(AttackFx.after(F.FX.timing.hitGap));
      }
      if (!waves.length) { sound("wave", 0); showNumbers(F.placeNumbers(cue.numbers.filter(n => !n.boom), ad.rectOf, view)); }
      // 高能自爆（game.js · playTape 的 highboom）：卡片闪两下预警（脚下的地台跟着闪），再炸——震屏、卡片受击、弹「高能自爆」
      for (const id of cue.booms) {
        if (me.skipped) break;
        if (warn && warn(id, true)) {                   // 预警闪了才等（原型页没有白卡、跳过、减少动态效果：不闪也不等）
          await wait(AttackFx.after(F.FX.card.warn.ms + F.FX.card.warn.gap));
          warn(id, false);
        }
        if (me.skipped) break;
        if (typeof opts.quake === "function") opts.quake(1);
        const r = ad.rectOf(id);
        if (r && root.HitFx && clockScale() > 0) HitFx.burst("energy", r, { big: true });
        if (C) C.hit(id, "energy", true, null);
        showNumbers(F.placeNumbers(cue.numbers.filter(n => n.boom && n.unitId === id), ad.rectOf, view));
      }
      if (cue.ko.length && !me.skipped) {
        await wait(AttackFx.after(F.FX.timing.koDelay));
        unpaper();                                      // 击倒的红叉要停一阵：画布先复原，红叉不会画到一半变形
        if (!me.skipped) cue.ko.forEach(id => { const r = ad.rectOf(id); if (r) AttackFx.ko(r, { track: ad.track(id) }); });
      }
      sound("end");                                     // 演完（红叉出来的那一刻）：击倒、失衡、护盾、换区
      if (!me.skipped) await wait(AttackFx.after(F.FX.paper.shadow.dur));
      return cue;
    } finally {
      impactNow();                                      // 跳过也要把画面换成包里的 state
      unpaper();
      if (pushed && cam.release) cam.release(me.skipped ? 0 : P.out * clockScale());
      if (warn) cue.booms.forEach(id => warn(id, false));   // 跳过时高能自爆的预警也撤掉
      if (KO && cue.ko.length) KO.release();            // 这一段演完：留着的被打倒的人开始淡出（跳过了就直接拿掉）
      if (run === me) run = null;
    }
  }
  /* ---------- 卡片动画（#330）：3D 铭牌上的白卡照旧画面的单位卡动 ----------
   * 旧画面（game.js）卡片上的那几样：近身冲撞（dashTo）/ 冲一下（lunge）/ 远程后坐（recoil）/ 专属演出挪一下（nudgeCard）、临时挂的样式（flashClass）、
   * 受击闪一下 + 击退（hit：.hit / .knock）、格挡（.parry）、登场（.enter）、高能自爆预警（.high-warn）、借机攻击的慢动作（.slow-move）。
   * 样式都是旧画面 game.css 的那一份（3D 铭牌里就是 unit-card.js 画的 .unit-wrap）；位移写在白卡的 transform 上——铭牌外面那一层按镜头远近缩放过，
   * 所以屏幕像素按这张卡这一刻的缩放（rect.scale）换回卡片自己的像素，方向按屏幕投影（朝目标那张卡）。冲撞中的铭牌压在别的铭牌上面（FX.card.front）。
   * host = { el(id) 这个单位的 3D 白卡（.unit-wrap；没有 = null）, rect(id) 屏幕矩形（hd2d-fx.js 的适配器：x / y / w / h / left / top / width / height / scale）,
   *          reduced() 减少动态效果 }。跳过（倍率 0）、减少动态效果时一个都不演（返回 false），撤掉的（预警、慢动作结束）照样撤。
   * 单机：hd2d-field.js 建好交给 game.js（HD2DField.cards()）；联机玩家：play 的 opts.cards。数值在 hd2d-fx.js 的 FX.card */
  let dashSeq = 0;
  function cards(host) {
    host = host || {};
    const K = () => F.FX.card;
    const live = () => clockScale() > 0 && !(typeof host.reduced === "function" && host.reduced());
    const el = (id) => (id != null && typeof host.el === "function" ? host.el(String(id)) : null);
    const rect = (id) => (id != null && typeof host.rect === "function" ? host.rect(String(id)) : null);
    const later = (ms) => new Promise(r => setTimeout(r, Math.max(0, ms * clockScale())));
    const ms = (v) => Math.round(Math.max(0, v * clockScale()));
    /** 屏幕像素 → 卡片自己的像素（白卡外面那一层缩放过） */
    const px = (v, s) => (v / (s > 0 ? s : 1)).toFixed(1) + "px";
    const restart = (w, name) => { w.classList.remove(name); void w.offsetWidth; w.classList.add(name); };
    const front = (w, on) => { const p = w.closest ? w.closest(".hd2d-plate") : null; if (p) p.classList.toggle(K().front, !!on); };
    const shove = (w, x, y, rot, s, dur, ease) => {
      w.style.transition = `transform ${ms(dur)}ms ${ease}`;
      w.style.transform = `translate(${px(x, s)}, ${px(y, s)})` + (rot ? ` rotate(${rot.toFixed(1)}deg)` : "");
    };
    /** 这一下动作开始：记个号（回位时号对不上 = 中途被别的动作接管了，就不管） */
    const claim = (w) => { const token = String(++dashSeq); w.dataset.dash = token; w.classList.add("lunge"); front(w, true); return token; };
    /** 出手后回原位（game.js · settleBack） */
    function settle(w, token, hold, back) {
      setTimeout(() => {
        if (w.dataset.dash !== token) return;
        w.style.transition = `transform ${ms(back)}ms cubic-bezier(.3, .8, .3, 1)`;
        w.style.transform = "";
        setTimeout(() => {
          if (w.dataset.dash !== token) return;
          w.classList.remove("lunge"); w.style.transition = ""; delete w.dataset.dash; front(w, false);
        }, ms(back) + 20);
      }, ms(hold));
    }
    return {
      /** 现在演不演（没跳过、没开减少动态效果） */
      live,
      /** 近身冲撞（game.js · dashTo）：先往后一收再扑向 to（屏幕矩形），到了停一下再回位；o = { heavy, reach, speed, hold, keep }。返回的 Promise 在扑到的那一刻结束 */
      async dash(id, to, o) {
        o = o || {};
        const w = el(id), a = rect(id);
        if (!w || !a || !to || !live()) return false;
        const D = K().dash, plan = F.dashOf(a, to, o), k = o.speed || 1, token = claim(w);
        shove(w, plan.back.x, plan.back.y, plan.back.rot, a.scale, D.backMs * k, "cubic-bezier(.2, .7, .3, 1)");
        await later(D.backMs * k);
        if (w.dataset.dash !== token) return true;
        shove(w, plan.hit.x, plan.hit.y, plan.hit.rot, a.scale, D.inMs * k, "cubic-bezier(.55, 0, .9, .55)");
        await later(D.inMs * k);
        settle(w, token, o.hold || (o.keep ? D.keepHold : D.hold), o.keep ? 0 : D.home);
        return true;
      },
      /** 冲一下（game.js · lunge：没挑出招式演出的出手、协助格挡冲上去挡）：朝 targetId 那张卡冲 FX.card.lunge.px 像素再回来 */
      async lunge(id, targetId) {
        const w = el(id), a = rect(id), t = rect(targetId);
        if (!w || !a || !t || !live()) return false;
        const L = K().lunge, v = F.dirOf(a, t), token = claim(w);
        shove(w, v.ux * L.px, v.uy * L.px, 0, a.scale, L.ms, "cubic-bezier(.3, 0, .6, 1)");
        await later(L.ms);
        if (w.dataset.dash !== token) return true;
        w.style.transition = `transform ${ms(L.back)}ms cubic-bezier(.3, 0, .6, 1)`;
        w.style.transform = "";
        await later(L.back);
        if (w.dataset.dash === token) { w.classList.remove("lunge"); w.style.transition = ""; delete w.dataset.dash; front(w, false); }
        return true;
      },
      /** 远程后坐（game.js · recoil）：背着 to 往后一顿再回来；px 不给 = FX.card.recoil.px */
      recoil(id, to, px0) {
        const w = el(id), a = rect(id);
        if (!w || !a || !to || !live()) return false;
        const R = K().recoil, v = F.dirOf(a, to), k = px0 || R.px, token = claim(w);
        shove(w, -v.ux * k, -v.uy * k, 0, a.scale, R.ms, "ease-out");
        settle(w, token, R.hold, R.home);
        return true;
      },
      /** 专属演出里挪一下（game.js · nudgeCard：夕夏处决往后退、维塔斯扯下往后拉）：往 (dx, dy) 屏幕像素挪过去再回来 */
      nudge(id, dx, dy, dur) {
        const w = el(id);
        if (!w || !live()) return false;
        const N = K().nudge, a = rect(id), m = dur || N.ms, token = claim(w);
        shove(w, Number(dx) || 0, Number(dy) || 0, 0, a ? a.scale : 1, m * N.in, "cubic-bezier(.2, .8, .3, 1)");
        settle(w, token, m * N.hold, N.home);
        return true;
      },
      /** 卡片上临时挂一个样式（game.js · flashClass：发抖、被打飞、变回武器消失……，样子在 game.css 的 .unit-wrap.fx-*），dur 毫秒后摘掉 */
      cls(id, name, dur) {
        const w = el(id);
        if (!w || !name || !live()) return false;
        restart(w, name);
        setTimeout(() => w.classList.remove(name), ms(dur || 500) + 40);
        return true;
      },
      /** 受击（game.js · hit）：卡片闪一下属性色（.hit）；from = 打过来的人（{ x, y }）时顺着挨打的方向被打退一下再弹回来（.knock：--kx / --ky / --kr） */
      hit(id, element, big, from) {
        const w = el(id);
        if (!w || !live()) return false;
        const fl = w.querySelector(":scope > .flash");
        if (fl) fl.style.setProperty("--flash", `var(${K().flashVar[element] || K().flashVar.physical})`);
        w.classList.remove("hit", "knock");
        void w.offsetWidth;
        const r = from ? rect(id) : null;
        if (r && from) {
          const kb = F.knockOf(r, from, !!big);
          w.style.setProperty("--kx", px(kb.kx, r.scale));
          w.style.setProperty("--ky", px(kb.ky, r.scale));
          w.style.setProperty("--kr", kb.kr.toFixed(1) + "deg");
          w.classList.add("knock");
        }
        w.classList.add("hit");
        return true;
      },
      /** 格挡成功（game.js · playTape 的 .parry）：挡下来的那张卡一闪金白色火花 */
      parry(id) { const w = el(id); if (!w || !live()) return false; restart(w, "parry"); return true; },
      /** 登场（game.js 伙伴登场的 .enter；新画面里召唤 / 援军刚出现也是它）：卡片从上面落下来亮个相。刚亮过相的不再来一遍 */
      enter(id) {
        const w = el(id);
        if (!w || !live()) return false;
        const t = Date.now(), last = Number(w.dataset.enterAt) || 0;
        if (w.classList.contains("enter") && t - last < K().enter.ms) return true;
        w.dataset.enterAt = String(t);
        restart(w, "enter");
        return true;
      },
      /** 高能自爆预警（game.js 的 .high-warn：卡片闪两下）：on = 开始闪 / 撤掉（撤掉不看跳过） */
      warn(id, on) {
        const w = el(id);
        if (!w) return false;
        if (!on) { w.classList.remove("high-warn"); return true; }
        if (!live()) return false;
        restart(w, "high-warn");
        return true;
      },
      /** 借机攻击的慢动作（game.js 的 .slow-move：被追打的人换区时卡片压暗一点）：on = 开始 / 撤掉（撤掉不看跳过） */
      slow(id, on) {
        const w = el(id);
        if (!w) return false;
        if (!on) { w.classList.remove("slow-move"); return true; }
        if (!live()) return false;
        w.classList.add("slow-move");
        return true;
      }
    };
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
    play, clear, skip, numbers, paperHit, unpaper, camera, cards,
    get busy() { return !!run; },
    get clock() { return clockScale(); },
    shadeIn(el) { shadeHost = el || null; },
    setClock(fn) { clockFn = typeof fn === "function" ? fn : () => 1; if (root.AttackFx) AttackFx.setClock(clockFn); }
  };
})(typeof window !== "undefined" ? window : globalThis);
