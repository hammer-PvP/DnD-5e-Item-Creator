/** Known compatibility resolvers for official blueprints whose native Enchant
 * restrictions are intentionally broad or incomplete in indexed data. */

export function normalizeIdentity(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function valuesOf(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (value instanceof Map) return [...value.values()];
  if (typeof value.values === "function") {
    try { return [...value.values()]; } catch (_error) { /* Continue. */ }
  }
  if (typeof value === "object") return Object.values(value);
  return [value];
}

function identityText(data) {
  return normalizeIdentity([
    data?.name,
    foundry.utils.getProperty(data, "system.identifier"),
    foundry.utils.getProperty(data, "system.type.baseItem")
  ].filter(Boolean).join(" "));
}

function itemCategory(data) {
  return normalizeIdentity(foundry.utils.getProperty(data, "system.type.value"));
}

function isArmor(data) {
  if (data?.type !== "equipment") return false;
  return ["light", "medium", "heavy"].includes(itemCategory(data));
}

function isMediumOrHeavyArmor(data) {
  return data?.type === "equipment" && ["medium", "heavy"].includes(itemCategory(data));
}

function isMeleeWeapon(data) {
  if (data?.type !== "weapon") return false;
  const category = itemCategory(data);
  if (category.endsWith("m") || category.includes("melee")) return true;
  const rangeUnits = normalizeIdentity(foundry.utils.getProperty(data, "system.range.units"));
  return !rangeUnits || rangeUnits === "reach" || rangeUnits === "touch";
}

function flattenedStrings(value, output = []) {
  if (typeof value === "string" || typeof value === "number") output.push(String(value));
  else if (value && typeof value === "object") {
    for (const child of valuesOf(value)) flattenedStrings(child, output);
  }
  return output;
}

function damageTypes(data) {
  const output = new Set();
  const direct = foundry.utils.getProperty(data, "system.damage.base.types");
  for (const value of valuesOf(direct)) output.add(normalizeIdentity(value));
  const activities = foundry.utils.getProperty(data, "system.activities");
  for (const activity of valuesOf(activities)) {
    for (const value of flattenedStrings(activity?.damage?.parts ?? activity?.damage ?? [])) {
      const normalized = normalizeIdentity(value);
      for (const type of ["slashing", "piercing", "bludgeoning"]) {
        if (normalized === type || normalized.includes(type)) output.add(type);
      }
    }
  }
  return output;
}

function isSword(data) {
  if (!isMeleeWeapon(data)) return false;
  const identity = identityText(data);
  const terms = [
    "sword", "longsword", "shortsword", "greatsword", "scimitar", "rapier",
    "sabre", "saber", "blade", "falchion", "katana", "espada", "cimitarra"
  ];
  if (terms.some(term => identity.includes(term))) return true;
  return damageTypes(data).has("slashing") && !identity.includes("axe") && !identity.includes("machado");
}

function exactBase(data, terms) {
  const identity = identityText(data);
  return terms.some(term => identity === term || identity.includes(term));
}

export const SELF_CONTAINED_ENCHANT_ITEMS = Object.freeze(new Set([
  "helm-of-brilliance"
]));

export function isSelfContainedSellableData(documentOrData) {
  const data = documentOrData?.toObject ? documentOrData.toObject() : documentOrData ?? {};
  const identity = identityText(data);
  return [...SELF_CONTAINED_ENCHANT_ITEMS].some(term => identity.includes(term));
}

/**
 * Return true/false for a known official family, or null when no special rule
 * exists and native restrictions should be the sole authority.
 */
export function knownBaseCompatibility(blueprintDocumentOrData, baseDocumentOrData) {
  const blueprint = blueprintDocumentOrData?.toObject ? blueprintDocumentOrData.toObject() : blueprintDocumentOrData ?? {};
  const base = baseDocumentOrData?.toObject ? baseDocumentOrData.toObject() : baseDocumentOrData ?? {};
  const identity = identityText(blueprint);

  if (identity.includes("efreeti-chain") || identity.includes("efreet-chain")) {
    return base.type === "equipment" && exactBase(base, ["chain-mail", "chainmail"]);
  }
  if (identity.includes("armor-of-vulnerability")) {
    return base.type === "equipment" && exactBase(base, ["plate-armor", "plate"]);
  }
  if (identity.includes("vorpal")) {
    return isSword(base) && damageTypes(base).has("slashing");
  }
  if (identity.includes("flame-tongue") || identity.includes("life-stealing")) {
    return isSword(base);
  }
  if (identity.includes("adamantine-armor")) {
    return isMediumOrHeavyArmor(base) && !exactBase(base, ["hide-armor", "hide"]);
  }
  if (identity.includes("mithral-armor")) {
    return isMediumOrHeavyArmor(base);
  }
  if (identity.includes("armor-of-resistance")) {
    return isArmor(base);
  }
  return null;
}

export function isAmmunitionData(documentOrData) {
  const data = documentOrData?.toObject ? documentOrData.toObject() : documentOrData ?? {};
  const category = itemCategory(data);
  const identity = identityText(data);
  return ["ammo", "ammunition"].includes(category)
    || identity.includes("ammunition")
    || identity.includes("arrow")
    || identity.includes("crossbow-bolt")
    || identity.includes("blowgun-needle");
}
