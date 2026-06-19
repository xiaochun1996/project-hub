import { useCallback, useEffect, useState } from "react";
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
import ProjectCard from "@/components/ProjectCard";
import AddProjectDialog from "@/components/AddProjectDialog";
import {
  batchPull,
  batchPush,
  batchRefresh,
  Project,
} from "@/lib/projects";
import { getProjectStatus, ProjectStatus } from "@/lib/git";
import { getOpenIssuesCount, OpenIssuesResult } from "@/lib/gh";

function ProjectListHome() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, ProjectStatus | null>>({});
  const [issuesMap, setIssuesMap] = useState<Record<string, OpenIssuesResult | null>>({});
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullingAll, setPullingAll] = useState(false);
  const [pushingAll, setPushingAll] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogMode, setAddDialogMode] = useState<"manual" | "scan">("manual");
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const refreshEach = useCallback(async (list: Project[]) => {
    const results: { id: string; status: ProjectStatus | null; issues: OpenIssuesResult | null }[] = [];
    await Promise.all(
      list.map(async (p) => {
        const [status, issues] = await Promise.allSettled([
          getProjectStatus(p.path, p.base_branch ?? undefined),
          getOpenIssuesCount(p.path),
        ]);
        const s =
          status.status === "fulfilled" ? status.value : null;
        const i =
          issues.status === "fulfilled"
            ? issues.value
            : { status: "error" as const, error: { code: "CommandFailed" as const, message: String(issues.status === "rejected" ? issues.reason : "unknown") } };
        results.push({ id: p.id, status: s, issues: i });
      })
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
    setRefreshing(true);
    try {
      const { listProjects } = await import("@/lib/projects");
      const list = await listProjects();
      setProjects(list);
      setStatusMap(() => {
        const m: Record<string, ProjectStatus | null> = {};
        list.forEach((p) => (m[p.id] = null));
        return m;
      });
      setIssuesMap(() => {
        const m: Record<string, OpenIssuesResult | null> = {};
        list.forEach((p) => (m[p.id] = null));
        return m;
      });
      await refreshEach(list);
    } catch (e) {
      toast({
        title: "加载项目列表失败",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, [refreshEach]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      const list = await batchRefresh();
      const newStatusMap: Record<string, ProjectStatus | null> = {};
      for (const b of list) {
        newStatusMap[b.id] = b.status;
      }
      setStatusMap(newStatusMap);
      const existingIds = new Set(list.map((b) => b.id));
      for (const p of projects) {
        if (!existingIds.has(p.id)) {
          newStatusMap[p.id] = null;
        }
      }
      await refreshEach(projects);
      toast({ title: "已刷新所有项目" });
    } catch (e) {
      toast({
        title: "刷新失败",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handlePullAll = async () => {
    setPullingAll(true);
    try {
      const r = await batchPull();
      toast({
        title: "批量 Pull 完成",
        description: `成功 ${r.updated.length}，跳过 ${r.skipped.length}，失败 ${r.failed.length}`,
      });
      await loadProjects();
    } catch (e) {
      toast({
        title: "批量 Pull 失败",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setPullingAll(false);
    }
  };

  const handlePushAll = async () => {
    setPushConfirmOpen(false);
    setPushingAll(true);
    try {
      const r = await batchPush();
      toast({
        title: "批量 Push 完成",
        description: `成功 ${r.pushed.length}，跳过 ${r.skipped.length}，失败 ${r.failed.length}`,
      });
      await loadProjects();
    } catch (e) {
      toast({
        title: "批量 Push 失败",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setPushingAll(false);
    }
  };

  return (
    <div className="relative">
      <div className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Project Hub</h1>
          <p className="text-sm text-muted-foreground">
            {loaded
              ? `${projects.length} 个项目`
              : "加载中…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
          variant="outline"
          onClick={handleRefreshAll}
          disabled={refreshing}
          >
          {refreshing ? "刷新中…" : "Refresh All"}
          </Button>
          <Button
          variant="outline"
          onClick={handlePullAll}
          disabled={pullingAll}
          >
          {pullingAll ? "Pulling…" : "Pull All"}
          </Button>
          <Button
          variant="secondary"
          onClick={() => setPushConfirmOpen(true)}
          disabled={pushingAll}
          >
          {pushingAll ? "Pushing…" : "Push All"}
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
            即将对所有「Need Push」或「Diverged」的项目执行
            <code className="mx-1">git push</code>
            。是否继续？
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPushConfirmOpen(false)}>
            取消
          </Button>
          <Button onClick={handlePushAll}>确认 Push</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Toaster />
    </div>
  );
}

function App() {
  return <ProjectListHome />;
}

export default App;
