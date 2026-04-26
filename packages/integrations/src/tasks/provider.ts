// TasksProvider — capability interface for task/issue trackers like Linear
// and Todoist. The shape is intentionally minimal so providers with very
// different concepts (Linear has projects/teams/states; Todoist has
// projects/labels/priority) can both satisfy it. Provider-specific fields
// (team_id, label_ids) are surfaced via a loose metadata object on create.

export interface TasksProvider {
  readonly providerName: string;

  /** List open issues/tasks, most recent first. */
  listIssues(input?: ListTasksInput): Promise<TaskIssue[]>;

  /** Fetch one issue by id. */
  getIssue(id: string): Promise<TaskIssue>;

  /** Create a new issue/task. */
  createIssue(input: CreateTaskInput): Promise<TaskIssue>;

  /** Update title / description / status / assignee / due date. */
  updateIssue(id: string, input: UpdateTaskInput): Promise<TaskIssue>;

  /** Mark an issue as done / completed. */
  closeIssue(id: string): Promise<void>;

  /** Add a comment to an issue. */
  commentOnIssue(id: string, body: string): Promise<void>;

  /** List projects so the brain can pick one. */
  listProjects(): Promise<TaskProject[]>;
}

export type TaskState = "open" | "in_progress" | "done" | "cancelled";

export type TaskIssue = {
  id: string;
  title: string;
  body: string | null;
  state: TaskState;
  url: string | null;
  assignee: string | null;
  project_id: string | null;
  project_name: string | null;
  due_date: string | null;
  priority: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type TaskProject = {
  id: string;
  name: string;
  url: string | null;
};

export type ListTasksInput = {
  state?: TaskState;
  project_id?: string;
  assignee?: "me" | string;
  limit?: number;
};

export type CreateTaskInput = {
  title: string;
  body?: string;
  project_id?: string;
  assignee?: "me" | string;
  priority?: number;
  due_date?: string;
  labels?: string[];
};

export type UpdateTaskInput = {
  title?: string;
  body?: string;
  state?: TaskState;
  project_id?: string;
  assignee?: "me" | string;
  priority?: number;
  due_date?: string;
};
