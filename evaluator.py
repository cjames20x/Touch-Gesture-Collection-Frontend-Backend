from __future__ import annotations

import numpy as np
from collections import defaultdict
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, field

# ── Session Modes ────────────────────────────────────────────────────
# Session 1: Training   — 10 reps to record baseline
# Session 2: Evaluation — 10 reps with metrics (FAR, FRR, EER, d-prime)
# Session 3: Authentication — 1 rep for single-attempt verification

def compute_far(
    impostor_scores: np.ndarray, threshold: float
) -> float:
    """False Acceptance Rate: proportion of impostor scores >= threshold"""
    if len(impostor_scores) == 0:
        return 0.0
    return float(np.mean(impostor_scores >= threshold))


def compute_frr(
    genuine_scores: np.ndarray, threshold: float
) -> float:
    """False Rejection Rate: proportion of genuine scores < threshold"""
    if len(genuine_scores) == 0:
        return 0.0
    return float(np.mean(genuine_scores < threshold))


def compute_eer_from_scores(
    genuine_scores  : np.ndarray,
    impostor_scores : np.ndarray,
    n_thresholds    : int = 1000,
) -> Tuple[float, float]:
    """
    Equal Error Rate: threshold where FAR == FRR
    Returns: (EER, threshold)
    """
    all_scores = np.concatenate([genuine_scores, impostor_scores])
    lo = all_scores.min() - 1e-6
    hi = all_scores.max() + 1e-6

    thetas  = np.linspace(lo, hi, n_thresholds)
    far_arr = np.array([np.mean(impostor_scores >= t) for t in thetas])
    frr_arr = np.array([np.mean(genuine_scores  <  t) for t in thetas])

    idx   = int(np.argmin(np.abs(far_arr - frr_arr)))
    eer   = float((far_arr[idx] + frr_arr[idx]) / 2.0)
    theta = float(thetas[idx])
    return eer, theta


def compute_dprime(
    genuine_scores  : np.ndarray,
    impostor_scores : np.ndarray,
) -> float:
    """
    d-prime (d'): measure of separation between genuine and impostor distributions
    Higher d' indicates better separability
    """
    mu_g  = genuine_scores.mean()
    mu_i  = impostor_scores.mean()
    var_g = genuine_scores.var()
    var_i = impostor_scores.var()

    denom = np.sqrt((var_g + var_i) / 2.0)
    if denom < 1e-12:
        return 0.0
    return float((mu_g - mu_i) / denom)


def compute_accuracy(
    genuine_scores  : np.ndarray,
    impostor_scores : np.ndarray,
    threshold       : float,
) -> float:
    """Accuracy: (TP + TN) / Total"""
    tp = np.sum(genuine_scores  >= threshold)
    tn = np.sum(impostor_scores  < threshold)
    total = len(genuine_scores) + len(impostor_scores)
    return float((tp + tn) / total) if total > 0 else 0.0

@dataclass
class UserResult:
    """
    Per-user authentication result for a given session
    """
    participant_id  : str
    session_id      : int                           # 1=training, 2=evaluation, 3=authentication
    model_type      : str                           # 'HMM' or 'SVM'
    genuine_scores  : np.ndarray = field(repr=False)
    impostor_scores : np.ndarray = field(repr=False)
    threshold       : float = 0.0

    # Computed metrics
    far      : float = 0.0
    frr      : float = 0.0
    eer      : float = 0.0
    dprime   : float = 0.0
    accuracy : float = 0.0

    def evaluate(self) -> "UserResult":
        """Compute all metrics for this user result"""
        g = self.genuine_scores[np.isfinite(self.genuine_scores)]
        i = self.impostor_scores[np.isfinite(self.impostor_scores)]

        if len(g) == 0 or len(i) == 0:
            return self

        self.far      = compute_far(i, self.threshold)
        self.frr      = compute_frr(g, self.threshold)
        self.eer, _   = compute_eer_from_scores(g, i)
        self.dprime   = compute_dprime(g, i)
        self.accuracy = compute_accuracy(g, i, self.threshold)
        return self

@dataclass
class AggregateMetrics:
    """
    Aggregated metrics across all users for a given session
    """
    model_type : str
    session_id : int                                # 1=training, 2=evaluation, 3=authentication
    n_users    : int

    mean_far    : float = 0.0
    std_far     : float = 0.0
    mean_frr    : float = 0.0
    std_frr     : float = 0.0
    mean_eer    : float = 0.0
    std_eer     : float = 0.0
    mean_dprime : float = 0.0
    std_dprime  : float = 0.0
    mean_acc    : float = 0.0
    std_acc     : float = 0.0

    @classmethod
    def from_user_results(
        cls,
        results    : List[UserResult],
        model_type : str,
        session_id : int,
    ) -> "AggregateMetrics":
        """Compute aggregate metrics from individual user results"""
        n = len(results)
        if n == 0:
            return cls(model_type=model_type, session_id=session_id, n_users=0)

        fars    = np.array([r.far      for r in results])
        frrs    = np.array([r.frr      for r in results])
        eers    = np.array([r.eer      for r in results])
        dps     = np.array([r.dprime   for r in results])
        accs    = np.array([r.accuracy for r in results])

        return cls(
            model_type  = model_type,
            session_id  = session_id,
            n_users     = n,
            mean_far    = float(fars.mean()),    std_far    = float(fars.std()),
            mean_frr    = float(frrs.mean()),    std_frr    = float(frrs.std()),
            mean_eer    = float(eers.mean()),    std_eer    = float(eers.std()),
            mean_dprime = float(dps.mean()),     std_dprime = float(dps.std()),
            mean_acc    = float(accs.mean()),    std_acc    = float(accs.std()),
        )

class AuthEvaluationPipeline:
    """
    Full HMM authentication evaluation pipeline:
    
    1. Training (Session 1): Enroll users with 10 repetitions
    2. Evaluation (Session 2): Test 10 reps with metrics
    3. Authentication (Session 3): Single-attempt verification
    """

    def __init__(self, extractor, verbose: bool = False):
        self.extractor = extractor
        self.verbose   = verbose

        self.user_results   : List[UserResult] = []
        self.user_models    : Dict[str, object] = {}   # pid -> UserHMM
        self.normalisers    : Dict[str, object] = {}   # pid -> ZScoreNormaliser

    def _group(self, sequences: list):
        """Group sequences by (participant_id, session_id)"""
        by_pid_sess: Dict[Tuple[str, int], list] = defaultdict(list)
        for s in sequences:
            by_pid_sess[(s.participant_id, s.session_id)].append(s)
        return by_pid_sess

    def run(
        self,
        all_sequences   : list,
        candidate_states: List[int] = [2, 3, 4, 5],
        n_iter          : int = 200,
    ):
        """
        Run evaluation pipeline across all sessions
        """
        from feature_extractor import ZScoreNormaliser
        from hmm_trainer        import train_user_model

        by_pid_sess = self._group(all_sequences)
        all_pids    = list({pid for (pid, _) in by_pid_sess})

        for pid in all_pids:
            train_seqs = by_pid_sess.get((pid, 1), [])  # Session 1: Training
            val_seqs   = by_pid_sess.get((pid, 2), [])  # Session 2: Evaluation
            test_seqs  = by_pid_sess.get((pid, 3), [])  # Session 3: Authentication

            if len(train_seqs) < 3:
                if self.verbose:
                    print(f"  [{pid}] Not enough training sequences, skipping.")
                continue

            imp_val_seqs = [
                s for (other_pid, sess), seqs in by_pid_sess.items()
                for s in seqs
                if other_pid != pid and sess == 2
            ]

            if self.verbose:
                print(f"\n[{pid}] Training on {len(train_seqs)} seq, "
                      f"eval_gen={len(val_seqs)}, eval_imp={len(imp_val_seqs)}")

            X_tr, L_tr = self.extractor.sequences_to_arrays(train_seqs)
            norm = ZScoreNormaliser()
            norm.fit(X_tr)
            self.normalisers[pid] = norm

            model = train_user_model(
                participant_id    = pid,
                train_sequences   = train_seqs,
                val_genuine_seqs  = val_seqs  if val_seqs  else train_seqs[:2],
                val_impostor_seqs = imp_val_seqs[:20],
                extractor         = self.extractor,
                normaliser        = norm,
                candidate_states  = candidate_states,
                n_iter            = n_iter,
                verbose           = self.verbose,
            )
            self.user_models[pid] = model

            # Evaluate on Sessions 2 and 3
            for eval_sess, eval_seqs in [(2, val_seqs), (3, test_seqs)]:
                if not eval_seqs:
                    continue

                imp_test_seqs = [
                    s for (op, sess), seqs in by_pid_sess.items()
                    for s in seqs
                    if op != pid and sess == eval_sess
                ]

                def _score(seqs):
                    out = []
                    for s in seqs:
                        mat = norm.transform(self.extractor.sequence_to_matrix(s))
                        out.append(model.score(mat))
                    return np.array(out)

                gen_scores = _score(eval_seqs)
                imp_scores = _score(imp_test_seqs[:30])  

                result = UserResult(
                    participant_id  = pid,
                    session_id      = eval_sess,
                    model_type      = "HMM",
                    genuine_scores  = gen_scores,
                    impostor_scores = imp_scores,
                    threshold       = model.threshold,
                ).evaluate()

                self.user_results.append(result)

                session_name = {2: "Evaluation", 3: "Authentication"}.get(eval_sess, f"S{eval_sess}")
                if self.verbose:
                    print(
                        f"  [{pid}] {session_name}  "
                        f"FAR={result.far:.3f}  FRR={result.frr:.3f}  "
                        f"EER={result.eer:.3f}  d'={result.dprime:.3f}  "
                        f"Acc={result.accuracy:.3f}"
                    )

    def aggregate_by_session(self) -> Dict[int, AggregateMetrics]:
        """Aggregate metrics by session"""
        by_sess: Dict[int, List[UserResult]] = defaultdict(list)
        for r in self.user_results:
            by_sess[r.session_id].append(r)

        return {
            sess: AggregateMetrics.from_user_results(results, "HMM", sess)
            for sess, results in sorted(by_sess.items())
        }

    def temporal_stability(self) -> Dict[str, Dict[int, float]]:
        """Track d-prime stability across sessions"""
        stability: Dict[str, Dict[int, float]] = defaultdict(dict)
        for r in self.user_results:
            stability[r.participant_id][r.session_id] = r.dprime
        return dict(stability)

    def significance_test(
        self,
        metric_a: List[float],
        metric_b: List[float],
        alpha: float = 0.05,
    ) -> Dict[str, object]:
        """Statistical significance test between two metrics"""
        from scipy import stats

        a = np.array(metric_a)
        b = np.array(metric_b)
        diff = a - b

        if len(diff) >= 3:
            _, p_normal = stats.shapiro(diff)
            normal = p_normal > 0.05
        else:
            normal = False

        if normal:
            stat, pval = stats.ttest_rel(a, b)
            test_used  = "paired t-test"
        else:
            stat, pval = stats.wilcoxon(diff, zero_method="wilcox")
            test_used  = "Wilcoxon signed-rank"

        return {
            "test_used"   : test_used,
            "statistic"   : float(stat),
            "p_value"     : float(pval),
            "significant" : bool(pval < alpha),
        }

    def print_summary(self):
        """Print comprehensive summary report"""
        agg = self.aggregate_by_session()

        SEP = "-" * 80
        session_names = {1: "Training", 2: "Evaluation", 3: "Authentication"}

        print("\n" + "=" * 80)
        print(" AUTHENTICATION PERFORMANCE BY SESSION")
        print("=" * 80)
        print(f"{'Session':<15}{'Model':<8}{'FAR':>8}{'FRR':>8}{'EER':>8}{'d\'':>8}{'Acc':>8}{'N':>5}")
        print(SEP)
        for sess, m in sorted(agg.items()):
            sess_name = session_names.get(sess, f"S{sess}")
            print(
                f"{sess_name:<15}{m.model_type:<8}"
                f"{m.mean_far:>7.4f} {m.mean_frr:>7.4f} "
                f"{m.mean_eer:>7.4f} {m.mean_dprime:>7.4f} {m.mean_acc:>7.4f} {m.n_users:>5}"
            )
        print(SEP)

        print("\n" + "=" * 80)
        print(" TEMPLATE STABILITY (d') ACROSS SESSIONS")
        print("=" * 80)
        stab = self.temporal_stability()
        sessions = sorted({s for v in stab.values() for s in v.keys()})
        header = f"{'Participant':<14}" + "".join(f"S{s}_d':>10" for s in sessions)
        print(header)
        print(SEP)
        for pid, sess_dp in sorted(stab.items()):
            row = f"{pid:<14}" + "".join(
                f"{sess_dp.get(s, float('nan')):>10.4f}" for s in sessions
            )
            print(row)
        print(SEP)

        if len(sessions) >= 2:
            print("\n  Temporal drift (Training → Authentication):")
            first_s = sessions[0]
            last_s  = sessions[-1]
            first_res = [r for r in self.user_results if r.session_id == first_s]
            last_res  = [r for r in self.user_results if r.session_id == last_s]
            pid_map_f = {r.participant_id: r for r in first_res}
            pid_map_l = {r.participant_id: r for r in last_res}
            common    = set(pid_map_f) & set(pid_map_l)
            if common:
                eer_drift = np.mean([
                    pid_map_l[p].eer - pid_map_f[p].eer for p in common
                ])
                dp_drift  = np.mean([
                    pid_map_l[p].dprime - pid_map_f[p].dprime for p in common
                ])
                print(f"  EER drift : {eer_drift:+.4f} (positive = worse)")
                print(f"  d'  drift : {dp_drift:+.4f} (negative = less separable)")

if __name__ == "__main__":
    from gesture_data      import generate_synthetic_dataset
    from feature_extractor import FeatureExtractor

    print("=" * 60)
    print("Full HMM Authentication Pipeline Demo")
    print("=" * 60)

    print("\nGenerating synthetic dataset (15 participants, 3 sessions) ...")
    all_seqs = generate_synthetic_dataset(
        n_participants=15,
        n_sessions=3,
        n_repetitions=10,
        seed=99,
    )
    print(f"Total sequences: {len(all_seqs)}")

    extractor = FeatureExtractor()

    print("\nRunning AuthEvaluationPipeline ...")
    pipeline = AuthEvaluationPipeline(extractor, verbose=True)
    pipeline.run(
        all_seqs,
        candidate_states=[2, 3, 4],
        n_iter=50,
    )

    pipeline.print_summary()

    print("\n" + "=" * 60)
    print("Statistical significance: Evaluation vs Authentication EER")
    print("=" * 60)
    s2_eers = [r.eer for r in pipeline.user_results if r.session_id == 2]
    s3_eers = [r.eer for r in pipeline.user_results if r.session_id == 3]
    if len(s2_eers) > 2 and len(s3_eers) > 2:
        n = min(len(s2_eers), len(s3_eers))
        result = pipeline.significance_test(s2_eers[:n], s3_eers[:n])
        for k, v in result.items():
            print(f"  {k:<20}: {v}")

    print("\nPipeline demo complete.")