/* ==========================================================================
 * 模块 12 · 音量设置持久化与业务命名空间（js/12-settings.js）
 *
 * 职责：读取并保存背景音乐 / 音效音量，把滑块变化实时作用到音频模块，
 *       并登记 window._gameNS 供成就系统等扩展模块取用业务函数。
 * 依赖：Store（01-storage）、AudioFX 与 RetroBGM（02-audio）、
 *       setInfluenceHint / influenceHintOn 与 setEffectPreview / effectPreviewOn
 *       （06-render）。
 * 对外：window._gameNS，集中引用 newGame / fullReset / clearAll / del /
 *       drop / onTutorialWin / unlockSeries / generatePuzzleCode /
 *       applyPuzzleCode；本模块只读取这些函数，不包装它们。
 * 设计要点：
 *   1) 音量属于纯偏好设置，统一落在 localStorage 的 mineSoundSettings 键，
 *      不参与对局与成就状态，刷新页面或换局都不受影响。
 *   2) 读取时对存档做类型与范围校验，存档损坏时回落到默认音量而不是报错。
 *   3) _gameNS 保存的是登记时刻的函数引用，后加载的 13-achievements 可据此
 *      取得"包装前"的原始实现，避免扩展模块与业务模块互相反向依赖。
 * ========================================================================== */

(function() {
    "use strict";

    /* ---------- 1. 设置状态的读取与写入 ---------- */

    // 存储键：背景音乐与音效两个音量共用同一条 JSON 记录
    const SOUND_STORE_KEY = "mineSoundSettings";

    const bgmSlider = document.getElementById("bgmSlider");
    const bgmValue = document.getElementById("bgmValue");
    const sfxSlider = document.getElementById("sfxSlider");
    const sfxValue = document.getElementById("sfxValue");
    // 解析失败或内容损坏时按空对象处理，宁可回到默认音量也不中断设置初始化
    let saved = {};
    try {
        saved = JSON.parse(Store.get(SOUND_STORE_KEY)) || {};
    } catch (e) {
        saved = {};
    }
    // 把任意输入压回 0~100 的整数，防止被手工改过的存档把音量带到越界区间
    const clamp = v => Math.max(0, Math.min(100, parseInt(v, 10) || 0));
    // 默认值取一组"能听见但不吵"的参数：BGM 50%、音效 50%；合法存档则沿用其值
    const bgmInit = typeof saved.bgm === "number" ? clamp(saved.bgm) : 50;
    const sfxInit = typeof saved.sfx === "number" ? clamp(saved.sfx) : 50;
    /**
     * 把两个滑块的当前值序列化后写回 localStorage。
     * 每次拖动都会调用，因此只写音量字段，不触碰其他设置。
     * @sideeffect 写 Store 的 mineSoundSettings 键；存储不可用时静默失败。
     */
    function saveSound() {
        try {
            Store.set(SOUND_STORE_KEY, JSON.stringify({
                bgm: clamp(bgmSlider.value),
                sfx: clamp(sfxSlider.value)
            }));
        } catch (e) {}
    }
    /**
     * 把音量数值同步到滑块旁的百分比文本，并给 0% 加静音样式。
     * @param {HTMLElement} el 显示百分比的元素
     * @param {number} val 0~100 的音量值
     * @sideeffect 更新 el 的文本与 muted 类名。
     */
    function paintValue(el, val) {
        if (!el) return;
        el.textContent = val + "%";
        el.classList.toggle("muted", val === 0);
    }
    /**
     * 把 0~100 的音量换算成 0~1 后交给背景音乐模块。
     * @param {number} val 0~100 的音量值
     * @sideeffect 调用 RetroBGM.setVolume；模块不存在时跳过。
     */
    function applyBgm(val) {
        if (window.RetroBGM && window.RetroBGM.setVolume) window.RetroBGM.setVolume(val / 100);
    }
    /**
     * 把 0~100 的音量换算成 0~1 后交给音效模块。
     * @param {number} val 0~100 的音量值
     * @sideeffect 调用 AudioFX.resume / setVolume；音频模块缺失时跳过。
     */
    function applySfx(val) {
        if (typeof AudioFX === "undefined") return;
        // AudioContext 必须由用户手势唤醒：拖动音效滑块正是一次手势，顺势唤醒
        if (val > 0) AudioFX.resume();
        if (AudioFX.setVolume) AudioFX.setVolume(val / 100);
    }

    /* ---------- 2. 初始化与滑块交互 ---------- */

    /**
     * 用读到的初始值填充两个滑块并立刻作用到音频模块。
     * 页面加载时调用一次，保证界面显示与实际音量一致。
     * @sideeffect 改写滑块 value、百分比文本与音频模块音量。
     */
    function initSlider() {
        bgmSlider.value = bgmInit;
        paintValue(bgmValue, bgmInit);
        applyBgm(bgmInit);
        sfxSlider.value = sfxInit;
        paintValue(sfxValue, sfxInit);
        applySfx(sfxInit);
        // 静默同步一次影响提示的开关状态，避免开局时额外弹提示
        if (typeof setInfluenceHint === "function") setInfluenceHint(influenceHintOn, true);
        if (typeof setEffectPreview === "function") setEffectPreview(effectPreviewOn, true);
    }
    bgmSlider.addEventListener("input", function() {
        const val = clamp(this.value);
        paintValue(bgmValue, val);
        applyBgm(val);
        saveSound();
    });
    sfxSlider.addEventListener("input", function() {
        const val = clamp(this.value);
        paintValue(sfxValue, val);
        applySfx(val);
        // 拖动过程中试听一声，让玩家直接听到当前音效音量
        if (val > 0 && typeof AudioFX !== "undefined" && AudioFX.pop) AudioFX.pop();
        saveSound();
    });
    // 设置面板可能在脚本执行前就已加载完成，此时立即初始化，否则等 load
    if (document.readyState === "complete") {
        initSlider();
    } else {
        window.addEventListener("load", initSlider);
    }
})();

/* ---------- 3. 对外命名空间 ---------- */

// 业务函数清单：扩展模块优先读同名全局，读不到时回落到这里，减少耦合
window._gameNS = {
    newGame: newGame,
    fullReset: fullReset,
    clearAll: clearAll,
    del: del,
    drop: drop,
    onTutorialWin: onTutorialWin,
    unlockSeries: unlockSeries,
    generatePuzzleCode: generatePuzzleCode,
    applyPuzzleCode: applyPuzzleCode
};

/* ---------- 4. 关于板块的版本号 ---------- */
/* 「⚙️设置 → ℹ️关于」里的版本号统一从 RM.VERSION 读取，
 * 避免页脚与「关于」两处显示不一致。 */
(function syncAboutVersion() {
    try {
        var el = document.getElementById("aboutVersion");
        if (el && window.RM && RM.VERSION) el.textContent = "v" + RM.VERSION;
    } catch (e) {}
})();
