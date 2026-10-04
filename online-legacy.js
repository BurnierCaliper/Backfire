/* D3 boundary for the retained calculator / backstage / exploration panels.
 * Old callers stay synchronous. Their captured command data can be deferred,
 * while return-dependent battle resets are rejected before they can be queued.
 * Installed first, outside the synchronous local HotseatAuthority execution. */
(function (root) {
  "use strict";
  const domains = new Set(["battle.panel", "battle.setup", "backstage", "calc", "trpg", "trpg.ui"]);
  const encounterActions = new Set(["setZones", "selectEncounter", "rollEncounter", "rollBossEncounter", "loadSlot"]);
  const resets = new Set(["party", "reset", "enter", "new", "delete", "import", "title", "toBattle", "backFromBattle"]);
  let off = null, executing = 0;
  function fail(message) { const error = new Error(message); error.code = "HOTSEAT_REJECT"; throw error; }
  function preflight(cmd) {
    const inCombat = state.combatStarted && !GAME.ended;
    const reset = cmd.type === "battle.setup" || cmd.type === "battle.panel" && encounterActions.has(cmd.action) ||
      cmd.type === "calc" && (["clearField", "loadLive"].includes(cmd.action) || cmd.action === "global" && cmd.field === "zoneMode") ||
      cmd.type === "trpg.ui" && resets.has(cmd.action);
    if (reset && inCombat) fail("联机战斗中不能重置遭遇、切换存档或改变区数；请先结束战斗");
    if (reset && GAME.depth > 0 && !GAME.tape) fail("请等待当前结算结束后再设置遭遇或切换存档");
    if (root.OnlineGame.isPaused()) fail("房主连接中断，等待恢复");
  }
  function internal(cmd) {
    // These are engine bookkeeping / persistence, not interactive authority edits.
    return cmd.type === "battle.panel" && /^normalize/.test(cmd.action || "") ||
      cmd.type === "trpg.ui" && ["saveCaptured", "recordBattle"].includes(cmd.action) ||
      cmd.type === "trpg" && cmd.action === "writeSlot" ||
      cmd.type === "calc" && cmd.action === "persist";
  }
  function placeholder(cmd) {
    if (cmd.type === "battle.panel") return { notes: [] };
    if (cmd.type === "trpg") return [];
    if (cmd.type === "calc" && cmd.action === "advancePhase") return (Number(state.phaseStep) + 1) % 4;
    if (cmd.type === "calc" && cmd.action === "rosterAddForm") return cmd.form?.name || "待加入角色";
    return undefined;
  }
  function install() {
    if (off || !root.OnlineGame || !root.Commands) return false;
    off = Commands.intercept((cmd, context, next) => {
      if (!root.OnlineGame.isHost() || GAME.sim || executing || !domains.has(cmd.type) || internal(cmd)) return next();
      preflight(cmd);
      const apply = () => {
        // State/phase/connection may change while an animation is playing.
        preflight(cmd);
        const before = (state.units || []).map(u => u.id);
        executing++;
        try {
          const result = next();
          // All retained rule handlers are synchronous; this also covers copies,
          // card imports and boss packs without relying on a spawn action list.
          root.OnlineGame.legacyAddedEnemies(before);
          return result;
        } finally { executing--; }
      };
      if (GAME.depth > 0 && !GAME.tape) {
        if (typeof root.OnlineGame.queueHostEdit !== "function") fail("主持人编辑队列尚未就绪");
        // The queue reports failures to the room notice. The original UI must not
        // receive a Promise in place of its legacy synchronous return value.
        root.OnlineGame.queueHostEdit(apply).catch(() => {});
        return placeholder(cmd);
      }
      return apply();
    }, { first: true });
    return true;
  }
  root.OnlineLegacy = { install };
  if (!install() && typeof document !== "undefined") document.addEventListener("DOMContentLoaded", install, { once: true });
})(typeof globalThis !== "undefined" ? globalThis : window);
