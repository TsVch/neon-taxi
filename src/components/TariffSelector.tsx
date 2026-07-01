// ============================================================================
// TariffSelector — Выбор и настройка тарифов
// ============================================================================

import { useState } from "react";
import type { TariffId, TariffConfig, KtodCoefficients } from "@/types/taximeter";
import { TARIFFS } from "@/types/taximeter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pencil, Check, Info } from "lucide-react";
import { computeKtod } from "@/utils/ktod";

interface TariffSelectorProps {
  selectedTariff: TariffId;
  onSelect: (id: TariffId) => void;
  customTariffs: Partial<Record<TariffId, Partial<TariffConfig>>>;
  onCustomize: (id: TariffId, updates: Partial<TariffConfig>) => void;
  ktodCoeffs: KtodCoefficients;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
}

const TARIFF_GRADIENTS: Record<TariffId, string> = {
  economy: "from-green-500/20 to-green-600/10 border-green-500/30",
  comfort: "from-cyan-500/20 to-cyan-600/10 border-cyan-500/30",
  comfort_plus: "from-blue-500/20 to-blue-600/10 border-blue-500/30",
  business: "from-purple-500/20 to-purple-600/10 border-purple-500/30",
  minivan_premium: "from-orange-500/20 to-orange-600/10 border-orange-500/30",
};

const TARIFF_ACCENT: Record<TariffId, string> = {
  economy: "text-green-400",
  comfort: "text-cyan-400",
  comfort_plus: "text-blue-400",
  business: "text-purple-400",
  minivan_premium: "text-orange-400",
};

const TARIFF_BG: Record<TariffId, string> = {
  economy: "bg-green-500",
  comfort: "bg-cyan-500",
  comfort_plus: "bg-blue-500",
  business: "bg-purple-500",
  minivan_premium: "bg-orange-500",
};

function calculatePrice(
  tariff: TariffConfig,
  distanceKm: number,
  durationMin: number,
  ktod: number,
): number {
  return tariff.S + distanceKm * tariff.rd + durationMin * tariff.rt * ktod;
}

export default function TariffSelector({
  selectedTariff,
  onSelect,
  customTariffs,
  onCustomize,
  ktodCoeffs,
  estimatedDistanceKm,
  estimatedDurationMin,
}: TariffSelectorProps) {
  const [editingTariff, setEditingTariff] = useState<TariffId | null>(null);

  const ktod = computeKtod(new Date(), ktodCoeffs);

  const getEffectiveTariff = (id: TariffId): TariffConfig => {
    const base = TARIFFS[id];
    const custom = customTariffs[id];
    if (!custom) return base;
    return {
      ...base,
      ...custom,
    };
  };

  const handleEdit = (id: TariffId, field: keyof TariffConfig, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num) && num >= 0) {
      onCustomize(id, { [field]: num });
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-white/60 uppercase tracking-wider px-1">
        Тариф
      </h3>

      <div className="grid grid-cols-1 gap-2">
        {(Object.values(TARIFFS) as TariffConfig[]).map((tariff) => {
          const effective = getEffectiveTariff(tariff.id as TariffId);
          const isSelected = selectedTariff === tariff.id;
          const price = calculatePrice(effective, estimatedDistanceKm, estimatedDurationMin, ktod);
          const gradient = TARIFF_GRADIENTS[tariff.id as TariffId];
          const accent = TARIFF_ACCENT[tariff.id as TariffId];
          const isEditing = editingTariff === tariff.id;

          return (
            <button
              key={tariff.id}
              onClick={() => onSelect(tariff.id as TariffId)}
              className={`
                relative w-full text-left p-3 rounded-xl border transition-all duration-200
                ${isSelected
                  ? `bg-gradient-to-r ${gradient} shadow-lg`
                  : "bg-white/5 border-white/5 hover:bg-white/10"
                }
              `}
            >
              {/* Price indicator */}
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-right">
                <div className={`text-lg font-bold ${accent}`}>
                  {Math.round(price)}₽
                </div>
                <div className="text-[10px] text-white/30">
                  {effective.S} + {effective.rd}₽/км + {effective.rt}₽/мин
                </div>
              </div>

              {/* Tariff name */}
              <div className="flex items-center gap-2 pr-24">
                <div className={`w-2.5 h-2.5 rounded-full ${TARIFF_BG[tariff.id as TariffId]} ${isSelected ? "animate-pulse" : ""}`} />
                <span className={`text-sm font-semibold ${isSelected ? "text-white" : "text-white/70"}`}>
                  {tariff.name}
                </span>
              </div>

              {/* Editable fields */}
              {isEditing ? (
                <div className="mt-2 flex gap-2 pr-24">
                  <div className="flex-1">
                    <label className="text-[9px] text-white/30 uppercase">S</label>
                    <Input
                      type="number"
                      value={effective.S}
                      onChange={(e) => handleEdit(tariff.id as TariffId, "S", e.target.value)}
                      className="h-7 text-xs bg-white/5 border-white/10 text-white"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[9px] text-white/30 uppercase">rd</label>
                    <Input
                      type="number"
                      value={effective.rd}
                      onChange={(e) => handleEdit(tariff.id as TariffId, "rd", e.target.value)}
                      className="h-7 text-xs bg-white/5 border-white/10 text-white"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[9px] text-white/30 uppercase">rt</label>
                    <Input
                      type="number"
                      value={effective.rt}
                      onChange={(e) => handleEdit(tariff.id as TariffId, "rt", e.target.value)}
                      className="h-7 text-xs bg-white/5 border-white/10 text-white"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-[10px] text-white/30 pr-24">
                  S={effective.S}₽ · rd={effective.rd}₽/км · rt={effective.rt}₽/мин · Ktod=×{ktod.toFixed(1)}
                </div>
              )}

              {/* Edit button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingTariff(isEditing ? null : tariff.id as TariffId);
                }}
                className="absolute left-3 bottom-2.5"
              >
                {isEditing ? (
                  <Check className="h-3 w-3 text-green-400" />
                ) : (
                  <Pencil className="h-3 w-3 text-white/20 hover:text-white/50" />
                )}
              </button>
            </button>
          );
        })}
      </div>
    </div>
  );
}
