import { normalizeEffectChanges } from "./effect-change-types.mjs";

/**
 * D&D5e 6.x compatibility helpers.
 *
 * Item Creator v0.7.91+ targets the D&D5e 6.0.x compatibility line. These helpers keep
 * the authoring/runtime code readable while ensuring persisted Item and Active
 * Effect data uses the 6.x schema rather than relying on legacy shims.
 */

const LEGACY_EFFECT_PATHS = Object.freeze({
  "system.attributes.concentration.bonuses.save": "system.attributes.concentration.roll.bonus",
  "system.attributes.death.bonuses.save": "system.attributes.death.roll.bonus",
  "system.attributes.init.bonus": "system.attributes.init.roll.bonus",
  "system.bonuses.mwak.attack": "system.rolls.attack.mwak.bonus",
  "system.bonuses.msak.attack": "system.rolls.attack.msak.bonus",
  "system.bonuses.rwak.attack": "system.rolls.attack.rwak.bonus",
  "system.bonuses.rsak.attack": "system.rolls.attack.rsak.bonus",
  "system.bonuses.mwak.damage": "system.rolls.damage.mwak.bonus",
  "system.bonuses.msak.damage": "system.rolls.damage.msak.bonus",
  "system.bonuses.rwak.damage": "system.rolls.damage.rwak.bonus",
  "system.bonuses.rsak.damage": "system.rolls.damage.rsak.bonus",
  "system.bonuses.abilities.check": "system.rolls.ability.check.bonus",
  "system.bonuses.abilities.save": "system.rolls.ability.save.bonus",
  "system.bonuses.abilities.skill": "system.rolls.ability.skill.bonus"
});

function valuesOf(value) {
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return [...value];
  if (value instanceof Map) return [...value.values()];
  if (value?.values instanceof Function) {
    try { return [...value.values()]; } catch (_error) { /* fall through */ }
  }
  if (value && typeof value === "object") return Object.values(value);
  return [];
}


/**
 * Normalize D&D5e identifiers to the current persisted contract. D&D5e 6.x
 * accepts only ASCII letters, numbers, dashes, and underscores. Existing valid
 * identifiers are preserved byte-for-byte apart from lowercase normalization;
 * legacy accented names are transliterated rather than rejected.
 */
export function normalizeDnd5eIdentifier(value, { fallback = "" } = {}) {
  const normalize = input => {
    const direct = String(input ?? "").trim().toLowerCase();
    if (/^[a-z0-9_-]+$/.test(direct)) return direct;
    return direct
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
  };
  return normalize(value) || normalize(fallback);
}

/** Return the primary/lowest rarity without invoking D&D5e's legacy rarity shim. */
export function primaryItemRarity(value) {
  const sourceSystem = value?._source?.system ?? null;
  const sourceRarities = valuesOf(sourceSystem?.rarities).map(entry => String(entry ?? "").trim()).filter(Boolean);
  if (sourceRarities.length) return sourceRarities[0];
  if (sourceSystem && Object.prototype.hasOwnProperty.call(sourceSystem, "rarity")) {
    const legacy = String(sourceSystem.rarity ?? "").trim();
    if (legacy) return legacy;
  }

  const system = value?.system ?? value ?? {};
  const rarities = valuesOf(system?.rarities).map(entry => String(entry ?? "").trim()).filter(Boolean);
  if (rarities.length) return rarities[0];
  if (Object.prototype.hasOwnProperty.call(system, "rarity")) {
    const direct = String(system.rarity ?? "").trim();
    if (direct) return direct;
  }
  return "";
}

/** Persist one Item Creator rarity using the D&D5e 6.x `system.rarities` field. */
export function setPrimaryItemRarity(source, rarity) {
  source.system ??= {};
  const value = String(rarity ?? "").trim();
  source.system.rarities = value && value !== "none" ? [value] : [];
  delete source.system.rarity;
  return source;
}

/** Translate legacy D&D5e Active Effect roll paths to their 6.x equivalents. */
export function dnd6EffectPath(key) {
  const value = String(key ?? "");
  if (LEGACY_EFFECT_PATHS[value]) return LEGACY_EFFECT_PATHS[value];

  let match = value.match(/^system\.abilities\.([a-z]{3})\.bonuses\.(check|save)$/);
  if (match) return `system.abilities.${match[1]}.${match[2]}.roll.bonus`;

  match = value.match(/^system\.(skills|tools)\.([^.]+)\.bonuses\.check$/);
  if (match) return `system.${match[1]}.${match[2]}.roll.bonus`;

  // D&D5e 6.x persists Actor movement speeds under movement.speeds.*.
  // Keep hover at movement.hover; only the five speed fields moved.
  match = value.match(/^system\.attributes\.movement\.(walk|fly|swim|climb|burrow)$/);
  if (match) return `system.attributes.movement.speeds.${match[1]}`;

  return value;
}

/**
 * Normalize a complete Item source immediately before D&D5e document
 * construction/persistence. Internal Item Creator draft fields may continue to
 * use a single rarity value; the final source never relies on 5.3.3 shims.
 */
export function normalizeDnd6ItemSource(source) {
  if (!source || typeof source !== "object") return source;
  const system = source.system ??= {};

  const identifier = normalizeDnd5eIdentifier(system.identifier, { fallback: source.name });
  if (identifier) system.identifier = identifier;

  if (Object.prototype.hasOwnProperty.call(system, "rarity")) {
    const legacy = String(system.rarity ?? "").trim();
    const existing = valuesOf(system.rarities).map(entry => String(entry ?? "").trim()).filter(Boolean);
    system.rarities = existing.length ? existing : (legacy && legacy !== "none" ? [legacy] : []);
    delete system.rarity;
  } else if (system.rarities instanceof Set) system.rarities = [...system.rarities];

  for (const effect of valuesOf(source.effects)) {
    if (!effect || typeof effect !== "object") continue;
    const changes = normalizeEffectChanges(effect?.system?.changes ?? effect?.changes ?? []);
    for (const change of changes) {
      if (change?.key) change.key = dnd6EffectPath(change.key);
    }
    effect.system ??= {};
    effect.system.changes = changes;
    delete effect.changes;
  }
  return source;
}

export const DND6_LEGACY_EFFECT_PATHS = LEGACY_EFFECT_PATHS;
