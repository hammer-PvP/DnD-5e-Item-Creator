import { MODULE_ID } from "../constants.mjs";

/** Item Creator resource policies are configuration only. Charge counters and
 * recovery remain native D&D5e Item/Activity Uses. */
export function defaultDepletionPolicy() {
  return { mode: "none", test: "d20", target: "1", dc: "10", skill: "arc", ability: "int", tool: "" };
}
export function normalizeDepletionPolicy(raw = {}) {
  const base = defaultDepletionPolicy();
  const policy = { ...base, ...(raw && typeof raw === "object" ? raw : {}) };
  policy.mode = ["none", "destroy", "test"].includes(policy.mode) ? policy.mode : "none";
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
const beforeUpdates = new Map();
const processing = new Set();
const isExhausted = (before, after) => before?.max > 0 && before.spent < before.max
  && after?.max > 0 && after.spent >= after.max;

async function resolveTest(item, policy) {
  const actor = item.parent?.documentName === "Actor" ? item.parent : null;
  const actorData = actor?.getRollData?.() ?? {};
  let modifier = 0;
  if (policy.test === "ability") modifier = Number(actor?.system?.abilities?.[policy.ability]?.mod ?? 0);
  else if (policy.test === "skill") {
    const skill = actor?.system?.skills?.[policy.skill];
    if (!skill) throw new Error(`Actor has no skill with ID ${policy.skill}.`);
    const computed = skill.total ?? skill.mod;
    if (!Number.isFinite(Number(computed))) throw new Error(`Skill ${policy.skill} has no numeric modifier.`);
    modifier = Number(computed);
  } else if (policy.test === "tool") {
    const tool = actor?.items?.find?.(candidate => candidate.type === "tool"
      && String(candidate.name ?? "").toLowerCase().includes(policy.tool.toLowerCase()) && policy.tool);
    if (!tool) throw new Error(`Actor does not possess ${policy.tool || "the specified tool"}.`);
    const ability = tool?.system?.ability || policy.ability || "int";
    const abilityMod = Number(actor?.system?.abilities?.[ability]?.mod ?? 0);
    const prof = Number(actor?.system?.attributes?.prof ?? 0);
    const rank = Number(tool?.system?.proficient ?? 0);
    modifier = abilityMod + prof * (Number.isFinite(rank) ? rank : 0);
  }
  const roll = await (new Roll(policy.test === "d20" ? "1d20" : `1d20 + ${modifier}`, actorData)).evaluate();
  const total = Number(roll.total ?? 0);
  const destroy = policy.test === "d20"
    ? Number(roll.dice?.[0]?.results?.[0]?.result ?? total) === Number(policy.target)
    : total < Number(policy.dc || 10);
  return { roll, destroy, total, modifier };
}
async function handleDepletion(item, policy, label) {
  const normalized = normalizeDepletionPolicy(policy);
  if (normalized.mode === "none") return;
  if (!item?.parent || !item.parent?.isOwner) {
    ui.notifications?.warn?.(`Item Creator: ${item?.name || "Item"} depletion requires an owned Actor Item; GM review required.`);
    return;
  }
  let destroy = normalized.mode === "destroy";
  let result;
  if (normalized.mode === "test") {
    try {
      result = await resolveTest(item, normalized);
      destroy = result.destroy;
    } catch (error) {
      console.error(`${MODULE_ID} | Depletion test failed; item was NOT deleted.`, error);
      ui.notifications?.warn?.("Item Creator: depletion test could not be rolled. Item preserved for GM review.");
      return;
    }
  }
  const escaped = foundry.utils.escapeHTML;
  if (result?.roll?.toMessage) await result.roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: item.parent }),
    flavor: `${item.name}: ${label} depletion test`
  });
  const text = `<p><strong>${escaped(String(item.name))}</strong> — ${escaped(label)} exhausted.</p>`
    + (result ? `<p>Depletion test: ${escaped(normalized.test)} (${escaped(String(result.total))}).</p>` : "")
    + `<p><strong>${destroy ? "Item destroyed" : "Item preserved"}</strong></p>`;
  await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor: item.parent }), content: text });
  if (!destroy) return;
  // Validate again: a concurrent recovery or transfer must never delete an item.
  if (!item.parent || !item.parent.isOwner) return;
  await item.parent.deleteEmbeddedDocuments("Item", [item.id]);
}

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
      events.push({ policy: item.flags?.[MODULE_ID]?.chargeDepletion, label: "shared charges" });
    }
    for (const activity of sourceActivities(item)) {
      const id = String(activity?._id ?? "");
      const prev = previous.activities.get(id);
      const now = current.activities.get(id);
      if (prev && isExhausted(prev,now)) events.push({policy: activity.flags?.[MODULE_ID]?.chargeDepletion, label: activity.name || "Activity"});
    }
    if (!events.length) return;
    processing.add(item.uuid);
    try {
      for (const event of events) {
        await handleDepletion(item,event.policy,event.label);
        if (!item.parent || !item.parent.items?.get(item.id)) break;
      }
    } finally { processing.delete(item.uuid); }
  });
}
