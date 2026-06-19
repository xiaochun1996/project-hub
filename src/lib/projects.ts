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
