import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  getGitHubRepoUrl,
  openInFinder,
  Project,
  pullProject,
  pushProject,
  removeProject,
  updateProject,
} from "@/lib/projects";
import type { ProjectStatus } from "@/lib/git";
import type { OpenIssuesResult } from "@/lib/gh";
import { ghDisplayLabel } from "@/lib/gh";

interface ProjectCardProps {
  project: Project;
  status: ProjectStatus | null;
  issues: OpenIssuesResult | null;
  onRefresh: () => void;
  onRemoved: () => void;
}

function syncStatusMeta(status: ProjectStatus["sync_status"]) {
  switch (status) {
    case "synced":
      return { label: "Synced", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" };
    case "need_push":
      return { label: "Need Push", cls: "bg-blue-100 text-blue-700 border-blue-200" };
    case "need_pull":
      return { label: "Need Pull", cls: "bg-amber-100 text-amber-700 border-amber-200" };
    case "diverged":
      return { label: "Diverged", cls: "bg-red-100 text-red-700 border-red-200" };
  }
}

function ProjectCard({
  project,
  status,
  issues,
  onRefresh,
  onRemoved,
}: ProjectCardProps) {
  const [baseBranch, setBaseBranch] = useState<string>(project.base_branch ?? "");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [localPulling, setLocalPulling] = useState(false);
  const [localPushing, setLocalPushing] = useState(false);
  const [githubUrl, setGithubUrl] = useState<string | null>(null);
  const [ghLoading, setGhLoading] = useState(false);

  const syncMeta = useMemo(() => {
    if (!status) return null;
    return syncStatusMeta(status.sync_status);
  }, [status]);

  const showPull =
    status && (status.sync_status === "need_pull" || status.sync_status === "diverged");
  const showPush =
    status && (status.sync_status === "need_push" || status.sync_status === "diverged");

  const handlePull = async () => {
    setLocalPulling(true);
    try {
      await pullProject(project.path);
      toast({ title: "Pull 完成", description: project.name });
      onRefresh();
    } catch (e) {
      toast({
        title: "Pull 失败",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setLocalPulling(false);
    }
  };

  const handlePush = async () => {
    setLocalPushing(true);
    try {
      await pushProject(project.path);
      toast({ title: "Push 完成", description: project.name });
      onRefresh();
    } catch (e) {
      toast({
        title: "Push 失败",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setLocalPushing(false);
    }
  };

  const handleOpenFinder = async () => {
    try {
      await openInFinder(project.path);
    } catch (e) {
      toast({
        title: "无法打开",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleGetGithub = async () => {
    if (githubUrl) {
      window.open(githubUrl, "_blank");
      return;
    }
    setGhLoading(true);
    try {
      const info = await getGitHubRepoUrl(project.path);
      if (info.url) {
        setGithubUrl(info.url);
        window.open(info.url, "_blank");
      } else {
        toast({
          title: "非 GitHub 仓库",
          description: "未检测到 GitHub origin",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: "获取 GitHub 信息失败",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setGhLoading(false);
    }
  };

  const handleOpenIssues = async () => {
    if (githubUrl) {
      window.open(`${githubUrl}/issues`, "_blank");
      return;
    }
    setGhLoading(true);
    try {
      const info = await getGitHubRepoUrl(project.path);
      if (info.url) {
        setGithubUrl(info.url);
        window.open(`${info.url}/issues`, "_blank");
      } else {
        toast({
          title: "非 GitHub 仓库",
          description: "未检测到 GitHub origin",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: "获取 GitHub 信息失败",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setGhLoading(false);
    }
  };

  const handleSaveBaseBranch = async () => {
    try {
      await updateProject(project.id, {
        base_branch: baseBranch.trim() === "" ? null : baseBranch.trim(),
      });
      toast({ title: "Base Branch 已更新" });
      setSettingsOpen(false);
      onRefresh();
    } catch (e) {
      toast({
        title: "更新失败",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleRemove = async () => {
    try {
      await removeProject(project.id);
      toast({ title: "项目已移除", description: project.name });
      setRemoveConfirmOpen(false);
      onRemoved();
    } catch (e) {
      toast({
        title: "移除失败",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const issuesText = issues ? ghDisplayLabel(issues) : "…";

  return (
    <Card className="overflow-hidden transition-colors hover:border-foreground/20">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-semibold tracking-tight">
              {project.name}
            </h3>
            {syncMeta && (
              <Badge
                variant="outline"
                className={`border ${syncMeta.cls}`}
              >
                {syncMeta.label}
              </Badge>
            )}
          </div>
          <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {project.path}
          </div>
        </div>
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="shrink-0 px-2 text-lg leading-none">
              ⋯
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>项目设置 — {project.name}</DialogTitle>
              <DialogDescription>
                修改 Base Branch 或从列表中移除项目。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Base Branch</label>
                <input
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="main / master / ..."
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
              <Button
                variant="destructive"
                onClick={() => setRemoveConfirmOpen(true)}
              >
                移除项目
              </Button>
              <Button onClick={handleSaveBaseBranch}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">Open Issues</div>
            <div className="text-sm font-semibold">{issuesText}</div>
          </div>
          <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">Working</div>
            <div className="text-sm font-semibold">
              {status ? (status.working_state === "dirty" ? "Dirty" : "Clean") : "—"}
            </div>
          </div>
          <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">Ahead</div>
            <div className="text-sm font-semibold">{status ? status.ahead : "—"}</div>
          </div>
          <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">Behind</div>
            <div className="text-sm font-semibold">{status ? status.behind : "—"}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showPull && (
            <Button size="sm" onClick={handlePull} disabled={localPulling}>
              {localPulling ? "Pulling..." : "Pull"}
            </Button>
          )}
          {showPush && (
            <Button size="sm" variant="secondary" onClick={handlePush} disabled={localPushing}>
              {localPushing ? "Pushing..." : "Push"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleOpenFinder}>
            Finder
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleGetGithub}
            disabled={ghLoading}
          >
            GitHub
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleOpenIssues}
            disabled={ghLoading}
          >
            Issues
          </Button>
        </div>
      </CardContent>

      <Dialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认移除项目</DialogTitle>
            <DialogDescription>
              即将从列表中移除「{project.name}」。该操作仅移除列表记录，不会删除本地文件。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveConfirmOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleRemove}>
              移除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default ProjectCard;
