// ============================================================================
// ReceiptModal — Чек поездки после завершения
// ============================================================================

import type { TripData } from "@/types/taximeter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Download, MapPin, Timer, Route, DollarSign, Clock, Gauge } from "lucide-react";

interface ReceiptModalProps {
  trip: TripData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReceiptModal({ trip, open, onOpenChange }: ReceiptModalProps) {
  if (!trip) return null;

  const distanceKm = trip.distanceM / 1000;
  const durationMs = trip.endTime ? trip.endTime - trip.startTime : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gradient-to-b from-slate-900 to-slate-950 border-white/10 text-white max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center mb-2">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center">
              <DollarSign className="h-6 w-6 text-white" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl">Поездка завершена</DialogTitle>
          <DialogDescription className="text-center text-white/40">
            {formatDate(trip.startTime)}
          </DialogDescription>
        </DialogHeader>

        {/* Total amount — large display */}
        <div className="text-center py-4">
          <div className="text-5xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
            {Math.round(trip.totalCost)}₽
          </div>
          <p className="text-xs text-white/30 mt-1">
            {trip.tariff.name} · Ktod ×{trip.ktod.toFixed(1)}
          </p>
        </div>

        <Separator className="bg-white/10" />

        {/* Trip details */}
        <div className="space-y-3 py-3">
          {/* Route */}
          <div className="flex items-start gap-3">
            <MapPin className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white/40">Откуда</p>
              <p className="text-sm text-white/80 truncate">{trip.fromAddress || "—"}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <MapPin className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white/40">Куда</p>
              <p className="text-sm text-white/80 truncate">{trip.toAddress || "—"}</p>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="bg-white/5 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Route className="h-3 w-3 text-cyan-400" />
                <span className="text-[10px] text-white/40 uppercase tracking-wider">Расстояние</span>
              </div>
              <span className="text-lg font-bold text-white">{distanceKm.toFixed(2)} км</span>
            </div>

            <div className="bg-white/5 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Clock className="h-3 w-3 text-purple-400" />
                <span className="text-[10px] text-white/40 uppercase tracking-wider">Время</span>
              </div>
              <span className="text-lg font-bold text-white">{formatDuration(durationMs)}</span>
            </div>

            <div className="bg-white/5 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Gauge className="h-3 w-3 text-orange-400" />
                <span className="text-[10px] text-white/40 uppercase tracking-wider">Тариф</span>
              </div>
              <span className="text-lg font-bold text-white">{trip.tariff.name}</span>
            </div>

            <div className="bg-white/5 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Timer className="h-3 w-3 text-green-400" />
                <span className="text-[10px] text-white/40 uppercase tracking-wider">Ktod</span>
              </div>
              <span className="text-lg font-bold text-white">×{trip.ktod.toFixed(1)}</span>
            </div>
          </div>

          {/* Price breakdown */}
          <div className="bg-white/5 rounded-lg p-3 mt-1">
            <p className="text-[10px] text-white/40 uppercase tracking-wider mb-2">Детализация</p>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-white/50">Подача (S)</span>
                <span className="text-white/80">{trip.tariff.S}₽</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Расстояние ({distanceKm.toFixed(2)}км × {trip.tariff.rd}₽)</span>
                <span className="text-white/80">{(distanceKm * trip.tariff.rd).toFixed(2)}₽</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">
                  Время ({(durationMs / 60000).toFixed(0)}мин × {trip.tariff.rt}₽ × Ktod {trip.ktod.toFixed(1)})
                </span>
                <span className="text-white/80">
                  {((durationMs / 60000) * trip.tariff.rt * trip.ktod).toFixed(2)}₽
                </span>
              </div>
              <Separator className="bg-white/20 my-1" />
              <div className="flex justify-between font-bold">
                <span className="text-white/80">Итого</span>
                <span className="text-cyan-400">{Math.round(trip.totalCost)}₽</span>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1 border-white/10 text-white/60 hover:text-white hover:bg-white/5"
            onClick={() => onOpenChange(false)}
          >
            Закрыть
          </Button>
          <Button
            className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500"
            onClick={() => {
              // Print or share receipt
              window.print();
            }}
          >
            <Download className="h-4 w-4 mr-2" />
            Чек
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
