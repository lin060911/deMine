/* ==========================================================================
 * 模块 15 · 启动自检与存档管理（js/15-boot.js）
 *
 * 职责：作为最后一个加载的模块，负责三件事：
 *   1) 启动自检：确认 00 ~ 10 号模块暴露的全局对象与函数都存在，缺失则提示；
 *   2) 存档管理接线：导出、导入、清空、撤销，并暴露为 window.RMSave；
 *   3) 导入确认框：读完存档文件后先给出「覆盖 / 合并 / 取消」三选一与
 *      三列对比表，让玩家在落盘前看清哪些进度会丢、哪些会新增。
 * 依赖：00-core 的 RM（toast / onError / missingModules）、01-storage 的
 *       Store（exportAll / importAll / profile / profileOf / previewMerge /
 *       buildMergedPayload / backupCurrent / backupInfo / restoreBackup 等）、
 *       02-audio 的 AudioFX，以及 index.html 的 #saveFileInput、#saveHint。
 * 对外：window.RMSave = { exportSave, importSave, pickFile, resetSave,
 *       undoImport }，供设置侧栏「存档管理」与其它脚本调用。
 * 设计要点：
 *   1) 必须最后加载：自检的前提是 00 ~ 10 号模块都已执行完毕。
 *   2) 预览优先：导入先展示当前 / 覆盖后 / 合并后三列对比，确认后才写存储。
 *   3) 破坏性操作先留快照：写入前调用 Store.backupCurrent()，撤销只需一步。
 *   4) 涉及存储与文件的入口都包了 try/catch，失败只提示，不拖垮其它功能。
 * ========================================================================== */

(function() {
    "use strict";

    /* ---------- 1. 模块自检 ---------- */
    // 自检清单：这些全局对象与函数由 00 ~ 10 号模块在顶层声明暴露；
    // 少任何一个都会让棋盘或对局流程在后续交互中抛错，因此启动时统一核查
    var REQUIRED = [
        "RM", "Store", "AudioFX", "RetroBGM",
        "render", "renderSlot", "genGame", "newGame", "fullReset", "checkWin",
        "startTi", "stopTi", "resetTi", "drop", "del", "clearAll"
    ];

    /**
     * 启动自检：逐个确认 REQUIRED 里的全局函数已定义且非 null。
     * 单项读取包在 try/catch 内，因为访问未声明的全局属性也可能抛错。
     * @returns {string[]} 缺失的模块名列表，空数组表示运行环境完整
     * @sideeffect 写入 RM.missingModules，并通过 RM.onError / console 报告
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
            if (!ok) missing.push(name);
        }
        // 不变量：RM.missingModules 恒等于本次自检结果，供其它模块随时查询
        RM.missingModules = missing;
        if (missing.length) {
            RM.onError("boot:selfCheck", "缺少模块: " + missing.join(", "));
            if (window.console) console.error("[RM] 缺少模块:", missing);
        }
        return missing;
    }

    /* ---------- 2. 小工具：数值格式化与安全转义 ---------- */
    // 难度键到中文名：与 01-storage.js 中 Store.DIFFS 的难度顺序保持一致
    var DIFF_LABEL = { easy: "简单", medium: "中等", hard: "困难", hell: "地狱", brain: "脑王" };

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
     * 转义 HTML 特殊字符，供拼接对比表时安全写入 innerHTML。
     * @param {*} s 任意值，内部统一转成字符串
     * @returns {string} 已转义文本
     */
    function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    /**
     * 把 ISO 时间串格式化为 "YYYY-MM-DD HH:mm"。
     * @param {string} iso 时间串；缺失时返回「未知时间」
     * @returns {string} 本地时区下的人类可读时间，非法值原样返回
     */
    function fmtDate(iso) {
        if (!iso) return "未知时间";
        var d = new Date(iso);
        // 非法日期无法格式化，原样回显便于排查存档文件的问题
        if (isNaN(d.getTime())) return String(iso);
        return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" +
            ("0" + d.getDate()).slice(-2) + " " + ("0" + d.getHours()).slice(-2) + ":" +
            ("0" + d.getMinutes()).slice(-2);
    }

    /**
     * 把布尔值翻译成对比表中「已达成 / 未达成」的文字。
     * @param {boolean} b 是否达成
     * @returns {string} 中文状态文本
     */
    function yn(b) {
        return b ? "已达成" : "未达成";
    }

    /* ---------- 3. 导入提示框：弹窗骨架与三列对比表 ---------- */
    // 待确认的存档文件内容；弹窗关闭时置空，避免继续持有整份文件数据
    var pending = null;
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
     * @sideeffect 隐藏遮罩与面板，并把 pending 置空
     */
    function closeModal() {
        if (overlayEl) overlayEl.style.display = "none";
        if (modalEl) modalEl.style.display = "none";
        pending = null;
    }

    /**
     * 生成三列对比表的 HTML 片段，并统计「覆盖会丢失」的行数。
     * 表格把「当前存档 / 覆盖后 / 合并后」三个画像拼成三列，每行同时算出
     * 两个风险标记：
     *   ovLoss —— 覆盖后比当前少，该项进度会丢失（表格中标红）
     *   mgGain —— 合并后比当前多，该项进度会新增（表格中标绿）
     * @param {Object} cur 当前存档画像
     * @param {Object} ov 存档文件画像（即覆盖后的结果）
     * @param {Object} mg 合并结果画像
     * @returns {{html: string, lossCount: number}} 表格 HTML 与丢失项计数
     */
    function buildTable(cur, ov, mg) {
        var rows = [];
        var i, d;

        // 累计通关：覆盖后变少即视为丢失进度，合并后变多即视为新增
        rows.push({
            k: "累计通关",
            cur: cur.totalWins + " 次",
            ov: ov.totalWins + " 次",
            mg: mg.totalWins + " 次",
            ovLoss: ov.totalWins < cur.totalWins,
            mgGain: mg.totalWins > cur.totalWins
        });

        // 各难度：通关次数 + 最快纪录；纪录以毫秒存储，数值越小越快
        var DIFFS = ["easy", "medium", "hard", "hell", "brain"];
        for (i = 0; i < DIFFS.length; i++) {
            d = DIFFS[i];
            var cw = cur.wins[d] || 0, ow = ov.wins[d] || 0, mw = mg.wins[d] || 0;
            var cr = cur.rec[d], orr = ov.rec[d], mr = mg.rec[d];
            // 纪录为 null 表示还没有通关过；覆盖后纪录变慢或消失都算丢失
            var recLoss = (cr === null) ? false : (orr === null || orr > cr);
            var recGain = (cr === null && mr !== null) || (cr !== null && mr !== null && mr < cr);
            var winGain = mw > cw;
            rows.push({
                k: DIFF_LABEL[d] || d,
                cur: cw + " 次 · " + fmt(cr),
                ov: ow + " 次 · " + fmt(orr),
                mg: mw + " 次 · " + fmt(mr),
                ovLoss: ow < cw || recLoss,
                mgGain: winGain || recGain
            });
        }

        // 成就：合并只会增加，因此只要有增量就标绿
        var achDelta = mg.achCount - cur.achCount;
        rows.push({
            k: "成就解锁",
            cur: cur.achCount + " 个",
            ov: ov.achCount + " 个",
            mg: mg.achCount + " 个" + (achDelta > 0 ? " (+" + achDelta + ")" : ""),
            ovLoss: ov.achCount < cur.achCount,
            mgGain: achDelta > 0
        });

        // 系列解锁 / 开关：上限都是 5，三列统一显示 x/5 便于横向对比
        rows.push({
            k: "系列解锁",
            cur: cur.seriesUnlocked + "/5",
            ov: ov.seriesUnlocked + "/5",
            mg: mg.seriesUnlocked + "/5",
            ovLoss: ov.seriesUnlocked < cur.seriesUnlocked,
            mgGain: mg.seriesUnlocked > cur.seriesUnlocked
        });
        rows.push({
            k: "系列开关",
            cur: cur.seriesOn + "/5",
            ov: ov.seriesOn + "/5",
            mg: mg.seriesOn + "/5",
            ovLoss: ov.seriesOn < cur.seriesOn,
            mgGain: mg.seriesOn > cur.seriesOn
        });

        // 教学进度：按已完成步数计，合并时取较大值
        rows.push({
            k: "教学进度",
            cur: cur.tutorialTotal + " 步",
            ov: ov.tutorialTotal + " 步",
            mg: mg.tutorialTotal + " 步",
            ovLoss: ov.tutorialTotal < cur.tutorialTotal,
            mgGain: mg.tutorialTotal > cur.tutorialTotal
        });

        // 脑王彩蛋：布尔型，合并时有一边为真即为真
        rows.push({
            k: "脑王彩蛋",
            cur: yn(cur.brainCleared),
            ov: yn(ov.brainCleared),
            mg: yn(mg.brainCleared),
            ovLoss: cur.brainCleared && !ov.brainCleared,
            mgGain: !cur.brainCleared && mg.brainCleared
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
                '<td class="rm-cur">' + esc(r.cur) + "</td>" +
                '<td class="' + (r.ovLoss ? "rm-loss" : "") + '">' + esc(r.ov) + "</td>" +
                '<td class="' + (r.mgGain ? "rm-gain" : "") + '">' + esc(r.mg) + "</td>" +
                "</tr>";
        }
        html += "</tbody></table>";
        // lossCount 供覆盖前的二次确认使用：有损失才需要弹 confirm
        return { html: html, lossCount: rows.filter(function(r) {
            return r.ovLoss;
        }).length };
    }

    /* ---------- 4. 导入提示框：三选一交互与落盘 ---------- */
    /* 导入数据流（三选一）：
     *   pickFile → 原生文件框 → importSave(file) → FileReader 异步读取
     *     → JSON.parse + 结构校验 → pending = payload
     *     → openImportModal：由 Store.profile / profileOf / previewMerge 生成
     *       当前 / 覆盖后 / 合并后三列，只做预览，不写存储
     *     → onAction 按用户选择分流：
     *         覆盖：对比表无损失直接写入，有损失先 confirm
     *         合并：直接写入（合并规则只增不减，不需要二次确认）
     *         取消：关闭弹窗，存档保持原样
     *     → doImport：先 backupCurrent() 留快照，再 importAll 落盘，成功后刷新
     *
     * 快照可撤销：backupCurrent() 把当前每个受管键复制一份 "<key>__pre"，
     *   并记录 rmPreImportAt / rmPreImportISO 两个时间键；撤销时
     *   restoreBackup() 把快照写回。快照只有一份，下一次导入会覆盖上一份。
     */
    /**
     * 打开导入确认框：渲染文件信息、三列对比表与覆盖 / 合并 / 取消按钮。
     * 本函数只做展示，不写任何存储；用户点按钮后才进入 onAction。
     * @param {Object} payload 已通过结构校验的存档文件内容
     * @sideeffect 重写 #rmImportModal 内容并显示遮罩，播放弹窗音效
     */
    function openImportModal(payload) {
        ensureModal();
        var cur = Store.profile();
        // 文件画像解析失败时退化为当前存档，保证对比表始终可读
        var ov = Store.profileOf(payload) || cur;
        // 合并结果只用于预览，previewMerge 不会落盘
        var merged = Store.previewMerge(payload);
        var mg = merged.profile;

        var t = buildTable(cur, ov, mg);
        // 已有快照的时间，用于提示「本次导入会覆盖上一份快照」
        var info = Store.backupInfo();

        // 文件来源信息：导出时间、受管键数量与存档格式号
        var fileInfo = "存档文件导出于 <b>" + esc(fmtDate(payload.exportedAt)) + "</b>　·　含 <b>" +
            esc(ov.keys) + "</b> 项　·　格式 v" + esc(payload.schema || 1);

        var schemaWarn = "";
        // 文件的格式号高于本程序时给出提示，但仍允许导入（未知键会被跳过）
        if ((payload.schema || 1) > Store.schema) {
            schemaWarn = '<div class="rm-warn">⚠️ 该文件来自更新的版本（v' +
                esc(payload.schema) + "），导入后可能出现未知项。</div>";
        }

        // 组装弹窗内容：文件信息 → 对比表 → 三选一说明 → 操作按钮
        modalEl.innerHTML =
            '<div class="icon">📥</div>' +
            "<h2>导入存档</h2>" +
            '<p class="rm-file-info">' + fileInfo + "</p>" +
            schemaWarn +
            t.html +
            '<div class="rm-mode-box">' +
            "<div>🔴<b>覆盖</b>：用文件内容<b>完全替换</b>当前存档" +
            "标<span class=\"rm-warn\">红</span>处为将丢失的进度</div>" +
            "<div>🟢<b>合并</b>：两边取并集 —— 成就与系列解锁取并集、最快纪录取更快、通关次数取较大值、教学进度取较大值" +
            "<b>已解锁的内容不会倒退</b>，标<span style=\"color:#2f855a;font-weight:700\">绿</span>处为将新增的进度</div>" +
            "<div>⚪<b>取消</b>：当前存档保持原样</div>" +
            "<div style=\"margin-top:6px;color:#718096\">💡 导入前将留存当前存档的快照，" +
            "导入后可在下方「↩️ 撤销上次导入」回退" +
            (info ? "（当前已有快照：" + esc(fmtDate(info.iso)) + "，会被本次覆盖）" : "") + "</div>" +
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
            var cur = Store.profile();
            var ov = Store.profileOf(payload) || cur;
            var t = buildTable(cur, ov, Store.previewMerge(payload).profile);
            if (t.lossCount > 0) {
                if (!window.confirm("覆盖会丢失 " + t.lossCount + " 项当前进度（表格中标红的部分）。\n\n" +
                    "导入前会自动留一份快照，可在设置里「撤销上次导入」回退。\n\n确定要覆盖吗？")) return;
            }
            doImport(payload, "覆盖");
            return;
        }
        if (act === "merge") {
            doImport(payload, "合并");
            return;
        }
    }

    /**
     * 执行导入：先留快照，再按覆盖或合并写入存储。
     * 成功后延时刷新页面，让各模块从新存档重新初始化。
     * @param {Object} payload 存档文件内容
     * @param {string} label 用于提示文案的导入方式名（覆盖 / 合并）
     * @sideeffect 写 localStorage；成功后 1.2 秒刷新页面
     */
    function doImport(payload, label) {
        try {
            // 先快照再写入：即使本次导入失败，撤销入口依然可用
            Store.backupCurrent();
            var res = (label === "合并")
                ? Store.importAll(Store.buildMergedPayload(payload), { merge: true })
                : Store.importAll(payload, { merge: false });
            if (!res.ok) {
                // importAll 不抛异常，失败原因通过 res.error 返回
                RM.toast("导入失败：" + (res.error || "未知错误"));
                return;
            }
            closeModal();
            RM.toast(label + "导入成功（写入 " + res.count + " 项），即将刷新页面");
            // 留出时间让成功提示被看到，再刷新页面重建各模块状态
            setTimeout(function() {
                try {
                    window.location.reload();
                } catch (e) {}
            }, 1200);
        } catch (e) {
            RM.onError("boot:doImport", e);
            RM.toast("导入失败：" + (e && e.message ? e.message : e));
        }
    }

    /* ---------- 5. 存档导出 / 选择文件 / 清空 / 撤销的接线 ---------- */
    /**
     * 导出全部受管存档为 JSON 文件，并提示导出条数。
     * 浏览器不支持直接下载时退化为可复制的文本框，保证功能不中断。
     * @sideeffect 触发文件下载或向 body 追加 textarea，并弹出 toast
     */
    function exportSave() {
        try {
            var payload = Store.exportAll();
            var d = new Date();
            // 文件名带日期，便于玩家区分多份备份
            var stamp = d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2);
            var name = "反向扫雷-存档-" + stamp + ".json";
            var text = JSON.stringify(payload, null, 2);
            // download 依赖 Blob + a[download]，被浏览器策略拦截时返回 false
            if (!Store.download(name, text)) {
                // 兜底：把 JSON 放进全屏 textarea，供玩家手动复制保存
                var ta = document.createElement("textarea");
                ta.value = text;
                ta.style.cssText = "position:fixed;left:0;top:0;width:100%;height:60%;z-index:99999;";
                document.body.appendChild(ta);
                ta.select();
                RM.toast("当前环境不支持直接下载，已生成文本框请手动复制保存", 5000);
                return;
            }
            // 用与提示一致的统计口径报告「导出了几项、累计通关几次」
            var s = Store.summarize();
            RM.toast("已导出 " + s.keys + " 项存档（累计通关 " + s.wins + " 次）");
        } catch (e) {
            RM.onError("boot:exportSave", e);
            RM.toast("导出失败：" + (e && e.message ? e.message : e));
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
     * 导入入口：读取文件 → 解析 JSON → 校验文件身份 → 交给弹窗做三选一。
     * 这里不直接写入存储，所有写入都发生在用户选择覆盖或合并之后。
     * @param {File} file 用户选中的 JSON 文件
     * @sideeffect 解析成功后设置 pending 并打开导入弹窗
     */
    function importSave(file) {
        if (!file) return;
        readFile(file, function(err, text) {
            if (err) {
                RM.toast("导入失败：" + err.message);
                return;
            }
            var payload;
            try {
                payload = JSON.parse(text);
            } catch (e) {
                RM.toast("这不是有效的存档文件（JSON 解析失败）");
                return;
            }
            // 双重校验：app 字段确认文件来源，data 必须是对象才继续
            if (!payload || payload.app !== "reverse-minesweeper" || !payload.data ||
                typeof payload.data !== "object") {
                RM.toast("这不是本游戏的存档文件");
                return;
            }
            pending = payload;
            openImportModal(payload);
        });
    }

    /**
     * 打开系统的文件选择框。
     * 每次点击前清空 input.value，保证连续选择同一个文件也能触发 change。
     * @sideeffect 触发 #saveFileInput 的点击
     */
    function pickFile() {
        var input = document.getElementById("saveFileInput");
        if (!input) {
            RM.toast("未找到文件选择框");
            return;
        }
        input.value = "";
        input.click();
    }

    /**
     * 清空全部本地存档：逐项删除受管键后刷新页面。
     * 用 Store.exportAll 枚举受管键，而不是清空整个 localStorage，
     * 以免误删同一域名下其它用途的数据。
     * @sideeffect 删除存档键，1 秒后刷新页面
     */
    function resetSave() {
        if (!window.confirm("确定要清空全部本地存档吗？\n（成绩、成就、系列解锁都会没有，且无法撤销）")) return;
        try {
            var payload = Store.exportAll();
            // 只删除存档层管理的键，签名与快照等辅助键交给存储层自己维护
            var keys = Object.keys(payload.data || {});
            for (var i = 0; i < keys.length; i++) Store.remove(keys[i]);
            RM.toast("存档已清空，即将刷新页面");
            // 刷新让各模块从空存档重新初始化
            setTimeout(function() {
                window.location.reload();
            }, 1000);
        } catch (e) {
            RM.onError("boot:resetSave", e);
        }
    }

    /**
     * 撤销上次导入：把存档回退到导入前快照记录的状态。
     * 快照只有一份，撤销一次后再次撤销会提示没有可撤销记录。
     * @sideeffect 用快照覆盖当前存档，1 秒后刷新页面
     */
    function undoImport() {
        var info = Store.backupInfo();
        // 没有快照说明还没导入过，或快照已被下一次导入覆盖
        if (!info) {
            RM.toast("没有可撤销的导入记录");
            return;
        }
        if (!window.confirm("撤销上次导入？\n\n将把存档恢复到 " + fmtDate(info.iso) +
            "（导入前快照）的状态。\n当前存档会被覆盖。")) return;
        try {
            var n = Store.restoreBackup();
            RM.toast("已回退到导入前的存档（恢复 " + n + " 项），即将刷新页面");
            setTimeout(function() {
                window.location.reload();
            }, 1000);
        } catch (e) {
            RM.onError("boot:undoImport", e);
        }
    }

    /**
     * 绑定存档管理界面：文件选择的 change 事件、存档摘要文案与撤销按钮。
     * @sideeffect 为 #saveFileInput 注册监听；存在快照时向 #saveHint 之后
     *             追加一个「撤销上次导入」按钮
     */
    function bindSaveUI() {
        var input = document.getElementById("saveFileInput");
        if (input) {
            // change 只在文件真正变化时触发，pickFile 每次清空 value 保证可重选
            input.addEventListener("change", function() {
                if (input.files && input.files[0]) importSave(input.files[0]);
            });
        }
        var hint = document.getElementById("saveHint");
        if (hint) {
            try {
                var s = Store.summarize();
                var info = Store.backupInfo();
                // 摘要同时说明存储后端：浏览器 localStorage 或仅本次有效的内存后端
                hint.innerHTML = "存档将导出为 JSON 文件<br>换设备 / 清缓存前可备份<br>当前存档：" +
                    s.keys + " 项 · 累计通关 " + s.wins + " 次 · 存储：" +
                    (s.backend === "localStorage" ? "浏览器" : "内存（本次有效）");
                var host = hint.parentNode;
                // 只有存在快照时才出现撤销入口，避免无效按钮
                if (host && info) {
                    var btn = document.createElement("button");
                    btn.className = "clear-input-btn rm-undo-btn";
                    btn.textContent = "↩️ 撤销上次导入（快照：" + fmtDate(info.iso) + "）";
                    btn.onclick = undoImport;
                    host.appendChild(btn);
                }
            } catch (e) {}
        }
    }

    // 对外接口：供设置侧栏「存档管理」按钮与其它模块调用
    window.RMSave = {
        exportSave: exportSave,
        importSave: importSave,
        pickFile: pickFile,
        resetSave: resetSave,
        undoImport: undoImport
    };

    /* ---------- 6. 启动收尾 ---------- */
    /**
     * 启动收尾：执行自检、绑定存档界面、补一次侧栏按钮初始化。
     * 自检结果只用于提示、不阻断启动：缺模块时能用的功能仍然可用。
     * @sideeffect 绑定 DOM 事件、写入 RM.missingModules，必要时弹出提示
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
    }

    // 脚本写在 body 末尾，正常情况下 DOM 已可操作；若被改为 defer 或动态插入，
    // readyState 仍是 loading，此时等 DOMContentLoaded 再启动
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
