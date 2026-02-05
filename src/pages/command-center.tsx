import { useEffect, useMemo, useState, useCallback } from "react";
import { SYSTEM_STATS_POLL_INTERVAL_MS } from "@/config/constants";
import { SystemStats } from "@/types/tauri";
import { invoke } from "@tauri-apps/api/core";
import { Link } from "wouter";
import { TerminalNode } from "@/components/terminal-node";
import {
  ChevronDown,
  Expand,
  PanelsTopLeft,
  Send,
  Settings as SettingsIcon,
  TerminalSquare,
  AlertTriangle,
  Activity,
  Radio,
  Wifi,
  Zap,
  Plus,
  Trash2,
  PanelRightClose,
  PanelRightOpen,
  ScrollText,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator as _Separator } from "@/components/ui/separator";
import _logo from "@/assets/images/synthia-logo.png";

type PanelKind = "terminal" | "stream";

type WorkspacePanel = {
  id: string;
  kind: PanelKind;
  title: string;
  subtitle?: string;
  status?: "idle" | "running" | "attention";
  endpoint?: string;
  activeWorkItemId?: string;
};

type WorkItem = {
  id: string;
  title: string;
  desc: string;
  status: "planned" | "in-progress" | "done";
  owner?: string;
  target?: { kind: PanelKind; panelId: string };
};

type ChatMessage = {
  id: string;
  role: "planner" | "user";
  content: string;
  ts: string;
};

const MOCK_PANELS: WorkspacePanel[] = [
  {
    id: "term-claude-1",
    kind: "terminal",
    title: "CLAUDE_TERM_BUILD",
    subtitle: "ssh synthia@10.0.0.21",
    status: "running",
    endpoint: "/home/synthia/build",
  },
  {
    id: "term-claude-2",
    kind: "terminal",
    title: "CLAUDE_TERM_TESTS",
    subtitle: "ssh synthia@10.0.0.22",
    status: "idle",
    endpoint: "/home/synthia/tests",
  },
  {
    id: "stream-ide-1",
    kind: "stream",
    title: "IDE_STREAM_FRONTEND",
    subtitle: "HLS/RTSP gateway",
    status: "running",
    endpoint: "http://10.0.0.30:8080/live/frontend.m3u8",
  },
  {
    id: "stream-ide-2",
    kind: "stream",
    title: "IDE_STREAM_BACKEND",
    subtitle: "WebRTC/HLS",
    status: "attention",
    endpoint: "http://10.0.0.31:8080/live/backend.m3u8",
  },
];

const INITIAL_PLAN: WorkItem[] = [
  {
    id: "WI-001",
    title: "Define domain model + bounded contexts",
    desc: "Identify services, data contracts, and integration boundaries for enterprise-ready delivery.",
    status: "done",
    owner: "Planner",
  },
  {
    id: "WI-002",
    title: "Build UI shell for Mission Control",
    desc: "Cockpit layout: streams, terminals, planner chat, plan board, dispatch actions.",
    status: "in-progress",
    owner: "Synthia",
  },
  {
    id: "WI-003",
    title: "Add stream registry + health status",
    desc: "Configure endpoints, validate reachability, display states + last seen.",
    status: "planned",
  },
  {
    id: "WI-004",
    title: "Dispatch work packages to agents",
    desc: "Assign items to terminals/IDEs with handoff payloads and acknowledgement UI.",
    status: "planned",
  },
];

const INITIAL_CHAT: ChatMessage[] = [
  {
    id: "m1",
    role: "planner",
    content:
      "Planning module initialized. Awaiting context and constraints for work package generation.",
    ts: "00:00:01",
  },
];

function StatusIndicator({ status }: { status?: WorkspacePanel["status"] }) {
  const color =
    status === "running"
      ? "text-primary"
      : status === "attention"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <div className="flex items-center gap-2 uppercase tracking-wider text-[10px] font-bold" data-testid="status-panel">
      <div className={`h-1.5 w-1.5 ${status === 'running' ? 'animate-pulse' : ''} ${status === 'running' ? 'bg-primary' : status === 'attention' ? 'bg-destructive' : 'bg-muted-foreground'}`} />
      <span className={color}>{status || "IDLE"}</span>
    </div>
  );
}

function PanelCard({
  panel,
  onMaximize,
  onDispatch,
  onRemove,
}: {
  panel: WorkspacePanel;
  onMaximize: (id: string) => void;
  onDispatch: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const icon = panel.kind === "terminal" ? TerminalSquare : PanelsTopLeft;
  const Icon = icon;

  return (
    <div
      className="corner-brackets brutal-border group relative overflow-hidden bg-card transition-all"
      data-testid={`card-workspace-${panel.id}`}
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/10 p-2 relative z-10">
        <div className="flex items-center gap-2">
          <div className="grid h-6 w-6 place-items-center bg-primary/10 border border-primary/20 text-primary">
            <Icon className="h-3 w-3" />
          </div>
          <span className="font-mono text-xs font-bold uppercase tracking-tight text-foreground/90 group-hover:text-primary transition-colors" data-testid={`text-title-${panel.id}`}>
            {panel.title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <StatusIndicator status={panel.status} />
          <button
            onClick={() => onMaximize(panel.id)}
            className="text-muted-foreground hover:text-primary hover:scale-110 transition-transform"
            data-testid={`button-maximize-${panel.id}`}
          >
            <Expand className="h-3 w-3" />
          </button>
          <button
            onClick={() => onRemove(panel.id)}
            className="text-muted-foreground hover:text-destructive hover:scale-110 transition-transform"
            data-testid={`button-remove-${panel.id}`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="p-2 relative z-10">
        <div
          className={`relative w-full overflow-hidden border border-border bg-black group-hover:border-primary/30 transition-colors flex flex-col ${panel.kind === "terminal" ? "h-[240px]" : "aspect-video"}`}
          data-testid={`viewport-${panel.id}`}
        >
          {panel.kind === "terminal" ? (
            <TerminalNode
              sessionId={`terminal-${panel.id}`}
              className="flex-1 min-h-0"
            />
          ) : (
            <>
              {/* Scanline overlay for viewport */}
              <div className="pointer-events-none absolute inset-0 opacity-10 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAuMDUiLz4KPC9zdmc+')]"></div>

              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <div className="font-mono text-xs uppercase text-muted-foreground tracking-widest mb-2 flex items-center justify-center gap-2">
                    <Wifi className="h-3 w-3 animate-pulse" />
                    NO_SIGNAL
                  </div>
                  <div className="font-mono text-[10px] text-primary/50 border border-primary/20 px-2 py-1 inline-block" data-testid={`text-endpoint-${panel.id}`}>
                    {panel.endpoint || "::1"}
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex items-center justify-between bg-black/90 p-1 border-t border-border shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="font-mono text-[9px] text-primary/80 uppercase tracking-widest pl-1"
                data-testid={`badge-kind-${panel.id}`}
              >
                SYS::{panel.kind.toUpperCase()}
              </div>

              {panel.activeWorkItemId && (
                <div
                  className="inline-flex items-center gap-1 max-w-[160px] border border-primary/30 bg-primary/10 px-1.5 py-0.5"
                  data-testid={`badge-working-${panel.id}`}
                  title={`Working on ${panel.activeWorkItemId}`}
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="font-mono text-[9px] uppercase tracking-widest text-primary truncate">
                    WI::{panel.activeWorkItemId}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={() => onDispatch(panel.id)}
              className="flex items-center gap-1 bg-primary px-2 py-0.5 font-mono text-[9px] font-bold text-black hover:bg-white hover:text-black transition-colors uppercase tracking-wider"
              data-testid={`button-dispatch-${panel.id}`}
            >
              <Send className="h-2 w-2" />
              Dispatch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkItemRow({
  item,
  panels,
  onAssign,
}: {
  item: WorkItem;
  panels: WorkspacePanel[];
  onAssign: (itemId: string, target: WorkItem["target"]) => void;
}) {
  const statusColor =
    item.status === "done"
      ? "text-primary border-primary/30 bg-primary/5"
      : item.status === "in-progress"
        ? "text-accent border-accent/30 bg-accent/5"
        : "text-muted-foreground border-border bg-transparent";

  return (
    <div
      className="group border-b border-border p-3 hover:bg-muted/10 transition-colors relative"
      data-testid={`row-workitem-${item.id}`}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-transparent group-hover:bg-primary transition-colors"></div>
      <div className="flex items-start justify-between gap-4 pl-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className={`font-mono text-[9px] font-bold uppercase border px-1.5 py-0.5 ${statusColor}`} data-testid={`status-workitem-${item.id}`}>
              {item.status}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/70">
              //{item.id}
            </span>
          </div>

          <div className="font-bold text-sm tracking-tight mb-1 text-foreground group-hover:text-primary transition-colors" data-testid={`text-workitem-title-${item.id}`}>
            {item.title}
          </div>
          <div className="text-xs text-muted-foreground font-mono leading-relaxed opacity-70" data-testid={`text-workitem-desc-${item.id}`}>
            {item.desc}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <Select
            onValueChange={(v) => {
              const p = panels.find((x) => x.id === v);
              if (!p) return;
              onAssign(item.id, { kind: p.kind, panelId: p.id });
            }}
          >
            <SelectTrigger
              className="h-6 w-[160px] rounded-none border-border bg-background text-[10px] uppercase font-mono focus:ring-0 focus:ring-offset-0 focus:border-primary hover:border-primary/50 transition-colors"
              data-testid={`select-assign-${item.id}`}
            >
              <SelectValue placeholder="ASSIGN_TARGET..." />
            </SelectTrigger>
            <SelectContent className="rounded-none border-border bg-card shadow-xl shadow-black">
              {panels.map((p) => (
                <SelectItem key={p.id} value={p.id} className="rounded-none font-mono text-[10px] uppercase focus:bg-primary focus:text-black cursor-pointer" data-testid={`option-panel-${item.id}-${p.id}`}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <div className="flex items-center gap-2 font-mono text-[9px] text-muted-foreground/50 uppercase">
            <span data-testid={`text-workitem-owner-${item.id}`}>
              OWNER: {item.owner || "NULL"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CommandCenter() {
  const [panels, setPanels] = useState<WorkspacePanel[]>(MOCK_PANELS);
  const [plan, setPlan] = useState<WorkItem[]>(INITIAL_PLAN);
  const [chat, setChat] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [chatDraft, setChatDraft] = useState("");

  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const activePanel = useMemo(
    () => panels.find((p) => p.id === activePanelId) ?? null,
    [activePanelId, panels],
  );

  const [dispatchTargetId, setDispatchTargetId] = useState<string | null>(null);
  const [_dispatchText, _setDispatchText] = useState("");

  // Add Panel State
  const [isAddPanelOpen, setIsAddPanelOpen] = useState(false);
  const [newPanelKind, setNewPanelKind] = useState<PanelKind>("terminal");
  const [newPanelTitle, setNewPanelTitle] = useState("");
  const [newPanelEndpoint, setNewPanelEndpoint] = useState("");

  const [isPlannerVisible, setIsPlannerVisible] = useState(true);
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'alerts'>('all');

  // Real System Stats from Tauri backend
  const [sysStats, setSysStats] = useState({ cpu: 0, mem: 0, memUsedGb: 0, memTotalGb: 0 });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const stats = await invoke<SystemStats>("get_system_stats");
        setSysStats({
          cpu: Math.round(stats.cpu),
          mem: Math.round(stats.mem),
          memUsedGb: stats.mem_used_gb,
          memTotalGb: stats.mem_total_gb,
        });
      } catch (err) {
        console.error("Failed to fetch system stats:", err);
      }
    };

    // Fetch immediately on mount
    fetchStats();

    // Then poll every 2 seconds
    const interval = setInterval(fetchStats, SYSTEM_STATS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const stats = useMemo(() => {
    const total = plan.length;
    const done = plan.filter((x) => x.status === "done").length;
    const inProgress = plan.filter((x) => x.status === "in-progress").length;
    return { total, done, inProgress };
  }, [plan]);

  function sendChat() {
    const text = chatDraft.trim();
    if (!text) return;

    const now = new Date();
    const ts = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    setChat((prev) => [
      ...prev,
      { id: `u-${now.getTime()}`, role: "user", content: text, ts },
      {
        id: `p-${now.getTime() + 1}`,
        role: "planner",
        ts,
        content:
          "ACK. Processing input. Work items will be generated based on these constraints.",
      },
    ]);
    setChatDraft("");
  }

  function assignWorkItem(itemId: string, target: WorkItem["target"]) {
    setPlan((prev) =>
      prev.map((w) => (w.id === itemId ? { ...w, target, owner: "Synthia" } : w)),
    );

    if (target?.panelId) {
      setPanels((prev) =>
        prev.map((p) =>
          p.id === target.panelId
            ? { ...p, status: "running", activeWorkItemId: itemId }
            : p,
        ),
      );
    }
  }

  function dispatchTo(panelId: string) {
    setDispatchTargetId(panelId);
  }

  function confirmDispatch(workItemId: string) {
    if (!dispatchTargetId) return;

    setPanels((prev) =>
      prev.map((p) =>
        p.id === dispatchTargetId
          ? { ...p, status: "running", activeWorkItemId: workItemId }
          : p,
      ),
    );

    const targetPanel = panels.find((p) => p.id === dispatchTargetId);

    // Update work item status
    setPlan((prev) =>
      prev.map((w) =>
        w.id === workItemId
          ? {
              ...w,
              status: "in-progress",
              owner: "Synthia",
              target: {
                kind: targetPanel?.kind || "terminal",
                panelId: dispatchTargetId,
              },
            }
          : w,
      ),
    );

    setDispatchTargetId(null);
  }

  function handleAddPanel() {
    if (!newPanelTitle) return;
    
    const newPanel: WorkspacePanel = {
        id: `${newPanelKind}-${Date.now()}`,
        kind: newPanelKind,
        title: newPanelTitle,
        subtitle: "Manual Entry",
        status: "idle",
        endpoint: newPanelEndpoint || "N/A"
    };

    setPanels(prev => [...prev, newPanel]);
    setIsAddPanelOpen(false);
    setNewPanelTitle("");
    setNewPanelEndpoint("");
  }

  const handleRemovePanel = useCallback((id: string) => {
    const panel = panels.find(p => p.id === id);
    if (panel?.kind === "terminal") {
      invoke("kill_terminal", { sessionId: `terminal-${id}` }).catch((err) =>
        console.error("kill_terminal on remove failed:", err),
      );
    }
    setPanels(prev => prev.filter(p => p.id !== id));
  }, [panels]);

  return (
    <div className="h-screen bg-background text-foreground font-sans selection:bg-primary selection:text-black overflow-hidden flex flex-col">
      <div className="scanlines fixed inset-0 z-50 pointer-events-none opacity-10"></div>
      
      {/* HUD Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur z-40 relative shrink-0">
        <div className="flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <div className="flex h-10 w-10 items-center justify-center bg-primary text-black font-black text-xl border border-primary shadow-[4px_4px_0_0_rgba(255,255,255,0.1)]" data-testid="img-synthia-mark">
              S
            </div>
            <div>
              <div className="text-3xl font-display font-black uppercase tracking-tighter leading-none text-foreground" data-testid="text-app-title">
                SYNTHIA
              </div>
              <div className="flex items-center gap-2 font-mono text-[10px] text-primary uppercase tracking-[0.2em] mt-1" data-testid="text-app-subtitle">
                <span className="w-2 h-2 bg-primary animate-pulse"></span>
                Synthetic Team Mission Control // V0.9.2
              </div>
            </div>
          </div>

          {/* Decorative HUD Lines */}
          <div className="flex-1 mx-12 h-px bg-gradient-to-r from-transparent via-border to-transparent relative opacity-50">
             <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-1 bg-border"></div>
          </div>

          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              className="h-9 w-9 p-0 rounded-none text-muted-foreground hover:text-primary hover:bg-transparent"
              onClick={() => setIsPlannerVisible(!isPlannerVisible)}
              data-testid="button-toggle-planner"
            >
              {isPlannerVisible ? <PanelRightClose className="h-5 w-5" /> : <PanelRightOpen className="h-5 w-5" />}
            </Button>
            <Link href="/logs" data-testid="link-logs">
              <Button
                variant="outline"
                className="h-9 px-4 rounded-none border-border bg-transparent font-mono text-xs uppercase hover:bg-white hover:text-black hover:border-white transition-all"
                data-testid="button-open-logs"
              >
                <ScrollText className="mr-2 h-3 w-3" />
                Logs
              </Button>
            </Link>
            <Link href="/settings" data-testid="link-settings">
              <Button
                variant="outline"
                className="h-9 px-4 rounded-none border-border bg-transparent font-mono text-xs uppercase hover:bg-primary hover:text-black hover:border-primary transition-all"
                data-testid="button-open-settings"
              >
                <SettingsIcon className="mr-2 h-3 w-3" />
                Config
              </Button>
            </Link>
            <Button
              className="h-9 px-6 rounded-none bg-foreground text-background font-mono text-xs uppercase font-bold hover:bg-primary hover:text-black transition-all"
              data-testid="button-new-session"
            >
              [+] Session
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden relative">
        <ResizablePanelGroup direction="horizontal" className="h-full w-full">
          <ResizablePanel defaultSize={75} minSize={30}>
            <div className="flex flex-col gap-6 h-full p-6 overflow-hidden">
              {/* Stats Bar */}
              <div className="grid grid-cols-3 gap-6 shrink-0">
                 <div className="corner-brackets brutal-border p-4 flex flex-col justify-between group h-full" data-testid="card-stats">
                   <div className="flex items-center justify-between font-mono text-[10px] uppercase text-muted-foreground group-hover:text-primary transition-colors">
                     <span>Mission Status</span>
                     <Activity className="h-4 w-4" />
                   </div>
                   
                   <div className="flex flex-col gap-3">
                     <div className="flex items-end gap-3 mt-1">
                        <div className="text-4xl font-display font-black text-foreground group-hover:text-primary transition-colors leading-none" data-testid="text-stats-active">
                          {stats.inProgress.toString().padStart(2, '0')}
                        </div>
                        <div className="font-mono text-[10px] text-primary mb-1.5 uppercase font-bold animate-pulse">
                           &bull; In Progress
                        </div>
                     </div>

                     <div className="grid grid-cols-2 gap-2 text-[10px] font-mono border-t border-border/50 pt-2">
                        <div className="flex flex-col">
                            <span className="text-muted-foreground">PENDING</span>
                            <span className="text-foreground font-bold">{(stats.total - stats.done - stats.inProgress).toString().padStart(2, '0')}</span>
                        </div>
                        <div className="flex flex-col text-right">
                            <span className="text-muted-foreground">COMPLETED</span>
                            <span className="text-foreground font-bold">{stats.done.toString().padStart(2, '0')}</span>
                        </div>
                     </div>

                     <div className="space-y-1 mt-1">
                        <div className="flex justify-between font-mono text-[9px] text-muted-foreground uppercase">
                           <span>Progress</span>
                           <span>{Math.round(stats.total > 0 ? (stats.done / stats.total) * 100 : 0)}%</span>
                        </div>
                        <div className="h-1 bg-muted/20 w-full overflow-hidden">
                            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${stats.total > 0 ? (stats.done / stats.total) * 100 : 0}%` }}></div>
                        </div>
                     </div>
                   </div>
                 </div>
                 
                 <div className="corner-brackets brutal-border p-4 flex flex-col justify-between group h-full" data-testid="card-systems">
                   <div className="flex items-center justify-between font-mono text-[10px] uppercase text-muted-foreground group-hover:text-primary transition-colors">
                     <span>Infrastructure</span>
                     <Zap className="h-4 w-4" />
                   </div>
                   <div className="flex flex-col gap-3">
                     <div className="space-y-1">
                        <div className="flex justify-between font-mono text-[10px]">
                            <span className="text-muted-foreground">CPU_LOAD</span>
                            <span className="text-primary">{sysStats.cpu}%</span>
                        </div>
                        <div className="h-1 bg-muted/20 w-full overflow-hidden">
                            <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${sysStats.cpu}%` }}></div>
                        </div>
                     </div>
                     <div className="space-y-1">
                        <div className="flex justify-between font-mono text-[10px]">
                            <span className="text-muted-foreground">MEM_USAGE</span>
                            <span className="text-primary">{sysStats.mem}%</span>
                        </div>
                        <div className="h-1 bg-muted/20 w-full overflow-hidden">
                            <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${sysStats.mem}%` }}></div>
                        </div>
                     </div>
                     <div className="flex items-center justify-between font-mono text-[10px] border-t border-border/50 pt-2 mt-1">
                        <span className="text-muted-foreground">NODES_ONLINE</span>
                        <span className="text-primary font-bold">{panels.length} ACTV</span>
                     </div>
                   </div>
                 </div>
                 
                 <div className="corner-brackets brutal-border p-4 flex flex-col justify-between group h-full" data-testid="card-mode">
                   <div className="flex items-center justify-between font-mono text-[10px] uppercase text-muted-foreground group-hover:text-primary transition-colors">
                     <span>Signal Filter</span>
                     <Radio className="h-4 w-4 animate-pulse" />
                   </div>
                   
                   <div className="flex flex-col gap-1.5 mt-2">
                     {/* Filter Status Text */}
                     <div className={`font-mono text-[10px] text-right h-4 transition-colors ${filterMode === 'alerts' ? 'text-destructive' : 'text-primary'}`}>
                       {filterMode === 'all' && "SHOWING ALL FEEDS"}
                       {filterMode === 'active' && "ACTIVE SIGNALS ONLY"}
                       {filterMode === 'alerts' && "CRITICAL ALERTS ONLY"}
                     </div>

                     <div className="flex gap-1.5">
                       <button
                          onClick={() => setFilterMode('all')}
                          className={`flex-1 h-9 flex items-center justify-center border transition-all ${
                            filterMode === 'all' 
                            ? 'bg-primary border-primary text-black shadow-[0_0_10px_rgba(204,255,0,0.3)]' 
                            : 'bg-transparent border-border text-muted-foreground hover:border-primary/50 hover:text-primary'
                          }`}
                          data-testid="button-filter-all"
                       >
                         <div className="flex flex-col items-center gap-1">
                            <span className="font-bold font-mono text-[10px] leading-none">ALL</span>
                            <div className="flex gap-0.5">
                                <div className={`w-1 h-1 rounded-full ${filterMode === 'all' ? 'bg-black' : 'bg-primary/50'}`}></div>
                                <div className={`w-1 h-1 rounded-full ${filterMode === 'all' ? 'bg-black' : 'bg-primary/50'}`}></div>
                                <div className={`w-1 h-1 rounded-full ${filterMode === 'all' ? 'bg-black' : 'bg-primary/50'}`}></div>
                            </div>
                         </div>
                       </button>

                       <button
                          onClick={() => setFilterMode('active')}
                          className={`flex-1 h-9 flex items-center justify-center border transition-all ${
                            filterMode === 'active' 
                            ? 'bg-primary border-primary text-black shadow-[0_0_10px_rgba(204,255,0,0.3)]' 
                            : 'bg-transparent border-border text-muted-foreground hover:border-primary/50 hover:text-primary'
                          }`}
                          data-testid="button-filter-active"
                       >
                         <div className="flex flex-col items-center gap-1">
                            <span className="font-bold font-mono text-[10px] leading-none">ACTV</span>
                            <div className={`w-1 h-1 rounded-full ${filterMode === 'active' ? 'bg-black animate-pulse' : 'bg-primary/50'}`}></div>
                         </div>
                       </button>

                       <button
                          onClick={() => setFilterMode('alerts')}
                          className={`flex-1 h-9 flex items-center justify-center border transition-all ${
                            filterMode === 'alerts' 
                            ? 'bg-destructive border-destructive text-white shadow-[0_0_10px_rgba(255,0,0,0.3)]' 
                            : 'bg-transparent border-border text-muted-foreground hover:border-destructive/50 hover:text-destructive'
                          }`}
                          data-testid="button-filter-alerts"
                       >
                         <div className="flex flex-col items-center gap-1">
                            <span className="font-bold font-mono text-[10px] leading-none">ALRT</span>
                            <AlertTriangle className={`h-2 w-2 ${filterMode === 'alerts' ? 'text-white' : 'text-destructive/50'}`} />
                         </div>
                       </button>
                     </div>
                   </div>
                 </div>
              </div>

              {/* Grid View */}
              <div className="brutal-border bg-black/50 flex-1 relative flex flex-col min-h-0 overflow-hidden" data-testid="grid-workspace">
                 <div className="h-8 shrink-0 border-b border-border bg-muted/5 flex items-center px-4 justify-between">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">
                        Main Viewport // {filterMode === 'all' ? 'All Nodes' : filterMode === 'active' ? 'Active Feeds' : 'System Alerts'}
                    </span>
                    <div className="flex items-center gap-4">
                       <div className="flex gap-1">
                           <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                           <span className="font-mono text-[10px] text-primary">ONLINE</span>
                       </div>
                       <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-5 text-[9px] px-2 rounded-none border-primary/50 text-primary hover:bg-primary hover:text-black transition-colors uppercase"
                            onClick={() => setIsAddPanelOpen(true)}
                            data-testid="button-add-panel"
                       >
                            <Plus className="h-3 w-3 mr-1" />
                            Add Node
                       </Button>
                    </div>
                 </div>
                 <div className="bg-grid-pattern absolute inset-0 opacity-10 pointer-events-none" />
                 <div className="relative z-10 p-4 flex-1 min-h-0 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-4 pb-4">
                      {panels
                        .filter(p => {
                            if (filterMode === 'active') return p.status === 'running';
                            if (filterMode === 'alerts') return p.status === 'attention';
                            return true;
                        })
                        .map((p) => (
                        <PanelCard
                          key={p.id}
                          panel={p}
                          onMaximize={setActivePanelId}
                          onDispatch={dispatchTo}
                          onRemove={handleRemovePanel}
                        />
                      ))}
                    </div>
                 </div>
              </div>
            </div>
          </ResizablePanel>

          {isPlannerVisible && (
            <>
              <ResizableHandle withHandle className="w-1 bg-border hover:bg-primary transition-colors data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary" />
              <ResizablePanel defaultSize={25} minSize={20} maxSize={40} className="bg-background overflow-hidden">
                <div className="h-full p-6 pl-0 overflow-hidden">
                  <div className="brutal-border bg-card flex flex-col h-full min-h-0 overflow-hidden relative" data-testid="panel-right">
                    {/* Decorative corner lines */}
                    <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-primary pointer-events-none z-20"></div>
                    <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-primary pointer-events-none z-20"></div>
                    
                    <Tabs defaultValue="planner" className="flex flex-col h-full w-full">
                      <TabsList className="grid w-full grid-cols-2 rounded-none bg-muted/10 p-0 border-b border-border h-12" data-testid="tabs-right">
                        <TabsTrigger 
                          value="planner" 
                          className="rounded-none border-r border-border data-[state=active]:bg-primary data-[state=active]:text-black font-mono text-xs uppercase font-bold tracking-wider h-full transition-all"
                          data-testid="tab-planner"
                        >
                          // Planner_AI
                        </TabsTrigger>
                        <TabsTrigger 
                          value="plan" 
                          className="rounded-none data-[state=active]:bg-primary data-[state=active]:text-black font-mono text-xs uppercase font-bold tracking-wider h-full transition-all"
                          data-testid="tab-plan"
                        >
                          // Execution_Plan
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="planner" className="flex-1 flex flex-col min-h-0 m-0 relative">
                         <div className="flex-1 overflow-hidden relative bg-black/20">
                           <ScrollArea className="h-full p-4" data-testid="scroll-chat">
                              <div className="space-y-6">
                                {chat.map((m) => (
                                  <div
                                    key={m.id}
                                    className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
                                    data-testid={`row-chat-${m.id}`}
                                  >
                                     <div className="font-mono text-[9px] text-muted-foreground mb-1 uppercase tracking-widest flex items-center gap-2">
                                       {m.role === "user" ? <span className="text-primary">USER</span> : <span className="text-accent">SYNTHIA_CORE</span>}
                                       <span className="opacity-50">:: {m.ts}</span>
                                     </div>
                                     <div className={`max-w-[90%] p-4 text-xs font-mono leading-relaxed border shadow-sm ${
                                       m.role === "user" 
                                       ? "border-primary/50 bg-primary/10 text-foreground rounded-tl-lg rounded-br-lg" 
                                       : "border-border bg-card text-foreground rounded-tr-lg rounded-bl-lg"
                                     }`}>
                                       {m.content}
                                     </div>
                                  </div>
                                ))}
                              </div>
                           </ScrollArea>
                         </div>

                         <div className="p-4 border-t border-border bg-muted/5 backdrop-blur-sm">
                           <div className="flex gap-0 border border-border focus-within:border-primary transition-colors bg-black">
                             <div className="flex items-center pl-3 text-primary animate-pulse">
                               <ChevronDown className="h-4 w-4 rotate-[-90deg]" />
                             </div>
                             <Textarea
                                value={chatDraft}
                                onChange={(e) => setChatDraft(e.target.value)}
                                placeholder="INPUT DIRECTIVE..."
                                className="rounded-none border-0 bg-transparent font-mono text-xs text-foreground focus:ring-0 min-h-[50px] resize-none py-4"
                                data-testid="input-chat"
                             />
                             <Button 
                                onClick={sendChat}
                                className="rounded-none h-auto w-16 bg-foreground hover:bg-primary hover:text-black border-l border-border"
                                data-testid="button-chat-send"
                             >
                               <Send className="h-4 w-4" />
                             </Button>
                           </div>
                         </div>
                      </TabsContent>

                      <TabsContent value="plan" className="flex-1 flex flex-col min-h-0 m-0 bg-black/20">
                        <ScrollArea className="flex-1" data-testid="scroll-plan">
                           <div className="divide-y divide-border/50">
                             {plan.map((w) => (
                               <WorkItemRow
                                 key={w.id}
                                 item={w}
                                 panels={panels}
                                 onAssign={assignWorkItem}
                               />
                             ))}
                           </div>
                        </ScrollArea>
                      </TabsContent>
                    </Tabs>
                  </div>
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </main>

      {/* Focus Dialog */}
      <Dialog open={!!activePanel} onOpenChange={(o) => (!o ? setActivePanelId(null) : null)}>
        <DialogContent
          className="max-w-[95vw] h-[85vh] bg-black border border-primary p-0 rounded-none gap-0 shadow-2xl shadow-primary/20"
          data-testid="dialog-focus"
        >
           <DialogHeader className="h-12 border-b border-primary/30 flex flex-row items-center px-6 bg-primary/5 space-y-0 justify-between">
             <DialogTitle className="font-mono text-sm uppercase text-primary tracking-widest flex items-center gap-3" data-testid="text-focus-title">
               <span className="w-2 h-2 bg-primary animate-pulse shadow-[0_0_10px_#ccff00]"></span>
               {activePanel?.title}
             </DialogTitle>
             <div className="font-mono text-xs text-primary/50">
               SIGNAL_STRENGTH: 100%
             </div>
           </DialogHeader>
           
           <div className="flex-1 min-h-0 bg-black relative overflow-hidden" data-testid="viewport-focus">
              {activePanel?.kind === "terminal" ? (
                <TerminalNode
                  sessionId={`terminal-${activePanel.id}`}
                  className="absolute inset-0"
                />
              ) : (
                <>
                  <div className="absolute inset-0 opacity-10"
                       style={{ background: "linear-gradient(90deg, transparent 50%, rgba(204, 255, 0, 0.1) 50%), linear-gradient(0deg, transparent 50%, rgba(204, 255, 0, 0.1) 50%)", backgroundSize: "40px 40px" }}
                  />
                  <div className="scanlines absolute inset-0 opacity-20 pointer-events-none"></div>

                  <div className="absolute inset-0 flex items-center justify-center">
                     <div className="text-center group">
                       <div className="text-8xl font-black text-white/5 font-display mb-6 tracking-tighter group-hover:text-primary/10 transition-colors">
                         LIVE
                       </div>
                       <div className="font-mono text-sm text-primary animate-pulse tracking-[0.5em] border border-primary/30 px-4 py-2 bg-black/50 backdrop-blur">
                         ESTABLISHING_LINK...
                       </div>
                     </div>
                  </div>

                  <div className="absolute top-4 left-4 font-mono text-[10px] text-primary/50">
                    CAM_01 // RAW
                  </div>
                  <div className="absolute bottom-4 right-4 font-mono text-[10px] text-primary/50">
                    LAT: 0ms // JIT: 0ms
                  </div>
                </>
              )}
           </div>
           
           <div className="h-14 border-t border-primary/30 bg-muted/10 flex items-center justify-between px-6">
              <div className="font-mono text-[10px] text-muted-foreground uppercase">
                TARGET: {activePanel?.endpoint}
              </div>
              <Button 
                className="rounded-none bg-primary text-black hover:bg-white font-mono text-xs font-bold px-8 h-9"
                onClick={() => activePanel && dispatchTo(activePanel.id)}
                data-testid="button-focus-dispatch"
              >
                DISPATCH_PAYLOAD
              </Button>
           </div>
        </DialogContent>
      </Dialog>
      
      {/* Add Panel Dialog */}
      <Dialog open={isAddPanelOpen} onOpenChange={setIsAddPanelOpen}>
         <DialogContent className="max-w-md bg-card border border-primary/50 shadow-2xl p-0 gap-0" data-testid="dialog-add-panel">
            <DialogHeader className="p-4 border-b border-border bg-muted/10">
               <DialogTitle className="font-mono text-sm uppercase text-primary tracking-widest flex items-center gap-2">
                 <Plus className="h-4 w-4" />
                 Initialize New Node
               </DialogTitle>
            </DialogHeader>
            <div className="p-6 space-y-4">
               <div className="space-y-2">
                  <label className="text-[10px] font-mono uppercase text-muted-foreground">Node Type</label>
                  <Select value={newPanelKind} onValueChange={(v) => setNewPanelKind(v as PanelKind)}>
                     <SelectTrigger className="w-full rounded-none border-border bg-black text-xs font-mono uppercase focus:border-primary focus:ring-0">
                        <SelectValue />
                     </SelectTrigger>
                     <SelectContent className="rounded-none border-border bg-card">
                        <SelectItem value="terminal" className="font-mono text-xs uppercase">Terminal</SelectItem>
                        <SelectItem value="stream" className="font-mono text-xs uppercase">Video Stream</SelectItem>
                     </SelectContent>
                  </Select>
               </div>
               
               <div className="space-y-2">
                  <label className="text-[10px] font-mono uppercase text-muted-foreground">Node Identifier (Title)</label>
                  <Input 
                    value={newPanelTitle}
                    onChange={(e) => setNewPanelTitle(e.target.value)}
                    placeholder="e.g. TERM_PROXY_01"
                    className="rounded-none border-border bg-black text-xs font-mono focus:border-primary focus:ring-0"
                  />
               </div>

               <div className="space-y-2">
                  <label className="text-[10px] font-mono uppercase text-muted-foreground">{newPanelKind === 'terminal' ? 'Working Directory' : 'Stream URL'}</label>
                  <Input 
                    value={newPanelEndpoint}
                    onChange={(e) => setNewPanelEndpoint(e.target.value)}
                    placeholder={newPanelKind === 'terminal' ? "/home/user/project" : "http://192.168.1.100:8080/feed"}
                    className="rounded-none border-border bg-black text-xs font-mono focus:border-primary focus:ring-0"
                  />
               </div>
               
               <div className="pt-4 flex justify-end">
                  <Button 
                    onClick={handleAddPanel}
                    className="rounded-none bg-primary text-black font-mono text-xs font-bold uppercase hover:bg-white w-full"
                    disabled={!newPanelTitle}
                  >
                    Initialize System
                  </Button>
               </div>
            </div>
         </DialogContent>
      </Dialog>

      {/* Dispatch Overlay */}
      <AnimatePresence>
        {!!dispatchTargetId && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="fixed right-0 top-16 bottom-0 w-[480px] bg-black/95 backdrop-blur-md border-l border-primary z-50 p-8 shadow-2xl flex flex-col"
          >
             <div className="flex items-center justify-between mb-8 border-b border-primary/30 pb-4">
                <div>
                  <div className="font-display font-black text-3xl uppercase text-white tracking-tight" data-testid="text-dispatch-title">
                    Dispatch
                  </div>
                  <div className="font-mono text-[10px] text-primary uppercase tracking-widest mt-1">
                     Transmission Protocol V2
                  </div>
                </div>
                <Button variant="ghost" className="h-8 w-8 p-0 rounded-none text-muted-foreground hover:text-white hover:bg-white/10" onClick={() => setDispatchTargetId(null)} data-testid="button-dispatch-cancel">
                  X
                </Button>
             </div>
             
             <div className="mb-6 font-mono text-xs text-primary border border-primary/30 p-3 bg-primary/5" data-testid="text-dispatch-subtitle">
               TARGET:: {dispatchTargetId}
             </div>
             
             <div className="flex-1 overflow-y-auto pr-2 space-y-2">
               <div className="font-mono text-xs text-muted-foreground mb-4 uppercase tracking-widest">Select Work Item Payload:</div>
               {plan.filter(w => w.status !== 'done').map((w) => (
                 <button
                   key={w.id}
                   onClick={() => confirmDispatch(w.id)}
                   className="w-full text-left p-4 border border-border bg-black hover:border-primary hover:bg-primary/5 group transition-all"
                   data-testid={`button-dispatch-item-${w.id}`}
                 >
                   <div className="flex items-center justify-between mb-2">
                     <Badge variant="outline" className={`rounded-none font-mono text-[9px] uppercase border-border text-muted-foreground group-hover:border-primary group-hover:text-primary`}>
                       {w.id}
                     </Badge>
                     <span className="font-mono text-[9px] text-muted-foreground/50 group-hover:text-primary/50 uppercase">{w.status}</span>
                   </div>
                   <div className="font-bold text-sm text-foreground group-hover:text-white mb-1 line-clamp-1">{w.title}</div>
                   <div className="text-xs text-muted-foreground font-mono line-clamp-2 group-hover:text-primary/70">{w.desc}</div>
                 </button>
               ))}
               {plan.filter(w => w.status !== 'done').length === 0 && (
                 <div className="text-center p-8 border border-dashed border-border text-muted-foreground font-mono text-xs">
                   NO_PENDING_WORK_ITEMS
                 </div>
               )}
             </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
