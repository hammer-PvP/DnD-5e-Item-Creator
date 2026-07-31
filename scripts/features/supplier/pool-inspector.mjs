import { MODULE_ID } from "./constants.mjs";
import {
  buildCatalog,
  canonicalKey,
  entriesForProfile,
  isBlueprintItem,
  isGeneratorItem,
  isMaterializerItem,
  isMechanicalItem,
  nativeSubtypeLabel,
  normalizeText
} from "./catalog.mjs";
import { inspectRulePool } from "./generator.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function titleCase(value) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function packageShortLabel(packageName) {
  const known = {
    dnd5e: "D&D5e Core",
    "dnd-players-handbook": "PHB 2024",
    "dnd-dungeon-masters-guide": "DMG 2024"
  };
  if (known[packageName]) return known[packageName];
  return game.modules.get(packageName)?.title
    ?? (packageName === game.system.id ? game.system.title : titleCase(packageName));
}

function sourceDisplay(entry) {
  return `${entry.packLabel} — ${packageShortLabel(entry.packageName)}`;
}

export class SupplierPoolInspector extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dnd5e-item-creator-supplier-pool-inspector",
    classes: ["dnd5e-supplier", "dnd5e-supplier-pool-inspector"],
    position: { width: 900, height: 760 },
    window: {
      title: "DND5E_SUPPLIER.PoolInspector.Title",
      icon: "fa-solid fa-list-check",
      resizable: true
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/supplier/pool-inspector.hbs` }
  };

  constructor({ profile, rule, subtype, configuration, level = 10, onSave } = {}, options = {}) {
    super(options);
    this.profile = profile;
    this.rule = rule;
    this.subtype = subtype;
    this.configuration = configuration;
    this.level = Math.min(20, Math.max(1, Number(level ?? 10)));
    this.onSave = onSave;
    this.entries = [];
    this.selected = new Set();
    this.initialized = false;
  }

  async _prepareContext() {
    const catalog = await buildCatalog({ configurationOverride: this.configuration });
    const profileEntries = entriesForProfile(catalog, this.profile, this.configuration);
    const inspectionRule = foundry.utils.deepClone(this.rule);
    inspectionRule.subtypes = [this.subtype];
    inspectionRule.poolExclusions = [];
    inspectionRule.materializerExclusions = [];
    const inspection = inspectRulePool({
      rule: inspectionRule,
      catalog,
      profileEntries,
      configuration: this.configuration,
      profile: this.profile,
      level: this.level,
      applyProgression: false
    });

    this.entries = [...(inspection.entries ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name) || sourceDisplay(a).localeCompare(sourceDisplay(b)));

    const excluded = new Set((this.rule.poolExclusions ?? []).map(String));
    const materializerExcluded = new Set((this.rule.materializerExclusions ?? []).map(String));
    if (!this.initialized) {
      this.selected = new Set(this.entries
        .filter(entry => !(isMaterializerItem(entry) ? materializerExcluded : excluded).has(canonicalKey(entry)))
        .map(canonicalKey));
      this.initialized = true;
    }

    return {
      subtypeLabel: nativeSubtypeLabel(this.subtype),
      ruleName: this.rule.name || game.i18n.localize("DND5E_SUPPLIER.Config.UnnamedRule"),
      totalCount: this.entries.length,
      selectedCount: this.entries.filter(entry => this.selected.has(canonicalKey(entry))).length,
      entries: this.entries.map(entry => {
        const key = canonicalKey(entry);
        const variantCount = entry.sourceVariants?.length ?? 1;
        const rarityKey = entry.rarity || "none";
        return {
          ...entry,
          canonicalKey: key,
          checked: this.selected.has(key),
          sourceDisplay: sourceDisplay(entry),
          subtypeLabel: nativeSubtypeLabel(entry.primarySubtypeKey),
          rarityLabel: game.i18n.localize(`DND5E_SUPPLIER.Rarity.${rarityKey}`),
          stateLabel: entry.isMagical
            ? game.i18n.localize("DND5E_SUPPLIER.Config.Magical")
            : game.i18n.localize("DND5E_SUPPLIER.Config.Mundane"),
          natureLabel: isMechanicalItem(entry)
            ? game.i18n.localize("DND5E_SUPPLIER.DocumentNature.Mechanical")
            : isGeneratorItem(entry)
              ? game.i18n.localize("DND5E_SUPPLIER.DocumentNature.Generator")
              : isBlueprintItem(entry)
                ? game.i18n.localize("DND5E_SUPPLIER.DocumentNature.Blueprint")
                : game.i18n.localize("DND5E_SUPPLIER.DocumentNature.Sellable"),
          natureClass: isMechanicalItem(entry)
            ? "mechanical"
            : isGeneratorItem(entry)
              ? "generator"
              : isBlueprintItem(entry)
                ? "blueprint"
                : "sellable",
          variantNote: variantCount > 1
            ? game.i18n.format("DND5E_SUPPLIER.PoolInspector.SourceVariants", { count: variantCount })
            : "",
          searchText: normalizeText(`${entry.name} ${entry.identifier} ${entry.packLabel} ${entry.packageName} ${entry.rarity} ${entry.subtype}`)
        };
      })
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    if (!root) return;

    const search = root.querySelector("[data-action='search']");
    const rows = [...root.querySelectorAll("[data-pool-item]")];
    const selectedCount = root.querySelector("[data-selected-count]");
    const visibleCount = root.querySelector("[data-visible-count]");

    const updateCounts = () => {
      if (selectedCount) selectedCount.textContent = String(this.selected.size);
      if (visibleCount) visibleCount.textContent = String(rows.filter(row => !row.hidden).length);
    };

    const applySearch = () => {
      const query = normalizeText(search?.value ?? "");
      for (const row of rows) row.hidden = Boolean(query && !row.dataset.search.includes(query));
      updateCounts();
    };

    const setRow = (row, checked) => {
      const key = row.dataset.key;
      const input = row.querySelector("[data-pool-toggle]");
      if (checked) this.selected.add(key);
      else this.selected.delete(key);
      if (input) input.checked = checked;
      row.classList.toggle("selected", checked);
      updateCounts();
    };

    search?.addEventListener("input", applySearch);
    search?.focus();

    root.querySelectorAll("[data-pool-toggle]").forEach(input => {
      input.addEventListener("change", event => {
        event.stopPropagation();
        setRow(input.closest("[data-pool-item]"), input.checked);
      });
    });

    root.querySelectorAll("[data-action='open-document']").forEach(button => {
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        const document = await fromUuid(button.dataset.uuid);
        document?.sheet?.render(true);
      });
    });

    root.querySelector("[data-action='select-all']")?.addEventListener("click", () => {
      for (const row of rows) setRow(row, true);
    });

    root.querySelector("[data-action='clear-all']")?.addEventListener("click", () => {
      for (const row of rows) setRow(row, false);
    });

    root.querySelector("[data-action='save-curation']")?.addEventListener("click", async () => {
      const sellableKeys = new Set(this.entries.filter(entry => !isMaterializerItem(entry)).map(canonicalKey));
      const materializerKeys = new Set(this.entries.filter(entry => isMaterializerItem(entry)).map(canonicalKey));
      const existing = new Set((this.rule.poolExclusions ?? []).map(String));
      const existingMaterializers = new Set((this.rule.materializerExclusions ?? []).map(String));
      for (const key of sellableKeys) existing.delete(key);
      for (const key of materializerKeys) existingMaterializers.delete(key);
      for (const key of sellableKeys) if (!this.selected.has(key)) existing.add(key);
      for (const key of materializerKeys) if (!this.selected.has(key)) existingMaterializers.add(key);
      await this.onSave?.({
        poolExclusions: [...existing],
        materializerExclusions: [...existingMaterializers]
      });
      this.close();
    });

    applySearch();
  }
}
