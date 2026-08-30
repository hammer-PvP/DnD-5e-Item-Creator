/**
 * Restores the non-destructive Homebrew curation marker used by built-in
 * Supplier templates. An earlier migration flattened these markers into
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
    if (name.includes("crafting") || name.includes("smithing-material")) return "craftingBlacksmithMaterials";
    if (name.includes("named-magic")) return "blacksmithNamed";
    if (name.includes("enchanted-ammunition")) return "blacksmithMagicAmmunition";
    if (name.includes("two-handed")) return "blacksmithTwoHanded";
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
    if (category === "loot" && (name.includes("crafting") || name.includes("reagent") || name.includes("essence"))) return "craftingAlchemistMaterials";
    if (name.includes("oil") || name.includes("powder") || name.includes("preparation")) return "alchemicalPreparations";
    return "alchemicalConsumables";
  }
  if (template === "herbalist") {
    if (category === "tool") return "herbalistMundaneTools";
    if (category === "container") return "alchemistMundaneContainers";
    if (category === "loot") return "craftingHerbalistMaterials";
    return "alchemistMundaneConsumables";
  }
  if (template === "hunter") {
    if (name.includes("forage") || name.includes("herb") || name.includes("root") || name.includes("fung")) return "craftingHunterForage";
    return "craftingHunterMaterials";
  }
  if (template === "butcher") return "craftingButcherMaterials";
  if (template === "tavern-common") return "craftingTavern-common";
  if (template === "tavern-dwarven") return "craftingTavern-dwarven";
  if (template === "tavern-elven") return "craftingTavern-elven";
  if (template === "magic") {
    if (name.includes("crafting") || name.includes("essence")) return "craftingMagicMaterials";
    if (category === "spellScroll" || name.includes("spell-scroll")) return "excludeCantrips";
    if (name.includes("relic")) return "magicRelics";
    return "magicAssortment";
  }
  if (template === "general") {
    if (name.includes("crafting") || name.includes("trade-material")) return "craftingGeneralTradeMaterials";
    if (category === "loot") return "generalTradeLoot";
    if (category === "consumable") return "generalTradeConsumables";
    if (category === "equipment") return "generalTradeEquipment";
    return "generalTradeMundane";
  }
  if (template === "stable") {
    if (name.includes("animal") || name.includes("mount")) {
      const access = ["1", "2", "3", "4"].includes(String(profile?.homebrewAccessLevel))
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
    // Template rules created by Supplier carry their curation explicitly.
    // A GM-added rule is deliberately left uncategorized so a derived
    // Homebrew profile can use the same global Custom pool as a Blank profile.
    // Only an explicitly template-owned legacy rule may recover a missing
    // marker; never infer curation merely because the profile has an archetype.
    if (rule.homebrewTemplateRule === true && !rule.homebrewCuration) {
      rule.homebrewCuration = inferHomebrewCuration(profile, rule);
    }
    rule.homebrewCuration = String(rule.homebrewCuration ?? "");
    rule.homebrewTemplateRule = rule.homebrewTemplateRule === true;
    rule.generatorResultCuration = String(rule.generatorResultCuration ?? "");
    rule.materializerExclusions = Array.isArray(rule.materializerExclusions)
      ? [...new Set(rule.materializerExclusions.map(String))]
      : [];
  }
  return profile;
}
