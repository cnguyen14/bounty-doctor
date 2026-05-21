import type { IssueComment } from "../github.js";

export interface SaturationFinding {
  bountyAmountUsd: number | null;
  daysSinceBountyPosted: number | null;
  hoursSinceLastAttempt: number | null;
  attemptsPerDollar: number | null;
  winProbabilityPct: number;
  rationale: string[];
}

const ALGORA_BOT_LOGIN = "algora-pbc";
const AMOUNT_RE = /\$(\d+(?:[.,]\d+)?)\s*(k|K)?\b/;

function parseAmount(body: string): number | null {
  const m = body.match(AMOUNT_RE);
  if (!m) return null;
  const n = parseFloat(m[1]!.replace(",", ""));
  return m[2]?.toLowerCase() === "k" ? n * 1000 : n;
}

export function checkSaturation(opts: {
  comments: IssueComment[];
  attemptsCount: number;
  uniqueAttempters: number;
  slopScore: number;
  honeypotScamScore: number;
}): SaturationFinding {
  const { comments, attemptsCount, uniqueAttempters, slopScore, honeypotScamScore } = opts;
  const rationale: string[] = [];

  let bountyAmountUsd: number | null = null;
  let bountyPostedAt: string | null = null;

  for (const c of comments) {
    if (c.user.login === ALGORA_BOT_LOGIN) {
      const amount = parseAmount(c.body);
      if (amount !== null) {
        bountyAmountUsd = (bountyAmountUsd ?? 0) + amount;
        if (!bountyPostedAt) bountyPostedAt = c.created_at;
      }
    }
  }

  const now = Date.now();
  const daysSinceBountyPosted =
    bountyPostedAt !== null
      ? Math.round((now - new Date(bountyPostedAt).getTime()) / 86_400_000)
      : null;

  let lastAttemptAt: string | null = null;
  for (const c of comments) {
    if (/^\s*\/(?:attempt|claim)/im.test(c.body)) {
      if (!lastAttemptAt || c.created_at > lastAttemptAt) {
        lastAttemptAt = c.created_at;
      }
    }
  }
  const hoursSinceLastAttempt =
    lastAttemptAt !== null
      ? Math.round((now - new Date(lastAttemptAt).getTime()) / 3_600_000)
      : null;

  const attemptsPerDollar =
    bountyAmountUsd && bountyAmountUsd > 0
      ? attemptsCount / bountyAmountUsd
      : null;

  let win = 50;

  if (honeypotScamScore >= 60) {
    win = 0;
    rationale.push(`Honeypot scam detected — no payout will ever happen.`);
    return finalize(win, rationale);
  }

  if (uniqueAttempters === 0) {
    win += 30;
    rationale.push(`No /attempt comments yet — you can be first.`);
  } else if (uniqueAttempters <= 2) {
    win += 5;
    rationale.push(`Only ${uniqueAttempters} attempters — moderate competition.`);
  } else if (uniqueAttempters <= 5) {
    win -= 10;
    rationale.push(`${uniqueAttempters} attempters — crowded.`);
  } else if (uniqueAttempters <= 15) {
    win -= 30;
    rationale.push(`${uniqueAttempters} attempters — heavily contested.`);
  } else {
    win -= 45;
    rationale.push(
      `${uniqueAttempters} attempters — lottery-level competition, win rate ≈ ${(100 / uniqueAttempters).toFixed(0)}%.`
    );
  }

  if (slopScore >= 50) {
    win -= 10;
    rationale.push(
      `Bot/AI-slop swarm score ${slopScore}/100 — quality bar is low, but maintainer may auto-reject AI PRs you compete with.`
    );
  } else if (slopScore >= 20) {
    win += 5;
    rationale.push(
      `Some AI attempts present (${slopScore}/100). A high-quality human PR can stand out.`
    );
  }

  if (daysSinceBountyPosted !== null) {
    if (daysSinceBountyPosted >= 180) {
      win -= 15;
      rationale.push(
        `Bounty posted ${daysSinceBountyPosted} days ago and still open — maintainer is slow or rejecting attempts.`
      );
    } else if (daysSinceBountyPosted <= 1 && uniqueAttempters <= 2) {
      win += 15;
      rationale.push(`Bounty is fresh (${daysSinceBountyPosted}d old) — racing is viable.`);
    }
  }

  if (
    hoursSinceLastAttempt !== null &&
    hoursSinceLastAttempt < 6 &&
    uniqueAttempters >= 3
  ) {
    win -= 10;
    rationale.push(
      `Last /attempt was ${hoursSinceLastAttempt}h ago — active swarm in progress.`
    );
  }

  if (
    bountyAmountUsd !== null &&
    bountyAmountUsd <= 10 &&
    uniqueAttempters >= 10
  ) {
    win -= 10;
    rationale.push(
      `Bounty is only $${bountyAmountUsd} but has ${uniqueAttempters} attempters — payoff doesn't justify effort.`
    );
  }

  return finalize(win, rationale);

  function finalize(win: number, rationale: string[]): SaturationFinding {
    win = Math.max(0, Math.min(100, Math.round(win)));
    return {
      bountyAmountUsd,
      daysSinceBountyPosted,
      hoursSinceLastAttempt,
      attemptsPerDollar,
      winProbabilityPct: win,
      rationale,
    };
  }
}
