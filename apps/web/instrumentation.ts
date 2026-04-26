// Next.js 15 instrumentation hook — runs once at server start.
// Captures unhandled rejections and uncaught exceptions server-wide.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportError } = await import("./lib/error-report");

    process.on("unhandledRejection", (reason) => {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      reportError(err, { route: "unhandledRejection", severity: "error" });
    });

    process.on("uncaughtException", (err) => {
      reportError(err, { route: "uncaughtException", severity: "error" });
    });
  }
}

export const onRequestError = async (
  err: unknown,
  request: { path?: string; method?: string },
) => {
  const { reportError } = await import("./lib/error-report");
  await reportError(err, {
    route: request.path,
    method: request.method,
    severity: "error",
  });
};
