import { useEffect, useState } from "react";
import { Settings, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  getGlobalSettings,
  GlobalSettings as GlobalSettingsType,
  updateGlobalSettings,
} from "@/lib/projects";
import { formatInvokeError } from "@/lib/operations";

const TERMINAL_LABELS: Record<string, string> = {
  terminal_app: "Terminal.app（系统终端）",
  iterm2: "iTerm2",
};

function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<GlobalSettingsType>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      loadSettings();
    }
  }, [open]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const s = await getGlobalSettings();
      setSettings(s);
    } catch (e) {
      toast({
        title: "加载设置失败",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      await updateGlobalSettings(settings);
      toast({ title: "设置已保存" });
      setOpen(false);
    } catch (e) {
      toast({
        title: "保存设置失败",
        description: formatInvokeError(e),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="设置">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>全局设置</DialogTitle>
          <DialogDescription>
            配置应用的全局偏好设置。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            加载中...
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Terminal className="h-4 w-4" />
                终端偏好
              </label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={settings.terminal_preference ?? "terminal_app"}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    terminal_preference: e.target.value as "terminal_app" | "iterm2",
                  }))
                }
              >
                <option value="terminal_app">
                  {TERMINAL_LABELS.terminal_app}
                </option>
                <option value="iterm2">{TERMINAL_LABELS.iterm2}</option>
              </select>
              <p className="text-xs text-muted-foreground">
                选择运行命令时使用的终端程序。
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsDialog;
