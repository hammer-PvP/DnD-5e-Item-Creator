import { MODULE_ID } from "../constants.mjs";

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
  return item?.documentName === "Item" && item.type === "weapon" && Boolean(item.getFlag(MODULE_ID, "created"));
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
      void this.syncItem(item);
    });
    Hooks.on("updateItem", (item, _changes, options) => {
      if (options?.itemCreatorRuntime) return;
      void this.syncItem(item);
    });
    Hooks.on("deleteItem", item => void this.removeItemEffects(item));
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
      for (const actor of game.actors) {
        for (const item of actor.items) {
          if (isManagedItem(item)) await this.syncItem(item);
        }
      }
    });

    Hooks.on("dnd5e.preUseLinkedSpell", (activity, usage) => this.#validateGrantedSpell(activity, usage));
    Hooks.on("dnd5e.preRollAttack", config => this.#applyConditionalAdvantage(config));
    Hooks.on("dnd5e.preCalculateDamage", (_actor, _damages, options) => this.#applyResistanceBypass(options));
  }

  static async syncItem(item) {
    if (!game.user.isGM || !isManagedItem(item) || item.parent?.documentName !== "Actor") return;
    if (this.#syncingItems.has(item.uuid)) return;

    this.#syncingItems.add(item.uuid);
    try {
      await this.#syncGrantedSpellbook(item);
      await this.#syncGrantedEffects(item);
    } finally {
      this.#syncingItems.delete(item.uuid);
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
      const desired = intended && isAvailable(item, availability);

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
    const existing = actor.effects.filter(effect => effect.getFlag(MODULE_ID, "sourceItemId") === item.id);
    const byBlueprint = new Map(existing.map(effect => [effect.getFlag(MODULE_ID, "blueprintId"), effect]));
    const create = [];
    const update = [];
    const desired = new Set();

    for (const blueprint of blueprintEffects(item)) {
      const availability = blueprint.getFlag(MODULE_ID, "availability") ?? "equipped";
      if (!isAvailable(item, availability)) continue;
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
        blueprintId: blueprint.id
      };
      const current = byBlueprint.get(blueprint.id);
      if (current) update.push({
        _id: current.id,
        name: data.name,
        img: data.img,
        description: data.description,
        changes: data.changes,
        disabled: false,
        origin: item.uuid,
        flags: data.flags
      });
      else create.push(data);
    }

    const remove = existing.filter(effect => !desired.has(effect.getFlag(MODULE_ID, "blueprintId"))).map(effect => effect.id);
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

  static #applyResistanceBypass(options) {
    const item = this.#managedItemFromMessage(options?.originatingMessage);
    const types = item?.getFlag(MODULE_ID, "runtime")?.ignoreResistance?.damageTypes ?? [];
    if (!types.length || options.ignore === true) return;
    options.ignore ??= {};
    options.ignore.resistance = new Set([...(options.ignore.resistance ?? []), ...types]);
  }

  static #applyConditionalAdvantage(config) {
    const activity = config?.subject;
    const item = activity?.item;
    if (!isManagedItem(item)) return;
    const setting = item.getFlag(MODULE_ID, "runtime")?.conditionalAdvantage;
    if (!setting || setting.mode !== "supported") return;

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
    if (applies) config.advantage = true;
  }

  static #validateGrantedSpell(activity, usage) {
    const config = activity?.flags?.[MODULE_ID];
    if (!config?.grantedSpell) return;
    const item = activity.item;
    const actor = activity.actor;
    if (!actor) return false;

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
