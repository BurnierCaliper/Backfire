/* Antlerscale: Backfire · 七种属性的图标（画法同 art/style-guide.html 的贴纸图标）
 * Icons.element(el) → 一段内联 SVG：底下一层粗描边（颜色 --eo，默认白），上面一层属性色（currentColor）。
 * 伤害数字前面用（game.js · popup / 预览牌）。 */
(function (root) {
  "use strict";
  const GLYPH = {
    fire: `<path d="M24 5 C31 13 37 18 37 28 A13 13 0 0 1 11 28 C11 21 15 17 18 13 C19 19 22 21 24 21 C22 15 22 10 24 5 Z"/><path class="thin" d="M24 38 A5 5 0 0 1 19 33 C19 30 22 28 24 24 C26 28 29 30 29 33 A5 5 0 0 1 24 38 Z"/>`,
    acid: `<path d="M24 6 C24 6 11 22 11 30 A13 13 0 0 0 37 30 C37 22 24 6 24 6 Z"/><circle cx="20" cy="31" r="3.2"/><circle class="thin" cx="28.5" cy="35" r="2"/><circle class="thin" cx="39" cy="9" r="2.2"/>`,
    electric: `<path d="M28 4 L12 27 H23 L19 44 L36 19 H25 Z"/><path class="thin" d="M6 14 L10 14 M38 32 L42 32"/>`,
    ice: [0, 60, -60].map(a => `<path transform="rotate(${a} 24 24)" d="M24 5 V43 M18.5 10 L24 15 L29.5 10 M18.5 38 L24 33 L29.5 38"/>`).join(""),
    energy: `<ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(30 24 24)"/><ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(-30 24 24)"/><circle class="solid" cx="24" cy="24" r="4.4"/>`,
    physical: `<path d="M24 5 L27.1 16.6 L37.4 10.6 L31.4 20.9 L43 24 L31.4 27.1 L37.4 37.4 L27.1 31.4 L24 43 L20.9 31.4 L10.6 37.4 L16.6 27.1 L5 24 L16.6 20.9 L10.6 10.6 L20.9 16.6 Z"/>`,
    harmonic: `<path d="M5 24 C9 12 13 12 17 24 C21 36 25 36 29 24 C33 12 37 12 41 24 L43 24"/><path class="thin" d="M5 15 C9 9 13 9 17 15 C21 21 25 21 29 15 C33 9 37 9 41 15"/><path class="thin" d="M5 33 C9 27 13 27 17 33 C21 39 25 39 29 33 C33 27 37 27 41 33"/>`
  };
  const NAME = { fire: "火", acid: "酸", electric: "电", ice: "冰", energy: "能量", physical: "物理", harmonic: "谐波" };

  /** 属性图标的 SVG 字符串；不认识的属性返回空串 */
  function element(el) {
    const g = GLYPH[el];
    if (!g) return "";
    return `<svg class="eicon" viewBox="0 0 48 48" aria-label="${NAME[el]}" role="img"><g class="o">${g}</g><g class="c">${g}</g></svg>`;
  }

  root.Icons = { element, GLYPH, NAME };
})(typeof window !== "undefined" ? window : globalThis);
