import { MODULE_ID } from "../constants.mjs";
import { actorTotalLevel, selectProgressionTier, variantEligible } from "./level-progression.mjs";

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

export class ItemCreatorRuntimeEffectService {
  static #syncingItems = new Set();

  static registerHooks() {
    Hooks.on("createItem", (item, options) => {
      if (options?.itemCreatorRuntime) return;
      if (item.parent?.documentName === "Actor" && item.type === "class") void this.syncActor(item.parent);
      else void this.syncItem(item);
    });
    Hooks.on("updateItem", (item, _changes, options) => {
      if (options?.itemCreatorRuntime) return;
      if (item.parent?.documentName === "Actor" && item.type === "class") void this.syncActor(item.parent);
      else void this.syncItem(item);
    });
    Hooks.on("deleteItem", item => {
      void this.removeItemEffects(item);
      if (item.parent?.documentName === "Actor" && item.type === "class") void this.syncActor(item.parent);
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
      for (const actor of game.actors) {
        for (const item of actor.items) {
          if (isManagedItem(item)) await this.syncItem(item);
        }
      }
    });

    Hooks.on("dnd5e.preUseLinkedSpell", (activity, usage) => this.#validateGrantedSpell(activity, usage));
    Hooks.on("dnd5e.preRollAttack", config => this.#applyConditionalAdvantage(config));
    Hooks.on("dnd5e.preCalculateDamage", (actor, _damages, options) => this.#applyResistanceBypass(actor, options));
  }

  static async syncActor(actor) {
    if (!game.user.isGM || actor?.documentName !== "Actor") return;
    for (const item of actor.items ?? []) {
      if (isManagedItem(item)) await this.syncItem(item);
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
