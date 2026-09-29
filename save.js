/* 角鳞 · Roguelike 存档
 *
 * 两份存档，各自带版本号：
 *   run   本局进度。团灭或通关后删除。
 *         只在节点之间自动保存（进入下一个节点前）。战斗打到一半退出，
 *         下次从这场战斗开头重来——种子随机数保证开局一模一样。
 *   meta  跨局保留：解锁内容、角色与武器人的初始关系倾向、统计。
 *
 * 改了存档结构：把 CURRENT 对应的版本 +1，并在 MIGRATE 里写一条
 * 「旧版本 → 新一版」的函数。读档时会一路升级到最新，玩家的旧存档不会作废。
 *
 * 不碰网页，Node 测试里也能用（localStorage 由测试环境提供）。
 */
const SaveStore = (function () {
  "use strict";

  const KEYS = { run: "antlerscale-rogue-run", meta: "antlerscale-rogue-meta" };
  const CURRENT = { run: 2, meta: 1 };
  // MIGRATE.run[n] = (第 n 版的 data) => 第 n+1 版的 data
  const MIGRATE = {
    run: {
      // 第 1 版（M1）：物资是一组数字 → 第 2 版：物资放进「本局队伍档案」（与战斗原型同一套规则）
      1: (d) => {
        const s = d.supplies || {};
        const items = s.food ? [{ id: "food_liquid", qty: Number(s.food) || 0 }] : [];
        const out = Object.assign({}, d, {
          world: {
            ledger: { day: d.day || 1, hours: 0, dur: {}, heroes: {}, weapons: {}, shortUsed: {}, water: Number(s.water) || 0 },
            bag: { items, water: Number(s.water) || 0 },
            kuizhi: Number(s.kuizhi) || 0
          },
          main: null,        // 进入单局时按当前幕补上主线
          extra: false
        });
        delete out.supplies;
        (out.party || []).forEach(h => {
          h.attrPicks = h.attrPicks || [];
          h.rolePicks = h.rolePicks || {};
          h.pending = h.pending || [];
          h.notes = h.notes || {};
        });
        return out;
      }
    },
    meta: {}
  };

  const PARTY_MIN = 2;   // 开局最少 2 人（减员到 1 人不做特殊处理，见 README）
  const PARTY_MAX = 4;

  function storage() {
    try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; }
  }
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function write(kind, data) {
    const ls = storage();
    if (!ls || !KEYS[kind]) return false;
    try {
      ls.setItem(KEYS[kind], JSON.stringify({ kind, version: CURRENT[kind], savedAt: Date.now(), data }));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 读档并升级到最新版本。读不出来返回 null（坏档另存一份 .broken，不直接丢掉） */
  function read(kind) {
    const ls = storage();
    if (!ls || !KEYS[kind]) return null;
    const raw = ls.getItem(KEYS[kind]);
    if (!raw) return null;
    let env;
    try {
      env = JSON.parse(raw);
      if (!env || env.kind !== kind || typeof env.version !== "number" || !env.data) throw new Error("格式不对");
    } catch (e) {
      try { ls.setItem(KEYS[kind] + ".broken", raw); } catch (e2) {}
      return null;
    }
    if (env.version > CURRENT[kind]) return null;   // 更新版本的游戏存的档，这一版读不懂
    let data = env.data;
    for (let v = env.version; v < CURRENT[kind]; v++) {
      const up = MIGRATE[kind][v];
      if (typeof up !== "function") return null;
      data = up(data);
    }
    return data;
  }

  function clear(kind) {
    const ls = storage();
    if (ls && KEYS[kind]) ls.removeItem(KEYS[kind]);
  }
  function has(kind) {
    return read(kind) != null;
  }

  /** 角色 kit → 这名角色的专属武器人 kit（绯秋有两把刀，所以是数组） */
  function weaponsOf(kit) {
    if (typeof livePartyCards !== "function") return [];
    return livePartyCards().filter(c => c.weaponOf === kit).map(c => c.kit);
  }

  /**
   * 新开一局的存档数据（第 1 版结构）。
   *   party  角色 kit 列表，2–4 人
   *   seed   不给就随机生成
   */
  function newRun(opt) {
    opt = opt || {};
    const kits = (opt.party || []).slice();
    if (kits.length < PARTY_MIN || kits.length > PARTY_MAX) {
      throw new Error(`开局队伍需要 ${PARTY_MIN}–${PARTY_MAX} 人，现在是 ${kits.length} 人。`);
    }
    if (new Set(kits).size !== kits.length) throw new Error("队伍里有重复的角色。");
    return {
      seed: String(opt.seed || (typeof RNG !== "undefined" ? RNG.newSeed() : Date.now().toString(36))),
      rngDraws: 0,
      createdAt: Date.now(),
      act: 1,
      day: 1,
      hours: 0,
      // board 任务板 · task 任务内 · rest 休整 · boss 幕末 BOSS · interlude 幕间选择 · over 结束
      stage: "board",
      // 每名角色连同自己的武器人记在一起：角色永久死亡时整条移出队伍，武器人一并离开
      party: kits.map(kit => ({
        kit,
        weapons: weaponsOf(kit),
        level: 1,
        xp: 0,
        hp: null,          // null = 满血；否则是各血量层的当前值（persistentLayers）
        shp: null,
        weaponState: {}    // 武器人 kit → { hp, durability, level }
      })),
      fallen: [],          // 永久死亡的角色（连同武器人）：{ kit, weapons, act, day }
      world: null,         // 本局的队伍档案：{ ledger（耐久、力竭小时、短休、武器人伤势）, bag（物品、水）, kuizhi }
      main: null,          // 本幕主线（开幕自动接下）
      board: null,         // 任务板上的支线
      task: null,          // 进行中的任务与节点进度
      relations: {},       // 角色 ↔ 武器人关系（M4）
      flags: {},           // 幕间选择、支线推进（M5）
      log: []
    };
  }

  /** 角色永久死亡：角色和他的武器人一起离开队伍 */
  function killHero(run, kit) {
    const i = (run.party || []).findIndex(h => h.kit === kit);
    if (i < 0) return null;
    const [h] = run.party.splice(i, 1);
    run.fallen = run.fallen || [];
    run.fallen.push({ kit: h.kit, weapons: h.weapons.slice(), act: run.act, day: run.day });
    return h;
  }

  function newMeta() {
    return {
      unlocked: { heroes: [] },   // 空 = 按游戏默认解锁
      tendencies: {},             // 角色 kit → 与武器人的初始关系倾向（M4）
      stats: { runs: 0, wins: 0, deaths: 0 }
    };
  }

  return {
    KEYS, CURRENT, MIGRATE, PARTY_MIN, PARTY_MAX,
    read, write, clear, has,
    newRun, newMeta, killHero, weaponsOf,
    saveRun: (d) => write("run", d), loadRun: () => read("run"), clearRun: () => clear("run"),
    saveMeta: (d) => write("meta", d), loadMeta: () => read("meta") || newMeta(),
    clone
  };
})();
