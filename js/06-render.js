/* ==========================================================================
 * 模块 06 · 渲染引擎（js/06-render.js）
 *
 * 职责：把 G.tar / G.p / G.placed 三份状态映射到棋盘 DOM，并维护地雷槽、
 *       影响值提示开关与拖拽落点效果预览；是"状态 -> 界面"的主要出口。
 * 依赖：G、SR/SC、selectedMineType（00-core）；M（04）；computeInfluenceMap
 *       （05-generator）；calcCellSize、applyBoardMetrics、sizeCellsIn、
 *       bindCellsIn、bindCellDrag、bindSlotItemDrag（07-board）；AudioFX；
 *       Store（01-storage）；checkWin（08-ui）；教学渲染分支（09-tutorial）。
 * 对外：render、renderSlot、setInfluenceHint、toggleInfluenceHint、
 *       setEffectPreview、toggleEffectPreview、previewPlacementEffect、
 *       clearPlacementPreview、appendInfluenceBadge、RM.renderEngine。
 * 设计要点：
 *   1) 采用差量渲染：棋盘网格只在尺寸变化或结构校验失败时重建，之后每次
 *      只更新发生变化的格子，避免整盘重建导致落雷动画重播与焦点丢失。
 *   2) 渲染前做状态体检、渲染后做 DOM 与状态的一致性校验，任一层校验失败
 *      都升级为全量重建，保证界面最终与状态一致。
 *   3) 事件统一委托在棋盘容器上，网格重建后无需重新绑定点击与右键事件。
 * ========================================================================== */

/* ---------- 1. 影响值提示开关 ---------- */
// 初始化时读取存档中的开关状态，未存过则默认关闭
let influenceHintOn = Store.get("mineInfluenceHint") === "true";

/**
 * 设置"显示影响值差异"开关：写存档、同步按钮状态，必要时整盘重绘一次。
 * silent 为真时只做状态与按钮同步，不发声、不重绘，供初始化批量调用。
 * @param {boolean} on 是否开启
 * @param {boolean} [silent] 是否静默
 * @sideeffect 写 Store、改 #influenceHintToggle 的 class，可能调用 render
 */
function setInfluenceHint(on, silent) {
    influenceHintOn = !!on;
    // 存储写入失败不影响本次会话内的开关状态
    try {
        Store.set("mineInfluenceHint", influenceHintOn ? "true" : "false");
    } catch (e) {}
    let tg = document.getElementById("influenceHintToggle");
    if (tg) tg.classList.toggle("on", influenceHintOn);
    // 非静默切换时给一声提示音
    if (!silent && typeof AudioFX !== "undefined" && AudioFX.toggle) AudioFX.toggle(influenceHintOn);
    // 静默模式到此为止：不触发重绘
    if (silent) return;
    // 创造模式有独立棋盘，主棋盘无需重绘
    if (typeof createModeActive !== "undefined" && createModeActive) return;
    // 状态尚未就绪（例如还没开局）时不绘制，避免读到空矩阵
    if (typeof G === "undefined" || !G.tar || G.tar.length !== SR) return;
    // 开关影响角标显示，需要整盘刷新一次
    if (typeof render === "function") render();
}

/**
 * 切换影响值提示开关（按钮 onclick 入口）。
 */
function toggleInfluenceHint() {
    setInfluenceHint(!influenceHintOn);
}

/* ---------- 1.1 效果预览：拖拽落点预演 ---------- */
// 初始化时读取存档中的开关状态，未存过则默认关闭
let effectPreviewOn = Store.get("mineEffectPreview") === "true";

// 预览签名：记录当前正在预演"哪个雷型放在哪一格"，同一位置不重复结算
let _previewSig = "";

/**
 * 设置"效果预览"开关：写存档、同步按钮状态，关闭时立即收起预览。
 * @param {boolean} on 是否开启
 * @param {boolean} [silent] 是否静默（初始化时用，不发声）
 * @sideeffect 写 Store、切换 #effectPreviewToggle 的 class，关闭时清除预览高亮
 */
function setEffectPreview(on, silent) {
    effectPreviewOn = !!on;
    try {
        Store.set("mineEffectPreview", effectPreviewOn ? "true" : "false");
    } catch (e) {}
    let tg = document.getElementById("effectPreviewToggle");
    if (tg) tg.classList.toggle("on", effectPreviewOn);
    if (!silent && typeof AudioFX !== "undefined" && AudioFX.toggle) AudioFX.toggle(effectPreviewOn);
    if (!effectPreviewOn) clearPlacementPreview();
}

/**
 * 切换效果预览开关（按钮 onclick 入口）。
 */
function toggleEffectPreview() {
    setEffectPreview(!effectPreviewOn);
}

/**
 * 清掉棋盘上已加的预览类与预览数值，但不改动预览签名。
 * @sideeffect 移除受影响格的 rm-preview-* 类与 data-preview-val
 */
function clearPreviewCells() {
    let host = document.getElementById("board");
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll(".rm-preview-valid, .rm-preview-low, .rm-preview-over"), function(el) {
        el.classList.remove("rm-preview-valid", "rm-preview-low", "rm-preview-over", "rm-preview-wide");
        el.removeAttribute("data-preview-val");
    });
}

/**
 * 结束一次预览：清除高亮并复位签名，下次悬停会重新结算。
 * @sideeffect 清除 rm-preview-* 类与预览数值
 */
function clearPlacementPreview() {
    _previewSig = "";
    clearPreviewCells();
}

/**
 * 解析从槽位拖出时的雷型：优先取当前选中的雷型，主棋盘再回落到上次拖拽类型。
 * @param {string} kind 棋盘标识 main / teach
 * @returns {string|null} 雷型 key，无法判定时为 null
 */
function previewDragType(kind) {
    let t = getSelectedType(kind);
    if (!t && kind === "main") t = G.lastDragType;
    return t || null;
}

/**
 * 判断一次落点预演是否值得展示：目标格必须为空，非移动时还要满足该雷型的配额。
 * @param {string} kind 棋盘标识 main / teach
 * @param {string} key 目标格坐标键
 * @param {string|null} type 雷型 key
 * @param {boolean} moving 是否在移动棋盘上已有的雷
 * @returns {boolean} true 表示该落点合法、可以预览
 */
function isPreviewDropLegal(kind, key, type, moving) {
    if (!type || !M[type]) return false;
    if (G.placed[key]) return false;
    if (moving) return true;
    return !slotTypeFull(type, kind);
}

/**
 * 拖动中指针悬浮在格子上时预演这一步的净效果：对影响值会变化的地块，
 * 直接显示"放置后"的三态配色，并在左下角显示放置后的影响值。
 * 移动棋盘上已有的雷时，同时预演"移走旧雷 + 放下新雷"的合并结果。
 * @param {string} kind 棋盘标识 main / teach
 * @param {HTMLElement} cell 当前悬停格
 * @param {string} [moveFrom] 触屏拖拽时由调用方显式传入的拖动起点；省略时按 G.drag 判断
 * @sideeffect 给受影响格加 rm-preview-* 类与 data-preview-val，并清除上一处预览
 */
function previewPlacementEffect(kind, cell, moveFrom) {
    if (!effectPreviewOn || !cell || !cell.dataset || window._placeMode !== "drag") return;
    if (kind !== "main" && kind !== "teach") return;
    // 棋子尚未生成或尺寸不匹配时不预演，避免读到空矩阵
    if (!G.tar || !G.p || G.tar.length !== SR || G.p.length !== SR || !SR || !SC) return;
    const r = +cell.dataset.r, c = +cell.dataset.c;
    if (r < 0 || c < 0 || r >= SR || c >= SC) return;
    const key = r + "," + c;
    // 鼠标拖拽用 G.drag 判断是否在移动已有雷；触屏拖拽没有 G.drag，由调用方传入起点
    const explicitFrom = typeof moveFrom === "string";
    const moving = explicitFrom ? !!G.placed[moveFrom] : !!(G.drag && G.placed[G.drag]);
    const fromKey = moving ? (explicitFrom ? moveFrom : G.drag) : "";
    const type = moving ? G.placed[fromKey] : previewDragType(kind);
    const sig = kind + "|" + key + "|" + (type || "") + "|" + fromKey;
    // 同一格连续触发只结算一次
    if (sig === _previewSig) return;
    _previewSig = sig;
    clearPreviewCells();
    // 原地不动或非法落点：清掉旧预览后直接返回
    if (fromKey === key || !isPreviewDropLegal(kind, key, type, moving)) return;
    const placed2 = {};
    for (let k in G.placed) placed2[k] = G.placed[k];
    if (moving) delete placed2[fromKey];
    placed2[key] = type;
    const p2 = computeInfluenceMap(placed2);
    const host = document.getElementById("board");
    if (!host) return;
    for (let i = 0; i < SR; i++) {
        for (let j = 0; j < SC; j++) {
            // 只标注影响值真的会变化的地块
            if (p2[i][j] === G.p[i][j]) continue;
            const el = host.children[i * SC + j];
            if (!el || !el.classList || !el.classList.contains("cell")) continue;
            const tar = G.tar[i][j];
            el.classList.add(p2[i][j] === tar ? "rm-preview-valid" : (p2[i][j] < tar ? "rm-preview-low" : "rm-preview-over"));
            // 两位数（含负号）时收窄字号，避免预览数字溢出格子
            if (Math.abs(p2[i][j]) >= 10) el.classList.add("rm-preview-wide");
            el.dataset.previewVal = String(p2[i][j]);
        }
    }
}

/**
 * 为单格追加影响值角标（静态绘制路径使用）：把格内数字包进 .cell-num 以便
 * 角标定位，再按"当前值高于/低于目标值"选择配色。
 * @param {HTMLElement} cell 目标格
 * @param {number} cur 当前影响值
 * @param {number} tar 目标影响值
 * @sideeffect 改写 cell 的子节点与 class
 */
function appendInfluenceBadge(cell, cur, tar) {
    // 开关关闭时不做任何 DOM 变更
    if (!influenceHintOn) return;
    // 影响值为 0 或已经与目标一致时无需提示
    if (cur === 0 || cur === tar) return;
    // 把独立的文本节点包成 span，后续角标才能用绝对定位叠加
    for (let i = 0; i < cell.childNodes.length; i++) {
        const n = cell.childNodes[i];
        if (n.nodeType === 3 && n.nodeValue.trim() !== "") {
            const numSpan = document.createElement("span");
            numSpan.className = "cell-num";
            numSpan.textContent = n.nodeValue.trim();
            cell.replaceChild(numSpan, n);
            break;
        }
    }
    cell.classList.add("has-influence");
    let badge = document.createElement("div");
    // 高于目标显示警告色，低于目标显示提示色
    let cls = "cell-influence " + (cur > tar ? "influence-over" : "influence-low");
    // 两位数角标加宽，避免文字溢出格子
    if (Math.abs(cur) >= 10) cls += " influence-wide";
    badge.className = cls;
    badge.textContent = cur;
    cell.appendChild(badge);
}

/* ---------- 2. 渲染引擎设计说明：为什么差量、如何保证一致 ---------- */
/* 为什么用差量渲染
 *   整盘 innerHTML 重建在 20x20 时意味着新建 400 个节点并重绑事件，而且每次
 *   落雷都会重播所有已放置雷的落雷动画，玩家越到后期界面越抖。差量引擎只在
 *   首次进入或结构不可信时重建网格，之后按"状态变化"局部更新：
 *     · 点击/右键统一走事件委托，网格重建后不需要重新绑定；
 *     · 只有本次新增的那一颗雷播放落雷动画，其余格子保持静止；
 *     · 固定复用 .cell-num / .cell-mine 两个子节点，更新时只改内容不换节点。
 *
 * 一致性分层校验（从便宜到昂贵）
 *   1) 状态体检：G.tar / G.p 的行列数必须与 SR/SC 一致，否则不绘制并记日志；
 *   2) 网格体检：节点数、父子关系、data-r/data-c 逐格核对，不符就整块重建；
 *   3) 尺寸变化：窗口缩放导致格子边长变化时重新应用棋盘度量；
 *   4) 更新异常：单格更新抛异常时改为整块重建后再更新一遍；
 *   5) 结果不变量：绘制完成后 DOM 上的 .mine-here 数量必须等于 G.placed
 *      的键数，不等就强制重建（这是最后一道一致性闸门）；
 *   6) 最小绘制：连重建都抛异常时，用 legacyRender 画一版静态棋盘，
 *      保证任何情况下玩家都能看到棋盘。
 */

/* ---------- 3. 视图状态与日志 ---------- */
/* 引擎以 IIFE 封装内部视图状态，外部只能通过 RM.renderEngine 访问 */
(function() {
    "use strict";

    // 视图缓存：DOM 引用、网格尺寸、单元格引用与动画/重建标记
    var view = {
        host: null,
        rows: 0,
        cols: 0,
        cells: null,
        animEl: null,
        delegated: false,       // 事件是否已委托：网格重建不重复绑定
        forceRebuild: false,    // 外部要求下一帧整块重建
        rebuilds: 0             // 累计全量重建次数，供调试与自检读取
    };

    /**
     * 记录渲染层日志；RM 未就绪时静默丢弃，记录失败不能影响绘制。
     * @param {string} where 日志来源
     * @param {*} e 错误对象或说明
     */
    function log(where, e) {
        if (window.RM) RM.warn(where, e);
    }

    /* ---------- 4. 状态体检 ---------- */
    /**
     * 状态体检：G.tar / G.p 必须是 SR x SC 的二维矩阵。
     * @returns {boolean} 状态可用于绘制时返回 true
     */
    function stateHealthy() {
        // 行数与列数任一项不匹配都不绘制，宁可空白也不画错
        return !!(G && G.tar && G.p &&
            G.tar.length === SR && G.p.length === SR &&
            G.tar[0] && G.p[0] &&
            G.tar[0].length === SC && G.p[0].length === SC);
    }

    /* ---------- 5. 建格与整块重建 ---------- */
    /**
     * 创建一个格子节点，固定包含数字与地雷两个子节点，后续更新只改内容不换节点。
     * @param {number} r 行号
     * @param {number} c 列号
     * @returns {HTMLElement} 未挂载的 .cell 节点
     */
    function makeCell(r, c) {
        var d = document.createElement("div");
        d.className = "cell";
        d.dataset.r = r;
        d.dataset.c = c;
        // 子节点顺序固定：childNodes[0] 数字、childNodes[1] 地雷，更新逻辑依赖该约定
        var num = document.createElement("span");
        num.className = "cell-num";
        d.appendChild(num);
        var mine = document.createElement("span");
        mine.className = "cell-mine";
        mine.style.display = "none";
        d.appendChild(mine);
        return d;
    }

    /**
     * 整块重建棋盘：清空容器、应用棋盘度量、逐格创建节点并重新绑定事件。
     * @param {HTMLElement} host 棋盘容器
     * @sideeffect 覆盖 host 的内容，并重置 view 中的缓存引用
     */
    function fullBuild(host) {
        // 清空容器后按当前棋盘尺寸重新建格
        host.innerHTML = "";
        applyBoardMetrics(host, SR, SC);
        var cells = new Array(SR);
        for (var r = 0; r < SR; r++) {
            cells[r] = new Array(SC);
            for (var c = 0; c < SC; c++) {
                var d = makeCell(r, c);
                cells[r][c] = d;
                host.appendChild(d);
            }
        }
        view.host = host;
        view.rows = SR;
        view.cols = SC;
        view.cells = cells;
        view.animEl = null;
        // 统计重建次数，便于观察是否出现异常频繁重建
        view.rebuilds++;
        host.classList.add("rm-diff");   // 标记：本棋盘由差量引擎托管
        // 建格后统一设置尺寸、拖拽绑定与事件委托
        sizeCellsIn(host);
        bindCellsIn(host, "main");
        installDelegates(host);
    }

    /* ---------- 6. 网格体检 ---------- */
    /**
     * 网格体检：核对视图缓存的节点数、父子关系与 data 坐标是否仍然可信。
     * 任一格不符即认为网格已被破坏，交由 ensureGrid 重建。
     * @param {HTMLElement} host 棋盘容器
     * @returns {boolean} 网格结构与视图缓存完全一致时返回 true
     */
    function gridMatches(host) {
        // 容器、行列数或子节点总数任一不符，直接判定网格不可信
        if (view.host !== host) return false;
        if (view.rows !== SR || view.cols !== SC) return false;
        if (!view.cells || view.cells.length !== SR) return false;
        if (host.childElementCount !== SR * SC) return false;
        for (var r = 0; r < SR; r++) {
            var row = view.cells[r];
            if (!row || row.length !== SC) return false;
            for (var c = 0; c < SC; c++) {
                var el = row[c];
                if (!el || el.parentNode !== host) return false;
                if (+el.dataset.r !== r || +el.dataset.c !== c) return false;
                if (el.childNodes.length < 2) return false;   // 子节点不足：格内结构被破坏
            }
        }
        return true;
    }

    /**
     * 确保容器内存在可信网格：尺寸变化时重设棋盘度量，结构不可信时整块重建。
     * @param {HTMLElement} host 棋盘容器
     * @returns {boolean} 本次是否发生了全量重建（true 表示不播放落雷动画）
     */
    function ensureGrid(host) {
        host.classList.add("rm-diff");
        var cs = calcCellSize(SR, SC);
        // 只在格子边长真的变化时才重排，避免无谓的样式写入
        if (host.dataset.cellSize !== String(cs)) {
            applyBoardMetrics(host, SR, SC);
            sizeCellsIn(host);
        }
        // 外部显式要求重建，或网格结构校验失败
        if (view.forceRebuild || !gridMatches(host)) {
            view.forceRebuild = false;
            fullBuild(host);
            return true;      // 网格刚重建，本次不播落雷动画
        }
        return false;
    }

    /* ---------- 7. 事件委托（只装一次） ---------- */
    /**
     * 从事件目标向上找最近的 .cell 节点，供事件委托使用。
     * @param {Event} e DOM 事件
     * @returns {HTMLElement|null} 命中的格子节点
     */
    function cellFromEvent(e) {
        if (!e || !e.target || !e.target.closest) return null;
        return e.target.closest(".cell");
    }

    /**
     * 在棋盘容器上安装一次性事件委托：左键放置、右键删除。
     * 同一引擎实例只安装一次，网格重建后不会重复绑定。
     * @param {HTMLElement} host 棋盘容器
     * @sideeffect 向 host 添加 click / contextmenu 监听
     */
    function installDelegates(host) {
        // 已经安装过委托：网格重建后复用同一组监听
        if (view.delegated) return;
        view.delegated = true;

        host.addEventListener("click", function(e) {
            var el = cellFromEvent(e);
            // 只处理仍挂在当前容器下的格子
            if (!el || el.parentNode !== host) return;
            var r = +el.dataset.r, c = +el.dataset.c, k = r + "," + c;
            // 已放置的格子不允许重复放置
            if (G.placed[k]) return;
            // 槽位未选中雷型时点击无效果
            if (!selectedMineType) return;
            var used = Object.keys(G.placed).filter(function(kk) {
                return G.placed[kk] === selectedMineType;
            }).length;
            var max = G.pool[selectedMineType] || 0;
            // 数量上限由牌池决定：已用数量达到配额后直接返回
            if (used >= max) return;
            // 先改状态再重算影响值，最后统一交给 render 同步界面
            G.placed[k] = selectedMineType;
            G.lastDragType = selectedMineType;
            AudioFX.place();
            resetP();
            render();
        });

        // 右键删除该格的地雷
        host.addEventListener("contextmenu", function(e) {
            var el = cellFromEvent(e);
            if (!el || el.parentNode !== host) return;
            // 抑制浏览器右键菜单
            e.preventDefault();
            del(+el.dataset.r, +el.dataset.c);
        });
    }

    /* ---------- 8. 单格差量更新 ---------- */
    /**
     * 给格子设置三态背景（正确 / 偏低 / 偏高），状态未变时直接跳过。
     * @param {HTMLElement} el 格子节点
     * @param {string} cls 目标状态类名
     */
    function setStatus(el, cls) {
        // 状态未变：跳过 DOM 写入，这是差量渲染的主要开销节省点
        if (el._stCls === cls) return;
        if (el._stCls) el.classList.remove(el._stCls);
        el.classList.add(cls);
        el._stCls = cls;
    }

    /**
     * 按当前格子边长计算地雷 emoji 的字号，使不同棋盘尺寸下比例一致。
     * @param {HTMLElement} host 棋盘容器
     * @returns {string} 形如 "23px" 的 CSS 字号
     */
    function mineFont(host) {
        var cs = parseInt(host.dataset.cellSize, 10) || 40;
        return Math.max(12, Math.round(cs * 0.58)) + "px";
    }

    /**
     * 播放"这一颗雷刚落子"的动画：先移除再强制重排后重新添加类，保证连续落子
     * 也能重新触发 CSS 动画；同一时刻只允许一颗雷处于动画状态。
     * @param {HTMLElement} el 地雷所在格子
     * @sideeffect 修改 el 的 class，并登记 view.animEl
     */
    function playDropAnim(el) {
        // 换新雷时立即停掉上一颗的动画，避免多颗同时抖动
        if (view.animEl && view.animEl !== el) view.animEl.classList.remove("just-dropped");
        el.classList.remove("just-dropped");
        void el.offsetWidth;        // 强制重排，保证动画可以重复触发
        el.classList.add("just-dropped");
        view.animEl = el;
        var done = function() {
            el.classList.remove("just-dropped");
            if (view.animEl === el) view.animEl = null;
        };
        // animationend 与超时两种触发都会清理类名，防止动画事件丢失
        el.addEventListener("animationend", done, { once: true });
        setTimeout(done, 800);
    }

    /**
     * 同步单格的影响值角标（差量路径）：只改角标内容与配色，不重建节点。
     * @param {HTMLElement} el 格子节点
     * @param {number} cur 当前影响值
     * @param {number} tar 目标影响值
     * @returns {boolean} 角标最终是否处于显示状态
     * @sideeffect 增删 el 内的角标节点并切换 has-influence 类
     */
    function syncInfluence(el, cur, tar) {
        // 只有开关开启、影响值非 0 且与目标值不同时才显示角标
        var want = !!influenceHintOn && cur !== 0 && cur !== tar;
        var badge = el._badge || null;
        // 角标不需要时移除节点并清空引用，避免节点泄漏
        if (!want) {
            if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
            el._badge = null;
            el.classList.remove("has-influence");
            return false;
        }
        var cls = "cell-influence " + (cur > tar ? "influence-over" : "influence-low");
        if (Math.abs(cur) >= 10) cls += " influence-wide";
        // 首次显示时创建角标，之后复用同一个节点
        if (!badge) {
            badge = document.createElement("div");
            el.appendChild(badge);
            el._badge = badge;
        } else if (badge.parentNode !== el) {
            // 角标可能被整块重建清掉，重新挂回当前格
            el.appendChild(badge);
        }
        // 内容与样式都先比较再写入，内容未变时跳过，减少样式重算
        if (badge.className !== cls) badge.className = cls;
        var txt = String(cur);
        if (badge.textContent !== txt) badge.textContent = txt;
        el.classList.add("has-influence");
        return true;
    }

    // 记录本次绘制遇到的未知雷型数量：一旦出现就跳过结果不变量校验
    var unknownTypes = 0;

    /**
     * 更新单个格子的全部视觉状态：三态背景、目标数字、地雷、影响值角标与
     * 拖拽绑定。每个子状态都自带"未变化则跳过"的短路，因此可以整盘调用。
     * @param {number} r 行号
     * @param {number} c 列号
     * @param {boolean} animate 是否允许播放落雷动画（增量更新时为 true）
     * @sideeffect 修改对应格子节点及其内部节点
     */
    function updateCell(r, c, animate) {
        var el = view.cells[r][c];
        var t = G.tar[r][c], p = G.p[r][c], k = r + "," + c;
        var type = G.placed[k] || null;

        // ① 三态背景：与目标值相等为正确，偏低 / 偏高各一种提示色
        setStatus(el, p === t ? "cell-valid" : (p < t ? "cell-low" : "cell-over"));

        // ② 目标数字：0 不显示数字，8 以上统一套用 n8 配色
        var numEl = el.childNodes[0];
        var txt = t !== 0 ? String(t) : "";
        if (numEl.textContent !== txt) numEl.textContent = txt;
        var wantN = t !== 0 ? "n" + Math.min(t, 8) : "";
        if (el._numCls !== wantN) {
            if (el._numCls) el.classList.remove(el._numCls);
            if (wantN) el.classList.add(wantN);
            el._numCls = wantN;
        }

        // ③ 地雷：类型异常时按无雷处理，绝不显示错误的雷型
        var mineEl = el.childNodes[1];
        var prev = el._mineType || null;
        if (type && !M[type]) {
            // 数据异常：记录一次，本格按"无雷"处理，绝不让它显示成错的雷
            unknownTypes++;
            log("render:updateCell", "未知地雷类型: " + type);
            type = null;
        }

        // 有雷时题目数字隐藏：地雷 emoji 独占格子，影响值角标另行叠加
        var numShown = type ? "none" : "";
        if (numEl.style.display !== numShown) numEl.style.display = numShown;

        if (type) {
            var m = M[type];
            if (prev !== type) {
                mineEl.className = m.cls + " cell-mine";
                mineEl.textContent = m.e;
                mineEl.style.display = "";
                mineEl.style.fontSize = mineFont(view.host);
            }
            if (!el.classList.contains("mine-here")) {
                el.classList.add("mine-here");
                // 只有"无雷 -> 有雷"且允许动画时才播放，避免重绘时满屏抖动
                if (animate && !prev) playDropAnim(el);
            }
        } else if (prev) {
            // 地雷被删除：清空内容并复位所有与地雷相关的状态类
            mineEl.className = "cell-mine";
            mineEl.textContent = "";
            mineEl.style.display = "none";
            el.classList.remove("mine-here");
            el.classList.remove("just-dropped");
        }
        el._mineType = type;

        // ④ 影响值角标：有雷的格子同样显示，只要当前值非 0 且不等于目标值
        var badgeOn = syncInfluence(el, p, t);

        // 有雷时数字已隐藏，角标会压在 emoji 上，把 emoji 往左上挪一点腾出位置
        // （与无雷时 .cell.has-influence .cell-num 的位移保持一致）
        var mineShift = badgeOn ? "translate(-16%, -16%)" : "";
        if (mineEl.style.transform !== mineShift) mineEl.style.transform = mineShift;

        // ⑤ 拖拽绑定：只在雷的有无发生变化时才重绑
        if (prev !== type) bindCellDrag(el, "main");
    }

    /* ---------- 9. 静态绘制路径 ---------- */
    /**
     * 最小绘制路径：不依赖差量缓存，直接按状态重建一版静态棋盘。
     * 只在差量引擎自身抛异常时使用，保证玩家至少能看到棋盘。
     * @param {HTMLElement} host 棋盘容器
     * @sideeffect 覆盖 host 内容、重置视图缓存并重新绑定事件
     */
    function legacyRender(host) {
        host.innerHTML = "";
        applyBoardMetrics(host, SR, SC);
        // 先在 DocumentFragment 上拼装，最后一次挂载，减少布局重排
        var frag = document.createDocumentFragment();
        for (var r = 0; r < SR; r++) {
            for (var c = 0; c < SC; c++) {
                var d = document.createElement("div");
                d.className = "cell";
                d.dataset.r = r;
                d.dataset.c = c;
                var t = G.tar[r][c], p = G.p[r][c], k = r + "," + c;
                if (p === t) d.classList.add("cell-valid");
                else if (p < t) d.classList.add("cell-low");
                else d.classList.add("cell-over");
                var numSpan = null;
                if (t !== 0) {
                    numSpan = document.createElement("span");
                    numSpan.className = "cell-num";
                    numSpan.textContent = t;
                    d.appendChild(numSpan);
                    d.classList.add("n" + Math.min(t, 8));
                }
                var mineSpan = null;
                var mtype = G.placed[k];
                if (mtype && M[mtype]) {
                    d.classList.add("mine-here");
                    mineSpan = document.createElement("span");
                    mineSpan.className = M[mtype].cls + " cell-mine";
                    mineSpan.textContent = M[mtype].e;
                    d.appendChild(mineSpan);
                    // 有雷时隐藏题目数字，但影响值角标照常显示
                    if (numSpan) numSpan.style.display = "none";
                }
                // 复用全量绘制路径的角标逻辑
                appendInfluenceBadge(d, p, t);
                if (mineSpan && d.querySelector(".cell-influence")) {
                    mineSpan.style.transform = "translate(-16%, -16%)";
                }
                frag.appendChild(d);
            }
        }
        host.appendChild(frag);
        // 移除差量托管标记：该棋盘已回到静态绘制状态
        host.classList.remove("rm-diff");
        sizeCellsIn(host);
        bindCellsIn(host, "main");
        view.host = null;      // 清空缓存，下一次 render 会走差量引擎的建格流程
        view.cells = null;
    }

    /* ---------- 10. 主渲染流程 ---------- */
    /**
     * 主渲染入口：状态体检 → 确保网格 → 逐格更新 → 校验结果不变量。
     * 任何一层失败都升级为全量重建，最坏情况降级到 legacyRender。
     * @sideeffect 修改棋盘 DOM；异常通过 RM.warn 记录
     */
    function renderMain() {
        var host = document.getElementById("board");
        // 页面没有棋盘容器时不渲染（例如非主界面）
        if (!host) return;
        // 状态不健康时直接跳过本次绘制，避免把错误数据画到界面上
        if (!stateHealthy()) {
            log("render", "状态矩阵与棋盘尺寸不一致（SR=" + SR + ",SC=" + SC + "），已跳过本次绘制");
            return;
        }
        // 每次绘制重新统计未知雷型
        unknownTypes = 0;
        var fresh, r, c;
        try {
            // 结构可信时走差量更新；fresh 为 true 表示网格刚被整块重建
            fresh = ensureGrid(host);
            try {
                for (r = 0; r < SR; r++) {
                    for (c = 0; c < SC; c++) updateCell(r, c, !fresh);
                }
            } catch (innerErr) {
                // 单格更新中途异常：重建网格后从头更新一遍
                log("render:diff", innerErr);
                fullBuild(host);
                for (r = 0; r < SR; r++) {
                    for (c = 0; c < SC; c++) updateCell(r, c, false);
                }
            }
            // 不变量校验：DOM 上的雷数必须等于状态里的雷数
            // 出现未知雷型时 DOM 与状态本就不可比，跳过这道校验
            if (!unknownTypes) {
                var domMines = host.querySelectorAll(".mine-here").length;
                var stateMines = Object.keys(G.placed).length;
                // 不变量被破坏：强制全量重建并重画，让界面与状态重新对齐
                if (domMines !== stateMines) {
                    log("render:invariant", "DOM 雷数 " + domMines + " ≠ 状态雷数 " + stateMines + "，已强制重建");
                    fullBuild(host);
                    for (r = 0; r < SR; r++) {
                        for (c = 0; c < SC; c++) updateCell(r, c, false);
                    }
                }
            }
        } catch (e) {
            log("render:fatal", e);
            try {
                // 差量路径彻底失败：退回最小绘制路径
                legacyRender(host);
            } catch (e2) {
                log("render:legacy", e2);
            }
        }
    }

    /* ---------- 11. 引擎对外接口 ---------- */
    /* 三个入口：render 走一次差量绘制、invalidate 请求下一帧整块重建、
       stats 返回累计重建次数与当前网格尺寸，供调试与自检读取。 */
    RM.renderEngine = {
        render: renderMain,
        /* 外部强制下一帧整块重建（切换模式、切换棋盘尺寸后调用） */
        invalidate: function() {
            view.forceRebuild = true;
        },
        stats: function() {
            return {
                rebuilds: view.rebuilds,
                rows: view.rows,
                cols: view.cols
            };
        }
    };
})();

/* ---------- 12. 渲染总入口与地雷槽 ---------- */
/**
 * 渲染总入口：教学模式走独立的教学棋盘，否则交给差量引擎；随后同步已放 /
 * 目标计数文本、重建地雷槽，并执行胜利判定。
 * @sideeffect 修改棋盘与槽位 DOM，可能触发胜利结算
 */
function render() {
    // 教学模式使用独立的棋盘与槽位渲染器
    if (typeof teachActive !== "undefined" && teachActive) {
        renderTeachBoard();
        renderTeachSlot();
        return;
    }
    // 入口级保护：引擎异常不应中断后面的计数与胜利判定
    try {
        RM.renderEngine.render();
    } catch (e) {
        RM.onError("render:entry", e);
    }
    // 计数、槽位与胜利判定属于渲染后的联动，单独保护
    try {
        var pe = document.getElementById("placed");
        if (pe) pe.textContent = Object.keys(G.placed).length;
        var me = document.getElementById("max");
        if (me) me.textContent = G.max;
        renderSlot();
        checkWin();
    } catch (e2) {
        RM.onError("render:tail", e2);
    }
}


/**
 * 重建右侧地雷槽：按牌池为每种雷生成一张可拖拽卡片，并标出已用 / 配额与选中态。
 * @sideeffect 覆盖 #slot 的内容（保留教学气泡节点）
 */
function renderSlot() {
    // 教学模式的槽位由 09-tutorial 单独渲染
    if (teachActive) {
        renderTeachSlot();
        return;
    }
    let s = document.getElementById("slot");
    let teachBubble = document.getElementById("teachBubble");
    s.innerHTML = "";
    // 教学气泡节点常驻：重建槽位前先摘出来，再挂回新内容
    if (teachBubble) s.appendChild(teachBubble);
    for (let t in G.pool) {
        let max = G.pool[t];
        // 牌池中没有的雷型不显示
        if (max <= 0) continue;
        // 已用数量按 G.placed 实时统计
        let use = Object.values(G.placed).filter(x => x === t).length;
        let div = document.createElement("div");
        // 配额用尽置灰；选中态用于提示当前放置的雷型
        div.className = "mine-item" + (use >= max ? " disabled" : "") + (selectedMineType === t ? " selected" : "");
        // 悬浮提示复用图鉴里的一句话说明
        div.dataset.tip = M[t].tip;
        div.dataset.mineType = t;
        // 卡片结构简单，用模板字符串一次生成
        div.innerHTML = `<div class="emoji-drag ${M[t].cls}">${M[t].e}</div><div>${M[t].n}</div><div>${use}/${max}</div>`;
        bindSlotItemDrag(div, t, "main");
        s.appendChild(div);
    }
}
