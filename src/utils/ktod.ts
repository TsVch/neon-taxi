// ============================================================================
// Ktod (Коэффициент времени оплаты) calculation
// ============================================================================

import type { KtodCoefficients } from "@/types/taximeter";
import { DEFAULT_KTOD } from "@/types/taximeter";

/**
 * Compute Ktod based on current day and time.
 *
 * Пн-Пт 06:00-22:00 → weekdayDay
 * Пн-Пт 22:00-06:00 → weekdayNight
 * Сб-Вс 09:00-22:00 → weekendDay
 * Сб-Вс 22:00-09:00 → weekendNight
 */
export function computeKtod(
  now: Date,
  coefs: KtodCoefficients = DEFAULT_KTOD,
): number {
  const day = now.getDay(); // 0=Sun, 6=Sat
  const hour = now.getHours();
  const isWeekend = day === 0 || day === 6;

  if (isWeekend) {
    return hour >= 9 && hour < 22 ? coefs.weekendDay : coefs.weekendNight;
  } else {
    return hour >= 6 && hour < 22 ? coefs.weekdayDay : coefs.weekdayNight;
  }
}

/**
 * Format the current Ktod period name in Russian.
 */
export function getKtodPeriodName(now: Date): string {
  const day = now.getDay();
  const hour = now.getHours();
  const isWeekend = day === 0 || day === 6;

  if (isWeekend) {
    return hour >= 9 && hour < 22
      ? "Выходной день (09:00-22:00)"
      : "Выходная ночь (22:00-09:00)";
  } else {
    return hour >= 6 && hour < 22
      ? "Будний день (06:00-22:00)"
      : "Будняя ночь (22:00-06:00)";
  }
}
