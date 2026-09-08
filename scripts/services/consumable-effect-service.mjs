import { MODULE_ID } from "../constants.mjs";
import { safeDeleteActiveEffects, safeUpdateActiveEffects } from "./document-operation-service.mjs";

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
  return activity?.flags?.[MODULE_ID]?.consumableUse === true;
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

function activeBlueprints(itemOrEffects, actor) {
  const level = actorLevel(actor);
  const effects = Array.isArray(itemOrEffects) ? itemOrEffects : valuesOf(itemOrEffects?.effects);
  const candidates = effects.filter(effect => {
    const flags = effect?.flags?.[MODULE_ID] ?? {};
    if (effect?.disabled) return false;
    if (flags.consumableBlueprint !== true) return false;
    if (flags.unlockOnLevel && level < (Number(flags.unlockLevel) || 1)) return false;
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
  const durationMode = ["permanent", "shortOrLongRest", "longRest", "rounds", "turns", "minutes", "hours"].includes(source.durationMode)
    ? source.durationMode : "longRest";
  const stacking = ["replace", "refresh", "ignore", "stack"].includes(source.stacking) ? source.stacking : "replace";
  const amountRaw = String(source.removeExhaustionAmount ?? "1").trim().toLowerCase();
  return {
    ...source,
    durationMode,
    durationValue: Math.max(1, Number(source.durationValue) || 1),
    stacking,
    removeExhaustion: Boolean(source.removeExhaustion),
    removeExhaustionAmount: amountRaw === "all" ? "all" : String(Math.max(1, Number.parseInt(amountRaw, 10) || 1))
  };
}

function durationSeconds(config) {
  const value = Math.max(1, Number(config.durationValue) || 1);
  if (["rounds", "turns"].includes(config.durationMode)) return value * 6;
  if (config.durationMode === "minutes") return value * 60;
  if (config.durationMode === "hours") return value * 3600;
  return null;
}

function worldTime() {
  return Number(game.time?.worldTime) || 0;
}

function currentCombatForActor(actor) {
  const combat = game.combat;
  if (!combat?.started) return null;
  return valuesOf(combat.combatants).some(combatant => combatant?.actor?.id === actor?.id || combatant?.actorId === actor?.id)
    ? combat : null;
}

function currentCombatantActorId(combat) {
  return combat?.combatant?.actor?.id ?? combat?.combatant?.actorId ?? null;
}

function timingFlags(config, actor) {
  const now = worldTime();
  const seconds = durationSeconds(config);
  const timing = {
    consumableDurationMode: config.durationMode,
    consumableDurationValue: Math.max(1, Number(config.durationValue) || 1),
    consumableAppliedAtWorldTime: now,
    consumableExpiresAtWorldTime: seconds === null ? null : now + seconds,
    consumableCombatId: null,
    consumableCombatStartRound: null,
    consumableCombatSpan: null,
    consumableTurnsRemaining: config.durationMode === "turns" ? Math.max(1, Number(config.durationValue) || 1) : null,
    consumableLastTurnKey: null
  };
  const combat = currentCombatForActor(actor);
  if (combat && ["rounds", "turns"].includes(config.durationMode)) {
    timing.consumableCombatId = combat.id;
    timing.consumableCombatStartRound = Number(combat.round) || 0;
    if (config.durationMode === "rounds") timing.consumableCombatSpan = Math.max(1, Number(config.durationValue) || 1);
    if (config.durationMode === "turns" && currentCombatantActorId(combat) === actor.id) {
      timing.consumableLastTurnKey = `${Number(combat.round) || 0}:${Number(combat.turn) || 0}`;
    }
  }
  return timing;
}

function durationData(config) {
  const seconds = durationSeconds(config);
  if (seconds === null) return { value: null, units: "seconds" };
  return { value: seconds, units: "seconds", expiry: "turnStart" };
}

function sourceForActor(effect, item, actor, runtime, config, instanceId) {
  const source = effect.toObject instanceof Function ? effect.toObject(false) : clone(effect);
  delete source._id;
  delete source.origin;
  source.name = `${item.name} — ${String(effect.name ?? "Effect").replace(/^Item Creator\s*[—-]\s*/i, "")}`;
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
    ...timingFlags(config, actor)
  };
  return source;
}

function refreshUpdates(effects, config, actor) {
  const timing = timingFlags(config, actor);
  return effects.map(effect => ({
    _id: effect.id,
    duration: durationData(config),
    [`flags.${MODULE_ID}.consumableDurationMode`]: timing.consumableDurationMode,
    [`flags.${MODULE_ID}.consumableDurationValue`]: timing.consumableDurationValue,
    [`flags.${MODULE_ID}.consumableAppliedAtWorldTime`]: timing.consumableAppliedAtWorldTime,
    [`flags.${MODULE_ID}.consumableExpiresAtWorldTime`]: timing.consumableExpiresAtWorldTime,
    [`flags.${MODULE_ID}.consumableCombatId`]: timing.consumableCombatId,
    [`flags.${MODULE_ID}.consumableCombatStartRound`]: timing.consumableCombatStartRound,
    [`flags.${MODULE_ID}.consumableCombatSpan`]: timing.consumableCombatSpan,
    [`flags.${MODULE_ID}.consumableTurnsRemaining`]: timing.consumableTurnsRemaining,
    [`flags.${MODULE_ID}.consumableLastTurnKey`]: timing.consumableLastTurnKey
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

async function deleteApplied(actor, effects) {
  const ids = effects.map(effect => effect?.id).filter(Boolean);
  if (ids.length) await safeDeleteActiveEffects(actor, ids, { itemCreatorConsumable: true, render: true });
}

async function expireByWorldTime(now = worldTime()) {
  if (!game.user?.isGM) return;
  for (const actor of game.actors ?? []) {
    const expired = appliedEffects(actor).filter(effect => {
      const expires = Number(effectFlag(effect, "consumableExpiresAtWorldTime"));
      return Number.isFinite(expires) && expires > 0 && expires <= now;
    });
    if (expired.length) await deleteApplied(actor, expired);
  }
}

async function expireForRest(actor, result) {
  if (!actor) return;
  const restType = String(result?.type ?? result?.restType ?? "").toLowerCase();
  const isLong = restType.includes("long");
  const isShort = restType.includes("short");
  if (!isLong && !isShort) return;
  const expired = appliedEffects(actor).filter(effect => {
    const mode = effectFlag(effect, "consumableDurationMode");
    if (isLong) return mode === "shortOrLongRest" || mode === "longRest";
    return isShort && mode === "shortOrLongRest";
  });
  if (expired.length) await deleteApplied(actor, expired);
}

async function attachTimedEffectsToCombat(combat) {
  if (!combat?.started || !game.user?.isGM) return;
  const now = worldTime();
  for (const combatant of valuesOf(combat.combatants)) {
    const actor = combatant?.actor;
    if (!actor) continue;
    const effects = appliedEffects(actor).filter(effect => {
      const mode = effectFlag(effect, "consumableDurationMode");
      return ["rounds", "turns"].includes(mode) && !effectFlag(effect, "consumableCombatId");
    });
    const updates = [];
    for (const effect of effects) {
      const expires = Number(effectFlag(effect, "consumableExpiresAtWorldTime"));
      const remainingSeconds = Number.isFinite(expires) ? Math.max(0, expires - now) : 0;
      if (remainingSeconds <= 0) continue;
      const span = Math.max(1, Math.ceil(remainingSeconds / 6));
      const mode = effectFlag(effect, "consumableDurationMode");
      updates.push({
        _id: effect.id,
        [`flags.${MODULE_ID}.consumableCombatId`]: combat.id,
        [`flags.${MODULE_ID}.consumableCombatStartRound`]: Number(combat.round) || 0,
        [`flags.${MODULE_ID}.consumableCombatSpan`]: mode === "rounds" ? span : null,
        [`flags.${MODULE_ID}.consumableTurnsRemaining`]: mode === "turns" ? span : effectFlag(effect, "consumableTurnsRemaining"),
        [`flags.${MODULE_ID}.consumableLastTurnKey`]: mode === "turns" && currentCombatantActorId(combat) === actor.id
          ? `${Number(combat.round) || 0}:${Number(combat.turn) || 0}` : null
      });
    }
    if (updates.length) await safeUpdateActiveEffects(actor, updates, { itemCreatorConsumable: true, render: false });
  }
}

async function tickCombat(combat) {
  if (!combat?.started || !game.user?.isGM) return;
  await attachTimedEffectsToCombat(combat);
  const round = Number(combat.round) || 0;
  const turn = Number(combat.turn) || 0;
  const currentActorId = currentCombatantActorId(combat);

  for (const combatant of valuesOf(combat.combatants)) {
    const actor = combatant?.actor;
    if (!actor) continue;
    const effects = appliedEffects(actor).filter(effect => effectFlag(effect, "consumableCombatId") === combat.id);
    const remove = [];
    const updates = [];
    for (const effect of effects) {
      const mode = effectFlag(effect, "consumableDurationMode");
      if (mode === "rounds") {
        const startRound = Number(effectFlag(effect, "consumableCombatStartRound")) || 0;
        const span = Math.max(1, Number(effectFlag(effect, "consumableCombatSpan")) || Number(effectFlag(effect, "consumableDurationValue")) || 1);
        if (round - startRound >= span) remove.push(effect);
      } else if (mode === "turns" && currentActorId === actor.id) {
        const key = `${round}:${turn}`;
        const last = effectFlag(effect, "consumableLastTurnKey");
        if (last === key) continue;
        const remaining = Math.max(0, Number(effectFlag(effect, "consumableTurnsRemaining")) || 0) - 1;
        if (remaining <= 0) remove.push(effect);
        else updates.push({
          _id: effect.id,
          [`flags.${MODULE_ID}.consumableTurnsRemaining`]: remaining,
          [`flags.${MODULE_ID}.consumableLastTurnKey`]: key
        });
      }
    }
    if (updates.length) await safeUpdateActiveEffects(actor, updates, { itemCreatorConsumable: true, render: false });
    if (remove.length) await deleteApplied(actor, remove);
  }
}

async function detachCombatEffects(combat) {
  if (!combat || !game.user?.isGM) return;
  const now = worldTime();
  const round = Number(combat.round) || 0;
  for (const combatant of valuesOf(combat.combatants)) {
    const actor = combatant?.actor;
    if (!actor) continue;
    const effects = appliedEffects(actor).filter(effect => effectFlag(effect, "consumableCombatId") === combat.id);
    const remove = [];
    const updates = [];
    for (const effect of effects) {
      const mode = effectFlag(effect, "consumableDurationMode");
      let remaining = 0;
      if (mode === "rounds") {
        const start = Number(effectFlag(effect, "consumableCombatStartRound")) || 0;
        const span = Math.max(1, Number(effectFlag(effect, "consumableCombatSpan")) || 1);
        remaining = Math.max(0, span - Math.max(0, round - start));
      } else if (mode === "turns") {
        remaining = Math.max(0, Number(effectFlag(effect, "consumableTurnsRemaining")) || 0);
      }
      if (remaining <= 0) {
        remove.push(effect);
        continue;
      }
      updates.push({
        _id: effect.id,
        [`flags.${MODULE_ID}.consumableExpiresAtWorldTime`]: now + remaining * 6,
        [`flags.${MODULE_ID}.consumableCombatId`]: null,
        [`flags.${MODULE_ID}.consumableCombatStartRound`]: null,
        [`flags.${MODULE_ID}.consumableCombatSpan`]: null,
        [`flags.${MODULE_ID}.consumableLastTurnKey`]: null
      });
    }
    if (updates.length) await safeUpdateActiveEffects(actor, updates, { itemCreatorConsumable: true, render: false });
    if (remove.length) await deleteApplied(actor, remove);
  }
}

export class ItemCreatorConsumableEffectService {
  static #registered = false;
  static #pendingUses = new WeakMap();

  static registerHooks() {
    if (this.#registered) return;
    this.#registered = true;

    Hooks.on("dnd5e.activityConsumption", activity => {
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
          effects: valuesOf(item.effects).map(effect => effect.toObject instanceof Function ? effect.toObject(false) : clone(effect))
        });
      } catch (error) {
        console.warn(`${MODULE_ID} | Unable to snapshot Consumable before native consumption.`, error);
      }
    });
    Hooks.on("dnd5e.postUseActivity", async (activity, _usageConfig, _results) => {
      try {
        const snapshot = this.#pendingUses.get(activity) ?? null;
        this.#pendingUses.delete(activity);
        await this.applyFromActivity(activity, snapshot);
      } catch (error) { console.error(`${MODULE_ID} | Consumable use failed.`, error); }
    });
    Hooks.on("dnd5e.restCompleted", async (actor, result) => {
      try { await expireForRest(actor, result); }
      catch (error) { console.error(`${MODULE_ID} | Consumable rest cleanup failed.`, error); }
    });
    Hooks.on("updateWorldTime", async worldTimeValue => {
      try { await expireByWorldTime(Number(worldTimeValue) || worldTime()); }
      catch (error) { console.error(`${MODULE_ID} | Consumable world-time cleanup failed.`, error); }
    });
    Hooks.on("updateCombat", async combat => {
      try { await tickCombat(combat); }
      catch (error) { console.error(`${MODULE_ID} | Consumable combat duration update failed.`, error); }
    });
    Hooks.on("deleteCombat", async combat => {
      try { await detachCombatEffects(combat); }
      catch (error) { console.error(`${MODULE_ID} | Consumable combat cleanup failed.`, error); }
    });
  }

  static async applyFromActivity(activity, snapshot = null) {
    if (!isManagedUseActivity(activity)) return false;
    const liveItem = itemFromActivity(activity);
    const item = snapshot?.item ?? liveItem;
    const runtime = snapshot?.runtime ?? consumableRuntime(liveItem);
    const actor = snapshot?.actor ?? actorFromItem(liveItem);
    if (!item || !runtime || !actor) return false;

    const config = normalizeConfig(runtime);
    // Instant actions are resolved even if an existing persistent dose is set to
    // Ignore New Use. The physical consumable was used, so its instant result is real.
    await removeExhaustion(actor, config);

    const blueprints = activeBlueprints(snapshot?.effects ?? liveItem, actor);
    if (!blueprints.length) return true;

    const existing = appliedEffects(actor, runtime.key);
    if (config.stacking === "ignore" && existing.length) return true;
    if (config.stacking === "replace" && existing.length) await deleteApplied(actor, existing);
    if (config.stacking === "refresh" && existing.length) {
      await safeUpdateActiveEffects(actor, refreshUpdates(existing, config, actor), { itemCreatorConsumable: true, render: true });
      return true;
    }

    const instanceId = foundry.utils.randomID();
    const create = blueprints.map(effect => sourceForActor(effect, item, actor, runtime, config, instanceId));
    await actor.createEmbeddedDocuments("ActiveEffect", create, { itemCreatorConsumable: true, render: true });
    return true;
  }

  static async cleanupWorldTime() {
    return expireByWorldTime();
  }
}
