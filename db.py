"""
Supabase client wrapper for TouchAuth.

This file uses the Supabase Python client (`supabase`) tO perform CRUD
operations against the tables defined in `schema.sql`. It replaces the
previous psycopg2-based implementation.
"""

import os
import json
import pickle
from typing import List, Dict, Optional, Any
from dotenv import load_dotenv

from supabase import create_client, Client

# Load env
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL") or ("https://" + os.getenv("SUPABASE_HOST", ""))
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")


class SupabaseDB:
    def __init__(self):
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment")

        self.client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # ========== GESTURE SEQUENCES ==========

    def save_sequence(self, participant_id: str, session_id: int, mode: str, sequence_json: Dict[str, Any]) -> str:
        payload = {
            "participant_id": participant_id,
            "session_id": session_id,
            "mode": mode,
            "sequence_json": sequence_json,
        }
        res = self.client.table("gesture_sequences").insert(payload).select("seq_id").execute()
        if res.error:
            raise Exception(f"Failed to save sequence: {res.error.message}")
        return str(res.data[0]["seq_id"]) if res.data else ""

    def get_sequences(self, participant_id: str, session_id: Optional[int] = None, mode: Optional[str] = None) -> List[Dict[str, Any]]:
        q = self.client.table("gesture_sequences").select("seq_id, session_id, mode, sequence_json").eq("participant_id", participant_id)
        if session_id is not None:
            q = q.eq("session_id", session_id)
        if mode is not None:
            q = q.eq("mode", mode)
        q = q.order("created_at", {"ascending": True})
        res = q.execute()
        if res.error:
            raise Exception(f"Failed to load sequences: {res.error.message}")
        return res.data or []

    def get_impostor_sequences(self, exclude_participant_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        res = (
            self.client.table("gesture_sequences")
            .select("seq_id, participant_id, sequence_json")
            .neq("participant_id", exclude_participant_id)
            .eq("session_id", 1)
            .eq("mode", "train")
            .order("created_at", {"ascending": False})
            .limit(limit)
            .execute()
        )
        if res.error:
            raise Exception(f"Failed to load impostor sequences: {res.error.message}")
        return res.data or []

    # ========== MODELS ==========

    def save_model(self, model_id: str, participant_id: str, n_states: int, threshold: float, hmm_parameters: bytes, feature_mean: bytes, feature_std: bytes, n_train_sequences: int) -> None:
        payload = {
            "model_id": model_id,
            "participant_id": participant_id,
            "n_states": n_states,
            "threshold": threshold,
            "hmm_parameters": psycopg_bytes(hmm_parameters),
            "feature_mean": psycopg_bytes(feature_mean),
            "feature_std": psycopg_bytes(feature_std),
            "n_train_sequences": n_train_sequences,
            "is_fitted": True,
        }
        # Use upsert to replace existing model for participant
        res = self.client.table("models").upsert(payload, on_conflict="participant_id").execute()
        if res.error:
            raise Exception(f"Failed to save model: {res.error.message}")

    def load_model(self, participant_id: str) -> Optional[Dict[str, Any]]:
        res = (
            self.client.table("models")
            .select("model_id, n_states, threshold, hmm_parameters, feature_mean, feature_std")
            .eq("participant_id", participant_id)
            .eq("is_fitted", True)
            .limit(1)
            .execute()
        )
        if res.error:
            raise Exception(f"Failed to load model: {res.error.message}")
        if not res.data:
            return None
        row = res.data[0]
        return {
            "model_id": row["model_id"],
            "n_states": row["n_states"],
            "threshold": float(row["threshold"]),
            "hmm": pickle.loads(db_bytes(row["hmm_parameters"])),
            "feature_mean": pickle.loads(db_bytes(row["feature_mean"])),
            "feature_std": pickle.loads(db_bytes(row["feature_std"])),
        }

    def model_exists(self, participant_id: str) -> bool:
        res = self.client.table("models").select("participant_id").eq("participant_id", participant_id).eq("is_fitted", True).limit(1).execute()
        if res.error:
            raise Exception(f"Failed to check model existence: {res.error.message}")
        return bool(res.data)

    # ========== AUTHENTICATIONS ==========

    def log_authentication(self, model_id: str, participant_id: str, session_id: int, log_likelihood: float, threshold: float, accepted: bool) -> str:
        payload = {
            "model_id": model_id,
            "participant_id": participant_id,
            "session_id": session_id,
            "log_likelihood": log_likelihood,
            "threshold": threshold,
            "accepted": accepted,
        }
        res = self.client.table("authentications").insert(payload).select("auth_id").execute()
        if res.error:
            raise Exception(f"Failed to log authentication: {res.error.message}")
        return str(res.data[0]["auth_id"]) if res.data else ""

    def get_auth_stats(self, participant_id: str) -> Dict[str, Any]:
        # Fetch counts and compute stats client-side
        res = self.client.table("authentications").select("accepted").eq("participant_id", participant_id).execute()
        if res.error:
            raise Exception(f"Failed to get auth stats: {res.error.message}")
        rows = res.data or []
        total = len(rows)
        accepted = sum(1 for r in rows if r.get("accepted"))
        rejected = total - accepted
        return {"total_attempts": total, "accepted": accepted, "rejected": rejected, "acceptance_rate": (accepted / total * 100) if total else 0}

    # ========== PARTICIPANTS ==========

    def create_participant(self, participant_id: str, name: str = "", email: str = "") -> None:
        payload = {"participant_id": participant_id, "name": name, "email": email}
        res = self.client.table("participants").insert(payload).execute()
        # ignore unique constraint errors
        if res.error and "duplicate key" not in str(res.error.message).lower():
            raise Exception(f"Failed to create participant: {res.error.message}")


# Helper functions to serialize/deserialize bytea-like content for Postgres via Supabase
def psycopg_bytes(b: bytes) -> str:
    """Encode bytes as base64 string for JSON transport (Postgres bytea expects binary, but Supabase PostgREST accepts base64)."""
    import base64

    return base64.b64encode(b).decode("ascii")


def db_bytes(val: Any) -> bytes:
    """Decode stored base64 value back to bytes when returned by Supabase."""
    import base64

    if val is None:
        return b""
    if isinstance(val, (bytes, bytearray)):
        return bytes(val)
    if isinstance(val, str):
        try:
            return base64.b64decode(val)
        except Exception:
            # If it's not base64, try utf-8
            return val.encode("utf-8")
    # Fallback: JSON-serialized bytes
    return json.dumps(val).encode("utf-8")


# Global client
db: Optional[SupabaseDB] = None


def init_db() -> SupabaseDB:
    global db
    if db is None:
        db = SupabaseDB()
    return db


def get_db() -> SupabaseDB:
    return init_db()
