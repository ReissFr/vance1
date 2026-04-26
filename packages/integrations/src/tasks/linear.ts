// LinearProvider — TasksProvider implementation backed by the Linear
// GraphQL API. Access tokens issued via OAuth2 don't expire unless revoked,
// so no refresh flow is needed here.
//
// Linear has a few concepts we flatten into TasksProvider:
//   • teams — every issue belongs to a team. We pick the user's first team
//     at install time and cache it as default_team_id.
//   • workflow states — "Done" varies per team. We resolve the completion
//     state lazily when closing an issue.
//   • priority — integer 0..4 (0=none, 1=urgent, 4=low). We expose raw.

import type {
  TasksProvider,
  TaskIssue,
  TaskProject,
  TaskState,
  ListTasksInput,
  CreateTaskInput,
  UpdateTaskInput,
} from "./provider";

const API = "https://api.linear.app/graphql";

export type LinearCredentials = {
  access_token?: string | null;
  default_team_id?: string | null;
  user_id?: string | null;
  user_email?: string | null;
  user_name?: string | null;
};

export type LinearProviderOptions = {
  credentials: LinearCredentials;
};

type LinearGqlUser = { id: string; name?: string; email?: string };
type LinearGqlTeam = { id: string; key?: string; name?: string };
type LinearGqlProject = { id: string; name: string; url?: string };
type LinearGqlState = {
  id: string;
  name: string;
  type: "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled";
};
type LinearGqlIssue = {
  id: string;
  identifier?: string;
  title: string;
  description?: string | null;
  url?: string;
  priority?: number;
  dueDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
  assignee?: LinearGqlUser | null;
  project?: LinearGqlProject | null;
  state?: LinearGqlState | null;
};

export class LinearProvider implements TasksProvider {
  readonly providerName = "linear";
  private readonly token: string;
  private readonly defaultTeamId: string | null;
  private readonly userId: string | null;

  constructor(opts: LinearProviderOptions) {
    const token = opts.credentials.access_token;
    if (!token) throw new Error("LinearProvider: no access_token in credentials");
    this.token = token;
    this.defaultTeamId = opts.credentials.default_team_id ?? null;
    this.userId = opts.credentials.user_id ?? null;
  }

  async listIssues(input?: ListTasksInput): Promise<TaskIssue[]> {
    const filterParts: string[] = [];
    if (input?.state) {
      filterParts.push(`state: { type: { eq: "${mapStateToLinearType(input.state)}" } }`);
    }
    if (input?.project_id) {
      filterParts.push(`project: { id: { eq: "${input.project_id}" } }`);
    }
    if (input?.assignee === "me" && this.userId) {
      filterParts.push(`assignee: { id: { eq: "${this.userId}" } }`);
    } else if (input?.assignee) {
      filterParts.push(`assignee: { id: { eq: "${input.assignee}" } }`);
    }
    const filter = filterParts.length ? `filter: { ${filterParts.join(", ")} },` : "";
    const first = Math.max(1, Math.min(100, input?.limit ?? 25));
    const data = await this.gql<{ issues: { nodes: LinearGqlIssue[] } }>(
      `query { issues(${filter} first: ${first}, orderBy: updatedAt) { nodes ${ISSUE_FRAGMENT} } }`,
    );
    return (data.issues.nodes ?? []).map(toTaskIssue);
  }

  async getIssue(id: string): Promise<TaskIssue> {
    const data = await this.gql<{ issue: LinearGqlIssue }>(
      `query Q($id: String!) { issue(id: $id) ${ISSUE_FRAGMENT} }`,
      { id },
    );
    return toTaskIssue(data.issue);
  }

  async createIssue(input: CreateTaskInput): Promise<TaskIssue> {
    const teamId = input.project_id
      ? await this.teamIdForProject(input.project_id)
      : this.defaultTeamId;
    if (!teamId) {
      throw new Error(
        "LinearProvider.createIssue: no team id (default not cached and no project id given)",
      );
    }
    const assigneeId =
      input.assignee === "me" ? this.userId : input.assignee || null;
    const data = await this.gql<{ issueCreate: { success: boolean; issue: LinearGqlIssue } }>(
      `mutation M($input: IssueCreateInput!) { issueCreate(input: $input) { success issue ${ISSUE_FRAGMENT} } }`,
      {
        input: {
          teamId,
          title: input.title,
          description: input.body ?? undefined,
          projectId: input.project_id ?? undefined,
          assigneeId: assigneeId ?? undefined,
          priority: input.priority ?? undefined,
          dueDate: input.due_date ?? undefined,
        },
      },
    );
    return toTaskIssue(data.issueCreate.issue);
  }

  async updateIssue(id: string, input: UpdateTaskInput): Promise<TaskIssue> {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.body !== undefined) patch.description = input.body;
    if (input.project_id !== undefined) patch.projectId = input.project_id;
    if (input.assignee !== undefined) {
      patch.assigneeId = input.assignee === "me" ? this.userId : input.assignee;
    }
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.due_date !== undefined) patch.dueDate = input.due_date;
    if (input.state !== undefined) {
      const stateId = await this.resolveStateId(id, input.state);
      if (stateId) patch.stateId = stateId;
    }
    const data = await this.gql<{ issueUpdate: { success: boolean; issue: LinearGqlIssue } }>(
      `mutation M($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue ${ISSUE_FRAGMENT} } }`,
      { id, input: patch },
    );
    return toTaskIssue(data.issueUpdate.issue);
  }

  async closeIssue(id: string): Promise<void> {
    const stateId = await this.resolveStateId(id, "done");
    if (!stateId) throw new Error("LinearProvider.closeIssue: no completed state found");
    await this.gql(
      `mutation M($id: String!, $sid: String!) { issueUpdate(id: $id, input: { stateId: $sid }) { success } }`,
      { id, sid: stateId },
    );
  }

  async commentOnIssue(id: string, body: string): Promise<void> {
    await this.gql(
      `mutation M($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
      { input: { issueId: id, body } },
    );
  }

  async listProjects(): Promise<TaskProject[]> {
    const data = await this.gql<{ projects: { nodes: LinearGqlProject[] } }>(
      `query { projects(first: 50) { nodes { id name url } } }`,
    );
    return (data.projects.nodes ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      url: p.url ?? null,
    }));
  }

  private async resolveStateId(issueId: string, target: TaskState): Promise<string | null> {
    const data = await this.gql<{
      issue: { team: { states: { nodes: LinearGqlState[] } } };
    }>(
      `query Q($id: String!) { issue(id: $id) { team { states { nodes { id name type } } } } }`,
      { id: issueId },
    );
    const wantedType = mapStateToLinearType(target);
    const states = data.issue?.team?.states?.nodes ?? [];
    const match = states.find((s) => s.type === wantedType);
    return match?.id ?? null;
  }

  private async teamIdForProject(projectId: string): Promise<string | null> {
    const data = await this.gql<{ project: { teams: { nodes: LinearGqlTeam[] } } }>(
      `query Q($id: String!) { project(id: $id) { teams { nodes { id } } } }`,
      { id: projectId },
    );
    return data.project?.teams?.nodes?.[0]?.id ?? this.defaultTeamId;
  }

  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Linear GraphQL ${res.status}: ${text}`);
    }
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) {
      throw new Error(`Linear GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
    }
    if (!json.data) throw new Error("Linear GraphQL: empty response");
    return json.data;
  }
}

const ISSUE_FRAGMENT = `{
  id
  identifier
  title
  description
  url
  priority
  dueDate
  createdAt
  updatedAt
  assignee { id name email }
  project { id name url }
  state { id name type }
}`;

function mapStateToLinearType(s: TaskState): string {
  switch (s) {
    case "open":
      return "unstarted";
    case "in_progress":
      return "started";
    case "done":
      return "completed";
    case "cancelled":
      return "canceled";
  }
}

function mapLinearTypeToState(t?: LinearGqlState["type"]): TaskState {
  switch (t) {
    case "completed":
      return "done";
    case "canceled":
      return "cancelled";
    case "started":
      return "in_progress";
    default:
      return "open";
  }
}

function toTaskIssue(i: LinearGqlIssue): TaskIssue {
  return {
    id: i.id,
    title: i.title,
    body: i.description ?? null,
    state: mapLinearTypeToState(i.state?.type),
    url: i.url ?? null,
    assignee: i.assignee?.name ?? i.assignee?.email ?? null,
    project_id: i.project?.id ?? null,
    project_name: i.project?.name ?? null,
    due_date: i.dueDate ?? null,
    priority: i.priority ?? null,
    created_at: i.createdAt ?? null,
    updated_at: i.updatedAt ?? null,
  };
}
