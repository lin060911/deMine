/* ==========================================================================
 * 反向扫雷 · 06-render.js
 * 职责：影响值提示开关 + 棋盘差量渲染引擎 + 地雷槽渲染
 * ========================================================================== */

let influenceHintOn = Store.get("mineInfluenceHint") === "true";

function setInfluenceHint(on, silent) {
    influenceHintOn = !!on;
    try {
        Store.set("mineInfluenceHint", influenceHintOn ? "true" : "false");
    } catch (e) {}
    let tg = document.getElementById("influenceHintToggle");
    if (tg) tg.classList.toggle("on", influenceHintOn);
    if (!silent && typeof AudioFX !== "undefined" && AudioFX.toggle) AudioFX.toggle(influenceHintOn);
    if (silent) return;
    if (typeof createModeActive !== "undefined" && createModeActive) return;
    if (typeof G === "undefined" || !G.tar || G.tar.length !== SR) return;
    if (typeof render === "function") render();
}

function toggleInfluenceHint() {
    setInfluenceHint(!influenceHintOn);
}

function appendInfluenceBadge(cell, cur, tar) {
    if (!influenceHintOn) return;
    if (cur === 0 || cur === tar) return;
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
    let cls = "cell-influence " + (cur > tar ? "influence-over" : "influence-low");
    if (Math.abs(cur) >= 10) cls += " influence-wide";
    badge.className = cls;
    badge.textContent = cur;
    cell.appendChild(badge);
}

/* ==========================================================================
 * 06-render.js · 棋盘差量渲染引擎
 *
 * 为什么要改
 *  原实现每次放置/删除一颗雷就 `board.innerHTML = ""` 重建整块棋盘：
 *    · 20×20 要新建 400 个 div + 重绑 400 次事件，点一下卡一下；
 *    · 更糟的是所有已放置的雷都会重播一遍 cellMineDrop 落雷动画，
 *      玩到后期满屏乱抖。
 *
 *  现在改成：网格只建一次，之后只更新发生变化的格子；点击/右键用事件委托。
 *
 * 保险机制（针对"手忙脚乱或暴力测试下显示与状态对不上"）
 *   ① 状态体检：G.tar / G.p 的行列数与 SR/SC 不一致 → 不画，记日志；
 *   ② 网格体检：DOM 节点数、父子关系、data-r/data-c 逐格校验，
 *      任何一格对不上就整块重建；
 *   ③ 尺寸变化：窗口缩放导致格子边长变化时自动重新应用棋盘度量；
 *   ④ 过程兜底：差量更新中途抛异常 → 自动回退全量重建再来一遍；
 *   ⑤ 结果不变量：画完后比对 DOM 上的雷数与 G.placed 的数量，
 *      不相等就强制全量重建（这是最强的一道闸）；
 *   ⑥ 最终兜底：连全量重建都失败，用最朴素的 legacyRender 画一遍，
 *      保证玩家永远看得到棋盘，而不是白屏。
 *
 * 落雷动画：只有"本次新出现"的那一颗雷会播放 cellMineDrop，
 *          全量重建时一律不播，避免满屏乱抖。
 * ========================================================================== */

(function() {
    "use strict";

    var view = {
        host: null,
        rows: 0,
        cols: 0,
        cells: null,
        animEl: null,
        delegated: false,
        forceRebuild: false,
        rebuilds: 0
    };

    function log(where, e) {
        if (window.RM) RM.warn(where, e);
    }

    /* ---------- 状态体检 ---------- */
    function stateHealthy() {
        return !!(G && G.tar && G.p &&
            G.tar.length === SR && G.p.length === SR &&
            G.tar[0] && G.p[0] &&
            G.tar[0].length === SC && G.p[0].length === SC);
    }

    /* ---------- 建格 ---------- */
    function makeCell(r, c) {
        var d = document.createElement("div");
        d.className = "cell";
        d.dataset.r = r;
        d.dataset.c = c;
        var num = document.createElement("span");
        num.className = "cell-num";
        d.appendChild(num);
        var mine = document.createElement("span");
        mine.className = "cell-mine";
        mine.style.display = "none";
        d.appendChild(mine);
        return d;
    }

    function fullBuild(host) {
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
        view.rebuilds++;
        host.classList.add("rm-diff");   // 标记：本棋盘由差量引擎托管
        sizeCellsIn(host);
        bindCellsIn(host, "main");
        installDelegates(host);
    }

    /* ---------- 网格体检 ---------- */
    function gridMatches(host) {
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
                if (el.childNodes.length < 2) return false;   // 内部结构被破坏
            }
        }
        return true;
    }

    function ensureGrid(host) {
        host.classList.add("rm-diff");
        var cs = calcCellSize(SR, SC);
        if (host.dataset.cellSize !== String(cs)) {
            applyBoardMetrics(host, SR, SC);
            sizeCellsIn(host);
        }
        if (view.forceRebuild || !gridMatches(host)) {
            view.forceRebuild = false;
            fullBuild(host);
            return true;      // 本次是全新构建 → 不播落雷动画
        }
        return false;
    }

    /* ---------- 事件委托（只装一次） ---------- */
    function cellFromEvent(e) {
        if (!e || !e.target || !e.target.closest) return null;
        return e.target.closest(".cell");
    }

    function installDelegates(host) {
        if (view.delegated) return;
        view.delegated = true;

        host.addEventListener("click", function(e) {
            var el = cellFromEvent(e);
            if (!el || el.parentNode !== host) return;
            var r = +el.dataset.r, c = +el.dataset.c, k = r + "," + c;
            if (G.placed[k]) return;
            if (!selectedMineType) return;
            var used = Object.keys(G.placed).filter(function(kk) {
                return G.placed[kk] === selectedMineType;
            }).length;
            var max = G.pool[selectedMineType] || 0;
            if (used >= max) return;
            G.placed[k] = selectedMineType;
            G.lastDragType = selectedMineType;
            AudioFX.place();
            resetP();
            render();
        });

        host.addEventListener("contextmenu", function(e) {
            var el = cellFromEvent(e);
            if (!el || el.parentNode !== host) return;
            e.preventDefault();
            del(+el.dataset.r, +el.dataset.c);
        });
    }

    /* ---------- 单格更新 ---------- */
    function setStatus(el, cls) {
        if (el._stCls === cls) return;
        if (el._stCls) el.classList.remove(el._stCls);
        el.classList.add(cls);
        el._stCls = cls;
    }

    function mineFont(host) {
        var cs = parseInt(host.dataset.cellSize, 10) || 40;
        return Math.max(12, Math.round(cs * 0.58)) + "px";
    }

    function playDropAnim(el) {
        // 同一时刻只允许一颗雷在播动画 —— 保证"只播最新那颗"
        if (view.animEl && view.animEl !== el) view.animEl.classList.remove("just-dropped");
        el.classList.remove("just-dropped");
        void el.offsetWidth;        // 强制重排，保证动画可以重复触发
        el.classList.add("just-dropped");
        view.animEl = el;
        var done = function() {
            el.classList.remove("just-dropped");
            if (view.animEl === el) view.animEl = null;
        };
        el.addEventListener("animationend", done, { once: true });
        setTimeout(done, 800);
    }

    function syncInfluence(el, cur, tar) {
        var want = !!influenceHintOn && cur !== 0 && cur !== tar;
        var badge = el._badge || null;
        if (!want) {
            if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
            el._badge = null;
            el.classList.remove("has-influence");
            return;
        }
        var cls = "cell-influence " + (cur > tar ? "influence-over" : "influence-low");
        if (Math.abs(cur) >= 10) cls += " influence-wide";
        if (!badge) {
            badge = document.createElement("div");
            el.appendChild(badge);
            el._badge = badge;
        } else if (badge.parentNode !== el) {
            el.appendChild(badge);
        }
        if (badge.className !== cls) badge.className = cls;
        var txt = String(cur);
        if (badge.textContent !== txt) badge.textContent = txt;
        el.classList.add("has-influence");
    }

    var unknownTypes = 0;

    function updateCell(r, c, animate) {
        var el = view.cells[r][c];
        var t = G.tar[r][c], p = G.p[r][c], k = r + "," + c;
        var type = G.placed[k] || null;

        // ① 背景状态
        setStatus(el, p === t ? "cell-valid" : (p < t ? "cell-low" : "cell-over"));

        // ② 目标数字
        var numEl = el.childNodes[0];
        var txt = t !== 0 ? String(t) : "";
        if (numEl.textContent !== txt) numEl.textContent = txt;
        var wantN = t !== 0 ? "n" + Math.min(t, 8) : "";
        if (el._numCls !== wantN) {
            if (el._numCls) el.classList.remove(el._numCls);
            if (wantN) el.classList.add(wantN);
            el._numCls = wantN;
        }

        // ③ 地雷
        var mineEl = el.childNodes[1];
        var prev = el._mineType || null;
        if (type && !M[type]) {
            // 数据异常：记录一次，本格按"无雷"处理，绝不让它显示成错的雷
            unknownTypes++;
            log("render:updateCell", "未知地雷类型: " + type);
            type = null;
        }

        // 有雷时该格的题目数字消失（与原版一致：地雷 emoji 独占格子）
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
                if (animate && !prev) playDropAnim(el);
            }
        } else if (prev) {
            mineEl.className = "cell-mine";
            mineEl.textContent = "";
            mineEl.style.display = "none";
            el.classList.remove("mine-here");
            el.classList.remove("just-dropped");
        }
        el._mineType = type;

        // ④ 影响值角标（有雷的格子不显示，与原版一致）
        if (type) {
            if (el._badge) {
                if (el._badge.parentNode) el._badge.parentNode.removeChild(el._badge);
                el._badge = null;
            }
            el.classList.remove("has-influence");
        } else {
            syncInfluence(el, p, t);
        }

        // ⑤ 拖拽绑定：只在雷的有无发生变化时才重绑
        if (prev !== type) bindCellDrag(el, "main");
    }

    /* ---------- 最终兜底：最朴素的全量绘制 ---------- */
    function legacyRender(host) {
        host.innerHTML = "";
        applyBoardMetrics(host, SR, SC);
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
                if (t !== 0) {
                    d.textContent = t;
                    d.classList.add("n" + Math.min(t, 8));
                }
                if (G.placed[k] && M[G.placed[k]]) {
                    d.classList.add("mine-here");
                    d.innerHTML = '<span class="' + M[G.placed[k]].cls + '">' + M[G.placed[k]].e + "</span>";
                }
                appendInfluenceBadge(d, p, t);
                frag.appendChild(d);
            }
        }
        host.appendChild(frag);
        host.classList.remove("rm-diff");
        sizeCellsIn(host);
        bindCellsIn(host, "main");
        view.host = null;      // 让下一次 render 走正规重建流程
        view.cells = null;
    }

    /* ---------- 主渲染 ---------- */
    function renderMain() {
        var host = document.getElementById("board");
        if (!host) return;
        if (!stateHealthy()) {
            log("render", "状态矩阵与棋盘尺寸不一致（SR=" + SR + ",SC=" + SC + "），已跳过本次绘制");
            return;
        }
        unknownTypes = 0;
        var fresh, r, c;
        try {
            fresh = ensureGrid(host);
            try {
                for (r = 0; r < SR; r++) {
                    for (c = 0; c < SC; c++) updateCell(r, c, !fresh);
                }
            } catch (innerErr) {
                log("render:diff", innerErr);
                fullBuild(host);
                for (r = 0; r < SR; r++) {
                    for (c = 0; c < SC; c++) updateCell(r, c, false);
                }
            }
            // 不变量校验：DOM 上的雷数必须等于状态里的雷数
            if (!unknownTypes) {
                var domMines = host.querySelectorAll(".mine-here").length;
                var stateMines = Object.keys(G.placed).length;
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
                legacyRender(host);
            } catch (e2) {
                log("render:legacy", e2);
            }
        }
    }

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

function render() {
    if (typeof teachActive !== "undefined" && teachActive) {
        renderTeachBoard();
        renderTeachSlot();
        return;
    }
    try {
        RM.renderEngine.render();
    } catch (e) {
        RM.onError("render:entry", e);
    }
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


function renderSlot() {
    if (teachActive) {
        renderTeachSlot();
        return;
    }
    let s = document.getElementById("slot");
    let teachBubble = document.getElementById("teachBubble");
    s.innerHTML = "";
    if (teachBubble) s.appendChild(teachBubble);
    for (let t in G.pool) {
        let max = G.pool[t];
        if (max <= 0) continue;
        let use = Object.values(G.placed).filter(x => x === t).length;
        let div = document.createElement("div");
        div.className = "mine-item" + (use >= max ? " disabled" : "") + (selectedMineType === t ? " selected" : "");
        div.dataset.tip = M[t].tip;
        div.dataset.mineType = t;
        div.innerHTML = `<div class="emoji-drag ${M[t].cls}">${M[t].e}</div><div>${M[t].n}</div><div>${use}/${max}</div>`;
        bindSlotItemDrag(div, t, "main");
        s.appendChild(div);
    }
}
