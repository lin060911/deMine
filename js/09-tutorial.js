/* ==========================================================================
 * 模块 09 · 挑战与教学关卡（js/09-tutorial.js）
 *
 * 职责：实现基础挑战（5 关）、各系列挑战（5 关）与新手引导教学
 *       （TEACH_LEVELS 共 11 关）的全流程，包括关卡数据、棋盘生成、
 *       放雷与判定、进度持久化和关卡切换。
 * 依赖：00-core 的全局状态与工具（RM、G、SR / SC）；01-storage 的 Store；
 *       02-audio 的 AudioFX；04-mines 的 M 与 CATEGORY；06-render 的通用渲染
 *       函数；08-ui 的弹窗与系列解锁接口。
 * 对外：全局函数 startTutorial、startCategoryTutorial、openTeachMode、
 *       teachDrop、onTutorialWin 等，供主界面按钮与其它模块调用。
 * 设计要点：
 *   1) 每个关卡的"正确答案"是一张目标影响值矩阵 targetBoard；玩家放雷后
 *      由各雷种的影响函数重算 G.p，逐格与目标矩阵相等才算过关。
 *   2) 挑战与教学共用同一套棋盘渲染与放置通道，用 teachActive 与
 *      currentTutorialType 区分当前处于哪一种流程。
 *   3) 挑战进度写入 Store，重新打开页面仍能从上次的关卡继续。
 * ========================================================================== */

/* ---------- 1. 挑战通关推进 ---------- */

/**
 * 挑战（基础 / 系列）通关后的推进：累计进度、解锁系列、进入下一关。
 * 第 5 关通关时弹出完成弹窗，否则显示轻提示并自动切到下一关。
 * @sideeffect 写入 Store 中的挑战进度，切换棋盘并可能解锁系列
 */
function onTutorialWin() {
    tutorialStep++;
    let cat = currentTutorialType;
    if (!cat) Store.set("tutorialStep", tutorialStep.toString()); else Store.set("tutorial_" + cat, tutorialStep.toString());
    updateTutorialProgress();
    // 第 5 关即整个挑战的终点：先解锁对应系列，再弹出总结弹窗
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
        // 结算阶段隐藏进度条，避免与完成弹窗叠在一起
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

/**
 * 开始（或继续）基础挑战：从 Store 读取已通关的关卡数，直接进入对应关卡。
 * @sideeffect 关闭遮罩，设置挑战模式状态并初始化挑战棋盘
 */
function startTutorial() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("tutorialPrompt").style.display = "none";
    // currentTutorialType 为 null 表示"基础挑战"，非 null 表示系列挑战
    currentTutorialType = null;
    isTutorialMode = true;
    tutorialStep = parseInt(Store.get("tutorialStep")) || 0;
    setupTutorialBoard(null);
}

/**
 * 教学入口的分流：有未完成的基础挑战进度时继续该进度，否则从头开始。
 * @sideeffect 可能直接初始化棋盘，也可能转交给 startTutorial
 */
function openTutorialSelector() {
    if (isTutorialMode) return;
    AudioFX.confirm();
    let bs = Store.get("tutorialStep");
    // 1~4 关属于进行中的挑战：直接续玩，不重走开场引导
    if (bs && parseInt(bs) > 0 && parseInt(bs) < 5) {
        currentTutorialType = null;
        isTutorialMode = true;
        tutorialStep = parseInt(bs);
        setupTutorialBoard(null);
        return;
    }
    startTutorial();
}

/* ---------- 2. 挑战棋盘初始化与门禁 ---------- */

/**
 * 初始化一局挑战：固定 10×10、共 5 颗雷的专属配比，生成题目并渲染棋盘。
 * @param {string|null} catKey 系列键；null 表示基础挑战
 * @sideeffect 重置棋局、写入棋盘参数与挑战状态，渲染棋盘
 */
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

/**
 * 刷新挑战进度条与标题：基础挑战与各系列挑战分别读取自己的进度。
 * @param {string|null} catKey 系列键；null 表示基础挑战
 * @sideeffect 显示进度条，写入 tutorialStep 与标题文本
 */
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

/**
 * 按已通关关数刷新进度条宽度与"n/5"文字。
 * @sideeffect 修改进度条填充宽度与文本
 */
function updateTutorialProgress() {
    document.getElementById("tutorialProgressFill").style.width = tutorialStep / 5 * 100 + "%";
    document.getElementById("tutorialProgressText").textContent = tutorialStep + "/5";
}

/**
 * 系列挑战的前置门禁：基础挑战未通关时弹出说明框，引导玩家先去完成基础挑战。
 * @param {string} catKey 被点击的系列键
 * @sideeffect 播放锁定音效并打开确认弹窗
 */
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

/**
 * 开始某个系列的挑战：先过基础挑战门禁，再续玩该系列自己的进度。
 * @param {string} catKey 系列键
 * @sideeffect 关闭遮罩、设置挑战状态并初始化棋盘
 */
function startCategoryTutorial(catKey) {
    AudioFX.confirm();
    // 门禁：基础挑战未完成时，系列挑战一律不可进入
    if (catKey && !isBasicChallengeDone()) {
        showBasicRequiredModal(catKey);
        return;
    }
    currentTutorialType = catKey;
    isTutorialMode = true;
    // 已解锁的系列续玩本系列进度，未解锁的系列从第 0 关开始
    tutorialStep = seriesUnlocked[catKey] ? parseInt(Store.get("tutorial_" + catKey)) || 0 : 0;
    document.getElementById("overlay").style.display = "none";
    setupTutorialBoard(catKey);
}

/* ---------- 3. 教学关卡数据表（一）：基础机制 10 关 ---------- */

/**
 * 教学关卡表：每一关演示一类影响范围规则，玩家按提示把雷放到正确位置。
 * 字段说明：
 *   title / icon   关卡标题与图标；
 *   mineType(s)    本关可用的雷种及数量（单雷种用 mineType，多雷种用 mineTypes）；
 *   boardRows/Cols 本关棋盘尺寸；
 *   targetBoard    目标影响值矩阵，0 表示该格不显示数字；
 *   steps          分步提示：text 为气泡正文，hint 为底部提示，
 *                  targetCell 为需要高亮的目标格 [行, 列]。
 * 本表是纯数据，增删关卡只需修改它，无需改动下面的流程代码。
 */
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
    // 两颗雷的影响范围重叠时数值相加，用于演示"叠加"
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
    // 正雷与负雷重叠时数值抵消，用于演示"相加为 0"
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
    /* ---------- 4. 教学关卡数据表（二）：综合关 ---------- */

    // 综合关：8×8 棋盘 + 四种雷同场，提示明显减少，检验前面所有机制
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

/* ---------- 5. 教学运行状态 ---------- */

// 教学模块的运行时状态：是否处于教学流程、当前关卡与步骤、已放置的雷等。
// 这些变量只在内存中维护，进度持久化由 Store 与关卡表负责。

// 是否处于教学流程中；syncMainPanel 依赖它决定主按钮条显隐
let teachActive = false;

// 当前关卡在 TEACH_LEVELS 中的下标
let teachLevelIdx = 0;

// 当前关卡内的提示步骤下标
let teachStepIdx = 0;

// 本关已放置的雷总数
let teachPlacedCount = 0;

// 本关需要放置的雷总数，由关卡配比表求和得到
let teachExpectedCount = 0;

// 本关各类雷的已放置数量，键为雷种
let teachPlacedTypes = {};

// 本关各类雷的应放置数量，键为雷种
let teachExpectedTypes = {};

// 已放置雷的坐标与类型列表，用于每次重算影响值时重新施加
let teachPlaceList = [];

// 已完成的关卡记录
let teachCompleted = [];

// 规则弹窗是否处于"看明白后立即开始教学"的等待状态
let teachRulePending = false;

// 规则弹窗的兜底文案：页面中的规则条目抽取失败时直接使用这一份
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

/* ---------- 6. 教学规则弹窗 ---------- */

/**
 * 从信息栏的规则条目中抽取"目标 / 胜利条件 / 地块状态"三段内容，
 * 重新组织成教学规则弹窗的 HTML；任一段缺失时退回内置文案。
 * @returns {string} 可直接写入容器 innerHTML 的规则片段
 */
function buildTeachRuleContent() {
    const box = document.querySelector("#infoSidebar .rule-content");
    let goalHTML = "", winHTML = "", stateHTML = "";
    if (box) {
        // 去掉条目自带的强调标题，只保留正文，便于按统一版式重新排版
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
    // 任一区块抽取失败就整体退回内置文案，保证弹窗始终有内容
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

/**
 * 打开教学规则弹窗：每次打开都重新抽取规则内容，按钮文案随场景变化。
 * @param {boolean} playSound 是否播放弹窗打开音效（教学自动弹出时静音）
 * @sideeffect 写入弹窗内容并显示遮罩
 */
function openTeachRuleModal(playSound) {
    const modal = document.getElementById("teachRuleModal");
    if (!modal) return;
    const body = document.getElementById("teachRuleBody");
    if (body) {
        body.innerHTML = buildTeachRuleContent();
        // 每次打开都回到顶部，避免沿用上次的滚动位置
        body.scrollTop = 0;
    }
    const okBtn = document.getElementById("teachRuleOkBtn");
    // 由教学入口打开时，确认按钮的文案跟随"看完是否立即开始教学"
    if (okBtn) okBtn.textContent = teachRulePending ? "我明白了，开始教学 ▶" : "知道了 ✌️";
    document.getElementById("overlay").style.display = "block";
    modal.style.display = "block";
    if (playSound) AudioFX.modalOpen();
}

/**
 * 隐藏教学规则弹窗；若正处于"看完即开始"的等待状态，则顺势装载第一关。
 * @sideeffect 隐藏弹窗与遮罩，可能调用 loadTeachLevel
 */
function hideTeachRuleModal() {
    const modal = document.getElementById("teachRuleModal");
    if (modal) modal.style.display = "none";
    document.getElementById("overlay").style.display = "none";
    if (teachRulePending) {
        teachRulePending = false;
        // 只有仍在教学流程里才装载关卡，避免退出教学后又被拉回来
        if (teachActive) loadTeachLevel();
    }
}

/**
 * 规则弹窗的关闭按钮入口：播放确认音效后统一走 hideTeachRuleModal。
 */
function closeTeachRuleModal() {
    AudioFX.confirm();
    hideTeachRuleModal();
}

/* ---------- 7. 教学模式入口 ---------- */

/**
 * 进入新手引导教学：清空所有教学状态，先展示规则弹窗，确认后从第 1 关开始。
 * @sideeffect 重置教学状态、隐藏主面板与棋盘，打开规则弹窗
 */
function openTeachMode() {
    AudioFX.confirm();
    // 每次进入都从第 1 关、第 1 步开始，不复用上次的进度
    teachLevelIdx = 0;
    teachStepIdx = 0;
    teachPlacedCount = 0;
    teachExpectedCount = 0;
    teachPlaceList = [];
    teachPlacedTypes = {};
    fullReset();
    teachActive = true;
    syncMainPanel();
    // 教学关卡的棋盘尺寸由各关的 boardRows/boardCols 决定，这里先给默认值
    S = 5;
    SR = 5;
    SC = 5;
    document.getElementById("overlay").style.display = "none";
    document.getElementById("teachProgressBar").style.display = "flex";
    updateTeachProgressBar();
    ensureTeachSlotHost(true);
    document.getElementById("board").innerHTML = "";
    document.getElementById("slot").style.display = "none";
    // 标记"规则看完即开始"，由 hideTeachRuleModal 触发第一关装载
    teachRulePending = true;
    openTeachRuleModal(false);
}

/**
 * 从主界面直接开始基础挑战（练习入口）。
 * @sideeffect 转交给 startTutorial
 */
function openPracticeMode() {
    AudioFX.confirm();
    startTutorial();
}

/* ---------- 8. 关卡装载与棋盘渲染 ---------- */

/**
 * 按 teachLevelIdx 装载当前关卡：写入目标矩阵、配比表并渲染棋盘与步骤。
 * @sideeffect 重置 G 中的棋局数据，重绘棋盘、槽位、提示气泡与进度条
 */
function loadTeachLevel() {
    let lvl = TEACH_LEVELS[teachLevelIdx];
    teachActive = true;
    syncMainPanel();
    SR = lvl.boardRows;
    SC = lvl.boardCols;
    S = 5;
    // 目标矩阵必须深拷贝，否则玩家放置时会直接改到关卡数据本身
    G.tar = lvl.targetBoard.map(row => row.slice());
    G.p = Array(SR).fill().map(() => Array(SC).fill(0));
    G.placed = {};
    teachPlaceList = [];
    teachPlacedTypes = {};
    // 单雷种关卡没有 mineTypes，这里统一折算成 { 雷种: 1 } 的配比表
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
    // 教学关卡不显示胜利遮罩，也不启动计时
    document.getElementById("win").style.display = "none";
    document.getElementById("timer").style.display = "none";
    document.getElementById("placed").textContent = "0";
    document.getElementById("max").textContent = String(teachExpectedCount);
}

// 最近一次落雷的坐标键：只给这一颗播放下落动画，后续重绘不会重播
let _teachLastDropKey = null;

/**
 * 渲染教学关卡棋盘：每格同时体现目标值、当前影响值与三色状态。
 * @sideeffect 重建 #board 的子节点并绑定点击 / 右键 / 拖放事件
 */
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
            // 三色状态：等于目标为绿，低于目标为黄，高于目标为红
            if (p === t) d.classList.add("cell-valid"); else if (p < t) d.classList.add("cell-low"); else if (p > t) d.classList.add("cell-over");
            // 目标值非 0 的格子才显示数字，并挂上数值对应的配色类
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
            // 角标显示该格当前影响值，与目标值的差异由三色状态体现
            appendInfluenceBadge(d, p, t);
            // 点选放置：优先用槽位选中的类型，否则自动挑一个还有剩余的雷种
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
            // 右键即删除该格的雷，方便玩家反复试错
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

/* ---------- 9. 教学槽位与落子 ---------- */

/**
 * 渲染教学关卡的地雷槽位：每个雷种显示图标、名称与"已放/应放"数量。
 * 槽位挂在教学气泡内部，使提示与可选雷种保持在同一视觉块中。
 * @sideeffect 重建 #slot 内除气泡外的子节点
 */
function renderTeachSlot() {
    let lvl = TEACH_LEVELS[teachLevelIdx];
    let s = document.getElementById("slot");
    let bubble = document.getElementById("teachBubble");
    let minesBox = null;
    if (bubble) {
        // 气泡是常驻节点，容器被清空前先把它放回 #slot
        if (bubble.parentElement !== s) s.appendChild(bubble);
        minesBox = document.getElementById("teachBubbleMines");
        if (!minesBox) {
            minesBox = document.createElement("div");
            minesBox.className = "teach-bubble-mines";
            minesBox.id = "teachBubbleMines";
            bubble.appendChild(minesBox);
        }
        // 除气泡外清空容器，槽位条目每次重新生成
        Array.prototype.slice.call(s.children).forEach(function(ch) {
            if (ch !== bubble) s.removeChild(ch);
        });
        minesBox.innerHTML = "";
    }
    s.style.display = "";
    ensureTeachSlotHost();
    // 单雷种关卡没有 mineTypes，这里统一折算成 { 雷种: 1 } 的配比表
    let mt = lvl.mineTypes || (lvl.mineType ? {
        [lvl.mineType]: 1
    } : {});
    for (let t in mt) {
        let expected = mt[t];
        let placed = teachPlacedTypes[t] || 0;
        let div = document.createElement("div");
        // 已放满的雷种置灰，既提示数量也已阻止继续放置
        let disabled = placed >= expected;
        div.className = "mine-item" + (disabled ? " disabled" : "") + (window._teachSelectedType === t ? " selected" : "");
        div.dataset.tip = M[t].tip;
        div.dataset.mineType = t;
        div.innerHTML = `<div class="emoji-drag ${M[t].cls}">${M[t].e}</div><div>${M[t].n}</div><div>${placed}/${expected}</div>`;
        bindSlotItemDrag(div, t, "teach");
        if (minesBox) minesBox.appendChild(div); else s.appendChild(div);
    }
}

/**
 * 确保 #slot 带有教学专用类名；replay 为 true 时先摘除再添加以重播动画。
 * @param {boolean} replay 是否需要重播入场动画
 * @sideeffect 切换 #slot 的 teach-slot-host 类
 */
function ensureTeachSlotHost(replay) {
    let s = document.getElementById("slot");
    if (!s) return;
    if (replay) {
        s.classList.remove("teach-slot-host");
        // 读取布局属性强制重排，使移除再添加类名后动画能重新播放
        void s.offsetWidth;
    }
    s.classList.add("teach-slot-host");
}

/**
 * 移除 #slot 上的教学专用类名，退出教学时调用。
 * @sideeffect 移除 teach-slot-host 类
 */
function clearTeachSlotHost() {
    let s = document.getElementById("slot");
    if (s) s.classList.remove("teach-slot-host");
}

/* ---------- 10. 删除、移动与完成检查 ---------- */

/**
 * 在教学关卡中放置一颗雷：登记坐标与类型，重算影响值并推进提示。
 * @param {number} r 行号
 * @param {number} c 列号
 * @param {string} forceType 指定雷种；省略时取槽位选中类型或自动挑一个
 * @sideeffect 写入 G.placed、G.p 与教学统计，重绘棋盘与槽位
 */
function teachDrop(r, c, forceType) {
    let lvl = TEACH_LEVELS[teachLevelIdx];
    let k = r + "," + c;
    // 目标格已有雷时不覆盖，避免误操作破坏已摆好的布局
    if (G.placed[k]) return;
    let dragType = forceType || window._teachSelectedType || null;
    window._teachSelectedType = null;
    renderTeachSlot();
    if (!dragType) {
        // 没有选中类型时，按配比表自动挑一个还有剩余的雷种
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
    // 记住本次落点，渲染时只给这一颗播放下落动画
    _teachLastDropKey = k;
    teachPlaceList.push({
        r: r,
        c: c,
        type: dragType
    });
    teachPlacedTypes[dragType] = (teachPlacedTypes[dragType] || 0) + 1;
    teachPlacedCount++;
    AudioFX.place();
    // 影响值按"清零 → 重放所有已放置的雷 → 叠加战术效果"的顺序重算，
    // 因此结果与放置顺序无关
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
        // 雷已放满：逐格比对，全部匹配即过关，否则停在当前局面等待调整
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
        // 还没放满则推进到下一条提示，最多停在最后一步
        let steps = lvl.steps || [];
        teachStepIdx = Math.min(teachStepIdx + 1, steps.length - 1);
        showTeachStep(false);
    }
}

/**
 * 删除教学关卡中某格的雷，并重算影响值。
 * @param {number} r 行号
 * @param {number} c 列号
 * @sideeffect 同步更新放置列表与统计，并把提示退回到第一步
 */
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
    // 删除后提示回到第一步，让玩家重新按引导操作
    teachStepIdx = 0;
    showTeachStep(false);
}

/**
 * 把教学关卡中已有的雷从 fromKey 移到目标格，用于拖拽重定位。
 * @param {string} fromKey 源格坐标键 "r,c"
 * @param {number} r 目标行号
 * @param {number} c 目标列号
 * @sideeffect 同步放置列表并重算影响值，最后检查是否过关
 */
function teachMove(fromKey, r, c) {
    const toKey = r + "," + c;
    const t = G.placed[fromKey];
    // 源格无雷、目标格已有雷或原地不动时都直接返回
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

/**
 * 检查教学关卡是否已满足过关条件：雷数放满且各格影响值与目标一致。
 * 移动雷之后调用，相等则播放过关流程。
 * @sideeffect 过关时显示正确提示并延时进入关卡完成流程
 */
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

/* ---------- 11. 提示气泡与进度条 ---------- */

/**
 * 刷新教学气泡：显示当前步骤的提示文字、图标与目标格高亮。
 * @param {boolean} isCorrect 本次放置是否正确；true 时气泡切换为过关文案
 * @sideeffect 改写气泡内四个文本节点与目标格高亮类
 */
function showTeachStep(isCorrect) {
    let lvl = TEACH_LEVELS[teachLevelIdx];
    let bubble = document.getElementById("teachBubble");
    // 先摘除再添加 visible，配合强制重排让气泡重新播放入场动画
    bubble.classList.remove("visible", "mines-only");
    void bubble.offsetWidth;
    bubble.classList.add("visible");
    let steps = lvl.steps || [];
    let stepIdx = Math.min(teachStepIdx, steps.length - 1);
    // 步骤下标越界时退回第一步，保证气泡始终有内容
    let step = steps[stepIdx] || steps[0] || {
        text: "",
        hint: ""
    };
    if (isCorrect) {
        // 过关文案：与普通提示区分，避免玩家误以为还需要继续放置
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
    // 每次只高亮当前步骤的目标格，切换前先清掉上一处高亮
    document.querySelectorAll(".cell-teach-target").forEach(el => el.classList.remove("cell-teach-target"));
    if (step.targetCell && !isCorrect) {
        let [tr, tc] = step.targetCell;
        let cellEl = document.querySelector(`.cell[data-r="${tr}"][data-c="${tc}"]`);
        if (cellEl) cellEl.classList.add("cell-teach-target");
    }
}

/**
 * 显示一条气泡消息：固定切到第 2 步（提示步）后刷新气泡。
 * @param {string} text 消息文本（当前实现由步骤表提供文案）
 */
function showTeachBubbleMsg(text) {
    teachStepIdx = 1;
    showTeachStep(false);
}

/**
 * 刷新教学总进度条：按已完成关卡数计算百分比与"当前关/总关数"文字。
 * @sideeffect 修改进度条填充宽度与文本
 */
function updateTeachProgressBar() {
    let bar = document.getElementById("teachProgressBar");
    if (!bar) return;
    let total = TEACH_LEVELS.length;
    let pct = Math.round(teachLevelIdx / total * 100);
    document.getElementById("teachProgressFill").style.width = pct + "%";
    document.getElementById("teachProgressText").textContent = teachLevelIdx + 1 + "/" + total;
}

/* ---------- 12. 关卡完成与退出 ---------- */

/**
 * 关卡完成：按是否为最后一关切换弹窗文案与按钮（下一关 / 完成 / 去练习）。
 * @sideeffect 显示完成弹窗、播放对应音效，并可能解锁成就
 */
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
        // 最后一关：主按钮变为"完成"，隐藏退出、显示"去练习"
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
        // 非最后一关：主按钮进入下一关，"退出"和"练习"保持可用
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
        // 气泡收成只剩雷种列表，避免遮住完成弹窗
        bubble.classList.remove("visible");
        void bubble.offsetWidth;
        bubble.classList.add("visible", "mines-only");
    }
}

/**
 * 进入下一关：重置步骤下标后重新装载关卡；已是最后一关则收起进度条。
 * @sideeffect 更新 teachLevelIdx 并调用 loadTeachLevel
 */
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

/**
 * 退出教学模式，回到标准参数的普通棋局。
 * @sideeffect 清理教学相关的类名与遮罩，重置参数并重开一局
 */
function teachExit() {
    AudioFX.confirm();
    teachRulePending = false;
    document.getElementById("teachRuleModal").style.display = "none";
    document.getElementById("teachCompleteModal").classList.remove("visible");
    document.getElementById("teachBubble").classList.remove("visible", "mines-only");
    clearTeachSlotHost();
    document.querySelectorAll(".cell-teach-target").forEach(el => el.classList.remove("cell-teach-target"));
    teachActive = false;
    syncMainPanel();
    document.getElementById("teachProgressBar").style.display = "none";
    // 回到标准参数后重开一局，界面与计时器都回到常规状态
    applyStandardParams();
    fullReset();
    genGame();
    render();
    renderRecordList();
    document.getElementById("win").style.display = "none";
}

/**
 * 完成全部教学后直接转到基础挑战：先清理教学现场，再初始化挑战棋盘。
 * @sideeffect 重置教学统计与参数，调用 setupTutorialBoard 开始基础挑战
 */
function teachExitToPractice() {
    AudioFX.confirm();
    teachRulePending = false;
    document.getElementById("teachRuleModal").style.display = "none";
    document.getElementById("teachCompleteModal").classList.remove("visible");
    document.getElementById("teachBubble").classList.remove("visible", "mines-only");
    clearTeachSlotHost();
    document.querySelectorAll(".cell-teach-target").forEach(el => el.classList.remove("cell-teach-target"));
    document.getElementById("teachProgressBar").style.display = "none";
    teachActive = false;
    syncMainPanel();
    // 清空教学统计，避免带入基础挑战
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
