/* ==========================================================================
 * 模块 15 · 启动自检与存档管理 UI（js/15-boot.js）
 *
 * 职责：在 00 ~ 14 号模块之后加载，负责四件事：
 *   1) 启动自检：确认 00 ~ 14 号模块暴露的全局对象与函数都存在；
 *      缺失只提示、不阻断启动，renderChallengeList 属于可选增强，缺失只记 warn。
 *   2) 存档状态徽章：把 Store.getStatus() / Store.verify() 的结果渲染成
 *      #saveHint 里的「完整性 / 后端 / 体积 / 保存时间」徽章，供设置侧栏展示；
 *      设置栏每次展开、以及存档写入后都可以调用 RMSave.refreshHint() 刷新。
 *   3) 导出 / 导入 / 清空 / 撤销：导出 Store.exportFile() 生成的紧凑签名容器，
 *      导入前先 Store.parseFile() 验签，再用「覆盖 / 合并 / 取消」三列对比框确认；
 *      破坏性写入前调用 Store.backupCurrent() 留快照，可一键撤销。
 *   4) 存档详情：运行时创建 #rmSaveDetailOverlay / #rmSaveDetailModal，展示
 *      存储后端、编码体积、实时验签、各难度成绩（普通 / 硬核 / 俄罗斯方块）、
 *      成就首末解锁时间与逐项时间、教学 / 基础 / 五系列挑战进度以及设置摘要。
 * 依赖：00-core 的 RM（toast / onError / warn / missingModules）、
 *       01-storage 的 Store（exportFile / parseFile / importFile / profile /
 *       profileOfFile / previewMergeFile / getStatus / verify / inspect /
 *       backupCurrent / backupInfo / restoreBackup / clearAll / download）、
 *       02-audio 的 AudioFX、13-achievements 的 window.Achievements、
 *       08-ui 的 renderChallengeList / ensureBarToggle，以及 index.html 的
 *       #SaveManage 区块（#saveFileInput / #saveHint）与 #achSidebar。
 * 对外：window.RMSave = { exportSave, importSave, pickFile, resetSave,
 *       undoImport, showDetails, refreshHint }。
 * 设计要点：
 *   1) 必须在 00 ~ 14 号模块之后加载：自检的前提是这些模块都已执行完毕。
 *   2) 验签优先：导入先 Store.parseFile() 验证 HMAC，失败只 toast、不打开弹窗；
 *      早期 {app, schema:1, data} 明文存档直接拒绝，不做迁移；旧数据结构的
 *      签名容器由 01-storage 在读取时拒绝并按默认值回退，这里只做一次提示
 *      （localStorage 里的旧键迁移由 01-storage.js 自动完成）。
 *   3) 预览优先：覆盖 / 合并前展示「当前 / 覆盖后 / 合并后」三列画像，
 *      确认后才写盘；合并路径只增不减，不做二次确认。
 *   4) 破坏性操作先留快照：写入前 Store.backupCurrent()，撤销只需一步。
 *   5) 不写样式：详情弹窗与状态徽章全部复用 style.css 第 27 段已定义的类名，
 *      JS 里不注入 <style>，也不引入 CSS 文件。
 * ========================================================================== */

(function() {
    "use strict";

    /* ---------- 1. 模块自检 ---------- */
    // 自检清单：这些全局对象与函数由 00 ~ 14 号模块在顶层声明暴露；
    // 少任何一个都会让棋盘或对局流程在后续交互中抛错，因此启动时统一核查。
    var REQUIRED = [
        "RM", "Store", "AudioFX", "RetroBGM",
        "render", "renderSlot", "genGame", "newGame", "fullReset", "checkWin",
        "startTi", "stopTi", "resetTi", "drop", "del", "clearAll",
        "renderChallengeList"
    ];

    // 可选清单：缺失时只记 warn，不计入「模块缺失」——挑战面板只是展示增强，
    // 没有它时记录栏少一块内容，但导出 / 导入 / 详情等存档功能完全不受影响。
    var OPTIONAL = { renderChallengeList: true };

    /**
     * 启动自检：逐个确认 REQUIRED 里的全局函数已定义且非 null。
     * 单项读取包在 try/catch 内，因为访问未声明的全局属性也可能抛错。
     * @returns {string[]} 缺失的必需模块名列表，空数组表示运行环境完整
     * @sideeffect 写入 RM.missingModules，并通过 RM.warn / RM.onError 报告
     */
    function selfCheck() {
        var missing = [];
        for (var i = 0; i < REQUIRED.length; i++) {
            var name = REQUIRED[i];
            var ok = false;
            try {
                ok = typeof window[name] !== "undefined" && window[name] !== null;
            } catch (e) {
                // 某些全局属性的 getter 会抛错，这种访问失败一律按缺失处理
                ok = false;
            }
            if (ok) continue;
            if (OPTIONAL[name]) {
                if (RM && RM.warn) RM.warn("boot:selfCheck", "可选模块缺失: " + name);
                continue;
            }
            missing.push(name);
        }
        // 不变量：RM.missingModules 恒等于每次自检的必需项结果，供其它模块查询
        RM.missingModules = missing;
        if (missing.length) {
            RM.onError("boot:selfCheck", "缺少模块: " + missing.join(", "));
            if (window.console) console.error("[RM] 缺少模块:", missing);
        }
        return missing;
    }

    /* ---------- 2. 小工具：格式化与安全转义 ---------- */
    // 难度键到中文名：与 01-storage.js 中 Store 的 DIFFS 顺序保持一致
    var DIFF_LABEL = { easy: "简单", medium: "中等", hard: "困难", hell: "地狱", brain: "脑王" };
    // 逐难度数据（成绩行、详情行）的展示顺序：与 01-storage.js 的 DIFFS 一致
    var DIFF_KEYS = ["easy", "medium", "hard", "hell", "brain"];

    /**
     * 数字补零。
     * @param {number} n 数字
     * @returns {string} 至少两位的字符串
     */
    function pad2(n) {
        return ("0" + n).slice(-2);
    }

    /**
     * 把任意时间表示（毫秒数 / ISO 字符串）转成毫秒数。
     * @param {*} v 时间值
     * @returns {?number} 毫秒时间戳；空值或非法值返回 null
     */
    function toMs(v) {
        if (v === null || v === undefined || v === "") return null;
        if (typeof v === "number") return isFinite(v) ? v : null;
        var t = Date.parse(String(v));
        return isNaN(t) ? null : t;
    }

    /**
     * 把毫秒格式化为 mm:ss.cc；没有成绩时统一显示「无」。
     * @param {number} ms 毫秒；null / undefined / 非有限值表示还没有纪录
     * @returns {string} 形如 "01:23.45" 的文本
     */
    function fmt(ms) {
        // 空值与非有限值都代表「没有纪录」，与页面其它位置的「无」同口径
        if (ms === null || ms === undefined) return "无";
        if (!isFinite(ms)) return "无";
        return String(Math.floor(ms / 6e4)).padStart(2, "0") + ":" +
            String(Math.floor(ms / 1e3) % 60).padStart(2, "0") + "." +
            String(Math.floor(ms % 1e3 / 10)).padStart(2, "0");
    }

    /**
     * 把毫秒数格式化为本地时区的 "YYYY-MM-DD HH:mm"。
     * @param {?number} ms 毫秒时间戳
     * @returns {string} 本地时间文本；空值 / 非法值返回「—」
     */
    function fmtLocal(ms) {
        if (ms === null || ms === undefined) return "—";
        var d = new Date(Number(ms));
        if (isNaN(d.getTime())) return "—";
        return String(d.getFullYear()) + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
            " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    }

    /**
     * 把 ISO 时间串格式化为 "YYYY-MM-DD HH:mm"（本地时区）。
     * @param {string} iso 时间串；缺失时返回「未知时间」
     * @returns {string} 本地时区下的人类可读时间，非法值原样返回
     */
    function fmtDate(iso) {
        if (!iso) return "未知时间";
        var t = toMs(iso);
        // 非法日期无法格式化，原样回显便于排查存档文件的问题
        if (t === null) return String(iso);
        return fmtLocal(t);
    }

    /**
     * 把 ISO 时间串格式化为更短的 "MM-DD HH:mm"，用于设置栏徽章。
     * @param {string} iso 时间串
     * @returns {string} 短时间文本；非法值返回「未知时间」
     */
    function fmtShort(iso) {
        var t = toMs(iso);
        if (t === null) return "未知时间";
        var d = new Date(t);
        return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    }

    /**
     * 把时间描述成「刚刚 / N 分钟前 / N 小时前 / N 天前」。
     * @param {string|number} iso ISO 时间串或毫秒时间戳
     * @returns {string} 相对时间文本
     */
    function fmtAgo(iso) {
        var t = toMs(iso);
        if (t === null) return "未知";
        var diff = Date.now() - t;
        if (diff < 0) return "刚刚";
        if (diff < 60e3) return "刚刚";
        if (diff < 36e5) return Math.floor(diff / 6e4) + " 分钟前";
        if (diff < 864e5) return Math.floor(diff / 36e5) + " 小时前";
        if (diff < 30 * 864e5) return Math.floor(diff / 864e5) + " 天前";
        return fmtDate(iso);
    }

    /**
     * 转义 HTML 特殊字符，供拼接对比表 / 详情弹窗时安全写入 innerHTML。
     * @param {*} s 任意值，内部统一转成字符串
     * @returns {string} 已转义文本
     */
    function esc(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    /**
     * 把布尔值翻译成对比表中「已达成 / 未达成」的文字。
     * @param {boolean} b 是否达成
     * @returns {string} 中文状态文本
     */
    function yn(b) {
        return b ? "已达成" : "未达成";
    }

    /**
     * 把字节数格式化为 B / KB / MB。
     * @param {number} n 字节数
     * @returns {string} 形如 "1.2 KB" 的文本
     */
    function fmtBytes(n) {
        var v = Number(n);
        if (!isFinite(v) || v <= 0) return "0 B";
        if (v < 1024) return v + " B";
        if (v < 1024 * 1024) return (v / 1024).toFixed(1) + " KB";
        return (v / 1024 / 1024).toFixed(2) + " MB";
    }

    /**
     * 描述编码后的字符数。
     * @param {number} n 字符数
     * @returns {string} 形如 "1234 字符" 的文本
     */
    function fmtChars(n) {
        var v = Number(n);
        if (!isFinite(v) || v <= 0) return "0 字符";
        return v + " 字符";
    }

    /**
     * 从异常对象里取可读消息。
     * @param {*} e 异常
     * @returns {string} 消息文本
     */
    function errMsg(e) {
        if (!e) return "未知错误";
        return e.message ? e.message : String(e);
    }

    /**
     * 生成文件名里的 YYYYMMDD 戳。
     * @returns {string} 8 位日期串
     */
    function dateStamp() {
        var d = new Date();
        return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate());
    }

    /**
     * 读取挑战系列的中文名；CATEGORY 在 04-mines.js 中定义，缺失时回退。
     * @param {string} key 系列键（special / physics / symmetry / tactical）
     * @param {string} fallback 回退名称
     * @returns {string} 形如 "🔶 异形系列" 的展示名
     */
    function catName(key, fallback) {
        try {
            if (typeof CATEGORY !== "undefined" && CATEGORY && CATEGORY[key] && CATEGORY[key].name) {
                var c = CATEGORY[key];
                return (c.emoji ? c.emoji + " " : "") + c.name;
            }
        } catch (e) {}
        return fallback || key;
    }

    /* ---------- 3. 导入提示框：弹窗骨架与三列对比表 ---------- */
    // 待确认的存档文件内容；弹窗关闭时置空，避免继续持有整份文件数据
    var pending = null;
    // 覆盖后会丢失的行数；openImportModal 时算好，onAction 的二次确认直接读取
    var pendingLoss = 0;
    // 弹窗 DOM 惰性单例：首次导入时创建一次，之后复用同一组节点
    var overlayEl = null, modalEl = null;

    /**
     * 惰性创建导入弹窗的遮罩与面板，并绑定点击行为（只执行一次）。
     * 面板内容每次打开时整体重写，因此这里只负责骨架与事件委托。
     * @sideeffect 在 body 末尾追加两个节点，并为它们注册 click 监听
     */
    function ensureModal() {
        if (modalEl) return;
        overlayEl = document.createElement("div");
        overlayEl.id = "rmImportOverlay";
        overlayEl.className = "auto-modal-overlay rm-overlay-top";
        overlayEl.style.display = "none";
        document.body.appendChild(overlayEl);

        modalEl = document.createElement("div");
        modalEl.id = "rmImportModal";
        modalEl.className = "auto-modal rm-modal";
        modalEl.style.display = "none";
        document.body.appendChild(modalEl);

        overlayEl.addEventListener("click", function() {
            // 点击遮罩等同于取消：直接关闭，不写任何存储
            closeModal();
        });
        modalEl.addEventListener("click", function(e) {
            // 事件委托：按钮内部还有 <b> / <small> 子节点，用 closest 找真正的按钮
            var b = e.target && e.target.closest ? e.target.closest("button[data-act]") : null;
            if (!b) return;
            onAction(b.getAttribute("data-act"));
        });
    }

    /**
     * 关闭导入弹窗并清空待确认的存档内容。
     * @sideeffect 隐藏遮罩与面板，并把 pending / pendingLoss 归零
     */
    function closeModal() {
        if (overlayEl) overlayEl.style.display = "none";
        if (modalEl) modalEl.style.display = "none";
        pending = null;
        pendingLoss = 0;
    }

    /**
     * 构造一个对比单元格：主文本 + 可选的小字说明。
     * @param {string} text 主文本
     * @param {string} [sub] 小字说明（会渲染成 .rm-sub）
     * @returns {{text:string, sub:string}}
     */
    function cell(text, sub) {
        return { text: String(text), sub: sub || "" };
    }

    /**
     * 渲染对比单元格；文本一律 esc 转义，.rm-sub 由样式表着色。
     * @param {{text:string, sub:string}} c 单元格数据
     * @returns {string} 单元格内部 HTML
     */
    function cellHtml(c) {
        var h = esc(c.text);
        if (c.sub) h += '<div class="rm-sub">' + esc(c.sub) + "</div>";
        return h;
    }

    /**
     * 生成首末解锁时间的小字说明。
     * @param {Object} p 存档画像
     * @returns {string} 形如 "首 2026-11-02 23:05 · 末 …" 的文本
     */
    function achTimeSub(p) {
        var first = p.achFirstAt ? fmtDate(p.achFirstAt) : "";
        var last = p.achLastAt ? fmtDate(p.achLastAt) : "";
        if (!first && !last) return "暂无解锁记录";
        return "首 " + (first || "—") + " · 末 " + (last || "—");
    }

    /**
     * 生成三列对比表的 HTML 片段，并统计「覆盖会丢失」的行数。
     * 表格把「当前存档 / 覆盖后 / 合并后」三个画像拼成三列，每行同时算出
     * 两个风险标记：
     *   ovLoss —— 覆盖后比当前少，该项进度会丢失（表格中标红）
     *   mgGain —— 合并后比当前多，该项进度会增加（表格中标绿）
     * @param {Object} cur 当前存档画像
     * @param {Object} ov 存档文件画像（即覆盖后的结果）
     * @param {Object} mg 合并结果画像
     * @returns {{html:string, lossCount:number}} 表格 HTML 与丢失项计数
     */
    function buildTable(cur, ov, mg) {
        var rows = [];
        var i, d;

        // 累计通关：覆盖后变少即视为丢失进度，合并后变多即视为增加
        rows.push({
            k: "累计通关",
            cur: cell(cur.totalWins + " 次"),
            ov: cell(ov.totalWins + " 次"),
            mg: cell(mg.totalWins + " 次"),
            ovLoss: ov.totalWins < cur.totalWins,
            mgGain: mg.totalWins > cur.totalWins
        });

        // 各难度：通关次数 + 最快纪录；纪录以毫秒存储，数值越小越快
        var DIFFS = DIFF_KEYS;
        for (i = 0; i < DIFFS.length; i++) {
            d = DIFFS[i];
            var cw = cur.wins[d] || 0, ow = ov.wins[d] || 0, mw = mg.wins[d] || 0;
            var cr = (cur.rec && cur.rec[d] !== undefined) ? cur.rec[d] : null;
            var orr = (ov.rec && ov.rec[d] !== undefined) ? ov.rec[d] : null;
            var mr = (mg.rec && mg.rec[d] !== undefined) ? mg.rec[d] : null;
            // 纪录为 null 表示还没有通关过；覆盖后纪录变慢或消失都算丢失
            var recLoss = (cr === null) ? false : (orr === null || orr > cr);
            var recGain = (cr === null && mr !== null) || (cr !== null && mr !== null && mr < cr);
            rows.push({
                k: DIFF_LABEL[d] || d,
                cur: cell(cw + " 次", fmt(cr)),
                ov: cell(ow + " 次", fmt(orr)),
                mg: cell(mw + " 次", fmt(mr)),
                ovLoss: ow < cw || recLoss,
                mgGain: mw > cw || recGain
            });
        }

        // 硬核成绩：与普通成绩分开统计，按难度逐行展示，参与丢失 / 增加判定
        for (i = 0; i < DIFFS.length; i++) {
            d = DIFFS[i];
            var chw = (cur.hcWins && cur.hcWins[d]) || 0;
            var ohw = (ov.hcWins && ov.hcWins[d]) || 0;
            var mhw = (mg.hcWins && mg.hcWins[d]) || 0;
            var chr = (cur.hcRec && cur.hcRec[d] !== undefined) ? cur.hcRec[d] : null;
            var ohr = (ov.hcRec && ov.hcRec[d] !== undefined) ? ov.hcRec[d] : null;
            var mhr = (mg.hcRec && mg.hcRec[d] !== undefined) ? mg.hcRec[d] : null;
            // 与普通成绩同一套判定：覆盖后次数变少、纪录变慢或消失都算丢失
            var hcRecLoss = (chr === null) ? false : (ohr === null || ohr > chr);
            var hcRecGain = (chr === null && mhr !== null) || (chr !== null && mhr !== null && mhr < chr);
            rows.push({
                k: "🪚 硬核·" + (DIFF_LABEL[d] || d),
                cur: cell(chw + " 次", fmt(chr)),
                ov: cell(ohw + " 次", fmt(ohr)),
                mg: cell(mhw + " 次", fmt(mhr)),
                ovLoss: ohw < chw || hcRecLoss,
                mgGain: mhw > chw || hcRecGain
            });
        }

        // 俄罗斯方块成绩：与硬核成绩并列独立统计，字段缺失时按 0 / 无纪录处理
        for (i = 0; i < DIFFS.length; i++) {
            d = DIFFS[i];
            var ctw = (cur.tetWins && cur.tetWins[d]) || 0;
            var otw = (ov.tetWins && ov.tetWins[d]) || 0;
            var mtw = (mg.tetWins && mg.tetWins[d]) || 0;
            var ctr = (cur.tetRec && cur.tetRec[d] !== undefined) ? cur.tetRec[d] : null;
            var otr = (ov.tetRec && ov.tetRec[d] !== undefined) ? ov.tetRec[d] : null;
            var mtr = (mg.tetRec && mg.tetRec[d] !== undefined) ? mg.tetRec[d] : null;
            // 与普通成绩同一套判定：覆盖后次数变少、纪录变慢或消失都算丢失
            var tetRecLoss = (ctr === null) ? false : (otr === null || otr > ctr);
            var tetRecGain = (ctr === null && mtr !== null) || (ctr !== null && mtr !== null && mtr < ctr);
            rows.push({
                k: "🐻 俄罗斯方块·" + (DIFF_LABEL[d] || d),
                cur: cell(ctw + " 次", fmt(ctr)),
                ov: cell(otw + " 次", fmt(otr)),
                mg: cell(mtw + " 次", fmt(mtr)),
                ovLoss: otw < ctw || tetRecLoss,
                mgGain: mtw > ctw || tetRecGain
            });
        }

        // 成就：合并只会增加，因此只要有增量就标绿
        var achDelta = mg.achCount - cur.achCount;
        rows.push({
            k: "成就解锁",
            cur: cell(cur.achCount + " 个", achTimeSub(cur)),
            ov: cell(ov.achCount + " 个", achTimeSub(ov)),
            mg: cell(mg.achCount + " 个" + (achDelta > 0 ? " (+" + achDelta + ")" : ""), achTimeSub(mg)),
            ovLoss: ov.achCount < cur.achCount,
            mgGain: achDelta > 0
        });

        // 挑战完成：基础挑战 + 五个系列挑战共 6 项，小字补充新手教学状态
        function teachSub(p) {
            return p.teachingDone ? "教学 ✅ 已完成" : "教学 未完成";
        }
        rows.push({
            k: "挑战完成",
            cur: cell(cur.challengesDone + "/" + SERIES_TOTAL, teachSub(cur)),
            ov: cell(ov.challengesDone + "/" + SERIES_TOTAL, teachSub(ov)),
            mg: cell(mg.challengesDone + "/" + SERIES_TOTAL, teachSub(mg)),
            ovLoss: ov.challengesDone < cur.challengesDone,
            mgGain: mg.challengesDone > cur.challengesDone
        });

        // 系列解锁 / 开关：上限随系列总数变化，三列统一显示 x/n 便于横向对比
        rows.push({
            k: "系列解锁",
            cur: cell(cur.seriesUnlocked + "/" + SERIES_TOTAL),
            ov: cell(ov.seriesUnlocked + "/" + SERIES_TOTAL),
            mg: cell(mg.seriesUnlocked + "/" + SERIES_TOTAL),
            ovLoss: ov.seriesUnlocked < cur.seriesUnlocked,
            mgGain: mg.seriesUnlocked > cur.seriesUnlocked
        });
        rows.push({
            k: "系列开关",
            cur: cell(cur.seriesOn + "/" + SERIES_TOTAL),
            ov: cell(ov.seriesOn + "/" + SERIES_TOTAL),
            mg: cell(mg.seriesOn + "/" + SERIES_TOTAL),
            ovLoss: ov.seriesOn < cur.seriesOn,
            mgGain: mg.seriesOn > cur.seriesOn
        });

        // 教学进度：教学只持久化是否完成，没有逐关进度，因此显示完成状态
        rows.push({
            k: "教学进度",
            cur: cell(yn(cur.teachingDone)),
            ov: cell(yn(ov.teachingDone)),
            mg: cell(yn(mg.teachingDone)),
            ovLoss: !!(cur.teachingDone && !ov.teachingDone),
            mgGain: !!(mg.teachingDone && !cur.teachingDone)
        });

        // 脑王彩蛋：布尔型，合并时有一边为真即为真
        rows.push({
            k: "脑王彩蛋",
            cur: cell(yn(cur.brainCleared)),
            ov: cell(yn(ov.brainCleared)),
            mg: cell(yn(mg.brainCleared)),
            ovLoss: !!(cur.brainCleared && !ov.brainCleared),
            mgGain: !!(mg.brainCleared && !cur.brainCleared)
        });

        // 表头固定三列，与「当前存档 / 覆盖后 / 合并后」的语义一一对应
        var html = '<table class="rm-cmp"><thead><tr>' +
            '<th class="rm-k">项目</th><th>当前存档</th><th>覆盖后</th><th>合并后</th>' +
            "</tr></thead><tbody>";
        for (i = 0; i < rows.length; i++) {
            var r = rows[i];
            // 任一风险命中就给整行加底色，方便一眼定位得失
            var hl = (r.ovLoss || r.mgGain) ? ' class="rm-hl"' : "";
            html += "<tr" + hl + ">" +
                '<td class="rm-k">' + esc(r.k) + "</td>" +
                '<td class="rm-cur">' + cellHtml(r.cur) + "</td>" +
                '<td class="' + (r.ovLoss ? "rm-loss" : "") + '">' + cellHtml(r.ov) + "</td>" +
                '<td class="' + (r.mgGain ? "rm-gain" : "") + '">' + cellHtml(r.mg) + "</td>" +
                "</tr>";
        }
        html += "</tbody></table>";
        // lossCount 供覆盖前的二次确认使用：有损失才需要弹 confirm
        return {
            html: html,
            lossCount: rows.filter(function(r) {
                return r.ovLoss;
            }).length
        };
    }

    /* ---------- 4. 导入提示框：三选一交互与落盘 ---------- */
    /* 导入数据流（三选一）：
     *   pickFile → 原生文件框 → importSave(file) → FileReader 异步读取
     *     → JSON.parse → 早期明文存档直接拒绝 → Store.parseFile() 验签
     *     → pending = payload；openImportModal：由 Store.profile / profileOfFile /
     *       previewMergeFile 生成「当前 / 覆盖后 / 合并后」三列，只做预览不写存储
     *     → onAction 按用户选择分流：
     *         覆盖：对比表无损失直接写入，有损失先 confirm
     *         合并：直接写入（合并规则只增不减，不需要二次确认）
     *         取消：关闭弹窗，存档保持原样
     *     → doImport：先 backupCurrent() 留快照，再 importFile 落盘，成功后刷新
     *
     * 快照可撤销：backupCurrent() 把当前签名容器复制到导入前快照位，
     *   backupInfo() 能读到快照时间；restoreBackup() 一键回退。快照只有一份，
     *   下一次导入会覆盖上一份。
     */

    /**
     * 把 Store.parseFile 的失败结果翻译成用户能看懂的原因。
     * @param {Object} res parseFile 的返回对象
     * @returns {string} 失败原因文案
     */
    function importFailText(res) {
        var code = res && res.code;
        if (code === "signature") return "签名校验失败：文件被修改或损坏";
        if (code === "format") return (res && res.error) || "存档版本不兼容";
        if (code === "bad-app") return "不是本游戏的存档文件";
        if (code === "bad-file") return (res && res.error) || "不是有效的存档文件";
        return (res && res.error) || "存档校验失败";
    }

    /**
     * 打开导入确认框：渲染文件信息、三列对比表与覆盖 / 合并 / 取消按钮。
     * 本函数只做展示，不写任何存储；用户点按钮后才进入 onAction。
     * @param {Object} payload 已通过 Store.parseFile 验签的存档文件内容
     * @param {Object} [parsed] 可选的 parseFile 结果，避免重复验签
     * @sideeffect 重写 #rmImportModal 内容并显示遮罩，播放弹窗音效
     */
    function openImportModal(payload, parsed) {
        if (!payload || typeof payload.save !== "string" || !payload.save) return;
        ensureModal();
        if (!parsed || !parsed.ok) parsed = Store.parseFile(payload);
        if (!parsed || !parsed.ok) {
            pending = null;
            RM.toast("导入失败：" + importFailText(parsed), 4600);
            return;
        }

        var cur = Store.profile();
        // 文件画像解析失败时退化为当前存档，保证对比表始终可读
        var ov = Store.profileOfFile(payload) || cur;
        // 合并结果只用于预览，previewMergeFile 不会落盘
        var merged = Store.previewMergeFile(payload);
        var mg = (merged && merged.profile) ? merged.profile : cur;
        var t = buildTable(cur, ov, mg);
        pendingLoss = t.lossCount;

        // 已有快照的时间，用于提示「导入会覆盖上一份快照」
        var info = Store.backupInfo();

        // 文件来源信息：导出时间、编码体积、格式、摘要与验签结论
        var size = (typeof payload.size === "number") ? payload.size : payload.save.length;
        var digest = String(parsed.digest || payload.digest || "");
        var fileInfo = "存档文件导出于 <b>" + esc(fmtDate(payload.exportedAt)) + "</b>　·　编码 <b>" +
            esc(fmtChars(size) + " / " + fmtBytes(parsed.bytes)) + "</b>　·　格式 v" +
            esc(payload.format || Store.format) + "（schema " + esc(payload.schema || Store.schema) +
            "）　·　摘要 <b>" + esc(digest.slice(0, 8) || "—") + "</b>　·　完整性 <b>✅ 签名有效</b>";

        // 组装弹窗内容：文件信息 → 对比表 → 三选一说明 → 操作按钮
        modalEl.innerHTML =
            '<div class="icon">📥</div>' +
            "<h2>导入存档</h2>" +
            '<p class="rm-file-info">' + fileInfo + "</p>" +
            t.html +
            '<div class="rm-mode-box">' +
            "<div>🔴<b>覆盖</b>：用文件内容<b>完全替换</b>当前存档，标<span class=\"rm-warn\">红</span>处为将丢失的进度</div>" +
            "<div>🟢<b>合并</b>：两边取并集 —— 成就解锁取并集且保留更早解锁时间、最快纪录取更快、" +
            "通关次数 / 计数取更大、挑战进度取更大、系列与开关取并集、当前设置保留，" +
            "标绿处为将新增的进度</div>" +
            "<div>⚪<b>取消</b>：当前存档保持原样</div>" +
            "<div><small>💡 导入前会自动留存当前存档快照，导入后可在设置里「↩️ 撤销上次导入」回退" +
            (info ? "（已有快照：" + esc(fmtDate(info.iso)) + "，会被本次覆盖）" : "") +
            "。</small></div>" +
            "</div>" +
            '<div class="rm-btn-row">' +
            '<button type="button" class="rm-btn rm-btn-danger" data-act="overwrite"><b>覆盖</b><small>以文件为准</small></button>' +
            '<button type="button" class="rm-btn rm-btn-merge" data-act="merge"><b>合并</b><small>两边取并集</small></button>' +
            '<button type="button" class="rm-btn rm-btn-cancel" data-act="cancel"><b>取消</b></button>' +
            "</div>";

        // 遮罩与面板成对显示，与 index.html 的 .auto-modal 弹窗保持同一观感
        overlayEl.style.display = "block";
        modalEl.style.display = "block";
        try {
            AudioFX.modalOpen();
        } catch (e) {}
    }

    /**
     * 处理弹窗内的三个按钮：取消 / 覆盖 / 合并。
     * 覆盖是破坏性操作：对比表显示有进度会丢失时，先弹 confirm 二次确认；
     * 合并的规则只增不减，因此不需要二次确认。
     * @param {string} act 按钮的 data-act 值：cancel / overwrite / merge
     * @sideeffect 覆盖与合并路径会写入存储并在成功后刷新页面
     */
    function onAction(act) {
        var payload = pending;
        // 取消，或 payload 已失效（例如重复点击）时，无条件回到初始状态
        if (act === "cancel" || !payload) {
            closeModal();
            RM.toast("已取消导入，当前存档没有变动");
            return;
        }
        if (act === "overwrite") {
            if (pendingLoss > 0) {
                if (!window.confirm("覆盖会丢失 " + pendingLoss + " 项当前进度（表格中标红的部分）。\n\n" +
                    "导入前会自动留一份快照，可在设置里「撤销上次导入」回退。\n\n确定要覆盖吗？")) return;
            }
            doImport(payload, "overwrite");
            return;
        }
        if (act === "merge") {
            doImport(payload, "merge");
            return;
        }
    }

    /**
     * 执行导入：先留快照，再按覆盖或合并写入存储。
     * 成功后延时刷新页面，让各模块从新存档重新初始化。
     * @param {Object} payload 存档文件内容
     * @param {string} mode "overwrite" 或 "merge"
     * @sideeffect 写 localStorage；成功后 1.2 秒刷新页面
     */
    function doImport(payload, mode) {
        var merge = mode === "merge";
        var label = merge ? "合并" : "覆盖";
        try {
            // 先快照再写入：即使导入失败，撤销入口依然可用
            Store.backupCurrent();
            var res = Store.importFile(payload, { merge: merge });
            if (!res || !res.ok) {
                // importFile 不抛异常，失败原因通过 res.error 返回
                RM.toast("导入失败：" + ((res && res.error) || "未知错误"), 4600);
                return;
            }
            closeModal();
            var st = Store.getStatus();
            RM.toast(label + "导入成功（写入 " + res.count + " 项 · " + fmtBytes(st.bytes) + "），即将刷新页面", 3200);
            // 留出时间让成功提示被看到，再刷新页面重建各模块状态
            setTimeout(function() {
                try {
                    window.location.reload();
                } catch (e) {}
            }, 1200);
        } catch (e) {
            RM.onError("boot:doImport", e);
            RM.toast("导入失败：" + errMsg(e), 4600);
        }
    }

    /* ---------- 5. 存档导出 / 选择文件 / 清空 / 撤销的接线 ---------- */

    /**
     * 记录一次"存档管理"入口的使用，用于解锁对应的隐藏成就。
     * 六个对外入口在各自开头统一调用；13 号模块未加载或接口缺失时静默跳过，
     * 不改变任何存档管理行为。
     * @sideeffect 可能触发一次成就解锁与成就面板重绘
     */
    function markSaveManageUsed() {
        try {
            if (window.Achievements && typeof window.Achievements.unlock === "function") {
                window.Achievements.unlock("hidden_savemanage");
            }
        } catch (e) {}
    }

    /**
     * 把导出文件对象序列化并触发下载；浏览器不支持直接下载时退化为可复制的文本框。
     * @param {Object} payload 导出文件对象（exportFile / exportRawMapFile 的返回值）
     * @param {string} name 下载文件名
     * @returns {boolean} true 表示已发起下载；false 表示已退化为文本框
     * @sideeffect 触发下载或向 body 追加 textarea，并可能弹 toast
     */
    function downloadJsonFile(payload, name) {
        // 紧凑序列化：签名容器是给机器读的，缩进美化只会成倍放大文件
        var text = JSON.stringify(payload);
        var downloaded = false;
        try {
            downloaded = Store.download(name, text);
        } catch (e) {
            downloaded = false;
        }
        if (downloaded) return true;
        // 兜底：把 JSON 放进全屏 textarea，供玩家手动复制保存
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.readOnly = true;
        ta.style.cssText = "position:fixed;left:0;top:0;width:100%;height:60%;z-index:99999;";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        RM.toast("当前环境不支持直接下载，已生成文本框请手动复制保存", 5000);
        return false;
    }

    /**
     * 导出全部受管存档为紧凑签名容器 JSON 文件，并提示体积与完整性。
     * 浏览器不支持直接下载时退化为可复制的文本框，保证功能不中断。
     * @sideeffect 触发文件下载或向 body 追加 textarea，并弹出 toast
     */
    function exportSave() {
        markSaveManageUsed();
        try {
            var payload = Store.exportFile();
            var name = "反向扫雷-存档-" + dateStamp() + ".json";
            if (!downloadJsonFile(payload, name)) return;
            RM.toast("已导出签名存档（" + payload.size + " 字符 · ≈" + fmtBytes(payload.bytes) +
                " · 完整性 ✅）", 3600);
        } catch (e) {
            RM.onError("boot:exportSave", e);
            RM.toast("导出失败：" + errMsg(e));
        }
    }

    /**
     * 测试者工具：生成并下载一份「全部系列解锁 + 所有预设难度可玩」的测试存档。
     * 只构造导出文件、不写入当前存档；脑王门槛由 mineWins.hell = 10 满足。
     * @sideeffect 触发一次文件下载（或退化为文本框），并弹出提示
     */
    function downloadTestSave() {
        try {
            var allSeries = {
                basic: true,
                special: true,
                physics: true,
                poker: true,
                symmetry: true,
                tactical: true
            };
            var payload = Store.exportRawMapFile({
                seriesState: allSeries,
                seriesUnlocked: allSeries,
                // 脑王门槛：地狱通关 ≥ 10 次 + 5 个系列开关开启
                mineWins: { easy: 0, medium: 0, hard: 0, hell: 10, brain: 0 },
                // 教学与五个系列挑战标记完成，挑战面板直接显示可练习
                tutorialStep: "5",
                tutorialCompleted: "true",
                teachFinished: "true",
                tutorial_special: "5",
                tutorial_physics: "5",
                tutorial_symmetry: "5",
                tutorial_tactical: "5",
                tutorial_poker: "5",
                placeMode_v1: "drag",
                mineInfluenceHint: "false",
                mineEffectPreview: "true",
                mineSoundSettings: { bgm: 50, sfx: 50 },
                mineHardcoreMode: "false",
                mineTetrisMode: "false",
                // 抑制首访 / 每日欢迎与脑王解锁提示，便于连续测试
                hasVisitedBefore: "true",
                welcomeLastShown: (new Date).toDateString(),
                brainUnlockedNotified: "true"
            });
            var name = "反向扫雷-测试存档-" + dateStamp() + ".json";
            if (!downloadJsonFile(payload, name)) return;
            RM.toast("已生成测试存档（全系列解锁 · 预设难度全开 · 脑王可用）", 4200);
        } catch (e) {
            RM.onError("boot:downloadTestSave", e);
            RM.toast("生成测试存档失败：" + errMsg(e), 4200);
        }
    }

    /**
     * 以 UTF-8 异步读取本地文件，结果通过回调交回。
     * @param {File} file 用户选中的文件
     * @param {Function} cb 回调 (err, text)；读取失败时 err 为非空 Error
     * @sideeffect 无；不触碰 DOM 与存储
     */
    function readFile(file, cb) {
        try {
            var reader = new FileReader();
            reader.onload = function() {
                cb(null, String(reader.result || ""));
            };
            // FileReader 的错误只能通过 onerror 回调感知，不会向外抛异常
            reader.onerror = function() {
                cb(new Error("文件读取失败"));
            };
            reader.readAsText(file, "utf-8");
        } catch (e) {
            cb(e);
        }
    }

    /**
     * 导入入口：读取文件 → 解析 JSON → 拒绝早期明文 → 验签 → 打开三选一弹窗。
     * 这里不直接写入存储，所有写入都发生在用户选择覆盖或合并之后。
     * @param {File} file 用户选中的 JSON 文件
     * @sideeffect 验签成功后设置 pending 并打开导入弹窗
     */
    function importSave(file) {
        if (!file) return;
        markSaveManageUsed();
        readFile(file, function(err, text) {
            if (err) {
                RM.toast("导入失败：" + err.message);
                return;
            }
            var payload;
            try {
                payload = JSON.parse(text);
            } catch (e) {
                RM.toast("这不是有效的存档文件（JSON 解析失败）", 3600);
                return;
            }
            if (!payload || typeof payload !== "object") {
                RM.toast("这不是有效的存档文件", 3600);
                return;
            }
            // 早期 {app, schema:1, data:{...}} 明文存档：直接拒绝，不做迁移
            if (!payload.save && payload.data && typeof payload.data === "object") {
                RM.toast("旧版明文存档已不再支持，请使用 v1.3.0 及以上版本导出的签名存档", 4800);
                return;
            }
            var parsed;
            try {
                parsed = Store.parseFile(payload);
            } catch (e) {
                parsed = { ok: false, code: "corrupt", error: errMsg(e) };
            }
            if (!parsed || !parsed.ok) {
                RM.toast("导入失败：" + importFailText(parsed), 4600);
                return;
            }
            pending = payload;
            try {
                openImportModal(payload, parsed);
            } catch (e) {
                pending = null;
                RM.onError("boot:importSave", e);
                RM.toast("导入失败：" + errMsg(e), 4600);
            }
        });
    }

    /**
     * 打开系统的文件选择框。
     * 每次点击前清空 input.value，保证连续选择同一个文件也能触发 change。
     * @sideeffect 触发 #saveFileInput 的点击
     */
    function pickFile() {
        markSaveManageUsed();
        var input = document.getElementById("saveFileInput");
        if (!input) {
            RM.toast("未找到文件选择框");
            return;
        }
        input.value = "";
        input.click();
    }

    /**
     * 清空全部本地存档：交给 Store.clearAll() 统一清理主档 / 备份 / 快照 / 坏档。
     * @sideeffect 删除存档键，1 秒后刷新页面
     */
    function resetSave() {
        markSaveManageUsed();
        if (!window.confirm("确定要清空全部本地存档吗？\n" +
            "（成绩、成就、挑战进度、新手教学与外观设置都会被清空，且无法撤销）")) return;
        try {
            Store.clearAll();
            RM.toast("存档已清空，即将刷新页面");
            // 刷新让各模块从空存档重新初始化
            setTimeout(function() {
                try {
                    window.location.reload();
                } catch (e) {}
            }, 1000);
        } catch (e) {
            RM.onError("boot:resetSave", e);
            RM.toast("清空失败：" + errMsg(e));
        }
    }

    /**
     * 撤销上次导入：把存档回退到导入前快照记录的状态。
     * 快照只有一份，撤销一次后再次撤销会提示没有可撤销记录。
     * @sideeffect 用快照覆盖当前存档，1 秒后刷新页面
     */
    function undoImport() {
        markSaveManageUsed();
        var info = null;
        try {
            info = Store.backupInfo();
        } catch (e) {
            info = null;
        }
        // 没有快照说明还没导入过，或快照已被下一次导入覆盖
        if (!info) {
            RM.toast("没有可撤销的导入记录");
            return;
        }
        if (!window.confirm("撤销上次导入？\n\n将把存档恢复到 " + fmtDate(info.iso) +
            "（导入前快照）的状态。\n当前存档会被覆盖。")) return;
        try {
            var n = Store.restoreBackup();
            if (!n || n <= 0) {
                RM.toast("撤销失败：" + (Store.lastError || "快照不可用"), 4600);
                return;
            }
            RM.toast("已回退到导入前的存档（恢复 " + n + " 项），即将刷新页面", 3200);
            setTimeout(function() {
                try {
                    window.location.reload();
                } catch (e) {}
            }, 1000);
        } catch (e) {
            RM.onError("boot:undoImport", e);
            RM.toast("撤销失败：" + errMsg(e));
        }
    }

    /* ---------- 6. 存档详情弹窗（运行时创建） ---------- */
    // 详情弹窗 DOM 惰性单例；Esc 处理器按需挂载、关闭时移除
    var detailOverlayEl = null, detailModalEl = null, detailEscHandler = null;

    /**
     * 惰性创建存档详情弹窗的遮罩与面板，并绑定点击行为（只执行一次）。
     * 类名全部取自 style.css 第 27.3 段，JS 不注入任何样式。
     * @sideeffect 在 body 末尾追加两个节点，并为它们注册 click 监听
     */
    function ensureDetailModal() {
        if (detailModalEl) return;
        detailOverlayEl = document.createElement("div");
        detailOverlayEl.id = "rmSaveDetailOverlay";
        detailOverlayEl.className = "rm-detail-overlay";
        detailOverlayEl.style.display = "none";
        document.body.appendChild(detailOverlayEl);

        detailModalEl = document.createElement("div");
        detailModalEl.id = "rmSaveDetailModal";
        detailModalEl.className = "rm-detail-modal";
        detailModalEl.style.display = "none";
        document.body.appendChild(detailModalEl);

        // 点击遮罩关闭；点击面板内部不关闭
        detailOverlayEl.addEventListener("click", closeDetails);
        // 事件委托：底部「关闭」按钮
        detailModalEl.addEventListener("click", function(e) {
            var b = e.target && e.target.closest ? e.target.closest("button[data-act]") : null;
            if (!b) return;
            if (b.getAttribute("data-act") === "close") closeDetails();
        });
    }

    /**
     * 挂载 Esc 关闭监听；只挂一次，关闭弹窗时移除，避免长期占用键盘事件。
     * @sideeffect 向 document 注册 keydown 监听
     */
    function bindDetailEsc() {
        if (detailEscHandler) return;
        detailEscHandler = function(e) {
            if (e && e.key === "Escape") closeDetails();
        };
        document.addEventListener("keydown", detailEscHandler);
    }

    /**
     * 关闭存档详情弹窗。
     * @sideeffect 隐藏遮罩与面板，并移除 Esc 监听
     */
    function closeDetails() {
        if (detailOverlayEl) detailOverlayEl.style.display = "none";
        if (detailModalEl) detailModalEl.style.display = "none";
        if (detailEscHandler) {
            try {
                document.removeEventListener("keydown", detailEscHandler);
            } catch (e) {}
            detailEscHandler = null;
        }
    }

    /**
     * 查询成就汇总；13 号模块未加载时返回 null，详情弹窗退化为只读存档数据。
     * @returns {?Object} Achievements.summary() 的结果
     */
    function achSummary() {
        try {
            if (window.Achievements && typeof window.Achievements.summary === "function") {
                return window.Achievements.summary();
            }
        } catch (e) {}
        return null;
    }

    /**
     * 按 id 查询成就定义；取不到时返回 null，调用方回退为 id 文本。
     * @param {string} id 成就 id
     * @returns {?Object} 成就定义
     */
    function achDef(id) {
        try {
            if (window.Achievements && typeof window.Achievements.byId === "function") {
                return window.Achievements.byId(id);
            }
        } catch (e) {}
        return null;
    }

    /**
     * 生成一行「键 - 值」详情；值一律 esc 转义。
     * @param {string} k 键名
     * @param {*} v 值
     * @param {string} [cls] 值的修饰类：good / bad / muted
     * @returns {string} 行 HTML
     */
    function dRow(k, v, cls) {
        return '<div class="rm-detail-row">' +
            '<span class="rm-detail-k">' + esc(k) + "</span>" +
            '<span class="rm-detail-v' + (cls ? " " + cls : "") + '">' + esc(v) + "</span>" +
            "</div>";
    }

    /**
     * 生成详情弹窗完整内容：头部徽章 + 存储信息 + 成绩（普通 / 硬核 / 俄罗斯方块）
     * + 成就 + 挑战 + 设置。
     * 数据全部来自 Store.getStatus / Store.verify / Store.inspect 与
     * Achievements.summary / byId；任何一项异常都会在调用方被捕获。
     * @returns {string} 弹窗 HTML
     */
    function buildDetailHtml() {
        var st = Store.getStatus();
        var ver = Store.verify();
        var insp = Store.inspect();
        var meta = insp.meta || {};
        var sum = achSummary();

        // 头部：完整性徽章以实时验签 + 运行期 tampered 标记为准
        var badgeCls = "warn", badgeText = "⚠️ 完整性异常";
        if (ver && ver.ok && !Store.tampered) {
            badgeCls = "ok";
            badgeText = "🛡️ 已签名";
        } else if (st.integrity === "fresh") {
            badgeText = "⛔ 尚未存档";
        }
        var parts = [];
        parts.push('<div class="rm-detail-head">' +
            '<span class="rm-detail-icon">📄</span><h2>存档详情</h2>' +
            '<span class="rm-detail-badge ' + badgeCls + '">' + badgeText + "</span></div>");
        parts.push('<div class="rm-detail-body">');

        // 📦 存储信息：后端 / 体积 / 保存时间 / 格式 / 受管键 / 实时验签
        parts.push('<div class="rm-detail-sec"><div class="rm-detail-title">📦 存储信息</div>');
        parts.push(dRow("存储后端", st.backend === "localStorage" ? "浏览器 localStorage" : "内存 · 本次有效",
            st.backend === "localStorage" ? "good" : "muted"));
        parts.push(dRow("编码体积", fmtChars(st.size) + " / " + fmtBytes(st.bytes) +
            (st.compressed ? " · 已压缩" : " · 未压缩")));
        parts.push(dRow("压缩前体积", fmtBytes(st.payloadBytes), "muted"));
        parts.push(dRow("保存时间", st.savedAtISO ?
            fmtDate(st.savedAtISO) + "（" + fmtAgo(st.savedAtISO) + "）" : "尚未保存",
            st.savedAtISO ? "" : "muted"));
        parts.push(dRow("存储格式", "v" + st.format + " / schema " + st.schema, "muted"));
        parts.push(dRow("受管键数量", st.keys + " 项", "muted"));
        var verifyText, verifyCls;
        if (ver && ver.ok) {
            verifyText = "🛡️ 签名有效";
            verifyCls = "good";
        } else if (st.integrity === "fresh") {
            verifyText = "尚未生成存档";
            verifyCls = "muted";
        } else {
            verifyText = "⚠️ " + ((ver && ver.error) || "校验失败");
            verifyCls = "bad";
        }
        parts.push(dRow("实时验签", verifyText, verifyCls));
        parts.push("</div>");

        // 完整性 / 迁移说明：只有异常或迁移时才追加，正常情况不打扰
        var notes = [];
        if (Store.migrated || meta.migrated) {
            notes.push("本次启动已把 v1.2.x 旧版存档自动迁移为新版签名容器（旧键已清理）。");
        }
        if (st.integrity === "backup") {
            notes.push("主存档签名校验失败，已自动回退到备份副本，请导出备份并检查。");
        } else if (st.integrity === "corrupt") {
            notes.push("主存档与备份均无法通过校验，存档已重置，建议重新导出一份备份。");
        } else if (st.integrity === "fresh") {
            notes.push("当前尚未生成签名存档，首次存档写入后即可看到实时验签结果。");
        } else if (st.integrity !== "ok" && st.integrity !== "migrated") {
            notes.push("完整性状态：" + st.integrity + "，请导出备份并检查。");
        }
        if (Store.tampered && st.integrity === "ok") {
            notes.push("运行期检测到存档项结构异常，相关数据已回退默认值。");
        }
        if (notes.length) {
            parts.push('<div class="rm-detail-note">' + notes.map(esc).join("<br>") + "</div>");
        }

        // 🥇 成绩：5 个难度各一行，最快用时 + 通关次数 + 最近一次用时
        parts.push('<div class="rm-detail-sec"><div class="rm-detail-title">🥇 成绩</div>');
        var recs = insp.records || [];
        for (var i = 0; i < recs.length; i++) {
            var r = recs[i];
            var lastTxt = (r.last === null || r.last === undefined) ? "本次 无" : "本次 " + fmt(r.last);
            parts.push(dRow(DIFF_LABEL[r.key] || r.key,
                "最快 " + fmt(r.best) + " · 通关 " + (r.wins || 0) + " 次（" + lastTxt + "）"));
        }
        parts.push("</div>");

        // 🪚 硬核成绩：与普通成绩分开统计；没有硬核通关时给一句引导说明
        var hc = insp.hardcore || { total: 0, records: [] };
        var hcList = hc.records || [];
        parts.push('<div class="rm-detail-sec"><div class="rm-detail-title">🪚 硬核成绩 <small>' +
            (hc.total ? "累计 " + esc(hc.total + " 次") : "暂无硬核通关") + "</small></div>");
        var hcShown = 0;
        for (var hci = 0; hci < hcList.length; hci++) {
            var hcr = hcList[hci];
            // 与成绩栏一致：没完成过硬核通关的难度不单列
            if (!hcr.wins) continue;
            hcShown++;
            var hcLastTxt = (hcr.last === null || hcr.last === undefined) ? "本次 无" : "本次 " + fmt(hcr.last);
            parts.push(dRow("🪚 硬核" + (DIFF_LABEL[hcr.key] || hcr.key),
                "最快 " + fmt(hcr.best) + " · 通关 " + (hcr.wins || 0) + " 次（" + hcLastTxt + "）"));
        }
        if (!hcShown) {
            parts.push('<div class="rm-detail-empty">还没有硬核通关记录；开启硬核模式通关预设难度后会显示在这里。</div>');
        }
        parts.push("</div>");

        // 🐻 俄罗斯方块成绩：与硬核成绩结构一致；没有通关记录时给一句引导说明
        var tet = insp.tetris || { total: 0, records: [] };
        var tetList = tet.records || [];
        parts.push('<div class="rm-detail-sec"><div class="rm-detail-title">🐻 俄罗斯方块成绩 <small>' +
            (tet.total ? "累计 " + esc(tet.total + " 次") : "暂无俄罗斯方块通关") + "</small></div>");
        var tetShown = 0;
        for (var ti = 0; ti < tetList.length; ti++) {
            var ttr = tetList[ti];
            // 与成绩栏一致：没有通关过的难度不单列
            if (!ttr.wins) continue;
            tetShown++;
            var tetLastTxt = (ttr.last === null || ttr.last === undefined) ? "本次 无" : "本次 " + fmt(ttr.last);
            parts.push(dRow("🐻 俄罗斯方块" + (DIFF_LABEL[ttr.key] || ttr.key),
                "最快 " + fmt(ttr.best) + " · 通关 " + (ttr.wins || 0) + " 次（" + tetLastTxt + "）"));
        }
        if (!tetShown) {
            parts.push('<div class="rm-detail-empty">还没有俄罗斯方块通关记录；开启俄罗斯方块模式通关预设难度后会显示在这里。</div>');
        }
        parts.push("</div>");

        // 🏆 成就：总数 / 首末解锁时间 + 按解锁时间升序的逐项列表
        var ach = insp.achievements || {};
        // 总数优先取 13 号模块的汇总；两个来源都缺失时按编码表长度兜底
        var total = (sum && sum.total) || ach.total ||
            (RM && RM.ACH_IDS ? RM.ACH_IDS.length : 0);
        var unlocked = (sum && typeof sum.unlocked === "number") ? sum.unlocked : (ach.unlocked || 0);
        var hiddenCount = (sum && sum.hiddenUnlocked) || 0;
        var firstTxt = (sum && sum.firstAt) ? fmtLocal(sum.firstAt) :
            (ach.firstAt ? fmtDate(ach.firstAt) : "—");
        var lastTxt2 = (sum && sum.lastAt) ? fmtLocal(sum.lastAt) :
            (ach.lastAt ? fmtDate(ach.lastAt) : "—");
        parts.push('<div class="rm-detail-sec"><div class="rm-detail-title">🏆 成就 <small>' +
            "已解锁 " + esc(unlocked + " / " + total) +
            (hiddenCount ? " · 隐藏 " + esc(hiddenCount) : "") + "</small></div>");
        parts.push(dRow("首次解锁", firstTxt, firstTxt === "—" ? "muted" : ""));
        parts.push(dRow("最近解锁", lastTxt2, lastTxt2 === "—" ? "muted" : ""));
        var items = ach.items || [];
        if (!items.length) {
            parts.push('<div class="rm-detail-empty">还没有解锁任何成就，先去通关一局吧。</div>');
        } else {
            for (var j = 0; j < items.length; j++) {
                var it = items[j];
                var def = achDef(it.id);
                // 隐藏成就只会在解锁后出现在 items 里，此刻直接展示名称不算剧透
                var emoji = (def && def.emoji) ? def.emoji : "🏆";
                var name = (def && def.name) ? def.name : it.id;
                var when = it.atMs ? fmtLocal(it.atMs) : (it.at ? fmtDate(it.at) : "时间未知");
                parts.push('<div class="rm-detail-ach">' +
                    '<span class="rm-detail-ach-emoji">' + esc(emoji) + "</span>" +
                    '<span class="rm-detail-ach-name">' + esc(name) + "</span>" +
                    '<span class="rm-detail-ach-time">' + esc(when) + "</span>" +
                    "</div>");
            }
        }
        parts.push("</div>");

        // 🎯 挑战：新手教学 / 基础挑战 / 五个系列挑战
        parts.push('<div class="rm-detail-sec"><div class="rm-detail-title">🎯 挑战</div>');
        var teach = insp.teaching || { done: false, total: 12 };
        var teachTotal = teach.total || 12;
        parts.push(dRow("新手教学",
            teach.done ? "✅ 已完成（" + teachTotal + " / " + teachTotal + "）" : "未完成",
            teach.done ? "good" : "muted"));
        var chs = insp.challenges || [];
        for (var k = 0; k < chs.length; k++) {
            var c = chs[k];
            var cname = c.key === "basic" ? "基础挑战" : catName(c.key, c.key);
            var cval, ccls = "";
            if (c.done) {
                cval = "✅ 已完成 " + c.total + " / " + c.total;
                ccls = "good";
            } else if (c.locked) {
                cval = "🔒 未解锁（先完成基础挑战）";
                ccls = "muted";
            } else if (c.step > 0) {
                cval = "🕹️ 进行中 " + c.step + " / " + c.total;
            } else {
                cval = "未开始 0 / " + c.total;
                ccls = "muted";
            }
            parts.push(dRow(cname, cval, ccls));
        }
        parts.push("</div>");

        // ⚙️ 设置摘要：放置模式 / 提示开关 / 音量 / 系列开关
        parts.push('<div class="rm-detail-sec"><div class="rm-detail-title">⚙️ 设置摘要</div>');
        var set = insp.settings || {};
        parts.push(dRow("放置模式", set.placeMode === "click" ? "点选放置" : "拖拽放置"));
        parts.push(dRow("实时影响", set.influenceHint ? "开启" : "关闭",
            set.influenceHint ? "good" : "muted"));
        parts.push(dRow("效果预览", set.effectPreview ? "开启" : "关闭",
            set.effectPreview ? "good" : "muted"));
        var snd = set.sound || {};
        parts.push(dRow("音量", "🎵 背景音乐 " + (typeof snd.bgm === "number" ? snd.bgm : 50) +
            "% · 💥 音效 " + (typeof snd.sfx === "number" ? snd.sfx : 50) + "%"));
        var series = insp.series || {};
        parts.push(dRow("开启系列", (series.onCount || 0) + " / " + SERIES_TOTAL + " · 已解锁 " +
            (series.unlockedCount || 0) + " / " + SERIES_TOTAL, "muted"));
        parts.push("</div>");

        parts.push("</div>"); // .rm-detail-body 结束
        parts.push('<div class="rm-detail-foot">' +
            '<button type="button" class="rm-btn rm-btn-cancel" data-act="close">关闭</button></div>');
        return parts.join("");
    }

    /**
     * 打开「存档详情」弹窗：实时读取并渲染当前存档的完整画像。
     * 弹窗只读，不修改任何存档数据。
     * @sideeffect 重写 #rmSaveDetailModal 内容并显示遮罩，播放弹窗音效
     */
    function showDetails() {
        markSaveManageUsed();
        try {
            ensureDetailModal();
            detailModalEl.innerHTML = buildDetailHtml();
            detailOverlayEl.style.display = "block";
            detailModalEl.style.display = "flex";
            bindDetailEsc();
            try {
                AudioFX.modalOpen();
            } catch (e) {}
        } catch (e) {
            RM.onError("boot:showDetails", e);
            RM.toast("打开存档详情失败：" + errMsg(e), 4600);
        }
    }

    /* ---------- 7. 存档状态徽章与界面绑定 ---------- */
    /**
     * 把当前存档状态渲染成 #saveHint 里的徽章：
     * 第一行完整性，第二行后端 / 体积 / 保存时间，第三行备份提示；
     * 异常（backup / corrupt / tampered）时追加一条红色提示。
     * @sideeffect 重写 #saveHint.innerHTML，并同步「撤销上次导入」按钮
     */
    function refreshHint() {
        var hint = document.getElementById("saveHint");
        if (!hint) return;
        try {
            var st = Store.getStatus();
            var ver = Store.verify();
            var bad = !!Store.tampered || st.integrity === "backup" || st.integrity === "corrupt";
            // fresh（还没写过存档）不算异常；只有真校验失败或运行期篡改才亮红灯
            var good = !bad && !(ver && !ver.ok && st.integrity !== "fresh");
            var chip = good ? '<span class="save-status-chip ok">✅ 正常</span>'
                : '<span class="save-status-chip warn">⚠️ 异常</span>';
            var backend = st.backend === "localStorage" ? "浏览器" : "内存·本次有效";
            var size = st.size ? fmtBytes(st.bytes) : "0 B";
            var when = st.savedAtISO ? fmtShort(st.savedAtISO) : "尚未保存";
            var html = "<div>🔐 签名存档 · 完整性 " + chip + "</div>" +
                "<div><span class=\"save-status-chip info\">后端：" + esc(backend) + "</span>" +
                "<span class=\"save-status-chip info\">" + esc(size) + "</span>" +
                "<span class=\"save-status-chip info\">保存于 " + esc(when) + "</span></div>" +
                "<div>导出为带签名的.json，更换设备 / 清理缓存前请备份 🧳</div>";
            if (bad) {
                var msg = st.integrity === "corrupt"
                    ? "检测到存档异常，已重置为初始存档，请导出备份并检查"
                    : "检测到存档异常，已自动使用备份，请导出备份并检查";
                html += '<div><span class="save-status-chip warn">⚠️ ' + esc(msg) + "</span></div>";
            }
            hint.innerHTML = html;
            syncUndoButton();
        } catch (e) {
            RM.onError("boot:refreshHint", e);
        }
    }

    /**
     * 同步设置栏里的「↩️ 撤销上次导入」按钮：
     * 有快照时生成 / 更新文案，没有快照时移除，避免出现无效入口。
     * @sideeffect 在 #saveHint 之后增删一个按钮节点
     */
    function syncUndoButton() {
        var hint = document.getElementById("saveHint");
        if (!hint || !hint.parentNode) return;
        var host = hint.parentNode;
        var info = null;
        try {
            info = Store.backupInfo();
        } catch (e) {
            info = null;
        }
        var btn = document.getElementById("rmUndoImportBtn");
        if (!info) {
            if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
            return;
        }
        if (!btn) {
            btn = document.createElement("button");
            btn.type = "button";
            btn.id = "rmUndoImportBtn";
            btn.className = "clear-input-btn rm-undo-btn";
            host.appendChild(btn);
        }
        btn.textContent = "↩️ 撤销上次导入（快照：" + fmtDate(info.iso) + "）";
        btn.onclick = undoImport;
    }

    /**
     * 绑定存档管理界面：文件选择的 change 事件、设置栏展开时的状态刷新，
     * 并立即渲染一次状态徽章。
     * @sideeffect 为 #saveFileInput / #toggleSettingSidebar 注册监听，
     *             重写 #saveHint 内容
     */
    function bindSaveUI() {
        var input = document.getElementById("saveFileInput");
        if (input && !input.getAttribute("data-rm-bound")) {
            input.setAttribute("data-rm-bound", "1");
            // change 只在文件真正变化时触发，pickFile 每次清空 value 保证可重选
            input.addEventListener("change", function() {
                if (input.files && input.files[0]) importSave(input.files[0]);
            });
        }
        var toggle = document.getElementById("toggleSettingSidebar");
        if (toggle && !toggle.getAttribute("data-rm-hint")) {
            toggle.setAttribute("data-rm-hint", "1");
            // 08-ui 的 onclick 负责开合侧栏；这里只在其后补一次状态刷新
            toggle.addEventListener("click", function() {
                setTimeout(refreshHint, 30);
            });
        }
        refreshHint();
    }

    // 对外接口：供设置侧栏「存档管理」按钮与其它模块调用
    window.RMSave = {
        exportSave: exportSave,
        importSave: importSave,
        pickFile: pickFile,
        resetSave: resetSave,
        undoImport: undoImport,
        showDetails: showDetails,
        refreshHint: refreshHint,
        downloadTestSave: downloadTestSave
    };

    /* ---------- 8. 启动收尾 ---------- */
    /**
     * 启动收尾：执行自检、绑定存档界面、补一次侧栏按钮初始化。
     * 自检结果只用于提示、不阻断启动：缺模块时能用的功能仍然可用。
     * @sideeffect 绑定 DOM 事件、写入 RM.missingModules，必要时弹出提示；
     *             启动界面脚本缺失时把 body 补成 startup 兜底态
     */
    function boot() {
        var missing = selfCheck();
        bindSaveUI();
        try {
            // 侧栏折叠按钮的初始化定义在 08-ui.js，缺失时直接跳过
            if (typeof ensureBarToggle === "function") ensureBarToggle();
        } catch (e) {}
        if (missing.length) {
            RM.toast("部分模块未加载，请检查 js/ 目录是否完整", 6000);
        }
        // 旧数据结构存档已被拒绝时只提示这一条：进度无法继承，但游戏可以正常开始；
        // 其它完整性异常（备份接管 / 校验失败）仍按原有异常提示处理
        try {
            if (Store && Store.legacyRejected) {
                RM.toast("旧版本存档已不再兼容，已按新档开始", 6000);
            } else if (Store && Store.tampered) {
                var why = Store.integrity === "corrupt" ? "已重置为初始存档" : "已自动回退到备份";
                RM.toast("检测到存档异常（" + why + "），建议导出存档并检查", 6000);
            }
        } catch (e) {}
        // 启动态兜底：18-splash.js 存在时由它自己接管启动界面与转场；
        // 缺失时把 body 补成 startup，让启动态标记与 index.html 的静态初始态一致
        try {
            if (!window.RMSplash && document.body && !document.body.classList.contains("startup")) {
                document.body.classList.add("startup");
            }
        } catch (e) {}
    }

    // 脚本写在 body 末尾，正常情况下 DOM 已可操作；若被设为 defer 或动态插入，
    // readyState 仍是 loading，此时等 DOMContentLoaded 再启动
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
