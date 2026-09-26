/**
 * Item Creator Timing Model v1.
 *
 * These identifiers describe *authority*, not merely display units.
 * - persistent: availability owns lifetime (Owned/Equipped/Attuned/Level).
 * - worldTime: Foundry world time owns lifetime; one interval follows CONFIG.time.roundTime (normally 6s).
 * - rest: D&D5e rest/calendar events own lifetime/recovery.
 * - combat: exact Combat boundaries own lifetime; no fake World Time fallback.
 * - native: the D&D5e Activity/Spell contract owns timing.
 */
export const TIMING_MODELS = Object.freeze({
  PERSISTENT: "persistent",
  WORLD_TIME: "worldTime",
  REST: "rest",
  COMBAT: "combat",
  NATIVE: "native"
});

export const WORLD_TIME_UNITS = Object.freeze([
  ["intervals", "6-Second Intervals"],
  ["minutes", "Minutes"],
  ["hours", "Hours"],
  ["days", "Days"]
]);

export const REST_LIFETIMES = Object.freeze([
  ["shortOrLongRest", "Until next Short or Long Rest"],
  ["longRest", "Until next Long Rest"]
]);

export const COMBAT_BOUNDARIES = Object.freeze([
  ["ownerTurnEndCurrent", "End of Source Actor's Current Turn"],
  ["ownerTurnStartNext", "Start of Source Actor's Next Turn"],
  ["ownerTurnEndNext", "End of Source Actor's Next Turn"],
  ["recipientTurnEndCurrent", "End of Effect Recipient's Current Turn"],
  ["recipientTurnStartNext", "Start of Effect Recipient's Next Turn"],
  ["recipientTurnEndNext", "End of Effect Recipient's Next Turn"]
]);

export function timingRoundSeconds() {
  return Math.max(1, Number(globalThis.CONFIG?.time?.roundTime) || 6);
}

export function worldTimeDurationSeconds(amount = 1, unit = "intervals") {
  const value = Math.max(1, Number(amount) || 1);
  if (unit === "minutes") return value * 60;
  if (unit === "hours") return value * 3600;
  if (unit === "days") return value * 86400;
  return value * timingRoundSeconds();
}

export function worldTimeTicksElapsed(previousWorldTime, currentWorldTime, amount = 1, unit = "intervals") {
  const step = worldTimeDurationSeconds(amount, unit);
  if (!(step > 0)) return 0;
  const previous = Number(previousWorldTime);
  const current = Number(currentWorldTime);
  if (!Number.isFinite(previous) || !Number.isFinite(current) || current <= previous) return 0;
  return Math.max(0, Math.floor((current - previous) / step));
}

export function normalizeWorldTimeUnit(value, fallback = "intervals") {
  return WORLD_TIME_UNITS.some(([unit]) => unit === value) ? value : fallback;
}

export function normalizeTimingModel(value, fallback = TIMING_MODELS.WORLD_TIME) {
  return Object.values(TIMING_MODELS).includes(value) ? value : fallback;
}

/** Translate old duration vocabulary into Timing Model v1 without changing intent more than necessary. */
export function legacyDurationToTiming({ durationMode = "", durationValue = 1 } = {}) {
  const amount = Math.max(1, Number(durationValue) || 1);
  if (durationMode === "permanent") return { model: TIMING_MODELS.PERSISTENT, amount: 1, unit: "permanent", rest: "" };
  if (["shortOrLongRest", "longRest"].includes(durationMode)) {
    return { model: TIMING_MODELS.REST, amount: 1, unit: "", rest: durationMode };
  }
  if (["minutes", "hours", "days"].includes(durationMode)) {
    return { model: TIMING_MODELS.WORLD_TIME, amount, unit: durationMode, rest: "" };
  }
  // Legacy rounds/turns were already implemented as D&D time outside Combat in 0.7.94+.
  // Timing Model v1 makes that behavior explicit and removes the misleading turn vocabulary.
  if (["rounds", "turns", "ownerTurns", "recipientTurns", "combatTurns"].includes(durationMode)) {
    return { model: TIMING_MODELS.WORLD_TIME, amount, unit: "intervals", rest: "" };
  }
  return { model: TIMING_MODELS.REST, amount: 1, unit: "", rest: "longRest" };
}

export function timingToLegacyDuration(timing = {}) {
  const model = normalizeTimingModel(timing.model, TIMING_MODELS.REST);
  if (model === TIMING_MODELS.PERSISTENT) return { durationMode: "permanent", durationValue: 1 };
  if (model === TIMING_MODELS.REST) return { durationMode: timing.rest === "shortOrLongRest" ? "shortOrLongRest" : "longRest", durationValue: 1 };
  if (model === TIMING_MODELS.WORLD_TIME) {
    const unit = normalizeWorldTimeUnit(timing.unit);
    return { durationMode: unit === "intervals" ? "rounds" : unit, durationValue: Math.max(1, Number(timing.amount) || 1) };
  }
  return { durationMode: "longRest", durationValue: 1 };
}
