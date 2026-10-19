// A business error with an HTTP status, a stable code for the client and a Hungarian message for the user.
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isUniqueViolation(e: unknown, target?: string): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: string; meta?: { target?: unknown }; message?: string };
  if (err.code !== "P2002") return false;
  if (!target) return true;
  const t = err.meta?.target;
  const text = Array.isArray(t) ? t.join(",") : String(t ?? "");
  return text.includes(target) || (err.message ?? "").includes(target);
}
