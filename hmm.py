from __future__ import annotations

import numpy as np
from typing import Dict, List, Optional, Tuple

from sklearn.model_selection import KFold


def _logsumexp(values: np.ndarray, axis: Optional[int] = None) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    if axis is None:
        finite = np.isfinite(values)
        if not np.any(finite):
            return -np.inf
        max_value = np.max(values[finite])
        if not np.isfinite(max_value):
            return -np.inf
        return max_value + np.log(np.sum(np.exp(values[finite] - max_value)))

    max_value = np.max(values, axis=axis, keepdims=True)
    max_value[~np.isfinite(max_value)] = 0.0
    shifted = np.exp(values - max_value)
    summed = np.sum(shifted, axis=axis, keepdims=True)
    result = max_value + np.log(np.maximum(summed, 1e-300))
    return np.squeeze(result, axis=axis)


def _log_gaussian_diag(x: np.ndarray, mean: np.ndarray, var: np.ndarray) -> float:
    var = np.maximum(var, 1e-6)
    diff = x - mean
    return float(-0.5 * (np.sum(np.log(2.0 * np.pi * var)) + np.sum((diff * diff) / var)))


class LeftRightHMM:
    def __init__(
        self,
        n_states: int = 3,
        n_iter: int = 200,
        tol: float = 1e-4,
        min_covar: float = 1e-3,
    ):
        self.n_states = n_states
        self.n_iter = n_iter
        self.tol = tol
        self.min_covar = min_covar
        self._startprob: Optional[np.ndarray] = None
        self._transmat: Optional[np.ndarray] = None
        self._means: Optional[np.ndarray] = None
        self._covars: Optional[np.ndarray] = None
        self.is_fitted = False

    @staticmethod
    def _make_startprob(n: int) -> np.ndarray:
        p = np.zeros(n)
        p[0] = 1.0
        return p

    @staticmethod
    def _make_transmat(n: int) -> np.ndarray:
        transition = np.zeros((n, n))
        for i in range(n - 1):
            transition[i, i] = 0.7
            transition[i, i + 1] = 0.3
        transition[n - 1, n - 1] = 1.0
        return transition

    def _initialise_emissions(self, X: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        n_features = X.shape[1]
        global_mean = np.mean(X, axis=0)
        global_var = np.var(X, axis=0)
        global_var = np.maximum(global_var, self.min_covar)

        means = np.zeros((self.n_states, n_features), dtype=float)
        covars = np.zeros((self.n_states, n_features), dtype=float)

        chunks = np.array_split(X, self.n_states)
        for idx, chunk in enumerate(chunks):
            if len(chunk) == 0:
                means[idx] = global_mean
                covars[idx] = global_var
            else:
                means[idx] = np.mean(chunk, axis=0)
                covars[idx] = np.var(chunk, axis=0)
                covars[idx] = np.maximum(covars[idx], self.min_covar)

        return means, covars

    def _log_emission_matrix(self, X: np.ndarray) -> np.ndarray:
        log_b = np.empty((len(X), self.n_states), dtype=float)
        for t, obs in enumerate(X):
            for state in range(self.n_states):
                log_b[t, state] = _log_gaussian_diag(obs, self._means[state], self._covars[state])
        return log_b

    def _forward(self, log_b: np.ndarray) -> Tuple[np.ndarray, float]:
        log_start = np.log(np.maximum(self._startprob, 1e-300))
        log_trans = np.full_like(self._transmat, -np.inf, dtype=float)
        positive = self._transmat > 0
        log_trans[positive] = np.log(self._transmat[positive])

        log_alpha = np.full_like(log_b, -np.inf, dtype=float)
        log_alpha[0] = log_start + log_b[0]
        for t in range(1, len(log_b)):
            for state in range(self.n_states):
                incoming = log_alpha[t - 1] + log_trans[:, state]
                log_alpha[t, state] = log_b[t, state] + _logsumexp(incoming)

        log_likelihood = float(_logsumexp(log_alpha[-1]))
        return log_alpha, log_likelihood

    def _backward(self, log_b: np.ndarray) -> np.ndarray:
        log_trans = np.full_like(self._transmat, -np.inf, dtype=float)
        positive = self._transmat > 0
        log_trans[positive] = np.log(self._transmat[positive])

        log_beta = np.full_like(log_b, -np.inf, dtype=float)
        log_beta[-1] = 0.0
        for t in range(len(log_b) - 2, -1, -1):
            for state in range(self.n_states):
                outgoing = log_trans[state] + log_b[t + 1] + log_beta[t + 1]
                log_beta[t, state] = _logsumexp(outgoing)
        return log_beta

    def fit(self, X: np.ndarray, lengths: List[int]) -> "LeftRightHMM":
        if X.ndim != 2:
            raise ValueError("X must be a 2D array of observations.")
        if not lengths:
            raise ValueError("lengths must not be empty.")
        if int(np.sum(lengths)) != len(X):
            raise ValueError("Sum of lengths must match the number of rows in X.")

        self._startprob = self._make_startprob(self.n_states)
        self._transmat = self._make_transmat(self.n_states)
        self._means, self._covars = self._initialise_emissions(X)

        previous_log_likelihood: Optional[float] = None
        for _ in range(self.n_iter):
            gamma_sum = np.zeros(self.n_states, dtype=float)
            obs_sum = np.zeros_like(self._means)
            obs_sq_sum = np.zeros_like(self._covars)
            total_log_likelihood = 0.0

            start = 0
            for length in lengths:
                seq = X[start : start + length]
                start += length

                log_b = self._log_emission_matrix(seq)
                log_alpha, log_likelihood = self._forward(log_b)
                log_beta = self._backward(log_b)

                total_log_likelihood += log_likelihood
                log_gamma = log_alpha + log_beta - log_likelihood
                log_gamma -= np.max(log_gamma, axis=1, keepdims=True)
                gamma = np.exp(log_gamma)
                gamma /= np.maximum(np.sum(gamma, axis=1, keepdims=True), 1e-300)

                gamma_sum += np.sum(gamma, axis=0)
                obs_sum += gamma.T @ seq
                obs_sq_sum += gamma.T @ (seq * seq)

            new_means = np.where(gamma_sum[:, None] > 0, obs_sum / np.maximum(gamma_sum[:, None], 1e-300), self._means)
            new_covars = np.where(
                gamma_sum[:, None] > 0,
                obs_sq_sum / np.maximum(gamma_sum[:, None], 1e-300) - new_means * new_means,
                self._covars,
            )
            new_covars = np.maximum(new_covars, self.min_covar)

            if previous_log_likelihood is not None:
                improvement = total_log_likelihood - previous_log_likelihood
                if abs(improvement) < self.tol:
                    self._means = new_means
                    self._covars = new_covars
                    break

            self._means = new_means
            self._covars = new_covars
            previous_log_likelihood = total_log_likelihood

        self.is_fitted = True
        return self

    def log_likelihood(self, X: np.ndarray) -> float:
        if not self.is_fitted:
            raise RuntimeError("Call fit() before log_likelihood().")
        if X.ndim != 2:
            raise ValueError("X must be a 2D array of observations.")
        try:
            log_b = self._log_emission_matrix(X)
            _, log_likelihood = self._forward(log_b)
            return log_likelihood if np.isfinite(log_likelihood) else -1e6
        except Exception:
            return -1e6

    def score_sequences(self, X: np.ndarray, lengths: List[int]) -> np.ndarray:
        scores = []
        start = 0
        for length in lengths:
            seq = X[start : start + length]
            scores.append(self.log_likelihood(seq))
            start += length
        return np.array(scores)


class UserHMM:
    def __init__(self, participant_id: str, n_states: int = 3):
        self.participant_id = participant_id
        self.hmm = LeftRightHMM(n_states=n_states)
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
    n_seqs = len(lengths)
    seq_idxs = np.arange(n_seqs)

    starts = np.concatenate([[0], np.cumsum(lengths)[:-1]])

    cv_scores: Dict[int, List[float]] = {n: [] for n in candidate_states}
    kf = KFold(n_splits=n_splits, shuffle=True, random_state=42)

    for _, (train_idx, val_idx) in enumerate(kf.split(seq_idxs)):
        X_train_parts = [X[starts[i] : starts[i] + lengths[i]] for i in train_idx]
        X_val_parts = [X[starts[i] : starts[i] + lengths[i]] for i in val_idx]

        if not X_train_parts or not X_val_parts:
            continue

        X_train = np.vstack(X_train_parts)
        L_train = [lengths[i] for i in train_idx]
        val_seqs = X_val_parts

        for n in candidate_states:
            if n > len(train_idx):
                cv_scores[n].append(-np.inf)
                continue
            try:
                hmm = LeftRightHMM(n_states=n, n_iter=n_iter)
                hmm.fit(X_train, L_train)
                fold_lls = [hmm.log_likelihood(seq) for seq in val_seqs]

                valid = [v for v in fold_lls if np.isfinite(v)]
                mean_ll = float(np.mean(valid)) if valid else -np.inf
                cv_scores[n].append(mean_ll)
            except Exception:
                cv_scores[n].append(-np.inf)

    mean_scores: Dict[int, float] = {}
    for n, fold_vals in cv_scores.items():
        finite = [v for v in fold_vals if np.isfinite(v)]
        mean_scores[n] = float(np.mean(finite)) if finite else -np.inf

    best_n = max(mean_scores, key=lambda key: mean_scores[key])
    return best_n, mean_scores


def compute_eer_threshold(
    genuine_scores: np.ndarray,
    impostor_scores: np.ndarray,
    n_thresholds: int = 1000,
) -> Tuple[float, float, float, float]:
    all_scores = np.concatenate([genuine_scores, impostor_scores])
    lo, hi = all_scores.min(), all_scores.max()

    thresholds = np.linspace(lo - 1e-6, hi + 1e-6, n_thresholds)

    far_curve = np.array([np.mean(impostor_scores >= threshold) for threshold in thresholds])
    frr_curve = np.array([np.mean(genuine_scores < threshold) for threshold in thresholds])

    diff = np.abs(far_curve - frr_curve)
    eer_idx = int(np.argmin(diff))
    theta_eer = float(thresholds[eer_idx])
    eer = float((far_curve[eer_idx] + frr_curve[eer_idx]) / 2)

    return theta_eer, eer, far_curve, frr_curve


def train_user_model(
    participant_id: str,
    train_sequences: list,
    val_genuine_seqs: list,
    val_impostor_seqs: list,
    extractor,
    normaliser,
    candidate_states: List[int] = [2, 3, 4, 5],
    n_iter: int = 200,
    verbose: bool = False,
) -> UserHMM:
    X_train, L_train = extractor.sequences_to_arrays(train_sequences)
    X_train = normaliser.transform(X_train)

    best_n, cv_scores = select_n_states_cv(
        X_train, L_train, candidate_states=candidate_states
    )
    if verbose:
        print(f"  [{participant_id}] CV scores: {cv_scores}  -> best n_states={best_n}")

    user_model = UserHMM(participant_id=participant_id, n_states=best_n)
    user_model.fit(X_train, L_train)

    def _score_list(seqs: list) -> np.ndarray:
        scores = []
        for seq in seqs:
            mat = extractor.sequence_to_matrix(seq)
            mat = normaliser.transform(mat)
            scores.append(user_model.score(mat))
        return np.array(scores)

    gen_scores = _score_list(val_genuine_seqs)
    imp_scores = _score_list(val_impostor_seqs)

    gen_finite = gen_scores[np.isfinite(gen_scores)]
    imp_finite = imp_scores[np.isfinite(imp_scores)]

    if len(gen_finite) == 0 or len(imp_finite) == 0:
        X_train_norm, L_train = extractor.sequences_to_arrays(train_sequences)
        X_train_norm = normaliser.transform(X_train_norm)
        train_scores = user_model.hmm.score_sequences(X_train_norm, L_train)
        finite_train = train_scores[np.isfinite(train_scores)]
        theta = float(np.percentile(finite_train, 10)) if len(finite_train) > 0 else -1e3
        if verbose:
            print(
                f"  [{participant_id}] WARNING: degenerate val scores, using training-based theta={theta:.3f}"
            )
    else:
        theta, eer, _, _ = compute_eer_threshold(gen_finite, imp_finite)
        if verbose:
            print(f"  [{participant_id}] EER={eer:.4f}  threshold={theta:.4f}")

    user_model.set_threshold(theta)
    return user_model


def main() -> None:
    from collections import defaultdict

    from gesture_data import generate_synthetic_dataset
    from feature_extractor import FeatureExtractor, ZScoreNormaliser

    print("Generating synthetic dataset ...")
    all_seqs = generate_synthetic_dataset(n_participants=10, n_sessions=3, n_repetitions=10)

    by_pid: Dict[str, list] = defaultdict(list)
    for seq in all_seqs:
        by_pid[seq.participant_id].append(seq)

    extractor = FeatureExtractor()

    pids = list(by_pid.keys())
    enrolled = pids[0]

    train_seqs = [s for s in by_pid[enrolled] if s.session_id == 1]
    val_gen = [s for s in by_pid[enrolled] if s.session_id == 2]
    val_imp = [s for p in pids[1:5] for s in by_pid[p] if s.session_id == 2]

    X_all, _ = extractor.sequences_to_arrays(train_seqs)
    norm = ZScoreNormaliser()
    norm.fit(X_all)

    print(f"Training user model for {enrolled} ...")
    model = train_user_model(
        participant_id=enrolled,
        train_sequences=train_seqs,
        val_genuine_seqs=val_gen,
        val_impostor_seqs=val_imp,
        extractor=extractor,
        normaliser=norm,
        verbose=True,
    )

    test_seqs = [s for s in by_pid[enrolled] if s.session_id == 3]
    for seq in test_seqs[:5]:
        mat = norm.transform(extractor.sequence_to_matrix(seq))
        accepted, ll = model.authenticate(mat)
        print(f"  Genuine seq: accepted={accepted}  ll={ll:.3f}  threshold={model.threshold:.3f}")

    print("\nHMM trainer OK.")


if __name__ == "__main__":
    main()