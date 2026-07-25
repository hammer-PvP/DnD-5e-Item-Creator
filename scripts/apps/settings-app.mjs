import { MODULE_ID } from "../constants.mjs";
import { ItemCreatorSourceRegistry } from "../services/source-registry.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ItemCreatorSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.draftEnabled = null;
    this.draftOrder = null;
    this.search = "";
    this.restoreScrollTop = null;
  }

  static DEFAULT_OPTIONS = {
    id: "item-creator-settings",
    classes: ["item-creator", "ic-settings-app", "standard-form"],
    tag: "form",
    position: { width: 760, height: 680 },
    window: { title: "Item Creator Content Sources", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/settings.hbs` }
  };

  async _prepareContext() {
    const registry = ItemCreatorSourceRegistry.instance;
    const sources = await registry.discoverWeaponSources({ force: true });
    const settings = registry.resolveSourceSettings(sources);
    const availableIds = sources.map(source => source.id);

    if (!this.draftEnabled) this.draftEnabled = new Set(settings.enabledSources);
    for (const id of [...this.draftEnabled]) {
      if (!availableIds.includes(id)) this.draftEnabled.delete(id);
    }

    if (!this.draftOrder) this.draftOrder = settings.sourceOrder.filter(id => availableIds.includes(id));
    else this.draftOrder = this.draftOrder.filter(id => availableIds.includes(id));
    for (const id of availableIds) {
      if (!this.draftOrder.includes(id)) this.draftOrder.push(id);
    }

    const sourceMap = new Map(sources.map(source => [source.id, source]));
    const rows = this.draftOrder.map((id, index) => {
      const source = sourceMap.get(id);
      if (!source) return null;
      return {
        ...source,
        enabled: this.draftEnabled.has(id),
        position: index + 1,
        canMoveUp: index > 0,
        canMoveDown: index < this.draftOrder.length - 1,
        packageSummary: source.packageTitles.join(" · ")
      };
    }).filter(Boolean);

    return {
      sources: rows,
      sourceCount: rows.length,
      enabledCount: this.draftEnabled.size,
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
    root.querySelectorAll('[data-action="move-source"]').forEach(button => button.addEventListener("click", event => this.#moveSource(event)));
    root.querySelectorAll('[name="enabledSources"]').forEach(input => input.addEventListener("change", event => this.#toggleSource(event)));

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
    const visibleIds = [...this.element.querySelectorAll('[data-source-row]:not([hidden]) [name="enabledSources"]')]
      .map(input => input.value);
    for (const id of visibleIds) {
      if (checked) this.draftEnabled.add(id);
      else this.draftEnabled.delete(id);
    }
    this.#renderPreservingScroll();
  }

  #toggleSource(event) {
    const id = event.currentTarget.value;
    if (!id) return;
    if (event.currentTarget.checked) this.draftEnabled.add(id);
    else this.draftEnabled.delete(id);
    this.#renderPreservingScroll();
  }

  #moveSource(event) {
    event.preventDefault();
    const id = event.currentTarget.dataset.sourceId;
    const direction = event.currentTarget.dataset.direction;
    if (!id || !["up", "down"].includes(direction)) return;
    const index = this.draftOrder.indexOf(id);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= this.draftOrder.length) return;
    [this.draftOrder[index], this.draftOrder[targetIndex]] = [this.draftOrder[targetIndex], this.draftOrder[index]];
    this.#renderPreservingScroll();
  }

  #filter(event) {
    this.search = String(event.currentTarget.value ?? "").trim().toLowerCase();
    this.#applySearchFilter();
  }

  #applySearchFilter() {
    const query = this.search;
    for (const row of this.element?.querySelectorAll("[data-source-row]") ?? []) {
      row.hidden = Boolean(query) && !String(row.dataset.search ?? "").includes(query);
    }
  }

  async #save(event) {
    event.preventDefault();
    const sourceOrder = [...this.draftOrder];
    const enabledSources = sourceOrder.filter(id => this.draftEnabled.has(id));
    await game.settings.set(MODULE_ID, "sourceSettings", {
      initialized: true,
      enabledSources,
      sourceOrder
    });
    ItemCreatorSourceRegistry.instance.invalidate();
    ui.notifications.info("Item Creator content sources saved.");
    await this.close();
  }
}
