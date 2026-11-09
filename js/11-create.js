/* ==========================================================================
 * 模块 11 · 创造模式与题库码（js/11-create.js）
 *
 * 职责：提供自定义棋盘编辑能力：选择尺寸、放置 / 移动 / 删除地雷，并把
 *       编辑结果编码成可分享的题库码，也能从题库码还原成一道题目。
 * 依赖：M（雷种定义，04-mines）、STD_PARAM_INTRO / STD_PARAM_FULL 与
 *       allSeriesChallengesDone（标准参数档，00-core）、
 *       全局对局状态 SR / SC / S / T / G（00-core）、render 与
 *       renderRecordList（06-render / 08-ui）、applyBoardMetrics / sizeCellsIn /
 *       bindCellDrag / bindSlotItemDrag（07-board）、applyTacticalEffects
 *       （04-mines）、genGame / resetP（05-generator）、AudioFX（02-audio）、
 *       fullReset / newGame（10-game）。
 * 对外：window.prepareCreateParams / window.startCreateBoard，以及全局函数
 *       generatePuzzleCode / applyPuzzleCode（经 12-settings 的 _gameNS 共享）；
 *       文件末尾以包装方式接管 fullReset 与 newGame。
 * 设计要点：
 *   1) "侧栏只改参数、生成才切棋盘"：prepareCreateParams 不碰任何对局状态，
 *      用户调整尺寸时不会把正在进行的游戏重置掉。
 *   2) createPlaced（"行,列" -> 雷种键）是创造棋盘的唯一数据源，渲染与
 *      题库码都从它派生，因此尺寸变化不会留下半成品状态。
 *   3) 题库码用定长二进制 + Base64 表达，纯前端即可分享关卡，无需后端。
 *   4) 通过包装 fullReset / newGame 接入统一的重置流程，而不改动 10-game.js。
 * ========================================================================== */

/* ---------- 1. 创造模式状态与尺寸约束 ---------- */

// 是否已进入创造模式；currentBoardKind 依据它判断棋盘归属
let createModeActive = false;

// 画布行列数：侧栏可调，真正生效前会被 clampSize 夹到合法区间
let createRows = 10;

let createCols = 10;

// 已放地雷：键为 "行,列"，值为雷种键；创造棋盘的一切展示都由此派生
let createPlaced = {};

// 最近一次渲染得到的期望值矩阵快照（与 createPlaced 同源），供扩展读取
let createdTarget = [];

// 画布尺寸下限 / 上限，以及格数上限：格数上限用于约束渲染与解析开销
const CREATE_MIN = 4;

const CREATE_MAX = 20;

const CREATE_MAX_CELLS = 400;

/**
 * 收集创造模式可用的雷种键。
 * 创造模式不参与系列解锁限制：图鉴里的全部地雷（26 种）都可用，
 * 出题人可以自由组合任意系列的影响核（主局仍受系列开关控制）。
 * @returns {string[]} 雷种键数组，顺序沿用 M 的定义顺序
 */
function getAllMineTypes() {
    return Object.keys(M);
}

/**
 * 把尺寸输入夹到 [CREATE_MIN, CREATE_MAX]；非数字输入回落到下限。
 * @param {*} v 输入框文本或数字
 * @returns {number} 合法尺寸
 */
function clampSize(v) {
    v = parseInt(v) || CREATE_MIN;
    return Math.max(CREATE_MIN, Math.min(CREATE_MAX, v));
}

/**
 * 在另一维已定的前提下，返回本维允许的最大值，使总格数不超过上限。
 * @param {number} otherDim 另一维的尺寸
 * @returns {number} 本维可用最大值（不小于下限）
 */
function getMaxAllowed(otherDim) {
    return Math.max(CREATE_MIN, Math.min(CREATE_MAX, Math.floor(CREATE_MAX_CELLS / otherDim)));
}

/**
 * 在侧栏的错误条上显示提示；传空串即清除提示。
 * @param {string} [msg] 错误文案
 * @sideeffect 改写 #createError 的文本。
 */
function showCreateError(msg) {
    let el = document.getElementById("createError");
    if (el) el.textContent = msg || "";
}

/* ---------- 2. 参数面板与信息条 ---------- */

/**
 * 刷新侧栏信息条：当前行 / 列、已放数量、可用雷种数与最大地雷数。
 * 最大地雷数徽标在首次调用时按需创建，之后只更新文本。
 * @sideeffect 更新 infoRows / infoCols / infoPlaced / infoTypes 等节点。
 */
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
        // 徽标按需创建一次，后续刷新只改写文本，避免反复增删节点
        maxHint = document.createElement("span");
        maxHint.id = "createMaxHint";
        maxHint.className = "info-chip";
        bar.appendChild(maxHint);
    }
    // 地雷数上限取总格数的 60%，与放置时的禁用阈值保持一致
    maxHint.innerHTML = "最大地雷数 <strong>" + Math.floor(totalCells * .6) + "</strong>";
    bar.style.display = "flex";
}

/**
 * 按按钮步进调整行或列：新值先夹到合法区间，再检查总面积是否超限。
 * 超限时不接受这次步进，而是退到另一维允许的最大值并给出提示，
 * 保证输入框显示的始终是可用尺寸。
 * @param {string} dim "rows" 或 "cols"
 * @param {number} delta 步进值（通常为 ±1）
 * @sideeffect 改写 createRows / createCols 与对应输入框的值。
 */
function createSizeStep(dim, delta) {
    AudioFX.pop();
    let isRows = dim === "rows";
    let cur = isRows ? createRows : createCols;
    let other = isRows ? createCols : createRows;
    let maxForOther = getMaxAllowed(other);
    let next = clampSize(cur + delta);
    // 总面积超限时用允许的最大值替代，而不是把输入框留在非法值上
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

/**
 * 处理尺寸输入框的直接输入：夹取合法值并校验总面积上限。
 * 超限时自动调整为允许的最大值，使界面与内部状态保持一致。
 * @param {string} dim "rows" 或 "cols"
 * @param {*} val 输入框的原始值
 * @sideeffect 改写 createRows / createCols 与对应输入框的值。
 */
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

/* ---------- 3. 进入创造模式与棋盘初始化 ---------- */

/**
 * 打开创造侧边栏时调用：只准备默认参数，不改动任何对局状态。
 * 这样用户可以慢慢调尺寸，当前这一局的棋盘与计时完全不受影响。
 * @sideeffect 仅在尚未进入创造模式时把尺寸重置为 10×10 并清除错误提示。
 */
function prepareCreateParams() {
    // 已经在创造模式里（主区有创造棋盘）时不重置尺寸，避免打断编辑
    if (createModeActive) return;
    createRows = 10;
    createCols = 10;
    const s1 = document.getElementById("createSize");
    const s2 = document.getElementById("createSize2");
    if (s1) s1.value = 10;
    if (s2) s2.value = 10;
    showCreateError("");
}
// 暴露到全局，供 HTML 的侧栏开关与外部入口直接调用
window.prepareCreateParams = prepareCreateParams;

/**
 * 点击「生成空棋盘」后真正进入创造模式：此时才执行全局重置并切换棋盘归属。
 * currentBoardKind() 依赖 createModeActive，过早置位会让主棋盘上的操作
 * 被误判成创造棋盘操作，因此必须等重置完成后再置位。
 * @sideeffect 调用 fullReset，改写 createModeActive 与侧栏 / 棋盘显示状态。
 */
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

/**
 * 直接进入创造模式并生成空棋盘：等价于设好参数后点「生成空棋盘」。
 * @sideeffect 进入创造模式、重置画布并渲染。
 */
function startCreateBoard() {
    enterCreateMode();
    initCreateBoard();
}
// 暴露到全局，供其他模块或控制台一键生成创造棋盘
window.startCreateBoard = startCreateBoard;

/**
 * 按输入框中的行列数初始化创造棋盘：校验面积、写回夹取后的值、
 * 同步全局棋盘尺寸并清空已放地雷，最后渲染画布与雷种面板。
 * @sideeffect 改写 createRows / createCols / createPlaced / SR / SC / S。
 */
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
    // 雷种计算与战术影响都按 SR / SC 读写，生成画布前先同步全局尺寸
    SR = r;
    SC = c;
    S = Math.max(r, c);
    // 每次生成空棋盘都从零开始，已放地雷不跨尺寸保留
    createPlaced = {};
    document.getElementById("createBoardArea").style.display = "";
    document.getElementById("createMineSlot").style.display = "";
    document.getElementById("createCodeCard").style.display = "";
    refreshCreateInfoBar();
    renderCreateBoard();
    renderCreateMineSlot();
}

/* ---------- 4. 棋盘编辑：放置、删除与移动 ---------- */

/**
 * 在指定格子放置一个地雷；格子已占用或雷种为空时直接忽略。
 * @param {number} r 行号
 * @param {number} c 列号
 * @param {string} type 雷种键（M 的键）
 * @sideeffect 写入 createPlaced，并重绘画布、雷种面板与信息条。
 */
function createPlace(r, c, type) {
    const key = r + "," + c;
    if (!type || createPlaced[key]) return;
    createPlaced[key] = type;
    _createLastDropKey = key;
    AudioFX.place();
    // 画布、雷种配额与信息条都从 createPlaced 派生，编辑后统一重绘
    renderCreateBoard();
    renderCreateMineSlot();
    refreshCreateInfoBar();
}

/**
 * 删除指定格子上的地雷；空格子调用无效果。
 * @param {number} r 行号
 * @param {number} c 列号
 * @sideeffect 从 createPlaced 删除条目，并重绘三处视图。
 */
function createRemove(r, c) {
    const key = r + "," + c;
    if (!createPlaced[key]) return;
    delete createPlaced[key];
    AudioFX.remove();
    renderCreateBoard();
    renderCreateMineSlot();
    refreshCreateInfoBar();
}

/**
 * 把已放置的地雷从 fromKey 移到 (r, c)；目标已占用或原地移动时忽略。
 * @param {string} fromKey 源格子的 "行,列" 键
 * @param {number} r 目标行号
 * @param {number} c 目标列号
 * @sideeffect 改写 createPlaced 中的键，并重绘三处视图。
 */
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

// 最近一次落子的格子键：渲染时据此给该格附加一次落子动画
let _createLastDropKey = null;

/**
 * 用 createPlaced 重新渲染整块创造棋盘：先按雷种定义算出每格的期望值，
 * 再画出地雷、数值与正负色标，最后按画布尺寸统一格子像素。
 * @sideeffect 重建 #createBoardArea 的子节点，并更新 createdTarget 快照。
 */
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
    // 雷种的 f(r,c,board) 依赖全局 SR / SC，先切换到画布尺寸，算完再切回
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
    // 深拷贝一份快照，避免后续复用 tempP 时连带改动 createdTarget
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
                // 正值与负值使用不同的色标，画布上可直接看出题目的数值分布
                if (val > 0) cell.classList.add("cell-valid"); else cell.classList.add("cell-over");
            }
            let key = r + "," + c;
            if (createPlaced[key]) {
                cell.classList.add("mine-here");
                if (key === _createLastDropKey) {
                    cell.classList.add("just-dropped");
                    _createLastDropKey = null;
                }
                let ty = createPlaced[key];
                cell.innerHTML = `<span class="${M[ty].cls}">${M[ty].e}</span>`;
            }
            // 左键落子、右键删除、拖拽换位：三种编辑方式绑定在同一批格子上
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
    // 创造棋盘不走主棋盘渲染：这里同步一次，让「地块准确数」提示保持隐藏
    if (typeof refreshHardcoreStat === "function") refreshHardcoreStat();
}

/**
 * 渲染雷种面板：按系列分组，一行一个系列（基础 5 种、异形 5 种，物理律 /
 * 扑克牌 / 对称 / 战术各 4 种），26 张卡片按系列分布，作者能按影响核分组快速找雷。
 * 每张卡显示雷种图标、名称与已放数量；总数达到上限时全部置灰。
 * @sideeffect 重建 #createMineSlot 的子节点（系列行 + 卡片）并绑定拖拽事件。
 */
function renderCreateMineSlot() {
    let container = document.getElementById("createMineSlot");
    container.innerHTML = "";
    // 全部 26 种雷都出现在面板里，逐个 filter 统计会白扫 26 遍，
    // 这里一次遍历得到每种雷的已放数量
    let used = {};
    for (let key in createPlaced) {
        let t = createPlaced[key];
        used[t] = (used[t] || 0) + 1;
    }
    let all = getAllMineTypes();
    let totalCells = createRows * createCols;
    let maxMines = Math.floor(totalCells * .6);
    let placedCount = Object.keys(createPlaced).length;
    // 达到上限后整块面板置灰，避免继续放置的请求被静默忽略
    let disabled = placedCount >= maxMines;
    // 系列行按 CATEGORY.order 排序：基础 → 异形 → 物理律 → 扑克牌 → 对称 → 战术
    Object.keys(CATEGORY).sort((a, b) => CATEGORY[a].order - CATEGORY[b].order).forEach(catKey => {
        let types = all.filter(t => M[t].category === catKey);
        if (!types.length) return;
        let cat = CATEGORY[catKey];
        let row = document.createElement("div");
        row.className = "create-mine-row";
        let label = document.createElement("div");
        label.className = "create-mine-cat";
        label.innerHTML = `<span class="cat-emoji">${cat.emoji}</span>${cat.name}`;
        row.appendChild(label);
        let list = document.createElement("div");
        list.className = "create-mine-items";
        types.forEach(t => {
            // 每个雷种的已放数量：面板上直接显示，便于作者控制难度
            let cnt = used[t] || 0;
            let div = document.createElement("div");
            div.className = "mine-item" + (disabled ? " disabled" : "") + (window._createSelectedType === t ? " selected" : "");
            div.dataset.tip = M[t].tip;
            div.dataset.mineType = t;
            div.innerHTML = `<div class="emoji-drag ${M[t].cls}">${M[t].e}</div><div>${M[t].n}</div><div>${cnt} 已放</div>`;
            bindSlotItemDrag(div, t, "create");
            list.appendChild(div);
        });
        row.appendChild(list);
        container.appendChild(row);
    });
}

/* ---------- 5. 题库码生成与分享 ---------- */

/* 题库码的雷种索引表：历史 22 种按旧版字典序冻结，新增雷种只能追加到末尾。
 * 题库码只存 1 字节索引、没有版本号与键名，改动已有顺序会让旧码解码成别的雷种，
 * 因此 11-create.js 的编码与解码都必须使用这张固定表，不能用 Object.keys(M).sort()。 */
const MINE_CODE_TYPES = [
    "amplifier", "anti", "big5", "bigBlackhole", "blackhole",
    "chiliBigDiag", "chiliDiag", "chiliH", "chiliPlus", "chiliV",
    "eight", "high", "locator", "mirror", "negativeMirror", "normal",
    "radiation", "ring", "shield", "siphon", "triSym", "yinYang",
    // 扑克牌系列（新增）：按字典序追加在历史索引之后，旧题库码的 0~21 保持不变
    "club", "diamond", "heart", "spade"
];

/**
 * 把当前创造棋盘编码成可分享的题库码（Base64 文本）。
 * 编码格式：第 1 字节为行数、第 2 字节为列数；之后每个地雷固定 3 字节，
 * 依次为行号、列号、雷种索引（索引取自 MINE_CODE_TYPES 的固定顺序）。
 * @sideeffect 把结果写入 #puzzleCodeOutput，并启用分享按钮。
 */
function generatePuzzleCode() {
    if (Object.keys(createPlaced).length === 0) {
        showCreateError("请先在棋盘上放置至少一个地雷！");
        return;
    }
    showCreateError("");
    let rows = createRows, cols = createCols;
    let placed = createPlaced;
    // 索引取自固定表：与对象属性枚举顺序、后续新增雷种都无关
    let allTypes = MINE_CODE_TYPES;
    let typeIndex = {};
    allTypes.forEach((t, idx) => typeIndex[t] = idx);
    let numMines = Object.keys(placed).length;
    // 头部 2 字节记录尺寸；此处先按 2 字节/雷 预留，实际结构在下方重算
    let byteLen = 2 + numMines * 2;
    let buffer = new ArrayBuffer(byteLen);
    let view = new DataView(buffer);
    view.setUint8(0, rows);
    view.setUint8(1, cols);
    let offset = 2;
    // 先遍历一遍取到每个地雷的类型索引；写入在下方按 3 字节/雷 的缓冲区进行
    for (let key in placed) {
        let [r, c] = key.split(",").map(Number);
        let type = placed[key];
        let typeIdx = typeIndex[type];
    }
    // 每个地雷固定占 3 字节：行、列、雷种索引，总长为 2 + 3 × 雷数
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
    // 先把字节数组转成二进制字符串，再交给 btoa 做 Base64 编码
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    // 去掉 Base64 尾部的等号填充使分享码更短，解码时再按 4 的倍数补齐
    let code = btoa(binary).replace(/=+$/, "");
    // 编码成功后同步界面：显示分享码并启用复制按钮
    document.getElementById("puzzleCodeOutput").textContent = code;
    document.getElementById("shareCodeBtn").disabled = false;
    AudioFX.confirm();
}

/**
 * 复制题库码到剪贴板：在分享码前拼接一句分享文案，便于直接粘贴到聊天工具。
 * 优先使用异步剪贴板 API，被浏览器拒绝时回落到同步复制方案。
 * @sideeffect 写系统剪贴板，并触发按钮的"已复制"反馈。
 */
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
        // 非安全上下文或不支持异步剪贴板的环境，直接走同步方案
        fallbackCopy(text);
    }
}

/**
 * 同步复制回落方案：借助隐藏 textarea 选中文本后执行复制命令。
 * @param {string} text 要复制的完整文本
 * @sideeffect 向 body 挂载并移除一个隐藏 textarea，并触发已复制反馈。
 */
function fallbackCopy(text) {
    let ta = document.createElement("textarea");
    ta.value = text;
    // textarea 必须处于可选中状态才能被 execCommand 复制，因此先挂到 body
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(ta);
    AudioFX.confirm();
    flashShareBtn();
}

/**
 * 复制成功的瞬时反馈：按钮短暂显示绿色"已复制"，1.5 秒后还原。
 * @sideeffect 改写按钮文案与内联样式，并用定时器还原。
 */
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

/* ---------- 6. 退出创造模式与题库码解析 ---------- */

/**
 * 退出创造模式：收起面板、显示主棋盘，并把棋盘尺寸重置为标准参数，
 * 然后按当前模式回到待开局或直接开一局新游戏。
 * @sideeffect 关闭面板、重置棋盘参数，并可能调用 newGame。
 */
function exitCreateMode() {
    createModeActive = false;
    document.getElementById("createModePanel").classList.remove("visible");
    document.getElementById("board").style.display = "";
    document.getElementById("slot").style.display = "";
    // 创造棋盘使用自定义尺寸（如 15×15），退出时必须先把标准参数写回，
    // 否则下一局会沿用创造模式的 SR/SC；预设难度随后还会按 PRE 覆盖一次。
    if (!isPresetDifficulty(diff)) applyStandardParams();
    if (diff && !isFreeMode) {
        if (isPresetPending) enterPresetPending(pendingDiff); else newGame();
    } else {
        newGame();
    }
}

/**
 * 解析输入框中的题库码并还原成一道可玩的题目。
 * 依次校验 Base64 解码、尺寸范围、总面积与雷种索引；任一步失败都会
 * 弹出提示并保持当前对局不变。
 * @sideeffect 成功后重置对局，按解码结果装配 G 与棋盘并开始计时。
 */
function applyPuzzleCode() {
    let input = document.getElementById("puzzleCodeInput");
    let raw = input.value.trim();
    if (!raw) {
        alert("请输入题库码！");
        return;
    }
    let prefix = "我分享了一个[反向💣扫雷]题目，来试试你能不能破解！";
    // 输入框可能粘进整段分享文案，先剥掉固定前缀，只保留题库码本体
    if (raw.startsWith(prefix)) raw = raw.substring(prefix.length);
    let code = raw.trim();
    try {
        // Base64 解码要求长度为 4 的倍数，补回编码时去掉的等号填充
        while (code.length % 4 !== 0) code += "=";
        let binary = atob(code);
        let bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        let view = new DataView(bytes.buffer);
        let rows = view.getUint8(0);
        let cols = view.getUint8(1);
        // 尺寸必须落在创造模式的合法区间内，否则视为损坏的题库码
        if (rows < 4 || rows > 20 || cols < 4 || cols > 20) throw new Error("棋盘大小超出范围");
        if (rows * cols > 400) throw new Error("棋盘面积超出 400 格上限");
        // 解码端与编码端共用同一张固定索引表，旧题库码的雷种不会错位
        let allTypes = MINE_CODE_TYPES;
        let placed = {};
        let offset = 2;
        // 逐条读取 3 字节记录；不足一条的尾部字节直接忽略
        while (offset + 2 < bytes.length) {
            let r = view.getUint8(offset);
            let c = view.getUint8(offset + 1);
            let typeIdx = view.getUint8(offset + 2);
            // 坐标必须落在声明的棋盘范围内，避免越界数据污染题面矩阵
            if (r >= rows || c >= cols) throw new Error("地雷坐标超出棋盘范围");
            // 类型索引必须落在当前雷种表内，否则无法确定地雷类型
            if (typeIdx >= allTypes.length) throw new Error("未知地雷类型索引");
            let type = allTypes[typeIdx];
            placed[r + "," + c] = type;
            offset += 3;
        }
        // 空题没有可放置的地雷：装配后 G.max === 0、G.placed 也为空，
        // 会被 checkWin 判成"立即通关"，因此必须拒绝（同一份码分享端也不会生成）
        if (Object.keys(placed).length === 0) throw new Error("题库码中没有地雷");
        // 全部校验通过后才重置对局，解码失败不会清掉玩家正在玩的这局
        // 重置、组装与渲染期间用"加载中"占位遮住棋盘与地雷槽，完成立即收起；
        // 内层任何一步抛异常也会在 finally 收掉占位，再交给外层 catch 提示
        showBoardLoading();
        try {
            fullReset();
            createModeActive = false;
            document.getElementById("createModePanel").classList.remove("visible");
            // 把解码尺寸写入全局棋盘参数；T 为本局地雷总数
            SR = rows;
            SC = cols;
            S = Math.max(rows, cols);
            T = Object.keys(placed).length;
            let pool = {};
            for (let k in placed) {
                let t = placed[k];
                pool[t] = (pool[t] || 0) + 1;
            }
            // 按雷种统计配额：G.pool 决定道具栏里每种雷可用多少个
            G.pool = pool;
            G.max = T;
            G.placed = {};
            // 按雷种定义重建期望值矩阵，流程与正常生成题目一致
            let tar = Array.from({
                length: SR
            }, () => Array(SC).fill(0));
            for (let k in placed) {
                let [r, c] = k.split(",").map(Number);
                M[placed[k]].f(r, c, tar);
            }
            // 战术道具会改写周围格子的期望值，解析结果也必须应用同一套规则
            applyTacticalEffects(tar, placed);
            G.tar = tar;
            G.placed = {};
            // 分享关卡不属于任何预设难度：必须在 render / checkWin 之前清掉
            // 难度标记，否则极端题面（如 0 雷）会按上一局的难度立即记账
            diff = null;
            isFreeMode = false;
            // 装配完成后统一重绘棋盘与记录表，并开始计时
            resetP();
            render();
            renderRecordList();
            document.getElementById("win").style.display = "none";
            document.getElementById("timer").style.display = "block";
            ts = true;
            startTi();
            AudioFX.confirm();
        } finally {
            hideBoardLoading();
        }
    } catch (e) {
        // 任何解析异常都转成友好提示，不让错误冒泡打断页面
        alert("题库码无效，请检查！\n" + e.message);
    }
}

/**
 * 清空题库码输入框，并播放删除音效。
 * @sideeffect 改写 #puzzleCodeInput 的值。
 */
function clearPuzzleInput() {
    document.getElementById("puzzleCodeInput").value = "";
    AudioFX.remove();
}

/* ---------- 7. 接管全局重置与新游戏入口 ---------- */

// 先保存原始实现：包装函数只在前后追加创造模式相关处理，原逻辑保持不动
const _origFullReset = fullReset;

const _origNewGame = newGame;

/**
 * 包装 fullReset：先执行原重置逻辑，再清空创造模式的编辑状态与面板显示。
 * 这样任何入口触发的重置都会同步收起创造面板，不会把编辑界面留在下一局。
 * @sideeffect 关闭创造面板、清空题库码输出并隐藏创造相关区域。
 */
fullReset = function() {
    _origFullReset();
    createModeActive = false;
    document.getElementById("createModePanel").classList.remove("visible");
    document.getElementById("puzzleCodeOutput").textContent = "点击生成后显示";
    document.getElementById("shareCodeBtn").disabled = true;
    // 创造区域按需创建，重置时可能尚未出现在 DOM 中，故逐个判空
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

/**
 * 包装 newGame：处于创造模式时，"新游戏"等价于退出创造模式回到主棋盘。
 * 这样玩家在创造模式里点新游戏不会同时留下两块棋盘。
 * @sideeffect 可能调用 exitCreateMode，进而重置状态并开新局。
 */
newGame = function() {
    if (createModeActive) {
        exitCreateMode();
        return;
    }
    _origNewGame();
};
