/* ==========================================================================
 * 反向扫雷 · 02-audio.js
 * 职责：统一音频总线（音效 AudioFX + 8bit 背景音乐 RetroBGM + 成就音）
 *
 * 修复的问题
 *  1. AudioContext 泄漏：原实现里 AudioFX、RetroBGM、playAchievementSound
 *     各自 new AudioContext()，成就密集解锁时会把浏览器允许的 AudioContext
 *     数量（Chrome 约 6 个）耗尽，之后声音静默失效，而 catch 又把错误吞掉了。
 *     → 现在全局【只有一个】AudioContext，SFX / BGM 各挂一条独立的 Gain 总线。
 *  2. 音量系数收口：0.35（音效）与 0.13（BGM）集中到 SFX_MAX / BGM_MAX 两处。
 * ========================================================================== */

(function() {
    "use strict";

    var SFX_MAX = 0.35;
    var BGM_MAX = 0.13;

    var ctx = null;
    var master = null;
    var sfxBus = null;
    var bgmBus = null;
    var reverbNode = null;
    var supported = true;

    var sfxVol = 1;      // 0~1，来自设置里的"游戏音效"
    var bgmVol = 0.5;    // 0~1，来自设置里的"背景音乐"
    var muted = false;   // 音效静音
    var lastHoverTime = 0;

    function ensure() {
        if (ctx) return ctx;
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) {
                supported = false;
                return null;
            }
            ctx = new AC();

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

    function resume() {
        ensure();
        if (ctx && ctx.state === "suspended") {
            try {
                ctx.resume();
            } catch (e) {}
        }
    }

    function now() {
        return ctx ? ctx.currentTime : 0;
    }

    /* ------------------------------ 音效 ------------------------------ */

    function playTone(freq, duration, type, vol, when, slideTo) {
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
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
        osc.connect(gain);
        gain.connect(sfxBus);
        if (reverbNode && vol > 0.15) gain.connect(reverbNode);
        osc.start(t);
        osc.stop(t + duration + 0.05);
    }

    function playPop() {
        if (muted) return;
        resume();
        var t = now();
        if (t - lastHoverTime < 0.05) return;
        lastHoverTime = t;
        playTone(880, 0.08, "sine", 0.08, t, 440);
        playTone(1320, 0.06, "sine", 0.04, t + 0.02);
    }

    function playModalOpen() {
        if (muted) return;
        resume();
        var t = now();
        [ 523.25, 659.25, 783.99, 1046.5 ].forEach(function(f, i) {
            playTone(f, 0.35, "sine", 0.18, t + i * 0.05);
        });
        playTone(2093, 0.5, "triangle", 0.08, t + 0.2);
    }

    function playConfirm() {
        if (muted) return;
        resume();
        var t = now();
        playTone(440, 0.1, "triangle", 0.25, t);
        playTone(880, 0.15, "sine", 0.2, t + 0.05);
        playTone(1760, 0.2, "sine", 0.1, t + 0.1);
    }

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

    function playToggle(on) {
        if (muted) return;
        resume();
        var t = now();
        playTone(on ? 523 : 392, 0.12, "square", 0.12, t);
        if (on) playTone(784, 0.1, "sine", 0.08, t + 0.05);
    }

    function playPlace() {
        if (muted) return;
        resume();
        var t = now();
        playTone(200, 0.08, "square", 0.2, t);
        playTone(600, 0.12, "triangle", 0.18, t + 0.03);
        playTone(1200, 0.08, "sine", 0.08, t + 0.06);
    }

    function playRemove() {
        if (muted) return;
        resume();
        var t = now();
        playTone(400, 0.1, "sawtooth", 0.15, t, 200);
        playTone(200, 0.15, "sine", 0.12, t + 0.05);
    }

    function playError() {
        if (muted) return;
        resume();
        var t = now();
        playTone(200, 0.15, "sawtooth", 0.2, t);
        playTone(150, 0.2, "sawtooth", 0.2, t + 0.12);
    }

    function playLocked() {
        if (muted) return;
        resume();
        var t = now();
        playTone(300, 0.08, "square", 0.1, t);
        playTone(280, 0.08, "square", 0.1, t + 0.08);
    }

    function playStepDone() {
        if (muted) return;
        resume();
        var t = now();
        playTone(880, 0.1, "sine", 0.15, t);
        playTone(1100, 0.15, "sine", 0.12, t + 0.08);
    }

    function playCopy() {
        if (muted) return;
        resume();
        var t = now();
        playTone(1000, 0.08, "sine", 0.12, t);
        playTone(1500, 0.1, "sine", 0.1, t + 0.06);
    }

    /* 成就音：以前每次都 new 一个 AudioContext，现在复用同一个 */
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

    /* --------------------------- 背景音乐 --------------------------- */

    var isPlaying = false, isMuted = false, userInteracted = false;
    var nextNoteTime = 0, stepIndex = 0, timerID = null;
    var autoplayBlocked = false;
    var noiseBuffer = null;

    var tempo = 110;
    var stepsPerBar = 16;
    var totalBars = 4;
    var totalSteps = stepsPerBar * totalBars;
    var stepDuration = 60 / tempo / 4;

    var melody = [ 76, 0, 79, 0, 84, 81, 79, 0, 76, 74, 76, 0, 72, 0, 0, 0,
        79, 0, 81, 0, 84, 0, 81, 79, 77, 0, 79, 0, 76, 0, 0, 0,
        74, 0, 76, 0, 79, 76, 74, 0, 72, 0, 74, 0, 76, 0, 0, 0,
        77, 79, 81, 0, 79, 77, 76, 0, 74, 72, 71, 0, 72, 0, 0, 0 ];
    var bass = [ 48, 0, 0, 0, 48, 0, 0, 0, 48, 0, 0, 0, 48, 0, 0, 0,
        43, 0, 0, 0, 43, 0, 0, 0, 43, 0, 0, 0, 43, 0, 0, 0,
        45, 0, 0, 0, 45, 0, 0, 0, 45, 0, 0, 0, 45, 0, 0, 0,
        41, 0, 0, 0, 41, 0, 0, 0, 41, 0, 0, 0, 41, 0, 0, 0 ];
    var kickSteps = new Set([ 0, 8, 16, 24, 32, 40, 48, 56 ]);
    var snareSteps = new Set([ 4, 12, 20, 28, 36, 44, 52, 60 ]);
    var hihatSteps = new Set([ 2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58, 62 ]);

    function mtof(m) {
        return m ? 440 * Math.pow(2, (m - 69) / 12) : 0;
    }

    function getNoiseBuffer() {
        if (noiseBuffer) return noiseBuffer;
        var len = Math.floor(ctx.sampleRate * 2);
        noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
        var data = noiseBuffer.getChannelData(0);
        for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        return noiseBuffer;
    }

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

    function bgmNoise(time, duration, volume, filterFreq) {
        if (isMuted || !ctx) return;
        var src = ctx.createBufferSource();
        src.buffer = getNoiseBuffer();
        var gain = ctx.createGain();
        var filter = ctx.createBiquadFilter();
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

    function scheduler() {
        if (!isPlaying || !ctx) return;
        var lookahead = 0.12;
        while (nextNoteTime < ctx.currentTime + lookahead) {
            scheduleStep(stepIndex, nextNoteTime);
            nextNoteTime += stepDuration;
            stepIndex = (stepIndex + 1) % totalSteps;
        }
        timerID = setTimeout(scheduler, 25);
    }

    function bgmStart() {
        resume();
        if (!ctx) return;
        if (isPlaying) return;
        isPlaying = true;
        nextNoteTime = ctx.currentTime + 0.05;
        stepIndex = 0;
        scheduler();
    }

    function bgmStop() {
        isPlaying = false;
        if (timerID) {
            clearTimeout(timerID);
            timerID = null;
        }
    }

    function tryAutoplay() {
        resume();
        if (!ctx) return;
        bgmStart();
        if (ctx.state === "suspended") {
            autoplayBlocked = true;
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
            [ "click", "touchstart", "keydown", "pointerdown" ].forEach(function(evt) {
                document.addEventListener(evt, onInteract, { once: true });
            });
        }
    }

    /* --------------------------- 对外接口 --------------------------- */

    window.AudioFX = {
        init: ensure,
        resume: resume,
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
        isSupported: function() {
            return supported;
        }
    };

    window.RetroBGM = {
        play: bgmStart,
        stop: bgmStop,
        toggle: function() {
            return isPlaying ? window.RetroBGM.stop() : window.RetroBGM.play();
        },
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
        get isPlaying() {
            return isPlaying;
        },
        get isBlocked() {
            return autoplayBlocked;
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", tryAutoplay);
    } else {
        tryAutoplay();
    }
})();

/* 首次交互解锁音频（浏览器自动播放策略） */
document.addEventListener("click", function() {
    window.AudioFX.resume();
}, { once: true });
document.addEventListener("touchstart", function() {
    window.AudioFX.resume();
}, { once: true });
document.addEventListener("keydown", function() {
    window.AudioFX.resume();
}, { once: true });

/* 保留原有的全局函数名，成就系统里直接调用它 */
function playAchievementSound() {
    try {
        window.AudioFX.achievement();
    } catch (e) {}
}
