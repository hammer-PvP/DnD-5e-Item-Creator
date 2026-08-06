import { EQUIPMENT_FORMS, ITEM_TYPES, MODULE_ID, MODULE_STAGE, MODULE_VERSION, STEPS } from "../constants.mjs";
import { ItemCreatorSourceRegistry } from "../services/source-registry.mjs";
import { ItemCreatorIconBrowserApp } from "./icon-browser-app.mjs";
import { ItemCreatorItemBuilder } from "../services/item-builder.mjs";
import { normalizeBaseItemMechanics } from "../services/base-item-normalizer.mjs";
import { ProtectedTransactionDialogService } from "../services/protected-transaction-dialog-service.mjs";
import { clampCharacterLevel, settingHasProgression, validUnlockSetting } from "../services/level-progression.mjs";
import {
  RESOURCE_CATEGORIES, RESOURCE_DICE, defaultResourceModification, getResourceDefinition,
  normalizeResourceModification, resourceGroups, resourceModificationLabel, validateResourceModification
} from "../services/resource-modification-registry.mjs";
import {
  ACTIVATION_COUNTING, APPLICATION_MODES, ATTACK_TYPES, CONSUMPTION_DECISIONS, CONSUMPTION_EVENTS,
  DURATION_UNITS, EFFECT_RECIPIENTS, EFFECT_SCALING, RETRIGGER_BEHAVIORS,
  SINGLE_ACTIVATION_EXPIRATIONS, STACK_BEHAVIORS, TICK_TIMINGS, TRIGGER_CATEGORIES, TRIGGER_EFFECT_TYPES,
  TRIGGER_EVENTS, VALUE_CALCULATIONS,
  defaultTriggeredEffect, defaultTriggeredEffectPayload, extractSelectedSpellEffects, isDamageTriggeredEffect, isNumericTriggeredEffect,
  isTraitTriggeredEffect, normalizeTriggeredEffect, normalizeTriggeredEffectPayload,
  triggeredEffectSummary, validateTriggeredEffect
} from "../services/triggered-effect-registry.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

function nativeCompendiumBrowserClass() {
  return game.dnd5e?.applications?.CompendiumBrowser
    ?? globalThis.dnd5e?.applications?.CompendiumBrowser
    ?? null;
}

function isWeaponItemDocument(document) {
  const documentName = document?.documentName ?? document?.constructor?.documentName;
  return documentName === "Item" && document?.type === "weapon";
}

function isEquipmentItemDocument(document) {
  const documentName = document?.documentName ?? document?.constructor?.documentName;
  return documentName === "Item" && document?.type === "equipment" && document?.system?.type?.value !== "vehicle";
}

function isToolItemDocument(document) {
  const documentName = document?.documentName ?? document?.constructor?.documentName;
  return documentName === "Item" && document?.type === "tool";
}

function isSupportedItemDocument(document) {
  return isWeaponItemDocument(document) || isEquipmentItemDocument(document) || isToolItemDocument(document);
}

function isSpellItemDocument(document) {
  const documentName = document?.documentName ?? document?.constructor?.documentName;
  return documentName === "Item" && document?.type === "spell";
}

function valuesOf(value) {
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return [...value];
  if (value instanceof Map) return [...value.values()];
  if (value?.values instanceof Function) {
    try { return [...value.values()]; } catch (_error) { /* Fall through. */ }
  }
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function localizedLabel(config, fallback) {
  const label = typeof config === "string" ? config : config?.label;
  return label ? game.i18n.localize(label) : fallback;
}

function configOptions(config, selected, { blankValue, blankLabel, filter } = {}) {
  const options = [];
  if (blankLabel !== undefined) options.push({
    value: blankValue ?? "",
    label: blankLabel,
    selected: String(selected ?? "") === String(blankValue ?? "")
  });
  for (const [value, entry] of Object.entries(config ?? {})) {
    if (filter && !filter(value, entry)) continue;
    options.push({
      value,
      label: localizedLabel(entry, value),
      selected: String(selected ?? "") === String(value)
    });
  }
  return options;
}

function attackActivity(document) {
  return valuesOf(document?.system?.activities).find(activity => activity?.type === "attack") ?? null;
}

function rawActivitySource(activity) {
  if (!activity) return {};
  if (activity._source && typeof activity._source === "object") return activity._source;
  if (activity.toObject instanceof Function) {
    try { return activity.toObject(false); } catch (_error) { /* Fall through. */ }
    try { return activity.toObject(); } catch (_error) { /* Fall through. */ }
  }
  return activity;
}

function rawActivityDamageParts(activity) {
  return valuesOf(rawActivitySource(activity)?.damage?.parts);
}

function damageRowMatchesBase(row, baseDamage, damageType) {
  if (!row || !baseDamage) return false;
  return Number(row.number) === Number(baseDamage.number)
    && Number(row.denomination) === Number(baseDamage.denomination)
    && String(row.damageType ?? valuesOf(row.types)[0] ?? "") === String(damageType ?? "")
    && !String(row.bonus ?? "").trim();
}

function isSelfImportedItem(item, flags = {}) {
  const uuid = item?.uuid;
  return Boolean(uuid
    && flags.editedFromUuid === uuid
    && flags.templateUuid === uuid
    && flags.baseWeaponUuid === uuid);
}

function isV015FalseBaseDamageImport(item, flags, savedDraft) {
  if (flags?.moduleVersion !== "0.1.5" || !isSelfImportedItem(item, flags)) return false;
  const rows = valuesOf(savedDraft?.overrides?.additionalDamage);
  if (rows.length !== 1) return false;
  const baseDamage = item?.system?.damage?.base ?? {};
  const damageType = valuesOf(baseDamage.types)[0] ?? "";
  if (!damageRowMatchesBase(rows[0], baseDamage, damageType)) return false;

  const parts = rawActivityDamageParts(attackActivity(item));
  return parts.length > 0 && parts.every(part => damageRowMatchesBase(part, baseDamage, damageType));
}

function weaponSourceData(document) {
  if (!document) return null;
  const system = document.system ?? {};
  const damage = system.damage?.base ?? {};
  const versatile = system.damage?.versatile ?? {};
  const activity = attackActivity(document);
  const weaponType = system.type?.value ?? "simpleM";
  const attackType = activity?.attack?.type?.value
    ?? CONFIG.DND5E.weaponTypeMap?.[weaponType]
    ?? "melee";
  const attackAbility = activity?.attack?.ability ?? "";
  const damageTypes = valuesOf(damage.types);
  const versatileTypes = valuesOf(versatile.types);
  const proficient = system.proficient;

  return {
    weaponType,
    attackType,
    attackAbility,
    proficiency: proficient === null || proficient === undefined ? "automatic" : Number(proficient) ? "proficient" : "notProficient",
    baseDamage: {
      number: damage.number ?? 0,
      denomination: damage.denomination ?? 0,
      bonus: damage.bonus ?? ""
    },
    damageType: damageTypes[0] ?? "",
    range: {
      value: system.range?.value ?? 0,
      long: system.range?.long ?? 0,
      reach: system.range?.reach ?? 0,
      units: system.range?.units ?? "ft"
    },
    properties: valuesOf(system.properties).filter(property => property !== "mgc"),
    mastery: system.mastery ?? "",
    weight: {
      value: system.weight?.value ?? system.weight ?? 0,
      units: system.weight?.units ?? "lb"
    },
    price: {
      value: system.price?.value ?? 0,
      denomination: system.price?.denomination ?? CONFIG.DND5E.defaultCurrency ?? "gp"
    },
    quantity: system.quantity ?? 1,
    versatile: {
      number: versatile.number ?? 0,
      denomination: versatile.denomination ?? 0,
      bonus: versatile.bonus ?? "",
      damageType: versatileTypes[0] ?? damageTypes[0] ?? ""
    },
    ammunitionType: system.ammunition?.type ?? "",
    // D&D5e prepends the weapon's base damage to the prepared Activity model when
    // includeBase is enabled. Only source-level parts are actual additional damage.
    additionalDamage: rawActivityDamageParts(activity).map(part => ({
      id: foundry.utils.randomID(),
      number: Number(part?.number) || 0,
      denomination: Number(part?.denomination) || 0,
      damageType: valuesOf(part?.types)[0] ?? "",
      useAbilityModifier: false,
      ability: "",
      bonus: String(part?.bonus ?? ""),
      unlockOnLevel: false,
      unlockLevel: 1,
      progressionGroupId: foundry.utils.randomID(),
      tiers: []
    })).filter(part => part.number > 0 && part.denomination > 0 && part.damageType)
  };
}

function equipmentFormForDocument(document) {
  const saved = document?.flags?.[MODULE_ID]?.draft?.equipmentForm
    ?? document?.flags?.[MODULE_ID]?.equipmentForm;
  if (saved && EQUIPMENT_FORMS.some(form => form.id === saved)) return saved;

  const type = document?.system?.type?.value ?? "";
  if (["light", "medium", "heavy", "natural"].includes(type)) return "armor";
  if (type === "shield") return "shield";
  if (type === "ring") return "ring";

  const properties = valuesOf(document?.system?.properties);
  if (["rod", "wand"].includes(type) || properties.includes("foc")) return "focus";

  const identity = `${document?.name ?? ""} ${document?.system?.identifier ?? ""} ${document?.system?.type?.baseItem ?? ""}`
    .toLowerCase();
  const matches = pattern => pattern.test(identity);
  if (matches(/\b(cloak|cape|mantle)\b/)) return "cloak";
  if (matches(/\b(robe|vestment|vestments|shirt|tunic|garb)\b/)) return "torso";
  if (matches(/\b(helm|helmet|hat|hood|crown|circlet|tiara|headband)\b/)) return "headwear";
  if (matches(/\b(amulet|necklace|periapt|medallion|pendant|talisman)\b/)) return "neck";
  if (matches(/\b(glove|gloves|gauntlet|gauntlets|bracer|bracers)\b/)) return "hands";
  if (matches(/\b(boot|boots|slipper|slippers|shoe|shoes|sandal|sandals)\b/)) return "feet";
  if (matches(/\b(belt|girdle|sash)\b/)) return "waist";
  if (matches(/\b(focus|catalyst|orb|crystal|symbol|totem)\b/)) return "focus";

  if (type === "clothing") return "torso";
  if (type === "wondrous") return "accessory";
  return "other";
}

function defaultDexCap(type) {
  if (type === "medium") return 2;
  if (type === "heavy" || type === "shield") return 0;
  return null;
}

function equipmentSourceData(document) {
  if (!document) return null;
  const system = document.system ?? {};
  const nativeType = system.type?.value ?? "wondrous";
  const properties = valuesOf(system.properties).filter(property => property !== "mgc");
  const proficient = system.proficient;
  const armorValue = Number(system.armor?.base ?? system.armor?.value ?? 0) || 0;
  const armorDex = system.armor?.dex === null || system.armor?.dex === undefined
    ? defaultDexCap(nativeType)
    : Number(system.armor.dex);
  return {
    equipmentForm: equipmentFormForDocument(document),
    nativeType,
    baseItem: system.type?.baseItem ?? system.identifier ?? "",
    quantity: Number(system.quantity) || 1,
    weight: {
      value: Number(system.weight?.value ?? system.weight ?? 0) || 0,
      units: system.weight?.units ?? "lb"
    },
    price: {
      value: Number(system.price?.value ?? 0) || 0,
      denomination: system.price?.denomination ?? CONFIG.DND5E.defaultCurrency ?? "gp"
    },
    properties,
    proficient: proficient === null || proficient === undefined ? "automatic" : Number(proficient) ? "proficient" : "notProficient",
    armor: {
      value: armorValue,
      dex: Number.isFinite(armorDex) ? armorDex : null,
      magicalBonus: String(system.armor?.magicalBonus ?? "")
    },
    strength: system.strength === null || system.strength === undefined ? 0 : Number(system.strength) || 0,
    stealthDisadvantage: properties.includes("stealthDisadvantage"),
    focus: properties.includes("foc")
  };
}

function equipmentEnhancementDefaults() {
  const defaults = enhancementDefaults();
  return {
    magicalItem: clone(defaults.magicalWeapon),
    armorEnhancement: progressionValue({ bonus: 1 }, { tierable: true }),
    baseArmorClass: progressionValue({ value: 10 }),
    removeStrengthRequirement: progressionValue({}),
    removeStealthDisadvantage: progressionValue({}),
    grantedSpellcasting: clone(defaults.grantedSpellcasting),
    ignoreResistance: clone(defaults.ignoreResistance),
    conditionalAdvantage: clone(defaults.conditionalAdvantage)
  };
}

function toolSourceData(document) {
  if (!document) return null;
  const system = document.system ?? {};
  const baseItem = system.type?.baseItem ?? system.identifier ?? "";
  const proficient = system.proficient;
  return {
    toolType: system.type?.value ?? "art",
    baseItem,
    ability: system.ability ?? CONFIG.DND5E.tools?.[baseItem]?.ability ?? "",
    bonus: String(system.bonus ?? ""),
    proficiency: proficient === null || proficient === undefined ? "automatic"
      : Number(proficient) >= 2 ? "expertise"
        : Number(proficient) >= 1 ? "proficient" : "notProficient",
    quantity: Number(system.quantity) || 1,
    weight: {
      value: Number(system.weight?.value ?? system.weight ?? 0) || 0,
      units: system.weight?.units ?? "lb"
    },
    price: {
      value: Number(system.price?.value ?? 0) || 0,
      denomination: system.price?.denomination ?? CONFIG.DND5E.defaultCurrency ?? "gp"
    },
    properties: valuesOf(system.properties).filter(property => property !== "mgc")
  };
}

function toolEnhancementDefaults() {
  const defaults = enhancementDefaults();
  return {
    magicalTool: clone(defaults.magicalWeapon),
    grantedSpellcasting: clone(defaults.grantedSpellcasting),
    ignoreResistance: clone(defaults.ignoreResistance),
    conditionalAdvantage: clone(defaults.conditionalAdvantage)
  };
}

function enhancementDefaultsForType(type) {
  if (type === "equipment") return equipmentEnhancementDefaults();
  if (type === "tool") return toolEnhancementDefaults();
  return enhancementDefaults();
}

function clone(value) {
  return foundry.utils.deepClone(value);
}

function queryEditorSurface(editor) {
  if (!editor) return null;
  const selector = '.ProseMirror, .editor-content[contenteditable="true"], [contenteditable="true"]';
  return editor.shadowRoot?.querySelector?.(selector) ?? editor.querySelector?.(selector) ?? null;
}

function readDescriptionEditorValue(editor) {
  if (!editor) return null;

  const editable = queryEditorSurface(editor);
  if (editable) return editable.innerHTML;

  const roots = [editor.shadowRoot, editor].filter(Boolean);
  for (const root of roots) {
    const namedInput = root.querySelector?.('[name="system.description.value"]');
    if (namedInput && typeof namedInput.value === "string") return namedInput.value;
  }

  if (typeof editor.value === "string") return editor.value;

  const attributeValue = editor.getAttribute?.("value");
  return attributeValue === null || attributeValue === undefined ? null : String(attributeValue);
}

function displayDamage(data, damageTypeLabel) {
  if (!data) return "—";
  const dice = data.number && data.denomination ? `${data.number}d${data.denomination}` : "0";
  const bonus = String(data.bonus ?? "").trim();
  return `${dice}${bonus ? ` + ${bonus}` : ""}${damageTypeLabel ? ` ${damageTypeLabel}` : ""}`;
}

function damageDiceOptions(selected) {
  return [4, 6, 8, 10, 12, 20].map(value => ({
    value,
    label: `d${value}`,
    selected: Number(selected) === value
  }));
}

function abilityModifierOptions(selected) {
  return [
    { value: "attack", label: "Attack Ability", selected: selected === "attack" },
    { value: "spellcasting", label: "Spellcasting Ability", selected: selected === "spellcasting" },
    ...Object.entries(CONFIG.DND5E.abilities ?? {}).map(([value, entry]) => ({
      value,
      label: localizedLabel(entry, value),
      selected: selected === value
    }))
  ];
}

function additionalDamageLabel(row) {
  const type = localizedLabel(CONFIG.DND5E.damageTypes?.[row.damageType], row.damageType || "Untyped");
  const ability = row.useAbilityModifier
    ? abilityModifierOptions(row.ability).find(option => option.selected)?.label ?? "Ability Modifier"
    : "";
  return `${row.number}d${row.denomination}${ability ? ` + ${ability}` : ""} ${type}`;
}

function rawTemplateDescription(item) {
  const description = item?.system?.description;
  if (typeof description === "string") return description;
  return String(description?.value ?? "");
}

function looksLikeTemplateMetadata(text) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return /^(?:magic\s+)?weapon\s*(?:\([^)]*\))?\s*,\s*(?:common|uncommon|rare|very rare|legendary|artifact|varies|rarity varies|unknown)(?:\s*\([^)]*attunement[^)]*\))?\.?$/i.test(normalized)
    || /^(?:magic\s+)?weapon\s*\((?:any|any [^)]+)\)/i.test(normalized)
    || /^(?:this )?template (?:can be|is|applies to|may be applied to)\b/i.test(normalized)
    || /^apply this template to\b/i.test(normalized)
    || /^choose (?:a|an|any) (?:weapon|sword|axe|bow|crossbow|polearm|melee weapon|ranged weapon)\b/i.test(normalized);
}

function cleanTemplateDescription(item) {
  const html = rawTemplateDescription(item).trim();
  if (!html) return "";
  const host = globalThis.document?.createElement?.("div");
  if (!host) return html;
  host.innerHTML = html;
  let removed = 0;
  while (host.firstElementChild && removed < 4) {
    const node = host.firstElementChild;
    if (!looksLikeTemplateMetadata(node.textContent)) break;
    node.remove();
    removed += 1;
  }
  return host.innerHTML.trim();
}

function stripGeneratedDescription(html) {
  const source = String(html ?? "").trim();
  if (!source) return "";
  const host = globalThis.document?.createElement?.("div");
  if (!host) return source;
  host.innerHTML = source;
  host.querySelectorAll('[data-item-creator-generated], .item-creator-runtime-rules').forEach(node => node.remove());
  return host.innerHTML.trim();
}

function mergeWithDefaults(defaults, stored) {
  return foundry.utils.mergeObject(clone(defaults), clone(stored ?? {}), {
    inplace: false,
    recursive: true,
    overwrite: true,
    insertKeys: true,
    insertValues: true
  });
}

function numericValue(value) {
  const text = String(value ?? "").trim();
  if (!text || !/^[+-]?(?:\d+|\d*[.]\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function parseCriticalDamageFormula(value) {
  const match = String(value ?? "").trim().match(/^(\d+)d(\d+)(?:\[([^\]]+)\])?$/i);
  if (!match) return null;
  return {
    number: Number(match[1]),
    denomination: Number(match[2]),
    damageType: match[3] ?? Object.keys(CONFIG.DND5E.damageTypes ?? {})[0] ?? ""
  };
}

function recoveryName(activity) {
  const period = valuesOf(activity?.uses?.recovery)[0]?.period;
  return period === "sr" ? "shortRest" : "longRest";
}

function spellbookIntent(activity) {
  const moduleFlags = activity?.flags?.[MODULE_ID] ?? {};
  if (typeof moduleFlags.showInSpellbook === "boolean") return moduleFlags.showInSpellbook;
  return Boolean(activity?.spell?.spellbook);
}

function inferredAvailability(activity) {
  const configured = activity?.flags?.[MODULE_ID]?.availability;
  if (["owned", "equipped", "equippedAttuned"].includes(configured)) return configured;
  if (activity?.visibility?.requireAttunement) return "equippedAttuned";
  return "owned";
}

async function grantedSpellFromCastActivity(activity) {
  const uuid = activity?.spell?.uuid;
  if (!uuid) return null;
  let spellDocument = null;
  try { spellDocument = await fromUuid(uuid); } catch (_error) { /* Preserve the Activity even when the source is unavailable. */ }
  const source = spellDocument ? spellSourceData(spellDocument) : null;
  const level = Number(activity?.flags?.[MODULE_ID]?.baseLevel ?? source?.level ?? activity?.spell?.level ?? 0);
  const useMax = Number(activity?.uses?.max ?? 0);
  const limited = Number.isFinite(useMax) && useMax > 0;
  const targets = valuesOf(activity?.consumption?.targets);
  const slotTarget = targets.find(target => target?.type === "spellSlots");
  const consumeSlot = Boolean(activity?.consumption?.spellSlot || slotTarget);
  const moduleFlags = activity?.flags?.[MODULE_ID] ?? {};
  const fixedChallenge = Boolean(activity?.spell?.challenge?.override);
  const attackRaw = activity?.spell?.challenge?.attack;
  const saveRaw = activity?.spell?.challenge?.save;
  const attack = attackRaw === null || attackRaw === undefined || attackRaw === "" ? null : Number(attackRaw);
  const save = saveRaw === null || saveRaw === undefined || saveRaw === "" ? null : Number(saveRaw);
  const castLevel = Number(activity?.spell?.level ?? level);
  return {
    id: foundry.utils.randomID(),
    uuid,
    name: activity?.name || spellDocument?.name || "Granted Spell",
    img: activity?.img || spellDocument?.img || "icons/svg/book.svg",
    source: spellDocument ? `${ItemCreatorSourceRegistry.instance.describeDocument(spellDocument).sourceLabel} — ${ItemCreatorSourceRegistry.instance.describeDocument(spellDocument).packLabel}` : "Imported Cast Activity",
    level: Number.isFinite(level) ? Math.clamp(level, 0, 9) : 0,
    school: source?.school ?? spellDocument?.system?.school ?? "",
    hasAttack: source?.hasAttack ?? (attack !== null && Number.isFinite(attack)),
    hasSave: source?.hasSave ?? (save !== null && Number.isFinite(save)),
    useLimit: limited ? "limited" : "unlimited",
    maxUses: limited ? useMax : 1,
    recovery: recoveryName(activity),
    consumeSlot,
    eligibility: moduleFlags.eligibility ?? (consumeSlot ? "compatibleSlot" : "independent"),
    castLevelMode: moduleFlags.castLevelMode ?? (consumeSlot && slotTarget?.scaling?.mode === "level" ? "slot" : castLevel > level ? "fixed" : "base"),
    fixedCastLevel: Number.isFinite(castLevel) ? castLevel : level,
    spellcastingMode: moduleFlags.spellcastingMode ?? (fixedChallenge ? "fixed" : activity?.spell?.ability || "actorDefault"),
    fixedAttackBonus: attack !== null && Number.isFinite(attack) ? attack : 5,
    fixedSaveDc: save !== null && Number.isFinite(save) ? save : 13,
    showInSpellbook: spellbookIntent(activity),
    availability: inferredAvailability(activity),
    unlockOnLevel: Boolean(moduleFlags.unlockOnLevel),
    unlockLevel: clampCharacterLevel(moduleFlags.unlockLevel),
    progressionGroupId: moduleFlags.progressionGroupId ?? foundry.utils.randomID(),
    importedActivityId: activity?._id ?? activity?.id ?? null
  };
}

function effectChanges(effect) {
  return valuesOf(effect?.system?.changes ?? effect?.changes);
}

function effectModeName(mode) {
  if (Number(mode) === Number(CONST.ACTIVE_EFFECT_MODES.UPGRADE)) return "minimum";
  if (Number(mode) === Number(CONST.ACTIVE_EFFECT_MODES.OVERRIDE)) return "fixed";
  return "add";
}

function inferGrantedEffects(item) {
  const enabled = {};
  const values = grantedEffectDefaults();
  const managedEffectIds = [];
  for (const effect of valuesOf(item?.effects)) {
    const changes = effectChanges(effect);
    if (!changes.length) continue;
    const availability = effect?.flags?.[MODULE_ID]?.availability ?? "owned";
    const effectId = effect?.id ?? effect?._id;
    const keys = changes.map(change => change.key);

    if (changes.length === 1 && keys[0] === "system.attributes.ac.bonus") {
      enabled.armorClassBonus = true;
      values.armorClassBonus = { bonus: Number(changes[0].value) || 0, availability };
      managedEffectIds.push(effectId);
      continue;
    }

    if (changes.every(change => /^system[.]abilities[.][a-z]{3}[.]value$/.test(change.key))) {
      enabled.abilityScoreAdjustment = true;
      values.abilityScoreAdjustment = {
        entries: changes.map(change => effectRow({
          ability: change.key.split(".")[2],
          operation: effectModeName(change.mode ?? change.type),
          value: Number(change.value) || 0
        })),
        availability
      };
      managedEffectIds.push(effectId);
      continue;
    }

    if (changes.length === 2 && keys.includes("system.bonuses.mwak.attack") && keys.includes("system.bonuses.rwak.attack")) {
      enabled.weaponAttackBonus = true;
      values.weaponAttackBonus = { bonus: Number(changes[0].value) || 0, availability };
      managedEffectIds.push(effectId);
      continue;
    }

    if (changes.length === 2 && keys.includes("system.bonuses.mwak.damage") && keys.includes("system.bonuses.rwak.damage")) {
      enabled.weaponDamageBonus = true;
      values.weaponDamageBonus = { bonus: Number(changes[0].value) || 0, availability };
      managedEffectIds.push(effectId);
      continue;
    }

    if (changes.length === 2 && keys.includes("system.bonuses.msak.attack") && keys.includes("system.bonuses.rsak.attack")) {
      enabled.spellAttackBonus = true;
      values.spellAttackBonus = { bonus: Number(changes[0].value) || 0, availability };
      managedEffectIds.push(effectId);
      continue;
    }

    if (changes.length === 1 && keys[0] === "system.bonuses.spell.dc") {
      enabled.spellSaveDcBonus = true;
      values.spellSaveDcBonus = { bonus: Number(changes[0].value) || 0, availability };
      managedEffectIds.push(effectId);
      continue;
    }

    const criticalChanges = changes.filter(change => ["flags.dnd5e.weaponCriticalThreshold", "flags.dnd5e.spellCriticalThreshold"].includes(change.key));
    if (criticalChanges.length === changes.length) {
      const hasWeapon = criticalChanges.some(change => change.key.endsWith("weaponCriticalThreshold"));
      const hasSpell = criticalChanges.some(change => change.key.endsWith("spellCriticalThreshold"));
      enabled.criticalThreshold = true;
      values.criticalThreshold = {
        threshold: Number(criticalChanges[0]?.value) || 20,
        scope: hasWeapon && hasSpell ? "all" : hasSpell ? "spell" : "weapon",
        availability
      };
      managedEffectIds.push(effectId);
      continue;
    }

    const senseChanges = changes.filter(change => /^system[.]attributes[.]senses[.]ranges[.]/.test(change.key));
    if (senseChanges.length === changes.length) {
      enabled.grantedSense = true;
      values.grantedSense = {
        entries: senseChanges.map(change => effectRow({
          sense: change.key.split(".").at(-1),
          range: Number(change.value) || 0,
          units: "ft",
          operation: effectModeName(change.mode ?? change.type)
        })),
        availability
      };
      managedEffectIds.push(effectId);
      continue;
    }

    const movementChanges = changes.filter(change => /^system[.]attributes[.]movement[.]/.test(change.key));
    if (movementChanges.length === changes.length) {
      const speedChanges = movementChanges.filter(change => !change.key.endsWith(".hover"));
      if (speedChanges.length) {
        enabled.grantMovementType = true;
        values.grantMovementType = {
          entries: speedChanges.map(change => effectRow({
            type: change.key.split(".").at(-1),
            speed: Number(change.value) || 0,
            units: "ft",
            hover: movementChanges.some(entry => entry.key.endsWith(".hover") && String(entry.value) !== "false")
          })),
          availability
        };
        managedEffectIds.push(effectId);
      }
    }
  }
  return { enabled, values, managedEffectIds: managedEffectIds.filter(Boolean) };
}

async function enrichDescription(html, relativeTo) {
  const editor = foundry.applications?.ux?.TextEditor?.implementation
    ?? CONFIG.ux?.TextEditor
    ?? globalThis.TextEditor;
  if (!editor?.enrichHTML) return html;
  try {
    return await editor.enrichHTML(html ?? "", { relativeTo, secrets: true, documents: true });
  } catch (error) {
    console.warn(`${MODULE_ID} | Unable to enrich template description.`, error);
    return html ?? "";
  }
}

function spellSourceData(document) {
  if (!document) return null;
  const system = document.system ?? {};
  const activities = valuesOf(system.activities);
  const level = Number(system.level ?? 0);
  return {
    level: Number.isFinite(level) ? Math.clamp(level, 0, 9) : 0,
    school: system.school ?? "",
    hasAttack: activities.some(activity => activity?.type === "attack"),
    hasSave: activities.some(activity => activity?.type === "save")
  };
}

function spellLevelLabel(level) {
  return localizedLabel(CONFIG.DND5E.spellLevels?.[level], level === 0 ? "Cantrip" : `Level ${level}`);
}

function progressionValue(value = {}, { tierable = false } = {}) {
  return {
    ...value,
    unlockOnLevel: false,
    unlockLevel: 1,
    progressionGroupId: "",
    ...(tierable ? { tiers: [] } : {})
  };
}

const REPEATABLE_ENHANCEMENTS = new Set(["weaponEnhancement", "armorEnhancement"]);
const REPEATABLE_GRANTED_EFFECTS = new Set([
  "armorClassBonus", "weaponAttackBonus", "weaponDamageBonus",
  "initiativeBonus", "proficiencyBonusModifier", "maximumHitPointsBonus",
  "spellAttackBonus", "spellSaveDcBonus"
]);

function ensureProgressionGroup(setting) {
  if (!setting || typeof setting !== "object") return;
  setting.progressionGroupId ||= foundry.utils.randomID();
  setting.unlockOnLevel = Boolean(setting.unlockOnLevel);
  setting.unlockLevel = clampCharacterLevel(setting.unlockLevel);
}

function enhancementDefaults() {
  const firstDamageType = CONFIG.DND5E.damageTypes?.fire
    ? "fire"
    : Object.keys(CONFIG.DND5E.damageTypes ?? {})[0] ?? "";
  return {
    magicalWeapon: progressionValue({ rarity: "uncommon", attunement: "" }),
    weaponEnhancement: progressionValue({ bonus: 1 }, { tierable: true }),
    attackBonus: progressionValue({ bonus: 1 }),
    damageBonus: progressionValue({ bonus: 1 }),
    criticalThreshold: progressionValue({ mode: "19", custom: 19 }),
    extraCriticalDamage: progressionValue({ number: 1, denomination: 8, damageType: firstDamageType }),
    ignoreResistance: progressionValue({ damageTypes: firstDamageType ? [firstDamageType] : [] }),
    grantedSpellcasting: { spells: [] },
    conditionalAdvantage: progressionValue({
      mode: "supported",
      appliesTo: "attackRolls",
      supportedCondition: "targetUndead",
      customText: ""
    })
  };
}

function fixedOptions(entries, selected) {
  return entries.map(([value, label]) => ({ value, label, selected: String(selected ?? "") === String(value) }));
}


function effectRow(values = {}) {
  return { id: foundry.utils.randomID(), ...values };
}

function effectAvailabilityOptions(selected) {
  return fixedOptions([
    ["owned", "Item is Owned"],
    ["equipped", "Equipped"],
    ["equippedAttuned", "Equipped and Attuned"]
  ], selected);
}

function allAbilityOptions(selected, { allValue = "all", allLabel = "All Abilities" } = {}) {
  return [
    { value: allValue, label: allLabel, selected: selected === allValue },
    ...Object.entries(CONFIG.DND5E.abilities ?? {}).map(([value, entry]) => ({
      value,
      label: localizedLabel(entry, value),
      selected: selected === value
    }))
  ];
}

function allSkillOptions(selected, { allValue = "all", allLabel = "All Skills" } = {}) {
  return [
    { value: allValue, label: allLabel, selected: selected === allValue },
    ...Object.entries(CONFIG.DND5E.skills ?? {}).map(([value, entry]) => ({
      value,
      label: localizedLabel(entry, value),
      selected: selected === value
    }))
  ];
}

function movementTypeOptions(selected) {
  const source = CONFIG.DND5E.movementTypes ?? {
    walk: "Walking", fly: "Flying", swim: "Swimming", climb: "Climbing", burrow: "Burrowing"
  };
  return Object.entries(source).map(([value, entry]) => ({
    value,
    label: localizedLabel(entry, value),
    selected: selected === value
  }));
}

function senseTypeOptions(selected) {
  const source = CONFIG.DND5E.senses ?? CONFIG.DND5E.senseTypes ?? {
    darkvision: "Darkvision", blindsight: "Blindsight", tremorsense: "Tremorsense", truesight: "Truesight"
  };
  return Object.entries(source).map(([value, entry]) => ({
    value,
    label: localizedLabel(entry, value),
    selected: selected === value
  }));
}

function conditionTypeOptions(selectedValues = []) {
  const selected = new Set(selectedValues ?? []);
  const source = CONFIG.DND5E.conditionTypes ?? CONFIG.statusEffects?.reduce((acc, effect) => {
    if (effect?.id) acc[effect.id] = effect.name ?? effect.label ?? effect.id;
    return acc;
  }, {}) ?? {};
  return Object.entries(source).map(([value, entry]) => ({
    value,
    label: localizedLabel(entry, value),
    selected: selected.has(value)
  })).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
}

function grantedEffectDefaults() {
  const firstDamageType = Object.keys(CONFIG.DND5E.damageTypes ?? {})[0] ?? "";
  const firstAbility = Object.keys(CONFIG.DND5E.abilities ?? {})[0] ?? "str";
  const firstSkill = Object.keys(CONFIG.DND5E.skills ?? {})[0] ?? "prc";
  const firstMovement = Object.keys(CONFIG.DND5E.movementTypes ?? {})[0] ?? "walk";
  const firstSense = Object.keys(CONFIG.DND5E.senses ?? CONFIG.DND5E.senseTypes ?? {})[0] ?? "darkvision";
  return {
    armorClassBonus: progressionValue({ bonus: 1, availability: "equipped" }, { tierable: true }),
    weaponAttackBonus: progressionValue({ bonus: 1, availability: "equipped" }, { tierable: true }),
    weaponDamageBonus: progressionValue({ bonus: 1, availability: "equipped" }, { tierable: true }),
    criticalThreshold: progressionValue({ threshold: 19, scope: "all", availability: "equipped" }),
    savingThrowBonus: progressionValue({ entries: [effectRow({ target: "all", mode: "fixed", bonus: 1 })], availability: "equipped" }),
    savingThrowAdvantage: progressionValue({ entries: [effectRow({ target: "all" })], availability: "equipped" }),
    abilityScoreAdjustment: progressionValue({ entries: [effectRow({ ability: firstAbility, operation: "add", value: 1 })], availability: "equipped" }),
    abilityCheckBonus: progressionValue({ entries: [effectRow({ target: "all", bonus: 1 })], availability: "equipped" }),
    skillBonus: progressionValue({ entries: [effectRow({ target: firstSkill, bonus: 1 })], availability: "equipped" }),
    skillProficiency: progressionValue({ entries: [effectRow({ skill: firstSkill, level: "proficient" })], availability: "equipped" }),
    abilityCheckAdvantage: progressionValue({ entries: [effectRow({ target: "all" })], availability: "equipped" }),
    damageResistance: progressionValue({ damageTypes: firstDamageType ? [firstDamageType] : [], availability: "equipped" }),
    damageImmunity: progressionValue({ damageTypes: firstDamageType ? [firstDamageType] : [], availability: "equipped" }),
    damageVulnerability: progressionValue({ damageTypes: firstDamageType ? [firstDamageType] : [], availability: "equipped" }),
    conditionImmunity: progressionValue({ conditions: [], availability: "equipped" }),
    initiativeBonus: progressionValue({ bonus: 1, availability: "equipped" }, { tierable: true }),
    initiativeAdvantage: progressionValue({ availability: "equipped" }),
    proficiencyBonusModifier: progressionValue({ bonus: 1, availability: "equipped" }, { tierable: true }),
    maximumHitPointsBonus: progressionValue({ bonus: 10, availability: "equipped" }, { tierable: true }),
    movementBonus: progressionValue({ entries: [effectRow({ type: firstMovement, bonus: 10, units: "ft" })], availability: "equipped" }),
    grantMovementType: progressionValue({ entries: [effectRow({ type: "fly", speed: 30, units: "ft", hover: false })], availability: "equipped" }),
    grantedSense: progressionValue({ entries: [effectRow({ sense: firstSense, range: 60, units: "ft", operation: "minimum" })], availability: "equipped" }),
    spellAttackBonus: progressionValue({ bonus: 1, availability: "equipped" }, { tierable: true }),
    spellSaveDcBonus: progressionValue({ bonus: 1, availability: "equipped" }, { tierable: true }),
    passiveScoreBonus: progressionValue({ entries: [effectRow({ score: "perception", bonus: 5 })], availability: "equipped" })
  };
}

function effectEntryOptions(key, row) {
  switch (key) {
    case "savingThrowBonus": {
      const valueMode = row.mode === "proficiency" ? "proficiency" : "fixed";
      return {
        targetOptions: allAbilityOptions(row.target, { allLabel: "All Saving Throws" }),
        valueModeOptions: fixedOptions([["fixed", "Fixed Modifier"], ["proficiency", "Proficiency Bonus"]], valueMode),
        fixedValueMode: valueMode === "fixed"
      };
    }
    case "savingThrowAdvantage":
      return { targetOptions: allAbilityOptions(row.target, { allLabel: "All Saving Throws" }) };
    case "abilityScoreAdjustment":
      return {
        abilityOptions: configOptions(CONFIG.DND5E.abilities, row.ability),
        operationOptions: fixedOptions([["add", "Add / Subtract"], ["minimum", "Minimum Score"], ["fixed", "Fixed Score"]], row.operation)
      };
    case "abilityCheckBonus":
      return { targetOptions: allAbilityOptions(row.target, { allLabel: "All Ability Checks" }) };
    case "skillBonus":
      return { targetOptions: allSkillOptions(row.target) };
    case "skillProficiency":
      return {
        skillOptions: configOptions(CONFIG.DND5E.skills, row.skill),
        levelOptions: fixedOptions([["proficient", "Proficient"], ["expertise", "Expertise"]], row.level)
      };
    case "abilityCheckAdvantage":
      return {
        targetOptions: [
          { value: "all", label: "All Ability Checks", selected: row.target === "all" },
          ...Object.entries(CONFIG.DND5E.abilities ?? {}).map(([value, entry]) => ({ value: `ability:${value}`, label: `All ${localizedLabel(entry, value)} Checks`, selected: row.target === `ability:${value}` })),
          ...Object.entries(CONFIG.DND5E.skills ?? {}).map(([value, entry]) => ({ value: `skill:${value}`, label: localizedLabel(entry, value), selected: row.target === `skill:${value}` }))
        ]
      };
    case "movementBonus":
      return { typeOptions: movementTypeOptions(row.type), unitOptions: configOptions(CONFIG.DND5E.movementUnits, row.units) };
    case "grantMovementType":
      return { typeOptions: movementTypeOptions(row.type), unitOptions: configOptions(CONFIG.DND5E.movementUnits, row.units) };
    case "grantedSense":
      return {
        senseOptions: senseTypeOptions(row.sense),
        unitOptions: configOptions(CONFIG.DND5E.movementUnits, row.units),
        operationOptions: fixedOptions([["minimum", "Set Minimum Range"], ["add", "Add to Existing Range"], ["fixed", "Fixed Range"]], row.operation)
      };
    case "passiveScoreBonus":
      return { scoreOptions: fixedOptions([["perception", "Passive Perception"], ["investigation", "Passive Investigation"], ["insight", "Passive Insight"]], row.score) };
    default:
      return {};
  }
}

export class ItemCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ editItem = null, ...options } = {}) {
    super(options);
    this.editingItem = editItem;
    this.editingItemId = editItem?.id ?? null;
    this.editingManagedItem = false;
    this.editingImportedItem = false;
    this.editStateInitialized = false;
    this.originalItemSource = editItem?.toObject?.() ? clone(editItem.toObject()) : null;
    this.replaceAttackDamageParts = false;
    this.managedActivityIds = [];
    this.managedPrimaryAttackId = null;
    this.preserveAdditionalAttackActivities = false;
    this.managedEffectIds = [];
    this.customImportedEffects = [];
    this.customImportedActivities = [];
    this.importedBaseSummary = [];
    this.step = editItem ? "baseItem" : "itemType";
    this.selectedType = null;
    this.selectedWeaponUuid = null;
    this.selectedWeaponDocument = null;
    this.inheritedBaseWeaponUuid = null;
    this.selectedBaseWeaponUuid = null;
    this.selectedBaseWeaponDocument = null;
    this.baseWeaponRequired = false;
    this.equipmentForm = "accessory";
    this.itemName = "";
    this.selectedIcon = "";
    this.templateCategory = "all";
    this.loadingWeapon = false;
    this.customized = {};
    this.overrides = {};
    this.enhancements = {};
    this.enhancementValues = enhancementDefaultsForType(editItem?.type);
    this.magicalAutoFromGrantedSpellcasting = false;
    this.grantedEffects = {};
    this.grantedEffectValues = grantedEffectDefaults();
    this.resourceModifications = [];
    this.triggeredEffects = [];
    this.templateDescription = "";
    this.templateDescriptionRaw = "";
    this.customDescription = "";
    this.descriptionCustomized = false;
    this.reviewBuildError = "";
    this.savingItem = false;
    this.restoreScrollTop = null;
    this.sourceRegistryValidated = false;
    this.templateBrowserOpen = false;
    this.spellBrowserOpen = false;
    this.triggerBrowserOpen = false;
    this.iconBrowserApp = null;
  }

  static DEFAULT_OPTIONS = {
    id: "dnd5e-item-creator",
    classes: ["item-creator", "standard-form"],
    tag: "form",
    position: { width: 1240, height: 840 },
    window: { title: "Item Creator", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/item-creator.hbs` }
  };

  async #translateDocumentMechanics(document, { merge = false, ignoreGenerated = false } = {}) {
    if (!document) return;
    const ignoreEffectIds = new Set();
    const ignoreActivityIds = new Set();
    if (ignoreGenerated) {
      for (const effect of valuesOf(document.effects)) {
        const flags = effect?.flags?.[MODULE_ID] ?? {};
        if (flags.blueprint || flags.importedCustom) ignoreEffectIds.add(effect.id ?? effect._id);
      }
      for (const activity of valuesOf(document.system?.activities)) {
        const flags = activity?.flags?.[MODULE_ID] ?? {};
        if (flags.grantedSpell || flags.importedCustom) ignoreActivityIds.add(activity.id ?? activity._id);
      }
    }

    // When editing a managed Item, an external scalar Effect that targets a
    // Creator field already in use must remain an explicit independent custom
    // Effect. This prevents silent data loss and makes intentional stacking visible.
    const scalarKeys = new Set([
      "armorClassBonus", "weaponAttackBonus", "weaponDamageBonus", "criticalThreshold",
      "initiativeBonus", "initiativeAdvantage", "proficiencyBonusModifier",
      "maximumHitPointsBonus", "spellAttackBonus", "spellSaveDcBonus"
    ]);
    const blockedKeys = merge
      ? new Set([...scalarKeys].filter(key => Boolean(this.grantedEffects[key])))
      : new Set();
    const normalized = normalizeBaseItemMechanics(document, { ignoreEffectIds, ignoreActivityIds, blockedKeys });
    if (!merge) {
      this.customImportedEffects = [];
      this.customImportedActivities = [];
      this.importedBaseSummary = [];
    }

    const defaults = grantedEffectDefaults();
    for (const [key, active] of Object.entries(normalized.enabled ?? {})) {
      if (!active) continue;
      const importedValue = mergeWithDefaults(defaults[key] ?? {}, normalized.values?.[key] ?? {});
      if (!merge || !this.grantedEffects[key]) {
        this.grantedEffects[key] = true;
        this.grantedEffectValues[key] = importedValue;
        ensureProgressionGroup(this.grantedEffectValues[key]);
        continue;
      }
      if (Array.isArray(importedValue.entries) && Array.isArray(this.grantedEffectValues[key]?.entries)) {
        this.grantedEffectValues[key].entries.push(...clone(importedValue.entries));
      }
    }

    const existingEffectSources = new Set(this.customImportedEffects.map(entry => entry.sourceId).filter(Boolean));
    for (const entry of normalized.customEffects ?? []) {
      if (!entry.sourceId || !existingEffectSources.has(entry.sourceId)) this.customImportedEffects.push(clone(entry));
    }
    const existingActivitySources = new Set(this.customImportedActivities.map(entry => entry.sourceId).filter(Boolean));
    for (const entry of normalized.customActivities ?? []) {
      if (!entry.sourceId || !existingActivitySources.has(entry.sourceId)) this.customImportedActivities.push(clone(entry));
    }

    this.managedEffectIds = [...new Set([...this.managedEffectIds, ...(normalized.managedEffectIds ?? [])])];
    this.managedActivityIds = [...new Set([...this.managedActivityIds, ...(normalized.managedActivityIds ?? [])])];
    this.importedBaseSummary = [...new Set([...this.importedBaseSummary, ...(normalized.summary ?? [])])];

    this.enhancementValues.grantedSpellcasting ??= { spells: [] };
    this.enhancementValues.grantedSpellcasting.spells ??= [];
    const spells = this.enhancementValues.grantedSpellcasting.spells;
    for (const cast of normalized.castActivities ?? []) {
      const imported = await grantedSpellFromCastActivity(cast);
      if (!imported || spells.some(spell => spell.uuid === imported.uuid && spell.importedActivityId === imported.importedActivityId)) continue;
      spells.push(imported);
    }
    if (spells.length) this.enhancements.grantedSpellcasting = true;

    const properties = valuesOf(document.system?.properties);
    const attunement = String(document.system?.attunement ?? "").trim();
    const magical = properties.includes("mgc") || Boolean(document.system?.rarity)
      || Boolean(attunement && attunement !== "none");
    if (document.type === "weapon") {
      if (magical && (!merge || !this.enhancements.magicalWeapon)) {
        this.enhancements.magicalWeapon = true;
        this.enhancementValues.magicalWeapon = mergeWithDefaults(enhancementDefaults().magicalWeapon, {
          rarity: document.system?.rarity || "uncommon", attunement: document.system?.attunement || ""
        });
      }
      const bonus = Number(document.system?.magicalBonus);
      if (Number.isFinite(bonus) && bonus !== 0 && (!merge || !this.enhancements.weaponEnhancement)) {
        this.enhancements.weaponEnhancement = true;
        this.enhancementValues.weaponEnhancement = mergeWithDefaults(enhancementDefaults().weaponEnhancement, { bonus });
      }
      const activity = attackActivity(document);
      const attackBonus = numericValue(activity?.attack?.bonus);
      if (attackBonus !== null && attackBonus !== 0 && (!merge || !this.enhancements.attackBonus)) {
        this.enhancements.attackBonus = true;
        this.enhancementValues.attackBonus = mergeWithDefaults(enhancementDefaults().attackBonus, { bonus: attackBonus });
      }
      const threshold = Number(activity?.attack?.critical?.threshold);
      if (Number.isInteger(threshold) && threshold > 0 && (!merge || !this.enhancements.criticalThreshold)) {
        this.enhancements.criticalThreshold = true;
        this.enhancementValues.criticalThreshold = mergeWithDefaults(enhancementDefaults().criticalThreshold, {
          mode: [18, 19, 20].includes(threshold) ? String(threshold) : "custom", custom: threshold
        });
      }
      const criticalDamage = parseCriticalDamageFormula(activity?.damage?.critical?.bonus);
      if (criticalDamage && (!merge || !this.enhancements.extraCriticalDamage)) {
        this.enhancements.extraCriticalDamage = true;
        this.enhancementValues.extraCriticalDamage = mergeWithDefaults(enhancementDefaults().extraCriticalDamage, criticalDamage);
      }
    } else if (document.type === "equipment") {
      if (magical && (!merge || !this.enhancements.magicalItem)) {
        this.enhancements.magicalItem = true;
        this.enhancementValues.magicalItem = mergeWithDefaults(equipmentEnhancementDefaults().magicalItem, {
          rarity: document.system?.rarity || "uncommon", attunement: document.system?.attunement || ""
        });
      }
      const bonus = Number(document.system?.armor?.magicalBonus);
      if (Number.isFinite(bonus) && bonus !== 0 && (!merge || !this.enhancements.armorEnhancement)) {
        this.enhancements.armorEnhancement = true;
        this.enhancementValues.armorEnhancement = mergeWithDefaults(equipmentEnhancementDefaults().armorEnhancement, { bonus });
      }
    } else if (document.type === "tool" && magical && (!merge || !this.enhancements.magicalTool)) {
      this.enhancements.magicalTool = true;
      this.enhancementValues.magicalTool = mergeWithDefaults(toolEnhancementDefaults().magicalTool, {
        rarity: document.system?.rarity || "uncommon", attunement: document.system?.attunement || ""
      });
    }
    this.#syncGrantedSpellMagicalState();
  }

  async #initializeEditState(registry) {
    if (this.editStateInitialized || !this.editingItem) return;
    const item = this.editingItem;
    if (item.parent || item.pack || !isSupportedItemDocument(item)) {
      throw new Error("Only world Weapon, Equipment, and Tool Items can be edited with Item Creator.");
    }

    this.selectedType = item.type;
    this.itemName = item.name ?? "";
    this.selectedIcon = item.img ?? "";
    const flags = item.flags?.[MODULE_ID] ?? {};
    const savedDraft = flags.draft;
    this.editingManagedItem = Boolean(flags.created && savedDraft);
    this.editingImportedItem = !this.editingManagedItem || Boolean(flags.importedItem) || (item.type === "weapon" && isSelfImportedItem(item, flags));

    if (["equipment", "tool"].includes(item.type)) {
      const isEquipment = item.type === "equipment";
      const defaults = enhancementDefaultsForType(item.type);
      const magicalKey = isEquipment ? "magicalItem" : "magicalTool";
      const getDocument = uuid => isEquipment ? registry.getEquipmentDocument(uuid) : registry.getToolDocument(uuid);
      if (isEquipment) this.equipmentForm = savedDraft?.equipmentForm ?? flags.equipmentForm ?? equipmentFormForDocument(item);

      if (this.editingManagedItem) {
        this.selectedWeaponUuid = flags.templateUuid || item.uuid;
        this.selectedBaseWeaponUuid = isEquipment
          ? (flags.baseEquipmentUuid || flags.baseItemUuid || flags.templateUuid || item.uuid)
          : (flags.baseToolUuid || flags.baseItemUuid || flags.templateUuid || item.uuid);
        this.selectedWeaponDocument = await getDocument(this.selectedWeaponUuid) ?? item;
        this.selectedBaseWeaponDocument = await getDocument(this.selectedBaseWeaponUuid) ?? item;
        this.customized = clone(savedDraft.customized ?? {});
        this.overrides = clone(savedDraft.overrides ?? {});
        this.enhancements = clone(savedDraft.enhancements ?? {});
        this.enhancementValues = mergeWithDefaults(defaults, savedDraft.enhancementValues);
        this.magicalAutoFromGrantedSpellcasting = Boolean(savedDraft.magicAutomation?.magicalFromGrantedSpellcasting);
        this.grantedEffects = clone(savedDraft.grantedEffects ?? {});
        this.grantedEffectValues = mergeWithDefaults(grantedEffectDefaults(), savedDraft.grantedEffectValues);
        this.resourceModifications = (savedDraft.resourceModifications ?? []).map(normalizeResourceModification);
        this.triggeredEffects = (savedDraft.triggeredEffects ?? []).map(normalizeTriggeredEffect);
        this.descriptionCustomized = Boolean(savedDraft.descriptionCustomized);
        this.templateDescriptionRaw = rawTemplateDescription(this.selectedWeaponDocument);
        this.templateDescription = cleanTemplateDescription(this.selectedWeaponDocument);
        this.customDescription = this.descriptionCustomized
          ? stripGeneratedDescription(item.system?.description?.value)
          : this.templateDescriptionRaw;
        this.managedActivityIds = valuesOf(item.system?.activities)
          .filter(activity => activity?.type === "cast" && activity?.flags?.[MODULE_ID]?.grantedSpell)
          .map(activity => activity.id ?? activity._id)
          .filter(Boolean);
        this.managedEffectIds = valuesOf(item.effects)
          .filter(effect => effect?.flags?.[MODULE_ID]?.blueprint)
          .map(effect => effect.id ?? effect._id)
          .filter(Boolean);
        this.customImportedEffects = clone(savedDraft.customImportedEffects ?? []);
        this.customImportedActivities = clone(savedDraft.customImportedActivities ?? []);
        this.importedBaseSummary = clone(savedDraft.importedBaseSummary ?? []);
        await this.#translateDocumentMechanics(item, { merge: true, ignoreGenerated: true });
      } else {
        this.selectedWeaponUuid = item.uuid;
        this.selectedWeaponDocument = item;
        this.selectedBaseWeaponUuid = item.uuid;
        this.selectedBaseWeaponDocument = item;
        this.inheritedBaseWeaponUuid = item.uuid;
        this.customized = {};
        this.overrides = {};

        if (isEquipment) {
          const source = equipmentSourceData(item);
          this.equipmentForm = source?.equipmentForm ?? this.equipmentForm;
        }
        this.enhancements = {};
        this.enhancementValues = clone(defaults);
        this.grantedEffects = {};
        this.grantedEffectValues = grantedEffectDefaults();
        this.resourceModifications = [];
        this.triggeredEffects = [];
        await this.#translateDocumentMechanics(item);
        this.templateDescriptionRaw = rawTemplateDescription(item);
        this.templateDescription = this.templateDescriptionRaw;
        this.descriptionCustomized = true;
        this.customDescription = stripGeneratedDescription(item.system?.description?.value);
      }

      this.#syncGrantedSpellMagicalState();
      this.baseWeaponRequired = false;
      this.editStateInitialized = true;
      return;
    }

    if (this.editingManagedItem) {
      this.selectedWeaponUuid = flags.templateUuid || item.uuid;
      this.selectedBaseWeaponUuid = flags.baseWeaponUuid || item.uuid;
      this.selectedWeaponDocument = await registry.getWeaponDocument(this.selectedWeaponUuid) ?? item;
      this.selectedBaseWeaponDocument = await registry.getWeaponDocument(this.selectedBaseWeaponUuid) ?? item;
      this.customized = clone(savedDraft.customized ?? {});
      this.overrides = clone(savedDraft.overrides ?? {});

      // v0.1.5 could persist a disabled Additional Damage override and could also
      // misread D&D5e's prepared base-damage part as a real extra damage row.
      if (!this.customized.additionalDamage || isV015FalseBaseDamageImport(item, flags, savedDraft)) {
        this.customized.additionalDamage = false;
        delete this.overrides.additionalDamage;
      }
      this.enhancements = clone(savedDraft.enhancements ?? {});
      this.enhancementValues = mergeWithDefaults(enhancementDefaults(), savedDraft.enhancementValues);
      this.magicalAutoFromGrantedSpellcasting = Boolean(savedDraft.magicAutomation?.magicalFromGrantedSpellcasting);
      this.grantedEffects = clone(savedDraft.grantedEffects ?? {});
      this.grantedEffectValues = mergeWithDefaults(grantedEffectDefaults(), savedDraft.grantedEffectValues);
      this.resourceModifications = (savedDraft.resourceModifications ?? []).map(normalizeResourceModification);
      this.triggeredEffects = (savedDraft.triggeredEffects ?? []).map(normalizeTriggeredEffect);
      this.descriptionCustomized = Boolean(savedDraft.descriptionCustomized);
      this.templateDescriptionRaw = rawTemplateDescription(this.selectedWeaponDocument);
      this.templateDescription = cleanTemplateDescription(this.selectedWeaponDocument);
      this.customDescription = this.descriptionCustomized
        ? stripGeneratedDescription(item.system?.description?.value)
        : this.templateDescriptionRaw;

      if (this.selectedWeaponDocument?.uuid === item.uuid) {
        this.replaceAttackDamageParts = true;
        this.managedActivityIds = valuesOf(item.system?.activities)
          .filter(activity => activity?.type === "cast")
          .map(activity => activity.id ?? activity._id)
          .filter(Boolean);
        const primary = attackActivity(item);
        this.managedPrimaryAttackId = primary?.id ?? primary?._id ?? null;
        this.preserveAdditionalAttackActivities = true;
      }
      this.managedEffectIds = valuesOf(item.effects)
        .filter(effect => effect?.flags?.[MODULE_ID]?.blueprint)
        .map(effect => effect.id ?? effect._id)
        .filter(Boolean);
      this.customImportedEffects = clone(savedDraft.customImportedEffects ?? []);
      this.customImportedActivities = clone(savedDraft.customImportedActivities ?? []);
      this.importedBaseSummary = clone(savedDraft.importedBaseSummary ?? []);
      await this.#translateDocumentMechanics(item, { merge: true, ignoreGenerated: true });
    } else {
      this.selectedWeaponUuid = item.uuid;
      this.selectedWeaponDocument = item;
      this.selectedBaseWeaponUuid = item.uuid;
      this.selectedBaseWeaponDocument = item;
      this.inheritedBaseWeaponUuid = item.uuid;
      this.customized = {};
      this.overrides = {};

      const source = weaponSourceData(item);
      this.replaceAttackDamageParts = true;
      if (source?.additionalDamage?.length) {
        this.customized.additionalDamage = true;
        this.overrides.additionalDamage = clone(source.additionalDamage);
      }

      const activity = attackActivity(item);
      this.managedPrimaryAttackId = activity?.id ?? activity?._id ?? null;
      this.preserveAdditionalAttackActivities = true;
      this.enhancements = {};
      this.enhancementValues = enhancementDefaults();
      this.grantedEffects = {};
      this.grantedEffectValues = grantedEffectDefaults();
      this.resourceModifications = [];
      this.triggeredEffects = [];
      await this.#translateDocumentMechanics(item);
      this.templateDescriptionRaw = rawTemplateDescription(item);
      this.templateDescription = this.templateDescriptionRaw;
      this.descriptionCustomized = true;
      this.customDescription = stripGeneratedDescription(item.system?.description?.value);
    }

    this.#syncGrantedSpellMagicalState();
    this.baseWeaponRequired = false;
    this.editStateInitialized = true;
  }

  async _prepareContext() {
    const registry = ItemCreatorSourceRegistry.instance;
    // A fresh Item Creator window performs one forced registry rebuild. This
    // reconciles persisted checkboxes with the packs that are actually ready
    // after world reloads and module/package activation changes. Subsequent
    // rerenders reuse the validated registry for responsiveness.
    await registry.loadAll({ force: !this.sourceRegistryValidated });
    this.sourceRegistryValidated = true;
    await this.#initializeEditState(registry);

    const expectedType = ["equipment", "tool"].includes(this.selectedType) ? this.selectedType : "weapon";
    const documentValidator = expectedType === "equipment" ? isEquipmentItemDocument
      : expectedType === "tool" ? isToolItemDocument : isWeaponItemDocument;
    if (this.selectedWeaponUuid && !this.selectedWeaponDocument) {
      try {
        const document = await fromUuid(this.selectedWeaponUuid);
        if (documentValidator(document)) this.selectedWeaponDocument = document;
        else this.#clearTemplate();
      } catch (_error) { this.#clearTemplate(); }
    }
    if (this.selectedBaseWeaponUuid && !this.selectedBaseWeaponDocument) {
      try {
        const document = await fromUuid(this.selectedBaseWeaponUuid);
        if (documentValidator(document)) this.selectedBaseWeaponDocument = document;
        else this.#clearBaseWeapon();
      } catch (_error) { this.#clearBaseWeapon(); }
    }
    if (this.selectedWeaponDocument && !this.templateDescriptionRaw) {
      this.templateDescriptionRaw = rawTemplateDescription(this.selectedWeaponDocument);
      this.templateDescription = cleanTemplateDescription(this.selectedWeaponDocument);
      if (!this.descriptionCustomized) this.customDescription = this.templateDescriptionRaw;
    }

    const isWeapon = this.selectedType === "weapon";
    const isEquipment = this.selectedType === "equipment";
    const isTool = this.selectedType === "tool";
    const itemTypeLabel = isEquipment ? "Equipment" : isTool ? "Tool" : "Weapon";
    const source = isEquipment ? equipmentSourceData(this.selectedBaseWeaponDocument)
      : isTool ? toolSourceData(this.selectedBaseWeaponDocument) : weaponSourceData(this.selectedBaseWeaponDocument);
    const effective = source ? this.#effectiveValues(source) : null;
    const additionalDamageValid = !isWeapon || !this.customized.additionalDamage
      || (effective?.additionalDamage?.length > 0 && effective.additionalDamage.every(row => this.#validateAdditionalDamageRow(row)));
    const typeComplete = Boolean(this.selectedType);
    const baseComplete = Boolean(this.selectedWeaponUuid
      && (!isWeapon || this.selectedBaseWeaponUuid)
      && this.itemName.trim() && additionalDamageValid);
    const enhancementValidation = this.#validateEnhancements();
    const enhancementsComplete = baseComplete && enhancementValidation.valid;
    const grantedEffectValidation = this.#validateGrantedEffects();
    const grantedEffectsComplete = enhancementsComplete && grantedEffectValidation.valid;
    const spellsResourcesValidation = this.#validateSpellsResources();
    const spellsResourcesComplete = grantedEffectsComplete && spellsResourcesValidation.valid;
    const descriptionComplete = spellsResourcesComplete;

    let reviewData = null;
    let reviewChatCard = "";
    let reviewError = "";
    if (this.step === "review" && descriptionComplete) {
      try {
        reviewData = await ItemCreatorItemBuilder.build(this.#builderDraft(effective));
        reviewChatCard = await ItemCreatorItemBuilder.renderChatCard(reviewData.temporary);
        this.reviewBuildError = "";
      } catch (error) {
        console.error(`${MODULE_ID} | Unable to build Review preview.`, error);
        reviewError = error?.message ?? "The final Item preview could not be built.";
        this.reviewBuildError = reviewError;
      }
    }
    const reviewComplete = Boolean(reviewData) && !reviewError;
    const steps = STEPS.map(step => ({
      ...step,
      active: step.id === this.step,
      complete: step.id === "itemType" ? typeComplete
        : step.id === "baseItem" ? baseComplete
          : step.id === "enhancements" ? enhancementsComplete
            : step.id === "grantedEffects" ? grantedEffectsComplete
              : step.id === "spellsResources" ? spellsResourcesComplete
                : step.id === "description" ? descriptionComplete
                  : step.id === "review" ? reviewComplete : false,
      locked: !step.available
        || (step.id === "baseItem" && !typeComplete)
        || (step.id === "enhancements" && !baseComplete)
        || (step.id === "grantedEffects" && !enhancementsComplete)
        || (step.id === "spellsResources" && !grantedEffectsComplete)
        || (step.id === "description" && !spellsResourcesComplete)
        || (step.id === "review" && !descriptionComplete)
    }));

    const findOption = uuid => isEquipment ? registry.findEquipment(uuid)
      : isTool ? registry.findTool(uuid) : registry.findWeapon(uuid);
    const selectedOption = this.selectedWeaponUuid ? findOption(this.selectedWeaponUuid) : null;
    const selectedSource = this.selectedWeaponDocument
      ? (selectedOption ?? registry.describeDocument(this.selectedWeaponDocument)) : null;
    const selectedBaseOption = this.selectedBaseWeaponUuid ? findOption(this.selectedBaseWeaponUuid) : null;
    const selectedBaseSource = this.selectedBaseWeaponDocument
      ? (selectedBaseOption ?? registry.describeDocument(this.selectedBaseWeaponDocument)) : null;

    const templateOptions = isEquipment ? registry.equipmentTemplateOptions
      : isTool ? registry.toolTemplateOptions : registry.templateOptions;
    const templateSourceGroupsSource = isEquipment ? registry.equipmentTemplateSourceGroups
      : isTool ? registry.toolTemplateSourceGroups : registry.templateSourceGroups;
    const sourceConfig = isEquipment ? CONFIG.DND5E.equipmentTypes
      : isTool ? CONFIG.DND5E.toolTypes : CONFIG.DND5E.weaponTypes;
    const typeKey = isEquipment ? "equipmentType" : isTool ? "toolType" : "weaponType";
    const templateCounts = new Map();
    for (const option of templateOptions) templateCounts.set(option[typeKey], (templateCounts.get(option[typeKey]) ?? 0) + 1);
    const templateCategoryOptions = [{
      value: "all", label: `All ${itemTypeLabel} Types`, selected: this.templateCategory === "all"
    }, ...Object.entries(sourceConfig ?? {}).filter(([value]) => templateCounts.has(value)).map(([value, label]) => ({
      value, label: `${game.i18n.localize(typeof label === "string" ? label : label?.label ?? value)} (${templateCounts.get(value)})`,
      selected: this.templateCategory === value
    }))];

    const templateOptionGroups = templateSourceGroupsSource.map(group => ({
      label: group.label,
      items: group.items.map(option => ({
        ...option,
        selected: option.uuid === this.selectedWeaponUuid,
        optionLabel: option.packLabel === group.label ? option.name : `${option.name} — ${option.packLabel}`,
        templateCategory: option[typeKey]
      }))
    }));
    const selectedInRegistry = isEquipment ? registry.findEquipment(this.selectedWeaponUuid)
      : isTool ? registry.findTool(this.selectedWeaponUuid) : registry.findTemplate(this.selectedWeaponUuid);
    if (this.selectedWeaponDocument && !selectedInRegistry) {
      templateOptionGroups.unshift({
        label: selectedSource?.sourceLabel ?? "Selected Source",
        items: [{
          uuid: this.selectedWeaponUuid, name: this.selectedWeaponDocument.name,
          templateCategory: this.selectedWeaponDocument.system?.type?.value ?? "",
          selected: true, optionLabel: this.selectedWeaponDocument.name
        }]
      });
    }

    const baseSourceGroups = isEquipment ? registry.equipmentSourceGroups
      : isTool ? registry.toolSourceGroups : registry.weaponSourceGroups;
    const baseWeaponOptionGroups = baseSourceGroups.map(group => ({
      label: group.label,
      items: group.packs.flatMap(pack => pack.items).sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang)).map(option => ({
        ...option, selected: option.uuid === this.selectedBaseWeaponUuid, optionLabel: option.name
      }))
    }));
    if (this.selectedBaseWeaponDocument && !findOption(this.selectedBaseWeaponUuid)) {
      baseWeaponOptionGroups.unshift({
        label: selectedBaseSource?.sourceLabel ?? "World Item",
        items: [{ uuid: this.selectedBaseWeaponUuid, name: this.selectedBaseWeaponDocument.name, selected: true, optionLabel: this.selectedBaseWeaponDocument.name }]
      });
    }

    const manualTemplateCount = templateOptionGroups.reduce((count, group) => count + group.items.length, 0);
    const selectedBaseWeapon = this.selectedBaseWeaponDocument ? {
      uuid: this.selectedBaseWeaponUuid,
      name: this.selectedBaseWeaponDocument.name,
      identifier: this.selectedBaseWeaponDocument.system?.identifier ?? "—",
      source: selectedBaseSource ? `${selectedBaseSource.sourceLabel} — ${selectedBaseSource.packLabel}` : "Compendium Item"
    } : null;

    const propertyKeys = CONFIG.DND5E.validProperties?.[expectedType] ?? new Set();
    const propertyOptions = [...propertyKeys].filter(key => key !== "mgc").map(value => ({
      value,
      label: localizedLabel(CONFIG.DND5E.itemProperties?.[value], value),
      selected: effective?.properties?.includes(value) ?? false
    })).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));

    const damageTypeLabel = effective?.damageType
      ? localizedLabel(CONFIG.DND5E.damageTypes?.[effective.damageType], effective.damageType) : "";
    const selectedWeapon = this.selectedWeaponDocument ? {
      name: this.selectedWeaponDocument.name,
      img: this.selectedIcon || this.selectedWeaponDocument.img || (isEquipment ? "icons/svg/item-bag.svg" : isTool ? "systems/dnd5e/icons/svg/items/tool.svg" : "icons/svg/sword.svg"),
      sourceImg: this.selectedWeaponDocument.img || (isEquipment ? "icons/svg/item-bag.svg" : isTool ? "systems/dnd5e/icons/svg/items/tool.svg" : "icons/svg/sword.svg"),
      source: selectedSource ? `${selectedSource.sourceLabel} — ${selectedSource.packLabel}` : "Compendium Item",
      sourceLabel: selectedSource?.sourceLabel ?? "Compendium",
      packLabel: selectedSource?.packLabel ?? "Items",
      identifier: this.selectedWeaponDocument.system?.identifier ?? "—",
      damageSummary: isWeapon ? displayDamage(effective?.baseDamage, damageTypeLabel) : "—",
      equipmentTypeLabel: isEquipment ? localizedLabel(CONFIG.DND5E.equipmentTypes?.[effective?.nativeType], effective?.nativeType ?? "Equipment") : "",
      toolTypeLabel: isTool ? localizedLabel(CONFIG.DND5E.toolTypes?.[effective?.toolType], effective?.toolType ?? "Tool") : "",
      importedMechanics: clone(this.importedBaseSummary)
    } : null;

    const customization = field => Boolean(this.customized[field]);
    const customFieldCount = Object.entries(this.customized).filter(([field, enabled]) =>
      enabled && !(field === "baseWeapon" && this.baseWeaponRequired && !this.selectedBaseWeaponUuid)).length;
    const additionalDamageRows = isWeapon ? (effective?.additionalDamage ?? []).map((row, index) => ({
      ...row, index: index + 1, dieOptions: damageDiceOptions(row.denomination),
      damageTypeOptions: configOptions(CONFIG.DND5E.damageTypes, row.damageType),
      abilityModifierOptions: abilityModifierOptions(row.ability), summary: additionalDamageLabel(row)
    })) : [];

    const grantedSpellRows = (this.enhancementValues.grantedSpellcasting?.spells ?? []).map((row, index) => {
      const level = Number(row.level ?? 0);
      const isCantrip = level === 0;
      const isLimited = row.useLimit === "limited";
      const usesFixedSpellcasting = row.spellcastingMode === "fixed";
      const castLevelOptions = Object.entries(CONFIG.DND5E.spellLevels ?? {})
        .filter(([value]) => Number(value) >= level && Number(value) <= 9)
        .map(([value, label]) => ({ value: Number(value), label: game.i18n.localize(label), selected: Number(row.fixedCastLevel) === Number(value) }));
      return {
        ...row, index: index + 1, isCantrip, isLimited, usesFixedSpellcasting,
        spellLevelLabel: spellLevelLabel(level), schoolLabel: localizedLabel(CONFIG.DND5E.spellSchools?.[row.school], row.school || "Spell"),
        useLimitOptions: fixedOptions([["unlimited", "Unlimited / At Will"], ["limited", "Limited Uses"]], row.useLimit),
        recoveryOptions: fixedOptions([["shortRest", "Short Rest"], ["longRest", "Long Rest"]], row.recovery),
        eligibilityOptions: fixedOptions([["independent", "Item Grants Independent Casting"], ["spellLevelAccess", "Require Spell-Level Access"], ["compatibleSlot", "Require Compatible Spell Slot"]], row.eligibility),
        castLevelModeOptions: fixedOptions([["base", "Base Spell Level"], ...(!isCantrip ? [["fixed", "Fixed Higher Level"]] : []), ...(!isCantrip && row.consumeSlot ? [["slot", "Use Selected Spell Slot Level"]] : [])], row.castLevelMode),
        fixedCastLevelOptions: castLevelOptions,
        spellcastingModeOptions: fixedOptions([["actorDefault", "Actor Default Spellcasting"], ["highest", "Highest Spellcasting"], ["int", "Intelligence + Proficiency"], ["wis", "Wisdom + Proficiency"], ["cha", "Charisma + Proficiency"], ["fixed", "Fixed Item Spellcasting Values"]], row.spellcastingMode),
        availabilityOptions: effectAvailabilityOptions(row.availability),
        invalid: !this.#validateGrantedSpell(row)
      };
    });

    const resourceModificationRows = this.resourceModifications.map((entry, index) => {
      const row = normalizeResourceModification(entry);
      const definition = getResourceDefinition(row.resourceId);
      const dieOnly = row.category === "resourceDie";
      const groups = resourceGroups({ dieOnly }).map(group => ({
        label: group.label,
        items: group.items.map(resource => ({
          value: resource.id,
          label: resource.label,
          selected: resource.id === row.resourceId
        }))
      }));
      return {
        ...row,
        index: index + 1,
        summary: resourceModificationLabel(row),
        definition,
        invalid: !validateResourceModification(row),
        categoryOptions: RESOURCE_CATEGORIES.map(category => ({
          value: category.id,
          label: category.label,
          selected: category.id === row.category
        })),
        resourceGroups: groups,
        spellLevelOptions: Array.from({ length: 9 }, (_unused, i) => ({
          value: i + 1,
          label: spellLevelLabel(i + 1),
          selected: row.spellLevel === i + 1
        })),
        dieOptions: RESOURCE_DICE.map(die => ({ value: die, label: `d${die}`, selected: row.die === die })),
        dieOperationOptions: fixedOptions([
          ["increaseSteps", "Increase Die Steps"],
          ["setMinimumDie", "Set Minimum Die"],
          ["setExactDie", "Set Exact Die"]
        ], row.operation),
        availabilityOptions: effectAvailabilityOptions(row.availability),
        isFeature: row.category === "feature",
        isResourceDie: row.category === "resourceDie",
        isSpellSlot: row.category === "spellSlot",
        isPactSlot: row.category === "pactSlot",
        usesAmount: ["feature", "spellSlot", "pactSlot"].includes(row.category),
        amountMultiplier: definition?.amountMultiplier ?? 1,
        unit: definition?.unit ?? "uses"
      };
    });
    const resourceModificationCount = resourceModificationRows.length;

    const triggerResourceOptions = resourceGroups({ dieOnly: false }).map(group => ({
      label: group.label,
      items: group.items.map(resource => ({ value: resource.id, label: resource.label }))
    }));
    const triggeredEffectRows = this.triggeredEffects.map((source, index) => {
      const row = normalizeTriggeredEffect(source);
      const trigger = row.trigger;
      const application = row.application;
      const consumption = row.consumption;
      const stack = row.stacks;
      const effectRows = row.effects.map((effectSource, effectIndex) => {
        const effect = normalizeTriggeredEffectPayload(effectSource);
        return {
          ...effect,
          index: effectIndex + 1,
          typeOptions: fixedOptions(TRIGGER_EFFECT_TYPES, effect.type),
          recipientOptions: fixedOptions(EFFECT_RECIPIENTS, effect.recipient),
          calculationOptions: fixedOptions(VALUE_CALCULATIONS, effect.calculation),
          scalingOptions: fixedOptions(EFFECT_SCALING, effect.scaling),
          dieOptions: [4, 6, 8, 10, 12, 20].map(die => ({ value: die, label: `d${die}`, selected: die === Number(effect.die) })),
          abilityOptions: allAbilityOptions(effect.ability, { allLabel: "All Saving Throws" }),
          movementTypeOptions: movementTypeOptions(effect.movementType),
          damageTypeOptions: configOptions(CONFIG.DND5E.damageTypes, effect.damageType),
          conditionOptions: conditionTypeOptions([effect.condition]),
          criticalScopeOptions: fixedOptions([["weapon", "Weapon Attacks"], ["spell", "Spell Attacks"], ["all", "All Attacks"]], effect.criticalScope),
          criticalThresholdOptions: Array.from({ length: 20 }, (_unused, i) => ({ value: i + 1, label: String(i + 1), selected: i + 1 === Number(effect.criticalThreshold) })),
          isNumeric: isNumericTriggeredEffect(effect.type),
          isDice: effect.calculation === "dice",
          isCustomFormula: effect.calculation === "custom",
          isSavingThrow: effect.type === "savingThrowBonus",
          isMovement: effect.type === "movementBonus",
          isDamageTrait: ["damageResistance", "damageImmunity"].includes(effect.type),
          isConditionTrait: effect.type === "conditionImmunity",
          isCriticalThreshold: effect.type === "actorCriticalThreshold",
          isSelectedSpellEffects: effect.type === "selectedSpellEffects",
          showScaling: effect.type !== "selectedSpellEffects",
          selectedSpellEffectCount: Array.isArray(effect.spellEffects) ? effect.spellEffects.length : 0,
          isDamageEffect: isDamageTriggeredEffect(effect.type),
          isTrait: isTraitTriggeredEffect(effect.type)
        };
      });
      const hasTargetRecipients = effectRows.some(effect => effect.recipient === "target");
      const expirationLabel = fixedOptions(SINGLE_ACTIVATION_EXPIRATIONS, application.expiration)
        .find(option => option.selected)?.label ?? application.expiration;
      const timingLabel = fixedOptions(TICK_TIMINGS[stack.durationUnit] ?? [], stack.tickTiming)
        .find(option => option.selected)?.label ?? stack.tickTiming;
      const durationReference = stack.durationUnit === "recipientTurns"
        ? "Each effect follows the turns of the Actor that received it. Every target has an independent duration."
        : stack.durationUnit === "ownerTurns"
          ? "The duration follows the source Actor who owns the Item, even when the effect is applied to a target."
          : stack.durationUnit === "combatTurns"
            ? "The duration advances on every Combat turn."
            : "The duration advances once per Combat round.";
      const durationGuidance = application.mode === "singleActivation"
        ? `This application expires at ${expirationLabel}. Each recipient is tracked independently.`
        : `${stack.durationAmount} ${stack.durationUnit === "recipientTurns" ? "Effect Recipient Turn(s)" : stack.durationUnit === "ownerTurns" ? "Source Actor Turn(s)" : stack.durationUnit === "combatTurns" ? "Combat Turn(s)" : "Combat Round(s)"}; ${timingLabel}. ${durationReference}`;
      const targetClockWarning = hasTargetRecipients && (application.mode === "singleActivation"
        ? application.expiration.startsWith("owner")
        : stack.durationUnit === "ownerTurns");
      return {
        ...row,
        index: index + 1,
        summary: triggeredEffectSummary(row),
        invalid: !validateTriggeredEffect(row),
        availabilityOptions: effectAvailabilityOptions(row.availability),
        categoryOptions: Object.entries(TRIGGER_CATEGORIES).map(([value, label]) => ({ value, label, selected: value === trigger.category })),
        eventOptions: fixedOptions(TRIGGER_EVENTS[trigger.category] ?? [], trigger.event),
        attackTypeOptions: fixedOptions(ATTACK_TYPES, trigger.attackType),
        countingOptions: fixedOptions(ACTIVATION_COUNTING, row.counting),
        applicationModeOptions: fixedOptions(APPLICATION_MODES, application.mode),
        singleActivationExpirationOptions: fixedOptions(SINGLE_ACTIVATION_EXPIRATIONS, application.expiration),
        retriggerBehaviorOptions: fixedOptions(RETRIGGER_BEHAVIORS, application.retrigger),
        consumptionEventOptions: fixedOptions(CONSUMPTION_EVENTS, consumption.event),
        consumptionDecisionOptions: fixedOptions(CONSUMPTION_DECISIONS, consumption.decision),
        consumptionEnabled: consumption.enabled,
        stackBehaviorOptions: fixedOptions(STACK_BEHAVIORS.filter(([behavior]) => behavior !== "singleAttack"
          || (trigger.category === "attack" && ["attackHit", "criticalHit", "natural20"].includes(trigger.event))), stack.behavior),
        durationUnitOptions: fixedOptions(DURATION_UNITS, stack.durationUnit),
        tickTimingOptions: fixedOptions(TICK_TIMINGS[stack.durationUnit] ?? [], stack.tickTiming),
        spellLevelOptions: [{ value: "any", label: "Any Spell Level", selected: trigger.spellLevel === "any" },
          ...Array.from({ length: 10 }, (_unused, i) => ({ value: i, label: i === 0 ? "Cantrip" : spellLevelLabel(i), selected: Number(trigger.spellLevel) === i }))],
        spellSlotLevelOptions: [{ value: "any", label: "Any Slot Level", selected: trigger.spellSlotLevel === "any" },
          ...Array.from({ length: 9 }, (_unused, i) => ({ value: i + 1, label: spellLevelLabel(i + 1), selected: Number(trigger.spellSlotLevel) === i + 1 }))],
        spellSchoolOptions: [{ value: "any", label: "Any School", selected: trigger.spellSchool === "any" },
          ...configOptions(CONFIG.DND5E.spellSchools, trigger.spellSchool)],
        resourceGroups: triggerResourceOptions.map(group => ({
          label: group.label,
          items: group.items.map(item => ({ ...item, selected: item.value === trigger.resourceId }))
        })),
        damageSourceOptions: fixedOptions([["any", "Any Source"], ["attack", "Attack"], ["spell", "Spell"], ["feature", "Feature / Item"]], trigger.damageSource),
        damageTypeOptions: [{ value: "any", label: "Any Damage Type", selected: trigger.damageType === "any" },
          ...configOptions(CONFIG.DND5E.damageTypes, trigger.damageType)],
        showAttackFilters: trigger.category === "attack",
        showSpellFilters: trigger.category === "spell",
        showSpecificSpell: trigger.event === "specificSpellCast",
        spellFilterExplanation: trigger.event === "specificSpellCast"
          ? "Choose one Spell below. The selected level and school remain additional filters for that Spell."
          : "No specific Spell is required. Any Spell matching the selected level and school can trigger this effect.",
        showResourceFilter: trigger.event === "specificResourceSpent",
        showSlotLevel: ["spellSlotSpent", "pactSlotSpent"].includes(trigger.event),
        showSpecificFeature: trigger.event === "specificFeatureUsed",
        showDamageFilters: trigger.category === "damage" || trigger.event === "attackDamageApplied",
        isSingleActivation: application.mode === "singleActivation",
        isSingleAttack: application.mode === "stacking" && stack.behavior === "singleAttack",
        showStackQuantityFields: application.mode === "stacking" && stack.behavior !== "singleAttack",
        showTrackingFields: application.mode === "stacking" && stack.behavior !== "singleAttack",
        showDurationFields: application.mode === "stacking" && ["refresh", "shared", "independent"].includes(stack.behavior),
        showDecayFields: application.mode === "stacking" && ["continuousDecay", "delayedDecay"].includes(stack.behavior),
        showInactivityGrace: application.mode === "stacking" && stack.behavior === "delayedDecay",
        hasTargetRecipients,
        targetClockWarning,
        durationReference,
        durationGuidance,
        effects: effectRows
      };
    });
    const triggeredEffectCount = triggeredEffectRows.length;

    const effectValues = this.grantedEffectValues;
    const prepareEffectRows = key => (effectValues[key]?.entries ?? []).map((row, index) => ({ ...row, index: index + 1, ...effectEntryOptions(key, row) }));
    const damageEffectOptions = key => Object.entries(CONFIG.DND5E.damageTypes ?? {}).map(([value, entry]) => ({
      value, label: localizedLabel(entry, value), selected: (effectValues[key]?.damageTypes ?? []).includes(value)
    })).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
    const effectAvailability = Object.fromEntries(Object.keys(effectValues).map(key => [key, effectAvailabilityOptions(effectValues[key]?.availability)]));
    const grantedEffectCount = Object.values(this.grantedEffects).filter(Boolean).length;
    const levelProgressionCount = [
      ...Object.entries(this.enhancements).filter(([key, enabled]) => enabled && key !== "grantedSpellcasting" && settingHasProgression(this.enhancementValues[key])),
      ...Object.entries(this.grantedEffects).filter(([key, enabled]) => enabled && settingHasProgression(this.grantedEffectValues[key])),
      ...(effective?.additionalDamage ?? []).filter(settingHasProgression).map(row => [row.id, true]),
      ...grantedSpellRows.filter(spell => spell.unlockOnLevel).map(spell => [spell.id, true]),
      ...resourceModificationRows.filter(row => row.unlockOnLevel).map(row => [row.id, true]),
      ...triggeredEffectRows.filter(row => row.unlockOnLevel).map(row => [row.id, true])
    ].length;
    const customImportedEffectRows = this.customImportedEffects.map(entry => ({
      ...entry,
      technical: JSON.stringify(entry.data ?? {}, null, 2)
    }));
    const customImportedActivityRows = this.customImportedActivities.map(entry => ({
      ...entry,
      technical: JSON.stringify(entry.data ?? {}, null, 2)
    }));
    const importedCustomCount = customImportedEffectRows.filter(entry => entry.included !== false).length
      + customImportedActivityRows.filter(entry => entry.included !== false && !entry.disabled).length;
    const convertedImportedSummary = this.importedBaseSummary.filter(entry =>
      !String(entry).startsWith("Custom Effect:")
      && !String(entry).includes("preserved as Custom Imported Activity")
    );
    const reviewImportedEffects = customImportedEffectRows.filter(entry => entry.included !== false);
    const reviewImportedActivities = customImportedActivityRows.filter(entry => entry.included !== false);
    const descriptionValue = this.descriptionCustomized ? this.customDescription : this.templateDescription;
    const enrichedDescription = await enrichDescription(descriptionValue, this.selectedWeaponDocument);
    const reviewItem = reviewData?.temporary ?? null;
    const reviewProperties = valuesOf(reviewItem?.system?.properties).map(value => localizedLabel(CONFIG.DND5E.itemProperties?.[value], value)).sort((a, b) => a.localeCompare(b, game.i18n.lang));
    const reviewActivities = valuesOf(reviewItem?.system?.activities).map(activity => ({
      name: activity.name || localizedLabel(CONFIG.DND5E.activityTypes?.[activity.type], activity.type),
      type: localizedLabel(CONFIG.DND5E.activityTypes?.[activity.type], activity.type), img: activity.img || reviewItem?.img
    }));
    const reviewPricing = reviewItem?.flags?.[MODULE_ID]?.pricing ?? {};
    const reviewPriceValue = Math.max(0, Number(reviewItem?.system?.price?.value ?? 0) || 0);
    const reviewPriceDenomination = String(reviewItem?.system?.price?.denomination || "gp").toUpperCase();
    const reviewInventory = reviewItem ? {
      name: reviewItem.name, img: reviewItem.img, type: itemTypeLabel,
      rarity: localizedLabel(CONFIG.DND5E.itemRarity?.[reviewItem.system?.rarity], reviewItem.system?.rarity || "Mundane"),
      price: reviewPricing.mode === "priceless" ? "Priceless" : `${reviewPriceValue} ${reviewPriceDenomination}`,
      priceMode: ({ manual: "Manual", native: "Native Item", "rarity-profile": "Rarity Profile", priceless: "Priceless", none: "Unpriced" })[reviewPricing.mode] ?? "Item Data",
      attunement: reviewItem.system?.attunement ? localizedLabel(CONFIG.DND5E.attunementTypes?.[reviewItem.system.attunement], reviewItem.system.attunement) : "None",
      quantity: reviewItem.system?.quantity ?? 1,
      damage: isWeapon ? displayDamage(effective?.baseDamage, damageTypeLabel) : null,
      armor: isEquipment && Number(reviewItem.system?.armor?.value) ? reviewItem.system.armor.value : null,
      equipmentType: isEquipment ? localizedLabel(CONFIG.DND5E.equipmentTypes?.[reviewItem.system?.type?.value], reviewItem.system?.type?.value ?? "Equipment") : null,
      toolType: isTool ? localizedLabel(CONFIG.DND5E.toolTypes?.[reviewItem.system?.type?.value], reviewItem.system?.type?.value ?? "Tool") : null,
      toolBonus: isTool ? String(reviewItem.system?.bonus ?? "") || "None" : null,
      properties: reviewProperties, activities: reviewActivities,
      effects: reviewItem.effects?.size ?? reviewItem.effects?.length ?? 0,
      magical: valuesOf(reviewItem.system?.properties).includes("mgc")
    } : null;

    const equipmentFormOptions = EQUIPMENT_FORMS.map(form => ({ ...form, selected: form.id === this.equipmentForm }));
    const effectiveEquipmentType = effective?.nativeType ?? "wondrous";
    const armorTypes = Object.entries(CONFIG.DND5E.armorTypes ?? {}).filter(([value]) => value !== "shield");
    const equipmentTypeOptions = configOptions(CONFIG.DND5E.equipmentTypes, effectiveEquipmentType);
    const armorTypeOptions = armorTypes.map(([value, entry]) => ({ value, label: localizedLabel(entry, value), selected: effectiveEquipmentType === value }));
    const isArmorForm = isEquipment && this.equipmentForm === "armor";
    const isShieldForm = isEquipment && this.equipmentForm === "shield";
    const hasArmorFields = isArmorForm || isShieldForm;
    const toolTypeOptions = configOptions(CONFIG.DND5E.toolTypes, effective?.toolType);
    const toolAbilityOptions = configOptions(CONFIG.DND5E.abilities, effective?.ability, { blankValue: "", blankLabel: "Default for Base Tool" });
    const baseToolSeen = new Set();
    const baseToolOptions = [{ value: "", label: "None / Custom Tool", selected: !effective?.baseItem }];
    for (const option of registry.toolOptions ?? []) {
      const value = option.baseItemIdentifier || option.identifier;
      if (!value || baseToolSeen.has(value)) continue;
      baseToolSeen.add(value);
      baseToolOptions.push({ value, label: option.name, selected: effective?.baseItem === value });
    }
    baseToolOptions.splice(1, baseToolOptions.length - 1, ...baseToolOptions.slice(1).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang)));

    return {
      stage: MODULE_STAGE, version: MODULE_VERSION,
      editMode: Boolean(this.editingItem), editingManagedItem: this.editingManagedItem,
      editingImportedItem: this.editingImportedItem, editingItemName: this.editingItem?.name ?? "",
      step: this.step, steps,
      itemTypes: ITEM_TYPES
        .filter(type => type.feature !== "supplier" || game.itemCreator?.supplierEnabled === true)
        .map(type => ({
          ...type,
          selected: type.id === this.selectedType
        })),
      selectedType: this.selectedType, isWeapon, isEquipment, isTool, itemTypeLabel,
      weaponCount: manualTemplateCount, templateOptionGroups, templateCategoryOptions,
      templateCategory: this.templateCategory, selectedWeapon, selectedBaseWeapon,
      selectedBaseWeaponUuid: this.selectedBaseWeaponUuid, baseWeaponOptionGroups,
      baseWeaponRequired: this.baseWeaponRequired, baseWeaponCustomized: customization("baseWeapon"),
      inheritedBaseWeapon: Boolean(this.inheritedBaseWeaponUuid), selectedWeaponUuid: this.selectedWeaponUuid,
      itemName: this.itemName, iconCustomized: customization("icon"), customFieldCount,
      loadingWeapon: this.loadingWeapon, canOpenBaseItem: typeComplete, baseComplete, source, effective, custom: this.customized,

      weaponTypeOptions: configOptions(CONFIG.DND5E.weaponTypes, effective?.weaponType),
      attackTypeOptions: [{ value: "melee", label: "Melee", selected: effective?.attackType === "melee" }, { value: "ranged", label: "Ranged", selected: effective?.attackType === "ranged" }],
      abilityOptions: configOptions(CONFIG.DND5E.abilities, effective?.attackAbility, { blankValue: "", blankLabel: "Automatic" }),
      proficiencyOptions: [{ value: "automatic", label: "Automatic", selected: effective?.proficiency === "automatic" }, { value: "proficient", label: "Always Proficient", selected: effective?.proficiency === "proficient" }, ...(isTool ? [{ value: "expertise", label: "Always Expertise", selected: effective?.proficiency === "expertise" }] : []), { value: "notProficient", label: "Not Proficient", selected: effective?.proficiency === "notProficient" }],
      damageTypeOptions: configOptions(CONFIG.DND5E.damageTypes, effective?.damageType),
      versatileDamageTypeOptions: configOptions(CONFIG.DND5E.damageTypes, effective?.versatile?.damageType),
      masteryOptions: configOptions(CONFIG.DND5E.weaponMasteries, effective?.mastery, { blankValue: "", blankLabel: "None" }),
      rangeUnitOptions: configOptions(CONFIG.DND5E.movementUnits, effective?.range?.units),
      weightUnitOptions: configOptions(CONFIG.DND5E.weightUnits, effective?.weight?.units),
      currencyOptions: configOptions(CONFIG.DND5E.currencies, effective?.price?.denomination),
      damageDiceOptions: damageDiceOptions(effective?.baseDamage?.denomination),
      versatileDiceOptions: damageDiceOptions(effective?.versatile?.denomination),
      propertyOptions, hasVersatile: effective?.properties?.includes("ver") ?? false,
      hasAmmunition: effective?.properties?.includes("amm") ?? false,
      additionalDamageRows, additionalDamageValid, additionalDamageCount: additionalDamageRows.length,

      equipmentForm: this.equipmentForm, equipmentFormOptions, equipmentTypeOptions, armorTypeOptions,
      isArmorForm, isShieldForm, hasArmorFields,
      toolTypeOptions, toolAbilityOptions, baseToolOptions,
      equipmentFormLabel: EQUIPMENT_FORMS.find(form => form.id === this.equipmentForm)?.label ?? "Equipment",
      armorDexFull: effective?.armor?.dex === null || effective?.armor?.dex === undefined,
      armorDexValue: effective?.armor?.dex ?? 0,

      enhancement: this.enhancements, enhancementValues: this.enhancementValues,
      magicalAutoFromGrantedSpellcasting: this.magicalAutoFromGrantedSpellcasting,
      enhancementCount: Object.entries(this.enhancements).filter(([key, enabled]) => enabled && key !== "grantedSpellcasting").length,
      grantedSpellCount: grantedSpellRows.length, grantedSpellRows,
      resourceModificationCount, resourceModificationRows,
      triggeredEffectCount, triggeredEffectRows,
      spellsResourcesComplete, spellsResourcesErrors: spellsResourcesValidation.errors,
      enhancementsComplete, enhancementErrors: enhancementValidation.errors,
      effectiveMagical: Boolean(isEquipment
        ? (this.enhancements.magicalItem || this.enhancements.armorEnhancement || grantedSpellRows.length)
        : isTool ? (this.enhancements.magicalTool || grantedSpellRows.length)
          : (this.enhancements.magicalWeapon || this.enhancements.weaponEnhancement || grantedSpellRows.length)),
      rarityOptions: configOptions(CONFIG.DND5E.itemRarity, isEquipment ? this.enhancementValues.magicalItem?.rarity : isTool ? this.enhancementValues.magicalTool?.rarity : this.enhancementValues.magicalWeapon?.rarity),
      attunementOptions: configOptions(CONFIG.DND5E.attunementTypes, isEquipment ? this.enhancementValues.magicalItem?.attunement : isTool ? this.enhancementValues.magicalTool?.attunement : this.enhancementValues.magicalWeapon?.attunement, { blankValue: "", blankLabel: "None" }),
      enhancementBonusOptions: fixedOptions([[1, "+1"], [2, "+2"], [3, "+3"]], isEquipment ? this.enhancementValues.armorEnhancement?.bonus : this.enhancementValues.weaponEnhancement?.bonus),
      criticalThresholdOptions: fixedOptions([[20, "20 — Standard"], [19, "19 — Critical on 19–20"], [18, "18 — Critical on 18–20"], ["custom", "Custom"]], this.enhancementValues.criticalThreshold?.mode),
      criticalDamageDiceOptions: damageDiceOptions(this.enhancementValues.extraCriticalDamage?.denomination),
      criticalDamageTypeOptions: configOptions(CONFIG.DND5E.damageTypes, this.enhancementValues.extraCriticalDamage?.damageType),
      resistanceDamageTypes: Object.entries(CONFIG.DND5E.damageTypes ?? {}).map(([value, entry]) => ({ value, label: localizedLabel(entry, value), selected: this.enhancementValues.ignoreResistance?.damageTypes?.includes(value) })).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang)),
      conditionalModeOptions: fixedOptions([["supported", "Supported Condition"], ["custom", "Custom Rule Text"]], this.enhancementValues.conditionalAdvantage?.mode),
      conditionalAppliesToOptions: fixedOptions([["attackRolls", !isWeapon ? "All Attack Rolls" : "Attack Rolls with this weapon"]], this.enhancementValues.conditionalAdvantage?.appliesTo),
      supportedConditionOptions: fixedOptions([["targetUndead", "Target is Undead"], ["targetFiend", "Target is a Fiend"], ["targetBloodied", "Target is below half its Hit Points"], ["wielderDimLight", "Wielder is in dim light"], ["targetNotActed", "Target has not acted this combat"]], this.enhancementValues.conditionalAdvantage?.supportedCondition),
      conditionalIsSupported: this.enhancementValues.conditionalAdvantage?.mode === "supported",
      conditionalSupportLabel: this.enhancementValues.conditionalAdvantage?.mode === "supported" ? "Item Creator Runtime" : "Description Only",

      grantedEffects: this.grantedEffects, grantedEffectValues: effectValues,
      grantedEffectCount, levelProgressionCount, grantedEffectsComplete, grantedEffectErrors: grantedEffectValidation.errors,
      customImportedEffectRows, customImportedActivityRows, importedCustomCount,
      importedBaseSummary: this.importedBaseSummary,
      convertedImportedSummary, reviewImportedEffects, reviewImportedActivities,
      effectAvailability,
      savingThrowBonusRows: prepareEffectRows("savingThrowBonus"), savingThrowAdvantageRows: prepareEffectRows("savingThrowAdvantage"),
      abilityScoreAdjustmentRows: prepareEffectRows("abilityScoreAdjustment"), abilityCheckBonusRows: prepareEffectRows("abilityCheckBonus"),
      skillBonusRows: prepareEffectRows("skillBonus"), skillProficiencyRows: prepareEffectRows("skillProficiency"),
      abilityCheckAdvantageRows: prepareEffectRows("abilityCheckAdvantage"), movementBonusRows: prepareEffectRows("movementBonus"),
      grantMovementTypeRows: prepareEffectRows("grantMovementType"), grantedSenseRows: prepareEffectRows("grantedSense"),
      passiveScoreBonusRows: prepareEffectRows("passiveScoreBonus"),
      damageResistanceOptions: damageEffectOptions("damageResistance"), damageImmunityOptions: damageEffectOptions("damageImmunity"),
      damageVulnerabilityOptions: damageEffectOptions("damageVulnerability"), conditionImmunityOptions: conditionTypeOptions(effectValues.conditionImmunity.conditions),
      criticalThresholdEffectOptions: fixedOptions([[20, "20 — Standard"], [19, "19 — Critical on 19–20"], [18, "18 — Critical on 18–20"]], effectValues.criticalThreshold?.threshold),
      criticalThresholdScopeOptions: fixedOptions([["weapon", "Weapon Attacks"], ["spell", "Spell Attacks"], ["all", "All Attacks"]], effectValues.criticalThreshold?.scope),

      descriptionComplete, descriptionCustomized: this.descriptionCustomized, descriptionValue, enrichedDescription,
      hasTemplateDescription: Boolean(this.templateDescription.trim()), hasRawTemplateDescription: Boolean(this.templateDescriptionRaw.trim()),
      descriptionSource: selectedSource ? `${selectedSource.sourceLabel} — ${selectedSource.packLabel}` : "Template",
      reviewComplete, reviewReady: reviewComplete && Boolean(reviewData), reviewError, reviewChatCard, reviewInventory,
      reviewSummary: {
        template: this.selectedWeaponDocument?.name ?? "—",
        baseWeapon: isEquipment ? (EQUIPMENT_FORMS.find(form => form.id === this.equipmentForm)?.label ?? "Equipment")
          : isTool ? (localizedLabel(CONFIG.DND5E.toolTypes?.[effective?.toolType], effective?.toolType ?? "Tool"))
            : (this.selectedBaseWeaponDocument?.name ?? "—"),
        name: this.itemName.trim() || "—", baseOverrides: customFieldCount,
        enhancements: Object.entries(this.enhancements).filter(([key, enabled]) => enabled && key !== "grantedSpellcasting").length,
        grantedSpells: grantedSpellRows.length, grantedEffects: grantedEffectCount,
        triggeredEffects: triggeredEffectCount, resources: resourceModificationCount,
        importedCustom: importedCustomCount,
        convertedProperties: this.importedBaseSummary.length,
        progressions: levelProgressionCount,
        description: this.descriptionCustomized ? "Customized" : "Inherited from Template"
      },
      savingItem: this.savingItem, readyStatus: this.editingItem ? "Ready to update" : "Ready to create"
    };
  }

  _onRender() {
    const root = this.element;
    this.#mountLevelProgressionControls(root);
    root.querySelectorAll('[data-action="select-type"]').forEach(button => button.addEventListener("click", event => this.#selectType(event)));
    root.querySelectorAll('[data-action="step"]').forEach(button => button.addEventListener("click", event => this.#changeStep(event)));
    root.querySelector('[data-action="continue"]')?.addEventListener("click", event => this.#continue(event));
    root.querySelector('[data-action="back"]')?.addEventListener("click", event => this.#back(event));
    root.querySelector('[data-action="save-item"]')?.addEventListener("click", event => this.#saveItem(event));
    root.querySelector('[data-action="update-item"]')?.addEventListener("click", event => this.#updateItem(event));
    root.querySelector('[data-action="save-copy"]')?.addEventListener("click", event => this.#saveCopy(event));
    root.querySelector('[data-action="browse-templates"]')?.addEventListener("click", event => this.#openTemplateBrowser(event));
    root.querySelector('[data-action="custom-equipment"]')?.addEventListener("click", event => this.#createCustomEquipment(event));
    root.querySelector('[data-action="custom-tool"]')?.addEventListener("click", event => this.#createCustomTool(event));
    root.querySelector('[data-template-category]')?.addEventListener("change", event => this.#filterTemplates(event));
    root.querySelector('[data-template-select]')?.addEventListener("change", event => this.#selectTemplate(event));
    root.querySelector('[data-base-weapon-select]')?.addEventListener("change", event => this.#selectBaseWeapon(event));
    root.querySelector('[data-equipment-form]')?.addEventListener("change", event => this.#selectEquipmentForm(event));
    root.querySelector('[name="itemName"]')?.addEventListener("input", event => this.#updateItemName(event));
    root.querySelectorAll('[data-override-toggle]').forEach(input => input.addEventListener("change", event => this.#toggleOverride(event)));
    root.querySelectorAll('[data-override-input]').forEach(input => {
      const eventName = input.matches("select, input[type=checkbox]") ? "change" : "input";
      input.addEventListener(eventName, event => this.#updateOverride(event));
    });
    root.querySelectorAll('[data-property-key]').forEach(input => input.addEventListener("change", event => this.#updateProperty(event)));
    root.querySelector('[data-action="open-icon-browser"]')?.addEventListener("click", event => this.#openIconBrowser(event));
    root.querySelector('[data-action="add-additional-damage"]')?.addEventListener("click", event => this.#addAdditionalDamage(event));
    root.querySelectorAll('[data-action="remove-additional-damage"]').forEach(button => button.addEventListener("click", event => this.#removeAdditionalDamage(event)));
    root.querySelectorAll('[data-extra-damage-input]').forEach(input => {
      const eventName = input.matches("select, input[type=checkbox]") ? "change" : "input";
      input.addEventListener(eventName, event => this.#updateAdditionalDamage(event));
    });
    root.querySelectorAll('[data-enhancement-toggle]').forEach(input => input.addEventListener("change", event => this.#toggleEnhancement(event)));
    root.querySelectorAll('[data-enhancement-input]').forEach(input => {
      const eventName = input.matches("select, input[type=checkbox]") ? "change" : "input";
      input.addEventListener(eventName, event => this.#updateEnhancement(event));
    });
    root.querySelectorAll('[data-resistance-type]').forEach(input => input.addEventListener("change", event => this.#updateResistanceType(event)));
    root.querySelectorAll('[data-effect-toggle]').forEach(input => input.addEventListener("change", event => this.#toggleGrantedEffect(event)));
    root.querySelectorAll('[data-effect-input]').forEach(input => {
      const eventName = input.matches("select, input[type=checkbox]") ? "change" : "input";
      input.addEventListener(eventName, event => this.#updateGrantedEffect(event));
    });
    root.querySelectorAll('[data-effect-multi]').forEach(input => input.addEventListener("change", event => this.#updateGrantedEffectMulti(event)));
    root.querySelectorAll('[data-action="add-effect-row"]').forEach(button => button.addEventListener("click", event => this.#addGrantedEffectRow(event)));
    root.querySelectorAll('[data-action="remove-effect-row"]').forEach(button => button.addEventListener("click", event => this.#removeGrantedEffectRow(event)));
    root.querySelectorAll('[data-imported-effect-input]').forEach(input => input.addEventListener("change", event => this.#updateImportedEffect(event)));
    root.querySelectorAll('[data-imported-activity-input]').forEach(input => input.addEventListener("change", event => this.#updateImportedActivity(event)));
    root.querySelectorAll('[data-action="remove-imported-effect"]').forEach(button => button.addEventListener("click", event => this.#removeImportedEffect(event)));
    root.querySelectorAll('[data-action="remove-imported-activity"]').forEach(button => button.addEventListener("click", event => this.#removeImportedActivity(event)));

    root.querySelectorAll('[data-progression-unlock]').forEach(input => input.addEventListener("change", event => this.#toggleLevelUnlock(event)));
    root.querySelectorAll('[data-progression-level]').forEach(input => input.addEventListener("change", event => this.#updateLevelUnlock(event)));
    root.querySelectorAll('[data-action="add-progression-tier"]').forEach(button => button.addEventListener("click", event => this.#addProgressionTier(event)));
    root.querySelectorAll('[data-action="remove-progression-tier"]').forEach(button => button.addEventListener("click", event => this.#removeProgressionTier(event)));
    root.querySelectorAll('[data-progression-tier-input]').forEach(input => {
      const eventName = input.matches("select, input[type=checkbox]") ? "change" : "input";
      input.addEventListener(eventName, event => this.#updateProgressionTier(event));
    });
    root.querySelector('[data-action="browse-spells"]')?.addEventListener("click", event => this.#openSpellBrowser(event));
    root.querySelectorAll('[data-action="remove-granted-spell"]').forEach(button => button.addEventListener("click", event => this.#removeGrantedSpell(event)));
    root.querySelectorAll('[data-granted-spell-input]').forEach(input => input.addEventListener("change", event => this.#updateGrantedSpell(event)));
    root.querySelector('[data-action="add-resource-modification"]')?.addEventListener("click", event => this.#addResourceModification(event));
    root.querySelectorAll('[data-action="remove-resource-modification"]').forEach(button => button.addEventListener("click", event => this.#removeResourceModification(event)));
    root.querySelectorAll('[data-resource-input]').forEach(input => {
      const eventName = input.matches("select, input[type=checkbox]") ? "change" : "input";
      input.addEventListener(eventName, event => this.#updateResourceModification(event));
    });
    root.querySelector('[data-action="add-triggered-effect"]')?.addEventListener("click", event => this.#addTriggeredEffect(event));
    root.querySelectorAll('[data-action="remove-triggered-effect"]').forEach(button => button.addEventListener("click", event => this.#removeTriggeredEffect(event)));
    root.querySelectorAll('[data-trigger-input]').forEach(input => {
      if (input.matches("select, input[type=checkbox]")) {
        input.addEventListener("change", event => this.#updateTriggeredEffect(event, { commit: true, render: true }));
      } else {
        input.addEventListener("input", event => this.#updateTriggeredEffect(event, { commit: false, render: false }));
        input.addEventListener("change", event => this.#updateTriggeredEffect(event, { commit: true, render: true }));
      }
    });
    root.querySelectorAll('[data-action="browse-trigger-spell"]').forEach(button => button.addEventListener("click", event => this.#browseTriggeredSource(event, "spell")));
    root.querySelectorAll('[data-action="browse-trigger-feature"]').forEach(button => button.addEventListener("click", event => this.#browseTriggeredSource(event, "feature")));
    root.querySelectorAll('[data-action="browse-trigger-effect-spell"]').forEach(button => button.addEventListener("click", event => this.#browseTriggeredEffectSpell(event)));
    root.querySelectorAll('[data-action="add-triggered-payload"]').forEach(button => button.addEventListener("click", event => this.#addTriggeredPayload(event)));
    root.querySelectorAll('[data-action="remove-triggered-payload"]').forEach(button => button.addEventListener("click", event => this.#removeTriggeredPayload(event)));
    root.querySelectorAll('[data-trigger-payload-input]').forEach(input => {
      if (input.matches("select, input[type=checkbox]")) {
        input.addEventListener("change", event => this.#updateTriggeredPayload(event, { commit: true, render: true }));
      } else {
        input.addEventListener("input", event => this.#updateTriggeredPayload(event, { commit: false, render: false }));
        input.addEventListener("change", event => this.#updateTriggeredPayload(event, { commit: true, render: true }));
      }
    });
    root.querySelector('[data-description-toggle]')?.addEventListener("change", event => this.#toggleDescriptionCustomization(event));
    const descriptionEditor = this.#mountDescriptionEditor(root);
    descriptionEditor?.addEventListener("input", event => this.#updateDescription(event));
    descriptionEditor?.addEventListener("change", event => this.#updateDescription(event));
    descriptionEditor?.addEventListener("focusout", event => this.#updateDescription(event));
    const spellDropZone = root.querySelector('[data-spell-drop-zone]');
    if (spellDropZone) {
      spellDropZone.addEventListener("dragover", event => this.#spellDragOver(event));
      spellDropZone.addEventListener("dragleave", event => this.#spellDragLeave(event));
      spellDropZone.addEventListener("drop", event => this.#spellDrop(event));
    }

    this.#applyTemplateFilter();
    if (Number.isFinite(this.restoreScrollTop)) {
      const top = this.restoreScrollTop;
      this.restoreScrollTop = null;
      requestAnimationFrame(() => {
        const content = this.element?.querySelector(".ic-step-content");
        if (content) content.scrollTop = top;
      });
    }
  }


  #progressionSetting(kind, key, id = null) {
    if (kind === "enhancement") return this.enhancementValues?.[key] ?? null;
    if (kind === "effect") return this.grantedEffectValues?.[key] ?? null;
    if (kind === "damage") return (this.overrides.additionalDamage ?? []).find(row => row.id === id) ?? null;
    if (kind === "spell") return (this.enhancementValues.grantedSpellcasting?.spells ?? []).find(spell => spell.id === id) ?? null;
    return null;
  }

  #progressionAttributes(kind, key, id = null, tierId = null) {
    return [
      `data-progression-kind="${foundry.utils.escapeHTML(kind)}"`,
      `data-progression-key="${foundry.utils.escapeHTML(key ?? "")}"`,
      id ? `data-progression-id="${foundry.utils.escapeHTML(id)}"` : "",
      tierId ? `data-progression-tier-id="${foundry.utils.escapeHTML(tierId)}"` : ""
    ].filter(Boolean).join(" ");
  }

  #unlockControlHtml(kind, key, setting, id = null) {
    ensureProgressionGroup(setting);
    const attributes = this.#progressionAttributes(kind, key, id);
    return `<span class="ic-level-unlock-control" ${attributes}>
      <label title="Make this property inactive until the Actor reaches the selected total character level.">
        <input type="checkbox" data-progression-unlock ${attributes} ${setting.unlockOnLevel ? "checked" : ""}>
        <span>Unlock on Level</span>
      </label>
      <label class="ic-level-unlock-value ${setting.unlockOnLevel ? "" : "hidden"}">
        <span>Level</span>
        <input type="number" min="1" max="20" step="1" value="${clampCharacterLevel(setting.unlockLevel)}" data-progression-level ${attributes} ${setting.unlockOnLevel ? "" : "disabled"}>
      </label>
    </span>`;
  }

  #effectTierField(key, tier, attributes) {
    const labels = {
      armorClassBonus: "AC Bonus",
      weaponAttackBonus: "Weapon Attack Bonus",
      weaponDamageBonus: "Weapon Damage Bonus",
      initiativeBonus: "Initiative Bonus",
      proficiencyBonusModifier: "Proficiency Bonus Modifier",
      maximumHitPointsBonus: "Maximum Hit Points",
      spellAttackBonus: "Spell Attack Bonus",
      spellSaveDcBonus: "Spell Save DC Bonus"
    };
    const availabilityOptions = [
      ["owned", "Item is Owned"], ["equipped", "Equipped"], ["equippedAttuned", "Equipped and Attuned"]
    ].map(([value, label]) => `<option value="${value}" ${tier.availability === value ? "selected" : ""}>${label}</option>`).join("");
    return `<label><span>${labels[key] ?? "Modifier"}</span><input type="number" step="1" value="${Number(tier.bonus) || 0}" data-progression-tier-input="bonus" data-value-type="number" ${attributes}></label>
      <label><span>Active While</span><select data-progression-tier-input="availability" ${attributes}>${availabilityOptions}</select></label>`;
  }

  #enhancementTierField(_key, tier, attributes) {
    const options = [1, 2, 3].map(value => `<option value="${value}" ${Number(tier.bonus) === value ? "selected" : ""}>+${value}</option>`).join("");
    return `<label><span>Enhancement Bonus</span><select data-progression-tier-input="bonus" data-value-type="number" ${attributes}>${options}</select></label>`;
  }

  #damageTierFields(tier, attributes) {
    const dice = [4, 6, 8, 10, 12, 20].map(value => `<option value="${value}" ${Number(tier.denomination) === value ? "selected" : ""}>d${value}</option>`).join("");
    const damageTypes = Object.entries(CONFIG.DND5E.damageTypes ?? {}).map(([value, entry]) => {
      const label = localizedLabel(entry, value);
      return `<option value="${foundry.utils.escapeHTML(value)}" ${tier.damageType === value ? "selected" : ""}>${foundry.utils.escapeHTML(label)}</option>`;
    }).join("");
    const abilities = abilityModifierOptions(tier.ability).map(option => `<option value="${foundry.utils.escapeHTML(option.value)}" ${option.selected ? "selected" : ""}>${foundry.utils.escapeHTML(option.label)}</option>`).join("");
    return `<label><span>Dice</span><input type="number" min="1" max="20" step="1" value="${Number(tier.number) || 1}" data-progression-tier-input="number" data-value-type="number" ${attributes}></label>
      <label><span>Die</span><select data-progression-tier-input="denomination" data-value-type="number" ${attributes}>${dice}</select></label>
      <label><span>Damage Type</span><select data-progression-tier-input="damageType" ${attributes}>${damageTypes}</select></label>
      <label class="ic-mini-check"><input type="checkbox" data-progression-tier-input="useAbilityModifier" ${attributes} ${tier.useAbilityModifier ? "checked" : ""}><span>Add Ability Modifier</span></label>
      <label><span>Ability</span><select data-progression-tier-input="ability" ${attributes} ${tier.useAbilityModifier ? "" : "disabled"}>${abilities}</select></label>`;
  }

  #tierListHtml(kind, key, setting, id = null) {
    const tiers = setting.tiers ?? [];
    const rows = tiers.map((tier, index) => {
      const attributes = this.#progressionAttributes(kind, key, id, tier.id);
      const fields = kind === "enhancement" ? this.#enhancementTierField(key, tier, attributes)
        : kind === "effect" ? this.#effectTierField(key, tier, attributes)
          : this.#damageTierFields(tier, attributes);
      return `<section class="ic-progression-tier-row">
        <header><strong>Progression Tier ${index + 2}</strong><button type="button" data-action="remove-progression-tier" ${attributes} aria-label="Remove progression tier"><i class="fa-solid fa-trash"></i></button></header>
        <div class="ic-progression-tier-fields">${fields}
          <label><span>Unlock Level</span><input type="number" min="1" max="20" step="1" value="${clampCharacterLevel(tier.unlockLevel)}" data-progression-tier-input="unlockLevel" data-value-type="number" ${attributes}></label>
        </div>
      </section>`;
    }).join("");
    const attributes = this.#progressionAttributes(kind, key, id);
    return `<div class="ic-progression-tier-panel">${rows}<button type="button" class="ic-add-progression-tier" data-action="add-progression-tier" ${attributes}><i class="fa-solid fa-plus"></i> Add Progression Tier</button></div>`;
  }

  #mountLevelProgressionControls(root) {
    for (const toggle of root.querySelectorAll('[data-enhancement-toggle]')) {
      const key = toggle.dataset.enhancementToggle;
      if (!key || key === "grantedSpellcasting" || !this.enhancements[key]) continue;
      const setting = this.enhancementValues[key];
      if (!setting) continue;
      ensureProgressionGroup(setting);
      const card = toggle.closest(".ic-enhancement-card");
      const heading = card?.querySelector(".ic-override-heading");
      if (heading && !card.querySelector("[data-progression-unlock]")) heading.insertAdjacentHTML("afterend", this.#unlockControlHtml("enhancement", key, setting));
      if (card && REPEATABLE_ENHANCEMENTS.has(key)) card.insertAdjacentHTML("beforeend", this.#tierListHtml("enhancement", key, setting));
    }

    for (const toggle of root.querySelectorAll('[data-effect-toggle]')) {
      const key = toggle.dataset.effectToggle;
      if (!key || !this.grantedEffects[key]) continue;
      const setting = this.grantedEffectValues[key];
      if (!setting) continue;
      ensureProgressionGroup(setting);
      const card = toggle.closest(".ic-effect-card");
      const heading = card?.querySelector(".ic-override-heading");
      if (heading && !card.querySelector("[data-progression-unlock]")) heading.insertAdjacentHTML("afterend", this.#unlockControlHtml("effect", key, setting));
      if (card && REPEATABLE_GRANTED_EFFECTS.has(key)) card.insertAdjacentHTML("beforeend", this.#tierListHtml("effect", key, setting));
    }

    for (const row of root.querySelectorAll(".ic-additional-damage-row")) {
      const id = row.querySelector("[data-damage-id]")?.dataset.damageId;
      const setting = this.#progressionSetting("damage", "additionalDamage", id);
      if (!id || !setting) continue;
      ensureProgressionGroup(setting);
      const header = row.querySelector("header");
      const removeButton = header?.querySelector('[data-action="remove-additional-damage"]');
      if (removeButton) removeButton.insertAdjacentHTML("beforebegin", this.#unlockControlHtml("damage", "additionalDamage", setting, id));
      else if (header) header.insertAdjacentHTML("beforeend", this.#unlockControlHtml("damage", "additionalDamage", setting, id));
      row.insertAdjacentHTML("beforeend", this.#tierListHtml("damage", "additionalDamage", setting, id));
    }

    for (const article of root.querySelectorAll(".ic-granted-spell[data-spell-id]")) {
      const id = article.dataset.spellId;
      const setting = this.#progressionSetting("spell", "grantedSpell", id);
      if (!setting) continue;
      ensureProgressionGroup(setting);
      const header = article.querySelector(".ic-granted-spell-header");
      const removeButton = header?.querySelector('[data-action="remove-granted-spell"]');
      if (removeButton) removeButton.insertAdjacentHTML("beforebegin", this.#unlockControlHtml("spell", "grantedSpell", setting, id));
      else if (header) header.insertAdjacentHTML("beforeend", this.#unlockControlHtml("spell", "grantedSpell", setting, id));
    }
  }

  #toggleLevelUnlock(event) {
    const { progressionKind: kind, progressionKey: key, progressionId: id } = event.currentTarget.dataset;
    const setting = this.#progressionSetting(kind, key, id);
    if (!setting) return;
    ensureProgressionGroup(setting);
    setting.unlockOnLevel = event.currentTarget.checked;
    setting.unlockLevel = clampCharacterLevel(setting.unlockLevel);
    this.#renderPreservingScroll();
  }

  #updateLevelUnlock(event) {
    const { progressionKind: kind, progressionKey: key, progressionId: id } = event.currentTarget.dataset;
    const setting = this.#progressionSetting(kind, key, id);
    if (!setting) return;
    setting.unlockLevel = clampCharacterLevel(event.currentTarget.value);
    event.currentTarget.value = setting.unlockLevel;
  }

  #newProgressionTier(kind, key, setting) {
    ensureProgressionGroup(setting);
    const levels = [setting.unlockOnLevel ? clampCharacterLevel(setting.unlockLevel) : 0, ...(setting.tiers ?? []).map(tier => clampCharacterLevel(tier.unlockLevel))];
    const unlockLevel = Math.min(20, Math.max(1, Math.max(...levels) + 1));
    const common = { id: foundry.utils.randomID(), unlockOnLevel: true, unlockLevel };
    if (kind === "enhancement") return { ...common, bonus: Math.min(3, Math.max(1, Number(setting.bonus) + (setting.tiers?.length ?? 0) + 1)) };
    if (kind === "effect") return { ...common, bonus: Number(setting.bonus) || 0, availability: setting.availability ?? "equipped" };
    if (kind === "damage") return {
      ...common,
      number: Number(setting.number) || 1,
      denomination: Number(setting.denomination) || 6,
      damageType: setting.damageType ?? "",
      useAbilityModifier: Boolean(setting.useAbilityModifier),
      ability: setting.ability ?? ""
    };
    return null;
  }

  #addProgressionTier(event) {
    event.preventDefault();
    const { progressionKind: kind, progressionKey: key, progressionId: id } = event.currentTarget.dataset;
    const setting = this.#progressionSetting(kind, key, id);
    if (!setting) return;
    setting.tiers ??= [];
    const tier = this.#newProgressionTier(kind, key, setting);
    if (!tier) return;
    setting.tiers.push(tier);
    this.#renderPreservingScroll();
  }

  #removeProgressionTier(event) {
    event.preventDefault();
    const { progressionKind: kind, progressionKey: key, progressionId: id, progressionTierId: tierId } = event.currentTarget.dataset;
    const setting = this.#progressionSetting(kind, key, id);
    if (!setting || !tierId) return;
    setting.tiers = (setting.tiers ?? []).filter(tier => tier.id !== tierId);
    this.#renderPreservingScroll();
  }

  #updateProgressionTier(event) {
    const { progressionKind: kind, progressionKey: key, progressionId: id, progressionTierId: tierId } = event.currentTarget.dataset;
    const part = event.currentTarget.dataset.progressionTierInput;
    const setting = this.#progressionSetting(kind, key, id);
    const tier = (setting?.tiers ?? []).find(entry => entry.id === tierId);
    if (!tier || !part) return;
    let value;
    if (event.currentTarget.type === "checkbox") value = event.currentTarget.checked;
    else if (event.currentTarget.dataset.valueType === "number") value = Number(event.currentTarget.value) || 0;
    else value = event.currentTarget.value;
    tier[part] = part === "unlockLevel" ? clampCharacterLevel(value) : value;
    if (part === "useAbilityModifier") {
      tier.ability = value ? (tier.ability || "attack") : "";
      this.#renderPreservingScroll();
    }
  }


  #mountDescriptionEditor(root) {
    const host = root.querySelector?.("[data-description-editor-host]");
    if (!host || !this.descriptionCustomized) return null;

    const EditorElement = foundry.applications?.elements?.HTMLProseMirrorElement;
    let editor;
    if (EditorElement?.create) {
      editor = EditorElement.create({
        name: "system.description.value",
        value: String(this.customDescription ?? this.templateDescriptionRaw ?? "")
      });
    } else {
      editor = document.createElement("prose-mirror");
      editor.setAttribute("name", "system.description.value");
      editor.setAttribute("value", String(this.customDescription ?? this.templateDescriptionRaw ?? ""));
    }

    editor.classList.add("sized", "ic-description-editor");
    editor.setAttribute("compact", "");
    editor.dataset.descriptionEditor = "";
    if (this.selectedWeaponDocument?.uuid) editor.setAttribute("document-uuid", this.selectedWeaponDocument.uuid);
    host.replaceChildren(editor);

    const expose = () => this.#exposeDescriptionEditorSurface(editor);
    editor.addEventListener("open", expose, { once: true });
    requestAnimationFrame(expose);
    setTimeout(expose, 50);
    setTimeout(expose, 250);

    const observerTarget = editor.shadowRoot ?? editor;
    const observer = new MutationObserver(() => expose());
    observer.observe(observerTarget, { childList: true, subtree: true });
    editor.addEventListener("close", () => observer.disconnect(), { once: true });
    return editor;
  }

  #exposeDescriptionEditorSurface(editor) {
    if (!editor) return;
    const roots = [editor.shadowRoot, editor].filter(Boolean);
    const containers = [];
    for (const root of roots) {
      containers.push(...root.querySelectorAll?.(".editor, .editor-container, .editor-content, .ProseMirror") ?? []);
    }
    for (const node of containers) {
      node.style.setProperty("visibility", "visible", "important");
      node.style.setProperty("opacity", "1", "important");
      node.style.setProperty("pointer-events", "auto", "important");
    }

    const surface = queryEditorSurface(editor);
    if (!surface) return;
    surface.style.setProperty("display", "block", "important");
    surface.style.setProperty("position", "relative", "important");
    surface.style.setProperty("z-index", "3", "important");
    surface.style.setProperty("min-height", "320px", "important");
    surface.style.setProperty("width", "100%", "important");
    surface.style.setProperty("visibility", "visible", "important");
    surface.style.setProperty("opacity", "1", "important");
    surface.style.setProperty("pointer-events", "auto", "important");
    surface.style.setProperty("color", "#f1eadc", "important");
    surface.style.setProperty("-webkit-text-fill-color", "currentColor", "important");
    surface.style.setProperty("caret-color", "#ffffff", "important");
    surface.style.setProperty("background", "#111114", "important");
    surface.setAttribute("aria-label", "Editable item description");
  }

  #builderDraft(effective = this.#effectiveValues()) {
    const customized = clone(this.customized);
    const overrides = clone(this.overrides);
    for (const [field, enabled] of Object.entries(customized)) {
      if (!enabled) delete overrides[field];
    }
    if (!customized.additionalDamage) delete overrides.additionalDamage;

    return {
      itemType: this.selectedType,
      equipmentForm: this.equipmentForm,
      template: this.selectedWeaponDocument,
      baseWeapon: this.selectedBaseWeaponDocument,
      baseEquipment: this.selectedBaseWeaponDocument,
      baseTool: this.selectedBaseWeaponDocument,
      itemName: this.itemName,
      icon: this.selectedIcon || this.selectedWeaponDocument?.img,
      effective,
      customized,
      overrides,
      enhancements: clone(this.enhancements),
      enhancementValues: clone(this.enhancementValues),
      magicAutomation: { magicalFromGrantedSpellcasting: this.magicalAutoFromGrantedSpellcasting },
      grantedEffects: clone(this.grantedEffects),
      grantedEffectValues: clone(this.grantedEffectValues),
      resourceModifications: clone(this.resourceModifications),
      triggeredEffects: clone(this.triggeredEffects),
      description: this.descriptionCustomized ? this.customDescription : this.templateDescription,
      descriptionCustomized: this.descriptionCustomized,
      editingSourceUuid: this.editingItem?.uuid ?? null,
      importedItem: this.editingImportedItem,
      replaceAttackDamageParts: this.replaceAttackDamageParts,
      managedActivityIds: clone(this.managedActivityIds),
      managedPrimaryAttackId: this.managedPrimaryAttackId,
      preserveAdditionalAttackActivities: this.preserveAdditionalAttackActivities,
      managedEffectIds: clone(this.managedEffectIds),
      customImportedEffects: clone(this.customImportedEffects),
      customImportedActivities: clone(this.customImportedActivities),
      importedBaseSummary: clone(this.importedBaseSummary)
    };
  }

  async #saveItem(event) {
    event.preventDefault();
    return this.#commitItem("create");
  }

  async #updateItem(event) {
    event.preventDefault();
    if (!this.editingItem) return;
    return this.#commitItem("update");
  }

  async #saveCopy(event) {
    event.preventDefault();
    if (!this.editingItem) return;
    return this.#commitItem("copy");
  }

  #mergeOriginalFlags(data) {
    if (!this.originalItemSource) return data;
    data.flags = foundry.utils.mergeObject(clone(this.originalItemSource.flags ?? {}), clone(data.flags ?? {}), {
      inplace: false,
      recursive: true,
      overwrite: true,
      insertKeys: true,
      insertValues: true
    });
    return data;
  }

  async #replaceActivities(activities) {
    const currentIds = valuesOf(this.editingItem?.system?.activities)
      .map(activity => activity?.id ?? activity?._id)
      .filter(Boolean);
    if (currentIds.length) {
      const deletions = {};
      for (const id of currentIds) deletions[`system.activities.-=${id}`] = null;
      await this.editingItem.update(deletions, { render: false });
    }
    if (activities && Object.keys(activities).length) {
      await this.editingItem.update({ "system.activities": clone(activities) }, { render: false });
    }
  }

  async #replaceEffects(effects) {
    const existingEffectIds = valuesOf(this.editingItem?.effects).map(effect => effect.id).filter(Boolean);
    if (existingEffectIds.length) await this.editingItem.deleteEmbeddedDocuments("ActiveEffect", existingEffectIds);
    if (effects?.length) await this.editingItem.createEmbeddedDocuments("ActiveEffect", clone(effects), { keepId: true });
  }

  async #updateWorldItem(data) {
    if (!this.editingItem || this.editingItem.parent || this.editingItem.pack) throw new Error("The original world Item is no longer available for updating.");
    const rollbackSource = clone(this.originalItemSource ?? this.editingItem.toObject());
    const rollbackEffects = clone(rollbackSource.effects ?? []);
    const rollbackActivities = clone(rollbackSource.system?.activities ?? {});
    const desiredEffects = clone(data.effects ?? []);
    const desiredActivities = clone(data.system?.activities ?? {});
    const updateData = clone(data);
    delete updateData.effects;
    if (updateData.system) delete updateData.system.activities;

    try {
      await this.editingItem.update(updateData, { render: false });
      await this.#replaceActivities(desiredActivities);
      await this.#replaceEffects(desiredEffects);
      return this.editingItem;
    } catch (error) {
      console.error(`${MODULE_ID} | Item update failed; attempting rollback.`, error);
      try {
        const rollbackData = clone(rollbackSource);
        delete rollbackData._id;
        delete rollbackData.effects;
        delete rollbackData.folder;
        delete rollbackData.sort;
        delete rollbackData.ownership;
        delete rollbackData._stats;
        if (rollbackData.system) delete rollbackData.system.activities;
        await this.editingItem.update(rollbackData, { render: false });
        await this.#replaceActivities(rollbackActivities);
        await this.#replaceEffects(rollbackEffects);
      } catch (rollbackError) {
        console.error(`${MODULE_ID} | Item update rollback failed.`, rollbackError);
        error.rollbackError = rollbackError;
      }
      throw error;
    }
  }

  async #commitItem(mode) {
    if (this.savingItem) return;
    this.#syncDescriptionFromEditor();
    if (!this.#isBaseComplete() || !this.#validateEnhancements().valid || !this.#validateGrantedEffects().valid || !this.#validateSpellsResources().valid) {
      ui.notifications.error("Item Creator found incomplete or invalid configuration. Review the enabled cards before saving.");
      return;
    }

    try {
      await ItemCreatorItemBuilder.build(this.#builderDraft());
    } catch (error) {
      console.error(`${MODULE_ID} | Final Item validation failed.`, error);
      ui.notifications.error(`The Item could not be validated: ${error?.message ?? "Unknown validation error"}`);
      return;
    }

    const itemName = this.itemName.trim();
    const isUpdate = mode === "update";
    const isCopy = mode === "copy";
    const title = isUpdate ? "Confirm Item Update" : "Confirm Item Creation";
    const heading = title;
    const message = isUpdate
      ? `Update <strong>${foundry.utils.escapeHTML(this.editingItem?.name ?? itemName)}</strong> in the Items Directory? Existing copies already placed on Actors will not be changed.`
      : isCopy
        ? `Create a new World Item based on <strong>${foundry.utils.escapeHTML(this.editingItem?.name ?? itemName)}</strong>? The original Item will remain unchanged.`
        : `Create <strong>${foundry.utils.escapeHTML(itemName)}</strong> in the Items Directory?`;
    const confirmed = await ProtectedTransactionDialogService.confirm({
      key: isUpdate ? `update-item-${this.editingItemId}` : isCopy ? `copy-item-${this.editingItemId}` : "create-item",
      matchClass: "ic-confirm-item-dialog",
      dialogOptions: {
        classes: ["ic-confirm-item-dialog"],
        window: { title, modal: true },
        content: `<div class="ic-confirm-item-content"><i class="fa-solid ${isUpdate ? "fa-pen-to-square" : "fa-hammer"}"></i><div><h2>${heading}</h2><p>${message}</p></div></div>`,
        yes: { label: "OK", icon: "fa-solid fa-check" },
        no: { label: "Cancel", icon: "fa-solid fa-xmark" }
      }
    });
    if (!confirmed) return;

    this.savingItem = true;
    const processingTitle = isUpdate ? "Updating Item…" : isCopy ? "Creating Item Copy…" : "Creating Item…";
    const processingMessage = isUpdate
      ? "Updating the Item, Activities, Active Effects, granted Spells, and source metadata. Please wait."
      : "Building the Item, Activities, Active Effects, granted Spells, and source metadata. Please wait.";
    try {
      const result = await ProtectedTransactionDialogService.runProcessing({
        title: processingTitle,
        message: processingMessage,
        operation: async () => {
          const { data: builtData } = await ItemCreatorItemBuilder.build(this.#builderDraft());
          const data = this.#mergeOriginalFlags(clone(builtData));
          if (isUpdate) return this.#updateWorldItem(data);

          if (isCopy && this.originalItemSource) {
            data.folder = this.editingItem?.folder?.id ?? this.originalItemSource.folder ?? null;
            data.ownership = clone(this.originalItemSource.ownership ?? { default: 0 });
          }
          const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
          const item = await ItemClass.create(data, { renderSheet: false });
          if (!item) throw new Error("Foundry did not return the created Item document.");
          return item;
        }
      });
      ui.notifications.info(isUpdate
        ? `${result.name} was updated successfully.`
        : `${result.name} was created successfully${isCopy ? " as a new copy" : ""}.`);
      await this.close();
      ui.items?.render?.();
    } catch (error) {
      console.error(`${MODULE_ID} | Item ${isUpdate ? "update" : "creation"} failed.`, error);
      ui.notifications.error(isUpdate
        ? `Item update failed. The original Item was not intentionally replaced: ${error?.message ?? "Unknown error"}`
        : `Item creation failed. No new Item was created: ${error?.message ?? "Unknown error"}`);
      this.savingItem = false;
      this.step = "review";
      this.render({ force: true });
    }
  }

  #sourceValues() {
    if (this.selectedType === "equipment") return equipmentSourceData(this.selectedBaseWeaponDocument);
    if (this.selectedType === "tool") return toolSourceData(this.selectedBaseWeaponDocument);
    return weaponSourceData(this.selectedBaseWeaponDocument);
  }

  #effectiveValues(source = this.#sourceValues()) {
    if (!source) return null;
    const effective = clone(source);
    for (const [field, enabled] of Object.entries(this.customized)) {
      if (!enabled || !(field in this.overrides) || ["icon", "baseWeapon"].includes(field)) continue;
      effective[field] = clone(this.overrides[field]);
    }
    if (this.customized.properties) {
      if ("versatile" in this.overrides) effective.versatile = clone(this.overrides.versatile);
      if ("ammunitionType" in this.overrides) effective.ammunitionType = this.overrides.ammunitionType;
    }

    // Once an external world Item has been imported, its current Activity source
    // is also the document being replaced. Do not feed old managed damage parts
    // back into the next build. The active draft is the sole source of truth.
    if (this.selectedType === "weapon" && this.editingImportedItem && this.editingItem
      && this.selectedBaseWeaponDocument?.uuid === this.editingItem.uuid) {
      effective.additionalDamage = this.customized.additionalDamage
        ? clone(this.overrides.additionalDamage ?? [])
        : [];
    }
    return effective;
  }

  #captureScroll() {
    return this.element?.querySelector(".ic-step-content")?.scrollTop ?? 0;
  }

  #renderPreservingScroll() {
    this.restoreScrollTop = this.#captureScroll();
    this.render({ force: true });
  }

  async #selectType(event) {
    event.preventDefault();
    const button = event.currentTarget;
    if (button.disabled || button.dataset.available !== "true") return;
    const nextType = button.dataset.type;

    if (nextType === "scrollFactory") {
      if (this.editingItem) {
        ui.notifications.warn("Close the current Item editing draft before opening Scroll Factory.");
        return;
      }
      await this.close();
      game.itemCreator?.openScrollFactory?.();
      return;
    }

    if (nextType === "supplier") {
      if (this.editingItem) {
        ui.notifications.warn("Close the current Item editing draft before opening Supplier.");
        return;
      }
      await this.close();
      game.itemCreator?.openSupplier?.();
      return;
    }

    if (this.editingItem && nextType !== this.editingItem.type) {
      ui.notifications.warn("Editing cannot change the Foundry Item document type. Use Save as Copy from the original type instead.");
      return;
    }
    if (this.selectedType && this.selectedType !== nextType) this.#clearTemplate();
    this.selectedType = nextType;
    this.#resetEnhancements();
    this.#resetGrantedEffects();
    this.render({ force: true });
  }

  #syncDescriptionFromEditor() {
    if (!this.descriptionCustomized) return;
    const editor = this.element?.querySelector?.("[data-description-editor]");
    const value = readDescriptionEditorValue(editor);
    if (value !== null) this.customDescription = value;
  }

  #changeStep(event) {
    event.preventDefault();
    this.#syncDescriptionFromEditor();
    const button = event.currentTarget;
    if (button.disabled || button.dataset.locked === "true") return;
    this.restoreScrollTop = null;
    this.step = button.dataset.step;
    this.render({ force: true });
  }

  #continue(event) {
    event.preventDefault();
    this.#syncDescriptionFromEditor();
    if (this.step === "itemType" && ["weapon", "equipment", "tool"].includes(this.selectedType)) {
      this.restoreScrollTop = null;
      this.step = "baseItem";
      this.render({ force: true });
      return;
    }
    if (this.step === "baseItem" && this.#isBaseComplete()) {
      this.restoreScrollTop = null;
      this.step = "enhancements";
      this.render({ force: true });
      return;
    }
    if (this.step === "enhancements" && this.#isBaseComplete() && this.#validateEnhancements().valid) {
      this.restoreScrollTop = null;
      this.step = "grantedEffects";
      this.render({ force: true });
      return;
    }
    if (this.step === "grantedEffects" && this.#validateGrantedEffects().valid) {
      this.restoreScrollTop = null;
      this.step = "spellsResources";
      this.render({ force: true });
      return;
    }
    if (this.step === "spellsResources" && this.#validateSpellsResources().valid) {
      this.restoreScrollTop = null;
      this.step = "description";
      this.render({ force: true });
      return;
    }
    if (this.step === "description" && this.#validateSpellsResources().valid) {
      this.restoreScrollTop = null;
      this.step = "review";
      this.render({ force: true });
    }
  }

  #back(event) {
    event.preventDefault();
    this.#syncDescriptionFromEditor();
    if (this.step === "review") {
      this.restoreScrollTop = null;
      this.step = "description";
      this.render({ force: true });
      return;
    }
    if (this.step === "description") {
      this.restoreScrollTop = null;
      this.step = "spellsResources";
      this.render({ force: true });
      return;
    }
    if (this.step === "spellsResources") {
      this.restoreScrollTop = null;
      this.step = "grantedEffects";
      this.render({ force: true });
      return;
    }
    if (this.step === "grantedEffects") {
      this.restoreScrollTop = null;
      this.step = "enhancements";
      this.render({ force: true });
      return;
    }
    if (this.step === "enhancements") {
      this.restoreScrollTop = null;
      this.step = "baseItem";
      this.render({ force: true });
      return;
    }
    if (this.step === "baseItem") {
      this.restoreScrollTop = null;
      this.step = "itemType";
      this.render({ force: true });
    }
  }

  #createCustomEquipment(event) {
    event.preventDefault();
    if (this.selectedType !== "equipment") return;
    const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
    const id = foundry.utils.randomID();
    const source = {
      _id: id,
      name: "Custom Equipment",
      type: "equipment",
      img: "icons/svg/item-bag.svg",
      system: {
        description: { value: "", chat: "" },
        source: { custom: "Item Creator", rules: "2024", revision: 1 },
        identified: true,
        unidentified: { description: "" },
        container: null,
        quantity: 1,
        weight: { value: 0, units: "lb" },
        price: { value: 0, denomination: "gp" },
        rarity: "",
        attunement: "",
        attuned: false,
        equipped: false,
        armor: { value: 0, magicalBonus: "", dex: null },
        proficient: null,
        properties: [],
        strength: 0,
        type: { value: "wondrous", baseItem: "" },
        activities: {},
        identifier: "custom-equipment"
      },
      effects: [],
      flags: { [MODULE_ID]: { customSeed: true } }
    };
    const document = new ItemClass(source, { temporary: true });
    this.selectedWeaponUuid = document.uuid;
    this.selectedWeaponDocument = document;
    this.selectedBaseWeaponUuid = document.uuid;
    this.selectedBaseWeaponDocument = document;
    this.inheritedBaseWeaponUuid = document.uuid;
    this.baseWeaponRequired = false;
    this.equipmentForm = "accessory";
    this.itemName = "Custom Equipment";
    this.selectedIcon = source.img;
    this.templateCategory = "wondrous";
    this.customized = { nativeType: true };
    this.overrides = { nativeType: "wondrous" };
    this.#resetEnhancements();
    this.#resetGrantedEffects();
    this.customImportedEffects = [];
    this.customImportedActivities = [];
    this.importedBaseSummary = [];
    this.templateDescriptionRaw = "";
    this.templateDescription = "";
    this.customDescription = "";
    this.descriptionCustomized = true;
    this.restoreScrollTop = 0;
    this.render({ force: true });
  }

  #createCustomTool(event) {
    event.preventDefault();
    if (this.selectedType !== "tool") return;
    const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
    const id = foundry.utils.randomID();
    const source = {
      _id: id,
      name: "Custom Tool",
      type: "tool",
      img: "systems/dnd5e/icons/svg/items/tool.svg",
      system: {
        description: { value: "", chat: "" },
        source: { custom: "Item Creator", rules: "2024", revision: 1 },
        identified: true,
        unidentified: { description: "" },
        container: null,
        quantity: 1,
        weight: { value: 0, units: "lb" },
        price: { value: 0, denomination: "gp" },
        rarity: "",
        attunement: "",
        attuned: false,
        equipped: false,
        type: { value: "art", baseItem: "" },
        ability: "",
        bonus: "",
        proficient: null,
        properties: [],
        chatFlavor: "",
        uses: { max: "", spent: 0, recovery: [] },
        activities: {},
        identifier: "custom-tool"
      },
      effects: [],
      flags: { [MODULE_ID]: { customSeed: true } }
    };
    const document = new ItemClass(source, { temporary: true });
    this.selectedWeaponUuid = document.uuid;
    this.selectedWeaponDocument = document;
    this.selectedBaseWeaponUuid = document.uuid;
    this.selectedBaseWeaponDocument = document;
    this.inheritedBaseWeaponUuid = document.uuid;
    this.baseWeaponRequired = false;
    this.itemName = "Custom Tool";
    this.selectedIcon = source.img;
    this.templateCategory = "art";
    this.customized = { toolType: true, baseItem: true, ability: true, bonus: true };
    this.overrides = { toolType: "art", baseItem: "", ability: "", bonus: "" };
    this.#resetEnhancements();
    this.#resetGrantedEffects();
    this.customImportedEffects = [];
    this.customImportedActivities = [];
    this.importedBaseSummary = [];
    this.templateDescriptionRaw = "";
    this.templateDescription = "";
    this.customDescription = "";
    this.descriptionCustomized = true;
    this.restoreScrollTop = 0;
    this.render({ force: true });
  }

  #selectEquipmentForm(event) {
    if (this.selectedType !== "equipment") return;
    const formId = String(event.currentTarget.value ?? "accessory");
    const form = EQUIPMENT_FORMS.find(entry => entry.id === formId) ?? EQUIPMENT_FORMS.find(entry => entry.id === "accessory");
    this.equipmentForm = form.id;
    this.customized.nativeType = true;
    let nativeType = form.nativeType;
    if (form.id === "armor") {
      const current = this.#effectiveValues()?.nativeType;
      nativeType = ["light", "medium", "heavy", "natural"].includes(current) ? current : "light";
    }
    this.overrides.nativeType = nativeType;

    const properties = new Set(this.#effectiveValues()?.properties ?? []);
    properties.delete("foc");
    if (["armor", "shield"].includes(form.id)) {
      const current = this.#effectiveValues()?.armor ?? {};
      this.customized.armor = true;
      this.overrides.armor = {
        value: Number(current.value) || (form.id === "shield" ? 2 : 10),
        dex: form.id === "shield" ? 0 : (current.dex ?? defaultDexCap(nativeType)),
        magicalBonus: String(current.magicalBonus ?? "")
      };
    } else {
      this.customized.armor = true;
      this.overrides.armor = { value: 0, dex: null, magicalBonus: "" };
      this.customized.strength = true;
      this.overrides.strength = 0;
      properties.delete("stealthDisadvantage");
      if (form.id === "focus") properties.add("foc");
    }
    this.customized.properties = true;
    this.overrides.properties = [...properties];
    this.#resetEnhancements();
    this.#renderPreservingScroll();
  }

  #filterTemplates(event) {
    this.templateCategory = String(event.currentTarget.value ?? "all");
    this.#applyTemplateFilter();
  }

  #applyTemplateFilter() {
    const select = this.element?.querySelector("[data-template-select]");
    if (!select) return;
    let visible = 0;
    for (const option of select.querySelectorAll("option[data-template-option]")) {
      const matchesCategory = this.templateCategory === "all" || option.dataset.category === this.templateCategory;
      const keepSelected = option.value === this.selectedWeaponUuid;
      const show = matchesCategory || keepSelected;
      option.hidden = !show;
      option.disabled = !show;
      if (show) visible += 1;
    }
    for (const group of select.querySelectorAll("optgroup")) {
      const hasVisible = [...group.querySelectorAll("option[data-template-option]")].some(option => !option.hidden);
      group.hidden = !hasVisible;
      group.disabled = !hasVisible;
    }
    const counter = this.element.querySelector("[data-template-count]");
    if (counter) counter.textContent = String(visible);
  }

  async #selectTemplate(event) {
    const uuid = event.currentTarget.value;
    const accepted = await this.#requestTemplateChange(uuid, { resetScroll: false });
    if (!accepted) this.#renderPreservingScroll();
  }

  async #openTemplateBrowser(event) {
    event.preventDefault();
    if (this.templateBrowserOpen) return;

    const CompendiumBrowser = nativeCompendiumBrowserClass();
    if (!CompendiumBrowser?.selectOne) {
      ui.notifications.error("The native D&D5e Compendium Browser is unavailable.");
      return;
    }

    this.templateBrowserOpen = true;
    this.#setBrowserBlock(true);
    try {
      const uuid = await CompendiumBrowser.selectOne({
        mode: CompendiumBrowser.MODES?.ADVANCED ?? 2,
        tab: "items",
        hint: `Select a ${this.selectedType === "equipment" ? "Equipment" : this.selectedType === "tool" ? "Tool" : "Weapon"} document to use as the Base Item template.`,
        filters: {
          locked: {
            documentClass: "Item",
            types: new Set([this.selectedType === "equipment" ? "equipment" : this.selectedType === "tool" ? "tool" : "weapon"])
          }
        },
        window: { modal: true }
      });
      if (uuid) await this.#requestTemplateChange(uuid, { resetScroll: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Native Compendium Browser failed.`, error);
      ui.notifications.error("Item Creator could not open the D&D5e Compendium Browser.");
    } finally {
      this.templateBrowserOpen = false;
      this.#setBrowserBlock(false);
    }
  }

  async #requestTemplateChange(uuid, { resetScroll = false } = {}) {
    if (this.loadingWeapon) return false;
    if (uuid === this.selectedWeaponUuid) return true;

    if (this.selectedWeaponUuid && this.#hasTemplateChanges()) {
      const confirmed = await DialogV2.confirm({
        window: { title: uuid ? "Change Base Template" : "Clear Base Template", modal: true },
        content: `<p>${uuid ? "Changing" : "Clearing"} the base template will discard the custom Item name, all Base Item overrides, additional damage entries, the custom icon, all configured Enhancements and Granted Effects, and any customized Description.</p>`,
        yes: { label: uuid ? "Change Template" : "Clear Template", icon: "fa-solid fa-rotate" },
        no: { label: "Keep Current Template", icon: "fa-solid fa-xmark" }
      });
      if (!confirmed) return false;
    }

    if (!uuid) {
      this.#clearTemplate();
      this.templateCategory = "all";
      this.restoreScrollTop = resetScroll ? 0 : this.#captureScroll();
      this.render({ force: true });
      return true;
    }

    const priorScroll = this.#captureScroll();
    this.loadingWeapon = true;
    try {
      const registry = ItemCreatorSourceRegistry.instance;
      const equipment = this.selectedType === "equipment";
      const tool = this.selectedType === "tool";
      let document = equipment ? await registry.getEquipmentDocument(uuid)
        : tool ? await registry.getToolDocument(uuid) : await registry.getWeaponDocument(uuid);
      document ??= await fromUuid(uuid);
      if (equipment ? !isEquipmentItemDocument(document) : tool ? !isToolItemDocument(document) : !isWeaponItemDocument(document)) {
        throw new Error(`The selected document is not a ${equipment ? "Equipment" : tool ? "Tool" : "Weapon"} Item.`);
      }
      const option = equipment ? registry.findEquipment(uuid) : tool ? registry.findTool(uuid) : registry.findWeapon(uuid);
      this.selectedWeaponUuid = uuid;
      this.selectedWeaponDocument = document;
      this.itemName = document.name;
      this.selectedIcon = document.img || (equipment ? "icons/svg/item-bag.svg" : tool ? "systems/dnd5e/icons/svg/items/tool.svg" : "icons/svg/sword.svg");
      this.templateCategory = option?.[equipment ? "equipmentType" : tool ? "toolType" : "weaponType"] || document.system?.type?.value || "all";
      this.customized = {};
      this.overrides = {};
      if (equipment) this.equipmentForm = equipmentFormForDocument(document);
      this.#resetEnhancements();
      this.#resetGrantedEffects();
      await this.#translateDocumentMechanics(document);
      this.templateDescriptionRaw = rawTemplateDescription(document);
      this.templateDescription = cleanTemplateDescription(document);
      this.customDescription = this.templateDescriptionRaw;
      this.descriptionCustomized = false;

      if (equipment || tool) {
        this.inheritedBaseWeaponUuid = uuid;
        this.selectedBaseWeaponUuid = uuid;
        this.selectedBaseWeaponDocument = document;
        this.baseWeaponRequired = false;
      } else {
        const inherited = registry.findBaseWeaponByIdentifier(document.system?.type?.baseItem);
        this.inheritedBaseWeaponUuid = inherited?.uuid ?? null;
        this.selectedBaseWeaponUuid = inherited?.uuid ?? null;
        this.selectedBaseWeaponDocument = inherited ? await registry.getWeaponDocument(inherited.uuid) : null;
        this.baseWeaponRequired = !this.selectedBaseWeaponDocument;
        if (this.baseWeaponRequired) {
          this.customized.baseWeapon = true;
          this.overrides.baseWeapon = "";
        }
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to select item template.`, error);
      ui.notifications.error(`Item Creator could not load the selected ${this.selectedType === "equipment" ? "Equipment" : this.selectedType === "tool" ? "Tool" : "Weapon"} template.`);
      return false;
    } finally {
      this.loadingWeapon = false;
    }

    this.restoreScrollTop = resetScroll ? 0 : priorScroll;
    this.render({ force: true });
    return true;
  }

  #hasTemplateChanges() {
    if (!this.selectedWeaponDocument) return false;
    const meaningfulCustomization = Object.entries(this.customized).some(([field, enabled]) => {
      if (!enabled) return false;
      if (field === "baseWeapon" && this.baseWeaponRequired && !this.overrides.baseWeapon) return false;
      return true;
    });
    return this.itemName.trim() !== String(this.selectedWeaponDocument.name ?? "").trim()
      || meaningfulCustomization
      || Object.values(this.enhancements).some(Boolean)
      || Object.values(this.grantedEffects).some(Boolean)
      || this.resourceModifications.length > 0
      || this.triggeredEffects.length > 0
      || this.descriptionCustomized;
  }

  #clearTemplate() {
    this.selectedWeaponUuid = null;
    this.selectedWeaponDocument = null;
    this.inheritedBaseWeaponUuid = null;
    this.selectedBaseWeaponUuid = null;
    this.selectedBaseWeaponDocument = null;
    this.baseWeaponRequired = false;
    this.equipmentForm = "accessory";
    this.itemName = "";
    this.selectedIcon = "";
    this.customized = {};
    this.overrides = {};
    this.#resetEnhancements();
    this.#resetGrantedEffects();
    this.customImportedEffects = [];
    this.customImportedActivities = [];
    this.importedBaseSummary = [];
    this.templateDescription = "";
    this.templateDescriptionRaw = "";
    this.customDescription = "";
    this.descriptionCustomized = false;
    this.reviewBuildError = "";
    this.savingItem = false;
  }

  async #toggleDescriptionCustomization(event) {
    const enabled = event.currentTarget.checked;
    if (enabled) {
      this.descriptionCustomized = true;
      this.customDescription = this.templateDescriptionRaw;
      this.#renderPreservingScroll();
      return;
    }

    this.#syncDescriptionFromEditor();
    const changed = String(this.customDescription ?? "") !== String(this.templateDescriptionRaw ?? "");
    if (changed) {
      const confirmed = await DialogV2.confirm({
        window: { title: "Restore Template Description", modal: true },
        content: "<p>Disable description customization and discard the edited text? The inherited Template description will be restored.</p>",
        yes: { label: "Restore Template Description", icon: "fa-solid fa-rotate-left" },
        no: { label: "Keep Custom Description", icon: "fa-solid fa-xmark" }
      });
      if (!confirmed) {
        event.currentTarget.checked = true;
        return;
      }
    }
    this.descriptionCustomized = false;
    this.customDescription = this.templateDescriptionRaw;
    this.#renderPreservingScroll();
  }

  #updateDescription(event) {
    if (!this.descriptionCustomized) return;
    const value = readDescriptionEditorValue(event.currentTarget);
    if (value !== null) this.customDescription = value;
  }

  #updateItemName(event) {
    this.itemName = String(event.currentTarget.value ?? "");
    const draftName = this.element.querySelector("[data-draft-name]");
    if (draftName) draftName.textContent = this.itemName.trim() || "—";
  }

  async #toggleOverride(event) {
    const field = event.currentTarget.dataset.overrideToggle;
    if (!field || !this.selectedWeaponDocument) return;
    const enabled = event.currentTarget.checked;
    this.customized[field] = enabled;

    if (field === "baseWeapon" && this.selectedType === "weapon") {
      if (!enabled && this.baseWeaponRequired) {
        this.customized.baseWeapon = true;
        event.currentTarget.checked = true;
        return;
      }
      if (enabled) {
        this.overrides.baseWeapon = this.selectedBaseWeaponUuid ?? "";
      } else {
        delete this.overrides.baseWeapon;
        this.selectedBaseWeaponUuid = this.inheritedBaseWeaponUuid;
        this.selectedBaseWeaponDocument = this.inheritedBaseWeaponUuid
          ? await ItemCreatorSourceRegistry.instance.getWeaponDocument(this.inheritedBaseWeaponUuid)
          : null;
      }
    } else if (field === "icon") {
      const fallbackIcon = this.selectedType === "equipment" ? "icons/svg/item-bag.svg"
        : this.selectedType === "tool" ? "systems/dnd5e/icons/svg/items/tool.svg" : "icons/svg/sword.svg";
      if (enabled) this.overrides.icon = this.selectedIcon || this.selectedWeaponDocument.img || fallbackIcon;
      else {
        delete this.overrides.icon;
        this.selectedIcon = this.selectedWeaponDocument.img || fallbackIcon;
        this.iconBrowserApp?.close?.();
        this.iconBrowserApp = null;
      }
    } else if (field === "additionalDamage") {
      if (enabled) this.overrides.additionalDamage = [this.#newAdditionalDamage()];
      else delete this.overrides.additionalDamage;
    } else if (enabled) {
      const source = this.#sourceValues();
      this.overrides[field] = clone(source?.[field]);
      if (field === "properties" && this.selectedType === "weapon") {
        this.overrides.versatile = clone(source?.versatile);
        this.overrides.ammunitionType = source?.ammunitionType ?? "";
      }
    } else {
      delete this.overrides[field];
      if (field === "properties" && this.selectedType === "weapon") {
        delete this.overrides.versatile;
        delete this.overrides.ammunitionType;
      }
    }

    this.#renderPreservingScroll();
  }

  #updateOverride(event) {
    const field = event.currentTarget.dataset.overrideInput;
    const part = event.currentTarget.dataset.overridePart;
    const parent = event.currentTarget.dataset.overrideParent;
    if (!field || (parent ? !this.customized[parent] : !this.customized[field])) return;
    let value = event.currentTarget.value;
    if (event.currentTarget.dataset.valueType === "number") value = value === "" ? 0 : Number(value);

    if (part) {
      this.overrides[field] ??= {};
      this.overrides[field][part] = value;
    } else this.overrides[field] = value;
  }

  #updateProperty(event) {
    if (!this.customized.properties) return;
    const property = event.currentTarget.dataset.propertyKey;
    const properties = new Set(this.overrides.properties ?? []);
    const checked = event.currentTarget.checked;
    if (checked) properties.add(property);
    else properties.delete(property);
    this.overrides.properties = [...properties];

    if (this.selectedType === "weapon" && property === "ver") {
      if (checked) {
        const source = this.#sourceValues();
        this.overrides.versatile = {
          number: 1,
          denomination: source?.baseDamage?.denomination || 8,
          bonus: "",
          damageType: this.overrides.damageType ?? source?.damageType ?? ""
        };
      } else delete this.overrides.versatile;
    }
    if (this.selectedType === "weapon" && property === "amm") {
      if (checked) this.overrides.ammunitionType = "";
      else delete this.overrides.ammunitionType;
    }

    this.#renderPreservingScroll();
  }

  #clearBaseWeapon() {
    this.selectedBaseWeaponUuid = null;
    this.selectedBaseWeaponDocument = null;
  }

  #hasCoreOverrides() {
    const nonCore = new Set(["baseWeapon", "icon", "additionalDamage"]);
    return Object.entries(this.customized).some(([field, enabled]) => enabled && !nonCore.has(field));
  }

  #clearCoreOverrides() {
    const keep = new Set(["baseWeapon", "icon", "additionalDamage"]);
    for (const field of Object.keys(this.customized)) {
      if (keep.has(field)) continue;
      delete this.customized[field];
      delete this.overrides[field];
    }
    delete this.overrides.versatile;
    delete this.overrides.ammunitionType;
  }

  async #selectBaseWeapon(event) {
    if (this.selectedType !== "weapon") return;
    const uuid = String(event.currentTarget.value ?? "");
    if (!uuid) {
      if (this.baseWeaponRequired) {
        this.#clearBaseWeapon();
        this.overrides.baseWeapon = "";
        this.#renderPreservingScroll();
      }
      return;
    }
    if (uuid === this.selectedBaseWeaponUuid) return;

    if (this.selectedBaseWeaponUuid && this.#hasCoreOverrides()) {
      const confirmed = await DialogV2.confirm({
        window: { title: "Change Base Weapon", modal: true },
        content: "<p>Changing the Base Weapon will replace inherited weapon statistics. The selected Template and non-core customizations will remain unchanged.</p>",
        yes: { label: "Change Base Weapon", icon: "fa-solid fa-rotate" },
        no: { label: "Keep Current Base Weapon", icon: "fa-solid fa-xmark" }
      });
      if (!confirmed) {
        this.#renderPreservingScroll();
        return;
      }
      this.#clearCoreOverrides();
    }

    const registry = ItemCreatorSourceRegistry.instance;
    const option = registry.findWeapon(uuid);
    if (!option) {
      ui.notifications.error("The selected Base Weapon is not available in the active Item Creator sources.");
      this.#renderPreservingScroll();
      return;
    }
    const document = await registry.getWeaponDocument(uuid);
    if (!isWeaponItemDocument(document)) {
      ui.notifications.error("Item Creator could not load the selected Base Weapon.");
      this.#renderPreservingScroll();
      return;
    }

    this.selectedBaseWeaponUuid = uuid;
    this.selectedBaseWeaponDocument = document;
    this.customized.baseWeapon = true;
    this.overrides.baseWeapon = uuid;
    this.#renderPreservingScroll();
  }

  async #openIconBrowser(event) {
    event.preventDefault();
    if (!this.selectedWeaponUuid || !this.customized.icon) return;
    if (this.iconBrowserApp?.element?.isConnected) {
      this.iconBrowserApp.bringToFront?.();
      return;
    }
    this.#setBrowserBlock(true);
    this.iconBrowserApp = new ItemCreatorIconBrowserApp({
      itemType: this.selectedType,
      selectedIcon: this.selectedIcon,
      onSelect: img => {
        this.selectedIcon = img;
        this.overrides.icon = img;
        this.#renderPreservingScroll();
      },
      onClosed: app => {
        if (this.iconBrowserApp === app) this.iconBrowserApp = null;
        this.#setBrowserBlock(false);
      }
    });
    this.iconBrowserApp.render({ force: true });
  }

  #setBrowserBlock(active) {
    const element = this.element;
    if (!(element instanceof HTMLElement)) return;
    element.inert = Boolean(active);
    element.classList.toggle("ic-child-browser-open", Boolean(active));
    if (active) element.setAttribute("aria-busy", "true");
    else element.removeAttribute("aria-busy");
  }

  #newAdditionalDamage() {
    const firstType = CONFIG.DND5E.damageTypes?.fire ? "fire" : Object.keys(CONFIG.DND5E.damageTypes ?? {})[0] ?? "";
    return {
      id: foundry.utils.randomID(),
      number: 1,
      denomination: 6,
      damageType: firstType,
      useAbilityModifier: false,
      ability: "",
      unlockOnLevel: false,
      unlockLevel: 1,
      progressionGroupId: foundry.utils.randomID(),
      tiers: []
    };
  }

  #addAdditionalDamage(event) {
    event.preventDefault();
    if (!this.customized.additionalDamage) return;
    this.overrides.additionalDamage ??= [];
    this.overrides.additionalDamage.push(this.#newAdditionalDamage());
    this.#renderPreservingScroll();
  }

  #removeAdditionalDamage(event) {
    event.preventDefault();
    if (!this.customized.additionalDamage) return;
    const id = event.currentTarget.dataset.damageId;
    this.overrides.additionalDamage = (this.overrides.additionalDamage ?? []).filter(row => row.id !== id);
    if (!this.overrides.additionalDamage.length) this.overrides.additionalDamage.push(this.#newAdditionalDamage());
    this.#renderPreservingScroll();
  }

  #updateAdditionalDamage(event) {
    if (!this.customized.additionalDamage) return;
    const id = event.currentTarget.dataset.damageId;
    const part = event.currentTarget.dataset.extraDamageInput;
    const row = (this.overrides.additionalDamage ?? []).find(entry => entry.id === id);
    if (!row || !part) return;

    let value;
    if (event.currentTarget.type === "checkbox") value = event.currentTarget.checked;
    else if (event.currentTarget.dataset.valueType === "number") value = event.currentTarget.value === "" ? 0 : Number(event.currentTarget.value);
    else value = event.currentTarget.value;
    row[part] = value;

    if (part === "useAbilityModifier") {
      row.ability = value ? (row.ability || "attack") : "";
      this.#renderPreservingScroll();
    }
  }

  #validateProgressionSetting(setting, { tierable = false, tierValidator = null } = {}) {
    if (!validUnlockSetting(setting, { allowTiers: tierable })) return false;
    if (!tierable && (setting?.tiers?.length ?? 0)) return false;
    if (tierValidator && !(setting?.tiers ?? []).every(tierValidator)) return false;
    return true;
  }

  #validateAdditionalDamageRow(row) {
    const validDamage = entry => Number(entry.number) > 0
      && Number(entry.denomination) > 0
      && Boolean(entry.damageType)
      && (!entry.useAbilityModifier || Boolean(entry.ability));
    return validDamage(row)
      && this.#validateProgressionSetting(row, { tierable: true, tierValidator: validDamage });
  }

  #isBaseComplete() {
    const effective = this.#effectiveValues();
    const additionalDamageValid = this.selectedType !== "weapon" || !this.customized.additionalDamage
      || (effective?.additionalDamage?.length > 0 && effective.additionalDamage.every(row => this.#validateAdditionalDamageRow(row)));
    return Boolean(this.selectedWeaponUuid
      && (this.selectedType !== "weapon" || this.selectedBaseWeaponUuid)
      && this.itemName.trim() && additionalDamageValid);
  }

  #resetEnhancements() {
    this.enhancements = {};
    this.enhancementValues = enhancementDefaultsForType(this.selectedType);
    this.magicalAutoFromGrantedSpellcasting = false;
  }

  #resetGrantedEffects() {
    this.grantedEffects = {};
    this.grantedEffectValues = grantedEffectDefaults();
    this.resourceModifications = [];
    this.triggeredEffects = [];
  }

  #magicalEnhancementKey() {
    return this.selectedType === "equipment" ? "magicalItem"
      : this.selectedType === "tool" ? "magicalTool" : "magicalWeapon";
  }

  #hasGrantedSpells() {
    return Boolean(this.enhancements.grantedSpellcasting
      && (this.enhancementValues.grantedSpellcasting?.spells ?? []).length);
  }

  #syncGrantedSpellMagicalState() {
    const key = this.#magicalEnhancementKey();
    const defaults = enhancementDefaultsForType(this.selectedType);
    const hasSpells = this.#hasGrantedSpells();

    if (hasSpells) {
      if (!this.enhancements[key]) {
        this.enhancements[key] = true;
        this.enhancementValues[key] = mergeWithDefaults(defaults[key], this.enhancementValues[key]);
        this.magicalAutoFromGrantedSpellcasting = true;
      }
      return;
    }

    if (this.magicalAutoFromGrantedSpellcasting) {
      this.enhancements[key] = false;
      this.enhancementValues[key] = clone(defaults[key]);
      this.magicalAutoFromGrantedSpellcasting = false;
    }
  }

  #validateEnhancements() {
    const errors = {};
    const values = this.enhancementValues;
    if (this.selectedType === "equipment") {
      if (this.enhancements.magicalItem && !values.magicalItem?.rarity) errors.magicalItem = true;
      if (this.enhancements.armorEnhancement && ![1, 2, 3].includes(Number(values.armorEnhancement?.bonus))) errors.armorEnhancement = true;
      if (this.enhancements.baseArmorClass && !(Number(values.baseArmorClass?.value) >= 0)) errors.baseArmorClass = true;
    } else if (this.selectedType === "tool") {
      if (this.enhancements.magicalTool && !values.magicalTool?.rarity) errors.magicalTool = true;
    } else {
      if (this.enhancements.magicalWeapon && !values.magicalWeapon.rarity) errors.magicalWeapon = true;
      if (this.enhancements.weaponEnhancement && ![1, 2, 3].includes(Number(values.weaponEnhancement.bonus))) errors.weaponEnhancement = true;
      if (this.enhancements.attackBonus && !Number.isFinite(Number(values.attackBonus.bonus))) errors.attackBonus = true;
      if (this.enhancements.damageBonus && !Number.isFinite(Number(values.damageBonus.bonus))) errors.damageBonus = true;
      if (this.enhancements.criticalThreshold) {
        const mode = values.criticalThreshold.mode;
        const threshold = mode === "custom" ? Number(values.criticalThreshold.custom) : Number(mode);
        if (!Number.isFinite(threshold) || threshold < 1 || threshold > 20) errors.criticalThreshold = true;
      }
      if (this.enhancements.extraCriticalDamage) {
        const critical = values.extraCriticalDamage;
        if (!(Number(critical.number) > 0 && Number(critical.denomination) > 0 && critical.damageType)) errors.extraCriticalDamage = true;
      }
    }
    if (this.enhancements.ignoreResistance && !values.ignoreResistance?.damageTypes?.length) errors.ignoreResistance = true;
    if (this.enhancements.conditionalAdvantage) {
      const conditional = values.conditionalAdvantage;
      if (conditional.mode === "supported" && !conditional.supportedCondition) errors.conditionalAdvantage = true;
      if (conditional.mode === "custom" && !String(conditional.customText ?? "").trim()) errors.conditionalAdvantage = true;
    }
    for (const [key, enabled] of Object.entries(this.enhancements)) {
      if (!enabled || key === "grantedSpellcasting") continue;
      const setting = values[key];
      const tierable = REPEATABLE_ENHANCEMENTS.has(key);
      const tierValidator = tierable ? tier => [1, 2, 3].includes(Number(tier.bonus)) : null;
      if (!this.#validateProgressionSetting(setting, { tierable, tierValidator })) errors[key] = true;
    }
    return { valid: !Object.keys(errors).length, errors };
  }

  #validateSpellsResources() {
    const errors = {};
    if (this.enhancements.grantedSpellcasting) {
      const spells = this.enhancementValues.grantedSpellcasting?.spells ?? [];
      if (!spells.length || spells.some(spell => !this.#validateGrantedSpell(spell))) errors.grantedSpellcasting = true;
    }
    if (this.resourceModifications.some(row => !validateResourceModification(row))) errors.resourceModifications = true;
    return { valid: !Object.keys(errors).length, errors };
  }

  #validateGrantedEffects() {
    const errors = {};
    if (this.triggeredEffects.some(row => !validateTriggeredEffect(row))) errors.triggeredEffects = true;
    const values = this.grantedEffectValues;
    const finite = value => Number.isFinite(Number(value));
    const hasRows = (key, validator) => {
      const rows = values[key]?.entries ?? [];
      return rows.length > 0 && rows.every(validator);
    };
    const validAvailability = key => ["owned", "equipped", "equippedAttuned"].includes(values[key]?.availability);

    if (this.grantedEffects.armorClassBonus && !(finite(values.armorClassBonus.bonus) && validAvailability("armorClassBonus"))) errors.armorClassBonus = true;
    if (this.grantedEffects.weaponAttackBonus && !(finite(values.weaponAttackBonus.bonus) && validAvailability("weaponAttackBonus"))) errors.weaponAttackBonus = true;
    if (this.grantedEffects.weaponDamageBonus && !(finite(values.weaponDamageBonus.bonus) && validAvailability("weaponDamageBonus"))) errors.weaponDamageBonus = true;
    if (this.grantedEffects.criticalThreshold && !([18, 19, 20].includes(Number(values.criticalThreshold?.threshold))
      && ["weapon", "spell", "all"].includes(values.criticalThreshold?.scope)
      && validAvailability("criticalThreshold"))) errors.criticalThreshold = true;
    if (this.grantedEffects.savingThrowBonus && !(hasRows("savingThrowBonus", row => {
      const mode = row.mode === "proficiency" ? "proficiency" : "fixed";
      return Boolean(row.target) && (mode === "proficiency" || finite(row.bonus));
    }) && validAvailability("savingThrowBonus"))) errors.savingThrowBonus = true;
    if (this.grantedEffects.savingThrowAdvantage && !(hasRows("savingThrowAdvantage", row => Boolean(row.target)) && validAvailability("savingThrowAdvantage"))) errors.savingThrowAdvantage = true;
    if (this.grantedEffects.abilityScoreAdjustment && !(hasRows("abilityScoreAdjustment", row => Boolean(row.ability) && ["add", "minimum", "fixed"].includes(row.operation) && finite(row.value)) && validAvailability("abilityScoreAdjustment"))) errors.abilityScoreAdjustment = true;
    if (this.grantedEffects.abilityCheckBonus && !(hasRows("abilityCheckBonus", row => Boolean(row.target) && finite(row.bonus)) && validAvailability("abilityCheckBonus"))) errors.abilityCheckBonus = true;
    if (this.grantedEffects.skillBonus && !(hasRows("skillBonus", row => Boolean(row.target) && finite(row.bonus)) && validAvailability("skillBonus"))) errors.skillBonus = true;
    if (this.grantedEffects.skillProficiency && !(hasRows("skillProficiency", row => Boolean(row.skill) && ["proficient", "expertise"].includes(row.level)) && validAvailability("skillProficiency"))) errors.skillProficiency = true;
    if (this.grantedEffects.abilityCheckAdvantage && !(hasRows("abilityCheckAdvantage", row => Boolean(row.target)) && validAvailability("abilityCheckAdvantage"))) errors.abilityCheckAdvantage = true;
    for (const key of ["damageResistance", "damageImmunity", "damageVulnerability"]) {
      if (this.grantedEffects[key] && (!values[key].damageTypes?.length || !validAvailability(key))) errors[key] = true;
    }
    if (this.grantedEffects.conditionImmunity && (!values.conditionImmunity.conditions?.length || !validAvailability("conditionImmunity"))) errors.conditionImmunity = true;
    if (this.grantedEffects.initiativeBonus && !(finite(values.initiativeBonus.bonus) && validAvailability("initiativeBonus"))) errors.initiativeBonus = true;
    if (this.grantedEffects.initiativeAdvantage && !validAvailability("initiativeAdvantage")) errors.initiativeAdvantage = true;
    if (this.grantedEffects.proficiencyBonusModifier && !(finite(values.proficiencyBonusModifier.bonus) && validAvailability("proficiencyBonusModifier"))) errors.proficiencyBonusModifier = true;
    if (this.grantedEffects.maximumHitPointsBonus && !(finite(values.maximumHitPointsBonus.bonus) && validAvailability("maximumHitPointsBonus"))) errors.maximumHitPointsBonus = true;
    if (this.grantedEffects.movementBonus && !(hasRows("movementBonus", row => Boolean(row.type) && finite(row.bonus) && Boolean(row.units)) && validAvailability("movementBonus"))) errors.movementBonus = true;
    if (this.grantedEffects.grantMovementType && !(hasRows("grantMovementType", row => Boolean(row.type) && finite(row.speed) && Number(row.speed) >= 0 && Boolean(row.units)) && validAvailability("grantMovementType"))) errors.grantMovementType = true;
    if (this.grantedEffects.grantedSense && !(hasRows("grantedSense", row => Boolean(row.sense) && finite(row.range) && Number(row.range) >= 0 && Boolean(row.units) && ["minimum", "add", "fixed"].includes(row.operation)) && validAvailability("grantedSense"))) errors.grantedSense = true;
    if (this.grantedEffects.spellAttackBonus && !(finite(values.spellAttackBonus.bonus) && validAvailability("spellAttackBonus"))) errors.spellAttackBonus = true;
    if (this.grantedEffects.spellSaveDcBonus && !(finite(values.spellSaveDcBonus.bonus) && validAvailability("spellSaveDcBonus"))) errors.spellSaveDcBonus = true;
    if (this.grantedEffects.passiveScoreBonus && !(hasRows("passiveScoreBonus", row => ["perception", "investigation", "insight"].includes(row.score) && finite(row.bonus)) && validAvailability("passiveScoreBonus"))) errors.passiveScoreBonus = true;
    for (const [key, enabled] of Object.entries(this.grantedEffects)) {
      if (!enabled) continue;
      const setting = values[key];
      const tierable = REPEATABLE_GRANTED_EFFECTS.has(key);
      const tierValidator = tierable ? tier => finite(tier.bonus) && ["owned", "equipped", "equippedAttuned"].includes(tier.availability) : null;
      if (!this.#validateProgressionSetting(setting, { tierable, tierValidator })) errors[key] = true;
    }
    return { valid: !Object.keys(errors).length, errors };
  }

  #newGrantedEffectRow(key) {
    const firstAbility = Object.keys(CONFIG.DND5E.abilities ?? {})[0] ?? "str";
    const firstSkill = Object.keys(CONFIG.DND5E.skills ?? {})[0] ?? "prc";
    const firstMovement = Object.keys(CONFIG.DND5E.movementTypes ?? {})[0] ?? "walk";
    const firstSense = Object.keys(CONFIG.DND5E.senses ?? CONFIG.DND5E.senseTypes ?? {})[0] ?? "darkvision";
    switch (key) {
      case "savingThrowBonus": return effectRow({ target: "all", mode: "fixed", bonus: 1 });
      case "savingThrowAdvantage": return effectRow({ target: "all" });
      case "abilityScoreAdjustment": return effectRow({ ability: firstAbility, operation: "add", value: 1 });
      case "abilityCheckBonus": return effectRow({ target: "all", bonus: 1 });
      case "skillBonus": return effectRow({ target: firstSkill, bonus: 1 });
      case "skillProficiency": return effectRow({ skill: firstSkill, level: "proficient" });
      case "abilityCheckAdvantage": return effectRow({ target: "all" });
      case "movementBonus": return effectRow({ type: firstMovement, bonus: 10, units: "ft" });
      case "grantMovementType": return effectRow({ type: "fly", speed: 30, units: "ft", hover: false });
      case "grantedSense": return effectRow({ sense: firstSense, range: 60, units: "ft", operation: "minimum" });
      case "passiveScoreBonus": return effectRow({ score: "perception", bonus: 5 });
      default: return null;
    }
  }

  #toggleGrantedEffect(event) {
    const key = event.currentTarget.dataset.effectToggle;
    const defaults = grantedEffectDefaults();
    if (!key || !(key in defaults)) return;
    const enabled = event.currentTarget.checked;
    this.grantedEffects[key] = enabled;
    if (!enabled) this.grantedEffectValues[key] = clone(defaults[key]);
    else ensureProgressionGroup(this.grantedEffectValues[key]);
    this.#renderPreservingScroll();
  }

  #updateGrantedEffect(event) {
    const key = event.currentTarget.dataset.effectInput;
    const part = event.currentTarget.dataset.effectPart;
    const rowId = event.currentTarget.dataset.effectRowId;
    if (!key || !part || !this.grantedEffects[key]) return;
    let value;
    if (event.currentTarget.type === "checkbox") value = event.currentTarget.checked;
    else if (event.currentTarget.dataset.valueType === "number") value = event.currentTarget.value === "" ? 0 : Number(event.currentTarget.value);
    else value = event.currentTarget.value;

    if (rowId) {
      const row = (this.grantedEffectValues[key]?.entries ?? []).find(entry => entry.id === rowId);
      if (!row) return;
      row[part] = value;
      if (key === "savingThrowBonus" && part === "mode") {
        row.mode = value === "proficiency" ? "proficiency" : "fixed";
        this.#renderPreservingScroll();
      }
    } else {
      this.grantedEffectValues[key] ??= {};
      this.grantedEffectValues[key][part] = value;
    }
  }

  #updateGrantedEffectMulti(event) {
    const key = event.currentTarget.dataset.effectMulti;
    const collection = event.currentTarget.dataset.effectCollection;
    const value = event.currentTarget.dataset.effectValue;
    if (!key || !collection || !value || !this.grantedEffects[key]) return;
    const selected = new Set(this.grantedEffectValues[key]?.[collection] ?? []);
    if (event.currentTarget.checked) selected.add(value);
    else selected.delete(value);
    this.grantedEffectValues[key][collection] = [...selected];
    this.#renderPreservingScroll();
  }

  #addGrantedEffectRow(event) {
    event.preventDefault();
    const key = event.currentTarget.dataset.effectKey;
    if (!key || !this.grantedEffects[key]) return;
    const row = this.#newGrantedEffectRow(key);
    if (!row) return;
    this.grantedEffectValues[key].entries ??= [];
    this.grantedEffectValues[key].entries.push(row);
    this.#renderPreservingScroll();
  }

  #removeGrantedEffectRow(event) {
    event.preventDefault();
    const key = event.currentTarget.dataset.effectKey;
    const rowId = event.currentTarget.dataset.effectRowId;
    if (!key || !rowId || !this.grantedEffects[key]) return;
    const rows = this.grantedEffectValues[key].entries ?? [];
    this.grantedEffectValues[key].entries = rows.filter(row => row.id !== rowId);
    if (!this.grantedEffectValues[key].entries.length) {
      const replacement = this.#newGrantedEffectRow(key);
      if (replacement) this.grantedEffectValues[key].entries.push(replacement);
    }
    this.#renderPreservingScroll();
  }

  #updateImportedEffect(event) {
    const entry = this.customImportedEffects.find(row => row.id === event.currentTarget.dataset.importedId);
    const part = event.currentTarget.dataset.importedEffectInput;
    if (!entry || !part) return;
    entry[part] = event.currentTarget.type === "checkbox" ? event.currentTarget.checked : event.currentTarget.value;
    this.#renderPreservingScroll();
  }

  #updateImportedActivity(event) {
    const entry = this.customImportedActivities.find(row => row.id === event.currentTarget.dataset.importedId);
    const part = event.currentTarget.dataset.importedActivityInput;
    if (!entry || !part) return;
    entry[part] = event.currentTarget.type === "checkbox" ? event.currentTarget.checked : event.currentTarget.value;
    this.#renderPreservingScroll();
  }

  #removeImportedEffect(event) {
    event.preventDefault();
    const id = event.currentTarget.dataset.importedId;
    this.customImportedEffects = this.customImportedEffects.filter(entry => entry.id !== id);
    this.#renderPreservingScroll();
  }

  #removeImportedActivity(event) {
    event.preventDefault();
    const id = event.currentTarget.dataset.importedId;
    this.customImportedActivities = this.customImportedActivities.filter(entry => entry.id !== id);
    this.#renderPreservingScroll();
  }

  #validateGrantedSpell(spell) {
    if (!spell?.uuid || !spell?.name) return false;
    const level = Number(spell.level ?? 0);
    if (!Number.isInteger(level) || level < 0 || level > 9) return false;
    if (!['unlimited', 'limited'].includes(spell.useLimit)) return false;
    if (spell.useLimit === 'limited') {
      if (!(Number(spell.maxUses) > 0)) return false;
      if (!['shortRest', 'longRest'].includes(spell.recovery)) return false;
    }
    if (level === 0 && spell.consumeSlot) return false;
    if (!['independent', 'spellLevelAccess', 'compatibleSlot'].includes(spell.eligibility)) return false;
    if (spell.consumeSlot && spell.eligibility !== 'compatibleSlot') return false;
    if (!['base', 'fixed', 'slot'].includes(spell.castLevelMode)) return false;
    if (spell.castLevelMode === 'slot' && (!spell.consumeSlot || level === 0)) return false;
    if (spell.castLevelMode === 'fixed') {
      const fixed = Number(spell.fixedCastLevel);
      if (!Number.isInteger(fixed) || fixed < level || fixed > 9 || level === 0) return false;
    }
    if (!['actorDefault', 'highest', 'int', 'wis', 'cha', 'fixed'].includes(spell.spellcastingMode)) return false;
    if (spell.spellcastingMode === 'fixed') {
      if (spell.hasAttack && !Number.isFinite(Number(spell.fixedAttackBonus))) return false;
      const save = Number(spell.fixedSaveDc);
      if (spell.hasSave && (!Number.isFinite(save) || save < 1 || save > 40)) return false;
    }
    if (!['owned', 'equipped', 'equippedAttuned'].includes(spell.availability)) return false;
    if (!this.#validateProgressionSetting(spell, { tierable: false })) return false;
    return true;
  }

  #newGrantedSpell(document) {
    const spell = spellSourceData(document);
    const source = ItemCreatorSourceRegistry.instance.describeDocument(document);
    return {
      id: foundry.utils.randomID(),
      uuid: document.uuid,
      name: document.name,
      img: document.img || 'icons/svg/book.svg',
      source: `${source.sourceLabel} — ${source.packLabel}`,
      level: spell.level,
      school: spell.school,
      hasAttack: spell.hasAttack,
      hasSave: spell.hasSave,
      useLimit: 'unlimited',
      maxUses: 1,
      recovery: 'longRest',
      consumeSlot: false,
      eligibility: 'independent',
      castLevelMode: 'base',
      fixedCastLevel: spell.level,
      spellcastingMode: 'actorDefault',
      fixedAttackBonus: 5,
      fixedSaveDc: 13,
      showInSpellbook: false,
      availability: 'equipped',
      unlockOnLevel: false,
      unlockLevel: 1,
      progressionGroupId: foundry.utils.randomID()
    };
  }

  async #openSpellBrowser(event) {
    event.preventDefault();
    if (!this.enhancements.grantedSpellcasting || this.spellBrowserOpen) return;
    const CompendiumBrowser = nativeCompendiumBrowserClass();
    if (!CompendiumBrowser?.selectOne) {
      ui.notifications.error('The native D&D5e Compendium Browser is unavailable.');
      return;
    }
    this.spellBrowserOpen = true;
    this.#setBrowserBlock(true);
    try {
      const uuid = await CompendiumBrowser.selectOne({
        mode: CompendiumBrowser.MODES?.ADVANCED ?? 2,
        tab: 'spells',
        hint: 'Select a Spell to grant through this item.',
        filters: { locked: { documentClass: 'Item', types: new Set(['spell']) } },
        window: { modal: true }
      });
      if (uuid) await this.#addGrantedSpellUuid(uuid);
    } catch (error) {
      console.error(`${MODULE_ID} | Native Spell Browser failed.`, error);
      ui.notifications.error('Item Creator could not open the D&D5e Spell Browser.');
    } finally {
      this.spellBrowserOpen = false;
      this.#setBrowserBlock(false);
    }
  }

  async #addGrantedSpellUuid(uuid) {
    let document;
    try { document = await fromUuid(uuid); }
    catch (error) { console.warn(`${MODULE_ID} | Unable to load spell ${uuid}.`, error); }
    if (!isSpellItemDocument(document)) {
      ui.notifications.warn('Only Spell Items can be added to Granted Spellcasting.');
      return false;
    }
    const spells = this.enhancementValues.grantedSpellcasting.spells ??= [];
    if (spells.some(spell => spell.uuid === document.uuid)) {
      ui.notifications.warn(`${document.name} is already granted by this item.`);
      return false;
    }
    spells.push(this.#newGrantedSpell(document));
    this.#syncGrantedSpellMagicalState();
    this.#renderPreservingScroll();
    return true;
  }

  #spellDragOver(event) {
    if (!this.enhancements.grantedSpellcasting) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    event.currentTarget.classList.add('drag-over');
  }

  #spellDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
  }

  async #spellDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    if (!this.enhancements.grantedSpellcasting) return;
    try {
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      if (data?.type !== 'Item') {
        ui.notifications.warn('Drop a Spell Item into this field.');
        return;
      }
      const item = await Item.implementation.fromDropData(data);
      if (!isSpellItemDocument(item)) {
        ui.notifications.warn('Only Spell Items can be added to Granted Spellcasting.');
        return;
      }
      await this.#addGrantedSpellUuid(item.uuid);
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to process dropped Spell.`, error);
      ui.notifications.error('Item Creator could not read the dropped Spell.');
    }
  }

  #removeGrantedSpell(event) {
    event.preventDefault();
    if (!this.enhancements.grantedSpellcasting) return;
    const id = event.currentTarget.dataset.spellId;
    this.enhancementValues.grantedSpellcasting.spells = (this.enhancementValues.grantedSpellcasting.spells ?? [])
      .filter(spell => spell.id !== id);
    this.#syncGrantedSpellMagicalState();
    this.#renderPreservingScroll();
  }

  #updateGrantedSpell(event) {
    if (!this.enhancements.grantedSpellcasting) return;
    const id = event.currentTarget.dataset.spellId;
    const part = event.currentTarget.dataset.grantedSpellInput;
    const spell = (this.enhancementValues.grantedSpellcasting.spells ?? []).find(entry => entry.id === id);
    if (!spell || !part) return;
    let value;
    if (event.currentTarget.type === 'checkbox') value = event.currentTarget.checked;
    else if (event.currentTarget.dataset.valueType === 'number') value = event.currentTarget.value === '' ? 0 : Number(event.currentTarget.value);
    else value = event.currentTarget.value;
    spell[part] = value;

    if (part === 'useLimit' && value === 'unlimited') {
      spell.maxUses = 1;
      spell.recovery = 'longRest';
    }
    if (part === 'consumeSlot') {
      if (spell.level === 0) spell.consumeSlot = false;
      else if (value) {
        spell.eligibility = 'compatibleSlot';
        spell.castLevelMode = 'slot';
      } else {
        if (spell.eligibility === 'compatibleSlot') spell.eligibility = 'independent';
        if (spell.castLevelMode === 'slot') spell.castLevelMode = 'base';
      }
    }
    if (part === 'castLevelMode' && value === 'fixed') spell.fixedCastLevel = Math.max(Number(spell.fixedCastLevel) || spell.level, spell.level);
    this.#renderPreservingScroll();
  }

  #addResourceModification(event) {
    event.preventDefault();
    this.resourceModifications.push(defaultResourceModification("feature"));
    this.#renderPreservingScroll();
  }

  #removeResourceModification(event) {
    event.preventDefault();
    const id = event.currentTarget.dataset.resourceId;
    this.resourceModifications = this.resourceModifications.filter(row => row.id !== id);
    this.#renderPreservingScroll();
  }

  #updateResourceModification(event) {
    const id = event.currentTarget.dataset.resourceId;
    const part = event.currentTarget.dataset.resourceInput;
    const row = this.resourceModifications.find(entry => entry.id === id);
    if (!row || !part) return;
    let value;
    if (event.currentTarget.type === "checkbox") value = event.currentTarget.checked;
    else if (event.currentTarget.dataset.valueType === "number") value = event.currentTarget.value === "" ? 0 : Number(event.currentTarget.value);
    else value = event.currentTarget.value;
    row[part] = value;

    if (part === "category") {
      const replacement = defaultResourceModification(value);
      Object.assign(row, replacement, { id });
    }
    if (part === "resourceId") {
      const definition = getResourceDefinition(value);
      if (row.category === "resourceDie" && !definition?.supportsDieSize) {
        const fallback = resourceGroups({ dieOnly: true })[0]?.items?.[0];
        if (fallback) row.resourceId = fallback.id;
      }
    }
    Object.assign(row, normalizeResourceModification(row));
    this.#renderPreservingScroll();
  }

  #addTriggeredEffect(event) {
    event.preventDefault();
    this.triggeredEffects.push(defaultTriggeredEffect());
    this.#renderPreservingScroll();
  }

  #removeTriggeredEffect(event) {
    event.preventDefault();
    const id = event.currentTarget.dataset.triggerId;
    this.triggeredEffects = this.triggeredEffects.filter(entry => entry.id !== id);
    this.#renderPreservingScroll();
  }

  #updateTriggeredEffect(event, { commit = true, render = true } = {}) {
    const id = event.currentTarget.dataset.triggerId;
    const part = event.currentTarget.dataset.triggerInput;
    const scope = event.currentTarget.dataset.triggerScope || "root";
    const row = this.triggeredEffects.find(entry => entry.id === id);
    if (!row || !part) return;
    let value;
    if (event.currentTarget.type === "checkbox") value = event.currentTarget.checked;
    else if (event.currentTarget.dataset.valueType === "number") {
      value = event.currentTarget.value === "" ? (commit ? 0 : "")
        : (commit ? Number(event.currentTarget.value) : event.currentTarget.value);
    } else value = event.currentTarget.value;

    if (scope === "trigger") row.trigger[part] = value;
    else if (scope === "application") row.application[part] = value;
    else if (scope === "stacks") row.stacks[part] = value;
    else if (scope === "consumption") {
      row.consumption ??= {};
      row.consumption[part] = value;
    }
    else row[part] = value;

    if (!commit) return;

    if (scope === "trigger" && part === "category") {
      const events = TRIGGER_EVENTS[value] ?? TRIGGER_EVENTS.attack;
      row.trigger.event = events[0]?.[0] ?? "attackRolled";
      row.counting = value === "attack" ? "perAttackRoll" : value === "combat" ? "perTurn" : "perActivity";
    }
    if (scope === "trigger" && part === "event") {
      row.trigger.spellSelectionMode = value === "specificSpellCast" ? "specific" : "filters";
      if (["attackHit", "criticalHit", "natural20"].includes(value)) row.counting = "perSuccessfulAttack";
      else if (value === "attackRolled") row.counting = "perAttackRoll";
      else if (["spellCast", "spellAttackCast", "spellSaveCast", "specificSpellCast", "spellCastUsingSlot", "spellCastWithoutSlot"].includes(value)) row.counting = "perActivity";
    }
    if (scope === "application" && part === "mode" && value === "singleActivation") {
      row.application.expiration ||= "ownerTurnEndCurrent";
      row.application.retrigger ||= "refresh";
    }
    if (scope === "application" && part === "expiration") row.application.expirationExplicit = true;

    const singleAttackEligible = row.trigger.category === "attack"
      && ["attackHit", "criticalHit", "natural20"].includes(row.trigger.event);
    if (row.application.mode === "stacking" && row.stacks.behavior === "singleAttack" && !singleAttackEligible) {
      row.stacks.behavior = "refresh";
    }

    if (scope === "stacks" && part === "durationUnit") {
      row.stacks.durationUnitExplicit = true;
      row.stacks.tickTiming = TICK_TIMINGS[value]?.[1]?.[0] ?? TICK_TIMINGS[value]?.[0]?.[0] ?? "ownerTurnEnd";
    }
    if (scope === "stacks" && part === "behavior") {
      if (value === "refresh" || value === "singleAttack") row.stacks.maximum = 1;
      if (value === "singleAttack") {
        row.stacks.granted = 1;
        row.stacks.durationAmount = 1;
        row.stacks.durationUnit = "ownerTurns";
        row.stacks.tickTiming = "ownerTurnEnd";
      }
    }

    Object.assign(row, normalizeTriggeredEffect(row));
    if (render) this.#renderPreservingScroll();
  }

  #addTriggeredPayload(event) {
    event.preventDefault();
    const row = this.triggeredEffects.find(entry => entry.id === event.currentTarget.dataset.triggerId);
    if (!row) return;
    row.effects ??= [];
    row.effects.push(defaultTriggeredEffectPayload("spellAttackBonus"));
    this.#renderPreservingScroll();
  }

  #removeTriggeredPayload(event) {
    event.preventDefault();
    const row = this.triggeredEffects.find(entry => entry.id === event.currentTarget.dataset.triggerId);
    const payloadId = event.currentTarget.dataset.payloadId;
    if (!row || !payloadId) return;
    row.effects = (row.effects ?? []).filter(effect => effect.id !== payloadId);
    if (!row.effects.length) row.effects.push(defaultTriggeredEffectPayload("spellAttackBonus"));
    this.#renderPreservingScroll();
  }

  #updateTriggeredPayload(event, { commit = true, render = true } = {}) {
    const row = this.triggeredEffects.find(entry => entry.id === event.currentTarget.dataset.triggerId);
    const payload = row?.effects?.find(entry => entry.id === event.currentTarget.dataset.payloadId);
    const part = event.currentTarget.dataset.triggerPayloadInput;
    if (!row || !payload || !part) return;
    let value;
    if (event.currentTarget.type === "checkbox") value = event.currentTarget.checked;
    else if (event.currentTarget.dataset.valueType === "number") {
      value = event.currentTarget.value === "" ? (commit ? 0 : "")
        : (commit ? Number(event.currentTarget.value) : event.currentTarget.value);
    } else value = event.currentTarget.value;
    payload[part] = value;
    if (!commit) return;
    if (part === "type" && value === "selectedSpellEffects") payload.scaling = "fixed";
    Object.assign(payload, normalizeTriggeredEffectPayload(payload));
    if (part === "recipient") {
      const normalized = normalizeTriggeredEffect(row);
      Object.assign(row, normalized);
    }
    if (render) this.#renderPreservingScroll();
  }

  async #browseTriggeredEffectSpell(event) {
    event.preventDefault();
    if (this.triggerBrowserOpen) return;
    const row = this.triggeredEffects.find(entry => entry.id === event.currentTarget.dataset.triggerId);
    const payload = row?.effects?.find(entry => entry.id === event.currentTarget.dataset.payloadId);
    if (!row || !payload) return;
    const CompendiumBrowser = nativeCompendiumBrowserClass();
    if (!CompendiumBrowser?.selectOne) {
      ui.notifications.error("The native D&D5e Compendium Browser is unavailable.");
      return;
    }
    this.triggerBrowserOpen = true;
    this.#setBrowserBlock(true);
    try {
      const uuid = await CompendiumBrowser.selectOne({
        mode: CompendiumBrowser.MODES?.ADVANCED ?? 2,
        tab: "spells",
        hint: "Select a Spell whose transferable Active Effects will be applied by this Triggered Effect.",
        filters: { locked: { documentClass: "Item", types: new Set(["spell"]) } },
        window: { modal: true }
      });
      if (!uuid) return;
      const document = await fromUuid(uuid);
      if (!isSpellItemDocument(document)) {
        ui.notifications.warn("Select a Spell Item.");
        return;
      }
      const snapshots = extractSelectedSpellEffects(document);
      if (!snapshots.length) {
        ui.notifications.warn(`${document.name} has no transferable Active Effects. No Spell was assigned.`);
        return;
      }
      payload.type = "selectedSpellEffects";
      payload.scaling = "fixed";
      payload.spellUuid = document.uuid;
      payload.spellName = document.name;
      payload.spellImg = document.img ?? "";
      payload.spellEffects = snapshots;
      Object.assign(payload, normalizeTriggeredEffectPayload(payload));
      this.#renderPreservingScroll();
    } catch (error) {
      console.error(`${MODULE_ID} | Triggered Effect Spell browser failed.`, error);
      ui.notifications.error("Item Creator could not open the Spell effect browser.");
    } finally {
      this.triggerBrowserOpen = false;
      this.#setBrowserBlock(false);
    }
  }

  async #browseTriggeredSource(event, kind) {
    event.preventDefault();
    if (this.triggerBrowserOpen) return;
    const row = this.triggeredEffects.find(entry => entry.id === event.currentTarget.dataset.triggerId);
    if (!row) return;
    const CompendiumBrowser = nativeCompendiumBrowserClass();
    if (!CompendiumBrowser?.selectOne) {
      ui.notifications.error("The native D&D5e Compendium Browser is unavailable.");
      return;
    }
    this.triggerBrowserOpen = true;
    this.#setBrowserBlock(true);
    try {
      const spell = kind === "spell";
      const uuid = await CompendiumBrowser.selectOne({
        mode: CompendiumBrowser.MODES?.ADVANCED ?? 2,
        tab: spell ? "spells" : "items",
        hint: spell ? "Select the Spell that activates this Triggered Effect." : "Select the Feature that activates this Triggered Effect.",
        filters: { locked: { documentClass: "Item", types: new Set(spell ? ["spell"] : ["feat"]) } },
        window: { modal: true }
      });
      if (!uuid) return;
      const document = await fromUuid(uuid);
      if (document?.documentName !== "Item" || (spell ? document.type !== "spell" : document.type !== "feat")) {
        ui.notifications.warn(spell ? "Select a Spell Item." : "Select a Feature Item.");
        return;
      }
      if (spell) {
        row.trigger.spellSelectionMode = "specific";
        row.trigger.spellUuid = document.uuid;
        row.trigger.spellName = document.name;
      } else {
        row.trigger.featureUuid = document.uuid;
        row.trigger.featureName = document.name;
        row.trigger.featureIdentifier = document.system?.identifier ?? "";
      }
      Object.assign(row, normalizeTriggeredEffect(row));
      this.#renderPreservingScroll();
    } catch (error) {
      console.error(`${MODULE_ID} | Trigger source browser failed.`, error);
      ui.notifications.error("Item Creator could not open the trigger source browser.");
    } finally {
      this.triggerBrowserOpen = false;
      this.#setBrowserBlock(false);
    }
  }

  #toggleEnhancement(event) {
    const field = event.currentTarget.dataset.enhancementToggle;
    const defaults = enhancementDefaultsForType(this.selectedType);
    if (!field || !(field in defaults)) return;
    const enabled = event.currentTarget.checked;
    const magicalKey = this.#magicalEnhancementKey();

    if (field === magicalKey && !enabled && this.#hasGrantedSpells()) {
      event.currentTarget.checked = true;
      ui.notifications.warn("Granted Spellcasting automatically keeps this Item magical.");
      return;
    }

    this.enhancements[field] = enabled;
    if (!enabled) this.enhancementValues[field] = clone(defaults[field]);
    else if (field !== "grantedSpellcasting") ensureProgressionGroup(this.enhancementValues[field]);
    if (field === magicalKey) this.magicalAutoFromGrantedSpellcasting = false;
    if (field === "grantedSpellcasting") this.#syncGrantedSpellMagicalState();
    this.#renderPreservingScroll();
  }

  #updateEnhancement(event) {
    const field = event.currentTarget.dataset.enhancementInput;
    const part = event.currentTarget.dataset.enhancementPart;
    if (!field || !part || !this.enhancements[field]) return;
    let value = event.currentTarget.value;
    if (event.currentTarget.dataset.valueType === "number") value = value === "" ? 0 : Number(value);
    this.enhancementValues[field] ??= {};
    this.enhancementValues[field][part] = value;
    if (field === this.#magicalEnhancementKey() && this.magicalAutoFromGrantedSpellcasting) {
      // Editing rarity or attunement is an explicit GM decision to retain the
      // magical state even if all granted Spells are removed later.
      this.magicalAutoFromGrantedSpellcasting = false;
      this.#renderPreservingScroll();
      return;
    }
    if (field === "criticalThreshold" && part === "mode") this.#renderPreservingScroll();
    if (field === "conditionalAdvantage" && part === "mode") this.#renderPreservingScroll();
  }

  #updateResistanceType(event) {
    if (!this.enhancements.ignoreResistance) return;
    const damageType = event.currentTarget.dataset.resistanceType;
    const types = new Set(this.enhancementValues.ignoreResistance.damageTypes ?? []);
    if (event.currentTarget.checked) types.add(damageType);
    else types.delete(damageType);
    this.enhancementValues.ignoreResistance.damageTypes = [...types];
    this.#renderPreservingScroll();
  }

  async close(options = {}) {
    await this.iconBrowserApp?.close?.();
    this.templateBrowserOpen = false;
    this.spellBrowserOpen = false;
    this.triggerBrowserOpen = false;
    this.iconBrowserApp = null;
    this.#setBrowserBlock(false);
    return super.close(options);
  }
}
