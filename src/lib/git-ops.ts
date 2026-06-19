import { invoke } from "@tauri-apps/api/core";

export interface PullResult {
  success: boolean;
  is_dirty: boolean;
  message: string;
}

export interface PushResult {
  success: boolean;
  is_dirty: boolean;
  commits_pushed: number;
  message: string;
}

export interface ProjectStatus {
  working_state: "clean" | "dirty";
  ahead: number;
  behind: number;
  sync_status: "synced" | "need_push" | "need_pull" | "diverged";
  base_branch: string;
}

export interface RefreshResult {
  status: ProjectStatus;
  open_issues: number | null;
}

export async function gitFetch(path: string): Promise<void> {
  return await invoke<void>("git_fetch", { path });
}

export async function gitPull(
  path: string,
  base_branch?: string | null,
): Promise<PullResult> {
  return await invoke<PullResult>("git_pull", {
    path,
    base_branch: base_branch ?? null,
  });
}

export async function gitPush(path: string): Promise<PushResult> {
  return await invoke<PushResult>("git_push", { path });
}

export async function batchRefresh(
  project_ids: string[],
): Promise<Array<[string, RefreshResult]>> {
  return await invoke<Array<[string, RefreshResult]>>("batch_refresh", {
    project_ids,
  });
}

export async function batchPull(
  project_ids: string[],
): Promise<Array<[string, PullResult]>> {
  return await invoke<Array<[string, PullResult]>>("batch_pull", {
    project_ids,
  });
}

export async function batchPush(
  project_ids: string[],
): Promise<Array<[string, PushResult]>> {
  return await invoke<Array<[string, PushResult]>>("batch_push", {
    project_ids,
  });
}
