/* ==========================================================================
 * 模块 10 · 对局流程与页面事件接线（js/10-game.js）
 *
 * 职责：统一管理一局游戏的开始、重置与模式切换，并把页面级入口
 *       （新游戏、清空放置、首次访问引导、每日欢迎弹窗）接到具体函数。
 * 依赖：全局状态 diff / G / SR / SC / S（00-core）、ts 与 resetTi / startTi
 *       （03-timer）、genGame 与 resetP（05-generator）、render（06-render）、
 *       renderRecordList 与预设难度相关函数（08-ui）、AudioFX（02-audio）、
 *       Store（01-storage）。
 * 对外：newGame / fullReset / beginPresetGame / clearAll 等全局函数；
 *       11-create 与 13-achievements 会在这些函数之上再包一层钩子。
 * 设计要点：
 *   1) 所有模式切换都收敛到 fullReset：教学、预设待开局、创造模式等状态
 *      在一个地方清空，任何入口重置后都能得到同样的干净上下文。
 *   2) 新游戏按"预设难度"与"自由 / 特殊模式"分流：预设难度先进入待开局
 *      卡片，由玩家确认后再生成棋盘，使棋盘尺寸只由难度决定。
 *   3) 事件接线集中在本文件末尾，HTML 只描述结构，行为一律由 JS 绑定，
 *      便于 13-achievements 通过替换 DOM 处理器插入统计逻辑。
 * ========================================================================== */

/* ---------- 1. 扩展点占位与新游戏主流程 ---------- */

// 扩展点占位：需要替换全局函数的模块可把原实现挂在这里；未安装钩子时为 null
let _origDrop = null;

let _origDel = null;

// 启动时按当前进度设置默认棋盘参数：四系列未全完成用入门档，全部完成用标准档
applyStandardParams();

/**
 * 开始新一局：先清理上一局状态，再按当前模式生成棋盘或进入待开局。
 * 预设难度不会立即生成棋盘，而是先套用预设参数并展示待开局卡片，
 * 由 beginPresetGame 在玩家确认后接手。
 * @sideeffect 重置对局状态并重绘棋盘与记录表；难度条件不满足时只弹出说明框
 */
function newGame() {
    if (!ensurePresetAllowed()) return;
    AudioFX.confirm();
    fullReset();
    if (isPresetDifficulty(diff) && !isFreeMode && !isTutorialMode) {
        // 先套用预设参数并进入待开局，尺寸只由难度决定，不受上一局影响
        applyPresetParams(diff);
        enterPresetPending(diff);
        return;
    }
    genGame();
    render();
    renderRecordList();
    document.getElementById("win").style.display = "none";
}

/* ---------- 2. 全局重置：所有模式切换的唯一收口 ---------- */

/**
 * 把整局相关的可变状态重置到初始态：计时、教学模式进度、待开局标记、
 * 各类弹窗、对局期 DOM 类名与教学面板等都在这里统一清理。
 * 调用方随后可决定立即开新局，或停留在待开局 / 选关界面。
 * @sideeffect 重置计时器与大量全局标记，并隐藏全部对局期弹窗。
 */
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
    document.getElementById("brainWinModal").style.display = "none";
    document.getElementById("presetStartCard").style.display = "none";
    // 重新显示主棋盘与道具栏，并收掉上一局的胜利层、飘落特效与脑王主题
    document.getElementById("board").style.display = "";
    document.getElementById("slot").style.display = "";
    document.getElementById("win").style.display = "none";
    stopFallingEmoji();
    document.body.classList.remove("brain-golden");
    // 所有自动弹出的提示层（解锁、提示等）统一收起，避免叠加在下一局之上
    document.querySelectorAll(".auto-modal").forEach(m => {
        m.style.display = "none";
    });
    // 计时器先隐藏，真正开始计时时由 startTi 显示，避免未开局就出现读数
    document.getElementById("timer").style.display = isFreeMode ? "none" : "none";
    // 教学关的提示气泡、格子标注与完成弹窗都要清掉，否则会串到下一局
    teachActive = false;
    document.getElementById("teachBubble").classList.remove("visible", "mines-only");
    clearTeachSlotHost();
    document.getElementById("teachCompleteModal").classList.remove("visible");
    document.querySelectorAll(".cell-teach-target").forEach(el => el.classList.remove("cell-teach-target"));
    document.querySelectorAll(".cell-teach-correct").forEach(el => el.classList.remove("cell-teach-correct"));
    document.querySelectorAll(".cell-teach-wrong").forEach(el => el.classList.remove("cell-teach-wrong"));
    // 教学按钮的文案与点击行为由各关设置，这里重置为默认的"下一关"行为
    let nextBtn = document.getElementById("teachNextBtn");
    if (nextBtn) {
        nextBtn.textContent = "下一关 ➡️";
        nextBtn.onclick = teachNextLevel;
    }
    // 主按钮条的最后一次同步：任何模式切换都会经过这里，确保按钮可用性
    // 与当前模式一致；面板 DOM 尚未就绪时不应阻断重置流程，故单独包裹
    try {
        syncMainPanel();
    } catch (e) {}
}

/* ---------- 3. 预设开局与清空放置 ---------- */

/**
 * 从待开局卡片真正开始一局预设难度：重新套用难度参数，显示棋盘与
 * 道具栏，生成题目后启动计时（自由模式不启动计时）。
 * @sideeffect 关闭待开局卡片，改写 isPresetPending / isTutorialMode 与计时状态；
 *             难度条件不满足时保留待开局卡片，只弹出说明框
 */
function beginPresetGame() {
    if (!ensurePresetAllowed()) return;
    AudioFX.confirm();
    // 参数只取决于当前难度，生成前重设一次，避免跨模式残留的尺寸参与生成
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
    // 先标记本局已开始，防止首次落子时的自动计时再次触发
    if (!isFreeMode) {
        ts = true;
        startTi();
    }
}

/**
 * 清空当前局的全部已放置道具：只回退棋盘，不重新生成题目。
 * @sideeffect 把 G.placed 归零并重绘棋盘。
 */
function clearAll() {
    AudioFX.confirm();
    G.placed = {};
    resetP();
    render();
}

/* ---------- 4. 页面事件接线与首屏启动 ---------- */

// 「新游戏」按钮：13-achievements 安装钩子时会包装此处理器，用于统计连点
document.getElementById("reset").onclick = newGame;

// 「清空放置」按钮（v1.3.3 起位于地雷槽底部）：同样属于可被钩子替换的入口
document.getElementById("slotClearBtn").onclick = clearAll;

/**
 * 首屏启动：渲染记录表、雷种信息与系列开关，发放脑王解锁提示，
 * 然后自动开第一局；欢迎 / 引导弹窗由下方 load 监听器按访问记录决定。
 * @sideeffect 读写 Store 中的脑王提示标记，并触发第一局游戏。
 */
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

/**
 * 全局代理 dragstart：把拖拽预览图换成空图像，消除浏览器默认的
 * 半透明拖拽残影；只影响视觉，不改变 dataTransfer 中的数据。
 * 地雷槽位是例外：它由 07-board 的 setMineDragImage 换成单个 emoji，
 * 这里必须放行，否则会把已经设好的 emoji 预览覆盖成空图。
 */
document.addEventListener("dragstart", function(e) {
    const src = e.target;
    // 从地雷槽拖出时保留 07-board 设置的单 emoji 预览
    if (src && src.closest && src.closest(".mine-item")) return;
    try {
        e.dataTransfer.setDragImage(new Image, 0, 0);
    } catch (_) {}
}, false);

/**
 * 首次访问与每日欢迎：首次访问展示教学提示（3 秒倒计时后才允许确认），
 * 否则在当天首次访问时展示每日欢迎弹窗。
 * @sideeffect 读写 hasVisitedBefore / tutorialStep / welcomeLastShown 三个持久化键。
 */
window.addEventListener("load", function() {
    // 用本地日期字符串作为"今天"的判据，跨天后可再次弹出欢迎层
    let today = (new Date).toDateString();
    let lastShown = Store.get("welcomeLastShown");
    let isFirstTime = !Store.get("hasVisitedBefore");
    if (isFirstTime) {
        // 稍作延迟再弹，等首屏棋盘绘制完成，避免弹窗与首帧渲染互相干扰
        setTimeout(() => {
            document.getElementById("overlay").style.display = "block";
            document.getElementById("tutorialPrompt").style.display = "block";
            AudioFX.modalOpen();
            let btn = document.getElementById("tutorialConfirmBtn");
            btn.disabled = true;
            let cd = 3;
            let cdEl = document.getElementById("tutorialCountdown");
            // 3 秒倒计时期间禁用确认按钮，保证玩家至少浏览一次引导说明
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
        // 非首次访问：同一自然日只弹一次欢迎层，减少对局开始时的打扰
        setTimeout(() => {
            document.getElementById("overlay").style.display = "block";
            document.getElementById("welcomeModal").style.display = "block";
            AudioFX.modalOpen();
        }, 500);
        Store.set("welcomeLastShown", today);
    }
});
