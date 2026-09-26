/**
 * Foundry V14 Effect changes use string `type` values. Numeric `mode` values are
 * legacy input only and are normalized here without consulting deprecated CONST.ACTIVE_EFFECT_MODES.
 */
export const EFFECT_CHANGE_TYPES = Object.freeze({
  CUSTOM: "custom",
  MULTIPLY: "multiply",
  ADD: "add",
  SUBTRACT: "subtract",
  DOWNGRADE: "downgrade",
  UPGRADE: "upgrade",
  OVERRIDE: "override"
});

const VALID = new Set(Object.values(EFFECT_CHANGE_TYPES));
const LEGACY_MODE_TO_TYPE = Object.freeze({
  0: EFFECT_CHANGE_TYPES.CUSTOM,
  1: EFFECT_CHANGE_TYPES.MULTIPLY,
  2: EFFECT_CHANGE_TYPES.ADD,
  3: EFFECT_CHANGE_TYPES.DOWNGRADE,
  4: EFFECT_CHANGE_TYPES.UPGRADE,
  5: EFFECT_CHANGE_TYPES.OVERRIDE
});

export function normalizeEffectChangeType(value, fallback = EFFECT_CHANGE_TYPES.ADD) {
  let candidate = value;
  if (value && typeof value === "object") {
    const currentType = String(value.type ?? "").trim();
    candidate = currentType ? currentType : value.mode;
  }
  const text = String(candidate ?? "").trim().toLowerCase();
  if (VALID.has(text)) return text;
  const numeric = Number(candidate);
  if (Number.isInteger(numeric) && LEGACY_MODE_TO_TYPE[numeric]) return LEGACY_MODE_TO_TYPE[numeric];
  return VALID.has(fallback) ? fallback : EFFECT_CHANGE_TYPES.ADD;
}

export function normalizeEffectChange(change = {}) {
  const normalized = foundry.utils.deepClone(change ?? {});
  normalized.type = normalizeEffectChangeType(normalized.type ?? normalized.mode);
  delete normalized.mode;
  return normalized;
}

export function normalizeEffectChanges(changes = []) {
  return Array.from(changes ?? [], change => normalizeEffectChange(change));
}
