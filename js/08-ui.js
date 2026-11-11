/* ==========================================================================
 * 模块 08 · 界面与弹窗（js/08-ui.js）
 *
 * 职责：管理侧边栏与信息栏折叠、难度弹窗与系列开关、成绩记录渲染、
 *       胜利判定与通关庆祝，以及所有弹窗的打开 / 关闭策略；
 *       硬核与俄罗斯方块模式的通关成绩在这里分别单独记账（与普通成绩互不覆盖）。
 * 依赖：00-core 的全局状态与工具（RM、G、diff、isHardcoreMode、isTetrisMode、
 *       gameHardcore、gameTetris、S / SR / SC、T / K、freeRectExpanded、LIMIT、
 *       PRE、applyBoardParams、syncBoardParamDisplays）；
 *       01-storage 的 Store 与成绩 / 系列状态（wins、rec、lt、hcWins、hcRec、
 *       hcLt、tetWins、tetRec、tetLt、seriesState）；02-audio 的 AudioFX；
 *       04-mines 的 M / CATEGORY；06-render、07-board 提供的渲染与交互。
 * 对外：window.closeAllModals、window.syncMainPanel、window.gotoSeriesChallenge、
 *       window.onLockedSeriesClick、window.openDifficultyModal、window.renderChallengeList、
 *       window.setRecordFilter 等界面入口。
 * 设计要点：
 *   1) 弹窗统一"运行时构建 + 集中关闭"：closeAllModals 一次收掉遮罩与全部
 *      弹层，避免跳转后仍被没关掉的弹窗盖住。
 *   2) 侧边栏同一时刻只展开一个，且点击空白处可收起；为避免按钮点击的冒泡
 *      把刚打开的侧边栏立刻关掉，相关处理器需要显式阻断冒泡。
 * ========================================================================== */

/* ---------- 1. 侧边栏开关 ---------- */

/**
 * 关闭除 keepId 以外的所有侧边栏，保证同一时刻只展开一个。
 * @param {string|null} keepId 需要保持展开的侧边栏 id，传 null 表示全部关闭
 * @sideeffect 移除其它侧边栏的 open 类
 */
function closeSidebarsExcept(keepId) {
    [ "infoSidebar", "achSidebar", "createSidebar", "settingSidebar" ].forEach(id => {
        if (id === keepId) return;
        const el = document.getElementById(id);
        if (el) el.classList.remove("open");
    });
}

/**
 * 信息栏按钮：点击在"打开 / 收起"之间切换，并先收起其它侧边栏。
 * @sideeffect 播放音效并切换 infoSidebar 的 open 类
 */
document.getElementById("toggleInfoSidebar").onclick = () => {
    AudioFX.confirm();
    const infoSb = document.getElementById("infoSidebar");
    // 先记录切换前的状态，避免在收起其它侧边栏之后再判断而误判
    const willOpen = !infoSb.classList.contains("open");
    closeSidebarsExcept("infoSidebar");
    infoSb.classList.toggle("open", willOpen);
    if (typeof guideRefresh === "function") guideRefresh();
};

/**
 * 创造栏按钮：展开时额外把创造参数同步到面板上。
 * @sideeffect 播放音效、切换 createSidebar 的 open 类并准备参数
 */
document.getElementById("toggleCreateSidebar").onclick = () => {
    AudioFX.confirm();
    const createSb = document.getElementById("createSidebar");
    const willOpen = !createSb.classList.contains("open");
    closeSidebarsExcept("createSidebar");
    createSb.classList.toggle("open", willOpen);
    // 展开时才刷新参数，收起时不做多余计算
    if (willOpen) prepareCreateParams();
    if (typeof guideRefresh === "function") guideRefresh();
};

/* ---------- 2. 信息栏折叠部件 ---------- */

// 常驻展开的折叠项：炸弹信息用于查看雷种与解锁状态，任何情况下都不收起
const ACC_ALWAYS_OPEN = ["accMine"];

/**
 * 展开 / 收起信息栏中的一个折叠区，同栏内保持"手风琴"式互斥。
 * @param {string} id 折叠区元素的 id
 * @sideeffect 切换 rm-acc-open / rm-acc-closed 类并播放音效
 */
function toggleAcc(id) {
    const el = document.getElementById(id);
    if (!el) return;
    // 常驻项：点击只给音效反馈，视觉上始终展开
    if (ACC_ALWAYS_OPEN.indexOf(id) >= 0) {
        el.classList.add("rm-acc-open", "rm-acc-fixed");
        el.classList.remove("rm-acc-closed");
        AudioFX.pop();
        return;
    }
    const willOpen = !el.classList.contains("rm-acc-open");
    // 展开时收起同栏内的其它折叠区，常驻项不参与互斥
    const box = el.parentNode;
    if (box && willOpen) {
        Array.prototype.forEach.call(box.querySelectorAll(".rm-acc"), function(x) {
            if (x === el) return;
            if (ACC_ALWAYS_OPEN.indexOf(x.id) >= 0) return;
            x.classList.remove("rm-acc-open");
            x.classList.add("rm-acc-closed");
        });
    }
    el.classList.toggle("rm-acc-open", willOpen);
    el.classList.toggle("rm-acc-closed", !willOpen);
    AudioFX.pop();
}
window.toggleAcc = toggleAcc;

/* ---------- 2.1 记录栏折叠部件（成绩 / 成就） ---------- */

/**
 * 展开 / 收起「📝记录」栏中的一个折叠区。
 *
 * 与信息栏的 toggleAcc 共用同一套视觉语言（标题即按钮、箭头旋转、内容区
 * 淡入），但各区互不互斥：玩家可以同时展开成绩与成就进行对照，因此
 * 这里不做手风琴式收起。默认展开状态由 index.html 的
 * record-acc-open / record-acc-closed 类决定（成绩默认折叠、成就默认展开）。
 * 「挑战」区位于主按钮「🎯挑战」打开的弹窗中，本函数只处理
 * recSection / achSection 两个折叠区。
 *
 * @param {string} id 折叠区元素 id：recSection / achSection
 * @sideeffect 切换 record-acc-open / record-acc-closed 类、aria-expanded 与音效；
 *             展开时按需重绘该区内容，避免折叠期间的数据变化没有刷新
 */
function toggleRecordAcc(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const willOpen = !el.classList.contains("record-acc-open");
    el.classList.toggle("record-acc-open", willOpen);
    el.classList.toggle("record-acc-closed", !willOpen);
    const head = el.querySelector(".record-acc-head");
    if (head) head.setAttribute("aria-expanded", willOpen ? "true" : "false");
    try {
        if (window.AudioFX && AudioFX.pop) AudioFX.pop();
    } catch (e) {}
    if (!willOpen) return;
    // 展开时重绘一次：折叠期间数据可能已经变化，打开后立即看到最新内容
    try {
        if (id === "recSection" && typeof renderRecordList === "function") {
            renderRecordList();
        } else if (id === "achSection" && window.Achievements && Achievements.renderAchievements) {
            window.Achievements.renderAchievements();
        }
    } catch (e) {
        if (window.RM) RM.warn("toggleRecordAcc", e);
    }
}
window.toggleRecordAcc = toggleRecordAcc;

/* ---------- 3. 通用确认弹窗 ---------- */

// 确认弹窗的运行时单例：遮罩、内容节点与当前按钮回调
var _rmConfirm = { el: null, ov: null, cb: null };

/**
 * 懒创建确认弹窗的遮罩与容器，整个页面生命周期内只建一次。
 * 结构约定：opt = { icon, title, body, buttons:[{label, sub, cls, act}],
 *                  onAction(act) }
 * @sideeffect 向 body 追加两个节点并绑定点击委托
 */
function ensureConfirmModal() {
    if (_rmConfirm.el) return;
    var ov = document.createElement("div");
    ov.className = "auto-modal-overlay rm-confirm-overlay";
    ov.style.display = "none";
    document.body.appendChild(ov);
    var el = document.createElement("div");
    el.className = "auto-modal rm-confirm-modal";
    el.style.display = "none";
    document.body.appendChild(el);
    // 点遮罩等价于取消，沿用全局弹窗"点外面关闭"的交互约定
    ov.addEventListener("click", closeConfirmModal);
    el.addEventListener("click", function(e) {
        var b = e.target && e.target.closest ? e.target.closest("button[data-act]") : null;
        if (!b) return;
        // 阻断冒泡：document 上还有一层"点外面就关侧栏"的监听，不能让它把
        // 按钮回调里刚打开的侧边栏又立刻收起
        if (e.stopPropagation) e.stopPropagation();
        var act = b.getAttribute("data-act");
        var cb = _rmConfirm.cb;
        closeConfirmModal();
        if (cb) cb(act);
    });
    _rmConfirm.ov = ov;
    _rmConfirm.el = el;
}

/**
 * 用配置对象填充并打开确认弹窗。
 * @param {Object} opt 弹窗配置，字段见 ensureConfirmModal
 * @sideeffect 改写弹窗内容与可见性，播放打开音效
 */
function openConfirmModal(opt) {
    ensureConfirmModal();
    var html = '<div class="icon">' + (opt.icon || "❓") + "</div>" +
        "<h2>" + (opt.title || "") + "</h2>" +
        "<p>" + (opt.body || "") + "</p>" +
        '<div class="rm-btn-row">';
    (opt.buttons || []).forEach(function(b) {
        html += '<button type="button" class="rm-btn ' + (b.cls || "") + '" data-act="' + b.act + '">' +
            "<b>" + b.label + "</b>" + (b.sub ? "<small>" + b.sub + "</small>" : "") + "</button>";
    });
    html += "</div>";
    _rmConfirm.el.innerHTML = html;
    _rmConfirm.cb = opt.onAction || null;
    _rmConfirm.ov.style.display = "block";
    _rmConfirm.el.style.display = "block";
    AudioFX.modalOpen();
}

/**
 * 关闭确认弹窗并清空待执行的回调，避免回调在下次打开时被误触发。
 * @sideeffect 隐藏遮罩与弹窗节点
 */
function closeConfirmModal() {
    if (_rmConfirm.ov) _rmConfirm.ov.style.display = "none";
    if (_rmConfirm.el) _rmConfirm.el.style.display = "none";
    _rmConfirm.cb = null;
    if (typeof guideRefresh === "function") guideRefresh();
}
window.closeConfirmModal = closeConfirmModal;

/* ---------- 4. 统一关闭弹窗 ---------- */

/**
 * 一次性关闭所有弹层与遮罩：从弹窗跳转到信息栏、开始挑战等场景前必须调用。
 * @sideeffect 隐藏 #overlay、全部 .auto-modal、难度弹窗、通关框与胜利框
 */
function closeAllModals() {
    try {
        // 通用遮罩（欢迎 / 教学完成 / 难度锁定 / 地狱脑王锁定等共用）
        var ov = document.getElementById("overlay");
        if (ov) ov.style.display = "none";
        // 所有 .auto-modal（含运行时注入的确认弹窗）
        Array.prototype.forEach.call(document.querySelectorAll(".auto-modal"), function(m) {
            m.style.display = "none";
        });
        // 难度弹窗（独立容器，不属于 .auto-modal）
        var cm = document.getElementById("difficultyModal");
        if (cm) cm.style.display = "none";
        // 挑战弹窗 / 脑王通关框 / 教学完成框 / 胜利框
        [ "challengeModal", "brainWinModal", "teachCompleteModal", "win" ].forEach(function(id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.style.display = "none";
            el.classList.remove("visible");
        });
    } catch (e) {
        if (window.RM) RM.warn("closeAllModals", e);
    }
}
window.closeAllModals = closeAllModals;

/* ---------- 5. 主按钮条显隐与前置门禁 ---------- */

/**
 * 按 teachActive 推导主按钮条的显隐：教学模式下隐藏，其余模式显示。
 * 所有模式切换最终都会调用这里，保证按钮条状态不会漏同步。
 * @sideeffect 修改 .panel 的 display
 */
function syncMainPanel() {
    var p = document.querySelector(".panel");
    if (!p) return;
    var hide = false;
    try {
        hide = !!teachActive;
    } catch (e) {
        hide = false;   // teachActive 尚未初始化时按"不隐藏"处理
    }
    p.style.display = hide ? "none" : "flex";
    // 教学模式下显示「退出教学」按钮条：它位于地雷槽之外，无法用 #slot 的类名判定
    document.body.classList.toggle("teach-mode", hide);
}
window.syncMainPanel = syncMainPanel;

/**
 * 判断基础挑战（5 关）是否已通关，作为系列挑战的前置门禁。
 * @returns {boolean} true 表示已通关
 * @sideeffect 读取 Store 中的 tutorialCompleted
 */
function isBasicChallengeDone() {
    try {
        return Store.get("tutorialCompleted") === "true";
    } catch (e) {
        return false;
    }
}
window.isBasicChallengeDone = isBasicChallengeDone;

/* ---------- 6. 系列挑战入口 ---------- */

/**
 * 把玩家引向「🎯挑战」里的指定系列：
 * **不直接打开挑战弹窗**，而是先设置引导标记、收起弹层，让引导层把高亮环
 * 放到主按钮「🎯挑战」上；玩家自己点开弹窗后，引导会自动转而指向该系列行
 * 右侧的「挑战 / 练习」按钮。每次调用都会重置引导状态，所以重复点「前往挑战」
 * 每次都会重新触发这套两步指引。
 * @param {string} catKey 系列键（special / physics / symmetry / tactical 等）
 * @sideeffect 收起弹层与侧栏、写入系列引导标记、刷新引导
 */
function gotoSeriesChallenge(catKey) {
    // 记录来源系列：引导第一步指「🎯挑战」，第二步指该系列行按钮
    window._guideLockedSeries = catKey;
    window._guideLockedDifficulty = null;
    // 先收掉所有弹层与侧栏，避免确认框 / 难度弹窗挡住主按钮
    closeAllModals();
    closeSidebarsExcept(null);
    if (typeof guideRefresh === "function") {
        guideRefresh();
        // 确认框刚关闭时布局会跳一下，稍后再刷一次保证高亮贴在按钮上
        setTimeout(guideRefresh, 120);
    }
}
window.gotoSeriesChallenge = gotoSeriesChallenge;

/**
 * 点击未解锁的系列开关时的引导：询问是否立刻前往该系列挑战。
 * 确认后不直接打开挑战弹窗，而是走 gotoSeriesChallenge 的两步指引。
 * @param {string} catKey 系列键
 * @sideeffect 播放锁定音效并打开确认弹窗
 */
function onLockedSeriesClick(catKey) {
    if (catKey === "basic") return;
    AudioFX.locked();
    var cat = CATEGORY[catKey] || { name: catKey, emoji: "🔒" };
    openConfirmModal({
        icon: "🔒",
        title: "「" + cat.name + "」未解锁",
        body: "完成该系列的 <strong>5 关挑战</strong> 即可解锁<br>" +
            "解锁后就能在 🎯难度 里开启这个系列开关 ✅",
        buttons: [ {
            label: "前往挑战",
            sub: "先点主按钮「🎯挑战」",
            cls: "rm-btn-primary",
            act: "go"
        }, {
            label: "取消",
            cls: "rm-btn-cancel",
            act: "cancel"
        } ],
        onAction: function(act) {
            if (act === "go") {
                closeAllModals();
                // 每次点「前往挑战」都重新触发两步指引：主按钮 → 系列行按钮
                gotoSeriesChallenge(catKey);
            }
        }
    });
    // 玩家已经开始处理系列开关，难度门槛路线让位给这条更具体的引导；
    // 系列引导标记在点「前往挑战」时才写入，取消不会留下指引
    window._guideLockedDifficulty = null;
    if (typeof guideRefresh === "function") guideRefresh();
}
window.onLockedSeriesClick = onLockedSeriesClick;

/* ---------- 7. 难度弹窗与底部按钮栏 ---------- */

/**
 * 打开难度弹窗：先收起所有侧边栏，再刷新系列开关与预设按钮状态。
 * @sideeffect 播放音效、收起侧边栏、显示 difficultyModal
 */
function openDifficultyModal() {
    AudioFX.confirm();
    closeSidebarsExcept(null);
    renderSeriesSwitches();
    updatePresetButtons();
    // 硬核开关是跨局偏好：每次打开都按当前状态刷新外观与锁定提示
    if (typeof syncHardcoreUI === "function") syncHardcoreUI();
    // 俄罗斯方块开关与硬核开关互斥，同样按当前偏好刷新外观
    if (typeof syncTetrisUI === "function") syncTetrisUI();
    const m = document.getElementById("difficultyModal");
    if (m) m.style.display = "block";
    if (typeof guideRefresh === "function") guideRefresh();
}

/**
 * 关闭难度弹窗。
 * @sideeffect 隐藏 difficultyModal
 */
function closeDifficultyModal() {
    const m = document.getElementById("difficultyModal");
    if (m) m.style.display = "none";
    // 弹窗收起时一并收起开关行的说明气泡，避免气泡悬在页面上
    hideSeriesTip();
    if (typeof guideRefresh === "function") guideRefresh();
}

window.openDifficultyModal = openDifficultyModal;
window.closeDifficultyModal = closeDifficultyModal;

/* ---------- 7.1 挑战弹窗 ---------- */

/**
 * 打开「🎯挑战」弹窗：集中展示教学 / 基础挑战 / 五个系列挑战的进度，
 * 每行右侧是练习 / 挑战入口。
 * 与难度弹窗互斥，打开前先收起所有侧栏与难度弹窗，并刷新一次进度。
 * @sideeffect 播放音效、收起侧栏、显示 challengeModal
 */
function openChallengeModal() {
    AudioFX.confirm();
    // 与难度弹窗互斥：同时打开会互相遮挡
    var diffModal = document.getElementById("difficultyModal");
    if (diffModal) diffModal.style.display = "none";
    closeSidebarsExcept(null);
    renderChallengeList();
    const m = document.getElementById("challengeModal");
    if (m) m.style.display = "block";
    // 如果引导标记了某个未解锁系列，打开后把该系列行滚进视野，
    // 保证第二步的高亮（该行右侧的挑战 / 练习按钮）可见
    var guideCat = window._guideLockedSeries;
    if (guideCat) {
        var row = document.querySelector('#challengeList .challenge-item[data-key="' + guideCat + '"]');
        if (row && typeof row.scrollIntoView === "function") {
            try {
                row.scrollIntoView({ behavior: "smooth", block: "center" });
            } catch (e) {}
        }
    }
    if (typeof guideRefresh === "function") guideRefresh();
}

/**
 * 关闭「🎯挑战」弹窗。
 * @sideeffect 隐藏 challengeModal
 */
function closeChallengeModal() {
    const m = document.getElementById("challengeModal");
    if (m) m.style.display = "none";
    if (typeof guideRefresh === "function") guideRefresh();
}
window.openChallengeModal = openChallengeModal;
window.closeChallengeModal = closeChallengeModal;

/**
 * 设置栏按钮：点击在"打开 / 收起"之间切换，并先收起其它侧边栏。
 * @sideeffect 播放音效并切换 settingSidebar 的 open 类
 */
document.getElementById("toggleSettingSidebar").onclick = () => {
    AudioFX.confirm();
    const setSb = document.getElementById("settingSidebar");
    const willOpen = !setSb.classList.contains("open");
    closeSidebarsExcept("settingSidebar");
    setSb.classList.toggle("open", willOpen);
    if (typeof guideRefresh === "function") guideRefresh();
};

/**
 * 创建手机端底部按钮栏的折叠开关（只在小屏由 CSS 显示），默认展开。
 * 按钮在运行时注入，页面中无需预置节点。
 * @sideeffect 向 body 追加一个按钮，并绑定折叠切换逻辑
 */
function ensureBarToggle() {
    if (document.getElementById("rmBarToggle")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "rmBarToggle";
    btn.className = "rm-bar-toggle";
    btn.setAttribute("aria-label", "收起或展开底部按钮");
    btn.innerHTML = '<span class="rm-bar-arrow">▾</span>';
    btn.addEventListener("click", function(e) {
        e.preventDefault();
        // 阻断冒泡，否则 document 上的"点外面关侧栏"会把侧边栏一起收掉
        e.stopPropagation();
        var collapsed = document.body.classList.toggle("rm-bar-collapsed");
        // aria-expanded 与视觉状态取反：收起时 aria-expanded 为 false
        btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
        btn.title = collapsed ? "展开底部按钮" : "收起底部按钮";
        try {
            AudioFX.pop();
        } catch (err) {}
    });
    document.body.appendChild(btn);
}
window.ensureBarToggle = ensureBarToggle;

/* ---------- 8. 点击弹窗外部关闭 ---------- */

/**
 * 全局委托：点击侧边栏以外的区域时收起侧边栏。
 * 判定"点在外面"时必须排除两种目标：侧边栏自己的开关按钮（否则先开
 * 后关）与 .rule-mode-link（它负责跳转，不属于收起场景）。
 * @sideeffect 移除侧边栏的 open 类
 */
document.addEventListener("click", e => {
    const modeLink = e.target && e.target.closest ? e.target.closest(".rule-mode-link") : null;
    // 难度弹窗里的「📝记录」跳转按钮会在这次 click 里打开记录侧栏，
    // 必须把它排除在外，否则同一次点击的冒泡会立刻把刚打开的侧栏收回去，
    // 引导也会因为侧栏被关而落到别的按钮上
    const recordJump = e.target && e.target.closest ? e.target.closest("#recordJumpBtn") : null;
    // 系列开关板块底部的「🧭信息」跳转同理：它负责打开信息侧栏
    const mineJump = e.target && e.target.closest ? e.target.closest("#mineJumpBtn") : null;
    [ [ "infoSidebar", "toggleInfoSidebar" ], [ "achSidebar", "toggleAchSidebar" ], [ "createSidebar", "toggleCreateSidebar" ], [ "settingSidebar", "toggleSettingSidebar" ] ].forEach(([ id, btnId ]) => {
        const sb = document.getElementById(id);
        if (!sb || !sb.classList.contains("open")) return;
        const btn = document.getElementById(btnId);
        // 点在侧边栏内部、开关按钮上、模式跳转链接或记录 / 信息跳转按钮上时都不收起
        if (!sb.contains(e.target) && e.target !== btn && !modeLink && !recordJump && !mineJump) sb.classList.remove("open");
    });
});

/**
 * 全局委托：点击难度弹窗外部时关闭弹窗。
 * 点遮罩本身，或点卡片之外的空白都算"外部"；点开弹窗的入口按钮除外，
 * 否则同一次点击会先把紧接着打开的弹窗关掉。
 * @sideeffect 关闭 difficultyModal
 */
document.addEventListener("click", function(e) {
    const m = document.getElementById("difficultyModal");
    if (!m || m.style.display !== "block") return;
    const card = m.querySelector(".game-modal-card");
    if (e.target === m) closeDifficultyModal();
    else if (card && !card.contains(e.target) && e.target.closest && !e.target.closest("#difficultyBtn")) closeDifficultyModal();
});
/**
 * 全局委托：点击「🎯挑战」弹窗外部时关闭它（与难度弹窗同一套策略）。
 * @sideeffect 关闭 challengeModal
 */
document.addEventListener("click", function(e) {
    const m = document.getElementById("challengeModal");
    if (!m || m.style.display !== "block") return;
    const card = m.querySelector(".game-modal-card");
    if (e.target === m) closeChallengeModal();
    else if (card && !card.contains(e.target) && e.target.closest && !e.target.closest("#challengeBtn")) closeChallengeModal();
});
/**
 * 键盘委托：Esc 关闭难度弹窗 / 挑战弹窗，作为鼠标关闭路径的键盘等价操作。
 */
document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
        closeDifficultyModal();
        closeChallengeModal();
    }
});

/* ---------- 9. 系列开关 ---------- */

/**
 * 取某个系列下全部地雷的图鉴键，按 M 的声明顺序排列。
 * @param {string} catKey 系列键
 * @returns {string[]} 雷型 key 列表
 */
function seriesMineKeys(catKey) {
    return Object.keys(M).filter(function(k) {
        return M[k].category === catKey;
    });
}

/**
 * 拼某个系列的炸弹清单文本（emoji + 名称，顿号分隔），用于开关行说明气泡。
 * 系列名与清单之间用换行分开，气泡里表现为"系列名冒号后换行"。
 * @param {string} catKey 系列键
 * @returns {string} 气泡文本；系列不存在时返回空串
 */
function seriesMineTipText(catKey) {
    const cat = CATEGORY[catKey];
    if (!cat) return "";
    const keys = seriesMineKeys(catKey);
    return cat.emoji + " " + cat.name + "：\n" + keys.map(function(k) {
        return M[k].e + M[k].n;
    }).join("、");
}

/**
 * 收起系列开关的说明气泡。
 * @sideeffect 隐藏 body 级气泡节点
 */
function hideSeriesTip() {
    if (typeof hideMineTip === "function") hideMineTip();
}

/**
 * 在指定元素上显示说明气泡：复用 body 级固定气泡，避免被弹窗或槽位的
 * overflow 裁剪；宽屏悬停与窄屏点按共用同一套定位。
 * @param {HTMLElement} el 触发元素
 * @param {string} text 气泡文本
 */
function showSeriesTip(el, text) {
    if (!el || !text) return;
    if (typeof showMineTip === "function") showMineTip(el, text);
}

/**
 * 宽屏鼠标移入系列行：显示该系列的炸弹清单。
 * 触屏没有 hover，交给点击分支；用媒体查询区分，避免触屏模拟的
 * mouseenter 与点按气泡互相覆盖。
 * @param {HTMLElement} el 系列行
 */
function onSeriesRowEnter(el) {
    if (!window.matchMedia || !window.matchMedia("(hover: hover)").matches) return;
    if (!el || !el.dataset) return;
    showSeriesTip(el, seriesMineTipText(el.dataset.cat));
}

/**
 * 鼠标移出系列行：收起气泡（触屏不参与）。
 */
function onSeriesRowLeave() {
    if (window.matchMedia && !window.matchMedia("(hover: hover)").matches) return;
    hideSeriesTip();
}

/**
 * 点按系列行：触屏上点一次出现炸弹清单气泡，点页面其它位置由全局监听收起。
 * 开关自身有独立处理器，这里跳过，避免一次点按同时切换开关与弹气泡。
 * @param {MouseEvent} ev 点击事件
 * @param {HTMLElement} el 系列行
 */
function onSeriesRowClick(ev, el) {
    if (ev && ev.target && ev.target.closest && ev.target.closest(".switch-toggle")) return;
    // 宽屏鼠标已有 hover 气泡，点击不再重复切换
    if (window.matchMedia && window.matchMedia("(hover: hover)").matches) return;
    if (!el || !el.dataset) return;
    showSeriesTip(el, seriesMineTipText(el.dataset.cat));
}

/**
 * 基础系列的开关：该系列始终开启、无法关闭，点按时说明原因。
 * @param {HTMLElement} el 开关节点
 * @sideeffect 显示提示气泡并播放"不可用"音效
 */
function onBasicSeriesClick(el) {
    const row = document.querySelector('#seriesSwitchList .switch-row[data-cat="basic"]');
    showSeriesTip(el || row, "该系列始终开启");
    try {
        AudioFX.locked();
    } catch (e) {}
}

/**
 * 渲染难度弹窗里的 6 个系列开关：二级分组标题、锁定状态文案、开关状态、
 * 悬停 / 点按的炸弹清单气泡与解锁提示。
 * @sideeffect 重写 #seriesSwitchList 与 #seriesSwitchHint 的内容，并收起旧气泡
 */
function renderSeriesSwitches() {
    const container = document.getElementById("seriesSwitchList");
    if (!container) return;
    hideSeriesTip();
    let html = "";
    // 二级分组：基础系列始终开启，其余五个系列靠挑战解锁后可选
    const groups = [
        { title: "始终开启", keys: [ "basic" ] },
        { title: "可选扩展", keys: [ "special", "physics", "poker", "symmetry", "tactical" ] }
    ];
    groups.forEach(function(group) {
        html += `<div class="series-group">`;
        html += `<div class="series-group-title">${group.title}</div>`;
        group.keys.forEach(function(catKey) {
            let unlocked = seriesUnlocked[catKey];
            let on = seriesState[catKey];
            let cat = CATEGORY[catKey];
            // 锁定状态固定在开关左侧；基础系列始终开启，徽标固定显示"始终开启"
            let badge;
            if (catKey === "basic") {
                badge = `<span class="series-lock-badge always-on">始终开启</span>`;
            } else {
                badge = unlocked ? `<span class="series-lock-badge unlocked">✅已解锁</span>` : `<span class="series-lock-badge locked">🔒未解锁</span>`;
            }
            html += `<div class="switch-row ${unlocked ? "unlocked" : "locked-row"}" data-cat="${catKey}" data-tip="${seriesMineTipText(catKey)}" onmouseenter="onSeriesRowEnter(this)" onmouseleave="onSeriesRowLeave()" onclick="onSeriesRowClick(event,this)">`;
            html += `<div class="switch-label"><span class="cat-name">${cat.emoji} ${cat.name}</span></div>`;
            html += badge;
            if (catKey === "basic") {
                // 基础系列是其余系列的前置条件：开关只作状态展示，点击给出原因
                html += `<div class="switch-toggle on always-on" role="switch" aria-checked="true" aria-disabled="true" onclick="event.stopPropagation();onBasicSeriesClick(this)"></div>`;
            } else if (unlocked) {
                // 已解锁：开关可随时切换，切换结果立即持久化
                html += `<div class="switch-toggle ${on ? "on" : ""}" role="switch" aria-checked="${on ? "true" : "false"}" onclick="event.stopPropagation();toggleSeries('${catKey}')"></div>`;
            } else {
                // 未解锁时点击不切换，而是弹出"前往挑战"的引导
                html += `<div class="switch-toggle disabled" role="switch" aria-checked="false" aria-disabled="true" onclick="event.stopPropagation();onLockedSeriesClick('${catKey}')"></div>`;
            }
            html += `</div>`;
        });
        html += `</div>`;
    });
    container.innerHTML = html;
    let hint = document.getElementById("seriesSwitchHint");
    let onCount = getSeriesOnCount();
    // 门槛：困难 ≥3 个；地狱与脑王共用 ≥5 个（脑王另需地狱通关次数）
    if (onCount < SERIES_TOTAL) {
        hint.className = "switch-hint";
        let need;
        if (onCount < 3) need = "困难需<strong>≥3</strong>个 · 地狱/脑王需<strong>≥" + HELL_SERIES_REQ + "</strong>个";
        else if (onCount < HELL_SERIES_REQ) need = "困难可用✅ · 地狱/脑王需<strong>≥" + HELL_SERIES_REQ + "</strong>个";
        else if (getHellWinCount() >= BRAIN_HELL_WINS_REQ) need = "地狱 & 脑王均可挑战 ✅";
        else need = "地狱可用✅ · 脑王需地狱通关<strong>" + BRAIN_HELL_WINS_REQ + "</strong>次";
        hint.innerHTML = `已开启<strong> ${onCount}/${SERIES_TOTAL} </strong>个系列<br>${need}`;
    } else {
        hint.className = "switch-hint unlock-hint";
        let brainReady = getHellWinCount() >= BRAIN_HELL_WINS_REQ;
        // 与上面几种档位保持同样的两行结构：避免全开时提示少一行导致
        // 弹窗内容高度变化（滚动条隐现会让居中卡片横向偏移几个像素）
        hint.innerHTML = brainReady ? `全部 ${onCount}/${SERIES_TOTAL} 已开启 ✅<br>地狱 & 脑王均可挑战` : `全部 ${onCount}/${SERIES_TOTAL} 已开启 ✅<br>地狱可用 · 脑王需地狱通关<strong>${BRAIN_HELL_WINS_REQ}</strong>次`;
    }
    updatePresetButtons();
}

/**
 * 切换某个系列的开关；基础系列与尚未解锁的系列不响应。
 * @param {string} catKey 系列键
 * @sideeffect 写入 seriesState 并持久化，随后重绘开关列表
 */
function toggleSeries(catKey) {
    if (catKey === "basic") return;
    if (!seriesUnlocked[catKey]) return;
    seriesState[catKey] = !seriesState[catKey];
    saveSeriesState(seriesState);
    AudioFX.toggle(seriesState[catKey]);
    // 玩家已经在动开关了，难度门槛的引导路线到此结束
    window._guideLockedDifficulty = null;
    renderSeriesSwitches();
    if (typeof guideRefresh === "function") guideRefresh();
}

/**
 * 解锁某个系列并默认开启，仅由该系列挑战通关时调用。
 * @param {string} catKey 系列键
 * @sideeffect 写入 seriesUnlocked / seriesState 并持久化
 */
function unlockSeries(catKey) {
    seriesUnlocked[catKey] = true;
    seriesState[catKey] = true;
    saveSeriesUnlocked(seriesUnlocked);
    saveSeriesState(seriesState);
    renderSeriesSwitches();
    // 系列由「未解锁」变为「已完成」：立刻刷新「🎯挑战」弹窗的进度面板
    renderChallengeList();
}

/**
 * 统计当前处于开启状态的系列数量。
 * @returns {number} 0~SERIES_TOTAL 之间
 */
function getSeriesOnCount() {
    const knownKeys = [ "basic", "special", "physics", "poker", "symmetry", "tactical" ];
    return knownKeys.filter(k => seriesState[k] === true).length;
}

/**
 * 地狱难度的累计通关次数：普通局与硬核局合并计算，用于脑王解锁门槛。
 * 成绩栏仍分别展示两条记录，门槛只看"通关过多少次地狱"。
 * @returns {number} 非负整数
 */
function getHellWinCount() {
    let n = wins.hell || 0;
    // 硬核成绩变量由 01-storage 提供；极简运行环境缺失时按 0 处理
    if (typeof hcWins !== "undefined") n += hcWins.hell || 0;
    return n;
}

/**
 * 判断"脑王"是否已解锁：地狱通关达到指定次数且系列开关达到与地狱相同的门槛。
 * @returns {boolean} true 表示可以挑战脑王
 */
function checkBrainUnlocked() {
    let hellWins = getHellWinCount();
    let seriesCount = getSeriesOnCount();
    return hellWins >= BRAIN_HELL_WINS_REQ && seriesCount >= HELL_SERIES_REQ;
}

/* ---------- 10. 难度预设 ---------- */

/**
 * 刷新难度按钮的锁定样式：困难需 3 个系列、地狱与脑王需 5 个系列
 * （脑王另需地狱通关次数）；简单 / 中等不设系列门槛，方便新手直接开始。
 * @sideeffect 切换各难度按钮的 locked 类
 */
function updatePresetButtons() {
    let onCount = getSeriesOnCount();
    let hardLocked = onCount < 3;
    let hellLocked = onCount < HELL_SERIES_REQ;
    let brainLocked = !checkBrainUnlocked();
    // 自由模式不做难度预设的门槛展示；但"刷新后的首局"只是按自由难度归类，
    // 难度按钮仍要按真实门槛显示锁定态，等玩家主动选难度后再切换外观
    const freeStyle = isFreeMode && !isRefreshFreeGame;
    // 简单 / 中等始终可用：不受系列开关数量限制
    [ "btnEasy", "btnMedium" ].forEach(id => {
        let btn = document.getElementById(id);
        if (btn) btn.classList.remove("locked");
    });
    let btnHard = document.getElementById("btnHard");
    if (btnHard) {
        // 自由模式下难度由玩家自定，预设按钮不显示锁定态
        if (freeStyle || !hardLocked) btnHard.classList.remove("locked");
        else btnHard.classList.add("locked");
    }
    let btnHell = document.getElementById("btnHell");
    if (btnHell) {
        if (freeStyle) {
            btnHell.classList.remove("locked");
        } else if (hellLocked) btnHell.classList.add("locked"); else btnHell.classList.remove("locked");
    }
    let btnBrain = document.getElementById("btnBrain");
    if (btnBrain) {
        if (freeStyle) {
            btnBrain.classList.remove("locked");
        } else if (brainLocked) btnBrain.classList.add("locked"); else btnBrain.classList.remove("locked");
    }
    // 自由模式永远可用，因此固定解锁
    let btnFree = document.getElementById("btnFree");
    if (btnFree) {
        btnFree.classList.remove("locked");
    }
}

/**
 * 判断某个预设难度当前是否允许进入，与按钮的锁定状态使用同一套条件。
 * @param {string} d 难度键
 * @returns {boolean} true 表示可进入
 */
function checkPresetAllowed(d) {
    let onCount = getSeriesOnCount();
    if (d === "brain") return checkBrainUnlocked();
    if (d === "hell") return onCount >= HELL_SERIES_REQ;
    // 简单 / 中等不设系列门槛，仅困难要求至少 3 个系列开启
    if (d === "easy" || d === "medium") return true;
    return onCount >= 3;
}

/**
 * 弹出"条件不满足"的说明框：困难使用通用的"无法使用"框，
 * 地狱 / 脑王分别显示当前进度。
 * @param {string} d 难度键
 * @sideeffect 显示遮罩与对应弹窗并播放提示音
 */
function showPresetLockedModal(d) {
    document.getElementById("overlay").style.display = "block";
    if (d === "brain") {
        document.getElementById("brainHellWins").textContent = getHellWinCount();
        document.getElementById("brainSeriesCount").textContent = getSeriesOnCount();
        document.getElementById("brainLockedModal").style.display = "block";
    } else if (d === "hell") {
        document.getElementById("hellLockedCount").textContent = getSeriesOnCount();
        document.getElementById("hellLockedModal").style.display = "block";
    } else {
        document.getElementById("presetLockedModal").style.display = "block";
    }
    // 关掉说明框后，引导会带玩家去难度弹窗把系列开关开够
    window._guideLockedDifficulty = d;
    AudioFX.modalOpen();
}

/**
 * 开新局前重新校验当前预设难度。系列开关解锁后随时可调，困难局中途可能被
 * 关到 3 个以下，因此每次开局都要按"当前"系列状态再判一次。
 * @returns {boolean} true 表示可以继续开局；false 表示已弹出说明框
 * @sideeffect 条件不满足时显示遮罩与对应说明弹窗
 */
function ensurePresetAllowed() {
    if (isFreeMode || !isPresetDifficulty(diff)) return true;
    if (checkPresetAllowed(diff)) return true;
    showPresetLockedModal(diff);
    return false;
}

/**
 * 判断难度键是否属于"选完即开局"的预设难度，而非自由模式。
 * @param {string} d 难度键
 * @returns {boolean} true 表示是预设难度
 */
function isPresetDifficulty(d) {
    return d === "easy" || d === "medium" || d === "hard" || d === "hell" || d === "brain";
}

/**
 * 选择难度预设的入口：自由模式只切到参数面板，其余难度校验后直接进入。
 * @param {string} d 难度键：free / easy / medium / hard / hell / brain
 * @sideeffect 重置棋局、写入 diff 与 pendingDiff，并刷新弹窗与按钮状态
 */
function setPre(d) {
    // 自由模式要留在弹窗里调参数，其它难度选完即关
    if (d !== "free") closeDifficultyModal();
    fullReset();
    if (d === "free") {
        isFreeMode = true;
        diff = "free";
        // 玩家主动选择自由模式：难度按钮从此按自由模式的外观处理
        isRefreshFreeGame = false;
        window._guideLockedDifficulty = null;
        // 自由模式改用新参数模型：面板初值取 PRE.free，地雷种类数按
        // type + 1 推导（普通雷 + 特殊雷种类），旧配比里的特殊雷总数不再参与
        const pf = PRE.free;
        applyBoardParams({ size: pf.size, total: pf.total, kinds: pf.type + 1 });
        // 每次进入自由模式都回到正方形棋盘：矩形设置不跨会话残留
        freeRectExpanded = false;
        SR = SC = S;
        syncFreeParamDisplays();
        syncFreeRectPanel();
        document.getElementById("customPanel").classList.add("visible");
        updatePresetButtons();
        renderSeriesSwitches();
        resetTi();
        document.getElementById("timer").style.display = "none";
        AudioFX.confirm();
        // 自由模式不立即开局：留在弹窗里调好参数，点「应用设置」后才开始
        return;
    }
    if (!checkPresetAllowed(d)) {
        showPresetLockedModal(d);
        return;
    }
    isFreeMode = false;
    // 选定预设难度后不再是"刷新后的自由局"，难度按钮恢复正常锁定外观
    isRefreshFreeGame = false;
    window._guideLockedDifficulty = null;
    // 用预设整体覆盖棋盘参数，避免沿用上一局教学 5×5 或创造 15×15 的尺寸
    applyPresetParams(d);
    diff = d;
    pendingDiff = d;
    document.getElementById("customPanel").classList.remove("visible");
    updatePresetButtons();
    renderSeriesSwitches();
    AudioFX.confirm();
    if (isPresetDifficulty(d)) {
        // 先确定本局玩法快照，待开始卡片才能显示经典 / 硬核 / 俄罗斯方块模式
        applyGameHardcore();
        if (typeof applyGameTetris === "function") applyGameTetris();
        enterPresetPending(d);
    }
}

/**
 * 进入预设难度的"待开始"状态：清空棋盘与成绩展示，只显示开始卡片。
 * 玩家确认后才真正发牌并启动计时，保证题目展示时不占用答题时间。
 * @param {string} d 难度键
 * @sideeffect 清空 G 中的棋局数据，改写棋盘、槽位、计时器与开始卡片
 */
function enterPresetPending(d) {
    G.tar = [];
    G.p = [];
    G.placed = {};
    G.pool = {};
    G.max = 0;
    isPresetPending = true;
    pendingDiff = d;
    var board = document.getElementById("board");
    board.innerHTML = "";
    board.style.display = "none";
    // 棋盘隐藏时同步收起骨牌覆盖层（body 级 fixed，不会随棋盘一起隐藏）
    if (typeof hideTetroOverlay === "function") hideTetroOverlay();
    var slot = document.getElementById("slot");
    // 只清掉已生成的雷卡，保留教学气泡与槽内底部的清空条
    Array.prototype.slice.call(slot.querySelectorAll(".mine-item")).forEach(function(el) {
        if (el.parentNode) el.parentNode.removeChild(el);
    });
    slot.style.display = "none";
    document.getElementById("timer").style.display = "none";
    document.getElementById("placed").textContent = "0";
    document.getElementById("max").textContent = "0";
    document.getElementById("win").style.display = "none";
    // 难度标签与卡片的配色类一一对应，用于区分不同难度的开始卡片
    var labelMap = {
        easy: "😎简单",
        medium: "😮中等",
        hard: "😤困难",
        hell: "👿地狱",
        brain: "🤯脑王"
    };
    // 玩法模式：待开始卡片要说明本局是经典 / 硬核 / 俄罗斯方块（快照已在 newGame 中算好）
    var mode = gameTetris
        ? { icon: "🧱", name: "俄罗斯方块模式", cls: "mode-tetris" }
        : (gameHardcore
            ? { icon: "🪚", name: "硬核模式", cls: "mode-hardcore" }
            : { icon: "🎯", name: "经典模式", cls: "mode-classic" });
    // 参数摘要：骨牌局的块数按生成规则（预设难度约 2/3、至少 3 块）预估
    var params = "棋盘 " + SR + "×" + SC + " · ";
    if (gameTetris) {
        params += "骨牌 " + Math.max(3, Math.ceil(T * 2 / 3)) + " 块";
    } else {
        params += "总雷数 " + T;
        if (gameHardcore) params += " · 硬核配色";
    }
    var card = document.getElementById("presetStartCard");
    // 卡片配色随模式切换：经典（蓝）/ 硬核（钢蓝）/ 骨牌（紫）
    card.className = "preset-start-card " + mode.cls;
    var modeEl = document.getElementById("presetStartMode");
    if (modeEl) {
        modeEl.className = "preset-start-mode " + mode.cls;
        modeEl.textContent = mode.icon + " " + mode.name;
    }
    document.getElementById("presetStartIcon").textContent = mode.icon;
    document.getElementById("presetStartTitle").textContent = "准备好了吗？";
    var desc = document.getElementById("presetStartDesc");
    desc.innerHTML = '<b class="preset-start-params">' + params + "</b>" +
        '<span class="preset-start-sub">点击开始后题目将展现并启动计时' +
        (gameTetris ? "，双击已放骨牌可旋转" : (gameHardcore ? "，本局不显示三态配色" : "")) +
        "</span>";
    var tag = document.getElementById("presetStartTag");
    tag.className = "preset-start-tag tag-" + d;
    document.getElementById("presetStartTagText").textContent = labelMap[d] || d;
    card.style.display = "flex";
    AudioFX.modalOpen();
    // 预设待开局时棋盘尚未生成：同步隐藏「地块准确数」提示，避免残留上一局数字
    if (typeof refreshHardcoreStat === "function") refreshHardcoreStat();
}

/* ---------- 11. 参数调整与成绩记录 ---------- */

/**
 * 刷新自由模式面板上的参数数字：统一交给 00-core 的参数同步函数，
 * 缺失的节点（旧版面板）由同步函数自行跳过。
 * @sideeffect 写入 #size / #sr / #sc / #total / #kinds 的文本
 */
function syncFreeParamDisplays() {
    if (typeof window.syncBoardParamDisplays === "function") window.syncBoardParamDisplays();
}

/**
 * 按 freeRectExpanded 同步矩形棋盘的控件形态：展开时隐藏「棋盘大小」行、
 * 显示行 / 列两行并把按钮切成「恢复正方形」；收起时相反。
 * 只改 DOM 显隐与文案，不改动任何棋盘参数。
 * @sideeffect 切换 #sizeRow / #srRow / #scRow 的 display，改写 #freeRectToggle
 *   的文案、aria-pressed 与展开类
 */
function syncFreeRectPanel() {
    const on = !!freeRectExpanded;
    const sizeRow = document.getElementById("sizeRow");
    const srRow = document.getElementById("srRow");
    const scRow = document.getElementById("scRow");
    // 行容器缺失时只跳过对应项，保证自由模式面板之外调用也不抛错
    if (sizeRow) sizeRow.style.display = on ? "none" : "";
    if (srRow) srRow.style.display = on ? "" : "none";
    if (scRow) scRow.style.display = on ? "" : "none";
    const btn = document.getElementById("freeRectToggle");
    if (btn) {
        btn.textContent = on ? "⤢ 恢复正方形" : "⤢ 单独设置行列";
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
}

/**
 * 切换自由模式的矩形棋盘模式：展开时行 / 列从当前边长复制并显示两行，
 * 收起时行 / 列回到边长并隐藏两行（矩形尺寸不保留）。
 * @param {boolean} [expanded] 目标状态；省略表示在两种模式间取反
 * @sideeffect 改写 freeRectExpanded / SR / SC 与面板显隐、按钮文案，脱离预设难度
 */
function toggleFreeRect(expanded) {
    freeRectExpanded = typeof expanded === "boolean" ? expanded : !freeRectExpanded;
    // 两种状态都以 S 为正方形基准：展开时用边长初始化行 / 列，收起时拉回边长
    SR = S;
    SC = S;
    syncFreeParamDisplays();
    syncFreeRectPanel();
    AudioFX.pop();
    // 参数形态被手动调整后即脱离预设难度
    diff = null;
}
window.toggleFreeRect = toggleFreeRect;

/**
 * 调整自由模式的一个棋盘参数，并按 LIMIT 与当前棋盘动态收敛相关参数。
 * 动态上限：总雷数不超过 SR×SC；地雷种类数不超过 min(26, 总雷数)。
 * @param {string} key 参数名：size / sr / sc / total / kinds
 * @param {number} dir 增量，通常为 +1 或 -1
 * @sideeffect 写入 S / SR / SC / T / K，刷新参数显示并脱离预设难度
 */
function setVal(key, dir) {
    const bounds = LIMIT[key];
    // 只接受面板里的五个参数：未知 key 直接忽略，防止误改其它状态
    if (!bounds) return;
    let max = bounds[1];
    if (key === "total") max = Math.min(max, Math.max(1, SR * SC));
    else if (key === "kinds") max = Math.min(max, Math.max(1, Math.min(26, T)));
    let cur;
    if (key === "size") cur = S;
    else if (key === "sr") cur = SR;
    else if (key === "sc") cur = SC;
    else if (key === "total") cur = T;
    else cur = K;
    const val = Math.max(bounds[0], Math.min(max, cur + dir));
    if (key === "size") {
        S = val;
        // 收起矩形模式时边长同时决定行列；展开时该行不可见，S 只作为
        // 收起时的基准值保留，不会改动已单独设置的行 / 列
        if (!freeRectExpanded) {
            SR = val;
            SC = val;
        }
    } else if (key === "sr") SR = val;
    else if (key === "sc") SC = val;
    else if (key === "total") T = val;
    else K = val;
    // 行列变化后面积可能变小：总雷数与种类数统一按新面积再收敛一次
    T = Math.max(1, Math.min(T, Math.max(1, SR * SC)));
    K = Math.max(1, Math.min(K, 26, T));
    syncFreeParamDisplays();
    AudioFX.pop();
    // 参数被手动修改后即脱离预设难度
    diff = null;
}

/**
 * 应用当前参数并开始新局：自由模式先收敛参数再直接开局，
 * 预设难度保持原有流程，先进入待开始状态。
 * @sideeffect 关闭难度弹窗并调用 newGame / beginPresetGame
 */
function applySet() {
    AudioFX.confirm();
    closeDifficultyModal();
    if (isFreeMode) {
        // 开局前再收敛一次：面板参数可能被脚本或旧状态改动过，
        // 交给 00-core 统一保证 T ≤ SR×SC、K ≤ min(26, T)
        applyBoardParams({
            size: S,
            // 收起矩形模式时以边长为准；展开时才采用单独设置的行 / 列
            rows: freeRectExpanded ? SR : S,
            cols: freeRectExpanded ? SC : S,
            total: T,
            kinds: K
        });
        diff = "free";
        newGame();
        return;
    }
    SP = Math.min(SP, T);
    TY = Math.min(TY, SP);
    if (isPresetPending && pendingDiff) {
        beginPresetGame();
    } else {
        newGame();
    }
}

/**
 * 通关结算：记录本局用时、最快纪录与通关次数，并检查脑王解锁条件。
 * 硬核与俄罗斯方块模式的成绩分别写入独立的持久化键组，与普通成绩互不覆盖；
 * 地狱通关次数在脑王门槛判定时合并计算。
 * @sideeffect 写入 lt / rec / wins（或硬核 / 俄罗斯方块三组）并持久化，刷新成绩列表
 */
function saveRec() {
    if (!diff) return;
    // 自由模式没有固定难度，不参与成绩统计
    if (isFreeMode) {
        renderRecordList();
        return;
    }
    const _ms = RM.timer.ms();
    // 俄罗斯方块局单独记账：普通与硬核成绩保持不变，也不触发脑王解锁提示
    if (gameTetris) {
        try {
            tetLt[diff] = _ms;
            Store.set("mineTetrisLastTimes", JSON.stringify(tetLt));
            // 只有比历史最快更短才刷新纪录
            if (tetRec[diff] === null || _ms < tetRec[diff]) {
                tetRec[diff] = _ms;
                Store.set("mineTetrisRecords", JSON.stringify(tetRec));
            }
            tetWins[diff] = (tetWins[diff] || 0) + 1;
            Store.set("mineTetrisWins", JSON.stringify(tetWins));
        } catch (e) {
            if (window.RM) RM.warn("saveRec", e);
        }
        renderRecordList();
        return;
    }
    // 用开局快照判定：本局硬核才写硬核成绩，中途切换偏好不改变本局记账口径
    if (gameHardcore) {
        // 硬核局单独记账：普通难度的通关次数与最快纪录保持不变
        hcLt[diff] = _ms;
        Store.save("mineHardcoreLastTimes", hcLt);
        if (hcRec[diff] === null || _ms < hcRec[diff]) {
            hcRec[diff] = _ms;
            Store.save("mineHardcoreRecords", hcRec);
        }
        hcWins[diff] = (hcWins[diff] || 0) + 1;
        Store.save("mineHardcoreWins", hcWins);
    } else {
        lt[diff] = _ms;
        Store.save("mineLastTimes", lt);
        // 只有比历史最快更短才刷新纪录
        if (rec[diff] === null || _ms < rec[diff]) {
            rec[diff] = _ms;
            Store.save("mineRecords", rec);
        }
        wins[diff] = (wins[diff] || 0) + 1;
        Store.save("mineWins", wins);
    }
    renderRecordList();
    // 地狱通关（普通或硬核）都可能凑满脑王门槛，统一在门槛函数里合并计数
    if (diff === "hell" && !brainUnlockedNotified) {
        if (checkBrainUnlocked()) {
            brainUnlockedNotified = true;
            Store.set("brainUnlockedNotified", "true");
            // 延时弹出：先让玩家看完地狱难度的通关反馈，再提示脑王解锁
            setTimeout(() => {
                document.getElementById("overlay").style.display = "block";
                document.getElementById("brainUnlockedModal").style.display = "block";
                AudioFX.modalOpen();
            }, 1500);
        }
    }
}

/**
 * 把毫秒耗时格式化为 mm:ss.cc，用于成绩列表展示。
 * @param {number|null} ms 毫秒数
 * @returns {string} 格式化后的时间，无纪录时返回"暂无纪录"
 */
function fmtTime(ms) {
    if (ms == null) return "暂无纪录";
    return `${String(Math.floor(ms / 6e4)).padStart(2, "0")}:${String(Math.floor(ms / 1e3) % 60).padStart(2, "0")}.${String(Math.floor(ms % 1e3 / 10)).padStart(2, "0")}`;
}

// 成绩列表的展示顺序：由易到难
const RECORD_DIFFS = [ "easy", "medium", "hard", "hell", "brain" ];

// 成绩筛选模式：all = 全部（普通 + 硬核 + 俄罗斯方块），其余只显示单一玩法。
// 仅本次会话有效，不写存档，刷新页面后回到「全部」。
let recordFilter = "all";

// 允许的成绩筛选模式，与 index.html 里 .record-filter-tab 的 data-mode 一一对应
const RECORD_FILTER_MODES = [ "all", "classic", "hardcore", "tetris" ];

// 各难度的图标与主题色：图标用于标签，颜色用于条目左侧的色条
const RECORD_META = {
    easy: {
        icon: "😎",
        color: "#38a169"
    },
    medium: {
        icon: "😮",
        color: "#dc7f33"
    },
    hard: {
        icon: "😤",
        color: "#d73a3a"
    },
    hell: {
        icon: "👿",
        color: "#6b21a8"
    },
    brain: {
        icon: "🤯",
        color: "#ffd700"
    }
};

/**
 * 把成绩筛选标签的 active 状态同步为 recordFilter。
 *
 * 标签由 index.html 的 #recSection 提供：按钮带 record-filter-tab 类与
 * data-mode（all / classic / hardcore / tetris）。节点缺失时静默跳过，
 * 保证成绩列表的渲染不依赖标签是否已经接入页面。
 * @sideeffect 切换 .record-filter-tab 的 active 类并同步 aria-selected
 */
function syncRecordFilterTabs() {
    document.querySelectorAll(".record-filter-tab").forEach(btn => {
        const on = btn.getAttribute("data-mode") === recordFilter;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
    });
}

/**
 * 切换成绩筛选模式并立即重绘成绩列表。
 * @param {string} mode 筛选模式：all / classic / hardcore / tetris，非法值忽略
 * @sideeffect 改写 recordFilter、同步标签状态并重绘成绩列表
 */
function setRecordFilter(mode) {
    if (RECORD_FILTER_MODES.indexOf(mode) < 0) return;
    recordFilter = mode;
    syncRecordFilterTabs();
    renderRecordList();
}
window.setRecordFilter = setRecordFilter;

/**
 * 读取某难度的通关次数，数据层缺失时按 0 处理。
 * @param {Object|null} data 次数对象（wins / hcWins / tetWins）
 * @param {string} diffKey 难度键
 * @returns {number} 非负整数
 */
function recordWinCount(data, diffKey) {
    if (!data) return 0;
    const n = Number(data[diffKey]);
    return isFinite(n) && n > 0 ? n : 0;
}

/**
 * 读取某难度的用时记录，数据层缺失时返回 null。
 * @param {Object|null} data 用时对象（rec / lt 及其硬核、俄罗斯方块变体）
 * @param {string} diffKey 难度键
 * @returns {number|null} 毫秒数；无记录返回 null
 */
function recordTimeValue(data, diffKey) {
    if (!data) return null;
    const v = data[diffKey];
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
}

/**
 * 生成成绩卡内的玩法子行：硬核与俄罗斯方块共用同一套结构与样式。
 * @param {string} cls 子行修饰类：record-hc / record-tet
 * @param {string} label 子行标签
 * @param {number} count 通关次数
 * @param {number|null} best 最快用时
 * @param {number|null} last 最近一次用时
 * @returns {string} 子行 HTML
 */
function recordSubRowHtml(cls, label, count, best, last) {
    let html = `<div class="${cls}">`;
    html += `<div class="record-row">`;
    html += `<span class="record-label">${label}</span>`;
    html += `<span class="record-badge">${count} 次</span>`;
    html += `</div>`;
    html += `<div class="record-meta">`;
    html += `<span>最快 <b class="record-best">${fmtTime(best)}</b></span>`;
    html += `<span>本次 <b class="record-current">${fmtTime(last)}</b></span>`;
    html += `</div>`;
    html += `</div>`;
    return html;
}

/**
 * 渲染「📝记录」栏的成绩列表：按当前筛选标签逐难度显示成绩。
 *
 * 条目结构与「挑战」面板统一：每行一张浅灰圆角卡，顶部一行是
 * 难度名 + 通关次数徽标，下面一行是「最快」与最近一次用时两项数据。
 * 筛选模式（recordFilter）决定卡片展示哪套数据：
 *   all      普通成绩为主行，有硬核 / 俄罗斯方块成绩时在同一张卡内追加
 *            虚线分隔的「🪚 硬核」/「🧱 俄罗斯方块」子行，没有则不显示；
 *   classic  只显示普通成绩；
 *   hardcore 用硬核成绩渲染，标签带 🪚；
 *   tetris   用俄罗斯方块成绩渲染，标签带 🧱。
 * 后三种模式始终列出全部难度，没有成绩的难度以占位文案展示。
 * 列宽与字号与挑战条目一致。
 * @sideeffect 重写 #achRecordList 的 innerHTML，同步标签状态并更新折叠摘要
 */
function renderRecordList() {
    const list = document.getElementById("achRecordList");
    // 挑战面板与成绩列表同属「📝记录」栏：成绩节点缺失时也要刷新挑战面板
    if (!list) {
        renderChallengeList();
        return;
    }
    // 成绩数据由 01-storage 派生，降级时可能缺失：统一做一次安全引用
    const hcWinsData = typeof hcWins !== "undefined" ? hcWins : null;
    const hcRecData = typeof hcRec !== "undefined" ? hcRec : null;
    const hcLtData = typeof hcLt !== "undefined" ? hcLt : null;
    const tetWinsData = typeof tetWins !== "undefined" ? tetWins : null;
    const tetRecData = typeof tetRec !== "undefined" ? tetRec : null;
    const tetLtData = typeof tetLt !== "undefined" ? tetLt : null;
    // 折叠期间标签状态可能变化，渲染时顺带把 active 类对齐
    syncRecordFilterTabs();
    let html = "";
    let totalWins = 0;
    RECORD_DIFFS.forEach(d => {
        // 脑王以外的难度共用默认元数据，避免难度扩展后出现空图标
        const meta = RECORD_META[d] || {
            icon: "💣",
            color: "#cbd5e0"
        };
        const label = DIFF_LABEL[d] || d;
        // 主行默认展示普通成绩；硬核 / 俄罗斯方块模式整体替换为对应玩法数据
        let rowWins = wins[d] || 0;
        let rowRec = rec[d];
        let rowLt = lt[d];
        let rowLabel = `${meta.icon}${label}`;
        if (recordFilter === "hardcore") {
            rowWins = recordWinCount(hcWinsData, d);
            rowRec = recordTimeValue(hcRecData, d);
            rowLt = recordTimeValue(hcLtData, d);
            rowLabel = "🪚 " + label;
        } else if (recordFilter === "tetris") {
            rowWins = recordWinCount(tetWinsData, d);
            rowRec = recordTimeValue(tetRecData, d);
            rowLt = recordTimeValue(tetLtData, d);
            rowLabel = "🧱 " + label;
        }
        totalWins += rowWins;
        // 追加 diff-<难度> 供成绩栏难度配色使用；brain 同时保留
        // is-brain，兼容既有样式 / 选择器引用
        html += `<div class="record-item diff-${d}${d === "brain" ? " is-brain" : ""}">`;
        html += `<div class="record-row">`;
        html += `<span class="record-label">${rowLabel}</span>`;
        html += `<span class="record-badge">${rowWins} 次</span>`;
        html += `</div>`;
        html += `<div class="record-meta">`;
        html += `<span>最快 <b class="record-best">${fmtTime(rowRec)}</b></span>`;
        html += `<span>本次 <b class="record-current">${fmtTime(rowLt)}</b></span>`;
        html += `</div>`;
        // 「全部」模式：玩法成绩不单独成卡，只在该难度通关过时追加子行
        if (recordFilter === "all") {
            const hcWin = recordWinCount(hcWinsData, d);
            if (hcWin > 0) {
                totalWins += hcWin;
                html += recordSubRowHtml("record-hc", "🪚 硬核", hcWin,
                    recordTimeValue(hcRecData, d), recordTimeValue(hcLtData, d));
            }
            const tetWin = recordWinCount(tetWinsData, d);
            if (tetWin > 0) {
                totalWins += tetWin;
                html += recordSubRowHtml("record-tet", "🧱 俄罗斯方块", tetWin,
                    recordTimeValue(tetRecData, d), recordTimeValue(tetLtData, d));
            }
        }
        html += `</div>`;
    });
    list.innerHTML = html;
    // 折叠标题摘要：收起时也能看到当前筛选下的累计通关次数
    const hint = document.getElementById("recSectionHint");
    if (hint) hint.textContent = totalWins > 0 ? "累计 " + totalWins + " 次" : "暂无记录";
    // 挑战完成情况与成绩同属「📝记录」栏，随成绩一起刷新
    renderChallengeList();
}

/* ---------- 11.1 挑战完成情况面板 ---------- */
/*
 * 存档键说明：挑战完成情况直接复用现有存档键，不引入任何额外的持久化字段——
 *   teachFinished        新手教学是否完成（"true" / 缺失）
 *   tutorialStep         基础挑战已通关关数 "0".."5"
 *   tutorial_<cat>       各系列挑战已通关关数 "0".."5"
 *   tutorialCompleted    基础挑战完成标记（兼容已有存档，与 tutorialStep>=5 等价）
 *   seriesUnlocked[cat]  系列是否解锁（内存态，基础系列恒为 true）
 * 因此本面板只做「读取 + 渲染」，不写存档、不改动任何玩法逻辑。
 */

/**
 * 挑战面板的展示顺序：新手教学 → 基础挑战 → 五个系列挑战。
 * 系列行的中文名与图标优先取全局 CATEGORY，取不到时退回这里的兜底值。
 */
const CHALLENGE_PANEL_ROWS = [ {
    key: "teach",
    icon: "🧐",
    fallbackName: "教程"
}, {
    key: "basic",
    icon: "💣",
    fallbackName: "基础挑战"
}, {
    key: "special",
    icon: "🔶",
    fallbackName: "异形系列"
}, {
    key: "physics",
    icon: "☢️",
    fallbackName: "物理律系列"
}, {
    key: "poker",
    icon: "🃏",
    fallbackName: "扑克牌系列"
}, {
    key: "symmetry",
    icon: "‼️",
    fallbackName: "对称系列"
}, {
    key: "tactical",
    icon: "🔫",
    fallbackName: "战术系列"
} ];

// 教学总关卡数：与 09-tutorial 的 TEACH_LEVELS.length（12）一致。
// 教学只持久化「是否完成」，没有逐关进度，因此这里仅用于展示 12/12。
const CHALLENGE_TEACH_TOTAL = 12;

/**
 * 转义要拼进 innerHTML 的文本，作为展示层的防御性处理（数据来自固定表）。
 * @param {*} v 待转义的值
 * @returns {string} 已转义的文本
 */
function escapeChallengeHtml(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * 渲染「🎯挑战」弹窗里的挑战完成情况面板。
 *
 * 每行展示名称、状态徽标、进度条与右侧的练习 / 挑战入口，状态分三档：
 *   ✅ 已完成  教学 teachFinished；基础挑战 tutorialCompleted 或 step>=5；
 *              系列挑战 seriesUnlocked[cat] 或 step>=5
 *   🕹️ 进行中  未完成但 step>0，徽标带 n/5
 *   🔒 未解锁  基础挑战未完成时五个系列统一锁定；教学未完成显示「未完成」；
 *              门禁已开放但 step=0 的项显示「未开始 0/5」
 *
 * 右侧按钮的行为：基础挑战行 未完成显示「基础挑战」并进入基础挑战（写进度），
 * 完成显示「练习」并进入练习；系列行 未解锁显示「挑战」/ 解锁后显示
 * 「练习」。教学行没有对应入口，只展示进度。
 *
 * 进度条宽度用内联百分比，布局类名由 style.css 统一定义
 * （.challenge-item / .challenge-row / .challenge-label / .challenge-state /
 *   .challenge-bar / .challenge-fill / .challenge-done / .challenge-active /
 *   .challenge-locked / .challenge-entry-btn）。
 * 容器 #challengeList 不存在时静默返回；每行带 data-key 供引导层定位。
 * @sideeffect 重写 #challengeList 的 innerHTML
 */
function renderChallengeList() {
    const box = document.getElementById("challengeList");
    if (!box) return;

    // 读取存档：任何一项异常都降级为「未完成 / 0 进度」，不让面板拖垮记录栏
    let teachFinished = false;
    let basicStep = 0;
    let basicCompleted = false;
    const seriesInfo = {};
    try {
        teachFinished = Store.get("teachFinished") === "true";
        basicStep = parseInt(Store.get("tutorialStep"), 10) || 0;
        // tutorialCompleted 是基础挑战完成标记，同时兼容只写了 step 的进度
        basicCompleted = Store.get("tutorialCompleted") === "true" || basicStep >= 5;
        [ "special", "physics", "poker", "symmetry", "tactical" ].forEach(cat => {
            seriesInfo[cat] = {
                step: parseInt(Store.get("tutorial_" + cat), 10) || 0,
                unlocked: !!seriesUnlocked[cat]
            };
        });
    } catch (e) {
        if (window.RM) RM.warn("renderChallengeList", e);
    }
    basicStep = Math.max(0, Math.min(5, basicStep));

    let html = "";
    CHALLENGE_PANEL_ROWS.forEach(row => {
        let icon = row.icon;
        let name = row.fallbackName;
        // 系列行（teach / basic 除外）优先使用 CATEGORY 的图标与中文名
        let cat = null;
        if (row.key !== "teach" && row.key !== "basic") {
            try {
                cat = typeof CATEGORY !== "undefined" && CATEGORY[row.key] ? CATEGORY[row.key] : null;
            } catch (e) {
                cat = null;
            }
        }
        if (cat) {
            icon = cat.emoji || icon;
            name = cat.name || name;
        }

        // 状态修饰类固定三选一：challenge-done / challenge-active / challenge-locked
        let mod = "challenge-locked";
        let badge = "未开始";
        let progress = "";
        let pct = 0;
        if (row.key === "teach") {
            if (teachFinished) {
                mod = "challenge-done";
                badge = "✅ 已完成";
                progress = CHALLENGE_TEACH_TOTAL + "/" + CHALLENGE_TEACH_TOTAL;
                pct = 100;
            } else {
                // 教学没有逐关存档，未完成时不猜进度，只提示「未完成」
                badge = "🔒 未完成";
            }
        } else if (row.key === "basic") {
            const step = basicCompleted ? 5 : basicStep;
            pct = Math.round(step / 5 * 100);
            progress = step + "/5";
            if (basicCompleted) {
                mod = "challenge-done";
                badge = "✅ 已完成";
            } else if (step > 0) {
                mod = "challenge-active";
                badge = "🕹️ 进行中";
            } else {
                badge = "未开始";
            }
        } else {
            const info = seriesInfo[row.key] || {
                step: 0,
                unlocked: false
            };
            const done = info.unlocked || info.step >= 5;
            const step = done ? 5 : Math.max(0, Math.min(5, info.step));
            if (!basicCompleted) {
                // 系列挑战门禁依赖基础挑战：未通关时五个系列统一显示未解锁
                badge = "🔒 未解锁";
                pct = 0;
            } else if (done) {
                mod = "challenge-done";
                badge = "✅ 已完成";
                progress = "5/5";
                pct = 100;
            } else if (step > 0) {
                mod = "challenge-active";
                badge = "🕹️ 进行中";
                progress = step + "/5";
                pct = Math.round(step / 5 * 100);
            } else {
                badge = "未开始";
                progress = "0/5";
                pct = 0;
            }
        }

        // 每行右侧的练习 / 挑战入口（教学行没有对应入口，不放按钮）
        // 基础挑战未完成时进入挑战，完成后才进入练习；练习走独立的练习入口：
        // 顶部改为「XX练习」+ 退出按钮，不写挑战进度
        let action = "";
        if (row.key === "basic") {
            // 未完成基础挑战时入口回到挑战（startTutorial），避免误入
            // 「基础练习」后挑战进度一直停在 0。startTutorial 不会收起挑战
            // 弹窗，这里与系列入口保持一致，补一次入口面板收起；
            // 完成判定与徽标 / 文案共用 basicCompleted，两者保持一致。
            const basicEntry = basicCompleted ? "openPracticeMode()" : "startTutorial();closeChallengeEntryPanels()";
            action = `<button class="challenge-entry-btn ${basicCompleted ? "is-practice" : "is-challenge"}" onclick="${basicEntry}">${basicCompleted ? "练习" : "基础挑战"}</button>`;
        } else if (row.key !== "teach") {
            const sInfo = seriesInfo[row.key] || { step: 0, unlocked: false };
            const sUnlocked = sInfo.unlocked || sInfo.step >= 5;
            const entry = sUnlocked ? `startCategoryPractice('${row.key}')` : `startCategoryTutorial('${row.key}')`;
            action = `<button class="challenge-entry-btn ${sUnlocked ? "is-practice" : "is-challenge"}" onclick="${entry}">${sUnlocked ? "练习" : "挑战"}</button>`;
        }
        const badgeText = progress ? badge + " " + progress : badge;
        html += `<div class="challenge-item" data-key="${row.key}">`;
        html += `<div class="challenge-row">`;
        html += `<span class="challenge-label">${escapeChallengeHtml(icon + " " + name)}</span>`;
        html += `<span class="challenge-state ${mod}">${escapeChallengeHtml(badgeText)}</span>`;
        html += action;
        html += `</div>`;
        html += `<div class="challenge-bar"><div class="challenge-fill" style="width:${pct}%"></div></div>`;
        html += `</div>`;
    });
    box.innerHTML = html;
}
window.renderChallengeList = renderChallengeList;

/* ---------- 12. 按钮音效委托与通关庆祝 ---------- */

/**
 * 全局委托：鼠标悬停在可交互按钮上时播放轻音效。
 * 使用捕获阶段统一监听，免去给每个按钮单独绑定；锁定与禁用的按钮不发声。
 */
document.addEventListener("mouseover", e => {
    let el = e.target;
    // 系列开关有自己的专属音效，这里跳过以免重复播放
    if (el.closest(".switch-toggle") || el.closest(".switch-row")) return;
    if (el.matches && el.matches("button, .preset-btn, .num-btn, .apply-btn, .game-sidebar-toggle, .setting-sidebar-toggle, .achievement-sidebar-toggle, .info-sidebar-toggle, .rule-sidebar-toggle, .challenge-entry-btn, .mine-item, .win button, .auto-modal button")) {
        if (el.classList.contains("disabled") || el.classList.contains("locked") || el.classList.contains("locked-row")) return;
        AudioFX.pop();
    }
}, true);

// 飘落动画的定时器句柄，停止时需要清掉
let _fallingInterval = null;

// 庆祝是否处于播放中：用于防止重复启动与生成回调自我续命
let _fallingActive = false;

// 飘落使用的 emoji 池：全部是与通关、庆祝相关的表情
const _FALLING_EMOJIS = [ "💣", "💡", "🎉", "🤯", "😎", "❤️", "🏆", "🎊", "🥳", "🤩", "🧐", "✌️", "💪", "🤙", "👌", "🤟", "👏", "🎖️", "👑" ];

// 飘落节点的数量上限，保证长时间庆祝时 DOM 规模有界
const _MAX_FALLING_NODES = 120;

/**
 * 开始飘落 emoji 庆祝：先补一批让画面立刻铺满，再按固定节奏持续生成。
 * @sideeffect 向 #fallingContainer 追加节点并注册定时器
 */
function startFallingEmoji() {
    const container = document.getElementById("fallingContainer");
    if (!container) return;
    if (_fallingActive) return;
    _fallingActive = true;
    /**
     * 从 DOM 中移除一个飘落节点。
     * @param {HTMLElement} el 待移除节点
     */
    function removeNode(el) {
        if (!el || !el.parentNode) return;
        el.parentNode.removeChild(el);
    }
    /**
     * 生成一个飘落 emoji：随机水平位置、尺寸与下落时长。
     */
    function spawnOne() {
        if (!_fallingActive) return;
        // 达到上限时移除最早生成的节点，实现先进先出的有界队列
        if (container.childElementCount >= _MAX_FALLING_NODES) {
            let oldest = container.firstElementChild;
            if (oldest) removeNode(oldest);
        }
        let span = document.createElement("span");
        span.className = "falling-emoji";
        span.textContent = _FALLING_EMOJIS[Math.floor(Math.random() * _FALLING_EMOJIS.length)];
        span.style.left = Math.random() * 100 + "%";
        let dur = (3 + Math.random() * 4).toFixed(2);
        span.style.animationDuration = dur + "s";
        span.style.animationDelay = "0s";
        span.style.fontSize = 20 + Math.random() * 20 + "px";
        // 动画结束即自删，不需要额外的清理逻辑
        span.addEventListener("animationend", () => removeNode(span), {
            once: true
        });
        container.appendChild(span);
    }
    // 首屏在 600ms 内随机补 40 个，让庆祝立刻铺满屏幕
    for (let i = 0; i < 40; i++) {
        setTimeout(spawnOne, Math.random() * 600);
    }
    // 之后按固定节奏补充，维持飘落密度
    _fallingInterval = setInterval(spawnOne, 180);
}

/**
 * 停止飘落庆祝并清空容器。
 * @sideeffect 清除定时器并清空 #fallingContainer
 */
function stopFallingEmoji() {
    _fallingActive = false;
    if (_fallingInterval) {
        clearInterval(_fallingInterval);
        _fallingInterval = null;
    }
    const container = document.getElementById("fallingContainer");
    if (container) container.innerHTML = "";
}

/**
 * 给 body 加上金色背景，60 秒后自动切回常规配色。
 * @sideeffect 添加并在 60 秒后移除 brain-golden 类
 */
function setGoldenBackground() {
    document.body.classList.add("brain-golden");
    setTimeout(() => {
        document.body.classList.remove("brain-golden");
    }, 6e4);
}

/* ---------- 13. 胜利判定 ---------- */

/**
 * 主棋盘通关判定：雷全部放完且每格影响值与目标完全一致时判定胜利。
 * 教学关卡有自己的过关逻辑，因此这里直接跳过。
 * 结算只允许发生一次：胜利后窗口缩放等重绘路径会再次调用 render → checkWin，
 * 用 winSettled 拦住重复记账；该标记由 10-game 的 fullReset 重置。
 * @sideeffect 停表并播放对应难度的通关反馈、写入成绩
 */
function checkWin() {
    if (teachActive) return;
    // 已经结算过的对局：直接返回，避免重复累加通关次数 / 覆盖纪录
    if (winSettled) return;
    // 两个条件缺一不可：雷的数量放满，且每格影响值与目标值逐格一致
    if (Object.keys(G.placed).length !== G.max) return;
    for (let r = 0; r < SR; r++) for (let c = 0; c < SC; c++) if (G.p[r][c] !== G.tar[r][c]) return;
    // 通过判定后立刻标记，后续任何重绘都不再进入结算流程
    winSettled = true;
    // 先停表再结算，保证记录的是通关瞬间的用时
    stopTi();
    if (isTutorialMode) {
        onTutorialWin();
        return;
    }
    if (isFreeMode) {
        AudioFX.win();
        document.getElementById("win").style.display = "flex";
        checkWinAchievements();
        return;
    }
    if (diff === "brain") {
        // 脑王有专属庆祝：飘落 emoji + 金色背景 + 独立通关弹窗
        AudioFX.winBrain();
        startFallingEmoji();
        setGoldenBackground();
        document.getElementById("win").style.display = "flex";
        document.getElementById("brainWinModal").style.display = "block";
        saveRec();
        try {
            Store.set("brainCleared", "true");
        } catch (e) {}
        applyBrainEgg();
    } else {
        AudioFX.win();
        saveRec();
        document.getElementById("win").style.display = "flex";
    }
    checkWinAchievements();
    // 题库码题目没有难度标记（diff 为空），通关后把四项关卡参数恢复成
    // 当前进度的标准档，避免下一局沿用分享题目的棋盘大小与雷数。放在成就判定
    // 之后执行：成就侧仍要用本局的 SR / SC 扫描题面数值。
    if (!diff && !isFreeMode) applyStandardParams();
}

/* ---------- 14. 各类弹窗的关闭函数 ---------- */

// 以下 closeXxx 函数统一作为弹窗的关闭入口：播放音效，再隐藏遮罩与对应弹窗，
// 供页面按钮的 onclick 直接调用；各函数只负责自己那一个弹窗。

/** 关闭"脑王已解锁"提示框。 */
function closeBrainUnlockedModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("brainUnlockedModal").style.display = "none";
}

/** 关闭"脑王未解锁"说明框。 */
function closeBrainLockedModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("brainLockedModal").style.display = "none";
    if (typeof guideRefresh === "function") guideRefresh();
}

/** 关闭脑王通关框，同时停止飘落庆祝与金色背景。 */
function closeBrainWinModal() {
    AudioFX.confirm();
    document.getElementById("brainWinModal").style.display = "none";
    stopFallingEmoji();
    document.body.classList.remove("brain-golden");
}

/** 关闭开场欢迎框。 */
function closeWelcomeModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("welcomeModal").style.display = "none";
    if (typeof guideRefresh === "function") guideRefresh();
}

/**
 * 关闭"挑战完成"弹窗：先切回标准参数并自动开一局新游戏，
 * 基础挑战完成后继续引导玩家前往系列挑战。
 * @sideeffect 把棋盘参数切回标准值、重置为普通对局，并可能打开进阶引导框
 */
function closeTutorialComplete() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("tutorialCompleteModal").style.display = "none";
    // 基础挑战完成（currentTutorialType 为空）后仍保留「更多关卡」引导；
    // 该判断必须放在 newGame 之前，newGame 内部的 fullReset 会清掉系列标记
    let wasBasic = !currentTutorialType;
    // 挑战关使用 T=5 的专属配比，结束后切回标准参数，
    // 避免下一局沿用 10×10 / 5 颗雷的挑战配置
    if (!isPresetDifficulty(diff)) applyStandardParams();
    isPracticeMode = false;
    // 点击完成弹窗后自动进行一次"新游戏"：棋盘、计时与记录都回到普通对局状态
    if (typeof newGame === "function") newGame();
    if (wasBasic) setTimeout(() => {
        document.getElementById("overlay").style.display = "block";
        document.getElementById("moreTutorialGuide").style.display = "block";
        AudioFX.modalOpen();
    }, 300);
    if (typeof guideRefresh === "function") guideRefresh();
}

/** 关闭"更多挑战"引导框。 */
function closeMoreTutorialGuide() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("moreTutorialGuide").style.display = "none";
    if (typeof guideRefresh === "function") guideRefresh();
}

/** 关闭普通难度未解锁说明框。 */
function closePresetLockedModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("presetLockedModal").style.display = "none";
    if (typeof guideRefresh === "function") guideRefresh();
}

/** 关闭地狱难度未解锁说明框。 */
function closeHellLockedModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("hellLockedModal").style.display = "none";
    if (typeof guideRefresh === "function") guideRefresh();
}

/* ---------- 15. 遮罩点击关闭策略 ---------- */

/**
 * 点击通用遮罩时的关闭策略：统一收起所有依附于遮罩的弹窗。
 * 遮罩由多个弹窗共用，点击空白处即视为关闭当前弹窗。
 * @sideeffect 隐藏遮罩及所有依附于遮罩的弹窗
 */
document.getElementById("overlay").addEventListener("click", () => {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("welcomeModal").style.display = "none";
    document.getElementById("tutorialPrompt").style.display = "none";
    document.getElementById("tutorialCompleteModal").style.display = "none";
    document.getElementById("moreTutorialGuide").style.display = "none";
    document.getElementById("presetLockedModal").style.display = "none";
    document.getElementById("hellLockedModal").style.display = "none";
    document.getElementById("brainUnlockedModal").style.display = "none";
    document.getElementById("brainLockedModal").style.display = "none";
    if (typeof guideRefresh === "function") guideRefresh();
});

/* ---------- 16. 全屏切换 ---------- */

/**
 * 取当前处于全屏的元素：优先标准属性，缺失时回退 WebKit / 旧 Edge 前缀。
 * @returns {Element|null} 全屏中的元素，未全屏时为 null
 */
function currentFullscreenElement() {
    return document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement || null;
}

/**
 * 取元素上的"进入全屏"方法：标准 API → WebKit → 旧 Edge 前缀。
 * @param {Element} el 目标元素
 * @returns {Function|null} 可用方法，不支持时返回 null
 */
function fullscreenRequestFn(el) {
    return el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen || null;
}

/**
 * 取文档上的"退出全屏"方法，同样按标准 → 前缀回退。
 * @returns {Function|null} 可用方法，不支持时返回 null
 */
function fullscreenExitFn() {
    return document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen || null;
}

/**
 * 同步右上角全屏按钮的图标 / 文案 / aria 状态，供全屏事件与启动时调用。
 * @sideeffect 改写 #fullscreenBtn 的内容与属性
 */
function syncFullscreenBtn() {
    var btn = document.getElementById("fullscreenBtn");
    if (!btn) return;
    var on = !!currentFullscreenElement();
    var icon = btn.querySelector(".rm-fs-icon");
    var label = btn.querySelector(".rm-fs-label");
    btn.classList.toggle("is-fullscreen", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", on ? "退出全屏" : "进入全屏");
    btn.title = on ? "退出全屏" : "进入全屏";
    // 进入全屏后用"重叠方框"表示退出，避免与普通状态混淆
    if (icon) icon.textContent = on ? "🗗" : "⛶";
    if (label) label.textContent = on ? "退出全屏" : "全屏";
}

/**
 * 点击右上角按钮：在「全屏 / 退出全屏」之间切换。
 * 浏览器不支持全屏（如 iPhone Safari）或拒绝请求时只做 toast 提示，
 * 不抛出异常、不影响游戏流程。
 * @sideeffect 请求或退出全屏，成功后由 fullscreenchange 事件同步按钮状态
 */
function toggleFullscreen() {
    var on = !!currentFullscreenElement();
    if (on) {
        var ex = fullscreenExitFn();
        if (!ex) return;
        try {
            var pr = ex.call(document);
            if (pr && typeof pr.catch === "function") pr.catch(function() {});
        } catch (e) {}
        return;
    }
    var req = fullscreenRequestFn(document.documentElement);
    if (!req) {
        if (window.RM && RM.toast) RM.toast("当前浏览器不支持全屏");
        try {
            AudioFX.locked();
        } catch (e) {}
        return;
    }
    try {
        var ret = req.call(document.documentElement);
        if (ret && typeof ret.catch === "function") {
            ret.catch(function() {
                if (window.RM && RM.toast) RM.toast("全屏被浏览器拒绝");
            });
        }
    } catch (e2) {
        if (window.RM && RM.toast) RM.toast("当前浏览器不支持全屏");
        return;
    }
    try {
        AudioFX.confirm();
    } catch (e3) {}
}
window.toggleFullscreen = toggleFullscreen;

// 全屏状态可能由 Esc / F11 / 系统手势改变，统一监听各厂商事件后同步按钮
[ "fullscreenchange", "webkitfullscreenchange", "MSFullscreenChange" ].forEach(function(ev) {
    document.addEventListener(ev, syncFullscreenBtn);
});
syncFullscreenBtn();

/* ---------- 17. 记录栏成绩跳转 ---------- */

/**
 * 从「难度🕹️」弹窗底部的成绩提示跳到「📝记录」栏的成绩区。
 * 依次完成：收起弹层 → 打开记录侧栏 → 展开默认折叠的成绩分区 → 滚进视野，
 * 最后写入引导标记，由 16-guide.js 用统一的高亮框 + 小手指出成绩位置。
 * @sideeffect 关闭弹窗、切换侧栏 open 类、展开 recSection、写入引导标记
 */
function gotoRecordScores() {
    try {
        AudioFX.confirm();
    } catch (e) {}
    // 难度弹窗与其它弹层先收起，避免挡住记录侧栏
    if (typeof closeAllModals === "function") closeAllModals();
    closeSidebarsExcept("achSidebar");
    var sb = document.getElementById("achSidebar");
    if (sb) sb.classList.add("open");
    // 成绩区默认折叠：跳过来时自动展开一次，让玩家直接看到成绩
    var rec = document.getElementById("recSection");
    if (rec && !rec.classList.contains("record-acc-open") && typeof toggleRecordAcc === "function") {
        toggleRecordAcc("recSection");
    }
    // 标记跳转来源：引导层据此把高亮环与小手放到成绩区
    window._guideRecordScores = true;
    // 玩家已经在看成绩，门槛类引导让位给这条更具体的引导
    window._guideLockedSeries = null;
    window._guideLockedDifficulty = null;
    try {
        if (typeof renderRecordList === "function") renderRecordList();
    } catch (e2) {}
    // 等侧栏滑入动画开始后再滚动，避免滚动位置被动画重置
    setTimeout(function() {
        try {
            if (rec && rec.scrollIntoView) rec.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (e3) {}
    }, 80);
    if (typeof guideRefresh === "function") {
        guideRefresh();
        setTimeout(guideRefresh, 320);
    }
}
window.gotoRecordScores = gotoRecordScores;

/* ---------- 17.1 信息栏炸弹信息跳转 ---------- */

/**
 * 从「难度🕹️」弹窗系列开关板块底部的提示跳到「🧭信息」栏的炸弹信息。
 * 依次完成：收起弹层 → 打开信息侧栏 → 让炸弹信息分区滚进视野，
 * 最后写入引导标记，由 16-guide.js 用统一的高亮框 + 小手指出位置。
 * @sideeffect 关闭弹窗、切换侧栏 open 类、展开炸弹信息分区、写入引导标记
 */
function gotoMineInfo() {
    try {
        AudioFX.confirm();
    } catch (e) {}
    // 难度弹窗与其它弹层先收起，避免挡住信息侧栏
    if (typeof closeAllModals === "function") closeAllModals();
    closeSidebarsExcept("infoSidebar");
    var sb = document.getElementById("infoSidebar");
    if (sb) sb.classList.add("open");
    // 炸弹信息分区常驻展开：这里只保证它处于展开态，不做收起
    var mine = document.getElementById("accMine");
    if (mine && !mine.classList.contains("rm-acc-open")) {
        mine.classList.remove("rm-acc-closed");
        mine.classList.add("rm-acc-open");
    }
    // 标记跳转来源：引导层据此把高亮环与小手放到炸弹信息分区
    window._guideMineInfo = true;
    // 玩家已经在看炸弹信息，门槛类与其它跳转类引导让位给这条更具体的引导
    window._guideLockedSeries = null;
    window._guideLockedDifficulty = null;
    // 等侧栏滑入动画结束后再滚动：直接改侧栏自身的 scrollTop 做相对滚动，
    // 不受抽屉 transform / 窄屏底部卡片定位影响。炸弹信息列表很长，
    // 只滚到分区顶部，保证标题与第一组雷种进入视野。
    setTimeout(function() {
        try {
            if (!sb || !mine) return;
            var delta = mine.getBoundingClientRect().top - sb.getBoundingClientRect().top - 10;
            if (Math.abs(delta) > 1) sb.scrollTop = Math.max(0, sb.scrollTop + delta);
            // 滚动后目标位置已变：重新刷新引导，让高亮环与气泡按新位置重新定位
            if (typeof guideRefresh === "function") guideRefresh();
        } catch (e2) {}
    }, 420);
    if (typeof guideRefresh === "function") {
        guideRefresh();
        setTimeout(guideRefresh, 320);
    }
}
window.gotoMineInfo = gotoMineInfo;

/* ---------- 18. 自由模式恢复默认参数 ---------- */

/**
 * 自由模式参数面板的「恢复默认」：按当前进度恢复标准参数
 * （四个原有系列挑战全解锁前 8×8/4/3 种，全解锁后 10×10/6/4 种，
 * 由 applyStandardParams 写入），与退出教学 / 创造后回到的标准档一致。
 * 同时收起矩形棋盘模式，行 / 列回到边长。
 * @sideeffect 改写 S/SR/SC/T/TY/SP/K 与面板显示，收起矩形模式，脱离预设难度
 */
function resetCustomParams() {
    applyStandardParams();
    // 恢复默认同样回到正方形棋盘：矩形展开状态与行 / 列设置一并清掉
    freeRectExpanded = false;
    SR = SC = S;
    syncFreeParamDisplays();
    syncFreeRectPanel();
    // 与 setVal 一致：参数被手动改动后即不属于任何预设难度
    diff = null;
    updatePresetButtons();
    try {
        AudioFX.confirm();
    } catch (e) {}
    if (window.RM && RM.toast) RM.toast("已恢复默认参数");
}
window.resetCustomParams = resetCustomParams;
