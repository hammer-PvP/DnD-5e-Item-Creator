import { MODULE_ID } from "../constants.mjs";

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function entry({
  id, label, group, classId = "", subclassId = "", aliases = [], identifiers = [],
  amountMultiplier = 1, unit = "uses", supportsDieSize = false, scaleHints = []
}) {
  return Object.freeze({
    id, label, group, classId, subclassId,
    aliases: Object.freeze([label, ...aliases]),
    identifiers: Object.freeze([id, ...identifiers].map(normalize)),
    amountMultiplier, unit, supportsDieSize,
    scaleHints: Object.freeze(scaleHints.map(normalize))
  });
}

export const RESOURCE_DICE = Object.freeze([4, 6, 8, 10, 12, 20]);
export const RESOURCE_CATEGORIES = Object.freeze([
  { id: "feature", label: "Class / Subclass Resource" },
  { id: "resourceDie", label: "Resource Die Size" },
  { id: "spellSlot", label: "Spell Slot" },
  { id: "pactSlot", label: "Pact Magic Slot" }
]);

/**
 * Canonical resources supported by the first Resource Modification runtime.
 * Balance is intentionally not enforced: the GM chooses what an Item grants.
 */
export const RESOURCE_REGISTRY = Object.freeze([
  // Barbarian
  entry({ id: "rage", label: "Rage", group: "Barbarian", classId: "barbarian", identifiers: ["rage"], unit: "uses" }),

  // Bard
  entry({ id: "bardic-inspiration", label: "Bardic Inspiration", group: "Bard", classId: "bard", identifiers: ["bardic-inspiration"], unit: "uses", supportsDieSize: true, scaleHints: ["bardic-inspiration", "inspiration"] }),

  // Cleric
  entry({ id: "cleric-channel-divinity", label: "Channel Divinity (Cleric)", group: "Cleric", classId: "cleric", aliases: ["Channel Divinity"], identifiers: ["channel-divinity"], unit: "uses" }),
  entry({ id: "divine-intervention", label: "Divine Intervention", group: "Cleric", classId: "cleric", identifiers: ["divine-intervention"], unit: "uses" }),
  entry({ id: "warding-flare", label: "Warding Flare", group: "Cleric — Light Domain", classId: "cleric", subclassId: "light", identifiers: ["warding-flare"], unit: "uses" }),
  entry({ id: "war-priest", label: "War Priest", group: "Cleric — War Domain", classId: "cleric", subclassId: "war", identifiers: ["war-priest"], unit: "uses" }),

  // Druid
  entry({ id: "wild-shape", label: "Wild Shape", group: "Druid", classId: "druid", identifiers: ["wild-shape"], unit: "uses" }),
  entry({ id: "natural-recovery", label: "Natural Recovery", group: "Druid — Circle of the Land", classId: "druid", subclassId: "land", identifiers: ["natural-recovery"], unit: "uses" }),

  // Fighter
  entry({ id: "second-wind", label: "Second Wind", group: "Fighter", classId: "fighter", identifiers: ["second-wind"], unit: "uses" }),
  entry({ id: "action-surge", label: "Action Surge", group: "Fighter", classId: "fighter", identifiers: ["action-surge"], unit: "uses" }),
  entry({ id: "indomitable", label: "Indomitable", group: "Fighter", classId: "fighter", identifiers: ["indomitable"], unit: "uses" }),
  entry({ id: "superiority-dice", label: "Superiority Dice", group: "Fighter — Battle Master", classId: "fighter", subclassId: "battle-master", aliases: ["Combat Superiority"], identifiers: ["combat-superiority", "superiority-dice"], unit: "dice", supportsDieSize: true, scaleHints: ["superiority-die", "combat-superiority"] }),
  entry({ id: "psi-warrior-psionic-energy", label: "Psionic Energy Dice (Psi Warrior)", group: "Fighter — Psi Warrior", classId: "fighter", subclassId: "psi-warrior", aliases: ["Psionic Energy Dice"], identifiers: ["psionic-energy-dice", "psionic-power"], unit: "dice", supportsDieSize: true, scaleHints: ["psionic-energy", "psi-warrior"] }),

  // Monk
  entry({ id: "focus-points", label: "Focus Points", group: "Monk", classId: "monk", aliases: ["Monk's Focus", "Focus"], identifiers: ["focus-points", "monks-focus", "focus"], unit: "points" }),
  entry({ id: "uncanny-metabolism", label: "Uncanny Metabolism", group: "Monk", classId: "monk", identifiers: ["uncanny-metabolism"], unit: "uses" }),
  entry({ id: "wholeness-of-body", label: "Wholeness of Body", group: "Monk — Warrior of the Open Hand", classId: "monk", subclassId: "open-hand", identifiers: ["wholeness-of-body"], unit: "uses" }),
  entry({ id: "martial-arts-die", label: "Martial Arts Die", group: "Monk", classId: "monk", identifiers: ["martial-arts"], unit: "die", supportsDieSize: true, scaleHints: ["martial-arts", "monk-die", "die"] }),

  // Paladin
  entry({ id: "lay-on-hands", label: "Lay on Hands", group: "Paladin", classId: "paladin", aliases: ["Lay On Hands"], identifiers: ["lay-on-hands"], amountMultiplier: 5, unit: "points" }),
  entry({ id: "paladin-channel-divinity", label: "Channel Divinity (Paladin)", group: "Paladin", classId: "paladin", aliases: ["Channel Divinity"], identifiers: ["channel-divinity"], unit: "uses" }),
  entry({ id: "faithful-steed", label: "Faithful Steed", group: "Paladin", classId: "paladin", identifiers: ["faithful-steed"], unit: "uses" }),

  // Ranger
  entry({ id: "favored-enemy", label: "Favored Enemy", group: "Ranger", classId: "ranger", identifiers: ["favored-enemy"], unit: "uses" }),
  entry({ id: "tireless", label: "Tireless", group: "Ranger", classId: "ranger", identifiers: ["tireless"], unit: "uses" }),
  entry({ id: "natures-veil", label: "Nature's Veil", group: "Ranger", classId: "ranger", aliases: ["Nature’s Veil"], identifiers: ["natures-veil"], unit: "uses" }),
  entry({ id: "dread-ambusher", label: "Dread Ambusher", group: "Ranger — Gloom Stalker", classId: "ranger", subclassId: "gloom-stalker", identifiers: ["dread-ambusher"], unit: "uses" }),

  // Rogue
  entry({ id: "soulknife-psionic-energy", label: "Psionic Energy Dice (Soulknife)", group: "Rogue — Soulknife", classId: "rogue", subclassId: "soulknife", aliases: ["Psionic Energy Dice"], identifiers: ["psionic-energy-dice", "psionic-power"], unit: "dice", supportsDieSize: true, scaleHints: ["psionic-energy", "soulknife"] }),
  entry({ id: "stroke-of-luck", label: "Stroke of Luck", group: "Rogue", classId: "rogue", identifiers: ["stroke-of-luck"], unit: "uses" }),

  // Sorcerer
  entry({ id: "sorcery-points", label: "Sorcery Points", group: "Sorcerer", classId: "sorcerer", aliases: ["Font of Magic"], identifiers: ["font-of-magic", "sorcery-points"], unit: "points" }),
  entry({ id: "innate-sorcery", label: "Innate Sorcery", group: "Sorcerer", classId: "sorcerer", identifiers: ["innate-sorcery"], unit: "uses" }),
  entry({ id: "restore-balance", label: "Restore Balance", group: "Sorcerer — Clockwork Sorcery", classId: "sorcerer", subclassId: "clockwork", identifiers: ["restore-balance"], unit: "uses" }),

  // Warlock
  entry({ id: "magical-cunning", label: "Magical Cunning", group: "Warlock", classId: "warlock", identifiers: ["magical-cunning"], unit: "uses" }),
  entry({ id: "healing-light", label: "Healing Light", group: "Warlock — Celestial", classId: "warlock", subclassId: "celestial", identifiers: ["healing-light"], unit: "dice", supportsDieSize: true, scaleHints: ["healing-light"] }),
  entry({ id: "steps-of-the-fey", label: "Steps of the Fey", group: "Warlock — Archfey", classId: "warlock", subclassId: "archfey", identifiers: ["steps-of-the-fey"], unit: "uses" }),
  entry({ id: "dark-ones-own-luck", label: "Dark One's Own Luck", group: "Warlock — Fiend", classId: "warlock", subclassId: "fiend", aliases: ["Dark One’s Own Luck"], identifiers: ["dark-ones-own-luck"], unit: "uses" }),
  entry({ id: "mystic-arcanum-6", label: "Mystic Arcanum (6th Level)", group: "Warlock", classId: "warlock", identifiers: ["mystic-arcanum-6", "mystic-arcanum-6th-level"], unit: "uses" }),
  entry({ id: "mystic-arcanum-7", label: "Mystic Arcanum (7th Level)", group: "Warlock", classId: "warlock", identifiers: ["mystic-arcanum-7", "mystic-arcanum-7th-level"], unit: "uses" }),
  entry({ id: "mystic-arcanum-8", label: "Mystic Arcanum (8th Level)", group: "Warlock", classId: "warlock", identifiers: ["mystic-arcanum-8", "mystic-arcanum-8th-level"], unit: "uses" }),
  entry({ id: "mystic-arcanum-9", label: "Mystic Arcanum (9th Level)", group: "Warlock", classId: "warlock", identifiers: ["mystic-arcanum-9", "mystic-arcanum-9th-level"], unit: "uses" }),

  // Wizard
  entry({ id: "arcane-recovery", label: "Arcane Recovery", group: "Wizard", classId: "wizard", identifiers: ["arcane-recovery"], unit: "uses" }),

  // Die-only convenience aliases
  entry({ id: "bardic-inspiration-die", label: "Bardic Inspiration Die", group: "Bard", classId: "bard", identifiers: ["bardic-inspiration"], unit: "die", supportsDieSize: true, scaleHints: ["bardic-inspiration", "inspiration"] }),
  entry({ id: "superiority-die", label: "Superiority Die", group: "Fighter — Battle Master", classId: "fighter", subclassId: "battle-master", identifiers: ["combat-superiority", "superiority-dice"], unit: "die", supportsDieSize: true, scaleHints: ["superiority-die", "combat-superiority"] }),
  entry({ id: "psi-warrior-psionic-die", label: "Psionic Energy Die (Psi Warrior)", group: "Fighter — Psi Warrior", classId: "fighter", subclassId: "psi-warrior", identifiers: ["psionic-energy-dice", "psionic-power"], unit: "die", supportsDieSize: true, scaleHints: ["psionic-energy", "psi-warrior"] }),
  entry({ id: "soulknife-psionic-die", label: "Psionic Energy Die (Soulknife)", group: "Rogue — Soulknife", classId: "rogue", subclassId: "soulknife", identifiers: ["psionic-energy-dice", "psionic-power"], unit: "die", supportsDieSize: true, scaleHints: ["psionic-energy", "soulknife"] })
]);

const REGISTRY_BY_ID = new Map(RESOURCE_REGISTRY.map(resource => [resource.id, resource]));

export function getResourceDefinition(id) {
  return REGISTRY_BY_ID.get(id) ?? null;
}

export function resourceGroups({ dieOnly = false } = {}) {
  const grouped = new Map();
  for (const resource of RESOURCE_REGISTRY) {
    if (dieOnly && !resource.supportsDieSize) continue;
    if (!dieOnly && resource.unit === "die" && resource.id.endsWith("-die")) continue;
    if (!grouped.has(resource.group)) grouped.set(resource.group, []);
    grouped.get(resource.group).push(resource);
  }
  return [...grouped.entries()].map(([label, items]) => ({
    label,
    items: items.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang))
  }));
}

export function defaultResourceModification(category = "feature") {
  const resource = category === "resourceDie"
    ? RESOURCE_REGISTRY.find(entry => entry.supportsDieSize)
    : RESOURCE_REGISTRY.find(entry => entry.unit !== "die");
  return {
    id: foundry.utils.randomID(),
    category,
    resourceId: resource?.id ?? "rage",
    amount: 1,
    operation: category === "resourceDie" ? "setMinimumDie" : "addMaximum",
    die: 10,
    spellLevel: 1,
    unlockOnLevel: false,
    unlockLevel: 1,
    availability: "equipped"
  };
}

export function normalizeResourceModification(modification = {}) {
  const category = RESOURCE_CATEGORIES.some(entry => entry.id === modification.category)
    ? modification.category : "feature";
  const normalized = {
    ...defaultResourceModification(category),
    ...foundry.utils.deepClone(modification),
    category
  };
  normalized.id ||= foundry.utils.randomID();
  normalized.amount = Math.max(1, Math.trunc(Number(normalized.amount) || 1));
  normalized.spellLevel = Math.clamp(Math.trunc(Number(normalized.spellLevel) || 1), 1, 9);
  normalized.die = RESOURCE_DICE.includes(Number(normalized.die)) ? Number(normalized.die) : 10;
  normalized.unlockOnLevel = Boolean(normalized.unlockOnLevel);
  normalized.unlockLevel = Math.clamp(Math.trunc(Number(normalized.unlockLevel) || 1), 1, 20);
  normalized.availability = ["owned", "equipped", "equippedAttuned"].includes(normalized.availability)
    ? normalized.availability : "equipped";
  if (category === "resourceDie") {
    normalized.operation = ["increaseSteps", "setMinimumDie", "setExactDie"].includes(normalized.operation)
      ? normalized.operation : "setMinimumDie";
  } else normalized.operation = "addMaximum";
  return normalized;
}

export function validateResourceModification(modification) {
  const row = normalizeResourceModification(modification);
  if (!RESOURCE_CATEGORIES.some(entry => entry.id === row.category)) return false;
  if (!["owned", "equipped", "equippedAttuned"].includes(row.availability)) return false;
  if (row.unlockOnLevel && !(row.unlockLevel >= 1 && row.unlockLevel <= 20)) return false;
  if (["feature", "resourceDie"].includes(row.category) && !getResourceDefinition(row.resourceId)) return false;
  if (["feature", "spellSlot", "pactSlot"].includes(row.category) && !(row.amount >= 1 && row.amount <= 99)) return false;
  if (row.category === "spellSlot" && !(row.spellLevel >= 1 && row.spellLevel <= 9)) return false;
  if (row.category === "resourceDie" && !RESOURCE_DICE.includes(row.die)) return false;
  return true;
}

function itemIdentity(item) {
  const identifier = normalize(item?.system?.identifier);
  const name = normalize(item?.name);
  const requirements = normalize(item?.system?.requirements);
  const source = normalize(item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? item?.flags?.dnd5e?.sourceId ?? "");
  const classIdentifier = normalize(item?.system?.classIdentifier ?? item?.system?.sourceClass ?? "");
  return {
    identifier, name, requirements, source, classIdentifier,
    text: `${identifier} ${name} ${requirements} ${source} ${classIdentifier}`
  };
}

function actorHasClass(actor, classId) {
  if (!classId) return true;
  return [...(actor?.items ?? [])].some(item => item.type === "class"
    && [normalize(item.system?.identifier), normalize(item.name)].includes(normalize(classId)));
}

function actorHasSubclass(actor, subclassId) {
  if (!subclassId) return true;
  return [...(actor?.items ?? [])].some(item => item.type === "subclass"
    && `${normalize(item.system?.identifier)} ${normalize(item.name)}`.includes(normalize(subclassId)));
}

export function findResourceFeature(actor, definition) {
  if (!actor || !definition) return null;
  if (!actorHasClass(actor, definition.classId)) return null;
  if (definition.subclassId && !actorHasSubclass(actor, definition.subclassId)) return null;
  const ids = new Set(definition.identifiers.map(normalize));
  const aliases = new Set(definition.aliases.map(normalize));
  const classId = normalize(definition.classId);
  const subclassId = normalize(definition.subclassId);
  const candidates = [...actor.items].filter(item => ["feat", "class", "subclass"].includes(item.type));
  const scored = candidates.map(item => {
    const identity = itemIdentity(item);
    let score = 0;
    if (ids.has(identity.identifier)) score += 120;
    if (aliases.has(identity.name)) score += 100;
    for (const value of [...ids, ...aliases]) {
      if (value && identity.text.includes(value)) score += Math.min(50, value.length);
    }
    if (classId && identity.text.includes(classId)) score += 35;
    if (subclassId && identity.text.includes(subclassId)) score += 45;
    return { item, score };
  }).filter(entry => entry.score > 0).sort((left, right) => right.score - left.score);
  return scored[0]?.item ?? null;
}

export function featureUseTarget(feature) {
  if (!feature) return null;
  const itemMax = feature._source?.system?.uses?.max ?? feature.system?._source?.uses?.max;
  if (String(itemMax ?? "").trim()) return { path: "system.uses.max", sourceValue: itemMax };
  const activities = feature._source?.system?.activities ?? feature.system?._source?.activities ?? {};
  for (const [id, activity] of Object.entries(activities)) {
    const max = activity?.uses?.max;
    if (String(max ?? "").trim()) return { path: `system.activities.${id}.uses.max`, sourceValue: max };
  }
  // Some official features intentionally have a blank formula that the Item can safely turn into a pool.
  if (feature.system?.uses) return { path: "system.uses.max", sourceValue: itemMax ?? "" };
  return null;
}

function walkScales(value, path = "system.scale", rows = []) {
  if (!value || typeof value !== "object") return rows;
  for (const [key, child] of Object.entries(value)) {
    const next = `${path}.${key}`;
    if (child && typeof child === "object") {
      if (Number.isFinite(Number(child.faces))) rows.push({ path: `${next}.faces`, value: Number(child.faces), identity: normalize(next) });
      else if ("die" in child) rows.push({ path: `${next}.die`, value: child.die, identity: normalize(next) });
      else if (typeof child.value === "string" && /^d?\d+$/i.test(child.value)) rows.push({ path: `${next}.value`, value: child.value, identity: normalize(next) });
      walkScales(child, next, rows);
    }
  }
  return rows;
}

export function findResourceScale(actor, definition) {
  if (!actor || !definition) return null;
  const scales = walkScales(actor.system?.scale ?? {});
  const hints = new Set([definition.id, ...definition.scaleHints, ...definition.identifiers, ...definition.aliases].map(normalize));
  const scored = scales.map(scale => ({
    ...scale,
    score: [...hints].reduce((score, hint) => score + (hint && scale.identity.includes(hint) ? hint.length : 0), 0)
  })).sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0] : null;
}

export function resourceModificationLabel(modification) {
  const row = normalizeResourceModification(modification);
  if (row.category === "spellSlot") return `+${row.amount} ${ordinal(row.spellLevel)}-level Spell Slot${row.amount === 1 ? "" : "s"}`;
  if (row.category === "pactSlot") return `+${row.amount} Pact Magic Slot${row.amount === 1 ? "" : "s"}`;
  const definition = getResourceDefinition(row.resourceId);
  if (row.category === "resourceDie") {
    const operation = row.operation === "increaseSteps" ? `increase ${row.amount} die step${row.amount === 1 ? "" : "s"}`
      : row.operation === "setExactDie" ? `set to d${row.die}` : `minimum d${row.die}`;
    return `${definition?.label ?? "Resource Die"}: ${operation}`;
  }
  const amount = row.amount * (definition?.amountMultiplier ?? 1);
  return `${definition?.label ?? "Resource"}: +${amount} ${definition?.unit ?? "uses"}`;
}

function ordinal(level) {
  const suffix = level === 1 ? "st" : level === 2 ? "nd" : level === 3 ? "rd" : "th";
  return `${level}${suffix}`;
}

export function auditResourceDefinitions(actor) {
  return RESOURCE_REGISTRY.map(definition => ({
    id: definition.id,
    label: definition.label,
    feature: findResourceFeature(actor, definition)?.name ?? null,
    useTarget: featureUseTarget(findResourceFeature(actor, definition))?.path ?? null,
    scaleTarget: definition.supportsDieSize ? findResourceScale(actor, definition)?.path ?? null : null
  }));
}

export const RESOURCE_RUNTIME_FLAG = `${MODULE_ID}.resourceRuntime`;
