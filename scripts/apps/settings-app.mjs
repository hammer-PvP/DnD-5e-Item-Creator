import { MODULE_ID } from "../constants.mjs";
import { ItemCreatorSourceRegistry } from "../services/source-registry.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ItemCreatorSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "item-creator-settings",
    classes: ["item-creator", "ic-settings-app", "standard-form"],
    tag: "form",
    position: { width: 780, height: 720 },
    window: { title: "Item Creator Content Sources", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/settings.hbs` }
  };

  async _prepareContext() {
    const packs = await ItemCreatorSourceRegistry.instance.discoverWeaponPacks({ force: true });
    return {
      packs,
      packCount: packs.length,
      enabledCount: packs.filter(pack => pack.enabled).length
    };
  }

  _onRender() {
    const root = this.element;
    root.querySelector('[data-action="cancel"]')?.addEventListener("click", () => this.close());
    root.querySelector('[data-action="select-all"]')?.addEventListener("click", event => this.#setAll(event, true));
    root.querySelector('[data-action="clear-all"]')?.addEventListener("click", event => this.#setAll(event, false));
    root.querySelector('[data-source-search]')?.addEventListener("input", event => this.#filter(event));
    root.querySelector('[data-action="save"]')?.addEventListener("click", event => this.#save(event));
    root.querySelectorAll('[name="enabledPacks"]').forEach(input => input.addEventListener("change", () => this.#refreshCount()));
    this.#refreshCount();
  }

  #setAll(event, checked) {
    event.preventDefault();
    for (const input of this.element.querySelectorAll('[data-source-row]:not([hidden]) [name="enabledPacks"]')) {
      input.checked = checked;
    }
    this.#refreshCount();
  }

  #filter(event) {
    const query = String(event.currentTarget.value ?? "").trim().toLowerCase();
    for (const row of this.element.querySelectorAll("[data-source-row]")) {
      row.hidden = Boolean(query && !String(row.dataset.search ?? "").includes(query));
    }
  }

  #refreshCount() {
    const enabled = this.element.querySelectorAll('[name="enabledPacks"]:checked').length;
    const node = this.element.querySelector("[data-enabled-count]");
    if (node) node.textContent = String(enabled);
  }

  async #save(event) {
    event.preventDefault();
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try {
      const enabledPacks = [...this.element.querySelectorAll('[name="enabledPacks"]:checked')]
        .map(input => input.value);
      await game.settings.set(MODULE_ID, "sourceSettings", { initialized: true, enabledPacks });
      ItemCreatorSourceRegistry.instance.invalidate();
      ui.notifications.info("Item Creator content sources saved.");
      game.itemCreator?.app?.render({ force: true });
      await this.close();
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to save source settings.`, error);
      ui.notifications.error("Item Creator could not save the content source settings.");
      button.disabled = false;
    }
  }
}
