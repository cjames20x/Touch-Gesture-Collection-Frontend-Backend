import { submitGestures } from './api.js';
function getUser() {
    try {
        return JSON.parse(localStorage.getItem('user') ?? '{}');
    }
    catch {
        return {};
    }
}
function getSessionId() {
    return parseInt(new URLSearchParams(window.location.search).get('session') ?? '1', 10);
}
function getSequenceTypes() {
    const fromSequence = localStorage.getItem('sequence');
    if (fromSequence) {
        const types = fromSequence.split(',').map(s => s.trim()).filter(Boolean);
        if (types.length > 0)
            return types;
    }
    try {
        const fromSelected = localStorage.getItem('selectedSequence');
        if (fromSelected) {
            const parsed = JSON.parse(fromSelected);
            if (Array.isArray(parsed) && parsed.length > 0)
                return parsed;
        }
    }
    catch { }
    return ['tap', 'swipe', 'scroll'];
} // FIX: closing brace was missing — everything below was unreachable dead code
function gestureOrientation(type) {
    return type === 'scroll' ? 'vertical' : 'horizontal';
}
function isMultiTouch(type) {
    return type === 'zoom' || type === 'pinch';
}
const GESTURE_LABELS = {
    tap: '👆 TAP — Touch and release quickly',
    swipe: '👉 SWIPE — Slide finger left or right',
    scroll: '👇 SCROLL — Slide finger up or down',
    zoom: '🔍 ZOOM — Two fingers spreading apart',
    pinch: '🤏 PINCH — Two fingers squeezing together',
};
const TOTAL_REPS = 10;
let running = false;
let capturing = false;
let currentRep = 0;
let currentGestureIdx = 0;
let sequenceTypes = [];
let currentEvents = [];
let currentGestures = [];
let completedSequences = [];
let cleanupListeners = null;
let surface;
let statusEl;
let instrEl;
let startBtn;
let stopBtn;
let outputEl;
let continueBtn;
let userInfoEl;
let backBtn;
function log(msg) {
    outputEl.style.display = 'block';
    const line = document.createElement('div');
    line.textContent = msg;
    outputEl.appendChild(line);
    outputEl.scrollTop = outputEl.scrollHeight;
}
function setSurface(text, borderColor = '', bg = '') {
    surface.textContent = text;
    surface.style.borderColor = borderColor;
    surface.style.background = bg;
}
function resetSurface() { setSurface('👆 Gesture Area'); }
function attachListeners(gestureType) {
    if (cleanupListeners)
        cleanupListeners();
    const multi = isMultiTouch(gestureType);
    function onTouchStart(e) {
        e.preventDefault();
        if (!capturing || !running)
            return;
        captureTouches(e.changedTouches, e.timeStamp, multi);
        setSurface('🔴 Recording…', 'var(--accent)', 'var(--accent-light)');
    }
    function onTouchMove(e) {
        e.preventDefault();
        if (!capturing || !running || currentEvents.length === 0)
            return;
        captureTouches(e.changedTouches, e.timeStamp, multi);
    }
    function onTouchEnd(e) {
        e.preventDefault();
        if (!capturing || !running || currentEvents.length === 0)
            return;
        if (multi && e.touches.length > 0)
            return;
        capturing = false;
        cleanup();
        finaliseGesture(gestureType);
    }
    function onMouseDown(e) {
        if (!capturing || !running)
            return;
        currentEvents.push(mouseToPayload(e));
        setSurface('🔴 Recording…', 'var(--accent)', 'var(--accent-light)');
    }
    function onMouseMove(e) {
        if (!capturing || !running || currentEvents.length === 0 || e.buttons === 0)
            return;
        currentEvents.push(mouseToPayload(e));
    }
    function onMouseUp(_e) {
        if (!capturing || !running || currentEvents.length === 0)
            return;
        capturing = false;
        cleanup();
        finaliseGesture(gestureType);
    }
    function cleanup() {
        surface.removeEventListener('touchstart', onTouchStart);
        surface.removeEventListener('touchmove', onTouchMove);
        surface.removeEventListener('touchend', onTouchEnd);
        surface.removeEventListener('mousedown', onMouseDown);
        surface.removeEventListener('mousemove', onMouseMove);
        surface.removeEventListener('mouseup', onMouseUp);
        cleanupListeners = null;
    }
    cleanupListeners = cleanup;
    surface.addEventListener('touchstart', onTouchStart, { passive: false });
    surface.addEventListener('touchmove', onTouchMove, { passive: false });
    surface.addEventListener('touchend', onTouchEnd, { passive: false });
    surface.addEventListener('mousedown', onMouseDown);
    surface.addEventListener('mousemove', onMouseMove);
    surface.addEventListener('mouseup', onMouseUp);
}
function captureTouches(touchList, timeStamp, allFingers) {
    const limit = allFingers ? touchList.length : 1;
    for (let i = 0; i < limit; i++) {
        const t = touchList[i];
        if (!t)
            continue;
        currentEvents.push({
            timestamp: timeStamp,
            x: t.clientX,
            y: t.clientY,
            pressure: t.force ?? 0.5,
            finger_id: t.identifier,
        });
    }
}
function mouseToPayload(e) {
    return { timestamp: e.timeStamp, x: e.clientX, y: e.clientY, pressure: 0.5, finger_id: 0 };
}
function promptGesture(gestureType) {
    if (!gestureType) {
        console.error('[training] promptGesture called with undefined — check sequence config');
        return;
    }
    capturing = true;
    currentEvents = [];
    statusEl.textContent = `Rep ${currentRep + 1} / ${TOTAL_REPS}  ·  Step ${currentGestureIdx + 1} / ${sequenceTypes.length}`;
    instrEl.textContent = GESTURE_LABELS[gestureType] ?? gestureType.toUpperCase();
    resetSurface();
    attachListeners(gestureType);
}
function finaliseGesture(gestureType) {
    const events = currentEvents.slice();
    currentEvents = [];
    if (events.length < 1) {
        log(`⚠️ Rep ${currentRep + 1}: gesture too short — please try again.`);
        setSurface('⚠️ Too short — try again');
        setTimeout(() => { if (running)
            promptGesture(gestureType); }, 800);
        return;
    }
    currentGestures.push({ gesture_type: gestureType, orientation: gestureOrientation(gestureType), events });
    log(`✓ Rep ${currentRep + 1}: ${gestureType} — ${events.length} events`);
    setSurface('✅ Got it!', 'var(--success)', '#f0fdf4');
    setTimeout(() => {
        currentGestureIdx++;
        if (currentGestureIdx < sequenceTypes.length) {
            promptGesture(sequenceTypes[currentGestureIdx]);
        }
        else {
            finaliseRep();
        }
    }, 700);
}
function finaliseRep() {
    completedSequences.push({ gestures: currentGestures.slice() });
    currentGestures = [];
    currentGestureIdx = 0;
    currentRep++;
    if (currentRep < TOTAL_REPS && running) {
        statusEl.textContent = `Rep ${currentRep} complete ✓  —  Get ready…`;
        instrEl.textContent = 'Prepare for next rep…';
        resetSurface();
        setTimeout(() => {
            if (running)
                promptGesture(sequenceTypes[0]);
        }, 1200);
    }
    else {
        void sendToBackend();
    }
}
async function sendToBackend() {
    running = false;
    capturing = false;
    if (cleanupListeners)
        cleanupListeners();
    startBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    statusEl.textContent = '⏳ Sending data to backend…';
    instrEl.textContent = 'Please wait…';
    resetSurface();
    try {
        const existing = JSON.parse(localStorage.getItem('trainingRecords') ?? '[]');
        existing.push({ user: getUser(), sequences: completedSequences, completedAt: new Date().toISOString() });
        localStorage.setItem('trainingRecords', JSON.stringify(existing));
    }
    catch { }
    const user = getUser();
    const pid = user.participantId ?? 'unknown';
    const sessionId = getSessionId();
    try {
        const result = await submitGestures({ participantId: pid, sessionId, sequences: completedSequences, mode: 'train' });
        const status = result['status'];
        statusEl.textContent =
            status === 'trained' ? `✅ Model trained!  Threshold: ${result['threshold']}` :
                status === 'pending' ? `📦 ${result['message']}` :
                    `ℹ️ ${result['message']}`;
        instrEl.textContent = 'Training complete!';
        log(`\n📤 Sent ${completedSequences.length} sequences — status: ${status}`);
        if (status === 'trained') {
            localStorage.setItem('model_id', String(result['model_id'] ?? pid));
        }
    }
    catch (err) {
        statusEl.textContent = `❌ Backend error: ${err.message}`;
        log(`❌ ${err.message}`);
    }
    continueBtn.style.display = 'flex';
}
function initButtons() {
    startBtn.addEventListener('click', () => {
        sequenceTypes = getSequenceTypes();
        if (sequenceTypes.length === 0) {
            log('⚠️ No gesture sequence configured.');
            return;
        }
        running = true;
        capturing = false;
        currentRep = 0;
        currentGestureIdx = 0;
        currentGestures = [];
        completedSequences = [];
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-flex';
        continueBtn.style.display = 'none';
        outputEl.innerHTML = '';
        outputEl.style.display = 'block';
        instrEl.style.color = '';
        log(`▶ Session ${getSessionId()} · Sequence: ${sequenceTypes.join(' → ')} · ${TOTAL_REPS} reps`);
        promptGesture(sequenceTypes[0]);
    });
    stopBtn.addEventListener('click', () => {
        running = false;
        capturing = false;
        if (cleanupListeners)
            cleanupListeners();
        startBtn.style.display = 'inline-flex';
        stopBtn.style.display = 'none';
        statusEl.textContent = 'Stopped — press Start to retry.';
        instrEl.textContent = 'Ready';
        instrEl.style.color = '';
        resetSurface();
    });
    backBtn.addEventListener('click', () => {
        if (!running || confirm('Stop training and go back?')) {
            running = false;
            if (cleanupListeners)
                cleanupListeners();
            window.location.href = 'selection.html';
        }
    });
}
document.addEventListener('DOMContentLoaded', () => {
    surface = document.getElementById('surface');
    statusEl = document.getElementById('training-status');
    instrEl = document.getElementById('current-instruction');
    startBtn = document.getElementById('start-training');
    stopBtn = document.getElementById('stop-training');
    outputEl = document.getElementById('output');
    continueBtn = document.getElementById('continue-btn');
    userInfoEl = document.getElementById('user-info');
    backBtn = document.getElementById('back-button');
    const missing = [
        ['surface', surface],
        ['training-status', statusEl],
        ['current-instruction', instrEl],
        ['start-training', startBtn],
        ['stop-training', stopBtn],
        ['output', outputEl],
        ['continue-btn', continueBtn],
        ['user-info', userInfoEl],
        ['back-button', backBtn],
    ].filter(([, el]) => !el).map(([id]) => id);
    if (missing.length > 0) {
        console.error(`[training] Missing DOM elements: ${missing.join(', ')}. Check your HTML IDs.`);
        return;
    }
    const user = getUser();
    userInfoEl.textContent = user.name
        ? `${user.name}${user.participantId ? ' · ' + user.participantId : ''}`
        : 'Unknown user';
    startBtn.style.display = 'inline-flex';
    stopBtn.style.display = 'none';
    continueBtn.style.display = 'none';
    initButtons();
});
//# sourceMappingURL=training.js.map