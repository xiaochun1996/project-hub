import { invoke } from "@tauri-apps/api/core";

export interface Project {
  id: string;
  name: string;
  path: string;
  base_branch: string | null;
  added_at: string;
}

export interface ProjectConfig {
  base_branch?: string | null;
  name?: string | null;
}

export async function listProjects(): Promise<Project[]> {
  return await invoke<Project[]>("list_projects");
}

export async function addProject(path: string): Promise<Project> {
  return await invoke<Project>("add_project", { path });
}

export async function removeProject(id: string): Promise<void> {
  return await invoke<void>("remove_project", { id });
}

export async function updateProject(
  id: string,
  config: ProjectConfig,
): Promise<Project> {
  return await invoke<Project>("update_project", { id, config });
}

export async function scanDirectory(path: string): Promise<string[]> {
  return await invoke<string[]>("scan_directory", { path });
}

export async function importProjects(paths: string[]): Promise<Project[]> {
  return await invoke<Project[]>("import_projects", { paths });
}

export interface ProjectBatchStatus {
  id: string;
  status: import("./git").ProjectStatus;
  open_issues: number | null;
}

export interface BatchPullResult {
  updated: string[];
  skipped: string[];
  failed: [string, string][];
}

export interface BatchPushResult {
  pushed: string[];
  skipped: string[];
  failed: [string, string][];
}

export async function batchRefresh(): Promise<ProjectBatchStatus[]> {
  return await invoke<ProjectBatchStatus[]>("batch_refresh");
}

export async function batchPull(): Promise<BatchPullResult> {
  return await invoke<BatchPullResult>("batch_pull");
}

export async function batchPush(): Promise<BatchPushResult> {
  return await invoke<BatchPushResult>("batch_push");
}

export async function pullProject(path: string, baseBranch?: string): Promise<string> {
  return await invoke<string>("pull_project", { path, baseBranch: baseBranch ?? null });
}

export async function pushProject(path: string): Promise<string> {
  return await invoke<string>("push_project", { path });
}

export async function openInFinder(path: string): Promise<void> {
  return await invoke<void>("open_in_finder", { path });
}

export interface GitHubRepoInfo {
  url: string | null;
  owner_repo: string | null;
}

export async function getGitHubRepoUrl(path: string): Promise<GitHubRepoInfo> {
  return await invoke<GitHubRepoInfo>("get_github_repo_url", { path });
}
