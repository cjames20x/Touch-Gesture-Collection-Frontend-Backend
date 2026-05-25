from __future__ import annotations

import warnings
import numpy as np
from typing import List, Dict, Tuple, Optional

from sklearn.model_selection import KFold

try:
    from hmmlearn.hmm import GaussianHMM
except ImportError as e:
    raise ImportError(
        "hmmlearn is required: pip install hmmlearn"
    ) from e


warnings.filterwarnings("ignore", category=Warning, module="hmmlearn")

class LeftRightHMM:

    def __init__(
        self,
        n_states: int = 3,
        n_iter: int = 200,
        tol: float = 1e-4,
    ):
        self.n_states = n_states
        self.n_iter   = n_iter
        self.tol      = tol
        self._model: Optional[GaussianHMM] = None
        self.is_fitted = False

    @staticmethod
    def _make_startprob(n: int) -> np.ndarray:
        
        p = np.zeros(n)
        p[0] = 1.0
        return p

    @staticmethod
    def _make_transmat(n: int) -> np.ndarray:

        T = np.zeros((n, n))
        for i in range(n - 1):
            T[i, i]     = 0.7   # stay
            T[i, i + 1] = 0.3   # advance
        T[n - 1, n - 1] = 1.0   # absorbing final state
        return T

    def fit(
        self,
        X: np.ndarray,
        lengths: List[int],
    ) -> "LeftRightHMM":

        n = self.n_states
        model = GaussianHMM(
            n_components=n,
            covariance_type="diag",
            n_iter=self.n_iter,
            tol=self.tol,
            init_params="mc",
            params="mc",
            min_covar=1e-3,
        )

        model.startprob_ = self._make_startprob(n)
        model.transmat_  = self._make_transmat(n)

        model.fit(X, lengths)
        self._model   = model
        self.is_fitted = True
        return self

    def log_likelihood(self, X: np.ndarray) -> float:

        if not self.is_fitted:
            raise RuntimeError("Call fit() before log_likelihood().")
        try:
            ll = float(self._model.score(X))
            return ll if np.isfinite(ll) else -1e6
        except Exception:
            return -1e6

    def score_sequences(self, X: np.ndarray, lengths: List[int]) -> np.ndarray:

        scores = []
        start = 0
        for L in lengths:
            seq = X[start : start + L]
            scores.append(self.log_likelihood(seq))
            start += L
        return np.array(scores)

class UserHMM:

    def __init__(self, participant_id: str, n_states: int = 3):
        self.participant_id = participant_id
        self.hmm            = LeftRightHMM(n_states=n_states)
        self.threshold: Optional[float] = None

    def fit(self, X: np.ndarray, lengths: List[int]) -> "UserHMM":
        self.hmm.fit(X, lengths)
        return self

    def score(self, X_seq: np.ndarray) -> float:
        return self.hmm.log_likelihood(X_seq)

    def set_threshold(self, theta: float):
        self.threshold = theta

    def authenticate(self, X_seq: np.ndarray) -> Tuple[bool, float]:
        if self.threshold is None:
            raise RuntimeError("set_threshold() must be called before authenticate().")
        ll = self.score(X_seq)
        return (ll >= self.threshold), ll

def select_n_states_cv(
    X: np.ndarray,
    lengths: List[int],
    candidate_states: List[int] = [2, 3, 4, 5],
    n_splits: int = 5,
    n_iter: int = 100,
) -> Tuple[int, Dict[int, float]]:

    n_seqs   = len(lengths)
    seq_idxs = np.arange(n_seqs)

    starts = np.concatenate([[0], np.cumsum(lengths)[:-1]])

    cv_scores: Dict[int, List[float]] = {n: [] for n in candidate_states}
    kf = KFold(n_splits=n_splits, shuffle=True, random_state=42)

    for fold_i, (train_idx, val_idx) in enumerate(kf.split(seq_idxs)):
        X_train_parts = [X[starts[i] : starts[i] + lengths[i]] for i in train_idx]
        X_val_parts   = [X[starts[i] : starts[i] + lengths[i]] for i in val_idx]

        if not X_train_parts or not X_val_parts:
            continue

        X_train  = np.vstack(X_train_parts)
        L_train  = [lengths[i] for i in train_idx]
        val_seqs = X_val_parts          # list of (3, n_feat) arrays
        val_lens = [lengths[i] for i in val_idx]

        for n in candidate_states:
            if n > len(train_idx):
                
                cv_scores[n].append(-np.inf)
                continue
            try:
                hmm = LeftRightHMM(n_states=n, n_iter=n_iter)
                hmm.fit(X_train, L_train)
                fold_lls = [hmm.log_likelihood(s) for s in val_seqs]

                valid = [v for v in fold_lls if np.isfinite(v)]
                mean_ll = float(np.mean(valid)) if valid else -np.inf
                cv_scores[n].append(mean_ll)
            except Exception:
                cv_scores[n].append(-np.inf)

    mean_scores: Dict[int, float] = {}
    for n, fold_vals in cv_scores.items():
        finite = [v for v in fold_vals if np.isfinite(v)]
        mean_scores[n] = float(np.mean(finite)) if finite else -np.inf

    best_n = max(mean_scores, key=lambda k: mean_scores[k])
    return best_n, mean_scores



def compute_eer_threshold(
    genuine_scores: np.ndarray,
    impostor_scores: np.ndarray,
    n_thresholds: int = 1000,
) -> Tuple[float, float, float, float]:
    
    all_scores = np.concatenate([genuine_scores, impostor_scores])
    lo, hi     = all_scores.min(), all_scores.max()

    thresholds = np.linspace(lo - 1e-6, hi + 1e-6, n_thresholds)

    far_curve = np.array([
        np.mean(impostor_scores >= t) for t in thresholds
    ])
    frr_curve = np.array([
        np.mean(genuine_scores < t)  for t in thresholds
    ])

    # Index where |FAR - FRR| is smallest
    diff     = np.abs(far_curve - frr_curve)
    eer_idx  = int(np.argmin(diff))
    theta_eer = float(thresholds[eer_idx])
    eer       = float((far_curve[eer_idx] + frr_curve[eer_idx]) / 2)

    return theta_eer, eer, far_curve, frr_curve

def train_user_model(
    participant_id   : str,
    train_sequences  : list,            # List[GestureSequence]
    val_genuine_seqs : list,            # List[GestureSequence] from same user
    val_impostor_seqs: list,            # List[GestureSequence] from other users
    extractor,                          # FeatureExtractor instance
    normaliser,                         # ZScoreNormaliser (already fitted)
    candidate_states : List[int] = [2, 3, 4, 5],
    n_iter           : int = 200,
    verbose          : bool = False,
) -> UserHMM:
    
    X_train, L_train = extractor.sequences_to_arrays(train_sequences)
    X_train          = normaliser.transform(X_train)

    best_n, cv_scores = select_n_states_cv(
        X_train, L_train, candidate_states=candidate_states
    )
    if verbose:
        print(f"  [{participant_id}] CV scores: {cv_scores}  -> best n_states={best_n}")

    user_model = UserHMM(participant_id=participant_id, n_states=best_n)
    user_model.fit(X_train, L_train)

    def _score_list(seqs: list) -> np.ndarray:
        scores = []
        for s in seqs:
            mat = extractor.sequence_to_matrix(s)
            mat = normaliser.transform(mat)
            scores.append(user_model.score(mat))
        return np.array(scores)

    gen_scores  = _score_list(val_genuine_seqs)
    imp_scores  = _score_list(val_impostor_seqs)

    gen_finite  = gen_scores[np.isfinite(gen_scores)]
    imp_finite  = imp_scores[np.isfinite(imp_scores)]

    if len(gen_finite) == 0 or len(imp_finite) == 0:
        X_train_norm, L_train = extractor.sequences_to_arrays(train_sequences)
        X_train_norm = normaliser.transform(X_train_norm)
        train_scores = user_model.hmm.score_sequences(X_train_norm, L_train)
        finite_train = train_scores[np.isfinite(train_scores)]
        theta = float(np.percentile(finite_train, 10)) if len(finite_train) > 0 else -1e3
        if verbose:
            print(f"  [{participant_id}] WARNING: degenerate val scores, using training-based theta={theta:.3f}")
    else:
        theta, eer, _, _ = compute_eer_threshold(gen_finite, imp_finite)
        if verbose:
            print(f"  [{participant_id}] EER={eer:.4f}  threshold={theta:.4f}")

    user_model.set_threshold(theta)
    return user_model

if __name__ == "__main__":
    from gesture_data     import generate_synthetic_dataset
    from feature_extractor import FeatureExtractor, ZScoreNormaliser

    print("Generating synthetic dataset ...")
    all_seqs = generate_synthetic_dataset(n_participants=10, n_sessions=3, n_repetitions=10)

    from collections import defaultdict
    by_pid: Dict[str, list] = defaultdict(list)
    for s in all_seqs:
        by_pid[s.participant_id].append(s)

    extractor = FeatureExtractor()

    pids     = list(by_pid.keys())
    enrolled = pids[0]

    train_seqs = [s for s in by_pid[enrolled] if s.session_id == 1]
    val_gen    = [s for s in by_pid[enrolled] if s.session_id == 2]
    val_imp    = [s for p in pids[1:5] for s in by_pid[p] if s.session_id == 2]

    X_all, L_all = extractor.sequences_to_arrays(train_seqs)
    norm = ZScoreNormaliser()
    norm.fit(X_all)

    print(f"Training user model for {enrolled} ...")
    model = train_user_model(
        participant_id    = enrolled,
        train_sequences   = train_seqs,
        val_genuine_seqs  = val_gen,
        val_impostor_seqs = val_imp,
        extractor         = extractor,
        normaliser        = norm,
        verbose           = True,
    )

    test_seqs = [s for s in by_pid[enrolled] if s.session_id == 3]
    results = []
    for seq in test_seqs[:5]:
        mat      = norm.transform(extractor.sequence_to_matrix(seq))
        accepted, ll = model.authenticate(mat)
        results.append((accepted, ll))
        print(f"  Genuine seq: accepted={accepted}  ll={ll:.3f}  threshold={model.threshold:.3f}")

    print("\nHMM trainer OK.")