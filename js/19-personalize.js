/* ==========================================================================
 * 模块 19 · 个性定制（js/19-personalize.js）
 *
 * 职责：读写「⚙️设置 → 👕个性定制」的三项外观偏好——页面动态背景、棋盘
 *       三态色系、普通雷 emoji；并把这些偏好实时作用到页面与棋盘。
 * 依赖：Store（01-storage，minePersonalize 键）、M（04-mines，普通雷定义）、
 *       renderSlot / renderMineInfo（06-render / 05-generator，仅用于即时刷新）；
 *       DOM 中的 #bgChoiceGrid / #paletteChoiceGrid / #mineEmojiGrid。
 * 对外：window.RMPersonalize = { setBackground, setPalette, setMineEmoji,
 *       getState, reset }。
 * 设计要点：
 *   1) 三项偏好合并存为一条 JSON（键名以 mine 开头，自动进入受管杂项），
 *      不改变存档 schema / format / dataVersion。
 *   2) 背景场景按需构建：只有被选中的背景才创建 DOM / Canvas，切换时淡出
 *      旧场景并停止其动画循环，避免后台常驻十余个动画。
 *   3) 色系通过 :root 上的 --rm-cell-* 变量下发，不重写每条 .cell-* 规则；
 *      默认色系移除变量，回落到 style.css 第 75 段的原始配色。
 *   3.1) 每组色系另配 8 个数字色（n1~n5 / n-1~n-3），按三态底色自动压深 /
 *      提亮到至少 3:1 对比度，写入 --rm-num-* 变量；默认色系不写变量，
 *      保留 .n1 ~ .n-3 的原有颜色。
 *   4) 普通雷只改 M.normal.e（名称仍是「普通雷」），并同步已渲染的
 *      .normal-bomb 节点与地雷图鉴，避免换 emoji 后旧棋盘不更新。
 *   5) 窄屏 / prefers-reduced-motion / 页面切后台时降低或暂停 Canvas 绘制。
 * ========================================================================== */

(function initPersonalize() {
    "use strict";

    var STORE_KEY = "minePersonalize";
    var DEFAULT_STATE = { bg: "none", palette: "default", mineEmoji: "💣" };

    /* ---------- 1. 候选数据 ---------- */

    /* 背景清单：11 套动态背景取自「背景测试台.html」，另加 8 套淡色纯色；
       none 表示恢复原始薄荷渐变页面，不创建任何场景节点。thumb 用于缩略图。 */
    var BG_DEFS = [
        { id: "none", name: "初始", en: "DEFAULT", tone: "light", type: "none", glyph: "💣",
          desc: "来扫雷吗", thumb: "linear-gradient(160deg,#c2e286,#b1e4b3 55%,#e8f4f8)" },
        { id: "solidCream", name: "奶油白", en: "CREAM", tone: "light", type: "css", flat: true,
          color: "#f7f3e8", effect: "dots", fx: "#d9d8b2", glyph: "☁️", desc: "奶油白，柔光波点", thumb: "#f7f3e8" },
        { id: "solidMint", name: "薄荷绿", en: "MINT", tone: "light", type: "css", flat: true,
          color: "#e8f3e6", effect: "grid", fx: "#8dce93", glyph: "🌿", desc: "薄荷绿，网格脉冲", thumb: "#e8f3e6" },
        { id: "solidMist", name: "雾蓝", en: "MIST", tone: "light", type: "css", flat: true,
          color: "#e8f0f7", effect: "bezier", fx: "#6f90c2", glyph: "🩵", desc: "雾蓝，贝特尔曲线", thumb: "#e8f0f7" },
        { id: "aurora", name: "极光", en: "AURORA", tone: "dark", type: "css", glyph: "✦",
          desc: "爱是一道光", thumb: "linear-gradient(160deg,#04121c,#0a5c4a 45%,#22c55e 70%,#a7f3d0)" },
        { id: "starfield", name: "星空", en: "STARFIELD", tone: "dark", type: "canvas", glyph: "✧",
          desc: "闪耀其中", thumb: "radial-gradient(1.2px 1.2px at 18% 28%,rgba(220,235,255,.95),transparent),radial-gradient(1.2px 1.2px at 72% 22%,rgba(147,197,253,.9),transparent),linear-gradient(160deg,#0a1740,#102a5c 55%,#07112e)" },
        { id: "abyss", name: "浅海", en: "SUNLIT SHALLOWS", tone: "light", type: "canvas", glyph: "≈",
          desc: "摸鱼中", thumb: "linear-gradient(180deg,#f0f9ff,#bae6fd 22%,#67e8f9 46%,#0891b2 80%,#0e7490)" },
        { id: "sakura", name: "樱花", en: "SAKURA", tone: "light", type: "canvas", glyph: "❀",
          desc: "秒速五厘米", thumb: "linear-gradient(160deg,#fff7ed,#fce7f3 50%,#f9a8d4)" },
        { id: "rain", name: "黑客帝国", en: "DATA RAIN", tone: "dark", type: "canvas", glyph: "01",
          desc: "什么是真实", thumb: "linear-gradient(180deg,#04150f,#0b3d2e 55%,#166534)" },
        { id: "ghosts", name: "幽灵", en: "MINE GHOSTS", tone: "dark", type: "css", glyph: "👻",
          desc: "你惊扰了它们", thumb: "linear-gradient(180deg,#0b1f3a,#1e3a8a 55%,#071426)" },
        { id: "mint", name: "汽水", en: "MINT SODA", tone: "light", type: "canvas", glyph: "○",
          desc: "薄荷、柠檬、气泡", thumb: "linear-gradient(160deg,#d1fae5,#a7f3d0 35%,#bae6fd 70%,#fef9c3)" },
        { id: "candy", name: "糖衣", en: "CANDY POP", tone: "light", type: "css", glyph: "🍬",
          desc: "甜蜜陷阱", thumb: "linear-gradient(135deg,#f472b6,#facc15 38%,#22d3ee 68%,#a3e635)" },
        { id: "neon", name: "霓虹", en: "NEON BEAMS", tone: "dark", type: "canvas", glyph: "⫻",
          desc: "当心眼睛", thumb: "linear-gradient(135deg,#140a30,#db2777 35%,#06b6d4 70%,#a3e635)" },
        { id: "forest", name: "萤火", en: "FIREFLY FOREST", tone: "dark", type: "css", glyph: "✳",
          desc: "夜晚静悄悄", thumb: "linear-gradient(180deg,#0a3d2a,#0b4a35 55%,#84cc16)" },
        { id: "rainforest", name: "晨光", en: "RAINFOREST", tone: "light", type: "css", glyph: "🍃",
          desc: "雨林、阳光", thumb: "linear-gradient(180deg,#f0fdf4,#d9f99d 25%,#86efac 50%,#34d399 75%,#0f766e)" }

    ];

    /* 三态色系：default 沿用 style.css 的原始绿 / 黄 / 红；其余 12 组中，
       7 组取自「色组测试台.html」，5 组为新增主题；high 对应「偏高」、
       low 对应「偏低」、normal 对应「正确」。 */
    var PALETTES = [
        { id: "default", name: "经典", note: "绿 / 黄 / 红", strategy: "默认",
          normal: "#9fdf9f", low: "#fde68a", high: "#fca5a5" },
        { id: "BWG", name: "黑白灰", note: "单色明度", strategy: "灰 / 白 / 黑",
          normal: "#9CA3AF", low: "#E5E7EB", high: "#1F2937" },
        { id: "spiderman", name: "《蜘蛛侠》", note: "能力越大，责任越大", strategy: "深蓝战衣 / 蛛红 / 蛛纹黑",
          normal: "#22499cc9", low: "#e25858d3", high: "#464646d3" },
        { id: "eva01", name: "EVA 初号机", note: "不能逃！不能逃！不能逃！", strategy: "荧光绿线条 / 关节 / 装甲紫",
          normal: "#B6DF95", low: "#D5C0ED", high: "#695BC2" },
        { id: "lalaland", name: "《爱乐之城》", note: "Here's to the ones who dream, foolish as they may seem.", strategy: "蓝调夜色 / 黄裙 / 紫暮",
          normal: "#96ACDE", low: "#F8E7B5", high: "#815BC2" },
        { id: "watchmen", name: "《守望者》", note: "我在三十五钟前就已经动手了", strategy: "曼哈顿蓝 / 笑脸黄 / 锈红底",
          normal: "#5B7AC2", low: "#F8E7B5", high: "#E39C92" },
        { id: "space2001", name: "《2001太空漫游》", note: "打开舱门，哈尔", strategy: "临床白 / 太空黑 / HAL 红",
          normal: "#E0E0E0", low: "#0B0B14", high: "#E5576C" },
        { id: "yourname", name: "《你的名字。》", note: "君の名前は？", strategy: "彗星青蓝 / 夜蓝紫 / 结绳绯红",
          normal: "#96C4DE", low: "#5B70C2", high: "#F1BBC7" },
        { id: "sailormoon", name: "《美少女战士》", note: "我要代表月亮，惩罚你！", strategy: "樱粉 / 金月 / 水手蓝",
          normal: "#E58FAC", low: "#F8E7B5", high: "#5B77C2" },
        { id: "presswork", name: "印刷", note: "极简纸质", strategy: "纸灰 / 蓝 / 红",
          normal: "#D6D2C9", low: "#5A8FC9", high: "#C95A5A" },
        { id: "cherry", name: "樱花", note: "春樱冷暖", strategy: "粉白 / 樱红 / 雾蓝",
          normal: "#F0D8DC", low: "#D4607A", high: "#8AA8C0" },
        { id: "vaporwave", name: "蒸汽波", note: "霓虹梦境", strategy: "紫灰 / 天青 / 霓虹粉",
          normal: "#9B8BB5", low: "#01CDFE", high: "#FF71CE" },
        { id: "ivory", name: "象牙", note: "古典", strategy: "象牙白 / 藏青 / 酒红",
          normal: "#E8E0D0", low: "#3A5A8A", high: "#A84A4A" },
        { id: "linglong", name: "玉玲珑", note: "绿意", strategy: "玉绿 / 琥珀 / 紫罗兰",
          normal: "#A8D0B8", low: "#D0A050", high: "#9A7AB8" }   
    ];


    /* 色系配套数字色：每个色系一组基础色（n1~n5、负值 n-1~n-3），运行时按
       三态底色自动压深 / 提亮，保证数字在三态格上都清晰；默认色系不配置，
       继续沿用 style.css 中各 .n1 ~ .n-3 的原色。 */
    var PALETTE_NUMBERS = {
        spiderman: {
            n1: "#2f8fff", n2: "#ff3b3b", n3: "#ff6b6b", n4: "#1f4fd1", n5: "#8a1f1f",
            neg1: "#ff9f1c", neg2: "#e63946", neg3: "#b00020"
        },
        eva01: {
            n1: "#39ff88", n2: "#b6ff5a", n3: "#ff5c8a", n4: "#7dffc4", n5: "#d4a6ff",
            neg1: "#ffb347", neg2: "#ff7a59", neg3: "#ff4d6d"
        },
        lalaland: {
            n1: "#5aa9ff", n2: "#ffd166", n3: "#ff6b9a", n4: "#8fd3ff", n5: "#c77dff",
            neg1: "#ffb703", neg2: "#fb8500", neg3: "#e63946"
        },
        watchmen: {
            n1: "#4dabf7", n2: "#ffe066", n3: "#ff6b6b", n4: "#74c0fc", n5: "#e599f7",
            neg1: "#ffa94d", neg2: "#ff8787", neg3: "#fa5252"
        },
        space2001: {
            n1: "#7cc4ff", n2: "#ffffff", n3: "#ff4d4d", n4: "#a5d8ff", n5: "#b197fc",
            neg1: "#ffa94d", neg2: "#ff6b6b", neg3: "#ff3333"
        },
        yourname: {
            n1: "#4fc3f7", n2: "#ffd166", n3: "#ff6f91", n4: "#7c9cff", n5: "#b388ff",
            neg1: "#ff9f43", neg2: "#ff6b6b", neg3: "#d81b60"
        },
        sailormoon: {
            n1: "#4dabf7", n2: "#ffd43b", n3: "#ff6b9d", n4: "#74c0fc", n5: "#da77f2",
            neg1: "#ffa94d", neg2: "#ff8787", neg3: "#ff4d6d"
        },
        presswork: {
            n1: "#0b6fa8", n2: "#0f8a5f", n3: "#c62828", n4: "#1a3d6d", n5: "#6d1b1b",
            neg1: "#b26a00", neg2: "#a63a1f", neg3: "#8e1b1b"
        },
        cherry: {
            n1: "#3f6fb0", n2: "#2f8f63", n3: "#d6336c", n4: "#2a5588", n5: "#8a2f45",
            neg1: "#b5651d", neg2: "#c0392b", neg3: "#a61e4d"
        },
        vaporwave: {
            n1: "#00e5ff", n2: "#39ff14", n3: "#ff2d95", n4: "#7a5cff", n5: "#ff6ec7",
            neg1: "#ff9f1c", neg2: "#ff3860", neg3: "#ff00aa"
        },
        ivory: {
            n1: "#6fb0e0", n2: "#8fd39a", n3: "#ff8a8a", n4: "#a6c8ff", n5: "#e0a8ff",
            neg1: "#ffc46b", neg2: "#ff9e7a", neg3: "#ff7a7a"
        },
        linglong: {
            n1: "#2f7f6f", n2: "#2f8f4f", n3: "#b53a3a", n4: "#1f5f5f", n5: "#6b3f8f",
            neg1: "#8a5a1f", neg2: "#a0442a", neg3: "#8f2f3a"
        },
        BWG: {
            n1: "#2f7feb", n2: "#2fa96b", n3: "#e9514e", n4: "#23509a", n5: "#9c3733",
            neg1: "#c96a24", neg2: "#c94a2e", neg3: "#c93333"
        }
    };

    var PALETTE_NUM_STYLE = {
        spiderman: {
            contrast: 4.5,
            glow: "0 0 5px currentColor, 0 1px 0 rgba(0, 0, 0, .35)"
        },
        presswork: {
            contrast: 4.5,
            glow: "0 1px 0 rgba(255, 255, 255, .5), 0 1px 2px rgba(0, 0, 0, .18)"
        },
        cherry: {
            contrast: 4.5,
            glow: "0 0 6px rgba(255, 255, 255, .55)"
        },
        vaporwave: {
            contrast: 4.5,
            glow: "0 0 4px rgba(0, 229, 255, .95), 0 0 9px rgba(255, 45, 149, .8), 0 0 14px rgba(122, 92, 255, .5)"
        },
        yourname: {
            contrast: 4.5,
            glow: "0 0 6px rgba(255, 255, 255, .55), 0 0 2px rgba(0, 0, 0, .15)"
        }
    };

    /* 数字位与三态位的组合表：生成 --rm-num-<数字>-<状态> 变量，CSS 侧
       以 .cell-<状态>.n<数字> .cell-num 读取。 */
    var NUMBER_SLOTS = [
        { cls: "n1", var: "1", dataKey: "n1" },
        { cls: "n2", var: "2", dataKey: "n2" },
        { cls: "n3", var: "3", dataKey: "n3" },
        { cls: "n4", var: "4", dataKey: "n4" },
        { cls: "n5", var: "5", dataKey: "n5" },
        { cls: "n-1", var: "neg1", dataKey: "neg1" },
        { cls: "n-2", var: "neg2", dataKey: "neg2" },
        { cls: "n-3", var: "neg3", dataKey: "neg3" }
    ];
    var PALETTE_STATES = [
        { key: "valid", color: "normal" },
        { key: "low", color: "low" },
        { key: "over", color: "high" }
    ];

    /* 普通雷 emoji 候选：游戏内名称始终是「普通雷」，这里只决定图标与
       设置栏里的展示名。 */
    var MINE_EMOJIS = [
        { e: "💣", name: "经典" },
        { e: "🚩", name: "标记" },
        { e: "💩", name: "便便" },
        { e: "🐶", name: "旺财" },
        { e: "🐱", name: "咪咪" },
        { e: "🐰", name: "团子" },
        { e: "🐮", name: "牛啊" },
        { e: "🐸", name: "蛙啊" },
        { e: "🦐", name: "Niko" },
        { e: "🐳", name: "DeepSeek" },
        { e: "🐣", name: "259" },
        { e: "🏀", name: "篮球" },
        { e: "🎱", name: "黑8" },
        { e: "💰", name: "小金库" },
        { e: "🍟", name: "薯条" },
        { e: "🍉", name: "吃瓜" },
        { e: "🍎", name: "万有引力" },
        { e: "🌵", name: "仙人" },
        { e: "🍀", name: "幸运" },
        { e: "🤣", name: "哈哈哈" },
        { e: "🥰", name: "我喜欢你" },
        { e: "🫪", name: "我的老妈呀" },
        { e: "🦄", name: "独角" },
        { e: "🐼", name: "胖达" },
        { e: "🐡", name: "炸开" },
        { e: "🕊️", name: "鸽鸽" },
        { e: "🐝", name: "活力" },
        { e: "⚓", name: "锚" },
        { e: "⛄", name: "融化" },
        { e: "✈️", name: "起飞" },
        { e: "🍌", name: "一条大香蕉" },
        { e: "🪦", name: "RIP" },
        { e: "🤬", name: "艹" },
        { e: "😇", name: "L1Nzy" },
        { e: "🏆", name: "BLG牛逼" },
        { e: "🍾", name: "我们是冠军" }
    ];

    /* ---------- 2. 读取与校验 ---------- */

    function findBg(id) {
        for (var i = 0; i < BG_DEFS.length; i++) if (BG_DEFS[i].id === id) return BG_DEFS[i];
        return null;
    }
    function findPalette(id) {
        for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === id) return PALETTES[i];
        return null;
    }
    function findEmoji(e) {
        for (var i = 0; i < MINE_EMOJIS.length; i++) if (MINE_EMOJIS[i].e === e) return MINE_EMOJIS[i];
        return null;
    }

    var state = { bg: DEFAULT_STATE.bg, palette: DEFAULT_STATE.palette, mineEmoji: DEFAULT_STATE.mineEmoji };
    (function readSaved() {
        var saved = null;
        try {
            saved = window.Store ? Store.getJSON(STORE_KEY, null) : null;
        } catch (e) { saved = null; }
        if (!saved || typeof saved !== "object") return;
        if (typeof saved.bg === "string" && findBg(saved.bg)) state.bg = saved.bg;
        if (typeof saved.palette === "string" && findPalette(saved.palette)) state.palette = saved.palette;
        if (typeof saved.mineEmoji === "string" && findEmoji(saved.mineEmoji)) state.mineEmoji = saved.mineEmoji;
    })();

    function persist() {
        try {
            if (window.Store) Store.setJSON(STORE_KEY, state);
        } catch (e) {}
    }

    /* ---------- 3. 颜色工具（色系对比度） ---------- */

    function hexToRgb(hex) {
        var h = String(hex || "").replace("#", "");
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        return [ parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0 ];
    }
    function luminance(hex) {
        var rgb = hexToRgb(hex).map(function (v) {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    }
    /* 依据 WCAG 对比度选择深色或浅色文字，保证数字在三态底色上清晰 */
    function inkFor(hex) {
        var L = luminance(hex);
        var contrastDark = (L + 0.05) / 0.062;
        var contrastLight = 1.0 / (L + 0.05);
        return contrastDark >= contrastLight ? "#17202a" : "#f8fafc";
    }
    function hexToHsl(hex) {
        var rgb = hexToRgb(hex);
        var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var h = 0, s = 0, l = (max + min) / 2;
        if (max !== min) {
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
        }
        return [ h, s * 100, l * 100 ];
    }
    function strokeFor(hex) {
        var hsl = hexToHsl(hex);
        var l = Math.max(16, hsl[2] - 38);
        var s = Math.min(100, hsl[1] * 0.85);
        return "hsla(" + Math.round(hsl[0]) + ", " + Math.round(s) + "%, " + Math.round(l) + "%, 0.28)";
    }


    /* 两色相对对比度（WCAG），用于判断数字在三态底色上是否清晰 */
    function contrastRatio(a, b) {
        var la = luminance(a), lb = luminance(b);
        var hi = Math.max(la, lb), lo = Math.min(la, lb);
        return (hi + 0.05) / (lo + 0.05);
    }

    /* HSL（h 0~360、s/l 0~100）转 #rrggbb */
    function hslToHex(h, s, l) {
        h = ((h % 360) + 360) % 360;
        s /= 100;
        l /= 100;
        var c = (1 - Math.abs(2 * l - 1)) * s;
        var x = c * (1 - Math.abs((h / 60) % 2 - 1));
        var m = l - c / 2;
        var r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; }
        else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; }
        else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; }
        else { r = c; b = x; }
        function two(v) {
            var n = Math.round((v + m) * 255);
            n = n < 0 ? 0 : (n > 255 ? 255 : n);
            return (n < 16 ? "0" : "") + n.toString(16);
        }
        return "#" + two(r) + two(g) + two(b);
    }

    /**
     * 把一组数字基础色适配到当前三态底色。
     * 浅 / 中亮度底色统一压深（L=30 起），深色底统一提亮（L=82 起），
     * 色相与饱和度保持不变；对比度不足 3:1 时继续调整，最后兜底黑 / 白。
     * @param {string} baseHex 数字基础色
     * @param {string} bgHex 该状态的地块底色
     * @returns {string} 适配后的 #rrggbb
     */
    function numberInk(baseHex, bgHex, minContrast) {
        var min = minContrast || 3;
        var bgLum = luminance(bgHex);
        var darkText = bgLum > 0.16;
        var hsl = hexToHsl(baseHex);
        var l = darkText ? 30 : 82;
        var step = darkText ? -1 : 1;
        var out = hslToHex(hsl[0], hsl[1], l);
        var guard = 0;
        while (contrastRatio(out, bgHex) < min && guard < 100) {
            l += step;
            if (l <= 0) { l = 0; out = hslToHex(hsl[0], hsl[1], 0); break; }
            if (l >= 100) { l = 100; out = hslToHex(hsl[0], hsl[1], 100); break; }
            out = hslToHex(hsl[0], hsl[1], l);
            guard++;
        }
        if (contrastRatio(out, bgHex) < min) {
            return contrastRatio("#000000", bgHex) >= contrastRatio("#ffffff", bgHex) ? "#000000" : "#ffffff";
        }
        return out;
    }

    /* ---------- 4. 背景引擎 ---------- */

    var reduceMotion = false;
    try {
        reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) { reduceMotion = false; }

    var bgStage = document.getElementById("bgStage");
    var scenes = {};
    var activeBgId = null;
    var activeSceneEl = null;
    var activeCanvas = null;
    var activeCtx = null;
    var activeEffect = null;
    var effectW = 0;
    var effectH = 0;
    var effectT = 0;
    var lastFrame = 0;
    var rafId = 0;
    var resizeTimer = 0;
    var hideTimers = {};

    function make(tag, cls) {
        var el = document.createElement(tag);
        if (cls) el.className = cls;
        return el;
    }

    function buildAurora(el) {
        for (var i = 1; i <= 7; i++) el.appendChild(make("div", "aurora-curtain c" + i));
        el.appendChild(make("div", "aurora-glow"));
    }
    function buildGhosts(el) {
        var emojis = [ "👻", "💀", "😱", "😨", "😧", "🙀", "🥶", "😖" ];
        var count = window.innerWidth < 700 ? 10 : 16;
        for (var i = 0; i < count; i++) {
            var ghost = make("span", "ghost");
            ghost.textContent = emojis[i % emojis.length];
            ghost.style.left = (4 + Math.random() * 92) + "%";
            ghost.style.top = (4 + Math.random() * 92) + "%";
            ghost.style.fontSize = (16 + Math.random() * 34) + "px";
            ghost.style.opacity = (0.12 + Math.random() * 0.26).toFixed(2);
            ghost.style.animationDuration = (10 + Math.random() * 10) + "s";
            ghost.style.animationDelay = (-Math.random() * 20) + "s";
            el.appendChild(ghost);
        }
        var wisps = window.innerWidth < 700 ? 3 : 6;
        for (var w = 0; w < wisps; w++) {
            var wisp = make("div", "ghost-wisp");
            wisp.style.left = (4 + Math.random() * 90) + "%";
            wisp.style.top = (8 + Math.random() * 82) + "%";
            wisp.style.width = (55 + Math.random() * 40) + "px";
            wisp.style.height = (75 + Math.random() * 50) + "px";
            wisp.style.opacity = (0.16 + Math.random() * 0.22).toFixed(2);
            wisp.style.animationDuration = (10 + Math.random() * 8) + "s";
            wisp.style.animationDelay = (-Math.random() * 16) + "s";
            el.appendChild(wisp);
        }
    }
    function buildCandy(el) {
        for (var i = 1; i <= 4; i++) el.appendChild(make("div", "candy-blob c" + i));
        var sweets = [ "🍩", "🍪", "🍰", "🍫", "🍬", "🍭", "🍦", "🍧", "🍨", "🧁", "🍡" ];
        var count = window.innerWidth < 700 ? 8 : 14;
        for (var s = 0; s < count; s++) {
            var sweet = make("span", "candy-sweet");
            sweet.textContent = sweets[s % sweets.length];
            sweet.style.left = (4 + Math.random() * 92) + "%";
            sweet.style.top = (4 + Math.random() * 92) + "%";
            sweet.style.fontSize = (26 + Math.random() * 28) + "px";
            sweet.style.opacity = (0.55 + Math.random() * 0.35).toFixed(2);
            sweet.style.animationDuration = (12 + Math.random() * 12) + "s";
            sweet.style.animationDelay = (-Math.random() * 20) + "s";
            el.appendChild(sweet);
        }
    }
    function buildForest(el) {
        var colors = [ "rgba(250,204,21,.92)", "rgba(163,230,53,.88)", "rgba(125,211,252,.85)" ];
        var count = window.innerWidth < 700 ? 18 : 34;
        for (var i = 0; i < count; i++) {
            var fly = make("span", "forest-firefly");
            var size = 3 + Math.random() * 4;
            fly.style.width = size + "px";
            fly.style.height = size + "px";
            fly.style.left = (4 + Math.random() * 92) + "%";
            fly.style.top = (8 + Math.random() * 88) + "%";
            fly.style.background = colors[i % colors.length];
            fly.style.boxShadow = "0 0 12px 4px " + colors[i % colors.length];
            fly.style.animationDuration = (4 + Math.random() * 6) + "s";
            fly.style.animationDelay = (-Math.random() * 8) + "s";
            el.appendChild(fly);
        }
    }
    function buildRainforest(el) {
        for (var i = 1; i <= 4; i++) el.appendChild(make("div", "rainforest-ray r" + i));
        var colors = [
            "linear-gradient(160deg,rgba(6,95,70,.55),rgba(22,163,74,.22))",
            "linear-gradient(160deg,rgba(15,118,110,.5),rgba(52,211,153,.2))",
            "linear-gradient(160deg,rgba(22,101,52,.45),rgba(163,230,53,.18))"
        ];
        var count = window.innerWidth < 700 ? 6 : 9;
        for (var j = 0; j < count; j++) {
            var leaf = make("div", "rainforest-leaf");
            leaf.style.left = (2 + Math.random() * 96) + "%";
            leaf.style.top = (8 + Math.random() * 84) + "%";
            leaf.style.width = (50 + Math.random() * 100) + "px";
            leaf.style.height = (26 + Math.random() * 60) + "px";
            leaf.style.background = colors[j % colors.length];
            leaf.style.transform = "rotate(" + (-30 + Math.random() * 60) + "deg)";
            leaf.style.animationDuration = (10 + Math.random() * 10) + "s";
            leaf.style.animationDelay = (-Math.random() * 10) + "s";
            el.appendChild(leaf);
        }
    }

    /**
     * 给淡色纯色背景挂一层简单动效：波点 / 网格脉冲 / 点阵聚合 /
     * 贝塞尔小点 / 涟漪 / 柔光漂移。
     * @param {HTMLElement} el 场景节点
     * @param {Object} def 背景定义（effect / fx）
     * @sideeffect 向场景追加 .solid-fx 层与若干装饰节点
     */
    function buildSolidEffect(el, def) {
        var kind = def.effect;
        if (!kind) return;
        var layer = make("div", "solid-fx solid-fx-" + kind);
        layer.style.setProperty("--fx-color", def.fx || "#d8d0c0");
        var i, dot, size;

        if (kind === "bezier") {
            // 雾蓝：密集曲线小点，点径与透明度都比首版更明显
            for (i = 0; i < 48; i++) {
                dot = make("span", "solid-dot");
                size = (3 + Math.random() * 2.6).toFixed(2);
                dot.style.width = size + "px";
                dot.style.height = size + "px";
                dot.style.left = (3 + Math.random() * 94) + "%";
                dot.style.top = (3 + Math.random() * 94) + "%";
                dot.style.setProperty("--x1", ((Math.random() - .5) * 200).toFixed(0) + "px");
                dot.style.setProperty("--y1", ((Math.random() - .5) * 150).toFixed(0) + "px");
                dot.style.setProperty("--x2", ((Math.random() - .5) * 300).toFixed(0) + "px");
                dot.style.setProperty("--y2", ((Math.random() - .5) * 220).toFixed(0) + "px");
                dot.style.setProperty("--x3", ((Math.random() - .5) * 360).toFixed(0) + "px");
                dot.style.setProperty("--y3", ((Math.random() - .5) * 260).toFixed(0) + "px");
                dot.style.animationDuration = (7 + Math.random() * 5).toFixed(2) + "s";
                dot.style.animationDelay = (-Math.random() * 12).toFixed(2) + "s";
                layer.appendChild(dot);
            }
        }
        el.appendChild(layer);
    }

    /* Canvas 动效：与测试台最终版一致，只保留 11 套背景实际用到的 6 种 */
    var EFFECTS = {
        starfield: {
            init: function (w, h) {
                var count = Math.max(140, Math.min(280, Math.round(w * h / 7000)));
                this.stars = [];
                for (var i = 0; i < count; i++) {
                    this.stars.push({
                        x: Math.random() * w, y: Math.random() * h,
                        r: Math.random() * 1.2 + 0.25, p: Math.random() * Math.PI * 2,
                        col: [ "220,235,255", "191,219,254", "147,197,253", "253,230,138" ][i % 4]
                    });
                }
            },
            draw: function (ctx, w, h, t) {
                ctx.clearRect(0, 0, w, h);
                for (var i = 0; i < this.stars.length; i++) {
                    var st = this.stars[i];
                    var a = 0.28 + 0.62 * (0.5 + 0.5 * Math.sin(t * 1.5 + st.p));
                    ctx.fillStyle = "rgba(" + st.col + "," + a.toFixed(3) + ")";
                    ctx.beginPath();
                    ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
                    ctx.fill();
                }
                var cycle = t % 10;
                if (cycle < 1.1) {
                    var p = cycle / 1.1;
                    var sx = w * 0.7 + p * w * 0.2;
                    var sy = h * 0.16 + p * h * 0.14;
                    var g = ctx.createLinearGradient(sx, sy, sx - 130, sy - 100);
                    g.addColorStop(0, "rgba(255,255,255," + (0.8 * (1 - p)).toFixed(3) + ")");
                    g.addColorStop(1, "rgba(255,255,255,0)");
                    ctx.strokeStyle = g;
                    ctx.lineWidth = 1.4;
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(sx - 130, sy - 100);
                    ctx.stroke();
                }
            }
        },
        abyss: {
            init: function (w, h) {
                this.bubbles = [];
                var count = Math.max(20, Math.min(42, Math.round(w / 34)));
                for (var i = 0; i < count; i++) {
                    this.bubbles.push({
                        x: Math.random() * w, y: Math.random() * h,
                        r: 2 + Math.random() * 7, s: 14 + Math.random() * 36,
                        w: 0.4 + Math.random() * 1, ph: Math.random() * Math.PI * 2,
                        a: 4 + Math.random() * 18
                    });
                }
            },
            draw: function (ctx, w, h, t) {
                ctx.clearRect(0, 0, w, h);
                ctx.save();
                ctx.strokeStyle = "rgba(255,255,255,0.2)";
                ctx.lineWidth = 1.2;
                for (var i = 0; i < 4; i++) {
                    ctx.beginPath();
                    for (var x = -20; x <= w + 20; x += 22) {
                        var y = h * 0.16 + i * h * 0.14 + Math.sin(x * 0.02 + t * 0.5 + i) * 12 + Math.sin(x * 0.05 - t * 0.35) * 5;
                        if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                    }
                    ctx.stroke();
                }
                ctx.restore();
                for (var j = 0; j < this.bubbles.length; j++) {
                    var b = this.bubbles[j];
                    var yy = ((b.y - t * b.s) % (h + 120) + h + 120) % (h + 120) - 60;
                    var xx = b.x + Math.sin(t * b.w + b.ph) * b.a;
                    ctx.beginPath();
                    ctx.arc(xx, yy, b.r, 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(255,255,255,0.12)";
                    ctx.fill();
                    ctx.strokeStyle = "rgba(255,255,255,0.55)";
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(xx - b.r * 0.3, yy - b.r * 0.3, Math.max(0.8, b.r * 0.2), 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(255,255,255,0.8)";
                    ctx.fill();
                }
            }
        },
        sakura: {
            init: function (w, h) {
                var count = Math.max(34, Math.min(80, Math.round(w / 16)));
                this.petals = [];
                for (var i = 0; i < count; i++) {
                    this.petals.push({
                        x: Math.random() * w, y: Math.random() * h,
                        s: 5 + Math.random() * 7, vx: 6 + Math.random() * 16,
                        vy: 18 + Math.random() * 34, rot: Math.random() * Math.PI * 2,
                        spin: (Math.random() - 0.5) * 1.6, ph: Math.random() * Math.PI * 2,
                        a: 0.35 + Math.random() * 0.35
                    });
                }
            },
            draw: function (ctx, w, h, t) {
                ctx.clearRect(0, 0, w, h);
                for (var i = 0; i < this.petals.length; i++) {
                    var p = this.petals[i];
                    var x = (p.x + t * p.vx + Math.sin(t * 0.7 + p.ph) * 26) % (w + 80) - 40;
                    var y = (p.y + t * p.vy) % (h + 80) - 40;
                    ctx.save();
                    ctx.translate(x, y);
                    ctx.rotate(p.rot + t * p.spin);
                    ctx.beginPath();
                    ctx.ellipse(0, 0, p.s * 0.55, p.s, 0, 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(244,114,182," + p.a.toFixed(3) + ")";
                    ctx.fill();
                    ctx.restore();
                }
            }
        },
        rain: {
            init: function (w, h) {
                this.cols = [];
                var gap = 26;
                var count = Math.max(22, Math.floor(w / gap));
                for (var i = 0; i < count; i++) {
                    this.cols.push({
                        x: i * gap + gap / 2, y: Math.random() * h,
                        speed: 26 + Math.random() * 76, seed: Math.random() * 100
                    });
                }
            },
            draw: function (ctx, w, h, t) {
                ctx.clearRect(0, 0, w, h);
                ctx.font = "14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
                ctx.textAlign = "center";
                for (var i = 0; i < this.cols.length; i++) {
                    var c = this.cols[i];
                    var head = (c.y + t * c.speed) % (h + 240) - 40;
                    for (var j = 0; j < 12; j++) {
                        var y = head - j * 16;
                        if (y < -20 || y > h + 20) continue;
                        var code = 48 + Math.floor((c.seed + i * 7 + j * 3 + Math.floor(t * 2.2)) % 10);
                        var alpha = j === 0 ? 0.9 : Math.max(0, 0.55 - j * 0.042);
                        ctx.fillStyle = j === 0 ? "rgba(220,255,230," + alpha.toFixed(3) + ")" : "rgba(74,222,128," + alpha.toFixed(3) + ")";
                        ctx.fillText(String.fromCharCode(code), c.x, y);
                    }
                }
            }
        },
        mint: {
            init: function (w, h) {
                this.bubbles = [];
                var count = Math.max(24, Math.min(56, Math.round(w / 30)));
                for (var i = 0; i < count; i++) {
                    this.bubbles.push({
                        x: Math.random() * w, y: Math.random() * h,
                        r: 2 + Math.random() * 9, s: 16 + Math.random() * 42,
                        w: 0.4 + Math.random() * 1.1, ph: Math.random() * Math.PI * 2,
                        a: 5 + Math.random() * 20,
                        col: [ "255,255,255", "125,211,252", "167,243,208", "253,230,138" ][i % 4]
                    });
                }
            },
            draw: function (ctx, w, h, t) {
                ctx.clearRect(0, 0, w, h);
                for (var i = 0; i < this.bubbles.length; i++) {
                    var b = this.bubbles[i];
                    var y = ((b.y - t * b.s) % (h + 140) + h + 140) % (h + 140) - 70;
                    var x = b.x + Math.sin(t * b.w + b.ph) * b.a;
                    ctx.beginPath();
                    ctx.arc(x, y, b.r, 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(255,255,255,0.08)";
                    ctx.fill();
                    ctx.strokeStyle = "rgba(" + b.col + ",0.55)";
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(x - b.r * 0.3, y - b.r * 0.3, Math.max(0.8, b.r * 0.2), 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(255,255,255,0.75)";
                    ctx.fill();
                }
            }
        },
        neon: {
            init: function (w, h) {
                this.beams = [];
                for (var i = 0; i < 4; i++) {
                    this.beams.push({
                        off: Math.random() * w, speed: 30 + Math.random() * 70,
                        angle: [ -0.55, 0.35, -0.2, 0.6 ][i], width: 30 + Math.random() * 50,
                        col: [ "236,72,153", "34,211,238", "163,230,53", "168,85,247" ][i % 4]
                    });
                }
                this.particles = [];
                for (var j = 0; j < 40; j++) {
                    this.particles.push({
                        x: Math.random() * w, y: Math.random() * h,
                        r: 0.8 + Math.random() * 2, s: 8 + Math.random() * 30,
                        p: Math.random() * Math.PI * 2
                    });
                }
            },
            draw: function (ctx, w, h, t) {
                ctx.clearRect(0, 0, w, h);
                ctx.save();
                ctx.globalCompositeOperation = "lighter";
                for (var i = 0; i < this.beams.length; i++) {
                    var b = this.beams[i];
                    var x = ((b.off + t * b.speed) % (w + 500)) - 250;
                    ctx.save();
                    ctx.translate(x, -h * 0.2);
                    ctx.rotate(b.angle);
                    var g = ctx.createLinearGradient(0, 0, 0, h * 1.6);
                    g.addColorStop(0, "rgba(" + b.col + ",0)");
                    g.addColorStop(0.45, "rgba(" + b.col + ",0.32)");
                    g.addColorStop(1, "rgba(" + b.col + ",0)");
                    ctx.fillStyle = g;
                    ctx.fillRect(0, 0, b.width, h * 1.6);
                    ctx.restore();
                }
                ctx.restore();
                for (var j = 0; j < this.particles.length; j++) {
                    var p = this.particles[j];
                    var y = (p.y - t * p.s) % (h + 40);
                    if (y < -20) y += h + 40;
                    var x2 = p.x + Math.sin(t * 0.6 + p.p) * 14;
                    ctx.beginPath();
                    ctx.arc(x2, y, p.r, 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(255,255,255,0.65)";
                    ctx.fill();
                }
            }
        }
    };

    function ensureScene(def) {
        if (scenes[def.id]) return scenes[def.id];
        var el = make("div", "bg-scene");
        el.setAttribute("data-bg", def.id);
        el.style.display = "none";
        var canvas = null;
        if (def.type === "canvas") {
            canvas = make("canvas", "bg-canvas");
            el.appendChild(canvas);
        } else if (def.id === "aurora") buildAurora(el);
        else if (def.id === "ghosts") buildGhosts(el);
        else if (def.id === "candy") buildCandy(el);
        else if (def.id === "forest") buildForest(el);
        else if (def.id === "rainforest") buildRainforest(el);
        else if (def.effect) buildSolidEffect(el, def);
        if (bgStage) bgStage.appendChild(el);
        scenes[def.id] = { el: el, canvas: canvas };
        return scenes[def.id];
    }

    function fitCanvas(canvas) {
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var w = canvas.clientWidth || window.innerWidth;
        var h = canvas.clientHeight || window.innerHeight;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        activeCtx = canvas.getContext("2d");
        if (!activeCtx) return false;
        activeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        effectW = w;
        effectH = h;
        return true;
    }

    function stopEffect() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        activeCanvas = null;
        activeCtx = null;
        activeEffect = null;
    }

    function startEffect(def) {
        stopEffect();
        var entry = scenes[def.id];
        if (!entry || !entry.canvas) return;
        activeCanvas = entry.canvas;
        activeEffect = EFFECTS[def.id];
        if (!activeEffect) return;
        if (!fitCanvas(activeCanvas)) return;
        activeEffect.init(effectW, effectH);
        activeEffect.draw(activeCtx, effectW, effectH, 0);
        effectT = 0;
        lastFrame = performance.now();
        if (reduceMotion) return;
        function frame(now) {
            rafId = requestAnimationFrame(frame);
            var dt = Math.min(0.05, (now - lastFrame) / 1000);
            lastFrame = now;
            if (document.hidden) return;
            effectT += dt;
            if (activeEffect && activeCtx) activeEffect.draw(activeCtx, effectW, effectH, effectT);
        }
        rafId = requestAnimationFrame(frame);
    }

    /* 切换背景：none 直接隐藏场景层；其余场景淡入，旧场景 800ms 后隐藏 */
    function activateBackground(id, silent) {
        var def = findBg(id);
        if (!def) return;
        if (!bgStage && def.id !== "none") return;

        if (def.id === "none") {
            state.bg = "none";
            activeBgId = "none";
            if (activeSceneEl) {
                activeSceneEl.classList.remove("active");
                var oldNone = activeSceneEl;
                clearTimeout(hideTimers.__old);
                hideTimers.__old = setTimeout(function () {
                    if (!oldNone.classList.contains("active")) oldNone.style.display = "none";
                }, 900);
            }
            activeSceneEl = null;
            stopEffect();
            document.body.classList.remove("custom-bg", "bg-tone-dark", "bg-tone-light", "bg-flat");
            if (bgStage) {
                bgStage.style.display = "none";
                bgStage.style.background = "";
            }
            return;
        }

        var entry = ensureScene(def);
        if (!entry) return;
        if (bgStage) bgStage.style.display = "block";
        document.body.classList.add("custom-bg");
        document.body.classList.toggle("bg-tone-dark", def.tone === "dark");
        document.body.classList.toggle("bg-tone-light", def.tone === "light");
        // 淡色纯色背景：去掉暗角，并让场景层底色跟随主题，切换时不闪黑
        document.body.classList.toggle("bg-flat", !!def.flat);
        if (bgStage) bgStage.style.background = (def.flat && def.color) ? def.color : "";

        if (activeSceneEl && activeSceneEl !== entry.el) {
            var oldEl = activeSceneEl;
            oldEl.classList.remove("active");
            clearTimeout(hideTimers[oldEl.getAttribute("data-bg")]);
            hideTimers[oldEl.getAttribute("data-bg")] = setTimeout(function () {
                if (!oldEl.classList.contains("active")) oldEl.style.display = "none";
            }, 900);
        }

        clearTimeout(hideTimers[def.id]);
        entry.el.style.display = "block";
        if (silent) entry.el.classList.add("no-transition");
        void entry.el.offsetWidth;
        entry.el.classList.add("active");
        activeSceneEl = entry.el;
        activeBgId = def.id;
        state.bg = def.id;
        if (silent) {
            setTimeout(function () { entry.el.classList.remove("no-transition"); }, 80);
        }
        if (def.type === "canvas") startEffect(def);
        else stopEffect();
    }

    /* ---------- 5. 三态色系与普通雷 ---------- */

    var rootStyle = document.documentElement.style;

    function clearPaletteVars() {
        var names = [ "--rm-cell-valid", "--rm-cell-low", "--rm-cell-over",
            "--rm-cell-valid-stroke", "--rm-cell-low-stroke", "--rm-cell-over-stroke",
            "--rm-cell-ink-valid", "--rm-cell-ink-low", "--rm-cell-ink-over",
            "--rm-num-glow" ];
        // 数字色变量共 8 位 × 3 态，切换色系 / 回到默认时一并清除
        NUMBER_SLOTS.forEach(function (slot) {
            PALETTE_STATES.forEach(function (st) {
                names.push("--rm-num-" + slot.var + "-" + st.key);
            });
        });
        names.forEach(function (name) {
            rootStyle.removeProperty(name);
        });
    }

    function applyPalette(id) {
        var p = findPalette(id) || findPalette("default");
        state.palette = p.id;
        clearPaletteVars();
        if (p.id === "default") return;
        rootStyle.setProperty("--rm-cell-valid", p.normal);
        rootStyle.setProperty("--rm-cell-low", p.low);
        rootStyle.setProperty("--rm-cell-over", p.high);
        rootStyle.setProperty("--rm-cell-valid-stroke", strokeFor(p.normal));
        rootStyle.setProperty("--rm-cell-low-stroke", strokeFor(p.low));
        rootStyle.setProperty("--rm-cell-over-stroke", strokeFor(p.high));
        rootStyle.setProperty("--rm-cell-ink-valid", inkFor(p.normal));
        rootStyle.setProperty("--rm-cell-ink-low", inkFor(p.low));
        rootStyle.setProperty("--rm-cell-ink-over", inkFor(p.high));

        // 数字专项色：每个色系 8 个基础色，按三态底色逐格适配后写入变量
        var numbers = PALETTE_NUMBERS[p.id];
        if (!numbers) return;
        var numStyle = PALETTE_NUM_STYLE[p.id] || {};
        var minContrast = numStyle.contrast || 3;
        PALETTE_STATES.forEach(function (st) {
            var bg = p[st.color];
            NUMBER_SLOTS.forEach(function (slot) {
                var base = numbers[slot.dataKey];
                if (!base) return;
                rootStyle.setProperty(
                    "--rm-num-" + slot.var + "-" + st.key,
                    numberInk(base, bg, minContrast)
                );
            });
        });
        if (numStyle.glow) rootStyle.setProperty("--rm-num-glow", numStyle.glow);
    }

    /* 更新页面上所有普通雷图标的文字；只改叶子节点，避免破坏卡片结构 */
    function paintNormalEmoji(emoji) {
        var nodes = document.querySelectorAll(".normal-bomb");
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].childElementCount === 0) nodes[i].textContent = emoji;
        }
    }

    function applyMineEmoji(emoji, silent) {
        var item = findEmoji(emoji) || findEmoji("💣");
        state.mineEmoji = item.e;
        if (typeof M !== "undefined" && M.normal) M.normal.e = item.e;
        paintNormalEmoji(item.e);
        if (silent) return;
        try {
            if (typeof renderSlot === "function") renderSlot();
        } catch (e) {
            if (window.RM && RM.warn) RM.warn("personalize:renderSlot", e);
        }
        try {
            if (typeof renderMineInfo === "function" && document.getElementById("mineInfoList")) renderMineInfo();
        } catch (e2) {
            if (window.RM && RM.warn) RM.warn("personalize:renderMineInfo", e2);
        }
    }

    /* ---------- 6. 设置栏 UI ---------- */

    var bgGrid = document.getElementById("bgChoiceGrid");
    var bgName = document.getElementById("bgChoiceName");
    var paletteGrid = document.getElementById("paletteChoiceGrid");
    var paletteName = document.getElementById("paletteChoiceName");
    var emojiGrid = document.getElementById("mineEmojiGrid");
    var emojiName = document.getElementById("mineEmojiChoiceName");

    /**
     * 展开 / 收起个性定制中的一个项目。
     *
     * 三个项目互相独立（不采用手风琴互斥）：玩家可以同时展开背景与色系
     * 进行对照；展开状态只属于本次页面会话，不写入存档。
     * @param {string} id 项目元素 id：persBg / persPalette / persEmoji
     * @sideeffect 切换 pers-acc-open / pers-acc-closed 类、aria-expanded 与音效
     */
    function togglePersAcc(id) {
        var el = document.getElementById(id);
        if (!el) return;
        var willOpen = !el.classList.contains("pers-acc-open");
        el.classList.toggle("pers-acc-open", willOpen);
        el.classList.toggle("pers-acc-closed", !willOpen);
        var head = el.querySelector(".pers-acc-head");
        if (head) head.setAttribute("aria-expanded", willOpen ? "true" : "false");
        try {
            if (window.AudioFX && AudioFX.pop) AudioFX.pop();
        } catch (e) {}
    }
    window.togglePersAcc = togglePersAcc;

    function setPressed(host, attr, value) {
        if (!host) return;
        var items = host.querySelectorAll("[" + attr + "]");
        for (var i = 0; i < items.length; i++) {
            var on = items[i].getAttribute(attr) === value;
            items[i].setAttribute("aria-pressed", on ? "true" : "false");
            items[i].classList.toggle("active", on);
        }
    }

    function syncUI() {
        setPressed(bgGrid, "data-bg-id", state.bg);
        setPressed(paletteGrid, "data-palette-id", state.palette);
        setPressed(emojiGrid, "data-emoji", state.mineEmoji);
        var bg = findBg(state.bg);
        if (bgName) bgName.textContent = bg ? bg.name : "默认";
        var p = findPalette(state.palette);
        if (paletteName) paletteName.textContent = p ? p.name : "经典";
        var e = findEmoji(state.mineEmoji);
        if (emojiName) emojiName.textContent = e ? e.name : "经典炸弹";
    }

    function buildBgGrid() {
        if (!bgGrid) return;
        var frag = document.createDocumentFragment();
        BG_DEFS.forEach(function (def) {
            var btn = make("button", "bg-choice");
            btn.type = "button";
            btn.setAttribute("data-bg-id", def.id);
            btn.title = def.name + " · " + def.desc;
            var thumb = make("span", "bg-choice-thumb");
            thumb.style.background = def.thumb;
            var glyph = make("span", "bg-choice-glyph");
            glyph.textContent = def.glyph;
            thumb.appendChild(glyph);
            var name = make("span", "bg-choice-name");
            name.textContent = def.name;
            btn.appendChild(thumb);
            btn.appendChild(name);
            btn.addEventListener("click", function () {
                window.RMPersonalize.setBackground(def.id);
            });
            frag.appendChild(btn);
        });
        bgGrid.appendChild(frag);
    }

    function buildPaletteGrid() {
        if (!paletteGrid) return;
        var frag = document.createDocumentFragment();
        PALETTES.forEach(function (p) {
            var btn = make("button", "pal-choice");
            btn.type = "button";
            btn.setAttribute("data-palette-id", p.id);
            btn.title = p.name + " · " + p.note;
            var strip = make("span", "pal-choice-strip");
            [ p.normal, p.low, p.high ].forEach(function (hex) {
                var i = make("i");
                i.style.background = hex;
                strip.appendChild(i);
            });
            var name = make("span", "pal-choice-name");
            name.textContent = p.name;
            var sub = make("span", "pal-choice-sub");
            sub.textContent = p.strategy;
            btn.appendChild(strip);
            btn.appendChild(name);
            btn.appendChild(sub);
            btn.addEventListener("click", function () {
                window.RMPersonalize.setPalette(p.id);
            });
            frag.appendChild(btn);
        });
        paletteGrid.appendChild(frag);
    }

    function buildEmojiGrid() {
        if (!emojiGrid) return;
        var frag = document.createDocumentFragment();
        MINE_EMOJIS.forEach(function (item) {
            var btn = make("button", "emoji-choice");
            btn.type = "button";
            btn.setAttribute("data-emoji", item.e);
            btn.title = item.name ;
            var glyph = make("span", "emoji-choice-glyph");
            glyph.textContent = item.e;
            var name = make("span", "emoji-choice-name");
            name.textContent = item.name;
            btn.appendChild(glyph);
            btn.appendChild(name);
            btn.addEventListener("click", function () {
                window.RMPersonalize.setMineEmoji(item.e);
            });
            frag.appendChild(btn);
        });
        emojiGrid.appendChild(frag);
    }

    /* ---------- 7. 对外接口与初始化 ---------- */

    window.RMPersonalize = {
        setBackground: function (id) {
            var def = findBg(id);
            if (!def) return false;
            activateBackground(def.id, false);
            syncUI();
            persist();
            return true;
        },
        setPalette: function (id) {
            var p = findPalette(id);
            if (!p) return false;
            applyPalette(p.id);
            syncUI();
            persist();
            return true;
        },
        setMineEmoji: function (emoji) {
            if (!findEmoji(emoji)) return false;
            applyMineEmoji(emoji, false);
            syncUI();
            persist();
            return true;
        },
        getState: function () {
            return { bg: state.bg, palette: state.palette, mineEmoji: state.mineEmoji };
        },
        reset: function () {
            state.bg = DEFAULT_STATE.bg;
            state.palette = DEFAULT_STATE.palette;
            state.mineEmoji = DEFAULT_STATE.mineEmoji;
            activateBackground(state.bg, false);
            applyPalette(state.palette);
            applyMineEmoji(state.mineEmoji, false);
            syncUI();
            persist();
        }
    };

    buildBgGrid();
    buildPaletteGrid();
    buildEmojiGrid();
    applyPalette(state.palette);
    applyMineEmoji(state.mineEmoji, true);
    activateBackground(state.bg, true);
    syncUI();

    /* 窗口尺寸变化：重新适配当前 Canvas 背景（防抖，避免拖动窗口时反复重建） */
    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            var def = findBg(activeBgId);
            if (def && def.type === "canvas" && activeSceneEl) startEffect(def);
        }, 220);
    });

    /* 页面回到前台时，若当前是 Canvas 背景且未在播放（例如减少动效模式下
       只画了一帧），补一帧静态画面，避免尺寸变化后画布空白 */
    document.addEventListener("visibilitychange", function () {
        if (document.hidden) return;
        var def = findBg(activeBgId);
        if (def && def.type === "canvas" && !rafId && activeEffect && activeCtx) {
            activeEffect.draw(activeCtx, effectW, effectH, effectT);
        }
    });
})();
