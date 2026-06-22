import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
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
import { useOperations } from "@/components/OperationContext";
import {
  openInFinder,
  Project,
  pullProject,
  pushProject,
  removeProject,
  updateProject,
} from "@/lib/projects";
import { formatInvokeError } from "@/lib/operations";
import type { ProjectStatus } from "@/lib/git";
import type { OpenIssuesResult } from "@/lib/gh";
import { ghDisplayLabel } from "@/lib/gh";
import IssuesDialog from "@/components/IssuesDialog";
import DirtyFilesDialog from "@/components/DirtyFilesDialog";
import CommitsDialog, { type CommitsDialogMode } from "@/components/CommitsDialog";

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
  const navigate = useNavigate();
  const [baseBranch, setBaseBranch] = useState<string>(project.base_branch ?? "");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [issuesDialogOpen, setIssuesDialogOpen] = useState(false);
  const [dirtyDialogOpen, setDirtyDialogOpen] = useState(false);
  const [commitsDialogOpen, setCommitsDialogOpen] = useState(false);
  const [commitsMode, setCommitsMode] = useState<CommitsDialogMode>("ahead");
  const ops = useOperations();
  const projectOps = ops.state(project.id);

  const syncMeta = useMemo(() => {
    if (!status) return null;
    return syncStatusMeta(status.sync_status);
  }, [status]);

  const showPull =
    status && (status.sync_status === "need_pull" || status.sync_status === "diverged");
  const showPush =
    status && (status.sync_status === "need_push" || status.sync_status === "diverged");

  const disabled = projectOps.running;

  const handlePull = async () => {
    try {
      await ops.runSingle(project.id, "pull", () => pullProject(project.path, project.base_branch ?? undefined));
      toast({ title: "Pull 完成", description: project.name });
      onRefresh();
    } catch (e) {
      toast({
        title: "Pull 失败",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    }
  };

  const handlePush = async () => {
    try {
      await ops.runSingle(project.id, "push", () => pushProject(project.path));
      toast({ title: "Push 完成", description: project.name });
      onRefresh();
    } catch (e) {
      toast({
        title: "Push 失败",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    }
  };

  const handleOpenFinder = async () => {
    try {
      await openInFinder(project.path);
    } catch (e) {
      toast({
        title: "无法打开",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    }
  };

  const handleOpenIssues = () => {
    setIssuesDialogOpen(true);
  };

  const handleOpenDirty = () => {
    setDirtyDialogOpen(true);
  };

  const handleOpenCommits = (mode: CommitsDialogMode) => {
    setCommitsMode(mode);
    setCommitsDialogOpen(true);
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
        description: formatInvokeError(e),
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
        description: formatInvokeError(e),
        variant: "destructive",
      });
    }
  };

  const handleNavigateToDetail = () => {
    navigate(`/project/${project.id}`);
  };

  const issuesText = issues ? ghDisplayLabel(issues) : "…";

  const hasOpenIssues = issues?.status === "ok" && (issues.count ?? 0) > 0;
  const isDirty = status?.working_state === "dirty";
  const hasAhead = status ? status.ahead > 0 : false;
  const hasBehind = status ? status.behind > 0 : false;

  const cellBase = "space-y-1 rounded-md border px-3 py-2 transition-colors";
  const cellMuted = "bg-muted/30";
  const cellAmber = "bg-amber-50 border-amber-200";
  const cellBlue = "bg-blue-50 border-blue-200";
  const cellClickable = "cursor-pointer hover:brightness-95 active:brightness-90";

  const issuesCls = hasOpenIssues ? cellAmber : cellMuted;
  const workingCls = isDirty ? cellAmber : cellMuted;
  const aheadCls = hasAhead ? cellBlue : cellMuted;
  const behindCls = hasBehind ? cellAmber : cellMuted;

  const borderCls = projectOps.lastError
    ? "border-destructive shadow-[0_0_0_1px_rgba(220,38,38,0.3)]"
    : projectOps.running
      ? "border-blue-400/60"
      : "";

  return (
    <Card
      className={`overflow-hidden transition-colors hover:border-foreground/20 ${borderCls} cursor-pointer`}
      onClick={handleNavigateToDetail}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleNavigateToDetail()}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-semibold tracking-tight">
              {project.name}
            </h3>
            {projectOps.running && (
              <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                {projectOps.currentOp === "pull"
                  ? "Pulling…"
                  : projectOps.currentOp === "push"
                    ? "Pushing…"
                    : "Processing…"}
              </Badge>
            )}
            {projectOps.lastError && (
              <Badge
                variant="outline"
                className="border-destructive/40 bg-destructive/10 text-destructive"
              >
                错误
              </Badge>
            )}
            {syncMeta && (
              <Badge variant="outline" className={`border ${syncMeta.cls}`}>
                {syncMeta.label}
              </Badge>
            )}
          </div>
          <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {project.path}
          </div>
          {projectOps.lastError && (
            <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {projectOps.lastError}
            </div>
          )}
        </div>
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 px-2 text-lg leading-none"
              disabled={disabled}
              onClick={(e) => e.stopPropagation()}
            >
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
          <div
            className={`${cellBase} ${issuesCls} ${cellClickable}`}
            onClick={(e) => { e.stopPropagation(); handleOpenIssues(); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && handleOpenIssues()}
          >
            <div className="text-xs text-muted-foreground">Open Issues</div>
            <div className="text-sm font-semibold">{issuesText}</div>
          </div>
          <div
            className={`${cellBase} ${workingCls} ${isDirty ? cellClickable : ""}`}
            onClick={isDirty ? (e) => { e.stopPropagation(); handleOpenDirty(); } : undefined}
            role={isDirty ? "button" : undefined}
            tabIndex={isDirty ? 0 : undefined}
            onKeyDown={isDirty ? (e) => e.key === "Enter" && handleOpenDirty() : undefined}
          >
            <div className="text-xs text-muted-foreground">Working</div>
            <div className="text-sm font-semibold">
              {status ? (status.working_state === "dirty" ? "Dirty" : "Clean") : "—"}
            </div>
          </div>
          <div
            className={`${cellBase} ${aheadCls} ${hasAhead ? cellClickable : ""}`}
            onClick={hasAhead ? (e) => { e.stopPropagation(); handleOpenCommits("ahead"); } : undefined}
            role={hasAhead ? "button" : undefined}
            tabIndex={hasAhead ? 0 : undefined}
            onKeyDown={hasAhead ? (e) => e.key === "Enter" && handleOpenCommits("ahead") : undefined}
          >
            <div className="text-xs text-muted-foreground">Ahead</div>
            <div className="text-sm font-semibold">{status ? status.ahead : "—"}</div>
          </div>
          <div
            className={`${cellBase} ${behindCls} ${hasBehind ? cellClickable : ""}`}
            onClick={hasBehind ? (e) => { e.stopPropagation(); handleOpenCommits("behind"); } : undefined}
            role={hasBehind ? "button" : undefined}
            tabIndex={hasBehind ? 0 : undefined}
            onKeyDown={hasBehind ? (e) => e.key === "Enter" && handleOpenCommits("behind") : undefined}
          >
            <div className="text-xs text-muted-foreground">Behind</div>
            <div className="text-sm font-semibold">{status ? status.behind : "—"}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => { e.stopPropagation(); onRefresh(); }}
            disabled={disabled}
            title="Refresh"
            className="px-2"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {showPull && (
            <Button size="sm" onClick={(e) => { e.stopPropagation(); handlePull(); }} disabled={disabled}>
              {projectOps.running && projectOps.currentOp === "pull" ? "Pulling…" : "Pull"}
            </Button>
          )}
          {showPush && (
            <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); handlePush(); }} disabled={disabled}>
              {projectOps.running && projectOps.currentOp === "push" ? "Pushing…" : "Push"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleOpenFinder(); }} disabled={disabled}>
            Finder
          </Button>
        </div>
      </CardContent>

      <IssuesDialog
        project={project}
        open={issuesDialogOpen}
        onOpenChange={setIssuesDialogOpen}
      />

      <DirtyFilesDialog
        project={project}
        open={dirtyDialogOpen}
        onOpenChange={setDirtyDialogOpen}
      />

      <CommitsDialog
        project={project}
        mode={commitsMode}
        open={commitsDialogOpen}
        onOpenChange={setCommitsDialogOpen}
      />

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
