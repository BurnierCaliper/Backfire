/* Antlerscale: Backfire · 攻击演出：出手 → 弹道 → 打中的那一下（刀光、冲击星、爪痕、弹道、电弧……）
 *
 * 全部用代码画在一块全屏 canvas 上（不挡点击），压在伤害数字下面、单位卡上面；受击粒子还是 hit-fx.js。
 * 画法照美术定稿的贴纸图标（art/style-guide.html）：先一层粗墨线，上面属性色，中间一道白芯，
 * 再带一点喷漆飞溅。战场是浅色的，墨线让刀光、弹道在白底上也看得清，和图标、按钮是一套语言。
 *
 *   AttackFx.resolve(info)               → 招式（纯函数，不碰网页；Node 里也能跑，测试用）
 *   AttackFx.windup(from, to, move)      → Promise  出手前那一下：枪口火光 / 蓄能 / 喷漆准星
 *   AttackFx.travel(from, to, move, o)   → Promise  弹道飞到目标（近战、范围技能立刻结束）
 *   AttackFx.impact(at, move, o)                    打中的那一下（o.n：第几段，刀光左右交替；o.from：从哪边来）
 *   AttackFx.area(rect, from, move)                 整区的范围攻击（冲击波、一闪）
 *   AttackFx.ko(rect)                               敌人被击倒：红色喷漆叉
 *   AttackFx.aim(from, to, o) / clearAim()          选目标时的瞄准线：全息青色虚线 + 准星（o.ally：友方用薄荷绿）
 *   AttackFx.threat(from, to) / clearThreat()       敌人这一击指向谁（协助格挡时）：红色虚线
 *   AttackFx.clash(at)                              格挡成功：兵刃相交的一下
 *   AttackFx.setClock(fn) · skip()                  时间倍率（演出 2× → 0.5；跳过 → 0）· 清掉正在播的
 * from / to / at / rect：{ x, y, w, h }，中心点和大小，视口坐标。
 * 系统「减少动态效果」时：不飞弹道、不震，只留很短的一闪。 */
(function (root) {
  "use strict";

  /* ================= 1. 招式：按技能 / 敌人招式名 / 属性 / 距离挑一种演出 ================= */
  const ELEMENTS = ["fire", "acid", "electric", "ice", "energy", "physical", "harmonic"];
  // 招式种类：melee 贴身（攻击者冲过去，打中的形状画在目标上）；shot 有弹道（从攻击者飞到目标）；area 整区
  const KIND = {
    slash: "melee", thrust: "melee", smash: "melee", claw: "melee", bite: "melee",
    shot: "shot", spread: "shot", bolt: "shot", beam: "shot", zap: "shot", shard: "shot", lob: "shot", flame: "shot", wave: "shot",
    explode: "area", support: "buff", hex: "hex", none: "none"
  };

  // 我方技能（按技能 id）。auto:xxx 要看现场（龙哥手杖 / 霰弹枪、柯尔特酸液炮 / 电钻、结人打敌人还是奶队友）
  const SKILL = [
    [/^ruby_aa$/, "bolt"],
    [/^(ruby|wing)_surge$/, "zap"],
    [/^ruby_(trigger|short|algo)$/, "hex", { glitch: true }],
    [/^wing_aa$/, "bolt", { heavy: true }],
    [/^(wing|mint)_steal$|^mint_banish$/, "zap"],
    [/^mint_repair$/, "support"],
    [/^yuito_aa$/, "shard"],
    [/^yuito_(amer|cold)$/, "auto:yuito-ice"],
    [/^yuito_espresso$/, "auto:yuito-acid"],
    [/^yuito_extract$/, "lob"],
    [/^yuito_duet$/, "support"],
    [/^latte_puff$/, "lob", { fur: true }],
    [/^latte_claw$/, "claw"],
    [/^latte_love$/, "support"],
    [/^hiaki_flash$/, "slash", { blade: "katana", flash: true }],
    [/^hiaki_barrage$/, "slash", { blade: "katana", flurry: true }],
    [/^(hiaki_aa|hiaki_assist|hiaki_powder|niu_slash|niu_tsubame|naruto_wind|naruto_fly|naruto_frost)$/, "slash", { blade: "katana" }],
    [/^hiaki_pot$/, "hex"],
    [/^tou_aa$|^tou_assist$/, "smash", { shield: true }],
    [/^tou_bash$/, "smash", { shield: true, heavy: true }],
    [/^tou_(sonic|accuse)$/, "wave"],
    [/^tou_(ultra|start)$/, "hex"],
    [/^mochi_(pounce|bite)$/, "bite"],
    [/^mochi_(roar|boom)$/, "wave", { roar: true }],
    [/^xia_(aa|assist)$/, "smash", { heavy: true }],
    [/^xia_crush$/, "smash", { heavy: true }],
    [/^xia_execute$/, "thrust", { heavy: true }],
    [/^xia_ram$/, "smash", { heavy: true }],
    [/^berniel_spit$/, "flame", { stream: true }],
    [/^berniel_(flare|dash)$/, "flame"],
    [/^berniel_ignite$/, "hex"],
    [/^chuan_(aa|whip|assist)$/, "zap"],
    [/^chuan_blade$/, "slash", { heavy: true }],
    [/^chuan_(wall|over|reclaim|cover)$/, "support"],
    [/^bili_(beam|storm)$/, "zap"],
    [/^bili_magnet$/, "wave"],
    [/^bili_field$/, "support"],
    [/^nora_aa$|^nora_assist$/, "thrust", { needle: true }],
    [/^nora_needle$/, "shard", { needle: true }],
    [/^nora_sonic$/, "wave"],
    [/^nora_(indwell|pressure)$/, "hex"],
    [/^vitas_infuse$/, "thrust", { needle: true }],
    [/^vitas_(rip|slash|dance)$/, "slash", { blade: "rapier" }],
    [/^kolt_(aa|assist)$/, "auto:kolt"],
    [/^kolt_(cannon|rot)$/, "lob"],
    [/^kolt_(mod|short|chase)$/, "hex"],
    [/^torque_(swap|strip)$/, "slash", { heavy: true }],
    [/^helu_(aa|assist)$/, "wave"],
    [/^ecmo_bite$/, "bite"],
    [/^ecmo_boom$/, "wave"],
    [/^ecmo_focus$/, "hex"],
    [/^ras_(aa|flee|torrent|assist)$/, "bolt"],
    [/^ras_dump$/, "hex", { glitch: true }],
    [/^edc_(shock|flash)$/, "zap"],
    [/^longge_(aa|chill|assist)$/, "auto:longge"],
    [/^longge_spit$/, "lob"],
    [/^longge_shuffle$/, "spread"],
    [/^xiaoxiao_(punch|combo)$/, "smash", { fist: true }],
    [/^xiaoxiao_(heal|burst)$/, "support"],
    [/^bare_aa$/, "smash", { fist: true }],
    [/^use_scrap:/, "spread"],
    [/^hack_turret:/, "hex", { glitch: true }],
    [/^(\w+_summon|\w+_return|ruby_unmecha|mint_mecha|xia_engine|xia_selfburn|hiaki_sheath|nora_soothe|latte_ice|helu_(wave|storm|scan)|ecmo_probe|ras_(super|rampage)|edc_(drain|siphon)|longge_(safety|drink|reload)|chuan_pulse|torque_divert|kolt_scrap|wing_boost|wing_relay|ruby_relay|ruby_refuel|weapon_retrieve|sand_pull|__move|__item|__stand)$/, "none"]
  ];

  // 敌人招式：按招式名（和 id、种类）里的字挑。顺序有讲究：「电击挥砍」是刀、「枪管近战」是砸
  const WORDS = [
    [/霰弹|散弹|chi_shot/, "spread"],
    [/枪管近战|砸枪|枪托/, "smash"],
    [/射线|激光|光束|_beam/, "beam"],
    [/机枪|点射|子弹|射击|火枪|狙击|枪|_gun_far|_shot\b/, "shot"],
    [/匕首|刀|剑|挥砍|斩|劈|砍|knife|sword|slash/, "slash"],
    [/撕咬|扑咬|腾咬|乱咬|猛咬|叮咬|咬|bite/, "bite"],
    [/爪|claw|_wolf\b/, "claw"],
    [/穿刺|刺|针|pierce/, "thrust"],
    [/榴弹|酸弹|沙弹|火石|酸液弹|废液|倾倒|吐|_gl\b|_dump|_flint/, "lob"],
    [/喷火|喷枪|喷洒|_spray/, "flame"],
    [/电弧|电涌|电击|_zap|_arc/, "zap"],
    [/声波|谐波|吼|啸|弦振|sonic|crow\b/, "wave"],
    [/自爆|引爆|爆炸|boom/, "explode"],
    [/锤|砸|撞|冲撞|踩踏|磨蚀|卷扬|甩尾|拳|沙击|hammer|_ox\b|_ram|tail|grind/, "smash"],
    [/治疗|修复|回满护盾/, "support"]
  ];
  // 都对不上时按属性挑弹道 / 近身形状
  const RANGED_BY_EL = { physical: "shot", energy: "bolt", electric: "zap", fire: "flame", ice: "shard", acid: "lob", harmonic: "wave" };
  const MELEE_BY_EL = { physical: "smash", energy: "slash", electric: "slash", fire: "slash", ice: "slash", acid: "claw", harmonic: "slash" };

  /**
   * info: { kit, skillId, skillName, isPlayer, element, dist（攻击者到目标隔几个区；同区 0），
   *         dmg（打出了伤害）, ally（目标是友方 / 自己）, targets（打到几个不同的目标）, hits（主攻击有几段）,
   *         mode（龙哥：gun / cane）, big（重击）, range（单位的射程：melee / ranged / any） }
   * 返回 { kind, el, melee, ...变体 }，kind 为 none 时不播攻击演出（只照旧受击）
   */
  function resolve(info) {
    info = info || {};
    const el = ELEMENTS.includes(info.element) ? info.element : "physical";
    const dist = Math.max(0, Number(info.dist) || 0);
    const sid = String(info.skillId || "");
    let kind = null, extra = {};
    if (sid) {
      // 敌人的招式 id 都以 en_ 开头，对不上这张表；碎渣机炮（use_scrap:）这类两边都能用的照样认
      for (const [re, k, x] of SKILL) if (re.test(sid)) { kind = k; extra = Object.assign({}, x || {}); break; }
      if (kind === "auto:longge") kind = info.mode === "gun" ? "spread" : "smash", extra = info.mode === "gun" ? {} : { cane: true };
      else if (kind === "auto:kolt") kind = el === "acid" ? "lob" : "smash", extra = el === "acid" ? {} : { drill: true };
      else if (kind === "auto:yuito-ice") kind = info.ally ? "support" : (info.targets > 1 ? "wave" : "shard");
      else if (kind === "auto:yuito-acid") kind = info.ally ? "support" : "lob";
    }
    if (!kind && info.isPlayer === false) {
      const words = `${info.skillName || ""} ${sid} ${info.kit || ""}`;
      for (const [re, k] of WORDS) if (re.test(words)) { kind = k; break; }
      if (kind === "slash" && /匕首|knife/.test(words)) extra.blade = "knife";
      if (kind === "smash" && /锤|hammer|砸击/.test(words)) extra.heavy = true;
      if (kind === "smash" && /甩尾|tail/.test(words)) extra.sweep = true;
      if (kind === "flame" && /喷/.test(words)) extra.stream = true;
    }
    // 没打出伤害：我方打友方是支援，打敌人（真的挂上了效果）是挂效果；敌人不打伤害的（召唤、下命令、
    // 等协助格挡的那一下）不演——要格挡的那一击等结算出来再演
    if (!info.dmg) {
      if (kind === "none" || info.isPlayer === false) return { kind: "none", el, melee: false };
      if (info.ally) return Object.assign({ kind: "support", el, melee: false }, /护盾|盾|壁/.test(info.skillName || "") || kind === "support" && /wall|field|cover/.test(sid) ? { shield: true } : {});
      if (kind !== "hex" && !info.touched) return { kind: "none", el, melee: false };
      return Object.assign({ kind: "hex", el, melee: false }, kind === "hex" ? extra : {});
    }
    if (kind === "none" || kind === "support" || kind === "hex") kind = null;
    if (!kind) kind = dist > 0 || info.range === "ranged" ? RANGED_BY_EL[el] : MELEE_BY_EL[el];
    // 贴身的招式打到隔壁区也照样冲过去（手杖、盾击能打邻区）；弹道的招式同区也照样飞（距离短一点）
    const move = Object.assign({ kind, el, melee: KIND[kind] === "melee" }, extra);
    if (info.targets > 1 && (kind === "wave" || kind === "explode")) move.area = true;
    if (info.big) move.big = true;
    move.hits = Math.max(1, Number(info.hits) || 1);
    return move;
  }

  /* ================= 2. 画布 ================= */
  const INK = "#0b0806";
  const COL = { fire: "#ff5b2e", acid: "#9be03a", electric: "#ffd32e", ice: "#7ccfe8", energy: "#35e0c0", physical: "#ff9a3c", harmonic: "#c07cf0" };
  const HOT = { fire: "#fff0b8", acid: "#f4ffd9", electric: "#ffffff", ice: "#ffffff", energy: "#eafffa", physical: "#fff4dc", harmonic: "#faf0ff" };
  const DEEP = { fire: "#c2351a", acid: "#4f8f1c", electric: "#d39a12", ice: "#3a8bbd", energy: "#13a08a", physical: "#c2621c", harmonic: "#7d45b3" };
  const MINT = "#39e6b4", PINK = "#ff4fa3", HOLO = "#3fe0ff", BLOOD = "#d8322a";
  const TAU = Math.PI * 2;

  const hasDom = typeof document !== "undefined";
  let canvas = null, ctx = null, dpr = 1, raf = 0;
  let list = [];               // 正在播的效果
  let aimFx = null, threatFx = null;
  let clock = () => 1;         // 时间倍率：1 正常、0.5 两倍速、0 跳过
  const reduced = () => !!(hasDom && root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const now = () => (root.performance && performance.now ? performance.now() : Date.now());
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (k) => k < 0 ? 0 : k > 1 ? 1 : k;
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = {
    out: (k) => 1 - Math.pow(1 - k, 3),
    in: (k) => k * k * k,
    inOut: (k) => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2,
    back: (k) => { const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); }
  };

  function ensure() {
    if (!hasDom || !document.body) return false;
    if (canvas && canvas.isConnected) return true;
    canvas = document.createElement("canvas");
    canvas.id = "atk-fx";
    canvas.className = "ol-ui atkfx";   // ol-ui：联机玩家画面只显示 ol-ui 元素，这里也要能看到
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:29";
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    resize();
    root.addEventListener("resize", resize);
    return !!ctx;
  }
  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, root.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
  }
  const scale = () => { const s = Number(clock()); return isFinite(s) && s >= 0 ? s : 1; };
  /** 等 ms 毫秒（跟着演出倍率；跳过时立刻返回） */
  function after(ms) {
    const s = scale();
    if (!hasDom || s <= 0 || ms <= 0) return Promise.resolve();
    return new Promise(r => setTimeout(r, ms * s));
  }
  /** 加一个效果：draw(k, e) 每帧调用，k 从 0 到 1；dur / delay 毫秒 */
  function add(e) {
    const s = scale();
    if (!ensure() || (s <= 0 && !e.persist)) return null;
    e.t0 = now() + (e.delay || 0) * s;
    e.len = Math.max(16, (e.dur || 300) * (e.persist ? 1 : s));
    list.push(e);
    if (!raf) raf = requestAnimationFrame(frame);
    return e;
  }
  function frame(t) {
    raf = 0;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const keep = [];
    for (const e of list) {
      const k = (t - e.t0) / e.len;
      if (k < 0) { keep.push(e); continue; }
      if (k >= 1 && !e.persist) { if (e.done) e.done(); continue; }
      ctx.save();
      try { e.draw(e.persist ? (t - e.t0) / 1000 : clamp01(k), e); } catch (err) { /* 画坏一帧不影响战斗 */ }
      ctx.restore();
      keep.push(e);
    }
    list = keep;
    if (list.length) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  function remove(e) { if (e) list = list.filter(x => x !== e); if (!list.length && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); }

  /* ---------- 画法小件 ---------- */
  /** 一条沿折线的带子，宽度按 wAt(u) 变（刀光、爪痕、彗尾、喷漆叉都是它） */
  function ribbon(pts, wAt) {
    const n = pts.length, L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0];
      const d = Math.hypot(nx, ny) || 1; nx /= d; ny /= d;
      const w = Math.max(0, wAt(n > 1 ? i / (n - 1) : 0)) / 2;
      L.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
      R.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
    }
    const p = new Path2D();
    p.moveTo(L[0][0], L[0][1]);
    for (let i = 1; i < n; i++) p.lineTo(L[i][0], L[i][1]);
    for (let i = n - 1; i >= 0; i--) p.lineTo(R[i][0], R[i][1]);
    p.closePath();
    return p;
  }
  /** 贴纸画法：先错开一点的墨色投影，再粗墨边，再填色 */
  function sticker(path, color, opt) {
    opt = opt || {};
    const ink = opt.ink == null ? 4 : opt.ink;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    if (opt.shadow !== false) {
      ctx.save(); ctx.translate(2.5, 3.5); ctx.globalAlpha *= .28; ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineWidth = ink;
      ctx.fill(path); if (ink) ctx.stroke(path); ctx.restore();
    }
    if (ink) { ctx.strokeStyle = INK; ctx.lineWidth = ink; ctx.stroke(path); }
    ctx.fillStyle = color; ctx.fill(path);
  }
  /** 线条的贴纸画法：墨线 → 色线 → 白芯 */
  function line(path, w, color, core, opt) {
    opt = opt || {};
    ctx.lineJoin = "round"; ctx.lineCap = opt.cap || "round";
    const iw = w + Math.min(5, w * 1.5);
    if (opt.shadow !== false) { ctx.save(); ctx.translate(2.5, 3.5); ctx.globalAlpha *= .26; ctx.strokeStyle = INK; ctx.lineWidth = iw; ctx.stroke(path); ctx.restore(); }
    ctx.strokeStyle = INK; ctx.lineWidth = iw; ctx.stroke(path);
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(path);
    if (core) { ctx.strokeStyle = core; ctx.lineWidth = Math.max(1, w * .4); ctx.stroke(path); }
  }
  function poly(pts) { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); return p; }
  function polyline(pts) { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); return p; }
  function circlePath(x, y, r) { const p = new Path2D(); p.arc(x, y, Math.max(.1, r), 0, TAU); return p; }
  /** 冲击星：n 个角，每个角长短随机一点，像手画的 */
  function starPts(cx, cy, n, rOut, rIn, rot, jit) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = rot + i / (n * 2) * TAU, r = (i % 2 ? rIn : rOut) * (jit ? jit[i % jit.length] : 1);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  }
  /** 喷漆飞溅：一圈小点（预先算好位置，按 k 往外飘、缩小） */
  function makeSpecks(n, spread) { return Array.from({ length: n }, () => ({ a: rnd(0, TAU), d: rnd(.35, 1) * spread, r: rnd(1.4, 3.6), v: rnd(.2, .6) })); }
  function drawSpecks(cx, cy, specks, color, k) {
    ctx.fillStyle = color; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
    for (const s of specks) {
      const d = s.d * (1 + s.v * k), r = s.r * (1 - k);
      if (r <= .2) continue;
      ctx.beginPath(); ctx.arc(cx + Math.cos(s.a) * d, cy + Math.sin(s.a) * d, r, 0, TAU); ctx.fill(); if (r > 2) ctx.stroke();
    }
  }
  /** 最后一小段才淡掉（墨线描边的形状半透明会发灰，平时宁可缩小、变细） */
  const tailFade = (k, from) => k < from ? 1 : Math.max(0, 1 - (k - from) / (1 - from));
  const dirOf = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d, d, ang: Math.atan2(dy, dx) }; };
  /** 卡片边上朝向目标的那一点（弹道从这里出去） */
  function edgeToward(r, dir, inset) {
    const hw = r.w / 2 - (inset || 0), hh = r.h / 2 - (inset || 0);
    const tx = Math.abs(dir.x) > 1e-6 ? hw / Math.abs(dir.x) : Infinity, ty = Math.abs(dir.y) > 1e-6 ? hh / Math.abs(dir.y) : Infinity;
    const t = Math.max(0, Math.min(tx, ty));
    return { x: r.x + dir.x * t, y: r.y + dir.y * t };
  }
  /** 形状的基准大小：跟着卡片宽度走（三区制、手机上的卡小，形状也跟着小） */
  const sizeOf = (r) => Math.max(36, Math.min(110, (r && r.w ? r.w : 180) * .5));

  /* ================= 3. 出手 ================= */
  /** 蓄力：弹道招式在枪口闪一下 / 聚一团光；贴身招式不画（卡片自己往后收，在 game.js） */
  function windup(from, to, move) {
    if (!from || !to || !move || reduced()) return Promise.resolve();
    const dir = dirOf(from, to), at = edgeToward(from, dir, 4), el = move.el;
    const c = COL[el] || COL.physical, hot = HOT[el] || "#fff";
    if (move.kind === "shot" || move.kind === "spread") {
      muzzle(at, dir, move.kind === "spread" ? 34 : 26, el);
      return after(60);
    }
    if (move.kind === "lob") {
      add({ dur: 150, draw(k) { sticker(circlePath(at.x, at.y - 8 * k, 11 * ease.out(k)), c, { ink: 3 }); } });
      return after(70);
    }
    if (KIND[move.kind] === "shot") {
      // 蓄能：一团属性色的光在出手那一边聚起来，几道细线往里吸
      add({ dur: 210, draw(k) {
        const r = (move.kind === "beam" ? 15 : 12) * (k < .7 ? ease.back(k / .7) : 1 - (k - .7) / .3 * .6);
        ctx.strokeStyle = INK; ctx.lineWidth = 2.4; ctx.lineCap = "round";
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * TAU + .4, r1 = 34 - ease.out(k) * 20, r2 = r1 + 9;
          ctx.globalAlpha = 1 - k;
          ctx.beginPath(); ctx.moveTo(at.x + Math.cos(a) * r1, at.y + Math.sin(a) * r1); ctx.lineTo(at.x + Math.cos(a) * r2, at.y + Math.sin(a) * r2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        sticker(circlePath(at.x, at.y, r), move.kind === "flame" ? "#ffb43a" : c, { ink: 3 });
        ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(at.x - r * .15, at.y - r * .15, r * .5, 0, TAU); ctx.fill();
      } });
      return after(120);
    }
    return Promise.resolve();
  }
  /** 枪口火光：朝目标喷出的尖星 + 两道侧焰 */
  function muzzle(at, dir, size, el) {
    const jit = Array.from({ length: 16 }, () => rnd(.7, 1.2));
    add({ dur: 150, draw(k) {
      const s = (k < .25 ? ease.out(k / .25) : 1 - ease.in((k - .25) / .75)) * size;
      if (s < 1) return;
      ctx.translate(at.x, at.y); ctx.rotate(dir.ang);
      ctx.save(); ctx.translate(s * .35, 0); ctx.scale(1.6, .75);
      sticker(poly(starPts(0, 0, 7, s, s * .4, 0, jit)), el === "fire" ? COL.fire : "#ffd23a", { ink: 3 });
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, 0, s * .34, 0, TAU); ctx.fill();
      ctx.restore();
    } });
  }

  /* ================= 4. 弹道 ================= */
  /** 弹道飞到目标；返回的 Promise 在「打到」的那一刻结束。o.quick：多段攻击的后几发，飞得更快 */
  function travel(from, to, move, o) {
    o = o || {};
    if (!from || !to || !move || KIND[move.kind] !== "shot" || reduced()) return Promise.resolve();
    const dir = dirOf(from, to);
    const a = edgeToward(from, dir, 6), b = { x: to.x, y: to.y };
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const el = move.el, c = COL[el] || COL.physical, hot = HOT[el] || "#fff";
    const q = o.quick ? .65 : 1;
    let ms;
    switch (move.kind) {
      case "shot": ms = Math.max(70, Math.min(160, dist / 2.4)) * q; tracer(a, b, ms, move.big ? 7 : 5.5, el === "fire" ? "#ff8a3a" : el === "ice" ? COL.ice : "#ffd23a", 0, 1); break;
      case "spread": ms = Math.max(80, Math.min(180, dist / 2.2)) * q; pellets(a, to, ms, el); break;
      case "bolt": ms = Math.max(150, Math.min(300, dist / 1.25)) * q; comet(a, b, ms, move, c, hot); break;
      case "flame": ms = Math.max(170, Math.min(330, dist / 1.15)) * q; move.stream ? flameStream(a, b, ms) : fireball(a, b, ms, move); break;
      case "shard": ms = Math.max(120, Math.min(260, dist / 1.6)) * q; crystal(a, b, ms, move, c, hot); break;
      case "lob": ms = Math.max(230, Math.min(420, dist / .95)) * q; glob(a, b, ms, move, c, hot); break;
      case "beam": ms = 110 * q; beam(a, b, 280 * (o.quick ? .7 : 1), move, c, hot); break;
      case "zap": ms = 60 * q; lightning(a, b, 230 * (o.quick ? .75 : 1), el); break;
      case "wave": ms = Math.max(170, Math.min(320, dist / 1.2)) * q; waves(a, b, ms, move, c); break;
      default: ms = 0;
    }
    return after(ms);
  }
  /** 曳光弹：一段亮线从 a 飞到 b */
  function tracer(a, b, ms, w, color, delay, lenK) {
    const dir = dirOf(a, b), len = Math.min(dir.d * .55, 150 * (lenK || 1));
    add({ dur: ms, delay, draw(k) {
      const h = k, hx = lerp(a.x, b.x, h), hy = lerp(a.y, b.y, h);
      const t = Math.max(0, Math.hypot(hx - a.x, hy - a.y) - len) / dir.d;
      const tx = lerp(a.x, b.x, t), ty = lerp(a.y, b.y, t);
      sticker(ribbon([[tx, ty], [lerp(tx, hx, .5), lerp(ty, hy, .5)], [hx, hy]], (u) => w * (.25 + .75 * u)), color, { ink: 3, shadow: false });
      ctx.fillStyle = "#fff"; ctx.fill(ribbon([[lerp(tx, hx, .4), lerp(ty, hy, .4)], [hx, hy]], (u) => w * .45 * u));
    } });
  }
  /** 霰弹：一把弹丸散开飞过去，落点各不一样 */
  function pellets(a, to, ms, el) {
    const s = (to.w || 160) * .26;
    const col = el === "fire" ? "#ff8a3a" : el === "ice" ? COL.ice : "#ffd23a";
    for (let i = 0; i < 6; i++) {
      const b = { x: to.x + rnd(-s, s) * .9, y: to.y + (i - 2.5) * s * .28 + rnd(-6, 6) };
      tracer(a, b, ms * rnd(.85, 1.1), 4.2, col, i * 10, .35);
    }
  }
  /** 能量弹：一颗带尾巴的光球，走一条微弯的弧线，沿路掉几颗小星 */
  function comet(a, b, ms, move, c, hot) {
    const dir = dirOf(a, b), bend = rnd(.08, .18) * dir.d * (Math.random() < .5 ? -1 : 1);
    const ctrl = { x: (a.x + b.x) / 2 - dir.y * bend, y: (a.y + b.y) / 2 + dir.x * bend };
    const at = (k) => { const u = 1 - k; return [u * u * a.x + 2 * u * k * ctrl.x + k * k * b.x, u * u * a.y + 2 * u * k * ctrl.y + k * k * b.y]; };
    const r = move.big || move.heavy ? 15 : 12;
    const sparks = [];
    add({ dur: ms, draw(k) {
      const e = k;
      if (Math.random() < .6) { const p = at(e); sparks.push({ x: p[0] + rnd(-6, 6), y: p[1] + rnd(-6, 6), t: e, s: rnd(3, 5.5) }); }
      for (const sp of sparks) {
        const age = (e - sp.t) * 3.5; if (age > 1) continue;
        const s = sp.s * (1 - age);
        sticker(poly(starPts(sp.x, sp.y, 4, s, s * .35, .3, null)), c, { ink: 1.6, shadow: false });
      }
      const pts = []; for (let j = 0; j <= 12; j++) pts.push(at(Math.max(0, e - j * .03)));
      sticker(ribbon(pts.slice().reverse(), (u) => r * 1.8 * Math.pow(u, 1.6)), c, { ink: 3, shadow: false });
      const h = pts[0];
      sticker(circlePath(h[0], h[1], r), c, { ink: 3.5 });
      ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(h[0] - r * .12, h[1] - r * .18, r * .55, 0, TAU); ctx.fill();
    } });
  }
  /** 火球：泪滴形的火团，尾巴三条火舌一闪一闪 */
  function fireball(a, b, ms, move) {
    const dir = dirOf(a, b), bend = rnd(.05, .14) * dir.d;
    const ctrl = { x: (a.x + b.x) / 2 + dir.y * bend * .3, y: (a.y + b.y) / 2 - bend };
    const at = (k) => { const u = 1 - k; return [u * u * a.x + 2 * u * k * ctrl.x + k * k * b.x, u * u * a.y + 2 * u * k * ctrl.y + k * k * b.y]; };
    const r = move.big || move.heavy ? 16 : 13;
    add({ dur: ms, draw(k) {
      const p = at(k), q = at(Math.max(0, k - .04));
      const ang = Math.atan2(p[1] - q[1], p[0] - q[0]);
      ctx.translate(p[0], p[1]); ctx.rotate(ang);
      const flick = (i) => 1 + Math.sin(k * 40 + i * 2.1) * .18;
      const body = (s) => poly([
        [r * s, 0], [r * .7 * s, -r * .72 * s], [0, -r * s], [-r * 1.6 * s * flick(0), -r * .55 * s], [-r * 1.1 * s, -r * .15 * s],
        [-r * 2.6 * s * flick(1), 0], [-r * 1.1 * s, r * .15 * s], [-r * 1.6 * s * flick(2), r * .55 * s], [0, r * s], [r * .7 * s, r * .72 * s]
      ]);
      sticker(body(1), COL.fire, { ink: 3.5 });
      ctx.fillStyle = "#ffb43a"; ctx.fill(body(.68));
      ctx.fillStyle = "#fff4c2"; ctx.beginPath(); ctx.arc(r * .2, 0, r * .38, 0, TAU); ctx.fill();
    } });
  }
  /** 冰棱 / 针：细长的晶体直线飞过去，尾巴撒冰屑 */
  function crystal(a, b, ms, move, c, hot) {
    const dir = dirOf(a, b), L = move.needle ? 40 : 46, W = move.needle ? 4.5 : 13;
    const flakes = [];
    add({ dur: ms, draw(k) {
      const x = lerp(a.x, b.x, k), y = lerp(a.y, b.y, k);
      if (Math.random() < .75) flakes.push({ x: x - dir.x * L * .5 + rnd(-5, 5), y: y - dir.y * L * .5 + rnd(-5, 5), t: k, s: rnd(2, 3.6) });
      for (const f of flakes) {
        const age = (k - f.t) * 4; if (age > 1) continue;
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.t * 20);
        const s = f.s * (1 - age);
        sticker(poly([[s, 0], [0, -s], [-s, 0], [0, s]]), move.needle ? "#e9f6ff" : c, { ink: 1.4, shadow: false });
        ctx.restore();
      }
      ctx.translate(x, y); ctx.rotate(dir.ang);
      const shape = move.needle
        ? poly([[L * .5, 0], [-L * .42, -W / 2], [-L * .5, 0], [-L * .42, W / 2]])
        : poly([[L * .55, 0], [L * .12, -W / 2], [-L * .42, -W / 2.4], [-L * .58, 0], [-L * .42, W / 2.4], [L * .12, W / 2]]);
      sticker(shape, move.needle ? "#e9f6ff" : c, { ink: 3.2 });
      ctx.fillStyle = hot;
      ctx.fill(move.needle ? poly([[L * .45, 0], [-L * .2, -W * .15], [-L * .2, W * .15]]) : poly([[L * .5, 0], [L * .1, -W * .18], [-L * .45, 0], [L * .1, W * .18]]));
    } });
  }
  /** 抛物线：酸液团 / 毛球 / 榴弹，边飞边滴 */
  function glob(a, b, ms, move, c, hot) {
    const dir = dirOf(a, b), H = Math.max(40, Math.min(105, dir.d * .3));
    const drops = [];
    const r = move.fur ? 13 : 12;
    add({ dur: ms, draw(k) {
      const x = lerp(a.x, b.x, k), y = lerp(a.y, b.y, k) - 4 * H * k * (1 - k);
      if (!move.fur && Math.random() < .4) drops.push({ x: x + rnd(-3, 3), y, t: k, r: rnd(2.6, 4.4) });
      for (const d of drops) {
        const age = (k - d.t) * 3; if (age > 1) continue;
        sticker(circlePath(d.x, d.y + age * age * 34, d.r * (1 - age * .6)), c, { ink: 1.8, shadow: false });
      }
      const wob = Math.sin(k * 26) * .14;
      ctx.translate(x, y); ctx.rotate(k * (move.fur ? 9 : 3));
      ctx.scale(1 + wob, 1 - wob);
      if (move.fur) {
        // 毛球：一团毛茸茸的球（边上一圈短毛）
        const pts = []; for (let i = 0; i < 22; i++) { const aa = i / 22 * TAU, rr = r * (i % 2 ? .78 : 1.22); pts.push([Math.cos(aa) * rr, Math.sin(aa) * rr]); }
        sticker(poly(pts), "#efe0bd", { ink: 2.8 });
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(1, 1, r * .42, 0, TAU); ctx.fill();
      } else {
        sticker(circlePath(0, 0, r), c, { ink: 3.2 });
        ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(-r * .32, -r * .32, r * .34, 0, TAU); ctx.fill();
      }
    } });
  }
  /** 喷火：一串越来越大、越来越红的火团从攻击者喷向目标 */
  function flameStream(a, b, ms) {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const spread = rnd(-.14, .14), life = ms * rnd(.75, 1.1), wob = rnd(0, TAU);
      add({ dur: life, delay: i * (ms / n) * .6, draw(k) {
        const dir = dirOf(a, b), off = spread * dir.d * k + Math.sin(k * 9 + wob) * 4;
        const x = lerp(a.x, b.x, ease.out(k)) - dir.y * off, y = lerp(a.y, b.y, ease.out(k)) + dir.x * off;
        const r = (6 + 14 * k) * tailFade(k, .75);
        if (r <= .5) return;
        sticker(circlePath(x, y, r), k < .3 ? "#ffd23a" : k < .65 ? COL.fire : DEEP.fire, { ink: 2.6, shadow: false });
        if (k < .5) { ctx.fillStyle = "#fff4c2"; ctx.beginPath(); ctx.arc(x, y, r * .4, 0, TAU); ctx.fill(); }
      } });
    }
  }
  /** 激光：一道直直的光束，粗起来再细下去，抖两下 */
  function beam(a, b, ms, move, c, hot) {
    add({ dur: ms, draw(k) {
      const w = (move.big ? 15 : 12) * Math.pow(Math.sin(Math.PI * Math.min(1, k * 1.2)), .6) * (1 + Math.sin(k * 70) * .1);
      if (w <= .4) return;
      line(polyline([[a.x, a.y], [b.x, b.y]]), w, c, hot);
      sticker(circlePath(b.x, b.y, w * 1.4), c, { ink: 3, shadow: false });
      ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(b.x, b.y, w * .75, 0, TAU); ctx.fill();
      sticker(circlePath(a.x, a.y, w * .9), c, { ink: 3, shadow: false });
    } });
  }
  /** 电弧：从 a 到 b 的折线，中途分叉，闪几下（每下重新长一次）；旁边再跟一道细的 */
  function lightning(a, b, ms, el) {
    let shape = null, shape2 = null, seed = -1;
    const main = el === "electric" || !COL[el] ? "#ffe23a" : COL[el];
    add({ dur: ms, draw(k) {
      const flick = Math.floor(k * 5);
      if (flick !== seed) { seed = flick; shape = boltPts(a, b, 4, 1); shape2 = boltPts(a, b, 0, .7); }
      if (k > .78 && flick % 2) return;   // 最后闪烁着熄掉
      shape2.forEach((pts) => line(polyline(pts), 2.6, "#7fd4ff", "#fff", { shadow: false }));
      shape.forEach((pts, i) => line(polyline(pts), i ? 3 : 6, main, "#fff", { shadow: i > 0 ? false : undefined }));
    } });
  }
  function boltPts(a, b, depth, ampK) {
    const dir = dirOf(a, b), n = Math.max(5, Math.round(dir.d / 30)), amp = Math.min(28, dir.d * .1) * (ampK || 1);
    const pts = [[a.x, a.y]];
    let off = 0, t = 0;
    for (let i = 1; i < n; i++) {
      t += (1 / n) * rnd(.6, 1.4); if (t >= .97) break;
      off = Math.max(-amp, Math.min(amp, off * .3 + rnd(-1, 1) * amp * (Math.random() < .25 ? 1.6 : .9)));
      pts.push([lerp(a.x, b.x, t) - dir.y * off, lerp(a.y, b.y, t) + dir.x * off]);
    }
    pts.push([b.x, b.y]);
    const out = [pts];
    if (depth > 0 && n > 3) {
      for (let f = 0; f < 2; f++) {
        const k = 1 + Math.floor(Math.random() * (n - 2)), [sx, sy] = pts[k];
        const ang = dir.ang + (f ? 1 : -1) * rnd(.4, 1), len = rnd(22, 46);
        out.push(...boltPts({ x: sx, y: sy }, { x: sx + Math.cos(ang) * len, y: sy + Math.sin(ang) * len }, depth - 2, .7));
      }
    }
    return out;
  }
  /** 声波：一组「)))」形的弧往目标推过去，越走越大 */
  function waves(a, b, ms, move, c) {
    const dir = dirOf(a, b), n = move.roar ? 4 : 3;
    for (let i = 0; i < n; i++) {
      add({ dur: ms, delay: i * 50, draw(k) {
        const x = lerp(a.x, b.x, k), y = lerp(a.y, b.y, k);
        const R = (move.roar ? 40 : 34) + k * (move.roar ? 46 : 36);
        const span = .6 + k * .16;
        const pts = [];
        for (let j = 0; j <= 18; j++) {
          const an = dir.ang + (j / 18 - .5) * 2 * span;
          pts.push([x - dir.x * R + Math.cos(an) * R, y - dir.y * R + Math.sin(an) * R]);
        }
        const w = (move.roar ? 8 : 6.5) * tailFade(k, .8);
        if (w <= .4) return;
        sticker(ribbon(pts, (u) => w * (.35 + .65 * Math.sin(Math.PI * u))), c, { ink: 3, shadow: false });
      } });
    }
  }

  /** 支援 / 挂效果：从施放者到目标拉一条弧线（支援薄荷绿、挂效果荧光粉 / 属性色），线头到了就结束 */
  function link(from, to, move) {
    if (!from || !to || !move || reduced() || !ensure()) return Promise.resolve();
    const dir = dirOf(from, to), a = edgeToward(from, dir, 4);
    const col = move.kind === "support" ? (move.shield ? HOLO : MINT) : (move.el && move.el !== "physical" ? COL[move.el] : PINK);
    const lift = Math.min(80, dir.d * .25);
    const ctrl = { x: (a.x + to.x) / 2, y: (a.y + to.y) / 2 - lift };
    const at = (k) => { const u = 1 - k; return [u * u * a.x + 2 * u * k * ctrl.x + k * k * to.x, u * u * a.y + 2 * u * k * ctrl.y + k * k * to.y]; };
    const ms = Math.max(150, Math.min(280, dir.d / 1.6));
    add({ dur: ms + 260, draw(k) {
      const t = k * (ms + 260), head = clamp01(t / ms), tail = clamp01((t - ms * .45) / (ms * .8));
      if (head - tail <= .01) return;
      const pts = []; for (let i = 0; i <= 24; i++) pts.push(at(lerp(tail, head, i / 24)));
      ctx.setLineDash([10, 7]); ctx.lineDashOffset = -t * .08;
      line(polyline(pts), 3.4, col, null, { shadow: false });
      ctx.setLineDash([]);
      if (head < 1) { const h = pts[pts.length - 1]; sticker(circlePath(h[0], h[1], 6), col, { ink: 2.8, shadow: false }); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(h[0], h[1], 2.4, 0, TAU); ctx.fill(); }
    } });
    return after(ms);
  }

  /* ================= 5. 打中的那一下 ================= */
  /**
   * 打中：o.n 第几段（0 起；刀光左右交替）· o.from 攻击者（决定刀光、冲击的方向）· o.big 重击（更大）
   * 弹道招式打中时只补一个小的落点形状（主要的受击还是 hit-fx.js 的粒子）
   */
  function impact(at, move, o) {
    o = o || {};
    if (!at || !move || move.kind === "none" || !ensure()) return;
    const el = move.el, c = COL[el] || COL.physical, hot = HOT[el] || "#fff";
    const S = sizeOf(at) * (o.big || move.big ? 1.25 : 1);
    const n = o.n || 0;
    const from = o.from || { x: at.x - 100, y: at.y };
    const dir = dirOf(from, at);
    if (reduced()) { flashStar(at, S * .5, c, 140); return; }
    switch (move.kind) {
      case "slash": slashFx(at, S, dir, n, move, c, hot); break;
      case "thrust": thrustFx(at, S, dir, move, c, hot); break;
      case "smash": smashFx(at, S, dir, move, c, hot); break;
      case "claw": clawFx(at, S, dir, n, c, hot); break;
      case "bite": biteFx(at, S, c, hot); break;
      case "shot": flashStar(at, S * .5, "#ffd23a", 170, true); break;
      case "spread": for (let i = 0; i < 3; i++) flashStar({ x: at.x + rnd(-.3, .3) * at.w, y: at.y + rnd(-.25, .25) * at.h }, S * .3, "#ffd23a", 150, true, i * 25); break;
      case "bolt": case "beam": ringFx(at, S * .75, c, 280); flashStar(at, S * .45, c, 180); break;
      case "zap": flashStar(at, S * .5, "#ffe23a", 180, true); zigRing(at, S * .6); break;
      case "shard": shatterFx(at, S, dir, c, hot); break;
      case "lob": splatFx(at, S, c, hot, move); break;
      case "flame": flameBurst(at, S); break;
      case "wave": ringFx(at, S * .85, c, 340, true); break;
      case "explode": smashFx(at, S * 1.15, dir, Object.assign({}, move, { heavy: true }), c, hot); break;
      case "support": supportFx(at, S, move); break;
      case "hex": hexFx(at, S, move, c); break;
    }
  }
  /**
   * 刀光：一道斜劈的弧（两头尖、中间厚、刀口一道白芯），先从一端劈到另一端，再从尾巴散掉，
   * 后面拖一层半透明的残影；多段攻击左右交替，叠起来像交叉的两刀
   */
  function slashFx(at, S, dir, n, move, c, hot) {
    const katana = move.blade === "katana", rapier = move.blade === "rapier", knife = move.blade === "knife", heavy = !!move.heavy;
    const L = S * (katana ? 2.9 : knife ? 1.75 : rapier ? 2.3 : heavy ? 2.6 : 2.4);
    const T = S * (katana ? .2 : knife ? .22 : rapier ? .18 : heavy ? .46 : .32);
    const bow = L * (katana ? .14 : .22);
    const side = n % 2 ? -1 : 1;
    const facing = Math.cos(dir.ang) >= 0 ? 1 : -1;            // 攻击者在左边：1
    // 斜劈：从攻击者这一侧的上方劈到另一侧的下方；第二刀反过来，像个叉
    let theta = (side > 0 ? .6 : -.6) + rnd(-.12, .12);
    if (facing < 0) theta = Math.PI - theta;
    const ux = Math.cos(theta), uy = Math.sin(theta);
    let nx = -uy, ny = ux; if (ny > 0) { nx = -nx; ny = -ny; }   // 弧往上鼓
    const cx = at.x - nx * bow * .55, cy = at.y - ny * bow * .55 - S * .04;
    const P = (u) => [cx + ux * L * (u - .5) + nx * bow * Math.sin(Math.PI * u), cy + uy * L * (u - .5) + ny * bow * Math.sin(Math.PI * u)];
    const specks = makeSpecks(12, S * .55);
    const dur = katana ? 300 : 340;
    add({ dur, draw(k) {
      const draw = clamp01(k / .3), fade = clamp01((k - .3) / .7);
      const head = ease.out(draw), tail = ease.in(fade);
      if (head - tail <= .015) return;
      const N = 30, pts = [], smear = [];
      for (let i = 0; i <= N; i++) {
        const u = lerp(tail, head, i / N), p = P(u);
        pts.push(p);
        smear.push([p[0] - nx * T * .55, p[1] - ny * T * .55]);
      }
      const thick = T * (1 - fade * .45);
      // 残影：同一道弧往里错开、更宽、半透明，不描边
      ctx.globalAlpha = .28 * (1 - fade);
      ctx.fillStyle = c; ctx.fill(ribbon(smear, (u) => thick * 1.7 * Math.sin(Math.PI * u)));
      ctx.globalAlpha = 1;
      const wAt = (u) => thick * Math.pow(Math.sin(Math.PI * clamp01(u)), .65);
      sticker(ribbon(pts, wAt), c, { ink: 4 });
      // 刀口：靠外沿的一道白芯
      const edge = pts.map(([x, y]) => [x + nx * thick * .16, y + ny * thick * .16]);
      ctx.fillStyle = hot; ctx.fill(ribbon(edge, (u) => thick * .42 * Math.pow(Math.sin(Math.PI * clamp01(u)), .9)));
      // 劈的时候刀尖带出的速度线
      if (draw < 1) {
        const hp = P(head), hp2 = P(Math.max(0, head - .08));
        const ang = Math.atan2(hp[1] - hp2[1], hp[0] - hp2[0]);
        ctx.strokeStyle = INK; ctx.lineWidth = 2.4; ctx.lineCap = "round";
        for (let j = 0; j < 3; j++) {
          const off = (j - 1) * 8, bx = hp[0] - Math.cos(ang) * (16 + j * 6) - Math.sin(ang) * off, by = hp[1] - Math.sin(ang) * (16 + j * 6) + Math.cos(ang) * off;
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - Math.cos(ang) * 22, by - Math.sin(ang) * 22); ctx.stroke();
        }
      }
      if (fade > 0) { const m = P(.5); drawSpecks(m[0], m[1], specks, c, fade); }
    } });
    if (move.flash && n === 0) flashLine(at, S, c, hot);
  }
  /** 一闪：横贯的一道极细白光，随后上下分开 */
  function flashLine(at, S, c, hot) {
    const L = S * 4.2;
    add({ dur: 460, draw(k) {
      const split = ease.out(clamp01((k - .22) / .78)) * 9, w = 3.2 * (1 - clamp01((k - .22) / .78) * .8);
      const grow = ease.out(clamp01(k / .18));
      for (const s of [-1, 1]) {
        const p = polyline([[at.x - L / 2 * grow, at.y + s * split], [at.x + L / 2 * grow, at.y + s * split]]);
        line(p, w, c, hot, { shadow: false, cap: "butt" });
      }
    } });
  }
  /** 刺：一根长刺从攻击者这边扎穿目标，从后往前一顶，出口闪一下，再变细收掉 */
  function thrustFx(at, S, dir, move, c, hot) {
    const L = S * (move.heavy ? 2.9 : move.needle ? 2.3 : 2.6), W = S * (move.heavy ? .34 : move.needle ? .13 : .22);
    const back = -L * .48;
    add({ dur: 320, draw(k) {
      const out = ease.out(clamp01(k / .22));
      const thin = 1 - ease.in(clamp01((k - .3) / .7));
      if (thin <= .02) return;
      ctx.translate(at.x, at.y); ctx.rotate(dir.ang);
      const tip = lerp(back + L * .2, L * .52, out), w = W * thin;
      // 速度线
      ctx.strokeStyle = INK; ctx.lineWidth = 2.4; ctx.lineCap = "round";
      for (let i = 0; i < 4; i++) { const y = (i - 1.5) * W * .95, x0 = back - 6 - (i % 2) * 10; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 - 26 * thin, y); ctx.stroke(); }
      sticker(poly([[tip, 0], [tip - L * .3, -w / 2], [back, -w * .3], [back - w * .4, 0], [back, w * .3], [tip - L * .3, w / 2]]), move.needle ? "#e9f6ff" : c, { ink: 3.5 });
      ctx.fillStyle = hot; ctx.fill(poly([[tip - 3, 0], [tip - L * .3, -w * .16], [back + 6, 0], [tip - L * .3, w * .16]]));
    } });
    flashStar({ x: at.x + dir.x * L * .5, y: at.y + dir.y * L * .5 }, S * .4, c, 200, true, 60);
  }
  /** 砸：一颗参差不齐的冲击星猛地撑开（漫画里的「砰」），外面一圈放射的速度线，最后缩回去 */
  function smashFx(at, S, dir, move, c, hot) {
    const heavy = !!move.heavy, R = S * (heavy ? .9 : .74);
    const jit = Array.from({ length: 28 }, () => rnd(.7, 1.2));
    const nRays = heavy ? 14 : 10;
    const rays = Array.from({ length: nRays }, (_, i) => ({ a: i / nRays * TAU + rnd(-.18, .18), l: rnd(.55, 1) }));
    const rot = rnd(0, TAU), pts = heavy ? 12 : 10;
    const ox = dir.x * S * .12, oy = dir.y * S * .12;
    add({ dur: heavy ? 380 : 330, draw(k) {
      const grow = k < .2 ? ease.back(k / .2) : 1 - ease.in(clamp01((k - .2) / .8)) * .85;
      if (grow <= .05) return;
      const r = R * grow, cx = at.x + ox * Math.min(1, k * 3), cy = at.y + oy * Math.min(1, k * 3);
      // 速度线先画（在星的下面）：从星的边上往外射，越来越短
      ctx.strokeStyle = INK; ctx.lineCap = "round";
      const rayK = clamp01(k / .5);
      if (rayK < 1) for (const ray of rays) {
        const r1 = R * (.95 + rayK * .55), r2 = r1 + R * .5 * ray.l * (1 - rayK);
        ctx.lineWidth = heavy ? 4 : 3;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(ray.a) * r1, cy + Math.sin(ray.a) * r1); ctx.lineTo(cx + Math.cos(ray.a) * r2, cy + Math.sin(ray.a) * r2); ctx.stroke();
      }
      sticker(poly(starPts(cx, cy, pts, r, r * .52, rot, jit)), c, { ink: 4.5 });
      ctx.fillStyle = hot; ctx.fill(poly(starPts(cx, cy, pts, r * .56, r * .3, rot + .2, jit)));
      if (move.drill) {
        // 电钻：中间一圈转着的螺旋
        ctx.strokeStyle = INK; ctx.lineWidth = 3.4;
        ctx.beginPath(); for (let i = 0; i <= 34; i++) { const t = i / 34, an = t * TAU * 2.2 + k * 20, rr = r * .5 * t; i ? ctx.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr) : ctx.moveTo(cx, cy); } ctx.stroke();
      }
    } });
  }
  /** 爪：三道平行的弯爪痕，依次划过 */
  function clawFx(at, S, dir, n, c, hot) {
    const side = n % 2 ? -1 : 1, facing = Math.cos(dir.ang) >= 0 ? 1 : -1;
    let ang = (side > 0 ? 1.05 : -1.05) + rnd(-.15, .15);
    if (facing < 0) ang = Math.PI - ang;
    const L = S * 1.9, gap = S * .3, nx = -Math.sin(ang), ny = Math.cos(ang);
    for (let i = 0; i < 3; i++) {
      add({ dur: 320, delay: i * 32, draw(k) {
        const draw = ease.out(clamp01(k / .3)), thin = 1 - ease.in(clamp01((k - .35) / .65));
        if (thin <= .03) return;
        const off = (i - 1) * gap, len = i === 1 ? 1 : .86;
        const pts = [];
        for (let j = 0; j <= 16; j++) {
          const t = (j / 16 - .5) * draw * len, bow = Math.sin((j / 16) * Math.PI) * S * .12 * draw;
          pts.push([at.x + Math.cos(ang) * L * t + nx * (off + bow), at.y + Math.sin(ang) * L * t + ny * (off + bow)]);
        }
        const w = S * .2 * thin;
        sticker(ribbon(pts, (u) => w * Math.pow(Math.sin(Math.PI * u), .55)), c, { ink: 3.2 });
        ctx.fillStyle = hot; ctx.fill(ribbon(pts, (u) => w * .34 * Math.sin(Math.PI * u)));
      } });
    }
  }
  /** 咬：上下两排尖牙从两边合上，咔的一下；牙后面炸一颗小星 */
  function biteFx(at, S, c, hot) {
    const W = S * 1.5, open = S * .78, teeth = 5;
    add({ dur: 260, delay: 70, draw(k) {
      const r = S * .36 * (k < .3 ? ease.back(k / .3) : 1 - ease.in((k - .3) / .7));
      if (r > 1) sticker(poly(starPts(at.x, at.y, 8, r, r * .45, .3, null)), hot, { ink: 3, shadow: false });
    } });
    add({ dur: 360, draw(k) {
      const close = k < .24 ? ease.in(k / .24) : 1;
      const shake = k > .24 && k < .5 ? Math.sin(k * 90) * 2 : 0;
      const shrink = 1 - ease.in(clamp01((k - .55) / .45));
      if (shrink <= .05) return;
      ctx.translate(at.x + shake, at.y);
      ctx.scale(shrink, shrink);
      for (const s of [-1, 1]) {
        const y0 = s * (open * (1 - close) + S * .06);
        // 牙床：一条往外鼓的弧带
        const gum = [];
        for (let j = 0; j <= 16; j++) { const t = j / 16; gum.push([(t - .5) * W, y0 + s * (S * .26 + Math.sin(Math.PI * t) * S * .16)]); }
        sticker(ribbon(gum, (u) => S * .2 * (.5 + .5 * Math.sin(Math.PI * u))), c, { ink: 3.5 });
        // 一排尖牙
        for (let i = 0; i < teeth; i++) {
          const t0 = (i + .1) / teeth, t1 = (i + .9) / teeth, tm = (t0 + t1) / 2;
          const base = (t) => y0 + s * (S * .2 + Math.sin(Math.PI * t) * S * .14);
          const len = S * (i === 0 || i === teeth - 1 ? .3 : .22) * (1 - Math.abs(tm - .5) * .3);
          sticker(poly([[(t0 - .5) * W, base(t0)], [(tm - .5) * W, base(tm) - s * len], [(t1 - .5) * W, base(t1)]]), "#fff8ec", { ink: 3, shadow: false });
        }
      }
    } });
  }
  /** 冰碎：一圈晶片往外炸 */
  function shatterFx(at, S, dir, c, hot) {
    const bits = Array.from({ length: 10 }, () => ({ a: dir.ang + rnd(-1.7, 1.7), v: rnd(.6, 1.2), s: rnd(.7, 1.25), r: rnd(0, TAU) }));
    add({ dur: 360, draw(k) {
      for (const b of bits) {
        const d = S * .95 * b.v * ease.out(k), s = S * .2 * b.s * (1 - ease.in(k));
        if (s <= .5) continue;
        ctx.save(); ctx.translate(at.x + Math.cos(b.a) * d, at.y + Math.sin(b.a) * d); ctx.rotate(b.r + k * 5);
        sticker(poly([[s, 0], [0, -s * .45], [-s * .7, 0], [0, s * .45]]), c, { ink: 2.6, shadow: false });
        ctx.fillStyle = hot; ctx.fill(poly([[s * .6, 0], [0, -s * .15], [-s * .3, 0], [0, s * .15]]));
        ctx.restore();
      }
    } });
    flashStar(at, S * .5, c, 190);
  }
  /** 溅开：一滩不规则的液体，带几颗飞沫，往下淌两道 */
  function splatFx(at, S, c, hot, move) {
    const n = 16, jit = Array.from({ length: n }, () => rnd(.6, 1.28));
    const blobs = Array.from({ length: 8 }, () => ({ a: rnd(0, TAU), d: rnd(.85, 1.5), r: rnd(.07, .14) }));
    const fur = !!move.fur, col = fur ? "#efe0bd" : c;
    add({ dur: 480, draw(k) {
      const g = k < .18 ? ease.back(k / .18) : 1, shrink = 1 - ease.in(clamp01((k - .45) / .55));
      if (shrink <= .04) return;
      const R = S * .58 * g * shrink;
      const pts = []; for (let i = 0; i < n; i++) { const an = i / n * TAU; pts.push([at.x + Math.cos(an) * R * jit[i], at.y + Math.sin(an) * R * jit[i] * .82]); }
      for (const b of blobs) {
        const d = S * .55 * b.d * (1 + k * .6);
        sticker(circlePath(at.x + Math.cos(b.a) * d, at.y + Math.sin(b.a) * d + k * k * 22, S * b.r * shrink), col, { ink: 2.2, shadow: false });
      }
      sticker(poly(pts), col, { ink: 3.8 });
      if (!fur) { ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(at.x - R * .28, at.y - R * .22, R * .24, 0, TAU); ctx.fill(); }
      else { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(at.x, at.y, R * .35, 0, TAU); ctx.fill(); }
    } });
  }
  /** 火球打中：火焰往外一炸，火舌往上窜 */
  function flameBurst(at, S) {
    const tongues = Array.from({ length: 7 }, (_, i) => ({ a: -Math.PI / 2 + (i - 3) * .42 + rnd(-.12, .12), l: rnd(.7, 1.15) }));
    add({ dur: 380, draw(k) {
      const g = k < .25 ? ease.back(k / .25) : 1 - ease.in(clamp01((k - .25) / .75)) * .9;
      if (g <= .06) return;
      const R = S * .62 * g;
      const outer = [], inner = [];
      tongues.forEach((t, i) => {
        const a0 = t.a - .2, a1 = t.a + .2;
        outer.push([at.x + Math.cos(a0) * R * .55, at.y + Math.sin(a0) * R * .55], [at.x + Math.cos(t.a) * R * t.l * (1 + k * .4), at.y + Math.sin(t.a) * R * t.l * (1 + k * .4)], [at.x + Math.cos(a1) * R * .55, at.y + Math.sin(a1) * R * .55]);
        inner.push([at.x + Math.cos(t.a) * R * .62 * t.l, at.y + Math.sin(t.a) * R * .62 * t.l]);
      });
      outer.push([at.x + R * .55, at.y + R * .35], [at.x, at.y + R * .55], [at.x - R * .55, at.y + R * .35]);
      sticker(poly(outer), COL.fire, { ink: 4 });
      ctx.fillStyle = "#ffb43a"; ctx.beginPath(); ctx.arc(at.x, at.y + R * .05, R * .45, 0, TAU); ctx.fill();
      ctx.fillStyle = "#fff4c2"; ctx.beginPath(); ctx.arc(at.x, at.y + R * .1, R * .22, 0, TAU); ctx.fill();
    } });
  }
  /** 一闪而过的小冲击星（弹道落点、减少动态时的替身） */
  function flashStar(at, R, color, ms, sharp, delay) {
    const jit = Array.from({ length: 20 }, () => rnd(.75, 1.18)), rot = rnd(0, TAU);
    add({ dur: ms, delay: delay || 0, draw(k) {
      const g = k < .3 ? ease.back(k / .3) : 1 - ease.in(clamp01((k - .3) / .7)) * .9;
      if (g <= .06) return;
      sticker(poly(starPts(at.x, at.y, sharp ? 6 : 8, R * g, R * g * (sharp ? .3 : .45), rot, jit)), color, { ink: 3.2 });
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(at.x, at.y, R * g * .28, 0, TAU); ctx.fill();
    } });
  }
  /** 电击落点：一圈锯齿 */
  function zigRing(at, R) {
    add({ dur: 240, draw(k) {
      const r = R * (.5 + ease.out(k) * .6), w = 3.2 * (1 - k);
      if (w <= .3) return;
      const pts = []; for (let i = 0; i < 18; i++) { const an = i / 18 * TAU, rr = r * (i % 2 ? .82 : 1.06); pts.push([at.x + Math.cos(an) * rr, at.y + Math.sin(an) * rr * .8]); }
      line(poly(pts), w, "#ffe23a", null, { shadow: false });
    } });
  }
  /** 冲击环（wave：边上带波纹）：越撑越大、越来越细 */
  function ringFx(at, R, c, ms, wavy) {
    add({ dur: ms, draw(k) {
      const r = R * (.35 + ease.out(k) * .9), w = 4 * (1 - ease.in(k));
      if (w <= .3) return;
      const p = new Path2D();
      for (let i = 0; i <= 56; i++) {
        const an = i / 56 * TAU, rr = r + (wavy ? Math.sin(an * 8 + k * 14) * 3.5 : 0);
        i ? p.lineTo(at.x + Math.cos(an) * rr, at.y + Math.sin(an) * rr * .78) : p.moveTo(at.x + Math.cos(an) * rr, at.y + Math.sin(an) * rr * .78);
      }
      p.closePath();
      line(p, w, c, null, { shadow: false });
    } });
  }
  /** 支援：薄荷绿的十字往上飘 + 一圈光；护盾是一块六角形闪一下 */
  function supportFx(at, S, move) {
    const c = move.shield ? HOLO : MINT;
    const crosses = Array.from({ length: 5 }, (_, i) => ({ x: (i - 2) * S * .26 + rnd(-6, 6), d: [0, 90, 40, 130, 70][i], s: rnd(.85, 1.2) }));
    if (move.shield) {
      add({ dur: 560, draw(k) {
        const g = .82 + ease.out(clamp01(k / .4)) * .28, w = 4.5 * (1 - ease.in(clamp01((k - .5) / .5)));
        if (w <= .3) return;
        const pts = []; for (let i = 0; i < 6; i++) { const an = i / 6 * TAU + Math.PI / 6; pts.push([at.x + Math.cos(an) * S * .78 * g, at.y + Math.sin(an) * S * .66 * g]); }
        ctx.globalAlpha = .16 * (1 - k); ctx.fillStyle = c; ctx.fill(poly(pts)); ctx.globalAlpha = 1;
        line(poly(pts), w, c, "#fff", { shadow: false });
      } });
    } else ringFx(at, S * .8, c, 440);
    for (const cr of crosses) {
      add({ dur: 600, delay: cr.d, draw(k) {
        const y = at.y + S * .25 - ease.out(k) * S * .8, s = 11 * cr.s * (k < .25 ? ease.back(k / .25) : 1 - ease.in(clamp01((k - .6) / .4)));
        if (s <= .5) return;
        const x = at.x + cr.x, t = s * .38;
        const p = poly([[x - t, y - s], [x + t, y - s], [x + t, y - t], [x + s, y - t], [x + s, y + t], [x + t, y + t],
          [x + t, y + s], [x - t, y + s], [x - t, y + t], [x - s, y + t], [x - s, y - t], [x - t, y - t]]);
        sticker(p, c, { ink: 3 });
      } });
    }
  }
  /** 挂效果：一个转着收紧的准星落在目标身上（荧光粉喷漆；带属性的用属性色）；黑客的再带几块错位的方块 */
  function hexFx(at, S, move, c) {
    const col = move.el && move.el !== "physical" ? c : PINK;
    const glitch = !!move.glitch;
    const blocks = glitch ? Array.from({ length: 8 }, () => ({ x: rnd(-.7, .5) * S, y: rnd(-.5, .4) * S, w: rnd(8, 26), h: rnd(3, 8), c: Math.random() < .5 ? "#ff3b6e" : HOLO })) : null;
    add({ dur: 560, draw(k) {
      const g = 1.7 - ease.out(clamp01(k / .42)) * .7, rot = (1 - ease.out(clamp01(k / .5))) * 1.6;
      const thin = 1 - ease.in(clamp01((k - .62) / .38));
      if (thin <= .04) return;
      const R = S * .58 * g;
      ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(rot);
      line(circlePath(0, 0, R), 3.4 * thin, col, null, { shadow: false });
      for (let i = 0; i < 4; i++) {
        const an = i * Math.PI / 2;
        line(polyline([[Math.cos(an) * R * .55, Math.sin(an) * R * .55], [Math.cos(an) * R * 1.28, Math.sin(an) * R * 1.28]]), 3.4 * thin, col, null, { shadow: false });
      }
      ctx.restore();
      if (k > .38) { const p = ease.back(clamp01((k - .38) / .2)) * thin; sticker(circlePath(at.x, at.y, 6 * p), col, { ink: 2.6, shadow: false }); }
      if (blocks && k < .72) {
        for (const b of blocks) { if (Math.random() < .35) continue; ctx.fillStyle = b.c; ctx.fillRect(at.x + b.x + rnd(-4, 4), at.y + b.y, b.w, b.h); }
      }
    } });
  }

  /* ================= 6. 范围攻击：整区冲击波 / 一闪 ================= */
  function area(rect, from, move) {
    if (!rect || !move || reduced() || !ensure()) return;
    const el = move.el, c = COL[el] || COL.physical;
    if (move.kind === "slash" && move.flash) { flashLine(rect, Math.max(rect.w, 220) / 4.2, c, HOT[el] || "#fff"); return; }
    const cx = rect.x, cy = rect.y, R = Math.max(rect.w, rect.h) * .55;
    const n = move.kind === "wave" ? 3 : 2;
    for (let i = 0; i < n; i++) {
      add({ dur: 480, delay: i * 90, draw(k) {
        const r = R * (.2 + ease.out(k) * .85), w = 5 * (1 - ease.in(k));
        if (w <= .3) return;
        const p = new Path2D();
        for (let j = 0; j <= 72; j++) {
          const an = j / 72 * TAU, rr = r + (move.kind === "wave" ? Math.sin(an * 10 + k * 16) * 4 : 0);
          j ? p.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr * .62) : p.moveTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr * .62);
        }
        p.closePath();
        line(p, w, c, null, { shadow: false });
      } });
    }
  }

  /* ================= 7. 击倒：红色喷漆叉（和路线图上走过的节点打的红勾是一套） ================= */
  function ko(rect, opt) {
    if (!rect || !ensure()) return;
    opt = opt || {};
    const W = rect.w * .6, H = rect.h * .62, x0 = rect.x, y0 = rect.y + rect.h * .06;
    const strokes = [
      [[x0 - W / 2, y0 - H / 2], [x0 + W / 2, y0 + H / 2]],
      [[x0 + W / 2, y0 - H / 2 + 4], [x0 - W / 2, y0 + H / 2 - 2]]
    ];
    const drips = Array.from({ length: 3 }, (_, i) => ({ s: i % 2, t: [.62, .82, .9][i], len: rnd(12, 28), w: rnd(3.5, 5.5) }));
    const specks = makeSpecks(14, Math.max(W, H) * .6);
    const hold = Math.max(600, opt.hold || 1500);
    const sw = Math.max(11, Math.min(20, rect.w * .085));
    add({ dur: hold, draw(k) {
      const ms = k * hold;
      const out = ms > hold - 320 ? Math.max(0, (hold - ms) / 320) : 1;
      ctx.globalAlpha = out;
      strokes.forEach(([a, b], i) => {
        const p = clamp01((ms - i * 120) / 150);
        if (p <= 0) return;
        const e = ease.out(p), pts = [];
        for (let j = 0; j <= 14; j++) { const t = j / 14 * e; pts.push([lerp(a[0], b[0], t) + Math.sin(t * 9 + i * 2) * 2.2, lerp(a[1], b[1], t) + Math.cos(t * 7 + i) * 2.2]); }
        // 起笔重、收笔细：喷漆罐一下按到底再松开
        sticker(ribbon(pts, (u) => sw * (1.1 - u * .45) * Math.min(1, u * 6 + .35)), BLOOD, { ink: 3.5 });
        ctx.fillStyle = "#ff8a6e"; ctx.globalAlpha = .5 * out;
        ctx.fill(ribbon(pts.map(([x, y]) => [x - 1.5, y - 1.5]), (u) => sw * .22 * (1 - u * .5)));
        ctx.globalAlpha = out;
      });
      const dp = clamp01((ms - 280) / 600);
      if (dp > 0) for (const d of drips) {
        const [a, b] = strokes[d.s], x = lerp(a[0], b[0], d.t), y = lerp(a[1], b[1], d.t), len = d.len * ease.out(dp);
        sticker(ribbon([[x, y], [x, y + len]], (u) => d.w * (1 - u * .25)), BLOOD, { ink: 2.2, shadow: false });
        sticker(circlePath(x, y + len, d.w * .62), BLOOD, { ink: 2.2, shadow: false });
      }
      if (ms > 130) drawSpecks(x0, y0, specks, BLOOD, clamp01((ms - 130) / 700) * .5);
    } });
  }

  /* ================= 8. 格挡：兵刃相交 ================= */
  function clash(at) {
    if (!at || reduced() || !ensure()) return;
    const S = sizeOf(at);
    add({ dur: 300, draw(k) {
      const g = ease.out(clamp01(k / .3)), w = 5.5 * (1 - ease.in(clamp01((k - .4) / .6)));
      if (w <= .3) return;
      for (const s of [-1, 1]) line(polyline([[at.x - S * .6 * g, at.y + s * S * .42 * g], [at.x + S * .6 * g, at.y - s * S * .42 * g]]), w, "#f4f4f4", "#fff", { shadow: false });
    } });
    flashStar(at, S * .5, "#ffd23a", 230, true);
  }

  /* ================= 9. 瞄准线 / 敌人的攻击指向 ================= */
  /** 目标卡片的外框（to 的 y 是卡片高 42% 处，和弹字同一个点） */
  function boxOf(r) { const top = r.y - r.h * .42; return { l: r.x - r.w / 2, t: top, r: r.x + r.w / 2, b: top + r.h }; }
  /** 从卡片中心朝 dir 方向打到外框（再往外 pad）的那一点 */
  function boxEdge(r, dir, pad) {
    const b = boxOf(r), cx = (b.l + b.r) / 2, cy = (b.t + b.b) / 2, hw = (b.r - b.l) / 2 + pad, hh = (b.b - b.t) / 2 + pad;
    const tx = Math.abs(dir.x) > 1e-6 ? hw / Math.abs(dir.x) : Infinity, ty = Math.abs(dir.y) > 1e-6 ? hh / Math.abs(dir.y) : Infinity;
    const t = Math.min(tx, ty);
    return { x: cx + dir.x * t, y: cy + dir.y * t };
  }
  /**
   * 瞄准线 / 攻击指向：一条往上拱的虚线（墨线底 + 颜色，往前流动）从出手的人连到目标，末端一个箭头；
   * 目标卡片四角套上锁定框（一收一放）。opt.mark：出手的那一头再一圈往外扩的警示脉冲（敌人的攻击）
   */
  function guide(from, to, color, opt) {
    opt = opt || {};
    return add({ persist: true, dur: 1, draw(t) {
      const appear = Math.min(1, t / .14);
      ctx.globalAlpha = appear;
      const same = Math.hypot(to.x - from.x, to.y - from.y) < 2;
      const box = boxOf(to), gap = 7 + Math.sin(t * 6) * 2.5 + (1 - appear) * 14;
      if (!same) {
        const fc = { x: from.x, y: from.y }, tc = { x: (box.l + box.r) / 2, y: (box.t + box.b) / 2 };
        const dir = dirOf(fc, tc);
        const a = edgeToward(from, dir, 2), b = boxEdge(to, { x: -dir.x, y: -dir.y }, gap + 8);
        const lift = Math.min(70, Math.hypot(b.x - a.x, b.y - a.y) * .22) * (opt.bend || 1);
        const ctrl = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - lift };
        const path = new Path2D(); path.moveTo(a.x, a.y); path.quadraticCurveTo(ctrl.x, ctrl.y, b.x, b.y);
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(11,8,6,.62)"; ctx.lineWidth = 7.5; ctx.setLineDash([13, 9]); ctx.lineDashOffset = -t * 44; ctx.stroke(path);
        ctx.strokeStyle = color; ctx.lineWidth = 3.4; ctx.stroke(path);
        ctx.setLineDash([]);
        const end = Math.atan2(b.y - ctrl.y, b.x - ctrl.x), s = 13;
        const head = poly([[b.x + Math.cos(end) * 6, b.y + Math.sin(end) * 6], [b.x - Math.cos(end - .55) * s, b.y - Math.sin(end - .55) * s], [b.x - Math.cos(end + .55) * s, b.y - Math.sin(end + .55) * s]]);
        sticker(head, color, { ink: 3.2, shadow: false });
      }
      // 锁定框：卡片四角各一个 L 形的角，一收一放
      const L = Math.max(12, Math.min(26, (box.r - box.l) * .14));
      const corners = [[box.l - gap, box.t - gap, 1, 1], [box.r + gap, box.t - gap, -1, 1], [box.r + gap, box.b + gap, -1, -1], [box.l - gap, box.b + gap, 1, -1]];
      for (const [x, y, sx, sy] of corners) line(polyline([[x + sx * L, y], [x, y], [x, y + sy * L]]), 3.6, color, null, { shadow: false, cap: "square" });
      if (opt.mark && !same) {
        // 出手的那一头：一圈往外扩的警示脉冲
        const pr = (t * 1.3) % 1, rr = Math.max(22, Math.min(from.w, from.h) * .42) * (1 + pr * .55);
        ctx.globalAlpha = appear * (1 - pr);
        line(circlePath(from.x, from.y, rr), 3.2 * (1 - pr * .6), color, null, { shadow: false });
      }
    } });
  }
  function aim(from, to, opt) {
    clearAim();
    if (!from || !to || reduced()) return;
    opt = opt || {};
    aimFx = guide(from, to, opt.ally ? MINT : HOLO, { bend: 1 });
  }
  function clearAim() { if (aimFx) { remove(aimFx); aimFx = null; } }
  function threat(from, to) {
    clearThreat();
    if (!from || !to) return;
    threatFx = guide(from, to, BLOOD, { bend: 1, mark: true });
  }
  function clearThreat() { if (threatFx) { remove(threatFx); threatFx = null; } }

  function skip() { list = list.filter(e => e.persist); if (!list.length && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); }
  function setClock(fn) { clock = typeof fn === "function" ? fn : () => 1; }
  function busy() { return list.some(e => !e.persist); }

  const api = { resolve, windup, travel, link, impact, area, ko, clash, aim, clearAim, threat, clearThreat, skip, setClock, busy, after, KIND, COL };
  root.AttackFx = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
