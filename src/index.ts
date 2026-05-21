import {
  getIssue,
  getRepo,
  getComments,
  listRepoBountyIssues,
  parseGithubUrl,
  hasToken,
} from "./github.js";
import { checkHoneypot } from "./detectors/honeypot.js";
import { checkBotSwarm } from "./detectors/botSwarm.js";
import { checkSaturation } from "./detectors/saturation.js";
import { buildReport, type DiagnosisReport } from "./report.js";

export { hasToken } from "./github.js";
export { formatReport } from "./report.js";
export type { DiagnosisReport } from "./report.js";

export async function diagnose(target: string): Promise<DiagnosisReport> {
  const parsed = parseGithubUrl(target);
  if (!parsed.num) {
    throw new Error(
      `Expected a GitHub issue URL or owner/repo#N, got: ${target}`
    );
  }

  const [issue, repo, comments] = await Promise.all([
    getIssue(parsed.owner, parsed.repo, parsed.num),
    getRepo(parsed.owner, parsed.repo),
    getComments(parsed.owner, parsed.repo, parsed.num),
  ]);

  let repoBountyIssues = undefined;
  try {
    repoBountyIssues = await listRepoBountyIssues(parsed.owner, parsed.repo, 40);
  } catch {
    repoBountyIssues = undefined;
  }

  const honeypot = checkHoneypot({ repo, issue, repoBountyIssues });
  const botSwarm = checkBotSwarm(comments, `${parsed.owner}/${parsed.repo}`);
  const saturation = checkSaturation({
    comments,
    attemptsCount: botSwarm.attempts,
    uniqueAttempters: botSwarm.uniqueAttempters,
    slopScore: botSwarm.slopScore,
    honeypotScamScore: honeypot.scamScore,
  });

  return buildReport({ repo, issue, honeypot, botSwarm, saturation });
}
