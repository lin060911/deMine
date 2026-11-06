/* ==========================================================================
 * 模块 03 · 计时与反作弊（js/03-timer.js）
 *
 * 职责：为对局提供计时读数与界面显示刷新，并保证成绩时间不会被系统时间
 *   调整或内存篡改"刷快"。
 * 依赖：00-core 声明的全局难度状态（diff、isFreeMode）与页面上的 #timer
 *   元素；其他模块通过 RM.timer 和本文件的全局函数驱动计时。
 * 对外：RM.timer（start / stop / reset / elapsed / lastElapsed / isRunning /
 *   suspicious / ms）；startTiOnFirst、startTi、stopTi、updateTi、resetTi。
 * 设计要点：
 *   1) 单调时钟优先：基准取 performance.now()，改系统时间、手动调表都不会
 *      影响读数。
 *   2) 不设暂停：切到后台或息屏时计时照常累加，回到页面立即刷新显示。
 *   3) 反作弊静默生效：真实耗时保存在闭包变量里，外部改 ct / st 影响不了
 *      成绩；墙钟与单调钟互相校验后取更长者，时间只会变长，无法被刷快。
 * ========================================================================== */

/* ---------- 1. 对外计时状态 ---------- */

let st = 0;        // 本局开始的墙钟时间戳，仅用于反作弊对照
let ti = null;     // 计时显示刷新定时器的句柄
let ct = 0;        // 最近一次刷新得到的用时（毫秒），显示与成绩都读它
let ts = false;    // 本局是否已开始计时

/* 计时核心：性能时钟读数、墙钟校验与状态标记都留在闭包里，
 * 外部只能通过 RM.timer 的接口读取，无法直接改写测量结果。 */
(function() {
    "use strict";

    /* 显示刷新间隔（毫秒），约 30fps，既跟手又控制开销 */
    var TICK = 33;
    /* 两个计时基准点：单调时钟用于计算，墙钟用于交叉校验 */
    var startPerf = 0;
    var startWall = 0;
    /* 停止计时时冻结的耗时：停表后重复读取必须返回同一个值 */
    var lastMeasured = 0;
    var running = false;
    var suspicious = false;
    /* 环境能力探测：缺少 performance.now 时退化为系统时间 */
    var hasPerf = !!(window.performance && typeof window.performance.now === "function");

    /* ---------- 2. 计时核心 ---------- */

    /**
     * 读取单调时钟的当前值；环境不支持 performance.now 时退化为系统时间。
     * @returns {number} 毫秒读数
     */
    function perfNow() {
        return hasPerf ? window.performance.now() : Date.now();
    }

    /**
     * 计算当前的真实耗时（毫秒），是成绩的唯一定量来源。
     * 以单调时钟为准；墙钟明显更长时取墙钟，用于覆盖设备休眠等
     * 单调时钟不累加的时段。时间只会变长，不会被用来刷快。
     * @returns {number} 非负毫秒数
     * @sideeffect 发现系统时间被回拨时置 suspicious 标记
     */
    function rawElapsed() {
        if (!running) return lastMeasured;
        var p = perfNow() - startPerf;
        var w = Date.now() - startWall;
        if (!isFinite(p)) p = 0;
        if (p < 0) p = 0;
        // 墙钟比单调钟倒退超过 1 秒：说明系统时间被回拨过
        if (w < -1000) suspicious = true;
        // 以单调时钟为准；墙钟明显更长时（设备休眠、长挂起）补齐差额
        var v = (w > p + 1500) ? w : p;
        return v < 0 ? 0 : v;
    }

    /* ---------- 3. RM.timer 对外接口 ---------- */

    /* 计时门面：所有方法都不抛出，任何游戏阶段调用都安全。 */
    RM.timer = {
        /* 开始计时：记录两个基准点，并清空上一次的冻结值 */
        start: function() {
            startPerf = perfNow();
            startWall = Date.now();
            lastMeasured = 0;
            running = true;
        },
        /* 停止计时：冻结本次耗时并返回；重复调用返回同一个值 */
        stop: function() {
            if (running) lastMeasured = rawElapsed();
            running = false;
            return lastMeasured;
        },
        /* 复位：清除基准、冻结值与可疑标记，等待下一次 start */
        reset: function() {
            running = false;
            lastMeasured = 0;
            startPerf = 0;
            startWall = 0;
            suspicious = false;
        },
        /* 当前耗时：计时中实时计算，已停止时返回冻结值 */
        elapsed: function() {
            return rawElapsed();
        },
        /* 最近一次有效耗时：没有冻结值时退回实时计算 */
        lastElapsed: function() {
            return lastMeasured || rawElapsed();
        },
        /* 是否正在计时 */
        isRunning: function() {
            return running;
        },
        /* 是否检测到系统时间被回拨 */
        suspicious: function() {
            return suspicious;
        },
        /**
         * 成绩取值：优先使用闭包里测出的真实耗时，取不到才退回 ct。
         * 结果只增不减，保证改内存把时间改小无效。
         * @returns {number} 毫秒
         */
        ms: function() {
            var v = rawElapsed();
            if (!(v > 0)) v = lastMeasured;
            if (!(v > 0)) v = ct;
            if (ct > 0 && v < ct) v = ct;
            return v;
        }
    };

    /* ---------- 4. 前后台切换后的刷新 ---------- */

    /* 页面在后台时定时器会被浏览器节流；回到前台立即补刷一次，
     * 避免玩家看到停留在节流时刻的读数。 */
    document.addEventListener("visibilitychange", function() {
        if (document.visibilityState === "visible" && typeof updateTi === "function" && ts) updateTi();
    });
    /* 从往返缓存（bfcache）返回时不会触发 visibilitychange，需要单独补刷 */
    window.addEventListener("pageshow", function() {
        if (typeof updateTi === "function" && ts) updateTi();
    });
})();

/* ---------- 5. 对局计时控制 ---------- */

/**
 * 首次操作时启动计时：仅在已选难度、尚未开始且非自由模式时生效。
 * @sideeffect 置 ts 并调用 startTi 启动周期刷新
 */
function startTiOnFirst() {
    if (!diff || ts) return;
    if (isFreeMode) return;
    ts = true;
    startTi();
}

/**
 * 开始（或重新开始）本局计时：先结束上一个周期，再记录起点并刷新显示。
 * @sideeffect 改写 st / ts / ti，启动 33ms 周期刷新并显示 #timer
 */
function startTi() {
    stopTi();
    ts = true;
    st = Date.now();
    RM.timer.start();
    var el = document.getElementById("timer");
    if (el) el.style.display = "block";
    ti = setInterval(updateTi, 33);
    updateTi();
}

/**
 * 停止本局计时并冻结耗时，同时刷新一次显示。
 * @sideeffect 清除周期定时器并改写 ct
 */
function stopTi() {
    if (ti) {
        clearInterval(ti);
        ti = null;
    }
    ct = RM.timer.stop();
    // 停表时页面可能正在卸载，刷新失败不应打断收尾流程
    try {
        updateTi();
    } catch (e) {}
}

/* ---------- 6. 显示刷新与复位 ---------- */

/* 计时显示缓存（v1.3.2 性能优化）：
 * 33ms 刷新一次，但百分秒约 10ms 才跳一档，实际约 2/3 的刷新写的是同一个
 * 字符串。这里缓存上一次的文本，未变化时直接跳过 DOM 写入；元素引用也缓存
 * 一次，避免每帧都做一次 getElementById。 */
var _tiEl = null;
var _tiText = "";

/**
 * 把当前耗时格式化为 mm:ss.cc 写入 #timer。
 * @sideeffect 改写 ct 与 #timer 的文本（文本未变化时不写 DOM）
 */
function updateTi() {
    ct = RM.timer.elapsed();
    var el = _tiEl || (_tiEl = document.getElementById("timer"));
    if (!el) return;
    var e = ct;
    // 三段定宽显示，避免秒数进位时整行宽度跳动
    var text = String(Math.floor(e / 6e4)).padStart(2, "0") + ":" +
        String(Math.floor(e / 1e3) % 60).padStart(2, "0") + "." +
        String(Math.floor(e % 1e3 / 10)).padStart(2, "0");
    // 文本与上一帧相同：省掉一次 textContent 写入与随之而来的样式重算
    if (text === _tiText) return;
    _tiText = text;
    el.textContent = text;
}

/**
 * 复位计时：停止计时、清零读数并隐藏计时条。
 * @sideeffect 改写 ts / ct 与 #timer 的文本和显隐
 */
function resetTi() {
    stopTi();
    RM.timer.reset();
    ts = false;
    ct = 0;
    var el = document.getElementById("timer");
    if (el) {
        el.textContent = "00:00.00";
        el.style.display = "none";
    }
}
