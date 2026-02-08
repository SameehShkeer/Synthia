import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Plus, Save, Settings as SettingsIcon, Trash2, ArrowLeft, Monitor, Play, Square, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { invoke } from "@tauri-apps/api/core";
import type { StreamStatus, DisplayInfo } from "@/types/tauri";
import { cn } from "@/lib/utils";

type StreamSource = {
  id: string;
  name: string;
  protocol: "VNC" | "HLS" | "WebRTC" | "RTSP" | "MJPEG";
  ip: string;
  port: string;
  path: string;
  enabled: boolean;
};

type TerminalTarget = {
  id: string;
  name: string;
  /** Working directory for the terminal shell */
  cwd: string;
  notes?: string;
  enabled: boolean;
};

type McpConn = {
  id: string;
  provider: "Notion" | "Jira" | "Other";
  label: string;
  baseUrl?: string;
  enabled: boolean;
  notes?: string;
};

const seedStreams: StreamSource[] = [
  {
    id: "stream-1",
    name: "IDE_STREAM_FRONTEND",
    protocol: "MJPEG",
    ip: "localhost",
    port: "9100",
    path: "",
    enabled: false,
  },
  {
    id: "stream-2",
    name: "IDE_STREAM_BACKEND",
    protocol: "MJPEG",
    ip: "localhost",
    port: "9101",
    path: "",
    enabled: false,
  },
];

const seedTerminals: TerminalTarget[] = [
  {
    id: "term-1",
    name: "CLAUDE_TERM_BUILD",
    cwd: "", // Empty defaults to $HOME
    notes: "Main development terminal",
    enabled: true,
  },
  {
    id: "term-2",
    name: "CLAUDE_TERM_TESTS",
    cwd: "", // Empty defaults to $HOME
    notes: "Test runner terminal",
    enabled: true,
  },
];

const seedMcps: McpConn[] = [
  {
    id: "mcp-1",
    provider: "Notion",
    label: "Product specs",
    baseUrl: "https://www.notion.so",
    enabled: false,
    notes: "Connect via integration in full build",
  },
  {
    id: "mcp-2",
    provider: "Jira",
    label: "Sprint board",
    baseUrl: "https://your-company.atlassian.net",
    enabled: false,
    notes: "Connect via OAuth in full build",
  },
];

function SectionTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-6 border-l-2 border-primary pl-4">
      <div
        className="text-xl font-display font-black uppercase tracking-tight"
        data-testid="text-settings-title"
      >
        {title}
      </div>
      <div className="mt-1 font-mono text-xs text-muted-foreground" data-testid="text-settings-desc">
        {desc}
      </div>
    </div>
  );
}

function LocalCaptureCard({ onStatusChange }: { onStatusChange: (active: boolean) => void }) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [status, setStatus] = useState<StreamStatus>({
    active: false,
    port: 9100,
    fps: 30,
    quality: 80,
    clients: 0,
    display_id: null,
  });

  useEffect(() => {
    onStatusChange(status.active);
  }, [status.active, onStatusChange]);

  const [selectedDisplayId, setSelectedDisplayId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [config, setConfig] = useState({
    port: 9100,
    fps: 30,
    quality: 80,
  });

  useEffect(() => {
    // Fetch displays and status together, then pick the right selectedDisplayId
    const init = async () => {
      try {
        const [displays, currentStatus] = await Promise.all([
          invoke<DisplayInfo[]>("list_displays"),
          invoke<StreamStatus>("get_stream_status").catch(() => null),
        ]);
        setDisplays(displays);
        if (currentStatus) setStatus(currentStatus);

        // If a stream is active, sync to its display; otherwise default to primary
        if (currentStatus?.active && currentStatus.display_id != null) {
          setSelectedDisplayId(currentStatus.display_id.toString());
        } else {
          const primary = displays.find((d) => d.is_primary);
          if (primary) setSelectedDisplayId(primary.id.toString());
          else if (displays.length > 0) setSelectedDisplayId(displays[0].id.toString());
        }
      } catch (err) {
        console.error("Failed to load displays", err);
        setError("Could not detect displays. Screen capture requires a physical or virtual display.");
      }
    };
    init();

    const interval = setInterval(() => {
      invoke<StreamStatus>("get_stream_status")
        .then((s) => setStatus(s))
        .catch(() => {});
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const newStatus = await invoke<StreamStatus>("start_local_stream", {
        port: config.port,
        fps: config.fps,
        quality: config.quality,
        displayId: parseInt(selectedDisplayId),
      });
      setStatus(newStatus);
    } catch (err) {
      console.error("Start failed", err);
      setError("Failed to start capture server. Check port availability.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    setIsLoading(true);
    try {
      await invoke("stop_local_stream");
      setStatus((prev) => ({ ...prev, active: false }));
    } catch (err) {
      console.error("Stop failed", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisplaySwitch = async (newDisplayId: string) => {
    setSelectedDisplayId(newDisplayId);
    if (!status.active) return;
    // Auto-restart capture on the new display
    setIsLoading(true);
    setError(null);
    try {
      await invoke("stop_local_stream");
      const newStatus = await invoke<StreamStatus>("start_local_stream", {
        port: config.port,
        fps: config.fps,
        quality: config.quality,
        displayId: parseInt(newDisplayId),
      });
      setStatus(newStatus);
    } catch (err) {
      console.error("Display switch failed", err);
      setError("Failed to switch display. Try stopping and restarting.");
    } finally {
      setIsLoading(false);
    }
  };

  const endpointUrl = `ws://127.0.0.1:${status.active ? status.port : config.port}`;

  if (error && displays.length === 0) {
    return null;
  }

  return (
    <div className="border border-border bg-black/40 p-4 mb-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center bg-primary/10 border border-primary/20 text-primary">
            <Monitor className="h-4 w-4" />
          </div>
          <div>
            <div className="font-mono text-sm font-bold uppercase text-primary">
              Local Capture
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                status.active ? "bg-primary animate-pulse" : "bg-muted-foreground"
              )} />
              <span className={cn(
                "font-mono text-[10px] uppercase tracking-widest",
                status.active ? "text-primary" : "text-muted-foreground"
              )}>
                {status.active ? "Streaming" : "Inactive"}
              </span>
            </div>
          </div>
        </div>

        {status.active ? (
          <Button
            variant="destructive"
            size="sm"
            className="rounded-none font-mono text-xs uppercase"
            onClick={handleStop}
            disabled={isLoading}
          >
            <Square className="mr-2 h-3 w-3 fill-current" />
            Stop Capture
          </Button>
        ) : (
          <Button
            className="rounded-none bg-primary text-black font-mono text-xs font-bold uppercase hover:bg-white"
            onClick={handleStart}
            disabled={isLoading || !selectedDisplayId}
          >
            <Play className="mr-2 h-3 w-3 fill-current" />
            Start Capture
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">Source Display</div>
            <Select
              value={selectedDisplayId}
              onValueChange={handleDisplaySwitch}
              disabled={isLoading}
            >
              <SelectTrigger className="rounded-none border-border bg-black font-mono text-xs focus:ring-0 focus:border-primary">
                <SelectValue placeholder="Select display..." />
              </SelectTrigger>
              <SelectContent className="rounded-none border-border bg-card">
                {displays.map((d) => (
                  <SelectItem key={d.id} value={d.id.toString()} className="font-mono text-xs">
                    {d.title} {d.is_primary && "(Primary)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground flex justify-between">
                <span>Quality</span>
                <span className="text-primary">{status.active ? status.quality : config.quality}%</span>
              </div>
              <Slider
                disabled={status.active}
                value={[status.active ? status.quality : config.quality]}
                onValueChange={([v]) => setConfig((prev) => ({ ...prev, quality: v }))}
                min={1}
                max={100}
                step={1}
                className="py-2"
              />
            </div>
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground flex justify-between">
                <span>FPS</span>
                <span className="text-primary">{status.active ? status.fps : config.fps}</span>
              </div>
              <Slider
                disabled={status.active}
                value={[status.active ? status.fps : config.fps]}
                onValueChange={([v]) => setConfig((prev) => ({ ...prev, fps: v }))}
                min={1}
                max={30}
                step={1}
                className="py-2"
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">Port</div>
            <Input
              type="number"
              disabled={status.active}
              value={status.active ? status.port : config.port}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val) && val >= 9100 && val <= 9199) {
                  setConfig((prev) => ({ ...prev, port: val }));
                }
              }}
              min={9100}
              max={9199}
              className="rounded-none border-border bg-black font-mono text-xs focus:border-primary"
            />
          </div>

          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">Endpoint URL</div>
            <div className="flex gap-2">
              <div className="flex-1 px-3 py-2 bg-muted/10 border border-border font-mono text-xs text-muted-foreground truncate select-all">
                {endpointUrl}
              </div>
              <Button
                variant="outline"
                size="icon"
                className="rounded-none border-border hover:bg-white hover:text-black"
                onClick={() => navigator.clipboard.writeText(endpointUrl)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {status.active && (
            <div className="font-mono text-[10px] text-primary pt-1">
              {status.clients} client(s) connected
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 border border-destructive/50 bg-destructive/10 text-destructive font-mono text-xs flex items-center gap-2">
          <div className="h-2 w-2 bg-destructive rounded-full animate-pulse" />
          {error}
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const [streams, setStreams] = useState<StreamSource[]>(seedStreams);
  const [terminals, setTerminals] = useState<TerminalTarget[]>(seedTerminals);
  const [mcps, setMcps] = useState<McpConn[]>(seedMcps);
  const [isLocalCaptureActive, setIsLocalCaptureActive] = useState(false);

  const [draftNotes, setDraftNotes] = useState(
    "In this prototype, settings are stored only in memory.\n\nIn a full build, these would persist and drive real embeds/dispatch to agent terminals and IDE streams.",
  );

  const counts = useMemo(() => {
    return {
      streams: streams.length + (isLocalCaptureActive ? 1 : 0),
      terminals: terminals.length,
      mcps: mcps.length,
    };
  }, [streams, terminals, mcps, isLocalCaptureActive]);

  return (
    <div className="min-h-screen bg-background font-sans selection:bg-primary selection:text-black">
      <div className="scanlines fixed inset-0 z-50 pointer-events-none opacity-20"></div>

      <header className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="grid h-10 w-10 place-items-center bg-primary text-black">
              <SettingsIcon className="h-5 w-5" />
            </div>
            <div>
              <div
                className="text-xl font-display font-black uppercase tracking-tighter"
                data-testid="text-settings-page-title"
              >
                Config // Settings
              </div>
              <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest" data-testid="text-settings-page-subtitle">
                System parameters & endpoints
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/" data-testid="link-back-home">
              <Button
                variant="outline"
                className="rounded-none border-border font-mono text-xs uppercase hover:bg-white hover:text-black"
                data-testid="button-back"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            </Link>

            <Button className="rounded-none bg-primary text-black font-mono text-xs font-bold uppercase hover:bg-white" data-testid="button-save-settings">
              <Save className="mr-2 h-4 w-4" />
              Save Config
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-5 py-8">
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="brutal-border p-4 hover:border-primary transition-colors" data-testid="card-settings-streams">
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Configured Streams</div>
            <div className="mt-1 text-4xl font-display font-black text-primary" data-testid="text-settings-streams-count">
              {counts.streams.toString().padStart(2, '0')}
            </div>
          </div>
          <div className="brutal-border p-4 hover:border-primary transition-colors" data-testid="card-settings-terminals">
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Connected Terminals</div>
            <div className="mt-1 text-4xl font-display font-black text-primary" data-testid="text-settings-terminals-count">
              {counts.terminals.toString().padStart(2, '0')}
            </div>
          </div>
          <div className="brutal-border p-4 hover:border-primary transition-colors" data-testid="card-settings-mcps">
            <div className="font-mono text-[10px] uppercase text-muted-foreground">MCP Bridges</div>
            <div className="mt-1 text-4xl font-display font-black text-primary" data-testid="text-settings-mcps-count">
              {counts.mcps.toString().padStart(2, '0')}
            </div>
          </div>
        </div>

        <div className="brutal-border p-6 bg-card">
          <Tabs defaultValue="streams" className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-muted/20 rounded-none p-0 border border-border mb-8" data-testid="tabs-settings">
              <TabsTrigger value="streams" className="rounded-none font-mono text-xs uppercase data-[state=active]:bg-primary data-[state=active]:text-black h-10" data-testid="tab-settings-streams">
                Streams
              </TabsTrigger>
              <TabsTrigger value="terminals" className="rounded-none font-mono text-xs uppercase data-[state=active]:bg-primary data-[state=active]:text-black h-10" data-testid="tab-settings-terminals">
                Terminals
              </TabsTrigger>
              <TabsTrigger value="mcps" className="rounded-none font-mono text-xs uppercase data-[state=active]:bg-primary data-[state=active]:text-black h-10" data-testid="tab-settings-mcps">
                MCPs
              </TabsTrigger>
            </TabsList>

            <TabsContent value="streams" className="mt-0 space-y-6">
              <div>
                <SectionTitle
                  title="Local Broadcast"
                  desc="Capture this display and stream it to the network via MJPEG."
                />
                <LocalCaptureCard onStatusChange={setIsLocalCaptureActive} />
              </div>

              <Separator className="my-6 opacity-20" />

              <SectionTitle
                title="Remote Feeds"
                desc="Configure external IDE streams and camera feeds to monitor."
              />

              <div className="space-y-4" data-testid="list-streams">
                {streams.map((s) => (
                  <div
                    key={s.id}
                    className="border border-border bg-black/40 p-4"
                    data-testid={`row-stream-${s.id}`}
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-sm font-bold uppercase text-primary" data-testid={`text-stream-name-${s.id}`}>
                          {s.name}
                        </div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground" data-testid={`text-stream-url-${s.id}`}>
                          {s.protocol === "MJPEG"
                            ? `ws://${s.ip}:${s.port}`
                            : `${s.protocol.toLowerCase()}://${s.ip}:${s.port}${s.path}`}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] uppercase text-muted-foreground">Enabled</span>
                          <Switch
                            checked={s.enabled}
                            onCheckedChange={(v) =>
                              setStreams((prev) =>
                                prev.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)),
                              )
                            }
                            data-testid={`switch-stream-${s.id}`}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="rounded-none hover:bg-destructive hover:text-white"
                          onClick={() =>
                            setStreams((prev) => prev.filter((x) => x.id !== s.id))
                          }
                          data-testid={`button-delete-stream-${s.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
                      <div className="md:col-span-2">
                        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">ID / Name</div>
                        <Input
                          value={s.name}
                          onChange={(e) =>
                            setStreams((prev) =>
                              prev.map((x) =>
                                x.id === s.id ? { ...x, name: e.target.value } : x,
                              ),
                            )
                          }
                          className="rounded-none border-border bg-black font-mono text-xs focus:border-primary"
                          data-testid={`input-stream-name-${s.id}`}
                        />
                      </div>

                      <div>
                        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">Protocol</div>
                        <Select
                          value={s.protocol}
                          onValueChange={(v) =>
                            setStreams((prev) =>
                              prev.map((x) =>
                                x.id === s.id ? { ...x, protocol: v as StreamSource["protocol"] } : x,
                              ),
                            )
                          }
                        >
                          <SelectTrigger
                            className="rounded-none border-border bg-black font-mono text-xs focus:ring-0 focus:border-primary"
                            data-testid={`select-stream-protocol-${s.id}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-none border-border bg-card">
                            {(["VNC", "HLS", "WebRTC", "RTSP", "MJPEG"] as const).map((p) => (
                              <SelectItem
                                key={p}
                                value={p}
                                className="rounded-none font-mono text-xs"
                                data-testid={`option-stream-protocol-${s.id}-${p}`}
                              >
                                {p}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">IP Addr</div>
                        <Input
                          value={s.ip}
                          onChange={(e) =>
                            setStreams((prev) =>
                              prev.map((x) =>
                                x.id === s.id ? { ...x, ip: e.target.value } : x,
                              ),
                            )
                          }
                          className="rounded-none border-border bg-black font-mono text-xs focus:border-primary"
                          data-testid={`input-stream-ip-${s.id}`}
                        />
                      </div>

                      <div>
                        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">Port</div>
                        <Input
                          value={s.port}
                          onChange={(e) =>
                            setStreams((prev) =>
                              prev.map((x) =>
                                x.id === s.id ? { ...x, port: e.target.value } : x,
                              ),
                            )
                          }
                          className="rounded-none border-border bg-black font-mono text-xs focus:border-primary"
                          data-testid={`input-stream-port-${s.id}`}
                        />
                      </div>

                      <div className="md:col-span-5">
                        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">Resource Path</div>
                        <Input
                          value={s.path}
                          onChange={(e) =>
                            setStreams((prev) =>
                              prev.map((x) =>
                                x.id === s.id ? { ...x, path: e.target.value } : x,
                              ),
                            )
                          }
                          className="rounded-none border-border bg-black font-mono text-xs focus:border-primary"
                          data-testid={`input-stream-path-${s.id}`}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-dashed border-border">
                <Button
                  variant="outline"
                  className="rounded-none w-full border-dashed border-border hover:border-primary hover:text-primary font-mono text-xs uppercase"
                  onClick={() =>
                    setStreams((prev) => [
                      ...prev,
                      {
                        id: `stream-${Date.now()}`,
                        name: `STREAM_${prev.length + 1}`,
                        protocol: "MJPEG",
                        ip: "",
                        port: "",
                        path: "",
                        enabled: true,
                      },
                    ])
                  }
                  data-testid="button-add-stream"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Stream Resource
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="terminals" className="mt-0 space-y-6">
              <SectionTitle
                title="Terminals"
                desc="Register terminal targets that can receive work packages (mock)."
              />

              <div className="space-y-4" data-testid="list-terminals">
                {terminals.map((t) => (
                  <div
                    key={t.id}
                    className="border border-border bg-black/40 p-4"
                    data-testid={`row-terminal-${t.id}`}
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-sm font-bold uppercase text-primary" data-testid={`text-terminal-name-${t.id}`}>
                          {t.name}
                        </div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground" data-testid={`text-terminal-cwd-${t.id}`}>
                          {t.cwd}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] uppercase text-muted-foreground">Enabled</span>
                          <Switch
                            checked={t.enabled}
                            onCheckedChange={(v) =>
                              setTerminals((prev) =>
                                prev.map((x) => (x.id === t.id ? { ...x, enabled: v } : x)),
                              )
                            }
                            data-testid={`switch-terminal-${t.id}`}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="rounded-none hover:bg-destructive hover:text-white"
                          onClick={() =>
                            setTerminals((prev) => prev.filter((x) => x.id !== t.id))
                          }
                          data-testid={`button-delete-terminal-${t.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">Identifier</div>
                        <Input
                          value={t.name}
                          onChange={(e) =>
                            setTerminals((prev) =>
                              prev.map((x) =>
                                x.id === t.id ? { ...x, name: e.target.value } : x,
                              ),
                            )
                          }
                          className="rounded-none border-border bg-black font-mono text-xs focus:border-primary"
                          data-testid={`input-terminal-name-${t.id}`}
                        />
                      </div>

                      <div>
                        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">Working Directory</div>
                        <Input
                          value={t.cwd}
                          onChange={(e) =>
                            setTerminals((prev) =>
                              prev.map((x) =>
                                x.id === t.id ? { ...x, cwd: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="/path/to/project"
                          className="rounded-none border-border bg-black font-mono text-xs focus:border-primary"
                          data-testid={`input-terminal-cwd-${t.id}`}
                        />
                      </div>

                      <div className="md:col-span-2">
                        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">System Notes</div>
                        <Input
                          value={t.notes ?? ""}
                          onChange={(e) =>
                            setTerminals((prev) =>
                              prev.map((x) =>
                                x.id === t.id ? { ...x, notes: e.target.value } : x,
                              ),
                            )
                          }
                          className="rounded-none border-border bg-black font-mono text-xs focus:border-primary"
                          data-testid={`input-terminal-notes-${t.id}`}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-dashed border-border">
                <Button
                  variant="outline"
                  className="rounded-none w-full border-dashed border-border hover:border-primary hover:text-primary font-mono text-xs uppercase"
                  onClick={() =>
                    setTerminals((prev) => [
                      ...prev,
                      {
                        id: `term-${Date.now()}`,
                        name: `TERMINAL_${prev.length + 1}`,
                        cwd: "",
                        enabled: true,
                      },
                    ])
                  }
                  data-testid="button-add-terminal"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Terminal Node
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="mcps" className="mt-0 space-y-6">
              <SectionTitle
                title="MCP connections"
                desc="Track external tools like Notion/Jira. (Wiring these requires a full build.)"
              />

              <div className="space-y-4" data-testid="list-mcps">
                {mcps.map((m) => (
                  <div
                    key={m.id}
                    className="border border-border bg-black/40 p-4"
                    data-testid={`row-mcp-${m.id}`}
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-sm font-bold uppercase text-primary" data-testid={`text-mcp-label-${m.id}`}>
                          {m.label}
                        </div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground" data-testid={`text-mcp-provider-${m.id}`}>
                          {m.provider}{m.baseUrl ? ` · ${m.baseUrl}` : ""}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] uppercase text-muted-foreground">Enabled</span>
                          <Switch
                            checked={m.enabled}
                            onCheckedChange={(v) =>
                              setMcps((prev) =>
                                prev.map((x) => (x.id === m.id ? { ...x, enabled: v } : x)),
                              )
                            }
                            data-testid={`switch-mcp-${m.id}`}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="rounded-none hover:bg-destructive hover:text-white"
                          onClick={() => setMcps((prev) => prev.filter((x) => x.id !== m.id))}
                          data-testid={`button-delete-mcp-${m.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                      <div>
                        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">Provider</div>
                        <Select
                          value={m.provider}
                          onValueChange={(v) =>
                            setMcps((prev) =>
                              prev.map((x) =>
                                x.id === m.id ? { ...x, provider: v as McpConn["provider"] } : x,
                              ),
                            )
                          }
                        >
                          <SelectTrigger
                            className="rounded-none border-border bg-black font-mono text-xs focus:ring-0 focus:border-primary"
                            data-testid={`select-mcp-provider-${m.id}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-none border-border bg-card">
                            {(["Notion", "Jira", "Other"] as const).map((p) => (
                              <SelectItem key={p} value={p} className="rounded-none font-mono text-xs" data-testid={`option-mcp-provider-${m.id}-${p}`}>
                                {p}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="md:col-span-3">
                        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">Resource Label</div>
                        <Input
                          value={m.label}
                          onChange={(e) =>
                            setMcps((prev) =>
                              prev.map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)),
                            )
                          }
                          className="rounded-none border-border bg-black font-mono text-xs focus:border-primary"
                          data-testid={`input-mcp-label-${m.id}`}
                        />
                      </div>

                      <div className="md:col-span-4">
                        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">Endpoint URL</div>
                        <Input
                          value={m.baseUrl ?? ""}
                          onChange={(e) =>
                            setMcps((prev) =>
                              prev.map((x) => (x.id === m.id ? { ...x, baseUrl: e.target.value } : x)),
                            )
                          }
                          className="rounded-none border-border bg-black font-mono text-xs focus:border-primary"
                          data-testid={`input-mcp-baseurl-${m.id}`}
                        />
                      </div>

                      <div className="md:col-span-4">
                        <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">Integration Notes</div>
                        <Textarea
                          value={m.notes ?? ""}
                          onChange={(e) =>
                            setMcps((prev) =>
                              prev.map((x) => (x.id === m.id ? { ...x, notes: e.target.value } : x)),
                            )
                          }
                          className="rounded-none border-border bg-black font-mono text-xs focus:border-primary min-h-[90px]"
                          data-testid={`input-mcp-notes-${m.id}`}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-dashed border-border flex flex-wrap items-center gap-4">
                <Button
                  variant="outline"
                  className="rounded-none border-dashed border-border hover:border-primary hover:text-primary font-mono text-xs uppercase"
                  onClick={() =>
                    setMcps((prev) => [
                      ...prev,
                      {
                        id: `mcp-${Date.now()}`,
                        provider: "Other",
                        label: `New MCP ${prev.length + 1}`,
                        enabled: false,
                      },
                    ])
                  }
                  data-testid="button-add-mcp"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add MCP Connection
                </Button>

                <div className="ml-auto w-full md:w-[520px]">
                  <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">System Log</div>
                  <Textarea
                    value={draftNotes}
                    onChange={(e) => setDraftNotes(e.target.value)}
                    className="rounded-none border-border bg-black font-mono text-xs focus:border-primary min-h-[90px]"
                    data-testid="input-settings-notes"
                  />
                </div>
              </div>

              <Separator className="my-5 opacity-20" />

              <div className="border border-destructive/30 bg-destructive/5 p-4">
                 <div className="flex items-center gap-2 text-destructive mb-2">
                   <span className="font-mono text-xs font-bold uppercase">System Warning</span>
                 </div>
                 <div className="font-mono text-xs text-muted-foreground">
                    Secure integration with Notion/Jira APIs requires OAuth2 handshake. 
                    This interface is for simulation only.
                 </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
