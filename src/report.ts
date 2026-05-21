import chalk from "chalk";
import type { Issue, Repo } from "./github.js";
import type { HoneypotFinding } from "./detectors/honeypot.js";
import type { BotSwarmFinding } from "./detectors/botSwarm.js";
import type { SaturationFinding } from "./detectors/saturation.js";

export interface DiagnosisReport {
  issue: {
    repo: string;
    number: number;
    title: string;
    url: string;
    createdAt: string;
  };
  honeypot: HoneypotFinding;
  botSwarm: BotSwarmFinding;
  saturation: SaturationFinding;
  verdict: "PASS" | "RACE" | "GRIND" | "AVOID" | "SCAM";
}

export function buildReport(opts: {
  repo: Repo;
  issue: Issue;
  honeypot: HoneypotFinding;
  botSwarm: BotSwarmFinding;
  saturation: SaturationFinding;
}): DiagnosisReport {
  const { repo, issue, honeypot, botSwarm, saturation } = opts;

  let verdict: DiagnosisReport["verdict"] = "GRIND";
  if (honeypot.severity === "scam") verdict = "SCAM";
  else if (saturation.winProbabilityPct >= 70) verdict = "RACE";
  else if (saturation.winProbabilityPct >= 40) verdict = "GRIND";
  else if (saturation.winProbabilityPct >= 20) verdict = "PASS";
  else verdict = "AVOID";

  return {
    issue: {
      repo: repo.full_name,
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      createdAt: issue.created_at,
    },
    honeypot,
    botSwarm,
    saturation,
    verdict,
  };
}

function bar(pct: number, width = 20): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

function colorScore(score: number, invert = false): (s: string) => string {
  const good = invert ? score >= 60 : score <= 25;
  const bad = invert ? score <= 25 : score >= 60;
  if (good) return chalk.green;
  if (bad) return chalk.red;
  return chalk.yellow;
}

const VERDICT_STYLES: Record<DiagnosisReport["verdict"], (s: string) => string> = {
  SCAM: chalk.bgRed.white.bold,
  AVOID: chalk.red.bold,
  PASS: chalk.yellow.bold,
  GRIND: chalk.cyan.bold,
  RACE: chalk.bgGreen.black.bold,
};

const VERDICT_BLURBS: Record<DiagnosisReport["verdict"], string> = {
  SCAM: "Honeypot or fake-bounty farm. Walk away.",
  AVOID: "Already lost. Bot swarm or dead repo. Don't spend time.",
  PASS: "Possible but unfavorable odds. Only attempt if you'd do the work anyway.",
  GRIND: "Tractable with high-quality PR + demo video. Quality wins over speed here.",
  RACE: "Genuinely good shot. Move fast, write a clean PR.",
};

export function formatReport(r: DiagnosisReport): string {
  const lines: string[] = [];
  const verdictStyle = VERDICT_STYLES[r.verdict];

  lines.push("");
  lines.push(chalk.bold.underline(`bounty-doctor diagnosis`));
  lines.push(chalk.gray(r.issue.url));
  lines.push(chalk.bold(`  ${r.issue.repo}#${r.issue.number}`) + chalk.gray(` — ${r.issue.title}`));
  lines.push("");

  lines.push(chalk.bold("Bounty"));
  lines.push(
    `  amount     : ${
      r.saturation.bountyAmountUsd !== null
        ? chalk.greenBright(`$${r.saturation.bountyAmountUsd}`)
        : chalk.gray("(no algora-pbc bounty comment found)")
    }`
  );
  if (r.saturation.daysSinceBountyPosted !== null) {
    lines.push(`  posted     : ${r.saturation.daysSinceBountyPosted} days ago`);
  }
  lines.push("");

  lines.push(chalk.bold("Honeypot check"));
  const hp = r.honeypot;
  const hpColor = colorScore(hp.scamScore);
  lines.push(
    `  scam score : ${hpColor(`${hp.scamScore}/100`)} ${chalk.gray(bar(hp.scamScore))}  (${hp.severity})`
  );
  for (const s of hp.signals) lines.push(`             ${chalk.yellow("•")} ${s}`);
  if (hp.signals.length === 0) lines.push(chalk.gray(`             • no honeypot signals`));
  lines.push("");

  lines.push(chalk.bold("Bot/AI swarm"));
  const bs = r.botSwarm;
  const bsColor = colorScore(bs.slopScore);
  lines.push(
    `  slop score : ${bsColor(`${bs.slopScore}/100`)} ${chalk.gray(bar(bs.slopScore))}`
  );
  lines.push(
    `  attempts   : ${bs.attempts} comments from ${chalk.cyan(bs.uniqueAttempters)} unique users`
  );
  if (bs.botSignatureMatches > 0) {
    lines.push(
      `             ${chalk.yellow("•")} ${bs.botSignatureMatches} attempts match AI-boilerplate patterns`
    );
  }
  if (bs.knownBotIntegrations.length > 0) {
    lines.push(
      `             ${chalk.yellow("•")} known bots seen: ${bs.knownBotIntegrations.join(", ")}`
    );
  }
  if (bs.duplicateWalletGroups.length > 0) {
    for (const g of bs.duplicateWalletGroups) {
      lines.push(
        `             ${chalk.red("•")} shared wallet ${chalk.gray(g.wallet.slice(0, 10) + "…")} used by ${g.users.length} users (${g.users.slice(0, 3).join(", ")}…)`
      );
    }
  }
  lines.push("");

  lines.push(chalk.bold("Win probability"));
  const wp = r.saturation.winProbabilityPct;
  const wpColor = colorScore(wp, true);
  lines.push(`  estimate   : ${wpColor(`${wp}%`)} ${chalk.gray(bar(wp))}`);
  for (const reason of r.saturation.rationale) {
    lines.push(`             ${chalk.cyan("•")} ${reason}`);
  }
  lines.push("");

  lines.push(chalk.bold("Verdict"));
  lines.push(`  ${verdictStyle(`  ${r.verdict}  `)} ${chalk.bold(VERDICT_BLURBS[r.verdict])}`);
  lines.push("");

  return lines.join("\n");
}
