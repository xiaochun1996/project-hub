import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  addProject,
  importProjects,
  listProjects,
  Project,
  removeProject,
  scanDirectory,
  updateProject,
} from "@/lib/projects";

function ProjectRegistry() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [baseBranchMap, setBaseBranchMap] = useState<Record<string, string>>({});
  const [manualPath, setManualPath] = useState<string>("");
  const [scanPath, setScanPath] = useState<string>("");
  const [scanResults, setScanResults] = useState<string[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    try {
      const list = await listProjects();
      setProjects(list);
      const map: Record<string, string> = {};
      list.forEach((p) => {
        map[p.id] = p.base_branch ?? "";
      });
      setBaseBranchMap(map);
    } catch (e) {
      toast({
        title: "加载项目列表失败",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

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
    try {
      const project = await addProject(path);
      setProjects((prev) => [...prev, project]);
      setBaseBranchMap((prev) => ({ ...prev, [project.id]: "" }));
      setManualPath("");
      toast({ title: "项目已添加", description: project.name });
    } catch (e) {
      toast({
        title: "添加项目失败",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleFolderSelected = () => {
    const input = folderInputRef.current;
    if (!input) return;
    const files = input.files;
    if (!files || files.length === 0) return;
    const first = files[0] as File & { webkitRelativePath?: string };
    const rel = first.webkitRelativePath ?? "";
    const rootName = rel.split("/")[0] ?? "";
    const fullPath =
      (first as unknown as { path?: string }).path ??
      (first as unknown as { fullPath?: string }).fullPath;

    if (fullPath) {
      setManualPath(fullPath.substring(0, fullPath.length - rel.length - 1));
    } else if (rootName) {
      setManualPath(rootName);
      toast({
        title: "请补充完整绝对路径",
        description:
          "浏览器安全限制下无法获取真实绝对路径，请手动补全后点击“添加”",
        variant: "destructive",
      });
    }
    if (input) input.value = "";
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

  const handleImportSelected = async () => {
    const paths = Array.from(selectedPaths);
    if (paths.length === 0) return;
    try {
      const imported = await importProjects(paths);
      toast({
        title: "导入完成",
        description: `导入 ${imported.length} 个项目`,
      });
      refresh();
    } catch (e) {
      toast({
        title: "导入失败",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      toast({ title: "项目已删除" });
    } catch (e) {
      toast({
        title: "删除失败",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleUpdateBaseBranch = async (id: string) => {
    const value = baseBranchMap[id] ?? "";
    try {
      await updateProject(id, {
        base_branch: value.trim() === "" ? null : value,
      });
      toast({ title: "Base Branch 已更新" });
      refresh();
    } catch (e) {
      toast({
        title: "更新失败",
        description: String(e),
        variant: "destructive",
      });
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

  const projectCount = useMemo(() => projects.length, [projects]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>项目管理</span>
            <Badge variant="secondary">
              {loaded ? `${projectCount} 个项目` : "加载中"}
            </Badge>
          </CardTitle>
          <CardDescription>
            通过 <code>tauri-plugin-store</code> 持久化项目列表到{" "}
            <code>projects.json</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is non-standard
              webkitdirectory=""
              directory=""
              multiple
              className="hidden"
              onChange={handleFolderSelected}
            />
            <Button onClick={() => folderInputRef.current?.click()}>
              + 选择文件夹
            </Button>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <input
                className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="或输入本地绝对路径后添加..."
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
              />
              <Button variant="secondary" onClick={handleAddByPath}>
                添加
              </Button>
            </div>
            <Button variant="outline" onClick={refresh}>
              刷新
            </Button>
          </div>

          {projects.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              暂无项目，点击上方按钮添加或通过下方扫描导入
            </div>
          ) : (
            <div className="space-y-3">
              {projects.map((p) => (
                <div
                  key={p.id}
                  className="rounded-md border bg-background p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{p.name}</div>
                      <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                        {p.path}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        added at {p.added_at}
                      </div>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleRemove(p.id)}
                    >
                      删除
                    </Button>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <label className="text-xs text-muted-foreground">
                      Base Branch:
                    </label>
                    <input
                      className="flex h-9 w-40 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                      value={baseBranchMap[p.id] ?? ""}
                      onChange={(e) =>
                        setBaseBranchMap((prev) => ({
                          ...prev,
                          [p.id]: e.target.value,
                        }))
                      }
                      placeholder="main / master / ..."
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleUpdateBaseBranch(p.id)}
                    >
                      保存
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>扫描并批量导入</CardTitle>
          <CardDescription>
            输入父目录路径，将扫描其直接子目录中包含 <code>.git</code> 的项目
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="/path/to/parent/folder"
              value={scanPath}
              onChange={(e) => setScanPath(e.target.value)}
            />
            <Button onClick={handleScan} disabled={scanning}>
              {scanning ? "扫描中..." : "扫描"}
            </Button>
          </div>

          {scanResults.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-muted-foreground">
                  发现 {scanResults.length} 个 Git 子目录
                </div>
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
                  <Button
                    size="sm"
                    onClick={handleImportSelected}
                    disabled={selectedPaths.size === 0}
                  >
                    导入选中 ({selectedPaths.size})
                  </Button>
                </div>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2">
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
                    <span className="font-mono break-all text-xs">{p}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default ProjectRegistry;
