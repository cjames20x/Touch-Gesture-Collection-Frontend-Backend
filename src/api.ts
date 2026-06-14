/**
 * src/api.ts
 * Import this in training.ts and eval.ts:
 *   import { submitGestures, authenticate } from './api.js';
 */

const API_BASE = 'http://0.0.0.0:10000';

export interface TouchEventPayload {
  timestamp : number;
  x         : number;
  y         : number;
  pressure  : number;
  finger_id : number;
}

export interface GesturePayload {
  gesture_type : string;   // 'tap' | 'swipe' | 'scroll' | 'zoom' | 'pinch'
  orientation  : string;   // 'horizontal' | 'vertical'
  events       : TouchEventPayload[];
}

export interface SequencePayload {
  gestures: GesturePayload[];  // exactly 3
}

// ── /submit_gestures ────────────────────────────────────────────────────────

interface SubmitOptions {
  participantId : string;
  sessionId     : number;
  sequences     : SequencePayload[];
  mode          : 'train' | 'eval';
}

export async function submitGestures(opts: SubmitOptions): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/submit_gestures`, {
    method  : 'POST',
    headers : { 'Content-Type': 'application/json' },
    body    : JSON.stringify({
      participant_id : opts.participantId,
      session_id     : opts.sessionId,
      sequences      : opts.sequences,
      mode           : opts.mode,
    }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

// ── /authenticate ───────────────────────────────────────────────────────────

interface AuthOptions {
  participantId : string;
  sessionId     : number;
  sequence      : SequencePayload;
}

export interface AuthResult {
  participant_id  : string;
  session_id      : number;
  accepted        : boolean;
  log_likelihood  : number;
  threshold       : number;
}

export async function authenticate(opts: AuthOptions): Promise<AuthResult> {
  const res = await fetch(`${API_BASE}/authenticate`, {
    method  : 'POST',
    headers : { 'Content-Type': 'application/json' },
    body    : JSON.stringify({
      participant_id : opts.participantId,
      session_id     : opts.sessionId,
      sequence       : opts.sequence,
    }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json() as Promise<AuthResult>;
}

// ── /users ──────────────────────────────────────────────────────────────────

export async function getUsers(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/users`);
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  const data = await res.json() as { users: string[] };
  return data.users;
}

// ── /ping ────────────────────────────────────────────────────────────────────

export async function ping(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/ping`);
    return res.ok;
  } catch { return false; }
}
