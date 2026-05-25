const API_BASE = 'http://localhost:5000';

const surface    = document.getElementById('surface');
const output     = document.getElementById('output');
const statusEl   = document.getElementById('training-status');
const instructEl = document.getElementById('current-instruction');
const userInfoEl = document.getElementById('user-info');

const GESTURES = ['tap', 'swipe', 'scroll'];
let gesture        = null;
let stepIndex      = 0;
let repCount       = 0;
const REPS         = 10;
const records      = [];
let currentRepRows = [];
let active         = false;
let apiConnected   = false;

// ── User info ───────────────────────────────────────────────────
let currentUser = null;
try {
    const raw = localStorage.getItem('user');
    if (raw && userInfoEl) {
        currentUser = JSON.parse(raw);
        userInfoEl.innerHTML = `<strong>${currentUser.name}</strong> — ${currentUser.age} years`;
    }
} catch { /* ignore */ }

// ── API popup helpers ───────────────────────────────────────────
function setPopup(message, state) {
    const popup = document.getElementById('api-popup');
    const msgEl = document.getElementById('api-popup-msg');
    if (!popup || !msgEl) return;
    popup.classList.remove('connected', 'offline', 'hidden');
    msgEl.textContent = message;
    if (state === 'connected') {
        popup.classList.add('connected');
        setTimeout(() => popup.classList.add('hidden'), 5000);
    } else if (state === 'offline') {
        popup.classList.add('offline');
    }
}

// ── API health check ────────────────────────────────────────────
async function checkAPIHealth() {
    setPopup('⏳ Checking API connection...', 'checking');
    try {
        const res  = await fetch(`${API_BASE}/health`, {
            signal: AbortSignal.timeout(3000)
        });
        const data = await res.json();
        apiConnected = res.ok && data.status === 'ok';

        if (apiConnected) {
            setPopup(
                `🟢 API connected — models: ${data.models}  datasets: ${data.datasets}`,
                'connected'
            );
            console.log('✅ API health:', data);
        } else {
            setPopup('🔴 API responded but returned unexpected status', 'offline');
        }
    } catch (err) {
        apiConnected = false;
        setPopup('🔴 API offline — scores will save locally only', 'offline');
        console.warn('❌ API health check failed:', err.message);
    }
}

// ── Send completed eval to API ──────────────────────────────────
async function submitToAPI(payload) {
    if (!apiConnected) {
        console.warn('API not connected — skipping submission');
        return null;
    }
    try {
        const modelId = localStorage.getItem('model_id');
        if (!modelId) {
            console.warn('No model_id in localStorage — skipping authentication');
            return {
                status  : 'no_model',
                message : 'No trained model found. Complete training first.',
            };
        }

        const pid       = (currentUser?.name || 'unknown').replace(' ', '_').toLowerCase();
        const sessionId = parseInt(localStorage.getItem('session') ?? '1', 10);

        // Coordinates are stored as normalised 0–1 ratios; scale to absolute pixels for the API
        const gestures = payload.records.map(rec => ({
            gesture_type  : rec.type,
            orientation   : rec.type === 'scroll' ? 'vertical' : 'horizontal',
            session_id    : sessionId,
            participant_id: pid,
            repetition    : 0,
            events        : rec.touch_position.map(pt => ({
                timestamp : pt.time,
                x         : pt.x * window.innerWidth,
                y         : pt.y * window.innerHeight,
                pressure  : pt.pressure || 0.5,
                finger_id : 0,
            })),
        }));

        const threeGestures = gestures.slice(0, 3);
        if (threeGestures.length < 3) {
            return { status: 'insufficient', message: 'Need at least 3 gestures to authenticate.' };
        }

        const body = {
            model_id: modelId,
            gesture_sequence: {
                participant_id: pid,
                session_id    : sessionId,
                gestures      : threeGestures,
            },
        };

        const res  = await fetch(`${API_BASE}/authenticate`, {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify(body),
            signal : AbortSignal.timeout(10000),
        });
        const data = await res.json();
        console.log('API authenticate response:', data);
        return data;
    } catch (err) {
        console.error('API submission failed:', err.message);
        return null;
    }
}

// ── Render API result ───────────────────────────────────────────
function renderAPIResult(apiResult) {
    if (!output || !apiResult) return;

    const card = document.createElement('div');
    const isAuth = apiResult.accepted === true;
    const isRej  = apiResult.accepted === false;

    card.style.cssText = [
        'margin-top:8px',
        'padding:14px',
        isAuth ? 'background:#dcfce7;border:1.5px solid #86efac;color:#15803d'
               : isRej ? 'background:#fef2f2;border:1.5px solid #fca5a5;color:#b91c1c'
               : 'background:#fef9c3;border:1.5px solid #fde047;color:#854d0e',
        'border-radius:12px',
        'font-size:0.84rem',
        'font-weight:600',
    ].join(';');

    const statusText = isAuth ? '✅ Authenticated'
                     : isRej  ? '❌ Not authenticated'
                     : `ℹ️ ${apiResult.message || apiResult.status}`;

    card.innerHTML = `
        <div style="font-size:1rem;margin-bottom:6px">${statusText}</div>
        ${apiResult.log_likelihood != null
            ? `<div>Log-likelihood: ${apiResult.log_likelihood.toFixed(4)}</div>`
            : ''}
        ${apiResult.threshold != null
            ? `<div>Threshold: ${apiResult.threshold.toFixed(4)}</div>`
            : ''}
        ${apiResult.participant_id
            ? `<div style="margin-top:4px;font-size:0.76rem;opacity:0.7">${apiResult.participant_id}</div>`
            : ''}
    `;
    output.appendChild(card);
    output.scrollTop = output.scrollHeight;
}

// ── UI helpers ──────────────────────────────────────────────────
function currentGesture() { return GESTURES[stepIndex % GESTURES.length] ?? 'tap'; }
function capitalize(s)     { return s.charAt(0).toUpperCase() + s.slice(1); }

function refreshUI() {
    if (!active) {
        if (statusEl)   statusEl.textContent  = 'Tap Start to begin evaluation';
        if (instructEl) instructEl.textContent = 'Ready';
        return;
    }
    if (statusEl)   statusEl.textContent  = `Rep ${repCount + 1} / ${REPS}  [${stepIndex + 1}/${GESTURES.length}]`;
    if (instructEl) instructEl.textContent = `Perform: ${capitalize(currentGesture())}`;
}

// ── Render rep card ─────────────────────────────────────────────
function renderRepCard(repNumber, rows) {
    if (!output) return;
    output.style.display = '';
    const card = document.createElement('div');
    card.style.cssText = [
        'border:1.5px solid var(--border,#e5e7eb)',
        'border-radius:12px',
        'overflow:hidden',
        'margin-bottom:10px',
    ].join(';');
    const header = document.createElement('div');
    header.style.cssText = [
        'display:flex','justify-content:space-between','align-items:center',
        'padding:10px 14px','background:var(--surface,#f9fafb)',
        'border-bottom:1px solid var(--border,#e5e7eb)',
    ].join(';');
    header.innerHTML = `
        <span style="font-size:0.82rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted,#888)">Rep ${repNumber}</span>
        <span style="font-size:0.78rem;font-weight:600;color:#22c55e">✓ Complete</span>
    `;
    card.appendChild(header);
    const body = document.createElement('div');
    body.style.cssText = 'padding:8px 14px;display:flex;flex-direction:column;gap:6px;';
    rows.forEach(({ type, points, duration }) => {
        const row = document.createElement('div');
        row.style.cssText = [
            'display:flex','justify-content:space-between','align-items:center',
            'padding:6px 10px','background:var(--bg,#fff)',
            'border:1px solid var(--border,#e5e7eb)','border-radius:8px','font-size:0.82rem',
        ].join(';');
        row.innerHTML = `
            <span style="font-weight:600;text-transform:capitalize">${type}</span>
            <span style="color:var(--muted,#888)">${points} pts · ${duration}ms</span>
            <span style="color:#22c55e;font-weight:700">✓</span>
        `;
        body.appendChild(row);
    });
    card.appendChild(body);
    output.appendChild(card);
    output.scrollTop = output.scrollHeight;
}

// ── Render final summary card ───────────────────────────────────
function renderSummaryCard() {
    if (!output) return;
    output.style.display = '';
    const summary = document.createElement('div');
    summary.style.cssText = [
        'margin-top:4px','padding:14px','background:#dcfce7',
        'border:1.5px solid #86efac','border-radius:12px',
        'text-align:center','font-size:0.85rem','font-weight:700','color:#15803d',
    ].join(';');
    summary.textContent = `✓ Evaluation complete — ${records.length} gestures across ${repCount} reps`;
    output.appendChild(summary);
    output.scrollTop = output.scrollHeight;
}

// ── Pointer helpers ─────────────────────────────────────────────
function getPoint(e) {
    if (e.touches) {
        const t = e.touches[0] || e.changedTouches[0];
        // Normalise to 0–1 so submitToAPI can scale to pixels
        return t ? { x: t.clientX / window.innerWidth, y: t.clientY / window.innerHeight, pressure: t.force || 0 } : null;
    }
    return { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight, pressure: 0 };
}

function onStart(e) {
    if (!active) return;
    e.preventDefault();
    const p = getPoint(e);
    if (!p) return;
    gesture = { type: currentGesture(), points: [] };
    gesture.points.push({ time: performance.now(), ...p });
}

function onMove(e) {
    if (!active || !gesture) return;
    e.preventDefault();
    const p = getPoint(e);
    if (!p) return;
    gesture.points.push({ time: performance.now(), ...p });
}

function onEnd(e) {
    if (!active || !gesture) return;
    e.preventDefault();

    if (gesture.points.length < 2) { gesture = null; return; }

    const data = {
        timestamp     : new Date().toISOString(),
        type          : gesture.type,
        touch_position: gesture.points,
    };
    records.push(data);

    const duration = Math.round(
        data.touch_position[data.touch_position.length - 1].time - data.touch_position[0].time
    );
    currentRepRows.push({ type: data.type, points: data.touch_position.length, duration });

    stepIndex++;
    if (stepIndex >= GESTURES.length) {
        stepIndex = 0;
        repCount++;
        renderRepCard(repCount, currentRepRows);
        currentRepRows = [];
    }
    gesture = null;

    if (repCount >= REPS) {
        active = false;
        if (statusEl)   statusEl.textContent  = 'Evaluation complete ✓';
        if (instructEl) instructEl.textContent = 'All gestures recorded!';
        renderSummaryCard();

        const session = localStorage.getItem('session') ?? '1';
        const payload = {
            user   : currentUser,
            session: session,
            records: records,
            meta   : { completedAt: new Date().toISOString(), reps: repCount },
        };

        // Always save locally first
        try {
            const existing = JSON.parse(localStorage.getItem('evalRecords') || '[]');
            existing.push(payload);
            localStorage.setItem('evalRecords', JSON.stringify(existing));
            console.log('Saved to localStorage ✅');
        } catch (err) {
            console.error('localStorage save failed:', err);
        }

        submitToAPI(payload)
            .then(apiResult => { renderAPIResult(apiResult); })
            .catch(err => {
                console.error('submitToAPI rejected:', err);
                renderAPIResult({ status: 'error', message: err.message });
            });

        const doneBtn = document.getElementById('done-btn');
        if (doneBtn) doneBtn.style.display = '';
        const stopBtn = document.getElementById('stop-eval');
        if (stopBtn)  stopBtn.style.display = 'none';
        return;
    }
    refreshUI();
}

// ── Events ──────────────────────────────────────────────────────
surface?.addEventListener('mousedown',  onStart, { passive: false });
surface?.addEventListener('mousemove',  onMove,  { passive: false });
surface?.addEventListener('mouseup',    onEnd,   { passive: false });
surface?.addEventListener('touchstart', onStart, { passive: false });
surface?.addEventListener('touchmove',  onMove,  { passive: false });
surface?.addEventListener('touchend',   onEnd,   { passive: false });

// ── Start / Stop ────────────────────────────────────────────────
const startBtn = document.getElementById('start-eval');
const stopBtn  = document.getElementById('stop-eval');

startBtn?.addEventListener('click', () => {
    stepIndex = 0; repCount = 0; gesture = null; records.length = 0; currentRepRows = [];
    active = true;
    if (output) { output.innerHTML = ''; output.style.display = 'none'; }
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn)  stopBtn.style.display  = '';
    const doneBtn = document.getElementById('done-btn');
    if (doneBtn) doneBtn.style.display = 'none';
    refreshUI();
});

stopBtn?.addEventListener('click', () => {
    active = false;
    if (stopBtn)  stopBtn.style.display  = 'none';
    if (startBtn) startBtn.style.display = '';
    if (statusEl) statusEl.textContent   = 'Stopped';
    if (instructEl) instructEl.textContent = 'Ready';
});

// ── Init ────────────────────────────────────────────────────────
refreshUI();
checkAPIHealth();