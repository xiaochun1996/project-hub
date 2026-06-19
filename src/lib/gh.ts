import { invoke } from "@tauri-apps/api/core";

export type GhErrorCode =
  | "GhNotInstalled"
  | "GhNotAuthenticated"
  | "NotGitHubRepo"
  | "CommandFailed";

export interface GhError {
  code: GhErrorCode;
  message?: string;
}

export interface OpenIssuesResult {
  status: "ok" | "error";
  count?: number;
  error?: GhError;
}

function normalizeGhError(e: unknown): GhError {
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.GhNotInstalled !== "undefined") {
      return { code: "GhNotInstalled" };
    }
    if (typeof obj.GhNotAuthenticated !== "undefined") {
      return { code: "GhNotAuthenticated" };
    }
    if (typeof obj.NotGitHubRepo !== "undefined") {
      return { code: "NotGitHubRepo" };
    }
    if (typeof obj.CommandFailed === "string") {
      return { code: "CommandFailed", message: obj.CommandFailed };
    }
    if (typeof obj.code === "string") {
      return obj as unknown as GhError;
    }
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { code: "CommandFailed", message: msg };
}

export async function getOpenIssuesCount(path: string): Promise<OpenIssuesResult> {
  try {
    const count = (await invoke("get_open_issues_count", { path })) as number;
    return { status: "ok", count };
  } catch (e) {
    return { status: "error", error: normalizeGhError(e) };
  }
}

export function ghErrorMessage(error: GhError): string {
  switch (error.code) {
    case "GhNotInstalled":
      return "需安装 gh CLI";
    case "GhNotAuthenticated":
      return "gh 未登录认证";
    case "NotGitHubRepo":
      return "非 GitHub 仓库";
    case "CommandFailed":
      return error.message ?? "命令执行失败";
  }
}

export function ghDisplayLabel(result: OpenIssuesResult): string {
  if (result.status === "ok" && typeof result.count === "number") {
    return String(result.count);
  }
  if (result.status === "error" && result.error) {
    return ghErrorMessage(result.error);
  }
  return "N/A";
}
