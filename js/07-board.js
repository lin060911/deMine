/* ==========================================================================
 * 反向扫雷 · 07-board.js
 * 职责：棋盘尺寸度量、放置模式（拖拽/点选）、指针拖拽、放置与删除
 * ========================================================================== */

const PLACE_MODE_KEY = "placeMode_v1";

window._placeMode = "drag";

function currentBoardKind() {
    if (createModeActive) return "create";
    if (teachActive) return "teach";
    return "main";
}

function calcCellSize(rows, cols) {
    const MAX = 40, MIN = 16, GAP = 2, PAD = 8;
    let vw = window.innerWidth || 0;
    if (!vw && document.documentElement) vw = document.documentElement.clientWidth || 0;
    if (!vw && document.body) vw = document.body.clientWidth || 0;
    if (!vw || vw > 700) return MAX;
    const byW = Math.floor((vw - 14 - PAD - GAP * (cols - 1)) / cols);
    const vh = window.innerHeight || 0;
    const byH = vh ? Math.floor((vh * .5 - PAD - GAP * (rows - 1)) / rows) : MAX;
    return Math.max(MIN, Math.min(MAX, Math.min(byW, byH)));
}

function applyBoardMetrics(board, rows, cols) {
    if (!board) return;
    const cs = calcCellSize(rows, cols);
    board.style.gridTemplateRows = `repeat(${rows},${cs}px)`;
    board.style.gridTemplateColumns = `repeat(${cols},${cs}px)`;
    board.style.setProperty("--cell-size", cs + "px");
    board.dataset.cellSize = cs;
}

function sizeCellsIn(board) {
    if (!board) return;
    const cs = parseInt(board.dataset.cellSize, 10) || 40;
    const fs = Math.max(11, Math.min(18, Math.round(cs * .45)));
    Array.prototype.forEach.call(board.querySelectorAll(".cell"), function(el) {
        el.style.width = cs + "px";
        el.style.height = cs + "px";
        el.style.fontSize = fs + "px";
    });
    const es = Math.max(12, Math.round(cs * .58));
    Array.prototype.forEach.call(board.querySelectorAll(".cell span[class*='-bomb']"), function(el) {
        el.style.fontSize = es + "px";
    });
}

function getSelectedType(kind) {
    if (kind === "create") return window._createSelectedType;
    if (kind === "teach") return window._teachSelectedType;
    return selectedMineType;
}

function setSelectedType(kind, t) {
    if (kind === "create") {
        window._createSelectedType = t;
        return;
    }
    if (kind === "teach") {
        window._teachSelectedType = t;
        return;
    }
    selectedMineType = t;
    if (t) G.lastDragType = t;
}

function toggleSelectedType(kind, t) {
    setSelectedType(kind, getSelectedType(kind) === t ? null : t);
    AudioFX.pop();
    if (kind === "create") renderCreateMineSlot(); else if (kind === "teach") renderTeachSlot(); else renderSlot();
}

function slotTypeFull(t, kind) {
    if (kind === "create") {
        const total = (createRows || 10) * (createCols || 10);
        return Object.keys(createPlaced).length >= Math.floor(total * .6);
    }
    if (kind === "teach") {
        const lvl = typeof TEACH_LEVELS !== "undefined" && TEACH_LEVELS[teachLevelIdx] ? TEACH_LEVELS[teachLevelIdx] : null;
        const mt = lvl ? lvl.mineTypes || (lvl.mineType ? {
            [lvl.mineType]: 1
        } : {}) : {};
        return (teachPlacedTypes[t] || 0) >= (mt[t] || 0);
    }
    const used = Object.values(G.placed).filter(x => x === t).length;
    return used >= (G.pool[t] || 0);
}

function fakeDropEvent(type) {
    return {
        dataTransfer: {
            getData: function() {
                return type || "";
            }
        },
        preventDefault: function() {},
        stopPropagation: function() {}
    };
}

function placeAtCell(kind, cell, type) {
    const r = +cell.dataset.r, c = +cell.dataset.c;
    if (kind === "create") {
        createPlace(r, c, type);
        return;
    }
    if (kind === "teach") {
        teachDrop(r, c, type);
        return;
    }
    drop.call(cell, fakeDropEvent(type));
}

function moveMineTo(kind, fromKey, cell) {
    const r = +cell.dataset.r, c = +cell.dataset.c, toKey = r + "," + c;
    if (fromKey === toKey) return;
    if (kind === "create") {
        createMove(fromKey, r, c);
        return;
    }
    if (kind === "teach") {
        teachMove(fromKey, r, c);
        return;
    }
    G.drag = fromKey;
    drop.call(cell, fakeDropEvent(null));
    G.drag = null;
}

function removeAtCell(kind, r, c) {
    if (kind === "create") {
        createRemove(r, c);
        return;
    }
    if (kind === "teach") {
        teachRemove(r, c);
        return;
    }
    del(r, c);
}

function dropAt(cell, kind, type, fromKey) {
    if (!cell) return;
    const map = kind === "create" ? createPlaced : G.placed;
    if (fromKey && map[fromKey]) {
        moveMineTo(kind, fromKey, cell);
        return;
    }
    if (!type) type = getSelectedType(kind);
    if (!type && kind === "main") type = G.lastDragType;
    placeAtCell(kind, cell, type);
}

function bindCellDrag(cell, kind) {
    const r = +cell.dataset.r, c = +cell.dataset.c;
    const key = r + "," + c;
    const map = kind === "create" ? createPlaced : G.placed;
    const hasMine = !!map[key];
    const isDrag = window._placeMode === "drag";
    if (isDrag && hasMine) {
        cell.draggable = true;
        cell.ondragstart = function(e) {
            try {
                e.dataTransfer.setDragImage(new Image, 0, 0);
            } catch (_) {}
            G.drag = key;
            try {
                e.dataTransfer.setData("text/plain", "");
                e.dataTransfer.effectAllowed = "move";
            } catch (_) {}
            cell.classList.add("dragging");
        };
        cell.ondragend = function() {
            cell.classList.remove("dragging");
            G.drag = null;
        };
    } else {
        cell.draggable = false;
        cell.ondragstart = null;
        cell.ondragend = null;
    }
    if (isDrag) {
        cell.ondragover = function(e) {
            e.preventDefault();
            cell.classList.add("drag-over");
        };
        cell.ondragleave = function() {
            cell.classList.remove("drag-over");
        };
        cell.ondrop = function(e) {
            e.preventDefault();
            cell.classList.remove("drag-over");
            let t = null;
            try {
                t = e.dataTransfer.getData("text/plain");
            } catch (_) {}
            dropAt(cell, kind, t, G.drag);
        };
    } else {
        cell.ondragover = null;
        cell.ondragleave = null;
        cell.ondrop = null;
    }
}

function bindSlotItemDrag(div, t, kind) {
    const full = slotTypeFull(t, kind);
    const isDrag = window._placeMode === "drag";
    if (isDrag) {
        div.draggable = !full;
        div.ondragstart = function(e) {
            try {
                e.dataTransfer.setDragImage(new Image, 0, 0);
            } catch (_) {}
            if (full) {
                e.preventDefault();
                return;
            }
            G.drag = null;
            setSelectedType(kind, t);
            try {
                e.dataTransfer.setData("text/plain", t);
                e.dataTransfer.effectAllowed = "move";
            } catch (_) {}
            div.classList.add("dragging");
            AudioFX.pop();
        };
        div.ondragend = function() {
            div.classList.remove("dragging");
        };
    } else {
        div.draggable = false;
        div.ondragstart = null;
        div.ondragend = null;
    }
    div.onclick = function() {
        if (!full) toggleSelectedType(kind, t);
    };
}

function bindCellsIn(root, kind) {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll(".cell"), function(el) {
        bindCellDrag(el, kind);
    });
}

function bindSlotIn(root, kind) {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll(".mine-item"), function(el) {
        if (el.dataset.mineType) bindSlotItemDrag(el, el.dataset.mineType, kind);
    });
}

function applyPlaceModeToDom() {
    const kind = currentBoardKind();
    if (kind === "create") {
        bindCellsIn(document.getElementById("createBoardArea"), "create");
        bindSlotIn(document.getElementById("createMineSlot"), "create");
    } else {
        bindCellsIn(document.getElementById("board"), kind);
        bindSlotIn(document.getElementById("slot"), kind);
    }
}

function applyPlaceModeUI() {
    const isDrag = window._placeMode === "drag";
    const dragBtn = document.getElementById("modeBtnDrag");
    const clickBtn = document.getElementById("modeBtnClick");
    if (dragBtn) dragBtn.classList.toggle("active", isDrag);
    if (clickBtn) clickBtn.classList.toggle("active", !isDrag);
    const hint = document.getElementById("modeHint");
    if (hint) hint.textContent = isDrag ? "✋ 将地雷拖到棋盘格子上,松手放置；部分设备/浏览器暂不支持" : "🖱️ 点击选中地雷，再点击棋盘格子放置";
    const badge = document.getElementById("modeBadge");
    if (badge) badge.textContent = isDrag ? "拖拽" : "点选";
    document.body.classList.toggle("drag-mode", isDrag);
}

function initPlaceMode() {
    const saved = Store.get(PLACE_MODE_KEY);
    window._placeMode = saved === "drag" || saved === "click" ? saved : "drag";
    applyPlaceModeUI();
}

function setPlaceMode(mode) {
    if (mode !== "drag" && mode !== "click") return;
    if (window._placeMode !== mode) {
        window._placeMode = mode;
        try {
            Store.set(PLACE_MODE_KEY, mode);
        } catch (e) {}
        AudioFX.confirm();
    }
    applyPlaceModeToDom();
    applyPlaceModeUI();
}

window.setPlaceMode = setPlaceMode;

window.togglePlaceMode = function() {
    setPlaceMode(window._placeMode === "drag" ? "click" : "drag");
};

window.openSettingSidebar = function() {
    const sb = document.getElementById("settingSidebar");
    if (!sb) return;
    AudioFX.confirm();
    closeSidebarsExcept("settingSidebar");
    sb.classList.add("open");
};

initPlaceMode();

let _resizeTid = 0, _lastSizeKey = "";

window.addEventListener("resize", function() {
    clearTimeout(_resizeTid);
    _resizeTid = setTimeout(function() {
        const kind = currentBoardKind();
        const rows = kind === "create" ? createRows : SR;
        const cols = kind === "create" ? createCols : SC;
        const key = kind + "|" + rows + "x" + cols + "|" + calcCellSize(rows, cols);
        if (key === _lastSizeKey) return;
        _lastSizeKey = key;
        if (kind === "create") {
            renderCreateBoard();
            renderCreateMineSlot();
        } else if (kind === "teach") {
            renderTeachBoard();
            renderTeachSlot();
        } else render();
    }, 180);
});

(function initPointerDrag() {
    const MOVE_THRESHOLD = 6;
    const LONG_PRESS_MS = 480;
    let st = null;
    function clearTimers(s) {
        if (s && s.lpTimer) {
            clearTimeout(s.lpTimer);
            s.lpTimer = 0;
        }
    }
    function findCell(x, y, kind) {
        if (!document.elementFromPoint) return null;
        const el = document.elementFromPoint(x, y);
        if (!el || !el.closest) return null;
        const cell = el.closest(".cell");
        if (!cell) return null;
        if (kind === "create") return cell.closest("#createBoardArea") ? cell : null;
        return cell.closest("#board") ? cell : null;
    }
    function ghostPos(x, y, isTouch) {
        return "translate3d(" + (x - 23) + "px," + (y - 23 - (isTouch ? 30 : 12)) + "px,0)";
    }
    function makeGhost(type, x, y, isTouch) {
        const m = M[type] || null;
        const g = document.createElement("div");
        g.className = "drag-ghost";
        g.innerHTML = '<span class="' + (m ? m.cls : "normal-bomb") + '">' + (m ? m.e : "💣") + "</span>";
        g.style.transform = ghostPos(x, y, isTouch);
        document.body.appendChild(g);
        return g;
    }
    function killGhost(s) {
        if (!s) return;
        if (s.ghost && s.ghost.parentNode) s.ghost.parentNode.removeChild(s.ghost);
        s.ghost = null;
        if (s.src && s.src.classList) s.src.classList.remove("dragging");
    }
    function clearHover(s) {
        if (s && s.hover) {
            s.hover.classList.remove("drag-over");
            s.hover = null;
        }
    }
    function buzz(ms) {
        if (navigator.vibrate) {
            try {
                navigator.vibrate(ms);
            } catch (_) {}
        }
    }
    function autoScroll(y) {
        const vh = window.innerHeight || 0;
        if (!vh || y < 0 || y > vh) return;
        let dy = 0;
        if (y < 70) dy = -12; else if (y > vh - 70) dy = 12;
        if (!dy) return;
        try {
            window.scrollBy(0, dy);
        } catch (_) {}
    }
    function swallowNextClick() {
        let tid = 0;
        const cleanup = function() {
            document.removeEventListener("click", swallow, true);
            clearTimeout(tid);
        };
        const swallow = function(ev) {
            const t = ev.target;
            if (t && t.closest && (t.closest(".cell") || t.closest(".mine-item"))) {
                ev.stopPropagation();
                ev.preventDefault();
            }
            cleanup();
        };
        document.addEventListener("click", swallow, true);
        tid = setTimeout(cleanup, 400);
    }
    function onDown(e) {
        if (!e || e.pointerType === "mouse") return;
        if (st) return;
        const target = e.target;
        if (!target || !target.closest) return;
        const kind = currentBoardKind();
        const slotItem = target.closest(".mine-item");
        if (slotItem) {
            if (window._placeMode !== "drag") return;
            if (slotItem.classList.contains("disabled")) return;
            const type = slotItem.dataset.mineType;
            if (!type || slotTypeFull(type, kind)) return;
            st = {
                mode: "slot",
                kind: kind,
                type: type,
                src: slotItem,
                fromKey: null,
                startX: e.clientX,
                startY: e.clientY,
                pid: e.pointerId,
                isTouch: true,
                active: false,
                canDrag: true,
                ghost: null,
                hover: null,
                lpTimer: 0
            };
            return;
        }
        const cell = target.closest(".cell");
        if (cell && cell.classList.contains("mine-here")) {
            const r = +cell.dataset.r, c = +cell.dataset.c, key = r + "," + c;
            const map = kind === "create" ? createPlaced : G.placed;
            const type = map[key];
            if (!type) return;
            st = {
                mode: "cell",
                kind: kind,
                type: type,
                src: cell,
                fromKey: key,
                r: r,
                c: c,
                startX: e.clientX,
                startY: e.clientY,
                pid: e.pointerId,
                isTouch: true,
                active: false,
                canDrag: window._placeMode === "drag",
                ghost: null,
                hover: null,
                lpTimer: 0
            };
            st.lpTimer = setTimeout(function() {
                const s = st;
                if (!s || s.active) return;
                st = null;
                clearTimers(s);
                removeAtCell(s.kind, s.r, s.c);
                buzz(18);
                swallowNextClick();
            }, LONG_PRESS_MS);
        }
    }
    function onMove(e) {
        if (!st || e.pointerId !== st.pid) return;
        const dx = e.clientX - st.startX, dy = e.clientY - st.startY;
        if (!st.active) {
            if (Math.abs(dx) < MOVE_THRESHOLD && Math.abs(dy) < MOVE_THRESHOLD) return;
            clearTimers(st);
            if (!st.canDrag) {
                const s = st;
                st = null;
                killGhost(s);
                return;
            }
            st.active = true;
            st.ghost = makeGhost(st.type, e.clientX, e.clientY, st.isTouch);
            if (st.src && st.src.classList) st.src.classList.add("dragging");
            setSelectedType(st.kind, st.type);
            buzz(10);
        }
        if (e.cancelable) e.preventDefault();
        if (st.ghost) st.ghost.style.transform = ghostPos(e.clientX, e.clientY, st.isTouch);
        autoScroll(e.clientY);
        const cell = findCell(e.clientX, e.clientY, st.kind);
        if (cell !== st.hover) {
            clearHover(st);
            if (cell && cell !== st.src) {
                cell.classList.add("drag-over");
                st.hover = cell;
            }
        }
    }
    function onUp(e) {
        if (!st || e.pointerId !== st.pid) return;
        const s = st;
        st = null;
        clearTimers(s);
        if (!s.active) {
            killGhost(s);
            return;
        }
        const cell = s.hover || findCell(e.clientX, e.clientY, s.kind);
        clearHover(s);
        killGhost(s);
        swallowNextClick();
        if (cell) dropAt(cell, s.kind, s.type, s.mode === "cell" ? s.fromKey : null);
    }
    function onCancel(e) {
        if (!st) return;
        if (e && e.pointerId !== st.pid) return;
        const s = st;
        st = null;
        clearTimers(s);
        clearHover(s);
        killGhost(s);
    }
    document.addEventListener("pointerdown", onDown, {
        passive: true
    });
    document.addEventListener("pointermove", onMove, {
        passive: false
    });
    document.addEventListener("pointerup", onUp, {
        passive: true
    });
    document.addEventListener("pointercancel", onCancel, {
        passive: true
    });
})();

function drop(e) {
    startTiOnFirst();
    let r = +this.dataset.r, c = +this.dataset.c, k = r + "," + c;
    if (G.placed[k]) return;
    if (G.drag) {
        let t = G.placed[G.drag];
        delete G.placed[G.drag];
        G.placed[k] = t;
        G.drag = null;
        AudioFX.place();
        resetP();
        render();
        return;
    }
    let t = null;
    if (e && e.dataTransfer) t = e.dataTransfer.getData("text/plain") || G.lastDragType;
    if (!t && selectedMineType) t = selectedMineType;
    if (!t) return;
    let used = Object.values(G.placed).filter(x => x === t).length || 0;
    let max = G.pool[t] || 0;
    if (used >= max) return;
    G.placed[k] = t;
    G.lastDragType = t;
    AudioFX.place();
    resetP();
    render();
}

function del(r, c) {
    startTiOnFirst();
    let k = r + "," + c;
    if (!G.placed[k]) return;
    AudioFX.remove();
    delete G.placed[k];
    resetP();
    render();
}
