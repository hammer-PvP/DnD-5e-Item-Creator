import { normalizeRarity, normalizeText } from "./catalog.mjs";

const RELIC_TERMS = Object.freeze([
  "relic", "artifact", "vestige", "legacy", "legendary-relic", "major-relic",
  "reliquia", "artefato", "vestigio", "legado"
]);

/** Preferred commercial tier. This is a weight recommendation, not normally
 * a hard lock. The party-level progression still controls which rarities are
 * unlocked at all. */
const AVAILABILITY_BY_RARITY = Object.freeze({
  none: 1,
  common: 1,
  uncommon: 1,
  rare: 2,
  veryRare: 3,
  legendary: 3,
  artifact: 4
});

/** Relative chance of merchandise from a preferred tier appearing at each
 * Vendor Access. Access below the preferred tier remains possible, preserving
 * rare fantasy finds in ordinary settlements without making them routine. */
const ACCESS_WEIGHT_MATRIX = Object.freeze({
  1: Object.freeze({ 1: 1, 2: 0.08, 3: 0.015, 4: 0 }),
  2: Object.freeze({ 1: 1, 2: 0.45, 3: 0.08, 4: 0.01 }),
  3: Object.freeze({ 1: 1, 2: 0.85, 3: 0.40, 4: 0.06 }),
  4: Object.freeze({ 1: 1, 2: 1, 3: 1, 4: 0.65 })
});
function rarityForAvailability(entry) {
  const direct = normalizeRarity(entry?.rarity);
  if (Object.hasOwn(AVAILABILITY_BY_RARITY, direct) && direct !== "none") return direct;

  const candidates = new Set(entry?.materializerRarities ?? []);
  for (const variant of entry?.sourceVariants ?? []) {
    const rarity = normalizeRarity(variant?.rarity);
    if (rarity && !["none", "varies"].includes(rarity)) candidates.add(rarity);
    for (const nested of variant?.materializerRarities ?? []) candidates.add(normalizeRarity(nested));
  }
  const ranked = [...candidates]
    .filter(rarity => Object.hasOwn(AVAILABILITY_BY_RARITY, rarity) && rarity !== "none")
    .sort((a, b) => AVAILABILITY_BY_RARITY[a] - AVAILABILITY_BY_RARITY[b]);
  return ranked[0] ?? direct ?? "none";
}


function explicitAccess(entry) {
  const candidates = [
    entry?.minimumVendorAccess,
    entry?.supplierMinimumAccess,
    entry?.flags?.["dnd5e-item-creator"]?.supplier?.minimumAccess,
    entry?.flags?.["dnd5e-item-creator"]?.minimumVendorAccess
  ];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 1) return Math.min(4, Math.max(1, Math.floor(numeric)));
  }
  return 0;
}

export function isRelicLikeEntry(entry) {
  const identity = normalizeText([
    entry?.identifier,
    entry?.name,
    entry?.baseItem,
    entry?.materializerFamily
  ].filter(Boolean).join(" "));
  return RELIC_TERMS.some(term => identity.includes(term));
}

/** Preferred Access tier used to weight ordinary merchandise. */
export function minimumVendorAccess(entry) {
  const explicit = explicitAccess(entry);
  if (explicit) return explicit;

  const rarity = rarityForAvailability(entry);
  let minimum = AVAILABILITY_BY_RARITY[rarity] ?? 1;
  if (isRelicLikeEntry(entry)) {
    if (["none", "common", "uncommon", "rare"].includes(rarity)) minimum = Math.max(minimum, 2);
    else if (rarity === "veryRare") minimum = Math.max(minimum, 3);
    else minimum = 4;
  }
  return Math.min(4, Math.max(1, minimum));
}

/** Hard Access restrictions are deliberately rare. Explicit metadata, major
 * relics, and artifacts remain true gates; ordinary rarity is weighted. */
export function hardMinimumVendorAccess(entry) {
  const explicit = explicitAccess(entry);
  if (explicit) return explicit;
  const rarity = rarityForAvailability(entry);
  if (rarity === "artifact") return 4;
  if (isRelicLikeEntry(entry)) {
    if (["legendary", "artifact"].includes(rarity)) return 4;
    if (rarity === "veryRare") return 3;
  }
  return 1;
}

export function profileAccessLevel(profile) {
  const numeric = Number(profile?.homebrewAccessLevel);
  if (!Number.isFinite(numeric)) return 2;
  return Math.min(4, Math.max(1, Math.floor(numeric)));
}

export function vendorAccessWeight(entry, profile) {
  const access = profileAccessLevel(profile);
  const preferred = minimumVendorAccess(entry);
  return Number(ACCESS_WEIGHT_MATRIX[access]?.[preferred] ?? 0);
}

export function vendorAccessWeightForRarity(rarity, profile, { relic = false } = {}) {
  const entry = { rarity, name: relic ? "relic" : "", identifier: relic ? "relic" : "" };
  return vendorAccessWeight(entry, profile);
}

export function vendorAccessAllowsEntry(entry, profile, rule = null) {
  const access = profileAccessLevel(profile);
  const ruleMinimum = Number(rule?.minimumVendorAccess ?? rule?.minimumAccess ?? 0);
  const ruleMaximum = Number(rule?.maximumVendorAccess ?? rule?.maximumAccess ?? 0);
  if (Number.isFinite(ruleMinimum) && ruleMinimum > 0 && access < ruleMinimum) return false;
  if (Number.isFinite(ruleMaximum) && ruleMaximum > 0 && access > ruleMaximum) return false;
  return access >= hardMinimumVendorAccess(entry);
}
