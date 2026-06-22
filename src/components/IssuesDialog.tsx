import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import type { Project } from "@/lib/projects";
import { type IssueInfo, listIssues, closeIssue } from "@/lib/gh";

interface IssuesDialogProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type DialogState =
  | { status: "loading" }
  | { status: "loaded"; issues: IssueInfo[] }
  | { status: "error"; message: string };

function IssuesDialog({ project, open, onOpenChange }: IssuesDialogProps) {
  const [state, setState] = useState<DialogState>({ status: "loading" });
  const [closing, setClosing] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const issues = await listIssues(project.path);
      setState({ status: "loaded", issues });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState({ status: "error", message: msg });
    }
  }, [project.path]);

  useEffect(() => {
    if (open) {
      load();
    } else {
      setClosing(new Set());
    }
  }, [open, load]);

  const handleClose = async (issue: IssueInfo, reason: string) => {
    setClosing((prev) => new Set(prev).add(issue.number));
    try {
      await closeIssue(project.path, issue.number, reason);
      toast({ title: `Issue #${issue.number} closed` });
      setState((prev) => {
        if (prev.status !== "loaded") return prev;
        return {
          status: "loaded",
          issues: prev.issues.filter((i) => i.number !== issue.number),
        };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "操作失败", description: msg, variant: "destructive" });
    } finally {
      setClosing((prev) => {
        const next = new Set(prev);
        next.delete(issue.number);
        return next;
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] w-[640px] max-w-[90vw] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Issues — {project.name}</DialogTitle>
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

        {state.status === "loaded" && state.issues.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No open issues
          </p>
        )}

        {state.status === "loaded" && state.issues.length > 0 && (
          <ul className="space-y-2">
            {state.issues.map((issue) => {
              const busy = closing.has(issue.number);
              return (
                <li
                  key={issue.number}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        #{issue.number}
                      </span>
                      <span className="truncate text-sm">{issue.title}</span>
                      <Badge
                        variant="outline"
                        className="shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700"
                      >
                        Open
                      </Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => handleClose(issue, "completed")}
                    >
                      Close
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => handleClose(issue, "not_planned")}
                    >
                      Skip
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default IssuesDialog;
