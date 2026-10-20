/* 角鳞 · 跑团模式的探索环节界面（规则在 trpg.js）
 *
 * 队伍就是战斗画面里的那支（跑团模式的「队伍记忆」）。进探索环节时按记忆重新摆一次队伍；
 * 每做一个操作就存一次，下一场战斗照这个状态开打；打完回来继续。 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const DEFAULT_PARTY = ["ruby", "yuito", "hiaki", "tou"];
  let tab = "party";
  let sheetKit = null;    // 「角色」页正在看谁
  const stampNow = () => `${typeof ledgerTimeText === "function" ? ledgerTimeText() : `第 ${LEDGER.day || 1} 天`} · 距长休 ${typeof durationText === "function" ? durationText(LEDGER.hours || 0) : (LEDGER.hours || 0) + " 小时"}`;
  let log = [];
  let slot = -1;          // 正在玩的存档空位
  let slotName = "";
  let undoStack = [];     // 探索环节的撤销：每个操作之前记一份（最多 20 步）
  const UNDO_MAX = 20;

  const TABS = [
    ["party", "队伍"], ["sheet", "角色"], ["rest", "时间与休息"], ["shop", "商店"], ["merchants", "商人"], ["clinic", "诊所"], ["bag", "背包"], ["smith", "武器升级"], ["workshop", "工坊"], ["tasks", "任务"], ["checks", "检定"], ["battles", "战斗模板"], ["backstage", "后台"]
  ];

  function heroes() { return trpgHeroes(); }
  let commandLevel = 1;
  function level() { return commandLevel; }
  function uiCommand(action, data) {
    return Commands.dispatch(Object.assign({ type: "trpg.ui", action, level: Number(($("g-level") || {}).value) || 1 }, data || {}));
  }
  // 花钱的操作由谁付（私人钱包，trpg.js · trpgPayWith）：面板上的「由谁付」选单，默认队伍公账
  let payer = "party";
  const PAYABLE = ["buy", "repair", "upgradeWeapon", "installPart", "installBlueprint", "craft", "redeem", "teachRecipe", "merchantBuy", "modifyHero"];
  function ruleCommand(action, data) {
    const c = Object.assign({ type: "trpg", action }, data || {});
    if (PAYABLE.includes(action) && payer !== "party" && c.payer == null && !c.free) c.payer = payer;
    return c;
  }
  function payerHtml() {
    const opts = [["party", `队伍公账（${trpgPurse("party")}）`]].concat(heroes().filter(h => !h.dead).map(h => [h.kit, `${h.name}（${trpgPurse(h.kit)}）`]));
    if (!opts.some(([k]) => k === payer)) payer = "party";
    return `<div class="tr-row tr-payer">由谁付 <select data-payer>${opts.map(([k, n]) => `<option value="${esc(k)}"${k === payer ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>
      <span class="r-hint">买东西、修理、升级、改装、制作、兑换都从这里扣钱。</span></div>`;
  }
  function walletHtml() {
    const hs = heroes().filter(h => !h.dead);
    const all = [["party", "队伍公账"]].concat(hs.map(h => [h.kit, h.name]));
    const sel = (id) => `<select id="${id}">${all.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join("")}</select>`;
    return `<h3>钱包</h3>
      <div class="tr-wallets"><span>队伍公账 <b>${trpgPurse("party")}</b></span>${hs.map(h => `<span>${esc(h.name)} <b>${trpgPurse(h.kit)}</b></span>`).join("")}</div>
      <p class="r-hint">任务的奎支报酬自动平分进各人钱包（个人任务只进那名角色的）；战斗掉落、下面「获得 / 花掉」的钱进出队伍公账。</p>
      <div class="tr-row">转账 ${sel("tr-pay-from")} → ${sel("tr-pay-to")} <input type="number" id="tr-pay-n" min="1" value="100" style="width:90px"> 奎支
        <button class="g-btn small" id="tr-pay-go">转过去</button>
        <button class="g-btn small" id="tr-pay-split" ${trpgPurse("party") ? "" : "disabled"}>把公账平分给大家</button></div>`;
  }

  /* ---------- 存 / 读：每个操作、每场战斗结算都自动写回当前存档空位 ---------- */
  function writeSlotNow() {
    if (slot < 0 || !TRPG.active || !window.GAME) return;
    // The legacy save format already serializes these profiles as JSON. Capture
    // that exact representation, with no DOM nodes or runtime-only properties.
    const data = JSON.parse(JSON.stringify({ name: slotName, campaign: GAME.campaign || null, log: log.slice(-400), level: level(), enc: GAME.lastEncounter || null }));
    Commands.dispatch(ruleCommand("writeSlot", { index: slot, slot: data }));
  }
  function save() {
    if (typeof ledgerCapture === "function") ledgerCapture();
    if (window.GAME && GAME.rememberCampaign) GAME.rememberCampaign();   // 会触发 onCampaignSaved → writeSlotNow
    else writeSlotNow();
  }
  function saveLog() { writeSlotNow(); }
  /** 记一份撤销点：和存档里写的是同一份东西 */
  function pushUndo() {
    if (window.HotseatGame && HotseatGame.isActive()) return;
    if (slot < 0 || !window.GAME) return;
    if (typeof ledgerCapture === "function") ledgerCapture();
    if (GAME.rememberCampaign) GAME.rememberCampaign();
    undoStack.push(JSON.parse(JSON.stringify({
      campaign: GAME.campaign || null, log, level: level(), enc: GAME.lastEncounter || null,
      partyKits: (GAME.partyKits || []).slice()
    })));
    while (undoStack.length > UNDO_MAX) undoStack.shift();
  }
  function undo() {
    if (window.HotseatGame && HotseatGame.isActive()) return;
    const u = undoStack.pop();
    if (!u) return;
    applySlotData(u);
    if (u.partyKits && u.partyKits.length) GAME.partyKits = u.partyKits.slice();
    rebuild();
    save();
    render();
  }
  /** 一次操作：执行、记日志、存档、重画 */
  function act(command) { return uiCommand("rule", { command }); }
  function performAct(command) {
    pushUndo();
    let notes = [];
    try { notes = Commands.dispatch(command) || []; } catch (e) { notes = ["没做成：" + e.message]; }
    notes = notes.filter(Boolean);
    if (notes.length) {
      const stamp = stampNow();
      log.push({ stamp, lines: notes });
      saveLog();
    }
    save();
    render();
    // 长休结算画面：主持人本机弹（主持人看得到坚毅数值），联机玩家那边由 online-ui.js 弹
    if (TRPG.lastRest && TRPG.lastRest.id !== shownRest && window.RestReport) { shownRest = TRPG.lastRest.id; RestReport.play(TRPG.lastRest, { gm: true }); }
    else if (TRPG.camp && window.RestReport && !RestReport.isOpen("camp")) {
      const plan = TRPG.camp.plan;
      RestReport.camp(TRPG.camp.status, { host: true, gm: true, force: TRPG.camp.force,
        onStart: () => act(ruleCommand("longRest", { plan })), onCancel: () => act(ruleCommand("campClose")) });
    }
  }
  let shownRest = null;
  /** 按记忆重新摆队伍（从战斗画面回来、换队员时） */
  function rebuild() {
    if (window.GAME && GAME.setupBattle) GAME.setupBattle(level());
  }

  /* ---------- 顶栏 ---------- */
  function renderTop() {
    const ub = $("tr-undo");
    if (ub) { ub.disabled = !undoStack.length; ub.textContent = undoStack.length > 1 ? `撤销（${undoStack.length}）` : "撤销"; }
    $("tr-slot-name").textContent = slot >= 0 ? `存档 ${slot + 1} · ${slotName}` : "";
    const t = exhaustTier();
    const ck = LEDGER.clock == null ? 480 : LEDGER.clock;
    $("tr-clock").innerHTML = `第 <b>${LEDGER.day || 1}</b> 天 <b class="tr-time">${clockText(ck)}</b> ${dayPeriod(ck)} · 距上次长休 <b>${durationText(LEDGER.hours || 0)}</b>` +
      (t ? ` · <span class="warn">${esc(exhaustText(t))}</span>` : "");
    const food = FOOD_ORDER.reduce((s, id) => s + bagCount(id), 0);
    const purses = heroes().filter(h => !h.dead).reduce((s, h) => s + trpgPurse(h.kit), 0);
    $("tr-supplies").innerHTML = `<span title="队伍公账 / 各人钱包合计">公账 <b>${Number(state.kuizhi) || 0}</b> · 钱包 <b>${purses}</b></span><span>水 <b>${ledgerWater()}</b> ml</span><span>食物 <b>${food}</b> 份</span>` +
      `<button class="g-btn small" data-career="1" title="这个存档所有战斗里每个角色的输出占比和团队贡献">整局数据</button>`;
  }

  /** 面板上的攻击力：角色 + 手里的武器（和战斗里一样算） */
  function heroAtk(h) {
    try { return typeof effectiveAtk === "function" ? effectiveAtk(h, state.units) : (Number(h.atk) || 0); } catch (e) { return Number(h.atk) || 0; }
  }
  /* ---------- 左栏：队伍状态（主持人视角，坚毅生命照常显示） ---------- */
  function renderParty() {
    $("tr-party").innerHTML = heroes().map(h => {
      const tag = h.dead ? "死亡" : h.dying ? "濒死" : h.upOnShp ? "起身中" : "";
      const xpNext = typeof xpToNext === "function" ? xpToNext(h.level || 1) : 0;
      const weapons = (h.linkedKits || []).map(k => {
        const lv = (h.weaponLevels || {})[k] || 1;
        const d = weaponDur(k), m = weaponDurMax(k);
        const bond = typeof weaponBond === "function" ? weaponBond(h, k) : 0;
        return `<div class="rh-w${d <= 0 ? " broken" : ""}">${esc(weaponName(k))} Lv${lv}${bond ? ` · 羁绊 ${bond}` : ""} · 耐久 ${d}/${m}${d <= 0 ? "（损坏）" : ""}</div>`;
      }).join("");
      return `<div class="rhero${h.dead ? " fallen" : h.dying ? " dying" : ""}">
        <div class="rh-top"><b>${esc(h.name)}</b><span>Lv${h.level || 1}${tag ? " · " + tag : ""}</span><button class="g-btn small rh-sheet" data-sheet="${esc(h.kit)}" title="数值、被动和技能说明">资料</button><button class="g-btn small rh-sheet" data-armory="${esc(h.kit)}" title="武器补正、atk 明细、改装件和客制化">武器</button></div>
        <div class="rh-row">血量 <span>${totalHpOf(h)}/${totalHpMaxOf(h)}</span></div>
        <div class="rh-row">攻击力 <span>${heroAtk(h)}</span></div>
        <div class="rh-row">架势 <span>${Number(h.def) || 0}/${Number(h.defMax != null ? h.defMax : h.def) || 0}</span></div>
        <div class="rh-row">协助格挡 <span>${typeof blockChance === "function" && blockChance(h) != null ? blockChance(h) + "%" : "—"}</span></div>
        <div class="rh-row">坚毅 <span>${Number(h.shp) || 0}/${Number(h.shpMax) || 0}</span></div>
        <div class="rh-row">经验 <span>${Number(h.xp) || 0}/${xpNext || "满"}</span></div>
        ${Number(h.attrPoints) > 0 ? `<div class="rh-w tr-attn">有 ${h.attrPoints} 点属性点可分配（队伍页）</div>` : ""}
        ${Number(h.featPoints) > 0 ? `<div class="rh-w tr-attn">有 ${h.featPoints} 项专长可选（队伍页）</div>` : ""}
        ${(h.feats || []).length && typeof featLabel === "function" ? `<div class="rh-w">专长：${esc(h.feats.map(id => (FEATS[id] || {}).name || id).join("、"))}</div>` : ""}
        ${weapons}
      </div>`;
    }).join("") || `<p class="r-hint">还没有队员。到「队伍」页选人。</p>`;
  }

  /* ---------- 各页 ---------- */
  const PANELS = {
    sheet() {
      const data = window.SkillText ? SkillText.sheetData() : [];
      if (!data.length) return `<p class="r-hint">还没有队员。到「队伍」页选人。</p>`;
      if (!data.some(h => h.kit === sheetKit)) sheetKit = data[0].kit;
      const h = data.find(x => x.kit === sheetKit);
      return `<div class="hs-tabs tr-sheet-tabs">${data.map(x => `<button class="g-btn${x.kit === sheetKit ? " on" : ""}" data-hs-kit="${esc(x.kit)}">${esc(x.name)}</button>`).join("")}</div>
        <div class="tr-sheet">${window.HeroSheet ? HeroSheet.heroHtml(h) : ""}</div>`;
    },
    party() {
      const pool = livePartyCards().filter(c => !c.weaponOf);
      const on = new Set((window.GAME && GAME.partyKits) || []);
      const picks = pool.map(c => `<label class="tr-pick"><input type="checkbox" data-kit="${esc(c.kit)}" ${on.has(c.kit) ? "checked" : ""}>${esc(c.name)}<small>${esc(c.note || "")}</small></label>`).join("");
      // 单项属性硬性上限 10：已经满的属性不列出来
      const attrs = heroes().filter(h => Number(h.attrPoints) > 0).map(h =>
        `<div class="tr-row"><b>${esc(h.name)}</b> 有 ${h.attrPoints} 点属性点：
          ${Object.keys(ATTR_NAMES).map(k => `<button class="g-btn small" data-attr="${esc(h.kit)}:${k}">${ATTR_NAMES[k]} ${(h.attrs || {})[k] || 0} +1</button>`).join("")}</div>`).join("");
      // 专长（feats.js）：有专长点的角色，选一项（兼修再选一张涉猎专长）
      const featRows = typeof featChoicesFor !== "function" ? "" : heroes().filter(h => Number(h.featPoints) > 0).map(h => {
        const opts = featChoicesFor(h, h.level).map(id => `<option value="${esc(id)}">${esc(featLabel(id))} · ${esc(FEATS[id].text || "")}</option>`).join("");
        const full = featFullOptions(h).map(id => `<option value="${esc(id)}">${esc(FEATS[id].name)}</option>`).join("");
        return `<div class="tr-row"><b>${esc(h.name)}</b> 有 ${h.featPoints} 项专长：
          <select data-feat-pick="${esc(h.kit)}" style="max-width:100%">${opts}</select>
          ${full ? `<select data-feat-full="${esc(h.kit)}" title="兼修升级哪一张">${full}</select>` : ""}
          <button class="g-btn small" data-feat-go="${esc(h.kit)}">选定</button></div>`;
      }).join("");
      return `<h3>队员</h3>
        <p class="r-hint">勾选参加这次跑团的角色。换人会按队伍记忆重新摆队伍，已有角色的等级、血量、物资不变。</p>
        <div class="tr-picks">${picks}</div>
        <button class="g-btn" id="tr-apply-party">按勾选换队伍</button>
        <h3>发经验</h3>
        <div class="tr-row">
          <input type="number" id="tr-xp" value="10" min="1" style="width:90px"> 点经验，给
          <select id="tr-xp-who"><option value="">全员</option>${heroes().map(h => `<option value="${esc(h.kit)}">${esc(h.name)}</option>`).join("")}</select>
          <button class="g-btn" id="tr-xp-go">发放</button>
        </div>
        <p class="r-hint">升级照手册第三章：4 级、8 级、19 级各 1 点属性点（8 级那点不能加在曾经加过的同一项上，19 级的可以）；职责技能按角色卡自动解锁；熟练项、专长由主持人记在角色卡上。</p>
        ${attrRequestsHtml()}
        ${attrs ? `<h3>分配属性点</h3>${attrs}` : ""}
        ${featRows ? `<h3>分配专长</h3><p class="r-hint">7 / 11 / 13 / 16 级各一项，可以选这一级或更低级的。选「兼修」时再选要升成完整版的涉猎专长。</p>${featRows}` : ""}
        <h3>重新开团</h3>
        <button class="g-btn" id="tr-reset">清空这个存档的进度（等级、物资、时间全部归零）</button>
        <p class="r-hint">要同时带别的团，点顶栏「换存档」用另一个空位。</p>`;
    },
    rest() {
      const plan = longRestNeeds({});
      const foodTotal = Object.keys(plan.food).reduce((a, id) => a + (Number(plan.food[id]) || 0), 0);
      const foods = FOOD_ORDER.filter(id => ITEM_CATALOG[id]);
      const opt = longRestOptions({});
      const rows = heroes().filter(h => !h.dead).map(h => {
        const c = heroRestCost(h);
        const o = opt.heroes.find(x => x.kit === h.kit) || {};
        return `<div class="tr-row"><b>${esc(h.name)}</b> 长休需 ${c.water} ml 水 · ${c.food} 份食物 · 吃
          <select data-food="${esc(h.kit)}">${foods.map(id => `<option value="${id}" ${id === o.foodId ? "selected" : ""}>${esc(ITEM_CATALOG[id].name)}（有 ${bagCount(id)}）</option>`).join("")}</select>
          · 睡 <select data-sleep="${esc(h.kit)}"><option value="">不用睡眠道具</option>${opt.sleeps.map(x => `<option value="${esc(x.id)}" ${x.id === o.sleepId ? "selected" : ""}>${esc(x.name)}（每小时坚毅 +${x.bonus} · 有 ${x.have}）</option>`).join("")}</select>
          ${o.spit ? `· 吐酸改成 <select data-spit="${esc(h.kit)}">${(opt.spitElements || []).map(e => `<option value="${esc(e.id)}" ${e.id === o.spit ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select>` : ""}
          ${o.ammo != null ? `· 下一场弹序 <select data-ammo="${esc(h.kit)}">${(opt.ammoOrders || []).map(e => `<option value="${esc(e.id)}" ${e.id === o.ammo ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select>` : ""}
          · 今天还能短休 ${shortRestLeft(h)} 次</div>`;
      }).join("");
      const ck = LEDGER.clock == null ? 480 : LEDGER.clock;
      const nextTier = [20, 40, 60, 80].find(x => x > (Number(LEDGER.hours) || 0));
      return `<div class="tr-clockface">
          <div class="tr-cf-time">${clockText(ck)}</div>
          <div class="tr-cf-side"><b>第 ${LEDGER.day || 1} 天 · ${dayPeriod(ck)}</b>
            <span>距上次长休 ${durationText(LEDGER.hours || 0)}${nextTier ? ` · 再过 ${durationText(nextTier - (Number(LEDGER.hours) || 0))} 进入${nextTier >= 80 ? "力竭致死" : "力竭 " + (nextTier / 20)}` : ""}</span>
            <span class="tr-cf-bar"><i style="width:${(ck / 1440 * 100).toFixed(1)}%"></i></span></div>
        </div>
        <h3>推进时间</h3>
        <div class="tr-row">
          ${[10, 30].map(n => `<button class="g-btn" data-minutes="${n}">+${n} 分钟</button>`).join("")}
          ${[1, 2, 4, 8].map(n => `<button class="g-btn" data-hours="${n}">+${n} 小时</button>`).join("")}
        </div>
        <div class="tr-row">
          <input type="number" id="tr-hours" value="1" min="0" style="width:60px"> 小时
          <input type="number" id="tr-mins" value="0" min="0" max="59" style="width:60px"> 分钟
          <button class="g-btn" id="tr-hours-go">经过</button>
          <span style="margin-left:12px">一直等到</span> <input type="text" id="tr-until" value="${clockText((ck + 60) % 1440)}" maxlength="5" placeholder="21:00" style="width:64px">
          <button class="g-btn" id="tr-until-go">等待</button>
        </div>
        <p class="r-hint">24 小时制：时钟过了 0 点就进入下一天，短休次数刷新。「一直等到」的时刻如果今天已经过了，就等到明天的这个时刻。距上次长休 20 / 40 / 60 小时分别进入力竭 1 / 2 / 3，80 小时力竭致死（手册第五章）。</p>
        <h3>短休（1 小时）</h3>
        <div class="tr-row"><button class="g-btn" id="tr-short-all">全员短休</button>
          ${heroes().filter(h => !h.dead).map(h => `<button class="g-btn small" data-short="${esc(h.kit)}">${esc(h.name)}</button>`).join("")}</div>
        <h3>长休</h3>
        ${rows}
        <div class="tr-row">时长 <select id="tr-long-h">${[8, 9, 10, 11, 12].map(n => `<option value="${n}">${n} 小时</option>`).join("")}</select>
          <button class="g-btn r-main" id="tr-long">长休（${plan.water} ml 水 · ${foodTotal} 份食物）</button>
          <button class="g-btn" id="tr-long-force" title="不扣水和食物（剧情安排的休息）">长休（不扣补给）</button></div>
        <p class="r-hint">一共需要 <b>${plan.water}</b> ml 水、<b>${foodTotal}</b> 份食物（${esc(Object.keys(plan.food).map(id => `${(ITEM_CATALOG[id] || {}).name || id} ${plan.food[id]} 份`).join("、"))}）。${plan.ok ? "" : "补给不足：" + esc((plan.lack || []).join("，")) + "。"}长休：血量、耐久回满，武器人痊愈，坚毅生命按小时慢慢恢复，清空力竭。</p>
        <h3>主持人</h3>
        <button class="g-btn" id="tr-restore">全员复原（不扣补给、不推进时间）</button>`;
    },
    shop() {
      const groups = [];
      HANDBOOK_SHOP.forEach(r => { if (groups.indexOf(r.group) < 0) groups.push(r.group); });
      return payerHtml() + `<p class="r-hint">价格照手册物品表。「买」扣奎支；「给予」是主持人直接给（战利品、奖励），不扣钱。</p>` +
        groups.map(g => `<h3>${esc(g)}</h3><div class="shop">${HANDBOOK_SHOP.filter(r => r.group === g).map(r => {
          const id = r.give.item;
          const have = r.give.water ? `${ledgerWater()} ml` : `有 ${bagCount(id)}`;
          const hint = r.note || (id && ITEM_CATALOG[id] ? ITEM_CATALOG[id].hint : "");
          return `<div class="shop-row"><span class="s-name">${esc(trpgShopName(r))}${hint ? `<small>${esc(hint)}</small>` : ""}</span>
            <span class="s-have">${have}</span><span class="s-price">${r.price}</span>
            <input type="number" min="1" value="1" data-qty="${esc(r.key)}" style="width:52px">
            <button class="g-btn small" data-buy="${esc(r.key)}">买</button>
            <button class="g-btn small" data-give="${esc(r.key)}">给予</button></div>`;
        }).join("")}</div>`).join("");
    },
    bag() {
      const items = bagList();
      const heal = items.filter(x => x.id === "medkit" || x.id === "clinic");
      const kits = repairPoints();
      const weapons = heroes().flatMap(h => (h.linkedKits || []).map(k => ({ k, name: weaponName(k), d: weaponDur(k), m: weaponDurMax(k) })));
      return walletHtml() + payerHtml() + `<h3>奎支与水</h3>
        <div class="tr-row">队伍公账 <input type="number" id="tr-kz" value="100" style="width:100px">
          <button class="g-btn small" id="tr-kz-add">＋ 获得</button><button class="g-btn small" id="tr-kz-sub">－ 花掉</button>
          <input type="text" id="tr-kz-why" placeholder="原因（可不填）" style="width:160px"></div>
        <div class="tr-row">水 <input type="number" id="tr-water" value="1000" style="width:100px"> ml
          <button class="g-btn small" id="tr-water-add">＋</button><button class="g-btn small" id="tr-water-sub">－</button></div>
        <h3>用道具（探索中）</h3>
        ${heal.length ? heal.map(x => `<div class="tr-row">${esc(x.name)} ×${x.qty} → 给
            <select data-heal-who="${x.id}">${heroes().filter(h => !h.dead).map(h => `<option value="${esc(h.kit)}">${esc(h.name)}（${totalHpOf(h)}/${totalHpMaxOf(h)}）</option>`).join("")}</select>
            <button class="g-btn small" data-heal="${x.id}">使用</button></div>`).join("") : `<p class="r-hint">背包里没有医疗包。</p>`}
        ${kits ? `<div class="tr-row">${esc(repairPointsText())} → 修 <select id="tr-repair-who">${weapons.map(w => `<option value="${esc(w.k)}">${esc(w.name)}（${w.d}/${w.m}）</option>`).join("")}</select>
            <button class="g-btn small" id="tr-repair">修到满（修几点用几点）</button></div>` : ""}
        <h3>背包</h3>
        <div class="shop">${items.map(x => `<div class="shop-row"><span class="s-name">${esc(x.name)}${x.hint ? `<small>${esc(x.hint)}</small>` : ""}</span>
          <span class="s-have">×${x.qty}</span><span class="s-price"></span>
          <button class="g-btn small" data-item="${esc(x.id)}:-1">−1</button><button class="g-btn small" data-item="${esc(x.id)}:1">+1</button></div>`).join("") || `<p class="r-hint">背包是空的。</p>`}</div>`;
    },
    smith() {
      const U = HANDBOOK_WEAPON_UPGRADE;
      const rows = heroes().flatMap(h => (h.linkedKits || []).map(k => {
        const info = trpgUpgradeInfo(h, k);
        const name = weaponName(k);
        if (info.max) return `<div class="tr-up"><b>${esc(name)}</b>（${esc(h.name)}）Lv${info.lv} · 已满级</div>`;
        const mats = info.mats.map(m => `<span class="${m.have >= m.need ? "" : "bad"}">${esc(m.name)} ${m.have}/${m.need}</span>`).join("、");
        return `<div class="tr-up"><b>${esc(name)}</b>（${esc(h.name)}）Lv${info.lv} → ${info.next}
          <div class="r-hint">材料：${mats}${info.labor ? ` · 工匠参考费用 ${info.labor} 奎支上下` : ""}</div>
          <div class="tr-row">
            ${info.canSelf ? `<button class="g-btn small" data-up="${esc(h.kit)}:${esc(k)}:self" ${info.enough ? "" : "disabled"}>在工作站自己升（只耗材料）</button>` : ""}
            <span>工匠费用 <input type="number" value="${info.labor}" min="0" data-fee="${esc(k)}" style="width:90px"></span>
            <button class="g-btn small" data-up="${esc(h.kit)}:${esc(k)}:smith" ${info.enough ? "" : "disabled"}>找工匠升（材料 + 费用）</button>
            <button class="g-btn small" data-up="${esc(h.kit)}:${esc(k)}:gm">主持人直接升（不耗）</button>
          </div></div>`;
      })).join("");
      const parts = Object.keys(WEAPON_PARTS);
      // 按等级分组：<optgroup label="C 级">…；opt(p) 生成一项
      const partOpts = (opt) => ["C", "B", "A", "S"].map(g => {
        const ps = parts.filter(p => WEAPON_PARTS[p].grade === g);
        return ps.length ? `<optgroup label="${g} 级">${ps.map(opt).join("")}</optgroup>` : "";
      }).join("");
      const slotRows = heroes().flatMap(h => (h.linkedKits || []).map(k => {
        const row = weaponPartRow(h, k);
        const name = weaponName(k);
        const coefs = weaponCoefs(k, weaponPartsOf(h, k));
        const coefTxt = Object.keys(coefs).map(a => `${WEAPON_PART_ATTR_CN[a] || a} ${coefs[a]}`).join(" · ");
        if (!row.length) return `<div class="tr-up"><b>${esc(name)}</b>（${esc(h.name)}）没有改装槽（武器等级 + 羁绊到 ${WEAPON_PART_SLOT_LEVELS[0]} 级开放） · 补正 ${esc(coefTxt)}</div>`;
        const slots = row.map((id, i) => `<div class="tr-row">槽 ${i + 1}：${id ? `<b>${esc(weaponPartLabel(id))}</b> <small>${esc(weaponPartText(id))}</small>
            <button class="g-btn small" data-part-rm="${esc(h.kit)}:${esc(k)}:${i}">拆下</button>` : `<span class="r-hint">空</span>`}
            <select data-part-pick="${esc(h.kit)}:${esc(k)}:${i}">${partOpts(p => `<option value="${esc(p)}">${esc(weaponPartLabel(p))} ${esc(weaponPartText(p))}（背包 ${bagCount(weaponPartItemId(p))}）</option>`)}</select>
            <button class="g-btn small" data-part-in="${esc(h.kit)}:${esc(k)}:${i}:0">装上（从背包）</button>
            <button class="g-btn small" data-part-in="${esc(h.kit)}:${esc(k)}:${i}:1">主持人直接装</button></div>`).join("");
        return `<div class="tr-up"><b>${esc(name)}</b>（${esc(h.name)}）${row.length} 个改装槽 · 补正 ${esc(coefTxt)}${slots}</div>`;
      })).join("");
      const give = `<div class="tr-row">随机生成 <button class="g-btn small" data-part-rand="C">C 级 +1</button><button class="g-btn small" data-part-rand="B">B 级 +1</button></div>
        <div class="tr-row">给予改装件 <select id="tr-part-give">${partOpts(p => `<option value="${esc(weaponPartItemId(p))}">${esc(weaponPartLabel(p))} · ${esc(weaponPartText(p))}</option>`)}</select>
          <button class="g-btn small" id="tr-part-give-btn">放进背包 +1</button></div>`;
      return `<p class="r-hint">手册：升级武器需要找到工作站；${U.selfMaxLevel} 级以上无法靠自己升级，要找专门的武器工匠（材料 + 加工费，不同工匠的费用要求不一样，按剧情改费用）。材料在商店「材料」里买，或在背包里给予。</p>${rows}
        <h3>改装槽 <button class="g-btn small" data-armory="${esc((heroes()[0] || {}).kit || "")}">打开武器工坊</button></h3>
        <p class="r-hint">武器等级 + 羁绊到 ${WEAPON_PART_SLOT_LEVELS.join(" 级、")} 级各开放 1 个改装槽（羁绊在「后台」里改，只解锁奖励、不提高数值）。改装件修改武器的属性补正系数；装上从背包拿走，拆下放回背包。</p>
        ${give}${slotRows}
        ${blueprintPanel()}`;
    }
  };

  /* 客制化图纸：主持人放进背包，再装到武器上（一把武器一张，装新的把旧的放回背包） */
  function blueprintPanel() {
    if (typeof ROGUE_SMITHS === "undefined") return "";
    const all = ROGUE_SMITHS.flatMap(s => (s.blueprints || []).map(b => Object.assign({ smithName: s.name }, b)));
    const opt = (b) => `<option value="${esc(b.id)}">${esc(b.name)}（背包 ${bagCount(b.id)}）· ${esc(b.text)}</option>`;
    const groups = ROGUE_SMITHS.map(s => `<optgroup label="${esc(s.name)}">${(s.blueprints || []).map(b => opt(b)).join("")}</optgroup>`).join("");
    const minLv = BLUEPRINT_MIN_LEVEL;
    const rows = heroes().flatMap(h => (h.linkedKits || []).map(k => {
      const cur = (h.weaponBlueprints || {})[k];
      const b = cur ? all.find(x => x.id === cur) : null;
      const lv = typeof trpgBpLevel === "function" ? trpgBpLevel(h, k) : trpgWeaponLevel(h, k);
      // 「武器等级 + 羁绊」4 级才解锁客制化：不到 4 级装不上，已经装着的（旧存档、后台降级）不生效
      const locked = lv < minLv ? `<span class="r-hint">「武器等级 + 羁绊」${minLv} 级才解锁客制化（现在 ${lv} 级）</span>` : "";
      return `<div class="tr-up"><b>${esc(weaponName(k))}</b>（${esc(h.name)}）${b ? `装着「<b>${esc(b.name)}</b>」<small> ${esc(b.text)}</small>${lv < minLv ? `<b class="bad">（「武器等级 + 羁绊」不到 ${minLv} 级，不生效）</b>` : ""}
          <button class="g-btn small" data-bp-rm="${esc(h.kit)}:${esc(k)}">拆下（放回背包）</button>` : `<span class="r-hint">没有装图纸</span>`}
        ${locked ? `<div class="tr-row">${locked}</div>` : `<div class="tr-row"><select data-bp-pick="${esc(h.kit)}:${esc(k)}">${groups}</select>
          <span>工钱 <input type="number" min="0" value="0" data-bp-fee="${esc(h.kit)}:${esc(k)}" style="width:90px"></span>
          <button class="g-btn small" data-bp-in="${esc(h.kit)}:${esc(k)}:0">装上（从背包）</button>
          <button class="g-btn small" data-bp-in="${esc(h.kit)}:${esc(k)}:1">主持人直接装（不耗）</button></div>`}</div>`;
    })).join("");
    return `<h3>客制化图纸 <button class="g-btn small" data-armory="${esc((heroes()[0] || {}).kit || "")}">在武器工坊里看实际效果</button></h3>
      <p class="r-hint">「武器等级 + 羁绊」到 ${minLv} 级才解锁客制化（和改装槽、被动升级一样）。一把武器只能装一张，装新的会把旧的放回背包；拆下也放回背包。工钱按剧情填（不同工匠收费不一样），主持人直接装不耗图纸也不收钱。</p>
      <div class="tr-row">给予图纸 <select id="tr-bp-give">${groups}</select><button class="g-btn small" id="tr-bp-give-btn">放进背包 +1</button></div>
      ${rows}`;
  }

  /* 后台：按叙事直接改数值（不走规则），改完点「应用改动」一次写入并记进探索记录 */
  PANELS.backstage = function () {
    const numIn = (attrs, v, w) => `<input type="number" ${attrs} value="${v}" style="width:${w || 64}px">`;
    const heroesHtml = heroes().map(h => {
      const k = esc(h.kit);
      const layers = (h.layers || []).map((l, i) =>
        `<label>${esc((LAYER && LAYER[l.type]) || l.type)} ${numIn(`data-bs-layer="${k}" data-i="${i}" min="0" max="${l.max}"`, Number(l.current) || 0)} / ${l.max}</label>`).join("");
      const st = trpgHeroStatus(h);
      const attrs = Object.keys(ATTR_NAMES).map(a =>
        `<label>${ATTR_NAMES[a]} ${numIn(`data-bs-attr="${k}" data-k="${a}" min="1"`, (h.attrs || {})[a] || 0, 48)}</label>`).join("");
      const weapons = (h.linkedKits || []).map(w => {
        const hurt = LEDGER.weapons && LEDGER.weapons[w];
        const hurtText = hurt ? hurt.map(x => `${(LAYER && LAYER[x.type]) || x.type} ${x.current}`).join(" / ") : "";
        return `<div class="tr-row"><b>${esc(weaponName(w))}</b>
          <label>等级 ${numIn(`data-bs-wlv="${k}" data-w="${esc(w)}" min="1" max="${HANDBOOK_WEAPON_UPGRADE.maxLevel}"`, trpgWeaponLevel(h, w), 52)}</label>
          <label title="羁绊等级加在武器等级上，只用来更早解锁改装槽和被动升级，不提高 atk 等数值">羁绊 ${numIn(`data-bs-bond="${k}" data-w="${esc(w)}" min="0" max="${typeof BOND_MAX !== "undefined" ? BOND_MAX : 5}"`, typeof weaponBond === "function" ? weaponBond(h, w) : 0, 44)}</label>
          <label>耐久 ${numIn(`data-bs-dur="${k}" data-w="${esc(w)}" min="0" max="${weaponDurMax(w)}"`, weaponDur(w), 52)} / ${weaponDurMax(w)}</label>
          ${hurt ? `<label title="武器人上次留下的伤势：${esc(hurtText)}"><input type="checkbox" data-bs-heal="${k}" data-w="${esc(w)}"> 治好武器人伤势（${esc(hurtText)}）</label>` : ""}</div>`;
      }).join("");
      return `<div class="tr-up tr-bs">
        <div class="tr-row"><b>${esc(h.name)}</b>
          <label>状态 <select data-bs-status="${k}">${Object.keys(TRPG_STATUS).map(x => `<option value="${x}" ${x === st ? "selected" : ""}>${TRPG_STATUS[x]}</option>`).join("")}</select></label>
          <label>等级 ${numIn(`data-bs-lv="${k}" min="1" max="20"`, h.level || 1, 52)}</label>
          <label>经验 ${numIn(`data-bs-xp="${k}" min="0"`, Number(h.xp) || 0, 72)}</label>
          <label>属性点 ${numIn(`data-bs-pts="${k}" min="0"`, Number(h.attrPoints) || 0, 48)}</label>
          <label>今天已短休 ${numIn(`data-bs-short="${k}" min="0"`, Number(LEDGER.shortUsed[h.kit]) || 0, 48)}</label></div>
        <div class="tr-row">${layers}<label>坚毅 ${numIn(`data-bs-shp="${k}" min="0" max="${h.shpMax}"`, Number(h.shp) || 0)} / ${h.shpMax}</label></div>
        <div class="tr-row">${attrs}</div>
        ${weapons}
      </div>`;
    }).join("");
    return `<p class="r-hint">给叙事用：剧情里受伤、被抢、武器磕坏、昏迷了几天……直接改成想要的数字，不走任何规则。改完点下面的「应用改动」一次写入，每项改动都记进探索记录。
      改等级或属性会按规则重算血量和坚毅的上限（按原来的比例），想要具体数字就在同一次里一起填。</p>
      <h3>队伍</h3>
      <div class="tr-row">
        <label>第 ${numIn(`id="bs-day" min="1"`, LEDGER.day || 1, 56)} 天</label>
        <label>时刻 <input type="text" id="bs-clock" value="${clockText(LEDGER.clock == null ? 480 : LEDGER.clock)}" maxlength="5" placeholder="08:00" style="width:64px"></label>
        <label>距上次长休 ${numIn(`id="bs-hours" min="0" step="any"`, Math.round((LEDGER.hours || 0) * 100) / 100, 64)} 小时</label>
        <label>奎支 ${numIn(`id="bs-kz" min="0"`, Number(state.kuizhi) || 0, 100)}</label>
        <label>水 ${numIn(`id="bs-water" min="0"`, ledgerWater(), 80)} ml</label>
      </div>
      <h3>角色</h3>
      ${heroesHtml || `<p class="r-hint">还没有队员。</p>`}
      <div class="tr-row tr-bs-foot">
        <input type="text" id="bs-why" placeholder="原因（写进记录，可不填）" style="width:260px">
        <button class="g-btn r-main" id="bs-apply">应用改动</button>
        <button class="g-btn" id="bs-undo">放弃未应用的改动</button>
      </div>
      <p class="r-hint">背包里的物品在「背包」页 ±1；战斗中要改数值用战斗顶栏的「后台」（也能改耐久）。</p>`;
  };
  function readBackstage() {
    const P = $("tr-panel");
    const val = (el) => el.value;
    const edit = { day: $("bs-day").value, clock: $("bs-clock").value, hours: $("bs-hours").value, kuizhi: $("bs-kz").value, water: $("bs-water").value, heroes: {} };
    const H = (k) => (edit.heroes[k] = edit.heroes[k] || { attrs: {}, layers: [], weapons: {} });
    const W = (k, w) => (H(k).weapons[w] = H(k).weapons[w] || {});
    P.querySelectorAll("[data-bs-status]").forEach(el => { H(el.dataset.bsStatus).status = val(el); });
    P.querySelectorAll("[data-bs-lv]").forEach(el => { H(el.dataset.bsLv).level = val(el); });
    P.querySelectorAll("[data-bs-xp]").forEach(el => { H(el.dataset.bsXp).xp = val(el); });
    P.querySelectorAll("[data-bs-pts]").forEach(el => { H(el.dataset.bsPts).attrPoints = val(el); });
    P.querySelectorAll("[data-bs-short]").forEach(el => { H(el.dataset.bsShort).shortUsed = val(el); });
    P.querySelectorAll("[data-bs-shp]").forEach(el => { H(el.dataset.bsShp).shp = val(el); });
    P.querySelectorAll("[data-bs-layer]").forEach(el => { H(el.dataset.bsLayer).layers[Number(el.dataset.i)] = val(el); });
    P.querySelectorAll("[data-bs-attr]").forEach(el => { H(el.dataset.bsAttr).attrs[el.dataset.k] = val(el); });
    P.querySelectorAll("[data-bs-wlv]").forEach(el => { W(el.dataset.bsWlv, el.dataset.w).level = val(el); });
    P.querySelectorAll("[data-bs-dur]").forEach(el => { W(el.dataset.bsDur, el.dataset.w).dur = val(el); });
    P.querySelectorAll("[data-bs-bond]").forEach(el => { W(el.dataset.bsBond, el.dataset.w).bond = val(el); });
    P.querySelectorAll("[data-bs-heal]").forEach(el => { if (el.checked) W(el.dataset.bsHeal, el.dataset.w).heal = true; });
    return edit;
  }

  function renderTabs() {
    $("tr-tabs").innerHTML = TABS.map(([k, n]) => `<button class="tr-tab${k === tab ? " on" : ""}" data-tab="${k}">${n}</button>`).join("");
  }
  function renderLog() {
    $("tr-log").innerHTML = log.slice(-80).map(e => `<li><small>${esc(e.stamp)}</small>${e.lines.map(esc).join("<br>")}</li>`).join("");
    const box = $("tr-log").parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }
  function render() {
    renderTop();
    renderParty();
    renderTabs();
    $("tr-panel").innerHTML = PANELS[tab]();
    renderLog();
    bind();
  }

  /* ---------- 任务（trpg-tasks.js）：主持人发布、编辑任务，预先配置路线、每站敌人、奖励 ---------- */
  let taskEdit = null;   // 正在编辑的任务（一份拷贝，点「保存」才写回）
  const NODE_T = () => TRPG_NODE_TYPES;
  const WX = { none: "常态", heat: "酷暑", snow: "雪天", acid: "酸雨", thunder: "雷鸣", glow: "微光", sand: "沙暴", phase: "相位" };
  const presetName = (id) => ((typeof enemyPresets === "function" ? enemyPresets() : []).find(p => p.id === id) || {}).name || id;
  const options = (pairs, cur) => pairs.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(t)}</option>`).join("");
  function taskRewardText(t) {
    const r = t.reward, out = [];
    if (r.kuizhi) out.push(`${r.kuizhi} 奎支`);
    if (r.xp) out.push(`每人 ${r.xp} 经验`);
    r.items.forEach(x => out.push(`${(ITEM_CATALOG[x.id] || {}).name || x.id}×${x.qty}`));
    r.parts.forEach(id => out.push(weaponPartLabel(id)));
    r.blueprints.forEach(id => out.push(`图纸「${(blueprintSpec(id) || {}).name || id}」`));
    if (t.escort && r.intactKuizhi) out.push(`完好额外 ${r.intactKuizhi} 奎支`);
    return out.join("、") || "无";
  }
  function taskEscortText(t) {
    if (!t.escort) return "";
    const sp = escortSpec(t.escort, t.escort.level);
    const cur = t.escort.lost ? 0 : t.escort.cur != null ? t.escort.cur : sp.hpMax;
    return `护送 <b>${esc(sp.name)}</b>（${sp.kind === "cart" ? "货车" : "人物"} · 血量 ${t.status === "active" ? `${cur}/${sp.hpMax}` : sp.hpMax} · 架势 ${sp.def} · atk ${sp.atk}）${t.escort.lost ? ' <span class="bad">已被摧毁</span>' : ""}`;
  }
  function taskRoute(t) {
    return `<div class="tk-route">${t.nodes.map((n, i) => {
      const cls = t.status === "active" ? (i < t.index ? " done" : i === t.index ? " cur" : "") : "";
      const foes = n.template ? `：模板「${n.template.name}」` : n.enemies.length ? `：${n.enemies.map(e => `${presetName(e.id)} Lv${e.lv}`).join("、")}${n.weather !== "none" ? ` · ${WX[n.weather]}` : ""}` : "";
      const rw = [n.reward && n.reward.xp ? `+${n.reward.xp} 经验` : "", n.reward && n.reward.kuizhi ? `+${n.reward.kuizhi} 奎支` : ""].filter(Boolean).join(" ");
      const got = t.granted && t.granted.nodes.includes(i);
      return `<span class="tk-node${cls}${n.hidden ? " tk-hid" : ""}" title="${esc(n.note || "")}">${i + 1}. ${n.hidden ? "🔒" : ""}${esc(n.title || NODE_T()[n.type])}${n.title ? ` · ${esc(NODE_T()[n.type])}` : ""}${esc(foes)}${n.note ? ` · ${esc(n.note)}` : ""}${rw ? ` <b class="tk-rw${got ? " got" : ""}">${esc(rw)}${got ? " ✓" : ""}</b>` : ""}</span>`;
    }).join("")}</div>`;
  }
  function taskCardHtml(t) {
    const st = `<span class="tk-st tk-${t.status}">${TRPG_TASK_STATUS[t.status]}</span>`;
    const id = esc(t.id);
    const node = t.status === "active" ? t.nodes[t.index] : null;
    const fight = node && (node.type === "battle" || node.type === "elite");
    const btns = [];
    if (t.status === "draft") btns.push(`<button class="g-btn small" data-tk="post:${id}">发布</button>`);
    if (t.status === "posted") btns.push(`<button class="g-btn small" data-tk="accept:${id}">队伍接下任务</button>`, `<button class="g-btn small" data-tk="unpost:${id}">撤回为草稿</button>`);
    if (t.status === "active") {
      if (fight) btns.push(`<button class="g-btn small tk-go" data-tk="fight:${id}">打这一站（${esc(NODE_T()[node.type])}）</button>`);
      if (node) {
        const got = t.granted && t.granted.nodes.includes(t.index);
        const rw = !got && node.reward ? [node.reward.xp ? `每人 +${node.reward.xp} 经验` : "", node.reward.kuizhi ? `+${node.reward.kuizhi} 奎支` : ""].filter(Boolean).join("、") : "";
        btns.push(`<button class="g-btn small" data-tk="node:${id}">这一站完成${rw ? `（发 ${esc(rw)}）` : ""}</button>`);
      }
      if (t.index > 0) btns.push(`<button class="g-btn small" data-tk="back:${id}" title="已经发过的奖励不收回，再推进也不重发">回退一步</button>`);
      btns.push(`<button class="g-btn small" data-tk="complete:${id}">结算任务（发奖励）</button>`, `<button class="g-btn small" data-tk="fail:${id}">判定失败</button>`);
    }
    btns.push(`<button class="g-btn small" data-tk="edit:${id}">编辑</button>`);
    btns.push(`<button class="g-btn small" data-tk="up:${id}" title="任务日志里往前挪">↑</button><button class="g-btn small" data-tk="down:${id}" title="任务日志里往后挪">↓</button>`);
    const hiddenNodes = t.nodes.map((n, i) => (n.hidden ? i : -1)).filter(i => i >= 0);
    if (t.status !== "active") btns.push(`<button class="g-btn small" data-tk="del:${id}">删除</button>`);
    const vis = t.category === "personal" ? `只有操控 ${esc(t.owner ? trpgHeroLabel(t.owner) : "（没选角色）")} 的玩家可见`
      : t.visibility && t.visibility.mode === "players" ? `仅 ${esc(questPlayerNames(t.visibility.ids))} 可见` : "全队可见";
    return `<div class="tr-up tk-card${t.status === "active" ? " on" : ""}">
      <div class="tk-head"><b>${esc(t.name)}</b><span class="tk-cat${t.category === "main" ? " main" : t.category === "personal" ? " personal" : ""}">${TRPG_TASK_CATEGORY[t.category] || "支线"}</span><span class="tk-kind">${esc(TRPG_TASK_KINDS[t.kind])}</span>${st}${t.days ? `<span class="tk-days">${t.days} 天</span>` : ""}${t.nodes.length ? "" : '<span class="tk-kind">剧情（无路线）</span>'}<span class="tk-vis">${vis}</span></div>
      ${t.goal ? `<p class="tk-goal">${esc(t.goal)}</p>` : ""}
      ${t.gmNote ? `<p class="r-hint">主持人备注（玩家看不到）：${esc(t.gmNote)}</p>` : ""}
      ${t.status === "failed" && t.failWhy ? `<p class="r-hint">失败原因：${esc(t.failWhy)}</p>` : ""}
      <div class="r-hint">报酬：${esc(taskRewardText(t))}</div>
      ${t.escort ? `<div class="r-hint">${taskEscortText(t)}</div>` : ""}
      ${taskRoute(t)}
      ${node ? `<div class="r-hint">当前：第 ${t.index + 1} 站 ${esc(NODE_T()[node.type])}${node.note ? " · " + esc(node.note) : ""}</div>` : t.status === "active" ? `<div class="r-hint">路线走完了，可以结算。</div>` : ""}
      ${hiddenNodes.length && t.status !== "draft" ? `<div class="tr-row"><span class="r-hint">对玩家隐藏中：</span>${hiddenNodes.map(i => `<button class="g-btn small" data-tk="reveal:${id}:${i}">揭示第 ${i + 1} 站</button>`).join("")}</div>` : ""}
      <div class="tr-row">${btns.join("")}</div></div>`;
  }
  /** 联机房间里的玩家（不含主持人）：指定谁能看到这个任务 */
  function questRoster() {
    const v = window.OnlineGame && OnlineGame.getView ? OnlineGame.getView() : null;
    return v && v.active ? (v.players || []).filter(p => !p.gm) : [];
  }
  function questPlayerNames(ids) {
    const r = questRoster();
    return (ids || []).map(id => (r.find(p => p.id === id) || {}).name || "（不在房间的玩家）").join("、") || "没有人";
  }
  /** 编辑表单：data-te="路径" 的输入直接改 taskEdit；data-te-act 增删行 */
  function taskEditorHtml(t) {
    const inp = (path, v, w, type) => `<input type="${type || "text"}" data-te="${path}" value="${esc(v == null ? "" : v)}" style="width:${w || 120}px">`;
    const presets = (typeof enemyPresets === "function" ? enemyPresets() : []).map(p => [p.id, p.name]);
    const nodes = t.nodes.map((n, i) => {
      const fight = n.type === "battle" || n.type === "elite";
      const tpls = typeof battleTemplateList === "function" ? battleTemplateList() : [];
      const tplOpts = [["", "不用模板（按下面配置）"]].concat(tpls.map(x => [x.id, x.name]));
      if (n.template && !tpls.some(x => x.id === n.template.id)) tplOpts.push([n.template.id, n.template.name + "（已存进任务）"]);
      const tplRow = fight ? `<div class="tr-row">战斗模板 <select data-te-tpl="${i}">${options(tplOpts, n.template ? n.template.id : "")}</select>
          ${n.template ? `<span class="r-hint">${esc(battleTemplateSummary(n.template))}</span>` : ""}</div>` : "";
      const foes = !fight ? "" : n.template ? tplRow : tplRow + `<div class="tk-foes">${n.enemies.map((e, j) => `<div class="tr-row">
            <select data-te="nodes.${i}.enemies.${j}.id" data-te-rerender="1">${options(presets, e.id)}</select>
            等级 ${inp(`nodes.${i}.enemies.${j}.lv`, e.lv, 52, "number")} 区域 <select data-te="nodes.${i}.enemies.${j}.zone">${options([1, 2, 3, 4, 5].map(z => [z, z + " 区"]), e.zone)}</select>
            ${typeof SAND_FISH_KITS !== "undefined" && SAND_FISH_KITS.includes(e.id) ? `富集 <select data-te="nodes.${i}.enemies.${j}.enriched">${options([["", "随机"], ["on", "富集"], ["off", "普通"]], e.enriched === true || e.enriched === "on" ? "on" : e.enriched === false || e.enriched === "off" ? "off" : "")}</select>` : ""}
            <button class="g-btn small" data-te-act="delEnemy:${i}:${j}">删</button></div>`).join("")}
          <div class="tr-row"><button class="g-btn small" data-te-act="addEnemy:${i}">＋ 敌人</button>
            天气 <select data-te="nodes.${i}.weather">${options(Object.keys(WX).map(k => [k, WX[k]]), n.weather)}</select>
            战场 <select data-te="nodes.${i}.zoneMode">${options([[2, "两区"], [3, "三区"], ["line4", "四区直排"], ["square4", "四区方形 2×2"], ["cross5", "五区十字"]], n.zoneMode)}</select></div></div>`;
      const got = t.granted && t.granted.nodes.includes(i);
      if (!n.reward) n.reward = { xp: 0, kuizhi: 0 };
      const rwRow = `<div class="tr-row">玩家看到的步骤 ${inp(`nodes.${i}.title`, n.title || "", 240)}
          ${got ? `<span class="r-hint">奖励已发 ✓（+${n.reward.xp} 经验 · +${n.reward.kuizhi} 奎支，改了也不会再发）</span>`
            : `完成奖励：经验/人 ${inp(`nodes.${i}.reward.xp`, n.reward.xp, 60, "number")} 奎支 ${inp(`nodes.${i}.reward.kuizhi`, n.reward.kuizhi, 80, "number")}`}
          <label class="tr-pick"><input type="checkbox" data-te-hide="${i}" ${n.hidden ? "checked" : ""}>对玩家隐藏（显示「？？？」）</label></div>`;
      return `<div class="tk-enode${got ? " tk-got" : ""}"><div class="tr-row"><b>第 ${i + 1} 站</b>
          <select data-te="nodes.${i}.type" data-te-rerender="1">${options(Object.keys(NODE_T()).map(k => [k, NODE_T()[k]]), n.type)}</select>
          说明（主持人） ${inp(`nodes.${i}.note`, n.note, 220)}
          <button class="g-btn small" data-te-act="up:${i}">↑</button><button class="g-btn small" data-te-act="down:${i}">↓</button>
          <button class="g-btn small" data-te-act="delNode:${i}">删这一站</button></div>${rwRow}${foes}</div>`;
    }).join("");
    const r = t.reward;
    // 选单第一项是空的：没选东西就不会加进奖励（以前默认选着第一件，看起来像默认会给）
    const itemOpts = [["", "（选物品）"]].concat(Object.keys(ITEM_CATALOG).filter(id => !ITEM_CATALOG[id].part && !ITEM_CATALOG[id].blueprint).map(id => [id, ITEM_CATALOG[id].name]));
    const partOpts = [["", "（选改装件）"]].concat(Object.keys(WEAPON_PARTS).map(id => [id, `${weaponPartLabel(id)} ${weaponPartText(id)}`]));
    const bpOpts = [["", "（选图纸）"]].concat((typeof ROGUE_SMITHS !== "undefined" ? ROGUE_SMITHS : []).flatMap(s => s.blueprints.map(b => [b.id, `${b.name}（${s.name}）`])));
    const list = (arr, kind, label) => arr.map((x, k) => `<span class="tk-chip">${esc(label(x))}<button class="g-btn small" data-te-act="del${kind}:${k}">×</button></span>`).join("");
    const e = t.escort;
    const hbPay = trpgTaskHandbookPay(t.days, trpgPartyLevel());   // 主持人手册第三章的任务报酬，给主持人参考
    const escort = e ? `<h4>护送对象</h4><div class="tr-row">
        <select data-te="escort.kind" data-te-rerender="1">${options([["cart", "货车（不行动，不会失衡）"], ["vip", "人物（会躲开敌人、能还击）"]], e.kind)}</select>
        名字 ${inp("escort.name", e.name, 100)} 等级 ${inp("escort.level", e.level, 52, "number")}
        血量 ${inp("escort.hp", e.hp, 60, "number")} 架势 ${inp("escort.def", e.def, 52, "number")} atk ${inp("escort.atk", e.atk, 52, "number")}</div>
        <p class="r-hint">空着的按等级自动算（现在：${(() => { const sp = escortSpec(e, e.level); return `血量 ${sp.hpMax}、架势 ${sp.def}、atk ${sp.atk}`; })()}）。被摧毁任务失败；剩余 ≥ ${Math.round(ESCORT_RULES.intactRatio * 100)}% 算完好，发「完好额外奖励」。</p>` : "";
    return `<div class="tr-up tk-edit">
      <h4>编辑任务</h4>
      <div class="tr-row">名称 ${inp("name", t.name, 160)} 类型 <select data-te="kind" data-te-rerender="1">${options(Object.keys(TRPG_TASK_KINDS).map(k => [k, TRPG_TASK_KINDS[k]]), t.kind)}</select>
        天数 ${inp("days", t.days, 52, "number")} <span class="r-hint">（0 = 不写天数）</span></div>
      <div class="tr-row">分类 <select data-te="category" data-te-rerender="1">${options([["main", "主线"], ["side", "支线"], ["personal", "个人"]], t.category || "side")}</select>
        ${t.category === "personal" ? `属于角色 <select data-te="owner">${options([["", "（选一名角色）"]].concat(trpgHeroes().filter(h => !h.weaponOf).map(h => [h.kit, trpgHeroLabel(h.kit)])), t.owner || "")}</select>
        <span class="r-hint">只有操控这名角色的玩家看得到（其他玩家连有这条任务都不知道）；经验只给这名角色，奎支和物品照样进队伍。</span></div>` : `
        可见 <select data-te="visibility.mode" data-te-rerender="1">${options([["party", "全队"], ["players", "指定玩家"]], (t.visibility || {}).mode || "party")}</select>
        ${(t.visibility || {}).mode === "players" ? (questRoster().length ? questRoster().map(p => `<label class="tr-pick"><input type="checkbox" data-te-vis="${esc(p.id)}" ${(t.visibility.ids || []).includes(p.id) ? "checked" : ""}>${esc(p.name)}</label>`).join("") : '<span class="r-hint">现在没有联机玩家；开房后再勾选。</span>') : ""}</div>`}
      <div class="tr-row">目标（玩家可见） <textarea data-te="goal" rows="2" style="width:100%">${esc(t.goal)}</textarea></div>
      <div class="tr-row">主持人备注（只有主持人看得到） ${inp("gmNote", t.gmNote, 420)}</div>
      <h4>奖励（不填就没有奖励）</h4>
      <div class="tr-row">奎支 ${inp("reward.kuizhi", r.kuizhi, 90, "number")} 每人经验 ${inp("reward.xp", r.xp, 70, "number")}
        ${e ? `完好额外奎支 ${inp("reward.intactKuizhi", r.intactKuizhi, 90, "number")}` : ""}</div>
      <p class="r-hint">手册参考（${hbPay.name}任务 ${Math.max(1, Number(t.days) || 1)} 天、队伍平均 ${trpgPartyLevel()} 级）：奎支 ${hbPay.range[0]}～${hbPay.range[1]}，每人经验 ${hbPay.xp}；按完成质量和关系上下浮动。
        <button class="g-btn small" data-te-act="handbookPay">按手册填奎支和经验</button></p>
      <div class="tr-row">物品 <select id="te-item">${options(itemOpts)}</select> ×${inp("_qty", 1, 52, "number").replace('data-te="_qty"', 'id="te-qty"')}
        <button class="g-btn small" data-te-act="addItem">＋</button> ${list(r.items, "Item", x => `${(ITEM_CATALOG[x.id] || {}).name}×${x.qty}`)}</div>
      <div class="tr-row">改装件 <select id="te-part">${options(partOpts)}</select><button class="g-btn small" data-te-act="addPart">＋</button>
        <button class="g-btn small" data-te-act="randPart:C">随机 C</button><button class="g-btn small" data-te-act="randPart:B">随机 B</button> ${list(r.parts, "Part", id => weaponPartLabel(id))}</div>
      <div class="tr-row">图纸 <select id="te-bp">${options(bpOpts)}</select><button class="g-btn small" data-te-act="addBp">＋</button> ${list(r.blueprints, "Bp", id => (blueprintSpec(id) || {}).name || id)}</div>
      ${escort}
      <h4>路线（可以不填）</h4>
      <p class="r-hint">不填路线就是剧情任务：玩家只看到标题、描述和奖励，由你在合适的时候「结算任务」或「判定失败」。要按站推进时再加站（战斗站可以预先配置敌人、天气、战场）。
        ${t.kind !== "custom" ? `<button class="g-btn small" data-te-act="templateRoute">按「${esc(TRPG_TASK_KINDS[t.kind])}」模板填路线</button>` : ""}</p>
      ${nodes}
      <div class="tr-row"><button class="g-btn small" data-te-act="addNode:battle">＋ 战斗站</button><button class="g-btn small" data-te-act="addNode:rest">＋ 休息点</button><button class="g-btn small" data-te-act="addNode:event">＋ 事件</button></div>
      <div class="tr-row"><button class="g-btn" data-te-act="save">保存</button><button class="g-btn" data-te-act="cancel">取消</button></div>
    </div>`;
  }
  let newTaskCat = "side";
  PANELS.tasks = function () {
    const list = trpgTasks();
    const order = { active: 0, posted: 1, draft: 2, done: 3, failed: 4 };
    const group = (cat, title) => {
      const rows = list.filter(t => (t.category || "side") === cat).sort((a, b) => order[a.status] - order[b.status]);
      return `<h3 class="tk-sec">${title}</h3>${rows.map(t => taskEdit && taskEdit.id === t.id ? taskEditorHtml(taskEdit) : taskCardHtml(t)).join("") || '<p class="r-hint">暂无。</p>'}`;
    };
    return `<p class="r-hint">任务日志：主持人在这里发布主线、支线和个人任务。新任务只有标题和描述，没有路线、没有奖励——要的话在「编辑」里加（奖励不填就没有；路线不填就是剧情任务，由你「结算」或「判定失败」）。再「发布」；队伍「接下」后有路线的按站推进，可以同时进行好几条。
        联机玩家点「任务日志」就能看到：草稿、只指定给别人的任务、主持人备注、敌人配置、隐藏的站都看不到。每一站的奖励只发一次（回退再推进不重发，也不收回）。</p>
      <div class="tr-row">新建 <select id="tk-cat">${options([["main", "主线"], ["side", "支线"], ["personal", "个人"]], newTaskCat)}</select> 任务：${Object.keys(TRPG_TASK_KINDS).map(k => `<button class="g-btn small" data-tk="new:${k}">${esc(TRPG_TASK_KINDS[k])}</button>`).join("")}</div>
      ${group("main", "主线任务")}${group("side", "支线任务")}${group("personal", "个人任务（只给那名角色的玩家看）")}`;
  };
  function teSet(path, v) {
    const keys = path.split(".");
    let o = taskEdit;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    const k = keys[keys.length - 1];
    o[k] = typeof o[k] === "number" && /^-?\d*\.?\d*$/.test(v) ? (v === "" ? 0 : Number(v)) : v;   // 布局名（square4 …）保持字符串
    if (path === "kind") {
      if (v === "escort" && !taskEdit.escort) taskEdit.escort = { kind: "cart", name: "", level: trpgPartyLevel(), hp: null, def: null, atk: null };
      if (v !== "escort") taskEdit.escort = null;
    }
    if (/^nodes\.\d+\.type$/.test(path)) {
      const n = taskEdit.nodes[Number(keys[1])];
      if ((v === "battle" || v === "elite") && !n.enemies.length) n.enemies = [{ id: "thug_knife", lv: trpgPartyLevel(), zone: 2 }];
    }
  }
  function teAct(a, P) {
    const [cmd, x, y] = a.split(":");
    const t = taskEdit, i = Number(x), j = Number(y);
    const lv = trpgPartyLevel();
    switch (cmd) {
      case "save": taskEdit = null; act(ruleCommand("taskSave", { task: JSON.parse(JSON.stringify(t)) })); return;
      case "cancel": taskEdit = null; break;
      case "addNode": t.nodes.push(Object.assign(x === "battle" ? { type: "battle", note: "", enemies: [{ id: "thug_knife", lv, zone: 2 }], weather: "none", zoneMode: 2 } : { type: x, note: "", enemies: [], weather: "none", zoneMode: 2 },
        { title: "", hidden: false, reward: { xp: 0, kuizhi: 0 } })); break;
      case "delNode": t.nodes.splice(i, 1); break;
      case "up": if (i > 0) t.nodes.splice(i - 1, 0, t.nodes.splice(i, 1)[0]); break;
      case "down": if (i < t.nodes.length - 1) t.nodes.splice(i + 1, 0, t.nodes.splice(i, 1)[0]); break;
      case "addEnemy": t.nodes[i].enemies.push({ id: "thug_knife", lv, zone: 2 }); break;
      case "delEnemy": t.nodes[i].enemies.splice(j, 1); break;
      case "addItem": if ($("te-item").value) t.reward.items.push({ id: $("te-item").value, qty: Math.max(1, Number($("te-qty").value) || 1) }); break;
      case "handbookPay": { const p = trpgTaskHandbookPay(t.days, trpgPartyLevel()); t.reward.kuizhi = p.kuizhi; t.reward.xp = p.xp; if (t.escort) t.reward.intactKuizhi = Math.round(p.kuizhi * ESCORT_RULES.intactBonus); break; }
      case "templateRoute": { const r = trpgTaskTemplateRoute(t.kind); t.nodes = t.nodes.concat(r.nodes.map(trpgTaskNormalizeNode)); if (!t.days) t.days = r.days; break; }
      case "delItem": t.reward.items.splice(i, 1); break;
      case "addPart": if ($("te-part").value) t.reward.parts.push($("te-part").value); break;
      case "randPart": t.reward.parts.push(rollWeaponPart({ [x]: 1 })); break;
      case "delPart": t.reward.parts.splice(i, 1); break;
      case "addBp": if ($("te-bp").value) t.reward.blueprints.push($("te-bp").value); break;
      case "delBp": t.reward.blueprints.splice(i, 1); break;
    }
    render();
  }
  function bindTasks(P) {
    P.querySelectorAll("[data-tk]").forEach(b => {
      b.onclick = () => {
        const [cmd, id] = b.dataset.tk.split(":");
        if (cmd === "new") return act(ruleCommand("taskCreate", { kind: id, category: newTaskCat }));
        if (cmd === "back") { if (confirm("回退一步？已经发过的奖励不会收回。")) act(ruleCommand("taskRollback", { id })); return; }
        if (cmd === "reveal") return act(ruleCommand("taskReveal", { id, node: Number(b.dataset.tk.split(":")[2]), hidden: false }));
        if (cmd === "up" || cmd === "down") return act(ruleCommand("taskMove", { id, dir: cmd === "up" ? -1 : 1 }));
        if (cmd === "edit") { taskEdit = JSON.parse(JSON.stringify(trpgTaskById(id))); return render(); }
        if (cmd === "del") { if (confirm("删除这个任务？")) act(ruleCommand("taskDelete", { id })); return; }
        if (cmd === "post") return act(ruleCommand("taskStatus", { id, status: "posted" }));
        if (cmd === "unpost") return act(ruleCommand("taskStatus", { id, status: "draft" }));
        if (cmd === "accept") return act(ruleCommand("taskAccept", { id }));
        if (cmd === "node") return act(ruleCommand("taskNodeDone", { id }));
        if (cmd === "complete") return act(ruleCommand("taskComplete", { id }));
        if (cmd === "fail") { const why = prompt("失败原因（可不填）", "") ; if (why !== null) act(ruleCommand("taskFail", { id, why })); return; }
        if (cmd === "fight") {
          let cfg;
          try { cfg = trpgTaskPrepareBattle(id); } catch (e) { alert(e.message); return; }
          if (!lowHpOk()) { TRPG.taskBattle = null; return; }
          if (cfg.template) { GAME.lastEncounter = battleTemplateToEncounter(cfg.template); return uiCommand("toBattle", onlineBattleLevel()); }
          GAME.lastEncounter = null;
          GAME.enemyPlan = cfg.enemies;
          GAME.weather = cfg.weather;
          if (typeof cfg.zoneMode === "string") { GAME.board = cfg.zoneMode; GAME.zoneMode = BOARD_LAYOUTS[cfg.zoneMode].zones.length; }
          else { GAME.board = null; GAME.zoneMode = cfg.zoneMode; }
          return uiCommand("toBattle", onlineBattleLevel());
        }
      };
    });
    const cat = $("tk-cat");
    if (cat) cat.onchange = () => { newTaskCat = cat.value; };
    if (!taskEdit) return;
    P.querySelectorAll("[data-te-hide]").forEach(el => { el.onchange = () => { taskEdit.nodes[Number(el.dataset.teHide)].hidden = el.checked; }; });
    P.querySelectorAll("[data-te-vis]").forEach(el => {
      el.onchange = () => {
        const v = taskEdit.visibility = taskEdit.visibility || { mode: "players", ids: [] };
        v.ids = (v.ids || []).filter(x => x !== el.dataset.teVis);
        if (el.checked) v.ids.push(el.dataset.teVis);
      };
    });
    P.querySelectorAll("[data-te]").forEach(el => {
      const ev = el.tagName === "SELECT" ? "onchange" : "oninput";
      el[ev] = () => { teSet(el.dataset.te, el.value); if (el.dataset.teRerender) render(); };
    });
    P.querySelectorAll("[data-te-act]").forEach(b => { b.onclick = () => teAct(b.dataset.teAct, P); });
    P.querySelectorAll("[data-te-tpl]").forEach(el => {
      el.onchange = () => {
        const n = taskEdit.nodes[Number(el.dataset.teTpl)];
        if (!el.value) n.template = null;
        else if (!n.template || n.template.id !== el.value) n.template = battleTemplateById(el.value);
        render();
      };
    });
  }

  /* ---------- 检定（手册第一章）：主持人发起，联机时玩家自己掷，单机时主持人代掷 ---------- */
  let localChecks = [];   // 不联机时的检定记录（只在这次打开的页面里）
  const checkForm = { prof: "侦察", diff: "normal", note: "", units: null };
  const online = () => !!(window.HotseatGame && HotseatGame.isActive());
  const checkList = () => online() ? (HotseatGame.getView().checks || []) : localChecks;
  function checkPreview(unitIds) {
    try { return HotseatGame.checkSpec({ prof: checkForm.prof, diff: checkForm.diff, unitIds, note: checkForm.note }); } catch (e) { return null; }
  }
  const pct = x => Math.round((Number(x) || 0) * 1000) / 10 + "%";
  const rollText = r => r.rolls.map(x => x.roll == null ? x.label : (x.label ? x.label + " " : "") + x.roll).join("，");
  PANELS.checks = function () {
    const hs = heroes();
    if (!checkForm.units) checkForm.units = hs.map(h => h.id);
    const spec = checkPreview(hs.map(h => h.id));
    const profOpts = Object.keys(PROFICIENCIES).map(g => `<optgroup label="${esc(g)}">${PROFICIENCIES[g].map(p => `<option${p === checkForm.prof ? " selected" : ""}>${esc(p)}</option>`).join("")}</optgroup>`).join("");
    const diffOpts = Object.keys(ROGUE_CHECKS.diffs).map(k => `<option value="${k}"${k === checkForm.diff ? " selected" : ""}>${esc(ROGUE_CHECKS.diffs[k].name)}</option>`).join("");
    const who = hs.map(h => {
      const t = spec && spec.targets.find(x => x.unitId === h.id);
      const odds = t ? `${["没有熟练", "一级熟练", "二级熟练", "三级熟练"][t.level] || ""} · 成功率 ${pct(t.base)}${t.adv ? " · 优势" : t.dis ? " · 劣势" : ""}${t.reroll ? " · 失败可重掷" : ""}` : "";
      return `<label class="tr-pick"><input type="checkbox" data-ck-unit="${esc(h.id)}"${checkForm.units.includes(h.id) ? " checked" : ""}>${esc(h.name)}<small>${esc(odds)}</small></label>`;
    }).join("");
    const cards = checkList().slice().reverse().map(c => `<div class="tr-up tk-card${c.status === "open" ? " on" : ""}">
        <div class="tk-head"><b>${esc(c.diffName)}「${esc(c.prof)}」检定</b><span class="tk-st">${c.status === "open" ? "进行中" : "已结束"}</span></div>
        ${c.note ? `<p class="tk-goal">${esc(c.note)}</p>` : ""}
        ${c.targets.map(t => `<div class="tr-row"><b>${esc(t.name)}</b> <span class="r-hint">成功率 ${pct(t.base)}${t.adv ? " · 优势" : t.dis ? " · 劣势" : ""}</span>
          ${t.result ? `<b class="${t.result.ok ? "good" : "bad"}">${t.result.ok ? "成功" : "失败"}</b> <span class="r-hint">d100 ${esc(rollText(t.result))}</span>`
            : c.status === "open" ? `<span class="r-hint">${online() ? "等玩家掷骰" : ""}</span><button class="g-btn small" data-ck="roll:${esc(c.id)}:${esc(t.unitId)}">${online() ? "代掷" : "掷骰"}</button>` : '<span class="r-hint">没有掷</span>'}</div>`).join("")}
        ${c.status === "open" ? `<div class="tr-row"><button class="g-btn small" data-ck="close:${esc(c.id)}">结束这个检定</button></div>` : ""}</div>`).join("");
    return `<p class="r-hint">按手册第一章：成功率看熟练等级和难度（没有熟练只能做简单检定），种族特长自动算优势 / 劣势 / 重掷。
        ${online() ? "联机时发起后，玩家在自己画面上点「掷骰」，结果写进小队频道；主持人也可以代掷。" : "现在没有联机，检定由主持人在这里掷。"}</p>
      <div class="tr-up">
        <div class="tr-row">熟练项 <select id="ck-prof">${profOpts}</select> 难度 <select id="ck-diff">${diffOpts}</select>
          说明 <input id="ck-note" value="${esc(checkForm.note)}" placeholder="比如：撬开仓库的锁" style="width:240px"></div>
        <div class="tr-picks">${who}</div>
        <div class="tr-row"><button class="g-btn" id="ck-open">发起检定</button></div>
      </div>
      ${cards || '<p class="r-hint">还没有检定。</p>'}`;
  };
  /* ---------- 工坊：制作、学配方、积分、拆解（trpg.js · trpgCraft 等）---------- */
  const craftForm = { kit: "", item: "", diff: "", helper: "" };
  /* ---------- 诊所：义体改造（trpg.js · trpgModifyHero；联机玩家的申请在上面，主持人同意才改）---------- */
  const cyberForm = {};   // kit → 正在填的方案（重画时保留）
  const CY_LAYERS = [["armor", "装甲"], ["shield", "护盾"], ["sand", "沙尘"]];
  PANELS.clinic = function () {
    const reqs = (TRPG.cyberRequests || []).filter(r => r.status === "pending");
    const reqHtml = reqs.length ? `<h3>玩家的改造申请</h3>${reqs.map(r => {
      const pv = trpgCyberPreview(r.kit, r.plan), h = heroes().find(x => x.kit === r.kit);
      return `<div class="tr-row"><b>${esc(h ? h.name : r.kit)}</b>（${esc(r.byName)} 申请）：${esc(pv.error || pv.layers.map(l => `${LAYER[l.type] || l.type} ${l.max}`).join(" / "))}
        · ${pv.cost} 奎支（从 ${esc(h ? h.name : r.kit)} 的钱包出，现有 ${trpgPurse(r.kit)}）
        <button class="g-btn small r-main" data-cyd="${esc(r.id)}:1" ${pv.error ? "disabled" : ""}>同意</button><button class="g-btn small" data-cyd="${esc(r.id)}:0">拒绝</button></div>`;
    }).join("")}` : "";
    const rows = heroes().filter(h => !h.dead).map(h => {
      const info = trpgCyberInfo(h.kit);
      const plan = cyberForm[h.kit] || info.current;
      const pv = trpgCyberPreview(h.kit, plan);
      const cur = (h.layers || []).map(l => `${LAYER[l.type] || l.type} ${l.current}/${l.max}`).join(" / ");
      return `<div class="tr-up"><div class="tk-head"><b>${esc(h.name)}</b><span class="tk-kind">改造率 ${Math.round(info.rate * 100)}% · 肉体 ${info.fleshMax}，最多改 ${info.limit} 点</span></div>
        <div class="r-hint">现在：${esc(cur)}</div>
        <div class="tr-row" data-cy-box="${esc(h.kit)}">${CY_LAYERS.map(([k, n]) => `${n} <input type="number" min="0" max="${info.limit}" data-cy="${k}" value="${esc(plan[k] || 0)}" style="width:56px">`).join(" ")}
          <label class="tr-pick"><input type="checkbox" data-cy="spirit" ${plan.spirit ? "checked" : ""}>换成星灵</label></div>
        <div class="tr-row">${pv.error ? `<span class="warn">${esc(pv.error)}</span>` : `改完：${esc(pv.layers.map(l => `${LAYER[l.type] || l.type} ${l.max}`).join(" / "))} · ${pv.cost ? `要 ${pv.cost} 奎支` : "方案没有变化"}`}
          <button class="g-btn small r-main" data-cy-go="${esc(h.kit)}" ${pv.error || !pv.cost ? "disabled" : ""}>改造（由下面选的人付）</button>
          <button class="g-btn small" data-cy-free="${esc(h.kit)}" ${pv.error || !pv.cost ? "disabled" : ""}>主持人免费改</button></div></div>`;
    }).join("");
    return `<p class="r-hint">义体改造规则和单局一样：可改的肉体点数 = 肉体上限 × 改造率；一个角色最多 3 种血量，最内层要留肉体或星灵；每动 1 点肉体 ${ROGUE_CLINIC.cyberPerHp} 奎支（加减都算，换成 / 换回星灵按被换的肉体点数算）。伤势照旧带着，缺的血先从外层扣。</p>
      <div class="tr-row"><label class="tr-pick"><input type="checkbox" id="tr-clinic-open" ${TRPG.clinicOpen ? "checked" : ""}>诊所向联机玩家开放（玩家可以给自己的角色申请改造，你同意后才生效）</label></div>
      ${cyberwareEntry()}${reqHtml}${payerHtml()}${rows}`;
  };
  /* 诊所 · 义体（cyberware-ui.js；数据 trpg.js · trpgCyberwarePacket）：主持人看全部角色；联机时走 OnlineGame.submit，钱从那名角色的钱包出 */
  function cyberwareEntry() {
    if (!window.CyberwareUI || typeof trpgCyberwarePacket !== "function") return "";
    return `<div class="tr-row"><button class="g-btn r-main cw-open" id="tr-cyberware">诊所 · 义体</button><span class="r-hint">装 / 拆义体（从那名角色的钱包出${TRPG.clinicOpen ? "" : "；诊所关着时不能装拆"}）</span></div>`;
  }
  function cyberwareModel() {
    return CyberwareUI.localModel({ heroes: heroes().filter(h => !h.dead).map(h => ({ kit: h.kit, name: h.name })),
      packetOf: kit => trpgCyberwarePacket(kit), previewOf: (kit, id) => { const p = trpgCyberwarePacket(kit); return p && p.previews[id] || null; } });
  }
  function openCyberware() {
    CyberwareUI.open(cyberwareModel, async cmd => {
      const type = cmd.action === "removeCyberware" ? "cyberwareRemove" : "cyberwareInstall";
      try {
        if (typeof OnlineGame !== "undefined" && OnlineGame.isHost && OnlineGame.isHost()) { const r = await OnlineGame.submit({ type, kit: cmd.kit, id: cmd.id }); if (r && r.ok === false) throw new Error(r.error); }
        else (type === "cyberwareRemove" ? trpgCyberwareRemove : trpgCyberwareInstall)(cmd.kit, cmd.id);
      } catch (e) { alert(e.message); }
      render(); CyberwareUI.refresh();
    });
  }
  function bindClinic(P) {
    const box = (kit) => P.querySelector(`[data-cy-box="${kit}"]`);
    const planOf = (kit) => { const b = box(kit); const p = { spirit: !!(b.querySelector('[data-cy="spirit"]') || {}).checked }; CY_LAYERS.forEach(([k]) => { p[k] = Math.max(0, Math.floor(Number((b.querySelector(`[data-cy="${k}"]`) || {}).value) || 0)); }); return p; };
    P.querySelectorAll("[data-cy-box]").forEach(b => { b.onchange = () => { cyberForm[b.dataset.cyBox] = planOf(b.dataset.cyBox); render(); }; });
    P.querySelectorAll("[data-cy-go]").forEach(b => { b.onclick = () => { const k = b.dataset.cyGo; act(ruleCommand("modifyHero", { kit: k, plan: planOf(k) })); delete cyberForm[k]; }; });
    P.querySelectorAll("[data-cy-free]").forEach(b => { b.onclick = () => { const k = b.dataset.cyFree; act(ruleCommand("modifyHero", { kit: k, plan: planOf(k), free: true })); delete cyberForm[k]; }; });
    P.querySelectorAll("[data-cyd]").forEach(b => { b.onclick = () => { const [id, ok] = b.dataset.cyd.split(":"); act(ruleCommand("cyberDecide", { id, ok: ok === "1" })); }; });
    const cwb = $("tr-cyberware"); if (cwb) cwb.onclick = () => openCyberware();
    const open = $("tr-clinic-open");
    if (open) open.onchange = () => act(ruleCommand("clinicOpen", { on: open.checked }));
  }
  /* ---------- 商人（trpg-merchants.js）：主持人设置商人、卖什么、打折、积分兑换；开店后联机玩家同步看到 ---------- */
  let merchantEdit = null;
  PANELS.merchants = function () {
    const list = trpgMerchants(), open = trpgMerchantOpenNow();
    const card = (m) => {
      const isOpen = open && open.id === m.id;
      return `<div class="tr-up tk-card${isOpen ? " on" : ""}"><div class="tk-head"><b>${esc(m.name)}</b>
          ${m.discount ? `<span class="tk-cat main">${esc(trpgDiscountText(m.discount))}</span>` : ""}<span class="tk-kind">${m.rows.length} 件商品</span>
          <span class="tk-vis">${m.points.on ? `积分兑换 ${m.points.items.length} 种` : "不能积分兑换"}</span>${isOpen ? '<span class="tk-st">营业中（玩家看得到）</span>' : ""}</div>
        ${m.note ? `<p class="tk-goal">${esc(m.note)}</p>` : ""}
        <div class="tr-row">${isOpen ? `<button class="g-btn small" data-mc="close:">关店</button>` : `<button class="g-btn small r-main" data-mc="open:${esc(m.id)}">开店（玩家画面同步弹出）</button>`}
          <button class="g-btn small" data-mc="edit:${esc(m.id)}">编辑</button><button class="g-btn small" data-mc="del:${esc(m.id)}">删除</button></div></div>`;
    };
    const front = open ? (() => {
      const v = trpgMerchantView();
      return `<h3>「${esc(v.name)}」柜台</h3>${payerHtml()}
        <div class="shop">${v.rows.map(r => `<div class="shop-row"><span class="s-name">${esc(r.name)}${r.hint ? `<small>${esc(r.hint)}</small>` : ""}</span>
          <span class="s-have">${r.stock == null ? "不限" : `剩 ${r.stock}`}</span><span class="s-price">${r.price}${r.price !== r.base ? ` <s>${r.base}</s>` : ""}</span>
          <input type="number" min="1" value="1" data-mq="${esc(r.key)}" style="width:52px">
          <button class="g-btn small" data-mbuy="${esc(r.key)}" ${r.stock === 0 ? "disabled" : ""}>买</button></div>`).join("") || '<p class="r-hint">这个商人还没有商品。</p>'}</div>
        ${v.points ? `<p class="r-hint">商店积分 ${v.points.have}：${v.points.rows.map(x => `<button class="g-btn small" data-mredeem="${esc(x.item)}" ${v.points.have < x.points ? "disabled" : ""}>${esc(x.name)} · ${x.points} 积分</button>`).join(" ") || "（没有选可兑换的道具）"}</p>` : ""}`;
    })() : "";
    return `<p class="r-hint">设置商人和他们卖的东西：可以单独改价、限库存、整店打折（和巧手匠人的八折不叠加，取便宜的），也可以决定在这里能不能用商店积分兑换、能换哪些。
        「开店」后联机玩家的画面会同步弹出这家店，玩家用自己角色的钱包买；同一时间只开一家，「关店」后玩家画面收起。</p>
      <div class="tr-row">新商人 <input type="text" id="mc-name" placeholder="名字" style="width:140px"><button class="g-btn small" data-mc="new:">新建</button></div>
      ${front}
      <h3>商人</h3>${list.map(m => merchantEdit && merchantEdit.id === m.id ? merchantEditorHtml(merchantEdit) : card(m)).join("") || '<p class="r-hint">还没有商人。</p>'}`;
  };
  function merchantEditorHtml(m) {
    const groups = [];
    HANDBOOK_SHOP.forEach(r => { if (!groups.includes(r.group)) groups.push(r.group); });
    const rowOf = (key) => m.rows.find(r => r.key === key);
    const redeemable = EFFECT_ITEMS.filter(x => x.points > 0);
    return `<div class="tr-up tk-card tk-edit"><h4>编辑商人</h4>
      <div class="tr-row">名字 <input type="text" data-me="name" value="${esc(m.name)}" style="width:140px">
        打折 <input type="number" data-me="discount" min="0" max="90" value="${esc(m.discount)}" style="width:56px">%（填 20 = 八折）</div>
      <div class="tr-row">介绍（玩家看得到） <input type="text" data-me="note" value="${esc(m.note)}" style="width:100%"></div>
      <h4>卖什么</h4><p class="r-hint">勾上就卖。价格空着照手册价，库存空着不限量。</p>
      ${groups.map(g => `<details${HANDBOOK_SHOP.some(r => r.group === g && rowOf(r.key)) ? " open" : ""}><summary>${esc(g)}（${HANDBOOK_SHOP.filter(r => r.group === g && rowOf(r.key)).length}）</summary>
        ${HANDBOOK_SHOP.filter(r => r.group === g).map(r => { const on = rowOf(r.key); return `<div class="tr-row"><label class="tr-pick"><input type="checkbox" data-me-row="${esc(r.key)}" ${on ? "checked" : ""}>${esc(trpgShopName(r))}</label>
          <span class="r-hint">手册价 ${r.price}</span>${on ? ` 价格 <input type="number" min="0" data-me-price="${esc(r.key)}" value="${on.price == null ? "" : esc(on.price)}" placeholder="${r.price}" style="width:80px">
          库存 <input type="number" min="0" data-me-stock="${esc(r.key)}" value="${on.stock == null ? "" : esc(on.stock)}" placeholder="不限" style="width:60px">` : ""}</div>`; }).join("")}</details>`).join("")}
      <h4>积分兑换</h4>
      <div class="tr-row"><label class="tr-pick"><input type="checkbox" data-me-pon ${m.points.on ? "checked" : ""}>在这家店可以用商店积分兑换</label></div>
      ${m.points.on ? `<div class="tr-row">${redeemable.map(x => `<label class="tr-pick"><input type="checkbox" data-me-pt="${esc(x.id)}" ${m.points.items.includes(x.id) ? "checked" : ""}>${esc(x.name)}（${x.points}）</label>`).join("")}</div>` : ""}
      <div class="tr-row"><button class="g-btn r-main" data-me-act="save">保存</button><button class="g-btn" data-me-act="cancel">取消</button></div></div>`;
  }
  function bindMerchants(P) {
    P.querySelectorAll("[data-mc]").forEach(b => {
      b.onclick = () => {
        const [cmd, id] = b.dataset.mc.split(":");
        if (cmd === "new") return act(ruleCommand("merchantCreate", { name: ($("mc-name") || {}).value || "" }));
        if (cmd === "open") return act(ruleCommand("merchantOpen", { id }));
        if (cmd === "close") return act(ruleCommand("merchantOpen", { id: null }));
        if (cmd === "edit") { merchantEdit = JSON.parse(JSON.stringify(trpgMerchantById(id))); return render(); }
        if (cmd === "del" && confirm("删掉这个商人？")) return act(ruleCommand("merchantDelete", { id }));
      };
    });
    const open = trpgMerchantOpenNow();
    P.querySelectorAll("[data-mbuy]").forEach(b => { b.onclick = () => { if (window.Sfx) Sfx.ui("coin"); act(ruleCommand("merchantBuy", { id: open.id, key: b.dataset.mbuy, qty: Number((P.querySelector(`[data-mq="${b.dataset.mbuy}"]`) || {}).value) || 1 })); }; });
    P.querySelectorAll("[data-mredeem]").forEach(b => { b.onclick = () => act(ruleCommand("merchantRedeem", { id: open.id, item: b.dataset.mredeem })); });
    if (!merchantEdit) return;
    const m = merchantEdit;
    P.querySelectorAll("[data-me]").forEach(el => { el.oninput = () => { m[el.dataset.me] = el.type === "number" ? Number(el.value) || 0 : el.value; }; });
    P.querySelectorAll("[data-me-row]").forEach(el => { el.onchange = () => {
      const key = el.dataset.meRow;
      if (el.checked) { if (!m.rows.some(r => r.key === key)) m.rows.push({ key, price: null, stock: null }); }
      else m.rows = m.rows.filter(r => r.key !== key);
      render();
    }; });
    const num = (v) => (v === "" ? null : Math.max(0, Math.floor(Number(v) || 0)));
    P.querySelectorAll("[data-me-price]").forEach(el => { el.oninput = () => { const r = m.rows.find(x => x.key === el.dataset.mePrice); if (r) r.price = num(el.value); }; });
    P.querySelectorAll("[data-me-stock]").forEach(el => { el.oninput = () => { const r = m.rows.find(x => x.key === el.dataset.meStock); if (r) r.stock = num(el.value); }; });
    P.querySelectorAll("[data-me-pon]").forEach(el => { el.onchange = () => { m.points.on = el.checked; render(); }; });
    P.querySelectorAll("[data-me-pt]").forEach(el => { el.onchange = () => {
      const id = el.dataset.mePt;
      m.points.items = el.checked ? m.points.items.concat(id).filter((x, i, a) => a.indexOf(x) === i) : m.points.items.filter(x => x !== id);
    }; });
    P.querySelectorAll("[data-me-act]").forEach(b => { b.onclick = () => {
      if (b.dataset.meAct === "save") { const data = merchantEdit; merchantEdit = null; return act(ruleCommand("merchantSave", { merchant: data })); }
      merchantEdit = null; render();
    }; });
  }
  PANELS.workshop = function () {
    const hs = heroes().filter(h => !h.dead);
    if (!hs.some(h => h.kit === craftForm.kit)) craftForm.kit = (hs[0] || {}).kit || "";
    const items = EFFECT_ITEMS.filter(it => CRAFT_RECIPES[it.id]);
    if (!items.some(it => it.id === craftForm.item)) craftForm.item = items[0].id;
    const pts = trpgPointsInfo();
    const o = craftForm.kit ? trpgCraftOdds(craftForm.kit, craftForm.item, craftForm.diff, craftForm.helper) : null;
    const it = craftItem(craftForm.item), rc = CRAFT_RECIPES[craftForm.item];
    const mats = Object.keys(rc).map(id => `<span class="${bagCount(id) >= rc[id] ? "" : "bad"}">${esc(ITEM_CATALOG[id].name)} ${bagCount(id)}/${rc[id]}</span>`).join("、");
    const known = trpgKnowsRecipe(craftForm.item);
    const sel = (attr, list, cur) => `<select ${attr}>${list.map(([v, n]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
    const diffs = [["", `按配方（${ROGUE_CHECKS.diffs[it.diff].name}）`]].concat(Object.keys(ROGUE_CHECKS.diffs).map(k => [k, ROGUE_CHECKS.diffs[k].name]));
    const recipeRows = items.map(r => {
      const k = trpgKnowsRecipe(r.id), easy = CRAFT_RULES.knownDiffs.includes(r.diff);
      const m = Object.keys(CRAFT_RECIPES[r.id]).map(id => `${ITEM_CATALOG[id].name}×${CRAFT_RECIPES[r.id][id]}`).join(" + ");
      return `<div class="tr-row"><b>${esc(r.name)}</b> <span class="r-hint">${esc(r.prof)} · ${esc(ROGUE_CHECKS.diffs[r.diff].name)} · ${CRAFT_RULES.hours[r.diff]} 小时 · ${esc(m)}</span>
        ${easy ? '<span class="r-hint">一开始就会</span>' : `<button class="g-btn small" data-teach="${esc(r.id)}:${k ? 0 : 1}">${k ? "收回配方" : "教会"}</button>`}</div>`;
    }).join("");
    const salv = bagList().filter(x => salvageYield(x.id)).map(x => {
      const y = salvageYield(x.id);
      return `<div class="tr-row">${esc(x.name)} ×${x.qty} → ${esc(Object.keys(y).map(id => `${ITEM_CATALOG[id].name}×${y[id]}`).join("、"))}
        <button class="g-btn small" data-salvage="${esc(x.id)}">拆一件</button></div>`;
    }).join("");
    const redeem = EFFECT_ITEMS.filter(x => x.points > 0).map(x =>
      `<button class="g-btn small" data-redeem="${esc(x.id)}" ${pts.points < x.points ? "disabled" : ""}>${esc(x.name)} · ${x.points} 积分</button>`).join("");
    return payerHtml() + `<p class="r-hint">规则见设计文档第 5 节：简单、普通 1 小时，困难 2，极难 3（会推进时间）；失败时非壳体材料丢一半（向上取整），废料、金属留着；有对应熟练项的队友打下手给优势。
        城里、工匠处的工坊五类都能做；野外休息点只能做投掷罐、弹针、增益 / 减益（主持人按剧情判断）。材料在「商店 · 制作材料（黑市）」里买或给予。</p>
      <h3>制作</h3>
      <div class="tr-up">
        <div class="tr-row">谁做 ${sel('id="wk-kit"', hs.map(h => [h.kit, h.name]), craftForm.kit)}
          做什么 ${sel('id="wk-item"', items.map(r => [r.id, `${r.name}${trpgKnowsRecipe(r.id) ? "" : "（还不会）"}`]), craftForm.item)}
          难度 ${sel('id="wk-diff"', diffs, craftForm.diff)}
          打下手 ${sel('id="wk-helper"', [["", "没人帮"]].concat(hs.filter(h => h.kit !== craftForm.kit).map(h => [h.kit, h.name])), craftForm.helper)}</div>
        <div class="r-hint">${esc(it.prof)} · 材料：${mats}${o ? ` · ${["没有熟练", "一级熟练", "二级熟练", "三级熟练"][o.level]} · 成功率 ${pct(o.chance)}${o.adv ? " · 优势" : o.dis ? " · 劣势" : ""}${o.reroll ? " · 失败可重掷" : ""} · ${o.hours} 小时` : ""}</div>
        <div class="tr-row">${known ? `<button class="g-btn" data-craft="roll" ${o && o.base ? "" : "disabled"}>掷骰制作</button>
          <button class="g-btn small" data-craft="ok">记成功（玩家掷的）</button><button class="g-btn small" data-craft="fail">记失败（玩家掷的）</button>` : '<span class="r-hint">还不会这张配方：在下面教会。</span>'}</div>
      </div>
      <h3>商店积分</h3>
      <div class="tr-row">现有 <b>${pts.points}</b> 积分（在商店每花 ${pts.per} 奎支得 1 分，再花 ${pts.next} 得下一分）
        <input type="number" id="wk-pts" value="1" style="width:70px"> <button class="g-btn small" id="wk-pts-add">＋</button><button class="g-btn small" id="wk-pts-sub">－</button></div>
      <div class="tr-row">兑换：${redeem}</div>
      <h3>配方</h3>${recipeRows}
      <h3>拆解（不花时间）</h3>${salv || '<p class="r-hint">背包里没有能拆的东西。</p>'}`;
  };
  function bindWorkshop(P) {
    const k = $("wk-kit"); if (!k) return;
    k.onchange = () => { craftForm.kit = k.value; render(); };
    $("wk-item").onchange = () => { craftForm.item = $("wk-item").value; craftForm.diff = ""; render(); };
    $("wk-diff").onchange = () => { craftForm.diff = $("wk-diff").value; render(); };
    $("wk-helper").onchange = () => { craftForm.helper = $("wk-helper").value; render(); };
    P.querySelectorAll("[data-craft]").forEach(b => { b.onclick = () => act(ruleCommand("craft", { kit: craftForm.kit, item: craftForm.item, diff: craftForm.diff || null, helper: craftForm.helper || null, result: b.dataset.craft })); });
    P.querySelectorAll("[data-teach]").forEach(b => { b.onclick = () => { const [item, on] = b.dataset.teach.split(":"); act(ruleCommand("teachRecipe", { item, on: on === "1" })); }; });
    P.querySelectorAll("[data-salvage]").forEach(b => { b.onclick = () => act(ruleCommand("salvage", { item: b.dataset.salvage })); });
    P.querySelectorAll("[data-redeem]").forEach(b => { b.onclick = () => act(ruleCommand("redeem", { item: b.dataset.redeem })); });
    const n = () => Math.abs(Number($("wk-pts").value) || 0);
    $("wk-pts-add").onclick = () => act(ruleCommand("adjustPoints", { amount: n(), why: "主持人" }));
    $("wk-pts-sub").onclick = () => act(ruleCommand("adjustPoints", { amount: -n(), why: "主持人" }));
  }
  /** 联机时走房间（玩家马上看到）；本机热座直接交给热座会话 */
  async function checkSubmit(cmd) {
    const net = window.OnlineGame && OnlineGame.isHost && OnlineGame.isHost();
    const ack = net ? await OnlineGame.submit(cmd) : HotseatGame.submit(cmd);
    if (ack && ack.ok === false) alert(ack.error);
    render();
  }
  function bindChecks(P) {
    const prof = $("ck-prof"); if (!prof) return;
    prof.onchange = () => { checkForm.prof = prof.value; render(); };
    $("ck-diff").onchange = () => { checkForm.diff = $("ck-diff").value; render(); };
    $("ck-note").oninput = () => { checkForm.note = $("ck-note").value; };
    P.querySelectorAll("[data-ck-unit]").forEach(el => { el.onchange = () => {
      const id = el.dataset.ckUnit; checkForm.units = checkForm.units.filter(x => x !== id); if (el.checked) checkForm.units.push(id);
    }; });
    $("ck-open").onclick = () => {
      const ids = heroes().map(h => h.id).filter(id => checkForm.units.includes(id));
      if (!ids.length) { alert("至少选一名角色"); return; }
      if (online()) { checkForm.note = ""; return checkSubmit({ type: "checkOpen", prof: checkForm.prof, diff: checkForm.diff, unitIds: ids, note: $("ck-note").value }); }
      const spec = checkPreview(ids); if (!spec) return;
      spec.note = $("ck-note").value; checkForm.note = "";
      localChecks.push(Object.assign(spec, { id: "check-" + Date.now(), status: "open", at: Date.now(), targets: spec.targets.map(t => Object.assign(t, { result: null })) }));
      log.push({ stamp: stampNow(), lines: [`主持人发起${spec.diffName}「${spec.prof}」检定：${spec.targets.map(t => t.name).join("、")}${spec.note ? "（" + spec.note + "）" : ""}`] });
      saveLog(); render();
    };
    P.querySelectorAll("[data-ck]").forEach(b => { b.onclick = () => {
      const [cmd, checkId, unitId] = b.dataset.ck.split(":");
      if (online()) return checkSubmit(cmd === "roll" ? { type: "checkRoll", checkId, unitId } : { type: "checkClose", checkId });
      const c = localChecks.find(x => x.id === checkId); if (!c) return;
      if (cmd === "close") c.status = "closed";
      else {
        const t = c.targets.find(x => x.unitId === unitId); if (!t || t.result) return;
        t.result = Hotseat.rollCheck(t);
        log.push({ stamp: stampNow(), lines: [`检定 · ${t.name}「${c.prof}」${c.diffName}（成功率 ${pct(t.base)}）：d100 ${rollText(t.result)} → ${t.result.ok ? "成功" : "失败"}`] });
        saveLog();
        if (c.targets.every(x => x.result)) c.status = "done";
      }
      render();
    }; });
  }
  /** 联机时玩家申请的属性点：主持人同意才真正加上 */
  function attrRequestsHtml() {
    if (!online()) return "";
    const list = (HotseatGame.getView().attrRequests || []).filter(r => r.status === "pending");
    if (!list.length) return "";
    return `<h3>玩家申请的属性点</h3>${list.map(r => `<div class="tr-row"><b>${esc(r.unitName)}</b> 想加 ${esc(r.attrs.map(a => ATTR_NAMES[a]).join("、"))} +1
        <button class="g-btn small" data-attr-req="approve:${esc(r.id)}">同意</button><button class="g-btn small" data-attr-req="reject:${esc(r.id)}">不同意</button></div>`).join("")}`;
  }
  function bindAttrRequests(P) {
    P.querySelectorAll("[data-attr-req]").forEach(b => { b.onclick = () => {
      const [decision, requestId] = b.dataset.attrReq.split(":");
      const r = (HotseatGame.getView().attrRequests || []).find(x => x.id === requestId); if (!r) return;
      if (decision === "approve") {
        const h = heroes().find(x => x.id === r.unitId);
        const before = h ? Number(h.attrPoints) || 0 : 0;
        if (h) act(ruleCommand("spendAttr", { kit: h.kit, attr: r.attrs[0] }));
        const after = h ? Number((heroes().find(x => x.id === r.unitId) || {}).attrPoints) || 0 : before;
        if (!h || after >= before) { alert("没加上（点数不够或这一项不能再加），这条申请按不同意处理"); return checkSubmit({ type: "attrDecide", requestId, decision: "reject" }); }
      }
      checkSubmit({ type: "attrDecide", requestId, decision });
    }; });
  }

  /* ---------- 战斗模板（battle-templates.js）：主持人提前布置好战场，开战时直接摆好 ---------- */
  let btEdit = null;   // 正在编辑的模板（一份拷贝，点「保存」才写回）
  let btIo = "";       // 导入 / 导出框里的文字
  const BT_PROPS = { button: "按钮", lever: "拉杆", battery: "超充能电池", boom: "爆炸桶", acid: "酸液桶", scrap: "碎渣机炮", turret: "防卫自律炮台" };
  const BT_GAPS = { open: "畅通", bridge: "不稳桥梁", wall: "危墙", door: "机关门", void: "空隙" };
  const BT_BOARDS = [[2, "两区"], [3, "三区"], ["line4", "四区直排"], ["square4", "四区方形 2×2"], ["cross5", "五区十字"]];
  const btMechName = m => ({ execution: "死刑", share: "分担", spread: "远离", tower: "踩塔" })[m.type] || m.type;
  /** 用模板开战：进战斗画面时敌人、场地、配置物都已经摆好 */
  function fightTemplate(t) {
    if (!t) return;
    if (!lowHpOk()) return;
    TRPG.taskBattle = null;
    GAME.lastEncounter = battleTemplateToEncounter(t);
    return uiCommand("toBattle", onlineBattleLevel());
  }
  /** 联机：战斗模板 / 任务里写「Lv随队」的敌人按队伍平均等级（作者 10/20 定；trpg-tasks.js · trpgPartyLevel），
   *  不再跟着顶栏手选的等级（默认 Lv1）。本机跑团照旧按顶栏的等级 */
  function onlineBattleLevel() {
    const online = window.OnlineGame && typeof OnlineGame.getView === "function" && (OnlineGame.getView() || {}).active;
    return online && typeof trpgPartyLevel === "function" ? { level: trpgPartyLevel() } : undefined;
  }
  function btCardHtml(t) {
    const id = esc(t.id);
    return `<div class="tr-up tk-card">
      <div class="tk-head"><b>${esc(t.name)}</b><span class="tk-kind">${esc(BATTLE_TEMPLATE_TIERS[t.tier])}</span></div>
      ${t.note ? `<p class="tk-goal">${esc(t.note)}</p>` : ""}
      <div class="r-hint">${esc(battleTemplateSummary(t))}</div>
      <div class="tr-row"><button class="g-btn small tk-go" data-bt="fight:${id}">用它开战</button>
        <button class="g-btn small" data-bt="edit:${id}">编辑</button><button class="g-btn small" data-bt="dup:${id}">复制</button>
        <button class="g-btn small" data-bt="export:${id}">导出</button><button class="g-btn small" data-bt="del:${id}">删除</button></div></div>`;
  }
  function btEditorHtml(t) {
    const inp = (path, v, w, type, extra) => `<input type="${type || "text"}" data-bte="${path}" value="${esc(v == null ? "" : v)}" style="width:${w || 120}px"${extra || ""}>`;
    const presets = (typeof enemyPresets === "function" ? enemyPresets() : []).filter(p => p.id !== "blank_pc").map(p => [p.id, p.name]);
    const zones = battleTemplateZones(t.board);
    const zoneSel = (path, cur) => `<select data-bte="${path}">${options(zones.map(z => [z, z + " 区"]), cur)}</select>`;
    const lvTip = ' placeholder="随队" title="空着 = 跟着开战时的等级"';
    // 个体值（杂兵、精英）：血量 / ATK 水平 −10～10%，空着 = 开战时随机
    const ivTip = ' min="-10" max="10" step="1" placeholder="随机" title="个体值水平 −10～10（%），空着 = 开战时随机；首领不波动"';
    // 富集与否（沙鱼才有）：随机 / 富集 / 普通
    const enrSel = (path, e) => typeof SAND_FISH_KITS !== "undefined" && SAND_FISH_KITS.includes(e.preset)
      ? ` 富集 <select data-bte="${path}.enriched">${options([["", "随机"], ["on", "富集"], ["off", "普通"]], e.enriched === true || e.enriched === "on" ? "on" : e.enriched === false || e.enriched === "off" ? "off" : "")}</select>` : "";
    const ivInp = (path, e) => `<span class="bt-iv">个体值 血量 ${inp(path + ".iv.hp", e.iv ? e.iv.hp : null, 54, "number", ivTip)}% ATK ${inp(path + ".iv.atk", e.iv ? e.iv.atk : null, 54, "number", ivTip)}%</span>`;
    const foes = t.enemies.map((e, j) => `<div class="tr-row">
        <select data-bte="enemies.${j}.preset" data-bte-rerender="1">${options(presets, e.preset)}</select>
        等级 ${inp(`enemies.${j}.level`, e.level, 60, "number", lvTip)} 区域 ${zoneSel(`enemies.${j}.zone`, e.zone)}
        ${ivInp(`enemies.${j}`, e)}${enrSel(`enemies.${j}`, e)}
        ${e.mechanics ? `<span class="tk-chip">机制：${esc(e.mechanics.map(btMechName).join("、"))}<button class="g-btn small" data-bt-act="clearMech:${j}" title="去掉这个敌人身上的首领机制">×</button></span>` : ""}
        <button class="g-btn small" data-bt-act="delEnemy:${j}">删</button></div>`).join("");
    const fields = zones.map(z => {
      const f = t.fields[z] || {};
      return `<div class="tr-row">${z} 区 <select data-bt-field="${z}">${options(Object.keys(BATTLE_TEMPLATE_FIELD_KINDS).map(k => [k, BATTLE_TEMPLATE_FIELD_KINDS[k]]), battleTemplateFieldKind(f))}</select>
        <label><input type="checkbox" data-bt-high="${z}"${f.highland ? " checked" : ""}> 高地</label>
        ${f.ruinOn ? `<label>耐久 <input type="number" min="1" style="width:60px" data-bt-ruin="${z}" value="${Number(f.ruinHp) || 30}"></label>` : ""}</div>`;
    }).join("");
    const gaps = battleTemplateGapKeys(t.board).map(k => {
      const g = t.gaps[k] || { type: "open", hp: null, open: false };
      const hp = g.type === "bridge" || g.type === "wall" ? ` 耐久 <input type="number" data-bt-gaphp="${k}" value="${g.hp == null ? "" : g.hp}" placeholder="按规则掷" style="width:80px">` : "";
      const door = g.type === "door" ? ` <label><input type="checkbox" data-bt-door="${k}"${g.open ? " checked" : ""}> 开着</label>` : "";
      return `<div class="tr-row">${k.replace("-", "–")} 区之间 <select data-bt-gap="${k}">${options(Object.keys(BT_GAPS).map(x => [x, BT_GAPS[x]]), g.type)}</select>${hp}${door}</div>`;
    }).join("");
    const props = t.props.map((p, j) => `<div class="tr-row">
        <select data-bte="props.${j}.kind">${options(Object.keys(BT_PROPS).map(k => [k, BT_PROPS[k]]), p.kind)}</select>
        区域 ${zoneSel(`props.${j}.zone`, p.zone)} 等级 ${inp(`props.${j}.level`, p.level, 60, "number", lvTip)}
        阵营 <select data-bte="props.${j}.faction">${options([["player", "我方"], ["enemy", "敌方"]], p.faction)}</select>
        <button class="g-btn small" data-bt-act="delProp:${j}">删</button></div>`).join("");
    // 援军：第几回合抵达，每个敌人进哪个区
    const waves = (t.waves || []).map((w, j) => `<div class="tk-wave">
        <div class="tr-row">第 ${j + 1} 波：开战后第 ${inp(`waves.${j}.turns`, w.turns, 50, "number", ' min="1"')} 回合开始时抵达（提前打光场上的敌人就下一回合到）
          <button class="g-btn small" data-bt-act="delWave:${j}">删这波</button></div>
        ${(w.enemies || []).map((e, k) => `<div class="tr-row">　<select data-bte="waves.${j}.enemies.${k}.preset" data-bte-rerender="1">${options(presets, e.preset)}</select>
          等级 ${inp(`waves.${j}.enemies.${k}.level`, e.level, 60, "number", lvTip)} 进入 ${zoneSel(`waves.${j}.enemies.${k}.zone`, e.zone)} ${ivInp(`waves.${j}.enemies.${k}`, e)}${enrSel(`waves.${j}.enemies.${k}`, e)}
          <button class="g-btn small" data-bt-act="delWaveEnemy:${j}-${k}">删</button></div>`).join("")}
        <div class="tr-row">　<button class="g-btn small" data-bt-act="addWaveEnemy:${j}">＋ 援军敌人</button></div></div>`).join("");
    const others = (typeof battleTemplateList === "function" ? battleTemplateList() : []).filter(x => x.id !== t.id).map(x => [x.id, x.name]);
    const chain = (t.chain || []).map((id, j) => `<div class="tr-row">第 ${j + 2} 场：<select data-bte="chain.${j}">${options(others.some(o => o[0] === id) ? others : others.concat([[id, "（模板已删除）"]]), id)}</select>
        <button class="g-btn small" data-bt-act="delChain:${j}">删</button></div>`).join("");
    return `<div class="tr-up tk-edit">
      <h4>编辑战斗模板</h4>
      <div class="tr-row">名称 ${inp("name", t.name, 180)} 类型 <select data-bte="tier">${options(Object.keys(BATTLE_TEMPLATE_TIERS).map(k => [k, BATTLE_TEMPLATE_TIERS[k]]), t.tier)}</select></div>
      <div class="tr-row">备注 ${inp("note", t.note, 360)}</div>
      <div class="tr-row">战场 <select data-bte="board" data-bte-rerender="1">${options(BT_BOARDS, t.board)}</select>
        天气 <select data-bte="weather">${options(Object.keys(WX).map(k => [k, WX[k]]), t.weather)}</select>
        我方站在 ${zoneSel("playerZone", t.playerZone)}</div>
      <div class="tr-row">我方阵营 <select data-bte="allyFaction">${options([["", "只有我方"]].concat((typeof battleTemplateFactions === "function" ? battleTemplateFactions() : []).map(f => [f, "和「" + f + "」同阵营"])), t.allyFaction || "")}</select>
        <span class="r-hint">同阵营的敌人是友军：不打我方、我方也打不到它，它会和与它敌对的阵营（例如安保 ↔ 盗匪、异星生物）互相打；打赢不用打倒友军。敌对的阵营不管站在哪都会互相打。</span></div>
      <h4>敌人</h4>${foes || '<p class="r-hint">还没有敌人。</p>'}
      <div class="tr-row"><button class="g-btn small" data-bt-act="addEnemy">＋ 敌人</button></div>
      <h4>场地</h4>${fields}
      <h4>间隙</h4>${gaps}
      <h4>配置物</h4>${props || '<p class="r-hint">没有配置物。</p>'}
      <div class="tr-row"><button class="g-btn small" data-bt-act="addProp">＋ 配置物</button></div>
      <h4>援军</h4>${waves || '<p class="r-hint">没有援军。</p>'}
      <div class="tr-row"><button class="g-btn small" data-bt-act="addWave">＋ 一波援军</button></div>
      <h4>连续战斗</h4>
      <p class="r-hint">打完这一场（含援军）不结束，接着去下一个区域打下面的模板：场地、敌人换成那个模板的，天气、角色的血量和状态都不重置，仍算同一场战斗。</p>
      ${chain || ""}
      <div class="tr-row"><button class="g-btn small" data-bt-act="addChain" ${others.length ? "" : 'disabled title="先存好别的模板"'}>＋ 接一场</button></div>
      <h4>战斗掉落（打赢才给，直接进背包）</h4>
      <div class="tr-row">奎支 <input type="number" min="0" data-bt-dropkz="1" value="${(t.drops && t.drops.kuizhi) || 0}" style="width:90px">
        物品 <select id="bt-drop-item">${options(Object.keys(ITEM_CATALOG).map(id => [id, ITEM_CATALOG[id].name || id]))}</select>
        × <input type="number" min="1" id="bt-drop-qty" value="1" style="width:56px"> <button class="g-btn small" data-bt-act="addDrop">＋</button>
        ${((t.drops && t.drops.items) || []).map((x, k) => `<span class="tk-chip">${esc((ITEM_CATALOG[x.id] || {}).name || x.id)}×${x.qty}<button class="g-btn small" data-bt-act="delDrop:${k}">×</button></span>`).join("")}</div>
      <p class="r-hint">首领机制（死刑 / 分担 / 远离 / 踩塔）要在战斗画面「战场配置」里给敌人挂上，再「把当前战场存为模板」。</p>
      <div class="tr-row"><button class="g-btn" data-bt-act="save">保存</button><button class="g-btn" data-bt-act="cancel">取消</button></div>
    </div>`;
  }
  PANELS.battles = function () {
    const list = typeof battleTemplateList === "function" ? battleTemplateList() : [];
    const editing = btEdit && !list.some(t => t.id === btEdit.id) ? btEditorHtml(btEdit) : "";
    const cards = list.map(t => btEdit && btEdit.id === t.id ? btEditorHtml(btEdit) : btCardHtml(t)).join("");
    return `<p class="r-hint">提前把战场布置好存成模板：区制 / 棋盘、天气、我方站位、敌人（等级、区域）、场地、间隙、配置物。
        点「用它开战」进战斗画面时一切都已经摆好，玩家看到的就是布置完的战场，主持人只要点「开始战斗」。
        也可以在战斗画面的「战场配置」里摆好之后「把当前战场存为模板」（这样还能带上首领机制）。
        模板存在这台电脑上，所有团、联机房间共用；任务的战斗站也能直接选模板。</p>
      <div class="tr-row"><button class="g-btn small" data-bt="new:">新建模板</button>
        <button class="g-btn small" data-bt="exportAll:">导出全部</button><button class="g-btn small" data-bt="import:">导入</button></div>
      <div class="tr-row"><textarea id="bt-io" rows="3" style="width:100%" placeholder="导出的模板文字会出现在这里；要导入就把文字贴进来再点「导入」">${esc(btIo)}</textarea></div>
      ${editing}
      ${cards || (editing ? "" : '<p class="r-hint">还没有模板。</p>')}`;
  };
  function btSet(path, v) {
    const keys = path.split(".");
    let o = btEdit;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] || (o[keys[i]] = {});
    const k = keys[keys.length - 1];
    if (k === "level") o[k] = v === "" ? null : Number(v);
    else if (keys[keys.length - 2] === "iv") o[k] = v === "" || !Number.isFinite(Number(v)) ? null : Math.max(-10, Math.min(10, Math.round(Number(v))));
    else if (k === "zone" || k === "playerZone") o[k] = Number(v);
    else if (k === "board") o[k] = /^\d+$/.test(v) ? Number(v) : v;
    else o[k] = v;
    if (k === "board") { btEdit.playerZone = null; btEdit = battleTemplateNormalize(btEdit); }   // 换了棋盘：我方回到棋盘默认的区，区号、间隙夹回新棋盘
  }
  function btAct(a) {
    const [cmd, x] = a.split(":");
    const t = btEdit, j = Number(x);
    const zones = t ? battleTemplateZones(t.board) : [1, 2];
    switch (cmd) {
      case "save":
        try { battleTemplateSave(t); } catch (e) { alert(e.message); return; }
        btEdit = null; break;
      case "cancel": btEdit = null; break;
      case "addEnemy": t.enemies.push({ preset: "thug_knife", level: null, zone: zones[zones.length - 1] }); break;
      case "delEnemy": t.enemies.splice(j, 1); break;
      case "clearMech": delete t.enemies[j].mechanics; break;
      case "addProp": t.props.push({ kind: "boom", zone: zones[Math.min(1, zones.length - 1)], level: null, faction: "player" }); break;
      case "delProp": t.props.splice(j, 1); break;
      case "addWave": t.waves = t.waves || []; t.waves.push({ turns: 2, enemies: [{ preset: "thug_knife", level: null, zone: zones[zones.length - 1] }] }); break;
      case "delWave": (t.waves || []).splice(j, 1); break;
      case "addWaveEnemy": if (t.waves && t.waves[j]) t.waves[j].enemies.push({ preset: "thug_knife", level: null, zone: zones[zones.length - 1] }); break;
      case "delWaveEnemy": { const [a, b] = String(x).split("-").map(Number); if (t.waves && t.waves[a]) t.waves[a].enemies.splice(b, 1); break; }
      case "addChain": {
        const first = battleTemplateList().find(o => o.id !== t.id);
        if (first) { t.chain = t.chain || []; t.chain.push(first.id); }
        break;
      }
      case "delChain": (t.chain || []).splice(j, 1); break;
      case "addDrop": {
        t.drops = t.drops || { kuizhi: 0, items: [] };
        const id = $("bt-drop-item").value, qty = Math.max(1, Number($("bt-drop-qty").value) || 1);
        const same = t.drops.items.find(x => x.id === id); if (same) same.qty += qty; else t.drops.items.push({ id, qty });
        break;
      }
      case "delDrop": if (t.drops) { t.drops.items.splice(j, 1); if (!t.drops.items.length && !t.drops.kuizhi) t.drops = null; } break;
    }
    render();
  }
  function bindTemplates(P) {
    const io = () => { const box = $("bt-io"); return box ? box.value : ""; };
    P.querySelectorAll("[data-bt]").forEach(b => {
      b.onclick = () => {
        const i = b.dataset.bt.indexOf(":");
        const cmd = b.dataset.bt.slice(0, i), id = b.dataset.bt.slice(i + 1);
        btIo = io();
        if (cmd === "new") { btEdit = battleTemplateNormalize({ name: "新战场", board: 2, enemies: [{ preset: "thug_knife", level: null, zone: 2 }] }); return render(); }
        if (cmd === "edit") { btEdit = battleTemplateById(id); return render(); }
        if (cmd === "dup") { battleTemplateDuplicate(id); return render(); }
        if (cmd === "del") { const t = battleTemplateById(id); if (t && confirm(`删除模板「${t.name}」？`)) battleTemplateDelete(id); if (btEdit && btEdit.id === id) btEdit = null; return render(); }
        if (cmd === "export") { btIo = battleTemplateExport([id]); return render(); }
        if (cmd === "exportAll") { btIo = battleTemplateExport(); return render(); }
        if (cmd === "import") {
          if (!btIo.trim()) { alert("先把模板文字贴到框里"); return; }
          try { const n = battleTemplateImport(btIo); btIo = ""; alert(`导入了 ${n} 个模板`); } catch (e) { alert(e.message); return; }
          return render();
        }
        if (cmd === "fight") return fightTemplate(battleTemplateById(id));
      };
    });
    if (!btEdit) return;
    P.querySelectorAll("[data-bte]").forEach(el => {
      const ev = el.tagName === "SELECT" ? "onchange" : "oninput";
      el[ev] = () => { btSet(el.dataset.bte, el.value); if (el.dataset.bteRerender) render(); };
    });
    P.querySelectorAll("[data-bt-field]").forEach(el => {
      el.onchange = () => { const z = el.dataset.btField; battleTemplateSetField(btEdit, z, el.value, !!(btEdit.fields[z] || {}).highland); render(); };
    });
    P.querySelectorAll("[data-bt-ruin]").forEach(el => {
      el.onchange = () => { const z = el.dataset.btRuin; battleTemplateSetField(btEdit, z, "ruinOn", !!(btEdit.fields[z] || {}).highland, Number(el.value) || 1); };
    });
    P.querySelectorAll("[data-bt-high]").forEach(el => {
      el.onchange = () => { const z = el.dataset.btHigh; battleTemplateSetField(btEdit, z, battleTemplateFieldKind(btEdit.fields[z]), el.checked); };
    });
    P.querySelectorAll("[data-bt-gap]").forEach(el => {
      el.onchange = () => {
        const k = el.dataset.btGap;
        if (el.value === "open") delete btEdit.gaps[k];
        else btEdit.gaps[k] = { type: el.value, hp: null, open: false };
        render();
      };
    });
    P.querySelectorAll("[data-bt-gaphp]").forEach(el => { el.oninput = () => { const g = btEdit.gaps[el.dataset.btGaphp]; if (g) g.hp = el.value === "" ? null : Number(el.value); }; });
    P.querySelectorAll("[data-bt-door]").forEach(el => { el.onchange = () => { const g = btEdit.gaps[el.dataset.btDoor]; if (g) g.open = el.checked; }; });
    P.querySelectorAll("[data-bt-act]").forEach(b => { b.onclick = () => btAct(b.dataset.btAct); });
    P.querySelectorAll("[data-bt-dropkz]").forEach(el => { el.oninput = () => {
      const kz = Math.max(0, Number(el.value) || 0);
      btEdit.drops = btEdit.drops || { kuizhi: 0, items: [] }; btEdit.drops.kuizhi = kz;
      if (!kz && !btEdit.drops.items.length) btEdit.drops = null;
    }; });
  }

  /** 进战斗前：有队员血量低于 20% 而且还能短休，先提醒（返回 false = 不进） */
  function lowHpOk() {
    const low = typeof lowHpRestWarning === "function" ? lowHpRestWarning() : [];
    return !low.length || confirm(lowHpWarningText(low));
  }

  /* ---------- 绑定 ---------- */
  // 玩家掷了检定、申请了属性点：主持人这边的「检定」「队伍」页跟着刷新（正在输入时不打断）
  let tableKey = "", tableSub = false;
  function watchTable() {
    if (tableSub || !window.HotseatGame) return;
    tableSub = true;
    HotseatGame.subscribe(() => {
      if (!HotseatGame.isActive() || !Screens.is("trpg") || !["checks", "party", "merchants", "bag", "shop", "workshop", "clinic"].includes(tab)) return;
      // 玩家那边的检定、属性点申请、转账、在商人那里买 / 兑换：主持人面板跟着刷新
      const v = HotseatGame.getView(), key = JSON.stringify([v.checks, v.attrRequests, LEDGER.purse, Number(state.kuizhi) || 0,
        (LEDGER.merchants || []).map(m => m.rows.map(r => r.stock)), (LEDGER.workshop || {}).points || 0, bagList().map(x => x.id + x.qty), (TRPG.cyberRequests || []).map(r => r.id + r.status)]);
      if (key === tableKey) return;
      tableKey = key;
      const a = document.activeElement;
      if (a && $("tr-panel").contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
      render();
    });
  }
  function bind() {
    watchTable();
    const P = $("tr-panel");
    bindTasks(P);
    bindTemplates(P);
    bindChecks(P);
    bindWorkshop(P);
    bindMerchants(P);
    bindClinic(P);
    bindAttrRequests(P);
    const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
    $("tr-tabs").querySelectorAll("[data-tab]").forEach(b => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
    // 队伍
    on("tr-apply-party", () => {
      const kits = [...P.querySelectorAll("[data-kit]")].filter(x => x.checked).map(x => x.dataset.kit);
      if (!kits.length) return;
      uiCommand("party", { kits });
    });
    on("tr-xp-go", () => act(ruleCommand("giveXp", { kits: $("tr-xp-who").value ? [$("tr-xp-who").value] : null, amount: $("tr-xp").value })));
    P.querySelectorAll("[data-attr]").forEach(b => { b.onclick = () => { const [k, a] = b.dataset.attr.split(":"); act(ruleCommand("spendAttr", { kit: k, attr: a })); }; });
    P.querySelectorAll("[data-feat-go]").forEach(b => { b.onclick = () => {
      const k = b.dataset.featGo;
      const pick = P.querySelector(`[data-feat-pick="${k}"]`), full = P.querySelector(`[data-feat-full="${k}"]`);
      if (pick && pick.value) act(ruleCommand("pickFeat", { kit: k, feat: pick.value, full: full ? full.value : null }));
    }; });
    on("tr-reset", () => {
      if (!confirm(`清空存档「${slotName}」的进度？等级、经验、物资、奎支、时间、探索记录都会归零（名字保留）。`)) return;
      uiCommand("reset");
    });
    // 时间与休息
    P.querySelectorAll("[data-hours]").forEach(b => { b.onclick = () => act(ruleCommand("passHours", { hours: b.dataset.hours })); });
    P.querySelectorAll("[data-minutes]").forEach(b => { b.onclick = () => act(ruleCommand("passMinutes", { minutes: b.dataset.minutes })); });
    on("tr-hours-go", () => act(ruleCommand("passMinutes", { minutes: (Math.max(0, Math.floor(Number($("tr-hours").value) || 0)) * 60) + Math.max(0, Math.floor(Number($("tr-mins").value) || 0)) })));
    on("tr-until-go", () => act(ruleCommand("passUntil", { time: $("tr-until").value })));
    // 角色页：换人
    P.querySelectorAll("[data-hs-kit]").forEach(b => { b.onclick = () => { sheetKit = b.dataset.hsKit; render(); }; });
    on("tr-short-all", () => act(ruleCommand("shortRest", { kits: null })));
    P.querySelectorAll("[data-short]").forEach(b => { b.onclick = () => act(ruleCommand("shortRest", { kits: [b.dataset.short] })); });
    const restPlan = (force) => {
      const food = {};
      const sleep = {};
      P.querySelectorAll("[data-food]").forEach(s => { food[s.dataset.food] = s.value; });
      P.querySelectorAll("[data-sleep]").forEach(s => { sleep[s.dataset.sleep] = s.value; });
      const spit = {};
      P.querySelectorAll("[data-spit]").forEach(s => { spit[s.dataset.spit] = s.value; });
      const ammo = {};
      P.querySelectorAll("[data-ammo]").forEach(s => { ammo[s.dataset.ammo] = s.value; });
      return { hours: Number($("tr-long-h").value) || 8, food, sleep, spit, ammo, force };
    };
    // 长休先进营地（issue #52）：大家看看状态、聊聊天，主持人点「开始长休」才真的休息
    on("tr-long", () => act(ruleCommand("campOpen", { plan: restPlan(false) })));
    on("tr-long-force", () => act(ruleCommand("campOpen", { plan: restPlan(true) })));
    on("tr-restore", () => act(ruleCommand("restore")));
    // 商店
    const qty = (key) => (P.querySelector(`[data-qty="${key}"]`) || {}).value || 1;
    P.querySelectorAll("[data-buy]").forEach(b => { b.onclick = () => { if (window.Sfx) Sfx.ui("coin"); act(ruleCommand("buy", { key: b.dataset.buy, qty: qty(b.dataset.buy), free: false })); }; });
    P.querySelectorAll("[data-give]").forEach(b => { b.onclick = () => act(ruleCommand("buy", { key: b.dataset.give, qty: qty(b.dataset.give), free: true })); });
    // 钱包：由谁付、转账、公账平分
    P.querySelectorAll("[data-payer]").forEach(s => { s.onchange = () => { payer = s.value; render(); }; });
    on("tr-pay-go", () => act(ruleCommand("purseTransfer", { from: $("tr-pay-from").value, to: $("tr-pay-to").value, amount: Number($("tr-pay-n").value) || 0 })));
    on("tr-pay-split", () => act(ruleCommand("purseSplit", {})));
    // 背包
    const why = () => ($("tr-kz-why") || {}).value || "";
    on("tr-kz-add", () => act(ruleCommand("adjustKuizhi", { amount: Math.abs(Number($("tr-kz").value) || 0), why: why() })));
    on("tr-kz-sub", () => act(ruleCommand("adjustKuizhi", { amount: -Math.abs(Number($("tr-kz").value) || 0), why: why() })));
    on("tr-water-add", () => act(ruleCommand("adjustWater", { amount: Math.abs(Number($("tr-water").value) || 0) })));
    on("tr-water-sub", () => act(ruleCommand("adjustWater", { amount: -Math.abs(Number($("tr-water").value) || 0) })));
    P.querySelectorAll("[data-heal]").forEach(b => { b.onclick = () => act(ruleCommand("heal", { item: b.dataset.heal, kit: P.querySelector(`[data-heal-who="${b.dataset.heal}"]`).value })); });
    on("tr-repair", () => act(ruleCommand("repair", { kit: $("tr-repair-who").value })));
    P.querySelectorAll("[data-item]").forEach(b => { b.onclick = () => { const [id, n] = b.dataset.item.split(":"); act(ruleCommand("adjustItem", { item: id, amount: Number(n) })); }; });
    // 后台
    on("bs-apply", () => { const edit = readBackstage(); const why = $("bs-why").value.trim(); act(ruleCommand("backstage", { edit, why })); });
    on("bs-undo", () => render());
    // 武器升级
    // 改装槽
    P.querySelectorAll("[data-part-in]").forEach(b => {
      b.onclick = () => {
        const [owner, kit, slot, free] = b.dataset.partIn.split(":");
        const pick = P.querySelector(`[data-part-pick="${owner}:${kit}:${slot}"]`);
        act(ruleCommand("installPart", { owner, kit, slot: Number(slot), part: pick ? pick.value : null, free: free === "1" }));
      };
    });
    P.querySelectorAll("[data-part-rm]").forEach(b => {
      b.onclick = () => { const [owner, kit, slot] = b.dataset.partRm.split(":"); act(ruleCommand("removePart", { owner, kit, slot: Number(slot) })); };
    });
    on("tr-part-give-btn", () => act(ruleCommand("adjustItem", { item: $("tr-part-give").value, amount: 1 })));
    P.querySelectorAll("[data-part-rand]").forEach(b => { b.onclick = () => act(ruleCommand("randomPart", { grade: b.dataset.partRand })); });
    // 客制化图纸
    on("tr-bp-give-btn", () => act(ruleCommand("adjustItem", { item: $("tr-bp-give").value, amount: 1 })));
    P.querySelectorAll("[data-bp-in]").forEach(b => {
      b.onclick = () => {
        const [owner, kit, free] = b.dataset.bpIn.split(":");
        const pick = P.querySelector(`[data-bp-pick="${owner}:${kit}"]`);
        const fee = P.querySelector(`[data-bp-fee="${owner}:${kit}"]`);
        act(ruleCommand("installBlueprint", { owner, kit, blueprint: pick ? pick.value : null, fee: fee ? Number(fee.value) || 0 : 0, free: free === "1" }));
      };
    });
    P.querySelectorAll("[data-bp-rm]").forEach(b => { b.onclick = () => { const [owner, kit] = b.dataset.bpRm.split(":"); act(ruleCommand("removeBlueprint", { owner, kit })); }; });
    P.querySelectorAll("[data-up]").forEach(b => {
      b.onclick = () => {
        const [owner, kit, mode] = b.dataset.up.split(":");
        const fee = (P.querySelector(`[data-fee="${kit}"]`) || {}).value;
        act(ruleCommand("upgradeWeapon", { owner, kit, mode, fee: fee == null ? null : fee }));
      };
    });
  }

  /* ---------- 存档空位 ---------- */
  function freshCampaign() {
    try { localStorage.removeItem("anterscale-campaign"); } catch (e) {}
    GAME.campaign = null;
    LEDGER.reset(); state.kuizhi = 0; state.bag = { items: [] };
    GAME.partyKits = DEFAULT_PARTY.slice();
    GAME.lastEncounter = null;
    log = [];
  }
  function fmtTime(t) {
    if (!t) return "";
    const d = new Date(t), p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function renderSlots() {
    const slots = trpgReadSlots();
    const problem = trpgSlotsProblem();   // 空位文件坏了：已另存 .broken（读得出来的团照旧留着）
    $("tr-slot-list").innerHTML = (problem ? `<p class="r-warn" style="grid-column:1/-1">⚠ ${esc(problem)}</p>` : "") + slots.map((s, i) => {
      const m = trpgSlotSummary(s);
      if (!m) return `<div class="tr-slot empty">
          <div class="tr-slot-head"><b>存档 ${i + 1}</b><span>空</span></div>
          <p class="r-hint">还没有团。</p>
          <div class="tr-row"><button class="g-btn r-main" data-new="${i}">开新团</button><button class="g-btn" data-import="${i}">从文件读入</button></div>
        </div>`;
      return `<div class="tr-slot${i === slot ? " on" : ""}">
          <div class="tr-slot-head"><b>存档 ${i + 1} · ${esc(m.name)}</b><span>${esc(fmtTime(m.at))}</span></div>
          <div class="tr-slot-meta">第 ${m.day} 天 · 奎支 ${m.kuizhi}</div>
          <div class="tr-slot-meta">${esc(m.party.join("、") || "（没有队员）")}</div>
          <div class="tr-row">
            <button class="g-btn r-main" data-open="${i}">继续这个团</button>
            <button class="g-btn small" data-rename="${i}">改名</button>
            <button class="g-btn small" data-export="${i}">存成文件</button>
            <button class="g-btn small" data-import="${i}">从文件读入</button>
            <button class="g-btn small" data-clear="${i}">删除</button>
          </div>
        </div>`;
    }).join("");
    const L = $("tr-slot-list");
    L.querySelectorAll("[data-open]").forEach(b => { b.onclick = () => uiCommand("enter", { index: Number(b.dataset.open) }); });
    L.querySelectorAll("[data-new]").forEach(b => {
      b.onclick = () => {
        const i = Number(b.dataset.new);
        const name = prompt("给这个团起个名字：", `团 ${i + 1}`);
        if (name == null) return;
        uiCommand("new", { index: i, name: name.trim() || `团 ${i + 1}` });
      };
    });
    L.querySelectorAll("[data-rename]").forEach(b => {
      b.onclick = () => {
        const i = Number(b.dataset.rename), s = trpgReadSlots()[i];
        const name = prompt("新名字：", s.name || "");
        if (name == null || !name.trim()) return;
        uiCommand("rename", { index: i, name: name.trim() });
      };
    });
    L.querySelectorAll("[data-clear]").forEach(b => {
      b.onclick = () => {
        const i = Number(b.dataset.clear), s = trpgReadSlots()[i];
        if (!confirm(`删除存档 ${i + 1}「${s.name}」？删掉就找不回来了（可以先「存成文件」备份）。`)) return;
        uiCommand("delete", { index: i });
      };
    });
    L.querySelectorAll("[data-export]").forEach(b => {
      b.onclick = () => {
        const s = trpgReadSlots()[Number(b.dataset.export)];
        const blob = new Blob([JSON.stringify({ kind: "anterscale-trpg-slot", version: 1, slot: s }, null, 1)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        // 文件名只用英文数字：有的浏览器从本地打开时不认中文文件名（团名在文件里面）
        a.download = `antlerscale-trpg-slot${Number(b.dataset.export) + 1}-${fmtTime(Date.now()).replace(/[- :]/g, "")}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };
    });
    L.querySelectorAll("[data-import]").forEach(b => {
      b.onclick = () => {
        const i = Number(b.dataset.import);
        const inp = document.createElement("input");
        inp.type = "file"; inp.accept = ".json,application/json";
        inp.onchange = () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            let data = null;
            try { data = JSON.parse(r.result); } catch (e) {}
            const s = data && data.kind === "anterscale-trpg-slot" ? data.slot : data;
            if (!trpgValidSlot(s)) { alert("这个文件不是跑团模式的存档。"); return; }
            if (trpgReadSlots()[i] && !confirm(`用文件里的「${s.name || "未命名"}」覆盖存档 ${i + 1}？`)) return;
            uiCommand("import", { index: i, data: s });
          };
          r.readAsText(f);
        };
        inp.click();
      };
    });
  }
  function openSlots() {
    if (TRPG.active && slot >= 0) save();
    Screens.show("trpg-slots");
  }

  /** 把一份存档内容（空位里的、或撤销点）装进内存：队伍记忆、时间、背包、记录、敌人等级 */
  function applySlotData(s) {
    if (s.campaign) {
      GAME.campaign = JSON.parse(JSON.stringify(s.campaign));
      LEDGER.load(GAME.campaign.ledger);
      try { localStorage.setItem("anterscale-campaign", JSON.stringify(GAME.campaign)); } catch (e) {}
      GAME.partyKits = (GAME.campaign.partyKits && GAME.campaign.partyKits.length) ? GAME.campaign.partyKits.slice()
        : (GAME.campaign.party || []).map(p => p.kit);
      if (!GAME.partyKits.length) GAME.partyKits = DEFAULT_PARTY.slice();
      GAME.lastEncounter = s.enc || null;
      log = Array.isArray(s.log) ? s.log.slice() : [];
    } else {
      freshCampaign();
      log = Array.isArray(s.log) ? s.log.slice() : [];
    }
    const lv = $("g-level");
    if (s.level) commandLevel = Number(s.level);
    if (lv && s.level) lv.value = String(s.level);
  }

  /* ---------- 进出 ---------- */
  function enter(i) {
    const s = trpgReadSlots()[i];
    if (!s) return;
    slot = i;
    slotName = s.name || `团 ${i + 1}`;
    TRPG.active = true;
    document.body.classList.add("trpg");
    if (typeof Rogue !== "undefined") Rogue.leaveRunMode();   // 经验曲线恢复手册的 1 倍
    undoStack = [];
    applySlotData(s);
    rebuild();
    save();
    tab = "party";
    Screens.show("trpg");
  }
  function toBattle() {
    save();
    Screens.show("battle");
    GAME.setupBattle(level(), GAME.lastEncounter || null);
  }
  function backFromBattle() {
    const r = $("g-result"); if (r) r.classList.remove("show");
    const ro = $("g-reopen"); if (ro) ro.classList.remove("show");
    // 没结算就回来（放弃这场战斗）：耐久、「长休一次」技能的使用记录等队伍档案也回到开战前（trpg.js · trpgAbandonBattle）；
    // 奎支、物品在下面重新摆队伍时按队伍记忆回滚
    if (state.combatStarted && !GAME.ended) trpgAbandonBattle(GAME.campaign);
    TRPG.taskBattle = null;   // 没结算就回来：这场不算任务战斗
    undoStack = [];   // 战斗打完回来：之前的撤销点在战斗之前，撤回去会把整场战斗的结果一起抹掉，所以清空
    // 先切回探索画面再布置下一场：否则布置时战斗画面还在，开战前的大字会弹出来盖在探索画面上
    Screens.show("trpg");
    const intro = document.getElementById("g-intro"); if (intro) intro.remove();
    rebuild();
    save();
    render();
  }

  /** 离开跑团模式（存好这个团、关掉跑团规则）。战斗没打完时不存：空位里留的是开战前那份（toBattle 开战前存过），
   *  免得把打到一半的血量、用掉的道具当成团的进度（报告 H1） */
  function leaveTrpg() {
    if (!TRPG.active) return false;
    const midBattle = window.GAME && state.combatStarted && !GAME.ended && Screens.is("battle");
    if (slot >= 0 && !midBattle) save();
    TRPG.active = false; TRPG.taskBattle = null; slot = -1; undoStack = [];
    document.body.classList.remove("trpg");
    return true;
  }
  /** 跑团战斗里点顶栏「标题」：和「回到探索环节」一样先放弃 / 收好这场战斗，再存团、离开跑团模式（报告 H1：以前直接回标题，
   *  TRPG.active 没清，之后同一页开的单局 / 每日挑战 / 训练场都按跑团规则走，还会写进跑团空位） */
  function requestTitleFromBattle() {
    if (window.GAME && GAME.depth > 0) return false;
    if (state.combatStarted && !GAME.ended && !confirm("战斗还没结束。回到标题会放弃这场战斗（不结算，回到开战前的状态），团的进度照常保存。确定吗？")) return false;
    uiCommand("backFromBattle");
    uiCommand("title");
    return true;
  }
  function requestBackFromBattle() {
    if (window.GAME && GAME.depth > 0) return;
    if (state.combatStarted && !GAME.ended && !confirm("战斗还没结束。直接回到探索环节会放弃这场战斗（不结算，回到开战前的状态）。确定吗？")) return;
    return uiCommand("backFromBattle");
  }
  const uiActions = {
    rule(c) { if (!c.command || c.command.type !== "trpg") throw new Error("Expected a TRPG rule command"); return performAct(c.command); },
    saveCaptured: writeSlotNow,
    recordBattle(c) { recordBattle(c.result); },
    party(c) {
      pushUndo(); GAME.partyKits = c.kits.slice(); rebuild();
      log.push({ stamp: stampNow(), lines: [`队伍：${c.kits.map(k => (livePartyCards().find(x => x.kit === k) || {}).name || k).join("、")}。`] });
      saveLog(); save(); render();
    },
    reset() { pushUndo(); freshCampaign(); rebuild(); save(); render(); },
    undo,
    enter(c) { enter(c.index); },
    new(c) { trpgWriteSlot(c.index, { name: c.name, campaign: null, log: [], level: 1, enc: null }); enter(c.index); },
    rename(c) { const s = trpgReadSlots()[c.index]; if (!s) return; s.name = c.name; trpgWriteSlot(c.index, s); if (c.index === slot) slotName = s.name; renderSlots(); },
    delete(c) { trpgClearSlot(c.index); if (c.index === slot) { slot = -1; TRPG.active = false; document.body.classList.remove("trpg"); } renderSlots(); },
    import(c) { if (!trpgValidSlot(c.data)) throw new Error("Invalid TRPG save"); trpgWriteSlot(c.index, c.data); if (c.index === slot) { slot = -1; TRPG.active = false; document.body.classList.remove("trpg"); } renderSlots(); },
    slots: openSlots,
    title() { leaveTrpg(); Screens.show("title"); },
    toBattle,
    backFromBattle,
    clearLog() { log = []; saveLog(); renderLog(); }
  };
  Commands.register("trpg.ui", c => {
    if (!Object.hasOwn(uiActions, c.action)) throw new Error("Unknown TRPG UI action: " + c.action);
    commandLevel = Number(c.level) || 1;
    if ($("g-level")) $("g-level").value = String(commandLevel);
    return uiActions[c.action](c);
  }, { domain: "trpg-ui" });

  function recordBattle(r) {
      if (!TRPG.active || slot < 0) return;
      const head = { win: "战斗胜利", lose: "战斗失败（全员倒地）", retreat: "撤出战斗" }[r.outcome] || "战斗结束";
      const lines = [`${head}（第 ${r.turn} 回合）：每人获得 ${r.xp} 经验${r.xpMult > 1 ? `（经验 ×${r.xpMult}）` : ""}，掉落 ${r.kuizhi} 奎支（现有 ${Number(state.kuizhi) || 0}）。`];
      if (r.grade) lines.push(`评价 ${r.grade.grade}：${r.grade.score} 分（基准 ${r.grade.par}）${r.outcome === "win" && r.grade.xpMult > 1 ? `，战斗经验 ×${r.grade.xpMult}（已含在上面的经验里）` : ""}。`);
      if (r.ups && r.ups.length) lines.push("升级：" + r.ups.join("、") + "。");
      if (r.drops && typeof battleDropsText === "function") lines.push("战斗掉落：" + battleDropsText(r.drops) + "（已放进背包）。");
      (r.stats || []).filter(x => x.dmg || x.brk || x.taken || x.kills || x.heal).forEach(x => {
        lines.push(`${x.sub ? "　" : ""}${x.name}${x.sub ? "（武器人）" : ""}：伤害 ${Math.round(x.dmg)} · 击破 ${Math.round(x.brk)} · 承伤 ${Math.round(x.taken)} · 击杀 ${x.kills} · 治疗 ${Math.round(x.heal)}`);
      });
      (r.durNotes || []).forEach(t => lines.push(t));
      if (typeof trpgTaskAfterBattle === "function") lines.push(...trpgTaskAfterBattle(r.outcome));   // 任务战斗：护送对象血量、推进路线
      log.push({ stamp: stampNow(), lines });
  }

  function boot() {
    if (!$("scr-trpg")) return;
    Screens.register("trpg", $("scr-trpg"), { onShow: render });
    Screens.register("trpg-slots", $("scr-trpg-slots"), { onShow: renderSlots });
    // Capture the current game panel level at the UI callback boundary; it may
    // have changed through the battle preparation panel since the last TRPG action.
    GAME.onCampaignSaved = () => uiCommand("saveCaptured");
    // 战斗结算：这场拿到的经验、奎支、升级写进探索记录
    GAME.onBattleFinished = r => {
      if (!TRPG.active || slot < 0) return;
      const data = { result: JSON.parse(JSON.stringify(r)) };
      if (window.HotseatGame && HotseatGame.isActive()) HotseatGame.system({ type: "trpg.ui", action: "recordBattle", level: Number(($("g-level") || {}).value) || 1, ...data });
      else uiCommand("recordBattle", data);
    };
    const xm = $("g-xp-mult");
    if (xm) xm.onchange = () => Commands.dispatch(ruleCommand("xpMultiplier", { value: xm.value }));
    $("tr-slots").onclick = () => uiCommand("slots");
    $("tr-undo").onclick = () => uiCommand("undo");
    document.addEventListener("keydown", (e) => {
      if (!Screens.is("trpg")) return;
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!(window.HotseatGame && HotseatGame.isActive())) uiCommand("undo"); }
    });
    $("tr-slots-title").onclick = () => uiCommand("title");
    $("tr-fight").onclick = () => { if (lowHpOk()) uiCommand("toBattle"); };
    $("tr-bs").onclick = () => { tab = "backstage"; render(); };
    $("tr-bestiary").onclick = () => {
      if (!window.Bestiary) return;
      Bestiary.open({ partySize: Math.max(2, Math.min(4, heroes().filter(h => !h.dead).length)), sub: "跑团" });
    };
    $("tr-map").onclick = () => { if (window.WorldMap) WorldMap.open(mapOptions()); };
    $("tr-title").onclick = () => uiCommand("title");
    $("tr-copy").onclick = (e) => {
      const text = log.map(x => `【${x.stamp}】\n` + x.lines.map(l => "  " + l).join("\n")).join("\n");
      const btn = e.currentTarget;
      copyText(text, ok => { const o = btn.textContent; btn.textContent = ok ? "已复制" : "复制失败"; setTimeout(() => { btn.textContent = o; }, 1200); });
    };
    $("tr-clear").onclick = () => { if (confirm("清空探索记录？")) uiCommand("clearLog"); };
    $("g-to-explore").onclick = requestBackFromBattle;
    $("g-explore-back").onclick = requestBackFromBattle;
    const sb = $("t-sandbox");
    if (sb) sb.onclick = () => uiCommand("slots");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /** 角鳞星地图：队伍的位置由主持人在地图上设（跟着存档走） */
  function mapOptions() {
    return {
      here: LEDGER.place || null, herePos: LEDGER.placePos || null, canMove: true,
      sub: `跑团${slotName ? " · " + slotName : ""}${LEDGER.place ? ` · 队伍在${worldPlace(LEDGER.place).name}${LEDGER.placePos ? "附近" : ""}` : " · 还没设定队伍的位置（点「放标记」或地点 → 把队伍移到这里）"}`,
      party: heroes().filter(h => !h.dead).map(h => h.name),
      // loc：{ place } 移到地点上；{ place, x, y } 拖到了任意位置（place 是最近的地点）；null 不再标出
      onMove: (loc) => { act(ruleCommand("setPlace", !loc ? { place: null } : loc.x != null ? { place: loc.place, x: loc.x, y: loc.y } : { place: loc.place })); },
      refresh: () => mapOptions()
    };
  }
  window.TrpgFlow = { leave: leaveTrpg, titleFromBattle: requestTitleFromBattle, mapOptions, enter: index => uiCommand("enter", { index }), openSlots: () => uiCommand("slots"), toBattle: () => uiCommand("toBattle"), backFromBattle: requestBackFromBattle,
    refresh: render,
    onlineCheckpoint: () => JSON.parse(JSON.stringify({ slot, slotName, log, tab, commandLevel })),
    restoreOnline(saved) { slot = saved.slot; slotName = saved.slotName; log = saved.log || []; tab = saved.tab || "party"; commandLevel = saved.commandLevel || 1; TRPG.active = true; document.body.classList.add("trpg"); }
  };
})();
