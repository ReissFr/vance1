// DevProvider — capability interface for code hosts (GitHub today; GitLab,
// Bitbucket pluggable). Scope is intentionally read-heavy; destructive ops
// (close issue, merge PR) go through needs_approval at the brain layer.

export interface DevProvider {
  readonly providerName: string;

  /** List repos the authenticated user has access to. */
  listRepos(limit?: number): Promise<Repo[]>;

  /** List issues on a repo, optionally filtered by state. */
  listIssues(input: ListIssuesInput): Promise<Issue[]>;

  /** List pull/merge requests on a repo. */
  listPullRequests(input: ListPullRequestsInput): Promise<PullRequest[]>;

  /** Get a single issue (with body). */
  getIssue(repo: string, number: number): Promise<Issue>;

  /** Create a new issue. */
  createIssue(input: CreateIssueInput): Promise<Issue>;

  /** Comment on an issue or PR (same endpoint on GitHub). */
  comment(input: CommentInput): Promise<CommentResult>;

  /** Recent notifications (unread mentions, review requests, etc.). */
  listNotifications(limit?: number): Promise<DevNotification[]>;

  /** Search repo file content with a free-text query. */
  searchCode(input: SearchCodeInput): Promise<CodeHit[]>;
}

export type Repo = {
  id: string;
  full_name: string; // "owner/repo"
  description: string | null;
  url: string;
  private: boolean;
  default_branch: string;
  language: string | null;
  updated_at: string | null;
};

export type IssueState = "open" | "closed" | "all";

export type Issue = {
  number: number;
  title: string;
  body: string;
  state: IssueState;
  author: string | null;
  url: string;
  labels: string[];
  assignees: string[];
  created_at: string | null;
  updated_at: string | null;
  comment_count: number;
};

export type PullRequest = {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed" | "merged";
  author: string | null;
  url: string;
  labels: string[];
  head_branch: string;
  base_branch: string;
  draft: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type DevNotification = {
  id: string;
  repo: string;
  title: string;
  type: "Issue" | "PullRequest" | "Commit" | "Release" | "Discussion" | string;
  reason: string; // mention, review_requested, assign, etc.
  url: string;
  unread: boolean;
  updated_at: string | null;
};

export type CodeHit = {
  repo: string;
  path: string;
  url: string;
  score: number;
};

export type ListIssuesInput = {
  repo: string; // "owner/name"
  state?: IssueState;
  labels?: string[];
  limit?: number;
};

export type ListPullRequestsInput = {
  repo: string;
  state?: IssueState;
  limit?: number;
};

export type CreateIssueInput = {
  repo: string;
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
};

export type CommentInput = {
  repo: string;
  number: number;
  body: string;
};

export type CommentResult = {
  id: string;
  url: string;
};

export type SearchCodeInput = {
  query: string;
  repo?: string; // optional "owner/name" scope
  limit?: number;
};
