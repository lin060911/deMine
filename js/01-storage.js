/* ==========================================================================
 * 模块 01 · 存档层与系列状态（js/01-storage.js）
 *
 * 职责：把 localStorage 封装成可失败的 Store，承载成绩、胜场、系列解锁与
 *   教学进度等持久化数据；同时提供整包导出、导入、合并与导入前快照。
 * 依赖：00-core 的 RM.warn（日志）与全局变量；window.localStorage。
 * 对外：window.Store（基础读写、guard/save、导出导入、画像合并、备份）；
 *   全局 lt / rec / wins / brainUnlockedNotified / seriesState /
 *   seriesUnlocked，以及 getSeriesState / saveSeriesState /
 *   getSeriesUnlocked / saveSeriesUnlocked。
 * 设计要点：
 *   1) 单点封装：所有读写都经过 Store，任何一次抛错（隐私模式、配额超限、
 *      被手工改坏的键）都被关在这一层里，不会让整个脚本停摆。
 *   2) 内存降级：localStorage 完全不可用时自动退回内存 Map，本局仍可玩，
 *      只是关闭页面后不再保存。
 *   3) 双份写入：重要存档每次写入前把上一份好数据备份到 <key>__bak，
 *      主档损坏时读取自动回退备份档。
 *   4) 结构校验：读出的对象必须通过校验器才采用，否则回退默认值。
 *   5) 存档结构号与迁移入口：结构演进时可在读取阶段做数据适配。
 *   6) 导出 / 导入：把全部存档打包成 JSON 文件，换设备或清缓存前可先备份。
 * ========================================================================== */

(function() {
    "use strict";

    /* ---------- 1. 存储后端与内存降级 ---------- */

    /* 内存镜像：localStorage 不可用时仍能读写本局数据，页面关闭后释放 */
    var mem = Object.create(null);
    var backend = null;
    var backendName = "memory";

    /* 启动探测：真实写入一次再删除，才能发现"存在但不可写"的情况
     * （隐私模式、策略限制等）。探测失败即退回内存后端。 */
    try {
        var probe = "__rm_probe__" + Math.random().toString(36).slice(2);
        window.localStorage.setItem(probe, "1");
        window.localStorage.removeItem(probe);
        backend = window.localStorage;
        backendName = "localStorage";
    } catch (e) {
        backend = null;
        backendName = "memory";
    }

    /**
     * 读取一个键的原始字符串；后端抛错时退回内存镜像。
     * @param {string} k 存档键
     * @returns {string|null} 原始值，不存在时为 null
     */
    function rawGet(k) {
        if (backend) {
            try {
                return backend.getItem(k);
            } catch (e) {
                return mem[k] === undefined ? null : mem[k];
            }
        }
        return mem[k] === undefined ? null : mem[k];
    }

    /**
     * 写入一个键：先写内存镜像再写后端，后端失败也不丢本局数据。
     * @param {string} k 存档键
     * @param {string} v 已序列化的值
     * @returns {boolean} 是否成功持久化
     */
    function rawSet(k, v) {
        mem[k] = v;
        if (backend) {
            try {
                backend.setItem(k, v);
                return true;
            } catch (e) {
                return false;
            }
        }
        return true;
    }

    /**
     * 同时从内存镜像与后端删除一个键；后端异常忽略。
     * @param {string} k 存档键
     */
    function rawRemove(k) {
        delete mem[k];
        if (backend) {
            try {
                backend.removeItem(k);
            } catch (e) {}
        }
    }

    /**
     * 列出后端与内存镜像中出现过的全部键，去重后返回。
     * @returns {string[]} 键名列表
     */
    function rawKeys() {
        var out = [];
        var i, k;
        if (backend) {
            try {
                for (i = 0; i < backend.length; i++) {
                    k = backend.key(i);
                    if (k !== null) out.push(k);
                }
            } catch (e) {}
        }
        for (k in mem) {
            if (Object.prototype.hasOwnProperty.call(mem, k) && out.indexOf(k) < 0) out.push(k);
        }
        return out;
    }

    /* 值工具：isObj 把"对象"收紧为普通对象，clone 用 JSON 做深拷贝，
     * 保证调用方拿到的是独立副本，改不到内部数据。 */
    function isObj(v) {
        return !!v && typeof v === "object" && !Array.isArray(v);
    }

    function clone(v) {
        return v === undefined ? v : JSON.parse(JSON.stringify(v));
    }

    /* ---------- 2. 键规则与校验和 ---------- */

    /* 已知存档键白名单（导出用）；教学进度键按前缀识别，不在此列出 */
    var KEY_WHITELIST = [
        "mineLastTimes", "mineRecords", "mineWins",
        "brainUnlockedNotified", "brainCleared",
        "seriesState", "seriesUnlocked",
        "tutorialStep", "tutorialCompleted",
        "placeMode_v1", "mineInfluenceHint", "mineEffectPreview", "mineSoundSettings",
        "welcomeLastShown", "hasVisitedBefore",
        "achievementState_v1", "rmSchemaVersion"
    ];
    /* 允许参与导入导出的键前缀，覆盖按前缀批量生成的动态键 */
    var KEY_PREFIX = ["tutorial_", "mine", "rm"];
    /* 键名后缀：__bak 备份、__pre 导入前快照、__sig 校验和 */
    var BAK_SUFFIX = "__bak";
    var PRE_SUFFIX = "__pre";      // 导入前的自动快照
    var SIG_SUFFIX = "__sig";

    /**
     * 判断字符串是否以指定后缀结尾；要求键长严格大于后缀长。
     * @param {string} k 待检查的键
     * @param {string} s 后缀
     * @returns {boolean}
     */
    function endsWith(k, s) {
        return k.length > s.length && k.indexOf(s) === k.length - s.length;
    }

    /* 辅助键：备份 / 校验和 / 导入前快照，属于实现细节。
     * 它们不参与导出，也不在覆盖导入时被清空。 */
    function isAuxKey(k) {
        if (!k) return false;
        if (k === "rmPreImportAt" || k === "rmPreImportISO") return true;
        return endsWith(k, BAK_SUFFIX) || endsWith(k, SIG_SUFFIX) || endsWith(k, PRE_SUFFIX);
    }

    /**
     * 判断一个键是否属于本游戏管理的存档项（白名单键或已知前缀）。
     * @param {string} k 存档键
     * @returns {boolean}
     */
    function isManagedKey(k) {
        if (!k) return false;
        if (endsWith(k, BAK_SUFFIX) || endsWith(k, PRE_SUFFIX)) return true;
        if (KEY_WHITELIST.indexOf(k) >= 0) return true;
        for (var i = 0; i < KEY_PREFIX.length; i++) {
            if (k.indexOf(KEY_PREFIX[i]) === 0) return true;
        }
        return false;
    }

    /* 简易校验和（djb2 变体）：只用于发现数据被手工改动，不承担安全职责 */
    function sum(str) {
        var h = 5381, i;
        str = String(str);
        for (i = 0; i < str.length; i++) {
            h = ((h << 5) + h + str.charCodeAt(i)) | 0;
        }
        return (h >>> 0).toString(36);
    }

    /* ---------- 3. Store 基础读写 ---------- */

    /**
     * 存档门面：向上层提供永不抛出的读写接口。
     * backend 记录实际使用的后端名，available 表示是否真正持久化，
     * tampered 标记是否发现过数据被改动，schema 为当前存档结构号。
     */
    var Store = {
        backend: backendName,
        available: !!backend,
        tampered: false,
        schema: 1,

        /**
         * 读取原始字符串。
         * @param {string} k 存档键
         * @returns {string|null} 原始值；任何异常都返回 null
         */
        get: function(k) {
            try {
                return rawGet(k);
            } catch (e) {
                return null;
            }
        },
        /**
         * 写入原始字符串。
         * @param {string} k 存档键
         * @param {*} v 值，写入前统一转成字符串
         * @returns {boolean} 是否写入成功
         */
        set: function(k, v) {
            try {
                return rawSet(k, String(v));
            } catch (e) {
                return false;
            }
        },
        /**
         * 删除一个键；异常静默忽略。
         * @param {string} k 存档键
         */
        remove: function(k) {
            try {
                rawRemove(k);
            } catch (e) {}
        },

        /**
         * 读取并解析 JSON；键缺失、空串或解析失败时返回 fallback 的深拷贝。
         * @param {string} k 存档键
         * @param {*} fallback 默认值
         * @returns {*} 解析结果或默认值
         */
        getJSON: function(k, fallback) {
            var raw = Store.get(k);
            if (raw === null || raw === undefined || raw === "") return clone(fallback);
            try {
                var v = JSON.parse(raw);
                return v === null ? clone(fallback) : v;
            } catch (e) {
                return clone(fallback);
            }
        },
        /**
         * 把值序列化为 JSON 后写入。
         * @param {string} k 存档键
         * @param {*} v 任意可序列化的值
         * @returns {boolean} 是否写入成功
         */
        setJSON: function(k, v) {
            try {
                return rawSet(k, JSON.stringify(v));
            } catch (e) {
                return false;
            }
        },

        /* ---------- 4. 受保护读写：主档损坏时自动回退备份 ---------- */

        /**
         * 读取一个受保护存档项：解析、结构校验、校验和比对全部通过才采用。
         * 主档不可用时回退到 <key>__bak；两者都不可用则返回 fallback。
         * @param {string} k 存档键
         * @param {*} fallback 默认值
         * @param {function(*):boolean} [validate] 结构校验器，默认要求普通对象
         * @returns {*} 可用的存档值
         * @sideeffect 发现数据被改动时置 Store.tampered
         */
        guard: function(k, fallback, validate) {
            var check = validate || isObj;
            var raw = Store.get(k);
            var parsed = null, bad = false;
            if (raw !== null && raw !== undefined && raw !== "") {
                try {
                    parsed = JSON.parse(raw);
                } catch (e) {
                    parsed = null;
                }
            }
            if (parsed !== null && parsed !== undefined && check(parsed)) {
                // 校验和不吻合：标记数据被改动过，但仍然采用（单人游戏不惩罚玩家）
                var sig = Store.get(k + "__sig");
                if (sig && sig !== sum(raw)) Store.tampered = true;
                return parsed;
            }
            if (raw !== null && raw !== undefined && raw !== "") bad = true;
            var bak = Store.getJSON(k + BAK_SUFFIX, null);
            if (bak !== null && bak !== undefined && check(bak)) {
                if (bad) Store.tampered = true;
                if (window.RM) RM.warn("storage:guard", k + " 主档不可用，已回退备份档");
                return bak;
            }
            if (bad) Store.tampered = true;
            return clone(fallback);
        },

        /**
         * 保存一个受保护存档项：先把当前好数据转入备份位，再写新值与校验和。
         * @param {string} k 存档键
         * @param {*} v 待保存的值
         * @returns {boolean} 总是返回 true，写入结果由底层降级逻辑保证
         */
        save: function(k, v) {
            // 顺序很重要：先备份上一份好数据，再写新值，中途失败也能回退
            var prev = Store.get(k);
            if (prev !== null && prev !== undefined && prev !== "") {
                try {
                    JSON.parse(prev);
                    Store.set(k + BAK_SUFFIX, prev);
                } catch (e) {}
            }
            var str = JSON.stringify(v);
            Store.set(k, str);
            Store.set(k + "__sig", sum(str));
            return true;
        },

        /* ---------- 5. 导出与导入 ---------- */

        /**
         * 收集全部受管存档项，打包成可导出的 JSON 结构。
         * @returns {{app:string,schema:number,exportedAt:string,data:Object}}
         */
        exportAll: function() {
            var data = {}, keys = rawKeys(), i, k;
            for (i = 0; i < keys.length; i++) {
                k = keys[i];
                if (!isManagedKey(k) || isAuxKey(k)) continue;
                var v = Store.get(k);
                if (v === null || v === undefined) continue;
                data[k] = v;
            }
            return {
                app: "reverse-minesweeper",
                schema: Store.schema,
                exportedAt: new Date().toISOString(),
                data: data
            };
        },

        /**
         * 把一份导出结构写回本地存储。
         * 覆盖模式先清空受管键但保留辅助键，导错时仍可回退快照；
         * 合并模式只写入文件中的键，合并结果由调用方预先算好。
         * @param {Object} payload 导出结构
         * @param {{merge?:boolean}} [opt] 导入选项
         * @returns {{ok:boolean,count:number,skipped:number,error:?string}}
         */
        importAll: function(payload, opt) {
            opt = opt || {};
            var res = { ok: false, count: 0, skipped: 0, error: null };
            try {
                if (!payload || payload.app !== "reverse-minesweeper" || !isObj(payload.data)) {
                    res.error = "不是本游戏的存档文件";
                    return res;
                }
                var keys = Object.keys(payload.data);
                var i, k, v;
                if (!opt.merge) {
                    var all = rawKeys();
                    for (i = 0; i < all.length; i++) {
                        // 清空时跳过辅助键：保住"导入前快照"和校验和，导错了还能撤
                        if (isManagedKey(all[i]) && !isAuxKey(all[i])) rawRemove(all[i]);
                    }
                }
                for (i = 0; i < keys.length; i++) {
                    k = keys[i];
                    v = payload.data[k];
                    if (!isManagedKey(k) || isAuxKey(k)) {
                        res.skipped++;
                        continue;
                    }
                    if (v === null || v === undefined) continue;
                    rawSet(k, String(v));
                    res.count++;
                }
                Store.set("rmSchemaVersion", String(Store.schema));
                res.ok = true;
                return res;
            } catch (e) {
                res.error = e && e.message ? e.message : String(e);
                return res;
            }
        },

        /**
         * 触发浏览器下载一个文本文件，用于导出存档。
         * @param {string} filename 文件名
         * @param {string} text 文件内容
         * @returns {boolean} 是否成功发起下载
         * @sideeffect 创建并移除临时 <a> 节点，延时释放 Blob URL
         */
        download: function(filename, text) {
            try {
                var blob = new Blob([text], { type: "application/json;charset=utf-8" });
                var url = URL.createObjectURL(blob);
                var a = document.createElement("a");
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(function() {
                    URL.revokeObjectURL(url);
                }, 1500);
                return true;
            } catch (e) {
                return false;
            }
        },

        /**
         * 汇总存档概况：受管键数量、累计胜场、后端类型与改动标记。
         * @returns {{keys:number,wins:number,backend:string,tampered:boolean}}
         */
        summarize: function() {
            var d = Store.exportAll().data;
            var n = 0, i = 0;
            for (var k in d) {
                if (Object.prototype.hasOwnProperty.call(d, k) && !isAuxKey(k)) n++;
            }
            var wins = Store.getJSON("mineWins", {});
            for (var key in wins) {
                if (Object.prototype.hasOwnProperty.call(wins, key)) i += (wins[key] || 0);
            }
            return { keys: n, wins: i, backend: backendName, tampered: Store.tampered };
        }
    };

    /* ---------- 6. 存档画像 ---------- */

    /* 把存档数据翻译成可读画像，供"导入存档"提示框做三列对比。 */

    /* 参与成绩统计的难度 key，顺序与界面列表一致 */
    var DIFFS = ["easy", "medium", "hard", "hell", "brain"];
    /* 五个地雷系列 key，顺序与解锁顺序一致 */
    var SERIES = ["basic", "special", "physics", "symmetry", "tactical"];

    /**
     * 解析存档中的字符串值：能解析成 JSON 就返回解析结果，否则原样返回。
     * @param {*} v 原始值
     * @returns {*} 解析后的值
     */
    function parseVal(v) {
        if (v === undefined || v === null) return undefined;
        if (typeof v !== "string") return v;
        try {
            return JSON.parse(v);
        } catch (e) {
            return v;
        }
    }

    /**
     * 转为数字；非有限值回退到默认值。
     * @param {*} v 原始值
     * @param {number} d 默认值
     * @returns {number}
     */
    function numOr(v, d) {
        var n = Number(v);
        return isFinite(n) ? n : d;
    }

    /**
     * 判断布尔型存档值：接受真正的布尔与字符串 "true" 两种写法。
     * @param {*} v 原始值
     * @returns {boolean}
     */
    function isTrueish(v) {
        return v === true || v === "true";
    }

    /**
     * 返回系列解锁与开关的默认状态：仅基础系列开启。
     * @returns {{basic:boolean,special:boolean,physics:boolean,
     *   symmetry:boolean,tactical:boolean}}
     */
    function defaultSeries() {
        return { basic: true, special: false, physics: false, symmetry: false, tactical: false };
    }

    /**
     * 把一个"键 → 值"的存档集合翻译成可读画像，供导入对比展示。
     * @param {Object} [data] 存档数据，值可以是字符串或已解析值
     * @returns {Object} 画像：键数量、总胜场、各难度胜场与纪录、成就数量
     *   与计数、系列开启数量、教学总进度、彩蛋标记
     */
    function profile(data) {
        var d = data || {};
        /* 内部取值器：只接受对象型值，缺失或类型不符时返回默认值 */
        function get(key, fb) {
            var v = parseVal(d[key]);
            if (v === undefined || v === null || v === "") return fb;
            if (typeof v === "object") return v;
            return fb;
        }
        var w = get("mineWins", {});
        var r = get("mineRecords", {});
        var su = get("seriesUnlocked", defaultSeries());
        var ss = get("seriesState", defaultSeries());
        var ach = get("achievementState_v1", {});
        var unlocked = (ach && ach.unlocked) || {};

        var tutMap = {};
        var tutTotal = 0;
        tutMap.basic = numOr(parseVal(d["tutorialStep"]), 0);
        for (var i = 0; i < SERIES.length; i++) {
            var s = SERIES[i];
            if (s === "basic") continue;
            tutMap[s] = numOr(parseVal(d["tutorial_" + s]), 0);
        }
        for (var kk in tutMap) {
            if (Object.prototype.hasOwnProperty.call(tutMap, kk)) tutTotal += tutMap[kk];
        }

        /* 统计系列状态对象中已开启的系列数量 */
        function countSeries(obj) {
            var n = 0;
            for (var i = 0; i < SERIES.length; i++) if (obj[SERIES[i]]) n++;
            return n;
        }

        var total = 0, winsObj = {}, recObj = {};
        for (var i2 = 0; i2 < DIFFS.length; i2++) {
            var x = DIFFS[i2];
            winsObj[x] = numOr(w[x], 0);
            recObj[x] = (r[x] === null || r[x] === undefined) ? null : numOr(r[x], null);
            total += winsObj[x];
        }

        var keysN = 0;
        for (var k3 in d) {
            if (Object.prototype.hasOwnProperty.call(d, k3) && !isAuxKey(k3)) keysN++;
        }

        return {
            keys: keysN,
            totalWins: total,
            wins: winsObj,
            rec: recObj,
            achCount: Object.keys(unlocked).length,
            achCounters: (ach && ach.counters) || {},
            seriesUnlocked: countSeries(su),
            seriesOn: countSeries(ss),
            tutorialTotal: tutTotal,
            brainCleared: isTrueish(parseVal(d["brainCleared"])),
            tutorialCompleted: isTrueish(parseVal(d["tutorialCompleted"]))
        };
    }

    /* ---------- 7. 存档合并 ---------- */

    /* 合并规则（保守，只增不减，反复导入不会让数据虚增）：
     *   · 成就解锁、系列解锁、系列开关：取并集，已解锁的不会倒退
     *   · 最快纪录：取更快的（数值更小）
     *   · 通关次数与成就计数：取较大值
     *   · 教学进度：取较大值
     *   · 布尔型（脑王彩蛋等）：有一侧为真即为真
     *   · 其余偏好设置：以当前存档为准
     */

    /**
     * 合并单个存档项：按数据含义选择取并集、取较大值、取更小值或保留当前。
     * @param {string} k 存档键
     * @param {*} a 当前存档中的值
     * @param {*} b 导入文件中的值
     * @returns {*} 合并结果
     */
    function mergeValue(k, a, b) {
        // a = 当前存档的值，b = 导入文件的值（undefined 表示该侧缺这一项）
        if (k === "mineWins") {
            var o = {}, i;
            for (i = 0; i < DIFFS.length; i++) {
                var d = DIFFS[i];
                o[d] = Math.max(numOr(a && a[d], 0), numOr(b && b[d], 0));
            }
            return o;
        }
        if (k === "mineRecords") {
            var o2 = {}, i2;
            for (i2 = 0; i2 < DIFFS.length; i2++) {
                var d2 = DIFFS[i2];
                var va = (a && a[d2] === null || a && a[d2] === undefined) ? null : numOr(a && a[d2], null);
                var vb = (b && b[d2] === null || b && b[d2] === undefined) ? null : numOr(b && b[d2], null);
                if (va === null) o2[d2] = vb;
                else if (vb === null) o2[d2] = va;
                else o2[d2] = Math.min(va, vb);
            }
            return o2;
        }
        if (k === "mineLastTimes") {
            // "本次用时"没有合并价值，以当前存档为准
            return a !== undefined ? a : b;
        }
        if (k === "achievementState_v1") {
            var A = (a && typeof a === "object") ? a : {};
            var B = (b && typeof b === "object") ? b : {};
            var out = {}, key;
            var keys = {};
            for (key in A) if (Object.prototype.hasOwnProperty.call(A, key)) keys[key] = 1;
            for (key in B) if (Object.prototype.hasOwnProperty.call(B, key)) keys[key] = 1;
            for (key in keys) {
                if (!Object.prototype.hasOwnProperty.call(keys, key)) continue;
                var va2 = A[key], vb2 = B[key];
                if (key === "unlocked") {
                    out.unlocked = {};
                    var u = {};
                    var id;
                    for (id in va2 || {}) if (Object.prototype.hasOwnProperty.call(va2, id)) u[id] = true;
                    for (id in vb2 || {}) if (Object.prototype.hasOwnProperty.call(vb2, id)) u[id] = true;
                    out.unlocked = u;
                } else if (key === "counters" || key === "basicTypesUsed") {
                    var c = {};
                    var cid;
                    for (cid in va2 || {}) if (Object.prototype.hasOwnProperty.call(va2, cid)) c[cid] = numOr(va2[cid], 0);
                    for (cid in vb2 || {}) {
                        if (!Object.prototype.hasOwnProperty.call(vb2, cid)) continue;
                        c[cid] = Math.max(numOr(c[cid], 0), numOr(vb2[cid], 0));
                    }
                    out[key] = c;
                } else if (key === "currentRunCategories") {
                    out[key] = null;     // Set，序列化后无意义，重置
                } else if (typeof va2 === "boolean" || typeof vb2 === "boolean") {
                    out[key] = !!(va2 || vb2);
                } else if (typeof va2 === "number" || typeof vb2 === "number") {
                    out[key] = Math.max(numOr(va2, 0), numOr(vb2, 0));
                } else {
                    out[key] = va2 !== undefined ? va2 : vb2;
                }
            }
            out.currentRunFlawless = true;
            out.currentRunDeletes = 0;
            return out;
        }
        if (k === "seriesUnlocked" || k === "seriesState") {
            var S1 = (a && typeof a === "object") ? a : defaultSeries();
            var S2 = (b && typeof b === "object") ? b : defaultSeries();
            var so = {};
            for (var i3 = 0; i3 < SERIES.length; i3++) {
                var s3 = SERIES[i3];
                so[s3] = !!(S1[s3] || S2[s3]);
            }
            if (k === "seriesUnlocked") so.basic = true;
            return so;
        }
        if (k === "tutorialStep" || k.indexOf("tutorial_") === 0) {
            return Math.max(numOr(parseVal(a), 0), numOr(parseVal(b), 0));
        }
        if (k === "tutorialCompleted" || k === "brainCleared" ||
            k === "brainUnlockedNotified" || k === "hasVisitedBefore") {
            return (isTrueish(a) || isTrueish(b)) ? "true" : (a !== undefined ? a : b);
        }
        return a !== undefined ? a : b;
    }

    /**
     * 把当前存档与导入数据按键合并，返回"键 → 序列化字符串"的完整结果。
     * 辅助键不参与合并，合并后值为 undefined 的键直接丢弃。
     * @param {Object} cur 当前存档数据
     * @param {Object} file 导入文件数据
     * @returns {Object} 合并后的存档数据
     */
    function mergeData(cur, file) {
        var out = {};
        var seen = {};
        var k;
        for (k in cur || {}) if (Object.prototype.hasOwnProperty.call(cur, k)) seen[k] = 1;
        for (k in file || {}) if (Object.prototype.hasOwnProperty.call(file, k)) seen[k] = 1;
        for (k in seen) {
            if (!Object.prototype.hasOwnProperty.call(seen, k)) continue;
            if (isAuxKey(k)) continue;
            var v = mergeValue(k, parseVal(cur ? cur[k] : undefined), parseVal(file ? file[k] : undefined));
            if (v === undefined) continue;
            out[k] = (typeof v === "string") ? v : JSON.stringify(v);
        }
        return out;
    }

    /* 难度与系列清单挂到 Store 上，供界面层复用同一份定义 */
    Store.DIFFS = DIFFS;
    Store.SERIES = SERIES;

    /**
     * 当前本地存档的画像。
     * @returns {Object} 画像对象，字段见 profile()
     */
    Store.profile = function() {
        return profile(Store.exportAll().data);
    };

    /**
     * 某个存档文件（payload）的画像；结构不合法时返回 null。
     * @param {Object} payload 导出结构
     * @returns {?Object} 画像对象
     */
    Store.profileOf = function(payload) {
        if (!payload || !isObj(payload.data)) return null;
        return profile(payload.data);
    };

    /**
     * 按保守规则试算"合并后"的存档内容与画像，只用于预览、不落盘。
     * @param {Object} payload 导出结构
     * @returns {{data:Object,profile:Object}} 合并结果与对应画像
     */
    Store.previewMerge = function(payload) {
        var merged = mergeData(Store.exportAll().data, (payload && payload.data) || {});
        return { data: merged, profile: profile(merged) };
    };

    /**
     * 生成一份"合并后"的完整导出结构，交给 importAll({merge:true}) 落盘。
     * @param {Object} payload 导出结构
     * @returns {Object} 带 merged 标记的导出结构
     */
    Store.buildMergedPayload = function(payload) {
        var merged = mergeData(Store.exportAll().data, (payload && payload.data) || {});
        return {
            app: "reverse-minesweeper",
            schema: Store.schema,
            exportedAt: new Date().toISOString(),
            merged: true,
            data: merged
        };
    };

    /* ---------- 8. 导入前快照与回退 ---------- */

    /**
     * 把当前全部受管存档复制一份到 __pre 快照键，并记录快照时间。
     * @returns {number} 写入快照的键数量
     * @sideeffect 写 rmPreImportAt、rmPreImportISO 与各 __pre 键
     */
    Store.backupCurrent = function() {
        var data = Store.exportAll().data;
        var n = 0;
        for (var k in data) {
            if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
            rawSet(k + PRE_SUFFIX, String(data[k]));
            n++;
        }
        Store.set("rmPreImportAt", String(Date.now()));
        Store.set("rmPreImportISO", new Date().toISOString());
        return n;
    };

    /**
     * 是否存有导入前快照。
     * @returns {boolean}
     */
    Store.hasBackup = function() {
        return !!Store.get("rmPreImportAt");
    };

    /**
     * 读取快照的时间信息，用于提示框展示。
     * @returns {?{at:number,iso:string}} 快照时间；没有快照时为 null
     */
    Store.backupInfo = function() {
        var t = Store.get("rmPreImportAt");
        if (!t) return null;
        return { at: parseInt(t, 10), iso: Store.get("rmPreImportISO") || "" };
    };

    /**
     * 用快照覆盖当前存档，实现"导入后反悔"。
     * @returns {number} 回退的键数量
     * @sideeffect 改写受管存档键
     */
    Store.restoreBackup = function() {
        var all = rawKeys();
        var n = 0, i, k, base;
        for (i = 0; i < all.length; i++) {
            k = all[i];
            if (!endsWith(k, PRE_SUFFIX)) continue;
            base = k.slice(0, k.length - PRE_SUFFIX.length);
            var v = Store.get(k);
            if (v === null || v === undefined) continue;
            Store.set(base, v);
            n++;
        }
        return n;
    };

    /**
     * 清除全部快照键与快照时间记录。
     * @sideeffect 删除 __pre 键与 rmPreImportAt / rmPreImportISO
     */
    Store.clearBackup = function() {
        var all = rawKeys();
        var i, k;
        for (i = 0; i < all.length; i++) {
            k = all[i];
            if (endsWith(k, PRE_SUFFIX)) rawRemove(k);
        }
        Store.remove("rmPreImportAt");
        Store.remove("rmPreImportISO");
    };

    window.Store = Store;

    /* ---------- 9. 存档结构号与迁移入口 ---------- */

    /* 读取已记录的结构号：缺失时按当前结构补写，为将来的结构迁移留出入口。
     * 存档结构号高于程序支持的结构号时只记录警告，不阻断游戏。 */
    (function() {
        var cur = parseInt(Store.get("rmSchemaVersion"), 10);
        if (isNaN(cur)) {
            // 早期存档没有结构号：视为与当前结构一致，直接补写，不改动数据
            Store.set("rmSchemaVersion", "1");
            cur = 1;
        }
        if (cur > Store.schema) {
            RM.warn("storage:schema", "存档版本(" + cur + ")高于当前程序，可能出现兼容性问题");
        }
    })();
})();

/* ---------- 10. 成绩与胜场 ---------- */

/* 各难度的最近一次用时（毫秒），受保护读取：主档损坏自动回退备份 */
let lt = Store.guard("mineLastTimes", {
    easy: null,
    medium: null,
    hard: null,
    hell: null,
    brain: null
});

/* 各难度的最快纪录（毫秒），null 表示该难度尚无纪录 */
let rec = Store.guard("mineRecords", {
    easy: null,
    medium: null,
    hard: null,
    hell: null,
    brain: null
});

/* 各难度的累计通关次数 */
let wins = Store.guard("mineWins", {
    easy: 0,
    medium: 0,
    hard: 0,
    hell: 0,
    brain: 0
});

/* 脑王解锁提示是否已展示过，避免每次启动重复弹出 */
let brainUnlockedNotified = Store.get("brainUnlockedNotified") === "true";


/* ---------- 11. 系列状态 ---------- */

/**
 * 读取系列开启状态；存储值必须是普通对象，否则返回默认状态。
 * @returns {{basic:boolean,special:boolean,physics:boolean,
 *   symmetry:boolean,tactical:boolean}}
 */
function getSeriesState() {
    let saved = Store.get("seriesState");
    if (saved) {
        try {
            const v = JSON.parse(saved);
            if (v && typeof v === "object" && !Array.isArray(v)) return v;
        } catch (e) {}
    }
    return {
        basic: true,
        special: false,
        physics: false,
        symmetry: false,
        tactical: false
    };
}

/**
 * 保存系列开启状态（走受保护写入，同时更新备份档）。
 * @param {Object} s 系列状态对象
 */
function saveSeriesState(s) {
    Store.save("seriesState", s);
}

/**
 * 读取系列解锁状态；存储值必须是普通对象，否则返回默认状态。
 * @returns {{basic:boolean,special:boolean,physics:boolean,
 *   symmetry:boolean,tactical:boolean}}
 */
function getSeriesUnlocked() {
    let saved = Store.get("seriesUnlocked");
    if (saved) {
        try {
            const v = JSON.parse(saved);
            if (v && typeof v === "object" && !Array.isArray(v)) return v;
        } catch (e) {}
    }
    return {
        basic: true,
        special: false,
        physics: false,
        symmetry: false,
        tactical: false
    };
}

/**
 * 保存系列解锁状态（走受保护写入，同时更新备份档）。
 * @param {Object} u 系列解锁对象
 */
function saveSeriesUnlocked(u) {
    Store.save("seriesUnlocked", u);
}

/* 启动时读取一次并同步到内存，界面直接读这两个变量；基础系列始终开启 */
let seriesState = getSeriesState();

/* 系列解锁状态：基础系列默认解锁，其余靠通关对应教学或挑战解锁 */
let seriesUnlocked = getSeriesUnlocked();

/* 写回内存与存档：基础系列不允许被关闭，也必须是解锁状态 */
seriesState.basic = true;

seriesUnlocked.basic = true;

saveSeriesState(seriesState);

saveSeriesUnlocked(seriesUnlocked);
