import { ITEM_TYPES, MODULE_ID, MODULE_STAGE, MODULE_VERSION, STEPS } from "../constants.mjs";
import { ItemCreatorSourceRegistry } from "../services/source-registry.mjs";
import { ItemCreatorIconBrowserApp } from "./icon-browser-app.mjs";

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
    this.restoreScrollTop = null;
    this.templateBrowserOpen = false;
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
    const steps = STEPS.map(step => ({
      ...step,
      active: step.id === this.step,
      complete: step.id === "itemType"
        ? typeComplete
        : step.id === "baseItem"
          ? baseComplete
          : step.id === "enhancements"
            ? enhancementsComplete
            : false,
      locked: !step.available
        || (step.id === "baseItem" && !typeComplete)
        || (step.id === "enhancements" && !baseComplete)
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
    for (const option of registry.weaponOptions) {
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

    const templateOptions = registry.weaponOptions.map(option => ({
      ...option,
      selected: option.uuid === this.selectedWeaponUuid,
      optionLabel: `${option.name} — ${option.sourceLabel} / ${option.packLabel}`
    }));
    if (this.selectedWeaponDocument && !templateOptions.some(option => option.uuid === this.selectedWeaponUuid)) {
      templateOptions.unshift({
        uuid: this.selectedWeaponUuid,
        name: this.selectedWeaponDocument.name,
        weaponType: this.selectedWeaponDocument.system?.type?.value ?? "",
        selected: true,
        optionLabel: `${this.selectedWeaponDocument.name} — ${selectedSource?.sourceLabel ?? "Compendium"} / ${selectedSource?.packLabel ?? "Items"}`
      });
    }

    const baseWeaponOptions = registry.weaponOptions.map(option => ({
      ...option,
      selected: option.uuid === this.selectedBaseWeaponUuid,
      optionLabel: `${option.name} — ${option.sourceLabel}`
    }));
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

    return {
      stage: MODULE_STAGE,
      version: MODULE_VERSION,
      step: this.step,
      steps,
      itemTypes: ITEM_TYPES.map(type => ({ ...type, selected: type.id === this.selectedType })),
      selectedType: this.selectedType,
      weaponCount: registry.weaponOptions.length,
      templateOptions,
      templateCategoryOptions,
      templateCategory: this.templateCategory,
      selectedWeapon,
      selectedBaseWeapon,
      selectedBaseWeaponUuid: this.selectedBaseWeaponUuid,
      baseWeaponOptions,
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
      conditionalSupportLabel: this.enhancementValues.conditionalAdvantage.mode === "supported" ? "Item Creator Runtime" : "Description Only"
    };
  }

  _onRender() {
    const root = this.element;
    root.querySelectorAll('[data-action="select-type"]').forEach(button => button.addEventListener("click", event => this.#selectType(event)));
    root.querySelectorAll('[data-action="step"]').forEach(button => button.addEventListener("click", event => this.#changeStep(event)));
    root.querySelector('[data-action="continue"]')?.addEventListener("click", event => this.#continue(event));
    root.querySelector('[data-action="back"]')?.addEventListener("click", event => this.#back(event));
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

  #changeStep(event) {
    event.preventDefault();
    const button = event.currentTarget;
    if (button.disabled || button.dataset.locked === "true") return;
    this.restoreScrollTop = null;
    this.step = button.dataset.step;
    this.render({ force: true });
  }

  #continue(event) {
    event.preventDefault();
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
    }
  }

  #back(event) {
    event.preventDefault();
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
        content: `<p>${uuid ? "Changing" : "Clearing"} the base template will discard the custom Item name, all Base Item overrides, additional damage entries, the custom icon, and all configured Enhancements.</p>`,
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
      || Object.values(this.enhancements).some(Boolean);
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
    if (this.enhancements.ignoreResistance && !values.ignoreResistance.damageTypes.length) errors.ignoreResistance = true;
    if (this.enhancements.conditionalAdvantage) {
      const conditional = values.conditionalAdvantage;
      if (conditional.mode === "supported" && !conditional.supportedCondition) errors.conditionalAdvantage = true;
      if (conditional.mode === "custom" && !String(conditional.customText ?? "").trim()) errors.conditionalAdvantage = true;
    }
    return { valid: !Object.keys(errors).length, errors };
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
    this.iconBrowserApp = null;
    this.#setBrowserBlock(false);
    return super.close(options);
  }
}
