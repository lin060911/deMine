/* ==========================================================================
 * 反向扫雷 · 04-mines.js
 * 职责：地雷图鉴（22 种）与各雷种的影响函数、战术类连锁结算
 * ========================================================================== */

const CATEGORY = {
    basic: {
        name: "基础系列",
        order: 0,
        emoji: "💣"
    },
    special: {
        name: "异形系列",
        order: 1,
        emoji: "✖️"
    },
    physics: {
        name: "物理律系列",
        order: 2,
        emoji: "☢️"
    },
    symmetry: {
        name: "对称系列",
        order: 3,
        emoji: "‼️"
    },
    tactical: {
        name: "战术系列",
        order: 4,
        emoji: "🔫"
    }
};

const M = {
    normal: {
        category: "basic",
        n: "普通雷",
        e: "💣",
        cls: "normal-bomb",
        tip: "3x3范围 +1",
        f: (r, c, v) => addVal(r, c, 1, 1, v, 1),
        preview: {
            size: 3,
            active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ] ],
            center: [ 1, 1 ]
        }
    },
    big5: {
        category: "basic",
        n: "巨型雷",
        e: "💣",
        cls: "big-bomb",
        tip: "5x5范围 +1",
        f: (r, c, v) => addVal(r, c, 2, 2, v, 1),
        preview: {
            size: 5,
            active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 0, 3 ], [ 0, 4 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 1, 3 ], [ 1, 4 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ], [ 2, 3 ], [ 2, 4 ], [ 3, 0 ], [ 3, 1 ], [ 3, 2 ], [ 3, 3 ], [ 3, 4 ], [ 4, 0 ], [ 4, 1 ], [ 4, 2 ], [ 4, 3 ], [ 4, 4 ] ],
            center: [ 2, 2 ]
        }
    },
    high: {
        category: "basic",
        n: "高爆雷",
        e: "💣",
        cls: "high-bomb",
        tip: "3x3范围 +2",
        f: (r, c, v) => addVal(r, c, 1, 1, v, 2),
        preview: {
            size: 3,
            active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ] ],
            center: [ 1, 1 ],
            values: [ [ 2, 2, 2 ], [ 2, 2, 2 ], [ 2, 2, 2 ] ]
        }
    },
    chiliV: {
        category: "basic",
        n: "竖辣椒",
        e: "🌶️",
        cls: "chiliV-bomb",
        tip: "竖方向各2格 +1",
        f: (r, c, v) => {
            for (let i = -2; i <= 2; i++) {
                let y = r + i;
                if (y >= 0 && y < SR) v[y][c]++;
            }
        },
        preview: {
            size: 5,
            active: [ [ 0, 2 ], [ 1, 2 ], [ 2, 2 ], [ 3, 2 ], [ 4, 2 ] ],
            center: [ 2, 2 ]
        }
    },
    chiliH: {
        category: "basic",
        n: "横辣椒",
        e: "🌶️",
        cls: "chiliH-bomb",
        tip: "横方向各2格 +1",
        f: (r, c, v) => {
            for (let i = -2; i <= 2; i++) {
                let x = c + i;
                if (x >= 0 && x < SC) v[r][x]++;
            }
        },
        preview: {
            size: 5,
            active: [ [ 2, 0 ], [ 2, 1 ], [ 2, 2 ], [ 2, 3 ], [ 2, 4 ] ],
            center: [ 2, 2 ]
        }
    },
    chiliPlus: {
        category: "basic",
        n: "十字辣椒",
        e: "➕",
        cls: "chiliPlus-bomb",
        tip: "横竖各2格 +1",
        f: (r, c, v) => {
            const d = [ [ -2, 0 ], [ -1, 0 ], [ 0, -1 ], [ 0, -2 ], [ 0, 1 ], [ 0, 2 ], [ 0, 0 ], [ 2, 0 ], [ 1, 0 ] ];
            d.forEach(([dr, dc]) => {
                let y = r + dr, x = c + dc;
                if (y >= 0 && y < SR && x >= 0 && x < SC) v[y][x]++;
            });
        },
        preview: {
            size: 5,
            active: [ [ 0, 2 ], [ 1, 2 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ], [ 2, 3 ], [ 2, 4 ], [ 3, 2 ], [ 4, 2 ] ],
            center: [ 2, 2 ]
        }
    },
    chiliDiag: {
        category: "special",
        n: "对角辣椒",
        e: "✖️",
        cls: "chiliDiag-bomb",
        tip: "3x3对角线 +1",
        f: (r, c, v) => {
            const d = [ [ -1, -1 ], [ -1, 1 ], [ 0, 0 ], [ 1, -1 ], [ 1, 1 ] ];
            d.forEach(([dr, dc]) => {
                let y = r + dr, x = c + dc;
                if (y >= 0 && y < SR && x >= 0 && x < SC) v[y][x]++;
            });
        },
        preview: {
            size: 3,
            active: [ [ 0, 0 ], [ 0, 2 ], [ 1, 1 ], [ 2, 0 ], [ 2, 2 ] ],
            center: [ 1, 1 ]
        }
    },
    chiliBigDiag: {
        category: "special",
        n: "大对角辣椒",
        e: "✖️",
        cls: "chiliBigDiag-bomb",
        tip: "5x5对角线 +1",
        f: (r, c, v) => {
            const d = [ [ -2, -2 ], [ -2, 2 ], [ -1, -1 ], [ 1, 1 ], [ -1, 1 ], [ 1, -1 ], [ 0, 0 ], [ 2, -2 ], [ 2, 2 ] ];
            d.forEach(([dr, dc]) => {
                let y = r + dr, x = c + dc;
                if (y >= 0 && y < SR && x >= 0 && x < SC) v[y][x]++;
            });
        },
        preview: {
            size: 5,
            active: [ [ 0, 0 ], [ 0, 4 ], [ 1, 1 ], [ 1, 3 ], [ 2, 2 ], [ 3, 1 ], [ 3, 3 ], [ 4, 0 ], [ 4, 4 ] ],
            center: [ 2, 2 ]
        }
    },
    ring: {
        category: "special",
        n: "环形雷",
        e: "🔘",
        cls: "ring-bomb",
        tip: "5x5区域外圈 +1",
        f: (r, c, v) => {
            for (let nr = -2; nr <= 2; nr++) {
                for (let nc = -2; nc <= 2; nc++) {
                    if (nr === -2 || nr === 2 || nc === -2 || nc === 2) {
                        let y = r + nr;
                        let x = c + nc;
                        if (y >= 0 && y < SR && x >= 0 && x < SC) v[y][x]++;
                    }
                }
            }
        },
        preview: {
            size: 5,
            active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 0, 3 ], [ 0, 4 ], [ 1, 0 ], [ 1, 4 ], [ 2, 0 ], [ 2, 4 ], [ 3, 0 ], [ 3, 4 ], [ 4, 0 ], [ 4, 1 ], [ 4, 2 ], [ 4, 3 ], [ 4, 4 ] ],
            center: [ 2, 2 ]
        }
    },
    eight: {
        category: "special",
        n: "八向雷",
        e: "✳️",
        cls: "eight-bomb",
        tip: "8方向各2格+自身 +1",
        f: (r, c, v) => {
            const dirs = [ [ -1, -1 ], [ -1, 0 ], [ -1, 1 ], [ 0, -1 ], [ 0, 1 ], [ 1, -1 ], [ 1, 0 ], [ 1, 1 ] ];
            v[r][c]++;
            dirs.forEach(([dy, dx]) => {
                for (let i = 1; i <= 2; i++) {
                    let y = r + dy * i, x = c + dx * i;
                    if (y >= 0 && y < SR && x >= 0 && x < SC) v[y][x]++;
                }
            });
        },
        preview: {
            size: 5,
            active: [ [ 2, 2 ], [ 1, 2 ], [ 0, 2 ], [ 3, 2 ], [ 4, 2 ], [ 2, 1 ], [ 2, 0 ], [ 2, 3 ], [ 2, 4 ], [ 1, 1 ], [ 0, 0 ], [ 1, 3 ], [ 0, 4 ], [ 3, 1 ], [ 4, 0 ], [ 3, 3 ], [ 4, 4 ] ],
            center: [ 2, 2 ]
        }
    },
    anti: {
        category: "physics",
        n: "反物质炸弹",
        e: "💥",
        cls: "anti-bomb",
        tip: "3x3范围 -1",
        f: (r, c, v) => addVal(r, c, 1, 1, v, -1),
        preview: {
            size: 3,
            active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ] ],
            center: [ 1, 1 ],
            values: [ [ -1, -1, -1 ], [ -1, -1, -1 ], [ -1, -1, -1 ] ]
        }
    },
    radiation: {
        category: "physics",
        n: "辐射雷",
        e: "☢️",
        cls: "radiation-bomb",
        tip: "中心+3 内环+2 外环+1",
        f: (r, c, v) => {
            v[r][c] += 3;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                let y = r + dr, x = c + dc;
                if (y >= 0 && y < SR && x >= 0 && x < SC) v[y][x] += 2;
            }
            for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
                if (Math.abs(dr) === 2 || Math.abs(dc) === 2) {
                    let y = r + dr, x = c + dc;
                    if (y >= 0 && y < SR && x >= 0 && x < SC) v[y][x] += 1;
                }
            }
        },
        preview: {
            size: 5,
            active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 0, 3 ], [ 0, 4 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 1, 3 ], [ 1, 4 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ], [ 2, 3 ], [ 2, 4 ], [ 3, 0 ], [ 3, 1 ], [ 3, 2 ], [ 3, 3 ], [ 3, 4 ], [ 4, 0 ], [ 4, 1 ], [ 4, 2 ], [ 4, 3 ], [ 4, 4 ] ],
            center: [ 2, 2 ],
            values: [ [ 1, 1, 1, 1, 1 ], [ 1, 2, 2, 2, 1 ], [ 1, 2, 3, 2, 1 ], [ 1, 2, 2, 2, 1 ], [ 1, 1, 1, 1, 1 ] ]
        }
    },
    blackhole: {
        category: "physics",
        n: "黑洞炸弹",
        e: "🕳️",
        cls: "blackhole-bomb",
        tip: "中心-1 十字不变 外圈8格+1",
        f: (r, c, v) => {
            v[r][c] -= 1;
            [ [ -1, -1 ], [ -1, 1 ], [ 1, -1 ], [ 1, 1 ], [ -2, 0 ], [ 2, 0 ], [ 0, -2 ], [ 0, 2 ] ].forEach(([dr, dc]) => {
                let y = r + dr, x = c + dc;
                if (y >= 0 && y < SR && x >= 0 && x < SC) v[y][x] += 1;
            });
        },
        preview: {
            size: 5,
            active: [ [ 0, 2 ], [ 1, 1 ], [ 1, 3 ], [ 2, 0 ], [ 2, 2 ], [ 2, 4 ], [ 3, 1 ], [ 3, 3 ], [ 4, 2 ] ],
            center: [ 2, 2 ],
            values: [ [ 0, 0, 1, 0, 0 ], [ 0, 1, 0, 1, 0 ], [ 1, 0, -1, 0, 1 ], [ 0, 1, 0, 1, 0 ], [ 0, 0, 1, 0, 0 ] ]
        }
    },
    bigBlackhole: {
        category: "physics",
        n: "大黑洞炸弹",
        e: "🕳️",
        cls: "big-blackhole-bomb",
        tip: "中心-2 内环-1 外环+1",
        f: (r, c, v) => {
            v[r][c] -= 2;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                let y = r + dr, x = c + dc;
                if (y >= 0 && y < SR && x >= 0 && x < SC) v[y][x] -= 1;
            }
            for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
                if (Math.abs(dr) === 2 || Math.abs(dc) === 2) {
                    let y = r + dr, x = c + dc;
                    if (y >= 0 && y < SR && x >= 0 && x < SC) v[y][x] += 1;
                }
            }
        },
        preview: {
            size: 5,
            active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 0, 3 ], [ 0, 4 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 1, 3 ], [ 1, 4 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ], [ 2, 3 ], [ 2, 4 ], [ 3, 0 ], [ 3, 1 ], [ 3, 2 ], [ 3, 3 ], [ 3, 4 ], [ 4, 0 ], [ 4, 1 ], [ 4, 2 ], [ 4, 3 ], [ 4, 4 ] ],
            center: [ 2, 2 ],
            values: [ [ 1, 1, 1, 1, 1 ], [ 1, -1, -1, -1, 1 ], [ 1, -1, -2, -1, 1 ], [ 1, -1, -1, -1, 1 ], [ 1, 1, 1, 1, 1 ] ]
        }
    },
    mirror: {
        category: "symmetry",
        n: "镜像双雷",
        e: "🥂",
        cls: "mirror-bomb",
        tip: "自身+中心对称点 3x3 +1",
        f: (r, c, v) => {
            addVal(r, c, 1, 1, v, 1);
            addVal(SR - 1 - r, SC - 1 - c, 1, 1, v, 1);
        },
        preview: {
            size: 6,
            active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ], [ 3, 3 ], [ 3, 4 ], [ 3, 5 ], [ 4, 3 ], [ 4, 4 ], [ 4, 5 ], [ 5, 3 ], [ 5, 4 ], [ 5, 5 ] ],
            center: [ 1, 1 ],
            split: true
        }
    },
    yinYang: {
        category: "symmetry",
        n: "阴阳炸弹",
        e: "☯️",
        cls: "yin-yang-bomb",
        tip: "自身3x3+1 中心对称点3x3-1",
        f: (r, c, v) => {
            addVal(r, c, 1, 1, v, 1);
            addVal(SR - 1 - r, SC - 1 - c, 1, 1, v, -1);
        },
        preview: {
            size: 6,
            active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ], [ 3, 3 ], [ 3, 4 ], [ 3, 5 ], [ 4, 3 ], [ 4, 4 ], [ 4, 5 ], [ 5, 3 ], [ 5, 4 ], [ 5, 5 ] ],
            center: [ 1, 1 ],
            values: [ [ 1, 1, 1, 0, 0, 0 ], [ 1, 1, 1, 0, 0, 0 ], [ 1, 1, 1, 0, 0, 0 ], [ 0, 0, 0, -1, -1, -1 ], [ 0, 0, 0, -1, -1, -1 ], [ 0, 0, 0, -1, -1, -1 ] ],
            split: true
        }
    },
    negativeMirror: {
        category: "symmetry",
        n: "负镜像双雷",
        e: "‼️",
        cls: "negative-mirror-bomb",
        tip: "自身+中心对称点 3x3 -1",
        f: (r, c, v) => {
            addVal(r, c, 1, 1, v, -1);
            addVal(SR - 1 - r, SC - 1 - c, 1, 1, v, -1);
        },
        preview: {
            size: 6,
            active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ], [ 3, 3 ], [ 3, 4 ], [ 3, 5 ], [ 4, 3 ], [ 4, 4 ], [ 4, 5 ], [ 5, 3 ], [ 5, 4 ], [ 5, 5 ] ],
            center: [ 1, 1 ],
            values: [ [ -1, -1, -1, 0, 0, 0 ], [ -1, -1, -1, 0, 0, 0 ], [ -1, -1, -1, 0, 0, 0 ], [ 0, 0, 0, -1, -1, -1 ], [ 0, 0, 0, -1, -1, -1 ], [ 0, 0, 0, -1, -1, -1 ] ],
            split: true
        }
    },
    triSym: {
        category: "symmetry",
        n: "对称·叁雷",
        e: "3️⃣",
        cls: "tri-sym-bomb",
        tip: "自身3x3+1 水平对称点3x3+1 垂直对称点3x3+1",
        f: (r, c, v) => {
            addVal(r, c, 1, 1, v, 1);
            addVal(r, SC - 1 - c, 1, 1, v, 1);
            addVal(SR - 1 - r, c, 1, 1, v, 1);
        },
        preview: {
            size: 6,
            active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ], [ 0, 3 ], [ 0, 4 ], [ 0, 5 ], [ 1, 3 ], [ 1, 4 ], [ 1, 5 ], [ 2, 3 ], [ 2, 4 ], [ 2, 5 ], [ 3, 0 ], [ 3, 1 ], [ 3, 2 ], [ 4, 0 ], [ 4, 1 ], [ 4, 2 ], [ 5, 0 ], [ 5, 1 ], [ 5, 2 ] ],
            center: [ 1, 1 ],
            values: [ [ 1, 1, 1, 1, 1, 1 ], [ 1, 1, 1, 1, 1, 1 ], [ 1, 1, 1, 1, 1, 1 ], [ 1, 1, 1, 0, 0, 0 ], [ 1, 1, 1, 0, 0, 0 ], [ 1, 1, 1, 0, 0, 0 ] ]
        }
    },
    amplifier: {
        category: "tactical",
        n: "伤害放大器",
        e: "🔍",
        cls: "amplifier-bomb",
        tip: "本格+1；3x3内每有其他地雷→该地雷3x3额外+1",
        f: (r, c, v) => {
            v[r][c]++;
        },
        preview: {
            size: 3,
            active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ] ],
            center: [ 1, 1 ]
        }
    },
    locator: {
        category: "tactical",
        n: "坐标定位器",
        e: "🌐",
        cls: "locator-bomb",
        tip: "本格无效果；所在行/列的首尾各+1",
        f: (r, c, v) => {
            if (c !== 0) v[r][0]++;
            if (c !== SC - 1) v[r][SC - 1]++;
            if (r !== 0) v[0][c]++;
            if (r !== SR - 1) v[SR - 1][c]++;
        },
        preview: {
            size: 5,
            active: [ [ 0, 2 ], [ 2, 0 ], [ 2, 4 ], [ 4, 2 ] ],
            center: [ 2, 2 ]
        }
    },
    shield: {
        category: "tactical",
        n: "屏障生成器",
        e: "🛡️",
        cls: "shield-bomb",
        tip: "3x3范围内所有地块固定为0",
        f: (r, c, v) => {},
        preview: {
            size: 3,
            active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ] ],
            center: [ 1, 1 ],
            values: [ [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ] ]
        }
    },
    siphon: {
        category: "tactical",
        n: "能量虹吸器",
        e: "🌀",
        cls: "siphon-bomb",
        tip: "本格+1；5x5内每有1个其他地雷额外+1",
        f: (r, c, v) => {
            v[r][c]++;
        },
        preview: {
            size: 5,
            active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 0, 3 ], [ 0, 4 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 1, 3 ], [ 1, 4 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ], [ 2, 3 ], [ 2, 4 ], [ 3, 0 ], [ 3, 1 ], [ 3, 2 ], [ 3, 3 ], [ 3, 4 ], [ 4, 0 ], [ 4, 1 ], [ 4, 2 ], [ 4, 3 ], [ 4, 4 ] ],
            center: [ 2, 2 ]
        }
    }
};

function applyTacticalEffects(board, placed) {
    for (let k in placed) {
        if (placed[k] === "shield") {
            let [r, c] = k.split(",").map(Number);
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                let y = r + dr, x = c + dc;
                if (y >= 0 && y < SR && x >= 0 && x < SC) board[y][x] = 0;
            }
        }
    }
    let extra = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let k in placed) {
        if (placed[k] === "amplifier") {
            let [r, c] = k.split(",").map(Number);
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                let y = r + dr, x = c + dc;
                if (y < 0 || y >= SR || x < 0 || x >= SC) continue;
                let nk = y + "," + x;
                if (nk === k || !placed[nk]) continue;
                for (let d2r = -1; d2r <= 1; d2r++) for (let d2c = -1; d2c <= 1; d2c++) {
                    let yy = y + d2r, xx = x + d2c;
                    if (yy >= 0 && yy < SR && xx >= 0 && xx < SC) extra[yy][xx]++;
                }
            }
        }
    }
    for (let i = 0; i < SR; i++) for (let j = 0; j < SC; j++) board[i][j] += extra[i][j];
    for (let k in placed) {
        if (placed[k] === "siphon") {
            let [r, c] = k.split(",").map(Number);
            let cnt = 0;
            for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
                let y = r + dr, x = c + dc;
                if (y < 0 || y >= SR || x < 0 || x >= SC) continue;
                if (y + "," + x !== k && placed[y + "," + x]) cnt++;
            }
            board[r][c] += cnt;
        }
    }
    for (let k in placed) {
        if (placed[k] === "shield") {
            let [r, c] = k.split(",").map(Number);
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                let y = r + dr, x = c + dc;
                if (y >= 0 && y < SR && x >= 0 && x < SC) board[y][x] = 0;
            }
        }
    }
}

function addVal(r, c, dr, dc, v, n) {
    for (let nr = -dr; nr <= dr; nr++) for (let nc = -dc; nc <= dc; nc++) {
        let y = r + nr, x = c + nc;
        if (y >= 0 && y < SR && x >= 0 && x < SC) v[y][x] += n;
    }
}

function getEnabledMineKeys() {
    let keys = [];
    for (let k in M) {
        if (seriesState[M[k].category]) keys.push(k);
    }
    return keys;
}

function pickMinesFromEnabled(count, excludeNormal) {
    let enabled = getEnabledMineKeys();
    let normalAvailable = enabled.includes("normal");
    let specials = enabled.filter(k => k !== "normal");
    let pool = {};
    let normalCount = normalAvailable ? Math.max(1, Math.floor(count * .35)) : 0;
    if (normalCount > 0) pool.normal = normalCount;
    let remain = count - normalCount;
    while (remain > 0 && specials.length > 0) {
        let t = specials[Math.floor(Math.random() * specials.length)];
        pool[t] = (pool[t] || 0) + 1;
        remain--;
    }
    while (remain > 0) {
        pool.normal = (pool.normal || 0) + 1;
        remain--;
    }
    return pool;
}
