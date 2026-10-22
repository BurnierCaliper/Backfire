/* 角鳞：四幕 · 单局界面
 *
 * 规则全在 rogue.js，数值全在 rogue-data.js，这里只负责显示和按钮。每做一步就自动存档。
 * 界面：
 *   party  选队伍（2–4 人）
 *   run    单局主界面，按 run.stage 显示：任务板 / 任务节点 / 休整 / 首领 / 幕间 / 通关 / 结局
 *   battle 战斗（game.js），打完回到 run
 * 加一种节点：rogue-data.js 的 ROGUE_NODE_TYPES 加一行，rogue.js 加规则，这里的 NODE_PANELS 加一个面板。
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const C = ROGUE_CONFIG;

  let run = null;          // 当前这一局
  let shownRest = null;    // 已经弹过的长休结算（rest-report.js）
  let lastNotes = [];      // 上一步发生了什么（显示在记录栏）
  let lastError = "";
  let restSel = { food: {}, sleep: {}, spit: {}, ammo: {} };   // 长休界面：每个角色选的食物 / 睡眠道具（没选的按默认）      // 上一步为什么没做成（显示在主面板顶上，免得按了像没反应）

  const save = () => { if (run && run.stage !== "over") dispatch({ type: "run.session", action: "save" }, { run }); };
  const query = (action, fields) => dispatch(Object.assign({ type: "run.query", action }, fields || {}), { run });
  if (window.HeroSheet) HeroSheet.register("run", () => (run ? query("sheetData") : []));
  if (window.Armory) Armory.register("run", () => (run ? query("armoryData") : []));

  /* ---------- 联机单局（online-rogue.js）：要队伍一起决定的事改成投票，花钱从角色自己的钱包出 ---------- */
  const online = () => !!(window.OnlineRogue && OnlineRogue.active());
  const myId = () => (window.OnlineGame && OnlineGame.getView().identity || {}).id || "";
  let payerKit = "";
  /** 房主这边花钱用哪名角色的钱包（只能是房主自己操控的角色） */
  function hostPayer() {
    const kits = online() ? OnlineRogue.hostKits() : [];
    if (!kits.includes(payerKit)) payerKit = kits[0] || "";
    return payerKit;
  }
  function money() { return online() ? OnlineRogue.purse(hostPayer()) : Rogue.supplies().kuizhi; }

  function completeAction(notes, error) {
    lastError = error ? error.message : "";
    lastNotes = error ? [error.message] : Array.isArray(notes) ? notes : [];
    if (run && run.stage === "over") finishRun();
    else save();
    render();
    if (online()) OnlineRogue.changed();
    // 长休结算画面：刚长休完弹一次（玩家看的，坚毅只给一句话）
    if (run && run.lastRest && run.lastRest.id !== shownRest && window.RestReport) { shownRest = run.lastRest.id; RestReport.play(run.lastRest, { gm: false }); }
  }
  function doAct(command) {
    let notes, error;
    lastError = "";
    try { notes = dispatch(Object.assign({ type: "run" }, command), { run }); }
    catch (e) { error = e; }
    completeAction(notes, error);
  }
  function act(command) {
    if (online()) {
      try {
        if (OnlineRogue.isTeamCommand(command)) {
          const opt = OnlineRogue.matchOption(command);
          if (!opt) throw new Error("这一步现在不能选");
          OnlineRogue.vote(myId(), opt.id, command);
          lastError = ""; lastNotes = [`你投了「${opt.label}」。等大家都投完（或者按「按现在的票数决定」）。`];
          render();
          return;
        }
        if (["buy", "redeem", "buyPart", "sellPart", "learnRecipe", "salvage"].includes(command.action) && !command.payer) {
          if (!hostPayer()) throw new Error("房主没有自己操控的角色，不能花钱");
          command = Object.assign({}, command, { payer: hostPayer() });
        }
        OnlineRogue.checkHost(command);
      } catch (e) { completeAction(null, e); return; }
    }
    doAct(command);
  }

  /* ---------- 选队伍 ---------- */
  const picked = [];
  // 单人模式：一名主角、三名伙伴、一个第二副职责
  const solo = { on: false, hero: null, partners: [], role2: null };
  // 长线养成：开局选 ROGUE_GROWTH.startParty 名角色
  const growth = { on: false };
  // 换一局（新开 / 读档）时，已经有的长休结算不重弹
  const session = { get run() { return run; }, set run(value) { run = value; shownRest = value && value.lastRest ? value.lastRest.id : null; }, picked, solo, growth };
  const sessionCommand = (action, fields, context) => dispatch(Object.assign({ type: "run.session", action }, fields || {}), Object.assign({ session }, context || {}));
  const PARTY_TIP = "挑 2–4 名角色出发。每人都带着自己的专属武器人；角色永久死亡时，武器人也会一起离开。";
  const SOLO_TIP = `先点一名角色当主角，再挑 ${ROGUE_SOLO.partners} 名伙伴（战斗里用「支援」叫他们登场打协助攻击），最后选一个第二副职责。` +
    `单人模式：每回合 ${ROGUE_SOLO.apPerRound} 行动点，能给自己协助格挡、接自己打出的失衡；每场胜利额外 +${ROGUE_SOLO.battleXp} 经验，` +
    `每 ${ROGUE_SOLO.attrEvery} 级多一次六维属性，每 ${ROGUE_SOLO.role2Every} 级从第二副职责里多学一个技能。`;
  const GROWTH_TIP = `挑 ${ROGUE_GROWTH.startParty} 名角色组成初始小队。独立存档，没有期限和首领。每天获得赫心融合体，在角色抽取机里抽角色。` +
    `角色永久死亡后等级与武器等级清零并移出队伍，下次抽到从 1 级重新培养。`;
  function renderParty() {
    $("party-title").textContent = solo.on ? "单人模式 · 选择主角与伙伴" : growth.on ? "长线养成 · 选择初始小队" : "选择队伍";
    $("party-tip").textContent = solo.on ? SOLO_TIP : growth.on ? GROWTH_TIP : PARTY_TIP;
    const box = $("party-grid");
    box.innerHTML = Rogue.heroPool().map(c => {
      const isHero = solo.on && solo.hero === c.kit;
      const isMate = solo.on && solo.partners.indexOf(c.kit) >= 0;
      const on = solo.on ? (isHero || isMate) : picked.indexOf(c.kit) >= 0;
      const weapons = SaveStore.weaponsOf(c.kit).map(Rogue.heroName).join("、");
      const roles = c.roles ? [c.roles.primary, c.roles.secondary].filter(Boolean).filter((r, i, a) => a.indexOf(r) === i).join(" / ") : "";
      const tag = isHero ? '<em class="hp-tag hero">主角</em>' : isMate ? '<em class="hp-tag mate">伙伴</em>' : "";
      return `<button class="hero-pick${on ? " on" : ""}${isMate ? " mate" : ""}" data-kit="${esc(c.kit)}" aria-pressed="${on}">
        <span class="hp-name">${esc(c.name)}<small>${esc(c.enName || "")}</small>${tag}</span>
        <span class="hp-note">${esc(c.note || "")}</span>
        <span class="hp-meta">${roles ? esc(roles) + " · " : ""}武器人：${esc(weapons || "无")}</span>
      </button>`;
    }).join("");
    box.querySelectorAll(".hero-pick").forEach(b => {
      b.onclick = () => {
        sessionCommand("toggleHero", { kit: b.dataset.kit });
        renderParty();
      };
    });
    const roleBox = $("party-solo");
    roleBox.hidden = !solo.on;
    if (solo.on) {
      const opts = solo.hero ? Rogue.role2Options(solo.hero) : [];
      roleBox.innerHTML = `<h3>第二副职责</h3>` + (solo.hero
        ? `<div class="r-choices">${opts.map(r => {
            const defs = [1, 2, 3].map(n => (roleSkillDef(r, n) || {}).name).filter(Boolean).join(" / ");
            return `<button class="g-btn${solo.role2 === r ? " r-main" : ""}" data-role2="${esc(r)}">${esc(r)}<small>${esc(defs)}</small></button>`;
          }).join("")}</div>`
        : `<p class="r-hint">先选主角（只能选角色卡上没有的职责）。</p>`);
      roleBox.querySelectorAll("[data-role2]").forEach(b => { b.onclick = () => { sessionCommand("chooseRole2", { role: b.dataset.role2 }); renderParty(); }; });
      const ok = solo.hero && solo.partners.length === ROGUE_SOLO.partners && solo.role2;
      $("party-go").disabled = !ok;
      $("party-count").textContent = !solo.hero ? "先选主角"
        : `主角 ${Rogue.heroName(solo.hero)} · 伙伴 ${solo.partners.length}/${ROGUE_SOLO.partners}` +
          (solo.partners.length ? "：" + solo.partners.map(Rogue.heroName).join("、") : "") +
          ` · 第二副职责 ${solo.role2 || "未选"}`;
      return;
    }
    const n = picked.length;
    if (growth.on) {
      $("party-go").disabled = n !== ROGUE_GROWTH.startParty;
      $("party-count").textContent = `已选 ${n}/${ROGUE_GROWTH.startParty} 人` + (n ? "：" + picked.map(Rogue.heroName).join("、") : "");
      return;
    }
    $("party-go").disabled = !(n >= SaveStore.PARTY_MIN && n <= SaveStore.PARTY_MAX);
    $("party-count").textContent = `已选 ${n} 人（${SaveStore.PARTY_MIN}–${SaveStore.PARTY_MAX} 人）` +
      (n ? "：" + picked.map(Rogue.heroName).join("、") : "");
  }

  /* ---------- 顶栏与队伍栏 ---------- */
  function bar(cur, max, cls) {
    const pct = max > 0 ? Math.max(0, Math.min(100, cur / max * 100)) : 0;
    return `<span class="rbar ${cls || ""}"><i style="width:${pct}%"></i></span>`;
  }
  const EXHAUST = ["", "力竭：无法用坚毅起身", "力竭 2：atk −3 def −1", "力竭 3：击倒即死", "力竭致死"];

  /** 时钟：「21:40 🌙夜晚」；沙暴（漠汛）时沙漠生物按夜晚行动 */
  function clockHtml(min, opt) {
    opt = opt || {};
    const night = isNightClock(min);
    const icon = window.Icons && Icons.daynight ? Icons.daynight(night) : "";
    return `<span class="r-clock ${night ? "night" : "day"}">${icon}<b>${clockText(min)}</b> ${night ? "夜晚" : "白天"}${opt.days ? `<small>（+${opt.days} 天）</small>` : ""}</span>`;
  }
  /** 「醒来：05:40 ☀ 白天」 */
  const wakeHtml = (hours, label) => { const t = clockAfter(hours); return `${label || "醒来"} ${clockHtml(t.min, { days: t.days })}`; };
  function renderHeader() {
    const extra = run.act > C.acts ? "（额外）" : "";
    if (run.growth) {
      $("run-where").textContent = `长线养成 · ${Rogue.region(run)} · 队伍平均 ${Rogue.partyLevel(run)} 级`;
      $("run-day").innerHTML = `第 ${run.day} 天 · ${clockHtml(clockNow())} · 没有期限`;
    } else
    $("run-where").textContent = `第 ${run.act} 幕${extra} · ${Rogue.region(run)}`;
    const main = run.main;
    const mainText = !main ? "" : main.done ? " · 主线已完成" : ` · 主线需 ${main.days} 天`;
    if (!run.growth) $("run-day").innerHTML = `第 ${run.day} 天 · ${clockHtml(clockNow())} · 本幕剩 ${Rogue.daysLeft(run)}/${C.daysPerAct} 天${mainText}`;
    const s = Rogue.supplies();
    const hrs = Rogue.hoursAwake();
    const tier = exhaustTierFromHours(hrs);
    const foodTip = FOOD_ORDER.map(id => `${ITEM_CATALOG[id].name} ${s.food[id]}`).join(" · ");
    $("run-supplies").innerHTML =
      `<span>水 <b>${s.water}</b> ml</span><span title="${esc(foodTip)}">食物 <b>${s.foodTotal}</b></span>` +
      (online() ? `<span title="每名角色的钱各算各的">奎支 ${run.party.map(h => `${esc(Rogue.heroName(h.kit))} <b>${OnlineRogue.purse(h.kit)}</b>`).join(" · ")}</span>` : `<span>奎支 <b>${s.kuizhi}</b></span>`) +
      `<span class="${tier ? "warn" : ""}">距上次长休 <b>${hrs}</b> 小时${tier ? " · " + EXHAUST[tier] : ""}</span>` +
      `<button class="g-btn small" data-career="1" title="本局每个角色的输出占比和团队贡献">整局数据</button>` +
      (run.stage !== "over" && window.WorkshopUI && window.WorkshopData ? WorkshopUI.button(WorkshopData.workshopAvailable(run)) : "") +
      (run.stage !== "over" && window.BackpackUI ? BackpackUI.button() : "");
    const wsb = $("r-workshop"); if (wsb) wsb.onclick = () => openWorkshop();
    const bpb = $("r-backpack"); if (bpb) bpb.onclick = () => openBackpack();
    $("run-party").innerHTML = run.party.map(h => {
      const v = query("heroView", { kit: h.kit });
      return `<div class="rhero">
        <div class="rh-top"><b>${esc(v.name)}</b><span>Lv${v.level}${v.pending ? ' · <em>待选升级</em>' : ""}</span><button class="g-btn small rh-sheet" data-sheet="${esc(h.kit)}" data-sheet-src="run" title="数值、被动和技能说明">资料</button><button class="g-btn small rh-sheet" data-armory="${esc(h.kit)}" data-armory-src="run" title="武器补正、atk 明细、改装件和客制化">武器</button></div>
        ${v.race ? `<div class="rh-w rh-prof">${esc(v.race)} · ${esc(v.job)} · ${esc(Object.keys(v.profs).map(k => k + v.profs[k]).join(" "))}</div>` : ""}
        ${v.role2 ? `<div class="rh-w rh-solo">第二副职责 ${esc(v.role2)}${v.role2Skills.length ? "：" + esc(v.role2Skills.join("、")) : "（还没学技能）"}</div>` : ""}
        ${v.feats.length ? `<div class="rh-w rh-solo">专长：${esc(v.feats.join("、"))}</div>` : ""}
        ${v.pendingBreak ? `<div class="rh-w broken">检定受伤：下一场开战时受到 ${v.pendingBreak} 击破</div>` : ""}
        <div class="rh-row">血 ${bar(v.hp, v.hpMax, "hp")}<span>${v.hp}/${v.hpMax}</span></div>
        ${v.layers.length > 1 ? `<div class="rh-w">${esc(layerText(v.layers))}</div>` : ""}
        <div class="rh-row">经验 ${bar(v.xp, v.xpNext, "xp")}<span>${v.xp}/${v.xpNext || "满"}</span></div>
        ${v.weapons.map(w => `<div class="rh-w${w.dur <= 0 ? " broken" : ""}">${esc(w.name)} Lv${w.level} · 耐久 ${w.dur}/${w.durMax}${w.dur <= 0 ? "（损坏：进战斗空手）" : ""}${w.blueprint ? ` · 图纸「${esc(w.blueprint.name)}」${w.bpOff ? `（武器 ${BLUEPRINT_MIN_LEVEL} 级才生效）` : ""}` : ""}${(w.parts || []).some(Boolean) ? ` · 改装 ${esc(w.parts.filter(Boolean).map(p => p.name).join("、"))}` : ""}${w.hp != null ? ` · 伤势 ${w.hp <= 0 ? "倒下（需长休）" : "血量 " + w.hp}` : ""}</div>`).join("")}
      </div>`;
    }).join("") + (run.solo ? `<div class="rhero solo-mates"><div class="rh-top"><b>伙伴</b><span>支援存量 ${Number(run.supportBank) || 0} 次</span></div>
        <div class="rh-w rh-solo">${esc((run.partners || []).map(Rogue.heroName).join("、"))} · 战斗里攒分换支援：门槛 ${ROGUE_SOLO.supportScore} 分，手里每有 1 次 +${ROGUE_SOLO.supportStep}，最多存 ${ROGUE_SOLO.supportMax} 次；每人一场一次</div></div>` : "")
      + (run.fallen || []).map(f =>
      `<div class="rhero fallen"><div class="rh-top"><b>${esc(Rogue.heroName(f.kit))}</b><span>阵亡</span></div>
       <div class="rh-w">第 ${f.act} 幕第 ${f.day} 天 · ${esc(f.weapons.map(Rogue.heroName).join("、"))} 随之离队</div></div>`).join("");
  }

  /* ---------- 升级选择（手册第三章） ---------- */
  let lastLevelKey = "";
  /** 待选的升级：联机时只列房主自己操控的角色（别的角色由各自的玩家选） */
  function myPending() {
    const pend = Rogue.pendingChoices(run);
    return online() ? pend.filter(p => OnlineRogue.ownerOf(p.kit) === myId()) : pend;
  }
  function renderLevelUps() {
    const pend = myPending();
    if (!pend.length) { lastLevelKey = ""; return ""; }
    const p = pend[0];
    // 新出现的升级：响一声升级音效（同一项重画界面不重复响）
    const lvKey = p.kit + ":" + p.choice.level;
    if (lvKey !== lastLevelKey && window.Sfx) setTimeout(() => Sfx.ui("levelup"), 0);
    lastLevelKey = lvKey;
    const title = p.choice.type === "attr"
      ? `${p.name} ${p.choice.level} 级${p.choice.solo ? "（单人模式额外）" : ""}：分配 1 点六维属性${p.choice.noRepeat ? "（不能加在之前加过的同一项上）" : ""}`
      : p.choice.type === "role2"
        ? `${p.name} ${p.choice.level} 级（单人模式）：从第二副职责里再学一个技能`
      : p.choice.type === "prof"
        ? `${p.name} ${p.choice.level} 级：一个自选熟练项（新学一项，或把已有的一项升一级，最高三级）`
      : p.choice.type === "feat"
        ? `${p.name} ${p.choice.level} 级：选择一项专长（不限职责和属性，可以选这一级或更低级的）`
      : p.choice.type === "featFull"
        ? `${p.name} 兼修：选一张专长①–③的职责涉猎专长，改成原职责技能的完整版`
      : p.choice.type === "prof3"
        ? `${p.name} 万事通：选一项熟练项升到三级`
        : `${p.name} ${p.choice.level} 级：选择一项职责技能`;
    const opts = query("choiceOptions", { kit: p.kit, index: p.index });
    return `<section class="levelup">
      <h2>升级</h2>
      <p>${esc(title)}${pend.length > 1 ? `<span class="sub">还有 ${pend.length - 1} 项待选</span>` : ""}</p>
      <div class="r-choices">${opts.map((o, i) =>
        `<button class="g-btn" data-pick="${i}">${esc(o.label)}<small>${esc(o.hint || "")}</small></button>`).join("")}</div>
    </section>`;
  }

  const WX_NAME = { none: "常态", heat: "酷暑", snow: "雪天", acid: "酸雨", thunder: "雷鸣", glow: "微光", sand: "沙暴", phase: "相位" };

  /* ---------- 任务板 ---------- */
  function taskCard(t, which) {
    const why = Rogue.taskBlocked(run, t);
    const warn = !why && Rogue.taskWarning(run, t);
    const pay = Rogue.taskPay(run, t);
    const supplyText = [pay.water ? `${pay.water} ml 水` : "", ...Object.keys(pay.items).filter(id => pay.items[id]).map(id => `${ITEM_CATALOG[id].name}×${pay.items[id]}`)].filter(Boolean).join("、");
    return `<div class="task${t.key ? " key" : ""}">
      <div class="t-head"><b>${esc(t.name)}</b>${t.key ? '<span class="tag">主线 · 已接下</span>' : ""}<span class="days">${t.days} 天</span></div>
      <p>${esc(t.goal)}</p>
      <div class="t-meta">报酬 ${pay.kuizhi} 奎支 · 每人 ${pay.xp} 经验${t.part && WEAPON_PARTS[t.part] ? `<br>额外奖励：改装件 ${esc(weaponPartLabel(t.part))}（${esc(weaponPartText(t.part))}）` : ""}<br>委托方提供 ${esc(supplyText || "无")}</div>
      ${t.weather ? `<div class="t-weather">全程天气：${esc(WX_NAME[t.weather] || t.weather)}（任务里每一场战斗都是）</div>` : ""}
      ${escortLine(Rogue.escortInfo(run, t), false)}
      ${t.hunt ? `<div class="t-hunt">路线未知：一站一站往前走。通过 ${t.hunt.need} 次线索检定找到悬赏目标（失败 ${t.hunt.failMax} 次目标也会自己找上门），最后一站是和目标的精英战。</div>` : ""}
      ${warn ? `<div class="t-warn">${esc(warn)}</div>` : ""}
      <button class="g-btn r-go${t.key ? " r-main" : ""}" data-which="${which}" ${why ? "disabled" : ""}>${why ? esc(why) : t.key ? "执行主线" : "接下任务"}</button>
    </div>`;
  }
  /** 长线养成：角色抽取机 + 候补 */
  function renderGrowth() {
    if (!run.growth) return "";
    const d = query("drawInfo");
    const fusion = ITEM_CATALOG[ROGUE_GROWTH.fusionItem].name;
    const owned = d.pool.filter(p => p.owned).map(p => `${p.name} ${p.level} 级`).join("、");
    const full = run.party.length >= ROGUE_GROWTH.partyMax;
    const reserve = (run.reserve || []).map(h => {
      const name = Rogue.heroName(h.kit);
      const swaps = full
        ? run.party.map(p => `<button class="g-btn small" data-swap-in="${esc(h.kit)}" data-swap-out="${esc(p.kit)}">换下 ${esc(Rogue.heroName(p.kit))}</button>`).join("")
        : `<button class="g-btn small" data-swap-in="${esc(h.kit)}">上场</button>`;
      return `<div class="shop-row"><span class="s-name">${esc(name)}<small>${h.level || 1} 级</small></span><span class="s-have"></span><span class="s-price"></span><span>${swaps}</span></div>`;
    }).join("");
    const bench = run.party.length > 1
      ? `<p class="r-hint">队伍里的人也可以先换到候补：${run.party.map(p => `<button class="g-btn small" data-swap-out-only="${esc(p.kit)}">${esc(Rogue.heroName(p.kit))} 下场</button>`).join(" ")}</p>` : "";
    const daily = typeof Rogue.growthDaily === "function" ? Rogue.growthDaily(run) : null;
    const dailyHtml = daily ? `<h3>每日挑战</h3><div class="shop">${daily.tasks.map(t => `<div class="shop-row"><span class="s-name">${esc(t.name)}<small>${esc(t.desc)}</small></span><span class="s-have">${t.progress}/${t.target}</span><span class="s-price">${t.done ? "已完成" : ""}</span></div>`).join("")}</div><p class="r-hint">每个完成：随机材料 + 1000 奎支；三个全完成：额外 1 个${esc(fusion)} 和 1000 奎支。</p>` : "";
    return `<h2>角色抽取机</h2>
      <p class="r-hint">投入 ${d.cost} 个${esc(fusion)}抽一名角色（每名角色机会相同）：新角色加入队伍（满 ${ROGUE_GROWTH.partyMax} 人进候补），抽到已有的角色 +1 级（${ROGUE_GROWTH.maxLevel} 级封顶）。手里有 <b>${d.fusion}</b> 个。</p>
      <p class="r-hint">已有：${esc(owned)}</p>
      <button class="g-btn r-main" id="r-draw" ${d.canDraw ? "" : "disabled"}>${d.canDraw ? "抽一次" : esc(d.why)}</button>
      ${dailyHtml}
      ${reserve ? `<h3>候补</h3><div class="shop">${reserve}</div>` : ""}
      ${bench}`;
  }
  function renderBoard() {
    if (run.growth) {
      return `<h2>任务板</h2>
      <p class="r-hint">长线养成：独立存档，没有主线和期限。每天获得赫心融合体。角色永久死亡后清零等级移出队伍，下次抽到从 1 级重新培养。</p>
      <div class="task-list">${(run.board || []).map((t, i) => taskCard(t, i)).join("")}</div>
      ${renderGrowth()}
      ${renderSmiths()}`;
    }
    return `<h2>任务板</h2>
      <p class="r-hint">主线开幕就已接下，要在本幕天数用完之前完成，否则本局结束。本幕的天数用完时迎战首领；主线完成后剩下的日子可以继续做支线。支线只写了大致目标、时间、报酬和补给，天数够才能接。</p>
      <div class="task-list">${run.main && !run.main.done ? taskCard(run.main, "main") : ""}${(run.board || []).map((t, i) => taskCard(t, i)).join("")}</div>
      ${renderSmiths()}`;
  }

  /* ---------- 任务节点 ---------- */
  const nodeLabel = (n) => (ROGUE_NODE_TYPES[n.type] || {}).label || n.type;

  /** 武器耐久为 0 时的提醒：进战斗会空手。有维修工具包就当场给修理按钮 */
  function brokenWarn() {
    const list = Rogue.brokenWeapons(run);
    if (!list.length) return "";
    const who = list.map(w => w.owner === w.name ? w.name : `${w.owner} 的 ${w.name}`).join("、");
    const fix = repairPoints() ? "可以先用维修工具包修一下：" : "用维修工具包（商店有卖）或长休才能修好。";
    return `<p class="r-warn">⚠ ${esc(who)} 耐久为 0，这场战斗只能空手作战。${fix}</p>${repairRows()}`;
  }
  // 舌灿莲花（专长）：每个任务一次，谈掉一场普通战斗
  const parleyBtns = () => (Rogue.parleyOptions ? Rogue.parleyOptions(run) : []).map(o =>
    `<button class="g-btn" data-parley="${esc(o.kit)}">${esc(o.name)} 交涉（舌灿莲花 · 普通「${esc(o.prof)}」· 成功率 ${Math.round(o.chance * 100)}%）<small>成功就不用打，但没有掉落和经验；每个任务一次</small></button>`).join("");
  const fightBtn = (label) => Rogue.brokenWeapons(run).length
    ? `<button class="g-btn r-main" id="r-fight">仍然${label}（有人空手）</button>`
    : `<button class="g-btn r-main" id="r-fight">${label}</button>`;

  /** 长休要吃的食物：「罐头食品 2 份、流食 1 份（共 3 份食物）」 */
  function restFoodText(plan) {
    const ids = Object.keys((plan && plan.food) || {});
    const total = ids.reduce((a, id) => a + (Number(plan.food[id]) || 0), 0);
    const parts = ids.map(id => `${(ITEM_CATALOG[id] || {}).name || id} ${plan.food[id]} 份`);
    return ids.length > 1 ? `${parts.join("、")}（共 ${total} 份食物）` : (parts[0] || "0 份食物");
  }
  /** 长休界面：每个角色单独选吃哪种食物、用哪个睡眠道具（例如睡袋），下面汇总消耗和缺口 */
  function restPlanner() {
    const o = query("restOptions", restSel);
    if (!o.heroes.length) return "";
    const need = o.need;
    const rows = o.heroes.map(h => {
      const foods = o.foods.map(f => `<option value="${esc(f.id)}" ${f.id === h.foodId ? "selected" : ""}>${esc(f.name)}${f.shp ? (typeof shpHidden === "function" && shpHidden() ? "（多恢复坚毅）" : `（坚毅 +${f.shp}/份）`) : ""} · 有 ${f.have}</option>`).join("");
      const sleeps = `<option value="">不用</option>` + o.sleeps.map(x => `<option value="${esc(x.id)}" ${x.id === h.sleepId ? "selected" : ""}>${esc(x.name)}（${typeof shpHidden === "function" && shpHidden() ? "睡得更好，多恢复坚毅" : `每小时坚毅 +${x.bonus}`}） · 有 ${x.have}</option>`).join("");
      // 兽人-蜥蜴：长休时可以换吐酸攻击的属性
      const spit = h.spit ? `<br><small>吐酸</small> <select data-rest-spit="${esc(h.kit)}">${(o.spitElements || []).map(e => `<option value="${esc(e.id)}" ${e.id === h.spit ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select>` : "";
      // 龙哥 胶囊弹药+：排下一场开局的弹序
      const ammo = h.ammo != null ? `<br><small>下一场弹序</small> <select data-rest-ammo="${esc(h.kit)}">${(o.ammoOrders || []).map(e => `<option value="${esc(e.id)}" ${e.id === h.ammo ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select>` : "";
      return `<tr><td><b>${esc(h.name)}</b></td><td>${h.water} ml · ${h.food} 份</td>
        <td><select data-rest-food="${esc(h.kit)}">${foods}</select></td>
        <td><select data-rest-sleep="${esc(h.kit)}">${sleeps}</select>${spit}${ammo}</td></tr>`;
    }).join("");
    const bad = (a, b) => (a > b ? "r-bad" : "");
    const foodSum = Object.keys(need.food).map(id => {
      const f = o.foods.find(x => x.id === id) || { name: id, have: 0 };
      return `${esc(f.name)} <b class="${bad(need.food[id], f.have)}">${need.food[id]}</b>/${f.have}`;
    }).join(" · ");
    const sleepSum = Object.keys(need.sleep).map(id => {
      const x = o.sleeps.find(y => y.id === id) || { name: id, have: 0 };
      return `${esc(x.name)} <b class="${bad(need.sleep[id], x.have)}">${need.sleep[id]}</b>/${x.have}`;
    }).join(" · ");
    return `<div class="r-restplan"><h3 class="r-sub">长休安排</h3>
      <table><tr><th>角色</th><th>需要</th><th>吃</th><th>睡眠道具</th></tr>${rows}</table>
      <p class="r-hint">消耗：水 <b class="${bad(need.water, o.water)}">${need.water}</b>/${o.water} ml · ${foodSum}${sleepSum ? ` · ${sleepSum}（不消耗）` : ""}
        ${need.ok ? "" : `<br><span class="r-bad">不够：${esc(need.lack.join("，"))}</span>`}</p></div>`;
  }
  const NODE_PANELS = {
    battle: () => `<p>前方有敌人拦路。</p>${brokenWarn()}${fightBtn("迎战")}${parleyBtns()}`,
    elite: () => `<p>前方有棘手的敌人。</p>${brokenWarn()}${fightBtn("迎战")}`,
    rest: () => {
      if (run.ambush) {
        return `<p class="r-warn">⚠ 长休时被偷袭了！还没来得及恢复，敌人就摸了上来。</p>
          <p class="r-hint">遭遇战：敌人 3 枚代币、来自各地；我方跳过第一回合；这场分数 ×2（和速杀、无伤加算）；
            胜利后每人额外 ${C.ambush.xpPerLevel} × 敌人等级 经验，然后照常长休。撤退则这次不休息、直接离开。</p>
          ${brokenWarn()}${fightBtn("迎击")}`;
      }
      const plan = query("restPlan", restSel);
      const food = restFoodText(plan);
      const chance = Math.round(Rogue.ambushChance(run) * 100);
      const shortCan = query("canShortRestAtNode");
      const watchOpts = query("watchOptions").map(w =>
        `<option value="${esc(w.kit)}">${esc(w.weapon ? `${w.name}（${w.owner} 的武器人）` : w.name)}</option>`).join("");
      return `<p>找到一处能歇脚的地方。</p>
        <p class="r-hint">长休时有 <b id="r-ambush-chance">${chance}%</b> 的概率被偷袭（遭遇战）。没被偷袭，下次 +${Math.round(C.ambush.step * 100)}%；被偷袭后回到 ${Math.round(C.ambush.base * 100)}%。
          安排一人守夜就一定不会被偷袭，但守夜的人这次长休不恢复，短休次数和「长休一次」的技能也不刷新。</p>
        ${restPlanner()}
        <label class="r-watch">守夜：<select id="r-watch"><option value="">不安排守夜</option>${watchOpts}</select></label>
        <div class="r-choices">
          <button class="g-btn r-main" id="r-long" ${plan.ok ? "" : "disabled"}>长休 ${C.hours.longRest} 小时
            <small>${wakeHtml(C.hours.longRest)} · ${plan.ok ? `消耗 ${plan.water} ml 水、${esc(food)}` : "补给不足：" + esc(plan.lack.join("，"))} · 血量回满、耐久回满、武器人痊愈、清空力竭</small></button>
          <button class="g-btn" id="r-short" ${shortCan.ok ? "" : "disabled"}>短休 ${C.hours.shortRest} 小时<small>${shortCan.ok ? "" : esc(shortCan.why) + " · "}${wakeHtml(C.hours.shortRest, "休息到")} · 不消耗补给 · 每人回复 等级×2+体质 · 一天两次</small></button>
          <button class="g-btn" id="r-rest-skip">不休息，直接离开<small>获得 ${C.restSkipKuizhi} 奎支 · 不花时间</small></button>
        </div>`;
    },
    shop: () => `<p>路边有个摊子。手里有 ${money()} 奎支。</p>
        ${shopTabs()}
        <button class="g-btn r-main" id="r-leave">离开</button>`,
    smith: () => {
      const id = query("presentSmiths")[0];
      return `<p>一位工匠愿意帮你改武器。手里有 ${money()} 奎支。</p>
        ${smithCard(id, true)}
        ${installRows(id)}
        ${partRows(id)}
        ${repairRows()}
        <button class="g-btn r-main" id="r-leave">离开</button>`;
    },
    clinic: () => `<p>一家小诊所。手里有 ${money()} 奎支。</p>
        ${clinicPanel()}
        <button class="g-btn r-main" id="r-leave">离开</button>`,
    check: () => checkPanel()
  };

  /* ---------- 工坊 / 背包：按钮打开的浮层（workshop-ui.js、backpack-ui.js；数据见 workshop-data-adapter.js） ---------- */
  function workshopModel() {
    if (!run || !window.WorkshopData) return null;
    const net = online();
    const m = WorkshopData.hostWorkshopModel(run, { net, kits: net ? OnlineRogue.hostKits() : null,
      money: kit => (net ? OnlineRogue.purse(kit) : Rogue.supplies().kuizhi) });
    return Object.assign(m, { error: lastError, note: lastNotes[lastNotes.length - 1] || "" });
  }
  function openWorkshop(mat) {
    if (!window.WorkshopUI) return;
    WorkshopUI.open(workshopModel, cmd => act(cmd), { mat: mat || "" });
  }
  function backpackModel() {
    if (!run || !window.WorkshopData) return null;
    return WorkshopData.hostBackpackModel(run, { kits: online() ? OnlineRogue.hostKits() : null });
  }
  function openBackpack() {
    if (window.BackpackUI) BackpackUI.open(backpackModel, { openWorkshop: id => openWorkshop(id) });
  }

  /* ---------- 诊所 · 义体：按钮打开的浮层（cyberware-ui.js；数据 Rogue.cyberwareClinic = cyberware.js · cyberwarePacket） ---------- */
  function cyberwareModel() {
    if (!run || !window.CyberwareUI || !Rogue.canClinic(run)) return null;
    return CyberwareUI.localModel({ heroes: run.party.map(h => ({ kit: h.kit, name: Rogue.heroName(h.kit) })),
      packetOf: kit => query("cyberware", { kit }),
      previewOf: (kit, id) => { try { return query("cyberwarePreview", { kit, id }); } catch (e) { return null; } },
      money: () => money(), error: lastError, note: lastNotes[lastNotes.length - 1] || "" });
  }
  function openCyberware(kit) {
    if (window.CyberwareUI) CyberwareUI.open(cyberwareModel, cmd => act(cmd), { kit });
  }

  /* ---------- 熟练项检定（事件内容占位） ---------- */
  const LV_TEXT = ["没有熟练", "一级熟练", "二级熟练", "三级熟练"];
  const pctText = (p) => `${Math.round(p * 1000) / 10}%`;
  function checkPanel() {
    const c = query("checkInfo");
    if (!c) return "";
    const opts = c.options && c.options.length ? c.options : [{ diff: c.diff, prof: c.prof, reward: c.reward, diffName: c.diffName }];
    // 每一种熟练项 × 每个人的成功率；最高的那个按钮高亮
    const table = opts.map((x, i) => ({ x, i, odds: run.party.map(h => query("checkOdds", { kit: h.kit, opt: i })) }));
    let best = null;
    table.forEach(t => t.odds.forEach(o => { if (o.chance > 0 && (!best || o.chance > best.chance)) best = o; }));
    const hurt = c.injure
      ? `<p class="r-warn">⚠ 有风险：失败时检定者受到 ${c.dmg[0]}–${c.dmg[1]} 点随机属性伤害（按克制表结算，不致死），下一场战斗开始时再受 ${c.brk} 击破。</p>`
      : `<p class="r-hint">失败没有损失。</p>`;
    const button = (o) => {
      const tags = [o.adv ? "优势" : "", o.dis ? "劣势" : "", o.reroll ? "可重掷" : ""].filter(Boolean).join(" · ");
      const can = o.chance > 0;
      return `<button class="g-btn${best && o.kit === best.kit && o.opt === best.opt && can ? " r-main" : ""}" data-check="${esc(o.kit)}" data-opt="${o.opt}" ${can ? "" : "disabled"}>
        ${esc(o.name)} · ${LV_TEXT[o.level]}
        <small>${can ? `成功率 ${pctText(o.chance)}` : "没有资格尝试"}${tags ? " · " + esc(tags) : ""} · 血 ${o.hp}/${o.hpMax}</small></button>`;
    };
    const multi = opts.length > 1;
    const groups = table.map(t => `${multi ? `<p class="r-sub-check"><b>${esc(t.x.diffName)}</b>「${esc(t.x.prof)}」检定 · 成功奖励 ${t.x.reward} 奎支</p>` : ""}
      <div class="r-choices">${t.odds.map(button).join("")}</div>`).join("");
    const huntNote = run.task && run.task.hunt ? `<p class="r-hint">悬赏线索检定：下面三种熟练项任选一种，用哪种成功都算找到一条线索（难度和奖励各不相同）；失败或绕过去都算没找到，下一次换别的熟练项。</p>` : "";
    const head = multi ? `<p>【事件占位】前方需要一次检定，可以从三种方式里选一种。</p>`
      : `<p>【事件占位】前方需要一次<b>${esc(c.diffName)}</b>的「${esc(c.prof)}」检定。</p>`;
    return `${head}${huntNote}
      <p class="r-hint">${multi ? "" : `成功奖励 ${c.reward} 奎支${c.injure ? `（含风险加成 ${ROGUE_CHECKS.injure.bonus}）` : ""}。`}简单检定谁都能试；普通及以上没有这项熟练就不能尝试（手册第一章）。选一个人去做：</p>
      ${hurt}
      ${groups}
      <div class="r-choices r-check-skip">
        <button class="g-btn" id="r-check-skip">不冒险，绕过去<small>没有奖励 · 花 ${ROGUE_NODE_TYPES.check.hours} 小时</small></button>
      </div>`;
  }

  /* ---------- 诊所：治疗与义体改造（诊所节点与休整时共用） ---------- */
  const layerText = (ls) => ls.map(l => `${LAYER[l.type] || l.type} ${l.current != null ? l.current + "/" : ""}${l.max}`).join(" · ");
  function clinicPanel() {
    return `<div class="clinic">${run.party.map(h => {
      const v = query("heroView", { kit: h.kit });
      const info = query("cyberInfo", { kit: h.kit });
      const cur = info.current;
      const heal = query("healCost", { kit: h.kit });
      const input = (t, label) => `<label>${label}<input type="number" min="0" max="${info.limit}" step="1" value="${cur[t]}" data-cy="${esc(h.kit)}" data-t="${t}"></label>`;
      return `<div class="cl-hero">
        <div class="cl-head"><b>${esc(v.name)}</b><span>${esc(layerText(v.layers))}</span></div>
        <button class="g-btn" data-heal="${esc(h.kit)}" ${heal ? "" : "disabled"}>${heal ? `治疗（${heal} 奎支）` : "不需要治疗"}</button>
        ${window.CyberwareUI ? CyberwareUI.button(h.kit) : ""}
        <div class="cl-cyber">
          <div class="r-hint">义体改造：改造率 ${Math.round(info.rate * 100)}%，最多换掉 ${info.limit} 点肉体（共 ${info.fleshMax}）。
            换算 肉体 8 : 装甲 7 : 护盾 6 : 沙尘 6；也可以把剩下的肉体按 8 : 7 全部换成星灵。最多 3 种血量。</div>
          <div class="cl-inputs">${input("armor", "→ 装甲")}${input("shield", "→ 护盾")}${input("sand", "→ 沙尘")}
            <label class="cl-spirit"><input type="checkbox" data-cy="${esc(h.kit)}" data-t="spirit" ${cur.spirit ? "checked" : ""}> 内层换成星灵</label></div>
          <div class="cl-preview" id="cy-pv-${esc(h.kit)}"></div>
          <button class="g-btn" data-cyber="${esc(h.kit)}">改造</button>
        </div>
      </div>`;
    }).join("")}</div>`;
  }
  function readPlan(kit) {
    const plan = {};
    document.querySelectorAll(`[data-cy="${kit}"]`).forEach(el => {
      plan[el.dataset.t] = el.type === "checkbox" ? el.checked : Math.max(0, Math.floor(Number(el.value) || 0));
    });
    return plan;
  }
  function showCyberPreview(kit) {
    const box = document.getElementById("cy-pv-" + kit);
    if (!box) return;
    const pv = query("cyberPreview", { kit, plan: readPlan(kit) });
    const btn = document.querySelector(`[data-cyber="${kit}"]`);
    if (pv.error) {
      box.innerHTML = `<span class="bad">${esc(pv.error)}</span>`;
      if (btn) btn.disabled = true;
      return;
    }
    const cash = money();
    box.innerHTML = `改造后（外 → 内）：${esc(layerText(pv.layers))} · 费用 <b>${pv.cost}</b> 奎支` +
      (pv.cost && cash < pv.cost ? ' <span class="bad">奎支不够</span>' : "");
    if (btn) btn.disabled = !pv.cost || cash < pv.cost;
  }
  /** 商店货架（商店节点与休整时共用） */
  function shopList() {
    const s = Rogue.supplies();
    return `<p class="r-hint">水和食物每家都有，其余商品每家店随机进 ${ROGUE_SHOP_RULES.randomCount} 种。</p><div class="shop">${query("shopStock").map(r => {
      const item = r.give.item && ITEM_CATALOG[r.give.item];
      const have = r.give.item ? bagCount(r.give.item) : null;
      return `<div class="shop-row"><span class="s-name">${esc(Rogue.shopItemName(r))}<small>${esc(item ? item.hint || "" : "")}</small></span>
        <span class="s-have">${have != null ? "有 " + have : ""}</span>
        <span class="s-price">${r.price}</span>
        <button class="g-btn" data-buy="${esc(r.key)}" ${money() < r.price ? "disabled" : ""}>买</button></div>`;
    }).join("")}</div>${redeemList()}`;
  }
  /* ---------- 商店 · 买 / 卖页签（shop-sell-ui.js；规则在 rogue.js · shopSellView / sellItem / buybackItem） ---------- */
  function sellView() {
    // 联机房主可能操控好几名角色：他们名下的东西和回购单都要列出来
    try { return online() ? Rogue.shopSellView(run, { kits: OnlineRogue.hostKits() }) : query("shopSell", {}); } catch (_) { return null; }
  }
  function sellModel() {
    const heroes = run.party.filter(h => !h.dead).map(h => ({ kit: h.kit, name: Rogue.heroName(h.kit), purse: online() ? OnlineRogue.purse(h.kit) : null }));
    const mine = online() ? (k => OnlineRogue.hostKits().includes(k)) : null;
    // 单机：东西都是公用的，钱进奎支（卖的人记成 "party"）
    return ShopSellUI.model(sellView(), { key: "run", heroes, mine, actor: online() ? hostPayer() : "party", canAct: online() ? null : () => true,
      money: k => online() ? OnlineRogue.purse(k) : money() });
  }
  function shopTabs() {
    const buy = () => `${shopList()}${partRows(null)}${repairRows()}`;
    if (!window.ShopSellUI) return buy();
    const v = sellView();
    ShopSellUI.sync("run", !!v);
    const sell = ShopSellUI.tabOf("run") === "sell";
    return `<div class="ss-host" data-ss-host="run">${ShopSellUI.tabsHtml("run", { sellOff: !v })}${sell ? ShopSellUI.html(sellModel()) : buy()}</div>`;
  }
  /** 卖 / 买回：run {action:"sellItem"|"buybackItem"}（rogue.js · sellItem / buybackItem，失败会抛错）；提示钱进了谁的钱包 */
  function sellAct(cmd) {
    let res, error;
    try {
      if (online()) OnlineRogue.checkHost(cmd);
      res = dispatch(Object.assign({ type: "run" }, cmd), { run });
      if (window.Sfx) Sfx.ui("coin");
    } catch (e) { error = e; }
    const text = res && typeof res === "object" && !Array.isArray(res) ? ShopSellUI.toastText(res, k => k === "party" ? "队伍" : Rogue.heroName(k)) : "";
    completeAction(text ? [text] : Array.isArray(res) ? res : [], error);
    if (text) ShopSellUI.toast(text);
    else if (error) ShopSellUI.toast(`没做成：${error.message}`);
  }
  /** 商店积分：每花 ROGUE_SHOP_POINTS.per 奎支得 1 分，兑换自我效果道具（联机时是房主自己的积分） */
  function redeemList() {
    const pts = online() ? (() => { const kit = hostPayer(); if (!kit) return null; run._pointsPayer = kit; try { return Rogue.shopPoints(run); } finally { delete run._pointsPayer; } })() : query("shopPoints");
    if (!pts) return "";
    const list = Rogue.redeemList();
    return `<h4 class="r-sub">积分兑换 · 现有 <b>${pts.points}</b> 积分（每花 ${pts.per} 奎支得 1 分，再花 ${pts.next} 得下一分）</h4><div class="shop">${list.map(it => `<div class="shop-row"><span class="s-name">${esc(it.name)}<small>${esc(it.hint)}</small></span>
        <span class="s-have">有 ${bagCount(it.id)}</span><span class="s-price">${it.points} 分</span>
        <button class="g-btn" data-redeem="${esc(it.id)}" ${pts.points < it.points ? "disabled" : ""}>兑换</button></div>`).join("")}</div>`;
  }
  /* ---------- 工匠：升级、图纸（任务板上随机来几位，任务里也可能遇到一位） ---------- */
  function smithCard(id, open) {
    const info = query("smithInfo", { smith: id });
    if (!info) return "";
    const k = money();
    const progress = info.claimed
      ? `已领图纸「${esc(Rogue.blueprintById(info.claimed).name)}」`
      : info.canClaim ? "可以领一张图纸" : `在他这里升级 ${info.uses}/${info.need} 次可领图纸`;
    const rows = info.needsIntro
      ? `<p class="r-hint">他不帮陌生人强化武器。</p><button class="g-btn" data-intro="${esc(id)}">给他看看你的武器</button>`
      : Rogue.smithOptions(run, id).map(o =>
      `<div class="shop-row"><span class="s-name">${esc(o.name)}<small>现在 ${o.level} 级${o.hours ? ` · 要帮忙 ${o.hours} 小时` : ""}${o.mats && !o.max ? ` · 材料 ${esc(o.mats.map(m => `${m.name} ${m.have}/${m.need}`).join("、"))}` : ""}</small></span>
        <span class="s-have"></span>
        <span class="s-price">${o.max ? "满级" : o.cost}</span>
        <button class="g-btn" data-upgrade="${esc(o.kit)}" data-smith="${esc(id)}" ${o.max || k < o.cost || (o.mats && !o.enough) ? "disabled" : ""}>升到 ${o.level + 1} 级</button></div>`).join("");
    const claim = info.canClaim ? `<p class="r-hint">${esc(info.name)} 愿意把自己的客制化图纸给你一张（只能挑一张）：</p>
      <div class="r-choices">${info.blueprints.map(b =>
        `<button class="g-btn" data-claim="${esc(b.id)}" data-smith="${esc(id)}">${esc(b.name)}<small>${esc(b.text)}</small></button>`).join("")}</div>` : "";
    return `<details class="smith"${open || info.canClaim ? " open" : ""}>
      <summary><b>${esc(info.name)}</b><span class="sm-prog${info.canClaim ? " ready" : ""}">${progress}</span></summary>
      <p class="sm-lore">${esc(info.blurb)}${info.priceNote ? `<br><span class="sm-price">${esc(info.priceNote)}</span>` : ""}</p>
      ${claim}
      <div class="shop">${rows}</div>
      ${partShelf(id)}
    </details>`;
  }
  /** 手里的图纸装到武器上（任何一位工匠都能装） */
  function installRows(smithId) {
    const bps = run.blueprints || [];
    if (!bps.length || !smithId) return "";
    if (!query("smithInfo", { smith: smithId }).canInstall) return `<p class="r-hint">手里有图纸，但 ${esc(query("smithInfo", { smith: smithId }).name)} 装不了，去找别的武器工匠。</p>`;
    const cost = ROGUE_SMITH_RULES.installCost;
    const k = money();
    const weapons = run.party.flatMap(h => query("heroView", { kit: h.kit }).weapons);
    const short = k < cost ? `<b class="bad">现在手里 ${k}，还差 ${cost - k} 奎支。</b>` : "";
    const minLv = BLUEPRINT_MIN_LEVEL;
    return `<p class="r-hint">手里的图纸：装一张 ${cost} 奎支，一把武器只能装一张（装新的会替换旧的）。武器 ${minLv} 级才解锁客制化。${short}</p>
      ${bps.map(id => {
        const b = Rogue.blueprintById(id);
        return `<div class="bp-row"><span class="s-name">${esc(b.name)}<small>${esc(b.text)} · 来自 ${esc(b.smithName)}</small></span>
          <div class="r-choices">${weapons.map(w => w.level < minLv
            ? `<button class="g-btn" disabled>装到 ${esc(w.name)}<small>武器 ${minLv} 级才解锁客制化（现在 ${w.level} 级）</small></button>`
            : `<button class="g-btn" data-install="${esc(id)}" data-kit="${esc(w.kit)}" data-smith="${esc(smithId)}">装到 ${esc(w.name)}${w.blueprint ? `<small>替换「${esc(w.blueprint.name)}」</small>` : ""}</button>`).join("")}</div></div>`;
      }).join("")}`;
  }
  function renderSmiths() {
    const ids = run.smiths || [];
    if (!ids.length) return "";
    return `<h2>工匠</h2>
      <p class="r-hint">这次回城遇到 ${ids.length} 位工匠。手里有 ${money()} 奎支。在同一位工匠那里升级满 ${ROGUE_SMITH_RULES.blueprintAfter} 次，他会给你一张客制化图纸。</p>
      ${ids.map(id => smithCard(id, false)).join("")}
      ${installRows(ids.find(id => query("smithInfo", { smith: id }).canInstall) || ids[0])}
      ${partRows(ids[0])}`;
  }

  /* ---------- 改装件（C / B 级）：工匠货架、背包里的件（卖 / 装）、武器上的件（拆） ----------
   * smithId 为空：只是商店，只能卖 */
  /** 一位工匠摆出来卖的 3 件改装件（放在他的卡片里） */
  function partShelf(smithId) {
    if (typeof ROGUE_PARTS === "undefined") return "";
    const k = money();
    const rows = query("partOffers", { smith: smithId }).map((o, i) => `<div class="shop-row${o.sold ? " sold" : ""}">
        <span class="s-name">${esc(weaponPartLabel(o.id))}<small>${esc(weaponPartText(o.id))}${o.discount ? ` · <b class="pt-sale">八折</b>（原价 ${o.base}）` : ""}</small></span>
        <span class="s-have"></span><span class="s-price">${o.sold ? "—" : o.price}</span>
        <button class="g-btn" data-part-buy="${i}" data-smith="${esc(smithId)}" ${o.sold || k < o.price ? "disabled" : ""}>${o.sold ? "已买" : "买"}</button></div>`).join("");
    return rows ? `<p class="r-hint">改装件（随机进货，C 级 / B 级）：</p><div class="shop">${rows}</div>` : "";
  }
  /** 改装件装前 → 装后：ATK、格挡率、武器人血量、补正（只显示有变化的） */
  function modCompareHtml(hero, weapon, partId, slot) {
    const p = window.WorkshopData ? WorkshopData.modInstallPreview(run, hero, weapon, weaponPartIdOf(partId), slot) : null;
    return modCompareText(p);
  }
  const weaponPartIdOf = id => String(id || "").replace(/^part_/, "");
  function modCompareText(p) {
    if (!p) return "";
    const arrow = (label, a, b, unit) => a === b ? "" : `<span class="${b > a ? "up" : "down"}">${label} ${a}${unit || ""} → ${b}${unit || ""}</span>`;
    const coefs = Object.keys(Object.assign({}, p.before.coefs, p.after.coefs)).map(a => arrow(`${(typeof WEAPON_PART_ATTR_CN !== "undefined" && WEAPON_PART_ATTR_CN[a]) || a}补正`,
      Number(p.before.coefs[a]) || 0, Number(p.after.coefs[a]) || 0)).filter(Boolean);
    const parts = [arrow("ATK", p.before.atk, p.after.atk), arrow("格挡率", p.before.block, p.after.block, "%"),
      p.delta && p.delta.hp ? `<span class="${p.delta.hp > 0 ? "up" : "down"}">武器人血量 ${p.delta.hp > 0 ? "+" : ""}${p.delta.hp}</span>` : ""].concat(coefs).filter(Boolean);
    return `装上后：${parts.join(" · ") || "数值不变"}${p.replaced ? `（换下 ${esc(typeof weaponPartLabel === "function" ? weaponPartLabel(p.replaced) : p.replaced)}）` : ""}`;
  }
  window.ModCompare = { text: modCompareText };
  function partRows(smithId) {
    if (typeof ROGUE_PARTS === "undefined") return "";
    const k = money();
    const P = ROGUE_PARTS;
    const stock = query("partStock");
    const weapons = run.party.flatMap(h => query("heroView", { kit: h.kit }).weapons.map(w => Object.assign({ hero: h.kit }, w)));
    const targets = weapons.flatMap(w => (w.parts || []).map((p, i) => ({ v: `${w.kit}:${i}`, hero: w.hero, kit: w.kit, slot: i, t: `${w.name} 槽${i + 1}${p ? `（换下 ${p.name}）` : "（空）"}` })));
    // 还没有改装槽的武器也列出来（灰掉，写明几级开放），免得只看到一个选项不知道其他武器去哪了
    const locked = weapons.filter(w => !(w.parts || []).length)
      .map(w => `<option disabled>${esc(w.name)} · Lv${w.level || 1}（${WEAPON_PART_SLOT_LEVELS[0]} 级开放改装槽）</option>`).join("");
    const opts = targets.map(x => `<option value="${esc(x.v)}" data-hero="${esc(x.hero)}">${esc(x.t)}</option>`).join("") + locked;
    // 装前 / 装后对比：只算当前选中的那个槽（rogue.js · modInstallPreview）
    const cmp = (partId) => smithId && targets.length ? `<span class="pt-cmp" data-pt-cmp="${esc(partId)}">${modCompareHtml(targets[0].hero, targets[0].kit, partId, targets[0].slot)}</span>` : "";
    const bag = stock.map(x => `<div class="shop-row${smithId && targets.length ? " pt-row" : ""}">
        <span class="s-name">${esc(x.name)}<small>${esc(x.text)}</small></span>
        <span class="s-have">有 ${x.qty}</span><span class="s-price">卖 ${x.sell}</span>
        <button class="g-btn" data-part-sell="${esc(x.id)}">卖掉</button>
        ${smithId && targets.length ? `<select data-part-to="${esc(x.id)}">${opts}</select>
          <button class="g-btn" data-part-install="${esc(x.id)}" data-smith="${esc(smithId)}" ${k < x.install ? "disabled" : ""}>装上（${x.install}）</button>${cmp(x.id)}` : ""}</div>`).join("");
    const fitted = smithId ? weapons.flatMap(w => (w.parts || []).map((p, i) => p ? `<div class="shop-row">
        <span class="s-name">${esc(w.name)} 槽${i + 1}：${esc(p.name)}<small>${esc(p.text)}</small></span>
        <span class="s-have"></span><span class="s-price">免费</span>
        <button class="g-btn" data-part-remove="${esc(w.kit)}:${i}" data-smith="${esc(smithId)}">拆下</button></div>` : "")).join("") : "";
    if (!bag && !fitted) return "";
    const slotsHint = targets.length ? "" : `武器升到 ${WEAPON_PART_SLOT_LEVELS[0]} 级才有改装槽（${WEAPON_PART_SLOT_LEVELS.join(" / ")} 级各开 1 个）。`;
    return `<h3 class="r-sub">改装件</h3>
      <p class="r-hint">C 级主补正 +0.1 / 负补正 −0.1，B 级 ±0.15。${smithId ? `工匠装上：C ${P.install.C}、B ${P.install.B} 奎支，拆下不要钱。` : ""}卖出按原价 ${Math.round(P.sellRate * 100)}%。${slotsHint}</p>
      ${bag ? `<p class="r-hint">背包里的改装件：</p><div class="shop">${bag}</div>` : ""}
      ${fitted ? `<p class="r-hint">武器上的改装件：</p><div class="shop">${fitted}</div>` : ""}`;
  }

  /** 维修工具包（一包 10 点维修量，修几点用几点），有的话在商店、工匠处、休整时都能用 */
  function repairRows() {
    const pts = repairPoints();
    if (!pts) return "";
    const rows = run.party.map(h => query("heroView", { kit: h.kit })).flatMap(v => v.weapons)
      .filter(w => w.dur < w.durMax)
      .map(w => `<button class="g-btn" data-repair="${esc(w.kit)}">修 ${esc(w.name)}（${w.dur}/${w.durMax}）<small>用 ${Math.min(pts, w.durMax - w.dur)} 点</small></button>`);
    return rows.length ? `<p class="r-hint">${esc(repairPointsText())}：修几点耐久用几点，用不完的留着下次用。</p><div class="r-choices">${rows.join("")}</div>` : "";
  }

  /** 进下一站 / 首领战之前：可以短休（按今天的短休次数）。长休只能在任务的休息点 */
  function restBeforeRow() {
    const sh = query("canShortRestBefore");
    const left = (sh.who || []).map(x => `${x.name} ${x.left}`).join("、");
    const shortBtn = `<button class="g-btn" id="r-short-before" ${sh.ok ? "" : "disabled"}>短休 ${C.hours.shortRest} 小时
        <small>${sh.ok ? `${wakeHtml(C.hours.shortRest, "休息到")} · 不消耗补给 · 每人回复 等级×2+体质 · 今天还能短休：${esc(left)}` : esc(sh.why || "")}</small></button>`;
    return `<div class="rest-before">${shortBtn}</div>`;
  }

  /** 路线图：旧存档里进行中的任务没有 cols，按单线画 */
  function routeMapHtml(t) {
    if (typeof RouteMap === "undefined") return "";
    const cols = t.cols || t.nodes.map(n => [n ? n.type : "battle"]);
    const pick = t.pick || cols.map(() => 0);
    const labels = {};
    Object.keys(ROGUE_NODE_TYPES).forEach(k => { labels[k] = ROGUE_NODE_TYPES[k].label; });
    return RouteMap.html({
      region: Rogue.region(run), title: `${t.key ? "主线" : t.name}路线图`,
      cols, nodes: t.nodes, pick, index: t.index, labels, eta: Rogue.routeEta(run),
      choices: Rogue.nodeChoices(run).map(o => o.i), links: Rogue.routeLinks,
      seed: `${run.seed}:map:${run.taskNo}`
    });
  }
  /** 护送对象：任务板上说明是什么；任务里显示剩多少血 */
  function escortLine(e, live) {
    if (!e) return "";
    const pct = Math.round(e.hp / Math.max(1, e.max) * 100);
    const rules = `被摧毁任务失败；剩余 ≥ ${Math.round(ESCORT_RULES.intactRatio * 100)}% 完好送达，额外报酬 +${Math.round(ESCORT_RULES.intactBonus * 100)}%`;
    return `<div class="t-escort${live && !e.intact ? " warn" : ""}">护送：<b>${esc(e.name)}</b>（${e.kind === "cart" ? "货车" : "人物"} · ${esc(e.note)}）
      · ${live ? `血量 <b>${e.hp}/${e.max}</b>（${pct}%）${e.intact ? " · 完好" : " · 已不算完好"}` : `血量 ${e.max}${e.atk ? ` · atk ${e.atk}` : ""}`}<br><small>${esc(rules)}</small></div>`;
  }
  /** 悬赏：线索进度 / 已经找到的目标 */
  function huntLine(t) {
    const h = t && t.hunt;
    if (!h || h.found == null) return "";
    if (h.located && h.target) return `<div class="t-hunt found">已找到悬赏目标：<b>${esc(h.target.name)}</b>（血量、atk ×1.5，多占 1 枚代币）。击败它完成任务；从这一战撤退目标会逃走，任务失败。</div>`;
    const pips = (n, max, cls) => Array.from({ length: max }, (_, i) => `<i class="${i < n ? cls : ""}"></i>`).join("");
    return `<div class="t-hunt">线索 <span class="hunt-pips">${pips(h.found, h.need, "ok")}</span> ${h.found}/${h.need}
      · 失败 <span class="hunt-pips">${pips(h.fails, h.failMax, "bad")}</span> ${h.fails}/${h.failMax}
      <small>路线一站一站显示：线索检定之间夹着一站别的。失败 ${h.failMax} 次目标也会自己找上门。</small></div>`;
  }
  function renderTask() {
    const t = run.task;
    const node = Rogue.currentNode(run);
    const choices = Rogue.nodeChoices(run);
    const choose = !node && choices.length
      ? `<div class="rm-choose"><b>选择下一站：</b>点地图上发光的节点，或者${choices.map(o =>
          `<button class="g-btn" data-route="${o.i}">${esc(nodeLabel({ type: o.type }))}</button>`).join("")}</div>`
      : "";
    const panel = node && NODE_PANELS[node.type] ? NODE_PANELS[node.type]() : "";
    const restRow = node && node.type !== "rest" ? restBeforeRow() : "";
    const wx = t.weather ? `<span class="t-weather inline">全程天气：${esc(WX_NAME[t.weather] || t.weather)}</span>` : "";
    return `<h2>${esc(t.key ? "主线" : t.name)}<span class="sub">${esc(t.goal)}</span>${wx}</h2>
      ${escortLine(query("escortInfo"), true)}
      ${huntLine(t)}
      ${routeMapHtml(t)}
      <div class="r-panel">${choose}${restRow}${panel}</div>`;
  }

  function renderStage() {
    switch (run.stage) {
      case "board": return renderBoard();
      case "task": return renderTask();
      case "camp": {
        const plan = query("restPlan", restSel);
        const shopping = C.campShop ? `<p class="r-hint">回到城里，出发前可以补货。手里有 ${money()} 奎支。</p>${shopTabs()}` : "";
        const clinic = C.campClinic ? `<h3 class="r-sub">诊所</h3>${clinicPanel()}` : "";
        const food = restFoodText(plan);
        return `<h2>休整</h2>
          <p class="r-hint">任务之间休整一次，算 ${C.restDays} 天。${plan.ok
            ? `长休需要 ${plan.water} ml 水、${esc(food)}，血量、武器耐久回满，清空力竭。`
            : `长休需要 ${plan.water} ml 水、${esc(food)}。补给不足（` + esc(plan.lack.join("，")) + "），只能硬撑着过夜：不回血，力竭继续累积。"}</p>
          ${shopping}
          ${clinic}
          ${restPlanner()}
          <button class="g-btn r-main" id="r-camp">休整<small>${wakeHtml(C.hours.longRest)} · ${plan.ok ? `消耗 ${plan.water} ml 水、${esc(food)}` : "补给不足：不回血"}</small></button>`;
      }
      case "boss":
        return `<h2>第 ${run.act} 幕 · 首领</h2>
          <p class="r-hint">首领战不能撤退；输了，本局就此结束。</p>
          ${restBeforeRow()}${brokenWarn()}${fightBtn("迎战首领")}`;
      case "interlude": {
        // 幕间选择：下一幕去哪
        const opts = query("interludeOptions");
        return `<h2>第 ${run.act} 幕 · 落幕</h2>
          <p class="r-hint">${opts.length > 1 ? `选下一幕去哪。${opts.length > 2 ? "几" : "两"}条路都通往第 ${run.act + 1} 幕，敌人等级一样，遇到的敌人、天气和战场不同。${opts.some(o => o.sewer) ? "改走下水道会用掉一张下水道地图，一局只能进一次。" : ""}` : `前往第 ${run.act + 1} 幕。`}</p>
          <div class="r-choices r-interlude">${opts.map(o => `<button class="g-btn${o.alt ? "" : " r-main"}" data-next-region="${esc(o.region)}">第 ${run.act + 1} 幕：${esc(o.region)}${o.sewer ? "（用掉下水道地图）" : o.alt ? "（采矿场）" : ""}
            <small>${esc(o.desc)}${o.desc ? " · " : ""}会遇到：${esc(o.enemies.slice(0, 8).join("、"))}${o.enemies.length > 8 ? " 等" : ""}</small></button>`).join("")}</div>`;
      }
      case "victory":
        return `<h2 class="win">四幕通关</h2>
          <p class="r-hint">可以就此收手，也可以继续挑战额外的 ${C.extraActs} 幕：敌人会强到 ${C.extraActLevels.map(r => r[1]).join("、")} 级。</p>
          <div class="r-choices">
            <button class="g-btn r-main" id="r-win">就此收手</button>
            <button class="g-btn" id="r-more">继续挑战额外幕</button>
          </div>`;
      case "over": {
        const r = run.result || {};
        return `<h2 class="${r.win ? "win" : "lose"}">${r.win ? "通关" : "本局结束"}</h2>
          <p class="r-hint">${esc(r.text || "")} 第 ${r.act} 幕 · 第 ${r.day} 天。</p>
          <button class="g-btn r-main" id="r-home">回到标题</button>`;
      }
    }
    return "";
  }

  function render() {
    if (!run) return;
    renderHeader();
    const lv = run.stage === "over" ? "" : renderLevelUps();
    // 有待选的升级时先选完，再继续流程
    const err = lastError ? `<p class="r-warn r-error">没做成：${esc(lastError)}</p>` : "";
    $("run-body").innerHTML = err + (online() ? onlinePanel() : "") + (lv || renderStage());
    const recent = lastNotes.length ? lastNotes : (run.log || []).slice(-6).map(l => l.text);
    $("run-log").innerHTML = recent.map(t => `<li>${esc(t)}</li>`).join("");
    bind();
    if (window.WorkshopUI) WorkshopUI.refresh();
    if (window.BackpackUI) BackpackUI.refresh();
    if (window.CyberwareUI) CyberwareUI.refresh();
    // 路线图比屏幕宽时（手机）：滚到当前这一列
    const sc = document.querySelector("#run-body .rm-scroll");
    if (sc && run.task && sc.scrollWidth > sc.clientWidth) {
      const n = (run.task.cols || run.task.nodes).length;
      const ratio = n > 1 ? run.task.index / (n - 1) : 0;
      sc.scrollLeft = Math.max(0, ratio * sc.scrollWidth - sc.clientWidth / 2);
    }
  }

  /** 联机：队伍投票、战利品分配、房主用哪名角色的钱包 */
  function onlinePanel() {
    const v = OnlineRogue.viewFor(myId());
    if (!v) return "";
    const kits = OnlineRogue.hostKits();
    const payer = kits.length > 1 ? `<label class="r-watch">花钱用：<select id="r-payer">${kits.map(k => `<option value="${esc(k)}"${k === hostPayer() ? " selected" : ""}>${esc(Rogue.heroName(k))}（${OnlineRogue.purse(k)} 奎支）</option>`).join("")}</select></label>`
      : kits.length ? `<p class="r-hint">你操控 ${esc(Rogue.heroName(kits[0]))}，手里 ${OnlineRogue.purse(kits[0])} 奎支。</p>` : `<p class="r-hint">你没有操控角色：不能花钱，只能投票。</p>`;
    const vote = v.vote.options.length ? `<div class="r-vote"><b>队伍投票</b>（${v.vote.voted}/${v.vote.voters} 人已投${v.vote.blocked ? " · " + esc(v.vote.blocked) : ""}）：点下面的按钮就是投票。
        <ul>${v.vote.options.filter(o => o.voters.length).map(o => `<li>${esc(o.label)}：${esc(o.voters.join("、"))}</li>`).join("") || "<li>还没有人投票</li>"}</ul>
        <button class="g-btn" id="r-force-vote" ${v.vote.voted ? "" : "disabled"}>${v.vote.voted ? "按现在的票数决定" : "还没有人投票"}</button></div>` : "";
    const loot = v.loot.map(l => `<div class="r-vote"><b>战利品</b> ${esc(l.name)} ×${l.qty}（${esc(l.source)}）
        需求：${esc(l.needs.join("、") || "无")} · 放弃：${esc(l.passes.join("、") || "无")}
        <div class="r-choices">${l.mine.map(m => m.answer ? `<span>${esc(m.name)}：${m.answer === "need" ? "需求" : "放弃"}</span>`
          : `<button class="g-btn" data-need="${l.no}" data-kit="${esc(m.kit)}" data-want="1">${esc(m.name)} 需求</button><button class="g-btn" data-need="${l.no}" data-kit="${esc(m.kit)}" data-want="0">${esc(m.name)} 放弃</button>`).join("")}</div></div>`).join("");
    const forceLoot = v.loot.length ? `<button class="g-btn" id="r-force-loot">现在分配战利品</button>` : "";
    const last = v.lastVote ? `<p class="r-hint">上一次队伍决定：${esc(v.lastVote)}</p>` : "";
    const waits = v.waitingLevel.length ? `<p class="r-hint">等 ${esc(v.waitingLevel.join("、"))} 的玩家选升级。</p>` : "";
    return `<section class="r-online">${payer}${last}${waits}${vote}${loot}${forceLoot}${v.lootLog.length ? `<p class="r-hint">${esc(v.lootLog.slice(-2).join(" "))}</p>` : ""}</section>`;
  }

  function fight() {
    if (online()) { act({ fight: true }); return; }
    realFight();
  }
  function battleEnd(outcome) {
    if (run && run.online) run.online.battle = null;
    act({ action: "finishBattle", outcome });
    Screens.show("run");
  }
  function realFight() {
    // 有队员血量低于 20% 而且还能短休：先提醒一下（联机时队伍已经投票决定了，不再问）
    const low = online() ? null : query("lowHpWarning");
    if (low && low.length && !confirm(lowHpWarningText(low))) return;
    sessionCommand("startBattle", null, { startBattle(spec) {
      Screens.show("battle");
      // 联机：记下这场的首领 / 撤退规则，房主刷新页面后结算面板的「继续」还能交回单局
      if (online()) run.online.battle = { title: spec.title || "", kind: spec.kind || "", retreat: spec.retreat };
      GAME.startRogueBattle(spec, battleEnd);
      if (online() && window.OnlineGame && OnlineGame.reassign) OnlineGame.reassign();
    } });
  }

  /** 熟练项检定：先结算，再按掷出的 d100 播和协助格挡一样的检定动画，最后刷新界面 */
  let checking = false;
  async function doCheck(kit, opt) {
    if (online()) { act({ action: "attemptCheck", kit, opt: opt || 0 }); return; }
    return realCheck(kit, opt);
  }
  async function realCheck(kit, opt) {
    if (checking) return;
    let result;
    try { result = dispatch({ type: "run", action: "attemptCheck", kit, opt: opt || 0 }, { run }); } catch (e) { completeAction(null, e); return; }
    const notes = result.notes, lc = result.check;
    if (lc && window.GAME && typeof GAME.playCheck === "function") {
      checking = true;
      try {
        for (const r of lc.rolls) {
          if (r.roll == null) continue;   // 必定成功：不用掷
          const line = Math.round(lc.line * 10) / 10;
          await GAME.playCheck({
            who: `${lc.name} · ${lc.diffName}「${lc.prof}」检定${r.label ? " · " + r.label : ""}`,
            rateText: `需要 ≤ ${line}（最终成功率 ${Math.round(lc.chance * 1000) / 10}%）`,
            roll: r.roll, ok: r.ok,
            okText: "检定成功", failText: "检定失败"
          });
        }
      } finally { checking = false; }
    }
    completeAction(notes);
  }

  function finishRun() {
    if (run && !run._counted) sessionCommand("finishRun");
  }

  function bind() {
    const body = $("run-body");
    const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
    body.querySelectorAll("[data-pick]").forEach(b => {
      b.onclick = () => {
        const p = myPending()[0];
        const o = query("choiceOptions", { kit: p.kit, index: p.index })[Number(b.dataset.pick)];
        act({ action: "choose", kit: p.kit, index: p.index, value: o.value });
      };
    });
    body.querySelectorAll(".r-go").forEach(b => {
      b.onclick = () => {
        const w = b.dataset.which === "main" ? "main" : Number(b.dataset.which);
        act({ action: "acceptTask", which: w });
      };
    });
    body.querySelectorAll("[data-ss-host]").forEach(h => { h.onclick = e => { if (window.ShopSellUI) ShopSellUI.handle(e, sellAct, render); }; });
    body.querySelectorAll("[data-buy]").forEach(b => { b.onclick = () => { if (window.Sfx) Sfx.ui("coin"); act({ action: "buy", key: b.dataset.buy, qty: 1 }); }; });
    body.querySelectorAll("[data-redeem]").forEach(b => { b.onclick = () => { if (window.Sfx) Sfx.ui("coin"); act({ action: "redeem", item: b.dataset.redeem }); }; });
    body.querySelectorAll("[data-upgrade]").forEach(b => { b.onclick = () => act({ action: "upgradeWeapon", kit: b.dataset.upgrade, smith: b.dataset.smith }); });
    body.querySelectorAll("[data-intro]").forEach(b => { b.onclick = () => act({ action: "introduceSmith", smith: b.dataset.intro }); });
    body.querySelectorAll("[data-claim]").forEach(b => { b.onclick = () => act({ action: "claimBlueprint", smith: b.dataset.smith, blueprint: b.dataset.claim }); });
    body.querySelectorAll("[data-install]").forEach(b => { b.onclick = () => act({ action: "installBlueprint", blueprint: b.dataset.install, kit: b.dataset.kit, smith: b.dataset.smith }); });
    body.querySelectorAll("[data-part-buy]").forEach(b => { b.onclick = () => { if (window.Sfx) Sfx.ui("coin"); act({ action: "buyPart", smith: b.dataset.smith, index: Number(b.dataset.partBuy) }); }; });
    body.querySelectorAll("[data-part-sell]").forEach(b => { b.onclick = () => act({ action: "sellPart", part: b.dataset.partSell }); });
    body.querySelectorAll("[data-part-to]").forEach(sel => {
      sel.onchange = () => {
        const out = body.querySelector(`[data-pt-cmp="${sel.dataset.partTo}"]`), o = sel.selectedOptions[0];
        if (!out || !o || !o.dataset.hero) return;
        const [kit, slot] = sel.value.split(":");
        out.innerHTML = modCompareHtml(o.dataset.hero, kit, sel.dataset.partTo, Number(slot));
      };
    });
    body.querySelectorAll("[data-part-install]").forEach(b => {
      b.onclick = () => {
        const sel = body.querySelector(`[data-part-to="${b.dataset.partInstall}"]`);
        const [kit, slot] = (sel ? sel.value : ":").split(":");
        act({ action: "installPart", part: b.dataset.partInstall, kit, slot: Number(slot), smith: b.dataset.smith });
      };
    });
    body.querySelectorAll("[data-part-remove]").forEach(b => {
      b.onclick = () => { const [kit, slot] = b.dataset.partRemove.split(":"); act({ action: "removePart", kit, slot: Number(slot), smith: b.dataset.smith }); };
    });
    body.querySelectorAll("[data-repair]").forEach(b => { b.onclick = () => act({ action: "repairWeapon", kit: b.dataset.repair }); });
    body.querySelectorAll("[data-heal]").forEach(b => { b.onclick = () => act({ action: "healHero", kit: b.dataset.heal }); });
    body.querySelectorAll("[data-cw-open]").forEach(b => { b.onclick = () => openCyberware(b.dataset.cwOpen); });
    body.querySelectorAll("[data-cyber]").forEach(b => {
      const kit = b.dataset.cyber;
      b.onclick = () => act({ action: "modifyHero", kit, plan: readPlan(kit) });
      showCyberPreview(kit);
    });
    body.querySelectorAll("[data-cy]").forEach(el => { el.oninput = () => showCyberPreview(el.dataset.cy); });
    body.querySelectorAll("[data-route]").forEach(b => {
      const go = () => act({ action: "chooseNode", index: Number(b.dataset.route) });
      b.addEventListener("click", go);
      b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    on("r-fight", fight);
    document.querySelectorAll("[data-parley]").forEach(b => { b.onclick = () => act({ action: "parley", kit: b.dataset.parley }); });
    on("r-draw", () => act({ action: "drawHero" }));
    body.querySelectorAll("[data-swap-in]").forEach(b => { b.onclick = () => act({ action: "swapHero", in: b.dataset.swapIn, out: b.dataset.swapOut || null }); });
    body.querySelectorAll("[data-swap-out-only]").forEach(b => { b.onclick = () => act({ action: "swapHero", out: b.dataset.swapOutOnly }); });
    const pay = $("r-payer");
    if (pay) pay.onchange = () => { payerKit = pay.value; render(); };
    on("r-force-vote", () => { try { OnlineRogue.handle(myId(), { type: "rogue.force", what: "vote" }); } catch (e) { completeAction(null, e); } });
    on("r-force-loot", () => { try { OnlineRogue.handle(myId(), { type: "rogue.force", what: "loot" }); } catch (e) { completeAction(null, e); } });
    body.querySelectorAll("[data-need]").forEach(b => {
      b.onclick = () => { try { OnlineRogue.need(myId(), Number(b.dataset.need), b.dataset.kit, b.dataset.want === "1"); } catch (e) { completeAction(null, e); } };
    });
    // 长休先进营地（issue #52）：看看全队状态和补给，再「开始长休」。联机时是队伍投票，不进营地
    const withCamp = (go) => {
      if (online() || !window.RestReport) return go();
      RestReport.camp(query("campStatus", restSel), { host: true, onStart: go });
    };
    on("r-long", () => {
      const w = $("r-watch");
      const cmd = Object.assign({ action: "restAtNode", mode: "long", watch: (w && w.value) || null }, restSel);
      withCamp(() => act(cmd));
    });
    on("r-short", () => act({ action: "restAtNode", mode: "short" }));
    on("r-rest-skip", () => act({ action: "restAtNode", mode: "leave" }));
    on("r-short-before", () => act({ action: "shortRestBeforeNode" }));
    on("r-leave", () => act({ action: "leaveNode" }));
    body.querySelectorAll("[data-check]").forEach(b => { b.onclick = () => doCheck(b.dataset.check, Number(b.dataset.opt) || 0); });
    on("r-check-skip", () => act({ action: "skipCheck" }));
    on("r-camp", () => withCamp(() => act(Object.assign({ action: "camp" }, restSel))));
    body.querySelectorAll("[data-rest-food]").forEach(el => { el.onchange = () => { restSel.food[el.dataset.restFood] = el.value; render(); }; });
    body.querySelectorAll("[data-rest-sleep]").forEach(el => { el.onchange = () => { restSel.sleep[el.dataset.restSleep] = el.value; render(); }; });
    body.querySelectorAll("[data-rest-ammo]").forEach(el => { el.onchange = () => { restSel.ammo = restSel.ammo || {}; restSel.ammo[el.dataset.restAmmo] = el.value; render(); }; });
    body.querySelectorAll("[data-rest-spit]").forEach(el => { el.onchange = () => { restSel.spit = restSel.spit || {}; restSel.spit[el.dataset.restSpit] = el.value; render(); }; });
    on("r-next", () => act({ action: "nextAct" }));
    body.querySelectorAll("[data-next-region]").forEach(b => { b.onclick = () => act({ action: "nextAct", region: b.dataset.nextRegion }); });
    on("r-win", () => act({ action: "afterVictory", goOn: false }));
    on("r-more", () => act({ action: "afterVictory", goOn: true }));
    on("r-home", () => { sessionCommand("leave", { save: false }); Screens.show("title"); });
  }

  /* ---------- 入口 ---------- */
  window.RunFlow = {
    ready: true,
    start(opt) {
      sessionCommand("prepareParty", { solo: !!(opt && opt.solo), growth: !!(opt && opt.growth) });
      Screens.show("party");
    },
    /** 每日挑战（#52）：今天的种子定队伍，直接出发（不进选人画面） */
    startDaily() {
      const saved = sessionCommand("savedStatus");
      const ask = saved === "newer" ? "有一局更新版本的游戏存下的进度（这一版读不了）。开每日挑战会覆盖它，确定吗？"
        : saved === "ok" ? "已有一局在进行中。开每日挑战会覆盖它，确定吗？" : "";
      if (ask && !confirm(ask)) return false;
      const seed = Rogue.dailySeed();
      sessionCommand("newRun", { party: Rogue.dailyParty(seed), seed, daily: true });
      lastNotes = [`每日挑战出发。今天的种子 ${seed}，队伍和专长选项大家都一样。`];
      save();
      Screens.show("run");
      return true;
    },
    /** 角鳞星地图（world-map.js）：这一幕的区域是当前位置，各幕按顺序连成路线 */
    mapOptions() {
      if (!run) return null;
      const C = ROGUE_CONFIG, total = Rogue.totalActs(run);
      const route = [];
      for (let a = 1; a <= total; a++) {
        route.push({ place: (run.regionPick && run.regionPick[a]) || C.regions[(a - 1) % C.regions.length], label: `第 ${a} 幕`, state: a < run.act ? "done" : a === run.act ? "now" : "next" });   // 幕间选过采矿场 / 下水道的照选的（下水道是地图上的地点 sewer）
      }
      return { here: Rogue.region(run), sub: `${run.solo ? "单人模式" : run.daily ? "每日挑战 " + run.daily.date : "单局"} · 第 ${run.act} 幕 · ${Rogue.region(run)}`, party: run.party.map(h => Rogue.heroName(h.kit)), route };
    },
    /* ---------- 联机单局（online-game.js / online-rogue.js 用） ---------- */
    current: () => run,
    refresh() { if (run && Screens.is("run")) render(); },
    /** 队伍投票定下来的事：真正去做 */
    async perform(cmd) {
      if (cmd.fight) return realFight();
      if (cmd.action === "attemptCheck") return realCheck(cmd.kit, cmd.opt);
      return doAct(cmd);
    },
    /** 玩家发来的个人指令：出错直接抛给玩家 */
    actRaw(cmd) {
      const notes = dispatch(Object.assign({ type: "run" }, cmd), { run });
      completeAction(notes);
      return notes;
    },
    /** 联机开局：去选队伍（不能选单人模式） */
    startOnline() {
      sessionCommand("prepareParty", { solo: false });
      Screens.show("party");
    },
    onlineCheckpoint: () => (run ? JSON.parse(JSON.stringify({ run })) : null),
    restoreOnline(saved) {
      if (!saved || !saved.run) return;
      sessionCommand("adopt", { run: saved.run });
      lastNotes = ["房主恢复了房间。"];
    },
    /** 房主刷新时正在单局战斗里：把结算面板的「继续」重新接回单局 */
    battleEnd,
    battleSpecLite: () => (run && run.online && run.online.battle) || null,
    resume() {
      const result = sessionCommand("resume");
      if (!result.resumed) return;
      lastNotes = ["继续上次的进度。"];
      Screens.show("run");
    },
    resumeGrowth() {
      const result = sessionCommand("resume", { growth: true });
      if (!result.resumed) return;
      lastNotes = ["继续长线养成的进度。"];
      Screens.show("run");
    }
  };

  function boot() {
    Screens.register("party", $("scr-party"), { onShow: renderParty });
    Screens.register("run", $("scr-run"), { onShow: render });
    $("party-back").onclick = () => Screens.show("title");
    $("party-go").onclick = () => {
      // 已经有一局（包括更新版本的游戏存下、这一版读不了的）：开新局会覆盖它，先问一句
      const saved = sessionCommand("savedStatus");
      const ask = saved === "newer" ? "有一局更新版本的游戏存下的进度（这一版读不了）。开新的一局会覆盖它，确定吗？"
        : saved === "ok" ? "已有一局在进行中。开新的一局会覆盖它，确定吗？" : "";
      if (ask && !confirm(ask)) return;
      try {
        const seed = RNG.newSeed();
        sessionCommand("newRun", solo.on
          ? { party: [solo.hero], partners: solo.partners.slice(), role2: solo.role2, solo: true, seed }
          : { party: picked.slice(), seed, growth: growth.on });
      } catch (e) {
        $("party-count").textContent = e.message;
        return;
      }
      lastNotes = [`出发。种子 ${run.seed}。`];
      save();
      Screens.show("run");
      if (window.OnlineRogue && OnlineRogue.enabled) {
        // 联机：开局的钱分进各人钱包；把队伍摆上场，房间里才能把角色分给玩家
        BattleSim.setup({ party: run.party.map(h => h.kit), enemies: [], before: () => Rogue.applyPartyToField(run) });
        OnlineRogue.onNewRun(run);
        if (window.OnlineGame && OnlineGame.reassign) OnlineGame.reassign();
        render();
      }
    };
    $("run-bestiary").onclick = () => {
      if (!window.Bestiary || !run) return;
      Bestiary.open({ partySize: Math.max(2, Math.min(4, run.party.length + (run.solo ? 1 : 0))), sub: run.solo ? "单人模式" : "单局" });
    };
    $("run-map").onclick = () => { const o = window.RunFlow.mapOptions(); if (o && window.WorldMap) WorldMap.open(o); };
    $("run-title").onclick = () => {
      sessionCommand("leave", { save: true });
      Screens.show("title");
    };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
