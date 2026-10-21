// HD-2D 战场原型（prototypes/hd2d/）的布局：纯函数，只看战斗状态算位置。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const L = require("../prototypes/hd2d/hd2d-layout.js");

const PARTY = ["kolt", "helu", "ruby", "yuito"];
const FOES = [{ id: "guard_sword", lv: 2 }, { id: "thug_knife", lv: 2 }, { id: "buoy", lv: 2 }, { id: "crow", lv: 2 }, { id: "thug_hammer", lv: 2 }];

/** 各种棋盘：直排 2 / 3 区（按 zoneMode）、特殊棋盘 4 直排 / 2×2 / 十字 */
const CASES = [
  { name: "两区直排", opt: { zoneMode: 2 }, links: 1 },
  { name: "三区直排", opt: { zoneMode: 3 }, links: 2 },
  { name: "四区直排", opt: { board: "line4" }, links: 3 },
  { name: "2×2", opt: { board: "square4" }, links: 4 },
  { name: "十字五区", opt: { board: "cross5" }, links: 4 }
];

function setupCase(c, nFoes) {
  const ctx = H.load();
  const st = ctx.BattleSim.setup(Object.assign({
    party: PARTY, seed: "HD2D",
    enemies: FOES.slice(0, nFoes == null ? 4 : nFoes).map(f => Object.assign({ zone: 0 }, f))
  }, c.opt));
  // 敌人都放在规则给的敌方区；这里额外把几个摆到别的区，覆盖「多个区都有单位」
  const ids = st.zoneMode;
  st.units.filter(u => !u.isPlayer).forEach((u, i) => { u.zone = ((i + 1) % ids) + 1; });
  return st;
}

const rect = (x, z, w, d) => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
const overlap = (a, b, eps = 1e-6) => a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.z0 < b.z1 - eps && b.z0 < a.z1 - eps;

for (const portrait of [false, true]) {
  for (const c of CASES) {
    test(`${c.name}${portrait ? "（竖屏）" : ""}：区不重叠、之间留缝，每个区都有位置`, () => {
      const st = setupCase(c);
      const out = L.build(st, { portrait });
      assert.equal(out.zones.length, st.zoneMode);
      for (let i = 0; i < out.zones.length; i++) {
        for (let j = i + 1; j < out.zones.length; j++) {
          const a = out.zones[i], b = out.zones[j];
          const ra = rect(a.cx, a.cz, a.w, a.d), rb = rect(b.cx, b.cz, b.w, b.d);
          assert.ok(!overlap(ra, rb), `区 ${a.id} 和 ${b.id} 重叠`);
          // 缝：两块地台在 x 或 z 方向上至少隔开 zoneGap（挨着的区正好是 zoneGap，对角的更远）
          const gapX = Math.max(rb.x0 - ra.x1, ra.x0 - rb.x1), gapZ = Math.max(rb.z0 - ra.z1, ra.z0 - rb.z1);
          assert.ok(Math.max(gapX, gapZ) >= L.CONFIG.zoneGap - 1e-6, `区 ${a.id} 和 ${b.id} 之间没有留缝`);
        }
      }
      // 每条连接都有一个间隔，摆在两个区中间
      assert.equal(out.gaps.length, c.links);   // state.gaps 里可能留着上一块棋盘的键，以连接数为准
      out.gaps.forEach(g => {
        const a = out.zones.find(z => z.id === g.a), b = out.zones.find(z => z.id === g.b);
        assert.ok(Math.abs(g.x - (a.cx + b.cx) / 2) < 1e-9 && Math.abs(g.z - (a.cz + b.cz) / 2) < 1e-9);
        assert.ok(Math.abs(g.length - L.CONFIG.zoneGap) < 1e-6, "相邻区的缝宽 = zoneGap");
      });
    });

    test(`${c.name}${portrait ? "（竖屏）" : ""}：同一区的单位站位不重叠，也不出地台`, () => {
      const st = setupCase(c, 5);
      const out = L.build(st, { portrait });
      const shown = st.units.filter(u => !u.hidden && !u.dead);
      assert.equal(out.units.length, shown.length, "每个能看见的单位都有站位");
      const byZone = {};
      out.units.forEach(u => { (byZone[u.zone] = byZone[u.zone] || []).push(u); });
      Object.keys(byZone).forEach(zid => {
        const zone = out.zones.find(z => z.id === Number(zid)), list = byZone[zid];
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          assert.ok(Math.abs(a.x - zone.cx) <= zone.w / 2 && Math.abs(a.z - zone.cz) <= zone.d / 2, "站在地台范围里");
          for (let j = i + 1; j < list.length; j++) {
            const b = list[j];
            assert.ok(!overlap(rect(a.x, a.z, a.footprint.w, a.footprint.d), rect(b.x, b.z, b.footprint.w, b.footprint.d)),
              `区 ${zid} 里 ${a.plate.name} 和 ${b.plate.name} 重叠`);
          }
        }
      });
    });
  }
}

test("深渊区：地面单位站在黑洞外面，不压在洞上", () => {
  const st = setupCase({ opt: { board: "cross5" } }, 5);
  st.fields[3].abyss = true;
  st.units.forEach(u => { u.zone = 3; });
  const out = L.build(st);
  const z = out.zones.find(q => q.id === 3);
  assert.ok(z.hole > 0 && z.kind === "abyss");
  out.units.forEach(u => {
    const r = Math.hypot(u.x - z.cx, u.z - z.cz);
    assert.ok(Math.abs(u.z - z.cz) >= z.hole || Math.abs(u.x - z.cx) >= z.hole + 0.5, `${u.plate.name} 压在黑洞上（距中心 ${r.toFixed(2)}）`);
  });
});

test("飞行单位比地面单位高；下潜单位沉在地台面以下", () => {
  const st = setupCase({ opt: { zoneMode: 3 } }, 4);
  const buoy = st.units.find(u => u.kit === "buoy");
  assert.ok(buoy && buoy.flying, "测试用的浮标是飞行单位");
  const shark = st.units.find(u => !u.isPlayer && !u.flying);
  shark.submerged = true;
  const out = L.build(st);
  const fly = out.units.find(u => u.id === buoy.id);
  const ground = out.units.filter(u => !u.flying && !u.submerged);
  assert.ok(fly.flying && ground.length);
  ground.forEach(g => assert.ok(fly.y > g.y, "飞行比地面高"));
  assert.ok(fly.y - fly.groundY >= L.CONFIG.unit.flyLift - 1e-9);
  const dive = out.units.find(u => u.id === shark.id);
  assert.ok(dive.submerged && dive.y < dive.groundY, "下潜的铭牌沉到地台面以下");
});

test("高地 / 沙珊瑚台地的地台更高，单位跟着站高", () => {
  const st = setupCase({ opt: { zoneMode: 3 } }, 2);
  st.fields[2].highland = true;
  st.fields[3].coral = true;
  const out = L.build(st);
  const h = id => out.zones.find(z => z.id === id).topY;
  assert.ok(h(2) > h(1) && h(3) > h(1));
  assert.equal(out.zones.find(z => z.id === 3).kind, "coral");
  out.units.filter(u => !u.flying).forEach(u => assert.equal(u.y, h(u.zone)));
});

test("场地 → 地台样子：认得的各有各的，认不得的用默认", () => {
  const st = setupCase({ opt: { board: "square4" } }, 1);
  st.fields[1].acid = true; st.fields[2].quicksand = true; st.fields[3].abyss = true;
  const kinds = L.build(st).zones.map(z => z.kind);
  assert.equal(kinds.join(), "acid,quicksand,abyss,concrete");
  st.fields[4].mystery = true;   // 规则以后新增的场地键：不认识
  assert.equal(L.build(st).zones[3].kind, "concrete");
});

test("间隔：桥 / 墙 / 门 / 空隙按 state.gaps 输出", () => {
  const st = setupCase({ opt: { zoneMode: 3 } }, 1);
  st.gaps["1-2"] = { type: "bridge", hp: 10, maxHp: 10, open: true, lastFrom: null };
  st.gaps["2-3"] = { type: "door", hp: 0, maxHp: 0, open: false, lastFrom: null };
  const g = L.build(st).gaps;
  assert.equal(g.find(x => x.key === "1-2").type, "bridge");
  const door = g.find(x => x.key === "2-3");
  assert.equal(door.type, "door");
  assert.equal(door.open, false);
});

test("铭牌数据：名字 / 等级 / 血 / 架势 / 状态 / ATK 都有，没有坚毅生命（shp）", () => {
  const st = setupCase({ opt: { zoneMode: 3 } }, 3);
  const SHP = 7771, SHP_MAX = 7772;
  st.units.forEach(u => { u.shp = SHP; u.shpMax = SHP_MAX; u.upOnShp = true; });
  st.units[0].statuses.burn = 3;
  st.units[0].statuses.shock = true;
  st.units[1].dying = true;
  const out = L.build(st);
  const p0 = out.units.find(u => u.id === st.units[0].id).plate;
  assert.equal(p0.name, st.units[0].name);
  assert.equal(p0.level, st.units[0].level);
  assert.equal(p0.atk, st.units[0].atk);
  assert.equal(p0.hp.max, st.units[0].layers.reduce((a, l) => a + l.max, 0));
  assert.equal(p0.def.max, st.units[0].defMax);
  assert.ok(p0.statuses.some(s => s.key === "burn" && s.n === 3) && p0.statuses.some(s => s.key === "shock"));
  assert.ok(out.units.find(u => u.id === st.units[1].id).plate.flags.some(f => f.key === "dying"));
  out.units.forEach(u => {
    const dump = JSON.stringify(u.plate);
    assert.ok(!/shp/i.test(dump), "铭牌数据里不出现 shp 字段");
    assert.ok(!dump.includes(String(SHP)) && !dump.includes(String(SHP_MAX)), "铭牌数据里不出现坚毅生命的数值");
    assert.ok(!u.plate.text.join("|").includes(String(SHP)), "铭牌上要显示的文字里没有 shp");
  });
  assert.ok(!/shp/i.test(JSON.stringify(out.units)), "整个站位输出里都没有 shp");
});

test("藏起来的 / 死了的单位不画；不在棋盘上的区号退回到边上的区", () => {
  const st = setupCase({ opt: { zoneMode: 2 } }, 2);
  const foe = st.units.find(u => !u.isPlayer);
  foe.dead = true;
  st.units.find(u => u.isPlayer).hidden = true;
  const stray = st.units.filter(u => u.isPlayer && !u.hidden)[0];
  stray.zone = 3;   // 两区制里留着的旧 3 区
  const out = L.build(st);
  assert.ok(!out.units.some(u => u.id === foe.id));
  const placed = out.units.find(u => u.id === stray.id);
  assert.ok(placed && placed.zone === out.zones[0].id);
});

test("竖屏：直排沿进深排开，我方区在最前面（z 最大）", () => {
  const st = setupCase({ opt: { zoneMode: 3 } }, 3);
  const out = L.build(st, { portrait: true });
  const z = id => out.zones.find(q => q.id === id).cz;
  assert.ok(z(1) > z(2) && z(2) > z(3));
  out.zones.forEach(q => assert.ok(Math.abs(q.cx) < 1e-9));
  const land = L.build(st);
  const x = id => land.zones.find(q => q.id === id).cx;
  assert.ok(x(1) < x(2) && x(2) < x(3), "横屏：1 区在左，3 区在右");
});

/* ---------- 页面脚本的语法检查 ----------
 * 浏览器里的 three.js 部分 Node 跑不了（要 WebGL），这里至少保证几个模块没有语法错误：
 * 去掉 import / export 之后当普通脚本编译一遍（只编译，不运行）。 */
test("原型的浏览器脚本能通过语法检查，规则文件加载顺序和 headless 一致", () => {
  const fs = require("fs"), path = require("path"), vm = require("vm");
  const dir = path.join(__dirname, "..", "prototypes", "hd2d");
  const strip = (src) => src.replace(/^\s*import\s[^;]*?from\s+["'][^"']+["'];?\s*$/gm, "").replace(/^export\s+(default\s+)?/gm, "").replace(/^export\s*\{[^}]*\};?\s*$/gm, "");
  ["hd2d-scene.js", "hd2d-world.js", "hd2d-weather.js", "hd2d-backdrop.js"].forEach(f => {
    assert.doesNotThrow(() => new vm.Script(strip(fs.readFileSync(path.join(dir, f), "utf8")), { filename: f }), f);
  });
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(mod, "index.html 里有页面主脚本");
  assert.doesNotThrow(() => new vm.Script(strip(mod[1]), { filename: "index.html" }));
  // importmap 指向的本地 three.js 文件都在
  const base = path.join(__dirname, "..", "vendor", "three");
  ["three.module.min.js", "addons/controls/OrbitControls.js", "addons/postprocessing/BokehPass.js", "addons/postprocessing/UnrealBloomPass.js",
    "addons/postprocessing/OutputPass.js", "addons/postprocessing/ShaderPass.js", "addons/postprocessing/RenderPass.js", "addons/postprocessing/EffectComposer.js", "addons/renderers/CSS2DRenderer.js"]
    .forEach(f => assert.ok(fs.existsSync(path.join(base, f)), f));
  const tags = [...html.matchAll(/<script src="\.\.\/\.\.\/([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.equal(tags.join(), H.RULE_FILES.filter(f => fs.existsSync(path.join(__dirname, "..", f))).join());
});

/* ---------- 第一阶段打磨（issue #191）---------- */
test("铭牌前后错开：同一拨单位不排成一条线，错开后仍不重叠、不出地台（上面的站位测试负责检查）", () => {
  const st = setupCase({ opt: { zoneMode: 3 } }, 0);
  st.units.forEach(u => { u.zone = 1; });
  const out = L.build(st, {});
  const mine = out.units.filter(u => u.side === "player");
  assert.ok(mine.length >= 2);
  assert.ok(L.CONFIG.unit.stagger > 0);
  assert.ok(new Set(mine.map(u => u.z.toFixed(3))).size > 1, "铭牌没有前后错开");
});

test("竖起来的铭牌够大：站位宽度留够桌面宽度下 13px 的名字，高度装得进取景范围", () => {
  const U = L.CONFIG.unit;
  assert.ok(U.w >= 1.8, "铭牌横向要留够空");
  assert.ok(U.plateH >= 1.5, "铭牌是竖着的，取景范围要算上它的高度");
  const out = L.build(setupCase({ opt: { zoneMode: 3 } }, 4), {});
  out.units.forEach(u => assert.ok(out.bounds.maxY >= u.groundY + u.plateH - 1e-9, "取景范围包得住铭牌"));
});

test("原型页面：垫片放在规则文件之前，页面自己的元素 id 不会被替身拦走（修 app.js init() 的 null 报错）", () => {
  const fs = require("fs"), path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "index.html"), "utf8");
  const shim = html.indexOf("Document.prototype.getElementById"), rules = html.indexOf('<script src="../../run.js">');
  assert.ok(shim > 0 && shim < rules, "垫片要在规则文件之前");
  assert.ok(html.includes("window.GAME_MODE = true"), "和 game.html 一样打开 GAME_MODE（也让坚毅生命数值对玩家不可见）");
  const own = new RegExp(/var OWN = \/(.*)\/;/.exec(html)[1]);
  const ids = [...html.matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]).concat([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  ids.filter(id => id !== "spray").forEach(id => assert.ok(own.test(id), `页面元素 #${id} 会被垫片当成计算器元素`));
  ["presetSelect", "zoneMode", "weather", "btnUndo"].forEach(id => assert.ok(!own.test(id), id + " 应该交给替身"));
});

test("危墙：矮而薄（尺寸在配置表 WALL 里），不会盖住铭牌", () => {
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "hd2d-world.js"), "utf8");
  const w = /const WALL = \{([^}]*)\}/.exec(src);
  assert.ok(w, "危墙尺寸在配置表 WALL 里");
  const v = k => Number(new RegExp(k + ":\\s*([\\d.]+)").exec(w[1])[1]);
  assert.ok(v("baseH") + 3 * v("varyH") <= L.CONFIG.unit.plateH * 0.9, "墙最高不超过铭牌高度");
  assert.ok(v("maxThick") <= 0.6, "墙要薄");
});

test("手机顶栏：有精简文字和切换小按钮；铭牌 HTML 不碰 shp", () => {
  const fs = require("fs"), path = require("path");
  const dir = path.join(__dirname, "..", "prototypes", "hd2d");
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8"), css = fs.readFileSync(path.join(dir, "hd2d.css"), "utf8");
  assert.ok(html.includes('id="tb-compact"') && html.includes('id="demo-btn"'));
  assert.ok(/@media \(max-width: 720px\)[\s\S]*#demo-select[^{]*\{[^}]*display: none/.test(css), "手机上下拉框收起来");
  const scene = fs.readFileSync(path.join(dir, "hd2d-scene.js"), "utf8");
  assert.ok(!/shp/i.test(scene.slice(scene.indexOf("function plateHtml"), scene.indexOf("function makePlate"))), "铭牌 HTML 不碰 shp");
});
