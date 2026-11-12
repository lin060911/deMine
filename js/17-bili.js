/* ==========================================================================
 * 模块 17 · B 站外链音乐播放器（js/17-bili.js）
 *
 * 职责：把「bilibili2.html」的外链播放器移植进游戏——设置栏开关、右上角悬浮
 *       入口、悬停展开的播放面板（播放器画面 + 当前曲目 + 歌单），并在开启期间
 *       接管游戏背景音乐。
 * 依赖：Store（01-storage）持久化开关 / 上次曲目；
 *       window.BgmDuck（12-settings）把背景音乐总线压到 0 或在关闭后恢复；
 *       RM.toast / AudioFX（00-core / 02-audio）做操作反馈；
 *       index.html 中预先写好的静态 DOM（#biliStage / #biliPanel 等）。
 * 对外：window.toggleBiliPlayer（设置栏开关的 onclick 入口）；
 *       window.BiliPlayer（open / close / toggle / play / stop / isEnabled /
 *       isPlaying），供排障与后续扩展调用。
 * 设计要点：
 *   1) 开关即「播放器模式」：开启 = 背景音乐闪避（实际音量 0，滑块与存档不变）
 *      + 显示右上角 🎵 悬浮钮；关闭 = 恢复背景音乐 + 停掉 iframe + 收起面板。
 *   2) 展开 / 收起完全沿用 bilibili2.html：桌面悬停或键盘聚焦即展开（内容延时
 *      0.3s 淡入），移出后延迟 0.14s 收起；触屏改为点按悬浮钮切换固定展开。
 *   3) 跨域限制：player.bilibili.com 不提供可用的 JS 接口，无法读取 iframe 内
 *      真实的播放 / 暂停状态，因此 BGM 的归零与恢复只由本开关控制，不尝试监听
 *      iframe 内部事件（监听会静默失效，反而更难解释）。
 *   4) iframe 懒加载：首次展开面板时才写入 src，避免每次进入游戏都请求外链资源；
 *      收起面板不停止播放，方便边玩边听（关闭开关才真正停止）。
 *   5) 歌单固定为 bilibili2.html 的 14 首内置曲目，不提供自定义 BV 输入；
 *      曲目信息全部内置，不请求任何 B 站接口。
 * ========================================================================== */

(function() {
    "use strict";

    /* ---------- 1. 曲目数据与存储键 ---------- */

    // 固定歌单：字段与 bilibili2.html 一致，duration 为秒数，仅用于歌单右侧时长显示。
    const TRACKS = [
        { bvid: "BV1D2hi6vEhN", label: "周杰伦", title: "【Hi-Res】4小时39分钟听完周杰伦🎵合集", duration: 16785 },
        { bvid: "BV1AH8RzQEHs", label: "林俊杰", title: "【林俊杰合集】一小时纯享版，每一首都是经典", duration: 3552 },
        { bvid: "BV1Zf4qzQEkh", label: "许嵩", title: "45分钟许嵩音乐合集（纯享版）", duration: 2834 },
        { bvid: "BV1tkWnzmEVs", label: "张杰", title: "45分钟张杰音乐合集（纯享版）", duration: 2622 },
        { bvid: "BV1qaHGzvEzF", label: "陈奕迅", title: "45分钟陈奕迅音乐合集（听完下课）", duration: 2665 },
        { bvid: "BV1bXH5zfEnf", label: "孙燕姿", title: "45分钟孙燕姿音乐合集（听完下课）", duration: 2752 },
        { bvid: "BV1zusnzPE5K", label: "方大同", title: "45分钟方大同音乐合集（纯享版）", duration: 2569 },
        { bvid: "BV165CYBPEPE", label: "邓紫棋", title: "45分钟邓紫棋音乐合集（听完下课）", duration: 2619 },
        { bvid: "BV1A1SfBhEaa", label: "陶喆", title: "45分钟陶喆音乐合集（听完下课）", duration: 2695 },
        { bvid: "BV1aAeizdEu5", label: "俄语", title: "【爆火俄语歌】“战歌像情歌，情歌像战歌的神奇国度。”", duration: 1816 },
        { bvid: "BV1sASLBgE7L", label: "巴西funk", title: "⚡️精选巴西funk一个小时，冷门热门都有！⚡️", duration: 3377 },
        { bvid: "BV1gRBZBLERh", label: "西语", title: "原来这些熟悉的歌竟然都是西语歌曲？", duration: 1756 },
        { bvid: "BV1hgui6yEvx", label: "音乐盒CSGO", title: "45分钟CSGO音乐盒音乐合集（纯享版）", duration: 2805 },
        { bvid: "BV1Gvx96uECE", label: "考公必备", title: "45分钟进步小曲合集（考公必听2.0）", duration: 2563 }
    ];

    // 全部写入签名存档容器：以 rm 开头的键由 01-storage 原样放进附加 JSON，
    // 从而参与导出 / 导入 / 合并，不需要新增结构化字段。
    const STORE_ON = "rmBiliOn";
    const STORE_TRACK = "rmBiliTrack";

    // 当前设备是否支持"真正的悬停"：决定展开后收起时是否要立刻恢复 aria / inert
    const CAN_HOVER = !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);

    /* ---------- 2. DOM 引用 ---------- */

    const stage = document.getElementById("biliStage");
    const launcher = document.getElementById("biliLauncher");
    const panel = document.getElementById("biliPanel");
    const frame = document.getElementById("biliFrame");
    const frameBox = document.getElementById("biliFrameBox");
    const screen = document.getElementById("biliScreen");
    const screenHint = document.getElementById("biliScreenHint");
    const listEl = document.getElementById("biliPlaylist");
    const nowLabel = document.getElementById("biliNowLabel");
    const switchEl = document.getElementById("biliToggle");

    /* ---------- 3. 运行时状态 ---------- */

    // 开关状态：true 表示"播放器模式"（BGM 闪避 + 显示悬浮钮）
    let enabled = false;
    // 是否已被点击固定展开（触屏 / 键盘用；桌面悬停展开不置位）
    let isOpen = false;
    // iframe 是否已经写入过 src（懒加载标记）
    let loaded = false;
    // 当前曲目下标；-1 表示尚未选曲
    let currentIndex = -1;
    // 上次播放的 bvid：写入存档，下次进游戏恢复歌单高亮
    let lastBvid = "";
    // 展开动画结束后复算一次画面尺寸（过渡期间 clientWidth 不稳定）
    let layoutTimer = 0;

    /* ---------- 4. 存储读写与小工具 ---------- */

    /**
     * 读取开关偏好：存档缺失或不可用时按"关闭"处理。
     * @returns {boolean} true 表示上次退出时播放器处于开启状态
     */
    function readEnabled() {
        try {
            return Store.get(STORE_ON) === "true";
        } catch (e) {
            return false;
        }
    }

    /**
     * 固定歌单视图（保持与 bilibili2.html 相同的 14 首顺序）。
     * @returns {Array} 曲目数组
     */
    function getAllTracks() {
        return TRACKS;
    }

    /**
     * 把秒数格式化成"x 小时 yy 分"或"x 分钟"，与 bilibili2.html 的显示一致。
     * @param {number} sec 时长（秒）
     * @returns {string} 本地化时长文本
     */
    function fmtSpan(sec) {
        sec = Math.max(0, Math.floor(Number(sec) || 0));
        const h = Math.floor(sec / 3600);
        const m = Math.round((sec % 3600) / 60);
        return h > 0 ? h + " 小时 " + String(m).padStart(2, "0") + " 分" : m + " 分钟";
    }

    /**
     * 拼接外链播放器地址；参数与 bilibili2.html 完全一致。
     * @param {string} bvid BV 号
     * @param {boolean} autoplay 是否自动播放
     * @returns {string} player.bilibili.com 地址
     */
    function srcFor(bvid, autoplay) {
        return "https://player.bilibili.com/player.html"
            + "?bvid=" + encodeURIComponent(bvid)
            + "&page=1"
            + "&autoplay=" + (autoplay ? 1 : 0)
            + "&danmaku=0"
            + "&high_quality=1";
    }

    /* ---------- 5. 画面尺寸自适应 ---------- */

    /**
     * B 站播放器在 380px 宽时会隐藏音量键：画面小于 480×270 时让内层保持
     * 480×270 再整体等比缩放并居中（同时受宽、高两维约束，矮面板不裁切），
     * 宽度与高度都足够时直接铺满。
     * @sideeffect 改写 frameBox 的 width / height / transform / left / top
     */
    function layoutScreen() {
        if (!screen || !frameBox) return;
        const w = screen.clientWidth;
        const h = screen.clientHeight;
        if (!w || !h) return;
        const scale = Math.min(w / 480, h / 270);
        if (scale >= 1) {
            frameBox.style.width = w + "px";
            frameBox.style.height = h + "px";
            frameBox.style.transform = "none";
            frameBox.style.left = "0";
            frameBox.style.top = "0";
        } else {
            frameBox.style.width = "480px";
            frameBox.style.height = "270px";
            frameBox.style.transform = "scale(" + scale + ")";
            // 缩放原点在左上角：按剩余空间的一半平移，保持画面居中
            frameBox.style.left = Math.max(0, (w - 480 * scale) / 2) + "px";
            frameBox.style.top = Math.max(0, (h - 270 * scale) / 2) + "px";
        }
    }

    /* ---------- 6. 播放控制 ---------- */

    /**
     * 切换 iframe 地址开始播放某个曲目。
     * @param {number} index 歌单下标（支持负数循环）
     * @param {boolean} autoplay 是否自动播放（用户点歌传 true）
     * @sideeffect 改写 iframe src、当前曲目文本、播放标记与存档里的上次曲目
     */
    function play(index, autoplay) {
        const all = getAllTracks();
        if (!all.length) return;
        currentIndex = ((index % all.length) + all.length) % all.length;
        const t = all[currentIndex];
        loaded = true;
        // 新地址开始加载：先把「加载中 / 需要联网」占位放回来，load 成功后再收起
        if (screenHint) screenHint.style.display = "";
        frame.src = srcFor(t.bvid, autoplay !== false);
        lastBvid = t.bvid;
        try {
            Store.set(STORE_TRACK, lastBvid);
        } catch (e) {}
        if (nowLabel) {
            nowLabel.textContent = t.label;
            nowLabel.title = t.title || t.label;
        }
        if (stage) stage.classList.toggle("is-playing", autoplay !== false);
        updateActive();
    }

    /**
     * 恢复上次曲目但不自动播放：用于首次展开面板时让 iframe 显示封面 / 播放键。
     * @sideeffect 写入 iframe src 并更新当前曲目文本
     */
    function ensureFrameLoaded() {
        if (loaded) return;
        loaded = true;
        const all = getAllTracks();
        let idx = all.findIndex(function(t) {
            return t.bvid === lastBvid;
        });
        if (idx < 0) idx = 0;
        if (!all[idx]) return;
        const t = all[idx];
        currentIndex = idx;
        if (screenHint) screenHint.style.display = "";
        frame.src = srcFor(t.bvid, false);
        if (nowLabel) {
            nowLabel.textContent = t.label;
            nowLabel.title = t.title || t.label;
        }
        updateActive();
    }

    /**
     * 真正停止播放：清空 iframe 地址并复位播放标记。
     * 只在关闭播放器开关时调用；收起面板不会停音乐。
     * @sideeffect 改写 iframe src、当前曲目文本与播放标记
     */
    function stopPlayback() {
        try {
            frame.src = "about:blank";
        } catch (e) {}
        loaded = false;
        currentIndex = -1;
        if (stage) stage.classList.remove("is-playing");
        if (nowLabel) {
            nowLabel.textContent = "—";
            nowLabel.title = "";
        }
        updateActive();
    }

    /* ---------- 7. 歌单渲染 ---------- */

    /**
     * 重建歌单：14 首固定曲目，序号 / 名称 / 时长，播放中用均衡器替换序号。
     * 用 DOM API 逐个创建而不是 innerHTML，避免标题文本被当作 HTML 解析。
     * @sideeffect 覆盖 #biliPlaylist 的子树
     */
    function renderList() {
        if (!listEl) return;
        listEl.innerHTML = "";
        const all = getAllTracks();
        all.forEach(function(t, i) {
            const li = document.createElement("li");
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "bili-item";
            btn.dataset.index = String(i);
            btn.title = t.title || t.label;

            const ix = document.createElement("span");
            ix.className = "bili-ix";
            const num = document.createElement("span");
            num.className = "bili-num";
            num.textContent = String(i + 1).padStart(2, "0");
            const eq = document.createElement("span");
            eq.className = "bili-eq";
            eq.setAttribute("aria-hidden", "true");
            eq.innerHTML = "<i></i><i></i><i></i>";
            ix.append(num, eq);

            const name = document.createElement("span");
            name.className = "bili-item-name";
            name.textContent = t.label;

            const meta = document.createElement("span");
            meta.className = "bili-item-meta";
            meta.textContent = fmtSpan(t.duration);

            btn.append(ix, name, meta);
            li.appendChild(btn);
            listEl.appendChild(li);
        });
        updateActive();
    }

    /**
     * 同步歌单选中态：只有当前曲目带 is-active，播放中时由 CSS 把序号换成
     * 跳动的均衡器条。
     * @sideeffect 改写 .bili-item 的 is-active / aria-current 属性
     */
    function updateActive() {
        if (!listEl) return;
        const items = listEl.querySelectorAll(".bili-item");
        Array.prototype.forEach.call(items, function(btn) {
            const on = Number(btn.dataset.index) === currentIndex;
            btn.classList.toggle("is-active", on);
            if (on) btn.setAttribute("aria-current", "true");
            else btn.removeAttribute("aria-current");
        });
    }

    /* ---------- 8. 悬停展开 / 收起与开关 ---------- */

    /**
     * 展开态的无障碍与懒加载同步：悬停、聚焦、点按固定三条路径共用。
     * @sideeffect 解除 inert、更新 aria、懒加载 iframe、安排画面尺寸复算
     */
    function expandVisual() {
        if (!enabled) return;
        if (panel) {
            panel.removeAttribute("inert");
            panel.setAttribute("aria-hidden", "false");
        }
        if (launcher) launcher.setAttribute("aria-expanded", "true");
        ensureFrameLoaded();
        requestAnimationFrame(layoutScreen);
        clearTimeout(layoutTimer);
        // 展开动画（0.9s）结束后复算一次，避免过渡途中量到中间尺寸
        layoutTimer = setTimeout(layoutScreen, 950);
    }

    /**
     * 收起态的无障碍同步；已点击固定（is-open）时不收起。
     * @sideeffect 恢复 aria-hidden 与 inert
     */
    function collapseVisual() {
        if (isOpen) return;
        // 键盘焦点仍在浮层内时保持展开，等 focusout / mouseleave 再次触发收敛
        if (stage && stage.contains(document.activeElement)) return;
        if (panel) {
            panel.setAttribute("aria-hidden", "true");
            panel.setAttribute("inert", "");
        }
        if (launcher) launcher.setAttribute("aria-expanded", "false");
    }

    /**
     * 点按 / 点击固定展开：触屏由悬浮钮切换，桌面也可把面板钉住不随鼠标移出收起。
     * @sideeffect 切换 #biliStage 的 is-open 与无障碍状态
     */
    function openPanel() {
        if (!enabled || !stage) return;
        isOpen = true;
        stage.classList.add("is-open");
        expandVisual();
    }

    /**
     * 取消固定：移除 is-open；若鼠标仍悬停在浮层上则保持展开（与 bilibili2 一致）。
     * @sideeffect 移除 is-open，必要时同步收起态的无障碍属性
     */
    function closePanel() {
        isOpen = false;
        if (stage) stage.classList.remove("is-open");
        const hovered = CAN_HOVER && stage && stage.matches(":hover");
        if (!hovered) collapseVisual();
    }

    /**
     * 悬浮钮：点按切换固定展开（触屏唯一入口；桌面主要用于点住面板）。
     * @sideeffect 切换面板展开状态并播放提示音
     */
    function togglePanel() {
        if (!enabled) return;
        if (isOpen) closePanel(); else openPanel();
        try {
            AudioFX.pop();
        } catch (e) {}
    }

    /**
     * 应用开关对应的界面状态：悬浮钮显隐、开关高亮、BGM 闪避 / 恢复。
     * 只改界面与音频，不写存档（存档写入由 setEnabled 负责）。
     * @param {boolean} on 是否开启播放器模式
     * @sideeffect 切换 #biliStage 的 is-enabled、#biliToggle 的 on 类，并调用 BgmDuck
     */
    function applyEnabledUI(on) {
        enabled = !!on;
        if (stage) stage.classList.toggle("is-enabled", enabled);
        if (switchEl) switchEl.classList.toggle("on", enabled);
        if (enabled) {
            if (window.BgmDuck && window.BgmDuck.duck) window.BgmDuck.duck();
        } else if (window.BgmDuck && window.BgmDuck.unduck) {
            window.BgmDuck.unduck();
        }
    }

    /**
     * 设置栏开关入口：开启则静音 BGM 并显示悬浮钮，关闭则恢复 BGM 并停止播放。
     * @sideeffect 写 rmBiliOn、改写界面、可能停止播放并恢复背景音乐
     */
    function setEnabled(on) {
        const next = !!on;
        if (next === enabled) return;
        applyEnabledUI(next);
        if (!next) {
            closePanel();
            stopPlayback();
        }
        try {
            Store.set(STORE_ON, next ? "true" : "false");
        } catch (e) {}
        try {
            AudioFX.toggle(next);
        } catch (e) {}
        RM.toast(next ? "外链播放器已开启：背景音乐已静音" : "外链播放器已关闭：背景音乐已恢复");
    }

    /**
     * 设置栏开关的 onclick 入口。
     */
    function toggleBiliPlayer() {
        setEnabled(!enabled);
    }

    /* ---------- 9. 事件绑定与布局监听 ---------- */

    if (launcher) launcher.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        togglePanel();
    });
    if (listEl) listEl.addEventListener("click", function(e) {
        const btn = e.target && e.target.closest ? e.target.closest(".bili-item") : null;
        if (!btn || !listEl.contains(btn)) return;
        const idx = parseInt(btn.dataset.index, 10);
        if (!isNaN(idx)) play(idx, true);
    });
    // 桌面悬停 / 键盘聚焦展开：与 bilibili2.html 的 .stage:hover / :focus-within 对齐
    if (stage) {
        stage.addEventListener("mouseenter", function() {
            if (!enabled) return;
            expandVisual();
        });
        stage.addEventListener("mouseleave", function() {
            collapseVisual();
        });
        stage.addEventListener("focusin", function() {
            if (!enabled) return;
            expandVisual();
        });
        stage.addEventListener("focusout", function() {
            // 焦点仍在浮层内（例如点到歌单按钮）时不收起
            if (stage.contains(document.activeElement)) return;
            collapseVisual();
        });
    }
    // 外链画面真正加载出来后收起"加载中"占位；about:blank（关闭开关时停播）
    // 不算加载成功，保留占位文案，避免离线场景被误判为已加载
    if (frame) frame.addEventListener("load", function() {
        const src = frame.getAttribute("src") || "";
        if (src.indexOf("player.bilibili.com") >= 0 && screenHint) screenHint.style.display = "none";
    });
    // 点击面板以外的区域取消固定（展开的悬停态由鼠标移出自然收起）
    document.addEventListener("click", function(e) {
        if (!isOpen) return;
        if (stage && stage.contains(e.target)) return;
        closePanel();
    });
    // Esc 与其它弹窗保持一致的关闭习惯
    document.addEventListener("keydown", function(e) {
        if (e.key === "Escape" && isOpen) closePanel();
    });
    window.addEventListener("resize", function() {
        if (stage && (stage.matches(":hover") || stage.classList.contains("is-open"))) layoutScreen();
    });
    if (window.ResizeObserver && screen) {
        try {
            new ResizeObserver(layoutScreen).observe(screen);
        } catch (e) {}
    }

    /* ---------- 10. 初始化 ---------- */

    /**
     * 启动：恢复开关 / 上次曲目，渲染歌单并按开关状态接管 BGM。
     * 不自动展开面板、不自动播放，避免进游戏就被外链声音打断。
     * @sideeffect 读存档、渲染歌单、可能闪避背景音乐
     */
    function init() {
        if (!stage) return;
        lastBvid = "";
        try {
            lastBvid = Store.get(STORE_TRACK) || "";
        } catch (e) {
            lastBvid = "";
        }
        renderList();
        const on = readEnabled();
        applyEnabledUI(on);
        if (on) {
            // 已在初始化阶段置位闪避，12-settings 的滑块初始化会读到该状态
            const all = getAllTracks();
            const idx = all.findIndex(function(t) {
                return t.bvid === lastBvid;
            });
            if (idx >= 0) {
                currentIndex = idx;
                const t = all[idx];
                if (nowLabel) {
                    nowLabel.textContent = t.label;
                    nowLabel.title = t.title || t.label;
                }
                updateActive();
            }
        }
    }

    init();

    /* ---------- 11. 对外接口 ---------- */

    window.toggleBiliPlayer = toggleBiliPlayer;

    // 只读 / 调试入口：便于排障脚本与后续扩展，不替代设置栏开关
    window.BiliPlayer = {
        open: openPanel,
        close: closePanel,
        toggle: togglePanel,
        play: function(index) {
            play(index, true);
        },
        stop: stopPlayback,
        isEnabled: function() {
            return enabled;
        },
        isPlaying: function() {
            return !!(stage && stage.classList.contains("is-playing"));
        }
    };
})();
