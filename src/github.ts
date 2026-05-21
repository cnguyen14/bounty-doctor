import { execSync } from "node:child_process";

export interface IssueComment {
  id: number;
  user: { login: string };
  body: string;
  created_at: string;
}

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: { name: string }[];
  comments: number;
  created_at: string;
  updated_at: string;
  html_url: string;
  user: { login: string };
}

export interface Repo {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  open_issues_count: number;
  has_issues: boolean;
  archived: boolean;
  pushed_at: string;
  default_branch: string;
}

function getToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execSync("gh auth token", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

const TOKEN = getToken();

async function gh<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "bounty-doctor",
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${path}\n${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function getIssue(owner: string, repo: string, num: number): Promise<Issue> {
  return gh<Issue>(`/repos/${owner}/${repo}/issues/${num}`);
}

export async function getRepo(owner: string, repo: string): Promise<Repo> {
  return gh<Repo>(`/repos/${owner}/${repo}`);
}

export async function getComments(owner: string, repo: string, num: number): Promise<IssueComment[]> {
  const out: IssueComment[] = [];
  let page = 1;
  while (true) {
    const batch = await gh<IssueComment[]>(
      `/repos/${owner}/${repo}/issues/${num}/comments?per_page=100&page=${page}`
    );
    out.push(...batch);
    if (batch.length < 100) break;
    page += 1;
    if (page > 10) break;
  }
  return out;
}

export async function listRepoBountyIssues(
  owner: string,
  repo: string,
  limit = 40
): Promise<Issue[]> {
  const q = encodeURIComponent(
    `repo:${owner}/${repo} label:"💎 Bounty" state:open`
  );
  type SearchResp = { items: Issue[] };
  const data = await gh<SearchResp>(`/search/issues?q=${q}&per_page=${limit}`);
  return data.items;
}

export interface ParsedUrl {
  owner: string;
  repo: string;
  num?: number;
}

export function parseGithubUrl(input: string): ParsedUrl {
  const m = input.match(
    /github\.com\/([^/]+)\/([^/]+?)(?:\/(?:issues|pull)\/(\d+))?(?:[/?#]|$)/
  );
  if (!m) {
    const slash = input.match(/^([^/]+)\/([^/]+?)(?:#(\d+))?$/);
    if (slash) {
      return {
        owner: slash[1]!,
        repo: slash[2]!,
        num: slash[3] ? parseInt(slash[3], 10) : undefined,
      };
    }
    throw new Error(
      `Cannot parse GitHub URL or owner/repo[#issue]: ${input}`
    );
  }
  return {
    owner: m[1]!,
    repo: m[2]!,
    num: m[3] ? parseInt(m[3], 10) : undefined,
  };
}

export function hasToken(): boolean {
  return Boolean(TOKEN);
}
