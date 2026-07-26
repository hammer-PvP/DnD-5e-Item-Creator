import { MODULE_ID, MODULE_VERSION } from "../constants.mjs";

const MODES = () => CONST.ACTIVE_EFFECT_MODES;

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

function effectData({ key, label, availability, changes, description = "" }) {
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
        availability
      }
    }
  };
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
    if (changes.length) effects.push(effectData({ key, label, availability, changes, description }));
  };
  const add = MODES().ADD;
  const override = MODES().OVERRIDE;
  const upgrade = MODES().UPGRADE;

  if (enabled.armorClassBonus) {
    const changes = [];
    addChange(changes, "system.attributes.ac.bonus", add, values.armorClassBonus.bonus);
    addEffect("armorClassBonus", "Armor Class Bonus", values.armorClassBonus.availability, changes);
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
    addEffect("criticalThreshold", "Critical Hit Threshold", values.criticalThreshold.availability, changes);
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
        spellbook: Boolean(spell.showInSpellbook && spell.availability === "owned"),
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
          castLevelMode: spell.castLevelMode
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
    const text = formatRows(draft.overrides?.additionalDamage, row => {
      const ability = row.useAbilityModifier
        ? row.ability === "attack" ? " + attack ability modifier"
          : row.ability === "spellcasting" ? " + spellcasting ability modifier"
            : ` + ${abilityLabel(row.ability)} modifier`
        : "";
      return `${Number(row.number) || 0}d${Number(row.denomination) || 0}${ability} ${damageTypeLabel(row.damageType)}`;
    });
    add("Additional Damage", text ? `${text} on a hit` : "");
  }

  if (enhancements.magicalWeapon) {
    const setting = enhancementValues.magicalWeapon ?? {};
    const rarity = configLabel(CONFIG.DND5E.itemRarity, setting.rarity, titleCase(setting.rarity));
    const attunement = setting.attunement === "required" ? "; requires attunement" : "";
    add("Magical Weapon", `${rarity || "Magical"}${attunement}`);
  }
  if (enhancements.magicalItem) {
    const setting = enhancementValues.magicalItem ?? {};
    const rarity = configLabel(CONFIG.DND5E.itemRarity, setting.rarity, titleCase(setting.rarity));
    const attunement = setting.attunement === "required" ? "; requires attunement" : "";
    add("Magical Equipment", `${rarity || "Magical"}${attunement}`);
  }
  if (enhancements.armorEnhancement) add("Armor Enhancement", `${signedValue(enhancementValues.armorEnhancement?.bonus)} AC`);
  if (enhancements.baseArmorClass) add("Base Armor Class", String(Number(enhancementValues.baseArmorClass?.value) || 0));
  if (enhancements.removeStrengthRequirement) add("Strength Requirement", "Removed");
  if (enhancements.removeStealthDisadvantage) add("Stealth Disadvantage", "Removed");
  if (enhancements.weaponEnhancement) add("Weapon Enhancement", `${signedValue(enhancementValues.weaponEnhancement?.bonus)} to attack and damage rolls`);
  if (enhancements.attackBonus) add("Attack Roll Bonus", `${signedValue(enhancementValues.attackBonus?.bonus)} to attack rolls`);
  if (enhancements.damageBonus) add("Damage Roll Bonus", `${signedValue(enhancementValues.damageBonus?.bonus)} to damage rolls`);
  if (enhancements.criticalThreshold) {
    const setting = enhancementValues.criticalThreshold ?? {};
    const threshold = Number(setting.mode === "custom" ? setting.custom : setting.mode) || 20;
    add("Critical Hit Range", threshold === 20 ? "Critical hit on a 20" : `Critical hit on ${threshold}–20`);
  }
  if (enhancements.extraCriticalDamage) {
    const setting = enhancementValues.extraCriticalDamage ?? {};
    add("Extra Critical Damage", `${Number(setting.number) || 1}d${Number(setting.denomination) || 8} ${damageTypeLabel(setting.damageType)}`);
  }
  if (enhancements.ignoreResistance) {
    const labels = (enhancementValues.ignoreResistance?.damageTypes ?? []).map(damageTypeLabel);
    add("Ignore Resistance", labels.length ? `${labels.join(", ")} damage ignores resistance, but not immunity` : "");
  }
  if (enhancements.conditionalAdvantage) {
    const setting = enhancementValues.conditionalAdvantage ?? {};
    const condition = setting.mode === "custom" ? setting.customText : {
      targetUndead: "the target is Undead",
      targetFiend: "the target is a Fiend",
      targetBloodied: "the target is below half its Hit Points",
      wielderDimLight: "the wielder is in dim light",
      targetNotActed: "the target has not acted in this combat"
    }[setting.supportedCondition];
    const sourceLabel = draft.itemType === "equipment" ? "while this item is active" : "with this weapon";
    add("Conditional Advantage", condition ? `Advantage on attacks ${sourceLabel} when ${condition}` : "");
  }

  if (effects.armorClassBonus) add("Armor Class", `${signedValue(effectValues.armorClassBonus?.bonus)} AC`, effectValues.armorClassBonus?.availability);
  if (effects.criticalThreshold) {
    const setting = effectValues.criticalThreshold ?? {};
    const threshold = Number(setting.threshold) || 20;
    const scope = setting.scope === "weapon" ? "weapon attacks" : setting.scope === "spell" ? "spell attacks" : "weapon and spell attacks";
    add("Critical Hit Threshold", `Critical hit on ${threshold === 20 ? "20" : `${threshold}–20`} for ${scope}`, setting.availability);
  }
  if (effects.savingThrowBonus) add("Saving Throws", formatRows(effectValues.savingThrowBonus?.entries, row => row.target === "all"
    ? `${signedValue(row.bonus)} to all saving throws`
    : `${signedValue(row.bonus)} to ${abilityLabel(row.target)} saving throws`), effectValues.savingThrowBonus?.availability);
  if (effects.savingThrowAdvantage) add("Saving Throw Advantage", formatRows(effectValues.savingThrowAdvantage?.entries, row => row.target === "all"
    ? "Advantage on all saving throws"
    : `Advantage on ${abilityLabel(row.target)} saving throws`), effectValues.savingThrowAdvantage?.availability);
  if (effects.abilityScoreAdjustment) add("Ability Scores", formatRows(effectValues.abilityScoreAdjustment?.entries, row => {
    const ability = abilityLabel(row.ability);
    if (row.operation === "fixed") return `${ability} set to ${row.value}`;
    if (row.operation === "minimum") return `${ability} minimum ${row.value}`;
    return `${ability} ${signedValue(row.value)}`;
  }), effectValues.abilityScoreAdjustment?.availability);
  if (effects.abilityCheckBonus) add("Ability Checks", formatRows(effectValues.abilityCheckBonus?.entries, row => row.target === "all"
    ? `${signedValue(row.bonus)} to all ability checks`
    : `${signedValue(row.bonus)} to ${abilityLabel(row.target)} checks`), effectValues.abilityCheckBonus?.availability);
  if (effects.skillBonus) add("Skill Checks", formatRows(effectValues.skillBonus?.entries, row => row.target === "all"
    ? `${signedValue(row.bonus)} to all skill checks`
    : `${skillLabel(row.target)} ${signedValue(row.bonus)}`), effectValues.skillBonus?.availability);
  if (effects.skillProficiency) add("Skill Training", formatRows(effectValues.skillProficiency?.entries, row => `${row.level === "expertise" ? "Expertise" : "Proficiency"} in ${skillLabel(row.skill)}`), effectValues.skillProficiency?.availability);
  if (effects.abilityCheckAdvantage) add("Check Advantage", formatRows(effectValues.abilityCheckAdvantage?.entries, row => {
    if (row.target === "all") return "Advantage on all ability checks";
    if (row.target?.startsWith("ability:")) return `Advantage on ${abilityLabel(row.target.slice(8))} checks`;
    if (row.target?.startsWith("skill:")) return `Advantage on ${skillLabel(row.target.slice(6))} checks`;
    return "";
  }), effectValues.abilityCheckAdvantage?.availability);

  for (const [key, label] of [["damageResistance", "Damage Resistance"], ["damageImmunity", "Damage Immunity"], ["damageVulnerability", "Damage Vulnerability"]]) {
    if (!effects[key]) continue;
    add(label, (effectValues[key]?.damageTypes ?? []).map(damageTypeLabel).join(", "), effectValues[key]?.availability);
  }
  if (effects.conditionImmunity) add("Condition Immunity", (effectValues.conditionImmunity?.conditions ?? []).map(conditionLabel).join(", "), effectValues.conditionImmunity?.availability);
  if (effects.initiativeBonus) add("Initiative", `${signedValue(effectValues.initiativeBonus?.bonus)} to initiative`, effectValues.initiativeBonus?.availability);
  if (effects.initiativeAdvantage) add("Initiative Advantage", "Advantage on initiative rolls", effectValues.initiativeAdvantage?.availability);
  if (effects.proficiencyBonusModifier) add("Proficiency Bonus", `${signedValue(effectValues.proficiencyBonusModifier?.bonus)} to the global Proficiency Bonus`, effectValues.proficiencyBonusModifier?.availability);
  if (effects.maximumHitPointsBonus) add("Maximum Hit Points", `${signedValue(effectValues.maximumHitPointsBonus?.bonus)} maximum Hit Points`, effectValues.maximumHitPointsBonus?.availability);
  if (effects.movementBonus) add("Movement", formatRows(effectValues.movementBonus?.entries, row => `${movementLabel(row.type)} speed ${signedValue(row.bonus)} ${row.units ?? "ft"}`), effectValues.movementBonus?.availability);
  if (effects.grantMovementType) add("Granted Movement", formatRows(effectValues.grantMovementType?.entries, row => `${movementLabel(row.type)} speed minimum ${row.speed} ${row.units ?? "ft"}${row.hover ? " with hover" : ""}`), effectValues.grantMovementType?.availability);
  if (effects.grantedSense) add("Senses", formatRows(effectValues.grantedSense?.entries, row => {
    const operation = row.operation === "add" ? `+${row.range}` : row.operation === "fixed" ? `fixed ${row.range}` : `minimum ${row.range}`;
    return `${senseLabel(row.sense)} ${operation} ${row.units ?? "ft"}`;
  }), effectValues.grantedSense?.availability);
  if (effects.spellAttackBonus) add("Spell Attacks", `${signedValue(effectValues.spellAttackBonus?.bonus)} to spell attack rolls`, effectValues.spellAttackBonus?.availability);
  if (effects.spellSaveDcBonus) add("Spell Save DC", `${signedValue(effectValues.spellSaveDcBonus?.bonus)} to Spell Save DC`, effectValues.spellSaveDcBonus?.availability);
  if (effects.passiveScoreBonus) add("Passive Scores", formatRows(effectValues.passiveScoreBonus?.entries, row => `${titleCase(row.score)} ${signedValue(row.bonus)}`), effectValues.passiveScoreBonus?.availability);

  return entries;
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

    if (enhancements.magicalWeapon) {
      data.system.properties.push("mgc");
      data.system.rarity = enhancementValues.magicalWeapon.rarity;
      data.system.attunement = enhancementValues.magicalWeapon.attunement || "";
    }
    if (enhancements.weaponEnhancement) {
      data.system.properties.push("mgc");
      data.system.magicalBonus = String(Number(enhancementValues.weaponEnhancement.bonus) || 0);
    }
    // Any Item that grants a Spell is inherently magical, but this does not
    // imply a numeric enchantment bonus or an attunement requirement.
    if (enhancements.grantedSpellcasting && (enhancementValues.grantedSpellcasting?.spells ?? []).length) {
      data.system.properties.push("mgc");
    }
    data.system.properties = [...new Set(data.system.properties)];

    if (enhancements.damageBonus) {
      data.system.damage.base.bonus = appendFormula(data.system.damage.base.bonus, enhancementValues.damageBonus.bonus);
    }

    const templateActivities = objectActivities(draft.template);
    const managedActivityIds = new Set(draft.managedActivityIds ?? []);
    const managedPrimaryAttackId = draft.managedPrimaryAttackId ?? null;
    const preservedActivities = Object.values(templateActivities).filter(activity => {
      const id = activity?._id ?? activity?.id;
      if (managedActivityIds.has(id)) return false;
      if (activity?.type !== "attack") return true;
      return Boolean(draft.preserveAdditionalAttackActivities && managedPrimaryAttackId && id !== managedPrimaryAttackId);
    });
    const attack = primaryAttackData(draft.baseWeapon, draft.template);
    attack.attack.ability = effective.attackAbility || "";
    attack.attack.bonus = enhancements.attackBonus ? String(enhancementValues.attackBonus.bonus ?? "") : String(attack.attack.bonus ?? "");
    attack.attack.type.value = effective.attackType || "";
    attack.attack.type.classification = "weapon";
    if (enhancements.criticalThreshold) {
      attack.attack.critical.threshold = Number(enhancementValues.criticalThreshold.mode === "custom"
        ? enhancementValues.criticalThreshold.custom : enhancementValues.criticalThreshold.mode);
    }
    if (enhancements.extraCriticalDamage) {
      const critical = enhancementValues.extraCriticalDamage;
      attack.damage.critical.bonus = `${Number(critical.number) || 1}d${Number(critical.denomination) || 8}[${critical.damageType}]`;
    }
    const replaceAttackDamageParts = Boolean(draft.replaceAttackDamageParts || draft.customized?.additionalDamage);
    if (replaceAttackDamageParts) attack.damage.parts = [];

    // When damage parts are replaced, the current active draft is authoritative.
    // Otherwise the source Attack already contains its own parts; only combine
    // Base Weapon parts with a different special Template once.
    const shouldAppendEffectiveDamage = replaceAttackDamageParts
      || draft.template?.uuid !== draft.baseWeapon?.uuid;
    if (shouldAppendEffectiveDamage) {
      for (const row of effective.additionalDamage ?? []) {
        attack.damage.parts.push(damagePart({
          ...row,
          ability: row.useAbilityModifier ? row.ability : null
        }));
      }
    }

    const provisionalActivities = [...preservedActivities, attack];
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

    const managedEffectIds = new Set(draft.managedEffectIds ?? []);
    data.effects = objectEffects(draft.template).filter(effect =>
      !managedEffectIds.has(effect?._id ?? effect?.id)).map(effect => {
      const clean = clone(effect);
      delete clean.origin;
      return clean;
    });
    data.effects.push(...buildGrantedEffects(draft.grantedEffects ?? {}, draft.grantedEffectValues ?? {}));

    data.flags ??= {};
    data.flags[MODULE_ID] = {
      created: true,
      schemaVersion: 1,
      moduleVersion: MODULE_VERSION,
      templateUuid: draft.template.uuid,
      baseWeaponUuid: draft.baseWeapon.uuid,
      editedFromUuid: draft.editingSourceUuid ?? null,
      importedItem: Boolean(draft.importedItem),
      runtime: {
        ignoreResistance: enhancements.ignoreResistance ? plain(enhancementValues.ignoreResistance) : null,
        conditionalAdvantage: enhancements.conditionalAdvantage ? plain(enhancementValues.conditionalAdvantage) : null,
        grantedSpells: enhancements.grantedSpellcasting ? plain(enhancementValues.grantedSpellcasting.spells ?? []) : []
      },
      draft: plain({
        customized: draft.customized,
        overrides: draft.overrides,
        enhancements: draft.enhancements,
        enhancementValues: draft.enhancementValues,
        magicAutomation: draft.magicAutomation,
        grantedEffects: draft.grantedEffects,
        grantedEffectValues: draft.grantedEffectValues,
        descriptionCustomized: draft.descriptionCustomized
      })
    };

    composeItemPropertiesText(data, draft);
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

    if (enhancements.magicalItem) {
      data.system.properties.push("mgc");
      data.system.rarity = enhancementValues.magicalItem?.rarity || "uncommon";
      data.system.attunement = enhancementValues.magicalItem?.attunement || "";
    } else if (valuesOf(template.system?.properties).includes("mgc")) data.system.properties.push("mgc");

    if (enhancements.armorEnhancement) {
      data.system.properties.push("mgc");
      data.system.armor.magicalBonus = String(Number(enhancementValues.armorEnhancement?.bonus) || 0);
    }
    // Granted Spellcasting marks Equipment as magical without applying an
    // Armor Enhancement bonus and without requiring attunement.
    if (enhancements.grantedSpellcasting && (enhancementValues.grantedSpellcasting?.spells ?? []).length) {
      data.system.properties.push("mgc");
    }
    if (enhancements.baseArmorClass) data.system.armor.value = Number(enhancementValues.baseArmorClass?.value) || 0;
    if (enhancements.removeStrengthRequirement) data.system.strength = 0;
    if (enhancements.removeStealthDisadvantage) data.system.properties = data.system.properties.filter(property => property !== "stealthDisadvantage");
    data.system.properties = [...new Set(data.system.properties)];

    const templateActivities = objectActivities(template);
    const managedActivityIds = new Set(draft.managedActivityIds ?? []);
    data.system.activities = Object.fromEntries(Object.values(templateActivities)
      .filter(activity => !managedActivityIds.has(activity?._id ?? activity?.id))
      .map(activity => [activity._id, cleanDocumentSource(activity)]));

    const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
    if (enhancements.grantedSpellcasting) {
      const provisionalItem = new ItemClass(cleanDocumentSource(data), { temporary: true });
      const castActivities = await buildCastActivities(provisionalItem, enhancementValues.grantedSpellcasting?.spells ?? []);
      for (const activity of castActivities) data.system.activities[activity._id] = cleanDocumentSource(activity);
    }

    const managedEffectIds = new Set(draft.managedEffectIds ?? []);
    data.effects = objectEffects(template).filter(effect => !managedEffectIds.has(effect?._id ?? effect?.id)).map(effect => {
      const clean = clone(effect);
      delete clean.origin;
      return clean;
    });
    data.effects.push(...buildGrantedEffects(draft.grantedEffects ?? {}, draft.grantedEffectValues ?? {}));

    data.flags ??= {};
    data.flags[MODULE_ID] = {
      created: true,
      schemaVersion: 1,
      moduleVersion: MODULE_VERSION,
      itemType: "equipment",
      equipmentForm: draft.equipmentForm ?? "accessory",
      templateUuid: template.uuid,
      baseEquipmentUuid: baseEquipment.uuid,
      editedFromUuid: draft.editingSourceUuid ?? null,
      importedItem: Boolean(draft.importedItem),
      runtime: {
        ignoreResistance: enhancements.ignoreResistance ? plain(enhancementValues.ignoreResistance) : null,
        conditionalAdvantage: enhancements.conditionalAdvantage ? plain(enhancementValues.conditionalAdvantage) : null,
        grantedSpells: enhancements.grantedSpellcasting ? plain(enhancementValues.grantedSpellcasting?.spells ?? []) : []
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
        descriptionCustomized: draft.descriptionCustomized
      })
    };

    composeItemPropertiesText(data, draft);
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
