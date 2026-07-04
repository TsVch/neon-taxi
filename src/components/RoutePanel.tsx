// ============================================================================
// RoutePanel — Панель ввода адресов с автодополнением
// ============================================================================

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Navigation,
  MapPin,
  ArrowRight,
  Loader2,
  Search,
} from "lucide-react";
import type { GeocodedPlace, PlannedRoute } from "@/types/taximeter";
import { searchAddresses, geocodeAddress, getRoute } from "@/utils/routing";
import { cn } from "@/lib/utils";

interface RoutePanelProps {
  onRouteReady: (route: PlannedRoute, from: GeocodedPlace, to: GeocodedPlace) => void;
  onFromCoords: (coords: [number, number] | null) => void;
  onToCoords: (coords: [number, number] | null) => void;
  isInTrip: boolean;
}

// ---------------------------------------------------------------------------
// Вспомогательный компонент: поле ввода с автодополнением
// ---------------------------------------------------------------------------

interface AddressInputProps {
  placeholder: string;
  icon: React.ReactNode;
  dotColor: string;
  value: string;
  onChange: (val: string) => void;
  onSelect: (place: GeocodedPlace) => void;
  onClear: () => void;
  disabled: boolean;
}

function AddressInput({
  placeholder,
  icon,
  dotColor,
  value,
  onChange,
  onSelect,
  onClear,
  disabled,
}: AddressInputProps) {
  const [suggestions, setSuggestions] = useState<GeocodedPlace[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [selected, setSelected] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Закрываем дропдаун при клике вне компонента
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setActiveIdx(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Очищаем таймер при размонтировании
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      onChange(val);

      if (!val) {
        onClear();
        setSelected(false);
        setSuggestions([]);
        setShowDropdown(false);
        setActiveIdx(-1);
        return;
      }

      setSelected(false);
      setActiveIdx(-1);

      // Debounced search
      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(async () => {
        if (val.trim().length < 2) {
          setSuggestions([]);
          setShowDropdown(false);
          return;
        }

        setIsSearching(true);
        const results = await searchAddresses(val.trim());
        setSuggestions(results);
        setShowDropdown(results.length > 0);
        setIsSearching(false);
      }, 300);
    },
    [onChange, onClear],
  );

  const handleSelect = useCallback(
    (place: GeocodedPlace) => {
      onSelect(place);
      setSelected(true);
      setShowDropdown(false);
      setSuggestions([]);
      setActiveIdx(-1);
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showDropdown || suggestions.length === 0) {
        if (e.key === "Enter" && value.trim() && !selected) {
          // Если ничего не выбрано и нажали Enter — ищем напрямую
          e.preventDefault();
          geocodeAddress(value.trim()).then((place) => {
            if (place) handleSelect(place);
          });
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIdx((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIdx((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
          break;
        case "Enter":
          e.preventDefault();
          if (activeIdx >= 0 && activeIdx < suggestions.length) {
            handleSelect(suggestions[activeIdx]);
          }
          break;
        case "Escape":
          setShowDropdown(false);
          setActiveIdx(-1);
          break;
      }
    },
    [showDropdown, suggestions, activeIdx, handleSelect, value, selected],
  );

  // Сокращаем displayName для отображения в списке
  const formatSuggestion = (place: GeocodedPlace): { main: string; sub: string } => {
    const parts = place.displayName.split(",").map((s) => s.trim());
    // Часто структура: "Улица, Дом, Район, Город, Область, Страна, Индекс"
    // Берём первые 2-3 значимые части
    const main = parts.slice(0, 2).join(", ");
    const sub = parts.slice(2, 5).join(", ");
    return { main, sub };
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        {icon}
        <Input
          ref={inputRef}
          placeholder={placeholder}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0 && !selected) setShowDropdown(true);
          }}
          disabled={disabled}
          className="pl-10 pr-10 bg-white/5 border-white/10 text-white placeholder:text-white/30"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {isSearching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-white/30" />
          ) : selected ? (
            <div className={cn("w-2 h-2 rounded-full", dotColor)} />
          ) : null}
        </div>
      </div>

      {/* Выпадающий список подсказок */}
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-slate-900 border border-white/10 rounded-lg shadow-2xl overflow-hidden">
          {suggestions.map((place, idx) => {
            const { main, sub } = formatSuggestion(place);
            return (
              <button
                key={`${place.lat}-${place.lon}-${idx}`}
                type="button"
                className={cn(
                  "w-full text-left px-3 py-2.5 transition-colors duration-100 flex items-start gap-3",
                  "hover:bg-white/5 border-b border-white/5 last:border-0",
                  idx === activeIdx && "bg-white/10",
                )}
                onMouseDown={(e) => {
                  e.preventDefault(); // предотвращаем blur
                  handleSelect(place);
                }}
                onMouseEnter={() => setActiveIdx(idx)}
              >
                <Search className="h-4 w-4 text-white/30 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{main}</p>
                  {sub && sub !== main && (
                    <p className="text-[11px] text-white/40 truncate mt-0.5">{sub}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RoutePanel
// ---------------------------------------------------------------------------

export default function RoutePanel({
  onRouteReady,
  onFromCoords,
  onToCoords,
  isInTrip,
}: RoutePanelProps) {
  const [fromAddress, setFromAddress] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromPlace, setFromPlace] = useState<GeocodedPlace | null>(null);
  const [toPlace, setToPlace] = useState<GeocodedPlace | null>(null);

  /** Форматирует displayName Nominatim в читаемый краткий адрес */
  const formatAddress = useCallback((displayName: string): string => {
    const parts = displayName.split(",").map((s) => s.trim());
    // Отфильтровываем: Россия, почтовые индексы, федеральные округа
    const filtered = parts.filter((p) => {
      const lower = p.toLowerCase();
      return (
        lower !== "россия" &&
        lower !== "russia" &&
        !/^\d{6}$/.test(p) &&
        !lower.includes("федеральный округ") &&
        !lower.includes("федерал") &&
        !lower.includes("federal")
      );
    });
    // Показываем до 3 значимых частей: улица, дом, город/район
    return filtered.slice(0, 3).join(", ");
  }, []);

  const handleFromSelect = useCallback(
    (place: GeocodedPlace) => {
      setFromPlace(place);
      onFromCoords([place.lat, place.lon]);
      setFromAddress(formatAddress(place.displayName));
      setError(null);
    },
    [onFromCoords, formatAddress],
  );

  const handleToSelect = useCallback(
    (place: GeocodedPlace) => {
      setToPlace(place);
      onToCoords([place.lat, place.lon]);
      setToAddress(formatAddress(place.displayName));
      setError(null);
    },
    [onToCoords, formatAddress],
  );

  const handleFromClear = useCallback(() => {
    setFromPlace(null);
    onFromCoords(null);
  }, [onFromCoords]);

  const handleToClear = useCallback(() => {
    setToPlace(null);
    onToCoords(null);
  }, [onToCoords]);

  const handleBuildRoute = useCallback(async () => {
    if (!fromPlace || !toPlace) {
      setError("Сначала укажите оба адреса");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const route = await getRoute(
        { lat: fromPlace.lat, lon: fromPlace.lon },
        { lat: toPlace.lat, lon: toPlace.lon },
      );

      if (route) {
        onRouteReady(route, fromPlace, toPlace);
      } else {
        setError("Не удалось построить маршрут. Попробуйте другие адреса.");
      }
    } catch (err) {
      setError("Ошибка при построении маршрута");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [fromPlace, toPlace, onRouteReady]);

  const handleSwapAddresses = useCallback(() => {
    setFromAddress(toAddress);
    setToAddress(fromAddress);
    setFromPlace(toPlace);
    setToPlace(fromPlace);
    onFromCoords(toPlace ? [toPlace.lat, toPlace.lon] : null);
    onToCoords(fromPlace ? [fromPlace.lat, fromPlace.lon] : null);
  }, [toAddress, fromAddress, toPlace, fromPlace, onFromCoords, onToCoords]);

  return (
    <div className="space-y-3" role="search" aria-label="Ввод адресов маршрута">
      {/* Откуда */}
      <AddressInput
        placeholder="Откуда?"
        icon={
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-400 pointer-events-none" />
        }
        dotColor="bg-green-400"
        value={fromAddress}
        onChange={(val) => {
          setFromAddress(val);
          if (!val) {
            setFromPlace(null);
            onFromCoords(null);
          }
        }}
        onSelect={handleFromSelect}
        onClear={handleFromClear}
        disabled={isInTrip || isLoading}
      />

      {/* Кнопка обмена адресов */}
      <div className="flex justify-center -my-1 relative z-10">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-full bg-black/60 border border-white/10 hover:bg-white/10"
          onClick={handleSwapAddresses}
          disabled={isInTrip}
          title="Поменять местами"
        >
          <ArrowRight className="h-3 w-3 text-white/60 rotate-90" />
        </Button>
      </div>

      {/* Куда */}
      <AddressInput
        placeholder="Куда?"
        icon={
          <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-red-400 pointer-events-none" />
        }
        dotColor="bg-red-400"
        value={toAddress}
        onChange={(val) => {
          setToAddress(val);
          if (!val) {
            setToPlace(null);
            onToCoords(null);
          }
        }}
        onSelect={handleToSelect}
        onClear={handleToClear}
        disabled={isInTrip || isLoading}
      />

      {/* Ошибка */}
      {error && (
        <p className="text-xs text-red-400 px-1" role="alert">{error}</p>
      )}

      {/* Кнопка построения маршрута */}
      <Button
        onClick={handleBuildRoute}
        disabled={
          isLoading ||
          !fromAddress.trim() ||
          !toAddress.trim() ||
          !fromPlace ||
          !toPlace ||
          isInTrip
        }
        className={cn(
          "w-full gap-2 transition-all duration-300",
          "bg-gradient-to-r from-blue-500 to-blue-600",
          "hover:from-blue-400 hover:to-blue-500",
          "text-white shadow-lg shadow-blue-500/20",
          "disabled:opacity-40 disabled:cursor-not-allowed",
        )}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Построение маршрута...
          </>
        ) : (
          <>
            <Navigation className="h-4 w-4" />
            Построить маршрут
          </>
        )}
      </Button>
    </div>
  );
}
