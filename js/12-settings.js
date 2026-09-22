/* ==========================================================================
 * 反向扫雷 · 12-settings.js
 * 职责：音量设置持久化 + 对外暴露 _gameNS（成就系统用它挂钩子）
 * ========================================================================== */

(function() {
    "use strict";
    const SOUND_STORE_KEY = "mineSoundSettings";
    const bgmSlider = document.getElementById("bgmSlider");
    const bgmValue = document.getElementById("bgmValue");
    const sfxSlider = document.getElementById("sfxSlider");
    const sfxValue = document.getElementById("sfxValue");
    let saved = {};
    try {
        saved = JSON.parse(Store.get(SOUND_STORE_KEY)) || {};
    } catch (e) {
        saved = {};
    }
    const clamp = v => Math.max(0, Math.min(100, parseInt(v, 10) || 0));
    const bgmInit = typeof saved.bgm === "number" ? clamp(saved.bgm) : 50;
    const sfxInit = typeof saved.sfx === "number" ? clamp(saved.sfx) : 100;
    function saveSound() {
        try {
            Store.set(SOUND_STORE_KEY, JSON.stringify({
                bgm: clamp(bgmSlider.value),
                sfx: clamp(sfxSlider.value)
            }));
        } catch (e) {}
    }
    function paintValue(el, val) {
        if (!el) return;
        el.textContent = val + "%";
        el.classList.toggle("muted", val === 0);
    }
    function applyBgm(val) {
        if (window.RetroBGM && window.RetroBGM.setVolume) window.RetroBGM.setVolume(val / 100);
    }
    function applySfx(val) {
        if (typeof AudioFX === "undefined") return;
        if (val > 0) AudioFX.resume();
        if (AudioFX.setVolume) AudioFX.setVolume(val / 100);
    }
    function initSlider() {
        bgmSlider.value = bgmInit;
        paintValue(bgmValue, bgmInit);
        applyBgm(bgmInit);
        sfxSlider.value = sfxInit;
        paintValue(sfxValue, sfxInit);
        applySfx(sfxInit);
        if (typeof setInfluenceHint === "function") setInfluenceHint(influenceHintOn, true);
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
        if (val > 0 && typeof AudioFX !== "undefined" && AudioFX.pop) AudioFX.pop();
        saveSound();
    });
    if (document.readyState === "complete") {
        initSlider();
    } else {
        window.addEventListener("load", initSlider);
    }
})();

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
