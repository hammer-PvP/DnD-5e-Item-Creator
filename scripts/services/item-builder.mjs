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

function sanitizeDocumentData(source) {
  const data = clone(source ?? {});
  for (const key of ["_id", "folder", "sort", "ownership", "_stats", "pack"]) delete data[key];
  data.flags ??= {};
  data.system ??= {};
  data.effects = (data.effects ?? []).map(effect => {
    const clean = clone(effect);
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

function primaryAttackData(baseWeapon, template) {
  const baseAttack = firstActivity(baseWeapon, "attack");
  const templateAttack = firstActivity(template, "attack");
  const source = baseAttack?.toObject?.() ?? templateAttack?.toObject?.() ?? {
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

  // Preserve special non-base damage configured on the Template attack.
  if (templateAttack) {
    const templateSource = templateAttack.toObject?.() ?? {};
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
    requireMagic: true,
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
        spellbook: Boolean(spell.showInSpellbook),
        uuid: spell.uuid
      },
      uses: recovery.uses,
      visibility: availabilityFlags(spell.availability),
      flags: {
        [MODULE_ID]: {
          grantedSpell: true,
          sourceSpellUuid: spell.uuid,
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

function composeRuntimeText(data, draft) {
  const lines = [];
  if (draft.enhancements.ignoreResistance) {
    const labels = (draft.enhancementValues.ignoreResistance.damageTypes ?? [])
      .map(type => game.i18n.localize(CONFIG.DND5E.damageTypes?.[type]?.label ?? type));
    if (labels.length) lines.push(`<p><strong>Ignore Resistance.</strong> Damage of the selected type${labels.length > 1 ? "s" : ""} (${labels.join(", ")}) from this weapon ignores resistance, but not immunity.</p>`);
  }
  if (draft.enhancements.conditionalAdvantage) {
    const setting = draft.enhancementValues.conditionalAdvantage;
    const condition = setting.mode === "custom" ? setting.customText : {
      targetUndead: "the target is Undead",
      targetFiend: "the target is a Fiend",
      targetBloodied: "the target is below half its Hit Points",
      wielderDimLight: "the wielder is in dim light",
      targetNotActed: "the target has not acted in this combat"
    }[setting.supportedCondition];
    if (condition) lines.push(`<p><strong>Conditional Advantage.</strong> The wielder has advantage on attack rolls made with this weapon when ${condition}.</p>`);
  }
  if (!lines.length) return;
  const existing = String(data.system.description?.value ?? "");
  data.system.description ??= {};
  data.system.description.value = `${existing}${existing ? "\n" : ""}<section class="item-creator-runtime-rules"><h3>Item Creator Rules</h3>${lines.join("")}</section>`;
}

export class ItemCreatorItemBuilder {
  static async build(draft) {
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
    data.system.properties = [...new Set(data.system.properties)];

    if (enhancements.damageBonus) {
      data.system.damage.base.bonus = appendFormula(data.system.damage.base.bonus, enhancementValues.damageBonus.bonus);
    }

    const templateActivities = objectActivities(draft.template);
    const nonAttackActivities = Object.values(templateActivities).filter(activity => activity?.type !== "attack");
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
    for (const row of effective.additionalDamage ?? []) {
      attack.damage.parts.push(damagePart({
        ...row,
        ability: row.useAbilityModifier ? row.ability : null
      }));
    }

    const provisionalActivities = [...nonAttackActivities, attack];
    data.system.activities = Object.fromEntries(provisionalActivities.map(activity => [activity._id, activity]));

    // Create a provisional parent so native Cast Activity data models can apply defaults and validation.
    const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
    const provisionalItem = new ItemClass(data, { temporary: true });
    if (enhancements.grantedSpellcasting) {
      const castActivities = await buildCastActivities(provisionalItem, enhancementValues.grantedSpellcasting.spells ?? []);
      for (const activity of castActivities) data.system.activities[activity._id] = activity;
    }

    data.effects = objectEffects(draft.template).map(effect => {
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
        grantedEffects: draft.grantedEffects,
        grantedEffectValues: draft.grantedEffectValues,
        descriptionCustomized: draft.descriptionCustomized
      })
    };

    composeRuntimeText(data, draft);

    // Validate using the actual D&D5e Item document class before preview or creation.
    const temporary = new ItemClass(data, { temporary: true });
    temporary.prepareData();
    const finalData = temporary.toObject();
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
