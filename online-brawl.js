/* =========================================================
 * 联机玩法「争斗」（#543 第 2 步，docs/pvp.md 第 8 节）：规则在 brawl.js（BRAWL_CFG、brawlCheck、battle.brawl、brawlPolicy），
 * 这里管联机才有的几件事。只在房主一端跑（online-game.js 的 brawl 玩法），和联机单局 online-rogue.js 一样按收件人造视图。
 *   房间   房主定等级段、每队几人（两队一样）、允不允许起身、回合上限、哪一队交给 AI（AI 只能整队，不和真人混编）；
 *          玩家自己选进 1 队或 2 队的空位、选角色（同一队里不能重复，两队之间可以；一个人只在一队，可以操作几个角色），
 *          给自己的角色一项一项选专长、属性加点、血量层改造（草稿记在房主这里；菜单照 brawl.js · brawlChoices，校验照 brawlBuild），
 *          都选好按「准备好」。设定改了、自己的位置 / 养成改了，「准备好」作废，要重新按。
 *   开打   所有位置都有人（或 AI）、所有选了角色的真人都准备好 → 照 battle.brawl 布置（game.js · setupBrawl，规则层再校验一遍）→
 *          按位置把角色分给操控它的人（AI 那一队给 AI 操作者 BRAWL_ROOM_CFG.aiId）→ 翻硬币动画（brawl-ui.js）→ 开战。
 *          行动顺序照联机现在的会话（hotseat.js）：每一轮开始一起排，没动过的单位随时可以换位置。
 *   AI     会话里的一个操作者。房主隔一会儿看一次：轮到 AI 排顺序就照名单排好、确定；轮到 AI 的角色就照 brawlPolicy 里 AI 的那一套
 *          （BattleSim.SKILL_POLICY：BattleSearch.plan 在沙盒里试跑、挑最好的一步）出手一步，演完等一下再想下一步（节奏照 game.js · enemyPhase）；
 *          问到 AI 的协助格挡 / 协助攻击 / 分步选择也替它答（照 brawlPolicy）。AI 的想法、搜索、统计只在房主本机，不进 state、不发给玩家。
 *   结束   照决斗结算（谁赢、两队分数）；房主点「回到房间」= 再来一局：设定、位置、养成都留着（可以重新选，也可以沿用；「准备好」要重新按）。
 * 发给玩家的（viewFor）：设定、两队每个位置的角色和操控者；别人的位置只说「选好没有」，自己的位置才带养成草稿（开打之前互相看不到养成）。
 * online-view.js · projectBrawl 再按白名单过一遍。不含坚毅生命。
 * ========================================================= */
const BRAWL_ROOM_CFG = {
  aiId: "brawl-ai",        // 会话（hotseat.js）里 AI 那一队的操作者
  aiName: "AI",
  // 开房时的设定：等级段（BRAWL_CFG.tiers 的下标）、每队几人、允许起身（照决斗默认）、回合上限（默认不限，打开时界面填 BRAWL_CFG.roundsDefault）、哪一队是 AI
  defaults: { tier: 0, size: 1, stand: true, rounds: null, ai: null },
  tossMs: 2800,            // 翻硬币动画放多久（房主等它放完再开战）
  aiStepMs: 450,           // AI 出手一步之后等多久再想下一步（同 game.js · enemyPhase 里敌人每一步之间的 wait(450)）
  aiTickMs: 250,           // 房主多久看一次轮没轮到 AI
  aiStepsMax: 8            // 一个单位一回合最多出手几步（防止没花掉任何东西的动作一直重复）
};
(function (root) {
  "use strict";
  const C = BRAWL_ROOM_CFG;
  const TYPES = ["brawl.set", "brawl.seat", "brawl.build", "brawl.ready", "brawl.ai"];
  const copy = v => JSON.parse(JSON.stringify(v));
  const fail = text => { throw new Error(text); };
  let enabled = false, hostId = "", room = null, assign = null, policy = null;
  let aiBusy = false, aiAnswering = false, aiNext = 0, aiSteps = {};
  const errors = new Map();   // 每个位置的养成合不合法（按 kit + 等级段 + 草稿记，省得每发一包都重算）
  const game = () => root.OnlineGame || null;
  const G = () => root.GAME || null;
  const H = () => root.HotseatGame || null;
  const teams = () => (typeof brawlTeams === "function" ? brawlTeams() : [{ id: "1队", name: "1 队" }, { id: "2队", name: "2 队" }]);
  const teamName = id => (teams().find(t => t.id === id) || { name: id }).name;
  const cfg = () => (typeof BRAWL_CFG !== "undefined" ? BRAWL_CFG : { tiers: [], sizeMin: 1, sizeMax: 4, roundsDefault: 10 });
  const roundsMax = () => (typeof PVP_DUEL_CFG !== "undefined" ? PVP_DUEL_CFG.roundsMax : 99);
  const kits = () => (typeof brawlHeroKits === "function" ? brawlHeroKits() : []);
  const heroName = kit => { const c = typeof brawlCard === "function" ? brawlCard(kit) : null; return c ? c.name : kit; };
  const roster = () => { const g = game(); return g && g.players ? g.players() : []; };
  const playerName = id => (id === C.aiId ? C.aiName : (roster().find(p => p.id === id) || {}).name || "已离开的玩家");
  const isAi = id => id === C.aiId;
  function active() { const g = game(); return enabled && !!g && g.isHost(); }

  /* ---------- 房间 ---------- */
  const blank = n => Array.from({ length: n }, () => null);
  const emptyBuild = () => ({ attrs: [], feats: [], featFull: [], cyberPlan: null });
  function fresh() {
    const D = C.defaults;
    const r = { no: 1, phase: "setup", tier: D.tier, size: D.size, stand: D.stand, rounds: D.rounds, ai: D.ai, slots: {}, ready: {}, toss: null, result: null };
    teams().forEach(t => { r.slots[t.id] = blank(r.size); });
    if (r.ai) fillAi(r);
    return r;
  }
  function data() { if (!room) room = fresh(); return room; }
  function setupOnly(r) { if (r.phase !== "setup") fail(r.phase === "battle" ? "正在打，打完回到房间再改" : "这一局已经打完：房主点「回到房间」再来一局"); }
  /** AI 那一队的养成：照 brawlSimEntry 的那一套（每个角色都合法的固定一套） */
  function aiSlot(kit, tier) {
    const e = typeof brawlSimEntry === "function" ? brawlSimEntry(kit, tier) : { attrs: [], feats: [], cyberPlan: null };
    return { kit, owner: C.aiId, ai: true, build: { attrs: e.attrs.slice(), feats: e.feats.slice(), featFull: (e.featFull || []).slice(), cyberPlan: e.cyberPlan ? copy(e.cyberPlan) : null } };
  }
  /** AI 那一队的空位随机补上角色（同一队里不重复） */
  function fillAi(r) {
    const list = r.slots[r.ai] || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].ai) continue;
      const used = list.filter(Boolean).map(s => s.kit), left = kits().filter(k => !used.includes(k));
      list[i] = left.length ? aiSlot(left[Math.floor(Math.random() * left.length)], r.tier) : null;
    }
  }
  /** 草稿只收这几样、长度照这个等级段（选了不合法的照样留着，由 brawlChoices 写原因；类型不对的丢掉） */
  function clean(b, tier) {
    b = b && typeof b === "object" && !Array.isArray(b) ? b : {};
    const T = cfg().tiers[tier], R = T && typeof brawlRewards === "function" ? brawlRewards(T.level) : { attrs: [], feats: [] };
    const strs = (v, n) => Array.from({ length: n }, (_, i) => { const x = Array.isArray(v) ? v[i] : null; return typeof x === "string" && /^[\w-]{1,40}$/.test(x) ? x : null; });
    const p = b.cyberPlan && typeof b.cyberPlan === "object" && !Array.isArray(b.cyberPlan) ? b.cyberPlan : null;
    const n = v => Math.max(0, Math.min(9999, Math.floor(Number(v) || 0)));
    const plan = p ? { armor: n(p.armor), shield: n(p.shield), sand: n(p.sand), spirit: p.spirit === true } : null;
    return { attrs: strs(b.attrs, R.attrs.length), feats: strs(b.feats, R.feats.length), featFull: strs(b.featFull, 4).filter(Boolean),
      cyberPlan: plan && (plan.armor || plan.shield || plan.sand || plan.spirit) ? plan : null };
  }
  /** 这个位置的养成哪里还不行（null = 选好了、合法）：照 brawl.js · brawlChoices（最后交给 brawlBuild） */
  function slotError(r, team, index) {
    const s = r.slots[team][index];
    if (!s) return "还空着";
    const key = JSON.stringify([s.kit, r.tier, s.build]);
    if (errors.has(key)) return errors.get(key);
    const ch = typeof brawlChoices === "function" ? brawlChoices(s.kit, r.tier, s.build) : null;
    const why = ch ? ch.error : "没有这名角色";
    if (errors.size > 200) errors.clear();
    errors.set(key, why);
    return why;
  }
  function slotAt(r, team, index) {
    if (!teams().some(t => t.id === team)) fail("没有这一队");
    if (!Number.isInteger(index) || index < 0 || index >= r.size) fail("没有这个位置");
    return r.slots[team][index];
  }
  const mySlots = (r, who) => teams().flatMap(t => r.slots[t.id].map((s, i) => ({ team: t.id, index: i, slot: s })).filter(x => x.slot && !x.slot.ai && x.slot.owner === who));

  /** 房主定设定：{ tier, size, stand, rounds, ai } 给哪几样改哪几样。改了设定大家重新按「准备好」 */
  function setOptions(sender, opt) {
    const r = data();
    if (sender !== hostId) fail("只有房主能改争斗的设定");
    setupOnly(r);
    opt = opt && typeof opt === "object" ? opt : {};
    const next = {}, T = cfg().tiers;
    if ("tier" in opt) { if (!(Number.isInteger(opt.tier) && opt.tier >= 0 && opt.tier < T.length)) fail(`等级段只有 ${T.map(t => t.name).join("、")}`); next.tier = opt.tier; }
    if ("size" in opt) { if (!(Number.isInteger(opt.size) && opt.size >= cfg().sizeMin && opt.size <= cfg().sizeMax)) fail(`每队人数要 ${cfg().sizeMin}–${cfg().sizeMax}（两队一样）`); next.size = opt.size; }
    if ("stand" in opt) { if (typeof opt.stand !== "boolean") fail("允许起身只能是开或关"); next.stand = opt.stand; }
    if ("rounds" in opt) { if (opt.rounds !== null && !(Number.isInteger(opt.rounds) && opt.rounds >= 1 && opt.rounds <= roundsMax())) fail(`回合上限要在 1 到 ${roundsMax()} 之间（或者不限）`); next.rounds = opt.rounds; }
    if ("ai" in opt) { if (opt.ai !== null && !teams().some(t => t.id === opt.ai)) fail("没有这一队"); next.ai = opt.ai; }
    if (!Object.keys(next).length) fail("没有要改的设定");
    if ("tier" in next && next.tier !== r.tier) {
      r.tier = next.tier;
      // 换了等级段：每个人的草稿按新等级段的项数截短 / 补空（能沿用的照旧留着，不合法的由菜单写原因）；AI 那一队照新等级段重配
      teams().forEach(t => r.slots[t.id].forEach((s, i) => { if (s) r.slots[t.id][i] = s.ai ? aiSlot(s.kit, r.tier) : Object.assign({}, s, { build: clean(s.build, r.tier) }); }));
    }
    if ("size" in next && next.size !== r.size) { r.size = next.size; teams().forEach(t => { const old = r.slots[t.id]; r.slots[t.id] = blank(r.size).map((_, i) => old[i] || null); }); }
    if ("stand" in next) r.stand = next.stand;
    if ("rounds" in next) r.rounds = next.rounds;
    if ("ai" in next && next.ai !== r.ai) {
      if (r.ai) r.slots[r.ai] = blank(r.size);        // 原来的 AI 队空出来给真人选
      r.ai = next.ai;
      if (r.ai) r.slots[r.ai] = blank(r.size);        // 交给 AI：这一队原来的真人让出来（AI 只能整队）
    }
    if (r.ai) fillAi(r);
    r.ready = {};
    return { ok: true };
  }
  /** 玩家选位置 / 换角色（kit）/ 让出位置（kit = null）。同一队里角色不能重复，两队之间可以；一个人只在一队 */
  function seat(sender, team, index, kit) {
    const r = data();
    setupOnly(r);
    const cur = slotAt(r, team, index);
    if (team === r.ai) fail(`${teamName(team)}交给了 AI：AI 只能整队，真人不能选进去`);
    if (cur && cur.owner !== sender) fail(`这个位置已经有人了（${playerName(cur.owner)}）`);
    if (kit == null) {
      if (!cur) fail("这个位置本来就空着");
      r.slots[team][index] = null; delete r.ready[sender];
      return { ok: true };
    }
    if (typeof kit !== "string" || !kits().includes(kit)) fail("没有这名角色");
    const other = teams().find(t => t.id !== team);
    if (other && r.slots[other.id].some(s => s && !s.ai && s.owner === sender)) fail(`你已经在${other.name}了：一个人只能选一队（先让出${other.name}的位置）`);
    if (r.slots[team].some((s, i) => s && i !== index && s.kit === kit)) fail(`${teamName(team)}里已经有${heroName(kit)}了（同一队里角色不能重复，两队之间可以）`);
    r.slots[team][index] = { kit, owner: sender, build: cur && cur.kit === kit ? cur.build : clean(null, r.tier) };
    delete r.ready[sender];
    return { ok: true };
  }
  /** 给自己的角色存养成草稿（没选完也存；合不合法看 brawlChoices，按「准备好」时才拦） */
  function setBuild(sender, team, index, build) {
    const r = data();
    setupOnly(r);
    const cur = slotAt(r, team, index);
    if (!cur || cur.ai || cur.owner !== sender) fail("只能给自己的角色选养成");
    cur.build = clean(build, r.tier);
    delete r.ready[sender];
    return { ok: true };
  }
  /** 准备好（on = true）：自己的角色都选好、都合法才行，不行就写清楚是哪一个、哪里不行 */
  function setReady(sender, on) {
    const r = data();
    setupOnly(r);
    if (typeof on !== "boolean") fail("准备好只能是开或关");
    if (!on) { delete r.ready[sender]; return { ok: true }; }
    const mine = mySlots(r, sender);
    if (!mine.length) fail("你还没有选角色：先选进 1 队或 2 队的空位");
    for (const m of mine) {
      const why = slotError(r, m.team, m.index);
      if (why) fail(`${teamName(m.team)}第 ${m.index + 1} 个角色（${heroName(m.slot.kit)}）：${why}`);
    }
    r.ready[sender] = true;
    return { ok: true };
  }
  /** 房主给 AI 那一队换角色（kit = null：随机换一个） */
  function aiPick(sender, index, kit) {
    const r = data();
    if (sender !== hostId) fail("只有房主能给 AI 那一队选角色");
    setupOnly(r);
    if (!r.ai) fail("还没有交给 AI 的队");
    slotAt(r, r.ai, index);
    if (kit == null) { r.slots[r.ai][index] = null; fillAi(r); r.ready = {}; return { ok: true }; }
    if (typeof kit !== "string" || !kits().includes(kit)) fail("没有这名角色");
    if (r.slots[r.ai].some((s, i) => s && i !== index && s.kit === kit)) fail(`${teamName(r.ai)}里已经有${heroName(kit)}了（同一队里角色不能重复，两队之间可以）`);
    r.slots[r.ai][index] = aiSlot(kit, r.tier);
    r.ready = {};
    return { ok: true };
  }
  /** 能不能开打：{ ok, why: [原因…] }（每个位置都有人或 AI、每个真人的养成合法、选了角色的真人都按了「准备好」） */
  function startable(r) {
    r = r || data();
    const why = [];
    if (r.phase !== "setup") why.push(r.phase === "battle" ? "正在打" : "这一局已经打完");
    teams().forEach(t => r.slots[t.id].forEach((s, i) => {
      if (!s) why.push(`${t.name}第 ${i + 1} 个位置还空着`);
      else if (!s.ai) { const e = slotError(r, t.id, i); if (e) why.push(`${t.name}第 ${i + 1} 个角色（${heroName(s.kit)}）：${e}`); }
    }));
    const owners = [...new Set(teams().flatMap(t => r.slots[t.id].filter(s => s && !s.ai).map(s => s.owner)))];
    owners.forEach(id => { if (!r.ready[id]) why.push(`${playerName(id)} 还没按「准备好」`); });
    return { ok: !why.length, why };
  }
  /** 一个位置交给规则层的那一份（battle.brawl 的一个角色：{ kit, feats, attrs, featFull, cyberPlan }） */
  function entryOf(s, tier) {
    const ch = typeof brawlChoices === "function" ? brawlChoices(s.kit, tier, s.build) : null;
    if (!ch) return { kit: s.kit, feats: [], attrs: [] };
    const plan = ch.cyber.plan && (ch.cyber.plan.armor || ch.cyber.plan.shield || ch.cyber.plan.sand || ch.cyber.plan.spirit) ? ch.cyber.plan : null;
    const e = { kit: s.kit, feats: ch.feats.map(f => f.pick), attrs: ch.attrs.map(a => a.pick), cyberPlan: plan };
    if (ch.full.need) e.featFull = ch.full.picks.slice();
    return e;
  }
  /** 照房间现在的设定和位置写成指令 battle.brawl（brawl.js · brawlSetup 的 spec） */
  function spec(r) {
    r = r || data();
    const s = { type: "battle.brawl", tier: r.tier, size: r.size, stand: r.stand, teams: {}, ai: {} };
    if (r.rounds) s.rounds = r.rounds;
    teams().forEach(t => { s.teams[t.id] = r.slots[t.id].map(x => entryOf(x, r.tier)); s.ai[t.id] = r.ai === t.id; });
    return s;
  }
  /** 开打（房主，online-game.js · start）：布置战场（game.js · setupBrawl）、记下每个单位归谁操控。返回 { 单位 id: 操作者 id } */
  function start() {
    const r = data();
    const ok = startable(r);
    if (!ok.ok) fail("还不能开打：" + ok.why.join("；"));
    const g = G();
    if (!g || typeof g.setupBrawl !== "function") fail("这个版本不能开争斗");
    if (typeof Screens !== "undefined" && Screens && typeof Screens.show === "function") Screens.show("battle");
    const pub = g.setupBrawl(spec(r));   // 规则层（brawlCheck）再校验一遍，不合法这里抛出原因、房间照旧
    assign = {};
    teams().forEach(t => ((pub.brawl && pub.brawl.teams[t.id]) || []).forEach((row, i) => { const s = r.slots[t.id][i]; if (s) assign[row.id] = s.ai ? C.aiId : s.owner; }));
    r.phase = "battle"; r.result = null;
    r.toss = { no: r.no, first: (pub.duel && pub.duel.first) || null };
    policy = typeof brawlPolicy === "function" ? brawlPolicy() : null;
    aiBusy = false; aiAnswering = false; aiNext = 0; aiSteps = {};
    return copy(assign);
  }
  /** 打完了（online-game.js 看到 battle.finish）：房间进「打完了」，等房主点「回到房间」 */
  function finished(result) {
    const r = data();
    if (r.phase !== "battle") return;
    r.phase = "ended";
    const d = result && result.duel && result.duel.result;
    r.result = d ? { winner: d.winner || null, draw: !!d.draw, why: d.why || null } : null;
  }
  /** 再来一局（房主）：设定、位置、养成都留着，「准备好」要重新按 */
  function again(sender) {
    const r = data();
    if (sender !== hostId) fail("只有房主能再来一局");
    if (r.phase === "setup") return { ok: true };
    if (r.phase === "battle" && !(G() && G().ended)) fail("这一局还没打完");
    r.phase = "setup"; r.no++; r.ready = {}; r.toss = null; r.result = null;
    assign = null; policy = null; aiBusy = false; aiAnswering = false; aiSteps = {};
    return { ok: true };
  }
  /** 房间名单变了：离开房间（座位被释放）的人让出位置、「准备好」作废 */
  function changed() {
    if (!room) return;
    const ids = roster().map(p => p.id);
    if (room.phase === "setup") teams().forEach(t => room.slots[t.id].forEach((s, i) => { if (s && !s.ai && !ids.includes(s.owner)) room.slots[t.id][i] = null; }));
    Object.keys(room.ready).forEach(id => { if (!ids.includes(id)) delete room.ready[id]; });
  }
  /** 会话里另外要加的操作者：有 AI 队时加上 AI */
  function operators() { return data().ai ? [{ id: C.aiId, name: C.aiName, ai: true }] : []; }
  /** 现在场上的角色归谁（开打时记的；不在场的、已经不在房间里的人不给）。没开打返回 {} */
  function assignments(ids) {
    const out = {}, units = (typeof state !== "undefined" && state && state.units) || [];
    Object.keys(assign || {}).forEach(id => { const who = assign[id]; if (units.some(u => u.id === id) && (isAi(who) || !ids || ids.includes(who))) out[id] = who; });
    return out;
  }

  /* ---------- 发给每个人的视图 ---------- */
  function viewFor(id) {
    const r = data(), setup = r.phase === "setup";
    const st = setup ? startable(r) : { ok: false, why: [] };
    const out = { no: r.no, phase: r.phase, tier: r.tier, size: r.size, stand: r.stand, rounds: r.rounds, ai: r.ai, host: id === hostId,
      toss: r.toss ? copy(r.toss) : null, result: r.result ? copy(r.result) : null, ready: Object.keys(r.ready).filter(k => r.ready[k]),
      start: { ok: st.ok, why: st.why.slice(0, 12) }, teams: {} };
    teams().forEach(t => {
      out.teams[t.id] = r.slots[t.id].map((s, i) => {
        if (!s) return { index: i, kit: null, owner: null, ownerName: "", mine: false, ai: t.id === r.ai, done: false };
        const mine = !s.ai && s.owner === id;
        const row = { index: i, kit: s.kit, owner: s.owner, ownerName: playerName(s.owner), mine, ai: !!s.ai, done: s.ai ? true : setup ? !slotError(r, t.id, i) : true };
        // 养成草稿只给这个位置的主人（开打之前互相看不到养成）；AI 那一队的也不发
        if (mine && setup) row.build = copy(s.build || emptyBuild());
        return row;
      });
    });
    return out;
  }

  /* ---------- AI 整队：轮到它时房主替它排顺序、出手、回答 ---------- */
  const scope = (u, fn) => (typeof withKitScope === "function" ? withKitScope(u, fn) : fn());
  /** 去掉试跑用的字段，写成玩家发的那种指令（同 sim-search.js · execute） */
  function plainCmd(cmd) {
    const c = copy(cmd); delete c.label;
    if (c.type === "move") { delete c.target; delete c.picks; delete c.skill; }
    else if (c.type === "useItem") { delete c.picks; delete c.skill; if (c.dest == null) delete c.dest; }
    else if (c.type === "skill") { if (c.target == null) delete c.target; if (!c.picks) c.picks = {}; }
    return c;
  }
  /** 这个 AI 单位下一步做什么（照 brawlPolicy：AI 的那一队用 SKILL_POLICY）；null = 结束它的行动 */
  function decide(u) {
    if (!policy && typeof brawlPolicy === "function") policy = brawlPolicy();
    if (!u || !policy || !policy.ai) return null;
    return scope(u, () => {
      const weapon = typeof isWeaponUnit === "function" && isWeaponUnit(u);
      if (u.dying && !weapon) {
        // 倒地：照 BASIC_POLICY 起身（决斗设成不允许起身时不起身）
        if (typeof pvpDuelNoStand === "function" && pvpDuelNoStand(u)) return null;
        return typeof BattleSim !== "undefined" && BattleSim.BASIC_POLICY.act(u) ? { type: "standUp", actor: u.id } : null;
      }
      if (u.stunned || ((u.ap || 0) <= 0 && (u.bonus || 0) <= 0)) return null;
      if (typeof BattleSearch === "undefined") return null;
      const tok = BattleSearch.plan(u.id, policy.ai, policy.ai.cfg);
      policy.ai.stats.decisions++;
      if (!tok) return null;
      policy.ai.stats.actions++;
      return plainCmd(BattleSearch.resolve(tok));
    });
  }
  const sig = u => (u ? [u.ap, u.bonus, u.zone, !!u.dying, !!u.upOnShp, u.hidden ? 1 : 0].join("|") : "gone");
  /** AI 的一个单位出手一步（演完才返回）；想不出来、规则不让、出手了却什么都没花掉，就结束这个单位的行动 */
  async function step(unitId) {
    const key = `${(typeof state !== "undefined" && state.turnNo) || 0}:${H() ? H().segment() : ""}:${unitId}`;
    const n = (aiSteps[key] = (aiSteps[key] || 0) + 1);
    const u = typeof unitById === "function" ? unitById(unitId) : null;
    let cmd = null;
    if (n <= C.aiStepsMax) { try { cmd = decide(u); } catch (e) { console.error(e); cmd = null; } }
    if (cmd) {
      const before = sig(u);
      const r = await game().actAs(C.aiId, cmd);
      const after = typeof unitById === "function" ? unitById(unitId) : null;
      if (r && r.ok !== false && (sig(after) !== before || !after)) return;
      if (r && r.ok === false) console.warn("争斗 AI：这一步没做成，结束这个单位的行动", cmd, r.error);
    }
    // 结束这个单位的行动（同玩家点「结束行动」）；轮到的已经不是它了就不用
    if (H() && H().currentUnit() === unitId) await game().actAs(C.aiId, { type: "endTurn", actor: unitId });
  }
  /** 问到 AI 的询问 / 分步选择怎么答（照 brawlPolicy：协助格挡挑成功率最高的、协助攻击挑攻击力最高的；分步选择挑第一项——起身、不换刀头这些默认的） */
  function answerFor(ask) {
    const opts = ask.options || [], none = { type: "answer", askId: ask.id, helper: null, extra: {} };
    const unit = id => (typeof unitById === "function" ? unitById(id) : null);
    if (ask.kind === "choice") { const o = opts[0]; return o ? { type: "answer", askId: ask.id, helper: o.helper, extra: o.extra || {} } : null; }
    if (ask.kind === "block") {
      const job = (state.blockQueue || [])[0];
      const attacker = job && typeof blockJobAttacker === "function" ? blockJobAttacker(job) : null, target = job ? unit(job.targetId) : null;
      const normal = opts.filter(o => !(o.extra && o.extra.ironwall));
      const helpers = normal.map(o => unit(o.helper)).filter(Boolean);
      let pick = null;
      try { pick = helpers.length && attacker && target && policy ? scope(target, () => policy.ai.pickBlocker(helpers, attacker, target)) : null; } catch (e) { pick = null; }
      const o = normal.find(x => x.helper === pick);
      return o ? { type: "answer", askId: ask.id, helper: o.helper, extra: o.extra || {} } : none;
    }
    if (ask.kind === "assist") {
      const job = (state.assistQueue || [])[0], target = job ? unit(job.targetId) : null;
      const helpers = [...new Set(opts.map(o => o.helper))].map(unit).filter(Boolean);
      let pick = null;
      try { pick = helpers.length && target && policy ? policy.ai.pickAssister(helpers, target) : null; } catch (e) { pick = null; }
      const o = opts.find(x => x.helper === pick);
      return o ? { type: "answer", askId: ask.id, helper: o.helper, extra: o.extra || {} } : none;
    }
    return none;
  }
  /** 回答 / 排顺序（马上执行的指令，不用等演出）：一次只发一条 */
  function quick(cmd) {
    if (!cmd) return;
    aiAnswering = true;
    Promise.resolve().then(() => game().actAs(C.aiId, cmd)).catch(e => console.error(e)).finally(() => { aiAnswering = false; });
  }
  /** 房主每隔 aiTickMs 看一次：AI 要答的询问 / 分步选择（AI 自己出手的演出里也会问到它：协助攻击、换刀头……，所以不等出手的那一步）、
   *  发给 AI 的换位置请求、AI 排顺序、轮到 AI 的单位出手 */
  function tick() {
    if (!active() || !room || room.phase !== "battle" || !room.ai || aiAnswering) return;
    const g = game(), gm = G(), h = H();
    if (!gm || !h || !h.isActive() || g.isPaused() || gm.ended) return;
    const v = h.getViewFor(C.aiId), ask = v.ask;
    if (ask && ask.eligible && !ask.declined && !ask.raised) return quick(answerFor(ask));
    if (v.swap && v.swap.recipient === C.aiId) return quick({ type: "orderSwapAccept", requestId: v.swap.requestId, accept: false });   // 换位置请求：AI 不换
    if (aiBusy) return;
    if (v.phase === "picking") {
      const mine = (v.units || []).filter(u => u.owner === C.aiId), order = v.order || [];
      const placed = new Set(order.filter(Boolean).map(r => r.actor));
      const todo = mine.find(u => !placed.has(u.id)), free = order.findIndex(r => !r);
      if (todo && free >= 0) return quick({ type: "orderPick", actor: todo.id, index: free });
      if (mine.length && !todo && !(v.confirmed || []).includes(C.aiId)) return quick({ type: "orderConfirm" });
      return;
    }
    if (v.phase === "acting" && !gm.depth && !h.hasAsk() && Date.now() >= aiNext) {
      const row = (v.order || []).find(r => r && r.current);
      if (row && row.owner === C.aiId) {
        aiBusy = true;
        step(row.actor).catch(e => console.error(e)).finally(() => { aiBusy = false; aiNext = Date.now() + C.aiStepMs; });
      }
    }
  }
  if (typeof setInterval === "function") setInterval(() => { try { tick(); } catch (e) { console.error(e); } }, C.aiTickMs);

  /* ---------- 存档（房主刷新页面后接着用） ---------- */
  // 开打时规则层收起来的队伍档案 / 背包（brawl.js · brawlStash）也存进来：刷新以后打完照样放回去
  function checkpoint() { return room ? copy({ room, assign, stash: typeof brawlStashSave === "function" ? brawlStashSave() : null }) : null; }
  function restore(saved) {
    const r = saved && saved.room && typeof saved.room === "object" ? copy(saved.room) : null;
    room = r && r.slots ? r : fresh();
    assign = saved && saved.assign && typeof saved.assign === "object" ? copy(saved.assign) : null;
    if (saved && saved.stash && typeof brawlStashLoad === "function") brawlStashLoad(saved.stash);
    policy = room.phase === "battle" && typeof brawlPolicy === "function" ? brawlPolicy() : null;
    aiBusy = false; aiAnswering = false; aiSteps = {};
  }

  function handle(sender, cmd) {
    if (!enabled) fail("这个房间不是争斗");
    if (!cmd || !TYPES.includes(cmd.type)) fail("未知的争斗指令");
    if (cmd.type === "brawl.set") return setOptions(sender, cmd);
    if (cmd.type === "brawl.seat") return seat(sender, String(cmd.team || ""), cmd.index, cmd.kit == null ? null : cmd.kit);
    if (cmd.type === "brawl.build") return setBuild(sender, String(cmd.team || ""), cmd.index, cmd.build);
    if (cmd.type === "brawl.ready") return setReady(sender, cmd.on);
    return aiPick(sender, cmd.index, cmd.kit == null ? null : cmd.kit);
  }
  root.OnlineBrawl = {
    CFG: C, TYPES,
    enable(on, host) { enabled = !!on; hostId = host || hostId; if (enabled && !room) room = fresh(); if (!enabled) { room = null; assign = null; policy = null; } },
    isOn: () => enabled, handle, viewFor, start, again, finished, changed, operators, assignments, checkpoint, restore, spec: () => spec(), startable: () => startable(),
    isAi, inBattle: () => !!room && room.phase === "battle",
    /** 开打布置好了、还没开战（房主刷新恢复后要接着开战） */
    needsStart: () => !!room && room.phase === "battle" && typeof state !== "undefined" && !state.combatStarted,
    tick, decide, answerFor,
    // 测试用：房间的内部状态（只在房主本机）
    _room: () => (room ? copy(room) : null)
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
