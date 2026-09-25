import { MODULE_ID } from "../constants.mjs";
import { safeDeleteActiveEffects, safeUpdateActiveEffects } from "./document-operation-service.mjs";
import { normalizeEffectChanges } from "../utils/effect-change-types.mjs";
import { TIMING_MODELS, legacyDurationToTiming, normalizeTimingModel, normalizeWorldTimeUnit, worldTimeDurationSeconds } from "../utils/timing-model.mjs";

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

function actorLevel(actor) {
  const direct = Number(actor?.system?.details?.level);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  return valuesOf(actor?.items)
    .filter(item => item?.type === "class")
    .reduce((total, item) => total + (Number(item.system?.levels) || 0), 0);
}

function itemFromActivity(activity) {
  const parent = activity?.item ?? activity?.parent ?? activity?.document?.parent;
  return parent?.documentName === "Item" || parent?.constructor?.documentName === "Item" ? parent : null;
}

function actorFromItem(item) {
  const parent = item?.actor ?? item?.parent;
  return parent?.documentName === "Actor" || parent?.constructor?.documentName === "Actor" ? parent : null;
}

function consumableRuntime(item) {
  if (item?.type !== "consumable") return null;
  const root = item.flags?.[MODULE_ID];
  const runtime = root?.runtime?.consumable;
  if (!root?.created || root?.itemType !== "consumable" || !runtime?.key) return null;
  return runtime;
}

function isManagedUseActivity(activity) {
  if (activity?.flags?.[MODULE_ID]?.consumableUse === true) return true;
  return valuesOf(activity?.consumption?.targets).some(target => target?.type === "itemUses");
}

function effectFlag(effect, key) {
  return effect?.flags?.[MODULE_ID]?.[key];
}

function appliedEffects(actor, sourceKey = null) {
  return valuesOf(actor?.effects).filter(effect => {
    if (effectFlag(effect, "consumableApplied") !== true) return false;
    return !sourceKey || effectFlag(effect, "consumableSourceKey") === sourceKey;
  });
}

function activityComposerId(activity) {
  return String(activity?.flags?.[MODULE_ID]?.composerId ?? activity?.flags?.[MODULE_ID]?.importedSourceId ?? activity?.id ?? activity?._id ?? "");
}

function effectRuntimeConfig(effect, runtime) {
  const override = effectFlag(effect, "consumableEffect") ?? {};
  return normalizeConfig({ config: { ...(runtime?.config ?? {}), ...(override ?? {}) } });
}

function blueprintIdentity(effect) {
  const flags = effect?.flags?.[MODULE_ID] ?? {};
  return String(flags.key ?? flags.importedSourceId ?? effect?.name ?? "effect");
}

function activeBlueprints(itemOrEffects, actor, activity = null) {
  const level = actorLevel(actor);
  const composerId = activityComposerId(activity);
  const effects = Array.isArray(itemOrEffects) ? itemOrEffects : valuesOf(itemOrEffects?.effects);
  const candidates = effects.filter(effect => {
    const flags = effect?.flags?.[MODULE_ID] ?? {};
    if (effect?.disabled) return false;
    if (flags.consumableBlueprint !== true) return false;
    if (flags.unlockOnLevel && level < (Number(flags.unlockLevel) || 1)) return false;
    const binding = flags.consumableEffect?.activityIds;
    if (Array.isArray(binding) && binding.length && !binding.includes("all") && (!composerId || !binding.includes(composerId))) return false;
    return true;
  });

  // Progression tiers share a group. Only the highest eligible tier in each
  // group may be active; independent/imported effects all remain eligible.
  const grouped = new Map();
  const independent = [];
  for (const effect of candidates) {
    const flags = effect.flags?.[MODULE_ID] ?? {};
    const group = flags.progressionGroupId;
    if (!group) {
      independent.push(effect);
      continue;
    }
    const current = grouped.get(group);
    const order = Number(flags.progressionTierOrder) || 0;
    const currentOrder = Number(current?.flags?.[MODULE_ID]?.progressionTierOrder) || 0;
    if (!current || order >= currentOrder) grouped.set(group, effect);
  }
  return [...independent, ...grouped.values()];
}

function normalizeConfig(runtime) {
  const source = runtime?.config ?? {};
  const legacy = legacyDurationToTiming({
    durationMode: source.durationMode,
    durationValue: source.durationValue
  });
  const timingSource = source.timing && typeof source.timing === "object" ? source.timing : legacy;
  let model = normalizeTimingModel(timingSource.model, legacy.model);
  if (![TIMING_MODELS.PERSISTENT, TIMING_MODELS.WORLD_TIME, TIMING_MODELS.REST].includes(model)) model = legacy.model;
  const timing = {
    model,
    amount: Math.max(1, Number(timingSource.amount) || 1),
    unit: normalizeWorldTimeUnit(timingSource.unit),
    rest: timingSource.rest === "shortOrLongRest" ? "shortOrLongRest" : "longRest"
  };
  const stacking = ["replace", "refresh", "ignore", "stack"].includes(source.stacking) ? source.stacking : "replace";
  const amountRaw = String(source.removeExhaustionAmount ?? "1").trim().toLowerCase();
  const result = {
    ...source,
    timing,
    stacking,
    removeExhaustion: Boolean(source.removeExhaustion),
    removeExhaustionAmount: amountRaw === "all" ? "all" : String(Math.max(1, Number.parseInt(amountRaw, 10) || 1))
  };
  delete result.durationMode;
  delete result.durationValue;
  return result;
}

function worldTime() {
  return Number(game.time?.worldTime) || 0;
}

/**
 * Build a Foundry V14 / D&D5e 6.x native ActiveEffect duration.
 * Timing Model v1 makes the authority explicit: Persistent has no expiry,
 * Rest/Calendar delegates to D&D5e expiry events, and World Time is expressed
 * as native seconds so it advances identically inside and outside Combat.
 */
function durationData(config) {
  const timing = config.timing ?? {};
  if (timing.model === TIMING_MODELS.PERSISTENT) {
    return { value: null, units: "seconds", expiry: null, expired: false };
  }
  if (timing.model === TIMING_MODELS.REST) {
    return {
      value: null,
      units: "seconds",
      expiry: timing.rest === "shortOrLongRest" ? "shortRest" : "longRest",
      expired: false
    };
  }
  return {
    value: worldTimeDurationSeconds(timing.amount, timing.unit),
    units: "seconds",
    expiry: null,
    expired: false
  };
}

function nativeEffectStart() {
  try {
    // Explicit null keeps the refresh anchored to world time rather than tying
    // the Effect's lifetime to whichever Combat happens to be active.
    return ActiveEffect.implementation?.getEffectStart?.(null) ?? { time: worldTime() };
  } catch (_error) {
    return { time: worldTime() };
  }
}

function timingFlags(config) {
  const timing = config.timing ?? {};
  return {
    consumableTimingModel: timing.model,
    consumableTimingAmount: Math.max(1, Number(timing.amount) || 1),
    consumableTimingUnit: normalizeWorldTimeUnit(timing.unit),
    consumableTimingRest: timing.rest === "shortOrLongRest" ? "shortOrLongRest" : "longRest",
    consumableAppliedAtWorldTime: worldTime()
  };
}

function replaceSpellLevelTokens(value, level) {
  if (typeof value !== "string") return value;
  const numeric = String(Math.clamp(Math.trunc(Number(level) || 0), 0, 9));
  return value.replace(/@item\.level\b/g, numeric).replace(/@spell\.level\b/g, numeric);
}

function applySpellLevelContext(source, effect) {
  const level = effectFlag(effect, "consumableSpellEffect")?.spellLevel;
  if (level === null || level === undefined) return source;
  const changes = valuesOf(source?.system?.changes);
  for (const change of changes) if (change && "value" in change) change.value = replaceSpellLevelTokens(change.value, level);
  return source;
}

function activityTargetType(activity) {
  return String(activity?.target?.affects?.type ?? "").trim();
}

function targetDescriptors(activity, snapshot, results) {
  const fromResults = results?.message?.system?.targets ?? results?.message?.data?.system?.targets;
  if (Array.isArray(fromResults) && fromResults.length) return fromResults;
  if (Array.isArray(snapshot?.targets) && snapshot.targets.length) return snapshot.targets;
  try {
    const fromActivity = activity?.messageFlags?.targets;
    if (Array.isArray(fromActivity)) return fromActivity;
  } catch (_error) { /* fall through */ }
  return [];
}

async function effectRecipients(activity, owner, snapshot, results) {
  const targetType = activityTargetType(activity);
  if (targetType === "self") return [owner];

  const descriptors = targetDescriptors(activity, snapshot, results);
  const actors = [];
  const seen = new Set();
  for (const descriptor of descriptors) {
    const actorUuid = String(descriptor?.actor ?? "").trim();
    const tokenUuid = String(descriptor?.token ?? "").trim();
    const identity = actorUuid || tokenUuid;
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    try {
      const document = await fromUuid(actorUuid || tokenUuid);
      const actor = document?.documentName === "Actor" ? document : document?.actor;
      if (actor && !actors.some(entry => entry.uuid === actor.uuid)) actors.push(actor);
    } catch (_error) { /* Invalid or stale target: skip safely. */ }
  }
  if (actors.length) return actors;

  // A plain no-target Utility-style Activity is owner-facing. Imported area
  // Activities with a template but no resolved targets must not silently fall
  // back to the owner, because that would apply an effect to the wrong Actor.
  const templateType = String(activity?.target?.template?.type ?? "").trim();
  if (!targetType && !templateType) return [owner];
  return [];
}

function sourceForActor(effect, item, actor, runtime, config, instanceId) {
  const source = effect.toObject instanceof Function ? effect.toObject(false) : clone(effect);
  delete source._id;
  delete source.origin;
  source.system ??= {};
  source.system.changes = normalizeEffectChanges(source.system?.changes ?? source.changes ?? []);
  delete source.changes;
  source.name = `${item.name} — ${String(effect.name ?? "Effect").replace(/^Item Creator\s*[—-]\s*/i, "")}`;
  applySpellLevelContext(source, effect);
  source.img = effect.img || item.img;
  source.disabled = false;
  source.transfer = false;
  source.duration = durationData(config);
  source.flags ??= {};
  source.flags[MODULE_ID] = {
    ...(source.flags[MODULE_ID] ?? {}),
    blueprint: false,
    consumableBlueprint: false,
    consumableApplied: true,
    consumableSourceKey: runtime.key,
    consumableSourceItemName: item.name,
    consumableSourceItemUuid: item.uuid,
    consumableInstanceId: instanceId,
    consumableBlueprintId: blueprintIdentity(effect),
    ...timingFlags(config)
  };
  source.start = nativeEffectStart();
  return source;
}

function refreshUpdates(effects, config, _actor) {
  const timing = timingFlags(config);
  const start = nativeEffectStart();
  return effects.map(effect => ({
    _id: effect.id,
    duration: durationData(config),
    start,
    [`flags.${MODULE_ID}.consumableTimingModel`]: timing.consumableTimingModel,
    [`flags.${MODULE_ID}.consumableTimingAmount`]: timing.consumableTimingAmount,
    [`flags.${MODULE_ID}.consumableTimingUnit`]: timing.consumableTimingUnit,
    [`flags.${MODULE_ID}.consumableTimingRest`]: timing.consumableTimingRest,
    [`flags.${MODULE_ID}.consumableAppliedAtWorldTime`]: timing.consumableAppliedAtWorldTime,
    // Clear pre-Timing-Model and obsolete parallel-clock state when refreshed.
    [`flags.${MODULE_ID}.-=consumableDurationMode`]: null,
    [`flags.${MODULE_ID}.-=consumableDurationValue`]: null,
    [`flags.${MODULE_ID}.-=consumableExpiresAtWorldTime`]: null,
    [`flags.${MODULE_ID}.-=consumableCombatId`]: null,
    [`flags.${MODULE_ID}.-=consumableCombatStartRound`]: null,
    [`flags.${MODULE_ID}.-=consumableCombatSpan`]: null,
    [`flags.${MODULE_ID}.-=consumableTurnsRemaining`]: null,
    [`flags.${MODULE_ID}.-=consumableLastTurnKey`]: null
  }));
}

async function removeExhaustion(actor, config) {
  if (!config.removeExhaustion) return;
  const current = Math.max(0, Number(actor.system?.attributes?.exhaustion) || 0);
  const next = config.removeExhaustionAmount === "all"
    ? 0
    : Math.max(0, current - Math.max(1, Number.parseInt(config.removeExhaustionAmount, 10) || 1));
  if (next === current) return;
  await actor.update({ "system.attributes.exhaustion": next }, { itemCreatorConsumable: true, render: true });
}

async function removeActorStatus(actor, statusId) {
  if (!actor || !statusId) return;
  if (actor.toggleStatusEffect instanceof Function) {
    try { await actor.toggleStatusEffect(statusId, { active: false }); return; } catch (_error) { /* fallback below */ }
  }
  const matches = valuesOf(actor.effects).filter(effect => {
    const statuses = effect?.statuses instanceof Set ? [...effect.statuses] : valuesOf(effect?.statuses);
    return statuses.includes(statusId);
  });
  const ids = matches.map(effect => effect?.id).filter(Boolean);
  if (ids.length) await safeDeleteActiveEffects(actor, ids, { itemCreatorConsumable: true, render: true });
}

async function applyActorStateChanges(actor, config) {
  const entries = Array.isArray(config?.entries) ? config.entries : [];
  for (const entry of entries) {
    if (entry?.type === "removeExhaustion") {
      const amountRaw = String(entry.amount ?? "1").trim().toLowerCase();
      const current = Math.max(0, Number(actor.system?.attributes?.exhaustion) || 0);
      const next = amountRaw === "all" ? 0 : Math.max(0, current - Math.max(1, Number.parseInt(amountRaw, 10) || 1));
      if (next !== current) await actor.update({ "system.attributes.exhaustion": next }, { itemCreatorConsumable: true, render: true });
      continue;
    }
    if (entry?.type === "removeStatus") {
      const status = String(entry.status ?? "").trim();
      if (!status) continue;
      if (status === "all") {
        const ids = new Set();
        for (const effect of valuesOf(CONFIG.statusEffects)) if (effect?.id) ids.add(effect.id);
        for (const id of Object.keys(CONFIG.DND5E.conditionTypes ?? {})) ids.add(id);
        for (const id of ids) await removeActorStatus(actor, id);
      } else await removeActorStatus(actor, status);
    }
  }
}

async function deleteApplied(actor, effects) {
  const ids = effects.map(effect => effect?.id).filter(Boolean);
  if (ids.length) await safeDeleteActiveEffects(actor, ids, { itemCreatorConsumable: true, render: true });
}

// Duration expiry is intentionally delegated to Foundry V14 / D&D5e 6.x's
// ActiveEffectRegistry. Item Creator no longer owns updateWorldTime, Rest, or
// Combat duration hooks for Consumable Granted Effects.


export class ItemCreatorConsumableEffectService {
  static #registered = false;
  static #pendingUses = new WeakMap();

  static registerHooks() {
    if (this.#registered) return;
    this.#registered = true;

    Hooks.on("dnd5e.activityConsumption", (activity, _usageConfig, messageConfig) => {
      try {
        if (!isManagedUseActivity(activity)) return;
        const item = itemFromActivity(activity);
        const runtime = consumableRuntime(item);
        const actor = actorFromItem(item);
        if (!item || !runtime || !actor) return;
        this.#pendingUses.set(activity, {
          actor,
          runtime: clone(runtime),
          item: { name: item.name, img: item.img, uuid: item.uuid },
          effects: valuesOf(item.effects).map(effect => effect.toObject instanceof Function ? effect.toObject(false) : clone(effect)),
          activityComposerId: activityComposerId(activity),
          targets: clone(messageConfig?.data?.system?.targets ?? []),
          actorStateChanges: clone(activity?.flags?.[MODULE_ID]?.actorStateChanges ?? null)
        });
      } catch (error) {
        console.warn(`${MODULE_ID} | Unable to snapshot Consumable before native consumption.`, error);
      }
    });
    Hooks.on("dnd5e.postUseActivity", async (activity, _usageConfig, results) => {
      try {
        const snapshot = this.#pendingUses.get(activity) ?? null;
        this.#pendingUses.delete(activity);
        await this.applyFromActivity(activity, snapshot, results);
      } catch (error) { console.error(`${MODULE_ID} | Consumable use failed.`, error); }
    });
  }

  static async applyFromActivity(activity, snapshot = null, results = null) {
    if (!isManagedUseActivity(activity)) return false;
    const liveItem = itemFromActivity(activity);
    const item = snapshot?.item ?? liveItem;
    const runtime = snapshot?.runtime ?? consumableRuntime(liveItem);
    const actor = snapshot?.actor ?? actorFromItem(liveItem);
    if (!item || !runtime || !actor) return false;

    const config = normalizeConfig(runtime);
    const recipients = await effectRecipients(activity, actor, snapshot, results);
    // Legacy instant state change remains supported for 0.7.7a Items and is
    // intentionally owner-only. Activity-bound state changes follow the
    // Activity's resolved targets, including multi-target uses.
    await removeExhaustion(actor, config);
    const activityState = snapshot?.actorStateChanges ?? activity?.flags?.[MODULE_ID]?.actorStateChanges ?? null;
    if (activityState) for (const recipient of recipients) await applyActorStateChanges(recipient, activityState);

    const bindingActivity = activityComposerId(activity) ? activity : snapshot?.activityComposerId
      ? { flags: { [MODULE_ID]: { composerId: snapshot.activityComposerId } } } : activity;
    if (!recipients.length) return true;

    for (const recipient of recipients) {
      const blueprints = activeBlueprints(snapshot?.effects ?? liveItem, recipient, bindingActivity);
      for (const blueprint of blueprints) {
        const effectConfig = effectRuntimeConfig(blueprint, runtime);
        const identity = blueprintIdentity(blueprint);
        const existing = appliedEffects(recipient, runtime.key).filter(effect => String(effectFlag(effect, "consumableBlueprintId") ?? blueprintIdentity(effect)) === identity);
        if (effectConfig.stacking === "ignore" && existing.length) continue;
        if (effectConfig.stacking === "replace" && existing.length) await deleteApplied(recipient, existing);
        if (effectConfig.stacking === "refresh" && existing.length) {
          await safeUpdateActiveEffects(recipient, refreshUpdates(existing, effectConfig, recipient), { itemCreatorConsumable: true, render: true });
          continue;
        }
        const instanceId = foundry.utils.randomID();
        const source = sourceForActor(blueprint, item, recipient, runtime, effectConfig, instanceId);
        await recipient.createEmbeddedDocuments("ActiveEffect", [source], { itemCreatorConsumable: true, render: true });
      }
    }
    return true;
  }

  static async cleanupWorldTime() {
    // Backward-compatible diagnostic entry point. Native Foundry/D&D5e expiry
    // now owns cleanup, so this only asks the registry to refresh world-time durations.
    return ActiveEffect.implementation?.registry?.refresh?.("updateWorldTime");
  }
}
