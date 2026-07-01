// ============================================================================
// KtodTable — Таблица коэффициентов времени оплаты
// ============================================================================

import { useState, useCallback } from "react";
import type { KtodCoefficients } from "@/types/taximeter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pencil, Check, RotateCcw } from "lucide-react";
import { DEFAULT_KTOD } from "@/types/taximeter";
import { computeKtod, getKtodPeriodName } from "@/utils/ktod";

interface KtodTableProps {
  coefficients: KtodCoefficients;
  onChange: (coeffs: KtodCoefficients) => void;
}

const PERIOD_LABELS: Record<keyof KtodCoefficients, string> = {
  weekdayDay: "Пн-Пт 06:00-22:00",
  weekdayNight: "Пн-Пт 22:00-06:00",
  weekendDay: "Сб-Вс 09:00-22:00",
  weekendNight: "Сб-Вс 22:00-09:00",
};

export default function KtodTable({ coefficients, onChange }: KtodTableProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [localCoeffs, setLocalCoeffs] = useState(coefficients);
  const [isOpen, setIsOpen] = useState(false);

  const currentKtod = computeKtod(new Date(), coefficients);
  const currentPeriod = getKtodPeriodName(new Date());

  const handleChange = useCallback(
    (key: keyof KtodCoefficients, value: string) => {
      const num = parseFloat(value);
      if (!isNaN(num) && num > 0) {
        const newCoeffs = { ...localCoeffs, [key]: num };
        setLocalCoeffs(newCoeffs);
      }
    },
    [localCoeffs],
  );

  const handleSave = useCallback(() => {
    onChange(localCoeffs);
    setIsEditing(false);
  }, [localCoeffs, onChange]);

  const handleReset = useCallback(() => {
    setLocalCoeffs(DEFAULT_KTOD);
    onChange(DEFAULT_KTOD);
    setIsEditing(false);
  }, [onChange]);

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors"
      >
        <span className="text-xs font-medium text-white/60 uppercase tracking-wider">
          Ktod — Коэффициенты времени
        </span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-cyan-400">
            ×{currentKtod.toFixed(1)}
          </span>
          <span className="text-[10px] text-white/30">{isOpen ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Current period indicator */}
      <div className="px-4 pb-2">
        <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-lg px-3 py-1.5">
          <p className="text-[10px] text-cyan-400/60 uppercase tracking-wider">
            Текущий период
          </p>
          <p className="text-xs text-cyan-300 font-medium">{currentPeriod}</p>
        </div>
      </div>

      {isOpen && (
        <div className="px-4 pb-3 space-y-2">
          {/* Edit toggle */}
          <div className="flex justify-end gap-1">
            {!isEditing ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:bg-white/5"
                onClick={() => setIsEditing(true)}
              >
                <Pencil className="h-3 w-3 text-white/40" />
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 hover:bg-white/5"
                  onClick={handleSave}
                >
                  <Check className="h-3 w-3 text-green-400" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 hover:bg-white/5"
                  onClick={handleReset}
                >
                  <RotateCcw className="h-3 w-3 text-white/40" />
                </Button>
              </>
            )}
          </div>

          {/* Coefficient rows */}
          <div className="space-y-1">
            {(Object.keys(PERIOD_LABELS) as Array<keyof KtodCoefficients>).map(
              (key) => (
                <div
                  key={key}
                  className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <span className="text-[11px] text-white/50">
                    {PERIOD_LABELS[key]}
                  </span>
                  {isEditing ? (
                    <Input
                      type="number"
                      step="0.1"
                      min="0.5"
                      max="5"
                      value={localCoeffs[key]}
                      onChange={(e) => handleChange(key, e.target.value)}
                      className="h-7 w-20 text-xs text-right bg-white/5 border-white/10 text-white"
                    />
                  ) : (
                    <span className="text-xs font-mono font-bold text-white/80 w-20 text-right">
                      ×{coefficients[key].toFixed(1)}
                    </span>
                  )}
                </div>
              ),
            )}
          </div>

          {/* Formula display */}
          <div className="mt-2 pt-2 border-t border-white/5">
            <p className="text-[10px] text-white/30">
              Текущий Ktod: <span className="text-cyan-400 font-bold">×{currentKtod.toFixed(1)}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
