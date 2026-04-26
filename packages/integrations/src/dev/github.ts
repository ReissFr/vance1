// GitHubProvider — DevProvider backed by GitHub's REST API v3. Uses the
// OAuth access_token stored on the integration row. GitHub OAuth tokens
// don't expire (only revoke), so no refresh flow needed.

import type {
  DevProvider,
  Repo,
  Issue,
  PullRequest,
  DevNotification,
  CodeHit,
  CommentResult,
  ListIssuesInput,
  ListPullRequestsInput,
  CreateIssueInput,
  CommentInput,
  SearchCodeInput,
} from "./provider";

const API = "https://api.github.com";

export type GitHubCredentials = {
  access_token?: string | null;
  login?: string | null;
  user_id?: number | null;
};

export type GitHubProviderOptions = {
  credentials: GitHubCredentials;
};

export class GitHubProvider implements DevProvider {
  readonly providerName = "github";
  private readonly token: string;

  constructor(opts: GitHubProviderOptions) {
    const token = opts.credentials.access_token;
    if (!token) throw new Error("GitHubProvider: no access_token in credentials");
    this.token = token;
  }

  async listRepos(limit = 30): Promise<Repo[]> {
    const rows = await this.fetch<GHRepo[]>(
      `/user/repos?per_page=${clamp(limit, 1, 100)}&sort=updated`,
    );
    return rows.map(mapRepo);
  }

  async listIssues(input: ListIssuesInput): Promise<Issue[]> {
    const params = new URLSearchParams({
      state: input.state ?? "open",
      per_page: String(clamp(input.limit ?? 30, 1, 100)),
      sort: "updated",
      direction: "desc",
    });
    if (input.labels && input.labels.length > 0) {
      params.set("labels", input.labels.join(","));
    }
    const rows = await this.fetch<GHIssue[]>(
      `/repos/${input.repo}/issues?${params.toString()}`,
    );
    // /issues returns both issues AND pull requests — filter PRs out.
    return rows.filter((r) => !r.pull_request).map(mapIssue);
  }

  async listPullRequests(input: ListPullRequestsInput): Promise<PullRequest[]> {
    const state = input.state === "open" || input.state === "closed" || input.state === "all"
      ? input.state
      : "open";
    const params = new URLSearchParams({
      state,
      per_page: String(clamp(input.limit ?? 30, 1, 100)),
      sort: "updated",
      direction: "desc",
    });
    const rows = await this.fetch<GHPullRequest[]>(
      `/repos/${input.repo}/pulls?${params.toString()}`,
    );
    return rows.map(mapPullRequest);
  }

  async getIssue(repo: string, number: number): Promise<Issue> {
    const row = await this.fetch<GHIssue>(`/repos/${repo}/issues/${number}`);
    return mapIssue(row);
  }

  async createIssue(input: CreateIssueInput): Promise<Issue> {
    const row = await this.fetch<GHIssue>(`/repos/${input.repo}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        body: input.body ?? "",
        labels: input.labels ?? [],
        assignees: input.assignees ?? [],
      }),
    });
    return mapIssue(row);
  }

  async comment(input: CommentInput): Promise<CommentResult> {
    const row = await this.fetch<{ id: number; html_url: string }>(
      `/repos/${input.repo}/issues/${input.number}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body: input.body }),
      },
    );
    return { id: String(row.id), url: row.html_url };
  }

  async listNotifications(limit = 30): Promise<DevNotification[]> {
    const rows = await this.fetch<GHNotification[]>(
      `/notifications?per_page=${clamp(limit, 1, 50)}&all=false`,
    );
    return rows.map((r) => ({
      id: r.id,
      repo: r.repository?.full_name ?? "",
      title: r.subject?.title ?? "",
      type: (r.subject?.type as DevNotification["type"]) ?? "Issue",
      reason: r.reason ?? "",
      url: htmlUrlFromApi(r.subject?.url ?? "") || r.repository?.html_url || "",
      unread: Boolean(r.unread),
      updated_at: r.updated_at ?? null,
    }));
  }

  async searchCode(input: SearchCodeInput): Promise<CodeHit[]> {
    const parts = [input.query];
    if (input.repo) parts.push(`repo:${input.repo}`);
    const q = parts.join(" ");
    const params = new URLSearchParams({
      q,
      per_page: String(clamp(input.limit ?? 20, 1, 100)),
    });
    const body = await this.fetch<{ items: GHCodeHit[] }>(
      `/search/code?${params.toString()}`,
    );
    return (body.items ?? []).map((h) => ({
      repo: h.repository?.full_name ?? "",
      path: h.path,
      url: h.html_url,
      score: h.score ?? 0,
    }));
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...((init?.headers as Record<string, string>) ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub ${init?.method ?? "GET"} ${path} ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }
}

type GHRepo = {
  id: number;
  full_name: string;
  description: string | null;
  html_url: string;
  private: boolean;
  default_branch: string;
  language: string | null;
  updated_at: string | null;
};

type GHLabel = { name: string };
type GHUser = { login: string };

type GHIssue = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: GHUser | null;
  html_url: string;
  labels: GHLabel[];
  assignees: GHUser[];
  created_at: string | null;
  updated_at: string | null;
  comments: number;
  pull_request?: unknown;
};

type GHPullRequest = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  merged_at: string | null;
  user: GHUser | null;
  html_url: string;
  labels: GHLabel[];
  head: { ref: string } | null;
  base: { ref: string } | null;
  draft: boolean;
  created_at: string | null;
  updated_at: string | null;
};

type GHNotification = {
  id: string;
  reason: string;
  unread: boolean;
  updated_at: string | null;
  subject?: { title?: string; type?: string; url?: string };
  repository?: { full_name?: string; html_url?: string };
};

type GHCodeHit = {
  path: string;
  html_url: string;
  score?: number;
  repository?: { full_name?: string };
};

function mapRepo(r: GHRepo): Repo {
  return {
    id: String(r.id),
    full_name: r.full_name,
    description: r.description,
    url: r.html_url,
    private: r.private,
    default_branch: r.default_branch,
    language: r.language,
    updated_at: r.updated_at,
  };
}

function mapIssue(r: GHIssue): Issue {
  return {
    number: r.number,
    title: r.title,
    body: r.body ?? "",
    state: r.state,
    author: r.user?.login ?? null,
    url: r.html_url,
    labels: (r.labels ?? []).map((l) => l.name),
    assignees: (r.assignees ?? []).map((a) => a.login),
    created_at: r.created_at,
    updated_at: r.updated_at,
    comment_count: r.comments ?? 0,
  };
}

function mapPullRequest(r: GHPullRequest): PullRequest {
  const state: PullRequest["state"] =
    r.merged_at ? "merged" : r.state === "closed" ? "closed" : "open";
  return {
    number: r.number,
    title: r.title,
    body: r.body ?? "",
    state,
    author: r.user?.login ?? null,
    url: r.html_url,
    labels: (r.labels ?? []).map((l) => l.name),
    head_branch: r.head?.ref ?? "",
    base_branch: r.base?.ref ?? "",
    draft: r.draft,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Notifications return an API url (api.github.com/...) rather than a browser
// link. Convert issues/PRs to html_urls heuristically.
function htmlUrlFromApi(apiUrl: string): string {
  if (!apiUrl) return "";
  // https://api.github.com/repos/foo/bar/issues/42 -> https://github.com/foo/bar/issues/42
  return apiUrl
    .replace("api.github.com/repos/", "github.com/")
    .replace("api.github.com", "github.com");
}
