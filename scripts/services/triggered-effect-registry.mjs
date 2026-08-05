import { MODULE_ID } from "../constants.mjs";
import { getResourceDefinition } from "./resource-modification-registry.mjs";

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
    ["criticalHit", "Critical Hit"],
    ["natural20", "Natural 20"],
    ["attackDamageApplied", "Damage from an Attack Applied"]
  ]),
  spell: Object.freeze([
    ["spellCast", "Any Spell Matching Filters"],
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

export const APPLICATION_MODES = Object.freeze([
  ["stacking", "Stacks & Duration"],
  ["singleActivation", "Single Activation"]
]);

export const SINGLE_ACTIVATION_EXPIRATIONS = Object.freeze([
  ["ownerTurnEndCurrent", "End of Owner's Current Turn"],
  ["ownerTurnStartNext", "Start of Owner's Next Turn"],
  ["ownerTurnEndNext", "End of Owner's Next Turn"]
]);

export const RETRIGGER_BEHAVIORS = Object.freeze([
  ["refresh", "Refresh Duration"],
  ["ignore", "Ignore While Active"]
]);

export const STACK_BEHAVIORS = Object.freeze([
  ["singleAttack", "Single Attack — Remove After Damage Roll"],
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
      spellSelectionMode: "filters",
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
    application: {
      mode: "stacking",
      expiration: "ownerTurnEndCurrent",
      retrigger: "refresh"
    },
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
  let event = validChoice(events, value.trigger?.event, events[0][0]);
  const selectedSpell = Boolean(String(value.trigger?.spellUuid ?? "").trim() || String(value.trigger?.spellName ?? "").trim());
  const explicitSpellSelection = value.trigger?.spellSelectionMode === "specific";
  // v0.5.0a allowed Specific Spell Cast to be saved without a selected Spell or an explicit
  // selection mode. That configuration never matched at runtime. Preserve the visible level/school
  // filters by migrating only that legacy shape to Any Spell Cast. New Specific Spell drafts carry
  // spellSelectionMode="specific" while the user is choosing the Spell and remain editable.
  if (category === "spell" && event === "specificSpellCast" && !selectedSpell && !explicitSpellSelection) event = "spellCast";
  const durationUnit = validChoice(DURATION_UNITS, value.stacks?.durationUnit, fallback.stacks.durationUnit);
  const tickTiming = validChoice(TICK_TIMINGS[durationUnit] ?? [], value.stacks?.tickTiming,
    TICK_TIMINGS[durationUnit]?.[1]?.[0] ?? TICK_TIMINGS[durationUnit]?.[0]?.[0]);
  const applicationMode = validChoice(APPLICATION_MODES, value.application?.mode, fallback.application.mode);
  const expiration = validChoice(SINGLE_ACTIVATION_EXPIRATIONS, value.application?.expiration, fallback.application.expiration);
  const retrigger = validChoice(RETRIGGER_BEHAVIORS, value.application?.retrigger, fallback.application.retrigger);
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
      spellSelectionMode: event === "specificSpellCast" ? "specific" : "filters",
      attackType: validChoice(ATTACK_TYPES, value.trigger?.attackType, "any"),
      spellLevel: value.trigger?.spellLevel === "any" ? "any" : Math.clamp(Number(value.trigger?.spellLevel) || 0, 0, 9),
      spellSlotLevel: value.trigger?.spellSlotLevel === "any" ? "any" : Math.clamp(Number(value.trigger?.spellSlotLevel) || 1, 1, 9),
      minimumAmount: Math.max(0, Number(value.trigger?.minimumAmount) || 0)
    },
    counting: validChoice(ACTIVATION_COUNTING, value.counting, fallback.counting),
    maxPerTurn: Math.max(0, Number(value.maxPerTurn) || 0),
    maxPerRound: Math.max(0, Number(value.maxPerRound) || 0),
    application: {
      ...fallback.application,
      ...(clone(value.application ?? {})),
      mode: applicationMode,
      expiration,
      retrigger
    },
    stacks: (() => {
      const behavior = validChoice(STACK_BEHAVIORS, value.stacks?.behavior, fallback.stacks.behavior);
      const singleAttack = behavior === "singleAttack";
      return {
        ...fallback.stacks,
        ...(clone(value.stacks ?? {})),
        granted: singleAttack ? 1 : Math.max(1, Number(value.stacks?.granted) || 1),
        maximum: singleAttack ? 1 : Math.max(1, Number(value.stacks?.maximum) || 1),
        behavior,
        durationAmount: singleAttack ? 1 : Math.max(1, Number(value.stacks?.durationAmount) || 1),
        durationUnit: singleAttack ? "ownerTurns" : durationUnit,
        tickTiming: singleAttack ? "ownerTurnEnd" : tickTiming,
        inactivityGrace: Math.max(0, Number(value.stacks?.inactivityGrace) || 0),
        decayAmount: Math.max(1, Number(value.stacks?.decayAmount) || 1)
      };
    })(),
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
  if (setting.trigger.event === "specificSpellCast"
    && !String(setting.trigger.spellUuid || setting.trigger.spellName || "").trim()) return false;
  if (setting.trigger.event === "specificFeatureUsed"
    && !String(setting.trigger.featureUuid || setting.trigger.featureName || setting.trigger.featureIdentifier || "").trim()) return false;
  if (!["owned", "equipped", "equippedAttuned"].includes(setting.availability)) return false;
  if (setting.unlockOnLevel && !(setting.unlockLevel >= 1 && setting.unlockLevel <= 20)) return false;
  if (!(setting.stacks.granted > 0 && setting.stacks.maximum > 0)) return false;
  if (!APPLICATION_MODES.some(([entry]) => entry === setting.application.mode)) return false;
  if (!SINGLE_ACTIVATION_EXPIRATIONS.some(([entry]) => entry === setting.application.expiration)) return false;
  if (!RETRIGGER_BEHAVIORS.some(([entry]) => entry === setting.application.retrigger)) return false;
  if (!STACK_BEHAVIORS.some(([entry]) => entry === setting.stacks.behavior)) return false;
  if (setting.application.mode === "stacking" && setting.stacks.behavior === "singleAttack"
    && !(setting.trigger.category === "attack" && ["attackHit", "criticalHit", "natural20"].includes(setting.trigger.event))) return false;
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

function optionLabel(options, value, fallback = value) {
  return options.find(([id]) => id === value)?.[1] ?? fallback;
}

function attackEventSummary(setting, eventLabel) {
  const attackType = optionLabel(ATTACK_TYPES, setting.trigger.attackType, "Any Attack");
  if (!setting.trigger.attackType || setting.trigger.attackType === "any") return eventLabel;
  if (setting.trigger.event === "criticalHit") return `Critical Hit — ${attackType}`;
  if (setting.trigger.event === "natural20") return `Natural 20 — ${attackType}`;
  if (setting.trigger.event === "attackHit") return `Attack Hit — ${attackType}`;
  if (setting.trigger.event === "attackRolled") return `Attack Rolled — ${attackType}`;
  if (setting.trigger.event === "attackDamageApplied") return `Damage Applied from ${attackType}`;
  return `${eventLabel} — ${attackType}`;
}

function localizedConfigLabel(config, key, fallback = key) {
  const entry = config?.[key];
  const label = typeof entry === "string" ? entry : entry?.label;
  return label ? game.i18n.localize(label) : fallback;
}

function signed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value ?? "");
  return numeric > 0 ? `+${numeric}` : String(numeric);
}

function spellFilterSummary(setting) {
  const trigger = setting.trigger;
  const school = trigger.spellSchool && trigger.spellSchool !== "any"
    ? localizedConfigLabel(CONFIG.DND5E.spellSchools, trigger.spellSchool, trigger.spellSchool)
    : "";
  const level = trigger.spellLevel === "any" ? ""
    : Number(trigger.spellLevel) === 0 ? "cantrip"
      : `level ${Number(trigger.spellLevel)}`;
  return [school, level].filter(Boolean).join(" ");
}

function triggerSummary(setting) {
  const eventLabel = optionLabel(TRIGGER_EVENTS[setting.trigger.category] ?? [], setting.trigger.event, setting.trigger.event);
  if (setting.trigger.category === "attack") return attackEventSummary(setting, eventLabel);
  if (setting.trigger.category === "spell") {
    const filters = spellFilterSummary(setting);
    if (setting.trigger.event === "specificSpellCast") {
      const selected = setting.trigger.spellName || "the selected Spell";
      return filters ? `Cast ${selected} (${filters})` : `Cast ${selected}`;
    }
    const target = filters ? `any ${filters} Spell` : "any Spell";
    if (setting.trigger.event === "spellCast") return `Cast ${target}`;
    if (setting.trigger.event === "spellAttackCast") return `Cast ${target} with an attack roll`;
    if (setting.trigger.event === "spellSaveCast") return `Cast ${target} with a saving throw`;
    if (setting.trigger.event === "spellCastUsingSlot") return `Cast ${target} using a spell slot`;
    if (setting.trigger.event === "spellCastWithoutSlot") return `Cast ${target} without using a spell slot`;
  }
  if (setting.trigger.event === "specificResourceSpent") {
    const resource = getResourceDefinition(setting.trigger.resourceId);
    return `Spend ${resource?.label ?? setting.trigger.resourceId ?? "the selected resource"}`;
  }
  if (setting.trigger.event === "specificFeatureUsed") {
    return `Use ${setting.trigger.featureName || "the selected Feature"}`;
  }
  if (["spellSlotSpent", "pactSlotSpent"].includes(setting.trigger.event)
    && setting.trigger.spellSlotLevel !== "any") {
    const prefix = setting.trigger.event === "pactSlotSpent" ? "Pact Magic" : "Spell";
    return `Spend a level ${setting.trigger.spellSlotLevel} ${prefix} slot`;
  }
  if (["damageDealt", "damageReceived", "healingDealt", "healingReceived", "attackDamageApplied"].includes(setting.trigger.event)) {
    const filters = [];
    if (setting.trigger.damageSource && setting.trigger.damageSource !== "any") filters.push(`${setting.trigger.damageSource} source`);
    if (setting.trigger.damageType && setting.trigger.damageType !== "any") {
      filters.push(`${localizedConfigLabel(CONFIG.DND5E.damageTypes, setting.trigger.damageType, setting.trigger.damageType)} damage`);
    }
    if (Number(setting.trigger.minimumAmount) > 0) filters.push(`minimum ${Number(setting.trigger.minimumAmount)}`);
    return filters.length ? `${eventLabel} (${filters.join(", ")})` : eventLabel;
  }
  return eventLabel;
}

function calculationSummary(row) {
  if (row.calculation === "flat") return signed(row.amount);
  if (row.calculation === "proficiency") return "Proficiency Bonus";
  if (row.calculation === "spellcasting") return "default spellcasting ability modifier";
  if (row.calculation === "highestSpellcasting") return "highest spellcasting ability modifier";
  if (["str", "dex", "con", "int", "wis", "cha"].includes(row.calculation)) {
    return `${localizedConfigLabel(CONFIG.DND5E.abilities, row.calculation, row.calculation.toUpperCase())} modifier`;
  }
  if (row.calculation === "dice") return `${Math.max(1, Number(row.diceNumber) || 1)}d${Number(row.die) || 6}`;
  if (row.calculation === "custom") return String(row.formula ?? "custom formula").trim() || "custom formula";
  return optionLabel(VALUE_CALCULATIONS, row.calculation, row.calculation);
}

function payloadSummary(source, setting) {
  const row = normalizeTriggeredEffectPayload(source);
  const value = calculationSummary(row);
  const scaling = setting.application.mode === "singleActivation" || row.scaling !== "perStack"
    ? " while active" : " per stack";
  if (row.type === "movementBonus") {
    const movement = localizedConfigLabel(CONFIG.DND5E.movementTypes, row.movementType, row.movementType);
    return `${movement} speed ${value} ft${scaling}`;
  }
  if (row.type === "savingThrowBonus") {
    const ability = row.ability === "all" ? "all saving throws"
      : `${localizedConfigLabel(CONFIG.DND5E.abilities, row.ability, row.ability)} saving throws`;
    return `${value} to ${ability}${scaling}`;
  }
  if (row.type === "damageResistance") {
    return `${localizedConfigLabel(CONFIG.DND5E.damageTypes, row.damageType, row.damageType)} damage resistance`;
  }
  if (row.type === "damageImmunity") {
    return `${localizedConfigLabel(CONFIG.DND5E.damageTypes, row.damageType, row.damageType)} damage immunity`;
  }
  if (row.type === "conditionImmunity") {
    return `${localizedConfigLabel(CONFIG.DND5E.conditionTypes, row.condition, row.condition)} condition immunity`;
  }
  if (row.type === "actorCriticalThreshold") {
    const scope = row.criticalScope === "weapon" ? "weapon attacks" : row.criticalScope === "spell" ? "spell attacks" : "all attacks";
    return `critical hit on ${row.criticalThreshold === 20 ? "20" : `${row.criticalThreshold}–20`} for ${scope}`;
  }
  const label = optionLabel(TRIGGER_EFFECT_TYPES, row.type, row.type);
  return `${label} ${value}${scaling}`;
}

function frequencySummary(setting) {
  const count = optionLabel(ACTIVATION_COUNTING, setting.counting, setting.counting);
  const limits = [];
  if (setting.maxPerTurn > 0) limits.push(`maximum ${setting.maxPerTurn} per turn`);
  if (setting.maxPerRound > 0) limits.push(`maximum ${setting.maxPerRound} per round`);
  return [count, ...limits].join(", ");
}

function durationUnitPhrase(unit, amount = 1) {
  const singular = { ownerTurns: "Owner Turn", combatTurns: "Combat Turn", rounds: "Round" }[unit];
  if (!singular) return optionLabel(DURATION_UNITS, unit, unit);
  return Number(amount) === 1 ? singular : `${singular}s`;
}

function stackDurationSummary(setting) {
  if (setting.stacks.behavior === "singleAttack") {
    return "Single Attack; remains through that attack's next damage roll, with end-of-current-turn cleanup if no damage is rolled";
  }
  const behavior = optionLabel(STACK_BEHAVIORS, setting.stacks.behavior, setting.stacks.behavior);
  if (["refresh", "shared", "independent"].includes(setting.stacks.behavior)) {
    const unit = durationUnitPhrase(setting.stacks.durationUnit, setting.stacks.durationAmount);
    const timing = optionLabel(TICK_TIMINGS[setting.stacks.durationUnit] ?? [], setting.stacks.tickTiming, setting.stacks.tickTiming);
    return `${behavior}; +${setting.stacks.granted} stack(s), maximum ${setting.stacks.maximum}; duration ${setting.stacks.durationAmount} ${unit}, expires at ${timing}`;
  }
  const unit = durationUnitPhrase(setting.stacks.durationUnit, 1);
  const timing = optionLabel(TICK_TIMINGS[setting.stacks.durationUnit] ?? [], setting.stacks.tickTiming, setting.stacks.tickTiming);
  const grace = setting.stacks.behavior === "delayedDecay" ? ` after ${setting.stacks.inactivityGrace} inactive tick(s)` : "";
  return `${behavior}; +${setting.stacks.granted} stack(s), maximum ${setting.stacks.maximum}; loses ${setting.stacks.decayAmount} stack(s) per ${unit} at ${timing}${grace}`;
}

function applicationSummary(setting) {
  if (setting.application.mode !== "singleActivation") return stackDurationSummary(setting);
  const expiration = optionLabel(SINGLE_ACTIVATION_EXPIRATIONS, setting.application.expiration, setting.application.expiration);
  const retrigger = setting.application.retrigger === "ignore" ? "new triggers are ignored while active" : "new triggers refresh the duration";
  return `Single Activation; expires at ${expiration}; ${retrigger}`;
}

export function triggeredEffectSummary(value) {
  const setting = normalizeTriggeredEffect(value);
  const trigger = triggerSummary(setting);
  const effects = setting.effects.map(effect => payloadSummary(effect, setting)).join("; ");
  return `Trigger: ${trigger}. Effect: ${effects}. Frequency: ${frequencySummary(setting)}. Application: ${applicationSummary(setting)}.`;
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
