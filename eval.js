const API_BASE = 'http://localhost:5000';

// DOM Elements
const surface = document.getElementById('surface');
const output = document.getElementById('output');
const instructLabel = document.getElementById('instruction-label');
const instructText = document.getElementById('instruction-text');
const userInfoEl = document.getElementById('user-info');
const sessionBadge = document.getElementById('session-badge');
const progressFill = document.getElementById('progress-fill');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const approveBtn = document.getElementById('approve-btn');
const rejectBtn = document.getElementById('reject-btn');
const nextBtn = document.getElementById('next-btn');

// Constants
const GESTURE_SEQUENCE = ['tap', 'scroll', 'swipe'];
const TRAINING_REPS = 10;
const EVALUATION_REPS = 10;
const AUTHENTICATION_REPS = 1;

// State
let currentMode = 'training';
let currentUser = null;
let gestureIndex = 0;
let repCount = 0;
let maxReps = TRAINING_REPS;
let currentGesture = null;
let isRecording = false;
let isRunning = false;
let apiConnected = false;
let records = [];
let currentRepGestures = [];
let authenticationResult = null;

const modes = {
  training: {
    label: 'TRAINING',
    reps: TRAINING_REPS,
    showApproveReject: false,
    description: 'Record baseline biometric data'
  },
  evaluation: {
    label: 'EVALUATION',
    reps: EVALUATION_REPS,
    showApproveReject: true,
    description: 'Evaluate model with metrics'
  },
  authentication: {
    label: 'AUTHENTICATION',
    reps: AUTHENTICATION_REPS,
    showApproveReject: false,
    description: 'Authenticate single attempt'
  }
};

function getUser() {
  try {
    const raw = localStorage.getItem('user') ?? '{}';
    const data = JSON.parse(raw);
    const name = data.name || data.participantId || 'unknown';
    const participantId = data.participantId || name.replace(/\s+/g, '_').toLowerCase();
    return { name, participantId };
  } catch {
    return { name: 'unknown', participantId: 'unknown' };
  }
}

function getSession() {
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') || 'training';
}

function setMode(mode) {
  currentMode = mode;
  maxReps = modes[mode].reps;
  if (sessionBadge) sessionBadge.textContent = modes[mode].label;
  if (approveBtn) approveBtn.style.display = modes[mode].showApproveReject ? 'flex' : 'none';
  if (rejectBtn) rejectBtn.style.display = modes[mode].showApproveReject ? 'flex' : 'none';
}

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

async function checkAPIHealth() {
  setPopup('⏳ Checking API connection...', 'checking');
  try {
    const res = await fetch(`${API_BASE}/health`, {
      signal: AbortSignal.timeout(3000)
    });
    const data = await res.json();
    apiConnected = res.ok && data.status === 'ok';

    if (apiConnected) {
      setPopup(
        `🟢 API connected — models: ${data.models}  datasets: ${data.datasets}`,
        'connected'
      );
    } else {
      setPopup('🔴 API responded but returned unexpected status', 'offline');
    }
  } catch (err) {
    apiConnected = false;
    setPopup('🔴 API offline — scores will save locally only', 'offline');
  }
}

async function submitToAPI(payload) {
  if (!apiConnected) {
    log('⚠️ API not connected — saved locally only', 'warning');
    return null;
  }

  try {
    const modelId = localStorage.getItem('model_id');
    if (!modelId && currentMode !== 'training') {
      log('⚠️ No trained model found', 'warning');
      return null;
    }

    const pid = currentUser.participantId;
    const sessionMap = { training: 1, evaluation: 2, authentication: 3 };
    const sessionId = sessionMap[currentMode] || 1;

    const gestures = currentRepGestures.map(g => ({
      gesture_type: g.type,
      orientation: g.type === 'scroll' ? 'vertical' : 'horizontal',
      session_id: sessionId,
      participant_id: pid,
      events: g.points.map(pt => ({
        timestamp: pt.time,
        x: pt.x * window.innerWidth,
        y: pt.y * window.innerHeight,
        pressure: pt.pressure || 0.5,
        finger_id: 0,
      })),
    }));

    if (currentMode === 'training') {
      const body = {
        participant_id: pid,
        session_id: sessionId,
        gestures: gestures,
      };
      const res = await fetch(`${API_BASE}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      return data;
    } else {
      const body = {
        model_id: modelId,
        gesture_sequence: {
          participant_id: pid,
          session_id: sessionId,
          gestures: gestures,
        },
      };
      const res = await fetch(`${API_BASE}/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      return data;
    }
  } catch (err) {
    log(`⚠️ API error: ${err.message}`, 'error');
    return null;
  }
}

function log(msg, type = 'info') {
  if (!output) return;
  output.style.display = 'block';
  const line = document.createElement('div');
  line.className = `output-line ${type}`;
  line.textContent = msg;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

function setSurfaceState(text, state = 'normal') {
  if (!surface) return;
  surface.textContent = text;
  surface.classList.remove('recording', 'success');
  if (state === 'recording') surface.classList.add('recording');
  if (state === 'success') surface.classList.add('success');
}

function updateProgress() {
  if (!progressFill) return;
  const gestureProgress = (gestureIndex / GESTURE_SEQUENCE.length) * 100;
  const repProgress = ((repCount + gestureProgress / 100) / maxReps) * 100;
  progressFill.style.width = `${repProgress}%`;
}

function updateInstruction() {
  if (!instructLabel || !instructText) return;
  const gesture = GESTURE_SEQUENCE[gestureIndex];
  const labels = {
    tap: '👆 TAP',
    scroll: '👇 SCROLL',
    swipe: '👉 SWIPE'
  };

  instructLabel.textContent = `Gesture ${gestureIndex + 1}/3`;
  instructText.textContent = `${labels[gesture] || gesture.toUpperCase()} (${repCount + 1}/${maxReps})`;
  updateProgress();
}

function getPoint(e) {
  if (e.touches) {
    const t = e.touches[0] || e.changedTouches[0];
    return t ? {
      x: t.clientX / window.innerWidth,
      y: t.clientY / window.innerHeight,
      pressure: t.force || 0.5
    } : null;
  }
  return {
    x: e.clientX / window.innerWidth,
    y: e.clientY / window.innerHeight,
    pressure: 0.5
  };
}

function onPointerStart(e) {
  if (!isRunning) return;
  e.preventDefault();
  const p = getPoint(e);
  if (!p) return;

  isRecording = true;
  const gesture = GESTURE_SEQUENCE[gestureIndex];
  currentGesture = { type: gesture, points: [] };
  currentGesture.points.push({ time: performance.now(), ...p });
  setSurfaceState('🔴', 'recording');
}

function onPointerMove(e) {
  if (!isRunning || !isRecording || !currentGesture) return;
  e.preventDefault();
  const p = getPoint(e);
  if (!p) return;
  currentGesture.points.push({ time: performance.now(), ...p });
}

function onPointerEnd(e) {
  if (!isRunning || !isRecording || !currentGesture) return;
  e.preventDefault();

  if (currentGesture.points.length < 2) {
    log('⚠️ Gesture too short, try again', 'warning');
    currentGesture = null;
    isRecording = false;
    setSurfaceState('👆');
    return;
  }

  currentRepGestures.push(currentGesture);
  setSurfaceState('✅', 'success');

  setTimeout(() => {
    gestureIndex++;
    if (gestureIndex < GESTURE_SEQUENCE.length) {
      currentGesture = null;
      isRecording = false;
      updateInstruction();
      setSurfaceState('👆');
    } else {
      completeRep();
    }
  }, 600);
}

function attachGestureListeners() {
  if (!surface) return;
  surface.addEventListener('mousedown', onPointerStart, { passive: false });
  surface.addEventListener('mousemove', onPointerMove, { passive: false });
  surface.addEventListener('mouseup', onPointerEnd, { passive: false });
  surface.addEventListener('touchstart', onPointerStart, { passive: false });
  surface.addEventListener('touchmove', onPointerMove, { passive: false });
  surface.addEventListener('touchend', onPointerEnd, { passive: false });
}

function detachGestureListeners() {
  if (!surface) return;
  surface.removeEventListener('mousedown', onPointerStart);
  surface.removeEventListener('mousemove', onPointerMove);
  surface.removeEventListener('mouseup', onPointerEnd);
  surface.removeEventListener('touchstart', onPointerStart);
  surface.removeEventListener('touchmove', onPointerMove);
  surface.removeEventListener('touchend', onPointerEnd);
}

async function completeRep() {
  isRecording = false;
  gestureIndex = 0;

  setSurfaceState('⏳');
  instructText.textContent = 'Processing...';

  try {
    const existing = JSON.parse(localStorage.getItem('evalRecords') || '[]');
    const sessionMap = { training: 1, evaluation: 2, authentication: 3 };
    existing.push({
      participantId: currentUser.participantId,
      sessionId: sessionMap[currentMode],
      mode: currentMode,
      sequence: { gestures: currentRepGestures },
      timestamp: new Date().toISOString()
    });
    localStorage.setItem('evalRecords', JSON.stringify(existing));
  } catch (err) {
    log('⚠️ Failed to save locally', 'warning');
  }

  if (apiConnected && currentMode !== 'training') {
    const result = await submitToAPI({
      participantId: currentUser.participantId,
      mode: currentMode,
      gestures: currentRepGestures
    });
    if (result?.accepted !== undefined) {
      authenticationResult = result;

      if (currentMode === 'authentication') {
        // For authentication mode, show prominent result instead of logging
        setSurfaceState(result.accepted ? '✅' : '❌');
        log(
          result.accepted
            ? `🟢 AUTHENTICATION ACCEPTED`
            : `🔴 AUTHENTICATION REJECTED`,
          result.accepted ? 'success' : 'error'
        );
        if (result.confidence !== undefined) {
          log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`, 'info');
        }
      } else {
        // For evaluation mode, just log the result
        log(result.accepted ? `✅ Rep ${repCount + 1}: ACCEPTED` : `❌ Rep ${repCount + 1}: REJECTED`,
            result.accepted ? 'success' : 'error');
      }
    }
  } else if (currentMode === 'training') {
    log(`✓ Rep ${repCount + 1} recorded`, 'success');
  }

  currentRepGestures = [];
  repCount++;

  if (repCount < maxReps && isRunning) {
    instructText.textContent = `Ready for rep ${repCount + 1}...`;
    setTimeout(() => {
      if (isRunning) {
        updateInstruction();
        setSurfaceState('👆');
      }
    }, 1000);
  } else {
    completeMode();
  }
}

async function completeMode() {
  isRunning = false;
  detachGestureListeners();

  if (startBtn) startBtn.style.display = 'inline-flex';
  if (stopBtn) stopBtn.style.display = 'none';
  if (approveBtn) approveBtn.style.display = 'none';
  if (rejectBtn) rejectBtn.style.display = 'none';

  if (instructText) {
    if (currentMode === 'authentication') {
      if (authenticationResult?.accepted) {
        instructText.textContent = '✓ Access Granted';
      } else {
        instructText.textContent = '✗ Access Denied';
      }
    } else {
      instructText.textContent = '✓ Complete';
    }
  }

  if (currentMode !== 'authentication') {
    setSurfaceState('🎉');
  }

  if (currentMode !== 'authentication') {
    log(`\n${modes[currentMode].label} complete — ${repCount} repetitions recorded`, 'success');
  }

  const nextSection = document.getElementById('next-section');
  if (nextSection) {
    nextSection.style.display = 'block';
    if (nextBtn) nextBtn.style.display = 'inline-flex';

    if (currentMode === 'training') {
      if (nextBtn) {
        nextBtn.href = 'eval.html?mode=evaluation';
        nextBtn.textContent = '→ Start Evaluation';
      }
    } else if (currentMode === 'evaluation') {
      if (nextBtn) {
        nextBtn.href = 'eval.html?mode=authentication';
        nextBtn.textContent = '→ Start Authentication';
      }
    } else {
      if (nextBtn) {
        nextBtn.href = 'selection.html';
        nextBtn.textContent = '✓ Done';
      }
    }
  }
}

startBtn?.addEventListener('click', () => {
  repCount = 0;
  gestureIndex = 0;
  records = [];
  currentRepGestures = [];
  isRunning = true;
  authenticationResult = null;

  if (startBtn) startBtn.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'inline-flex';
  if (nextBtn) nextBtn.style.display = 'none';
  if (output) output.innerHTML = '';
  if (output) output.style.display = 'none';

  attachGestureListeners();
  updateInstruction();
  setSurfaceState('👆');
});

stopBtn?.addEventListener('click', () => {
  isRunning = false;
  isRecording = false;
  detachGestureListeners();

  if (stopBtn) stopBtn.style.display = 'none';
  if (startBtn) startBtn.style.display = 'inline-flex';
  if (instructText) instructText.textContent = 'Stopped';
  setSurfaceState('⏸');
});

approveBtn?.addEventListener('click', () => {
  log(`✓ Rep ${repCount} approved by evaluator`, 'success');
});

rejectBtn?.addEventListener('click', () => {
  log(`✗ Rep ${repCount} rejected by evaluator`, 'error');
});

document.addEventListener('DOMContentLoaded', () => {
  currentUser = getUser();
  const mode = getSession();

  if (userInfoEl) userInfoEl.textContent = `${currentUser.name} (${currentUser.participantId})`;
  setMode(mode);
  updateInstruction();

  checkAPIHealth();
});