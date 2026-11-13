/* ==========================================================================
 * 模块 18 · 启动界面与标题转场（js/18-splash.js）
 *
 * 职责：维护启动界面状态机（body.startup / body.playing / body.transitioning）、
 *       欢迎文案与 😎/💣 标题判定、点击任意处开始、桌面端两种转场动效、
 *       手机端简化淡入淡出，并在转场结束后派发 rm:playstarted。
 * 依赖：01-storage 的 Store（读取 brainCleared / hasVisitedBefore）；
 *       05-generator 的脑王标题彩蛋（这里只同步启动层 emoji 与 .game-title）；
 *       06-render 的 syncBoardVisibility / syncBoardTipsPlacement /
 *       renderTetroOverlay（按存在性调用：启动态棋盘隐藏，转场后需要复算）；
 *       08-ui 的 closeSidebarsExcept / closeAllModals / closeConfirmModal；
 *       index.html 的 #splash / #splashFx / #splashEmoji / #splashWelcome /
 *       #splashCta / #gameTitle 与 body 的 startup / playing / transitioning 类。
 * 对外：window.RMSplash = { start, isStartup, emoji, welcomeText }；
 *       window.RM_FIRST_VISIT（脚本执行阶段写入，供 16-guide 判定首次访问）。
 * 约束：1) 只维护 UI 状态，不读写玩法存档、不改变棋盘生成与对局流程。
 *       2) start() 幂等；转场临时节点全部放在 #splashFx，结束即清理。
 *       3) 转场层 pointer-events:none 且 overflow:hidden，不拦截点击、不产生横向滚动条。
 *       4) 手机端 / prefers-reduced-motion 只做 320ms 淡入淡出，无飞行与粒子。
 *       5) body.startup 保持到转场结束并派发完 rm:playstarted 之后才移除：
 *          16-guide 以 startup 作为"不显示小手"的守卫，提前移除会让引导
 *          在转场中途弹出。
 * ========================================================================== */
(function () {
    "use strict";

    var MOBILE_MQ = "(max-width: 700px)";
    var REDUCE_MQ = "(prefers-reduced-motion: reduce)";
    var CTA_TEXT = "点击任意处开始游玩";
    var CTA_LOADING = "加载中…";
    var WELCOME_FIRST = "这是你第一次游玩『反向💣扫雷』先来试试教学模式吧！";
    var WELCOME_BACK = "欢迎回来！今天也来『反向💣扫雷』吧 o(*^▽^*)┛";
    var EASE_FLY = "cubic-bezier(.3,.7,.25,1)";
    // 游玩态左上角标题的几何常量：与样式表 74.3 段的布局保持一致
    var TITLE_LEFT = 16;
    var TITLE_TOP = 10;
    var TITLE_FONT = 28;
    var TITLE_TRACKING = 1;

    var started = false;      // start() 是否已执行（幂等）
    var finished = false;     // 转场是否已结束
    var dispatched = false;   // rm:playstarted 是否已派发
    var exploded = false;     // 💣 爆炸阶段是否已进入（动画回调兜底用）
    var emoji = "💣";
    var welcomeText = WELCOME_BACK;
    var stepTimers = [];      // 转场步骤定时器，结束前统一取消
    var fxAnims = [];         // 转场中的 WAAPI 动画，结束前统一取消

    /* ---------- 0. 启动参数（脚本执行阶段就绪） ---------- */

    var firstVisit = true;
    try {
        firstVisit = !(window.Store && Store.get("hasVisitedBefore") === "true");
    } catch (e) {
        firstVisit = true;
    }
    // 16-guide / 10-game 的 load 兜底只在这个标记未定义时才写，因此必须在这里定稿
    window.RM_FIRST_VISIT = !!firstVisit;
    welcomeText = firstVisit ? WELCOME_FIRST : WELCOME_BACK;
    try {
        emoji = (window.Store && Store.get("brainCleared") === "true") ? "😎" : "💣";
    } catch (e) {
        emoji = "💣";
    }

    /* ---------- 1. 基础工具 ---------- */

    function $(id) {
        return document.getElementById(id);
    }

    function isStartup() {
        return !!(document.body && document.body.classList.contains("startup"));
    }

    function matchMedia(query) {
        try {
            return !!(window.matchMedia && window.matchMedia(query).matches);
        } catch (e) {
            return false;
        }
    }

    function prefersReduced() {
        return matchMedia(REDUCE_MQ);
    }

    function isMobile() {
        return matchMedia(MOBILE_MQ);
    }

    function anim(el, frames, opts) {
        if (!el || typeof el.animate !== "function") return null;
        var a;
        try {
            a = el.animate(frames, opts);
        } catch (e) {
            return null;
        }
        fxAnims.push(a);
        return a;
    }

    function step(ms, fn) {
        var id = window.setTimeout(fn, ms);
        stepTimers.push(id);
        return id;
    }

    function clearSteps() {
        stepTimers.forEach(function (id) { window.clearTimeout(id); });
        stepTimers = [];
    }

    function rectOf(el) {
        if (!el) return null;
        var r = el.getBoundingClientRect();
        if (!r || (!r.width && !r.height)) return null;
        return r;
    }

    function styleOf(el) {
        if (!el) return null;
        var cs = window.getComputedStyle(el);
        return {
            fontFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            letterSpacing: cs.letterSpacing,
            color: cs.color,
            textShadow: cs.textShadow
        };
    }

    /* ---------- 2. 转场层与临时节点 ---------- */

    /**
     * 显示并返回 #splashFx 转场层；节点缺失时返回 null，调用方降级处理。
     * @returns {HTMLElement|null}
     */
    function fxHost() {
        var host = $("splashFx");
        if (!host) return null;
        host.style.display = "block";
        return host;
    }

    /**
     * 在 #splashFx 内创建一个临时节点。
     * @param {string} className 追加的类名（fx-burst / fx-particle / fx-glasses-hand / fx-part）
     * @param {string} [text] 节点文本
     * @returns {HTMLElement|null}
     */
    function mkFx(className, text) {
        var host = fxHost();
        if (!host) return null;
        var el = document.createElement("div");
        el.className = "fx " + className;
        if (text != null) el.textContent = text;
        host.appendChild(el);
        return el;
    }

    /**
     * 创建标题分片：外框定宽定高，文字在框内居中；飞行只动外框，
     * 途中替换 emoji 文本不会引起页面布局回流。
     * @param {string} text 分片文本
     * @param {DOMRect} rect 原分片的视口矩形
     * @param {Object} style styleOf() 的结果
     * @returns {{box: HTMLElement, inner: HTMLElement}|null}
     */
    function fxPart(text, rect, style) {
        var host = fxHost();
        if (!host || !rect || !style) return null;
        var box = document.createElement("div");
        box.className = "fx fx-part";
        box.style.left = rect.left + "px";
        box.style.top = rect.top + "px";
        box.style.width = rect.width + "px";
        box.style.height = rect.height + "px";
        var inner = document.createElement("span");
        inner.className = "fx-part-inner";
        inner.style.fontFamily = style.fontFamily;
        inner.style.fontSize = style.fontSize;
        inner.style.fontWeight = style.fontWeight;
        inner.style.letterSpacing = style.letterSpacing;
        inner.style.color = style.color;
        inner.style.textShadow = style.textShadow;
        inner.textContent = text;
        box.appendChild(inner);
        host.appendChild(box);
        return { box: box, inner: inner };
    }

    /** 清理转场层：取消 WAAPI 动画、移除全部临时节点并收起 fx 层 */
    function clearFx() {
        fxAnims.forEach(function (a) {
            try { a.cancel(); } catch (e) {}
        });
        fxAnims = [];
        var host = $("splashFx");
        if (!host) return;
        while (host.firstChild) host.removeChild(host.firstChild);
        host.style.display = "none";
    }

    /** 淡出真实节点（标题文字 / 欢迎文案 / 开始提示） */
    function fadeNode(el, duration) {
        if (!el) return null;
        return anim(el, [{ opacity: 1 }, { opacity: 0 }], {
            duration: duration,
            easing: "ease-out",
            fill: "both"
        });
    }

    /* ---------- 3. 文案 / 标题同步 ---------- */

    /**
     * 脑王彩蛋：启动层用 😎 时，把游玩态左上角标题的 💣 一并换成 😎；
     * 反向同步用于清存档后重新加载，保证两处标题始终一致。
     * @sideeffect 修改 .game-title 的文本与 title 属性
     */
    function syncTitleEmoji() {
        var title = $("gameTitle") || document.querySelector(".game-title");
        if (!title) return;
        var text = title.textContent || "";
        if (emoji === "😎" && text.indexOf("💣") >= 0) {
            title.textContent = text.replace(/💣/g, "😎");
            title.title = "大佬的墨镜，实力无需多言";
        } else if (emoji !== "😎" && text.indexOf("😎") >= 0) {
            title.textContent = text.replace(/😎/g, "💣");
            title.removeAttribute("title");
        }
    }

    /**
     * 量出游玩态左上角标题三段（反向 / emoji / 扫雷）的最终中心与尺寸。
     * 用一个隐藏的探针节点模拟 74.3 段的固定定位与字号，量完立即移除；
     * Range 不可用时按字号估算兜底，保证转场仍能收尾。
     * @returns {{left: Object, emoji: Object, right: Object}}
     */
    function measureTitle() {
        var probe = document.createElement("div");
        probe.style.cssText = [
            "position:fixed",
            "left:max(" + TITLE_LEFT + "px, env(safe-area-inset-left, 0px))",
            "top:max(" + TITLE_TOP + "px, env(safe-area-inset-top, 0px))",
            "z-index:-1",
            "margin:0",
            "padding:0",
            "font-family:inherit",
            "font-size:" + TITLE_FONT + "px",
            "font-weight:900",
            "letter-spacing:" + TITLE_TRACKING + "px",
            "line-height:1.2",
            "white-space:nowrap",
            "visibility:hidden",
            "pointer-events:none"
        ].join(";");
        probe.textContent = "反向" + emoji + "扫雷";
        document.body.appendChild(probe);
        var node = probe.firstChild;
        var keys = ["left", "emoji", "right"];
        var texts = ["反向", emoji, "扫雷"];
        var result = {};
        var cursor = 0;
        for (var i = 0; i < keys.length; i++) {
            var part = texts[i];
            var idx = node && node.data ? node.data.indexOf(part, cursor) : -1;
            if (idx < 0) { result = null; break; }
            var r = null;
            try {
                var range = document.createRange();
                range.setStart(node, idx);
                range.setEnd(node, idx + part.length);
                r = range.getBoundingClientRect();
            } catch (e) {
                r = null;
            }
            if (!r || !r.height) { result = null; break; }
            result[keys[i]] = {
                cx: r.left + r.width / 2,
                cy: r.top + r.height / 2,
                w: r.width,
                h: r.height
            };
            cursor = idx + part.length;
        }
        document.body.removeChild(probe);
        if (!result) {
            var base = TITLE_LEFT;
            var midY = TITLE_TOP + TITLE_FONT * .6;
            result = {
                left: { cx: base + 22, cy: midY, w: 44, h: TITLE_FONT },
                emoji: { cx: base + 55, cy: midY, w: TITLE_FONT, h: TITLE_FONT },
                right: { cx: base + 88, cy: midY, w: 44, h: TITLE_FONT }
            };
        }
        return result;
    }

    /**
     * 生成"飞行 - 到位"关键帧：起点保持原位，后半程略微上抛，落点按比例缩小。
     * @returns {Array} WAAPI 关键帧
     */
    function flyFrames(dx, dy, scale) {
        var midScale = 1 + (scale - 1) * .55;
        return [
            { transform: "translate(0px, 0px) scale(1) rotate(0deg)", offset: 0 },
            { transform: "translate(" + (dx * .55).toFixed(1) + "px," +
                (dy * .55 - 14).toFixed(1) + "px) scale(" + midScale.toFixed(3) + ") rotate(-6deg)", offset: .55 },
            { transform: "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px) scale(" +
                scale.toFixed(3) + ") rotate(0deg)", offset: 1 }
        ];
    }

    /* ---------- 4. 转场开始 / 结束 ---------- */

    /**
     * 收起转场前已经展开的侧栏与弹窗：这一下点击不用于开始，避免层级冲突。
     * 关闭函数来自 08-ui / 07-board，按存在性调用，缺失时静默跳过。
     */
    function closeOpenUI() {
        try { if (typeof closeSidebarsExcept === "function") closeSidebarsExcept(null); } catch (e) {}
        try { if (typeof closeAllModals === "function") closeAllModals(); } catch (e) {}
        try { if (typeof closeConfirmModal === "function") closeConfirmModal(); } catch (e) {}
        try { if (typeof hideMineTip === "function") hideMineTip(); } catch (e) {}
    }

    /**
     * 判断是否有侧栏展开 / 弹窗显示：有的话这次点击先留给关闭或操作 UI。
     * @returns {boolean}
     */
    function uiOpen() {
        if (document.querySelector(
            ".info-sidebar.open, .achievement-sidebar.open, .create-sidebar.open, .setting-sidebar.open"
        )) return true;
        var list = document.querySelectorAll(
            ".game-modal, .auto-modal, .rm-confirm-overlay, .rm-confirm-modal, " +
            ".teach-complete-modal, .brain-win-modal"
        );
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            if (!el) continue;
            var cs = window.getComputedStyle(el);
            if (cs.display !== "none" && cs.visibility !== "hidden") return true;
        }
        return false;
    }

    function dispatchPlaystarted() {
        if (dispatched) return;
        dispatched = true;
        try {
            document.dispatchEvent(new CustomEvent("rm:playstarted"));
        } catch (e) {
            try {
                var ev = document.createEvent("CustomEvent");
                ev.initCustomEvent("rm:playstarted", true, false, null);
                document.dispatchEvent(ev);
            } catch (err) {}
        }
    }

    /** 启动层隐藏后复算一次依赖视口 / 棋盘可见性的布局 */
    function refreshPlayLayout() {
        try { if (typeof syncBoardVisibility === "function") syncBoardVisibility(); } catch (e) {}
        try { if (typeof syncBoardTipsPlacement === "function") syncBoardTipsPlacement(); } catch (e) {}
        try { if (typeof renderTetroOverlay === "function") renderTetroOverlay(); } catch (e) {}
    }

    /**
     * 结束转场：移除 transitioning、淡出启动层，然后派发 rm:playstarted，
     * 最后才移除 startup（body 变成纯 playing），让游玩 UI 正式可交互。
     * @param {number} splashFade 启动层淡出时长（0 表示立即隐藏）
     * @sideeffect body 类、#splash 显隐、rm:playstarted 事件
     */
    function finish(splashFade) {
        if (finished) return;
        finished = true;
        clearSteps();
        var body = document.body;
        var splash = $("splash");
        var fade = Math.max(0, splashFade || 0);
        body.classList.remove("transitioning");
        if (splash && fade > 0) {
            splash.style.transition = "opacity " + fade + "ms ease";
            splash.style.opacity = "0";
        }
        window.setTimeout(function () {
            clearFx();
            if (splash) {
                splash.style.display = "none";
                splash.style.opacity = "0";
            }
            // 顺序：转场结束 → 派发事件 → 移除 startup（16-guide 以 startup 为守卫）
            dispatchPlaystarted();
            body.classList.remove("startup");
            body.classList.add("play-in");
            refreshPlayLayout();
            window.setTimeout(refreshPlayLayout, 360);
        }, fade + 20);
    }

    /* ---------- 5. 三种转场 ---------- */

    /** 手机端 / reduced-motion：启动层淡出 320ms，游玩 UI 淡入 320ms，无飞行与粒子 */
    function simpleTransition() {
        var splash = $("splash");
        if (splash) {
            splash.style.transition = "opacity .32s ease";
            splash.style.opacity = "0";
        }
        step(320, function () {
            finish(0);
        });
    }

    /** 💣 版：标题文字淡出 → 💣 飞向左上角 → 💥 爆闪 + 灰色烟雾粒子扩散 */
    function bombTransition() {
        var splash = $("splash");
        var srcEl = $("splashEmoji");
        var wordL = $("splashWordLeft");
        var wordR = $("splashWordRight");
        var welcome = $("splashWelcome");
        var cta = $("splashCta");
        var srcRect = rectOf(srcEl);
        var target = measureTitle().emoji;
        if (!splash || !fxHost() || !srcRect) {
            step(120, function () { finish(240); });
            return;
        }

        // 1) 文字 / 文案先退场，标题里的 emoji 交给飞行克隆
        fadeNode(wordL, 220);
        fadeNode(wordR, 220);
        fadeNode(welcome, 180);
        fadeNode(cta, 160);
        var emojiStyle = styleOf(srcEl);
        srcEl.style.visibility = "hidden";
        var part = fxPart(emoji, srcRect, emojiStyle);

        // 2) 从大标题位置飞向游玩态左上角标题的中心
        var fromCx = srcRect.left + srcRect.width / 2;
        var fromCy = srcRect.top + srcRect.height / 2;
        var scale = Math.max(.14, Math.min(1, target.h / srcRect.height));
        var flight = part ? anim(part.box, flyFrames(target.cx - fromCx, target.cy - fromCy, scale), {
            duration: 660,
            delay: 180,
            easing: EASE_FLY,
            fill: "both"
        }) : null;
        if (flight) {
            flight.onfinish = function () { bombExplode(part, target); };
        }
        // 动画事件丢失时的兜底，保证转场一定能收尾
        step(180 + 660 + 140, function () { bombExplode(part, target); });
    }

    /**
     * 💣 到位：移除飞行克隆，原位爆闪并抛出一圈烟雾粒子。
     * @param {{box: HTMLElement}} part 飞行中的分片
     * @param {Object} target 目标中心与尺寸
     */
    function bombExplode(part, target) {
        if (finished || exploded) return;
        exploded = true;
        if (part && part.box && part.box.parentNode) part.box.parentNode.removeChild(part.box);
        var burst = mkFx("fx-burst", "💥");
        if (burst) {
            burst.style.left = (target.cx - 70) + "px";
            burst.style.top = (target.cy - 70) + "px";
            burst.style.width = "140px";
            burst.style.height = "140px";
        }
        spawnSmoke(target.cx, target.cy);
        // 烟雾扩散约 900ms：之后再收尾，总时长约 1.9s
        step(940, function () { finish(240); });
    }

    /** 生成 12~16 个灰色烟雾粒子：向外扩散 + 上飘 + 淡出，900ms 内消散 */
    function spawnSmoke(cx, cy) {
        var total = 12 + Math.floor(Math.random() * 5);
        for (var i = 0; i < total; i++) {
            var p = mkFx("fx-particle", "");
            if (!p) continue;
            var ang = (-Math.PI / 2) + (Math.random() - .5) * Math.PI * 1.5;
            var dist = 70 + Math.random() * 120;
            var dx = Math.cos(ang) * dist;
            var dy = Math.sin(ang) * dist - 26;
            p.style.left = (cx - 13 + (Math.random() * 26 - 13)).toFixed(1) + "px";
            p.style.top = (cy - 13 + (Math.random() * 26 - 13)).toFixed(1) + "px";
            p.style.setProperty("--fx-dx", dx.toFixed(1) + "px");
            p.style.setProperty("--fx-dy", dy.toFixed(1) + "px");
            p.style.setProperty("--fx-delay", (i * 16) + "ms");
            p.style.setProperty("--fx-scale", (1.2 + Math.random() * 1.1).toFixed(2));
        }
    }

    /** 😎 版：整行飞向左上角、文字先走，😎 跟丢变 😵‍💫 后由「🕶️🤏」贴脸戴上 */
    function brainTransition() {
        var splash = $("splash");
        var wl = $("splashWordLeft");
        var em = $("splashEmoji");
        var wr = $("splashWordRight");
        var welcome = $("splashWelcome");
        var cta = $("splashCta");
        var rectL = rectOf(wl);
        var rectE = rectOf(em);
        var rectR = rectOf(wr);
        var target = measureTitle();
        if (!splash || !fxHost() || !rectL || !rectE || !rectR) {
            step(150, function () { finish(240); });
            return;
        }

        fadeNode(welcome, 180);
        fadeNode(cta, 160);

        var styleL = styleOf(wl);
        var styleE = styleOf(em);
        var styleR = styleOf(wr);

        // 原启动标题隐藏，交给飞行克隆：途中换 emoji 不会引起布局回流
        [wl, em, wr].forEach(function (el) {
            if (el) el.style.visibility = "hidden";
        });
        var cL = fxPart("反向", rectL, styleL);
        var cE = fxPart(emoji, rectE, styleE);
        var cR = fxPart("扫雷", rectR, styleR);
        if (!cL || !cE || !cR) {
            step(150, function () { finish(240); });
            return;
        }

        // 文字先行：整行文字先飞向左上角
        flyPart(cL, rectL, target.left, 640, 0);
        flyPart(cR, rectR, target.right, 640, 0);
        // 😎 延迟跟随、时长更长，看起来"跟不上"文字
        flyPart(cE, rectE, target.emoji, 760, 120);

        // 途中被晃晕：😎 → 😵‍💫
        step(520, function () {
            if (cE.inner) cE.inner.textContent = "😵‍💫";
        });
        // 😵‍💫 到位（~880ms）后再贴脸：900ms 生成「🕶️🤏」，
        // 1200ms 换回 😎 并淡出该节点，此时两者都是静止状态，对齐误差最小
        step(900, function () { showGlassesHand(cE); });
        // 收尾：启动层淡出后结束转场（总时长约 2.2s）
        step(1960, function () { finish(240); });
    }

    /**
     * 分片飞行：外框从原中心飞向目标中心，并缩放到目标高度比例。
     * @param {{box: HTMLElement}} part 分片
     * @param {DOMRect} rect 原视口矩形
     * @param {Object} to 目标中心与尺寸
     */
    function flyPart(part, rect, to, duration, delay) {
        if (!part || !part.box) return null;
        var fromCx = rect.left + rect.width / 2;
        var fromCy = rect.top + rect.height / 2;
        var scale = Math.max(.12, Math.min(1, to.h / rect.height));
        return anim(part.box, flyFrames(to.cx - fromCx, to.cy - fromCy, scale), {
            duration: duration,
            delay: delay || 0,
            easing: EASE_FLY,
            fill: "both"
        });
    }

    /**
     * 「🕶️🤏」组合节点：在 😵‍💫 到位静止后以它的视口矩形为基准，
     * 让 🕶️ 字形中心与 😵‍💫 中心重合（字形高度取当前 rect 高度），
     * 180~220ms 淡入并从右下方轻微滑入到原位；
     * 300ms 后把飞行 emoji 换回 😎，节点 180ms 淡出、220ms 后从 DOM 移除。
     * @param {{box: HTMLElement, inner: HTMLElement}} part 已到位的 😵‍💫 分片
     */
    function showGlassesHand(part) {
        if (finished || !part || !part.box) return;
        var from = rectOf(part.box);
        if (!from) return;
        // 字号 = 当前 😵‍💫 的 rect 高度，保证 🕶️ 字形大小贴合脸部
        var size = Math.max(30, from.height);
        var fromCx = from.left + from.width / 2;
        var fromCy = from.top + from.height / 2;
        var node = mkFx("fx-glasses-hand");
        if (!node) return;
        node.style.fontSize = size + "px";
        node.style.width = (size * 1.9).toFixed(1) + "px";
        node.style.height = (size * 1.12).toFixed(1) + "px";
        // 容器左上角后移半个字形：🕶️ 盒子中心正好落在 😵‍💫 中心
        node.style.left = (fromCx - size / 2).toFixed(1) + "px";
        node.style.top = (fromCy - size / 2).toFixed(1) + "px";
        // 缩放轴心放在 🕶️ 字形中心（1em 盒子的正中），滑入缩放不产生偏移
        node.style.transformOrigin = (size / 2).toFixed(1) + "px " + (size / 2).toFixed(1) + "px";
        var glass = document.createElement("span");
        glass.className = "fx-gh-glass";
        glass.textContent = "🕶️";
        var hand = document.createElement("span");
        hand.className = "fx-gh-hand";
        hand.textContent = "🤏";
        node.appendChild(glass);
        node.appendChild(hand);

        // 😵‍💫 已静止：只做轻微滑入 + 淡入，不再跟随飞行，保证字形中心贴合
        anim(node, [
            { transform: "translate(10px, 6px) scale(.94)", opacity: 0, offset: 0 },
            { transform: "translate(0px, 0px) scale(1)", opacity: 1, offset: 1 }
        ], { duration: 200, easing: "cubic-bezier(.22,.8,.3,1)", fill: "both" });

        // 300ms（约 1200ms）：😵‍💫 → 😎，同时淡出该节点；淡出结束后移出 DOM
        step(300, function () {
            if (finished) return;
            if (part.inner) part.inner.textContent = "😎";
            anim(node, [{ opacity: 1 }, { opacity: 0 }], {
                duration: 180,
                easing: "ease-out",
                fill: "both"
            });
            step(220, function () {
                if (node.parentNode) node.parentNode.removeChild(node);
            });
        });
    }

    /* ---------- 6. 开始交互 ---------- */

    /* 启动提示与首局就绪联动：页面 / 首局棋盘尚未就绪时显示「加载中…」，
       就绪后自动切换为「点击任意处开始游玩」；点击只在就绪后才会开始。 */
    var readyTimer = null;
    var readyWatchStart = 0;
    var readyForced = false;

    /**
     * 判断页面是否已经可以开始游玩：DOM 完成加载且首局棋盘已生成。
     * @returns {boolean}
     */
    function pageReady() {
        try {
            if (document.readyState !== "complete") return false;
            return !!document.querySelector("#board .cell");
        } catch (e) {
            return true;
        }
    }

    /** 启动提示切到「加载中…」 */
    function setCtaLoading() {
        var cta = $("splashCta");
        if (!cta) return;
        cta.textContent = CTA_LOADING;
        cta.classList.add("is-loading");
    }

    /** 启动提示切到「点击任意处开始游玩」 */
    function setCtaReady() {
        var cta = $("splashCta");
        if (!cta) return;
        cta.textContent = CTA_TEXT;
        cta.classList.remove("is-loading");
    }

    /**
     * 按当前就绪状态同步启动提示；返回是否已就绪。
     * @returns {boolean}
     */
    function syncStartCta() {
        if (started || finished) return true;
        if (pageReady()) {
            setCtaReady();
            return true;
        }
        setCtaLoading();
        return false;
    }

    /** 未就绪时每 120ms 轮询，就绪后把提示切回「点击任意处」；8s 兜底强制可点 */
    function watchStartReady() {
        readyTimer = setTimeout(function () {
            if (started || finished) return;
            if (pageReady()) {
                readyTimer = null;
                setCtaReady();
                return;
            }
            if (Date.now() - readyWatchStart > 8000) {
                readyTimer = null;
                readyForced = true;
                setCtaReady();
                return;
            }
            watchStartReady();
        }, 120);
    }

    /** 点击 / 键盘触发开始：页面未就绪时点击无效（提示仍是加载中） */
    function requestStart() {
        if (started || finished) return;
        if (!pageReady() && !readyForced) return;
        start();
    }

    /**
     * 开始游玩：幂等。加 playing + transitioning，收起已打开的侧栏 / 弹窗，
     * 再按设备与动效偏好选择转场方式。
     * @param {{instant: boolean}} [opts] instant=true 时不做任何动画
     * @sideeffect body 类切换、启动层转场、派发 rm:playstarted
     */
    function start(opts) {
        opts = opts || {};
        var body = document.body;
        if (!body || started || finished) return;
        if (!body.classList.contains("startup")) return;
        started = true;
        if (readyTimer) {
            clearTimeout(readyTimer);
            readyTimer = null;
        }
        closeOpenUI();
        body.classList.add("playing", "transitioning");
        if (opts.instant) {
            finish(0);
            return;
        }
        if (isMobile() || prefersReduced()) {
            simpleTransition();
            return;
        }
        if (emoji === "😎") brainTransition(); else bombTransition();
    }

    function onDocClick(e) {
        if (started || finished || !isStartup()) return;
        var t = e.target;
        if (!t || !t.closest) return;
        // 交互控件内部交给控件自己处理：按钮 / 侧栏 / 弹窗 / 播放器 / 引导层 / 覆盖层
        if (t.closest(
            "button, a, input, textarea, select, [contenteditable='true'], " +
            ".info-sidebar, .achievement-sidebar, .create-sidebar, .setting-sidebar, " +
            ".game-modal, .auto-modal, #overlay, .guide-layer, .bili-stage, .bili-player, " +
            ".rm-confirm-overlay, .rm-confirm-modal"
        )) return;
        // 侧栏展开或弹窗显示中：这一下留给关闭 / 操作 UI，不触发开始
        if (uiOpen()) return;
        requestStart();
    }

    function onKeyDown(e) {
        if (started || finished || !isStartup()) return;
        if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar" && e.code !== "Space") return;
        var t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
            t.tagName === "SELECT" || t.isContentEditable)) return;
        if (uiOpen()) return;
        if (e.key === " " || e.code === "Space") {
            try { e.preventDefault(); } catch (err) {}
        }
        requestStart();
    }

    /* ---------- 7. 初始化与对外接口 ---------- */

    function init() {
        if (!document.body) return;
        var splash = $("splash");
        if (splash) {
            splash.style.display = "";
            splash.style.opacity = "";
        }
        var emojiEl = $("splashEmoji");
        if (emojiEl) emojiEl.textContent = emoji;
        var welcomeEl = $("splashWelcome");
        if (welcomeEl) welcomeEl.textContent = welcomeText;
        // 启动提示按首局就绪状态初始化：未就绪先显示「加载中…」，就绪后切回点击文案
        readyWatchStart = Date.now();
        if (!syncStartCta()) watchStartReady();
        syncTitleEmoji();
        document.addEventListener("click", onDocClick, true);
        document.addEventListener("keydown", onKeyDown, true);
    }

    window.RMSplash = {
        start: start,
        isStartup: isStartup,
        emoji: emoji,
        welcomeText: function () { return welcomeText; },
        isReady: pageReady
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
