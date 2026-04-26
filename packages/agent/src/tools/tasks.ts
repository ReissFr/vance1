// Brain-level tools for tasks/issues via the TasksProvider resolver.
// Works for Linear + Todoist (and future Asana, ClickUp) via the same
// surface.

import { z } from "zod";
import { getTasksProvider } from "@jarvis/integrations";
import { defineTool } from "./types";

const PROVIDERS = ["linear", "todoist"] as const;

const STATE_ENUM = ["open", "in_progress", "done", "cancelled"] as const;

export const tasksListTool = defineTool({
  name: "tasks_list",
  description:
    "List tasks/issues from the user's connected project manager (Linear or Todoist). Default returns open tasks. Use state='done' for completed.",
  schema: z.object({
    state: z.enum(STATE_ENUM).optional(),
    project_id: z.string().optional(),
    assignee: z.string().optional().describe("'me' or a user id — defaults to all"),
    limit: z.number().int().min(1).max(100).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      state: { type: "string", enum: [...STATE_ENUM] },
      project_id: { type: "string" },
      assignee: { type: "string", description: "'me' or a user id" },
      limit: { type: "number" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
  },
  async run(input, ctx) {
    const tasks = await getTasksProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: tasks.providerName,
      tasks: await tasks.listIssues({
        state: input.state,
        project_id: input.project_id,
        assignee: input.assignee,
        limit: input.limit,
      }),
    };
  },
});

export const tasksCreateTool = defineTool({
  name: "tasks_create",
  description:
    "Create a new task/issue. Assigns to 'me' by default. Use labels to tag, priority to rank urgency (Linear: 0=none..4=low; Todoist: 1=p4..4=p1).",
  schema: z.object({
    title: z.string().min(1),
    body: z.string().optional(),
    project_id: z.string().optional(),
    assignee: z.string().optional(),
    priority: z.number().int().min(0).max(4).optional(),
    due_date: z.string().optional().describe("YYYY-MM-DD"),
    labels: z.array(z.string()).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string" },
      project_id: { type: "string" },
      assignee: { type: "string" },
      priority: { type: "number" },
      due_date: { type: "string" },
      labels: { type: "array", items: { type: "string" } },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["title"],
  },
  async run(input, ctx) {
    const tasks = await getTasksProvider(ctx.supabase, ctx.userId, input.provider);
    const issue = await tasks.createIssue({
      title: input.title,
      body: input.body,
      project_id: input.project_id,
      assignee: input.assignee,
      priority: input.priority,
      due_date: input.due_date,
      labels: input.labels,
    });
    return { provider: tasks.providerName, issue };
  },
});

export const tasksUpdateTool = defineTool({
  name: "tasks_update",
  description: "Update an existing task's title, body, status, assignee, priority, or due date.",
  schema: z.object({
    id: z.string().min(1),
    title: z.string().optional(),
    body: z.string().optional(),
    state: z.enum(STATE_ENUM).optional(),
    project_id: z.string().optional(),
    assignee: z.string().optional(),
    priority: z.number().int().min(0).max(4).optional(),
    due_date: z.string().optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      state: { type: "string", enum: [...STATE_ENUM] },
      project_id: { type: "string" },
      assignee: { type: "string" },
      priority: { type: "number" },
      due_date: { type: "string" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["id"],
  },
  async run(input, ctx) {
    const tasks = await getTasksProvider(ctx.supabase, ctx.userId, input.provider);
    const { id, provider: _p, ...patch } = input;
    const issue = await tasks.updateIssue(id, patch);
    return { provider: tasks.providerName, issue };
  },
});

export const tasksCloseTool = defineTool({
  name: "tasks_close",
  description: "Mark a task/issue as done.",
  schema: z.object({
    id: z.string().min(1),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["id"],
  },
  async run(input, ctx) {
    const tasks = await getTasksProvider(ctx.supabase, ctx.userId, input.provider);
    await tasks.closeIssue(input.id);
    return { ok: true, provider: tasks.providerName };
  },
});

export const tasksCommentTool = defineTool({
  name: "tasks_comment",
  description: "Add a comment to an existing task/issue.",
  schema: z.object({
    id: z.string().min(1),
    body: z.string().min(1),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      body: { type: "string" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["id", "body"],
  },
  async run(input, ctx) {
    const tasks = await getTasksProvider(ctx.supabase, ctx.userId, input.provider);
    await tasks.commentOnIssue(input.id, input.body);
    return { ok: true, provider: tasks.providerName };
  },
});

export const tasksProjectsTool = defineTool({
  name: "tasks_projects",
  description: "List projects available in the user's task manager.",
  schema: z.object({
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      provider: { type: "string", enum: [...PROVIDERS] },
    },
  },
  async run(input, ctx) {
    const tasks = await getTasksProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: tasks.providerName,
      projects: await tasks.listProjects(),
    };
  },
});
