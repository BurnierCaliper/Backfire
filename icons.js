/* Antlerscale: Backfire · 七种属性的图标（画法同 art/style-guide.html 的贴纸图标）
 * Icons.element(el) → 一段内联 SVG：底下一层粗描边（颜色 --eo，默认白），上面一层属性色（currentColor）。
 * 伤害数字前面用（game.js · popup / 预览牌）。Icons.weather(w)：顶栏的天气图标。 */
(function (root) {
  "use strict";
  const GLYPH = {
    // 火：大体是三角形的外轮廓（底部收成弧形的 V），火舌左右不对称、往左上甩一个回勾；里面是不碰外圈的两瓣内焰
    fire: `<path d="M9 38 C6 33 6.5 27 11.5 22.5 C12 26.5 13.5 29.5 15.5 30 C16.5 30.2 16 26 17 22 C18.3 17 21 14 22.5 11 C23.5 8.5 23 5.5 21 3 C28.5 4.5 33.5 10 33.5 17.5 C33.6 18.6 34.3 19 35 18 C36.3 16 37 13 37 9.5 C41.5 16 43.5 26 41.2 32.5 C40 36 38 38.5 35.5 40 C31.5 42.5 27 44.5 24 46 C20.5 43.5 14 41 9 38 Z"/><path class="thin" d="M 25.5 38 C 22.5 36 21 33.5 21.5 30.5 C 22 28 23.5 26.5 24.5 25 C 24.8 27 25.6 28.1 26.6 28.3 C 26.6 26.7 27.5 25.3 29 24.5 C 30.5 27 31 30.5 30 33.5 C 29.4 35.3 27.8 36.8 25.5 38 Z"/>`,
    acid: `<path d="M24 6 C24 6 11 22 11 30 A13 13 0 0 0 37 30 C37 22 24 6 24 6 Z"/><circle cx="20" cy="31" r="3.2"/><circle class="thin" cx="28.5" cy="35" r="2"/><circle class="thin" cx="39" cy="9" r="2.2"/>`,
    electric: `<path d="M28 4 L12 27 H23 L19 44 L36 19 H25 Z"/><path class="thin" d="M6 14 L10 14 M38 32 L42 32"/>`,
    ice: [0, 60, -60].map(a => `<path transform="rotate(${a} 24 24)" d="M24 5 V43 M18.5 10 L24 15 L29.5 10 M18.5 38 L24 33 L29.5 38"/>`).join(""),
    energy: `<ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(30 24 24)"/><ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(-30 24 24)"/><circle class="solid" cx="24" cy="24" r="4.4"/>`,
    physical: `<path d="M24 5 L27.1 16.6 L37.4 10.6 L31.4 20.9 L43 24 L31.4 27.1 L37.4 37.4 L27.1 31.4 L24 43 L20.9 31.4 L10.6 37.4 L16.6 27.1 L5 24 L16.6 20.9 L10.6 10.6 L20.9 16.6 Z"/>`,
    harmonic: `<path d="M5 24 C9 12 13 12 17 24 C21 36 25 36 29 24 C33 12 37 12 41 24 L43 24"/><path class="thin" d="M5 15 C9 9 13 9 17 15 C21 21 25 21 29 15 C33 9 37 9 41 15"/><path class="thin" d="M5 33 C9 27 13 27 17 33 C21 39 25 39 29 33 C33 27 37 27 41 33"/>`
  };
  /* 天气图标：同样的粗线画法，颜色各用一个天气色 */
  const CLOUD = `<path d="M13 30 A7 7 0 0 1 13 16 A10 10 0 0 1 32 12 A8 8 0 0 1 37 30 Z"/>`;
  const WEATHER = {
    heat: { c: "#ff5b2e", g: `<circle cx="24" cy="20" r="8"/>` + [0, 45, 90, 135, 180, 225, 270, 315].map(a => `<path class="thin" transform="rotate(${a} 24 20)" d="M24 6 V9"/>`).join("") + `<path class="thin" d="M8 36 C12 33 15 39 19 36 C23 33 26 39 30 36 C34 33 37 39 41 36 M12 42 C15 40 18 44 21 42 C24 40 27 44 30 42"/>` },
    snow: { c: "#9cc8ea", g: CLOUD + `<circle class="solid" cx="15" cy="37" r="2"/><circle class="solid" cx="24" cy="41" r="2"/><circle class="solid" cx="33" cy="37" r="2"/><circle class="solid" cx="19" cy="44" r="1.6"/><circle class="solid" cx="29" cy="45" r="1.6"/>` },
    acid: { c: "#8fd63a", g: CLOUD + `<path class="thin" d="M15 35 C15 35 12 39 12 41 A3 3 0 0 0 18 41 C18 39 15 35 15 35 Z M30 35 C30 35 27 39 27 41 A3 3 0 0 0 33 41 C33 39 30 35 30 35 Z"/><path class="thin" d="M22 36 V40 M37 36 V39"/>` },
    thunder: { c: "#c07cf0", g: CLOUD + `<path d="M26 28 L19 38 H25 L22 46 L31 35 H25 Z"/>` },
    glow: { c: "#ff4fa3", g: `<path d="M30 7 A16 16 0 1 0 41 30 A12 12 0 1 1 30 7 Z"/><path class="thin" d="M38 8 L38 14 M35 11 H41 M42 19 V22 M40.5 20.5 H43.5"/>` },
    sand: { c: "#e2a24f", g: `<path d="M5 15 H30 A5 5 0 1 0 25 10"/><path d="M5 24 H38 A5 5 0 1 1 33 29"/><path class="thin" d="M9 33 H24 A4 4 0 1 1 20 37"/><circle class="solid" cx="40" cy="15" r="1.6"/><circle class="solid" cx="44" cy="35" r="1.4"/><circle class="solid" cx="32" cy="41" r="1.6"/>` },
    phase: { c: "#3fe0ff", g: `<circle cx="20" cy="24" r="12"/><circle class="thin" cx="28" cy="24" r="12"/><path class="thin" d="M24 6 V12 M24 36 V42"/>` }
  };
  /** 天气图标；常态 / 不认识的天气返回空串 */
  function weather(w) {
    const d = WEATHER[w];
    if (!d) return "";
    return `<svg class="eicon wicon" viewBox="0 0 48 48" style="color:${d.c}" aria-hidden="true"><g class="o">${d.g}</g><g class="c">${d.g}</g></svg>`;
  }
  const NAME = { fire: "火", acid: "酸", electric: "电", ice: "冰", energy: "能量", physical: "物理", harmonic: "谐波" };

  /** 属性图标的 SVG 字符串；不认识的属性返回空串 */
  function element(el) {
    const g = GLYPH[el];
    if (!g) return "";
    return `<svg class="eicon" viewBox="0 0 48 48" aria-label="${NAME[el]}" role="img"><g class="o">${g}</g><g class="c">${g}</g></svg>`;
  }

  root.Icons = { element, weather, GLYPH, NAME, WEATHER };
})(typeof window !== "undefined" ? window : globalThis);
