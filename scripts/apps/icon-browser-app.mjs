import { MODULE_ID } from "../constants.mjs";
import { ItemCreatorSourceRegistry } from "../services/source-registry.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ItemCreatorIconBrowserApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ itemType = "weapon", selectedIcon = "", onSelect = null, onClosed = null } = {}) {
    super();
    this.itemType = itemType;
    this.selectedIcon = selectedIcon;
    this.pendingIcon = selectedIcon;
    this.onSelect = onSelect;
    this.onClosed = onClosed;
    this.search = "";
    this.collection = "all";
    this.restoreGridScroll = null;
    this.submitting = false;
    this.closedNotified = false;
  }

  static DEFAULT_OPTIONS = {
    id: "item-creator-icon-browser",
    classes: ["item-creator", "ic-browser-app", "ic-icon-browser-app", "standard-form"],
    tag: "form",
    position: { width: 820, height: 720 },
    window: { title: "Icon Selection", resizable: true, modal: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/icon-browser.hbs` }
  };

  async _prepareContext() {
    const registry = ItemCreatorSourceRegistry.instance;
    await registry.loadWeapons();
    const iconOptions = this.itemType === "weapon" ? registry.iconOptions : [];
    const selected = iconOptions.find(option => option.img === this.pendingIcon) ?? null;
    const sourceOptions = [{
      value: "all",
      label: "All Active Compendiums",
      selected: this.collection === "all"
    }, ...registry.activePackSummaries.map(summary => ({
      value: summary.collection,
      label: `${summary.sourceLabel} — ${summary.label}`,
      selected: this.collection === summary.collection
    }))];

    return {
      itemTypeLabel: this.itemType === "weapon" ? "Weapon" : "Item",
      search: this.search,
      sourceOptions,
      iconOptions: iconOptions.map(option => ({
        ...option,
        selected: option.img === this.pendingIcon
      })),
      selected,
      iconCount: iconOptions.length
    };
  }

  _onRender() {
    const root = this.element;
    root.querySelector('[data-icon-browser-search]')?.addEventListener("input", event => {
      this.search = String(event.currentTarget.value ?? "").trim().toLowerCase();
      this.#applyFilters();
    });
    root.querySelector('[data-icon-browser-source]')?.addEventListener("change", event => {
      this.collection = String(event.currentTarget.value ?? "all");
      this.#applyFilters();
    });
    root.querySelectorAll('[data-action="choose-icon-card"]').forEach(button => {
      button.addEventListener("click", event => this.#choose(event));
    });
    root.querySelector('[data-action="cancel-icon-browser"]')?.addEventListener("click", event => {
      event.preventDefault();
      this.close();
    });
    root.querySelector('[data-action="confirm-icon-browser"]')?.addEventListener("click", event => this.#confirm(event));

    this.#applyFilters();
    if (Number.isFinite(this.restoreGridScroll)) {
      const top = this.restoreGridScroll;
      this.restoreGridScroll = null;
      requestAnimationFrame(() => {
        const grid = this.element?.querySelector(".ic-modal-icon-grid");
        if (grid) grid.scrollTop = top;
      });
    }
  }

  #applyFilters() {
    const root = this.element;
    if (!root) return;
    let visible = 0;
    for (const card of root.querySelectorAll("[data-icon-browser-card]")) {
      const matchesSearch = !this.search || String(card.dataset.search ?? "").includes(this.search);
      const matchesSource = this.collection === "all" || card.dataset.collection === this.collection;
      const show = matchesSearch && matchesSource;
      card.hidden = !show;
      if (show) visible += 1;
    }
    const counter = root.querySelector("[data-icon-visible-count]");
    if (counter) counter.textContent = String(visible);
  }

  #choose(event) {
    event.preventDefault();
    const img = event.currentTarget.dataset.img;
    if (!img || img === this.pendingIcon) return;
    this.restoreGridScroll = this.element?.querySelector(".ic-modal-icon-grid")?.scrollTop ?? 0;
    this.pendingIcon = img;
    this.render({ force: true });
  }

  async #confirm(event) {
    event.preventDefault();
    if (!this.pendingIcon || this.submitting) return;
    this.submitting = true;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (typeof this.onSelect === "function") await this.onSelect(this.pendingIcon);
      await this.close();
    } catch (error) {
      console.error(`${MODULE_ID} | Icon Browser selection failed.`, error);
      ui.notifications.error("Item Creator could not apply that icon.");
      button.disabled = false;
    } finally {
      this.submitting = false;
    }
  }

  async close(options = {}) {
    if (!this.closedNotified) {
      this.closedNotified = true;
      this.onClosed?.(this);
    }
    return super.close(options);
  }
}
