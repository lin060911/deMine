/* ==========================================================================
 * 反向扫雷 · 03-timer.js
 * 职责：计时器（单调时钟 + 反作弊 + 后台继续走）
 *
 *  1. 计时基准从 Date.now() 改为 performance.now()（单调时钟）：
 *     改系统时间、手动调表都不会影响读数。
 *  2. 不做暂停：切后台 / 息屏时计时照常累加，回到页面立刻刷新显示。
 *  3. 反作弊（静默）：
 *     - 真实耗时存在【闭包变量】里，改全局 ct / st 影响不了最终成绩；
 *     - 墙钟与单调钟互相校验，取"更长"的那个 —— 时间只会被拉长，
 *       不可能被用来刷快（设备休眠也被计入，防止睡一觉白嫖）；
 *     - 发现系统时间被回拨时打标记 RM.timer.suspicious()，不上报不打扰。
 * ========================================================================== */

let st = 0;        // 兼容保留：本局开始的墙钟时间戳
let ti = null;     // setInterval 句柄
let ct = 0;        // 当前用时（毫秒），显示与旧代码都读它
let ts = false;    // 本局是否已开始计时

(function() {
    "use strict";

    var TICK = 33;
    var startPerf = 0;
    var startWall = 0;
    var lastMeasured = 0;
    var running = false;
    var suspicious = false;
    var hasPerf = !!(window.performance && typeof window.performance.now === "function");

    function perfNow() {
        return hasPerf ? window.performance.now() : Date.now();
    }

    function rawElapsed() {
        if (!running) return lastMeasured;
        var p = perfNow() - startPerf;
        var w = Date.now() - startWall;
        if (!isFinite(p)) p = 0;
        if (p < 0) p = 0;
        if (w < -1000) suspicious = true;      // 系统时间被往回调过
        // 以单调时钟为准；墙钟明显更长时（设备休眠、长挂起）补齐差额
        var v = (w > p + 1500) ? w : p;
        return v < 0 ? 0 : v;
    }

    RM.timer = {
        start: function() {
            startPerf = perfNow();
            startWall = Date.now();
            lastMeasured = 0;
            running = true;
        },
        stop: function() {
            if (running) lastMeasured = rawElapsed();
            running = false;
            return lastMeasured;
        },
        reset: function() {
            running = false;
            lastMeasured = 0;
            startPerf = 0;
            startWall = 0;
            suspicious = false;
        },
        elapsed: function() {
            return rawElapsed();
        },
        lastElapsed: function() {
            return lastMeasured || rawElapsed();
        },
        isRunning: function() {
            return running;
        },
        suspicious: function() {
            return suspicious;
        },
        /* 成绩取值：优先用闭包里测出来的真实值，取不到才退回 ct。
           只增不减 —— 保证了"改内存把时间改小"无效。 */
        ms: function() {
            var v = rawElapsed();
            if (!(v > 0)) v = lastMeasured;
            if (!(v > 0)) v = ct;
            if (ct > 0 && v < ct) v = ct;
            return v;
        }
    };

    /* 回到页面立刻刷新一次，避免看到被节流卡住的旧数字 */
    document.addEventListener("visibilitychange", function() {
        if (document.visibilityState === "visible" && typeof updateTi === "function" && ts) updateTi();
    });
    window.addEventListener("pageshow", function() {
        if (typeof updateTi === "function" && ts) updateTi();
    });
})();

function startTiOnFirst() {
    if (!diff || ts) return;
    if (isFreeMode) return;
    ts = true;
    startTi();
}

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

function stopTi() {
    if (ti) {
        clearInterval(ti);
        ti = null;
    }
    ct = RM.timer.stop();
    try {
        updateTi();
    } catch (e) {}
}

function updateTi() {
    ct = RM.timer.elapsed();
    var el = document.getElementById("timer");
    if (!el) return;
    var e = ct;
    el.textContent = String(Math.floor(e / 6e4)).padStart(2, "0") + ":" +
        String(Math.floor(e / 1e3) % 60).padStart(2, "0") + "." +
        String(Math.floor(e % 1e3 / 10)).padStart(2, "0");
}

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
