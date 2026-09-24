/* ==========================================================================
 * 反向扫雷 · 05-generator.js
 * 职责：题目生成、教学题生成、预览图、地雷信息栏、影响值重算、脑王彩蛋
 * ========================================================================== */

function genGame() {
    let enabled = getEnabledMineKeys();
    if (!enabled.includes("normal")) enabled.unshift("normal");
    let specials = enabled.filter(k => k !== "normal");
    specials.sort(() => Math.random() - .5);
    let sel = specials.slice(0, Math.min(TY, specials.length));
    while (sel.length < TY && specials.length > 0) {
        sel.push(specials[Math.floor(Math.random() * specials.length)]);
    }
    let pool = {};
    let normalNeeded = Math.max(1, T - SP);
    pool.normal = normalNeeded;
    let rem = SP;
    sel.forEach(t => {
        pool[t] = (pool[t] || 0) + 1;
        rem--;
    });
    while (rem > 0 && sel.length > 0) {
        let t = sel[Math.floor(Math.random() * sel.length)];
        pool[t]++;
        rem--;
    }
    while (rem > 0) {
        pool.normal++;
        rem--;
    }
    for (let k of Object.keys(M)) {
        if (pool[k] === undefined) pool[k] = 0;
    }
    let mines = [];
    for (let t in pool) for (let i = 0; i < pool[t]; i++) mines.push(t);
    mines = mines.slice(0, T);
    let pos = new Set, ans = {};
    while (mines.length) {
        let r = Math.random() * SR | 0, c = Math.random() * SC | 0, k = r + "," + c;
        if (!pos.has(k)) {
            pos.add(k);
            ans[k] = mines.pop();
        }
    }
    let tar = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let k in ans) {
        let [r, c] = k.split(",");
        M[ans[k]].f(+r, +c, tar);
    }
    applyTacticalEffects(tar, ans);
    G.tar = tar;
    G.pool = pool;
    G.max = T;
    G.placed = {};
    resetP();
}

/* 系列挑战专用：本局必定出现的该系列雷种（每个系列 2 种）。
   genTutorialGame 会写在这里，末关弹窗要展示"解锁了哪几种雷"。 */
let lastChallengeTypes = [];

function shuffleArr(arr) {
    let a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        let tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
    }
    return a;
}

function genTutorialGame(categoryKey) {
    let allowed = [ "normal", "big5", "high", "chiliV", "chiliH", "chiliPlus" ];
    let forced = null;
    if (categoryKey) {
        // 纯系列局：剔除基础特殊雷（大五/高爆/辣椒系），只留 普通雷 + 该系列雷
        let catBombs = Object.keys(M).filter(k => M[k].category === categoryKey);
        allowed = [ "normal" ].concat(catBombs);
        // 从该系列随机挑 2 种，本局必定出现（系列雷种不足 2 种时全上）
        forced = shuffleArr(catBombs).slice(0, Math.min(2, catBombs.length));
    }
    let pool = {};
    pool.normal = Math.max(1, T - SP);
    let specials = allowed.filter(k => k !== "normal");
    let remain = T - pool.normal;
    if (forced && forced.length) {
        // 先让每种至少 1 颗，剩下的再随机分配，保证 2 种都真的出现
        forced.forEach(t => {
            pool[t] = 1;
            remain--;
        });
        while (remain > 0) {
            let t = forced[Math.floor(Math.random() * forced.length)];
            pool[t] = (pool[t] || 0) + 1;
            remain--;
        }
        lastChallengeTypes = forced.slice();
    } else {
        while (remain > 0) {
            let t = specials[Math.floor(Math.random() * specials.length)];
            pool[t] = (pool[t] || 0) + 1;
            remain--;
        }
        lastChallengeTypes = [];
    }
    for (let k of Object.keys(M)) {
        if (pool[k] === undefined) pool[k] = 0;
    }
    let mines = [];
    for (let t in pool) for (let i = 0; i < pool[t]; i++) mines.push(t);
    mines = mines.slice(0, T);
    let pos = new Set, ans = {};
    while (mines.length) {
        let r = Math.random() * SR | 0, c = Math.random() * SC | 0, k = r + "," + c;
        if (!pos.has(k)) {
            pos.add(k);
            ans[k] = mines.pop();
        }
    }
    let tar = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let k in ans) {
        let [r, c] = k.split(",");
        M[ans[k]].f(+r, +c, tar);
    }
    applyTacticalEffects(tar, ans);
    G.tar = tar;
    G.pool = pool;
    G.max = T;
    G.placed = {};
    resetP();
}

function setupTutorialParams() {
    diff = null;
    document.getElementById("size").textContent = S;
    document.getElementById("total").textContent = T;
    document.getElementById("type").textContent = TY;
    document.getElementById("spec").textContent = SP;
}

function genPreHtml(mk) {
    const mine = M[mk];
    if (!mine.preview) return "<div>无预览</div>";
    const {size: size, active: active, center: center, values: values, split: split} = mine.preview;
    const isPlus1 = !values;
    let diagonal = "";
    if (split) diagonal = `<svg class="diagonal-line" viewBox="0 0 ${size} ${size}"><line x1="${size}" y1="0" x2="0" y2="${size}" stroke="#666" stroke-width="0.2"/></svg>`;
    let html = `<div class="preview-grid" style="grid-template-columns: repeat(${size}, 20px);">${diagonal}`;
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
        let cls = "preview-cell";
        let isC = i === center[0] && j === center[1];
        let isA = active.some(([x, y]) => x === i && y === j);
        let val = !isPlus1 && values && values[i] && values[i][j] !== undefined ? values[i][j] : null;
        if (isC) {
            cls += " center";
        } else if (isA) {
            if (val !== null && val < 0) {
                cls += " negative";
            } else if (split) {
                if (i < 3 && j < 3) cls += " split-left"; else if (i >= 3 && j >= 3) cls += " split-right";
            } else {
                cls += " active";
            }
        }
        let cv = val !== null && val !== "" ? val : "";
        html += `<div class="${cls}">${cv}</div>`;
    }
    html += "</div>";
    return html;
}

function renderMineInfo() {
    const list = document.getElementById("mineInfoList");
    let html = "";
    const catOrder = [ "basic", "special", "physics", "symmetry", "tactical" ];
    catOrder.forEach(catKey => {
        let unlocked = seriesUnlocked[catKey];
        let cat = CATEGORY[catKey];
        let bombs = Object.keys(M).filter(k => M[k].category === catKey);
        if (bombs.length === 0) return;
        html += `<div class="category-section" data-cat="${catKey}">`;
        html += `<div class="category-header"><strong>${cat.emoji} ${cat.name}</strong>`;
        if (catKey === "basic") {
            html += `<span style="margin-left:auto;font-size:12px;color:#38a169;">✅始终开启</span>`;
            html += `<button class="tutorial-btn-inline" onclick="openPracticeMode()">基础挑战</button>`;
        } else if (unlocked) {
            html += `<button class="tutorial-btn-inline" onclick="startCategoryTutorial('${catKey}')">练习</button>`;
            html += `<span style="margin-left:8px;font-size:12px;color:#38a169;">🔓已解锁</span>`;
        } else {
            html += `<button class="tutorial-btn-inline" onclick="startCategoryTutorial('${catKey}')" style="border-color:#805ad5;color:#805ad5;background:#f5f0ff;">挑战</button>`;
            html += `<span style="margin-left:8px;font-size:12px;color:#a0aec0;">🔒 挑战完成解锁</span>`;
        }
        html += `</div>`;
        bombs.forEach(key => {
            let m = M[key];
            let wrapStyle = unlocked ? "" : "opacity:0.75;";
            html += `<div class="mine-info-item" style="${wrapStyle}">\n                        <div class="mine-info-header">\n                            <div class="mine-info-emoji ${m.cls}">${m.e}</div>\n                            <div class="mine-info-name">${m.n}</div>\n                            ${unlocked ? "" : '<span style="margin-left:auto;font-size:11px;color:#a0aec0;">🔒</span>'}\n                        </div>\n                        <div class="mine-info-desc">${m.tip}</div>\n                        <div class="mine-info-tip">\n                            ℹ️查看影响范围\n                            <div class="mine-preview">${genPreHtml(key)}</div>\n                        </div>\n                    </div>`;
        });
        html += `</div>`;
    });
    list.innerHTML = html;
}

function resetP() {
    G.p = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let k in G.placed) {
        let [r, c] = k.split(",");
        M[G.placed[k]].f(+r, +c, G.p);
    }
    applyTacticalEffects(G.p, G.placed);
}

function applyBrainEgg() {
    let cleared = false;
    try {
        cleared = Store.get("brainCleared") === "true";
    } catch (e) {}
    if (!cleared) return;
    let titleEl = document.querySelector(".game-title");
    if (!titleEl) return;
    titleEl.textContent = titleEl.textContent.replace(/💣/g, "😎");
    titleEl.title = "大佬的墨镜，实力无需多言";
}
