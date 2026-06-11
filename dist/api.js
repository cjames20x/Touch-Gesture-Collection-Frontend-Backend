/**
 * src/api.ts
 * Import this in training.ts and eval.ts:
 *   import { submitGestures, authenticate } from './api.js';
 */
const API_BASE = 'http://localhost:5000';
export async function submitGestures(opts) {
    const res = await fetch(`${API_BASE}/submit_gestures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            participant_id: opts.participantId,
            session_id: opts.sessionId,
            sequences: opts.sequences,
            mode: opts.mode,
        }),
    });
    if (!res.ok)
        throw new Error(`Server error ${res.status}`);
    return res.json();
}
export async function authenticate(opts) {
    const res = await fetch(`${API_BASE}/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            participant_id: opts.participantId,
            session_id: opts.sessionId,
            sequence: opts.sequence,
        }),
    });
    if (!res.ok)
        throw new Error(`Server error ${res.status}`);
    return res.json();
}
// ── /users ──────────────────────────────────────────────────────────────────
export async function getUsers() {
    const res = await fetch(`${API_BASE}/users`);
    if (!res.ok)
        throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    return data.users;
}
// ── /ping ────────────────────────────────────────────────────────────────────
export async function ping() {
    try {
        const res = await fetch(`${API_BASE}/ping`);
        return res.ok;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=api.js.map