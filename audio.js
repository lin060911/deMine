/* audio.js - 音频系统（音效 + 背景音乐 + 成就音效） */
/* 从 V8.2.1.html 自动拆分生成 */

    const AudioFX = (function() {
        let ctx = null, masterGain = null, muted = false, lastHoverTime = 0, reverbNode = null;
        function init() {
            if (ctx) return;
            try {
                ctx = new (window.AudioContext || window.webkitAudioContext)();
                masterGain = ctx.createGain();
                masterGain.gain.value = 0.35;
                const convolver = ctx.createConvolver();
                const rate = ctx.sampleRate, length = rate * 0.5;
                const impulse = ctx.createBuffer(2, length, rate);
                for (let ch = 0; ch < 2; ch++) {
                    const data = impulse.getChannelData(ch);
                    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
                }
                convolver.buffer = impulse;
                const reverbGain = ctx.createGain();
                reverbGain.gain.value = 0.15;
                convolver.connect(reverbGain);
                reverbGain.connect(masterGain);
                reverbNode = convolver;
                masterGain.connect(ctx.destination);
            } catch(e) { console.warn('Web Audio API not supported'); }
        }
        function resume() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
        function now() { return ctx ? ctx.currentTime : 0; }
        function playTone(freq, duration, type, vol, when, slideTo) {
            if (muted || !ctx) return;
            const t = when || now();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type || 'sine';
            osc.frequency.setValueAtTime(freq, t);
            if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
            gain.gain.setValueAtTime(vol || 0.2, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
            osc.connect(gain);
            gain.connect(masterGain);
            if (reverbNode && vol > 0.15) gain.connect(reverbNode);
            osc.start(t);
            osc.stop(t + duration + 0.05);
        }
        function playPop() {
            if (muted) return; resume();
            const t = now();
            if (t - lastHoverTime < 0.05) return;
            lastHoverTime = t;
            playTone(880, 0.08, 'sine', 0.08, t, 440);
            playTone(1320, 0.06, 'sine', 0.04, t + 0.02);
        }
        function playModalOpen() {
            if (muted) return; resume(); const t = now();
            [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => playTone(f, 0.35, 'sine', 0.18, t + i * 0.05));
            playTone(2093, 0.5, 'triangle', 0.08, t + 0.2);
        }
        function playConfirm() {
            if (muted) return; resume(); const t = now();
            playTone(440, 0.1, 'triangle', 0.25, t);
            playTone(880, 0.15, 'sine', 0.2, t + 0.05);
            playTone(1760, 0.2, 'sine', 0.1, t + 0.1);
        }
        function playWin() {
            if (muted) return; resume(); const t = now();
            const melody = [{f:523.25,d:0.15},{f:659.25,d:0.15},{f:783.99,d:0.15},{f:1046.5,d:0.25},{f:880.0,d:0.15},{f:1046.5,d:0.4}];
            melody.forEach((n, i) => { playTone(n.f, n.d, 'triangle', 0.28, t + i * 0.14); if (i % 2 === 0) playTone(n.f * 2, n.d * 0.5, 'sine', 0.08, t + i * 0.14); });
            playTone(1568, 0.3, 'sine', 0.1, t + 0.5);
            playTone(2093, 0.4, 'sine', 0.08, t + 0.7);
        }
        function playWinBrain() {
            if (muted) return; resume(); const t = now();
            const fanfare = [523, 659, 784, 1047, 1319];
            fanfare.forEach((f, i) => playTone(f, 0.2, 'square', 0.18, t + i * 0.12));
            const chords = [{f:[523,659,784],t:0.7,d:0.8},{f:[349,440,523],t:1.3,d:0.8},{f:[392,494,587],t:1.9,d:0.8},{f:[1047,1319,1568],t:2.6,d:1.2}];
            chords.forEach(c => c.f.forEach(f => playTone(f, c.d, 'sawtooth', 0.12, t + c.t)));
            [2093, 2349, 2637, 3136, 3520, 2637, 2093].forEach((f, i) => playTone(f, 0.4, 'sine', 0.1, t + 3.0 + i * 0.2));
            [0.7, 1.3, 1.9, 2.6, 3.3].forEach((off, i) => playTone(80 + i * 10, 0.2, 'sine', 0.35, t + off));
            playTone(1047, 2.0, 'triangle', 0.25, t + 5.0);
            playTone(60, 1.5, 'sine', 0.25, t + 5.5);
        }
        function playToggle(on) {
            if (muted) return; resume(); const t = now();
            playTone(on ? 523 : 392, 0.12, 'square', 0.12, t);
            if (on) playTone(784, 0.1, 'sine', 0.08, t + 0.05);
        }
        function playPlace() {
            if (muted) return; resume(); const t = now();
            playTone(200, 0.08, 'square', 0.2, t);
            playTone(600, 0.12, 'triangle', 0.18, t + 0.03);
            playTone(1200, 0.08, 'sine', 0.08, t + 0.06);
        }
        function playRemove() {
            if (muted) return; resume(); const t = now();
            playTone(400, 0.1, 'sawtooth', 0.15, t, 200);
            playTone(200, 0.15, 'sine', 0.12, t + 0.05);
        }
        function playError() {
            if (muted) return; resume(); const t = now();
            playTone(200, 0.15, 'sawtooth', 0.2, t);
            playTone(150, 0.2, 'sawtooth', 0.2, t + 0.12);
        }
        function playLocked() {
            if (muted) return; resume(); const t = now();
            playTone(300, 0.08, 'square', 0.1, t);
            playTone(280, 0.08, 'square', 0.1, t + 0.08);
        }
        function playStepDone() {
            if (muted) return; resume(); const t = now();
            playTone(880, 0.1, 'sine', 0.15, t);
            playTone(1100, 0.15, 'sine', 0.12, t + 0.08);
        }
        function playCopy() {
            if (muted) return; resume(); const t = now();
            playTone(1000, 0.08, 'sine', 0.12, t);
            playTone(1500, 0.1, 'sine', 0.1, t + 0.06);
        }
        return { init, resume, pop: playPop, modalOpen: playModalOpen, confirm: playConfirm, win: playWin, winBrain: playWinBrain, toggle: playToggle, place: playPlace, remove: playRemove, error: playError, locked: playLocked, stepDone: playStepDone, copy: playCopy, setMuted: m => { muted = m; }, isMuted: () => muted, setVolume: function(v) { if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, v)) * 0.35; } };    })();

    document.addEventListener('click', () => AudioFX.resume(), { once: true });
    document.addEventListener('touchstart', () => AudioFX.resume(), { once: true });
    document.addEventListener('keydown', () => AudioFX.resume(), { once: true });
