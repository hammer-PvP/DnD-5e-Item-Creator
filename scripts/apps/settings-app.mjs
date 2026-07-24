import { MODULE_ID } from "../constants.mjs";
import { ItemCreatorSourceRegistry } from "../services/source-registry.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ItemCreatorSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.collapsedSources = new Set();
    this.draftEnabled = null;
    this.draftOrder = null;
    this.search = "";
    this.restoreScrollTop = null;
  }

  static DEFAULT_OPTIONS = {
    id: "item-creator-settings",
    classes: ["item-creator", "ic-settings-app", "standard-form"],
    tag: "form",
    position: { width: 840, height: 780 },
    window: { title: "Item Creator Content Sources", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/settings.hbs` }
  };

  async _prepareContext() {
    const registry = ItemCreatorSourceRegistry.instance;
    const packs = await registry.discoverWeaponPacks({ force: true });
    const settings = registry.sourceSettings;
    const availableCollections = packs.map(pack => pack.collection);

    if (this.draftEnabled) {
      for (const collection of [...this.draftEnabled]) {
        if (!availableCollections.includes(collection)) this.draftEnabled.delete(collection);
      }
    }
    if (!this.draftEnabled) {
      this.draftEnabled = new Set(settings.initialized ? settings.enabledPacks : availableCollections);
    }
    if (!this.draftOrder) {
      const stored = settings.packOrder.filter(collection => availableCollections.includes(collection));
      const remaining = packs.map(pack => pack.collection).filter(collection => !stored.includes(collection));
      this.draftOrder = [...stored, ...remaining];
    } else {
      this.draftOrder = this.draftOrder.filter(collection => availableCollections.includes(collection));
      for (const collection of availableCollections) {
        if (!this.draftOrder.includes(collection)) this.draftOrder.push(collection);
      }
    }

    const packMap = new Map(packs.map(pack => [pack.collection, pack]));
    const enabledPriority = this.draftOrder.filter(collection => this.draftEnabled.has(collection));
    const priorityPacks = enabledPriority.map((collection, index) => {
      const pack = packMap.get(collection);
      return {
        ...pack,
        position: index + 1,
        canMoveUp: index > 0,
        canMoveDown: index < enabledPriority.length - 1
      };
    }).filter(pack => pack.collection);

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
      const enabled = this.draftEnabled.has(pack.collection);
      const priorityIndex = enabledPriority.indexOf(pack.collection);
      group.packs.push({
        ...pack,
        enabled,
        priorityPosition: priorityIndex >= 0 ? priorityIndex + 1 : null
      });
      group.weaponCount += pack.weaponCount;
      if (enabled) group.enabledCount += 1;
    }

    const sourceGroups = [...groupsById.values()]
      .map(group => ({
        ...group,
        collapsed: this.collapsedSources.has(group.id),
        packs: group.packs.sort((a, b) => {
          const aIndex = this.draftOrder.indexOf(a.collection);
          const bIndex = this.draftOrder.indexOf(b.collection);
          return aIndex - bIndex || a.label.localeCompare(b.label, game.i18n.lang);
        })
      }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, game.i18n.lang));

    const validIds = new Set(sourceGroups.map(group => group.id));
    for (const id of [...this.collapsedSources]) {
      if (!validIds.has(id)) this.collapsedSources.delete(id);
    }

    return {
      sourceGroups,
      priorityPacks,
      packCount: packs.length,
      enabledCount: this.draftEnabled.size,
      allCollapsed: Boolean(sourceGroups.length) && sourceGroups.every(group => this.collapsedSources.has(group.id)),
      search: this.search
    };
  }

  _onRender() {
    const root = this.element;
    root.querySelector('[data-action="cancel"]')?.addEventListener("click", event => {
      event.preventDefault();
      this.close();
    });
    root.querySelector('[data-action="select-all"]')?.addEventListener("click", event => this.#setAll(event, true));
    root.querySelector('[data-action="clear-all"]')?.addEventListener("click", event => this.#setAll(event, false));
    root.querySelector('[data-source-search]')?.addEventListener("input", event => this.#filter(event));
    root.querySelector('[data-action="save"]')?.addEventListener("click", event => this.#save(event));
    root.querySelector('[data-action="toggle-all-source-groups"]')?.addEventListener("click", event => this.#toggleAll(event));
    root.querySelectorAll('[data-action="toggle-source-group"]').forEach(button => button.addEventListener("click", event => this.#toggleGroup(event)));
    root.querySelectorAll('[data-action="move-priority"]').forEach(button => button.addEventListener("click", event => this.#movePriority(event)));
    root.querySelectorAll('[name="enabledPacks"]').forEach(input => input.addEventListener("change", event => this.#togglePack(event)));

    this.#applySearchFilter();
    if (Number.isFinite(this.restoreScrollTop)) {
      const top = this.restoreScrollTop;
      this.restoreScrollTop = null;
      requestAnimationFrame(() => {
        const list = this.element?.querySelector(".ic-source-list");
        if (list) list.scrollTop = top;
      });
    }
  }

  #captureScroll() {
    return this.element?.querySelector(".ic-source-list")?.scrollTop ?? 0;
  }

  #renderPreservingScroll() {
    this.restoreScrollTop = this.#captureScroll();
    this.render({ force: true });
  }

  #setAll(event, checked) {
    event.preventDefault();
    const visibleCollections = [...this.element.querySelectorAll('[data-source-row]:not([hidden]) [name="enabledPacks"]')]
      .map(input => input.value);
    for (const collection of visibleCollections) {
      if (checked) this.draftEnabled.add(collection);
      else this.draftEnabled.delete(collection);
      if (!this.draftOrder.includes(collection)) this.draftOrder.push(collection);
    }
    this.#renderPreservingScroll();
  }

  #togglePack(event) {
    const collection = event.currentTarget.value;
    if (!collection) return;
    if (event.currentTarget.checked) this.draftEnabled.add(collection);
    else this.draftEnabled.delete(collection);
    if (!this.draftOrder.includes(collection)) this.draftOrder.push(collection);
    this.#renderPreservingScroll();
  }

  #movePriority(event) {
    event.preventDefault();
    const collection = event.currentTarget.dataset.collection;
    const direction = event.currentTarget.dataset.direction;
    if (!collection || !["up", "down"].includes(direction)) return;
    const enabled = this.draftOrder.filter(id => this.draftEnabled.has(id));
    const index = enabled.indexOf(collection);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= enabled.length) return;
    const other = enabled[targetIndex];
    const globalIndex = this.draftOrder.indexOf(collection);
    const otherGlobalIndex = this.draftOrder.indexOf(other);
    [this.draftOrder[globalIndex], this.draftOrder[otherGlobalIndex]] = [this.draftOrder[otherGlobalIndex], this.draftOrder[globalIndex]];
    this.#renderPreservingScroll();
  }

  #toggleGroup(event) {
    event.preventDefault();
    const sourceId = event.currentTarget.dataset.sourceId;
    if (!sourceId) return;
    if (this.collapsedSources.has(sourceId)) this.collapsedSources.delete(sourceId);
    else this.collapsedSources.add(sourceId);
    this.#renderPreservingScroll();
  }

  #toggleAll(event) {
    event.preventDefault();
    const ids = [...this.element.querySelectorAll('[data-source-group]')].map(group => group.dataset.sourceId).filter(Boolean);
    const allCollapsed = Boolean(ids.length) && ids.every(id => this.collapsedSources.has(id));
    if (allCollapsed) this.collapsedSources.clear();
    else this.collapsedSources = new Set(ids);
    this.#renderPreservingScroll();
  }

  #filter(event) {
    this.search = String(event.currentTarget.value ?? "").trim().toLowerCase();
    this.#applySearchFilter();
  }

  #applySearchFilter() {
    const query = this.search;
    for (const group of this.element?.querySelectorAll("[data-source-group]") ?? []) {
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

  async #save(event) {
    event.preventDefault();
    const button = event.currentTarget;
    if (button.disabled) return;
    if (!this.draftEnabled.size) return ui.notifications.error("Enable at least one content source.");
    button.disabled = true;
    try {
      await game.settings.set(MODULE_ID, "sourceSettings", {
        initialized: true,
        enabledPacks: this.draftOrder.filter(collection => this.draftEnabled.has(collection)),
        packOrder: [...this.draftOrder]
      });
      ItemCreatorSourceRegistry.instance.invalidate();
      ui.notifications.info("Item Creator content sources and priority saved.");
      game.itemCreator?.app?.render({ force: true });
      await this.close();
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to save source settings.`, error);
      ui.notifications.error("Item Creator could not save the content source settings.");
      button.disabled = false;
    }
  }
}
