from __future__ import annotations
import warnings
import os
warnings.filterwarnings("ignore")

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from collections import defaultdict
from typing import Dict, List

from gesture_data import (
    TouchEvent, Gesture, GestureSequence,
    VALID_GESTURE_TYPES,
)
from feature_extractor import FeatureExtractor, ZScoreNormaliser
from hmm import train_user_model

app = Flask(__name__)
CORS(app)

@app.get('/')
def index():
    return send_from_directory('.', 'index.html')

@app.get('/<path:filename>')
def static_files(filename):
    safe = os.path.normpath(filename)
    if safe.startswith('..'):
        return jsonify({'error': 'forbidden'}), 403
    return send_from_directory('.', safe)

models      : Dict[str, object] = {}                              # pid -> UserHMM
normalisers : Dict[str, object] = {}                              # pid -> ZScoreNormaliser
saved_seqs  : Dict[tuple, List[GestureSequence]] = defaultdict(list)  # (pid, session) -> seqs

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

@app.get("/ping")
def ping():
    return jsonify({"status": "ok"})


@app.get("/users")
def list_users():
    return jsonify({"users": sorted(models.keys())})


@app.post("/submit_gestures")
def submit_gestures():
    """
    Receive gesture sequences from the frontend.
      mode = "train"  →  store + (re)train the user model
      mode = "eval"   →  store only
    """
    data          = request.json
    pid           = data.get("participant_id", "unknown")
    session_id    = int(data.get("session_id", 1))
    mode          = data.get("mode", "train")
    raw_sequences = data.get("sequences", [])

    parsed = []
    for raw in raw_sequences:
        try:
            seq = _parse_sequence(raw, pid, session_id)
            parsed.append(seq)
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 400

    saved_seqs[(pid, session_id)].extend(parsed)

    if mode != "train":
        return jsonify({
            "status"  : "saved",
            "message" : f"Saved {len(parsed)} sequences for {pid} session {session_id}.",
        })

    train_seqs = saved_seqs[(pid, 1)]           # session 1 = training data
    if len(train_seqs) < 3:
        return jsonify({
            "status" : "pending",
            "message": f"Need ≥3 training sequences for {pid} (have {len(train_seqs)}).",
        })

    val_gen = saved_seqs.get((pid, 2), []) or train_seqs[:2]
    val_imp = [
        s for (other_pid, sess), seqs in saved_seqs.items()
        for s in seqs
        if other_pid != pid and sess == 1
    ][:20]

    X_tr, _ = extractor.sequences_to_arrays(train_seqs)
    norm = ZScoreNormaliser()
    norm.fit(X_tr)
    normalisers[pid] = norm

    model = train_user_model(
        participant_id    = pid,
        train_sequences   = train_seqs,
        val_genuine_seqs  = val_gen,
        val_impostor_seqs = val_imp if val_imp else train_seqs[:2],
        extractor         = extractor,
        normaliser        = norm,
        verbose           = True,
    )
    models[pid] = model

    return jsonify({
        "status"    : "trained",
        "message"   : f"Model trained for {pid}.",
        "model_id"  : pid,
        "n_train"   : len(train_seqs),
        "threshold" : round(float(model.threshold), 4),
    })


@app.post("/authenticate")
def authenticate():

    data       = request.json
    pid        = data.get("participant_id", "unknown")
    session_id = int(data.get("session_id", 2))
    raw_seq    = data.get("sequence")

    if pid not in models:
        return jsonify({"error": f"No trained model for '{pid}'. Complete Session 1 training first."}), 404

    if not raw_seq:
        return jsonify({"error": "No sequence provided."}), 400

    try:
        seq = _parse_sequence(raw_seq, pid, session_id)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    model = models[pid]
    norm  = normalisers[pid]

    mat          = norm.transform(extractor.sequence_to_matrix(seq))
    accepted, ll = model.authenticate(mat)

    return jsonify({
        "participant_id" : pid,
        "session_id"     : session_id,
        "accepted"       : bool(accepted),
        "log_likelihood" : round(float(ll), 4),
        "threshold"      : round(float(model.threshold), 4),
    })

if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("  Flask backend running")
    print("  Open:  http://localhost:1000")
    print("=" * 50 + "\n")
    app.run(host="0.0.0.0", debug=True, port=10000)