import type { Issue, Repo } from "../github.js";

export interface HoneypotFinding {
  severity: "clean" | "suspicious" | "scam";
  signals: string[];
  scamScore: number;
}

const SUSPICIOUS_BOUNTY_LABELS = /^\$(\d+(?:\.\d+)?)(k|K)?$/;

function parseBountyLabel(label: string): number | null {
  const m = label.match(SUSPICIOUS_BOUNTY_LABELS);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  const isK = m[2]?.toLowerCase() === "k";
  return isK ? n * 1000 : n;
}

const SCAM_TITLE_PATTERN = /^\[\s*Bounty\s+\$\d+k?\s*\]\s*\[/i;

export function checkHoneypot(opts: {
  repo?: Repo;
  issue?: Issue;
  repoBountyIssues?: Issue[];
}): HoneypotFinding {
  const signals: string[] = [];
  let scamScore = 0;

  const { repo, issue, repoBountyIssues } = opts;

  if (issue) {
    const labels = issue.labels.map((l) => l.name);
    const bountyAmounts = labels
      .map(parseBountyLabel)
      .filter((n): n is number => n !== null);

    const hasGoodFirstIssue = labels.some((l) =>
      /good first issue/i.test(l)
    );
    const hasCryptoTag = labels.some((l) => /crypto/i.test(l));
    const hasHighValueTag = labels.some((l) => /high.?value/i.test(l));

    const maxBounty = bountyAmounts.length ? Math.max(...bountyAmounts) : 0;

    if (hasGoodFirstIssue && maxBounty >= 1000) {
      signals.push(
        `"good first issue" labeled with $${maxBounty} bounty — real GFI bounties are typically $5–$50`
      );
      scamScore += 40;
    }

    if (hasGoodFirstIssue && hasCryptoTag && hasHighValueTag) {
      signals.push(
        `Label combo "good first issue" + crypto-eligible + high-value is a known farm pattern`
      );
      scamScore += 30;
    }

    if (SCAM_TITLE_PATTERN.test(issue.title)) {
      signals.push(
        `Title prefix "[ Bounty $Xk ] [ Section ] ..." is a bulk-fake-bounty signature`
      );
      scamScore += 25;
    }
  }

  if (repoBountyIssues && repoBountyIssues.length > 0) {
    const titlePrefixMatches = repoBountyIssues.filter((i) =>
      SCAM_TITLE_PATTERN.test(i.title)
    ).length;
    if (titlePrefixMatches >= 5) {
      signals.push(
        `${titlePrefixMatches} sibling issues use the same "[ Bounty $Xk ] [ ... ]" title pattern — bulk-faked listings`
      );
      scamScore += 35;
    }

    const totalValue = repoBountyIssues
      .flatMap((i) => i.labels.map((l) => l.name))
      .map(parseBountyLabel)
      .filter((n): n is number => n !== null)
      .reduce((a, b) => a + b, 0);
    if (totalValue >= 50000 && repoBountyIssues.length >= 10) {
      signals.push(
        `Repo offers $${totalValue.toLocaleString()} across ${repoBountyIssues.length} open bounties — implausibly large for one repo`
      );
      scamScore += 25;
    }
  }

  if (repo && !repo.has_issues) {
    signals.push(
      `Repo has issues disabled — bounty links point to non-actionable issues`
    );
    scamScore += 20;
  }
  if (repo?.archived) {
    signals.push(`Repo is archived — PRs will not be merged`);
    scamScore += 30;
  }

  scamScore = Math.min(100, scamScore);

  const severity: HoneypotFinding["severity"] =
    scamScore >= 60 ? "scam" : scamScore >= 25 ? "suspicious" : "clean";

  return { severity, signals, scamScore };
}
