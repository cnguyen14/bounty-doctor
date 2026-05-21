import type { IssueComment } from "../github.js";

export interface BotSwarmFinding {
  attempts: number;
  uniqueAttempters: number;
  botSignatureMatches: number;
  duplicateWalletGroups: { wallet: string; users: string[] }[];
  knownBotIntegrations: string[];
  slopScore: number;
  attemptList: { user: string; createdAt: string; reason: string }[];
}

const ATTEMPT_PATTERNS = [
  /^\s*\/attempt(?:\s+#?\d+)?/im,
  /^\s*\/claim(?:\s+#?\d+)?/im,
  /\b(?:submitted|opened|created|pushed) (?:a )?(?:PR|pull request)\s*[:#]?\s*#?\d+/i,
  /\bPR (?:ready|submitted|opened)[:.]?\s*#?\d+/i,
  /\b(?:I['']?ll|I will|going to|I am going to|I'm going to|I can|I'd like to) (?:take|work on|implement|fix|submit|pick up|tackle)\b/i,
  /\bclaim this bounty\b/i,
  /\b(?:working on this|wip on this)\b/i,
];

const AI_BOILERPLATE_PATTERNS = [
  /\bPlan(?: for #?\d+)?:\s*\n/i,
  /Implementation plan:\s*\n/i,
  /My Plan:\s*\n/i,
  /^- (?:add|implement|refactor|patch|fix|update|introduce)/im,
  /I['']ll keep (?:this|the diff) (?:narrow|focused|small|scoped)/i,
  /I['']ll (?:keep|take|add|implement|submit) /i,
  /CashClaw autonomous agent/i,
  /AI-assisted contribution prepared with/i,
  /scoped implementation plan/i,
];

const KNOWN_BOT_INTEGRATIONS: { match: RegExp; label: string }[] = [
  { match: /devin-ai-integration/i, label: "Devin AI integration" },
  { match: /CashClaw/i, label: "CashClaw autonomous agent" },
  { match: /algora-pbc/i, label: "algora-pbc bot (expected)" },
  { match: /openhands/i, label: "OpenHands agent" },
  { match: /sweep-ai/i, label: "Sweep AI" },
  { match: /codex/i, label: "OpenAI Codex agent" },
];

const WALLET_PATTERN = /(0x[a-fA-F0-9]{40})/g;

const PR_URL_PATTERN = /github\.com\/[^/]+\/[^/]+\/pull\/\d+/i;
const PR_REFERENCE_PHRASES = /\b(?:submitted|opened|fix|patch|pr|pull request|here|see)\b/i;

function isAttemptComment(body: string, ownerRepoSlug?: string): boolean {
  if (ATTEMPT_PATTERNS.some((re) => re.test(body))) return true;
  const prMatch = body.match(PR_URL_PATTERN);
  if (prMatch) {
    if (ownerRepoSlug && !prMatch[0].toLowerCase().includes(ownerRepoSlug.toLowerCase())) {
      return false;
    }
    if (PR_REFERENCE_PHRASES.test(body)) return true;
  }
  return false;
}

function aiBoilerplateScore(body: string): number {
  let hits = 0;
  for (const re of AI_BOILERPLATE_PATTERNS) {
    if (re.test(body)) hits += 1;
  }
  return hits;
}

export function checkBotSwarm(
  comments: IssueComment[],
  ownerRepoSlug?: string
): BotSwarmFinding {
  const attempters = new Set<string>();
  const attemptList: BotSwarmFinding["attemptList"] = [];
  let botSignatureMatches = 0;
  const walletToUsers = new Map<string, Set<string>>();
  const knownBots = new Set<string>();

  for (const c of comments) {
    const isAttempt = isAttemptComment(c.body, ownerRepoSlug);
    if (isAttempt) {
      attempters.add(c.user.login);
      const reasons: string[] = [];
      const aiHits = aiBoilerplateScore(c.body);
      if (aiHits >= 2) reasons.push(`AI-boilerplate signals: ${aiHits}`);
      botSignatureMatches += aiHits >= 2 ? 1 : 0;
      attemptList.push({
        user: c.user.login,
        createdAt: c.created_at,
        reason: reasons.join("; ") || "—",
      });
    }

    for (const bot of KNOWN_BOT_INTEGRATIONS) {
      if (bot.match.test(c.user.login) || bot.match.test(c.body)) {
        knownBots.add(bot.label);
      }
    }

    const wallets = c.body.match(WALLET_PATTERN);
    if (wallets) {
      for (const w of wallets) {
        if (!walletToUsers.has(w)) walletToUsers.set(w, new Set());
        walletToUsers.get(w)!.add(c.user.login);
      }
    }
  }

  const duplicateWalletGroups = [...walletToUsers.entries()]
    .filter(([, users]) => users.size >= 2)
    .map(([wallet, users]) => ({ wallet, users: [...users] }));

  const attempts = attemptList.length;
  const uniqueAttempters = attempters.size;

  const ratioBotPct = attempts > 0 ? (botSignatureMatches / attempts) * 100 : 0;
  let slopScore = 0;
  slopScore += Math.min(40, ratioBotPct * 0.6);
  slopScore += Math.min(25, attempts);
  slopScore += knownBots.size * 8;
  slopScore += duplicateWalletGroups.length * 10;
  slopScore = Math.min(100, Math.round(slopScore));

  return {
    attempts,
    uniqueAttempters,
    botSignatureMatches,
    duplicateWalletGroups,
    knownBotIntegrations: [...knownBots].filter(
      (l) => l !== "algora-pbc bot (expected)"
    ),
    slopScore,
    attemptList,
  };
}
