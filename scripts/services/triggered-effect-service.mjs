import { MODULE_ID } from "../constants.mjs";
import { getResourceDefinition } from "./resource-modification-registry.mjs";
import { safeDeleteActiveEffects } from "./document-operation-service.mjs";
import {
  buildTriggeredEffectChanges, extractSelectedSpellEffects, normalizeTriggeredEffect, normalizeTriggeredEffectPayload,
  validateTriggeredEffect
} from "./triggered-effect-registry.mjs";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const LEDGER_FLAG = "triggeredEffectLedger";
const LEDGER_VERSION = 4;
const MAX_RECENT_KEYS = 120;
const CONSUMPTION_PREPARE_TIMEOUT_MS = 15000;
const CONSUMPTION_STALE_MS = 5 * 60 * 1000;
const ROLL_PATCH_FLAG = Symbol.for(`${MODULE_ID}.consumableRollPatch`);
const POST_FAILURE_DELAY_MS = 100;
const POST_FAILURE_RECENT_LIMIT = 240;

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
    resolutionMessageId: String(value.resolutionMessageId ?? ""),
    usesMaximum: Math.max(0, Number(value.usesMaximum) || 0),
    usesRemaining: Math.max(0, Number(value.usesRemaining) || 0),
    recentConsumptionKeys: Array.isArray(value.recentConsumptionKeys)
      ? value.recentConsumptionKeys.map(String).filter(Boolean).slice(-MAX_RECENT_KEYS) : [],
    activeConsumptionKey: String(value.activeConsumptionKey ?? ""),
    activeConsumptionRollType: String(value.activeConsumptionRollType ?? ""),
    activeConsumptionUserId: String(value.activeConsumptionUserId ?? ""),
    activeConsumptionPreparedAt: Math.max(0, Number(value.activeConsumptionPreparedAt) || 0)
  };
}

function readLedger(actor) {
  const raw = clone(actor.getFlag(MODULE_ID, LEDGER_FLAG) ?? null);
  const entries = new Map();
  if ([1, 2, 3, LEDGER_VERSION].includes(Number(raw?.version)) && Array.isArray(raw.entries)) {
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

function consumptionEventMatches(configured, rollType) {
  if (configured === "d20Test") return ["attackRoll", "abilityCheck", "savingThrow"].includes(rollType);
  return configured === rollType;
}

function clearActiveConsumption(entry) {
  entry.activeConsumptionKey = "";
  entry.activeConsumptionRollType = "";
  entry.activeConsumptionUserId = "";
  entry.activeConsumptionPreparedAt = 0;
}

function consumptionIsStale(entry, now = Date.now()) {
  return Boolean(entry.activeConsumptionKey
    && (!entry.activeConsumptionPreparedAt || now - entry.activeConsumptionPreparedAt > CONSUMPTION_STALE_MS));
}

function rollTargetNumber(roll) {
  const target = Number(roll?.options?.target);
  return Number.isFinite(target) ? target : null;
}

function rollResultIsFailure(roll, rollType) {
  const target = rollTargetNumber(roll);
  if (target === null || !Number.isFinite(Number(roll?.total))) return false;
  if (rollType === "attackRoll" && (roll?.isCritical || activeD20Result(roll) === 20)) return false;
  if (rollType === "attackRoll" && (roll?.isFumble || activeD20Result(roll) === 1)) return true;
  return Number(roll.total) < target;
}

function additiveChange(change) {
  const mode = change?.mode ?? change?.type;
  const addMode = globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;
  return Number(mode) === Number(addMode) || String(mode ?? "").toLowerCase() === "add";
}

function attackBonusPath(activity) {
  const classification = attackClassification(activity);
  if (classification.spell) {
    if (classification.melee) return "system.bonuses.msak.attack";
    if (classification.ranged) return "system.bonuses.rsak.attack";
  }
  if (classification.weapon) {
    if (classification.melee) return "system.bonuses.mwak.attack";
    if (classification.ranged) return "system.bonuses.rwak.attack";
  }
  return "";
}

function changeAppliesToRoll(change, context = {}) {
  if (!additiveChange(change)) return false;
  const key = String(change?.key ?? "");
  if (!key || !String(change?.value ?? "").trim()) return false;
  if (context.rollType === "attackRoll") {
    const exact = attackBonusPath(context.activity);
    return exact ? key === exact : /^system\.bonuses\.(?:mwak|rwak|msak|rsak)\.attack$/.test(key);
  }
  if (context.rollType === "savingThrow") {
    return key === "system.bonuses.abilities.save"
      || (context.ability && key === `system.abilities.${context.ability}.bonuses.save`);
  }
  if (context.rollType === "abilityCheck") {
    return key === "system.bonuses.abilities.check"
      || (context.ability && key === `system.abilities.${context.ability}.bonuses.check`)
      || (context.skill && key === `system.skills.${context.skill}.bonuses.check`)
      || (context.tool && key === `system.tools.${context.tool}.bonuses.check`);
  }
  return false;
}

function managedBonusFormula(effects, sourceActorUuid, entryKey, context = {}) {
  const formulas = [];
  for (const effect of effects ?? []) {
    const flags = effect.flags?.[MODULE_ID] ?? {};
    if (!flags.triggeredRuntime || !flags.consumptionPayload) continue;
    if (String(flags.sourceActorUuid ?? "") !== String(sourceActorUuid ?? "")) continue;
    if (String(flags.entryKey ?? "") !== String(entryKey ?? "")) continue;
    const changes = effect.system?.changes ?? effect.changes ?? [];
    for (const change of changes) {
      if (!changeAppliesToRoll(change, context)) continue;
      const formula = String(change.value ?? "").trim();
      if (formula) formulas.push(`(${formula})`);
    }
  }
  return formulas.join(" + ");
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
  if (setting.consumption?.enabled) {
    entry.usesMaximum = Math.max(1, Number(setting.consumption.uses) || 1);
    entry.usesRemaining = entry.usesMaximum;
  } else {
    entry.usesMaximum = 0;
    entry.usesRemaining = 0;
  }
  clearActiveConsumption(entry);
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

function effectFlags(entry, slot, setting = null, item = null, { marker = false, payload = false } = {}) {
  const consumable = Boolean(setting?.consumption?.enabled);
  return {
    triggeredRuntime: true,
    ledgerVersion: LEDGER_VERSION,
    sourceActorUuid: entry.sourceActorUuid,
    sourceItemId: entry.sourceItemId,
    triggerId: entry.triggerId,
    recipientActorUuid: entry.recipientActorUuid,
    effectSlot: slot,
    combatId: entry.combatId,
    stacks: entry.stacks,
    entryKey: entry.key,
    consumable,
    consumptionMarker: consumable && marker,
    consumptionPayload: consumable && payload,
    usesMaximum: consumable ? entry.usesMaximum : 0,
    usesRemaining: consumable ? entry.usesRemaining : 0,
    consumptionEvent: consumable ? setting.consumption.event : "",
    consumptionDecision: consumable ? setting.consumption.decision : "",
    consumptionTiming: consumable ? setting.consumption.timing : "",
    consumptionActive: consumable ? Boolean(entry.activeConsumptionKey) : false,
    managedEffectName: String(setting?.name ?? ""),
    sourceItemName: String(item?.name ?? "")
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
  static #pendingSocketRequests = new Map();
  static #activeRollContexts = new Set();
  static #rollPatches = [];
  static #recentPostFailureKeys = [];
  static #pendingPostFailureKeys = new Set();

  static registerHooks() {
    Hooks.once("ready", () => {
      game.socket?.on(SOCKET_CHANNEL, payload => this.#onSocketPayload(payload));
      this.#installConsumableRollPatches();
      if (isAuthoritativeGM()) {
        for (const actor of game.actors ?? []) void this.syncActor(actor);
      }
    });

    Hooks.on("dnd5e.postRollAttack", (rolls, { subject } = {}) => this.#onAttackRolls(rolls, subject));
    Hooks.on("dnd5e.rollAbilityCheck", (rolls, data = {}) => this.#onD20TestRolls("abilityCheck", rolls, data));
    Hooks.on("dnd5e.rollSavingThrow", (rolls, data = {}) => this.#onD20TestRolls("savingThrow", rolls, data));
    Hooks.on("dnd5e.rollSkill", (rolls, data = {}) => this.#onD20TestRolls("abilityCheck", rolls, data));
    Hooks.on("dnd5e.rollToolCheck", (rolls, data = {}) => this.#onD20TestRolls("abilityCheck", rolls, data));
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

  static #onSocketPayload(payload = {}) {
    if (payload.type === "consumptionResponse") {
      if (payload.targetUserId !== game.user?.id) return;
      const pending = this.#pendingSocketRequests.get(payload.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.#pendingSocketRequests.delete(payload.requestId);
      if (payload.ok) pending.resolve(payload.data ?? null);
      else pending.reject(new Error(payload.error || "Item Creator consumption request failed."));
      return;
    }

    if (!isAuthoritativeGM()) return;
    if (payload.type === "triggerEvent") {
      void this.#processEvent(payload.event);
      return;
    }
    if (payload.type === "attackDamageResolved") {
      void this.#resolveSingleAttackEffects(payload.event);
      return;
    }
    if (!["prepareConsumableRoll", "finalizeConsumableRoll"].includes(payload.type)) return;

    void (async () => {
      try {
        const data = payload.type === "prepareConsumableRoll"
          ? await this.#handlePrepareConsumableRoll(payload)
          : await this.#handleFinalizeConsumableRoll(payload);
        game.socket?.emit(SOCKET_CHANNEL, {
          type: "consumptionResponse",
          requestId: payload.requestId,
          targetUserId: payload.requestingUserId,
          ok: true,
          data
        });
      } catch (error) {
        console.error(`${MODULE_ID} | Managed effect consumption request failed.`, error);
        game.socket?.emit(SOCKET_CHANNEL, {
          type: "consumptionResponse",
          requestId: payload.requestId,
          targetUserId: payload.requestingUserId,
          ok: false,
          error: error?.message || "Managed effect consumption failed."
        });
      }
    })();
  }

  static async #requestAuthoritativeGM(type, data = {}) {
    if (isAuthoritativeGM()) {
      const payload = { type, requestingUserId: game.user?.id, ...data };
      return type === "prepareConsumableRoll"
        ? this.#handlePrepareConsumableRoll(payload)
        : this.#handleFinalizeConsumableRoll(payload);
    }
    if (!activeGM() || !game.socket) throw new Error("An active GM is required to manage this effect.");
    const requestId = foundry.utils.randomID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingSocketRequests.delete(requestId);
        reject(new Error("The active GM did not respond in time."));
      }, CONSUMPTION_PREPARE_TIMEOUT_MS);
      this.#pendingSocketRequests.set(requestId, { resolve, reject, timeout });
      game.socket.emit(SOCKET_CHANNEL, {
        type,
        requestId,
        requestingUserId: game.user?.id,
        ...data
      });
    });
  }

  static #consumableCandidates(actor, rollType, timing = "beforeRoll") {
    if (actor?.documentName !== "Actor") return [];
    const combat = currentCombatForActor(actor);
    if (!combat) return [];
    const groups = new Map();
    for (const effect of actor.effects ?? []) {
      const flags = effect.flags?.[MODULE_ID] ?? {};
      if (!flags.triggeredRuntime || !flags.consumable || !flags.consumptionMarker || effect.disabled) continue;
      if (flags.combatId !== combat.id || flags.consumptionTiming !== timing) continue;
      if (!consumptionEventMatches(flags.consumptionEvent, rollType)) continue;
      if (Number(flags.usesRemaining) <= 0 || flags.consumptionActive) continue;
      const entryKey = String(flags.entryKey ?? "");
      const sourceActorUuid = String(flags.sourceActorUuid ?? "");
      if (!entryKey || !sourceActorUuid) continue;
      const key = `${sourceActorUuid}:${entryKey}`;
      groups.set(key, {
        sourceActorUuid,
        entryKey,
        recipientActorUuid: actor.uuid,
        sourceItemId: String(flags.sourceItemId ?? ""),
        triggerId: String(flags.triggerId ?? ""),
        name: String(flags.managedEffectName || effect.name || "Managed Effect"),
        sourceItemName: String(flags.sourceItemName || "Item"),
        usesMaximum: Math.max(1, Number(flags.usesMaximum) || 1),
        usesRemaining: Math.max(0, Number(flags.usesRemaining) || 0),
        decision: String(flags.consumptionDecision || "prompt"),
        timing: String(flags.consumptionTiming || "beforeRoll")
      });
    }
    return [...groups.values()];
  }

  static #escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  static #lifecycleText(setting, entry) {
    const lifetime = effectiveLifetime(setting);
    const unit = lifetime.durationUnit === "recipientTurns" ? "recipient turn(s)"
      : lifetime.durationUnit === "ownerTurns"
        ? (lifetime.anchor === "recipient" ? "recipient turn(s)" : "source-actor turn(s)")
        : lifetime.durationUnit === "combatTurns" ? "combat turn(s)"
          : lifetime.durationUnit === "rounds" ? "round(s)" : lifetime.durationUnit;
    const timing = lifetime.tickTiming === "ownerTurnStart" ? "at the start of the tracked turn"
      : lifetime.tickTiming === "ownerTurnEnd" ? "at the end of the tracked turn"
        : lifetime.tickTiming === "combatTurnStart" ? "at the start of a combat turn"
          : lifetime.tickTiming === "combatTurnEnd" ? "at the end of a combat turn"
            : lifetime.tickTiming === "roundStart" ? "at the start of a round" : "at the end of a round";
    const duration = `${lifetime.durationAmount} ${unit}, ${timing}`;
    return setting.consumption?.enabled
      ? `${duration}, or until ${entry.usesMaximum} use(s) are consumed, whichever happens first`
      : duration;
  }

  static async #announceApplication(sourceActor, item, setting, entry, recipient, { refreshed = false } = {}) {
    if (!recipient || !(setting.consumption?.enabled || recipient.uuid !== sourceActor.uuid)) return;
    const actorName = this.#escapeHtml(recipient.name);
    const effectName = this.#escapeHtml(setting.name);
    const itemName = this.#escapeHtml(item.name);
    const action = refreshed ? "has refreshed" : "has gained";
    const lifecycle = this.#escapeHtml(this.#lifecycleText(setting, entry));
    const uses = setting.consumption?.enabled
      ? `<p><strong>Uses remaining:</strong> ${entry.usesRemaining}/${entry.usesMaximum}.</p>` : "";
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: recipient }),
        content: `<section class="item-creator-triggered-message"><p><strong>${actorName}</strong> ${action} <strong>${effectName}</strong> from <strong>${itemName}</strong>.</p><p><strong>Lifetime:</strong> ${lifecycle}.</p>${uses}</section>`,
        flags: { [MODULE_ID]: { triggeredEffectNotice: true, noticeType: refreshed ? "refresh" : "application", sourceActorUuid: sourceActor.uuid, sourceItemId: item.id, triggerId: setting.id, recipientActorUuid: recipient.uuid } }
      });
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not post Triggered Effect application message.`, error);
    }
  }

  static async #announceConsumption(recipient, result, details = {}) {
    const actorName = this.#escapeHtml(recipient.name);
    const effectName = this.#escapeHtml(result.effectName);
    const itemName = this.#escapeHtml(result.sourceItemName);
    let resolution = "";
    if (details.mode === "afterFailure") {
      const targetLabel = details.rollType === "attackRoll" ? "AC" : "DC";
      resolution = `<p><strong>Bonus:</strong> ${this.#escapeHtml(details.formula)} = ${Number(details.bonusTotal) || 0}. `
        + `<strong>Result:</strong> ${Number(details.originalTotal) || 0} → ${Number(details.newTotal) || 0} against ${targetLabel} ${Number(details.target) || 0} — `
        + `<strong>${details.succeeded ? "success" : "still a failure"}</strong>.</p>`;
    }
    const remaining = result.removed
      ? "The effect has no uses remaining and was removed."
      : `${result.usesRemaining}/${result.usesMaximum} use(s) remain.`;
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: recipient }),
        content: `<section class="item-creator-triggered-message"><p><strong>${actorName}</strong> used <strong>${effectName}</strong> from <strong>${itemName}</strong>.</p>${resolution}<p>${remaining}</p></section>`,
        flags: { [MODULE_ID]: { triggeredEffectNotice: true, noticeType: "consumption", sourceActorUuid: result.sourceActorUuid, entryKey: result.entryKey, recipientActorUuid: recipient.uuid } }
      });
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not post Triggered Effect consumption message.`, error);
    }
  }

  static async #promptConsumableUse(actor, candidate, context = {}) {
    const DialogV2 = foundry.applications.api.DialogV2;
    const effectName = this.#escapeHtml(candidate.name);
    const actorName = this.#escapeHtml(actor.name);
    const itemName = this.#escapeHtml(candidate.sourceItemName);
    const target = Number(context.target);
    const total = Number(context.total);
    const failure = Number.isFinite(target) && Number.isFinite(total)
      ? `<p>The current result is <strong>${total}</strong> against ${context.rollType === "attackRoll" ? "AC" : "DC"} <strong>${target}</strong>.</p>`
      : "";
    const timing = candidate.timing === "afterFailure"
      ? `${failure}<p>The configured bonus will be rolled and added to this existing result. The original roll will not be repeated.</p>`
      : "<p>The managed payload will be enabled only for this native roll.</p>";
    return Boolean(await DialogV2.confirm({
      window: { title: `Use ${effectName}?`, modal: true },
      content: `<p><strong>${actorName}</strong> can use <strong>${effectName}</strong> from <strong>${itemName}</strong>.</p>${timing}<p>${candidate.usesRemaining} of ${candidate.usesMaximum} use(s) remain. Choosing No preserves the effect and all remaining uses.</p>`,
      yes: { label: "Use", icon: "fa-solid fa-dice-d20" },
      no: { label: "Keep for Later", icon: "fa-solid fa-hourglass-half" }
    }));
  }

  static async #prepareConsumableRoll(actor, rollType) {
    const candidates = this.#consumableCandidates(actor, rollType, "beforeRoll");
    if (!candidates.length) return [];
    const selections = [];
    for (const candidate of candidates) {
      const use = candidate.decision === "automatic" || await this.#promptConsumableUse(actor, candidate);
      if (!use) continue;
      selections.push({
        sourceActorUuid: candidate.sourceActorUuid,
        entryKey: candidate.entryKey,
        recipientActorUuid: candidate.recipientActorUuid,
        useKey: foundry.utils.randomID()
      });
    }
    if (!selections.length) return [];
    const response = await this.#requestAuthoritativeGM("prepareConsumableRoll", {
      recipientActorUuid: actor.uuid,
      rollType,
      timing: "beforeRoll",
      selections
    });
    return Array.isArray(response?.prepared) ? response.prepared : [];
  }

  static async #finalizeConsumableRoll(actor, rollType, prepared, completed, details = {}) {
    if (!prepared.length) return { finalized: 0, results: [] };
    return this.#requestAuthoritativeGM("finalizeConsumableRoll", {
      recipientActorUuid: actor.uuid,
      rollType,
      completed: Boolean(completed),
      details,
      prepared
    });
  }

  static #requestingUserCanOperate(actor, userId) {
    const user = game.users?.get(userId);
    if (!user || !user.active) return false;
    if (user.isGM) return true;
    try { return Boolean(actor.testUserPermission?.(user, "OWNER")); }
    catch (_error) { return false; }
  }

  static async #handlePrepareConsumableRoll(payload = {}) {
    const recipient = resolveActorDocument(payload.recipientActorUuid);
    if (!recipient || !this.#requestingUserCanOperate(recipient, payload.requestingUserId)) {
      throw new Error("The requesting user cannot operate the effect recipient.");
    }
    const rollType = String(payload.rollType ?? "");
    const timing = String(payload.timing ?? "beforeRoll");
    const prepared = [];
    for (const selection of valuesOf(payload.selections)) {
      if (selection.recipientActorUuid !== recipient.uuid || !selection.sourceActorUuid || !selection.entryKey || !selection.useKey) continue;
      const sourceActor = resolveActorDocument(selection.sourceActorUuid);
      if (!sourceActor) continue;
      const result = await this.#enqueue(sourceActor.uuid, async () => {
        const ledger = readLedger(sourceActor);
        const entry = ledger.entries.get(selection.entryKey);
        if (!entry || entry.control || entry.recipientActorUuid !== recipient.uuid || entry.stacks <= 0) return null;
        const { item, setting } = findConfig(sourceActor, entry.sourceItemId, entry.triggerId);
        if (!item || !setting?.consumption?.enabled || setting.consumption.timing !== timing
          || !consumptionEventMatches(setting.consumption.event, rollType)) return null;
        if (!itemAvailable(item, setting.availability)
          || (setting.unlockOnLevel && actorTotalLevel(sourceActor) < setting.unlockLevel)) return null;
        if (entry.usesRemaining <= 0 || entry.combatId !== currentCombatForActor(recipient)?.id) return null;
        if (consumptionIsStale(entry)) clearActiveConsumption(entry);
        if (entry.activeConsumptionKey) return null;
        entry.activeConsumptionKey = String(selection.useKey);
        entry.activeConsumptionRollType = rollType;
        entry.activeConsumptionUserId = String(payload.requestingUserId ?? "");
        entry.activeConsumptionPreparedAt = Date.now();
        await this.#syncEntryEffects(sourceActor, item, setting, entry);
        ledger.entries.set(entry.key, entry);
        await this.#writeLedger(sourceActor, ledger.entries);
        return {
          sourceActorUuid: sourceActor.uuid,
          entryKey: entry.key,
          recipientActorUuid: recipient.uuid,
          useKey: entry.activeConsumptionKey,
          timing
        };
      });
      if (result) prepared.push(result);
    }
    return { prepared };
  }

  static async #handleFinalizeConsumableRoll(payload = {}) {
    const recipient = resolveActorDocument(payload.recipientActorUuid);
    if (!recipient || !this.#requestingUserCanOperate(recipient, payload.requestingUserId)) {
      throw new Error("The requesting user cannot finalize this managed effect.");
    }
    const results = [];
    for (const prepared of valuesOf(payload.prepared)) {
      if (prepared.recipientActorUuid !== recipient.uuid || !prepared.sourceActorUuid || !prepared.entryKey || !prepared.useKey) continue;
      const sourceActor = resolveActorDocument(prepared.sourceActorUuid);
      if (!sourceActor) continue;
      const result = await this.#enqueue(sourceActor.uuid, async () => {
        const ledger = readLedger(sourceActor);
        const entry = ledger.entries.get(prepared.entryKey);
        if (!entry || entry.activeConsumptionKey !== prepared.useKey) return null;
        const { item, setting } = findConfig(sourceActor, entry.sourceItemId, entry.triggerId);
        clearActiveConsumption(entry);
        if (!item || !setting?.consumption?.enabled) {
          await this.#removeEntryEffects(entry);
          ledger.entries.delete(entry.key);
          await this.#writeLedger(sourceActor, ledger.entries);
          return { consumed: false, removed: true, usesRemaining: 0 };
        }

        let consumed = false;
        if (payload.completed && !entry.recentConsumptionKeys.includes(prepared.useKey)) {
          entry.recentConsumptionKeys.push(prepared.useKey);
          entry.recentConsumptionKeys = entry.recentConsumptionKeys.slice(-MAX_RECENT_KEYS);
          entry.usesRemaining = Math.max(0, entry.usesRemaining - 1);
          consumed = true;
        }
        const removed = entry.usesRemaining <= 0 || entry.stacks <= 0;
        if (removed) {
          await this.#removeEntryEffects(entry);
          ledger.entries.delete(entry.key);
        } else {
          await this.#syncEntryEffects(sourceActor, item, setting, entry);
          ledger.entries.set(entry.key, entry);
        }
        await this.#writeLedger(sourceActor, ledger.entries);

        const data = {
          consumed,
          removed,
          usesRemaining: Math.max(0, Number(entry.usesRemaining) || 0),
          usesMaximum: Math.max(1, Number(entry.usesMaximum) || 1),
          effectName: setting.name,
          sourceItemName: item.name,
          recipientName: recipient.name,
          sourceActorUuid: sourceActor.uuid,
          entryKey: entry.key
        };
        if (consumed) await this.#announceConsumption(recipient, data, payload.details ?? {});
        return data;
      });
      if (result) results.push(result);
    }
    return { finalized: results.length, results };
  }

  static #rollCompleted(result) {
    if (Array.isArray(result)) return result.length > 0;
    if (result instanceof Set || result instanceof Map) return result.size > 0;
    return Boolean(result);
  }

  static async #runConsumableRoll(actor, rollType, family, operation) {
    if (actor?.documentName !== "Actor" || !currentCombatForActor(actor)) return operation();
    const contextKey = `${actor.uuid}:${family}`;
    if (this.#activeRollContexts.has(contextKey)) return operation();
    this.#activeRollContexts.add(contextKey);
    let prepared = [];
    let result = null;
    try {
      try {
        prepared = await this.#prepareConsumableRoll(actor, rollType);
      } catch (error) {
        console.warn(`${MODULE_ID} | Could not prepare a consumable managed effect.`, error);
        ui.notifications?.warn?.("Item Creator could not prepare a consumable effect; the roll will continue without it.");
      }
      result = await operation();
      return result;
    } finally {
      if (prepared.length) {
        try {
          await this.#finalizeConsumableRoll(actor, rollType, prepared, this.#rollCompleted(result), { mode: "beforeRoll", rollType });
        } catch (error) {
          console.error(`${MODULE_ID} | Could not finalize a consumable managed effect.`, error);
          ui.notifications?.error?.("Item Creator could not finalize a consumable effect. The active GM should reconcile the Actor.");
        }
      }
      this.#activeRollContexts.delete(contextKey);
    }
  }

  static #onD20TestRolls(rollType, rolls, data = {}) {
    const actor = data.subject?.documentName === "Actor" ? data.subject : data.subject?.actor;
    if (!actor || !currentCombatForActor(actor)) return;
    for (const [index, roll] of valuesOf(rolls).entries()) {
      this.#scheduleAfterFailureRoll(actor, rollType, roll, {
        ability: data.ability ?? "",
        skill: data.skill ?? "",
        tool: data.tool ?? "",
        index
      });
    }
  }

  static #postFailureRollKey(actor, rollType, roll, context = {}) {
    const messageId = roll?.parent?.id ?? roll?.options?.messageId ?? "";
    return `${actor.uuid}:${rollType}:${messageId || context.index || 0}:${Number(roll?.total) || 0}:${activeD20Result(roll)}`;
  }

  static #rememberPostFailureKey(key) {
    this.#recentPostFailureKeys.push(key);
    this.#recentPostFailureKeys = this.#recentPostFailureKeys.slice(-POST_FAILURE_RECENT_LIMIT);
  }

  static #scheduleAfterFailureRoll(actor, rollType, roll, context = {}) {
    if (!rollResultIsFailure(roll, rollType)) return;
    const key = this.#postFailureRollKey(actor, rollType, roll, context);
    if (this.#pendingPostFailureKeys.has(key) || this.#recentPostFailureKeys.includes(key)) return;
    this.#pendingPostFailureKeys.add(key);
    setTimeout(() => void (async () => {
      try {
        await this.#waitForHigherPriorityAutomation({ actor, rollType, roll, ...context });
        await this.#resolveAfterFailureRoll(actor, rollType, roll, context);
      } catch (error) {
        console.error(`${MODULE_ID} | Failed to resolve a post-result consumable effect.`, error);
      } finally {
        this.#pendingPostFailureKeys.delete(key);
        this.#rememberPostFailureKey(key);
      }
    })(), POST_FAILURE_DELAY_MS);
  }

  static async #waitForHigherPriorityAutomation(context) {
    const moduleApi = game.modules?.get("dnd5e-character-builder")?.api;
    const candidates = [
      [moduleApi?.rulesAutomation, moduleApi?.rulesAutomation?.waitForRollResolution],
      [moduleApi, moduleApi?.waitForRollResolution],
      [globalThis.dnd5eCharacterBuilder, globalThis.dnd5eCharacterBuilder?.waitForRollResolution]
    ];
    for (const [owner, callback] of candidates) {
      if (!(callback instanceof Function)) continue;
      try {
        await Promise.race([
          Promise.resolve(callback.call(owner, context)),
          new Promise(resolve => setTimeout(resolve, 5000))
        ]);
      } catch (error) {
        console.warn(`${MODULE_ID} | Higher-priority roll automation did not complete cleanly.`, error);
      }
      break;
    }
    Hooks.callAll(`${MODULE_ID}.beforePostFailureConsumption`, context);
  }

  static async #resolveAfterFailureRoll(actor, rollType, roll, context = {}) {
    if (!rollResultIsFailure(roll, rollType)) return;
    const target = rollTargetNumber(roll);
    if (target === null) return;
    const candidates = this.#consumableCandidates(actor, rollType, "afterFailure");
    if (!candidates.length) return;

    let runningTotal = Number(roll.total) || 0;
    for (const candidate of candidates) {
      if (rollType === "attackRoll" && (roll?.isFumble || activeD20Result(roll) === 1)) break;
      if (runningTotal >= target) break;
      const rollContext = { ...context, rollType, activity: context.activity ?? null };
      const formula = managedBonusFormula(actor.effects, candidate.sourceActorUuid, candidate.entryKey, rollContext);
      if (!formula) {
        console.warn(`${MODULE_ID} | ${candidate.name} has no additive ${rollType} change that can be applied after a failed result.`);
        continue;
      }
      const use = candidate.decision === "automatic" || await this.#promptConsumableUse(actor, candidate, {
        rollType, total: runningTotal, target
      });
      if (!use) continue;

      const useKey = foundry.utils.randomID();
      const response = await this.#requestAuthoritativeGM("prepareConsumableRoll", {
        recipientActorUuid: actor.uuid,
        rollType,
        timing: "afterFailure",
        selections: [{
          sourceActorUuid: candidate.sourceActorUuid,
          entryKey: candidate.entryKey,
          recipientActorUuid: candidate.recipientActorUuid,
          useKey
        }]
      });
      const prepared = Array.isArray(response?.prepared) ? response.prepared : [];
      if (!prepared.length) continue;

      let bonusRoll = null;
      try {
        bonusRoll = await (new Roll(formula, actor.getRollData?.() ?? {})).evaluate();
      } catch (error) {
        await this.#finalizeConsumableRoll(actor, rollType, prepared, false);
        ui.notifications?.warn?.(`${candidate.name} could not roll its post-failure bonus.`);
        console.warn(`${MODULE_ID} | Invalid post-failure bonus formula: ${formula}`, error);
        continue;
      }
      const bonusTotal = Number(bonusRoll?.total) || 0;
      const originalTotal = runningTotal;
      runningTotal += bonusTotal;
      const succeeded = runningTotal >= target;
      await this.#finalizeConsumableRoll(actor, rollType, prepared, true, {
        mode: "afterFailure",
        formula,
        bonusTotal,
        originalTotal,
        newTotal: runningTotal,
        target,
        succeeded,
        rollType,
        originalMessageId: roll?.parent?.id ?? roll?.options?.messageId ?? ""
      });
    }
  }

  static #patchRollMethod(prototype, method, rollType, family) {
    const original = prototype?.[method];
    if (!(original instanceof Function) || original[ROLL_PATCH_FLAG]) return;
    const service = this;
    const wrapped = async function(...args) {
      const actor = this?.documentName === "Actor" ? this : this?.actor;
      return service.#runConsumableRoll(actor, rollType, family, () => original.apply(this, args));
    };
    Object.defineProperty(wrapped, ROLL_PATCH_FLAG, { value: true });
    try { Object.defineProperty(wrapped, "name", { value: original.name, configurable: true }); }
    catch (_error) { /* Cosmetic only. */ }
    try {
      prototype[method] = wrapped;
      this.#rollPatches.push({ prototype, method, original });
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not install consumable effect support for ${method}.`, error);
    }
  }

  static #installConsumableRollPatches() {
    const actorPrototype = CONFIG.Actor?.documentClass?.prototype;
    this.#patchRollMethod(actorPrototype, "rollAbilityCheck", "abilityCheck", "d20");
    this.#patchRollMethod(actorPrototype, "rollSkill", "abilityCheck", "d20");
    this.#patchRollMethod(actorPrototype, "rollToolCheck", "abilityCheck", "d20");
    this.#patchRollMethod(actorPrototype, "rollSavingThrow", "savingThrow", "d20");

    const activities = CONFIG.DND5E?.activityTypes ?? {};
    const activityEntries = activities instanceof Map ? [...activities.entries()] : Object.entries(activities);
    const attackDefinition = activities instanceof Map ? activities.get("attack") : activities.attack;
    const attackPrototype = attackDefinition?.documentClass?.prototype;
    this.#patchRollMethod(attackPrototype, "rollAttack", "attackRoll", "d20");
    for (const [type, definition] of activityEntries) {
      const prototype = definition?.documentClass?.prototype;
      const healing = type === "heal" || String(definition?.documentClass?.name ?? "").toLowerCase().includes("heal");
      this.#patchRollMethod(prototype, "rollDamage", healing ? "healingRoll" : "damageRoll", "damage");
    }
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
        if (setting.consumption?.enabled) {
          const configuredUses = Math.max(1, Number(setting.consumption.uses) || 1);
          if (entry.usesMaximum <= 0) {
            entry.usesMaximum = configuredUses;
            entry.usesRemaining = configuredUses;
            dirty = true;
          } else {
            const nextRemaining = Math.min(Math.max(0, entry.usesRemaining), configuredUses);
            if (entry.usesMaximum !== configuredUses || entry.usesRemaining !== nextRemaining) dirty = true;
            entry.usesMaximum = configuredUses;
            entry.usesRemaining = nextRemaining;
          }
          if (consumptionIsStale(entry)) {
            clearActiveConsumption(entry);
            dirty = true;
          }
        } else if (entry.usesMaximum || entry.usesRemaining || entry.activeConsumptionKey) {
          entry.usesMaximum = 0;
          entry.usesRemaining = 0;
          clearActiveConsumption(entry);
          dirty = true;
        }
        if (entry.stacks <= 0 || !entry.payloadIds.length || (setting.consumption?.enabled && entry.usesRemaining <= 0)) {
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
      this.#scheduleAfterFailureRoll(actor, "attackRoll", roll, { activity, index, messageId });
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
              const wasActive = Boolean(entry?.combatId === combat.id && entry?.stacks > 0);
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
              await this.#announceApplication(actor, item, setting, entry, group.actor, { refreshed: wasActive });
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
    const consumable = Boolean(setting.consumption?.enabled);
    if (consumable) {
      descriptors.push({
        slot: "consumption:marker",
        name: `Item Creator — ${setting.name} (${entry.usesRemaining}/${entry.usesMaximum} use(s) remaining)`,
        img: item.img || "icons/svg/aura.svg",
        changes: [],
        statuses: [],
        flags: {},
        consumptionMarker: true,
        consumptionPayload: false
      });
    }
    const directPayloads = payloads.filter(payload => payload.type !== "selectedSpellEffects");
    const directChanges = buildTriggeredEffectChanges(setting, entry.stacks, recipient, { payloads: directPayloads });
    if (directChanges.length) {
      descriptors.push({
        slot: "direct",
        name: `Item Creator — ${setting.name} (${entry.stacks} stack(s))`,
        img: item.img || "icons/svg/aura.svg",
        changes: directChanges,
        statuses: [],
        flags: {},
        consumptionMarker: false,
        consumptionPayload: consumable
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
          flags: clone(snapshot?.flags ?? {}),
          consumptionMarker: false,
          consumptionPayload: consumable
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
    const preparedBeforeRoll = Boolean(setting.consumption?.enabled
      && setting.consumption.timing === "beforeRoll" && entry.activeConsumptionKey);

    for (const descriptor of descriptors) {
      const disabled = Boolean(setting.consumption?.enabled && descriptor.consumptionPayload && !preparedBeforeRoll);
      const runtimeFlags = effectFlags(entry, descriptor.slot, setting, item, {
        marker: Boolean(descriptor.consumptionMarker),
        payload: Boolean(descriptor.consumptionPayload)
      });
      const flags = foundry.utils.mergeObject(clone(descriptor.flags ?? {}), {
        [MODULE_ID]: runtimeFlags
      }, { inplace: false, recursive: true, overwrite: true });
      const data = {
        name: descriptor.name,
        img: descriptor.img,
        origin: item.uuid,
        transfer: false,
        disabled,
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
        || current.disabled !== disabled
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
          disabled,
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
  consumptionEventMatches,
  clearActiveConsumption,
  consumptionIsStale,
  rollTargetNumber,
  rollResultIsFailure,
  changeAppliesToRoll,
  managedBonusFormula,
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
