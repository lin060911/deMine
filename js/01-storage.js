/* ==========================================================================
 * 反向扫雷 · 01-storage.js
 * 职责：安全存档层（Store）+ 系列解锁状态 + 成绩/胜场
 *
 * 设计要点
 *  1. 单点封装：所有读写都经过 Store，任何一次抛错（Safari 隐私模式、
 *     配额超限、用户手工改坏某个键）都不会再让整个脚本停摆。
 *  2. 内存兜底：localStorage 完全不可用时自动降级到内存 Map，
 *     游戏本局仍然可玩，只是关掉页面不保存。
 *  3. 双份写入：重要存档（成绩/胜场/系列解锁）每次写入前把上一份好数据
 *     备份到 `<key>__bak`，读取时主档坏了自动回退备份档。
 *  4. 结构校验：读出来的对象必须通过校验器才采用，否则回退默认值。
 *  5. schema 版本 + 迁移钩子：以后改存档结构不至于炸掉老玩家。
 *  6. 导出 / 导入：一键把全部存档打包成 JSON 文件，换设备、清缓存前可备份。
 * ========================================================================== */

(function() {
    "use strict";

    var mem = Object.create(null);
    var backend = null;
    var backendName = "memory";

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

    function rawRemove(k) {
        delete mem[k];
        if (backend) {
            try {
                backend.removeItem(k);
            } catch (e) {}
        }
    }

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

    function isObj(v) {
        return !!v && typeof v === "object" && !Array.isArray(v);
    }

    function clone(v) {
        return v === undefined ? v : JSON.parse(JSON.stringify(v));
    }

    /* ---- 已知存档键白名单（导出用；不含动态生成的 tutorial_xxx，靠前缀匹配） ---- */
    var KEY_WHITELIST = [
        "mineLastTimes", "mineRecords", "mineWins",
        "brainUnlockedNotified", "brainCleared",
        "seriesState", "seriesUnlocked",
        "tutorialStep", "tutorialCompleted",
        "placeMode_v1", "mineInfluenceHint", "mineSoundSettings",
        "welcomeLastShown", "hasVisitedBefore",
        "achievementState_v1", "rmSchemaVersion"
    ];
    var KEY_PREFIX = ["tutorial_", "mine", "rm"];
    var BAK_SUFFIX = "__bak";
    var PRE_SUFFIX = "__pre";      // 导入前的自动快照
    var SIG_SUFFIX = "__sig";

    function endsWith(k, s) {
        return k.length > s.length && k.indexOf(s) === k.length - s.length;
    }

    /* 辅助键：备份 / 校验和 / 导入前快照 —— 不参与导出，也不参与覆盖时的清空 */
    function isAuxKey(k) {
        if (!k) return false;
        if (k === "rmPreImportAt" || k === "rmPreImportISO") return true;
        return endsWith(k, BAK_SUFFIX) || endsWith(k, SIG_SUFFIX) || endsWith(k, PRE_SUFFIX);
    }

    function isManagedKey(k) {
        if (!k) return false;
        if (endsWith(k, BAK_SUFFIX) || endsWith(k, PRE_SUFFIX)) return true;
        if (KEY_WHITELIST.indexOf(k) >= 0) return true;
        for (var i = 0; i < KEY_PREFIX.length; i++) {
            if (k.indexOf(KEY_PREFIX[i]) === 0) return true;
        }
        return false;
    }

    /* ---- 简易校验和：只用于发现"被手工改过"，不用于安全对抗 ---- */
    function sum(str) {
        var h = 5381, i;
        str = String(str);
        for (i = 0; i < str.length; i++) {
            h = ((h << 5) + h + str.charCodeAt(i)) | 0;
        }
        return (h >>> 0).toString(36);
    }

    var Store = {
        backend: backendName,
        available: !!backend,
        tampered: false,
        schema: 1,

        get: function(k) {
            try {
                return rawGet(k);
            } catch (e) {
                return null;
            }
        },
        set: function(k, v) {
            try {
                return rawSet(k, String(v));
            } catch (e) {
                return false;
            }
        },
        remove: function(k) {
            try {
                rawRemove(k);
            } catch (e) {}
        },

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
        setJSON: function(k, v) {
            try {
                return rawSet(k, JSON.stringify(v));
            } catch (e) {
                return false;
            }
        },

        /* ---- 受保护的读写：主档坏了自动回退备份档 ---- */
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
                // 校验和存在且不吻合 → 标记被改动过，但依然采用（没有 PVP，不惩罚玩家）
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

        save: function(k, v) {
            // 先把"上一份好数据"挪到备份位，再写新值
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

        /* ---- 导出 / 导入 ---- */
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

    /* ==========================================================================
     * 存档画像 / 合并 / 导入前快照
     * 供"导入存档"提示框做 当前 / 覆盖后 / 合并后 三列对比使用。
     *
     * 合并规则（保守，只增不减）：
     *   · 成就解锁、系列解锁、系列开关：取并集（已解锁的绝不会倒退）
     *   · 最快纪录：取更快的（数值更小）
     *   · 通关次数：取【较大值】（同一份存档反复导入不会让次数虚增）
     *   · 教学进度：取较大值
     *   · 布尔型（脑王彩蛋等）：有一个为真即为真
     *   · 其余偏好设置：以当前存档为准
     * ========================================================================== */

    var DIFFS = ["easy", "medium", "hard", "hell", "brain"];
    var SERIES = ["basic", "special", "physics", "symmetry", "tactical"];

    function parseVal(v) {
        if (v === undefined || v === null) return undefined;
        if (typeof v !== "string") return v;
        try {
            return JSON.parse(v);
        } catch (e) {
            return v;
        }
    }

    function numOr(v, d) {
        var n = Number(v);
        return isFinite(n) ? n : d;
    }

    function isTrueish(v) {
        return v === true || v === "true";
    }

    function defaultSeries() {
        return { basic: true, special: false, physics: false, symmetry: false, tactical: false };
    }

    /* ---- 把一个「键 → 值」的存档集合翻译成可读画像 ---- */
    function profile(data) {
        var d = data || {};
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

    /* ---- 单项合并 ---- */
    function mergeValue(k, a, b) {
        // a = 当前存档的值，b = 导入文件的值（undefined 表示该侧没有这一项）
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

    Store.DIFFS = DIFFS;
    Store.SERIES = SERIES;

    /* 当前存档画像 */
    Store.profile = function() {
        return profile(Store.exportAll().data);
    };

    /* 某个存档文件（payload）的画像 */
    Store.profileOf = function(payload) {
        if (!payload || !isObj(payload.data)) return null;
        return profile(payload.data);
    };

    /* 按保守规则算出"合并后"的存档内容，并给出它的画像（用于预览，不落盘） */
    Store.previewMerge = function(payload) {
        var merged = mergeData(Store.exportAll().data, (payload && payload.data) || {});
        return { data: merged, profile: profile(merged) };
    };

    /* 生成一份"合并后"的完整 payload，交给 importAll({merge:true}) 落盘 */
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

    /* ---- 导入前快照：导错了可以一键回退 ---- */
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

    Store.hasBackup = function() {
        return !!Store.get("rmPreImportAt");
    };

    Store.backupInfo = function() {
        var t = Store.get("rmPreImportAt");
        if (!t) return null;
        return { at: parseInt(t, 10), iso: Store.get("rmPreImportISO") || "" };
    };

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

    /* ---- schema 版本与迁移（当前只有 v1，留出钩子给以后） ---- */
    (function() {
        var cur = parseInt(Store.get("rmSchemaVersion"), 10);
        if (isNaN(cur)) {
            // 老存档没有版本号：视为 v1，直接补写，不做数据改动
            Store.set("rmSchemaVersion", "1");
            cur = 1;
        }
        if (cur > Store.schema) {
            RM.warn("storage:schema", "存档版本(" + cur + ")高于当前程序，可能出现兼容性问题");
        }
    })();
})();

/* ---- 成绩 / 胜场（受保护存档，坏档自动回退） ---- */
let lt = Store.guard("mineLastTimes", {
    easy: null,
    medium: null,
    hard: null,
    hell: null,
    brain: null
});

let rec = Store.guard("mineRecords", {
    easy: null,
    medium: null,
    hard: null,
    hell: null,
    brain: null
});

let wins = Store.guard("mineWins", {
    easy: 0,
    medium: 0,
    hard: 0,
    hell: 0,
    brain: 0
});

let brainUnlockedNotified = Store.get("brainUnlockedNotified") === "true";


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

function saveSeriesState(s) {
    Store.save("seriesState", s);
}

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

function saveSeriesUnlocked(u) {
    Store.save("seriesUnlocked", u);
}

let seriesState = getSeriesState();

let seriesUnlocked = getSeriesUnlocked();

seriesState.basic = true;

seriesUnlocked.basic = true;

saveSeriesState(seriesState);

saveSeriesUnlocked(seriesUnlocked);
