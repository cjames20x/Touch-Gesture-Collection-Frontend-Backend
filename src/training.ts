import { submitGestures, type SequencePayload, type GesturePayload, type TouchEventPayload } from './api.js';

type GestureType = 'tap' | 'swipe' | 'scroll' | 'zoom' | 'pinch';

function getUser(): { participantId?: string; name?: string; age?: number } {
  try { return JSON.parse(localStorage.getItem('user') ?? '{}'); }
  catch { return {}; }
}

function getSessionId(): number {
  return parseInt(new URLSearchParams(window.location.search).get('session') ?? '1', 10);
}

function getSequenceTypes(): GestureType[] {
  const fromSequence = localStorage.getItem('sequence');
  if (fromSequence) {
    const types = fromSequence.split(',').map(s => s.trim()).filter(Boolean) as GestureType[];
    if (types.length > 0) return types;
  }
  try {
    const fromSelected = localStorage.getItem('selectedSequence');
    if (fromSelected) {
      const parsed = JSON.parse(fromSelected);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as GestureType[];
    }
  } catch { }
  return ['tap', 'swipe', 'scroll'];
} // FIX: closing brace was missing — everything below was unreachable dead code

function gestureOrientation(type: GestureType): string {
  return type === 'scroll' ? 'vertical' : 'horizontal';
}

function isMultiTouch(type: GestureType): boolean {
  return type === 'zoom' || type === 'pinch';
}

const STEP_LABELS = ['First gesture', 'Second gesture', 'Third gesture'];

const TOTAL_REPS = 10;

let running            = false;
let capturing          = false;
let currentRep         = 0;
let currentGestureIdx  = 0;
let sequenceTypes      : GestureType[] = [];
let currentEvents      : TouchEventPayload[] = [];
let currentGestures    : GesturePayload[] = [];
let completedSequences : SequencePayload[] = [];
let cleanupListeners   : (() => void) | null = null;

let surface     : HTMLDivElement;
let statusEl    : HTMLDivElement;
let instrEl     : HTMLDivElement;
let startBtn    : HTMLButtonElement;
let stopBtn     : HTMLButtonElement;
let outputEl    : HTMLDivElement;
let continueBtn : HTMLAnchorElement;
let userInfoEl  : HTMLDivElement;
let backBtn     : HTMLButtonElement;

function getStepLabel(index: number): string {
  return STEP_LABELS[index] ?? `Gesture ${index + 1}`;
}

function log(msg: string): void {
  outputEl.style.display = 'block';
  const line = document.createElement('div');
  line.textContent = msg;
  outputEl.appendChild(line);
  outputEl.scrollTop = outputEl.scrollHeight;
}

function setSurface(text: string, borderColor = '', bg = ''): void {
  surface.textContent       = text;
  surface.style.borderColor = borderColor;
  surface.style.background  = bg;
}

function resetSurface(): void { setSurface('👆 Gesture Area'); }

function attachListeners(gestureType: GestureType): void {
  if (cleanupListeners) cleanupListeners();
  const multi = isMultiTouch(gestureType);

  function onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    if (!capturing || !running) return;
    captureTouches(e.changedTouches, e.timeStamp, multi);
    setSurface('🔴 Recording…', 'var(--accent)', 'var(--accent-light)');
  }
  function onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    if (!capturing || !running || currentEvents.length === 0) return;
    captureTouches(e.changedTouches, e.timeStamp, multi);
  }
  function onTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    if (!capturing || !running || currentEvents.length === 0) return;
    if (multi && e.touches.length > 0) return;
    capturing = false;
    cleanup();
    finaliseGesture(gestureType);
  }
  function onMouseDown(e: MouseEvent): void {
    if (!capturing || !running) return;
    currentEvents.push(mouseToPayload(e));
    setSurface('🔴 Recording…', 'var(--accent)', 'var(--accent-light)');
  }
  function onMouseMove(e: MouseEvent): void {
    if (!capturing || !running || currentEvents.length === 0 || e.buttons === 0) return;
    currentEvents.push(mouseToPayload(e));
  }
  function onMouseUp(_e: MouseEvent): void {
    if (!capturing || !running || currentEvents.length === 0) return;
    capturing = false;
    cleanup();
    finaliseGesture(gestureType);
  }
  function cleanup(): void {
    surface.removeEventListener('touchstart', onTouchStart);
    surface.removeEventListener('touchmove',  onTouchMove);
    surface.removeEventListener('touchend',   onTouchEnd);
    surface.removeEventListener('mousedown',  onMouseDown);
    surface.removeEventListener('mousemove',  onMouseMove);
    surface.removeEventListener('mouseup',    onMouseUp);
    cleanupListeners = null;
  }
  cleanupListeners = cleanup;
  surface.addEventListener('touchstart', onTouchStart, { passive: false });
  surface.addEventListener('touchmove',  onTouchMove,  { passive: false });
  surface.addEventListener('touchend',   onTouchEnd,   { passive: false });
  surface.addEventListener('mousedown',  onMouseDown);
  surface.addEventListener('mousemove',  onMouseMove);
  surface.addEventListener('mouseup',    onMouseUp);
}

function captureTouches(touchList: TouchList, timeStamp: number, allFingers: boolean): void {
  const limit = allFingers ? touchList.length : 1;
  for (let i = 0; i < limit; i++) {
    const t = touchList[i];
    if (!t) continue;
    currentEvents.push({
      timestamp : timeStamp,
      x         : t.clientX,
      y         : t.clientY,
      pressure  : (t as Touch & { force?: number }).force ?? 0.5,
      finger_id : t.identifier,
    });
  }
}

function mouseToPayload(e: MouseEvent): TouchEventPayload {
  return { timestamp: e.timeStamp, x: e.clientX, y: e.clientY, pressure: 0.5, finger_id: 0 };
}

function promptGesture(gestureType: GestureType): void {
  if (!gestureType) {
    console.error('[training] promptGesture called with undefined — check sequence config');
    return;
  }
  capturing     = true;
  currentEvents = [];
  statusEl.textContent = `Rep ${currentRep + 1} / ${TOTAL_REPS}  ·  Step ${currentGestureIdx + 1} / ${sequenceTypes.length}`;
  instrEl.textContent  = `${getStepLabel(currentGestureIdx)} (${currentRep + 1}/${TOTAL_REPS})`;
  resetSurface();
  attachListeners(gestureType);
}

function finaliseGesture(gestureType: GestureType): void {
  const events  = currentEvents.slice();
  currentEvents = [];

  if (events.length < 1) {
    log(`⚠️ Rep ${currentRep + 1}: gesture too short — please try again.`);
    setSurface('⚠️ Too short — try again');
    setTimeout(() => { if (running) promptGesture(gestureType); }, 800);
    return;
  }

  currentGestures.push({ gesture_type: gestureType, orientation: gestureOrientation(gestureType), events });
  log(`✓ Rep ${currentRep + 1}: ${gestureType} — ${events.length} events`);
  setSurface('✅ Got it!', 'var(--success)', '#f0fdf4');

  setTimeout(() => {
    currentGestureIdx++;
    if (currentGestureIdx < sequenceTypes.length) {
      promptGesture(sequenceTypes[currentGestureIdx] as GestureType);
    } else {
      finaliseRep();
    }
  }, 700);
}

function finaliseRep(): void {
  completedSequences.push({ gestures: currentGestures.slice() });
  currentGestures   = [];
  currentGestureIdx = 0;
  currentRep++;

  if (currentRep < TOTAL_REPS && running) {
    statusEl.textContent = `Rep ${currentRep} complete ✓  —  Get ready…`;
    instrEl.textContent  = 'Prepare for next rep…';
    resetSurface();
    setTimeout(() => {
      if (running) promptGesture(sequenceTypes[0] as GestureType);
    }, 1200);
  } else {
    void sendToBackend();
  }
}

async function sendToBackend(): Promise<void> {
  running   = false;
  capturing = false;
  if (cleanupListeners) cleanupListeners();

  startBtn.style.display = 'none';
  stopBtn.style.display  = 'none';
  statusEl.textContent   = '⏳ Sending data to backend…';
  instrEl.textContent    = 'Please wait…';
  resetSurface();

  try {
    const existing = JSON.parse(localStorage.getItem('trainingRecords') ?? '[]');
    existing.push({ user: getUser(), sequences: completedSequences, completedAt: new Date().toISOString() });
    localStorage.setItem('trainingRecords', JSON.stringify(existing));
  } catch { }

  const user      = getUser();
  const pid       = user.participantId ?? 'unknown';
  const sessionId = getSessionId();

  try {
    const result = await submitGestures({ participantId: pid, sessionId, sequences: completedSequences, mode: 'train' });
    const status = result['status'] as string;
    statusEl.textContent =
      status === 'trained' ? `✅ Model trained!  Threshold: ${result['threshold']}` :
      status === 'pending' ? `📦 ${result['message']}` :
      `ℹ️ ${result['message']}`;
    instrEl.textContent = 'Training complete!';
    log(`\n📤 Sent ${completedSequences.length} sequences — status: ${status}`);
    if (status === 'trained') {
      localStorage.setItem('model_id', String(result['model_id'] ?? pid));
    }
  } catch (err) {
    statusEl.textContent = `❌ Backend error: ${(err as Error).message}`;
    log(`❌ ${(err as Error).message}`);
  }

  continueBtn.style.display = 'flex';
}

function initButtons(): void {
  startBtn.addEventListener('click', () => {
    sequenceTypes = getSequenceTypes();

    if (sequenceTypes.length === 0) {
      log('⚠️ No gesture sequence configured.');
      return;
    }

    running            = true;
    capturing          = false;
    currentRep         = 0;
    currentGestureIdx  = 0;
    currentGestures    = [];
    completedSequences = [];

    startBtn.style.display    = 'none';
    stopBtn.style.display     = 'inline-flex';
    continueBtn.style.display = 'none';
    outputEl.innerHTML        = '';
    outputEl.style.display    = 'block';
    instrEl.style.color       = '';

    log(`▶ Session ${getSessionId()} · Sequence: ${sequenceTypes.join(' → ')} · ${TOTAL_REPS} reps`);
    promptGesture(sequenceTypes[0] as GestureType);
  });

  stopBtn.addEventListener('click', () => {
    running   = false;
    capturing = false;
    if (cleanupListeners) cleanupListeners();

    startBtn.style.display = 'inline-flex';
    stopBtn.style.display  = 'none';
    statusEl.textContent   = 'Stopped — press Start to retry.';
    instrEl.textContent    = 'Ready';
    instrEl.style.color    = '';
    resetSurface();
  });

  backBtn.addEventListener('click', () => {
    if (!running || confirm('Stop training and go back?')) {
      running = false;
      if (cleanupListeners) cleanupListeners();
      window.location.href = 'selection.html';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  surface     = document.getElementById('surface')             as HTMLDivElement;
  statusEl    = document.getElementById('training-status')     as HTMLDivElement;
  instrEl     = document.getElementById('current-instruction') as HTMLDivElement;
  startBtn    = document.getElementById('start-training')      as HTMLButtonElement;
  stopBtn     = document.getElementById('stop-training')       as HTMLButtonElement;
  outputEl    = document.getElementById('output')              as HTMLDivElement;
  continueBtn = document.getElementById('continue-btn')        as HTMLAnchorElement;
  userInfoEl  = document.getElementById('user-info')           as HTMLDivElement;
  backBtn     = document.getElementById('back-button')         as HTMLButtonElement;

  const missing = ([
    ['surface',              surface],
    ['training-status',      statusEl],
    ['current-instruction',  instrEl],
    ['start-training',       startBtn],
    ['stop-training',        stopBtn],
    ['output',               outputEl],
    ['continue-btn',         continueBtn],
    ['user-info',            userInfoEl],
    ['back-button',          backBtn],
  ] as [string, Element | null][]).filter(([, el]) => !el).map(([id]) => id);

  if (missing.length > 0) {
    console.error(`[training] Missing DOM elements: ${missing.join(', ')}. Check your HTML IDs.`);
    return;
  }

  const user = getUser();
  userInfoEl.textContent = user.name
    ? `${user.name}${user.participantId ? ' · ' + user.participantId : ''}`
    : 'Unknown user';

  startBtn.style.display    = 'inline-flex';
  stopBtn.style.display     = 'none';
  continueBtn.style.display = 'none';

  initButtons();
});