/* ==========================================================================
 * 反向扫雷 · 14-bgeffects.js
 * 职责：背景漂浮地雷特效
 * ========================================================================== */

(function initBgEffects() {
    const container = document.getElementById("bgEffects");
    if (!container) return;
    const mineEmojis = [ "💣", "🚩", "❓", "💥", "🕳️", "☢️", "🌶️", "✖️", "🍺", "🌀", "🛡️", "🐮", "🗿" ];
    function spawnMineGhost() {
        if (!container) return;
        let el = document.createElement("div");
        el.className = "bg-mine-ghost";
        el.textContent = mineEmojis[Math.floor(Math.random() * mineEmojis.length)];
        el.style.left = 8 + Math.random() * 90 + "%";
        el.style.top = 8 + Math.random() * 90 + "%";
        el.style.fontSize = 18 + Math.random() * 40 + "px";
        let duration = 4 + Math.random() * 2.5;
        el.style.animationDuration = duration + "s";
        container.appendChild(el);
        setTimeout(() => {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        }, duration * 1e3);
    }
    for (let i = 0; i < 6; i++) {
        setTimeout(spawnMineGhost, Math.random() * 1500);
    }
    function loopSpawn() {
        spawnMineGhost();
        setTimeout(loopSpawn, 600 + Math.random() * 800);
    }
    setTimeout(loopSpawn, 2e3);
})();
