/**
 * api-client.js
 * Shared fetch wrapper for all HTML pages.
 * Add <script src="api-client.js"></script> to any page that needs the backend.
 */

const API_BASE = 'http://localhost:5000';

/** POST raw gesture sequences to /submit_gestures (training or eval) */
export async function submitGestures({ participantId, sessionId, sequences, mode = 'train' }) {
  const res = await fetch(`${API_BASE}/submit_gestures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participant_id: participantId, session_id: sessionId, sequences, mode }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();  // { status, message, ...result }
}

/** GET list of trained participant IDs */
export async function getUsers() {
  const res = await fetch(`${API_BASE}/users`);
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();  // { users: ['P001', ...] }
}

/** POST one sequence to /authenticate */
export async function authenticate({ participantId, sessionId, sequence }) {
  const res = await fetch(`${API_BASE}/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participant_id: participantId, session_id: sessionId, sequence }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();  // { accepted, log_likelihood, threshold }
}

/** Health-check — returns true if backend is reachable */
export async function ping() {
  try {
    const res = await fetch(`${API_BASE}/ping`);
    return res.ok;
  } catch { return false; }
}
