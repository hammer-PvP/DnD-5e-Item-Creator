import { ITEM_TYPES, MODULE_ID, MODULE_STAGE, MODULE_VERSION, STEPS } from "../constants.mjs";
import { ItemCreatorSourceRegistry } from "../services/source-registry.mjs";
import { ItemCreatorSettingsApp } from "./settings-app.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function masteryValue(document) {
  const value = document?.system?.mastery;
  const values = Array.isArray(value) ? value.filter(Boolean)
    : value instanceof Set ? [...value]
      : value && typeof value === "object" ? Object.values(value).filter(Boolean)
        : String(value ?? "").trim() ? [String(value).trim()] : [];
  if (!values.length) return "None";
  return values.map(key => {
    const label = CONFIG.DND5E.weaponMasteries?.[key]?.label ?? key;
    return game.i18n.localize(label);
  }).join(", ");
}

function damageSummary(document) {
  const parts = document?.system?.damage?.parts;
  if (Array.isArray(parts) && parts.length) {
    return parts.map(part => Array.isArray(part) ? part.filter(Boolean).join(" ") : String(part)).join(" + ");
  }
  const base = document?.system?.damage?.base;
  if (base?.number && base?.denomination) {
    const type = base.types instanceof Set ? [...base.types].join(", ") : Array.isArray(base.types) ? base.types.join(", ") : "";
    return `${base.number}d${base.denomination}${type ? ` ${type}` : ""}`;
  }
  return "Source-defined";
}

function categorySummary(document) {
  return document?.system?.type?.label
    ?? document?.system?.type?.value
    ?? document?.system?.type?.subtype
    ?? "Weapon";
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
    this.weaponSearch = "";
    this.iconSearch = "";
    this.iconBrowserOpen = false;
    this.loadingWeapon = false;
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
    const typeComplete = Boolean(this.selectedType);
    const baseComplete = Boolean(this.selectedWeaponUuid);
    const steps = STEPS.map(step => ({
      ...step,
      active: step.id === this.step,
      complete: step.id === "itemType" ? typeComplete : step.id === "baseItem" ? baseComplete : false,
      locked: !step.available || (step.id === "baseItem" && !typeComplete)
    }));
    const selectedOption = this.selectedWeaponUuid
      ? ItemCreatorSourceRegistry.instance.findWeapon(this.selectedWeaponUuid)
      : null;
    const selectedWeapon = this.selectedWeaponDocument ? {
      name: this.selectedWeaponDocument.name,
      img: this.selectedIcon || this.selectedWeaponDocument.img,
      sourceImg: this.selectedWeaponDocument.img,
      category: categorySummary(this.selectedWeaponDocument),
      damage: damageSummary(this.selectedWeaponDocument),
      mastery: masteryValue(this.selectedWeaponDocument),
      weight: this.selectedWeaponDocument.system?.weight?.value ?? this.selectedWeaponDocument.system?.weight ?? "—",
      price: this.selectedWeaponDocument.system?.price?.value ?? "—",
      priceDenomination: this.selectedWeaponDocument.system?.price?.denomination ?? "",
      source: selectedOption ? `${selectedOption.packageLabel} — ${selectedOption.packLabel}` : "Active compendium"
    } : null;

    return {
      stage: MODULE_STAGE,
      version: MODULE_VERSION.replace(/-alpha$/i, ""),
      step: this.step,
      steps,
      itemTypes: ITEM_TYPES.map(type => ({ ...type, selected: type.id === this.selectedType })),
      selectedType: this.selectedType,
      weaponGroups: ItemCreatorSourceRegistry.instance.weaponGroups,
      weaponCount: ItemCreatorSourceRegistry.instance.weaponByUuid.size,
      iconOptions: ItemCreatorSourceRegistry.instance.iconOptions,
      selectedWeapon,
      selectedWeaponUuid: this.selectedWeaponUuid,
      itemName: this.itemName,
      selectedIcon: this.selectedIcon,
      iconCustomized: Boolean(this.selectedIcon && this.selectedWeaponDocument && this.selectedIcon !== this.selectedWeaponDocument.img),
      weaponSearch: this.weaponSearch,
      iconSearch: this.iconSearch,
      iconBrowserOpen: this.iconBrowserOpen,
      loadingWeapon: this.loadingWeapon,
      canOpenBaseItem: typeComplete,
      baseComplete
    };
  }

  _onRender() {
    const root = this.element;
    root.querySelectorAll('[data-action="select-type"]').forEach(button => button.addEventListener("click", event => this.#selectType(event)));
    root.querySelectorAll('[data-action="step"]').forEach(button => button.addEventListener("click", event => this.#changeStep(event)));
    root.querySelector('[data-action="continue"]')?.addEventListener("click", event => this.#continue(event));
    root.querySelector('[data-action="back"]')?.addEventListener("click", event => this.#back(event));
    root.querySelector('[data-action="open-settings"]')?.addEventListener("click", event => this.#openSettings(event));
    root.querySelector('[data-weapon-search]')?.addEventListener("input", event => this.#filterWeapons(event));
    root.querySelectorAll('[data-action="select-weapon"]').forEach(button => button.addEventListener("click", event => this.#selectWeapon(event)));
    root.querySelector('[name="itemName"]')?.addEventListener("input", event => { this.itemName = event.currentTarget.value; });
    root.querySelector('[data-action="toggle-icon-browser"]')?.addEventListener("click", event => this.#toggleIconBrowser(event));
    root.querySelector('[data-icon-search]')?.addEventListener("input", event => this.#filterIcons(event));
    root.querySelectorAll('[data-action="select-icon"]').forEach(button => button.addEventListener("click", event => this.#selectIcon(event)));
    this.#applyWeaponFilter(this.weaponSearch);
    this.#applyIconFilter(this.iconSearch);
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
    this.step = button.dataset.step;
    this.render({ force: true });
  }

  #continue(event) {
    event.preventDefault();
    if (this.step === "itemType" && this.selectedType === "weapon") {
      this.step = "baseItem";
      this.render({ force: true });
    }
  }

  #back(event) {
    event.preventDefault();
    if (this.step === "baseItem") {
      this.step = "itemType";
      this.render({ force: true });
    }
  }

  #openSettings(event) {
    event.preventDefault();
    new ItemCreatorSettingsApp().render({ force: true });
  }

  #filterWeapons(event) {
    this.weaponSearch = String(event.currentTarget.value ?? "").trim().toLowerCase();
    this.#applyWeaponFilter(this.weaponSearch);
  }

  #applyWeaponFilter(query) {
    for (const card of this.element.querySelectorAll("[data-weapon-card]")) {
      card.hidden = Boolean(query && !String(card.dataset.search ?? "").includes(query));
    }
    for (const group of this.element.querySelectorAll("[data-weapon-group]")) {
      group.hidden = !group.querySelector("[data-weapon-card]:not([hidden])");
    }
  }

  async #selectWeapon(event) {
    event.preventDefault();
    if (this.loadingWeapon) return;
    const uuid = event.currentTarget.dataset.uuid;
    if (!uuid) return;
    this.loadingWeapon = true;
    try {
      const document = await ItemCreatorSourceRegistry.instance.getWeaponDocument(uuid);
      if (!document) throw new Error("The selected source is no longer available.");
      this.selectedWeaponUuid = uuid;
      this.selectedWeaponDocument = document;
      this.itemName = document.name;
      this.selectedIcon = document.img || "icons/svg/sword.svg";
      this.iconBrowserOpen = false;
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to select base weapon.`, error);
      ui.notifications.error("Item Creator could not load the selected base weapon.");
    } finally {
      this.loadingWeapon = false;
      this.render({ force: true });
    }
  }

  #toggleIconBrowser(event) {
    event.preventDefault();
    if (!this.selectedWeaponUuid) return;
    this.iconBrowserOpen = !this.iconBrowserOpen;
    this.render({ force: true });
  }

  #filterIcons(event) {
    this.iconSearch = String(event.currentTarget.value ?? "").trim().toLowerCase();
    this.#applyIconFilter(this.iconSearch);
  }

  #applyIconFilter(query) {
    for (const card of this.element.querySelectorAll("[data-icon-card]")) {
      card.hidden = Boolean(query && !String(card.dataset.search ?? "").includes(query));
    }
  }

  #selectIcon(event) {
    event.preventDefault();
    const img = event.currentTarget.dataset.img;
    if (!img) return;
    this.selectedIcon = img;
    this.iconBrowserOpen = false;
    this.render({ force: true });
  }
}
