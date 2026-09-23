/* ==========================================================================
 * 反向扫雷 · 11-create.js
 * 职责：创造模式（自定义棋盘 / 题库码生成与分享）
 * ========================================================================== */

let createModeActive = false;

let createRows = 10;

let createCols = 10;

let createPlaced = {};

let createdTarget = [];

const CREATE_MIN = 4;

const CREATE_MAX = 20;

const CREATE_MAX_CELLS = 400;

function getAllMineTypes() {
    let types = [];
    for (let k in M) {
        if (seriesState[M[k].category]) types.push(k);
    }
    return types;
}

function clampSize(v) {
    v = parseInt(v) || CREATE_MIN;
    return Math.max(CREATE_MIN, Math.min(CREATE_MAX, v));
}

function getMaxAllowed(otherDim) {
    return Math.max(CREATE_MIN, Math.min(CREATE_MAX, Math.floor(CREATE_MAX_CELLS / otherDim)));
}

function showCreateError(msg) {
    let el = document.getElementById("createError");
    if (el) el.textContent = msg || "";
}

function refreshCreateInfoBar() {
    let bar = document.getElementById("createInfoBar");
    if (!bar) return;
    let totalCells = createRows * createCols;
    let placedCount = Object.keys(createPlaced).length;
    let typeCount = getAllMineTypes().length;
    document.getElementById("infoRows").textContent = createRows;
    document.getElementById("infoCols").textContent = createCols;
    document.getElementById("infoPlaced").textContent = placedCount;
    document.getElementById("infoTypes").textContent = typeCount;
    let maxHint = document.getElementById("createMaxHint");
    if (!maxHint) {
        maxHint = document.createElement("span");
        maxHint.id = "createMaxHint";
        maxHint.className = "info-chip";
        bar.appendChild(maxHint);
    }
    maxHint.innerHTML = "最大地雷数 <strong>" + Math.floor(totalCells * .6) + "</strong>";
    bar.style.display = "flex";
}

function createSizeStep(dim, delta) {
    AudioFX.pop();
    let isRows = dim === "rows";
    let cur = isRows ? createRows : createCols;
    let other = isRows ? createCols : createRows;
    let maxForOther = getMaxAllowed(other);
    let next = clampSize(cur + delta);
    if (next * other > CREATE_MAX_CELLS) {
        next = maxForOther;
        showCreateError("棋盘面积不能超过 " + CREATE_MAX_CELLS + " 格（当前 " + next * other + "）");
    } else {
        showCreateError("");
    }
    if (isRows) {
        createRows = next;
        document.getElementById("createSize").value = next;
    } else {
        createCols = next;
        document.getElementById("createSize2").value = next;
    }
}

function createSizeInput(dim, val) {
    let isRows = dim === "rows";
    let other = isRows ? createCols : createRows;
    let maxForOther = getMaxAllowed(other);
    let next = clampSize(val);
    if (next * other > CREATE_MAX_CELLS) {
        next = maxForOther;
        showCreateError("棋盘面积不能超过 " + CREATE_MAX_CELLS + " 格，已自动调整");
    } else {
        showCreateError("");
    }
    if (isRows) {
        createRows = next;
        document.getElementById("createSize").value = next;
    } else {
        createCols = next;
        document.getElementById("createSize2").value = next;
    }
    AudioFX.pop();
}

/* 打开「✍️创造」侧边栏时调用：只准备参数，【不动任何游戏状态】。
   这样用户可以在侧栏里慢慢调尺寸，当前这一局的棋盘与计时完全不受影响。 */
function prepareCreateParams() {
    // 已经在创造模式里（主区有创造棋盘）时，不要重置尺寸，免得打断编辑
    if (createModeActive) return;
    createRows = 10;
    createCols = 10;
    const s1 = document.getElementById("createSize");
    const s2 = document.getElementById("createSize2");
    if (s1) s1.value = 10;
    if (s2) s2.value = 10;
    showCreateError("");
}
window.prepareCreateParams = prepareCreateParams;

/* 点「🛠️ 生成空棋盘」才真正进入创造模式：此刻才重置并切换棋盘归属。
   （currentBoardKind() 依赖 createModeActive，过早置真会让游戏棋盘上的
     操作被误判为创造棋盘操作） */
function enterCreateMode() {
    AudioFX.confirm();
    fullReset();
    createModeActive = true;
    document.getElementById("createModePanel").classList.add("visible");
    document.getElementById("board").style.display = "none";
    document.getElementById("slot").style.display = "none";
    document.getElementById("presetStartCard").style.display = "none";
    document.getElementById("timer").style.display = "none";
    document.getElementById("puzzleCodeOutput").textContent = "点击生成后显示";
    document.getElementById("shareCodeBtn").disabled = true;
    showCreateError("");
    document.getElementById("createBoardArea").style.display = "none";
    document.getElementById("createMineSlot").style.display = "none";
    document.getElementById("createCodeCard").style.display = "none";
    document.getElementById("createInfoBar").style.display = "none";
    createPlaced = {};
}

/* 保留旧入口名：直接生成空棋盘（等价于在侧栏设好参数后点生成） */
function startCreateBoard() {
    enterCreateMode();
    initCreateBoard();
}
window.startCreateBoard = startCreateBoard;

function initCreateBoard() {
    AudioFX.confirm();
    // 首次生成时才真正进入创造模式（重置当前局、切换棋盘归属）
    if (!createModeActive) enterCreateMode();
    let r = clampSize(document.getElementById("createSize").value);
    let c = clampSize(document.getElementById("createSize2").value);
    if (r * c > CREATE_MAX_CELLS) {
        c = getMaxAllowed(r);
        document.getElementById("createSize2").value = c;
        showCreateError("棋盘面积超限，列数已自动调整为 " + c);
    } else {
        showCreateError("");
    }
    createRows = r;
    createCols = c;
    SR = r;
    SC = c;
    S = Math.max(r, c);
    createPlaced = {};
    document.getElementById("createBoardArea").style.display = "";
    document.getElementById("createMineSlot").style.display = "";
    document.getElementById("createCodeCard").style.display = "";
    refreshCreateInfoBar();
    renderCreateBoard();
    renderCreateMineSlot();
}

function createPlace(r, c, type) {
    const key = r + "," + c;
    if (!type || createPlaced[key]) return;
    createPlaced[key] = type;
    AudioFX.place();
    renderCreateBoard();
    renderCreateMineSlot();
    refreshCreateInfoBar();
}

function createRemove(r, c) {
    const key = r + "," + c;
    if (!createPlaced[key]) return;
    delete createPlaced[key];
    AudioFX.remove();
    renderCreateBoard();
    renderCreateMineSlot();
    refreshCreateInfoBar();
}

function createMove(fromKey, r, c) {
    const toKey = r + "," + c;
    const t = createPlaced[fromKey];
    if (!t || createPlaced[toKey] || fromKey === toKey) return;
    delete createPlaced[fromKey];
    createPlaced[toKey] = t;
    AudioFX.place();
    renderCreateBoard();
    renderCreateMineSlot();
    refreshCreateInfoBar();
}

function renderCreateBoard() {
    let area = document.getElementById("createBoardArea");
    area.innerHTML = "";
    let rows = createRows, cols = createCols;
    let board = document.createElement("div");
    board.className = "board";
    applyBoardMetrics(board, rows, cols);
    let tempP = Array.from({
        length: rows
    }, () => Array(cols).fill(0));
    let oldSR = SR, oldSC = SC;
    SR = rows;
    SC = cols;
    for (let k in createPlaced) {
        let [r, c] = k.split(",").map(Number);
        M[createPlaced[k]].f(r, c, tempP);
    }
    applyTacticalEffects(tempP, createPlaced);
    SR = oldSR;
    SC = oldSC;
    createdTarget = tempP.map(row => row.slice());
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            let cell = document.createElement("div");
            cell.className = "cell";
            cell.dataset.r = r;
            cell.dataset.c = c;
            let val = tempP[r][c];
            if (val !== 0) {
                cell.textContent = val;
                cell.classList.add("n" + Math.min(Math.abs(val), 9));
                if (val > 0) cell.classList.add("cell-valid"); else cell.classList.add("cell-over");
            }
            let key = r + "," + c;
            if (createPlaced[key]) {
                cell.classList.add("mine-here");
                let ty = createPlaced[key];
                cell.innerHTML = `<span class="${M[ty].cls}">${M[ty].e}</span>`;
            }
            cell.onclick = () => {
                createPlace(r, c, window._createSelectedType);
            };
            cell.oncontextmenu = e => {
                e.preventDefault();
                createRemove(r, c);
            };
            bindCellDrag(cell, "create");
            board.appendChild(cell);
        }
    }
    area.appendChild(board);
    sizeCellsIn(board);
}

function renderCreateMineSlot() {
    let container = document.getElementById("createMineSlot");
    container.innerHTML = "";
    let types = getAllMineTypes();
    let totalCells = createRows * createCols;
    let maxMines = Math.floor(totalCells * .6);
    let placedCount = Object.keys(createPlaced).length;
    types.forEach(t => {
        let used = Object.values(createPlaced).filter(v => v === t).length;
        let div = document.createElement("div");
        let disabled = placedCount >= maxMines;
        div.className = "mine-item" + (disabled ? " disabled" : "") + (window._createSelectedType === t ? " selected" : "");
        div.dataset.tip = M[t].tip;
        div.dataset.mineType = t;
        div.innerHTML = `<div class="emoji-drag ${M[t].cls}">${M[t].e}</div><div>${M[t].n}</div><div>${used} 已放</div>`;
        bindSlotItemDrag(div, t, "create");
        container.appendChild(div);
    });
}

function generatePuzzleCode() {
    if (Object.keys(createPlaced).length === 0) {
        showCreateError("请先在棋盘上放置至少一个地雷！");
        return;
    }
    showCreateError("");
    let rows = createRows, cols = createCols;
    let placed = createPlaced;
    let allTypes = Object.keys(M).sort();
    let typeIndex = {};
    allTypes.forEach((t, idx) => typeIndex[t] = idx);
    let numMines = Object.keys(placed).length;
    let byteLen = 2 + numMines * 2;
    let buffer = new ArrayBuffer(byteLen);
    let view = new DataView(buffer);
    view.setUint8(0, rows);
    view.setUint8(1, cols);
    let offset = 2;
    for (let key in placed) {
        let [r, c] = key.split(",").map(Number);
        let type = placed[key];
        let typeIdx = typeIndex[type];
    }
    byteLen = 2 + 3 * numMines;
    buffer = new ArrayBuffer(byteLen);
    view = new DataView(buffer);
    view.setUint8(0, rows);
    view.setUint8(1, cols);
    offset = 2;
    for (let key in placed) {
        let [r, c] = key.split(",").map(Number);
        let type = placed[key];
        let typeIdx = typeIndex[type];
        view.setUint8(offset, r);
        view.setUint8(offset + 1, c);
        view.setUint8(offset + 2, typeIdx);
        offset += 3;
    }
    let bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    let code = btoa(binary).replace(/=+$/, "");
    document.getElementById("puzzleCodeOutput").textContent = code;
    document.getElementById("shareCodeBtn").disabled = false;
    AudioFX.confirm();
}

function copyPuzzleCode() {
    let code = document.getElementById("puzzleCodeOutput").textContent;
    if (!code || code === "点击生成后显示") return;
    let text = "我分享了一个[反向💣扫雷]题目，来试试你能不能破解！" + code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            AudioFX.confirm();
            flashShareBtn();
        }).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    let ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(ta);
    AudioFX.confirm();
    flashShareBtn();
}

function flashShareBtn() {
    let btn = document.getElementById("shareCodeBtn");
    if (!btn) return;
    let old = btn.textContent;
    btn.textContent = "✅ 已复制";
    btn.style.background = "#48bb78";
    btn.style.borderColor = "#2f855a";
    setTimeout(() => {
        btn.textContent = old;
        btn.style.background = "";
        btn.style.borderColor = "";
    }, 1500);
}

function exitCreateMode() {
    createModeActive = false;
    document.getElementById("createModePanel").classList.remove("visible");
    document.getElementById("board").style.display = "";
    document.getElementById("slot").style.display = "";
    if (diff && !isFreeMode) {
        if (isPresetPending) enterPresetPending(pendingDiff); else newGame();
    } else {
        newGame();
    }
}

function applyPuzzleCode() {
    let input = document.getElementById("puzzleCodeInput");
    let raw = input.value.trim();
    if (!raw) {
        alert("请输入题库码！");
        return;
    }
    let prefix = "我分享了一个[反向💣扫雷]题目，来试试你能不能破解！";
    if (raw.startsWith(prefix)) raw = raw.substring(prefix.length);
    let code = raw.trim();
    try {
        while (code.length % 4 !== 0) code += "=";
        let binary = atob(code);
        let bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        let view = new DataView(bytes.buffer);
        let rows = view.getUint8(0);
        let cols = view.getUint8(1);
        if (rows < 4 || rows > 20 || cols < 4 || cols > 20) throw new Error("棋盘大小超出范围");
        if (rows * cols > 400) throw new Error("棋盘面积超出 400 格上限");
        let allTypes = Object.keys(M).sort();
        let placed = {};
        let offset = 2;
        while (offset + 2 < bytes.length) {
            let r = view.getUint8(offset);
            let c = view.getUint8(offset + 1);
            let typeIdx = view.getUint8(offset + 2);
            if (typeIdx >= allTypes.length) throw new Error("未知地雷类型索引");
            let type = allTypes[typeIdx];
            placed[r + "," + c] = type;
            offset += 3;
        }
        fullReset();
        createModeActive = false;
        document.getElementById("createModePanel").classList.remove("visible");
        SR = rows;
        SC = cols;
        S = Math.max(rows, cols);
        T = Object.keys(placed).length;
        let pool = {};
        for (let k in placed) {
            let t = placed[k];
            pool[t] = (pool[t] || 0) + 1;
        }
        G.pool = pool;
        G.max = T;
        G.placed = {};
        let tar = Array.from({
            length: SR
        }, () => Array(SC).fill(0));
        for (let k in placed) {
            let [r, c] = k.split(",").map(Number);
            M[placed[k]].f(r, c, tar);
        }
        applyTacticalEffects(tar, placed);
        G.tar = tar;
        G.placed = {};
        resetP();
        render();
        renderRecordList();
        document.getElementById("win").style.display = "none";
        document.getElementById("timer").style.display = "block";
        diff = null;
        isFreeMode = false;
        ts = true;
        startTi();
        AudioFX.confirm();
    } catch (e) {
        alert("题库码无效，请检查！\n" + e.message);
    }
}

function clearPuzzleInput() {
    document.getElementById("puzzleCodeInput").value = "";
    AudioFX.remove();
}

const _origFullReset = fullReset;

const _origNewGame = newGame;

fullReset = function() {
    _origFullReset();
    createModeActive = false;
    document.getElementById("createModePanel").classList.remove("visible");
    document.getElementById("puzzleCodeOutput").textContent = "点击生成后显示";
    document.getElementById("shareCodeBtn").disabled = true;
    let ba = document.getElementById("createBoardArea");
    if (ba) ba.style.display = "none";
    let sl = document.getElementById("createMineSlot");
    if (sl) sl.style.display = "none";
    let cc = document.getElementById("createCodeCard");
    if (cc) cc.style.display = "none";
    let ib = document.getElementById("createInfoBar");
    if (ib) ib.style.display = "none";
    showCreateError("");
};

newGame = function() {
    if (createModeActive) {
        exitCreateMode();
        return;
    }
    _origNewGame();
};
