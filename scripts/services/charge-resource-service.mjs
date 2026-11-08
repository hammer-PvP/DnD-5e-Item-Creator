import { MODULE_ID } from "../constants.mjs";

/** Item Creator resource policies are configuration only. Charge counters and
 * recovery remain native D&D5e Item/Activity Uses. */
export function defaultDepletionPolicy() {
  return { mode: "none", test: "d20", target: "1", dc: "10", skill: "arc", ability: "int", tool: "", resolution: "prompt" };
}
export function normalizeDepletionPolicy(raw = {}) {
  const base = defaultDepletionPolicy();
  const policy = { ...base, ...(raw && typeof raw === "object" ? raw : {}) };
  policy.mode = ["none", "destroy", "test"].includes(policy.mode) ? policy.mode : "none";
  // Legacy v0.8.5 policies without a resolution field keep automatic test rolling.
  policy.resolution = ["prompt", "automatic"].includes(raw?.resolution) ? raw.resolution : "automatic";
  policy.test = ["d20", "ability", "skill", "tool"].includes(policy.test) ? policy.test : "d20";
  policy.ability = ["str", "dex", "con", "int", "wis", "cha"].includes(policy.ability) ? policy.ability : "int";
  policy.skill = String(policy.skill || "arc");
  policy.tool = String(policy.tool || "");
  policy.target = String(policy.target ?? "1");
  policy.dc = String(policy.dc ?? "10");
  return policy;
}
export function defaultChargeConfig() {
  return { enabled: false, max: "10", recoveryPeriod: "dawn", recoveryFormula: "1d6 + 4", depletion: defaultDepletionPolicy() };
}
export function normalizeChargeConfig(raw = {}) {
  const defaults = defaultChargeConfig();
  const value = raw && typeof raw === "object" ? raw : {};
  const recoveryPeriod = String(value.recoveryPeriod ?? defaults.recoveryPeriod);
  return {
    ...defaults, ...value,
    enabled: value.enabled === true,
    max: String(value.max ?? defaults.max),
    recoveryPeriod,
    recoveryFormula: String(value.recoveryFormula ?? defaults.recoveryFormula),
    depletion: normalizeDepletionPolicy(value.depletion)
  };
}
export function chargeRecovery(max, period, formula) {
  if (!period || period === "none") return [];
  if (period === "recharge") return [{ period, type: "recoverAll", formula: String(formula || "6") }];
  if (String(formula ?? "").trim().toLowerCase() === "all") return [{ period, type: "recoverAll", formula: "" }];
  return [{ period, type: "formula", formula: String(formula || max || "1") }];
}
export const CHARGE_MODES = Object.freeze(["none", "shared", "separate"]);
export function inferredChargeMode(spell) {
  const mode = String(spell?.chargeMode ?? "");
  if (CHARGE_MODES.includes(mode)) return mode;
  return spell?.useLimit === "limited" ? "separate" : "none";
}
export function applySharedItemCharges(data, config, draft) {
  const normalized = normalizeChargeConfig(config);
  if (!normalized.enabled) return data;
  const maximum = Math.max(1, Math.min(999, Math.floor(Number(normalized.max) || 1)));
  data.system ??= {};
  const previousSpent = Math.max(0, Math.floor(Number(data.system.uses?.spent ?? 0) || 0));
  data.system.uses = {
    ...(data.system.uses ?? {}),
    max: String(maximum),
    spent: Math.min(maximum, previousSpent),
    recovery: chargeRecovery(maximum, normalized.recoveryPeriod, normalized.recoveryFormula),
    autoDestroy: false
  };
  data.flags ??= {};
  data.flags[MODULE_ID] ??= {};
  data.flags[MODULE_ID].chargeDepletion = normalized.depletion;
  data.flags[MODULE_ID].draft ??= {};
  data.flags[MODULE_ID].draft.chargeConfig = normalized;
  return data;
}

function sourceActivities(document) {
  const raw = document?.toObject?.()?.system?.activities ?? {};
  return Array.isArray(raw) ? raw : Object.values(raw);
}
function snapshots(document) {
  const source = document?.toObject?.() ?? {};
  const total = Number(source.system?.uses?.max ?? 0);
  const spent = Number(source.system?.uses?.spent ?? 0);
  const activities = new Map();
  for (const activity of sourceActivities(document)) {
    const id = String(activity?._id ?? "");
    if (!id) continue;
    activities.set(id, { max: Number(activity.uses?.max ?? 0), spent: Number(activity.uses?.spent ?? 0) });
  }
  return { total, spent, activities };
}
import { ItemCreatorDepletionLifecycle } from "./depletion-lifecycle-service.mjs";

const beforeUpdates = new Map();
const processing = new Set();
const isExhausted = (before, after) => before?.max > 0 && before.spent < before.max
  && after?.max > 0 && after.spent >= after.max;

export function registerChargeDepletionHooks() {
  Hooks.on("preUpdateItem", (item, _changed, _options, userId) => {
    if (userId !== game.user?.id) return;
    if (!item?.flags?.[MODULE_ID]?.chargeDepletion && !sourceActivities(item).some(activity => activity?.flags?.[MODULE_ID]?.chargeDepletion)) return;
    beforeUpdates.set(item.uuid, snapshots(item));
  });
  Hooks.on("updateItem", async (item, _changed, _options, userId) => {
    if (userId !== game.user?.id) return;
    const previous = beforeUpdates.get(item.uuid);
    beforeUpdates.delete(item.uuid);
    if (!previous || processing.has(item.uuid)) return;
    const current = snapshots(item);
    const events = [];
    if (isExhausted({max:previous.total,spent:previous.spent},{max:current.total,spent:current.spent})) {
      events.push({ policy: item.flags?.[MODULE_ID]?.chargeDepletion, label: "shared charges", activityId: null });
    }
    for (const activity of sourceActivities(item)) {
      const id = String(activity?._id ?? "");
      const prev = previous.activities.get(id);
      const now = current.activities.get(id);
      if (prev && isExhausted(prev,now)) events.push({policy: activity.flags?.[MODULE_ID]?.chargeDepletion, label: activity.name || "Activity", activityId: id});
    }
    if (!events.length) return;
    processing.add(item.uuid);
    try {
      for (const event of events) {
        await ItemCreatorDepletionLifecycle.notifyExhaustion(item, event);
      }
    } finally { processing.delete(item.uuid); }
  });
}
