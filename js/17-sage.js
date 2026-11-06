/* ==========================================================================
 * 模块 17 · 主线任务 / 地雷仙人 / 积分商店 / 外观（js/17-sage.js）
 *
 * 职责：把"门槛驱动"改写成"任务 → 奖励驱动"。
 *   1) 主线任务（9 环）与支线（6 条）：条件全部读现有状态，不新造进度；
 *   2) 新门禁 N1（教学 → 基础挑战）与 N2（基础挑战 → 中等）的统一判定；
 *   3) 地雷仙人：小盆栽、第 5 个侧栏、任务卡 / 验收单 / 通行条件弹窗；
 *   4) 火药积分（成就 + 任务 + 章节 − 已购）与商店、衣柜、页面背景、雷 emoji。
 *
 * 依赖：Store（01）、RM（00）、Achievements（13）、M（04）、
 *      wins / rec / seriesUnlocked / seriesState（00/01）、
 *      isBasicChallengeDone / getSeriesOnCount / checkBrainUnlocked（08）、
 *      renderMineInfo / updatePresetButtons（05/08）、openTeachMode /
 *      openPracticeMode（09）、render / renderSlot（06）。
 * 设计要点：
 *   1) 判定优先"条件驱动"：同一状态重复判定不会累加，启动开两局也安全；
 *   2) 积分不存余额：earned − spent 现算，老档读入自动补分、导入不漂移；
 *   3) 伪奖励（解锁）由原规则生效，本模块只负责宣布；真奖励靠"复命"领取；
 *   4) UI 缺失 / 其他模块未加载时全部降级为空操作，保证游戏本身仍可玩。
 * ========================================================================== */

(function() {
    "use strict";

    /* ---------- 1. 常量与数据 ---------- */

    var QUEST_KEY = "rmMainQuest_v1";
    var LOOKS_KEY = "rmLooks_v1";

    // 新门禁总开关：调试时可单独关闭，回到旧行为
    var NEW_GATES = {
        basicRequiresTeaching: true,   // N1：教学完成 → 基础挑战
        mediumRequiresBasic: true      // N2：基础挑战 5 关 → 中等难度
    };

    // 隐藏成就 id（成就积分与支线 S3 判定用）
    var HIDDEN_IDS = [
        "hidden_slide", "hidden_chaos", "hidden_flawless", "hidden_eco", "free_20x20",
        "brain_slow", "bgm_adjust", "new_game_spam", "crazy_thursday", "hidden_grass",
        "hidden_icecream", "hidden_highvalue", "hidden_lowvalue", "hidden_teatime"
    ];

    // 章节：taskIds 全部复命即完成，发放 bonus 积分与称号
    var CHAPTERS = [
        { id: 1, name: "第一章 · 认雷", taskIds: [ "m1", "m2" ], bonus: 40, title: "见习工程师" },
        { id: 2, name: "第二章 · 认全五种雷", taskIds: [ "m3", "m4", "m5" ], bonus: 60, title: "排雷工程师" },
        { id: 3, name: "第三章 · 渡劫", taskIds: [ "m6", "m7", "m8" ], bonus: 100, title: "雷区传奇" }
    ];

    /* 主线 9 环（M9 = 第三章完成，由 chapterDone 自动结算，避免与 M8 双计） */
    var MAIN_QUESTS = [
        {
            id: "m1", ch: 1, task: "走完教学 12 关", points: 40,
            unlock: "🎓 基础挑战", reward: "40 积分", items: [],
            cond: function() { return teachingDone(); },
            progress: function() { return Math.min(teachProgress(), 12) + " / 12"; }
        },
        {
            id: "m2", ch: 1, task: "通关基础挑战 5 关", points: 80,
            unlock: "系列挑战入口 · 😮 中等难度", reward: "80 积分 + 🌵 普通雷皮肤",
            items: [ "mine_cactus" ],
            cond: function() { return basicChallengeDone(); },
            progress: function() { return Math.min(tutorialStepNum(), 5) + " / 5"; }
        },
        {
            id: "m3", ch: 2, task: "通关任一系列挑战 5 关", points: 70,
            unlock: "该系列雷种 + 系列开关", reward: "70 积分 + 棋盘背景「竹林」（占位）",
            items: [ "board_bamboo" ],
            cond: function() { return nonBasicUnlocked() >= 1; },
            progress: function() { return nonBasicUnlocked() + " / 1"; }
        },
        {
            id: "m4", ch: 2, task: "解锁并开启 3 个系列", points: 80,
            unlock: "😤 困难", reward: "80 积分", items: [],
            cond: function() { return seriesOnCount() >= 3; },
            progress: function() { return seriesOnCount() + " / 3"; }
        },
        {
            id: "m5", ch: 2, task: "解锁并开启全部 5 个系列", points: 100,
            unlock: "👿 地狱", reward: "100 积分 + 🌇 页面背景「晚霞」",
            items: [ "page_sunset" ],
            cond: function() { return seriesOnCount() >= 5; },
            progress: function() { return seriesOnCount() + " / 5"; }
        },
        {
            id: "m6", ch: 3, task: "地狱首次通关", points: 60,
            unlock: "—", reward: "60 积分", items: [],
            cond: function() { return hellWins() >= 1; },
            progress: function() { return hellWins() + " / 1"; }
        },
        {
            id: "m7", ch: 3, task: "解锁脑王（地狱 10 胜 + 5 系列开启）", points: 100,
            unlock: "🤯 脑王", reward: "100 积分 + 棋盘背景「星图」（占位）",
            items: [ "board_star" ],
            cond: function() { return isBrainUnlocked(); },
            progress: function() { return "地狱 " + hellWins() + "/10 · 系列 " + seriesOnCount() + "/5"; }
        },
        {
            id: "m8", ch: 3, task: "通关脑王", points: 200,
            unlock: "—", reward: "200 积分 + 🌠 页面背景「天宫」",
            items: [ "page_sky" ],
            cond: function() { return brainWinDone(); },
            progress: function() { return brainWinDone() ? "已通关" : "未通关"; }
        },
        {
            id: "m9", ch: 3, task: "主线完结（复命即完成）", points: 0,
            unlock: "—", reward: "第三章章节奖励：100 积分 + 称号「雷区传奇」", items: [],
            cond: function() { return chapterTasksDone(3); },
            progress: function() { return chapterTasksDone(3) ? "可复命" : "完成第三章"; }
        }
    ];

    /* 支线 6 条：不占章节，给积分或限定外观 */
    var SIDE_QUESTS = [
        {
            id: "s1", ch: 0, task: "创造模式出第一张题", points: 30,
            unlock: "—", reward: "30 积分", items: [],
            cond: function() { return !!unlockedMap().create_first; },
            progress: function() { return unlockedMap().create_first ? "已完成" : "未完成"; }
        },
        {
            id: "s2", ch: 0, task: "通关一张分享码题目", points: 30,
            unlock: "—", reward: "30 积分", items: [],
            cond: function() { return sharedWins() >= 1; },
            progress: function() { return sharedWins() + " / 1"; }
        },
        {
            id: "s3", ch: 0, task: "解锁 3 个隐藏成就", points: 50,
            unlock: "—", reward: "50 积分 + 👾 普通雷皮肤", items: [ "mine_alien" ],
            cond: function() { return hiddenCount() >= 3; },
            progress: function() { return hiddenCount() + " / 3"; }
        },
        {
            id: "s4", ch: 0, task: "自由模式 20×20 通关", points: 40,
            unlock: "—", reward: "40 积分", items: [],
            cond: function() { return !!unlockedMap().free_20x20; },
            progress: function() { return unlockedMap().free_20x20 ? "已完成" : "未完成"; }
        },
        {
            id: "s5", ch: 0, task: "拿到任意一个速通成就", points: 40,
            unlock: "—", reward: "40 积分", items: [],
            cond: function() { return anySpeedRun(); },
            progress: function() { return anySpeedRun() ? "已完成" : "未完成"; }
        },
        {
            id: "s6", ch: 0, task: "累计通关 20 局", points: 30,
            unlock: "—", reward: "30 积分", items: [],
            cond: function() { return totalWins() >= 20; },
            progress: function() { return totalWins() + " / 20"; }
        }
    ];

    var ALL_QUESTS = MAIN_QUESTS.concat(SIDE_QUESTS);

    /* 商店（页面背景 / 雷皮肤 / 棋盘背景占位） */
    var SHOP = [
        { id: "mine_cat", type: "mineSkin", name: "😺 猫猫雷", emoji: "😺", price: 60 },
        { id: "mine_fire", type: "mineSkin", name: "🔥 火焰雷", emoji: "🔥", price: 60 },
        { id: "mine_egg", type: "mineSkin", name: "🥚 蛋蛋雷", emoji: "🥚", price: 60 },
        { id: "mine_gem", type: "mineSkin", name: "💎 宝石雷", emoji: "💎", price: 60 },
        { id: "mine_melon", type: "mineSkin", name: "🍉 西瓜雷", emoji: "🍉", price: 60 },

        { id: "page_night", type: "pageBg", name: "夜雷区", cls: "rm-pagebg-night", price: 150, swatch: "#1b2440" },
        { id: "page_field", type: "pageBg", name: "麦田", cls: "rm-pagebg-field", price: 150, swatch: "#d8c98a" },
        { id: "page_aurora", type: "pageBg", name: "极光", cls: "rm-pagebg-aurora", price: 150, swatch: "#4fd1c5" },
        { id: "page_storm", type: "pageBg", name: "雷暴", cls: "rm-pagebg-storm", price: 150, swatch: "#5a6b8c" },

        { id: "board_dune", type: "boardBg", name: "沙丘", price: 180, placeholder: true, swatch: "#d9b26f" },
        { id: "board_snow", type: "boardBg", name: "雪原", price: 180, placeholder: true, swatch: "#dfe9f3" },
        { id: "board_lava", type: "boardBg", name: "熔岩", price: 180, placeholder: true, swatch: "#b5543b" },
        { id: "board_deep", type: "boardBg", name: "深海", price: 180, placeholder: true, swatch: "#2b4a6b" }
    ];

    /* 任务限定物品：不进商店，只由任务复命获得 */
    var LIMITED_ITEMS = {
        mine_cactus: { id: "mine_cactus", type: "mineSkin", name: "🌵 仙人雷", emoji: "🌵" },
        mine_alien: { id: "mine_alien", type: "mineSkin", name: "👾 异形雷", emoji: "👾" },
        page_sunset: { id: "page_sunset", type: "pageBg", name: "晚霞", cls: "rm-pagebg-sunset" },
        page_sky: { id: "page_sky", type: "pageBg", name: "天宫", cls: "rm-pagebg-sky" },
        board_bamboo: { id: "board_bamboo", type: "boardBg", name: "竹林", placeholder: true },
        board_star: { id: "board_star", type: "boardBg", name: "星图", placeholder: true }
    };

    // 任务限定物品的展示顺序（不进商店，只靠复命获得）
    var LIMITED_ORDER = [
        "mine_cactus", "mine_alien", "page_sunset", "page_sky", "board_bamboo", "board_star"
    ];

    var ITEM_MAP = {};
    SHOP.forEach(function(it) { ITEM_MAP[it.id] = it; });
    (function() {
        for (var k in LIMITED_ITEMS) {
            if (Object.prototype.hasOwnProperty.call(LIMITED_ITEMS, k)) ITEM_MAP[k] = LIMITED_ITEMS[k];
        }
    })();

    var PAGE_BG_CLASSES = [
        "rm-pagebg-sunset", "rm-pagebg-sky", "rm-pagebg-night",
        "rm-pagebg-field", "rm-pagebg-aurora", "rm-pagebg-storm"
    ];

    /* ---------- 2. 运行期状态 ---------- */

    var questState = null;     // rmMainQuest_v1
    var looksState = null;     // rmLooks_v1
    var inited = false;
    var _refreshing = false;
    var _tab = "tasks";

    function isPlainObj(v) {
        return !!v && typeof v === "object" && !Array.isArray(v);
    }

    function nowISO() {
        return (new Date).toISOString().slice(0, 10);
    }

    function defaultQuest() {
        return { v: 1, done: {}, claimed: {}, flags: {} };
    }

    function defaultLooks() {
        return { v: 1, owned: {}, equipped: { pageBg: "", boardBg: "", mineSkin: "" } };
    }

    function normalize() {
        if (!isPlainObj(questState)) questState = defaultQuest();
        if (!isPlainObj(questState.done)) questState.done = {};
        if (!isPlainObj(questState.claimed)) questState.claimed = {};
        if (!isPlainObj(questState.flags)) questState.flags = {};
        if (!isPlainObj(looksState)) looksState = defaultLooks();
        if (!isPlainObj(looksState.owned)) looksState.owned = {};
        if (!isPlainObj(looksState.equipped)) looksState.equipped = { pageBg: "", boardBg: "", mineSkin: "" };
        if (typeof looksState.equipped.pageBg !== "string") looksState.equipped.pageBg = "";
        if (typeof looksState.equipped.boardBg !== "string") looksState.equipped.boardBg = "";
        if (typeof looksState.equipped.mineSkin !== "string") looksState.equipped.mineSkin = "";
    }

    function loadState() {
        try {
            questState = Store.guard(QUEST_KEY, defaultQuest(), isPlainObj);
        } catch (e) {
            questState = defaultQuest();
        }
        try {
            looksState = Store.guard(LOOKS_KEY, defaultLooks(), isPlainObj);
        } catch (e) {
            looksState = defaultLooks();
        }
        normalize();
    }

    function saveQuest() {
        try { Store.save(QUEST_KEY, questState); } catch (e) {}
    }

    function saveLooks() {
        try { Store.save(LOOKS_KEY, looksState); } catch (e) {}
    }

    /* ---------- 3. 现有状态读取（全部做存在性保护） ---------- */

    function unlockedMap() {
        try {
            if (window.Achievements && window.Achievements.state && window.Achievements.state.unlocked) {
                return window.Achievements.state.unlocked;
            }
        } catch (e) {}
        return {};
    }

    function achStateObj() {
        try {
            if (window.Achievements && window.Achievements.state) return window.Achievements.state;
        } catch (e) {}
        return {};
    }

    function tutorialStepNum() {
        try {
            var raw = Store.get("tutorialStep");
            return parseInt(raw, 10) || 0;
        } catch (e) {
            return 0;
        }
    }

    function teachProgress() {
        try {
            if (Store.get("teachFinished") === "true") return 12;
        } catch (e) {}
        var idx = (typeof teachLevelIdx === "number") ? teachLevelIdx : 0;
        return Math.min(idx + 1, 12);
    }

    function hellWins() {
        try {
            if (typeof wins === "object" && wins && wins.hell) return wins.hell | 0;
        } catch (e) {}
        return 0;
    }

    function seriesOnCount() {
        try {
            if (typeof getSeriesOnCount === "function") return getSeriesOnCount() | 0;
        } catch (e) {}
        return 0;
    }

    function nonBasicUnlocked() {
        var n = 0;
        try {
            if (typeof seriesUnlocked === "object" && seriesUnlocked) {
                [ "special", "physics", "symmetry", "tactical" ].forEach(function(k) {
                    if (seriesUnlocked[k]) n++;
                });
            }
        } catch (e) {}
        return n;
    }

    function isBrainUnlocked() {
        try {
            if (typeof checkBrainUnlocked === "function") return !!checkBrainUnlocked();
        } catch (e) {}
        return false;
    }

    function brainWinDone() {
        try {
            if (typeof rec === "object" && rec && rec.brain) return true;
            return Store.get("brainCleared") === "true";
        } catch (e) {
            return false;
        }
    }

    function sharedWins() {
        var s = achStateObj();
        if (s && typeof s.sharedWins === "number") return s.sharedWins;
        if (s && s.counters && typeof s.counters.play_shared_5 === "number") return s.counters.play_shared_5;
        return 0;
    }

    function totalWins() {
        var s = achStateObj();
        if (s && typeof s.totalWins === "number") return s.totalWins;
        if (s && s.counters && typeof s.counters.total_20 === "number") return s.counters.total_20;
        return 0;
    }

    function hiddenCount() {
        var u = unlockedMap(), n = 0;
        HIDDEN_IDS.forEach(function(id) { if (u[id]) n++; });
        return n;
    }

    function anySpeedRun() {
        var u = unlockedMap();
        return !!(u.speed_easy || u.speed_medium || u.speed_hard || u.speed_hell || u.speed_brain || u.speed_all);
    }

    function teachingDone() {
        try {
            if (Store.get("teachFinished") === "true") return true;
            if (unlockedMap().finish_tutorial) return true;
            if (typeof isBasicChallengeDone === "function" && isBasicChallengeDone()) return true;
            if (tutorialStepNum() > 0) return true;
        } catch (e) {}
        return false;
    }

    function basicChallengeDone() {
        try {
            if (typeof isBasicChallengeDone === "function" && isBasicChallengeDone()) return true;
            if (typeof rec === "object" && rec) {
                for (var k in rec) {
                    if (Object.prototype.hasOwnProperty.call(rec, k) && rec[k]) return true;
                }
            }
            if (typeof wins === "object" && wins) {
                for (var k2 in wins) {
                    if (Object.prototype.hasOwnProperty.call(wins, k2) && (wins[k2] | 0) > 0) return true;
                }
            }
            if (nonBasicUnlocked() > 0) return true;
        } catch (e) {}
        return false;
    }

    /* ---------- 4. 门禁 ---------- */

    function isGateOpen(id) {
        if (id === "basicChallenge") return !NEW_GATES.basicRequiresTeaching || teachingDone();
        if (id === "easy") return true;
        if (id === "medium") return !NEW_GATES.mediumRequiresBasic || basicChallengeDone();
        if (id === "hard") return seriesOnCount() >= 3;
        if (id === "hell") return seriesOnCount() >= 5;
        if (id === "brain") return isBrainUnlocked();
        return true;
    }

    function gateInfo(id) {
        if (id === "basicChallenge") {
            return {
                taskId: "m1",
                title: "🚧 通行条件",
                text: "先跟仙人把教学走完，基础挑战给你留着。",
                rows: [ [ "当前", "教学 " + teachProgress() + " / 12" ], [ "需要", "教学 12 / 12" ], [ "解锁后", "基础挑战" ] ]
            };
        }
        if (id === "medium") {
            return {
                taskId: "m2",
                title: "🚧 通行条件",
                text: "基础挑战五关先过，中等难度我给你开。",
                rows: [ [ "当前", "基础挑战 " + Math.min(tutorialStepNum(), 5) + " / 5" ], [ "需要", "基础挑战 5 / 5" ], [ "解锁后", "😮 中等难度" ] ]
            };
        }
        if (id === "hard") {
            return {
                taskId: "m4",
                title: "🚧 通行条件",
                text: "三门手艺到手，困难那层门就松了。",
                rows: [ [ "当前", "系列 " + seriesOnCount() + " / 3" ], [ "需要", "开启 3 个系列" ], [ "解锁后", "😤 困难" ] ]
            };
        }
        if (id === "hell") {
            return {
                taskId: "m5",
                title: "🚧 通行条件",
                text: "五门全认，地狱的门才开。别急，我陪你。",
                rows: [ [ "当前", "系列 " + seriesOnCount() + " / 5" ], [ "需要", "开启全部 5 个系列" ], [ "解锁后", "👿 地狱" ] ]
            };
        }
        return {
            taskId: "m7",
            title: "🚧 通行条件",
            text: "十场地狱，五系全开——脑王那扇门就认这个数。",
            rows: [ [ "当前", "地狱 " + hellWins() + " / 10 · 系列 " + seriesOnCount() + " / 5" ], [ "需要", "地狱 10 胜 + 5 系列全开" ], [ "解锁后", "🤯 脑王" ] ]
        };
    }

    /* ---------- 5. 任务进度与积分 ---------- */

    function findQuest(id) {
        for (var i = 0; i < ALL_QUESTS.length; i++) if (ALL_QUESTS[i].id === id) return ALL_QUESTS[i];
        return null;
    }

    function taskDone(q) {
        try { return !!(q && q.cond && q.cond()); } catch (e) { return false; }
    }

    function taskProgress(q) {
        try { return q && q.progress ? String(q.progress()) : ""; } catch (e) { return ""; }
    }

    function achPoints() {
        var u = unlockedMap(), sum = 0;
        for (var id in u) {
            if (!Object.prototype.hasOwnProperty.call(u, id)) continue;
            sum += (HIDDEN_IDS.indexOf(id) >= 0) ? 20 : 10;
        }
        return sum;
    }

    function taskPoints() {
        var sum = 0;
        ALL_QUESTS.forEach(function(q) {
            if (questState && questState.claimed && questState.claimed[q.id]) sum += (q.points | 0);
        });
        return sum;
    }

    function chapterDone(ch) {
        if (!ch || !ch.taskIds) return false;
        for (var i = 0; i < ch.taskIds.length; i++) {
            if (!questState || !questState.claimed || !questState.claimed[ch.taskIds[i]]) return false;
        }
        return true;
    }

    // 按章节 id 判断“本章主任务是否都已复命”，供 M9 完结条件使用
    function chapterTasksDone(chId) {
        for (var i = 0; i < CHAPTERS.length; i++) {
            if (CHAPTERS[i].id === chId) return chapterDone(CHAPTERS[i]);
        }
        return false;
    }

    function chapterPoints() {
        var sum = 0;
        CHAPTERS.forEach(function(ch) { if (chapterDone(ch)) sum += ch.bonus; });
        return sum;
    }

    function earnedPoints() {
        return achPoints() + taskPoints() + chapterPoints();
    }

    function spentPoints() {
        var sum = 0;
        SHOP.forEach(function(it) {
            if (it.price > 0 && looksState && looksState.owned && looksState.owned[it.id]) sum += it.price;
        });
        return sum;
    }

    function points() {
        return Math.max(0, earnedPoints() - spentPoints());
    }

    function claimableList() {
        var list = [];
        ALL_QUESTS.forEach(function(q) {
            if (questState.done[q.id] && !questState.claimed[q.id]) list.push(q);
        });
        return list;
    }

    function currentQuest() {
        for (var i = 0; i < MAIN_QUESTS.length; i++) {
            var q = MAIN_QUESTS[i];
            if (!questState.claimed[q.id]) return q;
        }
        return null;
    }

    /* ---------- 6. 外观 ---------- */

    function itemById(id) {
        return id && ITEM_MAP[id] ? ITEM_MAP[id] : null;
    }

    function slotOf(item) {
        if (!item) return "";
        if (item.type === "pageBg") return "pageBg";
        if (item.type === "boardBg") return "boardBg";
        return "mineSkin";
    }

    function mineEmoji(type, fallback) {
        try {
            if (type !== "normal" || !looksState || !looksState.equipped) return fallback;
            var it = itemById(looksState.equipped.mineSkin);
            return (it && it.emoji) ? it.emoji : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function applyPageBg() {
        try {
            PAGE_BG_CLASSES.forEach(function(c) { document.body.classList.remove(c); });
            var it = itemById(looksState.equipped.pageBg);
            if (it && it.cls) document.body.classList.add(it.cls);
        } catch (e) {}
    }

    function applyMineSkin() {
        try {
            if (window.RM && RM.renderEngine && typeof RM.renderEngine.invalidate === "function") {
                RM.renderEngine.invalidate();
            }
            if (typeof render === "function") render();
            if (typeof renderSlot === "function") renderSlot();
        } catch (e) {}
    }

    function applyLooks() {
        applyPageBg();
        applyMineSkin();
    }

    /* ---------- 7. 面板渲染 ---------- */

    function isPanelOpen() {
        var sb = document.getElementById("questSidebar");
        return !!(sb && sb.classList.contains("open"));
    }

    function updateTop() {
        var p = document.getElementById("questPoints");
        if (p) p.textContent = String(points());

        var list = claimableList();
        var badge = document.getElementById("npcBadge");
        if (badge) {
            badge.hidden = list.length === 0;
            badge.textContent = "!";
        }

        var bubble = document.getElementById("questNpcBubble");
        if (bubble) {
            if (list.length > 0) bubble.textContent = "活儿干完了，回来敲敲盆。";
            else {
                var cq = currentQuest();
                bubble.textContent = cq ? ("下个活儿：" + cq.task + "。") : "雷区清了，你常回来敲敲盆。";
            }
        }

        var pot = document.getElementById("npcIdle");
        if (pot) {
            try {
                if (typeof teachActive !== "undefined" && teachActive) pot.classList.add("rm-sage-hidden");
                else pot.classList.remove("rm-sage-hidden");
            } catch (e) {}
        }
    }

    function stateBadge(q) {
        if (questState.claimed[q.id]) return '<span class="rm-quest-state done">✅ 已完成</span>';
        if (questState.done[q.id]) {
            return '<button class="rm-quest-claim" type="button" onclick="Sage.claim(\'' + q.id + '\')">复命</button>';
        }
        return '<span class="rm-quest-state">' + taskProgress(q) + "</span>";
    }

    function renderTaskRow(q) {
        var cls = "rm-quest-task";
        if (questState.claimed[q.id]) cls += " is-claimed";
        else if (questState.done[q.id]) cls += " is-claimable";
        return '<div class="' + cls + '">' +
            '<div class="rm-quest-task-main">' +
                '<div class="rm-quest-task-name">🚩 ' + q.task + "</div>" +
                '<div class="rm-quest-task-meta">可解锁：' + q.unlock + " · 报酬：" + q.reward + "</div>" +
            "</div>" +
            '<div class="rm-quest-task-side">' + stateBadge(q) + "</div>" +
        "</div>";
    }

    function renderTasks() {
        var el = document.getElementById("questTaskView");
        if (!el) return;
        var html = "";
        CHAPTERS.forEach(function(ch) {
            var done = chapterDone(ch);
            html += '<div class="rm-quest-chapter">';
            html += '<div class="rm-quest-chapter-head"><span>' + ch.name + "</span><span>" +
                (done ? "✅ " + ch.title : "") + "</span></div>";
            ch.taskIds.forEach(function(tid) {
                var q = findQuest(tid);
                if (q) html += renderTaskRow(q);
            });
            if (done) {
                html += '<div class="rm-quest-chapter-bonus">章节奖励：+' + ch.bonus + " 积分 · 称号「" + ch.title + "」</div>";
            }
            html += "</div>";
        });

        // M9「主线完结」不属于任何章节的 taskIds，单独渲染，避免面板上看不到
        var covered = {};
        CHAPTERS.forEach(function(ch) { ch.taskIds.forEach(function(id) { covered[id] = true; }); });
        var extras = MAIN_QUESTS.filter(function(q) { return !covered[q.id]; });
        if (extras.length) {
            html += '<div class="rm-quest-chapter"><div class="rm-quest-chapter-head"><span>主线 · 完结</span><span></span></div>';
            extras.forEach(function(q) { html += renderTaskRow(q); });
            html += "</div>";
        }

        html += '<div class="rm-quest-chapter">';
        html += '<div class="rm-quest-chapter-head"><span>支线 · 顺手活儿</span><span>可选</span></div>';
        SIDE_QUESTS.forEach(function(q) { html += renderTaskRow(q); });
        html += "</div>";

        el.innerHTML = html;
    }

    function shopCardHtml(it, limited) {
        var owned = !!(looksState.owned && looksState.owned[it.id]);
        var slot = slotOf(it);
        var equipped = looksState.equipped && looksState.equipped[slot] === it.id;
        var priceText = owned ? "已拥有" : (it.placeholder ? "占位中" : (limited ? "任务限定" : it.price + " 积分"));
        var html = '<div class="rm-shop-card' + (it.placeholder ? " is-placeholder" : "") + '">';
        html += '<div class="rm-shop-preview' + (it.cls ? " " + it.cls : "") + '"' +
            (it.swatch ? ' style="background:' + it.swatch + '"' : '') + '>' +
            (it.emoji || "") + "</div>";
        html += '<div class="rm-shop-name">' + it.name + "</div>";
        html += '<div class="rm-shop-price">' + priceText + "</div>";
        html += '<div class="rm-shop-actions">';
        if (owned) {
            html += '<button class="rm-shop-btn" type="button" onclick="Sage.equipItem(\'' + it.id + '\')">' +
                (equipped ? "已装备" : "装备") + "</button>";
        } else if (it.placeholder) {
            html += '<button class="rm-shop-btn is-disabled" type="button" disabled>占位中</button>';
        } else if (limited) {
            html += '<button class="rm-shop-btn is-disabled" type="button" disabled>任务限定</button>';
        } else {
            html += '<button class="rm-shop-btn" type="button" onclick="Sage.buy(\'' + it.id + '\')">购买</button>';
        }
        html += "</div></div>";
        return html;
    }

    function renderShop() {
        var el = document.getElementById("questShopView");
        if (!el) return;
        var html = '<div class="rm-shop-note">用火药积分兑换外观；棋盘背景暂时占位。</div>';
        html += '<div class="rm-shop-grid">';
        SHOP.forEach(function(it) { html += shopCardHtml(it, false); });
        html += "</div>";
        html += '<div class="rm-quest-chapter-head"><span>任务限定</span><span>不卖，只能靠任务</span></div>';
        html += '<div class="rm-shop-grid">';
        LIMITED_ORDER.forEach(function(id) {
            var it = LIMITED_ITEMS[id];
            if (it) html += shopCardHtml(it, true);
        });
        html += "</div>";
        el.innerHTML = html;
    }

    function renderLooks() {
        var el = document.getElementById("questLooksView");
        if (!el) return;
        var equip = looksState.equipped || {};
        var rows = [
            [ "页面背景", "pageBg" ],
            [ "棋盘背景", "boardBg" ],
            [ "普通雷 emoji", "mineSkin" ]
        ];
        var html = "";
        rows.forEach(function(row) {
            var it = itemById(equip[row[1]]);
            html += '<div class="rm-look-row"><span class="rm-look-label">' + row[0] + "</span>" +
                '<span class="rm-look-value">' + (it ? it.name + (it.placeholder ? "（占位）" : "") : "默认") + "</span>" +
                '<button class="rm-look-btn" type="button" onclick="Sage.unequip(\'' + row[1] + '\')">卸下</button></div>';
        });
        var ownedN = 0;
        for (var id in looksState.owned) {
            if (Object.prototype.hasOwnProperty.call(looksState.owned, id) && looksState.owned[id]) ownedN++;
        }
        html += '<div class="rm-look-foot">已收集外观 ' + ownedN + " / 19（+3 称号）</div>";
        el.innerHTML = html;
    }

    function showTab(name) {
        if (name !== "tasks" && name !== "shop" && name !== "looks") name = "tasks";
        _tab = name;
        var map = { tasks: "questTaskView", shop: "questShopView", looks: "questLooksView" };
        for (var k in map) {
            if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
            var v = document.getElementById(map[k]);
            if (v) v.style.display = (k === name) ? "" : "none";
        }
        var tabs = document.querySelectorAll(".rm-quest-tab");
        Array.prototype.forEach.call(tabs, function(b) {
            b.classList.toggle("active", b.getAttribute("data-tab") === name);
        });
    }

    function renderPanel() {
        updateTop();
        renderTasks();
        renderShop();
        renderLooks();
        showTab(_tab);
    }

    /* ---------- 8. 仙人对话弹窗 ---------- */

    function hideDialog() {
        var box = document.getElementById("sageDialog");
        if (box) box.classList.remove("show");
    }

    function setDialogRows(rows) {
        var card = document.getElementById("sageCard");
        if (!card) return;
        var html = "";
        (rows || []).forEach(function(r) {
            html += '<div class="rm-sage-row"><span>' + r[0] + "</span><b>" + r[1] + "</b></div>";
        });
        card.innerHTML = html;
    }

    function setDialogActions(actions) {
        var box = document.getElementById("sageActions");
        if (!box) return;
        box.innerHTML = "";
        (actions || []).forEach(function(a) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "rm-sage-btn" + (a.primary ? " is-primary" : "");
            b.textContent = a.label;
            b.addEventListener("click", function() { a.act(); });
            box.appendChild(b);
        });
    }

    function showDialog(kind, payload) {
        var box = document.getElementById("sageDialog");
        if (!box) return;
        payload = payload || {};
        var title = "地雷仙人", text = "", rows = null, actions = [];
        if (kind === "welcome") {
            title = "🌵 地雷仙人";
            text = "伙计，可算注意到我了。我这老探头只探得出当量，位置还得你来标。我报当量，你标位置，咱俩搭伙。";
            actions = [
                { label: "看看任务", primary: true, act: function() { hideDialog(); openPanel(); } },
                { label: "先逛逛", act: hideDialog }
            ];
        } else if (kind === "praise") {
            var q = payload.task;
            title = "✅ 验收单";
            text = "漂亮！活儿干完了，验收单我填好了——字有点抖，你担待。";
            rows = [
                [ "任务", q ? q.task : "" ],
                [ "评价", "优秀" ],
                [ "奖励", q ? q.reward : "" ],
                [ "去处", "已记进主线面板" ]
            ];
            actions = [ { label: "收下", primary: true, act: hideDialog } ];
        } else if (kind === "chapter") {
            var ch = payload.chapter;
            title = "🎉 章节完成";
            text = "一章的活儿干完了。歇口气，下一层雷区我给你探着。";
            rows = [
                [ "章节", ch ? ch.name : "" ],
                [ "奖励", "+" + (ch ? ch.bonus : 0) + " 积分" ],
                [ "称号", "「" + (ch ? ch.title : "") + "」" ]
            ];
            actions = [ { label: "好", primary: true, act: hideDialog } ];
        } else if (kind === "block") {
            title = payload.title || "🚧 通行条件";
            text = payload.text || "";
            rows = payload.rows || null;
            actions = [
                { label: "去完成", primary: true, act: function() { hideDialog(); gotoTask(payload.taskId); } },
                { label: "查看主线", act: function() { hideDialog(); openPanel(); } },
                { label: "先自由玩", act: hideDialog }
            ];
        }
        document.getElementById("sageTitle").textContent = title;
        document.getElementById("sageText").textContent = text;
        setDialogRows(rows);
        setDialogActions(actions);
        box.classList.add("show");
        try { if (window.AudioFX && AudioFX.modalOpen) AudioFX.modalOpen(); } catch (e) {}
    }

    function gotoTask(taskId) {
        if (taskId === "m1" && typeof openTeachMode === "function") {
            openTeachMode();
            return;
        }
        if (taskId === "m2") {
            if (!isGateOpen("basicChallenge") && typeof openTeachMode === "function") {
                openTeachMode();
            } else if (typeof openPracticeMode === "function") {
                openPracticeMode();
            } else {
                openPanel();
            }
            return;
        }
        openPanel();
    }

    /* ---------- 9. 复命 / 商店 / 装备 ---------- */

    function claim(taskId) {
        var q = findQuest(taskId);
        if (!q || !inited) return;
        if (!questState.done[q.id]) {
            try { RM.toast("这活儿还没干完呢。"); } catch (e) {}
            return;
        }
        if (questState.claimed[q.id]) return;
        questState.claimed[q.id] = nowISO();
        (q.items || []).forEach(function(id) {
            var it = ITEM_MAP[id];
            if (!it) return;
            looksState.owned[id] = true;
            var slot = slotOf(it);
            // 第一次拿到某类外观时自动装备，省得玩家再去衣柜点一次
            if (slot && !looksState.equipped[slot]) looksState.equipped[slot] = id;
        });
        saveQuest();
        saveLooks();

        var doneChapter = null;
        CHAPTERS.forEach(function(ch) {
            if (ch.taskIds.indexOf(q.id) < 0) return;
            if (!chapterDone(ch)) return;
            var flag = "c" + ch.id;
            if (!questState.flags[flag]) {
                questState.flags[flag] = true;
                doneChapter = ch;
            }
        });
        if (doneChapter) saveQuest();

        refresh();
        applyLooks();
        try { if (window.AudioFX && AudioFX.win) AudioFX.win(); } catch (e) {}
        if (doneChapter) showDialog("chapter", { chapter: doneChapter });
        else showDialog("praise", { task: q });
    }

    function buy(itemId) {
        var it = itemById(itemId);
        if (!it || !inited) return;
        if (it.placeholder) {
            try { RM.toast("棋盘背景还在打样，先占个位。"); } catch (e) {}
            return;
        }
        if (looksState.owned[it.id]) {
            equipItem(it.id);
            return;
        }
        if (points() < it.price) {
            try { RM.toast("火药积分不够，再攒攒。"); } catch (e) {}
            return;
        }
        looksState.owned[it.id] = true;
        saveLooks();
        equipItem(it.id);
        try { RM.toast("买到了：" + it.name); } catch (e) {}
    }

    function equipItem(itemId) {
        var it = itemById(itemId);
        if (!it || !inited || !looksState.owned[it.id]) return;
        var slot = slotOf(it);
        looksState.equipped[slot] = it.id;
        saveLooks();
        applyLooks();
        if (isPanelOpen()) renderPanel();
        if (slot === "boardBg") {
            try { RM.toast("已装备（棋盘背景占位中，暂不显示）"); } catch (e) {}
        } else {
            try { RM.toast("已装备：" + it.name); } catch (e) {}
        }
    }

    function unequip(slot) {
        if (!looksState || !looksState.equipped) return;
        if (slot !== "pageBg" && slot !== "boardBg" && slot !== "mineSkin") return;
        looksState.equipped[slot] = "";
        saveLooks();
        applyLooks();
        if (isPanelOpen()) renderPanel();
    }

    /* ---------- 10. 刷新与迁移 ---------- */

    function refresh() {
        if (!inited || _refreshing) return;
        _refreshing = true;
        var newly = [];
        try {
            ALL_QUESTS.forEach(function(q) {
                if (questState.done[q.id]) return;
                if (taskDone(q)) {
                    questState.done[q.id] = nowISO();
                    newly.push(q);
                }
            });
            if (newly.length) saveQuest();
            updateTop();
            if (isPanelOpen()) renderPanel();
            if (typeof renderMineInfo === "function") renderMineInfo();
            if (typeof updatePresetButtons === "function") updatePresetButtons();
        } catch (e) {
            try { RM.warn("sage:refresh", e); } catch (e2) {}
        } finally {
            _refreshing = false;
        }
        if (newly.length) {
            try {
                RM.toast("活儿干完了：" + newly[0].task + "。回来敲敲盆复命。", 2800);
            } catch (e) {}
        }
    }

    function migrateIfNeeded() {
        var raw = null;
        try { raw = Store.get(QUEST_KEY); } catch (e) {}
        if (raw) return false;
        var any = false;
        ALL_QUESTS.forEach(function(q) {
            if (taskDone(q)) {
                questState.done[q.id] = nowISO();
                questState.claimed[q.id] = nowISO();
                (q.items || []).forEach(function(id) { if (ITEM_MAP[id]) looksState.owned[id] = true; });
                any = true;
            }
        });
        CHAPTERS.forEach(function(ch) {
            if (chapterDone(ch)) questState.flags["c" + ch.id] = true;
        });
        questState.flags.migrated = true;
        saveQuest();
        saveLooks();
        return any;
    }

    /* ---------- 11. 面板与事件绑定 ---------- */

    function openPanel() {
        try { if (typeof closeSidebarsExcept === "function") closeSidebarsExcept("questSidebar"); } catch (e) {}
        var sb = document.getElementById("questSidebar");
        if (sb) sb.classList.add("open");
        renderPanel();
        try { if (typeof guideRefresh === "function") guideRefresh(); } catch (e) {}
    }

    function togglePanel() {
        var sb = document.getElementById("questSidebar");
        if (!sb) return;
        var willOpen = !sb.classList.contains("open");
        try { if (typeof closeSidebarsExcept === "function") closeSidebarsExcept("questSidebar"); } catch (e) {}
        sb.classList.toggle("open", willOpen);
        if (willOpen) {
            renderPanel();
            try { if (typeof guideRefresh === "function") guideRefresh(); } catch (e) {}
        }
    }

    function onBlocked(id) {
        try { if (window.AudioFX && AudioFX.locked) AudioFX.locked(); } catch (e) {}
        showDialog("block", gateInfo(id));
    }

    function onAchievement(id) {
        if (!inited) return;
        var hidden = HIDDEN_IDS.indexOf(id) >= 0;
        try {
            RM.toast("成就解锁：+" + (hidden ? 20 : 10) + " 火药积分", 2200);
        } catch (e) {}
        // 成就也是任务判定来源（出题 / 分享 / 隐藏成就等），这里顺手重算一次
        try { refresh(); } catch (e) {}
    }

    function bindUI() {
        var toggle = document.getElementById("toggleQuestSidebar");
        if (toggle) {
            toggle.addEventListener("click", function() {
                try { if (window.AudioFX && AudioFX.confirm) AudioFX.confirm(); } catch (e) {}
                togglePanel();
            });
        }

        var pot = document.getElementById("npcIdle");
        if (pot) {
            pot.addEventListener("click", function() {
                try { if (window.AudioFX && AudioFX.confirm) AudioFX.confirm(); } catch (e) {}
                if (!questState.flags.welcome) {
                    questState.flags.welcome = true;
                    saveQuest();
                    showDialog("welcome");
                } else {
                    openPanel();
                }
            });
        }

        var tabs = document.querySelectorAll(".rm-quest-tab");
        Array.prototype.forEach.call(tabs, function(b) {
            b.addEventListener("click", function() {
                try { if (window.AudioFX && AudioFX.confirm) AudioFX.confirm(); } catch (e) {}
                showTab(b.getAttribute("data-tab"));
            });
        });

        var box = document.getElementById("sageDialog");
        if (box) {
            box.addEventListener("click", function(e) {
                if (e.target === box) hideDialog();
            });
        }
        var close = document.getElementById("sageClose");
        if (close) close.addEventListener("click", hideDialog);

        document.addEventListener("keydown", function(e) {
            if (e.key === "Escape") hideDialog();
        });
    }

    /* ---------- 12. 启动 ---------- */

    function init() {
        if (inited) return;
        try { loadState(); } catch (e) { questState = defaultQuest(); looksState = defaultLooks(); }
        var migrated = false;
        try { migrated = migrateIfNeeded(); } catch (e) {}
        inited = true;
        try { bindUI(); } catch (e) {}
        try { applyLooks(); } catch (e) {}
        try { refresh(); } catch (e) {}
        if (migrated) {
            setTimeout(function() {
                try { RM.toast("仙人把旧账结了：+" + points() + " 火药积分", 3600); } catch (e) {}
            }, 1600);
        }
        // 启动阶段 13/10 会各开一局，等 load 结束后再对齐一次入口渲染
        try {
            window.addEventListener("load", function() {
                setTimeout(function() { try { refresh(); } catch (e) {} }, 260);
            });
        } catch (e) {}
    }

    /* ---------- 13. 对外接口 ---------- */

    window.Sage = {
        isGateOpen: isGateOpen,
        gateInfo: gateInfo,
        onBlocked: onBlocked,
        refresh: refresh,
        claim: claim,
        buy: buy,
        equipItem: equipItem,
        unequip: unequip,
        mineEmoji: mineEmoji,
        onAchievement: onAchievement,
        openPanel: openPanel,
        showTab: showTab,
        points: points,
        earned: earnedPoints,
        spent: spentPoints,
        state: function() { return { quest: questState, looks: looksState }; }
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
