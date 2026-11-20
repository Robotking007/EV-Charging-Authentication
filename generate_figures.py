import json
import os
from pathlib import Path
import sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import FancyBboxPatch, ArrowStyle, BoxStyle

# Set high-quality IEEE/ACM research paper style
plt.rcParams['font.family'] = 'DejaVu Sans'
plt.rcParams['font.size'] = 10
plt.rcParams['axes.titlesize'] = 11
plt.rcParams['axes.labelsize'] = 10
plt.rcParams['xtick.labelsize'] = 9
plt.rcParams['ytick.labelsize'] = 9
plt.rcParams['legend.fontsize'] = 9
plt.rcParams['figure.titlesize'] = 12
plt.rcParams['figure.dpi'] = 300

PROJECT_ROOT = Path(__file__).resolve().parent
OUTPUT_DIRS = [PROJECT_ROOT / "images", PROJECT_ROOT / "paper_figures"]


for d in OUTPUT_DIRS:
    os.makedirs(d, exist_ok=True)

def save_fig(fig, filename):
    for d in OUTPUT_DIRS:
        target = os.path.join(d, filename)
        fig.savefig(target, dpi=300, bbox_inches='tight')
    print(f"Saved: {filename}")

# -----------------------------------------------------------------------------
# FIGURE 1: Overall System Architecture Block Diagram
# -----------------------------------------------------------------------------
def make_fig1():
    fig, ax = plt.subplots(figsize=(10, 6.5))
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.axis('off')

    # Background color layers for 3 tiers
    # Tier 1: Participant Layer (Top)
    tier1_bg = FancyBboxPatch((3, 67), 94, 28, boxstyle="Round,pad=1.5",
                              facecolor="#F0F4F8", edgecolor="#B0C4DE", lw=1.5, linestyle="--")
    ax.add_patch(tier1_bg)
    ax.text(6, 92, "TIER 1: PHYSICAL PARTICIPANT LAYER (EV & CHARGING INFRASTRUCTURE)",
            fontsize=10, fontweight='bold', color="#1B365D")

    # EV Box
    ev_box = FancyBboxPatch((6, 70), 38, 19, boxstyle="Round,pad=0.8",
                           facecolor="#E6F0FA", edgecolor="#2B6CB0", lw=2)
    ax.add_patch(ev_box)
    ax.text(25, 85.5, "Electric Vehicle (EV / OBU)", ha='center', fontweight='bold', color="#1A365D")
    ax.text(25, 81, "• Decentralized Identity: did:ev:001\n• Software EV client\n• Key Pair: (sk_ev, pk_ev)\n• Nonce & Challenge Signer",
            ha='center', fontsize=8.5, color="#2D3748")

    # Station Box
    cs_box = FancyBboxPatch((56, 70), 38, 19, boxstyle="Round,pad=0.8",
                           facecolor="#E6FFFA", edgecolor="#2C7A7B", lw=2)
    ax.add_patch(cs_box)
    ax.text(75, 85.5, "Charging Station (CS / SECC)", ha='center', fontweight='bold', color="#1A365D")
    ax.text(75, 81, "• Decentralized Identity: did:station:001\n• Software station and meter input\n• Key Pair: (sk_cs, pk_cs)\n• Mutual Challenge Countersigner",
            ha='center', fontsize=8.5, color="#2D3748")

    # Mutual Challenge Arrow between EV and CS
    ax.annotate("", xy=(56, 79.5), xytext=(44, 79.5),
                arrowprops=dict(arrowstyle="<|-|>", color="#D97706", lw=2.2))
    ax.text(50, 81.5, "Mutual Challenge\nHandshake (ECDSA)", ha='center', fontsize=8, fontweight='bold', color="#B45309")

    # Tier 2: Blockchain Smart Contract Layer (Middle)
    tier2_bg = FancyBboxPatch((3, 34), 94, 30, boxstyle="Round,pad=1.5",
                              facecolor="#FAF5FF", edgecolor="#D6BCFA", lw=1.5, linestyle="--")
    ax.add_patch(tier2_bg)
    ax.text(6, 61, "TIER 2: CONSORTIUM BLOCKCHAIN (FOUR BESU IBFT 2.0 VALIDATORS)",
            fontsize=10, fontweight='bold', color="#44337A")

    # Smart Contract Modules
    m1 = FancyBboxPatch((6, 37), 26, 21, boxstyle="Round,pad=0.6",
                        facecolor="#FFFFFF", edgecolor="#805AD5", lw=1.5)
    ax.add_patch(m1)
    ax.text(19, 54.5, "DID Identity Registry", ha='center', fontweight='bold', color="#44337A")
    ax.text(19, 45, "• Role-Based Access (RBAC)\n• Registrar-gated enrollment\n• Key rotation and revocation\n• DID hash and signing address",
            ha='center', fontsize=8, color="#4A5568")

    m2 = FancyBboxPatch((37, 37), 26, 21, boxstyle="Round,pad=0.6",
                        facecolor="#FFFFFF", edgecolor="#805AD5", lw=1.5)
    ax.add_patch(m2)
    ax.text(50, 54.5, "Authentication & Gatekeeper", ha='center', fontweight='bold', color="#44337A")
    ax.text(50, 45, "• OpenZeppelin ECDSA checks\n• Replay Guard (usedNonces)\n• Threshold Check (T >= T_min)\n• Prepaid escrow and signed metering",
            ha='center', fontsize=8, color="#4A5568")

    m3 = FancyBboxPatch((68, 37), 26, 21, boxstyle="Round,pad=0.6",
                        facecolor="#FFFFFF", edgecolor="#805AD5", lw=1.5)
    ax.add_patch(m3)
    ax.text(81, 54.5, "M-of-N Oracle Consensus", ha='center', fontweight='bold', color="#44337A")
    ax.text(81, 45, "• Default 2-of-3 oracle quorum\n• proposeSettlementScore()\n• approveProposal()\n• Direct Misbehavior Slashing",
            ha='center', fontsize=8, color="#4A5568")

    # Vertical Arrow from Tier 1 to Tier 2
    ax.annotate("", xy=(50, 58), xytext=(50, 70),
                arrowprops=dict(arrowstyle="-|>", color="#2B6CB0", lw=2.2))
    ax.text(50.5, 64, "Dual Signed Challenge {evSig, stationSig, nonce}",
            ha='left', va='center', fontsize=8, fontweight='bold', color="#2B6CB0")

    # Tier 3: Off-Chain Trust Management Layer (Bottom)
    tier3_bg = FancyBboxPatch((3, 3), 94, 28, boxstyle="Round,pad=1.5",
                              facecolor="#FFFDF5", edgecolor="#FBD38D", lw=1.5, linestyle="--")
    ax.add_patch(tier3_bg)
    ax.text(6, 28, "TIER 3: DYNAMIC TRUST ENGINE & ORACLE SET (OFF-CHAIN FEEDBACK LOOP)",
            fontsize=10, fontweight='bold', color="#7B341E")

    # Trust Engine Components
    te1 = FancyBboxPatch((6, 6), 41, 19, boxstyle="Round,pad=0.8",
                         facecolor="#FFFFFF", edgecolor="#DD6B20", lw=1.8)
    ax.add_patch(te1)
    ax.text(26.5, 21.5, "Beta-Reputation Engine with Decay", ha='center', fontweight='bold', color="#9C4221")
    ax.text(26.5, 13.5, "• Beta Distribution: Beta(alpha, beta)\n• Time-Decay: exp(-lambda * delta_t)\n• Scaled Score Commit: T = [alpha/(alpha+beta)] * 10^4\n• Canonical settlement event replay",
            ha='center', fontsize=8.2, color="#2D3748")

    te2 = FancyBboxPatch((53, 6), 41, 19, boxstyle="Round,pad=0.8",
                         facecolor="#FFFFFF", edgecolor="#DD6B20", lw=1.8)
    ax.add_patch(te2)
    ax.text(73.5, 21.5, "Independent Oracle Network Nodes", ha='center', fontweight='bold', color="#9C4221")
    ax.text(73.5, 13.5, "• Read confirmed settlement events\n• Recompute reputation independently\n• Verify candidate and sign approval\n• Separate accounts and RPC endpoints",
            ha='center', fontsize=8.2, color="#2D3748")

    # Arrows between Tier 2 and Tier 3 (Closed Loop Feedback)
    # Downward: Session closed
    ax.annotate("", xy=(26.5, 25), xytext=(26.5, 37),
                arrowprops=dict(arrowstyle="-|>", color="#C53030", lw=2, linestyle=":"))
    ax.text(27, 31, "SessionSettled event (signed energy in Wh)",
            ha='left', va='center', fontsize=8, color="#9B2C2C", fontweight='bold')

    # Upward: Propose score
    ax.annotate("", xy=(81, 37), xytext=(81, 25),
                arrowprops=dict(arrowstyle="-|>", color="#276749", lw=2))
    ax.text(81.5, 31, "Score proposal/approval",
            ha='left', va='center', fontsize=8, color="#22543D", fontweight='bold')

    plt.title("Figure 1: Multi-Tier Architecture of the Proposed Blockchain-Based EV Charging Authentication System",
              fontsize=11, fontweight='bold', pad=15)
    save_fig(fig, "fig1_system_architecture.png")
    plt.close(fig)

# -----------------------------------------------------------------------------
# FIGURE 2: Mutual Authentication Protocol Flowchart
# -----------------------------------------------------------------------------
def make_fig2():
    fig, ax = plt.subplots(figsize=(9, 10))
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.axis('off')

    # Style helper
    def draw_node(x, y, w, h, title, subtitle="", color="#E2E8F0", border="#4A5568", shape="rect"):
        if shape == "rect":
            box = FancyBboxPatch((x - w/2, y - h/2), w, h, boxstyle="Round,pad=0.5",
                                 facecolor=color, edgecolor=border, lw=1.8)
            ax.add_patch(box)
        elif shape == "diamond":
            poly = patches.Polygon([
                [x, y + h/2],
                [x + w/2, y],
                [x, y - h/2],
                [x - w/2, y]
            ], facecolor=color, edgecolor=border, lw=1.8)
            ax.add_patch(poly)
        ax.text(x, y + (1.2 if subtitle else 0), title, ha='center', va='center',
                fontweight='bold', fontsize=8.8, color="#1A202C")
        if subtitle:
            ax.text(x, y - 2.2, subtitle, ha='center', va='center',
                    fontsize=7.5, color="#4A5568")

    def connect(x1, y1, x2, y2, label="", label_pos=0.5, color="#2D3748"):
        ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                    arrowprops=dict(arrowstyle="-|>", color=color, lw=1.8))
        if label:
            mx = x1 + (x2 - x1) * label_pos
            my = y1 + (y2 - y1) * label_pos
            ax.text(mx + 1.5, my, label, fontsize=8, fontweight='bold', color=color)

    # 1. Start Node
    draw_node(50, 95, 42, 6, "1. Session Request Initiated", "EV requests charging from Station (did:station)", "#EBF8FF", "#3182CE")
    connect(50, 92, 50, 85)

    # 2. Nonce Generation
    draw_node(50, 81.5, 52, 7, "2. Cryptographic Challenge Nonce Generation", "EV generates a random 32-byte nonce η", "#EBF8FF", "#3182CE")
    connect(50, 78, 50, 71.5)

    # 3. Digest Construction
    draw_node(50, 68, 62, 7, "3. Domain-Separated Challenge Digest Construction", "Digest = keccak256(evId, stationId, η, address(this), chainId)", "#FEFCBF", "#D69E2E")
    connect(50, 64.5, 50, 58)

    # 4. Dual ECDSA Signing
    draw_node(50, 54.5, 62, 7, "4. Mutual Dual-Party ECDSA Signing", "EV computes σ_ev = sign(Digest); Station computes σ_cs = sign(Digest)", "#FEFCBF", "#D69E2E")
    connect(50, 51, 50, 44.5)

    # 5. Smart Contract Invocation
    draw_node(50, 41, 62, 7, "5. Smart Contract Verification: authenticateSession()", "Registry verifies usedNonces[η], active identities and both signatures", "#E9D8FD", "#805AD5")
    connect(50, 37.5, 50, 30.5)

    # 6. Trust Threshold Evaluation (Diamond)
    draw_node(50, 26, 42, 9, "Both Trust Scores", "T_ev >= T_min and T_cs >= T_min?", "#FEEBC8", "#DD6B20", shape="diamond")

    # Branch YES (Left/Down)
    ax.annotate("", xy=(22, 17), xytext=(29, 26),
                arrowprops=dict(arrowstyle="-|>", color="#276749", lw=2))
    ax.text(22, 23.5, "YES (Authorized)", fontsize=8.5, fontweight='bold', color="#22543D")

    draw_node(22, 12, 38, 8, "Session Authorized & Authenticated", "EV funds a prepaid budget\nJointly signed energy drives payment and reputation", "#C6F6D5", "#38A169")

    # Branch NO (Right/Down)
    ax.annotate("", xy=(78, 17), xytext=(71, 26),
                arrowprops=dict(arrowstyle="-|>", color="#9B2C2C", lw=2))
    ax.text(72, 23.5, "NO (Insufficient Trust)", fontsize=8.5, fontweight='bold', color="#742A2A")

    draw_node(78, 12, 38, 8, "Access Denied On-Chain", "Emit SessionDenied and consume nonce\nReview the decision in the ledger", "#FED7D7", "#E53E3E")

    plt.title("Figure 2: Protocol Flowchart of Mutual Challenge-Response and Dynamic Trust Authorization",
              fontsize=10.5, fontweight='bold', pad=12)
    save_fig(fig, "fig2_authentication_flowchart.png")
    plt.close(fig)

# -----------------------------------------------------------------------------
# FIGURE 3: Dynamic Trust Evolution under Multiple Behavioral Scenarios
# -----------------------------------------------------------------------------
def make_fig3():
    def trajectory(outcomes, slash_at=None):
        alpha = beta = 1
        last = 0
        stored_score = 0.5
        scores = []
        for hour, outcome in enumerate(outcomes, start=1):
            if outcome is not None:
                decay = np.exp(-0.01 * (hour - last))
                alpha = 1 + (alpha - 1) * decay + outcome
                beta = 1 + (beta - 1) * decay + (1 - outcome)
                last = hour
                stored_score = alpha / (alpha + beta)
            if hour == slash_at:
                stored_score = max(0, stored_score - 0.65)
            scores.append(stored_score)
        return scores

    fig, ax = plt.subplots(figsize=(8.5, 4.8))
    hours = np.arange(1, 61)
    ax.plot(hours, trajectory([1] * 60), label="Consistently successful", color="#2B6CB0")
    ax.plot(hours, trajectory([1] * 27 + [None] + [0] * 32, slash_at=28),
            label="Slashed, then failed outcomes", color="#C53030")
    ax.plot(hours, trajectory([1, 1, 0, 0] * 15), label="Alternating outcomes", color="#D69E2E")
    ax.plot(hours, trajectory([1] * 20 + [None] * 25 + [1] * 15),
            label="Dormant through hour 45", color="#6B46C1", linestyle=":")
    ax.axhline(0.3, color="#718096", linestyle="--", label="Default threshold (0.30)")
    ax.axvspan(21, 45, color="#E9D8FD", alpha=0.22)
    ax.set(xlabel="Elapsed time (hours)", ylabel="Committed trust score",
           title="Figure 3. Modeled trust scores under scripted charging outcomes",
           ylim=(0, 1.05), xlim=(1, 60))
    ax.legend(loc="lower right", fontsize=8)
    ax.grid(alpha=0.3)
    save_fig(fig, "fig3_dynamic_trust_evolution.png")
    plt.close(fig)


# -----------------------------------------------------------------------------
# FIGURE 4: Impact of Time-Decay Parameter (lambda)
# -----------------------------------------------------------------------------
def make_fig4():
    fig, ax = plt.subplots(figsize=(8.5, 5))
    hours = np.linspace(0, 720, 200) # 30 days

    # Initial high reputation (19 successful sessions, 1 failure: alpha=20, beta=2, trust=0.909)
    alpha_0 = 20.0
    beta_0 = 2.0
    prior_alpha = 1.0
    prior_beta = 1.0

    lambdas = [
        (0.0, "λ = 0.000 / hr (Static Baseline, No Decay)", "#718096", "-"),
        (0.002, "λ = 0.002 / hr (Slow Decay, Halflife ~346 hrs)", "#3182CE", "--"),
        (0.010, "λ = 0.010 / hr (Implemented, half-life ~69 hrs)", "#2C7A7B", "-"),
        (0.015, "λ = 0.015 / hr (Rapid Decay, Halflife ~46 hrs)", "#DD6B20", "-.")
    ]

    for lam, label, col, ls in lambdas:
        decay_factor = np.exp(-lam * hours)
        # alpha decays toward neutral prior 1.0, beta decays toward 1.0
        alpha_t = prior_alpha + (alpha_0 - prior_alpha) * decay_factor
        beta_t = prior_beta + (beta_0 - prior_beta) * decay_factor
        trust_t = alpha_t / (alpha_t + beta_t)
        ax.plot(hours, trust_t, label=label, color=col, linestyle=ls, lw=2.4)

    ax.axhline(0.5, color='#A0AEC0', linestyle=':', lw=1.5, label='Neutral Prior (T = 0.50)')
    ax.axhline(0.3, color='#E53E3E', linestyle='-.', lw=1.5, label='Authorization threshold (0.30)')

    ax.set_xlabel("Elapsed Inactivity Time (Hours since last session)", fontweight='bold')
    ax.set_ylabel("Projected score before next observation", fontweight='bold')
    ax.set_xlim(0, 720)
    ax.set_ylim(0.25, 0.95)

    # Secondary X-axis for days
    ax2 = ax.twiny()
    ax2.set_xlim(ax.get_xlim())
    ax2.set_xticks([0, 168, 336, 504, 672])
    ax2.set_xticklabels(["0d", "7d (1 wk)", "14d (2 wks)", "21d (3 wks)", "28d (4 wks)"])
    ax2.set_xlabel("Elapsed Inactivity Time (Days)", fontsize=8.5, color="#4A5568")

    ax.grid(True, linestyle='--', alpha=0.4)
    ax.legend(loc='upper right', framealpha=0.95, edgecolor='#CBD5E0')

    plt.title("Figure 4. Modeled time decay of reputation parameters $\\alpha$ and $\\beta$ during Entity Dormancy",
              fontweight='bold', pad=25)
    save_fig(fig, "fig4_time_decay_impact.png")
    plt.close(fig)

# -----------------------------------------------------------------------------
# FIGURE 5: Authentication Latency Breakdown & Paradigm Comparison
# -----------------------------------------------------------------------------

MEASUREMENT_LABELS = {
    "authenticateSession": "Authorize",
    "fundSession": "Fund budget",
    "settleSession": "Settle payment",
    "withdrawStationPayment": "Station withdrawal",
    "withdrawEvRefund": "EV withdrawal",
}


def measured_bars(ax, measurements, field, label):
    names = [MEASUREMENT_LABELS.get(method, method) for method in measurements]
    values = [int(row[field]) for row in measurements.values()]
    bars = ax.barh(names, values, color="#3182CE")
    ax.invert_yaxis()
    ax.set_xlabel(label)
    ax.set_xlim(0, max(values) * 1.25)
    ax.grid(axis="x", alpha=0.3)
    ax.set_axisbelow(True)
    ax.bar_label(bars, labels=[f"{value:,}" for value in values], padding=4)


def make_fig5(results):
    fig, ax = plt.subplots(figsize=(8, 4))
    measured_bars(ax, results["measurements"], "confirmationMs", "Submission-to-confirmation time (ms)")
    ax.set_title("Figure 5. Observed confirmation times for one charging session")
    fig.text(0.5, 0.01, "Four local Besu IBFT 2.0 validators. One sample per operation.", ha="center")
    fig.tight_layout(rect=[0, 0.05, 1, 1])
    save_fig(fig, "fig5_latency_comparison.png")
    plt.close(fig)


def make_fig6(results):
    fig, (gas, summary) = plt.subplots(1, 2, figsize=(10, 4), width_ratios=[1.6, 1])
    measured_bars(gas, results["measurements"], "gasUsed", "Gas used (receipt)")
    gas.set_title("Charging-session transactions")
    batch = results["authorizationBatch"]
    summary.axis("off")
    summary.text(0.04, 0.85, "Authorization batch", weight="bold", fontsize=11)
    summary.text(
        0.04, 0.72,
        f"{batch['transactions']} transactions across {batch['uniqueBlocks']} blocks\n"
        f"{batch['confirmationSeconds']:.3f} s to submit and confirm\n"
        f"{batch['observedTransactionsPerSecond']:.2f} confirmed transactions/s",
        va="top", fontsize=10, linespacing=1.65,
    )
    fig.suptitle("Figure 6. Receipt gas and observed local batch throughput")
    fig.tight_layout()
    save_fig(fig, "fig6_gas_and_throughput.png")
    plt.close(fig)


if __name__ == "__main__":
    if "--benchmarks-only" not in sys.argv:
        make_fig1()
        make_fig2()
        make_fig3()
        make_fig4()

    evidence = PROJECT_ROOT / ".local-chain" / "benchmark.json"
    if evidence.exists():
        results = json.loads(evidence.read_text(encoding="utf-8"))
        make_fig5(results)
        make_fig6(results)
    elif "--benchmarks-only" in sys.argv:
        raise SystemExit("Run npm run besu:verify to collect measurements before generating benchmark figures.")
