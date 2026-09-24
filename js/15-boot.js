/* ==========================================================================
 * 反向扫雷 · 15-boot.js
 * 职责：存档导入提示框（覆盖 / 合并 / 取消 三选一 + 三列参数对比）
 *       模块自检、存档导出接线、启动收尾
 *
 * 说明：本文件的样式与弹窗 DOM 都是运行时注入的，不需要改 index.html。
 *       视觉沿用项目现有的 .auto-modal 风格。
 * ========================================================================== */

(function() {
    "use strict";

    /* ------------------------------------------------------------------ *
     * 0. 样式注入（只注入一次）
     * ------------------------------------------------------------------ */
    var CSS = [
        ".rm-overlay-top{z-index:1200!important;}",
        ".rm-modal{z-index:1201!important;top:50%!important;width:600px!important;min-width:0!important;",
        "max-width:94vw!important;max-height:90vh!important;overflow-y:auto!important;padding:26px 22px 20px!important;}",
        ".rm-modal .icon{font-size:54px!important;margin-bottom:6px!important;animation:none!important;}",
        ".rm-modal h2{font-size:24px!important;margin-bottom:8px!important;}",
        ".rm-modal p.rm-file-info{font-size:12.5px!important;color:#718096!important;margin:0 0 12px!important;line-height:1.7!important;}",
        ".rm-cmp{width:100%;border-collapse:collapse;font-size:13px;margin:0 0 12px;table-layout:fixed;}",
        ".rm-cmp th{padding:7px 4px;color:#4a5568;font-size:12px;font-weight:700;",
        "border-bottom:2px solid #e2e8f0;background:#f7fafc;}",
        ".rm-cmp td{padding:6px 4px;border-bottom:1px solid #eef2f7;text-align:center;color:#2d3748;",
        "word-break:break-all;line-height:1.5;}",
        ".rm-cmp th.rm-k,.rm-cmp td.rm-k{text-align:left;padding-left:8px;width:88px;}",
        ".rm-cmp td.rm-k{color:#4a5568;font-weight:600;}",
        ".rm-cmp td.rm-cur{color:#4a5568;font-weight:700;}",
        ".rm-cmp td.rm-loss{color:#e53e3e!important;font-weight:700;}",
        ".rm-cmp td.rm-gain{color:#2f855a!important;font-weight:700;}",
        ".rm-cmp tr.rm-hl td{background:#fffaf0;}",
        ".rm-mode-box{text-align:left;background:#f7fafc;border-radius:10px;padding:10px 12px;",
        "margin:0 0 12px;font-size:12.5px;line-height:1.8;color:#4a5568;",
        "box-shadow:inset 0 0 0 1px rgba(0,0,0,.04);}",
        ".rm-mode-box div+div{margin-top:4px;}",
        ".rm-mode-box b{color:#2d3748;}",
        ".rm-modal .rm-warn,.rm-modal span.rm-warn{color:#c53030!important;font-weight:700;}",
        ".rm-btn-row{display:flex;gap:10px;margin-top:4px;}",
        ".rm-modal button.rm-btn{flex:1;padding:11px 6px!important;border-radius:10px!important;border:3px solid transparent!important;background-image:none;",
        "font-weight:700;font-size:15px;cursor:pointer;color:#fff;line-height:1.3;",
        "transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .2s;",
        "box-shadow:0 2px 6px rgba(0,0,0,.12);display:block;margin:0;}",
        ".rm-modal button.rm-btn:hover{transform:scale(1.05);box-shadow:0 8px 20px rgba(0,0,0,.2);}",
        ".rm-modal button.rm-btn:active{transform:scale(1.01);}",
        ".rm-modal button.rm-btn b{display:block;font-size:15px;}",
        ".rm-modal button.rm-btn small{display:block;font-size:11px;font-weight:600;opacity:.9;margin-top:2px;}",
        ".rm-btn-danger{background:linear-gradient(180deg,#ff5e5e,#e83838)!important;border-color:#ff7070!important;}",
        ".rm-btn-merge{background:linear-gradient(180deg,#34dca0,#1ab883)!important;border-color:#6ef0c0!important;}",
        ".rm-btn-cancel{background:linear-gradient(180deg,#a0aec0,#718096)!important;border-color:#cbd5e0!important;}",
        ".rm-undo-btn{width:100%;margin-top:8px;}"
    ].join("\n");

    function injectCSS() {
        if (document.getElementById("rmImportStyle")) return;
        var st = document.createElement("style");
        st.id = "rmImportStyle";
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    /* ------------------------------------------------------------------ *
     * 1. 模块自检
     * ------------------------------------------------------------------ */
    var REQUIRED = [
        "RM", "Store", "AudioFX", "RetroBGM",
        "render", "renderSlot", "genGame", "newGame", "fullReset", "checkWin",
        "startTi", "stopTi", "resetTi", "drop", "del", "clearAll"
    ];

    function selfCheck() {
        var missing = [];
        for (var i = 0; i < REQUIRED.length; i++) {
            var name = REQUIRED[i];
            var ok = false;
            try {
                ok = typeof window[name] !== "undefined" && window[name] !== null;
            } catch (e) {
                ok = false;
            }
            if (!ok) missing.push(name);
        }
        RM.missingModules = missing;
        if (missing.length) {
            RM.onError("boot:selfCheck", "缺少模块: " + missing.join(", "));
            if (window.console) console.error("[RM] 缺少模块:", missing);
        }
        return missing;
    }

    /* ------------------------------------------------------------------ *
     * 2. 小工具
     * ------------------------------------------------------------------ */
    var DIFF_LABEL = { easy: "简单", medium: "中等", hard: "困难", hell: "地狱", brain: "脑王" };

    function fmt(ms) {
        if (ms === null || ms === undefined) return "无";
        if (!isFinite(ms)) return "无";
        return String(Math.floor(ms / 6e4)).padStart(2, "0") + ":" +
            String(Math.floor(ms / 1e3) % 60).padStart(2, "0") + "." +
            String(Math.floor(ms % 1e3 / 10)).padStart(2, "0");
    }

    function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function fmtDate(iso) {
        if (!iso) return "未知时间";
        var d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso);
        return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" +
            ("0" + d.getDate()).slice(-2) + " " + ("0" + d.getHours()).slice(-2) + ":" +
            ("0" + d.getMinutes()).slice(-2);
    }

    function yn(b) {
        return b ? "已达成" : "未达成";
    }

    /* ------------------------------------------------------------------ *
     * 3. 导入提示框
     * ------------------------------------------------------------------ */
    var pending = null;
    var overlayEl = null, modalEl = null;

    function ensureModal() {
        injectCSS();
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
            closeModal();
        });
        modalEl.addEventListener("click", function(e) {
            var b = e.target && e.target.closest ? e.target.closest("button[data-act]") : null;
            if (!b) return;
            onAction(b.getAttribute("data-act"));
        });
    }

    function closeModal() {
        if (overlayEl) overlayEl.style.display = "none";
        if (modalEl) modalEl.style.display = "none";
        pending = null;
    }

    /* ---- 三列对比表 ---- */
    function buildTable(cur, ov, mg) {
        var rows = [];
        var i, d;

        // 累计通关
        rows.push({
            k: "累计通关",
            cur: cur.totalWins + " 次",
            ov: ov.totalWins + " 次",
            mg: mg.totalWins + " 次",
            ovLoss: ov.totalWins < cur.totalWins,
            mgGain: mg.totalWins > cur.totalWins
        });

        // 各难度：次数 + 最快纪录
        var DIFFS = ["easy", "medium", "hard", "hell", "brain"];
        for (i = 0; i < DIFFS.length; i++) {
            d = DIFFS[i];
            var cw = cur.wins[d] || 0, ow = ov.wins[d] || 0, mw = mg.wins[d] || 0;
            var cr = cur.rec[d], orr = ov.rec[d], mr = mg.rec[d];
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

        // 成就
        var achDelta = mg.achCount - cur.achCount;
        rows.push({
            k: "成就解锁",
            cur: cur.achCount + " 个",
            ov: ov.achCount + " 个",
            mg: mg.achCount + " 个" + (achDelta > 0 ? " (+" + achDelta + ")" : ""),
            ovLoss: ov.achCount < cur.achCount,
            mgGain: achDelta > 0
        });

        // 系列解锁 / 开关
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

        // 教学进度
        rows.push({
            k: "教学进度",
            cur: cur.tutorialTotal + " 步",
            ov: ov.tutorialTotal + " 步",
            mg: mg.tutorialTotal + " 步",
            ovLoss: ov.tutorialTotal < cur.tutorialTotal,
            mgGain: mg.tutorialTotal > cur.tutorialTotal
        });

        // 脑王彩蛋
        rows.push({
            k: "脑王彩蛋",
            cur: yn(cur.brainCleared),
            ov: yn(ov.brainCleared),
            mg: yn(mg.brainCleared),
            ovLoss: cur.brainCleared && !ov.brainCleared,
            mgGain: !cur.brainCleared && mg.brainCleared
        });

        var html = '<table class="rm-cmp"><thead><tr>' +
            '<th class="rm-k">项目</th><th>当前存档</th><th>覆盖后</th><th>合并后</th>' +
            "</tr></thead><tbody>";
        for (i = 0; i < rows.length; i++) {
            var r = rows[i];
            var hl = (r.ovLoss || r.mgGain) ? ' class="rm-hl"' : "";
            html += "<tr" + hl + ">" +
                '<td class="rm-k">' + esc(r.k) + "</td>" +
                '<td class="rm-cur">' + esc(r.cur) + "</td>" +
                '<td class="' + (r.ovLoss ? "rm-loss" : "") + '">' + esc(r.ov) + "</td>" +
                '<td class="' + (r.mgGain ? "rm-gain" : "") + '">' + esc(r.mg) + "</td>" +
                "</tr>";
        }
        html += "</tbody></table>";
        return { html: html, lossCount: rows.filter(function(r) {
            return r.ovLoss;
        }).length };
    }

    function openImportModal(payload) {
        ensureModal();
        var cur = Store.profile();
        var ov = Store.profileOf(payload) || cur;
        var merged = Store.previewMerge(payload);
        var mg = merged.profile;

        var t = buildTable(cur, ov, mg);
        var info = Store.backupInfo();

        var fileInfo = "存档文件导出于 <b>" + esc(fmtDate(payload.exportedAt)) + "</b>　·　含 <b>" +
            esc(ov.keys) + "</b> 项　·　格式 v" + esc(payload.schema || 1);

        var schemaWarn = "";
        if ((payload.schema || 1) > Store.schema) {
            schemaWarn = '<div class="rm-file-info rm-warn">⚠️ 该文件来自更新的版本（v' +
                esc(payload.schema) + "），导入后可能出现未知项。</div>";
        }

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

        overlayEl.style.display = "block";
        modalEl.style.display = "block";
        try {
            AudioFX.modalOpen();
        } catch (e) {}
    }

    function onAction(act) {
        var payload = pending;
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

    function doImport(payload, label) {
        try {
            Store.backupCurrent();
            var res = (label === "合并")
                ? Store.importAll(Store.buildMergedPayload(payload), { merge: true })
                : Store.importAll(payload, { merge: false });
            if (!res.ok) {
                RM.toast("导入失败：" + (res.error || "未知错误"));
                return;
            }
            closeModal();
            RM.toast(label + "导入成功（写入 " + res.count + " 项），即将刷新页面");
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

    /* ------------------------------------------------------------------ *
     * 4. 导出 / 选择文件 / 清空 / 撤销
     * ------------------------------------------------------------------ */
    function exportSave() {
        try {
            var payload = Store.exportAll();
            var d = new Date();
            var stamp = d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2);
            var name = "反向扫雷-存档-" + stamp + ".json";
            var text = JSON.stringify(payload, null, 2);
            if (!Store.download(name, text)) {
                var ta = document.createElement("textarea");
                ta.value = text;
                ta.style.cssText = "position:fixed;left:0;top:0;width:100%;height:60%;z-index:99999;";
                document.body.appendChild(ta);
                ta.select();
                RM.toast("当前环境不支持直接下载，已生成文本框请手动复制保存", 5000);
                return;
            }
            var s = Store.summarize();
            RM.toast("已导出 " + s.keys + " 项存档（累计通关 " + s.wins + " 次）");
        } catch (e) {
            RM.onError("boot:exportSave", e);
            RM.toast("导出失败：" + (e && e.message ? e.message : e));
        }
    }

    function readFile(file, cb) {
        try {
            var reader = new FileReader();
            reader.onload = function() {
                cb(null, String(reader.result || ""));
            };
            reader.onerror = function() {
                cb(new Error("文件读取失败"));
            };
            reader.readAsText(file, "utf-8");
        } catch (e) {
            cb(e);
        }
    }

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
            if (!payload || payload.app !== "reverse-minesweeper" || !payload.data ||
                typeof payload.data !== "object") {
                RM.toast("这不是本游戏的存档文件");
                return;
            }
            pending = payload;
            openImportModal(payload);
        });
    }

    function pickFile() {
        var input = document.getElementById("saveFileInput");
        if (!input) {
            RM.toast("未找到文件选择框");
            return;
        }
        input.value = "";
        input.click();
    }

    function resetSave() {
        if (!window.confirm("确定要清空全部本地存档吗？\n（成绩、成就、系列解锁都会没有，且无法撤销）")) return;
        try {
            var payload = Store.exportAll();
            var keys = Object.keys(payload.data || {});
            for (var i = 0; i < keys.length; i++) Store.remove(keys[i]);
            RM.toast("存档已清空，即将刷新页面");
            setTimeout(function() {
                window.location.reload();
            }, 1000);
        } catch (e) {
            RM.onError("boot:resetSave", e);
        }
    }

    function undoImport() {
        var info = Store.backupInfo();
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

    function bindSaveUI() {
        var input = document.getElementById("saveFileInput");
        if (input) {
            input.addEventListener("change", function() {
                if (input.files && input.files[0]) importSave(input.files[0]);
            });
        }
        var hint = document.getElementById("saveHint");
        if (hint) {
            try {
                var s = Store.summarize();
                var info = Store.backupInfo();
                hint.innerHTML = "存档将导出为 JSON 文件<br>换设备 / 清缓存前可备份<br>当前存档：" +
                    s.keys + " 项 · 累计通关 " + s.wins + " 次 · 存储：" +
                    (s.backend === "localStorage" ? "浏览器" : "内存（本次有效）");
                var host = hint.parentNode;
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

    window.RMSave = {
        exportSave: exportSave,
        importSave: importSave,
        pickFile: pickFile,
        resetSave: resetSave,
        undoImport: undoImport
    };

    /* ------------------------------------------------------------------ *
     * 5. 启动
     * ------------------------------------------------------------------ */
    function boot() {
        var missing = selfCheck();
        bindSaveUI();
        try {
            if (typeof ensureBarToggle === "function") ensureBarToggle();
        } catch (e) {}
        if (missing.length) {
            RM.toast("部分模块未加载，请检查 js/ 目录是否完整", 6000);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
