/* ==========================================================================
 * 反向扫雷 · 08-ui.js
 * 职责：侧边栏、系列开关、难度预设、成绩记录、庆祝特效、胜利判定、弹窗
 * ========================================================================== */

function closeSidebarsExcept(keepId) {
    [ "ruleSidebar", "infoSidebar", "achSidebar", "gameSidebar", "settingSidebar" ].forEach(id => {
        if (id === keepId) return;
        const el = document.getElementById(id);
        if (el) el.classList.remove("open");
    });
}

document.getElementById("toggleRuleSidebar").onclick = () => {
    AudioFX.confirm();
    const ruleSb = document.getElementById("ruleSidebar");
    const willOpen = !ruleSb.classList.contains("open");
    closeSidebarsExcept("ruleSidebar");
    ruleSb.classList.toggle("open", willOpen);
};

document.getElementById("toggleInfoSidebar").onclick = () => {
    AudioFX.confirm();
    const infoSb = document.getElementById("infoSidebar");
    const willOpen = !infoSb.classList.contains("open");
    closeSidebarsExcept("infoSidebar");
    infoSb.classList.toggle("open", willOpen);
};

document.getElementById("toggleGameSidebar").onclick = () => {
    AudioFX.confirm();
    const gameSb = document.getElementById("gameSidebar");
    const willOpen = !gameSb.classList.contains("open");
    closeSidebarsExcept("gameSidebar");
    gameSb.classList.toggle("open", willOpen);
    if (willOpen) renderSeriesSwitches();
};

document.getElementById("toggleSettingSidebar").onclick = () => {
    AudioFX.confirm();
    const setSb = document.getElementById("settingSidebar");
    const willOpen = !setSb.classList.contains("open");
    closeSidebarsExcept("settingSidebar");
    setSb.classList.toggle("open", willOpen);
};

document.addEventListener("click", e => {
    const modeLink = e.target && e.target.closest ? e.target.closest(".rule-mode-link") : null;
    [ [ "ruleSidebar", "toggleRuleSidebar" ], [ "infoSidebar", "toggleInfoSidebar" ], [ "achSidebar", "toggleAchSidebar" ], [ "gameSidebar", "toggleGameSidebar" ], [ "settingSidebar", "toggleSettingSidebar" ] ].forEach(([ id, btnId ]) => {
        const sb = document.getElementById(id);
        if (!sb || !sb.classList.contains("open")) return;
        const btn = document.getElementById(btnId);
        if (!sb.contains(e.target) && e.target !== btn && !modeLink) sb.classList.remove("open");
    });
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
            html += `<div class="switch-toggle ${on ? "on" : ""} ${unlocked ? "" : "disabled"}" onclick="event.stopPropagation();${unlocked ? "toggleSeries('" + catKey + "')" : ""}"></div>`;
        }
        html += `</div>`;
    });
    container.innerHTML = html;
    let hint = document.getElementById("seriesSwitchHint");
    let onCount = getSeriesOnCount();
    if (onCount < 5) {
        hint.className = "switch-hint";
        let need = onCount < 3 ? "≥3个才能使用<strong>简单/中等/困难</strong>" : "<strong>简单/中等/困难</strong>已可用✅<br>所有系列全开才能挑战<strong>地狱/脑王</strong>";
        hint.innerHTML = `当前开启<strong> ${onCount}/5 </strong>个系列<br>${need}<br>💡前往<strong>页面左侧[💣信息]</strong>通关系列<strong>挑战</strong>可解锁`;
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
        applySet();
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
    const p = PRE[d];
    S = p.size;
    SR = p.size;
    SC = p.size;
    T = p.total;
    TY = p.type;
    SP = p.spec;
    SP = Math.min(SP, T);
    TY = Math.min(TY, SP);
    document.getElementById("size").textContent = S;
    document.getElementById("total").textContent = T;
    document.getElementById("type").textContent = TY;
    document.getElementById("spec").textContent = SP;
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
