/* 联机玩家的音效（#304）：
 *
 * 一、播收到的包时，和单机 / 房主那边（game.js · playTape）响一样的音效。声音只从收到的包推出来（online-view.js 投影过的 tape / fx / state），
 *    不读房主的 state：打中按属性响（Sfx.play；重击 big 只在投影给了数、按 bigHitInfo 是大伤害时才算）、失衡 Sfx.stagger、击倒 / 濒死 Sfx.ui("ko")、
 *    治疗 heal、护盾变多 shield、状态字（护盾 / 增益类 shield，减益 debuff）、换区脚步 move、开枪 gun、近战同区出手的破风声 swing、
 *    格挡成功 / 伙伴登场 Sfx.parry、高能自爆 / 自爆小车死亡引爆 Sfx.boom。
 *    坚毅生命：投影里打在坚毅生命上、濒死的那几下不给数——照样响普通的打中声（和画面上只演打中、不弹数字一致），
 *    不另给一种声音，也不按藏起来的数字变重击。
 *    两条画面用同一份：旧画面（online-ui.js · playPacket）一下一下播时叫 pop，新画面（hd2d/hd2d-play.js）每一段打中时叫 wave。
 *      const s = OnlineSfx.start(packet, { before, bigHit, live })
 *        before   出招前画面上的那一份 state（比一比谁失衡、被击倒、濒死、护盾变多、换了区）
 *        bigHit   规则的 bigHitInfo（大伤害），live() 现在还能不能响（被新的包顶掉、跳过、演出倍率 0 = 不响）
 *      s.strike() 出手的那一刻        s.parry() 格挡火花那一刻
 *      s.pop(e)   旧画面：演出带里的一下（带着快照的顺便比一比击倒 / 濒死 / 护盾 / 换区；失衡等整串放完再响，和单机一样）
 *      s.wave(i)  新画面：第 i 段打中（hd2d-fx.js · cues 同一个分段，这一段的几下一起响）
 *      s.blast(i) 新画面：第 i 辆自爆小车炸开（cues 的 blasts：爆炸声 + 炸到的那几下）
 *      s.end()    演完：最后的画面（包里的 state）和之前比——失衡、击倒、濒死、护盾、换区（已经响过的不再响）
 *    音效关着时一个 Sfx 接口都不调；跳过 / 被顶掉以后不再响。
 *
 * 二、轮到你：轮到这名玩家操作自己的角色、行动开始的那一刻响一次 DJ 搓碟（sfx.js · Sfx.scratch）。
 *      const w = OnlineSfx.turnWatch({ doc })
 *      w.see(info)   每次画面更新叫一次：info = { active, isHost, screen, phase, current, turnNo, mine, room }（turnNo 是包里 state 的回合数）。
 *                    是新的一次轮到自己 → 响、返回 true
 *      w.prime()     重新同步、断线重连：下一次看到的只记下、不响
 *    同一次轮到只响一次（房间 + 第几回合 + 哪个角色 记下来）；页面刚打开、重新同步、断线重连、重播旧包都不重复响；别人的回合不响；音效关着不响。
 *    页面在后台（别的标签页）也照样响；标签页标题前加「▶ 轮到你」，回到页面（或者已经不是自己的回合）时去掉。
 * 数值、文字在 ONLINE_SFX。不碰 DOM 以外的东西：Node 里 require 来测（tests/online-sfx.test.js），浏览器里是全局的 OnlineSfx。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.OnlineSfx = factory(root);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";
  const ONLINE_SFX = {
    // 状态字的声音（和 game.js 播状态字时同一个判断）：护盾 / 增益类响 shield；打不动 / 触发类不响；其余（减益、挂上效果）响 debuff
    status: { shield: /振奋|坚固|坚挺|优势|躲藏|护盾|铁壁|免疫/, none: /无效|打不动|触发|落空/ },
    // 按「开枪」演的招式（没有专属演出时）：出手响枪声
    gun: ["shot", "spread"],
    // 高能自爆：爆炸声 + 一记能量重击（和 game.js 一样）
    boom: { element: "energy", big: true },
    // 比一比前后两份画面得出的大事件 → 音效（和 game.js · playBeats 一样）
    beats: { stun: ["stagger"], kill: ["ui", "ko"], down: ["ui", "ko"], shield: ["ui", "shield"], move: ["ui", "move"] },
    // 轮到你：标签页标题前加的标记；记住几次轮到（同一次只响一次）
    turn: { title: "▶ 轮到你 · ", keep: 64 }
  };
  const ELEMENTS = ["physical", "fire", "ice", "electric", "acid", "energy", "harmonic"];
  const elOf = (e) => (ELEMENTS.includes(e) ? e : "physical");
  const unitsOf = (s) => new Map((s && Array.isArray(s.units) ? s.units : []).filter(u => u && u.id != null).map(u => [String(u.id), u]));
  const shieldOf = (u) => (u && Array.isArray(u.layers) ? u.layers : []).filter(l => l && l.type === "shield").reduce((a, l) => a + (Number(l.current != null ? l.current : l.cur) || 0), 0);

  /** 音效关着 / 没有 Sfx：一个接口都不调 */
  function fire(calls) {
    const S = root.Sfx;
    if (!calls.length || !S || typeof S.enabled !== "function" || !S.enabled()) return 0;
    let n = 0;
    calls.forEach(([fn, ...args]) => { if (typeof S[fn] === "function") { try { S[fn](...args); n++; } catch (e) { /* 出不了声不影响演出 */ } } });
    return n;
  }
  /** 两份单位比一比（和 game.js · setView 的大事件一样）：[{ kind, id }] */
  function changes(prev, next) {
    const out = [];
    next.forEach((s, id) => {
      const p = prev.get(id);
      if (!p || !s || s.isGap) return;
      if (!p.stunned && s.stunned && !s.dead) out.push({ kind: "stun", id });
      if (!p.dead && s.dead) out.push({ kind: "kill", id });
      if (!p.dying && s.dying && !s.dead) out.push({ kind: "down", id });
      if (shieldOf(s) > shieldOf(p)) out.push({ kind: "shield", id });
      if (!s.isProp && !s.dead && !s.hidden && p.zone != null && s.zone != null && Number(p.zone) !== Number(s.zone)) out.push({ kind: "move", id });
    });
    return out;
  }
  /** 演出带里的一下要响什么：[[Sfx 的接口, 参数…]] */
  function popCalls(e, o) {
    if (!e || e.type !== "pop") return [];
    const C = ONLINE_SFX, v = typeof e.value === "number" && isFinite(e.value) ? e.value : null;
    if (e.kind === "dmg") {
      if (v !== null && v <= 0) return [];       // 给了数、打出 0：和单机一样不响
      // 没给数（打在坚毅生命上、濒死）：照样是普通的打中声，不算重击
      const big = v !== null && !!(o.bigHit && (o.bigHit(o.level(e.unitId), v) || {}).big);
      return [["play", elOf(e.element), { big }]];
    }
    if (e.kind === "heal") return v !== null && v <= 0 ? [] : [["ui", "heal"]];
    if (e.kind === "highboom") return [["boom"], ["play", C.boom.element, { big: C.boom.big }]];
    if (e.kind === "carboom") return [["boom"]];   // 自爆小车死亡引爆：爆炸声（炸到的人各自的打中声在后面那几下里）
    if (e.kind === "partner") return [["parry"]];
    if (e.kind === "status" && typeof e.text === "string" && e.text) {
      const k = C.status.shield.test(e.text) ? "shield" : C.status.none.test(e.text) ? "" : "debuff";
      return k ? [["ui", k]] : [];
    }
    return [];
  }
  /** 出手的那一刻：开枪的招式响枪声；近战冲上去打同一区的人响破风声（和 game.js 一样） */
  function strikeCalls(packet) {
    const fx = packet && packet.fx, m = fx && fx.move;
    if (!m) return [];
    if (!fx.script && ONLINE_SFX.gun.includes(m.kind)) return [["ui", "gun"]];
    if (m.melee && fx.actor !== fx.target) {
      const u = unitsOf(packet.state), a = u.get(String(fx.actor)), t = u.get(String(fx.target));
      if (a && t && Number(a.zone) === Number(t.zone)) return [["ui", "swing"]];
    }
    return [];
  }

  function start(packet, o) {
    o = o || {};
    const tape = (packet && Array.isArray(packet.tape) ? packet.tape : []).filter(e => e && e.type === "pop" && e.unitId);
    const after = unitsOf(packet && packet.state), last = unitsOf(o.before);
    const ctx = { bigHit: typeof o.bigHit === "function" ? o.bigHit : null, level: (id) => { const u = after.get(String(id)) || last.get(String(id)); return u ? u.level : undefined; } };
    const live = () => { try { return typeof o.live === "function" ? !!o.live() : true; } catch (e) { return false; } };
    // 新画面的分段：和 hd2d-fx.js · cues 一样——主攻击的每一下（或者第一下伤害）开一段，后面的几下算进这一段；
    // 自爆小车的死亡引爆（carboom）和紧跟着它炸到的那几下（tag "boom"）另成一组，等小车炸开的那一刻再响（blast）
    const waves = [], blasts = [];
    let w = -1, b = -1;
    tape.forEach(e => {
      if (e.kind === "carboom") b = blasts.push([]) - 1;
      else if (e.tag !== "boom") b = -1;
      if (b >= 0) { blasts[b].push(e); return; }
      if (e.kind === "dmg" && (e.main || w < 0)) w++;
      const i = Math.max(0, w); (waves[i] = waves[i] || []).push(e);
    });
    const stuns = new Set();
    let done = false;
    const play = (calls) => (done || !live() ? 0 : fire(calls));
    /** 比一比、记下来；失衡先攒着（整串放完再响，和单机一样） */
    function diff(next) {
      const calls = [];
      changes(last, next).forEach(b => { if (b.kind === "stun") stuns.add(b.id); else calls.push(ONLINE_SFX.beats[b.kind]); });
      next.forEach((u, id) => last.set(id, u));
      return calls;
    }
    return {
      strike: () => play(strikeCalls(packet)),
      parry: () => play(packet && packet.fx && packet.fx.parried ? [["parry"]] : []),
      pop(e) {
        if (done || !e) return 0;
        const calls = popCalls(e, ctx);
        if (Array.isArray(e.snap)) calls.push(...diff(unitsOf({ units: e.snap })));
        return play(calls);
      },
      wave: (i) => play([].concat(...(waves[i] || []).map(e => popCalls(e, ctx)))),
      blast: (i) => play([].concat(...(blasts[i] || []).map(e => popCalls(e, ctx)))),
      end() {
        if (done) return 0;
        const calls = diff(after);
        const stun = [...stuns].some(id => { const u = after.get(id) || last.get(id); return u && u.stunned && !u.dead; });
        if (stun) calls.unshift(ONLINE_SFX.beats.stun);
        const n = play(calls);
        done = true;
        return n;
      },
      cancel() { done = true; },
      get waves() { return waves.length; }
    };
  }

  /* ---------- 轮到你：DJ 搓碟 ---------- */
  /** 这一刻是不是轮到这名玩家操作自己的角色：是就给出「这一次轮到」的记号（房间 + 第几回合 + 哪个角色），不是 = null */
  function turnKey(info) {
    if (!info || !info.active || info.isHost || info.screen !== "battle" || info.phase !== "acting" || info.current == null) return null;
    const mine = Array.isArray(info.mine) ? info.mine.map(String) : [];
    if (!mine.includes(String(info.current))) return null;
    return [info.room || "", info.turnNo == null ? "" : info.turnNo, info.current].join("|");
  }
  function turnWatch(o) {
    o = o || {};
    const T = ONLINE_SFX.turn, seen = [];
    let primed = false, marked = false, unbind = null;
    const doc = () => o.doc || (typeof document !== "undefined" ? document : null);
    const hidden = (d) => !!(d && (d.hidden || d.visibilityState === "hidden"));
    function unmark() {
      const d = doc();
      if (marked && d && typeof d.title === "string" && d.title.indexOf(T.title) === 0) d.title = d.title.slice(T.title.length);
      marked = false;
      if (unbind) { unbind(); unbind = null; }
    }
    /** 页面在后台：标签页标题前加「▶ 轮到你」，回到页面时去掉 */
    function mark() {
      const d = doc();
      if (!d || marked || !hidden(d) || typeof d.title !== "string") return;
      d.title = T.title + d.title; marked = true;
      const back = () => { if (!hidden(d)) unmark(); };
      if (typeof d.addEventListener === "function") { d.addEventListener("visibilitychange", back); unbind = () => d.removeEventListener("visibilitychange", back); }
    }
    const remember = (k) => { seen.push(k); while (seen.length > T.keep) seen.shift(); };
    return {
      see(info) {
        const k = turnKey(info);
        if (!k && marked) unmark();             // 已经不是自己的回合：标记去掉
        if (!info || !info.active || info.screen !== "battle") seen.length = 0;   // 离开战斗 / 房间：下一场的回合数从头算，记过的不再算数
        if (!primed) { primed = true; if (k) remember(k); return false; }   // 页面刚打开 / 重新同步以后第一次看到的：只记下
        if (!k || seen.includes(k)) return false;
        remember(k);
        mark();
        const S = root.Sfx;
        if (S && typeof S.enabled === "function" && S.enabled() && typeof S.scratch === "function") { try { S.scratch(); } catch (e) { /* 出不了声就算了 */ } }
        return true;
      },
      prime() { primed = false; },
      unmark,
      get marked() { return marked; }
    };
  }

  return { CONFIG: ONLINE_SFX, start, popCalls, strikeCalls, changes, turnKey, turnWatch };
});
