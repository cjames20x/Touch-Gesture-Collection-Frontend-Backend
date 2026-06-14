-- ============================================================================
-- TouchAuth PostgreSQL Schema for Supabase
-- Layout
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- TABLE: participants
-- Store basic participant metadata
-- ============================================================================
CREATE TABLE IF NOT EXISTS participants (
  participant_id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_participants_created_at ON participants(created_at);

-- ============================================================================
-- TABLE: gesture_sequences
-- Raw gesture data: 3 gestures per sequence, with all touch events
-- ============================================================================
CREATE TABLE IF NOT EXISTS gesture_sequences (
  seq_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id TEXT NOT NULL,
  session_id INT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('train', 'eval')),
  
  -- Complete gesture sequence as JSON
  -- Format: {
  --   "gestures": [
  --     {
  --       "gesture_type": "tap|swipe|scroll|zoom|pinch",
  --       "orientation": "horizontal|vertical",
  --       "events": [
  --         { "timestamp": float, "x": float, "y": float, 
  --           "pressure": float, "finger_id": int },
  --         ...
  --       ]
  --     },
  --     ...
  --   ]
  -- }
  sequence_json JSONB NOT NULL,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_participant 
    FOREIGN KEY (participant_id) 
    REFERENCES participants(participant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_seq_participant_session 
  ON gesture_sequences(participant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_seq_participant_mode 
  ON gesture_sequences(participant_id, mode);
CREATE INDEX IF NOT EXISTS idx_seq_created_at 
  ON gesture_sequences(created_at);

-- ============================================================================
-- TABLE: models
-- Trained HMM models per participant
-- ============================================================================
CREATE TABLE IF NOT EXISTS models (
  model_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL UNIQUE,
  
  -- HMM configuration
  n_states INT NOT NULL CHECK (n_states > 0),
  
  -- Authentication threshold (EER)
  threshold FLOAT NOT NULL,
  
  -- Training metadata
  n_train_sequences INT NOT NULL DEFAULT 0,
  cv_scores JSONB,  -- Optional: cross-validation scores like {"2": -500.1, "3": -450.2, ...}
  
  -- Serialized model objects (pickle binary)
  -- hmm_parameters: LeftRightHMM state
  --   - transition matrix (n_states x n_states)
  --   - emission Gaussians (means/covariances for each state)
  --   - start probabilities
  hmm_parameters BYTEA NOT NULL,
  
  -- Feature normalization (Z-score)
  -- feature_mean: numpy array of shape (15,) - one mean per feature
  -- feature_std: numpy array of shape (15,) - one std per feature
  -- Features: duration, start_x, start_y, end_x, end_y, mean_pressure, 
  --           pressure_std, displacement, mean_speed, speed_std, slope_e2e,
  --           mean_dev_e2e, start_inter_finger, end_inter_finger, scale_factor
  feature_mean BYTEA NOT NULL,
  feature_std BYTEA NOT NULL,
  
  is_fitted BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_model_participant 
    FOREIGN KEY (participant_id) 
    REFERENCES participants(participant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_model_participant ON models(participant_id);
CREATE INDEX IF NOT EXISTS idx_model_updated_at ON models(updated_at);

-- ============================================================================
-- TABLE: authentications
-- Audit log of all authentication attempts
-- ============================================================================
CREATE TABLE IF NOT EXISTS authentications (
  auth_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  session_id INT,
  
  -- HMM log-likelihood score
  log_likelihood FLOAT NOT NULL,
  
  -- Threshold used at time of auth
  threshold FLOAT NOT NULL,
  
  -- Authentication result
  accepted BOOLEAN NOT NULL,
  
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_auth_model 
    FOREIGN KEY (model_id) 
    REFERENCES models(model_id)
    ON DELETE CASCADE,
  
  CONSTRAINT fk_auth_participant 
    FOREIGN KEY (participant_id) 
    REFERENCES participants(participant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_participant ON authentications(participant_id);
CREATE INDEX IF NOT EXISTS idx_auth_model ON authentications(model_id);
CREATE INDEX IF NOT EXISTS idx_auth_timestamp ON authentications(timestamp);
CREATE INDEX IF NOT EXISTS idx_auth_accepted ON authentications(accepted);

-- ============================================================================
-- TABLE: training_sessions
-- Optional: track training runs and their outcomes
-- ============================================================================
CREATE TABLE IF NOT EXISTS training_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id TEXT NOT NULL,
  model_id TEXT,
  
  -- Training config
  train_session_id INT,
  val_session_id INT,
  candidate_states INT[] DEFAULT ARRAY[2, 3, 4, 5],
  n_iter INT DEFAULT 200,
  
  -- Results
  status TEXT CHECK (status IN ('pending', 'training', 'success', 'failed')),
  message TEXT,
  n_sequences_used INT,
  final_threshold FLOAT,
  final_n_states INT,
  training_time_seconds FLOAT,
  
  started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT fk_train_participant 
    FOREIGN KEY (participant_id) 
    REFERENCES participants(participant_id)
    ON DELETE CASCADE,
  
  CONSTRAINT fk_train_model 
    FOREIGN KEY (model_id) 
    REFERENCES models(model_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_train_participant ON training_sessions(participant_id);
CREATE INDEX IF NOT EXISTS idx_train_status ON training_sessions(status);
CREATE INDEX IF NOT EXISTS idx_train_started_at ON training_sessions(started_at);

-- ============================================================================
-- TABLE: evaluation_results
-- Optional: store evaluation metrics (FAR, FRR, EER, d-prime, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS evaluation_results (
  eval_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  
  -- Evaluation dataset info
  genuine_session INT,
  impostor_session INT,
  n_genuine_sequences INT,
  n_impostor_sequences INT,
  
  -- Metrics
  far FLOAT,           -- False Acceptance Rate
  frr FLOAT,           -- False Rejection Rate
  eer FLOAT,           -- Equal Error Rate
  dprime FLOAT,        -- d-prime (separability measure)
  accuracy FLOAT,      -- Overall accuracy
  
  -- Detailed score distributions (optional)
  genuine_scores FLOAT[] DEFAULT ARRAY[]::FLOAT[],
  impostor_scores FLOAT[] DEFAULT ARRAY[]::FLOAT[],
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_eval_model 
    FOREIGN KEY (model_id) 
    REFERENCES models(model_id)
    ON DELETE CASCADE,
  
  CONSTRAINT fk_eval_participant 
    FOREIGN KEY (participant_id) 
    REFERENCES participants(participant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_model ON evaluation_results(model_id);
CREATE INDEX IF NOT EXISTS idx_eval_participant ON evaluation_results(participant_id);
CREATE INDEX IF NOT EXISTS idx_eval_created_at ON evaluation_results(created_at);

-- ============================================================================
-- VIEWS: Useful queries
-- ============================================================================

-- View: Latest model for each participant
CREATE OR REPLACE VIEW v_latest_models AS
SELECT DISTINCT ON (participant_id)
  model_id,
  participant_id,
  n_states,
  threshold,
  n_train_sequences,
  is_fitted,
  updated_at
FROM models
ORDER BY participant_id, updated_at DESC;

-- View: Authentication stats per participant
CREATE OR REPLACE VIEW v_auth_stats AS
SELECT
  participant_id,
  COUNT(*) as total_attempts,
  SUM(CASE WHEN accepted THEN 1 ELSE 0 END) as accepted_count,
  SUM(CASE WHEN NOT accepted THEN 1 ELSE 0 END) as rejected_count,
  ROUND(
    100.0 * SUM(CASE WHEN accepted THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
    2
  ) as acceptance_rate,
  MIN(timestamp) as first_attempt,
  MAX(timestamp) as last_attempt
FROM authentications
GROUP BY participant_id;

-- View: Training history per participant
CREATE OR REPLACE VIEW v_training_history AS
SELECT
  participant_id,
  COUNT(*) as total_trainings,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_trainings,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_trainings,
  MAX(CASE WHEN status = 'success' THEN completed_at END) as last_successful_training,
  MAX(final_threshold) as latest_threshold
FROM training_sessions
GROUP BY participant_id;

-- ============================================================================
-- SAMPLE QUERIES
-- ============================================================================

-- Get all training sequences for a participant
-- SELECT sequence_json FROM gesture_sequences 
-- WHERE participant_id = 'user_001' AND mode = 'train'
-- ORDER BY created_at;

-- Get model for participant
-- SELECT model_id, n_states, threshold FROM models 
-- WHERE participant_id = 'user_001';

-- Get recent auth attempts for a participant
-- SELECT participant_id, accepted, log_likelihood, threshold, timestamp 
-- FROM authentications 
-- WHERE participant_id = 'user_001'
-- ORDER BY timestamp DESC LIMIT 10;

-- Check auth success rate
-- SELECT * FROM v_auth_stats WHERE participant_id = 'user_001';

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
