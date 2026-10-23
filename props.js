function emptyGap() {
  return { type: "open", hp: 0, maxHp: 0, open: true, lastFrom: null };
}

function gapKey(a, b) {
  const lo = Math.min(Number(a), Number(b));
  const hi = Math.max(Number(a), Number(b));
  return lo + "-" + hi;
}

function gapLabel(type) {
  return ({
    open: "畅通",
    bridge: "不稳桥梁",
    wall: "危墙",
    door: "机关门",
    void: "空隙",
    wave: "驻波墙"   // Helumica「频域造物」暂时取代原来的间隔（app.js · placeWaveWall）
  })[type] || type;
}

function propKindName(kind) {
  return ({
    button: "按钮",
    lever: "拉杆",
    battery: "超充能电池",
    boom: "爆炸桶",
    acid: "酸液桶",
    scrap: "碎渣机炮",
    turret: "防卫自律炮台",
    ironwall: "铁壁",
    scrapwall: "废铁墙",
    dome: "防护罩",
    coral_branch: "沙珊瑚枝",
    coral_tentacle: "沙珊瑚触须",
    death_statue: "死亡雕像"
  })[kind] || (typeof vehicleCfg === "function" && vehicleCfg(kind) ? vehicleCfg(kind).name : kind);
}

function makeProp(kind, zone, level) {
  const lv = Math.max(1, Number(level) || 1);
  if (typeof vehicleCfg === "function" && vehicleCfg(kind)) return makeVehicleProp(kind, zone, lv);   // 载具配置物（vehicle.js）
  const base = {
    id: "p" + Math.random().toString(36).slice(2, 9),
    kind,
    name: propKindName(kind),
    zone: Number(zone) || 1,
    level: lv,
    faction: "player",
    movable: false,
    hp: 0,
    maxHp: 0,
    link: "1-2"
  };
  if (kind === "button" || kind === "lever") {
    base.hp = 999; base.maxHp = 999;
  }
  if (kind === "battery") {
    base.hp = base.maxHp = 15 + 3 * lv;
    base.movable = true;
  }
  if (kind === "boom" || kind === "acid") {
    base.hp = base.maxHp = 3;
    base.movable = true;
  }
  if (kind === "scrap") {
    base.hp = base.maxHp = 5;
  }
  if (kind === "turret") {
    base.hp = base.maxHp = 25 + 2 * lv;
  }
  if (kind === "ironwall") {
    base.hp = base.maxHp = 1;
    base.movable = false;
    base.faction = "player";
  }
  if (kind === "dome") {        // 生存职责「防护罩」：护盾生命，耐久由技能决定（atk + 10）
    base.hp = base.maxHp = 1;
    base.movable = false;
    base.faction = "player";
    base.layerType = "shield";
  }
  if (kind === "coral_branch") {   // 沙珊瑚（desert.js）：金属骨骼，装甲生命
    base.hp = base.maxHp = 30 + 4 * (lv - 1);
    base.faction = "neutral";
  }
  if (kind === "coral_tentacle") {
    base.hp = base.maxHp = 8 + 3 * (lv - 1);
    base.faction = "neutral";
  }
  if (kind === "death_statue") {   // 被沙珊瑚缠住时死掉的单位，被珊瑚分泌的金属骨骼覆盖（desert.js）：掩体
    base.hp = base.maxHp = 20 + 3 * (lv - 1);
    base.faction = "neutral";
  }
  if (kind === "scrapwall") {   // 亡命之王「回防命令」：耐久由命令掷骰决定
    base.hp = base.maxHp = 1;
    base.movable = false;
    base.faction = "enemy";
  }
  return base;
}

const MECHANICAL_KITS = {
  guard_sword: true, guard_gun: true, boomcar: true, buoy: true,
  dumpdrone: true, swarm: true, patrolboat: true, spreader: true, patrol_car: true,
  mine_guard: true, flint_sweeper: true, gas_collector: true, alarm_bot: true, meteor_miner: true,
  sewer_sweeper: true   // 下水道清扫机（docs/sewer-maintenance.md：机械，没有种族）
};

function isMechanicalUnit(u) {
  return !!(u && u.kit && MECHANICAL_KITS[u.kit]);
}

function unitMatchesPropFaction(u, p) {
  if (!u || !p) return false;
  if (p.faction === "enemy") return !u.isPlayer;
  return !!u.isPlayer;
}

function batteryBonusFor(u) {
  return (state.props || []).filter(p => p.kind === "battery" && unitMatchesPropFaction(u, p))
    .reduce((s, p) => s + 5 + 2 * (p.level || 1), 0);
}

function syncBatteryShields(notes) {
  notes = notes || [];
  (state.units || []).forEach(u => {
    if (u.hidden || u.dead) return;
    const want = isMechanicalUnit(u) ? batteryBonusFor(u) : 0;
    let layer = (u.layers || []).find(l => l.batteryShield);
    if (want <= 0) {
      if (layer) {
        u.layers = u.layers.filter(l => l !== layer);
        notes.push(`${u.name} 失去电池机械护盾。`);
      }
      return;
    }
    if (!layer) {
      layer = { type: "shield", current: want, max: want, batteryShield: true };
      u.layers = [layer].concat(u.layers || []);
      notes.push(`${u.name} 获得电池机械护盾 ${want}（最外层）。`);
      return;
    }
    u.layers = [layer].concat(u.layers.filter(l => l !== layer));
    const diff = want - (Number(layer.max) || 0);
    layer.max = want;
    if (diff > 0) layer.current = (Number(layer.current) || 0) + diff;
    else layer.current = Math.min(Number(layer.current) || 0, want);
  });
  return notes;
}

/** 战斗中召唤 / 生成的机械类单位：补上同阵营超充能电池的护盾（只补还没有电池护盾的，
 *  不动已有的层顺序——错位这类交换内外层的效果还在生效时也不会被打乱） */
function grantMissingBatteryShields(notes) {
  notes = notes || [];
  if (!(state.props || []).some(p => p.kind === "battery")) return notes;
  (state.units || []).forEach(u => {
    if (!u || u.hidden || u.dead || u._shiftSwapped || !isMechanicalUnit(u)) return;
    if ((u.layers || []).some(l => l.batteryShield)) return;
    const want = batteryBonusFor(u);
    if (want <= 0) return;
    u.layers = [{ type: "shield", current: want, max: want, batteryShield: true }].concat(u.layers || []);
    notes.push(`${u.name} 获得电池机械护盾 ${want}（最外层）。`);
  });
  return notes;
}

function refillBatteryFactionShields(notes) {
  notes = notes || [];
  const bats = (state.props || []).filter(p => p.kind === "battery");
  if (!bats.length) return notes;
  grantMissingBatteryShields(notes);   // 这一回合新上场的机械单位先补上电池护盾
  (state.units || []).forEach(u => {
    if (u.hidden || u.dead) return;
    if (!bats.some(p => unitMatchesPropFaction(u, p))) return;
    let any = false;
    (u.layers || []).forEach(l => {
      if (l.type === "shield" && Number(l.current) < Number(l.max)) {
        l.current = l.max;
        any = true;
      }
    });
    if (any) notes.push(`${u.name} 护盾类型生命因超充能电池回满。`);
  });
  return notes;
}

/** 危墙的耐久：手册「有一定耐久值 1～15，DM 自行调整」→ 随机 1–15（战场配置里可以改） */
const WALL_HP_RANGE = [1, 15];
function rollWallHp() {
  return WALL_HP_RANGE[0] + Math.floor(Math.random() * (WALL_HP_RANGE[1] - WALL_HP_RANGE[0] + 1));
}
/** 不稳桥梁的耐久：手册「10～30 点，取决于战斗」→ 随机 10–30 */
const BRIDGE_HP_RANGE = [10, 30];
function rollBridgeHp() {
  return BRIDGE_HP_RANGE[0] + Math.floor(Math.random() * (BRIDGE_HP_RANGE[1] - BRIDGE_HP_RANGE[0] + 1));
}
function defaultGapHp(type) {
  if (type === "bridge") return rollBridgeHp();
  if (type === "wall") return rollWallHp();
  return 0;
}
