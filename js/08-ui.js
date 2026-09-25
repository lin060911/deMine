/* ==========================================================================
 * 反向扫雷 · 08-ui.js
 * 职责：侧边栏、系列开关、难度预设、成绩记录、庆祝特效、胜利判定、弹窗
 * ========================================================================== */

function closeSidebarsExcept(keepId) {
    [ "infoSidebar", "achSidebar", "createSidebar", "settingSidebar" ].forEach(id => {
        if (id === keepId) return;
        const el = document.getElementById(id);
        if (el) el.classList.remove("open");
    });
}

document.getElementById("toggleInfoSidebar").onclick = () => {
    AudioFX.confirm();
    const infoSb = document.getElementById("infoSidebar");
    const willOpen = !infoSb.classList.contains("open");
    closeSidebarsExcept("infoSidebar");
    infoSb.classList.toggle("open", willOpen);
};

document.getElementById("toggleCreateSidebar").onclick = () => {
    AudioFX.confirm();
    const createSb = document.getElementById("createSidebar");
    const willOpen = !createSb.classList.contains("open");
    closeSidebarsExcept("createSidebar");
    createSb.classList.toggle("open", willOpen);
    if (willOpen) prepareCreateParams();
};

/* ---- 信息栏折叠部件：规则信息 / 炸弹信息 ---- */
/* 常驻展开的部件（炸弹信息是解锁系列的唯一入口，永远保持展开） */
const ACC_ALWAYS_OPEN = ["accMine"];

function toggleAcc(id) {
    const el = document.getElementById(id);
    if (!el) return;
    // 常驻展开的部件：点了也不收起，只给个音效反馈
    if (ACC_ALWAYS_OPEN.indexOf(id) >= 0) {
        el.classList.add("rm-acc-open", "rm-acc-fixed");
        el.classList.remove("rm-acc-closed");
        AudioFX.pop();
        return;
    }
    const willOpen = !el.classList.contains("rm-acc-open");
    // 同一栏内手风琴：展开一个就收起另一个（常驻项除外）
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

/* ---- 通用确认弹窗（运行时注入，不改 index.html） ----
   opt = { icon, title, body, buttons:[{label,cls,act}], onAction(act) } */
var _rmConfirm = { el: null, ov: null, cb: null };

function ensureConfirmModal() {
    if (_rmConfirm.el) return;
    // 自带一份样式：不依赖导入弹窗是否注入过（15-boot.js 是按需注入的）
    if (!document.getElementById("rmConfirmStyle")) {
        var st = document.createElement("style");
        st.id = "rmConfirmStyle";
        st.textContent = [
            ".rm-btn-row{display:flex;gap:10px;margin-top:12px;}",
            "button.rm-btn{flex:1;padding:11px 6px!important;border-radius:10px!important;",
            "border:3px solid transparent!important;background-image:none;color:#fff!important;",
            "font-weight:700;font-size:15px;cursor:pointer;line-height:1.3;display:block;margin:0;",
            "transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .2s;",
            "box-shadow:0 2px 6px rgba(0,0,0,.12);}",
            "button.rm-btn:hover{transform:scale(1.05);box-shadow:0 8px 20px rgba(0,0,0,.2);}",
            "button.rm-btn b{display:block;font-size:15px;}",
            "button.rm-btn small{display:block;font-size:11px;font-weight:600;opacity:.9;margin-top:2px;}",
            ".rm-btn-primary{background:linear-gradient(180deg,#4299e1,#2b7ac4)!important;border-color:#63b3ed!important;}",
            ".rm-btn-merge{background:linear-gradient(180deg,#34dca0,#1ab883)!important;border-color:#6ef0c0!important;}",
            ".rm-btn-cancel{background:linear-gradient(180deg,#a0aec0,#718096)!important;border-color:#cbd5e0!important;}",
            /* 置顶：难度弹窗是 1200，这里必须更高，否则会被挡住 */
            ".rm-confirm-overlay{z-index:1300!important;}",
            ".rm-confirm-modal{z-index:1301!important;}"
        ].join("\n");
        document.head.appendChild(st);
    }
    var ov = document.createElement("div");
    ov.className = "auto-modal-overlay rm-confirm-overlay";
    ov.style.display = "none";
    document.body.appendChild(ov);
    var el = document.createElement("div");
    el.className = "auto-modal rm-confirm-modal";
    el.style.display = "none";
    document.body.appendChild(el);
    ov.addEventListener("click", closeConfirmModal);
    el.addEventListener("click", function(e) {
        var b = e.target && e.target.closest ? e.target.closest("button[data-act]") : null;
        if (!b) return;
        // 别让冒泡到 document 的"点外面就关侧栏"处理器把刚打开的侧栏又关掉
        if (e.stopPropagation) e.stopPropagation();
        var act = b.getAttribute("data-act");
        var cb = _rmConfirm.cb;
        closeConfirmModal();
        if (cb) cb(act);
    });
    _rmConfirm.ov = ov;
    _rmConfirm.el = el;
}

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

function closeConfirmModal() {
    if (_rmConfirm.ov) _rmConfirm.ov.style.display = "none";
    if (_rmConfirm.el) _rmConfirm.el.style.display = "none";
    _rmConfirm.cb = null;
}
window.closeConfirmModal = closeConfirmModal;

/* ---- 统一关闭所有弹窗与遮罩 ----
   从弹窗里跳转去别处（信息栏 / 开始挑战）时，必须把当前开着的
   难度弹窗、通用遮罩、胜利框等一并收掉，否则跳转后被旧弹窗盖住。 */
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

/* ---- 主按钮条（新游戏/清空放置/教学/难度）显隐 ----
   原来只在 openTeachMode 里隐藏、teachExit 里恢复，两处硬编码。
   一旦用其它路径离开教学（例如教学途中从炸弹信息进系列挑战），
   主按钮就再也不会回来。现在改成由 teachActive 统一推导，
   并在 fullReset 里兜底同步 —— 任何模式切换都会经过 fullReset。 */
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

/* ---- 基础挑战是否已完成（系列挑战的前置门禁） ---- */
function isBasicChallengeDone() {
    try {
        return Store.get("tutorialCompleted") === "true";
    } catch (e) {
        return false;
    }
}
window.isBasicChallengeDone = isBasicChallengeDone;

/* ---- 跳转到炸弹信息里某个系列：开栏 → 滚动 → 高亮闪烁 ---- */
function gotoSeriesChallenge(catKey) {
    var sb = document.getElementById("infoSidebar");
    if (!sb) return;
    closeAllModals();
    closeSidebarsExcept("infoSidebar");
    sb.classList.add("open");
    // 炸弹信息是常驻展开的，这里兜底确保一次
    var acc = document.getElementById("accMine");
    if (acc) {
        acc.classList.add("rm-acc-open");
        acc.classList.remove("rm-acc-closed");
    }
    var box = document.getElementById("mineInfoList");
    var target = box ? box.querySelector('.category-section[data-cat="' + catKey + '"]') : null;
    if (!target) return;
    Array.prototype.forEach.call(box.querySelectorAll(".category-section"), function(x) {
        x.classList.remove("rm-cat-flash");
    });
    // 先滚过去再闪，避免玩家看不到
    setTimeout(function() {
        try {
            if (typeof target.scrollIntoView === "function") {
                target.scrollIntoView({ behavior: "smooth", block: "center" });
            } else if (sb.scrollTop !== undefined && target.offsetTop !== undefined) {
                sb.scrollTop = Math.max(0, target.offsetTop - 40);
            }
        } catch (e) {}
        void target.offsetWidth;
        target.classList.add("rm-cat-flash");
        setTimeout(function() {
            target.classList.remove("rm-cat-flash");
        }, 2600);
    }, 260);
}
window.gotoSeriesChallenge = gotoSeriesChallenge;

/* ---- 点击锁定的系列开关 → 询问是否前往该系列挑战 ---- */
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
}
window.onLockedSeriesClick = onLockedSeriesClick;

/* ---- 挑战弹窗：难度选择 + 系列开关 ---- */
function openChallengeModal() {
    AudioFX.confirm();
    closeSidebarsExcept(null);
    renderSeriesSwitches();
    updatePresetButtons();
    const m = document.getElementById("challengeModal");
    if (m) m.style.display = "block";
}

function closeChallengeModal() {
    const m = document.getElementById("challengeModal");
    if (m) m.style.display = "none";
}

window.openChallengeModal = openChallengeModal;
window.closeChallengeModal = closeChallengeModal;

document.getElementById("toggleSettingSidebar").onclick = () => {
    AudioFX.confirm();
    const setSb = document.getElementById("settingSidebar");
    const willOpen = !setSb.classList.contains("open");
    closeSidebarsExcept("settingSidebar");
    setSb.classList.toggle("open", willOpen);
};

/* ---- 手机端：底部四个侧边栏按钮的收起 / 展开 ----
   只在小屏生效（CSS 用媒体查询控制显隐），默认展开。
   按钮本身是运行时注入的，不必改 index.html。 */
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
        e.stopPropagation();
        var collapsed = document.body.classList.toggle("rm-bar-collapsed");
        btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
        btn.title = collapsed ? "展开底部按钮" : "收起底部按钮";
        try {
            AudioFX.pop();
        } catch (err) {}
    });
    document.body.appendChild(btn);
}
window.ensureBarToggle = ensureBarToggle;

document.addEventListener("click", e => {
    const modeLink = e.target && e.target.closest ? e.target.closest(".rule-mode-link") : null;
    [ [ "infoSidebar", "toggleInfoSidebar" ], [ "achSidebar", "toggleAchSidebar" ], [ "createSidebar", "toggleCreateSidebar" ], [ "settingSidebar", "toggleSettingSidebar" ] ].forEach(([ id, btnId ]) => {
        const sb = document.getElementById(id);
        if (!sb || !sb.classList.contains("open")) return;
        const btn = document.getElementById(btnId);
        if (!sb.contains(e.target) && e.target !== btn && !modeLink) sb.classList.remove("open");
    });
});

document.addEventListener("click", function(e) {
    const m = document.getElementById("challengeModal");
    if (!m || m.style.display !== "block") return;
    const card = m.querySelector(".challenge-card");
    if (e.target === m) closeChallengeModal();
    else if (card && !card.contains(e.target) && e.target.closest && !e.target.closest("#challengeBtn")) closeChallengeModal();
});
document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") closeChallengeModal();
});

function renderSeriesSwitches() {
    const container = document.getElementById("seriesSwitchList");
    if (!container) return;
    let html = "";
    const catOrder = [ "basic", "special", "physics", "symmetry", "tactical" ];
    catOrder.forEach(catKey => {
        let unlocked = seriesUnlocked[catKey];
        let on = seriesState[catKey];
        let cat = CATEGORY[catKey];
        let lockEmoji = unlocked ? "🔓" : "🔒";
        html += `<div class="switch-row ${unlocked ? "unlocked" : "locked-row"}">`;
        html += `<div class="switch-label"><span class="lock-emoji">${lockEmoji}</span><span class="cat-name">${cat.emoji} ${cat.name}</span></div>`;
        if (catKey === "basic") {
            html += `<div class="switch-toggle on" style="cursor:default;opacity:0.7"></div>`;
        } else {
            html += `<div class="switch-toggle ${on ? "on" : ""} ${unlocked ? "" : "disabled"}" onclick="event.stopPropagation();${unlocked ? "toggleSeries('" + catKey + "')" : "onLockedSeriesClick('" + catKey + "')"}"></div>`;
        }
        html += `</div>`;
    });
    container.innerHTML = html;
    let hint = document.getElementById("seriesSwitchHint");
    let onCount = getSeriesOnCount();
    if (onCount < 5) {
        hint.className = "switch-hint";
        let need = onCount < 3 ? "≥3个才能使用<strong>简单/中等/困难</strong>" : "<strong>简单/中等/困难</strong>已可用✅<br>所有系列全开才能挑战<strong>地狱/脑王</strong>";
        hint.innerHTML = `当前开启<strong> ${onCount}/5 </strong>个系列<br>${need}<br>💡在<strong>💣信息 → 炸弹信息</strong>里通关系列<strong>挑战</strong>可解锁`;
    } else {
        hint.className = "switch-hint unlock-hint";
        let brainReady = (wins.hell || 0) >= BRAIN_HELL_WINS_REQ;
        if (brainReady) {
            hint.textContent = `全部 ${onCount}/5 个系列已开启 ✅ 地狱 & 脑王均可挑战`;
        } else {
            hint.innerHTML = `全部 ${onCount}/5 个系列已开启 ✅ 地狱可用<br>地狱通关${BRAIN_HELL_WINS_REQ}次后解锁<strong>脑王🤯</strong>`;
        }
    }
    updatePresetButtons();
}

function toggleSeries(catKey) {
    if (catKey === "basic") return;
    if (seriesLocked) return;
    if (!seriesUnlocked[catKey]) return;
    seriesState[catKey] = !seriesState[catKey];
    saveSeriesState(seriesState);
    AudioFX.toggle(seriesState[catKey]);
    renderSeriesSwitches();
}

function unlockSeries(catKey) {
    seriesUnlocked[catKey] = true;
    seriesState[catKey] = true;
    saveSeriesUnlocked(seriesUnlocked);
    saveSeriesState(seriesState);
    renderSeriesSwitches();
}

function getSeriesOnCount() {
    const knownKeys = [ "basic", "special", "physics", "symmetry", "tactical" ];
    return knownKeys.filter(k => seriesState[k] === true).length;
}

function checkBrainUnlocked() {
    let hellWins = wins.hell || 0;
    let seriesCount = getSeriesOnCount();
    return hellWins >= BRAIN_HELL_WINS_REQ && seriesCount >= 5;
}

function updatePresetButtons() {
    let onCount = getSeriesOnCount();
    let normalLocked = onCount < 3;
    let hellLocked = onCount < 5;
    let brainLocked = !checkBrainUnlocked();
    [ "btnEasy", "btnMedium", "btnHard" ].forEach(id => {
        let btn = document.getElementById(id);
        if (!btn) return;
        if (isFreeMode) {
            btn.classList.remove("locked");
            return;
        }
        if (normalLocked) btn.classList.add("locked"); else btn.classList.remove("locked");
    });
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
    let btnFree = document.getElementById("btnFree");
    if (btnFree) {
        btnFree.classList.remove("locked");
    }
}

function checkPresetAllowed(d) {
    let onCount = getSeriesOnCount();
    if (d === "brain") return checkBrainUnlocked();
    if (d === "hell") return onCount >= 5;
    return onCount >= 3;
}

function isPresetDifficulty(d) {
    return d === "easy" || d === "medium" || d === "hard" || d === "hell" || d === "brain";
}

function setPre(d) {
    // 自由模式要留在弹窗里调参数，其它难度选完即关
    if (d !== "free") closeChallengeModal();
    fullReset();
    if (d === "free") {
        isFreeMode = true;
        seriesLocked = false;
        diff = "free";
        document.getElementById("customPanel").classList.add("visible");
        document.getElementById("seriesLockedNotice").classList.remove("visible");
        updatePresetButtons();
        renderSeriesSwitches();
        resetTi();
        document.getElementById("timer").style.display = "none";
        AudioFX.confirm();
        // 不再立即开新局：留在弹窗里让玩家调好参数，再点「应用设置」开始
        return;
    }
    if (!checkPresetAllowed(d)) {
        if (d === "brain") {
            document.getElementById("brainHellWins").textContent = wins.hell || 0;
            document.getElementById("brainSeriesCount").textContent = getSeriesOnCount();
            document.getElementById("overlay").style.display = "block";
            document.getElementById("brainLockedModal").style.display = "block";
            AudioFX.modalOpen();
        } else if (d === "hell") {
            document.getElementById("hellLockedCount").textContent = getSeriesOnCount();
            document.getElementById("overlay").style.display = "block";
            document.getElementById("hellLockedModal").style.display = "block";
            AudioFX.modalOpen();
        } else {
            document.getElementById("overlay").style.display = "block";
            document.getElementById("presetLockedModal").style.display = "block";
            AudioFX.modalOpen();
        }
        return;
    }
    isFreeMode = false;
    seriesLocked = true;
    // 严格按预设写入棋盘参数：上一局是教学 5×5 或创造 15×15 都不会残留
    applyPresetParams(d);
    diff = d;
    pendingDiff = d;
    document.getElementById("customPanel").classList.remove("visible");
    document.getElementById("seriesLockedNotice").classList.add("visible");
    updatePresetButtons();
    renderSeriesSwitches();
    AudioFX.confirm();
    if (isPresetDifficulty(d)) {
        enterPresetPending(d);
    }
}

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
    if (teachBubble) slot.appendChild(teachBubble);
    slot.style.display = "none";
    document.getElementById("timer").style.display = "none";
    document.getElementById("placed").textContent = "0";
    document.getElementById("max").textContent = "0";
    document.getElementById("win").style.display = "none";
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

function setVal(key, dir) {
    let [min, max] = LIMIT[key];
    let val = key === "size" ? S : key === "total" ? T : key === "type" ? TY : SP;
    val = Math.max(min, Math.min(max, val + dir));
    if (key === "size") {
        S = val;
        SR = val;
        SC = val;
    }
    if (key === "total") T = val;
    if (key === "type") TY = val;
    if (key === "spec") SP = val;
    SP = Math.min(SP, T);
    TY = Math.min(TY, SP);
    document.getElementById("size").textContent = S;
    document.getElementById("total").textContent = T;
    document.getElementById("type").textContent = TY;
    document.getElementById("spec").textContent = SP;
    AudioFX.pop();
    diff = null;
}

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

function saveRec() {
    if (!diff) return;
    if (isFreeMode) {
        renderRecordList();
        return;
    }
    const _ms = RM.timer.ms();
    lt[diff] = _ms;
    Store.save("mineLastTimes", lt);
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
            setTimeout(() => {
                document.getElementById("overlay").style.display = "block";
                document.getElementById("brainUnlockedModal").style.display = "block";
                AudioFX.modalOpen();
            }, 1500);
        }
    }
}

function fmtTime(ms) {
    if (ms == null) return "暂无纪录";
    return `${String(Math.floor(ms / 6e4)).padStart(2, "0")}:${String(Math.floor(ms / 1e3) % 60).padStart(2, "0")}.${String(Math.floor(ms % 1e3 / 10)).padStart(2, "0")}`;
}

const RECORD_DIFFS = [ "easy", "medium", "hard", "hell", "brain" ];

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

function renderRecordList() {
    const list = document.getElementById("achRecordList");
    if (!list) return;
    let html = "";
    RECORD_DIFFS.forEach(d => {
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

document.addEventListener("mouseover", e => {
    let el = e.target;
    if (el.closest(".switch-toggle") || el.closest(".switch-row")) return;
    if (el.matches && el.matches("button, .preset-btn, .num-btn, .apply-btn, .game-sidebar-toggle, .setting-sidebar-toggle, .achievement-sidebar-toggle, .info-sidebar-toggle, .rule-sidebar-toggle, .tutorial-btn-inline, .mine-item, .win button, .auto-modal button")) {
        if (el.classList.contains("disabled") || el.classList.contains("locked") || el.classList.contains("locked-row")) return;
        AudioFX.pop();
    }
}, true);

let _fallingInterval = null;

let _fallingActive = false;

const _FALLING_EMOJIS = [ "💣", "💡", "🎉", "🤯", "😎", "❤️", "🏆", "🎊", "🥳", "🤩", "🧐", "✌️", "💪", "🤙", "👌", "🤟", "👏", "🎖️", "👑" ];

const _MAX_FALLING_NODES = 120;

function startFallingEmoji() {
    const container = document.getElementById("fallingContainer");
    if (!container) return;
    if (_fallingActive) return;
    _fallingActive = true;
    function removeNode(el) {
        if (!el || !el.parentNode) return;
        el.parentNode.removeChild(el);
    }
    function spawnOne() {
        if (!_fallingActive) return;
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
        span.addEventListener("animationend", () => removeNode(span), {
            once: true
        });
        container.appendChild(span);
    }
    for (let i = 0; i < 40; i++) {
        setTimeout(spawnOne, Math.random() * 600);
    }
    _fallingInterval = setInterval(spawnOne, 180);
}

function stopFallingEmoji() {
    _fallingActive = false;
    if (_fallingInterval) {
        clearInterval(_fallingInterval);
        _fallingInterval = null;
    }
    const container = document.getElementById("fallingContainer");
    if (container) container.innerHTML = "";
}

function setGoldenBackground() {
    document.body.classList.add("brain-golden");
    setTimeout(() => {
        document.body.classList.remove("brain-golden");
    }, 6e4);
}

function checkWin() {
    if (teachActive) return;
    if (Object.keys(G.placed).length !== G.max) return;
    for (let r = 0; r < SR; r++) for (let c = 0; c < SC; c++) if (G.p[r][c] !== G.tar[r][c]) return;
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

function closeBrainUnlockedModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("brainUnlockedModal").style.display = "none";
}

function closeBrainLockedModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("brainLockedModal").style.display = "none";
}

function closeBrainWinModal() {
    AudioFX.confirm();
    document.getElementById("brainWinModal").style.display = "none";
    stopFallingEmoji();
    document.body.classList.remove("brain-golden");
}

function closeWelcomeModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("welcomeModal").style.display = "none";
}

function closeTutorialComplete() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("tutorialCompleteModal").style.display = "none";
    // 挑战（基础/系列）用的是 T=5 的专属配比，结束后恢复标准参数，
    // 免得下一局还带着 10×10/5 颗雷的旧参数
    if (!isPresetDifficulty(diff)) applyStandardParams();
    if (!currentTutorialType) setTimeout(() => {
        document.getElementById("overlay").style.display = "block";
        document.getElementById("moreTutorialGuide").style.display = "block";
        AudioFX.modalOpen();
    }, 300);
}

function closeMoreTutorialGuide() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("moreTutorialGuide").style.display = "none";
}

function closePresetLockedModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("presetLockedModal").style.display = "none";
}

function closeHellLockedModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("hellLockedModal").style.display = "none";
}

document.getElementById("overlay").addEventListener("click", () => {
    AudioFX.confirm();
    let ruleModal = document.getElementById("teachRuleModal");
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
});
