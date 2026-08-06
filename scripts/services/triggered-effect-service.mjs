import { MODULE_ID } from "../constants.mjs";
import { getResourceDefinition } from "./resource-modification-registry.mjs";
import { safeDeleteActiveEffects } from "./document-operation-service.mjs";
import {
  buildTriggeredEffectChanges, normalizeTriggeredEffect, validateTriggeredEffect
} from "./triggered-effect-registry.mjs";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const LEDGER_FLAG = "triggeredEffectLedger";
const LEDGER_VERSION = 2;
const ROLL_PATCH_FLAG = Symbol.for(`${MODULE_ID}.consumableRollPatch`);
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
  if (typeof value === "string") {
    const message = game.messages?.get(value) ?? fromUuidSync(value, { strict: false });
    return message?.documentName === "ChatMessage" ? message : null;
  }
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

function combatHasActor(combat, actor) {
  if (!combat?.started || actor?.documentName !== "Actor") return false;
  return Boolean(combat.combatants?.some(combatant => combatant.actor?.uuid === actor.uuid
    || combatant.actorId === actor.id || combatant.actor?.id === actor.id));
}

function currentCombatForActor(actor) {
  if (combatHasActor(game.combat, actor)) return game.combat;
  return valuesOf(game.combats).find(combat => combatHasActor(combat, actor)) ?? null;
}

function runtimeActors(combat = null) {
  const actors = new Map();
  for (const actor of game.actors ?? []) {
    if (actor?.documentName === "Actor") actors.set(actor.uuid, actor);
  }
  const combats = combat ? [combat] : valuesOf(game.combats);
  for (const current of combats) {
    for (const combatant of current?.combatants ?? []) {
      const actor = combatant.actor;
      if (actor?.documentName === "Actor") actors.set(actor.uuid, actor);
    }
  }
  return [...actors.values()];
}

function combatMoment(combat) {
  return `${combat?.id ?? "none"}:${Number(combat?.round ?? 0)}:${Number(combat?.turn ?? -1)}`;
}

function normalizeEntry(value = {}, recipientActor = null) {
  const legacyEffectId = value.effectId ?? null;
  return {
    key: String(value.key ?? ""),
    sourceActorUuid: String(value.sourceActorUuid ?? recipientActor?.uuid ?? ""),
    recipientActorUuid: String(value.recipientActorUuid ?? recipientActor?.uuid ?? ""),
    sourceItemId: String(value.sourceItemId ?? ""),
    triggerId: String(value.triggerId ?? ""),
    combatId: String(value.combatId ?? ""),
    stacks: Math.max(0, Number(value.stacks) || 0),
    remaining: Math.max(0, Number(value.remaining) || 0),
    usesMaximum: Math.max(0, Number(value.usesMaximum) || 0),
    usesRemaining: Math.max(0, Number(value.usesRemaining) || 0),
    idleTicks: Math.max(0, Number(value.idleTicks) || 0),
    independent: Array.isArray(value.independent) ? value.independent.map(entry => ({
      id: entry.id || foundry.utils.randomID(), remaining: Math.max(0, Number(entry.remaining) || 0)
    })) : [],
    effectId: legacyEffectId,
    lastTriggerMoment: String(value.lastTriggerMoment ?? ""),
    recentActivationKeys: Array.isArray(value.recentActivationKeys) ? value.recentActivationKeys.slice(-MAX_RECENT_KEYS) : [],
    recentConsumptionKeys: Array.isArray(value.recentConsumptionKeys) ? value.recentConsumptionKeys.slice(-MAX_RECENT_KEYS) : [],
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
  if ([1, LEDGER_VERSION].includes(Number(raw?.version)) && Array.isArray(raw.entries)) {
    for (const value of raw.entries) {
      const entry = normalizeEntry(value, actor);
      if (!entry.key) continue;
      if (Number(raw.version) === 1) entry.key = `${entry.sourceActorUuid}:${entry.sourceItemId}:${entry.triggerId}`;
      entries.set(entry.key, entry);
    }
  }
  return { raw, entries };
}

function entryIsActive(entry) {
  return entry.stacks > 0 || entry.usesRemaining > 0;
}

function ledgerData(entries) {
  const rows = [...entries.values()].filter(entryIsActive)
    .sort((a, b) => a.key.localeCompare(b.key));
  return rows.length ? { version: LEDGER_VERSION, entries: rows } : null;
}

function triggerConfigurations(item) {
  return (item.getFlag(MODULE_ID, "runtime")?.triggeredEffects ?? [])
    .map(normalizeTriggeredEffect).filter(validateTriggeredEffect);
}

function findConfig(recipientActor, entryOrItemId, triggerId = null) {
  const entry = typeof entryOrItemId === "object" ? entryOrItemId : {
    sourceActorUuid: recipientActor?.uuid, sourceItemId: entryOrItemId, triggerId
  };
  const sourceActor = fromUuidSync(entry.sourceActorUuid, { strict: false })
    ?? (entry.sourceActorUuid === recipientActor?.uuid ? recipientActor : null);
  const item = sourceActor?.items?.get(entry.sourceItemId);
  if (!isManagedItem(item)) return { sourceActor: null, item: null, setting: null };
  const setting = triggerConfigurations(item).find(config => config.id === entry.triggerId) ?? null;
  return { sourceActor, item, setting };
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

function targetActorUuids() {
  return valuesOf(game.user?.targets).map(target => target?.actor?.uuid).filter(Boolean);
}

function actorFromUuid(uuid) {
  const actor = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  return actor?.documentName === "Actor" ? actor : null;
}

function recipientActors(setting, event, sourceActor) {
  let uuids = [];
  if (setting.target?.recipient === "owner") uuids = [sourceActor?.uuid];
  else if (setting.target?.recipient === "eventSource") uuids = [event.sourceActorUuid || sourceActor?.uuid];
  else {
    const resolved = [event.targetActorUuid, ...(event.targetActorUuids ?? [])].filter(Boolean);
    uuids = setting.target?.recipient === "eachAffectedTarget" ? resolved : resolved.slice(0, 1);
  }
  return [...new Set(uuids)].map(actorFromUuid).filter(actor => actor && actor.type !== "group");
}

function activationKey(setting, event) {
  const combat = game.combats?.get(event.combatId) ?? game.combat;
  if (setting.counting === "perTurn") return `turn:${combatMoment(combat)}`;
  if (setting.counting === "perRound") return `round:${combat?.id}:${Number(combat?.round ?? 0)}`;
  if (setting.counting === "perTarget") return `target:${event.activityUseId || event.messageId || event.activityUuid}:${event.targetActorUuid || "none"}`;
  if (setting.counting === "perActivity") return `activity:${event.activityUseId || event.messageId || event.activityUuid || event.id}`;
  return `roll:${event.rollKey || event.id}`;
}

function singleActivationLifetime(setting) {
  if (setting.application?.mode !== "singleActivation") return null;
  if (setting.application.expiration === "ownerTurnStartNext") {
    return { durationAmount: 1, durationUnit: "ownerTurns", tickTiming: "ownerTurnStart" };
  }
  if (setting.application.expiration === "ownerTurnEndNext") {
    return { durationAmount: 2, durationUnit: "ownerTurns", tickTiming: "ownerTurnEnd" };
  }
  return { durationAmount: 1, durationUnit: "ownerTurns", tickTiming: "ownerTurnEnd" };
}

function effectiveLifetime(setting) {
  return singleActivationLifetime(setting) ?? {
    durationAmount: Math.max(1, Number(setting.stacks.durationAmount) || 1),
    durationUnit: setting.stacks.durationUnit,
    tickTiming: setting.stacks.tickTiming
  };
}

function singleActivationInitialRemaining(setting, entry, combat) {
  const lifetime = effectiveLifetime(setting);
  if (setting.application?.mode !== "singleActivation") return lifetime.durationAmount;
  if (setting.application.expiration !== "ownerTurnEndNext") return 1;
  const anchorUuid = setting.target?.durationAnchor === "recipient"
    ? entry.recipientActorUuid : entry.sourceActorUuid;
  const currentUuid = combat?.combatant?.actor?.uuid ?? "";
  // "End of next turn" needs two matching end boundaries only when the
  // anchored Actor is already taking its current turn. Outside that turn,
  // the first matching end boundary is the end of the Actor's next turn.
  return anchorUuid && currentUuid === anchorUuid ? 2 : 1;
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
  if (setting.application?.mode === "singleActivation") {
    const lifetime = effectiveLifetime(setting);
    entry.stacks = 1;
    entry.remaining = singleActivationInitialRemaining(setting, entry, combat);
    entry.usesMaximum = 0;
    entry.usesRemaining = 0;
    entry.independent = [];
  } else if (setting.application?.mode === "untilConsumed") {
    entry.stacks = 1;
    entry.remaining = 0;
    entry.usesMaximum = Math.max(1, Number(setting.consumption?.uses) || 1);
    entry.usesRemaining = entry.usesMaximum;
    entry.independent = [];
  } else if (stacks.behavior === "singleAttack") {
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
  if (setting.application?.mode !== "untilConsumed") {
    entry.usesMaximum = 0;
    entry.usesRemaining = 0;
  }
  if (setting.application?.mode === "singleActivation" || setting.application?.mode === "untilConsumed" || stacks.behavior !== "singleAttack") {
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
  if (setting.application?.mode === "untilConsumed") return false;
  const lifetime = effectiveLifetime(setting);
  if (lifetime.tickTiming !== timing) return false;
  if (entry.lastTriggerMoment === combatMoment(combat)) return false;
  const behavior = setting.stacks.behavior;
  if (setting.application?.mode === "singleActivation"
    || behavior === "singleAttack" || behavior === "refresh" || behavior === "shared") {
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

function matchingTick(setting, timing, sourceActorId, recipientActorId, currentActorId) {
  const lifetime = effectiveLifetime(setting);
  if (lifetime.durationUnit === "ownerTurns") {
    const anchorActorId = setting.target?.durationAnchor === "recipient" ? recipientActorId : sourceActorId;
    if (anchorActorId !== currentActorId) return false;
    return timing === lifetime.tickTiming;
  }
  if (lifetime.durationUnit === "combatTurns") return timing === lifetime.tickTiming;
  if (lifetime.durationUnit === "rounds") return timing === lifetime.tickTiming;
  return false;
}

function singleAttackResolutionMatches(entry, setting, event) {
  if (["singleActivation", "untilConsumed"].includes(setting?.application?.mode) || setting?.stacks?.behavior !== "singleAttack") return false;
  if (entry.combatId !== event.combatId) return false;
  if (!entry.resolutionActivityUuid || entry.resolutionActivityUuid !== event.activityUuid) return false;
  if (entry.resolutionItemUuid && event.itemUuid && entry.resolutionItemUuid !== event.itemUuid) return false;
  return true;
}

function effectFlags(entry, setting = null) {
  return {
    triggeredRuntime: true,
    ledgerVersion: LEDGER_VERSION,
    sourceActorUuid: entry.sourceActorUuid,
    recipientActorUuid: entry.recipientActorUuid,
    sourceItemId: entry.sourceItemId,
    triggerId: entry.triggerId,
    combatId: entry.combatId,
    stacks: entry.stacks,
    usesMaximum: entry.usesMaximum,
    usesRemaining: entry.usesRemaining,
    consumable: setting?.application?.mode === "untilConsumed",
    consumptionEvent: setting?.consumption?.event ?? "",
    consumptionDecision: setting?.consumption?.decision ?? "",
    appliedSpellUuid: setting?.effectSource?.spellUuid ?? ""
  };
}

export class ItemCreatorTriggeredEffectService {
  static #queues = new Map();
  static #combatBefore = new Map();
  static #rollPatches = [];

  static registerHooks() {
    Hooks.once("ready", () => {
      game.socket?.on(SOCKET_CHANNEL, payload => {
        if (!isAuthoritativeGM()) return;
        if (payload?.type === "triggerEvent") void this.#processEvent(payload.event);
        else if (payload?.type === "attackDamageResolved") void this.#resolveSingleAttackEffects(payload.event);
        else if (payload?.type === "consumeManagedEffect") void this.#consumeManagedEffect(payload.request);
      });
      this.#installConsumableRollPatches();
      if (isAuthoritativeGM()) {
        for (const actor of runtimeActors()) void this.syncActor(actor);
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
    Hooks.on("deleteCombat", combat => void this.clearCombat(combat.id, combat));

    Hooks.on("updateActor", (actor, _changes, options) => {
      if (options?.itemCreatorRuntime) return;
      void this.syncActor(actor);
    });
    Hooks.on("updateItem", (item, _changes, options) => {
      if (options?.itemCreatorRuntime || item.parent?.documentName !== "Actor") return;
      void this.#syncSourceDependents(item.parent.uuid);
    });
    Hooks.on("deleteItem", item => {
      if (item.parent?.documentName === "Actor") setTimeout(() => void this.#syncSourceDependents(item.parent.uuid), 0);
    });
    Hooks.on("deleteActiveEffect", (effect, options) => {
      if (options?.itemCreatorRuntime || !effect.getFlag?.(MODULE_ID, "triggeredRuntime")) return;
      if (effect.parent?.documentName === "Actor") setTimeout(() => void this.syncActor(effect.parent), 0);
    });
    Hooks.on("deleteActor", actor => {
      this.#queues.delete(actor.uuid);
      if (isAuthoritativeGM()) setTimeout(() => void this.#syncSourceDependents(actor.uuid), 0);
    });
  }

  static async syncActor(actor) {
    if (!isAuthoritativeGM() || actor?.documentName !== "Actor") return;
    return this.#enqueue(actor.uuid, async () => {
      const ledger = readLedger(actor);
      const combat = currentCombatForActor(actor);
      let dirty = false;
      for (const [key, entry] of [...ledger.entries]) {
        const { sourceActor, item, setting } = findConfig(actor, entry);
        const sourceCombat = currentCombatForActor(sourceActor);
        const valid = Boolean(sourceActor && item && setting && combat && sourceCombat
          && entry.combatId === combat.id && sourceCombat.id === combat.id
          && itemAvailable(item, setting.availability)
          && (!setting.unlockOnLevel || actorTotalLevel(sourceActor) >= setting.unlockLevel));
        if (!valid) {
          await this.#removeEntryEffect(actor, entry);
          ledger.entries.delete(key);
          dirty = true;
          continue;
        }
        const maximum = setting.application?.mode === "stacking" ? setting.stacks.maximum : 1;
        entry.stacks = Math.min(entry.stacks, maximum);
        if (setting.application?.mode === "untilConsumed") {
          entry.usesMaximum = Math.max(1, Number(setting.consumption?.uses) || 1);
          entry.usesRemaining = Math.min(entry.usesRemaining || entry.usesMaximum, entry.usesMaximum);
        }
        if (!entryIsActive(entry)) {
          await this.#removeEntryEffect(actor, entry);
          ledger.entries.delete(key);
          dirty = true;
          continue;
        }
        if (await this.#syncEntryEffect(actor, sourceActor, item, setting, entry)) dirty = true;
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

  static async #syncSourceDependents(sourceActorUuid) {
    if (!isAuthoritativeGM()) return;
    for (const actor of runtimeActors()) {
      const ledger = readLedger(actor);
      if (actor.uuid === sourceActorUuid || [...ledger.entries.values()].some(entry => entry.sourceActorUuid === sourceActorUuid)) {
        await this.syncActor(actor);
      }
    }
  }

  static async clearCombat(combatId, combat = null) {
    if (!isAuthoritativeGM() || !combatId) return;
    for (const actor of runtimeActors(combat)) {
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
    const selectedTargetUuids = targetActorUuids();
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
        targetActorUuids: selectedTargetUuids,
        targetActorUuid: selectedTargetUuids.length === 1 ? selectedTargetUuids[0]
          : (selectedTargetUuids.length === (rolls ?? []).length ? selectedTargetUuids[index] : ""),
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
    const selectedTargetUuids = targetActorUuids();
    const base = {
      actorUuid: actor.uuid, actorId: actor.id, combatId: combat.id, round: combat.round, turn: combat.turn,
      itemUuid: item.uuid, itemId: item.id, itemName: item.name, itemIdentifier: item.system?.identifier ?? "",
      activityUuid: activity.uuid, activityId: activity.id, activityType: activity.type,
      activityUseId, messageId, targetActorUuids: selectedTargetUuids,
      targetActorUuid: selectedTargetUuids[0] ?? "", timestamp: Date.now()
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
    const combat = currentCombatForActor(sourceActor) ?? currentCombatForActor(targetActor);
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
    const sourceActor = actorFromUuid(event.actorUuid) ?? game.actors?.get(event.actorId);
    if (sourceActor?.documentName !== "Actor") return;
    const combat = game.combats?.get(event.combatId) ?? null;
    for (const recipient of runtimeActors(combat)) {
      await this.#enqueue(recipient.uuid, async () => {
        const ledger = readLedger(recipient);
        let changed = false;
        for (const [key, entry] of [...ledger.entries]) {
          if (entry.sourceActorUuid !== sourceActor.uuid) continue;
          const { setting } = findConfig(recipient, entry);
          if (!singleAttackResolutionMatches(entry, setting, event)) continue;
          await this.#removeEntryEffect(recipient, entry);
          ledger.entries.delete(key);
          changed = true;
        }
        if (changed) await this.#writeLedger(recipient, ledger.entries);
      });
    }
  }

  static async #processEvent(event) {
    if (!isAuthoritativeGM()) return;
    const sourceActor = actorFromUuid(event.actorUuid) ?? game.actors?.get(event.actorId);
    if (sourceActor?.documentName !== "Actor") return;
    const combat = game.combats?.get(event.combatId) ?? currentCombatForActor(sourceActor);
    if (!combatHasActor(combat, sourceActor)) return;

    for (const item of sourceActor.items ?? []) {
      if (!isManagedItem(item)) continue;
      for (const setting of triggerConfigurations(item)) {
        if (!itemAvailable(item, setting.availability)) continue;
        if (setting.unlockOnLevel && actorTotalLevel(sourceActor) < setting.unlockLevel) continue;
        if (!triggerMatches(setting, event, item)) continue;
        const recipients = recipientActors(setting, event, sourceActor)
          .filter(actor => combatHasActor(combat, actor));
        for (const recipient of recipients) {
          await this.#enqueue(recipient.uuid, async () => {
            const ledger = readLedger(recipient);
            const key = `${sourceActor.uuid}:${item.id}:${setting.id}`;
            const entry = ledger.entries.get(key) ?? normalizeEntry({
              key, sourceActorUuid: sourceActor.uuid, recipientActorUuid: recipient.uuid,
              sourceItemId: item.id, triggerId: setting.id, combatId: combat.id
            }, recipient);
            if (entry.combatId && entry.combatId !== combat.id) return;
            entry.combatId = combat.id;
            entry.sourceActorUuid = sourceActor.uuid;
            entry.recipientActorUuid = recipient.uuid;
            const recipientEvent = { ...event, targetActorUuid: recipient.uuid };
            const keyForActivation = activationKey(setting, recipientEvent);
            if (entry.recentActivationKeys.includes(keyForActivation)) return;
            if (["singleActivation", "untilConsumed"].includes(setting.application?.mode)
              && setting.application.retrigger === "ignore" && entryIsActive(entry)) return;
            if (!withinActivationLimits(entry, setting, combat)) return;
            entry.recentActivationKeys.push(keyForActivation);
            entry.recentActivationKeys = entry.recentActivationKeys.slice(-MAX_RECENT_KEYS);
            applyActivation(entry, setting, combat, recipientEvent);
            ledger.entries.set(key, entry);
            await this.#syncEntryEffect(recipient, sourceActor, item, setting, entry);
            await this.#writeLedger(recipient, ledger.entries);
          });
        }
      }
    }
  }

  static async #tickCombat(combat, timing, currentActorId) {
    if (!isAuthoritativeGM()) return;
    for (const combatant of combat.combatants ?? []) {
      const recipient = combatant.actor;
      if (!recipient) continue;
      await this.#enqueue(recipient.uuid, async () => {
        const ledger = readLedger(recipient);
        let changed = false;
        for (const [key, entry] of [...ledger.entries]) {
          if (entry.combatId !== combat.id) continue;
          const { sourceActor, item, setting } = findConfig(recipient, entry);
          if (!sourceActor || !item || !setting || !itemAvailable(item, setting.availability)
            || (setting.unlockOnLevel && actorTotalLevel(sourceActor) < setting.unlockLevel)) {
            await this.#removeEntryEffect(recipient, entry);
            ledger.entries.delete(key);
            changed = true;
            continue;
          }
          if (!matchingTick(setting, timing, sourceActor.id, recipient.id, currentActorId)) continue;
          if (!tickEntry(entry, setting, timing, combat)) continue;
          if (!entryIsActive(entry)) {
            await this.#removeEntryEffect(recipient, entry);
            ledger.entries.delete(key);
          } else await this.#syncEntryEffect(recipient, sourceActor, item, setting, entry);
          changed = true;
        }
        if (changed) await this.#writeLedger(recipient, ledger.entries);
      });
    }
  }

  static async #selectedSpellEffectData(setting) {
    if (!["spell", "combined"].includes(setting.effectSource?.mode)) return { changes: [], statuses: [], flags: {} };
    let spell = null;
    try {
      spell = setting.effectSource?.spellUuid ? await fromUuid(setting.effectSource.spellUuid) : null;
    } catch (error) {
      console.warn(`${MODULE_ID} | Applied Spell source is unavailable: ${setting.effectSource?.spellUuid ?? "unknown"}.`, error);
    }
    if (spell?.documentName !== "Item" || spell.type !== "spell") return { changes: [], statuses: [], flags: {} };
    const changes = [];
    const statuses = new Set();
    const flags = {};
    for (const effect of spell.effects ?? []) {
      const sourceChanges = clone(effect.system?.changes ?? effect.changes ?? []);
      changes.push(...sourceChanges);
      for (const status of valuesOf(effect.statuses)) statuses.add(status);
      const sourceFlags = clone(effect.flags ?? {});
      delete sourceFlags[MODULE_ID];
      delete sourceFlags.core;
      foundry.utils.mergeObject(flags, sourceFlags, { inplace: true, insertKeys: true, overwrite: true });
    }
    return { changes, statuses: [...statuses], flags };
  }

  static async #syncEntryEffect(recipient, sourceActor, item, setting, entry) {
    const builderChanges = ["builder", "combined"].includes(setting.effectSource?.mode)
      ? buildTriggeredEffectChanges(setting, entry.stacks, recipient) : [];
    const imported = await this.#selectedSpellEffectData(setting);
    const changes = [...builderChanges, ...imported.changes];
    const current = entry.effectId ? recipient.effects?.get(entry.effectId) : recipient.effects?.find(effect =>
      effect.getFlag(MODULE_ID, "triggeredRuntime")
      && (!effect.getFlag(MODULE_ID, "sourceActorUuid") || effect.getFlag(MODULE_ID, "sourceActorUuid") === sourceActor.uuid)
      && effect.getFlag(MODULE_ID, "sourceItemId") === item.id
      && effect.getFlag(MODULE_ID, "triggerId") === setting.id);
    const flags = effectFlags(entry, setting);
    const uses = setting.application?.mode === "untilConsumed"
      ? ` — ${entry.usesRemaining}/${entry.usesMaximum} use${entry.usesMaximum === 1 ? "" : "s"}` : "";
    const stackLabel = setting.application?.mode === "stacking" ? ` (${entry.stacks})` : "";
    const name = `Item Creator — ${setting.name}${stackLabel}${uses}`;
    // A consumable effect is enabled only around the eligible roll. Keeping both
    // decision modes dormant prevents a multi-purpose imported effect from leaking
    // bonuses into roll types that the GM did not select as a consumption event.
    const dormant = setting.application?.mode === "untilConsumed";
    const data = {
      name,
      img: setting.effectSource?.spellUuid && setting.effectSource?.spellName ? (item.img || "icons/svg/aura.svg") : (item.img || "icons/svg/aura.svg"),
      origin: item.uuid,
      transfer: false,
      disabled: dormant,
      statuses: imported.statuses,
      system: { changes },
      flags: { ...imported.flags, [MODULE_ID]: flags }
    };
    if (!current) {
      const [created] = await recipient.createEmbeddedDocuments("ActiveEffect", [data], { itemCreatorRuntime: true, render: true });
      entry.effectId = created?.id ?? null;
      return true;
    }
    entry.effectId = current.id;
    const currentChanges = current.system?.changes ?? current.changes ?? [];
    const currentStatuses = valuesOf(current.statuses);
    const changed = current.name !== name || current.origin !== item.uuid || current.disabled !== dormant
      || JSON.stringify(currentChanges) !== JSON.stringify(changes)
      || JSON.stringify(currentStatuses.sort()) !== JSON.stringify([...imported.statuses].sort())
      || JSON.stringify(current.flags?.[MODULE_ID] ?? {}) !== JSON.stringify(flags);
    if (changed) {
      await recipient.updateEmbeddedDocuments("ActiveEffect", [{
        _id: current.id, name, img: data.img, origin: item.uuid, disabled: dormant,
        statuses: imported.statuses, "system.changes": changes, flags: data.flags
      }], { itemCreatorRuntime: true, render: true });
    }
    return changed;
  }

  static async #removeEntryEffect(actor, entry) {
    const effect = entry.effectId ? actor.effects?.get(entry.effectId) : actor.effects?.find(candidate =>
      candidate.getFlag(MODULE_ID, "triggeredRuntime")
      && candidate.getFlag(MODULE_ID, "sourceActorUuid") === entry.sourceActorUuid
      && candidate.getFlag(MODULE_ID, "sourceItemId") === entry.sourceItemId
      && candidate.getFlag(MODULE_ID, "triggerId") === entry.triggerId);
    if (effect) await safeDeleteActiveEffects(actor, [effect.id], { itemCreatorRuntime: true, render: true });
    entry.effectId = null;
  }

  static #consumptionEventMatches(configured, rollType) {
    if (configured === "d20Test") return ["attackRoll", "abilityCheck", "savingThrow"].includes(rollType);
    return configured === rollType;
  }

  static async #promptConsumableUse(actor, item, setting, entry) {
    const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
    const effectName = setting.effectSource?.spellName || setting.name;
    return Boolean(await foundry.applications.api.DialogV2.confirm({
      window: { title: `Use ${escape(effectName)}?`, modal: true },
      content: `<p><strong>${escape(actor.name)}</strong> can use <strong>${escape(effectName)}</strong> from <strong>${escape(item.name)}</strong> for this roll.</p><p>${entry.usesRemaining} of ${entry.usesMaximum} use(s) remain. Choosing No keeps the effect available.</p>`,
      yes: { label: "Use & Consume", icon: "fa-solid fa-dice-d20" },
      no: { label: "Keep for Later", icon: "fa-solid fa-hourglass-half" }
    }));
  }

  static async #prepareConsumableRoll(actor, rollType) {
    if (actor?.documentName !== "Actor" || !currentCombatForActor(actor)) return [];
    const ledger = readLedger(actor);
    const prepared = [];
    for (const entry of ledger.entries.values()) {
      if (entry.usesRemaining <= 0) continue;
      const { item, setting } = findConfig(actor, entry);
      if (!item || setting?.application?.mode !== "untilConsumed") continue;
      if (!this.#consumptionEventMatches(setting.consumption?.event, rollType)) continue;
      const effect = entry.effectId ? actor.effects?.get(entry.effectId) : null;
      if (!effect) continue;
      let use = setting.consumption?.decision === "automatic";
      if (!use) use = await this.#promptConsumableUse(actor, item, setting, entry);
      if (!use) continue;
      if (effect.disabled) {
        try {
          await effect.update({ disabled: false }, { itemCreatorRuntime: true, render: true });
        } catch (error) {
          console.error(`${MODULE_ID} | Could not enable consumable effect.`, error);
          ui.notifications?.error?.(`Item Creator could not enable ${setting.name} for this roll.`);
          continue;
        }
      }
      prepared.push({
        actorUuid: actor.uuid, entryKey: entry.key, effectId: effect.id,
        decision: setting.consumption?.decision, configuredEvent: setting.consumption?.event,
        useKey: `${rollType}:${Date.now()}:${foundry.utils.randomID()}`
      });
    }
    return prepared;
  }

  static async #finalizeConsumableRoll(actor, rollType, prepared, result) {
    if (!prepared.length) return;
    const rolls = Array.isArray(result) ? result : result ? [result] : [];
    const completed = rolls.length > 0;
    for (const use of prepared) {
      const shouldConsume = completed;
      const effect = actor.effects?.get(use.effectId);
      if (effect && !effect.disabled) {
        try { await effect.update({ disabled: true }, { itemCreatorRuntime: true, render: true }); }
        catch (error) { console.warn(`${MODULE_ID} | Could not return consumable effect to dormant state.`, error); }
      }
      if (!shouldConsume) continue;
      const request = { recipientActorUuid: actor.uuid, entryKey: use.entryKey, useKey: use.useKey };
      if (isAuthoritativeGM()) await this.#consumeManagedEffect(request);
      else game.socket?.emit(SOCKET_CHANNEL, { type: "consumeManagedEffect", request });
    }
  }

  static async #runConsumableRoll(actor, rollType, operation) {
    const prepared = await this.#prepareConsumableRoll(actor, rollType);
    let result = null;
    try {
      result = await operation();
      return result;
    } finally {
      await this.#finalizeConsumableRoll(actor, rollType, prepared, result);
    }
  }

  static #patchRollMethod(prototype, method, rollType) {
    const original = prototype?.[method];
    if (!(original instanceof Function) || original[ROLL_PATCH_FLAG]) return;
    const service = this;
    const wrapped = async function(...args) {
      const actor = this?.documentName === "Actor" ? this : this?.actor;
      return service.#runConsumableRoll(actor, rollType, () => original.apply(this, args));
    };
    Object.defineProperty(wrapped, ROLL_PATCH_FLAG, { value: true });
    Object.defineProperty(wrapped, "name", { value: original.name, configurable: true });
    prototype[method] = wrapped;
    this.#rollPatches.push({ prototype, method, original });
  }

  static #installConsumableRollPatches() {
    const actorPrototype = CONFIG.Actor?.documentClass?.prototype;
    this.#patchRollMethod(actorPrototype, "rollAbilityCheck", "abilityCheck");
    this.#patchRollMethod(actorPrototype, "rollSavingThrow", "savingThrow");
    const activities = CONFIG.DND5E?.activityTypes ?? {};
    this.#patchRollMethod(activities.attack?.documentClass?.prototype, "rollAttack", "attackRoll");
    for (const [type, definition] of Object.entries(activities)) {
      this.#patchRollMethod(definition?.documentClass?.prototype, "rollDamage", type === "heal" ? "healingRoll" : "damageRoll");
    }
  }

  static async #consumeManagedEffect(request = {}) {
    if (!isAuthoritativeGM()) return;
    const actor = actorFromUuid(request.recipientActorUuid);
    if (!actor || !request.entryKey || !request.useKey) return;
    await this.#enqueue(actor.uuid, async () => {
      const ledger = readLedger(actor);
      const entry = ledger.entries.get(request.entryKey);
      if (!entry || entry.usesRemaining <= 0 || entry.recentConsumptionKeys.includes(request.useKey)) return;
      const { sourceActor, item, setting } = findConfig(actor, entry);
      if (!sourceActor || !item || setting?.application?.mode !== "untilConsumed") return;
      entry.recentConsumptionKeys.push(request.useKey);
      entry.recentConsumptionKeys = entry.recentConsumptionKeys.slice(-MAX_RECENT_KEYS);
      entry.usesRemaining = Math.max(0, entry.usesRemaining - 1);
      if (entry.usesRemaining <= 0) {
        entry.stacks = 0;
        await this.#removeEntryEffect(actor, entry);
        ledger.entries.delete(entry.key);
      } else {
        await this.#syncEntryEffect(actor, sourceActor, item, setting, entry);
        ledger.entries.set(entry.key, entry);
      }
      await this.#writeLedger(actor, ledger.entries);
    });
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
  entryIsActive,
  recipientActors,
  runtimeActors,
  applyActivation,
  effectiveLifetime,
  singleActivationInitialRemaining,
  tickEntry,
  matchingTick,
  singleAttackResolutionMatches,
  activationKey,
  matchesAttackType
});
