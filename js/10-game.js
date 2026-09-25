/* ==========================================================================
 * 反向扫雷 · 10-game.js
 * 职责：新游戏 / 全局重置 / 预设开局 / 清空放置 / 页面级事件接线
 * ========================================================================== */

let _origDrop = null;

let _origDel = null;

function newGame() {
    AudioFX.confirm();
    fullReset();
    if (isPresetDifficulty(diff) && !isFreeMode && !isTutorialMode) {
        // 预设难度：每一局都严格按预设参数，特殊模式退出来也不会带错尺寸
        applyPresetParams(diff);
        enterPresetPending(diff);
        return;
    }
    genGame();
    render();
    renderRecordList();
    document.getElementById("win").style.display = "none";
}

function fullReset() {
    resetTi();
    isTutorialMode = false;
    isPresetPending = false;
    pendingDiff = null;
    currentTutorialType = null;
    document.getElementById("tutorialProgressBar").style.display = "none";
    document.getElementById("teachProgressBar").style.display = "none";
    teachActive = false;
    teachPlacedCount = 0;
    teachExpectedCount = 0;
    teachPlaceList = [];
    teachPlacedTypes = {};
    teachExpectedTypes = {};
    teachRulePending = false;
    document.getElementById("brainWinModal").style.display = "none";
    document.getElementById("presetStartCard").style.display = "none";
    document.getElementById("board").style.display = "";
    document.getElementById("slot").style.display = "";
    document.getElementById("win").style.display = "none";
    stopFallingEmoji();
    document.body.classList.remove("brain-golden");
    document.querySelectorAll(".auto-modal").forEach(m => {
        m.style.display = "none";
    });
    document.getElementById("timer").style.display = isFreeMode ? "none" : "none";
    teachActive = false;
    document.getElementById("teachBubble").classList.remove("visible", "mines-only");
    clearTeachSlotHost();
    document.getElementById("teachCompleteModal").classList.remove("visible");
    document.querySelectorAll(".cell-teach-target").forEach(el => el.classList.remove("cell-teach-target"));
    document.querySelectorAll(".cell-teach-correct").forEach(el => el.classList.remove("cell-teach-correct"));
    document.querySelectorAll(".cell-teach-wrong").forEach(el => el.classList.remove("cell-teach-wrong"));
    let nextBtn = document.getElementById("teachNextBtn");
    if (nextBtn) {
        nextBtn.textContent = "下一关 ➡️";
        nextBtn.onclick = teachNextLevel;
    }
    // 兜底：任何模式切换都会经过这里，保证主按钮条状态正确
    try {
        syncMainPanel();
    } catch (e) {}
}

function beginPresetGame() {
    AudioFX.confirm();
    // 每一局都严格按当前难度预设重置参数，杜绝跨模式污染
    if (isPresetDifficulty(diff)) applyPresetParams(diff);
    document.getElementById("presetStartCard").style.display = "none";
    document.getElementById("board").style.display = "";
    document.getElementById("slot").style.display = "";
    isPresetPending = false;
    isTutorialMode = false;
    document.getElementById("tutorialProgressBar").style.display = "none";
    genGame();
    render();
    renderRecordList();
    document.getElementById("win").style.display = "none";
    if (!isFreeMode) {
        ts = true;
        startTi();
    }
}

function clearAll() {
    AudioFX.confirm();
    G.placed = {};
    resetP();
    render();
}

document.getElementById("reset").onclick = newGame;

document.getElementById("clear").onclick = clearAll;

window.onload = () => {
    renderRecordList();
    renderMineInfo();
    renderSeriesSwitches();
    if (checkBrainUnlocked() && !brainUnlockedNotified) {
        brainUnlockedNotified = true;
        Store.set("brainUnlockedNotified", "true");
    }
    updatePresetButtons();
    newGame();
    applyBrainEgg();
};

document.addEventListener("dragstart", function(e) {
    try {
        e.dataTransfer.setDragImage(new Image, 0, 0);
    } catch (_) {}
}, false);

window.addEventListener("load", function() {
    let today = (new Date).toDateString();
    let lastShown = Store.get("welcomeLastShown");
    let isFirstTime = !Store.get("hasVisitedBefore");
    if (isFirstTime) {
        setTimeout(() => {
            document.getElementById("overlay").style.display = "block";
            document.getElementById("tutorialPrompt").style.display = "block";
            AudioFX.modalOpen();
            let btn = document.getElementById("tutorialConfirmBtn");
            btn.disabled = true;
            let cd = 3;
            let cdEl = document.getElementById("tutorialCountdown");
            let iv = setInterval(() => {
                cd--;
                if (cd > 0) cdEl.textContent = "按钮将在" + cd + "秒后可用..."; else {
                    cdEl.textContent = "";
                    btn.disabled = false;
                    clearInterval(iv);
                }
            }, 1e3);
        }, 800);
        Store.set("hasVisitedBefore", "true");
        if (!Store.get("tutorialStep")) Store.set("tutorialStep", "0");
    } else if (lastShown !== today) {
        setTimeout(() => {
            document.getElementById("overlay").style.display = "block";
            document.getElementById("welcomeModal").style.display = "block";
            AudioFX.modalOpen();
        }, 500);
        Store.set("welcomeLastShown", today);
    }
});
