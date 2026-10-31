/* ==========================================================================
 * 模块 08 · 界面与弹窗（js/08-ui.js）
 *
 * 职责：管理侧边栏与信息栏折叠、难度弹窗与系列开关、成绩记录渲染、
 *       胜利判定与通关庆祝，以及所有弹窗的打开 / 关闭策略。
 * 依赖：00-core 的全局状态与工具（RM、G、diff、S / SR / SC）；01-storage 的
 *       Store 与成绩 / 系列状态（wins、rec、lt、seriesState）；02-audio 的
 *       AudioFX；04-mines 的 M / CATEGORY；06-render、07-board 提供的渲染与
 *       交互。
 * 对外：window.closeAllModals、window.syncMainPanel、window.gotoSeriesChallenge、
 *       window.onLockedSeriesClick、window.openChallengeModal 等界面入口。
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

// 常驻展开的折叠项：炸弹信息是进入系列挑战的唯一入口，任何情况下都不收起
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
        var cm = document.getElementById("challengeModal");
        if (cm) cm.style.display = "none";
        // 脑王通关框 / 教学完成框 / 胜利框
        [ "brainWinModal", "teachCompleteModal", "win" ].forEach(function(id) {
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
 * 把玩家送到炸弹信息里的指定系列：打开侧边栏、滚到对应分区，
 * 再由引导层用统一的高亮框指着该系列的「挑战」按钮。
 * @param {string} catKey 系列键（special / physics / symmetry / tactical 等）
 * @sideeffect 打开 infoSidebar、修改滚动位置，并激活该系列的引导
 */
function gotoSeriesChallenge(catKey) {
    var sb = document.getElementById("infoSidebar");
    if (!sb) return;
    // 保留/重设该系列标记：导航完成后由引导层指向「挑战」按钮
    window._guideLockedSeries = catKey;
    window._guideLockedDifficulty = null;
    // 先收掉所有弹窗，避免难度弹窗或确认框挡住目标分区
    closeAllModals();
    closeSidebarsExcept("infoSidebar");
    sb.classList.add("open");
    // 炸弹信息是常驻展开项，这里再确保一次展开状态
    var acc = document.getElementById("accMine");
    if (acc) {
        acc.classList.add("rm-acc-open");
        acc.classList.remove("rm-acc-closed");
    }
    var box = document.getElementById("mineInfoList");
    var target = box ? box.querySelector('.category-section[data-cat="' + catKey + '"]') : null;
    if (!target) {
        if (typeof guideRefresh === "function") guideRefresh();
        return;
    }
    // 先把分区滚进视口，再让引导层用与其它高亮一致的样式指向「挑战」按钮
    try {
        if (typeof target.scrollIntoView === "function") {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
        } else if (sb.scrollTop !== undefined && target.offsetTop !== undefined) {
            // 不支持 scrollIntoView 选项的浏览器退回手算滚动位置
            sb.scrollTop = Math.max(0, target.offsetTop - 40);
        }
    } catch (e) {}
    if (typeof guideRefresh === "function") guideRefresh();
    setTimeout(function() {
        if (typeof guideRefresh === "function") guideRefresh();
    }, 350);
}
window.gotoSeriesChallenge = gotoSeriesChallenge;

/**
 * 点击未解锁的系列开关时的引导：询问是否立刻前往该系列挑战。
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
            sub: "打开炸弹信息",
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
                gotoSeriesChallenge(catKey);
            }
        }
    });
    // 记下来源系列：确认框关掉后，引导会先指信息栏、再指该系列的挑战入口
    window._guideLockedSeries = catKey;
    // 玩家已经开始处理系列开关，难度门槛路线让位给这条更具体的引导
    window._guideLockedDifficulty = null;
    if (typeof guideRefresh === "function") guideRefresh();
}
window.onLockedSeriesClick = onLockedSeriesClick;

/* ---------- 7. 难度弹窗与底部按钮栏 ---------- */

/**
 * 打开难度弹窗：先收起所有侧边栏，再刷新系列开关与预设按钮状态。
 * @sideeffect 播放音效、收起侧边栏、显示 challengeModal
 */
function openChallengeModal() {
    AudioFX.confirm();
    closeSidebarsExcept(null);
    renderSeriesSwitches();
    updatePresetButtons();
    const m = document.getElementById("challengeModal");
    if (m) m.style.display = "block";
    if (typeof guideRefresh === "function") guideRefresh();
}

/**
 * 关闭难度弹窗。
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
    [ [ "infoSidebar", "toggleInfoSidebar" ], [ "achSidebar", "toggleAchSidebar" ], [ "createSidebar", "toggleCreateSidebar" ], [ "settingSidebar", "toggleSettingSidebar" ] ].forEach(([ id, btnId ]) => {
        const sb = document.getElementById(id);
        if (!sb || !sb.classList.contains("open")) return;
        const btn = document.getElementById(btnId);
        // 点在侧边栏内部、开关按钮上或模式跳转链接上时都不收起
        if (!sb.contains(e.target) && e.target !== btn && !modeLink) sb.classList.remove("open");
    });
});

/**
 * 全局委托：点击难度弹窗外部时关闭弹窗。
 * 点遮罩本身，或点卡片之外的空白都算"外部"；点开弹窗的入口按钮除外，
 * 否则同一次点击会先把紧接着打开的弹窗关掉。
 * @sideeffect 关闭 challengeModal
 */
document.addEventListener("click", function(e) {
    const m = document.getElementById("challengeModal");
    if (!m || m.style.display !== "block") return;
    const card = m.querySelector(".challenge-card");
    if (e.target === m) closeChallengeModal();
    else if (card && !card.contains(e.target) && e.target.closest && !e.target.closest("#challengeBtn")) closeChallengeModal();
});
/**
 * 键盘委托：Esc 关闭难度弹窗，作为鼠标关闭路径的键盘等价操作。
 */
document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") closeChallengeModal();
});

/* ---------- 9. 系列开关 ---------- */

/**
 * 渲染难度弹窗里的 5 个系列开关：锁状态、开关状态与解锁提示。
 * @sideeffect 重写 #seriesSwitchList 与 #seriesSwitchHint 的内容
 */
function renderSeriesSwitches() {
    const container = document.getElementById("seriesSwitchList");
    if (!container) return;
    let html = "";
    // 展示顺序固定，基础系列排第一且始终开启
    const catOrder = [ "basic", "special", "physics", "symmetry", "tactical" ];
    catOrder.forEach(catKey => {
        let unlocked = seriesUnlocked[catKey];
        let on = seriesState[catKey];
        let cat = CATEGORY[catKey];
        let lockEmoji = unlocked ? "🔓" : "🔒";
        html += `<div class="switch-row ${unlocked ? "unlocked" : "locked-row"}">`;
        html += `<div class="switch-label"><span class="lock-emoji">${lockEmoji}</span><span class="cat-name">${cat.emoji} ${cat.name}</span></div>`;
        if (catKey === "basic") {
            // 基础系列不可关闭：它是其余系列的前置条件
            html += `<div class="switch-toggle on" style="cursor:default;opacity:0.7"></div>`;
        } else {
            // 未解锁时点击不切换，而是弹出"前往挑战"的引导
            html += `<div class="switch-toggle ${on ? "on" : ""} ${unlocked ? "" : "disabled"}" onclick="event.stopPropagation();${unlocked ? "toggleSeries('" + catKey + "')" : "onLockedSeriesClick('" + catKey + "')"}"></div>`;
        }
        html += `</div>`;
    });
    container.innerHTML = html;
    let hint = document.getElementById("seriesSwitchHint");
    let onCount = getSeriesOnCount();
    if (onCount < 5) {
        hint.className = "switch-hint";
        let need = onCount < 3 ? "困难需<strong>≥3</strong>个 · 地狱/脑王需全开" : "困难可用✅ · 地狱/脑王需全开";
        hint.innerHTML = `已开启<strong> ${onCount}/5 </strong>个系列<br>${need}`;
    } else {
        hint.className = "switch-hint unlock-hint";
        let brainReady = (wins.hell || 0) >= BRAIN_HELL_WINS_REQ;
        hint.innerHTML = brainReady ? `全部 ${onCount}/5 已开启 ✅ 地狱 & 脑王均可挑战` : `全部 ${onCount}/5 已开启 ✅ 地狱可用<br>脑王需地狱通关<strong>${BRAIN_HELL_WINS_REQ}</strong>次`;
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
}

/**
 * 统计当前处于开启状态的系列数量。
 * @returns {number} 0~5 之间
 */
function getSeriesOnCount() {
    const knownKeys = [ "basic", "special", "physics", "symmetry", "tactical" ];
    return knownKeys.filter(k => seriesState[k] === true).length;
}

/**
 * 判断"脑王"是否已解锁：地狱通关达到指定次数且 5 个系列全开。
 * @returns {boolean} true 表示可以挑战脑王
 */
function checkBrainUnlocked() {
    let hellWins = wins.hell || 0;
    let seriesCount = getSeriesOnCount();
    return hellWins >= BRAIN_HELL_WINS_REQ && seriesCount >= 5;
}

/* ---------- 10. 难度预设 ---------- */

/**
 * 刷新难度按钮的锁定样式：困难需 3 个系列、地狱需 5 个、脑王另需通关次数；
 * 简单 / 中等不设系列门槛，方便新手直接开始。
 * @sideeffect 切换各难度按钮的 locked 类
 */
function updatePresetButtons() {
    let onCount = getSeriesOnCount();
    let hardLocked = onCount < 3;
    let hellLocked = onCount < 5;
    let brainLocked = !checkBrainUnlocked();
    // 简单 / 中等始终可用：入门难度不再受系列开关数量限制
    [ "btnEasy", "btnMedium" ].forEach(id => {
        let btn = document.getElementById(id);
        if (btn) btn.classList.remove("locked");
    });
    let btnHard = document.getElementById("btnHard");
    if (btnHard) {
        // 自由模式下难度由玩家自定，预设按钮不显示锁定态
        if (isFreeMode || !hardLocked) btnHard.classList.remove("locked");
        else btnHard.classList.add("locked");
    }
    let btnHell = document.getElementById("btnHell");
    if (btnHell) {
        if (isFreeMode) {
            btnHell.classList.remove("locked");
        } else if (hellLocked) btnHell.classList.add("locked"); else btnHell.classList.remove("locked");
    }
    let btnBrain = document.getElementById("btnBrain");
    if (btnBrain) {
        if (isFreeMode) {
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
    if (d === "hell") return onCount >= 5;
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
        document.getElementById("brainHellWins").textContent = wins.hell || 0;
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
    if (d !== "free") closeChallengeModal();
    fullReset();
    if (d === "free") {
        isFreeMode = true;
        diff = "free";
        window._guideLockedDifficulty = null;
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
    var slot = document.getElementById("slot");
    var teachBubble = document.getElementById("teachBubble");
    slot.innerHTML = "";
    // 教学气泡常驻在 slot 容器里，清空容器后要把它放回去
    if (teachBubble) slot.appendChild(teachBubble);
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
    document.getElementById("presetStartIcon").textContent = "👌";
    document.getElementById("presetStartTitle").textContent = "准备好了吗?";
    document.getElementById("presetStartDesc").textContent = "点击开始后题目将展现并启动计时(≧▽≦)";
    var tag = document.getElementById("presetStartTag");
    tag.className = "preset-start-tag tag-" + d;
    document.getElementById("presetStartTagText").textContent = labelMap[d] || d;
    document.getElementById("presetStartCard").style.display = "flex";
    AudioFX.modalOpen();
}

/* ---------- 11. 参数调整与成绩记录 ---------- */

/**
 * 调整自由模式的一个棋盘参数，并保证参数之间的约束不被破坏。
 * @param {string} key 参数名：size / total / type / spec
 * @param {number} dir 增量，通常为 +1 或 -1
 * @sideeffect 写入 S / SR / SC / T / TY / SP 并刷新面板数字
 */
function setVal(key, dir) {
    let [min, max] = LIMIT[key];
    let val = key === "size" ? S : key === "total" ? T : key === "type" ? TY : SP;
    val = Math.max(min, Math.min(max, val + dir));
    if (key === "size") {
        // 棋盘为正方形：边长同时决定行列数
        S = val;
        SR = val;
        SC = val;
    }
    if (key === "total") T = val;
    if (key === "type") TY = val;
    if (key === "spec") SP = val;
    // 三个参数互相约束：特殊雷不超过总雷数，特殊雷种类不超过特殊雷数量
    SP = Math.min(SP, T);
    TY = Math.min(TY, SP);
    document.getElementById("size").textContent = S;
    document.getElementById("total").textContent = T;
    document.getElementById("type").textContent = TY;
    document.getElementById("spec").textContent = SP;
    AudioFX.pop();
    // 参数被手动修改后即脱离预设难度
    diff = null;
}

/**
 * 应用当前参数并开始新局：自由模式直接开局，预设难度先进入待开始状态。
 * @sideeffect 关闭难度弹窗并调用 newGame / beginPresetGame
 */
function applySet() {
    AudioFX.confirm();
    closeChallengeModal();
    SP = Math.min(SP, T);
    TY = Math.min(TY, SP);
    if (isFreeMode) {
        diff = "free";
        newGame();
        return;
    }
    if (isPresetPending && pendingDiff) {
        beginPresetGame();
    } else {
        newGame();
    }
}

/**
 * 通关结算：记录本次用时、最快纪录与通关次数，并检查脑王解锁条件。
 * @sideeffect 写入 lt / rec / wins 并持久化，刷新成绩列表
 */
function saveRec() {
    if (!diff) return;
    // 自由模式没有固定难度，不参与成绩统计
    if (isFreeMode) {
        renderRecordList();
        return;
    }
    const _ms = RM.timer.ms();
    lt[diff] = _ms;
    Store.save("mineLastTimes", lt);
    // 只有比历史最快更短才刷新纪录
    if (rec[diff] === null || _ms < rec[diff]) {
        rec[diff] = _ms;
        Store.save("mineRecords", rec);
    }
    wins[diff] = (wins[diff] || 0) + 1;
    Store.save("mineWins", wins);
    renderRecordList();
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
 * 渲染成就栏里的成绩列表：逐难度显示最快用时、通关次数与本次用时。
 * @sideeffect 重写 #achRecordList 的 innerHTML
 */
function renderRecordList() {
    const list = document.getElementById("achRecordList");
    if (!list) return;
    let html = "";
    RECORD_DIFFS.forEach(d => {
        // 脑王以外的难度共用默认元数据，避免新增难度时出现空图标
        const meta = RECORD_META[d] || {
            icon: "💣",
            color: "#cbd5e0"
        };
        const label = DIFF_LABEL[d] || d;
        html += `<div class="record-item${d === "brain" ? " is-brain" : ""}" style="border-left-color:${meta.color}">`;
        html += `<div class="record-label">${meta.icon}${label}</div>`;
        html += `最快用时：<span class="record-best">${fmtTime(rec[d])}</span><br>`;
        html += `通关次数：<span class="record-count">${wins[d] || 0} 次</span><br>`;
        html += `本次用时：<span class="record-current">${fmtTime(lt[d])}</span>`;
        html += `</div>`;
    });
    list.innerHTML = html;
}

/* ---------- 12. 按钮音效委托与通关庆祝 ---------- */

/**
 * 全局委托：鼠标移入可交互按钮时播放轻音效。
 * 使用捕获阶段统一监听，免去给每个按钮单独绑定；锁定与禁用的按钮不发声。
 */
document.addEventListener("mouseover", e => {
    let el = e.target;
    // 系列开关有自己的专属音效，这里跳过以免重复播放
    if (el.closest(".switch-toggle") || el.closest(".switch-row")) return;
    if (el.matches && el.matches("button, .preset-btn, .num-btn, .apply-btn, .game-sidebar-toggle, .setting-sidebar-toggle, .achievement-sidebar-toggle, .info-sidebar-toggle, .rule-sidebar-toggle, .tutorial-btn-inline, .mine-item, .win button, .auto-modal button")) {
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
 * @sideeffect 停表并播放对应难度的通关反馈、写入成绩
 */
function checkWin() {
    if (teachActive) return;
    // 两个条件缺一不可：雷的数量放满，且每格影响值与目标值逐格一致
    if (Object.keys(G.placed).length !== G.max) return;
    for (let r = 0; r < SR; r++) for (let c = 0; c < SC; c++) if (G.p[r][c] !== G.tar[r][c]) return;
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
}

/**
 * 关闭"挑战完成"弹窗；基础挑战完成后继续引导玩家前往系列挑战。
 * @sideeffect 可能把棋盘参数切回标准值，并打开进阶引导框
 */
function closeTutorialComplete() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("tutorialCompleteModal").style.display = "none";
    // 挑战关使用 T=5 的专属配比，结束后切回标准参数，
    // 避免下一局沿用 10×10 / 5 颗雷的挑战配置
    if (!isPresetDifficulty(diff)) applyStandardParams();
    if (!currentTutorialType) setTimeout(() => {
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
 * 点击通用遮罩时的关闭策略：教学规则弹窗优先处理，其余弹窗统一收起。
 * 遮罩是多个弹窗共用的，这里需要按优先级逐个判断，避免误关教学规则。
 * @sideeffect 隐藏遮罩及所有依附于遮罩的弹窗
 */
document.getElementById("overlay").addEventListener("click", () => {
    AudioFX.confirm();
    let ruleModal = document.getElementById("teachRuleModal");
    // 教学规则弹窗独占遮罩：点遮罩只关它，不连带关闭其它弹窗
    if (ruleModal && ruleModal.style.display === "block") {
        hideTeachRuleModal();
        return;
    }
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
