import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Project } from "@/lib/projects";
import {
  type CommitInfo,
  type AheadBehindCommits,
  getAheadBehindCommits,
} from "@/lib/git-ops";

export type CommitsDialogMode = "ahead" | "behind";

interface CommitsDialogProps {
  project: Project;
  mode: CommitsDialogMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type DialogState =
  | { status: "loading" }
  | { status: "loaded"; data: AheadBehindCommits }
  | { status: "error"; message: string };

function CommitsDialog({ project, mode, open, onOpenChange }: CommitsDialogProps) {
  const [state, setState] = useState<DialogState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await getAheadBehindCommits(
        project.path,
        project.base_branch ?? null,
      );
      setState({ status: "loaded", data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState({ status: "error", message: msg });
    }
  }, [project.path, project.base_branch]);

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open, load]);

  const title =
    mode === "ahead"
      ? `Ahead — ${project.name}`
      : `Behind — ${project.name}`;

  const subtitle =
    mode === "ahead"
      ? "本地领先远程的 commits"
      : "远程领先本地的 commits";

  const commits: CommitInfo[] =
    state.status === "loaded"
      ? mode === "ahead"
        ? state.data.ahead
        : state.data.behind
      : [];

  const badgeCls =
    mode === "ahead"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] w-[640px] max-w-[90vw] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </DialogHeader>

        {state.status === "loading" && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Loading...
          </div>
        )}

        {state.status === "error" && (
          <div className="space-y-3 py-4 text-center">
            <p className="text-sm text-destructive">{state.message}</p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </div>
        )}

        {state.status === "loaded" && commits.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {mode === "ahead"
              ? "No local commits ahead of remote"
              : "No remote commits ahead of local"}
          </p>
        )}

        {state.status === "loaded" && commits.length > 0 && (
          <ul className="space-y-1">
            {commits.map((commit) => (
              <li
                key={commit.hash}
                className="flex items-center gap-3 rounded-md border px-3 py-1.5"
              >
                <Badge
                  variant="outline"
                  className={`shrink-0 font-mono text-xs ${badgeCls}`}
                >
                  {commit.hash.slice(0, 7)}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {commit.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default CommitsDialog;
