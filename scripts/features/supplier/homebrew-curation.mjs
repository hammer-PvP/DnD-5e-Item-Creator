/**
 * Restores the non-destructive Homebrew curation marker used by built-in
 * Supplier templates. v0.0.2b-v0.0.2d flattened these markers into
 * poolExclusions, which prevented newly supported materializers from entering
 * the same pools. This helper has no imports so settings migration can use it
 * without creating a catalog/settings cycle.
 */

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function inferHomebrewCuration(profile, rule) {
  if (rule?.homebrewCuration) return String(rule.homebrewCuration);
  const template = String(profile?.homebrewTemplateId ?? "");
  const name = normalize(rule?.name);
  const category = String(rule?.category ?? "");
  if (!template || !rule) return "";

  if (template === "blacksmith") {
    if (name.includes("named-magic")) return "blacksmithNamed";
    if (name.includes("ammunition")) return "blacksmithAmmunition";
    return "blacksmithBase";
  }
  if (template === "gunsmith") {
    if (name.includes("named-magic")) return "namedFirearms";
    if (name.includes("ammunition")) return "firearmAmmunition";
    if (name.includes("powder") || name.includes("suppl")) return "firearmSupplies";
    return "firearmWeapons";
  }
  if (template === "alchemist") {
    if (name.includes("oil") || name.includes("powder") || name.includes("preparation")) return "alchemicalPreparations";
    return "alchemicalConsumables";
  }
  if (template === "magic") {
    if (category === "spellScroll" || name.includes("spell-scroll")) return "excludeCantrips";
    return "magicAssortment";
  }
  if (template === "general") {
    if (category === "loot") return "generalTradeLoot";
    if (category === "consumable") return "generalTradeConsumables";
    if (category === "equipment") return "generalTradeEquipment";
    return "generalTradeMundane";
  }
  if (template === "stable") {
    if (name.includes("animal") || name.includes("mount")) {
      const access = ["1", "2", "3"].includes(String(profile?.homebrewAccessLevel))
        ? String(profile.homebrewAccessLevel)
        : "2";
      return `livestock-${access}`;
    }
    return "stableSupplies";
  }
  return "";
}

export function restoreHomebrewRuleCurations(profile) {
  if (!profile?.homebrewTemplateId) return profile;
  const rules = [
    ...(profile.mundaneCatalogRules ?? []),
    ...(profile.guaranteedRules ?? []),
    ...(profile.randomRules ?? [])
  ];
  for (const rule of rules) {
    rule.homebrewCuration ||= inferHomebrewCuration(profile, rule);
    rule.materializerExclusions = Array.isArray(rule.materializerExclusions)
      ? [...new Set(rule.materializerExclusions.map(String))]
      : [];
  }
  return profile;
}
