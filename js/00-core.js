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
RM.VERSION = "1.2.21";

/* 存档结构号：随存档一起落盘，读取端据此判断数据结构是否匹配 */
RM.SAVE_SCHEMA = 1;

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

/* 当前棋盘参数：S 为边长，SR / SC 为行数与列数，T 为总雷数，
 * TY 为地雷类型数，SP 为特殊道具数。只允许 applyBoardParams 写入。
 * 初始值取入门档（8×8 / 4 雷），四个系列挑战全部完成后由
 * applyStandardParams 切到标准档（10×10 / 6 雷）。 */
let S = 8, SR = 8, SC = 8, T = 4, TY = 3, SP = 2;

/* 创造模式各参数的允许区间：[最小值, 最大值] */
const LIMIT = {
    size: [ 8, 20 ],
    total: [ 2, 24 ],
    type: [ 0, 22 ],
    spec: [ 0, 99 ]
};

/* 六套预设难度：size 边长 / total 雷数 / type 类型数 / spec 特殊数 */
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
        spec: 3
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

/* 标准参数分两档：四个系列挑战全部完成前用入门档，全部完成后恢复标准档。
 * 退出创造、教学、系列挑战等特殊模式后统一回到其中一档。 */
const STD_PARAM_INTRO = {
    size: 8,
    total: 4,
    type: 3,
    spec: 2
};

const STD_PARAM_FULL = {
    size: 10,
    total: 6,
    type: 3,
    spec: 4
};

/**
 * 判断四个非基础系列挑战是否全部完成（对应系列均已解锁）。
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
 * 应用一组棋盘参数，并同步页面上的数字显示。
 * 所有模式切换都必须经由本函数，避免上一局的尺寸残留到下一局。
 * @param {{size:number,total:number,type:number,spec:number}} p 棋盘参数
 * @sideeffect 改写 S/SR/SC/T/TY/SP，并更新 #size/#total/#type/#spec 文本
 */
function applyBoardParams(p) {
    S = p.size;
    SR = p.size;
    SC = p.size;
    T = p.total;
    TY = p.type;
    SP = p.spec;
    // 数量约束：特殊道具数不得超过总雷数，地雷类型数不得超过特殊道具数
    SP = Math.min(SP, T);
    TY = Math.min(TY, SP);
    // 界面数字以状态为准：参数一变立刻回写，避免显示与棋盘不一致
    var ids = { size: S, total: T, type: TY, spec: SP };
    for (var k in ids) {
        if (!Object.prototype.hasOwnProperty.call(ids, k)) continue;
        var el = document.getElementById(k);
        if (el) el.textContent = ids[k];
    }
}

/**
 * 切回当前进度的标准参数：四系列未全部完成用入门档，全部完成用标准档。
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

/* 地狱难度通关达到该次数后解锁脑王（与系列全开共同构成解锁条件） */
const BRAIN_HELL_WINS_REQ = 10;

/* 当前对局难度 key；null 表示尚未选择或正在自由调整参数 */
let diff = null;





/* 是否为自由创造模式：该模式不限时，也不计入成绩与胜场 */
let isFreeMode = false;

/* 预设难度已选中、玩家尚未点开始：等待开始确认卡片 */
let isPresetPending = false;

/* 与 isPresetPending 配套：待开始的预设难度 key */
let pendingDiff = null;

/* 当前选中的地雷类型，是放置与拖拽操作的作用对象；null 表示未选择 */
let selectedMineType = null;

/* 对局棋盘的核心数据：tar 目标值矩阵、p 由已放置地雷算出的影响值矩阵、
 * placed 格子到地雷类型的映射、pool 各类型剩余数量、max 目标雷数、
 * drag 拖拽起点格子、lastDragType 最近一次拖拽的类型 */
let G = {
    tar: [],
    p: [],
    placed: {},
    pool: {},
    max: 0,
    drag: null,
    lastDragType: null
};

/* 当前教学分类 key；null 表示基础教学 */
let currentTutorialType = null;

/* 教学进度：已通关的关数，同时作为存档中的进度值 */
let tutorialStep = 0;

/* 是否处于教学演示中：教学局不计成绩、不触发成就 */
let isTutorialMode = false;
