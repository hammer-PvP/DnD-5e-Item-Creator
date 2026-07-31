import { MODULE_ID } from "./constants.mjs";
import {
  HOMEBREW_ACCESS_LEVELS,
  HOMEBREW_SUPPLIER_TEMPLATES,
  createBlankSupplierProfile,
  createHomebrewSupplierProfile
} from "./homebrew-suppliers.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class HomebrewSupplierPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dnd5e-item-creator-supplier-homebrew-picker",
    classes: ["dnd5e-supplier", "dnd5e-supplier-homebrew-picker"],
    position: { width: 760, height: 680 },
    window: {
      title: "DND5E_SUPPLIER.Homebrew.CreateSupplier",
      icon: "fa-solid fa-shop",
      resizable: true
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/supplier/homebrew-supplier-picker.hbs` }
  };

  constructor({ sourceIds = [], onCreate = null } = {}, options = {}) {
    super(options);
    this.sourceIds = [...sourceIds];
    this.onCreate = onCreate;
    this.mode = "blank";
    this.templateId = "blacksmith";
    this.accessLevel = "2";
    this.name = "";
  }

  async _prepareContext() {
    return {
      name: this.name,
      blankMode: this.mode === "blank",
      homebrewMode: this.mode === "homebrew",
      templates: HOMEBREW_SUPPLIER_TEMPLATES.map(template => ({
        ...template,
        label: game.i18n.localize(template.label),
        description: game.i18n.localize(template.description),
        selected: this.templateId === template.id,
        themeClass: `theme-${template.theme}`
      })),
      accessLevels: HOMEBREW_ACCESS_LEVELS.map(value => ({
        value,
        label: game.i18n.localize(`DND5E_SUPPLIER.Homebrew.Access${value}`),
        description: game.i18n.localize(`DND5E_SUPPLIER.Homebrew.Access${value}Hint`),
        accessClass: `access-${value}`,
        selected: this.accessLevel === value
      }))
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    if (!root) return;

    root.querySelector("[name='supplierName']")?.addEventListener("input", event => {
      this.name = event.currentTarget.value;
    });

    root.querySelectorAll("[data-mode]").forEach(button => {
      button.addEventListener("click", () => {
        this.name = root.querySelector("[name='supplierName']")?.value ?? this.name;
        this.mode = button.dataset.mode;
        this.render();
      });
    });

    root.querySelectorAll("[data-template-id]").forEach(button => {
      button.addEventListener("click", () => {
        this.name = root.querySelector("[name='supplierName']")?.value ?? this.name;
        this.templateId = button.dataset.templateId;
        this.mode = "homebrew";
        this.render();
      });
    });

    root.querySelectorAll("[data-access-level]").forEach(button => {
      button.addEventListener("click", () => {
        this.name = root.querySelector("[name='supplierName']")?.value ?? this.name;
        this.accessLevel = button.dataset.accessLevel;
        this.render();
      });
    });

    root.querySelector("[data-action='create-supplier']")?.addEventListener("click", async () => {
      this.name = String(root.querySelector("[name='supplierName']")?.value ?? this.name).trim();
      const template = HOMEBREW_SUPPLIER_TEMPLATES.find(entry => entry.id === this.templateId);
      const fallbackName = this.mode === "homebrew" && template
        ? game.i18n.localize(template.label)
        : game.i18n.localize("DND5E_SUPPLIER.Config.NewProfile");
      const name = this.name || fallbackName;
      const profile = this.mode === "homebrew"
        ? createHomebrewSupplierProfile({ templateId: this.templateId, accessLevel: this.accessLevel, name, sourceIds: this.sourceIds })
        : createBlankSupplierProfile({ name, sourceIds: this.sourceIds });
      await this.onCreate?.(profile);
      this.close();
    });
  }
}
