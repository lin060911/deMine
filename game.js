(function() {
    "use strict";
    let ctx = null, masterGain = null;
    let isPlaying = false, isMuted = false, userInteracted = false;
    let nextNoteTime = 0, stepIndex = 0, timerID = null;
    let autoplayBlocked = false;
    const tempo = 110;
    const stepsPerBar = 16;
    const totalBars = 4;
    const totalSteps = stepsPerBar * totalBars;
    const stepDuration = 60 / tempo / 4;
    function init() {
        if (ctx) {
            if (ctx.state === "suspended") ctx.resume();
            return;
        }
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext);
            masterGain = ctx.createGain();
            masterGain.gain.value = .05;
            masterGain.connect(ctx.destination);
        } catch (e) {
            console.warn("Web Audio API not supported for BGM");
        }
    }
    function mtof(m) {
        return m ? 440 * Math.pow(2, (m - 69) / 12) : 0;
    }
    let noiseBuffer = null;
    function getNoiseBuffer() {
        if (noiseBuffer) return noiseBuffer;
        const len = ctx.sampleRate * 2;
        noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        return noiseBuffer;
    }
    function playTone(freq, time, duration, type, volume, detune) {
        if (isMuted || !freq) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type || "sine";
        osc.frequency.value = freq;
        if (detune) osc.detune.value = detune;
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(volume || .04, time + .01);
        gain.gain.exponentialRampToValueAtTime(.001, time + duration);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(time);
        osc.stop(time + duration + .05);
    }
    function playNoise(time, duration, volume, filterFreq) {
        if (isMuted) return;
        const src = ctx.createBufferSource();
        src.buffer = getNoiseBuffer();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = filterFreq > 6e3 ? "highpass" : "bandpass";
        filter.frequency.value = filterFreq || 800;
        filter.Q.value = .4;
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(volume || .06, time + .003);
        gain.gain.exponentialRampToValueAtTime(.001, time + duration);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain);
        src.start(time);
        src.stop(time + duration + .05);
    }
    function playKick(time) {
        if (isMuted) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(35, time + .2);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(.15, time + .01);
        gain.gain.exponentialRampToValueAtTime(.001, time + .3);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(time);
        osc.stop(time + .35);
    }
    const melody = [ 76, 0, 79, 0, 84, 81, 79, 0, 76, 74, 76, 0, 72, 0, 0, 0, 79, 0, 81, 0, 84, 0, 81, 79, 77, 0, 79, 0, 76, 0, 0, 0, 74, 0, 76, 0, 79, 76, 74, 0, 72, 0, 74, 0, 76, 0, 0, 0, 77, 79, 81, 0, 79, 77, 76, 0, 74, 72, 71, 0, 72, 0, 0, 0 ];
    const bass = [ 48, 0, 0, 0, 48, 0, 0, 0, 48, 0, 0, 0, 48, 0, 0, 0, 43, 0, 0, 0, 43, 0, 0, 0, 43, 0, 0, 0, 43, 0, 0, 0, 45, 0, 0, 0, 45, 0, 0, 0, 45, 0, 0, 0, 45, 0, 0, 0, 41, 0, 0, 0, 41, 0, 0, 0, 41, 0, 0, 0, 41, 0, 0, 0 ];
    const kickSteps = new Set([ 0, 8, 16, 24, 32, 40, 48, 56 ]);
    const snareSteps = new Set([ 4, 12, 20, 28, 36, 44, 52, 60 ]);
    const hihatSteps = new Set([ 2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58, 62 ]);
    function scheduleStep(step, time) {
        if (kickSteps.has(step)) playKick(time);
        if (snareSteps.has(step)) playNoise(time, .1, .06, 1800);
        if (hihatSteps.has(step)) playNoise(time, .035, .03, 7500);
        const b = bass[step];
        if (b) playTone(mtof(b), time, stepDuration * 3.5, "triangle", .08);
        const m = melody[step];
        if (m) {
            const f = mtof(m);
            const dur = stepDuration * (step % 2 === 0 ? 1.8 : 1.2);
            playTone(f, time, dur, "sine", .04);
        }
    }
    function scheduler() {
        if (!isPlaying) return;
        const lookahead = .12;
        while (nextNoteTime < ctx.currentTime + lookahead) {
            scheduleStep(stepIndex, nextNoteTime);
            nextNoteTime += stepDuration;
            stepIndex = (stepIndex + 1) % totalSteps;
        }
        timerID = setTimeout(scheduler, 25);
    }
    function start() {
        init();
        if (isPlaying) return;
        isPlaying = true;
        nextNoteTime = ctx.currentTime + .05;
        stepIndex = 0;
        scheduler();
    }
    function tryAutoplay() {
        init();
        if (!ctx) return;
        start();
        if (ctx.state === "suspended") {
            autoplayBlocked = true;
            const onInteract = () => {
                if (userInteracted) return;
                userInteracted = true;
                ctx.resume().then(() => {
                    if (!isPlaying) start();
                    autoplayBlocked = false;
                }).catch(() => {});
            };
            [ "click", "touchstart", "keydown", "pointerdown" ].forEach(evt => document.addEventListener(evt, onInteract, {
                once: true
            }));
        }
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tryAutoplay); else tryAutoplay();
    window.RetroBGM = {
        play: start,
        stop: function() {
            isPlaying = false;
            if (timerID) {
                clearTimeout(timerID);
                timerID = null;
            }
        },
        toggle: function() {
            return isPlaying ? window.RetroBGM.stop() : window.RetroBGM.play();
        },
        setMuted: function(m) {
            isMuted = m;
        },
        setVolume: function(v) {
            if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, v)) * .13;
        },
        get isPlaying() {
            return isPlaying;
        },
        get isBlocked() {
            return autoplayBlocked;
        }
    };
})();

function playAchievementSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext);
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        osc1.type = "sine";
        osc1.frequency.value = 1320;
        const gain1 = ctx.createGain();
        gain1.gain.setValueAtTime(.5, now);
        gain1.gain.exponentialRampToValueAtTime(.001, now + .15);
        osc1.connect(gain1).connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + .18);
        const osc2 = ctx.createOscillator();
        osc2.type = "triangle";
        osc2.frequency.value = 2200;
        const gain2 = ctx.createGain();
        gain2.gain.setValueAtTime(.35, now + .02);
        gain2.gain.exponentialRampToValueAtTime(.001, now + .08);
        osc2.connect(gain2).connect(ctx.destination);
        osc2.start(now + .01);
        osc2.stop(now + .12);
        const bufferSize = ctx.sampleRate * .05;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const gainNoise = ctx.createGain();
        gainNoise.gain.setValueAtTime(.06, now);
        gainNoise.gain.exponentialRampToValueAtTime(.001, now + .04);
        noise.connect(gainNoise).connect(ctx.destination);
        noise.start(now);
        noise.stop(now + .06);
    } catch (e) {}
}

let S = 10, SR = 10, SC = 10, T = 6, TY = 3, SP = 4;

const LIMIT = {
    size: [ 8, 20 ],
    total: [ 2, 24 ],
    type: [ 0, 22 ],
    spec: [ 0, 99 ]
};

const PRE = {
    easy: {
        size: 8,
        total: 4,
        type: 2,
        spec: 3
    },
    medium: {
        size: 10,
        total: 8,
        type: 4,
        spec: 6
    },
    hard: {
        size: 12,
        total: 12,
        type: 6,
        spec: 9
    },
    hell: {
        size: 14,
        total: 14,
        type: 8,
        spec: 12
    },
    brain: {
        size: 12,
        total: 16,
        type: 12,
        spec: 14
    },
    free: {
        size: 10,
        total: 6,
        type: 3,
        spec: 3
    }
};

const DIFF_LABEL = {
    easy: "简单",
    medium: "中等",
    hard: "困难",
    hell: "地狱",
    brain: "脑王",
    free: "自由"
};

const BRAIN_HELL_WINS_REQ = 10;

let diff = null;

let st = 0;

let ti = null;

let ct = 0;

let ts = false;

let isFreeMode = false;

let seriesLocked = false;

let isPresetPending = false;

let pendingDiff = null;

let lt = JSON.parse(localStorage.getItem("mineLastTimes")) || {
    easy: null,
    medium: null,
    hard: null,
    hell: null,
    brain: null
};

let rec = JSON.parse(localStorage.getItem("mineRecords")) || {
    easy: null,
    medium: null,
    hard: null,
    hell: null,
    brain: null
};

let wins = JSON.parse(localStorage.getItem("mineWins")) || {
    easy: 0,
    medium: 0,
    hard: 0,
    hell: 0,
    brain: 0
};

let brainUnlockedNotified = localStorage.getItem("brainUnlockedNotified") === "true";

function getSeriesState() {
    let saved = localStorage.getItem("seriesState");
    if (saved) {
        try {
            return JSON.parse(saved);
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
    localStorage.setItem("seriesState", JSON.stringify(s));
}

function getSeriesUnlocked() {
    let saved = localStorage.getItem("seriesUnlocked");
    if (saved) {
        try {
            return JSON.parse(saved);
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
    localStorage.setItem("seriesUnlocked", JSON.stringify(u));
}

let seriesState = getSeriesState();

let seriesUnlocked = getSeriesUnlocked();

seriesState.basic = true;

seriesUnlocked.basic = true;

saveSeriesState(seriesState);

saveSeriesUnlocked(seriesUnlocked);

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

let selectedMineType = null;

let G = {
    tar: [],
    p: [],
    placed: {},
    pool: {},
    max: 0,
    drag: null,
    lastDragType: null
};

let currentTutorialType = null;

let tutorialStep = 0;

let isTutorialMode = false;

document.getElementById("toggleRuleSidebar").onclick = () => {
    AudioFX.confirm();
    const ruleSb = document.getElementById("ruleSidebar");
    ruleSb.classList.toggle("open");
    const infoSb = document.getElementById("infoSidebar");
    if (ruleSb.classList.contains("open") && infoSb.classList.contains("open")) infoSb.classList.remove("open");
};

document.getElementById("toggleInfoSidebar").onclick = () => {
    AudioFX.confirm();
    const infoSb = document.getElementById("infoSidebar");
    infoSb.classList.toggle("open");
    const ruleSb = document.getElementById("ruleSidebar");
    if (infoSb.classList.contains("open") && ruleSb.classList.contains("open")) ruleSb.classList.remove("open");
};

document.getElementById("toggleSidebar").onclick = () => {
    AudioFX.confirm();
    document.getElementById("sidebar").classList.toggle("open");
    renderSeriesSwitches();
};

document.addEventListener("click", e => {
    const ruleSb = document.getElementById("ruleSidebar");
    const ruleBtn = document.getElementById("toggleRuleSidebar");
    const infoSb = document.getElementById("infoSidebar");
    const infoBtn = document.getElementById("toggleInfoSidebar");
    const sb = document.getElementById("sidebar");
    const btn = document.getElementById("toggleSidebar");
    const modeLink = e.target && e.target.closest ? e.target.closest(".rule-mode-link") : null;
    if (!ruleSb.contains(e.target) && e.target !== ruleBtn && ruleSb.classList.contains("open")) ruleSb.classList.remove("open");
    if (!infoSb.contains(e.target) && e.target !== infoBtn && infoSb.classList.contains("open")) infoSb.classList.remove("open");
    if (!sb.contains(e.target) && e.target !== btn && !modeLink && sb.classList.contains("open")) sb.classList.remove("open");
});

function renderSeriesSwitches() {
    const container = document.getElementById("seriesSwitchList");
    if (!container) return;
    let html = "";
    const catOrder = [ "basic", "special", "physics", "symmetry", "tactical" ];
    catOrder.forEach(catKey => {
        let unlocked = seriesUnlocked[catKey];
        let on = seriesState[catKey];
        let cat = CATEGORY[catKey];
        let lockEmoji = unlocked ? "🔓" : "🔒";
        html += `<div class="switch-row ${unlocked ? "unlocked" : "locked-row"}">`;
        html += `<div class="switch-label"><span class="lock-emoji">${lockEmoji}</span><span class="cat-name">${cat.emoji} ${cat.name}</span></div>`;
        if (catKey === "basic") {
            html += `<div class="switch-toggle on" style="cursor:default;opacity:0.7"></div>`;
        } else {
            html += `<div class="switch-toggle ${on ? "on" : ""} ${unlocked ? "" : "disabled"}" onclick="event.stopPropagation();${unlocked ? "toggleSeries('" + catKey + "')" : ""}"></div>`;
        }
        html += `</div>`;
    });
    container.innerHTML = html;
    let hint = document.getElementById("seriesSwitchHint");
    let onCount = getSeriesOnCount();
    if (onCount < 5) {
        hint.className = "switch-hint";
        let need = onCount < 3 ? "≥3个才能使用<strong>简单/中等/困难</strong>" : "<strong>简单/中等/困难</strong>已可用✅<br>所有系列全开才能挑战<strong>地狱/脑王</strong>";
        hint.innerHTML = `当前开启<strong> ${onCount}/5 </strong>个系列<br>${need}<br>💡前往<strong>页面左侧[💣信息]</strong>通关系列<strong>挑战</strong>可解锁`;
    } else {
        hint.className = "switch-hint unlock-hint";
        let brainReady = (wins.hell || 0) >= BRAIN_HELL_WINS_REQ;
        if (brainReady) {
            hint.textContent = `全部 ${onCount}/5 个系列已开启 ✅ 地狱 & 脑王均可挑战`;
        } else {
            hint.innerHTML = `全部 ${onCount}/5 个系列已开启 ✅ 地狱可用<br>地狱通关${BRAIN_HELL_WINS_REQ}次后解锁<strong>脑王🤯</strong>`;
        }
    }
    updatePresetButtons();
}

function toggleSeries(catKey) {
    if (catKey === "basic") return;
    if (seriesLocked) return;
    if (!seriesUnlocked[catKey]) return;
    seriesState[catKey] = !seriesState[catKey];
    saveSeriesState(seriesState);
    AudioFX.toggle(seriesState[catKey]);
    renderSeriesSwitches();
}

function unlockSeries(catKey) {
    seriesUnlocked[catKey] = true;
    seriesState[catKey] = true;
    saveSeriesUnlocked(seriesUnlocked);
    saveSeriesState(seriesState);
    renderSeriesSwitches();
}

function getSeriesOnCount() {
    const knownKeys = [ "basic", "special", "physics", "symmetry", "tactical" ];
    return knownKeys.filter(k => seriesState[k] === true).length;
}

function checkBrainUnlocked() {
    let hellWins = wins.hell || 0;
    let seriesCount = getSeriesOnCount();
    return hellWins >= BRAIN_HELL_WINS_REQ && seriesCount >= 5;
}

function updatePresetButtons() {
    let onCount = getSeriesOnCount();
    let normalLocked = onCount < 3;
    let hellLocked = onCount < 5;
    let brainLocked = !checkBrainUnlocked();
    [ "btnEasy", "btnMedium", "btnHard" ].forEach(id => {
        let btn = document.getElementById(id);
        if (!btn) return;
        if (isFreeMode) {
            btn.classList.remove("locked");
            return;
        }
        if (normalLocked) btn.classList.add("locked"); else btn.classList.remove("locked");
    });
    let btnHell = document.getElementById("btnHell");
    if (btnHell) {
        if (isFreeMode) {
            btnHell.classList.remove("locked");
        } else if (hellLocked) btnHell.classList.add("locked"); else btnHell.classList.remove("locked");
    }
    let btnBrain = document.getElementById("btnBrain");
    if (btnBrain) {
        if (isFreeMode) {
            btnBrain.classList.remove("locked");
        } else if (brainLocked) btnBrain.classList.add("locked"); else btnBrain.classList.remove("locked");
    }
    let btnFree = document.getElementById("btnFree");
    if (btnFree) {
        btnFree.classList.remove("locked");
    }
}

function checkPresetAllowed(d) {
    let onCount = getSeriesOnCount();
    if (d === "brain") return checkBrainUnlocked();
    if (d === "hell") return onCount >= 5;
    return onCount >= 3;
}

function isPresetDifficulty(d) {
    return d === "easy" || d === "medium" || d === "hard" || d === "hell" || d === "brain";
}

function setPre(d) {
    fullReset();
    if (d === "free") {
        isFreeMode = true;
        seriesLocked = false;
        diff = "free";
        document.getElementById("customPanel").classList.add("visible");
        document.getElementById("seriesLockedNotice").classList.remove("visible");
        updatePresetButtons();
        renderSeriesSwitches();
        resetTi();
        document.getElementById("timer").style.display = "none";
        AudioFX.confirm();
        applySet();
        return;
    }
    if (!checkPresetAllowed(d)) {
        if (d === "brain") {
            document.getElementById("brainHellWins").textContent = wins.hell || 0;
            document.getElementById("brainSeriesCount").textContent = getSeriesOnCount();
            document.getElementById("overlay").style.display = "block";
            document.getElementById("brainLockedModal").style.display = "block";
            AudioFX.modalOpen();
        } else if (d === "hell") {
            document.getElementById("hellLockedCount").textContent = getSeriesOnCount();
            document.getElementById("overlay").style.display = "block";
            document.getElementById("hellLockedModal").style.display = "block";
            AudioFX.modalOpen();
        } else {
            document.getElementById("overlay").style.display = "block";
            document.getElementById("presetLockedModal").style.display = "block";
            AudioFX.modalOpen();
        }
        return;
    }
    isFreeMode = false;
    seriesLocked = true;
    const p = PRE[d];
    S = p.size;
    SR = p.size;
    SC = p.size;
    T = p.total;
    TY = p.type;
    SP = p.spec;
    SP = Math.min(SP, T);
    TY = Math.min(TY, SP);
    document.getElementById("size").textContent = S;
    document.getElementById("total").textContent = T;
    document.getElementById("type").textContent = TY;
    document.getElementById("spec").textContent = SP;
    diff = d;
    pendingDiff = d;
    document.getElementById("customPanel").classList.remove("visible");
    document.getElementById("seriesLockedNotice").classList.add("visible");
    updatePresetButtons();
    renderSeriesSwitches();
    AudioFX.confirm();
    if (isPresetDifficulty(d)) {
        enterPresetPending(d);
    }
}

function enterPresetPending(d) {
    G.tar = [];
    G.p = [];
    G.placed = {};
    G.pool = {};
    G.max = 0;
    isPresetPending = true;
    pendingDiff = d;
    var board = document.getElementById("board");
    board.innerHTML = "";
    board.style.display = "none";
    var slot = document.getElementById("slot");
    var teachBubble = document.getElementById("teachBubble");
    slot.innerHTML = "";
    if (teachBubble) slot.appendChild(teachBubble);
    slot.style.display = "none";
    document.getElementById("timer").style.display = "none";
    document.getElementById("placed").textContent = "0";
    document.getElementById("max").textContent = "0";
    document.getElementById("win").style.display = "none";
    var labelMap = {
        easy: "😎简单",
        medium: "😮中等",
        hard: "😤困难",
        hell: "👿地狱",
        brain: "🤯脑王"
    };
    document.getElementById("presetStartIcon").textContent = "👌";
    document.getElementById("presetStartTitle").textContent = "准备好了吗?";
    document.getElementById("presetStartDesc").textContent = "点击开始后题目将展现并启动计时(≧▽≦)";
    var tag = document.getElementById("presetStartTag");
    tag.className = "preset-start-tag tag-" + d;
    document.getElementById("presetStartTagText").textContent = labelMap[d] || d;
    document.getElementById("presetStartCard").style.display = "flex";
    AudioFX.modalOpen();
}

function setVal(key, dir) {
    let [min, max] = LIMIT[key];
    let val = key === "size" ? S : key === "total" ? T : key === "type" ? TY : SP;
    val = Math.max(min, Math.min(max, val + dir));
    if (key === "size") {
        S = val;
        SR = val;
        SC = val;
    }
    if (key === "total") T = val;
    if (key === "type") TY = val;
    if (key === "spec") SP = val;
    SP = Math.min(SP, T);
    TY = Math.min(TY, SP);
    document.getElementById("size").textContent = S;
    document.getElementById("total").textContent = T;
    document.getElementById("type").textContent = TY;
    document.getElementById("spec").textContent = SP;
    AudioFX.pop();
    diff = null;
}

function applySet() {
    AudioFX.confirm();
    SP = Math.min(SP, T);
    TY = Math.min(TY, SP);
    if (isFreeMode) {
        diff = "free";
        newGame();
        return;
    }
    if (isPresetPending && pendingDiff) {
        beginPresetGame();
    } else {
        newGame();
    }
}

function startTiOnFirst() {
    if (!diff || ts) return;
    if (isFreeMode) return;
    ts = true;
    startTi();
}

function startTi() {
    stopTi();
    st = Date.now();
    ti = setInterval(updateTi, 10);
    document.getElementById("timer").style.display = "block";
}

function stopTi() {
    if (ti) clearInterval(ti);
}

function updateTi() {
    const e = Date.now() - st;
    ct = e;
    document.getElementById("timer").textContent = `${String(Math.floor(e / 6e4)).padStart(2, "0")}:${String(Math.floor(e / 1e3) % 60).padStart(2, "0")}.${String(Math.floor(e % 1e3 / 10)).padStart(2, "0")}`;
}

function resetTi() {
    stopTi();
    ts = false;
    ct = 0;
    document.getElementById("timer").textContent = "00:00.00";
    document.getElementById("timer").style.display = "none";
}

function saveRec() {
    if (!diff) return;
    if (isFreeMode) {
        renderRec();
        return;
    }
    lt[diff] = ct;
    localStorage.setItem("mineLastTimes", JSON.stringify(lt));
    if (rec[diff] === null || ct < rec[diff]) {
        rec[diff] = ct;
        localStorage.setItem("mineRecords", JSON.stringify(rec));
    }
    wins[diff] = (wins[diff] || 0) + 1;
    localStorage.setItem("mineWins", JSON.stringify(wins));
    renderRec();
    if (diff === "hell" && !brainUnlockedNotified) {
        if (checkBrainUnlocked()) {
            brainUnlockedNotified = true;
            localStorage.setItem("brainUnlockedNotified", "true");
            setTimeout(() => {
                document.getElementById("overlay").style.display = "block";
                document.getElementById("brainUnlockedModal").style.display = "block";
                AudioFX.modalOpen();
            }, 1500);
        }
    }
}

function fmtTime(ms) {
    if (ms == null) return "暂无纪录";
    return `${String(Math.floor(ms / 6e4)).padStart(2, "0")}:${String(Math.floor(ms / 1e3) % 60).padStart(2, "0")}.${String(Math.floor(ms % 1e3 / 10)).padStart(2, "0")}`;
}

function renderRec() {
    const list = document.getElementById("recordList");
    if (!list) return;
    let html = "";
    [ "easy", "medium", "hard", "hell", "brain" ].forEach(d => {
        let label = DIFF_LABEL[d] || d;
        let icon = d === "brain" ? "🤯" : d === "hell" ? "👿" : d === "hard" ? "😤" : d === "medium" ? "😮" : "😎";
        let extraStyle = d === "brain" ? "#ffd700;background: linear-gradient(135deg, #fffcbb 0%, #c0f1ff 25%, #c0d7ff 50%, #ddbfff 75%, #f8bfff 100%);" : d === "hell" ? "#6b21a8;" : d === "hard" ? "#d73a3a;" : d === "medium" ? "#dc7f33;" : "#38a169;";
        html += `<div class="record-item" style="border-color:${extraStyle}">`;
        html += `<div class="record-label">${icon}${label}</div>`;
        html += `本次用时：<span class="record-current">${fmtTime(lt[d])}</span>`;
        html += `</div>`;
    });
    list.innerHTML = html;
}

document.addEventListener("mouseover", e => {
    let el = e.target;
    if (el.closest(".switch-toggle") || el.closest(".switch-row")) return;
    if (el.matches && el.matches("button, .preset-btn, .num-btn, .apply-btn, .sidebar-toggle, .info-sidebar-toggle, .rule-sidebar-toggle, .tutorial-btn-inline, .mine-item, .win button, .auto-modal button")) {
        if (el.classList.contains("disabled") || el.classList.contains("locked") || el.classList.contains("locked-row")) return;
        AudioFX.pop();
    }
}, true);

let _fallingInterval = null;

let _fallingActive = false;

const _FALLING_EMOJIS = [ "💣", "💡", "🎉", "🤯", "😎", "❤️", "🏆", "🎊", "🥳", "🤩", "🧐", "✌️", "💪", "🤙", "👌", "🤟", "👏", "🎖️", "👑" ];

const _MAX_FALLING_NODES = 120;

function startFallingEmoji() {
    const container = document.getElementById("fallingContainer");
    if (!container) return;
    if (_fallingActive) return;
    _fallingActive = true;
    function removeNode(el) {
        if (!el || !el.parentNode) return;
        el.parentNode.removeChild(el);
    }
    function spawnOne() {
        if (!_fallingActive) return;
        if (container.childElementCount >= _MAX_FALLING_NODES) {
            let oldest = container.firstElementChild;
            if (oldest) removeNode(oldest);
        }
        let span = document.createElement("span");
        span.className = "falling-emoji";
        span.textContent = _FALLING_EMOJIS[Math.floor(Math.random() * _FALLING_EMOJIS.length)];
        span.style.left = Math.random() * 100 + "%";
        let dur = (3 + Math.random() * 4).toFixed(2);
        span.style.animationDuration = dur + "s";
        span.style.animationDelay = "0s";
        span.style.fontSize = 20 + Math.random() * 20 + "px";
        span.addEventListener("animationend", () => removeNode(span), {
            once: true
        });
        container.appendChild(span);
    }
    for (let i = 0; i < 40; i++) {
        setTimeout(spawnOne, Math.random() * 600);
    }
    _fallingInterval = setInterval(spawnOne, 180);
}

function stopFallingEmoji() {
    _fallingActive = false;
    if (_fallingInterval) {
        clearInterval(_fallingInterval);
        _fallingInterval = null;
    }
    const container = document.getElementById("fallingContainer");
    if (container) container.innerHTML = "";
}

function setGoldenBackground() {
    document.body.classList.add("brain-golden");
    setTimeout(() => {
        document.body.classList.remove("brain-golden");
    }, 6e4);
}

function checkWin() {
    if (teachActive) return;
    if (Object.keys(G.placed).length !== G.max) return;
    for (let r = 0; r < SR; r++) for (let c = 0; c < SC; c++) if (G.p[r][c] !== G.tar[r][c]) return;
    stopTi();
    if (isTutorialMode) {
        onTutorialWin();
        return;
    }
    if (isFreeMode) {
        AudioFX.win();
        document.getElementById("win").style.display = "flex";
        checkWinAchievements();
        return;
    }
    if (diff === "brain") {
        AudioFX.winBrain();
        startFallingEmoji();
        setGoldenBackground();
        document.getElementById("win").style.display = "flex";
        document.getElementById("brainWinModal").style.display = "block";
        saveRec();
        try {
            localStorage.setItem("brainCleared", "true");
        } catch (e) {}
        applyBrainEgg();
    } else {
        AudioFX.win();
        saveRec();
        document.getElementById("win").style.display = "flex";
    }
    checkWinAchievements();
}

function closeBrainUnlockedModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("brainUnlockedModal").style.display = "none";
}

function closeBrainLockedModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("brainLockedModal").style.display = "none";
}

function closeBrainWinModal() {
    AudioFX.confirm();
    document.getElementById("brainWinModal").style.display = "none";
    stopFallingEmoji();
    document.body.classList.remove("brain-golden");
}

function closeWelcomeModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("welcomeModal").style.display = "none";
}

function closeTutorialComplete() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("tutorialCompleteModal").style.display = "none";
    if (!currentTutorialType) setTimeout(() => {
        document.getElementById("overlay").style.display = "block";
        document.getElementById("moreTutorialGuide").style.display = "block";
        AudioFX.modalOpen();
    }, 300);
}

function closeMoreTutorialGuide() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("moreTutorialGuide").style.display = "none";
}

function closePresetLockedModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("presetLockedModal").style.display = "none";
}

function closeHellLockedModal() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("hellLockedModal").style.display = "none";
}

document.getElementById("overlay").addEventListener("click", () => {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("welcomeModal").style.display = "none";
    document.getElementById("tutorialPrompt").style.display = "none";
    document.getElementById("tutorialCompleteModal").style.display = "none";
    document.getElementById("moreTutorialGuide").style.display = "none";
    document.getElementById("presetLockedModal").style.display = "none";
    document.getElementById("hellLockedModal").style.display = "none";
    document.getElementById("brainUnlockedModal").style.display = "none";
    document.getElementById("brainLockedModal").style.display = "none";
});

function genGame() {
    let enabled = getEnabledMineKeys();
    if (!enabled.includes("normal")) enabled.unshift("normal");
    let specials = enabled.filter(k => k !== "normal");
    specials.sort(() => Math.random() - .5);
    let sel = specials.slice(0, Math.min(TY, specials.length));
    while (sel.length < TY && specials.length > 0) {
        sel.push(specials[Math.floor(Math.random() * specials.length)]);
    }
    let pool = {};
    let normalNeeded = Math.max(1, T - SP);
    pool.normal = normalNeeded;
    let rem = SP;
    sel.forEach(t => {
        pool[t] = (pool[t] || 0) + 1;
        rem--;
    });
    while (rem > 0 && sel.length > 0) {
        let t = sel[Math.floor(Math.random() * sel.length)];
        pool[t]++;
        rem--;
    }
    while (rem > 0) {
        pool.normal++;
        rem--;
    }
    for (let k of Object.keys(M)) {
        if (pool[k] === undefined) pool[k] = 0;
    }
    let mines = [];
    for (let t in pool) for (let i = 0; i < pool[t]; i++) mines.push(t);
    mines = mines.slice(0, T);
    let pos = new Set, ans = {};
    while (mines.length) {
        let r = Math.random() * SR | 0, c = Math.random() * SC | 0, k = r + "," + c;
        if (!pos.has(k)) {
            pos.add(k);
            ans[k] = mines.pop();
        }
    }
    let tar = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let k in ans) {
        let [r, c] = k.split(",");
        M[ans[k]].f(+r, +c, tar);
    }
    applyTacticalEffects(tar, ans);
    G.tar = tar;
    G.pool = pool;
    G.max = T;
    G.placed = {};
    resetP();
}

function genTutorialGame(categoryKey) {
    let allowed = [ "normal", "big5", "high", "chiliV", "chiliH", "chiliPlus" ];
    if (categoryKey) {
        let catBombs = Object.keys(M).filter(k => M[k].category === categoryKey);
        allowed = allowed.concat(catBombs);
    }
    let pool = {};
    pool.normal = Math.max(1, T - SP);
    let specials = allowed.filter(k => k !== "normal");
    let remain = T - pool.normal;
    while (remain > 0) {
        let t = specials[Math.floor(Math.random() * specials.length)];
        pool[t] = (pool[t] || 0) + 1;
        remain--;
    }
    for (let k of Object.keys(M)) {
        if (pool[k] === undefined) pool[k] = 0;
    }
    let mines = [];
    for (let t in pool) for (let i = 0; i < pool[t]; i++) mines.push(t);
    mines = mines.slice(0, T);
    let pos = new Set, ans = {};
    while (mines.length) {
        let r = Math.random() * SR | 0, c = Math.random() * SC | 0, k = r + "," + c;
        if (!pos.has(k)) {
            pos.add(k);
            ans[k] = mines.pop();
        }
    }
    let tar = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let k in ans) {
        let [r, c] = k.split(",");
        M[ans[k]].f(+r, +c, tar);
    }
    applyTacticalEffects(tar, ans);
    G.tar = tar;
    G.pool = pool;
    G.max = T;
    G.placed = {};
    resetP();
}

function setupTutorialParams() {
    diff = null;
    document.getElementById("size").textContent = S;
    document.getElementById("total").textContent = T;
    document.getElementById("type").textContent = TY;
    document.getElementById("spec").textContent = SP;
}

function genPreHtml(mk) {
    const mine = M[mk];
    if (!mine.preview) return "<div>无预览</div>";
    const {size: size, active: active, center: center, values: values, split: split} = mine.preview;
    const isPlus1 = !values;
    let diagonal = "";
    if (split) diagonal = `<svg class="diagonal-line" viewBox="0 0 ${size} ${size}"><line x1="${size}" y1="0" x2="0" y2="${size}" stroke="#666" stroke-width="0.2"/></svg>`;
    let html = `<div class="preview-grid" style="grid-template-columns: repeat(${size}, 20px);">${diagonal}`;
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
        let cls = "preview-cell";
        let isC = i === center[0] && j === center[1];
        let isA = active.some(([x, y]) => x === i && y === j);
        let val = !isPlus1 && values && values[i] && values[i][j] !== undefined ? values[i][j] : null;
        if (isC) {
            cls += " center";
        } else if (isA) {
            if (val !== null && val < 0) {
                cls += " negative";
            } else if (split) {
                if (i < 3 && j < 3) cls += " split-left"; else if (i >= 3 && j >= 3) cls += " split-right";
            } else {
                cls += " active";
            }
        }
        let cv = val !== null && val !== "" ? val : "";
        html += `<div class="${cls}">${cv}</div>`;
    }
    html += "</div>";
    return html;
}

function renderMineInfo() {
    const list = document.getElementById("mineInfoList");
    let html = "";
    const catOrder = [ "basic", "special", "physics", "symmetry", "tactical" ];
    catOrder.forEach(catKey => {
        let unlocked = seriesUnlocked[catKey];
        let cat = CATEGORY[catKey];
        let bombs = Object.keys(M).filter(k => M[k].category === catKey);
        if (bombs.length === 0) return;
        html += `<div class="category-section">`;
        html += `<div class="category-header"><strong>${cat.emoji} ${cat.name}</strong>`;
        if (catKey === "basic") {
            html += `<span style="margin-left:auto;font-size:12px;color:#38a169;">✅始终开启</span>`;
            html += `<button class="tutorial-btn-inline" onclick="openPracticeMode()">新手关卡</button>`;
        } else if (unlocked) {
            html += `<button class="tutorial-btn-inline" onclick="startCategoryTutorial('${catKey}')">练习</button>`;
            html += `<span style="margin-left:8px;font-size:12px;color:#38a169;">🔓已解锁</span>`;
        } else {
            html += `<button class="tutorial-btn-inline" onclick="startCategoryTutorial('${catKey}')" style="border-color:#805ad5;color:#805ad5;background:#f5f0ff;">挑战</button>`;
            html += `<span style="margin-left:8px;font-size:12px;color:#a0aec0;">🔒未解锁</span>`;
        }
        html += `</div>`;
        bombs.forEach(key => {
            let m = M[key];
            let wrapStyle = unlocked ? "" : "opacity:0.75;";
            html += `<div class="mine-info-item" style="${wrapStyle}">\n                        <div class="mine-info-header">\n                            <div class="mine-info-emoji ${m.cls}">${m.e}</div>\n                            <div class="mine-info-name">${m.n}</div>\n                            ${unlocked ? "" : '<span style="margin-left:auto;font-size:11px;color:#a0aec0;">🔒</span>'}\n                        </div>\n                        <div class="mine-info-desc">${m.tip}</div>\n                        <div class="mine-info-tip">\n                            ℹ️查看影响范围\n                            <div class="mine-preview">${genPreHtml(key)}</div>\n                        </div>\n                    </div>`;
        });
        html += `</div>`;
    });
    list.innerHTML = html;
}

function resetP() {
    G.p = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let k in G.placed) {
        let [r, c] = k.split(",");
        M[G.placed[k]].f(+r, +c, G.p);
    }
    applyTacticalEffects(G.p, G.placed);
}

function applyBrainEgg() {
    let cleared = false;
    try {
        cleared = localStorage.getItem("brainCleared") === "true";
    } catch (e) {}
    if (!cleared) return;
    let titleEl = document.querySelector(".game-title");
    if (!titleEl) return;
    titleEl.textContent = titleEl.textContent.replace(/💣/g, "😎");
    titleEl.title = "大佬的墨镜，实力无需多言";
}

const PLACE_MODE_KEY = "placeMode_v1";

window._placeMode = "drag";

function currentBoardKind() {
    if (createModeActive) return "create";
    if (teachActive) return "teach";
    return "main";
}

function calcCellSize(rows, cols) {
    const MAX = 40, MIN = 16, GAP = 2, PAD = 8;
    let vw = window.innerWidth || 0;
    if (!vw && document.documentElement) vw = document.documentElement.clientWidth || 0;
    if (!vw && document.body) vw = document.body.clientWidth || 0;
    if (!vw || vw > 700) return MAX;
    const byW = Math.floor((vw - 14 - PAD - GAP * (cols - 1)) / cols);
    const vh = window.innerHeight || 0;
    const byH = vh ? Math.floor((vh * .5 - PAD - GAP * (rows - 1)) / rows) : MAX;
    return Math.max(MIN, Math.min(MAX, Math.min(byW, byH)));
}

function applyBoardMetrics(board, rows, cols) {
    if (!board) return;
    const cs = calcCellSize(rows, cols);
    board.style.gridTemplateRows = `repeat(${rows},${cs}px)`;
    board.style.gridTemplateColumns = `repeat(${cols},${cs}px)`;
    board.style.setProperty("--cell-size", cs + "px");
    board.dataset.cellSize = cs;
}

function sizeCellsIn(board) {
    if (!board) return;
    const cs = parseInt(board.dataset.cellSize, 10) || 40;
    const fs = Math.max(11, Math.min(18, Math.round(cs * .45)));
    Array.prototype.forEach.call(board.querySelectorAll(".cell"), function(el) {
        el.style.width = cs + "px";
        el.style.height = cs + "px";
        el.style.fontSize = fs + "px";
    });
    const es = Math.max(12, Math.round(cs * .58));
    Array.prototype.forEach.call(board.querySelectorAll(".cell span"), function(el) {
        el.style.fontSize = es + "px";
    });
}

function getSelectedType(kind) {
    if (kind === "create") return window._createSelectedType;
    if (kind === "teach") return window._teachSelectedType;
    return selectedMineType;
}

function setSelectedType(kind, t) {
    if (kind === "create") {
        window._createSelectedType = t;
        return;
    }
    if (kind === "teach") {
        window._teachSelectedType = t;
        return;
    }
    selectedMineType = t;
    if (t) G.lastDragType = t;
}

function toggleSelectedType(kind, t) {
    setSelectedType(kind, getSelectedType(kind) === t ? null : t);
    AudioFX.pop();
    if (kind === "create") renderCreateMineSlot(); else if (kind === "teach") renderTeachSlot(); else renderSlot();
}

function slotTypeFull(t, kind) {
    if (kind === "create") {
        const total = (createRows || 10) * (createCols || 10);
        return Object.keys(createPlaced).length >= Math.floor(total * .6);
    }
    if (kind === "teach") {
        const lvl = typeof TEACH_LEVELS !== "undefined" && TEACH_LEVELS[teachLevelIdx] ? TEACH_LEVELS[teachLevelIdx] : null;
        const mt = lvl ? lvl.mineTypes || (lvl.mineType ? {
            [lvl.mineType]: 1
        } : {}) : {};
        return (teachPlacedTypes[t] || 0) >= (mt[t] || 0);
    }
    const used = Object.values(G.placed).filter(x => x === t).length;
    return used >= (G.pool[t] || 0);
}

function fakeDropEvent(type) {
    return {
        dataTransfer: {
            getData: function() {
                return type || "";
            }
        },
        preventDefault: function() {},
        stopPropagation: function() {}
    };
}

function placeAtCell(kind, cell, type) {
    const r = +cell.dataset.r, c = +cell.dataset.c;
    if (kind === "create") {
        createPlace(r, c, type);
        return;
    }
    if (kind === "teach") {
        teachDrop(r, c, type);
        return;
    }
    drop.call(cell, fakeDropEvent(type));
}

function moveMineTo(kind, fromKey, cell) {
    const r = +cell.dataset.r, c = +cell.dataset.c, toKey = r + "," + c;
    if (fromKey === toKey) return;
    if (kind === "create") {
        createMove(fromKey, r, c);
        return;
    }
    if (kind === "teach") {
        teachMove(fromKey, r, c);
        return;
    }
    G.drag = fromKey;
    drop.call(cell, fakeDropEvent(null));
    G.drag = null;
}

function removeAtCell(kind, r, c) {
    if (kind === "create") {
        createRemove(r, c);
        return;
    }
    if (kind === "teach") {
        teachRemove(r, c);
        return;
    }
    del(r, c);
}

function dropAt(cell, kind, type, fromKey) {
    if (!cell) return;
    const map = kind === "create" ? createPlaced : G.placed;
    if (fromKey && map[fromKey]) {
        moveMineTo(kind, fromKey, cell);
        return;
    }
    if (!type) type = getSelectedType(kind);
    if (!type && kind === "main") type = G.lastDragType;
    placeAtCell(kind, cell, type);
}

function bindCellDrag(cell, kind) {
    const r = +cell.dataset.r, c = +cell.dataset.c;
    const key = r + "," + c;
    const map = kind === "create" ? createPlaced : G.placed;
    const hasMine = !!map[key];
    const isDrag = window._placeMode === "drag";
    if (isDrag && hasMine) {
        cell.draggable = true;
        cell.ondragstart = function(e) {
            try {
                e.dataTransfer.setDragImage(new Image, 0, 0);
            } catch (_) {}
            G.drag = key;
            try {
                e.dataTransfer.setData("text/plain", "");
                e.dataTransfer.effectAllowed = "move";
            } catch (_) {}
            cell.classList.add("dragging");
        };
        cell.ondragend = function() {
            cell.classList.remove("dragging");
            G.drag = null;
        };
    } else {
        cell.draggable = false;
        cell.ondragstart = null;
        cell.ondragend = null;
    }
    if (isDrag) {
        cell.ondragover = function(e) {
            e.preventDefault();
            cell.classList.add("drag-over");
        };
        cell.ondragleave = function() {
            cell.classList.remove("drag-over");
        };
        cell.ondrop = function(e) {
            e.preventDefault();
            cell.classList.remove("drag-over");
            let t = null;
            try {
                t = e.dataTransfer.getData("text/plain");
            } catch (_) {}
            dropAt(cell, kind, t, G.drag);
        };
    } else {
        cell.ondragover = null;
        cell.ondragleave = null;
        cell.ondrop = null;
    }
}

function bindSlotItemDrag(div, t, kind) {
    const full = slotTypeFull(t, kind);
    const isDrag = window._placeMode === "drag";
    if (isDrag) {
        div.draggable = !full;
        div.ondragstart = function(e) {
            try {
                e.dataTransfer.setDragImage(new Image, 0, 0);
            } catch (_) {}
            if (full) {
                e.preventDefault();
                return;
            }
            G.drag = null;
            setSelectedType(kind, t);
            try {
                e.dataTransfer.setData("text/plain", t);
                e.dataTransfer.effectAllowed = "move";
            } catch (_) {}
            div.classList.add("dragging");
            AudioFX.pop();
        };
        div.ondragend = function() {
            div.classList.remove("dragging");
        };
    } else {
        div.draggable = false;
        div.ondragstart = null;
        div.ondragend = null;
    }
    div.onclick = function() {
        if (!full) toggleSelectedType(kind, t);
    };
}

function bindCellsIn(root, kind) {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll(".cell"), function(el) {
        bindCellDrag(el, kind);
    });
}

function bindSlotIn(root, kind) {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll(".mine-item"), function(el) {
        if (el.dataset.mineType) bindSlotItemDrag(el, el.dataset.mineType, kind);
    });
}

function applyPlaceModeToDom() {
    const kind = currentBoardKind();
    if (kind === "create") {
        bindCellsIn(document.getElementById("createBoardArea"), "create");
        bindSlotIn(document.getElementById("createMineSlot"), "create");
    } else {
        bindCellsIn(document.getElementById("board"), kind);
        bindSlotIn(document.getElementById("slot"), kind);
    }
}

function applyPlaceModeUI() {
    const isDrag = window._placeMode === "drag";
    const dragBtn = document.getElementById("modeBtnDrag");
    const clickBtn = document.getElementById("modeBtnClick");
    if (dragBtn) dragBtn.classList.toggle("active", isDrag);
    if (clickBtn) clickBtn.classList.toggle("active", !isDrag);
    const hint = document.getElementById("modeHint");
    if (hint) hint.textContent = isDrag ? "✋ 按住下方地雷，拖到棋盘格子上松手即可放置；手机/平板可直接用手指拖" : "🖱️ 先点一下地雷选中，再点棋盘格子放置；手机端点选更稳";
    const badge = document.getElementById("modeBadge");
    if (badge) badge.textContent = isDrag ? "拖拽" : "点选";
    document.body.classList.toggle("drag-mode", isDrag);
}

function initPlaceMode() {
    const saved = localStorage.getItem(PLACE_MODE_KEY);
    window._placeMode = saved === "drag" || saved === "click" ? saved : "drag";
    applyPlaceModeUI();
}

function setPlaceMode(mode) {
    if (mode !== "drag" && mode !== "click") return;
    if (window._placeMode !== mode) {
        window._placeMode = mode;
        try {
            localStorage.setItem(PLACE_MODE_KEY, mode);
        } catch (e) {}
        AudioFX.confirm();
    }
    applyPlaceModeToDom();
    applyPlaceModeUI();
}

window.setPlaceMode = setPlaceMode;

window.togglePlaceMode = function() {
    setPlaceMode(window._placeMode === "drag" ? "click" : "drag");
};

window.openSidebar = function() {
    const sb = document.getElementById("sidebar");
    if (!sb) return;
    AudioFX.confirm();
    sb.classList.add("open");
    renderSeriesSwitches();
};

initPlaceMode();

let _resizeTid = 0, _lastSizeKey = "";

window.addEventListener("resize", function() {
    clearTimeout(_resizeTid);
    _resizeTid = setTimeout(function() {
        const kind = currentBoardKind();
        const rows = kind === "create" ? createRows : SR;
        const cols = kind === "create" ? createCols : SC;
        const key = kind + "|" + rows + "x" + cols + "|" + calcCellSize(rows, cols);
        if (key === _lastSizeKey) return;
        _lastSizeKey = key;
        if (kind === "create") {
            renderCreateBoard();
            renderCreateMineSlot();
        } else if (kind === "teach") {
            renderTeachBoard();
            renderTeachSlot();
        } else render();
    }, 180);
});

(function initPointerDrag() {
    const MOVE_THRESHOLD = 6;
    const LONG_PRESS_MS = 480;
    let st = null;
    function clearTimers(s) {
        if (s && s.lpTimer) {
            clearTimeout(s.lpTimer);
            s.lpTimer = 0;
        }
    }
    function findCell(x, y, kind) {
        if (!document.elementFromPoint) return null;
        const el = document.elementFromPoint(x, y);
        if (!el || !el.closest) return null;
        const cell = el.closest(".cell");
        if (!cell) return null;
        if (kind === "create") return cell.closest("#createBoardArea") ? cell : null;
        return cell.closest("#board") ? cell : null;
    }
    function ghostPos(x, y, isTouch) {
        return "translate3d(" + (x - 23) + "px," + (y - 23 - (isTouch ? 30 : 12)) + "px,0)";
    }
    function makeGhost(type, x, y, isTouch) {
        const m = M[type] || null;
        const g = document.createElement("div");
        g.className = "drag-ghost";
        g.innerHTML = '<span class="' + (m ? m.cls : "normal-bomb") + '">' + (m ? m.e : "💣") + "</span>";
        g.style.transform = ghostPos(x, y, isTouch);
        document.body.appendChild(g);
        return g;
    }
    function killGhost(s) {
        if (!s) return;
        if (s.ghost && s.ghost.parentNode) s.ghost.parentNode.removeChild(s.ghost);
        s.ghost = null;
        if (s.src && s.src.classList) s.src.classList.remove("dragging");
    }
    function clearHover(s) {
        if (s && s.hover) {
            s.hover.classList.remove("drag-over");
            s.hover = null;
        }
    }
    function buzz(ms) {
        if (navigator.vibrate) {
            try {
                navigator.vibrate(ms);
            } catch (_) {}
        }
    }
    function autoScroll(y) {
        const vh = window.innerHeight || 0;
        if (!vh || y < 0 || y > vh) return;
        let dy = 0;
        if (y < 70) dy = -12; else if (y > vh - 70) dy = 12;
        if (!dy) return;
        try {
            window.scrollBy(0, dy);
        } catch (_) {}
    }
    function swallowNextClick() {
        let tid = 0;
        const cleanup = function() {
            document.removeEventListener("click", swallow, true);
            clearTimeout(tid);
        };
        const swallow = function(ev) {
            ev.stopPropagation();
            ev.preventDefault();
            cleanup();
        };
        document.addEventListener("click", swallow, true);
        tid = setTimeout(cleanup, 400);
    }
    function onDown(e) {
        if (!e || e.pointerType === "mouse") return;
        if (st) return;
        const target = e.target;
        if (!target || !target.closest) return;
        const kind = currentBoardKind();
        const slotItem = target.closest(".mine-item");
        if (slotItem) {
            if (window._placeMode !== "drag") return;
            if (slotItem.classList.contains("disabled")) return;
            const type = slotItem.dataset.mineType;
            if (!type || slotTypeFull(type, kind)) return;
            st = {
                mode: "slot",
                kind: kind,
                type: type,
                src: slotItem,
                fromKey: null,
                startX: e.clientX,
                startY: e.clientY,
                pid: e.pointerId,
                isTouch: true,
                active: false,
                canDrag: true,
                ghost: null,
                hover: null,
                lpTimer: 0
            };
            return;
        }
        const cell = target.closest(".cell");
        if (cell && cell.classList.contains("mine-here")) {
            const r = +cell.dataset.r, c = +cell.dataset.c, key = r + "," + c;
            const map = kind === "create" ? createPlaced : G.placed;
            const type = map[key];
            if (!type) return;
            st = {
                mode: "cell",
                kind: kind,
                type: type,
                src: cell,
                fromKey: key,
                r: r,
                c: c,
                startX: e.clientX,
                startY: e.clientY,
                pid: e.pointerId,
                isTouch: true,
                active: false,
                canDrag: window._placeMode === "drag",
                ghost: null,
                hover: null,
                lpTimer: 0
            };
            st.lpTimer = setTimeout(function() {
                const s = st;
                if (!s || s.active) return;
                st = null;
                clearTimers(s);
                removeAtCell(s.kind, s.r, s.c);
                buzz(18);
                swallowNextClick();
            }, LONG_PRESS_MS);
        }
    }
    function onMove(e) {
        if (!st || e.pointerId !== st.pid) return;
        const dx = e.clientX - st.startX, dy = e.clientY - st.startY;
        if (!st.active) {
            if (Math.abs(dx) < MOVE_THRESHOLD && Math.abs(dy) < MOVE_THRESHOLD) return;
            clearTimers(st);
            if (!st.canDrag) {
                const s = st;
                st = null;
                killGhost(s);
                return;
            }
            st.active = true;
            st.ghost = makeGhost(st.type, e.clientX, e.clientY, st.isTouch);
            if (st.src && st.src.classList) st.src.classList.add("dragging");
            setSelectedType(st.kind, st.type);
            buzz(10);
        }
        if (e.cancelable) e.preventDefault();
        if (st.ghost) st.ghost.style.transform = ghostPos(e.clientX, e.clientY, st.isTouch);
        autoScroll(e.clientY);
        const cell = findCell(e.clientX, e.clientY, st.kind);
        if (cell !== st.hover) {
            clearHover(st);
            if (cell && cell !== st.src) {
                cell.classList.add("drag-over");
                st.hover = cell;
            }
        }
    }
    function onUp(e) {
        if (!st || e.pointerId !== st.pid) return;
        const s = st;
        st = null;
        clearTimers(s);
        if (!s.active) {
            killGhost(s);
            return;
        }
        const cell = s.hover || findCell(e.clientX, e.clientY, s.kind);
        clearHover(s);
        killGhost(s);
        swallowNextClick();
        if (cell) dropAt(cell, s.kind, s.type, s.mode === "cell" ? s.fromKey : null);
    }
    function onCancel(e) {
        if (!st) return;
        if (e && e.pointerId !== st.pid) return;
        const s = st;
        st = null;
        clearTimers(s);
        clearHover(s);
        killGhost(s);
    }
    document.addEventListener("pointerdown", onDown, {
        passive: true
    });
    document.addEventListener("pointermove", onMove, {
        passive: false
    });
    document.addEventListener("pointerup", onUp, {
        passive: true
    });
    document.addEventListener("pointercancel", onCancel, {
        passive: true
    });
})();

function render() {
    if (teachActive) {
        renderTeachBoard();
        renderTeachSlot();
        return;
    }
    let b = document.getElementById("board");
    b.innerHTML = "";
    applyBoardMetrics(b, SR, SC);
    for (let r = 0; r < SR; r++) for (let c = 0; c < SC; c++) {
        let d = document.createElement("div");
        d.className = "cell";
        d.dataset.r = r;
        d.dataset.c = c;
        let t = G.tar[r][c], p = G.p[r][c], k = r + "," + c;
        if (p === t) d.classList.add("cell-valid"); else if (p < t) d.classList.add("cell-low"); else d.classList.add("cell-over");
        if (t !== 0) {
            d.textContent = t;
            d.classList.add("n" + Math.min(t, 8));
        }
        if (G.placed[k]) {
            d.classList.add("mine-here");
            let ty = G.placed[k];
            d.innerHTML = `<span class="${M[ty].cls}">${M[ty].e}</span>`;
        }
        d.onclick = () => {
            if (G.placed[k]) return;
            if (!selectedMineType) return;
            let used = Object.values(G.placed).filter(x => x === selectedMineType).length || 0;
            let max = G.pool[selectedMineType] || 0;
            if (used >= max) return;
            G.placed[k] = selectedMineType;
            G.lastDragType = selectedMineType;
            AudioFX.place();
            resetP();
            render();
        };
        d.oncontextmenu = e => {
            e.preventDefault();
            del(r, c);
        };
        bindCellDrag(d, "main");
        b.appendChild(d);
    }
    sizeCellsIn(b);
    document.getElementById("placed").textContent = Object.keys(G.placed).length;
    document.getElementById("max").textContent = G.max;
    renderSlot();
    checkWin();
}

function renderSlot() {
    if (teachActive) {
        renderTeachSlot();
        return;
    }
    let s = document.getElementById("slot");
    let teachBubble = document.getElementById("teachBubble");
    s.innerHTML = "";
    if (teachBubble) s.appendChild(teachBubble);
    for (let t in G.pool) {
        let max = G.pool[t];
        if (max <= 0) continue;
        let use = Object.values(G.placed).filter(x => x === t).length;
        let div = document.createElement("div");
        div.className = "mine-item" + (use >= max ? " disabled" : "") + (selectedMineType === t ? " selected" : "");
        div.dataset.tip = M[t].tip;
        div.dataset.mineType = t;
        div.innerHTML = `<div class="emoji-drag ${M[t].cls}">${M[t].e}</div><div>${M[t].n}</div><div>${use}/${max}</div>`;
        bindSlotItemDrag(div, t, "main");
        s.appendChild(div);
    }
}

function drop(e) {
    startTiOnFirst();
    let r = +this.dataset.r, c = +this.dataset.c, k = r + "," + c;
    if (G.placed[k]) return;
    if (G.drag) {
        let t = G.placed[G.drag];
        delete G.placed[G.drag];
        G.placed[k] = t;
        G.drag = null;
        AudioFX.place();
        resetP();
        render();
        return;
    }
    let t = null;
    if (e && e.dataTransfer) t = e.dataTransfer.getData("text/plain") || G.lastDragType;
    if (!t && selectedMineType) t = selectedMineType;
    if (!t) return;
    let used = Object.values(G.placed).filter(x => x === t).length || 0;
    let max = G.pool[t] || 0;
    if (used >= max) return;
    G.placed[k] = t;
    G.lastDragType = t;
    AudioFX.place();
    resetP();
    render();
}

function del(r, c) {
    startTiOnFirst();
    let k = r + "," + c;
    if (!G.placed[k]) return;
    AudioFX.remove();
    delete G.placed[k];
    resetP();
    render();
}

function onTutorialWin() {
    tutorialStep++;
    let cat = currentTutorialType;
    if (!cat) localStorage.setItem("tutorialStep", tutorialStep.toString()); else localStorage.setItem("tutorial_" + cat, tutorialStep.toString());
    updateTutorialProgress();
    if (tutorialStep >= 5) {
        if (cat) {
            let nextBtn = document.getElementById("teachNextBtn");
            if (nextBtn) {
                nextBtn.textContent = "完成";
                nextBtn.onclick = closeTutorialComplete;
            }
        }
        if (cat && !seriesUnlocked[cat]) {
            unlockSeries(cat);
            renderMineInfo();
            renderSeriesSwitches();
        }
        document.getElementById("overlay").style.display = "block";
        document.getElementById("tutorialCompleteModal").style.display = "block";
        AudioFX.modalOpen();
        let txt;
        if (!cat) {
            txt = "🎉 新手关卡完成！<br>现在你可以去挑战各系列的关卡了<br>通过对应系列挑战即可解锁该系列地雷 ✅";
        } else {
            txt = `🎉 已解锁「${CATEGORY[cat].name}」！<br>该系列地雷已加入题库 ✅`;
        }
        document.getElementById("tutorialCompleteText").innerHTML = txt;
        document.getElementById("tutorialProgressBar").style.display = "none";
        isTutorialMode = false;
        if (!cat) localStorage.setItem("tutorialCompleted", "true");
    } else {
        setTimeout(() => {
            alert(`破解一关！目前第${tutorialStep + 1}/5关  o((>ω< ))o`);
            setupTutorialBoard(cat);
        }, 100);
    }
}

function startTutorial() {
    AudioFX.confirm();
    document.getElementById("overlay").style.display = "none";
    document.getElementById("tutorialPrompt").style.display = "none";
    currentTutorialType = null;
    isTutorialMode = true;
    tutorialStep = parseInt(localStorage.getItem("tutorialStep")) || 0;
    setupTutorialBoard(null);
}

function openTutorialSelector() {
    if (isTutorialMode) return;
    AudioFX.confirm();
    let bs = localStorage.getItem("tutorialStep");
    if (bs && parseInt(bs) > 0 && parseInt(bs) < 5) {
        currentTutorialType = null;
        isTutorialMode = true;
        tutorialStep = parseInt(bs);
        setupTutorialBoard(null);
        return;
    }
    startTutorial();
}

function setupTutorialBoard(catKey) {
    fullReset();
    currentTutorialType = catKey;
    isTutorialMode = true;
    S = 10;
    T = 5;
    TY = 3;
    SP = 3;
    setupTutorialParams();
    genTutorialGame(catKey);
    showTutorialProgress(catKey);
    render();
    document.getElementById("win").style.display = "none";
}

function showTutorialProgress(catKey) {
    let bar = document.getElementById("tutorialProgressBar");
    bar.style.display = "block";
    let title = document.getElementById("tutorialTitle");
    if (!catKey) {
        title.textContent = "新手关卡";
        tutorialStep = parseInt(localStorage.getItem("tutorialStep")) || 0;
    } else {
        title.textContent = CATEGORY[catKey].name + "关卡";
        tutorialStep = parseInt(localStorage.getItem("tutorial_" + catKey)) || 0;
    }
    updateTutorialProgress();
}

function updateTutorialProgress() {
    document.getElementById("tutorialProgressFill").style.width = tutorialStep / 5 * 100 + "%";
    document.getElementById("tutorialProgressText").textContent = tutorialStep + "/5";
}

function startCategoryTutorial(catKey) {
    AudioFX.confirm();
    currentTutorialType = catKey;
    isTutorialMode = true;
    tutorialStep = seriesUnlocked[catKey] ? parseInt(localStorage.getItem("tutorial_" + catKey)) || 0 : 0;
    document.getElementById("overlay").style.display = "none";
    setupTutorialBoard(catKey);
}

const TEACH_LEVELS = [ {
    title: "① 放置地雷",
    icon: "💣",
    mineType: "normal",
    mineEmoji: "💣",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 0, 0, 0, 0, 0 ], [ 0, 1, 1, 1, 0 ], [ 0, 1, 1, 1, 0 ], [ 0, 1, 1, 1, 0 ], [ 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "这是一颗 💣普通雷\n它会让周围 3×3 范围每个格子 +1\n\n棋盘中央有一块 3×3 的「1」区域 \n拖动地雷到棋盘上放置吧！",
        hint: "普通雷 3x3 范围 +1"
    }, {
        text: "提示：放在区域中心位置（第3行第3列）\n它的 3×3 影响范围才能刚好覆盖所有 1。",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 2 ]
    } ]
}, {
    title: "② 在边上放置地雷",
    icon: "📏",
    mineType: "normal",
    mineEmoji: "💣",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 0, 0, 0, 0, 0 ], [ 1, 1, 0, 0, 0 ], [ 1, 1, 0, 0, 0 ], [ 1, 1, 0, 0, 0 ], [ 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "当雷靠近棋盘边缘时\n它的一部分影响范围会超出棋盘。\n\n左侧有两列显示 1\n——该放哪呢？",
        hint: "边缘放置：超出棋盘的部分不生效"
    }, {
        text: "提示：放在位置（第3行第1列）\n它的 3×3 范围右边两列刚好覆盖那些 1",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 0 ]
    } ]
}, {
    title: "③ 在角落放置地雷",
    icon: "📐",
    mineType: "normal",
    mineEmoji: "💣",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 0, 0, 0, 0, 0 ], [ 0, 0, 0, 0, 0 ], [ 0, 0, 0, 0, 0 ], [ 1, 1, 0, 0, 0 ], [ 1, 1, 0, 0, 0 ] ],
    steps: [ {
        text: "角落是最极端的边界\n\n左下角有 2×2 的「1」区域\n只有角落的雷能产生这种图案",
        hint: "角落放置：只有 2×2 范围在棋盘内"
    }, {
        text: "提示：放到棋盘左下角（第5行第1列）\n它的 3×3 范围就只剩右上 2×2 在棋盘内。",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 4, 0 ]
    } ]
}, {
    title: "④ 更大范围的地雷",
    icon: "💣",
    mineType: "big5",
    mineEmoji: "💣",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 1, 1, 1, 1, 0 ], [ 1, 1, 1, 1, 0 ], [ 1, 1, 1, 1, 0 ], [ 1, 1, 1, 1, 0 ], [ 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "💣巨型雷——它的影响范围是 5×5\n比普通雷大得多！\n\n左上角有一大块 4×4 的 1\n放在哪里能一次覆盖这么大的区域呢?",
        hint: "巨型雷 5×5 范围 +1"
    }, {
        text: "提示：4×4 的 1 区域左上角对齐棋盘边缘\n巨型雷的 5×5 中心应该尽量靠左上\n把它放到（第2行第2列）\n它的范围左上角刚好超出棋盘",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 1, 1 ]
    } ]
}, {
    title: "⑤ 不同数值的地雷",
    icon: "🔢",
    mineType: "high",
    mineEmoji: "💣",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 2, 2, 2, 0, 0 ], [ 2, 2, 2, 0, 0 ], [ 2, 2, 2, 0, 0 ], [ 0, 0, 0, 0, 0 ], [ 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "💣高爆雷——同样是 3×3 范围\n但每个格子 +2 而不是 +1\n\n左上角 3×3 全是 2\n你需要一颗「更猛」的雷来填满。",
        hint: "高爆雷 3×3 范围 +2"
    }, {
        text: "提示：放在（第2行第2列）\n它的 3×3 范围才能覆盖并产生 +2 的效果。",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 1, 1 ]
    } ]
}, {
    title: "⑥ 不同形状的地雷",
    icon: "🌶️",
    mineType: "chiliV",
    mineEmoji: "🌶️",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 0, 0, 1, 0, 0 ], [ 0, 0, 1, 0, 0 ], [ 0, 0, 1, 0, 0 ], [ 0, 0, 1, 0, 0 ], [ 0, 0, 1, 0, 0 ] ],
    steps: [ {
        text: "🌶️竖辣椒——它影响竖直方向的5格\n形成一条线，而不是 3×3 方块\n\n棋盘中间一列从上到下全是 1\n放下辣椒试试。",
        hint: "竖辣椒：竖直方向5格 +1"
    }, {
        text: "提示：放中间（第3行第3列）",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 2 ]
    } ]
}, {
    title: "⑦ 特殊地雷遇上边界",
    icon: "🌶️",
    mineType: "chiliH",
    mineEmoji: "🌶️",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 0, 0, 0, 0, 0 ], [ 0, 0, 0, 0, 0 ], [ 1, 1, 1, 0, 0 ], [ 0, 0, 0, 0, 0 ], [ 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "🌶️横辣椒——和竖辣椒类似，影响水平5格\n注意：它靠近边界时，也会有超出的部分。\n\n第3行有3个 1（左边紧挨边界）\n横辣椒该放在哪？",
        hint: "横辣椒：水平方向5格 +1，部分超出棋盘"
    }, {
        text: "提示：第3行有连续3个 1，左边贴着棋盘边缘。\n横辣椒水平范围左右各延伸 2 格\n要覆盖这3个 1，中心应该放在第3行第1列",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 0 ]
    } ]
}, {
    title: "⑧ 负值的地雷",
    icon: "💥",
    mineType: "anti",
    mineEmoji: "💥",
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ -1, -1, -1, 0, 0 ], [ -1, -1, -1, 0, 0 ], [ -1, -1, -1, 0, 0 ], [ 0, 0, 0, 0, 0 ], [ 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "💥反物质炸弹——它在 3×3 内每格 -1\n会产生负数！\n\n左上角 3×3 全是 -1\n代表着需要负值的地雷",
        hint: "反物质炸弹 3×3 范围 -1"
    }, {
        text: "提示：放到第2行第2列\n就能产生正确的负值影响。",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 1, 1 ]
    } ]
}, {
    title: "⑨ 影响叠加",
    icon: "💣＋💣",
    mineTypes: {
        normal: 2
    },
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 1, 1, 1, 0, 0 ], [ 1, 2, 2, 1, 0 ], [ 1, 2, 2, 1, 0 ], [ 0, 1, 1, 1, 0 ], [ 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "当两颗地雷的影响范围重叠时\n重叠区域的数值会累加！\n\n中间有 2×2 的[2]区域\n说明这些格子被两颗雷同时覆盖",
        hint: "两颗雷重叠 → 1+1=2"
    }, {
        text: "把一颗💣放到第2行第2列\n你会看到 3×3 范围变成 1",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 1, 1 ]
    }, {
        text: "再放第二颗💣到第3行第3列\n两颗雷范围叠加处 → 数值变成 2 ✅",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 2 ]
    } ]
}, {
    title: "⑩ 正负抵消",
    icon: "➕➖",
    mineTypes: {
        normal: 1,
        anti: 1
    },
    boardRows: 5,
    boardCols: 5,
    targetBoard: [ [ 0, 0, 0, 0, 0 ], [ 0, 1, 1, 1, 0 ], [ 0, 1, 0, 0, -1 ], [ 0, 1, 0, 0, -1 ], [ 0, 0, -1, -1, -1 ] ],
    steps: [ {
        text: "💣普通雷 +1，💥反物质炸弹 -1\n当它们的影响范围重叠时\n重叠区域相加得0！\n\n中间有 2×2 的[0]区域\n说明这些格子被两颗雷同时覆盖",
        hint: "正负叠加 → 1+(-1)=0"
    }, {
        text: "把💣放到第3行第3列\n它的 3×3 范围覆盖中间区域",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 2 ]
    }, {
        text: "把💥放到第4行第4列\n它的 3×3 范围覆盖右下区域\n两者重叠区域 → 1+(-1)=0 ✅",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 3, 3 ]
    } ]
}, {
    title: "融会贯通",
    icon: "🥳",
    mineTypes: {
        big5: 1,
        anti: 1,
        chiliV: 1,
        chiliH: 1
    },
    boardRows: 8,
    boardCols: 8,
    targetBoard: [ [ 0, 1, 0, 0, 0, 0, 0, 0 ], [ 0, 1, 0, 0, -1, -1, -1, 0 ], [ 0, 2, 1, 1, 0, 0, -1, 0 ], [ 0, 2, 1, 1, 0, 0, -1, 0 ], [ 0, 2, 1, 1, 1, 1, 0, 0 ], [ 0, 1, 1, 1, 1, 1, 0, 0 ], [ 0, 1, 1, 2, 2, 2, 1, 1 ], [ 0, 0, 0, 0, 0, 0, 0, 0 ] ],
    steps: [ {
        text: "这是为你准备的最后考题\n\n想想刚才所有的特性\n\n用这里的四个地雷，把棋盘变绿吧！",
        hint: "正负叠加 → 1+(-1)=0"
    }, {
        text: "巨型雷💣轮廓最明显\n把它放在第5行第4列正好",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 4, 3 ]
    }, {
        text: "把💥放到第3行第6列\n与巨型雷的范围叠加\n两者重叠区域 → 1+(-1)=0 ✅",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 5 ]
    }, {
        text: "把竖辣椒放到第3行2列\n与巨型雷的范围叠加区域\n1+1=2 ✅",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 2, 1 ]
    }, {
        text: "把横辣椒放到第7行第6列\n与巨型雷的范围叠加区域\n1+1=2 ✅",
        hint: "右键点击已放置的地雷可删除🚫",
        targetCell: [ 6, 5 ]
    } ]
} ];

let teachActive = false;

let teachLevelIdx = 0;

let teachStepIdx = 0;

let teachPlacedCount = 0;

let teachExpectedCount = 0;

let teachPlacedTypes = {};

let teachExpectedTypes = {};

let teachPlaceList = [];

let teachCompleted = [];

function openTeachMode() {
    AudioFX.confirm();
    document.querySelector(".panel").style.display = "none";
    teachLevelIdx = 0;
    teachStepIdx = 0;
    teachPlacedCount = 0;
    teachExpectedCount = 0;
    teachPlaceList = [];
    teachPlacedTypes = {};
    fullReset();
    teachActive = true;
    S = 5;
    SR = 5;
    SC = 5;
    document.getElementById("overlay").style.display = "none";
    document.getElementById("teachProgressBar").style.display = "block";
    updateTeachProgressBar();
    ensureTeachSlotHost(true);
    loadTeachLevel();
}

function openPracticeMode() {
    AudioFX.confirm();
    startTutorial();
}

function loadTeachLevel() {
    let lvl = TEACH_LEVELS[teachLevelIdx];
    teachActive = true;
    SR = lvl.boardRows;
    SC = lvl.boardCols;
    S = 5;
    G.tar = lvl.targetBoard.map(row => row.slice());
    G.p = Array(SR).fill().map(() => Array(SC).fill(0));
    G.placed = {};
    teachPlaceList = [];
    teachPlacedTypes = {};
    let mt = lvl.mineTypes || (lvl.mineType ? {
        [lvl.mineType]: 1
    } : {});
    teachExpectedTypes = Object.assign({}, mt);
    teachExpectedCount = 0;
    for (let k in mt) teachExpectedCount += mt[k];
    teachPlacedCount = 0;
    G.max = teachExpectedCount;
    G.pool = Object.assign({}, mt);
    teachStepIdx = 0;
    ensureTeachSlotHost(true);
    renderTeachSlot();
    renderTeachBoard();
    showTeachStep();
    updateTeachProgressBar();
    document.getElementById("win").style.display = "none";
    document.getElementById("timer").style.display = "none";
    document.getElementById("placed").textContent = "0";
    document.getElementById("max").textContent = String(teachExpectedCount);
}

function renderTeachBoard() {
    let lvl = TEACH_LEVELS[teachLevelIdx];
    let b = document.getElementById("board");
    b.innerHTML = "";
    applyBoardMetrics(b, SR, SC);
    for (let r = 0; r < SR; r++) {
        for (let c = 0; c < SC; c++) {
            let d = document.createElement("div");
            d.className = "cell";
            d.dataset.r = r;
            d.dataset.c = c;
            let t = G.tar[r][c];
            let p = G.p[r][c];
            if (p === t) d.classList.add("cell-valid"); else if (p < t) d.classList.add("cell-low"); else if (p > t) d.classList.add("cell-over");
            if (t !== 0) {
                d.textContent = t;
                d.classList.add("n" + t);
            }
            let k = r + "," + c;
            if (G.placed[k]) {
                d.classList.add("mine-here");
                let ty = G.placed[k];
                d.innerHTML = `<span class="${M[ty].cls}">${M[ty].e}</span>`;
            }
            d.onclick = () => {
                if (G.placed[k]) return;
                let type = window._teachSelectedType;
                if (!type) {
                    let mt = lvl.mineTypes || (lvl.mineType ? {
                        [lvl.mineType]: 1
                    } : {});
                    for (let t in mt) {
                        if ((teachPlacedTypes[t] || 0) < mt[t]) {
                            type = t;
                            break;
                        }
                    }
                }
                if (!type) return;
                teachDrop(r, c, type);
            };
            d.oncontextmenu = e => {
                e.preventDefault();
                teachRemove(r, c);
            };
            bindCellDrag(d, "teach");
            b.appendChild(d);
        }
    }
    sizeCellsIn(b);
}

function renderTeachSlot() {
    let lvl = TEACH_LEVELS[teachLevelIdx];
    let s = document.getElementById("slot");
    let bubble = document.getElementById("teachBubble");
    let minesBox = null;
    if (bubble) {
        if (bubble.parentElement !== s) s.appendChild(bubble);
        minesBox = document.getElementById("teachBubbleMines");
        if (!minesBox) {
            minesBox = document.createElement("div");
            minesBox.className = "teach-bubble-mines";
            minesBox.id = "teachBubbleMines";
            bubble.appendChild(minesBox);
        }
        Array.prototype.slice.call(s.children).forEach(function(ch) {
            if (ch !== bubble) s.removeChild(ch);
        });
        minesBox.innerHTML = "";
    }
    s.style.display = "";
    ensureTeachSlotHost();
    let mt = lvl.mineTypes || (lvl.mineType ? {
        [lvl.mineType]: 1
    } : {});
    for (let t in mt) {
        let expected = mt[t];
        let placed = teachPlacedTypes[t] || 0;
        let div = document.createElement("div");
        let disabled = placed >= expected;
        div.className = "mine-item" + (disabled ? " disabled" : "") + (window._teachSelectedType === t ? " selected" : "");
        div.dataset.tip = M[t].tip;
        div.dataset.mineType = t;
        div.innerHTML = `<div class="emoji-drag ${M[t].cls}">${M[t].e}</div><div>${M[t].n}</div><div>${placed}/${expected}</div>`;
        bindSlotItemDrag(div, t, "teach");
        if (minesBox) minesBox.appendChild(div); else s.appendChild(div);
    }
}

function ensureTeachSlotHost(replay) {
    let s = document.getElementById("slot");
    if (!s) return;
    if (replay) {
        s.classList.remove("teach-slot-host");
        void s.offsetWidth;
    }
    s.classList.add("teach-slot-host");
}

function clearTeachSlotHost() {
    let s = document.getElementById("slot");
    if (s) s.classList.remove("teach-slot-host");
}

function teachDrop(r, c, forceType) {
    let lvl = TEACH_LEVELS[teachLevelIdx];
    let k = r + "," + c;
    if (G.placed[k]) return;
    let dragType = forceType || window._teachSelectedType || null;
    window._teachSelectedType = null;
    renderTeachSlot();
    if (!dragType) {
        let mt = lvl.mineTypes || (lvl.mineType ? {
            [lvl.mineType]: 1
        } : {});
        for (let t in mt) {
            if ((teachPlacedTypes[t] || 0) < mt[t]) {
                dragType = t;
                break;
            }
        }
    }
    if (!dragType) return;
    let mt = lvl.mineTypes || (lvl.mineType ? {
        [lvl.mineType]: 1
    } : {});
    if ((teachPlacedTypes[dragType] || 0) >= (mt[dragType] || 0)) return;
    G.placed[k] = dragType;
    teachPlaceList.push({
        r: r,
        c: c,
        type: dragType
    });
    teachPlacedTypes[dragType] = (teachPlacedTypes[dragType] || 0) + 1;
    teachPlacedCount++;
    AudioFX.place();
    G.p = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let item of teachPlaceList) {
        M[item.type].f(item.r, item.c, G.p);
    }
    applyTacticalEffects(G.p, G.placed);
    renderTeachBoard();
    renderTeachSlot();
    document.getElementById("placed").textContent = String(teachPlacedCount);
    updateTeachProgressBar();
    if (teachPlacedCount >= teachExpectedCount) {
        let allCorrect = true;
        for (let i = 0; i < SR; i++) for (let j = 0; j < SC; j++) {
            if (G.p[i][j] !== G.tar[i][j]) allCorrect = false;
        }
        if (allCorrect) {
            showTeachStep(true);
            setTimeout(() => teachLevelComplete(), 1200);
        } else {
            let steps = lvl.steps || [];
            teachStepIdx = Math.min(teachStepIdx + 1, steps.length - 1);
            showTeachStep(false);
        }
    } else {
        let steps = lvl.steps || [];
        teachStepIdx = Math.min(teachStepIdx + 1, steps.length - 1);
        showTeachStep(false);
    }
}

function teachRemove(r, c) {
    let k = r + "," + c;
    if (!G.placed[k]) return;
    let removedType = G.placed[k];
    delete G.placed[k];
    teachPlaceList = teachPlaceList.filter(item => !(item.r === r && item.c === c));
    teachPlacedTypes[removedType] = Math.max(0, (teachPlacedTypes[removedType] || 0) - 1);
    teachPlacedCount = Math.max(0, teachPlacedCount - 1);
    AudioFX.remove();
    G.p = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let item of teachPlaceList) {
        M[item.type].f(item.r, item.c, G.p);
    }
    applyTacticalEffects(G.p, G.placed);
    renderTeachBoard();
    renderTeachSlot();
    document.getElementById("placed").textContent = String(teachPlacedCount);
    updateTeachProgressBar();
    teachStepIdx = 0;
    showTeachStep(false);
}

function teachMove(fromKey, r, c) {
    const toKey = r + "," + c;
    const t = G.placed[fromKey];
    if (!t || G.placed[toKey] || fromKey === toKey) return;
    const fr = +fromKey.split(",")[0], fc = +fromKey.split(",")[1];
    delete G.placed[fromKey];
    teachPlaceList = teachPlaceList.filter(item => !(item.r === fr && item.c === fc));
    G.placed[toKey] = t;
    teachPlaceList.push({
        r: r,
        c: c,
        type: t
    });
    AudioFX.place();
    G.p = Array(SR).fill().map(() => Array(SC).fill(0));
    for (let item of teachPlaceList) {
        M[item.type].f(item.r, item.c, G.p);
    }
    applyTacticalEffects(G.p, G.placed);
    renderTeachBoard();
    renderTeachSlot();
    document.getElementById("placed").textContent = String(teachPlacedCount);
    updateTeachProgressBar();
    teachCheckComplete();
}

function teachCheckComplete() {
    if (teachPlacedCount < teachExpectedCount) return;
    for (let i = 0; i < SR; i++) {
        for (let j = 0; j < SC; j++) {
            if (G.p[i][j] !== G.tar[i][j]) return;
        }
    }
    showTeachStep(true);
    setTimeout(() => teachLevelComplete(), 1200);
}

function showTeachStep(isCorrect) {
    let lvl = TEACH_LEVELS[teachLevelIdx];
    let bubble = document.getElementById("teachBubble");
    bubble.classList.remove("visible", "mines-only");
    void bubble.offsetWidth;
    bubble.classList.add("visible");
    let steps = lvl.steps || [];
    let stepIdx = Math.min(teachStepIdx, steps.length - 1);
    let step = steps[stepIdx] || steps[0] || {
        text: "",
        hint: ""
    };
    if (isCorrect) {
        document.getElementById("teachBubbleIcon").textContent = "✅";
        document.getElementById("teachBubbleTitle").textContent = "正确!";
        document.getElementById("teachBubbleText").textContent = "放置正确，棋盘已全部匹配！\n\n 该教学已完成\n";
        document.getElementById("teachBubbleHint").textContent = "";
    } else {
        document.getElementById("teachBubbleIcon").textContent = lvl.icon;
        document.getElementById("teachBubbleTitle").textContent = lvl.title;
        document.getElementById("teachBubbleText").textContent = step.text;
        document.getElementById("teachBubbleHint").textContent = step.hint || "";
    }
    document.querySelectorAll(".cell-teach-target").forEach(el => el.classList.remove("cell-teach-target"));
    if (step.targetCell && !isCorrect) {
        let [tr, tc] = step.targetCell;
        let cellEl = document.querySelector(`.cell[data-r="${tr}"][data-c="${tc}"]`);
        if (cellEl) cellEl.classList.add("cell-teach-target");
    }
}

function showTeachBubbleMsg(text) {
    teachStepIdx = 1;
    showTeachStep(false);
}

function updateTeachProgressBar() {
    let bar = document.getElementById("teachProgressBar");
    if (!bar) return;
    let total = TEACH_LEVELS.length;
    let pct = Math.round(teachLevelIdx / total * 100);
    document.getElementById("teachProgressFill").style.width = pct + "%";
    document.getElementById("teachProgressText").textContent = teachLevelIdx + 1 + "/" + total;
}

function teachLevelComplete() {
    updateTeachProgressBar();
    let modal = document.getElementById("teachCompleteModal");
    let lvl = TEACH_LEVELS[teachLevelIdx];
    document.getElementById("teachCompleteIcon").textContent = lvl.icon;
    document.getElementById("teachCompleteTitle").textContent = `${lvl.title} 完成！`;
    let isLast = teachLevelIdx === TEACH_LEVELS.length - 1;
    let nextBtn = document.getElementById("teachNextBtn");
    let exitBtn = document.getElementById("teachExitBtn");
    let practiceBtn = document.getElementById("teachPracticeBtn");
    if (isLast) {
        document.getElementById("teachCompleteText").innerHTML = "🎓 恭喜完成全部教学！<br>准备好挑战新手关卡了吗？";
        nextBtn.textContent = "完成 🏆";
        nextBtn.onclick = teachExit;
        nextBtn.style.display = "";
        exitBtn.style.display = "none";
        practiceBtn.style.display = "";
        AudioFX.winBrain();
        if (window.Achievements && window.Achievements.unlock) {
            window.Achievements.unlock("finish_tutorial");
        }
    } else {
        let nextLvl = TEACH_LEVELS[teachLevelIdx + 1];
        document.getElementById("teachCompleteText").innerHTML = `做得好！接下来学习：${nextLvl.title}`;
        nextBtn.textContent = "下一步 ➡️";
        nextBtn.onclick = teachNextLevel;
        nextBtn.style.display = "";
        exitBtn.style.display = "";
        practiceBtn.style.display = "none";
        AudioFX.win();
    }
    modal.classList.add("visible");
    let bubble = document.getElementById("teachBubble");
    if (bubble) {
        bubble.classList.remove("visible");
        void bubble.offsetWidth;
        bubble.classList.add("visible", "mines-only");
    }
}

function teachNextLevel() {
    AudioFX.confirm();
    document.getElementById("teachCompleteModal").classList.remove("visible");
    if (teachLevelIdx < TEACH_LEVELS.length - 1) {
        teachLevelIdx++;
        teachStepIdx = 0;
        loadTeachLevel();
    } else {
        document.getElementById("teachProgressBar").style.display = "none";
    }
}

function teachExit() {
    AudioFX.confirm();
    document.querySelector(".panel").style.display = "flex";
    document.getElementById("teachCompleteModal").classList.remove("visible");
    document.getElementById("teachBubble").classList.remove("visible", "mines-only");
    clearTeachSlotHost();
    document.querySelectorAll(".cell-teach-target").forEach(el => el.classList.remove("cell-teach-target"));
    teachActive = false;
    document.getElementById("teachProgressBar").style.display = "none";
    S = 10;
    SR = 10;
    SC = 10;
    T = 6;
    TY = 3;
    SP = 4;
    fullReset();
    genGame();
    render();
    renderRec();
    document.getElementById("win").style.display = "none";
}

function teachExitToPractice() {
    AudioFX.confirm();
    document.querySelector(".panel").style.display = "flex";
    document.getElementById("teachCompleteModal").classList.remove("visible");
    document.getElementById("teachBubble").classList.remove("visible", "mines-only");
    clearTeachSlotHost();
    document.querySelectorAll(".cell-teach-target").forEach(el => el.classList.remove("cell-teach-target"));
    document.getElementById("teachProgressBar").style.display = "none";
    teachActive = false;
    teachPlacedCount = 0;
    teachExpectedCount = 0;
    teachPlaceList = [];
    teachPlacedTypes = {};
    S = 10;
    SR = 10;
    SC = 10;
    T = 6;
    TY = 3;
    SP = 4;
    currentTutorialType = null;
    isTutorialMode = true;
    tutorialStep = parseInt(localStorage.getItem("tutorialStep")) || 0;
    setupTutorialBoard(null);
}

let _origDrop = null;

let _origDel = null;

function newGame() {
    AudioFX.confirm();
    fullReset();
    if (isPresetDifficulty(diff) && !isFreeMode && !isTutorialMode) {
        enterPresetPending(diff);
        return;
    }
    genGame();
    render();
    renderRec();
    document.getElementById("win").style.display = "none";
}

function fullReset() {
    resetTi();
    isTutorialMode = false;
    isPresetPending = false;
    pendingDiff = null;
    currentTutorialType = null;
    document.getElementById("tutorialProgressBar").style.display = "none";
    document.getElementById("teachProgressBar").style.display = "none";
    teachActive = false;
    teachPlacedCount = 0;
    teachExpectedCount = 0;
    teachPlaceList = [];
    teachPlacedTypes = {};
    teachExpectedTypes = {};
    document.getElementById("brainWinModal").style.display = "none";
    document.getElementById("presetStartCard").style.display = "none";
    document.getElementById("board").style.display = "";
    document.getElementById("slot").style.display = "";
    document.getElementById("win").style.display = "none";
    stopFallingEmoji();
    document.body.classList.remove("brain-golden");
    document.querySelectorAll(".auto-modal").forEach(m => {
        m.style.display = "none";
    });
    document.getElementById("timer").style.display = isFreeMode ? "none" : "none";
    teachActive = false;
    document.getElementById("teachBubble").classList.remove("visible", "mines-only");
    clearTeachSlotHost();
    document.getElementById("teachCompleteModal").classList.remove("visible");
    document.querySelectorAll(".cell-teach-target").forEach(el => el.classList.remove("cell-teach-target"));
    document.querySelectorAll(".cell-teach-correct").forEach(el => el.classList.remove("cell-teach-correct"));
    document.querySelectorAll(".cell-teach-wrong").forEach(el => el.classList.remove("cell-teach-wrong"));
    let nextBtn = document.getElementById("teachNextBtn");
    if (nextBtn) {
        nextBtn.textContent = "下一关 ➡️";
        nextBtn.onclick = teachNextLevel;
    }
}

function beginPresetGame() {
    AudioFX.confirm();
    document.getElementById("presetStartCard").style.display = "none";
    document.getElementById("board").style.display = "";
    document.getElementById("slot").style.display = "";
    isPresetPending = false;
    isTutorialMode = false;
    document.getElementById("tutorialProgressBar").style.display = "none";
    genGame();
    render();
    renderRec();
    document.getElementById("win").style.display = "none";
    if (!isFreeMode) {
        ts = true;
        startTi();
    }
}

function clearAll() {
    AudioFX.confirm();
    G.placed = {};
    resetP();
    render();
}

document.getElementById("reset").onclick = newGame;

document.getElementById("clear").onclick = clearAll;

window.onload = () => {
    renderRec();
    renderMineInfo();
    renderSeriesSwitches();
    if (checkBrainUnlocked() && !brainUnlockedNotified) {
        brainUnlockedNotified = true;
        localStorage.setItem("brainUnlockedNotified", "true");
    }
    updatePresetButtons();
    newGame();
    applyBrainEgg();
};

document.addEventListener("dragstart", function(e) {
    try {
        e.dataTransfer.setDragImage(new Image, 0, 0);
    } catch (_) {}
}, false);

window.addEventListener("load", function() {
    let today = (new Date).toDateString();
    let lastShown = localStorage.getItem("welcomeLastShown");
    let isFirstTime = !localStorage.getItem("hasVisitedBefore");
    if (isFirstTime) {
        setTimeout(() => {
            document.getElementById("overlay").style.display = "block";
            document.getElementById("tutorialPrompt").style.display = "block";
            AudioFX.modalOpen();
            let btn = document.getElementById("tutorialConfirmBtn");
            btn.disabled = true;
            let cd = 5;
            let cdEl = document.getElementById("tutorialCountdown");
            let iv = setInterval(() => {
                cd--;
                if (cd > 0) cdEl.textContent = "按钮将在" + cd + "秒后可用..."; else {
                    cdEl.textContent = "";
                    btn.disabled = false;
                    clearInterval(iv);
                }
            }, 1e3);
        }, 800);
        localStorage.setItem("hasVisitedBefore", "true");
        if (!localStorage.getItem("tutorialStep")) localStorage.setItem("tutorialStep", "0");
    } else if (lastShown !== today) {
        setTimeout(() => {
            document.getElementById("overlay").style.display = "block";
            document.getElementById("welcomeModal").style.display = "block";
            AudioFX.modalOpen();
        }, 500);
        localStorage.setItem("welcomeLastShown", today);
    }
});

let createModeActive = false;

let createRows = 10;

let createCols = 10;

let createPlaced = {};

let createdTarget = [];

const CREATE_MIN = 4;

const CREATE_MAX = 20;

const CREATE_MAX_CELLS = 400;

function getAllMineTypes() {
    let types = [];
    for (let k in M) {
        if (seriesState[M[k].category]) types.push(k);
    }
    return types;
}

function clampSize(v) {
    v = parseInt(v) || CREATE_MIN;
    return Math.max(CREATE_MIN, Math.min(CREATE_MAX, v));
}

function getMaxAllowed(otherDim) {
    return Math.max(CREATE_MIN, Math.min(CREATE_MAX, Math.floor(CREATE_MAX_CELLS / otherDim)));
}

function showCreateError(msg) {
    let el = document.getElementById("createError");
    if (el) el.textContent = msg || "";
}

function refreshCreateInfoBar() {
    let bar = document.getElementById("createInfoBar");
    if (!bar) return;
    let totalCells = createRows * createCols;
    let placedCount = Object.keys(createPlaced).length;
    let typeCount = getAllMineTypes().length;
    document.getElementById("infoRows").textContent = createRows;
    document.getElementById("infoCols").textContent = createCols;
    document.getElementById("infoPlaced").textContent = placedCount;
    document.getElementById("infoTypes").textContent = typeCount;
    let maxHint = document.getElementById("createMaxHint");
    if (!maxHint) {
        maxHint = document.createElement("span");
        maxHint.id = "createMaxHint";
        maxHint.className = "info-chip";
        bar.appendChild(maxHint);
    }
    maxHint.innerHTML = "最大地雷数 <strong>" + Math.floor(totalCells * .6) + "</strong>";
    bar.style.display = "flex";
}

function createSizeStep(dim, delta) {
    AudioFX.pop();
    let isRows = dim === "rows";
    let cur = isRows ? createRows : createCols;
    let other = isRows ? createCols : createRows;
    let maxForOther = getMaxAllowed(other);
    let next = clampSize(cur + delta);
    if (next * other > CREATE_MAX_CELLS) {
        next = maxForOther;
        showCreateError("棋盘面积不能超过 " + CREATE_MAX_CELLS + " 格（当前 " + next * other + "）");
    } else {
        showCreateError("");
    }
    if (isRows) {
        createRows = next;
        document.getElementById("createSize").value = next;
    } else {
        createCols = next;
        document.getElementById("createSize2").value = next;
    }
}

function createSizeInput(dim, val) {
    let isRows = dim === "rows";
    let other = isRows ? createCols : createRows;
    let maxForOther = getMaxAllowed(other);
    let next = clampSize(val);
    if (next * other > CREATE_MAX_CELLS) {
        next = maxForOther;
        showCreateError("棋盘面积不能超过 " + CREATE_MAX_CELLS + " 格，已自动调整");
    } else {
        showCreateError("");
    }
    if (isRows) {
        createRows = next;
        document.getElementById("createSize").value = next;
    } else {
        createCols = next;
        document.getElementById("createSize2").value = next;
    }
    AudioFX.pop();
}

function enterCreateMode() {
    AudioFX.confirm();
    fullReset();
    createModeActive = true;
    document.getElementById("createModePanel").classList.add("visible");
    document.getElementById("board").style.display = "none";
    document.getElementById("slot").style.display = "none";
    document.getElementById("presetStartCard").style.display = "none";
    document.getElementById("timer").style.display = "none";
    createRows = 10;
    createCols = 10;
    document.getElementById("createSize").value = 10;
    document.getElementById("createSize2").value = 10;
    document.getElementById("puzzleCodeOutput").textContent = "点击生成后显示";
    document.getElementById("shareCodeBtn").disabled = true;
    showCreateError("");
    document.getElementById("createBoardArea").style.display = "none";
    document.getElementById("createMineSlot").style.display = "none";
    document.getElementById("createCodeCard").style.display = "none";
    document.getElementById("createInfoBar").style.display = "none";
    createPlaced = {};
}

function initCreateBoard() {
    AudioFX.confirm();
    let r = clampSize(document.getElementById("createSize").value);
    let c = clampSize(document.getElementById("createSize2").value);
    if (r * c > CREATE_MAX_CELLS) {
        c = getMaxAllowed(r);
        document.getElementById("createSize2").value = c;
        showCreateError("棋盘面积超限，列数已自动调整为 " + c);
    } else {
        showCreateError("");
    }
    createRows = r;
    createCols = c;
    SR = r;
    SC = c;
    S = Math.max(r, c);
    createPlaced = {};
    document.getElementById("createBoardArea").style.display = "";
    document.getElementById("createMineSlot").style.display = "";
    document.getElementById("createCodeCard").style.display = "";
    refreshCreateInfoBar();
    renderCreateBoard();
    renderCreateMineSlot();
}

function createPlace(r, c, type) {
    const key = r + "," + c;
    if (!type || createPlaced[key]) return;
    createPlaced[key] = type;
    AudioFX.place();
    renderCreateBoard();
    renderCreateMineSlot();
    refreshCreateInfoBar();
}

function createRemove(r, c) {
    const key = r + "," + c;
    if (!createPlaced[key]) return;
    delete createPlaced[key];
    AudioFX.remove();
    renderCreateBoard();
    renderCreateMineSlot();
    refreshCreateInfoBar();
}

function createMove(fromKey, r, c) {
    const toKey = r + "," + c;
    const t = createPlaced[fromKey];
    if (!t || createPlaced[toKey] || fromKey === toKey) return;
    delete createPlaced[fromKey];
    createPlaced[toKey] = t;
    AudioFX.place();
    renderCreateBoard();
    renderCreateMineSlot();
    refreshCreateInfoBar();
}

function renderCreateBoard() {
    let area = document.getElementById("createBoardArea");
    area.innerHTML = "";
    let rows = createRows, cols = createCols;
    let board = document.createElement("div");
    board.className = "board";
    applyBoardMetrics(board, rows, cols);
    let tempP = Array.from({
        length: rows
    }, () => Array(cols).fill(0));
    let oldSR = SR, oldSC = SC;
    SR = rows;
    SC = cols;
    for (let k in createPlaced) {
        let [r, c] = k.split(",").map(Number);
        M[createPlaced[k]].f(r, c, tempP);
    }
    applyTacticalEffects(tempP, createPlaced);
    SR = oldSR;
    SC = oldSC;
    createdTarget = tempP.map(row => row.slice());
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            let cell = document.createElement("div");
            cell.className = "cell";
            cell.dataset.r = r;
            cell.dataset.c = c;
            let val = tempP[r][c];
            if (val !== 0) {
                cell.textContent = val;
                cell.classList.add("n" + Math.min(Math.abs(val), 9));
                if (val > 0) cell.classList.add("cell-valid"); else cell.classList.add("cell-over");
            }
            let key = r + "," + c;
            if (createPlaced[key]) {
                cell.classList.add("mine-here");
                let ty = createPlaced[key];
                cell.innerHTML = `<span class="${M[ty].cls}">${M[ty].e}</span>`;
            }
            cell.onclick = () => {
                createPlace(r, c, window._createSelectedType);
            };
            cell.oncontextmenu = e => {
                e.preventDefault();
                createRemove(r, c);
            };
            bindCellDrag(cell, "create");
            board.appendChild(cell);
        }
    }
    area.appendChild(board);
    sizeCellsIn(board);
}

function renderCreateMineSlot() {
    let container = document.getElementById("createMineSlot");
    container.innerHTML = "";
    let types = getAllMineTypes();
    let totalCells = createRows * createCols;
    let maxMines = Math.floor(totalCells * .6);
    let placedCount = Object.keys(createPlaced).length;
    types.forEach(t => {
        let used = Object.values(createPlaced).filter(v => v === t).length;
        let div = document.createElement("div");
        let disabled = placedCount >= maxMines;
        div.className = "mine-item" + (disabled ? " disabled" : "") + (window._createSelectedType === t ? " selected" : "");
        div.dataset.tip = M[t].tip;
        div.dataset.mineType = t;
        div.innerHTML = `<div class="emoji-drag ${M[t].cls}">${M[t].e}</div><div>${M[t].n}</div><div>${used} 已放</div>`;
        bindSlotItemDrag(div, t, "create");
        container.appendChild(div);
    });
}

function generatePuzzleCode() {
    if (Object.keys(createPlaced).length === 0) {
        showCreateError("请先在棋盘上放置至少一个地雷！");
        return;
    }
    showCreateError("");
    let rows = createRows, cols = createCols;
    let placed = createPlaced;
    let allTypes = Object.keys(M).sort();
    let typeIndex = {};
    allTypes.forEach((t, idx) => typeIndex[t] = idx);
    let numMines = Object.keys(placed).length;
    let byteLen = 2 + numMines * 2;
    let buffer = new ArrayBuffer(byteLen);
    let view = new DataView(buffer);
    view.setUint8(0, rows);
    view.setUint8(1, cols);
    let offset = 2;
    for (let key in placed) {
        let [r, c] = key.split(",").map(Number);
        let type = placed[key];
        let typeIdx = typeIndex[type];
    }
    byteLen = 2 + 3 * numMines;
    buffer = new ArrayBuffer(byteLen);
    view = new DataView(buffer);
    view.setUint8(0, rows);
    view.setUint8(1, cols);
    offset = 2;
    for (let key in placed) {
        let [r, c] = key.split(",").map(Number);
        let type = placed[key];
        let typeIdx = typeIndex[type];
        view.setUint8(offset, r);
        view.setUint8(offset + 1, c);
        view.setUint8(offset + 2, typeIdx);
        offset += 3;
    }
    let bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    let code = btoa(binary).replace(/=+$/, "");
    document.getElementById("puzzleCodeOutput").textContent = code;
    document.getElementById("shareCodeBtn").disabled = false;
    AudioFX.confirm();
}

function copyPuzzleCode() {
    let code = document.getElementById("puzzleCodeOutput").textContent;
    if (!code || code === "点击生成后显示") return;
    let text = "我分享了一个[反向💣扫雷]题目，来试试你能不能破解！" + code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            AudioFX.confirm();
            flashShareBtn();
        }).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    let ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(ta);
    AudioFX.confirm();
    flashShareBtn();
}

function flashShareBtn() {
    let btn = document.getElementById("shareCodeBtn");
    if (!btn) return;
    let old = btn.textContent;
    btn.textContent = "✅ 已复制";
    btn.style.background = "#48bb78";
    btn.style.borderColor = "#2f855a";
    setTimeout(() => {
        btn.textContent = old;
        btn.style.background = "";
        btn.style.borderColor = "";
    }, 1500);
}

function exitCreateMode() {
    createModeActive = false;
    document.getElementById("createModePanel").classList.remove("visible");
    document.getElementById("board").style.display = "";
    document.getElementById("slot").style.display = "";
    if (diff && !isFreeMode) {
        if (isPresetPending) enterPresetPending(pendingDiff); else newGame();
    } else {
        newGame();
    }
}

function applyPuzzleCode() {
    let input = document.getElementById("puzzleCodeInput");
    let raw = input.value.trim();
    if (!raw) {
        alert("请输入题库码！");
        return;
    }
    let prefix = "我分享了一个[反向💣扫雷]题目，来试试你能不能破解！";
    if (raw.startsWith(prefix)) raw = raw.substring(prefix.length);
    let code = raw.trim();
    try {
        while (code.length % 4 !== 0) code += "=";
        let binary = atob(code);
        let bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        let view = new DataView(bytes.buffer);
        let rows = view.getUint8(0);
        let cols = view.getUint8(1);
        if (rows < 4 || rows > 20 || cols < 4 || cols > 20) throw new Error("棋盘大小超出范围");
        if (rows * cols > 400) throw new Error("棋盘面积超出 400 格上限");
        let allTypes = Object.keys(M).sort();
        let placed = {};
        let offset = 2;
        while (offset + 2 < bytes.length) {
            let r = view.getUint8(offset);
            let c = view.getUint8(offset + 1);
            let typeIdx = view.getUint8(offset + 2);
            if (typeIdx >= allTypes.length) throw new Error("未知地雷类型索引");
            let type = allTypes[typeIdx];
            placed[r + "," + c] = type;
            offset += 3;
        }
        fullReset();
        createModeActive = false;
        document.getElementById("createModePanel").classList.remove("visible");
        SR = rows;
        SC = cols;
        S = Math.max(rows, cols);
        T = Object.keys(placed).length;
        let pool = {};
        for (let k in placed) {
            let t = placed[k];
            pool[t] = (pool[t] || 0) + 1;
        }
        G.pool = pool;
        G.max = T;
        G.placed = {};
        let tar = Array.from({
            length: SR
        }, () => Array(SC).fill(0));
        for (let k in placed) {
            let [r, c] = k.split(",").map(Number);
            M[placed[k]].f(r, c, tar);
        }
        applyTacticalEffects(tar, placed);
        G.tar = tar;
        G.placed = {};
        resetP();
        render();
        renderRec();
        document.getElementById("win").style.display = "none";
        document.getElementById("timer").style.display = "block";
        diff = null;
        isFreeMode = false;
        ts = true;
        startTi();
        AudioFX.confirm();
    } catch (e) {
        alert("题库码无效，请检查！\n" + e.message);
    }
}

function clearPuzzleInput() {
    document.getElementById("puzzleCodeInput").value = "";
    AudioFX.remove();
}

const _origFullReset = fullReset;

const _origNewGame = newGame;

fullReset = function() {
    _origFullReset();
    createModeActive = false;
    document.getElementById("createModePanel").classList.remove("visible");
    document.getElementById("puzzleCodeOutput").textContent = "点击生成后显示";
    document.getElementById("shareCodeBtn").disabled = true;
    let ba = document.getElementById("createBoardArea");
    if (ba) ba.style.display = "none";
    let sl = document.getElementById("createMineSlot");
    if (sl) sl.style.display = "none";
    let cc = document.getElementById("createCodeCard");
    if (cc) cc.style.display = "none";
    let ib = document.getElementById("createInfoBar");
    if (ib) ib.style.display = "none";
    showCreateError("");
};

newGame = function() {
    if (createModeActive) {
        exitCreateMode();
        return;
    }
    _origNewGame();
};

(function() {
    "use strict";
    const bgmSlider = document.getElementById("bgmSlider");
    const bgmValue = document.getElementById("bgmValue");
    function initSlider() {
        const bgmInit = 50;
        bgmSlider.value = bgmInit;
        bgmValue.textContent = bgmInit + "%";
        if (window.RetroBGM && window.RetroBGM.setVolume) {
            window.RetroBGM.setVolume(bgmInit / 100);
        }
    }
    bgmSlider.addEventListener("input", function() {
        const val = parseInt(this.value, 10);
        bgmValue.textContent = val + "%";
        if (window.RetroBGM && window.RetroBGM.setVolume) {
            window.RetroBGM.setVolume(val / 100);
        }
    });
    if (document.readyState === "complete") {
        initSlider();
    } else {
        window.addEventListener("load", initSlider);
    }
})();

window._gameNS = {
    newGame: newGame,
    fullReset: fullReset,
    clearAll: clearAll,
    del: del,
    drop: drop,
    onTutorialWin: onTutorialWin,
    unlockSeries: unlockSeries,
    generatePuzzleCode: generatePuzzleCode,
    applyPuzzleCode: applyPuzzleCode
};

(function() {
    "use strict";
    const ACHIEVEMENTS = [ {
        id: "first_win",
        cat: "新手村",
        emoji: "👷",
        name: "初次上岗布雷工",
        desc: "通关任意一局游戏",
        tip: "First Blood",
        type: "once"
    }, {
        id: "red_green_light",
        cat: "新手村",
        emoji: "🚦",
        name: "红绿灯?!",
        desc: "通关任意一局同时含有正/0/负值的游戏",
        tip: "绿灯行。黄灯更行",
        type: "once"
    }, {
        id: "finish_tutorial",
        cat: "新手村",
        emoji: "📖",
        name: "说明书",
        desc: "完成全部引导教学",
        tip: "已严肃学习布雷技术",
        type: "once"
    }, {
        id: "easy_10",
        cat: "预设难度",
        emoji: "🥬",
        name: "小菜一碟",
        desc: "简单难度通关10次",
        tip: "轻轻松松",
        type: "count",
        target: 10
    }, {
        id: "medium_10",
        cat: "预设难度",
        emoji: "🍗",
        name: "不吃压力",
        desc: "中等难度通关10次",
        tip: "不吃压力，吃大鸡腿",
        type: "count",
        target: 10
    }, {
        id: "hard_10",
        cat: "预设难度",
        emoji: "🧠",
        name: "头有点痒",
        desc: "困难难度通关10次",
        tip: "头有点痒，不会要长脑子了吧",
        type: "count",
        target: 10
    }, {
        id: "hell_first",
        cat: "预设难度",
        emoji: "😈",
        name: "勇往直下",
        desc: "首次通关地狱难度",
        tip: "下界传送门？正在加载地形。。。",
        type: "once"
    }, {
        id: "hell_7",
        cat: "预设难度",
        emoji: "👿",
        name: "地狱客厅",
        desc: "地狱累计通关10次",
        tip: "比猪灵还像本地人",
        type: "count",
        target: 10
    }, {
        id: "brain_first",
        cat: "预设难度",
        emoji: "👍",
        name: "这不是外挂？？",
        desc: "首次通关脑王难度",
        tip: "“轻轻松松”",
        type: "once"
    }, {
        id: "brain_10",
        cat: "预设难度",
        emoji: "🐮",
        name: "666，这个入是桂",
        desc: "脑王累计通关10次",
        tip: "如果这是你真实实力，🐮🍺",
        type: "count",
        target: 10
    }, {
        id: "basic_all_used",
        cat: "系列道具",
        emoji: "🧠",
        name: "头脑不基础",
        desc: "基础系列全部道具至少用来通关过一次",
        tip: "使用的地雷基础，使用者就不基础",
        type: "special",
        check: function() {
            if (!_achState.basicTypesUsed) return false;
            let basics = Object.keys(M).filter(k => M[k].category === "basic");
            return basics.every(k => _achState.basicTypesUsed[k]);
        }
    }, {
        id: "unlock_special",
        cat: "系列道具",
        emoji: "🔷",
        name: "奇葩",
        desc: "解锁异形系列",
        tip: "不是哥们，这形状也是地雷吗",
        type: "special",
        check: function() {
            return seriesUnlocked && seriesUnlocked.special;
        }
    }, {
        id: "unlock_physics",
        cat: "系列道具",
        emoji: "🗿",
        name: "科研人员",
        desc: "解锁物理律系列",
        tip: "致敬英特尔首席工程师-i18芯片缔造者-FlameZ-火博士-科研精神🗿",
        type: "special",
        check: function() {
            return seriesUnlocked && seriesUnlocked.physics;
        }
    }, {
        id: "unlock_symmetry",
        cat: "系列道具",
        emoji: "🥂",
        name: "干杯！",
        desc: "解锁对称系列",
        tip: "反向扫雷 (゜-゜)つロ 干杯~",
        type: "special",
        check: function() {
            return seriesUnlocked && seriesUnlocked.symmetry;
        }
    }, {
        id: "unlock_tactical",
        cat: "系列道具",
        emoji: "🐔",
        name: "酱味大鸡！",
        desc: "解锁战术武器系列",
        tip: "都是铜陵人我原本没想酱味大鸡！",
        type: "special",
        check: function() {
            return seriesUnlocked && seriesUnlocked.tactical;
        }
    }, {
        id: "speed_easy",
        cat: "速通系列",
        emoji: "⏱️",
        name: "颗秒!",
        desc: "简单难度通关＜7秒",
        tip: "蚌蚌蚌蚌!",
        type: "time",
        target: 7e3
    }, {
        id: "speed_medium",
        cat: "速通系列",
        emoji: "⚡",
        name: "借过一下!",
        desc: "中等难度通关＜25秒",
        tip: "我赶时间",
        type: "time",
        target: 25e3
    }, {
        id: "speed_hard",
        cat: "速通系列",
        emoji: "👎",
        name: "ez",
        desc: "困难难度通关＜60秒",
        tip: "gg ez收徒",
        type: "time",
        target: 6e4
    }, {
        id: "speed_hell",
        cat: "速通系列",
        emoji: "😈",
        name: "地狱归来",
        desc: "地狱难度通关＜3分钟",
        tip: "FaZe the fk Up!",
        type: "time",
        target: 18e4
    }, {
        id: "speed_brain",
        cat: "速通系列",
        emoji: "🧠",
        name: "脑力王",
        desc: "脑王难度通关＜5分钟",
        tip: "太有脑了，发动雷霆智慧大脑",
        type: "time",
        target: 3e5
    }, {
        id: "speed_all",
        cat: "速通系列",
        emoji: "🏁",
        name: "最速傳說",
        desc: "5个预设难度，最佳成绩加起来<555秒",
        tip: "反向掃雷最速伝說の五項目",
        type: "special",
        check: function() {
            let sum = 0;
            let hasAll = true;
            [ "easy", "medium", "hard", "hell", "brain" ].forEach(function(d) {
                if (rec[d]) sum += rec[d]; else hasAll = false;
            });
            return hasAll && sum > 0 && sum < 555e3;
        }
    }, {
        id: "create_first",
        cat: "创造模式",
        emoji: "🛠️",
        name: "包工头",
        desc: "创造模式生成第一张关卡",
        tip: "来打灰",
        type: "once"
    }, {
        id: "create_mixed",
        cat: "创造模式",
        emoji: "🏫",
        name: "出卷人",
        desc: "创造模式自制关卡同时包含物理律/对称/战术三类道具",
        tip: "出卷人？打灰高手！",
        type: "special",
        check: function() {
            return _achState.lastCreateCats && _achState.lastCreateCats.physics && _achState.lastCreateCats.symmetry && _achState.lastCreateCats.tactical;
        }
    }, {
        id: "create_10",
        cat: "创造模式",
        emoji: "📋",
        name: "印试卷",
        desc: "创造模式累计生成10张关卡",
        tip: "我们不生产图，我们只是大地雷的搬运工",
        type: "count",
        target: 10
    }, {
        id: "play_shared_5",
        cat: "创造模式",
        emoji: "🏞️",
        name: "观光客",
        desc: "通关5张玩家自制关卡",
        tip: "有点意思",
        type: "count",
        target: 5
    }, {
        id: "create_max_mines",
        cat: "创造模式",
        emoji: "💩",
        name: "巧克力蛋糕",
        desc: "创造出用了棋盘标准下最大地雷数的题目",
        tip: "这就是史",
        type: "special",
        check: function() {
            return _achState.lastCreateMaxMines;
        }
    }, {
        id: "total_20",
        cat: "累计通关",
        emoji: "☕",
        name: "摸鱼高手",
        desc: "累计通关20局",
        tip: "初出茅庐",
        type: "count",
        target: 20
    }, {
        id: "total_50",
        cat: "累计通关",
        emoji: "🍉",
        name: "摸鱼高高手",
        desc: "累计通关50局",
        tip: "摸鱼必备",
        type: "count",
        target: 50
    }, {
        id: "total_150",
        cat: "累计通关",
        emoji: "🍺",
        name: "摸鱼高高高手",
        desc: "累计通关150局",
        tip: "那么工作没干完该怎么办",
        type: "count",
        target: 150
    }, {
        id: "total_500",
        cat: "累计通关",
        emoji: "🧊",
        name: "卧槽？冰！！",
        desc: "累计通关500局",
        tip: "我已经停不下来了",
        type: "count",
        target: 500
    }, {
        id: "total_night",
        cat: "累计通关",
        emoji: "🌙",
        name: "夜猫子",
        desc: "22:00-4:00时间段通关10次",
        tip: "大家都早点休息吧。。。",
        type: "count",
        target: 10
    }, {
        id: "hidden_slide",
        cat: "隐藏",
        emoji: "🧹",
        name: "手滑罢了",
        desc: "单局右键删道具累计20次",
        tip: "才不是点错了20次呢。。。",
        type: "count",
        target: 20,
        hidden: true
    }, {
        id: "hidden_chaos",
        cat: "隐藏",
        emoji: "😨",
        name: "场面一度十分混乱",
        desc: "单局用上五大系列的道具并通关",
        tip: "哇。。好多雷啊。。",
        type: "special",
        hidden: true,
        check: function() {
            return _achState.currentRunCategories && _achState.currentRunCategories.size >= 5;
        }
    }, {
        id: "hidden_flawless",
        cat: "隐藏",
        emoji: "💯",
        name: "一把过",
        desc: "中等及以上预设难度全程不删除/清空道具通关",
        tip: "100分",
        type: "once",
        hidden: true
    }, {
        id: "hidden_eco",
        cat: "隐藏",
        emoji: "♻️",
        name: "环保主义者",
        desc: "使用一次清空放置",
        tip: "地雷不落地，世界更美丽",
        type: "once",
        hidden: true
    }, {
        id: "free_20x20",
        cat: "隐藏",
        emoji: "📐",
        name: "！！？大大？！！",
        desc: "自由模式20×20超大棋盘通关",
        tip: "好像还是不过瘾",
        type: "special",
        hidden: true,
        check: function() {
            return isFreeMode && SR === 20 && SC === 20;
        }
    }, {
        id: "brain_slow",
        cat: "隐藏",
        emoji: "🐷",
        name: "脑力亡",
        desc: "通关脑王难度，但用时超过10分钟",
        tip: "太有脑了，对了，头发还好吗",
        type: "once",
        hidden: true
    }, {
        id: "bgm_adjust",
        cat: "隐藏",
        emoji: "🐲",
        name: "龙？",
        desc: "使用背景音乐调节",
        tip: "聋？可是帝王之征啊！",
        type: "once",
        hidden: true
    }, {
        id: "new_game_spam",
        cat: "隐藏",
        emoji: "🤺",
        name: "退！退！退！",
        desc: "三次重开游戏",
        tip: "不是我喜欢的棋盘，直接重开",
        type: "count",
        target: 3,
        hidden: true
    }, {
        id: "crazy_thursday",
        cat: "隐藏",
        emoji: "🍔",
        name: "疯狂星期四",
        desc: "星期四完成任意游戏一次",
        tip: "疯狂疯狂星期四~",
        type: "once",
        hidden: true
    }, {
        id: "hidden_grass",
        cat: "隐藏",
        emoji: "🌱",
        name: "长草",
        desc: "计时器工作时，15秒不操作地雷",
        tip: "别吵，我在烧烤",
        type: "once",
        hidden: true
    }, {
        id: "hidden_icecream",
        cat: "隐藏",
        emoji: "🍦",
        name: "冰淇淋！",
        desc: "6:00-10:00时间段通关一次游戏",
        tip: "早上好中国！现在我有冰淇淋！",
        type: "once",
        hidden: true
    }, {
        id: "hidden_highvalue",
        cat: "隐藏",
        emoji: "🪑",
        name: "椅子",
        desc: "通关题目含≥5地块的预设难度游戏",
        tip: "这里怎么有张椅子？真拿你没办法，坐好咯",
        type: "special",
        hidden: true,
        check: function() {
            if (!diff || isFreeMode) return false;
            for (let r = 0; r < SR; r++) for (let c = 0; c < SC; c++) if (G.tar[r][c] >= 5) return true;
            return false;
        }
    }, {
        id: "hidden_lowvalue",
        cat: "隐藏",
        emoji: "🦐",
        name: "软脚",
        desc: "通关题目含≤-3地块的预设难度游戏",
        tip: "伊利亚我软脚了，快扶我起来",
        type: "special",
        hidden: true,
        check: function() {
            if (!diff || isFreeMode) return false;
            for (let r = 0; r < SR; r++) for (let c = 0; c < SC; c++) if (G.tar[r][c] <= -3) return true;
            return false;
        }
    }, {
        id: "hidden_teatime",
        cat: "隐藏",
        emoji: "🍵",
        name: "飲茶先",
        desc: "15:00-16:00时间段通关一次游戏",
        tip: "三點幾嘞，飲茶先啦",
        type: "once",
        hidden: true
    } ];
    const STORE_KEY = "achievementState_v1";
    let _achState = loadState();
    function loadState() {
        try {
            let raw = localStorage.getItem(STORE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return {
            unlocked: {},
            counters: {},
            totalWins: 0,
            nightWins: 0,
            basicTypesUsed: {},
            lastCreateCats: null,
            currentRunCategories: null,
            currentRunDeletes: 0,
            currentRunFlawless: true,
            sharedWins: 0,
            bgmAdjusted: false,
            lastCreateMaxMines: false,
            grassIdleStart: 0,
            grassUnlocked: false
        };
    }
    function saveState() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(_achState));
        } catch (e) {}
    }
    let _popupQueue = [];
    let _popupActive = false;
    function showPopup(ach) {
        _popupQueue.push(ach);
        if (!_popupActive) processPopupQueue();
    }
    function processPopupQueue() {
        if (_popupQueue.length === 0) {
            _popupActive = false;
            return;
        }
        _popupActive = true;
        let ach = _popupQueue.shift();
        let overlay = document.getElementById("achPopupOverlay");
        document.getElementById("popupEmoji").textContent = ach.emoji;
        document.getElementById("popupName").textContent = ach.name;
        document.getElementById("popupDesc").textContent = ach.desc;
        overlay.classList.add("active");
        playAchievementSound();
        setTimeout(() => {
            overlay.classList.remove("active");
            setTimeout(processPopupQueue, 400);
        }, 3e3);
    }
    function unlock(id) {
        if (_achState.unlocked[id]) return;
        let ach = ACHIEVEMENTS.find(a => a.id === id);
        if (!ach) return;
        _achState.unlocked[id] = (new Date).toISOString().slice(0, 10);
        saveState();
        showPopup(ach);
        renderAchievements();
    }
    function incrementCounter(id, by) {
        by = by || 1;
        _achState.counters[id] = (_achState.counters[id] || 0) + by;
        let ach = ACHIEVEMENTS.find(a => a.id === id);
        if (ach && ach.type === "count" && _achState.counters[id] >= ach.target) unlock(id);
        saveState();
        renderAchievements();
    }
    function setCounter(id, val) {
        _achState.counters[id] = val;
        let ach = ACHIEVEMENTS.find(a => a.id === id);
        if (ach && ach.type === "count" && val >= ach.target) unlock(id);
        saveState();
        renderAchievements();
    }
    function checkWinAchievements() {
        if (isTutorialMode) return;
        unlock("first_win");
        let day = (new Date).getDay();
        if (day === 4) unlock("crazy_thursday");
        if (diff === "brain" && ct > 6e5) unlock("brain_slow");
        let sumTime = 0;
        let hasAllRec = true;
        [ "easy", "medium", "hard", "hell", "brain" ].forEach(function(d) {
            if (rec[d]) sumTime += rec[d]; else hasAllRec = false;
        });
        if (hasAllRec && sumTime > 0 && sumTime < 555e3) unlock("speed_all");
        let hasPos = false, hasZero = false, hasNeg = false;
        for (let r = 0; r < SR; r++) for (let c = 0; c < SC; c++) {
            let v = G.tar[r][c];
            if (v > 0) hasPos = true; else if (v < 0) hasNeg = true; else hasZero = true;
        }
        if (hasPos && hasZero && hasNeg) unlock("red_green_light");
        if (diff && !isFreeMode) {
            if (diff === "easy") incrementCounter("easy_10");
            if (diff === "medium") incrementCounter("medium_10");
            if (diff === "hard") incrementCounter("hard_10");
            if (diff === "hell") {
                unlock("hell_first");
                incrementCounter("hell_7");
            }
            if (diff === "brain") {
                unlock("brain_first");
                incrementCounter("brain_10");
            }
            if (ct > 0) {
                if (diff === "easy" && ct < 7e3) unlock("speed_easy");
                if (diff === "medium" && ct < 25e3) unlock("speed_medium");
                if (diff === "hard" && ct < 6e4) unlock("speed_hard");
                if (diff === "hell" && ct < 18e4) unlock("speed_hell");
                if (diff === "brain" && ct < 3e5) unlock("speed_brain");
            }
            if ((diff === "medium" || diff === "hard" || diff === "hell" || diff === "brain") && _achState.currentRunFlawless) {
                unlock("hidden_flawless");
            }
        }
        if (isFreeMode && SR === 20 && SC === 20) unlock("free_20x20");
        if (diff && !isFreeMode) {
            let nowH = (new Date).getHours();
            if (nowH >= 6 && nowH < 10) unlock("hidden_icecream");
            if (nowH === 15) unlock("hidden_teatime");
        }
        _achState.totalWins = (_achState.totalWins || 0) + 1;
        let t = _achState.totalWins;
        let totalMap = [ 20, 50, 150, 500 ];
        let totalIds = [ "total_20", "total_50", "total_150", "total_500" ];
        totalMap.forEach((target, i) => {
            let current = _achState.counters[totalIds[i]] || 0;
            if (t > current) {
                setCounter(totalIds[i], t);
            }
        });
        let h = (new Date).getHours();
        if (h >= 22 || h < 4) {
            _achState.nightWins = (_achState.nightWins || 0) + 1;
            let nightCurrent = _achState.counters["total_night"] || 0;
            if (_achState.nightWins > nightCurrent) {
                setCounter("total_night", _achState.nightWins);
            }
        }
        if (_achState.basicTypesUsed) {
            let basics = Object.keys(M).filter(k => M[k].category === "basic");
            if (basics.length > 0 && basics.every(k => _achState.basicTypesUsed[k])) unlock("basic_all_used");
        }
        if (window._currentIsShared) {
            _achState.sharedWins = (_achState.sharedWins || 0) + 1;
            setCounter("play_shared_5", _achState.sharedWins);
            window._currentIsShared = false;
        }
        if (_achState.currentRunCategories && _achState.currentRunCategories.size >= 5) unlock("hidden_chaos");
        ACHIEVEMENTS.forEach(a => {
            if (a.type === "special" && !a.hidden && !_achState.unlocked[a.id] && a.check) {
                try {
                    if (a.check()) unlock(a.id);
                } catch (e) {}
            }
        });
        var hiddenSpecialIds = [ "hidden_highvalue", "hidden_lowvalue" ];
        for (var hi = 0; hi < hiddenSpecialIds.length; hi++) {
            var hidx = hiddenSpecialIds[hi];
            var ha = ACHIEVEMENTS.find(function(x) {
                return x.id === hidx;
            });
            if (ha && ha.type === "special" && ha.hidden && !_achState.unlocked[hidx] && ha.check) {
                try {
                    if (ha.check()) unlock(hidx);
                } catch (e) {}
            }
        }
        saveState();
        renderAchievements();
        renderRecords();
    }
    function renderAchievements() {
        let container = document.getElementById("achList");
        if (!container) return;
        let groups = {};
        ACHIEVEMENTS.forEach(a => {
            if (a.hidden && !_achState.unlocked[a.id]) return;
            if (!groups[a.cat]) groups[a.cat] = [];
            groups[a.cat].push(a);
        });
        let catOrder = [ "新手村", "预设难度", "系列道具", "速通系列", "创造模式", "累计通关", "隐藏" ];
        let html = "";
        catOrder.forEach(cat => {
            if (!groups[cat]) return;
            html += `<div style="font-size:13px;font-weight:700;color:#f59e0b;margin:10px 0 6px 4px;">${cat}</div>`;
            groups[cat].forEach(a => {
                let unlocked = !!_achState.unlocked[a.id];
                let cls = "achievement-item" + (unlocked ? " unlocked" : "") + (a.hidden ? " hidden-ach" : "");
                let name = unlocked ? a.name : a.hidden ? "？？？" : "🔒 " + a.name;
                let desc = unlocked ? a.desc : a.hidden ? "隐藏成就，达成后揭晓" : a.desc;
                let meta = "";
                if (unlocked) meta = "🗓️ " + _achState.unlocked[a.id]; else if (a.type === "count") meta = `进度 ${_achState.counters[a.id] || 0}/${a.target}`;
                let lockIcon = unlocked ? "✅" : a.hidden ? "🔒" : "🔒";
                let tipText = unlocked ? a.tip || "" : a.hidden ? "隐藏成就，达成后揭晓提示" : a.tip || "";
                html += `<div class="${cls}" data-tip="${tipText.replace(/"/g, "&quot;")}">\n                    <div class="achievement-emoji">${a.emoji}</div>\n                    <div class="achievement-info">\n                        <div class="achievement-name">${name}</div>\n                        <div class="achievement-desc">${desc}</div>\n                        ${meta ? `<div class="achievement-meta">${meta}</div>` : ""}\n                    </div>\n                    <div class="achievement-lock">${lockIcon}</div>\n                </div>`;
            });
        });
        container.innerHTML = html;
        let total = ACHIEVEMENTS.filter(a => !a.hidden || _achState.unlocked[a.id]).length;
        let unlocked = Object.keys(_achState.unlocked).length;
        let uc = document.getElementById("achUnlockedCount");
        let tc = document.getElementById("achTotalCount");
        if (uc) uc.textContent = unlocked;
        if (tc) tc.textContent = total;
    }
    function renderRecords() {
        let container = document.getElementById("achRecordList");
        if (!container) return;
        let html = "";
        [ "easy", "medium", "hard", "hell", "brain" ].forEach(d => {
            let label = DIFF_LABEL[d] || d;
            let icon = d === "brain" ? "🤯" : d === "hell" ? "👿" : d === "hard" ? "😤" : d === "medium" ? "😮" : "😎";
            let ec = d === "brain" ? "#ffd700" : d === "hell" ? "#6b21a8" : d === "hard" ? "#d73a3a" : d === "medium" ? "#dc7f33" : "#38a169";
            html += `<div class="record-item" style="border-color:${ec}">`;
            html += `<div class="record-label">${icon}${label}</div>`;
            html += `最快用时：<span class="record-best">${fmtTime(rec[d])}</span><br>`;
            html += `通关次数：<span class="record-count">${wins[d] || 0} 次</span>`;
            html += `</div>`;
        });
        container.innerHTML = html;
    }
    function installHooks() {
        if (window._achHooksInstalled) return;
        window._achHooksInstalled = true;
        var NS = window._gameNS || {};
        let _oUL = typeof window.unlockSeries === "function" ? window.unlockSeries : NS.unlockSeries;
        window.unlockSeries = function(catKey) {
            if (_oUL) _oUL.apply(this, arguments);
            if (catKey === "special") unlock("unlock_special");
            if (catKey === "physics") unlock("unlock_physics");
            if (catKey === "symmetry") unlock("unlock_symmetry");
            if (catKey === "tactical") unlock("unlock_tactical");
            renderAchievements();
        };
        let _oTW = typeof window.onTutorialWin === "function" ? window.onTutorialWin : NS.onTutorialWin;
        window.onTutorialWin = function() {
            if (_oTW) _oTW.apply(this, arguments);
            if (tutorialStep >= 5) unlock("finish_tutorial");
        };
        let _oDel = typeof window.del === "function" ? window.del : NS.del;
        window.del = function(r, c) {
            if (!isTutorialMode) {
                _achState.currentRunDeletes++;
                _achState.currentRunFlawless = false;
                if (_achState.currentRunDeletes >= 20) unlock("hidden_slide");
                resetGrassTimer();
                saveState();
            }
            if (_oDel) return _oDel(r, c);
        };
        if (typeof del !== "undefined") del = window.del;
        let _oCA = typeof window.clearAll === "function" ? window.clearAll : NS.clearAll;
        window.clearAll = function() {
            if (!isTutorialMode) {
                _achState.currentRunFlawless = false;
                unlock("hidden_eco");
                resetGrassTimer();
            }
            if (_oCA) _oCA.apply(this, arguments);
        };
        if (typeof clearAll !== "undefined") clearAll = window.clearAll;
        document.getElementById("clear").onclick = window.clearAll;
        let _oDrop = typeof window.drop === "function" ? window.drop : NS.drop;
        window.drop = function(e) {
            let result;
            if (_oDrop) result = _oDrop.apply(this, arguments);
            if (!isTutorialMode) {
                if (!_achState.currentRunCategories) _achState.currentRunCategories = new Set;
                let t = e && e.dataTransfer ? e.dataTransfer.getData("text/plain") : null;
                if (!t && G.lastDragType) t = G.lastDragType;
                if (t && M[t]) {
                    let cat = M[t].category;
                    _achState.currentRunCategories.add(cat);
                    if (cat === "basic") {
                        _achState.basicTypesUsed[t] = true;
                        saveState();
                    }
                }
                resetGrassTimer();
            }
            return result;
        };
        if (typeof drop !== "undefined") drop = window.drop;
        let _oGen = typeof window.generatePuzzleCode === "function" ? window.generatePuzzleCode : NS.generatePuzzleCode;
        window.generatePuzzleCode = function() {
            let result;
            if (_oGen) result = _oGen.apply(this, arguments);
            if (!isTutorialMode) {
                unlock("create_first");
                incrementCounter("create_10");
                let cats = {
                    physics: false,
                    symmetry: false,
                    tactical: false
                };
                for (let k in createPlaced) {
                    let mk = createPlaced[k];
                    if (M[mk]) {
                        let c = M[mk].category;
                        if (c === "physics") cats.physics = true;
                        if (c === "symmetry") cats.symmetry = true;
                        if (c === "tactical") cats.tactical = true;
                    }
                }
                _achState.lastCreateCats = cats;
                if (cats.physics && cats.symmetry && cats.tactical) unlock("create_mixed");
                let totalCells = createRows * createCols;
                let maxMines = Math.floor(totalCells * .6);
                if (Object.keys(createPlaced).length >= maxMines && maxMines > 0) {
                    _achState.lastCreateMaxMines = true;
                    unlock("create_max_mines");
                }
                saveState();
            }
            return result;
        };
        let _oApply = typeof window.applyPuzzleCode === "function" ? window.applyPuzzleCode : NS.applyPuzzleCode;
        window.applyPuzzleCode = function() {
            window._currentIsShared = true;
            if (_oApply) return _oApply.apply(this, arguments);
        };
        let _oFR = typeof window.fullReset === "function" ? window.fullReset : NS.fullReset;
        window.fullReset = function() {
            _achState.currentRunCategories = new Set;
            _achState.currentRunDeletes = 0;
            _achState.currentRunFlawless = true;
            saveState();
            if (_oFR) return _oFR.apply(this, arguments);
        };
        if (typeof fullReset !== "undefined") fullReset = window.fullReset;
        let _grassInterval = null;
        function startGrassTimer() {
            if (_grassInterval) return;
            _achState.grassIdleStart = Date.now();
            _grassInterval = setInterval(function() {
                if (!ts) {
                    stopGrassTimer();
                    return;
                }
                let idle = Date.now() - _achState.grassIdleStart;
                if (idle >= 15e3) {
                    unlock("hidden_grass");
                    stopGrassTimer();
                }
            }, 1e3);
        }
        function stopGrassTimer() {
            if (_grassInterval) {
                clearInterval(_grassInterval);
                _grassInterval = null;
            }
        }
        function resetGrassTimer() {
            _achState.grassIdleStart = Date.now();
        }
        let _origStartTi = startTi;
        startTi = function() {
            _origStartTi.apply(this, arguments);
            startGrassTimer();
        };
        let _origStopTi = stopTi;
        stopTi = function() {
            stopGrassTimer();
            _origStopTi.apply(this, arguments);
        };
        let _origFullReset2 = fullReset;
        fullReset = function() {
            stopGrassTimer();
            _origFullReset2.apply(this, arguments);
        };
        let _bgmSlider = document.getElementById("bgmSlider");
        if (_bgmSlider) {
            _bgmSlider.addEventListener("input", function() {
                if (!_achState.bgmAdjusted) {
                    _achState.bgmAdjusted = true;
                    saveState();
                    unlock("bgm_adjust");
                }
            });
        }
        let _oNG = typeof window.newGame === "function" ? window.newGame : NS.newGame;
        window.newGame = function() {
            let result;
            if (_oNG) result = _oNG.apply(this, arguments);
            _achState.newGameClicks = (_achState.newGameClicks || 0) + 1;
            if (_achState.newGameClicks >= 3) unlock("new_game_spam");
            saveState();
            return result;
        };
        if (typeof newGame !== "undefined") newGame = window.newGame;
        document.getElementById("reset").onclick = window.newGame;
        let _oDrop2 = window.drop;
        window.drop = function(e) {
            _achState.newGameClicks = 0;
            saveState();
            if (_oDrop2) return _oDrop2.apply(this, arguments);
        };
        let _oDel2 = window.del;
        window.del = function(r, c) {
            _achState.newGameClicks = 0;
            saveState();
            if (_oDel2) return _oDel2(r, c);
        };
        let _oCA2 = window.clearAll;
        window.clearAll = function() {
            _achState.newGameClicks = 0;
            saveState();
            if (_oCA2) return _oCA2.apply(this, arguments);
        };
    }
    function initToggle() {
        let btn = document.getElementById("toggleAchSidebar");
        let sb = document.getElementById("achSidebar");
        if (!btn || !sb) return;
        btn.addEventListener("click", () => {
            AudioFX.confirm();
            sb.classList.toggle("open");
            renderAchievements();
            renderRecords();
        });
        document.addEventListener("click", e => {
            if (!sb.contains(e.target) && e.target !== btn && sb.classList.contains("open")) {
                sb.classList.remove("open");
            }
        });
    }
    function init() {
        installHooks();
        initToggle();
        renderAchievements();
        renderRecords();
        newGame();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
    window.checkWinAchievements = checkWinAchievements;
    window.Achievements = {
        unlock: unlock,
        incrementCounter: incrementCounter,
        renderAchievements: renderAchievements,
        state: _achState
    };
})();

(function initBgEffects() {
    const container = document.getElementById("bgEffects");
    if (!container) return;
    const mineEmojis = [ "💣", "🚩", "❓", "💥", "🕳️", "☢️", "🌶️", "✖️", "🍺", "🌀", "🛡️", "🐮", "🗿" ];
    function spawnMineGhost() {
        if (!container) return;
        let el = document.createElement("div");
        el.className = "bg-mine-ghost";
        el.textContent = mineEmojis[Math.floor(Math.random() * mineEmojis.length)];
        el.style.left = 8 + Math.random() * 90 + "%";
        el.style.top = 8 + Math.random() * 90 + "%";
        el.style.fontSize = 18 + Math.random() * 40 + "px";
        let duration = 4 + Math.random() * 2.5;
        el.style.animationDuration = duration + "s";
        container.appendChild(el);
        setTimeout(() => {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        }, duration * 1e3);
    }
    for (let i = 0; i < 6; i++) {
        setTimeout(spawnMineGhost, Math.random() * 1500);
    }
    function loopSpawn() {
        spawnMineGhost();
        setTimeout(loopSpawn, 600 + Math.random() * 800);
    }
    setTimeout(loopSpawn, 2e3);
})();