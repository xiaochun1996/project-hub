import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  addProject,
  importProjects,
  scanDirectory,
} from "@/lib/projects";

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
  mode: "manual" | "scan";
  onModeChange: (mode: "manual" | "scan") => void;
}

function AddProjectDialog({
  open,
  onOpenChange,
  onAdded,
  mode,
  onModeChange,
}: AddProjectDialogProps) {
  const [manualPath, setManualPath] = useState("");
  const [manualAdding, setManualAdding] = useState(false);
  const [scanPath, setScanPath] = useState("");
  const [scanResults, setScanResults] = useState<string[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);

  const resetAndClose = () => {
    setManualPath("");
    setScanPath("");
    setScanResults([]);
    setSelectedPaths(new Set());
    onOpenChange(false);
  };

  const handleAddByPath = async () => {
    const path = manualPath.trim();
    if (!path) {
      toast({
        title: "请输入路径",
        description: "路径不能为空",
        variant: "destructive",
      });
      return;
    }
    setManualAdding(true);
    try {
      const project = await addProject(path);
      toast({ title: "项目已添加", description: project.name });
      resetAndClose();
      onAdded();
    } catch (e) {
      toast({
        title: "添加项目失败",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setManualAdding(false);
    }
  };

  const handleScan = async () => {
    if (!scanPath.trim()) {
      toast({
        title: "请输入目录",
        description: "扫描目录不能为空",
        variant: "destructive",
      });
      return;
    }
    setScanning(true);
    try {
      const results = await scanDirectory(scanPath.trim());
      setScanResults(results);
      setSelectedPaths(new Set(results));
      toast({
        title: "扫描完成",
        description: `发现 ${results.length} 个 Git 仓库`,
      });
    } catch (e) {
      toast({
        title: "扫描失败",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setScanning(false);
    }
  };

  const togglePath = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleImportSelected = async () => {
    const paths = Array.from(selectedPaths);
    if (paths.length === 0) {
      toast({
        title: "请选择至少一个项目",
        variant: "destructive",
      });
      return;
    }
    setImporting(true);
    try {
      const imported = await importProjects(paths);
      toast({
        title: "导入完成",
        description: `导入 ${imported.length} 个项目`,
      });
      resetAndClose();
      onAdded();
    } catch (e) {
      toast({
        title: "导入失败",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>添加项目</DialogTitle>
          <DialogDescription>
            手动指定路径或扫描父目录批量导入 Git 仓库。
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            variant={mode === "manual" ? "default" : "outline"}
            onClick={() => onModeChange("manual")}
          >
            手动添加
          </Button>
          <Button
            variant={mode === "scan" ? "default" : "outline"}
            onClick={() => onModeChange("scan")}
          >
            扫描目录
          </Button>
        </div>

        {mode === "manual" ? (
          <div className="space-y-3">
            <label className="text-sm font-medium">项目绝对路径</label>
            <input
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="/Users/you/project"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              路径必须是一个有效的 Git 仓库。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="text-sm font-medium">父目录路径</label>
            <div className="flex gap-2">
              <input
                className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="/Users/you/code"
                value={scanPath}
                onChange={(e) => setScanPath(e.target.value)}
              />
              <Button onClick={handleScan} disabled={scanning}>
                {scanning ? "扫描中…" : "扫描"}
              </Button>
            </div>
            {scanResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    发现 {scanResults.length} 个 Git 子目录
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedPaths(new Set(scanResults))}
                    >
                      全选
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedPaths(new Set())}
                    >
                      取消全选
                    </Button>
                  </div>
                </div>
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2">
                  {scanResults.map((p) => (
                    <label
                      key={p}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-background"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPaths.has(p)}
                        onChange={() => togglePath(p)}
                      />
                      <span className="break-all font-mono text-xs">{p}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          {mode === "manual" ? (
            <Button onClick={handleAddByPath} disabled={manualAdding}>
              {manualAdding ? "添加中…" : "添加"}
            </Button>
          ) : (
            <Button
              onClick={handleImportSelected}
              disabled={importing || selectedPaths.size === 0}
            >
              {importing
                ? "导入中…"
                : `导入选中 (${selectedPaths.size})`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AddProjectDialog;
