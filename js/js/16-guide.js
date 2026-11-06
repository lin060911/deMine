/* ==========================================================================
 * 模块 16 · 新手引导层（js/16-guide.js）
 *
 * 职责：用一只会动的小手 + 目标高亮环 + 一句话气泡，告诉玩家"现在该点哪 /
 *       该把地雷拖到哪"；设置与创造的介绍按"下一处"逐项讲完；指引未解锁
 *       系列的「挑战」按钮时，额外让「🎯挑战」弹窗里对应系列行同步闪烁。
 * 依赖：DOM（棋盘格、雷槽、侧栏与弹窗按钮）、Store（记住已看过的引导）、
 *       TEACH_LEVELS / teachActive / teachLevelIdx（09-tutorial）、
 *       isBasicChallengeDone / seriesUnlocked 等全局状态。
 * 对外：window.guideRefresh()（状态变化后请求刷新引导）、window.Guide。
 * 设计要点：
 *   1) 引导层 pointer-events:none；气泡里的「下一处」按钮单独放开点击。
 *   2) 高亮环、气泡与小手锚点每帧按目标元素的 getBoundingClientRect() 重新
 *      定位，侧栏滑入、页面滚动、棋盘重绘时都跟得上，不会"飘"。
 *   3) 全部候选按优先级即时判定，不预排时间轴：UI 状态一变，下一次 tick 就
 *      自动换目标或收起。
 *   4) 频率：只有教学第 4-12 关保留"闲置 4 秒后才出现"的节奏；其余引导
 *      （含教学第 1-3 关）条件一满足就立即出现，单步最多两轮。带「下一处」
 *      的介绍类引导按按钮逐条推进，不点按钮就不会消失。
 *   5) 只有一个可见按钮的弹窗不再套高亮环，只保留气泡与小手，避免重复强调
 *      唯一可点的目标。
 * ========================================================================== */

(function() {
    "use strict";

    /* ---------- 1. 常量与运行时状态 ---------- */

    var IDLE_MS = 4000;
    var TICK_MS = 400;
    var LOOPS = 2;
    var TOUCH_PAUSE_MS = 800;

    // 按方向挑选的手部 emoji；同一轮里轮换，保持多变
    var HANDS = {
        tap: [ "👆", "☝️", "🤏", "👌", "✋", "👋", "🤞" ],
        up: [ "👆", "☝️", "🖐️", "✋" ],
        down: [ "👇", "🖐️", "✋" ],
        right: [ "👉", "🖐️", "👋" ],
        left: [ "👈", "🖐️" ]
    };

    var state = {
        seen: {},
        bootAt: Date.now(),
        candKey: null,
        playing: false,
        plays: 0,
        playedAt: 0,
        lastActivity: 0,
        pauseUntil: 0,
        lastMoveNote: 0,
        anim: null,
        playToken: 0,
        cand: null,
        raf: 0,
        geomKey: "",
        tour: null,      // { id, idx, stops }
        diffStage: 0
    };

    var layer = null;
    var ring = null;
    var anchor = null;
    var hand = null;
    var bubble = null;
    var bubbleText = null;
    var bubbleNext = null;

    /* ---------- 2. DOM 与存档 ---------- */

    function $(id) {
        return document.getElementById(id);
    }

    function loadSeen() {
        try {
            var v = Store.getJSON("rmGuideState", {});
            if (v && typeof v === "object" && v.seen && typeof v.seen === "object") return v.seen;
        } catch (e) {}
        return {};
    }

    function hasSeen(id) {
        return !!state.seen[id];
    }

    function markSeen(id) {
        if (!id || state.seen[id]) return;
        state.seen[id] = true;
        try {
            Store.setJSON("rmGuideState", { seen: state.seen });
        } catch (e) {}
    }

    /**
     * 创建引导层内部节点：高亮环、小手锚点、气泡（含「下一处」按钮）。
     * @sideeffect 向 #guideLayer 追加节点并缓存引用
     */
    function initDom() {
        layer = $("guideLayer");
        if (!layer) {
            layer = document.createElement("div");
            layer.className = "guide-layer";
            layer.id = "guideLayer";
            document.body.appendChild(layer);
        }
        layer.innerHTML = "";
        ring = document.createElement("div");
        ring.className = "guide-ring";
        ring.style.display = "none";
        layer.appendChild(ring);
        anchor = document.createElement("div");
        anchor.className = "guide-anchor";
        anchor.style.display = "none";
        hand = document.createElement("div");
        hand.className = "guide-hand";
        hand.style.display = "none";
        anchor.appendChild(hand);
        layer.appendChild(anchor);
        bubble = document.createElement("div");
        bubble.className = "guide-bubble";
        bubble.style.display = "none";
        bubbleText = document.createElement("span");
        bubbleText.className = "guide-bubble-text";
        bubble.appendChild(bubbleText);
        bubbleNext = document.createElement("button");
        bubbleNext.type = "button";
        bubbleNext.className = "guide-next";
        bubbleNext.textContent = "下一处 ▶";
        bubbleNext.style.display = "none";
        bubbleNext.addEventListener("click", function(e) {
            if (e && e.stopPropagation) e.stopPropagation();
            var cand = state.cand;
            if (!cand) return;
            if (cand.onNext) {
                cand.onNext();
                return;
            }
            // 单步引导的"知道啦"：直接结束本轮
            if (cand.persist) markSeen(cand.persist);
            if (cand.onDone) {
                try {
                    cand.onDone();
                } catch (e2) {}
            }
            stopGuide();
            state.candKey = null;
        });
        bubble.appendChild(bubbleNext);
        layer.appendChild(bubble);
        state.seen = loadSeen();
        state.lastActivity = Date.now();
    }

    /* ---------- 3. 活动检测与通用工具 ---------- */

    function noteActivity() {
        state.lastActivity = Date.now();
        state.pauseUntil = state.lastActivity + TOUCH_PAUSE_MS;
    }

    function visible(el) {
        if (!el || !el.getClientRects) return false;
        try {
            return el.getClientRects().length > 0;
        } catch (e) {
            return false;
        }
    }

    function modalOpen(id) {
        var el = $(id);
        if (!el || !el.style) return false;
        var d = el.style.display;
        return !!d && d !== "none" && visible(el);
    }

    function shown(id) {
        var el = $(id);
        if (!el) return false;
        if (modalOpen(id)) return true;
        return !!(el.classList && (el.classList.contains("visible") || el.classList.contains("show")));
    }

    function overlayOpen() {
        var ov = $("overlay");
        return !!ov && ov.style.display === "block";
    }

    function confirmOpen() {
        return modalOpen("rmConfirmModal") || (function() {
            var ov = document.querySelector(".rm-confirm-overlay");
            return !!ov && ov.style.display === "block" && visible(ov);
        })();
    }

    function sidebarOpen(id) {
        var el = $(id);
        return !!el && el.classList.contains("open");
    }

    function idleNow() {
        return Date.now() - state.lastActivity >= IDLE_MS;
    }

    function rectOf(el) {
        if (!visible(el)) return null;
        var r = el.getBoundingClientRect();
        if (!r || (!r.width && !r.height)) return null;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }

    /**
     * 目标所在的弹窗 / 提示卡里是否只剩它一个可见按钮。
     * 只有一个按钮时不再套高亮环，避免重复强调唯一可点的目标。
     * @param {HTMLElement} target 引导目标
     * @returns {boolean} 只有一个可见按钮时返回 true
     */
    function singleButtonTarget(target) {
        if (!target || !target.closest) return false;
        var box = target.closest(".auto-modal, .preset-start-card, .game-modal-card");
        if (!box) return false;
        var btns = box.querySelectorAll("button");
        var count = 0, only = null;
        for (var i = 0; i < btns.length; i++) {
            if (!visible(btns[i])) continue;
            count++;
            only = btns[i];
            if (count > 1) return false;
        }
        return count === 1 && (only === target || !!(target.contains && target.contains(only)));
    }

    /* ---------- 4. 候选引导 ---------- */

    function tapStep(opt) {
        return {
            key: opt.key,
            text: opt.text,
            mode: "tap",
            target: opt.target,
            from: null,
            active: !!opt.active,
            nextLabel: opt.nextLabel || "",
            onNext: opt.onNext || null,
            onDone: opt.onDone || null,
            persist: opt.persist || "",
            // hold：在玩家点击目标/按钮前，高亮与气泡一直保留
            hold: !!opt.hold,
            // flashSeries：需要同步闪烁高光的系列键
            flashSeries: opt.flashSeries || null
        };
    }

    /**
     * 教学关卡的落点引导：找本关"下一个还没放对"的目标格，从对应雷槽拖过去。
     * @returns {Object|null} 引导候选
     */
    function teachCandidate() {
        if (typeof teachActive === "undefined" || !teachActive) return null;
        if (typeof TEACH_LEVELS === "undefined") return null;
        var lvl = TEACH_LEVELS[teachLevelIdx];
        if (!lvl) return null;
        var steps = lvl.steps || [];
        var target = null;
        for (var i = 0; i < steps.length; i++) {
            var tc = steps[i].targetCell;
            if (!tc) continue;
            if (!G.placed[tc[0] + "," + tc[1]]) {
                target = tc;
                break;
            }
        }
        if (!target) return null;
        var cell = document.querySelector('.cell[data-r="' + target[0] + '"][data-c="' + target[1] + '"]');
        if (!cell || !visible(cell)) return null;
        var mt = lvl.mineTypes || (lvl.mineType ? (function() {
            var o = {};
            o[lvl.mineType] = 1;
            return o;
        })() : {});
        var from = null;
        for (var t in mt) {
            if ((teachPlacedTypes[t] || 0) >= mt[t]) continue;
            from = document.querySelector('#slot .mine-item[data-mine-type="' + t + '"]');
            if (from && visible(from)) break;
            from = null;
        }
        if (!from) from = document.querySelector("#slot .mine-item:not(.disabled)");
        return {
            key: "teach:" + teachLevelIdx + ":" + target[0] + "," + target[1],
            text: "把地雷放到这里",
            mode: from ? "drag" : "tap",
            target: cell,
            from: from,
            // 前三关是核心玩法接触点：进入步骤就先演一遍
            active: teachLevelIdx < 5
        };
    }

    /**
     * 被锁的困难 / 地狱：先指难度按钮，打开后指系列开关。
     * @returns {Object|null} 引导候选
     */
    function lockedDifficultyCandidate() {
        if (modalOpen("difficultyModal")) {
            var list = $("seriesSwitchList");
            if (!list || !visible(list)) return null;
            return tapStep({
                key: "lockeddiff:switch",
                text: "开启足够的系列开关才能解锁",
                target: list,
                active: true,
                nextLabel: "知道啦 ✅",
                onDone: function() {
                    window._guideLockedDifficulty = null;
                }
            });
        }
        var btn = $("difficultyBtn");
        if (!btn) return null;
        return tapStep({
            key: "lockeddiff:btn",
            text: "打开难度，开启更多系列开关",
            target: btn,
            active: true
        });
    }

    /**
     * 未解锁的系列开关（v1.3.3 两步指引）：
     * 第一步指主按钮「🎯挑战」，玩家点开弹窗后第二步指该系列行右侧的
     * 「挑战」按钮；每次点「前往挑战」都会重新走一遍这两步。
     * @returns {Object|null} 引导候选
     */
    function lockedSeriesCandidate() {
        var cat = window._guideLockedSeries;
        if (!cat) return null;
        if (modalOpen("challengeModal")) {
            var btn = document.querySelector('#challengeList .challenge-item[data-key="' + cat + '"] .challenge-entry-btn');
            if (!btn || !visible(btn)) return null;
            return tapStep({
                key: "lockedseries:hubbtn:" + cat,
                text: "再点这个系列的「挑战」按钮",
                target: btn,
                active: true,
                nextLabel: "知道啦 ✅",
                flashSeries: cat,
                onDone: function() {
                    window._guideLockedSeries = null;
                }
            });
        }
        var hubBtn = $("challengeBtn");
        if (!hubBtn || !visible(hubBtn)) return null;
        return tapStep({
            key: "lockedseries:hub:" + cat,
            text: "先点「🎯挑战」打开挑战弹窗",
            target: hubBtn,
            active: true
        });
    }

    /**
     * 设置侧栏的逐项介绍：每个控件一条，用「下一处」推进。
     * @returns {Array} 引导站点
     */
    function settingTourStops() {
        function q(sel) {
            return function() {
                return document.querySelector(sel);
            };
        }
        return [ {
            target: q("#modeSwitch"),
            text: "① 这里可以切换操作方式"
        }, {
            target: q("#SoundSetting"),
            text: "② 这里可以调节背景音乐和音效"
        }, {
            target: q("#SuggestiveSetting"),
            text: "③ 可开启提示性功能，游戏更简单直观"
        }, {
            target: q("#SaveManage"),
            text: "④ 此处可以管理你的存档"
        }, {
            target: q("#AboutSection"),
            text: "⑤ 关于：版本号与更新公告都在这里"
        } ];
    }

    /**
     * 创造侧栏的逐项介绍。
     * @returns {Array} 引导站点
     */
    function createTourStops() {
        return [ {
            target: function() {
                return document.querySelector("#createSidebar .create-size-row");
            },
            text: "① 棋盘尺寸：先设定创造棋盘的行数与列数"
        }, {
            target: function() {
                return document.querySelector("#createSidebar .create-btn");
            },
            text: "② 点「生成空棋盘」进入创造模式"
        }, {
            target: function() {
                return $("puzzleCodeInput");
            },
            text: "③ 题库码：粘贴分享码可直接载入题目"
        } ];
    }

    /**
     * 逐项介绍的通用候选：当前停在第 idx 站，玩家点「下一处」推进。
     * @param {string} id 介绍 id（用于记录已读）
     * @param {Function} stopsFactory 返回站点数组的函数
     * @returns {Object|null} 引导候选
     */
    function tourCandidate(id, stopsFactory) {
        if (hasSeen(id)) return null;
        if (!state.tour || state.tour.id !== id) {
            state.tour = { id: id, idx: 0, stops: stopsFactory() };
        }
        var tour = state.tour;
        if (tour.idx >= tour.stops.length) return null;
        var stop = tour.stops[tour.idx];
        var target = typeof stop.target === "function" ? stop.target() : stop.target;
        if (!target || !visible(target)) return null;
        var last = tour.idx >= tour.stops.length - 1;
        return {
            key: id + ":" + tour.idx,
            text: stop.text,
            mode: "tap",
            target: target,
            from: null,
            active: true,
            nextLabel: last ? "知道啦 ✅" : "下一处",
            onNext: (function(tourId, stops) {
                return function() {
                    if (!state.tour || state.tour.id !== tourId) return;
                    state.tour.idx++;
                    if (state.tour.idx >= state.tour.stops.length) {
                        markSeen(tourId);
                        state.tour = null;
                    }
                    stopGuide();
                    guideRefresh();
                };
            })(id, tour.stops)
        };
    }

    /**
     * 基础挑战未完成时的引导（每次打开网页都会检查，v1.3.3 改指新入口）：
     * 主按钮「🎯挑战」→ 挑战弹窗里基础挑战行右侧的「基础挑战」按钮。
     * @returns {Object|null} 引导候选
     */
    function basicChallengeCandidate() {
        if (typeof isBasicChallengeDone !== "function" || isBasicChallengeDone()) return null;
        // 刚打开页面先给欢迎弹窗一点时间，避免两者抢屏
        if (Date.now() - state.bootAt < 1200) return null;
        if (modalOpen("challengeModal")) {
            var rowBtn = document.querySelector('#challengeList .challenge-item[data-key="basic"] .challenge-entry-btn');
            if (!rowBtn || !visible(rowBtn)) return null;
            return tapStep({
                key: "basic:hubbtn",
                text: "点这里开始基础挑战",
                target: rowBtn,
                active: true
            });
        }
        var hubBtn = $("challengeBtn");
        if (!hubBtn || !visible(hubBtn)) return null;
        return tapStep({
            key: "basic:hub",
            text: "点「🎯挑战」开始基础挑战",
            target: hubBtn,
            active: true
        });
    }

    /**
     * 基础挑战完成后的难度介绍：先指难度按钮，打开后逐条介绍预设与系列开关。
     * @returns {Object|null} 引导候选
     */
    function difficultyIntroCandidate() {
        if (!modalOpen("difficultyModal")) {
            state.diffStage = 0;
            var btn = $("difficultyBtn");
            if (!btn) return null;
            return tapStep({
                key: "diffintro:btn",
                text: "来看看难度与系列开关",
                target: btn,
                active: true
            });
        }
        var row = document.querySelector("#difficultyModal .preset-row");
        var list = $("seriesSwitchList");
        if (!state.tour || state.tour.id !== "difficulty-intro") {
            state.tour = {
                id: "difficulty-intro",
                idx: 0,
                stops: [ {
                    target: row,
                    text: "① 预设难度：简单/中等无门槛，困难需 ≥3 个系列"
                }, {
                    target: list,
                    text: "② 系列开关：决定一局能用到哪些雷"
                } ]
            };
        }
        var tour = state.tour;
        if (tour.idx >= tour.stops.length) return null;
        var stop = tour.stops[tour.idx];
        var target = typeof stop.target === "function" ? stop.target() : stop.target;
        if (!target || !visible(target)) return null;
        var last = tour.idx >= tour.stops.length - 1;
        return {
            key: "diffintro:" + tour.idx,
            text: stop.text,
            mode: "tap",
            target: target,
            from: null,
            active: true,
            nextLabel: last ? "知道啦 ✅" : "下一处",
            onNext: function() {
                if (!state.tour || state.tour.id !== "difficulty-intro") return;
                state.tour.idx++;
                if (state.tour.idx >= state.tour.stops.length) {
                    markSeen("difficulty-intro");
                    state.tour = null;
                }
                stopGuide();
                guideRefresh();
            }
        };
    }

    /**
     * 从难度弹窗点「成绩请到记录栏查看」跳转后的引导（v1.3.2）：
     * 记录侧栏打开后，用统一的高亮环 + 小手指向「成绩」分区。
     * @returns {Object|null} 引导候选
     */
    function recordScoresCandidate() {
        if (!window._guideRecordScores) return null;
        // 侧栏被玩家收起：本次跳转引导到此结束
        if (!sidebarOpen("achSidebar")) {
            window._guideRecordScores = false;
            return null;
        }
        var rec = $("recSection");
        if (!rec || !visible(rec)) return null;
        return tapStep({
            key: "records:scores",
            text: "各难度的最快用时与通关次数都在这里",
            target: rec,
            active: true,
            nextLabel: "知道啦 ✅",
            onDone: function() {
                window._guideRecordScores = false;
            }
        });
    }

    /**
     * 判断当前应该播放哪条引导；不满足条件时返回 null。
     * @returns {Object|null} 引导候选
     */
    function resolveCandidate() {
        // ① 首次欢迎弹窗：先教玩家点"开始教学"
        var prompt = $("tutorialPrompt");
        if (prompt && prompt.style.display === "block") {
            var startBtn = $("tutorialConfirmBtn");
            if (startBtn && !startBtn.disabled && visible(startBtn)) {
                return tapStep({
                    key: "welcome-start",
                    text: "点这里开始新手教学",
                    target: startBtn,
                    active: true,
                    persist: "welcome-start"
                });
            }
            return null;
        }
        // ② 其他弹窗 / 确认框 / 通关卡打开时不打扰
        if (confirmOpen() || overlayOpen() || shown("teachCompleteModal") || shown("presetStartCard")) return null;
        // ③ 教学流程
        if (typeof teachActive !== "undefined" && teachActive) return teachCandidate();
        if (typeof isTutorialMode !== "undefined" && isTutorialMode) return null;
        var creating = (typeof createModeActive !== "undefined" && createModeActive);
        // ④ 玩家主动触发的门槛引导优先
        if (!creating && window._guideLockedSeries) return lockedSeriesCandidate();
        if (!creating && window._guideLockedDifficulty) return lockedDifficultyCandidate();
        if (creating) return null;
        // ④.1 从难度弹窗点了「成绩请到记录栏查看」：高亮环 + 小手指向成绩区
        if (window._guideRecordScores) return recordScoresCandidate();
        // ④.2 「🎯挑战」弹窗打开且基础挑战未完成：指基础挑战行右侧的入口
        if (modalOpen("challengeModal")) {
            if (!isBasicChallengeDone()) return basicChallengeCandidate();
            return null;
        }
        // ⑤ 侧栏介绍：设置 / 创造逐项讲完
        if (sidebarOpen("settingSidebar")) return tourCandidate("setting-tour", settingTourStops);
        if (sidebarOpen("createSidebar")) return tourCandidate("create-tour", createTourStops);
        var challengeOpen = modalOpen("difficultyModal");
        if (challengeOpen) {
            if (isBasicChallengeDone() && !hasSeen("difficulty-intro")) return difficultyIntroCandidate();
            return null;
        }
        // ⑥ 基础挑战完成后的难度介绍
        if (isBasicChallengeDone() && !hasSeen("difficulty-intro")) return difficultyIntroCandidate();
        // ⑦ 基础挑战未完成：每次打开网页都指到主按钮「🎯挑战」
        return basicChallengeCandidate();
    }

    /* ---------- 5. 视觉呈现与动画 ---------- */

    function placeRing(r) {
        if (!ring || !r) return;
        var pad = 6;
        ring.style.display = "block";
        ring.style.left = (r.left - pad) + "px";
        ring.style.top = (r.top - pad) + "px";
        ring.style.width = (r.w + pad * 2) + "px";
        ring.style.height = (r.h + pad * 2) + "px";
    }

    function placeBubble(r) {
        if (!bubble || !r) return;
        bubble.style.display = "block";
        bubble.classList.remove("below");
        var bw = bubble.offsetWidth || 200;
        var bh = bubble.offsetHeight || 44;
        var vw = window.innerWidth || 375;
        var vh = window.innerHeight || 667;
        var left = r.x - bw / 2;
        left = Math.max(8, Math.min(left, vw - bw - 8));
        var top = r.top - bh - 14;
        if (top < 8) {
            top = r.bottom + 14;
            bubble.classList.add("below");
        }
        top = Math.max(8, Math.min(top, vh - bh - 8));
        bubble.style.left = left + "px";
        bubble.style.top = top + "px";
    }

    /**
     * 按目标元素当前矩形，同步高亮环、气泡与小手锚点。
     * @param {Object} cand 引导候选
     * @returns {boolean} 目标仍可见时返回 true
     */
    function syncGeometry(cand) {
        if (!cand || !cand.target) return false;
        var r = rectOf(cand.target);
        if (!r) return false;
        var key = r.left + "|" + r.top + "|" + r.w + "|" + r.h;
        if (key === state.geomKey) return true;
        state.geomKey = key;
        // 只有一个按钮时只保留气泡与小手，不再加高亮环
        if (singleButtonTarget(cand.target)) {
            if (ring) ring.style.display = "none";
        } else {
            placeRing(r);
        }
        placeBubble(r);
        if (anchor) {
            anchor.style.display = "block";
            anchor.style.left = r.x + "px";
            anchor.style.top = r.y + "px";
            anchor._center = r;
        }
        return true;
    }

    function pickHand(dir, iter) {
        var list = HANDS[dir] || HANDS.tap;
        return list[Math.abs(iter || 0) % list.length];
    }

    function dirOf(dx, dy) {
        if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
        return dy >= 0 ? "down" : "up";
    }

    /**
     * 点按型关键帧：相对小手锚点的小幅靠近 + 连点两下。
     * @returns {Array} WAAPI 关键帧
     */
    function tapKeyframes() {
        return [
            { offset: 0, transform: "translate3d(26px, 30px, 0) scale(.9)" },
            { offset: 0.45, transform: "translate3d(4px, 6px, 0) scale(1.05)" },
            { offset: 0.58, transform: "translate3d(2px, 3px, 0) scale(.86)" },
            { offset: 0.72, transform: "translate3d(4px, 6px, 0) scale(1.04)" },
            { offset: 0.84, transform: "translate3d(2px, 3px, 0) scale(.9)" },
            { offset: 1, transform: "translate3d(24px, 28px, 0) scale(.92)" }
        ];
    }

    /**
     * 拖拽型关键帧：以目标为锚，手从"起点相对目标的偏移"沿弧线滑到目标。
     * @param {Object} from 起点矩形
     * @param {Object} to 终点矩形
     * @returns {Array} WAAPI 关键帧
     */
    function dragKeyframes(from, to) {
        var x0 = from.x - to.x, y0 = from.y - to.y;
        var dx = -x0, dy = -y0;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var mx = x0 / 2, my = y0 / 2;
        var cxp = mx - dy / dist * Math.min(70, dist * .22);
        var cyp = my + dx / dist * Math.min(70, dist * .22);
        var frames = [];
        var steps = 6;
        for (var i = 0; i <= steps; i++) {
            var t = i / steps;
            var mt = 1 - t;
            var x = mt * mt * x0 + 2 * mt * t * cxp + t * t * 0;
            var y = mt * mt * y0 + 2 * mt * t * cyp + t * t * 0;
            var scale = i === steps ? .82 : 1;
            frames.push({ offset: t, transform: "translate3d(" + x + "px," + y + "px,0) scale(" + scale + ")" });
        }
        return frames;
    }

    function clearVisual() {
        if (state.raf) {
            cancelAnimationFrame(state.raf);
            state.raf = 0;
        }
        state.geomKey = "";
        if (state.anim && state.anim.cancel) {
            try {
                state.anim.cancel();
            } catch (e) {}
        }
        state.anim = null;
        if (ring) ring.style.display = "none";
        if (anchor) anchor.style.display = "none";
        if (hand) hand.style.display = "none";
        if (bubble) bubble.style.display = "none";
        if (layer) layer.classList.remove("show");
        clearSeriesFlash();
    }

    function stopGuide() {
        state.playing = false;
        state.cand = null;
        clearVisual();
    }

    /* ---------- 5.1 系列区块同步闪烁（引导致挑战时） ---------- */

    // 当前被点亮的系列区块，用于引导结束时精确移除闪烁类
    var flashedSeries = null;

    /**
     * 让「🎯挑战」弹窗里某个系列行同步闪烁（v1.3.3，与按钮高亮同时出现，不配手势）。
     * @param {string} cat 系列键
     * @sideeffect 给对应 .challenge-item 添加 guide-series-flash 类
     */
    function applySeriesFlash(cat) {
        clearSeriesFlash();
        if (!cat) return;
        var el = document.querySelector('#challengeList .challenge-item[data-key="' + cat + '"]');
        if (!el || !el.classList) return;
        el.classList.add("guide-series-flash");
        flashedSeries = el;
    }

    /**
     * 移除系列行上的闪烁高光。
     * @sideeffect 移除 guide-series-flash 类
     */
    function clearSeriesFlash() {
        if (flashedSeries && flashedSeries.classList) flashedSeries.classList.remove("guide-series-flash");
        flashedSeries = null;
        // 面板重绘后旧引用可能失效，再按类名兜底清理
        var left = document.querySelectorAll("#challengeList .challenge-item.guide-series-flash");
        for (var i = 0; i < left.length; i++) left[i].classList.remove("guide-series-flash");
    }

    /**
     * 每帧跟随目标位置，保证高亮环/气泡/小手始终贴合组件。
     * @param {Object} cand 引导候选
     */
    function startGeometryLoop(cand) {
        if (state.raf) cancelAnimationFrame(state.raf);
        var loop = function() {
            if (!state.playing || state.cand !== cand) return;
            if (!syncGeometry(cand)) {
                stopGuide();
                return;
            }
            state.raf = requestAnimationFrame(loop);
        };
        syncGeometry(cand);
        state.raf = requestAnimationFrame(loop);
    }

    function play(cand) {
        if (!cand || !cand.target) return;
        var to = rectOf(cand.target);
        if (!to) return;
        var from = cand.from ? rectOf(cand.from) : null;
        if (!layer || !hand || !ring || !bubble) return;
        state.playing = true;
        state.cand = cand;
        state.playedAt = Date.now();
        layer.classList.add("show");
        if (cand.flashSeries) applySeriesFlash(cand.flashSeries); else clearSeriesFlash();
        bubbleText.textContent = cand.text || "";
        if (cand.nextLabel) {
            bubbleNext.textContent = cand.nextLabel;
            bubbleNext.style.display = "inline-block";
        } else {
            bubbleNext.style.display = "none";
        }
        startGeometryLoop(cand);
        var frames = (cand.mode === "drag" && from) ? dragKeyframes(from, to) : tapKeyframes();
        var dir = (cand.mode === "drag" && from) ? dirOf(to.x - from.x, to.y - from.y) : "tap";
        hand.textContent = pickHand(dir, state.plays);
        hand.style.display = "block";
        var token = ++state.playToken;
        // 带「下一处」按钮或需要玩家先操作的引导：一直保持到玩家动手，
        // 不按按钮就不让气泡消失
        var hold = !!(cand.nextLabel || cand.hold);
        var anim = null;
        try {
            anim = hand.animate(frames, {
                duration: cand.mode === "drag" ? 1900 : 1400,
                iterations: hold ? Infinity : LOOPS,
                easing: "ease-in-out"
            });
        } catch (e) {
            anim = null;
        }
        var finish = function() {
            if (!state.playing || token !== state.playToken) return;
            state.playing = false;
            state.cand = null;
            clearVisual();
            state.plays++;
            if (cand.persist) markSeen(cand.persist);
            if (cand.onDone) {
                try {
                    cand.onDone();
                } catch (e) {}
            }
        };
        if (anim) {
            state.anim = anim;
            anim.oniteration = function(ev) {
                hand.textContent = pickHand(dir, (ev.iteration || 0) + 1 + state.plays);
            };
            // 保持型引导不设结束回调：等玩家点「下一处」或状态变化
            if (!hold) anim.onfinish = finish;
        } else if (hold) {
            hand.style.transform = frames[0].transform;
        } else {
            hand.style.transform = frames[frames.length - 1].transform;
            setTimeout(finish, 1800);
        }
    }

    /* ---------- 6. 调度 ---------- */

    function tick() {
        if (!layer) return;
        // 页面在后台时不做候选判定（v1.3.2 性能优化）：省掉每 400ms 一轮的
        // DOM 查询，回到前台后下一次 tick 会立即按最新状态恢复引导
        if (document.hidden) return;
        var now = Date.now();
        if (now < state.pauseUntil) return;
        var cand = null;
        try {
            cand = resolveCandidate();
        } catch (e) {
            cand = null;
        }
        if (!cand) {
            state.candKey = null;
            state.plays = 0;
            if (state.playing) stopGuide();
            else if (layer.classList.contains("show")) clearVisual();
            return;
        }
        if (cand.key !== state.candKey) {
            if (state.playing) stopGuide();
            else clearVisual();
            state.candKey = cand.key;
            state.plays = 0;
            state.playedAt = 0;
        }
        if (state.playing) return;
        var canPlay = false;
        if (cand.active) {
            canPlay = state.plays < 2;
        } else {
            var idle = idleNow();
            if (state.plays === 0) {
                canPlay = idle;
            } else if (state.plays < 2) {
                canPlay = idle && now - state.playedAt >= IDLE_MS;
            }
        }
        if (canPlay) play(cand);
    }

    function guideRefresh() {
        state.pauseUntil = 0;
        if (!layer) return;
        // 彻底结束当前一轮，下一次 tick 按最新状态重新选目标
        state.playing = false;
        state.cand = null;
        clearVisual();
        state.candKey = null;
        state.plays = 0;
        setTimeout(tick, 60);
    }

    /* ---------- 7. 事件与启动 ---------- */

    function onClickCapture(e) {
        noteActivity();
    }

    function bindEvents() {
        var activity = [ "pointerdown", "touchstart", "keydown", "wheel" ];
        activity.forEach(function(type) {
            document.addEventListener(type, noteActivity, { passive: true });
        });
        // 滚动时让动画继续跟手：geometry loop 每帧重新取矩形
        document.addEventListener("scroll", noteActivity, { passive: true, capture: true });
        document.addEventListener("dragstart", function() {
            noteActivity();
            state.pauseUntil = Date.now() + 4000;
            stopGuide();
        }, true);
        document.addEventListener("dragend", function() {
            noteActivity();
            guideRefresh();
        }, true);
        document.addEventListener("pointermove", function() {
            var now = Date.now();
            if (now - state.lastMoveNote < 300) return;
            state.lastMoveNote = now;
            noteActivity();
        }, { passive: true });
        document.addEventListener("click", onClickCapture, true);
        window.addEventListener("resize", function() {
            guideRefresh();
        });
    }

    function init() {
        try {
            initDom();
            bindEvents();
            setInterval(tick, TICK_MS);
            tick();
        } catch (e) {
            if (window.RM && RM.onError) RM.onError("guide:init", e);
        }
    }

    window.guideRefresh = guideRefresh;
    window.Guide = {
        refresh: guideRefresh,
        stop: stopGuide
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
