/**
 * src/api.ts
 * Import this in training.ts and eval.ts:
 *   import { submitGestures, authenticate } from './api.js';
 */
export interface TouchEventPayload {
    timestamp: number;
    x: number;
    y: number;
    pressure: number;
    finger_id: number;
}
export interface GesturePayload {
    gesture_type: string;
    orientation: string;
    events: TouchEventPayload[];
}
export interface SequencePayload {
    gestures: GesturePayload[];
}
interface SubmitOptions {
    participantId: string;
    sessionId: number;
    sequences: SequencePayload[];
    mode: 'train' | 'eval';
}
export declare function submitGestures(opts: SubmitOptions): Promise<Record<string, unknown>>;
interface AuthOptions {
    participantId: string;
    sessionId: number;
    sequence: SequencePayload;
}
export interface AuthResult {
    participant_id: string;
    session_id: number;
    accepted: boolean;
    log_likelihood: number;
    threshold: number;
}
export declare function authenticate(opts: AuthOptions): Promise<AuthResult>;
export declare function getUsers(): Promise<string[]>;
export declare function ping(): Promise<boolean>;
export {};
//# sourceMappingURL=api.d.ts.map