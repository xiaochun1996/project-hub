import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowLeft, Plus, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { formatInvokeError } from "@/lib/operations";
import {
  CustomCommand,
  detectProjectCommands,
  getGlobalSettings,
  listProjects,
  Project,
  runInTerminal,
  updateProject,
} from "@/lib/projects";

interface ProjectDetailPageProps {
  onBack: () => void;
}

function ProjectDetailPage({ onBack }: ProjectDetailPageProps) {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [autoCommands, setAutoCommands] = useState<CustomCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [showAddCommand, setShowAddCommand] = useState(false);
  const [newCmdName, setNewCmdName] = useState("");
  const [newCmdCommand, setNewCmdCommand] = useState("");
  const [terminalPreference, setTerminalPreference] = useState<string>("terminal_app");

  useEffect(() => {
    loadProject();
  }, [id]);

  const loadProject = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const projects = await listProjects();
      const p = projects.find((proj) => proj.id === id);
      if (!p) {
        toast({
          title: "项目不存在",
          description: "该项目可能已被移除",
          variant: "destructive",
        });
        onBack();
        return;
      }
      setProject(p);

      // 加载自动探测的命令
      const detected = await detectProjectCommands(p.path);
      setAutoCommands(detected);

      // 加载全局设置中的终端偏好
      try {
        const settings = await getGlobalSettings();
        setTerminalPreference(settings.terminal_preference ?? "terminal_app");
      } catch {
        // 默认使用 Terminal.app
        setTerminalPreference("terminal_app");
      }
    } catch (e) {
      toast({
        title: "加载失败",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const allCommands = [
    ...autoCommands.filter((c) => !c.hidden),
    ...(project?.custom_commands || []),
  ].sort((a, b) => a.sort_order - b.sort_order);

  const handleRunCommand = async (command: CustomCommand) => {
    if (!project) return;
    setRunning(command.name);
    try {
      await runInTerminal(project.path, command.command, terminalPreference);
      toast({
        title: "已启动",
        description: `已在终端中执行: ${command.name}`,
      });
    } catch (e) {
      toast({
        title: "运行失败",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    } finally {
      setRunning(null);
    }
  };

  const handleAddCustomCommand = async () => {
    if (!newCmdName.trim() || !newCmdCommand.trim() || !project) return;

    const newCmd: CustomCommand = {
      name: newCmdName.trim(),
      command: newCmdCommand.trim(),
      source: "manual",
      sort_order: (project.custom_commands?.length || 0) + autoCommands.length,
    };

    const updatedCommands = [...(project.custom_commands || []), newCmd];

    try {
      const updated = await updateProject(project.id, {
        custom_commands: updatedCommands,
      });
      setProject(updated);
      setNewCmdName("");
      setNewCmdCommand("");
      setShowAddCommand(false);
      toast({ title: "命令已添加" });
    } catch (e) {
      toast({
        title: "添加失败",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    }
  };

  const handleDeleteCommand = async (command: CustomCommand) => {
    if (!project || command.source === "auto") return;

    const updatedCommands = (project.custom_commands || []).filter(
      (c) => !(c.name === command.name && c.command === command.command)
    );

    try {
      const updated = await updateProject(project.id, {
        custom_commands: updatedCommands.length > 0 ? updatedCommands : null,
      });
      setProject(updated);
      toast({ title: "命令已删除" });
    } catch (e) {
      toast({
        title: "删除失败",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="text-center text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="px-2">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          <p className="text-sm font-mono text-muted-foreground mt-1">
            {project.path}
          </p>
        </div>
      </div>

      {/* Commands Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>运行命令</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddCommand(!showAddCommand)}
            >
              <Plus className="h-4 w-4 mr-1" />
              添加命令
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {allCommands.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/30 p-8 text-center">
              <div className="text-sm text-muted-foreground">
                未检测到可运行命令
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                点击右上方"添加命令"手动配置，或确保项目包含 package.json / build.gradle
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <span>将使用</span>
                <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs">
                  {terminalPreference === "iterm2" ? "iTerm2" : "Terminal.app"}
                </span>
                <span>执行命令</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
              {allCommands.map((cmd, idx) => (
                <div
                  key={`${cmd.name}-${idx}`}
                  className="flex items-center justify-between gap-3 rounded-md border bg-background p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{cmd.name}</span>
                      {cmd.source === "auto" && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0">
                          auto
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground truncate">
                      {cmd.command}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleRunCommand(cmd)}
                      disabled={running === cmd.name}
                    >
                      <Play className="h-3 w-3 mr-1" />
                      {running === cmd.name ? "运行中..." : "运行"}
                    </Button>
                    {cmd.source === "manual" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteCommand(cmd)}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            </>
          )}

          {/* Add Command Form */}
          {showAddCommand && (
            <div className="rounded-md border bg-muted/20 p-4 space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">名称</label>
                <input
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="如: Dev, Build, Debug APK..."
                  value={newCmdName}
                  onChange={(e) => setNewCmdName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">命令</label>
                <input
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="如: npm run dev, ./gradlew installDebug..."
                  value={newCmdCommand}
                  onChange={(e) => setNewCmdCommand(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleAddCustomCommand}
                  disabled={!newCmdName.trim() || !newCmdCommand.trim()}
                >
                  保存
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowAddCommand(false);
                    setNewCmdName("");
                    setNewCmdCommand("");
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default ProjectDetailPage;
