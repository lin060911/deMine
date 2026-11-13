/* ==========================================================================
 * 模块 07 · 棋盘交互与放置（js/07-board.js）
 *
 * 职责：度量棋盘格子尺寸，并实现「拖拽 / 点选」两种布雷模式下的放置、
 *       移动与删除，以及模式切换和棋盘尺寸的自适应重排。
 * 依赖：00-core 提供的全局棋盘状态 G 与尺寸 SR / SC；01-storage 的 Store；
 *       02-audio 的 AudioFX；04-mines 的雷型表 M 与骨牌表 TETRO / tetroCells；
 *       06-render 的 render 与 create / teach 两套渲染函数；以及
 *       createModeActive、teachActive、gameTetris、tetroRot 等模式标志位。
 * 对外：全局 window._placeMode、window.setPlaceMode、
 *       window.togglePlaceMode、window.openSettingSidebar，以及 drop、
 *       del、placeTetroAt 等交互服务函数。
 * 设计要点：
 *   1) 交互层只决定「在哪个格子放什么」，状态变更委托给 create / teach /
 *      主棋盘三个后端，避免三套棋盘的落子逻辑各自分叉。
 *   2) 鼠标走原生 HTML5 拖放，触屏走 Pointer Events，两条路径最终都
 *      收敛到 dropAt，使不同输入设备的落子语义保持一致。
 * ========================================================================== */

/* ---------- 1. 放置模式常量与当前棋盘判定 ---------- */

// 用户偏好键：只保存「拖拽 / 点选」这一项选择
const PLACE_MODE_KEY = "placeMode_v1";

// 当前放置模式："drag" 为拖拽，"click" 为点选；页面启动时由 Store 覆盖
window._placeMode = "drag";

/**
 * 判定交互当前作用于哪一块棋盘，作为所有放置逻辑的分派依据。
 * @returns {string} "create" 创造模式 / "teach" 教学关卡 / "main" 主棋盘
 */
function currentBoardKind() {
    if (createModeActive) return "create";
    if (teachActive) return "teach";
    return "main";
}

/* ---------- 2. 棋盘尺寸度量 ---------- */

/**
 * 计算单格边长，使整块棋盘在给定视口内完整可见。
 * @param {number} rows 棋盘行数
 * @param {number} cols 棋盘列数
 * @returns {number} 16~40 之间的整数像素值
 */
function calcCellSize(rows, cols) {
    // 上限 40px 保证大屏观感，下限 16px 保证小屏仍可点按
    const MAX = 40, MIN = 16, GAP = 2, PAD = 8;
    let vw = window.innerWidth || 0;
    // 兜底：内嵌 iframe 等场景下 window 尺寸可能为 0，退回文档元素宽度
    if (!vw && document.documentElement) vw = document.documentElement.clientWidth || 0;
    if (!vw && document.body) vw = document.body.clientWidth || 0;
    if (!vw) return MAX;
    // 桌面端主棋盘 / 教学棋盘右侧常驻操作 tips（样式表断点同为 1100px）：
    // tips 列固定 220 宽、与棋盘间距 18，此时棋盘可用宽度要扣掉列宽与间距，
    // 避免整行溢出视口；创造模式棋盘不挂在主棋盘托盘里、没有 tips 列，保持原尺寸
    const tipsSide = vw > 1100 && !(typeof createModeActive !== "undefined" && createModeActive);
    if (vw > 700) {
        if (!tipsSide) return MAX;
        const byTips = Math.floor((vw - 48 - 220 - 18 - PAD - GAP * (cols - 1)) / cols);
        return Math.max(MIN, Math.min(MAX, byTips));
    }
    // 宽度约束：扣除左右留白、棋盘内边距和格间距后，均分给每一列
    const byW = Math.floor((vw - 14 - PAD - GAP * (cols - 1)) / cols);
    const vh = window.innerHeight || 0;
    // 高度约束：棋盘最多占视口高度的一半，给标题与操作区留出空间
    const byH = vh ? Math.floor((vh * .5 - PAD - GAP * (rows - 1)) / rows) : MAX;
    // 取两个方向的较小值并取整：非整数尺寸会让相邻格子之间出现 1px 缝隙
    return Math.max(MIN, Math.min(MAX, Math.min(byW, byH)));
}

/**
 * 把格子尺寸写入棋盘：栅格模板、CSS 变量与 dataset 三处保持一致。
 * @param {HTMLElement} board 棋盘容器
 * @param {number} rows 行数
 * @param {number} cols 列数
 * @sideeffect 改写 board 的内联样式并缓存 dataset.cellSize
 */
function applyBoardMetrics(board, rows, cols) {
    if (!board) return;
    const cs = calcCellSize(rows, cols);
    board.style.gridTemplateRows = `repeat(${rows},${cs}px)`;
    board.style.gridTemplateColumns = `repeat(${cols},${cs}px)`;
    // 同步到 CSS 变量，样式表里的间距与边框按同一基准换算
    board.style.setProperty("--cell-size", cs + "px");
    // 缓存到 dataset，重绘格子时不必再次测量视口
    board.dataset.cellSize = cs;
}

/**
 * 按缓存的格子尺寸统一设置每格宽高与字号。
 * @param {HTMLElement} board 棋盘容器
 * @sideeffect 写入每个 .cell 及其中地雷图形的内联尺寸
 */
function sizeCellsIn(board) {
    if (!board) return;
    // dataset 缺失时退回 40px，保证首次渲染也有确定尺寸
    const cs = parseInt(board.dataset.cellSize, 10) || 40;
    // 数字字号随格子等比缩放，并夹在 11~18px 内保证可读
    const fs = Math.max(11, Math.min(18, Math.round(cs * .45)));
    Array.prototype.forEach.call(board.querySelectorAll(".cell"), function(el) {
        el.style.width = cs + "px";
        el.style.height = cs + "px";
        el.style.fontSize = fs + "px";
    });
    // 地雷 emoji 需要比数字更大才能填满格子，因此单独放大
    const es = Math.max(12, Math.round(cs * .58));
    Array.prototype.forEach.call(board.querySelectorAll(".cell span[class*='-bomb']"), function(el) {
        el.style.fontSize = es + "px";
    });
}

/* ---------- 3. 选中地雷类型 ---------- */

/**
 * 读取某块棋盘当前选中的地雷类型；三块棋盘的选中状态彼此独立。
 * @param {string} kind 棋盘标识：create / teach / main
 * @returns {string|null} 地雷类型键，未选中时为 null
 */
function getSelectedType(kind) {
    if (kind === "create") return window._createSelectedType;
    if (kind === "teach") return window._teachSelectedType;
    return selectedMineType;
}

/**
 * 写入某块棋盘的选中地雷类型。
 * @param {string} kind 棋盘标识
 * @param {string|null} t 地雷类型键
 * @sideeffect 主棋盘还会记录 G.lastDragType，供拖放载荷缺失时兜底
 */
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

/**
 * 切换选中：再次点击已选中的类型即取消选中。
 * @param {string} kind 棋盘标识
 * @param {string} t 地雷类型键
 * @sideeffect 播放音效并重绘对应的地雷槽位
 */
function toggleSelectedType(kind, t) {
    setSelectedType(kind, getSelectedType(kind) === t ? null : t);
    AudioFX.pop();
    if (kind === "create") renderCreateMineSlot(); else if (kind === "teach") renderTeachSlot(); else renderSlot();
}

/**
 * 判断某类地雷是否已用满配额；用满后槽位不可拖、不可点选。
 * @param {string} t 地雷类型键
 * @param {string} kind 棋盘标识
 * @returns {boolean} true 表示该类地雷已无剩余
 */
function slotTypeFull(t, kind) {
    if (kind === "create") {
        // 创造模式只限制总雷数：不超过格子总数的 60%
        const total = (createRows || 10) * (createCols || 10);
        return Object.keys(createPlaced).length >= Math.floor(total * .6);
    }
    if (kind === "teach") {
        // 教学关卡按当前关卡的配比表逐类计数
        const lvl = typeof TEACH_LEVELS !== "undefined" && TEACH_LEVELS[teachLevelIdx] ? TEACH_LEVELS[teachLevelIdx] : null;
        const mt = lvl ? lvl.mineTypes || (lvl.mineType ? {
            [lvl.mineType]: 1
        } : {}) : {};
        return (teachPlacedTypes[t] || 0) >= (mt[t] || 0);
    }
    // 主棋盘按本局配比表逐类计数
    const used = Object.values(G.placed).filter(x => x === t).length;
    return used >= (G.pool[t] || 0);
}

/* ---------- 4. 三块棋盘统一的放置入口 ---------- */

/**
 * 伪造一个 drop 事件对象，让主棋盘的 drop 处理器可被代码直接调用。
 * @param {string|null} type 地雷类型，作为 dataTransfer 的载荷
 * @returns {Object} 只含 dataTransfer.getData 与空 preventDefault 的最小事件对象
 */
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

/**
 * 在指定格子上放置一颗地雷，按棋盘分派到对应后端。
 * @param {string} kind 棋盘标识
 * @param {HTMLElement} cell 目标格
 * @param {string|null} type 地雷类型
 */
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

/**
 * 把棋盘上已有的一颗雷从 fromKey 移到目标格，用于拖拽后的重定位。
 * @param {string} kind 棋盘标识
 * @param {string} fromKey 源格坐标键 "r,c"
 * @param {HTMLElement} cell 目标格
 * @sideeffect 主棋盘借用 G.drag 标记源格，复用 drop 的移动分支
 */
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

/**
 * 删除指定格子上的地雷，按棋盘分派到对应后端。
 * @param {string} kind 棋盘标识
 * @param {number} r 行号
 * @param {number} c 列号
 */
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

/**
 * 统一落子决策：先判断是否在移动已有雷，再决定要放置的类型。
 * @param {HTMLElement} cell 目标格
 * @param {string} kind 棋盘标识
 * @param {string|null} type 拖放携带的类型，可为空
 * @param {string|null} fromKey 拖动源格坐标键，非移动场景为 null
 * @sideeffect 读取并可能写入 G.drag 与各棋盘的选中类型
 */
function dropAt(cell, kind, type, fromKey) {
    if (!cell) return;
    // 源格上的雷仍然存在才按"移动"处理，否则视为一次新的放置
    const map = kind === "create" ? createPlaced : G.placed;
    if (fromKey && map[fromKey]) {
        moveMineTo(kind, fromKey, cell);
        return;
    }
    if (!type) type = getSelectedType(kind);
    if (!type && kind === "main") type = G.lastDragType;
    placeAtCell(kind, cell, type);
}

/* ---------- 5. HTML5 拖放绑定 ---------- */

/**
 * 为一个格子挂载拖放监听：拖拽模式下它既可作为拖动源，也可作为落点。
 * @param {HTMLElement} cell 格子元素
 * @param {string} kind 棋盘标识
 * @sideeffect 覆盖 cell 的 draggable 与 on* 事件属性；点选模式下一律置空
 */
function bindCellDrag(cell, kind) {
    const r = +cell.dataset.r, c = +cell.dataset.c;
    const key = r + "," + c;
    const map = kind === "create" ? createPlaced : G.placed;
    const hasMine = !!map[key];
    const isDrag = window._placeMode === "drag";
    // 拖动源只在本格已有雷时启用：拖动它即代表把这颗雷挪到别处
    if (isDrag && hasMine) {
        cell.draggable = true;
        cell.ondragstart = function(e) {
            clearPlacementPreview();
            try {
                // 用 0×0 的空 Image 作拖影，避免浏览器截图式拖影遮挡落点
                e.dataTransfer.setDragImage(new Image, 0, 0);
            } catch (_) {}
            G.drag = key;
            try {
                // 写一段占位文本：dataTransfer 为空时部分浏览器会取消拖动
                e.dataTransfer.setData("text/plain", "");
                e.dataTransfer.effectAllowed = "move";
            } catch (_) {}
            cell.classList.add("dragging");
        };
        cell.ondragend = function() {
            cell.classList.remove("dragging");
            G.drag = null;
            clearPlacementPreview();
        };
    } else {
        cell.draggable = false;
        cell.ondragstart = null;
        cell.ondragend = null;
    }
    // 落点监听挂在所有格子上，落点是否合法交给 dropAt 判断
    if (isDrag) {
        cell.ondragover = function(e) {
            // 必须阻止默认行为，浏览器才会把该元素视为可放置区域
            e.preventDefault();
            cell.classList.add("drag-over");
            // 骨牌局不做落点预演：清掉可能残留的经典预览高亮后直接返回
            if (gameTetris) {
                clearPlacementPreview();
                return;
            }
            previewPlacementEffect(kind, cell);
        };
        cell.ondragleave = function(e) {
            cell.classList.remove("drag-over");
            // 移到别的格子或本格子元素时交给下一处 dragover 覆盖，避免预览闪断
            const to = e && e.relatedTarget;
            if (to && to.closest && to.closest(".cell")) return;
            clearPlacementPreview();
        };
        cell.ondrop = function(e) {
            e.preventDefault();
            cell.classList.remove("drag-over");
            clearPlacementPreview();
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

/* ---- 原生拖拽预览：只截取单个 emoji ---- */

/**
 * 取得（必要时创建）常驻的拖拽预览节点，并把内容换成指定地雷的 emoji。
 * 节点固定在视口外：原生拖放只截取「已渲染」元素的外观，display:none 会被
 * 当成空图像，所以这里保留布局与渲染、只把位置挪出屏幕。
 * 俄罗斯方块模式下 M 里没有骨牌，改用该骨牌代表色的单色方块作拖影。
 * @param {string} type 地雷类型键或骨牌 key
 * @returns {HTMLElement} 位于 body 下、视口外的预览节点
 * @sideeffect 首次调用时向 body 追加 #mineDragImage，之后只替换其内容
 */
function mineDragImageNode(type) {
    const m = M[type] || null;
    // 骨牌不在 M 中：按 TETRO 的代表色生成拖影，避免显示成普通雷的 emoji
    const tetro = (!m && typeof TETRO !== "undefined" && TETRO[type]) ? TETRO[type] : null;
    let el = document.getElementById("mineDragImage");
    if (!el) {
        el = document.createElement("div");
        el.id = "mineDragImage";
        el.className = "mine-drag-image";
        // 纯视觉节点，对读屏软件隐藏
        el.setAttribute("aria-hidden", "true");
        document.body.appendChild(el);
    }
    // emoji 与图形类名复用槽位卡片的写法，保证颜色 / 旋转等视觉一致
    if (m) el.innerHTML = '<span class="' + m.cls + '">' + m.e + "</span>";
    else if (tetro) el.innerHTML = '<span style="display:block;width:26px;height:26px;border-radius:6px;background:' + (tetro.color || "#8ab4f8") + ';"></span>';
    else el.innerHTML = '<span class="normal-bomb">💣</span>';
    return el;
}

/**
 * 把原生拖拽预览替换成单个 emoji，替代浏览器默认截取的整张槽位卡片。
 * 只影响视觉：dataTransfer 载荷、G.drag 等拖拽逻辑一概不动。
 * @param {DragEvent} e dragstart 事件
 * @param {string} type 地雷类型键
 * @sideeffect 可能追加 #mineDragImage，并改写 dataTransfer 的拖拽图像
 */
function setMineDragImage(e, type) {
    try {
        const el = mineDragImageNode(type);
        // 以预览中心对准指针，让 emoji 跟着光标而不是偏在一侧
        e.dataTransfer.setDragImage(el, el.offsetWidth / 2, el.offsetHeight / 2);
    } catch (_) {}
}

/**
 * 为地雷槽位挂载拖放监听：拖出即选中该类型，点击则切换选中状态。
 * @param {HTMLElement} div 槽位条目
 * @param {string} t 地雷类型键
 * @param {string} kind 棋盘标识
 * @sideeffect 覆盖 div 的 draggable、onclick 与拖放事件属性
 */
function bindSlotItemDrag(div, t, kind) {
    const full = slotTypeFull(t, kind);
    const isDrag = window._placeMode === "drag";
    if (isDrag) {
        div.draggable = !full;
        div.ondragstart = function(e) {
            if (full) {
                // 配额已满的槽位仍会收到 dragstart，这里立即取消以形成"拖不动"的手感
                e.preventDefault();
                return;
            }
            clearPlacementPreview();
            // 原生拖放预览只截取单个 emoji，不截取整张「emoji + 名称 + 数量」卡片
            setMineDragImage(e, t);
            // 从槽位拖出的是新雷，不是棋盘上已有的雷，清空 G.drag 避免误判为移动
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
            clearPlacementPreview();
        };
    } else {
        div.draggable = false;
        div.ondragstart = null;
        div.ondragend = null;
    }
    // 点选模式下槽位只负责"选中"，实际落子在棋盘格子上完成
    div.onclick = function() {
        if (!full) toggleSelectedType(kind, t);
    };
    // 效果说明气泡：窄屏点按选中即显示，宽屏触屏长按；卡片可能被重复绑定，内部保证幂等
    bindSlotItemTip(div);
}

/* ---- 地雷卡效果说明气泡：body 级固定定位，避免被槽位 overflow 裁剪 ---- */

// 复用的气泡节点；懒创建，避免脚本加载时 body 尚未就绪
let _mineTipEl = null;

/**
 * 取得（必要时创建）页面唯一的效果说明气泡节点。
 * 节点挂在 body 下而不是卡片内，窄屏下才不会被 .mine-slot-box 的 overflow 裁剪。
 * @returns {HTMLElement} #mineTipFixed 节点
 * @sideeffect 首次调用时向 body 追加气泡节点
 */
function ensureMineTip() {
    if (_mineTipEl && _mineTipEl.parentNode) return _mineTipEl;
    let el = document.getElementById("mineTipFixed");
    if (!el) {
        el = document.createElement("div");
        el.id = "mineTipFixed";
        el.className = "mine-tip-fixed";
        el.setAttribute("role", "tooltip");
        // 外观（配色、层级、最大宽度）由样式表负责，这里只兜底定位基准
        el.style.position = "fixed";
        el.style.left = "0";
        el.style.top = "0";
    }
    document.body.appendChild(el);
    _mineTipEl = el;
    return el;
}

/**
 * 在触发元素正上方居中显示说明气泡；上方空间不足时翻到下方，并夹在视口内。
 * @param {HTMLElement} el 触发元素（地雷卡或系列开关行）
 * @param {string} [text] 指定气泡文本；缺省时读取 el.dataset.tip。
 *   系列开关行的炸弹清单直接传入，地雷卡则沿用 data-tip。
 * @sideeffect 写入 #mineTipFixed 的文本、left / top 与显示状态
 */
function showMineTip(el, text) {
    const msg = typeof text === "string" ? text : (el && el.dataset ? el.dataset.tip || "" : "");
    if (!msg) {
        hideMineTip();
        return;
    }
    const tip = ensureMineTip();
    tip.textContent = msg;
    // 带换行的文本（系列炸弹清单）按多行排版，单项说明保持原有单行样式
    tip.classList.toggle("mine-tip-multi", msg.indexOf("\n") >= 0);
    // 先以 display:block 参与布局并临时隐藏，才能量到换行后的真实宽高
    tip.style.visibility = "hidden";
    tip.style.display = "block";
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth || (document.documentElement ? document.documentElement.clientWidth : 0);
    const vh = window.innerHeight || (document.documentElement ? document.documentElement.clientHeight : 0);
    const w = tip.offsetWidth, h = tip.offsetHeight;
    // 水平：样式表用 translateX(-50%)，故 left 传气泡中心坐标，再夹在视口内 8px
    const half = Math.min(w, Math.max(0, vw - 16)) / 2;
    let left = rect.left + rect.width / 2;
    left = Math.max(8 + half, Math.min(vw - 8 - half, left));
    // 垂直：优先显示在卡片上方，上方空间不足时翻到下方
    let top = rect.top - h - 10;
    if (top < 8) top = rect.bottom + 10;
    // 下方也放不下时贴边显示，保证气泡完整留在视口内
    top = Math.max(8, Math.min(Math.max(8, vh - h - 8), top));
    tip.style.left = Math.round(left) + "px";
    tip.style.top = Math.round(top) + "px";
    tip.style.visibility = "";
}

/**
 * 隐藏效果说明气泡。
 * @sideeffect 把 #mineTipFixed 置为 display:none（层级由样式表提供）
 */
function hideMineTip() {
    if (_mineTipEl) _mineTipEl.style.display = "none";
}

// 页面滚动（含槽位自身滚动）或视口尺寸变化时收起气泡，避免气泡与卡片位置脱节
window.addEventListener("scroll", hideMineTip, true);
window.addEventListener("resize", hideMineTip);

/**
 * 为地雷卡挂载效果说明气泡的触发逻辑：
 *   - 窄屏（≤700px）：点按卡片即"选中"，选中后立即显示说明、再点一次取消选中即收起，
 *     手指 / 鼠标都适用，无需长按等待；点按棋盘或页面空白处也会收起。
 *   - 宽屏触屏（>700px）：保留长按 420ms 显示、松手 / 移动 / 离开收起（宽屏鼠标
 *     仍使用样式表的 :hover 气泡，不经过这里）。
 * 卡片节点会被增量渲染反复绑定，故用 _tipHoldBound 保证同一节点只绑一次。
 * @param {HTMLElement} div 地雷卡节点
 * @sideeffect 向 div 添加 pointer / click 监听；可能创建 #mineTipFixed
 */
function bindSlotItemTip(div) {
    if (!div || div._tipHoldBound) return;
    div._tipHoldBound = true;
    // 窄屏是否已经挂过"点空白处收起"的全局监听（整个页面只需要一次）
    ensureMineTipOutsideClose();
    // 长按时长：短于 480ms 的删除长按，触屏没有 hover 时也能查看说明
    const HOLD_MS = 420;
    let holdTimer = 0, tipShown = false, downX = 0, downY = 0;
    /**
     * 取消待触发的长按计时。
     */
    function cancelHold() {
        if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = 0;
        }
    }
    /**
     * 结束当前长按：取消待触发的计时并收起气泡。
     */
    function endHold() {
        cancelHold();
        tipShown = false;
        hideMineTip();
    }
    div.addEventListener("pointerdown", function(e) {
        if (e.pointerType === "mouse") return;
        // 窄屏走"点按选中即显示"（见下方 click 分支），不走长按计时
        if (window.innerWidth <= 700) return;
        downX = e.clientX;
        downY = e.clientY;
        cancelHold();
        hideMineTip();
        holdTimer = setTimeout(function() {
            holdTimer = 0;
            tipShown = true;
            showMineTip(div);
        }, HOLD_MS);
    });
    div.addEventListener("pointermove", function(e) {
        if (!holdTimer && !tipShown) return;
        // 手指移动过多视为滑动 / 拖动，不展示说明
        if (Math.abs(e.clientX - downX) > 8 || Math.abs(e.clientY - downY) > 8) endHold();
    });
    div.addEventListener("pointerup", endHold);
    div.addEventListener("pointercancel", endHold);
    div.addEventListener("pointerleave", endHold);
    // 窄屏：点按卡片（click 在卡片自身的选中切换之后触发）→ 选中即显示，取消选中即收起
    div.addEventListener("click", function() {
        if (window.innerWidth > 700) return;
        if (div.classList.contains("selected")) showMineTip(div); else hideMineTip();
    });
    // 鼠标悬停：仅窄屏用固定气泡，宽屏交给 ::after 的 hover 气泡
    div.addEventListener("pointerenter", function(e) {
        if (e.pointerType === "mouse" && window.innerWidth <= 700) showMineTip(div);
    });
    // 部分设备的触屏长按会直接进入原生拖拽：开始拖动即收起气泡
    div.addEventListener("dragstart", hideMineTip);
}

// 窄屏"点空白处收起气泡"的全局监听是否已安装
let _mineTipOutsideBound = false;

/**
 * 安装一次性的全局监听：点按地雷卡以外的区域时收起效果说明气泡。
 * 只在窄屏（≤700px，点选气泡生效的场景）需要；捕获阶段执行，避免被局部 stopPropagation 挡住。
 * @sideeffect 向 document 添加 capture 阶段的 pointerdown 监听
 */
function ensureMineTipOutsideClose() {
    if (_mineTipOutsideBound) return;
    _mineTipOutsideBound = true;
    document.addEventListener("pointerdown", function(e) {
        const t = e.target;
        if (t && t.closest && t.closest(".mine-item")) return;
        hideMineTip();
    }, true);
}

/**
 * 为容器内所有格子批量挂载拖放监听。
 * @param {HTMLElement} root 棋盘容器
 * @param {string} kind 棋盘标识
 */
function bindCellsIn(root, kind) {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll(".cell"), function(el) {
        bindCellDrag(el, kind);
    });
}

/**
 * 为容器内所有地雷槽位批量挂载拖放监听，跳过没有类型标记的条目。
 * @param {HTMLElement} root 槽位容器
 * @param {string} kind 棋盘标识
 */
function bindSlotIn(root, kind) {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll(".mine-item"), function(el) {
        if (el.dataset.mineType) bindSlotItemDrag(el, el.dataset.mineType, kind);
    });
}

/**
 * 把当前放置模式应用到 DOM：只重绑当前可见的那一块棋盘与槽位。
 * @sideeffect 重写格子的 draggable 与拖放事件属性
 */
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

/* ---------- 6. 放置模式切换与持久化 ---------- */

/**
 * 刷新放置模式相关界面：按钮选中态、提示文案、模式角标与 body 类名。
 * @sideeffect 改写 modeBtnDrag / modeBtnClick / modeHint / modeBadge 与 body.class
 */
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
    // body 上的类名供样式表区分两种模式下的光标与提示样式
    document.body.classList.toggle("drag-mode", isDrag);
}

/**
 * 读取持久化的放置模式并应用；存储值非法时回落到拖拽模式。
 * @sideeffect 写入 window._placeMode 与模式相关界面
 */
function initPlaceMode() {
    const saved = Store.get(PLACE_MODE_KEY);
    window._placeMode = saved === "drag" || saved === "click" ? saved : "drag";
    applyPlaceModeUI();
}

/**
 * 切换放置模式并持久化，随后立即重绑当前棋盘的交互。
 * @param {string} mode "drag" 或 "click"，其余取值直接忽略
 * @sideeffect 写入 window._placeMode 与 Store，并刷新界面与事件绑定
 */
function setPlaceMode(mode) {
    if (mode !== "drag" && mode !== "click") return;
    if (window._placeMode !== mode) {
        window._placeMode = mode;
        try {
            Store.set(PLACE_MODE_KEY, mode);
        } catch (e) {}
        AudioFX.confirm();
    }
    clearPlacementPreview();
    applyPlaceModeToDom();
    applyPlaceModeUI();
}

window.setPlaceMode = setPlaceMode;

/**
 * 在两种模式之间来回切换，供界面按钮直接调用。
 */
window.togglePlaceMode = function() {
    setPlaceMode(window._placeMode === "drag" ? "click" : "drag");
};

/**
 * 打开设置侧边栏；打开前先收起其它侧边栏，保证同时只开一个。
 * @sideeffect 播放音效、修改侧边栏的 open 类名
 */
window.openSettingSidebar = function() {
    const sb = document.getElementById("settingSidebar");
    if (!sb) return;
    AudioFX.confirm();
    closeSidebarsExcept("settingSidebar");
    sb.classList.add("open");
};

// 脚本加载时即读取用户上次选择的模式，避免每次刷新都重置
initPlaceMode();

/* ---------- 7. 视口尺寸自适应 ---------- */

let _resizeTid = 0, _lastSizeKey = "";

/**
 * 视口尺寸变化时重排棋盘：去抖 180ms，且仅在格子尺寸真的变化时重绘。
 * @sideeffect 更新去抖计时器与尺寸键，并触发当前棋盘的整块重绘
 */
window.addEventListener("resize", function() {
    clearTimeout(_resizeTid);
    _resizeTid = setTimeout(function() {
        const kind = currentBoardKind();
        const rows = kind === "create" ? createRows : SR;
        const cols = kind === "create" ? createCols : SC;
        // 尺寸键含模式、行列数与格子边长：只改窗口高度但格子不变时不重绘
        const key = kind + "|" + rows + "x" + cols + "|" + calcCellSize(rows, cols);
        if (key === _lastSizeKey) {
            // 格子尺寸没变，但视口宽度可能变了：tips 的侧边 / 堆叠判定仍要复算
            if (typeof syncBoardTipsPlacement === "function") syncBoardTipsPlacement();
            return;
        }
        _lastSizeKey = key;
        clearPlacementPreview();
        if (kind === "create") {
            renderCreateBoard();
            renderCreateMineSlot();
        } else if (kind === "teach") {
            renderTeachBoard();
            renderTeachSlot();
        } else render();
        // 重绘后棋盘宽度可能变化：再复算一次 tips 摆放方式
        if (typeof syncBoardTipsPlacement === "function") syncBoardTipsPlacement();
    }, 180);
});

/* ---------- 8. 触屏拖拽的会话状态与工具函数 ---------- */

// 触屏交互模型：指针按下 → 可能进入长按删除；越过阈值 → 激活拖动 → 抬起落子。
// 同一时刻只维护一个会话对象 st，其余手指的下按事件直接忽略。
(function initPointerDrag() {
    // 移动超过该距离才判定为拖拽，避免点按时的轻微手抖被识别成拖动
    const MOVE_THRESHOLD = 6;
    // 长按时长：触屏没有右键菜单，长按删除是"删除已放置地雷"的替代入口
    const LONG_PRESS_MS = 480;
    // 双击删除：触屏在同一格上两次点按的间隔不超过该值即删除
    const DOUBLE_TAP_MS = 320;
    // 当前指针会话；为 null 表示没有正在跟踪的指针
    let st = null;
    // 最近一次触屏点按 { kind, key, time }：用于识别"同一格快速点两下"的双击删除
    let lastTap = null;
    /**
     * 清除长按计时器；拖动一旦开始，长按删除就不会触发。
     * @param {Object} s 指针会话状态
     */
    function clearTimers(s) {
        if (s && s.lpTimer) {
            clearTimeout(s.lpTimer);
            s.lpTimer = 0;
        }
    }
    /**
     * 用视口坐标反查格子；指针可能落在格子的子元素上，故向上找最近的 .cell。
     * @param {number} x 视口横坐标
     * @param {number} y 视口纵坐标
     * @param {string} kind 棋盘标识
     * @returns {HTMLElement|null} 命中且属于当前棋盘的格子
     */
    function findCell(x, y, kind) {
        if (!document.elementFromPoint) return null;
        const el = document.elementFromPoint(x, y);
        if (!el || !el.closest) return null;
        const cell = el.closest(".cell");
        if (!cell) return null;
        // 必须确认格子属于当前棋盘，避免拖到另一块棋盘上误落子
        if (kind === "create") return cell.closest("#createBoardArea") ? cell : null;
        return cell.closest("#board") ? cell : null;
    }
    /**
     * 计算拖影位移，使拖影中心跟随指针。
     * @param {number} x 视口横坐标
     * @param {number} y 视口纵坐标
     * @param {boolean} isTouch 是否触屏操作
     * @returns {string} 可直接赋给 transform 的 translate3d 值
     */
    function ghostPos(x, y, isTouch) {
        // 触屏时再上抬 30px，避免拖影被指尖完全遮住
        return "translate3d(" + (x - 23) + "px," + (y - 23 - (isTouch ? 30 : 12)) + "px,0)";
    }
    /**
     * 创建跟随指针的拖影元素，外观取自地雷类型表；骨牌局用代表色方块代替。
     * @param {string} type 地雷类型键或骨牌 key
     * @param {number} x 初始横坐标
     * @param {number} y 初始纵坐标
     * @param {boolean} isTouch 是否触屏操作
     * @returns {HTMLElement} 已插入 body 的拖影节点
     */
    function makeGhost(type, x, y, isTouch) {
        const m = M[type] || null;
        const tetro = (!m && typeof TETRO !== "undefined" && TETRO[type]) ? TETRO[type] : null;
        const g = document.createElement("div");
        g.className = "drag-ghost";
        if (m) g.innerHTML = '<span class="' + m.cls + '">' + m.e + "</span>";
        else if (tetro) g.innerHTML = '<span style="display:block;width:30px;height:30px;border-radius:8px;background:' + (tetro.color || "#8ab4f8") + ';"></span>';
        else g.innerHTML = '<span class="normal-bomb">💣</span>';
        g.style.transform = ghostPos(x, y, isTouch);
        document.body.appendChild(g);
        return g;
    }
    /**
     * 移除拖影并清除源元素的高亮类。
     * @param {Object|null} s 指针会话状态
     * @sideeffect 从 document.body 中删除拖影节点并收起落点预览
     */
    function killGhost(s) {
        if (!s) return;
        if (s.ghost && s.ghost.parentNode) s.ghost.parentNode.removeChild(s.ghost);
        s.ghost = null;
        s.pvCell = null;
        clearPlacementPreview();
        if (s.src && s.src.classList) s.src.classList.remove("dragging");
    }
    /**
     * 清除当前落点格的高亮。
     * @param {Object|null} s 指针会话状态
     */
    function clearHover(s) {
        if (s && s.hover) {
            s.hover.classList.remove("drag-over");
            s.hover = null;
        }
    }
    /**
     * 更新触屏拖拽的落点预览：同一目标格只结算一次，离开可放置格时收起。
     * @param {Object} s 指针会话状态
     * @param {HTMLElement|null} cell 当前指针下的格子
     */
    function updateDragPreview(s, cell) {
        // 骨牌局不做落点预演：清掉经典预览高亮后直接返回
        if (gameTetris) {
            clearPlacementPreview();
            return;
        }
        // 源格自身不作为落点预览，与落点高亮的处理保持一致
        const target = cell && cell !== s.src ? cell : null;
        if (target === s.pvCell) return;
        s.pvCell = target;
        if (!target) {
            clearPlacementPreview();
            return;
        }
        previewPlacementEffect(s.kind, target, s.mode === "cell" ? s.fromKey : "");
    }
    /**
     * 触发设备振动反馈；设备不支持振动接口时静默跳过。
     * @param {number} ms 振动时长（毫秒）
     */
    function buzz(ms) {
        if (navigator.vibrate) {
            try {
                navigator.vibrate(ms);
            } catch (_) {}
        }
    }
    /**
     * 指针靠近视口上下边缘时自动滚动页面，便于把雷拖到大棋盘的屏幕外区域。
     * @param {number} y 指针纵坐标
     */
    function autoScroll(y) {
        const vh = window.innerHeight || 0;
        if (!vh || y < 0 || y > vh) return;
        let dy = 0;
        // 边缘 70px 内开始滚动，步长固定为 12px，避免滚动过快
        if (y < 70) dy = -12; else if (y > vh - 70) dy = 12;
        if (!dy) return;
        try {
            window.scrollBy(0, dy);
        } catch (_) {}
    }
    /**
     * 吞掉拖放结束后紧跟的一次 click，避免"拖到格子上"被当成"点击"。
     * @sideeffect 在 document 捕获阶段挂一次性监听，400ms 后自动移除
     */
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
        // 捕获阶段拦截，确保先于格子自身的 click 处理器执行
        document.addEventListener("click", swallow, true);
        tid = setTimeout(cleanup, 400);
    }
/* ---------- 9. 指针事件处理：按下 / 移动 / 抬起 ---------- */

    /**
     * 指针按下：区分"从槽位拖出新雷"与"拖动棋盘上已有的雷"两种会话。
     * @param {PointerEvent} e 指针按下事件
     * @sideeffect 写入会话状态 st，可能注册长按删除计时器
     */
    function onDown(e) {
        if (!e) return;
        // 鼠标交给原生 HTML5 拖放，这里只接管触摸与触控笔；鼠标按下同时作废双击记录
        if (e.pointerType === "mouse") {
            lastTap = null;
            return;
        }
        if (st) return;
        const target = e.target;
        if (!target || !target.closest) return;
        const kind = currentBoardKind();
        const slotItem = target.closest(".mine-item");
        if (slotItem) {
            // 点过槽位后，下一次点按不计入上一次棋盘点按的"第二下"
            lastTap = null;
            // 点选模式下槽位不参与拖动，选中与放置由 click 路径完成
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
                pvCell: null,
                lpTimer: 0
            };
            return;
        }
        const cell = target.closest(".cell");
        if (cell && cell.classList.contains("mine-here")) {
            const r = +cell.dataset.r, c = +cell.dataset.c, key = r + "," + c;
            const map = kind === "create" ? createPlaced : G.placed;
            const type = map[key];
            if (!type) {
                // 理论上带 mine-here 的格子必有雷，状态不同步时清掉双击记录
                lastTap = null;
                return;
            }
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
                pvCell: null,
                lpTimer: 0
            };
            // 长按删除：点选模式下已有雷不可拖动，这是该类设备上的删除入口
            st.lpTimer = setTimeout(function() {
                const s = st;
                // 已经开始拖动则取消删除，避免"想移动却删掉"
                if (!s || s.active) return;
                st = null;
                clearTimers(s);
                // 长按删除不属于双击序列
                lastTap = null;
                removeAtCell(s.kind, s.r, s.c);
                buzz(18);
                swallowNextClick();
            }, LONG_PRESS_MS);
        }
        // 按下空格或棋盘外：作废上一次点按，避免"点 A → 点空 → 点 A"被误判为双击
        if (!st) lastTap = null;
    }
    /**
     * 指针移动：首次越过阈值时激活拖动，激活后持续更新拖影与落点高亮。
     * @param {PointerEvent} e 指针移动事件
     * @sideeffect 可能创建拖影、切换高亮格、滚动页面
     */
    function onMove(e) {
        if (!st || e.pointerId !== st.pid) return;
        const dx = e.clientX - st.startX, dy = e.clientY - st.startY;
        if (!st.active) {
            // 未越过阈值时保持静止，给"点按"留出容错空间
            if (Math.abs(dx) < MOVE_THRESHOLD && Math.abs(dy) < MOVE_THRESHOLD) return;
            // 拖动优先于长按：一旦开始移动就取消长按删除计时
            clearTimers(st);
            if (!st.canDrag) {
                const s = st;
                st = null;
                killGhost(s);
                return;
            }
            st.active = true;
            // 拖动开始后，该次按下不计入双击序列
            lastTap = null;
            st.ghost = makeGhost(st.type, e.clientX, e.clientY, st.isTouch);
            if (st.src && st.src.classList) st.src.classList.add("dragging");
            // 拖动时同步选中类型，松手后点选路径仍保持该类型
            setSelectedType(st.kind, st.type);
            buzz(10);
        }
        // 必须阻止默认行为，否则触屏拖动会触发页面滚动并中断拖影
        if (e.cancelable) e.preventDefault();
        if (st.ghost) st.ghost.style.transform = ghostPos(e.clientX, e.clientY, st.isTouch);
        autoScroll(e.clientY);
        const cell = findCell(e.clientX, e.clientY, st.kind);
        if (cell !== st.hover) {
            clearHover(st);
            // 源格自身不显示落点高亮，其余格子高亮提示"可放置"
            if (cell && cell !== st.src) {
                cell.classList.add("drag-over");
                st.hover = cell;
            }
        }
        updateDragPreview(st, cell);
    }
    /**
     * 指针抬起：有落点则执行放置或移动，没有落点则只清理现场。
     * @param {PointerEvent} e 指针抬起事件
     * @sideeffect 清理会话，并调用 dropAt 落子
     */
    function onUp(e) {
        if (!st || e.pointerId !== st.pid) return;
        const s = st;
        st = null;
        clearTimers(s);
        // 没有越过阈值的抬起视为点按，不落子
        if (!s.active) {
            killGhost(s);
            // 触屏双击删除：同一格两次点按间隔 ≤320ms 即删除，与长按删除并存
            if (s.mode === "cell") {
                const now = Date.now();
                if (lastTap && lastTap.kind === s.kind && lastTap.key === s.fromKey &&
                    now - lastTap.time <= DOUBLE_TAP_MS) {
                    // 清空记录重新计数，避免第三下继续触发
                    lastTap = null;
                    // 俄罗斯方块局：双击改为绕锚点旋转已放置骨牌（删除仍用长按 / 右键）；
                    // 经典局保持双击删除
                    if (gameTetris && s.kind === "main" && typeof rotateTetroOnDouble === "function") {
                        rotateTetroOnDouble(s.r, s.c);
                    } else {
                        removeAtCell(s.kind, s.r, s.c);
                    }
                    buzz(18);
                    // 处理完浏览器仍会补发 click，吞掉它以免点选模式下又立刻操作一次
                    swallowNextClick();
                    return;
                }
                lastTap = {
                    kind: s.kind,
                    key: s.fromKey,
                    time: now
                };
            } else {
                // 从槽位点按不属于双击序列
                lastTap = null;
            }
            return;
        }
        const cell = s.hover || findCell(e.clientX, e.clientY, s.kind);
        clearHover(s);
        killGhost(s);
        // 抬起后浏览器还会补发一次 click，吞掉它以免误选中或误删
        swallowNextClick();
        if (cell) dropAt(cell, s.kind, s.type, s.mode === "cell" ? s.fromKey : null);
    }
    /**
     * 指针取消（系统手势、来电等）：只清理现场，不落子。
     * @param {PointerEvent} e 指针取消事件
     */
    function onCancel(e) {
        if (!st) return;
        if (e && e.pointerId !== st.pid) return;
        const s = st;
        st = null;
        clearTimers(s);
        // 取消的这次按下不参与双击序列
        lastTap = null;
        clearHover(s);
        killGhost(s);
    }
    document.addEventListener("pointerdown", onDown, {
        passive: true
    });
    // pointermove 必须是非 passive：拖动中要 preventDefault 阻止页面滚动
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

/* ---------- 10. 主棋盘的放置与删除 ---------- */

/**
 * 在指定锚点格放置一块骨牌（俄罗斯方块模式）。
 * 锚点不可与其它骨牌重叠，并受该骨牌剩余配额与总块数上限约束；
 * 骨牌覆盖范围允许超出棋盘，越界部分只是不参与影响值结算，因此这里不做边界校验。
 * @param {string} kind 棋盘标识，仅 "main" 生效
 * @param {HTMLElement} cell 目标锚点格
 * @param {string} type 骨牌 key（I/O/J/L/S/Z/T）
 * @param {number} [rot] 朝向 0~3；省略时取该骨牌在槽位里的当前朝向
 * @returns {boolean} 放置成功返回 true
 * @sideeffect 写入 G.placed / G.rot / G.lastDragType，播放音效并重绘棋盘
 */
function placeTetroAt(kind, cell, type, rot) {
    if (kind !== "main" || !gameTetris) return false;
    if (typeof TETRO === "undefined" || !TETRO[type]) return false;
    if (!cell || !cell.dataset) return false;
    const r = +cell.dataset.r, c = +cell.dataset.c;
    if (!isFinite(r) || !isFinite(c)) return false;
    const key = r + "," + c;
    // 自身格不可叠放：锚点已被占用时直接放弃
    if (G.placed[key]) return false;
    // 配额校验放在交互层：任何入口都不能放入超过配额的骨牌
    const used = Object.values(G.placed).filter(function(x) {
        return x === type;
    }).length;
    if (used >= (G.pool[type] || 0)) return false;
    // 总块数上限：达到 G.max 后不再允许放置
    if (Object.keys(G.placed).length >= G.max) return false;
    G.placed[key] = type;
    G.rot[key] = rot == null ? ((tetroRot && tetroRot[type]) || 0) : ((rot % 4) + 4) % 4;
    G.lastDragType = type;
    try {
        AudioFX.place();
    } catch (e) {}
    // 点选放置与拖拽一致：首次操作时开始计时
    if (typeof startTiOnFirst === "function") startTiOnFirst();
    resetP();
    render();
    return true;
}
window.placeTetroAt = placeTetroAt;

/**
 * 主棋盘落子入口：既处理"从槽位拖入新雷"，也处理"把已有的雷挪到新位置"。
 * 绑定为格子自身的 drop 处理器，故用 this 指向目标格。
 * 俄罗斯方块模式下改走骨牌分支：拖动已放骨牌即整块搬移，否则按锚点新放一块。
 * @param {Event} e 拖放事件；地雷类型可从 dataTransfer 中取得
 * @sideeffect 写入 G.placed、G.drag、G.rot、G.lastDragType 并触发重绘
 */
function drop(e) {
    // 骨牌局：整块骨牌的放置与移动，经典路径保持原样
    if (gameTetris && currentBoardKind() === "main") {
        // 拖动已放置的骨牌：目标锚点空闲则整块搬过去，朝向沿用原值
        if (G.drag) {
            const from = G.drag;
            G.drag = null;
            const r = +this.dataset.r, c = +this.dataset.c, to = r + "," + c;
            if (from !== to && G.placed[from] && !G.placed[to]) {
                const t = G.placed[from];
                G.rot[to] = G.rot[from] || 0;
                delete G.placed[from];
                delete G.rot[from];
                G.placed[to] = t;
                try {
                    AudioFX.place();
                } catch (e1) {}
                resetP();
                render();
            }
            return;
        }
        // 从槽位拖入新骨牌：类型来源优先级与经典一致
        let type = null;
        try {
            if (e && e.dataTransfer) type = e.dataTransfer.getData("text/plain") || null;
        } catch (e2) {}
        if (!type) type = G.lastDragType || getSelectedType("main");
        placeTetroAt("main", this, type);
        return;
    }
    // 首次操作才开始计时，保证题目展示期间不计时
    startTiOnFirst();
    let r = +this.dataset.r, c = +this.dataset.c, k = r + "," + c;
    // 目标格已有雷时直接放弃，避免覆盖已有布局
    if (G.placed[k]) return;
    if (G.drag) {
        // 移动分支：源格在 dragstart 时记录到 G.drag
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
    // 类型来源优先级：拖放载荷 > 上次拖动类型 > 当前选中类型
    if (e && e.dataTransfer) t = e.dataTransfer.getData("text/plain") || G.lastDragType;
    if (!t && selectedMineType) t = selectedMineType;
    if (!t) return;
    let used = Object.values(G.placed).filter(x => x === t).length || 0;
    let max = G.pool[t] || 0;
    // 配额校验放在交互层：任何入口都不能放入超过配比数量的雷
    if (used >= max) return;
    G.placed[k] = t;
    G.lastDragType = t;
    AudioFX.place();
    resetP();
    render();
}

/**
 * 反查覆盖指定格子的骨牌锚点：先按锚点键匹配，未命中再遍历所有骨牌的影响范围。
 * 删除、旋转与双击判定共用这一份查找逻辑，避免三处各写一遍覆盖判断。
 * @param {number} r 行号
 * @param {number} c 列号
 * @returns {?string} 覆盖该格的骨牌锚点键（"行,列"）；没有骨牌覆盖时返回 null
 */
function findTetroAnchorAt(r, c) {
    const key = r + "," + c;
    if (G.placed[key]) return key;
    if (typeof tetroCells !== "function") return null;
    for (let k in G.placed) {
        const type = G.placed[k];
        if (typeof TETRO === "undefined" || !TETRO[type]) continue;
        const parts = k.split(",");
        const rot = (G.rot && G.rot[k]) || 0;
        const offs = tetroCells(type, rot) || [];
        for (let i = 0; i < offs.length; i++) {
            if (+parts[0] + offs[i][0] === r && +parts[1] + offs[i][1] === c) return k;
        }
    }
    return null;
}

/**
 * 删除覆盖指定格子的整块骨牌：先按锚点匹配，未命中再按覆盖范围反查锚点。
 * 删除整块而不是单格，保证"影响值按块结算"与棋盘状态始终一致。
 * @param {number} r 行号
 * @param {number} c 列号
 * @sideeffect 无命中时不做任何事；命中则删除 G.placed / G.rot 中的锚点并重绘
 */
function removeTetroAt(r, c) {
    const target = findTetroAnchorAt(r, c);
    // 该格没有任何骨牌覆盖：右键 / 长按删除视为空操作
    if (!target) return;
    startTiOnFirst();
    AudioFX.remove();
    delete G.placed[target];
    delete G.rot[target];
    // 已放计数与清空条由 render -> renderSlot 的现有路径刷新
    resetP();
    render();
}

/* ---------- 俄罗斯方块：已放置骨牌的旋转与"双击"防误触 ---------- */
/* 双击（桌面 dblclick / 触屏双击）已放置的骨牌时绕其锚点顺时针旋转。
 * 桌面单击会立即放置一块新骨牌，因此双击的第一下可能正好在骨牌身上落了一块：
 * 这里记录最近一次"单击放置"，双击时若命中同一锚点就先撤销那块误放的骨牌，
 * 再旋转该格原本覆盖的骨牌，保证"双击 = 旋转"的语义稳定。 */
let _tetroClickPlace = null;

/**
 * 记录一次单击放置（由 06-render 的 click 委托在放置成功后调用）。
 * @param {number} r 锚点行
 * @param {number} c 锚点列
 * @param {string} type 骨牌类型
 * @sideeffect 覆盖 _tetroClickPlace
 */
function noteTetroClickPlace(r, c, type) {
    _tetroClickPlace = {
        key: r + "," + c,
        type: type,
        t: Date.now()
    };
}
window.noteTetroClickPlace = noteTetroClickPlace;

/**
 * 双击（桌面 / 触屏）触发：撤销双击第一下可能造成的误放，再绕锚点顺时针旋转
 * 覆盖该格的骨牌。旋转保持锚点不动，因此不会与其它锚点叠放；越界部分照常裁剪。
 * @param {number} r 行号
 * @param {number} c 列号
 * @returns {boolean} 发生了旋转返回 true
 * @sideeffect 可能撤销一次刚放置的骨牌，并改写 G.rot / G.p /
 *             触发重绘
 */
function rotateTetroOnDouble(r, c) {
    if (!gameTetris) return false;
    if (currentBoardKind() !== "main") return false;
    const key = r + "," + c;
    // 撤销"双击第一下"刚放下的骨牌：仅在 600ms 内、同一锚点且类型一致时才认
    const last = _tetroClickPlace;
    if (last && last.key === key && Date.now() - last.t <= 600 && G.placed[key] === last.type) {
        delete G.placed[key];
        delete G.rot[key];
        _tetroClickPlace = null;
        resetP();
    }
    const target = findTetroAnchorAt(r, c);
    if (!target) {
        render();
        return false;
    }
    // 绕锚点顺时针 90°：锚点坐标不变，只换朝向
    G.rot[target] = (((G.rot[target] || 0) + 1) % 4);
    try {
        AudioFX.confirm();
    } catch (e) {}
    resetP();
    render();
    return true;
}
window.rotateTetroOnDouble = rotateTetroOnDouble;

/**
 * 主棋盘删除入口：按坐标移除地雷并重绘；俄罗斯方块模式下删除整块骨牌。
 * @param {number} r 行号
 * @param {number} c 列号
 * @sideeffect 删除 G.placed 中的键（及对应 G.rot）并触发重绘
 */
function del(r, c) {
    if (gameTetris) {
        removeTetroAt(r, c);
        return;
    }
    startTiOnFirst();
    let k = r + "," + c;
    if (!G.placed[k]) return;
    AudioFX.remove();
    delete G.placed[k];
    resetP();
    render();
}
