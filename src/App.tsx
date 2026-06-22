import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
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
import { OperationProvider, useOperations, useOperationActions } from "@/components/OperationContext";
import ProjectCard from "@/components/ProjectCard";
import AddProjectDialog from "@/components/AddProjectDialog";
import ProjectDetailPage from "@/pages/ProjectDetailPage";
import SettingsDialog from "@/components/SettingsDialog";
import {
  batchPull,
  batchPush,
  batchRefresh,
  refreshSingle,
  Project,
} from "@/lib/projects";
import { buildBatchSummary, formatInvokeError } from "@/lib/operations";
import { ProjectStatus } from "@/lib/git";
import { OpenIssuesResult } from "@/lib/gh";

// Module-level cache — survives component unmount/re-mount across route transitions
let cachedStatusMap: Record<string, ProjectStatus | null> = {};
let cachedIssuesMap: Record<string, OpenIssuesResult | null> = {};
let initialLoadDone = false;

function anomalyScore(
  status: ProjectStatus | null,
  issues: OpenIssuesResult | null,
): number {
  if (!status) return 0;
  if (status.sync_status === "diverged") return -5;
  if (status.sync_status === "need_pull") return -4;
  if (status.working_state === "dirty") return -3;
  if (issues?.status === "ok" && (issues.count ?? 0) > 0) return -2;
  if (status.sync_status === "need_push") return -1;
  return 0;
}

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
  const batchRefreshInFlight = useRef(false);

  const ops = useOperations();
  const actions = useOperationActions();
  const refreshing = ops.globalLoading.refresh;
  const pullingAll = ops.globalLoading.pull;

  const loadProjects = useCallback(async (fullRefresh?: boolean) => {
    const shouldRefresh = fullRefresh ?? !initialLoadDone;

    // Prevent concurrent batch_refresh calls
    if (shouldRefresh) {
      if (batchRefreshInFlight.current) return;
      batchRefreshInFlight.current = true;
      actions.setGlobal("refresh", true);
    }

    try {
      const { listProjects } = await import("@/lib/projects");
      const list = await listProjects();
      setProjects(list);

      if (list.length === 0) {
        setStatusMap({});
        setIssuesMap({});
        cachedStatusMap = {};
        cachedIssuesMap = {};
        setLoaded(true);
        return;
      }

      if (shouldRefresh) {
        const batch = await batchRefresh();
        const newStatusMap: Record<string, ProjectStatus | null> = {};
        const newIssuesMap: Record<string, OpenIssuesResult | null> = {};
        for (const b of batch) {
          newStatusMap[b.id] = b.status ?? null;
          newIssuesMap[b.id] = b.open_issues != null
            ? { status: "ok", count: b.open_issues }
            : { status: "error" as const, error: { code: "CommandFailed" as const, message: "获取失败" } };
        }
        cachedStatusMap = newStatusMap;
        cachedIssuesMap = newIssuesMap;
        setStatusMap(newStatusMap);
        setIssuesMap(newIssuesMap);
        initialLoadDone = true;
      } else {
        // Use cached data, filtered to only include projects that still exist
        const validIds = new Set(list.map((p) => p.id));
        const filteredStatus: Record<string, ProjectStatus | null> = {};
        const filteredIssues: Record<string, OpenIssuesResult | null> = {};
        for (const id of validIds) {
          if (id in cachedStatusMap) filteredStatus[id] = cachedStatusMap[id];
          if (id in cachedIssuesMap) filteredIssues[id] = cachedIssuesMap[id];
        }
        setStatusMap(filteredStatus);
        setIssuesMap(filteredIssues);
      }
    } catch (e) {
      toast({
        title: "加载项目列表失败",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    } finally {
      setLoaded(true);
      if (shouldRefresh) {
        actions.setGlobal("refresh", false);
        batchRefreshInFlight.current = false;
      }
    }
  }, [actions]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleRefreshSingle = useCallback(async (path: string, baseBranch: string | null) => {
    try {
      const result = await refreshSingle(path, baseBranch);
      setStatusMap((prev) => ({ ...prev, [result.id]: result.status ?? null }));
      const issuesResult: OpenIssuesResult = result.open_issues != null
        ? { status: "ok", count: result.open_issues }
        : { status: "error" as const, error: { code: "CommandFailed" as const, message: "获取失败" } };
      setIssuesMap((prev) => ({ ...prev, [result.id]: issuesResult }));
      // Sync cache
      cachedStatusMap[result.id] = result.status ?? null;
      cachedIssuesMap[result.id] = issuesResult;
    } catch (e) {
      toast({
        title: "刷新失败",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    }
  }, []);

  const handleRefreshAll = async () => {
    ops.setGlobal("refresh", true);
    try {
      const batch = await batchRefresh();
      const newStatusMap: Record<string, ProjectStatus | null> = {};
      const newIssuesMap: Record<string, OpenIssuesResult | null> = {};
      for (const b of batch) {
        newStatusMap[b.id] = b.status ?? null;
        newIssuesMap[b.id] = b.open_issues != null
          ? { status: "ok", count: b.open_issues }
          : { status: "error" as const, error: { code: "CommandFailed" as const, message: "获取失败" } };
        ops.clearError(b.id);
      }
      cachedStatusMap = newStatusMap;
      cachedIssuesMap = newIssuesMap;
      setStatusMap(newStatusMap);
      setIssuesMap(newIssuesMap);
      initialLoadDone = true;
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
      await loadProjects(true);
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
      await loadProjects(true);
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

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const scoreA = anomalyScore(statusMap[a.id] ?? null, issuesMap[a.id] ?? null);
      const scoreB = anomalyScore(statusMap[b.id] ?? null, issuesMap[b.id] ?? null);
      return scoreA - scoreB;
    });
  }, [projects, statusMap, issuesMap]);

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
            <SettingsDialog />
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
            {sortedProjects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                status={statusMap[p.id] ?? null}
                issues={issuesMap[p.id] ?? null}
                onRefresh={() => handleRefreshSingle(p.path, p.base_branch)}
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
    <BrowserRouter>
      <OperationProvider>
        <Routes>
          <Route path="/" element={<ProjectListHome />} />
          <Route path="/project/:id" element={<ProjectDetailWrapper />} />
        </Routes>
      </OperationProvider>
    </BrowserRouter>
  );
}

function ProjectDetailWrapper() {
  const navigate = useNavigate();
  return <ProjectDetailPage onBack={() => navigate("/")} />;
}

export default App;
