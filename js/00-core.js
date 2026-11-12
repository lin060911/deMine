/* ==========================================================================
 * 模块 00 · 全局命名空间与核心状态（js/00-core.js）
 *
 * 职责：定义全站唯一的 RM 命名空间，集中声明棋盘尺寸与难度等常量，保存
 *   跨模块共享的可变状态，并提供日志、未捕获异常捕获与轻量提示条。
 * 依赖：无。本文件不引用任何其他模块，是所有游戏脚本的加载前提。
 * 对外：window.RM（命名空间与基础设施）；顶层声明的棋盘变量、难度常量与
 *   运行时状态；window.applyStandardParams、window.applyPresetParams。
 * 设计要点：
 *   1) 加载顺序：index.html 最先加载本文件，后续模块直接读写这里声明的
 *      全局变量，因此本文件保持为顶层脚本，不包装成 IIFE。
 *   2) 刻意不使用 "use strict"：其他模块会通过重新赋值 fullReset、
 *      newGame 等顶层函数来接管行为；严格模式下对未声明标识符赋值会抛
 *      ReferenceError，宽松模式才能让这种扩展方式成立。
 *   3) 基础设施只记录、不抛出：日志与异常捕获把错误挡在游戏流程之外，
 *      出错时玩家仍能看到可理解的界面反馈。
 * ========================================================================== */

var RM = window.RM || {};

/* 单例命名空间：重复加载时复用已有对象，不会覆盖其他模块挂载的成员 */
window.RM = RM;

/* 程序标识串：仅随日志输出，用于问题定位，不参与任何游戏逻辑 */
RM.VERSION = "1.5.3";

/* 程序英文名：页脚署名、存档导出与导入校验统一使用这一写法 */
RM.APP_NAME = "ReverseMinesweeper";

/* 存档结构号：随存档一起落盘，读取端据此判断数据结构是否匹配。
 * 存档以单个紧凑二进制容器承载全部进度（见 01-storage.js）。 */
RM.SAVE_SCHEMA = 2;

/* 存档容器格式号：与数据结构号分开，便于以后单独演进压缩 / 签名容器 */
RM.SAVE_FORMAT = 2;

/* 成就 id 的规范顺序：存档层用比特位图编码"哪些成就已解锁"，位序必须与
 * 13-achievements.js 的数据表完全一致。13 号模块启动时会做一致性校验，
 * 增删成就时必须同时更新这里与数据表（两边顺序一致）。 */
RM.ACH_IDS = [
    "first_win", "red_green_light", "finish_tutorial",
    "easy_10", "medium_10", "hard_10", "hell_first", "hell_7", "brain_first", "brain_10",
    "basic_all_used", "unlock_special", "unlock_physics", "unlock_symmetry", "unlock_tactical",
    "speed_easy", "speed_medium", "speed_hard", "speed_hell", "speed_brain", "speed_all",
    "create_first", "create_mixed", "create_10", "play_shared_5", "create_max_mines",
    "total_20", "total_50", "total_150", "total_500", "total_night",
    "hidden_slide", "hidden_chaos", "hidden_flawless", "hidden_eco", "free_20x20",
    "brain_slow", "bgm_adjust", "new_game_spam", "crazy_thursday", "hidden_grass",
    "hidden_icecream", "hidden_highvalue", "hidden_lowvalue", "hidden_teatime",
    /* 1.4.0 扩展：新成就只能追加在末尾，位序必须与 13-achievements 的数据表一致 */
    "unlock_poker", "hard_first", "hc_first", "hc_10",
    "hc_easy", "hc_medium", "hc_hard", "hc_hell", "hc_brain",
    "hidden_hc_free_20", "all_types_used", "create_all_types",
    "hidden_free_26", "hidden_fullscreen", "hidden_savemanage",
    "hidden_free_5x5", "hidden_del_100",
    /* 1.5.2 扩展：俄罗斯方块玩法成就，只能追加在末尾；
       位序必须与 13-achievements.js 数据表末尾的 8 条完全一致，
       位图字节数由本数组长度推导（70 条 → 9 字节，见 01-storage 的 DATA_VERSION 兼容分支）。 */
    "Tetris_first", "Tetris_10", "Tetris_easy", "Tetris_medium",
    "Tetris_hard", "Tetris_hell", "Tetris_brain", "hidden_Tetris_free_20"
];

/* 环形错误记录：只保留最近 50 条，长时间运行也不会无限增长 */
RM.errors = [];

/* 排障开关：默认关闭；本地排障时置 true 才会向控制台输出 */
RM.debug = false;

/* ---------- 1. 日志与错误记录 ---------- */

/**
 * 记录一条非致命错误：写入环形缓冲，debug 打开时再输出到控制台。
 * 本函数不抛出异常，调用方可把它当作安全的记录出口。
 * @param {string} where 出错位置标记，形如 "storage:guard"
 * @param {*} err 错误对象或描述信息
 * @sideeffect 改写 RM.errors；debug 为真时写 console
 */
RM.warn = function(where, err) {
    RM.errors.push({
        where: where,
        err: err,
        t: Date.now()
    });
    // 超出上限即丢弃最早的一条，保证内存占用恒定
    if (RM.errors.length > 50) RM.errors.shift();
    if (RM.debug && window.console) console.warn("[RM:" + where + "]", err);
};

/**
 * 记录一条致命错误：先入错误缓冲，debug 打开时再以 error 级别输出。
 * @param {string} where 出错位置标记
 * @param {*} err 错误对象或描述信息
 * @sideeffect 改写 RM.errors 与控制台
 */
RM.onError = function(where, err) {
    RM.warn(where, err);
    if (RM.debug && window.console) console.error("[RM:" + where + "]", err);
};

/* ---------- 2. 全局异常捕获 ---------- */

/* 统一接管未捕获异常与未处理的 Promise 拒绝，避免白屏且无迹可查。
 * 监听函数包在 IIFE 里，保证只注册一次，不向全局暴露额外名字。 */
(function() {
    window.addEventListener("error", function(e) {
        RM.onError("window.onerror", e && e.error ? e.error : e && e.message);
    });
    // Promise 链中的拒绝不会触发 error 事件，需要单独监听
    window.addEventListener("unhandledrejection", function(e) {
        RM.onError("unhandledrejection", e && e.reason);
    });
})();

/* ---------- 3. 轻量提示条 ---------- */

/* 页面级单例提示条：首次调用才创建节点，之后复用同一节点切换显隐，
 * 避免每次提示都新建、删除 DOM 造成布局抖动。
 * 节点引用与倒计时句柄放在 IIFE 闭包里，外部只能通过 RM.toast 触发。 */
(function() {
    var el = null, timer = 0;
    /**
     * 显示一条自动消失的提示；重复调用会重置倒计时。
     * @param {string} msg 提示文本
     * @param {number} [ms=2400] 显示时长（毫秒）
     * @sideeffect 读写 DOM 中的 .rm-toast 节点
     */
    RM.toast = function(msg, ms) {
        // 提示条属于附属反馈，DOM 不可用时静默忽略，不能影响主流程
        try {
            if (!el) {
                el = document.createElement("div");
                el.className = "rm-toast";
                document.body.appendChild(el);
            }
            el.textContent = msg;
            el.classList.add("show");
            clearTimeout(timer);
            timer = setTimeout(function() {
                if (el) el.classList.remove("show");
            }, ms || 2400);
        } catch (e) {}
    };
})();


/* ---------- 4. 棋盘参数与预设难度 ---------- */

/* 当前棋盘参数：S 为正方形边长，SR / SC 为行数与列数，T 为总雷数。
 * 预设难度、教学与系列挑战沿用旧配比：TY 为特殊雷种类数、SP 为特殊雷数量；
 * 自由模式改用新模型：K 为地雷种类数（含普通雷，范围 1 ~ min(26, T)），
 * 自由模式不再使用 SP。只允许 applyBoardParams 写入。
 * 初始值取入门档（8×8 / 4 雷 / 3 种），四个原有系列挑战全部完成后由
 * applyStandardParams 切到标准档（10×10 / 6 雷 / 4 种）。 */
let S = 8, SR = 8, SC = 8, T = 4, TY = 2, SP = 3, K = 3;

/* 自由模式参数面板是否展开为"单独设置行 / 列"的矩形棋盘模式。
 * 收起时 SR = SC = S；展开时 S 不再参与棋盘尺寸，只在收起时作为基准值。 */
let freeRectExpanded = false;

/* 各参数的允许区间：size / sr / sc 为边长与行列数，total 为总雷数，
 * kinds 为地雷种类数；type / spec 仅预设难度与教学内部使用。
 * total 的上限还受 SR*SC 约束，kinds 的上限还受 min(26, T) 约束，
 * 由 applyBoardParams 与 08-ui 的 setVal 动态收敛。 */
const LIMIT = {
    size: [ 5, 20 ],
    sr: [ 5, 20 ],
    sc: [ 5, 20 ],
    total: [ 1, 400 ],
    kinds: [ 1, 26 ],
    type: [ 0, 22 ],
    spec: [ 0, 99 ]
};

/* 六套预设难度：size 边长 / total 雷数 / type 特殊雷种类 / spec 特殊雷数量。
 * 预设与教学继续使用旧配比；自由模式入口（free）只借用这里的数值作为
 * 面板初值，地雷种类数按 type + 1 推导（普通雷 + 特殊雷种类）。 */
const PRE = {
    easy: {
        size: 8,
        total: 4,
        type: 2,
        spec: 3
    },
    medium: {
        size: 10,
        total: 8,
        type: 4,
        spec: 6
    },
    hard: {
        size: 12,
        total: 12,
        type: 6,
        spec: 9
    },
    hell: {
        size: 14,
        total: 14,
        type: 8,
        spec: 12
    },
    brain: {
        size: 12,
        total: 16,
        type: 12,
        spec: 14
    },
    free: {
        size: 10,
        total: 6,
        type: 3,
        spec: 4
    }
};

/* 难度 key 到界面显示名的映射 */
const DIFF_LABEL = {
    easy: "简单",
    medium: "中等",
    hard: "困难",
    hell: "地狱",
    brain: "脑王",
    free: "自由"
};

/* 标准参数分两档：四个原有系列挑战全部完成前用入门档，全部完成后切到标准档。
 * 退出创造、教学、系列挑战等特殊模式后统一回到其中一档。
 * type / spec 供预设与教学模式沿用旧配比，kinds 供自由模式新参数模型使用。 */
const STD_PARAM_INTRO = {
    size: 8,
    total: 4,
    type: 2,
    spec: 3,
    kinds: 3
};

const STD_PARAM_FULL = {
    size: 10,
    total: 6,
    type: 3,
    spec: 4,
    kinds: 4
};

/**
 * 判断四个原有非基础系列挑战是否全部完成（对应系列均已解锁）。
 * 扑克牌系列是后续新增的扩展系列，不参与标准参数档位的判定，
 * 避免已经在用标准档的玩家因新增系列而回退到入门档。
 * @returns {boolean} 全部完成返回 true；存储尚未就绪时按未完成处理
 */
function allSeriesChallengesDone() {
    try {
        return !!(seriesUnlocked.special && seriesUnlocked.physics &&
            seriesUnlocked.symmetry && seriesUnlocked.tactical);
    } catch (e) {
        return false;
    }
}

/**
 * 应用一组棋盘参数，并同步页面上的参数显示。
 * 参数对象可带 rows / cols 表示矩形棋盘（自由模式单独设置行列时使用），
 * 缺省时按 size 生成正方形；kinds 缺省时按"普通雷 + 特殊雷种类"推导
 * （预设与教学沿用旧配比时用得上）。所有模式切换都必须经由本函数。
 * @param {{size?:number,rows?:number,cols?:number,total:number,type?:number,spec?:number,kinds?:number}} p 棋盘参数
 * @sideeffect 改写 S/SR/SC/T/TY/SP/K，并按当前 DOM 结构刷新参数显示
 */
function applyBoardParams(p) {
    if (!p) return;
    var rows = p.rows != null ? p.rows : p.size;
    var cols = p.cols != null ? p.cols : p.size;
    S = p.size != null ? p.size : Math.max(rows, cols);
    SR = rows;
    SC = cols;
    T = p.total;
    TY = p.type != null ? p.type : 0;
    SP = p.spec != null ? p.spec : 0;
    // 地雷种类数：自由模式显式给出；预设 / 教学按"普通雷 + 特殊雷种类"推导
    K = p.kinds != null ? p.kinds : TY + 1;
    // 数量约束：总雷数不超过格子数，特殊雷不超过总雷数，
    // 特殊雷种类不超过特殊雷数量，地雷种类数不超过 26 且不超过总雷数
    T = Math.max(1, Math.min(T, SR * SC));
    SP = Math.min(SP, T);
    TY = Math.min(TY, SP);
    K = Math.max(1, Math.min(K, 26, T));
    syncBoardParamDisplays();
}

/**
 * 按当前 DOM 结构刷新参数显示：自由模式面板用 size / sr / sc / total / kinds，
 * 旧版预设面板的 type / spec 若仍存在也一并同步，缺失的节点直接跳过。
 * @sideeffect 写入 #size / #sr / #sc / #total / #kinds / #type / #spec 的文本
 */
function syncBoardParamDisplays() {
    var texts = { size: S, sr: SR, sc: SC, total: T, kinds: K, type: TY, spec: SP };
    for (var k in texts) {
        if (!Object.prototype.hasOwnProperty.call(texts, k)) continue;
        var el = document.getElementById(k);
        if (el) el.textContent = texts[k];
    }
}
window.syncBoardParamDisplays = syncBoardParamDisplays;

/**
 * 切回当前进度的标准参数：四个原有系列未全部完成用入门档，全部完成用标准档。
 * @sideeffect 同 applyBoardParams
 */
function applyStandardParams() {
    applyBoardParams(allSeriesChallengesDone() ? STD_PARAM_FULL : STD_PARAM_INTRO);
}
// 挂到 window 上，供内联事件与其他脚本按全局函数调用
window.applyStandardParams = applyStandardParams;

/**
 * 按难度预设应用棋盘参数。
 * @param {string} d 难度 key：easy / medium / hard / hell / brain / free
 * @returns {boolean} 预设存在并已应用返回 true；未知 key 返回 false 且不改状态
 */
function applyPresetParams(d) {
    var p = PRE[d];
    if (!p) return false;
    applyBoardParams(p);
    return true;
}
window.applyPresetParams = applyPresetParams;

/* ---------- 5. 解锁阈值与运行时状态 ---------- */

/* 地狱难度通关达到该次数后解锁脑王（与系列开关数量共同构成解锁条件） */
const BRAIN_HELL_WINS_REQ = 10;

/* 系列总数：仅用于展示 x/6 与门槛比较的上界。
 * 新增系列时同步这里、04-mines 的 CATEGORY 与 01-storage 的系列位表。 */
const SERIES_TOTAL = 6;

/* 地狱与脑王共用的系列开关门槛：两者都要求至少开启 5 个系列 */
const HELL_SERIES_REQ = 5;

/* 当前对局难度 key；null 表示尚未选择或正在自由调整参数 */
let diff = null;





/* 是否为自由创造模式：该模式不限时，也不计入成绩与胜场 */
let isFreeMode = false;

/* 自由难度是否来自"刷新后的首局"：页面载入时自动生成的那局使用当前进度的
 * 标准参数、没有对应的预设难度，按自由难度归类（不计时 / 不记账）。
 * 自由模式本身会让难度按钮跳过锁定外观，因此用该标记区分：
 * 刷新局仍按真实门槛显示锁定态，玩家主动选择自由模式后才取消锁定外观。
 * 由 10-game 的 window.onload 置位，08-ui 的 setPre 在选择难度时清除。 */
let isRefreshFreeGame = false;

/* 是否开启「硬核模式」：跨局偏好，存在存档 mineHardcoreMode。
 * 开启后主棋盘只按题面数字上色（数字格灰白 / 0 格蓝），不再随局面变化；
 * 地块提示两项开关被锁定；预设难度与自由模式的成绩记入独立的硬核成绩。
 * 教学棋盘与创造棋盘使用各自的渲染路径，不受该标记影响。 */
let isHardcoreMode = false;

/* 本局的硬核快照：开局时由 applyGameHardcore() 按模式计算，整局保持不变。
 * 与 isHardcoreMode（偏好）分开，避免对局中途切换开关改变配色或刷硬核成绩。
 * 只有预设难度与自由模式会继承偏好；教学 / 挑战 / 练习 / 创造 / 题库码恒为 false。 */
let gameHardcore = false;

/* 是否开启「俄罗斯方块模式」：跨局偏好，存在存档 mineTetrisMode。
 * 开启后地雷槽换成 7 种四格骨牌，棋盘按骨牌影响结算；仅预设难度与
 * 自由模式生效，且与硬核模式互斥（开启一个时另一个自动关闭）。 */
let isTetrisMode = false;

/* 本局的俄罗斯方块快照：开局时由 applyGameTetris() 按模式计算，整局保持不变。
 * 只有预设难度与自由模式会继承偏好；教学 / 挑战 / 练习 / 创造 / 题库码恒为 false。
 * 为 true 时 gameHardcore 必为 false（两种玩法互斥）。 */
let gameTetris = false;

/* 骨牌旋转态：本局地雷槽里每种骨牌当前朝向（0~3，顺时针），由槽位旋转按钮
 * 递增；放置时写入 G.rot 供影响结算使用。每局由 genTetrisGame 重置为空对象。 */
let tetroRot = {};

/* 本局是否已完成通关结算：checkWin 只允许结算一次，防止胜利后
 * 窗口缩放等重绘路径重复写入成绩 / 通关次数。由 fullReset 重置。 */
let winSettled = false;

/* 预设难度已选中、玩家尚未点开始：等待开始确认卡片 */
let isPresetPending = false;

/* 与 isPresetPending 配套：待开始的预设难度 key */
let pendingDiff = null;

/* 当前选中的地雷类型，是放置与拖拽操作的作用对象；null 表示未选择 */
let selectedMineType = null;

/* 对局棋盘的核心数据：tar 目标值矩阵、p 由已放置地雷算出的影响值矩阵、
 * placed 格子到地雷类型的映射、pool 各类型剩余数量、max 目标雷数、
 * drag 拖拽起点格子、lastDragType 最近一次拖拽的类型。
 * rot 仅在俄罗斯方块模式下使用：键为骨牌锚点 "行,列"，值为朝向 0~3；
 * 经典模式保持为空对象，不影响任何既有结算。 */
let G = {
    tar: [],
    p: [],
    placed: {},
    pool: {},
    max: 0,
    drag: null,
    lastDragType: null,
    rot: {}
};

/* 当前教学分类 key；null 表示基础教学 */
let currentTutorialType = null;

/* 教学进度：已通关的关数，同时作为存档中的进度值 */
let tutorialStep = 0;

/* 是否处于教学演示中：教学局不计成绩、不触发成就 */
let isTutorialMode = false;

/* 是否处于「练习」模式：从已完成的挑战进入，顶部进度条改为
 * 「XX练习」+ 退出按钮；练习局不写挑战进度、不触发解锁，
 * 退出后回到标准参数的新局。由 setupTutorialBoard 按进入入口显式赋值。 */
let isPracticeMode = false;
