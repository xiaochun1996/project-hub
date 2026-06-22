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
import { type DirtyFile, getDirtyFiles } from "@/lib/git-ops";

interface DirtyFilesDialogProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type DialogState =
  | { status: "loading" }
  | { status: "loaded"; files: DirtyFile[] }
  | { status: "error"; message: string };

function statusLabel(code: string): { label: string; cls: string } {
  const trimmed = code.trim();
  switch (trimmed) {
    case "M":
      return { label: "M", cls: "bg-amber-50 text-amber-700 border-amber-200" };
    case "A":
      return { label: "A", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "D":
      return { label: "D", cls: "bg-red-50 text-red-700 border-red-200" };
    case "R":
      return { label: "R", cls: "bg-blue-50 text-blue-700 border-blue-200" };
    case "??":
      return { label: "?", cls: "bg-gray-100 text-gray-600 border-gray-200" };
    default:
      return { label: trimmed || "?", cls: "bg-gray-100 text-gray-600 border-gray-200" };
  }
}

function DirtyFilesDialog({ project, open, onOpenChange }: DirtyFilesDialogProps) {
  const [state, setState] = useState<DialogState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const files = await getDirtyFiles(project.path);
      setState({ status: "loaded", files });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState({ status: "error", message: msg });
    }
  }, [project.path]);

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] w-[640px] max-w-[90vw] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Dirty Files — {project.name}</DialogTitle>
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

        {state.status === "loaded" && state.files.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Working tree is clean
          </p>
        )}

        {state.status === "loaded" && state.files.length > 0 && (
          <ul className="space-y-1">
            {state.files.map((file, i) => {
              const { label, cls } = statusLabel(file.status);
              return (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-md border px-3 py-1.5"
                >
                  <Badge variant="outline" className={`shrink-0 font-mono text-xs ${cls}`}>
                    {label}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-sm">
                    {file.path}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default DirtyFilesDialog;
