import { MODULE_ID, MODULE_VERSION } from "../constants.mjs";
import { progressionVariants, selectProgressionTier, settingHasProgression, stripProgressionMetadata, variantLevel } from "./level-progression.mjs";
import { applyRarityPrice, normalizeRarityKey } from "../core/materialization/pricing.mjs";
import { MATERIALIZATION_ENGINE_VERSION, canonicalizeItemName } from "../core/materialization/index.mjs";

const MODES = () => CONST.ACTIVE_EFFECT_MODES;

function finalizeRarityAndPricing(data, draft) {
  data.system ??= {};
  data.system.identified = data.system.identified !== false;
  const rarity = normalizeRarityKey(data.system.rarity);
  if (rarity === "none") {
    data.system.rarity = "";
    return { mode: "none", rarity: "none", applied: false };
  }
  data.system.rarity = rarity;

  const manualPrice = draft?.customized?.price === true;
  const templatePrice = Math.max(0, Number(draft?.template?.system?.price?.value ?? 0) || 0);
  const templateRarity = normalizeRarityKey(draft?.template?.system?.rarity);
  const templateMagical = templateRarity !== "none" || valuesOf(draft?.template?.system?.properties).includes("mgc");

  if (manualPrice) {
    return {
      mode: "manual",
      rarity,
      applied: false,
      value: Math.max(0, Number(data.system.price?.value ?? 0) || 0),
      denomination: data.system.price?.denomination || "gp"
    };
  }
  if (templateMagical && templatePrice > 0) {
    return {
      mode: "native",
      rarity,
      applied: false,
      value: templatePrice,
      denomination: data.system.price?.denomination || draft?.template?.system?.price?.denomination || "gp"
    };
  }

  const result = applyRarityPrice(data, { force: true, preserveExisting: false });
  return {
    mode: result.priceless ? "priceless" : "rarity-profile",
    rarity,
    ...result
  };
}


function finalizeCoreIdentity(data) {
  const resolved = canonicalizeItemName(data?.name, { fallbackName: data?.name });
  if (resolved.ok) data.name = resolved.name;
  return {
    version: MATERIALIZATION_ENGINE_VERSION,
    mode: "manual-builder",
    canonicalName: resolved.ok
  };
}

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

function plain(value) {
  return JSON.parse(JSON.stringify(value, (_key, entry) => entry instanceof Set ? [...entry] : entry));
}

function objectActivities(item) {
  const source = item?.system?.activities;
  if (source?.toObject instanceof Function) return source.toObject();
  if (source instanceof Map) return Object.fromEntries([...source.entries()].map(([id, activity]) => [id, activity.toObject?.() ?? clone(activity)]));
  return clone(source ?? {});
}

function objectEffects(item) {
  return valuesOf(item?.effects).map(effect => effect?.toObject?.() ?? clone(effect)).filter(Boolean);
}

function firstActivity(item, type) {
  return valuesOf(item?.system?.activities).find(activity => activity?.type === type) ?? null;
}

function appendFormula(original, value) {
  const left = String(original ?? "").trim();
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return left;
  if (!left) return String(numeric);
  return `${left} ${numeric < 0 ? "-" : "+"} ${Math.abs(numeric)}`;
}

function damagePart({ number = 0, denomination = 0, bonus = "", damageType = "", ability = null } = {}) {
  let formula = String(bonus ?? "").trim();
  if (ability) {
    const abilityFormula = ability === "attack" ? "@mod"
      : ability === "spellcasting" ? "@abilities[@attributes.spellcasting].mod"
        : `@abilities.${ability}.mod`;
    formula = formula ? `${formula} + ${abilityFormula}` : abilityFormula;
  }
  return {
    number: Number(number) || 0,
    denomination: Number(denomination) || 0,
    bonus: formula,
    types: damageType ? [damageType] : [],
    custom: { enabled: false, formula: "" },
    scaling: { mode: "", number: 1, formula: "" }
  };
}

function stripTransientIndices(value) {
  if (Array.isArray(value)) return value.map(entry => stripTransientIndices(entry));
  if (!value || typeof value !== "object") return value;

  const clean = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "_index") continue;
    clean[key] = stripTransientIndices(entry);
  }
  return clean;
}

function cleanDocumentSource(source) {
  return stripTransientIndices(clone(source ?? {}));
}

function sanitizeDocumentData(source) {
  const data = cleanDocumentSource(source);
  for (const key of ["_id", "folder", "sort", "ownership", "_stats", "pack"]) delete data[key];
  data.flags ??= {};
  data.system ??= {};
  data.effects = (data.effects ?? []).map(effect => {
    const clean = cleanDocumentSource(effect);
    delete clean.origin;
    return clean;
  });
  return data;
}

function effectData({ key, label, availability, changes, description = "", progression = null }) {
  return {
    _id: foundry.utils.randomID(),
    type: "base",
    name: `Item Creator — ${label}`,
    img: "systems/dnd5e/icons/svg/documents/active-effect.svg",
    description,
    disabled: false,
    transfer: false,
    statuses: [],
    changes,
    flags: {
      [MODULE_ID]: {
        blueprint: true,
        key,
        availability,
        ...(progression ? {
          unlockOnLevel: Boolean(progression.unlockOnLevel),
          unlockLevel: Number(progression.unlockLevel) || 1,
          progressionGroupId: progression.progressionGroupId,
          progressionTierId: progression.tierId ?? "base",
          progressionTierOrder: Number(progression.tierOrder) || 0
        } : {})
      }
    }
  };
}

function buildImportedCustomContent(customEffects = [], customActivities = []) {
  const effectIdMap = new Map();
  const effects = [];
  for (const entry of customEffects ?? []) {
    if (entry?.included === false || !entry?.data) continue;
    const effect = cleanDocumentSource(entry.data);
    const id = foundry.utils.randomID();
    if (entry.sourceId) effectIdMap.set(entry.sourceId, id);
    effect._id = id;
    delete effect.origin;
    effect.disabled = Boolean(entry.disabled);
    effect.flags ??= {};
    effect.flags[MODULE_ID] = {
      ...(effect.flags[MODULE_ID] ?? {}),
      importedCustom: true,
      importedSourceId: entry.sourceId ?? null,
      normalizedByCreator: true
    };
    effects.push(effect);
  }

  const activities = [];
  for (const entry of customActivities ?? []) {
    if (entry?.included === false || entry?.disabled || !entry?.data) continue;
    const activity = cleanDocumentSource(entry.data);
    activity._id = foundry.utils.randomID();
    activity.effects = valuesOf(activity.effects).map(reference => {
      const sourceId = reference?._id ?? reference?.id;
      const mappedId = effectIdMap.get(sourceId);
      return mappedId ? { ...clone(reference), _id: mappedId } : clone(reference);
    });
    activity.flags ??= {};
    activity.flags[MODULE_ID] = {
      ...(activity.flags[MODULE_ID] ?? {}),
      importedCustom: true,
      importedSourceId: entry.sourceId ?? null,
      normalizedByCreator: true
    };
    activities.push(activity);
  }
  return { effects, activities, effectIdMap };
}

function addChange(changes, key, mode, value, priority) {
  if (value === null || value === undefined || value === "") return;
  changes.push({ key, mode, value: String(value), ...(priority ? { priority } : {}) });
}

function expandAbilities(target) {
  return target === "all" ? Object.keys(CONFIG.DND5E.abilities ?? {}) : [target];
}

function expandSkills(target) {
  return target === "all" ? Object.keys(CONFIG.DND5E.skills ?? {}) : [target];
}

function buildGrantedEffects(enabled, values) {
  const effects = [];
  const addEffect = (key, label, availability, changes, description = "") => {
    if (!changes.length) return;
    const setting = values[key] ?? {};
    effects.push(effectData({
      key, label, availability, changes, description,
      progression: {
        unlockOnLevel: Boolean(setting.unlockOnLevel),
        unlockLevel: Number(setting.unlockLevel) || 1,
        progressionGroupId: setting.progressionGroupId || `effect:${key}`,
        tierId: "base", tierOrder: 0
      }
    }));
  };
  const add = MODES().ADD;
  const override = MODES().OVERRIDE;
  const upgrade = MODES().UPGRADE;

  if (enabled.armorClassBonus) {
    const changes = [];
    addChange(changes, "system.attributes.ac.bonus", add, values.armorClassBonus.bonus);
    addEffect("armorClassBonus", "Armor Class Bonus", values.armorClassBonus.availability, changes);
  }

  if (enabled.weaponAttackBonus) {
    const changes = [];
    addChange(changes, "system.bonuses.mwak.attack", add, values.weaponAttackBonus.bonus);
    addChange(changes, "system.bonuses.rwak.attack", add, values.weaponAttackBonus.bonus);
    addEffect("weaponAttackBonus", "Weapon Attack Roll Bonus", values.weaponAttackBonus.availability, changes);
  }

  if (enabled.weaponDamageBonus) {
    const changes = [];
    addChange(changes, "system.bonuses.mwak.damage", add, values.weaponDamageBonus.bonus);
    addChange(changes, "system.bonuses.rwak.damage", add, values.weaponDamageBonus.bonus);
    addEffect("weaponDamageBonus", "Weapon Damage Roll Bonus", values.weaponDamageBonus.availability, changes);
  }

  if (enabled.savingThrowBonus) {
    const changes = [];
    for (const row of values.savingThrowBonus.entries ?? []) {
      for (const ability of expandAbilities(row.target)) addChange(changes, `system.abilities.${ability}.bonuses.save`, add, row.bonus);
    }
    addEffect("savingThrowBonus", "Saving Throw Bonus", values.savingThrowBonus.availability, changes);
  }

  if (enabled.savingThrowAdvantage) {
    const changes = [];
    for (const row of values.savingThrowAdvantage.entries ?? []) {
      for (const ability of expandAbilities(row.target)) addChange(changes, `system.abilities.${ability}.save.roll.mode`, add, 1);
    }
    addEffect("savingThrowAdvantage", "Saving Throw Advantage", values.savingThrowAdvantage.availability, changes);
  }

  if (enabled.abilityScoreAdjustment) {
    const changes = [];
    for (const row of values.abilityScoreAdjustment.entries ?? []) {
      const mode = row.operation === "minimum" ? upgrade : row.operation === "fixed" ? override : add;
      addChange(changes, `system.abilities.${row.ability}.value`, mode, row.value);
    }
    addEffect("abilityScoreAdjustment", "Ability Score Adjustment", values.abilityScoreAdjustment.availability, changes);
  }

  if (enabled.abilityCheckBonus) {
    const changes = [];
    for (const row of values.abilityCheckBonus.entries ?? []) {
      for (const ability of expandAbilities(row.target)) addChange(changes, `system.abilities.${ability}.bonuses.check`, add, row.bonus);
    }
    addEffect("abilityCheckBonus", "Ability Check Bonus", values.abilityCheckBonus.availability, changes);
  }

  if (enabled.skillBonus) {
    const changes = [];
    for (const row of values.skillBonus.entries ?? []) {
      for (const skill of expandSkills(row.target)) addChange(changes, `system.skills.${skill}.bonuses.check`, add, row.bonus);
    }
    addEffect("skillBonus", "Skill Bonus", values.skillBonus.availability, changes);
  }

  if (enabled.skillProficiency) {
    const changes = [];
    for (const row of values.skillProficiency.entries ?? []) {
      addChange(changes, `system.skills.${row.skill}.value`, upgrade, row.level === "expertise" ? 2 : 1);
    }
    addEffect("skillProficiency", "Skill Proficiency", values.skillProficiency.availability, changes);
  }

  if (enabled.abilityCheckAdvantage) {
    const changes = [];
    for (const row of values.abilityCheckAdvantage.entries ?? []) {
      if (row.target === "all") {
        for (const ability of Object.keys(CONFIG.DND5E.abilities ?? {})) addChange(changes, `system.abilities.${ability}.check.roll.mode`, add, 1);
      } else if (row.target?.startsWith("ability:")) {
        addChange(changes, `system.abilities.${row.target.slice(8)}.check.roll.mode`, add, 1);
      } else if (row.target?.startsWith("skill:")) {
        addChange(changes, `system.skills.${row.target.slice(6)}.roll.mode`, add, 1);
      }
    }
    addEffect("abilityCheckAdvantage", "Ability Check Advantage", values.abilityCheckAdvantage.availability, changes);
  }

  for (const [key, path, label] of [
    ["damageResistance", "dr", "Damage Resistance"],
    ["damageImmunity", "di", "Damage Immunity"],
    ["damageVulnerability", "dv", "Damage Vulnerability"]
  ]) {
    if (!enabled[key]) continue;
    const changes = [];
    for (const type of values[key].damageTypes ?? []) addChange(changes, `system.traits.${path}.value`, add, type);
    addEffect(key, label, values[key].availability, changes);
  }

  if (enabled.conditionImmunity) {
    const changes = [];
    for (const condition of values.conditionImmunity.conditions ?? []) addChange(changes, "system.traits.ci.value", add, condition);
    addEffect("conditionImmunity", "Condition Immunity", values.conditionImmunity.availability, changes);
  }

  if (enabled.initiativeBonus) {
    const changes = [];
    addChange(changes, "system.attributes.init.bonus", add, values.initiativeBonus.bonus);
    addEffect("initiativeBonus", "Initiative Bonus", values.initiativeBonus.availability, changes);
  }

  if (enabled.initiativeAdvantage) {
    const changes = [];
    addChange(changes, "system.attributes.init.roll.mode", add, 1);
    addEffect("initiativeAdvantage", "Initiative Advantage", values.initiativeAdvantage.availability, changes);
  }

  if (enabled.proficiencyBonusModifier) {
    const changes = [];
    addChange(changes, "system.attributes.prof", add, values.proficiencyBonusModifier.bonus);
    addEffect("proficiencyBonusModifier", "Proficiency Bonus Modifier", values.proficiencyBonusModifier.availability, changes);
  }

  if (enabled.maximumHitPointsBonus) {
    const changes = [];
    addChange(changes, "system.attributes.hp.bonuses.overall", add, values.maximumHitPointsBonus.bonus);
    addEffect("maximumHitPointsBonus", "Maximum Hit Points Bonus", values.maximumHitPointsBonus.availability, changes);
  }

  if (enabled.movementBonus) {
    const changes = [];
    for (const row of values.movementBonus.entries ?? []) addChange(changes, `system.attributes.movement.${row.type}`, add, row.bonus);
    addEffect("movementBonus", "Movement Bonus", values.movementBonus.availability, changes);
  }

  if (enabled.grantMovementType) {
    const changes = [];
    for (const row of values.grantMovementType.entries ?? []) {
      addChange(changes, `system.attributes.movement.${row.type}`, upgrade, row.speed);
      if (row.type === "fly" && row.hover) addChange(changes, "system.attributes.movement.hover", override, true);
    }
    addEffect("grantMovementType", "Granted Movement Type", values.grantMovementType.availability, changes);
  }

  if (enabled.grantedSense) {
    const changes = [];
    for (const row of values.grantedSense.entries ?? []) {
      const mode = row.operation === "add" ? add : row.operation === "fixed" ? override : upgrade;
      addChange(changes, `system.attributes.senses.ranges.${row.sense}`, mode, row.range);
    }
    addEffect("grantedSense", "Granted Sense", values.grantedSense.availability, changes);
  }

  if (enabled.spellAttackBonus) {
    const changes = [];
    addChange(changes, "system.bonuses.msak.attack", add, values.spellAttackBonus.bonus);
    addChange(changes, "system.bonuses.rsak.attack", add, values.spellAttackBonus.bonus);
    addEffect("spellAttackBonus", "Spell Attack Bonus", values.spellAttackBonus.availability, changes);
  }

  if (enabled.spellSaveDcBonus) {
    const changes = [];
    addChange(changes, "system.bonuses.spell.dc", add, values.spellSaveDcBonus.bonus);
    addEffect("spellSaveDcBonus", "Spell Save DC Bonus", values.spellSaveDcBonus.availability, changes);
  }

  if (enabled.criticalThreshold) {
    const changes = [];
    const threshold = Math.min(20, Math.max(1, Number(values.criticalThreshold?.threshold) || 20));
    const scope = values.criticalThreshold?.scope ?? "all";
    if (scope === "all" || scope === "weapon") addChange(changes, "flags.dnd5e.weaponCriticalThreshold", MODES().DOWNGRADE, threshold);
    if (scope === "all" || scope === "spell") addChange(changes, "flags.dnd5e.spellCriticalThreshold", MODES().DOWNGRADE, threshold);
    addEffect("criticalThreshold", "Actor Critical Threshold", values.criticalThreshold.availability, changes);
  }

  if (enabled.passiveScoreBonus) {
    const changes = [];
    const scoreSkills = { perception: "prc", investigation: "inv", insight: "ins" };
    for (const row of values.passiveScoreBonus.entries ?? []) {
      const skill = scoreSkills[row.score];
      if (skill) addChange(changes, `system.skills.${skill}.bonuses.passive`, add, row.bonus);
    }
    addEffect("passiveScoreBonus", "Passive Score Bonus", values.passiveScoreBonus.availability, changes);
  }

  const tierLabels = {
    armorClassBonus: "Armor Class Bonus",
    weaponAttackBonus: "Weapon Attack Roll Bonus",
    weaponDamageBonus: "Weapon Damage Roll Bonus",
    initiativeBonus: "Initiative Bonus",
    proficiencyBonusModifier: "Proficiency Bonus Modifier",
    maximumHitPointsBonus: "Maximum Hit Points Bonus",
    spellAttackBonus: "Spell Attack Bonus",
    spellSaveDcBonus: "Spell Save DC Bonus"
  };
  const tierChanges = (key, tier) => {
    const changes = [];
    if (key === "armorClassBonus") addChange(changes, "system.attributes.ac.bonus", add, tier.bonus);
    if (key === "weaponAttackBonus") {
      addChange(changes, "system.bonuses.mwak.attack", add, tier.bonus);
      addChange(changes, "system.bonuses.rwak.attack", add, tier.bonus);
    }
    if (key === "weaponDamageBonus") {
      addChange(changes, "system.bonuses.mwak.damage", add, tier.bonus);
      addChange(changes, "system.bonuses.rwak.damage", add, tier.bonus);
    }
    if (key === "initiativeBonus") addChange(changes, "system.attributes.init.bonus", add, tier.bonus);
    if (key === "proficiencyBonusModifier") addChange(changes, "system.attributes.prof", add, tier.bonus);
    if (key === "maximumHitPointsBonus") addChange(changes, "system.attributes.hp.bonuses.overall", add, tier.bonus);
    if (key === "spellAttackBonus") {
      addChange(changes, "system.bonuses.msak.attack", add, tier.bonus);
      addChange(changes, "system.bonuses.rsak.attack", add, tier.bonus);
    }
    if (key === "spellSaveDcBonus") addChange(changes, "system.bonuses.spell.dc", add, tier.bonus);
    return changes;
  };
  for (const [key, label] of Object.entries(tierLabels)) {
    if (!enabled[key]) continue;
    const setting = values[key] ?? {};
    for (const [index, tier] of (setting.tiers ?? []).entries()) {
      const changes = tierChanges(key, tier);
      if (!changes.length) continue;
      effects.push(effectData({
        key, label: `${label} — Tier ${index + 2}`,
        availability: tier.availability ?? setting.availability ?? "equipped",
        changes,
        progression: {
          unlockOnLevel: true,
          unlockLevel: Number(tier.unlockLevel) || 1,
          progressionGroupId: setting.progressionGroupId || `effect:${key}`,
          tierId: tier.id ?? `tier-${index + 1}`,
          tierOrder: index + 1
        }
      }));
    }
  }

  return effects;
}

function activitySource(activity) {
  if (!activity) return null;
  if (activity._source && typeof activity._source === "object") return clone(activity._source);
  if (activity.toObject instanceof Function) {
    try { return clone(activity.toObject(false)); } catch (_error) { /* Fall through. */ }
    try { return clone(activity.toObject()); } catch (_error) { /* Fall through. */ }
  }
  return clone(activity);
}

function primaryAttackData(baseWeapon, template) {
  const baseAttack = firstActivity(baseWeapon, "attack");
  const templateAttack = firstActivity(template, "attack");
  const source = activitySource(baseAttack) ?? activitySource(templateAttack) ?? {
    _id: foundry.utils.randomID(), type: "attack", name: "Attack",
    attack: { ability: "", bonus: "", critical: { threshold: null }, flat: false, type: { value: "", classification: "weapon" } },
    damage: { critical: { bonus: "" }, includeBase: true, parts: [] }
  };
  source._id = foundry.utils.randomID();
  source.type = "attack";
  source.name ||= "Attack";
  source.attack ??= {};
  source.attack.critical ??= {};
  source.attack.type ??= {};
  source.damage ??= {};
  source.damage.critical ??= {};
  source.damage.parts ??= [];
  source.damage.includeBase = true;

  // A normal weapon Attack Activity must never consume a Spell Slot merely because
  // the special Template also contains Cast Activities or spell-related metadata.
  source.consumption ??= {};
  source.consumption.spellSlot = false;
  source.consumption.targets = (source.consumption.targets ?? []).filter(target => target?.type !== "spellSlots");

  // Preserve special non-base damage configured on the Template attack.
  if (templateAttack) {
    const templateSource = activitySource(templateAttack) ?? {};
    source.damage.parts = clone(templateSource.damage?.parts ?? []);
    source.description = clone(templateSource.description ?? source.description ?? {});
    source.activation = clone(templateSource.activation ?? source.activation ?? {});
    source.effects = clone(templateSource.effects ?? source.effects ?? []);
  }
  return source;
}

function recoveryData(spell) {
  if (spell.useLimit !== "limited") return { uses: { spent: 0, max: "", recovery: [] }, targets: [] };
  const period = spell.recovery === "shortRest" ? "sr" : "lr";
  return {
    uses: { spent: 0, max: String(Number(spell.maxUses) || 1), recovery: [{ period, type: "recoverAll", formula: "" }] },
    targets: [{ type: "activityUses", target: "", value: "1", scaling: { mode: "", formula: "" } }]
  };
}

function availabilityFlags(availability) {
  return {
    requireAttunement: availability === "equippedAttuned",
    requireIdentification: false,
    // Item Creator owns availability through Owned / Equipped / Equipped and
    // Attuned. Native requireMagic must not add a second hidden gate.
    requireMagic: false,
    level: { min: null, max: null }
  };
}

async function buildCastActivities(parentItem, spells = []) {
  const activities = [];
  for (const spell of spells) {
    const ActivityClass = CONFIG.DND5E.activityTypes?.cast?.documentClass;
    const recovery = recoveryData(spell);
    const ability = ["int", "wis", "cha"].includes(spell.spellcastingMode) ? spell.spellcastingMode : "";
    const fixedChallenge = spell.spellcastingMode === "fixed";
    const castLevel = spell.castLevelMode === "fixed" ? Number(spell.fixedCastLevel) : Number(spell.level);
    const consumptionTargets = [...recovery.targets];
    if (spell.consumeSlot && Number(spell.level) > 0) consumptionTargets.push({
      type: "spellSlots",
      target: String(Math.max(1, castLevel || Number(spell.level) || 1)),
      value: "1",
      scaling: { mode: spell.castLevelMode === "slot" ? "level" : "", formula: "" }
    });
    const source = {
      _id: foundry.utils.randomID(),
      type: "cast",
      name: spell.name,
      img: spell.img,
      consumption: {
        scaling: { allowed: spell.castLevelMode === "slot", max: spell.castLevelMode === "slot" ? String(9 - Number(spell.level)) : "" },
        spellSlot: false,
        targets: consumptionTargets
      },
      spell: {
        ability,
        challenge: {
          attack: fixedChallenge && spell.hasAttack ? Number(spell.fixedAttackBonus) : null,
          save: fixedChallenge && spell.hasSave ? Number(spell.fixedSaveDc) : null,
          override: fixedChallenge
        },
        level: castLevel,
        properties: [],
        // Conditional spellbook display is controlled by the Item Creator runtime.
        // D&D5e caches linked spells for every Cast Activity, but only lists a
        // cached spell when this field is true. World items therefore start
        // conditional grants hidden until their Actor copy becomes available.
        spellbook: Boolean(spell.showInSpellbook && spell.availability === "owned" && !spell.unlockOnLevel),
        uuid: spell.uuid
      },
      uses: recovery.uses,
      visibility: availabilityFlags(spell.availability),
      flags: {
        [MODULE_ID]: {
          grantedSpell: true,
          sourceSpellUuid: spell.uuid,
          showInSpellbook: Boolean(spell.showInSpellbook),
          eligibility: spell.eligibility,
          consumeSlot: Boolean(spell.consumeSlot),
          availability: spell.availability,
          spellcastingMode: spell.spellcastingMode,
          baseLevel: Number(spell.level),
          castLevelMode: spell.castLevelMode,
          unlockOnLevel: Boolean(spell.unlockOnLevel),
          unlockLevel: Number(spell.unlockLevel) || 1,
          progressionGroupId: spell.progressionGroupId || `spell:${spell.uuid}`
        }
      }
    };
    if (ActivityClass) {
      try {
        const activity = new ActivityClass(source, { parent: parentItem });
        activities.push(activity.toObject());
        continue;
      } catch (error) {
        console.warn(`${MODULE_ID} | Falling back to raw Cast Activity data.`, error);
      }
    }
    activities.push(source);
  }
  return activities;
}


function escapeHTML(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function ordinalLevel(level) {
  const numeric = Number(level) || 0;
  if (numeric === 0) return "cantrip";
  const mod100 = numeric % 100;
  const mod10 = numeric % 10;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th"
    : mod10 === 1 ? "st"
      : mod10 === 2 ? "nd"
        : mod10 === 3 ? "rd" : "th";
  return `${numeric}${suffix} level`;
}

function spellReference(spell) {
  const name = escapeHTML(spell.name || "Spell");
  const uuid = String(spell.uuid ?? "").trim();
  return uuid ? `@UUID[${uuid}]{${name}}` : name;
}

function availabilityLead(availability) {
  return {
    owned: "While you possess this item",
    equipped: "While this item is equipped",
    equippedAttuned: "While this item is equipped and you are attuned to it"
  }[availability] ?? "While this item is equipped";
}

function useCountPhrase(maxUses) {
  const count = Math.max(1, Number(maxUses) || 1);
  if (count === 1) return "once";
  if (count === 2) return "twice";
  return `up to ${count} times`;
}

function recoveryPhrase(recovery) {
  return recovery === "shortRest" ? "a Short Rest" : "a Long Rest";
}

function spellcastingSentence(spell) {
  switch (spell.spellcastingMode) {
    case "highest":
      return "Use your highest available spellcasting ability for this spell.";
    case "int":
      return "Intelligence is your spellcasting ability for this spell, and you add your proficiency bonus to its spell attack rolls and saving throw DC.";
    case "wis":
      return "Wisdom is your spellcasting ability for this spell, and you add your proficiency bonus to its spell attack rolls and saving throw DC.";
    case "cha":
      return "Charisma is your spellcasting ability for this spell, and you add your proficiency bonus to its spell attack rolls and saving throw DC.";
    case "fixed": {
      const parts = [];
      if (spell.hasAttack) parts.push(`its spell attack bonus is ${Number(spell.fixedAttackBonus) >= 0 ? "+" : ""}${Number(spell.fixedAttackBonus) || 0}`);
      if (spell.hasSave) parts.push(`its spell save DC is ${Number(spell.fixedSaveDc) || 0}`);
      if (!parts.length) return "This spell uses the item's own magic and requires no spell attack roll or saving throw DC.";
      return `This spell uses the item's own magic; ${parts.join(" and ")}.`;
    }
    case "actorDefault":
    default:
      return "Use your default spellcasting ability for this spell.";
  }
}

function castLevelSentence(spell) {
  const level = Number(spell.level) || 0;
  if (level === 0) return "";
  if (spell.castLevelMode === "fixed") return `The spell is cast at ${ordinalLevel(spell.fixedCastLevel)}.`;
  if (spell.castLevelMode === "slot") return "The spell is cast at the level of the spell slot expended.";
  return `The spell is cast at its base level (${ordinalLevel(level)}).`;
}

function eligibilitySentence(spell) {
  const level = Number(spell.level) || 0;
  if (spell.eligibility === "spellLevelAccess") {
    return level === 0
      ? "You can use this property only if you have access to cantrips."
      : `You can use this property only if you have access to spells of ${ordinalLevel(level)} or higher.`;
  }
  if (spell.eligibility === "compatibleSlot") {
    return level === 0 ? "" : `You must have a compatible spell slot of ${ordinalLevel(level)} or higher available.`;
  }
  return "You do not need to know the spell or have the Spellcasting feature to cast it through this item.";
}

function spellbookSentence(spell) {
  if (!spell.showInSpellbook) return "";
  if (Number(spell.level) === 0) {
    return "The cantrip is always available to you and does not count against the number of cantrips you know.";
  }
  return "The spell is always available to you through this item and does not count against your spells known or prepared.";
}

function useSentence(spell) {
  const level = Number(spell.level) || 0;
  const slotLevel = Math.max(1, Number(spell.fixedCastLevel) || level || 1);
  const slotRequirement = `a spell slot of ${ordinalLevel(slotLevel)} or higher`;

  if (spell.useLimit === "limited") {
    const count = useCountPhrase(spell.maxUses);
    const rest = recoveryPhrase(spell.recovery);
    if (spell.consumeSlot && level > 0) {
      return `You can cast it ${count}. Each casting also requires you to expend ${slotRequirement}. You regain all expended uses when you finish ${rest}.`;
    }
    return `You can cast it ${count} without expending a spell slot. You regain all expended uses when you finish ${rest}.`;
  }

  if (spell.consumeSlot && level > 0) {
    return `You can cast it by expending ${slotRequirement}; this item imposes no additional limit on the number of times you can cast it.`;
  }
  return "You can cast it at will without expending a spell slot.";
}

function fullGrantedSpellText(spell) {
  const level = Number(spell.level) || 0;
  const lead = availabilityLead(spell.availability);
  const grant = level === 0
    ? `${lead}, this item grants you the ${spellReference(spell)} cantrip.`
    : `${lead}, this item grants you access to ${spellReference(spell)}.`;
  return [
    grant,
    spellbookSentence(spell),
    useSentence(spell),
    eligibilitySentence(spell),
    castLevelSentence(spell),
    spellcastingSentence(spell)
  ].filter(Boolean).join(" ");
}

function chatGrantedSpellText(spell) {
  const availability = {
    owned: "while owned",
    equipped: "while equipped",
    equippedAttuned: "while equipped and attuned"
  }[spell.availability] ?? "while equipped";
  const uses = spell.useLimit === "limited"
    ? `${useCountPhrase(spell.maxUses)} per ${spell.recovery === "shortRest" ? "Short Rest" : "Long Rest"}`
    : "at will";
  const slot = spell.consumeSlot && Number(spell.level) > 0 ? "consumes a compatible spell slot" : "does not expend a spell slot";
  return `${spellReference(spell)} — ${availability}; ${uses}; ${slot}.`;
}

function stripGeneratedSection(html, key) {
  const source = String(html ?? "");
  const host = globalThis.document?.createElement?.("div");
  if (host) {
    host.innerHTML = source;
    host.querySelectorAll(`[data-item-creator-generated="${key}"]`).forEach(node => node.remove());
    return host.innerHTML.trim();
  }
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.replace(new RegExp(`<section[^>]*data-item-creator-generated=["']${escaped}["'][^>]*>[\\s\\S]*?<\\/section>`, "gi"), "").trim();
}

function appendGeneratedSection(existing, section) {
  const base = String(existing ?? "").trim();
  return `${base}${base ? "\n" : ""}${section}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function configLabel(config, key, fallback = key) {
  const entry = config?.[key];
  const label = typeof entry === "string" ? entry : entry?.label;
  return label ? game.i18n.localize(label) : fallback;
}

function signedValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value ?? "");
  return numeric > 0 ? `+${numeric}` : String(numeric);
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function availabilityTitle(availability) {
  return {
    item: "Item Properties",
    weapon: "Item Properties",
    owned: "While Owned",
    equipped: "While Equipped",
    equippedAttuned: "While Equipped and Attuned"
  }[availability] ?? "While Active";
}

function availabilityChatSuffix(availability) {
  return {
    item: "",
    weapon: "",
    owned: " while owned",
    equipped: " while equipped",
    equippedAttuned: " while equipped and attuned"
  }[availability] ?? " while active";
}

function abilityLabel(key) {
  return key === "all" ? "All" : configLabel(CONFIG.DND5E.abilities, key, titleCase(key));
}

function skillLabel(key) {
  return key === "all" ? "All Skills" : configLabel(CONFIG.DND5E.skills, key, titleCase(key));
}

function damageTypeLabel(key) {
  return configLabel(CONFIG.DND5E.damageTypes, key, titleCase(key));
}

function conditionLabel(key) {
  return configLabel(CONFIG.DND5E.conditionTypes, key, titleCase(key));
}

function movementLabel(key) {
  return configLabel(CONFIG.DND5E.movementTypes, key, titleCase(key));
}

function senseLabel(key) {
  const source = CONFIG.DND5E.senses ?? CONFIG.DND5E.senseTypes;
  return configLabel(source, key, titleCase(key));
}

function formatRows(rows, formatter) {
  return (rows ?? []).map(formatter).filter(Boolean).join("; ");
}

function itemPropertyEntries(draft) {
  const entries = [];
  const add = (label, value, availability = "item") => {
    const text = String(value ?? "").trim();
    if (text) entries.push({ label, value: text, availability });
  };
  const enhancements = draft.enhancements ?? {};
  const enhancementValues = draft.enhancementValues ?? {};
  const effects = draft.grantedEffects ?? {};
  const effectValues = draft.grantedEffectValues ?? {};

  if (draft.customized?.additionalDamage) {
    const text = formatRows((draft.effective?.additionalDamage ?? draft.overrides?.additionalDamage ?? []).filter(row => !settingHasProgression(row)), row => {
      const ability = row.useAbilityModifier
        ? row.ability === "attack" ? " + attack ability modifier"
          : row.ability === "spellcasting" ? " + spellcasting ability modifier"
            : ` + ${abilityLabel(row.ability)} modifier`
        : "";
      return `${Number(row.number) || 0}d${Number(row.denomination) || 0}${ability} ${damageTypeLabel(row.damageType)}`;
    });
    add("Additional Damage", text ? `${text} on a hit` : "");
  }

  if (enhancements.magicalWeapon && !settingHasProgression(enhancementValues.magicalWeapon)) {
    const setting = enhancementValues.magicalWeapon ?? {};
    const rarity = configLabel(CONFIG.DND5E.itemRarity, setting.rarity, titleCase(setting.rarity));
    const attunement = setting.attunement === "required" ? "; requires attunement" : "";
    add("Magical Weapon", `${rarity || "Magical"}${attunement}`);
  }
  if (enhancements.magicalItem && !settingHasProgression(enhancementValues.magicalItem)) {
    const setting = enhancementValues.magicalItem ?? {};
    const rarity = configLabel(CONFIG.DND5E.itemRarity, setting.rarity, titleCase(setting.rarity));
    const attunement = setting.attunement === "required" ? "; requires attunement" : "";
    add("Magical Equipment", `${rarity || "Magical"}${attunement}`);
  }
  if (enhancements.magicalTool && !settingHasProgression(enhancementValues.magicalTool)) {
    const setting = enhancementValues.magicalTool ?? {};
    const rarity = configLabel(CONFIG.DND5E.itemRarity, setting.rarity, titleCase(setting.rarity));
    const attunement = setting.attunement === "required" ? "; requires attunement" : "";
    add("Magical Tool", `${rarity || "Magical"}${attunement}`);
  }
  if (enhancements.armorEnhancement && !settingHasProgression(enhancementValues.armorEnhancement)) add("Armor Enhancement", `${signedValue(enhancementValues.armorEnhancement?.bonus)} AC`);
  if (enhancements.baseArmorClass && !settingHasProgression(enhancementValues.baseArmorClass)) add("Base Armor Class", String(Number(enhancementValues.baseArmorClass?.value) || 0));
  if (enhancements.removeStrengthRequirement && !settingHasProgression(enhancementValues.removeStrengthRequirement)) add("Strength Requirement", "Removed");
  if (enhancements.removeStealthDisadvantage && !settingHasProgression(enhancementValues.removeStealthDisadvantage)) add("Stealth Disadvantage", "Removed");
  if (enhancements.weaponEnhancement && !settingHasProgression(enhancementValues.weaponEnhancement)) add("Weapon Enhancement", `${signedValue(enhancementValues.weaponEnhancement?.bonus)} to attack and damage rolls`);
  if (enhancements.attackBonus && !settingHasProgression(enhancementValues.attackBonus)) add("Attack Roll Bonus", `${signedValue(enhancementValues.attackBonus?.bonus)} to attack rolls`);
  if (enhancements.damageBonus && !settingHasProgression(enhancementValues.damageBonus)) add("Damage Roll Bonus", `${signedValue(enhancementValues.damageBonus?.bonus)} to damage rolls`);
  if (enhancements.criticalThreshold && !settingHasProgression(enhancementValues.criticalThreshold)) {
    const setting = enhancementValues.criticalThreshold ?? {};
    const threshold = Number(setting.mode === "custom" ? setting.custom : setting.mode) || 20;
    add("Weapon Critical Threshold", threshold === 20 ? "Critical hit on a 20 with this Weapon" : `Critical hit on ${threshold}–20 with this Weapon`);
  }
  if (enhancements.extraCriticalDamage && !settingHasProgression(enhancementValues.extraCriticalDamage)) {
    const setting = enhancementValues.extraCriticalDamage ?? {};
    add("Extra Critical Damage", `${Number(setting.number) || 1}d${Number(setting.denomination) || 8} ${damageTypeLabel(setting.damageType)}`);
  }
  if (enhancements.ignoreResistance && !settingHasProgression(enhancementValues.ignoreResistance)) {
    const labels = (enhancementValues.ignoreResistance?.damageTypes ?? []).map(damageTypeLabel);
    add("Ignore Resistance", labels.length ? `${labels.join(", ")} damage ignores resistance, but not immunity` : "");
  }
  if (enhancements.conditionalAdvantage && !settingHasProgression(enhancementValues.conditionalAdvantage)) {
    const setting = enhancementValues.conditionalAdvantage ?? {};
    const condition = setting.mode === "custom" ? setting.customText : {
      targetUndead: "the target is Undead",
      targetFiend: "the target is a Fiend",
      targetBloodied: "the target is below half its Hit Points",
      wielderDimLight: "the wielder is in dim light",
      targetNotActed: "the target has not acted in this combat"
    }[setting.supportedCondition];
    const sourceLabel = draft.itemType === "weapon" ? "with this weapon" : "while this item is active";
    add("Conditional Advantage", condition ? `Advantage on attacks ${sourceLabel} when ${condition}` : "");
  }

  if (effects.armorClassBonus && !settingHasProgression(effectValues.armorClassBonus)) add("Armor Class", `${signedValue(effectValues.armorClassBonus?.bonus)} AC`, effectValues.armorClassBonus?.availability);
  if (effects.weaponAttackBonus && !settingHasProgression(effectValues.weaponAttackBonus)) add("Weapon Attacks", `${signedValue(effectValues.weaponAttackBonus?.bonus)} to all weapon attack rolls`, effectValues.weaponAttackBonus?.availability);
  if (effects.weaponDamageBonus && !settingHasProgression(effectValues.weaponDamageBonus)) add("Weapon Damage", `${signedValue(effectValues.weaponDamageBonus?.bonus)} to all weapon damage rolls`, effectValues.weaponDamageBonus?.availability);
  if (effects.criticalThreshold && !settingHasProgression(effectValues.criticalThreshold)) {
    const setting = effectValues.criticalThreshold ?? {};
    const threshold = Number(setting.threshold) || 20;
    const scope = setting.scope === "weapon" ? "weapon attacks" : setting.scope === "spell" ? "spell attacks" : "weapon and spell attacks";
    add("Actor Critical Threshold", `Critical hit on ${threshold === 20 ? "20" : `${threshold}–20`} for ${scope}`, setting.availability);
  }
  if (effects.savingThrowBonus && !settingHasProgression(effectValues.savingThrowBonus)) add("Saving Throws", formatRows(effectValues.savingThrowBonus?.entries, row => row.target === "all"
    ? `${signedValue(row.bonus)} to all saving throws`
    : `${signedValue(row.bonus)} to ${abilityLabel(row.target)} saving throws`), effectValues.savingThrowBonus?.availability);
  if (effects.savingThrowAdvantage && !settingHasProgression(effectValues.savingThrowAdvantage)) add("Saving Throw Advantage", formatRows(effectValues.savingThrowAdvantage?.entries, row => row.target === "all"
    ? "Advantage on all saving throws"
    : `Advantage on ${abilityLabel(row.target)} saving throws`), effectValues.savingThrowAdvantage?.availability);
  if (effects.abilityScoreAdjustment && !settingHasProgression(effectValues.abilityScoreAdjustment)) add("Ability Scores", formatRows(effectValues.abilityScoreAdjustment?.entries, row => {
    const ability = abilityLabel(row.ability);
    if (row.operation === "fixed") return `${ability} set to ${row.value}`;
    if (row.operation === "minimum") return `${ability} minimum ${row.value}`;
    return `${ability} ${signedValue(row.value)}`;
  }), effectValues.abilityScoreAdjustment?.availability);
  if (effects.abilityCheckBonus && !settingHasProgression(effectValues.abilityCheckBonus)) add("Ability Checks", formatRows(effectValues.abilityCheckBonus?.entries, row => row.target === "all"
    ? `${signedValue(row.bonus)} to all ability checks`
    : `${signedValue(row.bonus)} to ${abilityLabel(row.target)} checks`), effectValues.abilityCheckBonus?.availability);
  if (effects.skillBonus && !settingHasProgression(effectValues.skillBonus)) add("Skill Checks", formatRows(effectValues.skillBonus?.entries, row => row.target === "all"
    ? `${signedValue(row.bonus)} to all skill checks`
    : `${skillLabel(row.target)} ${signedValue(row.bonus)}`), effectValues.skillBonus?.availability);
  if (effects.skillProficiency && !settingHasProgression(effectValues.skillProficiency)) add("Skill Training", formatRows(effectValues.skillProficiency?.entries, row => `${row.level === "expertise" ? "Expertise" : "Proficiency"} in ${skillLabel(row.skill)}`), effectValues.skillProficiency?.availability);
  if (effects.abilityCheckAdvantage && !settingHasProgression(effectValues.abilityCheckAdvantage)) add("Check Advantage", formatRows(effectValues.abilityCheckAdvantage?.entries, row => {
    if (row.target === "all") return "Advantage on all ability checks";
    if (row.target?.startsWith("ability:")) return `Advantage on ${abilityLabel(row.target.slice(8))} checks`;
    if (row.target?.startsWith("skill:")) return `Advantage on ${skillLabel(row.target.slice(6))} checks`;
    return "";
  }), effectValues.abilityCheckAdvantage?.availability);

  for (const [key, label] of [["damageResistance", "Damage Resistance"], ["damageImmunity", "Damage Immunity"], ["damageVulnerability", "Damage Vulnerability"]]) {
    if (!effects[key] || settingHasProgression(effectValues[key])) continue;
    add(label, (effectValues[key]?.damageTypes ?? []).map(damageTypeLabel).join(", "), effectValues[key]?.availability);
  }
  if (effects.conditionImmunity && !settingHasProgression(effectValues.conditionImmunity)) add("Condition Immunity", (effectValues.conditionImmunity?.conditions ?? []).map(conditionLabel).join(", "), effectValues.conditionImmunity?.availability);
  if (effects.initiativeBonus && !settingHasProgression(effectValues.initiativeBonus)) add("Initiative", `${signedValue(effectValues.initiativeBonus?.bonus)} to initiative`, effectValues.initiativeBonus?.availability);
  if (effects.initiativeAdvantage && !settingHasProgression(effectValues.initiativeAdvantage)) add("Initiative Advantage", "Advantage on initiative rolls", effectValues.initiativeAdvantage?.availability);
  if (effects.proficiencyBonusModifier && !settingHasProgression(effectValues.proficiencyBonusModifier)) add("Proficiency Bonus", `${signedValue(effectValues.proficiencyBonusModifier?.bonus)} to the global Proficiency Bonus`, effectValues.proficiencyBonusModifier?.availability);
  if (effects.maximumHitPointsBonus && !settingHasProgression(effectValues.maximumHitPointsBonus)) add("Maximum Hit Points", `${signedValue(effectValues.maximumHitPointsBonus?.bonus)} maximum Hit Points`, effectValues.maximumHitPointsBonus?.availability);
  if (effects.movementBonus && !settingHasProgression(effectValues.movementBonus)) add("Movement", formatRows(effectValues.movementBonus?.entries, row => `${movementLabel(row.type)} speed ${signedValue(row.bonus)} ${row.units ?? "ft"}`), effectValues.movementBonus?.availability);
  if (effects.grantMovementType && !settingHasProgression(effectValues.grantMovementType)) add("Granted Movement", formatRows(effectValues.grantMovementType?.entries, row => `${movementLabel(row.type)} speed minimum ${row.speed} ${row.units ?? "ft"}${row.hover ? " with hover" : ""}`), effectValues.grantMovementType?.availability);
  if (effects.grantedSense && !settingHasProgression(effectValues.grantedSense)) add("Senses", formatRows(effectValues.grantedSense?.entries, row => {
    const operation = row.operation === "add" ? `+${row.range}` : row.operation === "fixed" ? `fixed ${row.range}` : `minimum ${row.range}`;
    return `${senseLabel(row.sense)} ${operation} ${row.units ?? "ft"}`;
  }), effectValues.grantedSense?.availability);
  if (effects.spellAttackBonus && !settingHasProgression(effectValues.spellAttackBonus)) add("Spell Attacks", `${signedValue(effectValues.spellAttackBonus?.bonus)} to spell attack rolls`, effectValues.spellAttackBonus?.availability);
  if (effects.spellSaveDcBonus && !settingHasProgression(effectValues.spellSaveDcBonus)) add("Spell Save DC", `${signedValue(effectValues.spellSaveDcBonus?.bonus)} to Spell Save DC`, effectValues.spellSaveDcBonus?.availability);
  if (effects.passiveScoreBonus && !settingHasProgression(effectValues.passiveScoreBonus)) add("Passive Scores", formatRows(effectValues.passiveScoreBonus?.entries, row => `${titleCase(row.score)} ${signedValue(row.bonus)}`), effectValues.passiveScoreBonus?.availability);

  for (const entry of draft.customImportedEffects ?? []) {
    if (entry?.included === false) continue;
    add("Imported Effect", `${entry.name || "Custom Effect"}${entry.disabled ? " (disabled)" : ""}`);
  }
  for (const entry of draft.customImportedActivities ?? []) {
    if (entry?.included === false || entry?.disabled) continue;
    add("Imported Activity", `${entry.name || "Custom Activity"} (${entry.type || "activity"})`);
  }

  return entries;
}

function levelProgressionEntries(draft) {
  const groups = [];
  const addGroup = (kind, key, setting, { id = null, labelOverride = null } = {}) => {
    if (!settingHasProgression(setting)) return;
    const lines = [];
    let resolvedLabel = labelOverride;
    for (const variant of progressionVariants(setting)) {
      const plainVariant = stripProgressionMetadata(variant);
      const isolated = {
        itemType: draft.itemType,
        enhancements: {}, enhancementValues: {},
        grantedEffects: {}, grantedEffectValues: {},
        customized: {}, overrides: {}
      };
      if (kind === "enhancement") {
        isolated.enhancements[key] = true;
        isolated.enhancementValues[key] = plainVariant;
      } else if (kind === "effect") {
        isolated.grantedEffects[key] = true;
        isolated.grantedEffectValues[key] = plainVariant;
      } else if (kind === "damage") {
        isolated.customized.additionalDamage = true;
        isolated.overrides.additionalDamage = [{ ...plainVariant, id: id ?? variant.id ?? "progression" }];
      }
      const property = itemPropertyEntries(isolated)[0];
      if (!property) continue;
      resolvedLabel ||= property.label;
      const availability = property.availability && property.availability !== "item"
        ? ` (${availabilityTitle(property.availability)})` : "";
      lines.push({
        level: variantLevel(variant) || 1,
        value: `${property.value}${availability}`
      });
    }
    if (!lines.length) return;
    lines.sort((left, right) => left.level - right.level);
    groups.push({ label: resolvedLabel ?? key, lines });
  };

  for (const [key, enabled] of Object.entries(draft.enhancements ?? {})) {
    if (!enabled || key === "grantedSpellcasting") continue;
    addGroup("enhancement", key, draft.enhancementValues?.[key]);
  }
  for (const [key, enabled] of Object.entries(draft.grantedEffects ?? {})) {
    if (!enabled) continue;
    addGroup("effect", key, draft.grantedEffectValues?.[key]);
  }
  if (draft.customized?.additionalDamage) {
    for (const row of draft.effective?.additionalDamage ?? draft.overrides?.additionalDamage ?? []) {
      addGroup("damage", "additionalDamage", row, { id: row.id, labelOverride: `Additional ${damageTypeLabel(row.damageType)} Damage` });
    }
  }
  if (draft.enhancements?.grantedSpellcasting) {
    for (const spell of draft.enhancementValues?.grantedSpellcasting?.spells ?? []) {
      if (!spell.unlockOnLevel) continue;
      groups.push({
        label: spell.name || "Granted Spell",
        lines: [{ level: Number(spell.unlockLevel) || 1, value: "Granted Spellcasting becomes available" }]
      });
    }
  }
  return groups;
}

function composeLevelProgressionText(data, draft) {
  data.system.description ??= {};
  const groups = levelProgressionEntries(draft);
  const currentValue = stripGeneratedSection(data.system.description.value, "level-progression");
  const currentChat = stripGeneratedSection(data.system.description.chat, "level-progression");
  if (!groups.length) {
    data.system.description.value = currentValue;
    data.system.description.chat = currentChat;
    return;
  }

  const fullGroups = groups.map(group => {
    const lines = group.lines.map(line => `<li>[Level ${line.level} — ${escapeHtml(line.value)}]</li>`).join("");
    return `<article class="item-creator-progression-group"><h4>${escapeHtml(group.label)}</h4><ul>${lines}</ul></article>`;
  }).join("");
  const chatItems = groups.flatMap(group => group.lines.map(line => `<li><strong>${escapeHtml(group.label)}:</strong> [Level ${line.level} — ${escapeHtml(line.value)}]</li>`)).join("");
  const fullSection = `<section class="item-creator-generated item-creator-level-progression" data-item-creator-generated="level-progression"><h3>Level Progression</h3>${fullGroups}</section>`;
  const chatSection = `<section class="item-creator-generated item-creator-level-progression" data-item-creator-generated="level-progression"><h3>Level Progression</h3><ul>${chatItems}</ul></section>`;
  data.system.description.value = appendGeneratedSection(currentValue, fullSection);
  data.system.description.chat = appendGeneratedSection(currentChat, chatSection);
}

function propertyGridHtml(entries) {
  const cells = entries.map(entry => `<td><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(entry.value)}</small></td>`);
  if (cells.length % 2) cells.push('<td aria-hidden="true"></td>');
  const rows = [];
  for (let index = 0; index < cells.length; index += 2) rows.push(`<tr>${cells[index]}${cells[index + 1]}</tr>`);
  return `<table class="item-creator-property-grid"><tbody>${rows.join("")}</tbody></table>`;
}

function composeItemPropertiesText(data, draft) {
  data.system.description ??= {};
  const entries = itemPropertyEntries(draft);
  const currentValue = stripGeneratedSection(data.system.description.value, "item-properties");
  const currentChat = stripGeneratedSection(data.system.description.chat, "item-properties");
  if (!entries.length) {
    data.system.description.value = currentValue;
    data.system.description.chat = currentChat;
    return;
  }

  const groupOrder = ["item", "owned", "equipped", "equippedAttuned"];
  const groups = groupOrder.map(availability => ({
    availability,
    entries: entries.filter(entry => (entry.availability || "item") === availability)
  })).filter(group => group.entries.length);

  const fullGroups = groups.map(group => `<div class="item-creator-property-group"><h4>${availabilityTitle(group.availability)}</h4>${propertyGridHtml(group.entries)}</div>`).join("");
  const fullSection = `<section class="item-creator-generated item-creator-item-properties" data-item-creator-generated="item-properties"><h3>Item Properties</h3>${fullGroups}</section>`;
  const chatItems = entries.map(entry => `<li><strong>${escapeHtml(entry.label)}:</strong> ${escapeHtml(entry.value)}${escapeHtml(availabilityChatSuffix(entry.availability || "item"))}.</li>`).join("");
  const chatSection = `<section class="item-creator-generated item-creator-item-properties" data-item-creator-generated="item-properties"><h3>Item Properties</h3><ul>${chatItems}</ul></section>`;

  data.system.description.value = appendGeneratedSection(currentValue, fullSection);
  data.system.description.chat = appendGeneratedSection(currentChat, chatSection);
}

function composeGrantedSpellcastingText(data, draft) {
  if (!draft.enhancements?.grantedSpellcasting) return;
  const spells = draft.enhancementValues?.grantedSpellcasting?.spells ?? [];
  if (!spells.length) return;

  data.system.description ??= {};
  const fullBody = spells.map(spell => `<article class="item-creator-granted-spell"><h4>${spellReference(spell)}</h4><p>${fullGrantedSpellText(spell)}</p></article>`).join("");
  const chatItems = spells.map(spell => `<li>${chatGrantedSpellText(spell)}</li>`).join("");
  const fullSection = `<section class="item-creator-generated item-creator-granted-spellcasting" data-item-creator-generated="granted-spellcasting"><h3>Granted Spellcasting</h3>${fullBody}</section>`;
  const chatSection = `<section class="item-creator-generated item-creator-granted-spellcasting" data-item-creator-generated="granted-spellcasting"><h3>Granted Spellcasting</h3><ul>${chatItems}</ul></section>`;

  const currentValue = stripGeneratedSection(data.system.description.value, "granted-spellcasting");
  const currentChat = stripGeneratedSection(data.system.description.chat, "granted-spellcasting");
  data.system.description.value = appendGeneratedSection(currentValue, fullSection);
  data.system.description.chat = appendGeneratedSection(currentChat, chatSection);
}

export class ItemCreatorItemBuilder {
  static async build(draft) {
    if (draft?.itemType === "equipment") return this.#buildEquipment(draft);
    if (draft?.itemType === "tool") return this.#buildTool(draft);
    return this.#buildWeapon(draft);
  }

  static async #buildWeapon(draft) {
    if (!draft?.template || !draft?.baseWeapon || !draft?.effective) throw new Error("Template, Base Weapon, and effective values are required.");

    const data = sanitizeDocumentData(draft.template.toObject());
    const baseSource = draft.baseWeapon.toObject();
    const effective = clone(draft.effective);
    const enhancements = draft.enhancements ?? {};
    const enhancementValues = draft.enhancementValues ?? {};

    data.name = draft.itemName.trim();
    data.img = draft.icon || draft.template.img || draft.baseWeapon.img || "icons/svg/sword.svg";
    data.type = "weapon";
    data.system.description ??= {};
    data.system.description.value = draft.description ?? "";
    data.system.description.chat = data.system.description.chat ?? "";

    data.system.type = clone(baseSource.system?.type ?? data.system.type ?? {});
    data.system.type.value = effective.weaponType;
    data.system.type.baseItem = baseSource.system?.type?.baseItem ?? baseSource.system?.identifier ?? data.system.type.baseItem ?? "";
    data.system.proficient = effective.proficiency === "automatic" ? null : effective.proficiency === "proficient" ? 1 : 0;
    data.system.quantity = Number(effective.quantity) || 1;
    data.system.weight = { value: Number(effective.weight?.value) || 0, units: effective.weight?.units || "lb" };
    data.system.price = { value: Number(effective.price?.value) || 0, denomination: effective.price?.denomination || "gp" };
    data.system.range = {
      value: Number(effective.range?.value) || 0,
      long: Number(effective.range?.long) || 0,
      reach: Number(effective.range?.reach) || 0,
      units: effective.range?.units || "ft"
    };
    data.system.properties = [...new Set(effective.properties ?? [])];
    data.system.mastery = effective.mastery || "";
    data.system.ammunition = { ...(data.system.ammunition ?? {}), type: effective.ammunitionType || "" };
    data.system.damage = clone(baseSource.system?.damage ?? data.system.damage ?? {});
    data.system.damage.base = damagePart({ ...effective.baseDamage, damageType: effective.damageType });
    data.system.damage.versatile = damagePart({ ...effective.versatile, damageType: effective.versatile?.damageType || effective.damageType });

    // Preserve special Template metadata unless explicitly overridden by Item Creator.
    data.system.rarity = draft.template.system?.rarity ?? data.system.rarity ?? "";
    data.system.attunement = draft.template.system?.attunement ?? data.system.attunement ?? "";
    data.system.magicalBonus = draft.template.system?.magicalBonus ?? data.system.magicalBonus ?? "";
    if (valuesOf(draft.template.system?.properties).includes("mgc")) data.system.properties.push("mgc");
    data.system.properties = [...new Set(data.system.properties)];
    const weaponStructuralBase = {
      properties: clone(data.system.properties),
      rarity: data.system.rarity ?? "",
      attunement: data.system.attunement ?? "",
      magicalBonus: String(data.system.magicalBonus ?? ""),
      damageBaseBonus: String(data.system.damage?.base?.bonus ?? "")
    };
    const magicalWeaponTier = enhancements.magicalWeapon ? selectProgressionTier(enhancementValues.magicalWeapon, null) : null;
    const weaponEnhancementTier = enhancements.weaponEnhancement ? selectProgressionTier(enhancementValues.weaponEnhancement, null) : null;

    if (magicalWeaponTier) {
      data.system.properties.push("mgc");
      data.system.rarity = magicalWeaponTier.rarity;
      data.system.attunement = magicalWeaponTier.attunement || "";
    }
    if (weaponEnhancementTier) {
      data.system.properties.push("mgc");
      data.system.magicalBonus = String(Number(weaponEnhancementTier.bonus) || 0);
    }
    // Any Item that grants a Spell is inherently magical, but this does not
    // imply a numeric enchantment bonus or an attunement requirement.
    if (enhancements.grantedSpellcasting && (enhancementValues.grantedSpellcasting?.spells ?? []).length) {
      data.system.properties.push("mgc");
    }
    data.system.properties = [...new Set(data.system.properties)];

    const damageBonusTier = enhancements.damageBonus ? selectProgressionTier(enhancementValues.damageBonus, null) : null;
    if (damageBonusTier) {
      data.system.damage.base.bonus = appendFormula(weaponStructuralBase.damageBaseBonus, damageBonusTier.bonus);
    }

    const importedCustom = buildImportedCustomContent(draft.customImportedEffects, draft.customImportedActivities);
    const attack = primaryAttackData(draft.baseWeapon, draft.template);
    attack.effects = valuesOf(attack.effects).map(reference => {
      const sourceId = reference?._id ?? reference?.id;
      const mappedId = importedCustom.effectIdMap.get(sourceId);
      return mappedId ? { ...clone(reference), _id: mappedId } : clone(reference);
    });
    attack.attack.ability = effective.attackAbility || "";
    attack.attack.type.value = effective.attackType || "";
    attack.attack.type.classification = "weapon";
    const weaponAttackBase = {
      attackBonus: String(attack.attack.bonus ?? ""),
      criticalThreshold: attack.attack.critical.threshold ?? null,
      criticalDamageBonus: String(attack.damage.critical.bonus ?? "")
    };
    const attackBonusTier = enhancements.attackBonus ? selectProgressionTier(enhancementValues.attackBonus, null) : null;
    const criticalThresholdTier = enhancements.criticalThreshold ? selectProgressionTier(enhancementValues.criticalThreshold, null) : null;
    const extraCriticalDamageTier = enhancements.extraCriticalDamage ? selectProgressionTier(enhancementValues.extraCriticalDamage, null) : null;
    attack.attack.bonus = attackBonusTier ? String(attackBonusTier.bonus ?? "") : weaponAttackBase.attackBonus;
    if (criticalThresholdTier) {
      attack.attack.critical.threshold = Number(criticalThresholdTier.mode === "custom"
        ? criticalThresholdTier.custom : criticalThresholdTier.mode);
    }
    if (extraCriticalDamageTier) {
      attack.damage.critical.bonus = `${Number(extraCriticalDamageTier.number) || 1}d${Number(extraCriticalDamageTier.denomination) || 8}[${extraCriticalDamageTier.damageType}]`;
    }
    const replaceAttackDamageParts = Boolean(draft.replaceAttackDamageParts || draft.customized?.additionalDamage);
    if (replaceAttackDamageParts) attack.damage.parts = [];

    // When damage parts are replaced, the current active draft is authoritative.
    // Otherwise the source Attack already contains its own parts; only combine
    // Base Weapon parts with a different special Template once.
    const shouldAppendEffectiveDamage = replaceAttackDamageParts
      || draft.template?.uuid !== draft.baseWeapon?.uuid;
    const baseAttackDamageParts = clone(attack.damage.parts ?? []);
    const progressionDamageRows = shouldAppendEffectiveDamage ? clone(effective.additionalDamage ?? []) : [];
    if (shouldAppendEffectiveDamage) {
      for (const row of progressionDamageRows) {
        const tier = selectProgressionTier(row, null);
        if (!tier) continue;
        attack.damage.parts.push(damagePart({
          ...tier,
          ability: tier.useAbilityModifier ? tier.ability : null
        }));
      }
    }

    const provisionalActivities = [...importedCustom.activities, attack];
    data.system.activities = Object.fromEntries(provisionalActivities.map(activity => [activity._id, activity]));

    // Create an isolated provisional parent only when native Cast Activity models are needed.
    // D&D5e mutates Activity array entries during preparation by defining a non-configurable `_index`.
    // Never reuse the source object passed to a temporary Item constructor.
    const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
    if (enhancements.grantedSpellcasting) {
      const provisionalSource = cleanDocumentSource(data);
      const provisionalItem = new ItemClass(provisionalSource, { temporary: true });
      const castActivities = await buildCastActivities(provisionalItem, enhancementValues.grantedSpellcasting.spells ?? []);
      for (const activity of castActivities) data.system.activities[activity._id] = cleanDocumentSource(activity);
    }

    data.effects = [
      ...importedCustom.effects,
      ...buildGrantedEffects(draft.grantedEffects ?? {}, draft.grantedEffectValues ?? {})
    ];

    const pricing = finalizeRarityAndPricing(data, draft);
    const materializationCore = finalizeCoreIdentity(data);
    data.flags ??= {};
    data.flags[MODULE_ID] = {
      created: true,
      schemaVersion: 4,
      moduleVersion: MODULE_VERSION,
      materializationCore: plain(materializationCore),
      pricing: plain(pricing),
      templateUuid: draft.template.uuid,
      baseWeaponUuid: draft.baseWeapon.uuid,
      editedFromUuid: draft.editingSourceUuid ?? null,
      importedItem: Boolean(draft.importedItem),
      runtime: {
        ignoreResistance: enhancements.ignoreResistance ? plain(enhancementValues.ignoreResistance) : null,
        conditionalAdvantage: enhancements.conditionalAdvantage ? plain(enhancementValues.conditionalAdvantage) : null,
        grantedSpells: enhancements.grantedSpellcasting ? plain(enhancementValues.grantedSpellcasting.spells ?? []) : [],
        structuralProgression: plain({
          itemType: "weapon",
          attackActivityId: attack._id,
          base: { ...weaponStructuralBase, ...weaponAttackBase, additionalDamageParts: baseAttackDamageParts },
          enhancements: {
            magicalWeapon: enhancements.magicalWeapon ? enhancementValues.magicalWeapon : null,
            weaponEnhancement: enhancements.weaponEnhancement ? enhancementValues.weaponEnhancement : null,
            attackBonus: enhancements.attackBonus ? enhancementValues.attackBonus : null,
            damageBonus: enhancements.damageBonus ? enhancementValues.damageBonus : null,
            criticalThreshold: enhancements.criticalThreshold ? enhancementValues.criticalThreshold : null,
            extraCriticalDamage: enhancements.extraCriticalDamage ? enhancementValues.extraCriticalDamage : null
          },
          additionalDamage: progressionDamageRows
        })
      },
      draft: plain({
        customized: draft.customized,
        overrides: draft.overrides,
        enhancements: draft.enhancements,
        enhancementValues: draft.enhancementValues,
        magicAutomation: draft.magicAutomation,
        grantedEffects: draft.grantedEffects,
        grantedEffectValues: draft.grantedEffectValues,
        customImportedEffects: draft.customImportedEffects,
        customImportedActivities: draft.customImportedActivities,
        importedBaseSummary: draft.importedBaseSummary,
        descriptionCustomized: draft.descriptionCustomized
      })
    };

    composeItemPropertiesText(data, draft);
    composeLevelProgressionText(data, draft);
    composeGrantedSpellcastingText(data, draft);

    // Validate using one fresh D&D5e Item document. The constructor performs preparation.
    // Calling prepareData again, or reusing a previously prepared source, causes `_index` redefinition errors.
    const finalSource = cleanDocumentSource(data);
    const temporary = new ItemClass(finalSource, { temporary: true });
    const finalData = cleanDocumentSource(temporary.toObject());
    delete finalData._id;
    return { data: finalData, temporary };
  }

  static async #buildEquipment(draft) {
    if (!draft?.template || !draft?.effective) throw new Error("Template and effective Equipment values are required.");

    const template = draft.template;
    const baseEquipment = draft.baseEquipment ?? draft.baseWeapon ?? template;
    const data = sanitizeDocumentData(template.toObject());
    const baseSource = baseEquipment.toObject();
    const effective = clone(draft.effective);
    const enhancements = draft.enhancements ?? {};
    const enhancementValues = draft.enhancementValues ?? {};

    data.name = draft.itemName.trim();
    data.img = draft.icon || template.img || baseEquipment.img || "icons/svg/item-bag.svg";
    data.type = "equipment";
    data.system ??= {};
    data.system.description ??= {};
    data.system.description.value = draft.description ?? "";
    data.system.description.chat = data.system.description.chat ?? "";

    data.system.type = clone(baseSource.system?.type ?? data.system.type ?? {});
    data.system.type.value = effective.nativeType || "wondrous";
    data.system.type.baseItem = effective.baseItem ?? baseSource.system?.type?.baseItem ?? baseSource.system?.identifier ?? "";
    data.system.quantity = Math.max(1, Number(effective.quantity) || 1);
    data.system.weight = { value: Number(effective.weight?.value) || 0, units: effective.weight?.units || "lb" };
    data.system.price = { value: Number(effective.price?.value) || 0, denomination: effective.price?.denomination || "gp" };
    data.system.proficient = effective.proficient === "automatic" ? null : effective.proficient === "proficient" ? 1 : 0;
    data.system.properties = [...new Set(effective.properties ?? [])].filter(property => property !== "mgc");
    data.system.armor = clone(baseSource.system?.armor ?? data.system.armor ?? {});
    data.system.armor.value = Number(effective.armor?.value) || 0;
    data.system.armor.dex = effective.armor?.dex === "" || effective.armor?.dex === null || effective.armor?.dex === undefined
      ? null : Number(effective.armor.dex);
    data.system.armor.magicalBonus = String(effective.armor?.magicalBonus ?? data.system.armor.magicalBonus ?? "");
    data.system.strength = Number(effective.strength) || 0;
    data.system.rarity = template.system?.rarity ?? data.system.rarity ?? "";
    data.system.attunement = template.system?.attunement ?? data.system.attunement ?? "";
    data.system.equipped = false;
    data.system.attuned = false;
    if (valuesOf(template.system?.properties).includes("mgc")) data.system.properties.push("mgc");
    data.system.properties = [...new Set(data.system.properties)];
    const equipmentStructuralBase = {
      properties: clone(data.system.properties),
      rarity: data.system.rarity ?? "",
      attunement: data.system.attunement ?? "",
      armorMagicalBonus: String(data.system.armor?.magicalBonus ?? ""),
      armorValue: Number(data.system.armor?.value) || 0,
      strength: Number(data.system.strength) || 0
    };
    const magicalItemTier = enhancements.magicalItem ? selectProgressionTier(enhancementValues.magicalItem, null) : null;
    const armorEnhancementTier = enhancements.armorEnhancement ? selectProgressionTier(enhancementValues.armorEnhancement, null) : null;

    if (magicalItemTier) {
      data.system.properties.push("mgc");
      data.system.rarity = magicalItemTier.rarity || "uncommon";
      data.system.attunement = magicalItemTier.attunement || "";
    }

    if (armorEnhancementTier) {
      data.system.properties.push("mgc");
      data.system.armor.magicalBonus = String(Number(armorEnhancementTier.bonus) || 0);
    }
    // Granted Spellcasting marks Equipment as magical without applying an
    // Armor Enhancement bonus and without requiring attunement.
    if (enhancements.grantedSpellcasting && (enhancementValues.grantedSpellcasting?.spells ?? []).length) {
      data.system.properties.push("mgc");
    }
    const baseArmorClassTier = enhancements.baseArmorClass ? selectProgressionTier(enhancementValues.baseArmorClass, null) : null;
    const removeStrengthTier = enhancements.removeStrengthRequirement ? selectProgressionTier(enhancementValues.removeStrengthRequirement, null) : null;
    const removeStealthTier = enhancements.removeStealthDisadvantage ? selectProgressionTier(enhancementValues.removeStealthDisadvantage, null) : null;
    if (baseArmorClassTier) data.system.armor.value = Number(baseArmorClassTier.value) || 0;
    if (removeStrengthTier) data.system.strength = 0;
    if (removeStealthTier) data.system.properties = data.system.properties.filter(property => property !== "stealthDisadvantage");
    data.system.properties = [...new Set(data.system.properties)];

    const importedCustom = buildImportedCustomContent(draft.customImportedEffects, draft.customImportedActivities);
    data.system.activities = Object.fromEntries(importedCustom.activities.map(activity => [activity._id, activity]));

    const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
    if (enhancements.grantedSpellcasting) {
      const provisionalItem = new ItemClass(cleanDocumentSource(data), { temporary: true });
      const castActivities = await buildCastActivities(provisionalItem, enhancementValues.grantedSpellcasting?.spells ?? []);
      for (const activity of castActivities) data.system.activities[activity._id] = cleanDocumentSource(activity);
    }

    data.effects = [
      ...importedCustom.effects,
      ...buildGrantedEffects(draft.grantedEffects ?? {}, draft.grantedEffectValues ?? {})
    ];

    const pricing = finalizeRarityAndPricing(data, draft);
    const materializationCore = finalizeCoreIdentity(data);
    data.flags ??= {};
    data.flags[MODULE_ID] = {
      created: true,
      schemaVersion: 4,
      moduleVersion: MODULE_VERSION,
      materializationCore: plain(materializationCore),
      pricing: plain(pricing),
      itemType: "equipment",
      equipmentForm: draft.equipmentForm ?? "accessory",
      templateUuid: template.uuid,
      baseEquipmentUuid: baseEquipment.uuid,
      editedFromUuid: draft.editingSourceUuid ?? null,
      importedItem: Boolean(draft.importedItem),
      runtime: {
        ignoreResistance: enhancements.ignoreResistance ? plain(enhancementValues.ignoreResistance) : null,
        conditionalAdvantage: enhancements.conditionalAdvantage ? plain(enhancementValues.conditionalAdvantage) : null,
        grantedSpells: enhancements.grantedSpellcasting ? plain(enhancementValues.grantedSpellcasting?.spells ?? []) : [],
        structuralProgression: plain({
          itemType: "equipment",
          base: equipmentStructuralBase,
          enhancements: {
            magicalItem: enhancements.magicalItem ? enhancementValues.magicalItem : null,
            armorEnhancement: enhancements.armorEnhancement ? enhancementValues.armorEnhancement : null,
            baseArmorClass: enhancements.baseArmorClass ? enhancementValues.baseArmorClass : null,
            removeStrengthRequirement: enhancements.removeStrengthRequirement ? enhancementValues.removeStrengthRequirement : null,
            removeStealthDisadvantage: enhancements.removeStealthDisadvantage ? enhancementValues.removeStealthDisadvantage : null
          }
        })
      },
      draft: plain({
        equipmentForm: draft.equipmentForm ?? "accessory",
        customized: draft.customized,
        overrides: draft.overrides,
        enhancements: draft.enhancements,
        enhancementValues: draft.enhancementValues,
        magicAutomation: draft.magicAutomation,
        grantedEffects: draft.grantedEffects,
        grantedEffectValues: draft.grantedEffectValues,
        customImportedEffects: draft.customImportedEffects,
        customImportedActivities: draft.customImportedActivities,
        importedBaseSummary: draft.importedBaseSummary,
        descriptionCustomized: draft.descriptionCustomized
      })
    };

    composeItemPropertiesText(data, draft);
    composeLevelProgressionText(data, draft);
    composeGrantedSpellcastingText(data, draft);

    const finalSource = cleanDocumentSource(data);
    const temporary = new ItemClass(finalSource, { temporary: true });
    const finalData = cleanDocumentSource(temporary.toObject());
    delete finalData._id;
    return { data: finalData, temporary };
  }

  static async #buildTool(draft) {
    if (!draft?.template || !draft?.effective) throw new Error("Template and effective Tool values are required.");

    const template = draft.template;
    const baseTool = draft.baseTool ?? draft.baseWeapon ?? template;
    const data = sanitizeDocumentData(template.toObject());
    const baseSource = baseTool.toObject();
    const effective = clone(draft.effective);
    const enhancements = draft.enhancements ?? {};
    const enhancementValues = draft.enhancementValues ?? {};

    data.name = draft.itemName.trim();
    data.img = draft.icon || template.img || baseTool.img || "systems/dnd5e/icons/svg/items/tool.svg";
    data.type = "tool";
    data.system ??= {};
    data.system.description ??= {};
    data.system.description.value = draft.description ?? "";
    data.system.description.chat = data.system.description.chat ?? "";

    // A Tool remains a Tool even when its source document contains custom or
    // legacy weapon/armor fields. Those structures are intentionally omitted.
    delete data.system.damage;
    delete data.system.armor;
    delete data.system.mastery;
    delete data.system.range;
    delete data.system.magicalBonus;
    delete data.system.strength;
    delete data.system.ammunition;

    data.system.type = clone(baseSource.system?.type ?? data.system.type ?? {});
    data.system.type.value = effective.toolType || "art";
    data.system.type.baseItem = effective.baseItem ?? baseSource.system?.type?.baseItem ?? baseSource.system?.identifier ?? "";
    data.system.ability = effective.ability ?? baseSource.system?.ability ?? "";
    data.system.bonus = String(effective.bonus ?? baseSource.system?.bonus ?? "");
    data.system.proficient = effective.proficiency === "automatic" ? null
      : effective.proficiency === "expertise" ? 2
        : effective.proficiency === "proficient" ? 1 : 0;
    data.system.quantity = Math.max(1, Number(effective.quantity) || 1);
    data.system.weight = { value: Number(effective.weight?.value) || 0, units: effective.weight?.units || "lb" };
    data.system.price = { value: Number(effective.price?.value) || 0, denomination: effective.price?.denomination || "gp" };
    data.system.properties = [...new Set(effective.properties ?? [])].filter(property => property !== "mgc");
    data.system.rarity = template.system?.rarity ?? data.system.rarity ?? "";
    data.system.attunement = template.system?.attunement ?? data.system.attunement ?? "";
    data.system.equipped = false;
    data.system.attuned = false;
    if (valuesOf(template.system?.properties).includes("mgc")) data.system.properties.push("mgc");
    data.system.properties = [...new Set(data.system.properties)];
    const toolStructuralBase = {
      properties: clone(data.system.properties),
      rarity: data.system.rarity ?? "",
      attunement: data.system.attunement ?? ""
    };
    const magicalToolTier = enhancements.magicalTool ? selectProgressionTier(enhancementValues.magicalTool, null) : null;

    if (magicalToolTier) {
      data.system.properties.push("mgc");
      data.system.rarity = magicalToolTier.rarity || "uncommon";
      data.system.attunement = magicalToolTier.attunement || "";
    }

    // Granted Spellcasting makes the Tool magical, but never adds a weapon/armor
    // enchantment and never requires attunement unless the GM selected it.
    if (enhancements.grantedSpellcasting && (enhancementValues.grantedSpellcasting?.spells ?? []).length) {
      data.system.properties.push("mgc");
    }
    data.system.properties = [...new Set(data.system.properties)];

    const importedCustom = buildImportedCustomContent(draft.customImportedEffects, draft.customImportedActivities);
    data.system.activities = Object.fromEntries(importedCustom.activities.map(activity => [activity._id, activity]));

    const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
    const hasToolCheck = Object.values(data.system.activities).some(activity => activity?.type === "check");
    if (!hasToolCheck) {
      const CheckClass = CONFIG.DND5E.activityTypes?.check?.documentClass;
      if (CheckClass) {
        const provisionalItem = new ItemClass(cleanDocumentSource(data), { temporary: true });
        const check = new CheckClass({}, { parent: provisionalItem });
        const checkSource = cleanDocumentSource(check.toObject?.() ?? check);
        checkSource._id ??= foundry.utils.randomID();
        checkSource.type = "check";
        data.system.activities[checkSource._id] = checkSource;
      }
    }

    if (enhancements.grantedSpellcasting) {
      const provisionalItem = new ItemClass(cleanDocumentSource(data), { temporary: true });
      const castActivities = await buildCastActivities(provisionalItem, enhancementValues.grantedSpellcasting?.spells ?? []);
      for (const activity of castActivities) data.system.activities[activity._id] = cleanDocumentSource(activity);
    }

    data.effects = [
      ...importedCustom.effects,
      ...buildGrantedEffects(draft.grantedEffects ?? {}, draft.grantedEffectValues ?? {})
    ];

    const pricing = finalizeRarityAndPricing(data, draft);
    const materializationCore = finalizeCoreIdentity(data);
    data.flags ??= {};
    data.flags[MODULE_ID] = {
      created: true,
      schemaVersion: 4,
      moduleVersion: MODULE_VERSION,
      materializationCore: plain(materializationCore),
      pricing: plain(pricing),
      itemType: "tool",
      templateUuid: template.uuid,
      baseToolUuid: baseTool.uuid,
      editedFromUuid: draft.editingSourceUuid ?? null,
      importedItem: Boolean(draft.importedItem),
      runtime: {
        ignoreResistance: enhancements.ignoreResistance ? plain(enhancementValues.ignoreResistance) : null,
        conditionalAdvantage: enhancements.conditionalAdvantage ? plain(enhancementValues.conditionalAdvantage) : null,
        grantedSpells: enhancements.grantedSpellcasting ? plain(enhancementValues.grantedSpellcasting?.spells ?? []) : [],
        structuralProgression: plain({
          itemType: "tool",
          base: toolStructuralBase,
          enhancements: { magicalTool: enhancements.magicalTool ? enhancementValues.magicalTool : null }
        })
      },
      draft: plain({
        customized: draft.customized,
        overrides: draft.overrides,
        enhancements: draft.enhancements,
        enhancementValues: draft.enhancementValues,
        magicAutomation: draft.magicAutomation,
        grantedEffects: draft.grantedEffects,
        grantedEffectValues: draft.grantedEffectValues,
        customImportedEffects: draft.customImportedEffects,
        customImportedActivities: draft.customImportedActivities,
        importedBaseSummary: draft.importedBaseSummary,
        descriptionCustomized: draft.descriptionCustomized
      })
    };

    composeItemPropertiesText(data, draft);
    composeLevelProgressionText(data, draft);
    composeGrantedSpellcastingText(data, draft);

    const finalSource = cleanDocumentSource(data);
    const temporary = new ItemClass(finalSource, { temporary: true });
    const finalData = cleanDocumentSource(temporary.toObject());
    delete finalData._id;
    return { data: finalData, temporary };
  }

  static async renderChatCard(item) {
    const context = {
      actor: item.actor ?? null,
      config: CONFIG.DND5E,
      tokenId: null,
      item,
      data: await item.system.getCardData(),
      isSpell: false
    };
    return foundry.applications.handlebars.renderTemplate("systems/dnd5e/templates/chat/item-card.hbs", context);
  }
}
