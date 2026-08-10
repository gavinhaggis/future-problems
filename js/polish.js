'use strict';
/* Cross-cutting polish shared by app.js / host.js / guest.js / tv.js:
   - sfx: procedurally synthesized via Web Audio — no audio files to ship
   - vibrate(): phone haptics, feature-detected no-op elsewhere
   - wake lock: keeps the screen on during an active game
   - room cache: remembers {room, alias} so a dropped guest connection
     can silently reconnect instead of booting the player back to the join screen
*/

/* ---------- SFX ---------- */

let audioCtx = null;
let muted = localStorage.getItem('fp-muted') === '1';

function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

function beep({ freq = 440, duration = 0.08, type = 'square', gain = 0.06, sweepTo = null, delay = 0 } = {}) {
    if (muted) return;
    try {
        const ctx = getAudioCtx();
        const t0 = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + duration);
        g.gain.setValueAtTime(gain, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
        osc.connect(g).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + duration + 0.02);
    } catch (e) { /* Web Audio unavailable — fail silent */ }
}

const sfx = {
    pick: () => beep({ freq: 880, duration: 0.05, gain: 0.05 }),
    drop: () => beep({ freq: 440, duration: 0.05, gain: 0.04 }),
    lockIn: () => { beep({ freq: 660, duration: 0.07 }); beep({ freq: 990, duration: 0.09, delay: 0.06 }); },
    trouble: () => beep({ freq: 220, duration: 0.28, type: 'sawtooth', sweepTo: 80, gain: 0.07 }),
    judge: () => beep({ freq: 520, duration: 0.06, type: 'triangle' }),
    fanfare: () => {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => beep({ freq: f, duration: 0.18, gain: 0.06, delay: i * 0.09 }));
    },
    revealStart: () => { beep({ freq: 300, duration: 0.1, type: 'triangle', gain: 0.06 }); beep({ freq: 450, duration: 0.12, type: 'triangle', gain: 0.05, delay: 0.08 }); },
    flip: () => beep({ freq: 700, duration: 0.06, type: 'triangle', sweepTo: 1100, gain: 0.06 }),
    nudge: () => { beep({ freq: 500, duration: 0.05, gain: 0.05 }); beep({ freq: 500, duration: 0.05, gain: 0.05, delay: 0.1 }); },
    isMuted: () => muted,
    toggleMute: () => {
        muted = !muted;
        localStorage.setItem('fp-muted', muted ? '1' : '0');
        return muted;
    },
};

(function injectMuteButton() {
    if (document.getElementById('mute-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'mute-toggle';
    btn.className = 'mute-btn';
    btn.type = 'button';
    btn.textContent = muted ? '\u{1F507}' : '\u{1F50A}';
    btn.addEventListener('click', () => { btn.textContent = sfx.toggleMute() ? '\u{1F507}' : '\u{1F50A}'; });
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(btn));
    if (document.readyState !== 'loading') document.body.appendChild(btn);
})();

/* ---------- Nudge toast ---------- */

function showNudgeToast(fromAlias) {
    let toast = document.createElement('div');
    toast.className = 'nudge-toast';
    toast.textContent = `\u{1F44B} ${fromAlias} is waiting on you!`;
    document.body.appendChild(toast);
    vibrate([100, 50, 100, 50, 200]);
    setTimeout(() => toast.remove(), 3000);
}

/* ---------- Vibration ---------- */

function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* ignore */ } }
}

/* ---------- Wake Lock ---------- */

let wakeLock = null;
let wantsWakeLock = false;

async function keepAwake() {
    wantsWakeLock = true;
    if (!('wakeLock' in navigator) || wakeLock) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    catch (e) { /* blocked by battery saver / permissions — non-fatal */ }
}

function allowSleep() {
    wantsWakeLock = false;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wantsWakeLock) keepAwake();
});

/* ---------- Room cache (guest reconnect) ---------- */

const ROOM_CACHE_KEY = 'fp-last-room';

function saveRoomCache(room, alias) {
    try { localStorage.setItem(ROOM_CACHE_KEY, JSON.stringify({ room, alias })); } catch (e) { /* ignore */ }
}
function loadRoomCache() {
    try { return JSON.parse(localStorage.getItem(ROOM_CACHE_KEY)); } catch (e) { return null; }
}
function clearRoomCache() {
    try { localStorage.removeItem(ROOM_CACHE_KEY); } catch (e) { /* ignore */ }
}
