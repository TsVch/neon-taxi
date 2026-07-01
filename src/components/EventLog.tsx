// ============================================================================
// EventLog — Лог GPS событий с фильтрацией
// ============================================================================

import { useState, useRef, useEffect, useCallback } from "react";
import type { LogEvent, EventType } from "@/types/taximeter";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Info,
  AlertTriangle,
  Satellite,
  XCircle,
  Activity,
  Navigation,
  Filter,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface EventLogProps {
  events: LogEvent[];
  onClear: () => void;
}

const EVENT_ICONS: Record<EventType, React.FC<{ className?: string }>> = {
  info: Info,
  warn: AlertTriangle,
  gps: Satellite,
  error: XCircle,
  system: Activity,
  dr: Navigation,
};

const EVENT_COLORS: Record<EventType, string> = {
  info: "text-blue-400",
  warn: "text-yellow-400",
  gps: "text-green-400",
  error: "text-red-400",
  system: "text-purple-400",
  dr: "text-orange-400",
};

const EVENT_LABELS: Record<EventType, string> = {
  info: "Info",
  warn: "Warning",
  gps: "GPS",
  error: "Error",
  system: "System",
  dr: "DR",
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function EventLog({ events, onClear }: EventLogProps) {
  const [filter, setFilter] = useState<EventType | "all">("all");
  const bottomRef = useRef<HTMLDivElement>(null);

  const filteredEvents =
    filter === "all"
      ? events
      : events.filter((e) => e.type === filter);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filteredEvents.length]);

  const filters: Array<{ value: EventType | "all"; label: string }> = [
    { value: "all", label: "All" },
    { value: "gps", label: "GPS" },
    { value: "dr", label: "DR" },
    { value: "warn", label: "Warn" },
    { value: "error", label: "Error" },
    { value: "system", label: "System" },
  ];

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-white/40" />
          <span className="text-xs font-medium text-white/60 uppercase tracking-wider">
            Event Log ({filteredEvents.length})
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 hover:bg-white/5"
          onClick={onClear}
        >
          <Trash2 className="h-3 w-3 text-white/30" />
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-1 px-3 py-2 border-b border-white/5 overflow-x-auto">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all whitespace-nowrap",
              filter === f.value
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/60 hover:bg-white/5",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Event list */}
      <ScrollArea className="h-[240px]">
        <div className="p-2 space-y-0.5">
          {filteredEvents.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-xs text-white/20">
              {events.length === 0
                ? "Нет событий. Начните поездку."
                : "Нет событий этого типа"}
            </div>
          ) : (
            filteredEvents.map((event) => {
              const Icon = EVENT_ICONS[event.type];
              return (
                <div
                  key={event.id}
                  className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 mt-0.5 shrink-0",
                      EVENT_COLORS[event.type],
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/30 font-mono">
                        {formatTimestamp(event.timestamp)}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-medium",
                          EVENT_COLORS[event.type],
                        )}
                      >
                        {EVENT_LABELS[event.type]}
                      </span>
                    </div>
                    <p className="text-[11px] text-white/70 leading-relaxed mt-0.5">
                      {event.message}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
