import { MODULE_ID } from "../constants.mjs";
import {
  MATERIALIZATION_CORE_VERSION,
  MATERIALIZATION_PRICING_SCHEMA_VERSION,
  OFFICIAL_RARITY_PRICES,
  getMaterializationSettings,
  saveMaterializationSettings
} from "../core/materialization/pricing.mjs";
import {
  SUPPLIER_ENABLED_KEY
} from "../features/supplier/constants.mjs";
import {
  initializeDefaultSources,
  isSupplierEnabled
} from "../features/supplier/settings.mjs";
import { clearCatalogCache } from "../features/supplier/catalog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const RARITY_ROWS = [
  ["common", "Common"],
  ["uncommon", "Uncommon"],
  ["rare", "Rare"],
  ["veryRare", "Very Rare"],
  ["legendary", "Legendary"],
  ["artifact", "Artifact"]
];

export class ItemCreatorModuleSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "item-creator-module-settings",
    classes: ["item-creator", "ic-module-settings-app", "standard-form"],
    tag: "form",
    position: { width: 760, height: 720 },
    window: { title: "Item Creator Configuration", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/module-settings.hbs` }
  };

  async _prepareContext() {
    const pricing = getMaterializationSettings();
    return {
      supplierEnabled: isSupplierEnabled(),
      standaloneSupplierActive: game.modules.get("dnd5e-supplier")?.active === true,
      pricingProfile: pricing.pricingProfile,
      denomination: pricing.denomination,
      coreVersion: MATERIALIZATION_CORE_VERSION,
      pricingSchemaVersion: MATERIALIZATION_PRICING_SCHEMA_VERSION,
      rarityRows: RARITY_ROWS.map(([key, label]) => ({
        key,
        label,
        official: Number(OFFICIAL_RARITY_PRICES[key] ?? 0),
        custom: Number(pricing.customPrices?.[key] ?? 0),
        priceless: key === "artifact"
      }))
    };
  }

  _onRender() {
    const root = this.element;
    root.querySelector('[data-action="cancel"]')?.addEventListener("click", event => {
      event.preventDefault();
      this.close();
    });
    root.querySelector('[data-action="save"]')?.addEventListener("click", event => this.#save(event));
    root.querySelector('[data-action="configure-supplier"]')?.addEventListener("click", event => {
      event.preventDefault();
      game.itemCreator?.configureSupplier?.();
    });
    root.querySelector('[data-action="configure-sources"]')?.addEventListener("click", event => {
      event.preventDefault();
      game.itemCreator?.configureSources?.();
    });
    root.querySelector('[data-action="reset-prices"]')?.addEventListener("click", event => {
      event.preventDefault();
      for (const input of root.querySelectorAll('[data-custom-price]')) {
        input.value = String(OFFICIAL_RARITY_PRICES[input.dataset.customPrice] ?? 0);
      }
    });
    root.querySelectorAll('[name="pricingProfile"]').forEach(input => input.addEventListener("change", () => {
      const custom = root.querySelector('[name="pricingProfile"]:checked')?.value === "custom";
      root.querySelectorAll('[data-custom-price]').forEach(field => { field.disabled = !custom; });
      const denomination = root.querySelector('[name="denomination"]');
      if (denomination) denomination.disabled = !custom;
    }));
  }

  async #save(event) {
    event.preventDefault();
    const root = this.element;
    const wasEnabled = isSupplierEnabled();
    const supplierEnabled = root.querySelector('[name="supplierEnabled"]')?.checked === true;
    const current = getMaterializationSettings();
    const customPrices = { ...current.customPrices };
    for (const input of root.querySelectorAll('[data-custom-price]')) {
      customPrices[input.dataset.customPrice] = Math.max(0, Number(input.value ?? 0) || 0);
    }

    await saveMaterializationSettings({
      ...current,
      pricingProfile: root.querySelector('[name="pricingProfile"]:checked')?.value === "custom" ? "custom" : "official",
      denomination: root.querySelector('[name="denomination"]')?.value || "gp",
      customPrices
    });
    await game.settings.set(MODULE_ID, SUPPLIER_ENABLED_KEY, supplierEnabled);

    if (supplierEnabled) {
      await initializeDefaultSources();
      clearCatalogCache();
    } else if (wasEnabled) {
      game.itemCreator?.closeSupplier?.();
    }

    ui.notifications.info("Item Creator configuration saved.");
    await this.close();
  }
}
