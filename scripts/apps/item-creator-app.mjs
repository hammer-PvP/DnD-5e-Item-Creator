import { ITEM_TYPES, MODULE_ID, MODULE_STAGE, MODULE_VERSION, STEPS } from "../constants.mjs";
import { ItemCreatorSourceRegistry } from "../services/source-registry.mjs";
import { ItemCreatorIconBrowserApp } from "./icon-browser-app.mjs";
import { ItemCreatorItemBuilder } from "../services/item-builder.mjs";
import { ProtectedTransactionDialogService } from "../services/protected-transaction-dialog-service.mjs";

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
    additionalDamage: []
  };
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

function enhancementDefaults() {
  const firstDamageType = CONFIG.DND5E.damageTypes?.fire
    ? "fire"
    : Object.keys(CONFIG.DND5E.damageTypes ?? {})[0] ?? "";
  return {
    magicalWeapon: { rarity: "uncommon", attunement: "" },
    weaponEnhancement: { bonus: 1 },
    attackBonus: { bonus: 1 },
    damageBonus: { bonus: 1 },
    criticalThreshold: { mode: "19", custom: 19 },
    extraCriticalDamage: { number: 1, denomination: 8, damageType: firstDamageType },
    ignoreResistance: { damageTypes: firstDamageType ? [firstDamageType] : [] },
    grantedSpellcasting: { spells: [] },
    conditionalAdvantage: {
      mode: "supported",
      appliesTo: "attackRolls",
      supportedCondition: "targetUndead",
      customText: ""
    }
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
    armorClassBonus: { bonus: 1, availability: "equipped" },
    savingThrowBonus: { entries: [effectRow({ target: "all", bonus: 1 })], availability: "equipped" },
    savingThrowAdvantage: { entries: [effectRow({ target: "all" })], availability: "equipped" },
    abilityScoreAdjustment: { entries: [effectRow({ ability: firstAbility, operation: "add", value: 1 })], availability: "equipped" },
    abilityCheckBonus: { entries: [effectRow({ target: "all", bonus: 1 })], availability: "equipped" },
    skillBonus: { entries: [effectRow({ target: firstSkill, bonus: 1 })], availability: "equipped" },
    skillProficiency: { entries: [effectRow({ skill: firstSkill, level: "proficient" })], availability: "equipped" },
    abilityCheckAdvantage: { entries: [effectRow({ target: "all" })], availability: "equipped" },
    damageResistance: { damageTypes: firstDamageType ? [firstDamageType] : [], availability: "equipped" },
    damageImmunity: { damageTypes: firstDamageType ? [firstDamageType] : [], availability: "equipped" },
    damageVulnerability: { damageTypes: firstDamageType ? [firstDamageType] : [], availability: "equipped" },
    conditionImmunity: { conditions: [], availability: "equipped" },
    initiativeBonus: { bonus: 1, availability: "equipped" },
    initiativeAdvantage: { availability: "equipped" },
    proficiencyBonusModifier: { bonus: 1, availability: "equipped" },
    maximumHitPointsBonus: { bonus: 10, availability: "equipped" },
    movementBonus: { entries: [effectRow({ type: firstMovement, bonus: 10, units: "ft" })], availability: "equipped" },
    grantMovementType: { entries: [effectRow({ type: "fly", speed: 30, units: "ft", hover: false })], availability: "equipped" },
    grantedSense: { entries: [effectRow({ sense: firstSense, range: 60, units: "ft", operation: "minimum" })], availability: "equipped" },
    spellAttackBonus: { bonus: 1, availability: "equipped" },
    spellSaveDcBonus: { bonus: 1, availability: "equipped" },
    passiveScoreBonus: { entries: [effectRow({ score: "perception", bonus: 5 })], availability: "equipped" }
  };
}

function effectEntryOptions(key, row) {
  switch (key) {
    case "savingThrowBonus":
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
  constructor(options = {}) {
    super(options);
    this.step = "itemType";
    this.selectedType = null;
    this.selectedWeaponUuid = null;
    this.selectedWeaponDocument = null;
    this.inheritedBaseWeaponUuid = null;
    this.selectedBaseWeaponUuid = null;
    this.selectedBaseWeaponDocument = null;
    this.baseWeaponRequired = false;
    this.itemName = "";
    this.selectedIcon = "";
    this.templateCategory = "all";
    this.loadingWeapon = false;
    this.customized = {};
    this.overrides = {};
    this.enhancements = {};
    this.enhancementValues = enhancementDefaults();
    this.grantedEffects = {};
    this.grantedEffectValues = grantedEffectDefaults();
    this.templateDescription = "";
    this.templateDescriptionRaw = "";
    this.customDescription = "";
    this.descriptionCustomized = false;
    this.reviewBuildError = "";
    this.savingItem = false;
    this.restoreScrollTop = null;
    this.templateBrowserOpen = false;
    this.spellBrowserOpen = false;
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

  async _prepareContext() {
    const registry = ItemCreatorSourceRegistry.instance;
    await registry.loadWeapons();

    if (this.selectedWeaponUuid && !this.selectedWeaponDocument) {
      try {
        const document = await fromUuid(this.selectedWeaponUuid);
        if (isWeaponItemDocument(document)) this.selectedWeaponDocument = document;
        else this.#clearTemplate();
      } catch (_error) {
        this.#clearTemplate();
      }
    }
    if (this.selectedBaseWeaponUuid && !this.selectedBaseWeaponDocument) {
      try {
        const document = await fromUuid(this.selectedBaseWeaponUuid);
        if (isWeaponItemDocument(document)) this.selectedBaseWeaponDocument = document;
        else this.#clearBaseWeapon();
      } catch (_error) {
        this.#clearBaseWeapon();
      }
    }
    if (this.selectedWeaponDocument && !this.templateDescriptionRaw) {
      this.templateDescriptionRaw = rawTemplateDescription(this.selectedWeaponDocument);
      this.templateDescription = cleanTemplateDescription(this.selectedWeaponDocument);
      if (!this.descriptionCustomized) this.customDescription = this.templateDescriptionRaw;
    }

    const typeComplete = Boolean(this.selectedType);
    const source = weaponSourceData(this.selectedBaseWeaponDocument);
    const effective = source ? this.#effectiveValues(source) : null;
    const additionalDamageValid = !this.customized.additionalDamage
      || (effective?.additionalDamage?.length > 0 && effective.additionalDamage.every(row =>
        Number(row.number) > 0 && Number(row.denomination) > 0 && Boolean(row.damageType)
        && (!row.useAbilityModifier || Boolean(row.ability))));
    const baseComplete = Boolean(this.selectedWeaponUuid && this.selectedBaseWeaponUuid && this.itemName.trim() && additionalDamageValid);
    const enhancementValidation = this.#validateEnhancements();
    const enhancementsComplete = baseComplete && enhancementValidation.valid;
    const grantedEffectValidation = this.#validateGrantedEffects();
    const grantedEffectsComplete = enhancementsComplete && grantedEffectValidation.valid;
    const descriptionComplete = grantedEffectsComplete;

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
      complete: step.id === "itemType"
        ? typeComplete
        : step.id === "baseItem"
          ? baseComplete
          : step.id === "enhancements"
            ? enhancementsComplete
            : step.id === "grantedEffects"
              ? grantedEffectsComplete
              : step.id === "description"
                ? descriptionComplete
                : step.id === "review"
                  ? reviewComplete
                  : false,
      locked: !step.available
        || (step.id === "baseItem" && !typeComplete)
        || (step.id === "enhancements" && !baseComplete)
        || (step.id === "grantedEffects" && !enhancementsComplete)
        || (step.id === "description" && !grantedEffectsComplete)
        || (step.id === "review" && !descriptionComplete)
    }));

    const selectedOption = this.selectedWeaponUuid ? registry.findWeapon(this.selectedWeaponUuid) : null;
    const selectedSource = this.selectedWeaponDocument
      ? (selectedOption ?? registry.describeDocument(this.selectedWeaponDocument))
      : null;
    const selectedBaseOption = this.selectedBaseWeaponUuid ? registry.findWeapon(this.selectedBaseWeaponUuid) : null;
    const selectedBaseSource = this.selectedBaseWeaponDocument
      ? (selectedBaseOption ?? registry.describeDocument(this.selectedBaseWeaponDocument))
      : null;
    const templateCounts = new Map();
    for (const option of registry.templateOptions) {
      templateCounts.set(option.weaponType, (templateCounts.get(option.weaponType) ?? 0) + 1);
    }

    const templateCategoryOptions = [{
      value: "all",
      label: "All Weapon Types",
      selected: this.templateCategory === "all"
    }, ...Object.entries(CONFIG.DND5E.weaponTypes ?? {})
      .filter(([value]) => templateCounts.has(value))
      .map(([value, label]) => ({
        value,
        label: `${game.i18n.localize(label)} (${templateCounts.get(value)})`,
        selected: this.templateCategory === value
      }))];

    const templateOptionGroups = registry.templateSourceGroups.map(group => ({
      label: group.label,
      items: group.items.map(option => ({
        ...option,
        selected: option.uuid === this.selectedWeaponUuid,
        optionLabel: option.packLabel === group.label ? option.name : `${option.name} — ${option.packLabel}`
      }))
    }));
    if (this.selectedWeaponDocument && !registry.findTemplate(this.selectedWeaponUuid)) {
      templateOptionGroups.unshift({
        label: selectedSource?.sourceLabel ?? "Selected Source",
        items: [{
          uuid: this.selectedWeaponUuid,
          name: this.selectedWeaponDocument.name,
          weaponType: this.selectedWeaponDocument.system?.type?.value ?? "",
          selected: true,
          optionLabel: this.selectedWeaponDocument.name
        }]
      });
    }

    const baseWeaponOptionGroups = registry.weaponSourceGroups.map(group => ({
      label: group.label,
      items: group.packs.flatMap(pack => pack.items).sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang)).map(option => ({
        ...option,
        selected: option.uuid === this.selectedBaseWeaponUuid,
        optionLabel: option.name
      }))
    }));
    const manualTemplateCount = templateOptionGroups.reduce((count, group) => count + group.items.length, 0);
    const selectedBaseWeapon = this.selectedBaseWeaponDocument ? {
      uuid: this.selectedBaseWeaponUuid,
      name: this.selectedBaseWeaponDocument.name,
      identifier: this.selectedBaseWeaponDocument.system?.identifier ?? "—",
      source: selectedBaseSource ? `${selectedBaseSource.sourceLabel} — ${selectedBaseSource.packLabel}` : "Compendium Item"
    } : null;

    const propertyKeys = CONFIG.DND5E.validProperties?.weapon ?? new Set();
    const propertyOptions = [...propertyKeys]
      .filter(key => key !== "mgc")
      .map(value => ({
        value,
        label: localizedLabel(CONFIG.DND5E.itemProperties?.[value], value),
        selected: effective?.properties?.includes(value) ?? false
      }))
      .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));

    const damageTypeLabel = effective?.damageType
      ? localizedLabel(CONFIG.DND5E.damageTypes?.[effective.damageType], effective.damageType)
      : "";

    const selectedWeapon = this.selectedWeaponDocument ? {
      name: this.selectedWeaponDocument.name,
      img: this.selectedIcon || this.selectedWeaponDocument.img || "icons/svg/sword.svg",
      sourceImg: this.selectedWeaponDocument.img || "icons/svg/sword.svg",
      source: selectedSource ? `${selectedSource.sourceLabel} — ${selectedSource.packLabel}` : "Compendium Item",
      sourceLabel: selectedSource?.sourceLabel ?? "Compendium",
      packLabel: selectedSource?.packLabel ?? "Items",
      identifier: this.selectedWeaponDocument.system?.identifier ?? "—",
      damageSummary: displayDamage(effective?.baseDamage, damageTypeLabel)
    } : null;

    const customization = field => Boolean(this.customized[field]);
    const customFieldCount = Object.entries(this.customized).filter(([field, enabled]) =>
      enabled && !(field === "baseWeapon" && this.baseWeaponRequired && !this.selectedBaseWeaponUuid)).length;
    const additionalDamageRows = (effective?.additionalDamage ?? []).map((row, index) => ({
      ...row,
      index: index + 1,
      dieOptions: damageDiceOptions(row.denomination),
      damageTypeOptions: configOptions(CONFIG.DND5E.damageTypes, row.damageType),
      abilityModifierOptions: abilityModifierOptions(row.ability),
      summary: additionalDamageLabel(row)
    }));

    const grantedSpellRows = (this.enhancementValues.grantedSpellcasting.spells ?? []).map((row, index) => {
      const level = Number(row.level ?? 0);
      const isCantrip = level === 0;
      const isLimited = row.useLimit === "limited";
      const usesFixedSpellcasting = row.spellcastingMode === "fixed";
      const castLevelOptions = Object.entries(CONFIG.DND5E.spellLevels ?? {})
        .filter(([value]) => Number(value) >= level && Number(value) <= 9)
        .map(([value, label]) => ({
          value: Number(value),
          label: game.i18n.localize(label),
          selected: Number(row.fixedCastLevel) === Number(value)
        }));
      return {
        ...row,
        index: index + 1,
        isCantrip,
        isLimited,
        usesFixedSpellcasting,
        spellLevelLabel: spellLevelLabel(level),
        schoolLabel: localizedLabel(CONFIG.DND5E.spellSchools?.[row.school], row.school || "Spell"),
        useLimitOptions: fixedOptions([["unlimited", "Unlimited / At Will"], ["limited", "Limited Uses"]], row.useLimit),
        recoveryOptions: fixedOptions([["shortRest", "Short Rest"], ["longRest", "Long Rest"]], row.recovery),
        eligibilityOptions: fixedOptions([
          ["independent", "Item Grants Independent Casting"],
          ["spellLevelAccess", "Require Spell-Level Access"],
          ["compatibleSlot", "Require Compatible Spell Slot"]
        ], row.eligibility),
        castLevelModeOptions: fixedOptions([
          ["base", "Base Spell Level"],
          ...(!isCantrip ? [["fixed", "Fixed Higher Level"]] : []),
          ...(!isCantrip && row.consumeSlot ? [["slot", "Use Selected Spell Slot Level"]] : [])
        ], row.castLevelMode),
        fixedCastLevelOptions: castLevelOptions,
        spellcastingModeOptions: fixedOptions([
          ["actorDefault", "Actor Default Spellcasting"],
          ["highest", "Highest Spellcasting"],
          ["int", "Intelligence + Proficiency"],
          ["wis", "Wisdom + Proficiency"],
          ["cha", "Charisma + Proficiency"],
          ["fixed", "Fixed Item Spellcasting Values"]
        ], row.spellcastingMode),
        availabilityOptions: fixedOptions([
          ["owned", "Item is Owned"],
          ["equipped", "Equipped"],
          ["equippedAttuned", "Equipped and Attuned"]
        ], row.availability),
        invalid: !this.#validateGrantedSpell(row)
      };
    });

    const effectValues = this.grantedEffectValues;
    const prepareEffectRows = key => (effectValues[key]?.entries ?? []).map((row, index) => ({
      ...row,
      index: index + 1,
      ...effectEntryOptions(key, row)
    }));
    const damageEffectOptions = key => Object.entries(CONFIG.DND5E.damageTypes ?? {}).map(([value, entry]) => ({
      value,
      label: localizedLabel(entry, value),
      selected: (effectValues[key]?.damageTypes ?? []).includes(value)
    })).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
    const effectAvailability = Object.fromEntries(Object.keys(effectValues).map(key => [key, effectAvailabilityOptions(effectValues[key]?.availability)]));
    const grantedEffectCount = Object.values(this.grantedEffects).filter(Boolean).length;
    const descriptionValue = this.descriptionCustomized ? this.customDescription : this.templateDescription;
    const enrichedDescription = await enrichDescription(descriptionValue, this.selectedWeaponDocument);
    const reviewItem = reviewData?.temporary ?? null;
    const reviewProperties = valuesOf(reviewItem?.system?.properties).map(value =>
      localizedLabel(CONFIG.DND5E.itemProperties?.[value], value)).sort((a, b) => a.localeCompare(b, game.i18n.lang));
    const reviewActivities = valuesOf(reviewItem?.system?.activities).map(activity => ({
      name: activity.name || localizedLabel(CONFIG.DND5E.activityTypes?.[activity.type], activity.type),
      type: localizedLabel(CONFIG.DND5E.activityTypes?.[activity.type], activity.type),
      img: activity.img || reviewItem?.img
    }));
    const reviewInventory = reviewItem ? {
      name: reviewItem.name,
      img: reviewItem.img,
      type: "Weapon",
      rarity: localizedLabel(CONFIG.DND5E.itemRarity?.[reviewItem.system?.rarity], reviewItem.system?.rarity || "Mundane"),
      attunement: reviewItem.system?.attunement ? localizedLabel(CONFIG.DND5E.attunementTypes?.[reviewItem.system.attunement], reviewItem.system.attunement) : "None",
      quantity: reviewItem.system?.quantity ?? 1,
      damage: displayDamage(effective?.baseDamage, damageTypeLabel),
      properties: reviewProperties,
      activities: reviewActivities,
      effects: reviewItem.effects?.size ?? reviewItem.effects?.length ?? 0,
      magical: valuesOf(reviewItem.system?.properties).includes("mgc")
    } : null;

    return {
      stage: MODULE_STAGE,
      version: MODULE_VERSION,
      step: this.step,
      steps,
      itemTypes: ITEM_TYPES.map(type => ({ ...type, selected: type.id === this.selectedType })),
      selectedType: this.selectedType,
      weaponCount: manualTemplateCount,
      templateOptionGroups,
      templateCategoryOptions,
      templateCategory: this.templateCategory,
      selectedWeapon,
      selectedBaseWeapon,
      selectedBaseWeaponUuid: this.selectedBaseWeaponUuid,
      baseWeaponOptionGroups,
      baseWeaponRequired: this.baseWeaponRequired,
      baseWeaponCustomized: customization("baseWeapon"),
      inheritedBaseWeapon: Boolean(this.inheritedBaseWeaponUuid),
      selectedWeaponUuid: this.selectedWeaponUuid,
      itemName: this.itemName,
      iconCustomized: customization("icon"),
      customFieldCount,
      loadingWeapon: this.loadingWeapon,
      canOpenBaseItem: typeComplete,
      baseComplete,
      source,
      effective,
      custom: this.customized,
      weaponTypeOptions: configOptions(CONFIG.DND5E.weaponTypes, effective?.weaponType),
      attackTypeOptions: [
        { value: "melee", label: "Melee", selected: effective?.attackType === "melee" },
        { value: "ranged", label: "Ranged", selected: effective?.attackType === "ranged" }
      ],
      abilityOptions: configOptions(CONFIG.DND5E.abilities, effective?.attackAbility, {
        blankValue: "",
        blankLabel: "Automatic"
      }),
      proficiencyOptions: [
        { value: "automatic", label: "Automatic", selected: effective?.proficiency === "automatic" },
        { value: "proficient", label: "Always Proficient", selected: effective?.proficiency === "proficient" },
        { value: "notProficient", label: "Not Proficient", selected: effective?.proficiency === "notProficient" }
      ],
      damageTypeOptions: configOptions(CONFIG.DND5E.damageTypes, effective?.damageType),
      versatileDamageTypeOptions: configOptions(CONFIG.DND5E.damageTypes, effective?.versatile?.damageType),
      masteryOptions: configOptions(CONFIG.DND5E.weaponMasteries, effective?.mastery, {
        blankValue: "",
        blankLabel: "None"
      }),
      rangeUnitOptions: configOptions(CONFIG.DND5E.movementUnits, effective?.range?.units),
      weightUnitOptions: configOptions(CONFIG.DND5E.weightUnits, effective?.weight?.units),
      currencyOptions: configOptions(CONFIG.DND5E.currencies, effective?.price?.denomination),
      damageDiceOptions: damageDiceOptions(effective?.baseDamage?.denomination),
      versatileDiceOptions: damageDiceOptions(effective?.versatile?.denomination),
      propertyOptions,
      hasVersatile: effective?.properties?.includes("ver") ?? false,
      hasAmmunition: effective?.properties?.includes("amm") ?? false,
      additionalDamageRows,
      additionalDamageValid,
      additionalDamageCount: additionalDamageRows.length,
      enhancement: this.enhancements,
      enhancementValues: this.enhancementValues,
      enhancementCount: Object.values(this.enhancements).filter(Boolean).length,
      grantedSpellCount: grantedSpellRows.length,
      grantedSpellRows,
      enhancementsComplete,
      enhancementErrors: enhancementValidation.errors,
      effectiveMagical: Boolean(this.enhancements.magicalWeapon || this.enhancements.weaponEnhancement),
      rarityOptions: configOptions(CONFIG.DND5E.itemRarity, this.enhancementValues.magicalWeapon.rarity),
      attunementOptions: configOptions(CONFIG.DND5E.attunementTypes, this.enhancementValues.magicalWeapon.attunement, {
        blankValue: "",
        blankLabel: "None"
      }),
      enhancementBonusOptions: fixedOptions([[1, "+1"], [2, "+2"], [3, "+3"]], this.enhancementValues.weaponEnhancement.bonus),
      criticalThresholdOptions: fixedOptions([[20, "20 — Standard"], [19, "19 — Critical on 19–20"], [18, "18 — Critical on 18–20"], ["custom", "Custom"]], this.enhancementValues.criticalThreshold.mode),
      criticalDamageDiceOptions: damageDiceOptions(this.enhancementValues.extraCriticalDamage.denomination),
      criticalDamageTypeOptions: configOptions(CONFIG.DND5E.damageTypes, this.enhancementValues.extraCriticalDamage.damageType),
      resistanceDamageTypes: Object.entries(CONFIG.DND5E.damageTypes ?? {}).map(([value, entry]) => ({
        value,
        label: localizedLabel(entry, value),
        selected: this.enhancementValues.ignoreResistance.damageTypes.includes(value)
      })).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang)),
      conditionalModeOptions: fixedOptions([["supported", "Supported Condition"], ["custom", "Custom Rule Text"]], this.enhancementValues.conditionalAdvantage.mode),
      conditionalAppliesToOptions: fixedOptions([["attackRolls", "Attack Rolls with this weapon"]], this.enhancementValues.conditionalAdvantage.appliesTo),
      supportedConditionOptions: fixedOptions([
        ["targetUndead", "Target is Undead"],
        ["targetFiend", "Target is a Fiend"],
        ["targetBloodied", "Target is below half its Hit Points"],
        ["wielderDimLight", "Wielder is in dim light"],
        ["targetNotActed", "Target has not acted this combat"]
      ], this.enhancementValues.conditionalAdvantage.supportedCondition),
      conditionalIsSupported: this.enhancementValues.conditionalAdvantage.mode === "supported",
      conditionalSupportLabel: this.enhancementValues.conditionalAdvantage.mode === "supported" ? "Item Creator Runtime" : "Description Only",
      grantedEffects: this.grantedEffects,
      grantedEffectValues: effectValues,
      grantedEffectCount,
      grantedEffectsComplete,
      grantedEffectErrors: grantedEffectValidation.errors,
      effectAvailability,
      savingThrowBonusRows: prepareEffectRows("savingThrowBonus"),
      savingThrowAdvantageRows: prepareEffectRows("savingThrowAdvantage"),
      abilityScoreAdjustmentRows: prepareEffectRows("abilityScoreAdjustment"),
      abilityCheckBonusRows: prepareEffectRows("abilityCheckBonus"),
      skillBonusRows: prepareEffectRows("skillBonus"),
      skillProficiencyRows: prepareEffectRows("skillProficiency"),
      abilityCheckAdvantageRows: prepareEffectRows("abilityCheckAdvantage"),
      movementBonusRows: prepareEffectRows("movementBonus"),
      grantMovementTypeRows: prepareEffectRows("grantMovementType"),
      grantedSenseRows: prepareEffectRows("grantedSense"),
      passiveScoreBonusRows: prepareEffectRows("passiveScoreBonus"),
      damageResistanceOptions: damageEffectOptions("damageResistance"),
      damageImmunityOptions: damageEffectOptions("damageImmunity"),
      damageVulnerabilityOptions: damageEffectOptions("damageVulnerability"),
      conditionImmunityOptions: conditionTypeOptions(effectValues.conditionImmunity.conditions),
      descriptionComplete,
      descriptionCustomized: this.descriptionCustomized,
      descriptionValue,
      enrichedDescription,
      hasTemplateDescription: Boolean(this.templateDescription.trim()),
      hasRawTemplateDescription: Boolean(this.templateDescriptionRaw.trim()),
      descriptionSource: selectedSource ? `${selectedSource.sourceLabel} — ${selectedSource.packLabel}` : "Template",
      reviewComplete,
      reviewReady: reviewComplete && Boolean(reviewData),
      reviewError,
      reviewChatCard,
      reviewInventory,
      reviewSummary: {
        template: this.selectedWeaponDocument?.name ?? "—",
        baseWeapon: this.selectedBaseWeaponDocument?.name ?? "—",
        name: this.itemName.trim() || "—",
        baseOverrides: customFieldCount,
        enhancements: Object.values(this.enhancements).filter(Boolean).length,
        grantedSpells: grantedSpellRows.length,
        grantedEffects: grantedEffectCount,
        description: this.descriptionCustomized ? "Customized" : "Inherited from Template"
      },
      savingItem: this.savingItem
    };
  }

  _onRender() {
    const root = this.element;
    root.querySelectorAll('[data-action="select-type"]').forEach(button => button.addEventListener("click", event => this.#selectType(event)));
    root.querySelectorAll('[data-action="step"]').forEach(button => button.addEventListener("click", event => this.#changeStep(event)));
    root.querySelector('[data-action="continue"]')?.addEventListener("click", event => this.#continue(event));
    root.querySelector('[data-action="back"]')?.addEventListener("click", event => this.#back(event));
    root.querySelector('[data-action="save-item"]')?.addEventListener("click", event => this.#saveItem(event));
    root.querySelector('[data-action="browse-templates"]')?.addEventListener("click", event => this.#openTemplateBrowser(event));
    root.querySelector('[data-template-category]')?.addEventListener("change", event => this.#filterTemplates(event));
    root.querySelector('[data-template-select]')?.addEventListener("change", event => this.#selectTemplate(event));
    root.querySelector('[data-base-weapon-select]')?.addEventListener("change", event => this.#selectBaseWeapon(event));
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
    root.querySelector('[data-action="browse-spells"]')?.addEventListener("click", event => this.#openSpellBrowser(event));
    root.querySelectorAll('[data-action="remove-granted-spell"]').forEach(button => button.addEventListener("click", event => this.#removeGrantedSpell(event)));
    root.querySelectorAll('[data-granted-spell-input]').forEach(input => input.addEventListener("change", event => this.#updateGrantedSpell(event)));
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
    return {
      template: this.selectedWeaponDocument,
      baseWeapon: this.selectedBaseWeaponDocument,
      itemName: this.itemName,
      icon: this.selectedIcon || this.selectedWeaponDocument?.img,
      effective,
      customized: clone(this.customized),
      overrides: clone(this.overrides),
      enhancements: clone(this.enhancements),
      enhancementValues: clone(this.enhancementValues),
      grantedEffects: clone(this.grantedEffects),
      grantedEffectValues: clone(this.grantedEffectValues),
      description: this.descriptionCustomized ? this.customDescription : this.templateDescription,
      descriptionCustomized: this.descriptionCustomized
    };
  }

  async #saveItem(event) {
    event.preventDefault();
    if (this.savingItem) return;
    this.#syncDescriptionFromEditor();
    if (!this.#isBaseComplete() || !this.#validateEnhancements().valid || !this.#validateGrantedEffects().valid) {
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
    const confirmed = await ProtectedTransactionDialogService.confirm({
      key: "create-item",
      matchClass: "ic-confirm-item-dialog",
      dialogOptions: {
        classes: ["ic-confirm-item-dialog"],
        window: { title: "Confirm Item Creation", modal: true },
        content: `<div class="ic-confirm-item-content"><i class="fa-solid fa-hammer"></i><div><h2>Confirm Item Creation</h2><p>Create <strong>${foundry.utils.escapeHTML(itemName)}</strong> in the Items Directory?</p></div></div>`,
        yes: { label: "OK", icon: "fa-solid fa-check" },
        no: { label: "Cancel", icon: "fa-solid fa-xmark" }
      }
    });
    if (!confirmed) return;

    this.savingItem = true;
    try {
      const created = await ProtectedTransactionDialogService.runProcessing({
        title: "Creating Item…",
        message: "Building the Item, Activities, Active Effects, granted Spells, and source metadata. Please wait.",
        operation: async () => {
          const { data } = await ItemCreatorItemBuilder.build(this.#builderDraft());
          const ItemClass = Item.implementation ?? CONFIG.Item.documentClass;
          const item = await ItemClass.create(data, { renderSheet: false });
          if (!item) throw new Error("Foundry did not return the created Item document.");
          return item;
        }
      });
      ui.notifications.info(`${created.name} was created successfully.`);
      await this.close();
      ui.items?.render?.();
    } catch (error) {
      console.error(`${MODULE_ID} | Item creation failed.`, error);
      ui.notifications.error(`Item creation failed. No Item was created: ${error?.message ?? "Unknown error"}`);
      this.savingItem = false;
      this.step = "review";
      this.render({ force: true });
    }
  }

  #sourceValues() {
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
    return effective;
  }

  #captureScroll() {
    return this.element?.querySelector(".ic-step-content")?.scrollTop ?? 0;
  }

  #renderPreservingScroll() {
    this.restoreScrollTop = this.#captureScroll();
    this.render({ force: true });
  }

  #selectType(event) {
    event.preventDefault();
    const button = event.currentTarget;
    if (button.disabled || button.dataset.available !== "true") return;
    this.selectedType = button.dataset.type;
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
    if (this.step === "itemType" && this.selectedType === "weapon") {
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
      this.step = "description";
      this.render({ force: true });
      return;
    }
    if (this.step === "description" && this.#validateGrantedEffects().valid) {
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
        hint: "Select a Weapon document to use as the Base Item template.",
        filters: {
          locked: {
            documentClass: "Item",
            types: new Set(["weapon"])
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
      let document = await registry.getWeaponDocument(uuid);
      document ??= await fromUuid(uuid);
      if (!isWeaponItemDocument(document)) {
        throw new Error("The selected document is not a Weapon Item.");
      }
      const option = registry.findWeapon(uuid);
      this.selectedWeaponUuid = uuid;
      this.selectedWeaponDocument = document;
      this.itemName = document.name;
      this.selectedIcon = document.img || "icons/svg/sword.svg";
      this.templateCategory = option?.weaponType || document.system?.type?.value || "all";
      this.customized = {};
      this.overrides = {};
      this.#resetEnhancements();
      this.#resetGrantedEffects();
      this.templateDescriptionRaw = rawTemplateDescription(document);
      this.templateDescription = cleanTemplateDescription(document);
      this.customDescription = this.templateDescriptionRaw;
      this.descriptionCustomized = false;

      const inherited = registry.findBaseWeaponByIdentifier(document.system?.type?.baseItem);
      this.inheritedBaseWeaponUuid = inherited?.uuid ?? null;
      this.selectedBaseWeaponUuid = inherited?.uuid ?? null;
      this.selectedBaseWeaponDocument = inherited ? await registry.getWeaponDocument(inherited.uuid) : null;
      this.baseWeaponRequired = !this.selectedBaseWeaponDocument;
      if (this.baseWeaponRequired) {
        this.customized.baseWeapon = true;
        this.overrides.baseWeapon = "";
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to select weapon template.`, error);
      ui.notifications.error("Item Creator could not load the selected weapon template.");
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
      || this.descriptionCustomized;
  }

  #clearTemplate() {
    this.selectedWeaponUuid = null;
    this.selectedWeaponDocument = null;
    this.inheritedBaseWeaponUuid = null;
    this.selectedBaseWeaponUuid = null;
    this.selectedBaseWeaponDocument = null;
    this.baseWeaponRequired = false;
    this.itemName = "";
    this.selectedIcon = "";
    this.customized = {};
    this.overrides = {};
    this.#resetEnhancements();
    this.#resetGrantedEffects();
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

    if (field === "baseWeapon") {
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
      if (enabled) this.overrides.icon = this.selectedIcon || this.selectedWeaponDocument.img || "icons/svg/sword.svg";
      else {
        delete this.overrides.icon;
        this.selectedIcon = this.selectedWeaponDocument.img || "icons/svg/sword.svg";
        this.iconBrowserApp?.close?.();
        this.iconBrowserApp = null;
      }
    } else if (field === "additionalDamage") {
      if (enabled) this.overrides.additionalDamage = [this.#newAdditionalDamage()];
      else delete this.overrides.additionalDamage;
    } else if (enabled) {
      const source = this.#sourceValues();
      this.overrides[field] = clone(source?.[field]);
      if (field === "properties") {
        this.overrides.versatile = clone(source?.versatile);
        this.overrides.ammunitionType = source?.ammunitionType ?? "";
      }
    } else {
      delete this.overrides[field];
      if (field === "properties") {
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

    if (property === "ver") {
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
    if (property === "amm") {
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
      itemType: "weapon",
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
      ability: ""
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

  #isBaseComplete() {
    const effective = this.#effectiveValues();
    const additionalDamageValid = !this.customized.additionalDamage
      || (effective?.additionalDamage?.length > 0 && effective.additionalDamage.every(row =>
        Number(row.number) > 0 && Number(row.denomination) > 0 && Boolean(row.damageType)
        && (!row.useAbilityModifier || Boolean(row.ability))));
    return Boolean(this.selectedWeaponUuid && this.selectedBaseWeaponUuid && this.itemName.trim() && additionalDamageValid);
  }

  #resetEnhancements() {
    this.enhancements = {};
    this.enhancementValues = enhancementDefaults();
  }

  #resetGrantedEffects() {
    this.grantedEffects = {};
    this.grantedEffectValues = grantedEffectDefaults();
  }

  #validateEnhancements() {
    const errors = {};
    const values = this.enhancementValues;
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
    if (this.enhancements.grantedSpellcasting) {
      const spells = values.grantedSpellcasting.spells ?? [];
      if (!spells.length || spells.some(spell => !this.#validateGrantedSpell(spell))) errors.grantedSpellcasting = true;
    }
    if (this.enhancements.ignoreResistance && !values.ignoreResistance.damageTypes.length) errors.ignoreResistance = true;
    if (this.enhancements.conditionalAdvantage) {
      const conditional = values.conditionalAdvantage;
      if (conditional.mode === "supported" && !conditional.supportedCondition) errors.conditionalAdvantage = true;
      if (conditional.mode === "custom" && !String(conditional.customText ?? "").trim()) errors.conditionalAdvantage = true;
    }
    return { valid: !Object.keys(errors).length, errors };
  }

  #validateGrantedEffects() {
    const errors = {};
    const values = this.grantedEffectValues;
    const finite = value => Number.isFinite(Number(value));
    const hasRows = (key, validator) => {
      const rows = values[key]?.entries ?? [];
      return rows.length > 0 && rows.every(validator);
    };
    const validAvailability = key => ["owned", "equipped", "equippedAttuned"].includes(values[key]?.availability);

    if (this.grantedEffects.armorClassBonus && !(finite(values.armorClassBonus.bonus) && validAvailability("armorClassBonus"))) errors.armorClassBonus = true;
    if (this.grantedEffects.savingThrowBonus && !(hasRows("savingThrowBonus", row => Boolean(row.target) && finite(row.bonus)) && validAvailability("savingThrowBonus"))) errors.savingThrowBonus = true;
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
    return { valid: !Object.keys(errors).length, errors };
  }

  #newGrantedEffectRow(key) {
    const firstAbility = Object.keys(CONFIG.DND5E.abilities ?? {})[0] ?? "str";
    const firstSkill = Object.keys(CONFIG.DND5E.skills ?? {})[0] ?? "prc";
    const firstMovement = Object.keys(CONFIG.DND5E.movementTypes ?? {})[0] ?? "walk";
    const firstSense = Object.keys(CONFIG.DND5E.senses ?? CONFIG.DND5E.senseTypes ?? {})[0] ?? "darkvision";
    switch (key) {
      case "savingThrowBonus": return effectRow({ target: "all", bonus: 1 });
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
      availability: 'equipped'
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
        hint: 'Select a Spell to grant through this weapon.',
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
      ui.notifications.warn(`${document.name} is already granted by this weapon.`);
      return false;
    }
    spells.push(this.#newGrantedSpell(document));
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

  #toggleEnhancement(event) {
    const field = event.currentTarget.dataset.enhancementToggle;
    if (!field || !(field in enhancementDefaults())) return;
    const enabled = event.currentTarget.checked;
    this.enhancements[field] = enabled;
    if (!enabled) this.enhancementValues[field] = clone(enhancementDefaults()[field]);
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
    this.iconBrowserApp = null;
    this.#setBrowserBlock(false);
    return super.close(options);
  }
}
