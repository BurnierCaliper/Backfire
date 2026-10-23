/* Antlerscale: Backfire · 联机玩家战斗画面的「纸片风」界面（#308，主人 10/22 定稿，设计在 docs/ui-paper/）
 *
 * 只在联机玩家（不是房主 / 主持人）的战斗画面、并且开着新画面（3D 战场建好了）时用；新画面关着时的联机画面、主持人那边一点不变
 * （单机的纸片画面在 game-paper.js，#339）。纸纹、配色、顶栏、吊牌、收据、便利贴这些组件和单机共用 paper-ui.js 那一份，这里只放联机自己的配置。
 * online-ui.js 在 body 上加 .ol-paper（PAPER.bodyClass），样子都挂在这个类下面（online-paper.css）：
 *   · 战场铺满整个画面（联机舞台铺满，热座栏让开：它的内容搬到下面的顶栏和吊牌上）
 *   · 顶上一条（.olp-top）：联机跑团 · 房间码 · 第 N 回合 · 时间 · 天气；右边镜头 远 / 中 / 近、「工具 ▾」、「菜单」
 *   · 顶栏下面中间挂行动顺序吊牌（.olp-tags）：当前行动的高亮；自己的角色带 ⇅，点开是「延后 / 换位」——
 *     按钮点的就是热座栏（hotseat-ui.js）里原来那几个按钮（延后、换位、换到这里、取消换位……），同一份操作，这里只是换个样子摆出来
 *   · 左上角队伍（hd2d-shell.js 的队伍栏挪过来）：收起成只剩头像一列；下面角色资料 / 武器 / 背包
 *   · 「工具 ▾」下拉（.olp-tools）：地图、战绩、钱包与商店、任务日志、NPC 资料、申请检定、新画面开关，点完收起；原来舞台顶上那一排按钮不画了
 *   · 右边战斗记录 / 小队聊天（#online-side）：平时收成右边缘一个竖标签，有新消息挂数字
 *   · 底下技能栏（hd2d-shell.js 的 .g-hud）：能收起成一行；手机竖屏上紧凑、最多占屏幕高度的 PAPER.phone.dockMax，没手动点过时轮到你才展开（#311）
 * 各块的收起状态记在本机（localStorage，读写都包 try/catch）。只用联机玩家收到的包（online-view.js 白名单投影过的），不读房主的 state；
 * 坚毅生命（shp / shpMax）这里一个字都不碰。
 *
 *   纯函数（Node 里能 require，tests/online-paper.test.js）：
 *     PAPER                                 配置：paper-ui.js 的 BASE 合上下面这一份（类名、本机记住收起的键、文字、贴纸纹的面板……）
 *     active(o)                             这一刻是不是纸片画面：o = { active, isHost, screen, on3d }
 *     isOpen / setOpen / shellHtml / topHtml / tagsHtml / receiptHtml / dress …   paper-ui.js · make 给的（用这里的配置）
 *     dockAuto / phoneVars / themeOf / themeVars / texture / grit / readMoves / pressMove / readCam / pressCam …   paper-ui.js 共用的 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root, require("./paper-ui.js"));
  else root.OnlinePaper = factory(root, root.PaperUI);
})(typeof self !== "undefined" ? self : this, function (root, UI) {
  "use strict";

  /* ---------- 配置（联机自己的；配色、纸纹、收据、手机这些在 paper-ui.js 的 BASE）----------
   *   bodyClass   纸片画面开着时 body 上的类（所有样子都挂在它下面；和单机共用这一个，单机另加 g-paper）
   *   screens     哪些画面算战斗画面（战斗、战斗结算：新画面在这两个画面都挂着）
   *   keys        本机记住收起 / 展开的键（存 "open" / "closed"）：drawer 右边的战斗记录 / 小队聊天抽屉。
   *               技能栏、队伍栏用 hd2d-shell.js 的 SHELL.keys（单机新画面、原型页同一个习惯）
   *   defaults    没记过时开不开：抽屉平时收着（主人：「平时藏在右边」）
   *   text        顶栏、下拉、抽屉上联机自己的字（共用的在 BASE.text）
   *   cover       浮在战场上、3D 白卡要让开的面板（#339：顶栏胶带、吊牌、左上角的队伍、技能栏、右边的抽屉；online-ui.js 量好交给 hd2d-field.js · cover）。
   *               「工具 ▾」下拉、舞台上浮着的提示只是一下子，不让（不然一开下拉镜头就动）
   *   art.targets 哪些面板贴哪种纸（online-ui.js 交给 dress）："on" = 当前行动的吊牌换青色那一种 */
  const P = UI.make({
    bodyClass: "ol-paper",
    screens: ["battle", "ended"],
    keys: { drawer: "backfire.online.paper.drawer" },
    defaults: { drawer: false },
    text: {
      title: "联机跑团", titleRogue: "联机单局",
      roomTitle: "房间码", reconnecting: "重连中",
      toolsTitle: "地图、战绩、钱包与商店、任务日志、NPC 资料、申请检定、新画面开关",
      menuTitle: "菜单（Esc）：消息与成员、大厅、克制表……",
      drawer: "记录 · 聊天", drawerOpen: "展开战斗记录与小队聊天", drawerClose: "收起战斗记录与小队聊天", logTab: "战斗记录"
    },
    cover: ["#online-paper .olp-top", "#online-paper .olp-tags", ".ol-battle > .g-hud.hd2d-shell > .hd2d-party", ".ol-battle > .g-hud.hd2d-shell", "#online-side"],
    art: {
      targets: [
        ["#online-paper .olp-top", "tapebar"], ["#online-paper .olp-tools", "kraft"], ["#online-paper .olp-tag-card", "tag|tagon"],
        ["#online-paper .olp-tools-b", "board"], ["#online-paper .olp-menu-b", "boardy"], ["#online-paper .olp-move", "card"],
        [".ol-battle > .g-hud.hd2d-shell > .hd2d-party", "kraft"], [".ol-battle > .g-hud.hd2d-shell", "dock"],
        [".ol-battle > .g-hud.hd2d-shell > .hd2d-party > .party > .pm", "card"], [".ol-battle .olp-party-tools .ol-button", "card"],
        [".ol-battle > .g-hud.hd2d-shell .skills .sk", "tag"], [".ol-battle > .g-hud.hd2d-shell .summonbtn", "board"], [".ol-battle > .g-hud.hd2d-shell .endturn", "board"],
        ['#online-side[data-tab="log"]:not(.ol-side-collapsed)', "receipt"], ['#online-side[data-tab="chat"]:not(.ol-side-collapsed)', "paper"], ["#online-side.ol-side-collapsed", "kraft"]
      ]
    }
  });

  /* ---------- 这一刻是不是纸片画面 ---------- */
  /** o = { active 在房间里, isHost 是房主 / 主持人, screen 画面, on3d 新画面建好了（online-ui.js 的 field3d.on()） }：
   *  联机玩家、战斗 / 战斗结算画面、新画面开着才是；新画面还在加载、打不开（退回旧画面）都不是 */
  function active(o) {
    o = o || {};
    return !!(o.active && !o.isHost && P.PAPER.screens.includes(o.screen) && o.on3d);
  }

  return Object.assign(P, { active });
});
