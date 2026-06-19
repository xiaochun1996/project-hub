export function formatInvokeError(err: unknown): string {
  if (!err) return "未知错误";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  const obj = err as Record<string, unknown>;
  if (typeof obj.message === "string" && obj.message.length > 0) {
    return obj.message;
  }
  if (typeof obj.error === "string" && obj.error.length > 0) {
    return obj.error;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export interface BatchSummary {
  total: number;
  success: number;
  skipped: number;
  failed: number;
  failures: { projectId: string; projectName: string; error: string }[];
}

export function buildBatchSummary(
  projects: { id: string; name: string }[],
  resultSet: { updated?: string[]; pushed?: string[]; skipped?: string[]; failed?: [string, string][] },
): BatchSummary {
  const nameById = new Map(projects.map((p) => [p.id, p.name]));
  const failedEntries = (resultSet.failed ?? []).map(([pid, error]) => ({
    projectId: pid,
    projectName: nameById.get(pid) ?? pid,
    error,
  }));
  const successIds = new Set<string>([
    ...(resultSet.updated ?? []),
    ...(resultSet.pushed ?? []),
  ]);
  const skippedIds = new Set<string>(resultSet.skipped ?? []);
  const failedIds = new Set<string>(failedEntries.map((f) => f.projectId));
  const success = projects.filter((p) => successIds.has(p.id)).length;
  const skipped = projects.filter((p) => skippedIds.has(p.id)).length;
  const failed = projects.filter((p) => failedIds.has(p.id)).length;
  return {
    total: projects.length,
    success,
    skipped,
    failed,
    failures: failedEntries,
  };
}
