/* 角鳞 · 跑团模式的探索环节界面（规则在 trpg.js）
 *
 * 队伍就是战斗画面里的那支（跑团模式的「队伍记忆」）。进探索环节时按记忆重新摆一次队伍；
 * 每做一个操作就存一次，下一场战斗照这个状态开打；打完回来继续。 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LOG_KEY = "anterscale-trpg-log";
  let tab = "party";
  let log = [];

  const TABS = [
    ["party", "队伍"], ["rest", "时间与休息"], ["shop", "商店"], ["bag", "背包"], ["smith", "武器升级"]
  ];

  function heroes() { return trpgHeroes(); }
  function level() { return Number(($("g-level") || {}).value) || 1; }

  /* ---------- 存 / 读 ---------- */
  function save() {
    if (typeof ledgerCapture === "function") ledgerCapture();
    if (window.GAME && GAME.rememberCampaign) GAME.rememberCampaign();
  }
  function loadLog() {
    try { log = JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch (e) { log = []; }
  }
  function saveLog() {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-400))); } catch (e) {}
  }
  /** 一次操作：执行、记日志、存档、重画 */
  function act(fn) {
    let notes = [];
    try { notes = fn() || []; } catch (e) { notes = ["没做成：" + e.message]; }
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
        <button class="g-btn" id="tr-reset">清空队伍记忆（等级、物资、时间全部归零）</button>`;
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
      GAME.partyKits = kits;
      act(() => { rebuild(); return [`队伍：${kits.map(k => (livePartyCards().find(c => c.kit === k) || {}).name || k).join("、")}。`]; });
    });
    on("tr-xp-go", () => act(() => trpgGiveXp($("tr-xp-who").value ? [$("tr-xp-who").value] : null, $("tr-xp").value)));
    P.querySelectorAll("[data-attr]").forEach(b => { b.onclick = () => { const [k, a] = b.dataset.attr.split(":"); act(() => trpgSpendAttr(k, a)); }; });
    on("tr-reset", () => {
      if (!confirm("清空跑团模式的队伍记忆？等级、经验、物资、奎支、时间都会归零。")) return;
      try { localStorage.removeItem("anterscale-campaign"); } catch (e) {}
      if (window.GAME) GAME.campaign = null;
      LEDGER.reset(); state.kuizhi = 0; state.bag = { items: [] };
      log = []; saveLog();
      rebuild(); save(); render();
    });
    // 时间与休息
    P.querySelectorAll("[data-hours]").forEach(b => { b.onclick = () => act(() => trpgPassHours(b.dataset.hours)); });
    on("tr-hours-go", () => act(() => trpgPassHours($("tr-hours").value)));
    on("tr-short-all", () => act(() => trpgShortRest(null)));
    P.querySelectorAll("[data-short]").forEach(b => { b.onclick = () => act(() => trpgShortRest([b.dataset.short])); });
    const restPlan = (force) => {
      const food = {};
      P.querySelectorAll("[data-food]").forEach(s => { food[s.dataset.food] = s.value; });
      return { hours: Number($("tr-long-h").value) || 8, food, force };
    };
    on("tr-long", () => act(() => trpgLongRest(restPlan(false))));
    on("tr-long-force", () => act(() => trpgLongRest(restPlan(true))));
    on("tr-restore", () => act(() => ledgerRestoreAll([])));
    // 商店
    const qty = (key) => (P.querySelector(`[data-qty="${key}"]`) || {}).value || 1;
    P.querySelectorAll("[data-buy]").forEach(b => { b.onclick = () => act(() => trpgBuy(b.dataset.buy, qty(b.dataset.buy), false)); });
    P.querySelectorAll("[data-give]").forEach(b => { b.onclick = () => act(() => trpgBuy(b.dataset.give, qty(b.dataset.give), true)); });
    // 背包
    const why = () => ($("tr-kz-why") || {}).value || "";
    on("tr-kz-add", () => act(() => trpgAdjustKuizhi(Math.abs(Number($("tr-kz").value) || 0), why())));
    on("tr-kz-sub", () => act(() => trpgAdjustKuizhi(-Math.abs(Number($("tr-kz").value) || 0), why())));
    on("tr-water-add", () => act(() => trpgAdjustWater(Math.abs(Number($("tr-water").value) || 0))));
    on("tr-water-sub", () => act(() => trpgAdjustWater(-Math.abs(Number($("tr-water").value) || 0))));
    P.querySelectorAll("[data-heal]").forEach(b => { b.onclick = () => act(() => trpgUseHeal(b.dataset.heal, P.querySelector(`[data-heal-who="${b.dataset.heal}"]`).value)); });
    on("tr-repair", () => act(() => trpgRepair($("tr-repair-who").value)));
    P.querySelectorAll("[data-item]").forEach(b => { b.onclick = () => { const [id, n] = b.dataset.item.split(":"); act(() => trpgAdjustItem(id, Number(n))); }; });
    // 武器升级
    P.querySelectorAll("[data-up]").forEach(b => {
      b.onclick = () => {
        const [owner, kit, mode] = b.dataset.up.split(":");
        const fee = (P.querySelector(`[data-fee="${kit}"]`) || {}).value;
        act(() => trpgUpgradeWeapon(owner, kit, mode, fee));
      };
    });
  }

  /* ---------- 进出 ---------- */
  function enter() {
    TRPG.active = true;
    document.body.classList.add("trpg");
    if (typeof Rogue !== "undefined") Rogue.leaveRunMode();   // 经验曲线恢复手册的 1 倍
    const camp = window.GAME && GAME.loadCampaignMem ? GAME.loadCampaignMem() : null;
    if (camp && camp.partyKits && camp.partyKits.length) GAME.partyKits = camp.partyKits.slice();
    loadLog();
    rebuild();
    save();
    Screens.show("trpg");
  }
  function toBattle() {
    save();
    Screens.show("battle");
    GAME.setupBattle(level(), GAME.lastEncounter || null);
  }
  function backFromBattle() {
    if (window.GAME && GAME.depth > 0) return;
    if (state.combatStarted && !GAME.ended && !confirm("战斗还没结束。直接回到探索环节会放弃这场战斗（不结算，回到开战前的状态）。确定吗？")) return;
    const r = $("g-result"); if (r) r.classList.remove("show");
    const ro = $("g-reopen"); if (ro) ro.classList.remove("show");
    rebuild();
    Screens.show("trpg");
  }

  function boot() {
    if (!$("scr-trpg")) return;
    Screens.register("trpg", $("scr-trpg"), { onShow: render });
    $("tr-fight").onclick = toBattle;
    $("tr-title").onclick = () => { TRPG.active = false; document.body.classList.remove("trpg"); Screens.show("title"); };
    $("tr-copy").onclick = (e) => {
      const text = log.map(x => `【${x.stamp}】\n` + x.lines.map(l => "  " + l).join("\n")).join("\n");
      const btn = e.currentTarget;
      copyText(text, ok => { const o = btn.textContent; btn.textContent = ok ? "已复制" : "复制失败"; setTimeout(() => { btn.textContent = o; }, 1200); });
    };
    $("tr-clear").onclick = () => { if (confirm("清空探索记录？")) { log = []; saveLog(); renderLog(); } };
    $("g-to-explore").onclick = backFromBattle;
    $("g-explore-back").onclick = backFromBattle;
    const sb = $("t-sandbox");
    if (sb) sb.onclick = enter;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.TrpgFlow = { enter, toBattle, backFromBattle };
})();
