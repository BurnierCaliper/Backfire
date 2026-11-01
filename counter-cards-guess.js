/* High Flux 黑市玩法：猜大猜小（#489）· 规则引擎
 * 庄家（AI / 黑市 NPC / 跑团主持人；庄家筹码无限，不用做决定）随机抽 1 张攻击元素牌（7 选 1）、1 张天气（7 选 1）、1 张层牌（5 选 1），
 * 都盖在场上；玩家猜这一手的得分：−2 / −1 / 0 / +1 / +2（超出 ±2 按 ±2 计）。
 * 计分直接用 counter-cards.js · CounterCards.score（克制表 + 天气修正，和 High Flux 同一套）；
 *   相位（主人 10/30）：只把克制分翻倍（+1→+2、−1→−2，0 不变），不加天气修正。
 * 分阶段下注（主人 10/30）：
 *   1. 三张都盖好 → 第一轮下注（245 种组合）
 *   2. 翻开元素 → 第二轮下注（35 种）
 *   3. 翻开天气 → 第三轮下注（5 种）
 *   4. 翻开层牌，结算
 *   每轮可押任意几格（一次交上来），押注按下注那一刻的赔率锁定；所有该押的人都押完 / 不押了才翻下一张。
 *   防白看：每局入场费（不退）；每轮每格有最低注（2 / 4 / 8，按桌子倍率）；第一轮没押的人，后两轮不能再押。
 * 赔率（连本带利，主人 10/30 的勘误）= 32/35 × N ÷ k：N = 还没排除的组合数，k = 其中得出这个结果的组合数；
 *   不满 5 倍向下取到 0.5，满 5 倍向下取整；赔出半枚向下取整。
 *   不开盘：k = 0（不可能）、k = N（必中），以及算出来 ≤ 1 倍的格子（猜中也只拿回本金，第三轮 k = 4 就是这样）。
 *   赔率由代码按分布现算（tally / board），不抄表。
 * 所有数值都在 GUESS_CONFIG，加载时挂到 CounterCards.CC_CONFIG.guess 上（和 High Flux 的配置在一起；
 * 写在这个新文件里，免得和别的 PR 改同一处）。规则层不碰网页：界面在 counter-cards-guess-ui.js。
 *
 *   const h = CounterCardsGuess.newHand({ seed: "A", table: "street", players: [{ id: "p1", name: "你", chips: 50 }] });
 *   CounterCardsGuess.toAct(h)                               → 现在等哪些玩家下注（id 列表；同一轮里谁先谁后都行）
 *   CounterCardsGuess.legal(h, "p1")                         → 这名玩家现在能做的：bet（开盘的格子、每格最低注、最多押多少）/ pass
 *   CounterCardsGuess.act(h, "p1", { type: "bet", bets: { "0": 2, "-1": 4 } })   → 这一轮押哪几格、各押多少（一次交上来）
 *   CounterCardsGuess.act(h, "p1", { type: "pass" })         → 这一轮不押（第一轮不押 = 这一手后面都不能押）
 *   CounterCardsGuess.view(h, "p1")                          → 这名玩家能看到的（没翻开的牌、种子都不在里面）
 *   CounterCardsGuess.board({ element: "fire" })             → 这一步的赔率表：每种结果的 k、赔率、开不开盘
 * 赌命版（黑市 NPC 当庄）：
 *   CounterCardsGuess.newHand({ table: GUESS_CONFIG.life.id, players: [{ id: "ruby", name: "瑞比" }] })   → 押坚毅的一手（只要 id 和名字）
 *   CounterCardsGuess.act(h, "ruby", { type: "bet", bets: { "0": true } })   → 每格押上这一轮的固定点数
 *   CounterCardsGuess.lifeBill(h, "ruby")                    → 结算后给接入的那一边的账（押输了几点、奖品）：由它去扣坚毅、发奖；界面不用
 * 赌场桌（#528，钱在 casino.js：长线养成、本机跑团的赌场）：
 *   CounterCardsGuess.newHand({ table: "guess-hall", players: [{ id: "me", name: "你", chips: 买入 }], entryPaid: true })
 *                                                            → 赌场坐下时已经从钱包收过入场费（entryPaid），这一手只记在 paid 里、不从桌上的筹码扣
 *   CounterCardsGuess.setTopUp(fn)                           → 桌上不够这一轮的最低注时先从钱包补（casino.js 加载时注入 Casino.refill，同 #520）
 * 多人同桌押同一手（#556，主人 11/01：「得要有人赢有人输才好玩」；这一步只有规则层，界面、联机以后接）：
 *   好几个人坐同一桌、看同一组盖着的牌，彼此押了哪几格、押多少都公开（view 的 me / others）；结算给出这一手的输赢排名（ranking）。
 *   桌型（kind，开桌时选，GUESS_CONFIG.kinds）：
 *     "house" 赌场桌（默认）：照上面的固定赔率，大家都对赌场，各算各的（和一个人坐时一样）；收入场费。
 *     "pool"  彩池桌：每一轮单独一个彩池（这一轮押的注只和这一轮押中的人分），赌场抽成（GUESS_CONFIG.pool.rake，代替入场费），
 *             剩下的由押中的人按注额比例分（每人分到的向下取整）；押的时候赔率不锁定，翻完牌按最终的池子算。
 *             分不出去的（没人押中的整个池、分剩的零头）滚存到下一手同一轮的池（carry；配置可以改成归赌场）。
 *   NPC 赌客（GUESS_CONFIG.npc）：真人不够 fillTo 个时补 NPC，钱由赌场出、赢了回赌场；只看公开的 view（看不到盖着的牌），
 *     下注用这一手的种子（同一种子、同样的局面押得一样）。NPC 自己押：一开这一轮就押的（early）在真人之前，看局面再押的（late）在真人都押完之后。
 *   CounterCardsGuess.newHand({ kind: "pool", players: [甲, 乙], carry: 上一手的 carryOf(h) })   → 彩池桌（人不够 fillTo 自动补 NPC；npc: false 不补）
 *   CounterCardsGuess.newHand({ kind: "house", npc: true, players: [...] })   → 赌场桌也补 NPC（不写 npc：赌场桌默认不补）
 *   CounterCardsGuess.poolBoard(h, round)                    → 彩池桌这一轮的即时赔率板：池子多大、每格押了多少、「现在押中大约能分几倍」
 *   CounterCardsGuess.carryOf(h)                             → 彩池桌结算后每一轮滚存到下一手的枚数（下一手 newHand 的 carry）
 *   CounterCardsGuess.npcDecide(NPC 的 view, 习惯, 随机数)     → NPC 这一轮押什么（只读 view，测试也用它）
 */
(function (root) {
  "use strict";

  /* ---------- 配置：所有数值都在这里（挂在 CounterCards.CC_CONFIG.guess 上） ---------- */
  const GUESS_CONFIG = {
    name: "猜大猜小",                  // 玩法名（界面写「High Flux · 猜大猜小」）
    results: [-2, -1, 0, 1, 2],        // 能押的结果；得分超出这个范围按两头算（±2）
    // 翻牌顺序：第一轮下注 → 翻 order[0] → 第二轮 → 翻 order[1] → 第三轮 → 翻 order[2] 结算
    order: ["element", "weather", "layer"],
    // 赔率（连本带利）= odds[0] / odds[1] × N ÷ k（主人 10/30 勘误：32/35，名义抽水约 8.6%，取整后实际 10%–22% 上下）
    odds: [32, 35],
    halfBelow: 5,                      // 不满 5 倍的向下取到 0.5，满 5 倍的向下取整
    closeAtOrBelow: 1,                 // 算出来 ≤ 1 倍（猜中也只拿回本金）的格子不开盘；k = 0、k = N 本来就不开
    phase: { weather: "phase", mult: 2 },   // 相位：只把克制分翻倍，不加天气修正
    entry: 2,                          // 每局入场费（不退）
    minBet: [2, 4, 8],                 // 第 1–3 轮每格最低注
    // 桌子（标题「本地玩法」里的练习桌，筹码不进任何钱包）：mult = 倍率，入场费和每轮最低注都 × 倍率（数值是占位）
    tables: [
      { id: "street", name: "街边桌", mult: 1 },
      { id: "backroom", name: "里屋", mult: 5 }
    ],
    // 赌场桌（#528，主人 10/31；钱照 #487，在 casino.js）：长线养成、本机跑团的赌场能坐，用筹码钱包。
    // 人坐 seat（名字 name），庄家是赌场（筹码无限，不用做决定）；赌场里的一局就是一手。
    // 照另外三种的赌场桌（CC_CONFIG.casino.tables、DUEL_CONFIG.casino……）：倍率 rate = 桌上每枚折多少奎支、最低买入 minBuyIn、
    // 入场费 entryFee（桌上的枚数，坐下时由赌场从钱包收，每局一次、不退；这一手不再从桌上的筹码里扣第二次）。
    // 每轮每格最低注照上面的 minBet（桌上的枚数，赌场桌不再 × mult：桌子之间只差每枚折多少奎支）。
    // 数值先照 High Flux 的三张赌场桌占位，试玩再调；id 全赌场不重复（casino.js 按 id 认桌子）
    casino: {
      seat: "me",
      name: "你",
      tables: [
        { id: "guess-alley", name: "后巷小桌", rate: 10, minBuyIn: 20, entryFee: 2 },
        { id: "guess-hall", name: "大厅", rate: 50, minBuyIn: 30, entryFee: 2 },
        { id: "guess-vip", name: "贵宾室", rate: 200, minBuyIn: 50, entryFee: 2 }
      ]
    },
    // 赌命版（黑市 NPC 当庄，#489 正文 + 主人 10/30 的补充）：押的是坚毅生命。规则层根本不读坚毅——能不能押、能押什么、
    // 画面上写什么，都和角色还剩多少坚毅无关（剩下的比押的少也照样能押：不然试几次就推得出还剩多少）。
    // 每格押上固定代价（第 1–3 轮各几点，规则文字可以写明）；不收入场费；第一轮没押的后两轮照样不能押。
    // 结算：押输的格子只交给接入的那一边（lifeBill）去扣坚毅，画面只写「坚毅受创」，不写数字；扣光即真死（接入层照长线养成 / 跑团的死亡规则）。
    // 赢了：押上的点数 × 赔率（向下取整）折成奎支；单格赔率够高另给稀有材料（取够得着的最高一档）。赔率比普通桌高。
    // 数值都是占位，待主人定；义体奖励还没做（义体不是背包里的东西，要先定怎么给）。
    life: {
      id: "black", name: "黑市赌命桌", dealer: "黑市庄家",
      odds: [35, 35],          // 赔率系数：普通桌 32/35，赌命桌不抽水（占位）
      stake: [1, 2, 4],        // 第 1–3 轮每格押上几点坚毅（固定代价，占位）
      kuizhiPerPoint: 100,     // 赢了：押上的点数 × 赔率（向下取整）× 这么多奎支（占位）
      items: [                 // 单格赔率达到 minOdds 另给的稀有材料（取够得着的最高一档，占位）
        { minOdds: 10, item: "mat_crystal", n: 1 },
        { minOdds: 20, item: "mat_heart", n: 1 }
      ]
    },
    // 桌型（#556，主人 11/01：多人同桌押同一手，开桌时选）。npc = 这种桌子默认补不补 NPC 赌客（newHand 不写 npc 时）。
    // 赌命桌只有押坚毅的那一种（不开彩池、不补 NPC）
    kinds: {
      house: { name: "赌场桌", npc: false },   // 照上面的固定赔率，大家都对赌场；同桌、互相看得到押了什么；收入场费
      pool: { name: "彩池桌", npc: true }      // 彩池：大家的注进同一个池，赌场抽成，剩下的由押中的人按注额比例分；不收入场费
    },
    // 彩池桌（#556）：每一轮单独一个池——第一轮押的注只和第一轮押中的人分，第二、三轮同理（越早押看到的越少，各轮的竞争各算各的）。
    // 每轮每格最低注、第一轮没押的后两轮不能押，照上面（防白看）。数值都是占位，待主人定
    pool: {
      rake: 10,          // 每个池抽百分之几（向下取整）：只抽这一手新押进来的注（滚存进来的不再抽）；代替入场费
      stakeBack: true,   // 押中的人至少拿回本金：池里几乎只有押中那一格的钱时，抽成最多抽到押中的人刚好拿回本金为止
      carry: "next",     // 分不出去的（没人押中的整个池、按比例分剩的零头）："next" 滚存到下一手同一轮的池（累积彩池）；"house" 归赌场
      digits: 1          // 即时赔率板上「大约能分几倍」保留几位小数（向下取）
    },
    // NPC 赌客（#556）：一桌真人不够 fillTo 个时补 NPC 到 fillTo 个，撑起气氛，彩池也不会太小。
    // 钱由赌场出：每手带 stack × 第一轮每格最低注上桌（赌场桌照样交入场费），输赢都是赌场的钱，不进任何玩家的钱包。
    // 只看公开的信息（和玩家同一份 view：没翻开的牌、种子都不在里面）；随机数用这一手的种子（同一种子、同样的局面押得一样）。
    // 每轮最多押一格：押这一轮每格最低注 × stake 里的倍数（随机；手上不够就少押）。
    // when：early = 一开这一轮就押（真人看得到）；late = 真人都押完了再押（看得到真人押了什么——彩池的赔率在翻牌前还会变）。
    // 补谁：名单（roster）按种子洗过，先挑习惯不一样的。数值都是占位
    npc: {
      fillTo: 4,
      stack: 15,
      styles: {
        cautious: { name: "谨慎型", text: "只押概率最高的那格", when: "early", stake: [1, 2], minChance: 0.35 },   // 第二、三轮最高的那格概率不到 minChance 就不押
        gambler: { name: "赌徒型", text: "爱押冷门的 ±2", when: "early", stake: [1, 2], prefer: [-2, 2] },       // prefer 都不开盘时押概率最低的那格
        follower: { name: "跟风型", text: "跟着押得最多的那格", when: "late", stake: [1, 2] },                   // 这一轮还没人押：看前几轮；都没有就押概率最高的
        counter: { name: "算账型", text: "按赔率押最划算的那格", when: "late", stake: [1, 3], minValue: 0.85 }    // 概率 × 赔率；第二、三轮最划算的也不到 minValue 就不押
      },
      roster: [
        { id: "npc-han", name: "老韩", style: "cautious" },
        { id: "npc-ma", name: "麻姐", style: "gambler" },
        { id: "npc-fei", name: "阿飞", style: "follower" },
        { id: "npc-pan", name: "算盘", style: "counter" },
        { id: "npc-ba", name: "疤脸", style: "cautious" },
        { id: "npc-hong", name: "红眼", style: "gambler" },
        { id: "npc-liu", name: "小六", style: "follower" },
        { id: "npc-jing", name: "眼镜", style: "counter" }
      ]
    },
    cardKinds: { element: "元素", weather: "天气", layer: "层牌" }
  };
  const RESULT_LO = () => Math.min.apply(null, GUESS_CONFIG.results);
  const RESULT_HI = () => Math.max.apply(null, GUESS_CONFIG.results);
  const CC = () => root.CounterCards;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function fail(msg) { throw new Error(msg); }
  function needCC() {
    if (!CC() || typeof CC().score !== "function") fail("猜大猜小要先加载 counter-cards.js（High Flux 的计分）");
  }
  const cardName = (c) => (CC() ? CC().cardName(c) : String(c));
  const weatherName = (w) => (CC() ? CC().weatherName(w) : String(w));
  /** 结果写法：+2 / +1 / 0 / −1 / −2 */
  const label = (r) => (r > 0 ? "+" + r : r < 0 ? "−" + Math.abs(r) : "0");

  /* ---------- 计分：直接用 CounterCards.score ---------- */
  /** 这一手的结果：CounterCards.score（克制 + 天气修正）；相位只把克制分翻倍、不加天气修正；超出 ±2 按 ±2 */
  function outcome(element, layer, weather) {
    needCC();
    const P = GUESS_CONFIG.phase;
    const raw = weather === P.weather ? P.mult * CC().chartScore(element, layer, weather) : CC().score(element, layer, weather);
    return Math.max(RESULT_LO(), Math.min(RESULT_HI(), Number(raw) || 0));
  }

  /* ---------- 分布和赔率 ---------- */
  /** 还没排除的组合里每种结果各有几种。known = { element, weather, layer }：写了的是翻开的牌，null / 不写是还盖着的 */
  function tally(known) {
    needCC();
    known = known || {};
    const C = CC().CC_CONFIG;
    const pool = (key, all) => (known[key] != null ? [known[key]] : all);
    const k = {};
    GUESS_CONFIG.results.forEach(r => { k[r] = 0; });
    let N = 0;
    pool("element", C.elements).forEach(el => pool("weather", C.weathers).forEach(w => pool("layer", C.layers).forEach(ly => {
      k[outcome(el, ly, w)] += 1;
      N += 1;
    })));
    return { N, k };
  }
  /** 赔率（连本带利）= num/den × N ÷ k：不满 halfBelow 倍向下取到 0.5，满了向下取整。
   *  不开盘 → null：k = 0（不可能）、k = N（必中）、算出来 ≤ closeAtOrBelow 倍。
   *  用整数算（num·N 和 den·k 比），不会出 6.999… 这种浮点误差。factor = [num, den]，默认 GUESS_CONFIG.odds */
  function oddsOf(N, k, factor) {
    const G = GUESS_CONFIG, f = factor || G.odds;
    N = Math.floor(Number(N) || 0); k = Math.floor(Number(k) || 0);
    if (k <= 0 || k >= N) return null;
    const a = f[0] * N, b = f[1] * k;
    const odds = a < G.halfBelow * b ? Math.floor(2 * a / b) / 2 : Math.floor(a / b);
    return odds > G.closeAtOrBelow ? odds : null;
  }
  /** 押 amount 猜中，连本带利拿回多少：amount × 赔率，半枚向下取整 */
  function payoutOf(amount, odds) {
    return Math.floor(Math.max(0, Math.floor(Number(amount) || 0)) * Math.round((Number(odds) || 0) * 2) / 2);
  }
  /** 这一步的赔率表：{ N, cells: [{ result, k, odds, open }] }（odds = null 不开盘） */
  function board(known, factor) {
    const t = tally(known);
    return { N: t.N, cells: GUESS_CONFIG.results.map(r => { const odds = oddsOf(t.N, t.k[r], factor); return { result: r, k: t.k[r], odds, open: odds != null }; }) };
  }
  /** 彩池桌（#556）这一步能押的格子：没有固定赔率（odds = null，赔率看池子）；还有可能、又不是必中的格子都开（0 < k < N）——
   *  赌场桌「≤ 1 倍不开」是固定赔率的事，彩池桌押大热门也照样能分到别人的钱 */
  function poolCells(known) {
    const t = tally(known);
    return { N: t.N, pool: true, cells: GUESS_CONFIG.results.map(r => ({ result: r, k: t.k[r], odds: null, open: t.k[r] > 0 && t.k[r] < t.N })) };
  }

  /* ---------- 彩池（#556）：每一轮单独一个池 ---------- */
  /** 这一轮的池抽多少：新押进来的 staked 枚 × rake%（向下取整，滚存进来的不再抽）；
   *  stakeBack：最多抽到押中的人刚好拿回本金（room = 池子 − 押中那一格的注，抽成不超过它） */
  function rakeOf(cfg, staked, room) {
    const n = rakeNominal(cfg, staked);
    return cfg.stakeBack ? Math.max(0, Math.min(n, room)) : n;
  }
  /** 押进来 staked 枚，照 rake% 名义上抽多少（向下取整） */
  const rakeNominal = (cfg, staked) => Math.floor(Math.max(0, staked) * cfg.rake / 100);
  /** a ÷ b 向下取到 digits 位小数（整数算，不出 2.999… 这种浮点误差） */
  function floorTo(a, b, digits) {
    const d = Math.pow(10, Math.max(0, Math.floor(Number(digits) || 0)));
    return Math.floor(a * d / b) / d;
  }
  /** 池子算账：carryIn = 滚存进来的，staked = 这一轮押进来的，hit = 押中那一格一共押了多少 → { rake, net（抽成后分给押中的人的）} */
  function poolNet(cfg, carryIn, staked, hit) {
    const rake = rakeOf(cfg, staked, carryIn + staked - hit);
    return { rake, net: carryIn + staked - rake };
  }

  /* ---------- 桌子 ---------- */
  /** 桌子算好入场费和每轮最低注（× 倍率） */
  function tableInfo(t) {
    const G = GUESS_CONFIG, m = Number(t.mult) || 1;
    return { id: t.id, name: t.name, life: false, mult: m, entry: Math.round(G.entry * m), minBet: G.minBet.map(n => Math.round(n * m)), odds: G.odds.slice() };
  }
  /** 赌命桌：押坚毅，每格固定代价（minBet 就是这一轮每格押上几点），不收入场费，赔率系数另算 */
  function lifeTable() {
    const L = GUESS_CONFIG.life;
    return { id: L.id, name: L.name, dealer: L.dealer, life: true, mult: 1, entry: 0, stake: L.stake.slice(), minBet: L.stake.slice(), odds: L.odds.slice() };
  }
  /** 赌场桌（#528）：入场费是这张桌子的 entryFee（坐下时赌场从钱包收），每轮每格最低注照 minBet（桌上的枚数）；
   *  另带倍率 rate（桌上每枚折多少奎支）、最低买入 minBuyIn。赔率、开盘照普通桌 */
  function casinoTableInfo(t) {
    const G = GUESS_CONFIG;
    return { id: t.id, name: t.name, life: false, casino: true, mult: 1, entry: Math.max(0, Math.floor(Number(t.entryFee) || 0)),
      minBet: G.minBet.slice(), odds: G.odds.slice(), rate: t.rate, minBuyIn: t.minBuyIn };
  }
  const casinoTables = () => (GUESS_CONFIG.casino && GUESS_CONFIG.casino.tables) || [];
  /** 普通桌（筹码，本地练习）；赌命桌、赌场桌不在这里：赌命桌用 tableOf(GUESS_CONFIG.life.id)，赌场桌在 GUESS_CONFIG.casino（casino.js 列出来） */
  function tables() { return GUESS_CONFIG.tables.map(tableInfo); }
  function tableOf(id) {
    if (id && id === GUESS_CONFIG.life.id) return lifeTable();
    const c = id ? casinoTables().find(x => x.id === id) : null;
    if (c) return casinoTableInfo(c);
    const t = GUESS_CONFIG.tables.find(x => x.id === (id || GUESS_CONFIG.tables[0].id));
    if (!t) fail("没有这张桌子：" + id);
    return tableInfo(t);
  }
  /** 桌型（#556）：[{ id: "house" / "pool", name }]，开桌时选 */
  function kinds() { return Object.keys(GUESS_CONFIG.kinds).map(id => ({ id, name: GUESS_CONFIG.kinds[id].name })); }
  /** 这一手是哪种桌子（以前存下来的一手没有 kind：都是赌场桌） */
  const kindOf = (h) => (h && h.table && h.table.kind) || "house";
  const isPool = (h) => kindOf(h) === "pool";

  /* ---------- 发牌（种子随机数，和 High Flux 同一个） ---------- */
  /** 这个种子发出的三张牌：元素 7 选 1、天气 7 选 1、层牌 5 选 1，各自均匀（245 种等可能，赔率按这个算） */
  function dealOf(seed) {
    needCC();
    const C = CC().CC_CONFIG, rng = CC().makeRng(String(seed) + "|guess");
    const pick = (list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
    return { element: pick(C.elements), weather: pick(C.weathers), layer: pick(C.layers) };
  }

  /* ---------- 开一手 ---------- */
  /** opt：seed；table（桌子 id，默认第一张；赌命桌是 GUESS_CONFIG.life.id，赌场桌是 GUESS_CONFIG.casino.tables 的 id）；
   *  players：[{ id, name, chips }]（几名玩家同桌，各押各的；赌命桌只要 id 和名字——不收、也不看坚毅）；
   *    写了 npc: true 的是指定坐下的 NPC 赌客 { id, name, npc: true, style（GUESS_CONFIG.npc.styles 的键）, chips（不写照 npc.stack）}；
   *  kind（#556）：桌型 "house" 赌场桌（默认）/ "pool" 彩池桌；赌命桌只有赌场桌一种；
   *  npc（#556）：真人不够时补不补 NPC 赌客——true 补到 GUESS_CONFIG.npc.fillTo 个、数字 = 补到这么多个、false 不补；
   *    不写照桌型的默认（GUESS_CONFIG.kinds[kind].npc：彩池桌补、赌场桌不补）；赌命桌不补；
   *  carry（#556，彩池桌）：上一手滚存过来的、每一轮几枚（上一手的 carryOf）；
   *  entryPaid（赌场桌：坐下时 casino.js 已经从钱包收过入场费——只记在 paid 里，净输赢照样含入场费，不从带上桌的筹码里扣）；
   *  deal（测试用：指定三张牌 { element, weather, layer }） */
  function newHand(opt) {
    opt = opt || {};
    needCC();
    const C = CC().CC_CONFIG;
    const seed = String(opt.seed != null ? opt.seed : Date.now());
    const t = tableOf(opt.table);
    const kind = opt.kind == null ? "house" : String(opt.kind);
    if (!GUESS_CONFIG.kinds[kind]) fail("没有这种桌子：" + kind);
    if (t.life && kind !== "house") fail(`${t.name}押的是坚毅，不开${GUESS_CONFIG.kinds[kind].name}`);
    t.kind = kind;
    if (kind === "pool") t.entry = 0;                  // 彩池桌不收入场费：每个池的抽成代替
    const deal = opt.deal ? { element: opt.deal.element, weather: opt.deal.weather, layer: opt.deal.layer } : dealOf(seed);
    if (C.elements.indexOf(deal.element) < 0) fail("没有这张元素牌：" + deal.element);
    if (C.weathers.indexOf(deal.weather) < 0) fail("没有这张天气：" + deal.weather);
    if (C.layers.indexOf(deal.layer) < 0) fail("没有这张层牌：" + deal.layer);
    const list = opt.players || [];
    if (!list.some(p => !(p && p.npc))) fail("至少要有一名玩家");
    const players = list.map((p, i) => (p.npc ? npcSeat(t, p) : {
      id: String(p.id != null ? p.id : "p" + (i + 1)), name: String(p.name || "玩家" + (i + 1)),
      chips: t.life ? null : Math.max(0, Math.floor(Number(p.chips) || 0)), paid: 0,
      in: true,          // 第一轮押了（或者还没轮到第一轮）：后两轮还能押
      acted: {},         // 第几轮 → "bet" / "pass"
      slips: []          // 押注：{ round, result, amount（赌命桌 = 押上几点坚毅）, odds（下注那一刻锁定；彩池桌不锁定 = null）}
    }));
    // NPC 赌客（#556）：真人不够时补到 fillTo 个（名单按种子洗过，先挑习惯不一样的）；赌命桌不补
    const N = GUESS_CONFIG.npc;
    const want = opt.npc == null ? (GUESS_CONFIG.kinds[kind].npc ? N.fillTo : 0)
      : opt.npc === true ? N.fillTo : Math.max(0, Math.floor(Number(opt.npc) || 0));
    if (t.life && (want > 0 || players.some(p => p.npc))) fail(`${t.name}押的是坚毅，不补 NPC 赌客`);
    pickNpcs(seed, want - players.length, players).forEach(x => players.push(npcSeat(t, x)));
    players.forEach((p, i) => { if (players.findIndex(x => x.id === p.id) !== i) fail("玩家 id 重复：" + p.id); });
    // 入场费（不退）：交不起的坐不上桌。赌命桌不收；赌场桌坐下时已经从钱包收过了（entryPaid），这里只记下；
    // NPC 的入场费从赌场给的筹码里交（都是赌场的钱）；彩池桌不收（entry = 0）
    const prepaid = !!opt.entryPaid && !t.life;
    if (!t.life) players.forEach(p => {
      const pre = prepaid && !p.npc;
      if (!pre && p.chips < t.entry) fail(`${p.name}的筹码不够入场费 ${t.entry} 枚`);
      if (!pre) p.chips -= t.entry;
      p.paid = t.entry;
    });
    // 彩池（#556）：每一轮一个池，开局只有滚存进来的（carryIn）；押进来的注结算时从押注里算，结算后记下抽成、分了多少、滚存多少
    const carry = Array.isArray(opt.carry) ? opt.carry : [];
    carry.forEach(n => { if (!Number.isInteger(n) || n < 0) fail("滚存的枚数要是不小于 0 的整数：" + n); });
    if (kind !== "pool" && carry.some(n => n > 0)) fail("只有彩池桌有滚存");
    const P = GUESS_CONFIG.pool;
    const h = {
      v: 1, mode: "guess", seed, table: t,              // mode：赌场按这个认玩法（同 Flux 的对局，casino.js · gameOf）
      stage: "bet1", round: 1, rounds: GUESS_CONFIG.order.length, over: false,
      secret: deal,                                        // 三张牌（翻开之前谁都看不到，view 里没有）
      shown: { element: null, weather: null, layer: null },   // 翻开的牌
      players, board: null, boards: [], log: [], result: null
    };
    // 抽成、滚存的规则开局时记进这一手（存档读回来照开局时的算）
    if (kind === "pool") h.pool = { rake: P.rake, stakeBack: !!P.stakeBack, carry: P.carry === "house" ? "house" : "next", digits: P.digits,
      rounds: GUESS_CONFIG.order.map((_, i) => ({ round: i + 1, carryIn: carry[i] || 0 })) };
    note(h, { t: "open", text: t.life
      ? `${t.name}：${t.dealer}抽了一张元素、一张天气、一张层牌，都盖在桌上。押的是坚毅生命，每格押上固定的点数。`
      : kind === "pool" ? poolOpenText(h)
      : `${t.name}：庄家抽了一张元素、一张天气、一张层牌，都盖在桌上。入场费 ${t.entry} 枚（${prepaid ? "坐下时交给了赌场，" : ""}不退）。` });
    const npcs = players.filter(p => p.npc);
    if (npcs.length) note(h, { t: "npc", text: `NPC 赌客入座：${npcs.map(p => `${p.name}（${N.styles[p.style].name}）`).join("、")}——赌场请来撑场面的，押的是赌场的钱。` });
    openRound(h, 1);
    return h;
  }
  /** 彩池桌的开局说明：不收入场费、抽几成、分不出去的去哪、上一手滚存进来多少（公开） */
  function poolOpenText(h) {
    const t = h.table, P = h.pool;
    const carried = P.rounds.filter(R => R.carryIn > 0).map(R => `第 ${R.round} 轮 ${R.carryIn} 枚`);
    return `${t.name} · ${GUESS_CONFIG.kinds.pool.name}：庄家抽了一张元素、一张天气、一张层牌，都盖在桌上。不收入场费：每一轮押的注进这一轮的彩池，` +
      `赌场抽 ${P.rake}%，剩下的由这一轮押中的人按注额分（押的时候赔率不锁定，翻完牌按最终的池子算）；` +
      `没人押中的池${P.carry === "house" ? "归赌场" : "滚存到下一手同一轮"}。` + (carried.length ? `上一手滚存进来：${carried.join("、")}。` : "");
  }
  /** NPC 赌客的座位（#556）：钱由赌场出（不写 chips：npc.stack × 第一轮每格最低注） */
  function npcSeat(t, p) {
    const N = GUESS_CONFIG.npc, style = String(p.style || "");
    if (p.id == null) fail("NPC 赌客要有 id");
    if (!N.styles[style]) fail("没有这种 NPC 下注习惯：" + p.style);
    const chips = p.chips != null ? Math.max(0, Math.floor(Number(p.chips) || 0)) : N.stack * t.minBet[0];
    return { id: String(p.id), name: String(p.name || p.id), npc: true, style, chips, paid: 0, in: true, acted: {}, slips: [] };
  }
  /** 补哪几位 NPC（n 位）：名单按这一手的种子洗过，先挑和已经坐下的 NPC 习惯不一样的；已经坐下的 id 不挑 */
  function pickNpcs(seed, n, seated) {
    if (!(n > 0)) return [];
    const rng = CC().makeRng(String(seed) + "|npc"), ids = seated.map(p => p.id);
    const list = GUESS_CONFIG.npc.roster.filter(x => ids.indexOf(String(x.id)) < 0);
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const x = list[i]; list[i] = list[j]; list[j] = x; }
    const used = seated.filter(p => p.npc).map(p => p.style), out = [];
    list.forEach(x => { if (out.length < n && used.indexOf(x.style) < 0) { out.push(x); used.push(x.style); } });
    list.forEach(x => { if (out.length < n && out.indexOf(x) < 0) out.push(x); });
    return out;
  }
  function note(h, entry) { h.log.push(Object.assign({ r: h.round }, entry)); }
  const playerOf = (h, id) => h.players.find(p => p.id === String(id)) || null;
  /** 这一轮能押的人：第一轮是所有人，后两轮只有第一轮押过的（NPC 也一样） */
  const eligible = (h) => h.players.filter(p => h.round === 1 || p.in);
  /** 这一轮还没押的（含 NPC）；toAct 只列真人（NPC 自己押，不用等） */
  const pending = (h) => (h.over ? [] : eligible(h).filter(p => !p.acted[h.round]));

  /* ---------- 桌上不够时先从钱包补（#528，照 #520）：赌场桌由 casino.js 注入，只补接了钱包的那名玩家 ---------- */
  let refill = null;
  /** 注入「补筹码」（casino.js 加载时注入 Casino.refill）：fn(这一手, 玩家 id, 还差几枚) → 补了几枚（已经从钱包拿过来了）；
   *  只有接了钱包的那一手补得到（赌场桌你坐的那个位置），别的（本地练习）fn 返回 0，照旧只能不押 */
  function setTopUp(fn) { refill = typeof fn === "function" ? fn : null; }
  /** 轮到这名玩家这一轮下注、手上不够这一轮每格的最低注：先问注入的钩子补到正好够押一格最低注（钱包不够就有多少补多少）。
   *  补上来的是这名玩家自己的筹码：加进手上的，另记一共补了多少（topUp），写一行公开记录；不算押注，也不算这一手的输赢。
   *  只在开一轮下注的时候补（legal / view 不补）；赌命桌押的是坚毅，不补。返回补了几枚 */
  function topUp(h, p) {
    if (!refill || h.table.life || h.over || p.npc) return 0;   // NPC 的钱是赌场给的，不从谁的钱包补
    const gap = minBetOf(h) - p.chips;
    if (gap <= 0) return 0;
    const n = Math.max(0, Math.floor(Number(refill(h, p.id, gap)) || 0));
    if (!n) return 0;
    p.chips += n;
    p.topUp = (p.topUp || 0) + n;
    note(h, { t: "topUp", by: p.id, amount: n,
      text: `${p.name}从钱包补了 ${n} 枚到桌上${n < gap ? `（钱包只够补这么多，还差 ${gap - n} 枚）` : ""}。` });
    return n;
  }

  /** 开一轮下注：按翻开的牌现算赔率表（彩池桌只算能押哪几格，赔率看池子）；没有开盘的格子（结果已经定了）或者没人能押，直接翻下一张。
   *  要押的人手上不够这一轮的最低注时先从钱包补（赌场桌，#528）；一开这一轮就押的 NPC（early）先押，没有真人要等就收这一轮 */
  function openRound(h, r) {
    h.round = r; h.stage = "bet" + r;
    h.board = isPool(h) ? poolCells(h.shown) : board(h.shown, h.table.odds);
    h.boards.push({ round: r, shown: clone(h.shown), board: clone(h.board) });
    if (!h.board.cells.some(x => x.open)) {
      note(h, { t: "closed", text: `第 ${r} 轮：没有开盘的格子（结果已经定了），直接翻下一张。` });
      advance(h);
    } else if (!eligible(h).length) {
      note(h, { t: "nobody", text: `第 ${r} 轮：第一轮没人押，后面不能再押，直接翻牌。` });
      advance(h);
    } else {
      eligible(h).forEach(p => topUp(h, p));
      npcTurn(h, "early");
      if (!toAct(h).length) closeRound(h);
    }
  }
  /** 真人都押完了：看局面再押的 NPC（late）押，再翻下一张 */
  function closeRound(h) {
    npcTurn(h, null);
    advance(h);
  }
  /** 这一轮都押完了：翻下一张；翻完三张结算 */
  function advance(h) {
    const key = GUESS_CONFIG.order[h.round - 1];
    h.shown[key] = h.secret[key];
    const name = key === "weather" ? weatherName(h.secret[key]) : cardName(h.secret[key]);
    note(h, { t: "reveal", card: key, value: h.secret[key], text: `翻开${GUESS_CONFIG.cardKinds[key]}：${name}。` });
    if (h.round < GUESS_CONFIG.order.length) openRound(h, h.round + 1);
    else settle(h);
  }

  /* ---------- 现在等谁、能做什么 ---------- */
  /** 现在等哪些玩家下注（真人的 id；NPC 自己押，不在里面） */
  function toAct(h) {
    return pending(h).filter(p => !p.npc).map(p => p.id);
  }
  /** 这一轮每格至少押多少（赌命桌 = 每格押上几点坚毅，固定） */
  function minBetOf(h) { return h.table.minBet[Math.max(0, Math.min(h.table.minBet.length - 1, h.round - 1))]; }
  /** 这名玩家现在能做的：
   *  普通桌 { type: "bet", round, cells: [{ result, odds, k }]（开盘的格子）, min（每格至少押多少）, max（几格加起来最多押多少 = 手上的筹码）}
   *  （手上不够最低注就没有这一项；彩池桌的格子 odds = null、另带 pool: true——赔率看池子，见 poolBoard）；
   *  赌命桌 { type: "bet", round, cells, stake（每格押上几点坚毅，固定）, unit: "shp" }——押坚毅永远能下，不看角色还剩多少；
   *  { type: "pass" }。NPC 赌客轮到自己（这一轮还没押）时也有（它照这个挑） */
  function legal(h, id) {
    const p = playerOf(h, id);
    if (!p || pending(h).indexOf(p) < 0) return [];
    const cells = h.board.cells.filter(x => x.open).map(x => ({ result: x.result, odds: x.odds, k: x.k }));
    const out = [];
    const min = minBetOf(h);
    if (cells.length && h.table.life) out.push({ type: "bet", round: h.round, cells, stake: min, unit: "shp" });
    else if (cells.length && p.chips >= min) out.push(Object.assign({ type: "bet", round: h.round, cells, min, max: p.chips }, isPool(h) ? { pool: true } : {}));
    out.push({ type: "pass" });
    return out;
  }

  /* ---------- 操作 ---------- */
  function act(h, id, a) {
    if (h.over) fail("这一手已经结算了");
    const p = playerOf(h, id);
    if (!p) fail("没有这名玩家：" + id);
    if (p.npc) fail(`${p.name}是 NPC 赌客，自己会押`);
    if (!a || typeof a.type !== "string") fail("操作格式不对");
    if (toAct(h).indexOf(p.id) < 0) fail(`现在不是${p.name}下注的时候`);
    play(h, p, a);
    if (!toAct(h).length) closeRound(h);
    return h;
  }
  /** 押注 / 不押（真人、NPC 都走这里） */
  function play(h, p, a) {
    if (a.type === "bet") placeBets(h, p, a.bets);
    else if (a.type === "pass") {
      p.acted[h.round] = "pass";
      if (h.round === 1) p.in = false;
      note(h, { t: "pass", by: p.id, text: h.round === 1 ? `${p.name}第一轮没押，这一手后面都不能再押。` : `${p.name}第 ${h.round} 轮不押。` });
    } else fail("未知操作：" + a.type);
  }
  /** 这一轮押哪几格：bets = { 结果: 押多少 }，每格至少押最低注（整数），几格加起来不超过手上的筹码；不开盘的格子押不进去。
   *  赌命桌每格押的是这一轮的固定代价（写 true 或者正好那个点数），不看、也不扣角色的坚毅（结算后由接入的那一边扣）。
   *  押注按现在这张赔率表锁定；彩池桌不锁定（odds = null，翻完牌按最终的池子算） */
  function placeBets(h, p, bets) {
    const keys = Object.keys(bets && typeof bets === "object" ? bets : {});
    if (!keys.length) fail("至少押一格");
    const min = minBetOf(h), life = h.table.life;
    const lines = keys.map(key => {
      const r = Number(key);
      const cell = h.board.cells.find(x => x.result === r);
      if (!cell) fail("没有这一格：" + key);
      if (!cell.open) fail(`${label(r)} 这一格不开盘`);
      const n = life ? min : Number(bets[key]);
      if (life && bets[key] !== true && Number(bets[key]) !== min) fail(`赌命桌每格押的是固定代价：第 ${h.round} 轮押上 ${min} 点坚毅`);
      if (!life && (!Number.isInteger(n) || n < min)) fail(`第 ${h.round} 轮每格至少押 ${min} 枚（整数）`);
      return { round: h.round, result: r, amount: n, odds: cell.odds };
    });
    if (!life) {
      const total = lines.reduce((s, x) => s + x.amount, 0);
      if (total > p.chips) fail(`筹码不够：这一轮押了 ${total} 枚，手上只有 ${p.chips} 枚`);
      p.chips -= total;
    }
    lines.forEach(x => p.slips.push(x));
    p.acted[h.round] = "bet";
    note(h, { t: "bet", by: p.id, text: life
      ? `${p.name}押上坚毅：${lines.map(x => `${label(x.result)}（${x.odds} 倍，押上 ${x.amount} 点）`).join("、")}。`
      : isPool(h) ? `${p.name}押 ${lines.map(x => `${label(x.result)} ${x.amount} 枚`).join("、")}（进第 ${h.round} 轮的彩池）。`
      : `${p.name}押 ${lines.map(x => `${label(x.result)}（${x.odds} 倍）${x.amount} 枚`).join("、")}。` });
  }

  /* ---------- NPC 赌客（#556）：只看公开的 view，随机数用这一手的种子 ---------- */
  /** 这名 NPC 这一轮的随机数：种子 + NPC + 第几轮（和发牌的随机数分开，同一种子同样的局面押得一样） */
  const npcRng = (h, p) => CC().makeRng(`${h.seed}|npc|${p.id}|${h.round}`);
  /** 这一轮还没押的 NPC 按座位顺序押：when = "early"（一开这一轮就押的）/ null（剩下的都押：真人都押完了） */
  function npcTurn(h, when) {
    const S = GUESS_CONFIG.npc.styles;
    pending(h).filter(p => p.npc && (!when || (S[p.style] && S[p.style].when) === when)).forEach(p => {
      if (h.over || p.acted[h.round]) return;
      play(h, p, npcDecide(view(h, p.id), p.style, npcRng(h, p)));
    });
  }
  /** 一张 view 里这一轮（round；不写 = 所有轮）每格一共押了多少：所有人（含 NPC）的押注都是公开的 */
  function crowdOf(v, round) {
    const out = {};
    [v.me].concat(v.others || []).forEach(s => (s.slips || []).forEach(x => {
      if (round == null || x.round === round) out[x.result] = (out[x.result] || 0) + x.amount;
    }));
    return out;
  }
  /** NPC 这一轮押什么：只读这名 NPC 的 view（和玩家同一份：没翻开的牌、种子都不在里面）+ 下注习惯 + 随机数。
   *  返回 { type: "bet", bets: { 结果: 枚数 } }（每轮最多押一格）/ { type: "pass" }。
   *  概率 = k ÷ N（还没排除的组合里得出这个结果的有几种）；押多少 = 这一轮每格最低注 × 习惯里 stake 的倍数（随机，手上不够就少押）。
   *  谨慎型：概率最高的那格（第二、三轮不到 minChance 就不押）；赌徒型：prefer（±2）里开盘的随便挑一格，都不开就押概率最低的；
   *  跟风型：这一轮押得最多的那格（还没人押看前几轮，都没有就押概率最高的）；
   *  算账型：概率 × 赔率最高的那格（彩池桌按把自己这一注放进去以后的池子算，不划算就少押；第二、三轮押最低注也不到 minValue 就不押）。
   *  第一轮都会押（不押后面就不能押了） */
  function npcDecide(v, style, rng) {
    const S = GUESS_CONFIG.npc.styles[style];
    if (!S) fail("没有这种 NPC 下注习惯：" + style);
    const opt = (v.legal || []).find(o => o.type === "bet");
    if (!opt || !opt.cells.length) return { type: "pass" };
    const N = (v.board && v.board.N) || 1, r = v.round;
    const cells = opt.cells.map(c => ({ result: c.result, chance: c.k / N, odds: c.odds }));
    // 概率从高到低（一样高的先押靠近 0 的、再按结果从小到大），整张表的顺序固定
    const likely = cells.slice().sort((a, b) => b.chance - a.chance || Math.abs(a.result) - Math.abs(b.result) || a.result - b.result);
    const lo = Math.max(1, Math.floor(S.stake[0])), hi = Math.max(lo, Math.floor(S.stake[1]));
    let amount = Math.min(opt.max, opt.min * (lo + Math.floor(rng() * (hi - lo + 1))));
    let pick = null;
    if (style === "cautious") pick = r > 1 && likely[0].chance < S.minChance ? null : likely[0];
    else if (style === "gambler") {
      const fav = cells.filter(c => (S.prefer || []).indexOf(c.result) >= 0), from = fav.length ? fav : [likely[likely.length - 1]];
      pick = from[Math.min(from.length - 1, Math.floor(rng() * from.length))];
    } else if (style === "follower") {
      const now = crowdOf(v, r), before = crowdOf(v, null);
      const most = (crowd) => cells.filter(c => crowd[c.result] > 0)
        .sort((a, b) => crowd[b.result] - crowd[a.result] || likely.indexOf(a) - likely.indexOf(b))[0] || null;
      pick = most(now) || most(before) || likely[0];
    } else if (style === "counter") {
      // 彩池桌把自己这一注放进池子算：注越大自己摊得越薄——不划算就一档一档少押，押最低注也不划算就不押
      for (let a = amount; a >= opt.min && !pick; a -= opt.min) {
        const value = (c) => c.chance * npcOdds(v, c, a);
        const best = cells.slice().sort((x, y) => value(y) - value(x) || likely.indexOf(x) - likely.indexOf(y))[0];
        if (r === 1 || value(best) >= S.minValue) { pick = best; amount = a; }
      }
    } else pick = likely[0];
    return pick ? { type: "bet", bets: { [pick.result]: amount } } : { type: "pass" };
  }
  /** 算账型看的赔率：赌场桌是这一格锁定的赔率；彩池桌按把自己这 amount 枚放进去以后的池子算（view 里公开的即时赔率板） */
  function npcOdds(v, c, amount) {
    if (c.odds != null) return c.odds;
    const b = v.pool && v.pool.rounds && v.pool.rounds[v.round - 1];
    if (!b) return 0;
    const cell = b.cells.find(x => x.result === c.result), hit = ((cell && cell.staked) || 0) + amount, staked = b.staked + amount;
    return poolNet(v.pool, b.carryIn, staked, hit).net / hit;
  }
  /** 赌命桌赢了拿什么：每格押上的点数 × 赔率（向下取整）× kuizhiPerPoint 奎支；单格赔率够高另给稀有材料（取够得着的最高一档） */
  function prizeOf(slips) {
    const L = GUESS_CONFIG.life, items = {};
    let kuizhi = 0;
    slips.forEach(x => {
      kuizhi += payoutOf(x.amount, x.odds) * L.kuizhiPerPoint;
      const tier = L.items.filter(t => x.odds >= t.minOdds).sort((a, b) => b.minOdds - a.minOdds)[0];
      if (tier) items[tier.item] = (items[tier.item] || 0) + tier.n;
    });
    return { kuizhi, items: Object.keys(items).map(id => ({ id, n: items[id] })) };
  }
  /** 奖品写成一句话（奎支、材料名字照 items.js 的目录） */
  function prizeText(prize) {
    const cat = typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : (root.ITEM_CATALOG || {});
    const parts = [];
    if (prize.kuizhi) parts.push(`${prize.kuizhi} 奎支`);
    prize.items.forEach(x => parts.push(`${(cat[x.id] && cat[x.id].name) || x.id} ×${x.n}`));
    return parts.join("、") || "没有奖品";
  }

  /* ---------- 结算：翻开层牌，用 CounterCards.score 算结果，猜中的连本带利拿回 ---------- */
  function settle(h) {
    const s = h.secret, score = outcome(s.element, s.layer, s.weather);
    h.over = true; h.stage = "over";
    h.result = { score, element: s.element, weather: s.weather, layer: s.layer };
    note(h, { t: "result", score, text: `结果：${cardName(s.element)}打${cardName(s.layer)}，天气${weatherName(s.weather)}——${label(score)}。` });
    const pool = isPool(h);
    if (pool) settlePools(h, score);   // 彩池桌：每一轮的池按押中的注额分（每张押注的 pay 在这里算好）
    h.players.forEach(p => {
      let won = 0, staked = 0;
      p.slips.forEach(x => {
        x.win = x.result === score;
        if (!pool) x.pay = x.win ? payoutOf(x.amount, x.odds) : 0;
        won += x.pay; staked += x.amount;
      });
      if (h.table.life) {
        // 赌命桌：押输的格子名义上押上了几点（due）只交给接入的那一边去扣（lifeBill），不进画面、不进记录；记录只写「坚毅受创」
        const hits = p.slips.filter(x => x.win);
        p.prize = prizeOf(hits);
        p.hurt = p.slips.some(x => !x.win);
        p.due = p.slips.filter(x => !x.win).reduce((s, x) => s + x.amount, 0);
        if (p.slips.length) note(h, { t: "pay", by: p.id, text: `${p.name}：${[hits.length ? `押中 ${hits.length} 格，赢得 ${prizeText(p.prize)}` : "没押中", p.hurt ? "坚毅受创" : ""].filter(Boolean).join("；")}。` });
        return;
      }
      p.chips += won;
      p.won = won;
      p.net = won - staked - p.paid;
      if (p.slips.length) note(h, { t: "pay", by: p.id, text: !won ? `${p.name}没押中。`
        : pool ? `${p.name}押中，从彩池连本带利分得 ${won} 枚。` : `${p.name}押中，连本带利拿回 ${won} 枚。` });
    });
    if (!h.table.life && h.players.length > 1) rank(h);
  }
  /** 彩池桌结算（#556）：每一轮单独算——池子 = 滚存进来的 + 这一轮押进来的；抽成只抽押进来的（向下取整，stakeBack 时不抽到押中的人的本金）；
   *  剩下的（net）由这一轮押中那一格的人按注额分，每人 floor(net × 自己的注 ÷ 押中那一格的注)（赔出半枚向下取整）；
   *  分不出去的（没人押中的整个池、分剩的零头 left）照 carry 滚存到下一手同一轮（carryOut）或者归赌场（house）。
   *  钱守恒：分出去的（paid）+ 赌场拿的（house = 抽成 + 归赌场的）+ 滚存（carryOut）= 池子 */
  function settlePools(h, score) {
    const P = h.pool;
    P.rounds.forEach(R => {
      const slips = slipsOf(h, R.round), staked = sum(slips), hits = slips.filter(x => x.result === score), hit = sum(hits);
      const { rake, net } = poolNet(P, R.carryIn, staked, hit);
      let paid = 0;
      slips.forEach(x => { x.win = x.result === score; x.pay = x.win ? Math.floor(net * x.amount / hit) : 0; paid += x.pay; });
      const left = net - paid, next = P.carry !== "house";
      Object.assign(R, { staked, pool: R.carryIn + staked, rake, net, win: score, hit, paid, left,
        carryOut: next ? left : 0, house: rake + (next ? 0 : left), odds: hit ? floorTo(net, hit, P.digits) : null });
      if (!R.pool) return;
      const head = `第 ${R.round} 轮彩池 ${R.pool} 枚${R.carryIn ? `（含上一手滚存 ${R.carryIn} 枚）` : ""}`;
      const where = next ? "滚存到下一手" : "归赌场";
      const cut = `抽成 ${rake} 枚${rake < rakeNominal(P, staked) ? "（押中的人至少拿回本金，少抽了）" : ""}`;
      note(h, { t: "pool", round: R.round, text: hit
        ? `${head}：${cut}，押中 ${label(score)} 的 ${hit} 枚分 ${paid} 枚（每枚约 ${R.odds} 倍）${left ? `，零头 ${left} 枚${where}` : ""}。`
        : `${head}：${staked ? `${cut}，没人押中` : "这一轮没人押"}${left ? `，${left} 枚${where}` : ""}。` });
    });
  }
  /** 这一手第 round 轮所有人（含 NPC）的押注 */
  const slipsOf = (h, round) => [].concat.apply([], h.players.map(p => p.slips.filter(x => x.round === round)));
  const sum = (slips) => slips.reduce((s, x) => s + x.amount, 0);
  /** 这一手的输赢排名（#556，两个人以上）：按净输赢从多到少（一样多照座位顺序），NPC 也排；写一行公开记录 */
  function rank(h) {
    const list = h.players.map((p, i) => ({ id: p.id, name: p.name, npc: !!p.npc, staked: sum(p.slips), won: p.won, paid: p.paid, net: p.net, i }))
      .sort((a, b) => b.net - a.net || a.i - b.i);
    h.ranking = list.map(x => ({ id: x.id, name: x.name, npc: x.npc, staked: x.staked, won: x.won, paid: x.paid, net: x.net }));
    const top = list[0], low = list[list.length - 1];
    note(h, { t: "rank", text: `这一手的输赢：${list.map((x, n) => `${n + 1}. ${x.name} ${label(x.net)} 枚`).join("；")}。` +
      (top.net > 0 ? `赢得最多的是${top.name}` : "没有人赢") + (low.net < 0 ? `，输得最多的是${low.name}。` : "。") });
  }
  /** 彩池桌第 round 轮（不写 = 现在这一轮）的即时赔率板（#556，公开）：
   *  { round, live（还在押这一轮）, over, carryIn（上一手滚存进来的）, staked（这一轮押进来的）, pool, rake（现在押进来的这些名义上抽多少）, rakePct,
   *    min（这一轮每格最低注）, cells: [{ result, k, open, staked（这一格一共押了多少）, bettors（几个人押）,
   *    odds（「现在押中，每枚大约分回几枚」连本带利，向下取到 digits 位）, empty（开盘、还没人押）}] }。
   *  odds 不锁定：随着大家下注变，结算时按最终的池子算。还没人押的格子：还在押的时候按「押一注最低注独得」算，押完了是 null。
   *  结算后另有 win（结果；每格也有 win）、hit / net / paid / left / carryOut / house，rake 是实际抽的，odds 就是最后的倍数。
   *  赌场桌、还没开的那一轮 → null */
  function poolBoard(h, round) {
    if (!h || !h.pool) return null;
    const r = round == null ? h.round : Math.floor(Number(round));
    const R = h.pool.rounds[r - 1], P = h.pool;
    const opened = h.boards.filter(x => x.round === r).pop();
    if (!R || !opened) return null;
    const b = !h.over && r === h.round ? h.board : opened.board;
    const live = !h.over && r === h.round;
    const slips = slipsOf(h, r), staked = sum(slips), min = h.table.minBet[Math.max(0, Math.min(h.table.minBet.length - 1, r - 1))];
    const cells = b.cells.map(c => {
      const mine = slips.filter(x => x.result === c.result), hit = sum(mine);
      const o = { result: c.result, k: c.k, open: !!c.open, staked: hit, bettors: mine.length, odds: null };
      if (hit) o.odds = floorTo(poolNet(P, R.carryIn, staked, hit).net, hit, P.digits);
      else if (c.open) {
        o.empty = true;
        if (live) o.odds = floorTo(poolNet(P, R.carryIn, staked + min, min).net, min, P.digits);
      }
      if (h.over) o.win = c.result === h.result.score;
      return o;
    });
    const out = { round: r, live, over: !!h.over, carryIn: R.carryIn, staked, pool: R.carryIn + staked,
      rake: h.over ? R.rake : rakeNominal(P, staked), rakePct: P.rake, min, cells };
    if (h.over) ["win", "hit", "net", "paid", "left", "carryOut", "house", "odds"].forEach(k => { out[k] = R[k]; });
    return out;
  }
  /** 彩池桌结算后每一轮滚存到下一手的枚数（下一手 newHand 的 carry）；还没结算、赌场桌 → null */
  function carryOf(h) {
    return h && h.pool && h.over ? h.pool.rounds.map(R => R.carryOut) : null;
  }
  /** 赌命桌这一手的账（只给接入的那一边用：长线养成 / 跑团去扣坚毅、发奖）：
   *  { lost: 押输的那几格名义上押上的点数加起来, prize: { kuizhi, items: [{ id, n }] }, hurt: 有没有押输的 }。
   *  界面不拿这个——画面上只写「坚毅受创」；还没结算、不是赌命桌 → null */
  function lifeBill(h, id) {
    const p = playerOf(h, id);
    if (!p || !h.table.life || !h.over) return null;
    return { lost: p.due, prize: clone(p.prize), hurt: p.hurt };
  }

  /* ---------- 这名玩家能看到的东西 ---------- */
  /** 没翻开的牌（secret）、种子都不在里面；押注、赔率表、翻开的牌、记录是公开的。
   *  同桌的人（others，含 NPC 赌客：npc、下注习惯 style / styleName）每一轮押了哪几格、押多少都公开（#556）；
   *  别人手上还有多少筹码不在里面。彩池桌另有 pool（每一轮的即时赔率板 poolBoard，还没开的那一轮是 null）；
   *  结算后两个人以上有 ranking（这一手的输赢排名）。NPC 看的也是这一份（npcDecide 只读它）。
   *  赌命桌：押注写每格押上的固定点数（stake，规则文字）；结算只有押中没有（win）、奖品（prize）、坚毅受没受创（hurt），
   *  押输了一共多少点（due）不在里面——规则层本来就不知道角色还剩多少坚毅 */
  function view(h, id) {
    const p = playerOf(h, id);
    if (!p) fail("没有这名玩家：" + id);
    const t = h.table, S = GUESS_CONFIG.npc.styles;
    const slip = (x) => {
      const o = { round: x.round, result: x.result, odds: x.odds };
      if (t.life) o.stake = x.amount; else o.amount = x.amount;
      if (h.over) { o.win = x.win; if (!t.life) o.pay = x.pay; }
      return o;
    };
    const seat = (x) => Object.assign({ id: x.id, name: x.name, in: x.in, acted: clone(x.acted), slips: x.slips.map(slip) },
      x.npc ? { npc: true, style: x.style, styleName: (S[x.style] && S[x.style].name) || x.style } : {});
    const wait = toAct(h);
    const mine = t.life ? (h.over ? { prize: clone(p.prize), hurt: p.hurt } : {})
      : Object.assign({ chips: p.chips, paid: p.paid }, h.over ? { won: p.won, net: p.net } : {});
    const out = {
      table: { id: t.id, name: t.name, life: !!t.life, dealer: t.dealer || null, mult: t.mult, entry: t.entry, minBet: t.minBet.slice(), kind: kindOf(h) },
      stage: h.stage, round: h.round, rounds: GUESS_CONFIG.order.length, over: h.over,
      shown: clone(h.shown),
      board: clone(h.board), minBet: minBetOf(h),
      waiting: wait, myTurn: wait.indexOf(p.id) >= 0 || (!!p.npc && pending(h).indexOf(p) >= 0),
      legal: legal(h, p.id),
      me: Object.assign(seat(p), mine),
      others: h.players.filter(x => x !== p).map(seat),
      result: h.result ? clone(h.result) : null,
      log: clone(h.log)
    };
    if (h.pool) out.pool = { rake: h.pool.rake, stakeBack: h.pool.stakeBack, carry: h.pool.carry, digits: h.pool.digits,
      rounds: h.pool.rounds.map(R => poolBoard(h, R.round)) };
    if (h.ranking) out.ranking = clone(h.ranking);
    return out;
  }

  const api = {
    GUESS_CONFIG, label, outcome, tally, oddsOf, payoutOf, board, tables, tableOf, kinds, dealOf,
    newHand, toAct, legal, act, view, lifeBill, prizeText, setTopUp,
    poolBoard, carryOf, npcDecide
  };
  // 配置挂到 High Flux 的 CC_CONFIG 上（同一份对象）
  if (CC() && CC().CC_CONFIG) CC().CC_CONFIG.guess = GUESS_CONFIG;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CounterCardsGuess = api;
})(typeof window !== "undefined" ? window : globalThis);
