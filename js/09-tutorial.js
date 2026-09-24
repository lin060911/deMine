/* ==========================================================================
 * 反向扫雷 · 09-tutorial.js
 * 职责：系列挑战 + 基础挑战 + 引导教学（TEACH_LEVELS）全流程
 * ========================================================================== */

function onTutorialWin() {
    tutorialStep++;
    let cat = currentTutorialType;
    if (!cat) Store.set("tutorialStep", tutorialStep.toString()); else Store.set("tutorial_" + cat, tutorialStep.toString());
    updateTutorialProgress();
    if (tutorialStep >= 5) {
        if (cat) {
            let nextBtn = document.getElementById("teachNextBtn");
            if (nextBtn) {
                nextBtn.textContent = "完成";
                nextBtn.onclick = closeTutorialComplete;
            }
        }
        if (cat && !seriesUnlocked[cat]) {
            unlockSeries(cat);
            renderMineInfo();
            renderSeriesSwitches();
        }
        document.getElementById("overlay").style.display = "block";
        document.getElementById("tutorialCompleteModal").style.display = "block";
        AudioFX.modalOpen();
        let txt;
        if (!cat) {
            txt = "🎉 基础挑战完成！<br>现在你可以去挑战各系列的关卡了<br>通过对应系列挑战即可解锁该系列地雷 ✅";
        } else {
            // 末关大弹窗：列出本系列解锁的雷种，比一句"已加入题库"更有获得感
            let mineLine = "";
            try {
                let bombs = Object.keys(M).filter(k => M[k].category === cat);
                if (bombs.length) {
                    mineLine = "<div style=\"margin:10px 0 8px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;\">" +
                        bombs.map(k => "<span style=\"background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;" +
                            "padding:4px 8px;font-size:12px;color:#2d3748;\">" + M[k].e + " " + M[k].n + "</span>").join("") +
                        "</div>";
                }
            } catch (e) {}
            txt = `🎉 已解锁「${CATEGORY[cat].emoji} ${CATEGORY[cat].name}」！` + mineLine +
                "<span style=\"font-size:12px;color:#718096\">该系列地雷已加入题库 ✅</span>";
        }
        document.getElementById("tutorialCompleteText").innerHTML = txt;
        document.getElementById("tutorialProgressBar").style.display = "none";
        isTutorialMode = false;
        if (!cat) Store.set("tutorialCompleted", "true");
    } else {
        // 中间关：轻提示，不打断，短暂停顿后自动进下一关
        setTimeout(() => {
            try {
                RM.toast(`破解一关！目前第${tutorialStep + 1}/5关  o((>ω< ))o`, 1800);
            } catch (e) {}
            setupTutorialBoard(cat);
        }, 520);
    }
}

function startTutorial() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("tutorialPrompt").style.display = "none";
    currentTutorialType = null;
    isTutorialMode = true;
    tutorialStep = parseInt(Store.get("tutorialStep")) || 0;
    setupTutorialBoard(null);
}

function openTutorialSelector() {
    if (isTutorialMode) return;
    AudioFX.confirm();
    let bs = Store.get("tutorialStep");
    if (bs && parseInt(bs) > 0 && parseInt(bs) < 5) {
        currentTutorialType = null;
        isTutorialMode = true;
        tutorialStep = parseInt(bs);
        setupTutorialBoard(null);
        return;
    }
    startTutorial();
}

function setupTutorialBoard(catKey) {
    fullReset();
    currentTutorialType = catKey;
    isTutorialMode = true;
    // 挑战固定 10×10：必须显式写 SR/SC，否则会沿用上一局（如 hard 的 12×12）
    S = 10;
    SR = 10;
    SC = 10;
    T = 5;
    TY = 3;
    SP = 3;
    setupTutorialParams();
    genTutorialGame(catKey);
    showTutorialProgress(catKey);
    render();
    document.getElementById("win").style.display = "none";
}

function showTutorialProgress(catKey) {
    let bar = document.getElementById("tutorialProgressBar");
    bar.style.display = "block";
    let title = document.getElementById("tutorialTitle");
    if (!catKey) {
        title.textContent = "基础挑战";
        tutorialStep = parseInt(Store.get("tutorialStep")) || 0;
    } else {
        title.textContent = CATEGORY[catKey].name + "挑战";
        tutorialStep = parseInt(Store.get("tutorial_" + catKey)) || 0;
    }
    updateTutorialProgress();
}

function updateTutorialProgress() {
    document.getElementById("tutorialProgressFill").style.width = tutorialStep / 5 * 100 + "%";
    document.getElementById("tutorialProgressText").textContent = tutorialStep + "/5";
}

/* 系列挑战的前置门禁：基础挑战没通关之前，所有系列挑战都不可进入 */
function showBasicRequiredModal(catKey) {
    var cat = (typeof CATEGORY !== "undefined" && CATEGORY[catKey]) ? CATEGORY[catKey] : { name: catKey, emoji: "🔒" };
    AudioFX.locked();
    openConfirmModal({
        icon: "📖",
        title: "先完成基础挑战",
        body: "「" + cat.emoji + " <strong>" + cat.name + "</strong>」的挑战<br>" +
            "需要先通关 <strong>基础挑战</strong>（5 关）才能解锁哦<br>" +
            "<span style=\"font-size:12px;color:#718096\">在 💣信息 → 炸弹信息 里也能找到入口</span>",
        buttons: [ {
            label: "去完成基础挑战",
            sub: "立即开始",
            cls: "rm-btn-primary",
            act: "go"
        }, {
            label: "取消",
            cls: "rm-btn-cancel",
            act: "cancel"
        } ],
        onAction: function(act) {
            if (act === "go") {
                if (typeof closeAllModals === "function") closeAllModals();
                startTutorial();
            }
        }
    });
}
window.showBasicRequiredModal = showBasicRequiredModal;

function startCategoryTutorial(catKey) {
    AudioFX.confirm();
    // 门禁：基础挑战未完成时，系列挑战一律不可进入
    if (catKey && !isBasicChallengeDone()) {
        showBasicRequiredModal(catKey);
        return;
    }
    currentTutorialType = catKey;
    isTutorialMode = true;
    tutorialStep = seriesUnlocked[catKey] ? parseInt(Store.get("tutorial_" + catKey)) || 0 : 0;
    document.getElementById("overlay").style.display = "none";
    setupTutorialBoard(catKey);
}

const TEACH_LEVELS = [ {
    title: "① 放置地雷",
    icon: "💣",
    mineType: "normal",
    mineEmoji: "💣",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 0, 0, 0, 0, 0 ], [ 0, 1, 1, 1, 0 ], [ 0, 1, 1, 1, 0 ], [ 0, 1, 1, 1, 0 ], [ 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "这是一颗 💣普通雷\n它会让周围 3×3 范围每个格子 +1\n\n棋盘中央有一块 3×3 的「1」区域 \n拖动地雷到棋盘上放置吧！",
        hint: "普通雷 3x3 范围 +1"
    }, {
        text: "提示：放在区域中心位置（第3行第3列）\n它的 3×3 影响范围才能刚好覆盖所有 1。",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 2 ]
    } ]
}, {
    title: "② 在边上放置地雷",
    icon: "📏",
    mineType: "normal",
    mineEmoji: "💣",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 0, 0, 0, 0, 0 ], [ 1, 1, 0, 0, 0 ], [ 1, 1, 0, 0, 0 ], [ 1, 1, 0, 0, 0 ], [ 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "当雷靠近棋盘边缘时\n它的一部分影响范围会超出棋盘。\n\n左侧有两列显示 1\n——该放哪呢？",
        hint: "边缘放置：超出棋盘的部分不生效"
    }, {
        text: "提示：放在位置（第3行第1列）\n它的 3×3 范围右边两列刚好覆盖那些 1",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 0 ]
    } ]
}, {
    title: "③ 在角落放置地雷",
    icon: "📐",
    mineType: "normal",
    mineEmoji: "💣",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 0, 0, 0, 0, 0 ], [ 0, 0, 0, 0, 0 ], [ 0, 0, 0, 0, 0 ], [ 1, 1, 0, 0, 0 ], [ 1, 1, 0, 0, 0 ] ],
    steps: [ {
        text: "角落是最极端的边界\n\n左下角有 2×2 的「1」区域\n只有角落的雷能产生这种图案",
        hint: "角落放置：只有 2×2 范围在棋盘内"
    }, {
        text: "提示：放到棋盘左下角（第5行第1列）\n它的 3×3 范围就只剩右上 2×2 在棋盘内。",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 4, 0 ]
    } ]
}, {
    title: "④ 更大范围的地雷",
    icon: "💣",
    mineType: "big5",
    mineEmoji: "💣",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 1, 1, 1, 1, 0 ], [ 1, 1, 1, 1, 0 ], [ 1, 1, 1, 1, 0 ], [ 1, 1, 1, 1, 0 ], [ 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "💣巨型雷——它的影响范围是 5×5\n比普通雷大得多！\n\n左上角有一大块 4×4 的 1\n放在哪里能一次覆盖这么大的区域呢?",
        hint: "巨型雷 5×5 范围 +1"
    }, {
        text: "提示：4×4 的 1 区域左上角对齐棋盘边缘\n巨型雷的 5×5 中心应该尽量靠左上\n把它放到（第2行第2列）\n它的范围左上角刚好超出棋盘",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 1, 1 ]
    } ]
}, {
    title: "⑤ 不同数值的地雷",
    icon: "🔢",
    mineType: "high",
    mineEmoji: "💣",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 2, 2, 2, 0, 0 ], [ 2, 2, 2, 0, 0 ], [ 2, 2, 2, 0, 0 ], [ 0, 0, 0, 0, 0 ], [ 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "💣高爆雷——同样是 3×3 范围\n但每个格子 +2 而不是 +1\n\n左上角 3×3 全是 2\n你需要一颗「更猛」的雷来填满。",
        hint: "高爆雷 3×3 范围 +2"
    }, {
        text: "提示：放在（第2行第2列）\n它的 3×3 范围才能覆盖并产生 +2 的效果。",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 1, 1 ]
    } ]
}, {
    title: "⑥ 不同形状的地雷",
    icon: "🌶️",
    mineType: "chiliV",
    mineEmoji: "🌶️",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 0, 0, 1, 0, 0 ], [ 0, 0, 1, 0, 0 ], [ 0, 0, 1, 0, 0 ], [ 0, 0, 1, 0, 0 ], [ 0, 0, 1, 0, 0 ] ],
    steps: [ {
        text: "🌶️竖辣椒——它影响竖直方向的5格\n形成一条线，而不是 3×3 方块\n\n棋盘中间一列从上到下全是 1\n放下辣椒试试。",
        hint: "竖辣椒：竖直方向5格 +1"
    }, {
        text: "提示：放中间（第3行第3列）",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 2 ]
    } ]
}, {
    title: "⑦ 特殊地雷遇上边界",
    icon: "🌶️",
    mineType: "chiliH",
    mineEmoji: "🌶️",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 0, 0, 0, 0, 0 ], [ 0, 0, 0, 0, 0 ], [ 1, 1, 1, 0, 0 ], [ 0, 0, 0, 0, 0 ], [ 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "🌶️横辣椒——和竖辣椒类似，影响水平5格\n注意：它靠近边界时，也会有超出的部分。\n\n第3行有3个 1（左边紧挨边界）\n横辣椒该放在哪？",
        hint: "横辣椒：水平方向5格 +1，部分超出棋盘"
    }, {
        text: "提示：第3行有连续3个 1，左边贴着棋盘边缘。\n横辣椒水平范围左右各延伸 2 格\n要覆盖这3个 1，中心应该放在第3行第1列",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 0 ]
    } ]
}, {
    title: "⑧ 负值的地雷",
    icon: "💥",
    mineType: "anti",
    mineEmoji: "💥",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ -1, -1, -1, 0, 0 ], [ -1, -1, -1, 0, 0 ], [ -1, -1, -1, 0, 0 ], [ 0, 0, 0, 0, 0 ], [ 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "💥反物质炸弹——它在 3×3 内每格 -1\n会产生负数！\n\n左上角 3×3 全是 -1\n代表着需要负值的地雷",
        hint: "反物质炸弹 3×3 范围 -1"
    }, {
        text: "提示：放到第2行第2列\n就能产生正确的负值影响。",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 1, 1 ]
    } ]
}, {
    title: "⑨ 影响叠加",
    icon: "💣＋💣",
    mineTypes: {
        normal: 2
    },
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 1, 1, 1, 0, 0 ], [ 1, 2, 2, 1, 0 ], [ 1, 2, 2, 1, 0 ], [ 0, 1, 1, 1, 0 ], [ 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "当两颗地雷的影响范围重叠时\n重叠区域的数值会累加！\n\n中间有 2×2 的[2]区域\n说明这些格子被两颗雷同时覆盖",
        hint: "两颗雷重叠 → 1+1=2"
    }, {
        text: "把一颗💣放到第2行第2列\n你会看到 3×3 范围变成 1",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 1, 1 ]
    }, {
        text: "再放第二颗💣到第3行第3列\n两颗雷范围叠加处 → 数值变成 2 ✅",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 2 ]
    } ]
}, {
    title: "⑩ 正负抵消",
    icon: "➕➖",
    mineTypes: {
        normal: 1,
        anti: 1
    },
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 0, 0, 0, 0, 0 ], [ 0, 1, 1, 1, 0 ], [ 0, 1, 0, 0, -1 ], [ 0, 1, 0, 0, -1 ], [ 0, 0, -1, -1, -1 ] ],
    steps: [ {
        text: "💣普通雷 +1，💥反物质炸弹 -1\n当它们的影响范围重叠时\n重叠区域相加得0！\n\n中间有 2×2 的[0]区域\n说明这些格子被两颗雷同时覆盖",
        hint: "正负叠加 → 1+(-1)=0"
    }, {
        text: "把💣放到第3行第3列\n它的 3×3 范围覆盖中间区域",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 2 ]
    }, {
        text: "把💥放到第4行第4列\n它的 3×3 范围覆盖右下区域\n两者重叠区域 → 1+(-1)=0 ✅",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 3, 3 ]
    } ]
}, {
    title: "融会贯通",
    icon: "🥳",
    mineTypes: {
        big5: 1,
        anti: 1,
        chiliV: 1,
        chiliH: 1
    },
    boardRows: 8,
    boardCols: 8,
    targetBoard: [ [ 0, 1, 0, 0, 0, 0, 0, 0 ], [ 0, 1, 0, 0, -1, -1, -1, 0 ], [ 0, 2, 1, 1, 0, 0, -1, 0 ], [ 0, 2, 1, 1, 0, 0, -1, 0 ], [ 0, 2, 1, 1, 1, 1, 0, 0 ], [ 0, 1, 1, 1, 1, 1, 0, 0 ], [ 0, 1, 1, 2, 2, 2, 1, 1 ], [ 0, 0, 0, 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "这是为你准备的最后考题\n\n想想刚才所有的特性\n\n用这里的四个地雷，把棋盘变绿吧！",
        hint: "正负叠加 → 1+(-1)=0"
    }, {
        text: "巨型雷💣轮廓最明显\n把它放在第5行第4列正好",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 4, 3 ]
    }, {
        text: "把💥放到第3行第6列\n与巨型雷的范围叠加\n两者重叠区域 → 1+(-1)=0 ✅",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 5 ]
    }, {
        text: "把竖辣椒放到第3行2列\n与巨型雷的范围叠加区域\n1+1=2 ✅",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 1 ]
    }, {
        text: "把横辣椒放到第7行第6列\n与巨型雷的范围叠加区域\n1+1=2 ✅",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 6, 5 ]
    } ]
} ];

let teachActive = false;

let teachLevelIdx = 0;

let teachStepIdx = 0;

let teachPlacedCount = 0;

let teachExpectedCount = 0;

let teachPlacedTypes = {};

let teachExpectedTypes = {};

let teachPlaceList = [];

let teachCompleted = [];

let teachRulePending = false;

const TEACH_RULE_FALLBACK = `
        <div class="teach-rule-sec">
            <div class="teach-rule-sec-title">🎯 目标</div>
            <p>在棋盘上放置规定数量的地雷（普通雷 + 特殊雷），使得棋盘上每个格子显示的数字，恰好等于它周围（或特定规则下）所有地雷对它的总影响值。</p>
        </div>
        <div class="teach-rule-sec">
            <div class="teach-rule-sec-title">🏁 胜利条件</div>
            <p>所有地雷放完，且棋盘数字与地雷影响匹配（棋盘上都是🟩）。</p>
        </div>
        <div class="teach-rule-sec">
            <div class="teach-rule-sec-title">🧩 地块状态解读</div>
            <p class="teach-rule-intro">游戏会根据你当前的布雷情况，实时用颜色提示每个格子：</p>
            <ul>
                <li>🟩 合适：该格子的当前影响值 [等于] 显示数字（正确）。</li>
                <li>🟨 偏低：该格子的当前影响值 [小于] 显示数字（还需在周围加雷）。</li>
                <li>🟥 偏高：该格子的当前影响值 [大于] 显示数字（周围雷太多，需删除）。</li>
            </ul>
        </div>`;

function buildTeachRuleContent() {
    const box = document.querySelector("#infoSidebar .rule-content");
    let goalHTML = "", winHTML = "", stateHTML = "";
    if (box) {
        const stripLabel = html => String(html).replace(/^\s*<strong>[^<]*<\/strong>\s*(?:<br\s*\/?>)?/i, "").trim();
        Array.prototype.forEach.call(box.querySelectorAll("li"), li => {
            const head = (li.textContent || "").replace(/\s+/g, "");
            if (!goalHTML && head.indexOf("目标：") === 0) goalHTML = stripLabel(li.innerHTML);
            else if (!winHTML && head.indexOf("胜利条件：") === 0) winHTML = stripLabel(li.innerHTML);
        });
        Array.prototype.forEach.call(box.querySelectorAll("h3"), h3 => {
            if ((h3.textContent || "").indexOf("地块状态解读") < 0) return;
            let intro = "", lists = "";
            let node = h3.nextElementSibling;
            while (node && node.tagName !== "H3") {
                if (node.tagName === "P") intro = node.innerHTML;
                else if (node.tagName === "UL") lists += node.innerHTML;
                node = node.nextElementSibling;
            }
            stateHTML = (intro ? `<p class="teach-rule-intro">${intro}</p>` : "") + (lists ? `<ul>${lists}</ul>` : "");
        });
    }
    if (!goalHTML || !winHTML || !stateHTML) return TEACH_RULE_FALLBACK;
    return `
        <div class="teach-rule-sec">
            <div class="teach-rule-sec-title">🎯 目标</div>
            <p>${goalHTML}</p>
        </div>
        <div class="teach-rule-sec">
            <div class="teach-rule-sec-title">🏁 胜利条件</div>
            <p>${winHTML}</p>
        </div>
        <div class="teach-rule-sec">
            <div class="teach-rule-sec-title">🧩 地块状态解读</div>
            ${stateHTML}
        </div>`;
}

function openTeachRuleModal(playSound) {
    const modal = document.getElementById("teachRuleModal");
    if (!modal) return;
    const body = document.getElementById("teachRuleBody");
    if (body) {
        body.innerHTML = buildTeachRuleContent();
        body.scrollTop = 0;
    }
    const okBtn = document.getElementById("teachRuleOkBtn");
    if (okBtn) okBtn.textContent = teachRulePending ? "我明白了，开始教学 ▶" : "知道了 ✌️";
    document.getElementById("overlay").style.display = "block";
    modal.style.display = "block";
    if (playSound) AudioFX.modalOpen();
}

function hideTeachRuleModal() {
    const modal = document.getElementById("teachRuleModal");
    if (modal) modal.style.display = "none";
    document.getElementById("overlay").style.display = "none";
    if (teachRulePending) {
        teachRulePending = false;
        if (teachActive) loadTeachLevel();
    }
}

function closeTeachRuleModal() {
    AudioFX.confirm();
    hideTeachRuleModal();
}

function openTeachMode() {
    AudioFX.confirm();
    document.querySelector(".panel").style.display = "none";
    teachLevelIdx = 0;
    teachStepIdx = 0;
    teachPlacedCount = 0;
    teachExpectedCount = 0;
    teachPlaceList = [];
    teachPlacedTypes = {};
    fullReset();
    teachActive = true;
    S = 5;
    SR = 5;
    SC = 5;
    document.getElementById("overlay").style.display = "none";
    document.getElementById("teachProgressBar").style.display = "block";
    updateTeachProgressBar();
    ensureTeachSlotHost(true);
    document.getElementById("board").innerHTML = "";
    document.getElementById("slot").style.display = "none";
    teachRulePending = true;
    openTeachRuleModal(false);
}

function openPracticeMode() {
    AudioFX.confirm();
    startTutorial();
}

function loadTeachLevel() {
    let lvl = TEACH_LEVELS[teachLevelIdx];
    teachActive = true;
    SR = lvl.boardRows;
    SC = lvl.boardCols;
    S = 5;
    G.tar = lvl.targetBoard.map(row => row.slice());
    G.p = Array(SR).fill().map(() => Array(SC).fill(0));
    G.placed = {};
    teachPlaceList = [];
    teachPlacedTypes = {};
    let mt = lvl.mineTypes || (lvl.mineType ? {
        [lvl.mineType]: 1
    } : {});
    teachExpectedTypes = Object.assign({}, mt);
    teachExpectedCount = 0;
    for (let k in mt) teachExpectedCount += mt[k];
    teachPlacedCount = 0;
    G.max = teachExpectedCount;
    G.pool = Object.assign({}, mt);
    teachStepIdx = 0;
    ensureTeachSlotHost(true);
    renderTeachSlot();
    renderTeachBoard();
    showTeachStep();
    updateTeachProgressBar();
    document.getElementById("win").style.display = "none";
    document.getElementById("timer").style.display = "none";
    document.getElementById("placed").textContent = "0";
    document.getElementById("max").textContent = String(teachExpectedCount);
}

let _teachLastDropKey = null;

function renderTeachBoard() {
    let lvl = TEACH_LEVELS[teachLevelIdx];
    let b = document.getElementById("board");
    b.innerHTML = "";
    b.classList.remove("rm-diff");
    applyBoardMetrics(b, SR, SC);
    for (let r = 0; r < SR; r++) {
        for (let c = 0; c < SC; c++) {
            let d = document.createElement("div");
            d.className = "cell";
            d.dataset.r = r;
            d.dataset.c = c;
            let t = G.tar[r][c];
            let p = G.p[r][c];
            if (p === t) d.classList.add("cell-valid"); else if (p < t) d.classList.add("cell-low"); else if (p > t) d.classList.add("cell-over");
            if (t !== 0) {
                d.textContent = t;
                d.classList.add("n" + t);
            }
            let k = r + "," + c;
            if (G.placed[k]) {
                d.classList.add("mine-here");
                // 只有本次新落下的那颗播落雷动画（用完即清，避免后续重绘重播）
                if (k === _teachLastDropKey) {
                    d.classList.add("just-dropped");
                    _teachLastDropKey = null;
                }
                let ty = G.placed[k];
                d.innerHTML = `<span class="${M[ty].cls}">${M[ty].e}</span>`;
            }
            appendInfluenceBadge(d, p, t);
            d.onclick = () => {
                if (G.placed[k]) return;
                let type = window._teachSelectedType;
                if (!type) {
                    let mt = lvl.mineTypes || (lvl.mineType ? {
                        [lvl.mineType]: 1
                    } : {});
                    for (let t in mt) {
                        if ((teachPlacedTypes[t] || 0) < mt[t]) {
                            type = t;
                            break;
                        }
                    }
                }
                if (!type) return;
                teachDrop(r, c, type);
            };
            d.oncontextmenu = e => {
                e.preventDefault();
                teachRemove(r, c);
            };
            bindCellDrag(d, "teach");
            b.appendChild(d);
        }
    }
    sizeCellsIn(b);
}

function renderTeachSlot() {
    let lvl = TEACH_LEVELS[teachLevelIdx];
    let s = document.getElementById("slot");
    let bubble = document.getElementById("teachBubble");
    let minesBox = null;
    if (bubble) {
        if (bubble.parentElement !== s) s.appendChild(bubble);
        minesBox = document.getElementById("teachBubbleMines");
        if (!minesBox) {
            minesBox = document.createElement("div");
            minesBox.className = "teach-bubble-mines";
            minesBox.id = "teachBubbleMines";
            bubble.appendChild(minesBox);
        }
        Array.prototype.slice.call(s.children).forEach(function(ch) {
            if (ch !== bubble) s.removeChild(ch);
        });
        minesBox.innerHTML = "";
    }
    s.style.display = "";
    ensureTeachSlotHost();
    let mt = lvl.mineTypes || (lvl.mineType ? {
        [lvl.mineType]: 1
    } : {});
    for (let t in mt) {
        let expected = mt[t];
        let placed = teachPlacedTypes[t] || 0;
        let div = document.createElement("div");
        let disabled = placed >= expected;
        div.className = "mine-item" + (disabled ? " disabled" : "") + (window._teachSelectedType === t ? " selected" : "");
        div.dataset.tip = M[t].tip;
        div.dataset.mineType = t;
        div.innerHTML = `<div class="emoji-drag ${M[t].cls}">${M[t].e}</div><div>${M[t].n}</div><div>${placed}/${expected}</div>`;
        bindSlotItemDrag(div, t, "teach");
        if (minesBox) minesBox.appendChild(div); else s.appendChild(div);
    }
}

function ensureTeachSlotHost(replay) {
    let s = document.getElementById("slot");
    if (!s) return;
    if (replay) {
        s.classList.remove("teach-slot-host");
        void s.offsetWidth;
    }
    s.classList.add("teach-slot-host");
}

function clearTeachSlotHost() {
    let s = document.getElementById("slot");
    if (s) s.classList.remove("teach-slot-host");
}

function teachDrop(r, c, forceType) {
    let lvl = TEACH_LEVELS[teachLevelIdx];
    let k = r + "," + c;
    if (G.placed[k]) return;
    let dragType = forceType || window._teachSelectedType || null;
    window._teachSelectedType = null;
    renderTeachSlot();
    if (!dragType) {
        let mt = lvl.mineTypes || (lvl.mineType ? {
            [lvl.mineType]: 1
        } : {});
        for (let t in mt) {
            if ((teachPlacedTypes[t] || 0) < mt[t]) {
                dragType = t;
                break;
            }
        }
    }
    if (!dragType) return;
    let mt = lvl.mineTypes || (lvl.mineType ? {
        [lvl.mineType]: 1
    } : {});
    if ((teachPlacedTypes[dragType] || 0) >= (mt[dragType] || 0)) return;
    G.placed[k] = dragType;
    _teachLastDropKey = k;
    teachPlaceList.push({
        r: r,
        c: c,
        type: dragType
    });
    teachPlacedTypes[dragType] = (teachPlacedTypes[dragType] || 0) + 1;
    teachPlacedCount++;
    AudioFX.place();
    G.p = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let item of teachPlaceList) {
        M[item.type].f(item.r, item.c, G.p);
    }
    applyTacticalEffects(G.p, G.placed);
    renderTeachBoard();
    renderTeachSlot();
    document.getElementById("placed").textContent = String(teachPlacedCount);
    updateTeachProgressBar();
    if (teachPlacedCount >= teachExpectedCount) {
        let allCorrect = true;
        for (let i = 0; i < SR; i++) for (let j = 0; j < SC; j++) {
            if (G.p[i][j] !== G.tar[i][j]) allCorrect = false;
        }
        if (allCorrect) {
            showTeachStep(true);
            setTimeout(() => teachLevelComplete(), 1200);
        } else {
            let steps = lvl.steps || [];
            teachStepIdx = Math.min(teachStepIdx + 1, steps.length - 1);
            showTeachStep(false);
        }
    } else {
        let steps = lvl.steps || [];
        teachStepIdx = Math.min(teachStepIdx + 1, steps.length - 1);
        showTeachStep(false);
    }
}

function teachRemove(r, c) {
    let k = r + "," + c;
    if (!G.placed[k]) return;
    let removedType = G.placed[k];
    delete G.placed[k];
    teachPlaceList = teachPlaceList.filter(item => !(item.r === r && item.c === c));
    teachPlacedTypes[removedType] = Math.max(0, (teachPlacedTypes[removedType] || 0) - 1);
    teachPlacedCount = Math.max(0, teachPlacedCount - 1);
    AudioFX.remove();
    G.p = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let item of teachPlaceList) {
        M[item.type].f(item.r, item.c, G.p);
    }
    applyTacticalEffects(G.p, G.placed);
    renderTeachBoard();
    renderTeachSlot();
    document.getElementById("placed").textContent = String(teachPlacedCount);
    updateTeachProgressBar();
    teachStepIdx = 0;
    showTeachStep(false);
}

function teachMove(fromKey, r, c) {
    const toKey = r + "," + c;
    const t = G.placed[fromKey];
    if (!t || G.placed[toKey] || fromKey === toKey) return;
    const fr = +fromKey.split(",")[0], fc = +fromKey.split(",")[1];
    delete G.placed[fromKey];
    teachPlaceList = teachPlaceList.filter(item => !(item.r === fr && item.c === fc));
    G.placed[toKey] = t;
    teachPlaceList.push({
        r: r,
        c: c,
        type: t
    });
    AudioFX.place();
    G.p = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let item of teachPlaceList) {
        M[item.type].f(item.r, item.c, G.p);
    }
    applyTacticalEffects(G.p, G.placed);
    renderTeachBoard();
    renderTeachSlot();
    document.getElementById("placed").textContent = String(teachPlacedCount);
    updateTeachProgressBar();
    teachCheckComplete();
}

function teachCheckComplete() {
    if (teachPlacedCount < teachExpectedCount) return;
    for (let i = 0; i < SR; i++) {
        for (let j = 0; j < SC; j++) {
            if (G.p[i][j] !== G.tar[i][j]) return;
        }
    }
    showTeachStep(true);
    setTimeout(() => teachLevelComplete(), 1200);
}

function showTeachStep(isCorrect) {
    let lvl = TEACH_LEVELS[teachLevelIdx];
    let bubble = document.getElementById("teachBubble");
    bubble.classList.remove("visible", "mines-only");
    void bubble.offsetWidth;
    bubble.classList.add("visible");
    let steps = lvl.steps || [];
    let stepIdx = Math.min(teachStepIdx, steps.length - 1);
    let step = steps[stepIdx] || steps[0] || {
        text: "",
        hint: ""
    };
    if (isCorrect) {
        document.getElementById("teachBubbleIcon").textContent = "✅";
        document.getElementById("teachBubbleTitle").textContent = "正确!";
        document.getElementById("teachBubbleText").textContent = "放置正确，棋盘已全部匹配！\n\n 该教学已完成\n";
        document.getElementById("teachBubbleHint").textContent = "";
    } else {
        document.getElementById("teachBubbleIcon").textContent = lvl.icon;
        document.getElementById("teachBubbleTitle").textContent = lvl.title;
        document.getElementById("teachBubbleText").textContent = step.text;
        document.getElementById("teachBubbleHint").textContent = step.hint || "";
    }
    document.querySelectorAll(".cell-teach-target").forEach(el => el.classList.remove("cell-teach-target"));
    if (step.targetCell && !isCorrect) {
        let [tr, tc] = step.targetCell;
        let cellEl = document.querySelector(`.cell[data-r="${tr}"][data-c="${tc}"]`);
        if (cellEl) cellEl.classList.add("cell-teach-target");
    }
}

function showTeachBubbleMsg(text) {
    teachStepIdx = 1;
    showTeachStep(false);
}

function updateTeachProgressBar() {
    let bar = document.getElementById("teachProgressBar");
    if (!bar) return;
    let total = TEACH_LEVELS.length;
    let pct = Math.round(teachLevelIdx / total * 100);
    document.getElementById("teachProgressFill").style.width = pct + "%";
    document.getElementById("teachProgressText").textContent = teachLevelIdx + 1 + "/" + total;
}

function teachLevelComplete() {
    updateTeachProgressBar();
    let modal = document.getElementById("teachCompleteModal");
    let lvl = TEACH_LEVELS[teachLevelIdx];
    document.getElementById("teachCompleteIcon").textContent = lvl.icon;
    document.getElementById("teachCompleteTitle").textContent = `${lvl.title} 完成！`;
    let isLast = teachLevelIdx === TEACH_LEVELS.length - 1;
    let nextBtn = document.getElementById("teachNextBtn");
    let exitBtn = document.getElementById("teachExitBtn");
    let practiceBtn = document.getElementById("teachPracticeBtn");
    if (isLast) {
        document.getElementById("teachCompleteText").innerHTML = "🎓 恭喜完成全部教学！<br>准备好挑战基础挑战了吗？";
        nextBtn.textContent = "完成 🏆";
        nextBtn.onclick = teachExit;
        nextBtn.style.display = "";
        exitBtn.style.display = "none";
        practiceBtn.style.display = "";
        AudioFX.winBrain();
        if (window.Achievements && window.Achievements.unlock) {
            window.Achievements.unlock("finish_tutorial");
        }
    } else {
        let nextLvl = TEACH_LEVELS[teachLevelIdx + 1];
        document.getElementById("teachCompleteText").innerHTML = `做得好！接下来学习：${nextLvl.title}`;
        nextBtn.textContent = "下一步 ➡️";
        nextBtn.onclick = teachNextLevel;
        nextBtn.style.display = "";
        exitBtn.style.display = "";
        practiceBtn.style.display = "none";
        AudioFX.win();
    }
    modal.classList.add("visible");
    let bubble = document.getElementById("teachBubble");
    if (bubble) {
        bubble.classList.remove("visible");
        void bubble.offsetWidth;
        bubble.classList.add("visible", "mines-only");
    }
}

function teachNextLevel() {
    AudioFX.confirm();
    document.getElementById("teachCompleteModal").classList.remove("visible");
    if (teachLevelIdx < TEACH_LEVELS.length - 1) {
        teachLevelIdx++;
        teachStepIdx = 0;
        loadTeachLevel();
    } else {
        document.getElementById("teachProgressBar").style.display = "none";
    }
}

function teachExit() {
    AudioFX.confirm();
    document.querySelector(".panel").style.display = "flex";
    teachRulePending = false;
    document.getElementById("teachRuleModal").style.display = "none";
    document.getElementById("teachCompleteModal").classList.remove("visible");
    document.getElementById("teachBubble").classList.remove("visible", "mines-only");
    clearTeachSlotHost();
    document.querySelectorAll(".cell-teach-target").forEach(el => el.classList.remove("cell-teach-target"));
    teachActive = false;
    document.getElementById("teachProgressBar").style.display = "none";
    applyStandardParams();
    fullReset();
    genGame();
    render();
    renderRecordList();
    document.getElementById("win").style.display = "none";
}

function teachExitToPractice() {
    AudioFX.confirm();
    document.querySelector(".panel").style.display = "flex";
    teachRulePending = false;
    document.getElementById("teachRuleModal").style.display = "none";
    document.getElementById("teachCompleteModal").classList.remove("visible");
    document.getElementById("teachBubble").classList.remove("visible", "mines-only");
    clearTeachSlotHost();
    document.querySelectorAll(".cell-teach-target").forEach(el => el.classList.remove("cell-teach-target"));
    document.getElementById("teachProgressBar").style.display = "none";
    teachActive = false;
    teachPlacedCount = 0;
    teachExpectedCount = 0;
    teachPlaceList = [];
    teachPlacedTypes = {};
    applyStandardParams();
    currentTutorialType = null;
    isTutorialMode = true;
    tutorialStep = parseInt(Store.get("tutorialStep")) || 0;
    setupTutorialBoard(null);
}
