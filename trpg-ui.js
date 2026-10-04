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
  let log = [];
  let slot = -1;          // 正在玩的存档空位
  let slotName = "";
  let undoStack = [];     // 探索环节的撤销：每个操作之前记一份（最多 20 步）
  const UNDO_MAX = 20;

  const TABS = [
    ["party", "队伍"], ["rest", "时间与休息"], ["shop", "商店"], ["bag", "背包"], ["smith", "武器升级"], ["backstage", "后台"]
  ];

  function heroes() { return trpgHeroes(); }
  let commandLevel = 1;
  function level() { return commandLevel; }
  function uiCommand(action, data) {
    return Commands.dispatch(Object.assign({ type: "trpg.ui", action, level: Number(($("g-level") || {}).value) || 1 }, data || {}));
  }
  function ruleCommand(action, data) { return Object.assign({ type: "trpg", action }, data || {}); }

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
      const stamp = `第 ${LEDGER.day || 1} 天 · 距长休 ${LEDGER.hours || 0} 小时`;
      log.push({ stamp, lines: notes });
      saveLog();
    }
    save();
    render();
  }
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
    $("tr-clock").innerHTML = `第 <b>${LEDGER.day || 1}</b> 天 · 距上次长休 <b>${LEDGER.hours || 0}</b> 小时` +
      (t ? ` · <span class="warn">${esc(exhaustText(t))}</span>` : "");
    const food = FOOD_ORDER.reduce((s, id) => s + bagCount(id), 0);
    $("tr-supplies").innerHTML = `<span>奎支 <b>${Number(state.kuizhi) || 0}</b></span><span>水 <b>${ledgerWater()}</b> ml</span><span>食物 <b>${food}</b> 份</span>`;
  }

  /* ---------- 左栏：队伍状态（主持人视角，坚毅生命照常显示） ---------- */
  function renderParty() {
    $("tr-party").innerHTML = heroes().map(h => {
      const tag = h.dead ? "死亡" : h.dying ? "濒死" : h.upOnShp ? "起身中" : "";
      const xpNext = typeof xpToNext === "function" ? xpToNext(h.level || 1) : 0;
      const weapons = (h.linkedKits || []).map(k => {
        const lv = (h.weaponLevels || {})[k] || 1;
        const d = weaponDur(k), m = weaponDurMax(k);
        return `<div class="rh-w${d <= 0 ? " broken" : ""}">${esc(weaponName(k))} Lv${lv} · 耐久 ${d}/${m}${d <= 0 ? "（损坏）" : ""}</div>`;
      }).join("");
      return `<div class="rhero${h.dead ? " fallen" : h.dying ? " dying" : ""}">
        <div class="rh-top"><b>${esc(h.name)}</b><span>Lv${h.level || 1}${tag ? " · " + tag : ""}</span></div>
        <div class="rh-row">血量 <span>${totalHpOf(h)}/${totalHpMaxOf(h)}</span></div>
        <div class="rh-row">坚毅 <span>${Number(h.shp) || 0}/${Number(h.shpMax) || 0}</span></div>
        <div class="rh-row">经验 <span>${Number(h.xp) || 0}/${xpNext || "满"}</span></div>
        ${Number(h.attrPoints) > 0 ? `<div class="rh-w tr-attn">有 ${h.attrPoints} 点属性点可分配（队伍页）</div>` : ""}
        ${weapons}
      </div>`;
    }).join("") || `<p class="r-hint">还没有队员。到「队伍」页选人。</p>`;
  }

  /* ---------- 各页 ---------- */
  const PANELS = {
    party() {
      const pool = livePartyCards().filter(c => !c.weaponOf);
      const on = new Set((window.GAME && GAME.partyKits) || []);
      const picks = pool.map(c => `<label class="tr-pick"><input type="checkbox" data-kit="${esc(c.kit)}" ${on.has(c.kit) ? "checked" : ""}>${esc(c.name)}<small>${esc(c.note || "")}</small></label>`).join("");
      const attrs = heroes().filter(h => Number(h.attrPoints) > 0).map(h =>
        `<div class="tr-row"><b>${esc(h.name)}</b> 有 ${h.attrPoints} 点属性点：
          ${Object.keys(ATTR_NAMES).map(k => `<button class="g-btn small" data-attr="${esc(h.kit)}:${k}">${ATTR_NAMES[k]} ${(h.attrs || {})[k] || 0} +1</button>`).join("")}</div>`).join("");
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
        <p class="r-hint">升级照手册第三章：4 级、8 级各 1 点属性点（8 级那点不能加在曾经加过的同一项上）；职责技能按角色卡自动解锁；熟练项、专长由主持人记在角色卡上。</p>
        ${attrs ? `<h3>分配属性点</h3>${attrs}` : ""}
        <h3>重新开团</h3>
        <button class="g-btn" id="tr-reset">清空这个存档的进度（等级、物资、时间全部归零）</button>
        <p class="r-hint">要同时带别的团，点顶栏「换存档」用另一个空位。</p>`;
    },
    rest() {
      const plan = longRestNeeds({});
      const foods = FOOD_ORDER.filter(id => ITEM_CATALOG[id]);
      const rows = heroes().filter(h => !h.dead).map(h => {
        const c = heroRestCost(h);
        return `<div class="tr-row"><b>${esc(h.name)}</b> 长休需 ${c.water} ml 水 · ${c.food} 份食物 · 吃
          <select data-food="${esc(h.kit)}">${foods.map(id => `<option value="${id}">${esc(ITEM_CATALOG[id].name)}（有 ${bagCount(id)}）</option>`).join("")}</select>
          · 今天还能短休 ${shortRestLeft(h)} 次</div>`;
      }).join("");
      return `<h3>推进时间</h3>
        <div class="tr-row">
          ${[1, 2, 4, 8].map(n => `<button class="g-btn" data-hours="${n}">+${n} 小时</button>`).join("")}
          <input type="number" id="tr-hours" value="3" min="1" style="width:70px"><button class="g-btn" id="tr-hours-go">经过</button>
        </div>
        <p class="r-hint">距上次长休 20 / 40 / 60 小时分别进入力竭 1 / 2 / 3，80 小时力竭致死（手册第五章）。每满 24 小时算过了一天，短休次数刷新。</p>
        <h3>短休（1 小时）</h3>
        <div class="tr-row"><button class="g-btn" id="tr-short-all">全员短休</button>
          ${heroes().filter(h => !h.dead).map(h => `<button class="g-btn small" data-short="${esc(h.kit)}">${esc(h.name)}</button>`).join("")}</div>
        <h3>长休</h3>
        ${rows}
        <div class="tr-row">时长 <select id="tr-long-h">${[8, 9, 10, 11, 12].map(n => `<option value="${n}">${n} 小时</option>`).join("")}</select>
          <button class="g-btn r-main" id="tr-long">长休</button>
          <button class="g-btn" id="tr-long-force" title="不扣水和食物（剧情安排的休息）">长休（不扣补给）</button></div>
        <p class="r-hint">${plan.ok ? `一共需要 ${plan.water} ml 水。` : "补给不足：" + esc((plan.lack || []).join("，"))}长休：血量、耐久回满，武器人痊愈，坚毅生命按小时慢慢恢复，清空力竭。</p>
        <h3>主持人</h3>
        <button class="g-btn" id="tr-restore">全员复原（不扣补给、不推进时间）</button>`;
    },
    shop() {
      const groups = [];
      HANDBOOK_SHOP.forEach(r => { if (groups.indexOf(r.group) < 0) groups.push(r.group); });
      return `<p class="r-hint">价格照手册物品表。「买」扣奎支；「给予」是主持人直接给（战利品、奖励），不扣钱。</p>` +
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
      const kits = bagCount("repair_kit");
      const weapons = heroes().flatMap(h => (h.linkedKits || []).map(k => ({ k, name: weaponName(k), d: weaponDur(k), m: weaponDurMax(k) })));
      return `<h3>奎支与水</h3>
        <div class="tr-row">奎支 <input type="number" id="tr-kz" value="100" style="width:100px">
          <button class="g-btn small" id="tr-kz-add">＋ 获得</button><button class="g-btn small" id="tr-kz-sub">－ 花掉</button>
          <input type="text" id="tr-kz-why" placeholder="原因（可不填）" style="width:160px"></div>
        <div class="tr-row">水 <input type="number" id="tr-water" value="1000" style="width:100px"> ml
          <button class="g-btn small" id="tr-water-add">＋</button><button class="g-btn small" id="tr-water-sub">－</button></div>
        <h3>用道具（探索中）</h3>
        ${heal.length ? heal.map(x => `<div class="tr-row">${esc(x.name)} ×${x.qty} → 给
            <select data-heal-who="${x.id}">${heroes().filter(h => !h.dead).map(h => `<option value="${esc(h.kit)}">${esc(h.name)}（${totalHpOf(h)}/${totalHpMaxOf(h)}）</option>`).join("")}</select>
            <button class="g-btn small" data-heal="${x.id}">使用</button></div>`).join("") : `<p class="r-hint">背包里没有医疗包。</p>`}
        ${kits ? `<div class="tr-row">维修工具包 ×${kits} → 修 <select id="tr-repair-who">${weapons.map(w => `<option value="${esc(w.k)}">${esc(w.name)}（${w.d}/${w.m}）</option>`).join("")}</select>
            <button class="g-btn small" id="tr-repair">修理 10 点</button></div>` : ""}
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
      return `<p class="r-hint">手册：升级武器需要找到工作站；${U.selfMaxLevel} 级以上无法靠自己升级，要找专门的武器工匠（材料 + 加工费，不同工匠的费用要求不一样，按剧情改费用）。材料在商店「材料」里买，或在背包里给予。</p>${rows}`;
    }
  };

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
          <label>耐久 ${numIn(`data-bs-dur="${k}" data-w="${esc(w)}" min="0" max="${weaponDurMax(w)}"`, weaponDur(w), 52)} / ${weaponDurMax(w)}</label>
          ${hurt ? `<label title="武器人上次留下的伤势：${esc(hurtText)}"><input type="checkbox" data-bs-heal="${k}" data-w="${esc(w)}"> 治好武器人伤势（${esc(hurtText)}）</label>` : ""}</div>`;
      }).join("");
      return `<div class="tr-up tr-bs">
        <div class="tr-row"><b>${esc(h.name)}</b>
          <label>状态 <select data-bs-status="${k}">${Object.keys(TRPG_STATUS).map(x => `<option value="${x}" ${x === st ? "selected" : ""}>${TRPG_STATUS[x]}</option>`).join("")}</select></label>
          <label>等级 ${numIn(`data-bs-lv="${k}" min="1" max="25"`, h.level || 1, 52)}</label>
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
        <label>距上次长休 ${numIn(`id="bs-hours" min="0"`, LEDGER.hours || 0, 56)} 小时</label>
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
    const edit = { day: $("bs-day").value, hours: $("bs-hours").value, kuizhi: $("bs-kz").value, water: $("bs-water").value, heroes: {} };
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

  /* ---------- 绑定 ---------- */
  function bind() {
    const P = $("tr-panel");
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
    on("tr-reset", () => {
      if (!confirm(`清空存档「${slotName}」的进度？等级、经验、物资、奎支、时间、探索记录都会归零（名字保留）。`)) return;
      uiCommand("reset");
    });
    // 时间与休息
    P.querySelectorAll("[data-hours]").forEach(b => { b.onclick = () => act(ruleCommand("passHours", { hours: b.dataset.hours })); });
    on("tr-hours-go", () => act(ruleCommand("passHours", { hours: $("tr-hours").value })));
    on("tr-short-all", () => act(ruleCommand("shortRest", { kits: null })));
    P.querySelectorAll("[data-short]").forEach(b => { b.onclick = () => act(ruleCommand("shortRest", { kits: [b.dataset.short] })); });
    const restPlan = (force) => {
      const food = {};
      P.querySelectorAll("[data-food]").forEach(s => { food[s.dataset.food] = s.value; });
      return { hours: Number($("tr-long-h").value) || 8, food, force };
    };
    on("tr-long", () => act(ruleCommand("longRest", { plan: restPlan(false) })));
    on("tr-long-force", () => act(ruleCommand("longRest", { plan: restPlan(true) })));
    on("tr-restore", () => act(ruleCommand("restore")));
    // 商店
    const qty = (key) => (P.querySelector(`[data-qty="${key}"]`) || {}).value || 1;
    P.querySelectorAll("[data-buy]").forEach(b => { b.onclick = () => act(ruleCommand("buy", { key: b.dataset.buy, qty: qty(b.dataset.buy), free: false })); });
    P.querySelectorAll("[data-give]").forEach(b => { b.onclick = () => act(ruleCommand("buy", { key: b.dataset.give, qty: qty(b.dataset.give), free: true })); });
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
    $("tr-slot-list").innerHTML = slots.map((s, i) => {
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
    undoStack = [];   // 战斗打完回来：之前的撤销点在战斗之前，撤回去会把整场战斗的结果一起抹掉，所以清空
    rebuild();
    save();
    Screens.show("trpg");
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
      log.push({ stamp: `第 ${LEDGER.day || 1} 天 · 距长休 ${LEDGER.hours || 0} 小时`, lines: [`队伍：${c.kits.map(k => (livePartyCards().find(x => x.kit === k) || {}).name || k).join("、")}。`] });
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
    title() { if (TRPG.active && slot >= 0) save(); TRPG.active = false; slot = -1; document.body.classList.remove("trpg"); Screens.show("title"); },
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
      (r.stats || []).filter(x => x.dmg || x.brk || x.taken || x.kills || x.heal).forEach(x => {
        lines.push(`${x.sub ? "　" : ""}${x.name}${x.sub ? "（武器人）" : ""}：伤害 ${Math.round(x.dmg)} · 击破 ${Math.round(x.brk)} · 承伤 ${Math.round(x.taken)} · 击杀 ${x.kills} · 治疗 ${Math.round(x.heal)}`);
      });
      (r.durNotes || []).forEach(t => lines.push(t));
      log.push({ stamp: `第 ${LEDGER.day || 1} 天 · 距长休 ${LEDGER.hours || 0} 小时`, lines });
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
    $("tr-fight").onclick = () => uiCommand("toBattle");
    $("tr-bs").onclick = () => { tab = "backstage"; render(); };
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

  window.TrpgFlow = { enter: index => uiCommand("enter", { index }), openSlots: () => uiCommand("slots"), toBattle: () => uiCommand("toBattle"), backFromBattle: requestBackFromBattle };
})();
