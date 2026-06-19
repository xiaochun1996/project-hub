import { invoke } from "@tauri-apps/api/core";

export type WorkingState = "clean" | "dirty";

export type SyncStatus = "synced" | "need_push" | "need_pull" | "diverged";

export interface ProjectStatus {
  working_state: WorkingState;
  ahead: number;
  behind: number;
  sync_status: SyncStatus;
  base_branch: string;
}

export async function getProjectStatus(
  path: string,
  base_branch?: string,
): Promise<ProjectStatus> {
  return await invoke<ProjectStatus>("get_project_status", {
    path,
    base_branch: base_branch ?? null,
  });
}
