from __future__ import annotations
import warnings
import os
import pickle
import json
warnings.filterwarnings("ignore")

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from typing import Dict, List
import uuid

from gesture_data import (
    TouchEvent, Gesture, GestureSequence,
    VALID_GESTURE_TYPES,
)
from feature_extractor import FeatureExtractor, ZScoreNormaliser
from hmm import train_user_model
from db import init_db, get_db

app = Flask(__name__)
CORS(app)

# Initialize database on startup
db = None

@app.before_request
def before_request():
    """Initialize database connection if needed."""
    global db
    if db is None:
        db = init_db()

@app.teardown_appcontext
def shutdown_session(exception=None):
    """Close database pool on shutdown."""
    pass

@app.get('/')
def index():
    return send_from_directory('.', 'index.html')

@app.get('/<path:filename>')
def static_files(filename):
    safe = os.path.normpath(filename)
    if safe.startswith('..'):
        return jsonify({'error': 'forbidden'}), 403
    return send_from_directory('.', safe)

extractor = FeatureExtractor()

def _parse_sequence(raw: dict, participant_id: str, session_id: int) -> GestureSequence:
    """
    Convert a JSON payload from the frontend into a GestureSequence.

    Expected shape (exactly 3 gestures):
    {
      "gestures": [
        {
          "gesture_type": "tap",           // "tap"|"swipe"|"scroll"|"zoom"|"pinch"
          "orientation":  "horizontal",    // "horizontal"|"vertical"
          "events": [
            { "timestamp": 0.0, "x": 120.5, "y": 340.2,
              "pressure": 0.6, "finger_id": 0 },
            ...
          ]
        },
        ...
      ]
    }
    """
    gestures = []
    for g in raw["gestures"]:
        g_type = g.get("gesture_type", "tap")
        orient = g.get("orientation", "horizontal")

        if g_type not in VALID_GESTURE_TYPES:
            g_type = "tap"

        events = [
            TouchEvent(
                timestamp = float(e["timestamp"]),
                x         = float(e["x"]),
                y         = float(e["y"]),
                pressure  = float(e.get("pressure", 0.5)),
                finger_id = int(e.get("finger_id", 0)),
            )
            for e in g.get("events", [])
        ]

        gestures.append(Gesture(
            gesture_type   = g_type,
            orientation    = orient,
            events         = events,
            session_id     = session_id,
            participant_id = participant_id,
        ))

    if len(gestures) != 3:
        raise ValueError(f"Expected 3 gestures per sequence, got {len(gestures)}")

    return GestureSequence(
        gestures       = gestures,
        participant_id = participant_id,
        session_id     = session_id,
    )

def _gesture_sequence_to_dict(seq: GestureSequence) -> dict:
    """Convert GestureSequence object to JSON-serializable dict for database storage."""
    return {
        "gestures": [
            {
                "gesture_type": g.gesture_type,
                "orientation": g.orientation,
                "events": [
                    {
                        "timestamp": e.timestamp,
                        "x": e.x,
                        "y": e.y,
                        "pressure": e.pressure,
                        "finger_id": e.finger_id,
                    }
                    for e in g.events
                ],
            }
            for g in seq.gestures
        ]
    }


@app.get("/ping")
def ping():
    return jsonify({"status": "ok"})


@app.get("/users")
def list_users():
    """List all participants with trained models."""
    database = get_db()
    try:
        conn = database.get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT participant_id FROM models WHERE is_fitted = TRUE;")
            users = [row[0] for row in cur.fetchall()]
        database.return_connection(conn)
        return jsonify({"users": sorted(users)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.post("/submit_gestures")
def submit_gestures():
    """
    Receive gesture sequences from the frontend.
      mode = "train"  →  store + (re)train the user model
      mode = "eval"   →  store only
    """
    database = get_db()
    data          = request.json
    pid           = data.get("participant_id", "unknown")
    session_id    = int(data.get("session_id", 1))
    mode          = data.get("mode", "train")
    raw_sequences = data.get("sequences", [])

    # Create participant record if needed
    try:
        database.create_participant(pid, name=data.get("name", ""), email=data.get("email", ""))
    except Exception as e:
        print(f"Warning: Failed to create participant: {e}")

    # Parse and save sequences to database
    parsed = []
    for raw in raw_sequences:
        try:
            seq = _parse_sequence(raw, pid, session_id)
            parsed.append(seq)
            seq_dict = _gesture_sequence_to_dict(seq)
            database.save_sequence(pid, session_id, mode, seq_dict)
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 400

    if mode != "train":
        return jsonify({
            "status"  : "saved",
            "message" : f"Saved {len(parsed)} sequences for {pid} session {session_id}.",
        })

    # Load training sequences from database
    try:
        train_seqs_data = database.get_sequences(pid, session_id=1, mode='train')
        train_seqs = []
        for seq_data in train_seqs_data:
            seq_dict = seq_data['sequence_json']
            seq = _parse_sequence(seq_dict, pid, 1)
            train_seqs.append(seq)
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to load training sequences: {e}"}), 500

    if len(train_seqs) < 3:
        return jsonify({
            "status" : "pending",
            "message": f"Need ≥3 training sequences for {pid} (have {len(train_seqs)}).",
        })

    # Load validation genuine sequences (session 2 if available, else use training)
    try:
        val_gen_data = database.get_sequences(pid, session_id=2, mode='train')
        if val_gen_data:
            val_gen = []
            for seq_data in val_gen_data:
                seq = _parse_sequence(seq_data['sequence_json'], pid, 2)
                val_gen.append(seq)
        else:
            val_gen = train_seqs[:2]
    except Exception as e:
        val_gen = train_seqs[:2]

    # Load impostor sequences from other participants (session 1 only, capped at 20)
    try:
        val_imp_data = database.get_impostor_sequences(pid, limit=20)
        val_imp = []
        for seq_data in val_imp_data:
            seq = _parse_sequence(seq_data['sequence_json'], seq_data['participant_id'], 1)
            val_imp.append(seq)
    except Exception as e:
        print(f"Warning: Failed to load impostor sequences: {e}")
        val_imp = []

    # Train the model
    try:
        X_tr, _ = extractor.sequences_to_arrays(train_seqs)
        norm = ZScoreNormaliser()
        norm.fit(X_tr)

        model = train_user_model(
            participant_id    = pid,
            train_sequences   = train_seqs,
            val_genuine_seqs  = val_gen,
            val_impostor_seqs = val_imp if val_imp else train_seqs[:2],
            extractor         = extractor,
            normaliser        = norm,
            verbose           = True,
        )

        # Serialize model components for database storage
        model_id = f"{pid}_{uuid.uuid4().hex[:8]}"
        hmm_bytes = pickle.dumps(model.hmm)
        mean_bytes = pickle.dumps(norm.mean_)
        std_bytes = pickle.dumps(norm.std_)

        # Save model to database
        database.save_model(
            model_id=model_id,
            participant_id=pid,
            n_states=model.hmm.n_states,
            threshold=float(model.threshold),
            hmm_parameters=hmm_bytes,
            feature_mean=mean_bytes,
            feature_std=std_bytes,
            n_train_sequences=len(train_seqs),
        )

        return jsonify({
            "status"    : "trained",
            "message"   : f"Model trained for {pid}.",
            "model_id"  : model_id,
            "n_train"   : len(train_seqs),
            "threshold" : round(float(model.threshold), 4),
        })

    except Exception as e:
        print(f"Error during training: {e}")
        return jsonify({"status": "error", "message": f"Training failed: {e}"}), 500



@app.post("/authenticate")
def authenticate():
    """
    Authenticate a user gesture sequence against their trained model.
    Loads model from database and logs authentication attempt.
    """
    database = get_db()
    data       = request.json
    pid        = data.get("participant_id", "unknown")
    session_id = int(data.get("session_id", 2))
    raw_seq    = data.get("sequence")

    if not raw_seq:
        return jsonify({"error": "No sequence provided."}), 400

    # Load model from database
    try:
        model_data = database.load_model(pid)
    except Exception as e:
        return jsonify({"error": f"Failed to load model: {e}"}), 500

    if not model_data:
        return jsonify({"error": f"No trained model for '{pid}'. Complete Session 1 training first."}), 404

    # Parse incoming sequence
    try:
        seq = _parse_sequence(raw_seq, pid, session_id)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    # Extract model components from database
    model_id = model_data['model_id']
    hmm = model_data['hmm']
    feature_mean = model_data['feature_mean']
    feature_std = model_data['feature_std']
    threshold = model_data['threshold']

    # Create normalizer and restore state
    norm = ZScoreNormaliser()
    norm.mean_ = feature_mean
    norm.std_ = feature_std

    # Score the sequence
    try:
        mat = norm.transform(extractor.sequence_to_matrix(seq))
        ll = hmm.score(mat)
        accepted = ll >= threshold
    except Exception as e:
        return jsonify({"error": f"Failed to authenticate: {e}"}), 500

    # Log authentication attempt to database
    try:
        auth_id = database.log_authentication(
            model_id=model_id,
            participant_id=pid,
            session_id=session_id,
            log_likelihood=float(ll),
            threshold=threshold,
            accepted=bool(accepted),
        )
    except Exception as e:
        print(f"Warning: Failed to log authentication: {e}")

    return jsonify({
        "participant_id" : pid,
        "session_id"     : session_id,
        "accepted"       : bool(accepted),
        "log_likelihood" : round(float(ll), 4),
        "threshold"      : round(float(threshold), 4),
    })

if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", 10000))
    print("\n" + "=" * 50)
    print(f"  Flask backend running on port {port}")
    print("  Database: Supabase PostgreSQL")
    print("=" * 50 + "\n")
    app.run(host="0.0.0.0", debug=True, port=port)