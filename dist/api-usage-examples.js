/**
 * HOW TO WIRE THE API INTO YOUR EXISTING training.ts / eval.ts
 * ─────────────────────────────────────────────────────────────
 * These are SNIPPETS — paste the relevant parts into your existing source files.
 * The key idea: once you have a completed GestureSequence (3 gestures × N touch events),
 * call submitGestures() or authenticate() and show the result in the UI.
 */
import { submitGestures, authenticate } from './api.js';
// ── Utility: read user from localStorage (set by register/consent flow) ────
function getUser() {
    return JSON.parse(localStorage.getItem('user') ?? '{}');
}
function getSessionId() {
    const params = new URLSearchParams(window.location.search);
    return parseInt(params.get('session') ?? '1', 10);
}
// ════════════════════════════════════════════════════════════════════════════
// TRAINING — add to the end of your training completion handler in training.ts
// ════════════════════════════════════════════════════════════════════════════
/**
 * Call this once you have collected all repetitions and built `completedSequences`.
 *
 * `completedSequences` is an array of SequencePayload objects you build while
 * recording touch events, e.g.:
 *
 *   const seq: SequencePayload = {
 *     gestures: [
 *       { gesture_type: 'tap',   orientation: 'horizontal', events: [...TouchEventPayload] },
 *       { gesture_type: 'swipe', orientation: 'horizontal', events: [...] },
 *       { gesture_type: 'pinch', orientation: 'horizontal', events: [...] },
 *     ]
 *   };
 */
async function onTrainingComplete(completedSequences) {
    const { participantId = 'unknown' } = getUser();
    const sessionId = getSessionId();
    const statusEl = document.getElementById('training-status');
    if (statusEl)
        statusEl.textContent = '⏳ Sending to backend…';
    try {
        const result = await submitGestures({
            participantId,
            sessionId,
            sequences: completedSequences,
            mode: 'train',
        });
        const msg = result['status'] === 'trained'
            ? `✅ Model trained! Threshold: ${result['threshold']}`
            : `📦 ${result['message']}`;
        if (statusEl)
            statusEl.textContent = msg;
        // Show the "Back to Session" button
        const btn = document.getElementById('continue-btn');
        if (btn)
            btn.style.display = 'block';
    }
    catch (err) {
        if (statusEl)
            statusEl.textContent = `❌ Backend error: ${err.message}`;
        console.error(err);
    }
}
// ════════════════════════════════════════════════════════════════════════════
// EVALUATION — add to the end of your evaluation completion handler in eval.ts
// ════════════════════════════════════════════════════════════════════════════
/**
 * Call this once the participant has performed the evaluation gesture sequence.
 * `evalSequence` is a single SequencePayload (3 gestures).
 */
async function onEvalComplete(evalSequence) {
    const { participantId = 'unknown' } = getUser();
    const sessionId = getSessionId();
    const statusEl = document.getElementById('training-status');
    const outputEl = document.getElementById('output');
    if (statusEl)
        statusEl.textContent = '⏳ Authenticating…';
    try {
        const result = await authenticate({
            participantId,
            sessionId,
            sequence: evalSequence,
        });
        const verdict = result.accepted ? '✅ ACCEPTED' : '❌ REJECTED';
        const color = result.accepted ? 'var(--success)' : 'var(--danger)';
        if (statusEl) {
            statusEl.textContent = verdict;
            statusEl.style.color = color;
        }
        if (outputEl) {
            outputEl.style.display = 'block';
            outputEl.innerHTML = `
        <strong>Participant:</strong> ${result.participant_id}<br>
        <strong>Session:</strong>     ${result.session_id}<br>
        <strong>Log-likelihood:</strong> ${result.log_likelihood}<br>
        <strong>Threshold:</strong>   ${result.threshold}<br>
        <strong>Result:</strong>      <span style="color:${color};font-weight:800">${verdict}</span>
      `;
        }
        // Show "Done" button
        const doneBtn = document.getElementById('done-btn');
        if (doneBtn)
            doneBtn.style.display = 'block';
    }
    catch (err) {
        if (statusEl)
            statusEl.textContent = `❌ Backend error: ${err.message}`;
        console.error(err);
    }
}
// ════════════════════════════════════════════════════════════════════════════
// HOW TO BUILD A SequencePayload FROM RAW TOUCH EVENTS
// ════════════════════════════════════════════════════════════════════════════
/**
 * In your gesture surface event listeners, collect TouchEventPayload objects:
 *
 *   surface.addEventListener('touchstart', (e) => {
 *     const t = e.changedTouches[0]!;
 *     currentEvents.push({
 *       timestamp : t.timeStamp,
 *       x         : t.clientX,
 *       y         : t.clientY,
 *       pressure  : t.force ?? 0.5,
 *       finger_id : t.identifier,
 *     });
 *   });
 *
 * Then on touchend, push the finished gesture into currentGestures[]:
 *
 *   currentGestures.push({
 *     gesture_type : currentGestureType,   // 'tap' | 'swipe' | ...
 *     orientation  : 'horizontal',
 *     events       : [...currentEvents],
 *   });
 *   currentEvents = [];
 *
 * Once currentGestures.length === 3, wrap into a SequencePayload:
 *
 *   const seq: SequencePayload = { gestures: currentGestures };
 *   completedSequences.push(seq);
 *   currentGestures = [];
 */
export { onTrainingComplete, onEvalComplete };
//# sourceMappingURL=api-usage-examples.js.map