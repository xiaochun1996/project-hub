import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load as loadStore } from "@tauri-apps/plugin-store";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";

interface Settings {
  theme: string;
  launch_count: number;
}

function App() {
  const [theme, setTheme] = useState<string>("light");
  const [launchCount, setLaunchCount] = useState<number>(0);
  const [jsValue, setJsValue] = useState<string>("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings: Settings = await invoke("get_settings");
        if (cancelled) return;
        setTheme(settings.theme);
        setLaunchCount(settings.launch_count);

        const store = await loadStore("frontend.json");
        const v: string | null = (await store.get("welcome")) as string | null;
        if (cancelled) return;
        setJsValue(v ?? "");
        setLoaded(true);
      } catch (e) {
        console.warn("Tauri invoke or store failed (running in browser?):", e);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBump = async () => {
    try {
      const next: number = await invoke("bump_launch_count");
      setLaunchCount(next);
      toast({
        title: "已更新启动次数",
        description: `当前次数: ${next}`,
      });
    } catch (e) {
      toast({
        title: "操作失败",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleWriteJs = async () => {
    try {
      const store = await loadStore("frontend.json");
      const next = jsValue.length > 0 ? `${jsValue}!` : "hello";
      await store.set("welcome", next);
      await store.save();
      setJsValue(next);
      toast({ title: "JS Store 已保存", description: next });
    } catch (e) {
      toast({
        title: "保存失败",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleReadJs = async () => {
    try {
      const store = await loadStore("frontend.json");
      const v: string | null = (await store.get("welcome")) as string | null;
      setJsValue(v ?? "");
      toast({ title: "JS Store 已读取", description: v ?? "(空)" });
    } catch (e) {
      toast({
        title: "读取失败",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">Project Hub</h1>
          <p className="text-sm text-muted-foreground">
            Tauri + React + Tailwind + Shadcn/ui 脚手架示例
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>应用设置</span>
              <Badge variant="secondary">{loaded ? "已加载" : "加载中"}</Badge>
            </CardTitle>
            <CardDescription>
              通过 Rust 侧的 <code>tauri-plugin-store</code> 读写持久化配置
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">主题</div>
              <Badge variant="outline">{theme}</Badge>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">启动次数</div>
              <Badge variant="default">{launchCount}</Badge>
            </div>
            <div className="sm:col-span-2">
              <Button onClick={handleBump}>+ 增加一次启动次数 (Rust)</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>前端 Store</span>
              <Badge variant="secondary">JS API</Badge>
            </CardTitle>
            <CardDescription>
              通过 <code>@tauri-apps/plugin-store</code> 的 JS API 读写
              <code>frontend.json</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="mb-2 text-sm text-muted-foreground">
                当前值: <code className="font-mono">{jsValue || "(空)"}</code>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={handleReadJs}>
                  读取
                </Button>
                <Button onClick={handleWriteJs}>写入 &quot;!&quot;</Button>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline">查看详情</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Store 详情</DialogTitle>
                      <DialogDescription>
                        前端持久化文件：<code>frontend.json</code>
                      </DialogDescription>
                    </DialogHeader>
                    <div className="rounded-md border bg-muted/40 p-3 font-mono text-sm">
                      {JSON.stringify({ welcome: jsValue }, null, 2)}
                    </div>
                    <DialogFooter>
                      <Button onClick={() => toast({ title: "已确认" })}>
                        确认
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Toaster />
    </main>
  );
}

export default App;
