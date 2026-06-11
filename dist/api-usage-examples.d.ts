/**
 * HOW TO WIRE THE API INTO YOUR EXISTING training.ts / eval.ts
 * ─────────────────────────────────────────────────────────────
 * These are SNIPPETS — paste the relevant parts into your existing source files.
 * The key idea: once you have a completed GestureSequence (3 gestures × N touch events),
 * call submitGestures() or authenticate() and show the result in the UI.
 */
import { type SequencePayload } from './api.js';
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
declare function onTrainingComplete(completedSequences: SequencePayload[]): Promise<void>;
/**
 * Call this once the participant has performed the evaluation gesture sequence.
 * `evalSequence` is a single SequencePayload (3 gestures).
 */
declare function onEvalComplete(evalSequence: SequencePayload): Promise<void>;
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
//# sourceMappingURL=api-usage-examples.d.ts.map