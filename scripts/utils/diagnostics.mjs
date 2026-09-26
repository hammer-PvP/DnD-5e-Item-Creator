import { MODULE_ID } from "../constants.mjs";

export const DIAGNOSTICS_SETTING = "diagnostics";
export const DIAGNOSTIC_LEVELS = Object.freeze({ off: 0, errors: 1, verbose: 2 });

export function diagnosticMode() {
  try {
    const value = String(game.settings?.get?.(MODULE_ID, DIAGNOSTICS_SETTING) ?? "errors");
    return value in DIAGNOSTIC_LEVELS ? value : "errors";
  } catch (_error) {
    return "errors";
  }
}

export function diagnosticEnabled(level = "verbose") {
  const wanted = DIAGNOSTIC_LEVELS[level] ?? DIAGNOSTIC_LEVELS.verbose;
  return (DIAGNOSTIC_LEVELS[diagnosticMode()] ?? DIAGNOSTIC_LEVELS.errors) >= wanted;
}

function prefix(area, event) {
  const suffix = [area, event].map(value => String(value ?? "").trim()).filter(Boolean).join("][");
  return `${MODULE_ID} | [${suffix || "Diagnostics"}]`;
}

export function diagnosticLog(area, event, data = undefined) {
  if (!diagnosticEnabled("verbose")) return;
  if (data === undefined) console.info(prefix(area, event));
  else console.info(prefix(area, event), data);
}

export function diagnosticWarn(area, event, data = undefined) {
  if (!diagnosticEnabled("errors")) return;
  if (data === undefined) console.warn(prefix(area, event));
  else console.warn(prefix(area, event), data);
}

export function diagnosticError(area, event, error, data = undefined) {
  if (!diagnosticEnabled("errors")) return;
  if (data === undefined) console.error(prefix(area, event), error);
  else console.error(prefix(area, event), data, error);
}
