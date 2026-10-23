// 3D 白卡让开浮在战场上的面板（#339 第 4 步）：纸片画面左上角的队伍、右边拉开的抽屉、底下的技能栏、顶上的胶带和吊牌浮在战场上，
// 取景时把它们让出来（hd2d-field.js · coverInsets 算上下左右让多少；hd2d-layout.js · fitView、hd2d-camera.js · frame / closeLens 认 view.left / right）。
//   · coverInsets：每块面板从它贴着的那条边让（让出去占比最小的那一条），战场外面的、太小的、盖满屏幕的不算，让太多按比例缩回来
//   · 几种窗口大小 × 抽屉收着 / 拉开：远景、中景、近景、特写里的白卡都不压在面板底下（以前左上角的队伍盖住最左边那张卡）
//   · 左右没盖住时取景和以前一样
// 面板的矩形照纸片画面的排版（online-paper.css / game-paper.css 的尺寸）摆；浏览器里量真的面板的在 tests/game-paper-ui.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");
const HP = require("./hd2d-paths");
const MD = require("./mini-dom");
const L = require("../hd2d/hd2d-layout.js");
const C = require("../hd2d/hd2d-camera.js");
const F = require("../hd2d/hd2d-field.js");

const read = (f) => fs.readFileSync(path.join(HP.ROOT, f), "utf8");

/** 规则环境里一场战斗：zm 个区，我方四个人在第一个区、敌人四个在最后一个区（最左、最右都有卡）；三个区时中间再放两个 */
function battle(zm) {
  const ctx = H.load();
  vm.runInContext(read("online-view.js"), ctx, { filename: "online-view.js" });
  const st = ctx.BattleSim.setup({
    party: ["kolt", "helu", "ruby", "yuito"], zoneMode: zm, seed: "hd2d-cover",
    enemies: [{ id: "guard_sword", lv: 2, zone: zm }, { id: "thug_hammer", lv: 2, zone: zm }, { id: "thug_knife", lv: 1, zone: zm }, { id: "bandit_boss", lv: 1, zone: zm }]
      .concat(zm >= 3 ? [{ id: "thug_knife", lv: 1, zone: 2 }, { id: "thug_hammer", lv: 1, zone: 2 }] : [])
  });
  return { ctx, st, OV: ctx.OnlineView };
}
/** 白卡的快照（联机玩家那条路：online-battle.js · snapUnit，过 hd2d-field.js · packetView） */
function view(R) {
  const P = MD.create('<main id="g-field"></main>'), ctx = vm.createContext(P.window);
  ["icons.js", "hud-icons.js", "unit-card.js", "online-battle.js"].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  return F.packetView(R.OV.projectState(R.st, {}), { OB: P.window.OnlineBattle, OV: R.OV });
}

/** 纸片画面浮在战场上的面板（电脑上；尺寸照 online-paper.css / game-paper.css）：顶栏胶带、吊牌、左上角的队伍（展开）、底下的技能栏、右边的抽屉 */
function panels(W, H, drawer) {
  const edge = 14, under = 100, dockW = Math.min(960, W - 2 * edge), dockH = 196;
  const out = {
    tape: { left: 12, top: 6, right: W - 12, bottom: 52 },
    tags: { left: W / 2 - 230, top: 48, right: W / 2 + 230, bottom: 102 },
    party: { left: edge, top: under, right: edge + 236, bottom: under + 330 },
    dock: { left: (W - dockW) / 2, top: H - 10 - dockH, right: (W + dockW) / 2, bottom: H - 10 }
  };
  out.drawer = drawer ? { left: W - edge - Math.min(340, W - 2 * edge), top: under + 30, right: W - edge, bottom: Math.min(under + 30 + 560, H - dockH - 24) }
    : { left: W - 40, top: Math.round(H * 0.36), right: W, bottom: Math.round(H * 0.36) + 190 };
  return out;
}
const hit = (a, b) => a.x0 < b.right - 0.5 && b.left < a.x1 - 0.5 && a.y0 < b.bottom - 0.5 && b.top < a.y1 - 0.5;
/** 卡片（屏幕矩形 x0 / y0 / x1 / y1）压在哪些面板底下 */
function covered(rects, ps) {
  const out = [];
  rects.forEach(r => Object.entries(ps).forEach(([name, p]) => { if (hit(r, p)) out.push(`${r.id} 压在${name}底下`); }));
  return out;
}

test("coverInsets：每块面板从它贴着的那条边让（让出去占比最小的那一条）；战场外面的、太小的、盖满屏幕的不算；让太多按比例缩回来；数值在 FIELD.cover", () => {
  const G = F.FIELD.cover, V = { width: 1440, height: 900 };
  assert.ok(G.gap >= 0 && G.min > 0 && G.max > 0 && G.max < 1 && G.room > 0 && G.room < 1, "配置表：" + JSON.stringify(G));
  const p = panels(1440, 900, false);
  assert.deepEqual(F.coverInsets(V, []), { top: 0, bottom: 0, left: 0, right: 0 }, "没有面板：不让");
  assert.deepEqual(F.coverInsets(V, [p.tape]), { top: 52 + G.gap, bottom: 0, left: 0, right: 0 }, "顶栏胶带：让上面");
  assert.deepEqual(F.coverInsets(V, [p.party]), { top: 0, bottom: 0, left: 250 + G.gap, right: 0 }, "左上角的队伍：让左边窄窄一条（比让上面 430 像素划算）");
  assert.deepEqual(F.coverInsets(V, [p.dock]), { top: 0, bottom: 206 + G.gap, left: 0, right: 0 }, "底下的技能栏：让下面");
  assert.deepEqual(F.coverInsets(V, [p.drawer]), { top: 0, bottom: 0, left: 0, right: 40 + G.gap }, "收着的抽屉（右边缘的竖标签）：让右边一点");
  const all = F.coverInsets(V, Object.values(panels(1440, 900, true)));
  assert.deepEqual(all, { top: 102 + G.gap, bottom: 206 + G.gap, left: 250 + G.gap, right: 354 + G.gap }, "都在：四边各让各的，取最大的那块");
  // 不算的：战场外面、太小、盖满屏幕（手机上拉开的抽屉）
  assert.deepEqual(F.coverInsets(V, [{ left: -300, top: 0, right: -10, bottom: 900 }, { left: 0, top: 0, right: G.min - 1, bottom: G.min - 1 }, { left: 0, top: 0, right: 1440, bottom: 900 }]),
    { top: 0, bottom: 0, left: 0, right: 0 });
  // 一半在战场外面：只算里面那一截
  assert.deepEqual(F.coverInsets(V, [{ left: -100, top: 300, right: 100, bottom: 500 }]), { top: 0, bottom: 0, left: 100 + G.gap, right: 0 });
  // 让太多：左右加起来至少留 room
  const big = F.coverInsets(V, [{ left: 0, top: 300, right: 600, bottom: 500 }, { left: 800, top: 300, right: 1440, bottom: 500 }]);
  assert.ok(big.left + big.right <= 1440 * (1 - G.room) + 1 && big.left > 0 && big.right > 0, JSON.stringify(big));
  assert.ok(Math.abs(big.left / big.right - (600 + G.gap) / (640 + G.gap)) < 0.02, "按比例缩回来");
  // 坏数据不报错
  assert.deepEqual(F.coverInsets(null, null), { top: 0, bottom: 0, left: 0, right: 0 });
});

/** 照 hd2d-field.js · paint 的排法：fitCover 先照全让排，让不下（有卡被推出画面）再少让 */
const fitOf = (v, W, Hh, ins) => F.fitCover((vw) => L.build(v, F.layoutOpts(v, vw, false, { cards: v.cards })), { width: W, height: Hh }, { top: 0, bottom: 0 }, ins, 0);

test("白卡不压在浮着的面板底下：几种窗口大小 × 抽屉收着 / 拉开，远景（布局的默认镜头）、中景、近景、特写里，取景都把左上角的队伍、右边的抽屉、底下的技能栏、顶上的胶带和吊牌让出来；地方实在不够时少让上下，卡不会被推出画面", () => {
  const sizes = [[1440, 900], [1920, 1080], [1366, 768], [1280, 720], [1024, 768]];
  const levels = [];
  for (const zm of [2, 3]) {
    const R = battle(zm), v = view(R);
    for (const [W, Hh] of sizes) for (const drawer of [false, true]) {
      const ps = panels(W, Hh, drawer), ins = F.coverInsets({ width: W, height: Hh }, Object.values(ps));
      const tag = `${zm} 区 · ${W}×${Hh} · 抽屉${drawer ? "拉开" : "收着"}`;
      const fit = fitOf(v, W, Hh, ins), lay = fit.layout, full = fit.level === 0;
      levels.push(`${tag}：第 ${fit.level} 级`);
      assert.equal(lay.cards, true);
      assert.ok(fit.level < F.FIELD.cover.steps.length, tag + "：左右总是让得开（左上角的队伍、右边的抽屉）");
      assert.deepEqual([lay.view.left, lay.view.right], [ins.left, ins.right], tag + "：布局记着左右让了多少");
      // 照全让排的：哪块面板底下都没有卡；少让了上下的：左右的面板（队伍、抽屉）底下照样没有卡
      const sides = full ? ps : { party: ps.party, drawer: ps.drawer };
      const far = lay.units.map(u => Object.assign({ id: u.id }, u.rect));
      assert.deepEqual(covered(far, sides), [], tag + " · 远景");
      far.forEach(r => assert.ok(r.x0 >= -1 && r.x1 <= W + 1 && r.y0 >= -1 && r.y1 <= Hh + 1, `${tag} · 远景：${r.id} 出了画面 ${JSON.stringify(r)}`));
      // 中景 / 近景：选中的区的卡（别的区本来就只框进来一截）；特写：那一张卡。
      // 左右的面板（队伍、抽屉）哪种窗口都让开；上下（胶带、吊牌、技能栏）在大的桌面窗口也让开——小窗口里中景 / 近景的镜头最远只能拉到远景的几成
      // （hd2d-camera.js · CAMERA.mid.dist），卡多的区上下可能还会压到一点，远景照样都让开
      const near = full && W >= 1440 && Hh >= 900 ? ps : { party: ps.party, drawer: ps.drawer };
      lay.zones.forEach(z => ["mid", "near"].forEach(tier => {
        const p = C.pose(lay, tier, z.id), mine = lay.units.filter(u => u.zone === z.id).map(u => Object.assign({ id: u.id }, p.plates[u.id].rect));
        assert.deepEqual(covered(mine, near), [], `${tag} · ${tier} · ${z.id} 区`);
      }));
      lay.units.forEach(u => {
        const cp = C.closePose(lay, u.id);
        assert.deepEqual(covered([Object.assign({ id: u.id }, cp.plates[u.id].rect)], near), [], tag + " · 特写 " + u.id);
      });
    }
  }
  // 常见的桌面窗口（1440×900、1920×1080、1366×768），抽屉平时收着：照全让就排得下（拉开抽屉看记录时三个区可能少让一点上下）
  const common = levels.filter(s => /1440×900|1920×1080|1366×768/.test(s) && /抽屉收着/.test(s));
  assert.equal(common.length, 6);
  common.forEach(s => assert.match(s, /第 0 级/, s));
});

test("fitCover：照全让排得下就不再试；排不下（有卡被推出画面）往下一级少让上下、左右照让，最后才连左右也不让；没有浮着的面板只排一次；从上次成了的那一级开始试", () => {
  const view = { width: 1000, height: 700 }, base = { top: 10, bottom: 20 }, cover = { top: 100, bottom: 200, left: 150, right: 50 };
  const tried = [], fake = (fitsFrom) => (vw) => { tried.push(vw); return { units: [{ rect: { x0: 0, y0: tried.length > fitsFrom ? 0 : -50, x1: 10, y1: 10 } }] }; };
  let r = F.fitCover(fake(0), view, base, cover);
  assert.equal(r.level, 0);
  assert.deepEqual(tried, [{ width: 1000, height: 700, top: 100, bottom: 200, left: 150, right: 50 }]);
  tried.length = 0;
  r = F.fitCover(fake(2), view, base, cover);
  assert.equal(r.level, 2, "第三次才排得下");
  assert.deepEqual(tried.map(v => [v.top, v.bottom, v.left, v.right]), [[100, 200, 150, 50], [50, 100, 150, 50], [10, 20, 150, 50]], "上下少让（不少于本来就要让的），左右照让");
  tried.length = 0;
  r = F.fitCover(fake(9), view, base, cover);
  assert.equal(r.level, 3, "都排不下：最后左右也不让");
  assert.deepEqual(tried.map(v => [v.top, v.bottom, v.left, v.right]).pop(), [10, 20, 0, 0]);
  tried.length = 0;
  r = F.fitCover(fake(9), view, base, { top: 0, bottom: 0, left: 0, right: 0 });
  assert.equal(tried.length, 1, "没有浮着的面板：每一级都一样，只排一次");
  tried.length = 0;
  r = F.fitCover(fake(0), view, base, cover, 2);
  assert.deepEqual(tried.map(v => [v.top, v.bottom, v.left, v.right]), [[10, 20, 150, 50]], "从上次成了的那一级开始");
  // 页面里：paint 走 fitCover，场景记着最后用的上下
  const src = read("hd2d/hd2d-field.js");
  assert.match(src, /const fit = fitCover\(/);
  assert.match(src, /S\.sc\.setInsets\(\{ top: fit\.view\.top, bottom: fit\.view\.bottom \}\)/);
});

test("没有浮着的面板（新画面关着纸片画面 / 旧版排版）：取景和以前一样——左右给 0 和不给一模一样，cover(null) 也不让", () => {
  const R = battle(3), v = view(R), base = { width: 1440, height: 900, top: 46, bottom: 160 };
  const a = L.build(v, F.layoutOpts(v, base, false, { cards: v.cards })), b = L.build(v, F.layoutOpts(v, Object.assign({ left: 0, right: 0 }, base), false, { cards: v.cards }));
  assert.deepEqual([a.camera.dist, a.camera.target, a.camera.pos], [b.camera.dist, b.camera.target, b.camera.pos]);
  assert.deepEqual(a.units.map(u => u.rect), b.units.map(u => u.rect));
  ["mid", "near"].forEach(t => assert.deepEqual(C.pose(a, t, 2).cam.pos, C.pose(b, t, 2).cam.pos, t));
  // 镜头往右让了：整个战场往左挪、镜头更远一点（卡是固定像素大小，地方小了要拉远）
  const c = L.build(v, F.layoutOpts(v, Object.assign({ left: 0, right: 400 }, base), false, { cards: v.cards }));
  const cx = (lay) => { const xs = lay.units.map(u => (u.rect.x0 + u.rect.x1) / 2); return (Math.min(...xs) + Math.max(...xs)) / 2; };
  assert.ok(cx(c) < cx(a) - 100, "让右边：卡往左挪 " + cx(a) + " → " + cx(c));
  assert.ok(Math.max(...c.units.map(u => u.rect.x1)) <= 1440 - 400 + 0.5, "右边 400 像素里没有卡");
});
