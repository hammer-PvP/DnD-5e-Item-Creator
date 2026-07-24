import { MODULE_ID } from "../constants.mjs";
import { ItemCreatorSourceRegistry } from "../services/source-registry.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function valuesOf(value) {
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return [...value];
  if (value instanceof Map) return [...value.values()];
  if (value?.values instanceof Function) {
    try { return [...value.values()]; } catch (_error) { /* Continue. */ }
  }
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function localizedLabel(config, fallback) {
  const label = typeof config === "string" ? config : config?.label;
  return label ? game.i18n.localize(label) : fallback;
}

function damageSummary(option) {
  const damage = option?.system?.damage?.base ?? {};
  const number = Number(damage.number ?? 0);
  const denomination = Number(damage.denomination ?? 0);
  const types = valuesOf(damage.types);
  const type = types[0] ?? "";
  const typeLabel = type ? localizedLabel(CONFIG.DND5E.damageTypes?.[type], type) : "";
  const dice = number && denomination ? `${number}d${denomination}` : "—";
  const bonus = String(damage.bonus ?? "").trim();
  return `${dice}${bonus ? ` + ${bonus}` : ""}${typeLabel ? ` ${typeLabel}` : ""}`;
}

function weaponTypeLabel(option) {
  const value = option?.weaponType ?? "";
  return value ? localizedLabel(CONFIG.DND5E.weaponTypes?.[value], value) : "Unknown Weapon Type";
}

export class ItemCreatorTemplateBrowserApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ selectedUuid = null, onSelect = null, onClosed = null } = {}) {
    super();
    this.selectedUuid = selectedUuid;
    this.onSelect = onSelect;
    this.onClosed = onClosed;
    this.search = "";
    this.weaponType = "all";
    this.collection = "all";
    this.restoreResultsScroll = null;
    this.submitting = false;
    this.closedNotified = false;
  }

  static DEFAULT_OPTIONS = {
    id: "item-creator-template-browser",
    classes: ["item-creator", "ic-browser-app", "standard-form"],
    tag: "form",
    position: { width: 980, height: 760 },
    window: { title: "Weapon Template Browser", resizable: true, modal: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/template-browser.hbs` }
  };

  async _prepareContext() {
    const registry = ItemCreatorSourceRegistry.instance;
    await registry.loadWeapons();

    if (this.selectedUuid && !registry.findWeapon(this.selectedUuid)) this.selectedUuid = null;
    const selected = this.selectedUuid ? registry.findWeapon(this.selectedUuid) : null;

    const typeCounts = new Map();
    for (const option of registry.weaponOptions) {
      typeCounts.set(option.weaponType, (typeCounts.get(option.weaponType) ?? 0) + 1);
    }

    const weaponTypeOptions = [{
      value: "all",
      label: "All Weapon Types",
      selected: this.weaponType === "all"
    }, ...Object.entries(CONFIG.DND5E.weaponTypes ?? {})
      .filter(([value]) => typeCounts.has(value))
      .map(([value, entry]) => ({
        value,
        label: `${localizedLabel(entry, value)} (${typeCounts.get(value)})`,
        selected: this.weaponType === value
      }))];

    const sourceOptions = [{
      value: "all",
      label: "All Active Compendiums",
      selected: this.collection === "all"
    }, ...registry.weaponPackGroups.map(group => ({
      value: group.collection,
      label: `${group.sourceLabel} — ${group.label} (${group.weaponCount})`,
      selected: this.collection === group.collection
    }))];

    const groups = registry.weaponPackGroups.map((group, index) => ({
      ...group,
      position: index + 1,
      items: group.items.map(option => ({
        ...option,
        selected: option.uuid === this.selectedUuid,
        categoryLabel: weaponTypeLabel(option),
        damageSummary: damageSummary(option)
      }))
    }));

    const selectedPreview = selected ? {
      ...selected,
      categoryLabel: weaponTypeLabel(selected),
      damageSummary: damageSummary(selected),
      masteryLabel: selected.system?.mastery
        ? localizedLabel(CONFIG.DND5E.weaponMasteries?.[selected.system.mastery], selected.system.mastery)
        : "None"
    } : null;

    return {
      search: this.search,
      weaponTypeOptions,
      sourceOptions,
      groups,
      selectedPreview,
      selectedUuid: this.selectedUuid,
      totalCount: registry.weaponOptions.length
    };
  }

  _onRender() {
    const root = this.element;
    root.querySelector('[data-browser-search]')?.addEventListener("input", event => {
      this.search = String(event.currentTarget.value ?? "").trim().toLowerCase();
      this.#applyFilters();
    });
    root.querySelector('[data-browser-weapon-type]')?.addEventListener("change", event => {
      this.weaponType = String(event.currentTarget.value ?? "all");
      this.#applyFilters();
    });
    root.querySelector('[data-browser-source]')?.addEventListener("change", event => {
      this.collection = String(event.currentTarget.value ?? "all");
      this.#applyFilters();
    });
    root.querySelectorAll('[data-action="select-template-card"]').forEach(button => {
      button.addEventListener("click", event => this.#selectCard(event));
    });
    root.querySelector('[data-action="cancel-template-browser"]')?.addEventListener("click", event => {
      event.preventDefault();
      this.close();
    });
    root.querySelector('[data-action="confirm-template-browser"]')?.addEventListener("click", event => this.#confirm(event));

    this.#applyFilters();
    if (Number.isFinite(this.restoreResultsScroll)) {
      const top = this.restoreResultsScroll;
      this.restoreResultsScroll = null;
      requestAnimationFrame(() => {
        const list = this.element?.querySelector(".ic-browser-results");
        if (list) list.scrollTop = top;
      });
    }
  }

  #applyFilters() {
    const root = this.element;
    if (!root) return;
    let visible = 0;
    for (const group of root.querySelectorAll("[data-template-group]")) {
      const groupCollection = group.dataset.collection;
      let groupVisible = 0;
      for (const card of group.querySelectorAll("[data-template-card]")) {
        const matchesSearch = !this.search || String(card.dataset.search ?? "").includes(this.search);
        const matchesType = this.weaponType === "all" || card.dataset.weaponType === this.weaponType;
        const matchesSource = this.collection === "all" || groupCollection === this.collection;
        const show = matchesSearch && matchesType && matchesSource;
        card.hidden = !show;
        if (show) {
          groupVisible += 1;
          visible += 1;
        }
      }
      group.hidden = groupVisible === 0;
    }
    const counter = root.querySelector("[data-browser-visible-count]");
    if (counter) counter.textContent = String(visible);
  }

  #selectCard(event) {
    event.preventDefault();
    const uuid = event.currentTarget.dataset.uuid;
    if (!uuid || uuid === this.selectedUuid) return;
    this.restoreResultsScroll = this.element?.querySelector(".ic-browser-results")?.scrollTop ?? 0;
    this.selectedUuid = uuid;
    this.render({ force: true });
  }

  async #confirm(event) {
    event.preventDefault();
    if (!this.selectedUuid || this.submitting) return;
    this.submitting = true;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const accepted = typeof this.onSelect === "function"
        ? await this.onSelect(this.selectedUuid)
        : true;
      if (accepted !== false) await this.close();
      else button.disabled = false;
    } catch (error) {
      console.error(`${MODULE_ID} | Template Browser selection failed.`, error);
      ui.notifications.error("Item Creator could not select that base template.");
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
