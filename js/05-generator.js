/* ==========================================================================
 * 模块 05 · 题目生成器（js/05-generator.js）
 *
 * 职责：按当前棋盘参数生成一局题目（随机局与系列挑战局），并维护答案矩阵
 *       G.tar、目标数量 G.max 与牌池 G.pool；同时提供影响值重算、图鉴面板
 *       渲染与"脑王"通关彩蛋。
 * 依赖：04 的 M / applyTacticalEffects、00-core 的 SR/SC/T/SP/TY 等参数、
 *       01-storage 的 Store；图鉴与预览依赖对应 CSS 类名。
 * 对外：genGame、genTutorialGame、setupTutorialParams、genPreHtml、
 *       renderMineInfo、resetP、applyBrainEgg、lastChallengeTypes。
 * 设计要点：
 *   1) 出题思路是"先随机布雷、再反算目标值"：先随机决定每颗雷的位置与类型，
 *      再把所有雷的影响函数依次作用到全零矩阵上，得到目标值矩阵。这样任意
 *      雷型组合都不需要单独的求解器，直接复用 04 的结算流程。
 *   2) 目标矩阵 G.tar 就是"题目"本身；玩家放满 G.max 颗雷且 G.p 与 G.tar
 *      逐格相等才算通关。G.placed 只记录玩家放置的雷，与 G.tar 并存。
 *   3) 影响核可正可负、可跨格叠加，因此目标值允许为负或大于 8，生成阶段
 *      不做截断，显示时才按配色区间归类。
 * ========================================================================== */

/* ---------- 1. 随机出题：凑牌池 → 随机布雷 → 反算目标值 ---------- */
/**
 * 生成一局随机题目，结果写入 G.tar / G.pool / G.max 并清空玩家进度。
 * 牌池组成：普通雷占 T-SP 颗（至少 1 颗），特殊雷共 SP 颗，且尽量让
 * TY 种特殊雷都出现；确定牌池后把雷随机放到互不重复的格子上。
 * @sideeffect 重置 G.tar / G.pool / G.max / G.placed，并调用 resetP
 */
function genGame() {
    let enabled = getEnabledMineKeys();
    // 普通雷是保底雷型：即使未解锁也必须出现在牌池中
    if (!enabled.includes("normal")) enabled.unshift("normal");
    let specials = enabled.filter(k => k !== "normal");
    // 打乱特殊雷顺序，使每次开局选中的 TY 种雷不同
    specials.sort(() => Math.random() - .5);
    let sel = specials.slice(0, Math.min(TY, specials.length));
    // 可用特殊雷不足 TY 种时，用重复抽取补足本局的特殊雷名额
    while (sel.length < TY && specials.length > 0) {
        sel.push(specials[Math.floor(Math.random() * specials.length)]);
    }
    let pool = {};
    // 普通雷数量 = 总数 - 特殊雷数，至少保留 1 颗作为基础难度
    let normalNeeded = Math.max(1, T - SP);
    pool.normal = normalNeeded;
    let rem = SP;
    // 特殊雷名额先平均分给选中的 TY 种雷
    sel.forEach(t => {
        pool[t] = (pool[t] || 0) + 1;
        rem--;
    });
    // 名额有剩余时，在已选中的特殊雷里再随机补足
    while (rem > 0 && sel.length > 0) {
        let t = sel[Math.floor(Math.random() * sel.length)];
        pool[t]++;
        rem--;
    }
    // 没有任何特殊雷可选时，特殊雷名额全部转为普通雷
    while (rem > 0) {
        pool.normal++;
        rem--;
    }
    // 补全所有雷型的计数，便于槽位与图鉴统一按 key 取值
    for (let k of Object.keys(M)) {
        if (pool[k] === undefined) pool[k] = 0;
    }
    // 展开成待放置的雷型队列，顺序不影响最终目标值
    let mines = [];
    for (let t in pool) for (let i = 0; i < pool[t]; i++) mines.push(t);
    mines = mines.slice(0, T);
    // 拒绝采样：坐标被占用就重抽；最多 T 颗雷，循环必然结束
    let pos = new Set, ans = {};
    while (mines.length) {
        let r = Math.random() * SR | 0, c = Math.random() * SC | 0, k = r + "," + c;
        if (!pos.has(k)) {
            pos.add(k);
            ans[k] = mines.pop();
        }
    }
    // 目标值从全零矩阵开始，逐颗累加每颗雷的影响
    let tar = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let k in ans) {
        let [r, c] = k.split(",");
        M[ans[k]].f(+r, +c, tar);
    }
    // 战术雷依赖整份已放置集合，因此放在所有影响核之后统一结算
    applyTacticalEffects(tar, ans);
    // 写回本局状态：答案矩阵、牌池、目标数量，并清空玩家进度
    G.tar = tar;
    G.pool = pool;
    G.max = T;
    G.placed = {};
    resetP();
}

/* ---------- 2. 系列挑战出题与牌池编排 ---------- */
/* 本局系列挑战必定出现的雷型 key 列表（最多 2 项），由 genTutorialGame 写入，
   供通关弹窗展示"解锁了哪几种雷"。 */
let lastChallengeTypes = [];

/**
 * 返回打乱后的新数组，原数组保持不变（Fisher-Yates 洗牌）。
 * @param {Array} arr 原数组
 * @returns {Array} 元素顺序随机化的新数组
 */
function shuffleArr(arr) {
    let a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        let tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
    }
    return a;
}

/**
 * 生成一局系列练习/挑战题目：只使用普通雷与指定系列的特殊雷。
 * 未指定系列时按基础系列出题；指定系列时额外保证该系列中随机 2 种雷
 * 必定出现，并记录到 lastChallengeTypes 供通关弹窗展示。
 * @param {string} [categoryKey] 系列 key；省略则使用基础系列雷型
 * @sideeffect 写 G.tar / G.pool / G.max / G.placed / lastChallengeTypes
 */
function genTutorialGame(categoryKey) {
    // 未指定系列时的默认牌库：普通雷 + 基础系列中较易理解的 5 种特殊雷
    let allowed = [ "normal", "big5", "high", "chiliV", "chiliH", "chiliPlus" ];
    let forced = null;
    if (categoryKey) {
        // 纯系列局只保留普通雷与该系列雷，避免混入其他系列的影响核
        let catBombs = Object.keys(M).filter(k => M[k].category === categoryKey);
        allowed = [ "normal" ].concat(catBombs);
        // 从该系列随机挑 2 种，本局必定出现（系列雷种不足 2 种时全上）
        forced = shuffleArr(catBombs).slice(0, Math.min(2, catBombs.length));
    }
    let pool = {};
    // 普通雷数量与随机局一致：总数减去特殊雷名额，至少 1 颗
    pool.normal = Math.max(1, T - SP);
    let specials = allowed.filter(k => k !== "normal");
    let remain = T - pool.normal;
    if (forced && forced.length) {
        // 先让每种至少 1 颗，剩下的再随机分配，保证 2 种都真的出现
        forced.forEach(t => {
            pool[t] = 1;
            remain--;
        });
        while (remain > 0) {
            let t = forced[Math.floor(Math.random() * forced.length)];
            pool[t] = (pool[t] || 0) + 1;
            remain--;
        }
        // 记录本局必现雷型，供通关弹窗展示
        lastChallengeTypes = forced.slice();
    } else {
        // 没有必现雷型时，在允许的特殊雷里均匀随机分配
        while (remain > 0) {
            let t = specials[Math.floor(Math.random() * specials.length)];
            pool[t] = (pool[t] || 0) + 1;
            remain--;
        }
        lastChallengeTypes = [];
    }
    // 补全所有雷型的计数，保证槽位渲染能按 key 取到配额
    for (let k of Object.keys(M)) {
        if (pool[k] === undefined) pool[k] = 0;
    }
    // 展开成待放置队列，slice 保证最终不超过 T 颗
    let mines = [];
    for (let t in pool) for (let i = 0; i < pool[t]; i++) mines.push(t);
    mines = mines.slice(0, T);
    // 与随机局共用同一套拒绝采样与目标值反算流程
    let pos = new Set, ans = {};
    while (mines.length) {
        let r = Math.random() * SR | 0, c = Math.random() * SC | 0, k = r + "," + c;
        if (!pos.has(k)) {
            pos.add(k);
            ans[k] = mines.pop();
        }
    }
    let tar = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let k in ans) {
        let [r, c] = k.split(",");
        M[ans[k]].f(+r, +c, tar);
    }
    applyTacticalEffects(tar, ans);
    G.tar = tar;
    G.pool = pool;
    G.max = T;
    G.placed = {};
    resetP();
}

/**
 * 把页面参数显示同步为当前系列挑战的棋盘参数，并清空难度选中状态。
 * 只读全局 S/T/TY/SP 并写 DOM 文本，不改变任何棋盘数据。
 * @sideeffect 修改 #size / #total / #type / #spec 的文本，重置 diff
 */
function setupTutorialParams() {
    diff = null;
    document.getElementById("size").textContent = S;
    document.getElementById("total").textContent = T;
    document.getElementById("type").textContent = TY;
    document.getElementById("spec").textContent = SP;
}

/* ---------- 3. 图鉴渲染：预览网格与图鉴面板 ---------- */
/**
 * 生成某种雷的图鉴预览网格 HTML，包含中心高亮、影响范围、数值与对角分隔线。
 * values 缺省时视为"所有受影响格 +1"，因此不渲染数字；split 为真时额外
 * 画一条对角线，提示预览图里两个对称区域的关系。
 * @param {string} mk 雷型 key
 * @returns {string} 预览网格的 HTML 字符串
 */
function genPreHtml(mk) {
    const mine = M[mk];
    // 没有预览数据时给出占位文案，调用方无需判空
    if (!mine.preview) return "<div>无预览</div>";
    const {size: size, active: active, center: center, values: values, split: split} = mine.preview;
    // 未给出逐格数值时，默认影响为 +1，格子不显示数字
    const isPlus1 = !values;
    let diagonal = "";
    // 对称系列用一条对角线把两个落点区域分隔开
    if (split) diagonal = `<svg class="diagonal-line" viewBox="0 0 ${size} ${size}"><line x1="${size}" y1="0" x2="0" y2="${size}" stroke="#666" stroke-width="0.2"/></svg>`;
    // 每格固定 20px，预览网格尺寸与图鉴卡片布局解耦
    let html = `<div class="preview-grid" style="grid-template-columns: repeat(${size}, 20px);">${diagonal}`;
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
        let cls = "preview-cell";
        // 中心格（雷自身）与普通受影响格使用不同的高亮样式
        let isC = i === center[0] && j === center[1];
        let isA = active.some(([x, y]) => x === i && y === j);
        let val = !isPlus1 && values && values[i] && values[i][j] !== undefined ? values[i][j] : null;
        if (isC) {
            cls += " center";
        } else if (isA) {
            // 负值单独用 negative 样式，避免与正向影响混淆
            if (val !== null && val < 0) {
                cls += " negative";
            } else if (split) {
                if (i < 3 && j < 3) cls += " split-left"; else if (i >= 3 && j >= 3) cls += " split-right";
            } else {
                cls += " active";
            }
        }
        let cv = val !== null && val !== "" ? val : "";
        html += `<div class="${cls}">${cv}</div>`;
    }
    html += "</div>";
    return html;
}

/**
 * 重建"地雷图鉴"面板：按固定系列顺序输出各系列卡片，并根据 seriesUnlocked
 * 决定显示"练习 / 挑战 / 已解锁 / 始终开启"入口，同时为每种雷挂上预览图。
 * @sideeffect 覆盖 #mineInfoList 的 innerHTML
 */
function renderMineInfo() {
    const list = document.getElementById("mineInfoList");
    let html = "";
    // 图鉴按固定系列顺序展示，不受对象属性枚举顺序影响
    const catOrder = [ "basic", "special", "physics", "symmetry", "tactical" ];
    catOrder.forEach(catKey => {
        let unlocked = seriesUnlocked[catKey];
        let cat = CATEGORY[catKey];
        let bombs = Object.keys(M).filter(k => M[k].category === catKey);
        // 空系列不输出分组标题
        if (bombs.length === 0) return;
        html += `<div class="category-section" data-cat="${catKey}">`;
        html += `<div class="category-header"><strong>${cat.emoji} ${cat.name}</strong>`;
        // 基础系列默认开启：只提供基础挑战入口，不显示解锁按钮
        if (catKey === "basic") {
            html += `<span style="margin-left:auto;font-size:12px;color:#38a169;">✅始终开启</span>`;
            // 基础挑战：未完成显示红色「基础挑战」，完成后变绿色「练习」
            if (typeof isBasicChallengeDone === "function" && isBasicChallengeDone()) {
                html += `<button class="tutorial-btn-inline tutorial-btn-practice" onclick="openPracticeMode()">练习</button>`;
            } else {
                html += `<button class="tutorial-btn-inline tutorial-btn-challenge" onclick="openPracticeMode()">基础挑战</button>`;
            }
        } else if (unlocked) {
            // 已通关的系列：绿色「练习」
            html += `<button class="tutorial-btn-inline tutorial-btn-practice" onclick="startCategoryTutorial('${catKey}')">练习</button>`;
            html += `<span style="margin-left:8px;font-size:12px;color:#38a169;">🔓已解锁</span>`;
        } else {
            // 未通关的系列：红色「挑战」
            html += `<button class="tutorial-btn-inline tutorial-btn-challenge" onclick="startCategoryTutorial('${catKey}')">挑战</button>`;
            html += `<span style="margin-left:8px;font-size:12px;color:#a0aec0;">🔒 挑战完成解锁</span>`;
        }
        html += `</div>`;
        bombs.forEach(key => {
            let m = M[key];
            // 未解锁系列的雷种降透明度显示，但仍可查看影响说明
            let wrapStyle = unlocked ? "" : "opacity:0.75;";
            html += `<div class="mine-info-item" style="${wrapStyle}">\n                        <div class="mine-info-header">\n                            <div class="mine-info-emoji ${m.cls}">${m.e}</div>\n                            <div class="mine-info-name">${m.n}</div>\n                            ${unlocked ? "" : '<span style="margin-left:auto;font-size:11px;color:#a0aec0;">🔒</span>'}\n                        </div>\n                        <div class="mine-info-desc">${m.tip}</div>\n                        <div class="mine-info-tip">\n                            ℹ️查看影响范围\n                            <div class="mine-preview">${genPreHtml(key)}</div>\n                        </div>\n                    </div>`;
        });
        html += `</div>`;
    });
    // 一次性替换整块面板，避免逐节点插入引起多次重排
    list.innerHTML = html;
}

/* ---------- 4. 影响值重算 ---------- */
/**
 * 按给定放置表结算整盘影响值，不写入任何对局状态。
 * 先逐颗累加每颗雷的影响核，再结算战术雷的连锁语义；棋盘尺寸取当前 SR/SC。
 * @param {Object} placed 坐标键 "r,c" -> 雷型 key 的放置表
 * @returns {number[][]} SR×SC 的影响值矩阵
 */
function computeInfluenceMap(placed) {
    let board = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let k in placed) {
        let [r, c] = k.split(",");
        M[placed[k]].f(+r, +c, board);
    }
    // 战术雷依赖整份放置集合，放在基础影响核重算之后结算
    applyTacticalEffects(board, placed);
    return board;
}

/**
 * 依据当前已放置的地雷重新计算影响值矩阵 G.p（每次都从全零开始重算）。
 * G.tar 不参与计算。
 * @sideeffect 覆盖 G.p
 */
function resetP() {
    // 全量重算：单颗雷的影响可能跨越多格，增量更新容易漏算
    G.p = computeInfluenceMap(G.placed);
}

/* ---------- 5. 通关彩蛋 ---------- */
/**
 * "脑王"通关彩蛋：仅当存档标记 brainCleared 为真时，把标题里的炸弹 emoji
 * 换成墨镜 emoji，并附上一句悬浮说明。
 * @sideeffect 读取 Store，修改 .game-title 的文本与 title 属性
 */
function applyBrainEgg() {
    let cleared = false;
    try {
        cleared = Store.get("brainCleared") === "true";
    } catch (e) {}
    // 存储不可用或未通关时按"不出现彩蛋"处理，静默退出
    if (!cleared) return;
    let titleEl = document.querySelector(".game-title");
    // 标题节点缺失时不报错，彩蛋属于纯装饰
    if (!titleEl) return;
    // 只替换标题里的炸弹图标，其余文案保持不变
    titleEl.textContent = titleEl.textContent.replace(/💣/g, "😎");
    titleEl.title = "大佬的墨镜，实力无需多言";
}
