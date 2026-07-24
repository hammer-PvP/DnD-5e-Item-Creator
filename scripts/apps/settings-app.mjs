import { MODULE_ID } from "../constants.mjs";
import { ItemCreatorSourceRegistry } from "../services/source-registry.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ItemCreatorSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.collapsedSources = new Set();
  }

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
    const groupsById = new Map();
    for (const pack of packs) {
      let group = groupsById.get(pack.sourceId);
      if (!group) {
        group = {
          id: pack.sourceId,
          label: pack.sourceLabel,
          order: pack.sourceOrder,
          packs: [],
          weaponCount: 0,
          enabledCount: 0
        };
        groupsById.set(pack.sourceId, group);
      }
      group.packs.push(pack);
      group.weaponCount += pack.weaponCount;
      if (pack.enabled) group.enabledCount += 1;
    }

    const sourceGroups = [...groupsById.values()]
      .map(group => ({
        ...group,
        collapsed: this.collapsedSources.has(group.id),
        packs: group.packs.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang))
      }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, game.i18n.lang));

    const validIds = new Set(sourceGroups.map(group => group.id));
    for (const id of [...this.collapsedSources]) {
      if (!validIds.has(id)) this.collapsedSources.delete(id);
    }

    return {
      sourceGroups,
      packCount: packs.length,
      enabledCount: packs.filter(pack => pack.enabled).length,
      allCollapsed: Boolean(sourceGroups.length) && sourceGroups.every(group => this.collapsedSources.has(group.id))
    };
  }

  _onRender() {
    const root = this.element;
    root.querySelector('[data-action="cancel"]')?.addEventListener("click", () => this.close());
    root.querySelector('[data-action="select-all"]')?.addEventListener("click", event => this.#setAll(event, true));
    root.querySelector('[data-action="clear-all"]')?.addEventListener("click", event => this.#setAll(event, false));
    root.querySelector('[data-source-search]')?.addEventListener("input", event => this.#filter(event));
    root.querySelector('[data-action="save"]')?.addEventListener("click", event => this.#save(event));
    root.querySelector('[data-action="toggle-all-source-groups"]')?.addEventListener("click", event => this.#toggleAll(event));
    root.querySelectorAll('[data-action="toggle-source-group"]').forEach(button => button.addEventListener("click", event => this.#toggleGroup(event)));
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

  #toggleGroup(event) {
    event.preventDefault();
    const sourceId = event.currentTarget.dataset.sourceId;
    if (!sourceId) return;
    if (this.collapsedSources.has(sourceId)) this.collapsedSources.delete(sourceId);
    else this.collapsedSources.add(sourceId);
    this.render({ force: true });
  }

  #toggleAll(event) {
    event.preventDefault();
    const ids = [...this.element.querySelectorAll('[data-source-group]')].map(group => group.dataset.sourceId).filter(Boolean);
    const allCollapsed = Boolean(ids.length) && ids.every(id => this.collapsedSources.has(id));
    if (allCollapsed) this.collapsedSources.clear();
    else this.collapsedSources = new Set(ids);
    this.render({ force: true });
  }

  #filter(event) {
    const query = String(event.currentTarget.value ?? "").trim().toLowerCase();
    for (const group of this.element.querySelectorAll("[data-source-group]")) {
      let visible = 0;
      for (const row of group.querySelectorAll("[data-source-row]")) {
        const show = !query || String(row.dataset.search ?? "").includes(query);
        row.hidden = !show;
        if (show) visible += 1;
      }
      group.hidden = visible === 0;
      group.classList.toggle("ic-search-expanded", Boolean(query && visible));
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
