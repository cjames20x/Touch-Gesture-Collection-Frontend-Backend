import { normalizeToElement, classifyGesture } from './gesture.js';

const surface             = document.getElementById('surface');
const output              = document.getElementById('output');
const startBtn            = document.getElementById('start-training');
const stopBtn             = document.getElementById('stop-training');
const currentInstruction  = document.getElementById('current-instruction');
const trainingStatus      = document.getElementById('training-status');
const userInfo            = document.getElementById('user-info');
const backBtn             = document.getElementById('back-button');

let gesture              = null;
let mouseDown            = false;          // tracks mouse drag state
let mode                 = 'idle';
let trainingInstructionSet = [];
let trainingStepIndex    = 0;
let trainingRepsTarget   = 10;
let trainingCurrentRep   = 0;
let trainingRecords      = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function getCurrentInstruction() {
  const v = trainingInstructionSet[trainingStepIndex];
  if (typeof v === 'string' && v.length > 0) return v;
  return trainingInstructionSet[0] ?? 'tap';
}

function updateInstructionDisplay() {
  if (!currentInstruction) return;
  if (mode === 'training') {
    currentInstruction.textContent =
      `Training: ${capitalize(getCurrentInstruction())} (rep ${trainingCurrentRep + 1}/${trainingRepsTarget})`;
    if (trainingStatus)
      trainingStatus.textContent = `Step ${trainingStepIndex + 1} / ${trainingInstructionSet.length}`;
  } else {
    currentInstruction.textContent =
      `Next: ${capitalize(trainingInstructionSet[trainingStepIndex] ?? trainingInstructionSet[0] ?? 'tap')}`;
  }
}

function readTrainingSelection() {
  try {
    const raw = localStorage.getItem('selectedSequence');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}
  const selected = document.querySelector('input[name="training-instructions"]:checked');
  if (!selected) return ['tap', 'swipe', 'scroll'];
  return selected.value.split(',').map(s => s.trim());
}

// ---------------------------------------------------------------------------
// Normalise a client-space point relative to the surface element
// ---------------------------------------------------------------------------
function normalizePoint(clientX, clientY) {
  return normalizeToElement(clientX, clientY, surface);
}

// ---------------------------------------------------------------------------
// Core gesture lifecycle  (shared by touch & mouse)
// ---------------------------------------------------------------------------
function gestureStart(clientX, clientY) {
  if (mode !== 'training') return;           // ✅ FIX: guard idle/stopped mode
  gesture = { type: getCurrentInstruction(), points: [] };
  addPoint(clientX, clientY, 0);
}

function gestureMove(clientX, clientY) {
  if (mode !== 'training' || !gesture) return;
  addPoint(clientX, clientY, 0);
}

function gestureEnd() {
  if (mode !== 'training' || !gesture) return;  // ✅ FIX: guard + null check

  // Classify what was drawn (optional — enriches the saved record)
  const detectedType = classifyGesture(gesture.points);

  const data = {
    timestamp:      new Date().toISOString(),
    type:           gesture.type,          // instructed gesture
    detected:       detectedType,          // what the path looks like
    touch_position: gesture.points,
  };

  trainingRecords.push(data);

  // Advance step / rep counters
  trainingStepIndex++;
  if (trainingStepIndex >= trainingInstructionSet.length) {
    trainingStepIndex = 0;
    trainingCurrentRep++;
  }

  if (trainingCurrentRep >= trainingRepsTarget) {
    finishTraining();
  } else {
    log(data);
    gesture = null;
    updateInstructionDisplay();
  }
}

function addPoint(clientX, clientY, pressure) {
  if (!gesture) return;
  const p = normalizePoint(clientX, clientY);
  gesture.points.push({ time: performance.now(), x: p.x, y: p.y, pressure });
}

// ---------------------------------------------------------------------------
// Training complete
// ---------------------------------------------------------------------------
function finishTraining() {
  mode = 'idle';
  gesture = null;

  if (trainingStatus)     trainingStatus.textContent    = 'Training complete ✓';
  if (currentInstruction) currentInstruction.textContent = 'All gestures recorded!';
  if (stopBtn)  stopBtn.style.display  = 'none';
  if (startBtn) startBtn.style.display = '';

  const continueBtn = document.getElementById('continue-btn');
  if (continueBtn) continueBtn.style.display = '';

  renderOutput(trainingRecords, trainingInstructionSet, trainingRepsTarget);

  saveToLocalStorage(trainingRecords);
  sendToBackend({
    user:     getUser(),
    sequence: trainingInstructionSet,
    records:  trainingRecords,
    meta:     { completedAt: new Date().toISOString(), reps: trainingCurrentRep },
  });
}

// ---------------------------------------------------------------------------
// Render results table into #output after training completes
// ---------------------------------------------------------------------------
function renderOutput(records, sequence, reps) {
  if (!output) return;
  output.style.display = '';

  // Gesture emoji map
  const EMOJI = {
    tap:          '👆',
    swipe:        '👉',
    'swipe-left':  '👈',
    'swipe-right': '👉',
    'swipe-up':    '👆',
    'swipe-down':  '👇',
    scroll:       '🖱️',
    unknown:      '❓',
  };
  const emoji = (type) => EMOJI[type] ?? EMOJI[type?.split('-')[0]] ?? '✋';

  // Count matches (instructed vs detected)
  const matched = records.filter(r => r.detected === r.type || r.type.startsWith(r.detected)).length;
  const accuracy = records.length > 0 ? Math.round((matched / records.length) * 100) : 0;

  // Summary stats per gesture type
  const statsByType = {};
  for (const r of records) {
    if (!statsByType[r.type]) statsByType[r.type] = { total: 0, matched: 0, points: [] };
    statsByType[r.type].total++;
    if (r.detected === r.type || r.type.startsWith(r.detected)) statsByType[r.type].matched++;
    statsByType[r.type].points.push(r.touch_position.length);
  }

  // Build rows: one per gesture record
  const rows = records.map((r, i) => {
    const match = r.detected === r.type || r.type.startsWith(r.detected);
    const pts   = r.touch_position.length;
    const rep   = Math.floor(i / sequence.length) + 1;
    const step  = (i % sequence.length) + 1;
    return `
      <tr>
        <td style="text-align:center;color:var(--muted)">${rep}</td>
        <td style="text-align:center;color:var(--muted)">${step}</td>
        <td>${emoji(r.type)} ${capitalize(r.type)}</td>
        <td>${emoji(r.detected)} ${capitalize(r.detected)}</td>
        <td style="text-align:center">${pts}</td>
        <td style="text-align:center;font-size:1rem">${match ? '✅' : '❌'}</td>
      </tr>`;
  }).join('');

  // Summary cards per gesture type
  const summaryCards = Object.entries(statsByType).map(([type, s]) => {
    const pct     = Math.round((s.matched / s.total) * 100);
    const avgPts  = Math.round(s.points.reduce((a, b) => a + b, 0) / s.points.length);
    const color   = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
    return `
      <div style="
        flex:1;min-width:120px;
        border:1px solid var(--muted);
        border-radius:10px;
        padding:10px 14px;
        text-align:center;
      ">
        <div style="font-size:1.5rem">${emoji(type)}</div>
        <div style="font-weight:700;font-size:0.9rem;margin:4px 0">${capitalize(type)}</div>
        <div style="font-size:1.4rem;font-weight:800;color:${color}">${pct}%</div>
        <div style="font-size:0.72rem;color:var(--muted)">${s.matched}/${s.total} correct</div>
        <div style="font-size:0.72rem;color:var(--muted)">${avgPts} pts avg</div>
      </div>`;
  }).join('');

  output.innerHTML = `
    <div style="margin-top:16px;display:flex;flex-direction:column;gap:14px">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between">
        <h2 style="margin:0;font-size:1rem;font-weight:700">Results</h2>
        <span style="font-size:0.78rem;color:var(--muted)">${reps} reps · ${records.length} gestures</span>
      </div>

      <!-- Overall accuracy banner -->
      <div style="
        border-radius:10px;
        padding:12px 16px;
        background:${accuracy >= 80 ? '#dcfce7' : accuracy >= 50 ? '#fef9c3' : '#fee2e2'};
        color:${accuracy >= 80 ? '#15803d' : accuracy >= 50 ? '#92400e' : '#991b1b'};
        font-weight:700;
        font-size:0.95rem;
        display:flex;
        align-items:center;
        gap:10px;
      ">
        <span style="font-size:1.5rem">${accuracy >= 80 ? '🎉' : accuracy >= 50 ? '⚠️' : '🔁'}</span>
        <div>
          <div>Overall accuracy: ${accuracy}%</div>
          <div style="font-size:0.75rem;font-weight:400;opacity:0.85">
            ${accuracy >= 80 ? 'Great job! All gestures recognised well.'
              : accuracy >= 50 ? 'Some gestures need more practice.'
              : 'Try again — focus on making clearer gestures.'}
          </div>
        </div>
      </div>

      <!-- Per-type summary cards -->
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        ${summaryCards}
      </div>

      <!-- Full gesture log table -->
      <details open>
        <summary style="
          cursor:pointer;
          font-size:0.85rem;
          font-weight:600;
          padding:6px 0;
          user-select:none;
        ">Full gesture log</summary>
        <div style="overflow-x:auto;margin-top:8px">
          <table style="
            width:100%;
            border-collapse:collapse;
            font-size:0.78rem;
          ">
            <thead>
              <tr style="border-bottom:2px solid var(--muted)">
                <th style="padding:6px 8px;text-align:center;color:var(--muted);font-weight:600">Rep</th>
                <th style="padding:6px 8px;text-align:center;color:var(--muted);font-weight:600">Step</th>
                <th style="padding:6px 8px;text-align:left;color:var(--muted);font-weight:600">Instructed</th>
                <th style="padding:6px 8px;text-align:left;color:var(--muted);font-weight:600">Detected</th>
                <th style="padding:6px 8px;text-align:center;color:var(--muted);font-weight:600">Points</th>
                <th style="padding:6px 8px;text-align:center;color:var(--muted);font-weight:600">Match</th>
              </tr>
            </thead>
            <tbody style="font-variant-numeric:tabular-nums">
              ${rows}
            </tbody>
          </table>
        </div>
      </details>

    </div>`;
}

// ---------------------------------------------------------------------------
// Storage / backend helpers
// ---------------------------------------------------------------------------
function getUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch (_) { return null; }
}

function saveToLocalStorage(records) {
  try {
    const existingRaw = localStorage.getItem('trainingRecords');
    const existing    = existingRaw ? JSON.parse(existingRaw) : [];
    existing.push({ user: getUser(), records });
    localStorage.setItem('trainingRecords', JSON.stringify(existing));
  } catch (err) {
    console.error('Failed to save training records', err);
  }
}

function sendToBackend(payload) {
  // TODO: replace console.log with a real fetch POST to your backend endpoint
  // e.g.:
  // fetch('/api/training', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(payload),
  // });
  console.log('Training payload to send to backend:', payload);
}

function log(data) {
  console.debug('Gesture captured:', data);
}

// ---------------------------------------------------------------------------
// Touch events
// ---------------------------------------------------------------------------
surface?.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  gestureStart(t.clientX, t.clientY);
}, { passive: false });

surface?.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  gestureMove(t.clientX, t.clientY);
}, { passive: false });

surface?.addEventListener('touchend', (e) => {
  e.preventDefault();
  gestureEnd();
}, { passive: false });

// ---------------------------------------------------------------------------
// Mouse events  (✅ NEW — lets desktop/laptop users use the gesture area)
// ---------------------------------------------------------------------------
surface?.addEventListener('mousedown', (e) => {
  e.preventDefault();
  mouseDown = true;
  gestureStart(e.clientX, e.clientY);
});

surface?.addEventListener('mousemove', (e) => {
  if (!mouseDown) return;
  gestureMove(e.clientX, e.clientY);
});

// Listen on window so dragging outside the surface still ends the gesture
window.addEventListener('mouseup', (e) => {
  if (!mouseDown) return;
  mouseDown = false;
  gestureEnd();
});

// Cancel if mouse leaves the surface mid-drag (optional — comment out to keep recording)
surface?.addEventListener('mouseleave', () => {
  if (!mouseDown) return;
  mouseDown = false;
  gestureEnd();
});

// ---------------------------------------------------------------------------
// Start button
// ---------------------------------------------------------------------------
startBtn?.addEventListener('click', () => {
  trainingInstructionSet = readTrainingSelection();
  trainingStepIndex      = 0;
  trainingCurrentRep     = 0;
  trainingRecords        = [];
  gesture                = null;
  mouseDown              = false;
  mode                   = 'training';

  if (startBtn) startBtn.style.display = 'none';
  if (stopBtn)  stopBtn.style.display  = '';

  // Reset continue button and clear previous results on restart
  const continueBtn = document.getElementById('continue-btn');
  if (continueBtn) continueBtn.style.display = 'none';
  if (output) { output.innerHTML = ''; output.style.display = 'none'; }

  updateInstructionDisplay();
});

// ---------------------------------------------------------------------------
// Stop button
// ---------------------------------------------------------------------------
stopBtn?.addEventListener('click', () => {
  mode      = 'idle';
  gesture   = null;          // ✅ FIX: clear in-flight gesture
  mouseDown = false;

  // ✅ FIX: reset counters so a new Start isn't corrupted
  const savedReps = trainingCurrentRep;
  trainingStepIndex  = 0;
  trainingCurrentRep = 0;

  if (trainingStatus)    trainingStatus.textContent = 'Stopped';
  if (stopBtn)  stopBtn.style.display  = 'none';
  if (startBtn) startBtn.style.display = '';

  saveToLocalStorage(trainingRecords);
  sendToBackend({
    user:     getUser(),
    sequence: trainingInstructionSet,
    records:  trainingRecords,
    meta:     { stoppedAt: new Date().toISOString(), reps: savedReps },
  });
});

// ---------------------------------------------------------------------------
// Show user info
// ---------------------------------------------------------------------------
try {
  const raw = localStorage.getItem('user');
  if (raw && userInfo) {
    const u = JSON.parse(raw);
    userInfo.innerHTML = `<strong>${u.name}</strong> — ${u.age} years`;
  }
} catch (_) {
  if (userInfo) userInfo.textContent = 'Error reading user';
}

// ---------------------------------------------------------------------------
// Back button
// ---------------------------------------------------------------------------
backBtn?.addEventListener('click', () => {
  window.location.href = 'selection.html';
});

// Initial UI state
updateInstructionDisplay();