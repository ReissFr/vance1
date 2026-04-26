import type { Trajectory, TrajectoryStep } from "./types";

// Simple in-turn accumulator: every tool call the brain makes during a turn
// gets appended here. If the turn ends in a "done" stop reason, the captured
// steps become a candidate trajectory for saveSkill(). If the turn errors
// out, we throw the buffer away.
export class TrajectoryRecorder {
  private steps: TrajectoryStep[] = [];
  private toolErrors = 0;
  private readonly maxSteps: number;

  constructor(opts: { maxSteps?: number } = {}) {
    this.maxSteps = opts.maxSteps ?? 20;
  }

  push(tool: string, input: unknown): void {
    if (this.steps.length >= this.maxSteps) return;
    const inputObj =
      input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : { value: input };
    this.steps.push({ tool, input: inputObj });
  }

  markFailure(): void {
    this.toolErrors += 1;
  }

  get errorCount(): number {
    return this.toolErrors;
  }

  get stepCount(): number {
    return this.steps.length;
  }

  // Whether this trajectory is worth saving as a skill. Filters out:
  //   - runs that never called a tool (nothing to replay)
  //   - runs with a single call (covered by existing tools, no saving needed)
  //   - runs that hit errors (don't record broken paths)
  shouldSave(): boolean {
    return this.toolErrors === 0 && this.steps.length >= 2;
  }

  toTrajectory(): Trajectory {
    return { version: 1, steps: [...this.steps] };
  }
}
