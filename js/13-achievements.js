/* ==========================================================================
 * 模块 13 · 成就系统与钩子装配（js/13-achievements.js）
 *
 * 职责：定义全部成就，维护解锁进度与计数器，渲染成就面板，并在通关、
 *       落子、删雷、生成题库码等业务动作之后判定是否解锁新成就。
 * 依赖：对局状态 diff / SR / SC / G / ct / ts / isTutorialMode / isFreeMode /
 *       gameHardcore / gameTetris（00-core 与 03-timer）、M（04-mines）、
 *       hcWins / tetWins（01-storage）、createPlaced / createRows / createCols
 *       （11-create）、Store（01-storage）、AudioFX（02-audio）、
 *       renderRecordList 与 closeSidebarsExcept（08-ui）。
 * 对外：window.checkWinAchievements（08-ui 通关时调用）、window.Achievements
 *       （unlock / incrementCounter / renderAchievements / state，以及只读查询
 *       list / byId / unlockTime / summary）。
 * 设计要点：
 *   1) 成就判定与业务逻辑分离：业务文件不知道成就系统的存在，本文件在
 *      installHooks 中包装既有全局函数，只在原有行为前后追加统计，属于
 *      可插拔的横切扩展；不加载本文件即可整体关闭成就系统。
 *   2) 数据驱动：70 个成就集中在同一张表内，添加成就只需追加数据与触发点。
 *   3) 解锁时间以完整 ISO 时间戳（含 T、时分秒与 Z 后缀）保存，面板展示时再
 *      换算成本地时间；已有存档中可能出现的纯日期值 / 数字时间戳在启动时统一
 *      规范化。解锁时间、计数器与本局过程数据合并成一条 localStorage 记录，
 *      读写都做异常保护，存储不可用时退化为仅内存有效。
 *   4) 只读查询接口（list / byId / unlockTime / summary）只读内部状态，不做
 *      判定、不改存档，供存档详情等界面复用成就数据与解锁时间。
 * ========================================================================== */

(function() {
    "use strict";

    /* ---------- 1. 成就数据表（一）：新手村与预设难度 ---------- */

    /* 字段约定：
     *   id      唯一标识，同时作为存档中的解锁键与计数器键
     *   cat     分组名，决定成就面板里的归类与显示顺序
     *   emoji   展示图标；name / desc / tip 为名称、达成条件与彩蛋文案
     *   type    once / count / time / special 四种判定类型
     *   target  count 的目标次数，或 time 的目标毫秒数
     *   hidden  隐藏成就：未解锁前只显示问号，且不计入面板的可见总数
     *   check   仅 special 使用，返回是否达成；判定异常由调用方捕获
     */
    const ACHIEVEMENTS = [ {
        // 新手村：帮助新玩家熟悉基本流程的入门成就
        id: "first_win",
        cat: "新手村",
        emoji: "👷",
        name: "初次上岗",
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
        tip: "已严肃学习反向扫雷技术",
        type: "once"
    }, {
        // 预设难度：按难度累计通关与首次通关
        id: "easy_10",
        cat: "经典",
        emoji: "🥬",
        name: "小菜一碟",
        desc: "简单难度通关10次",
        tip: "轻轻松松，对吧",
        type: "count",
        target: 10
    }, {
        id: "medium_10",
        cat: "经典",
        emoji: "🍗",
        name: "大菜一碟",
        desc: "中等难度通关10次",
        tip: "吃大鸡腿",
        type: "count",
        target: 10
    }, {
        id: "hard_first",
        cat: "经典",
        emoji: "🥱",
        name: "难？困。。。",
        desc: "首次通关困难难度",
        tip: "原来是助眠游戏啊",
        type: "once"
    }, {
        id: "hard_10",
        cat: "经典",
        emoji: "🤕",
        name: "头有点痒",
        desc: "困难难度通关10次",
        tip: "头有点痒，不会要长脑子了吧",
        type: "count",
        target: 10
    }, {
        id: "hell_first",
        cat: "经典",
        emoji: "😈",
        name: "勇往直下",
        desc: "首次通关地狱难度",
        tip: "下界传送门？正在加载地形。。。",
        type: "once"
    }, {
        id: "hell_7",
        cat: "经典",
        emoji: "👿",
        name: "地狱客厅",
        desc: "地狱累计通关10次",
        tip: "比猪灵还像本地人",
        type: "count",
        target: 10
    }, {
        id: "brain_first",
        cat: "经典",
        emoji: "🫢",
        name: "这不是外挂？？",
        desc: "首次通关脑王难度",
        tip: "“轻轻松松”，对吧",
        type: "once"
    }, {
        id: "brain_10",
        cat: "经典",
        emoji: "🐮",
        name: "666，这个入是桂",
        desc: "脑王累计通关10次",
        tip: "如果这是你真实实力，🐮🍺",
        type: "count",
        target: 10
    }, {
        /* ---------- 2. 成就数据表（二）：系列道具与速通 ---------- */
        id: "basic_all_used",
        cat: "系列道具",
        emoji: "🐣",
        name: "鸡雏",
        desc: "基础系列全部道具至少用来通关过一次",
        tip: "使用的地雷基础，使用者就不基础",
        type: "special",
        check: function() {
            // 基础系列的每个雷种都至少参与过一次通关
            if (!_achState.basicTypesUsed) return false;
            let basics = Object.keys(M).filter(k => M[k].category === "basic");
            return basics.every(k => _achState.basicTypesUsed[k]);
        }
    }, {
        id: "unlock_special",
        cat: "系列道具",
        emoji: "🌹",
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
        tip: "致敬英特尔首席研发工程师-i18芯片缔造者-FlameZ-火博士-科研精神🗿",
        type: "special",
        check: function() {
            return seriesUnlocked && seriesUnlocked.physics;
        }
    },  {
        id: "unlock_poker",
        cat: "系列道具",
        emoji: "🤡",
        name: "Twisted Fate",
        desc: "解锁扑克牌系列",
        tip: "幸运女神在微笑",
        type: "special",
        check: function() {
            return !!(seriesUnlocked && seriesUnlocked.poker);
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
        // 速通系列：在预设难度下用更短的时间通关
        id: "speed_easy",
        cat: "速通",
        emoji: "⏱️",
        name: "颗秒!",
        desc: "简单难度通关＜7秒",
        tip: "蚌蚌蚌蚌!",
        type: "time",
        target: 7e3
    }, {
        id: "speed_medium",
        cat: "速通",
        emoji: "⚡",
        name: "借过!",
        desc: "中等难度通关＜25秒",
        tip: "我赶时间",
        type: "time",
        target: 25e3
    }, {
        id: "speed_hard",
        cat: "速通",
        emoji: "👎",
        name: "ez",
        desc: "困难难度通关＜60秒",
        tip: "gg ez收徒",
        type: "time",
        target: 6e4
    }, {
        id: "speed_hell",
        cat: "速通",
        emoji: "😈",
        name: "地狱归来",
        desc: "地狱难度通关＜3分钟",
        tip: "FaZe the fk Up!",
        type: "time",
        target: 18e4
    }, {
        id: "speed_brain",
        cat: "速通",
        emoji: "🧠",
        name: "脑力王",
        desc: "脑王难度通关＜5分钟",
        tip: "太有脑了，发动雷霆智慧大脑",
        type: "time",
        target: 3e5
    }, {
        id: "speed_all",
        cat: "速通",
        emoji: "🏁",
        name: "最速傳說",
        desc: "5个经典难度，最佳成绩加起来<555秒",
        tip: "反向掃雷最速伝說の五項目",
        type: "special",
        check: function() {
            // 速通总成就只判定经典玩法：硬核 / 俄罗斯方块局的成绩不计入速通
            if (gameHardcore || gameTetris) return false;
            // 五项预设难度都要有最佳成绩，且总和低于 555 秒
            let sum = 0;
            let hasAll = true;
            [ "easy", "medium", "hard", "hell", "brain" ].forEach(function(d) {
                if (rec[d]) sum += rec[d]; else hasAll = false;
            });
            return hasAll && sum > 0 && sum < 555e3;
        }
    }, {
        /* ---------- 3. 成就数据表（三）：创造模式与累计通关 ---------- */
        id: "create_first",
        cat: "创造模式",
        emoji: "🔨",
        name: "包工头",
        desc: "创造模式生成第一张关卡",
        tip: "来打灰",
        type: "once"
    }, {
        id: "create_mixed",
        cat: "创造模式",
        emoji: "🔧",
        name: "打灰达人",
        desc: "创造模式自制关卡同时包含物理律/对称/战术三类道具",
        tip: "土木工程专家罢了",
        type: "special",
        check: function() {
            // 最近一次生成的题目同时包含物理律、对称与战术三类道具
            return _achState.lastCreateCats && _achState.lastCreateCats.physics && _achState.lastCreateCats.symmetry && _achState.lastCreateCats.tactical;
        }
    }, {
        id: "create_10",
        cat: "创造模式",
        emoji: "🧑‍🏭",
        name: "工人三雷",
        desc: "创造模式累计生成10张关卡",
        tip: "我们不生产图，我们只是大地雷的搬运工",
        type: "count",
        target: 10
    }, {
        id: "play_shared_5",
        cat: "创造模式",
        emoji: "🏞️",
        name: "雷区观光客",
        desc: "通关5张玩家自制关卡",
        tip: "奇迹行者还在刷野💢",
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
        // 累计通关：总胜场与特定时段的累计成就
        id: "total_20",
        cat: "累计通关",
        emoji: "🐟",
        name: "摸鱼高手",
        desc: "累计通关20局",
        tip: "带薪如厕中",
        type: "count",
        target: 20
    }, {
        id: "total_50",
        cat: "累计通关",
        emoji: "🦈",
        name: "摸鱼高高手",
        desc: "累计通关50局",
        tip: "这。。。也能摸吗？",
        type: "count",
        target: 50
    }, {
        id: "total_150",
        cat: "累计通关",
        emoji: "🐋",
        name: "摸鱼高高高手",
        desc: "累计通关150局",
        tip: "DeepSeek-Pro蓝色大肥鱼！",
        type: "count",
        target: 150
    }, {
        id: "total_500",
        cat: "累计通关",
        emoji: "🧊",
        name: "卧槽？冰！！",
        desc: "累计通关500局",
        tip: "我依然是世一扫雷大师",
        type: "count",
        target: 500
    }, {
        id: "total_night",
        cat: "累计通关",
        emoji: "🌙",
        name: "夜猫子",
        desc: "22:00-4:00时间段通关10次",
        tip: "大家都早点休息吧--6657",
        type: "count",
        target: 10
    }, {
        /* ---------- 4. 成就数据表（四）：隐藏成就 ---------- */
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
        desc: "单局用上六大系列的道具并通关",
        tip: "哇。。好多雷啊。。",
        type: "special",
        hidden: true,
        check: function() {
            // 本局使用过的雷种系列数达到 6 个（基础 + 五个可选系列）
            return _achState.currentRunCategories && _achState.currentRunCategories.size >= 6;
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
        tip: "加量不加价，良心游戏😭",
        type: "special",
        hidden: true,
        check: function() {
            // 自由模式的 20×20 棋盘通关
            return isFreeMode && SR === 20 && SC === 20;
        }
    }, {
        id: "brain_slow",
        cat: "隐藏",
        emoji: "🐷",
        name: "脑力亡",
        desc: "通关脑王难度，但用时超过10分钟",
        tip: "我们是智将类型",
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
        desc: "点击3次「新游戏」按钮",
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
        desc: "计时器工作时，连续15秒不进行任何棋盘操作",
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
            // 预设难度下扫描期望值矩阵，存在 ≥5 的格子即达成
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
            // 预设难度下扫描期望值矩阵，存在 ≤-3 的格子即达成
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
    }, /* ---------- 4.1 成就数据表（五）：硬核、全类型与存档管理 ---------- */ 
      {
        // 硬核系列：只有预设难度与自由模式会继承硬核偏好
        id: "hc_first",
        cat: "🪚 硬核",
        emoji: "🍖",
        name: "硬菜一碟",
        desc: "首次通关任意预设难度硬核",
        tip: "事情开始变得有趣起来了",
        type: "special",
        check: function() {
            // 硬核快照为真且存在真实难度键，自由模式不计入预设难度
            return !!(gameHardcore && diff && !isFreeMode);
        }
    }, {
        id: "hc_10",
        cat: "🪚 硬核",
        emoji: "🔩",
        name: "∑MALE",
        desc: "累计通关10次硬核预设难度",
        tip: "你知道吗，其实《美国精神病人》里的贝特曼并不是西格玛男人",
        type: "count",
        target: 10
    }, {
        id: "hc_easy",
        cat: "🪚 硬核",
        emoji: "🪛",
        name: "螺丝钉子",
        desc: "首次通关简单硬核",
        tip: "螺丝钉子拿在手上！",
        type: "once"
    }, {
        id: "hc_medium",
        cat: "🪚 硬核",
        emoji: "🛻",
        name: "破车皮卡",
        desc: "首次通关中等硬核",
        tip: "破车皮卡我来改装！",
        type: "once"
    }, {
        id: "hc_hard",
        cat: "🪚 硬核",
        emoji: "🚁",
        name: "难人！",
        desc: "首次通关困难硬核",
        tip: "男人，什么可以我说，曼巴出去了",
        type: "once"
    }, {
        id: "hc_hell",
        cat: "🪚 硬核",
        emoji: "🐽",
        name: "猪灵蛮兵",
        desc: "首次通关地狱硬核",
        tip: "随堡垒遗迹生成，不会自然刷新",
        type: "once"
    }, {
        id: "hc_brain",
        cat: "🪚 硬核",
        emoji: "🐸",
        name: "呱！",
        desc: "首次通关脑王硬核",
        tip: "这就是外呱!!!",
        type: "once"
    }, {
        id: "hidden_hc_free_20",
        cat: "隐藏",
        emoji: "⛏️",
        name: "加大！加硬！",
        desc: "硬核模式下通关20×20自由棋盘",
        tip: "增强方案",
        type: "special",
        hidden: true,
        check: function() {
            return !!(gameHardcore && isFreeMode && SR === 20 && SC === 20);
        }
    }, {
        id: "all_types_used",
        cat: "系列道具",
        emoji: "🎓",
        name: "毕业生",
        desc: "26种雷型全部参与过通关",
        tip: "看来已经没什么可以教你了",
        type: "special",
        check: function() {
            // 跨局累计集合由通关结算逐局并入，26 种齐全即达成
            let used = _achState.allTypesUsed;
            if (!used || typeof used !== "object") return false;
            let keys = Object.keys(M);
            return keys.length > 0 && keys.every(k => used[k]);
        }
    }, {
        id: "create_all_types",
        cat: "创造模式",
        emoji: "🐊",
        name: "Chaos will follow",
        desc: "创造模式集齐26种雷型生成题库码",
        tip: "混乱将随后而至🐊 --雷克顿",
        type: "special"
    }, {
        id: "hidden_free_26",
        cat: "隐藏",
        emoji: "🥗",
        name: "火药沙拉",
        desc: "自由模式通关参与地雷种类数超过20的题目",
        tip: "刺鼻的化学味、硝烟味、溶剂味混在一起，颜色杂乱，质地干湿不均，看起来不能吃",
        type: "special",
        hidden: true,
        check: function() {
            // 只统计本局真正出现的雷型：牌池数量为 0 的雷型不算参与；
            // G.placed 的键是 "行,列" 坐标，雷型取它对应的值；
            // 参与种类数包含普通雷，超过 20 种即达成
            if (!isFreeMode) return false;
            let types = {};
            let k;
            for (k in G.pool) if (G.pool[k] > 0) types[k] = true;
            for (k in G.placed) {
                let t = G.placed[k];
                if (t) types[t] = true;
            }
            let total = 0;
            for (k in types) if (types[k]) total++;
            return total > 20;
        }
    }, {
        id: "hidden_fullscreen",
        cat: "隐藏",
        emoji: "🫶",
        name: "占满屏幕",
        desc: "首次进入全屏",
        tip: "F11",
        type: "once",
        hidden: true
    }, {
        id: "hidden_savemanage",
        cat: "隐藏",
        emoji: "📦",
        name: "包裹快递！",
        desc: "首次使用存档管理",
        tip: "已校验并签名",
        type: "once",
        hidden: true
    }, {
        id: "hidden_free_5x5",
        cat: "隐藏",
        emoji: "🤏",
        name: "小号手办",
        desc: "自由模式5×5棋盘通关",
        tip: "小小的也很可爱",
        type: "special",
        hidden: true,
        check: function() {
            return !!(isFreeMode && SR === 5 && SC === 5);
        }
    }, {
        id: "hidden_del_100",
        cat: "隐藏",
        emoji: "🗑️",
        name: "回收站",
        desc: "累计删除100次道具",
        tip: "$Recycle.Bin",
        type: "count",
        target: 100,
        hidden: true
    }, /* ---------- 4.2 成就数据表（六）：俄罗斯方块玩法 ---------- */
      {
        // 俄罗斯方块玩法成就：判定口径为开局快照 gameTetris，自由局不计入预设
        id: "Tetris_first",
        cat: "🐻 俄罗斯方块",
        emoji: "🐻‍❄️",
        name: "Polar!",
        desc: "首次通关任意预设难度俄罗斯方块",
        tip: "秦始皇骑北极熊~",
        type: "special",
        check: function() {
            // 与硬核首次通关同构：快照为真且存在真实难度键
            return !!(gameTetris && diff && !isFreeMode);
        }
    }, {
        id: "Tetris_10",
        cat: "🐻 俄罗斯方块",
        emoji: "🥔",
        name: "永冻土",
        desc: "累计通关10次俄罗斯方块预设难度",
        tip: "西伯利亚挖土豆",
        type: "count",
        target: 10
    }, {
        id: "Tetris_easy",
        cat: "🐻 俄罗斯方块",
        emoji: "🪆",
        name: "禁止禁止套娃",
        desc: "俄罗斯方块通关简单",
        tip: "“反弹！”“反弹你的反弹！”“反弹你反弹我的反弹！”",
        type: "once"
    }, {
        id: "Tetris_medium",
        cat: "🐻 俄罗斯方块",
        emoji: "🥃",
        name: "左手伏特加",
        desc: "俄罗斯方块通关中等",
        tip: "Shaken,not stirred ——007",
        type: "once"
    }, {
        id: "Tetris_hard",
        cat: "🐻 俄罗斯方块",
        emoji: "🪖",
        name: "右手波波沙",
        desc: "俄罗斯方块通关困难",
        tip: "PPSh-41 900RPM 71rounds",
        type: "once"
    }, {
        id: "Tetris_hell",
        cat: "🐻 俄罗斯方块",
        emoji: "🪗",
        name: "唱着喀秋莎",
        desc: "俄罗斯方块通关地狱",
        tip: "《Катюша》? BM-13 Rocket Artillery",
        type: "once"
    }, {
        id: "Tetris_brain",
        cat: "🐻 俄罗斯方块",
        emoji: "🫡",
        name: "高声喊Ура!",
        desc: "俄罗斯方块通关脑王",
        tip: "今天政委不在家",
        type: "once"
    }, {
        id: "hidden_Tetris_free_20",
        cat: "隐藏",
        emoji: "🧸",
        name: "抱一个",
        desc: "俄罗斯方块模式通关20行×10列自由棋盘",
        tip: "毛绒绒的俄罗斯方块",
        type: "special",
        hidden: true,
        check: function() {
            // 矩形自由棋盘：行数 20、列数 10，玩法快照为俄罗斯方块
            return !!(gameTetris && isFreeMode && SR === 20 && SC === 10);
        }
    } ];

    /* ---------- 4.5 与存档编码表的一致性校验 ---------- */

    /**
     * 校验成就数据表与 00-core 的 RM.ACH_IDS 编码表是否一致。
     * 存档位图按 RM.ACH_IDS 的数组下标编码，解码时再按 id 回查，因此真正
     * 需要保证的是「两张表的 id 集合完全相同且各自无重复」；表内展示顺序
     * 与位序可以不同（历史版本的位序与面板分组顺序本来就不一致，重排位序
     * 会让旧存档的解锁状态错位）。只记录警告，不抛错、不改数据。
     * @sideeffect 不一致时写入一条 RM.warn 记录（标记 "achievements:ids"）。
     */
    function verifyAchievementIds() {
        try {
            if (!window.RM) return;
            let canonical = window.RM.ACH_IDS;
            if (!Array.isArray(canonical)) return;
            let ids = ACHIEVEMENTS.map(a => a.id);
            let dupCanonical = canonical.filter(function(id, i) { return canonical.indexOf(id) !== i; });
            let dupTable = ids.filter(function(id, i) { return ids.indexOf(id) !== i; });
            let sameSet = ids.length === canonical.length &&
                ids.every(function(id) { return canonical.indexOf(id) >= 0; }) &&
                canonical.every(function(id) { return ids.indexOf(id) >= 0; });
            if (!sameSet || dupCanonical.length || dupTable.length) {
                RM.warn("achievements:ids", "成就 id 集合与存档编码表不一致（表内顺序可以不同）");
            }
        } catch (e) {}
    }
    // 本文件在 00-core 之后加载，IIFE 初始化阶段即可完成校验
    verifyAchievementIds();

    /* ---------- 5. 成就状态与持久化 ---------- */

    // 存档键：解锁时间、计数器与本局过程数据合并存放在同一条记录中
    const STORE_KEY = "achievementState_v1";
    // 已有存档中可能出现的纯日期形态（如 2024-05-01）与完整 ISO 时间形态，规范化时据此区分
    const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
    const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/;
    // loadState 执行时 _achState 尚未完成赋值，而 saveState 依赖 _achState，
    // 因此这里只记录"规范化改写过存档"，回写动作推迟到赋值完成之后
    let _stateNormalized = false;
    // 运行期状态：启动时读取一次，之后所有判定与渲染都基于这份对象
    let _achState = loadState();
    // 规范化改写过存档就立即回写一次，让内存与磁盘上的时间格式保持一致
    if (_stateNormalized) saveState();
    /**
     * 把解锁时间统一成完整 ISO 时间戳。
     * 规则：纯日期字符串按浏览器本地时区当天 00:00 解释，避免被当成 UTC 造成
     * 日期漂移；数字按时间戳处理，小于 1e12 视为秒级、否则视为毫秒；
     * 其余无法识别的值一律返回 null，由调用方按"视为未解锁"处理。
     * @param {*} v 存档中记录的解锁值
     * @returns {string|null} 规范化后的 ISO 字符串；非法值返回 null
     */
    function toIsoUnlockTime(v) {
        if (typeof v === "string") {
            let m = DATE_ONLY_RE.exec(v);
            if (m) {
                let d = new Date(+m[1], +m[2] - 1, +m[3]);
                // Date 会把 2024-13-01 这类非法日期自动进位，这里要求原样还原
                if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
                return d.toISOString();
            }
            // 已是完整 ISO（或带时区偏移）时先解析再统一格式，时区偏移会被折算成 Z
            if (ISO_TIME_RE.test(v)) {
                let ms = Date.parse(v);
                return isNaN(ms) ? null : new Date(ms).toISOString();
            }
            return null;
        }
        // 数字时间戳：秒级常见于外部导入，统一折算为毫秒
        if (typeof v === "number" && isFinite(v) && v > 0) {
            let ms = v < 1e12 ? v * 1e3 : v;
            let d = new Date(ms);
            return isNaN(d.getTime()) ? null : d.toISOString();
        }
        return null;
    }
    /**
     * 规范化解锁记录：把每条解锁值统一成完整 ISO 时间戳，非法值直接删除
     * （视为从未解锁）。只改写 unlocked 内已有键的值或删除非法键，不添加新键，
     * 也不调整键顺序，因此不会影响解锁计数与面板显示顺序。
     * @param {Object} st 成就状态对象（原地修改）
     * @returns {boolean} 是否发生了改写
     */
    function normalizeAchievements(st) {
        if (!st || typeof st !== "object" || Array.isArray(st)) return false;
        let changed = false;
        // 存档可能缺少 unlocked 字段，补一份空表避免后续读取到 undefined
        if (!st.unlocked || typeof st.unlocked !== "object" || Array.isArray(st.unlocked)) {
            st.unlocked = {};
            changed = true;
        }
        Object.keys(st.unlocked).forEach(function(id) {
            let iso = toIsoUnlockTime(st.unlocked[id]);
            if (iso === null) {
                delete st.unlocked[id];
                changed = true;
            } else if (iso !== st.unlocked[id]) {
                st.unlocked[id] = iso;
                changed = true;
            }
        });
        return changed;
    }
    /**
     * 读取成就状态；无存档或解析失败时返回一份完整的默认状态。
     * 读到已有存档时顺带做一次规范化（纯日期 / 数字时间戳 → 完整 ISO），
     * 规范化结果由启动阶段统一回写；默认状态覆盖全部判定字段，避免后续
     * 读取到 undefined。
     * @returns {Object} 成就状态对象
     */
    function loadState() {
        try {
            let raw = Store.get(STORE_KEY);
            if (raw) {
                let st = JSON.parse(raw);
                // 结构可用时规范化解锁时间；结构不可用时按默认状态处理
                if (st && typeof st === "object" && !Array.isArray(st)) {
                    if (normalizeAchievements(st)) _stateNormalized = true;
                    return st;
                }
            }
        } catch (e) {}
        // 字段说明：currentRun* 是本局过程数据，每局开始时重置；
        // totalWins / nightWins / sharedWins 是跨局累计值；grass* 用于挂机计时
        return {
            unlocked: {},
            counters: {},
            totalWins: 0,
            nightWins: 0,
            basicTypesUsed: {},
            /* 跨局累计的雷型集合：通关时并入本局放置过的雷型，供全类型成就判定 */
            allTypesUsed: {},
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
    /**
     * 把当前成就状态写回 localStorage；存储不可用时静默失败。
     * @sideeffect 写 Store 的 achievementState_v1 键。
     */
    function saveState() {
        try {
            Store.save(STORE_KEY, _achState);
        } catch (e) {}
    }
    /* ---------- 6. 解锁流程与弹窗队列 ---------- */

    // 弹窗按队列串行播放：同一帧内解锁多个成就时不会互相覆盖
    let _popupQueue = [];
    let _popupActive = false;
    /**
     * 把一个成就加入弹窗队列；当前没有弹窗在播放时立即开始播放。
     * @param {Object} ach 成就数据对象
     * @sideeffect 入队并可能触发一次弹窗播放。
     */
    function showPopup(ach) {
        _popupQueue.push(ach);
        if (!_popupActive) processPopupQueue();
    }
    /**
     * 依次播放队列中的成就弹窗：每个展示 3 秒，间隔 400ms 再播下一个，
     * 队列清空后复位播放标志。
     * @sideeffect 改写弹窗节点文本与 active 类名，并播放成就音效。
     */
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
        // 固定展示 3 秒后收起，再留 400ms 间隔播放下一项，避免视觉上连成一片
        setTimeout(() => {
            overlay.classList.remove("active");
            setTimeout(processPopupQueue, 400);
        }, 3e3);
    }
    /**
     * 解锁一个成就：已解锁则直接返回；否则记录解锁时间戳、保存并加入弹窗队列。
     * @param {string} id 成就 id
     * @sideeffect 写 _achState.unlocked、存档，并重绘成就面板。
     */
    function unlock(id) {
        // 已解锁的成就直接跳过，保证解锁时间与弹窗都只产生一次
        if (_achState.unlocked[id]) return;
        let ach = ACHIEVEMENTS.find(a => a.id === id);
        if (!ach) return;
        // 记录完整 ISO 时间戳（含 T、时分秒与 Z），面板展示时再换算成本地时间；
        // 存档层会把它压缩为时间戳，业务层只需保证是完整的 ISO 字符串
        _achState.unlocked[id] = (new Date).toISOString();
        saveState();
        showPopup(ach);
        renderAchievements();
    }
    /**
     * 给计数型成就累加进度，达到 target 时自动解锁。
     * @param {string} id 成就 id
     * @param {number} [by=1] 每次增加的数量
     * @sideeffect 写计数器、存档并重绘成就面板。
     */
    function incrementCounter(id, by) {
        by = by || 1;
        _achState.counters[id] = (_achState.counters[id] || 0) + by;
        let ach = ACHIEVEMENTS.find(a => a.id === id);
        // 只有计数型成就在此处自动解锁，其余类型由各自的触发点判定
        if (ach && ach.type === "count" && _achState.counters[id] >= ach.target) unlock(id);
        saveState();
        renderAchievements();
    }
    /**
     * 直接把计数型成就的进度设为指定值，达标时自动解锁。
     * 用于总胜场这类可整体回填、无需逐次累加的计数。
     * @param {string} id 成就 id
     * @param {number} val 新的进度值
     * @sideeffect 写计数器、存档并重绘成就面板。
     */
    function setCounter(id, val) {
        _achState.counters[id] = val;
        let ach = ACHIEVEMENTS.find(a => a.id === id);
        if (ach && ach.type === "count" && val >= ach.target) unlock(id);
        saveState();
        renderAchievements();
    }
    /* ---------- 7. 通关结算：统一判定所有通关类成就 ---------- */

    /**
     * 通关结算入口：由 08-ui 在判定胜利后调用，集中处理所有依赖本局结果
     * 的成就，包括累计次数、限时、时段彩蛋、棋盘内容与特殊条件。
     * 教学关不计入任何通关类成就。
     * @sideeffect 读写解锁状态与计数器，并刷新成就面板与记录表。
     */
    function checkWinAchievements() {
        // 教学关只用于引导，不参与任何通关类成就统计
        if (isTutorialMode) return;
        unlock("first_win");
        let day = (new Date).getDay();
        // 星期四彩蛋：任意一局通关即可解锁
        if (day === 4) unlock("crazy_thursday");
        if (diff === "brain" && ct > 6e5) unlock("brain_slow");
        // 五个预设难度的最佳成绩之和低于 555 秒时解锁速通总成就
        let sumTime = 0;
        let hasAllRec = true;
        [ "easy", "medium", "hard", "hell", "brain" ].forEach(function(d) {
            if (rec[d]) sumTime += rec[d]; else hasAllRec = false;
        });
        // 五个预设难度的最佳成绩之和低于 555 秒时解锁速通总成就；
        // 与分类口径一致，只判定经典玩法（硬核 / 骨牌局不触发）
        if (!gameHardcore && !gameTetris && hasAllRec && sumTime > 0 && sumTime < 555e3) unlock("speed_all");
        // 扫描本局题目的期望值，判断是否同时出现正 / 零 / 负三种数值
        let hasPos = false, hasZero = false, hasNeg = false;
        for (let r = 0; r < SR; r++) for (let c = 0; c < SC; c++) {
            let v = G.tar[r][c];
            if (v > 0) hasPos = true; else if (v < 0) hasNeg = true; else hasZero = true;
        }
        if (hasPos && hasZero && hasNeg) unlock("red_green_light");
        // 经典玩法专属：按难度累计通关次数，并检查限时与"一把过"成就。
        // 硬核与俄罗斯方块玩法各有独立分组，不能把本局计入"经典"类成就。
        if (diff && !isFreeMode) {
            if (!gameHardcore && !gameTetris) {
                if (diff === "easy") incrementCounter("easy_10");
                if (diff === "medium") incrementCounter("medium_10");
                if (diff === "hard") {
                    incrementCounter("hard_10");
                    unlock("hard_first");
                }
                if (diff === "hell") {
                    unlock("hell_first");
                    incrementCounter("hell_7");
                }
                if (diff === "brain") {
                    unlock("brain_first");
                    incrementCounter("brain_10");
                }
            }
            // 硬核预设难度：按难度记录首次硬核通关，并累计硬核总次数
            if (gameHardcore) {
                unlock("hc_first");
                if (diff === "easy") unlock("hc_easy");
                if (diff === "medium") unlock("hc_medium");
                if (diff === "hard") unlock("hc_hard");
                if (diff === "hell") unlock("hc_hell");
                if (diff === "brain") unlock("hc_brain");
                // 硬核累计次数取成绩层的五难度求和：08-ui 在本函数之前已把
                // 本局胜场写入 hcWins，因此这里读到的是含本局的最新值
                if (typeof hcWins !== "undefined" && hcWins) {
                    let hcSum = 0;
                    [ "easy", "medium", "hard", "hell", "brain" ].forEach(function(d) {
                        hcSum += (typeof hcWins[d] === "number" ? hcWins[d] : 0);
                    });
                    setCounter("hc_10", hcSum);
                }
            }
            // 俄罗斯方块预设难度：记录各难度首通，并按五难度总胜场回填累计成就。
            // 累计次数取成绩层的 tetWins 求和：08-ui 在本函数之前已把本局胜场
            // 写入 tetWins，因此这里读到的是含本局的最新值（与 hc_10 同构）。
            if (gameTetris) {
                unlock("Tetris_first");
                if (diff === "easy") unlock("Tetris_easy");
                if (diff === "medium") unlock("Tetris_medium");
                if (diff === "hard") unlock("Tetris_hard");
                if (diff === "hell") unlock("Tetris_hell");
                if (diff === "brain") unlock("Tetris_brain");
                if (typeof tetWins !== "undefined" && tetWins) {
                    let tetSum = 0;
                    [ "easy", "medium", "hard", "hell", "brain" ].forEach(function(d) {
                        tetSum += (typeof tetWins[d] === "number" ? tetWins[d] : 0);
                    });
                    setCounter("Tetris_10", tetSum);
                }
            }
            // 限时成就只判定经典玩法，且只在有有效用时的前提下判定，
            // 避免硬核 / 骨牌局污染速通成绩
            if (!gameHardcore && !gameTetris && ct > 0) {
                if (diff === "easy" && ct < 7e3) unlock("speed_easy");
                if (diff === "medium" && ct < 25e3) unlock("speed_medium");
                if (diff === "hard" && ct < 6e4) unlock("speed_hard");
                if (diff === "hell" && ct < 18e4) unlock("speed_hell");
                if (diff === "brain" && ct < 3e5) unlock("speed_brain");
            }
            // 中等及以上难度全程未删雷 / 未清空，视为完美通关
            if ((diff === "medium" || diff === "hard" || diff === "hell" || diff === "brain") && _achState.currentRunFlawless) {
                unlock("hidden_flawless");
            }
        }
        // 自由模式的棋盘尺寸类成就由末尾通用 special 判定统一处理
        // 时段彩蛋：早餐时段与下午茶时段各对应一个隐藏成就
        if (diff && !isFreeMode) {
            let nowH = (new Date).getHours();
            if (nowH >= 6 && nowH < 10) unlock("hidden_icecream");
            if (nowH === 15) unlock("hidden_teatime");
        }
        // 总胜场只增不减，并回填到 20 / 50 / 150 / 500 四档累计成就
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
        // 夜间胜场单独累计：22:00 至次日 04:00 之间的通关
        let h = (new Date).getHours();
        if (h >= 22 || h < 4) {
            _achState.nightWins = (_achState.nightWins || 0) + 1;
            let nightCurrent = _achState.counters["total_night"] || 0;
            if (_achState.nightWins > nightCurrent) {
                setCounter("total_night", _achState.nightWins);
            }
        }
        // 基础雷种收集情况与分享关卡通关数也在此回填
        if (_achState.basicTypesUsed) {
            let basics = Object.keys(M).filter(k => M[k].category === "basic");
            if (basics.length > 0 && basics.every(k => _achState.basicTypesUsed[k])) unlock("basic_all_used");
        }
        // 全类型收集：把本局放置过的雷型并入跨局累计集合（14 种之外的新字段
        // 由存档层作为附加成员原样保存，不影响旧字段的二进制布局）
        if (G.placed) {
            if (!_achState.allTypesUsed || typeof _achState.allTypesUsed !== "object" ||
                Array.isArray(_achState.allTypesUsed)) {
                _achState.allTypesUsed = {};
            }
            for (let pk in G.placed) {
                let pt = G.placed[pk];
                if (pt && M[pt]) _achState.allTypesUsed[pt] = true;
            }
        }
        // 本局来自题库码时累计观光客进度，并消费掉一次性标记
        if (window._currentIsShared) {
            _achState.sharedWins = (_achState.sharedWins || 0) + 1;
            setCounter("play_shared_5", _achState.sharedWins);
            window._currentIsShared = false;
        }
        if (_achState.currentRunCategories && _achState.currentRunCategories.size >= 6) unlock("hidden_chaos");
        // 通用 special 判定：遍历全部 special 成就（含隐藏成就），未解锁的逐个
        // 执行 check；单个判定抛异常时忽略该成就，不影响其余成就结算
        ACHIEVEMENTS.forEach(a => {
            if (a.type === "special" && !_achState.unlocked[a.id] && a.check) {
                try {
                    if (a.check()) unlock(a.id);
                } catch (e) {}
            }
        });
        saveState();
        renderAchievements();
        renderRecordList();
    }
    /* ---------- 8. 成就面板渲染 ---------- */

    /**
     * 把 ISO 解锁时间格式化为本地时区的 "YYYY-MM-DD HH:mm"。
     * @param {string} iso 完整 ISO 时间字符串
     * @returns {string} 本地时间文本；非法值回退为"未知时间"
     */
    function fmtUnlockTime(iso) {
        if (typeof iso !== "string" || !iso) return "未知时间";
        let ms = Date.parse(iso);
        if (isNaN(ms)) return "未知时间";
        let d = new Date(ms);
        return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
            " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    }
    /**
     * 两位补零，用于拼接本地时间文本。
     * @param {number} n 0-99 的整数
     * @returns {string} 补零后的字符串
     */
    function pad2(n) {
        return n < 10 ? "0" + n : "" + n;
    }
    /**
     * 面板可见的成就总数：非隐藏成就 + 已解锁的隐藏成就。
     * @returns {number} 面板上实际展示的条目数
     */
    function visibleTotal() {
        return ACHIEVEMENTS.filter(a => !a.hidden || _achState.unlocked[a.id]).length;
    }
    /**
     * 按固定分组顺序重建成就面板：已解锁项展示名称、条件与本地解锁时间，
     * 未解锁项展示锁图标，隐藏成就未解锁前只显示问号。
     * @sideeffect 重建 #achList 的 innerHTML，并更新已解锁 / 总数统计。
     */
    function renderAchievements() {
        let container = document.getElementById("achList");
        if (!container) return;
        let groups = {};
        ACHIEVEMENTS.forEach(a => {
            // 隐藏且未解锁的成就不进入分组，避免在面板上提前暴露
            if (a.hidden && !_achState.unlocked[a.id]) return;
            if (!groups[a.cat]) groups[a.cat] = [];
            groups[a.cat].push(a);
        });
        // 分组显示顺序固定：与成就表里的 cat 取值一一对应
        let catOrder = [ "新手村", "经典", "🪚 硬核", "🐻 俄罗斯方块", "系列道具", "速通", "创造模式", "累计通关", "隐藏" ];
        let html = "";
        catOrder.forEach(cat => {
            if (!groups[cat]) return;
            // 隐藏组单独带类名，供样式使用更醒目的深红标题
            html += `<div class="achievement-group-title${cat === "隐藏" ? " is-hidden" : ""}">${cat}</div>`;
            groups[cat].forEach(a => {
                let unlocked = !!_achState.unlocked[a.id];
                let cls = "achievement-item" + (unlocked ? " unlocked" : "") + (a.hidden ? " hidden-ach" : "");
                let name = unlocked ? a.name : a.hidden ? "？？？" : "🔒 " + a.name;
                let desc = unlocked ? a.desc : a.hidden ? "隐藏成就，达成后揭晓" : a.desc;
                let meta = "";
                // 已解锁显示本地时区的解锁时间；计数型成就显示当前进度
                if (unlocked) meta = "🗓️ " + fmtUnlockTime(_achState.unlocked[a.id]); else if (a.type === "count") meta = `进度 ${_achState.counters[a.id] || 0}/${a.target}`;
                // 未解锁统一显示锁图标；隐藏成就同样只显示锁，不暴露条件
                let lockIcon = unlocked ? "✅" : a.hidden ? "🔒" : "🔒";
                let tipText = unlocked ? a.tip || "" : a.hidden ? "隐藏成就，达成后揭晓提示" : a.tip || "";
                html += `<div class="${cls}" data-tip="${tipText.replace(/"/g, "&quot;")}">\n                    <div class="achievement-emoji">${a.emoji}</div>\n                    <div class="achievement-info">\n                        <div class="achievement-name">${name}</div>\n                        <div class="achievement-desc">${desc}</div>\n                        ${meta ? `<div class="achievement-meta">${meta}</div>` : ""}\n                    </div>\n                    <div class="achievement-lock">${lockIcon}</div>\n                </div>`;
            });
        });
        container.innerHTML = html;
        // 可见总数 = 非隐藏成就 + 已解锁的隐藏成就，不提前暴露隐藏成就数量
        let total = visibleTotal();
        let unlocked = Object.keys(_achState.unlocked).length;
        let uc = document.getElementById("achUnlockedCount");
        let tc = document.getElementById("achTotalCount");
        if (uc) uc.textContent = unlocked;
        if (tc) tc.textContent = total;
        // 记录栏折叠标题摘要：收起时也能看到已解锁数量（与成绩标题同款位置）
        let hint = document.getElementById("achSectionHint");
        if (hint) hint.textContent = unlocked + " / " + total;
    }
    /* ---------- 9. 钩子装配：包装既有全局函数 ---------- */

    /**
     * 安装成就钩子：包装若干全局函数，在原有行为前后插入成就统计。
     *
     * 为什么采用"重写全局函数"而不是直接改写业务函数：
     *   1) 解耦：业务模块（落子、删雷、生成题库码等）不需要知道成就系统
     *      的存在，成就逻辑全部收敛在本文件，便于单独阅读与维护。
     *   2) 可插拔：每个钩子都先保存原实现再调用，业务行为保持不变，只追加
     *      副作用；不调用 installHooks 即可关闭整套统计而不影响游戏。
     *   3) 集中埋点：70 个成就的触发点在同一段代码内可见，不必在多个业务
     *      文件之间搜索分散的统计语句。
     * 安装顺序：必须在首次 newGame 前完成，这样开局就处于统计范围内；
     * 并用 _achHooksInstalled 防止重复安装，否则包装层会叠加导致重复计数。
     * @sideeffect 重写 window 上的若干全局函数与 #reset 按钮处理器。
     */
    function installHooks() {
        // 重复安装会让包装层叠加（同一次操作被统计多次），因此只允许安装一次
        if (window._achHooksInstalled) return;
        window._achHooksInstalled = true;
        var NS = window._gameNS || {};
        // 优先取同名全局函数，取不到时回落到 12-settings 登记的 _gameNS
        let _oUL = typeof window.unlockSeries === "function" ? window.unlockSeries : NS.unlockSeries;
        window.unlockSeries = function(catKey) {
            if (_oUL) _oUL.apply(this, arguments);
            // 按解锁的系列类别映射到对应成就；解锁逻辑本身保持不变
            if (catKey === "special") unlock("unlock_special");
            if (catKey === "physics") unlock("unlock_physics");
            if (catKey === "symmetry") unlock("unlock_symmetry");
            if (catKey === "tactical") unlock("unlock_tactical");
            if (catKey === "poker") unlock("unlock_poker");
            renderAchievements();
        };
        let _oTW = typeof window.onTutorialWin === "function" ? window.onTutorialWin : NS.onTutorialWin;
        window.onTutorialWin = function() {
            if (_oTW) _oTW.apply(this, arguments);
            // 被包装函数先更新教学进度，这里只在其后判断是否完成全部引导
            if (tutorialStep >= 5) unlock("finish_tutorial");
        };
        let _oDel = typeof window.del === "function" ? window.del : NS.del;
        window.del = function(r, c) {
            // 删雷属于非完美操作：累计次数并让"一把过"成就失效
            if (!isTutorialMode) {
                _achState.currentRunDeletes++;
                _achState.currentRunFlawless = false;
                if (_achState.currentRunDeletes >= 20) unlock("hidden_slide");
                // 跨局累计删除单独计数，与单局 20 次的 hidden_slide 互不影响；
                // incrementCounter 内部会把本局过程字段一起落盘
                incrementCounter("hidden_del_100");
            }
            if (_oDel) return _oDel(r, c);
        };
        // 同步裸标识符 del：其他模块以 del(...) 直接调用时也会经过包装
        if (typeof del !== "undefined") del = window.del;
        let _oCA = typeof window.clearAll === "function" ? window.clearAll : NS.clearAll;
        window.clearAll = function() {
            // 清空放置同样会让"一把过"失效，并直接解锁环保成就
            if (!isTutorialMode) {
                _achState.currentRunFlawless = false;
                unlock("hidden_eco");
            }
            if (_oCA) _oCA.apply(this, arguments);
        };
        if (typeof clearAll !== "undefined") clearAll = window.clearAll;
        // HTML 上的点击处理器仍指向包装前的函数，需要重新绑定到包装后的实现
        document.getElementById("slotClearBtn").onclick = window.clearAll;
        let _oDrop = typeof window.drop === "function" ? window.drop : NS.drop;
        window.drop = function(e) {
            let result;
            if (_oDrop) result = _oDrop.apply(this, arguments);
            // 记录本局使用过的雷种系列；基础系列额外记录具体雷种
            if (!isTutorialMode) {
                if (!_achState.currentRunCategories) _achState.currentRunCategories = new Set;
                // 部分拖拽路径取不到 dataTransfer，回落到 G.lastDragType 中的落子类型
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
            }
            return result;
        };
        if (typeof drop !== "undefined") drop = window.drop;
        // 长草计时统一挂在 resetP 上：放置 / 删除 / 移动 / 清空都会经过这里
        let _oResetP = typeof window.resetP === "function" ? window.resetP : NS.resetP;
        window.resetP = function() {
            if (ts) resetGrassTimer();
            if (_oResetP) return _oResetP.apply(this, arguments);
        };
        if (typeof resetP !== "undefined") resetP = window.resetP;
        let _oGen = typeof window.generatePuzzleCode === "function" ? window.generatePuzzleCode : NS.generatePuzzleCode;
        window.generatePuzzleCode = function() {
            let result;
            if (_oGen) result = _oGen.apply(this, arguments);
            // 生成题库码成功后统计创造模式次数与题目构成
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
                // 已放地雷数达到棋盘上限时解锁"巧克力蛋糕"
                if (Object.keys(createPlaced).length >= maxMines && maxMines > 0) {
                    _achState.lastCreateMaxMines = true;
                    unlock("create_max_mines");
                }
                // 全类型创造：统计创造棋盘上用到过的去重雷型，集齐全类型即解锁
                let usedTypes = {};
                for (let pk in createPlaced) {
                    let pt = createPlaced[pk];
                    if (pt && M[pt]) usedTypes[pt] = true;
                }
                let allTypeKeys = Object.keys(M);
                if (allTypeKeys.length > 0 && allTypeKeys.every(t => usedTypes[t])) {
                    unlock("create_all_types");
                }
                saveState();
            }
            return result;
        };
        let _oApply = typeof window.applyPuzzleCode === "function" ? window.applyPuzzleCode : NS.applyPuzzleCode;
        window.applyPuzzleCode = function() {
            // 先标记本局来自分享码，再执行原解析逻辑，供通关结算统计观光客
            window._currentIsShared = true;
            if (_oApply) return _oApply.apply(this, arguments);
        };
        let _oFR = typeof window.fullReset === "function" ? window.fullReset : NS.fullReset;
        window.fullReset = function() {
            // 每局开始重置过程数据：本局用过的系列、删除次数与完美通关标记
            _achState.currentRunCategories = new Set;
            _achState.currentRunDeletes = 0;
            _achState.currentRunFlawless = true;
            saveState();
            if (_oFR) return _oFR.apply(this, arguments);
        };
        if (typeof fullReset !== "undefined") fullReset = window.fullReset;
        /* ---------- 10. 钩子装配：计时与界面类触发点 ---------- */

        // 挂机检测：计时器运行中连续 15 秒没有任何棋盘操作时解锁"长草"
        let _grassInterval = null;
        /**
         * 启动挂机检测：每秒检查一次距上次操作的间隔，达到 15 秒即解锁；
         * 计时器停止时检测自动结束。
         * @sideeffect 创建周期定时器并记录挂机起始时间。
         */
        function startGrassTimer() {
            if (_grassInterval) return;
            // 一次性成就：已解锁或计时器不在运行时都不必再挂检测
            if (!ts || (_achState.unlocked && _achState.unlocked.hidden_grass)) return;
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
        /**
         * 停止挂机检测并清空定时器句柄。
         * @sideeffect 清除 _grassInterval 定时器。
         */
        function stopGrassTimer() {
            if (_grassInterval) {
                clearInterval(_grassInterval);
                _grassInterval = null;
            }
        }
        /**
         * 废弃当前的长草倒计时，并从此刻重新开始。
         * @sideeffect 清掉上一轮定时器并重新创建检测周期。
         */
        function resetGrassTimer() {
            stopGrassTimer();
            startGrassTimer();
        }
        // 计时器启停也是触发点：开局启动挂机检测，结束则停止检测
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
        // 第二层包装 fullReset：追加挂机检测清理；两层包装各自独立、互不覆盖
        let _origFullReset2 = fullReset;
        fullReset = function() {
            stopGrassTimer();
            _origFullReset2.apply(this, arguments);
        };
        // 背景音乐滑块的首个 input 事件即解锁"龙？"成就，且只统计一次
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
        /* ---- 成就「首次进入全屏」：监听各浏览器前缀的全屏状态变化 ----
           三个事件名覆盖标准与旧版内核，任一事件报告存在全屏元素即视为进入全屏；
           解锁本身是幂等的，重复事件不会产生额外解锁。 */
        try {
            let onFullscreenChange = function() {
                let fsEl = document.fullscreenElement || document.webkitFullscreenElement ||
                    document.msFullscreenElement;
                if (fsEl) unlock("hidden_fullscreen");
            };
            [ "fullscreenchange", "webkitfullscreenchange", "MSFullscreenChange" ].forEach(function(ev) {
                document.addEventListener(ev, onFullscreenChange);
            });
        } catch (e) {}
        /* ---- 成就「退！退！退！」：统计「新游戏」按钮的点击次数 ----
           只接管 #reset 这一个入口：程序内部调用 newGame()（如首屏启动、
           退出创造模式）不算玩家点击，必须真的按下按钮三次才解锁。
           计数器 new_game_spam 用标志位保证只初始化一次，重复安装钩子时
           不会把已经累计的点击清零。 */
        if (!_achState.newGameSpamV2) {
            // 清掉不参与判定的 newGameClicks 字段，只保留 counters 中的计数
            delete _achState.newGameClicks;
            if (!_achState.counters) _achState.counters = {};
            _achState.counters["new_game_spam"] = 0;
            _achState.newGameSpamV2 = true;
            saveState();
        }
        let _resetBtn = document.getElementById("reset");
        if (_resetBtn) {
            // 保存 10-game.js 绑定的 newGame 处理器，包装后仍然调用它
            let _origResetClick = _resetBtn.onclick;
            _resetBtn.onclick = function(e) {
                incrementCounter("new_game_spam");
                if (typeof _origResetClick === "function") return _origResetClick.call(this, e);
            };
        }
    }

    /* ---------- 11. 侧边栏开关与启动 ---------- */

    /**
     * 初始化成就侧边栏开关：展开前先收起其他侧栏，展开时刷新面板与记录表。
     * @sideeffect 切换 #achSidebar 的 open 类名并重绘内容。
     */
    function initToggle() {
        let btn = document.getElementById("toggleAchSidebar");
        let sb = document.getElementById("achSidebar");
        if (!btn || !sb) return;
        btn.addEventListener("click", () => {
            AudioFX.confirm();
            const willOpen = !sb.classList.contains("open");
            // 同一时间只允许展开一个侧栏，避免面板相互遮挡
            closeSidebarsExcept("achSidebar");
            sb.classList.toggle("open", willOpen);
            renderAchievements();
            renderRecordList();
        });
    }
    /**
     * 启动成就系统：先安装钩子，再初始化侧栏并渲染面板。
     * 首局由 10-game 的 window.onload 统一触发（本模块只保证钩子先于首局装好），
     * 避免启动时重复生成两局棋盘。
     * @sideeffect 安装全局钩子、绑定侧栏事件并渲染成就 / 成绩面板。
     */
    function init() {
        installHooks();
        initToggle();
        renderAchievements();
        renderRecordList();
    }
    // 脚本可能晚于 DOMContentLoaded 执行，两种时机都要能完成启动
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

    /* ---------- 12. 只读查询接口（供存档详情等界面使用） ---------- */

    /**
     * 返回成就数据表。只返回引用、不做深拷贝，调用方必须按只读使用：
     * 修改数组或其中元素会影响成就判定，以及存档位图的编码顺序。
     * @returns {Array<Object>} 70 条成就定义
     */
    function list() {
        return ACHIEVEMENTS;
    }
    /**
     * 按 id 查询成就定义。
     * @param {string} id 成就 id
     * @returns {Object|null} 成就定义；id 不存在时返回 null
     */
    function byId(id) {
        return ACHIEVEMENTS.find(a => a.id === id) || null;
    }
    /**
     * 查询一个成就的解锁时间。
     * @param {string} id 成就 id
     * @returns {number|null} 解锁时间毫秒数；未解锁或时间非法返回 null
     */
    function unlockTime(id) {
        let raw = _achState.unlocked ? _achState.unlocked[id] : undefined;
        let iso = toIsoUnlockTime(raw);
        if (iso === null) return null;
        let ms = Date.parse(iso);
        return isNaN(ms) ? null : ms;
    }
    /**
     * 汇总当前成就状态，供存档详情等界面直接展示。
     * firstAt / lastAt 按解锁时间毫秒数统计，时间非法的解锁不参与首末判断。
     * @returns {{unlocked:number,visibleTotal:number,total:number,
     *   firstAt:(number|null),lastAt:(number|null),hiddenUnlocked:number}}
     */
    function summary() {
        let unlockedMap = _achState.unlocked || {};
        let firstAt = null, lastAt = null, hiddenUnlocked = 0;
        ACHIEVEMENTS.forEach(function(a) {
            if (!unlockedMap[a.id]) return;
            if (a.hidden) hiddenUnlocked++;
            let ms = unlockTime(a.id);
            if (ms === null) return;
            if (firstAt === null || ms < firstAt) firstAt = ms;
            if (lastAt === null || ms > lastAt) lastAt = ms;
        });
        return {
            unlocked: Object.keys(unlockedMap).length,
            visibleTotal: visibleTotal(),
            total: ACHIEVEMENTS.length,
            firstAt: firstAt,
            lastAt: lastAt,
            hiddenUnlocked: hiddenUnlocked
        };
    }
    // 暴露给 08-ui 的通关流程调用
    window.checkWinAchievements = checkWinAchievements;
    // 对外接口：unlock / incrementCounter / renderAchievements / state，
    // 以及 list / byId / unlockTime / summary 四个只读查询接口
    window.Achievements = {
        unlock: unlock,
        incrementCounter: incrementCounter,
        renderAchievements: renderAchievements,
        state: _achState,
        list: list,
        byId: byId,
        unlockTime: unlockTime,
        summary: summary
    };
})();
