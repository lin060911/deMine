/* ==========================================================================
 * 模块 01 · 紧凑签名存档引擎（js/01-storage.js）
 *
 * 职责：用一个 localStorage 键承载全部游戏进度，提供"极小的体积 + 强完整性
 *   校验"的存档层。对上层暴露 Store 接口（get/set/save/
 *   guard/getJSON/setJSON/remove），因此业务模块不需要关心存档格式。
 * 依赖：00-core 的 RM（命名空间、RM.ACH_IDS、RM.warn）；window.localStorage。
 * 对外：window.Store（基础读写、受保护读写、导入导出、合并预览、导入前快照、
 *   完整性校验、存档摘要与详情、下载），以及顶层的 lt / rec / wins /
 *   hcLt / hcRec / hcWins / seriesState / seriesUnlocked 等派生状态与系列读写函数。
 *
 * 存档格式（详见 docs/SAVE-FORMAT.md）：
 *   明文数据 → 位打包 / varint 编码（成就用按 RM.ACH_IDS 推导的比特位图 + 时间差编码）
 *            → LZSS 压缩（只在更小时采用）
 *            → SHA-256 计数器流 XOR 混淆
 *            → HMAC-SHA256 签名
 *            → Base64URL，写入 rmSave；上一份完好存档写入 rmSave__bak。
 *   成就解锁时间、各难度最快用时 / 通关次数、教学与全部挑战进度都是结构化
 *   字段，不逐个占用可读 JSON 键，体积约为等价明文 JSON 的 1/3～1/4。
 *
 * 安全模型（务必理解边界）：
 *   · 签名密钥是内嵌在前端代码里的常量，因此本方案能阻止"改存档文件 / 改
 *     localStorage 数值"这类直接篡改（没有密钥就无法生成合法 HMAC），但
 *     不能阻止拿到源码后自行构造签名（纯前端存档的固有上限）。
 *   · 双槽（主档 + 上一份完好档）写入：主档被改坏 / 截断时自动回退备份。
 *   · 损坏数据不会静默进入游戏：校验失败即隔离到 rmSave__bad 并标记
 *     Store.tampered，界面上会显示"完整性异常"。
 *   · 导入文件同样验签；验签通过后按当前密钥重新签名落盘。
 *   · 不兼容早期的多键明文 JSON 存档格式；首次启动会做一次单向的旧键迁移
 *     （只读旧键生成新容器，随后删除旧键）。
 * ========================================================================== */

(function() {
    "use strict";

    /* ---------- 0. 常量与全局别名 ---------- */

    var RM = window.RM || {};

    /* localStorage 键：主档、上一份完好档、导入前快照、损坏隔离区 */
    var SAVE_KEY = "rmSave";
    var BAK_KEY = "rmSave__bak";
    var PRE_KEY = "rmSave__pre";
    var BAD_KEY = "rmSave__bad";

    /* 容器格式与数据结构号：两者独立演进，一起写进存档便于排查 */
    var FORMAT = 2;
    var SCHEMA = 2;
    /* 数据结构号：payload 首字节。版本 3 起成就位图按 RM.ACH_IDS 的实际条数
     * 计算字节数（70 条 → 9 字节）；版本 2 的旧档仍按 62 条（8 字节）解码，
     * 由 decodePayload 把版本传给 decodeAchievements，实现旧档原地兼容。 */
    var DATA_VERSION = 3;

    /* 版本 2 存档的成就条数：当时的 RM.ACH_IDS 固定 62 条（位图 8 字节）。
     * 只用于兼容分支，不随新成就增加而改变。 */
    var LEGACY_ACH_COUNT_V2 = 62;

    /* 容器布局：magic(4) + format(1) + flags(1) + payloadLen(2) + nonce(8)
     * = 16 字节头；尾部固定 32 字节 HMAC-SHA256 */
    var MAGIC = [ 0x52, 0x4d, 0x53, 0x56 ];   // "RMSV"
    var HEADER_LEN = 16;
    var MAC_LEN = 32;

    /* 签名 / 混淆密钥：拆成多段，避免出现一整条可直接搜索的字符串。
     * 修改任何一段都会让既有存档验签失败（等价于一次强制换档）。 */
    var SECRET_PARTS = [ "ReverseMinesweeper", ".sav", "e.v2.", "L1Nzy-2026-", "signed-compact" ];

    /* 难度顺序：与 00-core 的 PRE、08-ui 的成绩列表保持一致 */
    var DIFFS = [ "easy", "medium", "hard", "hell", "brain" ];
    /* 系列位序：顺序决定存档位图的 bit 序号，新增系列只能追加到数组末尾；
     * 界面展示顺序由 04-mines 的 CATEGORY.order 决定，两者互不影响。 */
    var SERIES = [ "basic", "special", "physics", "symmetry", "tactical", "poker" ];
    /* 结构化挑战进度段的写入顺序：二进制布局固定为这 4 个系列，
     * 新增系列（扑克牌）的进度改走附加 JSON 键 tutorial_poker，避免旧存档错位。 */
    var SERIES_STORED_NONBASIC = [ "special", "physics", "symmetry", "tactical" ];
    /* 挑战面板与存档汇总使用的全部非基础系列（含扑克牌），顺序与 CATEGORY.order 一致 */
    var SERIES_NONBASIC = [ "special", "physics", "poker", "symmetry", "tactical" ];

    /* 成就 id 顺序：存档位图的位序；缺失时退化为通用 JSON 保存（不失数据） */
    var ACH_IDS = (RM && Array.isArray(RM.ACH_IDS)) ? RM.ACH_IDS.slice(0) : null;

    /* 旧存档键白名单：只用于一次性迁移与清理，不作为运行时读写键 */
    var LEGACY_KEYS = [
        "mineLastTimes", "mineRecords", "mineWins",
        "brainUnlockedNotified", "brainCleared",
        "seriesState", "seriesUnlocked",
        "tutorialStep", "tutorialCompleted",
        "placeMode_v1", "mineInfluenceHint", "mineEffectPreview", "mineSoundSettings",
        "teachFinished", "welcomeLastShown", "hasVisitedBefore",
        "achievementState_v1", "rmSchemaVersion"
    ];
    var LEGACY_PREFIX = [ "tutorial_", "mine", "rm" ];

    /* 结构化字段覆盖的键：不进入"附加杂项"，避免重复存储 */
    var STRUCTURED_KEYS = {
        "mineLastTimes": 1, "mineRecords": 1, "mineWins": 1,
        "seriesState": 1, "seriesUnlocked": 1,
        "tutorialStep": 1, "tutorialCompleted": 1,
        "tutorial_special": 1, "tutorial_physics": 1, "tutorial_symmetry": 1, "tutorial_tactical": 1,
        "teachFinished": 1,
        "placeMode_v1": 1, "mineInfluenceHint": 1, "mineEffectPreview": 1, "mineSoundSettings": 1,
        "brainUnlockedNotified": 1, "brainCleared": 1,
        "hasVisitedBefore": 1, "welcomeLastShown": 1,
        "achievementState_v1": 1, "rmSchemaVersion": 1
    };

    /* 成就状态里由专用字段保存的顶层成员；其余未知成员原样放进 extras */
    var ACH_KNOWN_FIELDS = {
        "unlocked": 1, "counters": 1, "totalWins": 1, "nightWins": 1, "sharedWins": 1,
        "basicTypesUsed": 1, "lastCreateCats": 1, "lastCreateMaxMines": 1,
        "bgmAdjusted": 1, "grassUnlocked": 1, "newGameSpamV2": 1,
        "currentRunCategories": 1, "currentRunDeletes": 1, "currentRunFlawless": 1
    };

    /* ---------- 1. 通用小工具 ---------- */

    function hasOwn(o, k) {
        return Object.prototype.hasOwnProperty.call(o, k);
    }

    function isObj(v) {
        return !!v && typeof v === "object" && !Array.isArray(v);
    }

    function clone(v) {
        return v === undefined ? v : JSON.parse(JSON.stringify(v));
    }

    function numOr(v, d) {
        var n = Number(v);
        return isFinite(n) ? n : d;
    }

    function clamp(v, lo, hi) {
        v = Number(v);
        if (!isFinite(v)) return lo;
        return v < lo ? lo : v > hi ? hi : v;
    }

    function parseJSON(str, fallback) {
        if (typeof str !== "string" || str === "") return clone(fallback);
        try {
            var v = JSON.parse(str);
            return v === null || v === undefined ? clone(fallback) : v;
        } catch (e) {
            return clone(fallback);
        }
    }

    function stringify(v) {
        try {
            return JSON.stringify(v);
        } catch (e) {
            return "null";
        }
    }

    /**
     * 把任意时间表示统一换算成毫秒时间戳；无法识别时返回 0。
     * 支持：毫秒数字、秒数字、ISO 字符串、纯日期字符串。
     * @param {*} v 原始时间值
     * @returns {number} 毫秒时间戳，0 表示无效
     */
    function parseTimeMs(v) {
        if (typeof v === "number" && isFinite(v)) {
            if (v > 1e11) return Math.floor(v);        // 毫秒
            if (v > 1e8) return Math.floor(v * 1000);  // 秒
            return 0;
        }
        if (typeof v === "string" && v) {
            var t = Date.parse(v);
            return isFinite(t) ? t : 0;
        }
        return 0;
    }

    /* ---------- 2. UTF-8 编解码（不依赖 TextEncoder） ---------- */

    /**
     * 把字符串编码成 UTF-8 字节数组；孤立代理项用 U+FFFD 替代。
     * @param {string} str 输入字符串
     * @returns {Uint8Array}
     */
    function utf8Encode(str) {
        str = String(str);
        var out = [], i, c, c2, cp;
        for (i = 0; i < str.length; i++) {
            c = str.charCodeAt(i);
            if (c < 0x80) {
                out.push(c);
            } else if (c < 0x800) {
                out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
            } else if (c >= 0xd800 && c <= 0xdbff) {
                c2 = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
                if (c2 >= 0xdc00 && c2 <= 0xdfff) {
                    cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
                    out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
                        0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
                    i++;
                } else {
                    out.push(0xef, 0xbf, 0xbd);
                }
            } else if (c >= 0xdc00 && c <= 0xdfff) {
                out.push(0xef, 0xbf, 0xbd);
            } else {
                out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
            }
        }
        return new Uint8Array(out);
    }

    /**
     * 把 UTF-8 字节数组解码成字符串；非法字节用 U+FFFD 替代。
     * @param {Uint8Array} bytes 输入字节
     * @returns {string}
     */
    function utf8Decode(bytes) {
        var out = "", i = 0, n = bytes.length, c, c2, c3, c4, cp;
        while (i < n) {
            c = bytes[i++] & 0xff;
            if (c < 0x80) {
                out += String.fromCharCode(c);
            } else if ((c & 0xe0) === 0xc0) {
                c2 = bytes[i++] & 0xff;
                out += String.fromCharCode(((c & 0x1f) << 6) | (c2 & 0x3f));
            } else if ((c & 0xf0) === 0xe0) {
                c2 = bytes[i++] & 0xff;
                c3 = bytes[i++] & 0xff;
                out += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
            } else if ((c & 0xf8) === 0xf0) {
                c2 = bytes[i++] & 0xff;
                c3 = bytes[i++] & 0xff;
                c4 = bytes[i++] & 0xff;
                cp = ((c & 0x07) << 18) | ((c2 & 0x3f) << 12) |
                    ((c3 & 0x3f) << 6) | (c4 & 0x3f);
                cp -= 0x10000;
                out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
            } else {
                out += "\ufffd";
            }
        }
        return out;
    }

    function concatBytes(a, b) {
        var out = new Uint8Array(a.length + b.length);
        out.set(a, 0);
        out.set(b, a.length);
        return out;
    }

    function bytesEqual(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        var diff = 0, i;
        for (i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
        return diff === 0;
    }

    function hexOf(bytes, maxBytes) {
        var out = "", i, n = maxBytes ? Math.min(bytes.length, maxBytes) : bytes.length;
        for (i = 0; i < n; i++) out += ("0" + bytes[i].toString(16)).slice(-2);
        return out;
    }

    /* ---------- 3. SHA-256 与 HMAC-SHA256（纯 JS，同步） ---------- */

    var SHA_K = new Int32Array([
        0x428a2f98 | 0, 0x71374491 | 0, 0xb5c0fbcf | 0, 0xe9b5dba5 | 0,
        0x3956c25b | 0, 0x59f111f1 | 0, 0x923f82a4 | 0, 0xab1c5ed5 | 0,
        0xd807aa98 | 0, 0x12835b01 | 0, 0x243185be | 0, 0x550c7dc3 | 0,
        0x72be5d74 | 0, 0x80deb1fe | 0, 0x9bdc06a7 | 0, 0xc19bf174 | 0,
        0xe49b69c1 | 0, 0xefbe4786 | 0, 0x0fc19dc6 | 0, 0x240ca1cc | 0,
        0x2de92c6f | 0, 0x4a7484aa | 0, 0x5cb0a9dc | 0, 0x76f988da | 0,
        0x983e5152 | 0, 0xa831c66d | 0, 0xb00327c8 | 0, 0xbf597fc7 | 0,
        0xc6e00bf3 | 0, 0xd5a79147 | 0, 0x06ca6351 | 0, 0x14292967 | 0,
        0x27b70a85 | 0, 0x2e1b2138 | 0, 0x4d2c6dfc | 0, 0x53380d13 | 0,
        0x650a7354 | 0, 0x766a0abb | 0, 0x81c2c92e | 0, 0x92722c85 | 0,
        0xa2bfe8a1 | 0, 0xa81a664b | 0, 0xc24b8b70 | 0, 0xc76c51a3 | 0,
        0xd192e819 | 0, 0xd6990624 | 0, 0xf40e3585 | 0, 0x106aa070 | 0,
        0x19a4c116 | 0, 0x1e376c08 | 0, 0x2748774c | 0, 0x34b0bcb5 | 0,
        0x391c0cb3 | 0, 0x4ed8aa4a | 0, 0x5b9cca4f | 0, 0x682e6ff3 | 0,
        0x748f82ee | 0, 0x78a5636f | 0, 0x84c87814 | 0, 0x8cc70208 | 0,
        0x90befffa | 0, 0xa4506ceb | 0, 0xbef9a3f7 | 0, 0xc67178f2 | 0
    ]);

    function rotr(x, n) {
        return (x >>> n) | (x << (32 - n));
    }

    /**
     * 计算 SHA-256 摘要。
     * @param {Uint8Array} bytes 输入字节
     * @returns {Uint8Array} 32 字节摘要
     */
    function sha256(bytes) {
        var len = bytes.length;
        var bitHi = Math.floor(len / 0x20000000);
        var bitLo = (len << 3) >>> 0;
        var total = ((len + 9 + 63) >> 6) << 6;
        var buf = new Uint8Array(total);
        buf.set(bytes, 0);
        buf[len] = 0x80;
        buf[total - 8] = (bitHi >>> 24) & 0xff;
        buf[total - 7] = (bitHi >>> 16) & 0xff;
        buf[total - 6] = (bitHi >>> 8) & 0xff;
        buf[total - 5] = bitHi & 0xff;
        buf[total - 4] = (bitLo >>> 24) & 0xff;
        buf[total - 3] = (bitLo >>> 16) & 0xff;
        buf[total - 2] = (bitLo >>> 8) & 0xff;
        buf[total - 1] = bitLo & 0xff;

        var H = new Int32Array([
            0x6a09e667 | 0, 0xbb67ae85 | 0, 0x3c6ef372 | 0, 0xa54ff53a | 0,
            0x510e527f | 0, 0x9b05688c | 0, 0x1f83d9ab | 0, 0x5be0cd19 | 0
        ]);
        var w = new Int32Array(64);
        var off, i, s0, s1, a, b, c, d, e, f, g, h, t1, t2, ch, maj, S0, S1;

        for (off = 0; off < total; off += 64) {
            for (i = 0; i < 16; i++) {
                w[i] = ((buf[off + i * 4] << 24) | (buf[off + i * 4 + 1] << 16) |
                    (buf[off + i * 4 + 2] << 8) | buf[off + i * 4 + 3]) | 0;
            }
            for (i = 16; i < 64; i++) {
                s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
            }
            a = H[0]; b = H[1]; c = H[2]; d = H[3];
            e = H[4]; f = H[5]; g = H[6]; h = H[7];
            for (i = 0; i < 64; i++) {
                S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                ch = (e & f) ^ (~e & g);
                t1 = (h + S1 + ch + SHA_K[i] + w[i]) | 0;
                S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
                maj = (a & b) ^ (a & c) ^ (b & c);
                t2 = (S0 + maj) | 0;
                h = g; g = f; f = e; e = (d + t1) | 0;
                d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0;
            H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
            H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0;
            H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
        }

        var out = new Uint8Array(32);
        for (i = 0; i < 8; i++) {
            out[i * 4] = (H[i] >>> 24) & 0xff;
            out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
            out[i * 4 + 2] = (H[i] >>> 8) & 0xff;
            out[i * 4 + 3] = H[i] & 0xff;
        }
        return out;
    }

    /**
     * 计算 HMAC-SHA256。
     * @param {Uint8Array} key 密钥
     * @param {Uint8Array} msg 消息
     * @returns {Uint8Array} 32 字节认证标签
     */
    function hmacSha256(key, msg) {
        if (key.length > 64) key = sha256(key);
        var ipad = new Uint8Array(64), opad = new Uint8Array(64), i;
        ipad.set(key, 0);
        opad.set(key, 0);
        for (i = 0; i < 64; i++) {
            ipad[i] ^= 0x36;
            opad[i] ^= 0x5c;
        }
        return sha256(concatBytes(opad, sha256(concatBytes(ipad, msg))));
    }

    function secretText() {
        return SECRET_PARTS.join("");
    }

    var _macKey = null, _maskKey = null;
    /**
     * 取签名子密钥（惰性计算并缓存）。
     * @returns {Uint8Array}
     */
    function macKey() {
        if (!_macKey) _macKey = sha256(utf8Encode(secretText() + "|hmac-v2"));
        return _macKey;
    }
    /**
     * 取混淆子密钥（惰性计算并缓存）。
     * @returns {Uint8Array}
     */
    function maskKey() {
        if (!_maskKey) _maskKey = sha256(utf8Encode(secretText() + "|mask-v2"));
        return _maskKey;
    }

    /* ---------- 4. Base64URL、随机数与 XOR 流 ---------- */

    var B64_STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var B64_URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    /**
     * Base64URL 编码（无填充），结果可直接放进 JSON / URL。
     * @param {Uint8Array} bytes 输入字节
     * @returns {string}
     */
    function b64encode(bytes) {
        var out = "", i, b0, b1, b2;
        for (i = 0; i < bytes.length; i += 3) {
            b0 = bytes[i];
            b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
            b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
            out += B64_URL[b0 >> 2];
            out += B64_URL[((b0 & 0x03) << 4) | (b1 >> 4)];
            if (i + 1 < bytes.length) out += B64_URL[((b1 & 0x0f) << 2) | (b2 >> 6)];
            if (i + 2 < bytes.length) out += B64_URL[b2 & 0x3f];
        }
        return out;
    }

    /**
     * Base64 / Base64URL 解码（容忍填充与两种字母表）。
     * @param {string} str 编码文本
     * @returns {Uint8Array}
     */
    function b64decode(str) {
        var s = String(str).replace(/[^A-Za-z0-9\-_+/]/g, "");
        var out = new Uint8Array(Math.floor(s.length * 3 / 4) + 3);
        var op = 0, buf = 0, bits = 0, i, ch, idx;
        for (i = 0; i < s.length; i++) {
            ch = s.charAt(i);
            idx = B64_URL.indexOf(ch);
            if (idx < 0) idx = B64_STD.indexOf(ch);
            if (idx < 0) continue;
            buf = (buf << 6) | idx;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                out[op++] = (buf >> bits) & 0xff;
            }
        }
        return out.subarray(0, op);
    }

    /**
     * 生成 8 字节随机 nonce；优先使用 crypto.getRandomValues。
     * @returns {Uint8Array}
     */
    function randomNonce() {
        var out = new Uint8Array(8), i;
        try {
            if (window.crypto && window.crypto.getRandomValues) {
                window.crypto.getRandomValues(out);
                return out;
            }
        } catch (e) {}
        var t = Date.now();
        for (i = 0; i < 8; i++) {
            out[i] = (Math.random() * 256) & 0xff;
            out[i] ^= (t >>> (i * 8)) & 0xff;
        }
        return out;
    }

    /**
     * SHA-256 计数器流 XOR：用于让存档二进制不可直接肉眼/字符串检索修改。
     * @param {Uint8Array} bytes 输入字节
     * @param {Uint8Array} nonce 8 字节 nonce
     * @returns {Uint8Array} 同长度输出
     */
    function xorStream(bytes, nonce) {
        var key = maskKey();
        var out = new Uint8Array(bytes.length);
        var ctr = new Uint8Array(4);
        var off, block = 0, ks, i;
        for (off = 0; off < bytes.length; off += 32) {
            ctr[0] = (block >>> 24) & 0xff;
            ctr[1] = (block >>> 16) & 0xff;
            ctr[2] = (block >>> 8) & 0xff;
            ctr[3] = block & 0xff;
            ks = sha256(concatBytes(concatBytes(key, nonce), ctr));
            for (i = 0; i < 32 && off + i < bytes.length; i++) {
                out[off + i] = bytes[off + i] ^ ks[i];
            }
            block++;
        }
        return out;
    }

    /* ---------- 5. LZSS 压缩（减小体积） ---------- */

    /* 压缩侧的哈希表复用，避免每次保存都重新分配 16KB */
    var LZ_HEAD = new Int32Array(4096);

    /**
     * LZSS 压缩：4KB 窗口、最长 18 字节匹配、8 个 token 一个控制字节。
     * 输入很小时返回 null，由调用方决定是否采用压缩结果。
     * @param {Uint8Array} src 原始字节
     * @returns {?Uint8Array} 压缩字节；不划算或过小时返回 null
     */
    function lzCompress(src) {
        var n = src.length;
        if (n < 24) return null;
        var out = new Uint8Array(n + ((n >> 3) + 2) + 8);
        var op = 0, flagPos = 0, bit = 0;
        var head = LZ_HEAD, prev = new Int32Array(n);
        var i, h, p, tries, limit, bestLen, bestOff, len, off, k, h2;
        head.fill(-1);

        for (i = 0; i < n; i++) {
            if (bit === 0) {
                flagPos = op;
                out[op++] = 0;
            }
            bestLen = 0;
            bestOff = 0;
            if (i + 2 < n) {
                h = (((src[i] << 4) ^ (src[i + 1] << 2) ^ src[i + 2]) & 0xfff);
                p = head[h];
                tries = 0;
                limit = Math.min(18, n - i);
                while (p >= 0 && (i - p) <= 4096 && tries < 32) {
                    if (src[p + bestLen] === src[i + bestLen]) {
                        len = 0;
                        while (len < limit && src[p + len] === src[i + len]) len++;
                        if (len > bestLen) {
                            bestLen = len;
                            bestOff = i - p;
                            if (len === limit) break;
                        }
                    }
                    p = prev[p];
                    tries++;
                }
                prev[i] = head[h];
                head[h] = i;
            }
            if (bestLen >= 3) {
                out[flagPos] |= (1 << (7 - bit));
                off = bestOff - 1;
                out[op++] = ((bestLen - 3) << 4) | ((off >> 8) & 0x0f);
                out[op++] = off & 0xff;
                for (k = i + 1; k < i + bestLen && k + 2 < n; k++) {
                    h2 = (((src[k] << 4) ^ (src[k + 1] << 2) ^ src[k + 2]) & 0xfff);
                    prev[k] = head[h2];
                    head[h2] = k;
                }
                i += bestLen - 1;
            } else {
                out[op++] = src[i];
            }
            bit = (bit + 1) & 7;
        }
        return out.subarray(0, op);
    }

    /**
     * LZSS 解压；输入损坏（越界 / 回溯越界）时抛错，由上层按"存档损坏"处理。
     * @param {Uint8Array} src 压缩字节
     * @returns {Uint8Array} 原始字节
     */
    function lzDecompress(src) {
        var cap = Math.max(64, src.length * 4);
        var buf = new Uint8Array(cap);
        var op = 0, ip = 0, flags, b, t, t2, len, off, start, k;
        /**
         * 确保输出缓冲至少还能写 need 字节。
         * @param {number} need 需要的剩余空间
         */
        function ensure(need) {
            if (op + need <= buf.length) return;
            var next = new Uint8Array(Math.max(buf.length * 2, op + need + 64));
            next.set(buf.subarray(0, op), 0);
            buf = next;
        }
        while (ip < src.length) {
            flags = src[ip++];
            for (b = 7; b >= 0 && ip < src.length; b--) {
                if (flags & (1 << b)) {
                    if (ip + 1 >= src.length) throw new Error("LZ: 数据截断");
                    t = src[ip++];
                    t2 = src[ip++];
                    len = (t >> 4) + 3;
                    off = (((t & 0x0f) << 8) | t2) + 1;
                    start = op - off;
                    if (start < 0) throw new Error("LZ: 回溯越界");
                    ensure(len);
                    for (k = 0; k < len; k++) buf[op++] = buf[start + k];
                } else {
                    ensure(1);
                    buf[op++] = src[ip++];
                }
            }
        }
        return buf.subarray(0, op);
    }

    /**
     * 压缩 payload：只有明显变小时才采用，并在容器 flags 里标记。
     * @param {Uint8Array} raw 原始 payload
     * @returns {{bytes:Uint8Array, compressed:boolean}}
     */
    function packPayload(raw) {
        var comp = lzCompress(raw);
        if (comp && comp.length + 4 < raw.length) return { bytes: comp, compressed: true };
        return { bytes: raw, compressed: false };
    }

    /* ---------- 6. 二进制读写器 ---------- */

    /**
     * 写入器：自动扩容的字节缓冲，提供 u8 / u16 / u32 / varint / bytes / string。
     * @constructor
     */
    function Writer() {
        this.buf = new Uint8Array(256);
        this.len = 0;
    }
    Writer.prototype.ensure = function(n) {
        if (this.len + n <= this.buf.length) return;
        var next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n + 64));
        next.set(this.buf.subarray(0, this.len), 0);
        this.buf = next;
    };
    Writer.prototype.u8 = function(v) {
        this.ensure(1);
        this.buf[this.len++] = (Number(v) || 0) & 0xff;
        return this;
    };
    Writer.prototype.u16 = function(v) {
        this.ensure(2);
        this.buf[this.len++] = (v >>> 8) & 0xff;
        this.buf[this.len++] = v & 0xff;
        return this;
    };
    Writer.prototype.u32 = function(v) {
        this.ensure(4);
        this.buf[this.len++] = (v >>> 24) & 0xff;
        this.buf[this.len++] = (v >>> 16) & 0xff;
        this.buf[this.len++] = (v >>> 8) & 0xff;
        this.buf[this.len++] = v & 0xff;
        return this;
    };
    Writer.prototype.varint = function(v) {
        var n = Math.floor(Number(v));
        if (!isFinite(n) || n < 0) n = 0;
        if (n > 4294967295) n = 4294967295;
        do {
            var b = n % 128;
            n = Math.floor(n / 128);
            if (n > 0) b |= 0x80;
            this.u8(b);
        } while (n > 0);
        return this;
    };
    Writer.prototype.bytes = function(arr) {
        this.ensure(arr.length);
        this.buf.set(arr, this.len);
        this.len += arr.length;
        return this;
    };
    Writer.prototype.string = function(str) {
        var b = utf8Encode(str);
        this.varint(b.length);
        this.bytes(b);
        return this;
    };
    Writer.prototype.result = function() {
        return this.buf.slice(0, this.len);
    };

    /**
     * 读取器：与 Writer 对称，任何越界都抛错（视为存档损坏）。
     * @param {Uint8Array} bytes 输入字节
     * @constructor
     */
    function Reader(bytes) {
        this.b = bytes;
        this.i = 0;
    }
    Reader.prototype.left = function() {
        return this.b.length - this.i;
    };
    Reader.prototype.u8 = function() {
        if (this.i >= this.b.length) throw new Error("codec: 数据越界");
        return this.b[this.i++];
    };
    Reader.prototype.u16 = function() {
        return (this.u8() << 8) | this.u8();
    };
    Reader.prototype.u32 = function() {
        return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
    };
    Reader.prototype.varint = function() {
        var n = 0, mul = 1, b, guard = 0;
        do {
            b = this.u8();
            n += (b & 0x7f) * mul;
            mul *= 128;
            if (++guard > 6) throw new Error("codec: varint 过长");
        } while (b & 0x80);
        return n;
    };
    Reader.prototype.bytes = function(n) {
        if (n < 0 || this.i + n > this.b.length) throw new Error("codec: 数据越界");
        var out = this.b.slice(this.i, this.i + n);
        this.i += n;
        return out;
    };
    Reader.prototype.string = function() {
        var n = this.varint();
        return utf8Decode(this.bytes(n));
    };

    /* ---------- 7. 数据结构编解码：rawMap ↔ payload ---------- */

    /* rawMap：键 → 原始字符串值（例如 "true" / "0" / JSON 文本），
     * 与 Store.get 的返回值完全一致，业务模块无需感知二进制格式。 */

    function defaultSeriesObj() {
        return { basic: true, special: false, physics: false, symmetry: false, tactical: false, poker: false };
    }

    /**
     * 新存档的默认键集合：与首次启动时的可见状态一致。
     * 刻意不写入 achievementState_v1 / tutorialCompleted 等"缺省即未达成"的键。
     * @returns {Object} rawMap
     */
    function defaultRawMap() {
        var m = {};
        m.mineWins = stringify({
            easy: 0, medium: 0, hard: 0, hell: 0, brain: 0
        });
        m.mineRecords = stringify({
            easy: null, medium: null, hard: null, hell: null, brain: null
        });
        m.mineLastTimes = stringify({
            easy: null, medium: null, hard: null, hell: null, brain: null
        });
        m.seriesState = stringify(defaultSeriesObj());
        m.seriesUnlocked = stringify(defaultSeriesObj());
        m.tutorialStep = "0";
        m.tutorial_special = "0";
        m.tutorial_physics = "0";
        m.tutorial_symmetry = "0";
        m.tutorial_tactical = "0";
        // 扑克牌系列没有独立的二进制段，进度以附加 JSON 键保存（与其它 tutorial_ 键同前缀）
        m.tutorial_poker = "0";
        m.placeMode_v1 = "drag";
        m.mineInfluenceHint = "false";
        // 效果预览是默认开启的拖拽预演功能；旧存档的关闭值由 06-render 做一次性迁移
        m.mineEffectPreview = "true";
        m.mineSoundSettings = stringify({ bgm: 50, sfx: 50 });
        m.mineHardcoreMode = "false";
        /* 硬核成绩与普通成绩分开统计：形状与 mineWins / mineRecords /
         * mineLastTimes 一致，只是不参与普通成绩的展示与合并 */
        m.mineHardcoreWins = stringify({
            easy: 0, medium: 0, hard: 0, hell: 0, brain: 0
        });
        m.mineHardcoreRecords = stringify({
            easy: null, medium: null, hard: null, hell: null, brain: null
        });
        m.mineHardcoreLastTimes = stringify({
            easy: null, medium: null, hard: null, hell: null, brain: null
        });
        /* 俄罗斯方块玩法的跨局偏好与独立成绩：结构与硬核一致，
         * 只在预设难度的骨牌局记账，与普通 / 硬核成绩互不覆盖 */
        m.mineTetrisMode = "false";
        m.mineTetrisWins = stringify({
            easy: 0, medium: 0, hard: 0, hell: 0, brain: 0
        });
        m.mineTetrisRecords = stringify({
            easy: null, medium: null, hard: null, hell: null, brain: null
        });
        m.mineTetrisLastTimes = stringify({
            easy: null, medium: null, hard: null, hell: null, brain: null
        });
        return m;
    }

    function readNumOr0(v) {
        var n = numOr(v, 0);
        return n < 0 ? 0 : Math.floor(n);
    }

    /* ----- 7.1 成绩：mineWins / mineRecords / mineLastTimes ----- */

    /**
     * 编码三组成绩数据：通关次数用 varint，用时用 varint(ms+1)（0 表示无纪录）。
     * @param {Writer} w 写入器
     * @param {Object} map rawMap
     */
    function encodeRecords(w, map) {
        var wins = parseJSON(map.mineWins, {});
        var rec = parseJSON(map.mineRecords, {});
        var last = parseJSON(map.mineLastTimes, {});
        var i, d, v;
        for (i = 0; i < DIFFS.length; i++) w.varint(readNumOr0(wins[DIFFS[i]]));
        for (i = 0; i < DIFFS.length; i++) {
            d = DIFFS[i];
            v = (rec[d] === null || rec[d] === undefined) ? null : numOr(rec[d], null);
            w.varint(v === null || v < 0 ? 0 : Math.floor(v) + 1);
        }
        for (i = 0; i < DIFFS.length; i++) {
            d = DIFFS[i];
            v = (last[d] === null || last[d] === undefined) ? null : numOr(last[d], null);
            w.varint(v === null || v < 0 ? 0 : Math.floor(v) + 1);
        }
    }

    /**
     * 解码三组成绩数据，写入 rawMap（总是补齐 5 个难度键）。
     * @param {Reader} r 读取器
     * @param {Object} map 目标 rawMap
     */
    function decodeRecords(r, map) {
        var wins = {}, rec = {}, last = {}, i, d, v;
        for (i = 0; i < DIFFS.length; i++) wins[DIFFS[i]] = r.varint();
        for (i = 0; i < DIFFS.length; i++) {
            v = r.varint();
            rec[DIFFS[i]] = v === 0 ? null : v - 1;
        }
        for (i = 0; i < DIFFS.length; i++) {
            v = r.varint();
            last[DIFFS[i]] = v === 0 ? null : v - 1;
        }
        map.mineWins = stringify(wins);
        map.mineRecords = stringify(rec);
        map.mineLastTimes = stringify(last);
    }

    /* ----- 7.2 成就：比特位图 + 时间差 + 计数 ----- */

    function achFlagSet(s, name) {
        return !!(s && s[name]);
    }

    /**
     * 编码成就状态：按 ACH_IDS 推导的解锁位图、按时间排序的解锁时间、计数器、过程标记。
     * 无成就状态时写入 present=0。
     * @param {Writer} w 写入器
     * @param {Object} map rawMap
     */
    function encodeAchievements(w, map) {
        var s = parseJSON(map.achievementState_v1, null);
        if (!isObj(s)) {
            w.u8(0);
            return;
        }
        w.u8(1);
        var flags = 0;
        if (achFlagSet(s, "lastCreateMaxMines")) flags |= 1;
        if (achFlagSet(s, "bgmAdjusted")) flags |= 2;
        if (achFlagSet(s, "grassUnlocked")) flags |= 4;
        if (achFlagSet(s, "newGameSpamV2")) flags |= 8;
        w.u8(flags);

        var cats = isObj(s.lastCreateCats) ? s.lastCreateCats : null;
        var catMask = 0;
        if (cats) {
            catMask = 1;
            if (cats.physics) catMask |= 2;
            if (cats.symmetry) catMask |= 4;
            if (cats.tactical) catMask |= 8;
        }
        w.u8(catMask);
        w.varint(readNumOr0(s.totalWins));
        w.varint(readNumOr0(s.nightWins));
        w.varint(readNumOr0(s.sharedWins));

        var unlocked = isObj(s.unlocked) ? s.unlocked : {};
        var ids = ACH_IDS || [];
        var bits = new Uint8Array(Math.ceil(ids.length / 8));
        var entries = [];
        var unknownUnlocked = {};
        var i, id, ts;
        for (i = 0; i < ids.length; i++) {
            id = ids[i];
            if (!hasOwn(unlocked, id)) continue;
            bits[i >> 3] |= (1 << (i & 7));
            ts = parseTimeMs(unlocked[id]);
            entries.push({ i: i, ts: ts > 0 ? Math.floor(ts / 1000) : 0 });
        }
        for (id in unlocked) {
            if (!hasOwn(unlocked, id)) continue;
            if (ids.indexOf(id) < 0) unknownUnlocked[id] = unlocked[id];
        }
        w.bytes(bits);
        entries.sort(function(a, b) {
            return a.ts - b.ts || a.i - b.i;
        });
        w.varint(entries.length);
        var prevTs = 0;
        for (i = 0; i < entries.length; i++) {
            w.varint(entries[i].i);
            if (i === 0) w.varint(entries[i].ts);
            else w.varint(Math.max(0, entries[i].ts - prevTs));
            prevTs = entries[i].ts;
        }

        var counters = isObj(s.counters) ? s.counters : {};
        var counterKeys = [];
        var ck;
        for (ck in counters) {
            if (!hasOwn(counters, ck)) continue;
            if (typeof counters[ck] !== "number" || !isFinite(counters[ck])) continue;
            if (counters[ck] <= 0) continue;
            counterKeys.push(ck);
        }
        w.varint(counterKeys.length);
        for (i = 0; i < counterKeys.length; i++) {
            ck = counterKeys[i];
            var idx = ids.indexOf(ck);
            if (idx >= 0) {
                w.varint(idx + 1);
            } else {
                w.varint(0);
                w.string(ck);
            }
            w.varint(Math.floor(counters[ck]));
        }

        var btu = isObj(s.basicTypesUsed) ? s.basicTypesUsed : {};
        var usedKeys = [];
        var bk;
        for (bk in btu) {
            if (hasOwn(btu, bk) && btu[bk]) usedKeys.push(bk);
        }
        usedKeys.sort();
        w.varint(usedKeys.length);
        for (i = 0; i < usedKeys.length; i++) w.string(usedKeys[i]);

        var extras = {};
        var k;
        var unlockedExtras = {};
        for (k in unknownUnlocked) {
            if (hasOwn(unknownUnlocked, k)) unlockedExtras[k] = unknownUnlocked[k];
        }
        if (Object.keys(unlockedExtras).length) extras.unlocked = unlockedExtras;
        for (k in s) {
            if (!hasOwn(s, k)) continue;
            if (ACH_KNOWN_FIELDS[k]) continue;
            if (k === "newGameClicks") continue;
            extras[k] = s[k];
        }
        w.string(stringify(extras));
    }

    /**
     * 解码成就状态；present=0 时不写入 achievementState_v1。
     * 位图字节数依赖存档版本：版本 2 按当时的 62 条固定 8 字节，版本 3 起
     * 按当前 RM.ACH_IDS 长度推导，保证旧档可以原样读入。
     * @param {Reader} r 读取器
     * @param {Object} map 目标 rawMap
     * @param {number} dataVersion payload 的数据结构号
     */
    function decodeAchievements(r, map, dataVersion) {
        if (r.u8() === 0) return;
        var flags = r.u8();
        var catMask = r.u8();
        var totalWins = r.varint();
        var nightWins = r.varint();
        var sharedWins = r.varint();
        var ids = ACH_IDS || [];
        var bitCount = dataVersion < 3 ? LEGACY_ACH_COUNT_V2 : ids.length;
        var nBytes = Math.ceil(bitCount / 8);
        var bits = r.bytes(nBytes);
        var unlocked = {}, counters = {}, basicTypesUsed = {};
        var i, idx, ts, prevTs = 0, marker, id;

        var nUnlocked = r.varint();
        if (nUnlocked > ids.length) throw new Error("codec: 成就数量越界");
        for (i = 0; i < nUnlocked; i++) {
            idx = r.varint();
            if (i === 0) {
                ts = r.varint();
            } else {
                ts = prevTs + r.varint();
            }
            prevTs = ts;
            if (idx >= ids.length) throw new Error("codec: 成就索引越界");
            unlocked[ids[idx]] = new Date((ts > 0 ? ts : 0) * 1000).toISOString();
        }
        var nCounters = r.varint();
        if (nCounters > 500) throw new Error("codec: 计数器数量越界");
        for (i = 0; i < nCounters; i++) {
            marker = r.varint();
            if (marker === 0) {
                id = r.string();
            } else {
                if (marker - 1 >= ids.length) throw new Error("codec: 计数器索引越界");
                id = ids[marker - 1];
            }
            counters[id] = r.varint();
        }
        var nBasic = r.varint();
        if (nBasic > 500) throw new Error("codec: 基础雷种数量越界");
        for (i = 0; i < nBasic; i++) basicTypesUsed[r.string()] = true;

        var extras = parseJSON(r.string(), {});
        if (!isObj(extras)) extras = {};

        var state = {
            unlocked: unlocked,
            counters: counters,
            totalWins: totalWins,
            nightWins: nightWins,
            sharedWins: sharedWins,
            basicTypesUsed: basicTypesUsed,
            lastCreateCats: catMask === 0 ? null : {
                physics: !!(catMask & 2),
                symmetry: !!(catMask & 4),
                tactical: !!(catMask & 8)
            },
            currentRunCategories: null,
            currentRunDeletes: 0,
            currentRunFlawless: true,
            bgmAdjusted: !!(flags & 2),
            lastCreateMaxMines: !!(flags & 1),
            grassIdleStart: 0,
            grassUnlocked: !!(flags & 4),
            newGameSpamV2: !!(flags & 8)
        };
        var k;
        for (k in extras) {
            if (!hasOwn(extras, k)) continue;
            if (k === "unlocked" && isObj(extras.unlocked)) {
                for (var uid in extras.unlocked) {
                    if (hasOwn(extras.unlocked, uid) && !hasOwn(state.unlocked, uid)) {
                        state.unlocked[uid] = extras.unlocked[uid];
                    }
                }
            } else {
                state[k] = extras[k];
            }
        }
        map.achievementState_v1 = stringify(state);
    }

    /* ----- 7.3 挑战 / 系列 / 设置 / 杂项 ----- */

    function readStep(map, key) {
        return clamp(parseInt(map[key], 10) || 0, 0, 5);
    }

    /**
     * 编码挑战进度：基础 + 4 个早期系列各 1 字节步数（0~5），再跟 1 字节完成标记。
     * 布局固定为历史版本，新增系列（扑克牌）不写入本段，改用附加 JSON 键。
     * @param {Writer} w 写入器
     * @param {Object} map rawMap
     */
    function encodeChallenges(w, map) {
        w.u8(readStep(map, "tutorialStep"));
        var i;
        for (i = 0; i < SERIES_STORED_NONBASIC.length; i++) {
            w.u8(readStep(map, "tutorial_" + SERIES_STORED_NONBASIC[i]));
        }
        var flags = 0;
        if (map.tutorialCompleted === "true") flags |= 1;
        if (map.teachFinished === "true") flags |= 2;
        w.u8(flags);
    }

    /**
     * 解码挑战进度，写入 tutorialStep / tutorial_<系列> 与完成标记。
     * 只解出二进制段内的 4 个系列；扑克牌进度由 decodeExtras 从附加 JSON 补回。
     * @param {Reader} r 读取器
     * @param {Object} map 目标 rawMap
     */
    function decodeChallenges(r, map) {
        map.tutorialStep = String(clamp(r.u8(), 0, 5));
        var i;
        for (i = 0; i < SERIES_STORED_NONBASIC.length; i++) {
            map["tutorial_" + SERIES_STORED_NONBASIC[i]] = String(clamp(r.u8(), 0, 5));
        }
        var flags = r.u8();
        if (flags & 1) map.tutorialCompleted = "true";
        if (flags & 2) map.teachFinished = "true";
    }

    function readSeriesBits(map, key, fallbackOnlyBasic) {
        var o = parseJSON(map[key], null);
        var bits = 0, i;
        if (isObj(o)) {
            for (i = 0; i < SERIES.length; i++) {
                if (o[SERIES[i]]) bits |= (1 << i);
            }
        } else if (fallbackOnlyBasic) {
            bits = 1;
        }
        /* basic 系列恒开启 / 恒解锁 */
        bits |= 1;
        return bits;
    }

    function seriesFromBits(bits) {
        var o = {};
        for (var i = 0; i < SERIES.length; i++) o[SERIES[i]] = !!(bits & (1 << i));
        o.basic = true;
        return o;
    }

    /**
     * 编码系列开关与解锁状态：各用一个 u8 位图（当前使用 6 bit，剩余位留给后续系列）。
     * @param {Writer} w 写入器
     * @param {Object} map rawMap
     */
    function encodeSeries(w, map) {
        w.u8(readSeriesBits(map, "seriesState", true));
        w.u8(readSeriesBits(map, "seriesUnlocked", true));
    }

    /**
     * 解码系列开关与解锁状态。
     * @param {Reader} r 读取器
     * @param {Object} map 目标 rawMap
     */
    function decodeSeries(r, map) {
        map.seriesState = stringify(seriesFromBits(r.u8()));
        map.seriesUnlocked = stringify(seriesFromBits(r.u8()));
    }

    /**
     * 编码设置：放置模式 + 两个开关 + 两个音量。
     * @param {Writer} w 写入器
     * @param {Object} map rawMap
     */
    function encodeSettings(w, map) {
        var flags = 0;
        if (map.placeMode_v1 === "click") flags |= 1;
        if (map.mineInfluenceHint === "true") flags |= 2;
        if (map.mineEffectPreview === "true") flags |= 4;
        w.u8(flags);
        var snd = parseJSON(map.mineSoundSettings, {});
        w.u8(clamp(numOr(snd.bgm, 50), 0, 100));
        w.u8(clamp(numOr(snd.sfx, 50), 0, 100));
    }

    /**
     * 解码设置。
     * @param {Reader} r 读取器
     * @param {Object} map 目标 rawMap
     */
    function decodeSettings(r, map) {
        var flags = r.u8();
        var bgm = clamp(r.u8(), 0, 100);
        var sfx = clamp(r.u8(), 0, 100);
        map.placeMode_v1 = (flags & 1) ? "click" : "drag";
        map.mineInfluenceHint = (flags & 2) ? "true" : "false";
        map.mineEffectPreview = (flags & 4) ? "true" : "false";
        map.mineSoundSettings = stringify({ bgm: bgm, sfx: sfx });
    }

    /**
     * 编码杂项标记与欢迎日期。
     * @param {Writer} w 写入器
     * @param {Object} map rawMap
     */
    function encodeMisc(w, map) {
        var flags = 0;
        if (map.brainUnlockedNotified === "true") flags |= 1;
        if (map.brainCleared === "true") flags |= 2;
        if (map.hasVisitedBefore === "true") flags |= 4;
        w.u8(flags);
        w.string(typeof map.welcomeLastShown === "string" ? map.welcomeLastShown.slice(0, 64) : "");
    }

    /**
     * 解码杂项标记与欢迎日期。
     * @param {Reader} r 读取器
     * @param {Object} map 目标 rawMap
     */
    function decodeMisc(r, map) {
        var flags = r.u8();
        if (flags & 1) map.brainUnlockedNotified = "true";
        if (flags & 2) map.brainCleared = "true";
        if (flags & 4) map.hasVisitedBefore = "true";
        var day = r.string();
        if (day) map.welcomeLastShown = day;
    }

    /* ----- 7.4 附加杂项：主线 / 外观 / 引导已读 / 未来未知键 ----- */

    function isAuxKey(k) {
        if (!k) return false;
        if (k === "rmPreImportAt" || k === "rmPreImportISO") return true;
        return /__(bak|sig|pre)$/.test(k) || k === SAVE_KEY || k === BAK_KEY || k === PRE_KEY || k === BAD_KEY;
    }

    function isManagedKey(k) {
        if (!k || isAuxKey(k)) return false;
        if (STRUCTURED_KEYS[k]) return true;
        if (LEGACY_KEYS.indexOf(k) >= 0) return true;
        for (var i = 0; i < LEGACY_PREFIX.length; i++) {
            if (k.indexOf(LEGACY_PREFIX[i]) === 0) return true;
        }
        return false;
    }

    /**
     * 收集未结构化键（主线、外观、引导已读等），原样以 JSON 保存。
     * @param {Object} map rawMap
     * @returns {string} 序列化后的附加数据
     */
    function encodeExtras(map) {
        var extras = {};
        var k;
        for (k in map) {
            if (!hasOwn(map, k)) continue;
            if (STRUCTURED_KEYS[k]) continue;
            if (!isManagedKey(k)) continue;
            if (typeof map[k] === "string") extras[k] = map[k];
        }
        return stringify(extras);
    }

    /**
     * 解码附加数据：只写入受管键，且不覆盖结构化字段。
     * @param {string} text JSON 文本
     * @param {Object} map 目标 rawMap
     */
    function decodeExtras(text, map) {
        var extras = parseJSON(text, {});
        if (!isObj(extras)) return;
        var k;
        for (k in extras) {
            if (!hasOwn(extras, k)) continue;
            if (!isManagedKey(k) || STRUCTURED_KEYS[k]) continue;
            if (typeof extras[k] !== "string") continue;
            if (extras[k].length > 200000) continue;
            map[k] = extras[k];
        }
    }

    /* ----- 7.5 payload 总装 ----- */

    /**
     * 把 rawMap 编码成二进制 payload。
     * @param {Object} map rawMap
     * @param {number} savedAtSec 保存时间（秒）
     * @returns {Uint8Array} payload
     */
    function encodeRawMap(map, savedAtSec) {
        var w = new Writer();
        w.u8(DATA_VERSION);
        w.u8(SCHEMA);
        w.u32(savedAtSec >>> 0);
        encodeRecords(w, map);
        encodeAchievements(w, map);
        encodeChallenges(w, map);
        encodeSeries(w, map);
        encodeSettings(w, map);
        encodeMisc(w, map);
        w.string(encodeExtras(map));
        return w.result();
    }

    /**
     * 把二进制 payload 解码成 rawMap。
     * @param {Uint8Array} payload payload
     * @returns {{rawMap:Object, savedAtSec:number}}
     */
    function decodePayload(payload) {
        var r = new Reader(payload);
        var dataVersion = r.u8();
        /* 版本 2 为旧存档（成就位图 8 字节），版本 3 起位图长度随成就条数变化；
         * 两个版本都能读入，旧档首次保存后自动写成当前版本。 */
        if (dataVersion !== DATA_VERSION && dataVersion !== DATA_VERSION - 1) {
            throw new Error("数据结构版本不兼容（v" + dataVersion + "）");
        }
        var schema = r.u8();
        if (schema > SCHEMA) {
            throw new Error("存档结构(" + schema + ")高于当前程序(" + SCHEMA + ")");
        }
        var savedAtSec = r.u32();
        var map = {};
        decodeRecords(r, map);
        decodeAchievements(r, map, dataVersion);
        decodeChallenges(r, map);
        decodeSeries(r, map);
        decodeSettings(r, map);
        decodeMisc(r, map);
        decodeExtras(r.string(), map);
        if (r.left() !== 0) {
            /* 多出来的字节通常意味着编码格式不一致或数据损坏，直接拒绝更安全 */
            throw new Error("存档尾部存在未知数据");
        }
        map.rmSchemaVersion = String(SCHEMA);
        return { rawMap: map, savedAtSec: savedAtSec };
    }

    /* ---------- 8. 容器封装：压缩 + 混淆 + 签名 ---------- */

    /**
     * 把 payload 封装成 Base64URL 存档字符串。
     * @param {Uint8Array} payload 原始 payload
     * @param {number} savedAtSec 保存时间（秒）
     * @returns {{text:string, bytes:number, payloadBytes:number, compressed:boolean}}
     */
    function sealPayload(payload, savedAtSec) {
        var packed = packPayload(payload);
        if (packed.bytes.length > 60000) throw new Error("存档体积超出容器上限");
        var nonce = randomNonce();
        var total = HEADER_LEN + packed.bytes.length + MAC_LEN;
        var env = new Uint8Array(total);
        env[0] = MAGIC[0]; env[1] = MAGIC[1]; env[2] = MAGIC[2]; env[3] = MAGIC[3];
        env[4] = FORMAT;
        env[5] = packed.compressed ? 1 : 0;
        env[6] = (packed.bytes.length >>> 8) & 0xff;
        env[7] = packed.bytes.length & 0xff;
        env.set(nonce, 8);
        var cipher = xorStream(packed.bytes, nonce);
        env.set(cipher, HEADER_LEN);
        var mac = hmacSha256(macKey(), env.subarray(0, HEADER_LEN + packed.bytes.length));
        env.set(mac, HEADER_LEN + packed.bytes.length);
        return {
            text: b64encode(env),
            bytes: total,
            payloadBytes: payload.length,
            compressed: packed.compressed,
            savedAtSec: savedAtSec
        };
    }

    /**
     * 校验并打开一个存档字符串。
     * @param {string} text Base64URL 存档
     * @returns {{ok:boolean, rawMap?:Object, savedAt?:number, code?:string,
     *   reason?:string, payloadBytes?:number, envBytes?:number, compressed?:boolean}}
     */
    function openEnvelope(text) {
        try {
            if (typeof text !== "string" || !text) {
                return { ok: false, code: "empty", reason: "没有存档数据" };
            }
            var env = b64decode(text);
            if (env.length < HEADER_LEN + MAC_LEN) {
                return { ok: false, code: "corrupt", reason: "存档长度不足（可能被截断）" };
            }
            if (env[0] !== MAGIC[0] || env[1] !== MAGIC[1] || env[2] !== MAGIC[2] || env[3] !== MAGIC[3]) {
                return { ok: false, code: "format", reason: "不是本引擎生成的存档文件" };
            }
            if (env[4] !== FORMAT) {
                return { ok: false, code: "format", reason: "存档容器版本不兼容（v" + env[4] + "）" };
            }
            var payloadLen = (env[6] << 8) | env[7];
            if (env.length !== HEADER_LEN + payloadLen + MAC_LEN) {
                return { ok: false, code: "corrupt", reason: "存档长度与头部不一致（可能被修改）" };
            }
            var expect = hmacSha256(macKey(), env.subarray(0, HEADER_LEN + payloadLen));
            var actual = env.subarray(HEADER_LEN + payloadLen);
            if (!bytesEqual(expect, actual)) {
                return { ok: false, code: "signature", reason: "存档签名校验失败（数据被修改或损坏）" };
            }
            var cipher = env.slice(HEADER_LEN, HEADER_LEN + payloadLen);
            var payload = xorStream(cipher, env.slice(8, 16));
            var compressed = !!(env[5] & 1);
            if (compressed) payload = lzDecompress(payload);
            var decoded = decodePayload(payload);
            return {
                ok: true,
                rawMap: decoded.rawMap,
                savedAt: decoded.savedAtSec,
                payloadBytes: payload.length,
                envBytes: env.length,
                compressed: compressed,
                digest: hexOf(sha256(payload), 8)
            };
        } catch (e) {
            return { ok: false, code: "corrupt", reason: e && e.message ? e.message : String(e) };
        }
    }

    /* ---------- 9. 存储后端 ---------- */

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
        var out = [], i, k;
        if (backend) {
            try {
                for (i = 0; i < backend.length; i++) {
                    k = backend.key(i);
                    if (k !== null) out.push(k);
                }
            } catch (e) {}
        }
        for (k in mem) {
            if (hasOwn(mem, k) && out.indexOf(k) < 0) out.push(k);
        }
        return out;
    }

    /* ---------- 10. 运行期状态与 load / persist ---------- */

    /* rawMap 是唯一的内存数据源：业务模块的所有读写都先落在它上面，
     * 再按需整体封装成签名容器写回后端。 */
    var rawMap = defaultRawMap();
    var lastSavedAt = 0;
    var lastEnvelope = null;

    /* 会话内是否已经发生过写入（用于区分"全新存档"与"被清空"） */
    var dirty = false;

    /**
     * 把内存 rawMap 封装并写回后端：先写主档，上一份完好的主档转入备份位。
     * @returns {boolean} 是否成功（后端不可用时仍视为成功，只是不持久）
     */
    function persist() {
        try {
            var savedAt = Math.floor(Date.now() / 1000);
            var payload = encodeRawMap(rawMap, savedAt);
            var sealed = sealPayload(payload, savedAt);
            var prev = rawGet(SAVE_KEY);
            if (prev) {
                var chk = openEnvelope(prev);
                if (chk.ok) rawSet(BAK_KEY, prev);
            }
            rawSet(SAVE_KEY, sealed.text);
            lastEnvelope = sealed;
            lastSavedAt = savedAt;
            dirty = true;
            Store.lastError = null;
            // 首次成功落盘后，"fresh" 状态应升级为 ok；迁移过的会话保留 migrated 供界面提示
            if (Store.integrity === "fresh") Store.integrity = "ok";
            return true;
        } catch (e) {
            Store.lastError = e && e.message ? e.message : String(e);
            if (RM && RM.warn) RM.warn("storage:persist", e);
            return false;
        }
    }

    /**
     * 把损坏的主档隔离保存，方便事后排查 / 手动恢复；只保留最近一份。
     * @param {string} raw 原始存档字符串
     * @param {string} reason 校验失败原因
     */
    function quarantine(raw, reason) {
        try {
            rawSet(BAD_KEY, stringify({
                at: Date.now(),
                iso: new Date().toISOString(),
                reason: reason || "",
                raw: String(raw).slice(0, 200000)
            }));
        } catch (e) {}
    }

    /**
     * 判断一次存档打开失败是否由数据结构版本不兼容引起。
     * 版本不兼容意味着旧存档无法解码，读取端会按默认值重新开始，
     * 界面据此给出一次性提示；其它失败（签名 / 截断）仍按完整性异常处理。
     * @param {Object} res openEnvelope 的返回对象
     * @returns {boolean} true 表示存档来自旧的数据结构
     */
    function isVersionRejected(res) {
        return !!(res && !res.ok && typeof res.reason === "string" &&
            res.reason.indexOf("数据结构版本不兼容") === 0);
    }

    /**
     * 读取后端存档：主档 → 备份档 → 默认值，并记录完整性状态。
     * @returns {string} "ok" / "backup" / "corrupt" / "fresh"
     */
    function load() {
        var primary = rawGet(SAVE_KEY);
        var backup = rawGet(BAK_KEY);
        var state = "fresh";
        var decoded = null;
        var reason = "";
        var versionRejected = false;

        if (primary) {
            var a = openEnvelope(primary);
            if (a.ok) {
                decoded = a;
                state = "ok";
            } else {
                reason = a.reason || "主档校验失败";
                if (isVersionRejected(a)) versionRejected = true;
                quarantine(primary, reason);
            }
        }
        if (!decoded && backup) {
            var b = openEnvelope(backup);
            if (b.ok) {
                decoded = b;
                state = "backup";
            } else {
                if (isVersionRejected(b)) versionRejected = true;
                if (!reason) reason = b.reason || "备份档校验失败";
            }
        }
        if (!decoded && (primary || backup)) {
            state = "corrupt";
        }

        rawMap = decoded ? decoded.rawMap : defaultRawMap();
        lastSavedAt = decoded && decoded.savedAt ? decoded.savedAt : 0;
        lastEnvelope = decoded ? {
            text: "",
            bytes: decoded.envBytes,
            payloadBytes: decoded.payloadBytes,
            compressed: decoded.compressed,
            savedAtSec: decoded.savedAt
        } : null;

        Store.tampered = state === "backup" || state === "corrupt";
        Store.integrity = state;
        // 只有"旧结构存档导致进度完全无法继承"时才标记，供启动层提示一次；
        // 若备份档成功接管则仍走 integrity = "backup" 的异常提示
        Store.legacyRejected = !decoded && versionRejected;
        if (reason) {
            if (RM && RM.warn) RM.warn("storage:load", reason);
        }
        return state;
    }

    /**
     * 旧存档键的一次性收集：只在新容器尚不存在时调用。
     * @returns {?Object} 旧键 → 原始字符串的映射；没有旧数据时返回 null
     */
    function collectLegacy() {
        var keys = rawKeys();
        var found = false;
        var out = {};
        var i, k;
        for (i = 0; i < keys.length; i++) {
            k = keys[i];
            if (!legacyKey(k)) continue;
            var v = rawGet(k);
            if (v === null || v === undefined) continue;
            if (k === "rmSchemaVersion" || k === "rmPreImportAt" || k === "rmPreImportISO") continue;
            out[k] = String(v);
            found = true;
        }
        return found ? out : null;
    }

    function legacyKey(k) {
        if (!k) return false;
        if (k === SAVE_KEY || k === BAK_KEY || k === PRE_KEY || k === BAD_KEY) return false;
        if (k === "rmPreImportAt" || k === "rmPreImportISO") return true;
        if (/__(bak|sig|pre)$/.test(k)) {
            /* 辅助键：只要基键属于旧白名单 / 前缀就一起清理 */
            var base = k.replace(/__(bak|sig|pre)$/, "");
            return LEGACY_KEYS.indexOf(base) >= 0 || legacyPrefixMatch(base);
        }
        if (LEGACY_KEYS.indexOf(k) >= 0) return true;
        return legacyPrefixMatch(k);
    }

    function legacyPrefixMatch(k) {
        for (var i = 0; i < LEGACY_PREFIX.length; i++) {
            if (k.indexOf(LEGACY_PREFIX[i]) === 0) return true;
        }
        return false;
    }

    /**
     * 把旧键集合规范化成新 rawMap：以默认值为底，覆盖旧值。
     * @param {Object} legacy 旧键 → 原始字符串
     * @returns {Object} rawMap
     */
    function normalizeLegacy(legacy) {
        var map = defaultRawMap();
        var k;
        for (k in legacy) {
            if (!hasOwn(legacy, k)) continue;
            if (!legacyKeyRaw(k, legacy[k])) continue;
            map[k] = String(legacy[k]);
        }
        return map;
    }

    function legacyKeyRaw(k, v) {
        if (typeof v !== "string" || v.length > 200000) return false;
        if (k === "rmSchemaVersion") return false;
        if (LEGACY_KEYS.indexOf(k) >= 0) return true;
        return legacyPrefixMatch(k);
    }

    /**
     * 启动初始化：优先"旧键 → 新容器"的一次性迁移，然后正常读取，最后清理旧键。
     * @returns {boolean} 是否发生了迁移
     */
    function initFromStorage() {
        var migrated = false;
        if (!rawGet(SAVE_KEY)) {
            var legacy = collectLegacy();
            if (legacy) {
                rawMap = normalizeLegacy(legacy);
                migrated = true;
                persist();
                if (RM && RM.warn) RM.warn("storage:migrate", "已把 v1.2.x 旧存档迁移为新版签名容器");
            }
        }
        if (!migrated) load();
        /* 旧键无论是否迁移成功都清掉：运行时只读新容器，旧键留着只会占空间 */
        var keys = rawKeys();
        for (var i = 0; i < keys.length; i++) {
            if (legacyKey(keys[i])) rawRemove(keys[i]);
        }
        if (migrated) {
            Store.integrity = "migrated";
            Store.migrated = true;
        }
        return migrated;
    }

    /* ---------- 11. Store 门面 ---------- */

    var Store = {
        backend: backendName,
        available: !!backend,
        tampered: false,
        integrity: "fresh",
        migrated: false,
        /* 旧数据结构存档被拒绝的标记：由 load 置位，供启动层提示一次 */
        legacyRejected: false,
        lastError: null,
        schema: SCHEMA,
        format: FORMAT,
        saveKey: SAVE_KEY,
        backupKey: BAK_KEY,

        /* ----- 11.1 基础读写 ----- */

        get: function(k) {
            try {
                if (typeof k !== "string" || !hasOwn(rawMap, k)) return null;
                return rawMap[k];
            } catch (e) {
                return null;
            }
        },
        set: function(k, v) {
            try {
                if (typeof k !== "string" || !isManagedKey(k)) return false;
                rawMap[k] = String(v);
                return persist();
            } catch (e) {
                Store.lastError = e && e.message ? e.message : String(e);
                return false;
            }
        },
        remove: function(k) {
            try {
                if (typeof k !== "string") return;
                delete rawMap[k];
                persist();
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
                return Store.set(k, stringify(v));
            } catch (e) {
                return false;
            }
        },

        /* ----- 11.2 受保护读写 ----- */

        /**
         * 读取一个受保护存档项：解析 + 结构校验；失败时置 tampered 并回退默认值。
         * 完整性由整个容器签名保证，这里主要防御运行期注入与逻辑错误。
         * @param {string} k 存档键
         * @param {*} fallback 默认值
         * @param {function(*):boolean} [validate] 结构校验器，默认要求普通对象
         * @returns {*} 可用的存档值
         */
        guard: function(k, fallback, validate) {
            var raw = Store.get(k);
            if (raw === null || raw === undefined || raw === "") return clone(fallback);
            var parsed = null;
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                parsed = null;
            }
            var check = validate || isObj;
            var ok = false;
            try {
                ok = parsed !== null && parsed !== undefined && check(parsed);
            } catch (e) {
                ok = false;
            }
            if (ok) return parsed;
            Store.tampered = true;
            if (RM && RM.warn) RM.warn("storage:guard", k + " 结构校验失败，已回退默认值");
            return clone(fallback);
        },
        /**
         * 保存一个受保护存档项：与 setJSON 等价，保留既有接口名。
         * @param {string} k 存档键
         * @param {*} v 待保存值
         * @returns {boolean}
         */
        save: function(k, v) {
            return Store.setJSON(k, v);
        },

        /* ----- 11.3 导出 / 导入 ----- */

        /**
         * 生成可下载的存档文件对象（紧凑签名容器 + 少量可读元信息）。
         * @returns {Object}
         */
        exportFile: function() {
            var savedAt = Math.floor(Date.now() / 1000);
            var payload = encodeRawMap(rawMap, savedAt);
            var sealed = sealPayload(payload, savedAt);
            return {
                app: RM.APP_NAME || "ReverseMinesweeper",
                schema: SCHEMA,
                format: FORMAT,
                exportedAt: new Date().toISOString(),
                encodedAt: new Date(savedAt * 1000).toISOString(),
                size: sealed.text.length,
                bytes: sealed.bytes,
                payloadBytes: sealed.payloadBytes,
                compressed: sealed.compressed,
                digest: hexOf(sha256(payload), 8),
                save: sealed.text
            };
        },

        /**
         * 用一份"部分 rawMap"覆盖默认值，生成可直接导入的导出文件对象。
         * 专供「设置 → 关于 → 测试者工具」构造测试档：只读默认值，不读写
         * 当前存档、不改变运行期状态，返回结构与 exportFile 完全一致。
         * @param {Object} partial 逻辑键 → 原始字符串 / 可 JSON 序列化的值
         * @returns {Object} 导出文件对象
         */
        exportRawMapFile: function(partial) {
            var map = defaultRawMap();
            var k;
            if (partial && typeof partial === "object") {
                for (k in partial) {
                    if (!hasOwn(partial, k)) continue;
                    if (!isManagedKey(k)) continue;
                    var v = partial[k];
                    map[k] = typeof v === "string" ? v : stringify(v);
                }
            }
            var savedAt = Math.floor(Date.now() / 1000);
            var payload = encodeRawMap(map, savedAt);
            var sealed = sealPayload(payload, savedAt);
            return {
                app: RM.APP_NAME || "ReverseMinesweeper",
                schema: SCHEMA,
                format: FORMAT,
                exportedAt: new Date().toISOString(),
                encodedAt: new Date(savedAt * 1000).toISOString(),
                size: sealed.text.length,
                bytes: sealed.bytes,
                payloadBytes: sealed.payloadBytes,
                compressed: sealed.compressed,
                digest: hexOf(sha256(payload), 8),
                save: sealed.text
            };
        },

        /**
         * 校验并解析一个存档文件对象；不写入任何存储。
         * @param {Object} payload 文件对象
         * @returns {{ok:boolean, error?:string, code?:string, rawMap?:Object,
         *   savedAt?:number, bytes?:number, payloadBytes?:number, digest?:string}}
         */
        parseFile: function(payload) {
            try {
                if (!payload || typeof payload !== "object") {
                    return { ok: false, code: "bad-file", error: "不是有效的存档文件" };
                }
                if (payload.app !== (RM.APP_NAME || "ReverseMinesweeper")) {
                    return { ok: false, code: "bad-app", error: "不是本游戏的存档文件" };
                }
                if (typeof payload.save !== "string" || !payload.save) {
                    return { ok: false, code: "bad-file", error: "存档文件缺少签名数据段" };
                }
                if (payload.format && payload.format !== FORMAT) {
                    return { ok: false, code: "format", error: "存档容器版本不兼容（v" + payload.format + "）" };
                }
                if (payload.schema && payload.schema > SCHEMA) {
                    return { ok: false, code: "schema", error: "存档来自更新的版本（schema " + payload.schema + "）" };
                }
                var opened = openEnvelope(payload.save);
                if (!opened.ok) {
                    return { ok: false, code: opened.code || "signature", error: opened.reason || "存档校验失败" };
                }
                return {
                    ok: true,
                    rawMap: opened.rawMap,
                    savedAt: opened.savedAt,
                    bytes: opened.envBytes,
                    payloadBytes: opened.payloadBytes,
                    digest: opened.digest,
                    compressed: opened.compressed
                };
            } catch (e) {
                return { ok: false, code: "corrupt", error: e && e.message ? e.message : String(e) };
            }
        },

        /**
         * 把存档文件写回本地：覆盖会整体替换，合并按"只增不减"的规则取并集。
         * @param {Object} payload 文件对象
         * @param {{merge?:boolean}} [opt] 导入选项
         * @returns {{ok:boolean,count:number,skipped:number,error:?string}}
         */
        importFile: function(payload, opt) {
            opt = opt || {};
            var res = { ok: false, count: 0, skipped: 0, error: null };
            var parsed = Store.parseFile(payload);
            if (!parsed.ok) {
                res.error = parsed.error || "存档校验失败";
                return res;
            }
            try {
                var next;
                if (opt.merge) {
                    next = mergeRawMap(rawMap, parsed.rawMap);
                } else {
                    next = sanitizeImported(parsed.rawMap);
                }
                rawMap = next;
                persist();
                // 导入的是刚验签通过的文件：当前存档已整体替换，重置完整性异常标记
                Store.tampered = false;
                Store.integrity = "ok";
                res.ok = true;
                res.count = Object.keys(parsed.rawMap).length;
                res.skipped = 0;
                return res;
            } catch (e) {
                res.error = e && e.message ? e.message : String(e);
                return res;
            }
        },

        /* ----- 11.4 兼容既有导出入口的别名（仅返回内存态，不用于文件） ----- */

        /**
         * 返回当前受管键的原始值副本（调试 / 对比用，不是导出文件格式）。
         * @returns {{app:string,schema:number,exportedAt:string,data:Object}}
         */
        exportAll: function() {
            var data = {};
            for (var k in rawMap) {
                if (hasOwn(rawMap, k) && isManagedKey(k)) data[k] = rawMap[k];
            }
            return {
                app: RM.APP_NAME || "ReverseMinesweeper",
                schema: SCHEMA,
                exportedAt: new Date().toISOString(),
                data: data
            };
        },

        /* ----- 11.5 存档画像 / 摘要 / 详情 ----- */

        profile: function() {
            return profileOfRawMap(rawMap);
        },
        profileOfFile: function(payload) {
            var parsed = Store.parseFile(payload);
            if (!parsed.ok) return null;
            return profileOfRawMap(parsed.rawMap);
        },
        previewMergeFile: function(payload) {
            var parsed = Store.parseFile(payload);
            if (!parsed.ok) return null;
            var merged = mergeRawMap(rawMap, parsed.rawMap);
            return { rawMap: merged, profile: profileOfRawMap(merged) };
        },
        buildMergedFile: function(payload) {
            var parsed = Store.parseFile(payload);
            if (!parsed.ok) return null;
            var merged = mergeRawMap(rawMap, parsed.rawMap);
            var savedAt = Math.floor(Date.now() / 1000);
            var sealed = sealPayload(encodeRawMap(merged, savedAt), savedAt);
            return {
                app: RM.APP_NAME || "ReverseMinesweeper",
                schema: SCHEMA,
                format: FORMAT,
                exportedAt: new Date().toISOString(),
                size: sealed.text.length,
                bytes: sealed.bytes,
                payloadBytes: sealed.payloadBytes,
                digest: hexOf(sha256(encodeRawMap(merged, savedAt)), 8),
                save: sealed.text
            };
        },

        /**
         * 汇总当前存档：键数量、累计胜场、体积、后端与完整性。
         * @returns {Object}
         */
        summarize: function() {
            var p = Store.profile();
            var status = Store.getStatus();
            return {
                keys: p.keys,
                wins: p.totalWins,
                backend: backendName,
                tampered: Store.tampered,
                bytes: status.size,
                payloadBytes: status.payloadBytes,
                schema: SCHEMA,
                format: FORMAT,
                integrity: Store.integrity,
                savedAt: status.savedAt,
                savedAtISO: status.savedAtISO
            };
        },

        /**
         * 读取当前存档文件状态（体积 / 保存时间 / 完整性）。
         * @returns {Object}
         */
        getStatus: function() {
            var raw = rawGet(SAVE_KEY);
            var envBytes = 0, payloadBytes = 0, savedAt = lastSavedAt, compressed = false;
            var encoded = "";
            if (raw) {
                encoded = String(raw);
                envBytes = Math.floor(encoded.length * 3 / 4);
                var opened = openEnvelope(raw);
                if (opened.ok) {
                    payloadBytes = opened.payloadBytes || 0;
                    envBytes = opened.envBytes || envBytes;
                    savedAt = opened.savedAt || savedAt;
                    compressed = !!opened.compressed;
                }
            }
            return {
                ok: !!raw,
                size: raw ? String(raw).length : 0,
                bytes: envBytes,
                payloadBytes: payloadBytes,
                compressed: compressed,
                savedAt: savedAt || 0,
                savedAtISO: savedAt ? new Date(savedAt * 1000).toISOString() : "",
                backend: backendName,
                available: !!backend,
                integrity: Store.integrity,
                tampered: Store.tampered,
                schema: SCHEMA,
                format: FORMAT,
                keys: Object.keys(rawMap).length
            };
        },

        /**
         * 重新从后端读取并验签当前主档，用于"存档详情"里的即时校验。
         * @returns {{ok:boolean, code?:string, error?:string, size?:number,
         *   savedAt?:number, savedAtISO?:string}}
         */
        verify: function() {
            var raw = rawGet(SAVE_KEY);
            if (!raw) return { ok: false, code: "missing", error: "尚未生成存档" };
            var opened = openEnvelope(raw);
            if (!opened.ok) return { ok: false, code: opened.code, error: opened.reason };
            return {
                ok: true,
                size: String(raw).length,
                bytes: opened.envBytes,
                payloadBytes: opened.payloadBytes,
                savedAt: opened.savedAt,
                savedAtISO: opened.savedAt ? new Date(opened.savedAt * 1000).toISOString() : "",
                compressed: opened.compressed
            };
        },

        /**
         * 生成"存档详情"所需的完整结构化数据（成绩 / 成就时间 / 挑战进度等）。
         * @returns {Object}
         */
        inspect: function() {
            var records = readRecords(rawMap);
            var ach = readAchievementSummary(rawMap);
            var ch = readChallengeSummary(rawMap);
            var series = readSeriesSummary(rawMap);
            var status = Store.getStatus();
            var extras = [];
            for (var k in rawMap) {
                if (!hasOwn(rawMap, k)) continue;
                if (STRUCTURED_KEYS[k]) continue;
                extras.push(k);
            }
            extras.sort();
            return {
                meta: {
                    schema: SCHEMA,
                    format: FORMAT,
                    backend: backendName,
                    available: !!backend,
                    integrity: Store.integrity,
                    tampered: Store.tampered,
                    size: status.size,
                    bytes: status.bytes,
                    payloadBytes: status.payloadBytes,
                    compressed: status.compressed,
                    savedAt: status.savedAt,
                    savedAtISO: status.savedAtISO,
                    keys: status.keys,
                    migrated: Store.migrated
                },
                records: records.list,
                hardcore: { total: records.hcTotal, records: records.hcList },
                tetris: { total: records.tetTotal, records: records.tetList },
                achievements: ach,
                challenges: ch.list,
                teaching: { done: ch.teachingDone, total: 12 },
                series: series,
                settings: {
                    placeMode: rawMap.placeMode_v1 === "click" ? "click" : "drag",
                    influenceHint: rawMap.mineInfluenceHint === "true",
                    effectPreview: rawMap.mineEffectPreview === "true",
                    sound: parseJSON(rawMap.mineSoundSettings, { bgm: 50, sfx: 50 })
                },
                extras: extras
            };
        },

        /* ----- 11.6 导入前快照 / 撤销 ----- */

        /**
         * 把当前存档复制一份到导入前快照位，导入后可一键回退。
         * @returns {number} 快照覆盖的受管键数量
         */
        backupCurrent: function() {
            try {
                var raw = rawGet(SAVE_KEY);
                if (!raw) {
                    var payload = encodeRawMap(rawMap, Math.floor(Date.now() / 1000));
                    raw = sealPayload(payload, Math.floor(Date.now() / 1000)).text;
                }
                var snapshot = {
                    at: Date.now(),
                    iso: new Date().toISOString(),
                    save: raw
                };
                rawSet(PRE_KEY, stringify(snapshot));
                /* 快照时间只保存在 PRE_KEY 内部；这里不额外写辅助键，
                 * 避免绕开受管键规则产生无意义的散键 */
                return Object.keys(rawMap).length;
            } catch (e) {
                Store.lastError = e && e.message ? e.message : String(e);
                return 0;
            }
        },
        hasBackup: function() {
            return !!rawGet(PRE_KEY);
        },
        backupInfo: function() {
            var raw = rawGet(PRE_KEY);
            if (!raw) return null;
            var snap = parseJSON(raw, null);
            if (!isObj(snap) || !snap.save) return null;
            return { at: numOr(snap.at, 0), iso: typeof snap.iso === "string" ? snap.iso : "" };
        },
        restoreBackup: function() {
            try {
                var raw = rawGet(PRE_KEY);
                if (!raw) return 0;
                var snap = parseJSON(raw, null);
                if (!isObj(snap) || typeof snap.save !== "string") return 0;
                var opened = openEnvelope(snap.save);
                if (!opened.ok) {
                    Store.lastError = opened.reason || "快照校验失败";
                    return 0;
                }
                rawMap = opened.rawMap;
                persist();
                // 快照本身通过验签：回退后主档的异常标记清空
                Store.tampered = false;
                Store.integrity = "ok";
                return Object.keys(rawMap).length;
            } catch (e) {
                Store.lastError = e && e.message ? e.message : String(e);
                return 0;
            }
        },
        clearBackup: function() {
            rawRemove(PRE_KEY);
            Store.remove("rmPreImportAt");
            Store.remove("rmPreImportISO");
        },

        /* ----- 11.7 清空 / 下载 / 调试导出 ----- */

        /**
         * 清空全部存档数据；不立即重新落盘，由调用方刷新页面。
         */
        clearAll: function() {
            rawRemove(SAVE_KEY);
            rawRemove(BAK_KEY);
            rawRemove(PRE_KEY);
            rawRemove(BAD_KEY);
            rawMap = defaultRawMap();
            lastSavedAt = 0;
            lastEnvelope = null;
            Store.tampered = false;
            Store.integrity = "fresh";
            Store.lastError = null;
        },

        /**
         * 触发浏览器下载一个文本文件。
         * @param {string} filename 文件名
         * @param {string} text 文件内容
         * @returns {boolean} 是否成功发起下载
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
         * 返回受管键的浅拷贝（调试、导入对比与自动测试使用）。
         * @returns {Object}
         */
        raw: function() {
            var out = {};
            for (var k in rawMap) {
                if (hasOwn(rawMap, k)) out[k] = rawMap[k];
            }
            return out;
        },

        /* 仅测试 / 排障使用：只暴露不涉及签名密钥的编解码原语。
         * 刻意不暴露 sealPayload：它是唯一能用内嵌密钥生成合法签名的入口，
         * 暴露到 console 会显著降低伪造存档的门槛。 */
        _internals: {
            sha256: sha256,
            hmacSha256: hmacSha256,
            b64encode: b64encode,
            b64decode: b64decode,
            lzCompress: lzCompress,
            lzDecompress: lzDecompress,
            encodeRawMap: encodeRawMap,
            decodePayload: decodePayload,
            openEnvelope: openEnvelope,
            mergeRawMap: function(a, b) {
                return mergeRawMap(a, b);
            },
            profileOfRawMap: function(m) {
                return profileOfRawMap(m);
            }
        }
    };

    /* ---------- 12. 存档画像 / 合并 / 校验辅助 ---------- */

    /**
     * 解析三组成绩数据，返回列表形式。
     * @param {Object} map rawMap
     * @returns {{list:Array, wins:Object, rec:Object, last:Object, total:number}}
     */
    function readRecords(map) {
        var wins = parseJSON(map.mineWins, {});
        var rec = parseJSON(map.mineRecords, {});
        var last = parseJSON(map.mineLastTimes, {});
        var list = [], total = 0, i, d, w, r, l;
        for (i = 0; i < DIFFS.length; i++) {
            d = DIFFS[i];
            w = readNumOr0(wins[d]);
            r = (rec[d] === null || rec[d] === undefined) ? null : readNumOr0(rec[d]);
            l = (last[d] === null || last[d] === undefined) ? null : readNumOr0(last[d]);
            total += w;
            list.push({ key: d, wins: w, best: r, last: l });
        }
        /* 硬核成绩与普通成绩结构一致，单独汇总后供存档对比 / 详情展示，
         * 不并入普通成绩，避免"覆盖后丢失"的判定把两者混在一起 */
        var hcWins = parseJSON(map.mineHardcoreWins, {});
        var hcRec = parseJSON(map.mineHardcoreRecords, {});
        var hcLast = parseJSON(map.mineHardcoreLastTimes, {});
        var hcList = [], hcTotal = 0;
        for (i = 0; i < DIFFS.length; i++) {
            d = DIFFS[i];
            w = readNumOr0(hcWins[d]);
            r = (hcRec[d] === null || hcRec[d] === undefined) ? null : readNumOr0(hcRec[d]);
            l = (hcLast[d] === null || hcLast[d] === undefined) ? null : readNumOr0(hcLast[d]);
            hcTotal += w;
            hcList.push({ key: d, wins: w, best: r, last: l });
        }
        /* 俄罗斯方块成绩与普通 / 硬核同构，单独汇总供成绩筛选、导入对比与详情展示 */
        var tetWins = parseJSON(map.mineTetrisWins, {});
        var tetRec = parseJSON(map.mineTetrisRecords, {});
        var tetLast = parseJSON(map.mineTetrisLastTimes, {});
        var tetList = [], tetTotal = 0;
        for (i = 0; i < DIFFS.length; i++) {
            d = DIFFS[i];
            w = readNumOr0(tetWins[d]);
            r = (tetRec[d] === null || tetRec[d] === undefined) ? null : readNumOr0(tetRec[d]);
            l = (tetLast[d] === null || tetLast[d] === undefined) ? null : readNumOr0(tetLast[d]);
            tetTotal += w;
            tetList.push({ key: d, wins: w, best: r, last: l });
        }
        return {
            list: list, wins: wins, rec: rec, last: last, total: total,
            hcList: hcList, hcWins: hcWins, hcRec: hcRec, hcLast: hcLast, hcTotal: hcTotal,
            tetList: tetList, tetWins: tetWins, tetRec: tetRec, tetLast: tetLast, tetTotal: tetTotal
        };
    }

    /**
     * 汇总成就：解锁数量、最早 / 最晚解锁时间与逐项时间。
     * @param {Object} map rawMap
     * @returns {Object}
     */
    function readAchievementSummary(map) {
        var s = parseJSON(map.achievementState_v1, null);
        var unlocked = (isObj(s) && isObj(s.unlocked)) ? s.unlocked : {};
        var items = [], id, at;
        var firstAt = 0, lastAt = 0;
        for (id in unlocked) {
            if (!hasOwn(unlocked, id)) continue;
            at = parseTimeMs(unlocked[id]);
            items.push({ id: id, at: at ? new Date(at).toISOString() : "", atMs: at });
            if (at) {
                if (!firstAt || at < firstAt) firstAt = at;
                if (!lastAt || at > lastAt) lastAt = at;
            }
        }
        items.sort(function(a, b) {
            return (a.atMs || 0) - (b.atMs || 0);
        });
        var total = ACH_IDS ? ACH_IDS.length : 0;
        var hidden = 0, i;
        if (ACH_IDS) {
            for (i = 0; i < items.length; i++) {
                /* 隐藏成就的判断由 13 号模块负责；这里只按 id 前缀/全量返回，
                 * 具体"隐藏已解锁数量"由界面层用 Achievements.summary() 补充 */
                if (/^hidden_|^free_20x20$|^brain_slow$|^bgm_adjust$|^new_game_spam$|^crazy_thursday$/.test(items[i].id)) hidden++;
            }
        }
        return {
            total: total,
            unlocked: items.length,
            hiddenUnlocked: hidden,
            firstAt: firstAt ? new Date(firstAt).toISOString() : "",
            lastAt: lastAt ? new Date(lastAt).toISOString() : "",
            items: items
        };
    }

    /**
     * 汇总挑战：基础 + 五个非基础系列 + 教学完成状态。
     * @param {Object} map rawMap
     * @returns {{list:Array, teachingDone:boolean, basicDone:boolean, doneCount:number}}
     */
    function readChallengeSummary(map) {
        var basic = readStep(map, "tutorialStep");
        var basicDone = map.tutorialCompleted === "true" || basic >= 5;
        var teachingDone = map.teachFinished === "true";
        var unlocked = parseJSON(map.seriesUnlocked, defaultSeriesObj());
        var list = [
            { key: "basic", step: basic, total: 5, done: basicDone, locked: false }
        ];
        var doneCount = basicDone ? 1 : 0;
        for (var i = 0; i < SERIES_NONBASIC.length; i++) {
            var c = SERIES_NONBASIC[i];
            var step = readStep(map, "tutorial_" + c);
            var done = step >= 5 || !!(isObj(unlocked) && unlocked[c]);
            if (done) doneCount++;
            list.push({
                key: c,
                step: step,
                total: 5,
                done: done,
                locked: !basicDone
            });
        }
        return {
            list: list,
            teachingDone: teachingDone,
            basicDone: basicDone,
            doneCount: doneCount
        };
    }

    /**
     * 汇总系列解锁 / 开关状态。
     * @param {Object} map rawMap
     * @returns {{state:Object, unlocked:Object, unlockedCount:number, onCount:number}}
     */
    function readSeriesSummary(map) {
        var state = parseJSON(map.seriesState, defaultSeriesObj());
        var unlocked = parseJSON(map.seriesUnlocked, defaultSeriesObj());
        var onCount = 0, unlockedCount = 0;
        if (!isObj(state)) state = defaultSeriesObj();
        if (!isObj(unlocked)) unlocked = defaultSeriesObj();
        for (var i = 0; i < SERIES.length; i++) {
            if (state[SERIES[i]]) onCount++;
            if (unlocked[SERIES[i]]) unlockedCount++;
        }
        return { state: state, unlocked: unlocked, unlockedCount: unlockedCount, onCount: onCount };
    }

    /**
     * 由 rawMap 生成可读画像（导入对比 / 摘要 / 测试共用）。
     * @param {Object} map rawMap
     * @returns {Object}
     */
    function profileOfRawMap(map) {
        var rec = readRecords(map);
        var ach = readAchievementSummary(map);
        var ch = readChallengeSummary(map);
        var series = readSeriesSummary(map);
        var tutorialTotal = ch.list[0].step;
        for (var i = 1; i < ch.list.length; i++) tutorialTotal += ch.list[i].step;
        var keys = 0, k;
        for (k in map) {
            if (hasOwn(map, k) && isManagedKey(k)) keys++;
        }
        /* 只有当前内存态能拿到真实体积 / 完整性；文件预览不读后端，避免把
         * "当前存档"的体积误当成"文件"的体积。 */
        var isCurrent = (map === rawMap);
        var status = isCurrent ? Store.getStatus() : { size: 0, payloadBytes: 0 };
        return {
            keys: keys,
            schema: SCHEMA,
            format: FORMAT,
            bytes: status.size,
            payloadBytes: status.payloadBytes,
            integrity: isCurrent ? Store.integrity : "file",
            tampered: isCurrent ? Store.tampered : false,
            totalWins: rec.total,
            wins: rec.wins,
            rec: rec.rec,
            last: rec.last,
            records: rec.list,
            hcTotal: rec.hcTotal,
            hcWins: rec.hcWins,
            hcRec: rec.hcRec,
            hcLast: rec.hcLast,
            hcRecords: rec.hcList,
            tetTotal: rec.tetTotal,
            tetWins: rec.tetWins,
            tetRec: rec.tetRec,
            tetLast: rec.tetLast,
            tetRecords: rec.tetList,
            achCount: ach.unlocked,
            achTotal: ach.total,
            achFirstAt: ach.firstAt,
            achLastAt: ach.lastAt,
            achievements: ach,
            seriesUnlocked: series.unlockedCount,
            seriesOn: series.onCount,
            tutorialTotal: tutorialTotal,
            challenges: ch.list,
            challengesDone: ch.doneCount,
            teachingDone: ch.teachingDone,
            basicDone: ch.basicDone,
            brainCleared: map.brainCleared === "true",
            tutorialCompleted: ch.basicDone
        };
    }

    /**
     * 合并两份 rawMap（保守，只增不减）：
     *   · 最快纪录取更小，通关次数 / 计数取更大
     *   · 成就解锁取并集，同一成就保留更早的解锁时间
     *   · 挑战进度取更大值，系列解锁 / 开关取并集，布尔值取或
     *   · 偏好设置保持当前存档
     * @param {Object} cur 当前 rawMap
     * @param {Object} file 导入 rawMap
     * @returns {Object} 合并后的 rawMap
     */
    function mergeRawMap(cur, file) {
        cur = cur || {};
        file = file || {};
        var out = {};
        var i, d, k;
        var curWins = parseJSON(cur.mineWins, {});
        var fileWins = parseJSON(file.mineWins, {});
        var curRec = parseJSON(cur.mineRecords, {});
        var fileRec = parseJSON(file.mineRecords, {});
        var curLast = parseJSON(cur.mineLastTimes, {});
        var fileLast = parseJSON(file.mineLastTimes, {});
        var wins = {}, rec = {}, last = {};
        for (i = 0; i < DIFFS.length; i++) {
            d = DIFFS[i];
            wins[d] = Math.max(readNumOr0(curWins[d]), readNumOr0(fileWins[d]));
            rec[d] = minTime(curRec[d], fileRec[d]);
            last[d] = (curLast[d] === null || curLast[d] === undefined) ? fileLast[d] : curLast[d];
            if (last[d] === undefined) last[d] = null;
        }
        out.mineWins = stringify(wins);
        out.mineRecords = stringify(rec);
        out.mineLastTimes = stringify(last);

        /* 硬核成绩：与普通成绩同一套"只增不减"规则，避免合并导入时丢失 */
        var curHcWins = parseJSON(cur.mineHardcoreWins, {});
        var fileHcWins = parseJSON(file.mineHardcoreWins, {});
        var curHcRec = parseJSON(cur.mineHardcoreRecords, {});
        var fileHcRec = parseJSON(file.mineHardcoreRecords, {});
        var curHcLast = parseJSON(cur.mineHardcoreLastTimes, {});
        var fileHcLast = parseJSON(file.mineHardcoreLastTimes, {});
        var hcWins = {}, hcRec = {}, hcLast = {};
        for (i = 0; i < DIFFS.length; i++) {
            d = DIFFS[i];
            hcWins[d] = Math.max(readNumOr0(curHcWins[d]), readNumOr0(fileHcWins[d]));
            hcRec[d] = minTime(curHcRec[d], fileHcRec[d]);
            hcLast[d] = (curHcLast[d] === null || curHcLast[d] === undefined) ? fileHcLast[d] : curHcLast[d];
            if (hcLast[d] === undefined) hcLast[d] = null;
        }
        out.mineHardcoreWins = stringify(hcWins);
        out.mineHardcoreRecords = stringify(hcRec);
        out.mineHardcoreLastTimes = stringify(hcLast);

        /* 俄罗斯方块成绩：同样"只增不减"，避免合并导入丢失骨牌成绩 */
        var curTetWins = parseJSON(cur.mineTetrisWins, {});
        var fileTetWins = parseJSON(file.mineTetrisWins, {});
        var curTetRec = parseJSON(cur.mineTetrisRecords, {});
        var fileTetRec = parseJSON(file.mineTetrisRecords, {});
        var curTetLast = parseJSON(cur.mineTetrisLastTimes, {});
        var fileTetLast = parseJSON(file.mineTetrisLastTimes, {});
        var tetWins = {}, tetRec = {}, tetLast = {};
        for (i = 0; i < DIFFS.length; i++) {
            d = DIFFS[i];
            tetWins[d] = Math.max(readNumOr0(curTetWins[d]), readNumOr0(fileTetWins[d]));
            tetRec[d] = minTime(curTetRec[d], fileTetRec[d]);
            tetLast[d] = (curTetLast[d] === null || curTetLast[d] === undefined) ? fileTetLast[d] : curTetLast[d];
            if (tetLast[d] === undefined) tetLast[d] = null;
        }
        out.mineTetrisWins = stringify(tetWins);
        out.mineTetrisRecords = stringify(tetRec);
        out.mineTetrisLastTimes = stringify(tetLast);

        /* 成就：返回完整状态对象，避免丢失计数器与标记 */
        var mergedAch = mergeAchievementState(
            parseJSON(cur.achievementState_v1, null),
            parseJSON(file.achievementState_v1, null)
        );
        if (mergedAch) out.achievementState_v1 = stringify(mergedAch);

        /* 挑战进度取较大值；完成标记取或 */
        var curBasic = readStep(cur, "tutorialStep");
        var fileBasic = readStep(file, "tutorialStep");
        out.tutorialStep = String(Math.max(curBasic, fileBasic));
        for (i = 0; i < SERIES_NONBASIC.length; i++) {
            var key = "tutorial_" + SERIES_NONBASIC[i];
            out[key] = String(Math.max(readStep(cur, key), readStep(file, key)));
        }
        if (cur.tutorialCompleted === "true" || file.tutorialCompleted === "true") out.tutorialCompleted = "true";
        if (cur.teachFinished === "true" || file.teachFinished === "true") out.teachFinished = "true";

        /* 系列：取并集，basic 恒开启 / 恒解锁 */
        var curSS = parseJSON(cur.seriesState, defaultSeriesObj());
        var fileSS = parseJSON(file.seriesState, defaultSeriesObj());
        var curSU = parseJSON(cur.seriesUnlocked, defaultSeriesObj());
        var fileSU = parseJSON(file.seriesUnlocked, defaultSeriesObj());
        var ss = {}, su = {};
        for (i = 0; i < SERIES.length; i++) {
            var s = SERIES[i];
            ss[s] = !!(isObj(curSS) && curSS[s]) || !!(isObj(fileSS) && fileSS[s]);
            su[s] = !!(isObj(curSU) && curSU[s]) || !!(isObj(fileSU) && fileSU[s]);
        }
        ss.basic = true;
        su.basic = true;
        out.seriesState = stringify(ss);
        out.seriesUnlocked = stringify(su);

        /* 设置：以当前存档为准，文件只在当前缺失时补位 */
        var keep = [ "placeMode_v1", "mineInfluenceHint", "mineEffectPreview", "mineSoundSettings" ];
        for (i = 0; i < keep.length; i++) {
            k = keep[i];
            if (hasOwn(cur, k)) out[k] = cur[k];
            else if (hasOwn(file, k)) out[k] = file[k];
        }
        /* 杂项布尔：有一侧为真即为真；欢迎日期保留当前值 */
        var boolKeys = [ "brainUnlockedNotified", "brainCleared", "hasVisitedBefore" ];
        for (i = 0; i < boolKeys.length; i++) {
            k = boolKeys[i];
            if (cur[k] === "true" || file[k] === "true") out[k] = "true";
        }
        if (hasOwn(cur, "welcomeLastShown")) out.welcomeLastShown = cur.welcomeLastShown;
        else if (hasOwn(file, "welcomeLastShown")) out.welcomeLastShown = file.welcomeLastShown;

        /* 其余受管键：当前优先，文件补缺 */
        for (k in cur) {
            if (!hasOwn(cur, k)) continue;
            if (!isManagedKey(k)) continue;
            if (hasOwn(out, k)) continue;
            out[k] = cur[k];
        }
        for (k in file) {
            if (!hasOwn(file, k)) continue;
            if (!isManagedKey(k)) continue;
            if (hasOwn(out, k)) continue;
            out[k] = file[k];
        }
        return out;
    }

    /**
     * 两个用时取更快的那个，null 表示无纪录。
     * @param {*} a 用时 A
     * @param {*} b 用时 B
     * @returns {?number}
     */
    function minTime(a, b) {
        var an = (a === null || a === undefined) ? null : numOr(a, null);
        var bn = (b === null || b === undefined) ? null : numOr(b, null);
        if (an === null) return bn;
        if (bn === null) return an;
        return Math.min(an, bn);
    }

    /**
     * 合并两份成就状态：解锁取并集（保留更早时间），计数 / 累计取更大，标记取或。
     * @param {?Object} a 当前成就状态
     * @param {?Object} b 导入成就状态
     * @returns {?Object} 合并结果；两侧都为空时返回 null
     */
    function mergeAchievementState(a, b) {
        if (!isObj(a) && !isObj(b)) return null;
        a = isObj(a) ? a : {};
        b = isObj(b) ? b : {};
        var out = {};

        /* 解锁：并集 + 更早时间 */
        var ua = isObj(a.unlocked) ? a.unlocked : {};
        var ub = isObj(b.unlocked) ? b.unlocked : {};
        var unlocked = {};
        var id;
        for (id in ua) {
            if (hasOwn(ua, id)) unlocked[id] = ua[id];
        }
        for (id in ub) {
            if (!hasOwn(ub, id)) continue;
            if (!hasOwn(unlocked, id)) {
                unlocked[id] = ub[id];
            } else {
                var ta = parseTimeMs(unlocked[id]);
                var tb = parseTimeMs(ub[id]);
                if (ta && tb) unlocked[id] = new Date(Math.min(ta, tb)).toISOString();
                else if (!ta && tb) unlocked[id] = ub[id];
            }
        }
        out.unlocked = unlocked;

        /* 计数器与基础雷种：取并集 / 最大 */
        var pickMax = function(x, y) {
            var o = {}, k;
            for (k in x) {
                if (hasOwn(x, k)) o[k] = readNumOr0(x[k]);
            }
            for (k in y) {
                if (!hasOwn(y, k)) continue;
                o[k] = Math.max(readNumOr0(o[k]), readNumOr0(y[k]));
            }
            return o;
        };
        var pickUnion = function(x, y) {
            var o = {}, k;
            for (k in x) {
                if (hasOwn(x, k) && x[k]) o[k] = true;
            }
            for (k in y) {
                if (hasOwn(y, k) && y[k]) o[k] = true;
            }
            return o;
        };
        out.counters = pickMax(isObj(a.counters) ? a.counters : {}, isObj(b.counters) ? b.counters : {});
        out.basicTypesUsed = pickUnion(isObj(a.basicTypesUsed) ? a.basicTypesUsed : {},
            isObj(b.basicTypesUsed) ? b.basicTypesUsed : {});
        /* 全类型收集集合不属于专用字段，但合并导入时同样应"只增不减"：
         * 按并集合并，避免"当前优先"丢掉另一侧已收集的雷型 */
        if (isObj(a.allTypesUsed) || isObj(b.allTypesUsed)) {
            out.allTypesUsed = pickUnion(isObj(a.allTypesUsed) ? a.allTypesUsed : {},
                isObj(b.allTypesUsed) ? b.allTypesUsed : {});
        }

        var numKeys = [ "totalWins", "nightWins", "sharedWins" ];
        for (var i = 0; i < numKeys.length; i++) {
            var nk = numKeys[i];
            out[nk] = Math.max(readNumOr0(a[nk]), readNumOr0(b[nk]));
        }
        var flagKeys = [ "lastCreateMaxMines", "bgmAdjusted", "grassUnlocked", "newGameSpamV2" ];
        for (i = 0; i < flagKeys.length; i++) out[flagKeys[i]] = !!(a[flagKeys[i]] || b[flagKeys[i]]);
        var ca = isObj(a.lastCreateCats) ? a.lastCreateCats : null;
        var cb = isObj(b.lastCreateCats) ? b.lastCreateCats : null;
        out.lastCreateCats = (ca || cb) ? {
            physics: !!(ca && ca.physics) || !!(cb && cb.physics),
            symmetry: !!(ca && ca.symmetry) || !!(cb && cb.symmetry),
            tactical: !!(ca && ca.tactical) || !!(cb && cb.tactical)
        } : null;
        out.currentRunCategories = null;
        out.currentRunDeletes = 0;
        out.currentRunFlawless = true;

        /* 未知字段：当前优先，文件补缺；已在上方显式合并的字段不再覆盖 */
        var k;
        for (k in a) {
            if (!hasOwn(a, k)) continue;
            if (isKnownAchKey(k)) continue;
            if (hasOwn(out, k)) continue;
            out[k] = a[k];
        }
        for (k in b) {
            if (!hasOwn(b, k)) continue;
            if (isKnownAchKey(k)) continue;
            if (!hasOwn(out, k)) out[k] = b[k];
        }
        return out;
    }

    function isKnownAchKey(k) {
        return hasOwn(ACH_KNOWN_FIELDS, k);
    }

    /**
     * 把导入文件解码出的 rawMap 收敛成合法状态：只保留受管键，字符串截断。
     * @param {Object} map 文件 rawMap
     * @returns {Object}
     */
    function sanitizeImported(map) {
        var out = defaultRawMap();
        var k;
        for (k in map || {}) {
            if (!hasOwn(map, k)) continue;
            if (!isManagedKey(k)) continue;
            if (typeof map[k] !== "string") continue;
            if (map[k].length > 200000) continue;
            out[k] = map[k];
        }
        out.rmSchemaVersion = String(SCHEMA);
        return out;
    }

    /* ---------- 13. 初始化 ---------- */

    initFromStorage();
    window.Store = Store;

    /* 跨标签页篡改检测：其它标签页改了存档键时，立即重新验签并标记异常 */
    try {
        window.addEventListener("storage", function(e) {
            if (!e || (e.key !== SAVE_KEY && e.key !== BAK_KEY)) return;
            var v = Store.verify();
            if (!v.ok) {
                Store.tampered = true;
                Store.integrity = "corrupt";
                if (RM && RM.warn) RM.warn("storage:external", "检测到外部修改了存档键：" + (v.error || ""));
            }
        });
    } catch (e) {}

})();

/* ---------- 14. 成绩与胜场 ---------- */

/* 各难度的最近一次用时（毫秒），受保护读取：结构损坏自动回退备份 */
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

/* 硬核模式的最近一次用时（毫秒），与普通成绩分开统计 */
let hcLt = Store.guard("mineHardcoreLastTimes", {
    easy: null,
    medium: null,
    hard: null,
    hell: null,
    brain: null
});

/* 硬核模式各难度的最快纪录（毫秒），null 表示该难度尚无硬核纪录 */
let hcRec = Store.guard("mineHardcoreRecords", {
    easy: null,
    medium: null,
    hard: null,
    hell: null,
    brain: null
});

/* 硬核模式各难度的累计通关次数；为 0 的难度不在成绩栏显示硬核条目 */
let hcWins = Store.guard("mineHardcoreWins", {
    easy: 0,
    medium: 0,
    hard: 0,
    hell: 0,
    brain: 0
});

/* 俄罗斯方块模式的最近一次用时 / 最快纪录 / 通关次数：与普通、硬核三组成绩同构，
 * 由 08-ui 的 saveRec 在 gameTetris 局写入，成绩栏按玩法标签筛选展示 */
let tetLt = Store.guard("mineTetrisLastTimes", {
    easy: null,
    medium: null,
    hard: null,
    hell: null,
    brain: null
});

let tetRec = Store.guard("mineTetrisRecords", {
    easy: null,
    medium: null,
    hard: null,
    hell: null,
    brain: null
});

let tetWins = Store.guard("mineTetrisWins", {
    easy: 0,
    medium: 0,
    hard: 0,
    hell: 0,
    brain: 0
});

/* 脑王解锁提示是否已展示过，避免每次启动重复弹出 */
let brainUnlockedNotified = Store.get("brainUnlockedNotified") === "true";


/* ---------- 15. 系列状态 ---------- */

/**
 * 读取系列开启状态；存储值必须是普通对象，否则返回默认状态。
 * 旧存档没有扑克牌键时按「未开启」补齐，避免调用方读到 undefined。
 * @returns {{basic:boolean,special:boolean,physics:boolean,
 *   symmetry:boolean,tactical:boolean,poker:boolean}}
 */
function getSeriesState() {
    let saved = Store.get("seriesState");
    if (saved) {
        try {
            const v = JSON.parse(saved);
            if (v && typeof v === "object" && !Array.isArray(v)) {
                if (v.poker === undefined) v.poker = false;
                return v;
            }
        } catch (e) {}
    }
    return {
        basic: true,
        special: false,
        physics: false,
        symmetry: false,
        tactical: false,
        poker: false
    };
}

/**
 * 保存系列开启状态（走受保护写入，同时更新签名容器）。
 * @param {Object} s 系列状态对象
 */
function saveSeriesState(s) {
    Store.save("seriesState", s);
}

/**
 * 读取系列解锁状态；存储值必须是普通对象，否则返回默认状态。
 * 旧存档没有扑克牌键时按「未解锁」补齐，避免调用方读到 undefined。
 * @returns {{basic:boolean,special:boolean,physics:boolean,
 *   symmetry:boolean,tactical:boolean,poker:boolean}}
 */
function getSeriesUnlocked() {
    let saved = Store.get("seriesUnlocked");
    if (saved) {
        try {
            const v = JSON.parse(saved);
            if (v && typeof v === "object" && !Array.isArray(v)) {
                if (v.poker === undefined) v.poker = false;
                return v;
            }
        } catch (e) {}
    }
    return {
        basic: true,
        special: false,
        physics: false,
        symmetry: false,
        tactical: false,
        poker: false
    };
}

/**
 * 保存系列解锁状态（走受保护写入，同时更新签名容器）。
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
