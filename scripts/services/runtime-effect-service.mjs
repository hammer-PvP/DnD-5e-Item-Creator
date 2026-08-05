import { MODULE_ID } from "../constants.mjs";
import { actorTotalLevel, selectProgressionTier, variantEligible } from "./level-progression.mjs";
import {
  RESOURCE_DICE, auditResourceDefinitions, featureUseTarget, findResourceFeature, findResourceScale,
  getResourceDefinition, normalizeResourceModification, validateResourceModification
} from "./resource-modification-registry.mjs";

function valuesOf(value) {
  if (value instanceof Map) return [...value.values()];
  if (Array.isArray(value)) return [...value];
  if (value?.values instanceof Function) {
    try { return [...value.values()]; } catch (_error) { /* fall through */ }
  }
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function isManagedItem(item) {
  return item?.documentName === "Item" && ["weapon", "equipment", "tool"].includes(item.type) && Boolean(item.getFlag(MODULE_ID, "created"));
}

function blueprintEffects(item) {
  return item.effects.filter(effect => effect.getFlag(MODULE_ID, "blueprint"));
}

function grantedSpellActivities(item) {
  return valuesOf(item.system?.activities).filter(activity =>
    activity?.type === "cast" && Boolean(activity?.flags?.[MODULE_ID]?.grantedSpell));
}

function activityConfig(activity) {
  return activity?.flags?.[MODULE_ID] ?? {};
}

function isAvailable(item, availability) {
  if (availability === "owned") return true;
  if (availability === "equipped") return Boolean(item.system.equipped);
  if (availability === "equippedAttuned") return Boolean(item.system.equipped && item.system.attuned);
  return false;
}

function isLevelAvailable(item, setting) {
  if (!setting?.unlockOnLevel) return true;
  const actor = item.parent?.documentName === "Actor" ? item.parent : null;
  return Boolean(actor && variantEligible(setting, actorTotalLevel(actor)));
}

function appendFormula(original, value) {
  const left = String(original ?? "").trim();
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return left;
  if (!left) return String(numeric);
  return `${left} ${numeric < 0 ? "-" : "+"} ${Math.abs(numeric)}`;
}

function damagePart({ number = 0, denomination = 0, bonus = "", damageType = "", ability = null } = {}) {
  let formula = String(bonus ?? "").trim();
  if (ability) {
    const abilityFormula = ability === "attack" ? "@mod"
      : ability === "spellcasting" ? "@abilities[@attributes.spellcasting].mod"
        : `@abilities.${ability}.mod`;
    formula = formula ? `${formula} + ${abilityFormula}` : abilityFormula;
  }
  return {
    number: Number(number) || 0,
    denomination: Number(denomination) || 0,
    bonus: formula,
    types: damageType ? [damageType] : [],
    custom: { enabled: false, formula: "" },
    scaling: { mode: "", number: 1, formula: "" }
  };
}

function equalData(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function intendedSpellbookState(item, activity, config) {
  if (typeof config.showInSpellbook === "boolean") return config.showInSpellbook;

  const sourceUuid = config.sourceSpellUuid ?? activity.spell?.uuid;
  const configured = (item.getFlag(MODULE_ID, "runtime")?.grantedSpells ?? [])
    .find(spell => spell.uuid === sourceUuid || spell.name === activity.name);
  if (typeof configured?.showInSpellbook === "boolean") return configured.showInSpellbook;

  // Compatibility with v0.1.3 and older items: before the intent was stored on
  // the Activity flag, the current native field was the only persisted signal.
  return Boolean(activity.spell?.spellbook);
}

function resourceConfigurations(item) {
  return (item?.getFlag?.(MODULE_ID, "runtime")?.resourceModifications ?? [])
    .map(normalizeResourceModification)
    .filter(validateResourceModification);
}

function resourceAvailable(item, setting, actorLevel) {
  if (!isAvailable(item, setting.availability ?? "equipped")) return false;
  return !setting.unlockOnLevel || actorLevel >= (Number(setting.unlockLevel) || 1);
}

function sourceValue(document, path) {
  return foundry.utils.getProperty(document?._source ?? {}, path);
}

function formulaWithBonus(base, bonus) {
  const amount = Number(bonus) || 0;
  const value = String(base ?? "").trim();
  if (!value) return String(amount);
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return String(Number(value) + amount);
  if (!amount) return value;
  return `(${value}) ${amount < 0 ? "-" : "+"} ${Math.abs(amount)}`;
}

function parseDieFaces(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === "object") {
    if (Number.isFinite(Number(value.faces))) return Number(value.faces);
    if (Number.isFinite(Number(value.denomination))) return Number(value.denomination);
    if (value.die) return parseDieFaces(value.die);
    if (value.value) return parseDieFaces(value.value);
  }
  const match = String(value ?? "").match(/d(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function steppedDie(start, steps) {
  const faces = parseDieFaces(start);
  let index = RESOURCE_DICE.findIndex(die => die >= faces);
  if (index < 0) index = RESOURCE_DICE.length - 1;
  return RESOURCE_DICE[Math.min(RESOURCE_DICE.length - 1, index + Math.max(0, Number(steps) || 0))];
}

function resourceDieValue(path, faces) {
  return String(path).endsWith(".faces") ? String(faces) : `d${faces}`;
}

function normalizeResourceFormula(value) {
  if (value === null || value === undefined || value === "") return { type: "empty", value: "" };
  if (typeof value === "number" && Number.isFinite(value)) return { type: "number", value };
  const text = String(value).trim();
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return { type: "number", value: Number(text) };
  return {
    type: "formula",
    value: text
      .replace(/\s+/g, " ")
      .replace(/\s*([+\-*/])\s*/g, " $1 ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .trim()
  };
}

function sameResourceValue(left, right) {
  const a = normalizeResourceFormula(left);
  const b = normalizeResourceFormula(right);
  return a.type === b.type && a.value === b.value;
}

function additiveDistance(base, candidate, maximum = 99) {
  if (base === undefined || candidate === undefined) return null;
  for (let amount = 0; amount <= maximum; amount += 1) {
    if (sameResourceValue(candidate, formulaWithBonus(base, amount))) return amount;
  }
  return null;
}

const RESOURCE_SOURCE_DOCUMENTS = new Map();

function resourceSourceUuid(feature) {
  return feature?._stats?.compendiumSource
    ?? feature?.flags?.core?.sourceId
    ?? feature?.flags?.dnd5e?.sourceId
    ?? "";
}

async function originalResourceValue(feature, path) {
  const uuid = resourceSourceUuid(feature);
  if (!uuid || typeof fromUuid !== "function") return undefined;
  let source = RESOURCE_SOURCE_DOCUMENTS.get(uuid);
  if (source === undefined) {
    try { source = await fromUuid(uuid); } catch (_error) { source = null; }
    RESOURCE_SOURCE_DOCUMENTS.set(uuid, source ?? null);
  }
  return source ? sourceValue(source, path) : undefined;
}

function isFeatureResourcePath(path) {
  return path === "system.uses.max" || /^system\.activities\.[^.]+\.uses\.max$/.test(String(path ?? ""));
}

function isResourceState(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (Object.hasOwn(value, "base") || Object.hasOwn(value, "applied") || Object.hasOwn(value, "bonus")));
}

function normalizeFeatureLedgerEntry(entry) {
  if (!entry || typeof entry !== "object" || !isFeatureResourcePath(entry.path)) return null;
  return {
    version: 3,
    path: String(entry.path),
    base: foundry.utils.deepClone(entry.base ?? ""),
    applied: foundry.utils.deepClone(entry.applied ?? entry.base ?? ""),
    bonus: Number(entry.bonus) || 0,
    sources: Array.isArray(entry.sources) ? foundry.utils.deepClone(entry.sources) : []
  };
}

function collectLegacyFeatureLedger(value) {
  const entries = new Map();
  const ignoredStateKeys = new Set(["version", "base", "applied", "bonus", "sources"]);
  const visit = (node, prefix = "") => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (prefix && isFeatureResourcePath(prefix) && isResourceState(node)) {
      entries.set(prefix, {
        version: Number(node.version) || 1,
        path: prefix,
        base: foundry.utils.deepClone(node.base ?? ""),
        applied: foundry.utils.deepClone(node.applied ?? node.base ?? ""),
        bonus: Number(node.bonus) || 0,
        sources: Array.isArray(node.sources) ? foundry.utils.deepClone(node.sources) : []
      });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (ignoredStateKeys.has(key)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      visit(child, path);
    }
  };
  visit(value);
  return entries;
}

function readFeatureResourceLedger(feature) {
  const raw = foundry.utils.deepClone(feature.getFlag(MODULE_ID, "resourceRuntimeLedger") ?? null);
  const entries = new Map();
  if (raw?.version === 3 && Array.isArray(raw.entries)) {
    for (const value of raw.entries) {
      const entry = normalizeFeatureLedgerEntry(value);
      if (entry) entries.set(entry.path, entry);
    }
  }

  const legacy = foundry.utils.deepClone(feature.getFlag(MODULE_ID, "resourceRuntimeBases") ?? null);
  for (const [path, entry] of collectLegacyFeatureLedger(legacy)) {
    if (!entries.has(path)) entries.set(path, entry);
  }
  return {
    raw,
    entries,
    legacyPresent: Boolean(legacy && typeof legacy === "object" && Object.keys(legacy).length)
  };
}

function isSpellSlotKey(key) {
  return key === "pact" || /^spell[1-9]$/.test(String(key ?? ""));
}

function normalizeSlotLedgerEntry(entry) {
  if (!entry || typeof entry !== "object" || !isSpellSlotKey(entry.key)) return null;
  return {
    version: 3,
    key: String(entry.key),
    path: `system.spells.${entry.key}.override`,
    baseOverride: Object.hasOwn(entry, "baseOverride") ? foundry.utils.deepClone(entry.baseOverride) : null,
    appliedOverride: Object.hasOwn(entry, "appliedOverride") ? foundry.utils.deepClone(entry.appliedOverride) : null,
    bonus: Number(entry.bonus) || 0,
    naturalMax: Math.max(0, Number(entry.naturalMax) || 0),
    sources: Array.isArray(entry.sources) ? foundry.utils.deepClone(entry.sources) : []
  };
}

function readSpellSlotLedger(actor) {
  const raw = foundry.utils.deepClone(actor.getFlag(MODULE_ID, "resourceSlotLedger") ?? null);
  const entries = new Map();
  if (raw?.version === 3 && Array.isArray(raw.entries)) {
    for (const value of raw.entries) {
      const entry = normalizeSlotLedgerEntry(value);
      if (entry) entries.set(entry.key, entry);
    }
  }

  const legacy = foundry.utils.deepClone(actor.getFlag(MODULE_ID, "resourceSlotRuntime") ?? null);
  if (legacy && typeof legacy === "object") {
    for (const [key, value] of Object.entries(legacy)) {
      if (entries.has(key) || !isSpellSlotKey(key) || !value || typeof value !== "object") continue;
      const entry = normalizeSlotLedgerEntry({ key, ...value });
      if (entry) entries.set(key, entry);
    }
  }
  return {
    raw,
    entries,
    legacyPresent: Boolean(legacy && typeof legacy === "object" && Object.keys(legacy).length)
  };
}

export class ItemCreatorRuntimeEffectService {
  static #syncingItems = new Set();
  static #syncingActors = new Set();
  static #pendingResourceBases = new Map();

  static registerHooks() {
    Hooks.on("createItem", (item, options) => {
      if (options?.itemCreatorRuntime) return;
      if (item.parent?.documentName === "Actor") void this.syncActor(item.parent);
      else void this.syncItem(item);
    });
    Hooks.on("updateItem", (item, changes, options) => {
      if (options?.itemCreatorRuntime) return;
      if (item.parent?.documentName === "Actor") {
        this.#recordExternalResourceBases(item, changes);
        void this.syncActor(item.parent);
      } else void this.syncItem(item);
    });
    Hooks.on("deleteItem", item => {
      const actor = item.parent?.documentName === "Actor" ? item.parent : null;
      void this.removeItemEffects(item);
      if (actor) setTimeout(() => void this.syncActor(actor), 0);
    });
    Hooks.on("updateActor", (actor, _changes, options) => {
      if (options?.itemCreatorRuntime) return;
      void this.syncActor(actor);
    });
    Hooks.on("createActor", (actor, options) => {
      if (options?.itemCreatorRuntime) return;
      // Imported Actors can arrive with managed embedded Items already present.
      // Defer one turn so Foundry has finished constructing those documents.
      setTimeout(() => void this.syncActor(actor), 0);
    });
    Hooks.on("createActiveEffect", effect => {
      if (effect.parent?.documentName === "Item" && isManagedItem(effect.parent)) void this.syncItem(effect.parent);
    });
    Hooks.on("updateActiveEffect", effect => {
      if (effect.parent?.documentName === "Item" && isManagedItem(effect.parent)) void this.syncItem(effect.parent);
    });
    Hooks.on("deleteActiveEffect", effect => {
      if (effect.parent?.documentName === "Item" && isManagedItem(effect.parent)) void this.syncItem(effect.parent);
    });
    Hooks.once("ready", async () => {
      if (!game.user.isGM) return;
      // Repair managed world Items created before v0.1.8 as well as Actor copies.
      for (const item of game.items) {
        if (isManagedItem(item)) await this.syncItem(item);
      }
      for (const actor of game.actors) await this.syncActor(actor);
    });

    Hooks.on("dnd5e.preUseLinkedSpell", (activity, usage) => this.#validateGrantedSpell(activity, usage));
    Hooks.on("dnd5e.preRollAttack", config => this.#applyConditionalAdvantage(config));
    Hooks.on("dnd5e.preCalculateDamage", (actor, _damages, options) => this.#applyResistanceBypass(actor, options));
  }

  static async syncActor(actor) {
    if (!game.user.isGM || actor?.documentName !== "Actor") return;
    if (this.#syncingActors.has(actor.uuid)) return;
    this.#syncingActors.add(actor.uuid);
    try {
      for (const item of actor.items ?? []) {
        if (isManagedItem(item)) await this.syncItem(item);
      }
      await this.#syncResourceModifications(actor);
    } finally {
      this.#syncingActors.delete(actor.uuid);
    }
  }

  static async syncItem(item) {
    if (!game.user.isGM || !isManagedItem(item)) return;
    if (this.#syncingItems.has(item.uuid)) return;

    this.#syncingItems.add(item.uuid);
    try {
      if (item.parent?.documentName === "Actor") await this.#syncStructuralProgression(item);
      await this.#normalizeGrantedSpellcasting(item);
      if (item.parent?.documentName !== "Actor") return;
      await this.#syncGrantedSpellbook(item);
      await this.#syncGrantedEffects(item);
    } finally {
      this.#syncingItems.delete(item.uuid);
    }
  }

  static async #syncStructuralProgression(item) {
    const config = item.getFlag(MODULE_ID, "runtime")?.structuralProgression;
    if (!config?.itemType || !config?.base) return;

    const actor = item.parent?.documentName === "Actor" ? item.parent : null;
    if (!actor) return;
    const actorLevel = actorTotalLevel(actor);
    const base = config.base ?? {};
    const enhancements = config.enhancements ?? {};
    const updates = {};
    const currentProperties = valuesOf(item.system?.properties);
    const properties = [...new Set(valuesOf(base.properties))];
    const hasGrantedSpells = grantedSpellActivities(item).length > 0;
    const addMagic = () => {
      if (!properties.includes("mgc")) properties.push("mgc");
    };

    let rarity = base.rarity ?? "";
    let attunement = base.attunement ?? "";

    if (config.itemType === "weapon") {
      const magicalWeapon = selectProgressionTier(enhancements.magicalWeapon, actorLevel);
      const weaponEnhancement = selectProgressionTier(enhancements.weaponEnhancement, actorLevel);
      const attackBonus = selectProgressionTier(enhancements.attackBonus, actorLevel);
      const damageBonus = selectProgressionTier(enhancements.damageBonus, actorLevel);
      const criticalThreshold = selectProgressionTier(enhancements.criticalThreshold, actorLevel);
      const extraCriticalDamage = selectProgressionTier(enhancements.extraCriticalDamage, actorLevel);

      if (magicalWeapon) {
        addMagic();
        rarity = magicalWeapon.rarity ?? rarity;
        attunement = magicalWeapon.attunement ?? "";
      }
      if (weaponEnhancement) addMagic();
      if (hasGrantedSpells) addMagic();

      const magicalBonus = weaponEnhancement
        ? String(Number(weaponEnhancement.bonus) || 0)
        : String(base.magicalBonus ?? "");
      const damageBaseBonus = damageBonus
        ? appendFormula(base.damageBaseBonus, damageBonus.bonus)
        : String(base.damageBaseBonus ?? "");

      const activityId = config.attackActivityId;
      const activity = valuesOf(item.system?.activities).find(entry => (entry?.id ?? entry?._id) === activityId);
      if (activityId && activity) {
        const desiredAttackBonus = attackBonus ? String(attackBonus.bonus ?? "") : String(base.attackBonus ?? "");
        const desiredThreshold = criticalThreshold
          ? Number(criticalThreshold.mode === "custom" ? criticalThreshold.custom : criticalThreshold.mode)
          : (base.criticalThreshold ?? null);
        const desiredCriticalBonus = extraCriticalDamage
          ? `${Number(extraCriticalDamage.number) || 1}d${Number(extraCriticalDamage.denomination) || 8}[${extraCriticalDamage.damageType}]`
          : String(base.criticalDamageBonus ?? "");
        const desiredParts = foundry.utils.deepClone(base.additionalDamageParts ?? []);
        for (const row of config.additionalDamage ?? []) {
          const tier = selectProgressionTier(row, actorLevel);
          if (!tier) continue;
          desiredParts.push(damagePart({
            ...tier,
            ability: tier.useAbilityModifier ? tier.ability : null
          }));
        }

        if (String(activity.attack?.bonus ?? "") !== desiredAttackBonus) {
          updates[`system.activities.${activityId}.attack.bonus`] = desiredAttackBonus;
        }
        if (!equalData(activity.attack?.critical?.threshold ?? null, desiredThreshold)) {
          updates[`system.activities.${activityId}.attack.critical.threshold`] = desiredThreshold;
        }
        if (String(activity.damage?.critical?.bonus ?? "") !== desiredCriticalBonus) {
          updates[`system.activities.${activityId}.damage.critical.bonus`] = desiredCriticalBonus;
        }
        if (!equalData(activity.damage?.parts ?? [], desiredParts)) {
          updates[`system.activities.${activityId}.damage.parts`] = desiredParts;
        }
      }

      if (String(item.system?.magicalBonus ?? "") !== magicalBonus) updates["system.magicalBonus"] = magicalBonus;
      if (String(item.system?.damage?.base?.bonus ?? "") !== damageBaseBonus) updates["system.damage.base.bonus"] = damageBaseBonus;
    }

    if (config.itemType === "equipment") {
      const magicalItem = selectProgressionTier(enhancements.magicalItem, actorLevel);
      const armorEnhancement = selectProgressionTier(enhancements.armorEnhancement, actorLevel);
      const baseArmorClass = selectProgressionTier(enhancements.baseArmorClass, actorLevel);
      const removeStrength = selectProgressionTier(enhancements.removeStrengthRequirement, actorLevel);
      const removeStealth = selectProgressionTier(enhancements.removeStealthDisadvantage, actorLevel);

      if (magicalItem) {
        addMagic();
        rarity = magicalItem.rarity ?? rarity;
        attunement = magicalItem.attunement ?? "";
      }
      if (armorEnhancement) addMagic();
      if (hasGrantedSpells) addMagic();
      if (removeStealth) {
        const index = properties.indexOf("stealthDisadvantage");
        if (index >= 0) properties.splice(index, 1);
      }

      const armorMagicalBonus = armorEnhancement
        ? String(Number(armorEnhancement.bonus) || 0)
        : String(base.armorMagicalBonus ?? "");
      const armorValue = baseArmorClass
        ? Number(baseArmorClass.value) || 0
        : Number(base.armorValue) || 0;
      const strength = removeStrength ? 0 : Number(base.strength) || 0;

      if (String(item.system?.armor?.magicalBonus ?? "") !== armorMagicalBonus) {
        updates["system.armor.magicalBonus"] = armorMagicalBonus;
      }
      if (Number(item.system?.armor?.value ?? 0) !== armorValue) updates["system.armor.value"] = armorValue;
      if (Number(item.system?.strength ?? 0) !== strength) updates["system.strength"] = strength;
    }

    if (config.itemType === "tool") {
      const magicalTool = selectProgressionTier(enhancements.magicalTool, actorLevel);
      if (magicalTool) {
        addMagic();
        rarity = magicalTool.rarity ?? rarity;
        attunement = magicalTool.attunement ?? "";
      }
      if (hasGrantedSpells) addMagic();
    }

    const desiredProperties = [...new Set(properties)];
    if (!equalData(currentProperties, desiredProperties)) updates["system.properties"] = desiredProperties;
    if (String(item.system?.rarity ?? "") !== String(rarity ?? "")) updates["system.rarity"] = rarity ?? "";
    if (String(item.system?.attunement ?? "") !== String(attunement ?? "")) updates["system.attunement"] = attunement ?? "";
    if (!attunement && Boolean(item.system?.attuned)) updates["system.attuned"] = false;

    if (Object.keys(updates).length) {
      await item.update(updates, {
        itemCreatorRuntime: true,
        diff: true,
        recursive: true,
        render: true
      });
    }
  }

  static async #normalizeGrantedSpellcasting(item) {
    const activities = grantedSpellActivities(item);
    if (!activities.length) return;

    const updates = {};
    const properties = valuesOf(item.system?.properties);
    if (!properties.includes("mgc")) updates["system.properties"] = [...new Set([...properties, "mgc"])];

    for (const activity of activities) {
      const activityId = activity.id ?? activity._id;
      if (!activityId) continue;
      if (activity.visibility?.requireMagic !== false) {
        updates[`system.activities.${activityId}.visibility.requireMagic`] = false;
      }
    }

    if (Object.keys(updates).length) {
      await item.update(updates, {
        itemCreatorRuntime: true,
        diff: true,
        recursive: true,
        render: true
      });
    }
  }

  static async #syncGrantedSpellbook(item) {
    const updates = {};

    for (const activity of grantedSpellActivities(item)) {
      const activityId = activity.id ?? activity._id;
      if (!activityId) continue;
      const config = activityConfig(activity);
      const intended = intendedSpellbookState(item, activity, config);
      const availability = config.availability ?? "equipped";
      const desired = intended && isAvailable(item, availability) && isLevelAvailable(item, config);

      if (config.showInSpellbook !== intended) {
        updates[`system.activities.${activityId}.flags.${MODULE_ID}.showInSpellbook`] = intended;
      }
      if (Boolean(activity.spell?.spellbook) !== desired) {
        updates[`system.activities.${activityId}.spell.spellbook`] = desired;
      }
    }

    if (Object.keys(updates).length) {
      await item.update(updates, {
        itemCreatorRuntime: true,
        diff: true,
        recursive: true,
        render: true
      });
    }
  }

  static async #syncGrantedEffects(item) {
    const actor = item.parent;
    const actorLevel = actorTotalLevel(actor);
    const existing = actor.effects.filter(effect => effect.getFlag(MODULE_ID, "sourceItemId") === item.id);
    const byBlueprint = new Map(existing.map(effect => [effect.getFlag(MODULE_ID, "blueprintId"), effect]));
    const grouped = new Map();

    for (const blueprint of blueprintEffects(item)) {
      const groupId = blueprint.getFlag(MODULE_ID, "progressionGroupId") || blueprint.id;
      if (!grouped.has(groupId)) grouped.set(groupId, []);
      grouped.get(groupId).push(blueprint);
    }

    const selected = [];
    for (const blueprints of grouped.values()) {
      const eligible = blueprints.filter(blueprint => {
        const availability = blueprint.getFlag(MODULE_ID, "availability") ?? "equipped";
        if (!isAvailable(item, availability)) return false;
        const unlockOnLevel = Boolean(blueprint.getFlag(MODULE_ID, "unlockOnLevel"));
        const unlockLevel = Number(blueprint.getFlag(MODULE_ID, "unlockLevel")) || 1;
        return !unlockOnLevel || actorLevel >= unlockLevel;
      });
      eligible.sort((left, right) => {
        const leftLevel = left.getFlag(MODULE_ID, "unlockOnLevel")
          ? Number(left.getFlag(MODULE_ID, "unlockLevel")) || 1 : 0;
        const rightLevel = right.getFlag(MODULE_ID, "unlockOnLevel")
          ? Number(right.getFlag(MODULE_ID, "unlockLevel")) || 1 : 0;
        if (leftLevel !== rightLevel) return leftLevel - rightLevel;
        return (Number(left.getFlag(MODULE_ID, "progressionTierOrder")) || 0)
          - (Number(right.getFlag(MODULE_ID, "progressionTierOrder")) || 0);
      });
      const winner = eligible.at(-1);
      if (winner) selected.push(winner);
    }

    const create = [];
    const update = [];
    const desired = new Set();
    for (const blueprint of selected) {
      desired.add(blueprint.id);
      const data = blueprint.toObject();
      delete data._id;
      data.origin = item.uuid;
      data.transfer = false;
      data.disabled = false;
      data.flags ??= {};
      data.flags[MODULE_ID] = {
        runtimeMirror: true,
        sourceItemId: item.id,
        blueprintId: blueprint.id,
        progressionGroupId: blueprint.getFlag(MODULE_ID, "progressionGroupId") || blueprint.id
      };
      const current = byBlueprint.get(blueprint.id);
      if (current) {
        const desiredChanges = data.system?.changes ?? data.changes ?? [];
        const desiredModuleFlags = data.flags?.[MODULE_ID] ?? {};
        const currentModuleFlags = current.flags?.[MODULE_ID] ?? {};
        const changed = current.name !== data.name
          || current.img !== data.img
          || String(current.description ?? "") !== String(data.description ?? "")
          || !equalData(current.system?.changes ?? current.changes ?? [], desiredChanges)
          || Boolean(current.disabled)
          || current.origin !== item.uuid
          || !equalData(currentModuleFlags, desiredModuleFlags);
        if (changed) update.push({
          _id: current.id,
          name: data.name,
          img: data.img,
          description: data.description,
          "system.changes": desiredChanges,
          disabled: false,
          origin: item.uuid,
          [`flags.${MODULE_ID}`]: desiredModuleFlags
        });
      } else create.push(data);
    }

    const remove = existing
      .filter(effect => !desired.has(effect.getFlag(MODULE_ID, "blueprintId")))
      .map(effect => effect.id);
    if (remove.length) await actor.deleteEmbeddedDocuments("ActiveEffect", remove, { itemCreatorRuntime: true });
    if (update.length) await actor.updateEmbeddedDocuments("ActiveEffect", update, { itemCreatorRuntime: true });
    if (create.length) await actor.createEmbeddedDocuments("ActiveEffect", create, { itemCreatorRuntime: true });
  }

  static #recordExternalResourceBases(item, changes) {
    const actor = item?.parent?.documentName === "Actor" ? item.parent : null;
    if (!actor || !changes || typeof changes !== "object") return;
    const flattened = foundry.utils.flattenObject?.(changes) ?? changes;
    const pending = this.#pendingResourceBases.get(actor.uuid) ?? new Map();
    for (const [path, value] of Object.entries(flattened)) {
      if (path === "system.uses.max" || /^system\.activities\.[^.]+\.uses\.max$/.test(path)) {
        pending.set(`${item.id}:${path}`, foundry.utils.deepClone(value));
      }
    }
    if (pending.size) this.#pendingResourceBases.set(actor.uuid, pending);
  }

  static #consumeExternalResourceBase(actor, feature, path) {
    const pending = this.#pendingResourceBases.get(actor?.uuid);
    if (!pending) return { found: false, value: undefined };
    const key = `${feature.id}:${path}`;
    if (!pending.has(key)) return { found: false, value: undefined };
    const value = pending.get(key);
    pending.delete(key);
    if (!pending.size) this.#pendingResourceBases.delete(actor.uuid);
    return { found: true, value };
  }

  static #activeResourceRows(actor) {
    const actorLevel = actorTotalLevel(actor);
    const rows = [];
    for (const item of actor.items ?? []) {
      if (!isManagedItem(item)) continue;
      for (const setting of resourceConfigurations(item)) {
        if (!resourceAvailable(item, setting, actorLevel)) continue;
        rows.push({ item, setting });
      }
    }
    return rows;
  }

  static async #syncResourceModifications(actor) {
    const rows = this.#activeResourceRows(actor);
    await this.#syncFeatureResourcePools(actor, rows);
    await this.#syncSpellSlotResources(actor, rows);
    await this.#syncResourceDice(actor, rows);
  }

  static async #syncFeatureResourcePools(actor, rows) {
    const desired = new Map();
    for (const { item, setting } of rows) {
      if (setting.category !== "feature") continue;
      const definition = getResourceDefinition(setting.resourceId);
      const feature = findResourceFeature(actor, definition);
      const target = featureUseTarget(feature);
      if (!feature || !target) {
        console.debug(`${MODULE_ID} | Resource target not found.`, {
          actor: actor.name, item: item.name, resource: definition?.label ?? setting.resourceId
        });
        continue;
      }
      const key = `${feature.id}:${target.path}`;
      const current = desired.get(key) ?? { feature, path: target.path, bonus: 0, sources: [] };
      current.bonus += (Number(setting.amount) || 0) * (Number(definition?.amountMultiplier) || 1);
      current.sources.push({ itemId: item.id, modificationId: setting.id });
      desired.set(key, current);
    }

    const tracked = new Map();
    for (const feature of actor.items ?? []) {
      const ledger = readFeatureResourceLedger(feature);
      if (ledger.entries.size || ledger.legacyPresent) tracked.set(feature.id, feature);
    }
    for (const entry of desired.values()) tracked.set(entry.feature.id, entry.feature);

    for (const feature of tracked.values()) {
      const ledger = readFeatureResourceLedger(feature);
      const nextEntries = [];
      const updates = {};
      const relevant = [...desired.values()].filter(entry => entry.feature.id === feature.id);
      const desiredByPath = new Map(relevant.map(entry => [entry.path, entry]));
      const paths = new Set([...ledger.entries.keys(), ...desiredByPath.keys()]);

      for (const path of paths) {
        if (!isFeatureResourcePath(path)) continue;
        const previous = ledger.entries.get(path) ?? null;
        const currentSource = sourceValue(feature, path);
        const target = desiredByPath.get(path);
        const external = this.#consumeExternalResourceBase(actor, feature, path);
        let base = previous?.base ?? currentSource ?? "";

        if (external.found) base = foundry.utils.deepClone(external.value ?? "");
        else if (previous) {
          const previousApplied = previous.applied ?? formulaWithBonus(previous.base, previous.bonus);
          if (!sameResourceValue(currentSource, previousApplied)
            && !sameResourceValue(currentSource, previous.base)) {
            // Only a value which differs from both the recorded base and the
            // last runtime result may replace the snapshot. This makes the
            // ledger idempotent while still accepting level-up/manual edits.
            base = foundry.utils.deepClone(currentSource ?? "");
          }
        }

        // Repair v0.4.0/v0.4.0a states. The old dotted-key flag could be
        // expanded by Foundry into nested objects. Source-backed features can
        // safely recover their official baseline when the observed values are
        // exact additive distances from it.
        if (!external.found && Number(previous?.version ?? 0) < 3) {
          const sourceBase = await originalResourceValue(feature, path);
          const sourceHasValue = sourceBase !== undefined && sourceBase !== null
            && String(sourceBase).trim() !== "";
          if (sourceHasValue) {
            const currentDistance = additiveDistance(sourceBase, currentSource);
            const storedDistance = additiveDistance(sourceBase, base);
            const knownBonus = Math.abs(Number(target?.bonus ?? previous?.bonus ?? 0));
            const isManagedDistance = distance => distance === 0
              || (Number.isInteger(distance) && distance > 0
                && (!knownBonus || distance % knownBonus === 0));
            if (isManagedDistance(currentDistance) || isManagedDistance(storedDistance)) {
              base = foundry.utils.deepClone(sourceBase);
            }
          }
        }

        const bonus = Number(target?.bonus) || 0;
        const applied = target ? formulaWithBonus(base, bonus) : foundry.utils.deepClone(base);
        if (!sameResourceValue(currentSource, applied)) updates[path] = foundry.utils.deepClone(applied);
        nextEntries.push({
          version: 3,
          path,
          base: foundry.utils.deepClone(base),
          applied: foundry.utils.deepClone(applied),
          bonus,
          sources: target ? foundry.utils.deepClone(target.sources) : []
        });
      }

      nextEntries.sort((left, right) => left.path.localeCompare(right.path));
      const nextLedger = nextEntries.length ? { version: 3, entries: nextEntries } : null;
      if (nextLedger && !equalData(ledger.raw, nextLedger)) {
        updates[`flags.${MODULE_ID}.resourceRuntimeLedger`] = nextLedger;
      } else if (!nextLedger && ledger.raw) {
        updates[`flags.${MODULE_ID}.-=resourceRuntimeLedger`] = null;
      }
      if (ledger.legacyPresent) updates[`flags.${MODULE_ID}.-=resourceRuntimeBases`] = null;
      if (!Object.keys(updates).length) continue;
      await feature.update(updates, {
        itemCreatorRuntime: true,
        diff: true,
        recursive: true,
        render: true
      });
    }
  }

  static async #syncSpellSlotResources(actor, rows) {
    const desired = new Map();
    const sources = new Map();
    for (const { item, setting } of rows) {
      const key = setting.category === "spellSlot" ? `spell${setting.spellLevel}`
        : setting.category === "pactSlot" ? "pact" : null;
      if (!key) continue;
      desired.set(key, (desired.get(key) ?? 0) + (Number(setting.amount) || 0));
      const list = sources.get(key) ?? [];
      list.push({ itemId: item.id, modificationId: setting.id });
      sources.set(key, list);
    }

    const ledger = readSpellSlotLedger(actor);
    const keys = new Set([...ledger.entries.keys(), ...desired.keys()]);
    if (!keys.size && !ledger.legacyPresent) return;

    const working = new Map();
    const restoreUpdates = {};
    for (const key of keys) {
      if (!isSpellSlotKey(key)) continue;
      const previous = ledger.entries.get(key) ?? null;
      const currentOverride = sourceValue(actor, `system.spells.${key}.override`) ?? null;
      let baseOverride = previous && Object.hasOwn(previous, "baseOverride")
        ? foundry.utils.deepClone(previous.baseOverride) : foundry.utils.deepClone(currentOverride);

      if (previous
        && !sameResourceValue(currentOverride, previous.appliedOverride)
        && !sameResourceValue(currentOverride, previous.baseOverride)) {
        // A direct override edit becomes the new base snapshot.
        baseOverride = foundry.utils.deepClone(currentOverride);
      }
      working.set(key, { previous, baseOverride });

      // Temporarily restore the original override before reading the derived
      // natural maximum. This allows class progression to update underneath an
      // equipped Item without ever treating the managed override as the base.
      if (previous && sameResourceValue(currentOverride, previous.appliedOverride)
        && !sameResourceValue(currentOverride, baseOverride)) {
        restoreUpdates[`system.spells.${key}.override`] = foundry.utils.deepClone(baseOverride);
      }
    }

    if (Object.keys(restoreUpdates).length) {
      await actor.update(restoreUpdates, {
        itemCreatorRuntime: true,
        diff: true,
        recursive: true,
        render: false
      });
    }

    const finalUpdates = {};
    const nextEntries = [];
    for (const key of keys) {
      if (!isSpellSlotKey(key)) continue;
      const previous = working.get(key)?.previous ?? null;
      const baseOverride = working.get(key)?.baseOverride ?? null;
      const bonus = Number(desired.get(key)) || 0;
      const currentOverride = sourceValue(actor, `system.spells.${key}.override`) ?? null;
      const currentValue = Number(sourceValue(actor, `system.spells.${key}.value`)
        ?? actor.system?.spells?.[key]?.value ?? 0) || 0;
      const derivedMax = Number(actor.system?.spells?.[key]?.max);
      const baseNumeric = Number(baseOverride);
      const previousNatural = Number(previous?.naturalMax);
      const naturalMax = Math.max(0,
        Number.isFinite(derivedMax) ? derivedMax
          : Number.isFinite(baseNumeric) ? baseNumeric
            : Number.isFinite(previousNatural) ? previousNatural : 0);
      const appliedOverride = bonus ? Math.max(0, naturalMax + bonus) : foundry.utils.deepClone(baseOverride);
      const effectiveMax = bonus ? Number(appliedOverride) : naturalMax;

      if (!sameResourceValue(currentOverride, appliedOverride)) {
        finalUpdates[`system.spells.${key}.override`] = foundry.utils.deepClone(appliedOverride);
      }
      if (currentValue > effectiveMax) finalUpdates[`system.spells.${key}.value`] = effectiveMax;
      nextEntries.push({
        version: 3,
        key,
        path: `system.spells.${key}.override`,
        baseOverride: foundry.utils.deepClone(baseOverride),
        appliedOverride: foundry.utils.deepClone(appliedOverride),
        bonus,
        naturalMax,
        sources: foundry.utils.deepClone(sources.get(key) ?? [])
      });
    }

    nextEntries.sort((left, right) => left.key.localeCompare(right.key));
    const nextLedger = nextEntries.length ? { version: 3, entries: nextEntries } : null;
    if (nextLedger && !equalData(ledger.raw, nextLedger)) {
      finalUpdates[`flags.${MODULE_ID}.resourceSlotLedger`] = nextLedger;
    } else if (!nextLedger && ledger.raw) {
      finalUpdates[`flags.${MODULE_ID}.-=resourceSlotLedger`] = null;
    }
    if (ledger.legacyPresent) finalUpdates[`flags.${MODULE_ID}.-=resourceSlotRuntime`] = null;
    if (!Object.keys(finalUpdates).length) return;
    await actor.update(finalUpdates, {
      itemCreatorRuntime: true,
      diff: true,
      recursive: true,
      render: true
    });
  }

  static async #syncResourceDice(actor, rows) {
    let runtimeEffect = actor.effects.find(effect => effect.getFlag(MODULE_ID, "resourceDieRuntime"));
    if (runtimeEffect && !runtimeEffect.disabled) {
      await actor.updateEmbeddedDocuments("ActiveEffect", [{ _id: runtimeEffect.id, disabled: true }], {
        itemCreatorRuntime: true,
        render: false
      });
      runtimeEffect = actor.effects.get?.(runtimeEffect.id) ?? actor.effects.find(effect => effect.id === runtimeEffect.id) ?? runtimeEffect;
    }

    const grouped = new Map();
    for (const { item, setting } of rows) {
      if (setting.category !== "resourceDie") continue;
      const definition = getResourceDefinition(setting.resourceId);
      const scale = findResourceScale(actor, definition);
      if (!scale) {
        console.debug(`${MODULE_ID} | Resource die scale not found.`, {
          actor: actor.name, item: item.name, resource: definition?.label ?? setting.resourceId
        });
        continue;
      }
      const group = grouped.get(scale.path) ?? {
        path: scale.path,
        baseFaces: parseDieFaces(scale.value),
        increaseSteps: 0,
        minimumDice: [],
        exactDice: [],
        sources: []
      };
      if (setting.operation === "increaseSteps") group.increaseSteps += Number(setting.amount) || 0;
      else if (setting.operation === "setExactDie") group.exactDice.push(Number(setting.die) || 0);
      else group.minimumDice.push(Number(setting.die) || 0);
      group.sources.push({ itemId: item.id, modificationId: setting.id });
      grouped.set(scale.path, group);
    }

    const changes = [];
    for (const group of grouped.values()) {
      if (!group.baseFaces) continue;
      let faces;
      if (group.exactDice.length) faces = Math.max(...group.exactDice);
      else {
        faces = steppedDie(group.baseFaces, group.increaseSteps);
        if (group.minimumDice.length) faces = Math.max(faces, ...group.minimumDice);
      }
      if (!faces || faces === group.baseFaces) continue;
      changes.push({
        key: group.path,
        mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
        value: resourceDieValue(group.path, faces),
        priority: 90
      });
    }

    if (!changes.length) {
      if (runtimeEffect) await actor.deleteEmbeddedDocuments("ActiveEffect", [runtimeEffect.id], { itemCreatorRuntime: true });
      return;
    }

    // Resource dice use a non-destructive Active Effect. The Actor's source
    // scale remains untouched, and the original faces are recorded explicitly
    // for audit/migration rather than encoded as dotted object keys.
    const baseSnapshots = [...grouped.values()]
      .filter(group => group.baseFaces)
      .map(group => ({ path: group.path, baseFaces: group.baseFaces }))
      .sort((left, right) => left.path.localeCompare(right.path));
    const data = {
      type: "base",
      name: "Item Creator — Resource Dice",
      img: "icons/svg/dice-target.svg",
      origin: actor.uuid,
      transfer: false,
      disabled: false,
      statuses: [],
      changes,
      flags: { [MODULE_ID]: { resourceDieRuntime: true, ledgerVersion: 3, baseSnapshots } }
    };
    if (runtimeEffect) {
      await actor.updateEmbeddedDocuments("ActiveEffect", [{
        _id: runtimeEffect.id,
        name: data.name,
        img: data.img,
        origin: data.origin,
        disabled: false,
        "system.changes": changes,
        [`flags.${MODULE_ID}`]: data.flags[MODULE_ID]
      }], { itemCreatorRuntime: true, render: true });
    } else {
      await actor.createEmbeddedDocuments("ActiveEffect", [data], { itemCreatorRuntime: true, render: true });
    }
  }

  static auditResources(actor) {
    if (actor?.documentName !== "Actor") throw new Error("Provide an Actor document to audit Item Creator resources.");
    return {
      actor: { id: actor.id, uuid: actor.uuid, name: actor.name, level: actorTotalLevel(actor) },
      active: this.#activeResourceRows(actor).map(({ item, setting }) => ({
        item: item.name,
        itemUuid: item.uuid,
        ...setting
      })),
      registry: auditResourceDefinitions(actor),
      spellSlots: foundry.utils.deepClone(actor.system?.spells ?? {}),
      managedFeatureState: (actor.items ?? [])
        .filter(item => item.getFlag(MODULE_ID, "resourceRuntimeLedger") || item.getFlag(MODULE_ID, "resourceRuntimeBases"))
        .map(item => ({
          item: item.name,
          itemUuid: item.uuid,
          ledger: foundry.utils.deepClone(item.getFlag(MODULE_ID, "resourceRuntimeLedger") ?? null),
          legacy: foundry.utils.deepClone(item.getFlag(MODULE_ID, "resourceRuntimeBases") ?? null)
        })),
      managedSlotState: foundry.utils.deepClone(actor.getFlag(MODULE_ID, "resourceSlotLedger")
        ?? actor.getFlag(MODULE_ID, "resourceSlotRuntime") ?? {}),
      managedDieState: foundry.utils.deepClone(actor.effects
        .find(effect => effect.getFlag(MODULE_ID, "resourceDieRuntime"))?.getFlag(MODULE_ID, "resourceDieRuntime")
        ? actor.effects.find(effect => effect.getFlag(MODULE_ID, "resourceDieRuntime"))?.flags?.[MODULE_ID] ?? null
        : null)
    };
  }

  static async removeItemEffects(item) {
    if (!game.user.isGM || item.parent?.documentName !== "Actor") return;
    const ids = item.parent.effects.filter(effect => effect.getFlag(MODULE_ID, "sourceItemId") === item.id).map(effect => effect.id);
    if (ids.length) await item.parent.deleteEmbeddedDocuments("ActiveEffect", ids, { itemCreatorRuntime: true });
  }

  static #managedItemFromMessage(message) {
    const uuid = message?.flags?.dnd5e?.item?.uuid;
    if (!uuid) return null;
    const item = fromUuidSync(uuid, { strict: false });
    return isManagedItem(item) ? item : null;
  }

  static #runtimePassiveItemAvailable(item) {
    if (!isManagedItem(item) || !["equipment", "tool"].includes(item.type)) return false;
    if (!item.system?.equipped) return false;
    const requiresAttunement = Boolean(item.system?.attunement);
    return !requiresAttunement || Boolean(item.system?.attuned);
  }

  static #activeRuntimeItems(actor, originatingItem = null) {
    const items = [];
    if (isManagedItem(originatingItem)) items.push(originatingItem);
    for (const item of actor?.items ?? []) {
      if (item === originatingItem || !this.#runtimePassiveItemAvailable(item)) continue;
      items.push(item);
    }
    return items;
  }

  static #applyResistanceBypass(actor, options) {
    const originatingItem = this.#managedItemFromMessage(options?.originatingMessage);
    const owner = actor ?? originatingItem?.actor;
    const types = new Set();
    for (const item of this.#activeRuntimeItems(owner, originatingItem)) {
      const setting = item.getFlag(MODULE_ID, "runtime")?.ignoreResistance;
      const active = selectProgressionTier(setting, actorTotalLevel(item.actor ?? owner));
      if (!active) continue;
      for (const type of active.damageTypes ?? []) types.add(type);
    }
    if (!types.size || options.ignore === true) return;
    options.ignore ??= {};
    options.ignore.resistance = new Set([...(options.ignore.resistance ?? []), ...types]);
  }

  static #conditionApplies(setting, item) {
    const targetToken = [...(game.user?.targets ?? [])][0] ?? null;
    const target = targetToken?.actor ?? null;
    const wielderToken = item.actor?.getActiveTokens?.()[0] ?? null;
    let applies = false;
    switch (setting.supportedCondition) {
      case "targetUndead": {
        const type = String(target?.system?.details?.type?.value ?? target?.system?.details?.type ?? "").toLowerCase();
        applies = type.includes("undead");
        break;
      }
      case "targetFiend": {
        const type = String(target?.system?.details?.type?.value ?? target?.system?.details?.type ?? "").toLowerCase();
        applies = type.includes("fiend");
        break;
      }
      case "targetBloodied": {
        const hp = target?.system?.attributes?.hp;
        applies = Number(hp?.max) > 0 && Number(hp?.value) <= Number(hp.max) / 2;
        break;
      }
      case "targetNotActed": {
        const combat = game.combat;
        const targetCombatant = combat?.combatants?.find(entry => entry.tokenId === targetToken?.document?.id);
        const targetIndex = targetCombatant ? combat.turns.findIndex(entry => entry.id === targetCombatant.id) : -1;
        applies = targetIndex >= 0 && Number(combat.turn ?? -1) <= targetIndex;
        break;
      }
      case "wielderDimLight": {
        const lightLevel = wielderToken?.object?.illumination ?? wielderToken?.illumination;
        applies = typeof lightLevel === "number" && lightLevel > 0 && lightLevel < 1;
        break;
      }
    }
    return applies;
  }

  static #applyConditionalAdvantage(config) {
    const activity = config?.subject;
    const originatingItem = activity?.item;
    const actor = originatingItem?.actor;
    if (!actor) return;
    for (const item of this.#activeRuntimeItems(actor, originatingItem)) {
      const configured = item.getFlag(MODULE_ID, "runtime")?.conditionalAdvantage;
      const setting = selectProgressionTier(configured, actorTotalLevel(actor));
      if (!setting || setting.mode !== "supported") continue;
      if (this.#conditionApplies(setting, item)) {
        config.advantage = true;
        return;
      }
    }
  }

  static #validateGrantedSpell(activity, usage) {
    const config = activity?.flags?.[MODULE_ID];
    if (!config?.grantedSpell) return;
    const item = activity.item;
    const actor = activity.actor;
    if (!actor) return false;

    if (!isLevelAvailable(item, config)) {
      const requiredLevel = Number(config.unlockLevel) || 1;
      ui.notifications.warn(`${item.name} requires character level ${requiredLevel} to cast this spell.`);
      return false;
    }

    if (config.spellcastingMode === "highest") {
      const abilities = new Set(Object.values(actor.spellcastingClasses ?? {})
        .map(entry => entry?.spellcasting?.ability).filter(Boolean));
      if (actor.system.attributes?.spellcasting) abilities.add(actor.system.attributes.spellcasting);
      const highest = [...abilities].sort((a, b) =>
        Number(actor.system.abilities?.[b]?.mod ?? -Infinity) - Number(actor.system.abilities?.[a]?.mod ?? -Infinity))[0];
      if (highest) activity.updateSource?.({ "spell.ability": highest });
    }

    if (config.availability === "equipped" && !item.system.equipped) {
      ui.notifications.warn(`${item.name} must be equipped to cast this spell.`);
      return false;
    }
    if (config.availability === "equippedAttuned" && !(item.system.equipped && item.system.attuned)) {
      ui.notifications.warn(`${item.name} must be equipped and attuned to cast this spell.`);
      return false;
    }

    const level = Number(config.baseLevel ?? 0);
    if (config.eligibility === "spellLevelAccess" && level > 0) {
      const slotAccess = Object.values(actor.system.spells ?? {}).some(slot => Number(slot.level) >= level && Number(slot.max) > 0);
      const arcanumAccess = actor.items.some(entry => {
        const text = `${entry.name} ${entry.system?.description?.value ?? ""}`;
        return /mystic arcanum/i.test(text) && new RegExp(`\\b${level}(?:st|nd|rd|th)?[- ]level\\b`, "i").test(text);
      });
      if (!slotAccess && !arcanumAccess) {
        ui.notifications.warn(`${actor.name} does not yet have access to ${level}${level === 1 ? "st" : level === 2 ? "nd" : level === 3 ? "rd" : "th"}-level spells.`);
        return false;
      }
    }

    if (config.consumeSlot && level > 0) {
      const hasSlot = Object.values(actor.system.spells ?? {}).some(slot => Number(slot.level) >= level && Number(slot.value) > 0);
      if (!hasSlot) {
        ui.notifications.warn(`${actor.name} has no compatible spell slot available.`);
        return false;
      }
      usage.consume ??= {};
      usage.consume.resources ??= true;
    }
    return true;
  }
}
