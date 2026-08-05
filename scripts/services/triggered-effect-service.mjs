import { MODULE_ID } from "../constants.mjs";
import { getResourceDefinition } from "./resource-modification-registry.mjs";
import { safeDeleteActiveEffects } from "./document-operation-service.mjs";
import {
  buildTriggeredEffectChanges, normalizeTriggeredEffect, validateTriggeredEffect
} from "./triggered-effect-registry.mjs";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const LEDGER_FLAG = "triggeredEffectLedger";
const LEDGER_VERSION = 1;
const MAX_RECENT_KEYS = 120;

function clone(value) {
  return foundry.utils.deepClone(value);
}

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

function actorTotalLevel(actor) {
  const classLevels = (actor?.items ?? [])
    .filter(item => item.type === "class")
    .reduce((total, item) => total + (Number(item.system?.levels) || 0), 0);
  return classLevels || Number(actor?.system?.details?.level) || 0;
}

function isManagedItem(item) {
  return Boolean(item?.documentName === "Item"
    && item.parent?.documentName === "Actor"
    && item.getFlag?.(MODULE_ID, "created")
    && ["weapon", "equipment", "tool"].includes(item.type));
}

function itemAvailable(item, availability = "equipped") {
  if (availability === "owned") return true;
  if (availability === "equippedAttuned") return Boolean(item.system?.equipped && item.system?.attuned);
  return Boolean(item.system?.equipped);
}

function activeGM() {
  return game.users?.activeGM ?? game.users?.find(user => user.active && user.isGM) ?? null;
}

function isAuthoritativeGM() {
  return Boolean(game.user?.isGM && activeGM()?.id === game.user.id);
}

function slug(value) {
  return String(value ?? "").trim().toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sourceMessage(value) {
  if (!value) return null;
  if (value.documentName === "ChatMessage") return value;
  if (typeof value === "string") return game.messages?.get(value) ?? null;
  return null;
}

function messageContext(message) {
  const itemUuid = message?.flags?.dnd5e?.item?.uuid ?? "";
  const activityUuid = message?.flags?.dnd5e?.activity?.uuid ?? "";
  const item = itemUuid ? fromUuidSync(itemUuid, { strict: false }) : null;
  const activity = activityUuid ? fromUuidSync(activityUuid, { strict: false }) : null;
  const actor = item?.actor ?? (message?.speaker?.actor ? game.actors?.get(message.speaker.actor) : null);
  return { message, item, activity, actor, itemUuid, activityUuid };
}

function activeD20Result(roll) {
  const results = roll?.d20?.results ?? roll?.dice?.find(die => die.faces === 20)?.results ?? [];
  const active = results.filter(result => result.active !== false && !result.discarded);
  const selected = active.at(-1) ?? results.find(result => result.active !== false) ?? results.at(-1);
  return Number(selected?.result ?? selected?.value ?? NaN);
}

function attackClassification(activity) {
  const item = activity?.item;
  const type = String(activity?.attack?.type?.value ?? "").toLowerCase();
  const classification = String(activity?.attack?.type?.classification ?? "").toLowerCase();
  const identifier = slug(item?.system?.identifier ?? item?.name);
  const unarmed = identifier === "unarmed-strike" || identifier.includes("unarmed");
  const spell = item?.type === "spell" || classification === "spell" || activity?.isSpell;
  const weapon = !spell && (item?.type === "weapon" || classification === "weapon" || unarmed);
  return {
    type: unarmed ? "unarmed"
      : spell ? (type === "melee" ? "meleeSpell" : type === "ranged" ? "rangedSpell" : "spell")
        : weapon ? (type === "melee" ? "meleeWeapon" : type === "ranged" ? "rangedWeapon" : "weapon")
          : "any",
    spell,
    weapon,
    melee: type === "melee",
    ranged: type === "ranged",
    unarmed
  };
}

function matchesAttackType(filter, event) {
  if (!filter || filter === "any") return true;
  if (filter === event.attackType) return true;
  if (filter === "weapon") return Boolean(event.weaponAttack);
  if (filter === "spell") return Boolean(event.spellAttack);
  return false;
}

function eventId(prefix, ...parts) {
  return [prefix, ...parts.map(part => String(part ?? ""))].join(":");
}

function currentCombatForActor(actor) {
  const combat = game.combat;
  if (!combat?.started) return null;
  const present = combat.combatants?.some(combatant => combatant.actorId === actor?.id || combatant.actor?.id === actor?.id);
  return present ? combat : null;
}

function combatMoment(combat) {
  return `${combat?.id ?? "none"}:${Number(combat?.round ?? 0)}:${Number(combat?.turn ?? -1)}`;
}

function normalizeEntry(value = {}) {
  return {
    key: String(value.key ?? ""),
    sourceItemId: String(value.sourceItemId ?? ""),
    triggerId: String(value.triggerId ?? ""),
    combatId: String(value.combatId ?? ""),
    stacks: Math.max(0, Number(value.stacks) || 0),
    remaining: Math.max(0, Number(value.remaining) || 0),
    idleTicks: Math.max(0, Number(value.idleTicks) || 0),
    independent: Array.isArray(value.independent) ? value.independent.map(entry => ({
      id: entry.id || foundry.utils.randomID(), remaining: Math.max(0, Number(entry.remaining) || 0)
    })) : [],
    effectId: value.effectId ?? null,
    lastTriggerMoment: String(value.lastTriggerMoment ?? ""),
    recentActivationKeys: Array.isArray(value.recentActivationKeys) ? value.recentActivationKeys.slice(-MAX_RECENT_KEYS) : [],
    turnActivationKey: String(value.turnActivationKey ?? ""),
    turnActivations: Math.max(0, Number(value.turnActivations) || 0),
    roundActivationKey: String(value.roundActivationKey ?? ""),
    roundActivations: Math.max(0, Number(value.roundActivations) || 0),
    lastEventId: String(value.lastEventId ?? ""),
    resolutionActivityUuid: String(value.resolutionActivityUuid ?? ""),
    resolutionItemUuid: String(value.resolutionItemUuid ?? ""),
    resolutionRollKey: String(value.resolutionRollKey ?? ""),
    resolutionMessageId: String(value.resolutionMessageId ?? "")
  };
}

function readLedger(actor) {
  const raw = clone(actor.getFlag(MODULE_ID, LEDGER_FLAG) ?? null);
  const entries = new Map();
  if (raw?.version === LEDGER_VERSION && Array.isArray(raw.entries)) {
    for (const value of raw.entries) {
      const entry = normalizeEntry(value);
      if (entry.key) entries.set(entry.key, entry);
    }
  }
  return { raw, entries };
}

function ledgerData(entries) {
  const rows = [...entries.values()].filter(entry => entry.stacks > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
  return rows.length ? { version: LEDGER_VERSION, entries: rows } : null;
}

function triggerConfigurations(item) {
  return (item.getFlag(MODULE_ID, "runtime")?.triggeredEffects ?? [])
    .map(normalizeTriggeredEffect).filter(validateTriggeredEffect);
}

function findConfig(actor, sourceItemId, triggerId) {
  const item = actor.items?.get(sourceItemId);
  if (!isManagedItem(item)) return { item: null, setting: null };
  const setting = triggerConfigurations(item).find(entry => entry.id === triggerId) ?? null;
  return { item, setting };
}

function resourceMatches(settingResourceId, event) {
  const wanted = getResourceDefinition(settingResourceId);
  const values = new Set([
    slug(settingResourceId), slug(wanted?.id), slug(wanted?.label),
    ...(wanted?.identifiers ?? []).map(slug), ...(wanted?.aliases ?? []).map(slug)
  ].filter(Boolean));
  return [event.resourceId, event.resourceIdentifier, event.resourceName, event.resourceUuid]
    .map(slug).some(value => value && values.has(value));
}

function sourceFilterMatches(setting, event) {
  const trigger = setting.trigger;
  if (event.type.startsWith("attack") || ["criticalHit", "natural20"].includes(event.type)) {
    return matchesAttackType(trigger.attackType, event);
  }
  if (event.type.startsWith("spell") || event.type === "specificSpellCast") {
    if (trigger.spellLevel !== "any" && Number(trigger.spellLevel) !== Number(event.spellLevel)) return false;
    if (trigger.spellSchool !== "any" && trigger.spellSchool && trigger.spellSchool !== event.spellSchool) return false;
    if (trigger.event === "specificSpellCast") {
      const expected = new Set([trigger.spellUuid, trigger.spellName].map(slug).filter(Boolean));
      if (![event.spellUuid, event.spellName, event.spellIdentifier].map(slug).some(value => expected.has(value))) return false;
    }
  }
  if (trigger.event === "specificResourceSpent" && !resourceMatches(trigger.resourceId, event)) return false;
  if (["spellSlotSpent", "pactSlotSpent"].includes(trigger.event)
    && trigger.spellSlotLevel !== "any" && Number(trigger.spellSlotLevel) !== Number(event.spellSlotLevel)) return false;
  if (trigger.event === "specificFeatureUsed") {
    const expected = new Set([trigger.featureUuid, trigger.featureName, trigger.featureIdentifier].map(slug).filter(Boolean));
    if (![event.itemUuid, event.itemName, event.itemIdentifier].map(slug).some(value => expected.has(value))) return false;
  }
  if (["damageDealt", "damageReceived", "healingDealt", "healingReceived", "attackDamageApplied"].includes(event.type)) {
    if (Number(event.amount) < Number(trigger.minimumAmount || 0)) return false;
    if (trigger.damageSource && trigger.damageSource !== "any" && trigger.damageSource !== event.damageSource) return false;
    if (trigger.damageType && trigger.damageType !== "any" && !(event.damageTypes ?? []).includes(trigger.damageType)) return false;
  }
  return true;
}

function triggerMatches(setting, event, sourceItem) {
  if (setting.trigger.event !== event.type) return false;
  if (setting.trigger.event === "thisItemActivityUsed" && event.itemUuid !== sourceItem.uuid) return false;
  return sourceFilterMatches(setting, event);
}

function activationKey(setting, event) {
  const combat = game.combats?.get(event.combatId) ?? game.combat;
  if (setting.counting === "perTurn") return `turn:${combatMoment(combat)}`;
  if (setting.counting === "perRound") return `round:${combat?.id}:${Number(combat?.round ?? 0)}`;
  if (setting.counting === "perTarget") return `target:${event.activityUseId || event.messageId || event.activityUuid}:${event.targetActorUuid || "none"}`;
  if (setting.counting === "perActivity") return `activity:${event.activityUseId || event.messageId || event.activityUuid || event.id}`;
  return `roll:${event.rollKey || event.id}`;
}

function withinActivationLimits(entry, setting, combat) {
  const turnKey = `${combat.id}:${combat.round}:${combat.turn}`;
  const roundKey = `${combat.id}:${combat.round}`;
  if (entry.turnActivationKey !== turnKey) {
    entry.turnActivationKey = turnKey;
    entry.turnActivations = 0;
  }
  if (entry.roundActivationKey !== roundKey) {
    entry.roundActivationKey = roundKey;
    entry.roundActivations = 0;
  }
  if (setting.maxPerTurn > 0 && entry.turnActivations >= setting.maxPerTurn) return false;
  if (setting.maxPerRound > 0 && entry.roundActivations >= setting.maxPerRound) return false;
  entry.turnActivations += 1;
  entry.roundActivations += 1;
  return true;
}

function applyActivation(entry, setting, combat, event) {
  const stacks = setting.stacks;
  const grant = Math.max(1, Number(stacks.granted) || 1);
  const maximum = Math.max(1, Number(stacks.maximum) || 1);
  if (stacks.behavior === "singleAttack") {
    entry.stacks = 1;
    entry.remaining = 1;
    entry.independent = [];
    entry.resolutionActivityUuid = String(event.activityUuid ?? "");
    entry.resolutionItemUuid = String(event.itemUuid ?? "");
    entry.resolutionRollKey = String(event.rollKey ?? "");
    entry.resolutionMessageId = String(event.messageId ?? "");
  } else if (stacks.behavior === "refresh") {
    entry.stacks = 1;
    entry.remaining = Math.max(1, Number(stacks.durationAmount) || 1);
    entry.independent = [];
  } else if (stacks.behavior === "shared") {
    entry.stacks = Math.min(maximum, entry.stacks + grant);
    entry.remaining = Math.max(1, Number(stacks.durationAmount) || 1);
    entry.independent = [];
  } else if (stacks.behavior === "independent") {
    const available = Math.max(0, maximum - entry.independent.length);
    const count = Math.min(grant, available);
    for (let i = 0; i < count; i += 1) {
      entry.independent.push({ id: foundry.utils.randomID(), remaining: Math.max(1, Number(stacks.durationAmount) || 1) });
    }
    entry.stacks = entry.independent.length;
    entry.remaining = 0;
  } else {
    entry.stacks = Math.min(maximum, entry.stacks + grant);
    entry.remaining = 0;
    entry.independent = [];
  }
  if (stacks.behavior !== "singleAttack") {
    entry.resolutionActivityUuid = "";
    entry.resolutionItemUuid = "";
    entry.resolutionRollKey = "";
    entry.resolutionMessageId = "";
  }
  entry.idleTicks = 0;
  entry.lastTriggerMoment = combatMoment(combat);
  entry.lastEventId = event.id;
}

function tickEntry(entry, setting, timing, combat) {
  if (setting.stacks.tickTiming !== timing) return false;
  if (entry.lastTriggerMoment === combatMoment(combat)) return false;
  const behavior = setting.stacks.behavior;
  if (behavior === "singleAttack" || behavior === "refresh" || behavior === "shared") {
    entry.remaining = Math.max(0, entry.remaining - 1);
    if (entry.remaining <= 0) entry.stacks = 0;
  } else if (behavior === "independent") {
    entry.independent = entry.independent.map(stack => ({ ...stack, remaining: stack.remaining - 1 }))
      .filter(stack => stack.remaining > 0);
    entry.stacks = entry.independent.length;
  } else if (behavior === "continuousDecay") {
    entry.stacks = Math.max(0, entry.stacks - Math.max(1, Number(setting.stacks.decayAmount) || 1));
  } else if (behavior === "delayedDecay") {
    entry.idleTicks += 1;
    if (entry.idleTicks > Math.max(0, Number(setting.stacks.inactivityGrace) || 0)) {
      entry.stacks = Math.max(0, entry.stacks - Math.max(1, Number(setting.stacks.decayAmount) || 1));
    }
  }
  return true;
}

function matchingTick(setting, timing, actorId, currentActorId) {
  if (setting.stacks.durationUnit === "ownerTurns") {
    if (actorId !== currentActorId) return false;
    return timing === setting.stacks.tickTiming;
  }
  if (setting.stacks.durationUnit === "combatTurns") return timing === setting.stacks.tickTiming;
  if (setting.stacks.durationUnit === "rounds") return timing === setting.stacks.tickTiming;
  return false;
}

function singleAttackResolutionMatches(entry, setting, event) {
  if (setting?.stacks?.behavior !== "singleAttack") return false;
  if (entry.combatId !== event.combatId) return false;
  if (!entry.resolutionActivityUuid || entry.resolutionActivityUuid !== event.activityUuid) return false;
  if (entry.resolutionItemUuid && event.itemUuid && entry.resolutionItemUuid !== event.itemUuid) return false;
  return true;
}

function effectFlags(entry) {
  return {
    triggeredRuntime: true,
    ledgerVersion: LEDGER_VERSION,
    sourceItemId: entry.sourceItemId,
    triggerId: entry.triggerId,
    combatId: entry.combatId,
    stacks: entry.stacks
  };
}

export class ItemCreatorTriggeredEffectService {
  static #queues = new Map();
  static #combatBefore = new Map();

  static registerHooks() {
    Hooks.once("ready", () => {
      game.socket?.on(SOCKET_CHANNEL, payload => {
        if (!isAuthoritativeGM()) return;
        if (payload?.type === "triggerEvent") void this.#processEvent(payload.event);
        else if (payload?.type === "attackDamageResolved") void this.#resolveSingleAttackEffects(payload.event);
      });
      if (isAuthoritativeGM()) {
        for (const actor of game.actors ?? []) void this.syncActor(actor);
      }
    });

    Hooks.on("dnd5e.postRollAttack", (rolls, { subject } = {}) => this.#onAttackRolls(rolls, subject));
    Hooks.on("dnd5e.rollDamage", (rolls, { subject } = {}) => this.#onDamageRolled(rolls, subject));
    Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => this.#onActivityUsed(activity, usageConfig, results));
    Hooks.on("dnd5e.applyDamage", (actor, amount, options) => this.#onDamageApplied(actor, amount, options));

    Hooks.on("preUpdateCombat", combat => {
      this.#combatBefore.set(combat.id, {
        started: Boolean(combat.started), round: Number(combat.round ?? 0), turn: Number(combat.turn ?? -1),
        combatantId: combat.combatant?.id ?? null, actorId: combat.combatant?.actorId ?? combat.combatant?.actor?.id ?? null
      });
    });
    Hooks.on("updateCombat", (combat, changes, options) => {
      if (options?.itemCreatorRuntime) return;
      void this.#onCombatUpdated(combat, changes);
    });
    Hooks.on("deleteCombat", combat => void this.clearCombat(combat.id));

    Hooks.on("updateActor", (actor, _changes, options) => {
      if (options?.itemCreatorRuntime) return;
      void this.syncActor(actor);
    });
    Hooks.on("updateItem", (item, _changes, options) => {
      if (options?.itemCreatorRuntime || item.parent?.documentName !== "Actor") return;
      void this.syncActor(item.parent);
    });
    Hooks.on("deleteItem", item => {
      if (item.parent?.documentName === "Actor") setTimeout(() => void this.syncActor(item.parent), 0);
    });
    Hooks.on("deleteActiveEffect", (effect, options) => {
      if (options?.itemCreatorRuntime || !effect.getFlag?.(MODULE_ID, "triggeredRuntime")) return;
      if (effect.parent?.documentName === "Actor") setTimeout(() => void this.syncActor(effect.parent), 0);
    });
    Hooks.on("deleteActor", actor => this.#queues.delete(actor.uuid));
  }

  static async syncActor(actor) {
    if (!isAuthoritativeGM() || actor?.documentName !== "Actor") return;
    return this.#enqueue(actor.uuid, async () => {
      const ledger = readLedger(actor);
      const combat = currentCombatForActor(actor);
      let dirty = false;
      for (const [key, entry] of [...ledger.entries]) {
        const { item, setting } = findConfig(actor, entry.sourceItemId, entry.triggerId);
        const valid = Boolean(item && setting && combat && entry.combatId === combat.id
          && itemAvailable(item, setting.availability)
          && (!setting.unlockOnLevel || actorTotalLevel(actor) >= setting.unlockLevel));
        if (!valid) {
          await this.#removeEntryEffect(actor, entry);
          ledger.entries.delete(key);
          dirty = true;
          continue;
        }
        entry.stacks = Math.min(entry.stacks, setting.stacks.maximum);
        if (entry.stacks <= 0) {
          await this.#removeEntryEffect(actor, entry);
          ledger.entries.delete(key);
          dirty = true;
          continue;
        }
        if (await this.#syncEntryEffect(actor, item, setting, entry)) dirty = true;
      }

      const ledgerEffectIds = new Set([...ledger.entries.values()].map(entry => entry.effectId).filter(Boolean));
      const orphanIds = actor.effects.filter(effect => effect.getFlag(MODULE_ID, "triggeredRuntime")
        && !ledgerEffectIds.has(effect.id)).map(effect => effect.id);
      if (orphanIds.length) {
        await safeDeleteActiveEffects(actor, orphanIds, { itemCreatorRuntime: true });
        dirty = true;
      }
      if (dirty || !this.#sameLedger(ledger.raw, ledger.entries)) await this.#writeLedger(actor, ledger.entries);
    });
  }

  static async clearCombat(combatId) {
    if (!isAuthoritativeGM() || !combatId) return;
    for (const actor of game.actors ?? []) {
      await this.#enqueue(actor.uuid, async () => {
        const ledger = readLedger(actor);
        let changed = false;
        for (const [key, entry] of [...ledger.entries]) {
          if (entry.combatId !== combatId) continue;
          await this.#removeEntryEffect(actor, entry);
          ledger.entries.delete(key);
          changed = true;
        }
        if (changed) await this.#writeLedger(actor, ledger.entries);
      });
    }
  }

  static async audit(actor) {
    if (actor?.documentName !== "Actor") throw new Error("Provide an Actor document.");
    const ledger = readLedger(actor);
    return {
      actor: { id: actor.id, uuid: actor.uuid, name: actor.name },
      combat: currentCombatForActor(actor)?.id ?? null,
      configured: (actor.items ?? []).filter(isManagedItem).flatMap(item => triggerConfigurations(item).map(setting => ({
        item: item.name, itemUuid: item.uuid, ...clone(setting)
      }))),
      ledger: clone(ledgerData(ledger.entries)),
      effects: actor.effects.filter(effect => effect.getFlag(MODULE_ID, "triggeredRuntime")).map(effect => effect.toObject())
    };
  }

  static #enqueue(actorUuid, task) {
    const previous = this.#queues.get(actorUuid) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task).finally(() => {
      if (this.#queues.get(actorUuid) === next) this.#queues.delete(actorUuid);
    });
    this.#queues.set(actorUuid, next);
    return next;
  }

  static #emit(event) {
    if (!event?.actorUuid) return;
    if (isAuthoritativeGM()) void this.#processEvent(event);
    else game.socket?.emit(SOCKET_CHANNEL, { type: "triggerEvent", event });
  }

  static #emitAttackDamageResolved(event) {
    if (!event?.actorUuid) return;
    if (isAuthoritativeGM()) void this.#resolveSingleAttackEffects(event);
    else game.socket?.emit(SOCKET_CHANNEL, { type: "attackDamageResolved", event });
  }

  static #onDamageRolled(rolls, activity) {
    const actor = activity?.actor;
    const item = activity?.item;
    if (!actor || !item || !(activity?.type === "attack" || activity?.attack)) return;
    const combat = currentCombatForActor(actor);
    if (!combat) return;
    const firstRoll = (rolls ?? [])[0];
    const messageId = firstRoll?.parent?.id ?? firstRoll?.options?.messageId ?? "";
    this.#emitAttackDamageResolved({
      id: eventId("attackDamageResolved", activity.uuid, messageId, combat.round, combat.turn),
      actorUuid: actor.uuid,
      actorId: actor.id,
      combatId: combat.id,
      round: combat.round,
      turn: combat.turn,
      itemUuid: item.uuid,
      itemId: item.id,
      activityUuid: activity.uuid,
      activityId: activity.id,
      messageId,
      timestamp: Date.now()
    });
  }

  static #onAttackRolls(rolls, activity) {
    const actor = activity?.actor;
    const item = activity?.item;
    if (!actor || !item) return;
    const combat = currentCombatForActor(actor);
    if (!combat) return;
    const classification = attackClassification(activity);
    for (const [index, roll] of (rolls ?? []).entries()) {
      const messageId = roll?.parent?.id ?? roll?.options?.messageId ?? "";
      const natural = activeD20Result(roll);
      const critical = Boolean(roll?.isCritical);
      const hit = critical || Boolean(roll?.isSuccess);
      const base = {
        actorUuid: actor.uuid,
        actorId: actor.id,
        combatId: combat.id,
        round: combat.round,
        turn: combat.turn,
        itemUuid: item.uuid,
        itemId: item.id,
        itemName: item.name,
        itemIdentifier: item.system?.identifier ?? "",
        activityUuid: activity.uuid,
        activityId: activity.id,
        activityUseId: messageId || `${activity.uuid}:${Date.now()}`,
        messageId,
        rollKey: `${messageId || activity.uuid}:${index}:${roll?.total}:${natural}`,
        total: Number(roll?.total) || 0,
        natural,
        critical,
        hit,
        attackType: classification.type,
        weaponAttack: classification.weapon,
        spellAttack: classification.spell,
        timestamp: Date.now()
      };
      this.#emit({ ...base, id: eventId("attackRolled", base.rollKey), type: "attackRolled" });
      if (hit) this.#emit({ ...base, id: eventId("attackHit", base.rollKey), type: "attackHit" });
      if (critical) this.#emit({ ...base, id: eventId("criticalHit", base.rollKey), type: "criticalHit" });
      if (natural === 20) this.#emit({ ...base, id: eventId("natural20", base.rollKey), type: "natural20" });
    }
  }

  static #onActivityUsed(activity, usageConfig = {}, results = {}) {
    const actor = activity?.actor;
    const item = activity?.item;
    if (!actor || !item) return;
    const combat = currentCombatForActor(actor);
    if (!combat) return;
    const messageId = results?.message?.id ?? "";
    const activityUseId = messageId || `${activity.uuid}:${Date.now()}`;
    const base = {
      actorUuid: actor.uuid, actorId: actor.id, combatId: combat.id, round: combat.round, turn: combat.turn,
      itemUuid: item.uuid, itemId: item.id, itemName: item.name, itemIdentifier: item.system?.identifier ?? "",
      activityUuid: activity.uuid, activityId: activity.id, activityType: activity.type,
      activityUseId, messageId, timestamp: Date.now()
    };
    const isSpell = item.type === "spell" || activity.isSpell;
    const hasAttack = activity.type === "attack" || Boolean(activity.attack);
    const hasSave = activity.type === "save" || Boolean(activity.save?.ability?.length);
    if (isSpell) {
      const spellLevel = Number(item.system?.level) || 0;
      const slotKey = usageConfig?.spell?.slot ?? "";
      const usedSlot = Boolean(usageConfig?.consume?.spellSlot && slotKey);
      const spellBase = {
        ...base, spellUuid: item.uuid, spellName: item.name, spellIdentifier: item.system?.identifier ?? "",
        spellLevel, spellSchool: item.system?.school ?? "", spellSlotKey: slotKey,
        spellSlotLevel: slotKey === "pact" ? Number(actor.system?.spells?.pact?.level) || spellLevel
          : Number(String(slotKey).replace("spell", "")) || spellLevel,
        usedSlot
      };
      this.#emit({ ...spellBase, id: eventId("spellCast", activityUseId), type: "spellCast" });
      if (hasAttack) this.#emit({ ...spellBase, id: eventId("spellAttackCast", activityUseId), type: "spellAttackCast" });
      if (hasSave) this.#emit({ ...spellBase, id: eventId("spellSaveCast", activityUseId), type: "spellSaveCast" });
      this.#emit({ ...spellBase, id: eventId("specificSpellCast", activityUseId), type: "specificSpellCast" });
      if (usedSlot) this.#emit({ ...spellBase, id: eventId("spellCastUsingSlot", activityUseId), type: "spellCastUsingSlot" });
      else this.#emit({ ...spellBase, id: eventId("spellCastWithoutSlot", activityUseId), type: "spellCastWithoutSlot" });
    }

    const feature = item.type === "feat";
    const anyItem = ["weapon", "equipment", "tool", "consumable", "feat"].includes(item.type);
    if (feature) {
      this.#emit({ ...base, id: eventId("anyFeatureUsed", activityUseId), type: "anyFeatureUsed" });
      this.#emit({ ...base, id: eventId("specificFeatureUsed", activityUseId), type: "specificFeatureUsed" });
    }
    if (anyItem) this.#emit({ ...base, id: eventId("anyItemUsed", activityUseId), type: "anyItemUsed" });
    if (isManagedItem(item)) this.#emit({ ...base, id: eventId("thisItemActivityUsed", activityUseId), type: "thisItemActivityUsed" });

    const updates = results?.updates ?? {};
    const consumed = Boolean(usageConfig?.hasConsumption
      || Object.keys(updates.actor ?? {}).length || (updates.item ?? []).length || Object.keys(updates.activity ?? {}).length);
    if (!consumed) return;

    const targetItems = [];
    for (const update of updates.item ?? []) {
      const target = actor.items?.get(update._id);
      if (target) targetItems.push(target);
    }
    if (!targetItems.length) targetItems.push(item);
    const resourceTarget = targetItems[0];
    const uses = resourceTarget.system?.uses;
    const max = Number(uses?.max) || 0;
    const spent = Number(uses?.spent) || 0;
    const remaining = Math.max(0, max - spent);
    const resourceBase = {
      ...base,
      resourceUuid: resourceTarget.uuid,
      resourceName: resourceTarget.name,
      resourceIdentifier: resourceTarget.system?.identifier ?? "",
      resourceId: resourceTarget.system?.identifier ?? slug(resourceTarget.name),
      remainingUses: remaining,
      maximumUses: max
    };
    this.#emit({ ...resourceBase, id: eventId("resourceSpent", activityUseId), type: "resourceSpent" });
    this.#emit({ ...resourceBase, id: eventId("specificResourceSpent", activityUseId), type: "specificResourceSpent" });
    if (remaining === 0 && max > 0) {
      this.#emit({ ...resourceBase, id: eventId("resourceReducedToZero", activityUseId), type: "resourceReducedToZero" });
      this.#emit({ ...resourceBase, id: eventId("lastUseSpent", activityUseId), type: "lastUseSpent" });
    }
    if (resourceTarget.type === "feat") this.#emit({ ...resourceBase, id: eventId("featureUseSpent", activityUseId), type: "featureUseSpent" });
    if (["weapon", "equipment", "tool", "consumable"].includes(resourceTarget.type)) {
      this.#emit({ ...resourceBase, id: eventId("itemChargeSpent", activityUseId), type: "itemChargeSpent" });
    }
    if (isSpell && usageConfig?.consume?.spellSlot && usageConfig?.spell?.slot) {
      const slotKey = usageConfig.spell.slot;
      const spellSlotLevel = slotKey === "pact" ? Number(actor.system?.spells?.pact?.level) || Number(item.system?.level) || 0
        : Number(String(slotKey).replace("spell", "")) || 0;
      const slotBase = { ...resourceBase, spellSlotKey: slotKey, spellSlotLevel };
      this.#emit({ ...slotBase, id: eventId(slotKey === "pact" ? "pactSlotSpent" : "spellSlotSpent", activityUseId),
        type: slotKey === "pact" ? "pactSlotSpent" : "spellSlotSpent" });
    }
  }

  static #onDamageApplied(targetActor, amount, options = {}) {
    const numeric = Number(amount) || 0;
    if (!numeric) return;
    const message = sourceMessage(options.origin) ?? sourceMessage(options.originatingMessage);
    const context = messageContext(message);
    const sourceActor = context.actor;
    const combat = game.combat;
    if (!combat?.started) return;
    const damage = numeric > 0;
    const magnitude = Math.abs(numeric);
    const damages = options.damages ?? options.damage ?? [];
    const damageTypes = valuesOf(damages).flatMap(entry => valuesOf(entry?.types ?? entry?.type)).filter(Boolean);
    const damageSource = context.activity?.type === "attack" ? (context.item?.type === "spell" ? "spell" : "attack")
      : context.item?.type === "spell" ? "spell" : context.item ? "feature" : "any";
    const base = {
      combatId: combat.id, round: combat.round, turn: combat.turn,
      targetActorUuid: targetActor.uuid, targetActorId: targetActor.id,
      sourceActorUuid: sourceActor?.uuid ?? "", sourceActorId: sourceActor?.id ?? "",
      itemUuid: context.itemUuid, itemId: context.item?.id ?? "", itemName: context.item?.name ?? "",
      itemIdentifier: context.item?.system?.identifier ?? "",
      activityUuid: context.activityUuid, activityId: context.activity?.id ?? "",
      activityUseId: message?.id ?? `${context.activityUuid}:${Date.now()}`,
      messageId: message?.id ?? "", amount: magnitude, damageTypes, damageSource, timestamp: Date.now()
    };
    if (damage) {
      if (sourceActor) this.#emit({ ...base, actorUuid: sourceActor.uuid, actorId: sourceActor.id,
        id: eventId("damageDealt", base.activityUseId, targetActor.id), type: "damageDealt" });
      this.#emit({ ...base, actorUuid: targetActor.uuid, actorId: targetActor.id,
        id: eventId("damageReceived", base.activityUseId, targetActor.id), type: "damageReceived" });
      if (sourceActor && context.activity?.type === "attack") {
        this.#emit({ ...base, actorUuid: sourceActor.uuid, actorId: sourceActor.id,
          attackType: attackClassification(context.activity).type,
          weaponAttack: attackClassification(context.activity).weapon,
          spellAttack: attackClassification(context.activity).spell,
          id: eventId("attackDamageApplied", base.activityUseId, targetActor.id), type: "attackDamageApplied" });
      }
    } else {
      if (sourceActor) this.#emit({ ...base, actorUuid: sourceActor.uuid, actorId: sourceActor.id,
        id: eventId("healingDealt", base.activityUseId, targetActor.id), type: "healingDealt" });
      this.#emit({ ...base, actorUuid: targetActor.uuid, actorId: targetActor.id,
        id: eventId("healingReceived", base.activityUseId, targetActor.id), type: "healingReceived" });
    }
  }

  static async #onCombatUpdated(combat, changes) {
    if (!isAuthoritativeGM()) return;
    const before = this.#combatBefore.get(combat.id) ?? {
      started: false, round: 0, turn: -1, actorId: null
    };
    this.#combatBefore.delete(combat.id);
    if (before.started && !combat.started) {
      await this.clearCombat(combat.id);
      return;
    }
    if (!before.started && combat.started) {
      for (const combatant of combat.combatants ?? []) {
        const actor = combatant.actor;
        if (actor) this.#emitCombatEvent(actor, combat, "combatStart");
      }
    }

    const turnChanged = before.turn !== Number(combat.turn ?? -1) || before.round !== Number(combat.round ?? 0);
    if (!turnChanged || !combat.started) return;
    const previousActor = before.actorId ? game.actors?.get(before.actorId) : null;
    const currentActor = combat.combatant?.actor ?? null;

    if (previousActor) {
      this.#emitCombatEvent(previousActor, combat, "ownerTurnEnd");
      await this.#tickCombat(combat, "ownerTurnEnd", previousActor.id);
    }
    await this.#tickCombat(combat, "combatTurnEnd", previousActor?.id ?? null);

    if (before.round && before.round !== Number(combat.round ?? 0)) {
      for (const combatant of combat.combatants ?? []) {
        if (combatant.actor) this.#emitCombatEvent(combatant.actor, combat, "roundEnd");
      }
      await this.#tickCombat(combat, "roundEnd", null);
      for (const combatant of combat.combatants ?? []) {
        if (combatant.actor) this.#emitCombatEvent(combatant.actor, combat, "roundStart");
      }
      await this.#tickCombat(combat, "roundStart", null);
    }

    await this.#tickCombat(combat, "combatTurnStart", currentActor?.id ?? null);
    if (currentActor) {
      this.#emitCombatEvent(currentActor, combat, "ownerTurnStart");
      await this.#tickCombat(combat, "ownerTurnStart", currentActor.id);
    }
  }

  static #emitCombatEvent(actor, combat, type) {
    this.#emit({
      id: eventId(type, combat.id, combat.round, combat.turn, actor.id), type,
      actorUuid: actor.uuid, actorId: actor.id, combatId: combat.id,
      round: combat.round, turn: combat.turn, activityUseId: `${combat.id}:${combat.round}:${combat.turn}:${type}`,
      timestamp: Date.now()
    });
  }

  static async #resolveSingleAttackEffects(event) {
    if (!isAuthoritativeGM()) return;
    const actor = fromUuidSync(event.actorUuid, { strict: false }) ?? game.actors?.get(event.actorId);
    if (actor?.documentName !== "Actor") return;
    await this.#enqueue(actor.uuid, async () => {
      const ledger = readLedger(actor);
      let changed = false;
      for (const [key, entry] of [...ledger.entries]) {
        const { setting } = findConfig(actor, entry.sourceItemId, entry.triggerId);
        if (!singleAttackResolutionMatches(entry, setting, event)) continue;
        await this.#removeEntryEffect(actor, entry);
        ledger.entries.delete(key);
        changed = true;
      }
      if (changed) await this.#writeLedger(actor, ledger.entries);
    });
  }

  static async #processEvent(event) {
    if (!isAuthoritativeGM()) return;
    const actor = fromUuidSync(event.actorUuid, { strict: false }) ?? game.actors?.get(event.actorId);
    if (actor?.documentName !== "Actor") return;
    const combat = game.combats?.get(event.combatId) ?? currentCombatForActor(actor);
    if (!combat?.started || !combat.combatants?.some(combatant => combatant.actorId === actor.id)) return;

    await this.#enqueue(actor.uuid, async () => {
      const ledger = readLedger(actor);
      let changed = false;
      for (const item of actor.items ?? []) {
        if (!isManagedItem(item)) continue;
        for (const setting of triggerConfigurations(item)) {
          if (!itemAvailable(item, setting.availability)) continue;
          if (setting.unlockOnLevel && actorTotalLevel(actor) < setting.unlockLevel) continue;
          if (!triggerMatches(setting, event, item)) continue;
          const key = `${item.id}:${setting.id}`;
          const entry = ledger.entries.get(key) ?? normalizeEntry({
            key, sourceItemId: item.id, triggerId: setting.id, combatId: combat.id
          });
          if (entry.combatId && entry.combatId !== combat.id) continue;
          entry.combatId = combat.id;
          const keyForActivation = activationKey(setting, event);
          if (entry.recentActivationKeys.includes(keyForActivation)) continue;
          if (!withinActivationLimits(entry, setting, combat)) continue;
          entry.recentActivationKeys.push(keyForActivation);
          entry.recentActivationKeys = entry.recentActivationKeys.slice(-MAX_RECENT_KEYS);
          applyActivation(entry, setting, combat, event);
          ledger.entries.set(key, entry);
          await this.#syncEntryEffect(actor, item, setting, entry);
          changed = true;
        }
      }
      if (changed) await this.#writeLedger(actor, ledger.entries);
    });
  }

  static async #tickCombat(combat, timing, currentActorId) {
    if (!isAuthoritativeGM()) return;
    for (const combatant of combat.combatants ?? []) {
      const actor = combatant.actor;
      if (!actor) continue;
      await this.#enqueue(actor.uuid, async () => {
        const ledger = readLedger(actor);
        let changed = false;
        for (const [key, entry] of [...ledger.entries]) {
          if (entry.combatId !== combat.id) continue;
          const { item, setting } = findConfig(actor, entry.sourceItemId, entry.triggerId);
          if (!item || !setting || !itemAvailable(item, setting.availability)
            || (setting.unlockOnLevel && actorTotalLevel(actor) < setting.unlockLevel)) {
            await this.#removeEntryEffect(actor, entry);
            ledger.entries.delete(key);
            changed = true;
            continue;
          }
          if (!matchingTick(setting, timing, actor.id, currentActorId)) continue;
          if (!tickEntry(entry, setting, timing, combat)) continue;
          if (entry.stacks <= 0) {
            await this.#removeEntryEffect(actor, entry);
            ledger.entries.delete(key);
          } else await this.#syncEntryEffect(actor, item, setting, entry);
          changed = true;
        }
        if (changed) await this.#writeLedger(actor, ledger.entries);
      });
    }
  }

  static async #syncEntryEffect(actor, item, setting, entry) {
    const changes = buildTriggeredEffectChanges(setting, entry.stacks, actor);
    const current = entry.effectId ? actor.effects?.get(entry.effectId) : actor.effects?.find(effect =>
      effect.getFlag(MODULE_ID, "triggeredRuntime")
      && effect.getFlag(MODULE_ID, "sourceItemId") === item.id
      && effect.getFlag(MODULE_ID, "triggerId") === setting.id);
    const flags = effectFlags(entry);
    const name = `Item Creator — ${setting.name} (${entry.stacks})`;
    const data = {
      name,
      img: item.img || "icons/svg/aura.svg",
      origin: item.uuid,
      transfer: false,
      disabled: false,
      statuses: [],
      system: { changes },
      flags: { [MODULE_ID]: flags }
    };
    if (!current) {
      const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [data], { itemCreatorRuntime: true, render: true });
      entry.effectId = created?.id ?? null;
      return true;
    }
    entry.effectId = current.id;
    const currentChanges = current.system?.changes ?? current.changes ?? [];
    const changed = current.name !== name || current.origin !== item.uuid || current.disabled
      || JSON.stringify(currentChanges) !== JSON.stringify(changes)
      || JSON.stringify(current.flags?.[MODULE_ID] ?? {}) !== JSON.stringify(flags);
    if (changed) {
      await actor.updateEmbeddedDocuments("ActiveEffect", [{
        _id: current.id, name, img: data.img, origin: item.uuid, disabled: false,
        "system.changes": changes, [`flags.${MODULE_ID}`]: flags
      }], { itemCreatorRuntime: true, render: true });
    }
    return changed;
  }

  static async #removeEntryEffect(actor, entry) {
    const effect = entry.effectId ? actor.effects?.get(entry.effectId) : actor.effects?.find(candidate =>
      candidate.getFlag(MODULE_ID, "triggeredRuntime")
      && candidate.getFlag(MODULE_ID, "sourceItemId") === entry.sourceItemId
      && candidate.getFlag(MODULE_ID, "triggerId") === entry.triggerId);
    if (effect) await safeDeleteActiveEffects(actor, [effect.id], { itemCreatorRuntime: true, render: true });
    entry.effectId = null;
  }

  static async #writeLedger(actor, entries) {
    const data = ledgerData(entries);
    const updates = data
      ? { [`flags.${MODULE_ID}.${LEDGER_FLAG}`]: data }
      : { [`flags.${MODULE_ID}.-=${LEDGER_FLAG}`]: null };
    await actor.update(updates, { itemCreatorRuntime: true, diff: true, recursive: true, render: false });
  }

  static #sameLedger(raw, entries) {
    return JSON.stringify(raw ?? null) === JSON.stringify(ledgerData(entries));
  }
}

// Pure helpers exposed for deterministic regression tests. They are not part of the public module API.
export const __triggeredEffectTest = Object.freeze({
  activeD20Result,
  normalizeEntry,
  applyActivation,
  tickEntry,
  matchingTick,
  singleAttackResolutionMatches,
  activationKey,
  matchesAttackType
});
