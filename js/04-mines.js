/* ==========================================================================
 * 模块 04 · 地雷定义与战术结算（js/04-mines.js）
 *
 * 职责：定义 5 个系列共 22 种地雷的元数据与影响函数 f()，并把一份「已放置
 *       地雷」结算成整盘影响值矩阵（含战术雷的连锁结算）。
 * 依赖：全局棋盘尺寸 SR / SC（00-core）与系列开启状态 seriesState（01-storage）。
 * 对外：CATEGORY、M、applyTacticalEffects、addVal、getEnabledMineKeys、
 *       pickMinesFromEnabled。
 * 设计要点：
 *   1) 每种雷只回答"我如何改变影响值"，不关心渲染、判分与出题；所有雷共用
 *      同一套结算流程，扩展雷型只需要在 M 里追加一条记录。
 *   2) 影响函数分为两类：一类是线性叠加的影响核，可以按任意顺序累加；
 *      另一类带特殊语义（护盾置 0、放大器依赖邻域、虹吸器依赖计数），
 *      无法用叠加表达，必须由 applyTacticalEffects 统一结算。
 *   3) 地雷以 "行,列" 字符串为键、雷型 key 为值存放在 G.placed，因此 f()
 *      只接收数字坐标，与鼠标、拖拽等交互状态解耦。
 *   4) 出题时先在棋盘上随机布雷，再把这些 f() 依次作用到全零矩阵上反算出
 *      目标值矩阵，因此同一条定义同时服务于"出题"与"玩家操作后的重算"。
 * ========================================================================== */

/* ---------- 1. 系列目录：图鉴分组与展示顺序 ---------- */
/* 每个系列记录中文名、展示顺序与图标；order 决定图鉴与练习列表中的分组
   先后（数值小者在前），emoji 只参与展示，不参与任何规则判定。 */
const CATEGORY = {
    // 基础系列：默认全部开启，是其他系列的教学参照
    basic: {
        name: "基础系列",
        order: 0,
        emoji: "💣"
    },
    // 异形系列：斜线、十字、环形、八向等非矩形影响核
    special: {
        name: "异形系列",
        order: 1,
        emoji: "🔶"
    },
    // 物理律系列：引入负影响、强度衰减等"非均匀"效果
    physics: {
        name: "物理律系列",
        order: 2,
        emoji: "☢️"
    },
    // 对称系列：同一个影响核在多个对称位置重复落子
    symmetry: {
        name: "对称系列",
        order: 3,
        emoji: "‼️"
    },
    // 战术系列：不改几何形状，而是改写其他雷的结算方式
    tactical: {
        name: "战术系列",
        order: 4,
        emoji: "🔫"
    }
};

/* ---------- 2. 图鉴总表：记录字段与影响核分组 ---------- */
/* 图鉴记录字段约定：
 *   category  所属系列 key，用于图鉴分组与解锁筛选
 *   n / e     中文名 / 图鉴与棋盘上使用的 emoji
 *   cls       地雷专属 CSS 类名，决定棋盘上的配色
 *   tip       一句话影响说明，直接用于槽位悬浮提示与图鉴
 *   f         影响函数：把本雷的影响累加到矩阵 v（参数为数字行列坐标）
 *   preview   图鉴缩略图数据源（单图例）：
 *               size    网格边长
 *               active  受影响的相对格坐标数组 [行, 列]
 *               center  雷自身位置 [行, 列]
 *               values  逐格增量矩阵（缺省表示受影响格全部 +1、不显示数字）
 *               labels  逐格文字覆盖，键为 "行,列"（用于把 0 显示在不受影响的格上）
 *               marks   其他地雷标记 [{ r, c, text }]，用于示范多雷联动
 *               guides  图例引导线/点/气泡：line 两端坐标、dot 圆心、callout 文本与位置
 *   demos     多图例数据源（战术系列用，优先于 preview）：每项含
 *               title 演示标题、note 一句话说明、preview 该演示的缩略图数据
 *
 * 影响核分组的阅读顺序：
 *   基础系列是纯几何核（矩形、线形），核与核之间可以直接叠加；
 *   异形、物理律系列仍是几何核，但允许负值、强度衰减与非矩形形状；
 *   对称系列是同一个几何核在多个对称位置重复落子；
 *   战术系列的 f() 大多只写自身，真正的语义在 applyTacticalEffects 中结算。
 */
const M = {
    /* ---------- 3. 基础系列：纯几何影响核 ---------- */
    // 基准核：3x3（含中心）+1，其他雷的影响范围都以它为单位描述
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
    // 范围放大版基准核：5x5 +1，用来制造大面积同值区域
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
    // 强度放大版基准核：3x3 +2，单格影响是普通雷的两倍
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
    // 竖直线形核：同列上下各 2 格（含自身）各 +1
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
    // 水平线形核：同行左右各 2 格（含自身）各 +1
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
    /* ---------- 4. 异形系列：非矩形与稀疏影响核 ---------- */
    // 十字核：横竖各 2 格 +1，中心格只计一次；形状不属于矩形影响核，归入异形系列
    chiliPlus: {
        category: "special",
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
    // 斜线核：3x3 两条对角线 +1，中心只计一次
    chiliDiag: {
        category: "special",
        n: "对角辣椒",
        e: "❌",
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
    // 斜线核的 5x5 尺寸：两条长对角线 +1
    chiliBigDiag: {
        category: "special",
        n: "大对角辣椒",
        e: "❌",
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
    // 空心核：5x5 外圈 +1，中心 3x3 完全不受影响；图例在本格标 0 以免误读
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
            center: [ 2, 2 ],
            labels: {
                "2,2": "0"
            }
        }
    },
    // 米字核：8 个方向各延伸 2 格 +1，另加自身
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
    /* ---------- 5. 物理律系列：带符号与强度梯度的核 ---------- */
    // 负影响核：3x3 -1，用于抵消周围雷的正向累加
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
    // 衰减核：中心 +3、内环 8 格 +2、外环 +1，形成同心梯度
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
    // 漏斗核：中心 -1，四个斜角与四个轴向 2 格 +1，十字方向保持 0
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
    // 大漏斗核：中心 -2、内环 -1、外环 +1，负值区扩大一圈
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
    /* ---------- 6. 对称系列：同一影响核在对称位置重复落子 ---------- */
    // 对称核：在自身与中心对称点各落一个 3x3 +1
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
            guides: [ {
                type: "dot",
                x: 3,
                y: 3
            }, {
                type: "line",
                x1: 4.15,
                y1: 1.35,
                x2: 3.2,
                y2: 2.85
            }, {
                type: "callout",
                x: 4.55,
                y: .95,
                text: "中心点"
            } ]
        }
    },
    // 对称核：自身 3x3 +1，中心对称点 3x3 -1，正负成对出现
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
            guides: [ {
                type: "dot",
                x: 3,
                y: 3
            }, {
                type: "line",
                x1: 4.15,
                y1: 1.35,
                x2: 3.2,
                y2: 2.85
            }, {
                type: "callout",
                x: 4.55,
                y: .95,
                text: "中心点"
            } ]
        }
    },
    // 对称核：两个中心对称位置都落 3x3 -1
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
            guides: [ {
                type: "dot",
                x: 3,
                y: 3
            }, {
                type: "line",
                x1: 4.15,
                y1: 1.35,
                x2: 3.2,
                y2: 2.85
            }, {
                type: "callout",
                x: 4.55,
                y: .95,
                text: "中心点"
            } ]
        }
    },
    // 三重复制：自身、水平镜像、垂直镜像三处各落一个 3x3 +1；图例用横竖两条平分线分区
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
            values: [ [ 1, 1, 1, 1, 1, 1 ], [ 1, 1, 1, 1, 1, 1 ], [ 1, 1, 1, 1, 1, 1 ], [ 1, 1, 1, 0, 0, 0 ], [ 1, 1, 1, 0, 0, 0 ], [ 1, 1, 1, 0, 0, 0 ] ],
            guides: [ {
                type: "line",
                x1: 3,
                y1: 0,
                x2: 3,
                y2: 6,
                dash: ".22 .16"
            }, {
                type: "line",
                x1: 0,
                y1: 3,
                x2: 6,
                y2: 3,
                dash: ".22 .16"
            } ]
        }
    },
    /* ---------- 7. 战术系列：f() 只写自身，语义在结算阶段展开 ---------- */
    // 特殊语义：本格 +1；邻域内每有一枚其他雷，就把该雷的 3x3 再加 1
    // 图例给两张：单独放置（只影响本格）与 3x3 内有普通雷（放大普通雷的范围）
    amplifier: {
        category: "tactical",
        n: "伤害放大器",
        e: "🔍",
        cls: "amplifier-bomb",
        tip: "本格+1；3x3内每有其他地雷→该地雷3x3额外+1",
        f: (r, c, v) => {
            v[r][c]++;
        },
        demos: [ {
            title: "单独放置",
            note: "3×3 内没有其他地雷时，只有本格 +1，周围不受影响",
            preview: {
                size: 3,
                active: [ [ 1, 1 ] ],
                center: [ 1, 1 ],
                values: [ [ 0, 0, 0 ], [ 0, 1, 0 ], [ 0, 0, 0 ] ]
            }
        }, {
            title: "3×3 内有普通雷",
            note: "3×3范围内每有一枚其他地雷，那枚地雷的 3×3 再 +1",
            preview: {
                size: 3,
                active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ] ],
                center: [ 1, 1 ],
                marks: [ {
                    r: 0,
                    c: 1,
                    text: "💣"
                } ],
                values: [ [ 2, 2, 2 ], [ 2, 3, 2 ], [ 0, 0, 0 ] ]
            }
        } ]
    },
    // 特殊语义：本格无影响，只在所在行、列的首尾格各 +1
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
        demos: [ {
            title: "单独放置",
            note: "本格不产生任何影响；只在所在行、列的首尾格各 +1，贴边时该格无影响",
            preview: {
                size: 5,
                active: [ [ 0, 2 ], [ 2, 0 ], [ 2, 4 ], [ 4, 2 ] ],
                center: [ 2, 2 ],
                labels: {
                    "2,2": "0"
                }
            }
        } ]
    },
    // 特殊语义：3x3 影响值强制置 0；f() 留空，由结算阶段统一清零
    // 图例给两张：单独放置（3x3 全为 0）与范围内有普通雷（普通雷的影响同样被抹平）
    shield: {
        category: "tactical",
        n: "屏障生成器",
        e: "🛡️",
        cls: "shield-bomb",
        tip: "3x3范围内所有地块固定为0",
        f: (r, c, v) => {},
        demos: [ {
            title: "单独放置",
            note: "3×3 范围内所有地块的影响值固定为 0",
            preview: {
                size: 3,
                active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ] ],
                center: [ 1, 1 ],
                values: [ [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ] ]
            }
        }, {
            title: "范围里有普通雷",
            note: "护盾的优先级最高：范围内无论影响是多少，都会被抹平为 0",
            preview: {
                size: 3,
                active: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 2, 0 ], [ 2, 1 ], [ 2, 2 ] ],
                center: [ 1, 1 ],
                marks: [ {
                    r: 0,
                    c: 0,
                    text: "💣"
                } ],
                values: [ [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ] ]
            }
        } ]
    },
    // 特殊语义：本格 +1；5x5 内每有一枚其他雷再 +1，按邻域计数结算
    // 图例给两张：单独放置（本格 +1）与 5x5 内有 2 枚其他雷（本格累加到 3）
    siphon: {
        category: "tactical",
        n: "能量虹吸器",
        e: "🌀",
        cls: "siphon-bomb",
        tip: "本格+1；5x5内每有1个其他地雷额外+1",
        f: (r, c, v) => {
            v[r][c]++;
        },
        demos: [ {
            title: "单独放置",
            note: "5×5 内没有其他地雷时，只有本格 +1",
            preview: {
                size: 5,
                active: [ [ 2, 2 ] ],
                center: [ 2, 2 ],
                labels: {
                    "2,2": "1"
                }
            }
        }, {
            title: "5×5 内有 2 枚其他雷",
            note: "5×5 范围内每多 1 枚其他地雷，本格再 +1：图中 2 枚 → 本格合计 3，其他格只按各自的雷结算",
            preview: {
                size: 5,
                active: [ [ 0, 1 ], [ 1, 0 ], [ 1, 1 ], [ 2, 2 ], [ 3, 3 ], [ 3, 4 ], [ 4, 3 ] ],
                center: [ 2, 2 ],
                marks: [ {
                    r: 0,
                    c: 0,
                    text: "💣"
                }, {
                    r: 4,
                    c: 4,
                    text: "💣"
                } ],
                labels: {
                    "0,1": "1",
                    "1,0": "1",
                    "1,1": "1",
                    "2,2": "3",
                    "3,3": "1",
                    "3,4": "1",
                    "4,3": "1"
                }
            }
        } ]
    }
};

/* ---------- 8. 战术连锁结算：护盾的优先级最高 ---------- */
/**
 * 把战术雷的特殊语义结算到影响矩阵上（原地修改 board）。
 * 结算顺序固定为：首轮护盾清零 → 放大器加成 → 虹吸器计数 → 末轮护盾清零。
 * 护盾放到最后再清一次，是为了让"护盾范围内恒为 0"的语义不被后结算的
 * 放大器与虹吸器破坏。出题反算与玩家操作后的重算都会调用本函数。
 * @param {number[][]} board 影响值矩阵，尺寸为 SR x SC
 * @param {Object} placed 已放置地雷表，键为 "行,列"，值为雷型 key
 * @sideeffect 直接修改入参 board
 */
function applyTacticalEffects(board, placed) {
    // 首轮清零：先抹掉护盾范围内来自普通雷的累加值
    for (let k in placed) {
        if (placed[k] === "shield") {
            let [r, c] = k.split(",").map(Number);
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                let y = r + dr, x = c + dc;
                if (y >= 0 && y < SR && x >= 0 && x < SC) board[y][x] = 0;
            }
        }
    }
    // 放大器加成先记在独立的 extra 层，最后统一并入，避免边算边改读到脏数据
    let extra = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let k in placed) {
        if (placed[k] === "amplifier") {
            let [r, c] = k.split(",").map(Number);
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                let y = r + dr, x = c + dc;
                if (y < 0 || y >= SR || x < 0 || x >= SC) continue;
                let nk = y + "," + x;
                // 只放大邻域内"其他"雷：放大器自己占的格子不参与
                if (nk === k || !placed[nk]) continue;
                for (let d2r = -1; d2r <= 1; d2r++) for (let d2c = -1; d2c <= 1; d2c++) {
                    let yy = y + d2r, xx = x + d2c;
                    if (yy >= 0 && yy < SR && xx >= 0 && xx < SC) extra[yy][xx]++;
                }
            }
        }
    }
    // 先合并放大器加成，再单独处理虹吸器：虹吸器只数雷，不读影响值
    for (let i = 0; i < SR; i++) for (let j = 0; j < SC; j++) board[i][j] += extra[i][j];
    for (let k in placed) {
        if (placed[k] === "siphon") {
            let [r, c] = k.split(",").map(Number);
            // 虹吸器的强度只取决于 5x5 内其他雷的数量，与雷型无关
            let cnt = 0;
            for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
                let y = r + dr, x = c + dc;
                if (y < 0 || y >= SR || x < 0 || x >= SC) continue;
                if (y + "," + x !== k && placed[y + "," + x]) cnt++;
            }
            board[r][c] += cnt;
        }
    }
    // 末轮清零：护盾优先级最高，覆盖放大器与虹吸器刚写入的加成
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

/* ---------- 9. 影响核写入辅助 ---------- */
/**
 * 以 (r,c) 为中心，把增量 n 累加到半径 dr x dc 的矩形区域内（含中心）。
 * 越界格子直接跳过，因此棋盘边缘的雷也能安全调用。
 * @param {number} r 中心行
 * @param {number} c 中心列
 * @param {number} dr 行方向半径（例如 1 表示上下各 1 行）
 * @param {number} dc 列方向半径
 * @param {number[][]} v 目标影响值矩阵
 * @param {number} n 每格增量，可为负数
 * @sideeffect 直接修改入参 v
 */
function addVal(r, c, dr, dc, v, n) {
    for (let nr = -dr; nr <= dr; nr++) for (let nc = -dc; nc <= dc; nc++) {
        let y = r + nr, x = c + nc;
        if (y >= 0 && y < SR && x >= 0 && x < SC) v[y][x] += n;
    }
}

/* ---------- 10. 图鉴筛选与随机牌池抽样 ---------- */
/**
 * 返回当前已开启系列中的全部雷型 key。
 * 顺序跟随 M 的声明顺序；需要随机性时由调用方自行打乱。
 * @returns {string[]} 雷型 key 列表
 */
function getEnabledMineKeys() {
    let keys = [];
    for (let k in M) {
        if (seriesState[M[k].category]) keys.push(k);
    }
    return keys;
}

/**
 * 从已开启雷型中抽出一份"雷型 -> 数量"牌池，供随机出题使用。
 * 普通雷按约 35% 的比例保底（至少 1 颗），其余名额在特殊雷中等概率抽取；
 * 特殊雷候选耗尽后，剩余名额回落为普通雷。
 * @param {number} count 本局地雷总数
 * @param {boolean} excludeNormal 预留的排除开关，当前实现未使用
 * @returns {Object} 键为雷型 key、值为该雷型本局数量的牌池
 */
function pickMinesFromEnabled(count, excludeNormal) {
    let enabled = getEnabledMineKeys();
    let normalAvailable = enabled.includes("normal");
    let specials = enabled.filter(k => k !== "normal");
    let pool = {};
    // 普通雷占比约 35%：数量少时也至少保留 1 颗，保证基础难度存在
    let normalCount = normalAvailable ? Math.max(1, Math.floor(count * .35)) : 0;
    if (normalCount > 0) pool.normal = normalCount;
    let remain = count - normalCount;
    // 剩余名额在特殊雷里随机分配，同一雷型可以被多次抽中
    while (remain > 0 && specials.length > 0) {
        let t = specials[Math.floor(Math.random() * specials.length)];
        pool[t] = (pool[t] || 0) + 1;
        remain--;
    }
    // 特殊雷候选耗尽后，剩余名额回落为普通雷
    while (remain > 0) {
        pool.normal = (pool.normal || 0) + 1;
        remain--;
    }
    return pool;
}
