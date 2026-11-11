/* ==========================================================================
 * 模块 05 · 题目生成器（js/05-generator.js）
 *
 * 职责：按当前棋盘参数生成一局题目（随机局与系列挑战局），并维护答案矩阵
 *       G.tar、目标数量 G.max 与牌池 G.pool；同时提供影响值重算、图鉴面板
 *       渲染与"脑王"通关彩蛋。
 * 依赖：04 的 M / applyTacticalEffects / getEnabledMineKeys、00-core 的
 *       SR/SC/T/TY/SP/K/isFreeMode 等参数、01-storage 的 Store；
 *       图鉴与预览依赖对应 CSS 类名。
 * 对外：genGame、genFreeGame、genTetrisGame、genTutorialGame、setupTutorialParams、
 *       genPreHtml、renderMineInfo、resetP、applyBrainEgg、lastChallengeTypes。
 * 设计要点：
 *   1) 出题思路是"先随机布雷、再反算目标值"：先随机决定每颗雷的位置与类型，
 *      再把所有雷的影响函数依次作用到全零矩阵上，得到目标值矩阵。这样任意
 *      雷型组合都不需要单独的求解器，直接复用 04 的结算流程。
 *   2) 目标矩阵 G.tar 就是"题目"本身；玩家放满 G.max 颗雷且 G.p 与 G.tar
 *      逐格相等才算通关。G.placed 只记录玩家放置的雷，与 G.tar 并存。
 *   3) 影响核可正可负、可跨格叠加，因此目标值允许为负或大于 8，生成阶段
 *      不做截断，显示时才按配色区间归类。
 *   4) 两条出题路径：预设难度、教学与系列挑战沿用 TY / SP 旧配比
 *      （先定特殊雷种类与数量）；自由模式改用 T / K 新模型（K 为含普通雷的
 *      地雷种类数，先定种类、再把剩余颗数在已选雷型中随机分配）。两条路径
 *      共用同一套布雷、反算与战术结算流程，棋盘尺寸统一取 SR×SC。
 * ========================================================================== */

/* ---------- 1. 随机出题：凑牌池 → 随机布雷 → 反算目标值 ---------- */
/**
 * 生成一局随机题目，结果写入 G.tar / G.pool / G.max 并清空玩家进度。
 * 自由模式（isFreeMode）走 T / K 新模型，见 genFreeGame；
 * 其余模式沿用旧配比：普通雷占 T-SP 颗（至少 1 颗），特殊雷共 SP 颗，
 * 且尽量让 TY 种特殊雷都出现；确定牌池后把雷随机放到互不重复的格子上。
 * @sideeffect 重置 G.tar / G.pool / G.max / G.placed，并调用 resetP
 */
function genGame() {
    // 自由模式使用新参数模型（T 总雷数 / K 地雷种类数），与预设 / 挑战的
    // TY / SP 旧配比互不影响；其余模式保持原有生成逻辑，手感与旧成绩不变
    if (isFreeMode) {
        genFreeGame();
        return;
    }
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

/**
 * 生成一局自由模式题目（新参数模型：T 总雷数 / K 地雷种类数）。
 * 面积按 SR×SC 计算，T 与 K 先收敛到合法区间；牌池先保证「普通雷 1 颗 +
 * 选中的 K-1 种特殊雷各 1 颗」，剩余颗数在普通雷与已选特殊雷之间随机分配，
 * 因此牌池总数恒为 T（面积不足时收敛到面积），可用雷型足够时恰好 K 种。
 * 矩形棋盘（SR≠SC）可直接使用：布雷与反算都按实际行列进行。
 * @sideeffect 重置 G.tar / G.pool / G.max / G.placed，并调用 resetP
 */
function genFreeGame() {
    // 面积决定总雷数上限：矩形棋盘按 SR×SC 计算，避免放不下
    const area = Math.max(1, SR * SC);
    const total = Math.max(1, Math.min(T, area));
    // 可用雷型含普通雷；普通雷是保底雷型，未解锁也强制加入牌池
    let enabled = getEnabledMineKeys();
    if (!enabled.includes("normal")) enabled.unshift("normal");
    let specials = enabled.filter(k => k !== "normal");
    // 种类数收敛：不超过可用雷型数（含普通雷）、26 与总雷数；
    // 可用特殊雷不足时按实际数量收敛，牌池仍然填满 total 颗
    const kinds = Math.max(1, Math.min(K, 26, total, specials.length + 1));
    // 打乱后取前 K-1 种特殊雷：保证每次开局出现的雷型不同且互不重复
    specials = shuffleArr(specials);
    const sel = specials.slice(0, kinds - 1);
    // 牌池：普通雷 1 颗 + 选中特殊雷各 1 颗，先把"种类数"定死
    let pool = { normal: 1 };
    sel.forEach(t => {
        pool[t] = 1;
    });
    // 剩余名额在普通雷与已选特殊雷之间随机分配，只影响数量、不影响种类
    let remain = total - 1 - sel.length;
    const candidates = [ "normal" ].concat(sel);
    while (remain > 0) {
        pool[candidates[Math.floor(Math.random() * candidates.length)]]++;
        remain--;
    }
    // 补全所有雷型的计数，便于槽位与图鉴统一按 key 取值
    for (let k of Object.keys(M)) {
        if (pool[k] === undefined) pool[k] = 0;
    }
    // 展开成待放置的雷型队列，顺序不影响最终目标值
    let mines = [];
    for (let t in pool) for (let i = 0; i < pool[t]; i++) mines.push(t);
    mines = mines.slice(0, total);
    // 拒绝采样：坐标被占用就重抽；最多 total 颗雷且 total ≤ 面积，循环必然结束
    let pos = new Set, ans = {};
    while (mines.length) {
        let r = Math.random() * SR | 0, c = Math.random() * SC | 0, k = r + "," + c;
        if (!pos.has(k)) {
            pos.add(k);
            ans[k] = mines.pop();
        }
    }
    // 目标值从全零矩阵开始，逐颗累加每颗雷的影响（与旧路径一致）
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
    G.max = total;
    G.placed = {};
    resetP();
}

/* ---------- 6. 俄罗斯方块出题 ---------- */
/**
 * 生成一局「俄罗斯方块反向扫雷」题目：总块数取当前 T（骨牌占 1 个锚点格，
 * 因此受 SR×SC 约束），预设难度会再降为约 2/3（至少 3 块）以降低可旋转带来的
 * 推理量，自由模式尊重玩家设定的总雷数；7 种骨牌按随机配额分配——总块数 ≥ 7
 * 时每种至少 1 块，余量在已出现的类型里随机追加；总块数 < 7 时随机取 T 种各 1 块。
 * 每块骨牌随机朝向与锚点，锚点互不重复（自身格不可叠放）；影响值按覆盖的
 * 4 格各 +1 反算，越界部分不参与目标值（与放置时的裁剪规则一致）。
 * @sideeffect 写 G.tar / G.pool / G.max / G.placed / G.rot，重置 tetroRot 并调用 resetP
 */
function genTetrisGame() {
    const area = Math.max(1, SR * SC);
    // 骨牌块数：自由模式尊重玩家设定的总雷数；预设难度降为约 2/3（至少 3 块），
    // 让棋盘更空、可旋转带来的推理想象量下降，整体难度与经典难度更接近
    let total = Math.max(1, Math.min(T, area));
    const presetMode = !isFreeMode && typeof isPresetDifficulty === "function" &&
        isPresetDifficulty(diff);
    if (presetMode) total = Math.max(3, Math.ceil(total * 2 / 3));
    // 配额：先保证每种出现的类型 1 块，剩余名额在已选类型里随机分配
    const kinds = Math.min(TETRO_ORDER.length, total);
    const order = shuffleArr(TETRO_ORDER).slice(0, kinds);
    let pool = {};
    order.forEach(t => {
        pool[t] = 1;
    });
    let remain = total - kinds;
    while (remain > 0) {
        pool[order[Math.floor(Math.random() * order.length)]]++;
        remain--;
    }
    // 展开成待放置队列并打乱顺序，使锚点分布不偏向某一种骨牌
    let pieces = [];
    for (let t in pool) for (let i = 0; i < pool[t]; i++) pieces.push(t);
    pieces = shuffleArr(pieces).slice(0, total);
    // 逐块随机锚点：锚点已被占用就重抽；总块数不超过面积，顺序扫描必然能兜底
    let anchors = {}, ans = {}, rots = {};
    for (let i = 0; i < pieces.length; i++) {
        const t = pieces[i];
        let picked = null;
        for (let attempt = 0; attempt < 200; attempt++) {
            const r = Math.random() * SR | 0;
            const c = Math.random() * SC | 0;
            const k = r + "," + c;
            if (!anchors[k]) {
                picked = k;
                break;
            }
        }
        // 随机多次撞车时按键序找第一个空锚点，保证生成一定成功
        if (!picked) {
            for (let r = 0; r < SR && !picked; r++) for (let c = 0; c < SC; c++) {
                if (!anchors[r + "," + c]) {
                    picked = r + "," + c;
                    break;
                }
            }
        }
        if (!picked) break;
        anchors[picked] = true;
        ans[picked] = t;
        rots[picked] = Math.floor(Math.random() * 4);
    }
    // 目标值从全零矩阵开始，逐块累加覆盖的 4 格（含锚点自身）
    let tar = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let k in ans) {
        const parts = k.split(",");
        tetroAddInfluence(ans[k], rots[k], +parts[0], +parts[1], tar);
    }
    // 写回本局状态：答案矩阵、牌池、总块数，并清空玩家进度与槽位朝向
    G.tar = tar;
    G.pool = pool;
    G.max = Object.keys(ans).length;
    G.placed = {};
    G.rot = {};
    tetroRot = {};
    // 经典模式的战术雷结算对骨牌 key 无副作用，保持调用以复用同一条重算路径
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
    // 未指定系列时的默认牌库：普通雷 + 基础系列中较易理解的 4 种特殊雷
    // （十字辣椒已归入异形系列，不再出现在基础挑战的牌库中；扑克牌系列同样不进入）
    let allowed = [ "normal", "big5", "high", "chiliV", "chiliH" ];
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
 * 只读全局 S/SR/SC/T/K 并同步 DOM 文本，不改变任何棋盘数据；
 * 同步统一走 00-core 的参数入口，旧版 #type / #spec 节点缺失时自动跳过，
 * 09-tutorial 直接设置 TY / SP 后调用本函数也不会抛错。
 * @sideeffect 写参数显示节点并重置 diff
 */
function setupTutorialParams() {
    diff = null;
    if (typeof window.syncBoardParamDisplays === "function") window.syncBoardParamDisplays();
}

/* ---------- 3. 图鉴渲染：预览网格与图鉴面板 ---------- */
/**
 * 生成一张图鉴预览网格的 HTML：中心高亮、影响范围、逐格数值，并叠加可选的
 * 中心点 / 平分线 / 文本气泡与"其他地雷"标记。
 * 逐格数值缺省时视为"受影响格 +1"，因此不渲染数字；labels 用于把 0 之类的
 * 文字标在不受影响的格上，避免图例被误读成"本格也受影响"。
 * @param {Object} preview 预览数据：size / active / center / values / labels / marks / guides
 * @returns {string} 预览网格的 HTML 字符串
 */
function genPreHtml(preview) {
    // 没有预览数据时给出占位文案，调用方无需判空
    if (!preview) return "<div>无预览</div>";
    const {size, active, center, values, labels, marks, guides} = preview;
    // 未给出逐格数值时，默认影响为 +1，格子不显示数字
    const isPlus1 = !values;
    // 引导层：中心点 / 平分线画进覆盖整格的 SVG，文本气泡用绝对定位的 HTML
    let svgInner = "";
    let overlays = "";
    (guides || []).forEach(g => {
        if (g.type === "line") {
            const dash = g.dash ? ` stroke-dasharray="${g.dash}"` : "";
            svgInner += `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"${dash}/>`;
        } else if (g.type === "dot") {
            svgInner += `<circle cx="${g.x}" cy="${g.y}" r="${g.r || .13}"/>`;
        } else if (g.type === "callout") {
            // 百分比坐标让气泡跟随网格尺寸缩放，样式表里不写死像素
            overlays += `<span class="preview-callout" style="left:${(g.x / size * 100).toFixed(2)}%;top:${(g.y / size * 100).toFixed(2)}%">${g.text}</span>`;
        }
    });
    const guideSvg = svgInner ? `<svg class="preview-guide" viewBox="0 0 ${size} ${size}" preserveAspectRatio="none">${svgInner}</svg>` : "";
    // 每格固定 20px，预览网格尺寸与图鉴卡片布局解耦
    let html = `<div class="preview-grid" style="grid-template-columns: repeat(${size}, 20px);">${guideSvg}`;
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
        // 其他地雷标记优先于数值与中心样式：标记格只画 emoji，不重复画数字
        const mark = marks ? marks.find(m => m.r === i && m.c === j) : null;
        if (mark) {
            html += `<div class="preview-cell mark">${mark.text || "💣"}</div>`;
            continue;
        }
        let cls = "preview-cell";
        // 中心格（雷自身）与普通受影响格使用不同的高亮样式
        const isC = center && center[0] === i && center[1] === j;
        const isA = active.some(([x, y]) => x === i && y === j);
        const val = !isPlus1 && values[i] && values[i][j] !== undefined ? values[i][j] : null;
        if (isC) {
            cls += " center";
        } else if (isA) {
            // 负值单独用 negative 样式，避免与正向影响混淆
            if (val !== null && val < 0) cls += " negative"; else cls += " active";
        }
        // 逐格文字优先取 labels 覆盖，其次取数值
        const cv = labels && labels[i + "," + j] !== undefined ? labels[i + "," + j] :
            (val !== null && val !== "" ? val : "");
        html += `<div class="${cls}">${cv}</div>`;
    }
    html += overlays + "</div>";
    return html;
}

/**
 * 重建"地雷图鉴"面板：按固定系列顺序输出各系列卡片，并根据 seriesUnlocked
 * 显示"已解锁 / 始终开启 / 挑战完成解锁"状态（练习 / 挑战入口位于主按钮
 * 「🎯挑战」弹窗中）。
 * 普通雷种悬停展开单张预览；战术系列机制复杂，改为常驻展示多张图例与说明文本。
 * @sideeffect 覆盖 #mineInfoList 的 innerHTML
 */
function renderMineInfo() {
    const list = document.getElementById("mineInfoList");
    let html = "";
    // 图鉴按固定系列顺序展示，不受对象属性枚举顺序影响
    const catOrder = [ "basic", "special", "physics", "poker", "symmetry", "tactical" ];
    catOrder.forEach(catKey => {
        let unlocked = seriesUnlocked[catKey];
        let cat = CATEGORY[catKey];
        let bombs = Object.keys(M).filter(k => M[k].category === catKey);
        // 空系列不输出分组标题
        if (bombs.length === 0) return;
        html += `<div class="category-section" data-cat="${catKey}">`;
        html += `<div class="category-header"><strong>${cat.emoji} ${cat.name}</strong>`;
        /* 练习 / 挑战入口位于主按钮「🎯挑战」打开的弹窗中，
           炸弹信息只保留解锁状态说明，避免同一动作出现两个入口 */
        if (catKey === "basic") {
            html += `<span style="margin-left:auto;font-size:12px;color:#38a169;">✅始终开启</span>`;
        } else if (unlocked) {
            html += `<span style="margin-left:auto;font-size:12px;color:#38a169;">🔓已解锁</span>`;
        } else {
            html += `<span style="margin-left:auto;font-size:12px;color:#a0aec0;">🔒 挑战完成解锁</span>`;
        }
        html += `</div>`;
        bombs.forEach(key => {
            let m = M[key];
            // 未解锁系列的雷种降透明度显示，但仍可查看影响说明
            let wrapStyle = unlocked ? "" : "opacity:0.75;";
            let previewBlock;
            if (m.demos && m.demos.length) {
                // 多图例：每张图例配标题与一句话说明，常驻可见（悬停气泡装不下）
                previewBlock = `<div class="mine-demo-list">` + m.demos.map(d => {
                    return `<div class="mine-demo"><div class="mine-demo-grid">${genPreHtml(d.preview)}</div><div class="mine-demo-text"><div class="mine-demo-title">${d.title}</div><div class="mine-demo-note">${d.note}</div></div></div>`;
                }).join("") + `</div>`;
            } else {
                previewBlock = `<div class="mine-info-tip">ℹ️查看影响范围<div class="mine-preview">${genPreHtml(m.preview)}</div></div>`;
            }
            html += `<div class="mine-info-item" style="${wrapStyle}">\n                        <div class="mine-info-header">\n                            <div class="mine-info-emoji ${m.cls}">${m.e}</div>\n                            <div class="mine-info-name">${m.n}</div>\n                            ${unlocked ? "" : '<span style="margin-left:auto;font-size:11px;color:#a0aec0;">🔒</span>'}\n                        </div>\n                        <div class="mine-info-desc">${m.tip}</div>\n                        ${previewBlock}\n                    </div>`;
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
 * 俄罗斯方块模式下 placed 的值为骨牌 key（不在 M 中），按 G.rot 记录的朝向
 * 调用 tetroAddInfluence 结算，其余逻辑（战术雷、返回矩阵）完全一致。
 * @param {Object} placed 坐标键 "r,c" -> 雷型 key（或骨牌 key）的放置表
 * @returns {number[][]} SR×SC 的影响值矩阵
 */
function computeInfluenceMap(placed) {
    let board = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let k in placed) {
        let [r, c] = k.split(",");
        const t = placed[k];
        // 经典雷型走 M 的影响函数；骨牌走独立结算，两者不会出现在同一局
        if (M[t]) M[t].f(+r, +c, board);
        else if (TETRO[t]) tetroAddInfluence(t, G.rot[k] || 0, +r, +c, board);
    }
    // 战术雷依赖整份放置集合，放在基础影响核重算之后结算（骨牌局为空操作）
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
