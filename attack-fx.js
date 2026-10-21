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
  const fxRand = () => (typeof fxRandom === "function" ? fxRandom() : Math.random());   // 画面效果的随机数：不动战斗用的种子随机数（run.js · fxRandom）

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
    [/^veh_fire$/, "flame"],
    [/^veh_burn$/, "spread"],
    [/^veh_ram$/, "smash"],
    [/^veh_(board|pull|leave|cover)/, "none"],
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
  const INK_K = 0.55;          // 墨线描边的粗细倍率（作者要细一点；所有形状一起调）
  const TAU = Math.PI * 2;

  const hasDom = typeof document !== "undefined";
  let canvas = null, ctx = null, dpr = 1, raf = 0;
  let list = [];               // 正在播的效果
  let drawErrs = 0;            // 画的时候出错的次数（tests 看它是不是 0）
  let aimFx = null, threatFx = null;
  let clock = () => 1;         // 时间倍率：1 正常、0.5 两倍速、0 跳过
  const reduced = () => !!(hasDom && root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const now = () => (root.performance && performance.now ? performance.now() : Date.now());
  const rnd = (a, b) => a + fxRand() * (b - a);
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
      try { e.draw(e.persist ? (t - e.t0) / 1000 : clamp01(k), e); } catch (err) { drawErrs++; if (drawErrs <= 3 && root.console) console.warn("[attack-fx] draw", err); }   // 画坏一帧不影响战斗（测试会看 drawErrors）
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
    const ink = (opt.ink == null ? 4 : opt.ink) * INK_K;
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
    const iw = w + Math.min(5, w * 1.5) * INK_K;
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
    ctx.fillStyle = color; ctx.strokeStyle = INK; ctx.lineWidth = 1.2 * INK_K;
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
        ctx.strokeStyle = INK; ctx.lineWidth = 2.4 * INK_K; ctx.lineCap = "round";
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
    const dir = dirOf(a, b), bend = rnd(.08, .18) * dir.d * (fxRand() < .5 ? -1 : 1);
    const ctrl = { x: (a.x + b.x) / 2 - dir.y * bend, y: (a.y + b.y) / 2 + dir.x * bend };
    const at = (k) => { const u = 1 - k; return [u * u * a.x + 2 * u * k * ctrl.x + k * k * b.x, u * u * a.y + 2 * u * k * ctrl.y + k * k * b.y]; };
    const r = move.big || move.heavy ? 15 : 12;
    const sparks = [];
    add({ dur: ms, draw(k) {
      const e = k;
      if (fxRand() < .6) { const p = at(e); sparks.push({ x: p[0] + rnd(-6, 6), y: p[1] + rnd(-6, 6), t: e, s: rnd(3, 5.5) }); }
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
      if (fxRand() < .75) flakes.push({ x: x - dir.x * L * .5 + rnd(-5, 5), y: y - dir.y * L * .5 + rnd(-5, 5), t: k, s: rnd(2, 3.6) });
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
    const dir = dirOf(a, b), H = move.big ? Math.max(140, Math.min(260, dir.d * .7)) : Math.max(40, Math.min(105, dir.d * .3));
    const drops = [];
    const r = move.fur ? 13 : move.big ? 19 : 12;
    add({ dur: ms, draw(k) {
      const x = lerp(a.x, b.x, k), y = lerp(a.y, b.y, k) - 4 * H * k * (1 - k);
      if (!move.fur && fxRand() < .4) drops.push({ x: x + rnd(-3, 3), y, t: k, r: rnd(2.6, 4.4) });
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
  /** 电弧：从 a 到 b 的折线，中途分叉，闪几下（每下重新长一次）；旁边再跟一道细的。
   *  o：{ color 主色, color2 第二道的颜色（null 不画）, width 主线粗细, branch 分叉（默认有）} */
  function lightning(a, b, ms, el, o) {
    o = o || {};
    let shape = null, shape2 = null, seed = -1;
    const main = o.color || (el === "electric" || !COL[el] ? "#ffe23a" : COL[el]);
    const second = o.color2 === undefined ? "#7fd4ff" : o.color2, W = o.width || 6;
    add({ dur: ms, draw(k) {
      const flick = Math.floor(k * 5);
      if (flick !== seed) { seed = flick; shape = boltPts(a, b, o.branch === false ? 0 : 4, o.amp || 1); shape2 = second ? boltPts(a, b, 0, (o.amp || 1) * .7) : []; }
      if (k > .78 && flick % 2) return;   // 最后闪烁着熄掉
      // 主线后面一层柔光：细电光在浅色战场上也显眼
      ctx.save(); ctx.globalAlpha = .26; ctx.strokeStyle = main; ctx.lineWidth = W * 2.4 + 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.stroke(polyline(shape[0])); ctx.restore();
      shape2.forEach((pts) => line(polyline(pts), Math.max(1.4, W * .45), second, "#fff", { shadow: false }));
      shape.forEach((pts, i) => line(polyline(pts), i ? W * .5 : W, main, "#fff", { shadow: i > 0 ? false : undefined }));
    } });
  }
  function boltPts(a, b, depth, ampK) {
    const dir = dirOf(a, b), n = Math.max(5, Math.round(dir.d / 30)), amp = Math.min(28, dir.d * .1) * (ampK || 1);
    const pts = [[a.x, a.y]];
    let off = 0, t = 0;
    for (let i = 1; i < n; i++) {
      t += (1 / n) * rnd(.6, 1.4); if (t >= .97) break;
      off = Math.max(-amp, Math.min(amp, off * .3 + rnd(-1, 1) * amp * (fxRand() < .25 ? 1.6 : .9)));
      pts.push([lerp(a.x, b.x, t) - dir.y * off, lerp(a.y, b.y, t) + dir.x * off]);
    }
    pts.push([b.x, b.y]);
    const out = [pts];
    if (depth > 0 && n > 3) {
      for (let f = 0; f < 2; f++) {
        const k = 1 + Math.floor(fxRand() * (n - 2)), [sx, sy] = pts[k];
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
    const dur = move.slow ? 560 : katana ? 300 : 340, cut = move.slow ? .45 : .3;
    add({ dur, draw(k) {
      const draw = clamp01(k / cut), fade = clamp01((k - cut) / (1 - cut));
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
        ctx.strokeStyle = INK; ctx.lineWidth = 2.4 * INK_K; ctx.lineCap = "round";
        for (let j = 0; j < 3; j++) {
          const off = (j - 1) * 8, bx = hp[0] - Math.cos(ang) * (16 + j * 6) - Math.sin(ang) * off, by = hp[1] - Math.sin(ang) * (16 + j * 6) + Math.cos(ang) * off;
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - Math.cos(ang) * 22, by - Math.sin(ang) * 22); ctx.stroke();
        }
      }
      if (fade > 0) { const m = P(.5); drawSpecks(m[0], m[1], specks, c, fade); }
    } });
    if (move.flash && n === 0) flashLine(at, S, c, hot);
  }
  /** 横贯整区的一刀（绯秋一闪）：又亮又锋利的刀光从一头拉到另一头，中间最粗、两头尖，外面一层柔光，再变细收掉 */
  function zoneCut(row, c, hot) {
    if (!row || !ensure()) return;
    const L = Math.max(row.w, 220), x0 = row.x - L / 2;
    add({ dur: 560, draw(k) {
      const grow = ease.out(clamp01(k / .16)), thin = 1 - ease.in(clamp01((k - .24) / .76));
      if (thin <= .02) return;
      ctx.translate(row.x, row.y); ctx.rotate(-.05); ctx.translate(-row.x, -row.y);
      const pts = []; for (let i = 0; i <= 24; i++) pts.push([x0 + L * grow * i / 24, row.y]);
      ctx.globalAlpha = .22 * thin; ctx.fillStyle = c; ctx.fill(ribbon(pts, (u) => 30 * Math.sin(Math.PI * u))); ctx.globalAlpha = 1;
      sticker(ribbon(pts, (u) => 16 * thin * Math.pow(Math.sin(Math.PI * u), .6)), c, { ink: 3 });
      ctx.fillStyle = hot || "#fff"; ctx.fill(ribbon(pts, (u) => 6.5 * thin * Math.pow(Math.sin(Math.PI * u), .6)));
    } });
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
      ctx.strokeStyle = INK; ctx.lineWidth = 2.4 * INK_K; ctx.lineCap = "round";
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
        ctx.lineWidth = (heavy ? 4 : 3) * .8;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(ray.a) * r1, cy + Math.sin(ray.a) * r1); ctx.lineTo(cx + Math.cos(ray.a) * r2, cy + Math.sin(ray.a) * r2); ctx.stroke();
      }
      sticker(poly(starPts(cx, cy, pts, r, r * .52, rot, jit)), c, { ink: 4.5 });
      ctx.fillStyle = hot; ctx.fill(poly(starPts(cx, cy, pts, r * .56, r * .3, rot + .2, jit)));
      if (move.drill) {
        // 电钻：中间一圈转着的螺旋
        ctx.strokeStyle = INK; ctx.lineWidth = 3.4 * INK_K;
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
  /** 画在当前这一帧里的一团光（不单独加效果）：外圈属性色的光晕、中间一颗贴纸圆、圆心发白（聚能最后那一闪） */
  function flashBody(at, R, color, hot, alpha) {
    if (!(R > .5) || !(alpha > 0)) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, R * 1.6);
    g.addColorStop(0, hot || "#fff"); g.addColorStop(.35, color); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(at.x, at.y, R * 1.6, 0, TAU); ctx.fill();
    sticker(circlePath(at.x, at.y, R * .55), color, { ink: 2.4, shadow: false });
    ctx.fillStyle = hot || "#fff"; ctx.beginPath(); ctx.arc(at.x, at.y, R * .28, 0, TAU); ctx.fill();
    ctx.restore();
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
    const blocks = glitch ? Array.from({ length: 8 }, () => ({ x: rnd(-.7, .5) * S, y: rnd(-.5, .4) * S, w: rnd(8, 26), h: rnd(3, 8), c: fxRand() < .5 ? "#ff3b6e" : HOLO })) : null;
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
        for (const b of blocks) { if (fxRand() < .35) continue; ctx.fillStyle = b.c; ctx.fillRect(at.x + b.x + rnd(-4, 4), at.y + b.y, b.w, b.h); }
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
  function koState(rect) {
    const W = rect.w * .6, H = rect.h * .62, x0 = rect.x, y0 = rect.y + rect.h * .06;
    return {
      x0, y0,
      strokes: [
        [[x0 - W / 2, y0 - H / 2], [x0 + W / 2, y0 + H / 2]],
        [[x0 + W / 2, y0 - H / 2 + 4], [x0 - W / 2, y0 + H / 2 - 2]]
      ],
      drips: Array.from({ length: 3 }, (_, i) => ({ s: i % 2, t: [.62, .82, .9][i], len: rnd(12, 28), w: rnd(3.5, 5.5) })),
      specks: makeSpecks(14, Math.max(W, H) * .6),
      sw: Math.max(11, Math.min(20, rect.w * .085))
    };
  }
  /** 画红叉：ms 是开始后多少毫秒（笔画、往下淌的漆按它走），out 是整体的不透明度 */
  function koDraw(st, ms, out) {
    ctx.globalAlpha = out;
    st.strokes.forEach(([a, b], i) => {
      const p = clamp01((ms - i * 120) / 150);
      if (p <= 0) return;
      const e = ease.out(p), pts = [];
      for (let j = 0; j <= 14; j++) { const t = j / 14 * e; pts.push([lerp(a[0], b[0], t) + Math.sin(t * 9 + i * 2) * 2.2, lerp(a[1], b[1], t) + Math.cos(t * 7 + i) * 2.2]); }
      // 起笔重、收笔细：喷漆罐一下按到底再松开
      sticker(ribbon(pts, (u) => st.sw * (1.1 - u * .45) * Math.min(1, u * 6 + .35)), BLOOD, { ink: 3.5 });
      ctx.fillStyle = "#ff8a6e"; ctx.globalAlpha = .5 * out;
      ctx.fill(ribbon(pts.map(([x, y]) => [x - 1.5, y - 1.5]), (u) => st.sw * .22 * (1 - u * .5)));
      ctx.globalAlpha = out;
    });
    const dp = clamp01((ms - 280) / 600);
    if (dp > 0) for (const d of st.drips) {
      const [a, b] = st.strokes[d.s], x = lerp(a[0], b[0], d.t), y = lerp(a[1], b[1], d.t), len = d.len * ease.out(dp);
      sticker(ribbon([[x, y], [x, y + len]], (u) => d.w * (1 - u * .25)), BLOOD, { ink: 2.2, shadow: false });
      sticker(circlePath(x, y + len, d.w * .62), BLOOD, { ink: 2.2, shadow: false });
    }
    if (ms > 130) drawSpecks(st.x0, st.y0, st.specks, BLOOD, clamp01((ms - 130) / 700) * .5);
  }
  /**
   * 击倒红叉。opt.hold：停多久（毫秒）；"manual" 时一直留着，返回 { release(fade, delay) } 由调用方收。
   * opt.track：返回卡片现在位置的函数——镜头推近 / 拉回、卡片重排时红叉跟着卡走
   */
  function ko(rect, opt) {
    if (!rect || !ensure()) return null;
    opt = opt || {};
    if (opt.hold === "manual") return koManual(rect, opt.track);
    const st = koState(rect), hold = Math.max(600, opt.hold || 1500), last = {};
    add({ dur: hold, draw(k) {
      const ms = k * hold;
      follow(rect, opt.track, last);
      koDraw(st, ms, ms > hold - 320 ? Math.max(0, (hold - ms) / 320) : 1);
    } });
    return null;
  }
  /** 把画布挪到卡片现在的位置（按画红叉那一刻的位置和大小换算）；卡片已经不在了就停在最后看到的地方 */
  function follow(rect, track, last) {
    const cur = track ? track() : null;
    if (cur && cur.w > 0) last.r = cur;
    const r = last.r;
    if (!r || !rect.w) return;
    const k = r.w / rect.w;
    ctx.translate(r.x - rect.x * k, r.y - rect.y * k);
    ctx.scale(k, k);
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
        ctx.strokeStyle = "rgba(11,8,6,.55)"; ctx.lineWidth = 5.4; ctx.setLineDash([13, 9]); ctx.lineDashOffset = -t * 44; ctx.stroke(path);
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

  /* ================= 10. 技能专属的演出（作者的《动画效果》表） =================
   * 下面先是给技能脚本用的小件（激光、剑气、冰球、咖啡杯、管道、能量罐……），画法和上面一样；
   * 再是脚本表 SCRIPTS：每个技能写清楚「出手怎么演、每一段打中怎么演」。
   * 脚本由宿主（game.js 的战斗画面、online-ui.js 的联机玩家画面）提供一个 c（现场）：
   *   c.actor / c.target / c.mains（主攻击的伤害弹字，按顺序）/ c.targets（这次碰到的单位，按顺序）/ c.data（模式、刺入、能量……）
   *   c.rect(id) · c.zoneRect(id) · c.wait(ms) · c.dash(id, rect, o) · c.recoil(id, rect, px) · c.nudge(id, dx, dy, ms)
   *   c.shake(power) · c.zoom(rect) · c.unzoom() · c.cls(id, className, ms) · c.burst(element, rect) · c.owner(id)
   * 一个脚本可以有：pre(c)（出手，打中第一下之前结束）· again(c, e, i)（第 2 段起每段打中前）·
   *   impact(c, e, i, big)（每段打中的形状）· post(c)（全部演完之后）· self(c)（不打人的技能演在自己身上）·
   *   instant（几段伤害一起结算，不一段段跳）· zoom（镜头推近）。没写的部分照通用的招式演。 */

  /** 激光：一道直直的光束（瑞比、拉斯缪尔的普攻是青色；细的、短促的用 width / ms 调） */
  function laser(a, b, o) {
    o = o || {};
    if (!a || !b || reduced() || !ensure()) return Promise.resolve();
    const c = o.color || COL.energy, hot = o.hot || "#eafffa", W = o.width || 9, ms = o.ms || 240;
    add({ dur: ms, delay: o.delay || 0, draw(k) {
      const w = W * Math.pow(Math.sin(Math.PI * Math.min(1, k * 1.15)), .55) * (1 + Math.sin(k * 80) * .08);
      if (w <= .4) return;
      line(polyline([[a.x, a.y], [b.x, b.y]]), w, c, hot, { shadow: false });
      sticker(circlePath(b.x, b.y, w * 1.25), c, { ink: 2.5, shadow: false });
      ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(b.x, b.y, w * .7, 0, TAU); ctx.fill();
    } });
    return after((o.delay || 0) + ms * .3);
  }
  /** 光点：一颗小亮点带一小截尾巴，飞得很快（瑞比的扳机） */
  function dot(a, b, color, ms) {
    if (!a || !b || reduced() || !ensure()) return Promise.resolve();
    ms = ms || 150;
    add({ dur: ms, draw(k) {
      const e = ease.in(k) * .5 + k * .5, x = lerp(a.x, b.x, e), y = lerp(a.y, b.y, e), t0 = Math.max(0, e - .14);
      line(polyline([[lerp(a.x, b.x, t0), lerp(a.y, b.y, t0)], [x, y]]), 3, color, "#fff", { shadow: false });
      sticker(circlePath(x, y, 6), color, { ink: 2.4, shadow: false });
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, TAU); ctx.fill();
    } });
    return after(ms);
  }
  /** 一颗弹：冰球（结人、诺拉）、酸液子弹（意式浓缩）、能量炮（银翼）。kind：ice / acid / cannon */
  function orb(a, b, o) {
    o = o || {};
    if (!a || !b || reduced() || !ensure()) return Promise.resolve();
    const kind = o.kind || "ice", dir = dirOf(a, b), k0 = o.scale || 1;
    const r = (kind === "cannon" ? 15 : kind === "acid" ? 9 : 10) * k0;
    const c = kind === "ice" ? "#cdeefa" : kind === "acid" ? COL.acid : COL.energy;
    const ms = o.ms || Math.max(120, Math.min(300, dir.d / (kind === "cannon" ? 1.05 : 1.6)));
    const trail = [];
    add({ dur: ms, draw(k) {
      const x = lerp(a.x, b.x, k), y = lerp(a.y, b.y, k);
      if (!trail.length || Math.hypot(x - trail[trail.length - 1].x, y - trail[trail.length - 1].y) > 7) trail.push({ x, y, t: k });
      for (const p of trail) {
        const age = (k - p.t) * (kind === "cannon" ? 3.2 : 4.5); if (age >= 1) continue;
        const rr = r * (kind === "cannon" ? .8 : .55) * (1 - age);
        if (kind === "ice") { ctx.fillStyle = "#ffffff"; ctx.globalAlpha = 1 - age; ctx.beginPath(); ctx.arc(p.x + rnd(-2, 2), p.y + rnd(-2, 2), rr * .45, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
        else sticker(circlePath(p.x, p.y, rr), c, { ink: 1.6, shadow: false });
      }
      sticker(circlePath(x, y, r), c, { ink: 3 });
      if (kind === "ice") {
        // 冰球：里面一个小雪花
        ctx.strokeStyle = "#5fa9d6"; ctx.lineWidth = 1.4;
        for (let i = 0; i < 3; i++) { const an = i * Math.PI / 3 + k * 6; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * r * .6, y + Math.sin(an) * r * .6); ctx.lineTo(x - Math.cos(an) * r * .6, y - Math.sin(an) * r * .6); ctx.stroke(); }
      }
      if (kind === "cannon") { ctx.strokeStyle = COL.energy; ctx.lineWidth = 2.4; ctx.globalAlpha = .8; ctx.beginPath(); ctx.arc(x, y, r * (1.35 + Math.sin(k * 30) * .12), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x - r * .3, y - r * .3, r * .32, 0, TAU); ctx.fill();
    } });
    return after(ms);
  }
  /** 剑气：一道月牙形的刀光飞出去。o.slowFast：先慢后极快（鳴門寒风）；o.big：大剑气（灯声波切割） */
  function swordWave(a, b, o) {
    o = o || {};
    if (!a || !b || reduced() || !ensure()) return Promise.resolve();
    const c = o.color || COL.ice, hot = o.hot || "#ffffff", dir = dirOf(a, b);
    const R = o.big ? 46 : 32, T = o.big ? 17 : 12;
    const ms = o.ms || Math.max(200, Math.min(400, dir.d / (o.slowFast ? .8 : 1.15)));
    add({ dur: ms, draw(k) {
      const e = o.slowFast ? (k < .5 ? k * .22 / .5 : .22 + ease.in((k - .5) / .5) * .78) : ease.inOut(k) * .3 + k * .7;
      const x = lerp(a.x, b.x, e), y = lerp(a.y, b.y, e), grow = .7 + .3 * Math.min(1, k * 3);
      const pts = [];
      for (let i = 0; i <= 22; i++) { const an = dir.ang + (i / 22 - .5) * 2.3; pts.push([x - dir.x * R * .55 + Math.cos(an) * R * grow, y - dir.y * R * .55 + Math.sin(an) * R * grow]); }
      // 身后几道速度线
      ctx.strokeStyle = c; ctx.lineCap = "round";
      for (let j = -1; j <= 1; j++) {
        ctx.globalAlpha = .55; ctx.lineWidth = 2.2;
        const ox = -dir.y * j * R * .45, oy = dir.x * j * R * .45;
        ctx.beginPath(); ctx.moveTo(x - dir.x * R * .5 + ox, y - dir.y * R * .5 + oy); ctx.lineTo(x - dir.x * (R * .5 + 34) + ox, y - dir.y * (R * .5 + 34) + oy); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      sticker(ribbon(pts, (u) => T * grow * Math.pow(Math.sin(Math.PI * u), .7)), c, { ink: 3 });
      ctx.fillStyle = hot; ctx.fill(ribbon(pts.map(([px, py]) => [px + dir.x * T * .2, py + dir.y * T * .2]), (u) => T * .38 * grow * Math.sin(Math.PI * u)));
    } });
    return after(ms);
  }
  /** 鞭子：一道粗鞭甩出去抽到目标，再收回来（川川电能鞭：青绿色） */
  function whip(a, b, color, ms) {
    if (!a || !b || reduced() || !ensure()) return Promise.resolve();
    ms = ms || 300;
    const dir = dirOf(a, b), bend = Math.min(70, dir.d * .28), nx = -dir.y, ny = dir.x;
    add({ dur: ms, draw(k) {
      const out = k < .42 ? ease.out(k / .42) : 1 - ease.in((k - .42) / .58);
      if (out <= .02) return;
      const pts = [];
      for (let i = 0; i <= 26; i++) {
        const t = i / 26 * out;
        const wave = Math.sin(t * Math.PI) * bend * (k < .42 ? 1 - k : .4) + Math.sin(t * 10 - k * 16) * 5 * t;
        pts.push([lerp(a.x, b.x, t) + nx * wave, lerp(a.y, b.y, t) + ny * wave]);
      }
      sticker(ribbon(pts, (u) => 15 * (1 - u * .55)), color, { ink: 3.2, shadow: false });   // 粗鞭子：根部粗、梢细
      ctx.fillStyle = "#eafff8"; ctx.fill(ribbon(pts, (u) => 4.6 * (1 - u * .55)));
    } });
    return after(ms * .42);
  }
  /** 单位身上一圈噼啪的小电弧（川川电站超频） */
  function crackle(rect, color, ms) {
    if (!rect || reduced() || !ensure()) return;
    ms = ms || 520;
    let arcs = [], seed = -1;
    add({ dur: ms, draw(k) {
      const f = Math.floor(k * 9);
      if (f !== seed) {
        seed = f; arcs = [];
        for (let i = 0; i < 4; i++) {
          const a0 = rnd(0, TAU), a1 = a0 + rnd(.6, 1.4), R = Math.min(rect.w, rect.h) * rnd(.45, .62);
          arcs.push(boltPts({ x: rect.x + Math.cos(a0) * R * 1.3, y: rect.y + Math.sin(a0) * R }, { x: rect.x + Math.cos(a1) * R * 1.3, y: rect.y + Math.sin(a1) * R }, 0, .6)[0]);
        }
      }
      if (k > .8 && f % 2) return;
      arcs.forEach(pts => line(polyline(pts), 2.6, color || "#ffe23a", "#fff", { shadow: false }));
    } });
  }
  /** 能量往身上聚：一圈光点从外面收进来，最后一闪（川川高能脉冲：青色） */
  function gather(rect, color, ms) {
    if (!rect || reduced() || !ensure()) return Promise.resolve();
    ms = ms || 560;
    const motes = Array.from({ length: 16 }, () => ({ a: rnd(0, TAU), d: rnd(.9, 1.5), s: rnd(2.5, 4.5), lag: rnd(0, .3) }));
    const R = Math.max(rect.w, rect.h) * .62;
    add({ dur: ms, draw(k) {
      for (const m of motes) {
        const t = clamp01((k - m.lag) / (1 - m.lag)); if (t <= 0 || t >= 1) continue;
        const d = R * m.d * (1 - ease.in(t)), x = rect.x + Math.cos(m.a + t * 1.2) * d, y = rect.y + Math.sin(m.a + t * 1.2) * d * .75;
        sticker(circlePath(x, y, m.s * (1 - t * .4)), color, { ink: 1.6, shadow: false });
      }
      if (k > .78) flashBody(rect, Math.min(rect.w, rect.h) * .32 * ease.out((k - .78) / .22), color, "#fff", 1 - (k - .78) / .22);
    } });
    return after(ms * .8);
  }
  /** 飘字：从卡片头上冒出来、往上飘一点再淡出（「+1AP」「汲取」） */
  function floatText(rect, text, color, o) {
    if (!rect || !ensure()) return;
    o = o || {};
    const size = o.size || 22, ms = o.ms || 1000;
    add({ dur: ms, draw(k) {
      const y = rect.y - rect.h * .42 - 6 - ease.out(k) * 26, a = k < .7 ? 1 : 1 - (k - .7) / .3;
      const g = k < .18 ? ease.back(k / .18) : 1;
      ctx.globalAlpha = a; ctx.translate(rect.x, y); ctx.scale(g, g);
      ctx.font = `900 ${size}px "Noto Sans SC", "Microsoft YaHei", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineJoin = "round"; ctx.lineWidth = 5 * INK_K + 2; ctx.strokeStyle = INK; ctx.strokeText(text, 0, 0);
      ctx.fillStyle = color; ctx.fillText(text, 0, 0);
    } });
  }
  /** 破译代码：卡上一块半透明黑底，一行行白色等宽字往外蹦，1 秒内没掉（瑞比算法改变） */
  function codeRain(rect, ms) {
    if (!rect || !ensure()) return;
    ms = ms || 950;
    const hex = () => Math.floor(fxRand() * 0xffff).toString(16).padStart(4, "0");
    const lines = Array.from({ length: 6 }, (_, i) => [
      "> decrypt 0x" + hex() + hex(), "mov eax, 0x" + hex(), "patch sig " + hex() + ":" + hex(), "push " + hex() + " ; spread", "jmp 0x" + hex() + "  [ok]", "> diffuse --rate " + (20 + i * 7) + "%"
    ][i]);
    const top = rect.y - rect.h * .42 + 8, left = rect.x - rect.w / 2 + 8, W = rect.w - 16;
    add({ dur: ms, draw(k) {
      const a = k < .8 ? 1 : 1 - (k - .8) / .2;
      ctx.globalAlpha = .72 * a; ctx.fillStyle = "#0b0806"; ctx.fillRect(left - 4, top - 4, W + 8, Math.min(rect.h * .7, 6 * 13 + 8));
      ctx.globalAlpha = a; ctx.font = `600 10.5px Consolas, "Courier New", monospace`; ctx.textAlign = "left"; ctx.textBaseline = "top";
      const shown = Math.min(lines.length, Math.floor(k * 12) + 1);
      for (let i = 0; i < shown; i++) {
        const txt = lines[i].slice(0, Math.max(0, Math.floor((k * 12 - i) * 9)));
        ctx.fillStyle = i === shown - 1 ? "#ffffff" : "#d8e2dc";
        ctx.fillText(txt + (i === shown - 1 && Math.floor(k * 16) % 2 ? "_" : ""), left, top + i * 13, W);
      }
    } });
  }
  /** 小无人机：从出手的人身边飞出去、在旁边悬停一下（瑞比收发代理） */
  function drone(rect, ms) {
    if (!rect || reduced() || !ensure()) return;
    ms = ms || 1200;
    const sx = rect.x + rect.w * .3, sy = rect.y, ex = rect.x + rect.w * .62, ey = rect.y - rect.h * .55;
    add({ dur: ms, draw(k) {
      const t = ease.out(clamp01(k / .45)), bob = Math.sin(k * 24) * 2, a = k < .8 ? 1 : 1 - (k - .8) / .2;
      const x = lerp(sx, ex, t), y = lerp(sy, ey, t) + bob;
      ctx.globalAlpha = a; ctx.translate(x, y); ctx.rotate(Math.sin(k * 10) * .08); ctx.scale(1.4, 1.4);
      for (const s of [-1, 1]) {   // 两个旋翼
        ctx.save(); ctx.translate(s * 15, -7); ctx.scale(1, .3);
        sticker(circlePath(0, 0, 9 + Math.sin(k * 90 + s) * 1.5), "#d8e2dc", { ink: 2, shadow: false }); ctx.restore();
      }
      const body = new Path2D(); body.roundRect ? body.roundRect(-13, -6, 26, 13, 5) : body.rect(-13, -6, 26, 13);
      sticker(body, "#3a4148", { ink: 2.6 });
      ctx.fillStyle = Math.floor(k * 10) % 2 ? COL.energy : "#ffffff"; ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
    } });
  }
  /** 咖啡杯：一个纸杯抛物线丢到那一区，落地的那一刻结束（结人酸萃 / 冷萃） */
  function cup(a, z, ms) {
    if (!a || !z || reduced() || !ensure()) return Promise.resolve();
    const b = { x: z.x, y: z.y + z.h * .12 }, dir = dirOf(a, b), H = Math.max(60, Math.min(140, dir.d * .4));
    ms = ms || Math.max(320, Math.min(520, dir.d / 1.1));
    add({ dur: ms, draw(k) {
      const x = lerp(a.x, b.x, k), y = lerp(a.y, b.y, k) - 4 * H * k * (1 - k);
      ctx.translate(x, y); ctx.rotate(k * 7);
      sticker(poly([[-9, -12], [9, -12], [7, 12], [-7, 12]]), "#f4ede0", { ink: 2.6 });   // 杯身
      ctx.fillStyle = "#8a5a3a"; ctx.fill(poly([[-8.4, -3], [8.4, -3], [7.6, 5], [-7.6, 5]]));   // 杯套
      sticker(poly([[-11, -15], [11, -15], [10, -11], [-10, -11]]), "#ffffff", { ink: 2.2, shadow: false });   // 杯盖
    } });
    return after(ms);
  }
  /** 地上一圈圈涟漪往外扩（酸萃：浅绿色） */
  function ripples(rect, color, n) {
    if (!rect || reduced() || !ensure()) return;
    n = n || 3;
    const R = Math.max(rect.w, 160) * .55, cy = rect.y + rect.h * .12;
    for (let i = 0; i < n; i++) {
      add({ dur: 760, delay: i * 140, draw(k) {
        const r = R * (.1 + ease.out(k) * .95), w = 4.5 * (1 - ease.in(k));
        if (w <= .3) return;
        ctx.globalAlpha = .9;
        const p = new Path2D(); p.ellipse(rect.x, cy, r, r * .36, 0, 0, TAU);
        line(p, w, color, null, { shadow: false });
        ctx.globalAlpha = .12 * (1 - k); ctx.fillStyle = color; ctx.fill(p);
      } });
    }
  }
  /** 冰块从中间往外一下子冒满整区（冷萃）；soft：碎冰（冰美式打敌人，浅蓝色碎冰往外散） */
  function iceBloom(rect, soft) {
    if (!rect || reduced() || !ensure()) return;
    const W = Math.max(rect.w, 160), H = Math.max(rect.h, 120);
    const bits = Array.from({ length: soft ? 22 : 24 }, () => ({ x: rnd(-.45, .45) * W, y: rnd(-.35, .4) * H, s: rnd(.7, 1.35), r: rnd(-.5, .5) }));
    bits.forEach(b => { b.d = Math.hypot(b.x / W, b.y / H); });
    add({ dur: soft ? 620 : 900, draw(k) {
      for (const b of bits) {
        const t = clamp01((k - b.d * .5) / .3), out = 1 - ease.in(clamp01((k - .62) / .38));
        if (t <= 0 || out <= .03) continue;
        const g = ease.back(t) * out * b.s;
        ctx.save(); ctx.translate(rect.x + b.x, rect.y + b.y + (soft ? k * k * 16 : 0)); ctx.rotate(b.r + (soft ? k * 3 : 0));
        if (soft) sticker(poly([[8 * g, 0], [0, -4 * g], [-6 * g, 0], [0, 4 * g]]), "#bfe6f7", { ink: 2, shadow: false });
        else {
          sticker(poly([[0, -15 * g], [9 * g, -6 * g], [9 * g, 7 * g], [0, 13 * g], [-9 * g, 7 * g], [-9 * g, -6 * g]]), "#cdeefa", { ink: 2.6 });
          ctx.fillStyle = "#ffffff"; ctx.fill(poly([[0, -12 * g], [4 * g, -6 * g], [0, 0], [-4 * g, -6 * g]]));
        }
        ctx.restore();
      }
    } });
  }
  /** 雾气：一团团软软的浅色雾往上飘，夹几颗亮点（冰美式治疗：浅蓝色） */
  function mist(rect, color, ms) {
    if (!rect || reduced() || !ensure()) return;
    ms = ms || 900;
    const puffs = Array.from({ length: 10 }, (_, i) => ({ x: rnd(-.4, .4) * rect.w, y: rnd(-.1, .3) * rect.h, r: rnd(14, 26), lag: i * .04 }));
    add({ dur: ms, draw(k) {
      for (const p of puffs) {
        const t = clamp01((k - p.lag) / (1 - p.lag)); if (t <= 0) continue;
        ctx.globalAlpha = .58 * Math.sin(Math.PI * t);
        const g = ctx.createRadialGradient(rect.x + p.x, rect.y + p.y - t * 28, 0, rect.x + p.x, rect.y + p.y - t * 28, p.r * (1 + t * .5));
        g.addColorStop(0, color); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(rect.x + p.x, rect.y + p.y - t * 28, p.r * (1 + t * .5), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 4; i++) {
        const t = clamp01((k - i * .12) / .7); if (t <= 0 || t >= 1) continue;
        const s = 5 * Math.sin(Math.PI * t), x = rect.x + (i - 1.5) * rect.w * .2, y = rect.y + rect.h * .1 - t * 40;
        sticker(poly(starPts(x, y, 4, s, s * .35, 0, null)), "#ffffff", { ink: 1.4, shadow: false });
      }
    } });
  }
  /** 管道：诺拉的针和目标之间一根细管，里面一团模糊的能量冲过去（pulses 段，连续灌入）；结束在打到的那一刻 */
  function tube(a, b, color, pulses, ms) {
    if (!a || !b || reduced() || !ensure()) return Promise.resolve();
    pulses = pulses || 1; ms = ms || 300;
    const dir = dirOf(a, b), sag = Math.min(40, dir.d * .12);
    const at = (t) => [lerp(a.x, b.x, t), lerp(a.y, b.y, t) + Math.sin(Math.PI * t) * sag];
    const total = ms + (pulses - 1) * ms * .45;
    add({ dur: total + 220, draw(k) {
      const ms0 = k * (total + 220), fade = ms0 > total ? 1 - (ms0 - total) / 220 : 1;
      const pts = []; for (let i = 0; i <= 24; i++) pts.push(at(i / 24));
      ctx.globalAlpha = .9 * fade;
      line(polyline(pts), 3.2, "#e9eef2", null, { shadow: false });
      ctx.strokeStyle = "rgba(159,179,194,.9)"; ctx.lineWidth = 1; ctx.stroke(polyline(pts));
      const glow = /^#f{3,6}$/i.test(color) ? "#a8dcff" : color;   // 白光的柔光带一点浅蓝，浅色地上才看得出
      for (let p = 0; p < pulses; p++) {
        const t = clamp01((ms0 - p * ms * .45) / ms); if (t <= 0 || t >= 1) continue;
        const e = ease.in(t) * .4 + t * .6, [x, y] = at(e), ang = Math.atan2(dir.y, dir.x), R = 24;
        const g = ctx.createRadialGradient(x, y, 0, x, y, R);
        g.addColorStop(0, "#ffffff"); g.addColorStop(.4, glow); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.globalAlpha = .8 * fade; ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, R * 1.4, R * .9, ang, 0, TAU); ctx.fill();
        for (let j = 3; j >= 1; j--) {   // 拖尾：后面几颗越来越小
          const [tx, ty] = at(Math.max(0, e - j * .035));
          ctx.globalAlpha = fade * (1 - j * .22); sticker(circlePath(tx, ty, 7 - j * 1.4), color, { ink: 1.8, shadow: false });
        }
        ctx.globalAlpha = fade;
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        const blob = new Path2D(); blob.ellipse(0, 0, 11, 7.5, 0, 0, TAU);
        sticker(blob, color, { ink: 2.4, shadow: false });
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.ellipse(2, -1.5, 4.5, 3, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    } });
    return after(ms);
  }
  /** 磁力：一组紫色弧往推 / 拉的方向走（哔哩哩磁力移动）。dir：{x, y} 单位向量 */
  function magnet(rect, dir, color) {
    if (!rect || !dir || reduced() || !ensure()) return;
    const ang = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < 3; i++) {
      add({ dur: 460, delay: i * 70, draw(k) {
        const R = 26 + i * 10, off = (k - .3) * 60, w = 4.5 * (1 - ease.in(k));
        if (w <= .3) return;
        const cx = rect.x + Math.cos(ang) * off, cy = rect.y + Math.sin(ang) * off;
        const pts = []; for (let j = 0; j <= 16; j++) { const an = ang + (j / 16 - .5) * 1.8; pts.push([cx + Math.cos(an) * R - Math.cos(ang) * R, cy + Math.sin(an) * R - Math.sin(ang) * R]); }
        sticker(ribbon(pts, (u) => w * Math.sin(Math.PI * u) * 1.6), color, { ink: 2.2, shadow: false });
      } });
    }
  }
  /** 强光：一大团光晕罩住整片区域，撑开再收掉（EDC 爆闪：黄色） */
  function halo(rect, color, ms) {
    if (!rect || reduced() || !ensure()) return;
    ms = ms || 520;
    const R = Math.max(rect.w, rect.h) * .62;
    add({ dur: ms, draw(k) {
      const g0 = ease.out(clamp01(k / .35)), a = k < .4 ? 1 : 1 - (k - .4) / .6;
      const g = ctx.createRadialGradient(rect.x, rect.y, 0, rect.x, rect.y, R * g0);
      g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(.35, color); g.addColorStop(1, "rgba(255,226,58,0)");
      ctx.globalAlpha = .75 * a; ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(rect.x, rect.y, R * g0, R * g0 * .7, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = a; line(circlePath(rect.x, rect.y, R * .5 * g0), 3 * (1 - k), color, null, { shadow: false });
    } });
  }
  /**
   * 能量罐（拉斯缪尔）：卡片左边一个竖着的罐子，青色液体带波浪液面，水位 = 累积能量（刻度每 20%）。
   * 颜色和角色仪表一样：80% 起琥珀色、超过 100% 红色。水位从 from 慢慢走到 to，停一会儿再淡出。
   */
  function tank(rect, from, to, o) {
    if (!rect || !ensure()) return Promise.resolve();
    o = o || {};
    const ms = o.ms || 900, hold = o.hold || 700;
    const W = 22, H = Math.max(60, Math.min(96, rect.h * .7)), x = rect.x - rect.w / 2 - W - 10, y = rect.y - rect.h * .42 + (rect.h - H) / 2;
    const colOf = (p) => p > 100 ? "#ff5a3c" : p >= 80 ? "#ffb02e" : "#5fe1ff";
    add({ dur: ms + hold + 400, draw(k) {
      const t = k * (ms + hold + 400);
      const lv = lerp(from, to, ease.inOut(clamp01(t / ms)));
      const a = t < 160 ? t / 160 : t > ms + hold ? 1 - (t - ms - hold) / 400 : 1;
      ctx.globalAlpha = Math.max(0, a);
      const body = new Path2D(); body.roundRect ? body.roundRect(x, y, W, H, 7) : body.rect(x, y, W, H);
      sticker(body, "#1a1511", { ink: 3 });
      ctx.save(); ctx.clip(body);
      const fill = clamp01(lv / 100), top = y + H - H * fill, c = colOf(lv);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.moveTo(x, y + H);
      for (let i = 0; i <= 10; i++) ctx.lineTo(x + i / 10 * W, top + Math.sin(i / 10 * TAU + t / 120) * 2);
      ctx.lineTo(x + W, y + H); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(x + 3, top + 2, 3, Math.max(0, H * fill - 4));
      ctx.restore();
      ctx.strokeStyle = "rgba(236,224,198,.7)"; ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) { const ty = y + H - H * i / 5; ctx.beginPath(); ctx.moveTo(x + W - 6, ty); ctx.lineTo(x + W, ty); ctx.stroke(); }
      ctx.font = `800 11px "Bahnschrift", "DIN Alternate", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.strokeText(Math.round(lv) + "%", x + W / 2, y + H + 3); ctx.fillStyle = c; ctx.fillText(Math.round(lv) + "%", x + W / 2, y + H + 3);
    } });
    return after(ms);
  }
  /** 绳索：一条浅黄色的能量绳伸到目标、钩住、再收回来（拉拽：约 0.5 秒） */
  function rope(a, b, color, ms) {
    if (!a || !b || reduced() || !ensure()) return Promise.resolve();
    ms = ms || 500;
    const dir = dirOf(a, b);
    add({ dur: ms, draw(k) {
      const out = k < .45 ? ease.out(k / .45) : 1 - ease.in((k - .45) / .55);
      if (out <= .02) return;
      const pts = []; for (let i = 0; i <= 20; i++) { const t = i / 20 * out; pts.push([lerp(a.x, b.x, t) - dir.y * Math.sin(t * 18) * 2.2, lerp(a.y, b.y, t) + dir.x * Math.sin(t * 18) * 2.2]); }
      line(polyline(pts), 4.2, color, "#fffbe6", { shadow: false });
      const h = pts[pts.length - 1];
      sticker(circlePath(h[0], h[1], 6), color, { ink: 2.4, shadow: false });
    } });
    return after(ms * .45);
  }
  /** 废铁拼装：一把螺丝、铁片从四周飞进来拍到卡上，最后火花一闪（柯尔特「非法」改装） */
  function scrap(rect) {
    if (!rect || reduced() || !ensure()) return;
    const bits = Array.from({ length: 9 }, (_, i) => ({ a: i / 9 * TAU + rnd(-.2, .2), d: rnd(70, 110), s: rnd(5, 9), r: rnd(0, TAU), lag: i * .035, bolt: i % 3 === 0 }));
    add({ dur: 640, draw(k) {
      for (const b of bits) {
        const t = clamp01((k - b.lag) / .5); if (t <= 0) continue;
        const d = b.d * (1 - ease.in(t)), x = rect.x + Math.cos(b.a) * (d + rect.w * .18), y = rect.y + Math.sin(b.a) * (d * .7 + rect.h * .12);
        ctx.save(); ctx.translate(x, y); ctx.rotate(b.r + t * 6);
        if (b.bolt) { sticker(circlePath(0, 0, b.s * .6), "#9aa3a8", { ink: 2, shadow: false }); ctx.fillStyle = INK; ctx.fillRect(-b.s * .4, -1, b.s * .8, 2); }
        else sticker(poly([[-b.s, -b.s * .6], [b.s, -b.s * .4], [b.s * .8, b.s * .6], [-b.s * .9, b.s * .5]]), "#8d8a83", { ink: 2.2, shadow: false });
        ctx.restore();
      }
    } });
    flashStar(rect, sizeOf(rect) * .38, "#ffd23a", 220, true, 330);
  }
  /** 银色盾牌标志在单位身上浮出来、很快没掉（扭矩转移注意） */
  function emblem(rect, color) {
    if (!rect || !ensure()) return;
    const S0 = Math.min(rect.w, rect.h) * .32;
    add({ dur: 620, draw(k) {
      const g = k < .25 ? ease.back(k / .25) : 1, a = k < .6 ? 1 : 1 - (k - .6) / .4;
      ctx.globalAlpha = a; ctx.translate(rect.x, rect.y); ctx.scale(g, g);
      const shield = poly([[0, -S0], [S0 * .82, -S0 * .62], [S0 * .72, S0 * .28], [0, S0], [-S0 * .72, S0 * .28], [-S0 * .82, -S0 * .62]]);
      sticker(shield, color || "#cfd6dc", { ink: 3 });
      ctx.fillStyle = "#ffffff"; ctx.globalAlpha = a * .7; ctx.fill(poly([[0, -S0 * .78], [S0 * .5, -S0 * .5], [0, -S0 * .1], [-S0 * .55, -S0 * .5]]));
    } });
  }
  /** 一道红光从铭牌上扫过去（银翼机体强化） */
  function plateFlash(rect, color) {
    if (!rect || !ensure()) return;
    const top = rect.y - rect.h * .42, left = rect.x - rect.w / 2;
    add({ dur: 420, draw(k) {
      const x = left - 40 + k * (rect.w + 80);
      ctx.save(); ctx.beginPath(); ctx.rect(left, top, rect.w, rect.h); ctx.clip();
      ctx.globalAlpha = .28 * Math.sin(Math.PI * k); ctx.fillStyle = color; ctx.fillRect(left, top, rect.w, rect.h);
      ctx.globalAlpha = .85 * Math.sin(Math.PI * k);
      const g = ctx.createLinearGradient(x - 30, 0, x + 30, 0);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(.5, color); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.transform(1, 0, -.4, 1, (top + rect.h / 2) * .4, 0); ctx.fillRect(x - 30, top, 60, rect.h);
      ctx.restore();
    } });
  }
  /** 火焰轨迹：沿着路线留下一串火团，慢慢变暗缩掉（夕夏全速撞击、协助攻击冲过去） */
  function fireTrail(a, b, ms) {
    if (!a || !b || reduced() || !ensure()) return;
    ms = ms || 180;
    const n = Math.max(6, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 22));
    for (let i = 0; i < n; i++) {
      const t = i / n, x = lerp(a.x, b.x, t) + rnd(-6, 6), y = lerp(a.y, b.y, t) + rnd(-6, 6), r = rnd(9, 15);
      add({ dur: 520, delay: t * ms, draw(k) {
        const rr = r * (1 - ease.in(k) * .9); if (rr < .5) return;
        sticker(circlePath(x, y - k * 14, rr), k < .3 ? "#ffd23a" : k < .6 ? COL.fire : "#4a3a33", { ink: 2.2, shadow: false });
      } });
    }
  }
  /** 尾焰：从单位身上朝 dir 的反方向喷出一大股火和黑烟（夕夏协助攻击：引擎把她推出去） */
  function exhaust(rect, dir, ms) {
    if (!rect || !dir || reduced() || !ensure()) return;
    ms = ms || 520;
    const bx = -dir.x, by = -dir.y, n = 26;
    for (let i = 0; i < n; i++) {
      const sp = rnd(-.35, .35), life = rnd(380, 560), dist = rnd(70, 150), r = rnd(8, 16);
      add({ dur: life, delay: (i / n) * ms * .6, draw(k) {
        const d = dist * ease.out(k), ang = Math.atan2(by, bx) + sp;
        const x = rect.x + Math.cos(ang) * (rect.w * .3 + d), y = rect.y + Math.sin(ang) * (rect.h * .2 + d) - k * 10;
        const rr = r * (.6 + k * 1.1) * (1 - ease.in(clamp01((k - .7) / .3)));
        if (rr < .5) return;
        const col = k < .25 ? "#ffd23a" : k < .5 ? COL.fire : k < .7 ? "#5b4136" : "#2b2522";
        sticker(circlePath(x, y, rr), col, { ink: 2, shadow: false });
      } });
    }
  }
  /** 金属撞击的火花：一把金色火花四溅（协助格挡成功，画在两人连线的中点） */
  function sparks(at, o) {
    if (!at || reduced() || !ensure()) return;
    o = o || {};
    const n = o.n || 32;
    const bits = Array.from({ length: n }, () => ({ a: rnd(0, TAU), v: rnd(170, 380), l: rnd(12, 28) }));
    add({ dur: 540, draw(k) {
      for (const b of bits) {
        const t = k, x = at.x + Math.cos(b.a) * b.v * t * .5, y = at.y + Math.sin(b.a) * b.v * t * .5 + 300 * t * t * .5;
        const vx = Math.cos(b.a), vy = Math.sin(b.a) + t * 1.6, d = Math.hypot(vx, vy) || 1, len = b.l * (1 - t);
        if (len <= .5) continue;
        line(polyline([[x, y], [x - vx / d * len, y - vy / d * len]]), 3.2 * (1 - t * .5), "#ffcf2e", "#fffbe0", { shadow: false });
      }
    } });
    ringFx(at, 48, "#ffd23a", 300);
    flashStar(at, 44, "#ffe27a", 250, true);
    flashStar(at, 20, "#ffffff", 170, true);
  }
  /** 乱打：一张卡上几道又快又短的刀光（绯秋特盛乱打） */
  function flurry(rect, color, hot) {
    if (!rect || reduced() || !ensure()) return;
    const S0 = sizeOf(rect) * .7;
    for (let i = 0; i < 4; i++) {
      const ang = rnd(0, TAU), ox = rnd(-.25, .25) * rect.w, oy = rnd(-.2, .2) * rect.h;
      add({ dur: 200, delay: i * 45, draw(k) {
        const head = ease.out(clamp01(k / .4)), tail = ease.in(clamp01((k - .4) / .6));
        if (head - tail < .02) return;
        const p0 = [rect.x + ox - Math.cos(ang) * S0, rect.y + oy - Math.sin(ang) * S0], p1 = [rect.x + ox + Math.cos(ang) * S0, rect.y + oy + Math.sin(ang) * S0];
        const pts = []; for (let j = 0; j <= 10; j++) { const t = lerp(tail, head, j / 10); pts.push([lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t)]); }
        sticker(ribbon(pts, (u) => 9 * Math.sin(Math.PI * u)), color, { ink: 2.6 });
        ctx.fillStyle = hot || "#fff"; ctx.fill(ribbon(pts, (u) => 3.4 * Math.sin(Math.PI * u)));
      } });
    }
  }
  /** 挥打：一道又宽又重的弧扫过去，尾端炸一颗冲击星（夕夏的扳手；big：焰袭的大挥打） */
  function bigSwing(rect, from, color, o) {
    if (!rect || reduced() || !ensure()) return;
    o = o || {};
    const dir = dirOf(from || { x: rect.x - 100, y: rect.y }, rect), S0 = sizeOf(rect) * (o.big ? 1.45 : 1.15);
    const facing = Math.cos(dir.ang) >= 0 ? 1 : -1;
    const c0 = { x: rect.x - facing * S0 * .35, y: rect.y + S0 * .55 };   // 转轴在卡片下方偏后：像抡起来砸下去
    const a0 = facing > 0 ? -Math.PI * .95 : -Math.PI * .05, a1 = facing > 0 ? -Math.PI * .2 : -Math.PI * .8;
    add({ dur: 340, draw(k) {
      const head = ease.out(clamp01(k / .35)), tail = ease.in(clamp01((k - .35) / .65));
      if (head - tail < .02) return;
      const pts = []; for (let j = 0; j <= 24; j++) { const t = lerp(tail, head, j / 24), an = lerp(a0, a1, t); pts.push([c0.x + Math.cos(an) * S0, c0.y + Math.sin(an) * S0]); }
      const T = S0 * (o.big ? .5 : .4) * (1 - tail * .5);
      ctx.globalAlpha = .3; ctx.fillStyle = color; ctx.fill(ribbon(pts.map(([x, y]) => [x + (c0.x - x) * .15, y + (c0.y - y) * .15]), (u) => T * 1.6 * Math.sin(Math.PI * u))); ctx.globalAlpha = 1;
      sticker(ribbon(pts, (u) => T * Math.pow(Math.sin(Math.PI * u), .6)), color, { ink: 3.5 });
      ctx.fillStyle = "#fff4dc"; ctx.fill(ribbon(pts, (u) => T * .3 * Math.sin(Math.PI * u)));
    } });
    smashFx(rect, sizeOf(rect) * (o.big ? 1.25 : 1), dir, { heavy: true }, color, "#fff4dc");
  }
  /** 热浪：一排火团从出手的人那边扫过整区，火舌末端慢慢变黑变成黑烟（伯妮尔喷火） */
  function heatWave(a, rect, ms) {
    if (!a || !rect || reduced() || !ensure()) return Promise.resolve();
    ms = ms || 560;
    const dir = dirOf(a, rect), nx = -dir.y, ny = dir.x, span = Math.max(rect.w, rect.h) * .5, n = 30;
    for (let i = 0; i < n; i++) {
      const side = rnd(-1, 1), reach = rnd(.75, 1.15), life = rnd(420, 620), r = rnd(9, 18);
      add({ dur: life, delay: (i / n) * ms * .55, draw(k) {
        const d = (dir.d + span * .4) * reach * ease.out(k);
        const x = a.x + dir.x * d + nx * side * span * .8 * k, y = a.y + dir.y * d + ny * side * span * .55 * k - k * 12;
        const rr = r * (.5 + k * 1.2) * (1 - ease.in(clamp01((k - .75) / .25)));
        if (rr < .5) return;
        sticker(circlePath(x, y, rr), k < .22 ? "#ffd23a" : k < .5 ? COL.fire : k < .72 ? "#7a3a22" : "#2b2522", { ink: 2.2, shadow: false });
      } });
    }
    return after(ms * .45);
  }
  /** 升龙拳：一根火柱冲天 + 大爆炸；撼地拳：脚下冰面裂开、冰碴往上崩 */
  function bigPunch(rect, fire) {
    if (!rect || reduced() || !ensure()) return;
    const S0 = sizeOf(rect);
    if (fire) {
      for (let i = 0; i < 18; i++) {
        const x = rect.x + rnd(-.25, .25) * rect.w, r = rnd(10, 20), life = rnd(420, 640);
        add({ dur: life, delay: i * 18, draw(k) {
          const y = rect.y + rect.h * .3 - ease.out(k) * (rect.h * 1.4 + 60), rr = r * (1 - ease.in(clamp01((k - .6) / .4)));
          if (rr < .5) return;
          sticker(circlePath(x + Math.sin(k * 9 + i) * 6, y, rr), k < .3 ? "#ffd23a" : k < .65 ? COL.fire : DEEP.fire, { ink: 2.2, shadow: false });
        } });
      }
      flameBurst(rect, S0 * 1.5);
    } else {
      add({ dur: 560, draw(k) {
        const g = ease.out(clamp01(k / .25)), a = k < .6 ? 1 : 1 - (k - .6) / .4;
        ctx.globalAlpha = a;
        for (let i = 0; i < 7; i++) {
          const an = Math.PI * (.05 + .9 * i / 6), len = S0 * 1.3 * g;
          const pts = [[rect.x, rect.y + rect.h * .45]];
          for (let j = 1; j <= 4; j++) pts.push([rect.x + Math.cos(an) * len * j / 4 + rnd(-3, 3), rect.y + rect.h * .45 - Math.sin(an) * len * j / 4 * .35 + rnd(-2, 2)]);
          line(polyline(pts), 3, "#bfe6f7", "#ffffff", { shadow: false });
        }
      } });
      iceBloom({ x: rect.x, y: rect.y + rect.h * .2, w: rect.w * 1.2, h: rect.h * .6 });
      shatterFx(rect, S0 * 1.3, { x: 0, y: -1, ang: -Math.PI / 2, d: 1 }, COL.ice, "#ffffff");
    }
  }
  /** 穿刺：从目标身上朝 to 的方向扎出一根刺（维塔斯扯下：针朝维塔斯那边被扯出来） */
  function pierceOut(rect, to, color) {
    if (!rect || !to || reduced() || !ensure()) return;
    thrustFx(rect, sizeOf(rect) * 1.1, dirOf(rect, to), { heavy: true }, color, "#ffffff");
  }

  /* ---------- 击倒红叉：手动收（game.js 演完整段才放卡片淡出，叉跟着一起淡掉） ---------- */
  function koManual(rect, track) {
    const st = koState(rect), last = {};
    let fadeAt = 0, fadeLen = 400, gone = false;
    const e = add({ persist: true, dur: 1, draw(t) {
      const ms = t * 1000;
      const out = fadeAt ? Math.max(0, 1 - Math.max(0, ms - fadeAt) / fadeLen) : 1;
      if (fadeAt && out <= 0) { if (!gone) { gone = true; setTimeout(() => remove(e), 0); } return; }
      follow(rect, track, last);
      koDraw(st, ms, out);
    } });
    /** release(fade, delay)：卡片过 delay 毫秒开始淡出、淡 fade 毫秒——叉跟着一起淡掉 */
    return { release(fade, delay) { if (!e) return; fadeLen = Math.max(120, fade || 400); fadeAt = (now() - e.t0) + Math.max(0, delay || 0); } };
  }

  /* ================= 11. 技能脚本 ================= */
  const lerpRect = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: b.w, h: b.h });
  const from = (c, id) => { const a = c.rect(c.actor), t = c.rect(id || c.target); return a && t ? [edgeToward(a, dirOf(a, t), 4), t, a] : [null, null, null]; };
  const each = (c, fn) => (c.targets || []).forEach((id, i) => { const r = c.rect(id); if (r) fn(r, id, i); });
  const isAlly = (c) => !!(c.data && c.data.ally);
  const SCRIPTS = {
    /* ---- 瑞比 / 银翼 / 明特 ---- */
    laser: {   // 瑞比普攻、瑞比协助攻击、拉斯缪尔普攻：一束青色直线激光，两段打两束
      async pre(c) { const [a, t] = from(c); if (!a) return; c.recoil(c.actor, t, 5); await laser(a, t, { width: 9 }); },
      async again(c, e) { const [a, t] = from(c, e.unitId); if (!a) return; c.recoil(c.actor, t, 4); await laser(a, t, { width: 8, ms: 200 }); },
      impact(c, e) { const t = c.rect(e.unitId); if (t) flashStar(t, sizeOf(t) * .38, COL.energy, 170); }
    },
    ruby_trigger: {   // 一个青色光点迅速飞向敌人
      async pre(c) { const [a, t] = from(c); if (!a) return; c.recoil(c.actor, t, 4); await dot(a, t, COL.energy, 150); ringFx(t, sizeOf(t) * .5, COL.energy, 280); }
    },
    ruby_surge: {   // 一束黄色的闪电，迅速打击迅速消失
      async pre(c) { const [a, t] = from(c); if (!a) return; c.recoil(c.actor, t, 5); lightning(a, t, 150, "electric", { width: 6, color2: null }); await after(50); },
      impact(c, e) { const t = c.rect(e.unitId); if (t) flashStar(t, sizeOf(t) * .45, "#ffe23a", 150, true); }
    },
    ruby_short: {   // 一束细的、蓝黄交加的电光
      async pre(c) { const [a, t] = from(c); if (!a) return; lightning(a, t, 280, "electric", { width: 3, color: "#ffe23a", color2: "#4d8bff", branch: false }); await after(90); crackle(t, "#7fd4ff", 360); }
    },
    ruby_algo: {   // 敌人身上冒出一些破译的代码（白色等宽字，像命令行），1 秒内消失
      async pre(c) { const t = c.rect(c.target); if (!t) return; codeRain(t, 950); await after(160); }
    },
    ruby_relay: { self(c) { drone(c.rect(c.actor)); } },   // 一个无人机飞出来
    wing_aa: {   // 一颗能量炮直击目标并且造成能量波（同区其他敌人挨溅射）
      async pre(c) { const [a, t] = from(c); if (!a) return; c.recoil(c.actor, t, 8); await windup(c.rect(c.actor), t, { kind: "bolt", el: "energy" }); await orb(a, t, { kind: "cannon", scale: c.data && c.data.big ? 1.35 : 1 }); },
      impact(c, e, i) {
        const t = c.rect(e.unitId); if (!t) return;
        if (i === 0) { ringFx(t, sizeOf(t) * 1.3, COL.energy, 420); ringFx(t, sizeOf(t) * .8, "#eafffa", 300); flashStar(t, sizeOf(t) * .55, COL.energy, 200); }
        else ringFx(t, sizeOf(t) * .6, COL.energy, 260);
      }
    },
    wing_steal: {   // 对每个打到的敌人同时连上一束黄色闪电
      async pre(c) { const a0 = c.rect(c.actor); if (!a0) return; each(c, (r) => lightning(edgeToward(a0, dirOf(a0, r), 4), r, 260, "electric", { width: 5, color2: null })); await after(70); },
      impact(c, e) { const t = c.rect(e.unitId); if (t) flashStar(t, sizeOf(t) * .4, "#ffe23a", 150, true); }
    },
    wing_surge: {   // 较粗的黄色电击
      async pre(c) { const [a, t] = from(c); if (!a) return; c.recoil(c.actor, t, 6); lightning(a, t, 240, "electric", { width: 10, color2: "#fff4a8" }); await after(60); },
      impact(c, e) { const t = c.rect(e.unitId); if (t) { flashStar(t, sizeOf(t) * .55, "#ffe23a", 200, true); zigRing(t, sizeOf(t) * .7); } }
    },
    wing_boost: { self(c) { plateFlash(c.rect(c.actor), "#ff3b2e"); } },   // 铭牌上闪过红光
    mint_steal: {   // 一束黄色闪电
      async pre(c) { const [a, t] = from(c); if (!a) return; c.recoil(c.actor, t, 5); lightning(a, t, 220, "electric", { width: 6, color2: null }); await after(60); }
    },
    mint_banish: {   // 一个闪电挥打
      impact(c, e, i) { const t = c.rect(e.unitId); if (!t) return; slashFx(t, sizeOf(t), dirOf(c.rect(c.actor) || t, t), i, { blade: "", heavy: false }, "#ffe23a", "#ffffff"); crackle(t, "#ffe23a", 300); }
    },
    /* ---- 结人 ---- */
    yuito_aa: { async pre(c) { const [a, t] = from(c); if (!a) return; c.recoil(c.actor, t, 5); await orb(a, t, { kind: "ice" }); } },   // 一颗冰球子弹
    yuito_amer: {   // 治疗：被治疗的人身上浅蓝色雾气；攻击：那一区浅蓝色碎冰
      async pre(c) {
        if (isAlly(c)) { const t = c.rect(c.target); if (t) { mist(t, "rgba(150,210,240,1)"); } return; }
        const z = c.zoneRect(c.target); if (z) iceBloom(z, true); await after(120);
      },
      impact(c, e) { const t = c.rect(e.unitId); if (t) shatterFx(t, sizeOf(t) * .7, { x: 0, y: -1, ang: -Math.PI / 2, d: 1 }, "#bfe6f7", "#ffffff"); }
    },
    yuito_espresso: {   // 加行动点：头上冒出蓝色的「+1AP」；打敌人：丢出一颗酸液子弹
      async pre(c) {
        if (isAlly(c)) { floatText(c.rect(c.target), "+1AP", "#4d8bff", { size: 24 }); return; }
        const [a, t] = from(c); if (!a) return; await glob0(a, t);
      }
    },
    yuito_extract: {   // 丢出一个咖啡杯到那一区，然后扩散开浅绿色涟漪
      async pre(c) { const a = c.rect(c.actor), z = c.zoneRect(c.data && c.data.zoneOf || c.target); if (!a || !z) return; await cup(a, z); ripples(z, "#9be03a", 3); await after(160); }
    },
    yuito_cold: {   // 丢出一个咖啡杯，那一区瞬间冒满冰块
      async pre(c) { const a = c.rect(c.actor), z = c.zoneRect(c.data && c.data.zoneOf || c.target); if (!a || !z) return; await cup(a, z); iceBloom(z); await after(140); }
    },
    /* ---- 绯秋 / 丹生谷 / 鳴門 ---- */
    hiaki_flash: {   // 先斩出一刀横跨整区的刀光，短暂停顿后瞬间结算（所有人一起）
      instant: true,
      async pre(c) {
        const a = c.rect(c.actor), t = c.rect(c.target), z = c.zoneRect(c.target); if (!a || !t) return;
        await c.dash(c.actor, t, { reach: 40 });
        const el = c.move.el, row = z ? { x: z.x, y: t.y, w: z.w, h: t.h } : t;
        zoneCut(row, COL[el] || COL.physical, HOT[el] || "#fff");
        flashLine(row, Math.max(row.w, 220) / 4.2, COL[el] || COL.physical, HOT[el] || "#fff");
        await c.wait(300);
      },
      impact(c, e) { const t = c.rect(e.unitId); if (!t) return; flashStar(t, sizeOf(t) * .45, COL[c.move.el] || "#fff", 180, true); }
    },
    hiaki_barrage: {   // 对同区每个敌人乱打（按随机顺序）
      async pre(c) {
        const t = c.rect(c.target || (c.targets || [])[0]); if (!t) return;
        await c.dash(c.actor, t, { reach: 50 });
        const ids = (c.targets || []).slice().sort(() => fxRand() - .5);
        for (const id of ids) { const r = c.rect(id); if (r) { flurry(r, COL[c.move.el] || COL.physical, HOT[c.move.el]); c.burst(c.move.el, r); } await c.wait(110); }
      },
      impact() {}
    },
    hiaki_pot: {   // 一个挥打，然后敌人熔融
      async pre(c) {
        const t = c.rect(c.target || (c.targets || [])[0]); if (!t) return;
        await c.dash(c.actor, t, { reach: 50 });
        each(c, (r, id, i) => slashFx(r, sizeOf(r), dirOf(c.rect(c.actor) || r, r), i, { blade: "katana" }, COL.fire, HOT.fire));
      }
    },
    naruto_wind: {   // 砍出一击蓝色剑气，先慢后极快地飞向敌人
      async pre(c) { const [a, t] = from(c); if (!a) return; c.recoil(c.actor, t, 6); await swordWave(a, t, { color: "#7cc6f5", slowFast: true }); },
      impact(c, e) { const t = c.rect(e.unitId); if (t) shatterFx(t, sizeOf(t), dirOf(c.rect(c.actor) || t, t), COL.ice, "#ffffff"); }
    },
    /* ---- 灯 / 年糕 ---- */
    tou_aa: {   // 挥砍；耗圣盾打邻区时改成剑气
      async pre(c) {
        const [a, t, a0] = from(c); if (!a) return;
        if (c.data && c.data.dist > 0) { c.recoil(c.actor, t, 6); await swordWave(a, t, { color: COL.physical }); }
        else await c.dash(c.actor, t, {});
      },
      impact(c, e, i) { const t = c.rect(e.unitId); if (!t) return; slashFx(t, sizeOf(t), dirOf(c.rect(c.actor) || t, t), i, { blade: "", heavy: true }, COL[e.element] || COL.physical, HOT[e.element] || "#fff"); }
    },
    tou_start: {   // 施加错位时用撞击动画
      async pre(c) { const t = c.rect(c.target); if (!t) return; await c.dash(c.actor, t, { heavy: true }); smashFx(t, sizeOf(t), dirOf(c.rect(c.actor) || t, t), { heavy: true }, COL.harmonic, HOT.harmonic); c.shake(1); }
    },
    tou_sonic: {   // 大剑气先打同区那个、再飞去打远的那个；只选一个就只打一个
      async pre(c) { const [a, t] = from(c, (c.targets || [])[0] || c.target); if (!a) return; c.recoil(c.actor, t, 6); await swordWave(a, t, { color: COL.harmonic, big: true }); },
      async again(c, e, i) {
        const prev = c.rect((c.targets || [])[Math.max(0, (c.targets || []).indexOf(e.unitId) - 1)]), t = c.rect(e.unitId);
        if (prev && t && prev !== t) await swordWave(prev, t, { color: COL.harmonic, big: true, ms: 220 });
      },
      impact(c, e) { const t = c.rect(e.unitId); if (t) ringFx(t, sizeOf(t) * .85, COL.harmonic, 320, true); }
    },
    tou_bash: {   // 先移动再撞击；耗圣盾的二次盾突（data.twice）更快、停得更利落
      async pre(c) { const t = c.rect(c.target); if (!t) return; await c.dash(c.actor, t, { heavy: true }); },
      async again(c, e) { const t = c.rect(e.unitId); if (!t) return; await c.dash(c.actor, t, { heavy: true, speed: .55, hold: 70 }); },
      impact(c, e, i) { const t = c.rect(e.unitId); if (!t) return; smashFx(t, sizeOf(t) * (i ? 1.15 : 1), dirOf(c.rect(c.actor) || t, t), { heavy: true }, COL.physical, HOT.physical); c.shake(i ? 1.3 : 1); },
      async brk(c, e) {   // 二次盾突只打击破：它的击破弹出来之前再撞一次
        if (!c.data || !c.data.twice || c.twiceDone || e.unitId !== c.target) return;
        c.twiceDone = true;
        const t = c.rect(e.unitId); if (!t) return;
        await c.dash(c.actor, t, { heavy: true, speed: .55, hold: 70 });
        smashFx(t, sizeOf(t) * 1.15, dirOf(c.rect(c.actor) || t, t), { heavy: true }, COL.physical, HOT.physical); c.shake(1.3);
      }
    },
    sonicBoom: {   // 年糕 / Ecmo 音爆、诺拉声波震击：同区音爆，谐波色的声波往外扩
      async pre(c) {
        const a = c.rect(c.actor), z = c.zoneRect(c.actor) || a; if (!a) return;
        for (let i = 0; i < 4; i++) ringFxAt(a, Math.max(z.w, z.h) * .6, COL.harmonic, 560, i * 90);
        if (c.data && c.data.pierced) { const p = c.rect(c.data.pierced); if (p) tube(edgeToward(a, dirOf(a, p), 4), p, COL.harmonic, 1, 260); }
        await after(200);
      },
      async again(c, e, i) {   // 年糕耗圣盾重复一次：同一批敌人第二轮挨打时再炸一圈
        if (c.boomAgain || !(c.mains || []).slice(0, i).some(x => x.unitId === e.unitId)) return;
        c.boomAgain = true;
        const a = c.rect(c.actor), z = c.zoneRect(c.actor) || a; if (!a) return;
        for (let k = 0; k < 3; k++) ringFxAt(a, Math.max(z.w, z.h) * .6, COL.harmonic, 520, k * 80);
        await after(180);
      },
      impact(c, e) { const t = c.rect(e.unitId); if (t) ringFx(t, sizeOf(t) * .7, COL.harmonic, 300, true); }
    },
    /* ---- 夕夏 / 伯妮尔 ---- */
    xia_aa: {   // 挥打（扳手抡下去）
      async pre(c) { const t = c.rect(c.target); if (!t) return; await c.dash(c.actor, t, { heavy: true }); },
      impact(c, e) { const t = c.rect(e.unitId); if (!t) return; bigSwing(t, c.rect(c.actor), COL[e.element] || COL.physical); c.shake(.6); }
    },
    xia_execute: {   // 先撞上去截停、同时刺一下；一瞬之后夕夏往后（画面下方）退一点，同时一记大挥砍，画面震
      async pre(c) { const t = c.rect(c.target); if (!t) return; await c.dash(c.actor, t, { heavy: true, speed: .7 }); thrustFx(t, sizeOf(t), dirOf(c.rect(c.actor) || t, t), { heavy: true }, COL.fire, HOT.fire); await c.wait(160); c.nudge(c.actor, 0, 26, 260); await c.wait(60); },
      impact(c, e) { const t = c.rect(e.unitId); if (!t) return; slashFx(t, sizeOf(t) * 1.3, dirOf(c.rect(c.actor) || t, t), 0, { heavy: true }, COL.fire, HOT.fire); c.shake(1.4); }
    },
    xia_ram: {   // 极快地冲过去直接撞上，路上拖一道火焰
      async pre(c) { const a = c.rect(c.actor), t = c.rect(c.target); if (!a || !t) return; fireTrail(a, t, 140); await c.dash(c.actor, t, { heavy: true, speed: .6, reach: 140 }); },
      impact(c, e) { const t = c.rect(e.unitId); if (!t) return; smashFx(t, sizeOf(t) * 1.15, dirOf(c.rect(c.actor) || t, t), { heavy: true }, COL.fire, HOT.fire); c.shake(1.2); }
    },
    xia_selfburn: { self(c) { const r = c.rect(c.actor); if (r) c.burst("fire", r, true); } },   // 自己身上火焰粒子一下
    bite: { impact(c, e) { const t = c.rect(e.unitId); if (t) biteFx(t, sizeOf(t), COL[e.element] || COL.physical, HOT[e.element] || "#fff"); } },   // 夕夏狂怒碾压、Ecmo 相控阵探头
    berniel_spit: {   // 区里喷出一片火焰热浪，火舌末端变黑成黑烟
      async pre(c) { const a = c.rect(c.actor), z = c.zoneRect(c.target || c.actor) || c.rect(c.target); if (!a || !z) return; await heatWave(a, z); }
    },
    flameJet: {   // 伯妮尔燃点 / 点火突进：喷出一束火焰
      async pre(c) { const [a, t] = from(c); if (!a) return; flameStream(a, t, 260); await after(200); },
      impact(c, e) { const t = c.rect(e.unitId); if (t) flameBurst(t, sizeOf(t) * .9); }
    },
    berniel_flare: {   // 伯妮尔飞向夕夏然后消失，夕夏一记更大的挥打，画面震
      async pre(c) {
        const xia = c.data && c.data.owner, xr = xia ? c.rect(xia) : null;
        if (xr) { fireTrail(c.rect(c.actor), xr, 120); await c.dash(c.actor, xr, { reach: 999, keep: true }); c.cls(c.actor, "fx-vanish", 600); }
        const t = c.rect(c.target); if (t && xia) await c.dash(xia, t, { heavy: true });
      },
      impact(c, e) { const t = c.rect(e.unitId); if (!t) return; bigSwing(t, c.rect((c.data && c.data.owner) || c.actor), COL.fire, { big: true }); c.shake(1.5); }
    },
    /* ---- 川川 / 哔哩哩 ---- */
    slash: { impact(c, e, i) { const t = c.rect(e.unitId); if (t) slashFx(t, sizeOf(t), dirOf(c.rect(c.actor) || t, t), i, { blade: "" }, COL[e.element] || COL.physical, HOT[e.element] || "#fff"); } },   // 川川普攻 / 协助：每一击都是挥砍
    chuan_whip: {   // 青绿色的粗鞭子快速抽过去
      async pre(c) { const [a, t] = from(c); if (!a) return; await whip(a, t, "#35e0c0"); },
      impact(c, e) { const t = c.rect(e.unitId); if (t) flashStar(t, sizeOf(t) * .45, "#35e0c0", 170, true); }
    },
    chuan_over: { async pre(c) { const t = c.rect(c.target); if (t) crackle(t, "#ffe23a", 620); await after(120); } },   // 目标身上冒雷电
    chuan_pulse: { self(c) { gather(c.rect(c.actor), COL.energy); } },   // 青色能量聚到身上
    chuan_blade: {   // 挥砍更慢、更有力（巨刃）
      async pre(c) { const t = c.rect(c.target); if (!t) return; await c.dash(c.actor, t, { heavy: true, speed: 1.4 }); },
      impact(c, e) { const t = c.rect(e.unitId); if (!t) return; slashFx(t, sizeOf(t) * 1.4, dirOf(c.rect(c.actor) || t, t), 0, { heavy: true, slow: true }, COL.electric, "#ffffff"); c.shake(1.3); }
    },
    bili_beam: {   // 一束细细的电光飘到敌人身上
      async pre(c) { const [a, t] = from(c); if (!a) return; lightning(a, t, 420, "electric", { width: 2.6, color2: null, amp: 1.6, branch: false }); await after(160); }
    },
    bili_magnet: {   // 按推 / 拉的方向，紫色弧把敌人推过去 / 拉过来
      async pre(c) {
        const a = c.rect(c.actor), t = c.rect(c.target); if (!a || !t) return;
        const d = dirOf(a, t), pull = c.data && c.data.dir === "pull";
        magnet(t, pull ? { x: -d.x, y: -d.y } : { x: d.x, y: d.y }, COL.harmonic); await after(160);
      }
    },
    bili_storm: {   // 蓄力一瞬，然后急速打出几道更细更亮的闪电
      async pre(c) { const a = c.rect(c.actor); if (!a) return; await gather(a, "#ffe23a", 320); },
      async again(c, e) { const [a, t] = from(c, e.unitId); if (a) lightning(a, { x: t.x + rnd(-12, 12), y: t.y + rnd(-10, 10) }, 150, "electric", { width: 3, color: "#fff7b0", color2: null }); await after(35); },
      impact(c, e, i) { if (i === 0) { const [a, t] = from(c, e.unitId); if (a) lightning(a, t, 150, "electric", { width: 3, color: "#fff7b0", color2: null }); } }
    },
    /* ---- 诺拉 / 维塔斯 ---- */
    nora_aa: {   // 冰弹；有刺入时（残忍）蓝色模糊能量顺着管子冲过去，治疗时冲向队友再治疗
      async pre(c) {
        const [a, t] = from(c); if (!a) return;
        if (c.data && c.data.pierced === c.target) { await tube(a, t, "#7cc6f5", 1, 280); if (isAlly(c)) mist(t, "rgba(150,210,240,1)"); return; }
        c.recoil(c.actor, t, 5); await orb(a, t, { kind: "ice" });
      }
    },
    nora_needle: { async pre(c) { const [a, t] = from(c); if (!a) return; await crystal0(a, t, { needle: true, el: "ice" }); } },   // 直直迅速射出一根银针
    nora_indwell: { async pre(c) { const [a, t] = from(c); if (!a) return; await tube(a, t, "#ffffff", 1, 300); } },   // 一束白光顺着管道冲向敌人
    vitas_infuse: { async pre(c) { const [a, t] = from(c); if (!a) return; await tube(a, t, isAlly(c) ? "#7cc6f5" : "#7cc6f5", 3, 220); if (isAlly(c)) mist(t, "rgba(150,210,240,1)"); } },   // 管道里三团能量连续灌进去
    vitas_rip: {   // 停一下，维塔斯往后退一点，针朝维塔斯那边被扯出来，画面震
      async pre(c) { await c.wait(200); const a = c.rect(c.actor), t = c.rect(c.target); if (!a || !t) return; const d = dirOf(t, a); c.nudge(c.actor, d.x * 24, d.y * 24, 260); },
      impact(c, e) { const t = c.rect(e.unitId), a = c.rect(c.actor); if (t && a) { pierceOut(t, a, COL.harmonic); c.shake(1.1); } }
    },
    /* ---- 柯尔特 / 扭矩 ---- */
    kolt_mod: { async pre(c) { const t = c.rect(c.target); if (t) scrap(t); await after(260); } },   // 废铁拼装
    kolt_cannon: {   // 电钻：顿一下再急速连射小电弹、画面连续震；酸液炮：一颗大酸液弹慢慢飞高再砸下来，溅开
      zoom: true,
      async pre(c) {
        const [a, t] = from(c); if (!a) return;
        if (c.move.el === "acid") { await c.wait(120); await glob0(a, t, { big: true }); return; }
        await c.wait(220);
      },
      async again(c, e) { const [a, t] = from(c, e.unitId); if (!a) return; c.recoil(c.actor, t, 3); tracer(a, { x: t.x + rnd(-10, 10), y: t.y + rnd(-8, 8) }, 70, 3.6, "#ffe23a", 0); c.shake(.35); await after(55); },
      impact(c, e, i) {
        const t = c.rect(e.unitId); if (!t) return;
        if (c.move.el === "acid") { if (i === 0) { splatFx(t, sizeOf(t) * 1.4, COL.acid, HOT.acid, {}); c.shake(1.2); } else splatFx(t, sizeOf(t) * .6, COL.acid, HOT.acid, {}); return; }
        if (i === 0) { const [a] = from(c, e.unitId); if (a) tracer(a, t, 70, 3.6, "#ffe23a", 0); c.shake(.35); }
        flashStar(t, sizeOf(t) * .3, "#ffe23a", 120, true);
      }
    },
    torque_boost: {   // 酸液炮：抛射效果像迫击炮但小一些；电钻：突进后连钻
      async pre(c) { const [a, t] = from(c); if (!a) return; if (c.move.el === "acid") { await glob0(a, t, {}); return; } await c.dash(c.actor, t, { heavy: true }); },
      impact(c, e, i) { const t = c.rect(e.unitId); if (!t) return; if (c.move.el === "acid") splatFx(t, sizeOf(t), COL.acid, HOT.acid, {}); else smashFx(t, sizeOf(t) * .8, dirOf(c.rect(c.actor) || t, t), { drill: true }, COL.electric, "#ffffff"); }
    },
    torque_divert: { self(c) { emblem(c.rect(c.actor), "#cfd6dc"); } },   // 身上浮出银色盾牌标志，很快消失
    /* ---- 拉斯缪尔 / EDC ---- */
    ras_dump: { async pre(c) { const [a, t] = from(c); if (!a) return; await laser(a, t, { width: 6, ms: 160 }); } },   // 短促的青色激光
    ras_torrent: {   // 身边浮现青色闪电，然后急速射出几道角度略不同的细激光；镜头推近
      zoom: true,
      async pre(c) { const a = c.rect(c.actor); if (!a) return; crackle(a, COL.energy, 420); await c.wait(260); },
      async again(c, e, i) { const [a, t] = from(c, e.unitId); if (!a) return; const off = (i % 3 - 1) * 16; laser({ x: a.x, y: a.y + off * .5 }, { x: t.x + off, y: t.y + off * .4 }, { width: 4, ms: 150 }); await after(45); },
      impact(c, e, i) { if (i === 0) { const [a, t] = from(c, e.unitId); if (a) laser(a, t, { width: 4, ms: 150 }); } const t = c.rect(e.unitId); if (t) flashStar(t, sizeOf(t) * .3, COL.energy, 130); }
    },
    edc_flash: {   // 停一下，然后一大团黄色强光罩住整区，再出伤害
      instant: true,
      async pre(c) { const a = c.rect(c.actor), z = c.zoneRect(c.actor) || a; if (!a) return; await gather(a, "#ffe23a", 260); halo(z, "#ffe23a", 560); await after(240); }
    },
    edc_siphon: { self(c) { const r = c.rect((c.data && c.data.owner) || c.actor); floatText(r, "汲取", "#ffd23a", { size: 22 }); } },   // 拉斯缪尔身上飘出黄色的「汲取」
    /* ---- 龙哥 / 小朋友 ---- */
    longge_drink: {   // 先停一小会、龙哥紧张得发抖，0.6 秒后才出效果
      async pre(c) { c.cls(c.actor, "fx-tremble", 600); await c.wait(600); },
      self(c) { return SCRIPTS.longge_drink.pre(c); }
    },
    xiaoxiao_combo: {   // 升龙拳（全红）：火更大更多、打飞、画面震；撼地拳（全蓝）：破冰、打飞、画面震
      async pre(c) { const t = c.rect(c.target); if (!t) return; await c.dash(c.actor, t, { heavy: true }); },
      impact(c, e, i) {
        const t = c.rect(e.unitId); if (!t) return;
        const els = (c.mains || []).map(x => x.element), allRed = els.length >= 1 && els.every(x => x === "fire"), allBlue = els.length >= 1 && els.every(x => x === "ice");
        if ((allRed || allBlue) && i === 0) { bigPunch(t, allRed); c.cls(e.unitId, "fx-knockfly", 700); c.shake(1.6); }
        else smashFx(t, sizeOf(t), dirOf(c.rect(c.actor) || t, t), { heavy: true }, COL[e.element] || COL.physical, HOT[e.element] || "#fff");
      }
    },
    /* ---- 职责技能 ---- */
    role_pull: { async pre(c) { const [a, t] = from(c); if (!a) return; await rope(a, t, "#ffe9a0", 500); } },   // 浅黄色绳索状能量把敌人拉过来（约 0.5 秒）
    wing_drone: {   // 银翼·收发代理：回合结束时无人机从瑞比身边升起，朝目标发一束细青色激光（每一发一束；data.first 才放无人机）
      async pre(c) {
        const a = c.rect(c.actor), t = c.rect(c.target); if (!a || !t) return;
        const first = !!(c.data && c.data.first);
        if (first) drone(a, 1700);
        await after(first ? 560 : 40);
        laser({ x: a.x + a.w * .62, y: a.y - a.h * .55 }, t, { width: 4, ms: 170 });
        await after(80);
      }
    },
    /* ---- 协助攻击 ---- */
    wing_assist: { async pre(c) { c.data = Object.assign({}, c.data, { big: true }); return SCRIPTS.wing_aa.pre(c); }, impact: (c, e, i) => SCRIPTS.wing_aa.impact(c, e, i) },   // 银翼普攻的动画，更大一些
    xia_assist: {   // 急速冲向敌人留下火焰轨迹 → 顿一瞬 → 朝敌人反方向喷出大量火焰和黑烟 → 0.5 秒后刺入、结算、画面震
      async pre(c) {
        const a = c.rect(c.actor), t = c.rect(c.target); if (!a || !t) return;
        fireTrail(a, t, 110);
        await c.dash(c.actor, t, { heavy: true, speed: .55, hold: 900 });
        await c.wait(120);
        exhaust(c.rect(c.actor) || a, dirOf(a, t), 520);
        await c.wait(500);
      },
      impact(c, e) { const t = c.rect(e.unitId); if (!t) return; thrustFx(t, sizeOf(t) * 1.25, dirOf(c.rect(c.actor) || t, t), { heavy: true }, COL.fire, HOT.fire); c.shake(1.4); }
    }
  };
  // 技能 id → 脚本
  const SCRIPT_OF = {
    ruby_aa: "laser", ruby_assist: "laser", ras_aa: "laser", ras_assist: "laser",
    ruby_trigger: "ruby_trigger", ruby_surge: "ruby_surge", ruby_short: "ruby_short", ruby_algo: "ruby_algo", ruby_relay: "ruby_relay",
    wing_aa: "wing_aa", wing_assist: "wing_assist", wing_steal: "wing_steal", wing_surge: "wing_surge", wing_boost: "wing_boost", wing_relay: "ruby_relay",
    mint_steal: "mint_steal", mint_banish: "mint_banish",
    yuito_aa: "yuito_aa", yuito_amer: "yuito_amer", yuito_espresso: "yuito_espresso", yuito_extract: "yuito_extract", yuito_cold: "yuito_cold",
    hiaki_flash: "hiaki_flash", hiaki_barrage: "hiaki_barrage", hiaki_pot: "hiaki_pot", naruto_wind: "naruto_wind",
    tou_aa: "tou_aa", tou_assist: "tou_aa", tou_start: "tou_start", tou_sonic: "tou_sonic", tou_bash: "tou_bash",
    mochi_boom: "sonicBoom", ecmo_boom: "sonicBoom", nora_sonic: "sonicBoom",
    xia_aa: "xia_aa", xia_execute: "xia_execute", xia_ram: "xia_ram", xia_selfburn: "xia_selfburn", xia_crush: "bite", ecmo_focus: "bite", xia_assist: "xia_assist",
    berniel_spit: "berniel_spit", berniel_ignite: "flameJet", berniel_dash: "flameJet", berniel_flare: "berniel_flare",
    chuan_aa: "slash", chuan_assist: "slash", hiaki_powder: "slash", chuan_whip: "chuan_whip", chuan_over: "chuan_over", chuan_pulse: "chuan_pulse", chuan_blade: "chuan_blade",
    bili_beam: "bili_beam", bili_magnet: "bili_magnet", bili_storm: "bili_storm",
    nora_aa: "nora_aa", nora_assist: "nora_aa", nora_needle: "nora_needle", nora_indwell: "nora_indwell", vitas_infuse: "vitas_infuse", vitas_rip: "vitas_rip",
    kolt_mod: "kolt_mod", kolt_cannon: "kolt_cannon", torque_boost: "torque_boost", torque_divert: "torque_divert",
    ras_dump: "ras_dump", ras_torrent: "ras_torrent", edc_flash: "edc_flash", edc_siphon: "edc_siphon",
    longge_drink: "longge_drink", xiaoxiao_combo: "xiaoxiao_combo", role_pull: "role_pull"
  };
  /** 这个技能有没有专属演出：返回脚本名（发给联机玩家的就是它） */
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function scriptOf(skillId) { const k = hasOwn(SCRIPT_OF, String(skillId || "")) ? SCRIPT_OF[String(skillId)] : null; return k && hasOwn(SCRIPTS, k) ? k : null; }
  /** 按名字取脚本（联机玩家收到的脚本名只在这张表里查，查不到就照通用的招式演） */
  function script(name) { return typeof name === "string" && hasOwn(SCRIPTS, name) ? SCRIPTS[name] : null; }
  /* 给脚本用的几个包装：沿用上面弹道 / 冰棱的画法 */
  function glob0(a, b, o) { o = o || {}; const ms = Math.max(240, Math.min(o.big ? 640 : 420, dirOf(a, b).d / (o.big ? .7 : .95))); glob(a, b, ms, { fur: false, big: !!o.big }, COL.acid, HOT.acid); return after(ms); }
  function crystal0(a, b, o) { const ms = Math.max(110, Math.min(220, dirOf(a, b).d / 1.9)); crystal(a, b, ms, o, COL.ice, "#ffffff"); return after(ms); }
  function ringFxAt(at, R, c, ms, delay) { add({ dur: ms, delay, draw(k) { const r = R * (.15 + ease.out(k) * .9), w = 4.4 * (1 - ease.in(k)); if (w <= .3) return; const p = new Path2D(); for (let i = 0; i <= 64; i++) { const an = i / 64 * TAU, rr = r + Math.sin(an * 10 + k * 16) * 3.5; i ? p.lineTo(at.x + Math.cos(an) * rr, at.y + Math.sin(an) * rr * .62) : p.moveTo(at.x + Math.cos(an) * rr, at.y + Math.sin(an) * rr * .62); } p.closePath(); line(p, w, c, null, { shadow: false }); } }); }

  function skip() { list = list.filter(e => e.persist); if (!list.length && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); }
  function setClock(fn) { clock = typeof fn === "function" ? fn : () => 1; }
  function busy() { return list.some(e => !e.persist); }

  const api = { resolve, windup, travel, link, impact, area, ko, clash, sparks, tank, aim, clearAim, threat, clearThreat, skip, setClock, busy, after, scriptOf, script, drawErrors: () => drawErrs, KIND, COL, SCRIPT_OF };
  root.AttackFx = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
