/* ==========================================================================
 * 反向扫雷 · 13-achievements.js
 * 职责：成就系统（40+ 项，含隐藏成就）与 installHooks 钩子装配
 * ========================================================================== */

(function() {
    "use strict";
    const ACHIEVEMENTS = [ {
        id: "first_win",
        cat: "新手村",
        emoji: "👷",
        name: "初次上岗布雷工",
        desc: "通关任意一局游戏",
        tip: "First Blood",
        type: "once"
    }, {
        id: "red_green_light",
        cat: "新手村",
        emoji: "🚦",
        name: "红绿灯?!",
        desc: "通关任意一局同时含有正/0/负值的游戏",
        tip: "绿灯行。黄灯更行",
        type: "once"
    }, {
        id: "finish_tutorial",
        cat: "新手村",
        emoji: "📖",
        name: "说明书",
        desc: "完成全部引导教学",
        tip: "已严肃学习布雷技术",
        type: "once"
    }, {
        id: "easy_10",
        cat: "预设难度",
        emoji: "🥬",
        name: "小菜一碟",
        desc: "简单难度通关10次",
        tip: "轻轻松松",
        type: "count",
        target: 10
    }, {
        id: "medium_10",
        cat: "预设难度",
        emoji: "🍗",
        name: "不吃压力",
        desc: "中等难度通关10次",
        tip: "不吃压力，吃大鸡腿",
        type: "count",
        target: 10
    }, {
        id: "hard_10",
        cat: "预设难度",
        emoji: "🧠",
        name: "头有点痒",
        desc: "困难难度通关10次",
        tip: "头有点痒，不会要长脑子了吧",
        type: "count",
        target: 10
    }, {
        id: "hell_first",
        cat: "预设难度",
        emoji: "😈",
        name: "勇往直下",
        desc: "首次通关地狱难度",
        tip: "下界传送门？正在加载地形。。。",
        type: "once"
    }, {
        id: "hell_7",
        cat: "预设难度",
        emoji: "👿",
        name: "地狱客厅",
        desc: "地狱累计通关10次",
        tip: "比猪灵还像本地人",
        type: "count",
        target: 10
    }, {
        id: "brain_first",
        cat: "预设难度",
        emoji: "👍",
        name: "这不是外挂？？",
        desc: "首次通关脑王难度",
        tip: "“轻轻松松”",
        type: "once"
    }, {
        id: "brain_10",
        cat: "预设难度",
        emoji: "🐮",
        name: "666，这个入是桂",
        desc: "脑王累计通关10次",
        tip: "如果这是你真实实力，🐮🍺",
        type: "count",
        target: 10
    }, {
        id: "basic_all_used",
        cat: "系列道具",
        emoji: "🧠",
        name: "头脑不基础",
        desc: "基础系列全部道具至少用来通关过一次",
        tip: "使用的地雷基础，使用者就不基础",
        type: "special",
        check: function() {
            if (!_achState.basicTypesUsed) return false;
            let basics = Object.keys(M).filter(k => M[k].category === "basic");
            return basics.every(k => _achState.basicTypesUsed[k]);
        }
    }, {
        id: "unlock_special",
        cat: "系列道具",
        emoji: "🔷",
        name: "奇葩",
        desc: "解锁异形系列",
        tip: "不是哥们，这形状也是地雷吗",
        type: "special",
        check: function() {
            return seriesUnlocked && seriesUnlocked.special;
        }
    }, {
        id: "unlock_physics",
        cat: "系列道具",
        emoji: "🗿",
        name: "科研人员",
        desc: "解锁物理律系列",
        tip: "致敬英特尔首席工程师-i18芯片缔造者-FlameZ-火博士-科研精神🗿",
        type: "special",
        check: function() {
            return seriesUnlocked && seriesUnlocked.physics;
        }
    }, {
        id: "unlock_symmetry",
        cat: "系列道具",
        emoji: "🥂",
        name: "干杯！",
        desc: "解锁对称系列",
        tip: "反向扫雷 (゜-゜)つロ 干杯~",
        type: "special",
        check: function() {
            return seriesUnlocked && seriesUnlocked.symmetry;
        }
    }, {
        id: "unlock_tactical",
        cat: "系列道具",
        emoji: "🐔",
        name: "酱味大鸡！",
        desc: "解锁战术武器系列",
        tip: "都是铜陵人我原本没想酱味大鸡！",
        type: "special",
        check: function() {
            return seriesUnlocked && seriesUnlocked.tactical;
        }
    }, {
        id: "speed_easy",
        cat: "速通系列",
        emoji: "⏱️",
        name: "颗秒!",
        desc: "简单难度通关＜7秒",
        tip: "蚌蚌蚌蚌!",
        type: "time",
        target: 7e3
    }, {
        id: "speed_medium",
        cat: "速通系列",
        emoji: "⚡",
        name: "借过一下!",
        desc: "中等难度通关＜25秒",
        tip: "我赶时间",
        type: "time",
        target: 25e3
    }, {
        id: "speed_hard",
        cat: "速通系列",
        emoji: "👎",
        name: "ez",
        desc: "困难难度通关＜60秒",
        tip: "gg ez收徒",
        type: "time",
        target: 6e4
    }, {
        id: "speed_hell",
        cat: "速通系列",
        emoji: "😈",
        name: "地狱归来",
        desc: "地狱难度通关＜3分钟",
        tip: "FaZe the fk Up!",
        type: "time",
        target: 18e4
    }, {
        id: "speed_brain",
        cat: "速通系列",
        emoji: "🧠",
        name: "脑力王",
        desc: "脑王难度通关＜5分钟",
        tip: "太有脑了，发动雷霆智慧大脑",
        type: "time",
        target: 3e5
    }, {
        id: "speed_all",
        cat: "速通系列",
        emoji: "🏁",
        name: "最速傳說",
        desc: "5个预设难度，最佳成绩加起来<555秒",
        tip: "反向掃雷最速伝說の五項目",
        type: "special",
        check: function() {
            let sum = 0;
            let hasAll = true;
            [ "easy", "medium", "hard", "hell", "brain" ].forEach(function(d) {
                if (rec[d]) sum += rec[d]; else hasAll = false;
            });
            return hasAll && sum > 0 && sum < 555e3;
        }
    }, {
        id: "create_first",
        cat: "创造模式",
        emoji: "🛠️",
        name: "包工头",
        desc: "创造模式生成第一张关卡",
        tip: "来打灰",
        type: "once"
    }, {
        id: "create_mixed",
        cat: "创造模式",
        emoji: "🏫",
        name: "出卷人",
        desc: "创造模式自制关卡同时包含物理律/对称/战术三类道具",
        tip: "出卷人？打灰高手！",
        type: "special",
        check: function() {
            return _achState.lastCreateCats && _achState.lastCreateCats.physics && _achState.lastCreateCats.symmetry && _achState.lastCreateCats.tactical;
        }
    }, {
        id: "create_10",
        cat: "创造模式",
        emoji: "📋",
        name: "印试卷",
        desc: "创造模式累计生成10张关卡",
        tip: "我们不生产图，我们只是大地雷的搬运工",
        type: "count",
        target: 10
    }, {
        id: "play_shared_5",
        cat: "创造模式",
        emoji: "🏞️",
        name: "观光客",
        desc: "通关5张玩家自制关卡",
        tip: "有点意思",
        type: "count",
        target: 5
    }, {
        id: "create_max_mines",
        cat: "创造模式",
        emoji: "💩",
        name: "巧克力蛋糕",
        desc: "创造出用了棋盘标准下最大地雷数的题目",
        tip: "这就是史",
        type: "special",
        check: function() {
            return _achState.lastCreateMaxMines;
        }
    }, {
        id: "total_20",
        cat: "累计通关",
        emoji: "☕",
        name: "摸鱼高手",
        desc: "累计通关20局",
        tip: "初出茅庐",
        type: "count",
        target: 20
    }, {
        id: "total_50",
        cat: "累计通关",
        emoji: "🍉",
        name: "摸鱼高高手",
        desc: "累计通关50局",
        tip: "摸鱼必备",
        type: "count",
        target: 50
    }, {
        id: "total_150",
        cat: "累计通关",
        emoji: "🍺",
        name: "摸鱼高高高手",
        desc: "累计通关150局",
        tip: "那么工作没干完该怎么办",
        type: "count",
        target: 150
    }, {
        id: "total_500",
        cat: "累计通关",
        emoji: "🧊",
        name: "卧槽？冰！！",
        desc: "累计通关500局",
        tip: "我已经停不下来了",
        type: "count",
        target: 500
    }, {
        id: "total_night",
        cat: "累计通关",
        emoji: "🌙",
        name: "夜猫子",
        desc: "22:00-4:00时间段通关10次",
        tip: "大家都早点休息吧。。。",
        type: "count",
        target: 10
    }, {
        id: "hidden_slide",
        cat: "隐藏",
        emoji: "🧹",
        name: "手滑罢了",
        desc: "单局右键删道具累计20次",
        tip: "才不是点错了20次呢。。。",
        type: "count",
        target: 20,
        hidden: true
    }, {
        id: "hidden_chaos",
        cat: "隐藏",
        emoji: "😨",
        name: "场面一度十分混乱",
        desc: "单局用上五大系列的道具并通关",
        tip: "哇。。好多雷啊。。",
        type: "special",
        hidden: true,
        check: function() {
            return _achState.currentRunCategories && _achState.currentRunCategories.size >= 5;
        }
    }, {
        id: "hidden_flawless",
        cat: "隐藏",
        emoji: "💯",
        name: "一把过",
        desc: "中等及以上预设难度全程不删除/清空道具通关",
        tip: "100分",
        type: "once",
        hidden: true
    }, {
        id: "hidden_eco",
        cat: "隐藏",
        emoji: "♻️",
        name: "环保主义者",
        desc: "使用一次清空放置",
        tip: "地雷不落地，世界更美丽",
        type: "once",
        hidden: true
    }, {
        id: "free_20x20",
        cat: "隐藏",
        emoji: "📐",
        name: "！！？大大？！！",
        desc: "自由模式20×20超大棋盘通关",
        tip: "好像还是不过瘾",
        type: "special",
        hidden: true,
        check: function() {
            return isFreeMode && SR === 20 && SC === 20;
        }
    }, {
        id: "brain_slow",
        cat: "隐藏",
        emoji: "🐷",
        name: "脑力亡",
        desc: "通关脑王难度，但用时超过10分钟",
        tip: "太有脑了，对了，头发还好吗",
        type: "once",
        hidden: true
    }, {
        id: "bgm_adjust",
        cat: "隐藏",
        emoji: "🐲",
        name: "龙？",
        desc: "使用背景音乐调节",
        tip: "聋？可是帝王之征啊！",
        type: "once",
        hidden: true
    }, {
        id: "new_game_spam",
        cat: "隐藏",
        emoji: "🤺",
        name: "退！退！退！",
        desc: "三次重开游戏",
        tip: "不是我喜欢的棋盘，直接重开",
        type: "count",
        target: 3,
        hidden: true
    }, {
        id: "crazy_thursday",
        cat: "隐藏",
        emoji: "🍔",
        name: "疯狂星期四",
        desc: "星期四完成任意游戏一次",
        tip: "疯狂疯狂星期四~",
        type: "once",
        hidden: true
    }, {
        id: "hidden_grass",
        cat: "隐藏",
        emoji: "🌱",
        name: "长草",
        desc: "计时器工作时，15秒不操作地雷",
        tip: "别吵，我在烧烤",
        type: "once",
        hidden: true
    }, {
        id: "hidden_icecream",
        cat: "隐藏",
        emoji: "🍦",
        name: "冰淇淋！",
        desc: "6:00-10:00时间段通关一次游戏",
        tip: "早上好中国！现在我有冰淇淋！",
        type: "once",
        hidden: true
    }, {
        id: "hidden_highvalue",
        cat: "隐藏",
        emoji: "🪑",
        name: "椅子",
        desc: "通关题目含≥5地块的预设难度游戏",
        tip: "这里怎么有张椅子？真拿你没办法，坐好咯",
        type: "special",
        hidden: true,
        check: function() {
            if (!diff || isFreeMode) return false;
            for (let r = 0; r < SR; r++) for (let c = 0; c < SC; c++) if (G.tar[r][c] >= 5) return true;
            return false;
        }
    }, {
        id: "hidden_lowvalue",
        cat: "隐藏",
        emoji: "🦐",
        name: "软脚",
        desc: "通关题目含≤-3地块的预设难度游戏",
        tip: "伊利亚我软脚了，快扶我起来",
        type: "special",
        hidden: true,
        check: function() {
            if (!diff || isFreeMode) return false;
            for (let r = 0; r < SR; r++) for (let c = 0; c < SC; c++) if (G.tar[r][c] <= -3) return true;
            return false;
        }
    }, {
        id: "hidden_teatime",
        cat: "隐藏",
        emoji: "🍵",
        name: "飲茶先",
        desc: "15:00-16:00时间段通关一次游戏",
        tip: "三點幾嘞，飲茶先啦",
        type: "once",
        hidden: true
    } ];
    const STORE_KEY = "achievementState_v1";
    let _achState = loadState();
    function loadState() {
        try {
            let raw = Store.get(STORE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return {
            unlocked: {},
            counters: {},
            totalWins: 0,
            nightWins: 0,
            basicTypesUsed: {},
            lastCreateCats: null,
            currentRunCategories: null,
            currentRunDeletes: 0,
            currentRunFlawless: true,
            sharedWins: 0,
            bgmAdjusted: false,
            lastCreateMaxMines: false,
            grassIdleStart: 0,
            grassUnlocked: false
        };
    }
    function saveState() {
        try {
            Store.save(STORE_KEY, _achState);
        } catch (e) {}
    }
    let _popupQueue = [];
    let _popupActive = false;
    function showPopup(ach) {
        _popupQueue.push(ach);
        if (!_popupActive) processPopupQueue();
    }
    function processPopupQueue() {
        if (_popupQueue.length === 0) {
            _popupActive = false;
            return;
        }
        _popupActive = true;
        let ach = _popupQueue.shift();
        let overlay = document.getElementById("achPopupOverlay");
        document.getElementById("popupEmoji").textContent = ach.emoji;
        document.getElementById("popupName").textContent = ach.name;
        document.getElementById("popupDesc").textContent = ach.desc;
        overlay.classList.add("active");
        playAchievementSound();
        setTimeout(() => {
            overlay.classList.remove("active");
            setTimeout(processPopupQueue, 400);
        }, 3e3);
    }
    function unlock(id) {
        if (_achState.unlocked[id]) return;
        let ach = ACHIEVEMENTS.find(a => a.id === id);
        if (!ach) return;
        _achState.unlocked[id] = (new Date).toISOString().slice(0, 10);
        saveState();
        showPopup(ach);
        renderAchievements();
    }
    function incrementCounter(id, by) {
        by = by || 1;
        _achState.counters[id] = (_achState.counters[id] || 0) + by;
        let ach = ACHIEVEMENTS.find(a => a.id === id);
        if (ach && ach.type === "count" && _achState.counters[id] >= ach.target) unlock(id);
        saveState();
        renderAchievements();
    }
    function setCounter(id, val) {
        _achState.counters[id] = val;
        let ach = ACHIEVEMENTS.find(a => a.id === id);
        if (ach && ach.type === "count" && val >= ach.target) unlock(id);
        saveState();
        renderAchievements();
    }
    function checkWinAchievements() {
        if (isTutorialMode) return;
        unlock("first_win");
        let day = (new Date).getDay();
        if (day === 4) unlock("crazy_thursday");
        if (diff === "brain" && ct > 6e5) unlock("brain_slow");
        let sumTime = 0;
        let hasAllRec = true;
        [ "easy", "medium", "hard", "hell", "brain" ].forEach(function(d) {
            if (rec[d]) sumTime += rec[d]; else hasAllRec = false;
        });
        if (hasAllRec && sumTime > 0 && sumTime < 555e3) unlock("speed_all");
        let hasPos = false, hasZero = false, hasNeg = false;
        for (let r = 0; r < SR; r++) for (let c = 0; c < SC; c++) {
            let v = G.tar[r][c];
            if (v > 0) hasPos = true; else if (v < 0) hasNeg = true; else hasZero = true;
        }
        if (hasPos && hasZero && hasNeg) unlock("red_green_light");
        if (diff && !isFreeMode) {
            if (diff === "easy") incrementCounter("easy_10");
            if (diff === "medium") incrementCounter("medium_10");
            if (diff === "hard") incrementCounter("hard_10");
            if (diff === "hell") {
                unlock("hell_first");
                incrementCounter("hell_7");
            }
            if (diff === "brain") {
                unlock("brain_first");
                incrementCounter("brain_10");
            }
            if (ct > 0) {
                if (diff === "easy" && ct < 7e3) unlock("speed_easy");
                if (diff === "medium" && ct < 25e3) unlock("speed_medium");
                if (diff === "hard" && ct < 6e4) unlock("speed_hard");
                if (diff === "hell" && ct < 18e4) unlock("speed_hell");
                if (diff === "brain" && ct < 3e5) unlock("speed_brain");
            }
            if ((diff === "medium" || diff === "hard" || diff === "hell" || diff === "brain") && _achState.currentRunFlawless) {
                unlock("hidden_flawless");
            }
        }
        if (isFreeMode && SR === 20 && SC === 20) unlock("free_20x20");
        if (diff && !isFreeMode) {
            let nowH = (new Date).getHours();
            if (nowH >= 6 && nowH < 10) unlock("hidden_icecream");
            if (nowH === 15) unlock("hidden_teatime");
        }
        _achState.totalWins = (_achState.totalWins || 0) + 1;
        let t = _achState.totalWins;
        let totalMap = [ 20, 50, 150, 500 ];
        let totalIds = [ "total_20", "total_50", "total_150", "total_500" ];
        totalMap.forEach((target, i) => {
            let current = _achState.counters[totalIds[i]] || 0;
            if (t > current) {
                setCounter(totalIds[i], t);
            }
        });
        let h = (new Date).getHours();
        if (h >= 22 || h < 4) {
            _achState.nightWins = (_achState.nightWins || 0) + 1;
            let nightCurrent = _achState.counters["total_night"] || 0;
            if (_achState.nightWins > nightCurrent) {
                setCounter("total_night", _achState.nightWins);
            }
        }
        if (_achState.basicTypesUsed) {
            let basics = Object.keys(M).filter(k => M[k].category === "basic");
            if (basics.length > 0 && basics.every(k => _achState.basicTypesUsed[k])) unlock("basic_all_used");
        }
        if (window._currentIsShared) {
            _achState.sharedWins = (_achState.sharedWins || 0) + 1;
            setCounter("play_shared_5", _achState.sharedWins);
            window._currentIsShared = false;
        }
        if (_achState.currentRunCategories && _achState.currentRunCategories.size >= 5) unlock("hidden_chaos");
        ACHIEVEMENTS.forEach(a => {
            if (a.type === "special" && !a.hidden && !_achState.unlocked[a.id] && a.check) {
                try {
                    if (a.check()) unlock(a.id);
                } catch (e) {}
            }
        });
        var hiddenSpecialIds = [ "hidden_highvalue", "hidden_lowvalue" ];
        for (var hi = 0; hi < hiddenSpecialIds.length; hi++) {
            var hidx = hiddenSpecialIds[hi];
            var ha = ACHIEVEMENTS.find(function(x) {
                return x.id === hidx;
            });
            if (ha && ha.type === "special" && ha.hidden && !_achState.unlocked[hidx] && ha.check) {
                try {
                    if (ha.check()) unlock(hidx);
                } catch (e) {}
            }
        }
        saveState();
        renderAchievements();
        renderRecordList();
    }
    function renderAchievements() {
        let container = document.getElementById("achList");
        if (!container) return;
        let groups = {};
        ACHIEVEMENTS.forEach(a => {
            if (a.hidden && !_achState.unlocked[a.id]) return;
            if (!groups[a.cat]) groups[a.cat] = [];
            groups[a.cat].push(a);
        });
        let catOrder = [ "新手村", "预设难度", "系列道具", "速通系列", "创造模式", "累计通关", "隐藏" ];
        let html = "";
        catOrder.forEach(cat => {
            if (!groups[cat]) return;
            html += `<div style="font-size:13px;font-weight:700;color:#f59e0b;margin:10px 0 6px 4px;">${cat}</div>`;
            groups[cat].forEach(a => {
                let unlocked = !!_achState.unlocked[a.id];
                let cls = "achievement-item" + (unlocked ? " unlocked" : "") + (a.hidden ? " hidden-ach" : "");
                let name = unlocked ? a.name : a.hidden ? "？？？" : "🔒 " + a.name;
                let desc = unlocked ? a.desc : a.hidden ? "隐藏成就，达成后揭晓" : a.desc;
                let meta = "";
                if (unlocked) meta = "🗓️ " + _achState.unlocked[a.id]; else if (a.type === "count") meta = `进度 ${_achState.counters[a.id] || 0}/${a.target}`;
                let lockIcon = unlocked ? "✅" : a.hidden ? "🔒" : "🔒";
                let tipText = unlocked ? a.tip || "" : a.hidden ? "隐藏成就，达成后揭晓提示" : a.tip || "";
                html += `<div class="${cls}" data-tip="${tipText.replace(/"/g, "&quot;")}">\n                    <div class="achievement-emoji">${a.emoji}</div>\n                    <div class="achievement-info">\n                        <div class="achievement-name">${name}</div>\n                        <div class="achievement-desc">${desc}</div>\n                        ${meta ? `<div class="achievement-meta">${meta}</div>` : ""}\n                    </div>\n                    <div class="achievement-lock">${lockIcon}</div>\n                </div>`;
            });
        });
        container.innerHTML = html;
        let total = ACHIEVEMENTS.filter(a => !a.hidden || _achState.unlocked[a.id]).length;
        let unlocked = Object.keys(_achState.unlocked).length;
        let uc = document.getElementById("achUnlockedCount");
        let tc = document.getElementById("achTotalCount");
        if (uc) uc.textContent = unlocked;
        if (tc) tc.textContent = total;
    }
    function installHooks() {
        if (window._achHooksInstalled) return;
        window._achHooksInstalled = true;
        var NS = window._gameNS || {};
        let _oUL = typeof window.unlockSeries === "function" ? window.unlockSeries : NS.unlockSeries;
        window.unlockSeries = function(catKey) {
            if (_oUL) _oUL.apply(this, arguments);
            if (catKey === "special") unlock("unlock_special");
            if (catKey === "physics") unlock("unlock_physics");
            if (catKey === "symmetry") unlock("unlock_symmetry");
            if (catKey === "tactical") unlock("unlock_tactical");
            renderAchievements();
        };
        let _oTW = typeof window.onTutorialWin === "function" ? window.onTutorialWin : NS.onTutorialWin;
        window.onTutorialWin = function() {
            if (_oTW) _oTW.apply(this, arguments);
            if (tutorialStep >= 5) unlock("finish_tutorial");
        };
        let _oDel = typeof window.del === "function" ? window.del : NS.del;
        window.del = function(r, c) {
            if (!isTutorialMode) {
                _achState.currentRunDeletes++;
                _achState.currentRunFlawless = false;
                if (_achState.currentRunDeletes >= 20) unlock("hidden_slide");
                resetGrassTimer();
                saveState();
            }
            if (_oDel) return _oDel(r, c);
        };
        if (typeof del !== "undefined") del = window.del;
        let _oCA = typeof window.clearAll === "function" ? window.clearAll : NS.clearAll;
        window.clearAll = function() {
            if (!isTutorialMode) {
                _achState.currentRunFlawless = false;
                unlock("hidden_eco");
                resetGrassTimer();
            }
            if (_oCA) _oCA.apply(this, arguments);
        };
        if (typeof clearAll !== "undefined") clearAll = window.clearAll;
        document.getElementById("clear").onclick = window.clearAll;
        let _oDrop = typeof window.drop === "function" ? window.drop : NS.drop;
        window.drop = function(e) {
            let result;
            if (_oDrop) result = _oDrop.apply(this, arguments);
            if (!isTutorialMode) {
                if (!_achState.currentRunCategories) _achState.currentRunCategories = new Set;
                let t = e && e.dataTransfer ? e.dataTransfer.getData("text/plain") : null;
                if (!t && G.lastDragType) t = G.lastDragType;
                if (t && M[t]) {
                    let cat = M[t].category;
                    _achState.currentRunCategories.add(cat);
                    if (cat === "basic") {
                        _achState.basicTypesUsed[t] = true;
                        saveState();
                    }
                }
                resetGrassTimer();
            }
            return result;
        };
        if (typeof drop !== "undefined") drop = window.drop;
        let _oGen = typeof window.generatePuzzleCode === "function" ? window.generatePuzzleCode : NS.generatePuzzleCode;
        window.generatePuzzleCode = function() {
            let result;
            if (_oGen) result = _oGen.apply(this, arguments);
            if (!isTutorialMode) {
                unlock("create_first");
                incrementCounter("create_10");
                let cats = {
                    physics: false,
                    symmetry: false,
                    tactical: false
                };
                for (let k in createPlaced) {
                    let mk = createPlaced[k];
                    if (M[mk]) {
                        let c = M[mk].category;
                        if (c === "physics") cats.physics = true;
                        if (c === "symmetry") cats.symmetry = true;
                        if (c === "tactical") cats.tactical = true;
                    }
                }
                _achState.lastCreateCats = cats;
                if (cats.physics && cats.symmetry && cats.tactical) unlock("create_mixed");
                let totalCells = createRows * createCols;
                let maxMines = Math.floor(totalCells * .6);
                if (Object.keys(createPlaced).length >= maxMines && maxMines > 0) {
                    _achState.lastCreateMaxMines = true;
                    unlock("create_max_mines");
                }
                saveState();
            }
            return result;
        };
        let _oApply = typeof window.applyPuzzleCode === "function" ? window.applyPuzzleCode : NS.applyPuzzleCode;
        window.applyPuzzleCode = function() {
            window._currentIsShared = true;
            if (_oApply) return _oApply.apply(this, arguments);
        };
        let _oFR = typeof window.fullReset === "function" ? window.fullReset : NS.fullReset;
        window.fullReset = function() {
            _achState.currentRunCategories = new Set;
            _achState.currentRunDeletes = 0;
            _achState.currentRunFlawless = true;
            saveState();
            if (_oFR) return _oFR.apply(this, arguments);
        };
        if (typeof fullReset !== "undefined") fullReset = window.fullReset;
        let _grassInterval = null;
        function startGrassTimer() {
            if (_grassInterval) return;
            _achState.grassIdleStart = Date.now();
            _grassInterval = setInterval(function() {
                if (!ts) {
                    stopGrassTimer();
                    return;
                }
                let idle = Date.now() - _achState.grassIdleStart;
                if (idle >= 15e3) {
                    unlock("hidden_grass");
                    stopGrassTimer();
                }
            }, 1e3);
        }
        function stopGrassTimer() {
            if (_grassInterval) {
                clearInterval(_grassInterval);
                _grassInterval = null;
            }
        }
        function resetGrassTimer() {
            _achState.grassIdleStart = Date.now();
        }
        let _origStartTi = startTi;
        startTi = function() {
            _origStartTi.apply(this, arguments);
            startGrassTimer();
        };
        let _origStopTi = stopTi;
        stopTi = function() {
            stopGrassTimer();
            _origStopTi.apply(this, arguments);
        };
        let _origFullReset2 = fullReset;
        fullReset = function() {
            stopGrassTimer();
            _origFullReset2.apply(this, arguments);
        };
        let _bgmSlider = document.getElementById("bgmSlider");
        if (_bgmSlider) {
            _bgmSlider.addEventListener("input", function() {
                if (!_achState.bgmAdjusted) {
                    _achState.bgmAdjusted = true;
                    saveState();
                    unlock("bgm_adjust");
                }
            });
        }
        let _oNG = typeof window.newGame === "function" ? window.newGame : NS.newGame;
        window.newGame = function() {
            let result;
            if (_oNG) result = _oNG.apply(this, arguments);
            _achState.newGameClicks = (_achState.newGameClicks || 0) + 1;
            if (_achState.newGameClicks >= 3) unlock("new_game_spam");
            saveState();
            return result;
        };
        if (typeof newGame !== "undefined") newGame = window.newGame;
        document.getElementById("reset").onclick = window.newGame;
        let _oDrop2 = window.drop;
        window.drop = function(e) {
            _achState.newGameClicks = 0;
            saveState();
            if (_oDrop2) return _oDrop2.apply(this, arguments);
        };
        let _oDel2 = window.del;
        window.del = function(r, c) {
            _achState.newGameClicks = 0;
            saveState();
            if (_oDel2) return _oDel2(r, c);
        };
        let _oCA2 = window.clearAll;
        window.clearAll = function() {
            _achState.newGameClicks = 0;
            saveState();
            if (_oCA2) return _oCA2.apply(this, arguments);
        };
    }
    function initToggle() {
        let btn = document.getElementById("toggleAchSidebar");
        let sb = document.getElementById("achSidebar");
        if (!btn || !sb) return;
        btn.addEventListener("click", () => {
            AudioFX.confirm();
            const willOpen = !sb.classList.contains("open");
            closeSidebarsExcept("achSidebar");
            sb.classList.toggle("open", willOpen);
            renderAchievements();
            renderRecordList();
        });
    }
    function init() {
        installHooks();
        initToggle();
        renderAchievements();
        renderRecordList();
        newGame();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
    window.checkWinAchievements = checkWinAchievements;
    window.Achievements = {
        unlock: unlock,
        incrementCounter: incrementCounter,
        renderAchievements: renderAchievements,
        state: _achState
    };
})();
