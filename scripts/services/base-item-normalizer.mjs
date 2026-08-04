import { MODULE_ID } from "../constants.mjs";

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

function sourceObject(document) {
  if (!document) return {};
  if (document._source && typeof document._source === "object") return clone(document._source);
  if (document.toObject instanceof Function) {
    try { return clone(document.toObject(false)); } catch (_error) { /* fall through */ }
    try { return clone(document.toObject()); } catch (_error) { /* fall through */ }
  }
  return clone(document);
}

function effectChanges(effect) {
  return valuesOf(effect?.system?.changes ?? effect?.changes);
}

function activityEffects(activity) {
  return valuesOf(activity?.effects).map(entry => entry?._id ?? entry?.id).filter(Boolean);
}

function modeToken(mode) {
  const text = String(mode ?? "").trim().toLowerCase();
  if (["add", "multiply", "override", "upgrade", "downgrade", "custom"].includes(text)) return text;
  const numeric = Number(mode);
  if (numeric === Number(CONST.ACTIVE_EFFECT_MODES.ADD)) return "add";
  if (numeric === Number(CONST.ACTIVE_EFFECT_MODES.MULTIPLY)) return "multiply";
  if (numeric === Number(CONST.ACTIVE_EFFECT_MODES.OVERRIDE)) return "override";
  if (numeric === Number(CONST.ACTIVE_EFFECT_MODES.UPGRADE)) return "upgrade";
  if (numeric === Number(CONST.ACTIVE_EFFECT_MODES.DOWNGRADE)) return "downgrade";
  if (numeric === Number(CONST.ACTIVE_EFFECT_MODES.CUSTOM)) return "custom";
  return "add";
}

function modeName(mode) {
  const token = modeToken(mode);
  if (token === "upgrade") return "minimum";
  if (token === "override") return "fixed";
  return "add";
}

function availabilityFor(item, effect) {
  const configured = effect?.flags?.[MODULE_ID]?.availability;
  if (["owned", "equipped", "equippedAttuned"].includes(configured)) return configured;
  const attunement = String(item?.system?.attunement ?? "").trim();
  if (attunement && attunement !== "none") return "equippedAttuned";
  return ["weapon", "equipment", "tool"].includes(item?.type) ? "equipped" : "owned";
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isProficiencyBonusFormula(value) {
  return String(value ?? "")
    .trim()
    .replace(/[()\s]/g, "") === "@prof";
}

function collectionValues(value) {
  if (value instanceof Set || Array.isArray(value)) return [...value].map(String).filter(Boolean);
  if (value && typeof value === "object") return Object.entries(value).filter(([, enabled]) => Boolean(enabled)).map(([key]) => key);
  const text = String(value ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try { return collectionValues(JSON.parse(text)); } catch (_error) { /* use text below */ }
  }
  return text.split(/[,;|]/).map(entry => entry.trim()).filter(Boolean);
}

function effectRow(values = {}) {
  return { id: foundry.utils.randomID(), ...values };
}

function labelForAbility(key) {
  const entry = CONFIG.DND5E.abilities?.[key];
  const label = typeof entry === "string" ? entry : entry?.label;
  return label ? game.i18n.localize(label) : key.toUpperCase();
}

function labelForSkill(key) {
  const entry = CONFIG.DND5E.skills?.[key];
  const label = typeof entry === "string" ? entry : entry?.label;
  return label ? game.i18n.localize(label) : key;
}

function modifier(value) {
  const number = Number(value) || 0;
  return number >= 0 ? `+${number}` : String(number);
}

function importedCustomEffect(effect, remainingChanges) {
  const data = sourceObject(effect);
  data.system ??= {};
  data.system.changes = clone(remainingChanges);
  delete data._id;
  delete data.origin;
  const name = effect?.name || "Imported Active Effect";
  return {
    id: foundry.utils.randomID(),
    sourceId: effect?.id ?? effect?._id ?? null,
    name,
    img: effect?.img || "systems/dnd5e/icons/svg/documents/active-effect.svg",
    included: true,
    disabled: Boolean(effect?.disabled),
    summary: `${remainingChanges.length} custom change${remainingChanges.length === 1 ? "" : "s"}`,
    data
  };
}

function importedCustomActivity(activity) {
  const data = sourceObject(activity);
  delete data._id;
  const name = activity?.name || activity?.type || "Imported Activity";
  return {
    id: foundry.utils.randomID(),
    sourceId: activity?.id ?? activity?._id ?? null,
    name,
    type: activity?.type || "utility",
    img: activity?.img || "systems/dnd5e/icons/svg/activity/utility.svg",
    included: true,
    disabled: false,
    summary: `${String(activity?.type || "utility")} Activity`,
    data
  };
}

function recognizeEffects(item, protectedEffectIds = new Set(), ignoreEffectIds = new Set(), blockedKeys = new Set()) {
  const enabled = {};
  const values = {};
  const managedEffectIds = [];
  const customEffects = [];
  const summaries = [];

  const setScalar = (key, data, summary) => {
    if (blockedKeys.has(key) || enabled[key]) return false;
    enabled[key] = true;
    values[key] = data;
    summaries.push(summary);
    return true;
  };

  const appendRows = (key, rows, availability, summary) => {
    if (!rows.length) return false;
    enabled[key] = true;
    values[key] ??= { entries: [], availability };
    values[key].entries ??= [];
    values[key].entries.push(...rows);
    values[key].availability ??= availability;
    summaries.push(summary);
    return true;
  };

  for (const effect of valuesOf(item?.effects)) {
    const effectId = effect?.id ?? effect?._id;
    if (ignoreEffectIds.has(effectId)) continue;
    if (effectId) managedEffectIds.push(effectId);
    const changes = effectChanges(effect);
    if (!changes.length) continue;

    if (protectedEffectIds.has(effectId)) {
      customEffects.push(importedCustomEffect(effect, changes));
      continue;
    }

    const availability = availabilityFor(item, effect);
    const consumed = new Set();
    const use = (...indices) => indices.forEach(index => consumed.add(index));
    const keyAt = key => changes.findIndex((change, index) => !consumed.has(index) && change?.key === key);
    const pair = (left, right, targetKey, label) => {
      const a = keyAt(left);
      const b = keyAt(right);
      if (a < 0 || b < 0) return;
      const av = numeric(changes[a].value);
      const bv = numeric(changes[b].value);
      if (av === null || bv === null || av !== bv || modeToken(changes[a].mode ?? changes[a].type) !== modeToken(changes[b].mode ?? changes[b].type)) return;
      if (setScalar(targetKey, { bonus: av, availability }, `${label}: ${modifier(av)}`)) use(a, b);
    };

    pair("system.bonuses.mwak.attack", "system.bonuses.rwak.attack", "weaponAttackBonus", "Weapon Attack Roll Bonus");
    pair("system.bonuses.mwak.damage", "system.bonuses.rwak.damage", "weaponDamageBonus", "Weapon Damage Roll Bonus");
    pair("system.bonuses.msak.attack", "system.bonuses.rsak.attack", "spellAttackBonus", "Spell Attack Bonus");

    const critical = changes.map((change, index) => ({ change, index }))
      .filter(({ index }) => !consumed.has(index))
      .filter(({ change }) => ["flags.dnd5e.weaponCriticalThreshold", "flags.dnd5e.spellCriticalThreshold"].includes(change.key));
    if (critical.length) {
      const hasWeapon = critical.some(({ change }) => change.key.endsWith("weaponCriticalThreshold"));
      const hasSpell = critical.some(({ change }) => change.key.endsWith("spellCriticalThreshold"));
      const threshold = numeric(critical[0].change.value);
      const same = threshold !== null && critical.every(({ change }) => numeric(change.value) === threshold);
      if (same && setScalar("criticalThreshold", {
        threshold, scope: hasWeapon && hasSpell ? "all" : hasSpell ? "spell" : "weapon", availability
      }, `Actor Critical Threshold: ${threshold}`)) use(...critical.map(entry => entry.index));
    }

    for (let index = 0; index < changes.length; index += 1) {
      if (consumed.has(index)) continue;
      const change = changes[index];
      const key = String(change?.key ?? "");
      const value = numeric(change?.value);
      const proficiencyBonus = isProficiencyBonusFormula(change?.value);
      let recognized = false;

      if (key === "system.attributes.ac.bonus" && value !== null) {
        recognized = setScalar("armorClassBonus", { bonus: value, availability }, `Armor Class Bonus: ${modifier(value)}`);
      } else if (key === "system.bonuses.spell.dc" && value !== null) {
        recognized = setScalar("spellSaveDcBonus", { bonus: value, availability }, `Spell Save DC Bonus: ${modifier(value)}`);
      } else if (key === "system.attributes.init.bonus" && value !== null) {
        recognized = setScalar("initiativeBonus", { bonus: value, availability }, `Initiative Bonus: ${modifier(value)}`);
      } else if (key === "system.attributes.prof" && value !== null) {
        recognized = setScalar("proficiencyBonusModifier", { bonus: value, availability }, `Proficiency Bonus Modifier: ${modifier(value)}`);
      } else if (key === "system.attributes.hp.bonuses.overall" && value !== null) {
        recognized = setScalar("maximumHitPointsBonus", { bonus: value, availability }, `Maximum Hit Points Bonus: ${modifier(value)}`);
      } else if (key === "system.attributes.init.roll.mode" && value !== null && value > 0) {
        recognized = setScalar("initiativeAdvantage", { availability }, "Initiative Advantage");
      } else if (key === "system.bonuses.abilities.save" && (value !== null || proficiencyBonus)) {
        const row = proficiencyBonus
          ? effectRow({ target: "all", mode: "proficiency", bonus: 0 })
          : effectRow({ target: "all", mode: "fixed", bonus: value });
        recognized = appendRows("savingThrowBonus", [row], availability, proficiencyBonus ? "All Saving Throws: Proficiency Bonus" : `All Saving Throws: ${modifier(value)}`);
      } else if (/^system[.]abilities[.][a-z]{3}[.]bonuses[.]save$/.test(key) && (value !== null || proficiencyBonus)) {
        const ability = key.split(".")[2];
        const row = proficiencyBonus
          ? effectRow({ target: ability, mode: "proficiency", bonus: 0 })
          : effectRow({ target: ability, mode: "fixed", bonus: value });
        recognized = appendRows("savingThrowBonus", [row], availability, proficiencyBonus ? `${labelForAbility(ability)} Saving Throws: Proficiency Bonus` : `${labelForAbility(ability)} Saving Throws: ${modifier(value)}`);
      } else if (/^system[.]abilities[.][a-z]{3}[.]save[.]roll[.]mode$/.test(key) && value !== null && value > 0) {
        const ability = key.split(".")[2];
        recognized = appendRows("savingThrowAdvantage", [effectRow({ target: ability })], availability, `${labelForAbility(ability)} Saving Throw Advantage`);
      } else if (key === "system.bonuses.abilities.check" && value !== null) {
        recognized = appendRows("abilityCheckBonus", [effectRow({ target: "all", bonus: value })], availability, `All Ability Checks: ${modifier(value)}`);
      } else if (key === "system.bonuses.abilities.skill" && value !== null) {
        recognized = appendRows("skillBonus", [effectRow({ target: "all", bonus: value })], availability, `All Skill Checks: ${modifier(value)}`);
      } else if (/^system[.]abilities[.][a-z]{3}[.]bonuses[.]check$/.test(key) && value !== null) {
        const ability = key.split(".")[2];
        recognized = appendRows("abilityCheckBonus", [effectRow({ target: ability, bonus: value })], availability, `${labelForAbility(ability)} Checks: ${modifier(value)}`);
      } else if (/^system[.]abilities[.][a-z]{3}[.]check[.]roll[.]mode$/.test(key) && value !== null && value > 0) {
        const ability = key.split(".")[2];
        recognized = appendRows("abilityCheckAdvantage", [effectRow({ target: `ability:${ability}` })], availability, `${labelForAbility(ability)} Check Advantage`);
      } else if (/^system[.]skills[.][a-z]{3}[.]bonuses[.]check$/.test(key) && value !== null) {
        const skill = key.split(".")[2];
        recognized = appendRows("skillBonus", [effectRow({ target: skill, bonus: value })], availability, `${labelForSkill(skill)}: ${modifier(value)}`);
      } else if (/^system[.]skills[.][a-z]{3}[.]bonuses[.]passive$/.test(key) && value !== null) {
        const skill = key.split(".")[2];
        const score = ({ prc: "perception", inv: "investigation", ins: "insight" })[skill];
        if (score) recognized = appendRows("passiveScoreBonus", [effectRow({ score, bonus: value })], availability, `Passive ${labelForSkill(skill)}: ${modifier(value)}`);
      } else if (/^system[.]skills[.][a-z]{3}[.]roll[.]mode$/.test(key) && value !== null && value > 0) {
        const skill = key.split(".")[2];
        recognized = appendRows("abilityCheckAdvantage", [effectRow({ target: `skill:${skill}` })], availability, `${labelForSkill(skill)} Advantage`);
      } else if (/^system[.]skills[.][a-z]{3}[.]value$/.test(key) && value !== null) {
        const skill = key.split(".")[2];
        recognized = appendRows("skillProficiency", [effectRow({ skill, level: value >= 2 ? "expertise" : "proficient" })], availability, `${labelForSkill(skill)} ${value >= 2 ? "Expertise" : "Proficiency"}`);
      } else if (/^system[.]abilities[.][a-z]{3}[.]value$/.test(key) && value !== null) {
        const ability = key.split(".")[2];
        recognized = appendRows("abilityScoreAdjustment", [effectRow({ ability, operation: modeName(change.mode ?? change.type), value })], availability, `${labelForAbility(ability)} Score ${modeName(change.mode ?? change.type)} ${modifier(value)}`);
      } else if (/^system[.]traits[.](dr|di|dv)[.]value$/.test(key)) {
        const trait = key.split(".")[2];
        const target = ({ dr: "damageResistance", di: "damageImmunity", dv: "damageVulnerability" })[trait];
        const damageTypes = collectionValues(change.value);
        if (damageTypes.length) {
          enabled[target] = true;
          values[target] ??= { damageTypes: [], availability };
          values[target].damageTypes = [...new Set([...(values[target].damageTypes ?? []), ...damageTypes])];
          values[target].availability ??= availability;
          summaries.push(`${({ dr: "Damage Resistance", di: "Damage Immunity", dv: "Damage Vulnerability" })[trait]}: ${damageTypes.join(", ")}`);
          recognized = true;
        }
      } else if (key === "system.traits.ci.value") {
        const conditions = collectionValues(change.value);
        if (conditions.length) {
          enabled.conditionImmunity = true;
          values.conditionImmunity ??= { conditions: [], availability };
          values.conditionImmunity.conditions = [...new Set([...(values.conditionImmunity.conditions ?? []), ...conditions])];
          values.conditionImmunity.availability ??= availability;
          summaries.push(`Condition Immunity: ${conditions.join(", ")}`);
          recognized = true;
        }
      } else if (/^system[.]attributes[.]movement[.](walk|fly|swim|climb|burrow)$/.test(key) && value !== null) {
        const type = key.split(".").at(-1);
        const operation = modeName(change.mode ?? change.type);
        const target = operation === "add" ? "movementBonus" : "grantMovementType";
        const row = target === "movementBonus" ? effectRow({ type, bonus: value, units: "ft" }) : effectRow({ type, speed: value, units: "ft", hover: false });
        recognized = appendRows(target, [row], availability, `${type} Speed: ${operation === "add" ? modifier(value) : value} ft.`);
      } else if (/^system[.]attributes[.]senses[.]ranges[.]/.test(key) && value !== null) {
        const sense = key.split(".").at(-1);
        recognized = appendRows("grantedSense", [effectRow({ sense, range: value, units: "ft", operation: modeName(change.mode ?? change.type) })], availability, `${sense}: ${value} ft.`);
      }

      if (recognized) use(index);
    }

    // Hover is a companion flag to a granted Fly speed. Translate it only when
    // this Effect also supplied a Fly movement tier; otherwise preserve it as custom data.
    for (let index = 0; index < changes.length; index += 1) {
      if (consumed.has(index)) continue;
      const change = changes[index];
      if (String(change?.key ?? "") !== "system.attributes.movement.hover") continue;
      const enabledHover = change?.value === true || ["true", "1", "yes"].includes(String(change?.value ?? "").toLowerCase());
      const flyRow = values.grantMovementType?.entries?.find(row => row.type === "fly");
      if (enabledHover && flyRow) {
        flyRow.hover = true;
        consumed.add(index);
        summaries.push("Granted Fly speed includes Hover");
      }
    }

    const remaining = changes.filter((_change, index) => !consumed.has(index));
    if (remaining.length) customEffects.push(importedCustomEffect(effect, remaining));
  }

  return { enabled, values, managedEffectIds, customEffects, summaries };
}

export function normalizeBaseItemMechanics(item, {
  ignoreEffectIds = new Set(),
  ignoreActivityIds = new Set(),
  blockedKeys = new Set()
} = {}) {
  const activities = valuesOf(item?.system?.activities).filter(activity => !ignoreActivityIds.has(activity?.id ?? activity?._id));
  const managedActivityIds = activities.map(activity => activity?.id ?? activity?._id).filter(Boolean);
  const referencedEffectIds = new Set(activities.flatMap(activityEffects));
  const primaryAttack = item?.type === "weapon" ? activities.find(activity => activity?.type === "attack") : null;
  const castActivities = [];
  const customActivities = [];
  const activitySummaries = [];

  for (const activity of activities) {
    const id = activity?.id ?? activity?._id;
    if (id && id === (primaryAttack?.id ?? primaryAttack?._id)) {
      activitySummaries.push(`Primary ${activity?.type ?? "Attack"} Activity translated to native Item data`);
      continue;
    }
    if (activity?.type === "cast" && activity?.spell?.uuid) {
      castActivities.push(activity);
      activitySummaries.push(`${activity?.name || "Cast"}: translated to Granted Spellcasting`);
      continue;
    }
    customActivities.push(importedCustomActivity(activity));
    activitySummaries.push(`${activity?.name || activity?.type || "Activity"}: preserved as Custom Imported Activity`);
  }

  const effects = recognizeEffects(item, referencedEffectIds, ignoreEffectIds, blockedKeys);
  return {
    ...effects,
    managedActivityIds,
    castActivities,
    customActivities,
    activitySummaries,
    summary: [
      ...effects.summaries,
      ...effects.customEffects.map(entry => `Custom Effect: ${entry.name} (${entry.summary})`),
      ...activitySummaries
    ]
  };
}
