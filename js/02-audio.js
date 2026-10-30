/* ==========================================================================
 * 模块 02 · 音频总线（js/02-audio.js）
 *
 * 职责：用一套 WebAudio 图同时承载界面音效、8bit 背景音乐与成就音，
 *   并统一管理音量、静音与浏览器自动播放限制的解除。
 * 依赖：浏览器的 WebAudio API（window.AudioContext）；页面上的
 *   DOMContentLoaded 事件与 document 上的首次交互事件。
 * 对外：window.AudioFX（音效：init / resume / 各音效 / 音量与静音）；
 *   window.RetroBGM（背景音乐：play / stop / toggle / 音量与静音 /
 *   isPlaying / isBlocked）；全局函数 playAchievementSound。
 * 设计要点：
 *   1) 全局只创建一个 AudioContext：音效与背景音乐各挂一条独立 Gain 总线，
 *      再汇入 master。浏览器对同时存在的 AudioContext 数量有上限，共用
 *      一个可以避免频繁解锁成就时耗尽上下文导致声音失效。
 *   2) 音量系数集中为 SFX_MAX 与 BGM_MAX 两个常量，两类声音的最响电平
 *      只在这里调整，设置里的滑杆只在其上做 0~1 的比例缩放。
 *   3) 音频节点全部在用户首次交互后才真正发声：自动播放被拦截时先注册
 *      一次性监听，待用户交互后唤醒上下文并补播。
 * ========================================================================== */

(function() {
    "use strict";

    /* ---------- 1. 音频总线与全局状态 ---------- */

    /* 两类声音的最响电平：设置里的滑杆只在此之上做 0~1 的比例缩放 */
    var SFX_MAX = 0.35;
    var BGM_MAX = 0.13;

    /* 全站唯一的 AudioContext 与三条总线：master 汇总，其余两条分控音量 */
    var ctx = null;
    var master = null;
    var sfxBus = null;
    var bgmBus = null;
    var reverbNode = null;
    var supported = true;

    var sfxVol = 1;      // 0~1，来自设置里的"游戏音效"
    var bgmVol = 0.5;    // 0~1，来自设置里的"背景音乐"
    var muted = false;   // 音效静音
    /* 悬停音效的节流时间戳，避免鼠标扫过一排按钮时连续触发 */
    var lastHoverTime = 0;

    /* ---------- 2. 音频上下文初始化 ---------- */

    /**
     * 惰性创建 AudioContext 与音频总线；环境不支持时返回 null。
     * 可重复调用，已创建时直接返回同一个上下文。
     * @returns {?AudioContext} 全站共享的音频上下文
     * @sideeffect 首次调用时构建音频图并写入 ctx
     */
    function ensure() {
        if (ctx) return ctx;
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) {
                supported = false;
                return null;
            }
            ctx = new AC();

            // 音频图：master 汇总所有声音，sfxBus / bgmBus 分别控制两类音量
            master = ctx.createGain();
            master.gain.value = 1;
            master.connect(ctx.destination);

            sfxBus = ctx.createGain();
            sfxBus.gain.value = SFX_MAX * sfxVol;
            sfxBus.connect(master);

            bgmBus = ctx.createGain();
            bgmBus.gain.value = BGM_MAX * bgmVol;
            bgmBus.connect(master);

            // 混响：只挂在音效总线上，营造一点空间感
            try {
                var convolver = ctx.createConvolver();
                var rate = ctx.sampleRate;
                var length = Math.floor(rate * 0.5);
                var impulse = ctx.createBuffer(2, length, rate);
                // 用衰减噪声合成 0.5 秒脉冲响应，省去额外加载音频文件
                for (var ch = 0; ch < 2; ch++) {
                    var data = impulse.getChannelData(ch);
                    for (var i = 0; i < length; i++) {
                        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
                    }
                }
                convolver.buffer = impulse;
                var reverbGain = ctx.createGain();
                reverbGain.gain.value = 0.15;
                convolver.connect(reverbGain);
                reverbGain.connect(sfxBus);
                reverbNode = convolver;
            } catch (e) {
                reverbNode = null;
            }
        } catch (e) {
            supported = false;
            ctx = null;
            if (window.console) console.warn("Web Audio API not supported");
        }
        return ctx;
    }

    /**
     * 唤醒被浏览器挂起的音频上下文；上下文尚未创建时先创建。
     * @sideeffect 可能创建 AudioContext 并使其进入运行状态
     */
    function resume() {
        ensure();
        if (ctx && ctx.state === "suspended") {
            try {
                ctx.resume();
            } catch (e) {}
        }
    }

    /**
     * 读取当前音频时钟（秒）；上下文尚未创建时返回 0。
     * @returns {number}
     */
    function now() {
        return ctx ? ctx.currentTime : 0;
    }

    /* ---------- 3. 音效生成基础 ---------- */

    /**
     * 播放一个振荡器音符：可选滑音，音量按指数包络衰减。
     * 所有界面音效都由本函数组合而成。
     * @param {number} freq 起始频率（Hz）
     * @param {number} duration 时长（秒）
     * @param {string} [type] 波形：sine / square / sawtooth / triangle
     * @param {number} [vol] 峰值音量，缺省 0.2
     * @param {number} [when] 起始时刻（音频时钟秒），缺省为当前时刻
     * @param {number} [slideTo] 滑音目标频率（Hz），缺省不滑音
     */
    function playTone(freq, duration, type, vol, when, slideTo) {
        // 静音或音频上下文未就绪时直接返回，不创建任何音频节点
        if (muted || !ctx || !freq) return;
        var t = when || now();
        var osc, gain;
        try {
            osc = ctx.createOscillator();
            gain = ctx.createGain();
        } catch (e) {
            return;
        }
        osc.type = type || "sine";
        osc.frequency.setValueAtTime(freq, t);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
        gain.gain.setValueAtTime(vol || 0.2, t);
        // 指数包络的终点不能取 0，用 0.001 近似静音
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
        osc.connect(gain);
        gain.connect(sfxBus);
        // 只给较响的音效加混响，避免小声的界面音变浑浊
        if (reverbNode && vol > 0.15) gain.connect(reverbNode);
        osc.start(t);
        osc.stop(t + duration + 0.05);
    }

    /* ---------- 4. 界面音效 ---------- */

    /**
     * 悬停轻响：50 毫秒内只响一次，两个短促正弦音叠出"嗒"的听感。
     */
    function playPop() {
        if (muted) return;
        resume();
        var t = now();
        if (t - lastHoverTime < 0.05) return;
        lastHoverTime = t;
        playTone(880, 0.08, "sine", 0.08, t, 440);
        playTone(1320, 0.06, "sine", 0.04, t + 0.02);
    }

    /**
     * 弹窗打开：上行琶音加一个高音点缀，提示注意力转移到弹窗。
     */
    function playModalOpen() {
        if (muted) return;
        resume();
        var t = now();
        [ 523.25, 659.25, 783.99, 1046.5 ].forEach(function(f, i) {
            playTone(f, 0.35, "sine", 0.18, t + i * 0.05);
        });
        playTone(2093, 0.5, "triangle", 0.08, t + 0.2);
    }

    /**
     * 确认操作：三音上行，短促干脆，用于按钮确认与开局。
     */
    function playConfirm() {
        if (muted) return;
        resume();
        var t = now();
        playTone(440, 0.1, "triangle", 0.25, t);
        playTone(880, 0.15, "sine", 0.2, t + 0.05);
        playTone(1760, 0.2, "sine", 0.1, t + 0.1);
    }

    /**
     * 普通胜利：六音旋律，偶数拍叠高八度泛音，营造明亮的收束感。
     */
    function playWin() {
        if (muted) return;
        resume();
        var t = now();
        var melody = [
            { f: 523.25, d: 0.15 }, { f: 659.25, d: 0.15 }, { f: 783.99, d: 0.15 },
            { f: 1046.5, d: 0.25 }, { f: 880.0, d: 0.15 }, { f: 1046.5, d: 0.4 }
        ];
        melody.forEach(function(n, i) {
            playTone(n.f, n.d, "triangle", 0.28, t + i * 0.14);
            if (i % 2 === 0) playTone(n.f * 2, n.d * 0.5, "sine", 0.08, t + i * 0.14);
        });
        playTone(1568, 0.3, "sine", 0.1, t + 0.5);
        playTone(2093, 0.4, "sine", 0.08, t + 0.7);
    }

    /**
     * 脑王胜利：方波上行、三和弦与低频重音组成的完整段落，
     * 时长与层次都明显强于普通胜利，突出最高难度的分量。
     */
    function playWinBrain() {
        if (muted) return;
        resume();
        var t = now();
        [ 523, 659, 784, 1047, 1319 ].forEach(function(f, i) {
            playTone(f, 0.2, "square", 0.18, t + i * 0.12);
        });
        var chords = [
            { f: [ 523, 659, 784 ], t: 0.7, d: 0.8 },
            { f: [ 349, 440, 523 ], t: 1.3, d: 0.8 },
            { f: [ 392, 494, 587 ], t: 1.9, d: 0.8 },
            { f: [ 1047, 1319, 1568 ], t: 2.6, d: 1.2 }
        ];
        chords.forEach(function(c) {
            c.f.forEach(function(f) {
                playTone(f, c.d, "sawtooth", 0.12, t + c.t);
            });
        });
        [ 2093, 2349, 2637, 3136, 3520, 2637, 2093 ].forEach(function(f, i) {
            playTone(f, 0.4, "sine", 0.1, t + 3.0 + i * 0.2);
        });
        [ 0.7, 1.3, 1.9, 2.6, 3.3 ].forEach(function(off, i) {
            playTone(80 + i * 10, 0.2, "sine", 0.35, t + off);
        });
        playTone(1047, 2.0, "triangle", 0.25, t + 5.0);
        playTone(60, 1.5, "sine", 0.25, t + 5.5);
    }

    /**
     * 开关切换：开启走上行、关闭走下行，用音高方向表达状态变化。
     * @param {boolean} on 切换后的状态
     */
    function playToggle(on) {
        if (muted) return;
        resume();
        var t = now();
        playTone(on ? 523 : 392, 0.12, "square", 0.12, t);
        if (on) playTone(784, 0.1, "sine", 0.08, t + 0.05);
    }

    /**
     * 放置地雷：低频撞击加一层高频亮音，听感上强调"落子"。
     */
    function playPlace() {
        if (muted) return;
        resume();
        var t = now();
        playTone(200, 0.08, "square", 0.2, t);
        playTone(600, 0.12, "triangle", 0.18, t + 0.03);
        playTone(1200, 0.08, "sine", 0.08, t + 0.06);
    }

    /**
     * 移除地雷：下滑锯齿波，与放置音形成反向的听感。
     */
    function playRemove() {
        if (muted) return;
        resume();
        var t = now();
        playTone(400, 0.1, "sawtooth", 0.15, t, 200);
        playTone(200, 0.15, "sine", 0.12, t + 0.05);
    }

    /**
     * 操作非法：两个低频锯齿音，音色粗糙，用于明确表达"不可用"。
     */
    function playError() {
        if (muted) return;
        resume();
        var t = now();
        playTone(200, 0.15, "sawtooth", 0.2, t);
        playTone(150, 0.2, "sawtooth", 0.2, t + 0.12);
    }

    /**
     * 内容未解锁：两个相邻的短方波，音高变化很小，表达"卡住"。
     */
    function playLocked() {
        if (muted) return;
        resume();
        var t = now();
        playTone(300, 0.08, "square", 0.1, t);
        playTone(280, 0.08, "square", 0.1, t + 0.08);
    }

    /**
     * 教学步骤完成：两音上行，轻量提示"这一步做对了"。
     */
    function playStepDone() {
        if (muted) return;
        resume();
        var t = now();
        playTone(880, 0.1, "sine", 0.15, t);
        playTone(1100, 0.15, "sine", 0.12, t + 0.08);
    }

    /**
     * 复制成功：两个高音轻响，不影响玩家对棋盘的注意力。
     */
    function playCopy() {
        if (muted) return;
        resume();
        var t = now();
        playTone(1000, 0.08, "sine", 0.12, t);
        playTone(1500, 0.1, "sine", 0.1, t + 0.06);
    }

    /* ---------- 5. 成就音 ---------- */

    /**
     * 成就解锁音：高频正弦、三角波泛音与一段噪声瞬态叠成"叮"的一声。
     * 复用共享上下文中的音效总线，不额外创建 AudioContext。
     * @sideeffect 在音频总线上排布三个短音
     */
    function playAchievement() {
        resume();
        if (!ctx || muted) return;
        try {
            var t = now();
            var osc1 = ctx.createOscillator();
            osc1.type = "sine";
            osc1.frequency.value = 1320;
            var gain1 = ctx.createGain();
            gain1.gain.setValueAtTime(0.5, t);
            gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
            osc1.connect(gain1);
            gain1.connect(sfxBus);
            osc1.start(t);
            osc1.stop(t + 0.18);

            var osc2 = ctx.createOscillator();
            osc2.type = "triangle";
            osc2.frequency.value = 2200;
            var gain2 = ctx.createGain();
            gain2.gain.setValueAtTime(0.35, t + 0.02);
            gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
            osc2.connect(gain2);
            gain2.connect(sfxBus);
            osc2.start(t + 0.01);
            osc2.stop(t + 0.12);

            var bufferSize = Math.floor(ctx.sampleRate * 0.05);
            var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            var data = buffer.getChannelData(0);
            for (var i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
            }
            var noise = ctx.createBufferSource();
            noise.buffer = buffer;
            var gainNoise = ctx.createGain();
            gainNoise.gain.setValueAtTime(0.06, t);
            gainNoise.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
            noise.connect(gainNoise);
            gainNoise.connect(sfxBus);
            noise.start(t);
            noise.stop(t + 0.06);
        } catch (e) {}
    }

    /* ---------- 6. 背景音乐配置与调度 ---------- */

    /* 播放状态：isPlaying 控制调度器，isMuted 控制音乐静音 */
    var isPlaying = false, isMuted = false, userInteracted = false;
    /* 调度状态：下一个音符的音频时刻、当前步序号、调度定时器句柄 */
    var nextNoteTime = 0, stepIndex = 0, timerID = null;
    /* 自动播放是否被浏览器拦截，界面据此提示玩家先点一下页面 */
    var autoplayBlocked = false;
    /* 复用的白噪声缓冲：鼓点每拍都要用，提前生成一次避免反复分配 */
    var noiseBuffer = null;

    /* 乐曲参数：110 BPM、4 小节、每小节 16 步，一步是十六分音符 */
    var tempo = 110;
    var stepsPerBar = 16;
    var totalBars = 4;
    var totalSteps = stepsPerBar * totalBars;
    var stepDuration = 60 / tempo / 4;

    /* 主旋律与低音谱面：MIDI 音高，0 表示该步休止 */
    var melody = [ 76, 0, 79, 0, 84, 81, 79, 0, 76, 74, 76, 0, 72, 0, 0, 0,
        79, 0, 81, 0, 84, 0, 81, 79, 77, 0, 79, 0, 76, 0, 0, 0,
        74, 0, 76, 0, 79, 76, 74, 0, 72, 0, 74, 0, 76, 0, 0, 0,
        77, 79, 81, 0, 79, 77, 76, 0, 74, 72, 71, 0, 72, 0, 0, 0 ];
    var bass = [ 48, 0, 0, 0, 48, 0, 0, 0, 48, 0, 0, 0, 48, 0, 0, 0,
        43, 0, 0, 0, 43, 0, 0, 0, 43, 0, 0, 0, 43, 0, 0, 0,
        45, 0, 0, 0, 45, 0, 0, 0, 45, 0, 0, 0, 45, 0, 0, 0,
        41, 0, 0, 0, 41, 0, 0, 0, 41, 0, 0, 0, 41, 0, 0, 0 ];
    /* 鼓点位置：底鼓在第一、三拍，军鼓在二、四拍，踩镲铺满八分音符 */
    var kickSteps = new Set([ 0, 8, 16, 24, 32, 40, 48, 56 ]);
    var snareSteps = new Set([ 4, 12, 20, 28, 36, 44, 52, 60 ]);
    var hihatSteps = new Set([ 2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58, 62 ]);

    /**
     * MIDI 音高转频率（Hz）；0 表示休止，直接返回 0。
     * @param {number} m MIDI 音高
     * @returns {number} 频率（Hz）
     */
    function mtof(m) {
        return m ? 440 * Math.pow(2, (m - 69) / 12) : 0;
    }

    /**
     * 生成并缓存 2 秒白噪声，供军鼓与踩镲反复取用。
     * @returns {AudioBuffer} 噪声缓冲
     */
    function getNoiseBuffer() {
        if (noiseBuffer) return noiseBuffer;
        var len = Math.floor(ctx.sampleRate * 2);
        noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
        var data = noiseBuffer.getChannelData(0);
        for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        return noiseBuffer;
    }

    /**
     * 排布一个背景音乐音符：短促淡入后指数衰减，接入音乐总线。
     * @param {number} freq 频率（Hz），0 表示休止
     * @param {number} time 起始时刻（音频时钟秒）
     * @param {number} duration 时长（秒）
     * @param {string} type 波形
     * @param {number} volume 音量
     * @param {number} [detune] 失谐量（音分）
     */
    function bgmTone(freq, time, duration, type, volume, detune) {
        if (isMuted || !freq || !ctx) return;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = type || "sine";
        osc.frequency.value = freq;
        if (detune) osc.detune.value = detune;
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(volume || 0.04, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
        osc.connect(gain);
        gain.connect(bgmBus);
        osc.start(time);
        osc.stop(time + duration + 0.05);
    }

    /**
     * 排布一段经过滤波的噪声，用作军鼓或踩镲。
     * @param {number} time 起始时刻
     * @param {number} duration 时长（秒）
     * @param {number} volume 音量
     * @param {number} filterFreq 滤波截止频率（Hz）
     */
    function bgmNoise(time, duration, volume, filterFreq) {
        if (isMuted || !ctx) return;
        var src = ctx.createBufferSource();
        src.buffer = getNoiseBuffer();
        var gain = ctx.createGain();
        var filter = ctx.createBiquadFilter();
        // 高频用高通做"嚓"的踩镲，中频用带通做军鼓的"哒"
        filter.type = filterFreq > 6e3 ? "highpass" : "bandpass";
        filter.frequency.value = filterFreq || 800;
        filter.Q.value = 0.4;
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(volume || 0.06, time + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(bgmBus);
        src.start(time);
        src.stop(time + duration + 0.05);
    }

    /**
     * 排布一次底鼓：频率从 150Hz 快速下滑到 35Hz，形成低频"咚"。
     * @param {number} time 起始时刻
     */
    function bgmKick(time) {
        if (isMuted || !ctx) return;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(35, time + 0.2);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.15, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
        osc.connect(gain);
        gain.connect(bgmBus);
        osc.start(time);
        osc.stop(time + 0.35);
    }

    /**
     * 排布一步的全部声部：鼓点、低音与主旋律按谱面同时触发。
     * @param {number} step 步序号（0 ~ 63）
     * @param {number} time 该步的音频时刻
     */
    function scheduleStep(step, time) {
        if (kickSteps.has(step)) bgmKick(time);
        if (snareSteps.has(step)) bgmNoise(time, 0.1, 0.06, 1800);
        if (hihatSteps.has(step)) bgmNoise(time, 0.035, 0.03, 7500);
        var b = bass[step];
        if (b) bgmTone(mtof(b), time, stepDuration * 3.5, "triangle", 0.08);
        var m = melody[step];
        if (m) {
            var f = mtof(m);
            var dur = stepDuration * (step % 2 === 0 ? 1.8 : 1.2);
            bgmTone(f, time, dur, "sine", 0.04);
        }
    }

    /**
     * 前瞻调度器：以 25ms 心跳提前约 120ms 排布音符。
     * 用音频时钟加提前量而不是依赖定时器精度，可避免主线程卡顿造成
     * 音符迟到或节拍抖动。
     */
    function scheduler() {
        if (!isPlaying || !ctx) return;
        // 提前量（秒）：覆盖两次心跳之间的调度间隔
        var lookahead = 0.12;
        while (nextNoteTime < ctx.currentTime + lookahead) {
            scheduleStep(stepIndex, nextNoteTime);
            nextNoteTime += stepDuration;
            stepIndex = (stepIndex + 1) % totalSteps;
        }
        // 心跳只负责"补排"，真正的发声时刻由音频时钟决定
        timerID = setTimeout(scheduler, 25);
    }

    /* ---------- 7. 背景音乐播放控制 ---------- */

    /**
     * 开始播放：重置调度状态并启动调度器；已在播放时不重复启动。
     */
    function bgmStart() {
        resume();
        if (!ctx) return;
        if (isPlaying) return;
        isPlaying = true;
        nextNoteTime = ctx.currentTime + 0.05;
        stepIndex = 0;
        scheduler();
    }

    /**
     * 停止播放：清除播放标记并取消调度定时器，已排布的音符自然结束。
     */
    function bgmStop() {
        isPlaying = false;
        if (timerID) {
            clearTimeout(timerID);
            timerID = null;
        }
    }

    /**
     * 页面加载后尝试自动播放；被自动播放策略拦截时注册一次性交互监听，
     * 待用户第一次点击、触摸或按键后唤醒上下文并补播。
     * @sideeffect 可能向 document 注册交互监听
     */
    function tryAutoplay() {
        resume();
        if (!ctx) return;
        bgmStart();
        // 上下文处于挂起状态，说明自动播放被浏览器拦截
        if (ctx.state === "suspended") {
            autoplayBlocked = true;
            /* 用户首次交互：唤醒上下文，成功后再补播背景音乐 */
            var onInteract = function() {
                if (userInteracted) return;
                userInteracted = true;
                try {
                    ctx.resume().then(function() {
                        if (!isPlaying) bgmStart();
                        autoplayBlocked = false;
                    })["catch"](function() {});
                } catch (e) {}
            };
            // 任一种交互都算用户手势，触发一次后监听自动解除
            [ "click", "touchstart", "keydown", "pointerdown" ].forEach(function(evt) {
                document.addEventListener(evt, onInteract, { once: true });
            });
        }
    }

    /* ---------- 8. 对外接口 ---------- */

    /* 音效门面：所有方法在音频不可用时也能安全调用 */
    window.AudioFX = {
        /* init / resume：由启动流程与首次交互调用，用于解锁音频 */
        init: ensure,
        resume: resume,
        /* 以下音效入口与第 4、5 节的实现一一对应 */
        pop: playPop,
        modalOpen: playModalOpen,
        confirm: playConfirm,
        win: playWin,
        winBrain: playWinBrain,
        toggle: playToggle,
        place: playPlace,
        remove: playRemove,
        error: playError,
        locked: playLocked,
        stepDone: playStepDone,
        copy: playCopy,
        achievement: playAchievement,
        /* 音量与静音控制：直接改写总线 Gain，立即生效 */
        setMuted: function(m) {
            muted = !!m;
        },
        isMuted: function() {
            return muted;
        },
        setVolume: function(v) {
            sfxVol = Math.max(0, Math.min(1, v));
            if (sfxBus) sfxBus.gain.value = SFX_MAX * sfxVol;
        },
        getVolume: function() {
            return sfxVol;
        },
        /* 环境能力查询：音频 API 不可用时界面会隐藏相关开关 */
        isSupported: function() {
            return supported;
        }
    };

    /* 背景音乐门面：播放控制与音量调节，play / stop 可重复调用 */
    window.RetroBGM = {
        play: bgmStart,
        stop: bgmStop,
        toggle: function() {
            return isPlaying ? window.RetroBGM.stop() : window.RetroBGM.play();
        },
        /* 音乐音量与静音控制：与音效总线互不影响 */
        setMuted: function(m) {
            isMuted = !!m;
        },
        setVolume: function(v) {
            bgmVol = Math.max(0, Math.min(1, v));
            if (bgmBus) bgmBus.gain.value = BGM_MAX * bgmVol;
        },
        getVolume: function() {
            return bgmVol;
        },
        /* 只读状态：是否正在播放 / 是否被自动播放策略拦截 */
        get isPlaying() {
            return isPlaying;
        },
        get isBlocked() {
            return autoplayBlocked;
        }
    };

    /* ---------- 9. 启动与全局入口 ---------- */

    /* 脚本可能在 DOM 解析前或解析后执行：按 readyState 选择注册时机 */
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", tryAutoplay);
    } else {
        tryAutoplay();
    }
})();

/* 首次交互时解锁音频：浏览器要求音频上下文在用户手势之后才能运行 */
document.addEventListener("click", function() {
    window.AudioFX.resume();
}, { once: true });
document.addEventListener("touchstart", function() {
    window.AudioFX.resume();
}, { once: true });
document.addEventListener("keydown", function() {
    window.AudioFX.resume();
}, { once: true });

/* 全局函数入口：其他模块按全局函数名调用成就音，内部转发到 AudioFX */
function playAchievementSound() {
    try {
        window.AudioFX.achievement();
    } catch (e) {}
}
