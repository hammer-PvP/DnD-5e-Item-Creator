import { MODULE_ID } from "../constants.mjs";
import { featureUseTarget, findResourceFeature, getResourceDefinition } from "./resource-modification-registry.mjs";

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

function restoreConfig(activity) {
  return activity?.flags?.[MODULE_ID]?.restoreResource ?? activity?._source?.flags?.[MODULE_ID]?.restoreResource ?? null;
}

function positiveInteger(value) {
  const number = Math.floor(Number(value) || 0);
  return Math.max(0, number);
}

async function recoveryAmount(entry, actor) {
  if (entry?.amountMode === "all") return Number.POSITIVE_INFINITY;
  if (entry?.amountMode === "formula") {
    const formula = String(entry?.amount ?? "").trim();
    if (!formula) return 0;
    try {
      const roll = new Roll(formula, actor?.getRollData?.() ?? {});
      await roll.evaluate();
      return positiveInteger(roll.total);
    } catch (error) {
      console.warn(`${MODULE_ID} | Restore Resource formula failed.`, { formula, actor: actor?.name, error });
      ui.notifications.warn(`Restore Resource formula could not be evaluated: ${formula}`);
      return 0;
    }
  }
  return positiveInteger(entry?.amount ?? 1);
}

function denomination(value) {
  const match = String(value ?? "").toLowerCase().match(/d?(\d+)/);
  return match ? Number(match[1]) : 0;
}

async function restoreSpellSlot(actor, entry, amount, pact = false) {
  const key = pact ? "pact" : `spell${Math.min(9, Math.max(1, Math.trunc(Number(entry?.spellLevel) || 1)))}`;
  const slot = actor.system?.spells?.[key];
  if (!slot) return { restored: 0, label: pact ? "Pact Magic" : `Level ${entry?.spellLevel || 1} Spell Slot`, missing: true };
  const current = Math.max(0, Number(slot.value) || 0);
  const max = Math.max(0, Number(slot.max) || 0);
  const desired = amount === Number.POSITIVE_INFINITY ? max : Math.min(max, current + amount);
  const restored = Math.max(0, desired - current);
  if (restored > 0) {
    await actor.update({ [`system.spells.${key}.value`]: desired }, { itemCreatorRestoreResource: true, render: true });
  }
  return { restored, label: pact ? "Pact Magic" : `Level ${entry?.spellLevel || 1} Spell Slot` };
}

async function restoreFeature(actor, entry, amount) {
  const definition = getResourceDefinition(entry?.resourceId);
  const feature = findResourceFeature(actor, definition);
  if (!definition || !feature) return { restored: 0, label: definition?.label ?? entry?.resourceId ?? "Resource", missing: true };
  const target = featureUseTarget(feature);
  if (!target?.path?.endsWith(".max")) return { restored: 0, label: definition.label, missing: true };
  const spentPath = `${target.path.slice(0, -4)}.spent`;
  const spent = Math.max(0, Number(foundry.utils.getProperty(feature, spentPath)) || 0);
  const restored = amount === Number.POSITIVE_INFINITY ? spent : Math.min(spent, amount);
  if (restored > 0) {
    await feature.update({ [spentPath]: spent - restored }, { itemCreatorRestoreResource: true, render: true });
  }
  return { restored, label: definition.label };
}

async function restoreHitDice(actor, entry, amount) {
  const wanted = String(entry?.hitDie ?? "any");
  const wantedFaces = wanted === "any" ? 0 : denomination(wanted);
  const classes = [...(actor.items ?? [])].filter(item => item.type === "class")
    .map(item => ({
      item,
      faces: denomination(item.system?.hd?.denomination),
      spent: Math.max(0, Number(item.system?.hd?.spent) || 0)
    }))
    .filter(row => row.spent > 0 && (!wantedFaces || row.faces === wantedFaces))
    .sort((a, b) => b.spent - a.spent || b.faces - a.faces);
  if (!classes.length) return { restored: 0, label: wanted === "any" ? "Hit Dice" : `${wanted} Hit Dice`, missing: true };

  let remaining = amount;
  let restored = 0;
  for (const row of classes) {
    if (remaining <= 0) break;
    const take = amount === Number.POSITIVE_INFINITY ? row.spent : Math.min(row.spent, remaining);
    if (take <= 0) continue;
    await row.item.update({ "system.hd.spent": row.spent - take }, { itemCreatorRestoreResource: true, render: true });
    restored += take;
    if (amount !== Number.POSITIVE_INFINITY) remaining -= take;
  }
  return { restored, label: wanted === "any" ? "Hit Dice" : `${wanted} Hit Dice` };
}

export class ItemCreatorRestoreResourceService {
  static registerHooks() {
    Hooks.on("dnd5e.postUseActivity", async (activity, _usageConfig, _results) => {
      const config = restoreConfig(activity);
      if (!config?.entries?.length) return;
      const actor = activity?.actor ?? activity?.item?.actor;
      if (!actor) return;

      const outcomes = [];
      for (const entry of config.entries) {
        const amount = await recoveryAmount(entry, actor);
        if (!(amount > 0) && amount !== Number.POSITIVE_INFINITY) continue;
        let outcome;
        switch (entry.kind) {
          case "spellSlot": outcome = await restoreSpellSlot(actor, entry, amount, false); break;
          case "pactSlot": outcome = await restoreSpellSlot(actor, entry, amount, true); break;
          case "hitDice": outcome = await restoreHitDice(actor, entry, amount); break;
          case "feature": outcome = await restoreFeature(actor, entry, amount); break;
          default: continue;
        }
        outcomes.push(outcome);
      }

      const restored = outcomes.filter(row => row?.restored > 0);
      if (restored.length) {
        ui.notifications.info(restored.map(row => `${row.label}: +${row.restored}`).join(" · "));
      } else if (outcomes.some(row => row?.missing)) {
        ui.notifications.warn("Restore Resource could not find an eligible resource on this Actor.");
      } else if (outcomes.length) {
        ui.notifications.info("The selected resource is already fully recovered.");
      }
    });
  }
}
