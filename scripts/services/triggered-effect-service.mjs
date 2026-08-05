import { MODULE_ID } from "../constants.mjs";
import { getResourceDefinition } from "./resource-modification-registry.mjs";
import { safeDeleteActiveEffects } from "./document-operation-service.mjs";
import {
  buildTriggeredEffectChanges, extractSelectedSpellEffects, normalizeTriggeredEffect, normalizeTriggeredEffectPayload,
  validateTriggeredEffect
} from "./triggered-effect-registry.mjs";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const LEDGER_FLAG = "triggeredEffectLedger";
const LEDGER_VERSION = 2;
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

function resolveActorDocument(uuid, id = "") {
  const document = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  if (document?.documentName === "Actor") return document;
  if (document?.actor?.documentName === "Actor") return document.actor;
  return id ? game.actors?.get(id) ?? null : null;
}

function targetActorUuidsFromMessage(message) {
  const targets = valuesOf(message?.flags?.dnd5e?.targets ?? message?.system?.targets ?? []);
  return [...new Set(targets.map(target => String(target?.uuid ?? target ?? "").trim()).filter(Boolean))];
}

function eventTargetActorUuids(event) {
  return [...new Set([
    ...valuesOf(event?.targetActorUuids),
    event?.targetActorUuid
  ].map(value => String(value ?? "").trim()).filter(Boolean))];
}

function actorCandidates(combat = game.combat) {
  const actors = new Map();
  for (const actor of game.actors ?? []) if (actor?.uuid) actors.set(actor.uuid, actor);
  for (const combatant of combat?.combatants ?? []) {
    const actor = combatant.actor;
    if (actor?.uuid) actors.set(actor.uuid, actor);
  }
  return [...actors.values()];
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

function normalizeEntry(value = {}, ownerActor = null) {
  const legacyEffectRefs = value.effectId ? [{ slot: "direct", id: value.effectId }] : [];
  const effectRefs = Array.isArray(value.effectRefs) ? value.effectRefs.map(ref => ({
    slot: String(ref?.slot ?? ""), id: String(ref?.id ?? "")
  })).filter(ref => ref.slot && ref.id) : legacyEffectRefs;
  const sourceActorUuid = String(value.sourceActorUuid ?? ownerActor?.uuid ?? "");
  const recipientActorUuid = String(value.recipientActorUuid ?? ownerActor?.uuid ?? sourceActorUuid);
  return {
    key: String(value.key ?? ""),
    control: Boolean(value.control),
    sourceActorUuid,
    sourceActorId: String(value.sourceActorId ?? ownerActor?.id ?? ""),
    sourceItemId: String(value.sourceItemId ?? ""),
    triggerId: String(value.triggerId ?? ""),
    combatId: String(value.combatId ?? ""),
    recipientActorUuid,
    recipientActorId: String(value.recipientActorId ?? ownerActor?.id ?? ""),
    payloadIds: Array.isArray(value.payloadIds) ? value.payloadIds.map(String).filter(Boolean) : [],
    payloadBindings: Array.isArray(value.payloadBindings) ? value.payloadBindings.map(binding => ({
      id: String(binding?.id ?? ""), recipient: String(binding?.recipient ?? "")
    })).filter(binding => binding.id && ["owner", "target"].includes(binding.recipient)) : [],
    stacks: Math.max(0, Number(value.stacks) || 0),
    remaining: Math.max(0, Number(value.remaining) || 0),
    idleTicks: Math.max(0, Number(value.idleTicks) || 0),
    independent: Array.isArray(value.independent) ? value.independent.map(entry => ({
      id: entry.id || foundry.utils.randomID(), remaining: Math.max(0, Number(entry.remaining) || 0)
    })) : [],
    effectRefs,
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
  if ([1, LEDGER_VERSION].includes(Number(raw?.version)) && Array.isArray(raw.entries)) {
    for (const value of raw.entries) {
      const entry = normalizeEntry(value, actor);
      if (Number(raw.version) === 1 && !entry.control && entry.sourceItemId && entry.triggerId) {
        entry.key = `${entry.sourceItemId}:${entry.triggerId}:${entry.recipientActorUuid || actor.uuid}`;
      }
      if (entry.key) entries.set(entry.key, entry);
    }
  }
  return { raw, entries };
}

function ledgerData(entries) {
  const rows = [...entries.values()].filter(entry => entry.control || entry.stacks > 0)
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

function activationKey(setting, event, targetActorUuid = "") {
  const combat = game.combats?.get(event.combatId) ?? game.combat;
  if (setting.counting === "perTurn") return `turn:${combatMoment(combat)}`;
  if (setting.counting === "perRound") return `round:${combat?.id}:${Number(combat?.round ?? 0)}`;
  if (setting.counting === "perTarget") {
    return `target:${event.activityUseId || event.messageId || event.activityUuid}:${targetActorUuid || event.targetActorUuid || "none"}`;
  }
  if (setting.counting === "perActivity") return `activity:${event.activityUseId || event.messageId || event.activityUuid || event.id}`;
  return `roll:${event.rollKey || event.id}`;
}

function activationCycles(setting, event) {
  const targets = eventTargetActorUuids(event);
  if (setting.counting === "perTarget" && targets.length) {
    return targets.map(targetActorUuid => ({
      activationKey: activationKey(setting, event, targetActorUuid),
      targetActorUuids: [targetActorUuid]
    }));
  }
  return [{ activationKey: activationKey(setting, event), targetActorUuids: targets }];
}

function recipientGroups(setting, sourceActor, targetActorUuids) {
  const groups = new Map();
  const add = (actor, payload) => {
    if (actor?.documentName !== "Actor") return;
    const group = groups.get(actor.uuid) ?? { actor, payloadIds: [], payloadBindings: [] };
    if (!group.payloadIds.includes(payload.id)) group.payloadIds.push(payload.id);
    if (!group.payloadBindings.some(binding => binding.id === payload.id)) {
      group.payloadBindings.push({ id: payload.id, recipient: payload.recipient });
    }
    groups.set(actor.uuid, group);
  };
  const targets = targetActorUuids.map(uuid => resolveActorDocument(uuid)).filter(Boolean);
  for (const source of setting.effects ?? []) {
    const payload = normalizeTriggeredEffectPayload(source);
    if (payload.recipient === "target") {
      for (const target of targets) add(target, payload);
    } else add(sourceActor, payload);
  }
  return [...groups.values()];
}

function singleActivationLifetime(setting) {
  if (setting.application?.mode !== "singleActivation") return null;
  const expiration = setting.application.expiration;
  const recipient = expiration?.startsWith("recipient");
  if (["ownerTurnStartNext", "recipientTurnStartNext"].includes(expiration)) {
    return { durationAmount: 1, durationUnit: "ownerTurns", tickTiming: "ownerTurnStart", anchor: recipient ? "recipient" : "owner" };
  }
  if (["ownerTurnEndNext", "recipientTurnEndNext"].includes(expiration)) {
    return { durationAmount: 2, durationUnit: "ownerTurns", tickTiming: "ownerTurnEnd", anchor: recipient ? "recipient" : "owner" };
  }
  return { durationAmount: 1, durationUnit: "ownerTurns", tickTiming: "ownerTurnEnd", anchor: recipient ? "recipient" : "owner" };
}

function effectiveLifetime(setting) {
  return singleActivationLifetime(setting) ?? {
    durationAmount: Math.max(1, Number(setting.stacks.durationAmount) || 1),
    durationUnit: setting.stacks.durationUnit,
    tickTiming: setting.stacks.tickTiming,
    anchor: setting.stacks.durationUnit === "recipientTurns" ? "recipient" : "owner"
  };
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
    entry.remaining = lifetime.durationAmount;
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
  if (setting.application?.mode === "singleActivation" || stacks.behavior !== "singleAttack") {
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

function matchingTick(setting, timing, actorId, currentActorId, entry = null) {
  const lifetime = effectiveLifetime(setting);
  if (["ownerTurns", "recipientTurns"].includes(lifetime.durationUnit)) {
    const anchorActorId = lifetime.anchor === "recipient" ? entry?.recipientActorId : actorId;
    if (!anchorActorId || anchorActorId !== currentActorId) return false;
    return timing === lifetime.tickTiming;
  }
  if (lifetime.durationUnit === "combatTurns") return timing === lifetime.tickTiming;
  if (lifetime.durationUnit === "rounds") return timing === lifetime.tickTiming;
  return false;
}

function singleAttackResolutionMatches(entry, setting, event) {
  if (setting?.application?.mode === "singleActivation" || setting?.stacks?.behavior !== "singleAttack") return false;
  if (entry.combatId !== event.combatId) return false;
  if (!entry.resolutionActivityUuid || entry.resolutionActivityUuid !== event.activityUuid) return false;
  if (entry.resolutionItemUuid && event.itemUuid && entry.resolutionItemUuid !== event.itemUuid) return false;
  return true;
}

function effectFlags(entry, slot) {
  return {
    triggeredRuntime: true,
    ledgerVersion: LEDGER_VERSION,
    sourceActorUuid: entry.sourceActorUuid,
    sourceItemId: entry.sourceItemId,
    triggerId: entry.triggerId,
    recipientActorUuid: entry.recipientActorUuid,
    effectSlot: slot,
    combatId: entry.combatId,
    stacks: entry.stacks
  };
}

function entryPayloads(setting, entry) {
  const ids = new Set(entry.payloadIds ?? []);
  const bindings = new Map((entry.payloadBindings ?? []).map(binding => [binding.id, binding.recipient]));
  if (!ids.size) {
    return (setting.effects ?? []).map(normalizeTriggeredEffectPayload)
      .filter(payload => payload.recipient !== "target");
  }
  return (setting.effects ?? []).map(normalizeTriggeredEffectPayload).filter(payload => {
    if (!ids.has(payload.id)) return false;
    const boundRecipient = bindings.get(payload.id);
    return !boundRecipient || boundRecipient === payload.recipient;
  });
}

function effectReferenceId(entry, slot) {
  return entry.effectRefs?.find(ref => ref.slot === slot)?.id ?? null;
}

function runtimeEffectMatches(effect, entry, slot = null) {
  if (!effect?.getFlag?.(MODULE_ID, "triggeredRuntime")) return false;
  const sourceActorUuid = effect.getFlag(MODULE_ID, "sourceActorUuid");
  const sourceMatches = sourceActorUuid
    ? sourceActorUuid === entry.sourceActorUuid
    : effect.parent?.uuid === entry.sourceActorUuid;
  if (!sourceMatches) return false;
  if (effect.getFlag(MODULE_ID, "sourceItemId") !== entry.sourceItemId) return false;
  if (effect.getFlag(MODULE_ID, "triggerId") !== entry.triggerId) return false;
  const recipientActorUuid = effect.getFlag(MODULE_ID, "recipientActorUuid");
  if (recipientActorUuid && recipientActorUuid !== entry.recipientActorUuid) return false;
  if (slot !== null) {
    const effectSlot = effect.getFlag(MODULE_ID, "effectSlot");
    if (effectSlot && effectSlot !== slot) return false;
    if (!effectSlot && slot !== "direct") return false;
  }
  return true;
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
    Hooks.on("deleteCombat", combat => void this.clearCombat(combat.id, combat));

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
    const reconcileRuntimeEffect = (effect, options) => {
      if (options?.itemCreatorRuntime || !effect.getFlag?.(MODULE_ID, "triggeredRuntime")) return;
      const sourceActor = resolveActorDocument(effect.getFlag(MODULE_ID, "sourceActorUuid"))
        ?? (effect.parent?.documentName === "Actor" ? effect.parent : null);
      if (sourceActor) setTimeout(() => void this.syncActor(sourceActor), 0);
    };
    Hooks.on("updateActiveEffect", reconcileRuntimeEffect);
    Hooks.on("deleteActiveEffect", reconcileRuntimeEffect);
    Hooks.on("deleteActor", actor => {
      this.#queues.delete(actor.uuid);
      if (isAuthoritativeGM()) void this.#cleanupDeletedSourceActor(actor);
    });
  }

  static async syncActor(actor) {
    if (!isAuthoritativeGM() || actor?.documentName !== "Actor") return;
    return this.#enqueue(actor.uuid, async () => {
      const ledger = readLedger(actor);
      const combat = currentCombatForActor(actor);
      const knownRecipients = new Map([[actor.uuid, actor]]);
      for (const entry of ledger.entries.values()) {
        if (entry.control) continue;
        const recipient = resolveActorDocument(entry.recipientActorUuid, entry.recipientActorId);
        if (recipient?.uuid) knownRecipients.set(recipient.uuid, recipient);
      }
      let dirty = false;
      for (const [key, entry] of [...ledger.entries]) {
        entry.sourceActorUuid ||= actor.uuid;
        entry.sourceActorId ||= actor.id;
        const { item, setting } = findConfig(actor, entry.sourceItemId, entry.triggerId);
        const valid = Boolean(item && setting && combat && entry.combatId === combat.id
          && itemAvailable(item, setting.availability)
          && (!setting.unlockOnLevel || actorTotalLevel(actor) >= setting.unlockLevel));
        if (!valid) {
          if (!entry.control) await this.#removeEntryEffects(entry);
          ledger.entries.delete(key);
          dirty = true;
          continue;
        }
        if (entry.control) continue;
        const recipient = resolveActorDocument(entry.recipientActorUuid, entry.recipientActorId);
        if (!recipient) {
          await this.#removeEntryEffects(entry);
          ledger.entries.delete(key);
          dirty = true;
          continue;
        }
        entry.recipientActorUuid = recipient.uuid;
        entry.recipientActorId = recipient.id;
        const resolvedPayloads = entryPayloads(setting, entry);
        entry.payloadIds = resolvedPayloads.map(payload => payload.id);
        entry.payloadBindings = resolvedPayloads.map(payload => ({ id: payload.id, recipient: payload.recipient }));
        const maximum = setting.application?.mode === "singleActivation" ? 1 : setting.stacks.maximum;
        entry.stacks = Math.min(entry.stacks, maximum);
        if (entry.stacks <= 0 || !entry.payloadIds.length) {
          await this.#removeEntryEffects(entry);
          ledger.entries.delete(key);
          dirty = true;
          continue;
        }
        if (await this.#syncEntryEffects(actor, item, setting, entry)) dirty = true;
      }

      const referenced = new Set([...ledger.entries.values()].flatMap(entry =>
        (entry.effectRefs ?? []).map(ref => `${entry.recipientActorUuid}:${ref.id}`)));
      for (const recipient of knownRecipients.values()) {
        const orphanIds = recipient.effects.filter(effect => {
          if (!effect.getFlag(MODULE_ID, "triggeredRuntime")) return false;
          const sourceActorUuid = effect.getFlag(MODULE_ID, "sourceActorUuid");
          const belongsToSource = sourceActorUuid ? sourceActorUuid === actor.uuid : recipient.uuid === actor.uuid;
          return belongsToSource && !referenced.has(`${recipient.uuid}:${effect.id}`);
        }).map(effect => effect.id);
        if (orphanIds.length) {
          await safeDeleteActiveEffects(recipient, orphanIds, { itemCreatorRuntime: true });
          dirty = true;
        }
      }
      if (dirty || !this.#sameLedger(ledger.raw, ledger.entries)) await this.#writeLedger(actor, ledger.entries);
    });
  }

  static async clearCombat(combatId, combatDocument = null) {
    if (!isAuthoritativeGM() || !combatId) return;
    const combat = combatDocument ?? game.combats?.get(combatId) ?? game.combat;
    const candidates = actorCandidates(combat);
    for (const actor of candidates) {
      await this.#enqueue(actor.uuid, async () => {
        const ledger = readLedger(actor);
        let changed = false;
        for (const [key, entry] of [...ledger.entries]) {
          if (entry.combatId !== combatId) continue;
          if (!entry.control) await this.#removeEntryEffects(entry);
          ledger.entries.delete(key);
          changed = true;
        }
        if (changed) await this.#writeLedger(actor, ledger.entries);
      });
    }
    for (const recipient of candidates) {
      const orphanIds = recipient.effects?.filter(effect => effect.getFlag(MODULE_ID, "triggeredRuntime")
        && effect.getFlag(MODULE_ID, "combatId") === combatId).map(effect => effect.id) ?? [];
      if (orphanIds.length) await safeDeleteActiveEffects(recipient, orphanIds, { itemCreatorRuntime: true, render: true });
    }
  }

  static async #cleanupDeletedSourceActor(actor) {
    if (actor?.documentName !== "Actor") return;
    const ledger = readLedger(actor);
    for (const entry of ledger.entries.values()) {
      if (!entry.control) await this.#removeEntryEffects(entry);
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
      effects: actorCandidates(currentCombatForActor(actor)).flatMap(recipient => recipient.effects
        .filter(effect => effect.getFlag(MODULE_ID, "triggeredRuntime")
          && (effect.getFlag(MODULE_ID, "sourceActorUuid") || actor.uuid) === actor.uuid)
        .map(effect => ({ recipient: recipient.uuid, ...effect.toObject() })))
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
      const message = sourceMessage(roll?.parent) ?? sourceMessage(roll?.options?.messageId);
      const messageId = message?.id ?? roll?.parent?.id ?? roll?.options?.messageId ?? "";
      const targetActorUuids = targetActorUuidsFromMessage(message);
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
        targetActorUuids,
        targetActorUuid: targetActorUuids.length === 1 ? targetActorUuids[0] : "",
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
    const targetActorUuids = targetActorUuidsFromMessage(results?.message);
    const activityUseId = messageId || `${activity.uuid}:${Date.now()}`;
    const base = {
      actorUuid: actor.uuid, actorId: actor.id, combatId: combat.id, round: combat.round, turn: combat.turn,
      itemUuid: item.uuid, itemId: item.id, itemName: item.name, itemIdentifier: item.system?.identifier ?? "",
      activityUuid: activity.uuid, activityId: activity.id, activityType: activity.type,
      activityUseId, messageId, targetActorUuids,
      targetActorUuid: targetActorUuids.length === 1 ? targetActorUuids[0] : "", timestamp: Date.now()
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
      targetActorUuid: targetActor.uuid, targetActorId: targetActor.id, targetActorUuids: [targetActor.uuid],
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
      await this.clearCombat(combat.id, combat);
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
    const previousActor = before.actorId
      ? combat.combatants?.find(combatant => combatant.actorId === before.actorId || combatant.actor?.id === before.actorId)?.actor
        ?? game.actors?.get(before.actorId) ?? null
      : null;
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
    const actor = resolveActorDocument(event.actorUuid, event.actorId);
    if (actor?.documentName !== "Actor") return;
    await this.#enqueue(actor.uuid, async () => {
      const ledger = readLedger(actor);
      let changed = false;
      for (const [key, entry] of [...ledger.entries]) {
        if (entry.control) continue;
        const { setting } = findConfig(actor, entry.sourceItemId, entry.triggerId);
        if (!singleAttackResolutionMatches(entry, setting, event)) continue;
        await this.#removeEntryEffects(entry);
        ledger.entries.delete(key);
        changed = true;
      }
      if (changed) await this.#writeLedger(actor, ledger.entries);
    });
  }

  static async #processEvent(event) {
    if (!isAuthoritativeGM()) return;
    const actor = resolveActorDocument(event.actorUuid, event.actorId);
    if (actor?.documentName !== "Actor") return;
    const combat = game.combats?.get(event.combatId) ?? currentCombatForActor(actor);
    if (!combat?.started || !combat.combatants?.some(combatant => combatant.actorId === actor.id || combatant.actor?.id === actor.id)) return;

    await this.#enqueue(actor.uuid, async () => {
      const ledger = readLedger(actor);
      let changed = false;
      for (const item of actor.items ?? []) {
        if (!isManagedItem(item)) continue;
        for (const setting of triggerConfigurations(item)) {
          if (!itemAvailable(item, setting.availability)) continue;
          if (setting.unlockOnLevel && actorTotalLevel(actor) < setting.unlockLevel) continue;
          if (!triggerMatches(setting, event, item)) continue;

          const controlKey = `${item.id}:${setting.id}:control`;
          const control = ledger.entries.get(controlKey) ?? normalizeEntry({
            key: controlKey,
            control: true,
            sourceActorUuid: actor.uuid,
            sourceActorId: actor.id,
            sourceItemId: item.id,
            triggerId: setting.id,
            combatId: combat.id
          }, actor);
          if (control.combatId && control.combatId !== combat.id) continue;
          control.combatId = combat.id;

          for (const cycle of activationCycles(setting, event)) {
            if (control.recentActivationKeys.includes(cycle.activationKey)) continue;
            const groups = recipientGroups(setting, actor, cycle.targetActorUuids);
            if (!groups.length) {
              if ((setting.effects ?? []).some(payload => normalizeTriggeredEffectPayload(payload).recipient === "target")) {
                console.warn(`${MODULE_ID} | Triggered Effect "${setting.name}" skipped because the triggering event did not provide a valid target.`);
              }
              continue;
            }

            const eligible = [];
            for (const group of groups) {
              const key = `${item.id}:${setting.id}:${group.actor.uuid}`;
              const existing = ledger.entries.get(key);
              if (setting.application?.mode === "singleActivation"
                && setting.application.retrigger === "ignore"
                && existing?.combatId === combat.id && existing.stacks > 0) continue;
              eligible.push({ ...group, key, existing });
            }
            if (!eligible.length) continue;
            if (!withinActivationLimits(control, setting, combat)) continue;

            for (const group of eligible) {
              let entry = group.existing;
              if (entry?.combatId && entry.combatId !== combat.id) {
                await this.#removeEntryEffects(entry);
                ledger.entries.delete(group.key);
                entry = null;
              }
              entry ??= normalizeEntry({
                key: group.key,
                sourceActorUuid: actor.uuid,
                sourceActorId: actor.id,
                sourceItemId: item.id,
                triggerId: setting.id,
                combatId: combat.id,
                recipientActorUuid: group.actor.uuid,
                recipientActorId: group.actor.id,
                payloadIds: group.payloadIds,
                payloadBindings: group.payloadBindings
              }, actor);
              entry.key = group.key;
              entry.control = false;
              entry.sourceActorUuid = actor.uuid;
              entry.sourceActorId = actor.id;
              entry.sourceItemId = item.id;
              entry.triggerId = setting.id;
              entry.combatId = combat.id;
              entry.recipientActorUuid = group.actor.uuid;
              entry.recipientActorId = group.actor.id;
              entry.payloadIds = [...group.payloadIds];
              entry.payloadBindings = clone(group.payloadBindings);
              applyActivation(entry, setting, combat, event);
              ledger.entries.set(group.key, entry);
              await this.#syncEntryEffects(actor, item, setting, entry);
            }

            control.recentActivationKeys.push(cycle.activationKey);
            control.recentActivationKeys = control.recentActivationKeys.slice(-MAX_RECENT_KEYS);
            control.lastEventId = String(event.id ?? "");
            control.lastTriggerMoment = combatMoment(combat);
            ledger.entries.set(controlKey, control);
            changed = true;
          }
        }
      }
      if (changed) await this.#writeLedger(actor, ledger.entries);
    });
  }

  static async #tickCombat(combat, timing, currentActorId) {
    if (!isAuthoritativeGM()) return;
    const sourceActors = new Map();
    for (const combatant of combat.combatants ?? []) {
      const actor = combatant.actor;
      if (actor?.uuid) sourceActors.set(actor.uuid, actor);
    }
    for (const actor of sourceActors.values()) {
      await this.#enqueue(actor.uuid, async () => {
        const ledger = readLedger(actor);
        let changed = false;
        for (const [key, entry] of [...ledger.entries]) {
          if (entry.combatId !== combat.id) continue;
          const { item, setting } = findConfig(actor, entry.sourceItemId, entry.triggerId);
          if (!item || !setting || !itemAvailable(item, setting.availability)
            || (setting.unlockOnLevel && actorTotalLevel(actor) < setting.unlockLevel)) {
            if (!entry.control) await this.#removeEntryEffects(entry);
            ledger.entries.delete(key);
            changed = true;
            continue;
          }
          if (entry.control) continue;
          if (!matchingTick(setting, timing, actor.id, currentActorId, entry)) continue;
          if (!tickEntry(entry, setting, timing, combat)) continue;
          if (entry.stacks <= 0) {
            await this.#removeEntryEffects(entry);
            ledger.entries.delete(key);
          } else await this.#syncEntryEffects(actor, item, setting, entry);
          changed = true;
        }
        if (changed) await this.#writeLedger(actor, ledger.entries);
      });
    }
  }

  static async #effectDescriptors(item, setting, entry, recipient) {
    const payloads = entryPayloads(setting, entry);
    const descriptors = [];
    const directPayloads = payloads.filter(payload => payload.type !== "selectedSpellEffects");
    const directChanges = buildTriggeredEffectChanges(setting, entry.stacks, recipient, { payloads: directPayloads });
    if (directChanges.length) {
      descriptors.push({
        slot: "direct",
        name: `Item Creator — ${setting.name} (${entry.stacks})`,
        img: item.img || "icons/svg/aura.svg",
        changes: directChanges,
        statuses: [],
        flags: {}
      });
    }

    for (const payload of payloads.filter(row => row.type === "selectedSpellEffects")) {
      let snapshots = clone(payload.spellEffects ?? []);
      if (!snapshots.length && payload.spellUuid) {
        try {
          const spell = await fromUuid(payload.spellUuid);
          snapshots = extractSelectedSpellEffects(spell);
        } catch (error) {
          console.warn(`${MODULE_ID} | Unable to resolve selected Spell effects for ${payload.spellName || payload.spellUuid}.`, error);
        }
      }
      for (const [index, snapshot] of snapshots.entries()) {
        const snapshotId = String(snapshot?.id ?? index);
        descriptors.push({
          slot: `spell:${payload.id}:${snapshotId}`,
          name: `Item Creator — ${setting.name}: ${payload.spellName || "Selected Spell"}${snapshot?.name ? ` — ${snapshot.name}` : ""}`,
          img: snapshot?.img || payload.spellImg || item.img || "icons/svg/aura.svg",
          changes: clone(snapshot?.changes ?? []),
          statuses: valuesOf(snapshot?.statuses).map(String).filter(Boolean),
          flags: clone(snapshot?.flags ?? {})
        });
      }
    }
    return descriptors;
  }

  static #findRuntimeEffect(recipient, entry, slot) {
    const referenceId = effectReferenceId(entry, slot);
    const referenced = referenceId ? recipient.effects?.get(referenceId) : null;
    if (runtimeEffectMatches(referenced, entry, slot)) return referenced;
    return recipient.effects?.find(effect => runtimeEffectMatches(effect, entry, slot)) ?? null;
  }

  static async #syncEntryEffects(sourceActor, item, setting, entry) {
    const recipient = resolveActorDocument(entry.recipientActorUuid, entry.recipientActorId);
    if (!recipient) return false;
    entry.sourceActorUuid = sourceActor.uuid;
    entry.sourceActorId = sourceActor.id;
    entry.recipientActorUuid = recipient.uuid;
    entry.recipientActorId = recipient.id;

    const descriptors = await this.#effectDescriptors(item, setting, entry, recipient);
    const desiredSlots = new Set(descriptors.map(descriptor => descriptor.slot));
    let changed = false;
    const nextRefs = [];

    for (const descriptor of descriptors) {
      const runtimeFlags = effectFlags(entry, descriptor.slot);
      const flags = foundry.utils.mergeObject(clone(descriptor.flags ?? {}), {
        [MODULE_ID]: runtimeFlags
      }, { inplace: false, recursive: true, overwrite: true });
      const data = {
        name: descriptor.name,
        img: descriptor.img,
        origin: item.uuid,
        transfer: false,
        disabled: false,
        duration: {},
        statuses: descriptor.statuses,
        system: { changes: descriptor.changes },
        flags
      };
      const current = this.#findRuntimeEffect(recipient, entry, descriptor.slot);
      if (!current) {
        const [created] = await recipient.createEmbeddedDocuments("ActiveEffect", [data], {
          itemCreatorRuntime: true, render: true
        });
        if (created?.id) nextRefs.push({ slot: descriptor.slot, id: created.id });
        changed = true;
        continue;
      }

      nextRefs.push({ slot: descriptor.slot, id: current.id });
      const currentChanges = current.system?.changes ?? current.changes ?? [];
      const currentStatuses = valuesOf(current.statuses).map(String).filter(Boolean);
      const currentFlags = clone(current.flags ?? {});
      const needsUpdate = current.name !== descriptor.name
        || current.img !== descriptor.img
        || current.origin !== item.uuid
        || current.disabled
        || current.transfer
        || JSON.stringify(currentChanges) !== JSON.stringify(descriptor.changes)
        || JSON.stringify(currentStatuses) !== JSON.stringify(descriptor.statuses)
        || JSON.stringify(currentFlags) !== JSON.stringify(flags);
      if (needsUpdate) {
        await recipient.updateEmbeddedDocuments("ActiveEffect", [{
          _id: current.id,
          name: descriptor.name,
          img: descriptor.img,
          origin: item.uuid,
          transfer: false,
          disabled: false,
          duration: {},
          statuses: descriptor.statuses,
          "system.changes": descriptor.changes,
          flags
        }], { itemCreatorRuntime: true, render: true });
        changed = true;
      }
    }

    const staleIds = [];
    for (const ref of entry.effectRefs ?? []) {
      if (desiredSlots.has(ref.slot)) continue;
      const effect = recipient.effects?.get(ref.id);
      if (effect) staleIds.push(effect.id);
    }
    for (const effect of recipient.effects ?? []) {
      if (!effect.getFlag(MODULE_ID, "triggeredRuntime")) continue;
      if (effect.getFlag(MODULE_ID, "sourceActorUuid") !== entry.sourceActorUuid) continue;
      if (effect.getFlag(MODULE_ID, "sourceItemId") !== entry.sourceItemId) continue;
      if (effect.getFlag(MODULE_ID, "triggerId") !== entry.triggerId) continue;
      if (effect.getFlag(MODULE_ID, "recipientActorUuid") !== entry.recipientActorUuid) continue;
      const slot = effect.getFlag(MODULE_ID, "effectSlot");
      if (!desiredSlots.has(slot) && !staleIds.includes(effect.id)) staleIds.push(effect.id);
    }
    if (staleIds.length) {
      await safeDeleteActiveEffects(recipient, staleIds, { itemCreatorRuntime: true, render: true });
      changed = true;
    }

    entry.effectRefs = nextRefs;
    return changed;
  }

  static async #removeEntryEffects(entry) {
    const recipient = resolveActorDocument(entry.recipientActorUuid, entry.recipientActorId);
    if (!recipient) {
      entry.effectRefs = [];
      return false;
    }
    const ids = new Set();
    for (const ref of entry.effectRefs ?? []) {
      const effect = recipient.effects?.get(ref.id);
      if (runtimeEffectMatches(effect, entry, ref.slot)) ids.add(effect.id);
    }
    for (const effect of recipient.effects ?? []) {
      if (runtimeEffectMatches(effect, entry)) ids.add(effect.id);
    }
    if (ids.size) {
      await safeDeleteActiveEffects(recipient, [...ids], { itemCreatorRuntime: true, render: true });
    }
    entry.effectRefs = [];
    return Boolean(ids.size);
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
  effectiveLifetime,
  tickEntry,
  matchingTick,
  singleAttackResolutionMatches,
  activationKey,
  activationCycles,
  recipientGroups,
  effectFlags,
  entryPayloads,
  runtimeEffectMatches,
  matchesAttackType
});
