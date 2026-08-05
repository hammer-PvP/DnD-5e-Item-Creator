import { MODULE_ID } from "../constants.mjs";

export const TRIGGER_CATEGORIES = Object.freeze({
  attack: "Attack",
  spell: "Spell",
  resource: "Resource Consumption",
  activity: "Feature / Activity Use",
  damage: "Damage & Healing",
  combat: "Combat Event"
});

export const TRIGGER_EVENTS = Object.freeze({
  attack: Object.freeze([
    ["attackRolled", "Attack Rolled"],
    ["attackHit", "Attack Hit"],
    ["criticalHit", "Critical Hit (uses the attack's critical threshold)"],
    ["natural20", "Natural 20 on an Attack"],
    ["attackDamageApplied", "Damage from an Attack Applied"]
  ]),
  spell: Object.freeze([
    ["spellCast", "Any Spell Cast"],
    ["spellAttackCast", "Spell with Attack Roll Cast"],
    ["spellSaveCast", "Spell with Saving Throw Cast"],
    ["specificSpellCast", "Specific Spell Cast"],
    ["spellCastUsingSlot", "Spell Cast Using a Slot"],
    ["spellCastWithoutSlot", "Spell Cast Without a Slot"]
  ]),
  resource: Object.freeze([
    ["resourceSpent", "Any Resource Spent"],
    ["specificResourceSpent", "Specific Resource Spent"],
    ["spellSlotSpent", "Spell Slot Spent"],
    ["pactSlotSpent", "Pact Magic Slot Spent"],
    ["itemChargeSpent", "Item Charge Spent"],
    ["featureUseSpent", "Feature Use Spent"],
    ["resourceReducedToZero", "Resource Reduced to Zero"],
    ["lastUseSpent", "Last Use Spent"]
  ]),
  activity: Object.freeze([
    ["anyFeatureUsed", "Any Feature Used"],
    ["specificFeatureUsed", "Specific Feature Used"],
    ["thisItemActivityUsed", "Activity from This Item Used"],
    ["anyItemUsed", "Any Item Used"]
  ]),
  damage: Object.freeze([
    ["damageDealt", "Damage Applied by the Wielder"],
    ["damageReceived", "Damage Received by the Wielder"],
    ["healingDealt", "Healing Applied by the Wielder"],
    ["healingReceived", "Healing Received by the Wielder"]
  ]),
  combat: Object.freeze([
    ["ownerTurnStart", "Start of Owner Turn"],
    ["ownerTurnEnd", "End of Owner Turn"],
    ["roundStart", "Start of Round"],
    ["roundEnd", "End of Round"],
    ["combatStart", "Combat Started"]
  ])
});

export const ATTACK_TYPES = Object.freeze([
  ["any", "Any Attack"],
  ["weapon", "Any Weapon Attack"],
  ["meleeWeapon", "Melee Weapon Attack"],
  ["rangedWeapon", "Ranged Weapon Attack"],
  ["unarmed", "Unarmed Strike"],
  ["spell", "Any Spell Attack"],
  ["meleeSpell", "Melee Spell Attack"],
  ["rangedSpell", "Ranged Spell Attack"]
]);

export const ACTIVATION_COUNTING = Object.freeze([
  ["perActivity", "Once per Activity"],
  ["perAttackRoll", "Once per Attack Roll"],
  ["perSuccessfulAttack", "Once per Successful Attack Roll"],
  ["perTarget", "Once per Damaged Target"],
  ["perTurn", "Once per Turn"],
  ["perRound", "Once per Round"]
]);

export const STACK_BEHAVIORS = Object.freeze([
  ["refresh", "No Stacking — Refresh Duration"],
  ["shared", "Shared Duration"],
  ["independent", "Independent Duration per Stack"],
  ["continuousDecay", "Continuous Decay"],
  ["delayedDecay", "Delayed Decay after Inactivity"]
]);

export const DURATION_UNITS = Object.freeze([
  ["ownerTurns", "Owner Turns"],
  ["combatTurns", "Combat Turns"],
  ["rounds", "Rounds"]
]);

export const TICK_TIMINGS = Object.freeze({
  ownerTurns: Object.freeze([
    ["ownerTurnStart", "Start of Owner Turn"],
    ["ownerTurnEnd", "End of Owner Turn"]
  ]),
  combatTurns: Object.freeze([
    ["combatTurnStart", "Start of Combat Turn"],
    ["combatTurnEnd", "End of Combat Turn"]
  ]),
  rounds: Object.freeze([
    ["roundStart", "Start of Round"],
    ["roundEnd", "End of Round"]
  ])
});

export const TRIGGER_EFFECT_TYPES = Object.freeze([
  ["spellAttackBonus", "Spell Attack Bonus"],
  ["spellSaveDcBonus", "Spell Save DC Bonus"],
  ["weaponAttackBonus", "Weapon Attack Bonus"],
  ["weaponDamageBonus", "Weapon Damage Bonus"],
  ["spellDamageBonus", "Spell Damage Bonus"],
  ["allAttackBonus", "All Attack Bonus"],
  ["allDamageBonus", "All Damage Bonus"],
  ["armorClassBonus", "Armor Class Bonus"],
  ["savingThrowBonus", "Saving Throw Bonus"],
  ["concentrationSaveBonus", "Concentration Save Bonus"],
  ["initiativeBonus", "Initiative Bonus"],
  ["maximumHitPointsBonus", "Maximum Hit Points Bonus"],
  ["movementBonus", "Movement Bonus"],
  ["damageResistance", "Damage Resistance"],
  ["damageImmunity", "Damage Immunity"],
  ["conditionImmunity", "Condition Immunity"],
  ["actorCriticalThreshold", "Actor Critical Threshold"]
]);

export const VALUE_CALCULATIONS = Object.freeze([
  ["flat", "Flat Number"],
  ["proficiency", "Proficiency Bonus"],
  ["spellcasting", "Default Spellcasting Ability Modifier"],
  ["highestSpellcasting", "Highest Spellcasting Ability Modifier"],
  ["str", "Strength Modifier"],
  ["dex", "Dexterity Modifier"],
  ["con", "Constitution Modifier"],
  ["int", "Intelligence Modifier"],
  ["wis", "Wisdom Modifier"],
  ["cha", "Charisma Modifier"],
  ["dice", "Dice Formula"],
  ["custom", "Custom Formula"]
]);

export const EFFECT_SCALING = Object.freeze([
  ["perStack", "Per Stack"],
  ["fixed", "Fixed While Active"]
]);

const NUMERIC_EFFECTS = new Set([
  "spellAttackBonus", "spellSaveDcBonus", "weaponAttackBonus", "weaponDamageBonus", "spellDamageBonus",
  "allAttackBonus", "allDamageBonus", "armorClassBonus", "savingThrowBonus", "concentrationSaveBonus",
  "initiativeBonus", "maximumHitPointsBonus", "movementBonus"
]);

const DAMAGE_EFFECTS = new Set(["weaponDamageBonus", "spellDamageBonus", "allDamageBonus"]);
const TRAIT_EFFECTS = new Set(["damageResistance", "damageImmunity", "conditionImmunity"]);

function clone(value) {
  return foundry.utils.deepClone(value);
}

function id() {
  return foundry.utils.randomID();
}

export function defaultTriggeredEffectPayload(type = "spellAttackBonus") {
  return {
    id: id(),
    type,
    calculation: "flat",
    amount: 1,
    formula: "",
    scaling: "perStack",
    diceNumber: 1,
    die: 6,
    ability: "all",
    movementType: "walk",
    damageType: "fire",
    condition: "charmed",
    criticalScope: "all",
    criticalThreshold: 19
  };
}

export function defaultTriggeredEffect() {
  return {
    id: id(),
    name: "Triggered Effect",
    availability: "equipped",
    unlockOnLevel: false,
    unlockLevel: 1,
    trigger: {
      category: "attack",
      event: "attackHit",
      attackType: "any",
      spellLevel: "any",
      spellSchool: "any",
      spellUuid: "",
      spellName: "",
      featureUuid: "",
      featureName: "",
      featureIdentifier: "",
      resourceId: "bardic-inspiration",
      spellSlotLevel: "any",
      damageSource: "any",
      damageType: "any",
      minimumAmount: 0
    },
    counting: "perSuccessfulAttack",
    maxPerTurn: 0,
    maxPerRound: 0,
    stacks: {
      granted: 1,
      maximum: 10,
      behavior: "delayedDecay",
      durationAmount: 2,
      durationUnit: "ownerTurns",
      tickTiming: "ownerTurnEnd",
      inactivityGrace: 2,
      decayAmount: 1
    },
    effects: [
      defaultTriggeredEffectPayload("spellAttackBonus"),
      defaultTriggeredEffectPayload("spellSaveDcBonus")
    ]
  };
}

function validChoice(list, value, fallback) {
  return list.some(([entry]) => entry === value) ? value : fallback;
}

export function normalizeTriggeredEffectPayload(value = {}) {
  const fallback = defaultTriggeredEffectPayload();
  const type = validChoice(TRIGGER_EFFECT_TYPES, value.type, fallback.type);
  const calculation = validChoice(VALUE_CALCULATIONS, value.calculation, fallback.calculation);
  const scaling = validChoice(EFFECT_SCALING, value.scaling, fallback.scaling);
  return {
    ...fallback,
    ...clone(value),
    id: value.id || id(),
    type,
    calculation,
    amount: Number.isFinite(Number(value.amount)) ? Number(value.amount) : 1,
    formula: String(value.formula ?? "").trim(),
    scaling,
    diceNumber: Math.max(1, Number(value.diceNumber) || 1),
    die: [4, 6, 8, 10, 12, 20].includes(Number(value.die)) ? Number(value.die) : 6,
    ability: value.ability || "all",
    movementType: value.movementType || "walk",
    damageType: value.damageType || "fire",
    condition: value.condition || "charmed",
    criticalScope: ["weapon", "spell", "all"].includes(value.criticalScope) ? value.criticalScope : "all",
    criticalThreshold: Math.clamp(Number(value.criticalThreshold) || 19, 1, 20)
  };
}

export function normalizeTriggeredEffect(value = {}) {
  const fallback = defaultTriggeredEffect();
  const category = Object.hasOwn(TRIGGER_CATEGORIES, value.trigger?.category) ? value.trigger.category : fallback.trigger.category;
  const events = TRIGGER_EVENTS[category] ?? TRIGGER_EVENTS.attack;
  const event = validChoice(events, value.trigger?.event, events[0][0]);
  const durationUnit = validChoice(DURATION_UNITS, value.stacks?.durationUnit, fallback.stacks.durationUnit);
  const tickTiming = validChoice(TICK_TIMINGS[durationUnit] ?? [], value.stacks?.tickTiming,
    TICK_TIMINGS[durationUnit]?.[1]?.[0] ?? TICK_TIMINGS[durationUnit]?.[0]?.[0]);
  return {
    ...fallback,
    ...clone(value),
    id: value.id || id(),
    name: String(value.name ?? fallback.name).trim() || fallback.name,
    availability: ["owned", "equipped", "equippedAttuned"].includes(value.availability) ? value.availability : fallback.availability,
    unlockOnLevel: Boolean(value.unlockOnLevel),
    unlockLevel: Math.clamp(Number(value.unlockLevel) || 1, 1, 20),
    trigger: {
      ...fallback.trigger,
      ...(clone(value.trigger ?? {})),
      category,
      event,
      attackType: validChoice(ATTACK_TYPES, value.trigger?.attackType, "any"),
      spellLevel: value.trigger?.spellLevel === "any" ? "any" : Math.clamp(Number(value.trigger?.spellLevel) || 0, 0, 9),
      spellSlotLevel: value.trigger?.spellSlotLevel === "any" ? "any" : Math.clamp(Number(value.trigger?.spellSlotLevel) || 1, 1, 9),
      minimumAmount: Math.max(0, Number(value.trigger?.minimumAmount) || 0)
    },
    counting: validChoice(ACTIVATION_COUNTING, value.counting, fallback.counting),
    maxPerTurn: Math.max(0, Number(value.maxPerTurn) || 0),
    maxPerRound: Math.max(0, Number(value.maxPerRound) || 0),
    stacks: {
      ...fallback.stacks,
      ...(clone(value.stacks ?? {})),
      granted: Math.max(1, Number(value.stacks?.granted) || 1),
      maximum: Math.max(1, Number(value.stacks?.maximum) || 1),
      behavior: validChoice(STACK_BEHAVIORS, value.stacks?.behavior, fallback.stacks.behavior),
      durationAmount: Math.max(1, Number(value.stacks?.durationAmount) || 1),
      durationUnit,
      tickTiming,
      inactivityGrace: Math.max(0, Number(value.stacks?.inactivityGrace) || 0),
      decayAmount: Math.max(1, Number(value.stacks?.decayAmount) || 1)
    },
    effects: (Array.isArray(value.effects) && value.effects.length ? value.effects : fallback.effects)
      .map(normalizeTriggeredEffectPayload)
  };
}

export function validateTriggeredEffectPayload(value) {
  const row = normalizeTriggeredEffectPayload(value);
  if (!TRIGGER_EFFECT_TYPES.some(([type]) => type === row.type)) return false;
  if (NUMERIC_EFFECTS.has(row.type)) {
    if (!VALUE_CALCULATIONS.some(([type]) => type === row.calculation)) return false;
    if (row.calculation === "flat" && !Number.isFinite(Number(row.amount))) return false;
    if (row.calculation === "dice" && (!(row.diceNumber > 0) || ![4, 6, 8, 10, 12, 20].includes(Number(row.die)))) return false;
    if (row.calculation === "custom" && !String(row.formula ?? "").trim()) return false;
  }
  if (row.type === "savingThrowBonus" && !row.ability) return false;
  if (row.type === "movementBonus" && !row.movementType) return false;
  if (["damageResistance", "damageImmunity"].includes(row.type) && !row.damageType) return false;
  if (row.type === "conditionImmunity" && !row.condition) return false;
  if (row.type === "actorCriticalThreshold" && (!(row.criticalThreshold >= 1 && row.criticalThreshold <= 20)
    || !["weapon", "spell", "all"].includes(row.criticalScope))) return false;
  return true;
}

export function validateTriggeredEffect(value) {
  const setting = normalizeTriggeredEffect(value);
  if (!setting.id || !setting.name) return false;
  if (!Object.hasOwn(TRIGGER_CATEGORIES, setting.trigger.category)) return false;
  if (!(TRIGGER_EVENTS[setting.trigger.category] ?? []).some(([event]) => event === setting.trigger.event)) return false;
  if (!["owned", "equipped", "equippedAttuned"].includes(setting.availability)) return false;
  if (setting.unlockOnLevel && !(setting.unlockLevel >= 1 && setting.unlockLevel <= 20)) return false;
  if (!(setting.stacks.granted > 0 && setting.stacks.maximum > 0)) return false;
  if (!STACK_BEHAVIORS.some(([entry]) => entry === setting.stacks.behavior)) return false;
  if (!DURATION_UNITS.some(([entry]) => entry === setting.stacks.durationUnit)) return false;
  if (!(TICK_TIMINGS[setting.stacks.durationUnit] ?? []).some(([entry]) => entry === setting.stacks.tickTiming)) return false;
  if (!setting.effects.length || setting.effects.some(effect => !validateTriggeredEffectPayload(effect))) return false;
  return true;
}

function formulaForPayload(row, stacks) {
  const multiplier = row.scaling === "perStack" ? Math.max(1, Number(stacks) || 1) : 1;
  if (row.calculation === "flat") return String((Number(row.amount) || 0) * multiplier);
  if (row.calculation === "proficiency") return multiplier === 1 ? "@prof" : `(@prof) * ${multiplier}`;
  if (row.calculation === "spellcasting") {
    const formula = "@abilities[@attributes.spellcasting].mod";
    return multiplier === 1 ? formula : `(${formula}) * ${multiplier}`;
  }
  if (row.calculation === "highestSpellcasting") {
    // Runtime replaces this token with the current highest spellcasting modifier.
    return `@flags.${MODULE_ID}.triggeredHighestSpellcasting * ${multiplier}`;
  }
  if (["str", "dex", "con", "int", "wis", "cha"].includes(row.calculation)) {
    const formula = `@abilities.${row.calculation}.mod`;
    return multiplier === 1 ? formula : `(${formula}) * ${multiplier}`;
  }
  if (row.calculation === "dice") {
    const number = Math.max(1, Number(row.diceNumber) || 1) * multiplier;
    return `${number}d${Number(row.die) || 6}`;
  }
  if (row.calculation === "custom") {
    const formula = String(row.formula ?? "").trim();
    return multiplier === 1 ? formula : `(${formula}) * ${multiplier}`;
  }
  return "0";
}

function addChange(changes, key, mode, value, priority = null) {
  if (value === null || value === undefined || value === "") return;
  changes.push({ key, mode, value: String(value), ...(priority ? { priority } : {}) });
}

export function buildTriggeredEffectChanges(setting, stacks, actor = null) {
  const add = CONST.ACTIVE_EFFECT_MODES.ADD;
  const downgrade = CONST.ACTIVE_EFFECT_MODES.DOWNGRADE;
  const changes = [];
  let highestSpellcasting = -Infinity;
  if (actor) {
    const abilities = new Set(Object.values(actor.spellcastingClasses ?? {})
      .map(entry => entry?.spellcasting?.ability).filter(Boolean));
    if (actor.system?.attributes?.spellcasting) abilities.add(actor.system.attributes.spellcasting);
    highestSpellcasting = Math.max(...[...abilities].map(ability => Number(actor.system?.abilities?.[ability]?.mod ?? -Infinity)));
    if (!Number.isFinite(highestSpellcasting)) highestSpellcasting = Number(actor.system?.abilities?.[actor.system?.attributes?.spellcasting]?.mod ?? 0) || 0;
  }

  for (const source of setting.effects ?? []) {
    const row = normalizeTriggeredEffectPayload(source);
    let value = formulaForPayload(row, stacks);
    if (row.calculation === "highestSpellcasting") {
      const multiplier = row.scaling === "perStack" ? Math.max(1, Number(stacks) || 1) : 1;
      value = String((Number(highestSpellcasting) || 0) * multiplier);
    }
    switch (row.type) {
      case "spellAttackBonus":
        addChange(changes, "system.bonuses.msak.attack", add, value);
        addChange(changes, "system.bonuses.rsak.attack", add, value);
        break;
      case "spellSaveDcBonus":
        addChange(changes, "system.bonuses.spell.dc", add, value);
        break;
      case "weaponAttackBonus":
        addChange(changes, "system.bonuses.mwak.attack", add, value);
        addChange(changes, "system.bonuses.rwak.attack", add, value);
        break;
      case "weaponDamageBonus":
        addChange(changes, "system.bonuses.mwak.damage", add, value);
        addChange(changes, "system.bonuses.rwak.damage", add, value);
        break;
      case "spellDamageBonus":
        addChange(changes, "system.bonuses.msak.damage", add, value);
        addChange(changes, "system.bonuses.rsak.damage", add, value);
        break;
      case "allAttackBonus":
        for (const type of ["mwak", "rwak", "msak", "rsak"]) addChange(changes, `system.bonuses.${type}.attack`, add, value);
        break;
      case "allDamageBonus":
        for (const type of ["mwak", "rwak", "msak", "rsak"]) addChange(changes, `system.bonuses.${type}.damage`, add, value);
        break;
      case "armorClassBonus":
        addChange(changes, "system.attributes.ac.bonus", add, value);
        break;
      case "savingThrowBonus":
        if (row.ability === "all") addChange(changes, "system.bonuses.abilities.save", add, value);
        else addChange(changes, `system.abilities.${row.ability}.bonuses.save`, add, value);
        break;
      case "concentrationSaveBonus":
        addChange(changes, "system.attributes.concentration.bonuses.save", add, value);
        break;
      case "initiativeBonus":
        addChange(changes, "system.attributes.init.bonus", add, value);
        break;
      case "maximumHitPointsBonus":
        addChange(changes, "system.attributes.hp.bonuses.overall", add, value);
        break;
      case "movementBonus":
        addChange(changes, `system.attributes.movement.${row.movementType}`, add, value);
        break;
      case "damageResistance":
        addChange(changes, "system.traits.dr.value", add, row.damageType);
        break;
      case "damageImmunity":
        addChange(changes, "system.traits.di.value", add, row.damageType);
        break;
      case "conditionImmunity":
        addChange(changes, "system.traits.ci.value", add, row.condition);
        break;
      case "actorCriticalThreshold": {
        const threshold = Math.clamp(Number(row.criticalThreshold) || 20, 1, 20);
        if (row.criticalScope === "all" || row.criticalScope === "weapon") {
          addChange(changes, "flags.dnd5e.weaponCriticalThreshold", downgrade, threshold);
        }
        if (row.criticalScope === "all" || row.criticalScope === "spell") {
          addChange(changes, "flags.dnd5e.spellCriticalThreshold", downgrade, threshold);
        }
        break;
      }
    }
  }
  return changes;
}

export function triggeredEffectSummary(value) {
  const setting = normalizeTriggeredEffect(value);
  const event = (TRIGGER_EVENTS[setting.trigger.category] ?? []).find(([id]) => id === setting.trigger.event)?.[1] ?? setting.trigger.event;
  const behavior = STACK_BEHAVIORS.find(([id]) => id === setting.stacks.behavior)?.[1] ?? setting.stacks.behavior;
  return `${event}; +${setting.stacks.granted} stack(s), max ${setting.stacks.maximum}; ${behavior}`;
}

export function isNumericTriggeredEffect(type) {
  return NUMERIC_EFFECTS.has(type);
}

export function isDamageTriggeredEffect(type) {
  return DAMAGE_EFFECTS.has(type);
}

export function isTraitTriggeredEffect(type) {
  return TRAIT_EFFECTS.has(type);
}
