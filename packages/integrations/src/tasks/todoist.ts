// TodoistProvider — TasksProvider backed by Todoist REST API v2. OAuth
// access tokens (and personal API tokens) do not expire.

import type {
  TasksProvider,
  TaskIssue,
  TaskProject,
  TaskState,
  ListTasksInput,
  CreateTaskInput,
  UpdateTaskInput,
} from "./provider";

const API = "https://api.todoist.com/rest/v2";

export type TodoistCredentials = {
  access_token?: string | null;
  user_id?: string | null;
  user_email?: string | null;
};

export type TodoistProviderOptions = {
  credentials: TodoistCredentials;
};

type TodoistTask = {
  id: string;
  project_id?: string;
  content: string;
  description?: string;
  is_completed?: boolean;
  url?: string;
  due?: { date: string } | null;
  priority?: number;
  created_at?: string;
  assignee_id?: string | null;
};

type TodoistProject = { id: string; name: string; url?: string };

export class TodoistProvider implements TasksProvider {
  readonly providerName = "todoist";
  private readonly token: string;

  constructor(opts: TodoistProviderOptions) {
    const token = opts.credentials.access_token;
    if (!token) throw new Error("TodoistProvider: no access_token in credentials");
    this.token = token;
  }

  async listIssues(input?: ListTasksInput): Promise<TaskIssue[]> {
    const params = new URLSearchParams();
    if (input?.project_id) params.set("project_id", input.project_id);
    const openOnly = !input?.state || input.state === "open" || input.state === "in_progress";
    const path = openOnly ? `/tasks?${params.toString()}` : `/tasks/completed?${params.toString()}`;
    // Todoist doesn't support fetching completed tasks via REST v2 — return
    // open-only for now when state filter is anything but open/in_progress.
    const tasks = openOnly ? await this.fetch<TodoistTask[]>("GET", path) : [];
    const limit = Math.max(1, Math.min(200, input?.limit ?? 50));
    return tasks.slice(0, limit).map(toTaskIssue);
  }

  async getIssue(id: string): Promise<TaskIssue> {
    const task = await this.fetch<TodoistTask>("GET", `/tasks/${id}`);
    return toTaskIssue(task);
  }

  async createIssue(input: CreateTaskInput): Promise<TaskIssue> {
    const body: Record<string, unknown> = {
      content: input.title,
      description: input.body ?? undefined,
      project_id: input.project_id ?? undefined,
      priority: input.priority ?? undefined,
      due_date: input.due_date ?? undefined,
      labels: input.labels ?? undefined,
    };
    const task = await this.fetch<TodoistTask>("POST", "/tasks", body);
    return toTaskIssue(task);
  }

  async updateIssue(id: string, input: UpdateTaskInput): Promise<TaskIssue> {
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body.content = input.title;
    if (input.body !== undefined) body.description = input.body;
    if (input.project_id !== undefined) body.project_id = input.project_id;
    if (input.priority !== undefined) body.priority = input.priority;
    if (input.due_date !== undefined) body.due_date = input.due_date;
    await this.fetch("POST", `/tasks/${id}`, body);
    // Todoist's POST /tasks/{id} returns 204 No Content — re-fetch to return.
    if (input.state === "done") {
      await this.fetch("POST", `/tasks/${id}/close`);
    } else if (input.state === "open" || input.state === "in_progress") {
      await this.fetch("POST", `/tasks/${id}/reopen`);
    }
    return this.getIssue(id);
  }

  async closeIssue(id: string): Promise<void> {
    await this.fetch("POST", `/tasks/${id}/close`);
  }

  async commentOnIssue(id: string, body: string): Promise<void> {
    await this.fetch("POST", "/comments", { task_id: id, content: body });
  }

  async listProjects(): Promise<TaskProject[]> {
    const projects = await this.fetch<TodoistProject[]>("GET", "/projects");
    return (projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      url: p.url ?? null,
    }));
  }

  private async fetch<T = Record<string, unknown>>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Todoist ${method} ${path} ${res.status}: ${text}`);
    }
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  }
}

function toTaskIssue(t: TodoistTask): TaskIssue {
  return {
    id: t.id,
    title: t.content,
    body: t.description ?? null,
    state: t.is_completed ? "done" : "open",
    url: t.url ?? null,
    assignee: t.assignee_id ?? null,
    project_id: t.project_id ?? null,
    project_name: null,
    due_date: t.due?.date ?? null,
    priority: t.priority ?? null,
    created_at: t.created_at ?? null,
    updated_at: t.created_at ?? null,
  };
}
