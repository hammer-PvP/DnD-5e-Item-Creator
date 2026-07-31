import { normalizeRarity, normalizeText } from "./catalog.mjs";

const RELIC_TERMS = Object.freeze([
  "relic", "artifact", "vestige", "legacy", "legendary-relic", "major-relic",
  "reliquia", "artefato", "vestigio", "legado"
]);

const AVAILABILITY_BY_RARITY = Object.freeze({
  none: 1,
  common: 1,
  uncommon: 1,
  rare: 2,
  veryRare: 2,
  legendary: 3,
  artifact: 4
});

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

/**
 * Commercial availability is intentionally separate from party-level rarity.
 * Access III may sell ordinary legendary merchandise, while major relics and
 * artifacts remain reserved for Access IV. Simple relics can still appear at
 * lower access when their rarity and explicit metadata permit it.
 */
export function minimumVendorAccess(entry) {
  const explicit = explicitAccess(entry);
  if (explicit) return explicit;

  const rarity = normalizeRarity(entry?.rarity);
  let minimum = AVAILABILITY_BY_RARITY[rarity] ?? 1;
  if (isRelicLikeEntry(entry)) {
    if (["none", "common", "uncommon"].includes(rarity)) minimum = Math.max(minimum, 2);
    else if (rarity === "rare") minimum = Math.max(minimum, 2);
    else if (rarity === "veryRare") minimum = Math.max(minimum, 3);
    else minimum = 4;
  }
  return Math.min(4, Math.max(1, minimum));
}

export function profileAccessLevel(profile) {
  const numeric = Number(profile?.homebrewAccessLevel);
  if (!Number.isFinite(numeric)) return 2;
  return Math.min(4, Math.max(1, Math.floor(numeric)));
}

export function vendorAccessAllowsEntry(entry, profile, rule = null) {
  const access = profileAccessLevel(profile);
  const ruleMinimum = Number(rule?.minimumVendorAccess ?? rule?.minimumAccess ?? 0);
  const ruleMaximum = Number(rule?.maximumVendorAccess ?? rule?.maximumAccess ?? 0);
  if (Number.isFinite(ruleMinimum) && ruleMinimum > 0 && access < ruleMinimum) return false;
  if (Number.isFinite(ruleMaximum) && ruleMaximum > 0 && access > ruleMaximum) return false;
  return access >= minimumVendorAccess(entry);
}
