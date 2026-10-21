/* Antlerscale: Backfire · 昼夜和光影：一天里几点到几点算白天 / 傍晚 / 夜晚（规则和画面共用这一张表）
 *
 * DAY_LIGHT：从几点起（当天 0 点起的分钟数）算白天 / 傍晚 / 夜晚，夜晚一直到第二天白天开始。
 *   白天 05:00–18:00 · 傍晚 18:00–20:00 · 夜晚 20:00–05:00
 *   规则上的夜晚 = 傍晚 + 夜晚（18:00–05:00）：沙漠生物按昼夜换行为（desert.js）、战斗顶栏的「白天 / 夜晚」和夜晚色调、
 *   联机玩家画面的夜晚色调、长休动画的太阳 / 月亮都按它。傍晚只是画面上还留着一点天光（战斗状态的光影 state.light = "dusk"），
 *   规则上已经是夜晚，所以不会出现「规则说是夜晚、画面是白天」。顶栏时段文字（ledger.js / party-cards.js · dayPeriod）的「傍晚」也是这一段。
 * 改分界只改这里：ledger.js · isNightClock / clockLight / dayPeriod、party-cards.js · isNight / dayPeriod、rest-report.js 的日月都跟着变。
 *
 *   DayLight.lightAt(min)   这个时刻的光影："day" / "dusk" / "night"
 *   DayLight.isNight(min)   规则上是不是夜晚（傍晚也算）
 *   DayLight.LIGHTS / NAMES 光影认的三个值和中文名（战斗状态的 state.light 只认这三个，联机白名单 online-view.js 也只放行这三个）
 *
 * 规则文件（ledger.js）和联机玩家的显示端（party-cards.js，玩家端不加载规则）都用这一份，所以写成谁都能加载的小模块。 */
(function (root) {
  "use strict";
  const DAY_LIGHT = { day: 5 * 60, dusk: 18 * 60, night: 20 * 60 };
  const LIGHTS = ["day", "dusk", "night"];
  const NAMES = { day: "白天", dusk: "傍晚", night: "夜晚" };
  const norm = m => ((Math.floor(Number(m) || 0) % 1440) + 1440) % 1440;
  /** from ≤ m < to（跨过 0 点也行） */
  const within = (m, from, to) => (from <= to ? m >= from && m < to : m >= from || m < to);
  function lightAt(min) {
    const m = norm(min), T = DAY_LIGHT;
    return within(m, T.day, T.dusk) ? "day" : within(m, T.dusk, T.night) ? "dusk" : "night";
  }
  const isNight = min => lightAt(min) !== "day";
  const api = { DAY_LIGHT, LIGHTS, NAMES, lightAt, isNight };
  root.DayLight = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
