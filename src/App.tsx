import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";
import { OperationProvider, useOperations } from "@/components/OperationContext";
import ProjectCard from "@/components/ProjectCard";
import AddProjectDialog from "@/components/AddProjectDialog";
import {
  batchPull,
  batchPush,
  batchRefresh,
  Project,
} from "@/lib/projects";
import { buildBatchSummary, formatInvokeError } from "@/lib/operations";
import { getProjectStatus, ProjectStatus } from "@/lib/git";
import { getOpenIssuesCount, OpenIssuesResult } from "@/lib/gh";

function ProjectListHome() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, ProjectStatus | null>>({});
  const [issuesMap, setIssuesMap] = useState<Record<string, OpenIssuesResult | null>>({});
  const [loaded, setLoaded] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogMode, setAddDialogMode] = useState<"manual" | "scan">("manual");
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [pushing, setPushing] = useState(false);

  const ops = useOperations();
  const refreshing = ops.globalLoading.refresh;
  const pullingAll = ops.globalLoading.pull;

  const refreshEach = useCallback(async (list: Project[]) => {
    const results: { id: string; status: ProjectStatus | null; issues: OpenIssuesResult | null }[] = [];
    await Promise.all(
      list.map(async (p) => {
        const [status, issues] = await Promise.allSettled([
          getProjectStatus(p.path, p.base_branch ?? undefined),
          getOpenIssuesCount(p.path),
        ]);
        const s = status.status === "fulfilled" ? status.value : null;
        const i =
          issues.status === "fulfilled"
            ? issues.value
            : {
                status: "error" as const,
                error: {
                  code: "CommandFailed" as const,
                  message: formatInvokeError(
                    issues.status === "rejected" ? issues.reason : "unknown",
                  ),
                },
              };
        results.push({ id: p.id, status: s, issues: i });
      }),
    );
    const newStatusMap: Record<string, ProjectStatus | null> = {};
    const newIssuesMap: Record<string, OpenIssuesResult | null> = {};
    for (const r of results) {
      newStatusMap[r.id] = r.status;
      newIssuesMap[r.id] = r.issues;
    }
    setStatusMap((prev) => ({ ...prev, ...newStatusMap }));
    setIssuesMap((prev) => ({ ...prev, ...newIssuesMap }));
  }, []);

  const loadProjects = useCallback(async () => {
    ops.setGlobal("refresh", true);
    try {
      const { listProjects } = await import("@/lib/projects");
      const list = await listProjects();
      setProjects(list);
      const initialStatus: Record<string, ProjectStatus | null> = {};
      const initialIssues: Record<string, OpenIssuesResult | null> = {};
      list.forEach((p) => {
        initialStatus[p.id] = null;
        initialIssues[p.id] = null;
      });
      setStatusMap(initialStatus);
      setIssuesMap(initialIssues);
      await refreshEach(list);
    } catch (e) {
      toast({
        title: "加载项目列表失败",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    } finally {
      setLoaded(true);
      ops.setGlobal("refresh", false);
    }
  }, [refreshEach, ops]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleRefreshAll = async () => {
    ops.setGlobal("refresh", true);
    try {
      const batch = await batchRefresh();
      const newStatusMap: Record<string, ProjectStatus | null> = {};
      for (const b of batch) {
        newStatusMap[b.id] = b.status;
        ops.clearError(b.id);
      }
      setStatusMap(newStatusMap);
      await refreshEach(projects);
      if (batch.length > 0) {
        toast({ title: "已刷新所有项目", description: `共 ${batch.length} 个` });
      }
    } catch (e) {
      toast({
        title: "刷新失败",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    } finally {
      ops.setGlobal("refresh", false);
    }
  };

  const handlePullAll = async () => {
    ops.setGlobal("pull", true);
    try {
      const r = await batchPull();
      const summary = buildBatchSummary(projects, r);
      if (summary.failed > 0) {
        for (const f of summary.failures) {
          ops.completeOp(f.projectId, "pull", f.error);
        }
        toast({
          title: `${summary.failed} 个项目 Pull 失败`,
          description: `成功 ${summary.success}，跳过 ${summary.skipped}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "批量 Pull 完成",
          description: `成功 ${summary.success}，跳过 ${summary.skipped}`,
        });
      }
      await loadProjects();
    } catch (e) {
      toast({
        title: "批量 Pull 失败",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    } finally {
      ops.setGlobal("pull", false);
    }
  };

  const handlePushAll = async () => {
    setPushConfirmOpen(false);
    setPushing(true);
    ops.setGlobal("push", true);
    try {
      const r = await batchPush();
      const summary = buildBatchSummary(projects, r);
      if (summary.failed > 0) {
        for (const f of summary.failures) {
          ops.completeOp(f.projectId, "push", f.error);
        }
        toast({
          title: `${summary.failed} 个项目 Push 失败`,
          description: `成功 ${summary.success}，跳过 ${summary.skipped}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "批量 Push 完成",
          description: `成功 ${summary.success}，跳过 ${summary.skipped}`,
        });
      }
      await loadProjects();
    } catch (e) {
      toast({
        title: "批量 Push 失败",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    } finally {
      setPushing(false);
      ops.setGlobal("push", false);
    }
  };

  const pushPreview = useMemo(() => {
    const entries: { name: string; ahead: number; dirty: boolean }[] = [];
    for (const p of projects) {
      const s = statusMap[p.id];
      if (!s) continue;
      if (s.sync_status === "need_push" || s.sync_status === "diverged") {
        entries.push({ name: p.name, ahead: s.ahead, dirty: s.working_state === "dirty" });
      }
    }
    entries.sort((a, b) => b.ahead - a.ahead);
    return entries;
  }, [projects, statusMap]);

  const dirtyCount = pushPreview.filter((e) => e.dirty).length;

  return (
    <div className="relative">
      <div className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Project Hub</h1>
            <p className="text-sm text-muted-foreground">
              {loaded ? `${projects.length} 个项目` : "加载中…"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={handleRefreshAll} disabled={refreshing}>
              {refreshing ? "刷新中…" : "Refresh All"}
            </Button>
            <Button variant="outline" onClick={handlePullAll} disabled={pullingAll}>
              {pullingAll ? "Pulling…" : "Pull All"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPushConfirmOpen(true)}
              disabled={pushing}
            >
              {pushing ? "Pushing…" : "Push All"}
            </Button>
            <div className="relative">
              <Button
                onClick={() => setAddMenuOpen((v) => !v)}
                onBlur={() => setTimeout(() => setAddMenuOpen(false), 150)}
              >
                + Add
              </Button>
              {addMenuOpen && (
                <div
                  onMouseDown={(e) => e.preventDefault()}
                  className="absolute right-0 top-full z-20 mt-2 w-44 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
                >
                  <button
                    className="flex w-full items-start px-3 py-2 text-left text-sm hover:bg-accent"
                    onMouseDown={() => {
                      setAddDialogMode("manual");
                      setAddDialogOpen(true);
                      setAddMenuOpen(false);
                    }}
                  >
                    手动添加
                  </button>
                  <button
                    className="flex w-full items-start px-3 py-2 text-left text-sm hover:bg-accent"
                    onMouseDown={() => {
                      setAddDialogMode("scan");
                      setAddDialogOpen(true);
                      setAddMenuOpen(false);
                    }}
                  >
                    扫描目录
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <main className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        {projects.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 p-12 text-center">
            <div className="text-2xl font-semibold">还没有项目</div>
            <p className="mt-2 text-sm text-muted-foreground">
              点击右上角「+ Add」添加你的第一个项目。
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button
                onClick={() => {
                  setAddDialogMode("manual");
                  setAddDialogOpen(true);
                }}
              >
                手动添加
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setAddDialogMode("scan");
                  setAddDialogOpen(true);
                }}
              >
                扫描目录
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                status={statusMap[p.id] ?? null}
                issues={issuesMap[p.id] ?? null}
                onRefresh={loadProjects}
                onRemoved={loadProjects}
              />
            ))}
          </div>
        )}
      </main>

      <AddProjectDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdded={loadProjects}
        mode={addDialogMode}
        onModeChange={setAddDialogMode}
      />

      <Dialog open={pushConfirmOpen} onOpenChange={setPushConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认批量 Push</DialogTitle>
            <DialogDescription>
              即将对以下项目执行 <code className="mx-1">git push</code>
              。继续？
            </DialogDescription>
          </DialogHeader>
          {pushPreview.length === 0 ? (
            <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
              当前没有需要 Push 的项目。
            </div>
          ) : (
            <div className="space-y-2">
              <ul className="max-h-60 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-3 text-sm">
                {pushPreview.map((p) => (
                  <li
                    key={p.name}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-background"
                  >
                    <span className="truncate">
                      {p.name}
                      {p.dirty && (
                        <span className="ml-2 text-xs text-amber-600">（有未提交变更）</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      ahead {p.ahead}
                    </span>
                  </li>
                ))}
              </ul>
              {dirtyCount > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  有 {dirtyCount} 个项目存在未提交变更，Push 仅推送已有的 commit。
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPushConfirmOpen(false)}>
              取消
            </Button>
            <Button onClick={handlePushAll} disabled={pushPreview.length === 0}>
              确认 Push {pushPreview.length > 0 ? `(${pushPreview.length})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toaster />
    </div>
  );
}

function App() {
  return (
    <OperationProvider>
      <ProjectListHome />
    </OperationProvider>
  );
}

export default App;
