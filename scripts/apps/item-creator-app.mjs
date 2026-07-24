import { ITEM_TYPES, MODULE_ID, MODULE_STAGE, MODULE_VERSION, STEPS } from "../constants.mjs";
import { ItemCreatorSourceRegistry } from "../services/source-registry.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
    ammunitionType: system.ammunition?.type ?? ""
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

export class ItemCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.step = "itemType";
    this.selectedType = null;
    this.selectedWeaponUuid = null;
    this.selectedWeaponDocument = null;
    this.itemName = "";
    this.selectedIcon = "";
    this.templateSearch = "";
    this.templateCategory = "all";
    this.iconSearch = "";
    this.iconBrowserOpen = false;
    this.loadingWeapon = false;
    this.customized = {};
    this.overrides = {};
    this.restoreScrollTop = null;
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
    await ItemCreatorSourceRegistry.instance.loadWeapons();

    if (this.selectedWeaponUuid && !ItemCreatorSourceRegistry.instance.findWeapon(this.selectedWeaponUuid)) {
      this.#clearTemplate();
    }

    const typeComplete = Boolean(this.selectedType);
    const baseComplete = Boolean(this.selectedWeaponUuid && this.itemName.trim());
    const steps = STEPS.map(step => ({
      ...step,
      active: step.id === this.step,
      complete: step.id === "itemType" ? typeComplete : step.id === "baseItem" ? baseComplete : false,
      locked: !step.available || (step.id === "baseItem" && !typeComplete)
    }));

    const source = weaponSourceData(this.selectedWeaponDocument);
    const effective = source ? this.#effectiveValues(source) : null;
    const selectedOption = this.selectedWeaponUuid
      ? ItemCreatorSourceRegistry.instance.findWeapon(this.selectedWeaponUuid)
      : null;

    const templateCounts = new Map();
    for (const option of ItemCreatorSourceRegistry.instance.weaponOptions) {
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

    const templateOptions = ItemCreatorSourceRegistry.instance.weaponOptions.map(option => ({
      ...option,
      selected: option.uuid === this.selectedWeaponUuid,
      optionLabel: `${option.name} — ${option.sourceLabel}`
    }));

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
      source: selectedOption ? `${selectedOption.sourceLabel} — ${selectedOption.packLabel}` : "Active compendium",
      sourceLabel: selectedOption?.sourceLabel ?? "Active source",
      packLabel: selectedOption?.packLabel ?? "Item compendium",
      identifier: this.selectedWeaponDocument.system?.identifier ?? "—",
      damageSummary: displayDamage(effective?.baseDamage, damageTypeLabel)
    } : null;

    const customization = field => Boolean(this.customized[field]);
    const customFieldCount = Object.values(this.customized).filter(Boolean).length;

    return {
      stage: MODULE_STAGE,
      version: MODULE_VERSION,
      step: this.step,
      steps,
      itemTypes: ITEM_TYPES.map(type => ({ ...type, selected: type.id === this.selectedType })),
      selectedType: this.selectedType,
      weaponCount: ItemCreatorSourceRegistry.instance.weaponOptions.length,
      templateOptions,
      templateCategoryOptions,
      templateSearch: this.templateSearch,
      templateCategory: this.templateCategory,
      selectedWeapon,
      selectedWeaponUuid: this.selectedWeaponUuid,
      itemName: this.itemName,
      iconOptions: ItemCreatorSourceRegistry.instance.iconOptions,
      iconSearch: this.iconSearch,
      iconBrowserOpen: this.iconBrowserOpen,
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
      damageDiceOptions: [4, 6, 8, 10, 12, 20].map(value => ({
        value,
        label: `d${value}`,
        selected: Number(effective?.baseDamage?.denomination) === value
      })),
      versatileDiceOptions: [4, 6, 8, 10, 12, 20].map(value => ({
        value,
        label: `d${value}`,
        selected: Number(effective?.versatile?.denomination) === value
      })),
      propertyOptions,
      hasVersatile: effective?.properties?.includes("ver") ?? false,
      hasAmmunition: effective?.properties?.includes("amm") ?? false
    };
  }

  _onRender() {
    const root = this.element;
    root.querySelectorAll('[data-action="select-type"]').forEach(button => button.addEventListener("click", event => this.#selectType(event)));
    root.querySelectorAll('[data-action="step"]').forEach(button => button.addEventListener("click", event => this.#changeStep(event)));
    root.querySelector('[data-action="continue"]')?.addEventListener("click", event => this.#continue(event));
    root.querySelector('[data-action="back"]')?.addEventListener("click", event => this.#back(event));
    root.querySelector('[data-template-search]')?.addEventListener("input", event => this.#filterTemplates(event));
    root.querySelector('[data-template-category]')?.addEventListener("change", event => this.#filterTemplates(event));
    root.querySelector('[data-template-select]')?.addEventListener("change", event => this.#selectTemplate(event));
    root.querySelector('[name="itemName"]')?.addEventListener("input", event => this.#updateItemName(event));
    root.querySelectorAll('[data-override-toggle]').forEach(input => input.addEventListener("change", event => this.#toggleOverride(event)));
    root.querySelectorAll('[data-override-input]').forEach(input => {
      const eventName = input.matches("select, input[type=checkbox]") ? "change" : "input";
      input.addEventListener(eventName, event => this.#updateOverride(event));
    });
    root.querySelectorAll('[data-property-key]').forEach(input => input.addEventListener("change", event => this.#updateProperty(event)));
    root.querySelector('[data-action="toggle-icon-browser"]')?.addEventListener("click", event => this.#toggleIconBrowser(event));
    root.querySelector('[data-icon-search]')?.addEventListener("input", event => this.#filterIcons(event));
    root.querySelectorAll('[data-action="select-icon"]').forEach(button => button.addEventListener("click", event => this.#selectIcon(event)));

    this.#applyTemplateFilter();
    this.#applyIconFilter(this.iconSearch);

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
    return weaponSourceData(this.selectedWeaponDocument);
  }

  #effectiveValues(source = this.#sourceValues()) {
    if (!source) return null;
    const effective = clone(source);
    for (const [field, enabled] of Object.entries(this.customized)) {
      if (!enabled || !(field in this.overrides) || field === "icon") continue;
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
    }
  }

  #back(event) {
    event.preventDefault();
    if (this.step === "baseItem") {
      this.restoreScrollTop = null;
      this.step = "itemType";
      this.render({ force: true });
    }
  }

  #filterTemplates(event) {
    if (event.currentTarget.matches("[data-template-search]")) {
      this.templateSearch = String(event.currentTarget.value ?? "").trim().toLowerCase();
    } else {
      this.templateCategory = String(event.currentTarget.value ?? "all");
    }
    this.#applyTemplateFilter();
  }

  #applyTemplateFilter() {
    const select = this.element?.querySelector("[data-template-select]");
    if (!select) return;
    let visible = 0;
    for (const option of select.querySelectorAll("option[data-template-option]")) {
      const matchesSearch = !this.templateSearch || String(option.dataset.search ?? "").includes(this.templateSearch);
      const matchesCategory = this.templateCategory === "all" || option.dataset.category === this.templateCategory;
      const keepSelected = option.value === this.selectedWeaponUuid;
      const show = (matchesSearch && matchesCategory) || keepSelected;
      option.hidden = !show;
      option.disabled = !show;
      if (show) visible += 1;
    }
    const counter = this.element.querySelector("[data-template-count]");
    if (counter) counter.textContent = String(visible);
  }

  async #selectTemplate(event) {
    if (this.loadingWeapon) return;
    const uuid = event.currentTarget.value;
    if (!uuid) {
      this.#clearTemplate();
      this.#renderPreservingScroll();
      return;
    }

    this.loadingWeapon = true;
    try {
      const document = await ItemCreatorSourceRegistry.instance.getWeaponDocument(uuid);
      if (!document) throw new Error("The selected template is no longer available.");
      this.selectedWeaponUuid = uuid;
      this.selectedWeaponDocument = document;
      this.itemName = document.name;
      this.selectedIcon = document.img || "icons/svg/sword.svg";
      this.customized = {};
      this.overrides = {};
      this.iconBrowserOpen = false;
      this.iconSearch = "";
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to select weapon template.`, error);
      ui.notifications.error("Item Creator could not load the selected weapon template.");
    } finally {
      this.loadingWeapon = false;
      this.#renderPreservingScroll();
    }
  }

  #clearTemplate() {
    this.selectedWeaponUuid = null;
    this.selectedWeaponDocument = null;
    this.itemName = "";
    this.selectedIcon = "";
    this.customized = {};
    this.overrides = {};
    this.iconBrowserOpen = false;
    this.iconSearch = "";
  }

  #updateItemName(event) {
    this.itemName = String(event.currentTarget.value ?? "");
    const draftName = this.element.querySelector("[data-draft-name]");
    if (draftName) draftName.textContent = this.itemName.trim() || "—";
  }

  #toggleOverride(event) {
    const field = event.currentTarget.dataset.overrideToggle;
    if (!field || !this.selectedWeaponDocument) return;
    const enabled = event.currentTarget.checked;
    this.customized[field] = enabled;

    if (field === "icon") {
      if (enabled) this.overrides.icon = this.selectedIcon || this.selectedWeaponDocument.img || "icons/svg/sword.svg";
      else {
        delete this.overrides.icon;
        this.selectedIcon = this.selectedWeaponDocument.img || "icons/svg/sword.svg";
        this.iconBrowserOpen = false;
        this.iconSearch = "";
      }
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
    if (event.currentTarget.dataset.valueType === "number") {
      value = value === "" ? 0 : Number(value);
    }

    if (part) {
      this.overrides[field] ??= {};
      this.overrides[field][part] = value;
    } else {
      this.overrides[field] = value;
    }
  }

  #updateProperty(event) {
    if (!this.customized.properties) return;
    const property = event.currentTarget.dataset.propertyKey;
    const properties = new Set(this.overrides.properties ?? []);
    const checked = event.currentTarget.checked;
    if (checked) properties.add(property);
    else properties.delete(property);
    this.overrides.properties = [...properties];

    // Dependent-state cleanup for properties that expose additional fields.
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

  #toggleIconBrowser(event) {
    event.preventDefault();
    if (!this.selectedWeaponUuid || !this.customized.icon) return;
    this.iconBrowserOpen = !this.iconBrowserOpen;
    this.#renderPreservingScroll();
  }

  #filterIcons(event) {
    this.iconSearch = String(event.currentTarget.value ?? "").trim().toLowerCase();
    this.#applyIconFilter(this.iconSearch);
  }

  #applyIconFilter(query) {
    for (const card of this.element?.querySelectorAll("[data-icon-card]") ?? []) {
      card.hidden = Boolean(query && !String(card.dataset.search ?? "").includes(query));
    }
  }

  #selectIcon(event) {
    event.preventDefault();
    if (!this.customized.icon) return;
    const img = event.currentTarget.dataset.img;
    if (!img) return;
    this.selectedIcon = img;
    this.overrides.icon = img;
    this.iconBrowserOpen = false;
    this.#renderPreservingScroll();
  }
}
