import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollText, ArrowLeft, Search, Download, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

type LogEntry = {
  id: string;
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
  meta?: Record<string, string>;
};

const MOCK_LOGS: LogEntry[] = [
  {
    id: "L-001",
    ts: "00:00:03",
    level: "INFO",
    source: "planner",
    message: "Plan ingest complete. 3 work items staged.",
    meta: { run: "R-1182", trace: "a3f9" },
  },
  {
    id: "L-002",
    ts: "00:00:08",
    level: "DEBUG",
    source: "dispatch",
    message: "Assigned WI-002 → term-claude-1",
    meta: { workItem: "WI-002", node: "term-claude-1" },
  },
  {
    id: "L-003",
    ts: "00:00:12",
    level: "INFO",
    source: "node.term-claude-1",
    message: "Build pipeline warm-start. Restoring cache.",
    meta: { cache: "hit", branch: "main" },
  },
  {
    id: "L-004",
    ts: "00:00:18",
    level: "WARN",
    source: "infra",
    message: "Memory pressure rising (82%).",
    meta: { mem: "82%", host: "compute-7" },
  },
  {
    id: "L-005",
    ts: "00:00:23",
    level: "ERROR",
    source: "stream.gateway",
    message: "HLS segment timeout. Retrying...",
    meta: { stream: "IDE_STREAM_BACKEND", retry: "1/3" },
  },
  {
    id: "L-006",
    ts: "00:00:29",
    level: "INFO",
    source: "dispatch",
    message: "Work item WI-003 queued for IDE_STREAM_FRONTEND",
    meta: { workItem: "WI-003", node: "stream-ide-1" },
  },
  {
    id: "L-007",
    ts: "00:00:35",
    level: "DEBUG",
    source: "signals",
    message: "Signal filter set to ACTIVE",
    meta: { filter: "ACTIVE" },
  },
];

function LevelPill({ level }: { level: LogLevel }) {
  const styles =
    level === "ERROR"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : level === "WARN"
        ? "border-accent/40 bg-accent/10 text-accent"
        : level === "INFO"
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-muted/10 text-muted-foreground";

  return (
    <span
      className={`inline-flex items-center gap-2 border px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${styles}`}
      data-testid={`badge-level-${level}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          level === "ERROR"
            ? "bg-destructive"
            : level === "WARN"
              ? "bg-accent"
              : level === "INFO"
                ? "bg-primary"
                : "bg-muted-foreground"
        } ${level === "ERROR" || level === "WARN" ? "animate-pulse" : ""}`}
      />
      {level}
    </span>
  );
}

export default function Logs() {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<"ALL" | LogLevel>("ALL");
  const [source, setSource] = useState("ALL");
  const [dense, setDense] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>(MOCK_LOGS);

  const sources = useMemo(() => {
    const s = new Set(logs.map((l) => l.source));
    return ["ALL", ...Array.from(s).sort()];
  }, [logs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (level !== "ALL" && l.level !== level) return false;
      if (source !== "ALL" && l.source !== source) return false;
      if (!q) return true;
      const meta = l.meta ? Object.entries(l.meta).map(([k, v]) => `${k}:${v}`).join(" ") : "";
      return (
        l.message.toLowerCase().includes(q) ||
        l.source.toLowerCase().includes(q) ||
        l.level.toLowerCase().includes(q) ||
        meta.toLowerCase().includes(q) ||
        l.id.toLowerCase().includes(q) ||
        l.ts.toLowerCase().includes(q)
      );
    });
  }, [logs, query, level, source]);

  function clearLogs() {
    setLogs([]);
  }

  function downloadLogs() {
    const payload = {
      exportedAt: new Date().toISOString(),
      count: filtered.length,
      logs: filtered,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `synthia-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary selection:text-black overflow-hidden flex flex-col">
      <div className="scanlines fixed inset-0 z-50 pointer-events-none opacity-10" />

      <header className="border-b border-border bg-background/95 backdrop-blur z-40 relative">
        <div className="flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-4 min-w-0">
            <Link href="/" data-testid="link-back-command-center">
              <Button
                variant="ghost"
                className="h-9 px-3 rounded-none text-muted-foreground hover:text-primary hover:bg-transparent"
                data-testid="button-back-command-center"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Command Center
              </Button>
            </Link>

            <div className="h-6 w-px bg-border" />

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center bg-white text-black border border-white shadow-[4px_4px_0_0_rgba(255,255,255,0.08)]" data-testid="img-logs-mark">
                  <ScrollText className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-2xl font-display font-black uppercase tracking-tighter leading-none" data-testid="text-logs-title">
                    LOGS
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.22em]" data-testid="text-logs-subtitle">
                    Event stream + node output // local session
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              className={`h-9 px-3 rounded-none border border-border font-mono text-[10px] uppercase tracking-widest transition-colors ${
                dense ? "bg-white text-black border-white" : "bg-transparent text-muted-foreground hover:text-primary"
              }`}
              onClick={() => setDense((v) => !v)}
              data-testid="button-toggle-density"
            >
              {dense ? "Dense" : "Comfort"}
            </button>

            <Button
              variant="outline"
              className="h-9 px-4 rounded-none border-border bg-transparent font-mono text-xs uppercase hover:bg-white hover:text-black hover:border-white transition-all"
              onClick={downloadLogs}
              data-testid="button-download-logs"
            >
              <Download className="mr-2 h-3 w-3" />
              Export
            </Button>

            <Button
              variant="outline"
              className="h-9 px-4 rounded-none border-border bg-transparent font-mono text-xs uppercase hover:bg-destructive hover:text-white hover:border-destructive transition-all"
              onClick={clearLogs}
              data-testid="button-clear-logs"
            >
              <Trash2 className="mr-2 h-3 w-3" />
              Clear
            </Button>
          </div>
        </div>

        <div className="px-6 pb-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search logs (message, source, WI, node, trace…)"
                  className="h-10 w-full rounded-none border border-border bg-background pl-10 pr-3 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  data-testid="input-search-logs"
                />
              </div>
            </div>

            <div className="md:col-span-3">
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as "ALL" | LogLevel)}
                className="h-10 w-full rounded-none border border-border bg-background px-3 font-mono text-xs uppercase tracking-widest text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                data-testid="select-level"
              >
                <option value="ALL">ALL LEVELS</option>
                <option value="TRACE">TRACE</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="h-10 w-full rounded-none border border-border bg-background px-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                data-testid="select-source"
              >
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {s === "ALL" ? "ALL SOURCES" : s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground" data-testid="text-log-count">
              Showing <span className="text-foreground">{filtered.length}</span> / {logs.length}
            </div>

            <div className="flex items-center gap-2">
              <div className="h-2 w-2 bg-primary animate-pulse" />
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary" data-testid="status-live">
                LIVE
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <div className="h-full px-6 pb-6">
          <Card className="corner-brackets brutal-border h-full overflow-hidden rounded-none bg-card">
            <div
              className={`grid grid-cols-12 border-b border-border bg-muted/10 px-4 ${
                dense ? "py-2" : "py-3"
              } font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground`}
              data-testid="header-logs-table"
            >
              <div className="col-span-2">Time</div>
              <div className="col-span-2">Level</div>
              <div className="col-span-3">Source</div>
              <div className="col-span-5">Message</div>
            </div>

            <div className="h-[calc(100vh-260px)] overflow-auto">
              {filtered.length === 0 ? (
                <div className="grid place-items-center h-full p-10">
                  <div className="text-center">
                    <div className="font-display font-black text-2xl uppercase tracking-tight" data-testid="text-empty-title">
                      No logs
                    </div>
                    <div className="mt-2 font-mono text-xs text-muted-foreground" data-testid="text-empty-subtitle">
                      Try changing filters or run a dispatch to generate activity.
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  {filtered.map((l) => (
                    <div
                      key={l.id}
                      className={`grid grid-cols-12 items-start border-b border-border/70 hover:bg-muted/10 transition-colors px-4 ${
                        dense ? "py-2" : "py-3"
                      }`}
                      data-testid={`row-log-${l.id}`}
                    >
                      <div className="col-span-2 font-mono text-xs text-muted-foreground" data-testid={`text-time-${l.id}`}>
                        {l.ts}
                      </div>
                      <div className="col-span-2" data-testid={`cell-level-${l.id}`}>
                        <LevelPill level={l.level} />
                      </div>
                      <div className="col-span-3 font-mono text-xs text-foreground/80" data-testid={`text-source-${l.id}`}>
                        {l.source}
                      </div>
                      <div className="col-span-5">
                        <div className="font-mono text-xs text-foreground" data-testid={`text-message-${l.id}`}>
                          {l.message}
                        </div>
                        {l.meta && (
                          <div className="mt-1 flex flex-wrap gap-2" data-testid={`meta-${l.id}`}>
                            {Object.entries(l.meta).map(([k, v]) => (
                              <span
                                key={k}
                                className="border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground"
                                data-testid={`badge-meta-${l.id}-${k}`}
                              >
                                {k}:{v}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
