/* ==========================================================================
 * 模块 14 · 背景氛围特效（js/14-bgeffects.js）
 *
 * 职责：在页面背景层持续生成漂浮的「地雷幽灵」元素，强化扫雷主题氛围。
 * 依赖：DOM 中的 #bgEffects 容器（index.html 静态定义）与 .bg-mine-ghost 样式。
 * 对外：无。本模块以 IIFE 自执行，不向全局暴露任何接口。
 * 设计要点：
 *   1) 特效纯装饰，不参与任何游戏逻辑；容器缺失时直接静默退出。
 *   2) 采用 setTimeout 自调度而非 setInterval，使生成间隔带随机抖动，
 *      避免长时间运行后出现机械的「节拍感」。
 *   3) 每个元素在动画结束后自行移除，DOM 节点数量始终保持有界。
 *   4) v1.3.2 手机端背景减负：窄屏 / 省流模式 / 减少动效偏好下不再生成幽灵，
 *      页面切到后台时暂停生成，回到前台继续，避免空转占用主线程。
 * ========================================================================== */

(function initBgEffects() {
    const container = document.getElementById("bgEffects");
    if (!container) return;
    // 幽灵元素的候选符号：均取自游戏内已有的地雷 / 道具 emoji，保持视觉语言统一
    const mineEmojis = [ "💣", "🚩", "❓", "💥", "🕳️", "☢️", "🌶️", "✖️", "🍺", "🌀", "🛡️", "🐮", "🗿" ];
    /* ---------- 1. 轻量环境判定（v1.3.2） ---------- */
    // 三种情况视为"背景减负"：窄屏手机、用户开启省流、系统要求减少动效。
    // 与样式表第 59 段的移动端规则配套：即使这里不生成，CSS 也会隐藏已有节点。
    let lite = false;
    try {
        lite = (window.matchMedia && window.matchMedia("(max-width: 700px)").matches) ||
            (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
            !!(navigator.connection && navigator.connection.saveData);
    } catch (e) {
        lite = false;
    }
    if (lite) {
        // 标记给样式与排障使用；不生成任何节点，背景层保持静态
        container.setAttribute("data-lite", "1");
        return;
    }
    /* ---------- 2. 幽灵生成 ---------- */
    /**
     * 生成一个漂浮幽灵元素：随机位置、随机尺寸与随机动画时长，到期自动移除。
     * @sideeffect 向 #bgEffects 追加一个节点，并在 duration 秒后将其移除。
     */
    function spawnMineGhost() {
        if (!container) return;
        let el = document.createElement("div");
        el.className = "bg-mine-ghost";
        el.textContent = mineEmojis[Math.floor(Math.random() * mineEmojis.length)];
        el.style.left = 8 + Math.random() * 90 + "%";
        el.style.top = 8 + Math.random() * 90 + "%";
        el.style.fontSize = 18 + Math.random() * 30 + "px";
        let duration = 4 + Math.random() * 2.5;
        el.style.animationDuration = duration + "s";
        container.appendChild(el);
        setTimeout(() => {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        }, duration * 1e3);
    }
    // 启动阶段先补 6 个元素，避免刚进入页面时背景空荡
    for (let i = 0; i < 6; i++) {
        setTimeout(spawnMineGhost, Math.random() * 1500);
    }
    /* ---------- 3. 自调度循环 ---------- */
    /**
     * 自调度循环：每 600~1400ms 生成一个幽灵元素；页面在后台时只重新排期、
     * 不生成节点，回到前台后自然恢复。
     */
    function loopSpawn() {
        if (document.hidden) {
            setTimeout(loopSpawn, 1200);
            return;
        }
        spawnMineGhost();
        setTimeout(loopSpawn, 600 + Math.random() * 800);
    }
    setTimeout(loopSpawn, 2e3);
})();
