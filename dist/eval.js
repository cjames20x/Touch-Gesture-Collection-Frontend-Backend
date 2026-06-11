import { authenticate } from './api.js';
function getUser() {
    try {
        const raw = localStorage.getItem('user') ?? '{}';
        const data = JSON.parse(raw);
        const name = data.name || data.participantId || 'unknown';
        const participantId = data.participantId || name.replace(/\s+/g, '_').toLowerCase();
        return { name, participantId };
    }
    catch {
        return { name: 'unknown', participantId: 'unknown' };
    }
}
function getSessionId() {
    return parseInt(new URLSearchParams(window.location.search).get('session') ?? '2', 10);
}
function getEvalMode() {
    return new URLSearchParams(window.location.search).get('mode') ?? 'evaluation';
}
function getTotalEvalReps() {
    return getEvalMode() === 'authentication' ? 1 : 5;
}
function getSequenceTypes() {
    const raw = localStorage.getItem('sequence') ?? 'tap,swipe,scroll';
    const types = raw.split(',').map(s => s.trim()).filter(Boolean);
    return types.length > 0 ? types : ['tap', 'swipe', 'scroll'];
}
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
const TOTAL_EVAL_REPS = getTotalEvalReps();
let surface;
let statusEl;
let instrEl;
let startBtn;
let stopBtn;
let outputEl;
let doneBtn;
let userInfoEl;
let user;
let running = false;
let capturing = false;
let currentRep = 0;
let currentGestureIdx = 0;
let sequenceTypes = [];
let currentEvents = [];
let currentGestures = [];
let accepted = 0;
let rejected = 0;
let cleanupListeners = null;
const API_BASE = 'http://localhost:5000';
let apiConnected = false;
function setPopup(message, state) {
    const popup = document.getElementById('api-popup');
    const msgEl = document.getElementById('api-popup-msg');
    if (!popup || !msgEl)
        return;
    popup.classList.remove('connected', 'offline', 'hidden');
    msgEl.textContent = message;
    if (state === 'connected') {
        popup.classList.add('connected');
        setTimeout(() => popup.classList.add('hidden'), 5000);
    }
    else if (state === 'offline') {
        popup.classList.add('offline');
    }
}
async function checkAPIHealth() {
    setPopup('⏳ Checking API connection...', 'checking');
    try {
        const res = await fetch(`${API_BASE}/ping`, { signal: AbortSignal.timeout(3000) });
        console.log(res);
        const data = await res.json();
        apiConnected = res.ok && data.status === 'ok';
        if (apiConnected) {
            setPopup('🟢 API connected', 'connected');
        }
        else {
            setPopup('🔴 API responded but returned unexpected status', 'offline');
        }
    }
    catch {
        apiConnected = false;
        setPopup('🔴 API offline — scores will save locally only', 'offline');
    }
}
function log(msg, color = '') {
    outputEl.style.display = 'block';
    const line = document.createElement('div');
    line.textContent = msg;
    if (color)
        line.style.color = color;
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
        log('⚠️ No gesture type to prompt — check your sequence configuration.', 'var(--danger)');
        finishEval();
        return;
    }
    capturing = true;
    currentEvents = [];
    statusEl.textContent = `Eval ${currentRep + 1} / ${TOTAL_EVAL_REPS}  ·  Step ${currentGestureIdx + 1} / ${sequenceTypes.length}`;
    instrEl.textContent = GESTURE_LABELS[gestureType] ?? gestureType.toUpperCase();
    resetSurface();
    attachListeners(gestureType);
}
function finaliseGesture(gestureType) {
    const events = currentEvents.slice();
    currentEvents = [];
    if (events.length < 1) {
        log(`⚠️ Eval ${currentRep + 1}: gesture too short — please try again.`);
        setSurface('⚠️ Too short — try again');
        setTimeout(() => { if (running)
            promptGesture(gestureType); }, 800);
        return;
    }
    currentGestures.push({
        gesture_type: gestureType,
        orientation: gestureOrientation(gestureType),
        events,
    });
    setSurface('✅ Got it!', 'var(--success)', '#f0fdf4');
    setTimeout(() => {
        currentGestureIdx++;
        if (currentGestureIdx < sequenceTypes.length) {
            promptGesture(sequenceTypes[currentGestureIdx]);
        }
        else {
            void finaliseEvalRep();
        }
    }, 700);
}
async function finaliseEvalRep() {
    const sequence = { gestures: currentGestures.slice() };
    currentGestures = [];
    currentGestureIdx = 0;
    const pid = user.participantId;
    const sessionId = getSessionId();
    statusEl.textContent = `⏳ Authenticating rep ${currentRep + 1}…`;
    instrEl.textContent = 'Checking…';
    resetSurface();
    try {
        const existing = JSON.parse(localStorage.getItem('evalRecords') || '[]');
        existing.push({ participantId: pid, sessionId, sequence, timestamp: new Date().toISOString() });
        localStorage.setItem('evalRecords', JSON.stringify(existing));
    }
    catch { /* ignore */ }
    if (!apiConnected) {
        log(`⚠️ Rep ${currentRep + 1}: API offline — saved locally only`, '#f59e0b');
        currentRep++;
        advanceOrFinish();
        return;
    }
    const modelId = localStorage.getItem('model_id');
    if (!modelId) {
        log(`⚠️ Rep ${currentRep + 1}: No trained model found — saved locally only`, '#f59e0b');
        currentRep++;
        advanceOrFinish();
        return;
    }
    try {
        const result = await authenticate({ participantId: pid, sessionId, sequence });
        if (result.accepted) {
            accepted++;
            log(`✅ Rep ${currentRep + 1}: ACCEPTED  (LL: ${result.log_likelihood}  θ: ${result.threshold})`, 'var(--success)');
        }
        else {
            rejected++;
            log(`❌ Rep ${currentRep + 1}: REJECTED  (LL: ${result.log_likelihood}  θ: ${result.threshold})`, 'var(--danger)');
        }
    }
    catch (err) {
        log(`⚠️ Rep ${currentRep + 1}: Error — ${err.message}`, '#f59e0b');
    }
    currentRep++;
    advanceOrFinish();
}
function advanceOrFinish() {
    if (currentRep < TOTAL_EVAL_REPS && running) {
        statusEl.textContent = `Rep ${currentRep} done · Get ready…`;
        instrEl.textContent = 'Prepare for next rep…';
        setTimeout(() => {
            if (running)
                promptGesture(sequenceTypes[0]);
        }, 1200);
    }
    else {
        finishEval();
    }
}
function finishEval() {
    running = false;
    capturing = false;
    if (cleanupListeners)
        cleanupListeners();
    startBtn.style.display = 'inline-flex';
    stopBtn.style.display = 'none';
    const total = accepted + rejected;
    const pct = total > 0 ? Math.round((accepted / total) * 100) : 0;
    const allOk = rejected === 0 && total > 0;
    statusEl.textContent = total > 0
        ? `Done — ${accepted}/${total} accepted (${pct}%)`
        : 'Done — saved locally (no model trained yet)';
    instrEl.textContent = allOk
        ? '✅ All attempts accepted!'
        : total > 0
            ? `⚠️ ${rejected} attempt(s) rejected`
            : 'ℹ️ Gestures recorded locally';
    instrEl.style.color = allOk ? 'var(--success)' : total > 0 ? 'var(--danger)' : '#f59e0b';
    log(`\n📊 Summary: ${accepted} accepted, ${rejected} rejected out of ${total} attempts.`);
    doneBtn.style.display = 'flex';
}
function initStartButton() {
    startBtn.addEventListener('click', () => {
        sequenceTypes = getSequenceTypes();
        if (sequenceTypes.length === 0) {
            log('⚠️ No gesture sequence configured. Check localStorage "sequence" key.', 'var(--danger)');
            return;
        }
        running = true;
        capturing = false;
        currentRep = 0;
        currentGestureIdx = 0;
        currentGestures = [];
        accepted = 0;
        rejected = 0;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-flex';
        outputEl.innerHTML = '';
        outputEl.style.display = 'block';
        doneBtn.style.display = 'none';
        instrEl.style.color = '';
        log(`▶ Evaluation · Session ${getSessionId()} · Sequence: ${sequenceTypes.join(' → ')} · ${TOTAL_EVAL_REPS} reps`);
        promptGesture(sequenceTypes[0]);
    });
}
function initStopButton() {
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
}
document.addEventListener('DOMContentLoaded', () => {
    surface = document.getElementById('surface');
    statusEl = document.getElementById('instruction-label');
    instrEl = document.getElementById('instruction-text');
    startBtn = document.getElementById('start-btn');
    stopBtn = document.getElementById('stop-btn');
    outputEl = document.getElementById('output');
    doneBtn = document.getElementById('next-btn');
    userInfoEl = document.getElementById('user-info');
    // FIX: added `as [string, Element | null][]` so TypeScript correctly types
    // the tuple destructuring in filter/map — without it the compiler cannot
    // distinguish the string key slot from the element slot and emits a type error.
    const missing = [
        ['surface', surface],
        ['instruction-label', statusEl],
        ['instruction-text', instrEl],
        ['start-btn', startBtn],
        ['stop-btn', stopBtn],
        ['output', outputEl],
        ['next-btn', doneBtn],
        ['user-info', userInfoEl],
    ].filter(([, el]) => !el).map(([id]) => id);
    if (missing.length > 0) {
        console.error(`[eval] Missing DOM elements: ${missing.join(', ')}. Check your HTML IDs.`);
        return;
    }
    user = getUser();
    userInfoEl.textContent = `${user.name} · ${user.participantId}`;
    startBtn.style.display = 'inline-flex';
    stopBtn.style.display = 'none';
    doneBtn.style.display = 'none';
    initStartButton();
    initStopButton();
    checkAPIHealth();
});
//# sourceMappingURL=eval.js.map