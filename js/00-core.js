/* ==========================================================================
 * 反向扫雷 · 00-core.js
 * 职责：全局命名空间 / 常量 / 核心可变状态 / 全局错误兜底
 *
 * 注意：本文件刻意【不使用 "use strict"】。
 * 原因是项目里存在 `fullReset = function(){}`、`newGame = function(){}` 这类
 * 顶层重新赋值的写法（成就系统的 installHooks 依赖它）。严格模式下对未声明
 * 标识符赋值会抛 ReferenceError，为了与拆分前的行为完全一致，这里保持宽松模式。
 * ========================================================================== */

var RM = window.RM || {};

window.RM = RM;

RM.VERSION = "1.1.0";

RM.SAVE_SCHEMA = 1;

RM.errors = [];

RM.debug = false;

/* ---- 轻量日志：只在 debug 打开时输出到控制台，绝不影响游戏流程 ---- */
RM.warn = function(where, err) {
    RM.errors.push({
        where: where,
        err: err,
        t: Date.now()
    });
    if (RM.errors.length > 50) RM.errors.shift();
    if (RM.debug && window.console) console.warn("[RM:" + where + "]", err);
};

RM.onError = function(where, err) {
    RM.warn(where, err);
    if (RM.debug && window.console) console.error("[RM:" + where + "]", err);
};

/* ---- 全局兜底：任何未捕获异常都不再导致"白屏还不知道发生了什么" ---- */
(function() {
    window.addEventListener("error", function(e) {
        RM.onError("window.onerror", e && e.error ? e.error : e && e.message);
    });
    window.addEventListener("unhandledrejection", function(e) {
        RM.onError("unhandledrejection", e && e.reason);
    });
})();

/* ---- 轻量 toast：给存档导出/导入等操作的反馈 ---- */
(function() {
    var el = null, timer = 0;
    RM.toast = function(msg, ms) {
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


let S = 10, SR = 10, SC = 10, T = 6, TY = 3, SP = 4;

const LIMIT = {
    size: [ 8, 20 ],
    total: [ 2, 24 ],
    type: [ 0, 22 ],
    spec: [ 0, 99 ]
};

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

const DIFF_LABEL = {
    easy: "简单",
    medium: "中等",
    hard: "困难",
    hell: "地狱",
    brain: "脑王",
    free: "自由"
};

const BRAIN_HELL_WINS_REQ = 10;

let diff = null;





let isFreeMode = false;

let seriesLocked = false;

let isPresetPending = false;

let pendingDiff = null;

let selectedMineType = null;

let G = {
    tar: [],
    p: [],
    placed: {},
    pool: {},
    max: 0,
    drag: null,
    lastDragType: null
};

let currentTutorialType = null;

let tutorialStep = 0;

let isTutorialMode = false;
